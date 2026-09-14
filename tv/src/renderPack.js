// Render packs (SHOWROOM-CONTRACT §4). A project's `render_pack` (URLs already rewritten to local
// files by the sync agent) is used as is; when it is null, the BriQ Skyline demo project falls back
// to the demo pack bundled with this app, exactly like the tablet.
import geometry from './demo/geometry.json';

const DEMO = `${import.meta.env.BASE_URL}demo/briq-skyline/`;

/** "A-1503" → 3. The last two digits of a unit number are its position on the floor. */
export function unitPosition(unitNo) {
  const m = String(unitNo ?? '').match(/(\d{2})$/);
  return m ? Number(m[1]) : 0;
}

export function centroid(points) {
  const n = points.length || 1;
  return [points.reduce((a, p) => a + p[0], 0) / n, points.reduce((a, p) => a + p[1], 0) / n];
}

function elevationRect(e, floor, position) {
  const j = floor - e.firstFloor;
  const col = e.columns[position - 1];
  if (j < 0 || j >= e.count || !col) return null;
  const bottom = e.top + e.pitch * (e.count - j);
  const top = bottom - e.pitch;
  const pad = 3;
  return [[col[0] + pad, top + pad], [col[1] - pad, top + pad], [col[1] - pad, bottom - pad], [col[0] + pad, bottom - pad]];
}

function demoPack(data) {
  const towers = data.towers ?? [];
  const g = geometry;
  const elevations = {};
  const floorPlates = {};
  const positions = Object.fromEntries(g.floorPlate.units.map((p) => [String(p.position), p.points]));
  for (const t of towers) {
    const units = {};
    for (const u of t.units ?? []) {
      const r = elevationRect(g.elevation, Number(u.floor), unitPosition(u.unit_no));
      if (r) units[u.unit_no] = r;
    }
    elevations[String(t.id)] = { image: `${DEMO}elevation-front.jpg`, size: g.elevation.size, units };
    floorPlates[String(t.id)] = { image: `${DEMO}floor-plate.jpg`, size: g.floorPlate.size, positions };
  }
  return {
    demo: true,
    aerial: {
      image: `${DEMO}aerial.jpg`,
      size: g.aerial.size,
      towers: g.aerial.towers.map((t, i) => ({
        tower_id: towers[i]?.id ?? null,
        placeholder: towers[i] ? undefined : (t.placeholder ?? 'Coming soon'),
        points: t.points,
        label: t.label,
      })),
    },
    elevations,
    floor_plates: floorPlates,
    units: {
      '3 BHK': {
        image: `${DEMO}unit-3bhk.jpg`,
        measured_image: `${DEMO}unit-3bhk-measured.jpg`,
        model: `${DEMO}unit-3bhk.glb`,
        size: g.units['3 BHK'].size,
        rooms: g.units['3 BHK'].rooms,
      },
    },
  };
}

export function resolveRenderPack(data) {
  const rp = data?.render_pack;
  if (rp && typeof rp === 'object') {
    return { aerial: rp.aerial ?? null, elevations: rp.elevations ?? {}, floor_plates: rp.floor_plates ?? {}, units: rp.units ?? {} };
  }
  if (/^briq-skyline(-\d+)?$/.test(data?.slug ?? '')) return demoPack(data);
  return null;
}
