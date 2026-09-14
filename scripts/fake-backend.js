#!/usr/bin/env node
// Fake SHOWROOM-CONTRACT backend for local development and demos (tests use their own fixtures).
// Implements §1.3 register, §2.2 heartbeat + command ack, §5 tv manifest, a file host with Range,
// and a minimal /ws/cobrowse room relay, plus a small admin API to drive it:
//
//   node scripts/fake-backend.js [--port 9900] [--claimed] [--legacy] [--video film.mp4]
//   curl -XPOST localhost:9900/__admin/claim            # claim + assign the demo project
//   curl -XPOST localhost:9900/__admin/command -d '{"command":"identify"}'
//   curl -XPOST localhost:9900/__admin/bump             # new content version (box syncs within a heartbeat)
//   curl localhost:9900/__admin/state
//
// --legacy mimics today's preprod: register without a secret, heartbeat `{}`, manifest 401 without auth.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(here, '..', 'tv', 'public', 'demo', 'briq-skyline');
const geometry = JSON.parse(readFileSync(resolve(here, '..', 'tv', 'src', 'demo', 'geometry.json'), 'utf8'));

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '9900' },
    claimed: { type: 'boolean', default: false },
    legacy: { type: 'boolean', default: false },
    video: { type: 'string' },
    slug: { type: 'string', default: 'briq-skyline-9' },
    'no-render-pack': { type: 'boolean', default: false },
  },
});
const PORT = Number(args.port);
const SLUG = args.slug;
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- Generated media ------------------------------------------------------------------------

