// Marina Bay landmarks: Marina Bay Sands + SkyPark, Shoppes, ArtScience Museum, Helix Bridge, Merlion,
// Fullerton, Esplanade durians, Singapore Flyer.
import * as THREE from 'three';
import { STYLES } from '../materials.js';
import { emitBox, addBox, lightBox } from './builders.js';
import { MBS, AMS, HELIX, MERLION, FLYER, ESPL, L } from './layout.js';

const WHITE = [0.94, 0.95, 0.97], STEEL = [0.66, 0.69, 0.74], DARK = [0.12, 0.13, 0.15];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
let _ico = null;
const ico = () => (_ico ||= new THREE.IcosahedronGeometry(1, 1));
export function ball(b, x, y, z, rx, ry = rx, rz = rx, col = WHITE) {
  _m.compose(_p.set(x, y, z), _q.identity(), _s.set(rx, ry, rz));
  b.addGeo(ico(), _m, col);
}
const lerp = (a, b, t) => a + (b - a) * t;

/** mirror helper: copy wall quads into the reflection set */
function reflWalls(ctx, mat, x0, y0, z0, x1, y1, z1, st, col) {
  ctx.refl.bucket(0, 0, mat).walls(x0, y0, z0, x1, y1, z1, st.tw, st.th, 0, col);
}

