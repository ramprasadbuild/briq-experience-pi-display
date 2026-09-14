/** Kiosk design tokens — the controller's src/ui/xc.ts, verbatim values. */
export const xc = {
  bg: '#0b0a09',
  bg2: '#141210',
  glass: 'rgba(255,255,255,0.055)',
  glass2: 'rgba(12,11,10,0.86)',
  glassHi: 'rgba(255,255,255,0.10)',
  line: 'rgba(255,255,255,0.12)',
  lineGold: 'rgba(201,164,92,0.45)',
  text: '#f3eee4',
  textDim: '#c7bfb1',
  textFaint: '#8a8276',
  gold: '#c9a45c',
  gold2: '#e2c483',
  goldDim: 'rgba(201,164,92,0.16)',
  onGold: '#14110c',
  available: '#5fbf84',
  hold: '#d9a24a',
  sold: '#e06868',
  live: '#e0574f',
};

export const VCAT = {
  work: { label: 'Work & IT', color: '#6f9cff' },
  education: { label: 'Education', color: '#b08cff' },
  healthcare: { label: 'Healthcare', color: '#ff7a72' },
  transit: { label: 'Transit', color: '#f0b64a' },
  shopping: { label: 'Shopping', color: '#e29a6e' },
  leisure: { label: 'Leisure', color: '#5fbf84' },
  infrastructure: { label: 'Infrastructure', color: '#4fc3d9' },
  landmark: { label: 'Landmark', color: '#c9a45c' },
};
export const vcat = (c) => VCAT[c ?? ''] ?? VCAT.work;

export function fmtCr(v) {
  if (v == null || v === '') return 'On request';
  const n = Number(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export const sqftRange = (a, b) =>
  a == null ? '—' : b && Math.round(b) !== Math.round(a) ? `${Math.round(a)}–${Math.round(b)}` : `${Math.round(a)}`;

export const priceText = (a, b) => (a == null ? 'On request' : b && b !== a ? `${fmtCr(a)} – ${fmtCr(b)}` : fmtCr(a));

export const pad2 = (n) => String(n).padStart(2, '0');

export const STATUS_LABEL = { available: 'Available', hold: 'Hold', sold: 'Sold' };
export const statusColor = (st) => (st === 'available' ? xc.available : st === 'hold' ? xc.hold : xc.sold);

/** The API serialises numerics as strings in places (carpet_area "1250.00"). */
export function areaText(raw, units) {
  const sqft = raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(sqft)) return '—';
  if (units === 'sqm') return `${(sqft * 0.092903).toFixed(2)} Sq. M.`;
  if (units === 'sqft') return `${sqft.toFixed(2)} Sq. Ft.`;
  return `${Math.round(sqft)} sqft`;
}

export const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] ?? 'th'}`;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}
export const kmText = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/** What the TV shows when it doesn't know whose showroom it is. Never our own name. */
export const NEUTRAL_BRAND = 'Experience Center';

/**
 * The brand a presented project carries (the client's, never ours): the project's builder first,
 * then the org's Brand Settings name, else the neutral label. Same rule as the tablet.
 */
export function brandName(data) {
  const builder = typeof data?.builder === 'string' ? data.builder.trim() : '';
  if (builder) return builder;
  const org = typeof data?.org?.name === 'string' ? data.org.name.trim() : '';
  return org || NEUTRAL_BRAND;
}
