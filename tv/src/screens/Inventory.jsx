import { useEffect, useMemo, useRef, useState } from 'react';
import { areaText, ordinal, priceText } from '../format.js';
import { heroImage } from '../project.js';
import { centroid, floorPlateFor, resolveRenderPack, unitPosition } from '../renderPack.js';
import { STATUS_LABEL, statusColor, xc } from '../tokens.js';
import { Empty, Kicker } from '../ui/Chrome.jsx';
import HotspotImage from '../ui/HotspotImage.jsx';
import Icon from '../ui/Icon.jsx';
import Model3D from '../ui/Model3D.jsx';
import Scene3D from '../ui/Scene3D.jsx';
import { towerLayout } from '../scene3d/scene.js';
import './Inventory.css';

/**
 * Chapter 02 · Inventory — Aerial → Tower → Floor → Unit, following `inventory` from the tablet:
 * level, tower_id, floor, unit_no, tip_unit_no (tooltip / highlight), cfg (type filter),
 * unit_mode (standard | sqft | sqm | 3d), model_cam, the compare list and show_details.
 *
 * Image-first: the render fills the stage at every level and the data stays out of the way —
 * filters are the presenter's tool and never appear here; the flat-details panel and the on-floor
 * mini plate slide in over the render only while the tablet has `show_details` on. Render-pack
 * shapes are drawn in status colours when the project has them; grids and plans otherwise.
 *
 * `useInventory` resolves the tablet's state against the project once; each level is its own
 * component reading that model.
 *
 * A project without its own traced aerial render gets the live 3D model instead (ui/Scene3D):
 * one scene for the aerial, tower and floor levels, turned and flown by the tablet
 * (`scene_cam` {yaw, pitch, zoom, tod, season, date} — tod is the time of day, 0 = 05:00 … 1 = 21:00; season is the sun-study date: today | summer | winter), with every flat in its live status colour and the picked flat's floor
 * plate and details in a panel beside it.
 */

const LEVELS = ['aerial', 'tower', 'floor', 'unit'];
const MODE_LABEL = { standard: 'Standard', sqft: 'Square Ft.', sqm: 'Square Mtr.', '3d': '3D View' };
const COMPARE_COLUMNS = 3;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const byUnitNo = (a, b) => String(a.unit_no).localeCompare(String(b.unit_no), undefined, { numeric: true });
/** The floor-plate polygon for a unit, looked up by its position on the floor (last two digits). */
const plateShape = (plate, u) => plate.positions?.[String(unitPosition(u.unit_no))];
const onFloor = (units, floor) => units.filter((u) => Number(u.floor) === Number(floor));
/** Room dimensions in metres from the pack's feet: "4.3 × 3.7 m". */
const metresText = (ft, digits) => `${(ft[0] * 0.3048).toFixed(digits)} × ${(ft[1] * 0.3048).toFixed(digits)} m`;

/**
 * Everything the level views need, derived from the project and the tablet's `inventory` state.
 * Returns null when the project has no towers. Invalid or stale references (an unknown unit, a
 * level with no unit to show) degrade to the nearest sensible level instead of a blank stage.
 */
