// Spider-Man 2 style traversal + combat extras, split out of SpiderMan.js:
//   ParryIndicator  timed ring over attackers: yellow (wind-up) then RED (parry now); cyan = unaware, stealth takedown ready
//   WindField       street-canyon wind tunnels / updrafts for Web Wings (+ visible wind streaks)
//   webStrike       zip-pull to an enemy and hit                    swingKick      kick an enemy while swinging
//   airLauncher     uppercut that pops an enemy up, juggle hover    stealthTakedown  perch -> web strike on an unaware enemy
//   focusFinisher   cinematic finisher that spends one focus bar    PropThrow      grab a nearby object with webs and hurl it
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
export const PARRY_RED = 0.22;     // wind-up seconds left at which the ring turns red (parry window)

// ======================================================================================= parry / stealth indicator
let RING_TEX = null;
function ringTexture() {
  if (RING_TEX) return RING_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.strokeStyle = '#fff'; x.lineWidth = 7; x.beginPath(); x.arc(32, 32, 24, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 7, 0, Math.PI * 2); x.fill();
  RING_TEX = new THREE.CanvasTexture(c);
  return RING_TEX;
}

export class ParryIndicator {
  constructor(h, n = 10) {
    this.h = h; this.items = []; this.scan = 0; this.shown = 0;
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: ringTexture(), transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
      const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 20; s.frustumCulled = false;
      h.game.scene.add(s); this.items.push(s);
    }
    this.red = 0;   // number of attackers currently in the red window (tests / HUD)
  }
  hide() { for (const s of this.items) s.visible = false; this.red = 0; this.shown = 0; }
  update(dt) {
    const h = this.h, g = h.game;
    let n = 0, red = 0;
    const stealth = h.canStealth?.() ?? false;
    for (const e of g.enemies?.list ?? []) {
      if (n >= this.items.length) break;
      if (!e.alive) continue;
      const wind = e.windup > 0;
      const unaware = !wind && stealth && h.unaware(e);
      if (!wind && !unaware) continue;
      const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z, d2 = dx * dx + dz * dz;
      if (d2 > (unaware ? 32 * 32 : 20 * 20)) continue;
      const s = this.items[n++];
      s.visible = true; s.position.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z);
      if (unaware) { s.material.color.setHex(0x4fe0ff); s.scale.setScalar(0.7); continue; }
      const isRed = e.windup <= PARRY_RED;
      if (isRed) red++;
      s.material.color.setHex(isRed ? 0xff2a1a : 0xffd21a);
      const pulse = isRed ? 1 + 0.25 * Math.sin(g.time * 40) : 1 + 0.1 * Math.sin(g.time * 18);
      s.scale.setScalar((isRed ? 1.5 : 1.1) * pulse);
    }
    for (let i = n; i < this.items.length; i++) this.items[i].visible = false;
    this.shown = n; this.red = red;
  }
}

