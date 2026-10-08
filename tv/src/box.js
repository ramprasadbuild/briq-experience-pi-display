// The TV app's link to the box it runs on, as React hooks. On the Linux box that is the Node
// daemon over loopback:
//
//   /local/events (WS)            {t:'status'|'identify'|'content'|'reload', …}  device pushes
//   /relay?role=viewer (WS)       {t:'state', state}                             presenter frames
//   /local/projects/<slug>.json   a presented project's local manifest
//
// Inside the Android TV WebView there is no daemon; the host bridge (host.js) delivers the same
// messages and answers the same requests. The screens never see the difference.
import { useEffect, useState } from 'react';
import { hostBridge, onHost, toHost } from './host.js';
import { projectData } from './project.js';
import { openSocket, wsBase } from './socket.js';

/** Device status + pushes: `status` (as /local/status.json), a timed `identify` overlay, and a `contentTick` that bumps when content switched. */
export function useDevice() {
  const [status, setStatus] = useState(null);
  const [identify, setIdentify] = useState(null);
  const [contentTick, setContentTick] = useState(0);
  const [connected, setConnected] = useState(hostBridge);
  useEffect(() => {
    const onMessage = (m) => {
      if (m.t === 'status') setStatus(m.status);
      else if (m.t === 'identify') setIdentify({ name: m.name, device_id: m.device_id, until: Date.now() + (m.seconds ?? 10) * 1000 });
      else if (m.t === 'content') setContentTick((n) => n + 1);
      else if (m.t === 'reload') location.reload();
    };
    if (hostBridge) return onHost(onMessage);
    return openSocket(`${wsBase()}/local/events`, {
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage,
    });
  }, []);
  useEffect(() => {
    if (!identify) return undefined;
    const t = setTimeout(() => setIdentify(null), Math.max(0, identify.until - Date.now()));
    return () => clearTimeout(t);
  }, [identify]);
  return { status, identify, contentTick, connected };
}

/** Presenter frames → `dispatch({type:'frame', state, at})` for the kioskState reducer. */
export function useRelayFrames(dispatch) {
  useEffect(() => {
    const onMessage = (m) => { if (m.t === 'state') dispatch({ type: 'frame', state: m.state, at: Date.now() }); };
    if (hostBridge) return onHost(onMessage);
    return openSocket(`${wsBase()}/relay?role=viewer`, { onMessage });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The presented project's local manifest: {state:'none'|'loading'|'ready'|'missing'|'error', …}.
 * Re-fetched on every `contentTick` so a sync that replaced the project is picked up; a re-fetch
 * that yields the same etag keeps the same object, so the screens don't reset.
 */
export function useProject(slug, contentTick) {
  const [project, setProject] = useState({ state: 'none' });
  useEffect(() => {
    if (!slug) { setProject({ state: 'none' }); return undefined; }
    let cancelled = false;
    setProject((p) => (p.slug === slug && p.state === 'ready' ? p : { state: 'loading', slug }));
    const ready = (manifest) => {
      if (cancelled) return;
      setProject((p) => (p.state === 'ready' && p.slug === slug && p.etag === manifest.etag ? p : { state: 'ready', slug, etag: manifest.etag, data: projectData(manifest) }));
    };
    if (hostBridge) {
      const off = onHost((m) => {
        if (m.t !== 'project' || m.slug !== slug || cancelled) return;
        if (m.state === 'ready' && m.manifest) ready(m.manifest);
        else if (m.state === 'missing') setProject({ state: 'missing', slug });
        else if (m.state === 'error') setProject({ state: 'error', slug, error: m.error ?? 'unavailable' });
      });
      toHost({ t: 'project', slug });
      return () => { cancelled = true; off(); };
    }
    fetch(`/local/projects/${encodeURIComponent(slug)}.json`, { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) return setProject({ state: 'missing', slug });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ready(await r.json());
      })
      .catch((err) => { if (!cancelled) setProject({ state: 'error', slug, error: err.message }); });
    return () => { cancelled = true; };
  }, [slug, contentTick]);
  return project;
}
