// The Master Plan chapter's opening: the Earth turning in space, which then swings round to the
// project's city, drops onto its pin and dives through a cloud layer into the township (after the
// Krisala "Master Plan Explorer" reference). scene.js owns the timeline and the hand-over to the
// site model; this module only draws the globe, its pin and the clouds.
//
// No imagery ships with it: the Earth is painted at start-up from a coarse hand-traced coastline
// (LAND below) onto a canvas. A real equirectangular picture can replace it (`earthUrl`); the
// painted globe stays up until that loads, and for good if it doesn't.
import * as THREE from 'three';

// ---- The painted Earth -------------------------------------------------------------------------

/** Coarse coastlines, [lon, lat] — enough for a globe seen whole and a country seen from orbit. */
const LAND = [
  // North America
  [[-168, 66], [-162, 70], [-156, 71.3], [-140, 69.6], [-128, 70], [-115, 68.5], [-95, 72], [-82, 73], [-80, 63], [-94, 59], [-92, 57], [-82, 55], [-79, 51.5], [-77, 60], [-70, 61], [-64, 60], [-61, 56], [-56, 52], [-60, 47], [-66, 45], [-70, 43], [-70, 41.5], [-74, 40.5], [-76, 38], [-76, 35], [-81, 31.5], [-80, 27], [-80.5, 25.2], [-82, 26.5], [-83, 29.5], [-85, 30], [-89, 30.2], [-94, 29.6], [-97.4, 27.8], [-97.5, 24], [-97, 21], [-94.5, 18.5], [-91, 18.8], [-90.5, 21], [-87, 21.5], [-88, 17], [-88.5, 15.8], [-84, 15.8], [-83.3, 12], [-83.7, 10.5], [-81, 8.8], [-77.5, 8.5], [-79.5, 7.5], [-80.5, 7.5], [-82, 8.2], [-85.7, 10], [-87.5, 13], [-91.4, 14], [-94, 16], [-96.5, 15.7], [-101, 17.5], [-105.5, 20], [-105.5, 22.8], [-109, 26.5], [-112.5, 29.5], [-114.7, 31.8], [-113, 29], [-112, 27], [-110, 24], [-109.5, 23], [-112, 25], [-114, 28], [-115.5, 30.5], [-117, 32.5], [-118.5, 34], [-120.6, 34.6], [-122.5, 37.5], [-124, 40.5], [-124.2, 43], [-124, 46], [-124.7, 48.4], [-123, 49], [-127, 50.5], [-130.5, 54.5], [-133, 57.5], [-137, 59], [-140, 60], [-146, 61], [-151, 59.5], [-154, 57.5], [-158, 56], [-162, 55], [-164.5, 54.5], [-160, 58.5], [-162, 59.8], [-165, 62], [-164.5, 63.2], [-161, 64.5], [-166, 65.5]],
  // Greenland, Baffin, the Arctic archipelago, Iceland
  [[-73, 78], [-60, 82], [-35, 83.5], [-20, 82], [-18, 76], [-22, 70], [-30, 68], [-40, 65], [-43, 60], [-48, 61], [-52, 64], [-54, 67], [-55, 71], [-60, 76], [-68, 77]],
  [[-80, 63.5], [-90, 68.5], [-80, 72.5], [-72, 71], [-67, 69], [-62, 66.5], [-65, 62.5], [-72, 62.5]],
  [[-120, 71], [-112, 75], [-100, 77], [-90, 80], [-80, 82], [-65, 82.5], [-75, 78], [-88, 76], [-95, 73], [-110, 72]],
  [[-22, 64], [-24, 65.5], [-22, 66.4], [-16, 66.5], [-13.6, 65.2], [-15, 64.3], [-18, 63.4]],
  // Caribbean
  [[-85, 21.9], [-83, 23], [-80.5, 23.2], [-77, 22], [-74.2, 20.2], [-77.5, 19.8], [-80, 21.8], [-83, 22]],
  [[-74.4, 18.4], [-72.8, 19.9], [-69.5, 19.7], [-68.4, 18.6], [-71.4, 17.6]],
  // South America
  [[-77.5, 8.5], [-72, 12], [-68, 10.5], [-62, 10.7], [-60, 8.5], [-57, 6], [-52, 5], [-50, 1.5], [-48, -1], [-44, -2.5], [-39, -3.5], [-35, -5.5], [-35, -9], [-37.5, -12.5], [-39, -15], [-39.5, -19], [-41, -22.5], [-44, -23], [-48, -25.5], [-48.5, -28.5], [-51, -31], [-53, -33.5], [-55, -35], [-57.5, -35], [-57, -37.5], [-62, -39], [-62.5, -41], [-65, -42.5], [-65.5, -45], [-67.5, -46.5], [-66, -48], [-68.5, -50.5], [-68.5, -52.5], [-71, -54], [-74.5, -52], [-75.5, -48], [-74, -44], [-73.5, -40], [-73.5, -37], [-71.5, -32], [-71.5, -28], [-70.5, -23], [-70.2, -18], [-72, -17], [-76, -14], [-77.5, -11.5], [-79.5, -7.5], [-81.2, -5], [-80, -2.5], [-80.5, 0], [-79.5, 1.5], [-78.5, 2.5], [-77.5, 4], [-77.4, 6.5]],
  // Eurasia, from Iberia east along the Mediterranean, round Arabia, India and China, back along the Arctic and the Baltic
  [[-9.5, 43], [-9, 39], [-9, 37], [-6, 36.2], [-2, 36.7], [0, 38.8], [0.5, 40.5], [3.2, 42], [3, 43.3], [6, 43.1], [9, 44.3], [10.5, 43], [12.5, 41.5], [15.6, 38], [16, 39], [17, 40.4], [18.5, 40.2], [15, 42], [12.5, 44.5], [12.3, 45.4], [13.7, 45.6], [15.5, 44], [19.5, 42], [19.5, 40], [21, 38.3], [22.5, 36.5], [23.5, 38], [22.8, 40.5], [26, 41], [26.5, 40], [26.2, 39], [27.2, 37.5], [28.5, 36.7], [30.5, 36.5], [32.5, 36.1], [36, 36.8], [36, 35], [35, 33], [34.3, 31.3], [32.5, 31], [34.6, 28], [35, 28], [37, 25], [39, 21.5], [41, 18], [43, 13.5], [45, 12.8], [48.5, 14], [52, 15.6], [55, 17.5], [57, 18.8], [58.5, 20.5], [59.8, 22.5], [58.5, 23.7], [56.3, 26], [54.5, 24.2], [51.6, 24], [51.6, 26], [50.2, 26.5], [48.5, 28.5], [48, 30], [50, 30.2], [51.5, 27.9], [54, 26.6], [56.5, 27.1], [58, 25.6], [61.5, 25.1], [66.5, 25.4], [67.5, 24], [68.7, 22.8], [70, 22.8], [72.6, 21.3], [72.9, 19], [73.4, 16], [74.5, 13.5], [75.5, 11], [76.5, 8.7], [77.5, 8.1], [78.2, 8.9], [79.2, 10.3], [79.9, 11.8], [80.3, 13.3], [80.1, 15.5], [82, 16.5], [84.8, 19.2], [86.9, 20.9], [87, 21.6], [88.8, 21.6], [90.5, 22.5], [91.8, 22.4], [92.3, 21], [94.2, 18.8], [94.5, 16], [96.5, 16.6], [97.7, 16], [98.5, 13], [98.4, 10], [98.7, 8], [100.3, 5], [101.3, 2.8], [103.5, 1.3], [104.2, 1.6], [103.4, 4], [103, 5.6], [101.3, 6.9], [100, 10], [99.2, 10.4], [100, 12.8], [100.8, 13.5], [102.5, 12], [105, 10], [106.5, 9.4], [109, 11.5], [109, 13], [108, 16], [106.5, 18], [105.7, 19], [106.7, 20.7], [108, 21.6], [109.8, 21.5], [110.6, 20.5], [111.5, 21.6], [113.5, 22.2], [116.5, 23], [119.5, 25.5], [120.5, 27.5], [122, 30], [121.5, 31.5], [120.5, 33], [119.2, 34.9], [120.5, 36.5], [122.5, 37.3], [119.5, 37.2], [118.5, 38.5], [117.6, 39], [119, 39.6], [121.2, 40.8], [122, 40.5], [121.5, 39], [124.3, 39.9], [125.3, 37.7], [126.5, 37], [126.5, 34.6], [129.3, 35.2], [129.5, 37], [128.5, 38.5], [127.5, 39.8], [129.7, 41], [130.6, 42.4], [133, 42.8], [135.5, 43.9], [138.2, 46.5], [140.4, 48.5], [141.3, 52.5], [140.5, 53.5], [137.5, 54], [135.5, 54.8], [137, 56.2], [140.5, 57.8], [143, 59.3], [148, 59.3], [152.5, 59], [155, 59.3], [156.5, 61.5], [160, 61.8], [163.5, 62.5], [162.5, 61], [160, 59.5], [156.7, 57.5], [156, 54], [156.6, 51], [158.5, 52.8], [160, 54], [162, 56], [163.5, 59], [166, 60.5], [170.5, 60], [173, 61.5], [177.5, 62.5], [179.5, 64.5], [180, 65], [180, 69], [178, 69.4], [170, 70], [165, 69.6], [160, 70.8], [152, 70.8], [147, 72.3], [140, 72.5], [136, 71.6], [130, 71], [128, 72.8], [124, 73.5], [113, 73.8], [112.5, 76.5], [106, 77.5], [104, 77.7], [100, 76], [97, 76], [93, 75.5], [88, 75.5], [86.5, 74.5], [80, 73.5], [80.5, 72], [75, 72.5], [72.5, 72.8], [72.5, 70.5], [73, 69], [68.5, 68.2], [66, 69.5], [67, 71.5], [61, 69.8], [58, 68.5], [54, 68.5], [53.5, 67.5], [45, 68.5], [44, 66.5], [41, 67.3], [36, 69], [31, 70], [28, 71], [24, 71], [19, 70], [15, 68.5], [12.5, 66], [10.5, 64], [5, 62], [5, 59], [7, 58], [10.5, 59], [11.5, 58], [12.5, 56], [14.5, 55.6], [16.5, 56.5], [16.5, 57.8], [18.5, 59.5], [17.5, 61], [17.5, 62.6], [21, 64], [21.5, 65.5], [24.5, 65.8], [25.5, 65], [21.5, 63], [21.5, 60.8], [23, 60], [26.5, 60.5], [30, 60], [28, 59.5], [23.5, 59.2], [23.5, 58], [24.5, 57.2], [21.5, 57.3], [21, 56], [21.2, 55.2], [19.5, 54.4], [14.5, 54], [11, 54], [10.8, 56], [10.5, 57.6], [8.5, 57], [8, 55], [8.7, 53.8], [7, 53.5], [4.7, 52.8], [3.8, 51.5], [1.7, 51], [-1.5, 49.6], [-1.5, 48.7], [-4.7, 48.5], [-4.4, 47.9], [-2.2, 47.2], [-1.2, 46], [-1.5, 43.5], [-4.5, 43.4], [-8, 43.7]],
  // Britain, Ireland
  [[-5.7, 50], [1.4, 51.2], [1.7, 52.7], [0, 53.5], [-1.5, 55], [-2, 56], [-3.8, 57.7], [-3, 58.6], [-5, 58.6], [-6.2, 57.4], [-5.6, 56], [-4.9, 54.8], [-3.2, 54.5], [-3, 53.4], [-4.6, 52.8], [-5.2, 51.8], [-3.2, 51.4], [-5, 51]],
  [[-6, 52.2], [-6.2, 54], [-6.1, 55.2], [-8.2, 55.2], [-10, 54], [-9.8, 52], [-10.3, 51.6], [-8.5, 51.6]],
  // Africa, Madagascar
  [[32.5, 31], [30, 31.3], [25, 31.7], [20, 32], [20, 30.5], [15.5, 31.5], [11, 33.3], [10.2, 37], [8, 36.9], [3, 36.8], [-2, 35.1], [-5.9, 35.8], [-9.5, 32.5], [-10, 29.5], [-13, 27.5], [-16, 23.5], [-17, 21], [-16.5, 16.5], [-17.5, 14.7], [-16.7, 12.5], [-15, 11], [-13.2, 9], [-11, 6.8], [-7.5, 4.4], [-4, 5.2], [1, 5.9], [3.5, 6.3], [6, 4.3], [8.5, 4.5], [9.7, 3], [9.4, 0], [9, -1.5], [11.7, -5], [12.3, -6.5], [13.5, -10.5], [12, -14.5], [11.8, -17.5], [14.5, -22.5], [15, -26.5], [16.5, -28.6], [18.2, -31.8], [18.4, -34.2], [20, -34.8], [22.5, -34], [26, -33.8], [28, -32.6], [30.5, -30.5], [32.5, -27], [32.8, -25.8], [35.5, -24], [35.5, -21.5], [34.7, -19.8], [36.5, -18.6], [40.5, -15], [40.5, -11], [39.3, -7.5], [39.3, -5], [41, -2], [43, 0], [46, 2.5], [49, 6], [51, 10.5], [51.2, 11.8], [48.5, 11.2], [45, 10.5], [43.4, 11.5], [43, 12.5], [41.6, 14.7], [39.6, 15.7], [38.5, 18.2], [37.3, 21], [35.6, 24], [33.8, 27.4], [32.5, 29.9]],
  [[49.3, -12], [50.5, -15.5], [49.8, -17], [48.5, -20.5], [47, -25], [45, -25.5], [43.6, -23], [43.3, -21.5], [44.4, -19.5], [44, -17], [46.3, -15.7], [48, -13.5]],
  // Sri Lanka, Japan, Taiwan, the Philippines, the Indonesian islands, New Guinea
  [[79.8, 7], [80, 9.7], [81, 9], [81.9, 7], [81.3, 6.2], [80.2, 6]],
  [[130, 31.5], [131.5, 31.5], [132, 33.8], [135, 33.6], [136.8, 34.3], [139.5, 35], [140.8, 35.8], [141, 38], [142, 39.5], [141.5, 41.4], [140, 40.5], [139.8, 38.5], [138.5, 37.5], [136.7, 37.1], [135.5, 35.5], [132.5, 35.4], [131, 34.4], [129.7, 33.5]],
  [[140, 41.5], [141.7, 42.6], [143.3, 42], [145.6, 43.3], [144.5, 44], [142, 45.5], [141.5, 43.8], [140.3, 43.2]],
  [[120.2, 22.6], [121, 25.2], [121.9, 25], [121, 22]],
  [[120.6, 18.5], [122.3, 18.4], [122, 16], [121.5, 14], [124, 12.5], [125.5, 9.5], [126.5, 7], [125.5, 5.8], [124, 6.5], [122, 7], [123.2, 9.5], [122, 11.5], [120.5, 13.5], [119.8, 16]],
  [[109.5, 1.5], [111, 1], [113, 3], [115.4, 5], [117, 7], [119.2, 5.3], [118, 4.3], [118.3, 1], [117.5, 0], [116.5, -2], [116, -3.8], [114.5, -3.8], [111, -3], [110, -1.5]],
  [[95.3, 5.6], [97.5, 5.2], [100, 2], [103.8, -1], [106, -3], [105.8, -5.8], [104.5, -5.8], [102, -4], [100.5, -1.5], [98.7, 1.7]],
  [[105.2, -6.8], [108, -6.5], [111, -6.4], [114.5, -7.7], [114.4, -8.7], [110, -8.2], [106, -7.4]],
  [[131, -1], [134, -0.8], [136.5, -2.2], [138, -1.6], [141, -2.6], [145, -4.5], [147.5, -6.2], [150, -10.4], [147, -10], [146, -8], [143.5, -9], [141, -9.2], [138.5, -8.4], [137.6, -5.5], [135, -4.2], [133, -4], [132, -2.8]],
  // Australia, New Zealand
  [[113.5, -22], [114, -26], [115, -30], [115, -33.6], [117.8, -35], [121, -33.8], [124, -33], [127, -32.2], [131, -31.5], [134, -32.6], [136, -34.8], [137.8, -33], [138.5, -35], [140, -38], [143.5, -38.8], [146.3, -39], [150, -37.5], [150.8, -34.7], [152.5, -32], [153.6, -28], [153, -25], [150.8, -22.5], [149, -20.5], [146.3, -19], [145.5, -15], [143.5, -14], [142.5, -10.7], [141.5, -13.5], [141.5, -17], [140, -17.7], [137.5, -16], [135.5, -14.5], [136.8, -12], [132.5, -11.5], [130, -12.8], [129.5, -15], [126.8, -14], [125, -15], [123, -17], [121.5, -19], [119, -20], [116.7, -20.6]],
  [[172.7, -34.5], [174.5, -36], [175.5, -37.5], [178.5, -37.7], [177, -39.3], [176, -41.3], [174.7, -41.3], [175, -39.5], [173.8, -39.2], [174.5, -37]],
  [[172.7, -40.5], [174.3, -41.7], [173, -43.8], [171, -45], [169, -46.6], [166.5, -46], [168, -44], [171, -42]],
];
/** Inland seas cut back out of the land. */
const WATER = [
  [[28, 41.2], [29.5, 41.2], [33, 42], [36, 41.6], [41.5, 41.5], [41.8, 42.5], [38, 44.5], [37, 45.2], [35, 45], [33.5, 44.5], [32.5, 45.4], [30.5, 46.5], [29.6, 45.3], [28.6, 43.5]],
  [[47, 45], [49, 46.5], [51, 47], [53, 45.2], [51, 44.5], [52.8, 41.7], [54, 40.8], [54, 37.4], [51, 36.7], [49, 37.6], [49.5, 40], [47.5, 42], [47.5, 43.5]],
];
const ICE = [
  [[-180, -90], [180, -90], [180, -78], [160, -71], [120, -66.5], [80, -67], [40, -69], [0, -70.5], [-30, -76], [-60, -73], [-58, -64], [-65, -66], [-75, -71], [-100, -73], [-140, -76], [-180, -78]],
];
/**
 * India's outline (as India's own maps draw it), coarse like the coastlines: the land borders from
 * the Rann of Kutch round Kashmir, along the Himalaya and round Bangladesh, then the coast.
 */
