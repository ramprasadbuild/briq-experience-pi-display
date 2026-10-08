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
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { CONTENT_URL_PREFIX, isValidStoreName } from './content/store.js';
import { EXT_TYPES, json, notFound, parseRange, sendFile, sniffFileType, sniffType } from './httputil.js';
import { isLoopbackAddress } from './sysinfo.js';
import { sendToAll } from './wsutil.js';

// Re-exported for the tests; the implementations live in httputil.js.
export { parseRange, sniffType };

const IMMUTABLE = 'public, max-age=31536000, immutable';

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
    sendToAll(this.eventClients, event);
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

    if (path.startsWith(CONTENT_URL_PREFIX)) return this.#serveContent(req, res, path.slice(CONTENT_URL_PREFIX.length));

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

  /** Store files are content-addressed and never change: cache forever. Type from the manifest, else sniffed. */
  async #serveContent(req, res, name) {
    if (!isValidStoreName(name)) return notFound(res);
    const filePath = this.store.filePath(name);
    let type = this.store.mimeFor(name);
    if (!type) {
      try {
        type = await sniffFileType(filePath);
      } catch {
        return notFound(res);
      }
    }
    return sendFile(req, res, filePath, { type, cacheControl: IMMUTABLE });
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
        return sendFile(req, res, full, { type, cacheControl: isAsset ? IMMUTABLE : 'no-cache' });
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
