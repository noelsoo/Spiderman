// Procedural Manhattan-style city: blocks, lots, buildings, roof props, streets, parks and five districts
// (Midtown, Financial District, Upper West/East Side, Hell's Kitchen, Brooklyn). See grid.js for the layout.
import * as THREE from 'three';
import { Bucket, WHITE, mulberry32 } from './geo.js';
import { STYLES } from './materials.js';
import { planShops, buildShops } from './shops.js';
import { buildLamps, buildStreetProps, buildSigns, fireEscape, roofExtras, TrafficLights } from './props.js';
import {
  L, colX, rowZ, avenueX, streetZ, AVES, STREETS, ST_RANGE, streetSpans, hasAve, parkOf, isPark, isReserved, BLOCKS, PARKS, inWater,
} from './grid.js';

export * from './grid.js';

const STONE = [0.78, 0.72, 0.62];
const ROOFC = [0.85, 0.85, 0.85];
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** far-LOD tint per facade style (multiplies the grey window atlas) */
const FAR_TINT = {
  glassTeal: [0.34, 0.62, 0.7], glassBlue: [0.36, 0.52, 0.84], glassSteel: [0.5, 0.58, 0.7],
  brownstone: [0.72, 0.46, 0.34], redbrick: [0.82, 0.38, 0.28], limestone: [0.92, 0.84, 0.66], concrete: [0.66, 0.66, 0.65],
};
const FAR_ROOF = [0.62, 0.62, 0.6];
const FAR_UV = 0.0234;
export const FAR_TILE = 28.8;

const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
const rr = (rng, a, b) => a + (b - a) * rng();

export function addBox(ctx, x0, y0, z0, x1, y1, z1, type, id) {
  ctx.physics.addBox(_a.set(x0, y0, z0), _b.set(x1, y1, z1), { type, id, height: y1 });
}

/** Simplified box for the far LOD (one merged mesh per tile): windows from a tiny atlas, flat roof. */
export function farBox(ctx, x0, y0, z0, x1, y1, z1, tint, col = WHITE) {
  if (!ctx.far) return;
  const fb = ctx.far.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'far');
  const c = [tint[0] * col[0], tint[1] * col[1], tint[2] * col[2]];
  fb.walls(x0, y0, z0, x1, y1, z1, FAR_TILE, FAR_TILE, 0, c);
  fb.topC(x0, z0, x1, z1, y1, FAR_UV, FAR_UV, [FAR_ROOF[0] * col[0], FAR_ROOF[1] * col[1], FAR_ROOF[2] * col[2]]);
}

/** Emit one box tier: facade walls, roof top, cornice, parapet and the physics box. */
export function emitTier(ctx, styleName, x0, y0, z0, x1, y1, z1, o = {}) {
  const st = STYLES[styleName];
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const col = o.col || WHITE;
  ctx.chunks.bucket(cx, cz, st.mat).walls(x0, y0, z0, x1, y1, z1, st.tw, st.th, o.uOff || 0, col);
  const rb = ctx.chunks.bucket(cx, cz, 'roof');
  const e = ctx.detail && o.cornice !== false ? 0.35 : 0;
  rb.top(x0 - e, z0 - e, x1 + e, z1 + e, y1, 8, ROOFC);
  if (e) {
    rb.walls(x0 - e, y1 - 0.9, z0 - e, x1 + e, y1, z1 + e, 4, 4, 0, STONE);
    const h = 0.5, t = 0.4, X0 = x0 - e, X1 = x1 + e, Z0 = z0 - e, Z1 = z1 + e;
    rb.boxAll(X0, y1, Z0, X1, y1 + h, Z0 + t, 4, STONE);
    rb.boxAll(X0, y1, Z1 - t, X1, y1 + h, Z1, 4, STONE);
    rb.boxAll(X0, y1, Z0 + t, X0 + t, y1 + h, Z1 - t, 4, STONE);
    rb.boxAll(X1 - t, y1, Z0 + t, X1, y1 + h, Z1 - t, 4, STONE);
  }
  farBox(ctx, x0, y0, z0, x1, y1, z1, FAR_TINT[styleName] || FAR_TINT.concrete, col);
  if (ctx.physics && o.physics !== false) addBox(ctx, x0, y0, z0, x1, y1, z1, o.type || 'building', o.id);
}

let _tankGeo = null;
function tankParts() {
  if (_tankGeo) return _tankGeo;
  const cyl = new THREE.CylinderGeometry(1.7, 1.7, 3.2, 10, 1).toNonIndexed();
  const cone = new THREE.ConeGeometry(1.85, 1.0, 10).toNonIndexed();
  return (_tankGeo = { cyl, cone });
}


