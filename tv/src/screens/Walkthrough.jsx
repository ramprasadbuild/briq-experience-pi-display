import { useEffect, useRef, useState } from 'react';
import { ChapterHead, Empty } from '../ui/Chrome.jsx';
import Icon from '../ui/Icon.jsx';
import './Walkthrough.css';

/**
 * Chapter 05 · Walkthrough — the film from local content, synced to `walkthrough`
 * {playing, time, rate, muted, at}. The expected position is time + elapsed since `at` (the
 * sender's clock; our receive time if the clocks disagree by more than 5 s). We seek only when
 * drift exceeds 0.5 s, so normal playback is never interrupted.
 */
const DRIFT_S = 0.5;
const embedUrl = (url) => {
  const yt = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&mute=1&controls=0&rel=0`;
  const vimeo = String(url).match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1&muted=1&controls=0`;
  return null;
};
const fmt = (sec) => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function expectedTime(s, now = Date.now()) {
  const time = Number(s.time) || 0;
  if (!s.playing) return time;
  const at = Number(s.at);
  const received = Number(s.received_at) || now;
  const anchor = Number.isFinite(at) && Math.abs(received - at) < 5000 ? at : received;
  return time + (Math.max(0, now - anchor) / 1000) * (Number(s.rate) || 1);
}

export default function Walkthrough({ data, s, meta, status }) {
  const url = data.walkthrough_video;
  const original = data.__keys?.get(url) ?? url;
  const embed = url ? embedUrl(original) : null;
  const video = useRef(null);
  const sRef = useRef(s);
  sRef.current = s;
  const [st, setSt] = useState({ t: 0, d: 0, ready: false, error: false });

  const apply = () => {
    const v = video.current;
    const cur = sRef.current;
    if (!v) return;
    const rate = Number(cur.rate) || 1;
    if (v.playbackRate !== rate) v.playbackRate = rate;
    if (v.muted !== !!cur.muted && !v.dataset.forcedMute) v.muted = !!cur.muted;
    const want = expectedTime(cur);
    if (Number.isFinite(want) && v.readyState >= 1 && Math.abs(v.currentTime - want) > DRIFT_S) {
      v.currentTime = Math.min(want, Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.05) : want);
    }
    if (cur.playing && v.paused && !v.ended) {
      v.play().catch(() => {
        // Autoplay with sound refused (only outside the kiosk flags): play muted rather than not at all.
        v.muted = true;
        v.dataset.forcedMute = '1';
        v.play().catch(() => {});
      });
    } else if (!cur.playing && !v.paused) {
      v.pause();
    }
  };

  useEffect(apply, [s]);
  useEffect(() => {
    const id = setInterval(apply, 2000); // re-check drift during long stretches without updates
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!url) return <><Empty title="No film yet">No walkthrough film published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;

  if (embed) {
    const online = status?.online && navigator.onLine;
    return (
      <div className="wt">
        {online ? <iframe className="wt-embed" src={embed} allow="autoplay; encrypted-media" title="Walkthrough" /> : (
          <Empty title="This film isn’t available offline" icon="wifi-off">It’s a web link, not an uploaded file. Upload the film in the CRM so this TV can play it offline.</Empty>
        )}
        <ChapterHead data={data} meta={meta} />
      </div>
    );
  }

  const progress = st.d > 0 ? Math.min(1, st.t / st.d) : 0;
  const onState = () => {
    const v = video.current;
    if (v) setSt({ t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : 0, ready: v.readyState >= 2, error: false });
  };

  return (
    <div className="wt">
      <video
        ref={video}
        className="wt-video"
        src={url}
        poster={data.hero_image ?? data.gallery?.[0]}
        preload="auto"
        playsInline
        onLoadedMetadata={() => { onState(); apply(); }}
        onCanPlay={onState}
        onTimeUpdate={onState}
        onSeeked={onState}
        onWaiting={onState}
        onError={() => setSt((x) => ({ ...x, error: true }))}
      />
      <ChapterHead data={data} meta={meta} />
      {!st.ready ? (
        <div className="wt-center">
          {st.error ? null : <div className="spinner" />}
          <div className="loading-label">{st.error ? 'THIS FILM COULD NOT BE PLAYED ON THIS TV' : 'LOADING WALKTHROUGH…'}</div>
        </div>
      ) : null}
      <div className="wt-bar">
        <div className="wt-track"><div className="wt-fill" style={{ width: `${progress * 100}%` }} /><div className="wt-knob" style={{ left: `${progress * 100}%` }} /></div>
        <div className="wt-ctrls">
          <div className="wt-icon"><Icon name={s.playing ? 'pause' : 'play'} /></div>
          <div className="wt-icon"><Icon name={s.muted ? 'volume-x' : 'volume-2'} /></div>
          <div className="wt-time">{fmt(st.t)} / {fmt(st.d)}</div>
          <div className="wt-spacer" />
          {(Number(s.rate) || 1) !== 1 ? <div className="pill">{Number(s.rate)}×</div> : null}
        </div>
      </div>
    </div>
  );
}