const INDIA = [[68.2, 23.7], [69.5, 24.3], [71, 24.4], [70.6, 25.7], [70.1, 26.6], [69.5, 27], [70.6, 28], [71.9, 27.9], [73.4, 29.9], [74.6, 31], [74.6, 32.5], [74, 34.5], [73.5, 36], [74.8, 37.1], [77, 35.9], [78, 35.5], [79.5, 35.6], [80.3, 35.2], [80, 34], [79, 32.6], [78.8, 31.3], [79.8, 30.8], [80.6, 30.4], [81.1, 30], [80.1, 28.8], [81.5, 27.9], [83.3, 27.4], [84.6, 27.1], [85.9, 26.6], [87, 26.4], [88.1, 26.5], [88.2, 27.1], [88.8, 28.1], [88.9, 27.3], [89.6, 26.8], [90.7, 26.8], [92.1, 26.9], [91.6, 27.8], [92.5, 27.9], [94, 28.9], [95.4, 29], [96.6, 28.6], [97.4, 28.2], [96.9, 27.2], [95.2, 26.6], [94.5, 25.4], [94.2, 23.9], [93.4, 23], [93.1, 22], [92.6, 22], [92.3, 23.7], [91.6, 22.9], [91.4, 24.1], [92.4, 24.3], [92, 25.1], [90, 25.3], [89.8, 26], [88.8, 26.3], [88.1, 25.5], [88.9, 25], [88.3, 24.4], [88.7, 24], [88.9, 22.9], [89, 21.8], [88.8, 21.6], [87, 21.6], [86.9, 20.9], [84.8, 19.2], [82, 16.5], [80.1, 15.5], [80.3, 13.3], [79.9, 11.8], [79.2, 10.3], [78.2, 8.9], [77.5, 8.1], [76.5, 8.7], [75.5, 11], [74.5, 13.5], [73.4, 16], [72.9, 19], [72.6, 21.3], [70, 22.8], [68.7, 22.8]];

