import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ContentStore } from '../src/content/store.js';
import { SyncAgent } from '../src/content/sync.js';
import { LocalRelay } from '../src/relay.js';
import { LocalServer, parseRange, sniffType } from '../src/server.js';
import { fixtureServer, project, quiet, sha, tempDir } from './helpers.js';

// A fake MP4: ftyp box then filler, so sniffing says video/mp4.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(12), Buffer.from('0123456789'.repeat(100))]);

async function setup(t) {
  const dir = await tempDir(t);
  const { base } = await fixtureServer(t, { files: { '/film.mp4': MP4, '/nosha.bin': MP4 } });
  const store = await new ContentStore(dir).init();
  const p = project(base, { files: { '/film.mp4': { buf: MP4 }, '/nosha.bin': { buf: MP4, withSha: false } } });
  p.files[1].mime = null; // exercise sniffing
  const result = await new SyncAgent({ store, api: { manifest: async () => ({ projects: [p] }) }, log: quiet }).request();
  assert.equal(result.ok, true, result.error);
  const tvDir = join(dir, 'tv');
  await mkdir(join(tvDir, 'assets'), { recursive: true });
  await writeFile(join(tvDir, 'index.html'), '<!doctype html><title>tv</title>');
  await writeFile(join(tvDir, 'assets', 'app-abc.js'), 'console.log(1)');
  const relay = new LocalRelay({ getRelayKey: () => 'rk', log: quiet });
  const server = new LocalServer({ store, relay, tvDir, getStatus: () => ({ device_id: 1 }), log: quiet });
  const port = await server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${port}`, p, store };
}

test('parseRange handles open, closed, suffix and invalid ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseRange('bytes=5-2', 1000), 'invalid');
  assert.equal(parseRange('items=1-2', 1000), 'invalid');
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(sniffType(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffType(Buffer.from('glTF\x02\x00\x00\x00')), 'model/gltf-binary');
});

test('/content/files serves full, ranged (206), suffix and unsatisfiable (416) requests with content types', async (t) => {
  const { base } = await setup(t);
  const url = `${base}/content/files/${sha(MP4)}`;

  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(full.headers.get('content-length')), MP4.length);
  assert.match(full.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), MP4);

  const part = await fetch(url, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${MP4.length}`);
  assert.equal(Number(part.headers.get('content-length')), 100);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), MP4.subarray(100, 200));

  const tail = await fetch(url, { headers: { Range: 'bytes=-10' } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), MP4.subarray(MP4.length - 10));

  const bad = await fetch(url, { headers: { Range: `bytes=${MP4.length}-` } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), `bytes */${MP4.length}`);
  await bad.arrayBuffer();

  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), MP4.length);

  // No mime in the manifest → sniffed.
  const sniffed = await fetch(`${base}/content/files/url-${(await import('../src/content/store.js')).sha256Hex(`${base.replace(/:\d+$/, '')}`)}`);
  assert.equal(sniffed.status, 404); // unknown name
  await sniffed.arrayBuffer();

  const traversal = await fetch(`${base}/content/files/..%2F..%2Fdevice.json`);
  assert.equal(traversal.status, 404);
  await traversal.arrayBuffer();
});

test('sniffs a content type when the manifest has no mime', async (t) => {
  const { base, store, p } = await setup(t);
  const local = await store.readProjectManifest(p.slug);
  const res = await fetch(`${base}${local.files[1].path}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  await res.arrayBuffer();
});

test('local API serves projects, project manifests (404 when absent) and the TV app with SPA fallback', async (t) => {
  const { base, p } = await setup(t);
  const list = await (await fetch(`${base}/local/projects.json`)).json();
  assert.deepEqual(list.projects.map((x) => x.slug), [p.slug]);
  assert.equal(list.projects[0].name, 'BriQ Skyline');

  const manifest = await (await fetch(`${base}/local/projects/${p.slug}.json`)).json();
  assert.match(manifest.payload.hero_image, /^\/content\/files\//);

  const missing = await fetch(`${base}/local/projects/nope.json`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not_on_this_box', slug: 'nope' });

  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/tv/');

  const deep = await fetch(`${base}/tv/some/route`);
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /<title>tv<\/title>/);
  const asset = await fetch(`${base}/tv/assets/app-abc.js`);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  await asset.arrayBuffer();
  const status = await (await fetch(`${base}/local/status.json`)).json();
  assert.equal(status.device_id, 1);
});
