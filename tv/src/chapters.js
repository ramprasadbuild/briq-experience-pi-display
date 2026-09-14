/** The six kiosk chapters — a port of the controller's src/chapters.ts. */
export const walkthroughScene = (d) => (d.scenes ?? []).find((s) => s.type === 'walkthrough' && (s.nodes?.length ?? 0) > 0);
const firstImage = (d, ...urls) => urls.find(Boolean) ?? d.hero_image ?? d.gallery?.[0];

export function buildChapters(d) {
  const gallery = d.gallery ?? [];
  const towers = d.towers ?? [];
  const vr = walkthroughScene(d);
  const hasMap = d.lat != null && d.lng != null;
  return [
    { id: 'renders', no: '01', kick: 'CINEMATIC FRAMES', name: 'Renders', blurb: 'Every elevation, deck and interior', image: firstImage(d, gallery[0]), enabled: gallery.length > 0 },
    { id: 'inventory', no: '02', kick: 'LIVE AVAILABILITY', name: 'Inventory', blurb: 'Live availability, floor by floor', image: firstImage(d, gallery[1]), enabled: towers.length > 0 },
    { id: 'brochure', no: '03', kick: 'PROJECT DOSSIER · PDF', name: 'Brochure', blurb: 'The complete document, in your inbox', image: firstImage(d, gallery[2]), enabled: !!d.brochure_url },
    { id: 'vr', no: '04', kick: 'WALKABLE · 360°', name: 'VR', blurb: 'Step inside, at full scale', image: firstImage(d, vr?.nodes?.[0]?.url, gallery[3]), enabled: !!vr },
    { id: 'walkthrough', no: '05', kick: 'CINEMATIC FILM', name: 'Walkthrough', blurb: 'A cinematic passage through the tower', image: firstImage(d, gallery[4]), enabled: !!d.walkthrough_video },
    { id: 'location', no: '06', kick: 'LOCATION · MAP', name: 'AV Location', blurb: 'The address, seen from above', image: firstImage(d, gallery[5]), enabled: hasMap || (d.vicinity ?? []).length > 0 },
  ];
}
