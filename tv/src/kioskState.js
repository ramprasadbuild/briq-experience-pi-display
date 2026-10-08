// Presenter protocol v2 (SHOWROOM-CONTRACT §6.2, §6.3) as a reducer over relay frames.
//
// A frame is either a command — `{cmd:'present', slug, lead}`, `{cmd:'idle'}`, or the legacy
// `{cmd:'load', url}` — or a kiosk state: `{v:2, slug, chapter, <chapter>: {…}}` carrying only the
// chapters the tablet changed. The view is {mode, slug, lead, kiosk}; `kiosk` is the full merged
// state the screens read.

export const CHAPTERS = ['home', 'renders', 'inventory', 'brochure', 'vr', 'walkthrough', 'location'];

/** Every chapter's state at the moment a project is presented. */
export function defaultKiosk(slug) {
  return {
    v: 2,
    slug,
    chapter: 'home',
    home: { index: 0, paused: false },
    renders: { index: 0, playing: false, zoom: 1, pan_x: 0, pan_y: 0 },
    inventory: {
      level: 'aerial', tower_id: null, floor: null, unit_no: null, tip_unit_no: null, cfg: null, unit_mode: 'standard',
      model_cam: { theta: 35, phi: 55, radius: null, spin: true, labels: true }, compare: [], show_details: false,
    },
    brochure: { page: 1, zoom: 1 },
    vr: { scene_idx: null, node_id: null, cam: null },
    walkthrough: { playing: false, time: 0, rate: 1, muted: false, at: null },
    location: { poi: null, is_3d: false, measuring: false, map_cam: null },
  };
}

/** Shallow-merges each chapter object so a sender may omit fields it didn't change. */
export function mergeKiosk(base, incoming, receivedAt = Date.now()) {
  const next = { ...base, v: 2 };
  if (typeof incoming.slug === 'string') next.slug = incoming.slug;
  if (CHAPTERS.includes(incoming.chapter)) next.chapter = incoming.chapter;
  for (const key of CHAPTERS) {
    const value = incoming[key];
    if (value && typeof value === 'object') {
      next[key] = { ...base[key], ...value };
      // model_cam is the one nested object a sender may send partially (e.g. just `spin`).
      if (key === 'inventory' && value.model_cam && typeof value.model_cam === 'object') {
        next.inventory.model_cam = { ...base.inventory.model_cam, ...value.model_cam };
      }
    }
  }
  // The Walkthrough screen extrapolates playback from `at` (the sender's clock) and needs our own
  // receipt time to detect a clock that disagrees with ours.
  if (incoming.walkthrough) next.walkthrough = { ...next.walkthrough, received_at: receivedAt };
  return next;
}

/** `/experience/<slug>` in a legacy `{cmd:'load', url}`. */
export function slugFromUrl(url) {
  try {
    const m = /\/experience\/([^/?#]+)/.exec(new URL(url).pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/** Legacy v1 web-viewer state {tab, mediaIdx, towerId, cfg, unit, nodeId, poi, cam, mapCam}. */
export function legacyToV2(st) {
  const tabChapter = { overview: 'home', gallery: 'renders', inventory: 'inventory', walkthrough: 'walkthrough', location: 'location' };
  const out = { chapter: tabChapter[st.tab] ?? 'home' };
  if (st.tab === 'gallery') out.renders = { index: Number(st.mediaIdx) || 0 };
  if (st.tab === 'inventory') {
    out.inventory = { tower_id: st.towerId ?? null, cfg: st.cfg ?? null, unit_no: st.unit?.unit_no ?? null, level: st.unit ? 'unit' : st.towerId != null ? 'tower' : 'aerial' };
  }
  if (st.nodeId) { out.chapter = 'vr'; out.vr = { scene_idx: st.sceneIdx ?? null, node_id: st.nodeId, cam: st.cam ?? null }; }
  if (st.tab === 'location') out.location = { poi: st.poi ?? null, map_cam: st.mapCam ?? null };
  return out;
}

export const initialView = { mode: 'idle', slug: null, lead: null, kiosk: null };

export function viewReducer(view, action) {
  if (action.type !== 'frame') return view;
  const st = action.state;
  if (!st || typeof st !== 'object') return view;
  const now = action.at ?? Date.now();
  // `present` always starts from defaults: nothing from an earlier session of the same project
  // (a chapter, a selected unit) may leak into a new customer's presentation.
  if (st.cmd === 'present' && typeof st.slug === 'string') {
    return { mode: 'present', slug: st.slug, lead: st.lead ?? null, kiosk: defaultKiosk(st.slug) };
  }
  if (st.cmd === 'idle') return initialView;
  if (st.cmd === 'load' && st.url) {
    const slug = slugFromUrl(st.url);
    return slug ? { mode: 'present', slug, lead: null, kiosk: defaultKiosk(slug), legacy: true } : view;
  }
  if (st.cmd) return view; // an unknown command: ignore rather than guess
  // A v2 kiosk state. Older tablets omit `v`, so a known chapter name is accepted as well. A state
  // for a different slug than the one on screen presents that project — the relay's replay after
  // a reload may deliver the state without its `present`.
  if (st.v === 2 || CHAPTERS.includes(st.chapter)) {
    const slug = st.slug ?? view.slug;
    if (!slug) return view;
    const base = view.slug === slug && view.kiosk ? view.kiosk : defaultKiosk(slug);
    return { ...view, mode: 'present', slug, kiosk: mergeKiosk(base, st, now) };
  }
  // Legacy v1 state only makes sense on top of a project that is already presented.
  if ('tab' in st && view.mode === 'present' && view.kiosk) {
    return { ...view, kiosk: mergeKiosk(view.kiosk, legacyToV2(st), now) };
  }
  return view;
}
