// Street-level detail: lamps with night light pools, traffic lights (with a queryable phase), hydrants, benches,
// bus stops, news kiosks, trash, meters, neon shop signs, fire escapes, rooftop extras and the Times-Square-style
// billboard plaza. Everything is merged into per-chunk buckets (a handful of draw calls).
import * as THREE from 'three';
import { Bucket } from './geo.js';
import { L, addBox, avenueX, streetZ, colX, rowZ, isPark } from './city.js';
import { sidewalkFaces, faceFrame } from './shops.js';

const SW = 0.15; // sidewalk top
const DARK = [0.08, 0.085, 0.095], STEEL = [0.22, 0.23, 0.25], RED = [0.7, 0.07, 0.05], WOOD = [0.42, 0.27, 0.14];
const BAG = [[0.02, 0.02, 0.025], [0.03, 0.03, 0.035], [0.1, 0.13, 0.22], [0.01, 0.01, 0.012]];

/** local frame at (px,pz): +w points towards the road (yaw), +u along the edge */
function Loc(bucket, px, pz, yaw, y0 = SW) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const o = {
    w: (u, w) => [px + u * c + w * s, pz - u * s + w * c],
    box(cu, cy, cw, su, sy, sw, col, pitch = 0, roll = 0) { const [x, z] = o.w(cu, cw); bucket.boxXf(x, y0 + cy, z, su, sy, sw, yaw, col, pitch, roll); },
    cyl(u, cy0, w, r, h, segs, col, r1) { const [x, z] = o.w(u, w); bucket.cylV(x, y0 + cy0, z, r, h, segs, col, r1); },
  };
  return o;
}

let _bag = null;
const bagGeo = () => (_bag ||= new THREE.IcosahedronGeometry(0.5, 0));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// ------------------------------------------------------------------ lamps + traffic lights
export function buildLamps(ctx, group, quality) {
  const lampPoles = [];
  const heads = ctx.chunks; // glow chunk buckets are keyed by position
  for (const [x, z, dx, dz] of ctx.lamps) {
    const st = heads.bucket(x, z, 'street'), lg = heads.bucket(x, z, 'lamp');
    st.cylV(x, SW, z, 0.2, 0.5, 6, STEEL, 0.14);
    st.cylV(x, SW + 0.5, z, 0.12, 7.8, 6, [0.13, 0.14, 0.16], 0.075);
    const yaw = Math.atan2(dx, dz), k = 0.7071;
    const hx = x + dx * k * 1.35, hz = z + dz * k * 1.35;
    st.boxXf(x + dx * k * 0.7, 8.35, z + dz * k * 0.7, 0.09, 0.09, 1.5, yaw, [0.13, 0.14, 0.16]);
    st.boxXf(hx, 8.42, hz, 0.62, 0.1, 1.0, yaw, [0.1, 0.1, 0.11]);
    lg.boxXf(hx, 8.33, hz, 0.5, 0.07, 0.86, yaw, [1.0, 0.74, 0.4]);
    ctx.pools.push([hx, hz, quality === 'low' ? 8 : 10, [1.0, 0.7, 0.36], 1]);
    lampPoles.push([x, z, dx, dz]);
  }
}

