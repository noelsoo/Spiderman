// Iron Man: repulsor flight, micro-missiles, unibeam. See docs/ARCHITECTURE.md (controls table).
import * as THREE from 'three';
import { Hero } from './Hero.js';
import {
  Timers, BeamMesh, GlowSprite, aimInfo, enemiesNear, enemyCenter, beamDamage, rumble, applyTilt,
  impactFx, clamp, damp, rand, objPos,
} from './avengers/util.js';

// ---- tuning ----------------------------------------------------------------
const HOVER_SPEED = 20, BOOST_SPEED = 60, ASCEND = 14;
const MISSILE_COUNT = 6, MISSILE_CD = 6, MISSILE_DMG = 45, MISSILE_RANGE = 70;
const REPULSOR_CD = 0.28, REPULSOR_DMG = 28;
const UNIBEAM_CD = 12, UNIBEAM_MAX_CHARGE = 1.8, UNIBEAM_MIN_CHARGE = 0.4;
const ULT_WINDUP = 0.5, ULT_TIME = 3, ULT_TICK = 0.1, ULT_TICK_DMG = 14, ULT_RANGE = 90, ULT_WIDTH = 3.2;
const ARMOR_GOLD = 0xffcc33, REPULSOR_COL = 0xbff4ff;

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _wish = new THREE.Vector3(), _tv = new THREE.Vector3();

export class IronMan extends Hero {
  constructor(game) {
    super(game, { id: 'ironman', name: 'Iron Man', color: '#ffcc33', maxHp: 130, walkSpeed: 7, runSpeed: 13, jumpSpeed: 10, gravity: 24, radius: 0.45, height: 1.9, airControl: 0.5, mass: 1.1 });
    this.model.customRotation = true;
    this.timers = new Timers();
    this.dmgMul = 1;
    this.flying = false; this.boosting = false;
    this.thrust = 0; this.pitch = 0; this.roll = 0; this.fov = 0;
    this.jumpHeld = 0; this.lastJump = -9;
    this.handSide = 0;
    this.actionT = 0; this.actionAnim = 'idle';
    this.chain = 0; this.chainT = 0;
    this.charging = false; this.charge = 0;
    this.beamT = 0;           // remaining visible time of a released unibeam
    this.beamFrom = new THREE.Vector3(); this.beamTo = new THREE.Vector3();
    this.ult = null;          // { t, phase }
    this._impactVy = 0; this._lastYaw = 0;
    this.trailT = 0; this.audioT = 0; this.rumbleT = 0;
    this.beam = new BeamMesh(game.scene, 0x8fe6ff);
    this.glows = [new GlowSprite(game.scene, 0xffb050), new GlowSprite(game.scene, 0xffb050), new GlowSprite(game.scene, 0xaaf0ff)];
    this._thrusterBase = null;
  }

  // ---- lifecycle -----------------------------------------------------------
  onActivate() {
    this.flying = false; this.ult = null; this.charging = false; this.actionT = 0;
    this.gravityScale = 1;
  }
  onDeactivate() {
    this.flying = false; this.boosting = false; this.charging = false; this.ult = null; this.beamT = 0;
    this.gravityScale = 1; this.timers.clear();
    this.beam.hide(); for (const g of this.glows) g.set(_a, 1, 0);
    this.game.cam.fovKick = 0;
    this._setThrust(0);
    this.model.group.rotation.set(0, this.yaw, 0);
    this.model.setTint?.(0xffffff, 0);
  }

