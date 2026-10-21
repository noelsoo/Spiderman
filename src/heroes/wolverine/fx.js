// Wolverine visual helpers: claw slash trails, wall dig marks, visible wounds + steam, feral-sense overlay.
// All pooled: nothing is created per hit, everything is disposed with dispose().
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Claw slash trails: a three-blade crescent that sweeps open then fades.
let SLASH_TEX = null;
function slashTex() {
  if (SLASH_TEX) return SLASH_TEX;
  const c = document.createElement('canvas'); c.width = 128; c.height = 8;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0);          // u runs tail (0) -> head (1)
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 8);
  SLASH_TEX = new THREE.CanvasTexture(c);
  return SLASH_TEX;
}

function slashGeometry(segs, R, arc) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let s = 0; s <= segs; s++) {
    const f = s / segs, a = (f - 0.5) * arc;
    const w = 0.03 + 0.15 * Math.sin(Math.PI * Math.min(1, f * 1.1));
    for (let c = 0; c < 3; c++) {
      const y = (c - 1) * 0.15 + Math.sin(f * Math.PI) * 0.1 * (c - 1);
      for (const r of [R - w, R + w]) {
        pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
        uv.push(f, r > R ? 1 : 0);
        nor.push(0, 1, 0);
      }
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let c = 0; c < 3; c++) {
      const a = (s * 3 + c) * 2, b = ((s + 1) * 3 + c) * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
  return geo;
}

export class SlashPool {
  constructor(scene, n = 6, segs = 16) {
    this.scene = scene; this.segs = segs; this.items = []; this.cursor = 0;
    this.tex = slashTex();
    for (let i = 0; i < n; i++) {
      const geo = slashGeometry(segs, 2.0, 2.5);
      const mat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.rotation.order = 'YXZ';
      scene.add(mesh);
      this.items.push({ mesh, mat, geo, t: 0, life: 0.25, active: false });
    }
  }
  /** center: world point; yaw: facing; tilt: roll of the cut plane (rad); flip: sweep direction. */
  slash(center, yaw, { tilt = 0.5, flip = false, color = 0xe8f0ff, scale = 1, life = 0.26, forward = 0.35 } = {}) {
    const o = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length;
    o.active = true; o.t = 0; o.life = life;
    o.mat.color.set(color); o.mat.opacity = 1;
    o.mesh.position.set(center.x + Math.sin(yaw) * forward, center.y, center.z + Math.cos(yaw) * forward);
    o.mesh.rotation.set(0, yaw, flip ? -tilt : tilt);
    o.mesh.scale.set(flip ? -scale : scale, scale, scale);
    o.geo.setDrawRange(0, 0);
    o.mesh.visible = true;
  }
  update(dt) {
    for (const o of this.items) {
      if (!o.active) continue;
      o.t += dt;
      const f = o.t / o.life;
      if (f >= 1) { o.active = false; o.mesh.visible = false; continue; }
      const reveal = Math.min(1, f / 0.4);
      o.geo.setDrawRange(0, Math.max(0, Math.floor(reveal * this.segs)) * 18);
      o.mat.opacity = f < 0.4 ? 1 : 1 - (f - 0.4) / 0.6;
    }
  }
  clear() { for (const o of this.items) { o.active = false; o.mesh.visible = false; } }
  dispose() {
    for (const o of this.items) { this.scene.remove(o.mesh); o.geo.dispose(); o.mat.dispose(); }
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Claw-dig marks left on walls while climbing (ring buffer of dark gashes).
export class DigMarks {
  constructor(scene, n = 28) {
    this.scene = scene; this.items = []; this.cursor = 0;
    this.geo = new THREE.PlaneGeometry(0.05, 0.42);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.visible = false; scene.add(m);
      this.items.push({ m, t: 0 });
    }
  }
  add(point, normal) {
    for (let k = -1; k <= 1; k++) {
      const o = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length;
      o.t = 9; o.m.visible = true;
      o.m.position.copy(point).addScaledVector(normal, 0.03);
      o.m.position.x += -normal.z * 0.09 * k; o.m.position.z += normal.x * 0.09 * k;
      o.m.lookAt(o.m.position.x + normal.x, o.m.position.y + normal.y, o.m.position.z + normal.z);
      o.m.rotateZ(0.12 * k);
    }
  }
  update(dt) { for (const o of this.items) if (o.t > 0) { o.t -= dt; if (o.t <= 0) o.m.visible = false; } }
  clear() { for (const o of this.items) { o.t = 0; o.m.visible = false; } }
  dispose() { for (const o of this.items) this.scene.remove(o.m); this.geo.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------------------------
// Wounds: gashes on the body that fade out as the healing factor knits them shut (with steam).
export class Wounds {
  constructor(model, height = 1.65) {
    this.model = model; this.items = [];
    this.geo = new THREE.PlaneGeometry(0.3, 0.05);
    const spots = [[0.1, 0.62, 0.19, 0.5], [-0.12, 0.74, 0.18, -0.6], [0.05, 0.5, 0.17, 0.2], [0.27, 0.7, 0.05, 1.2], [-0.27, 0.62, 0.04, -1.1], [-0.08, 0.86, 0.15, 0.9], [0.1, 0.7, -0.2, -0.4], [-0.1, 0.55, -0.2, 0.5], [0.06, 0.85, -0.18, 1.0]];
    this.group = new THREE.Group();
    for (const [x, y, z, rz] of spots) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xb01010, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.geo, mat);
      m.position.set(x, y * height, z); m.rotation.z = rz;
      if (Math.abs(x) > 0.2) m.rotation.y = Math.PI / 2 * Math.sign(x);
      this.group.add(m); this.items.push({ m, mat });
    }
    model.group.add(this.group);
    this.steamT = 0;
  }
  /** hpFrac 0..1; healing: bool. Returns number of visible wounds. */
  update(dt, hpFrac, healing, game, hero) {
    const missing = Math.max(0, 1 - hpFrac);
    let shown = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const target = Math.max(0, Math.min(1, missing * 1.9 - i * 0.14));
      it.mat.opacity += (target - it.mat.opacity) * Math.min(1, 6 * dt);
      if (it.mat.opacity > 0.03) shown++;
      // healing: gash turns pink/green then closes up
      it.mat.color.setHex(healing ? 0xff7a8a : 0xb01010);
      it.m.scale.x = healing ? 0.55 + 0.45 * target : 1;
    }
    if (healing && shown && game.fx) {
      this.steamT -= dt;
      if (this.steamT <= 0) {
        this.steamT = 0.09;
        const it = this.items[(Math.random() * shown) | 0] ?? this.items[0];
        it.m.getWorldPosition(_p);
        game.fx.smoke(_p, 0.42, 0.9, _up, 0.82);          // pale steam wisps rising off the knitting wounds
        if (Math.random() < 0.5) game.fx.burst(_p, 0x7dffa0, 2, 1.4, 0.45, 0.1);
      }
    }
    return shown;
  }
  hide() { for (const it of this.items) it.mat.opacity = 0; }
  dispose() { this.model.group.remove(this.group); this.geo.dispose(); for (const it of this.items) it.mat.dispose(); }
}
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0.8, 0);