// ======================================================================================= wind tunnels / updrafts
export class WindField {
  constructor(h) {
    this.h = h; this.t = 0; this.strength = 0; this.up = 0; this.along = 0; this.tunnel = false;
    const N = 36;
    this.pos = new Float32Array(N * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 6;
    h.game.scene.add(this.mesh);
    this.seeds = Array.from({ length: N }, () => ({ s: Math.random(), l: Math.random(), u: Math.random() }));
    this.k = 0; this.dir = new THREE.Vector3(0, 0, 1); this.side = new THREE.Vector3(1, 0, 0);
  }
  reset() { this.strength = 0; this.up = 0; this.along = 0; this.tunnel = false; this.k = 0; this.mesh.visible = false; }
  /** Probe the street canyon around a gliding hero; returns {up, along} m/s assists (0 outside a canyon). */
  probe(dt, glide) {
    const h = this.h, ph = h.game.physics;
    this.t -= dt;
    if (!glide) { this.strength = Math.max(0, this.strength - dt * 2); }
    else if (this.t <= 0) {
      this.t = 0.12;
      const hs = Math.hypot(h.vel.x, h.vel.z) || 1;
      _a.set(h.vel.x / hs, 0, h.vel.z / hs); this.dir.copy(_a);
      _b.set(-_a.z, 0, _a.x); this.side.copy(_b);
      _c.set(h.pos.x, h.pos.y + 1, h.pos.z);
      const l = ph.raycast(_c, _b, 30, { ignoreGround: true }), r = ph.raycast(_c, _d.copy(_b).negate(), 30, { ignoreGround: true });
      let s = 0;
      if (l && r && h.pos.y < 130) {
        const w = l.distance + r.distance;       // canyon width
        s = clamp(1.15 - w / 52, 0.25, 1);       // narrow streets funnel harder
        // only above the street surface: a hero below roof level, not above the rooftops
        const roof = Math.min(l.box?.max.y ?? 99, r.box?.max.y ?? 99);
        if (h.pos.y > roof + 6) s = 0;
      }
      this.tunnel = s > 0; this.target = s;
    }
    const target = glide ? (this.target || 0) : 0;
    this.strength += (target - this.strength) * Math.min(1, 5 * dt);
    this.up = 6.5 * this.strength; this.along = 8 * this.strength;
    return this;
  }
  update(dt, glide) {
    this.k += ((glide && this.strength > 0.05 ? 1 : 0) - this.k) * Math.min(1, 6 * dt);
    if (this.k < 0.03) { this.mesh.visible = false; return; }
    this.mesh.visible = true; this.mesh.material.opacity = 0.55 * this.k;
    const h = this.h, P = this.pos, t = h.game.time;
    for (let i = 0; i < this.seeds.length; i++) {
      const S = this.seeds[i];
      const f = (S.s + t * (0.9 + S.l * 0.6)) % 1;          // runs along the street
      const ahead = (f * 60 - 14), lat = (S.l - 0.5) * 20, ht = (S.u - 0.3) * 16;
      _a.set(h.pos.x + this.dir.x * ahead + this.side.x * lat, h.pos.y + ht + f * 5, h.pos.z + this.dir.z * ahead + this.side.z * lat);
      const len = 3 + S.u * 3;
      P[i * 6] = _a.x; P[i * 6 + 1] = _a.y; P[i * 6 + 2] = _a.z;
      P[i * 6 + 3] = _a.x + this.dir.x * len; P[i * 6 + 4] = _a.y + len * 0.15; P[i * 6 + 5] = _a.z + this.dir.z * len;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// ======================================================================================= web strike / kicks / launcher
/** Zip to an enemy on a web and hit it. */
export function webStrike(h, e, { stealth = false } = {}) {
  if (!stealth && !h.useCooldown('webstrike', 1.2)) return false;
  const mul = h._dmgMul();
  h.atk = null; h.spin = null; h.charging = false; h.sling = null;
  h.lash = { kind: 'webstrike', t: 0, dir: h.forward, dur: 1.2, pulse: 99 };
  h.pullTarget = e; h.pullLineT = 0.5; h.lines.pull.begin(0.4);
  h.setAnim('zip', 20); h._play('thwip'); h._play('zip', { volume: 0.5 });
  let t = 0;
  h._task((dt) => {
    t += dt;
    if (h.lash?.kind !== 'webstrike' || h.dead) return true;
    if (!e.alive && t > 0.05) { h.lash = null; return true; }
    _a.set(e.pos.x - h.pos.x, e.pos.y - h.pos.y, e.pos.z - h.pos.z); const d = _a.length();
    h.yaw = Math.atan2(_a.x, _a.z); h.invuln = Math.max(h.invuln, 0.12); h.pullLineT = 0.3;
    if (d > 1.9 && t < 0.9) {
      _a.multiplyScalar(1 / d); const sp = Math.min(70, Math.max(10, (d - 1.5) / Math.max(dt, 1e-3)));
      h.vel.copy(_a).multiplyScalar(sp); h.gravityScale = 0; h._leanPose?.(_a, 1.1, 0, 12);
      return false;
    }
    h.gravityScale = 1; h.vel.multiplyScalar(0.2); h.vel.y = Math.max(h.vel.y, 2);
    const p = e.center.clone();
    if (stealth) {
      if (e.isBoss) h._hit(e, e.maxHp * 0.08, { stun: 0.6, kind: 'web', point: p });
      else h._hit(e, e.maxHp + 5, { stun: 2, kind: 'stealth', heavy: true, point: p, kb: _b.set(Math.sin(h.yaw) * 4, 4, Math.cos(h.yaw) * 4).clone() });
      h._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 1, e.pos.z), 'STEALTH TAKEDOWN', 0x4fe0ff, { size: 1.3, life: 1.1 });
      h.addFocus(15); h.game.slowmo?.(0.25, 0.3);
    } else {
      h._hit(e, 22 * mul, { stun: e.isBoss ? 0.6 : 1.2, kind: 'web', heavy: true, point: p, kb: _b.set(Math.sin(h.yaw) * 8, 6, Math.cos(h.yaw) * 8).clone() });
      h._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 1, e.pos.z), 'WEB STRIKE', 0xffffff, { size: 1.1, life: 0.8 });
    }
    h._fx('hitSpark', p, 0xffffff, true); h._fx('burst', p, 0xffffff, 14, 6, 0.3, 0.15);
    h._impact(0.7); h._play('heavyhit', { pos: e.pos }); h.game.hud?.hitMarker?.(true);
    h.setAnim('kick', 1.2); h.lash.dur = 0.2; h.pullLineT = 0;
    return true;
  });
  return true;
}