// ---------------------------------------------------------------- Marina Bay Sands
export function buildMBS(ctx) {
  const X = MBS.x, H = MBS.h, N = 16, THICK = 14, HZ = 25, BASE = 24, TOP = 7.5;
  const st = STYLES.glassBlue;
  const col = [0.8, 0.95, 1.1];
  const refl = ctx.refl;
  MBS.towerZ.forEach((zc, ti) => {
    for (const side of [-1, 1]) {
      for (let k = 0; k < N; k++) {
        const t0 = k / N, t1 = (k + 1) / N, y0 = H * t0, y1 = H * t1;
        const c0 = X + side * lerp(BASE, TOP, t0), c1 = X + side * lerp(BASE, TOP, t1);
        const dc = c1 - c0, dy = y1 - y0, nl = Math.hypot(dc, dy);
        const b = ctx.chunks.bucket(X, zc, st.mat);
        const hz = HZ;
        const v0 = y0 / st.th, v1 = y1 / st.th, uz0 = (zc - hz) / st.tw, uz1 = (zc + hz) / st.tw;
        // outer & inner x-faces
        for (const s of [side, -side]) {
          const xa = c0 + s * THICK / 2, xb = c1 + s * THICK / 2;
          const nx = (s * dy) / nl, ny = (-s * dc) / nl;
          if (s > 0) b.quad([xa, y0, zc + hz], [xa, y0, zc - hz], [xb, y1, zc - hz], [xb, y1, zc + hz], nx, ny, 0, uz0, v0, uz1, v1, col);
          else b.quad([xa, y0, zc - hz], [xa, y0, zc + hz], [xb, y1, zc + hz], [xb, y1, zc - hz], nx, ny, 0, uz0, v0, uz1, v1, col);
        }
        // z-faces (parallelograms)
        const ux0 = (c0 - THICK / 2) / st.tw, ux1 = (c0 + THICK / 2) / st.tw;
        b.quad([c0 - THICK / 2, y0, zc + hz], [c0 + THICK / 2, y0, zc + hz], [c1 + THICK / 2, y1, zc + hz], [c1 - THICK / 2, y1, zc + hz], 0, 0, 1, ux0, v0, ux1, v1, col);
        b.quad([c0 + THICK / 2, y0, zc - hz], [c0 - THICK / 2, y0, zc - hz], [c1 - THICK / 2, y1, zc - hz], [c1 + THICK / 2, y1, zc - hz], 0, 0, -1, ux0, v0, ux1, v1, col);
        if (refl) {
          // mirrored copy: reuse quads cheaply by emitting the vertical-box approximation
          reflWalls(ctx, st.mat, Math.min(c0, c1) - THICK / 2, y0, zc - hz, Math.max(c0, c1) + THICK / 2, y1, zc + hz, st, col);
        }
        addBox(ctx, Math.min(c0, c1) - THICK / 2, y0, zc - hz, Math.max(c0, c1) + THICK / 2, y1, zc + hz, 'building', 'mbs');
        // glowing corner LEDs
        const cm = (c0 + c1) / 2;
        for (const s2 of [-1, 1]) for (const zz of [zc - hz - 0.15, zc + hz - 0.15]) lightBox(ctx, cm + s2 * (THICK / 2) - 0.2, y0, zz, cm + s2 * (THICK / 2) + 0.2, y1, zz + 0.3, [0.5, 0.75, 1.0]);
        if (k === N - 1) ctx.chunks.bucket(X, zc, 'roof').top(c1 - THICK / 2, zc - hz, c1 + THICK / 2, zc + hz, y1, 8, WHITE);
      }
    }
    // cross-bracing atrium glass between the legs at the base (dark glass)
    ctx.chunks.bucket(X, zc, 'night').boxAll(X - 3, 10, zc - hzOf(), X + 3, 70, zc - hzOf() + 0.3, 1, [0.1, 0.18, 0.3]);
  });
  function hzOf() { return 24; }

  // ---------------- SkyPark ('ship' with cantilever)
  const z0 = MBS.skyZ0, z1 = MBS.skyZ1, W = 21;
  const wb = ctx.chunks.bucket(X, 0, 'white');
  const roofB = ctx.chunks.bucket(X, 0, 'roof');
  // main deck slab
  wb.boxClosed(X - W, H, z0 + 20, X + W, H + 5, z1, 6, WHITE);
  addBox(ctx, X - W, H, z0 + 20, X + W, H + 5, z1, 'roof', 'skypark');
  // cantilever: tapering prow, 3 stepped slabs
  const steps = [[z0 + 20, z0 + 14, 20.5], [z0 + 14, z0 + 9, 19], [z0 + 9, z0 + 5, 17], [z0 + 5, z0 + 2, 14.5], [z0 + 2, z0 + 0.5, 11.5], [z0 + 0.5, z0, 8]];
  steps.forEach(([za, zb, w], i) => {
    wb.boxClosed(X - w, H, zb, X + w, H + 5, za, 6, WHITE);
    addBox(ctx, X - w, H, zb, X + w, H + 5, za, 'roof', 'skypark');
  });
  // curved hull underside (three narrowing layers)
  wb.boxClosed(X - 17, H - 3.4, z0 + 14, X + 17, H, z1 - 8, 6, [0.86, 0.88, 0.92]);
  wb.boxClosed(X - 11, H - 6, z0 + 22, X + 11, H - 3.4, z1 - 30, 6, [0.8, 0.83, 0.88]);
  wb.boxClosed(X - 7, H - 3, z0 + 6, X + 7, H, z0 + 20, 6, [0.84, 0.86, 0.9]);
  addBox(ctx, X - 17, H - 3.4, z0 + 14, X + 17, H, z1 - 8, 'building', 'skypark-hull');
  // deck: gardens, pool, sky bar
  const g = ctx.chunks.bucket(X, 100, 'grass');
  const DY = H + 5.04;
  g.top(X - W + 1, 150, X + W - 1, z1 - 3, DY, 6, [0.8, 1, 0.75]);
  g.top(X - W + 1, -65, X + W - 1, 8, DY, 6, [0.8, 1, 0.75]);
  g.top(X - W + 1, z0 + 18, X + W - 1, -70, DY, 6, [0.78, 0.7, 0.55]); // sky-bar timber deck (grass tex tinted)
  // paved promenade down the middle & around the pool
  const pv = ctx.chunks.bucket(X, 100, 'sidewalk');
  pv.top(X - W + 1, 8, X - 9.5, 150, DY + 0.01, 6, [1.5, 1.45, 1.4]);
  pv.top(X + 9.5, 8, X + W - 1, 150, DY + 0.01, 6, [1.5, 1.45, 1.4]);
  // infinity pool (glowing blue strip, 150 m)
  ctx.pool.boxAll(X - 8.2, DY, 10, X + 8.2, DY + 0.18, 148, 4, [1, 1, 1]);
  const gl = ctx.chunks.bucket(X, 100, 'night');
  gl.boxAll(X - 8.4, DY, 9.5, X - 8.2, DY + 0.5, 148.5, 1, [0.9, 0.95, 1]);
  gl.boxAll(X + 8.2, DY, 9.5, X + 8.4, DY + 0.5, 148.5, 1, [0.9, 0.95, 1]);
  // glass balustrade, edge lights along both sides (night)
  for (const sd of [-1, 1]) {
    gl.boxAll(X + sd * (W - 0.3) - 0.1, H + 4.2, z0 + 20, X + sd * (W - 0.3) + 0.1, H + 4.5, z1, 1, [0.55, 0.8, 1.0]);
    ctx.chunks.bucket(X, 100, 'street').boxAll(X + sd * (W - 0.15) - 0.07, DY, z0 + 20, X + sd * (W - 0.15) + 0.07, DY + 1.1, z1, 1, [0.7, 0.75, 0.8]);
  }
  // sky bar: pavilion with a curved 'surfboard' canopy at the cantilever
  const sb = ctx.chunks.bucket(X, z0, 'street');
  for (const sx of [-12, 12]) for (const zz of [z0 + 8, z0 + 30]) sb.boxAll(X + sx - 0.4, DY, zz - 0.4, X + sx + 0.4, DY + 6, zz + 0.4, 1, STEEL);
  wb.boxAll(X - 16, DY + 6, z0 + 4, X + 16, DY + 6.7, z0 + 36, 6, WHITE);
  addBox(ctx, X - 16, DY + 6, z0 + 4, X + 16, DY + 6.7, z0 + 36, 'roof', 'skybar');
  sb.boxAll(X - 15.5, DY, z0 + 6, X + 15.5, DY + 1.1, z0 + 7, 1, [0.55, 0.4, 0.28]);
  gl.boxAll(X - 15.8, DY + 5.9, z0 + 4, X + 15.8, DY + 6.0, z0 + 36, 1, [1.0, 0.85, 0.55]);
  // trusses under the prow
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const zz = z0 + 20 + i * 10;
    ctx.chunks.bucket(X, z0, 'street').cylBetween([X + sx * 10, H - 3, zz], [X + sx * 15, H, zz + 12], 0.35, STEEL);
  }
  ctx.spawnDeck = { x: X, y: H + 5.05, z: -55 };
  // palms & planters on the deck (instanced: y given)
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    ctx.palmSpots.push([X + side * (W - 3.2), 12 + i * 5.2, 0, DY, 0.55]);
  }
  for (let i = 0; i < 8; i++) ctx.palmSpots.push([X + (i % 2 ? 6 : -6), z0 + 44 + i * 4, 0, DY, 0.55]);
  // Event Plaza + Shoppes podium
  const px0 = 192, px1 = 340;
  const pod = (x0, z0_, x1, z1_, h, style = 'glassBlue') => emitBox(ctx, style, x0, 0, z0_, x1, h, z1_, { col: [1, 1, 1.05], id: 'shoppes' });
  pod(230, -42, 240, 252, 14, 'limestone');
  pod(240, -42, 333, 252, 12, 'concrete');
  // curved crystal pavilions along the water
  for (const zz of [-5, 62, 168]) {
    ctx.chunks.bucket(204, zz, 'street').boxAll(196, 0, zz - 12, 214, 9, zz + 12, 4, [0.55, 0.78, 0.92]);
    ctx.chunks.bucket(204, zz, 'night').boxAll(196, 8.8, zz - 12, 214, 9.2, zz + 12, 1, [0.6, 0.85, 1.0]);
    addBox(ctx, 196, 0, zz - 12, 214, 9, zz + 12, 'building', 'pavilion');
  }
  // plaza paving
  ctx.chunks.bucket(260, 100, 'sidewalk').top(190, -45, 380 - 12, 250, 0.12, 6, [0.86, 0.84, 0.8]);
  ctx.landmarks['Marina Bay Sands'] = new THREE.Vector3(X, 0, MBS.towerZ[1]);
  ctx.landmarks['SkyPark'] = new THREE.Vector3(X, H + 5, 60);
  ctx.minimapB.push({ x: X, z: 60, w: 52, d: 340, h: H });
  ctx.minimapB.push({ x: 270, z: 100, w: 120, d: 290, h: 14 });
  ctx.specs.push({ h: H + 5, tiers: [{ x0: X - W, x1: X + W, z0: 20, z1: 200, y1: H + 5 }], cx: X, cz: 100, w: 42, d: 180 });
}