  get abilityHints() {
    return [
      { action: 'special', label: 'Repulsor', cooldown: this.cooldownFrac('repulsor') },
      { action: 'ability', label: 'Micro-Missiles', cooldown: this.cooldownFrac('missile') },
      { action: 'ability2', label: 'Unibeam', cooldown: this.cooldownFrac('unibeam'), active: this.charging },
      { action: 'ultimate', label: 'Unibeam Sweep', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  // ---- main logic ------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;

    if (this.ult) { this._updateUlt(dt, input); this._finish(dt); return; }

    this._flightState(dt, input);
    if (this.flying) this._flightMove(dt, input);
    else { this.customMovement = false; this.gravityScale = 1; this.boosting = false; }

    this._combat(dt, input);
    this._unibeam(dt, input);
    this._finish(dt);
  }

  _finish(dt) {
    this._impactVy = this.vel.y;
    // anim lock for actions, otherwise flight anim
    if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
    else if (this.charging) this.setAnim('charge');
    else if (this.flying) this.setAnim(this.boosting || this.vel.length() > 28 ? 'fly' : 'hover', this.vel.length());
    // thrust level + fov
    const sp = this.vel.length();
    let tt = 0;
    if (this.flying) tt = this.boosting ? 1 : 0.3 + 0.4 * clamp(sp / HOVER_SPEED, 0, 1);
    else if (!this.onGround && this.game.input.down('jump')) tt = 0.3;
    if (this.ult) tt = 0.45;
    this.thrust = damp(this.thrust, tt, 8, dt);
    const fovT = this.boosting ? 16 * clamp((sp - 15) / 45, 0, 1) : this.ult ? 6 : 0;
    this.fov = damp(this.fov, fovT, 4, dt);
    this.game.cam.fovKick = this.fov;
  }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
    if (this.charging) this.setAnim('charge');
  }

  // ---- flight --------------------------------------------------------------
  _flightState(dt, input) {
    const t = this.game.time;
    if (input.pressed('jump')) {
      if (!this.flying && t - this.lastJump < 0.35) this._takeoff();
      this.lastJump = t;
    }
    if (input.down('jump')) this.jumpHeld += dt; else this.jumpHeld = 0;
    if (!this.flying && this.jumpHeld > 0.45 && !this.onGround) this._takeoff();
    if (!this.flying && input.pressed('swing')) this._takeoff();
  }

  _takeoff() {
    this.flying = true;
    if (this.onGround) { this.vel.y = Math.max(this.vel.y, 9); this.onGround = false; }
    this.game.audio?.play('thruster');
    this.game.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 3.5, ARMOR_GOLD, 0.4);
    this.game.fx?.burst?.(this.pos.clone(), 0xffb050, 20, 5, 0.5, 0.25);
    this.game.cam.shake(0.1);
  }

  _flightMove(dt, input) {
    const g = this.game, cam = g.cam;
    this.customMovement = true; this.gravityScale = 0;
    const aim = cam.aimDirection(_aim.dir).normalize();
    const mv = input.move;
    _wish.set(0, 0, 0).addScaledVector(aim, mv.y).addScaledVector(cam.right, mv.x);
    let wl = _wish.length(); if (wl > 1) { _wish.divideScalar(wl); wl = 1; }
    const boost = input.down('swing') && !this.charging;
    this.boosting = boost;
    const tgt = _tv;
    if (boost) {
      if (wl > 0.1) tgt.copy(_wish).normalize().multiplyScalar(BOOST_SPEED);
      else tgt.copy(aim).multiplyScalar(BOOST_SPEED);
    } else tgt.copy(_wish).multiplyScalar(HOVER_SPEED);
    let vy = 0;
    if (input.down('jump')) vy += ASCEND;
    if (input.down('dodge')) vy -= ASCEND;
    tgt.y += vy;
    // gentle auto-descend when idle and low, so you can set down
    const groundH = g.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
    const alt = this.pos.y - groundH;
    const idle = wl < 0.05 && !input.down('jump') && !boost;
    if (idle && alt < 3 && !this.charging) tgt.y = -4;
    else if (idle) tgt.y += Math.sin(g.time * 2.4) * 0.6; // hover bob
    if (this.charging) tgt.multiplyScalar(0.3);
    const k = boost ? 1.7 : 3.6;
    this.vel.lerp(tgt, 1 - Math.exp(-k * dt));

    // facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 3) { _a.set(this.vel.x, 0, this.vel.z); this.faceTowards(_a, dt, boost ? 9 : 6); }
    else this.faceTowards(cam.forward, dt, 5);

    // landing
    if (this.onGround && this.vel.y <= 0.5 && !input.down('jump') && !boost && (input.down('dodge') || idle || alt < 0.2 && wl < 0.3)) {
      this.flying = false; this.customMovement = false; this.gravityScale = 1;
    }
  }

