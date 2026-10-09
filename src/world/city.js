// Procedural Manhattan-style grid: blocks, lots, buildings, roof props, streets, park.
import * as THREE from 'three';
import { Bucket, WHITE } from './geo.js';
import { STYLES } from './materials.js';
import { planShops, buildShops } from './shops.js';
import { buildLamps, buildStreetProps, buildSigns, fireEscape, roofExtras, TrafficLights } from './props.js';

export const L = {
  PX: 100, PZ: 70, BW: 78, BD: 54, COLS: 10, ROWS: 17,
  X0: -350, Z0: -560, RIVER_X: -440, AVE_W: 22, ST_W: 16,
  MINX: -600, MAXX: 600, MINZ: -600, MAXZ: 600,
  CENTER: new THREE.Vector3(100, 0, -175),
};
export const colX = (i) => L.X0 + L.PX * i;
export const rowZ = (j) => L.Z0 + L.PZ * j;
export const avenueX = (k) => -400 + 100 * k; // k = 0..10
export const streetZ = (k) => -595 + 70 * k; // k = 0..17

export const PARK = { i0: 4, i1: 5, j0: 6, j1: 10 };
export const AV_CELL = { i: 3, j: 4 };
export const ESB_CELL = { i: 6, j: 7 };
export const isPark = (i, j) => i >= PARK.i0 && i <= PARK.i1 && j >= PARK.j0 && j <= PARK.j1;
const isReserved = (i, j) => (i === AV_CELL.i && j === AV_CELL.j) || (i === ESB_CELL.i && j === ESB_CELL.j);

const STONE = [0.78, 0.72, 0.62];
const ROOFC = [0.85, 0.85, 0.85];
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
const rr = (rng, a, b) => a + (b - a) * rng();

export function addBox(ctx, x0, y0, z0, x1, y1, z1, type, id) {
  ctx.physics.addBox(_a.set(x0, y0, z0), _b.set(x1, y1, z1), { type, id, height: y1 });
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
  if (o.tanks && rng() < 0.55) {
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
  const nAC = Math.min(5, 1 + ((rng() * (1 + (w * d) / 160)) | 0));
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
  roofExtras(ctx, ctx.rng2, x0, z0, x1, z1, y, !!o.antenna);
}

function snap3(v) { return Math.floor(v / 3) * 3; }

/** Decide everything about a building before emission (so the spawn building can be reserved). */
function planBuilding(rng, lot) {
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  let w = snap3(lot.x1 - lot.x0), d = snap3(lot.z1 - lot.z0);
  if (w < 9 || d < 9) return null;
  const dist = Math.hypot(cx - L.CENTER.x, cz - L.CENTER.z);
  const hmid = 24 + 235 * Math.exp(-Math.pow(dist / 340, 2));
  let h = hmid * (0.3 + 0.85 * Math.pow(rng(), 1.2));
  if (rng() < 0.06) h *= 1.4;
  h = Math.max(14, Math.min(205, h));

  let style, kind;
  const r = rng();
  if (h > 110) { kind = r < 0.6 ? 'glass' : r < 0.9 ? 'deco' : 'plain'; }
  else if (h > 45) { kind = r < 0.3 ? 'glass' : r < 0.6 ? 'deco' : r < 0.85 ? 'brick' : 'plain'; }
  else { kind = r < 0.6 ? 'brick' : r < 0.8 ? 'plain' : 'deco'; }
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
  if (ctx.detail && (s.style === 'brownstone' || s.style === 'redbrick') && s.h < 62 && ctx.rng2() < 0.55) fireEscape(ctx, ctx.rng2, s);
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
    if (m === sl) decorateRoof(ctx, rng, t.x0, t.z0, nxt.x0, t.z1, t.y1, { tanks: low, antenna: false });
    else if (m === sr) decorateRoof(ctx, rng, nxt.x1, t.z0, t.x1, t.z1, t.y1, { tanks: low, antenna: false });
    else if (m === sf2) decorateRoof(ctx, rng, t.x0, t.z0, t.x1, nxt.z0, t.y1, { tanks: low, antenna: false });
    else decorateRoof(ctx, rng, t.x0, nxt.z1, t.x1, t.z1, t.y1, { tanks: low, antenna: false });
  });
  decorateRoof(ctx, rng, top.x0, top.z0, top.x1, top.z1, top.y1, { tanks: low && s.kind !== 'glass', antenna: s.h > 60 });
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

