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
export function beamDamage(hero, from, dir, len, width, damage, knock = 6, stun = 0.2, kind = 'beam', showNumbers = false) {
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
      const dealt = e.takeDamage?.(damage * (hero.dmgMul ?? 1), { knockback: kb, stun, source: hero, kind });
      if (showNumbers && dealt > 0) {
        hero.game.fx?.hitSpark?.(_w, 0xbff4ff, false);
        hero.game.fx?.text?.(_v.set(e.pos.x, e.pos.y + e.height + 0.4, e.pos.z), String(Math.round(dealt)), 0xffffff);
      }
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

// ============================================================================================
// v2 helpers: precision hits, aim assist, lock-on markers, pressure waves, craters, rainbow beam
// ============================================================================================
const _ai = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

/** y is the world height of the hit: above 82% of the enemy's height counts as a head hit. */
export const isHeadshot = (e, y) => !!e && y > e.pos.y + (e.height ?? 1.8) * 0.82;

/** Marks a precision hit. Applies +50% bonus damage on headshots (the base hit already landed). Returns true on crit. */
export function precisionHit(hero, e, point, baseDamage, opts = {}) {
  const g = hero.game;
  const crit = isHeadshot(e, point.y);
  if (crit && e.alive) {
    const kb = opts.knockback;
    e.takeDamage?.(baseDamage * 0.5 * (hero.dmgMul ?? 1), { knockback: kb, stun: 0.1, source: hero, kind: 'crit' });
    _c0.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z);
    g.fx?.text?.(_c0, 'CRITICAL', 0xffd24a, { size: 1.5, life: 1.1 });
    g.fx?.hitSpark?.(point, 0xffd24a, true);
    hero.addFocus?.(1.5);
  }
  g.hud?.hitMarker?.(crit);
  return crit;
}

/** Show/clear a reticle kind; remembers what this hero set so it never stomps on the weapons system. */
export function setReticle(hero, kind) {
  const g = hero.game;
  if (kind && g.weapons?.equipped) kind = null;
  if (hero._xh === kind) return;
  if (!kind && !hero._xh) return;
  hero._xh = kind || null;
  g.hud?.setCrosshair?.(kind || null);
}

/**
 * Aim assist. Reticle ray = camera centre. Finds the enemy nearest the ray (within assistDeg + its own size);
 * if the ray actually passes through the body keeps the true ray point (so headshots stay possible), otherwise
 * snaps to the chest. `from` is the muzzle. Returns { dir, point, target, dist, precise }.
 */
export function assistAim(hero, from, range = 80, assistDeg = 5, out = {}, exclude = null) {
  const g = hero.game;
  aimInfo(hero, range, _ai);
  out.dir = out.dir || new THREE.Vector3();
  out.point = out.point || new THREE.Vector3();
  out.target = null; out.precise = false;
  const cam = g.camera.position, cd = _ai.dir;
  const tan = Math.tan(THREE.MathUtils.degToRad(assistDeg));
  let best = null, bestScore = 1e9, bestPerp = 0, bestT = 0;
  for (const e of g.enemies?.list ?? []) {
    if (!e.alive || e === exclude || e.untargetable) continue;
    enemyCenter(e, _c1);
    _c2.subVectors(_c1, cam);
    const t = _c2.dot(cd);
    if (t < (g.cam.distance || 4) * 0.6 || t > range + 20) continue;
    _c2.addScaledVector(cd, -t);
    const perp = _c2.length();
    const allowed = (e.radius ?? 0.5) + 0.35 + t * tan;
    if (perp > allowed) continue;
    const score = perp / allowed;
    if (score < bestScore && g.physics.lineOfSight(from, _c1)) { best = e; bestScore = score; bestPerp = perp; bestT = t; }
  }
  if (best) {
    out.target = best;
    if (bestPerp <= (best.radius ?? 0.5) + 0.1) { out.point.copy(cam).addScaledVector(cd, bestT); out.precise = true; }
    else { enemyCenter(best, out.point); out.point.y = best.pos.y + best.height * 0.62; }
  } else out.point.copy(_ai.point);
  out.dir.subVectors(out.point, from);
  out.dist = out.dir.length(); if (out.dist > 1e-4) out.dir.divideScalar(out.dist); else out.dir.copy(cd);
  return out;
}

