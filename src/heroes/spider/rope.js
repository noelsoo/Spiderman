// Webline renderer: a thin tapered white tube that sags while slack, then snaps taut.
//   begin()                      start a "thwip": the head races from the hand to the target in ~0.07 s with a whip wobble
//   update(dt, a, b, tense = 1)  a = hand, b = anchor; tense 0..1 pulls the sag out (swing / zip are taut, pulls are looser)
//   hide()
import * as THREE from 'three';

const _d = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _p = new THREE.Vector3();
const SHOOT_TIME = 0.075;

export class RopeLine {
  constructor(scene, { radius = 0.032, tip = 0.012, segs = 16, sides = 4, color = 0xffffff, opacity = 0.95 } = {}) {
    this.segs = segs; this.sides = sides; this.radius = radius; this.tip = tip;
    const nV = (segs + 1) * sides;
    this.pos = new Float32Array(nV * 3);
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.shootT = SHOOT_TIME; this.slack = 0; this.t = 0; this.phase = Math.random() * 6;
  }

  begin(slack = 1) { this.shootT = 0; this.slack = slack; this.phase = Math.random() * 6; }
  hide() { this.mesh.visible = false; }
  get visible() { return this.mesh.visible; }

  update(dt, a, b, tense = 1) {
    _d.subVectors(b, a); const len = _d.length();
    if (len < 0.08) { this.mesh.visible = false; return; }
    _d.multiplyScalar(1 / len);
    this.t += dt;
    const shooting = this.shootT < SHOOT_TIME;
    this.shootT += dt;
    const head = shooting ? Math.min(1, this.shootT / SHOOT_TIME) : 1;
    // slack relaxes toward taut; a taut rope (tense=1) has none
    this.slack = Math.max(0, this.slack - dt * (shooting ? 1.5 : 4.2));
    const slack = Math.min(this.slack, 1 - tense * 0.92);
    const sag = slack * Math.min(len, 60) * 0.085 + (1 - tense) * Math.min(len, 40) * 0.012;
    const wob = shooting ? (1 - head) * 0.35 + 0.1 : slack * 0.25;
    // frame
    _u.set(-_d.z, 0, _d.x); if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0); _u.normalize();
    _v.crossVectors(_d, _u).normalize();
    const n = this.segs, S = this.sides, P = this.pos;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const s2 = s * head;
      _p.copy(a).addScaledVector(_d, len * s2);
      const arc = 4 * s * (1 - s);
      _p.y -= sag * arc;
      const w = Math.sin(s * Math.PI * 3 + this.t * 38 + this.phase) * wob * arc * Math.min(1.2, len * 0.05);
      _p.addScaledVector(_u, w);
      _p.y += Math.cos(s * Math.PI * 2.3 + this.t * 31) * wob * arc * 0.5;
      const r = (this.radius + (this.tip - this.radius) * s) * (1 + len * 0.004);
      for (let j = 0; j < S; j++) {
        const ang = (j / S) * Math.PI * 2 + Math.PI / 4;
        const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
        const o = (i * S + j) * 3;
        P[o] = _p.x + _u.x * ca + _v.x * sa; P[o + 1] = _p.y + _u.y * ca + _v.y * sa; P[o + 2] = _p.z + _u.z * ca + _v.z * sa;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mesh.visible = true;
  }
}