/** Labelled while the globe is seen whole. */
const WORLD_CITIES = [['London', 51.51, -0.13], ['Paris', 48.86, 2.35], ['Moscow', 55.76, 37.62], ['Istanbul', 41.01, 28.98], ['Cairo', 30.04, 31.24], ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82], ['Cape Town', -33.92, 18.42], ['Dubai', 25.2, 55.27], ['Riyadh', 24.71, 46.68], ['Singapore', 1.35, 103.82], ['Beijing', 39.9, 116.4], ['Tokyo', 35.68, 139.69], ['Sydney', -33.87, 151.21], ['New York', 40.71, -74.01], ['São Paulo', -23.55, -46.63]];
/** Labelled as the camera closes in on India. */
const INDIA_CITIES = [['New Delhi', 28.61, 77.21], ['Mumbai', 19.08, 72.88], ['Bengaluru', 12.97, 77.59], ['Hyderabad', 17.39, 78.49], ['Chennai', 13.08, 80.27], ['Kolkata', 22.57, 88.36], ['Pune', 18.52, 73.86], ['Ahmedabad', 23.02, 72.57], ['Jaipur', 26.91, 75.79], ['Lucknow', 26.85, 80.95], ['Bhopal', 23.26, 77.41], ['Nagpur', 21.15, 79.09], ['Visakhapatnam', 17.69, 83.22], ['Kochi', 9.93, 76.27], ['Goa', 15.5, 73.83], ['Guwahati', 26.14, 91.74], ['Karachi', 24.86, 67.01], ['Kathmandu', 27.72, 85.32], ['Dhaka', 23.81, 90.41], ['Colombo', 6.93, 79.86]];

