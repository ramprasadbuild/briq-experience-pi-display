// The Inventory chapter's live 3D model: the project's towers on a site, built from the payload's
// towers[] and their units, with every flat a tappable cell coloured by its live status.
//
//   aerial  — the whole site; drag to turn it all the way round, tap a tower to fly in
//   tower   — one tower, the others ghosted; every flat shows its status; tap a flat to pick it
//   floor   — same view, shifted aside for the floor/unit panel; the picked flat is highlighted
//
// The towers and their site are either generated from the inventory (no art needed) or, when the
// host gives a model (`setModel(url)`), the builder's own .glb: its towers are matched to the
// inventory's in name order and each gets a skin of per-flat panels (model.js) for live status.
//
// One module, two hosts: the TV web app imports it (viewer: follows the tablet), and the tablet
// loads the same code as a classic-script bundle in a WebView (presenter: sends taps and the
// camera). Layout is deterministic, so both screens draw the identical model.
import * as THREE from 'three';
import { buildSkin, describeModel, loadModel } from './model.js';

const FH = 3.2;          // floor height (m)
const UW = 9.5;          // flat width along the facade
const DEPTH = 24;        // tower depth (two flats back to back)
const PODIUM_H = 7;

export const STATUS_COLORS = { available: '#2eb872', hold: '#e9a72b', blocked: '#4f83e6', booked: '#d9534f', sold: '#d9534f' };
const GLASS = ['#8eb4d2', '#7fa7c8', '#9bbfda', '#86aecd'];
const DIM = '#aab3bd';
const PICKED = '#ffd21f';
const WHITE = new THREE.Color('#ffffff');

/** Small seeded PRNG so the tablet and the TV scatter trees and neighbours identically. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * Time of day runs 05:00 → 21:00 (`tod` 0 → 1 on the wire, 15-minute steps). The sun stands where
 * it really would for the study date and the site's latitude (same approximation the sun-study
 * reference uses); what it and the sky look like comes from its height (LOOKS, by elevation°).
 */
