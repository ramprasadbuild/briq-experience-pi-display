import { useMemo } from 'react';
import { areaText, ordinal, priceText } from '../format.js';
import { heroImage } from '../project.js';
import { centroid, floorPlateFor, resolveRenderPack, unitPosition } from '../renderPack.js';
import { STATUS_LABEL, statusColor, xc } from '../tokens.js';
import { Empty, Kicker } from '../ui/Chrome.jsx';
import HotspotImage from '../ui/HotspotImage.jsx';
import Icon from '../ui/Icon.jsx';
import Model3D from '../ui/Model3D.jsx';
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

  return {
    data, s, towers, pack, tower, unit, tip, level, cfg, towerUnits, shown, floorNo, floorUnits, cfgOf, totals,
    elevation, plate, unitRender, modes, mode, isOn, compare, showDetails, compareInPanel,
  };
}

export default function Inventory({ data, s, meta }) {
  const inv = useInventory(data, s);
  if (!inv) {
    return <Empty title="No inventory yet">No inventory published for this project yet.</Empty>;
  }
  const { level, tower, unit, tip, floorNo, compare, showDetails, compareInPanel, mode } = inv;

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
