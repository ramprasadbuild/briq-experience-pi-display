import { useMemo } from 'react';
import { centroid, resolveRenderPack, unitPosition } from '../renderPack.js';
import { areaText, ordinal, priceText, sqftRange, STATUS_LABEL, statusColor, xc } from '../tokens.js';
import { Empty, Kicker } from '../ui/Chrome.jsx';
import HotspotImage from '../ui/HotspotImage.jsx';
import Icon from '../ui/Icon.jsx';
import Model3D from '../ui/Model3D.jsx';
import './Inventory.css';

/**
 * Chapter 02 · Inventory — Aerial → Tower → Floor → Unit, following `inventory` from the tablet:
 * level, tower_id, floor, unit_no, tip_unit_no (tooltip / highlight), cfg (type filter),
 * unit_mode (standard | sqft | sqm | 3d), model_cam and the compare list. Render-pack shapes are
 * drawn in status colours when the project has them; grids and plans otherwise.
 */

const LEVELS = ['aerial', 'tower', 'floor', 'unit'];
const MODE_LABEL = { standard: 'Standard', sqft: 'Square Ft.', sqm: 'Square Mtr.', '3d': '3D View' };
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const byUnitNo = (a, b) => String(a.unit_no).localeCompare(String(b.unit_no), undefined, { numeric: true });