// ---------------------------------------------------------------------------------------------
// Feral sense: pooled x-ray silhouettes (depthTest off) over every enemy + a scent line to the nearest.
export class SenseOverlay {
  constructor(scene) {
    this.scene = scene; this.items = []; this.on = false; this.t = 0;
    this.geo = new THREE.CapsuleGeometry(0.5, 0.9, 4, 10);
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.matE = new THREE.MeshBasicMaterial({ color: 0xff3a22, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.matB = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.wire = new THREE.MeshBasicMaterial({ color: 0xffd8b0, wireframe: true, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, toneMapped: false });
  }
  _item(i) {
    if (this.items[i]) return this.items[i];
    const g = new THREE.Group();
    const fill = new THREE.Mesh(this.geo, this.matE), wire = new THREE.Mesh(this.geo, this.wire);
    fill.renderOrder = wire.renderOrder = 998; fill.frustumCulled = wire.frustumCulled = false;
    wire.scale.setScalar(1.03);
    g.add(fill, wire); this.group.add(g);
    return (this.items[i] = { g, fill });
  }
  /** list: living enemies. center: hero position (for distance fade). */
  update(dt, enemies, center, range, active) {
    this.on = active; this.t += dt;
    this.group.visible = active;
    if (!active) return;
    let n = 0;
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 7);
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(center);
      if (d > range) continue;
      const it = this._item(n++);
      it.g.visible = true;
      const h = e.height ?? 1.85, r = e.radius ?? 0.45;
      it.g.position.set(e.pos.x, e.pos.y + h * 0.5, e.pos.z);
      it.g.scale.set(r * 1.9, h / 1.9, r * 1.9);
      it.fill.material = e.isBoss ? this.matB : this.matE;
    }
    for (let i = n; i < this.items.length; i++) this.items[i].g.visible = false;
    this.matE.opacity = 0.26 * pulse + 0.14; this.matB.opacity = this.matE.opacity;
  }
  hide() { this.group.visible = false; this.on = false; }
  dispose() {
    this.scene.remove(this.group);
    this.geo.dispose(); this.matE.dispose(); this.matB.dispose(); this.wire.dispose();
  }
}