export const SUN = { min: 300, max: 1260, step: 15 };
const RAD = Math.PI / 180;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const wrap360 = (d) => ((d % 360) + 360) % 360;
const pad2 = (n) => String(n).padStart(2, '0');
const clockText = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** The date a season button studies: today, or this year's solstices. */
export function studyDate(season) {
  const d = new Date(); const y = d.getFullYear();
  if (season === 'summer') return `${y}-06-21`;
  if (season === 'winter') return `${y}-12-21`;
  return `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Sun azimuth (° from north, clockwise) and elevation (°) at `minutes` local clock time. */
export function solar(date, minutes, geo) {
  const t = new Date(`${date}T00:00:00Z`);
  const n = Number.isNaN(t.getTime()) ? 172 : Math.max(1, Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 0)) / 864e5));
  const lat = Math.min(89.8, Math.max(-89.8, geo.lat)) * RAD;
  const decl = 23.44 * Math.sin((360 / 365) * (n - 81) * RAD) * RAD;
  const b = (360 / 364) * (n - 81) * RAD;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const ha = 15 * ((minutes + 4 * (geo.lon - 15 * geo.tz) + eot) / 60 - 12) * RAD;
  const el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
  return { azimuth: wrap360(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / RAD + 180), elevation: el / RAD };
}
const LOOKS = [
  { el: -10, amb: '#3d4b7a', sun: '#9db2ff', sunI: 0.4, hemi: '#5c6da3', hemiI: 0.38, top: '#060a1a', low: '#1a2748', exp: 0.95, glow: 1 },
  { el: -3, amb: '#6f6a94', sun: '#9db2ff', sunI: 0.04, hemi: '#9088ba', hemiI: 0.52, top: '#1c284f', low: '#9c6a68', exp: 0.98, glow: 0.75 },
  { el: -1, amb: '#8f7f9f', sun: '#ff8558', sunI: 0.3, hemi: '#b7a4cc', hemiI: 0.6, top: '#2f4170', low: '#e88f6c', exp: 1.0, glow: 0.45 },
  { el: 7, amb: '#ffd2a2', sun: '#ffb065', sunI: 2.0, hemi: '#ffdcb8', hemiI: 0.95, top: '#6f8fc4', low: '#ffcb98', exp: 1.05, glow: 0.05 },
  { el: 24, amb: '#fff4e6', sun: '#ffe7c4', sunI: 1.9, hemi: '#e6f0ff', hemiI: 1.35, top: '#6aa3dc', low: '#e6eff6', exp: 1.06, glow: 0 },
  { el: 50, amb: '#ffffff', sun: '#fff6e6', sunI: 2.2, hemi: '#e9f2ff', hemiI: 1.5, top: '#5d97d6', low: '#dcebf6', exp: 1.08, glow: 0 },
];
const MOON = new THREE.Vector3(0.38, 0.72, 0.58).normalize();
const SUN_PANEL_CSS = `
.bq-sun{position:absolute;right:16px;bottom:16px;width:268px;padding:14px;border:1px solid rgba(255,255,255,.14);border-radius:16px;color:#f3eee4;background:rgba(10,16,28,.88);box-shadow:0 14px 36px rgba(0,0,0,.45);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;transform-origin:100% 100%;transition:opacity .3s;-webkit-user-select:none;user-select:none;box-sizing:border-box}
.bq-sun *{box-sizing:border-box}
.bq-sun-seasons{display:flex;gap:4px;margin-bottom:8px}
.bq-sun-seasons button{flex:1;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:7px 8px;background:rgba(255,255,255,.04);color:#c7bfb1;font:inherit;font-size:11px}
.bq-sun-seasons button[aria-pressed=true]{background:rgba(201,164,92,.16);border-color:#c9a45c;color:#e2c483}
.bq-sun-date{margin:0 0 12px;color:#8a8276;font-size:10px}
.bq-sun-now{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.bq-sun-time{font-size:24px;font-weight:700;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.bq-sun-now p{margin:0;color:#c7bfb1;font-size:10px;font-weight:500;white-space:nowrap}
.bq-sun-motion{display:flex;align-items:stretch;gap:8px;margin-top:10px}
.bq-sun-path{flex:1 1 auto;min-width:0;padding:6px 8px 4px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
.bq-sun-path svg{display:block;width:100%;overflow:visible}
.bq-sun-path g{transition:transform .14s linear}
.bq-sun-ends{display:flex;justify-content:space-between;margin-top:1px;font-size:9px;font-weight:600;color:#8a8276}
.bq-sun-play{flex:0 0 62px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:0;border-radius:8px;color:#14100a;background:#c9a45c;font:inherit;font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.bq-sun-play.on{background:#e2c483}
.bq-sun-play svg{width:14px;height:14px}
.bq-sun-scrub{position:relative;height:18px;margin-top:10px}
.bq-sun-scrub i{position:absolute;left:0;top:7px;height:3px;border-radius:999px}
.bq-sun-scrub i.t{right:0;background:rgba(255,255,255,.16)}
.bq-sun-scrub i.f{background:#c9a45c}
.bq-sun-scrub i.k{top:2px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#e2c483;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.bq-sun-scrub input{position:absolute;left:-10px;right:-10px;top:-8px;width:calc(100% + 20px);height:34px;margin:0;-webkit-appearance:none;appearance:none;background:transparent}
.bq-sun-scrub input::-webkit-slider-thumb{-webkit-appearance:none;width:34px;height:34px;border-radius:50%;background:transparent}
.bq-sun-scrub input::-moz-range-thumb{width:34px;height:34px;border:0;border-radius:50%;background:transparent}
.bq-sun-scale{display:flex;justify-content:space-between;margin-top:4px;color:#8a8276;font-size:9px;font-weight:600}
`;
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>';

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Tilt limits, as the reference's orbit: polar 0.1π … 0.49π from straight up.
const clampPitch = (p) => Math.min(Math.PI * 0.4, Math.max(Math.PI * 0.01, p));

function gradientTexture(stops, size = 512, radial = false) {
  const c = document.createElement('canvas'); c.width = radial ? size : 4; c.height = size;
  const g = c.getContext('2d');
  const grd = radial ? g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2) : g.createLinearGradient(0, 0, 0, size);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Where each flat sits: floors bottom-up, flats in unit-number order, front row then back row. */
export function towerLayout(tower) {
  const byFloor = new Map();
  for (const u of tower.units || []) { if (!byFloor.has(u.floor)) byFloor.set(u.floor, []); byFloor.get(u.floor).push(u); }
  for (const us of byFloor.values()) us.sort((a, b) => String(a.unit_no).localeCompare(String(b.unit_no), undefined, { numeric: true }));
  const perFloor = Math.max(2, ...[...byFloor.values()].map((us) => us.length));
  const front = Math.ceil(perFloor / 2); const back = perFloor - front;
  const floors = Math.max(tower.total_floors || 0, ...byFloor.keys(), 1);
  const width = Math.max(front, back) * UW;
  /** Slot i on a floor → facade side and x offset. */
  const slot = (i) => (i < front
    ? { side: 1, x: -width / 2 + UW * (i + 0.5) * (width / (front * UW)), w: width / front }
    : { side: -1, x: width / 2 - (width / Math.max(back, 1)) * (i - front + 0.5), w: width / Math.max(back, 1) });
  return { byFloor, perFloor, front, back, floors, width, height: floors * FH, slot };
}

export function createScene(container, opts = {}) {
  const interactive = !!opts.interactive;
  const emit = opts.onEvent || (() => {});
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = opts.shadows !== false; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });

  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  container.appendChild(overlay);

  const scene = new THREE.Scene();
  const skyCanvas = document.createElement('canvas'); skyCanvas.width = 4; skyCanvas.height = 512;
  const sky = new THREE.CanvasTexture(skyCanvas); sky.colorSpace = THREE.SRGBColorSpace; scene.background = sky;
  scene.fog = new THREE.Fog('#dfeaf2', 500, 1900);
  const camera = new THREE.PerspectiveCamera(34, 1, 2, 4000);

  const hemi = new THREE.HemisphereLight('#e6f0ff', '#a3ad92', 1.45); scene.add(hemi);
  const fill = new THREE.DirectionalLight('#dfe9ff', 0.7); fill.position.set(-300, 220, -260); scene.add(fill);
  const sun = new THREE.DirectionalLight('#fff3dd', 1.9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  let world = null;      // everything built from the payload
  let model = null;      // { url, state: 'loading' | 'ready' | 'error', root, info } when the host supplies a .glb
  let site = null;       // model mode: { cx, cz, extent } of the mapped towers
  let rig = { cx: 0, cz: 0, dist: 600 }; // where the sun orbits
  let lamps = [];        // materials that light up at night (windows)
  let baked = [];        // unlit / self-lit art (the ground render): tinted by hand, since lights don't reach it
  const geo = { lat: 17.385, lon: 78.4867, tz: 5.5, ...(opts.geo || {}) }; // where the site is (default: Hyderabad)
  let tod = (840 - SUN.min) / (SUN.max - SUN.min); // opens at 14:00, as the reference does
  let todGoal = tod; let sunPlay = false; let playAcc = 0; let season = 'today'; let date = studyDate(season);
  // Off when the chapter opens (just the model): the sun study (panel + arc) and the availability colours on the aerial view.
  let sunOpen = false; let avail = false;

  // ---- compass ribbon + time of day (drawn here so the tablet and the TV show the same) -------
  const compass = document.createElement('div');
  Object.assign(compass.style, { position: 'absolute', top: '18px', left: '50%', width: '260px', marginLeft: '-130px', height: '34px', overflow: 'hidden', color: '#fff', font: '700 13px/34px system-ui, sans-serif', letterSpacing: '.08em', textShadow: '0 1px 4px rgba(0,0,0,.7)', maskImage: 'linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent)' });
  const ribbon = document.createElement('div');
  Object.assign(ribbon.style, { position: 'absolute', top: '0', left: '0', height: '34px', whiteSpace: 'nowrap', willChange: 'transform' });
  const STEP = 28; // px per 15°
  for (let i = -24; i < 48; i++) {
    const deg = ((i * 15) % 360 + 360) % 360; const mark = document.createElement('span');
    const name = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
    mark.textContent = name || '·';
    Object.assign(mark.style, { display: 'inline-block', width: `${STEP}px`, textAlign: 'center', opacity: name ? '1' : '.55', fontSize: name ? '14px' : '12px' });
    ribbon.appendChild(mark);
  }
  const needle = document.createElement('div');
  Object.assign(needle.style, { position: 'absolute', top: '54px', left: '50%', marginLeft: '-5px', width: '0', height: '0', borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '7px solid #fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' });
  compass.appendChild(ribbon);
  const hud = document.createElement('div'); Object.assign(hud.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  hud.append(compass, needle); container.appendChild(hud);

  // ---- sun study panel: season, clock, sun arc, play, scrubber (the presenter's is live) -----
  const css = document.createElement('style'); css.textContent = SUN_PANEL_CSS; container.appendChild(css);
  const panel = document.createElement('aside'); panel.className = 'bq-sun';
  panel.style.transform = `scale(${opts.hudScale || 1})`; panel.style.pointerEvents = interactive ? 'auto' : 'none';
  if (opts.panelBottom != null) panel.style.bottom = `${opts.panelBottom}px`;
  panel.innerHTML = `
    <div class="bq-sun-seasons">${[['today', 'Today'], ['summer', 'Summer'], ['winter', 'Winter']].map(([k, l]) => `<button type="button" data-season="${k}">${l}</button>`).join('')}</div>
    <p class="bq-sun-date"></p>
    <div class="bq-sun-now"><strong class="bq-sun-time"></strong><p class="bq-sun-az"></p></div>
    <div class="bq-sun-motion">
      <div class="bq-sun-path">
        <svg viewBox="0 0 200 78"><path d="M8 66 Q100 -4 192 66" fill="none" stroke="#c9a45c" stroke-width="1.5" stroke-dasharray="3 4" stroke-linecap="round" opacity="0.85"/><line x1="8" y1="66" x2="192" y2="66" stroke="rgba(255,255,255,.18)" stroke-width="1"/><g><circle r="9" fill="rgba(226,196,131,.22)" stroke="#c9a45c" stroke-width="1"/><circle r="4.6" fill="#e2c483"/></g></svg>
        <div class="bq-sun-ends"><span>E</span><span>W</span></div>
      </div>
      <button type="button" class="bq-sun-play"></button>
    </div>
    <div class="bq-sun-scrub"><i class="t"></i><i class="f"></i><i class="k"></i><input type="range" min="${SUN.min}" max="${SUN.max}" step="${SUN.step}"></div>
    <div class="bq-sun-scale"><span>05:00</span><span>12:00</span><span>21:00</span></div>`;
  container.appendChild(panel);
  const ui = {
    seasons: [...panel.querySelectorAll('[data-season]')], date: panel.querySelector('.bq-sun-date'), time: panel.querySelector('.bq-sun-time'), az: panel.querySelector('.bq-sun-az'),
    dot: panel.querySelector('svg g'), play: panel.querySelector('.bq-sun-play'), fill: panel.querySelector('i.f'), knob: panel.querySelector('i.k'), range: panel.querySelector('input'),
  };
  let panelKey = '';
  /** The panel shows where the day is heading (todGoal), in whole steps, even while the light eases there. */
  function drawPanel() {
    const minutes = SUN.min + Math.round((todGoal * (SUN.max - SUN.min)) / SUN.step) * SUN.step;
    const key = `${minutes}|${season}|${date}|${sunPlay}|${st.level}|${sunOpen}`;
    if (key === panelKey) return; panelKey = key;
    const s = solar(date, minutes, geo); const k = (minutes - SUN.min) / (SUN.max - SUN.min); const r = 1 - k;
    for (const b of ui.seasons) b.setAttribute('aria-pressed', String(b.dataset.season === season));
    ui.date.textContent = `${date} · Approximate solar simulation`;
    ui.time.textContent = clockText(minutes);
    ui.az.textContent = s.elevation > 0 ? `${COMPASS8[Math.round(s.azimuth / 45) % 8]} · ${s.azimuth.toFixed(0)}° azimuth` : 'Sun below the horizon';
    ui.dot.setAttribute('transform', `translate(${(r * r * 8 + 2 * r * k * 100 + k * k * 192).toFixed(2)} ${(r * r * 66 + 2 * r * k * -4 + k * k * 66).toFixed(2)})`);
    ui.dot.style.opacity = s.elevation > 0 ? '1' : '.35';
    ui.play.className = `bq-sun-play${sunPlay ? ' on' : ''}`; ui.play.innerHTML = `${sunPlay ? ICON_PAUSE : ICON_PLAY}<span>${sunPlay ? 'Pause' : 'Play day'}</span>`;
    ui.fill.style.width = `${(k * 100).toFixed(2)}%`; ui.knob.style.left = `${(k * 100).toFixed(2)}%`;
    if (Number(ui.range.value) !== minutes) ui.range.value = String(minutes);
    const show = interactive && sunOpen && st.level === 'aerial'; panel.style.opacity = show ? '1' : '0'; panel.style.visibility = show ? 'visible' : 'hidden';
  }

  // ---- the sun in the scene: its arc across the sky for the study date, a ground ring, a ray --
  const gizmo = new THREE.Group(); scene.add(gizmo);
  const gMat = new THREE.MeshBasicMaterial({ color: '#ffc35c', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const gArc = new THREE.Mesh(new THREE.BufferGeometry(), gMat); const gRing = new THREE.Mesh(new THREE.BufferGeometry(), gMat);
  const gRay = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 5), gMat);
  const gSun = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#fff4c2', transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  const glowTex = gradientTexture([[0, 'rgba(255,240,200,0.9)'], [0.35, 'rgba(255,205,120,0.35)'], [1, 'rgba(255,180,80,0)']], 192, true);
  const gGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  for (const o of [gArc, gRing, gRay]) o.renderOrder = 15;
  gGlow.renderOrder = 16; gSun.renderOrder = 17; gizmo.add(gArc, gRing, gRay, gGlow, gSun);
  let gizmoKey = '';
  const UP = new THREE.Vector3(0, 1, 0); const sunDir = new THREE.Vector3(); const gC = new THREE.Vector3(); const gP = new THREE.Vector3();
  const dirOf = (s, out) => out.set(Math.sin(s.azimuth * RAD) * Math.cos(s.elevation * RAD), Math.sin(s.elevation * RAD), -Math.cos(s.azimuth * RAD) * Math.cos(s.elevation * RAD));
  function drawGizmo(s) {
    const R = site ? site.extent * 0.52 : siteRadius * 0.8; // arc radius
    gC.set(site ? site.cx : 0, (site ? site.base : 0) + 2, site ? site.cz : 0);
    const key = `${date}|${R.toFixed(1)}|${gC.x.toFixed(1)}|${gC.y.toFixed(1)}|${gC.z.toFixed(1)}`;
    if (key !== gizmoKey) {
      gizmoKey = key; const pts = []; const d = new THREE.Vector3();
      for (let m = 0; m <= 1440; m += 5) { const p = solar(date, m, geo); if (p.elevation >= 0) pts.push(dirOf(p, d).clone().multiplyScalar(R).add(gC)); }
      gArc.geometry.dispose(); gArc.geometry = pts.length > 1 ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 128, R * 0.0045, 6, false) : new THREE.BufferGeometry();
      const ring = Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * R, 0, Math.sin((i / 128) * Math.PI * 2) * R).add(gC));
      gRing.geometry.dispose(); gRing.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 128, R * 0.0035, 6, true);
    }
    const up = s.elevation > 0;
    gRay.visible = gSun.visible = gGlow.visible = up;
    if (up) {
      dirOf(s, gP).multiplyScalar(R);
      gRay.position.copy(gC).addScaledVector(gP, 0.5); gRay.scale.set(R * 0.003, R, R * 0.003); gRay.quaternion.setFromUnitVectors(UP, gP.normalize());
      gSun.position.copy(gC).addScaledVector(gP, R); gSun.scale.setScalar(R * 0.025);
      gGlow.position.copy(gSun.position); gGlow.scale.set(R * 0.18, R * 0.18, 1);
    }
    gizmo.visible = sunOpen && st.level === 'aerial';
  }

  const cA = new THREE.Color(); const cB = new THREE.Color();
  const mix = (a, b, k) => `#${cA.set(a).lerp(cB.set(b), k).getHexString()}`;
  /** Light the scene for a time of day: the sun (or, after dark, the moon), sky, haze, window glow. */
  function applyTod(t) {
    const s = solar(date, SUN.min + clamp01(t) * (SUN.max - SUN.min), geo); const e = s.elevation;
    let i = 0; while (i < LOOKS.length - 2 && e > LOOKS[i + 1].el) i++;
    const a = LOOKS[i]; const b = LOOKS[i + 1]; const k = clamp01((e - a.el) / (b.el - a.el));
    const num = (key) => a[key] + (b[key] - a[key]) * k;
    dirOf(s, sunDir);
    if (e > -3) { sunDir.y = Math.max(sunDir.y, 0.04); sunDir.normalize(); } else sunDir.copy(MOON);
    sun.position.set(rig.cx + sunDir.x * rig.dist, sunDir.y * rig.dist, rig.cz + sunDir.z * rig.dist);
    sun.color.set(mix(a.sun, b.sun, k)); sun.intensity = num('sunI');
    hemi.color.set(mix(a.hemi, b.hemi, k)); hemi.intensity = num('hemiI'); fill.intensity = 0.7 * Math.min(1, num('hemiI'));
    const top = mix(a.top, b.top, k); const low = mix(a.low, b.low, k);
    const g = skyCanvas.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, top); grd.addColorStop(0.5, mix(top, low, 0.55)); grd.addColorStop(0.64, low); grd.addColorStop(1, low);
    g.fillStyle = grd; g.fillRect(0, 0, 4, 512); sky.needsUpdate = true;
    scene.fog.color.set(low); renderer.toneMappingExposure = num('exp');
    const glow = num('glow');
    for (const m of lamps) m.emissiveIntensity = glow * (m.userData.lamp || 0.5);
    const amb = cA.set(a.amb).lerp(cB.set(b.amb), k).clone();
    for (const m of baked) { m.color.copy(m.userData.base).multiply(amb); if (m.userData.baseGlow != null) m.emissiveIntensity = m.userData.baseGlow * (0.2126 * amb.r + 0.7152 * amb.g + 0.0722 * amb.b); }
    drawGizmo(s); drawPanel();
    renderer.shadowMap.needsUpdate = true; dirty = true;
  }
  let towers = [];       // [{ tower, layout, group, cells, ghost, mats, pos, rot, pin }]
  let data = null;
  let disposed = false;

  // ---- state the hosts drive ----------------------------------------------------------------
  const st = { level: 'aerial', towerId: null, unitNo: null, floor: null, cfg: null, statuses: null, shiftX: 0 };
  // Camera: what it is now, and what it is easing towards.
  const cam = { yaw: 0.62, pitch: 0.5, radius: 600, tx: 0, ty: 40, tz: 0, shift: 0, zoom: 1 };
  const goal = { ...cam };
  let pendYaw = 0; let pendPitch = 0; let dirty = true; let siteRadius = 200; let maxH = 100;

  /** Model mode: the builder's .glb is the site; inventory towers are matched onto its towers. */
  function buildModel(payload) {
    if (world) scene.remove(world);
    overlay.textContent = '';
    data = payload; world = new THREE.Group(); scene.add(world); towers = [];
    world.add(model.root);
    model.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Buildings glow from their own facade texture after dark; the ground does not.
    lamps = []; baked = [];
    for (const p of model.info.parts) {
      p.node.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          if (lamps.includes(m) || baked.includes(m)) continue;
          const selfLit = m.isMeshBasicMaterial || (m.emissiveMap && m.emissiveIntensity > 0);
          if (p.flat || selfLit) { m.userData.base = m.userData.base || m.color.clone(); if (m.emissiveMap) m.userData.baseGlow = m.userData.baseGlow ?? m.emissiveIntensity; baked.push(m); }
          else if (m.emissive) { m.emissive.set('#ffcf8f'); m.emissiveMap = m.map || null; m.userData.lamp = m.map ? 0.55 : 0.05; m.needsUpdate = true; lamps.push(m); }
        }
      });
    }
    const { parts, towers: slots } = model.info;
    for (const p of parts) p.node.visible = true;
    const list = (payload?.towers || []).filter((t) => t);
    const box = new THREE.Box3();
    list.forEach((tower, i) => {
      const part = slots[i];
      if (!part) return; // more inventory towers than the model has: the extras have nowhere to stand
      const L = towerLayout(tower);
      const { mesh: skin, cells, faceUnit } = buildSkin(part, L);
      world.add(skin);
      const pad = new THREE.Vector3(6, 6, 6);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(part.center); world.add(hit);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(part.size.x + pad.x, part.size.y + pad.y, part.size.z + pad.z), new THREE.MeshBasicMaterial({ color: '#35d07f', transparent: true, opacity: 0, depthWrite: false }));
      shell.position.copy(part.center); world.add(shell);
      const pin = document.createElement('div');
      pin.textContent = tower.name || `Tower ${i + 1}`;
      Object.assign(pin.style, { position: 'absolute', transform: 'translate(-50%, -100%)', padding: '7px 14px', borderRadius: '999px', background: 'rgba(12,20,34,.78)', color: '#fff', font: '700 13px/1 system-ui, sans-serif', letterSpacing: '.04em', whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,.28)', boxShadow: '0 6px 18px rgba(0,0,0,.3)', transition: 'opacity .35s', willChange: 'transform' });
      overlay.appendChild(pin);
      box.union(part.box);
      towers.push({ tower, L, model: true, part, skin, live: cells, faceUnit, hit, shell, pin, pos: part.center.clone(), top: part.box.max.y, height: part.size.y, baseY: part.box.min.y, fade: 1, glow: 0, lit: 0 });
    });
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const sz = box.isEmpty() ? new THREE.Vector3(300, 100, 300) : box.getSize(new THREE.Vector3());
    site = { cx: c.x, cz: c.z, extent: Math.max(sz.x, sz.z, 260), top: box.isEmpty() ? 100 : box.max.y, base: box.isEmpty() ? 0 : box.min.y };
    camera.far = 40000; camera.updateProjectionMatrix();
    scene.fog.near = 2500; scene.fog.far = 14000;
    const reach = site.extent * 1.6 + 300;
    sun.position.set(c.x + reach * 0.9, site.top * 2.2 + 260, c.z + reach * 0.75); sun.target.position.set(c.x, 0, c.z);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: reach * 5 });
    sun.shadow.camera.updateProjectionMatrix();
    rig = { cx: c.x, cz: c.z, dist: reach * 1.5 + site.top * 2 };
    applyTod(tod);
    veil(); paint(); aim(true); dirty = true;
  }

  /** Model mode, tower level: the towers crowding the one in focus step aside so it can be seen all round. */
  function veil() {
    if (!model || model.state !== 'ready') return;
    const f = st.level === 'aerial' ? null : focus();
    for (const p of model.info.towers) {
      const near = f && p !== f.part && Math.hypot(p.center.x - f.pos.x, p.center.z - f.pos.z) < f.height * 2.4;
      if (p.node.visible === !!near) { p.node.visible = !near; renderer.shadowMap.needsUpdate = true; dirty = true; }
    }
  }

  function build(payload) {
    if (model && model.state === 'loading') { data = payload; return; }
    if (model && model.state === 'ready') { buildModel(payload); return; }
    if (world) { scene.remove(world); world.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); }); }
    overlay.textContent = '';
    data = payload; world = new THREE.Group(); scene.add(world); towers = [];
    const list = (payload?.towers || []).filter((t) => t);
    const layouts = list.map(towerLayout);
    const n = list.length;
    const pitch = Math.max(...layouts.map((l) => l.width), UW * 2) + 26;
    maxH = Math.max(...layouts.map((l) => l.height), 30) + PODIUM_H;
    const rand = rng(20261112);

    // Towers stand on a shallow arc, each turned a little towards the middle of the site.
    list.forEach((tower, i) => {
      const L = layouts[i];
      const k = i - (n - 1) / 2;
      const pos = new THREE.Vector3(k * pitch, 0, -Math.abs(k) * Math.abs(k) * 9);
      const rot = -k * 0.16;
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = rot; world.add(g);
      const mats = {
        body: new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.85 }),
        cell: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.28, metalness: 0.15 }),
        ghost: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.15 }),
        trim: new THREE.MeshStandardMaterial({ color: '#c9a36a', roughness: 0.5, metalness: 0.35 }),
      };
      // Status colours have to read the same on the sunny and the shaded side, so on the tower
      // level each live flat also glows with its own colour (uGlow eases 0 → 1 on the way in).
      mats.cell.userData.glow = { value: 0 };
      mats.cell.onBeforeCompile = (sh) => {
        sh.uniforms.uGlow = mats.cell.userData.glow;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n  diffuseColor.rgb *= 1.0 - 0.45 * uGlow; totalEmissiveRadiance += vColor.rgb * 0.62 * uGlow;\n#endif');
      };
      const add = (geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m; };
      add(new THREE.BoxGeometry(L.width + 16, PODIUM_H, DEPTH + 18), mats.body, 0, PODIUM_H / 2, 0);
      add(new THREE.BoxGeometry(L.width - 1.2, L.height, DEPTH - 1.2), mats.body, 0, PODIUM_H + L.height / 2, 0);
      add(new THREE.BoxGeometry(L.width + 2.4, 1.1, DEPTH + 2.4), mats.trim, 0, PODIUM_H + L.height + 0.55, 0);
      add(new THREE.BoxGeometry(L.width * 0.45, 4.2, DEPTH * 0.45), mats.body, 0, PODIUM_H + L.height + 3.2, 0);
      // Vertical fins at the corners and between flats give the facade its grid.
      const finGeo = new THREE.BoxGeometry(0.7, L.height, 1.4);
      for (const side of [1, -1]) {
        const cols = side === 1 ? L.front : Math.max(L.back, 1);
        for (let c = 0; c <= cols; c++) add(finGeo, mats.body, -L.width / 2 + (L.width / cols) * c, PODIUM_H + L.height / 2, side * (DEPTH / 2 + 0.5), false);
      }

      // Flats that exist in the inventory are live cells; the rest of the grid is plain glazing.
      const cellGeo = new THREE.BoxGeometry(1, 1, 1);
      const live = []; const ghosts = [];
      for (let f = 1; f <= L.floors; f++) {
        const us = L.byFloor.get(f) || [];
        for (let i2 = 0; i2 < L.perFloor; i2++) (us[i2] ? live : ghosts).push({ f, i: i2, unit: us[i2] || null });
      }
      const place = (mesh, arr) => {
        const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const p = new THREE.Vector3(); const s = new THREE.Vector3();
        arr.forEach((c, idx) => {
          const sl = L.slot(c.i);
          p.set(sl.x, PODIUM_H + (c.f - 0.5) * FH, sl.side * (DEPTH / 4 + 0.45));
          s.set(sl.w - 1.1, FH - 0.5, DEPTH / 2 + 0.9);
          mesh.setMatrixAt(idx, m4.compose(p, q, s));
        });
        mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      };
      const cells = new THREE.InstancedMesh(cellGeo, mats.cell, Math.max(live.length, 1)); cells.count = live.length; place(cells, live);
      const ghost = new THREE.InstancedMesh(cellGeo, mats.ghost, Math.max(ghosts.length, 1)); ghost.count = ghosts.length; place(ghost, ghosts);
      const c3 = new THREE.Color();
      ghosts.forEach((c, idx) => ghost.setColorAt(idx, c3.set(GLASS[(c.f * 7 + c.i * 3) % GLASS.length])));
      if (ghost.instanceColor) ghost.instanceColor.needsUpdate = true;

      // One box to hit-test the whole tower with, and the frame that marks the picked floor.
      const hit = new THREE.Mesh(new THREE.BoxGeometry(L.width + 4, L.height + PODIUM_H + 6, DEPTH + 4), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = (L.height + PODIUM_H + 6) / 2; g.add(hit);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(L.width + 3.2, L.height + 2, DEPTH + 3.6), new THREE.MeshBasicMaterial({ color: '#35d07f', transparent: true, opacity: 0, depthWrite: false }));
      shell.position.y = PODIUM_H + L.height / 2; g.add(shell);
      const ring = new THREE.Mesh(new THREE.BoxGeometry(L.width + 2.6, FH - 0.2, DEPTH + 3), new THREE.MeshBasicMaterial({ color: PICKED, transparent: true, opacity: 0, depthWrite: false }));
      g.add(ring);

      const pin = document.createElement('div');
      pin.textContent = tower.name || `Tower ${i + 1}`;
      Object.assign(pin.style, { position: 'absolute', transform: 'translate(-50%, -100%)', padding: '7px 14px', borderRadius: '999px', background: 'rgba(12,20,34,.78)', color: '#fff', font: '700 13px/1 system-ui, sans-serif', letterSpacing: '.04em', whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,.28)', boxShadow: '0 6px 18px rgba(0,0,0,.3)', transition: 'opacity .35s', willChange: 'transform' });
      overlay.appendChild(pin);
      towers.push({ tower, L, g, cells, ghost, live, mats, hit, shell, ring, pin, pos, rot, fade: 1, glow: 0, lit: 0 });
    });

    // ---- the site around them ------------------------------------------------------------
    const span = Math.max((n - 1) * pitch + (layouts[0]?.width || 40), 80);
    siteRadius = span / 2 + 70;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2600, 64), new THREE.MeshStandardMaterial({ map: gradientTexture([[0, '#8fb873'], [0.25, '#86ad6c'], [0.6, '#9bb97f'], [1, '#cfdccb']], 512, true), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
    const flat = (geo, color, y, rough = 0.95) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough })); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; world.add(m); return m; };
    flat(new THREE.CircleGeometry(siteRadius, 72), '#e9e4d8', 0.12).scale.set(1, 0.72, 1);                // paved plot
    flat(new THREE.RingGeometry(siteRadius + 14, siteRadius + 30, 96), '#6f7680', 0.1).scale.set(1, 0.72, 1); // ring road
    flat(new THREE.PlaneGeometry(18, 900), '#6f7680', 0.09).position.set(siteRadius * 0.55, 0.09, siteRadius * 0.72 + 440);
    const lawn = flat(new THREE.CircleGeometry(siteRadius * 0.42, 48), '#7fb069', 0.2); lawn.scale.set(1.5, 0.42, 1); lawn.position.z = DEPTH + 46;
    const pool = flat(new THREE.CircleGeometry(15, 40), '#4fb3d9', 0.3, 0.2); pool.scale.set(1.9, 0.7, 1); pool.position.set(-siteRadius * 0.2, 0.3, DEPTH + 44);

    // Trees: inside the plot's edge and scattered beyond the road.
    const treeGeo = new THREE.IcosahedronGeometry(1, 1);
    const treeN = 260; const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }), treeN);
    const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const p = new THREE.Vector3(); const s = new THREE.Vector3(); const col = new THREE.Color();
    for (let i = 0; i < treeN; i++) {
      const inner = i < 90; const a = rand() * Math.PI * 2;
      const r = inner ? siteRadius * (0.86 + rand() * 0.1) : siteRadius + 44 + rand() * 520;
      const x = Math.cos(a) * r; let z = Math.sin(a) * r * (inner ? 0.72 : 0.85);
      if (inner && Math.abs(x) < span / 2 + 20 && z < DEPTH && z > -DEPTH * 3) z = DEPTH + 20 + rand() * 30;
      const h = 5 + rand() * 6; p.set(x, h * 0.85, z); s.set(h * 0.75, h, h * 0.75);
      trees.setMatrixAt(i, m4.compose(p, q, s)); trees.setColorAt(i, col.setHSL(0.27 + rand() * 0.06, 0.42, 0.3 + rand() * 0.12));
    }
    trees.castShadow = true; trees.receiveShadow = true; world.add(trees);

    // The neighbourhood: pale blocks out past the road, so the towers read against a city.
    const hoodN = 150; const hood = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), hoodN);
    for (let i = 0; i < hoodN; i++) {
      const a = rand() * Math.PI * 2; const r = siteRadius + 110 + rand() * 900;
      const w = 16 + rand() * 30; const d = 16 + rand() * 30; const h = 9 + rand() * rand() * 70;
      p.set(Math.cos(a) * r, h / 2, Math.sin(a) * r * 0.9); s.set(w, h, d); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * 0.6);
      hood.setMatrixAt(i, m4.compose(p, q, s)); hood.setColorAt(i, col.setHSL(0.09 + rand() * 0.05, 0.14, 0.82 + rand() * 0.1));
    }
    hood.castShadow = true; hood.receiveShadow = true; world.add(hood);

    const reach = siteRadius + 60;
    sun.position.set(reach * 0.9, maxH * 1.9 + 140, reach * 0.75); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -reach * 1.3, right: reach * 1.3, top: reach * 1.3, bottom: -reach * 1.3, near: 10, far: maxH * 4 + reach * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    rig = { cx: 0, cz: 0, dist: reach * 1.6 + maxH * 2 };
    baked = [];
    lamps = towers.map((t) => { const m = t.mats.ghost; m.emissive.set('#ffd28a'); m.userData.lamp = 0.4; return m; });
    applyTod(tod);
    paint(); aim(true); dirty = true;
  }

  const focus = () => towers.find((t) => t.tower.id === st.towerId) || towers[0];

  /** Colour every flat for the current level, filters and selection. */
  function paint() {
    const c = new THREE.Color();
    const f = focus();
    for (const t of towers) {
      const inTower = st.level !== 'aerial' && t === f;
      if (t.model) {
        const colors = t.skin.geometry.attributes.color;
        for (const cell of t.live) {
          const u = cell.unit;
          if (u.unit_no === st.unitNo) c.set(PICKED);
          else if ((st.cfg && u.bhk !== st.cfg) || (st.statuses && !st.statuses.includes(u.status))) c.set(DIM);
          else { c.set(STATUS_COLORS[u.status] || STATUS_COLORS.blocked); if (st.floor != null && cell.f === st.floor) c.lerp(WHITE, 0.35); }
          for (let k = cell.v0; k < cell.v1; k++) colors.setXYZ(k, c.r, c.g, c.b);
        }
        colors.needsUpdate = true;
        continue;
      }
      t.live.forEach((cell, idx) => {
        const u = cell.unit;
        if (!inTower) c.set(GLASS[(cell.f * 7 + cell.i * 3) % GLASS.length]);
        else if (u.unit_no === st.unitNo) c.set(PICKED);
        else if ((st.cfg && u.bhk !== st.cfg) || (st.statuses && !st.statuses.includes(u.status))) c.set(DIM);
        else c.set(STATUS_COLORS[u.status] || STATUS_COLORS.blocked);
        t.cells.setColorAt(idx, c);
      });
      if (t.cells.instanceColor) t.cells.instanceColor.needsUpdate = true;
      const showRing = inTower && st.floor != null;
      t.ring.material.opacity = showRing ? 0.32 : 0;
      if (showRing) t.ring.position.y = PODIUM_H + (st.floor - 0.5) * FH;
    }
    dirty = true;
  }

  /** Point the camera goal at the site or at the tower in focus. */
  function aim(snap = false) {
    const fov = (camera.fov * Math.PI) / 180;
    const f = focus();
    if (site && (st.level === 'aerial' || !f)) {
      Object.assign(goal, { tx: site.cx, ty: site.top * 0.3, tz: site.cz, pitch: 0.55, radius: (site.extent * 0.95 + site.top * 0.6) / Math.tan(fov / 2), shift: 0 });
    } else if (f && f.model) {
      Object.assign(goal, { tx: f.pos.x, ty: f.baseY + f.height * 0.5, tz: f.pos.z, pitch: 0.2, radius: (f.height * 0.7) / Math.tan(fov / 2), shift: st.shiftX || 0 });
    } else if (st.level === 'aerial' || !f) {
      Object.assign(goal, { tx: 0, ty: maxH * 0.32, tz: 0, pitch: 0.5, radius: (siteRadius * 1.25 + maxH * 0.55) / Math.tan(fov / 2) * 0.62, shift: 0 });
    } else {
      const h = f.L.height + PODIUM_H;
      Object.assign(goal, { tx: f.pos.x, ty: h * 0.5, tz: f.pos.z, pitch: 0.16, radius: (h * 0.66) / Math.tan(fov / 2), shift: st.shiftX || 0 });
    }
    if (snap) Object.assign(cam, goal, { yaw: cam.yaw, zoom: cam.zoom });
    dirty = true;
  }

  function resize() {
    const w = container.clientWidth || 1; const h = container.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  const v3 = new THREE.Vector3();
  function frame(now) {
    if (disposed) return;
    requestAnimationFrame(frame);
    const dt = Math.min((now - (frame.last || now)) / 1000, 0.05); frame.last = now;
    // The presenter's drag is spread over the next frames (orbit-controls damping, factor 0.08 a
    // frame at 60 fps); viewers ease towards the angle they are sent.
    if (interactive) {
      if (Math.abs(pendYaw) > 1e-5 || Math.abs(pendPitch) > 1e-5) {
        const k = 1 - Math.pow(1 - 0.08, dt * 60);
        cam.yaw += pendYaw * k; pendYaw *= 1 - k; goal.yaw = cam.yaw;
        if (Math.abs(pendPitch) > 1e-5) { cam.pitch = clampPitch(cam.pitch + pendPitch * k); pendPitch *= 1 - k; goal.pitch = cam.pitch; }
        dirty = true;
      }
    } else { const d = wrapPi(goal.yaw - cam.yaw); if (Math.abs(d) > 0.0005) { cam.yaw += d * (1 - Math.exp(-9 * dt)); dirty = true; } }
    for (const k of ['pitch', 'radius', 'tx', 'ty', 'tz', 'shift', 'zoom']) {
      const next = damp(cam[k], goal[k], k === 'zoom' ? 10 : 3.4, dt);
      if (Math.abs(next - cam[k]) > 1e-4) { cam[k] = next; dirty = true; }
    }
    // Time of day: "play day" steps 15 minutes every quarter second (05:00 → 21:00 in 16 s); the light eases after it.
    if (sunPlay) {
      playAcc += dt;
      while (sunPlay && playAcc >= 0.25) { playAcc -= 0.25; todGoal = Math.min(1, todGoal + SUN.step / (SUN.max - SUN.min)); if (todGoal >= 1) { sunPlay = false; emit({ t: 'sun', playing: false }); } reportCam(true); drawPanel(); }
    }
    if (Math.abs(todGoal - tod) > 0.0008) { tod = damp(tod, todGoal, 7, dt); applyTod(tod); }
    const f = focus();
    for (const t of towers) {
      if (t.model) {
        const glow = st.level === 'aerial' && t.tower.id === hoverId ? 0.3 : 0;
        if (Math.abs(glow - t.glow) > 0.004) { t.glow = damp(t.glow, glow, 8, dt); t.shell.material.opacity = t.glow; dirty = true; }
        const lit = (st.level === 'aerial' ? avail : t === f) ? 1 : 0;
        if (Math.abs(lit - t.lit) > 0.004) { t.lit = damp(t.lit, lit, 3, dt); t.skin.material.opacity = 0.8 * t.lit; t.skin.visible = t.lit > 0.01; dirty = true; }
        continue;
      }
      const wantFade = st.level === 'aerial' || t === f ? 1 : 0.07;
      const wantGlow = st.level === 'aerial' && t.tower.id === hoverId ? 0.34 : 0;
      if (Math.abs(wantFade - t.fade) > 0.004 || Math.abs(wantGlow - t.glow) > 0.004) {
        t.fade = damp(t.fade, wantFade, 4, dt); t.glow = damp(t.glow, wantGlow, 8, dt); dirty = true;
        const clear = t.fade < 0.995;
        for (const m of Object.values(t.mats)) { if (m.transparent !== clear) { m.transparent = clear; m.needsUpdate = true; } m.opacity = t.fade; m.depthWrite = t.fade > 0.5; }
        t.g.traverse((o) => { if (o.isMesh && o !== t.hit) o.castShadow = t.fade > 0.5; });
        renderer.shadowMap.needsUpdate = true;
        t.shell.material.opacity = t.glow;
      }
      const wantLit = st.level !== 'aerial' && t === f ? 1 : 0;
      if (Math.abs(wantLit - t.lit) > 0.004) { t.lit = damp(t.lit, wantLit, 3, dt); t.mats.cell.userData.glow.value = t.lit; dirty = true; }
    }
    if (!dirty) return;
    dirty = false;
    const r = cam.radius / cam.zoom;
    camera.position.set(cam.tx + Math.sin(cam.yaw) * Math.cos(cam.pitch) * r, cam.ty + Math.sin(cam.pitch) * r, cam.tz + Math.cos(cam.yaw) * Math.cos(cam.pitch) * r);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    const w = renderer.domElement.width; const h = renderer.domElement.height;
    if (Math.abs(cam.shift) > 0.001) camera.setViewOffset(w, h, cam.shift * w, 0, w, h); else camera.clearViewOffset();
    renderer.render(scene, camera);
    // Compass: north is the model's -Z; the ribbon slides so the heading we face sits under the needle.
    const heading = ((((-cam.yaw * 180) / Math.PI) % 360) + 360) % 360;
    ribbon.style.transform = `translateX(${130 - (24 + heading / 15) * STEP - STEP / 2}px)`;
    // Tower name pins ride above each tower on the aerial view.
    const cw = container.clientWidth; const ch = container.clientHeight;
    for (const t of towers) {
      v3.set(t.pos.x, (t.model ? t.top : t.L.height + PODIUM_H) + 12, t.pos.z).project(camera);
      t.pin.style.opacity = st.level === 'aerial' && v3.z < 1 ? '1' : '0';
      t.pin.style.left = `${(v3.x * 0.5 + 0.5) * cw}px`; t.pin.style.top = `${(-v3.y * 0.5 + 0.5) * ch}px`;
    }
  }
  requestAnimationFrame(frame);

  // ---- presenter input: drag to turn, pinch / wheel to zoom, tap to pick ---------------------
  let dragging = false; let hoverId = null; let lastCamSent = 0;
  const reportCam = (force) => { const now = performance.now(); if (!force && now - lastCamSent < 60) return; lastCamSent = now; emit({ t: 'cam', yaw: +wrapPi(cam.yaw + pendYaw).toFixed(4), pitch: +clampPitch(goal.pitch + pendPitch).toFixed(4), zoom: +goal.zoom.toFixed(3), tod: +todGoal.toFixed(4), season, date, sun: sunOpen, avail }); };
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function pick(x, y) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
    const f = focus();
    if (st.level !== 'aerial' && f && f.model) {
      const hitFace = ray.intersectObject(f.skin, false)[0];
      if (hitFace && hitFace.faceIndex != null) return { unit: f.live[f.faceUnit[hitFace.faceIndex]].unit, tower: f.tower };
    } else if (st.level !== 'aerial' && f) {
      const hitCell = ray.intersectObject(f.cells, false)[0];
      if (hitCell && hitCell.instanceId != null) return { unit: f.live[hitCell.instanceId].unit, tower: f.tower };
    }
    const hits = ray.intersectObjects(towers.map((t) => t.hit), false);
    const t = hits[0] && towers.find((x) => x.hit === hits[0].object);
    return t ? { tower: t.tower } : null;
  }
  if (interactive) {
    // Same feel as three's OrbitControls on the reference: one full turn per screen-height of drag,
    // left/right orbits, up/down tilts (between just above the ground and nearly overhead), no pan.
    const el = renderer.domElement; const pts = new Map(); let moved = 0; let lastX = 0; let lastY = 0; let pinch0 = 0; let zoom0 = 1;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, e); moved = 0; lastX = e.clientX; lastY = e.clientY; dragging = true; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); zoom0 = goal.zoom; } });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) { if (e.pointerType === 'mouse') { const h = pick(e.clientX, e.clientY); const id = h && !h.unit && st.level === 'aerial' ? h.tower.id : null; if (id !== hoverId) { hoverId = id; dirty = true; el.style.cursor = id != null ? 'pointer' : 'grab'; } } return; }
      pts.set(e.pointerId, e);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); goal.zoom = Math.min(2.4, Math.max(0.4, zoom0 * (d / (pinch0 || d)))); moved = 99; reportCam(); return; }
      const dx = e.clientX - lastX; const dy = e.clientY - lastY; moved += Math.hypot(dx, dy);
      lastX = e.clientX; lastY = e.clientY;
      if (moved < 6) return;
      const turn = (2 * Math.PI) / (el.clientHeight || 600);
      pendYaw -= dx * turn; pendPitch += dy * turn;
      // Never queue more tilt than the limits allow, or the model would feel stuck when the drag reverses.
      pendPitch = clampPitch(cam.pitch + pendPitch) - cam.pitch;
      el.style.cursor = 'grabbing'; dirty = true; reportCam();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size) return; dragging = false; el.style.cursor = 'grab';
      if (moved < 6) { const h = pick(e.clientX, e.clientY); if (h?.unit) emit({ t: 'unit', unit_no: h.unit.unit_no, floor: h.unit.floor, tower_id: h.tower.id }); else if (h?.tower) emit({ t: 'tower', tower_id: h.tower.id }); else emit({ t: 'miss' }); }
      else reportCam(true);
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); goal.zoom = Math.min(2.4, Math.max(0.4, goal.zoom * (e.deltaY > 0 ? 0.95 : 1 / 0.95))); reportCam(); }, { passive: false });
    el.style.cursor = 'grab';

    // The sun panel is the presenter's: season, play / pause, and the 05:00 → 21:00 scrubber.
    for (const b of ui.seasons) b.addEventListener('click', () => api.setSeason(b.dataset.season));
    ui.play.addEventListener('click', () => api.playSun(!sunPlay));
    ui.range.addEventListener('input', () => api.setTod((Number(ui.range.value) - SUN.min) / (SUN.max - SUN.min)));
  }

  const drawGizmoNow = () => { applyTod(tod); };
  const lastIn = {}; // viewer: the camera last received, so a stale repeat doesn't undo a fly-in
  const api = {
    setData(payload) { build(payload); },
    /** Use the builder's own .glb as the site (falls back to the generated towers if it won't load). */
    setModel(url) {
      if (!url || (model && model.url === url)) return;
      const mine = { url, state: 'loading', root: null, info: null }; model = mine;
      emit({ t: 'model', state: 'loading' });
      loadModel(url).then((root) => {
        if (disposed || model !== mine) return;
        mine.root = root; mine.info = describeModel(root); mine.state = 'ready';
        emit({ t: 'model', state: 'ready', towers: mine.info.towers.map((p) => p.name) });
        if (data) build(data);
      }).catch((e) => {
        if (model !== mine) return;
        mine.state = 'error'; model = null; site = null;
        emit({ t: 'model', state: 'error', message: String(e?.message || e) });
        if (data) build(data);
      });
    },
    /** level, towerId, unitNo (picked flat), floor, cfg (type filter), statuses (filter), shiftX, yaw, zoom. */
    setState(next) {
      const prevLevel = st.level; const prevTower = st.towerId; const prevShift = st.shiftX; const prevUnit = st.unitNo;
      for (const k of ['level', 'towerId', 'unitNo', 'floor', 'cfg', 'statuses', 'shiftX']) if (k in next) st[k] = next[k];
      if (typeof next.hudBottom === 'number') panel.style.bottom = `${next.hudBottom}px`;
      const moved = st.level !== prevLevel || st.towerId !== prevTower || st.shiftX !== prevShift;
      if (moved) { if (st.level !== prevLevel) goal.zoom = 1; pendPitch = 0; veil(); aim(); }
      if (!interactive || next.forceCam) {
        const fresh = (k) => typeof next[k] === 'number' && (next.forceCam || lastIn[k] !== next[k]) && ((lastIn[k] = next[k]), true);
        if (fresh('yaw')) goal.yaw = next.yaw;
        if (fresh('pitch')) goal.pitch = clampPitch(next.pitch);
        if (fresh('zoom')) goal.zoom = next.zoom;
        if (typeof next.tod === 'number' && !next.forceCam) todGoal = clamp01(next.tod);
        if (!next.forceCam) { if (typeof next.sun === 'boolean') sunOpen = next.sun; if (typeof next.avail === 'boolean' && next.avail !== avail) { avail = next.avail; dirty = true; } }
        // The study date comes from the presenter, so both screens agree even if their clocks differ.
        const day = /^\d{4}-\d{2}-\d{2}$/.test(next.date || '') ? next.date : null;
        if (!next.forceCam && ((next.season && next.season !== season) || (day && day !== date))) { if (next.season) season = next.season; date = day || studyDate(season); applyTod(tod); }
        if (next.forceCam) { cam.yaw = goal.yaw; reportCam(true); }
      } else {
        // Presenter: the tower swings round so the picked flat faces the camera.
        if (st.level !== 'aerial' && st.unitNo && st.unitNo !== prevUnit) {
          const f = focus(); const cell = f && f.model ? f.live.find((c) => c.unit.unit_no === st.unitNo) : null;
          if (cell) { pendYaw = wrapPi(Math.atan2(cell.mx - f.pos.x, cell.mz - f.pos.z) - cam.yaw); dirty = true; reportCam(true); }
        }
        if (moved) reportCam(true);
      }
      gizmo.visible = sunOpen && st.level === 'aerial';
      drawPanel(); dirty = true;
      if (towers.length) paint();
    },
    zoomBy(f) { goal.zoom = Math.min(2.4, Math.max(0.4, goal.zoom * f)); reportCam(true); dirty = true; },
    /** Presenter: jump to a time of day (0 = 05:00 … 1 = 21:00); stops the play. */
    setTod(v) { if (sunPlay) { sunPlay = false; emit({ t: 'sun', playing: false }); } todGoal = clamp01(Number(v) || 0); drawPanel(); reportCam(true); dirty = true; },
    /** Presenter: open the sun study (panel + the sun's arc) and play the day, or close it. */
    setSunStudy(on) { sunOpen = !!on; todGoal = sunOpen ? 0 : (840 - SUN.min) / (SUN.max - SUN.min); api.playSun(sunOpen); drawGizmoNow(); },
    /** Presenter: colour every tower's flats by live status on the aerial view. */
    setAvail(on) { avail = !!on; dirty = true; reportCam(true); },
    /** Presenter: study today's date or a solstice. */
    setSeason(v) { if (!['today', 'summer', 'winter'].includes(v) || v === season) return; if (sunPlay) { sunPlay = false; emit({ t: 'sun', playing: false }); } season = v; date = studyDate(v); applyTod(tod); reportCam(true); },
    /** Presenter: play the day through to 21:00 from where it stands (from 05:00 if it is over), or pause. */
    playSun(on = true) { sunPlay = !!on; playAcc = 0; if (sunPlay && todGoal >= 1) { todGoal = 0; } emit({ t: 'sun', playing: sunPlay }); drawPanel(); reportCam(true); dirty = true; },
    getCam: () => ({ yaw: wrapPi(cam.yaw), pitch: goal.pitch, zoom: goal.zoom, tod: todGoal, season }),
    dispose() { disposed = true; ro.disconnect(); renderer.dispose(); container.textContent = ''; },
  };
  return api;
}
