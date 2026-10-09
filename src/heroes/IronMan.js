// Iron Man (Marvel's Avengers style): repulsor flight + dogfighting, precision repulsor fire, micro-missile lock-on,
// unibeam, Proton Cannon heroic. See docs/ARCHITECTURE.md ("Controls v2", "Hero aim convention").
//
// Controls (keyboard / pad):
//   hold aim RMB / L2     precision targeting: camera zoom, reticle, lock-on assist, strafe (also in flight)
//   fire LMB / R2 (aiming) rapid alternating repulsor bursts; keep holding (>0.4 s) to charge a heavy repulsor, release to fire
//   tap RMB / R1          quick repulsor blast
//   ability E / L1        unaimed: quick homing salvo.  While aiming: hold to paint up to 8 targets (~1 s), release to fire
//   tap R / tap L2        Unibeam: tap to start charging, tap again (or LMB) to fire early, auto-fires when full
//   ultimate Q / R3       Proton Cannon (shoulder-mounted sustained beam steered by the camera)
//   jump x2 / hold, Shift / R2: flight + boost (steer the camera: boost turns are rate limited so you bank around)
import * as THREE from 'three';
import { Hero } from './Hero.js';
import {
  Timers, BeamMesh, GlowSprite, LockMarkers, aimInfo, assistAim, enemiesInReticle, enemyCenter, beamDamage, rumble, applyTilt,
  impactFx, precisionHit, setReticle, hitStop, clamp, damp, rand, objPos, approachVal,
} from './avengers/util.js';

// ---- tuning ----------------------------------------------------------------
const HOVER_SPEED = 20, STRAFE_SPEED = 15, BOOST_SPEED = 62, BOOST_MAX = 80, ASCEND = 14, BOOST_TURN = 2.3;
const MISSILE_MAX = 8, MISSILE_CD = 6, MISSILE_DMG = 40, MISSILE_RANGE = 80, MISSILE_PAINT = 0.125;
const REPULSOR_CD = 0.28, REPULSOR_DMG = 28;
const RAPID_INTERVAL = 0.11, RAPID_DMG = 15, BURST_TIME = 0.4, HEAVY_MAX = 1.0, HEAVY_MIN = 0.45, HEAVY_DMG = 78;
const UNIBEAM_CD = 12, UNIBEAM_MAX_CHARGE = 1.6, UNIBEAM_MIN_CHARGE = 0.4;
const ULT_WINDUP = 1.1, ULT_TIME = 4.5, ULT_TICK = 0.1, ULT_TICK_DMG = 20, ULT_RANGE = 100, ULT_WIDTH = 3.6;
const ARMOR_GOLD = 0xffcc33, REPULSOR_COL = 0xbff4ff, PROTON_COL = 0xffc070;
const AIM_PRESET = { fov: 46, distance: 2.6, shoulder: 0.9, height: 1.7 };

const _as = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _wish = new THREE.Vector3(), _tv = new THREE.Vector3(), _cur = new THREE.Vector3();
const _ret = [];
const UPV = new THREE.Vector3(0, 1, 0);

export class IronMan extends Hero {
  constructor(game) {
    super(game, { id: 'ironman', name: 'Iron Man', color: '#ffcc33', maxHp: 130, walkSpeed: 7, runSpeed: 13, jumpSpeed: 10, gravity: 24, radius: 0.45, height: 1.9, airControl: 0.5, mass: 1.1, usesAim: true, aimPreset: AIM_PRESET });
    this.model.customRotation = true;
    this.timers = new Timers();
    this.dmgMul = 1;
    this.flying = false; this.boosting = false; this.boostT = 0;
    this.thrust = 0; this.pitch = 0; this.roll = 0; this.fov = 0;
    this.jumpHeld = 0; this.lastJump = -9;
    this.handSide = 0;
    this.actionT = 0; this.actionAnim = 'idle';
    this.chain = 0; this.chainT = 0;
    this.charging = false; this.charge = 0;          // unibeam
    this.fireHeld = 0; this.heavy = 0; this._fdPrev = false;  // aimed fire
    this.lock = { on: false, t: 0, paint: 0, list: [], maxT: 0 };
    this.beamT = 0;
    this.beamFrom = new THREE.Vector3(); this.beamTo = new THREE.Vector3(); this.beamW = 1.5;
    this.ult = null;
    this._impactVy = 0; this._lastYaw = 0; this._velYaw = 0;
    this.trailT = 0; this.audioT = 0; this.rumbleT = 0;
    this._hitFocus = 1; this._noFocus = false;
    this._trails = [];
    this.beam = new BeamMesh(game.scene, 0x8fe6ff);
    this.beamOuter = new BeamMesh(game.scene, 0xff9a40);
    this.glows = [new GlowSprite(game.scene, 0xffb050), new GlowSprite(game.scene, 0xffb050), new GlowSprite(game.scene, 0xaaf0ff), new GlowSprite(game.scene, 0xffd9a0)];
    this.markers = new LockMarkers(game.scene, MISSILE_MAX);
    this._thrusterBase = null;
  }

