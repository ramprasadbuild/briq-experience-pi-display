import '@google/model-viewer';
import { useEffect, useRef, useState } from 'react';
import './Model3D.css';

/**
 * The rotatable dollhouse (<model-viewer>, bundled — no CDN). The tablet's camera arrives as
 * `inventory.model_cam` {theta, phi (degrees), radius (metres or null), spin, labels}; model-viewer
 * interpolates between samples so 12/s updates look continuous.
 */
export default function Model3D({ src, labels = [], cam = {} }) {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const theta = Number.isFinite(Number(cam.theta)) ? Number(cam.theta) : 35;
  const phi = Number.isFinite(Number(cam.phi)) ? Number(cam.phi) : 55;
  const radius = cam.radius != null && Number.isFinite(Number(cam.radius)) ? `${Number(cam.radius)}m` : 'auto';
  const orbit = `${theta}deg ${phi}deg ${radius}`;

  useEffect(() => {
    const mv = ref.current;
    if (!mv) return undefined;
    setLoaded(false);
    setError('');
    const onLoad = () => setLoaded(true);
    const onError = (e) => setError(String(e?.detail?.type ?? 'the model could not be loaded'));
    mv.addEventListener('load', onLoad);
    mv.addEventListener('error', onError);
    return () => { mv.removeEventListener('load', onLoad); mv.removeEventListener('error', onError); };
  }, [src]);

  useEffect(() => {
    const mv = ref.current;
    if (!mv) return;
    mv.cameraOrbit = orbit;
    // Spin on the wall follows the tablet's toggle; the tablet's own camera samples win while it's off.
    mv.autoRotate = !!cam.spin;
  }, [orbit, cam.spin]);

  return (
    <div className={`m3d ${cam.labels === false ? 'nolabels' : ''}`}>
      <model-viewer
        ref={ref}
        src={src}
        camera-orbit={orbit}
        min-camera-orbit="auto 0deg auto"
        max-camera-orbit="auto 86deg auto"
        field-of-view="30deg"
        interpolation-decay="90"
        rotation-per-second="14deg"
        auto-rotate-delay="0"
        interaction-prompt="none"
        shadow-intensity="1"
        shadow-softness="0.9"
        exposure="1.1"
        environment-image="neutral"
      >
        {labels.map((l, i) => (
          <div key={i} className="m3d-hs" slot={`hotspot-${i}`} data-position={l.position.map((v) => `${v}m`).join(' ')} data-normal="0m 1m 0m">
            <b>{l.title}</b>
            {l.sub ? <span>{l.sub}</span> : null}
          </div>
        ))}
      </model-viewer>
      {!loaded ? <div className="m3d-cover">{error ? `3D VIEW UNAVAILABLE: ${error.toUpperCase()}` : 'LOADING 3D MODEL…'}</div> : null}
    </div>
  );
}