const CYCLE = 26;
export class TrafficLights {
  constructor(ctx, group, quality) {
    this.t = 0;
    this.inter = new Map();
    const poles = [];
    for (const [x, z, dx, dz] of ctx.lamps) {
      const a = Math.round((x - avenueX(0)) / 100), s = Math.round((z - streetZ(0)) / 70);
      if (a < 0 || a > 10 || s < 0 || s > 17) continue;
      const key = a * 18 + s;
      let it = this.inter.get(key);
      if (!it) { it = { a, s, x: avenueX(a), z: streetZ(s), off: ((a * 37 + s * 53) % 17) / 17 * CYCLE, ns: -1, ew: -1, zIdx: [], xIdx: [] }; this.inter.set(key, it); }
      poles.push([x, z, dx, dz, it]);
    }
    const n = poles.length;
    this.mesh = null;
    if (!n) return;
    const g = new THREE.CircleGeometry(0.105, 8);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), n * 6);
    this.mesh.frustumCulled = false;
    const col = new THREE.Color(0.02, 0.02, 0.02);
    let idx = 0;
    for (const [x, z, dx, dz, it] of poles) {
      const st = ctx.chunks.bucket(x, z, 'street');
      // head facing along z (seen by traffic on the avenue) and head facing along x (traffic on the street)
      for (const faceZ of [true, false]) {
        const fx = faceZ ? 0 : dx, fz = faceZ ? dz : 0;
        const cx = x + fx * 0.42 + (faceZ ? 0 : 0), cz = z + fz * 0.42;
        st.boxXf(cx, 5.1, cz, faceZ ? 0.42 : 0.34, 1.1, faceZ ? 0.34 : 0.42, 0, [0.04, 0.045, 0.05]);
        st.boxXf(x + fx * 0.2, 5.1, z + fz * 0.2, faceZ ? 0.12 : 0.3, 0.12, faceZ ? 0.3 : 0.12, 0, STEEL);
        const lx = cx + fx * 0.19, lz = cz + fz * 0.19;
        for (let k = 0; k < 3; k++) {
          _e.set(0, faceZ ? (dz > 0 ? 0 : Math.PI) : (dx > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
          _q.setFromEuler(_e); _p.set(lx, 5.1 + 0.34 - k * 0.34, lz); _s.set(1, 1, 1);
          _m.compose(_p, _q, _s);
          this.mesh.setMatrixAt(idx, _m); this.mesh.setColorAt(idx, col);
          (faceZ ? it.zIdx : it.xIdx).push(idx);
          idx++;
        }
      }
    }
    _m.makeScale(0, 0, 0); for (let k = idx; k < n * 6; k++) { this.mesh.setMatrixAt(k, _m); this.mesh.setColorAt(k, col); }
    this.mesh.instanceMatrix.needsUpdate = true;
    group.add(this.mesh);
    this.colors = [new THREE.Color(3.2, 0.22, 0.18), new THREE.Color(3.2, 2.2, 0.2), new THREE.Color(0.25, 3.0, 0.9), new THREE.Color(0.03, 0.03, 0.035)];
    this.list = [...this.inter.values()];
  }

  /** 0 = red, 1 = yellow, 2 = green for traffic moving along z (avenue) and along x (street) */
  static phase(it, t) {
    const u = (t + it.off) % CYCLE;
    const ns = u < 10 ? 2 : u < 12 ? 1 : 0;
    const ew = u < 14 ? 0 : u < 23 ? 2 : u < 25 ? 1 : 0;
    return [ns, ew];
  }

  update(dt) {
    this.t += dt;
    if (!this.mesh) return;
    let dirty = false;
    for (const it of this.list) {
      const u = (this.t + it.off) % CYCLE;
      const ns = u < 10 ? 2 : u < 12 ? 1 : 0, ew = u < 14 ? 0 : u < 23 ? 2 : u < 25 ? 1 : 0;
      if (ns !== it.ns) { this._set(it.zIdx, ns); it.ns = ns; dirty = true; }
      if (ew !== it.ew) { this._set(it.xIdx, ew); it.ew = ew; dirty = true; }
    }
    if (dirty) this.mesh.instanceColor.needsUpdate = true;
  }

  _set(idxs, state) {
    // lamps are stored 3 per head, top = red, middle = yellow, bottom = green
    for (let h = 0; h < idxs.length; h += 3) {
      for (let k = 0; k < 3; k++) {
        const lit = state === 0 ? k === 0 : state === 1 ? k === 1 : k === 2;
        this.mesh.setColorAt(idxs[h + k], lit ? this.colors[k === 0 ? 0 : k === 1 ? 1 : 2] : this.colors[3]);
      }
    }
  }

  /** state of the intersection nearest to (x, z); out = { ns, ew, x, z } where ns/ew are 'red' | 'yellow' | 'green' */
  state(x, z, out = {}, t = this.t) {
    const a = Math.min(10, Math.max(0, Math.round((x - avenueX(0)) / 100))), s = Math.min(17, Math.max(0, Math.round((z - streetZ(0)) / 70)));
    const it = this.inter.get(a * 18 + s) || { off: ((a * 37 + s * 53) % 17) / 17 * CYCLE };
    const [ns, ew] = TrafficLights.phase(it, t);
    out.ns = NAMES[ns]; out.ew = NAMES[ew]; out.x = avenueX(a); out.z = streetZ(s);
    return out;
  }
}
const NAMES = ['red', 'yellow', 'green'];

