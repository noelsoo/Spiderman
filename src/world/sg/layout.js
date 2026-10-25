// Singapore map layout constants (x east, z south, y up; north = -z). All metres.
import * as THREE from 'three';

export const L = {
  MINX: -950, MAXX: 900, MINZ: -900, MAXZ: 850,
  COAST: 860,          // x beyond this is open sea (east)
  WATER_Y: -0.5,
  PROM_Y: 0.15,        // promenade / sidewalk top
};

/** Marina Bay water polygon (main basin + the east arm the Helix Bridge crosses). */
export const BAY = [[-300, -330], [190, -330], [190, -380], [340, -380], [340, -240], [190, -240], [190, 120], [-300, 120]];
export const inBay = (x, z) => (x > -300 && x < 190 && z > -330 && z < 120) || (x >= 190 && x < 340 && z > -380 && z < -240);
export const inWater = (x, z) => inBay(x, z) || x > L.COAST;

// MBS spine runs north-south along x = MBS.x
export const MBS = { x: 270, towerZ: [-10, 100, 210], skyZ0: -105, skyZ1: 235, h: 200 };
export const AMS = { x: 245, z: -175 };           // ArtScience Museum
export const HELIX = { x: 285, z0: -425, z1: -225 };
export const MERLION = { x: -276, z: -312 };
export const FLYER = { x: 470, z: -330 };
export const ESPL = { x: -40, z: -385 };

/** N-S roads (avenues) and E-W roads (streets). w = width, lanes = total lanes (both directions).
 *  Traffic keeps LEFT: on an avenue a car heading +z (south) uses the +x (east) half, heading -z the -x half;
 *  on a street a car heading +x (east) uses the -z (north) half, heading -x the +z half. */
export const AVE = [
  { x: -860, z0: -800, z1: 770, w: 18, lanes: 4 }, { x: -740, z0: -800, z1: 770, w: 18, lanes: 4 },
  { x: -620, z0: -800, z1: 770, w: 18, lanes: 4 }, { x: -500, z0: -800, z1: 770, w: 18, lanes: 4 },
  { x: -380, z0: -800, z1: 770, w: 26, lanes: 6 },
  { x: -140, z0: -800, z1: -440, w: 18, lanes: 4 }, { x: 100, z0: -800, z1: -440, w: 18, lanes: 4 },
  { x: 180, z0: 165, z1: 840, w: 22, lanes: 4 },
  { x: 380, z0: -800, z1: 290, w: 26, lanes: 6 },
  { x: 600, z0: -800, z1: 290, w: 20, lanes: 4 },
  { x: 790, z0: -880, z1: 840, w: 40, lanes: 6, highway: true },
];
export const STR = [
  { z: -800, x0: -860, x1: 600, w: 18, lanes: 4 }, { z: -680, x0: -860, x1: 600, w: 18, lanes: 4 },
  { z: -560, x0: -860, x1: 600, w: 18, lanes: 4 },
  { z: -440, x0: -860, x1: 790, w: 26, lanes: 6 },
  { z: -320, x0: -860, x1: -380, w: 18, lanes: 4 }, { z: -200, x0: -860, x1: -380, w: 18, lanes: 4 },
  { z: -80, x0: -860, x1: -380, w: 18, lanes: 4 }, { z: 40, x0: -860, x1: -380, w: 18, lanes: 4 },
  { z: 165, x0: -860, x1: 180, w: 26, lanes: 6 },
  { z: 290, x0: -860, x1: -380, w: 22, lanes: 4 }, { z: 290, x0: 180, x1: 790, w: 22, lanes: 4 },
  { z: 410, x0: -860, x1: -380, w: 18, lanes: 4 }, { z: 530, x0: -860, x1: -380, w: 18, lanes: 4 },
  { z: 650, x0: -860, x1: -380, w: 18, lanes: 4 }, { z: 770, x0: -860, x1: -380, w: 18, lanes: 4 },
  { z: -130, x0: 380, x1: 790, w: 20, lanes: 4 },
];
/** Diagonal / curved connectors (data + drawn as rotated strips). */
export const DIAG = [
  { a: [100, -560], b: [380, -440], w: 16, lanes: 4 },
];

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

const half = (list, key, v) => { let w = 18; for (const r of list) if (r[key] === v) w = Math.max(w === 18 && r.w < 18 ? 0 : 0, r.w); return w / 2; };
/** Buildable rectangles between consecutive road centre-lines (inset by half road width + sidewalk). */
export function cells(xs, zs, margin = 6.5) {
  const out = [];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    out.push({
      x0: xs[i] + half(AVE, 'x', xs[i]) + margin, x1: xs[i + 1] - half(AVE, 'x', xs[i + 1]) - margin,
      z0: zs[j] + half(STR, 'z', zs[j]) + margin, z1: zs[j + 1] - half(STR, 'z', zs[j + 1]) - margin, i, j,
    });
  }
  return out;
}
export const WEST_X = [-860, -740, -620, -500, -380];
export const WEST_Z = [-800, -680, -560, -440, -320, -200, -80, 40, 165, 290, 410, 530, 650, 770];
