// SPIDER ARMS (red/blue suit): four iron-grey mechanical arms folded behind the shoulders that extend for four abilities.
//   Spider Barrage   rapid arm strikes on one target            Spider Rush      dash through a line of enemies
//   Spider Shock     chain electricity through nearby enemies   Spider Whiplash  pull enemies in and slam them
// Triggered by the L1 / E chord (ability held + face button), see SpiderMan._abilityChord. Each has its own cooldown.
import * as THREE from 'three';

const IRON = 0x9aa3ad, GLOW = 0xffb84a, SHOCK = 0x6fd8ff;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const clamp = THREE.MathUtils.clamp;

export const ARMS = {
  barrage: { name: 'Spider Barrage', cd: 9, range: 15 },
  rush: { name: 'Spider Rush', cd: 8, range: 22 },
  shock: { name: 'Spider Shock', cd: 11, range: 14 },
  whiplash: { name: 'Spider Whiplash', cd: 12, range: 17 },
};

/** Four jointed iron arms drawn in world space (pooled meshes, no per-frame allocation). */
class ArmsRig {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.visible = false;
    const mat = new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.28, metalness: 0.9, emissive: 0x222a33, emissiveIntensity: 0.4 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.4, metalness: 0.8, emissive: GLOW, emissiveIntensity: 0.6 });
    this.glow = joint;
    const seg = new THREE.CylinderGeometry(0.035, 0.05, 1, 8); seg.translate(0, 0.5, 0);
    const claw = new THREE.ConeGeometry(0.07, 0.3, 6); claw.translate(0, 0.15, 0);
    const ball = new THREE.SphereGeometry(0.07, 10, 8);
    this.arms = [];
    for (let i = 0; i < 4; i++) {
      const s1 = new THREE.Mesh(seg, mat), s2 = new THREE.Mesh(seg, mat), c = new THREE.Mesh(claw, mat);
      const j1 = new THREE.Mesh(ball, joint), j2 = new THREE.Mesh(ball, joint);
      for (const m of [s1, s2, c, j1, j2]) { m.frustumCulled = false; this.group.add(m); }
      this.arms.push({ s1, s2, c, j1, j2, tip: new THREE.Vector3(), has: false });
    }
    scene.add(this.group);
    this.k = 0; this.want = 0; this.t = 0;
  }
  /** Sets the tip target for arm i (world position) or null for the idle "spider legs" pose. */
  aim(i, p) { const A = this.arms[i]; if (p) { A.tip.copy(p); A.has = true; } else A.has = false; }
  show(on) { this.want = on ? 1 : 0; }
  hide() { this.k = 0; this.want = 0; this.group.visible = false; }
  update(dt, h) {
    this.k += (this.want - this.k) * (1 - Math.exp(-(this.want ? 16 : 7) * dt));
    this.t += dt;
    if (this.k < 0.03) { this.group.visible = false; return; }
    this.group.visible = true;
    const sy = Math.sin(h.yaw), cy = Math.cos(h.yaw);
    const base = h.pos, hh = h.height;
    for (let i = 0; i < 4; i++) {
      const A = this.arms[i], side = i < 2 ? -1 : 1, hi = i % 2;
      // shoulder: upper back, offset to the sides (local -z is behind the hero)
      const lx = side * (0.16 + 0.04 * hi), lz = -0.2;
      _a.set(base.x + cy * lx + sy * lz, base.y + hh * (0.78 + 0.02 * hi), base.z - sy * lx + cy * lz);
      // idle tip: arms arc up and out like spider legs; extended tip: the target
      if (A.has) _b.copy(A.tip);
      else {
        const sp = side * (1.2 + 0.4 * hi), up = 0.9 + 0.5 * hi + Math.sin(this.t * 3 + i) * 0.06, bk = -0.7 - 0.2 * hi;
        _b.set(base.x + cy * sp + sy * bk, base.y + hh * 0.78 + up, base.z - sy * sp + cy * bk);
      }
      _b.lerpVectors(_a, _b, this.k);
      // two-segment arm with an elbow pushed up/out
      _c.lerpVectors(_a, _b, 0.5);
      const len = _a.distanceTo(_b);
      _d.set(side * cy, 0.9, -side * sy).normalize().multiplyScalar(Math.min(0.9, len * 0.28));
      _c.add(_d);
      this._seg(A.s1, _a, _c); this._seg(A.s2, _c, _b);
      A.j1.position.copy(_c); A.j2.position.copy(_a);
      // claw continues the last segment
      _d.subVectors(_b, _c).normalize();
      A.c.position.copy(_b); _q.setFromUnitVectors(UP, _d); A.c.quaternion.copy(_q);
    }
  }
  _seg(m, a, b) {
    m.position.copy(a);
    _d.subVectors(b, a); const l = _d.length() || 1e-3; _d.multiplyScalar(1 / l);
    m.quaternion.setFromUnitVectors(UP, _d); m.scale.set(1, l, 1);
  }
  setGlow(c, i) { this.glow.emissive.setHex(c); this.glow.emissiveIntensity = i; }
}