// ------------------------------------------------------------------ light pools on the ground
export function makePools(ctx, group, tex) {
  const list = ctx.pools;
  if (!list.length) return null;
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0, 0, 0), fog: true });
  const mesh = new THREE.InstancedMesh(g, mat, list.length);
  const c = new THREE.Color();
  list.forEach(([x, z, size, col], i) => {
    _p.set(x, 0.19, z); _q.identity(); _s.set(size, 1, size); _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m); mesh.setColorAt(i, c.setRGB(col[0], col[1], col[2]));
  });
  mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.visible = false;
  group.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------ street furniture
function hydrant(L_) {
  L_.cyl(0, 0, 0, 0.17, 0.62, 6, RED, 0.15);
  L_.cyl(0, 0.62, 0, 0.2, 0.1, 6, RED, 0.14);
  L_.cyl(0, 0.72, 0, 0.07, 0.1, 5, [0.55, 0.5, 0.1]);
  L_.box(0.22, 0.38, 0, 0.14, 0.12, 0.12, [0.55, 0.5, 0.1]); L_.box(-0.22, 0.38, 0, 0.14, 0.12, 0.12, [0.55, 0.5, 0.1]);
  L_.cyl(0, 0.3, 0.2, 0.06, 0.12, 5, [0.55, 0.5, 0.1]);
}
function bench(L_) {
  L_.box(0, 0.46, 0, 1.8, 0.07, 0.5, WOOD);
  L_.box(0, 0.78, -0.22, 1.8, 0.36, 0.06, WOOD, -0.18);
  for (const u of [-0.8, 0.8]) { L_.box(u, 0.22, 0, 0.08, 0.44, 0.44, DARK); L_.box(u, 0.62, -0.1, 0.08, 0.06, 0.4, DARK); }
}
function trashCan(L_) {
  L_.cyl(0, 0, 0, 0.27, 0.88, 7, [0.07, 0.17, 0.12], 0.3);
  L_.cyl(0, 0.88, 0, 0.3, 0.07, 7, DARK);
}
function newsBoxes(L_, rng) {
  const cols = [[0.75, 0.08, 0.08], [0.1, 0.25, 0.7], [0.8, 0.65, 0.1], [0.12, 0.5, 0.2]];
  const n = 1 + ((rng() * 3) | 0);
  for (let k = 0; k < n; k++) {
    const c = cols[(rng() * cols.length) | 0];
    L_.box(k * 0.55, 0.52, 0, 0.46, 0.84, 0.42, c);
    L_.box(k * 0.55, 0.72, 0.2, 0.34, 0.26, 0.04, [0.04, 0.05, 0.06]);
    L_.box(k * 0.55, 0.06, 0, 0.12, 0.12, 0.12, DARK);
  }
}
function mailbox(L_) {
  L_.box(0, 0.62, 0, 0.55, 0.95, 0.5, [0.08, 0.2, 0.55]);
  L_.cyl(0, 1.08, 0, 0.27, 0.1, 6, [0.08, 0.2, 0.55]);
  L_.box(0, 0.2, 0, 0.46, 0.4, 0.4, [0.06, 0.15, 0.4]);
}
function meter(L_) {
  L_.cyl(0, 0, 0, 0.035, 1.25, 4, [0.35, 0.36, 0.38]);
  L_.box(0, 1.35, 0, 0.17, 0.26, 0.1, [0.25, 0.27, 0.3]);
}
function bags(L_, rng, bucket, px, pz, yaw) {
  const n = 2 + ((rng() * 3) | 0);
  for (let k = 0; k < n; k++) {
    const [x, z] = L_.w((rng() - 0.5) * 1.1, (rng() - 0.5) * 0.7);
    const s = 0.5 + rng() * 0.35;
    _p.set(x, SW + s * 0.38, z); _e.set(0, rng() * 6.28, 0); _q.setFromEuler(_e); _s.set(s * 1.1, s * 0.85, s);
    _m.compose(_p, _q, _s);
    bucket.addGeo(bagGeo(), _m, BAG[(rng() * BAG.length) | 0]);
  }
}
function adQuad(ad, P, uMin, uMax, y0, y1, w, nrm, frame, bright = [1, 1, 1]) {
  const col = frame % 4, row = (frame / 4) | 0;
  const u0 = col / 4, u1 = u0 + 0.25, v0 = 1 - (row + 1) / 2, v1 = v0 + 0.5;
  ad.quad(P(uMin, y0, w), P(uMax, y0, w), P(uMax, y1, w), P(uMin, y1, w), nrm[0], 0, nrm[1], u0, v0, u1, v1, bright);
}
function busStop(ctx, rng, px, pz, yaw, nx, nz) {
  const st = ctx.chunks.bucket(px, pz, 'street'), ad = ctx.chunks.bucket(px, pz, 'ad');
  const L_ = Loc(st, px, pz, yaw);
  // frame, roof, bench, glass panels
  L_.box(0, 2.55, 0, 3.6, 0.1, 1.6, [0.14, 0.15, 0.17]);
  L_.box(0, 2.62, 0, 3.7, 0.04, 1.7, [0.7, 0.1, 0.08]);
  for (const u of [-1.7, 1.7]) for (const w of [-0.7, 0.7]) L_.box(u, 1.25, w, 0.07, 2.5, 0.07, [0.2, 0.21, 0.23]);
  L_.box(0, 0.5, -0.45, 2.2, 0.07, 0.4, WOOD);
  L_.box(-1.7, 1.3, 0, 0.05, 2.2, 1.4, [0.35, 0.5, 0.55]);
  L_.box(1.7, 1.3, 0, 0.05, 2.2, 1.4, [0.35, 0.5, 0.55]);
  L_.box(0, 1.3, -0.72, 3.3, 2.2, 0.05, [0.3, 0.42, 0.48]);
  // lit ad panel on the road-facing side of the back wall and a route sign
  const [x0, z0] = L_.w(0, -0.68);
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const P = (u, y, w) => [px + u * c + w * s, SW + y, pz - u * s + w * c];
  adQuad(ad, P, -1.4, 1.4, 0.55, 2.35, -0.66, [s, c], (rng() * 8) | 0, [1.3, 1.3, 1.3]);
  L_.cyl(2.2, 0, 0, 0.04, 2.7, 4, STEEL);
  L_.box(2.2, 2.55, 0, 0.5, 0.4, 0.05, [0.1, 0.3, 0.7]);
  // collision
  const along = Math.abs(nx) > 0.5;
  const hx = along ? 0.85 : 1.85, hz = along ? 1.85 : 0.85;
  addBox(ctx, px - hx + 0, 0, pz - hz, px + hx, 2.7, pz + hz, 'prop', 'busstop');
}
function kiosk(ctx, rng, px, pz, yaw, nx) {
  const st = ctx.chunks.bucket(px, pz, 'street'), gl = ctx.chunks.bucket(px, pz, 'glow');
  const L_ = Loc(st, px, pz, yaw);
  const c = [[0.12, 0.35, 0.2], [0.55, 0.12, 0.1], [0.15, 0.2, 0.4]][(rng() * 3) | 0];
  L_.box(0, 1.15, 0, 2.2, 2.3, 1.5, c);
  L_.box(0, 2.38, 0, 2.5, 0.12, 1.8, DARK);
  L_.box(0, 1.05, 0.78, 1.8, 0.9, 0.04, [0.04, 0.05, 0.06]);
  const s = Math.sin(yaw), cc = Math.cos(yaw);
  const P = (u, y, w) => [px + u * cc + w * s, SW + y, pz - u * s + w * cc];
  gl.quad(P(-0.85, 0.65, 0.81), P(0.85, 0.65, 0.81), P(0.85, 1.5, 0.81), P(-0.85, 1.5, 0.81), s, 0, cc, 0, 0, 1, 1, [1.6, 1.15, 0.6]);
  const along = Math.abs(nx) > 0.5;
  addBox(ctx, px - (along ? 0.85 : 1.15), 0, pz - (along ? 1.15 : 0.85), px + (along ? 0.85 : 1.15), 2.5, pz + (along ? 1.15 : 0.85), 'prop', 'kiosk');
}

