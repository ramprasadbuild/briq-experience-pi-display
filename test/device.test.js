import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ApiClient } from '../src/api.js';
import { ContentStore } from '../src/content/store.js';
import { SyncAgent } from '../src/content/sync.js';
import { DeviceAgent } from '../src/device.js';
import { IdentityStore } from '../src/identity.js';
import { fixtureServer, json, project, quiet, sha, tempDir } from './helpers.js';

const IMG = Buffer.from('img'.repeat(1000));

/** A fake contract backend: register issues a secret, heartbeat returns queued commands once. */
async function backend(t, { legacy = false } = {}) {
  const state = { commands: [], projects: [], acks: [], heartbeats: [], registers: [], manifestProjects: [], order: [] };
  const secret = 'brqd_secret';
  const authOk = (req) => req.headers.authorization === `Device 17:${secret}`;
  const fx = await fixtureServer(t, {
    files: { '/img.jpg': IMG },
    routes: {
      'POST /api/public/experience/devices/register': (req, res, body) => {
        state.registers.push(body);
        state.order.push('register');
        if (legacy) return json(res, 200, { device_id: 17, pairing_code: '482913', pairing_code_expires_at: null });
        const known = body?.device_id === 17 && body?.device_secret === secret;
        return json(res, 200, { device_id: 17, device_secret: known ? undefined : secret, pairing_code: '482913', pairing_code_expires_at: '2026-09-14T11:00:00Z', claimed: false });
      },
      'POST /api/public/experience/devices/17/heartbeat': (req, res, body) => {
        state.heartbeats.push({ body, auth: req.headers.authorization });
        state.order.push('heartbeat');
        if (legacy) return json(res, 200, {});
        if (!authOk(req)) return json(res, 401, { error: 'bad_secret' });
        const commands = state.commands.splice(0);
        return json(res, 200, { claimed: true, pairing_code: null, pairing_code_expires_at: null, name: 'Lobby TV', relay_key: 'rk_1', projects: state.projects, commands });
      },
      'GET /api/experience/manifest': (req, res) => {
        state.order.push('manifest');
        if (legacy) return json(res, 404, { error: 'not found' });
        if (!authOk(req)) return json(res, 401, {});
        return json(res, 200, { generated_at: 'now', device_class: 'tv', projects: state.manifestProjects });
      },
    },
  });
  fx.server.on('request', (req, res) => {
    const m = /^\/api\/public\/experience\/devices\/17\/commands\/(\d+)\/ack$/.exec(req.url);
    if (!m) return;
  });
  // Ack route (dynamic id).
  const origEmit = fx.server.emit.bind(fx.server);
  fx.server.emit = (event, req, res, ...rest) => {
    if (event === 'request') {
      const m = /^\/api\/public\/experience\/devices\/17\/commands\/(\d+)\/ack$/.exec(req.url);
      if (m) {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
          state.acks.push({ id: Number(m[1]), ...body, auth: req.headers.authorization });
          state.order.push(`ack:${m[1]}`);
          res.writeHead(authOk(req) ? 204 : 401);
          res.end();
        });
        return true;
      }
    }
    return origEmit(event, req, res, ...rest);
  };
  return { ...fx, state };
}

async function makeAgent(t, base, extra = {}) {
  const dir = await tempDir(t);
  const identity = new IdentityStore(dir);
  await identity.load();
  const store = await new ContentStore(dir).init();
  const api = new ApiClient({ baseUrl: base, identity });
  const sync = new SyncAgent({ store, api, backoffMs: 0, retries: 2, log: quiet });
  const kioskCalls = [];
  const kiosk = {
    restartBrowser: async (args) => { kioskCalls.push(['restart', args]); return { method: 'cdp_reload' }; },
    reboot: async () => { kioskCalls.push(['reboot']); },
  };
  const agent = new DeviceAgent({
    identity, api, store, sync, kiosk, dataDir: dir, appVersion: '0.2.0', port: 8787, log: quiet,
    lanAddresses: () => ['192.168.1.40'], storage: async () => ({ total_bytes: 100, free_bytes: 50 }),
    heartbeatMs: 1e9, rebootDelayMs: 10, ...extra,
  });
  return { dir, identity, store, sync, agent, kioskCalls };
}

