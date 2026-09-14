import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clamp } from '../tokens.js';
import { ChapterHead, Counter, Empty, Loading } from '../ui/Chrome.jsx';
import './Brochure.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const PDF_DATA = `${import.meta.env.BASE_URL}pdfjs/`;
const MAX_CANVAS = 8192;

/** Chapter 03 · Brochure — PDF.js (bundled) following `brochure` {page, zoom}. */
export default function Brochure({ data, s, meta }) {
  const url = data.brochure_url;
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) return undefined;
    setDoc(null);
    setError('');
    const task = pdfjs.getDocument({
      url,
      cMapUrl: `${PDF_DATA}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDF_DATA}standard_fonts/`,
      isEvalSupported: false,
    });
    let cancelled = false;
    task.promise.then((d) => { if (!cancelled) setDoc(d); }, (e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; task.destroy(); };
  }, [url]);

  if (!url) return <><Empty title="No brochure yet">No brochure published for this project yet.</Empty><ChapterHead data={data} meta={meta} /></>;

  const total = doc?.numPages ?? 0;
  const page = clamp(Math.round(Number(s.page) || 1), 1, Math.max(1, total));
  const zoom = clamp(Number(s.zoom) || 1, 0.5, 4);

  return (
    <div className="br">
      <div className="br-body">
        {doc ? <Rail doc={doc} page={page} /> : null}
        <div className="br-view">{doc ? <PageCanvas doc={doc} page={page} zoom={zoom} /> : null}</div>
      </div>
      <ChapterHead data={data} meta={meta} />
      <div className="br-bar">
        <Counter current={page} total={Math.max(total, 1)} />
        <div className="pill">{Math.round(zoom * 100)}%</div>
      </div>
      {!doc && !error ? <Loading label="Opening brochure" /> : null}
      {error ? <Empty title="This brochure can’t be shown">{error}</Empty> : null}
    </div>
  );
}

function PageCanvas({ doc, page, zoom }) {
  const wrap = useRef(null);
  const holder = useRef(null);
  const [size, setSize] = useState(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size) return undefined;
    let cancelled = false;
    let task = null;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const fit = Math.min(size.w / base.width, size.h / base.height);
      const dpr = window.devicePixelRatio || 1;
      let scale = fit * zoom * dpr;
      scale = Math.min(scale, MAX_CANVAS / base.width, MAX_CANVAS / base.height);
      const vp = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${(base.width * fit * zoom)}px`;
      canvas.style.height = `${(base.height * fit * zoom)}px`;
      task = p.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      await task.promise;
      if (!cancelled) holder.current?.replaceChildren(canvas);
    })().catch(() => {});
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, page, zoom, size]);

  return <div className="br-page" ref={wrap}><div className="br-holder" ref={holder} /></div>;
}

/** Page thumbnails, rendered one after another; the current one is highlighted and kept in view. */
function Rail({ doc, page }) {
  const [thumbs, setThumbs] = useState([]);
  const rail = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const count = Math.min(doc.numPages, 120);
      for (let i = 1; i <= count && !cancelled; i++) {
        const p = await doc.getPage(i);
        const base = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: 220 / base.width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const src = c.toDataURL('image/jpeg', 0.8);
        if (!cancelled) setThumbs((t) => [...t, src]);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [doc]);

  useEffect(() => {
    rail.current?.querySelector('.br-thumb.on')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [page, thumbs.length]);

  return (
    <div className="br-rail" ref={rail}>
      {thumbs.map((src, i) => (
        <div key={i} className={`br-thumb ${i + 1 === page ? 'on' : ''}`}>
          <img src={src} alt="" />
          <div className="br-thumb-n">{i + 1}</div>
        </div>
      ))}
    </div>
  );
}
