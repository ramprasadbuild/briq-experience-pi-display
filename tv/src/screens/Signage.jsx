import { useCallback, useEffect, useRef, useState } from 'react';
import './Signage.css';

const FADE_MS = 900;
/** A video that makes no progress for this long (a file the box can't decode, a stalled read) is skipped. */
const STALL_MS = 20_000;
/** When every item in a row fails, wait this long between attempts instead of spinning. */
const ALL_FAILED_PAUSE_MS = 5000;

/**
 * The idle loop: the box's own images and videos (uploaded from the Experience Center, stored on
 * the box), full screen, in order, forever. An image stays for `settings.image_seconds`; a video
 * plays to its end. The outgoing image stays underneath while the next one fades in.
 *
 * `signage` is {items: [{id, kind: 'image'|'video', url}], settings: {image_seconds, fit, sound}}
 * and may change while playing (the list is being edited): the loop carries on from the same
 * position.
 */
export default function Signage({ signage }) {
  const items = signage.items;
  const settings = signage.settings ?? {};
  const [pos, setPos] = useState(0);
  const [prev, setPrev] = useState(null);
  const failures = useRef(0);
  const item = items[pos % items.length];
  const itemRef = useRef(item);
  itemRef.current = item;
  const count = items.length;

  const advance = useCallback((failed = false) => {
    failures.current = failed ? failures.current + 1 : 0;
    const go = () => {
      const leaving = itemRef.current;
      setPrev(leaving?.kind === 'image' && !failed ? leaving : null);
      setPos((p) => p + 1);
    };
    if (failed && failures.current >= count) setTimeout(go, ALL_FAILED_PAUSE_MS);
    else go();
  }, [count]);

  // The outgoing slide is only needed for the crossfade.
  useEffect(() => {
    if (!prev) return undefined;
    const t = setTimeout(() => setPrev(null), FADE_MS + 100);
    return () => clearTimeout(t);
  }, [prev]);

  // Images advance on a timer; a lone image just stays.
  useEffect(() => {
    if (item.kind !== 'image' || count < 2) return undefined;
    const t = setTimeout(() => advance(), Math.max(2, Number(settings.image_seconds) || 8) * 1000);
    return () => clearTimeout(t);
  }, [pos, item.id, item.kind, count, settings.image_seconds, advance]);

  // Warm the next image so the fade never shows a half-decoded frame.
  useEffect(() => {
    const next = items[(pos + 1) % items.length];
    if (next && next.kind === 'image' && next.id !== item.id) new Image().src = next.url;
  }, [pos, items, item.id]);

  const fit = settings.fit === 'contain' ? 'contain' : 'cover';
  const key = `${pos}:${item.id}`;

  return (
    <div className="signage">
      {prev ? <img className="signage-slide" style={{ objectFit: fit }} src={prev.url} alt="" /> : null}
      {item.kind === 'video' ? (
        <LoopVideo key={key} item={item} fit={fit} sound={!!settings.sound} alone={count < 2} onDone={advance} />
      ) : (
        <img key={key} className="signage-slide signage-in" style={{ objectFit: fit }} src={item.url} alt="" onError={() => advance(true)} />
      )}
    </div>
  );
}

function LoopVideo({ item, fit, sound, alone, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    let last = -1;
    const watchdog = setInterval(() => {
      if (video.currentTime === last && !video.ended) onDone(true);
      last = video.currentTime;
    }, STALL_MS);
    // Autoplay with sound can be refused by the browser; the picture matters more than the audio.
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
    return () => {
      clearInterval(watchdog);
      // Free the hardware decoder right away rather than at garbage collection.
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <video
      ref={ref}
      className="signage-slide signage-in"
      style={{ objectFit: fit }}
      src={item.url}
      muted={!sound}
      playsInline
      preload="auto"
      loop={alone}
      onEnded={() => onDone()}
      onError={() => onDone(true)}
    />
  );
}
