import { useLayoutEffect, useRef, useState } from 'react';
import { xc } from '../tokens.js';
import './HotspotImage.css';

/**
 * A render with shapes on top (the controller's HotspotImage, display-only). The picture is fitted
 * inside the box and an SVG of exactly the same size uses the image's own pixel coordinates as its
 * viewBox, so shapes traced once against the source line up at 1080p and 4K alike.
 */
export default function HotspotImage({ src, size, hotspots = [], pins = [], idleOpacity = 0.28, className = '', style }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [iw, ih] = size ?? [1, 1];
  const scale = box ? Math.min(box.w / iw, box.h / ih) : 0;
  const frame = box && scale > 0
    ? { left: (box.w - iw * scale) / 2, top: (box.h - ih * scale) / 2, width: iw * scale, height: ih * scale }
    : null;
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const pts = (p) => p.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div ref={ref} className={`hs-wrap ${className}`} style={style}>
      {frame ? (
        <div className="hs-frame" style={frame}>
          <img className="hs-img" src={src} alt="" />
          <svg className="hs-svg" viewBox={`0 0 ${iw} ${ih}`} preserveAspectRatio="none">
            {hotspots.map((h) => (
              <polygon
                key={h.id}
                className={h.selected ? 'hs-selected' : ''}
                points={pts(h.points)}
                fill={h.color}
                fillOpacity={h.selected ? 0.55 : h.disabled ? 0.12 : idleOpacity}
                stroke={h.selected ? xc.gold2 : h.color}
                strokeWidth={((h.selected ? 0.28 : 0.12) * remPx) / scale}
                strokeOpacity={h.disabled ? 0.35 : 0.95}
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {pins.map((p, i) => (
            <div key={i} className={`hs-pin ${p.on ? 'on' : ''}`} style={{ left: p.x * scale, top: p.y * scale }}>
              <div className="hs-pin-dot" />
              <div className="hs-pin-card">
                <div className="hs-pin-title">{p.title}</div>
                {p.sub ? <div className="hs-pin-sub">{p.sub}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
