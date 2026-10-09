// Shared helpers for the Avengers (Iron Man, Hulk, Thor). Everything here is defensive:
// optional model extras / stub subsystems must never throw.
import * as THREE from 'three';

export const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const rand = (a, b) => a + Math.random() * (b - a);

/** World position of an attach point, falling back to `fb` (a Vector3). */
export function objPos(obj, out, fb) {
  if (obj && obj.getWorldPosition) { obj.updateWorldMatrix?.(true, false); return obj.getWorldPosition(out); }
  return out.copy(fb);
}

/** Camera aim: ray from the camera (skipping the hero side of it) into the world. */
export function aimInfo(hero, range = 80, out = {}) {
  const g = hero.game;
  out.dir = out.dir || new THREE.Vector3();
  out.point = out.point || new THREE.Vector3();
  g.cam.aimDirection(out.dir).normalize();
  _v.copy(g.camera.position).addScaledVector(out.dir, g.cam.distance || 6);
  const hit = g.physics.raycast(_v, out.dir, range + 20);
  if (hit) out.point.copy(hit.point); else out.point.copy(_v).addScaledVector(out.dir, range + 20);
  out.hit = hit;
  return out;
}

/** Living enemies within r of pos, nearest first. */
export function enemiesNear(game, pos, r) {
  const list = game.enemies?.list ?? [];
  const out = [];
  for (const e of list) {
    if (!e.alive) continue;
    const d = e.pos.distanceTo(pos);
    if (d <= r) out.push({ e, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.map((o) => o.e);
}

export function enemyCenter(e, out) {
  if (e.center) return out.copy(e.center);
  out.copy(e.pos); out.y += (e.height ?? 1.8) * 0.55;
  return out;
}

/** Damage every enemy within `width` of a line segment. Returns the number hit. */
export function beamDamage(hero, from, dir, len, width, damage, knock = 6, stun = 0.2, kind = 'beam') {
  const list = hero.game.enemies?.list ?? [];
  let n = 0;
  for (const e of list) {
    if (!e.alive) continue;
    enemyCenter(e, _w);
    _v.subVectors(_w, from);
    const t = clamp(_v.dot(dir), 0, len);
    _v.copy(from).addScaledVector(dir, t);
    const d = _v.distanceTo(_w);
    if (d < width + (e.radius ?? 0.5)) {
      const kb = dir.clone().multiplyScalar(knock); kb.y += 2;
      e.takeDamage?.(damage * (hero.dmgMul ?? 1), { knockback: kb, stun, source: hero, kind });
      n++;
    }
  }
  return n;
}

export function rumble(game, strong, weak, ms) { game.input?.rumble?.(strong, weak, ms); }

/** Tilt the model about its centre (for flight). Needs model.customRotation = true. */
export function applyTilt(hero, pitch, roll = 0) {
  const g = hero.model.group;
  g.rotation.order = 'YXZ';
  g.rotation.set(pitch, hero.yaw, roll);
  const h = hero.height * 0.5;
  _e.copy(g.rotation);
  _v.set(0, h, 0).applyEuler(_e);
  g.position.set(hero.pos.x + (0 - _v.x), hero.pos.y + h - _v.y, hero.pos.z + (0 - _v.z));
}

/** Tiny delayed-call scheduler (scaled dt). */
export class Timers {
  constructor() { this.list = []; }
  after(sec, fn) { this.list.push({ t: sec, fn }); }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i]; it.t -= dt;
      if (it.t <= 0) { this.list.splice(i, 1); try { it.fn(); } catch (e) { console.error(e); } }
    }
  }
  clear() { this.list.length = 0; }
}

/** Additive glowing beam between two points (unibeam). */
export class BeamMesh {
  constructor(scene, color = 0x9fe8ff) {
    this.scene = scene;
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, true).rotateX(Math.PI / 2);
    const mk = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(geo, mk(0xffffff, 0.95));
    this.glow = new THREE.Mesh(geo, mk(color, 0.45));
    this.group.add(this.glow, this.core);
    this.core.frustumCulled = this.glow.frustumCulled = false;
    this.group.visible = false;
    scene.add(this.group);
    this.geo = geo;
  }
  show(from, to, width, flicker = 0.12) {
    const len = from.distanceTo(to);
    this.group.visible = true;
    this.group.position.copy(from).lerp(to, 0.5);
    this.group.lookAt(to);
    const f = 1 + (Math.random() - 0.5) * flicker;
    this.core.scale.set(width * 0.45 * f, width * 0.45 * f, len);
    this.glow.scale.set(width * f, width * f, len);
  }
  hide() { this.group.visible = false; }
  dispose() {
    this.scene.remove(this.group);
    this.geo.dispose(); this.core.material.dispose(); this.glow.material.dispose();
  }
}

/** Soft additive sprite glow. */
export class GlowSprite {
  constructor(scene, color = 0xffcc66) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.mat = new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.visible = false;
    this.scene = scene;
    scene.add(this.sprite);
  }
  set(pos, size, opacity) {
    this.sprite.visible = opacity > 0.01;
    this.sprite.position.copy(pos);
    this.sprite.scale.setScalar(size);
    this.mat.opacity = opacity;
  }
  dispose() { this.scene.remove(this.sprite); this.mat.dispose(); this.tex.dispose(); }
}

/** Ground-level impact visuals shared by landings and slams. */
export function impactFx(game, pos, radius, color, shake = 0.5) {
  game.fx?.shockwave?.(pos.clone(), radius, color);
  game.fx?.ring?.(pos.clone().setY(pos.y + 0.1), radius, color, 0.6);
  game.fx?.burst?.(pos.clone().setY(pos.y + 0.3), color, 30, 7, 0.7, 0.3);
  game.cam?.shake?.(shake);
}
