// Instanced street props: palms, rain trees, lamp posts; plus shoreline benches.
import * as THREE from 'three';
import { Bucket } from '../geo.js';
import { BAY } from './layout.js';

function palmGeo() {
  const b = new Bucket();
  const trunkCol = [0.42, 0.34, 0.26];
  // slightly curved trunk of 6 segments (unit height 1 -> scaled per instance)
  let px = 0, pz = 0;
  for (let i = 0; i < 6; i++) {
    const t0 = i / 6, t1 = (i + 1) / 6, bend = 0.12;
    const x0 = Math.sin(t0 * 1.4) * bend, x1 = Math.sin(t1 * 1.4) * bend;
    b.cylBetween([x0, t0, 0], [x1, t1, 0], 0.028 - t0 * 0.008, trunkCol);
  }
  const topX = Math.sin(1.4) * 0.12;
  // fronds: curved strips radiating from the top
  const fr = [0.12, 0.45, 0.17];
  for (let f = 0; f < 9; f++) {
    const a = (f / 9) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
    const len = 0.48, w = 0.05;
    let prev = [0, 0], pl = 0;
    const nseg = 4;
    for (let s = 0; s < nseg; s++) {
      const t0 = s / nseg, t1 = (s + 1) / nseg;
      const r0 = t0 * len, r1 = t1 * len, y0 = 0.02 + Math.sin(t0 * 2.2) * 0.08 - t0 * t0 * 0.16, y1 = 0.02 + Math.sin(t1 * 2.2) * 0.08 - t1 * t1 * 0.16;
      const wd0 = w * (1 - t0 * 0.7) , wd1 = w * (1 - t1 * 0.7);
      const A = [topX + ca * r0 - sa * wd0, 1 + y0, sa * r0 + ca * wd0], B = [topX + ca * r0 + sa * wd0, 1 + y0, sa * r0 - ca * wd0];
      const C = [topX + ca * r1 + sa * wd1, 1 + y1, sa * r1 - ca * wd1], D = [topX + ca * r1 - sa * wd1, 1 + y1, sa * r1 + ca * wd1];
      const shade = 0.85 + s * 0.08;
      const col = [fr[0] * shade, fr[1] * shade, fr[2] * shade];
      b.quad(A, B, C, D, 0, 1, 0, 0, 0, 1, 1, col);
      b.quad(B, A, D, C, 0, -1, 0, 0, 0, 1, 1, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7]);
    }
  }
  return b.toGeometry();
}

/** Rain tree (unit tree: ~0.85 tall, ~1.4 wide; instance scale x/z = spread, y = height): a thick short trunk forking
 *  into limbs under a wide, flat umbrella canopy made of overlapping flattened lobes with a darker underside. */