// ---------------------------------------------------------------- ArtScience Museum (lotus)
export function buildArtScience(ctx) {
  const { x: X, z: Z } = AMS;
  const wb = ctx.chunks.bucket(X, Z, 'white');
  const rb = ctx.chunks.bucket(X, Z, 'roof');
  // pond / plinth
  ctx.chunks.bucket(X, Z, 'sidewalk').top(X - 62, Z - 56, X + 62, Z + 56, 0.12, 6, [0.88, 0.86, 0.82]);
  ctx.chunks.bucket(X, Z, 'pond').top(X - 46, Z - 40, X + 46, Z + 40, 0.18, 8, [0.45, 0.8, 0.9]);
  // central core
  wb.boxClosed(X - 15, 0.15, Z - 15, X + 15, 18, Z + 15, 6, WHITE);
  addBox(ctx, X - 15, 0, Z - 15, X + 15, 18, Z + 15, 'building', 'ams');
  ctx.chunks.bucket(X, Z, 'night').boxAll(X - 15.2, 17, Z - 15.2, X + 15.2, 17.4, Z + 15.2, 1, [1.0, 0.9, 0.7]);
  // ten petals
  const n = 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.2, len = 44, rise = 0.62 + (k % 2) * 0.12; // radians of pitch
    const rr0 = 6, ca = Math.sin(a), sa = Math.cos(a);
    const cr = rr0 + Math.cos(rise) * len / 2, cy = 4 + Math.sin(rise) * len / 2;
    wb.boxXf(X + ca * cr, cy, Z + sa * cr, 10.5, 5.5, len, a, WHITE, -rise);
    // inner tint strip (skylight)
    ctx.chunks.bucket(X, Z, 'night').boxXf(X + ca * (cr + 0.2), cy + 2.9, Z + sa * (cr + 0.2), 3.0, 0.15, len * 0.7, a, [0.8, 0.9, 1.0], -rise);
    // stepping-stone physics boxes along the petal
    for (const f of [0.2, 0.55, 0.9]) {
      const rx = X + ca * (rr0 + Math.cos(rise) * len * f), rz = Z + sa * (rr0 + Math.cos(rise) * len * f), ry = 4 + Math.sin(rise) * len * f;
      addBox(ctx, rx - 4.5, ry - 3, rz - 4.5, rx + 4.5, ry + 2.5, rz + 4.5, 'building', 'ams-petal');
    }
  }
  ctx.landmarks['ArtScience Museum'] = new THREE.Vector3(X, 0, Z);
  ctx.minimapB.push({ x: X, z: Z, w: 56, d: 56, h: 40 });
  ctx.specs.push({ h: 25, tiers: [{ x0: X - 15, x1: X + 15, z0: Z - 15, z1: Z + 15, y1: 18 }], cx: X, cz: Z, w: 30, d: 30 });
}

