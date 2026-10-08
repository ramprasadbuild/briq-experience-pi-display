// Text formatters shared by the screens — money, areas, counters, distances. Ported from the
// controller so the TV and the tablet print the same thing for the same value.

/** ₹ in crore / lakh, trailing ".00" dropped: 12500000 → "₹1.25 Cr"; 850000 → "₹8.5 L". */
export function fmtCr(v) {
  if (v == null || v === '') return 'On request';
  const n = Number(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export const priceText = (a, b) => (a == null ? 'On request' : b && b !== a ? `${fmtCr(a)} – ${fmtCr(b)}` : fmtCr(a));

export const pad2 = (n) => String(n).padStart(2, '0');

/** The API serialises numerics as strings in places (carpet_area "1250.00"). */
export function areaText(raw, units) {
  const sqft = raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(sqft)) return '—';
  if (units === 'sqm') return `${(sqft * 0.092903).toFixed(2)} Sq. M.`;
  if (units === 'sqft') return `${sqft.toFixed(2)} Sq. Ft.`;
  return `${Math.round(sqft)} sqft`;
}

/** 1 → "1st", 12 → "12th", 23 → "23rd". */
export const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] ?? 'th'}`;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Great-circle distance between two {lat, lng} points, in km. */
export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

export const kmText = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