/** Attack pressed while swinging: kick the nearest enemy near the arc (or swing-kick forward). */
export function swingKick(h) {
  if (!h.useCooldown('swingkick', 0.9)) return false;
  const mul = h._dmgMul();
  let best = null, bd = 16 * 16;
  for (const e of h.game.enemies?.list ?? []) {
    if (!e.alive || e.untargetable) continue;
    const dx = e.pos.x - h.pos.x, dy = e.pos.y - h.pos.y, dz = e.pos.z - h.pos.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bd) { bd = d2; best = e; }
  }
  const dir = _d.set(h.vel.x, 0, h.vel.z); if (dir.lengthSq() < 1) dir.set(Math.sin(h.yaw), 0, Math.cos(h.yaw)); dir.normalize();
  if (best) { _a.set(best.pos.x - h.pos.x, 0, best.pos.z - h.pos.z).normalize(); dir.lerp(_a, 0.85).normalize(); }
  const kd = dir.clone();
  const sp = Math.max(24, h.vel.length());
  h._endSwing(false); h.swingLock = 0.2;
  h.vel.x = kd.x * sp; h.vel.z = kd.z * sp; h.vel.y = best ? clamp((best.pos.y - h.pos.y) * 3, -8, 10) : Math.max(h.vel.y, 1);
  h.yaw = Math.atan2(kd.x, kd.z); h.setAnim('kick', 1.4); h.shootT = 0;
  h._play('whoosh', { pitch: 1.2 }); h._fx('text', _a.set(h.pos.x, h.pos.y + 2.4, h.pos.z), 'SWING KICK', 0xffffff, { size: 1, life: 0.7 });
  let t = 0;
  h._task((dt) => {
    t += dt;
    if (h.dead || t > 0.45) return true;
    const o = h._center(_b), hits = h.game.combat?.melee?.({ origin: o, forward: kd, range: 3.6, arc: 150, damage: 24 * mul, knockback: 16, up: 4, stun: 1.0, heavy: true, source: h, team: 'player' }) || [];
    if (hits.length) {
      for (const e of hits) { h._fx('hitSpark', e.center, 0xffffff, true); h._fx('burst', e.center, 0xffffff, 12, 6, 0.3, 0.15); }
      h._impact(0.7); h._play('heavyhit'); h.game.hud?.hitMarker?.(false); h.vel.x *= 0.5; h.vel.z *= 0.5;
      return true;
    }
    return false;
  });
  return true;
}

/** Hold attack next to an enemy: uppercut launcher; you and the enemy rise, it hangs in the air for an air combo. */
export function airLauncher(h, e) {
  if (!h.useCooldown('launcher', 1.8)) return false;
  const mul = h._dmgMul();
  _a.set(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z); const d = _a.length() || 1; _a.multiplyScalar(1 / d);
  h.yaw = Math.atan2(_a.x, _a.z); h.atk = { step: 3, t: 0, dur: 0.5, hitAt: 99, hit: true, queued: false, air: false, special: true };
  h.setAnim('uppercut', 1.2); h._play('whoosh');
  h.vel.x = _a.x * clamp((d - 1.2) / 0.1, 0, 20); h.vel.z = _a.z * clamp((d - 1.2) / 0.1, 0, 20);
  h._later(0.1, () => {
    if (!e.alive) return;
    const p = e.center.clone();
    h._hit(e, 14 * mul, { stun: e.isBoss ? 0.6 : 2.2, kind: 'launcher', heavy: true, point: p, kb: _b.set(0, 0, 0).clone() });
    h._fx('text', _c.set(e.pos.x, e.pos.y + e.height + 1, e.pos.z), 'LAUNCHER', 0xffffff, { size: 1.1, life: 0.8 });
    h._fx('hitSpark', p, 0xffffff, true); h._fx('ring', p, 2, 0xffffff, 0.3);
    h._impact(0.6); h._play('heavyhit', { pos: e.pos });
    if (e.isBoss) return;
    e.launch?.({}); e.vel.y = 15; e.onGround = false; e.launched = true;
    h.vel.y = 15; h.onGround = false; h.groundT = 1; h.atk = null; h.setAnim('jump', 8);
    let t = 0;
    h._task((dt) => {       // juggle: the enemy hovers (reduced gravity) for ~1.6 s so the air combo can land
      t += dt;
      if (!e.alive || t > 1.6) return true;
      if (e.launched && !e.onGround) e.vel.y += 17 * dt;
      e.stunTimer = Math.max(e.stunTimer, 0.3);
      if (!h.onGround && h.vel.y < -2 && t < 1.2) h.vel.y += 14 * dt;
      return false;
    });
  });
  return true;
}