export class SpiderArms {
  constructor(h) {
    this.h = h;
    this.rig = new ArmsRig(h.game.scene);
    this.showT = 0;
  }
  reset() { this.rig.hide(); this.showT = 0; this.rig.setGlow(GLOW, 0.6); for (let i = 0; i < 4; i++) this.rig.aim(i, null); }
  /** Keep the arms out for `s` seconds. */
  show(s) { this.showT = Math.max(this.showT, s); }
  update(dt) {
    const h = this.h;
    this.showT = Math.max(0, this.showT - dt);
    this.rig.show(this.showT > 0 && !h.symbiote && !h.dead);
    if (this.showT <= 0) for (let i = 0; i < 4; i++) this.rig.aim(i, null);
    this.rig.update(dt, h);
  }
  cdFrac(id) { return this.h.cooldownFrac('arms_' + id); }
  ready(id) { return (this.h.cooldowns['arms_' + id] || 0) <= 0; }

  _targets(range, max = 99) {
    const h = this.h, out = [];
    for (const e of h.game.enemies?.list ?? []) {
      if (!e.alive || e.untargetable) continue;
      const d = Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z);
      if (d <= range) out.push({ e, d });
    }
    out.sort((x, y) => x.d - y.d);
    return out.slice(0, max).map((o) => o.e);
  }
  _begin(id, kind, dur) {
    const h = this.h;
    if (!h.useCooldown('arms_' + id, ARMS[id].cd)) return false;
    h.atk = null; h.spin = null; h.charging = false; h.sling = null;
    h.lash = { kind, t: 0, dir: h.forward, dur, pulse: 99 };
    this.show(dur + 0.5); this.rig.setGlow(id === 'shock' ? SHOCK : GLOW, 1.2);
    h._play('whoosh', { pitch: 0.8 }); h._rumble(0.5, 0.4, 140);
    h._fx('text', _a.set(h.pos.x, h.pos.y + 2.7, h.pos.z), ARMS[id].name.toUpperCase(), 0xffd88a, { size: 1.2, life: 0.9 });
    return true;
  }
  _stun(e, s) { return e.isBoss ? Math.min(s, 0.6) : s; }

  /** Dispatch by id. Returns true if started. */
  fire(id) {
    if (this.h.symbiote || !this.ready(id)) return false;
    return this[id]?.() ?? false;
  }

  // ---- Spider Barrage: dash in, then a flurry of arm strikes on one target ----
  barrage() {
    const h = this.h, mul = h._dmgMul();
    const tgt = h.aimEnemy ?? h._aimTarget(ARMS.barrage.range, 80) ?? h._aimTargetNear(ARMS.barrage.range);
    if (!tgt) { h._fx('text', _a.set(h.pos.x, h.pos.y + 2.3, h.pos.z), 'NO TARGET', '#9fb0c8', { size: 0.8, life: 0.6 }); return false; }
    if (!this._begin('barrage', 'barrage', 1.5)) return false;
    const e = tgt;
    h.setAnim('punch1', 1.6);
    let hits = 0, t = 0, next = 0.0;
    h._task((dt) => {
      t += dt;
      if (!e.alive && t > 0.3) { return true; }
      if (h.lash?.kind !== 'barrage' || h.dead) return true;
      _a.set(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z); const d = _a.length();
      h.yaw = Math.atan2(_a.x, _a.z);
      if (d > 2.0) { _a.multiplyScalar(1 / d); const sp = Math.min(46, (d - 1.7) / Math.max(dt, 1e-3)); h.vel.x = _a.x * sp; h.vel.z = _a.z * sp; h.vel.y = Math.max(h.vel.y, (e.pos.y - h.pos.y) * 4); next = Math.max(next, t); }
      else { h.vel.x *= 0.3; h.vel.z *= 0.3; }
      h.invuln = Math.max(h.invuln, 0.1);
      if (d <= 2.6 && t >= next && hits < 12) {
        next = t + 0.085; hits++;
        const last = hits === 12, p = e.center.clone();
        const arm = hits % 4;
        this.rig.aim(arm, p.clone().add(_b.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4)));
        this.rig.aim((arm + 2) % 4, null);
        h._hit(e, (last ? 22 : 5) * mul, { stun: this._stun(e, last ? 1.4 : 0.35), kind: 'arms', point: p, heavy: last, kb: _c.set(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z).normalize().multiplyScalar(last ? 14 : 0.6).setY(last ? 9 : 0).clone() });
        h._fx('hitSpark', p, 0xffd88a, last); h._fx('burst', p, 0xffffff, 3, 4, 0.2, 0.1);
        h._play(last ? 'heavyhit' : 'hit', { pos: e.pos, volume: 0.6, pitch: 1 + (hits % 3) * 0.1 }); h._impact(last ? 0.8 : 0.1);
        h.game.hud?.hitMarker?.(last);
        if (last) { h._fx('ring', p, 2.4, 0xffd88a, 0.3); h.lash.dur = 0.15; return true; }
      }
      return t > 2.2;
    });
    return true;
  }

  // ---- Spider Rush: dash through a line of enemies ----
  rush() {
    const h = this.h, mul = h._dmgMul();
    const tg = h.aimEnemy ?? h._aimTarget(ARMS.rush.range, 70) ?? h._aimTargetNear(ARMS.rush.range);
    const dir = new THREE.Vector3();
    if (tg) dir.set(tg.pos.x - h.pos.x, 0, tg.pos.z - h.pos.z); else dir.copy(h.game.cam.forward);
    dir.y = 0; if (dir.lengthSq() < 1e-4) dir.set(Math.sin(h.yaw), 0, Math.cos(h.yaw));
    dir.normalize();
    if (!this._begin('rush', 'rush', 0.55)) return false;
    h.yaw = Math.atan2(dir.x, dir.z); h.setAnim('dash', 30);
    const start = h.pos.clone(), hitSet = new Set(), len = 20;
    let t = 0;
    h._fx('ring', _a.set(h.pos.x, h.pos.y + 1, h.pos.z), 2, 0xffd88a, 0.25);
    h._task((dt) => {
      t += dt;
      if (h.lash?.kind !== 'rush' || h.dead) return true;
      h.invuln = Math.max(h.invuln, 0.15);
      const run = Math.hypot(h.pos.x - start.x, h.pos.z - start.z);
      const sp = run < len ? 62 : 0;
      h.vel.x = dir.x * sp; h.vel.z = dir.z * sp; h.vel.y = Math.max(h.vel.y, 0);
      h.gravityScale = 0.2;
      for (let i = 0; i < 4; i++) this.rig.aim(i, _a.set(h.pos.x + dir.x * 2.2 + (i - 1.5) * 0.35, h.pos.y + 1.0 + (i % 2) * 0.35, h.pos.z + dir.z * 2.2 + (i - 1.5) * 0.35 * dir.x));
      h._fx('burst', _b.set(h.pos.x, h.pos.y + 1, h.pos.z), 0xffd88a, 2, 2, 0.25, 0.1);
      for (const e of h.game.enemies?.list ?? []) {
        if (!e.alive || hitSet.has(e)) continue;
        const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z;
        if (Math.hypot(dx, dz) > e.radius + 1.7 || Math.abs(e.pos.y - h.pos.y) > 2.6) continue;
        hitSet.add(e);
        const side = Math.sign(dx * -dir.z + dz * dir.x) || 1, p = e.center.clone();
        h._hit(e, 24 * mul, { stun: this._stun(e, 1.2), kind: 'arms', heavy: true, point: p, kb: _c.set(-dir.z * side * 9 + dir.x * 6, 0, dir.x * side * 9 + dir.z * 6).setY(7).clone() });
        h._fx('hitSpark', p, 0xffd88a, true); h._fx('burst', p, 0xffffff, 10, 6, 0.3, 0.14);
        h._play('heavyhit', { pos: e.pos }); h._impact(0.55); h.game.hud?.hitMarker?.(false);
      }
      if (run >= len || t > 0.5) {
        h.gravityScale = 1; h.vel.x *= 0.25; h.vel.z *= 0.25; h.lash.dur = 0.12;
        if (hitSet.size >= 2) h._fx('text', _a.set(h.pos.x, h.pos.y + 2.4, h.pos.z), `x${hitSet.size}`, 0xffd88a, { size: 1.1, life: 0.8 });
        return true;
      }
      return false;
    });
    return true;
  }

  // ---- Spider Shock: electricity chains through nearby enemies ----
  shock() {
    const h = this.h, mul = h._dmgMul();
    const list = this._targets(ARMS.shock.range, 8);
    if (!list.length) { h._fx('text', _a.set(h.pos.x, h.pos.y + 2.3, h.pos.z), 'NO TARGETS', '#9fb0c8', { size: 0.8, life: 0.6 }); return false; }
    if (!this._begin('shock', 'shock', 0.9)) return false;
    h.setAnim('cast', 1.4);
    // sort into a chain: nearest-neighbour from the hero
    const chain = []; let cur = h._center(new THREE.Vector3()); const pool = list.slice();
    while (pool.length) {
      let bi = 0, bd = 1e9;
      pool.forEach((e, i) => { const d = e.center.distanceToSquared(cur); if (d < bd) { bd = d; bi = i; } });
      const e = pool.splice(bi, 1)[0]; chain.push(e); cur = e.center.clone();
    }
    h.game.cam.shake(0.3); h._play('lightning'); h._play('repulsor', { pitch: 1.4, volume: 0.5 });
    h._fx('flash', h._center(_a), SHOCK, 5, 0.25);
    let prev = h._center(new THREE.Vector3());
    chain.forEach((e, i) => {
      const from = prev.clone(); prev = e.center.clone();
      h._later(0.09 * i, () => {
        this.rig.aim(i % 4, e.center);
        if (!e.alive) return;
        h._fx('lightning', from, e.center.clone(), SHOCK, 0.3, 4);
        h._fx('lightning', _a.set(e.pos.x, e.pos.y + 0.1, e.pos.z), _b.set(e.pos.x, e.pos.y + e.height, e.pos.z), SHOCK, 0.25, 2);
        h._fx('burst', e.center, SHOCK, 14, 6, 0.35, 0.16); h._fx('flash', e.center, SHOCK, 3, 0.15);
        h._hit(e, 15 * mul, { stun: this._stun(e, 2.0), kind: 'shock', point: e.center.clone() });
        h._play('lightning', { pos: e.pos, volume: 0.6 });
        for (let j = 1; j <= 4; j++) h._later(0.2 * j, () => { if (e.alive) { h._fx('lightning', _a.set(e.pos.x, e.pos.y + 0.1, e.pos.z), _b.set(e.pos.x, e.pos.y + e.height, e.pos.z), SHOCK, 0.12, 2); e.stunTimer = Math.max(e.stunTimer, 0.25); } });
        h.game.hud?.hitMarker?.(false); h.addFocus(2);
      });
    });
    if (chain.length > 1) h._fx('text', _a.set(chain[0].pos.x, chain[0].pos.y + chain[0].height + 1.2, chain[0].pos.z), `SHOCK x${chain.length}`, SHOCK, { size: 1.1, life: 0.9 });
    return true;
  }

  // ---- Spider Whiplash: pull enemies in, then slam them down ----
  whiplash() {
    const h = this.h, mul = h._dmgMul();
    const list = this._targets(ARMS.whiplash.range, 4).filter((e) => !e.isBoss);
    const boss = this._targets(ARMS.whiplash.range, 1).find((e) => e.isBoss);
    if (!list.length && !boss) { h._fx('text', _a.set(h.pos.x, h.pos.y + 2.3, h.pos.z), 'NO TARGETS', '#9fb0c8', { size: 0.8, life: 0.6 }); return false; }
    if (!this._begin('whiplash', 'whiplash', 1.3)) return false;
    h.setAnim('throw', 1.2); h.game.cam.shake(0.2);
    const all = boss ? [...list, boss] : list;
    let t = 0, slammed = false;
    const hold = new THREE.Vector3();
    h._task((dt) => {
      t += dt;
      if (h.lash?.kind !== 'whiplash' || h.dead) { for (const e of all) e.launched = false; return true; }
      h.vel.x *= 0.5; h.vel.z *= 0.5;
      all.forEach((e, i) => {
        if (!e.alive) return;
        this.rig.aim(i % 4, e.center);
        if (e.isBoss) { if (t < 0.1) { h._hit(e, 12 * mul, { stun: 0.6, kind: 'arms', point: e.center.clone() }); e.slowTimer = Math.max(e.slowTimer || 0, 1.2); } return; }
        const a = (i / all.length) * Math.PI * 2 + 0.5;
        if (t < 0.45) { // pull in and lift
          hold.set(h.pos.x + Math.sin(h.yaw + (i - (all.length - 1) / 2) * 0.7) * 2.0, h.pos.y + 2.4, h.pos.z + Math.cos(h.yaw + (i - (all.length - 1) / 2) * 0.7) * 2.0);
          _a.copy(hold).sub(e.center); const d = _a.length();
          e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.4); e.interrupt?.();
          e.vel.copy(_a.multiplyScalar(1 / Math.max(d, 0.01))).multiplyScalar(Math.min(48, d / 0.05));
        } else if (t < 0.6) { e.vel.set(0, 0, 0); e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.3); }
        else if (!slammed) { e.vel.set(0, -34, 0); e.launched = true; }
      });
      if (t >= 0.6 && !slammed) { slammed = true; h._play('whoosh'); this.show(0.7); }
      if (slammed) {
        let down = true;
        for (const e of all) if (e.alive && !e.isBoss && !e.onGround && t < 1.3) down = false;
        if (down || t > 1.25) {
          for (const e of all) {
            if (!e.alive || e.isBoss) continue;
            e.launched = false;
            h._hit(e, 26 * mul, { stun: 1.3, kind: 'arms', heavy: true, point: e.center.clone(), kb: _c.set(0, 3, 0).clone() });
            h._fx('burst', e.center, 0xffd88a, 14, 6, 0.4, 0.16); h._fx('shockwave', _a.set(e.pos.x, e.pos.y + 0.1, e.pos.z), 3.2, 0xffd88a);
          }
          h.game.combat?.aoe?.({ center: h.pos.clone().addScaledVector(h.forward, 2), radius: 4, damage: 8 * mul, knockback: 8, up: 3, stun: 0.6, source: h, team: 'player' });
          h._impact(0.9); h.game.cam.shake(0.5); h._play('heavyhit');
          h._fx('text', _a.set(h.pos.x, h.pos.y + 2.6, h.pos.z), all.length > 1 ? `WHIPLASH x${all.length}` : 'WHIPLASH', 0xffd88a, { size: 1.2, life: 0.9 });
          h.lash && (h.lash.dur = 0.1);
          return true;
        }
      }
      return false;
    });
    return true;
  }
}