/** Main city generation. Returns { specs, spawn, markings... } */
export function buildCity(ctx) {
  const { rng } = ctx;
  const specs = [];
  const cells = [];
  for (let i = 0; i < L.COLS; i++) for (let j = 0; j < L.ROWS; j++) {
    if (isPark(i, j) || isReserved(i, j)) continue;
    cells.push([i, j]);
  }
  for (const [i, j] of cells) {
    for (const lot of lotsFor(rng, colX(i), rowZ(j))) {
      const s = planBuilding(rng, lot);
      if (s) specs.push(s);
    }
  }

  // reserve a mid-height building near the centre of town for the spawn
  let best = null, bd = 1e9;
  for (const s of specs) {
    if (s.h < 55 || s.h > 120 || s.w < 21 || s.d < 21) continue;
    let taller = 0;
    for (const o of specs) if (o !== s && Math.abs(o.x - s.x) < 70 && Math.abs(o.z - s.z) < 60 && o.h > s.h + 6) taller++;
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

  specs.forEach((s, idx) => emitBuilding(ctx, rng, s, idx));

  // weapon shops (street-level facade spots), then sidewalks, park, lamps, trees
  const shops = planShops(ctx, specs, spawn);
  ctx.shops = shops;
  ctx.shopMats = buildShops(ctx, shops, ctx.group, ctx.quality);
  for (let i = 0; i < L.COLS; i++) for (let j = 0; j < L.ROWS; j++) buildBlockBase(ctx, rng, i, j);
  buildPromenade(ctx);
  buildMarkings(ctx);
  buildRoadDetail(ctx);
  // street-level detail (own rng stream so the base layout never shifts)
  buildLamps(ctx, ctx.group, ctx.quality);
  ctx.trafficLights = new TrafficLights(ctx, ctx.group, ctx.quality);
  buildStreetProps(ctx, shops, ctx.quality);
  ctx.signs = buildSigns(ctx, specs, ctx.group, ctx.quality);

  const buildings = specs.map((s) => ({
    x: +s.x.toFixed(1), z: +s.z.toFixed(1), w: +s.w.toFixed(1), d: +s.d.toFixed(1), h: Math.round(s.h),
  }));
  return { specs, spawn, buildings };
}

function buildBlockBase(ctx, rng, i, j) {
  const cx = colX(i), cz = rowZ(j);
  const x0 = cx - L.BW / 2, x1 = cx + L.BW / 2, z0 = cz - L.BD / 2, z1 = cz + L.BD / 2;
  const sw = ctx.chunks.bucket(cx, cz, 'sidewalk');
  const park = isPark(i, j);
  if (park) {
    sw.walls(x0, 0, z0, x1, 0.15, z1, 6, 6, 0, [0.9, 0.9, 0.9]);
    ctx.chunks.bucket(cx, cz, 'grass').top(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, 0.15, 7, WHITE);
    // paths
    const pc = [0.9, 0.86, 0.78];
    sw.top(cx - 2, z0 + 0.5, cx + 2, z1 - 0.5, 0.17, 6, pc);
    sw.top(x0 + 0.5, cz - 2, x1 - 0.5, cz + 2, 0.17, 6, pc);
    if (i === 4 && j === 8) ctx.chunks.bucket(cx, cz, 'pond').top(cx - 24, cz - 15, cx - 4, cz + 15, 0.19, 8, [0.5, 0.75, 0.85]);
    const nTrees = ctx.quality === 'low' ? 8 : ctx.quality === 'medium' ? 18 : 30;
    for (let n = 0; n < nTrees; n++) {
      const tx = rr(rng, x0 + 4, x1 - 4), tz = rr(rng, z0 + 4, z1 - 4);
      if (Math.abs(tx - cx) < 4 || Math.abs(tz - cz) < 4) continue;
      if (i === 4 && j === 8 && tx > cx - 28 && tx < cx && tz > cz - 18 && tz < cz + 18) continue;
      ctx.trees.push([tx, tz, rr(rng, 1.0, 1.9), rng(), 1]);
    }
  } else {
    sw.boxAll(x0, 0, z0, x1, 0.15, z1, 6, WHITE);
  }
  // lighter curb lip along the road edge
  if (ctx.detail) {
    const lip = [1.25, 1.24, 1.2], t = 0.32;
    sw.top(x0, z0, x1, z0 + t, 0.165, 6, lip); sw.top(x0, z1 - t, x1, z1, 0.165, 6, lip);
    sw.top(x0, z0 + t, x0 + t, z1 - t, 0.165, 6, lip); sw.top(x1 - t, z0 + t, x1, z1 - t, 0.165, 6, lip);
  }
  // street trees along avenue-facing sidewalks
  const step = ctx.quality === 'high' ? 14 : ctx.quality === 'medium' ? 24 : 0;
  if (step && !park) for (const sx of [x0 + 2, x1 - 2]) for (let z = z0 + 6; z < z1 - 3; z += step) ctx.trees.push([sx, z + rr(rng, -2, 2), rr(rng, 0.7, 1.1), rng()]);
  // lamps at block corners
  if (ctx.quality !== 'low' || (i + j) % 2 === 0) {
    for (const [lx, lz, dx, dz] of [[x0 + 1.2, z0 + 1.2, -1, -1], [x1 - 1.2, z0 + 1.2, 1, -1], [x0 + 1.2, z1 - 1.2, -1, 1], [x1 - 1.2, z1 - 1.2, 1, 1]]) ctx.lamps.push([lx, lz, dx, dz]);
  }
}

function buildPromenade(ctx) {
  // waterfront promenade + quay wall along the river (west edge of the city)
  const x0 = L.RIVER_X, x1 = avenueX(0) - L.AVE_W / 2;
  for (let z = -600; z < 600; z += 300) {
    const sw = ctx.chunks.bucket((x0 + x1) / 2, z + 150, 'sidewalk');
    sw.top(x0, z, x1, z + 300, 0.15, 6, WHITE);
    sw.walls(x0 - 6, -4, z, x0, 0.15, z + 300, 6, 6, 0, [0.7, 0.7, 0.72]);
    sw.top(x0 - 6, z, x0, z + 300, 0.15, 6, WHITE);
  }
  // low quay wall / railing: solid so nobody walks into the water by accident
  const wb = ctx.chunks.bucket(x0, 0, 'prop');
  wb.boxAll(x0 + 0.1, 0.15, -604, x0 + 0.7, 1.15, 604, 2, [0.5, 0.5, 0.52]);
  addBox(ctx, x0 + 0.1, 0, -604, x0 + 0.7, 1.15, 604, 'prop', 'quay');
}

const YEL = [0.95, 0.72, 0.12], WHT = [0.9, 0.9, 0.86];
function buildMarkings(ctx) {
  const Y = 0.035;
  const mk = (x, z, name = 'markings') => ctx.chunks.bucket(x, z, name);
  const NS = 18, NA = 11;
  for (let a = 0; a < NA; a++) {
    const ax = avenueX(a);
    for (let s = -1; s < NS; s++) {
      const za = s < 0 ? -603 : streetZ(s) + 8, zb = s + 1 >= NS ? 603 : streetZ(s + 1) - 8;
      if (s < 0 || s + 1 >= NS) continue;
      const b = mk(ax, (za + zb) / 2);
      b.top(ax - 0.35, za, ax - 0.15, zb, Y, 4, YEL); b.top(ax + 0.15, za, ax + 0.35, zb, Y, 4, YEL);
      for (const off of [-5.5, 5.5]) for (let z = za + 2; z < zb - 3; z += 8) b.top(ax + off - 0.1, z, ax + off + 0.1, z + 3, Y, 4, WHT);
    }
  }
  for (let s = 0; s < NS; s++) {
    const zs = streetZ(s);
    for (let a = 0; a < NA - 1; a++) {
      const xa = avenueX(a) + 11, xb = avenueX(a + 1) - 11;
      const b = mk((xa + xb) / 2, zs);
      b.top(xa, zs - 0.35, xb, zs - 0.15, Y, 4, YEL); b.top(xa, zs + 0.15, xb, zs + 0.35, Y, 4, YEL);
    }
    // waterfront stub already covered by promenade; east end beyond the last avenue not needed
    // crosswalks
    for (let a = 0; a < NA; a++) {
      const ax = avenueX(a);
      const b = mk(ax, zs);
      for (const sgn of [-1, 1]) {
        const zc = zs + sgn * 9.6;
        if (zc < -600 || zc > 600) continue;
        for (let x = ax - 9.9; x <= ax + 9.9; x += 2.2) b.top(x - 0.45, zc - 1.5, x + 0.45, zc + 1.5, Y, 4, WHT);
      }
      for (const sgn of [-1, 1]) {
        if (a === 0 && sgn < 0) continue;
        const xc = ax + sgn * 12.6;
        for (let z = zs - 7; z <= zs + 7; z += 2.2) b.top(xc - 1.5, z - 0.45, xc + 1.5, z + 0.45, Y, 4, WHT);
      }
    }
  }
}

function buildRoadDetail(ctx) {
  const rng = ctx.rng2, Y = 0.036;
  const mk = (x, z) => ctx.chunks.bucket(x, z, 'markings');
  const HOLE = [0.07, 0.07, 0.08], RING = [0.2, 0.2, 0.21], WHT2 = [0.88, 0.88, 0.84];
  // stop lines before every crosswalk
  for (let s = 0; s < 18; s++) {
    const zs = streetZ(s);
    for (let a = 0; a < 11; a++) {
      const ax = avenueX(a), b = mk(ax, zs);
      b.top(ax - 10.6, zs - 12.5, ax - 0.7, zs - 11.9, Y, 4, WHT2);   // +z traffic (west half)
      b.top(ax + 0.7, zs + 11.9, ax + 10.6, zs + 12.5, Y, 4, WHT2);  // -z traffic (east half)
      if (a > 0) b.top(ax - 15.5, zs + 0.7, ax - 14.9, zs + 7.4, Y, 4, WHT2);   // +x traffic
      if (a < 10) b.top(ax + 14.9, zs - 7.4, ax + 15.5, zs - 0.7, Y, 4, WHT2);  // -x traffic
    }
  }
  // manhole covers and utility plates
  const nMan = ctx.quality === 'low' ? 60 : 260;
  for (let i = 0; i < nMan; i++) {
    let x, z;
    if (rng() < 0.6) { x = avenueX((rng() * 11) | 0) + (rng() < 0.5 ? -1 : 1) * (2.75 + (rng() < 0.5 ? 0 : 5.5)) + (rng() - 0.5) * 1.5; z = L.MINZ + 20 + rng() * (L.MAXZ - L.MINZ - 40); }
    else { z = streetZ((rng() * 18) | 0) + (rng() < 0.5 ? -4 : 4) + (rng() - 0.5); x = L.RIVER_X + 40 + rng() * (L.MAXX - L.RIVER_X - 80); }
    // keep them out of the intersections
    const inA = Math.abs(((x + 400) % 100 + 100) % 100 - 50) > 39, inS = Math.abs(((z + 595) % 70 + 70) % 70 - 35) > 27;
    if (inA && inS) continue;
    const b = mk(x, z);
    b.disc(x, z, 0.62, Y + 0.002, 10, RING); b.disc(x, z, 0.5, Y + 0.004, 10, HOLE);
    b.top(x - 0.4, z - 0.04, x + 0.4, z + 0.04, Y + 0.006, 4, RING); b.top(x - 0.04, z - 0.4, x + 0.04, z + 0.4, Y + 0.006, 4, RING);
  }
}

/** Cheap skyline filler outside the playable area. No physics, no props. */
export function buildBackdrop(ctx) {
  const { rng } = ctx;
  const cells = [];
  for (let i = -13; i <= 15; i++) for (let j = -10; j <= 26; j++) {
    const inMain = i >= 0 && i < L.COLS && j >= 0 && j < L.ROWS;
    if (inMain) continue;
    const x = colX(i), z = rowZ(j);
    if (x > -360 && x < 1500 && Math.abs(z) < 1500) cells.push([x, z]);
    else if (x < -1000 && x > -1600 && Math.abs(z) < 1500) cells.push([x, z]);
  }
  for (const [cx, cz] of cells) {
    if (rng() < 0.18) continue;
    const dist = Math.hypot(cx - 60, cz + 100);
    const nb = 1 + ((rng() * 2) | 0);
    for (let n = 0; n < nb; n++) {
      const w = snap3(rr(rng, 18, 34)), d = snap3(rr(rng, 18, 30));
      const bx = cx + (nb === 1 ? 0 : (n ? 1 : -1) * 18) + rr(rng, -4, 4), bz = cz + rr(rng, -8, 8);
      let h = (14 + 200 * Math.pow(rng(), 2.2)) * (0.45 + 0.55 * Math.exp(-Math.pow(dist / 1300, 2)));
      if (cx < -1000) h *= 0.55;
      const r = rng();
      const style = h > 70 ? pick(rng, ['glassBlue', 'glassBlue', 'limestone', 'concrete']) : pick(rng, ['brownstone', 'concrete', 'limestone']);
      const st = STYLES[style];
      h = Math.max(st.py * 3, Math.round(h / st.py) * st.py);
      const k = 0.85 + r * 0.2;
      const col = [k, k, k];
      ctx.chunks.bucket(bx, bz, st.mat).walls(bx - w / 2, 0, bz - d / 2, bx + w / 2, h, bz + d / 2, st.tw, st.th, Math.floor(rng() * 8) / 8, col);
      ctx.chunks.bucket(bx, bz, 'roof').top(bx - w / 2, bz - d / 2, bx + w / 2, bz + d / 2, h, 8, ROOFC);
    }
  }
}

export { rr, pick, snap3, decorateRoof };