/** Dry country, painted over the land as soft sandy patches: [lon, lat, radius in degrees]. */
const DESERTS = [[12, 23, 22], [-2, 21, 14], [28, 22, 12], [45, 22, 12], [56, 28, 8], [62, 32, 9], [72, 27, 5], [100, 42, 14], [85, 39, 8], [133, -25, 15], [20, -24, 8], [-112, 34, 8], [-69, -24, 6]];

/** Chaikin corner-cutting: rounds a traced outline so coasts don't read as straight cuts up close. */
function smooth(poly, rounds = 3) {
  let p = poly;
  for (let r = 0; r < rounds; r++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i]; const [bx, by] = p[(i + 1) % p.length];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    p = out;
  }
  return p;
}

function paintEarth(W = 2048) {
  const H = W / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (lon) => ((lon + 180) / 360) * W; const Y = (lat) => ((90 - lat) / 180) * H;
  const path = (polys) => { g.beginPath(); for (const p of polys.map((q) => smooth(q))) { p.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la)))); g.closePath(); } };

  // Ocean: deep at the poles, lighter in the tropics.
  const sea = g.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#0a2038'); sea.addColorStop(0.35, '#0f3558'); sea.addColorStop(0.5, '#124068'); sea.addColorStop(0.65, '#0f3558'); sea.addColorStop(1, '#0a2038');
  g.fillStyle = sea; g.fillRect(0, 0, W, H);

  // Shallow water: a soft halo around every coast (stacked strokes; a canvas blur is too slow on a tablet).
  g.lineJoin = 'round';
  for (const [wd, a] of [[W / 140, 0.12], [W / 260, 0.2], [W / 520, 0.3]]) { g.strokeStyle = `rgba(70,150,170,${a})`; g.lineWidth = wd; path(LAND); g.stroke(); }

  // Land: green, browning towards the dry belts, then the deserts, the sea cut back out.
  g.save(); path(LAND); g.clip();
  const land = g.createLinearGradient(0, 0, 0, H);
  land.addColorStop(0, '#9aa38f'); land.addColorStop(0.18, '#56704a'); land.addColorStop(0.3, '#6f7a4c'); land.addColorStop(0.45, '#3f6a34');
  land.addColorStop(0.55, '#3c6531'); land.addColorStop(0.68, '#7b7a4f'); land.addColorStop(0.8, '#55704a'); land.addColorStop(1, '#9aa38f');
  g.fillStyle = land; g.fillRect(0, 0, W, H);
  for (const [lo, la, r] of DESERTS) {
    const x = X(lo); const y = Y(la); const rr = (r / 360) * W;
    const d = g.createRadialGradient(x, y, 0, x, y, rr);
    d.addColorStop(0, 'rgba(198,168,118,.85)'); d.addColorStop(0.45, 'rgba(184,155,105,.55)'); d.addColorStop(1, 'rgba(160,140,95,0)');
    g.fillStyle = d; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  // Grain, so the land doesn't read as flat paint.
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * 4; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.045)' : 'rgba(255,255,240,.035)'; const r = 1 + rnd() * (W / 2600); g.fillRect(rnd() * W, rnd() * H, r, r); }
  g.restore();
  g.fillStyle = sea; path(WATER); g.fill();

  // India: a warm wash and a soft glow along its border (the crisp line is drawn in 3D on top).
  g.fillStyle = 'rgba(255,214,140,.10)'; path([INDIA]); g.fill();
  g.lineJoin = 'round';
  for (const [wd, a] of [[W / 400, 0.18], [W / 900, 0.35]]) { g.strokeStyle = `rgba(255,210,120,${a})`; g.lineWidth = wd; path([INDIA]); g.stroke(); }

  // Ice.
  g.fillStyle = '#e8eef2'; path(ICE); g.fill();
  g.save(); path([LAND[1]]); g.clip(); g.fillStyle = 'rgba(232,238,242,.92)'; g.fillRect(0, 0, W, H); g.restore();

  // A faint graticule, the way the reference's globe reads as a model, not a photo.
  g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
  for (let lo = -180; lo <= 180; lo += 15) { g.beginPath(); g.moveTo(X(lo), 0); g.lineTo(X(lo), H); g.stroke(); }
  for (let la = -75; la <= 75; la += 15) { g.beginPath(); g.moveTo(0, Y(la)); g.lineTo(W, Y(la)); g.stroke(); }
  return c;
}

