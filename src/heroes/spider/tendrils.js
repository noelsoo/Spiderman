// Pooled animated symbiote tendrils: glossy black tapered tubes that whip out, wiggle, hold and retract.
//   pool.spawn({ from, to, life, grow, width, wiggle, delay, arc })   from/to: Vector3 or (out) => Vector3 (live follow)
//   pool.update(dt)
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _p = new THREE.Vector3();
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

let MAT = null;
function material() {
  return MAT || (MAT = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.16, metalness: 0.4, emissive: 0x2a0a55, emissiveIntensity: 0.45 }));
}

class Tendril {
  constructor(scene, segs, sides) {
    this.segs = segs; this.sides = sides;
    this.P = new Float32Array((segs + 1) * sides * 3);
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material());
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
    this.active = false;
  }
}

export class TendrilPool {
  constructor(scene, count = 30, segs = 18, sides = 6) {
    this.list = [];
    for (let i = 0; i < count; i++) this.list.push(new Tendril(scene, segs, sides));
    this.cursor = 0; this.time = 0;
  }

  spawn(o) {
    let t = null;
    for (let k = 0; k < this.list.length; k++) { const c = this.list[(this.cursor + k) % this.list.length]; if (!c.active) { t = c; this.cursor = (this.cursor + k + 1) % this.list.length; break; } }
    if (!t) { t = this.list[this.cursor]; this.cursor = (this.cursor + 1) % this.list.length; }
    t.active = true; t.age = -(o.delay ?? 0); t.life = o.life ?? 0.5; t.grow = o.grow ?? 0.12;
    t.width = o.width ?? 0.12; t.wiggle = o.wiggle ?? 0.6; t.arc = o.arc ?? 0.12; t.seed = Math.random() * 10;
    t.from = o.from; t.to = o.to; t.retract = o.retract ?? Math.min(0.2, (o.life ?? 0.5) * 0.4);
    t.fp = new THREE.Vector3(); t.tp = new THREE.Vector3();
    t.mesh.visible = false;
    return t;
  }

  _resolve(src, out, fallback) {
    if (typeof src === 'function') { const r = src(out); if (r && r !== out) out.copy(r); }
    else if (src) out.copy(src); else out.copy(fallback);
    return out;
  }

  update(dt) {
    this.time += dt;
    for (const t of this.list) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age < 0) continue;
      if (t.age >= t.life) { t.active = false; t.mesh.visible = false; continue; }
      this._resolve(t.from, t.fp, t.fp); this._resolve(t.to, t.tp, t.tp);
      const head = ease(t.age / t.grow);
      const tail = t.age > t.life - t.retract ? ease((t.age - (t.life - t.retract)) / t.retract) : 0;
      _dir.subVectors(t.tp, t.fp); const len = _dir.length();
      if (len < 0.05) { t.mesh.visible = false; continue; }
      _dir.multiplyScalar(1 / len);
      _u.set(-_dir.z, 0, _dir.x); if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0); _u.normalize();
      _v.crossVectors(_dir, _u).normalize();
      const n = t.segs, S = t.sides, P = t.P;
      const settle = 1 - 0.55 * ease((t.age - t.grow) / 0.2);   // whips wildly, then steadies
      for (let i = 0; i <= n; i++) {
        const s = tail + (head - tail) * (i / n);              // position along the full path
        const loc = i / n;                                      // position along the visible part
        _p.copy(t.fp).addScaledVector(_dir, len * s);
        const env = Math.sin(Math.PI * Math.min(1, s)) * Math.min(len * 0.1, 1.4) * t.wiggle * settle;
        const ph = s * 9 + this.time * 14 + t.seed;
        _p.addScaledVector(_u, Math.sin(ph) * env).addScaledVector(_v, Math.cos(ph * 0.8) * env * 0.8);
        _p.y += Math.sin(Math.PI * s) * len * t.arc;
        const r = t.width * (1 - 0.9 * loc) * (0.35 + 0.65 * Math.min(1, (head - tail) * 3)) + 0.012;
        for (let j = 0; j < S; j++) {
          const ang = (j / S) * Math.PI * 2;
          const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
          const o = (i * S + j) * 3;
          P[o] = _p.x + _u.x * ca + _v.x * sa; P[o + 1] = _p.y + _u.y * ca + _v.y * sa; P[o + 2] = _p.z + _u.z * ca + _v.z * sa;
        }
      }
      t.mesh.geometry.attributes.position.needsUpdate = true;
      t.mesh.visible = true;
    }
  }

  clear() { for (const t of this.list) { t.active = false; t.mesh.visible = false; } }
}