export function buildStreetProps(ctx, shops, quality) {
  const rng = ctx.rng2;
  const q = quality === 'low' ? 0.4 : quality === 'medium' ? 0.75 : 1;
  const nearShop = (x, z) => shops.some((s) => Math.hypot(s.pos.x - x, s.pos.z - z) < 7);
  for (let i = 0; i < L.COLS; i++) for (let j = 0; j < L.ROWS; j++) {
    const cx = colX(i), cz = rowZ(j), x0 = cx - L.BW / 2, x1 = cx + L.BW / 2, z0 = cz - L.BD / 2, z1 = cz + L.BD / 2;
    const park = isPark(i, j);
    // edges: curb coordinate, outward normal, tangent range
    const edges = [
      { nx: -1, nz: 0, c: x0, a: z0 + 8, b: z1 - 8, avenue: true }, { nx: 1, nz: 0, c: x1, a: z0 + 8, b: z1 - 8, avenue: true },
      { nx: 0, nz: -1, c: z0, a: x0 + 8, b: x1 - 8, avenue: false }, { nx: 0, nz: 1, c: z1, a: x0 + 8, b: x1 - 8, avenue: false },
    ];
    for (const e of edges) {
      const yaw = Math.atan2(e.nx, e.nz);
      const at = (t, inset) => e.nx !== 0 ? [e.c - e.nx * inset, t] : [t, e.c - e.nz * inset];
      const rand = () => e.a + rng() * (e.b - e.a);
      const place = (inset, fn, p) => {
        if (rng() > p * q) return;
        const t = rand();
        const [px, pz] = at(t, inset);
        if (nearShop(px, pz)) return;
        const bucket = ctx.chunks.bucket(px, pz, 'street');
        fn(Loc(bucket, px, pz, yaw), bucket, px, pz);
      };
      place(0.55, (l) => hydrant(l), park ? 0.1 : 0.5);
      place(1.7, (l) => bench(l), park ? 0.7 : e.avenue ? 0.3 : 0.4);
      place(0.8, (l) => { trashCan(l); }, 0.5);
      if (!park) {
        place(3.0, (l, b, px, pz) => bags(l, rng, b, px, pz, yaw), 0.4);
        place(0.75, (l) => newsBoxes(l, rng), 0.35);
        place(0.75, (l) => mailbox(l), 0.2);
        if (!e.avenue && rng() < 0.7 * q) {
          const t0 = e.a + rng() * (e.b - e.a - 14);
          for (let k = 0; k < 3; k++) { const [px, pz] = at(t0 + k * 5, 0.42); if (!nearShop(px, pz)) meter(Loc(ctx.chunks.bucket(px, pz, 'street'), px, pz, yaw)); }
        }
        if (e.avenue && quality !== 'low' && rng() < 0.16) {
          const [px, pz] = at(rand(), 1.75);
          if (!nearShop(px, pz) && ctx.physics.query(px - 2.2, pz - 2.2, px + 2.2, pz + 2.2, []).every((b) => b.max.y < 0.3 || b.min.y > 3)) busStop(ctx, rng, px, pz, yaw, e.nx, e.nz);
        }
        if (!e.avenue && quality !== 'low' && rng() < 0.07) {
          const [px, pz] = at(rand(), 2.0);
          if (!nearShop(px, pz) && ctx.physics.query(px - 2, pz - 2, px + 2, pz + 2, []).every((b) => b.max.y < 0.3 || b.min.y > 3)) kiosk(ctx, rng, px, pz, yaw, e.nx);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ fire escapes + roof extras
export function fireEscape(ctx, rng, spec) {
  const faces = sidewalkFaces(ctx, spec, 8);
  if (!faces.length) return;
  const c = faces[(rng() * faces.length) | 0];
  const f = c.f, F = faceFrame(f, 0);
  const t = spec.tiers[0], floorH = spec.style === 'redbrick' || spec.style === 'brownstone' ? 3.2 : 3.4;
  const top = Math.min(t.y1, spec.h) - 3;
  if (top < 9) return;
  const bu = (rng() - 0.5) * Math.max(0, f.w - 8);
  const st = ctx.chunks.bucket(F.ox, F.oz, 'street');
  const [wx, , wz] = F.P(bu, 0, 0.55);
  const colr = [0.1, 0.1, 0.11];
  let dir = 1;
  for (let y = floorH * 2 + 0.1; y < top; y += floorH) {
    const box = (cu, cy, cw, su, sy, sw, col, pitch = 0, roll = 0) => { const [x, , z] = F.P(bu + cu, y + cy, cw); st.boxXf(x, y + cy, z, su, sy, sw, F.yaw, col, pitch, roll); };
    box(0, 0, 0.55, 2.6, 0.06, 1.1, colr);
    box(0, 0.95, 1.07, 2.6, 0.04, 0.04, colr); box(0, 0.5, 1.07, 2.6, 0.03, 0.03, colr);
    box(-1.28, 0.5, 0.55, 0.04, 0.9, 1.05, colr, 0, 0); box(1.28, 0.5, 0.55, 0.04, 0.9, 1.05, colr);
    if (y + floorH < top) { // stair to the next landing, zig-zagging
      const roll = Math.atan2(floorH, 2.0) * dir;
      box(0, floorH / 2, 0.55, Math.hypot(2.0, floorH), 0.05, 0.7, [0.14, 0.14, 0.15], 0, roll);
      dir = -dir;
    }
  }
}

/** Extra rooftop clutter on top of the base props (own rng stream so the city layout stays put). */
export function roofExtras(ctx, rng, x0, z0, x1, z1, y, tall) {
  const w = x1 - x0, d = z1 - z0;
  if (w < 10 || d < 10 || ctx.quality === 'low') return;
  const st = ctx.chunks.bucket((x0 + x1) / 2, (z0 + z1) / 2, 'street');
  const r = (a, b) => a + (b - a) * rng();
  // skylight
  if (rng() < 0.5) {
    const sx = r(x0 + 3, x1 - 3), sz = r(z0 + 3, z1 - 3);
    st.boxXf(sx, y + 0.35, sz, 2.4, 0.7, 1.6, 0, [0.5, 0.58, 0.62]);
    st.boxXf(sx, y + 0.72, sz, 2.0, 0.06, 1.2, 0, [0.12, 0.2, 0.28]);
  }
  // solar panels
  if (rng() < 0.28 && w > 16) {
    const sx = r(x0 + 4, x1 - 8), sz = r(z0 + 3, z1 - 5);
    for (let k = 0; k < 3; k++) st.boxXf(sx + k * 2.2, y + 0.8, sz, 2.0, 0.05, 1.5, 0, [0.06, 0.1, 0.22], -0.5);
  }
  // vent stacks
  const nv = (rng() * 3) | 0;
  for (let k = 0; k < nv; k++) {
    const vx = r(x0 + 2, x1 - 2), vz = r(z0 + 2, z1 - 2), h = r(1.2, 2.8);
    st.cylV(vx, y, vz, 0.28, h, 7, [0.55, 0.55, 0.58]);
    st.cylV(vx, y + h, vz, 0.42, 0.14, 7, [0.35, 0.35, 0.38]);
  }
  // dish
  if (rng() < 0.18) {
    const sx = r(x0 + 3, x1 - 3), sz = r(z0 + 3, z1 - 3);
    st.cylV(sx, y, sz, 0.1, 1.3, 5, [0.5, 0.5, 0.52]);
    st.boxXf(sx, y + 1.55, sz, 1.5, 0.12, 1.5, r(0, 3), [0.82, 0.82, 0.85], -0.8);
  }
  // helipad on a few tall buildings
  if (tall && rng() < 0.15 && w > 20 && d > 20) {
    const hx = (x0 + x1) / 2, hz = (z0 + z1) / 2, mk = ctx.chunks.bucket(hx, hz, 'markings');
    mk.disc(hx, hz, 7.5, y + 0.07, 16, [0.22, 0.23, 0.25]);
    mk.disc(hx, hz, 6.6, y + 0.08, 16, [0.9, 0.9, 0.8]);
    mk.disc(hx, hz, 6.3, y + 0.09, 16, [0.22, 0.23, 0.25]);
    mk.top(hx - 2.2, hz - 2.6, hx - 1.3, hz + 2.6, y + 0.1, 4, [0.95, 0.75, 0.1]);
    mk.top(hx + 1.3, hz - 2.6, hx + 2.2, hz + 2.6, y + 0.1, 4, [0.95, 0.75, 0.1]);
    mk.top(hx - 1.3, hz - 0.45, hx + 1.3, hz + 0.45, y + 0.1, 4, [0.95, 0.75, 0.1]);
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; ctx.chunks.bucket(hx, hz, 'glow').boxXf(hx + Math.sin(a) * 7.2, y + 0.15, hz + Math.cos(a) * 7.2, 0.3, 0.2, 0.3, 0, [0.4, 2.2, 0.6]); }
  }
}

// ------------------------------------------------------------------ neon signs + billboards
const PLAZA = { x: 100, z: -245 }; // avenueX(5), streetZ(5): the Times-Square-style block just north of Central Park
export const PLAZA_POS = PLAZA;

export function buildSigns(ctx, specs, group, quality) {
  const rng = ctx.rng2;
  const screens = []; // { f, y0, y1, w, group }
  let nSign = 0;
  for (const s of specs) {
    const faces = sidewalkFaces(ctx, s, 10);
    if (!faces.length) continue;
    // Times Square screens
    const near = faces.filter((c) => Math.hypot(c.f.fx - PLAZA.x, c.f.fz - PLAZA.z) < 62);
    const t0 = s.tiers[0];
    if (near.length && t0.y1 >= 16) {
      for (const c of near) {
        const y0 = 7.5, y1 = Math.min(t0.y1 - 1.5, y0 + 20);
        if (y1 - y0 < 5) continue;
        screens.push({ f: c.f, y0, y1, w: Math.min(c.f.w - 3, 28), g: screens.length % 4 });
      }
    }
    // neon signs above the shopfronts: street-facing, ~45% of buildings
    if (quality === 'low' || rng() > 0.5) continue;
    const c = faces[(rng() * faces.length) | 0];
    if (c.cornerGap < 6) continue;
    const F = faceFrame(c.f, 0.18), word = (rng() * ctx.T.NEON_COUNT) | 0;
    const ncol = word % 4, nrow = (word / 4) | 0, uv = [ncol / 4, 1 - (nrow + 1) / 8, (ncol + 1) / 4, 1 - nrow / 8];
    const u = (rng() - 0.5) * Math.max(0, c.f.w - 8), sy = 5.3 + rng() * 0.4, sw = 4.2, sh = 1.05;
    const nb = ctx.chunks.bucket(F.ox, F.oz, 'neon'), st = ctx.chunks.bucket(F.ox, F.oz, 'street');
    const [bx, , bz] = F.P(u, 0, 0.1);
    st.boxXf(bx, sy + sh / 2, bz, sw + 0.3, sh + 0.25, 0.12, F.yaw, [0.05, 0.05, 0.06]);
    nb.quad(F.P(u - sw / 2, sy, 0.2), F.P(u + sw / 2, sy, 0.2), F.P(u + sw / 2, sy + sh, 0.2), F.P(u - sw / 2, sy + sh, 0.2), F.nx, 0, F.nz, uv[0], uv[1], uv[2], uv[3]);
    nSign++;
  }
  // animated screens: 4 meshes sharing one atlas, each stepping through frames on its own clock
  const groups = [0, 1, 2, 3].map(() => new Bucket());
  const glowB = new Bucket();
  const glowCols = [[3.5, 0.4, 1.4], [0.4, 2.6, 3.8], [3.5, 2.2, 0.3], [0.5, 3.2, 1.0]];
  for (const sc of screens) {
    const F = faceFrame(sc.f, 0.45), W = sc.w, y0 = sc.y0, y1 = sc.y1;
    const u = 0;
    groups[sc.g].quad(F.P(u - W / 2, y0, 0.0), F.P(u + W / 2, y0, 0.0), F.P(u + W / 2, y1, 0.0), F.P(u - W / 2, y1, 0.0), F.nx, 0, F.nz, 0, 0.5, 0.25, 1);
    const gc = glowCols[sc.g], b = 0.35;
    const [fx0, , fz0] = F.P(u, 0, -0.05);
    // frame: four glowing bars
    const bar = (cu, cy, su, sy) => { const [x, , z] = F.P(u + cu, 0, -0.02); glowB.boxXf(x, cy, z, su, sy, 0.3, F.yaw, gc); };
    bar(0, y0 - b / 2, W + b * 2, b); bar(0, y1 + b / 2, W + b * 2, b);
    bar(-W / 2 - b / 2, (y0 + y1) / 2, b, y1 - y0); bar(W / 2 + b / 2, (y0 + y1) / 2, b, y1 - y0);
    // support bracket behind
    const [bx, , bz] = F.P(u, 0, 0.1);
    ctx.chunks.bucket(bx, bz, 'street').boxXf(bx, (y0 + y1) / 2, bz, W + 1.4, y1 - y0 + 1.4, 0.4, F.yaw, [0.05, 0.05, 0.06]);
  }
  const meshes = [];
  const periods = [3.4, 4.3, 2.9, 3.8];
  groups.forEach((gb, gi) => {
    if (gb.empty) return;
    const tex = ctx.T.screens.clone(); tex.needsUpdate = true; tex.matrixAutoUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: true });
    const m = new THREE.Mesh(gb.toGeometry(), mat); m.matrixAutoUpdate = false; m.frustumCulled = true;
    group.add(m);
    meshes.push({ mesh: m, tex, period: periods[gi], phase: gi * 1.7 });
  });
  if (!glowB.empty) { const gm = new THREE.Mesh(glowB.toGeometry(), ctx.M.glow); gm.matrixAutoUpdate = false; group.add(gm); }
  return { meshes, count: screens.length, signs: nSign };
}

export function updateScreens(sig, time) {
  if (!sig) return;
  for (const s of sig.meshes) {
    const k = Math.floor(time / s.period + s.phase) % 8;
    s.tex.offset.set((k % 4) / 4, -((k / 4) | 0) / 2);
  }
}
