import { useEffect, useRef } from 'react';
import { createMasterPlan } from '../masterplan/scene.js';

/**
 * The Master Plan chapter's township (masterplan/scene.js) as a viewer: it takes no input and
 * follows the tablet — the picked zone, the light, and the camera, which it eases towards so the
 * presenter's drags and flights read as one smooth move. The same scene runs on the tablet.
 */
export default function MasterPlan3D({ model, zones, ambient, state, onZones, onStatus, className }) {
  const box = useRef(null);
  const scene = useRef(null);
  const applied = useRef({});
  const cb = useRef({ onZones, onStatus });
  cb.current = { onZones, onStatus };

  const zonesKey = JSON.stringify((zones ?? []).map((z) => [z.id, z.match, z.name]));
  useEffect(() => {
    let sc;
    try {
      sc = createMasterPlan(box.current, {
        interactive: false, maxDpr: 1, pinScale: Math.max(1, (window.innerWidth / 1920) * 1.45),
        onEvent: (e) => {
          if (e.t !== 'model') return;
          if (e.state === 'ready') { cb.current.onZones?.(e.zones ?? []); cb.current.onStatus?.('ready'); }
          else if (e.state === 'error') cb.current.onStatus?.('error');
        },
      });
    } catch {
      // No WebGL on this box: the screen says so instead of showing an empty stage.
      cb.current.onStatus?.('error');
      return undefined;
    }
    sc.setZones(JSON.parse(zonesKey).map(([id, match, name]) => ({ id, match, name })));
    sc.setAmbient(ambient ?? null);
    sc.setModel(`${import.meta.env.BASE_URL}${model}`);
    scene.current = sc; applied.current = {};
    return () => { scene.current = null; sc.dispose(); };
  }, [model, zonesKey, ambient]);

  const { zone = null, lighting = 'day', rain = false, shiftX = 0, cam = null } = state ?? {};
  const camKey = cam ? JSON.stringify(cam) : '';
  useEffect(() => {
    const sc = scene.current; const last = applied.current;
    if (!sc) return;
    if (lighting !== last.lighting) sc.setLighting(lighting);
    if (rain !== last.rain) sc.setRain(rain);
    if (shiftX !== last.shiftX) sc.setShift(shiftX);
    // The camera comes from the tablet, so a pick only lights the zone here.
    if (zone !== last.zone) sc.select(zone, false);
    if (camKey && camKey !== last.camKey) sc.applyCam(JSON.parse(camKey));
    applied.current = { lighting, rain, shiftX, zone, camKey };
  }, [zone, lighting, rain, shiftX, camKey, model, zonesKey]);

  return <div ref={box} className={className} style={{ position: 'absolute', inset: 0 }} />;
}
