// Gardens by the Bay: Supertree Grove (instanced), OCBC-style skyway, Flower Dome + Cloud Forest, lake.
import * as THREE from 'three';
import { addBox } from './builders.js';
import { Bucket } from '../geo.js';

const STEEL = [0.5, 0.45, 0.52];

export function buildGardens(ctx) {
  const rng = ctx.rng2;
  // ground treatment: lawns + paths
  const g = ctx.chunks.bucket(480, 560, 'grass');
  g.top(205, 312, 765, 830, 0.1, 10, [0.7, 0.95, 0.65]);
  const pv = ctx.chunks.bucket(480, 560, 'sidewalk');
  pv.top(205, 312, 765, 322, 0.14, 6, [0.88, 0.86, 0.82]);
  pv.top(300, 322, 312, 830, 0.14, 6, [0.88, 0.86, 0.82]);
  pv.top(370, 322, 382, 780, 0.14, 6, [0.88, 0.86, 0.82]);
  pv.top(380, 455, 700, 467, 0.14, 6, [0.88, 0.86, 0.82]);
  pv.top(380, 395, 700, 407, 0.14, 6, [0.88, 0.86, 0.82]);
  // lake
  ctx.chunks.bucket(600, 690, 'pond').top(520, 640, 740, 770, 0.2, 8, [0.5, 0.85, 0.9]);
  for (let i = 0; i < 40; i++) ctx.palmSpots.push([205 + rng() * 560, 330 + rng() * 480, rng() < 0.5 ? 1 : 0]);

  // supertree placements: jittered grid of 5x4 with a hole for the skyway
  const trees = [];
  const cols = 5, rows = 4;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const tall = (i + j) % 3 !== 1;
    const H = tall ? 40 + rng() * 12 : 24 + rng() * 8;
    const x = 410 + i * 60 + (rng() - 0.5) * 22 + (j % 2) * 18, z = 360 + j * 52 + (rng() - 0.5) * 20;
    const Rc = H * (0.38 + rng() * 0.08);
    trees.push({ x, z, H, Rc });
  }
  trees.length = Math.min(trees.length, 18);
  ctx.supertrees = trees;
  for (const t of trees) {
    const s = t.H / 30;
    const hw = 1.9 * s + 0.5;
    addBox(ctx, t.x - hw, 0, t.z - hw, t.x + hw, t.H, t.z + hw, 'building', 'supertree');
    const rise = 0.2 * t.Rc;
    addBox(ctx, t.x - t.Rc * 0.52, t.H - 0.2, t.z - t.Rc * 0.52, t.x + t.Rc * 0.52, t.H + rise * 0.5, t.z + t.Rc * 0.52, 'roof', 'supertree-canopy');
    ctx.minimapB.push({ x: t.x, z: t.z, w: t.Rc * 1.4, d: t.Rc * 1.4, h: t.H });
    ctx.specs.push({ h: t.H, tiers: [{ x0: t.x - t.Rc * 0.5, x1: t.x + t.Rc * 0.5, z0: t.z - t.Rc * 0.5, z1: t.z + t.Rc * 0.5, y1: t.H + rise * 0.5 }], cx: t.x, cz: t.z, w: t.Rc, d: t.Rc });
  }
  // skyway between the two tallest, near each other
  const sorted = [...trees].sort((a, b) => b.H - a.H);
  const a = sorted[0], b = sorted.slice(1).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z)).find((q) => q.H > 36) || sorted[1];
  const sy = Math.min(a.H, b.H) * 0.55;
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const sw = ctx.chunks.bucket((a.x + b.x) / 2, (a.z + b.z) / 2, 'street');
  sw.boxXf((a.x + b.x) / 2, sy, (a.z + b.z) / 2, 3.2, 0.5, len, yaw, [0.62, 0.64, 0.68]);
  sw.boxXf((a.x + b.x) / 2 + Math.cos(yaw) * 1.6, sy + 0.6, (a.z + b.z) / 2 - Math.sin(yaw) * 1.6, 0.1, 1.1, len, yaw, [0.7, 0.72, 0.76]);
  sw.boxXf((a.x + b.x) / 2 - Math.cos(yaw) * 1.6, sy + 0.6, (a.z + b.z) / 2 + Math.sin(yaw) * 1.6, 0.1, 1.1, len, yaw, [0.7, 0.72, 0.76]);
  // physics: stepped boxes along the skyway
  const nStep = Math.ceil(len / 3);
  for (let i = 0; i < nStep; i++) {
    const t0 = i / nStep, t1 = (i + 1) / nStep;
    const x0 = a.x + dx * t0, x1 = a.x + dx * t1, z0 = a.z + dz * t0, z1 = a.z + dz * t1;
    addBox(ctx, Math.min(x0, x1) - 1.6, sy - 0.5, Math.min(z0, z1) - 1.6, Math.max(x0, x1) + 1.6, sy + 0.25, Math.max(z0, z1) + 1.6, 'bridge', 'skyway');
  }
  ctx.chunks.bucket(a.x, a.z, 'night').boxXf((a.x + b.x) / 2, sy - 0.3, (a.z + b.z) / 2, 3.4, 0.12, len, yaw, [0.9, 0.5, 1.0]);

  // glass domes (stepped solid boxes so they can be climbed)
  const domes = [
    { name: 'Flower Dome', x: 330, z: 600, a: 82, b: 48, h: 38, tint: 0xa8e0ff },
    { name: 'Cloud Forest', x: 335, z: 745, a: 58, b: 44, h: 36, tint: 0xb8f0e8 },
  ];
  ctx.domes = domes;
  for (const d of domes) {
    const lv = [[0, 10, 0.97], [10, 19, 0.86], [19, 27, 0.7], [27, 33, 0.5], [33, d.h - 0.5, 0.28]];
    for (const [y0, y1, f] of lv) addBox(ctx, d.x - d.a * f, y0, d.z - d.b * f, d.x + d.a * f, y1, d.z + d.b * f, 'building', 'dome');
    ctx.minimapB.push({ x: d.x, z: d.z, w: d.a * 2, d: d.b * 2, h: d.h });
    ctx.specs.push({ h: d.h, tiers: [{ x0: d.x - d.a * 0.28, x1: d.x + d.a * 0.28, z0: d.z - d.b * 0.28, z1: d.z + d.b * 0.28, y1: d.h - 0.5 }], cx: d.x, cz: d.z, w: d.a, d: d.b });
    // ribs
    const rb = ctx.chunks.bucket(d.x, d.z, 'street');
    const M = 20, S = 9;
    for (let m = 0; m < M; m++) {
      const th = (m / M) * Math.PI;
      let prev = null;
      for (let s2 = 0; s2 <= S; s2++) {
        const ph = (s2 / S) * Math.PI;           // along the arch (0..pi) over the top
        const px = d.x + Math.cos(ph) * d.a * Math.cos(th) * 1.0, pz = d.z + Math.cos(ph) * d.b * Math.sin(th) * 0 + 0;
        // arch in the plane at azimuth th: radius along (cos th * a, sin th * b)
        const ra = Math.cos(ph);
        const P = [d.x + ra * d.a * Math.cos(th), Math.sin(ph) * d.h, d.z + ra * d.b * Math.sin(th)];
        if (prev && P[1] >= 0) rb.cylBetween(prev, P, 0.22, [0.7, 0.72, 0.76]);
        prev = P;
      }
    }
    for (const f of [0.35, 0.65, 0.88]) { // parallels
      let prev = null; const y = d.h * Math.sqrt(1 - f * f);
      for (let k = 0; k <= 28; k++) {
        const th = (k / 28) * Math.PI * 2, P = [d.x + Math.cos(th) * d.a * f, y, d.z + Math.sin(th) * d.b * f];
        if (prev) rb.cylBetween(prev, P, 0.18, [0.7, 0.72, 0.76]);
        prev = P;
      }
    }
  }
  ctx.landmarks['Gardens by the Bay'] = new THREE.Vector3(500, 0, 470);
}

