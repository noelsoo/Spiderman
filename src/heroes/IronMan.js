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
//
// Context variants (no extra bindings):
//   attack LMB/J/[]       grounded: palm-blast / thruster-punch combo (jab, jab, THRUSTER PUNCH, dual-palm blast)
//                         flying fast: dash strike.  Flying + hold dodge (descend) + attack: GROUND POUND dive
//   hold special K / R1   (unaimed, 0.35 s+) smart-targeting SHOULDER LASERS: marks up to 6 enemies, release = sweep beams
//   hold ability E / L1   (unaimed, 0.3 s+) deploy the IRON LEGION mini-drones (they shoot for ~11 s, then pop)
//   dodge C / Ctrl / O    tap on the ground = dash; tap in flight = AIR DASH (boost burst);
//                         HOLD on the ground = NANO SHIELD (blocks 88% damage, drains an energy bar); hold in flight = descend
import * as THREE from 'three';
import { Hero } from './Hero.js';
import {
  Timers, BeamMesh, GlowSprite, LockMarkers, aimInfo, assistAim, enemiesInReticle, enemyCenter, beamDamage, rumble, applyTilt,
  impactFx, precisionHit, setReticle, hitStop, clamp, damp, rand, objPos, approachVal,
} from './avengers/util.js';
import { Legion } from './ironman/legion.js';