// ---------------------------------------------------------------- Helix Bridge
export function buildHelix(ctx) {
  const X = HELIX.x, z0 = HELIX.z0, z1 = HELIX.z1;
  const DECK = 6, W = 3.2;
  const stB = ctx.chunks.bucket(X, (z0 + z1) / 2, 'street');
  const dk = ctx.chunks.bucket(X, (z0 + z1) / 2, 'sidewalk');
  const rampLen = 30;
  const za = z0 + rampLen, zb = z1 - rampLen;
  const shiftBox = (xa, ya, za_, xb, yb, zb_, type = 'bridge') => addBox(ctx, xa, ya, za_, xb, yb, zb_, type, 'helix');
  // flat deck
  dk.boxClosed(X - W, DECK - 0.7, za, X + W, DECK, zb, 3, [0.78, 0.76, 0.74]);
  shiftBox(X - W, DECK - 0.7, za, X + W, DECK, zb);
  // ramps: one sloped visual slab + fine 0.08 m steps for collision (the hero cannot step up more than a few cm)
  const slope = Math.atan2(DECK, rampLen), slen = Math.hypot(DECK, rampLen);
  dk.boxXf(X, DECK / 2 - 0.35, z0 + rampLen / 2, W * 2, 0.7, slen, 0, [0.78, 0.76, 0.74], -slope);
  dk.boxXf(X, DECK / 2 - 0.35, z1 - rampLen / 2, W * 2, 0.7, slen, 0, [0.78, 0.76, 0.74], slope);
  const steps = 76;
  for (let i = 0; i < steps; i++) {
    const y = DECK * (i + 1) / steps;
    const n0 = z0 + rampLen * i / steps, n1 = z0 + rampLen * (i + 1) / steps;
    shiftBox(X - W, 0, n0, X + W, y, n1);
    const s0 = z1 - rampLen * (i + 1) / steps, s1 = z1 - rampLen * i / steps;
    shiftBox(X - W, 0, s0, X + W, y, s1);
  }
  // piers
  for (const zz of [-345, -310, -275]) {
    stB.boxAll(X - 2, -1.5, zz - 1.2, X + 2, DECK - 0.7, zz + 1.2, 2, [0.6, 0.62, 0.66]);
    addBox(ctx, X - 2, -1.5, zz - 1.2, X + 2, DECK - 0.7, zz + 1.2, 'bridge', 'helix-pier');
  }
  // double helix
  const R = 4.6, CY = DECK + 4.6, period = 30, turns = (zb - za) / period;
  const segs = Math.round(turns * 20);
  const pts = (ph) => Array.from({ length: segs + 1 }, (_, i) => {
    const t = i / segs, th = t * turns * Math.PI * 2 + ph;
    return [X + Math.cos(th) * R, CY + Math.sin(th) * R, za + t * (zb - za)];
  });
  const A = pts(0), B = pts(Math.PI);
  const hx = ctx.chunks.bucket(X, (z0 + z1) / 2, 'street');
  for (let i = 0; i < segs; i++) {
    hx.cylBetween(A[i], A[i + 1], 0.28, [0.8, 0.82, 0.86]);
    hx.cylBetween(B[i], B[i + 1], 0.28, [0.8, 0.82, 0.86]);
    if (i % 2 === 0) { // rungs
      hx.cylBetween(A[i], [A[i][0], DECK, A[i][2]], 0.07, STEEL);
      hx.cylBetween(B[i], [B[i][0], DECK, B[i][2]], 0.07, STEEL);
    }
    if (i % 3 === 0) {
      lightBox(ctx, A[i][0] - 0.3, A[i][1] - 0.3, A[i][2] - 0.3, A[i][0] + 0.3, A[i][1] + 0.3, A[i][2] + 0.3, [1.0, 0.4, 0.85]);
      lightBox(ctx, B[i][0] - 0.3, B[i][1] - 0.3, B[i][2] - 0.3, B[i][0] + 0.3, B[i][1] + 0.3, B[i][2] + 0.3, [0.4, 0.8, 1.0]);
    }
  }
  // crest nodes (web anchors)
  for (let i = 0; i <= segs; i += 10) {
    for (const P of [A[i], B[i]]) if (P[1] > CY + R * 0.9) addBox(ctx, P[0] - 0.7, P[1] - 0.6, P[2] - 0.7, P[0] + 0.7, P[1] + 0.6, P[2] + 0.7, 'bridge', 'helix-node');
  }
  // deck rails + lights
  for (const s of [-1, 1]) {
    hx.boxAll(X + s * W - 0.05, DECK, za, X + s * W + 0.05, DECK + 1.05, zb, 2, [0.7, 0.72, 0.76]);
    lightBox(ctx, X + s * (W - 0.4) - 0.08, DECK + 0.02, za, X + s * (W - 0.4) + 0.08, DECK + 0.14, zb, [1.0, 0.85, 0.55]);
  }
  ctx.landmarks['Helix Bridge'] = new THREE.Vector3(X, DECK, (z0 + z1) / 2);
  ctx.helixDeck = { x: X, y: DECK, z0: za, z1: zb };
  ctx.minimapB.push({ x: X, z: (z0 + z1) / 2, w: 9, d: z1 - z0, h: 12 });
}

