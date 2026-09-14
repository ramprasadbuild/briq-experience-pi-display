import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ContentStore, localNameFor, sha256Hex } from '../src/content/store.js';
import { downloadFile } from '../src/content/download.js';
import { planSync, rewritePayload, SyncAgent, InsufficientSpaceError } from '../src/content/sync.js';
import { fixtureServer, project, quiet, sha, tempDir } from './helpers.js';

const A = Buffer.from('a'.repeat(5000));
const B = Buffer.from('b'.repeat(3000));
const C = Buffer.from('c'.repeat(7000));

function agent(store, manifest, extra = {}) {
  return new SyncAgent({ store, api: { manifest: async () => manifest }, retries: 2, backoffMs: 0, log: quiet, ...extra });
}

test('planSync: same etag with files present is kept; changed etag, new and removed projects are planned', () => {
  const current = { projects: { keep: { etag: 'e1' }, change: { etag: 'e1' }, gone: { etag: 'e9' }, broken: { etag: 'e5' } } };
  const f = (n, bytes = 10) => ({ key: `k${n}`, url: `u${n}`, sha256: sha256Hex(`f${n}`), bytes });
  const manifest = {
    projects: [
      { slug: 'keep', etag: 'e1', files: [f(1)] },
      { slug: 'change', etag: 'e2', files: [f(1), f(2)] },
      { slug: 'new', etag: 'e3', files: [f(2), f(3, null)] },
      { slug: 'broken', etag: 'e5', files: [f(4)] }, // same etag but a file went missing: re-plan
    ],
  };
  const have = new Set([localNameFor(f(1))]);
  const plan = planSync(current, manifest, (name) => have.has(name));
  assert.deepEqual(plan.keep, ['keep']);
  assert.deepEqual(plan.update.map((u) => u.project.slug), ['change', 'new', 'broken']);
  assert.deepEqual(plan.remove, ['gone']);
  // f2 is needed by two projects but downloaded once; f3 has unknown size.
  assert.deepEqual([...plan.downloads.keys()].sort(), [localNameFor(f(2)), localNameFor(f(3)), localNameFor(f(4))].sort());
  assert.equal(plan.totalBytes, 20);
});

test('localNameFor: sha256 when present (sha256: prefix tolerated), url hash otherwise', () => {
  const hex = sha256Hex('x');
  assert.equal(localNameFor({ sha256: `sha256:${hex.toUpperCase()}`, url: 'u' }), hex);
  assert.equal(localNameFor({ sha256: null, url: 'https://x/y.jpg' }), `url-${sha256Hex('https://x/y.jpg')}`);
});

test('rewritePayload replaces exact key matches anywhere, leaves other strings alone', () => {
  const out = rewritePayload({ a: 'K', b: ['K', 'KK'], c: { d: { e: 'K' } }, n: 3, z: null }, new Map([['K', '/content/files/x']]));
  assert.deepEqual(out, { a: '/content/files/x', b: ['/content/files/x', 'KK'], c: { d: { e: '/content/files/x' } }, n: 3, z: null });
});

test('sync downloads, verifies, writes a rewritten local manifest and switches current.json', async (t) => {
  const dir = await tempDir(t);
  const { base } = await fixtureServer(t, { files: { '/a.jpg': A, '/b.jpg': B } });
  const store = await new ContentStore(dir).init();
  const p = project(base, { files: { '/a.jpg': { buf: A }, '/b.jpg': { buf: B, withSha: false } } });
  const result = await agent(store, { projects: [p] }).request('test');
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.updated, [p.slug]);

  const current = JSON.parse(await readFile(join(dir, 'content/current.json'), 'utf8'));
  assert.equal(current.projects[p.slug].etag, p.etag);
  const local = await store.readProjectManifest(p.slug);
  assert.equal(local.payload.hero_image, `/content/files/${sha(A)}`);
  assert.equal(local.payload.gallery[1], `/content/files/url-${sha256Hex(`${base}/b.jpg`)}`);
  assert.equal(local.payload.nested.deep[0].url, `/content/files/${sha(A)}`);
  assert.equal(local.payload.untouched, 'https://not-in-files.example.com/x.jpg');
  assert.deepEqual(await readFile(store.filePath(sha(A))), A);
  assert.deepEqual(store.contentMap(), { [p.slug]: { version: 1, etag: p.etag } });

  // Second run with the same etag is a no-op.
  const again = await agent(store, { projects: [p] }).request('test');
  assert.equal(again.changed, false);
  assert.deepEqual(again.kept, [p.slug]);
});

