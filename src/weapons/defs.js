// Weapon / item definitions. Pure data (no three.js) so the shop UI, HUD and gameplay share one source of truth.
//
// parts: side-view silhouette used for BOTH the 3D mesh (models.js) and the 2D shop icon (gunSvg).
//   [shape, z0, z1, y0, y1, material, thickness?, rotDeg?, tip?]
//   shape 'b' box, 'c' cylinder along z (radius = (y1-y0)/2), 'k' cone along z (tapers to `tip` x radius at z1)
//   z = barrel direction (+ forward), y = up, metres, origin at the grip. rotDeg is clockwise in the side view.
//   materials: M metal, D dark, G gunmetal, W wood, O olive, R red, L lens, X white, A accent (per weapon)

export const WEAPONS = [
  {
    id: 'pistol', name: 'M9 Pistol', price: 150, kind: 'hitscan', auto: false,
    desc: 'Reliable sidearm. Accurate and cheap to feed.',
    damage: 26, pellets: 1, rate: 4.5, clip: 12, maxReserve: 96, startReserve: 36, ammoPack: 24, ammoPrice: 30,
    spread: 0.02, aimSpread: 0.004, range: 90, reload: 1.15, recoil: 0.014, knock: 3,
    tracer: 0xffe9a0, sound: 'gunshot', accent: 0xc9a24a, muzzle: [0.19, 0.045], adsFov: 52, scale: 1,
    parts: [
      ['b', -0.07, 0.15, 0.02, 0.075, 'G', 0.03],
      ['c', 0.15, 0.19, 0.03, 0.06, 'D'],
      ['b', -0.07, 0.11, -0.01, 0.022, 'M', 0.026],
      ['b', -0.075, -0.015, -0.115, 0.02, 'D', 0.032, 11],
      ['b', 0.0, 0.05, -0.034, -0.012, 'D', 0.01],
      ['b', 0.118, 0.138, 0.075, 0.089, 'D', 0.012],
      ['b', 0.0, 0.1, 0.045, 0.055, 'A', 0.031],
    ],
  },
  {
    id: 'smg', name: 'MP7 SMG', price: 600, kind: 'hitscan', auto: true,
    desc: 'Compact and brutally fast. Sprays the street clean.',
    damage: 12, pellets: 1, rate: 14, clip: 32, maxReserve: 224, startReserve: 64, ammoPack: 64, ammoPrice: 60,
    spread: 0.05, aimSpread: 0.02, range: 70, reload: 1.6, recoil: 0.0065, knock: 2,
    tracer: 0xffd890, sound: 'smg', accent: 0x36c3ff, muzzle: [0.36, 0.037], adsFov: 52, scale: 1,
    parts: [
      ['b', -0.12, 0.2, 0.0, 0.085, 'M', 0.05],
      ['b', -0.1, 0.18, 0.085, 0.1, 'D', 0.022],
      ['c', 0.2, 0.36, 0.02, 0.055, 'D'],
      ['b', 0.0, 0.045, -0.17, 0.0, 'M', 0.03, -8],
      ['b', -0.1, -0.045, -0.125, 0.0, 'D', 0.03, 12],
      ['b', -0.32, -0.12, 0.025, 0.06, 'D', 0.02],
      ['b', 0.14, 0.17, -0.07, 0.0, 'D', 0.025],
      ['b', 0.0, 0.16, 0.04, 0.05, 'A', 0.052],
    ],
  },
  {
    id: 'shotgun', name: 'Pump Shotgun', price: 900, kind: 'hitscan', auto: false,
    desc: 'Nine pellets of close-range misery.',
    damage: 10, pellets: 9, rate: 1.25, clip: 6, maxReserve: 48, startReserve: 18, ammoPack: 12, ammoPrice: 60,
    spread: 0.085, aimSpread: 0.06, range: 32, reload: 2.2, recoil: 0.06, knock: 7,
    tracer: 0xffc070, sound: 'shotgun', accent: 0xe0702c, muzzle: [0.72, 0.057], adsFov: 55, scale: 1,
    parts: [
      ['c', 0.05, 0.72, 0.04, 0.075, 'M'],
      ['c', 0.05, 0.6, 0.0, 0.034, 'D'],
      ['b', 0.22, 0.42, -0.01, 0.05, 'W', 0.05],
      ['b', -0.1, 0.12, -0.01, 0.09, 'M', 0.05],
      ['b', -0.46, -0.1, -0.03, 0.085, 'W', 0.045, -6],
      ['b', -0.1, -0.05, -0.125, -0.01, 'W', 0.035, 14],
      ['b', 0.64, 0.72, 0.075, 0.087, 'A', 0.012],
    ],
  },
  {
    id: 'rifle', name: 'AR-15 Rifle', price: 1500, kind: 'hitscan', auto: true,
    desc: 'Balanced full-auto rifle. Accurate when you aim.',
    damage: 21, pellets: 1, rate: 9.5, clip: 30, maxReserve: 210, startReserve: 60, ammoPack: 60, ammoPrice: 90,
    spread: 0.035, aimSpread: 0.006, range: 140, reload: 1.9, recoil: 0.0105, knock: 3,
    tracer: 0xffe0a0, sound: 'rifle', accent: 0x5ad06a, muzzle: [0.82, 0.055], adsFov: 40, scale: 1,
    parts: [
      ['b', -0.12, 0.28, -0.005, 0.09, 'M', 0.05],
      ['b', -0.1, 0.3, 0.09, 0.11, 'D', 0.025],
      ['b', 0.28, 0.55, 0.01, 0.085, 'D', 0.056],
      ['c', 0.55, 0.78, 0.04, 0.07, 'M'],
      ['c', 0.76, 0.82, 0.035, 0.075, 'D'],
      ['b', -0.44, -0.12, -0.025, 0.09, 'D', 0.045, -4],
      ['b', 0.08, 0.14, -0.2, -0.005, 'M', 0.035, -14],
      ['b', -0.12, -0.07, -0.125, -0.005, 'D', 0.032, 15],
      ['b', 0.0, 0.1, 0.11, 0.14, 'A', 0.03],
    ],
  },
  {
    id: 'sniper', name: 'M24 Sniper', price: 2500, kind: 'hitscan', auto: false, scope: true,
    desc: 'One shot, one kill. Hold aim to look through the scope.',
    damage: 140, pellets: 1, rate: 0.85, clip: 5, maxReserve: 30, startReserve: 10, ammoPack: 10, ammoPrice: 100,
    spread: 0.09, aimSpread: 0.0004, range: 420, reload: 2.7, recoil: 0.075, knock: 14,
    tracer: 0xbfe8ff, sound: 'sniper', accent: 0x6bb7ff, muzzle: [1.18, 0.057], adsFov: 17, scale: 1, heavy: true, zoom: [17, 9, 6],
    parts: [
      ['c', 0.3, 1.18, 0.045, 0.07, 'M'],
      ['b', -0.15, 0.3, -0.005, 0.085, 'M', 0.05],
      ['b', -0.58, -0.15, -0.04, 0.08, 'O', 0.05, -3],
      ['b', -0.15, -0.1, -0.13, -0.005, 'O', 0.035, 14],
      ['c', -0.02, 0.32, 0.115, 0.165, 'D'],
      ['c', 0.32, 0.335, 0.108, 0.172, 'L'],
      ['c', -0.035, -0.02, 0.108, 0.172, 'L'],
      ['b', 0.0, 0.03, 0.085, 0.115, 'M', 0.02],
      ['b', 0.22, 0.25, 0.085, 0.115, 'M', 0.02],
      ['b', 0.06, 0.1, -0.07, -0.005, 'M', 0.03],
      ['b', 0.5, 0.6, 0.0, 0.04, 'A', 0.02],
    ],
  },
  {
    id: 'launcher', name: 'M79 Grenade Launcher', price: 3000, kind: 'launcher', auto: false, arc: true,
    desc: 'Lobs explosive rounds in a high arc. Mind the splash.',
    damage: 95, blast: 7.5, pellets: 1, rate: 1.1, clip: 4, maxReserve: 24, startReserve: 8, ammoPack: 8, ammoPrice: 120,
    spread: 0.01, aimSpread: 0.002, range: 90, reload: 2.5, recoil: 0.05, knock: 14, speed: 36, gravity: 16,
    tracer: 0xffa040, sound: 'rpg', accent: 0xffb030, muzzle: [0.6, 0.05], adsFov: 50, scale: 1,
    parts: [
      ['c', 0.05, 0.6, 0.0, 0.1, 'D'],
      ['c', 0.0, 0.18, -0.06, 0.08, 'M'],
      ['b', -0.15, 0.05, 0.0, 0.09, 'M', 0.05],
      ['b', -0.44, -0.15, -0.02, 0.08, 'W', 0.05, -5],
      ['b', -0.14, -0.08, -0.125, 0.0, 'D', 0.034, 12],
      ['b', 0.22, 0.44, -0.1, 0.0, 'D', 0.035],
      ['c', 0.5, 0.56, -0.01, 0.11, 'A'],
      ['b', 0.0, 0.04, 0.09, 0.14, 'D', 0.02],
    ],
  },
  {
    id: 'rpg', name: 'RPG-7', price: 5000, kind: 'launcher', auto: false, rocket: true,
    desc: 'Rocket with a smoke trail and a very big bang.',
    damage: 170, blast: 11, pellets: 1, rate: 0.55, clip: 1, maxReserve: 8, startReserve: 3, ammoPack: 3, ammoPrice: 220,
    spread: 0.01, aimSpread: 0.002, range: 200, reload: 2.9, recoil: 0.09, knock: 20, speed: 46, gravity: 0,
    tracer: 0xff9040, sound: 'rpg', accent: 0xff5a2c, muzzle: [0.85, 0.01], adsFov: 48, scale: 1, heavy: true,
    parts: [
      ['c', -0.36, 0.6, -0.045, 0.055, 'O'],
      ['k', -0.52, -0.36, -0.09, 0.1, 'M', 0.08, 0, 0.55],
      ['k', 0.6, 0.76, -0.04, 0.05, 'R', 0.08, 0, 1.0],
      ['k', 0.76, 0.92, -0.03, 0.04, 'R', 0.07, 0, 0.1],
      ['b', -0.05, 0.0, -0.15, -0.04, 'D', 0.032, 8],
      ['b', 0.2, 0.25, -0.14, -0.04, 'D', 0.03],
      ['b', 0.1, 0.22, 0.055, 0.1, 'D', 0.02],
      ['c', 0.1, 0.2, -0.05, 0.06, 'A'],
    ],
  },
  {
    id: 'grenade', name: 'Frag Grenades', price: 100, kind: 'throw', auto: false, consumable: true, noClip: true,
    desc: 'Pack of 5. Cook, lob, and take cover.',
    damage: 110, blast: 8.5, pellets: 1, rate: 1.4, clip: 0, maxReserve: 15, startReserve: 5, ammoPack: 5, ammoPrice: 100,
    spread: 0, aimSpread: 0, range: 40, reload: 0, recoil: 0.02, knock: 12, speed: 21, gravity: 17, fuse: 1.8,
    tracer: 0xa0ff80, sound: 'throw', accent: 0x6aa84f, muzzle: [0.05, 0.0], adsFov: 56, scale: 1.6,
    parts: [
      ['c', -0.045, 0.045, -0.045, 0.045, 'O', 0.09],
      ['b', -0.01, 0.035, 0.045, 0.058, 'M', 0.014],
      ['c', -0.012, 0.012, 0.058, 0.07, 'A'],
    ],
  },
];