// ---------------------------------------------------------------- Merlion
export function buildMerlion(ctx) {
  const { x: X, z: Z } = MERLION;
  const fx = Math.SQRT1_2, fz = Math.SQRT1_2; // facing the bay (south-east)
  const st = ctx.chunks.bucket(X, Z, 'sidewalk');
  // pier
  st.boxClosed(-300, -1.2, -330, -252, 0.45, -286, 4, [0.86, 0.84, 0.8]);
  addBox(ctx, -300, -1.2, -330, -252, 0.45, -286, 'prop', 'pier');
  const wb = ctx.chunks.bucket(X, Z, 'white');
  const BX = X + 1, BZ = Z - 1;
  // pedestal
  wb.cylV(BX, 0.45, BZ, 5.4, 2.4, 10, [0.72, 0.74, 0.78]);
  addBox(ctx, BX - 5, 0.45, BZ - 5, BX + 5, 2.85, BZ + 5, 'prop', 'merlion-base');
  // body: tapered cylinder, tail curl behind (fish), lion head in front
  wb.cylV(BX, 2.85, BZ, 3.5, 7.5, 10, WHITE, 2.9);
  ball(wb, BX, 10.4, BZ, 3.1, 2.4, 3.1, WHITE);                 // chest
  addBox(ctx, BX - 3.2, 2.85, BZ - 3.2, BX + 3.2, 11.5, BZ + 3.2, 'prop', 'merlion-body');
  // fish tail, curving up and forward behind the body
  let tx = BX - fx * 2.2, tz = BZ - fz * 2.2, ty = 5;
  for (let i = 0; i < 12; i++) {
    const t = i / 11, r = lerp(2.4, 0.7, t);
    const px = BX - fx * (2.3 + Math.sin(t * Math.PI * 0.9) * 2.6), pz = BZ - fz * (2.3 + Math.sin(t * Math.PI * 0.9) * 2.6), py = 5 + t * 11;
    ball(wb, px, py, pz, r, r * 1.1, r * 0.8, [0.9, 0.93, 0.96]);
    // scale ridges
    if (i % 2 === 0) ball(wb, px + fx * r * 0.4, py - r * 0.3, pz + fz * r * 0.4, r * 0.75, r * 0.4, r * 0.75, [0.82, 0.86, 0.9]);
  }
  ball(wb, BX - fx * 2.3, 16.8, BZ - fz * 2.3, 2.6, 1.0, 1.9, [0.88, 0.92, 0.96]);  // caudal fin
  // head
  const hx = BX + fx * 1.2, hz = BZ + fz * 1.2, hy = 13.6;
  ball(wb, hx, hy, hz, 3.0, 2.7, 3.0, WHITE);
  ball(wb, hx + fx * 2.4, hy - 0.8, hz + fz * 2.4, 1.5, 1.2, 1.5, WHITE);            // muzzle
  ball(wb, hx + fx * 3.1, hy - 1.7, hz + fz * 3.1, 1.0, 0.7, 1.0, [0.5, 0.52, 0.56]); // open mouth
  for (let k = 0; k < 11; k++) { // mane
    const a = (k / 11) * Math.PI * 2;
    ball(wb, hx - fx * 0.8 + Math.cos(a) * 3.2 * -fz + Math.sin(a) * 0, hy + Math.sin(a) * 3.0, hz - fz * 0.8 + Math.cos(a) * 3.2 * fx, 1.2, 1.3, 1.2, [0.88, 0.9, 0.94]);
  }
  ball(wb, hx + fx * 1.8 - fz * 1.3, hy + 2.5, hz + fz * 1.8 + fx * 1.3, 0.7, 0.8, 0.7, WHITE);
  ball(wb, hx + fx * 1.8 + fz * 1.3, hy + 2.5, hz + fz * 1.8 - fx * 1.3, 0.7, 0.8, 0.7, WHITE);
  ball(wb, hx + fx * 2.7 - fz * 0.9, hy + 0.5, hz + fz * 2.7 + fx * 0.9, 0.35, 0.35, 0.35, DARK);
  ball(wb, hx + fx * 2.7 + fz * 0.9, hy + 0.5, hz + fz * 2.7 - fx * 0.9, 0.35, 0.35, 0.35, DARK);
  addBox(ctx, hx - 3.5, 11.5, hz - 3.5, hx + 3.5, 16.5, hz + 3.5, 'prop', 'merlion-head');
  ctx.merlionMouth = new THREE.Vector3(hx + fx * 3.2, hy - 1.6, hz + fz * 3.2);
  ctx.merlionDir = new THREE.Vector3(fx, 0, fz);
  // floodlights at night
  for (const [dx, dz] of [[-6, 3], [3, -6], [6, 6]]) ctx.chunks.bucket(X, Z, 'night').boxAll(BX + dx - 0.3, 0.45, BZ + dz - 0.3, BX + dx + 0.3, 1.0, BZ + dz + 0.3, 1, [1, 0.95, 0.8]);
  ctx.landmarks['Merlion'] = new THREE.Vector3(BX, 0, BZ);
}