  onLand() {
    const g = this.game;
    const vy = -this._impactVy;
    this._landCd = this._landCd ?? 0;
    if (this.flying && this.boosting) return; // skimming the ground at speed, stay airborne
    if (((this.flying && vy > 3.5) || vy > 20) && g.time - this._landCd > 0.8) {
      this._landCd = g.time;
      const r = 4 + clamp(vy * 0.15, 0, 4);
      g.combat?.aoe?.({ center: this.pos.clone(), radius: r, damage: 14 + clamp(vy, 0, 40), knockback: 10, up: 5, stun: 0.6, source: this });
      impactFx(g, this.pos, r, ARMOR_GOLD, 0.35 + clamp(vy * 0.015, 0, 0.4));
      g.audio?.play('land'); g.audio?.play('smash', { volume: 0.5 });
      rumble(g, 0.6, 0.3, 160);
      this.actionAnim = 'land'; this.actionT = 0.45; this.setAnim('land');
      this.flying = false; this.customMovement = false; this.gravityScale = 1;
    }
  }

  // ---- melee + repulsor + missiles ------------------------------------------
  _combat(dt, input) {
    const g = this.game;
    const free = this.actionT <= 0 && !this.charging;

    if (input.pressed('attack') && free) {
      if (this.flying && (this.boosting || this.vel.length() > 14)) this._dashPunch();
      else this._meleeCombo();
    }
    if (input.pressed('special') && (this.cooldowns.repulsor || 0) <= 0 && !this.charging) this._repulsor();
    if (input.pressed('ability') && !this.charging && (this.cooldowns.missile || 0) <= 0) this._missiles();
    if (input.pressed('ultimate') && this.focus >= 100 && !this.charging) this._startUlt();
    if (!this.flying && input.pressed('dodge') && (this.cooldowns.dash || 0) <= 0 && !this.charging) {
      this.useCooldown('dash', 0.8);
      const w = g.cam.moveVector(input.move, _a); if (w.lengthSq() < 0.01) w.copy(this.forward);
      w.normalize(); this.vel.x = w.x * 24; this.vel.z = w.z * 24; this.yaw = Math.atan2(w.x, w.z);
      this.invuln = Math.max(this.invuln, 0.25);
      this.actionAnim = 'dash'; this.actionT = 0.3;
      g.audio?.play('whoosh'); g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.5), 0xffb050, 12, 4, 0.3, 0.2);
    }
  }

  _facingToTarget(range, cone) {
    const t = this.findTarget(range, cone);
    if (t) { _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
    return t;
  }

  _meleeCombo() {
    const g = this.game;
    const step = this.chain % 3;
    const t = this._facingToTarget(9, 80);
    const fwd = this.forward;
    if (this.onGround || !this.flying) { this.vel.x += fwd.x * (t ? 7 : 3); this.vel.z += fwd.z * (t ? 7 : 3); }
    const anims = ['punch1', 'punch2', 'kick'], dmg = [18, 20, 32], kn = [6, 7, 15], up = [1.5, 1.5, 5], dur = [0.34, 0.36, 0.5];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.0;
    g.audio?.play('whoosh', { volume: 0.5 });
    this.timers.after(0.1, () => {
      if (!this.active) return;
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 2.8, arc: 110, damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: step === 2 ? 0.8 : 0.3, source: this }) ?? [];
      if (hits.length) {
        for (const h of hits) { this.registerHit(); g.fx?.burst?.(enemyCenter(h, _b).clone(), ARMOR_GOLD, 10, 5, 0.3, 0.2); }
        g.audio?.play(step === 2 ? 'heavyhit' : 'punch');
        rumble(g, 0.3 + step * 0.2, 0.2, 90);
        if (step === 2) g.cam.shake(0.25);
      }
    });
  }

  _dashPunch() {
    const g = this.game;
    const aim = g.cam.aimDirection(_c).normalize();
    this.vel.addScaledVector(aim, 38);
    if (this.vel.length() > 75) this.vel.setLength(75);
    this.actionAnim = 'punch1'; this.actionT = 0.4; this.setAnim('punch1');
    g.audio?.play('whoosh'); g.audio?.play('thruster', { volume: 0.7 });
    g.fx?.flash?.(this.center, 0xaaf0ff, 4, 0.15);
    g.cam.shake(0.2);
    // repeated hit window during the dash
    for (let i = 0; i < 4; i++) this.timers.after(0.05 + i * 0.07, () => {
      if (!this.active) return;
      const hits = g.combat?.melee?.({ origin: this.center, forward: aim.clone().setY(0).normalize(), range: 3.6, arc: 160, damage: 22 * this.dmgMul, knockback: 14, up: 3, stun: 0.6, source: this }) ?? [];
      if (hits.length) { for (const h of hits) { this.registerHit(); g.fx?.burst?.(enemyCenter(h, _b).clone(), REPULSOR_COL, 12, 6, 0.3, 0.25); } g.audio?.play('heavyhit'); rumble(g, 0.5, 0.3, 100); }
    });
  }

  _handPos(side, out) { return objPos(side ? this.model.handL : this.model.handR, out, this.center); }

  _repulsor() {
    const g = this.game;
    this.useCooldown('repulsor', REPULSOR_CD);
    const from = this._handPos(this.handSide, _a).clone();
    this.handSide ^= 1;
    aimInfo(this, 80, _aim);
    const t = this.findTarget(70, 40);
    const end = t ? enemyCenter(t, _b).clone() : _aim.point.clone();
    const dir = end.clone().sub(from); const dist = dir.length(); dir.normalize();
    const res = g.combat?.hitscan?.({ origin: from, dir, range: dist + 1.5, damage: REPULSOR_DMG * this.dmgMul, team: 'player', width: 0.7, source: this });
    const to = res?.point ? res.point.clone() : end;
    g.fx?.beam?.(from, to, REPULSOR_COL, 0.14, 0.09);
    g.fx?.flash?.(from, REPULSOR_COL, 3, 0.1);
    g.fx?.burst?.(to, REPULSOR_COL, 8, 4, 0.25, 0.2);
    g.audio?.play('repulsor');
    if (res?.target) { this.registerHit(); g.audio?.play('punch', { volume: 0.5 }); }
    // face aim
    _c.subVectors(to, this.pos).setY(0); if (_c.lengthSq() > 0.01 && !this.flying) this.yaw = Math.atan2(_c.x, _c.z);
    else if (_c.lengthSq() > 0.01) this.yaw = Math.atan2(_c.x, _c.z);
    this.actionAnim = 'shoot'; this.actionT = 0.25; this.setAnim('shoot');
    g.cam.shake(0.04);
  }

  _missiles() {
    const g = this.game;
    this.useCooldown('missile', MISSILE_CD);
    g.audio?.play('missile');
    const near = enemiesNear(g, this.pos, MISSILE_RANGE).slice(0, MISSILE_COUNT);
    const aim = aimInfo(this, 80, _aim);
    const aimDir = aim.dir.clone();
    for (let i = 0; i < MISSILE_COUNT; i++) {
      const target = near.length ? near[i % near.length] : null;
      this.timers.after(i * 0.08, () => {
        if (!this.active) return;
        const side = i % 2 ? 1 : -1;
        const origin = this.center; origin.y += 0.5;
        origin.addScaledVector(g.cam.right, side * 0.5);
        // pop up and outward first, homing takes over
        const launch = new THREE.Vector3(side * 0.7 + rand(-0.2, 0.2), 1.1, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(aimDir.clone().multiplyScalar(0.6)).normalize().multiplyScalar(26);
        const p = g.combat?.projectile?.({
          pos: origin, vel: launch, damage: MISSILE_DMG * this.dmgMul, radius: 0.5, life: 4, color: 0xffaa44, size: 0.25,
          kind: 'missile', team: 'player', homing: target, source: this,
          onHit: (tg, proj) => this._missileBoom(proj?.pos ?? origin),
          onExpire: (proj) => this._missileBoom(proj?.pos ?? origin, true),
        });
        g.fx?.burst?.(origin, 0xffcc88, 6, 3, 0.25, 0.15);
        g.audio?.play('missile', { volume: 0.4, pitch: 1 + i * 0.05 });
        void p;
      });
    }
    this.actionAnim = 'cast'; this.actionT = 0.5; this.setAnim('cast');
  }

  _missileBoom(pos, expire = false) {
    const g = this.game;
    if (!pos) return;
    const p = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    g.fx?.burst?.(p, 0xff9933, 24, 8, 0.5, 0.35);
    g.fx?.flash?.(p, 0xffaa55, 4, 0.18);
    g.fx?.ring?.(p, 3, 0xffaa55, 0.35);
    g.audio?.play('explosion', { volume: 0.5 });
    const hits = g.combat?.aoe?.({ center: p, radius: 3.5, damage: 22 * this.dmgMul, knockback: 9, up: 5, stun: 0.5, source: this }) ?? [];
    for (const h of hits) void h;
    g.cam.shake(0.08);
  }

  // ---- unibeam (ability2, hold to charge) --------------------------------------
  _unibeam(dt, input) {
    const g = this.game;
    if (!this.charging) {
      if (input.pressed('ability2') && (this.cooldowns.unibeam || 0) <= 0 && this.actionT <= 0) {
        this.charging = true; this.charge = 0;
        g.audio?.play('unibeam', { volume: 0.4, pitch: 0.7 });
      }
    } else {
      this.charge += dt;
      const f = clamp(this.charge / UNIBEAM_MAX_CHARGE, 0, 1);
      const c = objPos(this.model.chest, _a, this.center);
      if (Math.random() < 0.6) {
        _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(1.4 * (1 - f) + 0.3);
        g.fx?.burst?.(c.clone().add(_b), 0xaaf0ff, 1, 1, 0.2, 0.12);
      }
      g.fx?.flash?.(c, 0xaaf0ff, 1 + f * 4, 0.06);
      g.cam.shake(0.015 + f * 0.03);
      // face the camera aim while charging
      this.faceTowards(g.cam.forward, dt, 10);
      const releasing = !input.down('ability2');
      if (releasing || this.charge >= UNIBEAM_MAX_CHARGE + 1.2) {
        if (this.charge >= UNIBEAM_MIN_CHARGE) this._fireUnibeam(f);
        else { this.charging = false; this.useCooldown('unibeam', 0.5); }
      }
    }
  }

  _fireUnibeam(f) {
    const g = this.game;
    this.charging = false;
    this.useCooldown('unibeam', UNIBEAM_CD);
    const from = objPos(this.model.chest, _a, this.center).clone();
    aimInfo(this, 90, _aim);
    const dir = _aim.point.clone().sub(from).normalize();
    const hit = g.physics.raycast(from, dir, 70);
    const len = hit ? hit.distance : 70;
    const to = from.clone().addScaledVector(dir, len);
    const dmg = 70 + 130 * f;
    const n = beamDamage(this, from, dir, len, 1.8 + f * 1.2, dmg, 18 + f * 10, 1.0, 'unibeam');
    if (n) { for (let i = 0; i < n; i++) this.registerHit(); g.audio?.play('heavyhit'); }
    this.beamFrom.copy(from); this.beamTo.copy(to); this.beamW = 1.2 + f * 1.6; this.beamT = 0.35;
    g.fx?.beam?.(from, to, 0xbff4ff, 0.8 + f, 0.3);
    g.fx?.flash?.(to, 0xaaf0ff, 6, 0.3);
    g.fx?.burst?.(to, 0xaaf0ff, 30, 9, 0.6, 0.3);
    g.audio?.play('unibeam');
    g.cam.shake(0.5); rumble(g, 0.9, 0.6, 350);
    // recoil
    this.vel.addScaledVector(dir, -8);
    this.actionAnim = 'shoot'; this.actionT = 0.45; this.setAnim('shoot');
    this.yaw = Math.atan2(dir.x, dir.z);
  }

  // ---- ultimate: unibeam sweep ---------------------------------------------------
  _startUlt() {
    const g = this.game;
    this.focus = 0; this.charging = false;
    this.ult = { t: 0, phase: 'windup', tick: 0, shakeT: 0 };
    this.invuln = Math.max(this.invuln, ULT_WINDUP + ULT_TIME + 0.3);
    g.slowmo?.(0.5, 0.3);
    g.audio?.play('unibeam', { pitch: 0.6 });
    g.hud?.toast?.('UNIBEAM SWEEP');
    this.setAnim('charge');
  }

  _updateUlt(dt, input) {
    const g = this.game, u = this.ult;
    u.t += dt;
    this.customMovement = true;
    this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt);
    if (this.flying) { this.gravityScale = 0; this.vel.y = damp(this.vel.y, 0, 6, dt); } else this.gravityScale = 1;
    this.faceTowards(g.cam.forward, dt, 14);
    const from = objPos(this.model.chest, _a, this.center).clone();
    if (u.phase === 'windup') {
      this.setAnim('charge');
      const f = u.t / ULT_WINDUP;
      g.fx?.flash?.(from, 0xaaf0ff, 2 + f * 6, 0.06);
      g.cam.shake(0.03 + f * 0.05);
      if (u.t >= ULT_WINDUP) { u.phase = 'fire'; u.t = 0; g.audio?.play('unibeam'); g.cam.shake(0.8); }
      return;
    }
    // fire phase: beam steered by the camera
    this.setAnim('shoot');
    aimInfo(this, 120, _aim);
    const dir = _aim.point.clone().sub(from).normalize();
    const hit = g.physics.raycast(from, dir, ULT_RANGE);
    const len = hit ? hit.distance : ULT_RANGE;
    const to = from.clone().addScaledVector(dir, len);
    this.beamFrom.copy(from); this.beamTo.copy(to); this.beamW = ULT_WIDTH * (1 - 0.15 * Math.sin(u.t * 30)); this.beamT = 0.1;
    u.tick -= dt;
    if (u.tick <= 0) {
      u.tick = ULT_TICK;
      beamDamage(this, from, dir, len, ULT_WIDTH * 0.7, ULT_TICK_DMG, 10, 0.5, 'unibeam');
      g.combat?.aoe?.({ center: to.clone(), radius: 4, damage: 6, knockback: 8, up: 4, stun: 0.4, source: this, falloff: false });
      g.fx?.burst?.(to, 0xaaf0ff, 6, 8, 0.5, 0.3);
      g.fx?.flash?.(to, 0xaaf0ff, 5, 0.12);
      g.fx?.ring?.(to.clone(), 4 + Math.random() * 2, 0xaaf0ff, 0.25);
    }
    u.shakeT -= dt;
    if (u.shakeT <= 0) { u.shakeT = 0.12; rumble(g, 0.6, 0.8, 130); }
    g.cam.shake(0.05);
    if (u.t >= ULT_TIME) { this.ult = null; this.actionT = 0; g.cam.shake(0.3); }
  }

  // ---- visuals -----------------------------------------------------------------------
  _setThrust(level) {
    const th = this.model.thrusters;
    if (this.model.setThrusters) { this.model.setThrusters(level); return; }
    if (!th) return;
    const list = Array.isArray(th) ? th : [th];
    if (!this._thrusterBase) this._thrusterBase = list.map((o) => o.scale.clone());
    list.forEach((o, i) => {
      o.visible = level > 0.03;
      const b = this._thrusterBase[i] ?? o.scale;
      const s = 0.5 + level * 1.6;
      o.scale.set(b.x * (0.7 + level * 0.6), b.y * s, b.z * s);
      const m = o.material;
      if (m) { if ('emissiveIntensity' in m) m.emissiveIntensity = 1 + level * 4; if (m.transparent) m.opacity = clamp(level * 1.4, 0, 1); }
    });
  }

  updateVisuals(dt) {
    const g = this.game;
    // model tilt toward velocity
    const sp = this.vel.length();
    let pitchT = 0;
    if (this.flying && !this.ult) {
      _a.copy(this.vel).normalize();
      const lean = this.boosting ? clamp((sp - 10) / 30, 0, 1) : 0.4 * clamp(sp / 20, 0, 1);
      pitchT = Math.acos(clamp(sp > 0.5 ? _a.y : 1, -1, 1)) * lean;
      if (this.charging) pitchT = 0;
    }
    this.pitch = damp(this.pitch, pitchT, 7, dt);
    const yawRate = dt > 0 ? Math.atan2(Math.sin(this.yaw - this._lastYaw), Math.cos(this.yaw - this._lastYaw)) / dt : 0;
    this._lastYaw = this.yaw;
    this.roll = damp(this.roll, this.flying ? clamp(-yawRate * 0.18, -0.7, 0.7) * clamp(sp / 30, 0, 1) : 0, 6, dt);
    applyTilt(this, this.pitch, this.roll);

    this._setThrust(this.thrust);

    // fallback glows (also act as palm/boot repulsor glow)
    const th = this.thrust;
    const foot = _a.set(this.pos.x, this.pos.y + 0.15, this.pos.z);
    if (!this.model.thrusters && th > 0.03) {
      // boots
      _b.set(0, -0.0, 0).applyEuler(this.model.group.rotation);
      foot.copy(this.model.group.localToWorld(_c.set(-0.18, 0.1, -0.05)));
      this.glows[0].set(foot, 0.6 + th * 1.4, th);
      foot.copy(this.model.group.localToWorld(_c.set(0.18, 0.1, -0.05)));
      this.glows[1].set(foot, 0.6 + th * 1.4, th);
    } else { this.glows[0].set(foot, 1, 0); this.glows[1].set(foot, 1, 0); }
    if (this.charging) {
      const c = objPos(this.model.chest, _d, this.center);
      const f = clamp(this.charge / UNIBEAM_MAX_CHARGE, 0, 1);
      this.glows[2].set(c, 0.6 + f * 2.2 + Math.random() * 0.2, 0.7 + f * 0.3);
    } else this.glows[2].set(_d, 1, 0);

    // trail particles + thruster audio
    this.trailT -= dt;
    if (th > 0.2 && this.trailT <= 0) {
      this.trailT = this.boosting ? 0.03 : 0.07;
      const base = this.model.group.localToWorld(_b.set(0, 0.2, -0.2));
      g.fx?.burst?.(base, this.boosting ? 0xaaf0ff : 0xffaa44, this.boosting ? 3 : 2, 3, 0.35, this.boosting ? 0.3 : 0.2);
    }
    this.audioT -= dt;
    if (th > 0.2 && this.audioT <= 0) { this.audioT = 0.45; g.audio?.play('thruster', { volume: 0.25 + th * 0.35, pitch: 0.9 + th * 0.4 }); }
    if (this.boosting) { this.rumbleT -= dt; if (this.rumbleT <= 0) { this.rumbleT = 0.2; rumble(g, 0.1, 0.3, 120); } g.cam.shake(0.008); }

    // unibeam visual
    if (this.beamT > 0) {
      this.beamT -= dt;
      const w = (this.beamW ?? 1.5) * (this.ult ? 1 : clamp(this.beamT / 0.35, 0, 1));
      // keep origin glued to chest while fading
      if (!this.ult) this.beamFrom.copy(objPos(this.model.chest, _a, this.center));
      this.beam.show(this.beamFrom, this.beamTo, Math.max(0.05, w));
      if (this.beamT <= 0) this.beam.hide();
    } else if (this.beam.group.visible) this.beam.hide();
  }
}