/** Scatter props on a roof rectangle. Returns nothing; registers physics for the ones worth standing on. */
function decorateRoof(ctx, rng, x0, z0, x1, z1, y, o) {
  const w = x1 - x0, d = z1 - z0;
  if (w < 8 || d < 8) return;
  const pb = ctx.chunks.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'prop');
  const rb = ctx.chunks.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'roof');
  const placed = [];
  const free = (cx, cz, hx, hz) => {
    if (cx - hx < x0 + 1.2 || cx + hx > x1 - 1.2 || cz - hz < z0 + 1.2 || cz + hz > z1 - 1.2) return false;
    for (const p of placed) if (Math.abs(p[0] - cx) < p[2] + hx + 0.8 && Math.abs(p[1] - cz) < p[3] + hz + 0.8) return false;
    placed.push([cx, cz, hx, hz]);
    return true;
  };
  const rnd = (hx, hz) => [rr(rng, x0 + 1.2 + hx, x1 - 1.2 - hx), rr(rng, z0 + 1.2 + hz, z1 - 1.2 - hz)];

  // mechanical penthouse
  if (w >= 13 && d >= 12 && rng() < 0.55) {
    const hx = rr(rng, 3, 5), hz = rr(rng, 2.6, 4), hh = rr(rng, 3, 5);
    const [px, pz] = rnd(hx, hz);
    if (free(px, pz, hx, hz)) {
      const c = pick(rng, [[0.72, 0.7, 0.66], [0.6, 0.62, 0.64], [0.8, 0.74, 0.62]]);
      rb.boxAll(px - hx, y, pz - hz, px + hx, y + hh, pz + hz, 4, c);
      pb.boxAll(px - hx - 0.2, y + hh, pz - hz - 0.2, px + hx + 0.2, y + hh + 0.25, pz + hz + 0.2, 4, [0.3, 0.3, 0.32]);
      addBox(ctx, px - hx, y, pz - hz, px + hx, y + hh + 0.25, pz + hz, 'roof', 'pent');
    }
  }
  // water tank (brick / low buildings)
  if (o.tanks && rng() < (o.lite ? 0.3 : 0.55)) {
    const [px, pz] = rnd(1.9, 1.9);
    if (free(px, pz, 1.9, 1.9)) {
      const { cyl, cone } = tankParts();
      const wood = [0.34 + rng() * 0.06, 0.22, 0.13];
      const m = new THREE.Matrix4();
      pb.addGeo(cyl, m.makeTranslation(px, y + 1.5 + 1.6, pz), wood);
      pb.addGeo(cone, m.makeTranslation(px, y + 1.5 + 3.2 + 0.5, pz), [0.2, 0.17, 0.15]);
      for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) pb.boxAll(px + lx - 0.12, y, pz + lz - 0.12, px + lx + 0.12, y + 1.5, pz + lz + 0.12, 2, [0.16, 0.16, 0.17]);
      pb.boxAll(px - 1.8, y + 1.2, pz - 1.8, px + 1.8, y + 1.5, pz + 1.8, 2, [0.22, 0.2, 0.18]);
      addBox(ctx, px - 1.8, y, pz - 1.8, px + 1.8, y + 5.1, pz + 1.8, 'prop', 'tank');
    }
  }
  // AC units & vents
  const nAC = o.lite ? 1 + ((rng() * 2) | 0) : Math.min(5, 1 + ((rng() * (1 + (w * d) / 160)) | 0));
  for (let i = 0; i < nAC; i++) {
    const hx = rr(rng, 0.9, 1.4), hz = rr(rng, 0.8, 1.2), hh = rr(rng, 1.0, 1.5);
    const [px, pz] = rnd(hx, hz);
    if (!free(px, pz, hx, hz)) continue;
    const g = 0.62 + rng() * 0.2;
    pb.boxAll(px - hx, y, pz - hz, px + hx, y + hh, pz + hz, 2, [g, g + 0.02, g + 0.04]);
    pb.top(px - hx * 0.7, pz - hz * 0.7, px + hx * 0.7, pz + hz * 0.7, y + hh + 0.02, 2, [0.1, 0.1, 0.11]);
  }
  // antenna
  if (o.antenna && rng() < 0.4) {
    const [px, pz] = rnd(0.3, 0.3);
    if (free(px, pz, 0.3, 0.3)) {
      const hh = rr(rng, 6, 16);
      pb.boxAll(px - 0.15, y, pz - 0.15, px + 0.15, y + hh, pz + 0.15, 1, [0.35, 0.35, 0.38]);
      ctx.glow.boxAll(px - 0.3, y + hh, pz - 0.3, px + 0.3, y + hh + 0.6, pz + 0.3, 1, [5, 0.25, 0.15]);
    }
  }
  if (!o.lite) roofExtras(ctx, ctx.rng2, x0, z0, x1, z1, y, !!o.antenna);
}

function snap3(v) { return Math.floor(v / 3) * 3; }