// ---------------------------------------------------------------- Fullerton Hotel (neoclassical)
export function buildFullerton(ctx) {
  const cx = -300, cz = -388, W = 104, D = 44, H = 33;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
  ctx.chunks.bucket(cx, cz, 'sidewalk').top(x0 - 12, z0 - 12, x1 + 12, z1 + 22, 0.12, 6, [0.88, 0.86, 0.82]);
  emitBox(ctx, 'limestone', x0, 0, z0, x1, H, z1, { col: [1.08, 1.04, 0.95], id: 'fullerton', roofCol: [0.55, 0.55, 0.55] });
  // central portico (projects towards the bay = +z), pediment, columns
  const pw = 34, pd = 9;
  emitBox(ctx, 'limestone', cx - pw / 2, 0, z1, cx + pw / 2, 8, z1 + pd, { col: [1.1, 1.06, 0.97], id: 'fullerton' });
  const wb = ctx.chunks.bucket(cx, cz, 'white');
  for (let i = 0; i <= 8; i++) { const px = cx - pw / 2 + 1.5 + i * (pw - 3) / 8; wb.cylV(px, 8, z1 + pd - 1, 0.85, 17, 8, [0.95, 0.92, 0.84]); }
  wb.boxAll(cx - pw / 2, 25, z1 - 1, cx + pw / 2, 27, z1 + pd, 4, [0.95, 0.92, 0.84]);
  // pediment
  for (let k = 0; k < 6; k++) {
    const f = k / 6;
    wb.boxAll(cx - (pw / 2) * (1 - f), 27 + k * 1.1, z1 + pd - 2, cx + (pw / 2) * (1 - f), 28.1 + k * 1.1, z1 + pd, 2, [0.95, 0.92, 0.84]);
  }
  addBox(ctx, cx - pw / 2, 8, z1, cx + pw / 2, 27, z1 + pd, 'building', 'fullerton-portico');
  // colonnade across both wings
  for (const sd of [-1, 1]) for (let i = 0; i < 9; i++) wb.cylV(cx + sd * (pw / 2 + 4 + i * 4.4), 0, z1 + 1.6, 0.6, 9, 8, [0.95, 0.92, 0.84]);
  wb.boxAll(x0, 9, z1 + 0.6, cx - pw / 2, 9.8, z1 + 3, 4, [0.95, 0.92, 0.84]);
  wb.boxAll(cx + pw / 2, 9, z1 + 0.6, x1, 9.8, z1 + 3, 4, [0.95, 0.92, 0.84]);
  // cornice & attic + central cupola
  wb.boxAll(x0 - 0.8, H - 1.2, z0 - 0.8, x1 + 0.8, H + 0.8, z1 + 0.8, 4, [0.95, 0.92, 0.84]);
  wb.boxAll(cx - 8, H, cz - 6, cx + 8, H + 6, cz + 6, 4, [0.9, 0.88, 0.82]);
  ball(wb, cx, H + 8.5, cz, 4.2, 3.4, 4.2, [0.46, 0.5, 0.52]);
  addBox(ctx, cx - 8, H, cz - 6, cx + 8, H + 6, cz + 6, 'roof', 'fullerton-attic');
  ctx.chunks.bucket(cx, cz, 'night').boxAll(x0, 0.4, z1 + 0.05, x1, 1.0, z1 + 0.3, 1, [1.0, 0.85, 0.55]);
  ctx.landmarks['Fullerton'] = new THREE.Vector3(cx, 0, cz);
  ctx.minimapB.push({ x: cx, z: cz, w: W, d: D + 9, h: H });
  ctx.specs.push({ h: H, tiers: [{ x0, x1, z0, z1, y1: H }], cx, cz, w: W, d: D });
}

