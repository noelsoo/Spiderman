// City grid constants and helpers (pure data, no geometry). Re-exported by city.js.
//
//   Avenues run north-south at x = avenueX(k), streets east-west at z = streetZ(k); "north" is -z.
//   Block (i, j) sits between avenues i / i+1 and streets j / j+1 (colX(i), rowZ(j) is its centre).
//
//   Midtown (the original map, never moved):  blocks i 0..9, j 0..16
//   Upper West / East side (north):           j < 0, i 0..13
//   Financial District (south):               j > 16, i 0..10
//   Hell's Kitchen / industrial (east):       i >= 10 (and the far north / south east corners)
//   Brooklyn (across the river, west):        i -9..-7, reached by the bridges over x -1000..-440
import * as THREE from 'three';

export const L = {
  PX: 100, PZ: 70, BW: 78, BD: 54, COLS: 10, ROWS: 17, // COLS / ROWS = the Midtown block counts
  X0: -350, Z0: -560, RIVER_X: -440, FAR_X: -1000, AVE_W: 22, ST_W: 16,
  MINX: -1330, MAXX: 1400, MINZ: -1580, MAXZ: 1580,
  CENTER: new THREE.Vector3(100, 0, -175),
};
export const colX = (i) => L.X0 + L.PX * i;
export const rowZ = (j) => L.Z0 + L.PZ * j;
export const avenueX = (k) => -400 + 100 * k;
export const streetZ = (k) => -595 + 70 * k;

// avenues: Manhattan 0..18 and Brooklyn -9..-7 (drivable: all but the one on the east map edge)
export const AVE_MAIN = [0, 18], AVE_BK = [-9, -7], ST_RANGE = [-14, 31];
export const hasAve = (k) => (k >= 0 && k <= 18) || (k >= -9 && k <= -7);
export const hasDriveAve = (k) => (k >= 0 && k <= 17) || (k >= -9 && k <= -7);
export const hasSt = (k) => k >= -14 && k <= 31;
export const hasCol = (i) => (i >= 0 && i <= 17) || (i >= -9 && i <= -7);
export const hasRow = (j) => j >= -14 && j <= 30;
const rng_ = (a, b) => Array.from({ length: b - a + 1 }, (_, n) => a + n);
export const AVES = [...rng_(-9, -7), ...rng_(0, 18)];
export const STREETS = rng_(-14, 31);
/** x extent of the streets on the island that contains avenue / x */
export const streetSpans = [{ xMin: avenueX(-9), xMax: avenueX(-7) }, { xMin: avenueX(0), xMax: avenueX(18) }];

/** open river between the Manhattan quay and the Brooklyn quay */
export const inWater = (x) => x < L.RIVER_X && x > L.FAR_X;

export function districtOf(i, j) {
  if (i < 0) return 'brooklyn';
  if (j < 0) return i <= 4 ? 'uws' : i <= 13 ? 'ues' : 'hells';
  if (j > 16) return i <= 10 ? 'fidi' : 'hells';
  return i <= 9 ? 'midtown' : 'hells';
}

export const PARK = { i0: 4, i1: 5, j0: 6, j1: 10 };            // Central Park (unchanged)
export const PARKS = [
  { name: 'Central Park', i0: 4, i1: 5, j0: 6, j1: 10, pond: [4, 8] },
  { name: 'Riverside Park', i0: 0, i1: 0, j0: -12, j1: -5 },     // long strip along the west quay (Upper West Side)
  { name: 'Harlem Meer', i0: 8, i1: 9, j0: -9, j1: -7, pond: [8, -8] },
  { name: 'Battery Park', i0: 4, i1: 4, j0: 24, j1: 25 },
  { name: 'Bridge Park', i0: -7, i1: -7, j0: 8, j1: 9 },         // under the Brooklyn end of the bridge
];
export const AV_CELL = { i: 3, j: 4 };
export const ESB_CELL = { i: 6, j: 7 };
export const parkOf = (i, j) => PARKS.find((p) => i >= p.i0 && i <= p.i1 && j >= p.j0 && j <= p.j1) || null;
export const isPark = (i, j) => !!parkOf(i, j);
export const isReserved = (i, j) => (i === AV_CELL.i && j === AV_CELL.j) || (i === ESB_CELL.i && j === ESB_CELL.j);

/** Every block, Midtown first in its original (i outer, j inner) order so its random streams never shift. */
export const BLOCKS = [];
for (let i = 0; i < L.COLS; i++) for (let j = 0; j < L.ROWS; j++) BLOCKS.push({ i, j, cx: colX(i), cz: rowZ(j), district: 'midtown', core: true });
for (let i = -9; i <= 17; i++) for (let j = -14; j <= 30; j++) {
  if (!hasCol(i) || !hasRow(j)) continue;
  if (i >= 0 && i < L.COLS && j >= 0 && j < L.ROWS) continue;
  BLOCKS.push({ i, j, cx: colX(i), cz: rowZ(j), district: districtOf(i, j), core: false });
}

/** Named districts: label point on the ground (used for landmarks / minimap / spawns). */
export const DISTRICT_POINTS = {
  'Financial District': [100, 950],
  'Upper West Side': [-130, -1000],
  'Upper East Side': [380, -1000],
  "Hell's Kitchen": [900, 160],
  Brooklyn: [-1200, 35],
};

/** nearest existing avenue / street index for a world coordinate (river gap snaps to the closer bank) */
export function nearestAve(x) {
  const a = Math.round((x - avenueX(0)) / 100);
  if (hasAve(a)) return a;
  if (a < -9) return -9;
  if (a > 18) return 18;
  return a < -3.5 ? -7 : 0; // inside the river gap (-6..-1)
}
export const nearestSt = (z) => Math.min(31, Math.max(-14, Math.round((z - streetZ(0)) / 70)));
export const pmod = (n, m) => ((n % m) + m) % m;
