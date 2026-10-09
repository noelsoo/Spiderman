// Hulk (Marvel's Avengers style): heavy brawler. Super-jump, wall climb, smash combo, Thunderclap with a visible pressure
// wave, GRAB & THROW (enemies / boulders), body slam, ground-pound craters, Hulk Out (rage regen), Worldbreaker.
//
// Controls (keyboard / pad):
//   attack LMB/J/Square   smash combo (near a stunned enemy: grab it)
//   tap special RMB/K/R1  Thunderclap (no enemies around: rock throw);  HOLD special: grab nearest enemy, or rip up a boulder
//   holding something:    hold aim (RMB / L2) = zoomed throw view + reticle;  attack / fire = throw;  ability E/L1 = body slam
//   ability E/L1          leap smash (ground) / ground pound (air)
//   ability2 R/L2         Hulk Out (rage: damage up, damage resist, health regen)
//   jump (hold)           charge a super jump (camera pulls back at altitude)
//   ultimate Q/R3         Worldbreaker Smash
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import {
  Timers, aimInfo, assistAim, LockMarkers, PressureWaves, Craters, enemiesNear, enemyCenter, rumble, impactFx,
  setReticle, hitStop, clamp, damp,
} from './avengers/util.js';

// ---- tuning ----------------------------------------------------------------
const WALK = 7, RUN = 14, BULLDOZE = 24, CLIMB_SPEED = 8;
const SUPER_MAX_H = 45, SUPER_MIN_H = 8, CHARGE_MIN = 0.15, CHARGE_FULL = 1.25, SMALL_JUMP = 17;
const CLAP_CD = 6, CLAP_RANGE = 14, ROCK_CD = 5;
const LEAP_CD = 7, LEAP_RANGE = 40;
const RAGE_TIME = 10, RAGE_CD = 20, RAGE_DMG = 1.5, RAGE_SPEED = 1.2, RAGE_REGEN = 10, RAGE_RESIST = 0.6, RAGE_MAX = 16;
const ULT_RADIUS = 25, ULT_DMG = 220;
const GRAB_HOLD = 0.22, GRAB_RANGE = 4.6, THROW_SPEED = 48, THROW_DMG = 70;
const CAM_DIST = 9, CAM_H = 2.8;
const THROW_AIM = { fov: 55, distance: 5, shoulder: 1.2, height: 2.6 };
const GREEN = 0x55c232, DUST = 0x9a8f7a;

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _as = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();

let ROCK_GEO = null, ROCK_MAT = null;
function rockMesh() {
  ROCK_GEO = ROCK_GEO || new THREE.DodecahedronGeometry(1, 0);
  ROCK_MAT = ROCK_MAT || new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.95, flatShading: true });
  const m = new THREE.Mesh(ROCK_GEO, ROCK_MAT);
  m.scale.set(1.3, 1.1, 1.4); m.castShadow = true;
  return m;
}

export class Hulk extends Hero {
  constructor(game) {
    super(game, { id: 'hulk', name: 'Hulk', color: '#55c232', maxHp: 260, walkSpeed: WALK, runSpeed: RUN, jumpSpeed: SMALL_JUMP, gravity: 30, radius: 0.8, height: 2.7, airControl: 0.5, mass: 3 });
    this.timers = new Timers();
    this.mode = 'normal';       // normal | super | leap | dive | climb | dash | ultRise | ultSlam
    this.modeT = 0;
    this.dmgMul = 1; this.speedMul = 1;
    this.rageT = 0;
    this.jumpCharge = 0; this.charging = false;
    this.actionT = 0; this.actionAnim = 'idle';
    this.chain = 0; this.chainT = 0;
    this.stepT = 0; this.bullT = 0; this.dashT = 0;
    this.noWallT = 0; this.climbN = new THREE.Vector3(); this.climbV = 0;
    this._impactVy = 0;
    this.ult = null;
    this._camSaved = null;
    this.fov = 0; this.punch = 0; this.camExtra = 0;
    // grab & throw
    this.held = null;            // { kind: 'enemy', e, t, grav } | { kind: 'rock', mesh, t }
    this.thrown = [];            // enemies flying as projectiles
    this.specT = 0; this.specArmed = false; this._throwAiming = false;
    this.waves = new PressureWaves(game.scene, 4);
    this.craters = new Craters(game.scene, 8);
    this.marker = new LockMarkers(game.scene, 1);
    this._hitFocus = 0.75;
  }

  onActivate() {
    const c = this.game.cam;
    this._camSaved = { d: c.targetDistance, h: c.heightOffset };
    c.targetDistance = CAM_DIST; c.heightOffset = CAM_H;
    this.mode = 'normal'; this.charging = false; this.jumpCharge = 0; this.actionT = 0; this.gravityScale = 1;
    this.held = null; this.thrown.length = 0; this.specArmed = false;
  }
  onDeactivate() {
    const c = this.game.cam;
    this._release(true);
    if (this._camSaved) { c.targetDistance = this._camSaved.d; c.heightOffset = this._camSaved.h; this._camSaved = null; }
    c.fovKick = 0;
    this.timers.clear();
    this.mode = 'normal'; this.charging = false; this.rageT = 0; this.dmgMul = 1; this.speedMul = 1; this.ult = null;
    this.gravityScale = 1; this.punch = 0; this.camExtra = 0;
    this.waves.clear(); this.craters.clear(); this.marker.hideAll();
    for (const t of this.thrown) { if (t.e) t.e.gravity = t.grav; }
    this.thrown.length = 0;
    setReticle(this, null);
    this.model.setTint?.(0x55ff22, 0);
  }

