import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import '@photo-sphere-viewer/virtual-tour-plugin/index.css';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { VirtualTourPlugin } from '@photo-sphere-viewer/virtual-tour-plugin';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChapterHead, Counter, Empty } from '../ui/Chrome.jsx';
import Icon from '../ui/Icon.jsx';
import './VR.css';

/**
 * Chapter 04 · VR — the same photo-sphere-viewer virtual tour as the tablet, display-only,
 * following `vr` {scene_idx, node_id, cam {yaw, pitch (radians), zoom (0–100)}}. Camera samples
 * arrive at ≤ 12/s and are eased toward every frame so the wall pans smoothly.
 */
export default function VR({ data, s, meta }) {
  const groups = useMemo(
    () => (data.scenes ?? []).map((scene, i) => ({ scene, i })).filter(({ scene }) => scene.type === 'walkthrough' && (scene.nodes?.length ?? 0) > 0),
    [data],
  );
  const group = groups.find((g) => g.i === Number(s.scene_idx)) ?? groups[0];
  if (!group) return <><Empty title="No 360° tour yet">No 360° walkthrough published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;

  const nodes = group.scene.nodes;
  const nodeId = nodes.some((n) => n.id === s.node_id) ? s.node_id : group.scene.start ?? nodes[0].id;
  const current = Math.max(0, nodes.findIndex((n) => n.id === nodeId));

  return (
    <div className="vr">
      <Tour key={group.i} nodes={nodes} nodeId={nodeId} cam={s.cam} />
      <ChapterHead data={data} meta={meta} />
      <div className="vr-room">
        <Counter current={current + 1} total={nodes.length} />
        <div className="pill"><Icon name="rotate-cw" color="var(--gold)" /><span>{(nodes[current]?.name ?? `Room ${current + 1}`).toUpperCase()}</span></div>
      </div>
      <div className="vr-bar">
        {groups.map((g) => (
          <div key={g.i} className={`vr-bar-item ${g.i === group.i ? 'on' : ''}`}>
            <Icon name="layers" />
            <span>{g.scene.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tour({ nodes, nodeId, cam }) {
  const el = useRef(null);
  const viewerRef = useRef(null);
  const target = useRef(null);
  const desired = useRef(nodeId);
  const ready = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  desired.current = nodeId;
  const nodesKey = JSON.stringify(nodes);

  useEffect(() => {
    const nameOf = (id) => nodes.find((n) => n.id === id)?.name ?? id;
    const tourNodes = nodes.map((n) => ({
      id: n.id,
      panorama: n.url,
      name: n.name ?? n.id,
      links: (n.links ?? []).map((l) => ({
        nodeId: l.to,
        name: nameOf(l.to),
        position: { yaw: ((l.yaw ?? 0) * Math.PI) / 180, pitch: ((l.pitch ?? 0) * Math.PI) / 180 },
      })),
    }));
    let viewer;
    try {
      viewer = new Viewer({
        container: el.current,
        navbar: false,
        loadingTxt: '',
        defaultZoomLvl: 0,
        mousewheel: false,
        mousemove: false,
        keyboard: false,
        touchmoveTwoFingers: false,
        plugins: [
          MarkersPlugin,
          [VirtualTourPlugin, { positionMode: 'manual', renderMode: '3d', nodes: tourNodes, startNodeId: nodeId, preload: true }],
        ],
      });
    } catch (e) {
      setError(String(e?.message ?? e));
      return undefined;
    }
    viewerRef.current = viewer;
    const tour = viewer.getPlugin(VirtualTourPlugin);
    const markers = viewer.getPlugin(MarkersPlugin);
    const label = (id) => {
      markers.clearMarkers();
      const node = tourNodes.find((n) => n.id === id);
      node?.links.forEach((link, i) => markers.addMarker({
        id: `lbl-${id}-${i}`,
        position: { yaw: link.position.yaw, pitch: link.position.pitch + 0.2 },
        html: `<span class="vr-link"><b>&#8599;</b> ${String(link.name).replace(/[<>&]/g, '')}</span>`,
        anchor: 'bottom center',
      }));
    };
    // Walking to another node while the start panorama is still loading aborts that load, so the
    // tablet's node is only applied once the viewer is ready (and reconciled right then).
    tour.addEventListener('node-changed', ({ node }) => {
      label(node?.id);
      if (!ready.current) {
        ready.current = true;
        setLoaded(true);
      }
      if (desired.current && node?.id !== desired.current) Promise.resolve(tour.setCurrentNode(desired.current)).catch(() => {});
    });
    viewer.addEventListener('panorama-error', () => setError('the panorama could not be loaded'));

    // Ease toward the tablet's camera.
    let raf = 0;
    const loop = () => {
      const t = target.current;
      if (t && viewer.getPosition) {
        const cur = viewer.getPosition();
        let dYaw = t.yaw - cur.yaw;
        dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
        const dPitch = t.pitch - cur.pitch;
        if (Math.abs(dYaw) > 0.0005 || Math.abs(dPitch) > 0.0005) {
          viewer.rotate({ yaw: cur.yaw + dYaw * 0.22, pitch: cur.pitch + dPitch * 0.22 });
        }
        if (Number.isFinite(t.zoom)) {
          const z = viewer.getZoomLevel();
          if (Math.abs(t.zoom - z) > 0.2) viewer.zoom(z + (t.zoom - z) * 0.22);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ready.current = false; viewer.destroy(); viewerRef.current = null; };
  }, [nodesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !nodeId || !ready.current) return;
    const tour = viewer.getPlugin(VirtualTourPlugin);
    if (tour.getCurrentNode?.()?.id === nodeId) return;
    Promise.resolve(tour.setCurrentNode(nodeId)).catch(() => {});
  }, [nodeId]);

  useEffect(() => {
    if (cam && Number.isFinite(Number(cam.yaw)) && Number.isFinite(Number(cam.pitch))) {
      target.current = { yaw: Number(cam.yaw), pitch: Number(cam.pitch), zoom: cam.zoom == null ? NaN : Number(cam.zoom) };
    }
  }, [cam]);

  return (
    <div className="vr-viewer">
      <div ref={el} className="vr-canvas" />
      {!loaded && !error ? <div className="vr-error"><div className="spinner" /><span>LOADING 360° VIEW…</span></div> : null}
      {error ? <div className="vr-error">360° VIEW UNAVAILABLE: {error.toUpperCase()}</div> : null}
    </div>
  );
}
