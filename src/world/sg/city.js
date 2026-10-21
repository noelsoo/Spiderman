// CBD supertalls, Marina Bay Financial Centre / Marina One and generic city blocks.
import * as THREE from 'three';
import { Bucket } from '../geo.js';
import { STYLES, addSgMaterials } from '../materials.js';
import { emitBox, addBox, lightBox, roofClutter, simpleBuilding } from './builders.js';
import { cells, WEST_X, WEST_Z, AVE } from './layout.js';

const PALE = [0.9, 0.9, 0.88];

function register(ctx, cx, cz, w, d, h, tiers) {
  const spec = { h, tiers, cx, cz, w, d };
  ctx.specs.push(spec);
  ctx.minimapB.push({ x: cx, z: cz, w, d, h });
  return spec;
}

/** Red aircraft beacon + mast */
function mast(ctx, x, y, z, h, r = 0.45) {
  ctx.chunks.bucket(x, z, 'street').cylV(x, y, z, r, h, 5, [0.75, 0.76, 0.8], r * 0.35);
  ctx.chunks.bucket(x, z, 'beacon').boxAll(x - 0.5, y + h - 0.6, z - 0.5, x + 0.5, y + h + 0.4, z + 0.5, 1, [4, 0.25, 0.2]);
}

/** Vertical corner light strips + top crown line, bright at night. */
function nightLines(ctx, x0, z0, x1, z1, y0, y1, col, o = {}) {
  const t = o.t ?? 0.6;
  if (o.corners !== false) for (const [x, z] of [[x0, z0], [x1 - t, z0], [x0, z1 - t], [x1 - t, z1 - t]]) lightBox(ctx, x, y0, z, x + t, y1, z + t, col);
  lightBox(ctx, x0 - 0.2, y1 - 1.2, z0 - 0.2, x1 + 0.2, y1 + 0.2, z1 + 0.2, col);
}