export const MEDKIT = {
  id: 'medkit', name: 'Med Kit', price: 150, kind: 'item', consumable: true,
  desc: 'Restores the active hero to full health.', accent: 0xff4458, scale: 1.4,
  parts: [
    ['b', -0.11, 0.11, -0.07, 0.07, 'X', 0.07],
    ['b', -0.07, 0.07, -0.012, 0.012, 'R', 0.074],
    ['b', -0.012, 0.012, -0.05, 0.05, 'R', 0.074],
    ['b', -0.03, 0.03, 0.07, 0.085, 'D', 0.03],
  ],
};

export const SHOP_ITEMS = [...WEAPONS, MEDKIT];
export const WEAPON_BY_ID = Object.fromEntries(SHOP_ITEMS.map((w) => [w.id, w]));

/** Cash rewards for kills, by enemy kind. Venom / bosses pay 1000. */
export const KILL_REWARD = { goon: 25, hunter: 60, venom: 1000, cop: 0 };
/** Chance and size of a dropped cash bundle on top of the direct reward. */
export const KILL_DROP = { goon: [0.25, 15, 40], hunter: [0.45, 40, 90], default: [0.2, 10, 30] };

export const STARTING_CASH = 200;

/** Normalised 0..1 stats for the shop bars. */
export function weaponStats(d) {
  if (d.kind === 'item') return null;
  const perShot = d.damage * (d.pellets || 1);
  const dps = perShot * d.rate;
  return [
    { label: 'DAMAGE', v: Math.min(1, perShot / 170) },
    { label: 'FIRE RATE', v: Math.min(1, d.rate / 14) },
    { label: 'RANGE', v: Math.min(1, Math.sqrt(d.range / 420)) },
    { label: 'CONTROL', v: Math.max(0.08, Math.min(1, 1 - d.aimSpread * 9 + (d.kind === 'hitscan' ? 0 : 0.3) - d.recoil * 3)) },
    { label: 'DPS', v: Math.min(1, dps / 240), hide: true },
  ].filter((s) => !s.hide);
}
