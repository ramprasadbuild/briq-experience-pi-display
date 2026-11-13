// The Master Plan chapter's 3D township: the builder's site model (.glb) as a model the presenter
// can turn, zoom and tour. Buildings are grouped into zones (a sector's towers, the villas, the
// clubhouse …) by the host's `zones` list; a zone can be picked by tapping one of its buildings or
// its pin, which lights it, dims the rest and flies the camera to it.
//
// One module, two hosts. The tablet (presenter) loads it as a classic-script bundle in a WebView
// (scripts/build-masterplan-bundle.mjs writes it into the controller app): the presenter drags,
// taps, and the scene reports picks and the camera through onEvent. The TV imports it directly as
// a viewer (`interactive: false`): it takes no input and eases towards whatever camera the tablet
// sends (`applyCam`), so both screens show the same model from the same place.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** What the sun, the sky and the haze look like in each mood. `dir` points from the site to the sun. */
const LOOKS = {
  day: { zenith: '#5d9fdc', horizon: '#cfe0ea', sun: '#fff1d6', sunI: 2.5, hemiSky: '#dcecff', hemiGround: '#93a37d', hemiI: 1.45, dir: [-0.38, 0.62, 0.68] },
  evening: { zenith: '#5b7fb4', horizon: '#f3cfa4', sun: '#ffb46a', sunI: 2.9, hemiSky: '#cfd6f2', hemiGround: '#8f7d68', hemiI: 1.1, dir: [-0.78, 0.3, 0.55] },
};
const RAIN_LOOK = { zenith: '#77858f', horizon: '#b9c3c8', sunMul: 0.3, hemiMul: 1.2 };

const GOLD = new THREE.Color('#ffc65a');
const APRON = '#4f8a26';   // the grass around a painted site plan
const DIM = 0.5;          // how far unselected zones are pulled towards grey while one is picked
const TAP_PX = 9;         // a touch that moved less than this is a tap, not a drag
const TAP_MS = 450;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function loadModel(url, onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => loader.load(url, (g) => resolve(g.scene), onProgress, reject));
}

/**
 * Bakes a set of meshes into one geometry in world space, material colours as vertex colours, so
 * a zone of dozens of buildings (hundreds of small meshes) draws in one call.
 */
function bake(meshes, withUv) {
  let vCount = 0; let iCount = 0;
  for (const { mesh } of meshes) {
    const g = mesh.geometry;
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3); const nor = new Float32Array(vCount * 3); const col = new Float32Array(vCount * 3);
  const uv = withUv ? new Float32Array(vCount * 2) : null;
  const idx = new Uint32Array(iCount);
  const v = new THREE.Vector3(); const nm = new THREE.Matrix3();
  let vo = 0; let io = 0;
  for (const { mesh, color } of meshes) {
    const g = mesh.geometry; const p = g.attributes.position; const n = g.attributes.normal; const t = g.attributes.uv;
    nm.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (n) { v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); } else v.set(0, 1, 0);
      nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
      col[(vo + i) * 3] = color.r; col[(vo + i) * 3 + 1] = color.g; col[(vo + i) * 3 + 2] = color.b;
      if (uv) { uv[(vo + i) * 2] = t ? t.getX(i) : 0; uv[(vo + i) * 2 + 1] = t ? t.getY(i) : 0; }
    }
    if (g.index) { const a = g.index; for (let i = 0; i < a.count; i++) idx[io + i] = a.getX(i) + vo; io += a.count; } else { for (let i = 0; i < p.count; i++) idx[io + i] = vo + i; io += p.count; }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

/**
 * The orbit angle from which a painted plan reads upright when seen from straight above: the plan
 * may lie turned in the model, so this follows the picture's own up (decreasing v) on the ground.
 */
function pictureUp(g) {
  const m = pictureMap(g);
  return m ? Math.atan2(m.dv.x, m.dv.z) : 0;
}

/**
 * Where a point of the painted plan lies on the ground: `o` is the picture's top-left corner and
 * `du` / `dv` its full width and height as world vectors, so (u, v) → o + du·u + dv·v.
 */
function pictureMap(g) {
  const p = g.attributes.position; const t = g.attributes.uv;
  if (!t || p.count < 3) return null;
  const P = (i) => new THREE.Vector3().fromBufferAttribute(p, i);
  const p0 = P(0); const e1 = P(1).sub(p0); const e2 = P(2).sub(p0);
  const du1 = t.getX(1) - t.getX(0); const dv1 = t.getY(1) - t.getY(0); const du2 = t.getX(2) - t.getX(0); const dv2 = t.getY(2) - t.getY(0);
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return null;
  const du = e1.clone().multiplyScalar(dv2).sub(e2.clone().multiplyScalar(dv1)).divideScalar(det);
  const dv = e2.clone().multiplyScalar(du1).sub(e1.clone().multiplyScalar(du2)).divideScalar(det);
  const o = p0.clone().addScaledVector(du, -t.getX(0)).addScaledVector(dv, -t.getY(0));
  return { o, du, dv };
}