function rainTreeGeo() {
  const b = new Bucket();
  const bark = [0.3, 0.24, 0.19];
  b.cylV(0, 0, 0, 0.075, 0.34, 7, bark, 0.055);                       // buttressed trunk
  b.cylV(0, 0.3, 0, 0.055, 0.14, 6, bark, 0.045);                     // fork
  const ico0 = new THREE.IcosahedronGeometry(1, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const lobe = (x, y, z, rx, ry, c, tint = 1) => {
    m.compose(p.set(x, y, z), q, sc.set(rx, ry, rx));
    b.addGeo(ico0, m, [0.15 * c * tint, 0.42 * c, 0.14 * c * tint]);
  };
  const N = 6;
  for (let k = 0; k < N; k++) {                                       // limbs spreading out to the lobes
    const a = k / N * Math.PI * 2 + 0.3, r = 0.36;
    b.cylBetween([0, 0.4, 0], [Math.cos(a) * r * 0.9, 0.58, Math.sin(a) * r * 0.9], 0.02, bark);
  }
  for (let k = 0; k < N; k++) {                                       // outer ring of flat lobes
    const a = k / N * Math.PI * 2 + 0.3, r = 0.46, c = 0.85 + (k % 3) * 0.1;
    lobe(Math.cos(a) * r, 0.62 + (k % 2) * 0.03, Math.sin(a) * r, 0.3, 0.085, c);
  }
  for (let k = 0; k < 5; k++) {                                       // inner ring and crown, slightly raised
    const a = k / 5 * Math.PI * 2, r = 0.2;
    lobe(Math.cos(a) * r, 0.7, Math.sin(a) * r, 0.26, 0.09, 1.0 + (k % 2) * 0.1);
  }
  lobe(0, 0.74, 0, 0.3, 0.09, 1.1);
  lobe(0, 0.56, 0, 0.62, 0.05, 0.5, 0.9);                              // shaded underside
  return b.toGeometry();
}

/** returns { update(night) } */
export function makeProps(ctx, group, { palmSpots, lamps }) {
  const low = ctx.quality === 'low';
  const rng = ctx.rng2;
  const phys = ctx.physics;
  const ok = (x, z) => {
    for (const bx of phys.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6, [])) if (bx.min.y < 3 && bx.max.y > 0.2 && x > bx.min.x - 0.6 && x < bx.max.x + 0.6 && z > bx.min.z - 0.6 && z < bx.max.z + 0.6) return false;
    return !ctx.isWater(x, z);
  };
  const palms = [], rains = [];
  for (const s of palmSpots) {
    if (low && rng() > 0.45) continue;
    if (!ok(s[0], s[1])) continue;
    (s[2] === 0 ? palms : rains).push(s);
  }
  const mkInst = (geo, mat, list, scaleFn) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    list.forEach((it, i) => {
      const [sx, sy] = scaleFn(it);
      e.set((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08);
      q.setFromEuler(e);
      m.compose(p.set(it[0], it[3] ?? 0.12, it[1]), q, s.set(sx, sy, sx));
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
    return im;
  };
  const leafMat = low ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  mkInst(palmGeo(), leafMat, palms, (it) => [(it[4] ?? 1) * (0.9 + rng() * 0.5) * 9, (it[4] ?? 1) * (7 + rng() * 6)]);
  const t = mkInst(rainTreeGeo(), leafMat, rains, (it) => [(it[4] ?? 1) * (0.9 + rng() * 0.4) * 9.5, (it[4] ?? 1) * (10 + rng() * 4)]);

  // tall lamps are swing anchors (arm tip); the 9.5 m street lamps are too short to swing from
  for (const [x, z, h, d, ax] of lamps) {
    if (h < 12) continue;
    phys.addAnchor(x + (ax === 'z' ? 0 : d) * 1.4, 0.12 + h, z + (ax === 'z' ? d : (ax ?? 0)) * 1.4, { id: 'lamp' });
  }
  // lamps: pole + arm + head; heads glow with night
  const L = lamps.filter((_, i) => !low || i % 2 === 0);
  let heads = null, headMat = null;
  if (L.length) {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 1, 5); pole.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x777c84, roughness: 0.5, metalness: 0.5 }), L.length);
    const headG = new THREE.BoxGeometry(1.5, 0.16, 0.5);
    headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.2, 0.2) });
    heads = new THREE.InstancedMesh(headG, headMat, L.length);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), pm.material, L.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    L.forEach(([x, z, h, d, ax], i) => {
      const dirx = ax === 'z' ? 0 : d, dirz = ax === 'z' ? d : (ax ?? 0);
      const yaw = Math.atan2(dirx, dirz) + Math.PI / 2 * (dirx !== 0 ? 0 : 0);
      m.compose(p.set(x, 0.12, z), q.identity(), s.set(1, h, 1)); pm.setMatrixAt(i, m);
      // arm and head pointing toward the road; geometry long axis is x -> rotate so x aligns with (dirx, dirz)
      q.setFromAxisAngle(up, Math.atan2(-dirz, dirx));
      m.compose(p.set(x + dirx * 0.8, 0.12 + h, z + dirz * 0.8), q, s.set(1, 1, 1)); arm.setMatrixAt(i, m);
      m.compose(p.set(x + dirx * 1.4, 0.12 + h - 0.1, z + dirz * 1.4), q, s.set(1, 1, 1)); heads.setMatrixAt(i, m);
    });
    for (const im of [pm, arm, heads]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; group.add(im); }
  }
  // waterfront high-mast lights (26 m): ring the bay promenade and give open ground a swing anchor
  {
    if (!headMat) headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.2, 0.2) });
    const masts = [];
    for (let i = 0; i < BAY.length; i++) {
      const [ax, az] = BAY[i], [bx, bz] = BAY[(i + 1) % BAY.length];
      const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      let nx = -dz, nz = dx;
      if (ctx.isWater((ax + bx) / 2 + nx * 3, (az + bz) / 2 + nz * 3)) { nx = -nx; nz = -nz; }
      const n = Math.max(1, Math.round(len / 75));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, x = ax + dx * len * f + nx * 6.5, z = az + dz * len * f + nz * 6.5;
        if (ok(x, z)) masts.push([x, z]);
      }
    }
    if (masts.length) {
      const H = 26;
      const poleM = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.5, metalness: 0.5 });
      const pole = new THREE.CylinderGeometry(0.16, 0.34, H, 8); pole.translate(0, H / 2, 0);
      const pm = new THREE.InstancedMesh(pole, poleM, masts.length);
      const ringG = new THREE.CylinderGeometry(1.5, 1.5, 0.35, 10); ringG.translate(0, H, 0);
      const rm = new THREE.InstancedMesh(ringG, poleM, masts.length);
      const lampG = new THREE.BoxGeometry(2.6, 0.3, 2.6); lampG.translate(0, H + 0.3, 0);
      const lm = new THREE.InstancedMesh(lampG, headMat, masts.length);
      const mm = new THREE.Matrix4();
      masts.forEach(([x, z], i) => {
        mm.makeTranslation(x, 0.12, z); pm.setMatrixAt(i, mm); rm.setMatrixAt(i, mm); lm.setMatrixAt(i, mm);
        phys.addAnchor(x, H + 0.5, z, { id: 'mast' });
      });
      for (const im of [pm, rm, lm]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; group.add(im); }
      pm.castShadow = true;
    }
  }
  return { update(night) { if (headMat) headMat.color.setScalar(0.2 + night * 3.0); } };
}
