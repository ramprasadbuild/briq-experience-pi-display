// A builder's own 3D model (.glb) for the Inventory scene: loading it, finding its towers, and
// wrapping each tower in a "skin" — one coloured panel per flat, hugging the tower's real outline —
// so live availability can be shown on a model that has no per-flat geometry of its own.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export function loadModel(url) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => loader.load(url, (g) => resolve(g.scene), undefined, reject));
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * The model's buildings: every top-level node with its world box. Anything taller than 45 m is a
 * tower an inventory tower can be mapped onto; the rest (villas, clubhouse, ground) is scenery.
 */
export function describeModel(root) {
  root.updateMatrixWorld(true);
  const tops = root.children.length === 1 && root.children[0].children.length > 4 ? root.children[0].children : root.children;
  const parts = tops.map((node) => {
    const box = new THREE.Box3().setFromObject(node);
    const size = box.getSize(new THREE.Vector3());
    return { node, name: node.name || '', box, size, center: box.getCenter(new THREE.Vector3()), flat: size.y < 1 };
  });
  const towers = parts.filter((p) => !p.flat && !/temple|club|pavilion/i.test(p.name) && p.size.y > 45 && Math.max(p.size.x, p.size.z) < 220).sort((a, b) => natural(a.name, b.name));
  return { parts, towers };
}

/** Convex hull (monotone chain) of [x, z] points, counter-clockwise. */
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The tower's outline at mid height (so podiums and crowns don't widen it), pushed out a touch. */
function outline(part) {
  const { node, box, size } = part;
  const lo = box.min.y + size.y * 0.3; const hi = box.min.y + size.y * 0.7;
  const pts = []; const v = new THREE.Vector3();
  node.traverse((o) => {
    const pos = o.isMesh && o.geometry?.attributes?.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.y >= lo && v.y <= hi) pts.push([v.x, v.z]); }
  });
  if (pts.length < 3) { const { min, max } = box; return [[min.x, min.z], [max.x, min.z], [max.x, max.z], [min.x, max.z]]; }
  const h = hull(pts);
  const cx = h.reduce((a, q) => a + q[0], 0) / h.length; const cz = h.reduce((a, q) => a + q[1], 0) / h.length;
  return h.map(([x, z]) => { const d = Math.hypot(x - cx, z - cz) || 1; return [x + ((x - cx) / d) * 0.9, z + ((z - cz) / d) * 0.9]; });
}

/**
 * One mesh for the whole tower: each flat is a strip of the outline, one floor tall, in unit-number
 * order around the floor. Returns the mesh plus, per flat, its vertex range (to recolour it) and,
 * per triangle, which flat it belongs to (to pick it).
 */
export function buildSkin(part, layout) {
  const ring = outline(part);
  const n = ring.length;
  const seg = ring.map((p, i) => { const q = ring[(i + 1) % n]; return { a: p, b: q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; });
  const total = seg.reduce((a, s) => a + s.len, 0);
  const at = (d) => { let rest = ((d % total) + total) % total; for (const s of seg) { if (rest <= s.len) { const t = s.len ? rest / s.len : 0; return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]; } rest -= s.len; } return ring[0]; };
  // Corner distances, so a strip that turns a corner bends with the outline instead of cutting it.
  const corners = []; { let d = 0; for (const s of seg) { corners.push(d); d += s.len; } }

  const y0 = part.box.min.y + part.size.y * 0.07; const span = part.size.y * 0.83;
  const fh = span / layout.floors;
  const pos = []; const col = []; const idx = []; const faceUnit = []; const cells = [];
  for (let f = 1; f <= layout.floors; f++) {
    const units = layout.byFloor.get(f) || [];
    units.forEach((unit, i) => {
      const from = (i / units.length) * total + 0.45; const to = ((i + 1) / units.length) * total - 0.45;
      const stops = [from, ...corners.filter((c) => c > from && c < to), to];
      const yb = y0 + (f - 1) * fh + fh * 0.07; const yt = y0 + f * fh - fh * 0.07;
      const v0 = pos.length / 3;
      for (let k = 0; k < stops.length - 1; k++) {
        const [ax, az] = at(stops[k]); const [bx, bz] = at(stops[k + 1]);
        const base = pos.length / 3;
        pos.push(ax, yb, az, bx, yb, bz, bx, yt, bz, ax, yt, az);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        faceUnit.push(cells.length, cells.length);
      }
      const v1 = pos.length / 3;
      for (let k = v0; k < v1; k++) col.push(1, 1, 1);
      const [mx, mz] = at((from + to) / 2);
      cells.push({ unit, f, i, v0, v1, mx, mz });
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  mesh.visible = false; mesh.renderOrder = 5;
  return { mesh, cells, faceUnit };
}