function useInventory(data, s) {
  const towers = data.towers ?? [];
  const pack = useMemo(() => resolveRenderPack(data), [data]);
  const lookup = useMemo(() => {
    const m = new Map();
    for (const t of data.towers ?? []) for (const u of t.units ?? []) m.set(String(u.unit_no), { unit: u, tower: t });
    return m;
  }, [data]);

  const found = s.unit_no != null ? lookup.get(String(s.unit_no)) : null;
  const unit = found?.unit ?? null;
  const tip = s.tip_unit_no != null ? lookup.get(String(s.tip_unit_no))?.unit ?? null : null;
  const tower = towers.find((t) => sameId(t.id, s.tower_id)) ?? found?.tower ?? towers[0];
  if (!tower) return null;

  let level = LEVELS.includes(s.level) ? s.level : 'aerial';
  if (level === 'unit' && !unit) level = 'floor';
  const cfg = s.cfg ?? null;
  const towerUnits = tower.units ?? [];
  const shown = towerUnits.filter((u) => !cfg || u.bhk === cfg);
  const floorNo = s.floor != null ? Number(s.floor) : unit ? Number(unit.floor) : tip ? Number(tip.floor) : null;
  const floorUnits = shown.filter((u) => Number(u.floor) === floorNo).sort(byUnitNo);
  const cfgOf = (bhk) => (data.configs ?? []).find((c) => c.bhk === bhk);
  const allUnits = towers.flatMap((t) => t.units ?? []);
  const totals = {
    total: data.availability?.total ?? allUnits.length,
    available: data.availability?.available ?? allUnits.filter((u) => u.status === 'available').length,
  };
  const elevation = pack?.elevations?.[String(tower.id)] ?? null;
  const plate = floorPlateFor(pack, tower.id, floorNo);
  const unitRender = unit ? pack?.units?.[unit.bhk ?? ''] ?? null : null;
  const modes = unitRender?.model ? ['standard', 'sqft', 'sqm', '3d'] : ['standard', 'sqft', 'sqm'];
  const mode = modes.includes(s.unit_mode) ? s.unit_mode : 'standard';
  const isOn = (u) => sameId(u?.unit_no, tip?.unit_no) || sameId(u?.unit_no, unit?.unit_no);
  const compare = (Array.isArray(s.compare) ? s.compare : []).map((no) => lookup.get(String(no))).filter(Boolean);
  // The presenter reveals the data; the TV is image-only until then.
  const showDetails = level === 'unit' && !!unit && s.show_details === true;
  const compareInPanel = showDetails && mode !== '3d';
  // The builder's own traced renders win; everything else is shown on the live 3D model.
  const use3d = !data.render_pack?.aerial && level !== 'unit';
  const statuses = Array.isArray(s.status_filter) && s.status_filter.length ? s.status_filter : null;

  return {
    data, s, towers, pack, tower, unit, tip, level, cfg, towerUnits, shown, floorNo, floorUnits, cfgOf, totals,
    elevation, plate, unitRender, modes, mode, isOn, compare, showDetails, compareInPanel, use3d, statuses,
  };
}

export default function Inventory({ data, s, meta }) {
  const inv = useInventory(data, s);
  if (!inv) {
    return <Empty title="No inventory yet">No inventory published for this project yet.</Empty>;
  }
  const { level, tower, unit, tip, floorNo, compare, showDetails, compareInPanel, mode } = inv;

  if (inv.use3d) return <Inventory3D inv={inv} meta={meta} />;

  const main = level === 'aerial' ? <AerialView inv={inv} />
    : level === 'tower' ? <TowerView inv={inv} />
      : level === 'floor' ? <FloorView inv={inv} />
        : <UnitView inv={inv} />;

  return (
    <div className="inv">
      {/* A tower's elevation render fills the whole screen; the other levels keep their margins for the strips and panels beside the image. */}
      {level === 'aerial' ? main : <div className={`inv-stage${level === 'tower' && inv.elevation ? ' full' : ''}`}>{main}</div>}

      <div className="inv-crumbs">
        {data.org?.logo_url ? <img className="inv-logo" src={data.org.logo_url} alt="" /> : null}
        <Crumb first on={level === 'aerial'}>{data.name}</Crumb>
        {level !== 'aerial' ? <Crumb on={level === 'tower'}>{tower.name}</Crumb> : null}
        {(level === 'floor' || level === 'unit') && floorNo != null ? <Crumb on={level === 'floor'}>{`Floor ${floorNo}`}</Crumb> : null}
        {level === 'unit' && unit ? <Crumb on>{`Apartment ${unit.unit_no}`}</Crumb> : null}
      </div>
      {meta ? <div className="inv-chapter"><span>{meta.no}</span>{meta.name.toUpperCase()}</div> : null}

      {tip && level === 'tower' ? (
        <div className="glass-panel inv-tooltip">
          <div className="inv-tip-title">{tower.name} · {ordinal(Number(tip.floor))} Floor</div>
          <KV label="Apartment no" value={tip.unit_no} />
          <KV label="Status" value={(STATUS_LABEL[tip.status] ?? tip.status).toUpperCase()} color={statusColor(tip.status)} />
          <KV label="Unit type" value={tip.bhk ?? '—'} />
          <KV label="Area" value={areaText(tip.carpet_area, 'sqft')} />
          <KV label="Price" value={priceText(tip.price, null)} color={xc.gold} />
        </div>
      ) : null}

      {compare.length > 0 && !compareInPanel ? <CompareTable inv={inv} className={`inv-compare-float ${showDetails && mode === '3d' ? 'raised' : ''}`} /> : null}
    </div>
  );
}

