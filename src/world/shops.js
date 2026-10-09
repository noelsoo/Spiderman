// Weapon-shop storefronts: picks 4 street-level facade spots (near spawn + spread around the map) and builds
// a lit window / door / awning / neon sign there. world.shops = [{ pos, yaw, name }]:
//   pos = entrance point on the sidewalk 1.5 m in front of the facade (y = sidewalk top), never inside a physics box
//   yaw = direction the storefront faces (outward, towards the street); forward vector = (sin yaw, cos yaw)
import * as THREE from 'three';
import { Bucket } from './geo.js';
import { SHOP_DEFS } from './textures.js';
import { L, colX, rowZ } from './city.js';

const SIDEWALK_Y = 0.15;

function blockOf(x, z) {
  const i = Math.round((x - L.X0) / L.PX), j = Math.round((z - L.Z0) / L.PZ);
  return { i, j, cx: colX(i), cz: rowZ(j) };
}

function clearAt(physics, x, z, r = 0.7) {
  const boxes = physics.query(x - r, z - r, x + r, z + r, []);
  for (const b of boxes) if (b.min.y < 2.2 && b.max.y > 0.3) return false;
  return true;
}

/** Valid street-facing faces of a building's lowest tier: the sidewalk strip in front is free up to the curb. */
export function sidewalkFaces(ctx, s, minW = 10) {
  const out = [];
  const t = s.tiers[0];
  const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
  const faces = [
    { nx: 1, nz: 0, fx: t.x1, fz: cz, w: t.z1 - t.z0 }, { nx: -1, nz: 0, fx: t.x0, fz: cz, w: t.z1 - t.z0 },
    { nx: 0, nz: 1, fx: cx, fz: t.z1, w: t.x1 - t.x0 }, { nx: 0, nz: -1, fx: cx, fz: t.z0, w: t.x1 - t.x0 },
  ];
  for (const f of faces) {
    if (f.w < minW) continue;
    const ex = f.fx + f.nx * 1.5, ez = f.fz + f.nz * 1.5;
    const b = blockOf(ex, ez);
    if (Math.abs(ex - b.cx) > 38.2 || Math.abs(ez - b.cz) > 26.2) continue;      // beyond the curb
    if (f.nx !== 0 ? (Math.sign(f.fx - b.cx) !== f.nx) : (Math.sign(f.fz - b.cz) !== f.nz)) continue; // face looks into the block
    const reach = f.nx !== 0 ? 39 - Math.abs(f.fx - b.cx) : 27 - Math.abs(f.fz - b.cz);
    if (reach < 2.4 || reach > 9) continue;
    let ok = clearAt(ctx.physics, ex, ez);
    for (let d = 2; ok && d < reach; d += 1) ok = clearAt(ctx.physics, f.fx + f.nx * d, f.fz + f.nz * d, 0.4);
    if (!ok) continue;
    const along = f.nx !== 0 ? Math.abs(f.fz - b.cz) : Math.abs(f.fx - b.cx);
    const half = f.nx !== 0 ? 27 : 39;
    out.push({ f, ex, ez, avenue: f.nx !== 0, reach, cornerGap: half - along, b });
  }
  return out;
}

/** Local frame on a facade: P(u, y, w) = point u along the right tangent, y up, w outward from the facade plane + off. */
export function faceFrame(f, off = 0) {
  const nx = f.nx, nz = f.nz, tx = nz, tz = -nx;
  const ox = f.fx + nx * off, oz = f.fz + nz * off;
  return { nx, nz, tx, tz, ox, oz, yaw: Math.atan2(nx, nz), P: (u, y, w) => [ox + tx * u + nx * w, y, oz + tz * u + nz * w] };
}

export function planShops(ctx, specs, spawn) {
  const targets = [
    [spawn.pos.x, spawn.pos.z],
    [-215, 300], [330, -380], [330, 330],
  ];
  const cands = [];
  for (const s of specs) {
    if (s.h < 14) continue;
    for (const c of sidewalkFaces(ctx, s)) {
      if (c.cornerGap < 9) continue;
      cands.push({ s, f: c.f, ex: c.ex, ez: c.ez, avenue: c.avenue });
    }
  }
  const shops = [];
  const used = [];
  targets.forEach(([tx, tz], idx) => {
    let best = null, bs = 1e9;
    for (const c of cands) {
      if (used.some((u) => Math.hypot(u.ex - c.ex, u.ez - c.ez) < 90)) continue;
      const sc = Math.hypot(c.ex - tx, c.ez - tz) - (c.avenue ? 15 : 0) + (c.f.w < 14 ? 12 : 0);
      if (sc < bs) { bs = sc; best = c; }
    }
    if (!best) return;
    used.push(best);
    const { f } = best;
    shops.push({
      pos: new THREE.Vector3(best.ex, SIDEWALK_Y, best.ez),
      yaw: Math.atan2(f.nx, f.nz),
      name: SHOP_DEFS[idx].name,
      _f: f, _idx: idx,
    });
  });
  return shops;
}