/** Small seeded PRNG, so the tablet and the TV scatter cars and birds identically. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CAR_COLORS = ['#f4f4f2', '#d9dbde', '#9aa0a6', '#3a3d42', '#1d1f22', '#b3261e', '#27508c', '#c9a45c'];
const CAR = { length: 13, width: 6, height: 3, speed: 34 };   // model units, sized to the plan's painted roads (drawn wider than life)

/** A car: a body with a darker cabin on top. Instance colour paints the body; the cabin stays dark. */
function carGeometry() {
  const paint = (g, c) => { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c; a[i * 3 + 1] = c; a[i * 3 + 2] = c; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const body = paint(new THREE.BoxGeometry(CAR.width, CAR.height, CAR.length).translate(0, CAR.height / 2 + 0.5, 0), 1);
  const cabin = paint(new THREE.BoxGeometry(CAR.width * 0.86, CAR.height * 0.75, CAR.length * 0.5).translate(0, CAR.height * 1.37 + 0.5, -CAR.length * 0.06), 0.16);
  const g = mergeGeometries([body, cabin]); body.dispose(); cabin.dispose();
  return g;
}

function skyDome(radius) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 zenith; uniform vec3 horizon; varying float h; void main(){ float t = pow(clamp(h, 0., 1.), .55); gl_FragColor = vec4(mix(horizon, zenith, t), 1.); }',
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1;
  return mesh;
}

const PIN_CSS = `
.mp-pins{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.mp-pin{position:absolute;left:0;top:0;transform-origin:50% 100%;display:flex;flex-direction:column;align-items:center;pointer-events:none;will-change:transform;transition:opacity .25s}
.mp-pin b{pointer-events:auto;display:flex;align-items:center;gap:7px;height:30px;padding:0 13px 0 10px;border-radius:999px;font:500 12px/1 Jost,system-ui,-apple-system,Roboto,sans-serif;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;color:#f3eee4;background:rgba(12,11,10,.82);border:1px solid rgba(255,255,255,.2);box-shadow:0 4px 14px rgba(0,0,0,.28)}
.mp-pin b:before{content:"";width:7px;height:7px;border-radius:50%;background:#c9a45c}
.mp-pin i{width:1px;height:22px;background:linear-gradient(rgba(255,255,255,.85),rgba(255,255,255,0))}
.mp-pin.on b{background:#c9a45c;border-color:#c9a45c;color:#14110c}
.mp-pin.on b:before{background:#14110c}
.mp-pin.off{opacity:0}
.mp-pin.off b{pointer-events:none}
`;

/**
 * @param {HTMLElement} el  the element the scene fills (position: relative)
 * @param {{ onEvent?: (e: object) => void, maxDpr?: number, interactive?: boolean, shadows?: boolean, pinScale?: number }} opts
 *   pinScale enlarges the zone pins (a TV is read from across the room).
 */