/** Enemies currently inside a screen-space cone around the reticle (angle in degrees), nearest to the centre first. */
export function enemiesInReticle(game, range = 80, coneDeg = 14, out = []) {
  out.length = 0;
  const cam = game.camera.position;
  const cd = game.cam.aimDirection(_c0).normalize();
  const cos = Math.cos(THREE.MathUtils.degToRad(coneDeg));
  const scored = [];
  for (const e of game.enemies?.list ?? []) {
    if (!e.alive || e.untargetable) continue;
    enemyCenter(e, _c1);
    _c2.subVectors(_c1, cam);
    const d = _c2.length(); if (d < 2 || d > range) continue;
    const dot = _c2.dot(cd) / d;
    if (dot < cos) continue;
    if (!game.physics.lineOfSight(cam, _c1)) continue;
    scored.push({ e, dot });
  }
  scored.sort((a, b) => b.dot - a.dot);
  for (const s of scored) out.push(s.e);
  return out;
}

/** Pool of screen-facing lock-on reticles (missile paint). */
export class LockMarkers {
  constructor(scene, n = 8) {
    this.scene = scene;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.strokeStyle = '#ff5a3c'; x.lineWidth = 7; x.lineCap = 'round';
    x.beginPath(); x.arc(64, 64, 40, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 9;
    for (let i = 0; i < 4; i++) { x.save(); x.translate(64, 64); x.rotate(i * Math.PI / 2); x.beginPath(); x.moveTo(-14, -58); x.lineTo(0, -46); x.lineTo(14, -58); x.stroke(); x.restore(); }
    x.fillStyle = '#ffd9c8'; x.beginPath(); x.arc(64, 64, 4, 0, Math.PI * 2); x.fill();
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.list = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
      const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 31; s.frustumCulled = false;
      scene.add(s); this.list.push(s);
    }
  }
  /** k = 0..1 lock-in progress (big and fading in -> small and solid). */
  set(i, pos, k, camPos) {
    const s = this.list[i]; if (!s) return;
    s.visible = true; s.position.copy(pos);
    const d = camPos ? pos.distanceTo(camPos) : 20;
    const base = clamp(d * 0.07, 0.8, 3.2);
    s.scale.setScalar(base * (1.9 - 0.9 * clamp(k, 0, 1)));
    s.material.opacity = 0.35 + 0.65 * clamp(k, 0, 1);
    s.material.rotation = (1 - clamp(k, 0, 1)) * 1.6;
  }
  hideFrom(n) { for (let i = n; i < this.list.length; i++) this.list[i].visible = false; }
  hideAll() { this.hideFrom(0); }
  dispose() { for (const s of this.list) { this.scene.remove(s); s.material.dispose(); } this.tex.dispose(); }
}

/** Expanding rim-lit dome: reads as a visible air-pressure ripple (thunderclap, ground pound). */
export class PressureWaves {
  constructor(scene, n = 4) {
    this.scene = scene; this.list = [];
    this.geo = new THREE.SphereGeometry(1, 28, 16);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 }, uC: { value: new THREE.Color(0xffffff) } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform float uA; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 1.8); gl_FragColor = vec4(uC, f*uA); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 10;
      scene.add(mesh);
      this.list.push({ mesh, mat, t: 0, life: 1, r: 1, on: false, squash: 1 });
    }
    this.cursor = 0;
  }
  spawn(pos, radius, color = 0xffffff, life = 0.55, squash = 0.55) {
    const o = this.list[this.cursor]; this.cursor = (this.cursor + 1) % this.list.length;
    o.on = true; o.t = 0; o.life = life; o.r = radius; o.squash = squash;
    o.mat.uniforms.uC.value.set(color); o.mat.uniforms.uA.value = 0.9;
    o.mesh.position.copy(pos); o.mesh.visible = true; o.mesh.scale.setScalar(0.2);
  }
  update(dt) {
    for (const o of this.list) {
      if (!o.on) continue;
      o.t += dt; const k = o.t / o.life;
      if (k >= 1) { o.on = false; o.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      const r = o.r * (0.1 + 0.9 * e);
      o.mesh.scale.set(r, r * o.squash, r);
      o.mat.uniforms.uA.value = 0.9 * (1 - k);
    }
  }
  clear() { for (const o of this.list) { o.on = false; o.mesh.visible = false; } }
  dispose() { for (const o of this.list) { this.scene.remove(o.mesh); o.mat.dispose(); } this.geo.dispose(); }
}