/** Supertall tower. o: cx,cz,w,d,h,style,shape,crown,col,glow */
export function supertall(ctx, rng, o) {
  const { cx, cz, w, d, h, style = 'glassSteel', shape = 'plain', crown = 'flat', glow = [0.5, 0.75, 1.0] } = o;
  const col = o.col || [1, 1, 1];
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const tiers = [];
  let topY = h, tx0 = x0, tx1 = x1, tz0 = z0, tz1 = z1;
  // podium
  const pod = o.podium ?? Math.min(18, h * 0.07);
  if (pod > 3) {
    emitBox(ctx, 'concrete', x0, 0, z0, x1, pod, z1, { col: PALE, id: o.id });
    tiers.push({ x0, x1, z0, z1, y1: pod });
  }
  const inset = pod > 3 ? 0.12 : 0;
  const bx0 = x0 + w * inset, bx1 = x1 - w * inset, bz0 = z0 + d * inset, bz1 = z1 - d * inset;
  const y0 = pod > 3 ? pod : 0;
  if (shape === 'plain') {
    emitBox(ctx, style, bx0, y0, bz0, bx1, h, bz1, { col, id: o.id });
    tiers.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, y1: h });
    tx0 = bx0; tx1 = bx1; tz0 = bz0; tz1 = bz1;
  } else if (shape === 'stepped') {
    const cuts = [[y0, h * 0.62, 0], [h * 0.62, h * 0.86, 0.09], [h * 0.86, h, 0.19]];
    for (const [ya, yb, k] of cuts) {
      const ix = (bx1 - bx0) * k, iz = (bz1 - bz0) * k;
      emitBox(ctx, style, bx0 + ix, ya, bz0 + iz, bx1 - ix, yb, bz1 - iz, { col, id: o.id });
      tiers.push({ x0: bx0 + ix, x1: bx1 - ix, z0: bz0 + iz, z1: bz1 - iz, y1: yb });
      tx0 = bx0 + ix; tx1 = bx1 - ix; tz0 = bz0 + iz; tz1 = bz1 - iz;
    }
  } else if (shape === 'octa') {
    // octagonal prism (UOB Plaza style): chamfered corners
    const st = STYLES[style];
    const b = ctx.chunks.bucket(cx, cz, st.mat);
    const c = Math.min(bx1 - bx0, bz1 - bz0) * 0.27;
    const P = [[bx0 + c, bz0], [bx1 - c, bz0], [bx1, bz0 + c], [bx1, bz1 - c], [bx1 - c, bz1], [bx0 + c, bz1], [bx0, bz1 - c], [bx0, bz0 + c]];
    let u = 0;
    for (let i = 0; i < 8; i++) {
      const [ax, az] = P[i], [qx, qz] = P[(i + 1) % 8];
      const len = Math.hypot(qx - ax, qz - az);
      // outward normal for clockwise-in-xz ordering (z down): rotate edge direction
      const nx = (qz - az) / len, nz = -(qx - ax) / len;
      b.quad([qx, y0, qz], [ax, y0, az], [ax, h, az], [qx, h, qz], nx, 0, nz, u / st.tw, y0 / st.th, (u + len) / st.tw, h / st.th, col);
      u += len;
    }
    const rb = ctx.chunks.bucket(cx, cz, 'roof');
    rb.top(bx0 + c, bz0, bx1 - c, bz1, h, 12, PALE); rb.top(bx0, bz0 + c, bx1, bz1 - c, h, 12, PALE);
    const sh = 0.07;
    const phx0 = bx0 + (bx1 - bx0) * sh, phx1 = bx1 - (bx1 - bx0) * sh, phz0 = bz0 + (bz1 - bz0) * sh, phz1 = bz1 - (bz1 - bz0) * sh;
    addBox(ctx, phx0, y0, phz0, phx1, h, phz1, 'building', o.id);
    tiers.push({ x0: phx0 + 2, x1: phx1 - 2, z0: phz0 + 2, z1: phz1 - 2, y1: h });
    tx0 = bx0 + c; tx1 = bx1 - c; tz0 = bz0 + c; tz1 = bz1 - c;
  } else if (shape === 'slant') {
    // sloping top (Guoco Tower): stack of shrinking slabs rising towards -z
    const hb = h * 0.9;
    emitBox(ctx, style, bx0, y0, bz0, bx1, hb, bz1, { col, id: o.id, roof: false });
    const n = 7;
    for (let k = 0; k < n; k++) {
      const ya = hb + (h - hb) * k / n, yb = hb + (h - hb) * (k + 1) / n;
      const zz1 = bz1 - (bz1 - bz0) * (k + 1) / (n + 1);
      emitBox(ctx, style, bx0, ya, bz0, bx1, yb, zz1, { col, id: o.id, roof: k === n - 1 });
      ctx.chunks.bucket(cx, cz, 'roof').top(bx0, zz1, bx1, bz1 - (bz1 - bz0) * k / (n + 1), ya, 12, PALE);
    }
    tiers.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 - (bz1 - bz0) * 0.5, y1: hb }, { x0: bx0, x1: bx1, z0: bz0, z1: bz0 + (bz1 - bz0) * 0.2, y1: h });
    tx0 = bx0; tx1 = bx1; tz0 = bz0; tz1 = bz0 + (bz1 - bz0) * 0.15;
  } else if (shape === 'twin') {
    const gap = (bx1 - bx0) * 0.12, tw2 = ((bx1 - bx0) - gap) / 2;
    emitBox(ctx, style, bx0, y0, bz0, bx0 + tw2, h, bz1, { col, id: o.id });
    emitBox(ctx, style, bx1 - tw2, y0, bz0, bx1, h * 0.86, bz1, { col, id: o.id });
    tiers.push({ x0: bx0, x1: bx0 + tw2, z0: bz0, z1: bz1, y1: h }, { x0: bx1 - tw2, x1: bx1, z0: bz0, z1: bz1, y1: h * 0.86 });
    // link bridge
    emitBox(ctx, 'concrete', bx0 + tw2, h * 0.8, cz - 4, bx1 - tw2, h * 0.8 + 8, cz + 4, { col: PALE, type: 'bridge' });
    tx0 = bx0; tx1 = bx0 + tw2; tz0 = bz0; tz1 = bz1;
  }
  register(ctx, cx, cz, w, d, h, tiers);
  // crown / roof
  const mx = (tx0 + tx1) / 2, mz = (tz0 + tz1) / 2;
  if (crown === 'spire') mast(ctx, mx, h, mz, Math.min(34, h * 0.14));
  else if (crown === 'ring') {
    const t = ctx.chunks.bucket(mx, mz, 'street');
    t.boxAll(tx0 - 0.4, h, tz0 - 0.4, tx1 + 0.4, h + 0.7, tz1 + 0.4, 1, [0.7, 0.72, 0.75]);
    for (const [x, z] of [[tx0, tz0], [tx1 - 0.5, tz0], [tx0, tz1 - 0.5], [tx1 - 0.5, tz1 - 0.5]]) t.boxAll(x, h, z, x + 0.5, h + 6, z + 0.5, 1, [0.7, 0.72, 0.75]);
    lightBox(ctx, tx0 - 0.5, h + 5.4, tz0 - 0.5, tx1 + 0.5, h + 6.2, tz1 + 0.5, glow);
    mast(ctx, mx, h + 0.7, mz, 18);
  } else if (crown === 'crown') {
    lightBox(ctx, tx0 - 0.3, h - 3, tz0 - 0.3, tx1 + 0.3, h - 1.8, tz1 + 0.3, glow);
    const t = ctx.chunks.bucket(mx, mz, 'street');
    t.boxAll(mx - 3, h, mz - 3, mx + 3, h + 7, mz + 3, 1, [0.66, 0.68, 0.72]);
    mast(ctx, mx, h + 7, mz, 16);
  } else if (crown === 'flat' && ctx.detail) roofClutter(ctx, ctx.rng, tx0, tz0, tx1, tz1, h);
  if (o.lines !== false) {
    const body = tiers.filter((t) => t.y1 > (pod > 3 ? pod : 0) + 1 && !(pod > 3 && t.y1 === pod));
    body.forEach((t, k) => {
      const ya = k === 0 ? y0 : body[k - 1].y1;
      for (const [x, z] of [[t.x0, t.z0], [t.x1 - 0.4, t.z0], [t.x0, t.z1 - 0.4], [t.x1 - 0.4, t.z1 - 0.4]]) lightBox(ctx, x, ya, z, x + 0.4, t.y1, z + 0.4, glow.map((v) => v * 0.45));
      if (k === body.length - 1) lightBox(ctx, t.x0 - 0.2, t.y1 - 1.2, t.z0 - 0.2, t.x1 + 0.2, t.y1 + 0.2, t.z1 + 0.2, glow);
    });
  }
  if (o.name) ctx.landmarks[o.name] = new THREE.Vector3(cx, 0, cz);
}

