import { useMemo, useState } from 'react';
import { pad2 } from '../format.js';
import { masterPlanFor, ZONE_KIND_LABEL, zoneCountText } from '../masterplan/pack.js';
import { ChapterHead, Empty, Kicker, Loading, Pill } from '../ui/Chrome.jsx';
import MasterPlan3D from '../ui/MasterPlan3D.jsx';
import './MasterPlan.css';

/**
 * Chapter 07 · Master Plan — the township as a 3D model, following `masterplan`
 * {zone, lighting, rain, tour, cam}. The presenter turns, zooms and tours it on the tablet; this
 * screen shows the same model from the same camera, with the picked zone lit and its card beside
 * it, and the tour's stop along the bottom.
 */
export default function MasterPlan({ data, s, meta }) {
  const pack = useMemo(() => masterPlanFor(data), [data]);
  const [found, setFound] = useState([]);
  const [status, setStatus] = useState('loading');

  if (!pack) {
    return <><Empty title="No master plan yet" icon="map-pin">No master plan published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;
  }

  // The zones the model really has, in the pack's (tour) order — the tablet counts stops the same way.
  const stops = pack.zones.filter((z) => found.some((f) => f.id === z.id));
  const zone = stops.find((z) => z.id === s.zone) ?? null;
  const index = zone ? stops.indexOf(zone) : -1;
  const count = found.find((f) => f.id === s.zone)?.count ?? 0;
  const countText = zone ? zoneCountText(zone, count) : '';
  const touring = s.tour != null && !!zone;
  const lighting = s.lighting === 'evening' ? 'evening' : 'day';
  // The card covers the right of the screen; slide the picture left so the zone sits in what is left.
  const shiftX = zone ? -0.125 : 0;

  return (
    <div className="mp">
      <MasterPlan3D
        className="mp-stage"
        model={pack.model}
        zones={pack.zones}
        ambient={pack.ambient}
        state={{ zone: s.zone ?? null, lighting, rain: !!s.rain, shiftX, cam: s.cam ?? null }}
        onZones={setFound}
        onStatus={setStatus}
      />

      {status === 'loading' ? <div className="mp-veil"><Loading label="Preparing the township" /></div> : null}
      {status === 'error' ? <div className="mp-veil"><Empty title="3D view unavailable">The township model could not be shown on this TV.</Empty></div> : null}

      <ChapterHead data={data} meta={meta} />

      <div className="mp-light">
        <Pill on={lighting === 'day'}>Daylight</Pill>
        <Pill on={lighting === 'evening'}>Golden hour</Pill>
        {s.rain ? <Pill on>Rain</Pill> : null}
      </div>

      {zone ? (
        <div className="glass-panel mp-card" key={zone.id}>
          <Kicker>{`${ZONE_KIND_LABEL[zone.kind] ?? 'Zone'} · ${pad2(index + 1)} / ${pad2(stops.length)}`}</Kicker>
          <div className="mp-card-name">{zone.name}</div>
          {countText ? <div className="mp-card-count">{countText.toUpperCase()}</div> : null}
          <div className="mp-card-blurb">{zone.blurb}</div>
        </div>
      ) : null}

      {touring ? (
        <div className="mp-tour">
          <Kicker>Guided tour</Kicker>
          <div className="mp-tour-dots">
            {stops.map((z, i) => <span key={z.id} className={`mp-tour-dot ${i === index ? 'on' : i < index ? 'done' : ''}`} />)}
          </div>
          <div className="mp-tour-name">{zone.name.toUpperCase()}</div>
        </div>
      ) : null}
    </div>
  );
}