/** Decide everything about a building before emission (so the spawn building can be reserved). */
function planBuilding(rng, lot, district = 'midtown', tower = false) {
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  let w = snap3(lot.x1 - lot.x0), d = snap3(lot.z1 - lot.z0);
  if (w < 9 || d < 9) return null;
  let h, kind;
  if (district === 'midtown') {
    const dist = Math.hypot(cx - L.CENTER.x, cz - L.CENTER.z);
    const hmid = 24 + 235 * Math.exp(-Math.pow(dist / 340, 2));
    h = hmid * (0.3 + 0.85 * Math.pow(rng(), 1.2));
    if (rng() < 0.06) h *= 1.4;
    h = Math.max(14, Math.min(205, h));

    
    const r = rng();
    if (h > 110) { kind = r < 0.6 ? 'glass' : r < 0.9 ? 'deco' : 'plain'; }
    else if (h > 45) { kind = r < 0.3 ? 'glass' : r < 0.6 ? 'deco' : r < 0.85 ? 'brick' : 'plain'; }
    else { kind = r < 0.6 ? 'brick' : r < 0.8 ? 'plain' : 'deco'; }
  } else ({ h, kind } = heightKind(rng, district, cx, cz, tower));
  let style;
  if (kind === 'glass') style = pick(rng, ['glassTeal', 'glassBlue', 'glassSteel', 'glassTeal', 'glassBlue']);
  else if (kind === 'deco') style = 'limestone';
  else if (kind === 'brick') style = rng() < 0.5 ? 'brownstone' : 'redbrick';
  else style = 'concrete';
  const st = STYLES[style];
  const hr = (v) => Math.max(st.py * 2, Math.round(v / st.py) * st.py);
  h = hr(h);

  const x0 = cx - w / 2, z0 = cz - d / 2;
  const tiers = [];
  const shrink = (t, n) => {
    // returns smaller rect inside t, off-centre allowed, widths multiples of 3
    const ins = () => rr(rng, 3, 7);
    let a = ins(), b = ins(), c = ins(), e = ins();
    let nw = snap3(t.x1 - t.x0 - a - b), nd = snap3(t.z1 - t.z0 - c - e);
    if (nw < 9 || nd < 9) return null;
    let nx0 = t.x0 + a, nz0 = t.z0 + c;
    if (nx0 + nw > t.x1 - 2.5) nx0 = t.x1 - 2.5 - nw;
    if (nz0 + nd > t.z1 - 2.5) nz0 = t.z1 - 2.5 - nd;
    nx0 = Math.max(nx0, t.x0 + 2.5); nz0 = Math.max(nz0, t.z0 + 2.5);
    return { x0: nx0, z0: nz0, x1: nx0 + nw, z1: nz0 + nd };
  };
  const base = { x0, z0, x1: x0 + w, z1: z0 + d };
  let spire = false;
  if (kind === 'glass') {
    if (rng() < 0.55 && h > 50) {
      const hh = hr(h * rr(rng, 0.82, 0.92));
      tiers.push({ ...base, y0: 0, y1: hh });
      const t = shrink(base);
      if (t) tiers.push({ ...t, y0: hh, y1: h }); else tiers[0].y1 = h;
    } else tiers.push({ ...base, y0: 0, y1: h });
    spire = h > 120 && rng() < 0.5;
  } else if (kind === 'deco') {
    const fr = h > 130 ? [0.5, 0.78, 0.92, 1] : h > 75 ? [0.55, 0.85, 1] : [0.7, 1];
    let t = base, y0 = 0;
    for (let n = 0; n < fr.length; n++) {
      const y1 = n === fr.length - 1 ? h : hr(h * fr[n]);
      if (y1 <= y0) continue;
      tiers.push({ ...t, y0, y1 });
      y0 = y1;
      const nt = shrink(t);
      if (!nt) break;
      t = nt;
    }
    tiers[tiers.length - 1].y1 = Math.max(tiers[tiers.length - 1].y1, h);
    spire = h > 100 && rng() < 0.7;
  } else if (h > 40 && rng() < 0.4) {
    const hh = hr(h * 0.7);
    tiers.push({ ...base, y0: 0, y1: hh });
    const t = shrink(base);
    if (t) tiers.push({ ...t, y0: hh, y1: h }); else tiers[0].y1 = h;
  } else tiers.push({ ...base, y0: 0, y1: h });

  const k = 0.88 + rng() * 0.2;
  return {
    x: cx, z: cz, w, d, h: tiers[tiers.length - 1].y1, kind, style, tiers, spire,
    col: [k * (0.96 + rng() * 0.08), k * (0.96 + rng() * 0.08), k * (0.96 + rng() * 0.08)],
    uOff: Math.floor(rng() * 8) / 8, noProps: false,
  };
}