// HDB colour bands (tints multiplied into the cream facade) and shophouse pastels
const HDB_TINTS = [[1, 0.97, 0.9], [0.78, 0.9, 1.0], [1.0, 0.82, 0.8], [0.98, 0.93, 0.7], [0.82, 0.95, 0.85], [0.92, 0.86, 1.0]];
const SHOP_TINTS = [[1, 0.82, 0.86], [0.8, 0.95, 0.95], [1, 0.95, 0.7], [0.85, 0.88, 1], [0.95, 0.85, 0.7]];
const pick = (rng, a) => a[(rng() * a.length) | 0];

function fillCell(ctx, rng, c, prof) {
  if (ctx.T?.ensureSg) addSgMaterials(ctx.T, ctx.M);
  const w = c.x1 - c.x0, d = c.z1 - c.z0;
  if (w < 20 || d < 20) return;
  // paved plaza under the whole block
  ctx.chunks.bucket((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 'sidewalk').top(c.x0 - 6, c.z0 - 6, c.x1 + 6, c.z1 + 6, 0.12, 6, [0.8, 0.78, 0.74]);
  if (rng() < (prof.park ?? 0.1)) { // small park
    ctx.chunks.bucket((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 'grass').top(c.x0 + 3, c.z0 + 3, c.x1 - 3, c.z1 - 3, 0.14, 8, [0.85, 0.95, 0.8]);
    for (let k = 0; k < 8; k++) ctx.palmSpots.push([c.x0 + 8 + rng() * (w - 16), c.z0 + 8 + rng() * (d - 16), rng() < 0.5 ? 1 : 0]);
    ctx.minimapPark.push({ x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2, w: w - 6, d: d - 6 });
    return;
  }
  const big = prof.h1 > 100;
  const target = big ? 78 : 56;
  const nx = Math.max(1, Math.round(w / (target * (0.8 + rng() * 0.4)))), nz = Math.max(1, Math.round(d / (target * (0.8 + rng() * 0.4)))), gap = 8;
  const lw = (w - gap * (nx - 1)) / nx, ld = (d - gap * (nz - 1)) / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx0 = c.x0 + i * (lw + gap), lz0 = c.z0 + j * (ld + gap);
    if (nx * nz > 2 && rng() < 0.12) { ctx.chunks.bucket(lx0, lz0, 'grass').top(lx0 + 2, lz0 + 2, lx0 + lw - 2, lz0 + ld - 2, 0.14, 8, [0.85, 0.95, 0.8]); for (let k = 0; k < 3; k++) ctx.palmSpots.push([lx0 + 6 + rng() * (lw - 12), lz0 + 6 + rng() * (ld - 12), rng() < 0.5 ? 1 : 0]); continue; }
    const inset = 1 + rng() * 3;
    const h = prof.h0 + rng() * (prof.h1 - prof.h0);
    const style = h > prof.glassAbove ? prof.glass[(rng() * prof.glass.length) | 0] : prof.low[(rng() * prof.low.length) | 0];
    let st2 = style, col;
    if (ctx.M.hdb && prof.res) {
      if (h < 26 && rng() < 0.7) { st2 = 'shophouse'; col = pick(rng, SHOP_TINTS); }
      else if (h < prof.res && rng() < 0.55) { st2 = 'hdb'; col = pick(rng, HDB_TINTS); }
    }
    simpleBuilding(ctx, rng, lx0 + inset, lz0 + inset, lx0 + lw - inset, lz0 + ld - inset, h, st2, { id: 'blk', col });
    if (h > 120) nightLines(ctx, lx0 + inset, lz0 + inset, lx0 + lw - inset, lz0 + ld - inset, 0, h, [0.9, 0.85, 0.6], { corners: false });
  }
}

const P_CBD = (k) => ({ h0: 110 + k * 40, h1: 190 + k * 70, glassAbove: 40, glass: ['glassBlue', 'glassTeal', 'glassSteel'], low: ['glassSteel'], park: 0.04 });
const P_MID = { h0: 35, h1: 100, glassAbove: 60, glass: ['glassSteel', 'glassBlue'], low: ['concrete', 'limestone', 'concrete'], park: 0.12, res: 60 };
const P_LOW = { h0: 14, h1: 55, glassAbove: 90, glass: ['glassSteel'], low: ['concrete', 'limestone', 'concrete', 'limestone'], park: 0.2, res: 80 };

export function buildCity(ctx) {
  const rng = ctx.rng;
  const cl = cells(WEST_X, WEST_Z);
  const taken = new Set();
  const cellAt = (i, j) => cl.find((c) => c.i === i && c.j === j);
  const cs = (i, j) => { const c = cellAt(i, j); return { cx: (c.x0 + c.x1) / 2, cz: (c.z0 + c.z1) / 2, w: c.x1 - c.x0, d: c.z1 - c.z0 }; };

  // --- named CBD supertalls ---
  const named = [
    // i, j, options
    [3, 5, { name: 'Raffles Place', shape: 'stepped', crown: 'spire', h: 280, style: 'glassSteel', glow: [0.55, 0.8, 1.0], w: 0.62, d: 0.62 }],
    [3, 6, { name: 'UOB Plaza', shape: 'octa', crown: 'flat', h: 280, style: 'glassBlue', glow: [0.6, 0.65, 1.0], w: 0.72, d: 0.72 }],
    [3, 7, { name: 'Guoco Tower', shape: 'slant', crown: 'flat', h: 290, style: 'glassBlue', glow: [0.4, 0.9, 1.0], w: 0.6, d: 0.7 }],
    [2, 5, { name: 'Republic Plaza', shape: 'stepped', crown: 'spire', h: 276, style: 'glassTeal', glow: [0.3, 1.0, 0.8], w: 0.6, d: 0.6 }],
    [2, 6, { name: 'Capital Tower', shape: 'plain', crown: 'ring', h: 254, style: 'glassSteel', glow: [1.0, 0.9, 0.6], w: 0.58, d: 0.58 }],
    [3, 4, { name: 'OCBC Centre', shape: 'twin', crown: 'flat', h: 198, style: 'glassTeal', glow: [0.6, 1.0, 0.9], w: 0.74, d: 0.5 }],
    [2, 7, { name: 'Tanjong Pagar Centre', shape: 'stepped', crown: 'crown', h: 268, style: 'glassBlue', glow: [0.7, 0.85, 1.0], w: 0.6, d: 0.6 }],
    [3, 8, { name: 'Asia Square', shape: 'twin', crown: 'crown', h: 245, style: 'glassBlue', glow: [0.5, 0.8, 1.0], w: 0.8, d: 0.55 }],
    [2, 4, { name: 'CBD Tower 6', shape: 'plain', crown: 'spire', h: 232, style: 'glassSteel', glow: [0.8, 0.9, 1.0], w: 0.55, d: 0.6 }],
    [2, 8, { name: 'CBD Tower 7', shape: 'plain', crown: 'crown', h: 224, style: 'glassTeal', glow: [0.5, 1.0, 0.9], w: 0.6, d: 0.55 }],
    [3, 3, { name: 'CBD Tower 8', shape: 'plain', crown: 'ring', h: 210, style: 'glassSteel', glow: [1.0, 0.85, 0.55], w: 0.58, d: 0.6 }],
  ];
  for (const [i, j, o] of named) {
    const c = cs(i, j);
    taken.add(i + ',' + j);
    // fill the rest of the block with a plaza and one low neighbour
    const cc = cellAt(i, j);
    ctx.chunks.bucket(c.cx, c.cz, 'sidewalk').top(cc.x0 - 6, cc.z0 - 6, cc.x1 + 6, cc.z1 + 6, 0.12, 6, [0.8, 0.78, 0.74]);
    const jx = (rng() - 0.5) * 6, jz = (rng() - 0.5) * 6;
    supertall(ctx, rng, { ...o, cx: c.cx + jx, cz: c.cz + jz, w: c.w * o.w, d: c.d * o.d, id: o.name });
    for (let k = 0; k < 6; k++) ctx.palmSpots.push([cc.x0 + 6 + rng() * (c.w - 12), cc.z0 + 5 + rng() * (c.d - 10), 1]);
  }

  // --- generic fill ---
  for (const c of cl) {
    if (taken.has(c.i + ',' + c.j)) continue;
    // bay-facing west column is skipped where it would overlap the Fullerton / Merlion plot
    if (c.i === 3 && c.j === 3) continue;
    const cbd = c.i >= 2 && c.j >= 3 && c.j <= 8;
    let prof;
    if (c.i === 3 && c.j >= 3 && c.j <= 8) prof = P_CBD(1);
    else if (cbd) prof = P_CBD(0.4);
    else if (c.i >= 1 && c.j >= 2 && c.j <= 9) prof = P_MID;
    else prof = P_LOW;
    fillCell(ctx, rng, c, prof);
  }
}

/** North-central, east and south filler blocks (no roads of their own in the middle). */
export function buildOuterBlocks(ctx) {
  const rng = ctx.rng;
  const north = cells([-380, -140, 100, 380], [-800, -680, -560, -440]);
  for (const c of north) {
    if (c.i === 2 && c.j === 2) { // park with diagonal road
      ctx.chunks.bucket((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 'grass').top(c.x0, c.z0, c.x1, c.z1, 0.08, 8, [0.8, 0.95, 0.75]);
      continue;
    }
    fillCell(ctx, rng, c, c.j === 2 ? P_MID : P_LOW);
  }
  for (const c of cells([380, 600], [-800, -680, -560, -440])) fillCell(ctx, rng, c, P_LOW);
  for (const c of cells([600, 790], [-800, -440])) fillCell(ctx, rng, c, P_LOW);
  for (const c of cells([600, 790], [-440, -130, 290])) fillCell(ctx, rng, c, { ...P_LOW, park: 0.5 });
  for (const c of cells([380, 600], [-130, 290])) fillCell(ctx, rng, c, { h0: 8, h1: 20, glassAbove: 90, glass: ['glassSteel'], low: ['concrete', 'limestone'], park: 0.55 });
  // the far west fringe beyond the last avenue
  for (const [x0, x1] of [[-940, -880]]) {
    for (let z = -780; z < 760; z += 100) simpleBuilding(ctx, rng, x0 + 4, z, x1 - 4, z + 60, 20 + rng() * 40, 'concrete');
  }
}

/** Marina Bay Financial Centre, Marina One + Gardens-side park (south-central plot). */
export function buildMarinaSouth(ctx) {
  const rng = ctx.rng;
  const plaza = (x0, z0, x1, z1) => ctx.chunks.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'sidewalk').top(x0, z0, x1, z1, 0.12, 6, [0.82, 0.8, 0.76]);
  plaza(-361, 184, 163, 470);
  // MBFC: three towers on a shared podium
  emitBox(ctx, 'concrete', -330, 0, 200, -120, 22, 290, { col: PALE, id: 'mbfc-podium' });
  const mb = [[-300, 245, 52, 'glassTeal', 245, [0.45, 0.95, 1.0]], [-225, 245, 50, 'glassBlue', 205, [0.6, 0.8, 1.0]], [-150, 245, 50, 'glassSteel', 195, [0.8, 0.9, 1.0]]];
  mb.forEach(([x, z, w, st, h, glow], k) => {
    supertall(ctx, rng, { cx: x, cz: z, w, d: 60, h, style: st, shape: k === 0 ? 'stepped' : 'plain', crown: k === 0 ? 'spire' : 'crown', glow, podium: 0, name: k === 0 ? 'Marina Bay Financial Centre' : undefined, id: 'mbfc' + k });
  });
  // Marina One: two curved pairs around the "green heart"
  const gh = ctx.chunks.bucket(-45, 365, 'grass');
  gh.top(-80, 320, -10, 420, 0.14, 8, [0.7, 0.95, 0.65]);
  for (let k = 0; k < 40; k++) ctx.palmSpots.push([-78 + rng() * 66, 322 + rng() * 96, rng() < 0.5 ? 1 : 0]);
  emitBox(ctx, 'concrete', -115, 0, 310, 25, 12, 430, { col: PALE, id: 'm1-base', physics: true });
  // green terraces on the podium roof
  ctx.chunks.bucket(-45, 365, 'grass').top(-100, 322, 10, 420, 12.05, 8, [0.6, 0.9, 0.55]);
  const m1 = [[-98, 335, 'glassTeal', 190], [-98, 402, 'glassBlue', 178], [28 - 14, 335, 'glassSteel', 186], [28 - 14, 402, 'glassTeal', 195]];
  m1.forEach(([x, z, st, h], k) => {
    // two staggered slabs per tower give the 'wavy' Marina One silhouette
    emitBox(ctx, st, x - 18, 12, z - 24, x + 18, h * 0.8, z + 24, { col: [0.95, 1, 0.95], id: 'm1' + k });
    emitBox(ctx, st, x - 14, h * 0.8, z - 20, x + 14, h, z + 20, { col: [0.95, 1, 0.95], id: 'm1' + k });
    ctx.specs.push({ h, tiers: [{ x0: x - 14, x1: x + 14, z0: z - 20, z1: z + 20, y1: h }], cx: x, cz: z, w: 36, d: 48 });
    ctx.minimapB.push({ x, z, w: 36, d: 48, h });
    nightLines(ctx, x - 18, z - 24, x + 18, z + 24, 12, h * 0.8, [0.6, 1, 0.8]);
    mast(ctx, x, h, z, 14);
  });
  ctx.landmarks['Marina One'] = new THREE.Vector3(-45, 0, 365);
  // remaining plot: trees only (Marina Bay Gardens)
  for (let k = 0; k < 90; k++) ctx.palmSpots.push([-350 + rng() * 500, 470 + rng() * 300, rng() < 0.6 ? 1 : 0]);
  ctx.chunks.bucket(-100, 600, 'grass').top(-361, 470, 163, 830, 0.1, 10, [0.75, 0.95, 0.7]);
  ctx.minimapPark.push({ x: -100, z: 640, w: 520, d: 360 });
}
