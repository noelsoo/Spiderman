// Road network data + meshes (asphalt, markings, sidewalks, signals). Singapore drives on the LEFT.
import * as THREE from 'three';
import { AVE, STR, DIAG, L, cells, WEST_X, WEST_Z } from './layout.js';

const CYCLE = 32;
const SW = 5; // sidewalk width

export function buildRoadData(shops = []) {
  const avenues = AVE.map((a) => ({ x: a.x, zMin: a.z0, zMax: a.z1, width: a.w, lanes: a.lanes, highway: !!a.highway }));
  const streets = STR.map((s) => ({ z: s.z, xMin: s.x0, xMax: s.x1, width: s.w, lanes: s.lanes }));
  const intersections = [];
  for (const a of AVE) for (const s of STR) {
    if (a.x >= s.x0 - 1 && a.x <= s.x1 + 1 && s.z >= a.z0 - 1 && s.z <= a.z1 + 1) intersections.push({ x: a.x, z: s.z, aw: a.w, sw: s.w, highway: !!a.highway });
  }
  const segments = [];
  for (const a of AVE) segments.push({ a: new THREE.Vector3(a.x, 0, a.z0), b: new THREE.Vector3(a.x, 0, a.z1), width: a.w, lanes: a.lanes });
  for (const s of STR) segments.push({ a: new THREE.Vector3(s.x0, 0, s.z), b: new THREE.Vector3(s.x1, 0, s.z), width: s.w, lanes: s.lanes });
  for (const d of DIAG) segments.push({ a: new THREE.Vector3(d.a[0], 0, d.a[1]), b: new THREE.Vector3(d.b[0], 0, d.b[1]), width: d.w, lanes: d.lanes });
  const sidewalks = [];
  for (const c of cells(WEST_X, WEST_Z)) sidewalks.push({ x0: c.x0 - 5, x1: c.x1 + 5, z0: c.z0 - 5, z1: c.z1 + 5, width: 5, park: false });
  return { driveSide: 'left', laneModel: 'left-hand traffic: for a road running +z, the +z lane is on the -x side (west); running +x, the +x lane is on the +z side (south)', avenues, streets, intersections, sidewalks, segments, shops };
}

