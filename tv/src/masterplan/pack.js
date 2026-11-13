// Master-plan packs — a port of the controller's src/masterplan/index.ts; keep the two in step.
// The site model the Master Plan chapter shows and how its buildings group into zones. The payload
// carries no site model yet, so every project gets the township shipped in tv/public/models.
//
// A zone claims every top-level node of the model whose name starts with `match`; zones are toured
// in the order listed, and `masterplan.tour` on the wire is an index into this list.

import { AMBIENT } from './ambient.js';

const tower = { one: 'tower', many: 'towers' };

const TOWNSHIP = {
  id: 'township',
  model: 'models/township.glb',
  // Cars on the roads and birds overhead (masterplan/ambient.js).
  ambient: AMBIENT.township,
  zones: [
    { id: 'r3', match: 'R3_', name: 'Sector R3', kind: 'towers', unit: tower, blurb: 'The first address past the main gate: a row of towers along the entrance avenue, with their own landscaped podium and courts.' },
    { id: 'villas', match: 'Villas_', name: 'The Villas', kind: 'villas', unit: { one: 'villa', many: 'villas' }, blurb: 'Low-rise streets of villas filling the ring road, wrapped around the track at the heart of the township.' },
    { id: 'club', match: 'Clubhouse', name: 'Clubhouse', kind: 'amenity', blurb: 'The clubhouse and pavilion sit on the edge of the track, a short walk from every villa street.' },
    { id: 'track', match: 'TRACK_', name: 'Trackside Towers', kind: 'towers', unit: tower, blurb: 'Three towers standing inside the ring, looking straight down onto the track and its green.' },
    { id: 'temple', match: 'Temple', name: 'Temple', kind: 'landmark', blurb: 'The township temple, set just outside the ring road beside the lake.' },
    { id: 'r9', match: 'R09_', name: 'Sector R9', kind: 'towers', unit: tower, blurb: 'A cluster of towers on the north-east boulevard, with gardens and a pool deck at their feet.' },
    { id: 'r10', match: 'R10_', name: 'Sector R10', kind: 'towers', unit: tower, blurb: 'The far end of the north-east boulevard: three towers around a shared amenity court.' },
    { id: 'r11', match: 'R11_', name: 'Sector R11', kind: 'towers', unit: tower, blurb: 'A long line of towers on the western edge, facing a linear park and the canal.' },
  ],
};

/** The master plan to show for a project; null when it has none (the chapter then reads "Soon"). */
export function masterPlanFor(_data) {
  return TOWNSHIP;
}

export const ZONE_KIND_LABEL = { towers: 'Residences', villas: 'Villas', amenity: 'Amenity', landmark: 'Landmark' };

/** "5 towers", "1 villa"; empty for a zone that is a single landmark. */
export function zoneCountText(zone, count) {
  if (!zone.unit || !(count > 0)) return '';
  return `${count} ${count === 1 ? zone.unit.one : zone.unit.many}`;
}