function emitBuilding(ctx, rng, s, idx) {
  const lite = !s.core;
  const st = STYLES[s.style];
  const id = `b${idx}`;
  s.tiers.forEach((t, n) => {
    emitTier(ctx, s.style, t.x0, t.y0, t.z0, t.x1, t.y1, t.z1, { col: s.col, uOff: s.uOff, id, type: 'building', cornice: s.kind !== 'glass' || true });
  });
  // storefront band
  const b0 = s.tiers[0];
  if (s.h > 9) {
    const sf = ctx.chunks.bucket(s.x, s.z, 'storefront');
    sf.walls(b0.x0 - 0.15, 0, b0.z0 - 0.15, b0.x1 + 0.15, 4.8, b0.z1 + 0.15, 24, 4.8, Math.floor(rng() * 6) / 6, WHITE);
  }
  if (ctx.detail && (s.style === 'brownstone' || s.style === 'redbrick') && s.h < 62 && ctx.rng2() < (lite ? 0.18 : 0.55)) fireEscape(ctx, ctx.rng2, s);
  if (s.noProps) return;
  const top = s.tiers[s.tiers.length - 1];
  const low = s.h < 90;
  // exposed roofs of every tier
  s.tiers.forEach((t, n) => {
    const nxt = s.tiers[n + 1];
    if (!nxt) return;
    // lower tier roofs: only props along the part not covered
    const rx0 = t.x0, rx1 = t.x1;
    // decorate the biggest free strip
    const sl = nxt.x0 - t.x0, sr = t.x1 - nxt.x1, sf2 = nxt.z0 - t.z0, sb = t.z1 - nxt.z1;
    const m = Math.max(sl, sr, sf2, sb);
    if (m < 7) return;
    if (m === sl) decorateRoof(ctx, rng, t.x0, t.z0, nxt.x0, t.z1, t.y1, { tanks: low, antenna: false, lite });
    else if (m === sr) decorateRoof(ctx, rng, nxt.x1, t.z0, t.x1, t.z1, t.y1, { tanks: low, antenna: false, lite });
    else if (m === sf2) decorateRoof(ctx, rng, t.x0, t.z0, t.x1, nxt.z0, t.y1, { tanks: low, antenna: false, lite });
    else decorateRoof(ctx, rng, t.x0, nxt.z1, t.x1, t.z1, t.y1, { tanks: low, antenna: false, lite });
  });
  decorateRoof(ctx, rng, top.x0, top.z0, top.x1, top.z1, top.y1, { tanks: low && s.kind !== 'glass', antenna: s.h > 60, lite });
  if (s.spire) {
    const cx = (top.x0 + top.x1) / 2, cz = (top.z0 + top.z1) / 2;
    const sw = Math.min(top.x1 - top.x0, top.z1 - top.z0);
    const a = Math.max(3, snap3(sw * 0.45)), bb = Math.max(2, a * 0.55);
    const pb = ctx.chunks.bucket(cx, cz, 'roof');
    const y = top.y1;
    pb.boxAll(cx - a / 2, y, cz - a / 2, cx + a / 2, y + 6, cz + a / 2, 4, [0.82, 0.78, 0.7]);
    pb.boxAll(cx - bb / 2, y + 6, cz - bb / 2, cx + bb / 2, y + 12, cz + bb / 2, 4, [0.82, 0.78, 0.7]);
    ctx.chunks.bucket(cx, cz, 'prop').boxAll(cx - 0.3, y + 12, cz - 0.3, cx + 0.3, y + 26, cz + 0.3, 1, [0.5, 0.5, 0.55]);
    ctx.glow.boxAll(cx - 0.45, y + 26, cz - 0.45, cx + 0.45, y + 27, cz + 0.45, 1, [5, 0.3, 0.2]);
    addBox(ctx, cx - a / 2, y, cz - a / 2, cx + a / 2, y + 6, cz + a / 2, 'roof', 'spire');
  }
  if (s.crane) buildCrane(ctx, rng, top);
}

function lotsFor(rng, cx, cz) {
  const X0 = cx - 35, X1 = cx + 35, Z0 = cz - 23, Z1 = cz + 23, gap = 3;
  const nx = pick(rng, [1, 2, 2, 3]), nz = nx === 3 ? 1 + ((rng() * 2) | 0) : pick(rng, [1, 2, 2]);
  const split = (a, b, n) => {
    const ws = Array.from({ length: n }, () => 0.7 + rng() * 0.6);
    const tot = ws.reduce((p, c) => p + c, 0);
    const avail = b - a - gap * (n - 1);
    const out = []; let p = a;
    for (let i = 0; i < n; i++) { const wdt = (ws[i] / tot) * avail; out.push([p, p + wdt]); p += wdt + gap; }
    return out;
  };
  const xs = split(X0, X1, nx), zs = split(Z0, Z1, nz);
  const lots = [];
  for (const [a, b] of xs) for (const [c, d] of zs) lots.push({ x0: a, x1: b, z0: c, z1: d });
  return lots;
}


/** Height + facade kind for the non-Midtown districts. `tower` forces a landmark-height building (swing anchors in low districts). */
function heightKind(rng, district, cx, cz, tower) {
  const r1 = rng(), r2 = rng(), r = rng();
  let h, kind;
  switch (district) {
    case 'fidi': { // dense supertall glass: the best swinging in the city
      const d = Math.hypot(cx - 100, cz - 950);
      const hm = 105 + 235 * Math.exp(-Math.pow(d / 560, 2));
      h = hm * (0.5 + 0.7 * Math.pow(r1, 1.1));
      if (r2 < 0.12) h *= 1.35;
      h = Math.max(54, Math.min(345, h));
      kind = h > 110 ? (r < 0.68 ? 'glass' : r < 0.9 ? 'deco' : 'plain') : (r < 0.45 ? 'glass' : r < 0.75 ? 'deco' : r < 0.9 ? 'plain' : 'brick');
      break;
    }
    case 'uws': case 'ues': { // mid-rise brownstones with the odd slab
      h = 17 + 46 * Math.pow(r1, 1.35);
      if (r2 < 0.1) h = 62 + 55 * r1;
      if (tower) h = 70 + 50 * r2;
      h = Math.min(130, h);
      kind = h > 55 ? (r < 0.4 ? 'deco' : r < 0.7 ? 'glass' : 'plain') : (r < 0.62 ? 'brick' : r < 0.8 ? 'plain' : 'deco');
      break;
    }
    case 'hells': { // warehouses, with the occasional tower
      h = 12 + 24 * Math.pow(r1, 1.2);
      if (r2 < 0.08) h = 46 + 32 * r1;
      if (tower) h = 66 + 44 * r2;
      kind = h > 50 ? (r < 0.5 ? 'glass' : 'plain') : (r < 0.55 ? 'plain' : 'brick');
      break;
    }
    default: { // brooklyn: low-rise rowhouses, a few towers
      h = 16 + 28 * Math.pow(r1, 1.2);
      if (r2 < 0.05) h = 44 + 24 * r1;
      if (tower) h = 58 + 40 * r2;
      kind = h > 40 ? (r < 0.5 ? 'plain' : 'brick') : (r < 0.88 ? 'brick' : 'plain');
    }
  }
  return { h, kind };
}