test('register stores id + secret (0600); heartbeat sends Device auth and the §2.2 report', async (t) => {
  const be = await backend(t);
  const { dir, identity, agent } = await makeAgent(t, be.base);
  await agent.tick();
  assert.equal(identity.get().device_id, 17);
  assert.equal(identity.get().device_secret, 'brqd_secret');
  assert.equal((await stat(join(dir, 'device.json'))).mode & 0o777, 0o600);
  const hb = be.state.heartbeats.at(-1);
  assert.equal(hb.auth, 'Device 17:brqd_secret');
  assert.deepEqual(Object.keys(hb.body).sort(), ['app_version', 'content', 'lan_addresses', 'local_relay_port', 'storage', 'sync']);
  assert.deepEqual(hb.body.lan_addresses, ['192.168.1.40']);
  assert.equal(hb.body.local_relay_port, 8787);
  assert.deepEqual(hb.body.sync, { state: 'idle', progress: 1, error: null });
  assert.equal(identity.get().name, 'Lobby TV');
  assert.equal(identity.get().relay_key, 'rk_1');
  assert.equal(agent.status().claimed, true);
  assert.equal(agent.online, true);

  // A second register sends the stored secret back (same device).
  await agent.api.register();
  assert.deepEqual(be.state.registers.at(-1), { device_id: 17, device_secret: 'brqd_secret' });
  assert.equal(identity.get().device_secret, 'brqd_secret', 'secret not echoed → kept');
});

test('commands are run once and acked: identify, restart_browser, unknown, reboot (ack before reboot)', async (t) => {
  const be = await backend(t);
  const { agent, kioskCalls } = await makeAgent(t, be.base);
  const identifies = [];
  agent.on('identify', (e) => identifies.push(e));
  be.state.commands.push(
    { id: 1, command: 'identify', args: {} },
    { id: 2, command: 'restart_browser', args: {} },
    { id: 3, command: 'self_destruct', args: {} },
    { id: 4, command: 'reboot', args: {} },
  );
  await agent.tick();
  await agent.commandChain;
  // Re-delivery of the same id is ignored.
  await agent.processCommands([{ id: 1, command: 'identify', args: {} }]);
  await new Promise((r) => setTimeout(r, 50));

  assert.deepEqual(be.state.acks.map((a) => [a.id, a.ok]), [[1, true], [2, true], [3, false], [4, true]]);
  assert.equal(be.state.acks[0].auth, 'Device 17:brqd_secret');
  assert.deepEqual(be.state.acks[0].result, { seconds: 10 });
  assert.equal(be.state.acks[2].result.error, 'unknown_command');
  assert.equal(identifies.length, 1);
  assert.equal(identifies[0].name, 'Lobby TV');
  assert.deepEqual(kioskCalls, [['restart', {}], ['reboot']]);
});

test('sync command syncs and acks with the content map; heartbeat etag change triggers sync without a command', async (t) => {
  const be = await backend(t);
  const { agent, store } = await makeAgent(t, be.base);
  const p = project(be.base, { files: { '/img.jpg': { buf: IMG } } });
  be.state.manifestProjects = [p];
  be.state.commands.push({ id: 10, command: 'sync', args: {} });
  await agent.tick();
  await agent.commandChain;
  const ack = be.state.acks.find((a) => a.id === 10);
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.result.content, { [p.slug]: { version: 1, etag: p.etag } });
  assert.equal(await store.hasFile(sha(IMG), IMG.length), true);

  // Server bumps the version: heartbeat carries the new etag, the box syncs by itself.
  const p2 = project(be.base, { version: 2, files: { '/img.jpg': { buf: IMG } }, extra: { name: 'BriQ Skyline II' } });
  be.state.manifestProjects = [p2];
  be.state.projects = [{ slug: p2.slug, version: 2, etag: p2.etag }];
  await agent.tick();
  await agent.sync.running;
  assert.equal(store.contentMap()[p2.slug].etag, p2.etag);
  // Next heartbeat reports it.
  await agent.tick();
  assert.deepEqual(be.state.heartbeats.at(-1).body.content, { [p2.slug]: { version: 2, etag: p2.etag } });
});

