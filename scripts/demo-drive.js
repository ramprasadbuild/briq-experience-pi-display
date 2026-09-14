#!/usr/bin/env node
// End-to-end demo against a running daemon (dev) + scripts/fake-backend.js + a Chromium started
// with --remote-debugging-port on the TV app. Acts as the tablet over the LAN relay, walks every
// chapter, checks the rendered DOM through CDP and saves screenshots.
//
//   node scripts/demo-drive.js --out ./shots [--box http://127.0.0.1:8787] [--backend http://127.0.0.1:9900] [--key rk_dev]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import CDP from 'chrome-remote-interface';
import WebSocket from 'ws';

const { values: o } = parseArgs({
  options: {
    out: { type: 'string', default: './shots' },
    box: { type: 'string', default: 'http://127.0.0.1:8787' },
    backend: { type: 'string', default: 'http://127.0.0.1:9900' },
    key: { type: 'string', default: 'rk_dev' },
    cdp: { type: 'string', default: '9222' },
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[drive]', ...a);
const getJson = async (url, init) => (await fetch(url, init)).json();
const status = () => getJson(`${o.box}/local/status.json`);
async function waitFor(what, fn, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(300);
  }
}

await mkdir(o.out, { recursive: true });
const targets = await CDP.List({ port: Number(o.cdp) });
const page = targets.find((t) => t.type === 'page' && t.url.includes('/tv/')) ?? targets.find((t) => t.type === 'page');
const client = await CDP({ port: Number(o.cdp), target: page });
await client.Page.enable();
await client.Runtime.enable();
client.Runtime.consoleAPICalled(({ type, args }) => { if (type === 'error') log('console.error:', args.map((a) => a.value ?? a.description).join(' ')); });
client.Runtime.exceptionThrown(({ exceptionDetails }) => log('page exception:', exceptionDetails.exception?.description ?? exceptionDetails.text));
await client.Emulation.setDeviceMetricsOverride({ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expr) => (await client.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const text = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
const shot = async (name) => {
  const { data } = await client.Page.captureScreenshot({ format: 'jpeg', quality: 72 });
  await writeFile(join(o.out, `${name}.jpg`), Buffer.from(data, 'base64'));
  log(`screenshot ${name}.jpg`);
};

// 1. Idle, unclaimed.
// Always (re)load so the page runs the latest build.
await client.Page.navigate({ url: `${o.box}/tv/` });
await sleep(1500);
let st = await waitFor('pairing code', async () => { const s = await status(); return s.pairing_code || s.claimed ? s : null; });
log('status:', JSON.stringify({ device_id: st.device_id, claimed: st.claimed, pairing_code: st.pairing_code, has_secret: st.has_secret, online: st.online, legacy_backend: st.legacy_backend, sync: st.sync, projects: st.projects.length }));
await waitFor('idle code on screen', () => evaluate(`!!document.querySelector('.idle-code, .idle-name')`));
log('idle screen text:', await text('.idle-left'), '|', await text('.idle-state-title'));
await shot('01-idle-unclaimed');

// Presenter before claim: no relay key yet → 4401.
// The relay completes the WebSocket handshake and then closes with 4401 for a bad key, so wait
// briefly after 'open' before calling a presenter accepted.
const tryPresenter = (key) => new Promise((resolve) => {
  const ws = new WebSocket(`${o.box.replace('http', 'ws')}/relay?role=presenter&key=${key}`);
  let timer = null;
  ws.on('open', () => { timer = setTimeout(() => resolve({ open: true, ws }), 400); });
  ws.on('close', (code) => { clearTimeout(timer); resolve({ open: false, code }); });
  ws.on('error', () => {});
});
if (!st.claimed) log('presenter before claim:', JSON.stringify(await tryPresenter(o.key).then((r) => ({ open: r.open, code: r.code }))));

// 2. Claim → the heartbeat brings relay_key + projects → sync.
if (!st.claimed) await getJson(`${o.backend}/__admin/claim`, { method: 'POST', body: '{"name":"Lobby TV"}' });
const seen = new Set();
st = await waitFor('synced content', async () => {
  const s = await status();
  const k = `${s.sync.state}:${Math.floor(s.sync.progress * 10)}`;
  if (!seen.has(k)) { seen.add(k); log('sync', JSON.stringify(s.sync)); }
  return s.claimed && s.projects.length && s.sync.state === 'idle' ? s : null;
}, 120_000);
log('projects on box:', JSON.stringify(st.projects.map((p) => ({ slug: p.slug, version: p.version, etag: p.etag.slice(0, 20) }))));
await sleep(800);
log('idle (claimed) text:', await text('.idle-name'), '|', await text('.idle-project-name'));
await shot('02-idle-claimed');

const bad = await tryPresenter('wrong-key');
log('presenter with wrong key:', JSON.stringify({ open: bad.open, code: bad.code }));
const { ws: presenter } = await tryPresenter(o.key);
const send = (state) => presenter.send(JSON.stringify({ t: 'state', state }));
const slug = st.projects[0].slug;

// 3. Present + each chapter.
send({ cmd: 'present', slug, lead: null });
await waitFor('home', () => evaluate(`!!document.querySelector('.home-brand')`));
const base = { v: 2, slug };
send({ ...base, chapter: 'home', home: { index: 1, paused: false } });
await sleep(1500);
log('home: highlighted card =', await text('.home-card.on .home-card-name'), '| orb =', await text('.orb-name'));
await shot('03-home');

const steps = [
  ['04-renders', { chapter: 'renders', renders: { index: 3, playing: true, zoom: 1.4, pan_x: 0.05, pan_y: 0 } }, `document.querySelector('.rn-counter')?.textContent`],
  ['05-inventory-aerial', { chapter: 'inventory', inventory: { level: 'aerial', tower_id: 14 } }, `document.querySelectorAll('.hs-svg polygon').length + ' shapes; ' + document.querySelector('.inv-crumb.on')?.textContent`],
  ['06-inventory-tower-tip', { chapter: 'inventory', inventory: { level: 'tower', tower_id: 14, tip_unit_no: 'A-903', cfg: null } }, `document.querySelectorAll('.hs-svg polygon').length + ' unit shapes; selected=' + document.querySelectorAll('polygon.hs-selected').length + '; tip=' + document.querySelector('.inv-tip-title')?.textContent`],
  ['07-inventory-floor', { chapter: 'inventory', inventory: { level: 'floor', tower_id: 14, floor: 9, tip_unit_no: 'A-903' } }, `document.querySelectorAll('.hs-pin').length + ' pins; crumb=' + document.querySelector('.inv-crumb.on')?.textContent`],
  ['08-inventory-unit-sqm', { chapter: 'inventory', inventory: { level: 'unit', tower_id: 14, floor: 9, unit_no: 'A-904', tip_unit_no: null, unit_mode: 'sqm', compare: ['A-904', 'A-1201'] } }, `document.querySelector('.inv-seg-item.on')?.textContent + '; compare cols=' + document.querySelectorAll('.inv-compare th').length`],
  ['09-inventory-unit-3d', { chapter: 'inventory', inventory: { level: 'unit', unit_no: 'A-904', unit_mode: '3d', model_cam: { theta: 120, phi: 50, radius: null, spin: false, labels: true } } }, `document.querySelector('model-viewer')?.getAttribute('camera-orbit') + '; loaded=' + (document.querySelector('model-viewer')?.loaded)`],
  ['10-brochure', { chapter: 'brochure', brochure: { page: 3, zoom: 1 } }, `document.querySelector('.br-bar .counter')?.textContent + '; canvas=' + !!document.querySelector('.br-holder canvas')`],
  ['11-vr', { chapter: 'vr', vr: { scene_idx: 0, node_id: 'master', cam: { yaw: 1.2, pitch: -0.05, zoom: 30 } } }, `document.querySelector('.vr-room .pill span')?.textContent + '; canvas=' + !!document.querySelector('.vr canvas')`],
  ['12-walkthrough', { chapter: 'walkthrough', walkthrough: { playing: true, time: 3, rate: 1, muted: true, at: Date.now() } }, `(() => { const v = document.querySelector('video'); return v ? 'video t=' + v.currentTime.toFixed(2) + ' paused=' + v.paused + ' readyState=' + v.readyState : document.querySelector('.empty-title')?.textContent; })()`],
  ['13-location', { chapter: 'location', location: { poi: 1, is_3d: false, measuring: false, map_cam: null } }, `document.querySelector('.loc-row.on .loc-row-name')?.textContent + '; ' + document.querySelector('.loc-readout')?.textContent`],
];
for (const [name, state, probe] of steps) {
  if (state.walkthrough) state.walkthrough.at = Date.now();
  send({ ...base, ...state });
  await sleep(name.includes('3d') || name.includes('vr') || name.includes('brochure') ? 4000 : 1800);
  log(`${name}:`, await evaluate(probe));
  await shot(name);
  if (name === '12-walkthrough' && await evaluate(`!!document.querySelector('video')`)) {
    const vt = `(() => { const v = document.querySelector('video'); return 't=' + v.currentTime.toFixed(2) + ' paused=' + v.paused + ' ' + v.videoWidth + 'x' + v.videoHeight; })()`;
    send({ ...base, chapter: 'walkthrough', walkthrough: { playing: true, time: 8, rate: 1, muted: true, at: Date.now() } });
    await sleep(1500);
    log('walkthrough: sender jumped to 8 s, 1.5 s later →', await evaluate(vt));
    send({ ...base, chapter: 'walkthrough', walkthrough: { playing: false, time: 5, rate: 1, muted: true, at: Date.now() } });
    await sleep(800);
    log('walkthrough: sender paused at 5 s →', await evaluate(vt));
  }
}

// 4. Reload the TV page: the relay replays present + last state.
send({ ...base, chapter: 'inventory', inventory: { level: 'floor', tower_id: 14, floor: 12, unit_no: null, tip_unit_no: 'A-1202', unit_mode: 'standard', compare: [] } });
await sleep(800);
await client.Page.reload({ ignoreCache: true });
await sleep(2500);
log('after reload (replay):', await text('.inv-crumb.on'));
await shot('14-after-reload-replay');

// 5. Server commands through the heartbeat: identify, then a content bump.
await getJson(`${o.backend}/__admin/command`, { method: 'POST', body: '{"command":"identify"}' });
await waitFor('identify overlay', () => evaluate(`!!document.querySelector('.identify')`), 20_000);
log('identify overlay:', await text('.identify-name'));
await shot('15-identify');

const v1 = (await status()).projects[0].version;
await getJson(`${o.backend}/__admin/bump`, { method: 'POST' });
await getJson(`${o.backend}/__admin/command`, { method: 'POST', body: '{"command":"sync"}' });
const after = await waitFor('new version', async () => { const s = await status(); return s.projects[0]?.version > v1 && s.sync.state === 'idle' ? s : null; }, 60_000);
log(`content version ${v1} → ${after.projects[0].version}`);
const acks = (await getJson(`${o.backend}/__admin/state`)).acks;
log('acks at backend:', JSON.stringify(acks));

// 6. Idle.
send({ cmd: 'idle' });
await waitFor('idle', () => evaluate(`!!document.querySelector('.idle')`));
await sleep(600);
await shot('16-idle-again');
presenter.close();
await client.close();
log('done');
process.exit(0);