  // ---- lifecycle -----------------------------------------------------------
  onActivate() {
    this.flying = false; this.ult = null; this.charging = false; this.actionT = 0; this.heavy = 0; this.fireHeld = 0;
    this.lock.on = false;
    this.gravityScale = 1;
  }
  onDeactivate() {
    this.flying = false; this.boosting = false; this.charging = false; this.ult = null; this.beamT = 0; this.heavy = 0;
    this.lock.on = false; this.markers.hideAll();
    this.gravityScale = 1; this.timers.clear();
    this.beam.hide(); this.beamOuter.hide(); for (const g of this.glows) g.set(_a, 1, 0);
    this._stopTrails();
    setReticle(this, null);
    this.game.cam.fovKick = 0;
    this._setThrust(0);
    this.model.group.rotation.set(0, this.yaw, 0);
    this.model.setTint?.(0xffffff, 0);
  }

  get abilityHints() {
    return [
      { action: 'special', label: 'Repulsor', cooldown: this.cooldownFrac('repulsor') },
      { action: 'ability', label: this.aiming ? 'Missile Lock' : 'Micro-Missiles', cooldown: this.cooldownFrac('missile'), active: this.lock.on },
      { action: 'ability2', label: 'Unibeam', cooldown: this.cooldownFrac('unibeam'), active: this.charging },
      { action: 'ultimate', label: 'Proton Cannon', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  registerHit() { this.combo++; this.comboTimer = 2.5; if (!this._noFocus) this.addFocus(4 * this._hitFocus); }

  takeDamage(amount, fromPos) {
    if (this.ult) return false;
    const ok = super.takeDamage(amount, fromPos);
    if (ok) { this.lock.on && this._cancelLock(); this.heavy = 0; this.fireHeld = 0; }
    return ok;
  }

  // ---- main logic ------------------------------------------------------------
  updateAbilities(dt, input) {
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;

    if (this.ult) { setReticle(this, null); this._updateUlt(dt, input); this._finish(dt); return; }

    setReticle(this, this.aiming ? 'repulsor' : null);
    this._flightState(dt, input);
    if (this.flying) this._flightMove(dt, input);
    else { this.customMovement = false; this.gravityScale = 1; this.boosting = false; }

    this._aimedFire(dt, input);
    this._missileLock(dt, input);
    this._combat(dt, input);
    this._unibeam(dt, input);
    this._finish(dt);
  }

  _finish(dt) {
    this._impactVy = this.vel.y;
    if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
    else if (this.charging || this.heavy > 0.05) this.setAnim('charge');
    else if (this.aiming && !this.ult) this.setAnim('aim', this.vel.length());
    else if (this.flying) this.setAnim(this.boosting || this.vel.length() > 28 ? 'fly' : 'hover', this.vel.length());
    const sp = this.vel.length();
    let tt = 0;
    if (this.flying) tt = this.boosting ? 1 : 0.3 + 0.4 * clamp(sp / HOVER_SPEED, 0, 1);
    else if (!this.onGround && this.game.input.down('jump')) tt = 0.3;
    if (this.ult) tt = 0.55;
    this.thrust = damp(this.thrust, tt, 8, dt);
    const fovT = this.boosting ? 18 * clamp((sp - 15) / 55, 0, 1) : 0;
    this.fov = damp(this.fov, fovT, 4, dt);
    this.game.cam.fovKick = this.fov;
    // boost trails
    if (this.boosting && !this._trails.length) this._startTrails();
    else if (!this.boosting && this._trails.length) this._stopTrails();
    // zoom extras layered on top of the base aim preset (the camera takes the last request this frame)
    const g = this.game;
    if (this.aiming && !this.ult) {
      if (this.charging) g.cam.requestAim({ ...AIM_PRESET, fov: 42 });
      else if (this.heavy > 0.3) g.cam.requestAim({ ...AIM_PRESET, fov: 42 - this.heavy * 6 });
      else if (this.lock.on) g.cam.requestAim({ ...AIM_PRESET, fov: 52, distance: 3.2 });
    }
  }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    if (this.aiming) {
      const lim = this.walkSpeed * 0.85, hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > lim && this.onGround) { this.vel.x *= lim / hs; this.vel.z *= lim / hs; }
      this.faceTowards(this.game.cam.forward, dt, 20);
      if (!this.onGround) this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', hs);
      else this.setAnim('aim', hs);
    }
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
    this.game.fx?.dust?.(this.pos, 8, 2.5);
    this.game.cam.shake(0.1);
  }

  _flightMove(dt, input) {
    const g = this.game, cam = g.cam;
    this.customMovement = true; this.gravityScale = 0;
    const aim = cam.aimDirection(_aim.dir).normalize();
    const mv = input.move;
    _wish.set(0, 0, 0).addScaledVector(aim, mv.y).addScaledVector(cam.right, mv.x);
    let wl = _wish.length(); if (wl > 1) { _wish.divideScalar(wl); wl = 1; }
    const aiming = this.aiming || this.lock.on;
    const boost = input.down('swing') && !this.charging && !aiming;
    if (boost && !this.boosting) { g.audio?.play('thruster', { volume: 0.7, pitch: 1.2 }); this.boostT = 0; g.fx?.ring?.(this.center, 4, 0xaaf0ff, 0.3); }
    this.boosting = boost;
    let vy = 0;
    if (input.down('jump')) vy += ASCEND;
    if (input.down('dodge')) vy -= ASCEND;

    const groundH = g.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
    const alt = this.pos.y - groundH;
    const idle = wl < 0.05 && !input.down('jump') && !boost;

    if (boost) {
      // dogfighting boost: speed ramps up, the heading can only swing at a limited rate => wide banked turns
      this.boostT += dt;
      const spd = this.vel.length();
      if (spd > 3) _cur.copy(this.vel).divideScalar(spd); else _cur.copy(aim);
      if (wl > 0.1) _d.copy(_wish).normalize(); else _d.copy(aim);
      const ang = _cur.angleTo(_d);
      const k = ang > 1e-3 ? Math.min(1, (BOOST_TURN * dt) / ang) : 1;
      _cur.lerp(_d, k).normalize();
      const topSpeed = Math.min(BOOST_MAX, BOOST_SPEED + this.boostT * 6);
      const ns = approachVal(spd, topSpeed, (spd < 30 ? 70 : 28) * dt);
      this.vel.copy(_cur).multiplyScalar(ns);
      this.vel.y += vy * 1.2 * dt;
    } else {
      this.boostT = 0;
      const tgt = _tv;
      tgt.copy(_wish).multiplyScalar(aiming ? STRAFE_SPEED : HOVER_SPEED);
      tgt.y += vy;
      if (idle && alt < 3 && !this.charging) tgt.y = -4;                // gentle auto-descend so you can set down
      else if (idle) tgt.y += Math.sin(g.time * 2.4) * 0.6;             // hover bob
      if (this.charging) tgt.multiplyScalar(0.3);
      // air brake: stopping is crisper than accelerating
      const braking = this.vel.lengthSq() > tgt.lengthSq() + 25;
      this.vel.lerp(tgt, 1 - Math.exp(-(braking ? 4.2 : 3.4) * dt));
    }

    // facing: toward the camera when aiming (strafing), otherwise toward travel
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (aiming) this.faceTowards(cam.forward, dt, 20);
    else if (hs > 3) { _a.set(this.vel.x, 0, this.vel.z); this.faceTowards(_a, dt, boost ? 7 : 6); }
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
    if (this.ult) return;
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

  // ---- melee + repulsor ------------------------------------------------------
  _combat(dt, input) {
    const g = this.game;
    const busy = this.charging || this.lock.on || this.heavy > 0.05;
    const free = this.actionT <= 0 && !busy;

    if (input.pressed('attack') && free) {
      if (this.flying && (this.boosting || this.vel.length() > 14)) this._dashPunch();
      else this._meleeCombo();
    }
    if (this.pressedSpecial() && (this.cooldowns.repulsor || 0) <= 0 && !this.charging && !this.lock.on) this._quickRepulsor();
    if (input.pressed('ability') && !this.aiming && !busy && (this.cooldowns.missile || 0) <= 0) this._missileSalvo(this._nearestTargets(6), false);
    if (input.pressed('ultimate') && this.focus >= 100 && !this.charging) this._startUlt();
    if (!this.flying && input.pressed('dodge') && (this.cooldowns.dash || 0) <= 0 && !busy) {
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
    // anticipation: the lunge starts at once, the strike lands after the wind-up
    if (this.onGround || !this.flying) { this.vel.x += fwd.x * (t ? 7 : 3); this.vel.z += fwd.z * (t ? 7 : 3); }
    const anims = ['punch1', 'punch2', 'kick'], dmg = [18, 20, 32], kn = [6, 7, 15], up = [1.5, 1.5, 5], dur = [0.34, 0.36, 0.5], delay = [0.1, 0.11, 0.18];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.0;
    g.audio?.play('whoosh', { volume: 0.5 });
    this.timers.after(delay[step], () => {
      if (!this.active) return;
      this._hitFocus = 1;
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 2.8, arc: 110, damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: step === 2 ? 0.8 : 0.3, source: this, heavy: step === 2 }) ?? [];
      if (hits.length) {
        for (const h of hits) g.fx?.burst?.(enemyCenter(h, _b).clone(), ARMOR_GOLD, 10, 5, 0.3, 0.2);
        rumble(g, 0.3 + step * 0.2, 0.2, 90);
        if (step === 2) { g.cam.shake(0.3); hitStop(g, 0.06, 0.05); }
      }
    });
  }

  _dashPunch() {
    const g = this.game;
    const aim = g.cam.aimDirection(_c).normalize();
    this.vel.addScaledVector(aim, 38);
    if (this.vel.length() > 80) this.vel.setLength(80);
    this.actionAnim = 'punch1'; this.actionT = 0.4; this.setAnim('punch1');
    g.audio?.play('whoosh'); g.audio?.play('thruster', { volume: 0.7 });
    g.fx?.flash?.(this.center, 0xaaf0ff, 4, 0.15);
    g.cam.shake(0.2);
    const dir = aim.clone().setY(0).normalize();
    for (let i = 0; i < 4; i++) this.timers.after(0.05 + i * 0.07, () => {
      if (!this.active) return;
      const hits = g.combat?.melee?.({ origin: this.center, forward: dir, range: 3.6, arc: 160, damage: 22 * this.dmgMul, knockback: 14, up: 3, stun: 0.6, source: this }) ?? [];
      if (hits.length) { for (const h of hits) g.fx?.burst?.(enemyCenter(h, _b).clone(), REPULSOR_COL, 12, 6, 0.3, 0.25); rumble(g, 0.5, 0.3, 100); hitStop(g, 0.05, 0.06); }
    });
  }

  _handPos(side, out) { return objPos(side ? this.model.handL : this.model.handR, out, this.center); }

  /** One repulsor shot from the next palm. opts: { dmg, width, heavy, wide } */
  _fireRepulsor(opts = {}) {
    const g = this.game;
    const { dmg = REPULSOR_DMG, width = 0.7, heavy = false, wide = false, focus = 1 } = opts;
    const from = this._handPos(this.handSide, _a).clone();
    this.handSide ^= 1;
    let dir, hint = null;
    if (wide && !this.aiming) {
      // unaimed quick shot: classic soft lock-on to the nearest enemy in front
      const t = this.findTarget(70, 40);
      aimInfo(this, 90, _aim);
      const end = t ? enemyCenter(t, _b).clone() : _aim.point.clone();
      dir = end.sub(from).normalize(); hint = t;
    } else {
      const aa = assistAim(this, from, 95, heavy ? 7 : 5, _as);
      dir = aa.dir.clone(); hint = aa.target;
    }
    this._hitFocus = focus;
    const kb = heavy ? 14 : 4;
    const res = g.combat?.hitscan?.({ origin: from, dir, range: 95, damage: dmg * this.dmgMul, team: 'player', width, source: this, knockback: kb, stun: heavy ? 0.9 : 0.2, heavy });
    this._hitFocus = 1;
    let to;
    if (res?.point) to = res.point.clone();
    else { const wall = g.physics.raycast(from, dir, 95); to = from.clone().addScaledVector(dir, wall ? wall.distance : 95); }
    g.fx?.beam?.(from, to, heavy ? 0xdff8ff : REPULSOR_COL, heavy ? 0.5 : 0.12, heavy ? 0.22 : 0.07);
    g.fx?.glow?.(from, REPULSOR_COL, heavy ? 2.4 : 0.9, 0.08);
    if (!heavy) g.fx?.flash?.(from, REPULSOR_COL, 1.6, 0.06);
    g.fx?.burst?.(to, REPULSOR_COL, heavy ? 22 : 6, heavy ? 8 : 4, 0.25, heavy ? 0.3 : 0.18);
    if (!res && !heavy) g.fx?.sparks?.(to, dir.clone().negate(), REPULSOR_COL, 4, 6, 0.2, 0.08);
    g.audio?.play('repulsor', { pitch: 0.92 + Math.random() * 0.2, volume: heavy ? 1 : 0.7 });
    if (res?.target) {
      precisionHit(this, res.target, res.point, dmg, { knockback: dir.clone().multiplyScalar(kb) });
      rumble(g, heavy ? 0.7 : 0.18, heavy ? 0.4 : 0.1, heavy ? 120 : 30);
    }
    // face the shot when not aiming
    if (!this.aiming) { _c.subVectors(to, this.pos).setY(0); if (_c.lengthSq() > 0.01) this.yaw = Math.atan2(_c.x, _c.z); }
    this.actionAnim = 'shoot'; this.actionT = heavy ? 0.4 : 0.16; this.setAnim('shoot');
    g.cam.shake(heavy ? 0.28 : 0.025);
    void hint;
    return res;
  }

  _quickRepulsor() {
    this.useCooldown('repulsor', REPULSOR_CD);
    this._fireRepulsor({ dmg: REPULSOR_DMG, width: 0.7, wide: true });
  }

  /** Aimed fire: rapid alternating bursts, then charge a heavy repulsor if you keep holding. */
  _aimedFire(dt, input) {
    const g = this.game;
    const fd = this.aiming && this.fireDown() && !this.lock.on && !this.charging;
    if (fd) {
      if (this.firePressed() || !this._fdPrev) { this.fireHeld = 0; this.heavy = 0; }
      this.fireHeld += dt;
      if (this.fireHeld < BURST_TIME) {
        if ((this.cooldowns.rapid || 0) <= 0) {
          this.useCooldown('rapid', RAPID_INTERVAL);
          this._fireRepulsor({ dmg: RAPID_DMG, width: 0.55, focus: 0.18 });
        }
      } else {
        // charging a heavy repulsor
        this.heavy = clamp(this.fireHeld - BURST_TIME, 0, HEAVY_MAX);
        const f = this.heavy / HEAVY_MAX;
        const p = this._handPos(this.handSide, _a);
        if (Math.random() < 0.5) {
          _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(0.8 * (1 - f) + 0.15);
          g.fx?.burst?.(p.clone().add(_b), REPULSOR_COL, 1, 1, 0.2, 0.1);
        }
        g.fx?.flash?.(p, REPULSOR_COL, 0.8 + f * 3, 0.06);
        g.cam.shake(0.01 + f * 0.03);
        if (f >= 1 && !this._heavyFull) { this._heavyFull = true; g.audio?.play('ui_move', { pitch: 1.6 }); rumble(g, 0.3, 0.5, 80); }
        this.actionAnim = 'charge'; this.actionT = 0.1;
      }
    } else {
      if (this._fdPrev && this.heavy >= HEAVY_MIN && this.aiming && !this.lock.on) {
        const f = this.heavy / HEAVY_MAX;
        this._fireRepulsor({ dmg: HEAVY_DMG * (0.6 + 0.4 * f), width: 1.2 + f, heavy: true });
        const last = this.beamTo;
        void last;
        this.vel.addScaledVector(g.cam.aimDirection(_c), -4);
        hitStop(g, 0.05, 0.08);
      }
      this.heavy = 0; this.fireHeld = 0; this._heavyFull = false;
    }
    this._fdPrev = fd;
  }

  // ---- micro-missiles --------------------------------------------------------------
  _nearestTargets(n) {
    const g = this.game;
    const list = [];
    const ret = enemiesInReticle(g, MISSILE_RANGE, 60, _ret);
    for (const e of ret) { list.push(e); if (list.length >= n) break; }
    if (!list.length) for (const e of g.enemies?.list ?? []) { if (e.alive && e.pos.distanceTo(this.pos) < MISSILE_RANGE) list.push(e); }
    list.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
    return list.slice(0, n);
  }

  _cancelLock() { this.lock.on = false; this.lock.list.length = 0; this.markers.hideAll(); }

  _missileLock(dt, input) {
    const g = this.game, L = this.lock;
    if (!L.on) {
      if (this.aiming && input.pressed('ability') && !this.charging && (this.cooldowns.missile || 0) <= 0 && !this.heavy) {
        L.on = true; L.t = 0; L.paint = 0.12; L.list.length = 0;
        g.audio?.play('missile', { volume: 0.35, pitch: 0.6 });
        this.actionAnim = 'aim'; this.actionT = 0;
      }
      if (!L.on) { this.markers.hideAll(); return; }
    }
    L.t += dt;
    // drop dead targets
    for (let i = L.list.length - 1; i >= 0; i--) if (!L.list[i].e.alive) L.list.splice(i, 1);
    // paint
    L.paint -= dt;
    if (L.paint <= 0 && L.list.length < MISSILE_MAX && this.aiming) {
      L.paint = MISSILE_PAINT;
      const cands = enemiesInReticle(g, MISSILE_RANGE, 15, _ret);
      if (cands.length) {
        let best = null, bc = 99;
        for (const e of cands) {
          let c = 0; for (const p of L.list) if (p.e === e) c++;
          if (c < bc) { bc = c; best = e; }
        }
        L.list.push({ e: best, t: L.t });
        g.audio?.play('ui_move', { volume: 0.4, pitch: 1.0 + L.list.length * 0.08 });
        if (L.list.length === MISSILE_MAX) { g.audio?.play('ui_select', { volume: 0.5, pitch: 1.4 }); g.fx?.text?.(this.center.setY(this.pos.y + this.height + 0.8), 'LOCKED', 0xff7a50, { size: 1.2 }); }
      }
    }
    // markers (stack duplicates upward so every missile is visible)
    const seen = new Map();
    for (let i = 0; i < L.list.length; i++) {
      const p = L.list[i];
      const n = seen.get(p.e) ?? 0; seen.set(p.e, n + 1);
      enemyCenter(p.e, _e); _e.y += 0.5 * n;
      this.markers.set(i, _e, clamp((L.t - p.t) / 0.35, 0, 1), g.camera.position);
    }
    this.markers.hideFrom(L.list.length);
    // release
    const release = !input.down('ability') || !this.aiming;
    if (release) {
      const targets = L.list.map((p) => p.e);
      this._cancelLock();
      if (targets.length) this._missileSalvo(targets, true);
      else this.useCooldown('missile', 0.4);
    }
  }

  _missileSalvo(targets, locked) {
    const g = this.game;
    this.useCooldown('missile', MISSILE_CD);
    g.audio?.play('missile');
    const count = locked ? targets.length : 6;
    const aim = aimInfo(this, 80, _aim);
    const aimDir = aim.dir.clone();
    for (let i = 0; i < count; i++) {
      const target = targets.length ? targets[i % targets.length] : null;
      this.timers.after(i * 0.07, () => {
        if (!this.active) return;
        const side = i % 2 ? 1 : -1;
        const origin = this.center; origin.y += 0.5;
        origin.addScaledVector(g.cam.right, side * 0.5);
        // pop up and outward first, homing takes over (anticipation: a visible puff at each launcher)
        const launch = new THREE.Vector3(side * 0.7 + rand(-0.25, 0.25), 1.1 + rand(0, 0.5), rand(-0.2, 0.2)).applyAxisAngle(UPV, this.yaw).add(aimDir.clone().multiplyScalar(0.6)).normalize().multiplyScalar(26);
        g.combat?.projectile?.({
          pos: origin, vel: launch, damage: MISSILE_DMG * this.dmgMul, radius: 0.5, life: 4, color: 0xffaa44, size: 0.25,
          kind: 'missile', team: 'player', homing: target, source: this, turn: locked ? 5 : 3.5,
          onHit: (tg, proj) => this._missileBoom(proj?.pos ?? origin, tg),
          onExpire: (proj) => this._missileBoom(proj?.pos ?? origin, null),
        });
        g.fx?.burst?.(origin, 0xffcc88, 6, 3, 0.25, 0.15);
        g.fx?.smoke?.(origin, 0.5, 0.6, null, 0.4);
        g.audio?.play('missile', { volume: 0.4, pitch: 1 + i * 0.05 });
      });
    }
    this.actionAnim = 'cast'; this.actionT = 0.5; this.setAnim('cast');
    g.cam.shake(0.08); rumble(g, 0.3, 0.5, 160);
  }

  _missileBoom(pos, target) {
    const g = this.game;
    if (!pos) return;
    const p = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    g.fx?.burst?.(p, 0xff9933, 24, 8, 0.5, 0.35);
    g.fx?.flash?.(p, 0xffaa55, 4, 0.18);
    g.fx?.ring?.(p, 3, 0xffaa55, 0.35);
    g.audio?.play('explosion', { volume: 0.5 });
    this._hitFocus = 0.35;
    g.combat?.aoe?.({ center: p, radius: 3.4, damage: 26 * this.dmgMul, knockback: 9, up: 5, stun: 0.5, source: this });
    if (target?.alive) target.takeDamage?.(MISSILE_DMG * 0.5 * this.dmgMul, { knockback: new THREE.Vector3(0, 3, 0), stun: 0.3, source: this, kind: 'missile' });
    this._hitFocus = 1;
    g.cam.shake(0.06);
  }

  // ---- unibeam (tap ability2 to charge, tap again to fire) -------------------------------
  _unibeam(dt, input) {
    const g = this.game;
    if (!this.charging) {
      if (this.pressedAbility2() && (this.cooldowns.unibeam || 0) <= 0 && this.actionT <= 0.2 && !this.lock.on && !this.heavy) {
        this.charging = true; this.charge = 0;
        g.audio?.play('unibeam', { volume: 0.4, pitch: 0.7 });
        g.hud?.toast?.('UNIBEAM: tap again to fire');
      }
      return;
    }
    this.charge += dt;
    const f = clamp(this.charge / UNIBEAM_MAX_CHARGE, 0, 1);
    const c = objPos(this.model.chest, _a, this.center);
    if (Math.random() < 0.6) {
      _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(1.4 * (1 - f) + 0.3);
      g.fx?.burst?.(c.clone().add(_b), 0xaaf0ff, 1, 1, 0.2, 0.12);
    }
    g.fx?.flash?.(c, 0xaaf0ff, 1 + f * 4, 0.06);
    g.cam.shake(0.015 + f * 0.035);
    rumble(g, 0.05 + f * 0.25, 0.1 + f * 0.4, 60);
    this.faceTowards(g.cam.forward, dt, 10);
    const early = this.pressedAbility2() || input.pressed('attack') || this.firePressed();
    if ((early && this.charge >= UNIBEAM_MIN_CHARGE) || this.charge >= UNIBEAM_MAX_CHARGE + 0.8) this._fireUnibeam(f);
    else if (input.pressed('dodge')) { this.charging = false; this.useCooldown('unibeam', 0.5); }
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
    const n = beamDamage(this, from, dir, len, 1.8 + f * 1.2, dmg, 18 + f * 10, 1.0, 'unibeam', true);
    if (n) { for (let i = 0; i < n; i++) this.registerHit(); g.audio?.play('heavyhit'); hitStop(g, 0.08, 0.05); }
    this.beamFrom.copy(from); this.beamTo.copy(to); this.beamW = 1.2 + f * 1.6; this.beamT = 0.35; this._beamSolo = true;
    g.fx?.beam?.(from, to, 0xbff4ff, 0.8 + f, 0.3);
    g.fx?.flash?.(to, 0xaaf0ff, 6, 0.3);
    g.fx?.burst?.(to, 0xaaf0ff, 30, 9, 0.6, 0.3);
    g.fx?.ring?.(to.clone(), 5, 0xaaf0ff, 0.4);
    g.audio?.play('unibeam');
    g.cam.shake(0.55); rumble(g, 0.9, 0.6, 350);
    this.vel.addScaledVector(dir, -9);
    this.actionAnim = 'shoot'; this.actionT = 0.5; this.setAnim('shoot');
    this.yaw = Math.atan2(dir.x, dir.z);
  }

  // ---- ultimate: Proton Cannon ---------------------------------------------------------------
  _shoulderPos(out) {
    const g = this.model.group;
    g.updateMatrixWorld(true);
    return g.localToWorld(out.set(0.34, this.height * 0.86, 0.12));
  }

  _startUlt() {
    const g = this.game;
    this.focus = 0; this.charging = false; this.heavy = 0; this._cancelLock();
    this.ult = { t: 0, phase: 'windup', tick: 0, shakeT: 0, n: 0, sfx: 0 };
    this.invuln = Math.max(this.invuln, ULT_WINDUP + ULT_TIME + 0.6);
    this._noFocus = true;
    g.slowmo?.(0.9, 0.3);
    g.audio?.play('unibeam', { pitch: 0.5 }); g.audio?.play('thruster', { pitch: 0.7 });
    g.hud?.toast?.('PROTON CANNON');
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 7, PROTON_COL, 0.6);
    this.setAnim('charge');
  }

