import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import test from 'node:test';
import WebSocket from 'ws';
import { ContentStore } from '../src/content/store.js';
import { LocalRelay } from '../src/relay.js';
import { LocalServer } from '../src/server.js';
import { isLoopbackAddress } from '../src/sysinfo.js';
import { quiet, tempDir } from './helpers.js';

async function setup(t, { key = 'rk_test', host = '127.0.0.1' } = {}) {
  const dir = await tempDir(t);
  const store = await new ContentStore(dir).init();
  let relayKey = key;
  const relay = new LocalRelay({ getRelayKey: () => relayKey, log: quiet });
  const server = new LocalServer({ store, relay, tvDir: dir, log: quiet });
  const port = await server.listen(0, host);
  t.after(() => server.close());
  return { port, relay, setKey: (k) => { relayKey = k; } };
}

function connect(url) {
  const ws = new WebSocket(url);
  const messages = [];
  const waiters = [];
  ws.on('message', (buf) => {
    messages.push(JSON.parse(buf.toString()));
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  const opened = new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const next = (n = 1) => new Promise((resolve) => {
    const check = () => (messages.length >= n ? resolve(messages) : waiters.push(check));
    check();
  });
  return { ws, messages, closed, opened, next };
}

test('isLoopbackAddress', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.40'), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test('presenter with a wrong or missing key is closed with 4401', async (t) => {
  const { port } = await setup(t);
  const wrong = connect(`ws://127.0.0.1:${port}/relay?role=presenter&key=nope`);
  assert.equal((await wrong.closed).code, 4401);
  const missing = connect(`ws://127.0.0.1:${port}/relay?role=presenter`);
  assert.equal((await missing.closed).code, 4401);
});

test('no relay key yet (unclaimed box): every presenter is rejected', async (t) => {
  const { port } = await setup(t, { key: null });
  const p = connect(`ws://127.0.0.1:${port}/relay?role=presenter&key=`);
  assert.equal((await p.closed).code, 4401);
});

test('bad role is closed with 4400', async (t) => {
  const { port } = await setup(t);
  const p = connect(`ws://127.0.0.1:${port}/relay?role=admin`);
  assert.equal((await p.closed).code, 4400);
});

test('presenter state reaches viewers; a late viewer gets the last command + last state replayed', async (t) => {
  const { port } = await setup(t);
  const viewer = connect(`ws://127.0.0.1:${port}/relay?role=viewer`);
  await viewer.opened;
  const presenter = connect(`ws://127.0.0.1:${port}/relay?role=presenter&key=rk_test`);
  await presenter.opened;
  const present = { cmd: 'present', slug: 'briq-skyline-9', lead: null };
  const s1 = { v: 2, slug: 'briq-skyline-9', chapter: 'renders', renders: { index: 1 } };
  const s2 = { v: 2, slug: 'briq-skyline-9', chapter: 'renders', renders: { index: 2 } };
  for (const state of [present, s1, s2]) presenter.ws.send(JSON.stringify({ t: 'state', state }));
  presenter.ws.send('not json');
  const got = await viewer.next(3);
  assert.deepEqual(got.map((m) => m.state), [present, s1, s2]);

  const late = connect(`ws://127.0.0.1:${port}/relay?role=viewer`);
  const replay = await late.next(2);
  assert.deepEqual(replay.map((m) => m.state), [present, s2]);

  // Presenters hear presence.
  assert.ok(presenter.messages.some((m) => m.t === 'presence' && m.viewers >= 1));

  // idle clears the kiosk state from the replay.
  presenter.ws.send(JSON.stringify({ t: 'state', state: { cmd: 'idle' } }));
  await viewer.next(4);
  const afterIdle = connect(`ws://127.0.0.1:${port}/relay?role=viewer`);
  const r2 = await afterIdle.next(1);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(r2.map((m) => m.state), [{ cmd: 'idle' }]);
  for (const c of [viewer, presenter, late, afterIdle]) c.ws.close();
});

test('viewers are local-only: a non-loopback viewer is closed with 4403', async (t) => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
  if (!lan) {
    t.skip('no non-loopback IPv4 interface on this machine');
    return;
  }
  const { port } = await setup(t, { host: '0.0.0.0' });
  const remote = connect(`ws://${lan.address}:${port}/relay?role=viewer`);
  assert.equal((await remote.closed).code, 4403);
  // …while a presenter with the key may come from the LAN.
  const presenter = connect(`ws://${lan.address}:${port}/relay?role=presenter&key=rk_test`);
  await presenter.opened;
  presenter.ws.close();
  // …and local events are refused from the LAN too.
  const events = new WebSocket(`ws://${lan.address}:${port}/local/events`);
  await new Promise((resolve) => events.on('error', resolve));
});

test('cloud bridge injection is forwarded to local viewers and replayed', async (t) => {
  const { port, relay } = await setup(t);
  relay.inject({ cmd: 'present', slug: 'x' }, 'cloud');
  const v = connect(`ws://127.0.0.1:${port}/relay?role=viewer`);
  const [m] = await v.next(1);
  assert.deepEqual(m, { t: 'state', state: { cmd: 'present', slug: 'x' } });
  relay.inject({ v: 2, slug: 'x', chapter: 'vr' }, 'cloud');
  const all = await v.next(2);
  assert.equal(all[1].state.chapter, 'vr');
  v.ws.close();
});

test('rotating the relay key kicks connected presenters', async (t) => {
  const { port, relay, setKey } = await setup(t);
  const p = connect(`ws://127.0.0.1:${port}/relay?role=presenter&key=rk_test`);
  await p.opened;
  setKey('rk_new');
  relay.kickPresenters();
  assert.equal((await p.closed).code, 4401);
});
