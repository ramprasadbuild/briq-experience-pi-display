import { lazy, Suspense, useMemo, useState } from 'react';
import { haversineKm, kmText, vcat, xc } from '../tokens.js';
import { ChapterHead, Empty, Kicker, Pill } from '../ui/Chrome.jsx';
import './Location.css';

const MapboxMap = lazy(() => import('../ui/MapboxMap.jsx'));

/**
 * Chapter 06 · AV Location — following `location` {poi, is_3d, measuring, map_cam}. The live
 * Mapbox map is used only when the box is online and has a token; otherwise (and if the map fails
 * to load) an offline schematic plots the site and landmarks to scale from their coordinates.
 */
export default function Location({ data, s, meta, status }) {
  const [mapFailed, setMapFailed] = useState(false);
  const site = data.lat != null && data.lng != null ? { lat: Number(data.lat), lng: Number(data.lng), name: data.name } : null;
  const places = useMemo(() => (data.vicinity ?? [])
    .map((v, i) => ({ ...v, i }))
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({
      ...v,
      lat: Number(v.lat),
      lng: Number(v.lng),
      color: vcat(v.category).color,
      upcoming: v.status === 'upcoming',
      distance: v.distance ?? (site ? kmText(haversineKm(site, { lat: Number(v.lat), lng: Number(v.lng) })) : undefined),
    })), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!site && places.length === 0) {
    return <><Empty title="No location yet" icon="map-pin">No coordinates published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;
  }

  const poi = s.poi == null ? null : Number(s.poi);
  const focus = poi != null ? places[poi] ?? null : null;
  const live = !!status?.mapbox_token && !!status?.online && navigator.onLine && !mapFailed;
  const byCat = places.reduce((acc, p, idx) => { (acc[p.category] ||= []).push({ ...p, idx }); return acc; }, {});
  const readout = s.measuring
    ? 'Measuring distances between places'
    : focus ? `${focus.name}${focus.distance ? ` · ${focus.distance} from site` : ''}` : (data.address ?? data.location ?? '');

  return (
    <div className="loc">
      <div className="loc-map">
        {live ? (
          <Suspense fallback={<Schematic site={site} places={places} poi={poi} />}>
            <MapboxMap token={status.mapbox_token} site={site} places={places} poi={poi} is3d={!!s.is_3d} cam={s.map_cam} onFail={() => setMapFailed(true)} />
          </Suspense>
        ) : (
          <Schematic site={site} places={places} poi={poi} />
        )}
      </div>

      <ChapterHead data={data} meta={meta} />
      <div className="loc-tools">
        <Pill icon="maximize" on={poi == null && !s.measuring}>All</Pill>
        <Pill icon="box" on={!!s.is_3d}>3D</Pill>
        <Pill icon="ruler" on={!!s.measuring}>Distance</Pill>
        {!live ? <Pill icon="wifi-off">Offline map</Pill> : null}
      </div>

      <div className="glass-panel loc-panel">
        <Kicker>The address</Kicker>
        <div className="loc-site">{data.name}</div>
        <div className="loc-readout">{readout}</div>
        <div className="loc-list">
          {Object.entries(byCat).map(([cat, items]) => (
            <div key={cat} className="loc-cat">
              <div className="loc-cat-head" style={{ color: vcat(cat).color }}>{vcat(cat).label.toUpperCase()}</div>
              {items.map((p) => (
                <div key={p.idx} className={`loc-row ${poi === p.idx ? 'on' : ''}`}>
                  <div className={`loc-pin ${p.upcoming ? 'upcoming' : ''}`} style={{ borderColor: p.color, background: p.upcoming ? 'transparent' : p.color, color: p.upcoming ? p.color : '#fff' }}>{p.idx + 1}</div>
                  <div className="loc-row-body">
                    <div className="loc-row-name">{p.name}</div>
                    {p.upcoming ? <div className="loc-row-sub">{p.by ? `${p.by} · ` : ''}due {p.eta ?? 'TBA'}</div> : null}
                  </div>
                  <div className="loc-row-sub">{p.upcoming ? 'COMING UP' : p.distance ?? ''}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Offline map: equirectangular plot around the site with 1/2/5 km rings, fitted left of the panel. */
function Schematic({ site, places, poi }) {
  const W = 1920;
  const H = 1080;
  const area = { x0: 80, x1: 1280, y0: 200, y1: 1020 }; // clear of the header, tools and address panel
  const pts = [site, ...places].filter(Boolean);
  const lat0 = site?.lat ?? pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p.lng * kx);
  const ys = pts.map((p) => -p.lat);
  const cx0 = site ? site.lng * kx : (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy0 = site ? -site.lat : (Math.min(...ys) + Math.max(...ys)) / 2;
  const halfX = Math.max(0.002, ...xs.map((x) => Math.abs(x - cx0)));
  const halfY = Math.max(0.002, ...ys.map((y) => Math.abs(y - cy0)));
  const scale = Math.min((area.x1 - area.x0) / 2 / halfX, (area.y1 - area.y0) / 2 / halfY) * 0.86; // px per degree
  const ox = (area.x0 + area.x1) / 2;
  const oy = (area.y0 + area.y1) / 2;
  const px = (p) => [ox + (p.lng * kx - cx0) * scale, oy + (-p.lat - cy0) * scale];
  const kmPx = scale / 111;
  const focus = poi != null ? places[poi] : null;

  return (
    <svg className="loc-schematic" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="loc-bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#1f1b17" />
          <stop offset="100%" stopColor={xc.bg} />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#loc-bg)" />
      {site ? [1, 2, 5].map((km) => (
        <g key={km}>
          <circle cx={ox} cy={oy} r={km * kmPx} fill="none" stroke={xc.lineGold} strokeDasharray="6 10" strokeWidth="1.5" />
          <text x={ox + km * kmPx * 0.707 + 8} y={oy - km * kmPx * 0.707} fill={xc.textFaint} fontSize="20" fontFamily="Jost, sans-serif">{km} km</text>
        </g>
      )) : null}
      {site && focus ? (() => { const [a, b] = px(site); const [c, d] = px(focus); return <line x1={a} y1={b} x2={c} y2={d} stroke={xc.gold} strokeWidth="4" strokeDasharray="14 10" strokeLinecap="round" />; })() : null}
      {places.map((p, i) => {
        const [x, y] = px(p);
        const on = poi === i;
        return (
          <g key={i} transform={`translate(${x} ${y})`} opacity={poi != null && !on ? 0.55 : 1}>
            <circle r={on ? 26 : 19} fill={p.upcoming ? '#fffdfa' : p.color} stroke={p.upcoming ? p.color : '#fffdfa'} strokeWidth="3" strokeDasharray={p.upcoming ? '5 4' : undefined} />
            <text textAnchor="middle" dy="7" fontSize={on ? 22 : 18} fontWeight="600" fill={p.upcoming ? p.color : '#fff'} fontFamily="Jost, sans-serif">{i + 1}</text>
            {on ? <g><rect x="34" y="-22" width={p.name.length * 14 + 28} height="44" rx="10" fill="rgba(11,10,9,0.86)" stroke={xc.lineGold} /><text x="48" dy="9" fontSize="26" fill={xc.text} fontFamily="Jost, sans-serif">{p.name}</text></g> : null}
          </g>
        );
      })}
      {site ? (() => {
        const [x, y] = px(site);
        return (
          <g transform={`translate(${x} ${y})`}>
            <circle r="30" fill={xc.gold} opacity="0.25" />
            <circle r="16" fill={xc.gold} stroke="#fffdfa" strokeWidth="4" />
            <text y="-40" textAnchor="middle" fontSize="28" fill={xc.text} fontFamily="Marcellus, serif">{site.name}</text>
          </g>
        );
      })() : null}
    </svg>
  );
}