export default function Inventory({ data, s, meta }) {
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

  if (!tower) {
    return <Empty title="No inventory yet">No inventory published for this project yet.</Empty>;
  }

  let level = LEVELS.includes(s.level) ? s.level : 'aerial';
  if (level === 'unit' && !unit) level = 'floor';
  const cfg = s.cfg ?? null;
  const towerUnits = tower.units ?? [];
  const shown = towerUnits.filter((u) => !cfg || u.bhk === cfg);
  const floorNo = s.floor != null ? Number(s.floor) : unit ? Number(unit.floor) : tip ? Number(tip.floor) : null;
  const floorUnits = shown.filter((u) => Number(u.floor) === floorNo).sort(byUnitNo);
  const cfgOf = (bhk) => (data.configs ?? []).find((c) => c.bhk === bhk);
  const types = [...new Set(towerUnits.map((u) => u.bhk).filter(Boolean))];
  const allUnits = towers.flatMap((t) => t.units ?? []);
  const totals = {
    total: data.availability?.total ?? allUnits.length,
    available: data.availability?.available ?? allUnits.filter((u) => u.status === 'available').length,
  };
  const elevation = pack?.elevations?.[String(tower.id)] ?? null;
  const plate = pack?.floor_plates?.[String(tower.id)] ?? null;
  const unitRender = unit ? pack?.units?.[unit.bhk ?? ''] ?? null : null;
  const modes = unitRender?.model ? ['standard', 'sqft', 'sqm', '3d'] : ['standard', 'sqft', 'sqm'];
  const mode = modes.includes(s.unit_mode) ? s.unit_mode : 'standard';
  const isOn = (u) => sameId(u?.unit_no, tip?.unit_no) || sameId(u?.unit_no, unit?.unit_no);
  const compare = (Array.isArray(s.compare) ? s.compare : []).map((no) => lookup.get(String(no))).filter(Boolean);

  const compareInSide = level === 'unit' && !!unit && mode !== '3d';
  const renderCompare = (extra) => (
    <div className={`glass-panel inv-compare ${extra}`}>
      <div className="inv-panel-head"><Kicker>Compare units</Kicker><div className="inv-compare-badge">{compare.length}</div></div>
      <table>
        <thead><tr><th />{compare.slice(0, 4).map(({ unit: u }) => <th key={u.unit_no}>{u.unit_no}</th>)}</tr></thead>
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
            <tr key={label}><td className="inv-td-label">{label.toUpperCase()}</td>{compare.slice(0, 4).map((c) => <td key={c.unit.unit_no}>{fn(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ---- Levels ----------------------------------------------------------------------------

  const projectCard = (
    <div className="glass-panel inv-project">
      <Kicker color="var(--textFaint)">The address</Kicker>
      <div className="inv-project-name">{data.location ?? data.address ?? data.name}</div>
      <div className="inv-project-blurb">
        {towers.length === 1 ? 'One tower' : `${towers.length} towers`}
        {data.description ? ` · ${data.description.split(/[.!?]/)[0].trim()}.` : '.'}
      </div>
      <div className="inv-stats">
        <div><div className="inv-big">{totals.total}</div><div className="inv-tiny">UNITS TOTAL</div></div>
        <div><div className="inv-big">{totals.available}</div><div className="inv-tiny">AVAILABLE</div></div>
      </div>
      <div className="inv-rule" />
      <div className="inv-field-label">Explore towers</div>
      <div className="inv-tower-cards">
        {towers.map((t) => {
          const pct = t.total ? t.available / t.total : 0;
          return (
            <div key={String(t.id)} className={`inv-tower-card ${sameId(t.id, s.tower_id) ? 'on' : ''}`}>
              <div className="inv-tower-name">{t.name}</div>
              <div className="inv-tower-units">{t.total} units</div>
              <div className="inv-bar"><div style={{ width: `${Math.round(pct * 100)}%` }} /></div>
              <div className="inv-tiny">{t.available} AVAILABLE</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const aerial = pack?.aerial ? (
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
  ) : (
    <div className="inv-aerial">
      {data.hero_image || data.gallery?.[0] ? <img className="inv-aerial-bg" src={data.hero_image ?? data.gallery[0]} alt="" /> : null}
      <div className="inv-aerial-tint" />
      <div className="inv-aerial-card">{projectCard}</div>
    </div>
  );

  const floorsDesc = useFloors(shown);
  const tower_ = elevation ? (
    <HotspotImage
      className="inv-fill"
      src={elevation.image}
      size={elevation.size}
      hotspots={shown.flatMap((u) => {
        const points = elevation.units?.[u.unit_no];
        return points ? [{ id: String(u.unit_no), points, color: statusColor(u.status), selected: isOn(u) }] : [];
      })}
    />
  ) : (
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

  const floor = floorNo == null ? (
    <div className="inv-center"><div className="inv-hint">Choosing a floor on the tablet…</div></div>
  ) : (
    <div className="inv-floor">
      <Kicker>{`${tower.name} · Floor ${floorNo} · ${floorUnits.length} units`}</Kicker>
      <div className="inv-floor-stage">
        {plate ? (
          <HotspotImage
            className="inv-fill"
            src={plate.image}
            size={plate.size}
            hotspots={floorUnits.flatMap((u) => {
              const points = plate.positions?.[String(unitPosition(u.unit_no))];
              return points ? [{ id: String(u.unit_no), points, color: statusColor(u.status), selected: isOn(u) }] : [];
            })}
            pins={floorUnits.flatMap((u) => {
              const points = plate.positions?.[String(unitPosition(u.unit_no))];
              if (!points) return [];
              const [x, y] = centroid(points);
              return [{ x, y, title: u.unit_no, sub: `${u.bhk ?? '—'} · ${STATUS_LABEL[u.status] ?? u.status}`, on: isOn(u) }];
            })}
          />
        ) : (() => {
          const plan = cfgOf(tip?.bhk ?? floorUnits[0]?.bhk ?? null)?.image;
          return plan
            ? <img className="inv-plan" src={plan} alt="" />
            : <div className="inv-center"><Icon name="layers" size="2.6rem" color="var(--textFaint)" /><div className="inv-hint">No floor plan image for this configuration.</div></div>;
        })()}
      </div>
      <div className="inv-unit-cards">
        {floorUnits.map((u) => (
          <div key={u.id ?? u.unit_no} className={`inv-unit-card ${isOn(u) ? 'on' : ''}`} style={{ borderColor: isOn(u) ? undefined : `${statusColor(u.status)}99` }}>
            <div className="inv-unit-dot" style={{ background: statusColor(u.status) }} />
            <div className="inv-unit-no">{u.unit_no}</div>
            <div className="inv-unit-type">{u.bhk ?? '—'}</div>
            <div className="inv-tiny">{u.carpet_area ? `${Math.round(Number(u.carpet_area))} SQ FT` : (STATUS_LABEL[u.status] ?? '').toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const segmented = (
    <div className="inv-seg">
      {modes.map((m) => <div key={m} className={`inv-seg-item ${m === mode ? 'on' : ''}`}>{MODE_LABEL[m]}</div>)}
    </div>
  );

  const details = unit ? (
    <div className="glass-panel inv-details">
      <Kicker color="var(--textFaint)">Flat details</Kicker>
      <KV label="Unit" value={unit.unit_no} />
      <KV label="Unit type" value={unit.bhk ?? '—'} />
      <KV label="Unit status" value={(STATUS_LABEL[unit.status] ?? unit.status).toUpperCase()} color={statusColor(unit.status)} />
      <KV label="Carpet area" value={areaText(unit.carpet_area, mode === '3d' ? 'standard' : mode)} />
      {unit.facing ? <KV label="Facing" value={unit.facing} /> : null}
      <KV label="Indicative price" value={priceText(unit.price, null)} color={xc.gold} />
      {(() => { const c = cfgOf(unit.bhk); return c ? <KV label={`${c.bhk} range`} value={`${sqftRange(c.min_carpet, c.max_carpet)} sqft · ${priceText(c.min_price, c.max_price)}`} /> : null; })()}
      {compare.some((c) => sameId(c.unit.unit_no, unit.unit_no)) ? <div className="inv-compared"><Icon name="check" /> IN COMPARE</div> : null}
    </div>
  ) : null;

  let unitView = null;
  if (unit && mode === '3d' && unitRender?.model) {
    const labels = (unitRender.rooms ?? []).filter((r) => r.at3d).map((r) => ({
      title: r.name,
      sub: `${(r.ft[0] * 0.3048).toFixed(1)} × ${(r.ft[1] * 0.3048).toFixed(1)} m · ${r.ft[0]}' × ${r.ft[1]}'`,
      position: r.at3d,
    }));
    unitView = (
      <div className="inv-unit3d">
        <div className="inv-unit-top">{segmented}</div>
        <div className="inv-model"><Model3D src={unitRender.model} labels={labels} cam={s.model_cam ?? {}} /></div>
        <div className="glass-panel inv-strip">
          {[
            ['Unit', unit.unit_no], ['Type', unit.bhk ?? '—'], ['Status', STATUS_LABEL[unit.status] ?? unit.status],
            ['Carpet', areaText(unit.carpet_area, 'standard')], ['Facing', unit.facing ?? '—'], ['Indicative price', priceText(unit.price, null)],
          ].map(([k, v]) => (
            <div key={k} className="inv-strip-item">
              <div className="inv-kv-label">{k.toUpperCase()}</div>
              <div className="inv-kv-value" style={k === 'Status' ? { color: statusColor(unit.status) } : undefined}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (unit) {
    const img = unitRender ? (mode === 'sqft' && unitRender.measured_image ? unitRender.measured_image : unitRender.image) : null;
    const plan = cfgOf(unit.bhk)?.image;
    unitView = (
      <div className="inv-unit">
        <div className="inv-unit-stage">
          <div className="inv-unit-top">{segmented}</div>
          <div className="inv-unit-image">
            {img ? (
              <HotspotImage
                className="inv-fill"
                src={img}
                size={unitRender.size}
                pins={mode === 'sqm' ? (unitRender.rooms ?? []).map((rm) => ({ x: rm.at[0], y: rm.at[1], title: rm.name, sub: `${(rm.ft[0] * 0.3048).toFixed(2)} × ${(rm.ft[1] * 0.3048).toFixed(2)} m` })) : []}
              />
            ) : plan ? (
              <img className="inv-plan" src={plan} alt="" />
            ) : (
              <div className="inv-center"><Icon name="home" size="2.6rem" color="var(--textFaint)" /><div className="inv-hint">No render for {unit.bhk ?? 'this unit'} yet.</div></div>
            )}
          </div>
        </div>
        <div className="inv-unit-side">
          {details}
          {compareInSide && compare.length > 0 ? renderCompare('inv-compare-side') : (
          <div className="inv-context">
            <Kicker color="var(--textFaint)">{`On floor ${unit.floor}`}</Kicker>
            {plate ? (
              <HotspotImage
                className="inv-context-plate"
                src={plate.image}
                size={plate.size}
                idleOpacity={0.14}
                style={{ aspectRatio: `${plate.size[0]} / ${plate.size[1]}` }}
                hotspots={shown.filter((u) => Number(u.floor) === Number(unit.floor)).flatMap((u) => {
                  const points = plate.positions?.[String(unitPosition(u.unit_no))];
                  const me = sameId(u.unit_no, unit.unit_no);
                  return points ? [{ id: String(u.unit_no), points, color: me ? xc.gold : statusColor(u.status), selected: me }] : [];
                })}
              />
            ) : (
              <div className="inv-ctx-cells">
                {towerUnits.filter((u) => Number(u.floor) === Number(unit.floor)).sort(byUnitNo).map((u) => (
                  <div key={u.unit_no} className={`inv-ctx-cell ${sameId(u.unit_no, unit.unit_no) ? 'on' : ''}`} style={{ background: `${statusColor(u.status)}55` }} />
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    );
  }

  const main = level === 'aerial' ? aerial : level === 'tower' ? tower_ : level === 'floor' ? floor : unitView;

  const filters = (
    <aside className="glass-panel inv-side">
      <div className="inv-panel-head">
        <Kicker color="var(--textFaint)">Filters</Kicker>
        <div className="inv-panel-count"><div className="inv-big">{shown.length}</div><div className="inv-tiny">UNITS</div></div>
      </div>
      {types.length > 0 ? (
        <div className="inv-field">
          <div className="inv-field-label">Type</div>
          <div className="inv-chips">
            <div className={`inv-chip ${!cfg ? 'on' : ''}`}>All residences</div>
            {types.map((t) => <div key={t} className={`inv-chip ${cfg === t ? 'on' : ''}`}>{t}</div>)}
          </div>
        </div>
      ) : null}
      <div className="inv-field">
        <div className="inv-field-label">Unit status</div>
        <div className="inv-legend">
          {['available', 'hold', 'sold'].map((st) => (
            <div key={st} className="inv-legend-item"><span className="inv-swatch" style={{ background: statusColor(st) }} />{STATUS_LABEL[st].toUpperCase()}</div>
          ))}
        </div>
      </div>
      {towers.length > 1 ? (
        <div className="inv-field">
          <div className="inv-field-label">Towers</div>
          <div className="inv-chips">{towers.map((t) => <div key={String(t.id)} className={`inv-chip ${t === tower ? 'filled' : ''}`}>{t.name}</div>)}</div>
        </div>
      ) : null}
      <div className="inv-field">
        <div className="inv-field-label">Floor</div>
        <div className="inv-select">{floorNo != null ? `Floor ${floorNo}` : 'All floors'}</div>
      </div>
      <div className="inv-field">
        <div className="inv-field-label">{tower.name}</div>
        <div className="inv-bar"><div style={{ width: `${Math.round((tower.total ? tower.available / tower.total : 0) * 100)}%` }} /></div>
        <div className="inv-tiny">{tower.available} OF {tower.total} AVAILABLE</div>
      </div>
    </aside>
  );

  return (
    <div className="inv">
      {level === 'aerial' ? main : (
        <div className="inv-body">
          {filters}
          <div className="inv-main">{main}</div>
        </div>
      )}

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

      {compare.length > 0 && !compareInSide ? renderCompare('inv-compare-float') : null}
    </div>
  );
}

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
