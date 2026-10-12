// Shared building helpers: tier boxes with facade styles + physics, crowns, roof clutter.
import * as THREE from 'three';
import { STYLES } from '../materials.js';

export const ROOFC = [0.62, 0.62, 0.6];
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Region whose tall buildings are mirrored in the bay water. */
export const inReflRegion = (x, z) => x > -600 && x < 440 && z > -540 && z < 420;

export function addBox(ctx, x0, y0, z0, x1, y1, z1, type = 'building', id) {
  ctx.physics.addBox(_a.set(x0, y0, z0), _b.set(x1, y1, z1), { type, id, height: y1 });
}

/** One facade box: walls in the style material, flat roof, optional physics. */
export function emitBox(ctx, style, x0, y0, z0, x1, y1, z1, o = {}) {
  const st = STYLES[style];
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const col = o.col || [1, 1, 1];
  ctx.chunks.bucket(cx, cz, st.mat).walls(x0, y0, z0, x1, y1, z1, st.tw, st.th, o.uOff || 0, col);
  if (ctx.refl && y1 > 24 && inReflRegion(cx, cz)) ctx.refl.bucket(0, 0, st.mat).walls(x0, Math.max(0, y0), z0, x1, y1, z1, st.tw, st.th, o.uOff || 0, col);
  if (o.roof !== false) ctx.chunks.bucket(cx, cz, 'roof').top(x0, z0, x1, z1, y1, 12, o.roofCol || ROOFC);
  if (o.physics !== false) addBox(ctx, x0, y0, z0, x1, y1, z1, o.type || 'building', o.id);
}

/** Night-lit accent strip (always-on emissive material scaled by night). */
export function lightBox(ctx, x0, y0, z0, x1, y1, z1, col) {
  ctx.chunks.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'night').boxAll(x0, y0, z0, x1, y1, z1, 2, col);
  if (ctx.refl && y1 > 20 && inReflRegion((x0 + x1) / 2, (z0 + z1) / 2)) ctx.refl.bucket(0, 0, 'night').boxAll(x0, y0, z0, x1, y1, z1, 2, col);
}

/** Roof furniture: AC units, plant rooms. Registers the plant room as a standable box. */
export function roofClutter(ctx, rng, x0, z0, x1, z1, y) {
  const w = x1 - x0, d = z1 - z0;
  if (w < 8 || d < 8) return;
  const rb = ctx.chunks.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'roof');
  const n = Math.min(4, 1 + ((w * d) / 700 | 0));
  for (let i = 0; i < n; i++) {
    const hx = 1.2 + rng() * 2.4, hz = 1.2 + rng() * 2.4, hh = 1.2 + rng() * 2.2;
    const px = x0 + hx + 1 + rng() * Math.max(0.1, w - 2 * hx - 2), pz = z0 + hz + 1 + rng() * Math.max(0.1, d - 2 * hz - 2);
    const g = 0.55 + rng() * 0.25;
    rb.boxAll(px - hx, y, pz - hz, px + hx, y + hh, pz + hz, 3, [g, g, g + 0.03]);
    if (hh > 2) addBox(ctx, px - hx, y, pz - hz, px + hx, y + hh, pz + hz, 'roof', 'plant');
  }
}

/** Generic mid-rise block: 1-3 tiers. */
export function simpleBuilding(ctx, rng, x0, z0, x1, z1, h, style, o = {}) {
  const col = o.col || [0.92 + rng() * 0.12, 0.92 + rng() * 0.12, 0.95 + rng() * 0.1];
  const w = x1 - x0, d = z1 - z0;
  const tiers = h > 60 && rng() < 0.7 ? 2 : 1;
  let y = 0, ax0 = x0, az0 = z0, ax1 = x1, az1 = z1;
  const tierSpecs = [];
  for (let t = 0; t < tiers; t++) {
    const th = t === tiers - 1 ? h - y : h * (0.55 + rng() * 0.15);
    emitBox(ctx, style, ax0, y, az0, ax1, y + th, az1, { col, uOff: rng() * 4, id: o.id });
    tierSpecs.push({ x0: ax0, x1: ax1, z0: az0, z1: az1, y1: y + th });
    y += th;
    const sx = (ax1 - ax0) * (0.1 + rng() * 0.12), sz = (az1 - az0) * (0.1 + rng() * 0.12);
    ax0 += sx; ax1 -= sx; az0 += sz; az1 -= sz;
  }
  const top = tierSpecs[tierSpecs.length - 1];
  if (ctx.detail) roofClutter(ctx, rng, top.x0, top.z0, top.x1, top.z1, top.y1);
  const spec = { h, tiers: tierSpecs, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w, d };
  ctx.specs.push(spec);
  ctx.minimapB.push({ x: spec.cx, z: spec.cz, w, d, h });
  return spec;
}