/** An equirectangular test panorama: sky, floor, and coloured wall panels every 45°. */
function panorama(hue, w = 2048, h = 1024) {
  const png = new PNG({ width: w, height: h });
  const hsl = (hh, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      const v = y / h;
      const panel = Math.floor((x / w) * 8);
      let c;
      if (v < 0.38) c = hsl(210, 0.35, 0.18 + v * 0.8);
      else if (v > 0.62) c = hsl(30, 0.25, 0.22 - (v - 0.62) * 0.3);
      else c = hsl((hue + panel * 18) % 360, 0.45, panel % 2 ? 0.42 : 0.5);
      if (Math.abs(v - 0.5) < 0.002 || (x % (w / 8)) < 3) c = [201, 164, 92];
      png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** A tiny landscape brochure, one titled page per entry (ASCII only). */
function brochure(titles) {
  const objects = [];
  const add = (o) => objects.push(o);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  titles.forEach((t, i) => {
    const text = `0.043 0.039 0.035 rg 0 0 842 595 re f 0.79 0.64 0.36 rg BT /F1 48 Tf 60 400 Td (${t}) Tj ET `
      + `0.95 0.93 0.89 rg BT /F1 20 Tf 60 350 Td (BriQ Skyline brochure - page ${i + 1} of ${titles.length}) Tj ET `
      + `0.79 0.64 0.36 RG 2 w 60 320 m 420 320 l S`;
    add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`);
    kids.push(objects.length);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const files = new Map(); // name -> {buf, mime}
const put = (name, buf) => files.set(name, { buf, mime: MIME[extname(name)] ?? 'application/octet-stream' });
for (const f of ['aerial.jpg', 'elevation-front.jpg', 'floor-plate.jpg', 'unit-3bhk.jpg', 'unit-3bhk-measured.jpg', 'unit-3bhk.glb']) put(f, readFileSync(resolve(DEMO, f)));
put('pano-living.png', panorama(20));
put('pano-master.png', panorama(140));
put('pano-balcony.png', panorama(260));
put('brochure.pdf', brochure(['BriQ Skyline', 'Residences', 'Amenities', 'Floor plans', 'Location']));
if (args.video) {
  statSync(args.video);
  put(`walkthrough${extname(args.video)}`, readFileSync(args.video));
}

// ---- State ----------------------------------------------------------------------------------

const state = {
  device: { id: 17, secret: null, claimed: args.claimed, name: args.claimed ? 'Lobby TV' : null, relay_key: args.claimed ? 'rk_dev' : null, pairing_code: '482913', project_slugs: args.claimed ? [SLUG] : [] },
  version: 1,
  commands: [],
  nextCommandId: 1,
  acks: [],
  lastHeartbeat: null,
};

function payload(base) {
  const u = (name) => `${base}/files/${name}`;
  const floors = 20;
  const units = [];
  let id = 1000;
  for (let f = 1; f <= floors; f++) {
    for (let p = 1; p <= 4; p++) {
      const n = (f * 7 + p * 13) % 10;
      units.push({
        id: id++, unit_no: `A-${f}${String(p).padStart(2, '0')}`, floor: f,
        bhk: p === 1 || p === 4 ? '3 BHK' : '2 BHK', facing: ['East', 'North', 'South', 'West'][p - 1],
        carpet_area: p === 1 || p === 4 ? '1450.00' : '1080.00',
        status: n < 6 ? 'available' : n < 8 ? 'hold' : 'sold',
        price: (p === 1 || p === 4 ? 14500000 : 10800000) + f * 90000,
      });
    }
  }
  const available = units.filter((x) => x.status === 'available').length;
  const elevRect = (floor, position) => {
    const e = geometry.elevation;
    const j = floor - e.firstFloor;
    const col = e.columns[position - 1];
    if (j < 0 || j >= e.count || !col) return null;
    const bottom = e.top + e.pitch * (e.count - j);
    const top = bottom - e.pitch;
    return [[col[0] + 3, top + 3], [col[1] - 3, top + 3], [col[1] - 3, bottom - 3], [col[0] + 3, bottom - 3]].map(([x, y]) => [Math.round(x), Math.round(y)]);
  };
  const renderPack = {
    aerial: { image: u('aerial.jpg'), size: geometry.aerial.size, towers: geometry.aerial.towers.map((t, i) => ({ tower_id: i === 0 ? 14 : null, placeholder: i === 0 ? undefined : 'Phase 2', points: t.points, label: t.label })) },
    elevations: { 14: { image: u('elevation-front.jpg'), size: geometry.elevation.size, units: Object.fromEntries(units.map((x) => [x.unit_no, elevRect(x.floor, Number(x.unit_no.slice(-2)))]).filter(([, r]) => r)) } },
    floor_plates: { 14: { image: u('floor-plate.jpg'), size: geometry.floorPlate.size, positions: Object.fromEntries(geometry.floorPlate.units.map((p) => [String(p.position), p.points])) } },
    units: { '3 BHK': { image: u('unit-3bhk.jpg'), measured_image: u('unit-3bhk-measured.jpg'), model: u('unit-3bhk.glb'), size: geometry.units['3 BHK'].size, rooms: geometry.units['3 BHK'].rooms } },
  };
  return {
    org: { name: 'BriQ Developers', logo_url: null, phone: '+91 98300 00000', tagline: 'Homes, composed' },
    slug: SLUG, visitor: null, name: 'BriQ Skyline', builder: 'BriQ Developers',
    location: 'New Town, Kolkata', address: 'Action Area II, New Town, Kolkata 700135',
    tagline: state.version > 1 ? `A skyline composed around you (v${state.version})` : 'A skyline composed around you.',
    description: 'Twenty storeys of 2 and 3 BHK residences above a landscaped deck, with a sky lounge, rooftop pool and a clubhouse facing the lake.',
    hero_image: u('aerial.jpg'),
    gallery: [u('aerial.jpg'), u('elevation-front.jpg'), u('floor-plate.jpg'), u('unit-3bhk.jpg'), u('unit-3bhk-measured.jpg'), u('pano-living.png')],
    amenities: ['Sky lounge', 'Rooftop pool', 'Clubhouse'], highlights: ['2 & 3 BHK', 'Lake views'],
    walkthrough_video: files.has('walkthrough.mp4') ? u('walkthrough.mp4') : files.has('walkthrough.webm') ? u('walkthrough.webm') : files.has('walkthrough.mov') ? u('walkthrough.mov') : undefined,
    brochure_url: u('brochure.pdf'),
    price_min: 10890000, price_max: 16300000,
    configs: [
      { bhk: '2 BHK', image: u('floor-plate.jpg'), min_carpet: 1080, max_carpet: 1080, min_price: 10890000, max_price: 12600000 },
      { bhk: '3 BHK', image: u('unit-3bhk.jpg'), min_carpet: 1450, max_carpet: 1450, min_price: 14590000, max_price: 16300000 },
    ],
    availability: { available, total: units.length },
    lat: 22.5958, lng: 88.4795,
    vicinity: [
      { name: 'Eco Park', category: 'leisure', lat: 22.6030, lng: 88.4665, distance: '1.6 km' },
      { name: 'City Centre 2', category: 'shopping', lat: 22.6205, lng: 88.4500 },
      { name: 'Tata Medical Center', category: 'healthcare', lat: 22.5745, lng: 88.4815 },
      { name: 'DLF IT Park', category: 'work', lat: 22.5850, lng: 88.4930 },
      { name: 'New Town Metro', category: 'transit', lat: 22.5990, lng: 88.4870, status: 'upcoming', eta: '2027', by: 'KMRC' },
      { name: 'Delhi Public School', category: 'education', lat: 22.6110, lng: 88.4760 },
    ],
    scenes: [
      { type: 'walkthrough', label: 'Interior', start: 'living', nodes: [
        { id: 'living', name: 'Living Room', url: u('pano-living.png'), links: [{ to: 'master', yaw: 90, pitch: -10 }, { to: 'balcony', yaw: -90, pitch: -10 }] },
        { id: 'master', name: 'Master Bedroom', url: u('pano-master.png'), links: [{ to: 'living', yaw: -90, pitch: -10 }] },
        { id: 'balcony', name: 'Balcony', url: u('pano-balcony.png'), links: [{ to: 'living', yaw: 90, pitch: -10 }] },
      ] },
    ],
    towers: [{ id: 14, name: 'Tower A', total_floors: floors, units, available, total: units.length }],
    modes: { theatre: true, remote: true },
    render_pack: args['no-render-pack'] ? null : renderPack,
  };
}

function manifestProject(base) {
  const p = payload(base);
  const referenced = new Set();
  const walk = (v) => { if (typeof v === 'string' && v.startsWith(`${base}/files/`)) referenced.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(p);
  const list = [...referenced].map((url) => {
    const name = url.slice(`${base}/files/`.length);
    const f = files.get(name);
    return { key: url, asset_id: `as_${name}`, variant: 'tv', kind: f.mime.split('/')[0], url, mime: f.mime, bytes: f.buf.length, sha256: sha(f.buf) };
  });
  const etag = `sha256:${sha(JSON.stringify({ payload: p, files: list }))}`;
  return { slug: SLUG, project_id: 5, version: state.version, etag, payload: p, files: list, total_bytes: list.reduce((a, f) => a + f.bytes, 0) };
}

// ---- HTTP -----------------------------------------------------------------------------------

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readJson = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString();
  try { return t ? JSON.parse(t) : {}; } catch { return {}; }
};
const authed = (req) => !!state.device.secret && req.headers.authorization === `Device ${state.device.id}:${state.device.secret}`;
const log = (...a) => console.log('[fake-backend]', ...a);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const base = `http://${req.headers.host}`;
  const path = url.pathname;
  let m;

  if (req.method === 'POST' && path === '/api/public/experience/devices/register') {
    const body = await readJson(req);
    if (args.legacy) return send(res, 200, { device_id: state.device.id, pairing_code: state.device.pairing_code, pairing_code_expires_at: null });
    const known = body.device_id === state.device.id && body.device_secret && body.device_secret === state.device.secret;
    let issued;
    if (!known) {
      issued = `brqd_${randomBytes(24).toString('base64url')}`;
      state.device.secret = issued;
      log(`register: issued secret for device ${state.device.id}`);
    }
    return send(res, 200, { device_id: state.device.id, device_secret: issued, pairing_code: state.device.claimed ? null : state.device.pairing_code, pairing_code_expires_at: state.device.claimed ? null : new Date(Date.now() + 600_000).toISOString(), claimed: state.device.claimed });
  }
  if (req.method === 'POST' && (m = /^\/api\/public\/experience\/devices\/(\d+)\/heartbeat$/.exec(path))) {
    const body = await readJson(req);
    state.lastHeartbeat = { at: new Date().toISOString(), body };
    if (args.legacy) return send(res, 200, {});
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
    const commands = state.commands.filter((c) => !c.delivered_at);
    for (const c of commands) c.delivered_at = new Date().toISOString();
    const proj = state.device.project_slugs.length ? manifestProject(base) : null;
    return send(res, 200, {
      claimed: state.device.claimed, pairing_code: state.device.claimed ? null : state.device.pairing_code, pairing_code_expires_at: null,
      name: state.device.name, relay_key: state.device.relay_key,
      projects: proj ? [{ slug: proj.slug, version: proj.version, etag: proj.etag }] : [],
      commands: commands.map(({ id, command, args: a }) => ({ id, command, args: a })),
    });
  }
  if (req.method === 'POST' && (m = /^\/api\/public\/experience\/devices\/(\d+)\/commands\/(\d+)\/ack$/.exec(path))) {
    const body = await readJson(req);
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
    const c = state.commands.find((x) => x.id === Number(m[2]));
    if (c) Object.assign(c, { completed_at: new Date().toISOString(), ok: body.ok, result: body.result });
    state.acks.push({ id: Number(m[2]), ...body });
    log(`ack ${m[2]} ok=${body.ok} ${JSON.stringify(body.result)}`);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'GET' && path === '/api/experience/manifest') {
    if (args.legacy) return send(res, 401, { error: 'Authentication required' }); // what preprod answers today
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
    const projects = state.device.project_slugs.length ? [manifestProject(base)] : [];
    return send(res, 200, { generated_at: new Date().toISOString(), device_class: url.searchParams.get('device_class'), projects });
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/files/')) {
    const f = files.get(decodeURIComponent(path.slice('/files/'.length)));
    if (!f) return send(res, 404, { error: 'no such file' });
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), f.buf.length - 1) : f.buf.length - 1;
      if (start >= f.buf.length) { res.writeHead(416, { 'Content-Range': `bytes */${f.buf.length}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': f.mime, 'Content-Range': `bytes ${start}-${end}/${f.buf.length}`, 'Content-Length': end - start + 1 });
      return res.end(req.method === 'HEAD' ? undefined : f.buf.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.buf.length, 'Accept-Ranges': 'bytes' });
    return res.end(req.method === 'HEAD' ? undefined : f.buf);
  }

  // Admin
  if (req.method === 'POST' && path === '/__admin/claim') {
    const body = await readJson(req);
    Object.assign(state.device, { claimed: true, name: body.name ?? 'Lobby TV', relay_key: body.relay_key ?? 'rk_dev', project_slugs: [SLUG] });
    log(`claimed as "${state.device.name}" relay_key=${state.device.relay_key}`);
    return send(res, 200, state.device);
  }
  if (req.method === 'POST' && path === '/__admin/unassign') {
    state.device.project_slugs = [];
    return send(res, 200, state.device);
  }
  if (req.method === 'POST' && path === '/__admin/command') {
    const body = await readJson(req);
    const c = { id: state.nextCommandId++, command: body.command, args: body.args ?? {}, created_at: new Date().toISOString() };
    state.commands.push(c);
    log(`queued command ${c.id} ${c.command}`);
    return send(res, 201, c);
  }
  if (req.method === 'POST' && path === '/__admin/bump') {
    state.version++;
    log(`content version → ${state.version}`);
    return send(res, 200, { version: state.version });
  }
  if (req.method === 'GET' && path === '/__admin/state') {
    return send(res, 200, { device: { ...state.device, secret: state.device.secret ? '(set)' : null }, version: state.version, commands: state.commands, acks: state.acks, lastHeartbeat: state.lastHeartbeat });
  }
  send(res, 404, { error: 'Not Found' });
});

// Minimal /ws/cobrowse: presenter frames go to the room's viewers.
const rooms = new Map();
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws/cobrowse') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const room = url.searchParams.get('session');
    const role = url.searchParams.get('role');
    if (!rooms.has(room)) rooms.set(room, new Set());
    const members = rooms.get(room);
    const me = { ws, role };
    members.add(me);
    ws.on('message', (buf) => {
      if (role !== 'presenter') return;
      for (const other of members) if (other.role === 'viewer' && other.ws.readyState === 1) other.ws.send(buf.toString());
    });
    ws.on('close', () => members.delete(me));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT} (${args.legacy ? 'LEGACY preprod mode' : 'contract mode'}, ${state.device.claimed ? 'claimed' : 'unclaimed'}, ${files.size} files)`);
});