test('unpair acks while authenticated, then wipes secret and content and re-registers', async (t) => {
  const be = await backend(t);
  const { agent, store, identity, dir } = await makeAgent(t, be.base);
  be.state.manifestProjects = [project(be.base, { files: { '/img.jpg': { buf: IMG } } })];
  await agent.tick();
  await agent.sync.request('seed');
  assert.equal(Object.keys(store.contentMap()).length, 1);

  be.state.commands.push({ id: 20, command: 'unpair', args: {} });
  const orderBefore = be.state.order.length;
  await agent.tick();
  await agent.commandChain;
  const ack = be.state.acks.find((a) => a.id === 20);
  assert.equal(ack.ok, true);
  assert.equal(ack.auth, 'Device 17:brqd_secret', 'ack sent with the old secret');
  const after = be.state.order.slice(orderBefore);
  assert.ok(after.indexOf('ack:20') < after.lastIndexOf('register'), `ack before re-register: ${after}`);
  assert.deepEqual(store.contentMap(), {});
  assert.equal(identity.get().relay_key, null);
  // Re-registered: without a secret the fake backend issues one again.
  assert.equal(identity.get().device_secret, 'brqd_secret');
  const saved = JSON.parse(await readFile(join(dir, 'device.json'), 'utf8'));
  assert.equal(saved.relay_key, null);
});

test('failed acks are persisted and retried on the next heartbeat', async (t) => {
  const be = await backend(t);
  const { agent } = await makeAgent(t, be.base);
  await agent.tick();
  let fail = true;
  const realAck = agent.api.ackCommand.bind(agent.api);
  agent.api.ackCommand = async (...args) => { if (fail) throw new Error('offline'); return realAck(...args); };
  await agent.processCommands([{ id: 30, command: 'identify', args: {} }]);
  assert.equal(agent.pendingAcks.length, 1);
  fail = false;
  await agent.tick();
  assert.equal(agent.pendingAcks.length, 0);
  assert.ok(be.state.acks.some((a) => a.id === 30 && a.ok));
});

test('legacy backend: register without secret, heartbeat {} → pairing refresh via register, manifest 404 → no content', async (t) => {
  const be = await backend(t, { legacy: true });
  const { agent, identity } = await makeAgent(t, be.base, { manifestPollMs: 0 });
  await agent.tick();
  await agent.sync.running;
  assert.equal(identity.get().device_id, 17);
  assert.equal(identity.get().device_secret, null);
  assert.equal(be.state.heartbeats[0].auth, undefined, 'no Authorization without a secret');
  assert.equal(agent.legacy, true);
  const status = agent.status();
  assert.equal(status.pairing_code, '482913');
  assert.equal(status.online, true);
  assert.equal(status.content_unavailable, true);
  assert.deepEqual(status.projects, []);
  assert.ok(be.state.order.filter((o) => o === 'register').length >= 2, 'register re-called for the pairing code');
  assert.ok(be.state.order.includes('manifest'));
});

test('offline: heartbeat failure marks the box offline and keeps going', async (t) => {
  const { agent } = await makeAgent(t, 'http://127.0.0.1:9');
  await agent.tick();
  assert.equal(agent.online, false);
  assert.ok(agent.status().last_error);
});