// ---------------------------------------------------------------- Esplanade durians
export function buildEsplanade(ctx) {
  const domes = [
    { x: ESPL.x - 20, z: ESPL.z, a: 34, b: 25, h: 26 },
    { x: ESPL.x + 62, z: ESPL.z + 2, a: 26, b: 21, h: 21 },
  ];
  ctx.durians = [];
  // shared plaza
  ctx.chunks.bucket(ESPL.x, ESPL.z, 'sidewalk').top(ESPL.x - 80, ESPL.z - 45, ESPL.x + 110, ESPL.z + 42, 0.12, 6, [0.86, 0.84, 0.8]);
  for (const d of domes) {
    const wb = ctx.chunks.bucket(d.x, d.z, 'street');
    // podium ring
    emitBox(ctx, 'concrete', d.x - d.a - 6, 0, d.z - d.b - 6, d.x + d.a + 6, 7, d.z + d.b + 6, { col: [0.85, 0.85, 0.82], id: 'esplanade' });
    const lv = [[7, 0.96], [12, 0.84], [17, 0.66], [21, 0.45], [24.5, 0.25]];
    let prev = 7;
    for (const [y, f] of lv) {
      if (y > d.h + 1) break;
      addBox(ctx, d.x - d.a * f, prev, d.z - d.b * f, d.x + d.a * f, y, d.z + d.b * f, 'building', 'esplanade-dome');
      prev = y;
    }
    ctx.durians.push(d);
  }
  ctx.landmarks['Esplanade'] = new THREE.Vector3(ESPL.x + 20, 0, ESPL.z);
  ctx.minimapB.push({ x: ESPL.x + 20, z: ESPL.z, w: 150, d: 60, h: 25 });
  ctx.specs.push({ h: 26, tiers: [{ x0: ESPL.x - 30, x1: ESPL.x + 10, z0: ESPL.z - 15, z1: ESPL.z + 15, y1: 24 }], cx: ESPL.x, cz: ESPL.z, w: 40, d: 30 });
}

/** Meshes for the durians (shell + instanced spikes), added to group. */
export function makeDurianMeshes(ctx, group, quality) {
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xc9b27e, roughness: 0.35, metalness: 0.75, envMapIntensity: 1.2, emissive: 0xffb050, emissiveIntensity: 0 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 0.3, metalness: 0.8, envMapIntensity: 1.3, emissive: 0xffa43a, emissiveIntensity: 0 });
  const spikes = [];
  const rngl = ctx.rng2;
  for (const d of ctx.durians) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
    shell.scale.set(d.a, d.h, d.b);
    shell.position.set(d.x, 7, d.z);
    group.add(shell);
    const n = quality === 'low' ? 260 : 700;
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const yy = (i + 0.5) / n; // 0..1 height on upper hemisphere
      const r = Math.sqrt(1 - yy * yy), th = i * ga;
      const nx = Math.cos(th) * r, ny = yy, nz = Math.sin(th) * r;
      // normal of ellipsoid
      const gx = nx / d.a, gy = ny / d.h, gz = nz / d.b, gl = Math.hypot(gx, gy, gz);
      spikes.push([d.x + nx * d.a, 7 + ny * d.h, d.z + nz * d.b, gx / gl, gy / gl, gz / gl]);
    }
  }
  const geo = new THREE.ConeGeometry(0.55, 2.6, 4);
  geo.translate(0, 1.0, 0);
  const im = new THREE.InstancedMesh(geo, spikeMat, spikes.length);
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), qq = new THREE.Quaternion(), mm = new THREE.Matrix4(), pp = new THREE.Vector3(), ss = new THREE.Vector3();
  spikes.forEach((s, i) => {
    nrm.set(s[3], s[4], s[5]);
    qq.setFromUnitVectors(up, nrm);
    const k = 0.8 + rngl() * 0.5;
    mm.compose(pp.set(s[0], s[1], s[2]), qq, ss.set(k, k, k));
    im.setMatrixAt(i, mm);
  });
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  group.add(im);
  return { shellMat, spikeMat };
}