/** Lot subdivision for the non-Midtown districts. */
function lotsForD(rng, cx, cz, district) {
  if (district === 'fidi' || district === 'uws' || district === 'ues') return lotsFor(rng, cx, cz);
  const X0 = cx - 36, X1 = cx + 36, Z0 = cz - 24, Z1 = cz + 24, gap = 3;
  const nx = district === 'hells' ? pick(rng, [1, 1, 2]) : pick(rng, [3, 3, 4]);
  const ws = Array.from({ length: nx }, () => 0.75 + rng() * 0.5);
  const tot = ws.reduce((p, c) => p + c, 0), avail = X1 - X0 - gap * (nx - 1);
  const out = []; let p = X0;
  for (let i = 0; i < nx; i++) { const wdt = (ws[i] / tot) * avail; out.push({ x0: p, x1: p + wdt, z0: Z0, z1: Z1 }); p += wdt + gap; }
  return out;
}

/** Tower crane standing on a roof (mast + jib are physical, so they are swing anchors in the low districts). */
function buildCrane(ctx, rng, top) {
  const cx = (top.x0 + top.x1) / 2 + rr(rng, -4, 4), cz = (top.z0 + top.z1) / 2 + rr(rng, -3, 3), y = top.y1;
  const H = rr(rng, 44, 62), ax = rng() < 0.5, sgn = rng() < 0.5 ? 1 : -1, len = rr(rng, 30, 42);
  const Y = [0.9, 0.68, 0.1], G = [0.35, 0.36, 0.38];
  const pb = ctx.chunks.bucket(cx, cz, 'prop');
  pb.boxAll(cx - 1.2, y, cz - 1.2, cx + 1.2, y + H, cz + 1.2, 3, Y);
  addBox(ctx, cx - 1.2, y, cz - 1.2, cx + 1.2, y + H, cz + 1.2, 'roof', 'crane_mast');
  const jx0 = ax ? cx - (sgn > 0 ? 12 : len) : cx - 0.9, jx1 = ax ? cx + (sgn > 0 ? len : 12) : cx + 0.9;
  const jz0 = ax ? cz - 0.9 : cz - (sgn > 0 ? 12 : len), jz1 = ax ? cz + 0.9 : cz + (sgn > 0 ? len : 12);
  pb.boxAll(jx0, y + H, jz0, jx1, y + H + 1.8, jz1, 3, Y);
  addBox(ctx, jx0, y + H, jz0, jx1, y + H + 1.8, jz1, 'roof', 'crane_jib');
  pb.boxAll(cx - 1.6, y + H + 1.8, cz - 1.6, cx + 1.6, y + H + 6, cz + 1.6, 3, Y);
  const bx = ax ? (sgn > 0 ? jx0 : jx1 - 4) : cx - 1.7, bz = ax ? cz - 1.7 : (sgn > 0 ? jz0 : jz1 - 4);
  pb.boxAll(bx, y + H - 3, bz, bx + (ax ? 4 : 3.4), y + H, bz + (ax ? 3.4 : 4), 3, G);
  ctx.glow.boxAll(cx - 0.4, y + H + 6, cz - 0.4, cx + 0.4, y + H + 7.4, cz + 0.4, 1, [5, 0.3, 0.2]);
  farBox(ctx, cx - 1.2, y, cz - 1.2, cx + 1.2, y + H + 6, cz + 1.2, [0.9, 0.68, 0.3]);
}


