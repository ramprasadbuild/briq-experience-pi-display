import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const quiet = { info() {}, warn() {}, error() {}, log() {} };

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'briq-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Local HTTP fixture. `routes` maps "METHOD /path" (or "/path" for any method) to
 * async (req, res, body) handlers; `files` maps a path to a Buffer served with Range support.
 * Every request is recorded in `requests`.
 */
export async function fixtureServer(t, { routes = {}, files = {} } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    const handler = routes[`${req.method} ${url.pathname}`] ?? routes[url.pathname];
    if (handler) return handler(req, res, body, url);
    const file = files[url.pathname];
    if (file) {
      const buf = typeof file === 'function' ? file() : file;
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : buf.length - 1;
        if (start >= buf.length) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
        return res.end(buf.subarray(start, end + 1));
      }
      res.writeHead(200, { 'Content-Length': buf.length });
      return res.end(buf);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, requests };
}

export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** A manifest project whose files are served by a fixture at `base`. */
export function project(base, { slug = 'briq-skyline-9', version = 1, files = {}, extra = {} } = {}) {
  const entries = Object.entries(files).map(([path, { buf, withSha = true, key }]) => ({
    key: key ?? `https://cdn.example.com${path}`,
    asset_id: null,
    variant: 'tv',
    kind: 'image',
    url: `${base}${path}`,
    mime: path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
    bytes: withSha ? buf.length : null,
    sha256: withSha ? sha(buf) : null,
  }));
  const payload = {
    slug,
    name: 'BriQ Skyline',
    hero_image: entries[0]?.key ?? null,
    gallery: entries.map((e) => e.key),
    nested: { deep: [{ url: entries[0]?.key ?? null }] },
    untouched: 'https://not-in-files.example.com/x.jpg',
    ...extra,
  };
  return { slug, project_id: 5, version, etag: `sha256:${sha(JSON.stringify({ payload, entries, version }))}`, payload, files: entries, total_bytes: entries.reduce((a, e) => a + (e.bytes ?? 0), 0) };
}