/** Ground crack decals that linger and fade (ground pound / super-jump landing). */
export class Craters {
  constructor(scene, n = 8) {
    this.scene = scene; this.list = [];
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(128, 128, 4, 128, 128, 126);
    gr.addColorStop(0, 'rgba(8,6,4,0.95)'); gr.addColorStop(0.55, 'rgba(20,16,12,0.8)'); gr.addColorStop(0.85, 'rgba(30,24,18,0.35)'); gr.addColorStop(1, 'rgba(30,24,18,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(0,0,0,0.9)'; x.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      let a = (i / 16) * Math.PI * 2 + Math.random() * 0.3, px = 128, py = 128;
      x.lineWidth = 3.5; x.beginPath(); x.moveTo(px, py);
      const segs = 4 + ((Math.random() * 4) | 0);
      for (let s = 0; s < segs; s++) { a += (Math.random() - 0.5) * 0.7; const l = 14 + Math.random() * 18; px += Math.cos(a) * l; py += Math.sin(a) * l; x.lineTo(px, py); x.lineWidth = Math.max(1, x.lineWidth - 0.5); }
      x.stroke();
    }
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.visible = false; mesh.renderOrder = 2; mesh.frustumCulled = false;
      scene.add(mesh); this.list.push({ mesh, mat, t: 0, life: 14, on: false });
    }
    this.cursor = 0;
  }
  spawn(pos, radius) {
    const o = this.list[this.cursor]; this.cursor = (this.cursor + 1) % this.list.length;
    o.on = true; o.t = 0; o.mesh.visible = true;
    o.mesh.position.set(pos.x, pos.y + 0.04 + this.cursor * 0.003, pos.z); o.mesh.rotation.y = Math.random() * 6.28;
    o.mesh.scale.setScalar(radius * 0.5); o.mat.opacity = 1;
  }
  update(dt) {
    for (const o of this.list) {
      if (!o.on) continue;
      o.t += dt;
      if (o.t >= o.life) { o.on = false; o.mesh.visible = false; continue; }
      o.mat.opacity = Math.min(1, (o.life - o.t) / 4);
    }
  }
  clear() { for (const o of this.list) { o.on = false; o.mesh.visible = false; } }
  dispose() { for (const o of this.list) { this.scene.remove(o.mesh); o.mat.dispose(); } this.geo.dispose(); this.tex.dispose(); }
}

const RAINBOW = [0xff3b3b, 0xff9b2e, 0xffe94a, 0x56e86a, 0x3fd8ff, 0x4a6bff, 0xb04aff];
/** Multicolour beam: seven parallel ribbons plus a white core. */
export function rainbowBeam(game, from, to, width = 0.5, life = 0.6) {
  const fx = game.fx; if (!fx) return;
  _c0.subVectors(to, from);
  if (_c0.lengthSq() < 1e-6) return;
  _c0.normalize();
  _c1.crossVectors(_c0, UP); if (_c1.lengthSq() < 1e-4) _c1.set(1, 0, 0); _c1.normalize();
  _c2.crossVectors(_c0, _c1).normalize();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < RAINBOW.length; i++) {
    const ang = (i / RAINBOW.length) * Math.PI * 2, off = width * 0.55;
    const ox = Math.cos(ang) * off, oy = Math.sin(ang) * off;
    a.copy(from).addScaledVector(_c1, ox).addScaledVector(_c2, oy);
    b.copy(to).addScaledVector(_c1, ox).addScaledVector(_c2, oy);
    fx.beam(a, b, RAINBOW[i], width * 0.5, life);
  }
  fx.beam(from, to, 0xffffff, width * 0.5, life * 0.8);
}

/** Chain lightning: from `start` jump to nearby enemies. Returns number of extra victims. */
export function chainLightning(hero, start, damage, jumps = 3, range = 9, color = 0x9fd8ff) {
  const g = hero.game; const seen = new Set([start]);
  let cur = start, n = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let j = 0; j < jumps; j++) {
    let best = null, bd = range;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || seen.has(e)) continue;
      const d = e.pos.distanceTo(cur.pos);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) break;
    seen.add(best);
    enemyCenter(cur, a); enemyCenter(best, b);
    g.fx?.lightning?.(a.clone(), b.clone(), color, 0.25, 2);
    const kb = b.clone().sub(a).setY(0).normalize().multiplyScalar(5); kb.y = 3;
    best.takeDamage?.(damage * (hero.dmgMul ?? 1), { knockback: kb, stun: 0.6, source: hero, kind: 'lightning' });
    g.fx?.hitSpark?.(b, color, false);
    g.fx?.text?.(b.clone().setY(best.pos.y + best.height + 0.4), String(Math.round(damage * (hero.dmgMul ?? 1))), color);
    cur = best; n++;
  }
  return n;
}

/** Short hit-stop (does nothing if a longer slow-mo is already running). */
export function hitStop(game, seconds = 0.05, scale = 0.06) {
  if ((game._slowmo ?? 0) <= 0.05) game.slowmo?.(seconds, scale);
}

/** FOV punch that decays by itself: add to a hero-owned `fov` accumulator. */
export const approachVal = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
