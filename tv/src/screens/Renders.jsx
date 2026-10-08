import { useEffect, useState } from 'react';
import { clamp } from '../format.js';
import { originalUrl } from '../project.js';
import { ChapterHead, Counter, Empty, Pill } from '../ui/Chrome.jsx';
import './Renders.css';

/**
 * Chapter 01 · Renders — the full-screen gallery following `renders` {index, playing, zoom,
 * pan_x, pan_y}. pan_x / pan_y are read as fractions of the stage size (0.1 = a tenth of the
 * width), applied before the zoom — the contract doesn't fix a unit; see README.
 *
 * The render fills the whole screen. One that is close to the screen's shape (a 16:9 render on a
 * 16:9 TV) is covered edge to edge; a very different shape (a portrait plan) is contained, so
 * nothing important is cropped away.
 */

// A render whose shape is within this band of the screen's is covered (at most ~18% cropped).
const FILL_MIN = 0.82;
const FILL_MAX = 1.22;

// Images already asked to decode, kept so the browser doesn't drop them before they're shown.
const predecoded = new Map();
function predecode(src) {
  if (!src || predecoded.has(src)) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  predecoded.set(src, img);
  if (img.decode) img.decode().catch(() => {});
  if (predecoded.size > 24) predecoded.delete(predecoded.keys().next().value);
}

export default function Renders({ data, s, meta }) {
  const gallery = data.gallery ?? [];
  // Whether each render is close enough to the screen's shape to fill it, learned as images load.
  const [fills, setFills] = useState({});
  const total = gallery.length;
  const index = clamp(Math.round(Number(s.index) || 0), 0, Math.max(0, total - 1));

  // Decode the neighbours ahead of time: a hidden (opacity 0) image isn't painted, so it would
  // otherwise be decoded only when it starts to fade in.
  useEffect(() => {
    for (const d of [0, 1, -1, 2]) predecode(gallery[(index + d + total) % total]);
  }, [gallery, index, total]);

  if (!gallery.length) {
    return <><Empty title="No renders yet">No renders published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;
  }
  const zoom = clamp(Number(s.zoom) || 1, 1, 3);
  const px = clamp(Number(s.pan_x) || 0, -1, 1) * 100;
  const py = clamp(Number(s.pan_y) || 0, -1, 1) * 100;
  const caption = captionFor(originalUrl(data, gallery[index]), index);
  const near = (i) => Math.abs(i - index) <= 1 || (index === 0 && i === total - 1) || (index === total - 1 && i === 0);

  const onLoad = (src, e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    const ratio = (w / h) / (window.innerWidth / window.innerHeight);
    const fill = ratio >= FILL_MIN && ratio <= FILL_MAX;
    setFills((f) => (f[src] === fill ? f : { ...f, [src]: fill }));
  };

  // Thumbnail strip: a window of up to 9 around the current image.
  const start = clamp(index - 4, 0, Math.max(0, total - 9));
  const thumbs = gallery.slice(start, start + 9).map((src, k) => ({ src, i: start + k }));

  return (
    <div className="rn">
      <div className="rn-stage">
        {gallery.map((src, i) => (near(i) ? (
          <img
            key={i}
            className={`rn-img ${fills[src] ? 'fill' : ''} ${i === index ? 'on' : ''}`}
            src={src}
            alt=""
            onLoad={(e) => onLoad(src, e)}
            style={i === index ? { transform: `translate(${px}%, ${py}%) scale(${zoom})` } : undefined}
          />
        ) : null))}
      </div>
      <div className="rn-shade-top" />
      <div className="rn-shade" />

      <ChapterHead data={data} meta={meta} />
      <div className="rn-caption">
        {s.playing ? <Pill icon="play" on>Slideshow</Pill> : null}
        <Pill>{caption}</Pill>
      </div>

      <Counter className="rn-counter" current={index + 1} total={total} />
      {zoom > 1.001 ? <div className="pill rn-zoom">{Math.round(zoom * 100)}%</div> : null}

      <div className="rn-strip">
        {thumbs.map(({ src, i }) => (
          <div key={i} className={`rn-thumb ${i === index ? 'on' : ''}`}><img src={src} alt="" loading="lazy" /></div>
        ))}
      </div>
    </div>
  );
}

/** A caption from the original file name ("hero-dusk.jpg" → "Hero Dusk"), like the tablet. */
function captionFor(src, i) {
  try {
    const name = decodeURIComponent(String(src).split('?')[0].split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
    const words = name.replace(/^[a-z0-9]+-cam-\d+-/i, '').replace(/[-_]+/g, ' ').trim();
    const meaningful = words.split(' ').filter((w) => /^[a-z]{3,}$/i.test(w) && w.toLowerCase() !== 'photo');
    if (meaningful.length > 0 && meaningful.length >= words.split(' ').length / 2) {
      return meaningful.join(' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 32);
    }
  } catch {
    // fall through
  }
  return `Render ${i + 1}`;
}