  _updateUlt(dt, input) {
    const g = this.game, u = this.ult;
    u.t += dt;
    this.customMovement = true;
    this.vel.x = damp(this.vel.x, 0, 4, dt); this.vel.z = damp(this.vel.z, 0, 4, dt);
    if (this.flying || !this.onGround) { this.gravityScale = 0; this.vel.y = damp(this.vel.y, 0.4 + Math.sin(g.time * 3) * 0.4, 4, dt); }
    else { this.gravityScale = 1; }
    this.faceTowards(g.cam.forward, dt, 14);
    const from = this._shoulderPos(_a).clone();
    if (u.phase === 'windup') {
      this.setAnim('charge');
      const f = clamp(u.t / ULT_WINDUP, 0, 1);
      g.cam.requestAim({ fov: 66 - f * 6, distance: 5.2, shoulder: 1.4, height: 2.2, blend: 5 });
      g.fx?.flash?.(from, PROTON_COL, 2 + f * 7, 0.06);
      // energy gathers into the cannon
      for (let i = 0; i < 2; i++) {
        _b.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(2.2 * (1 - f) + 0.2);
        g.fx?.burst?.(from.clone().add(_b), PROTON_COL, 1, 2, 0.25, 0.18);
      }
      g.cam.shake(0.03 + f * 0.08);
      rumble(g, 0.1 + f * 0.5, 0.2 + f * 0.6, 60);
      this.glows[3].set(from, 0.5 + f * 2.8 + Math.random() * 0.2, 0.5 + f * 0.5);
      if (u.t >= ULT_WINDUP) {
        u.phase = 'fire'; u.t = 0; u.tick = 0;
        g.audio?.play('unibeam'); g.audio?.play('explosion', { volume: 0.5 });
        g.cam.shake(1.0); rumble(g, 1, 1, 300);
        g.fx?.flash?.(from, 0xffffff, 10, 0.3); g.fx?.ring?.(from.clone(), 6, PROTON_COL, 0.5);
        this.vel.addScaledVector(g.cam.aimDirection(_c), -6);
      }
      return;
    }
    if (u.phase === 'fire') {
      this.setAnim('shoot');
      g.cam.requestAim({ fov: 60, distance: 5.2, shoulder: 1.4, height: 2.2, blend: 6 });
      aimInfo(this, 140, _aim);
      const dir = _aim.point.clone().sub(from).normalize();
      const hit = g.physics.raycast(from, dir, ULT_RANGE);
      const len = hit ? hit.distance : ULT_RANGE;
      const to = from.clone().addScaledVector(dir, len);
      const pulse = 1 + 0.12 * Math.sin(u.t * 38);
      this.beamFrom.copy(from); this.beamTo.copy(to); this.beamW = ULT_WIDTH * pulse; this.beamT = 0.1; this._beamSolo = false;
      this.glows[3].set(from, 2.6 + Math.random() * 0.4, 1);
      u.tick -= dt;
      if (u.tick <= 0) {
        u.tick = ULT_TICK; u.n++;
        beamDamage(this, from, dir, len, ULT_WIDTH * 0.75, ULT_TICK_DMG, 12, 0.5, 'proton', u.n % 4 === 0);
        g.combat?.aoe?.({ center: to.clone(), radius: 5, damage: 8, knockback: 9, up: 4, stun: 0.4, source: this, falloff: false });
        g.fx?.burst?.(to, PROTON_COL, 8, 10, 0.5, 0.35);
        g.fx?.flash?.(to, PROTON_COL, 6, 0.12);
        if (u.n % 3 === 0) { g.fx?.ring?.(to.clone().setY(to.y + 0.15), 5 + Math.random() * 3, PROTON_COL, 0.3); g.fx?.dust?.(to, 4, 4); }
        if (u.n % 5 === 0) { g.fx?.explosion?.(to.clone().add(_b.set(rand(-2, 2), 0.3, rand(-2, 2))), 3.2, 0xffa040); }
        // sparks along the shaft
        for (let i = 0; i < 3; i++) g.fx?.burst?.(from.clone().lerp(to, Math.random() * 0.9), PROTON_COL, 1, 3, 0.3, 0.2);
      }
      u.sfx -= dt; if (u.sfx <= 0) { u.sfx = 0.5; g.audio?.play('unibeam', { volume: 0.5, pitch: 0.8 }); }
      u.shakeT -= dt; if (u.shakeT <= 0) { u.shakeT = 0.1; rumble(g, 0.6, 0.9, 120); }
      g.cam.shake(0.07);
      this.vel.addScaledVector(dir, -1.2 * dt * 10);
      if (u.t >= ULT_TIME) { u.phase = 'end'; u.t = 0; g.cam.shake(0.4); g.audio?.play('explosion', { volume: 0.4 }); g.fx?.burst?.(from, PROTON_COL, 30, 7, 0.6, 0.3); }
      return;
    }
    // end: brief cool-down
    this.setAnim('hover');
    this.glows[3].set(from, 1, 0);
    if (u.t > 0.5) { this.ult = null; this._noFocus = false; this.actionT = 0; this.customMovement = this.flying; if (!this.flying) this.gravityScale = 1; this.beamT = 0; }
  }