/** Signal controller. state(x,z,out) -> { ns, ew, x, z }; ns = cars moving along z, ew = cars moving along x. */
export class TrafficLights {
  constructor(inter) {
    this.t = 0;
    this.list = inter.filter((i) => !i.highway).map((i, k) => ({ x: i.x, z: i.z, aw: i.aw, sw: i.sw, off: ((k * 7919) % 97) / 97 * CYCLE, code: -1, inst: [] }));
    this.mesh = null;
  }
  phase(it, t = this.t) {
    const p = (t + it.off) % CYCLE;
    if (p < 12) return ['green', 'red', 0];
    if (p < 14) return ['yellow', 'red', 1];
    if (p < 16) return ['red', 'red', 2];
    if (p < 28) return ['red', 'green', 3];
    if (p < 30) return ['red', 'yellow', 4];
    return ['red', 'red', 5];
  }
  state(x, z, out = {}) {
    let best = null, bd = 1e12;
    for (const it of this.list) { const d = (it.x - x) ** 2 + (it.z - z) ** 2; if (d < bd) { bd = d; best = it; } }
    if (!best) return Object.assign(out, { ns: 'green', ew: 'red', x, z });
    const [ns, ew] = this.phase(best);
    out.ns = ns; out.ew = ew; out.x = best.x; out.z = best.z;
    return out;
  }
  /** instanced signal lamps, one disc per head face */
  build(group, ctx) {
    const st = (x, z) => ctx.chunks.bucket(x, z, 'street');
    const heads = [];
    for (const it of this.list) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = it.x + sx * (it.aw / 2 + 1.2), pz = it.z + sz * (it.sw / 2 + 1.2);
        const b = st(px, pz);
        b.cylV(px, 0.15, pz, 0.11, 5.6, 5, [0.16, 0.17, 0.18]);
        // head facing traffic on the avenue (looks along z towards the approaching lane) + head facing the street traffic
        b.boxXf(px, 5.3, pz - sz * 0.0, 0.5, 1.2, 0.4, 0, [0.04, 0.045, 0.05]);
        b.boxXf(px - sx * 0.1, 4.8, pz, 0.4, 1.2, 0.5, 0, [0.04, 0.045, 0.05]);
        heads.push([it, px, 5.3, pz + sz * 0.22, 0], [it, px + sx * 0.22, 4.8, pz, 1]);
      }
    }
    const g = new THREE.CircleGeometry(0.2, 8);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), Math.max(1, heads.length));
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    heads.forEach(([it, x, y, z, axis], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), axis ? Math.PI / 2 : 0);
      m.compose(p.set(x, y, z), q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(0.1, 0.1, 0.1));
      it.inst.push([i, axis]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    group.add(mesh);
  }
  update(dt) {
    this.t += dt;
    if (!this.mesh) return;
    const C = { red: [3, 0.15, 0.1], yellow: [3.2, 2.2, 0.1], green: [0.1, 2.6, 0.5] };
    let dirty = false;
    for (const it of this.list) {
      const [ns, ew, code] = this.phase(it);
      if (code === it.code) continue;
      it.code = code; dirty = true;
      const c = [ns, ew];
      for (const [i, axis] of it.inst) { const col = C[c[axis]]; this.mesh.setColorAt(i, _c.setRGB(col[0], col[1], col[2])); }
    }
    if (dirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const _c = new THREE.Color();

/** Fill chunk buckets with asphalt, markings, sidewalks; returns lamp / tree anchor lists. */
export function buildRoadMeshes(ctx) {
  const lamps = [], treeSpots = [];
  const asp = (x, z) => ctx.chunks.bucket(x, z, 'road');
  const mk = (x, z) => ctx.chunks.bucket(x, z, 'markings');
  const sw = (x, z) => ctx.chunks.bucket(x, z, 'sidewalk');
  const WHT = [0.88, 0.88, 0.85], YEL = [0.9, 0.7, 0.12];
  const ROAD_Y = 0.04, MK_Y = 0.055;
  const inter = [];
  for (const a of AVE) for (const s of STR) if (a.x >= s.x0 - 1 && a.x <= s.x1 + 1 && s.z >= a.z0 - 1 && s.z <= a.z1 + 1) inter.push({ a, s });

  // asphalt: break into ~500 m pieces so they land in the right chunk
  const strip = (x0, z0, x1, z1) => {
    const L2 = Math.max(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L2 / 400));
    for (let i = 0; i < n; i++) {
      const ax = x1 - x0 > z1 - z0;
      const xa = ax ? x0 + (x1 - x0) * i / n : x0, xb = ax ? x0 + (x1 - x0) * (i + 1) / n : x1;
      const za = ax ? z0 : z0 + (z1 - z0) * i / n, zb = ax ? z1 : z0 + (z1 - z0) * (i + 1) / n;
      asp((xa + xb) / 2, (za + zb) / 2).top(xa, za, xb, zb, ROAD_Y, 12);
    }
  };
  for (const a of AVE) strip(a.x - a.w / 2, a.z0, a.x + a.w / 2, a.z1);
  for (const s of STR) strip(s.x0, s.z - s.w / 2, s.x1, s.z + s.w / 2);
  for (const d of DIAG) {
    const dx = d.b[0] - d.a[0], dz = d.b[1] - d.a[1], len = Math.hypot(dx, dz);
    asp(d.a[0], d.a[1]).boxXf((d.a[0] + d.b[0]) / 2, ROAD_Y - 0.01, (d.a[1] + d.b[1]) / 2, d.w, 0.02, len, Math.atan2(dx, dz), [0.5, 0.5, 0.52]);
    mk(d.a[0], d.a[1]).boxXf((d.a[0] + d.b[0]) / 2, MK_Y, (d.a[1] + d.b[1]) / 2, 0.25, 0.02, len, Math.atan2(dx, dz), WHT);
  }

  const dashLine = (axisX, c, a0, a1, w, col, dash = 3.2, gap = 5.2) => {
    // axisX: line runs along x at z=c ; else along z at x=c
    for (let p = a0; p < a1 - dash; p += dash + gap) {
      if (axisX) mk(p, c).top(p, c - w / 2, p + dash, c + w / 2, MK_Y, 4, col);
      else mk(c, p).top(c - w / 2, p, c + w / 2, p + dash, MK_Y, 4, col);
    }
  };
  const solid = (axisX, c, a0, a1, w, col) => {
    if (axisX) mk((a0 + a1) / 2, c).top(a0, c - w / 2, a1, c + w / 2, MK_Y, 4, col);
    else mk(c, (a0 + a1) / 2).top(c - w / 2, a0, c + w / 2, a1, MK_Y, 4, col);
  };
  const zebra = (axisX, c, along, width) => {
    // zebra crossing: stripes across a road of `width` centred on c (perpendicular to travel); located at `along`
    for (let k = -width / 2 + 1; k < width / 2 - 0.5; k += 1.4) {
      if (axisX) mk(along, c + k).top(along - 1.6, c + k, along + 1.6, c + k + 0.7, MK_Y, 4, WHT);
      else mk(c + k, along).top(c + k, along - 1.6, c + k + 0.7, along + 1.6, MK_Y, 4, WHT);
    }
  };

  for (const a of AVE) {
    // cut points: crossing streets
    const cuts = inter.filter((i) => i.a === a).map((i) => ({ c: i.s.z, h: i.s.w / 2 })).sort((p, q) => p.c - q.c);
    let from = a.z0;
    const segs = [];
    for (const c of cuts) { segs.push([from, c.c - c.h - 7]); from = c.c + c.h + 7; }
    segs.push([from, a.z1]);
    const lw = a.w / a.lanes;
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 6) continue;
      if (a.highway) {
        solid(false, a.x, s0, s1, 2.4, [0.45, 0.45, 0.45]);
        for (let k = 1; k < a.lanes / 2; k++) { dashLine(false, a.x - 1.2 - k * lw, s0, s1, 0.18, WHT, 4, 9); dashLine(false, a.x + 1.2 + k * lw, s0, s1, 0.18, WHT, 4, 9); }
        solid(false, a.x - a.w / 2 + 0.6, s0, s1, 0.2, WHT); solid(false, a.x + a.w / 2 - 0.6, s0, s1, 0.2, WHT);
        continue;
      }
      solid(false, a.x - 0.18, s0, s1, 0.16, YEL); solid(false, a.x + 0.18, s0, s1, 0.16, YEL);
      for (let k = 1; k < a.lanes / 2; k++) { dashLine(false, a.x - k * lw, s0, s1, 0.14, WHT); dashLine(false, a.x + k * lw, s0, s1, 0.14, WHT); }
    }
    for (const c of cuts) {
      for (const sgn of [-1, 1]) {
        const zz = c.c + sgn * (c.h + 3.2);
        zebra(false, a.x, zz, a.w);
        mk(a.x, zz).top(a.x - a.w / 2, zz + sgn * 2.2 - 0.2, a.x, zz + sgn * 2.2 + 0.2, MK_Y, 4, WHT);
      }
    }
  }
  for (const s of STR) {
    const cuts = inter.filter((i) => i.s === s).map((i) => ({ c: i.a.x, h: i.a.w / 2 })).sort((p, q) => p.c - q.c);
    let from = s.x0;
    const segs = [];
    for (const c of cuts) { segs.push([from, c.c - c.h - 7]); from = c.c + c.h + 7; }
    segs.push([from, s.x1]);
    const lw = s.w / s.lanes;
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 6) continue;
      solid(true, s.z - 0.18, s0, s1, 0.16, YEL); solid(true, s.z + 0.18, s0, s1, 0.16, YEL);
      for (let k = 1; k < s.lanes / 2; k++) { dashLine(true, s.z - k * lw, s0, s1, 0.14, WHT); dashLine(true, s.z + k * lw, s0, s1, 0.14, WHT); }
    }
    for (const c of cuts) for (const sgn of [-1, 1]) {
      const xx = c.c + sgn * (c.h + 3.2);
      zebra(true, s.z, xx, s.w);
    }
  }

  // sidewalks (raised kerb strips) along every non-highway road, interrupted by cross streets
  const cutsFor = (list, key, v, crossKey, widthKey) => list.filter((i) => i[key] === v);
  for (const a of AVE) {
    if (a.highway) {
      for (const sd of [-1, 1]) { // concrete barriers + shoulders
        const bx = a.x + sd * (a.w / 2 + 0.4);
        ctx.chunks.bucket(bx, 0, 'prop').boxAll(bx - 0.4, 0, a.z0, bx + 0.4, 1.0, a.z1, 3, [0.62, 0.62, 0.6]);
      }
      ctx.chunks.bucket(a.x, 0, 'prop').boxAll(a.x - 0.5, 0, a.z0, a.x + 0.5, 0.9, a.z1, 3, [0.6, 0.6, 0.58]);
      for (let z = a.z0 + 30; z < a.z1; z += 60) for (const sd of [-1, 1]) lamps.push([a.x + sd * (a.w / 2 + 2.0), z, 13, -sd]);
      continue;
    }
    const cuts = inter.filter((i) => i.a === a).map((i) => [i.s.z - i.s.w / 2, i.s.z + i.s.w / 2]).sort((p, q) => p[0] - q[0]);
    let from = a.z0; const spans = [];
    for (const [c0, c1] of cuts) { spans.push([from, c0]); from = c1; }
    spans.push([from, a.z1]);
    for (const [z0, z1] of spans) {
      if (z1 - z0 < 3) continue;
      for (const sd of [-1, 1]) {
        const x0 = sd < 0 ? a.x - a.w / 2 - SW : a.x + a.w / 2, x1 = x0 + SW;
        sw((x0 + x1) / 2, (z0 + z1) / 2).boxAll(x0, 0, z0, x1, L.PROM_Y, z1, 4, [0.85, 0.83, 0.8]);
      }
    }
    for (let z = a.z0 + 22; z < a.z1; z += 44) {
      if (cuts.some(([c0, c1]) => z > c0 - 8 && z < c1 + 8)) continue;
      const sd = ((z - a.z0) / 44 | 0) % 2 ? 1 : -1;
      lamps.push([a.x + sd * (a.w / 2 + 1.2), z, 9.5, -sd], [a.x - sd * (a.w / 2 + 1.2), z + 22, 9.5, sd]);
    }
    for (let z = a.z0 + 14; z < a.z1; z += 26) {
      if (cuts.some(([c0, c1]) => z > c0 - 10 && z < c1 + 10)) continue;
      treeSpots.push([a.x - a.w / 2 - 2.4, z], [a.x + a.w / 2 + 2.4, z + 13]);
    }
  }
  for (const s of STR) {
    const cuts = inter.filter((i) => i.s === s).map((i) => [i.a.x - i.a.w / 2 - SW, i.a.x + i.a.w / 2 + SW]).sort((p, q) => p[0] - q[0]);
    let from = s.x0; const spans = [];
    for (const [c0, c1] of cuts) { spans.push([from, c0]); from = c1; }
    spans.push([from, s.x1]);
    for (const [x0, x1] of spans) {
      if (x1 - x0 < 3) continue;
      for (const sd of [-1, 1]) {
        const z0 = sd < 0 ? s.z - s.w / 2 - SW : s.z + s.w / 2, z1 = z0 + SW;
        sw((x0 + x1) / 2, (z0 + z1) / 2).boxAll(x0, 0, z0, x1, L.PROM_Y, z1, 4, [0.85, 0.83, 0.8]);
      }
    }
    for (let x = s.x0 + 22; x < s.x1; x += 44) {
      if (cuts.some(([c0, c1]) => x > c0 - 8 && x < c1 + 8)) continue;
      const sd = ((x - s.x0) / 44 | 0) % 2 ? 1 : -1;
      lamps.push([x, s.z + sd * (s.w / 2 + 1.2), 9.5, -sd, 'z']);
    }
    for (let x = s.x0 + 16; x < s.x1; x += 28) {
      if (cuts.some(([c0, c1]) => x > c0 - 10 && x < c1 + 10)) continue;
      treeSpots.push([x, s.z - s.w / 2 - 2.4], [x + 14, s.z + s.w / 2 + 2.4]);
    }
  }
  return { lamps, treeSpots };
}
