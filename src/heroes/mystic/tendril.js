// Pooled chaos-magic tendrils: writhing additive ribbons between two (optionally live) points.
// One shared material, a fixed pool of meshes (no allocation after construction), disposed with dispose().
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _s = new THREE.Vector3(), _n = new THREE.Vector3(), _r = new THREE.Vector3(), _c = new THREE.Color();

export class TendrilPool {
  constructor(scene, count = 14, segs = 14) {
    this.scene = scene; this.segs = segs;
    const verts = (segs + 1) * 2;
    const index = [];
    for (let i = 0; i < segs; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.slots = [];
    for (let i = 0; i < count; i++) {
      const pos = new Float32Array(verts * 3), col = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
      for (let v = 0; v < verts; v++) nor[v * 3 + 1] = 1;
      const geo = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      const ca = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pa); geo.setAttribute('color', ca); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(index);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 12;
      scene.add(mesh);
      this.slots.push({ mesh, geo, pos, col, pa, ca, active: false, t: 0, life: 0.3, from: new THREE.Vector3(), to: new THREE.Vector3(), fromFn: null, toFn: null, r: 1, g: 0.2, b: 0.3, width: 0.12, curl: 0.6, waves: 2, phase: 0, grow: 0.3, seed: 0 });
    }
    this.cursor = 0;
  }

  /** opts: color, width, life, curl, waves, grow (fraction of life spent extending), fromFn(out), toFn(out) for live endpoints */
  fire(from, to, opts = {}) {
    const o = this.slots[this.cursor]; this.cursor = (this.cursor + 1) % this.slots.length;
    o.active = true; o.t = 0; o.life = opts.life ?? 0.3; o.width = opts.width ?? 0.12; o.curl = opts.curl ?? 0.6;
    o.waves = opts.waves ?? 2; o.grow = opts.grow ?? 0.3; o.phase = Math.random() * 6.28; o.seed = Math.random() * 6.28;
    o.from.copy(from); o.to.copy(to); o.fromFn = opts.fromFn ?? null; o.toFn = opts.toFn ?? null;
    _c.set(opts.color ?? 0xff2a55); o.r = _c.r; o.g = _c.g; o.b = _c.b;
    o.mesh.visible = true;
    return o;
  }

  update(dt, camPos) {
    for (const o of this.slots) {
      if (!o.active) continue;
      o.t += dt;
      if (o.t >= o.life) { o.active = false; o.mesh.visible = false; continue; }
      if (o.fromFn) o.fromFn(o.from);
      if (o.toFn) o.toFn(o.to);
      const k = o.t / o.life;
      const reach = Math.min(1, k / o.grow);
      const fade = k < o.grow ? 1 : 1 - (k - o.grow) / (1 - o.grow);
      _d.subVectors(o.to, o.from);
      const len = _d.length();
      if (len < 1e-3) { o.mesh.visible = false; continue; }
      o.mesh.visible = true;
      _d.divideScalar(len);
      // a stable sideways axis to wiggle along
      _s.set(0, 1, 0); if (Math.abs(_d.y) > 0.95) _s.set(1, 0, 0);
      _s.crossVectors(_d, _s).normalize();
      _n.crossVectors(_d, _s);
      const N = this.segs;
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const along = s * reach;
        const env = Math.sin(Math.min(1, s) * Math.PI) * o.curl * (1 - 0.5 * (k > o.grow ? 1 : 0) * (k - o.grow));
        const ang = s * o.waves * Math.PI * 2 + o.phase + o.t * 14;
        _p.copy(o.from).addScaledVector(_d, along * len)
          .addScaledVector(_s, Math.sin(ang) * env).addScaledVector(_n, Math.cos(ang * 0.9 + o.seed) * env);
        // billboard ribbon: width axis perpendicular to both the tangent and the view vector
        _a.set(camPos.x - _p.x, camPos.y - _p.y, camPos.z - _p.z);
        _r.crossVectors(_d, _a); const rl = _r.length(); if (rl > 1e-5) _r.divideScalar(rl); else _r.copy(_s);
        const taper = (1 - s * 0.6) * (0.35 + 0.65 * Math.sin(Math.min(1, s + 0.15) * Math.PI));
        const w = o.width * 0.5 * taper * fade;
        const br = fade * (i / N <= reach ? 1 : 0) * (0.5 + 0.5 * (1 - s));
        const v = i * 6;
        o.pos[v] = _p.x + _r.x * w; o.pos[v + 1] = _p.y + _r.y * w; o.pos[v + 2] = _p.z + _r.z * w;
        o.pos[v + 3] = _p.x - _r.x * w; o.pos[v + 4] = _p.y - _r.y * w; o.pos[v + 5] = _p.z - _r.z * w;
        o.col[v] = o.col[v + 3] = o.r * br; o.col[v + 1] = o.col[v + 4] = o.g * br; o.col[v + 2] = o.col[v + 5] = o.b * br;
      }
      o.pa.needsUpdate = true; o.ca.needsUpdate = true;
    }
  }

  clear() { for (const o of this.slots) { o.active = false; o.mesh.visible = false; } }

  dispose() {
    for (const o of this.slots) { this.scene.remove(o.mesh); o.geo.dispose(); }
    this.mat.dispose(); this.slots.length = 0;
  }
}