// ---- Scene -------------------------------------------------------------------------------------

const SPACE = '#04100c';

/** Where (lat, lng) lies on a unit globe whose texture is equirectangular (three's SphereGeometry UVs). */
export function globePoint(lat, lng, r = 1) {
  const p = THREE.MathUtils.degToRad(lat); const l = THREE.MathUtils.degToRad(lng);
  return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l)).multiplyScalar(r);
}

const CSS = `
.gl-layer{position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:Jost,system-ui,-apple-system,Roboto,sans-serif}
.gl-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(20,60,44,.0) 35%,rgba(2,8,6,.75) 100%)}
.gl-pin{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-10px);opacity:0;transition:opacity .5s}
.gl-dot{width:12px;height:12px;border-radius:50%;background:#c6e34c;box-shadow:0 0 0 0 rgba(198,227,76,.6);animation:gl-pulse 1.6s infinite}
.gl-name{margin-top:8px;color:#fff;font-weight:600;font-size:26px;letter-spacing:.02em;text-shadow:0 2px 10px rgba(0,0,0,.6)}
.gl-sub{margin-top:3px;color:rgba(255,255,255,.75);font-size:11px;letter-spacing:.18em;text-transform:uppercase;text-shadow:0 1px 6px rgba(0,0,0,.7)}
@keyframes gl-pulse{0%{box-shadow:0 0 0 0 rgba(198,227,76,.6)}100%{box-shadow:0 0 0 22px rgba(198,227,76,0)}}
.gl-clouds{position:absolute;inset:-25%;opacity:0;will-change:transform,opacity}
.gl-clouds i{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.95) 0%,rgba(250,252,250,.75) 38%,rgba(245,248,245,0) 70%)}
.gl-city{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;opacity:0;white-space:nowrap;color:rgba(255,255,255,.88);font-size:12px;letter-spacing:.06em;text-shadow:0 1px 4px rgba(0,0,0,.85);will-change:transform,opacity}
.gl-city:before{content:"";width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 6px rgba(255,255,255,.8)}
.gl-country{position:absolute;left:0;top:0;opacity:0;color:rgba(255,226,160,.95);font-size:30px;font-weight:600;letter-spacing:.42em;text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,.6);will-change:transform,opacity}
.gl-wash{position:absolute;inset:0;background:#f6f8f5;opacity:0}
.gl-wait{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:12px;opacity:0;transition:opacity .4s;color:#33413a;font-size:11px;letter-spacing:.26em;text-transform:uppercase}
.gl-bar{width:180px;height:3px;border-radius:2px;background:rgba(51,65,58,.18);overflow:hidden}
.gl-bar b{display:block;height:100%;width:8%;background:#8aa53a;transition:width .3s}
`;