/** Builds the 4 storefronts. Appends light pools to ctx.pools; returns meshes' materials for day/night animation. */
export function buildShops(ctx, shops, group, quality) {
  const T = ctx.T;
  const winB = new Bucket(), signB = new Bucket();
  const low = quality === 'low';
  const mats = {};
  for (const sh of shops) {
    const f = sh._f, i = sh._idx;
    const nx = f.nx, nz = f.nz, tx = nz, tz = -nx; // outward normal and "right" tangent seen from outside
    const ox = f.fx + nx * 0.2, oz = f.fz + nz * 0.2;
    const P = (u, y, w) => [ox + tx * u + nx * w, y, oz + tz * u + nz * w];
    const st = ctx.chunks.bucket(ox, oz, 'street'), gl = ctx.chunks.bucket(ox, oz, 'glow');
    const yaw = Math.atan2(nx, nz);
    const W = Math.min(9, f.w - 3);
    const box = (b, cu, cy, cw, su, sy, sw, col) => { const [x, y, z] = P(cu, cy, cw); b.boxXf(x, y, z, su, sy, sw, yaw, col); };
    const quad = (b, u0, u1, y0, y1, w, uv, n = [nx, 0, nz], col = [1, 1, 1]) => {
      b.quad(P(u0, y0, w), P(u1, y0, w), P(u1, y1, w), P(u0, y1, w), n[0], n[1], n[2], uv[0], uv[1], uv[2], uv[3], col);
    };
    const DARK = [0.07, 0.075, 0.085], STEEL = [0.2, 0.21, 0.23];
    // piers, bulkhead, lintel, door jambs
    for (const s of [-1, 1]) box(st, s * (W / 2 - 0.12), 1.7, 0.1, 0.34, 3.4, 0.32, DARK);
    box(st, 0, 0.22, 0.12, W - 0.5, 0.44, 0.18, STEEL);
    box(st, 0, 3.12, 0.12, W - 0.2, 0.24, 0.2, DARK);
    for (const s of [-1, 1]) box(st, s * 1.08, 1.4, 0.1, 0.12, 2.8, 0.2, DARK);
    box(st, 0, 2.86, 0.1, 2.2, 0.12, 0.2, DARK);
    // window displays (atlas cell i)
    const col = i % 2, row = (i / 2) | 0;
    const uv = [col * 0.5, 1 - (row + 1) * 0.5, col * 0.5 + 0.5, 1 - row * 0.5];
    quad(winB, -W / 2 + 0.3, -1.14, 0.46, 3.0, 0.16, uv);
    quad(winB, 1.14, W / 2 - 0.3, 0.46, 3.0, 0.16, uv);
    // glass door, glowing
    quad(gl, -0.98, 0.98, 0.12, 2.8, 0.14, [0, 0, 1, 1], [nx, 0, nz], [1.5, 1.2, 0.75]);
    box(st, 0, 1.4, 0.13, 0.06, 2.7, 0.06, DARK);
    // sloped awning (double sided) with stripes
    const aw = SHOP_DEFS[i].col, A = [aw[0] / 255 * 0.5, aw[1] / 255 * 0.5, aw[2] / 255 * 0.5], B = [0.07, 0.07, 0.08];
    const AW = W + 0.4, strips = 12, sw = AW / strips, y0 = 3.5, y1 = 3.04, w0 = 0.2, w1 = 1.55;
    const nTop = [nx * 0.33, 0.945, nz * 0.33];
    for (let k = 0; k < strips; k++) {
      const u0 = -AW / 2 + k * sw, u1 = u0 + sw, c = k % 2 ? A : B;
      st.quad(P(u0, y0, w0), P(u1, y0, w0), P(u1, y1, w1), P(u0, y1, w1), -nTop[0], -0.945, -nTop[2], 0, 0, 1, 1, c.map((v) => v * 0.7));
      st.quad(P(u1, y0, w0), P(u0, y0, w0), P(u0, y1, w1), P(u1, y1, w1), nTop[0], 0.945, nTop[2], 0, 0, 1, 1, c);
      st.quad(P(u0, y1 - 0.22, w1), P(u1, y1 - 0.22, w1), P(u1, y1, w1), P(u0, y1, w1), nx, 0, nz, 0, 0, 1, 1, c);
    }
    // neon sign above the awning
    const sW = Math.min(W - 0.4, 4.6), sH = sW / 4;
    box(st, 0, 4.18 + sH / 2 - 0.3, 0.2, sW + 0.3, sH + 0.3, 0.14, DARK);
    quad(signB, -sW / 2, sW / 2, 4.18 - 0.15, 4.18 - 0.15 + sH, 0.29, [0, 1 - (i + 1) / 4, 1, 1 - i / 4]);
    // warm light spilling on the pavement
    ctx.pools.push([sh.pos.x + nx * 0.8, sh.pos.z + nz * 0.8, 9, [1.0, 0.72, 0.4]]);
    ctx.pools.push([sh.pos.x + nx * 0.4, sh.pos.z + nz * 0.4, 5, [aw[0] / 255, aw[1] / 255, aw[2] / 255]]);
  }
  const winMat = low
    ? new THREE.MeshBasicMaterial({ map: T.shop.windows })
    : new THREE.MeshStandardMaterial({ map: T.shop.windows, emissiveMap: T.shop.windows, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.1 });
  const signMat = new THREE.MeshBasicMaterial({ map: T.shop.signs, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2, 2, 2) });
  const wm = new THREE.Mesh(winB.toGeometry(), winMat), sm = new THREE.Mesh(signB.toGeometry(), signMat);
  wm.matrixAutoUpdate = sm.matrixAutoUpdate = false;
  sm.renderOrder = 3;
  group.add(wm, sm);
  mats.win = winMat; mats.sign = signMat;
  return mats;
}
