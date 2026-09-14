import { useEffect, useMemo, useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import { Kicker } from '../ui/Chrome.jsx';
import { pad2 } from '../tokens.js';
import './Home.css';

const TOUR_MS = 26_000; // one full turn of the ring, as on the tablet

/**
 * Home — the kiosk's "select a chapter" screen: wordmark, headline, six chapter cards, and the orb
 * with its turning ring. `home.index` picks the highlighted chapter; while not paused the ring
 * keeps turning between the tablet's updates so the motion stays smooth on the wall.
 */
export default function Home({ data, s, chapters }) {
  const n = chapters.length || 1;
  const index = Math.min(Math.max(0, Number(s.index) || 0), n - 1);
  const paused = !!s.paused;
  const current = chapters[index];
  const ring = useRef(null);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now) => {
      let turn = index / n;
      if (!paused) turn += Math.min(1 / n, (now - start) / TOUR_MS);
      if (ring.current) ring.current.style.transform = `rotate(${turn * 360}deg)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [index, paused, n]);

  const subline = useMemo(() => {
    const bhks = [...new Set((data.configs ?? []).map((c) => String(c.bhk ?? '').replace(/\s*bhk.*/i, '')))].filter(Boolean);
    const floors = Math.max(0, ...(data.towers ?? []).map((t) => t.total_floors || 0));
    return [bhks.length ? `${bhks.join(', ')} BHK residences` : null, floors ? `${floors} storeys` : null, data.location].filter(Boolean).join(' · ');
  }, [data]);

  return (
    <div className="home">
      {data.hero_image || data.gallery?.[0] ? <img className="home-bg" src={data.hero_image ?? data.gallery[0]} alt="" /> : null}
      <div className="home-tint" />

      <div className="home-columns">
        <div className="home-left">
          <div className="home-head">
            {data.org?.logo_url ? <img className="home-logo" src={data.org.logo_url} alt="" /> : null}
            <div className="home-brand">{data.name}</div>
            {data.builder ? <div className="home-brand-sub">{data.builder.toUpperCase()}</div> : null}
            {subline ? <div className="home-subline">{subline.toUpperCase()}</div> : null}
          </div>

          <div className="home-headline">
            <h1 className="home-h1">{(data.tagline ?? 'A home composed around you.').trim()}</h1>
            {data.description ? <p className="home-lede">{data.description}</p> : null}
            <div className="home-select"><span className="home-rule" /><Kicker color="var(--textFaint)">Select a chapter</Kicker></div>
          </div>

          <div className="home-grid">
            {chapters.map((c, i) => {
              const on = i === index;
              return (
                <div key={c.id} className={`home-card ${on ? 'on' : ''} ${c.enabled ? '' : 'off'}`}>
                  <div className="home-card-no">{c.no}</div>
                  <div className="home-card-body">
                    <div className="home-card-name">{c.name.toUpperCase()}</div>
                    <div className="home-card-blurb">{c.blurb}</div>
                  </div>
                  {c.enabled ? (
                    <div className="home-card-arrow"><Icon name="arrow-right" /></div>
                  ) : (
                    <div className="home-soon">SOON</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="home-right">
          {current ? (
            <div className="orb-wrap">
              <div className="orb-ring" ref={ring}>
                <div className="orb-marker" />
                {chapters.map((_, i) => (
                  <div key={i} className="orb-dot" style={{ transform: `rotate(${(i / n) * 360}deg) translateY(calc(var(--ring) / -2))` }} />
                ))}
              </div>
              <div className="orb">
                {chapters.map((c, i) => (c.image ? <img key={c.id} className={`orb-img ${i === index ? 'on' : ''}`} src={c.image} alt="" /> : null))}
                <div className="orb-shade" />
                <div className="orb-shade-low" />
                <div className="orb-counter">{pad2(index + 1)} / {pad2(n)}</div>
                <div className="orb-text">
                  <Kicker>{current.kick}</Kicker>
                  <div className="orb-name">{current.name.toUpperCase()}</div>
                  <div className="orb-blurb">{current.blurb}</div>
                  <div className={`orb-enter ${current.enabled ? '' : 'off'}`}>{current.enabled ? 'NOW SHOWING' : 'COMING SOON'}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="home-foot">
        <div className="home-foot-brand">{(data.org?.name ?? data.builder ?? 'BriQ').toUpperCase()}</div>
        <div className="home-foot-auto"><span className={`home-foot-dot ${paused ? 'paused' : ''}`} />{paused ? 'PAUSED' : 'AUTO TOUR'}</div>
        <div className="home-foot-place">
          <div className="home-foot-kick">SALES GALLERY</div>
          <div className="home-foot-name">{(data.location ?? data.address ?? '').toUpperCase()}</div>
        </div>
      </div>
    </div>
  );
}