/** Main city generation. Returns { specs, spawn, buildings }. Midtown is generated first with the original random streams so its layout never moves. */
export function buildCity(ctx) {
  const { rng } = ctx;
  ctx.rngN = mulberry32(424242); ctx.rng2N = mulberry32(9931);
  const specs = [];
  for (const b of BLOCKS) {
    if (isPark(b.i, b.j) || isReserved(b.i, b.j)) continue;
    const r = b.core ? rng : ctx.rngN;
    const lots = b.core ? lotsFor(rng, b.cx, b.cz) : lotsForD(r, b.cx, b.cz, b.district);
    const tm = b.district === 'brooklyn' ? 2 : 3;
    const tower = !b.core && b.district !== 'fidi' && (((b.i * 7 + b.j * 13) % tm) + tm) % tm === 0;
    lots.forEach((lot, n) => {
      const s = planBuilding(r, lot, b.district, tower && n === 0);
      if (!s) return;
      s.core = b.core; s.district = b.district;
      // cranes: warehouses in Hell's Kitchen give the low east side swing anchors
      s.crane = b.district === 'hells' && !b.core && n === 0 && ((b.i * 5 + b.j * 3) % 5 + 5) % 5 === 1 && s.h < 40 && s.w >= 30;
      specs.push(s);
    });
  }
  const coreSpecs = specs.filter((s) => s.core);

  // reserve a mid-height building near the centre of town for the spawn
  let best = null, bd = 1e9;
  for (const s of coreSpecs) {
    if (s.h < 55 || s.h > 120 || s.w < 21 || s.d < 21) continue;
    let taller = 0;
    for (const o of coreSpecs) if (o !== s && Math.abs(o.x - s.x) < 70 && Math.abs(o.z - s.z) < 60 && o.h > s.h + 6) taller++;
    const dd = Math.hypot(s.x - 40, s.z + 120) + taller * 90;
    if (dd < bd) { bd = dd; best = s; }
  }
  if (!best) best = specs[0];
  best.noProps = true;
  best.spire = false;
  const top = best.tiers[best.tiers.length - 1];
  const target = ctx.avengersPos;
  const spawn = {
    pos: new THREE.Vector3((top.x0 + top.x1) / 2, top.y1 + 0.05, (top.z0 + top.z1) / 2),
    yaw: Math.atan2(target.x - (top.x0 + top.x1) / 2, target.z - (top.z0 + top.z1) / 2),
  };

  const detail0 = ctx.detail, rng2 = ctx.rng2;
  specs.forEach((s, idx) => {
    if (s.core) emitBuilding(ctx, rng, s, idx);
    else {
      // outer districts: own random streams, cheaper roofs (cornices only on the Financial District supertalls)
      ctx.rng2 = ctx.rng2N; ctx.detail = detail0 && s.district === 'fidi';
      emitBuilding(ctx, ctx.rngN, s, idx);
      ctx.rng2 = rng2; ctx.detail = detail0;
    }
  });

  // weapon shops (street-level facade spots), then sidewalks, park, lamps, trees
  const shops = planShops(ctx, coreSpecs, spawn);
  ctx.shops = shops;
  ctx.shopMats = buildShops(ctx, shops, ctx.group, ctx.quality);
  for (const b of BLOCKS) buildBlockBase(ctx, b.core ? rng : ctx.rngN, b);
  buildPromenade(ctx);
  buildMarkings(ctx);
  buildRoadDetail(ctx);
  // street-level detail (own rng stream so the base layout never shifts)
  buildLamps(ctx, ctx.group, ctx.quality);
  ctx.trafficLights = globalThis.__NOTL ? null : new TrafficLights(ctx, ctx.group, ctx.quality);
  buildStreetProps(ctx, shops, ctx.quality);
  ctx.signs = buildSigns(ctx, specs, ctx.group, ctx.quality);

  const buildings = specs.map((s) => ({
    x: +s.x.toFixed(1), z: +s.z.toFixed(1), w: +s.w.toFixed(1), d: +s.d.toFixed(1), h: Math.round(s.h),
  }));
  return { specs, spawn, buildings };
}

function buildBlockBase(ctx, rng, blk) {
  const { i, j, cx, cz } = blk;
  const x0 = cx - L.BW / 2, x1 = cx + L.BW / 2, z0 = cz - L.BD / 2, z1 = cz + L.BD / 2;
  const sw = ctx.chunks.bucket(cx, cz, 'sidewalk');
  const park = parkOf(i, j);
  if (park) {
    sw.walls(x0, 0, z0, x1, 0.15, z1, 6, 6, 0, [0.9, 0.9, 0.9]);
    ctx.chunks.bucket(cx, cz, 'grass').top(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, 0.15, 7, WHITE);
    // paths
    const pc = [0.9, 0.86, 0.78];
    sw.top(cx - 2, z0 + 0.5, cx + 2, z1 - 0.5, 0.17, 6, pc);
    sw.top(x0 + 0.5, cz - 2, x1 - 0.5, cz + 2, 0.17, 6, pc);
    const pond = park.pond && park.pond[0] === i && park.pond[1] === j;
    if (pond) ctx.chunks.bucket(cx, cz, 'pond').top(cx - 24, cz - 15, cx - 4, cz + 15, 0.19, 8, [0.5, 0.75, 0.85]);
    const nTrees = ctx.quality === 'low' ? 8 : ctx.quality === 'medium' ? 18 : 30;
    for (let n = 0; n < nTrees; n++) {
      const tx = rr(rng, x0 + 4, x1 - 4), tz = rr(rng, z0 + 4, z1 - 4);
      if (Math.abs(tx - cx) < 4 || Math.abs(tz - cz) < 4) continue;
      if (pond && tx > cx - 28 && tx < cx && tz > cz - 18 && tz < cz + 18) continue;
      ctx.trees.push([tx, tz, rr(rng, 1.0, 1.9), rng(), 1]);
    }
  } else {
    sw.boxAll(x0, 0, z0, x1, 0.15, z1, 6, WHITE);
  }
  // lighter curb lip along the road edge
  if (ctx.detail && (blk.core || blk.district === 'fidi')) {
    const lip = [1.25, 1.24, 1.2], t = 0.32;
    sw.top(x0, z0, x1, z0 + t, 0.165, 6, lip); sw.top(x0, z1 - t, x1, z1, 0.165, 6, lip);
    sw.top(x0, z0 + t, x0 + t, z1 - t, 0.165, 6, lip); sw.top(x1 - t, z0 + t, x1, z1 - t, 0.165, 6, lip);
  }
  // far LOD: flat sidewalk slab (+ lawn) so the block pattern still reads from the air
  if (ctx.far) {
    const fb = ctx.far.bucket(cx, cz, 'far');
    fb.topC(x0, z0, x1, z1, 0.15, FAR_UV, FAR_UV, park ? [0.28, 0.4, 0.2] : [0.5, 0.5, 0.49]);
  }
  // street trees along avenue-facing sidewalks (denser in Midtown)
  const step = blk.core ? (ctx.quality === 'high' ? 14 : ctx.quality === 'medium' ? 24 : 0) : (ctx.quality === 'low' ? 0 : 26);
  if (step && !park) for (const sx of [x0 + 2, x1 - 2]) for (let z = z0 + 6; z < z1 - 3; z += step) ctx.trees.push([sx, z + rr(rng, -2, 2), rr(rng, 0.7, 1.1), rng()]);
  // lamps at block corners (Midtown: all four, or the checkerboard at low quality; elsewhere one diagonal pair per block)
  if (blk.core) {
    if (ctx.quality !== 'low' || (i + j) % 2 === 0) {
      for (const [lx, lz, dx, dz] of [[x0 + 1.2, z0 + 1.2, -1, -1], [x1 - 1.2, z0 + 1.2, 1, -1], [x0 + 1.2, z1 - 1.2, -1, 1], [x1 - 1.2, z1 - 1.2, 1, 1]]) ctx.lamps.push([lx, lz, dx, dz, true]);
    }
  } else {
    ctx.lamps.push([x0 + 1.2, z0 + 1.2, -1, -1, false], [x1 - 1.2, z1 - 1.2, 1, 1, false]);
  }
}