test('sha256 mismatch: file rejected, part deleted, current version untouched, error reported', async (t) => {
  const dir = await tempDir(t);
  let serveCorrupt = false;
  const { base, requests } = await fixtureServer(t, { files: { '/a.jpg': A, '/c.jpg': () => (serveCorrupt ? Buffer.from('x'.repeat(C.length)) : C) } });
  const store = await new ContentStore(dir).init();
  const v1 = project(base, { version: 1, files: { '/a.jpg': { buf: A } } });
  assert.equal((await agent(store, { projects: [v1] }).request('v1')).ok, true);
  const before = await readFile(join(dir, 'content/current.json'), 'utf8');

  serveCorrupt = true;
  const v2 = project(base, { version: 2, files: { '/a.jpg': { buf: A }, '/c.jpg': { buf: C } } });
  const sync = agent(store, { projects: [v2] });
  const states = [];
  sync.on('state', (s) => states.push(s.state));
  const result = await sync.request('v2');
  assert.equal(result.ok, false);
  assert.match(result.error, /sha256 mismatch/);
  assert.equal(sync.status().state, 'error');
  assert.equal(await readFile(join(dir, 'content/current.json'), 'utf8'), before, 'current.json must not change');
  assert.equal((await store.readProjectManifest(v1.slug)).version, 1);
  await assert.rejects(stat(store.filePath(sha(C))));
  await assert.rejects(stat(store.partPath(sha(C))), 'corrupt part must not be kept for resume');
  assert.equal(requests.filter((r) => r.path === '/c.jpg').length, 2, 'retried once (retries=2)');
  assert.ok(states.includes('syncing'));

  // The next sync with good bytes succeeds and switches.
  serveCorrupt = false;
  const ok = await agent(store, { projects: [v2] }).request('v2 retry');
  assert.equal(ok.ok, true, ok.error);
  assert.equal((await store.readProjectManifest(v2.slug)).version, 2);
});

test('atomic switch + GC: old version files and manifests removed only after switching; removed projects dropped', async (t) => {
  const dir = await tempDir(t);
  const { base } = await fixtureServer(t, { files: { '/a.jpg': A, '/b.jpg': B, '/c.jpg': C } });
  const store = await new ContentStore(dir).init();
  const v1 = project(base, { version: 1, files: { '/a.jpg': { buf: A }, '/b.jpg': { buf: B } } });
  const other = project(base, { slug: 'other', version: 1, files: { '/c.jpg': { buf: C } } });
  assert.equal((await agent(store, { projects: [v1, other] }).request()).ok, true);
  const v1Manifest = store.current.projects[v1.slug].manifest;

  const v2 = project(base, { version: 2, files: { '/a.jpg': { buf: A }, '/c.jpg': { buf: C } } });
  let switched = null;
  const sync = agent(store, { projects: [v2] });
  sync.on('switched', (e) => { switched = e; });
  const result = await sync.request();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.removed, ['other']);
  assert.deepEqual(switched.updated, [v2.slug]);

  const files = (await readdir(join(dir, 'content/files'))).sort();
  assert.deepEqual(files, [sha(A), sha(C)].sort(), 'B is unreferenced and collected; C is still used by v2');
  await assert.rejects(stat(join(dir, 'content', v1Manifest)), 'old manifest collected');
  const projectsDirs = await readdir(join(dir, 'content/projects'));
  assert.deepEqual(projectsDirs, [v2.slug]);
  assert.deepEqual(Object.keys(store.contentMap()), [v2.slug]);
  assert.deepEqual(await readdir(join(dir, 'content')).then((e) => e.filter((n) => n.includes('.tmp'))), []);

  // A fresh store instance (reboot) reads the switched state.
  const reopened = await new ContentStore(dir).init();
  assert.equal((await reopened.readProjectManifest(v2.slug)).version, 2);
});

