// Plain HTTP helpers for the local server: content-type tables and sniffing, single-range
// `Range` parsing, streaming a file with ETag / 304 / 206 / 416 handling, and small responders.
// Nothing here knows about routes; server.js decides what to serve and calls in.
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';

export const EXT_TYPES = {
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

/** `sniffType` on the first 32 bytes of a file. Throws if the file can't be opened. */
export async function sniffFileType(path) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(32);
    const { bytesRead } = await fh.read(buf, 0, 32, 0);
    return sniffType(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
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

/**
 * Streams a file with `Accept-Ranges`, a weak size+mtime ETag (304 on If-None-Match), 206 for a
 * satisfiable single range, 416 otherwise. HEAD gets the headers only.
 */
export async function sendFile(req, res, path, { type, cacheControl }) {
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

export function notFound(res, message = 'not found') {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

export function json(res, status, body, extra = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}