function buildPromenade(ctx) {
  // waterfront promenades + quay walls along both banks of the river (Manhattan and Brooklyn)
  const x0 = L.RIVER_X, x1 = avenueX(0) - L.AVE_W / 2;
  const bx1 = L.FAR_X, bx0 = colX(-7) + L.BW / 2;
  for (let z = L.MINZ - 20; z < L.MAXZ + 20; z += 400) {
    const sw = ctx.chunks.bucket((x0 + x1) / 2, z + 200, 'sidewalk');
    sw.top(x0, z, x1, z + 400, 0.15, 6, WHITE);
    sw.walls(x0 - 6, -4, z, x0, 0.15, z + 400, 6, 6, 0, [0.7, 0.7, 0.72]);
    sw.top(x0 - 6, z, x0, z + 400, 0.15, 6, WHITE);
    const sb = ctx.chunks.bucket((bx0 + bx1) / 2, z + 200, 'sidewalk');
    sb.top(bx0 - 2, z, bx1, z + 400, 0.15, 6, WHITE);
    sb.walls(bx1, -4, z, bx1 + 6, 0.15, z + 400, 6, 6, 0, [0.7, 0.7, 0.72]);
    sb.top(bx1, z, bx1 + 6, z + 400, 0.15, 6, WHITE);
  }
  // low quay wall / railing: solid so nobody walks into the water by accident (gaps where bridge 2 touches down)
  const gaps = ctx.quayGaps || [];
  const wall = (xa, xb, side) => {
    let z = L.MINZ - 24;
    const end = L.MAXZ + 24;
    const cuts = gaps.map((g) => [g - 9, g + 9]).sort((a, b) => a[0] - b[0]);
    const segs = [];
    for (const [a, b] of cuts) { segs.push([z, a]); z = b; }
    segs.push([z, end]);
    for (const [za, zb] of segs) {
      ctx.chunks.bucket(xa, (za + zb) / 2, 'prop').boxAll(xa, 0.15, za, xb, 1.15, zb, 2, [0.5, 0.5, 0.52]);
      addBox(ctx, xa, 0, za, xb, 1.15, zb, 'prop', 'quay');
    }
  };
  wall(x0 + 0.1, x0 + 0.7, 1);
  wall(bx1 - 0.7, bx1 - 0.1, -1);
}

const YEL = [0.95, 0.72, 0.12], WHT = [0.9, 0.9, 0.86];
const islandOf = (a) => (a >= 0 ? [0, 18] : [-9, -7]);
function buildMarkings(ctx) {
  const Y = 0.035;
  const mk = (x, z, name = 'markings') => ctx.chunks.bucket(x, z, name);
  const [S0, S1] = ST_RANGE;
  for (const a of AVES) {
    const ax = avenueX(a);
    for (let s = S0; s < S1; s++) {
      const za = streetZ(s) + 8, zb = streetZ(s + 1) - 8;
      const b = mk(ax, (za + zb) / 2);
      b.top(ax - 0.35, za, ax - 0.15, zb, Y, 4, YEL); b.top(ax + 0.15, za, ax + 0.35, zb, Y, 4, YEL);
      for (const off of [-5.5, 5.5]) for (let z = za + 2; z < zb - 3; z += 8) b.top(ax + off - 0.1, z, ax + off + 0.1, z + 3, Y, 4, WHT);
    }
  }
  for (const s of STREETS) {
    const zs = streetZ(s);
    for (const [a0, a1] of [[-9, -7], [0, 18]]) {
      for (let a = a0; a < a1; a++) {
        const xa = avenueX(a) + 11, xb = avenueX(a + 1) - 11;
        const b = mk((xa + xb) / 2, zs);
        b.top(xa, zs - 0.35, xb, zs - 0.15, Y, 4, YEL); b.top(xa, zs + 0.15, xb, zs + 0.35, Y, 4, YEL);
      }
    }
    // crosswalks
    for (const a of AVES) {
      const ax = avenueX(a);
      const b = mk(ax, zs);
      const step = a >= 0 && a <= 10 && s >= 0 && s <= 17 ? 2.2 : 3.3; // Midtown keeps the dense zebra
      for (const sgn of [-1, 1]) {
        const zc = zs + sgn * 9.6;
        if (zc < L.MINZ || zc > L.MAXZ) continue;
        for (let x = ax - 9.9; x <= ax + 9.9; x += step) b.top(x - 0.45, zc - 1.5, x + 0.45, zc + 1.5, Y, 4, WHT);
      }
      const [first, last] = islandOf(a);
      for (const sgn of [-1, 1]) {
        if ((a === first && sgn < 0) || (a === last && sgn > 0)) continue;
        const xc = ax + sgn * 12.6;
        for (let z = zs - 7; z <= zs + 7; z += step) b.top(xc - 1.5, z - 0.45, xc + 1.5, z + 0.45, Y, 4, WHT);
      }
    }
  }
}