export function createMasterPlan(el, opts = {}) {
  const emit = opts.onEvent || (() => {});
  const interactive = opts.interactive !== false;
  const pinScale = Number(opts.pinScale) > 0 ? Number(opts.pinScale) : 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = opts.shadows !== false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  el.appendChild(renderer.domElement);

  const style = document.createElement('style'); style.textContent = PIN_CSS; el.appendChild(style);
  const pinLayer = document.createElement('div'); pinLayer.className = 'mp-pins'; el.appendChild(pinLayer);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#dbe8ee', 1000, 20000);
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 120000);
  camera.position.set(2000, 1600, 2400);
  const sky = skyDome(90000); scene.add(sky);
  const hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 2); sun.castShadow = true; scene.add(sun, sun.target);
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 1.2;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.9; controls.panSpeed = 0.9;
  controls.maxPolarAngle = 1.44; controls.minPolarAngle = 0.02;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.autoRotateSpeed = 0.55;
  controls.enabled = interactive;

  let disposed = false; let raf = 0; let dirty = true; let lastT = performance.now();
  let home = null;                  // { target, span, bounds }
  let zoneDefs = [];                // host config: { id, match, name }
  let zones = [];                   // built: { id, name, count, box, center, radius, materials, pin, buildings }
  let selectedId = null;
  let flight = null;
  let look = 'day'; let rain = false; let rainFx = null;
  let shiftX = 0;
  let modelUrl = null; let modelRoot = null; let siteGroup = null;
  let ring = null;
  let introDone = false;
  let ambientDef = null;            // host config: roads and flocks for this model
  let life = null;                  // built: { cars, birds }
  let followed = false; let camGoal = null;               // viewer: the presenter's camera, eased towards each frame

  const invalidate = () => { dirty = true; };

  // ---- Size ---------------------------------------------------------------------------------

  function applyShift() {
    const w = el.clientWidth || 1; const h = el.clientHeight || 1;
    if (shiftX) camera.setViewOffset(w, h, -shiftX * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = el.clientWidth || 1; const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // A tall, narrow screen sees less of the site at the same distance; widen the lens a little.
    camera.fov = w < h ? 52 : 38;
    applyShift();
    invalidate();
  }
  const ro = new ResizeObserver(resize); ro.observe(el);

  // ---- Light --------------------------------------------------------------------------------

  function applyLook() {
    const L = LOOKS[look] || LOOKS.day;
    const zenith = new THREE.Color(rain ? RAIN_LOOK.zenith : L.zenith);
    const horizon = new THREE.Color(rain ? RAIN_LOOK.horizon : L.horizon);
    if (rain && look === 'evening') { zenith.lerp(new THREE.Color(L.zenith), 0.35); horizon.lerp(new THREE.Color(L.horizon), 0.45); }
    sky.material.uniforms.zenith.value.copy(zenith);
    sky.material.uniforms.horizon.value.copy(horizon);
    scene.fog.color.copy(horizon);
    hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity = L.hemiI * (rain ? RAIN_LOOK.hemiMul : 1);
    sun.color.set(L.sun); sun.intensity = L.sunI * (rain ? RAIN_LOOK.sunMul : 1);
    if (home) {
      const span = home.span;
      const dir = new THREE.Vector3(...L.dir).normalize();
      sun.target.position.copy(home.target);
      sun.position.copy(home.target).addScaledVector(dir, span * 1.6);
      const c = sun.shadow.camera; const half = span * 0.62;
      c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = span * 0.2; c.far = span * 3.4;
      c.updateProjectionMatrix();
      scene.fog.near = span * (rain ? 0.35 : 0.9); scene.fog.far = span * (rain ? 4.2 : 9);
    }
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }

  function setRain(on) {
    rain = !!on;
    if (rain && !rainFx) {
      const N = 1500; const p = new Float32Array(N * 6); const seeds = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) { seeds[i * 4] = Math.random() * 2 - 1; seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random() * 2 - 1; seeds[i * 4 + 3] = 0.75 + Math.random() * 0.5; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.LineBasicMaterial({ color: '#eef4f8', transparent: true, opacity: 0.42, depthWrite: false, fog: false });
      const lines = new THREE.LineSegments(g, m); lines.frustumCulled = false; lines.renderOrder = 5;
      rainFx = { lines, seeds, N, t: 0 }; scene.add(lines);
    }
    if (rainFx) rainFx.lines.visible = rain;
    applyLook();
  }
  function stepRain(dt) {
    const fx = rainFx; fx.t += dt;
    // The shower lives in a box around what the camera looks at, sized to the zoom, so it reads the
    // same from the skyline as from beside a tower.
    const d = camera.position.distanceTo(controls.target);
    const R = d * 0.75; const H = d * 0.8; const len = d * 0.028; const p = fx.lines.geometry.attributes.position.array;
    const cx = controls.target.x; const cz = controls.target.z;
    for (let i = 0; i < fx.N; i++) {
      const sx = fx.seeds[i * 4]; const sy = fx.seeds[i * 4 + 1]; const sz = fx.seeds[i * 4 + 2]; const sp = fx.seeds[i * 4 + 3];
      const fall = 1 - ((sy + fx.t * 0.95 * sp) % 1);
      const x = cx + sx * R; const y = fall * H; const z = cz + sz * R;
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + len * 0.12; p[i * 6 + 4] = y + len; p[i * 6 + 5] = z;
    }
    fx.lines.geometry.attributes.position.needsUpdate = true;
  }

  // ---- Model --------------------------------------------------------------------------------

  function clearSite() {
    clearLife();
    if (!siteGroup) return;
    siteGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); } });
    scene.remove(siteGroup); siteGroup = null;
    zones.forEach((z) => z.pin?.remove()); zones = []; ring = null;
  }

  function zoneFor(name) {
    const n = String(name || '').toLowerCase();
    return zoneDefs.find((z) => n.startsWith(String(z.match).toLowerCase())) || null;
  }

  function build() {
    if (!modelRoot) return;
    clearSite();
    const root = modelRoot;
    root.updateMatrixWorld(true);
    const tops = root.children.length === 1 && root.children[0].children.length > 4 ? root.children[0].children : root.children;
    siteGroup = new THREE.Group(); scene.add(siteGroup);

    const planBox = new THREE.Box3(); const builtBox = new THREE.Box3();
    const groups = new Map();       // zone id (or '') → { def, buildings: [{name, box}], plain: [], textured: Map }
    const size = new THREE.Vector3();
    let hasPlan = false; const aprons = []; let north = 0; let planMap = null;

    for (const node of tops) {
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      box.getSize(size);
      const meshes = []; node.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
      if (size.y < 1) {
        // Flat ground: the painted site plan (its picture comes in as an emissive map) or a plain apron around it.
        for (const m of meshes) {
          const src = Array.isArray(m.material) ? m.material[0] : m.material;
          const map = src.emissiveMap || src.map || null;
          const g = bake([{ mesh: m, color: new THREE.Color(1, 1, 1) }], true);
          let mat;
          if (map) {
            map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            mat = new THREE.MeshLambertMaterial({ map, transparent: true });
            // Feather the picture's edges into the apron around it, so the plan doesn't end in a hard rectangle.
            mat.onBeforeCompile = (sh) => {
              sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  { vec2 e = smoothstep(vec2(0.), vec2(.045), vMapUv) * smoothstep(vec2(0.), vec2(.045), 1. - vMapUv); diffuseColor.a *= e.x * e.y; }');
            };
            hasPlan = true;
            planBox.union(box);
            north = pictureUp(g); planMap = pictureMap(g);
          } else {
            // The apron ends in a hard edge a few kilometres out; stretch it to the haze instead.
            g.translate(0, -1, 0); g.scale(9, 1, 9);
            mat = new THREE.MeshLambertMaterial({ color: src.color ? src.color.clone() : new THREE.Color(APRON) });
            aprons.push(mat);
          }
          const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.name = node.name; mesh.frustumCulled = false;
          siteGroup.add(mesh);
        }
        continue;
      }
      builtBox.union(box);
      const def = zoneFor(node.name);
      const key = def ? def.id : '';
      let grp = groups.get(key);
      if (!grp) { grp = { def, buildings: [], plain: [], textured: new Map() }; groups.set(key, grp); }
      grp.buildings.push({ name: node.name, box });
      for (const m of meshes) {
        const src = Array.isArray(m.material) ? m.material[0] : m.material;
        const color = src.color ? src.color.clone() : new THREE.Color(1, 1, 1);
        if (src.map) { let list = grp.textured.get(src.map); if (!list) { list = []; grp.textured.set(src.map, list); } list.push({ mesh: m, color }); } else grp.plain.push({ mesh: m, color });
      }
    }

    // Under a painted plan the apron takes the plan's own grass green, so the two read as one field.
    if (hasPlan) aprons.forEach((m) => m.color.set(APRON));

    zones = [];
    for (const [key, grp] of groups) {
      const materials = [];
      const add = (list, map) => {
        if (!list.length) return;
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: map || null, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(bake(list, !!map), mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `zone:${key}`;
        siteGroup.add(mesh); materials.push(mat);
      };
      add(grp.plain, null);
      for (const [map, list] of grp.textured) add(list, map);
      const box = new THREE.Box3(); grp.buildings.forEach((b) => box.union(b.box));
      const center = box.getCenter(new THREE.Vector3()); box.getSize(size);
      const zone = {
        id: key, name: grp.def ? grp.def.name : '', selectable: !!grp.def, order: grp.def ? zoneDefs.indexOf(grp.def) : 999,
        count: grp.buildings.length, buildings: grp.buildings, box, center, radius: Math.hypot(size.x, size.z) / 2, height: size.y,
        materials, glow: 0, dim: 0, pin: null,
      };
      zones.push(zone);
    }
    zones.sort((a, b) => a.order - b.order);

    // The model's originals are baked now; free them.
    root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });

    const frame = planBox.isEmpty() ? builtBox : planBox;
    frame.getSize(size);
    const target = frame.getCenter(new THREE.Vector3()); target.y = 0;
    home = { target, span: Math.max(size.x, size.z, 200), bounds: frame.clone(), north, planMap };
    controls.minDistance = Math.max(60, home.span * 0.04);
    controls.maxDistance = home.span * 1.55;

    // Selection ring on the ground under the picked zone.
    ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 8), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3; ring.visible = false; siteGroup.add(ring);

    for (const z of zones) {
      if (!z.selectable) continue;
      const pin = document.createElement('div'); pin.className = 'mp-pin off';
      const b = document.createElement('b'); b.textContent = z.name; const stem = document.createElement('i');
      pin.append(b, stem);
      if (interactive) b.addEventListener('click', (e) => { e.stopPropagation(); pick(z.id === selectedId ? null : z.id, 'pin'); });
      pinLayer.appendChild(pin); z.pin = pin;
    }

    buildLife();
    applyLook();
    resize();
    emit({ t: 'model', state: 'ready', zones: zones.filter((z) => z.selectable).map((z) => ({ id: z.id, name: z.name, count: z.count })) });

    // Opening move: come down from high above the plan to the home view.
    const to = viewPose('home');
    if (!introDone && interactive) {
      introDone = true;
      setPose({ target: home.target.clone(), radius: home.span * 1.5, phi: 0.06, theta: to.theta - 0.9 });
      fly(to, 3200, () => emit({ t: 'intro', done: true }));
    } else if (camGoal) { followed = true; setPose(camGoal); camGoal = null; } else setPose(to);
    if (selectedId) { const keep = selectedId; selectedId = null; select(keep, false); }
  }

  // ---- Life: cars on the roads, birds overhead --------------------------------------------------

  function clearLife() {
    if (!life) return;
    for (const o of [life.cars, life.birds]) { if (!o) continue; scene.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose(); }
    life = null;
  }

  function buildLife() {
    clearLife();
    if (!home || !ambientDef) return;
    const rand = rng(20261114);
    life = { cars: null, birds: null };

    // Cars. Each road is its traced centreline laid on the ground; a car is a distance along it.
    const map = home.planMap;
    if (map && Array.isArray(ambientDef.roads)) {
      const roads = []; const cars = [];
      for (const def of ambientDef.roads) {
        const pts = (def.pts || []).map(([u, v]) => new THREE.Vector3().copy(map.o).addScaledVector(map.du, u).addScaledVector(map.dv, v).setY(0));
        if (pts.length < 2) continue;
        if (def.closed) pts.push(pts[0].clone());
        const at = [0]; for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + pts[i].distanceTo(pts[i - 1]));
        const road = { pts, at, length: at[at.length - 1], closed: !!def.closed, lane: def.lane ?? 5 };
        roads.push(road);
        for (let i = 0; i < (def.cars || 0); i++) {
          cars.push({ road, start: rand(), dir: i % 2 ? 1 : -1, speed: CAR.speed * (def.speed || 1) * (0.8 + rand() * 0.45), color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)] });
        }
      }
      if (cars.length) {
        const mesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), cars.length);
        const c = new THREE.Color(); cars.forEach((car, i) => mesh.setColorAt(i, c.set(car.color)));
        mesh.frustumCulled = false; mesh.receiveShadow = true;
        scene.add(mesh); life.cars = { mesh, cars };
      }
    }

    // Birds: a few loose flocks, each circling the site on its own ring. Two triangles a bird.
    const flocks = Math.max(0, Math.min(8, Number(ambientDef.flocks) || 0));
    if (flocks) {
      const birds = [];
      for (let f = 0; f < flocks; f++) {
        const flock = {
          radius: home.span * (0.14 + rand() * 0.2), height: 190 + rand() * 150, phase: rand() * Math.PI * 2,
          dir: f % 2 ? -1 : 1, speed: 48 + rand() * 22, cx: (rand() - 0.5) * home.span * 0.3, cz: (rand() - 0.5) * home.span * 0.3,
        };
        const n = 5 + Math.floor(rand() * 5);
        for (let i = 0; i < n; i++) birds.push({ flock, ox: (rand() - 0.5) * 70, oy: (rand() - 0.5) * 22, oz: (rand() - 0.5) * 70, flap: 5 + rand() * 3, seed: rand() * 10 });
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(birds.length * 18), 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#2a3136', side: THREE.DoubleSide }));
      mesh.frustumCulled = false; scene.add(mesh); life.birds = { mesh, birds };
    }
    invalidate();
  }

  const carDummy = new THREE.Object3D(); const a3 = new THREE.Vector3(); const b3 = new THREE.Vector3();
  function stepLife() {
    // Positions come from the wall clock, not from frames, so both screens show the same traffic.
    const t = (Date.now() % 86_400_000) / 1000;
    if (life.cars) {
      const { mesh, cars } = life.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]; const r = car.road;
        let d = (car.start * r.length + car.dir * car.speed * t) % r.length; if (d < 0) d += r.length;
        let k = 1; while (k < r.at.length - 1 && r.at[k] < d) k++;
        const p0 = r.pts[k - 1]; const p1 = r.pts[k]; const f = (d - r.at[k - 1]) / Math.max(1e-6, r.at[k] - r.at[k - 1]);
        a3.copy(p1).sub(p0).normalize();
        // Keep left of the centreline for the way the car is heading.
        b3.set(a3.z, 0, -a3.x).multiplyScalar(r.lane * car.dir);
        carDummy.position.copy(p0).lerp(p1, f).add(b3);
        carDummy.rotation.set(0, Math.atan2(a3.x * car.dir, a3.z * car.dir), 0);
        // A road that simply ends: cars ease in and out of sight there instead of popping.
        const edge = r.closed ? 1 : clamp(Math.min(d, r.length - d) / 30, 0, 1);
        carDummy.scale.setScalar(edge < 0.02 ? 0.0001 : edge);
        carDummy.updateMatrix(); mesh.setMatrixAt(i, carDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (life.birds) {
      const { mesh, birds } = life.birds; mesh.visible = !rain;
      if (!rain) {
        const p = mesh.geometry.attributes.position.array; const half = 12; const len = 4.5;
        for (let i = 0; i < birds.length; i++) {
          const b = birds[i]; const fl = b.flock;
          const ang = fl.phase + fl.dir * (fl.speed / fl.radius) * t;
          const cx = home.target.x + fl.cx + Math.cos(ang) * fl.radius + b.ox;
          const cz = home.target.z + fl.cz + Math.sin(ang) * fl.radius + b.oz;
          const cy = fl.height + b.oy + Math.sin(t * 0.6 + b.seed) * 6;
          // Heading along the circle; wings out to either side, tips beating.
          const fx = -Math.sin(ang) * fl.dir; const fz = Math.cos(ang) * fl.dir; const rx = fz; const rz = -fx;
          const tip = Math.sin(t * b.flap + b.seed) * 5.5; const o = i * 18;
          for (let w = 0; w < 2; w++) {
            const sgn = w ? 1 : -1; const q = o + w * 9;
            p[q] = cx + fx * len; p[q + 1] = cy; p[q + 2] = cz + fz * len;
            p[q + 3] = cx - fx * len * 0.5; p[q + 4] = cy; p[q + 5] = cz - fz * len * 0.5;
            p[q + 6] = cx + rx * half * sgn - fx * 2; p[q + 7] = cy + tip; p[q + 8] = cz + rz * half * sgn - fz * 2;
          }
        }
        mesh.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  // ---- Camera -------------------------------------------------------------------------------

  /** A camera pose: orbit `target`, at `radius`, `phi` down from straight above, `theta` around. */
  function viewPose(name) {
    const { target, span } = home;
    const portrait = camera.aspect < 1;
    if (name === 'top') return { target: target.clone(), radius: span * (portrait ? 1.45 : 1.02), phi: 0.03, theta: home.north };
    if (name === 'skyline') return { target: target.clone(), radius: span * (portrait ? 1.0 : 0.72), phi: 1.36, theta: 0.5 };
    return { target: target.clone(), radius: span * (portrait ? 1.3 : 0.9), phi: 0.92, theta: 0.52 };
  }
  function zonePose(z) {
    const now = getPose();
    const portrait = camera.aspect < 1;
    const fit = (z.radius * (portrait ? 3.6 : 2.5) + z.height * 1.2 + 60);
    return {
      target: new THREE.Vector3(z.center.x, Math.min(z.height * 0.3, 40), z.center.z),
      radius: clamp(fit, controls.minDistance, controls.maxDistance),
      phi: 1.02, theta: now.theta,
    };
  }
  const sph = new THREE.Spherical(); const off = new THREE.Vector3();
  function getPose() {
    off.copy(camera.position).sub(controls.target); sph.setFromVector3(off);
    return { target: controls.target.clone(), radius: sph.radius, phi: sph.phi, theta: sph.theta };
  }
  function setPose(p) {
    sph.set(p.radius, clamp(p.phi, 0.02, controls.maxPolarAngle), p.theta);
    off.setFromSpherical(sph);
    controls.target.copy(p.target); camera.position.copy(p.target).add(off);
    camera.lookAt(controls.target);
    invalidate();
  }
  function fly(to, ms = 1500, onDone) {
    const from = getPose();
    // Go round the short way.
    let dTheta = (to.theta - from.theta) % (Math.PI * 2);
    if (dTheta > Math.PI) dTheta -= Math.PI * 2; else if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    flight = { from, to, dTheta, t0: performance.now(), ms, onDone };
    invalidate();
  }
  function stepFlight(now) {
    const f = flight; const k = ease(clamp((now - f.t0) / f.ms, 0, 1));
    setPose({
      target: f.from.target.clone().lerp(f.to.target, k),
      radius: f.from.radius + (f.to.radius - f.from.radius) * k,
      phi: f.from.phi + (f.to.phi - f.from.phi) * k,
      theta: f.from.theta + f.dTheta * k,
    });
    if (k >= 1) { flight = null; f.onDone && f.onDone(); }
  }
  /** Viewer: close most of the gap to the presenter's camera each frame, so 12 samples a second read as one move. */
  function stepFollow(dt) {
    const now = getPose(); const g = camGoal; const k = 1 - Math.exp(-dt * 9);
    let dTheta = (g.theta - now.theta) % (Math.PI * 2);
    if (dTheta > Math.PI) dTheta -= Math.PI * 2; else if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const near = now.target.distanceTo(g.target) < 0.5 && Math.abs(now.radius - g.radius) < 0.5 && Math.abs(now.phi - g.phi) < 0.0005 && Math.abs(dTheta) < 0.0005;
    if (near) { setPose(g); camGoal = null; return; }
    setPose({ target: now.target.lerp(g.target, k), radius: now.radius + (g.radius - now.radius) * k, phi: now.phi + (g.phi - now.phi) * k, theta: now.theta + dTheta * k });
  }
  controls.addEventListener('start', () => { if (flight) { const f = flight; flight = null; f.onDone && f.onDone(); } emit({ t: 'touch' }); });
  controls.addEventListener('change', () => {
    if (home) {
      // Keep the pivot on the plan so a pan can't wander off into the fields.
      const b = home.bounds; const t = controls.target;
      const x = clamp(t.x, b.min.x, b.max.x); const z = clamp(t.z, b.min.z, b.max.z);
      if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; }
    }
    invalidate();
  });
  let lastCam = '';
  function reportCam() {
    const p = getPose();
    const cam = { tx: Math.round(p.target.x), ty: Math.round(p.target.y), tz: Math.round(p.target.z), r: Math.round(p.radius), phi: Math.round(p.phi * 1000) / 1000, theta: Math.round(p.theta * 1000) / 1000 };
    const key = JSON.stringify(cam);
    if (key !== lastCam) { lastCam = key; emit({ t: 'cam', ...cam }); }
  }

  // ---- Picking ------------------------------------------------------------------------------

  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const hit = new THREE.Vector3();
  function zoneAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null; let bestD = Infinity;
    for (const z of zones) {
      if (!z.selectable) continue;
      for (const b of z.buildings) {
        if (!ray.ray.intersectBox(b.box, hit)) continue;
        const d = hit.distanceToSquared(ray.ray.origin);
        if (d < bestD) { bestD = d; best = z; }
      }
    }
    return best;
  }
  let down = null;
  const onDown = (e) => { down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; };
  const onUp = (e) => {
    const d = down; down = null;
    if (!d || !e.isPrimary || !zones.length) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX || performance.now() - d.t > TAP_MS) return;
    const z = zoneAt(e.clientX, e.clientY);
    pick(z ? (z.id === selectedId ? null : z.id) : null, 'tap');
  };
  if (interactive) {
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  }

  /** A pick made on the model itself: tell the host, which owns what is selected. */
  function pick(id, by) {
    if (id === selectedId) return;
    select(id, true);
    emit({ t: 'select', id, by });
  }
  function select(id, move = true) {
    const z = id == null ? null : zones.find((q) => q.id === id && q.selectable) || null;
    selectedId = z ? z.id : (zones.length ? null : id);
    for (const q of zones) q.pin && q.pin.classList.toggle('on', !!z && q.id === z.id);
    if (ring) {
      if (z) {
        // Rebuilt per zone so the line keeps one thickness whether it circles a temple or a hundred villas.
        const s = z.radius * 1.12 + 14; const w = Math.max(2.5, home ? home.span * 0.0016 : 3);
        ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(s - w, s, 128);
        ring.position.set(z.center.x, 2.2, z.center.z); ring.visible = true;
      }
    }
    if (z && move && home) fly(zonePose(z), 1500);
    invalidate();
  }
  function stepGlow(dt) {
    let moving = false; const k = Math.min(1, dt * 6);
    const any = selectedId != null && zones.some((z) => z.id === selectedId);
    for (const z of zones) {
      const on = any && z.id === selectedId;
      const glowTo = on ? 1 : 0; const dimTo = any && !on ? 1 : 0;
      if (Math.abs(z.glow - glowTo) > 0.002 || Math.abs(z.dim - dimTo) > 0.002) {
        z.glow += (glowTo - z.glow) * k; z.dim += (dimTo - z.dim) * k; moving = true;
        const c = 1 - z.dim * DIM;
        for (const m of z.materials) { m.color.setRGB(c, c, c * (1 + z.dim * 0.04)); m.emissive.copy(GOLD).multiplyScalar(z.glow * 0.2); }
      }
    }
    if (ring) {
      const to = any ? 0.9 : 0; const o = ring.material.opacity;
      if (Math.abs(o - to) > 0.004) { ring.material.opacity = o + (to - o) * k; moving = true; } else if (!any) ring.visible = false;
    }
    return moving;
  }

  // ---- Pins ---------------------------------------------------------------------------------

  const pv = new THREE.Vector3();
  function placePins() {
    const w = el.clientWidth; const h = el.clientHeight;
    for (const z of zones) {
      if (!z.pin) continue;
      pv.set(z.center.x, z.box.max.y + 6, z.center.z).project(camera);
      const visible = pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05;
      z.pin.classList.toggle('off', !visible);
      if (!visible) continue;
      const x = (pv.x * 0.5 + 0.5) * w; const y = (-pv.y * 0.5 + 0.5) * h;
      z.pin.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)${pinScale === 1 ? '' : ` scale(${pinScale})`}`;
      z.pin.style.zIndex = String(1000 - Math.round(pv.z * 1000));
    }
  }

  // ---- Loop ---------------------------------------------------------------------------------

  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (flight) stepFlight(now);
    else if (interactive) controls.update(dt);
    else if (camGoal && home) stepFollow(dt);
    if (stepGlow(dt)) dirty = true;
    if (rain && rainFx) { stepRain(dt); dirty = true; }
    if (life && (life.cars || life.birds)) { stepLife(); dirty = true; }
    if (!dirty) return;
    dirty = false;
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    placePins();
    if (interactive && home) reportCam();
  }
  raf = requestAnimationFrame(frame);
  applyLook();
  resize();

  return {
    /** The site model. Loading reports `{t:'progress', pct}` then `{t:'model', state}`. */
    setModel(url) {
      if (!url || url === modelUrl) return;
      modelUrl = url;
      emit({ t: 'model', state: 'loading' });
      loadModel(url, (e) => { if (e && e.total) emit({ t: 'progress', pct: Math.round((e.loaded / e.total) * 100) }); }).then((root) => {
        if (disposed || modelUrl !== url) return;
        modelRoot = root; build();
      }).catch((e) => { if (modelUrl === url) { modelUrl = null; emit({ t: 'model', state: 'error', message: String((e && e.message) || e) }); } });
    },
    /** `[{ id, match, name }]`: a top-level node whose name starts with `match` belongs to that zone. */
    setZones(list) {
      zoneDefs = Array.isArray(list) ? list.filter((z) => z && z.id && z.match) : [];
      // A rebuild needs the model's own geometry, which build() frees; reload it from the same URL.
      if (modelRoot && zones.length) { const url = modelUrl; modelUrl = null; modelRoot = null; this.setModel(url); }
    },
    /** Cars and birds for this model (masterplan/ambient.js); null switches them off. */
    setAmbient(def) { ambientDef = def && typeof def === 'object' ? def : null; if (home) buildLife(); },
    /** Where a point of the painted plan (fractions of its width and height) lies in the model: [x, z], or null without a plan. */
    planPoint(u, v) { const m = home && home.planMap; if (!m) return null; const p = new THREE.Vector3().copy(m.o).addScaledVector(m.du, u).addScaledVector(m.dv, v); return [p.x, p.z]; },
    /** Light a zone (null clears). `move` flies the camera to it. */
    select(id, move = true) { if (id !== selectedId) select(id, move); },
    /** 'home' | 'top' | 'skyline' */
    view(name) { if (home) fly(viewPose(name), 1600); },
    /** 'day' | 'evening' */
    setLighting(mode) { look = LOOKS[mode] ? mode : 'day'; applyLook(); },
    setRain,
    /** Slowly circle whatever the camera is looking at (the guided tour). */
    setOrbit(on) { controls.autoRotate = !!on; invalidate(); },
    /** Shift the picture sideways by a fraction of the width, to clear a panel beside it. */
    setShift(x) { shiftX = Number(x) || 0; applyShift(); invalidate(); },
    zoomBy(f) { if (!home) return; const p = getPose(); fly({ ...p, radius: clamp(p.radius / f, controls.minDistance, controls.maxDistance) }, 350); },
    /** Viewer hosts: put the camera where the presenter's is (`{t:'cam'}` fields). */
    applyCam(c) {
      if (!c || typeof c.r !== 'number') return;
      const first = !camGoal && !followed;
      camGoal = { target: new THREE.Vector3(c.tx, c.ty || 0, c.tz), radius: c.r, phi: c.phi, theta: c.theta };
      // The first camera of a session is where the presenter already is: go straight there.
      if (first && home) { followed = true; flight = null; setPose(camGoal); camGoal = null; }
      invalidate();
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); clearSite();
      sky.geometry.dispose(); sky.material.dispose(); sun.shadow.dispose?.(); renderer.dispose();
      renderer.domElement.remove(); pinLayer.remove(); style.remove();
    },
  };
}