test('insufficient free space fails before downloading and leaves content alone', async (t) => {
  const dir = await tempDir(t);
  const { base, requests } = await fixtureServer(t, { files: { '/a.jpg': A } });
  const store = await new ContentStore(dir).init();
  const p = project(base, { files: { '/a.jpg': { buf: A } } });
  const sync = agent(store, { projects: [p] }, { storage: async () => ({ free_bytes: 1000 }), minFreeBytes: 100 });
  const result = await sync.request();
  assert.equal(result.ok, false);
  assert.match(result.error, /not enough free space/);
  assert.equal(requests.length, 0);
  assert.ok(InsufficientSpaceError);
  assert.deepEqual(store.contentMap(), {});
});

test('download resumes a partial file with a Range request and verifies the whole hash', async (t) => {
  const dir = await tempDir(t);
  const { base, requests } = await fixtureServer(t, { files: { '/big.mp4': C } });
  const part = join(dir, 'x.part');
  const final = join(dir, 'x');
  await writeFile(part, C.subarray(0, 2500));
  let reported = 0;
  const r = await downloadFile({ url: `${base}/big.mp4`, partPath: part, finalPath: final, bytes: C.length, sha256: sha(C), onBytes: (n) => { reported += n; } });
  assert.equal(r.sha256, sha(C));
  assert.equal(requests[0].headers.range, 'bytes=2500-');
  assert.equal(reported, C.length - 2500);
  assert.deepEqual(await readFile(final), C);
});

test('download restarts from zero when the server ignores Range (200)', async (t) => {
  const dir = await tempDir(t);
  const { base } = await fixtureServer(t, { routes: { '/norange': (req, res) => { res.writeHead(200, { 'Content-Length': B.length }); res.end(B); } } });
  const part = join(dir, 'y.part');
  await writeFile(part, Buffer.from('garbage-garbage'));
  await downloadFile({ url: `${base}/norange`, partPath: part, finalPath: join(dir, 'y'), bytes: B.length, sha256: sha(B) });
  assert.deepEqual(await readFile(join(dir, 'y')), B);
});

test('manifest 404 reports manifest_unavailable and keeps existing content', async (t) => {
  const dir = await tempDir(t);
  const store = await new ContentStore(dir).init();
  const { ManifestUnavailableError } = await import('../src/api.js');
  const sync = new SyncAgent({ store, api: { manifest: async () => { throw new ManifestUnavailableError(404); } }, log: quiet });
  const result = await sync.request();
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.match(sync.status().error, /manifest_unavailable/);
});

test('prefill --from copies another box content dir and switches', async (t) => {
  const src = await tempDir(t);
  const dst = await tempDir(t);
  const { base } = await fixtureServer(t, { files: { '/a.jpg': A } });
  const srcStore = await new ContentStore(src).init();
  const p = project(base, { files: { '/a.jpg': { buf: A } } });
  assert.equal((await agent(srcStore, { projects: [p] }).request()).ok, true);
  const { prefill } = await import('../src/prefill.js');
  const code = await prefill(['--from', src, '--verify', '--data-dir', dst], quiet);
  assert.equal(code, 0);
  const dstStore = await new ContentStore(dst).init();
  assert.deepEqual(dstStore.contentMap(), srcStore.contentMap());
  assert.deepEqual(await readFile(dstStore.filePath(sha(A))), A);
});