// ---- tuning ----------------------------------------------------------------
const HOVER_SPEED = 20, STRAFE_SPEED = 15, BOOST_SPEED = 62, BOOST_MAX = 80, ASCEND = 14, BOOST_TURN = 2.3;
const MISSILE_MAX = 8, MISSILE_CD = 6, MISSILE_DMG = 40, MISSILE_RANGE = 80, MISSILE_PAINT = 0.125;
const REPULSOR_CD = 0.28, REPULSOR_DMG = 28;
const RAPID_INTERVAL = 0.11, RAPID_DMG = 15, BURST_TIME = 0.4, HEAVY_MAX = 1.0, HEAVY_MIN = 0.45, HEAVY_DMG = 78;
const UNIBEAM_CD = 12, UNIBEAM_MAX_CHARGE = 1.6, UNIBEAM_MIN_CHARGE = 0.4;
const ULT_WINDUP = 1.1, ULT_TIME = 4.5, ULT_TICK = 0.1, ULT_TICK_DMG = 20, ULT_RANGE = 100, ULT_WIDTH = 3.6;
const ARMOR_GOLD = 0xffcc33, REPULSOR_COL = 0xbff4ff, PROTON_COL = 0xffc070;
const LASER_HOLD = 0.35, LASER_CD = 10, LASER_MAX = 6, LASER_TICK = 0.1, LASER_DMG = 11;
const LEGION_HOLD = 0.3, LEGION_CD = 16, LEGION_LIFE = 11;
const NANO_HOLD = 0.2, NANO_DRAIN = 22, NANO_REGEN = 24, NANO_TAKE = 0.12;
const AIRDASH_CD = 1.3, AIRDASH_SPEED = 66, AIRDASH_T = 0.24;
const POUND_CD = 5, POUND_MIN_ALT = 4;
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
    // context powers
    this.holdS = 0; this.holdE = 0; this.legionDone = false; this.dodgeHeld = 0;
    this.laser = null; this.scanning = false; this._scanT = 0; this._scanList = [];
    this.laserMarkers = new LockMarkers(game.scene, LASER_MAX);
    this.legion = new Legion(this, 4);
    this.nano = false; this.shieldE = 100; this.nanoLock = 0; this.nanoHit = 0; this.nanoGrp = null;
    this.airDashT = 0; this.pound = null;
  }

  // ---- lifecycle -----------------------------------------------------------
  onActivate() {
    this.flying = false; this.ult = null; this.charging = false; this.actionT = 0; this.heavy = 0; this.fireHeld = 0;
    this.lock.on = false;
    this.gravityScale = 1;
    this.shieldE = 100;
  }
  onDeactivate() {
    this.legion.clear(); this.laser = null; this.scanning = false; this.laserMarkers.hideAll();
    this._nanoOff(); this.airDashT = 0; this.pound = null; this.holdS = 0; this.holdE = 0; this.legionDone = false; this.dodgeHeld = 0;
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
      { action: 'attack', label: this.flying ? 'Strike | Dive: Pound' : 'Palm / Thruster', cooldown: this.flying ? this.cooldownFrac('pound') : 0, active: !!this.pound },
      { action: 'special', label: this.holdS >= LASER_HOLD ? 'Release: Lasers' : 'Repulsor | Hold: Laser', cooldown: Math.max(this.cooldownFrac('repulsor'), this.cooldownFrac('lasers')), active: !!this.laser || this.holdS >= LASER_HOLD },
      { action: 'ability', label: this.aiming ? 'Missile Lock' : 'Missiles | Hold: Legion', cooldown: Math.max(this.cooldownFrac('missile'), this.legion.count ? 0 : this.cooldownFrac('legion')), active: this.lock.on || this.legion.count > 0 },
      { action: 'ability2', label: 'Unibeam', cooldown: this.cooldownFrac('unibeam'), active: this.charging },
      { action: 'dodge', label: this.flying ? 'Air Dash | Hold: Down' : 'Dash | Hold: Shield', cooldown: this.flying ? this.cooldownFrac('airdash') : (this.nano || this.shieldE < 99 ? 1 - this.shieldE / 100 : 0), active: this.nano },
      { action: 'ultimate', label: 'Proton Cannon', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  registerHit() { this.combo++; this.comboTimer = 2.5; if (!this._noFocus) this.addFocus(4 * this._hitFocus); }

  takeDamage(amount, fromPos) {
    if (this.ult) return false;
    if (this.nano && amount > 0 && !this.dead && this.invuln <= 0) {
      this.shieldE -= amount * 0.6; this.nanoHit = 0.3;
      amount *= NANO_TAKE; fromPos = undefined;
      const g = this.game;
      g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.4, this.pos.z), 'BLOCKED', 0xaaf0ff);
      g.fx?.burst?.(this.center, 0xaaf0ff, 12, 5, 0.3, 0.18);
      g.audio?.play('hit', { volume: 0.35, pitch: 1.5 });
    }
    const ok = super.takeDamage(amount, fromPos);
    if (ok) { this.lock.on && this._cancelLock(); this.heavy = 0; this.fireHeld = 0; }
    return ok;
  }

  // ---- main logic ------------------------------------------------------------
  updateAbilities(dt, input) {
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;
    this.legion.update(dt, this.game.time);
    this.laserMarkers.hideFrom(this.scanning ? this._scanList.length : 0);
    this._nanoUpdate(dt, this.game.input);
    this._laserUpdate(dt);

    if (this.ult) { setReticle(this, null); this._updateUlt(dt, input); this._finish(dt); return; }

    setReticle(this, this.aiming ? 'repulsor' : null);
    if (this.pound) { this._poundUpdate(dt); this._combatHolds(dt, input); this._finish(dt); return; }
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
    if (this.pound || this.airDashT > 0) tt = 1;
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
    if (this.nano) {
      const lim = this.walkSpeed * 0.45, hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > lim) { this.vel.x *= lim / hs; this.vel.z *= lim / hs; }
      this.faceTowards(this.game.cam.forward, dt, 14);
      this.setAnim('aim', hs);
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
    if (this.airDashT > 0) {
      this.airDashT -= dt; this.boosting = true;
      g.fx?.trailPuff?.(this.pos.x, this.pos.y + 0.9, this.pos.z, 0xaaf0ff, 0.9, 0.45, 0.15);
      _a.set(this.vel.x, 0, this.vel.z); if (_a.lengthSq() > 1) this.faceTowards(_a, dt, 14);
      if (this.airDashT <= 0) this.vel.multiplyScalar(0.45);
      return;
    }
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
    if (this.pound) { this._poundImpact(); return; }
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
    const busy = this.charging || this.lock.on || this.heavy > 0.05 || this.nano || !!this.laser;
    const free = this.actionT <= 0 && !busy;
    const prevHeld = this.dodgeHeld;
    this.dodgeHeld = input.down('dodge') ? this.dodgeHeld + dt : 0;

    if (input.pressed('attack') && free) {
      if (this.flying && this.dodgeHeld > 0.05 && this._groundPound()) { /* dive started */ }
      else if (this.flying && (this.boosting || this.vel.length() > 14)) this._dashPunch();
      else this._meleeCombo();
    }
    this._combatHolds(dt, input);
    if (input.pressed('ability') && !this.aiming && !busy) { this.holdE = 1e-4; this.legionDone = false; }
    if (input.pressed('ultimate') && this.focus >= 100 && !this.charging) this._startUlt();
    // dodge: tap = dash (ground) / air dash (flight); hold on the ground = nano shield (see _nanoUpdate)
    if (input.released('dodge') && prevHeld > 0 && prevHeld < NANO_HOLD && !this.charging && !this.lock.on && !this.heavy) {
      if (this.flying) this._airDash(input);
      else if (!this.nano && (this.cooldowns.dash || 0) <= 0) {
        this.useCooldown('dash', 0.8);
        const w = g.cam.moveVector(input.move, _a); if (w.lengthSq() < 0.01) w.copy(this.forward);
        w.normalize(); this.vel.x = w.x * 24; this.vel.z = w.z * 24; this.yaw = Math.atan2(w.x, w.z);
        this.invuln = Math.max(this.invuln, 0.25);
        this.actionAnim = 'dash'; this.actionT = 0.3;
        g.audio?.play('whoosh'); g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.5), 0xffb050, 12, 4, 0.3, 0.2);
      }
    }
  }

  /** Hold-vs-tap handling for special (repulsor / shoulder lasers) and ability (missiles / Iron Legion). */
  _combatHolds(dt, input) {
    const busy = this.charging || this.lock.on || this.heavy > 0.05 || this.nano || !!this.laser;
    const repReady = (this.cooldowns.repulsor || 0) <= 0 && !this.charging && !this.lock.on;
    // ---- special
    if (this.aiming) {
      this.holdS = 0; this.scanning = false;
      if (this.pressedSpecial() && repReady) this._quickRepulsor();
    } else {
      if (this._aimTap === 'special' && repReady) this._quickRepulsor();
      if (input.pressed('special') && !busy && !this.pound) this.holdS = 1e-4;
      if (this.holdS > 0) {
        const down = input.down('special');
        if (down) {
          this.holdS += dt;
          if (this.holdS >= LASER_HOLD && (this.cooldowns.lasers || 0) <= 0) this._laserScan(dt);
        }
        if (!down || input.released('special')) {
          const h = this.holdS; this.holdS = 0; this.scanning = false;
          if (h >= LASER_HOLD && (this.cooldowns.lasers || 0) <= 0) this._fireLasers();
          else if (h < LASER_HOLD && repReady) this._quickRepulsor();
        }
      }
    }
    // ---- ability (unaimed): tap = micro-missiles, hold = Iron Legion
    if (this.holdE > 0) {
      const down = input.down('ability');
      if (this.aiming || busy) this.holdE = 0;
      else {
        if (down) {
          this.holdE += dt;
          if (this.holdE >= LEGION_HOLD && !this.legionDone) { this.legionDone = true; this._deployLegion(); }
        }
        if (!down || input.released('ability')) {
          const h = this.holdE; this.holdE = 0;
          if (!this.legionDone && h < LEGION_HOLD && (this.cooldowns.missile || 0) <= 0) this._missileSalvo(this._nearestTargets(6), false);
          this.legionDone = false;
        }
      }
    }
  }

  _facingToTarget(range, cone) {
    const t = this.findTarget(range, cone);
    if (t) { _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
    return t;
  }

  _meleeCombo() {
    const g = this.game;
    const step = this.chain % 4;
    const t = this._facingToTarget(9, 80);
    const fwd = this.forward;
    const lunge = [t ? 5 : 2, t ? 5 : 2, t ? 15 : 9, 3][step];
    if (this.onGround || !this.flying) { this.vel.x += fwd.x * lunge; this.vel.z += fwd.z * lunge; }
    const anims = ['punch1', 'punch2', 'punch3', 'shoot'];
    const dmg = [16, 18, 30, 34], kn = [5, 6, 15, 18], up = [1.2, 1.2, 3.5, 6], dur = [0.3, 0.32, 0.5, 0.64], delay = [0.09, 0.09, 0.15, 0.2];
    const range = [2.7, 2.7, 3.7, 6.2], arc = [110, 110, 90, 75], stun = [0.3, 0.3, 0.7, 1.0];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.0;
    g.audio?.play('whoosh', { volume: 0.5 });
    // wind-up fx: palm charge / thruster ignition
    const side = step & 1;
    if (step === 2) {
      this.timers.after(0.02, () => {
        if (!this.active) return;
        const h = this._handPos(0, _b).clone(), back = this.forward.multiplyScalar(-1);
        g.fx?.burst?.(h.clone().addScaledVector(back, 0.35), 0xffaa44, 16, 5, 0.35, 0.28);
        g.fx?.burst?.(h.clone().addScaledVector(back, 0.35), 0xaaf0ff, 6, 3, 0.25, 0.2);
        g.fx?.glow?.(h, 0xffcc88, 1.6, 0.15); g.fx?.flash?.(h, 0xffaa55, 3, 0.12);
        g.audio?.play('thruster', { volume: 0.5, pitch: 1.3 });
      });
    } else if (step === 3) {
      g.fx?.flash?.(this.center, REPULSOR_COL, 3, 0.15);
      g.audio?.play('repulsor', { volume: 0.7, pitch: 0.7 });
    }
    this.timers.after(delay[step], () => {
      if (!this.active) return;
      this._hitFocus = 1;
      const f = this.forward;
      const hits = g.combat?.melee?.({ origin: this.center, forward: f, range: range[step], arc: arc[step], damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: stun[step], source: this, heavy: step >= 2 }) ?? [];
      // palm repulsor flashes (the hand-blasters behind the punches)
      const from = this._handPos(side, _a).clone();
      if (step < 2) {
        g.fx?.beam?.(from, from.clone().addScaledVector(f, 2.4), REPULSOR_COL, 0.16, 0.07);
        g.fx?.glow?.(from, REPULSOR_COL, 0.9, 0.08); g.fx?.flash?.(from, REPULSOR_COL, 1.8, 0.07);
      } else if (step === 2) {
        g.fx?.beam?.(from, from.clone().addScaledVector(f, 3.2), 0xffcc88, 0.3, 0.1);
        g.fx?.ring?.(from.clone().addScaledVector(f, 1.6), 1.8, 0xffcc88, 0.3);
      } else {
        for (let k = 0; k < 2; k++) {
          const hp = this._handPos(k, _c).clone();
          for (let a = -1; a <= 1; a++) {
            _d.copy(f).applyAxisAngle(UPV, a * 0.18 + (k ? 0.05 : -0.05));
            g.fx?.beam?.(hp, hp.clone().addScaledVector(_d, 6.2), REPULSOR_COL, a ? 0.12 : 0.28, 0.12);
          }
          g.fx?.flash?.(hp, REPULSOR_COL, 3, 0.12);
        }
        g.fx?.shockwave?.(this.pos.clone().addScaledVector(f, 3), 5, REPULSOR_COL);
        this.vel.x -= f.x * 5; this.vel.z -= f.z * 5;
      }
      if (hits.length) {
        for (const h of hits) g.fx?.burst?.(enemyCenter(h, _b).clone(), step === 3 ? REPULSOR_COL : ARMOR_GOLD, 10 + step * 3, 5, 0.3, 0.2);
        rumble(g, 0.3 + step * 0.15, 0.2, 90);
        if (step >= 2) { g.cam.shake(0.3); hitStop(g, 0.06, 0.05); }
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
        // close targets (< 10 m): skip the pop-up arc and launch straight at them, with a much tighter turn rate
        let close = false;
        if (target?.alive) {
          const tc = target.center ?? target.pos;
          if (tc.distanceTo(origin) < 10) { close = true; launch.copy(tc).sub(origin).normalize().multiplyScalar(26); }
        }
        g.combat?.projectile?.({
          pos: origin, vel: launch, damage: MISSILE_DMG * this.dmgMul, radius: 0.5, life: 4, color: 0xffaa44, size: 0.25,
          kind: 'missile', team: 'player', homing: target, source: this, turn: close ? 14 : (locked ? 5 : 3.5),
          update: target ? (pr, dt) => {
            // terminal guidance: inside 14 m steer hard onto the target so the missile cannot orbit or overshoot it
            const h = pr.homing; if (!h || h.alive === false) return;
            const tc = h.center ?? h.pos, d = tc.distanceTo(pr.pos);
            if (d > 14) return;
            _a.subVectors(tc, pr.pos).normalize();
            const sp = pr.vel.length();
            pr.vel.normalize().lerp(_a, Math.min(1, 12 * dt)).normalize().multiplyScalar(Math.min(sp, Math.max(16, d * 5)));
          } : undefined,
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

  // ---- flight boost: air dash ---------------------------------------------------------
  _airDash(input) {
    if (!this.useCooldown('airdash', AIRDASH_CD)) return false;
    const g = this.game, cam = g.cam;
    const aim = cam.aimDirection(_aim.dir).normalize();
    _wish.set(0, 0, 0).addScaledVector(aim, input.move.y).addScaledVector(cam.right, input.move.x);
    if (_wish.lengthSq() < 0.05) _wish.copy(aim); else _wish.normalize();
    this.vel.copy(_wish).multiplyScalar(AIRDASH_SPEED);
    this.airDashT = AIRDASH_T; this.boosting = true;
    this.invuln = Math.max(this.invuln, 0.3);
    this.fov = Math.max(this.fov, 20);
    g.fx?.ring?.(this.center, 4.5, 0xaaf0ff, 0.35);
    g.fx?.burst?.(this.center.addScaledVector(_wish, -0.8), 0xaaf0ff, 22, 8, 0.4, 0.3);
    g.fx?.flash?.(this.center, 0xaaf0ff, 4, 0.15);
    g.audio?.play('thruster', { volume: 0.8, pitch: 1.5 }); g.audio?.play('whoosh', { pitch: 0.8 });
    g.cam.shake(0.18); rumble(g, 0.4, 0.5, 120);
    this.actionAnim = 'dash'; this.actionT = 0.25; this.setAnim('dash');
    return true;
  }

  // ---- ground pound dive (flight + hold dodge + attack) ------------------------------------
  _groundPound() {
    const g = this.game;
    const alt = this.pos.y - g.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (alt < POUND_MIN_ALT) return false;
    if (!this.useCooldown('pound', POUND_CD)) return false;
    this.pound = { t: 0, from: this.pos.y };
    this.boosting = false; this.airDashT = 0; this.nano = false;
    this.vel.set(this.vel.x * 0.15, Math.min(this.vel.y, -28), this.vel.z * 0.15);
    this.invuln = Math.max(this.invuln, 0.3);
    g.audio?.play('thruster', { volume: 0.9, pitch: 0.7 }); g.audio?.play('whoosh', { pitch: 0.5 });
    g.fx?.ring?.(this.center, 3.5, ARMOR_GOLD, 0.3);
    g.hud?.toast?.('GROUND POUND');
    g.cam.shake(0.2);
    this.actionT = 0; this.setAnim('fly', 60);
    return true;
  }
  _poundUpdate(dt) {
    const g = this.game, u = this.pound;
    u.t += dt;
    this.customMovement = true; this.gravityScale = 0; this.flying = true;
    this.vel.y = Math.max(-88, Math.min(this.vel.y, -28) - 150 * dt);
    this.vel.x = damp(this.vel.x, 0, 3, dt); this.vel.z = damp(this.vel.z, 0, 3, dt);
    this.setAnim('fly', 60);
    g.fx?.trailPuff?.(this.pos.x, this.pos.y + 2.1, this.pos.z, 0xffaa44, 1.0, 0.5, 0.2);
    g.fx?.trailPuff?.(this.pos.x, this.pos.y + 2.6, this.pos.z, 0xaaf0ff, 0.7, 0.4, 0.2);
    g.cam.shake(0.05); g.cam.fovKick = Math.max(g.cam.fovKick, 14);
    if (this.onGround && u.t > 0.05) this._poundImpact();
    else if (u.t > 3.5) this.pound = null;
  }
  _poundImpact() {
    const u = this.pound; if (!u) return;
    this.pound = null;
    const g = this.game;
    const h = Math.max(0, u.from - this.pos.y);
    const r = 7 + clamp(h * 0.12, 0, 3.5), dmg = 38 + clamp(h * 1.1, 0, 30);
    const p = this.pos.clone();
    this._hitFocus = 1;
    g.combat?.aoe?.({ center: p.clone(), radius: r, damage: dmg * this.dmgMul, knockback: 20, up: 10, stun: 1.4, source: this });
    impactFx(g, p, r, ARMOR_GOLD, 0.9);
    g.fx?.shockwave?.(p.clone(), r * 1.5, 0xffd070);
    g.fx?.ring?.(p.clone().setY(p.y + 0.15), r, 0xaaf0ff, 0.5);
    g.fx?.explosion?.(p.clone(), 3.5, 0xffa040);
    g.fx?.dust?.(p, 18, r);
    g.audio?.play('land'); g.audio?.play('smash'); g.audio?.play('explosion', { volume: 0.6 });
    g.cam.shake(0.95); rumble(g, 1, 0.7, 320); hitStop(g, 0.08, 0.05);
    this.flying = false; this.customMovement = false; this.gravityScale = 1; this.boosting = false;
    this.actionAnim = 'land'; this.actionT = 0.6; this.setAnim('land');
    this._landCd = g.time;
  }

  // ---- Iron Legion mini-drones ------------------------------------------------------------
  _deployLegion() {
    const g = this.game;
    if (!this.useCooldown('legion', LEGION_CD)) { g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.6, this.pos.z), 'RECHARGING', 0xffcc33); return false; }
    for (let i = 0; i < 2; i++) {
      const from = this._shoulderSide(i, _a).clone();
      this.legion.deploy(from, LEGION_LIFE, i);
      g.fx?.burst?.(from, 0xffcc88, 10, 4, 0.3, 0.2); g.fx?.ring?.(from, 1.6, 0xaaf0ff, 0.3);
    }
    g.hud?.toast?.('IRON LEGION');
    g.audio?.play('missile', { volume: 0.4, pitch: 1.4 }); g.audio?.play('thruster', { volume: 0.4, pitch: 1.2 });
    this.actionAnim = 'cast'; this.actionT = 0.45; this.setAnim('cast');
    g.cam.shake(0.08);
    return true;
  }

  // ---- smart-targeting shoulder lasers -------------------------------------------------------
  _shoulderSide(side, out) {
    const gr = this.model.group;
    gr.updateMatrixWorld(true);
    return gr.localToWorld(out.set(side ? -0.34 : 0.34, this.height * 0.86, 0.12));
  }
  /** Up to LASER_MAX enemies, ordered left to right as seen by the camera. */
  _laserTargets() {
    const g = this.game, cam = g.cam;
    const cands = [];
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || e.removed) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d > 45) continue;
      enemyCenter(e, _e).sub(this.pos);
      const f = _e.dot(cam.forward), r = _e.dot(cam.right);
      if (f < -2) continue;
      cands.push({ e, d, az: Math.atan2(r, Math.max(0.01, f)) });
    }
    cands.sort((a, b) => a.d - b.d);
    cands.length = Math.min(cands.length, LASER_MAX);
    cands.sort((a, b) => a.az - b.az);
    return cands.map((c) => c.e);
  }
  _laserScan(dt) {
    const g = this.game;
    this.scanning = true;
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.12; this._scanList = this._laserTargets(); }
    const f = clamp((this.holdS - LASER_HOLD) / 0.4, 0, 1);
    for (let i = 0; i < this._scanList.length; i++) {
      const e = this._scanList[i];
      if (!e.alive) continue;
      enemyCenter(e, _e);
      this.laserMarkers.set(i, _e, f, g.camera.position);
    }
    this.laserMarkers.hideFrom(this._scanList.length);
    for (let k = 0; k < 2; k++) {
      const sp = this._shoulderSide(k, _d);
      g.fx?.flash?.(sp, 0xff6a3a, 1 + f * 2, 0.06);
      if (Math.random() < 0.5) g.fx?.burst?.(sp, 0xff9a60, 1, 1.5, 0.2, 0.14);
    }
    this.faceTowards(g.cam.forward, dt, 8);
    this.actionAnim = 'charge'; this.actionT = 0.1;
  }
  _fireLasers() {
    const g = this.game;
    this.laserMarkers.hideAll();
    const targets = this._laserTargets();
    if (!targets.length) { g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.6, this.pos.z), 'NO TARGETS', 0xff7a50); return false; }
    this.useCooldown('lasers', LASER_CD);
    const pts = targets.map((e) => enemyCenter(e, new THREE.Vector3()));
    this.laser = { t: 0, dur: clamp(0.5 * targets.length + 0.5, 0.9, 2.6), targets, pts, tick: 0, p: pts[0].clone(), snd: 0 };
    g.audio?.play('unibeam', { volume: 0.5, pitch: 1.7 });
    g.hud?.toast?.('SMART LASERS');
    g.cam.shake(0.12); rumble(g, 0.4, 0.6, 200);
    return true;
  }
  _laserUpdate(dt) {
    const L = this.laser; if (!L) return;
    const g = this.game, n = L.targets.length;
    L.t += dt; L.tick -= dt; L.snd -= dt;
    for (let i = 0; i < n; i++) if (L.targets[i].alive) enemyCenter(L.targets[i], L.pts[i]);
    if (L.t >= L.dur || this.dead) { this.laser = null; g.fx?.burst?.(this._shoulderSide(0, _a), 0xff9a60, 10, 4, 0.3, 0.2); return; }
    // sweep point: glides across the targets in order (smart-targeting snaps to each), dwelling on every one
    const u = clamp(L.t / L.dur, 0, 1) * Math.max(1, n - 1);
    const i0 = Math.min(n - 1, Math.floor(u)), i1 = Math.min(n - 1, i0 + 1), fr = u - i0;
    const ease = fr < 0.35 ? 0 : fr > 0.65 ? 1 : (fr - 0.35) / 0.3;
    L.p.copy(L.pts[i0]).lerp(L.pts[i1], n > 1 ? ease : 0);
    if (n === 1) { L.p.x += Math.sin(L.t * 9) * 0.5; L.p.y += Math.cos(L.t * 7) * 0.3; }
    for (let k = 0; k < 2; k++) {
      const sp = this._shoulderSide(k, _d);
      g.fx?.beam?.(sp, L.p, 0xff5a30, 0.12, 0.1);
      g.fx?.beam?.(sp, L.p, 0xffffff, 0.045, 0.09);
      g.fx?.glow?.(sp, 0xff8a50, 0.7, 0.06);
    }
    g.fx?.flash?.(L.p, 0xff7a40, 3, 0.06);
    if (Math.random() < 0.7) g.fx?.burst?.(L.p, 0xffaa60, 3, 5, 0.25, 0.18);
    this.faceTowards(_a.set(L.p.x - this.pos.x, 0, L.p.z - this.pos.z), dt, 10);
    this.actionAnim = 'shoot'; this.actionT = Math.max(this.actionT, 0.1);
    if (L.snd <= 0) { L.snd = 0.22; g.audio?.play('repulsor', { volume: 0.3, pitch: 1.9 }); }
    g.cam.shake(0.025);
    if (L.tick <= 0) {
      L.tick = LASER_TICK;
      this._hitFocus = 0.3;
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || e.removed) continue;
        enemyCenter(e, _e);
        if (_e.distanceTo(L.p) > 2.4 + (e.radius ?? 0.5)) continue;
        _c.subVectors(_e, this.pos).setY(0).normalize().multiplyScalar(3); _c.y = 1.5;
        const dealt = e.takeDamage?.(LASER_DMG * this.dmgMul, { knockback: _c.clone(), stun: 0.18, source: this, kind: 'laser' });
        if (dealt > 0) { g.fx?.hitSpark?.(_e, 0xff9a60, false); this.registerHit(); }
      }
      this._hitFocus = 1;
    }
  }

  // ---- nano shield (hold dodge on the ground) -------------------------------------------------
  _nanoBubble() {
    if (this.nanoGrp) return this.nanoGrp;
    const g = this.game;
    const grp = new THREE.Group();
    const mk = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...extra });
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mk(0xaaf0ff, 0.3, { wireframe: true }));
    const fill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mk(0x66ccff, 0.1, { side: THREE.DoubleSide }));
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 56), mk(ARMOR_GOLD, 0.7));
    const r2 = r1.clone(); r2.rotation.x = Math.PI / 2;
    grp.add(wire, fill, r1, r2);
    grp.visible = false; grp.scale.setScalar(1.7);
    g.scene.add(grp);
    this.nanoGrp = { grp, wire, fill, r1, r2 };
    return this.nanoGrp;
  }
  _nanoOn() {
    const g = this.game, b = this._nanoBubble();
    this.nano = true; b.grp.visible = true;
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 3.2, 0xaaf0ff, 0.35);
    g.fx?.burst?.(this.center, 0xaaf0ff, 16, 5, 0.4, 0.2);
    g.audio?.play('ui_select', { volume: 0.5, pitch: 0.6 }); g.audio?.play('thruster', { volume: 0.3, pitch: 1.6 });
  }
  _nanoOff() {
    this.nano = false;
    if (this.nanoGrp) this.nanoGrp.grp.visible = false;
  }
  _nanoUpdate(dt, input) {
    const g = this.game;
    if (this.nanoLock > 0) this.nanoLock -= dt;
    if (this.nanoHit > 0) this.nanoHit -= dt;
    const want = input.down('dodge') && this.dodgeHeld > NANO_HOLD && this.onGround && !this.flying && !this.ult && !this.pound
      && !this.charging && !this.lock.on && !this.laser && this.nanoLock <= 0 && this.shieldE > 6 && !this.dead;
    if (want && !this.nano) this._nanoOn();
    else if (!want && this.nano) { this._nanoOff(); g.fx?.burst?.(this.center, 0xaaf0ff, 10, 4, 0.3, 0.18); }
    if (this.nano) {
      this.shieldE -= NANO_DRAIN * dt;
      if (this.shieldE <= 0) {
        this.shieldE = 0; this.nanoLock = 2.5; this._nanoOff();
        g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z), 'SHIELD DOWN', 0xff7a50);
        g.fx?.burst?.(this.center, 0xffaa55, 24, 7, 0.5, 0.25); g.audio?.play('hit', { pitch: 0.7 });
      }
    } else this.shieldE = Math.min(100, this.shieldE + (this.nanoLock > 0 ? 10 : NANO_REGEN) * dt);
    const b = this.nanoGrp;
    if (b && b.grp.visible) {
      const low = this.shieldE < 25 ? 0.6 + 0.4 * Math.sin(g.time * 30) : 1;
      b.grp.position.copy(this.center);
      b.grp.scale.setScalar(1.7 * (1 + this.nanoHit * 0.2));
      b.wire.rotation.y += dt * 0.7; b.wire.rotation.x += dt * 0.3;
      b.r1.rotation.z += dt * 1.4; b.r2.rotation.y -= dt * 1.1;
      b.wire.material.opacity = (0.28 + this.nanoHit * 1.2) * low;
      b.fill.material.opacity = (0.08 + this.nanoHit * 0.5) * low;
    }
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
    if (this.pound) pitchT = Math.PI * 0.96;
    this.pitch = damp(this.pitch, pitchT, this.pound ? 10 : (this.boosting ? 4.5 : 6), dt);
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