// ---- Live 3D model: aerial → tower → floor on one scene --------------------------------------

const STATUS_ORDER = ['available', 'hold', 'sold'];

function Inventory3D({ inv, meta }) {
  const { data, s, towers, tower, level, tip, floorNo, floorUnits, towerUnits, cfg, cfgOf, totals, statuses, compare } = inv;
  const picked = level === 'floor' ? tip : null;
  const panel = level === 'floor' && floorNo != null;
  const state = {
    level, towerId: tower.id, unitNo: picked?.unit_no ?? (level === 'tower' ? tip?.unit_no ?? null : null), floor: panel ? floorNo : null,
    cfg, statuses, shiftX: panel ? 0.17 : 0, yaw: s.scene_cam?.yaw, pitch: s.scene_cam?.pitch, zoom: s.scene_cam?.zoom, tod: s.scene_cam?.tod, season: s.scene_cam?.season, date: s.scene_cam?.date, sun: !!s.scene_cam?.sun, avail: !!s.scene_cam?.avail,
  };
  const counts = STATUS_ORDER.map((st) => [st, towerUnits.filter((u) => u.status === st).length]);
  const plan = picked ? cfgOf(picked.bhk)?.image : null;
  const planAt = picked ? Math.max(0, floorUnits.slice().sort((a, b) => String(a.unit_no).localeCompare(String(b.unit_no), undefined, { numeric: true })).findIndex((u) => u.unit_no === picked.unit_no)) % 6 : 0;

  return (
    <div className="inv inv3d">
      <Scene3D towers={towers} state={state} />
      <div className="inv3d-shade" />

      <div className="inv-crumbs">
        {data.org?.logo_url ? <img className="inv-logo" src={data.org.logo_url} alt="" /> : null}
        <Crumb first on={level === 'aerial'}>{data.name}</Crumb>
        {level !== 'aerial' ? <Crumb on={level === 'tower'}>{tower.name}</Crumb> : null}
        {panel ? <Crumb on>{`Floor ${floorNo}`}</Crumb> : null}
      </div>
      {meta ? <div className="inv-chapter"><span>{meta.no}</span>{meta.name.toUpperCase()}</div> : null}

      {level === 'aerial' ? !s.scene_cam?.avail ? null : (
        <div className="inv-aerial-card">
          <div className="glass-panel inv-project">
            <div className="inv-project-name">{data.location ?? data.address ?? data.name}</div>
            <div className="inv-project-count"><b>{totals.total}</b> {totals.total === 1 ? 'home' : 'homes'} · <b>{totals.available}</b> available</div>
            <div className="inv-tower-chips">
              {towers.map((t) => <div key={String(t.id)} className="inv-tower-chip">{t.name}<span>{t.available}/{t.total}</span></div>)}
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-panel inv3d-legend">
          <div className="inv3d-legend-title">{tower.name}</div>
          <div className="inv3d-legend-sub">{tower.total_floors} floors · {towerUnits.length} homes{cfg ? ` · ${cfg}` : ''}</div>
          {counts.map(([st, n]) => (
            <div key={st} className={`inv3d-legend-row ${statuses && !statuses.includes(st) ? 'off' : ''}`}>
              <i style={{ background: statusColor(st) }} />{STATUS_LABEL[st]}<b>{n}</b>
            </div>
          ))}
        </div>
      )}

      {level === 'tower' && tip ? (
        <div className="glass-panel inv-tooltip">
          <div className="inv-tip-title">{tower.name} · {ordinal(Number(tip.floor))} Floor</div>
          <KV label="Apartment no" value={tip.unit_no} />
          <KV label="Status" value={(STATUS_LABEL[tip.status] ?? tip.status).toUpperCase()} color={statusColor(tip.status)} />
          <KV label="Unit type" value={tip.bhk ?? '—'} />
          <KV label="Area" value={areaText(tip.carpet_area, 'sqft')} />
          <KV label="Price" value={priceText(tip.price, null)} color={xc.gold} />
        </div>
      ) : null}

      {panel ? (
        <div className="glass-panel inv3d-panel">
          <Kicker color="var(--textFaint)">Selected residence</Kicker>
          <div className="inv3d-panel-title">{tower.name} <span>·</span> Floor {floorNo}</div>
          <div className="inv3d-panel-sub">{floorUnits.length} {floorUnits.length === 1 ? 'home' : 'homes'} on this floor</div>
          <FloorImage units={floorUnits} picked={picked} dim={(u) => (cfg && u.bhk !== cfg) || (statuses && !statuses.includes(u.status))} />
          {picked ? (
            <div className="inv3d-unit">
              <div className="inv3d-unit-facts">
                <div className="inv3d-unit-no">{picked.unit_no}</div>
                <div className="inv3d-unit-status" style={{ color: statusColor(picked.status), borderColor: statusColor(picked.status) }}>{STATUS_LABEL[picked.status] ?? picked.status}</div>
                <KV label="Type" value={picked.bhk ?? '—'} />
                <KV label="Area" value={areaText(picked.carpet_area, 'sqft')} />
                <KV label="Facing" value={picked.facing ?? '—'} />
                <KV label="Price" value={priceText(picked.price, null)} color={xc.gold} />
              </div>
              {plan ? <img className="inv3d-unit-plan" src={plan} alt="" /> : <FlatPlan className="inv3d-unit-plan" at={planAt} measured={s.unit_mode === 'sqft'} />}
            </div>
          ) : <div className="inv-hint">Choosing a home on the tablet…</div>}
        </div>
      ) : null}

      {panel && s.plan_full ? (
        <div className="inv3d-full">
          <div className="inv3d-full-title">{s.plan_full === 'flat' && picked ? `${picked.unit_no} · ${picked.bhk ?? ''}` : `${tower.name} · Floor ${floorNo}`}</div>
          <div className="inv3d-full-box">
            {s.plan_full === 'flat' && picked
              ? (plan ? <img src={plan} alt="" /> : <FlatPlan at={planAt} measured={s.unit_mode === 'sqft'} big />)
              : <FloorImage units={floorUnits} picked={picked} dim={(u) => (cfg && u.bhk !== cfg) || (statuses && !statuses.includes(u.status))} />}
          </div>
        </div>
      ) : null}

      {compare.length > 0 ? <CompareTable inv={inv} className="inv-compare-float" /> : null}
    </div>
  );
}