// ---------------------------------------------------------------- Singapore Flyer
export function buildFlyer(ctx) {
  const { x: X, z: Z } = FLYER;
  const R = 74, HUB = 90;
  const sb = ctx.chunks.bucket(X, Z, 'white');
  ctx.chunks.bucket(X, Z, 'sidewalk').top(X - 70, Z - 95, X + 90, Z + 95, 0.12, 6, [0.86, 0.84, 0.8]);
  // A-frame support: two struts either side in z, each pair splayed in x
  const legs = [];
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) legs.push([[X + sx * 12, 0, Z + sz * 46], [X + sx * 5, HUB, Z + sz * 2]]);
  for (const [a, b] of legs) {
    sb.cylBetween(a, b, 1.9, [0.9, 0.92, 0.95]);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const x0 = lerp(a[0], b[0], t0), x1 = lerp(a[0], b[0], t1), z0 = lerp(a[2], b[2], t0), z1 = lerp(a[2], b[2], t1);
      addBox(ctx, Math.min(x0, x1) - 2.0, HUB * t0, Math.min(z0, z1) - 2.0, Math.max(x0, x1) + 2.0, HUB * t1, Math.max(z0, z1) + 2.0, 'building', 'flyer-leg');
    }
  }
  // cross braces between the legs
  for (const f of [0.25, 0.5, 0.75]) for (const sx of [-1, 1]) {
    sb.cylBetween([X + sx * lerp(12, 5, f), HUB * f, Z - lerp(46, 2, f)], [X + sx * lerp(12, 5, f), HUB * f, Z + lerp(46, 2, f)], 0.5, STEEL);
  }
  // hub housing
  sb.boxAll(X - 9, HUB - 5, Z - 5, X + 9, HUB + 5, Z + 5, 4, [0.88, 0.9, 0.94]);
  addBox(ctx, X - 9, HUB - 5, Z - 5, X + 9, HUB + 5, Z + 5, 'building', 'flyer-hub');
  // terminal
  emitBox(ctx, 'glassBlue', X + 16, 0, Z - 26, X + 56, 12, Z + 26, { col: [1, 1, 1.05], id: 'flyer-terminal' });
  ctx.chunks.bucket(X, Z, 'night').boxAll(X + 16, 11.5, Z - 26, X + 56, 12.1, Z + 26, 1, [0.5, 0.9, 1.0]);
  ctx.landmarks['Singapore Flyer'] = new THREE.Vector3(X, 0, Z);
  ctx.minimapB.push({ x: X + 26, z: Z, w: 40, d: 52, h: 12 }, { x: X, z: Z, w: 24, d: 92, h: 90 });
  ctx.flyer = { x: X, z: Z, R, hub: HUB };
}

/** Rotating wheel + cabins. Returns { update(dt, night) }. */
export function makeFlyerWheel(ctx, group, quality) {
  const { x: X, z: Z, R, hub } = ctx.flyer;
  const wheel = new THREE.Group();
  wheel.position.set(X, hub, Z);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe6edf3, roughness: 0.4, metalness: 0.6, envMapIntensity: 1.2, emissive: 0x3ba0ff, emissiveIntensity: 0 });
  const rimGeo = new THREE.TorusGeometry(R, 0.9, 6, 72);
  for (const dx of [-2.6, 2.6]) { const t = new THREE.Mesh(rimGeo, rimMat); t.rotation.y = Math.PI / 2; t.position.x = dx; wheel.add(t); }
  // spokes (cables): thin cylinders
  const spokes = new THREE.CylinderGeometry(0.1, 0.1, 1, 4);
  const n = 40;
  const sm = new THREE.InstancedMesh(spokes, new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.5, metalness: 0.6 }), n * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const dx of [-2.6, 2.6]) {
      // spoke from hub (0,0) to rim point; cylinder is along y: rotate about x
      p.set(dx * 0.5, Math.cos(a) * R / 2, Math.sin(a) * R / 2);
      e.set(a - Math.PI / 2 + Math.PI, 0, 0); // y axis -> radial direction in the yz-plane
      e.set(0, 0, 0);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx * 0.0, Math.cos(a), Math.sin(a)).normalize());
      s.set(1, R, 1);
      m.compose(p, q, s);
      sm.setMatrixAt(k++, m);
    }
  }
  wheel.add(sm);
  // axle hub
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 8, 12), rimMat);
  axle.rotation.z = Math.PI / 2; wheel.add(axle);
  group.add(wheel);
  // cabins (counter-rotated: stay upright)
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f5, roughness: 0.15, metalness: 0.3, envMapIntensity: 1.5, transparent: true, opacity: 0.85, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const cabinGeo = new THREE.CapsuleGeometry(1.9, 3.6, 3, 8);
  cabinGeo.rotateZ(Math.PI / 2);
  const cabins = new THREE.InstancedMesh(cabinGeo, cabinMat, 28);
  cabins.frustumCulled = false;
  group.add(cabins);
  let ang = 0.7;
  const place = () => {
    for (let i = 0; i < 28; i++) {
      const a = ang + (i / 28) * Math.PI * 2;
      m.compose(p.set(X, hub + Math.cos(a) * (R + 2.2), Z + Math.sin(a) * (R + 2.2)).add(new THREE.Vector3(0, -3.0 + 3.0, 0)), q.identity(), s.set(1, 1, 1));
      cabins.setMatrixAt(i, m);
    }
    cabins.instanceMatrix.needsUpdate = true;
    wheel.rotation.x = ang;
  };
  place();
  return {
    update(dt, night) {
      ang += dt * 0.035; place();
      rimMat.emissiveIntensity = night * 1.6; cabinMat.emissiveIntensity = night * 1.1;
    },
  };
}