  // ---- visuals -----------------------------------------------------------------------
  _startTrails() {
    const th = this.model.thrusters, fx = this.game.fx;
    if (!fx?.trail || !Array.isArray(th)) return;
    for (const o of [th[2], th[3]]) if (o) { const h = fx.trail(o, 0xaaf0ff, 0.6, 0.55); if (h) this._trails.push(h); }
  }
  _stopTrails() { for (const h of this._trails) h.stop?.(); this._trails.length = 0; }

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
    const sp = this.vel.length();
    // ---- body attitude: pitch from the flight path, roll from heading change + strafing
    let pitchT = 0;
    if (this.flying && !this.ult) {
      _a.copy(this.vel).normalize();
      const lean = this.boosting ? clamp((sp - 10) / 30, 0, 1) : 0.4 * clamp(sp / 20, 0, 1);
      pitchT = Math.acos(clamp(sp > 0.5 ? _a.y : 1, -1, 1)) * lean;
      if (this.charging) pitchT = 0;
      if (this.aiming) pitchT = 0.28 * clamp(sp / STRAFE_SPEED, 0, 1);
    }
    this.pitch = damp(this.pitch, pitchT, this.boosting ? 4.5 : 6, dt);
    let rollT = 0;
    if (this.flying && !this.ult) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const vYaw = hs > 2 ? Math.atan2(this.vel.x, this.vel.z) : this._velYaw;
      const turn = dt > 0 ? Math.atan2(Math.sin(vYaw - this._velYaw), Math.cos(vYaw - this._velYaw)) / dt : 0;
      this._velYaw = vYaw;
      // lateral velocity relative to where the suit faces (strafing while aiming)
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const lat = this.vel.x * rx + this.vel.z * rz;
      rollT = clamp(-turn * 0.42 * clamp(sp / 35, 0, 1.2), -1.15, 1.15) + clamp(-lat * 0.022, -0.45, 0.45) * (this.aiming ? 1 : 0.4);
    } else this._velYaw = Math.atan2(this.vel.x, this.vel.z);
    this.roll = damp(this.roll, rollT, 4.5, dt);
    this._lastYaw = this.yaw;
    applyTilt(this, this.pitch, this.roll);

    this._setThrust(this.thrust);

    // fallback glows (also act as palm/boot repulsor glow)
    const th = this.thrust;
    const foot = _a.set(this.pos.x, this.pos.y + 0.15, this.pos.z);
    if (!this.model.thrusters && th > 0.03) {
      foot.copy(this.model.group.localToWorld(_c.set(-0.18, 0.1, -0.05)));
      this.glows[0].set(foot, 0.6 + th * 1.4, th);
      foot.copy(this.model.group.localToWorld(_c.set(0.18, 0.1, -0.05)));
      this.glows[1].set(foot, 0.6 + th * 1.4, th);
    } else { this.glows[0].set(foot, 1, 0); this.glows[1].set(foot, 1, 0); }
    if (this.charging) {
      const c = objPos(this.model.chest, _d, this.center);
      const f = clamp(this.charge / UNIBEAM_MAX_CHARGE, 0, 1);
      this.glows[2].set(c, 0.6 + f * 2.2 + Math.random() * 0.2, 0.7 + f * 0.3);
    } else if (this.heavy > 0.05) {
      const c = this._handPos(this.handSide, _d);
      this.glows[2].set(c, 0.4 + (this.heavy / HEAVY_MAX) * 1.4 + Math.random() * 0.1, 0.8);
    } else this.glows[2].set(_d, 1, 0);
    if (!this.ult) this.glows[3].set(_d, 1, 0);

    // trail particles + thruster audio
    this.trailT -= dt;
    if (th > 0.2 && this.trailT <= 0) {
      this.trailT = this.boosting ? 0.03 : 0.07;
      const base = this.model.group.localToWorld(_b.set(0, 0.2, -0.2));
      g.fx?.burst?.(base, this.boosting ? 0xaaf0ff : 0xffaa44, this.boosting ? 3 : 2, 3, 0.35, this.boosting ? 0.3 : 0.2);
    }
    this.audioT -= dt;
    if (th > 0.2 && this.audioT <= 0) { this.audioT = 0.45; g.audio?.play('thruster', { volume: 0.25 + th * 0.35, pitch: 0.9 + th * 0.4 }); }
    if (this.boosting) { this.rumbleT -= dt; if (this.rumbleT <= 0) { this.rumbleT = 0.2; rumble(g, 0.1, 0.3, 120); } g.cam.shake(0.008 + clamp((sp - 40) / 40, 0, 1) * 0.012); }

    // unibeam / proton cannon visual
    if (this.beamT > 0) {
      this.beamT -= dt;
      const w = (this.beamW ?? 1.5) * (this.ult ? 1 : clamp(this.beamT / 0.35, 0, 1));
      if (this._beamSolo) this.beamFrom.copy(objPos(this.model.chest, _a, this.center));
      if (this.ult) {
        this.beam.show(this.beamFrom, this.beamTo, Math.max(0.05, w), 0.2);
        this.beamOuter.show(this.beamFrom, this.beamTo, Math.max(0.05, w * 2.1), 0.3);
        this.beamOuter.core.material.opacity = 0.0; this.beamOuter.glow.material.opacity = 0.28;
      } else { this.beam.show(this.beamFrom, this.beamTo, Math.max(0.05, w)); this.beamOuter.hide(); }
      if (this.beamT <= 0) { this.beam.hide(); this.beamOuter.hide(); }
    } else if (this.beam.group.visible) { this.beam.hide(); this.beamOuter.hide(); }
  }
}