function buildRoadDetail(ctx) {
  const rng = ctx.rng2N, Y = 0.036;
  const mk = (x, z) => ctx.chunks.bucket(x, z, 'markings');
  const HOLE = [0.07, 0.07, 0.08], RING = [0.2, 0.2, 0.21], WHT2 = [0.88, 0.88, 0.84];
  // stop lines before every crosswalk
  for (const s of STREETS) {
    const zs = streetZ(s);
    for (const a of AVES) {
      const ax = avenueX(a), b = mk(ax, zs), [first, last] = islandOf(a);
      b.top(ax - 10.6, zs - 12.5, ax - 0.7, zs - 11.9, Y, 4, WHT2);   // +z traffic (west half)
      b.top(ax + 0.7, zs + 11.9, ax + 10.6, zs + 12.5, Y, 4, WHT2);  // -z traffic (east half)
      if (a > first) b.top(ax - 15.5, zs + 0.7, ax - 14.9, zs + 7.4, Y, 4, WHT2);   // +x traffic
      if (a < last) b.top(ax + 14.9, zs - 7.4, ax + 15.5, zs - 0.7, Y, 4, WHT2);  // -x traffic
    }
  }
  // manhole covers and utility plates
  const nMan = ctx.quality === 'low' ? 140 : 600;
  for (let i = 0; i < nMan; i++) {
    let x, z;
    if (rng() < 0.6) { x = avenueX(AVES[(rng() * AVES.length) | 0]) + (rng() < 0.5 ? -1 : 1) * (2.75 + (rng() < 0.5 ? 0 : 5.5)) + (rng() - 0.5) * 1.5; z = L.MINZ + 20 + rng() * (L.MAXZ - L.MINZ - 40); }
    else {
      z = streetZ(ST_RANGE[0] + ((rng() * (ST_RANGE[1] - ST_RANGE[0] + 1)) | 0)) + (rng() < 0.5 ? -4 : 4) + (rng() - 0.5);
      x = rng() < 0.85 ? L.RIVER_X + 40 + rng() * (L.MAXX - L.RIVER_X - 80) : avenueX(-9) + 20 + rng() * 160;
    }
    // keep them out of the intersections
    const inA = Math.abs(((x + 400) % 100 + 100) % 100 - 50) > 39, inS = Math.abs(((z + 595) % 70 + 70) % 70 - 35) > 27;
    if (inA && inS) continue;
    const b = mk(x, z);
    b.disc(x, z, 0.62, Y + 0.002, 10, RING); b.disc(x, z, 0.5, Y + 0.004, 10, HOLE);
    b.top(x - 0.4, z - 0.04, x + 0.4, z + 0.04, Y + 0.006, 4, RING); b.top(x - 0.04, z - 0.4, x + 0.04, z + 0.4, Y + 0.006, 4, RING);
  }
}

/** Cheap skyline filler outside the playable area: far-LOD boxes only (one draw call per tile), no physics. */
export function buildBackdrop(ctx) {
  const rng = ctx.rngN || mulberry32(1717);
  const X0 = L.MINX - 30, X1 = L.MAXX + 30, Z0 = L.MINZ - 30, Z1 = L.MAXZ + 30;
  const SX = 110, SZ = 80;
  for (let x = -2500; x <= 2500; x += SX) for (let z = -2740; z <= 2740; z += SZ) {
    if (x > X0 && x < X1 && z > Z0 && z < Z1) continue;
    if (rng() < 0.2) continue;
    const dist = Math.hypot(x - 60, z - 0);
    const nb = 1 + ((rng() * 2) | 0);
    for (let n = 0; n < nb; n++) {
      const w = snap3(rr(rng, 18, 38)), d = snap3(rr(rng, 18, 32));
      const bx = x + (nb === 1 ? 0 : (n ? 1 : -1) * 20) + rr(rng, -4, 4), bz = z + rr(rng, -8, 8);
      if (bx + w / 2 > X0 && bx - w / 2 < X1 && bz + d / 2 > Z0 && bz - d / 2 < Z1) continue;
      let h = (14 + 200 * Math.pow(rng(), 2.2)) * (0.45 + 0.55 * Math.exp(-Math.pow(dist / 2200, 2)));
      if (x < L.MINX - 60) h *= 0.6;
      h = Math.max(12, Math.round(h / 3.6) * 3.6);
      const style = h > 70 ? pick(rng, ['glassBlue', 'glassBlue', 'limestone', 'concrete']) : pick(rng, ['brownstone', 'concrete', 'limestone', 'redbrick']);
      const k = 0.85 + rng() * 0.2;
      farBox(ctx, bx - w / 2, 0, bz - d / 2, bx + w / 2, h, bz + d / 2, FAR_TINT[style], [k, k, k]);
    }
  }
}

export { rr, pick, snap3, decorateRoof };
