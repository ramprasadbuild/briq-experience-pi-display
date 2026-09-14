// The box's single local HTTP port (default 8787), bound to 0.0.0.0:
//
//   /tv/…                     the built TV kiosk app (public/tv), SPA fallback to index.html
//   /content/files/<name>     synced content, with Range (video seeking), HEAD, immutable caching
//   /local/projects.json      live projects on this box
//   /local/projects/<slug>.json  that project's local manifest (payload URLs → /content/files/…)
//   /local/status.json        device status for the TV app (loopback only)
//   /local/events  (WS)       device status / identify / content-changed pushes (loopback only)
//   /relay         (WS)       presenter relay, see relay.js
//   /healthz
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { isValidStoreName } from './content/store.js';
import { isLoopbackAddress } from './sysinfo.js';

const EXT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
};

/** Content type from the first bytes, for store files that have no extension. */
export function sniffType(buf) {
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && ascii(0, 4) === 'glTF') return 'model/gltf-binary';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    if (/^M4A/.test(brand)) return 'audio/mp4';
    return 'video/mp4';
  }
  if (buf.length >= 3 && (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return 'audio/mpeg';
  if (buf.length >= 6 && ascii(0, 6) === 'GIF89a') return 'image/gif';
  return 'application/octet-stream';
}

/** Parses a single-range `Range` header against a file size. null = no/unsupported range; 'invalid' = 416. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return header.includes(',') ? null : 'invalid'; // multi-range: serve the whole file
  let start;
  let end;
  if (m[1] === '' && m[2] === '') return 'invalid';
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

async function sendFile(req, res, path, { type, cacheControl }) {
  let info;
  try {
    info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    return notFound(res);
  }
  const size = info.size;
  const etag = `"${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag && !req.headers.range) {
    res.writeHead(304, headers);
    return res.end();
  }
  const range = parseRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  if (range) {
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
    if (req.method === 'HEAD') return res.end();
    return pipeStream(createReadStream(path, { start: range.start, end: range.end }), res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return pipeStream(createReadStream(path), res);
}

function pipeStream(stream, res) {
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function notFound(res, message = 'not found') {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function json(res, status, body, extra = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>BriQ TV</title>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0a09;color:#f3eee4;font-family:sans-serif;text-align:center">
<div><h1 style="font-weight:400;letter-spacing:.1em">BriQ TV app not built</h1><p style="color:#8a8276">Run <code>npm run build</code> (install.sh does this) and reload.</p></div>`;

export class LocalServer {
  /**
   * @param {object} o
   * @param {import('./content/store.js').ContentStore} o.store
   * @param {import('./relay.js').LocalRelay} o.relay
   * @param {string} o.tvDir built TV app directory
   * @param {() => object} o.getStatus device status for the TV app
   */
  constructor({ store, relay, tvDir, getStatus = () => ({}), isLocal = (req) => isLoopbackAddress(req.socket.remoteAddress), log = console }) {
    this.store = store;
    this.relay = relay;
    this.tvDir = tvDir;
    this.getStatus = getStatus;
    this.isLocal = isLocal;
    this.log = log;
    this.events = new WebSocketServer({ noServer: true });
    this.eventClients = new Set();
    this.events.on('connection', (ws) => {
      this.eventClients.add(ws);
      ws.send(JSON.stringify({ t: 'status', status: this.getStatus() }));
      ws.on('close', () => this.eventClients.delete(ws));
      ws.on('error', () => {});
    });
    this.http = createServer((req, res) => {
      this.#handle(req, res).catch((err) => {
        this.log.error?.(`[server] ${req.method} ${req.url} failed: ${err.stack ?? err}`);
        if (!res.headersSent) json(res, 500, { error: 'internal' });
        else res.destroy();
      });
    });
    this.http.on('upgrade', (req, socket, head) => {
      if (this.relay.handleUpgrade(req, socket, head)) return;
      const { pathname } = new URL(req.url, 'http://local');
      if (pathname === '/local/events') {
        if (!this.isLocal(req)) {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return socket.destroy();
        }
        return this.events.handleUpgrade(req, socket, head, (ws) => this.events.emit('connection', ws, req));
      }
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
    });
  }

  listen(port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(port, host, () => {
        this.http.off('error', reject);
        resolve(this.http.address().port);
      });
    });
  }

  /** Push to the TV app(s): {t:'status'|'identify'|'content'|'reload', …}. */
  broadcast(event) {
    const frame = JSON.stringify(event);
    for (const ws of this.eventClients) if (ws.readyState === ws.OPEN) ws.send(frame);
  }

  async close() {
    for (const ws of this.eventClients) ws.terminate();
    this.relay.close();
    this.http.closeAllConnections?.();
    await new Promise((resolve) => this.http.close(() => resolve()));
  }

  async #handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = decodeURIComponent(url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (path === '/' || path === '/idle' || path === '/tv') {
      res.writeHead(302, { Location: '/tv/' });
      return res.end();
    }
    if (path === '/healthz') return json(res, 200, { ok: true });

    if (path.startsWith('/content/files/')) {
      const name = path.slice('/content/files/'.length);
      if (!isValidStoreName(name)) return notFound(res);
      const filePath = this.store.filePath(name);
      let type = this.store.mimeFor(name);
      if (!type) {
        try {
          const fh = await open(filePath, 'r');
          const buf = Buffer.alloc(32);
          const { bytesRead } = await fh.read(buf, 0, 32, 0);
          await fh.close();
          type = sniffType(buf.subarray(0, bytesRead));
        } catch {
          return notFound(res);
        }
      }
      return sendFile(req, res, filePath, { type, cacheControl: 'public, max-age=31536000, immutable' });
    }

    if (path === '/local/projects.json') {
      return json(res, 200, { updated_at: this.store.current.updated_at ?? null, projects: this.store.listProjects() });
    }
    const m = /^\/local\/projects\/([^/]+)\.json$/.exec(path);
    if (m) {
      const manifest = await this.store.readProjectManifest(m[1]);
      return manifest ? json(res, 200, manifest) : json(res, 404, { error: 'not_on_this_box', slug: m[1] });
    }
    if (path === '/local/status.json') {
      if (!this.isLocal(req)) return json(res, 403, { error: 'local_only' });
      return json(res, 200, this.getStatus());
    }

    if (path.startsWith('/tv/')) return this.#serveTv(req, res, path.slice('/tv/'.length));
    return notFound(res);
  }

  async #serveTv(req, res, rel) {
    const safe = normalize(rel || 'index.html').replace(/^(\.\.(\/|\\|$))+/, '');
    const full = join(this.tvDir, safe);
    if (!full.startsWith(this.tvDir + sep) && full !== this.tvDir) return notFound(res);
    const isAsset = safe.startsWith(`assets${sep}`);
    try {
      const info = await stat(full);
      if (info.isFile()) {
        const type = EXT_TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream';
        // Hashed Vite assets never change; index.html must always be revalidated.
        return sendFile(req, res, full, { type, cacheControl: isAsset ? 'public, max-age=31536000, immutable' : 'no-cache' });
      }
    } catch {
      // fall through to SPA fallback
    }
    if (extname(safe) && safe !== 'index.html') return notFound(res);
    try {
      const html = await readFile(join(this.tvDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(NOT_BUILT);
    }
  }
}
