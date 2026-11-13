// Ambient life for the Master Plan scene, per site model: where the roads run (so cars can drive
// them) and how many flocks of birds circle overhead. One copy, used by both hosts: the TV imports
// it, and the tablet's bundle carries it as window.BriqMasterPlan.ambient[<pack id>].
//
// The models have no road geometry — the roads are painted on the site plan — so each road is a
// centreline traced over that picture, in the picture's own coordinates as fractions of its width
// and height (0,0 = top-left). `lane` is how far a car keeps from the centreline (model units).

// Traced on the township plan at 1086 × 1400.
const W = 1086; const H = 1400;
const px = (pts) => pts.map(([x, y]) => [x / W, y / H]);
const ellipse = (cx, cy, rx, ry, n = 56) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });

export const AMBIENT = {
  township: {
    flocks: 3,
    roads: [
      { name: 'Ring road', closed: true, cars: 14, lane: 8, pts: px(ellipse(739, 632, 257, 257)) },
      { name: 'Highway', cars: 10, lane: 24, speed: 1.5, pts: px([[110, 1345], [935, 1345]]) },
      { name: 'Entrance avenue', cars: 5, lane: 8, pts: px([[741, 1300], [738, 1010], [745, 892]]) },
      { name: 'West road', cars: 5, lane: 7, pts: px([[28, 362], [142, 1300]]) },
      { name: 'East road', cars: 4, lane: 6, pts: px([[1058, 512], [885, 1290]]) },
      { name: 'North-east boulevard', cars: 4, lane: 6, pts: px([[700, 372], [905, 108]]) },
      { name: 'R11 road', cars: 3, lane: 4, pts: px([[497, 520], [440, 478], [375, 465], [350, 400], [338, 362]]) },
    ],
  },
};
