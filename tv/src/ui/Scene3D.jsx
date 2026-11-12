import { useEffect, useRef } from 'react';
import { createScene } from '../scene3d/scene.js';

/**
 * The Inventory chapter's live 3D model (scene3d/scene.js) as a viewer: it takes no input and
 * eases towards whatever the tablet sends — level, tower, picked flat, filters and camera angle.
 * The same scene runs on the tablet, where the presenter drags and taps it.
 */
export default function Scene3D({ towers, state, className }) {
  const box = useRef(null);
  const scene = useRef(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const sc = createScene(box.current, { interactive: false, maxDpr: 1, hudScale: 1 });
    // The site model shipped with the app (tv/public/models). Without it the scene generates towers from the inventory.
    sc.setModel(`${import.meta.env.BASE_URL}models/township.glb`);
    scene.current = sc;
    return () => { scene.current = null; sc.dispose(); };
  }, []);

  // Rebuild only when the inventory itself changes (a status flip repaints, a new tower rebuilds).
  const stamp = JSON.stringify((towers ?? []).map((t) => [t.id, t.total_floors, (t.units ?? []).map((u) => [u.unit_no, u.floor, u.status])]));
  useEffect(() => {
    scene.current?.setData({ towers });
    scene.current?.setState(latest.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const key = JSON.stringify(state);
  useEffect(() => { scene.current?.setState(latest.current); }, [key]);

  return <div ref={box} className={className} style={{ position: 'absolute', inset: 0 }} />;
}