/** Instanced Supertree trunks, canopies, ribs + domes' glass. Returns night-update closure. */
export function makeSupertrees(ctx, group, quality) {
  const trees = ctx.supertrees;
  const low = quality === 'low';
  // trunk: hyperboloid lathe with vertex colour bands (steel lattice + green vertical gardens)
  const prof = [];
  const NSEG = 12;
  for (let i = 0; i <= NSEG; i++) { const t = i / NSEG; prof.push(new THREE.Vector2(1.5 + 1.7 * Math.pow(Math.abs(t - 0.36) / 0.64, 1.7) + 0.2 * (1 - t), t)); }
  const trunk = new THREE.LatheGeometry(prof, 10);
  const pos = trunk.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i), seg = Math.round(trunk.attributes.uv.getX(i) * 10);
    const green = (seg % 2 === 0 && t > 0.1 && t < 0.9) ? 1 : 0;
    const c = green ? [0.18 + 0.1 * t, 0.42 - 0.1 * t, 0.2] : [0.46, 0.4, 0.48];
    col.set(c, i * 3);
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const trunkMat = low ? new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x7a1c9a, emissiveIntensity: 0 }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.35, emissive: 0x7a1c9a, emissiveIntensity: 0 });
  const tm = new THREE.InstancedMesh(trunk, trunkMat, trees.length);
  // canopy: shallow inverted umbrella
  const canopy = new THREE.CylinderGeometry(1, 0.12, 0.2, 24, 1, true);
  canopy.translate(0, 0.1, 0);
  const canMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.06, 0.15), side: THREE.DoubleSide, fog: true });
  const cm = new THREE.InstancedMesh(canopy, canMat, trees.length);
  // ribs under canopy
  const rb = new Bucket();
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; rb.cylBetween([0, -0.03, 0], [Math.cos(a) * 0.98, 0.17, Math.sin(a) * 0.98], 0.006, [0.5, 0.45, 0.5]); }
  for (const f of [0.35, 0.7, 1.0]) { // ring wires
    for (let k = 0; k < 24; k++) { const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2; const y = 0.2 * (f - 0.12) / 0.88 - 0.015; rb.cylBetween([Math.cos(a0) * f, y, Math.sin(a0) * f], [Math.cos(a1) * f, y, Math.sin(a1) * f], 0.004, [0.55, 0.5, 0.55]); }
  }
  const ribMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  const rm = new THREE.InstancedMesh(rb.toGeometry(), ribMat, trees.length);
  // glowing LED ring at the canopy rim + underside bulbs
  const glowGeo = new THREE.TorusGeometry(1, 0.012, 4, 36);
  glowGeo.rotateX(Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.9), fog: true });
  const gm = new THREE.InstancedMesh(glowGeo, glowMat, trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const palette = [[1.0, 0.25, 0.85], [0.7, 0.3, 1.0], [1.0, 0.4, 0.6], [0.5, 0.35, 1.0]];
  trees.forEach((t, i) => {
    const sc = t.H / 30;
    m.compose(p.set(t.x, 0, t.z), q.identity(), s.set(sc, t.H, sc));
    tm.setMatrixAt(i, m);
    m.compose(p.set(t.x, t.H - 0.4, t.z), q.identity(), s.set(t.Rc, t.Rc, t.Rc));
    cm.setMatrixAt(i, m); rm.setMatrixAt(i, m);
    m.compose(p.set(t.x, t.H - 0.4 + 0.2 * t.Rc * 0.9, t.z), q.identity(), s.set(t.Rc * 0.99, t.Rc, t.Rc * 0.99));
    gm.setMatrixAt(i, m);
    const c = palette[i % palette.length];
    cm.setColorAt(i, new THREE.Color(c[0], c[1], c[2]));
    gm.setColorAt(i, new THREE.Color(c[0], c[1], c[2]));
  });
  for (const mesh of [tm, cm, rm, gm]) { mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; group.add(mesh); }
  tm.castShadow = !low; tm.receiveShadow = false;
  // domes glass
  const glass = [];
  const domeMats = [];
  for (const d of ctx.domes) {
    const mat = new THREE.MeshStandardMaterial({ color: d.tint, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.4, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    mesh.scale.set(d.a, d.h, d.b); mesh.position.set(d.x, 0, d.z);
    mesh.renderOrder = 2;
    group.add(mesh);
    const inner = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.0, 0.0, 0.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: true });
    const im = new THREE.Mesh(new THREE.SphereGeometry(0.985, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), inner);
    im.scale.set(d.a, d.h, d.b); im.position.set(d.x, 0, d.z); im.renderOrder = 1;
    group.add(im);
    domeMats.push({ inner, d });
    // greenery mass inside
    const gb = new THREE.Mesh(new THREE.ConeGeometry(d.name === 'Cloud Forest' ? 20 : 12, d.name === 'Cloud Forest' ? 30 : 8, 10), new THREE.MeshLambertMaterial({ color: d.name === 'Cloud Forest' ? 0x4a7a58 : 0x5aa05a }));
    gb.position.set(d.x, d.name === 'Cloud Forest' ? 15 : 4, d.z);
    group.add(gb);
  }
  return {
    update(night) {
      canMat.color.setRGB(0.14 + night * 1.15, 0.06 + night * 0.12, 0.14 + night * 1.0);
      trunkMat.emissiveIntensity = night * 0.9;
      glowMat.color.setScalar(0.1 + night * 2.2);
      for (const { inner, d } of domeMats) inner.color.setRGB(night * 0.28, night * (d.name === 'Cloud Forest' ? 0.5 : 0.35), night * (d.name === 'Cloud Forest' ? 0.45 : 0.4));
      for (const x of glass) x.update?.(night);
    },
  };
}