/**
 * @param {THREE.WebGLRenderer} renderer  shared with the site scene
 * @param {HTMLElement} el                the element the scene fills; the globe's labels and clouds go on top
 * @param {{ lat: number, lng: number, place?: string, sub?: string, earthUrl?: string, pinScale?: number }} site
 */
export function createGlobe(renderer, el, site) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SPACE);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 400);

  // Stars on a far shell.
  const N = 1800; const pos = new Float32Array(N * 3); let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1; const a = rnd() * Math.PI * 2; const r = 150;
    pos[i * 3] = Math.sqrt(1 - u * u) * Math.cos(a) * r; pos[i * 3 + 1] = u * r; pos[i * 3 + 2] = Math.sqrt(1 - u * u) * Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe9e2', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }));
  scene.add(stars);

  // The Earth: `tilt` brings the site's latitude to the front, `spin` its longitude.
  const tilt = new THREE.Group(); const spin = new THREE.Group(); tilt.add(spin); scene.add(tilt);
  // 2048 wide: sharp enough for a globe seen whole, and quick to paint and upload on a tablet.
  const texture = new THREE.CanvasTexture(paintEarth(2048));
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const earthMat = new THREE.MeshPhongMaterial({ map: texture, specular: new THREE.Color('#1c3348'), shininess: 18 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMat);
  spin.add(earth);
  if (site.earthUrl) {
    new THREE.TextureLoader().load(site.earthUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = texture.anisotropy;
      earthMat.map = t; earthMat.needsUpdate = true; texture.dispose();
    }, undefined, () => { /* keep the painted Earth */ });
  }

  // Atmosphere: a blue rim, brightest at the limb.
  // India's border as a crisp gold line just above the surface (smoothed like the painted coast).
  {
    const pts = [];
    const ring = smooth(INDIA, 2);
    for (let i = 0; i <= ring.length; i++) { const [lo, la] = ring[i % ring.length]; pts.push(globePoint(la, lo, 1.0015)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95 }));
    spin.add(line);
  }

  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 n; varying vec3 v; void main(){ n = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); v = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 n; varying vec3 v; void main(){ float k = pow(clamp(1.0 - abs(dot(n, v)), 0., 1.), 2.2); float edge = smoothstep(0.0, 0.35, abs(dot(n, v))); gl_FragColor = vec4(vec3(0.33,0.62,1.0) * k * 1.6, k * edge); }',
  }));
  scene.add(atmo);
  const haze = new THREE.Mesh(new THREE.SphereGeometry(1.002, 96, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 n; varying vec3 v; void main(){ n = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); v = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 n; varying vec3 v; void main(){ float k = pow(1.0 - clamp(dot(n, v), 0., 1.), 3.0); gl_FragColor = vec4(vec3(0.42,0.68,1.0), k * 0.85); }',
  }));
  scene.add(haze);

  // Light from over the viewer's shoulder, so the face turned to us is lit, the far limb falls off.
  scene.add(new THREE.AmbientLight('#8fa6b8', 0.55));
  const sun = new THREE.DirectionalLight('#fff6e8', 2.3); sun.position.set(-2.5, 1.6, 4); scene.add(sun);

  // ---- Overlay: the pin, the clouds, the "still preparing" note -----------------------------

  const layer = document.createElement('div'); layer.className = 'gl-layer';
  const style = document.createElement('style'); style.textContent = CSS;
  const vig = document.createElement('div'); vig.className = 'gl-vig';
  const pin = document.createElement('div'); pin.className = 'gl-pin';
  const scale = site.pinScale && site.pinScale !== 1 ? ` scale(${site.pinScale})` : '';
  pin.innerHTML = '<span class="gl-dot"></span><span class="gl-name"></span><span class="gl-sub"></span>';
  pin.querySelector('.gl-name').textContent = site.place || '';
  pin.querySelector('.gl-sub').textContent = site.sub || coords(site.lat, site.lng);
  const clouds = document.createElement('div'); clouds.className = 'gl-clouds';
  for (let i = 0; i < 26; i++) {
    const b = document.createElement('i'); const w = 22 + rnd() * 38;
    b.style.cssText = `width:${w}%;height:${w * (0.55 + rnd() * 0.35)}%;left:${rnd() * 100 - w / 2}%;top:${rnd() * 100 - w / 3}%`;
    clouds.appendChild(b);
  }
  const wash = document.createElement('div'); wash.className = 'gl-wash';
  const wait = document.createElement('div'); wait.className = 'gl-wait';
  wait.innerHTML = '<span>Preparing the township</span><span class="gl-bar"><b></b></span>';
  // City labels: the world's while the globe is whole, India's as we close in. Any too close to the
  // site would sit on its pin, so they are left out.
  const near = (la, lo) => Math.hypot(la - site.lat, (lo - site.lng) * Math.cos(THREE.MathUtils.degToRad(site.lat))) < 1.1;
  const labels = [];
  const addLabel = (name, la, lo, kind) => {
    if (near(la, lo)) return;
    const e = document.createElement('div'); e.className = kind === 'country' ? 'gl-country' : 'gl-city'; e.textContent = name;
    labels.push({ e, kind, at: globePoint(la, lo, 1.002) });
  };
  WORLD_CITIES.forEach(([n, la, lo]) => addLabel(n, la, lo, 'world'));
  INDIA_CITIES.forEach(([n, la, lo]) => addLabel(n, la, lo, 'india'));
  if (site.lat > 6 && site.lat < 37 && site.lng > 68 && site.lng < 98) addLabel('India', 23.5, 79.5, 'country');

  layer.append(style, vig, ...labels.map((l) => l.e), pin, clouds, wash, wait);
  el.appendChild(layer);

  const target = globePoint(site.lat, site.lng);
  const spinTo = -Math.PI / 2 - THREE.MathUtils.degToRad(site.lng);
  const tiltTo = THREE.MathUtils.degToRad(site.lat);
  const pv = new THREE.Vector3(); const nv = new THREE.Vector3();
  let flip = false;

  function resize(w, h) { camera.aspect = w / h; camera.fov = w < h ? 46 : 32; camera.updateProjectionMatrix(); }

  /**
   * One frame of the opening, `t` in ms since it began:
   *   0–1800      the Earth turns slowly, seen whole
   *   1800–4600   it swings round to the site's side and comes closer
   *   4600–6600   the site's pin comes up and the camera closes in on it
   *   6600–7800   a dive at the ground, into cloud
   * Returns how thick the cloud is (0–1); at 1 the site model takes over.
   */
  function pose(t, w, h) {
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const k = (a, b) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
    // Turn: idle spin first (Africa and Europe facing), then round to the site.
    const idle = spinTo + 1.25 - t * 0.00006;
    const turn = k(1800, 4600);
    spin.rotation.y = idle + (spinTo - idle) * turn;
    tilt.rotation.x = 0.32 + (tiltTo - 0.32) * k(1800, 4600);
    // Distance from the globe's centre: whole Earth → country → city → ground.
    const far = w < h ? 4.6 : 3.6;
    const d = far + (2.15 - far) * k(1800, 4600) + (1.45 - 2.15) * k(4600, 6600) + (1.03 - 1.45) * k(6600, 7800);
    camera.position.set(0, 0, d); camera.lookAt(0, 0, 0);
    // Sit the globe right of centre at first, like the reference, then centre it on the way in.
    const off = (w > h ? 0.16 : 0) * (1 - k(1800, 4000));
    if (off) camera.setViewOffset(w, h, -off * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    stars.material.opacity = 0.7 * (1 - k(6200, 7400));
    // An Android WebView drawn into a hardware layer (the TV page, older tablet builds) only
    // repaints when the DOM changes; a canvas-only animation would sit on a stale frame. Touch the
    // vignette every frame so each new frame reaches the screen.
    flip = !flip; vig.style.opacity = flip ? '1' : '0.999';

    // The pin, while it faces us.
    scene.updateMatrixWorld();
    pv.copy(target).applyMatrix4(spin.matrixWorld);
    nv.copy(pv).normalize();
    const facing = nv.dot(camera.position.clone().sub(pv).normalize());
    pv.project(camera);
    const show = t > 4300 && t < 7300 && facing > 0.25;
    pin.style.opacity = show ? '1' : '0';
    pin.style.transform = `translate(${((pv.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-pv.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -10px)${scale}`;

    // Labels: placed where their city faces us, faded in and out with the stage of the flight.
    const fade = (a, b, c, d) => Math.min(k(a, b), 1 - k(c, d));
    const stage = { world: fade(200, 900, 1700, 2600), country: fade(2400, 3400, 4800, 5800), india: fade(3600, 4600, 6500, 7100) };
    const cam = camera.position;
    for (const l of labels) {
      const o = stage[l.kind];
      if (o <= 0.001) { if (l.e.style.opacity !== '0') l.e.style.opacity = '0'; continue; }
      pv.copy(l.at).applyMatrix4(spin.matrixWorld);
      const f = nv.copy(pv).normalize().dot(cam.clone().sub(pv).normalize());
      pv.project(camera);
      const x = (pv.x * 0.5 + 0.5) * w; const y = (-pv.y * 0.5 + 0.5) * h;
      const vis = f > 0.2 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
      l.e.style.opacity = vis ? (o * Math.min(1, (f - 0.2) / 0.3)).toFixed(3) : '0';
      if (vis) l.e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${l.kind === 'country' ? '-50%, -50%' : '-3px, -50%'})${scale}`;
    }

    return k(6700, 7800);
  }

  /** Cloud cover over the whole stage: `thick` 0–1, `drift` grows as the camera moves through it. */
  function cloud(thick, drift) {
    clouds.style.opacity = String(Math.min(1, thick * 1.3));
    clouds.style.transform = `scale(${(1 + drift * 1.6).toFixed(3)})`;
    wash.style.opacity = String(Math.max(0, thick * 1.15 - 0.15));
  }

  function waiting(on, pct) {
    wait.style.opacity = on ? '1' : '0';
    if (pct != null) wait.querySelector('b').style.width = `${Math.max(8, pct)}%`;
  }

  return {
    scene, camera, resize, pose, cloud, waiting,
    /** The globe no longer draws; its overlay stays only as long as the clouds do. */
    hideGlobe() { pin.style.opacity = '0'; vig.style.display = 'none'; for (const l of labels) l.e.style.opacity = '0'; },
    dispose() {
      layer.remove();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose(); } });
      texture.dispose();
    },
  };
}

function coords(lat, lng) {
  const f = (v, p, n) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? p : n}`;
  return `${f(lat, 'N', 'S')} · ${f(lng, 'E', 'W')}`;
}