/** Unaware enemy from a perch: dash in and take it down. */
export function stealthTakedown(h, e) { return webStrike(h, e, { stealth: true }); }

/** Focus finisher: spends one bar (33), three rapid hits and a launching blow in slow motion. */
export function focusFinisher(h, e) {
  if (h.focus < 33) return false;
  h.focus -= 33;
  const mul = h._dmgMul();
  _a.set(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z).normalize(); h.yaw = Math.atan2(_a.x, _a.z);
  h.invuln = Math.max(h.invuln, 0.9);
  h.game.slowmo?.(0.55, 0.35);
  h._fx('text', _b.set(h.pos.x, h.pos.y + 2.6, h.pos.z), 'FINISHER', 0xffd060, { size: 1.5, life: 1 });
  h.setAnim('smash', 1.0);
  let n = 0;
  const steps = [0.0, 0.12, 0.24, 0.42];
  for (const s of steps) {
    const i = n++;
    h._later(s, () => {
      if (!e.alive) return;
      const last = i === steps.length - 1, p = e.center.clone();
      h._hit(e, (last ? 40 : 9) * mul, { stun: e.isBoss ? 0.6 : 1.6, kind: 'finisher', heavy: last, point: p, kb: _c.set(Math.sin(h.yaw) * (last ? 16 : 1), 0, Math.cos(h.yaw) * (last ? 16 : 1)).setY(last ? 9 : 0).clone() });
      h._fx('hitSpark', p, 0xffd060, last); h._fx('burst', p, 0xffd060, last ? 24 : 6, last ? 9 : 4, 0.3, 0.15);
      h._impact(last ? 1 : 0.3); h._play(last ? 'heavyhit' : 'hit', { pos: e.pos }); h.game.hud?.hitMarker?.(last);
      if (last) { h._fx('ring', p, 3, 0xffd060, 0.4); h.game.cam.shake(0.6); }
    });
  }
  return true;
}

