import { clamp } from '../tokens.js';
import { ChapterHead, Counter, Empty, Pill } from '../ui/Chrome.jsx';
import './Renders.css';

/**
 * Chapter 01 · Renders — the full-screen gallery following `renders` {index, playing, zoom,
 * pan_x, pan_y}. pan_x / pan_y are read as fractions of the stage size (0.1 = a tenth of the
 * width), applied before the zoom — the contract doesn't fix a unit; see README.
 */
export default function Renders({ data, s, meta }) {
  const gallery = data.gallery ?? [];
  if (!gallery.length) {
    return <><Empty title="No renders yet">No renders published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;
  }
  const total = gallery.length;
  const index = clamp(Math.round(Number(s.index) || 0), 0, total - 1);
  const zoom = clamp(Number(s.zoom) || 1, 1, 3);
  const px = clamp(Number(s.pan_x) || 0, -1, 1) * 100;
  const py = clamp(Number(s.pan_y) || 0, -1, 1) * 100;
  const caption = captionFor(data.__keys?.get(gallery[index]) ?? gallery[index], index);
  const near = (i) => Math.abs(i - index) <= 1 || (index === 0 && i === total - 1) || (index === total - 1 && i === 0);

  // Thumbnail strip: a window of up to 9 around the current image.
  const start = clamp(index - 4, 0, Math.max(0, total - 9));
  const thumbs = gallery.slice(start, start + 9).map((src, k) => ({ src, i: start + k }));

  return (
    <div className="rn">
      <div className="rn-stage">
        {gallery.map((src, i) => (near(i) ? (
          <img
            key={i}
            className={`rn-img ${i === index ? 'on' : ''}`}
            src={src}
            alt=""
            style={i === index ? { transform: `translate(${px}%, ${py}%) scale(${zoom})` } : undefined}
          />
        ) : null))}
      </div>
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
