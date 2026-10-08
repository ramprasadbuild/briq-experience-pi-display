// Kiosk design tokens — the controller's src/ui/xc.ts, verbatim values — plus the label/colour
// maps that hang off them (unit status, vicinity categories) and the branding rule. The same
// colours are declared as CSS variables in styles.css for the stylesheets; `xc` is for SVG and
// inline styles. Text formatters live in format.js.
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

/** Vicinity (Location chapter) categories. Unknown categories fall back to `work`. */
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

export const STATUS_LABEL = { available: 'Available', hold: 'Hold', sold: 'Sold' };
export const statusColor = (st) => (st === 'available' ? xc.available : st === 'hold' ? xc.hold : xc.sold);

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
