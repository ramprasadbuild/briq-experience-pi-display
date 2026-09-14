import { useEffect, useMemo, useReducer, useState } from 'react';
import { buildChapters } from './chapters.js';
import { initialView, viewReducer } from './kioskState.js';
import Brochure from './screens/Brochure.jsx';
import Home from './screens/Home.jsx';
import Idle from './screens/Idle.jsx';
import Inventory from './screens/Inventory.jsx';
import Location from './screens/Location.jsx';
import Renders from './screens/Renders.jsx';
import VR from './screens/VR.jsx';
import Walkthrough from './screens/Walkthrough.jsx';
import { openSocket, wsBase } from './socket.js';
import { Empty, Loading } from './ui/Chrome.jsx';

/** Device status + pushes from the daemon (loopback-only /local/events). */
function useDevice() {
  const [status, setStatus] = useState(null);
  const [identify, setIdentify] = useState(null);
  const [contentTick, setContentTick] = useState(0);
  const [connected, setConnected] = useState(false);
  useEffect(() => openSocket(`${wsBase()}/local/events`, {
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
    onMessage: (m) => {
      if (m.t === 'status') setStatus(m.status);
      else if (m.t === 'identify') setIdentify({ name: m.name, device_id: m.device_id, until: Date.now() + (m.seconds ?? 10) * 1000 });
      else if (m.t === 'content') setContentTick((n) => n + 1);
      else if (m.t === 'reload') location.reload();
    },
  }), []);
  useEffect(() => {
    if (!identify) return undefined;
    const t = setTimeout(() => setIdentify(null), Math.max(0, identify.until - Date.now()));
    return () => clearTimeout(t);
  }, [identify]);
  return { status, identify, contentTick, connected };
}

/** The presented project's local manifest. */
function useProject(slug, contentTick) {
  const [project, setProject] = useState({ state: 'none' });
  useEffect(() => {
    if (!slug) { setProject({ state: 'none' }); return undefined; }
    let cancelled = false;
    setProject((p) => (p.slug === slug && p.state === 'ready' ? p : { state: 'loading', slug }));
    fetch(`/local/projects/${encodeURIComponent(slug)}.json`, { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) return setProject({ state: 'missing', slug });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const manifest = await r.json();
        const keys = new Map((manifest.files ?? []).map((f) => [f.path, f.key]));
        const data = { ...manifest.payload, __keys: keys };
        if (!cancelled) setProject((p) => (p.state === 'ready' && p.slug === slug && p.etag === manifest.etag ? p : { state: 'ready', slug, etag: manifest.etag, data }));
      })
      .catch((err) => { if (!cancelled) setProject({ state: 'error', slug, error: err.message }); });
    return () => { cancelled = true; };
  }, [slug, contentTick]);
  return project;
}

const SCREENS = { home: Home, renders: Renders, inventory: Inventory, brochure: Brochure, vr: VR, walkthrough: Walkthrough, location: Location };

function Kiosk({ data, kiosk, status }) {
  const chapters = useMemo(() => buildChapters(data), [data]);
  const chapter = SCREENS[kiosk.chapter] ? kiosk.chapter : 'home';
  const Screen = SCREENS[chapter];
  const meta = chapters.find((c) => c.id === chapter) ?? null;
  return (
    <div className="kiosk" key={chapter}>
      <Screen data={data} s={kiosk[chapter] ?? {}} kiosk={kiosk} chapters={chapters} meta={meta} status={status} />
    </div>
  );
}

export default function App() {
  const { status, identify, contentTick, connected } = useDevice();
  const [view, dispatch] = useReducer(viewReducer, initialView);
  useEffect(() => openSocket(`${wsBase()}/relay?role=viewer`, {
    onMessage: (m) => { if (m.t === 'state') dispatch({ type: 'frame', state: m.state, at: Date.now() }); },
  }), []);
  const project = useProject(view.mode === 'present' ? view.slug : null, contentTick);

  let body;
  if (view.mode !== 'present') {
    body = <Idle status={status} connected={connected} />;
  } else if (project.state === 'ready') {
    body = <Kiosk data={project.data} kiosk={view.kiosk} status={status} />;
  } else if (project.state === 'missing') {
    body = (
      <Empty title="Not on this TV yet">
        “{view.slug}” hasn’t been downloaded to this TV. Assign the project to this TV in the CRM; it will be ready after the next sync.
      </Empty>
    );
  } else if (project.state === 'error') {
    body = <Empty title="Couldn’t open this project">{project.error}</Empty>;
  } else {
    body = <Loading label="Opening experience" />;
  }

  return (
    <div className="app">
      {body}
      {identify ? (
        <div className="identify">
          <div className="identify-card">
            <div className="kicker">THIS TV</div>
            <div className="identify-name">{identify.name || 'Unnamed TV'}</div>
            <div className="identify-id">Device {identify.device_id}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