// SAMPLE measurements for the sample flat plans: room name, size, and where the tag sits on the image
// (fractions of its width / height). The sizes are placeholders until the builder's real room dimensions arrive.
const M = "14'0\" × 12'0\""; const B = "12'0\" × 11'0\""; const L = "16'0\" × 12'0\""; const D = "10'0\" × 9'0\""; const K = "10'0\" × 8'0\""; const T = "8'0\" × 5'0\"";
const FLAT_ROOMS = [
  [['Bedroom', B, 0.41, 0.25], ['Master bedroom', M, 0.78, 0.58], ['Living', L, 0.59, 0.70], ['Dining', D, 0.39, 0.58], ['Kitchen', K, 0.26, 0.45], ['Bath', T, 0.56, 0.40]],
  [['Master bedroom', M, 0.41, 0.27], ['Bedroom', B, 0.67, 0.57], ['Living', L, 0.57, 0.47], ['Dining', D, 0.34, 0.56], ['Kitchen', K, 0.49, 0.69], ['Bath', T, 0.24, 0.39]],
  [['Kitchen', K, 0.21, 0.22], ['Dining', D, 0.24, 0.44], ['Living', L, 0.29, 0.62], ['Bedroom', B, 0.60, 0.58], ['Master bedroom', M, 0.78, 0.43], ['Bath', T, 0.55, 0.25]],
  [['Kitchen', K, 0.45, 0.21], ['Dining', D, 0.58, 0.33], ['Living', L, 0.67, 0.46], ['Bedroom', B, 0.49, 0.66], ['Master bedroom', M, 0.28, 0.74], ['Bath', T, 0.31, 0.45]],
  [['Bedroom', B, 0.36, 0.38], ['Living', L, 0.49, 0.49], ['Master bedroom', M, 0.76, 0.57], ['Dining', D, 0.42, 0.67], ['Kitchen', K, 0.17, 0.51], ['Bath', T, 0.64, 0.72]],
  [['Bedroom', B, 0.25, 0.43], ['Kitchen', K, 0.49, 0.25], ['Dining', D, 0.56, 0.41], ['Living', L, 0.70, 0.56], ['Master bedroom', M, 0.59, 0.77], ['Bath', T, 0.41, 0.56]],
];
/** A sample flat plan fitted inside its box, with the room measurements tagged on it when the tablet's ruler is on. */
function FlatPlan({ at, measured, big, className }) {
  const box = useRef(null); const [fit, setFit] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => { const w = Math.min(el.clientWidth, el.clientHeight * 1.4); setFit({ w, h: w / 1.4 }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={`inv3d-flatplan ${big ? 'big' : ''} ${className ?? ''}`}>
      <div style={{ width: fit.w, height: fit.h }}>
        <img src={`${SAMPLE}flat0${at + 1}.webp`} alt="" />
        {measured ? FLAT_ROOMS[at].map(([name, size, x, y]) => <span key={name} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>{big ? <b>{name}</b> : null}{size}</span>) : null}
      </div>
    </div>
  );
}

/** The floor's rendered plan (sample content shipped with the app), each home marked with its number in its status colour. */
const SAMPLE = `${import.meta.env.BASE_URL}sample/`;
const FLOOR_SPOTS = [[0.12, 0.49], [0.34, 0.61], [0.83, 0.14], [0.83, 0.37], [0.85, 0.66], [0.58, 0.78]];
const sortedUnits = (units) => units.slice().sort((a, b) => String(a.unit_no).localeCompare(String(b.unit_no), undefined, { numeric: true }));
function FloorImage({ units, picked, dim }) {
  return (
    <div className="inv3d-floorimg">
      <img src={`${SAMPLE}floor.webp`} alt="" />
      {sortedUnits(units).slice(0, FLOOR_SPOTS.length).map((u, i) => {
        const on = picked?.unit_no === u.unit_no;
        return <span key={u.unit_no} className={on ? 'on' : ''} style={{ left: `${FLOOR_SPOTS[i][0] * 100}%`, top: `${FLOOR_SPOTS[i][1] * 100}%`, background: on ? '#ffd21f' : statusColor(u.status), opacity: dim(u) && !on ? 0.35 : 1 }}>{u.unit_no}</span>;
      })}
    </div>
  );
}

/** The floor seen from above, drawn from the same layout the 3D model uses: two rows of homes either side of the corridor. */
export function FloorPlate({ tower, floor, picked, dim }) {
  const L = useMemo(() => towerLayout(tower), [tower]);
  const units = L.byFloor.get(Number(floor)) ?? [];
  const W = 100; const rowH = 30; const gap = 9;
  return (
    <svg className="inv3d-plate" viewBox={`-3 -3 ${W + 6} ${rowH * 2 + gap + 6}`}>
      <rect x="0" y={rowH} width={W} height={gap} fill="rgba(255,255,255,0.08)" />
      {Array.from({ length: L.perFloor }, (_, i) => {
        const u = units[i]; const front = i < L.front;
        const n = front ? L.front : Math.max(L.back, 1); const j = front ? i : i - L.front;
        const w = W / n; const x = front ? j * w : W - (j + 1) * w; const y = front ? rowH + gap : 0;
        const on = u && picked && String(u.unit_no) === String(picked.unit_no);
        const color = !u ? 'rgba(255,255,255,0.10)' : on ? xc.gold : dim?.(u) ? 'rgba(255,255,255,0.16)' : statusColor(u.status);
        return (
          <g key={i}>
            <rect x={x + 0.8} y={y + 0.8} width={w - 1.6} height={rowH - 1.6} rx="1.6" fill={color} fillOpacity={on ? 1 : u ? 0.72 : 1} stroke={on ? '#fff' : 'rgba(255,255,255,0.35)'} strokeWidth={on ? 0.9 : 0.3} />
            {u ? <text x={x + w / 2} y={y + rowH / 2 + 1.6} textAnchor="middle" fontSize="4.6" fontWeight="700" fill={on ? '#16130c' : '#fff'}>{u.unit_no}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** The compare list as a table; floats over the stage, or sits inside the details panel. */
function CompareTable({ inv, className }) {
  const { compare, mode } = inv;
  const cols = compare.slice(0, COMPARE_COLUMNS);
  return (
    <div className={`glass-panel inv-compare ${className}`}>
      <div className="inv-panel-head"><Kicker>Compare</Kicker><div className="inv-compare-badge">{compare.length}</div></div>
      <table>
        <thead><tr><th />{cols.map(({ unit: u }) => <th key={u.unit_no}>{u.unit_no}</th>)}</tr></thead>
        <tbody>
          {[
            ['Tower', ({ tower: t }) => t.name],
            ['Floor', ({ unit: u }) => String(u.floor)],
            ['Type', ({ unit: u }) => u.bhk ?? '—'],
            ['Carpet', ({ unit: u }) => areaText(u.carpet_area, mode === 'sqm' ? 'sqm' : 'standard')],
            ['Facing', ({ unit: u }) => u.facing ?? '—'],
            ['Status', ({ unit: u }) => STATUS_LABEL[u.status] ?? u.status],
            ['Price', ({ unit: u }) => priceText(u.price, null)],
          ].map(([label, fn]) => (
            <tr key={label}><td className="inv-td-label">{label.toUpperCase()}</td>{cols.map((c) => <td key={c.unit.unit_no}>{fn(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Aerial: the render is the page; one compact card for the address and the towers ----------

function AerialView({ inv }) {
  const { data, s, towers, pack, totals } = inv;
  const projectCard = (
    <div className="glass-panel inv-project">
      <div className="inv-project-name">{data.location ?? data.address ?? data.name}</div>
      <div className="inv-project-count">
        <b>{totals.total}</b> {totals.total === 1 ? 'home' : 'homes'} · <b>{totals.available}</b> available
      </div>
      <div className="inv-tower-chips">
        {towers.map((t) => (
          <div key={String(t.id)} className={`inv-tower-chip ${sameId(t.id, s.tower_id) ? 'on' : ''}`}>
            {t.name}<span>{t.available}/{t.total}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (!pack?.aerial) {
    return (
      <div className="inv-aerial">
        {heroImage(data) ? <img className="inv-aerial-bg" src={heroImage(data)} alt="" /> : null}
        <div className="inv-aerial-tint" />
        <div className="inv-aerial-card">{projectCard}</div>
      </div>
    );
  }
  return (
    <div className="inv-aerial">
      <HotspotImage
        className="inv-fill"
        src={pack.aerial.image}
        size={pack.aerial.size}
        hotspots={(pack.aerial.towers ?? []).map((shape, i) => {
          const t = towers.find((x) => sameId(x.id, shape.tower_id));
          return { id: String(i), points: shape.points, color: t ? xc.available : xc.textFaint, disabled: !t, selected: !!t && sameId(t.id, s.tower_id) };
        })}
        pins={(pack.aerial.towers ?? []).filter((shape) => shape.label).map((shape) => {
          const t = towers.find((x) => sameId(x.id, shape.tower_id));
          return { x: shape.label[0], y: shape.label[1], title: t?.name ?? shape.placeholder ?? 'Not in inventory', sub: t ? `${t.available} of ${t.total} available` : 'Coming soon', on: !!t && sameId(t.id, s.tower_id) };
        })}
      />
      <div className="inv-aerial-card">{projectCard}</div>
    </div>
  );
}

// ---- Tower: the elevation as large as the stage allows --------------------------------------

function TowerView({ inv }) {
  const { elevation, shown, isOn, floorNo, cfg } = inv;
  const floorsDesc = useFloors(shown);
  if (elevation) {
    return (
      <HotspotImage
        className="inv-fill"
        src={elevation.image}
        size={elevation.size}
        hotspots={shown.flatMap((u) => {
          const points = elevation.units?.[u.unit_no];
          return points ? [{ id: String(u.unit_no), points, color: statusColor(u.status), selected: isOn(u) }] : [];
        })}
      />
    );
  }
  return (
    <div className="inv-grid">
      <div className="inv-grid-cap" />
      {floorsDesc.map(([f, us]) => (
        <div key={f} className={`inv-grid-row ${Number(f) === floorNo ? 'on' : ''}`}>
          <div className="inv-grid-floor">{f}</div>
          <div className="inv-grid-cells">
            {us.map((u) => (
              <div key={u.id ?? u.unit_no} className={`inv-cell ${isOn(u) ? 'on' : ''}`} style={{ background: `${statusColor(u.status)}44`, borderColor: `${statusColor(u.status)}99` }}>
                {u.unit_no}
              </div>
            ))}
          </div>
        </div>
      ))}
      {floorsDesc.length === 0 ? <div className="inv-hint">No {cfg} units in this tower.</div> : null}
      <div className="inv-grid-base" />
    </div>
  );
}

// ---- Floor: the plate, and a slim strip of unit chips under it -------------------------------

function FloorView({ inv }) {
  const { floorNo, plate, floorUnits, isOn, cfgOf, tip } = inv;
  if (floorNo == null) {
    return <div className="inv-center"><div className="inv-hint">Choosing a floor on the tablet…</div></div>;
  }
  let stage;
  if (plate) {
    stage = (
      <HotspotImage
        className="inv-fill"
        src={plate.image}
        size={plate.size}
        hotspots={floorUnits.flatMap((u) => {
          const points = plateShape(plate, u);
          return points ? [{ id: String(u.unit_no), points, color: statusColor(u.status), selected: isOn(u) }] : [];
        })}
        pins={floorUnits.flatMap((u) => {
          const points = plateShape(plate, u);
          if (!points) return [];
          const [x, y] = centroid(points);
          return [{ x, y, title: u.unit_no, sub: `${u.bhk ?? '—'} · ${STATUS_LABEL[u.status] ?? u.status}`, on: isOn(u) }];
        })}
      />
    );
  } else {
    const plan = cfgOf(tip?.bhk ?? floorUnits[0]?.bhk ?? null)?.image;
    stage = plan
      ? <img className="inv-plan" src={plan} alt="" />
      : <div className="inv-center"><Icon name="layers" size="2.6rem" color="var(--textFaint)" /><div className="inv-hint">No floor plan image for this configuration.</div></div>;
  }
  return (
    <div className="inv-floor">
      <div className="inv-floor-stage">{stage}</div>
      <div className="inv-unit-strip">
        {floorUnits.map((u) => (
          <div key={u.id ?? u.unit_no} className={`inv-unit-chip ${isOn(u) ? 'on' : ''}`}>
            <div className="inv-unit-dot" style={{ background: statusColor(u.status) }} />
            <div className="inv-unit-no">{u.unit_no}</div>
            <div className="inv-unit-type">{u.bhk ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Unit: the render takes the whole stage; details slide in on request --------------------

function UnitView({ inv }) {
  const { s, unit, unitRender, modes, mode, showDetails, compare, compareInPanel, plate, shown, towerUnits, cfgOf } = inv;

  const segmented = (
    <div className="inv-seg">
      {modes.map((m) => <div key={m} className={`inv-seg-item ${m === mode ? 'on' : ''}`}>{MODE_LABEL[m]}</div>)}
    </div>
  );

  const detailRows = [
    ['Unit', unit.unit_no], ['Type', unit.bhk ?? '—'], ['Status', STATUS_LABEL[unit.status] ?? unit.status],
    ['Carpet', areaText(unit.carpet_area, mode === '3d' ? 'standard' : mode)], ['Facing', unit.facing ?? '—'], ['Indicative price', priceText(unit.price, null)],
  ];
  const kvColor = (k) => (k === 'Status' ? statusColor(unit.status) : k === 'Indicative price' ? xc.gold : undefined);

  if (mode === '3d' && unitRender?.model) {
    const labels = (unitRender.rooms ?? []).filter((r) => r.at3d).map((r) => ({
      title: r.name,
      sub: `${metresText(r.ft, 1)} · ${r.ft[0]}' × ${r.ft[1]}'`,
      position: r.at3d,
    }));
    return (
      <div className="inv-unit3d">
        <div className="inv-unit-top">{segmented}</div>
        <div className="inv-model"><Model3D src={unitRender.model} labels={labels} cam={s.model_cam ?? {}} /></div>
        {showDetails ? (
          <div className="glass-panel inv-strip">
            {detailRows.map(([k, v]) => (
              <div key={k} className="inv-strip-item">
                <div className="inv-kv-label">{k.toUpperCase()}</div>
                <div className="inv-kv-value" style={kvColor(k) ? { color: kvColor(k) } : undefined}>{v}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // The on-floor context inside the details panel: the plate with this unit in gold, or a row of
  // status-coloured cells when the project has no plate.
  const context = (
    <div className="inv-context">
      <Kicker color="var(--textFaint)">{`On floor ${unit.floor}`}</Kicker>
      {plate ? (
        <HotspotImage
          className="inv-context-plate"
          src={plate.image}
          size={plate.size}
          idleOpacity={0.14}
          style={{ aspectRatio: `${plate.size[0]} / ${plate.size[1]}` }}
          hotspots={onFloor(shown, unit.floor).flatMap((u) => {
            const points = plateShape(plate, u);
            const me = sameId(u.unit_no, unit.unit_no);
            return points ? [{ id: String(u.unit_no), points, color: me ? xc.gold : statusColor(u.status), selected: me }] : [];
          })}
        />
      ) : (
        <div className="inv-ctx-cells">
          {onFloor(towerUnits, unit.floor).sort(byUnitNo).map((u) => (
            <div key={u.unit_no} className={`inv-ctx-cell ${sameId(u.unit_no, unit.unit_no) ? 'on' : ''}`} style={{ background: `${statusColor(u.status)}55` }} />
          ))}
        </div>
      )}
    </div>
  );

  const detailsPanel = showDetails ? (
    <div className="glass-panel inv-details-panel">
      <Kicker color="var(--textFaint)">Flat details</Kicker>
      <div>
        {detailRows.map(([k, v]) => <KV key={k} label={k} value={k === 'Status' ? String(v).toUpperCase() : v} color={kvColor(k)} />)}
        {compare.some((c) => sameId(c.unit.unit_no, unit.unit_no)) ? <div className="inv-compared"><Icon name="check" /> IN COMPARE</div> : null}
      </div>
      {compareInPanel && compare.length > 0 ? <CompareTable inv={inv} className="inv-compare-side" /> : context}
    </div>
  ) : null;

  const img = unitRender ? (mode === 'sqft' && unitRender.measured_image ? unitRender.measured_image : unitRender.image) : null;
  const plan = cfgOf(unit.bhk)?.image;
  return (
    <div className="inv-unit">
      <div className="inv-unit-top">{segmented}</div>
      <div className="inv-unit-image">
        {img ? (
          <HotspotImage
            className="inv-fill"
            src={img}
            size={unitRender.size}
            pins={mode === 'sqm' ? (unitRender.rooms ?? []).map((rm) => ({ x: rm.at[0], y: rm.at[1], title: rm.name, sub: metresText(rm.ft, 2) })) : []}
          />
        ) : plan ? (
          <img className="inv-plan" src={plan} alt="" />
        ) : (
          <div className="inv-center"><Icon name="home" size="2.6rem" color="var(--textFaint)" /><div className="inv-hint">No render for {unit.bhk ?? 'this unit'} yet.</div></div>
        )}
      </div>
      {detailsPanel}
    </div>
  );
}

/** Units grouped by floor, top floor first, each floor's units in unit-number order. */
function useFloors(units) {
  return useMemo(() => {
    const m = new Map();
    for (const u of units) {
      const f = Number(u.floor);
      if (!m.has(f)) m.set(f, []);
      m.get(f).push(u);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([f, us]) => [f, us.sort(byUnitNo)]);
  }, [units]);
}

function Crumb({ on, first = false, children }) {
  return (
    <>
      {first ? null : <Icon name="chevron-right" size="1.1rem" color="var(--textFaint)" />}
      <div className={`inv-crumb ${on ? 'on' : ''}`}>{children}</div>
    </>
  );
}

function KV({ label, value, color }) {
  return (
    <div className="inv-kv">
      <div className="inv-kv-label">{label.toUpperCase()}</div>
      <div className="inv-kv-value" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