// ======================================================================================= web throw of nearby objects
const PROP_KINDS = [
  { name: 'CRATE', geo: () => new THREE.BoxGeometry(0.9, 0.9, 0.9), color: 0x8a6a3a },
  { name: 'BARREL', geo: () => new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), color: 0x3a5f8a },
  { name: 'BIN', geo: () => new THREE.CylinderGeometry(0.45, 0.35, 1.0, 10), color: 0x4a5a4a },
];
export class PropThrow {
  constructor(h) {
    this.h = h; this.meshes = PROP_KINDS.map((k) => {
      const m = new THREE.Mesh(k.geo(), new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.7, metalness: 0.2 }));
      m.visible = false; m.castShadow = true; h.game.scene.add(m); return m;
    });
    this.active = null;
  }
  reset() { for (const m of this.meshes) m.visible = false; this.active = null; }
  get busy() { return !!this.active; }
  /** Hold special with no enemy to pull: web a nearby object (car-side junk) into hand. Throw on release. */
  begin() {
    const h = this.h, g = h.game;
    if (this.active || !h.useCooldown('propthrow', 3)) return false;
    const k = Math.floor(Math.random() * this.meshes.length), m = this.meshes[k];
    const fwd = _d.set(Math.sin(h.yaw), 0, Math.cos(h.yaw));
    const gx = h.pos.x + fwd.x * 3.5, gz = h.pos.z + fwd.z * 3.5, gy = g.physics.heightAt(gx, gz, h.pos.y + 1) + 0.5;
    m.visible = true; m.position.set(gx, gy, gz); m.quaternion.identity();
    this.active = { m, k, t: 0, phase: 'pull' };
    h.lash = { kind: 'prop', t: 0, dir: fwd.clone(), dur: 99, pulse: 99 };
    h.pullTarget = { center: m.position, pos: m.position }; h.pullLineT = 0.4; h.lines.pull.begin(0.5);
    h.setAnim('throw', 1); h._play('thwip'); h._rumble(0.3, 0.3, 80);
    h._fx('text', _a.set(h.pos.x, h.pos.y + 2.5, h.pos.z), PROP_KINDS[k].name + ' GRABBED', 0xffffff, { size: 0.9, life: 0.8 });
    return true;
  }
  update(dt) {
    const A = this.active; if (!A) return;
    const h = this.h, g = h.game, m = A.m;
    A.t += dt;
    if (h.lash?.kind !== 'prop' || h.dead) { this._drop(); return; }
    h.pullLineT = 0.3; h.pullTarget = { center: m.position, pos: m.position };
    _a.set(h.pos.x + Math.sin(h.yaw) * 0.9, h.pos.y + 2.3, h.pos.z + Math.cos(h.yaw) * 0.9);
    if (A.phase === 'pull') {
      m.position.lerp(_a, Math.min(1, dt * 14)); m.rotation.y += dt * 8;
      if (A.t > 0.35) { A.phase = 'held'; A.t = 0; h._play('hit', { volume: 0.5 }); }
    } else {
      m.position.copy(_a); m.rotation.y += dt * 2;
      g.cam.requestAim(h.aimPreset); h.faceTowards(g.cam.forward, dt, 18); h.setAnim('throw', 1);
      if (!g.input.down('special') || A.t > 3) this._throw();
    }
  }
  _throw() {
    const h = this.h, g = h.game, A = this.active, m = A.m;
    this.active = null; if (h.lash?.kind === 'prop') h.lash = null; h.pullLineT = 0;
    const dir = g.cam.aimDirection(new THREE.Vector3());
    // aim assist toward the closest enemy near the line of fire
    let best = null, bs = 0.94;
    for (const o of g.enemies?.list ?? []) {
      if (!o.alive) continue;
      _b.copy(o.center).sub(m.position); const dd = _b.length(); if (dd > 40 || dd < 1) continue;
      const dot = _b.multiplyScalar(1 / dd).dot(dir); if (dot > bs) { bs = dot; best = o; }
    }
    if (best) dir.lerp(_b.copy(best.center).sub(m.position).normalize(), 0.7).normalize();
    const mul = h._dmgMul();
    let done = false;
    const boom = (pos) => {
      if (done) return; done = true;
      m.visible = false;
      const hits = g.combat?.aoe?.({ center: pos.clone(), radius: 3.2, damage: 34 * mul, knockback: 14, up: 6, stun: 1.2, source: h, team: 'player', falloff: true }) || [];
      g.fx.burst(pos, PROP_KINDS[A.k].color, 22, 8, 0.5, 0.25); g.fx.shockwave(pos, 3.5, 0xffffff); g.fx.dust?.(pos, 10, 2);
      g.cam.shake(Math.max(0.1, 0.5 - pos.distanceTo(h.pos) * 0.01)); h._play('heavyhit', { pos });
      if (hits.length) g.hud?.hitMarker?.(false);
    };
    g.combat?.projectile?.({
      pos: m.position.clone(), vel: dir.multiplyScalar(40), damage: 0, radius: 0.7, life: 1.6, gravity: 10, kind: 'rock', team: 'player', source: h, mesh: m,
      update: (p, dt) => { m.rotation.x += dt * 9; m.rotation.z += dt * 6; },
      onHit: (t, p) => boom(p.pos), onExpire: (p) => boom(p.pos),
    });
    h.setAnim('throw', 1.4); h.yaw = Math.atan2(dir.x, dir.z); h._play('whoosh'); h._rumble(0.5, 0.4, 100); g.cam.shake(0.15);
    h._fx('text', _a.set(h.pos.x, h.pos.y + 2.5, h.pos.z), 'WEB THROW', 0xffffff, { size: 1.0, life: 0.8 });
  }
  _drop() { const A = this.active; this.active = null; if (A) A.m.visible = false; this.h.pullLineT = 0; }
}