  get abilityHints() {
    if (this.held) {
      return [
        { action: 'attack', label: 'Throw' },
        { action: 'ability', label: 'Body Slam' },
        { action: 'ability2', label: 'Hulk Out', cooldown: this.cooldownFrac('rage'), active: this.rageT > 0 },
        { action: 'ultimate', label: 'Worldbreaker', cooldown: 1 - this.focus / 100, active: !!this.ult },
      ];
    }
    return [
      { action: 'jump', label: 'Super Jump', cooldown: 0, active: this.charging && this.jumpCharge > CHARGE_MIN },
      { action: 'special', label: 'Thunderclap / Grab', cooldown: Math.max(this.cooldownFrac('clap'), 0) },
      { action: 'ability', label: this.onGround ? 'Leap Smash' : 'Ground Pound', cooldown: this.cooldownFrac('leap') },
      { action: 'ability2', label: 'Hulk Out', cooldown: this.cooldownFrac('rage'), active: this.rageT > 0 },
      { action: 'ultimate', label: 'Worldbreaker', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  registerHit() {
    this.combo++; this.comboTimer = 2.5;
    this.addFocus(4 * this._hitFocus);
    if (this.rageT > 0) this.rageT = Math.min(RAGE_MAX, this.rageT + 0.35);  // fury feeds on violence
  }

  takeDamage(amount, fromPos) {
    if (this.rageT > 0) amount *= RAGE_RESIST;
    return super.takeDamage(amount, fromPos);
  }

  // ---- update ----------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;
    this.modeT += dt;
    this.customMovement = true;
    this.waves.update(dt); this.craters.update(dt);

    this._rage(dt);
    this._ultTick(dt);
    this._thrownUpdate(dt);

    const busy = this.actionT > 0 || this.ult;
    if (!this.ult) {
      if (this.held) this._holdUpdate(dt, input);
      else { this._abilities(dt, input, busy); this._grabInput(dt, input, busy); this._holdReticle(false); }
    }
    this._movement(dt, input);

    this._impactVy = this.vel.y;
    // camera feel: sprint FOV, super-jump zoom-out, impact FOV punch
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.fov = damp(this.fov, this.onGround && hs > RUN + 2 ? 8 : 0, 4, dt);
    this.punch = damp(this.punch, 0, 7, dt);
    let extra = 0;
    if ((this.mode === 'super' || this.mode === 'leap' || this.mode === 'ultRise') && !this.onGround) {
      const alt = this.pos.y - g.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
      extra = clamp((alt - 5) / 32, 0, 1);
    }
    this.camExtra = damp(this.camExtra, extra, extra > this.camExtra ? 2.5 : 3.5, dt);
    g.cam.targetDistance = CAM_DIST + this.camExtra * 9;
    g.cam.heightOffset = CAM_H + this.camExtra * 1.4;
    g.cam.fovKick = this.fov + this.punch + (this.mode === 'super' ? clamp(this.vel.y / 52, 0, 1) * 6 : 0) + this.camExtra * 7 + (this.rageT > 0 ? 3 : 0);
  }

  defaultMovement() {}

  _abilities(dt, input, busy) {
    if (this.mode === 'climb') { if (input.pressed('attack') && !busy) this._meleeCombo(); return; }
    if (input.pressed('attack') && !busy) {
      if (!this.onGround && this.mode !== 'dive') this._dive();
      else if (this.onGround) {
        const gr = this._grabbable(3.2, 110, true);
        if (gr && this.chain === 0) this._grab(gr); else this._meleeCombo();
      }
    }
    if (input.pressed('ability') && !busy) {
      if (!this.onGround) { if (this.mode !== 'dive') this._dive(); }
      else if ((this.cooldowns.leap || 0) <= 0) this._leapSmash();
    }
    if (input.pressed('ability2') && (this.cooldowns.rage || 0) <= 0 && this.rageT <= 0) this._startRage();
    if (input.pressed('ultimate') && this.focus >= 100 && !this.ult) this._startUlt();
    if (input.pressed('dodge') && this.onGround && (this.cooldowns.charge || 0) <= 0 && !busy && !this.charging) this._shoulderCharge(input);
  }

  // special: tap = Thunderclap, hold = grab / rip boulder
  _grabInput(dt, input, busy) {
    if (this.mode === 'climb' || this.ult) { this.specArmed = false; return; }
    if (input.pressed('special') && !busy) { this.specT = 0; this.specArmed = true; }
    if (!this.specArmed) return;
    if (input.down('special')) {
      this.specT += dt;
      if (this.specT >= GRAB_HOLD && this.onGround) {
        this.specArmed = false;
        const e = this._grabbable(GRAB_RANGE, 120, false);
        if (e) this._grab(e); else this._ripRock();
      }
    } else {
      this.specArmed = false;
      if (!busy && (this.cooldowns.clap || 0) <= 0) this._clap();
    }
  }

  // ---- movement ----------------------------------------------------------------
  _movement(dt, input) {
    const g = this.game, cam = g.cam;
    const wish = cam.moveVector(input.move, _w);
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();
    const mul = this.speedMul * (this.held ? 0.72 : 1);
    const noMove = this.actionT > 0 && this.mode === 'normal';

    // --- special modes first
    if (this.mode === 'ultRise' || this.mode === 'ultSlam') { this._ultMove(dt); return; }
    if (this.mode === 'dash') { this._dashMove(dt); return; }
    if (this.mode === 'dive') { this.gravityScale = 2.2; this.setAnim('smash'); return; }

    // wall climb
    if (this.mode === 'climb') { this._climb(dt, input, wish, mag); return; }
    this.noWallT += dt; this.grabCd = (this.grabCd ?? 0) - dt;
    if (!this.held && this.grabCd <= 0 && !this.onGround && this.onWall && input.move.y > 0.3 && this.mode !== 'leap') {
      _a.copy(this.wallNormal).negate();
      if (wish.dot(_a) > 0.35 || this.vel.y < 6 && wish.dot(_a) > 0) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
    }
    if (!this.held && this.grabCd <= 0 && this.onGround && this.onWall && mag > 0.4 && this.mode === 'normal' && !this.charging) {
      _a.copy(this.wallNormal).negate();
      if (wish.dot(_a) > 0.6 && this._wallTall()) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
    }

    this.gravityScale = 1;

    // --- jump charge
    if (this.onGround && this.mode !== 'leap' && !this.held) {
      if (input.down('jump') && !noMove) {
        this.charging = true; this.jumpCharge += dt;
        if (this.jumpCharge > CHARGE_MIN) {
          const f = clamp((this.jumpCharge - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1);
          g.cam.shake(0.01 + f * 0.04);
          this._chargeFxT = (this._chargeFxT ?? 0) - dt;
          if (this._chargeFxT <= 0) {
            this._chargeFxT = 0.12;
            g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.2), DUST, 4, 3 + f * 3, 0.5, 0.35);
            g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 3.5 - f * 2, GREEN, 0.25);
            if (f >= 1) rumble(g, 0.2, 0.5, 100);
          }
        }
      }
      if (this.charging && (input.released('jump') || !input.down('jump'))) this._releaseJump(input, wish, mag);
    } else if (this.charging) { this.charging = false; this.jumpCharge = 0; }

    // --- ground / air locomotion
    const bull = input.down('swing') && this.onGround && mag > 0.1 && !this.charging && !noMove && !this.held;
    const run = bull ? BULLDOZE : (input.down('sprint') || mag > 0.95 ? RUN : WALK);
    let speed = run * mag * mul;
    if (this.charging || noMove) speed *= this.charging ? 0.25 : 0.15;
    const airborne = !this.onGround;
    if (this.mode === 'leap' && airborne) {
      /* keep the arc */
    } else {
      const ctrl = airborne ? 0.45 : 1;
      const accel = (airborne ? 22 : bull ? 38 : 55) * ctrl;
      const tx = wish.x * speed, tz = wish.z * speed;
      this.vel.x = approach(this.vel.x, tx, accel * dt);
      this.vel.z = approach(this.vel.z, tz, accel * dt);
      if (this._throwAiming) this.faceTowards(cam.forward, dt, 14);
      else if (mag > 0.01 && !noMove && !this.charging) this.faceTowards(wish, dt, airborne ? 4 : 8);
    }
    if (this.mode === 'super' && this.onGround && this.modeT > 0.2) this.mode = 'normal';

    // --- footsteps / bulldoze: heavy, car-sized thuds
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 6) {
      this.stepT -= dt;
      const cad = bull ? 0.26 : hs > RUN - 1 ? 0.34 : 0.48;
      if (this.stepT <= 0) {
        this.stepT = cad;
        g.cam.shake(bull ? 0.1 : hs > RUN - 1 ? 0.04 : 0.014);
        g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.1), DUST, 3, 3, 0.4, 0.3);
        if (bull) g.fx?.dust?.(this.pos, 4, 2.5);
        if (hs > RUN - 1) { g.audio?.play('land', { volume: 0.3, pitch: 0.55 }); rumble(g, 0.18, 0.12, 60); }
      }
    }
    if (bull) {
      this.bullT -= dt;
      if (this.bullT <= 0) {
        this.bullT = 0.22;
        const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 3.4, arc: 120, damage: 14 * this.dmgMul, knockback: 16, up: 3, stun: 0.5, source: this }) ?? [];
        if (hits.length) { g.audio?.play('heavyhit', { volume: 0.6 }); g.cam.shake(0.18); rumble(g, 0.5, 0.3, 90); }
      }
    }

    // --- anim
    if (this.actionT > 0 && this.mode === 'normal') this.setAnim(this.actionAnim, hs);
    else if (this.held && this.onGround) this.setAnim(this._throwAiming ? 'aim' : (hs > 0.5 ? 'run' : 'idle'), hs);
    else if (this.charging && this.jumpCharge > CHARGE_MIN) this.setAnim('charge');
    else if (this.onGround) this.setAnim(hs > 0.5 ? (bull || hs > WALK + 1 ? 'sprint' : 'run') : 'idle', hs);
    else this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', hs);
  }

  _releaseJump(input, wish, mag) {
    const g = this.game;
    const charge = this.jumpCharge;
    this.charging = false; this.jumpCharge = 0;
    this.onGround = false;
    if (charge < CHARGE_MIN) {
      this.vel.y = SMALL_JUMP; g.audio?.play('jump', { pitch: 0.6 }); return;
    }
    const f = clamp((charge - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1);
    const H = SUPER_MIN_H + (SUPER_MAX_H - SUPER_MIN_H) * f;
    this.vel.y = Math.sqrt(2 * this.gravity * H);
    if (mag > 0.1) { this.vel.x = wish.x * (10 + 14 * f); this.vel.z = wish.z * (10 + 14 * f); }
    else { const fw = this.forward; this.vel.x = fw.x * 6 * f; this.vel.z = fw.z * 6 * f; }
    this.mode = 'super'; this.modeT = 0;
    impactFx(g, this.pos, 5 + f * 6, DUST, 0.3 + f * 0.5);
    this._crater(this.pos, 2.5 + f * 3);
    this.waves.spawn(this.pos.clone().setY(this.pos.y + 0.2), 6 + f * 7, 0xffffff, 0.45, 0.4);
    g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.3), DUST, 30, 9, 0.8, 0.4);
    g.audio?.play('smash', { volume: 0.7 }); g.audio?.play('roar', { volume: 0.4 + f * 0.3 });
    rumble(g, 0.4 + f * 0.5, 0.6, 250);
    this.punch += 6 + f * 6;
    g.combat?.aoe?.({ center: this.pos.clone(), radius: 4 + f * 3, damage: 10 + f * 20, knockback: 10, up: 7, stun: 0.6, source: this });
  }

  _crater(pos, radius) {
    this.craters.spawn(pos, radius);
  }

  // ---- wall climbing (smoothed) ----------------------------------------------------
  _wallTall() {
    _a.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z);
    _b.copy(this.wallNormal).negate();
    const hit = this.game.physics.raycast(_a, _b, this.radius + 1.2, { ignoreGround: true });
    return !!hit;
  }
  _startClimb() {
    this.mode = 'climb'; this.modeT = 0; this.noWallT = 0; this.climbV = Math.max(0, this.vel.y * 0.4);
    this.climbN.copy(this.wallNormal);
    this.charging = false; this.jumpCharge = 0;
    this.game.audio?.play('smash', { volume: 0.45 });
    this.game.fx?.burst?.(this.pos.clone().setY(this.pos.y + 1.5), DUST, 14, 5, 0.5, 0.3);
    this.game.fx?.dust?.(this.pos.clone().setY(this.pos.y + 1.2), 4, 1.5);
    this.game.cam.shake(0.12); this.punch += 3;
    this.actionT = 0;
  }
  _climb(dt, input, wish, mag) {
    const g = this.game;
    this.gravityScale = 0;
    if (this.onWall) { this.noWallT = 0; this.climbN.copy(this.wallNormal); } else this.noWallT += dt;
    const n = this.climbN;
    // leap off the wall, away from it and up
    if (input.pressed('jump')) {
      this.mode = 'normal'; this.gravityScale = 1;
      this.vel.set(n.x * 16, 20, n.z * 16); this.grabCd = 0.4;
      g.audio?.play('jump', { pitch: 0.6 }); this.onWall = false;
      this.yaw = Math.atan2(n.x, n.z);
      this.punch += 4;
      return;
    }
    // let go
    if (input.move.y < -0.4 || (this.onGround && input.move.y <= 0.1)) {
      this.mode = 'normal'; this.gravityScale = 1; this.vel.set(n.x * 3, 0, n.z * 3); return;
    }
    if (this.noWallT > 0.18) {
      // cleared the ledge: mantle over it in one smooth heave
      this.mode = 'normal'; this.gravityScale = 1;
      this.vel.set(-n.x * 6.5, 11, -n.z * 6.5); this.grabCd = 0.6;
      g.audio?.play('whoosh'); g.cam.shake(0.1); return;
    }
    const upT = input.move.y > 0.15 ? CLIMB_SPEED * this.speedMul : input.move.y < -0.15 ? -5 : 0;
    this.climbV = damp(this.climbV, upT, 9, dt);            // ease into / out of the climb
    _a.set(-n.z, 0, n.x);
    const side = Math.sign(g.cam.right.dot(_a)) || 1;
    const lat = input.move.x * 5 * side * this.speedMul;
    const tx = -n.x * 3 + _a.x * lat, tz = -n.z * 3 + _a.z * lat;
    this.vel.x = damp(this.vel.x, tx, 12, dt); this.vel.z = damp(this.vel.z, tz, 12, dt);
    this.vel.y = this.climbV;
    this.faceTowards(_b.set(-n.x, 0, -n.z), dt, 14);
    this.setAnim(Math.abs(this.climbV) > 0.8 ? 'wallrun' : 'wallidle', Math.abs(this.climbV));
    this.stepT -= dt;
    if (this.stepT <= 0 && Math.abs(this.climbV) > 1) {
      this.stepT = 0.4; g.cam.shake(0.06); rumble(g, 0.12, 0.1, 50);
      g.fx?.burst?.(this.pos.clone().setY(this.pos.y + this.height * 0.8), DUST, 5, 4, 0.5, 0.3);
      g.audio?.play('punch', { volume: 0.35, pitch: 0.6 });
    }
  }

  // ---- landing ---------------------------------------------------------------------
  onLand() {
    const g = this.game;
    const vy = -this._impactVy;
    let r = 0, dmg = 0, shake = 0, kind = 'normal';
    if (this.mode === 'ultSlam') { this._ultImpact(); return; }
    if (this.mode === 'dive') { r = 9; dmg = 85; shake = 1.0; kind = 'dive'; }
    else if (this.mode === 'leap') { r = 8; dmg = 70; shake = 0.9; kind = 'leap'; }
    else if (this.mode === 'super' || vy > 20) { r = clamp(4 + vy * 0.2, 4, 15); dmg = 25 + vy * 1.4; shake = clamp(0.3 + vy * 0.016, 0.3, 1.2); kind = 'super'; }
    else if (vy > 13) { r = 3.5; dmg = 12; shake = 0.2; }
    if (this.mode !== 'climb') { this.mode = 'normal'; this.gravityScale = 1; }
    if (r > 0) {
      const hits = g.combat?.aoe?.({ center: this.pos.clone(), radius: r, damage: dmg * this.dmgMul, knockback: 12 + r, up: 8, stun: 1.0, source: this }) ?? [];
      impactFx(g, this.pos, r, GREEN, shake);
      g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), r * 0.6, DUST, 0.7);
      g.audio?.play('smash'); if (kind !== 'normal') g.audio?.play('heavyhit', { volume: 0.7 });
      rumble(g, clamp(shake, 0.3, 1), 0.6, 120 + shake * 300);
      if (kind !== 'normal') {
        this.actionAnim = 'land'; this.actionT = 0.35; this.setAnim('land');
        this._crater(this.pos, Math.min(9, r * 0.8));
        this.waves.spawn(this.pos.clone().setY(this.pos.y + 0.2), r * 1.1, 0xffffff, 0.5, 0.45);
        this.punch += 8;
        if (hits.length || r >= 8) hitStop(g, 0.07, 0.05);
      }
      this.vel.x *= 0.2; this.vel.z *= 0.2;
    }
  }

  // ---- melee: smash combo -------------------------------------------------------------
  _meleeCombo() {
    const g = this.game;
    const step = this.chain % 3;
    const t = this.findTarget(10, 80);
    if (t) { _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
    const fw = this.forward;
    this.vel.x += fw.x * (t ? 6 : 2.5); this.vel.z += fw.z * (t ? 6 : 2.5);
    // long wind-ups: the weight of the blow is in the anticipation
    const anims = ['punch1', 'punch2', 'smash'], dmg = [40, 42, 75], kn = [12, 12, 26], up = [3, 3, 10], dur = [0.5, 0.5, 0.9], delay = [0.2, 0.2, 0.36];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.3;
    g.audio?.play('whoosh', { volume: 0.7, pitch: 0.6 });
    this.timers.after(delay[step], () => {
      if (!this.active) return;
      const fwd = this.forward;
      this._hitFocus = 0.75;
      const hits = g.combat?.melee?.({ origin: this.center, forward: fwd, range: 3.8, arc: 140, damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: step === 2 ? 1.2 : 0.4, source: this, heavy: step === 2 }) ?? [];
      for (const h of hits) g.fx?.burst?.(enemyCenter(h, _b).clone(), 0xffffff, 8, 6, 0.3, 0.25);
      if (hits.length) { g.audio?.play(step === 2 ? 'smash' : 'heavyhit'); rumble(g, 0.5 + step * 0.2, 0.4, 120); if (step === 2) hitStop(g, 0.08, 0.05); }
      g.cam.shake(0.14 + step * 0.22);
      if (step === 2) {
        const c = this.pos.clone().addScaledVector(fwd, 3.2);
        g.combat?.aoe?.({ center: c, radius: 5.5, damage: 30 * this.dmgMul, knockback: 14, up: 6, stun: 0.8, source: this });
        impactFx(g, c, 5.5, DUST, 0.35);
        this._crater(c, 3.2);
        this.waves.spawn(c.clone().setY(c.y + 0.2), 6, 0xffffff, 0.35, 0.5);
        g.audio?.play('smash', { volume: 0.8 });
        if (this.rageT > 0) g.fx?.ring?.(c.clone().setY(c.y + 0.2), 8, GREEN, 0.5);
      }
    });
  }

  _dive() {
    const g = this.game;
    this.mode = 'dive'; this.modeT = 0; this.charging = false;
    this.vel.x *= 0.2; this.vel.z *= 0.2; this.vel.y = -48;
    this.gravityScale = 2.2;
    this.setAnim('smash');
    g.audio?.play('roar', { volume: 0.5 }); g.audio?.play('whoosh');
    g.cam.shake(0.15);
  }

  _shoulderCharge(input) {
    const g = this.game;
    this.useCooldown('charge', 1.6);
    const w = g.cam.moveVector(input.move, _a); if (w.lengthSq() < 0.01) w.copy(this.forward);
    w.setY(0).normalize();
    this.dashDir = w.clone(); this.mode = 'dash'; this.modeT = 0; this.dashT = 0.45; this.hitT = 0;
    this.yaw = Math.atan2(w.x, w.z); this.invuln = Math.max(this.invuln, 0.45);
    g.audio?.play('roar', { volume: 0.5 }); g.cam.shake(0.2); this.punch += 4;
  }
  _dashMove(dt) {
    const g = this.game;
    this.gravityScale = 1;
    this.dashT -= dt; this.hitT -= dt;
    this.vel.x = this.dashDir.x * 32; this.vel.z = this.dashDir.z * 32;
    this.setAnim('dash', 32);
    if (this.hitT <= 0) {
      this.hitT = 0.1;
      this._hitFocus = 0.5;
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.dashDir, range: 3.4, arc: 150, damage: 30 * this.dmgMul, knockback: 22, up: 5, stun: 1.0, source: this }) ?? [];
      if (hits.length) { g.audio?.play('heavyhit'); g.cam.shake(0.3); rumble(g, 0.6, 0.4, 120); hitStop(g, 0.05, 0.08); }
      this._hitFocus = 0.75;
    }
    this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.15; g.cam.shake(0.07); g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.1), DUST, 4, 3, 0.4, 0.3); g.fx?.dust?.(this.pos, 3, 2); }
    if (this.dashT <= 0 || this.onWall) { this.mode = 'normal'; this.vel.x *= 0.4; this.vel.z *= 0.4; }
  }

  // ---- thunderclap / rock ----------------------------------------------------------------
  _clap() {
    const g = this.game;
    const near = enemiesNear(g, this.pos, CLAP_RANGE);
    if (!near.length) { this._rock(); return; }
    this.useCooldown('clap', CLAP_CD);
    const t = near[0];
    _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z);
    this.actionAnim = 'cast'; this.actionT = 0.65; this.setAnim('cast');
    // anticipation: both fists gather, the air tightens
    g.audio?.play('roar', { volume: 0.35, pitch: 1.2 });
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 1.4), 5, 0xffffff, 0.3);
    this.punch -= 3;
    this.timers.after(0.3, () => {
      if (!this.active) return;
      const fwd = this.forward, p = this.pos;
      for (const e of enemiesNear(g, p, CLAP_RANGE)) {
        _b.subVectors(e.pos, p).setY(0);
        const d = _b.length(); if (d > 0.01) _b.divideScalar(d);
        if (d > 1.5 && _b.dot(fwd) < Math.cos(THREE.MathUtils.degToRad(75))) continue;
        const kb = _b.clone().multiplyScalar(18 + (CLAP_RANGE - d) * 0.8); kb.y = 6;
        const dealt = e.takeDamage?.((30 + (CLAP_RANGE - d) * 1.2) * this.dmgMul, { knockback: kb, stun: 2.6, source: this, kind: 'clap' });
        if (dealt > 0) { g.fx?.hitSpark?.(enemyCenter(e, _c), 0xffffff, true); g.fx?.text?.(_c.set(e.pos.x, e.pos.y + e.height + 0.4, e.pos.z), String(Math.round(dealt)), 0xffffff, { size: 1.3 }); this.registerHit(); }
      }
      const hands = p.clone().addScaledVector(fwd, 1.6).setY(p.y + 1.6);
      const c = p.clone().addScaledVector(fwd, 4);
      this.waves.spawn(hands, CLAP_RANGE, 0xffffff, 0.55, 0.9);
      this.timers.after(0.07, () => this.waves.spawn(hands, CLAP_RANGE * 0.75, 0xbfff99, 0.45, 0.8));
      g.fx?.shockwave?.(c, 12, 0xffffff);
      g.fx?.dust?.(c, 22, 9, 0.2);
      g.fx?.ring?.(p.clone().setY(p.y + 1.2), 8, 0xffffff, 0.4);
      g.fx?.ring?.(c.clone().setY(c.y + 1), 14, GREEN, 0.6);
      g.fx?.flash?.(c.clone().setY(c.y + 1.5), 0xffffff, 6, 0.2);
      g.audio?.play('clap');
      g.cam.shake(0.85); rumble(g, 1, 1, 300); this.punch += 14;
      hitStop(g, 0.07, 0.05);
    });
  }

  _rock() {
    const g = this.game;
    if ((this.cooldowns.rock || 0) > 0) return;
    this.useCooldown('rock', ROCK_CD); this.useCooldown('clap', 1.0);
    const fwd = this.forward;
    const ground = this.pos.clone().addScaledVector(fwd, 3.5);
    g.fx?.burst?.(ground, DUST, 30, 7, 0.8, 0.5);
    g.fx?.ring?.(ground.clone().setY(ground.y + 0.1), 3, DUST, 0.5);
    this._crater(ground, 2.2);
    g.audio?.play('smash', { volume: 0.7 }); g.cam.shake(0.3); rumble(g, 0.5, 0.4, 150);
    this.actionAnim = 'throw'; this.actionT = 0.75; this.setAnim('throw');
    this.timers.after(0.4, () => {
      if (!this.active) return;
      const from = this.pos.clone(); from.y += this.height + 0.6; from.addScaledVector(this.forward, 0.8);
      const aa = assistAim(this, from, 70, 8, _as);
      this._launchRock(null, from, aa.point.clone(), aa.target);
    });
  }

  /** Throw a boulder (optionally the held mesh) from `from` at `to`. */
  _launchRock(mesh, from, to, target) {
    const g = this.game;
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    const speed = 38, tt = dist / speed, grav = 10;
    const vel = dir.clone().multiplyScalar(speed); vel.y += 0.5 * grav * tt;
    let done = false;
    const m = mesh ?? rockMesh();
    if (!m.parent) g.scene.add(m);
    const boom = (p) => {
      if (done) return; done = true;
      const c = (p?.pos ?? to).clone();
      g.combat?.aoe?.({ center: c, radius: 6, damage: 55 * this.dmgMul, knockback: 16, up: 8, stun: 1.2, source: this });
      impactFx(g, c, 6, DUST, 0.55); g.audio?.play('smash'); g.audio?.play('explosion', { volume: 0.4 });
      g.fx?.dust?.(c, 14, 5);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 7, 0xffffff, 0.4, 0.5);
      this._crater(c, 3);
      for (let i = 0; i < 6; i++) g.fx?.burst?.(c.clone().add(_d.set((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3)), 0x7a7468, 3, 8, 0.7, 0.35);
      m.parent?.remove(m);
    };
    g.combat?.projectile?.({ pos: from, vel, damage: 90 * this.dmgMul, radius: 1.3, life: 4, gravity: grav, color: 0x8a7f70, size: 1.3, kind: 'rock', team: 'player', pierce: false, source: this, mesh: m, onHit: (tg, p) => boom(p), onExpire: (p) => boom(p) });
    g.audio?.play('throw'); g.cam.shake(0.18); rumble(g, 0.4, 0.3, 120);
    void target;
  }

  // ---- grab & throw ---------------------------------------------------------------------------
  /** Best enemy to grab: in front, not a boss, light enough. stunnedOnly = only already-staggered ones. */
  _grabbable(range, coneDeg, stunnedOnly) {
    const g = this.game, fwd = this.forward;
    const cos = Math.cos(THREE.MathUtils.degToRad(coneDeg * 0.5));
    let best = null, bs = 1e9;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || e.isBoss || (e.mass ?? 1) > 2.5 || e.untargetable) continue;
      if (stunnedOnly && !(e.stunTimer > 0.9 || e.webTimer > 0.5)) continue;
      _b.subVectors(e.pos, this.pos).setY(0);
      const d = _b.length();
      if (d > range + e.radius) continue;
      if (d > 0.8 && _b.divideScalar(d).dot(fwd) < cos) continue;
      const score = d - (e.stunned ? 1.5 : 0);
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }

  _grab(e) {
    const g = this.game;
    _a.subVectors(e.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z);
    this.held = { kind: 'enemy', e, t: 0, grav: e.gravity };
    e.gravity = 0; e.vel.set(0, 0, 0); e.stunTimer = Math.max(e.stunTimer, 1); e.webTimer = 0; e.launched = false;
    e.interrupt?.();
    this.actionAnim = 'cast'; this.actionT = 0.35; this.setAnim('cast');
    g.audio?.play('roar', { volume: 0.4, pitch: 0.9 }); g.audio?.play('punch', { volume: 0.7, pitch: 0.7 });
    g.fx?.burst?.(enemyCenter(e, _b).clone(), 0xffffff, 10, 5, 0.3, 0.2);
    g.cam.shake(0.2); rumble(g, 0.5, 0.3, 120);
    g.hud?.toast?.('GRABBED: LMB throw, hold aim to target, E slam');
  }

  _ripRock() {
    const g = this.game;
    if ((this.cooldowns.rip || 0) > 0 || !this.onGround) return;
    this.useCooldown('rip', 1.5);
    const fwd = this.forward;
    const ground = this.pos.clone().addScaledVector(fwd, 3);
    g.fx?.burst?.(ground, DUST, 28, 7, 0.8, 0.5);
    g.fx?.dust?.(ground, 12, 4);
    g.fx?.ring?.(ground.clone().setY(ground.y + 0.1), 3.5, DUST, 0.5);
    this._crater(ground, 2.4);
    const mesh = rockMesh(); mesh.position.copy(ground); g.scene.add(mesh);
    this.held = { kind: 'rock', mesh, t: 0 };
    this.actionAnim = 'cast'; this.actionT = 0.5; this.setAnim('cast');
    g.audio?.play('smash', { volume: 0.7 }); g.cam.shake(0.3); rumble(g, 0.5, 0.4, 150);
    g.hud?.toast?.('BOULDER: LMB throw, hold aim to target');
  }

  /** Where the held object rides: above and slightly ahead of the head. */
  _holdPoint(out, lift = 0) {
    const f = this.forward;
    return out.set(this.pos.x + f.x * 0.35, this.pos.y + this.height + 0.55 + lift, this.pos.z + f.z * 0.35);
  }

  _holdUpdate(dt, input) {
    const g = this.game, h = this.held;
    h.t += dt;
    const rawBusy = this.actionT > 0 && (this.actionAnim === 'smash' || this.actionAnim === 'throw');
    // keep the held object riding on the hands
    if (h.kind === 'enemy') {
      const e = h.e;
      if (!e.alive || e.removed) { this._release(false); return; }
      this._holdPoint(_a, h.slam ? 0.8 : 0);
      e.pos.set(_a.x, _a.y - e.height * 0.5, _a.z);
      e.vel.set(0, 0, 0); e.gravity = 0; e.launched = false;
      e.stunTimer = Math.max(e.stunTimer, 0.5); e.downTimer = Math.max(e.downTimer, 0.5);
      e.yaw = this.yaw; e.center.set(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z);
      if (Math.random() < 0.08) g.fx?.burst?.(enemyCenter(e, _b).clone(), 0xffffff, 1, 1.5, 0.2, 0.1);
    } else {
      this._holdPoint(_a, 0.5 + Math.sin(g.time * 3) * 0.05);
      h.mesh.position.copy(_a); h.mesh.rotation.y += dt * 0.6;
    }
    // aim (zoomed throw view)
    const aiming = input.down('aim') && !g.weapons?.equipped;
    this._throwAiming = aiming;
    this._holdReticle(aiming);
    if (aiming) {
      g.cam.requestAim(THROW_AIM);
      this.faceTowards(g.cam.forward, dt, 18);
      // lock-on marker on the assisted target
      const aa = assistAim(this, this._holdPoint(_d), 80, 8, _as, h.kind === 'enemy' ? h.e : null);
      if (aa.target) this.marker.set(0, enemyCenter(aa.target, _c), 1, g.camera.position); else this.marker.hideAll();
    } else this.marker.hideAll();
    if (rawBusy || h.slam || h.t < 0.25) return;
    if (input.pressed('attack') || input.pressed('fire')) { this._throwHeld(aiming); return; }
    if (input.pressed('ability')) { if (h.kind === 'enemy') this._bodySlam(); else this._throwHeld(aiming); return; }
    if (input.pressed('ability2') && (this.cooldowns.rage || 0) <= 0 && this.rageT <= 0) this._startRage();
    if (input.pressed('ultimate') && this.focus >= 100 && !this.ult) { this._release(false); this._startUlt(); return; }
    if (input.pressed('dodge')) this._release(false);          // drop it
  }

  _holdReticle(on) {
    setReticle(this, on ? 'hex' : null);
    if (!on && !this.held) this.marker.hideAll();
  }

  _release(silent) {
    const h = this.held; if (!h) return;
    if (h.kind === 'enemy') { const e = h.e; if (e) { e.gravity = h.grav; e.downTimer = 0.6; e.stunTimer = Math.max(e.stunTimer, 0.6); } }
    else { h.mesh.parent?.remove(h.mesh); }
    this.held = null; this._throwAiming = false;
    this._holdReticle(false);
    void silent;
  }

  _throwHeld(aimed) {
    const g = this.game, h = this.held;
    const from = this._holdPoint(_a).clone();
    const aa = assistAim(this, from, 85, aimed ? 6 : 12, _as, h.kind === 'enemy' ? h.e : null);
    const to = aa.point.clone();
    this.held = null; this._throwAiming = false; this._holdReticle(false); this.marker.hideAll();
    _b.subVectors(to, this.pos).setY(0); if (_b.lengthSq() > 0.01) this.yaw = Math.atan2(_b.x, _b.z);
    this.actionAnim = 'throw'; this.actionT = 0.6; this.setAnim('throw');
    g.cam.shake(0.35); rumble(g, 0.7, 0.5, 160); this.punch += 5;
    g.audio?.play('roar', { volume: 0.5 });
    g.fx?.ring?.(from.clone(), 3, 0xffffff, 0.3);
    if (h.kind === 'rock') { this._launchRock(h.mesh, from, to, aa.target); return; }
    const e = h.e;
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    const tt = dist / THROW_SPEED;
    e.gravity = h.grav; e.pos.set(from.x, from.y - e.height * 0.5, from.z);
    e.vel.copy(dir).multiplyScalar(THROW_SPEED); e.vel.y += 0.5 * (h.grav || 28) * tt;
    e.launched = true; e.stunTimer = 2; e.downTimer = 0; e.onGround = false;
    this.thrown.push({ e, t: 0, grav: h.grav, hit: new Set() });
    g.audio?.play('throw'); g.audio?.play('whoosh', { volume: 0.8 });
    g.fx?.flash?.(from, 0xffffff, 3, 0.1);
  }

  _bodySlam() {
    const g = this.game, h = this.held;
    h.slam = true;
    this.actionAnim = 'smash'; this.actionT = 0.95; this.setAnim('smash');
    g.audio?.play('roar', { volume: 0.5, pitch: 0.8 }); g.cam.shake(0.1);
    this.timers.after(0.42, () => {
      if (!this.active || !this.held || this.held !== h) return;
      const e = h.e;
      const c = this.pos.clone().addScaledVector(this.forward, 2.6);
      // slam the enemy into the ground in front of Hulk
      e.gravity = h.grav; e.pos.set(c.x, c.y, c.z); e.vel.set(0, -10, 0);
      this.held = null; this._throwAiming = false; this._holdReticle(false); this.marker.hideAll();
      e.takeDamage?.(120 * this.dmgMul, { knockback: new THREE.Vector3(0, 4, 0), stun: 2.2, source: this, kind: 'slam' });
      e.downTimer = 1.2; e.stunTimer = Math.max(e.stunTimer, 2);
      g.fx?.text?.(_a.set(c.x, c.y + 2.6, c.z), 'BODY SLAM', 0xffd24a, { size: 1.5, life: 1.1 });
      g.combat?.aoe?.({ center: c, radius: 6, damage: 60 * this.dmgMul, knockback: 16, up: 8, stun: 1.2, source: this });
      impactFx(g, c, 6.5, DUST, 1.0);
      this._crater(c, 3.8);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 8, 0xffffff, 0.45, 0.45);
      g.fx?.hitSpark?.(enemyCenter(e, _b), 0xffd070, true);
      g.audio?.play('smash'); g.audio?.play('heavyhit');
      rumble(g, 1, 0.8, 300); this.punch += 9; hitStop(g, 0.09, 0.05);
    });
  }

  /** Thrown enemies act as projectiles: they knock down everything they hit and burst on impact. */
  _thrownUpdate(dt) {
    const g = this.game;
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const t = this.thrown[i], e = t.e;
      t.t += dt;
      if (!e.alive || e.removed) { this.thrown.splice(i, 1); continue; }
      e.launched = true;
      const sp = e.vel.length();
      for (const o of g.enemies?.list ?? []) {
        if (o === e || !o.alive || t.hit.has(o) || o.untargetable) continue;
        const rr = e.radius + o.radius + 0.5;
        const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (e.pos.y > o.pos.y + o.height + 0.5 || e.pos.y + e.height < o.pos.y - 0.5) continue;
        t.hit.add(o);
        _b.copy(e.vel).setY(0).normalize().multiplyScalar(14); _b.y = 6;
        const dealt = o.takeDamage?.(THROW_DMG * this.dmgMul, { knockback: _b.clone(), stun: 1.6, source: this, kind: 'throw' });
        g.fx?.hitSpark?.(enemyCenter(o, _c), 0xffd070, true);
        if (dealt > 0) g.fx?.text?.(_a.set(o.pos.x, o.pos.y + o.height + 0.5, o.pos.z), String(Math.round(dealt)), 0xffb030, { size: 1.35 });
        e.takeDamage?.(25, { stun: 1.5, source: this, kind: 'throw' });
        g.audio?.play('heavyhit'); g.cam.shake(0.3); rumble(g, 0.6, 0.4, 100); hitStop(g, 0.06, 0.06);
        this.registerHit();
      }
      const spent = t.t > 0.15 && (e.onGround || sp < 14);
      if (spent || t.t > 3) {
        const c = e.pos.clone();
        g.combat?.aoe?.({ center: c, radius: 4.5, damage: 40 * this.dmgMul, knockback: 14, up: 6, stun: 1.0, source: this });
        impactFx(g, c, 4.5, DUST, 0.6);
        g.fx?.dust?.(c, 8, 3);
        g.audio?.play('smash', { volume: 0.7 });
        if (e.alive) e.takeDamage?.(30, { stun: 1.2, source: this, kind: 'throw' });
        this.thrown.splice(i, 1);
      }
    }
  }

  // ---- leap smash ---------------------------------------------------------------------------
  _leapSmash() {
    const g = this.game;
    aimInfo(this, LEAP_RANGE, _aim);
    const t = this.findTarget(LEAP_RANGE, 70);
    const dest = t ? t.pos.clone() : _aim.point.clone();
    let d = dest.clone().sub(this.pos); const hd = Math.hypot(d.x, d.z);
    if (hd > LEAP_RANGE) { d.x *= LEAP_RANGE / hd; d.z *= LEAP_RANGE / hd; }
    if (hd < 4) { _a.copy(this.forward).multiplyScalar(8); d.x = _a.x; d.z = _a.z; }
    d.y = clamp(d.y, -30, 40);
    const H = Math.hypot(d.x, d.z);
    const T = clamp(H / 28, 0.8, 1.5);
    const gr = this.gravity;
    this.useCooldown('leap', LEAP_CD);
    this.vel.set(d.x / T, (d.y + 0.5 * gr * T * T) / T, d.z / T);
    this.yaw = Math.atan2(d.x, d.z);
    this.onGround = false; this.mode = 'leap'; this.modeT = 0; this.gravityScale = 1;
    g.audio?.play('roar', { volume: 0.7 }); g.audio?.play('smash', { volume: 0.5 });
    impactFx(g, this.pos, 5, DUST, 0.35);
    this._crater(this.pos, 2.4);
    this.punch += 5;
    this.setAnim('jump');
  }

  // ---- Hulk Out (rage) ---------------------------------------------------------------------------------------
  _startRage() {
    const g = this.game;
    this.useCooldown('rage', RAGE_CD);
    this.rageT = RAGE_TIME; this.dmgMul = RAGE_DMG; this.speedMul = RAGE_SPEED;
    this.actionAnim = 'cast'; this.actionT = 1.0; this.setAnim('cast');          // chest-beating roar
    this.invuln = Math.max(this.invuln, 0.9);
    g.audio?.play('roar'); g.cam.shake(0.8); rumble(g, 0.8, 0.8, 500); this.punch += 12;
    g.slowmo?.(0.35, 0.4);
    this.waves.spawn(this.pos.clone().setY(this.pos.y + 1.2), 11, GREEN, 0.7, 0.9);
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 9, GREEN, 0.7);
    g.fx?.burst?.(this.center, GREEN, 40, 9, 0.8, 0.35);
    g.fx?.dust?.(this.pos, 10, 4);
    g.hud?.toast?.('HULK OUT!');
  }
  _rage(dt) {
    if (this.rageT <= 0) return;
    this.rageT -= dt;
    const pulse = 0.4 + 0.12 * Math.sin(this.game.time * 10);
    this.model.setTint?.(0x44ff22, this.rageT > 0 ? pulse : 0);
    this._rageFx = (this._rageFx ?? 0) - dt;
    if (this._rageFx <= 0) { this._rageFx = 0.14; this.game.fx?.burst?.(this.center.add(_a.set((Math.random() - 0.5) * 1.4, (Math.random() - 0.3), (Math.random() - 0.5) * 1.4)), GREEN, 2, 2.5, 0.5, 0.28); }
    if (!this.dead) this.heal?.(dt * RAGE_REGEN);
    if (this.rageT <= 0) { this.dmgMul = 1; this.speedMul = 1; this.model.setTint?.(0x44ff22, 0); this.game.hud?.toast?.('Rage over'); }
  }

  // ---- ultimate: Worldbreaker Smash --------------------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this.focus = 0; this.charging = false; this._release(false);
    const t = this.findTarget(45, 120);
    this.ult = { target: t ? t.pos.clone() : this.pos.clone().addScaledVector(this.forward, 10), t: 0 };
    this.mode = 'ultRise'; this.modeT = 0; this.gravityScale = 0;
    this.invuln = Math.max(this.invuln, 3);
    this.vel.set(0, 42, 0);
    g.audio?.play('roar'); g.cam.shake(0.6); g.slowmo?.(0.6, 0.35);
    g.hud?.toast?.('WORLDBREAKER');
    impactFx(g, this.pos, 8, GREEN, 0.5);
    this.waves.spawn(this.pos.clone().setY(this.pos.y + 0.3), 10, GREEN, 0.5, 0.45);
    this._crater(this.pos, 4);
    this.setAnim('jump');
  }
  _ultTick(dt) {
    if (!this.ult) return;
    this.ult.t += dt;
    if (this.ult.t > 5) { this.ult = null; this.mode = 'normal'; this.gravityScale = 1; }
  }
  _ultMove(dt) {
    const g = this.game, u = this.ult;
    if (!u) { this.mode = 'normal'; return; }
    _a.subVectors(u.target, this.pos).setY(0);
    const hd = _a.length(); if (hd > 0.01) _a.divideScalar(hd);
    if (this.mode === 'ultRise') {
      this.gravityScale = 0;
      this.vel.y = 42 * clamp(1 - this.modeT / 1.1, 0.15, 1);
      this.vel.x = _a.x * Math.min(hd / 1.3, 24); this.vel.z = _a.z * Math.min(hd / 1.3, 24);
      this.yaw = Math.atan2(_a.x, _a.z);
      this.setAnim('jump');
      g.cam.shake(0.04);
      if (this.modeT > 0.85) {
        this.mode = 'ultSlam'; this.modeT = 0; this.gravityScale = 2.5;
        this.vel.set(_a.x * Math.min(hd / 0.7, 30), -80, _a.z * Math.min(hd / 0.7, 30));
        g.audio?.play('whoosh'); g.audio?.play('roar', { volume: 0.7 });
      }
    } else {
      this.gravityScale = 2.5;
      this.setAnim('smash');
      this.vel.x = damp(this.vel.x, _a.x * Math.min(hd * 3, 30), 6, dt);
      this.vel.z = damp(this.vel.z, _a.z * Math.min(hd * 3, 30), 6, dt);
      this.vel.y = Math.min(this.vel.y, -50);
      if (this.modeT > 3) this._ultImpact();
    }
  }
  _ultImpact() {
    const g = this.game;
    this.mode = 'normal'; this.gravityScale = 1; this.ult = null;
    const c = this.pos.clone();
    g.combat?.aoe?.({ center: c, radius: ULT_RADIUS, damage: ULT_DMG * this.dmgMul, knockback: 32, up: 18, stun: 3, source: this, falloff: true });
    impactFx(g, c, ULT_RADIUS, GREEN, 1.5);
    g.fx?.shockwave?.(c.clone(), ULT_RADIUS * 0.6, 0xffffff);
    g.fx?.flash?.(c.clone().setY(c.y + 2), 0xbfff99, 8, 0.4);
    g.fx?.burst?.(c.clone().setY(c.y + 0.5), DUST, 80, 16, 1.2, 0.6);
    this.waves.spawn(c.clone().setY(c.y + 0.3), ULT_RADIUS * 1.1, 0xffffff, 0.8, 0.35);
    this.timers.after(0.12, () => this.waves.spawn(c.clone().setY(c.y + 0.3), ULT_RADIUS * 0.8, GREEN, 0.7, 0.4));
    this._crater(c, 11);
    this.timers.after(0.15, () => g.fx?.ring?.(c.clone().setY(c.y + 0.1), ULT_RADIUS * 0.8, GREEN, 0.9));
    this.timers.after(0.3, () => g.fx?.ring?.(c.clone().setY(c.y + 0.1), ULT_RADIUS, DUST, 1.1));
    g.audio?.play('smash'); g.audio?.play('explosion'); g.audio?.play('roar');
    rumble(g, 1, 1, 800); this.punch += 18;
    g.slowmo?.(0.5, 0.2);
    this.actionAnim = 'land'; this.actionT = 0.7; this.setAnim('land');
    this.vel.set(0, 0, 0);
  }

  updateVisuals(dt) {
    // enemy meshes are positioned by the enemy manager; nothing scene-side to maintain here
  }
}
