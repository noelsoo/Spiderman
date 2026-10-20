// Wolverine: feral speed, claw combo with bleed, Lunge maul, Claw Spin, Berserker Rage, Healing Factor, Weapon X frenzy.
//   attack J/LMB/□   special K/RMB/R1 Lunge   ability E/L1 Claw Spin   ability2 R/L2 Berserker Rage   ultimate Q/R3 Weapon X
//   dodge C/○ = roll;  dodge while holding sprint/swing = slide;  attack in air = diving claw drop (POUNCE onto an enemy below);  walk into walls = claw climb
//   v3 powers (context variants, no new bindings):
//   special K/R1       Lunge (far)  |  Grab & Throw "Fastball" (enemy within 3.4 m, aimed with the camera)  |  Pin Takedown (stunned / webbed / nearly dead enemy)
//   ability E/L1       TAP Claw Spin   |  HOLD (0.22 s) Feral Sense: enemies glow through walls, scent lines (8 s max)
//   ability2 R/L2      TAP Berserker Rage  |  HOLD (0.35 s) Feral Roar: staggers everything within 10 m
//   attack in air      Pounce from height (homes in on the enemy below)   jump held on a wall = slow claw-dig climb (sprint = fast)
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { SlashPool, DigMarks, Wounds, SenseOverlay } from './wolverine/fx.js';
import { Timers, aimInfo, enemiesNear, enemyCenter, rumble, impactFx, clamp, damp, objPos, hurt, trailOn, impact } from './squad/util.js';

// ---- tuning ----------------------------------------------------------------
const WALK = 7, RUN = 12.5, SPRINT = 16, CLIMB = 11, JUMP = 15, GRAV = 28;
const LUNGE_RANGE = 18, LUNGE_CD = 3, LUNGE_SPEED = 44;
const SPIN_CD = 6, SPIN_RADIUS = 5, SPIN_TIME = 0.8;
const RAGE_TIME = 10, RAGE_CD = 20, RAGE_DMG = 1.6, RAGE_ATK = 1.6, RAGE_SPEED = 1.12;
const HEAL_DELAY = 2.5, HEAL_RATE = 6;
const BLEED_TIME = 3, BLEED_TICK = 0.5, BLEED_DMG = 2.4;
const ULT_RANGE = 25, ULT_MAX = 8, ULT_DASH = 0.13, ULT_SLASH = 0.1;
const HOLD_SENSE = 0.22, HOLD_ROAR = 0.35, SENSE_MAX = 8, SENSE_CD = 5, SENSE_RANGE = 70;
const ROAR_CD = 14, ROAR_RADIUS = 10;
const GRAB_RANGE = 3.4, GRAB_CD = 4, THROW_SPEED = 30, THROW_DMG = 28;
const PIN_RANGE = 8, PIN_CD = 2.5, POUNCE_RANGE = 26, POUNCE_SPEED = 38;
const CLIMB_SLOW = 6.5;
const GOLD = 0xffd060, BLOOD = 0xb01818, RED = 0xff2a1a, GREEN = 0x55ff77, STEEL = 0xe8f0ff;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };

export class Wolverine extends Hero {
  constructor(game) {
    super(game, { id: 'wolverine', name: 'Wolverine', color: '#f2c230', maxHp: 200, walkSpeed: WALK, runSpeed: RUN, jumpSpeed: JUMP, gravity: GRAV, radius: 0.4, height: 1.65, airControl: 0.6, mass: 1 });
    this.timers = new Timers();
    this.mode = 'normal';       // normal | climb | roll | slide | lunge | dive | ult
    this.modeT = 0;
    this.dmgMul = 1; this.atkSpeed = 1; this.speedMul = 1;
    this.rageT = 0;
    this.actionT = 0; this.actionAnim = 'idle';
    this.chain = 0; this.chainT = 0; this.bufferT = 0;
    this.spinT = 0; this.spinTick = 0; this.spinFxT = 0;
    this.clawsOut = false; this.clawT = 99;
    this.sinceHit = 99; this.regenning = false;
    this.bleeds = new Map();
    this.lunge = null; this.ult = null;
    this.sprintT = 0; this.stepT = 0; this.airT = 0;
    this.noWallT = 0; this.grabCd = 0; this.climbN = new THREE.Vector3(); this.climbFx = 0;
    this.moveDir = new THREE.Vector3(0, 0, 1); this.modeSpeed = 0;
    this.slideHit = 0; this.rollHeld = false;
    this.fov = 0; this._impactVy = 0; this._tintOn = false; this._trail = null;
    this.slash = new SlashPool(game.scene);
    this.dig = new DigMarks(game.scene);
    this.wounds = new Wounds(this.model, this.height);
    this.senseFx = new SenseOverlay(game.scene);
    this.senseOn = false; this.senseT = 0; this._scentT = 0;
    this._abT = 0; this._ab2T = 0; this._roared = false; this._senseHeld = false;
    this.grab = null; this.thrown = [];
    this.spKind = 'lunge';
  }

  onActivate() {
    this.mode = 'normal'; this.modeT = 0; this.actionT = 0; this.spinT = 0; this.gravityScale = 1;
    this.lunge = null; this.ult = null; this.sinceHit = 99;
    this.dmgMul = 1; this.atkSpeed = 1; this.speedMul = 1; this.rageT = 0;
  }
  onDeactivate() {
    const g = this.game;
    this.timers.clear(); this.bleeds.clear();
    this.mode = 'normal'; this.lunge = null; this.pounceE = null; this.spinT = 0; this.gravityScale = 1;
    if (this.ult) { this.ult = null; g._slowmo = 0; g.timeScale = 1; }
    this.rageT = 0; this.dmgMul = 1; this.atkSpeed = 1; this.speedMul = 1;
    this.model.setTint?.(RED, 0); this._tintOn = false;
    this._setClaws(false);
    this._trail?.stop?.(); this._trail = null;
    g.cam.fovKick = 0;
    this._senseStop(true);
    this.grab = null; this.thrown.length = 0; this._abT = 0; this._ab2T = 0; this._roared = false;
    this.slash.clear(); this.dig.clear(); this.wounds.hide();
  }

  get abilityHints() {
    const sp = this.spKind === 'throw' ? 'Grab & Throw' : this.spKind === 'pin' ? 'Pin Takedown' : 'Lunge';
    const spCd = this.spKind === 'throw' ? 'grab' : this.spKind === 'pin' ? 'pin' : 'lunge';
    return [
      { action: 'attack', label: this.onGround ? 'Claw Combo' : 'Pounce (air)', cooldown: 0, active: this.mode === 'pounce' || this.mode === 'dive' },
      { action: 'special', label: sp, cooldown: this.cooldownFrac(spCd), active: this.mode === 'lunge' || !!this.grab },
      { action: 'ability', label: 'Claw Spin (hold: Sense)', cooldown: this.senseOn ? 0 : Math.max(this.cooldownFrac('spin'), this.cooldownFrac('sense')), active: this.spinT > 0 || this.senseOn },
      { action: 'ability2', label: 'Rage (hold: Roar)', cooldown: this.cooldownFrac('rage'), active: this.rageT > 0 },
      { action: 'ultimate', label: 'Weapon X', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  /** Total damage multiplier (rage x Captain's rally). */
  dm() { return this.dmgMul * ((this.game.rallyUntil ?? 0) > this.game.time ? 1.3 : 1); }

  takeDamage(amount, fromPos) {
    const ok = super.takeDamage(amount, fromPos);
    if (ok) { this.sinceHit = 0; this.regenning = false; }
    return ok;
  }
  onAttackEvaded() {
    if (this.mode === 'roll' || this.mode === 'slide') { this.addFocus(6); this.game.fx?.text?.(this.center.setY(this.pos.y + this.height + 0.5), 'DODGE', GOLD); }
  }

  // ---- update ----------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;
    this.modeT += dt;
    this.customMovement = true;

    this._regen(dt); this._rage(dt); this._bleed(dt); this._claws(dt);
    this._tint();

    if (this.spinT > 0) this._spinTick(dt);
    if (this.ult) this._ultTick(dt);
    if (this.onGround) { this.airT = 0; } else this.airT += dt;

    const normal = this.mode === 'normal';
    const free = normal && this.actionT <= 0 && this.spinT <= 0;
    if (!this.ult) {
      if (input.pressed('attack')) {
        if (this.mode === 'climb') { if (this.actionT <= 0) this._combo(); }
        else if (free) this._attack();
        else if (normal) this.bufferT = 0.3;
      }
      if (this.bufferT > 0) { this.bufferT -= dt; if (free && normal) { this.bufferT = 0; this._attack(); } }
      this._specialUpdate(input, normal);
      this._abilityUpdate(dt, input, normal);
      if (input.pressed('dodge') && normal && (this.cooldowns.dodge || 0) <= 0) this._dodge(input);
      if (input.pressed('ultimate') && this.focus >= 100) this._startUlt();
    }
    this._grabUpdate(dt);
    this._movement(dt, input);

    this._impactVy = this.vel.y;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.fov = damp(this.fov, this.onGround && hs > RUN + 1.5 ? 9 : this.mode === 'lunge' ? 12 : 0, 4, dt);
    g.cam.fovKick = this.fov;
  }

  defaultMovement() {}

  // ---- passive / status --------------------------------------------------------
  _regen(dt) {
    this.sinceHit += dt;
    this.regenning = false;
    if (this.dead || this.hp >= this.maxHp) return;
    if (this.sinceHit > HEAL_DELAY) {
      this.heal(HEAL_RATE * dt * (this.rageT > 0 ? 2.5 : 1)); this.regenning = true;
      this._regenFx = (this._regenFx ?? 0) - dt;
      if (this._regenFx <= 0) {   // visible wounds closing: green motes knitting up the body
        this._regenFx = 0.22;
        const c = this.center; c.x += (Math.random() - 0.5) * 0.7; c.y += (Math.random() - 0.5) * 1.0; c.z += (Math.random() - 0.5) * 0.7;
        this.game.fx?.burst?.(c, GREEN, 3, 1.2, 0.6, 0.12);
        this._regenN = (this._regenN ?? 0) + 1;
        if (this._regenN % 4 === 0) this.game.fx?.text?.(this.pos.clone().setY(this.pos.y + this.height + 0.4), '+' + Math.round(HEAL_RATE * 0.9), GREEN);
      }
    }
    else if (this.rageT > 0) this.heal(2 * dt);
  }
  _tint() {
    let c = 0, a = 0;
    if (this.rageT > 0) { c = RED; a = 0.32 + 0.1 * Math.sin(this.game.time * 11); }
    else if (this.regenning) { c = GREEN; a = 0.07 + 0.05 * Math.sin(this.game.time * 6); }
    if (a > 0) { this.model.setTint?.(c, a); this._tintOn = true; }
    else if (this._tintOn) { this.model.setTint?.(RED, 0); this._tintOn = false; }
  }
  _claws(dt) {
    this.clawT += dt;
    if (this.clawsOut && this.clawT > 3 && !this.ult) this._setClaws(false);
  }
  _setClaws(on) {
    if (on === this.clawsOut) return;
    this.clawsOut = on;
    this.model.setClaws?.(on);
    if (on) {
      this.game.audio?.play('whoosh', { volume: 0.3, pitch: 2 });
      this.game.fx?.glow?.(objPos(this.model.handR, _c, this.center), STEEL, 0.9, 0.15);
    }
  }
  _extend() { this.clawT = 0; this._setClaws(true); }

  _applyBleed(e) { if (e && e.alive !== false) this.bleeds.set(e, { t: BLEED_TIME, tick: BLEED_TICK }); }
  _bleed(dt) {
    for (const [e, b] of this.bleeds) {
      if (!e.alive) { this.bleeds.delete(e); continue; }
      b.t -= dt; b.tick -= dt;
      if (b.tick <= 0) {
        b.tick += BLEED_TICK;
        const c = e.center ?? e.pos;
        e.takeDamage?.(BLEED_DMG * this.dm(), { stun: 0, source: this, kind: 'bleed' });
        this.game.fx?.burst?.(c, BLOOD, 4, 3, 0.4, 0.14);
        if (this.rageT > 0) this.heal(0.8);
      }
      if (b.t <= 0) this.bleeds.delete(e);
    }
  }
  _hitFx(hits, heal = 0.04) {
    for (const h of hits) {
      this._applyBleed(h);
      if (this.rageT > 0) this.heal(h.maxHp ? h.maxHp * heal * 0.25 : 1);
    }
  }

  _startRage() {
    const g = this.game;
    this.useCooldown('rage', RAGE_CD);
    this.rageT = RAGE_TIME; this.dmgMul = RAGE_DMG; this.atkSpeed = RAGE_ATK; this.speedMul = RAGE_SPEED;
    this.invuln = Math.max(this.invuln, 0.4);
    this._extend();
    this.actionAnim = 'smash'; this.actionT = 0.6; this.setAnim('smash');
    g.audio?.play('roar'); g.cam.shake(0.6); rumble(g, 0.8, 0.8, 350);
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 8, RED, 0.7);
    g.fx?.burst?.(this.center, RED, 40, 9, 0.8, 0.3);
    g.hud?.toast?.('BERSERKER RAGE');
  }
  _rage(dt) {
    if (this.rageT <= 0) return;
    this.rageT -= dt;
    this._rageFx = (this._rageFx ?? 0) - dt;
    if (this._rageFx <= 0) { this._rageFx = 0.16; this.game.fx?.burst?.(this.center.add(_a.set((Math.random() - 0.5) * 1.1, Math.random() - 0.3, (Math.random() - 0.5) * 1.1)), RED, 2, 2, 0.5, 0.22); }
    if (this.rageT <= 0) { this.dmgMul = 1; this.atkSpeed = 1; this.speedMul = 1; this.game.hud?.toast?.('Rage over'); }
  }

  // ---- movement ----------------------------------------------------------------
  _movement(dt, input) {
    const g = this.game, cam = g.cam;
    const wish = cam.moveVector(input.move, _w);
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();

    switch (this.mode) {
      case 'lunge': this._lungeMove(dt); return;
      case 'pounce': this._pounceMove(dt); return;
      case 'ult': this._ultMove(dt); return;
      case 'roll': this._rollMove(dt, input); return;
      case 'slide': this._slideMove(dt, input); return;
      case 'dive': this.gravityScale = 2; this.setAnim('smash'); this._extend(); if (this.modeT > 2.5) this._endMode(); return;
      case 'climb': this._climb(dt, input, wish, mag); return;
      default: break;
    }
    this.noWallT += dt; this.grabCd -= dt;
    // claw-climb: pressing into a wall in the air, or a tall wall from the ground
    if (this.grabCd <= 0 && this.onWall && (input.move.y > 0.3 || (!this.onGround && input.down('jump') && this.vel.y < 5))) {
      _a.copy(this.wallNormal).negate();
      if (!this.onGround && (wish.dot(_a) > 0.3 || this.vel.y < 6 || input.down('jump'))) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
      if (this.onGround && mag > 0.4 && wish.dot(_a) > 0.6 && this._wallTall()) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
    }
    this.gravityScale = this.spinT > 0 ? 0.35 : 1;

    // run / sprint (momentum builds the sprint)
    const heldSprint = input.down('sprint') || input.down('swing');
    if (this.onGround && mag > 0.9) this.sprintT += dt; else if (this.onGround) this.sprintT = Math.max(0, this.sprintT - dt * 3);
    const sprint = heldSprint || this.sprintT > 0.8;
    const base = sprint ? SPRINT : mag > 0.6 ? RUN : WALK;
    let speed = base * mag * this.speedMul;
    const attacking = this.actionT > 0 && this.actionAnim !== 'dodge';
    if (attacking) speed *= 0.45;
    if (this.spinT > 0) speed *= 0.6;
    const airborne = !this.onGround;
    const accel = airborne ? 24 : 70;
    this.vel.x = approach(this.vel.x, wish.x * speed, accel * dt);
    this.vel.z = approach(this.vel.z, wish.z * speed, accel * dt);
    if (this.spinT > 0) this.yaw += 16 * dt;
    else if (mag > 0.01 && !attacking) this.faceTowards(wish, dt, airborne ? 6 : 14);

    if (this.onGround && input.pressed('jump')) {
      this.vel.y = JUMP; this.onGround = false; g.audio?.play('jump', { pitch: 1.2 });
      const f = this.forward; const h = Math.hypot(this.vel.x, this.vel.z);
      if (h > 4) { this.vel.x += f.x * 2.5; this.vel.z += f.z * 2.5; }
      this.model.setClaws?.(this.clawsOut);
    }
    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 7) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = hs > RUN + 1 ? 0.2 : 0.3;
        if (hs > RUN + 1) { g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.08), 0x9a8f7a, 2, 2.5, 0.3, 0.18); g.audio?.play('land', { volume: 0.12, pitch: 1.4 }); }
      }
    }
    if (this.actionT > 0 && this.actionAnim) this.setAnim(this.actionAnim, hs);
    else if (this.spinT > 0) this.setAnim('punch3', hs);
    else if (this.onGround) this.setAnim(hs > 0.5 ? (hs > RUN + 1 ? 'sprint' : 'run') : 'idle', hs);
    else this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', hs);
  }

  _endMode() { this.mode = 'normal'; this.modeT = 0; this.gravityScale = 1; }

  // wall climbing
  _wallTall() {
    _a.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z);
    _b.copy(this.wallNormal).negate();
    return !!this.game.physics.raycast(_a, _b, this.radius + 1.2, { ignoreGround: true });
  }
  _startClimb() {
    this.mode = 'climb'; this.modeT = 0; this.noWallT = 0;
    this.climbN.copy(this.wallNormal);
    this._extend();
    this.game.audio?.play('punch', { volume: 0.35, pitch: 1.5 });
    this.game.fx?.burst?.(this.pos.clone().setY(this.pos.y + 1.2), STEEL, 10, 5, 0.4, 0.12);
  }
  _climb(dt, input, wish, mag) {
    const g = this.game, n = this.climbN;
    this.gravityScale = 0;
    this._extend();
    if (this.onWall) { this.noWallT = 0; n.copy(this.wallNormal); } else this.noWallT += dt;
    if (input.pressed('jump')) {
      this._endMode(); this.vel.set(n.x * 14, 22, n.z * 14); this.grabCd = 0.35; this.onWall = false;
      this.yaw = Math.atan2(n.x, n.z);
      g.audio?.play('jump', { pitch: 1.3 }); return;
    }
    if (input.move.y < -0.4 || (this.onGround && input.move.y <= 0.1)) { this._endMode(); this.vel.set(n.x * 3, 0, n.z * 3); return; }
    if (this.noWallT > 0.15) { this._endMode(); this.vel.set(-n.x * 8, 11, -n.z * 8); this.grabCd = 0.5; g.audio?.play('whoosh'); return; }
    const fast = input.down('sprint') || input.down('swing');
    const up = input.move.y > 0.15 ? (fast ? CLIMB : CLIMB_SLOW) : input.move.y < -0.15 ? -6 : input.down('jump') ? CLIMB_SLOW * 0.5 : 0;
    _a.set(-n.z, 0, n.x);
    const side = Math.sign(g.cam.right.dot(_a)) || 1;
    const lat = input.move.x * 8 * side;
    this.vel.set(-n.x * 3 + _a.x * lat, up, -n.z * 3 + _a.z * lat);
    this.yaw = Math.atan2(-n.x, -n.z);
    this.setAnim(up !== 0 || Math.abs(lat) > 0.5 ? 'wallrun' : 'wallidle', Math.abs(up));
    this.climbFx -= dt;
    if (this.climbFx <= 0 && (up !== 0 || Math.abs(lat) > 0.5)) {
      this.climbFx = 0.17;
      this._digSide = -(this._digSide ?? 1);
      _a.set(this.pos.x - n.x * (this.radius + 0.05), this.pos.y + this.height * (0.75 + 0.2 * this._digSide), this.pos.z - n.z * (this.radius + 0.05));
      this.dig.add(_a, n);
      g.fx?.sparks?.(_a.clone(), n, STEEL, 6, 5, 0.3, 0.08);
      g.fx?.dust?.(_a.clone(), 2, 0.5, 0.3);
      g.audio?.play('punch', { volume: 0.2, pitch: 1.8 });
    }
    if (this.actionT > 0) this.setAnim(this.actionAnim);
  }

  // ---- dodge: roll / slide ---------------------------------------------------------
  _dodge(input) {
    const g = this.game;
    this.useCooldown('dodge', 0.55);
    const w = g.cam.moveVector(input.move, _a);
    if (w.lengthSq() < 0.01) w.copy(this.forward);
    w.setY(0).normalize();
    this.moveDir.copy(w); this.yaw = Math.atan2(w.x, w.z);
    this.spinT = 0; this.actionT = 0; this.bufferT = 0; this.chain = 0;
    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    const slide = this.onGround && (input.down('sprint') || input.down('swing')) && speedNow > 8;
    this.mode = slide ? 'slide' : 'roll'; this.modeT = 0; this.slideHit = 0;
    this.modeSpeed = slide ? Math.max(speedNow, 15) : 15;
    this.invuln = Math.max(this.invuln, slide ? 0.3 : 0.45);
    g.audio?.play('dodge');
    if (slide) { this._extend(); g.fx?.dust?.(this.pos.clone(), 8, 1.2); }
  }
  _rollMove(dt) {
    this.gravityScale = 1;
    const k = Math.max(0.25, 1 - this.modeT / 0.42);
    this.vel.x = this.moveDir.x * this.modeSpeed * k; this.vel.z = this.moveDir.z * this.modeSpeed * k;
    this.setAnim('dodge', this.modeSpeed);
    if (this.modeT > 0.42) this._endMode();
  }
  _slideMove(dt, input) {
    this.gravityScale = 1;
    const k = Math.max(0.45, 1 - this.modeT / 1.4);
    const sp = this.modeSpeed * k;
    this.vel.x = this.moveDir.x * sp; this.vel.z = this.moveDir.z * sp;
    this.setAnim('dash', sp);
    this.slideHit -= dt;
    if (this.slideHit <= 0) {
      this.slideHit = 0.12;
      const hits = this.game.combat?.melee?.({ origin: this.center, forward: this.moveDir, range: 2.4, arc: 130, damage: 10 * this.dm(), knockback: 6, up: 2, stun: 0.4, source: this }) ?? [];
      if (hits.length) { this._hitFx(hits); this.game.audio?.play('punch', { volume: 0.5 }); }
      this.game.fx?.sparks?.(this.pos.clone().setY(this.pos.y + 0.05), _d.set(0, 1, 0), STEEL, 3, 4, 0.2, 0.06);
    }
    if (input.pressed('jump') && this.onGround) {
      this._endMode(); this.vel.y = JUMP; this.onGround = false; this.game.audio?.play('jump', { pitch: 1.2 }); return;
    }
    if (this.modeT > 0.9 || !this.onGround && this.modeT > 0.2) this._endMode();
  }

  // ---- melee: 4-hit claw combo, air dive -------------------------------------------
  _attack() {
    if (!this.onGround && this.airT > 0.15) { this._dive(); return; }
    this._combo();
  }
  _combo() {
    const g = this.game;
    this._extend();
    const step = this.chain % 4, spd = this.atkSpeed;
    const t = this.findTarget(9, 80);
    if (t) { _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
    const fw = this.forward;
    this.vel.x += fw.x * (t ? 5 : 2.5); this.vel.z += fw.z * (t ? 5 : 2.5);
    const anims = ['punch1', 'punch2', 'kick', 'uppercut'];
    const dmg = [13, 13, 15, 24], kn = [5, 5, 7, 12], up = [1.5, 1.5, 2, 8];
    const dur = [0.27, 0.27, 0.3, 0.46], delay = [0.07, 0.07, 0.09, 0.13];
    this.actionAnim = anims[step]; this.actionT = dur[step] / spd; this.setAnim(anims[step]);
    this.chain++; this.chainT = 0.9;
    g.audio?.play('whoosh', { volume: 0.45, pitch: 1.5 + step * 0.08 });
    this.timers.after(delay[step] / spd, () => {
      if (!this.active || this.mode === 'lunge' || this.mode === 'ult') return;
      const fwd = this.forward;
      const hits = g.combat?.melee?.({ origin: this.center, forward: fwd, range: 2.9, arc: 130, damage: dmg[step] * this.dm(), knockback: kn[step], up: up[step], stun: step === 3 ? 0.9 : 0.35, source: this }) ?? [];
      this._slashFx(fwd, step);
      if (hits.length) { this._hitFx(hits); g.audio?.play(step === 3 ? 'heavyhit' : 'punch', { volume: 0.7 }); impact(g, 0.15 + step * 0.12, step === 3); }
      if (step === 3) {
        // fast chained finisher: crossing double slash
        this.timers.after(0.1 / spd, () => {
          if (!this.active || this.mode !== 'normal') return;
          const f2 = this.forward;
          const h2 = g.combat?.melee?.({ origin: this.center, forward: f2, range: 3.2, arc: 150, damage: 18 * this.dm(), knockback: 14, up: 6, stun: 1.0, source: this }) ?? [];
          this._slashFx(f2, 1); this._hitFx(h2);
          g.audio?.play('heavyhit', { pitch: 1.2 });
          if (h2.length) impact(g, 0.5);
        });
      }
    });
  }
  _slashFx(fwd, step = 0) {
    const g = this.game;
    const c = this.center, r = _a.set(fwd.z, 0, -fwd.x);
    const flip = step % 2 ? -1 : 1;
    const yaw = Math.atan2(fwd.x, fwd.z);
    // sweeping three-blade crescent trail (diagonal for punches, flat for the kick, steep for the uppercut)
    const tilts = [0.62, 0.62, 0.12, -1.15];
    const col = this.rageT > 0 ? RED : step === 3 ? GOLD : STEEL;
    this.slash.slash(c, yaw, { tilt: tilts[step % 4], flip: flip < 0, color: col, scale: 1 + (step % 4) * 0.08 + (this.rageT > 0 ? 0.15 : 0), life: step === 3 ? 0.32 : 0.24 });
    for (let k = -1; k <= 1; k += 2) {
      const p0 = c.clone().addScaledVector(fwd, 0.5).addScaledVector(r, -1.0 * flip).add(_b.set(0, 0.75, 0));
      p0.y += k * 0.12;
      const p1 = c.clone().addScaledVector(fwd, 1.5).addScaledVector(r, 1.0 * flip).add(_b.set(0, -0.45, 0));
      p1.y += k * 0.12;
      g.fx?.beam?.(p0, p1, STEEL, 0.04, 0.1);
    }
    if (step === 3) { const p = c.clone().addScaledVector(fwd, 1.4); g.fx?.beam?.(p.clone().setY(this.pos.y + 0.1), p.clone().setY(this.pos.y + 2.2), GOLD, 0.12, 0.18); }
  }

  _dive() {
    const g = this.game;
    // POUNCE: if an enemy is below us, home in on it instead of diving straight down
    const t = this._pounceTarget();
    if (t) {
      this.mode = 'pounce'; this.modeT = 0; this.pounceE = t; this.gravityScale = 0;
      this._extend(); this.setAnim('smash');
      this._trail?.stop?.(); this._trail = trailOn(g, this.model.chest ?? this.model.group, RED, 0.3, 0.35);
      g.audio?.play('roar', { volume: 0.45, pitch: 1.1 }); g.audio?.play('whoosh', { pitch: 1.2 });
      g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z), 'POUNCE', RED);
      g.slowmo?.(0.1, 0.5);
      return;
    }
    this.mode = 'dive'; this.modeT = 0;
    this.vel.x *= 0.25; this.vel.z *= 0.25; this.vel.y = -38; this.gravityScale = 2;
    this._extend(); this.setAnim('smash');
    this._trail?.stop?.(); this._trail = trailOn(g, this.model.chest ?? this.model.group, GOLD, 0.25, 0.3);
    g.audio?.play('whoosh', { pitch: 1.4 }); g.cam.shake(0.08);
  }
  _pounceTarget() {
    const g = this.game;
    let best = null, bd = Infinity;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive) continue;
      const dy = this.pos.y - e.pos.y;
      const dh = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (dy < 1.2 || dh > POUNCE_RANGE || dy + dh > POUNCE_RANGE * 1.4) continue;
      const score = dh + Math.abs(dy) * 0.4;
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  }
  _pounceMove(dt) {
    const g = this.game, e = this.pounceE;
    if (!e || !e.alive) { this.mode = 'dive'; this.modeT = 0; this.gravityScale = 2; this.pounceE = null; return; }
    this.gravityScale = 0;
    enemyCenter(e, _c);
    _a.subVectors(_c, this.center);
    const d = _a.length();
    if (d > 0.01) _a.multiplyScalar(1 / d);
    this.vel.copy(_a).multiplyScalar(Math.min(POUNCE_SPEED + this.modeT * 25, d / Math.max(dt, 1e-3)));
    this.yaw = Math.atan2(_a.x, _a.z);
    this.setAnim('smash'); this._extend();
    g.fx?.beam?.(this.center.clone(), this.center.clone().addScaledVector(_a, -2.2), RED, 0.18, 0.15);
    if (d < 1.9 || this.modeT > 1.4) {
      this.pounceE = null; this.vel.set(0, 0, 0);
      const hit = d < 3.2;
      if (hit) {
        const kb = _d.subVectors(e.pos, this.pos).setY(0).normalize().multiplyScalar(6).setY(2).clone();
        hurt(g, this, e, 42 * this.dm(), { kb, stun: 1.3, kind: 'melee', color: 0xffd070 });
        this._applyBleed(e);
        this._slashFx(this.forward, 3); this._slashFx(this.forward, 0);
        g.fx?.burst?.(enemyCenter(e, _c), BLOOD, 14, 7, 0.45, 0.17);
        g.fx?.ring?.(e.pos.clone().setY(e.pos.y + 0.15), 3.5, RED, 0.4);
        g.fx?.flash?.(enemyCenter(e, _c).clone(), 0xffd070, 5, 0.2);
        const hits = g.combat?.aoe?.({ center: e.pos.clone(), radius: 3.2, damage: 16 * this.dm(), knockback: 9, up: 4, stun: 0.7, source: this }) ?? [];
        this._hitFx(hits);
        g.audio?.play('heavyhit', { volume: 0.8 }); impact(g, 0.7);
      }
      this._trail?.stop?.(); this._trail = null;
      this._endMode(); this.actionAnim = 'land'; this.actionT = 0.25;
      this.vel.set(-this.forward.x * 4, 8, -this.forward.z * 4); this.onGround = false;
    }
  }
  onLand() {
    const g = this.game, vy = -this._impactVy;
    if (this.mode === 'pounce') { this._trail?.stop?.(); this._trail = null; this.pounceE = null; this._endMode(); }
    if (this.mode === 'dive') {
      this._trail?.stop?.(); this._trail = null;
      const c = this.pos.clone();
      const hits = g.combat?.aoe?.({ center: c, radius: 4.5, damage: 38 * this.dm(), knockback: 12, up: 7, stun: 0.9, source: this }) ?? [];
      this._hitFx(hits);
      impactFx(g, c, 4.5, GOLD, 0.45);
      g.audio?.play('smash', { volume: 0.7 }); impact(g, 0.6);
      this._endMode(); this.actionAnim = 'land'; this.actionT = 0.25; this.setAnim('land');
      this.vel.x *= 0.2; this.vel.z *= 0.2;
    } else if (this.mode === 'ult') { /* handled by the sequence */ }
    else if (vy > 13) { g.audio?.play('land', { volume: 0.5 }); g.fx?.dust?.(this.pos.clone(), 6, 1.6); }
  }

  // ---- special: Lunge ---------------------------------------------------------------
  _lunge(pinTarget = null) {
    const g = this.game;
    const t = pinTarget ?? this.findTarget(LUNGE_RANGE, 110) ?? g.enemies?.nearest?.(this.pos, LUNGE_RANGE) ?? null;
    this._extend();
    this.bufferT = 0;
    if (!t) {
      // no target: short feral pounce forward
      this.useCooldown('lunge', 1);
      const f = this.forward; this.vel.set(f.x * 22, 9, f.z * 22); this.onGround = false;
      this.setAnim('jump'); g.audio?.play('whoosh', { pitch: 1.2 });
      this.timers.after(0.2, () => { if (!this.active) return; const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 3.2, arc: 140, damage: 22 * this.dm(), knockback: 10, up: 4, stun: 0.6, source: this }) ?? []; this._slashFx(this.forward, 0); this._hitFx(hits); });
      return;
    }
    if (pinTarget) this.useCooldown('pin', PIN_CD); else this.useCooldown('lunge', LUNGE_CD);
    this.lunge = { e: t, phase: 'fly', t: 0, hits: 0, hitT: 0, pin: !!pinTarget };
    if (pinTarget && t.pos.distanceTo(this.pos) < 2.4) { this.lunge.phase = 'maul'; g.fx?.text?.(_a.set(t.pos.x, t.pos.y + t.height + 0.9, t.pos.z), 'PIN TAKEDOWN', RED, { size: 1.4 }); }
    this.mode = 'lunge'; this.modeT = 0; this.gravityScale = 0; this.onGround = false;
    this.invuln = Math.max(this.invuln, 2);
    this.spinT = 0; this.actionT = 0;
    this._trail?.stop?.(); this._trail = trailOn(g, this.model.chest ?? this.model.group, GOLD, 0.3, 0.35);
    g.audio?.play('roar', { volume: 0.5 }); g.audio?.play('whoosh', { pitch: 1.3 });
    g.fx?.burst?.(this.center, GOLD, 12, 6, 0.4, 0.18);
  }
  _lungeEnd(hop = true) {
    this.lunge = null; this._endMode();
    this.invuln = Math.max(this.invuln, 0.2);
    this._trail?.stop?.(); this._trail = null;
    if (hop) { const f = this.forward; this.vel.set(-f.x * 5, 7, -f.z * 5); this.onGround = false; }
  }
  _lungeMove(dt) {
    const g = this.game, L = this.lunge;
    if (!L || !L.e.alive) { this._lungeEnd(false); return; }
    L.t += dt;
    const e = L.e;
    enemyCenter(e, _c);
    _a.subVectors(_c, this.center);
    const d = _a.length();
    if (L.phase === 'fly') {
      this.gravityScale = 0;
      if (d > 0.01) _a.multiplyScalar(1 / d);
      const sp = Math.min(LUNGE_SPEED, d / Math.max(dt, 1e-3));
      this.vel.copy(_a).multiplyScalar(sp);
      this.yaw = Math.atan2(_a.x, _a.z);
      this.setAnim('dash', LUNGE_SPEED);
      if (d < 1.8 || L.t > 0.9) {
        L.phase = 'maul'; L.t = 0; L.hitT = 0; L.hits = 0; this.vel.set(0, 0, 0); g.cam.shake(0.25); g.audio?.play('heavyhit');
        if (L.pin) g.fx?.text?.(_a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'PIN TAKEDOWN', RED, { size: 1.4 });
      }
      return;
    }
    // maul: pin the target and rake it
    this.gravityScale = 0;
    _b.set(e.pos.x, e.pos.y, e.pos.z).sub(_w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.05));
    this.vel.set((_b.x - this.pos.x) * 14, (_b.y + 0.3 - this.pos.y) * 14, (_b.z - this.pos.z) * 14);
    _d.subVectors(e.pos, this.pos).setY(0); if (_d.lengthSq() > 0.01) this.yaw = Math.atan2(_d.x, _d.z);
    e.vel.x = 0; e.vel.z = 0;
    if (L.pin && !e.isBoss) { e.stunTimer = Math.max(e.stunTimer ?? 0, 0.5); e.downTimer = Math.max(e.downTimer ?? 0, 0.5); }   // knee on the chest: it cannot get up
    this.invuln = Math.max(this.invuln, 0.3);
    this.setAnim(L.pin ? 'smash' : L.hits % 2 ? 'punch2' : 'punch1');
    L.hitT -= dt;
    if (L.hitT <= 0) {
      L.hitT = (L.pin ? 0.17 : 0.14) / this.atkSpeed; L.hits++;
      const last = L.hits >= (L.pin ? 4 : 6);
      const kb = last ? _a.subVectors(e.pos, this.pos).setY(0).normalize().multiplyScalar(14).setY(7).clone() : undefined;
      hurt(g, this, e, (L.pin ? (last ? 46 : 12) : (last ? 28 : 9)) * this.dm(), { kb, stun: last ? 1.2 : 0.5, kind: 'melee', color: last ? 0xffd070 : 0xff9090 });
      if (L.pin && last) { g.slowmo?.(0.35, 0.3); g.fx?.ring?.(e.pos.clone().setY(e.pos.y + 0.15), 4, RED, 0.5); g.fx?.flash?.(enemyCenter(e, _c).clone(), 0xffd070, 6, 0.25); g.cam.shake(0.45); }
      this._applyBleed(e);
      const fw = this.forward; this._slashFx(fw, L.hits);
      g.fx?.burst?.(enemyCenter(e, _c), BLOOD, 6, 5, 0.35, 0.14);
      g.audio?.play(last ? 'heavyhit' : 'punch', { volume: 0.6 }); impact(g, last ? 0.7 : 0.12, last);
      if (this.rageT > 0) this.heal(1.5);
      if (last || !e.alive) this._lungeEnd(true);
    }
  }

  // ---- ability: Claw Spin -----------------------------------------------------------
  _spin() {
    const g = this.game;
    this.useCooldown('spin', SPIN_CD);
    this.spinT = SPIN_TIME / Math.min(1.3, this.atkSpeed); this.spinTick = 0.06; this.spinFxT = 0; this.spinN = 0;
    this.actionT = 0; this.bufferT = 0; this._extend();
    g.audio?.play('whoosh', { volume: 0.8, pitch: 1.1 }); g.audio?.play('roar', { volume: 0.25, pitch: 1.4 });
    g.cam.shake(0.15);
  }
  _spinTick(dt) {
    const g = this.game;
    this.spinT -= dt; this.spinTick -= dt; this._extend();
    // whirling blades
    this.spinFxT -= dt;
    if (this.spinFxT <= 0) {
      this.spinFxT = 0.045;
      const a = this.game.time * 22, c = this.center;
      for (let k = 0; k < 3; k++) {
        const ang = a + k * 2.094;
        _a.set(Math.cos(ang) * 0.5, 0.1, Math.sin(ang) * 0.5).add(c);
        _b.set(Math.cos(ang + 0.5) * SPIN_RADIUS * 0.85, 0.1 + (k - 1) * 0.15, Math.sin(ang + 0.5) * SPIN_RADIUS * 0.85).add(c);
        g.fx?.beam?.(_a.clone(), _b.clone(), k === 0 ? GOLD : STEEL, 0.07, 0.1);
      }
      this.slash.slash(c, a, { tilt: 0.05, flip: false, color: this.rageT > 0 ? RED : GOLD, scale: 1.45, life: 0.22, forward: 0 });
    }
    if (this.spinTick <= 0) {
      this.spinTick = 0.2; this.spinN++;
      const last = this.spinT <= 0.2;
      const hits = g.combat?.aoe?.({ center: this.center, radius: SPIN_RADIUS, damage: (last ? 22 : 16) * this.dm(), knockback: last ? 15 : 7, up: last ? 6 : 2.5, stun: 0.5, source: this, falloff: false }) ?? [];
      this._hitFx(hits);
      g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.9), SPIN_RADIUS, GOLD, 0.3);
      if (hits.length) { g.audio?.play('punch', { volume: 0.6 }); impact(g, last ? 0.5 : 0.2, last); }
    }
    if (this.spinT <= 0) { this.spinT = 0; this.actionT = 0.15; this.actionAnim = 'land'; }
  }

  // ---- special: context variants (Lunge / Grab & Throw / Pin Takedown) -------------------------------
  _specialUpdate(input, normal) {
    const g = this.game;
    // decide what the button would do right now (also drives the HUD label)
    let kind = 'lunge', tgt = null;
    if (normal || this.mode === 'climb') {
      let bd = PIN_RANGE;
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || e.isBoss) continue;
        if (!(e.stunned || e.webbed || e.hp <= e.maxHp * 0.25)) continue;
        const d = e.pos.distanceTo(this.pos);
        if (d < bd) { bd = d; tgt = e; }
      }
      if (tgt) kind = 'pin';
      else {
        const n = g.enemies?.nearest?.(this.pos, GRAB_RANGE);
        if (n && n.alive && !n.isBoss && this.onGround && this.mode === 'normal') { tgt = n; kind = 'throw'; }
      }
    }
    this.spKind = kind;
    if (!input.pressed('special') || !(normal || this.mode === 'climb') || this.spinT > 0 || this.grab) return;
    if (kind === 'pin') { if ((this.cooldowns.pin || 0) <= 0) { this.bufferT = 0; this._extend(); this._lunge(tgt); } }
    else if (kind === 'throw') { if ((this.cooldowns.grab || 0) <= 0) this._startGrab(tgt); }
    else if ((this.cooldowns.lunge || 0) <= 0) this._lunge();
  }

  // Grab & Throw (Fastball Special): seize the enemy, wind up, hurl it down the camera line. It bowls through others.
  _startGrab(e) {
    const g = this.game;
    this.useCooldown('grab', GRAB_CD);
    this.grab = { e, t: 0 };
    this._extend(); this.spinT = 0; this.bufferT = 0;
    _a.subVectors(e.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z);
    e.interrupt?.();
    this.actionAnim = 'throw'; this.actionT = 0.45; this.setAnim('throw');
    g.audio?.play('roar', { volume: 0.35, pitch: 1.3 }); g.audio?.play('whoosh', { pitch: 0.9 });
    g.fx?.burst?.(enemyCenter(e, _c), STEEL, 8, 4, 0.3, 0.12);
  }
  _grabUpdate(dt) {
    const G = this.grab, g = this.game;
    if (!G) return;
    const e = G.e;
    if (!e || !e.alive || this.mode !== 'normal') { this.grab = null; return; }
    G.t += dt;
    const fw = this.forward;
    // hold the victim overhead and spin up
    e.pos.set(this.pos.x + fw.x * 0.9, this.pos.y + 1.1 + Math.sin(G.t * 10) * 0.05, this.pos.z + fw.z * 0.9);
    e.vel.set(0, 0, 0); e.stunTimer = Math.max(e.stunTimer ?? 0, 0.3);
    e.yaw = this.yaw + G.t * 3.6;
    this.actionT = Math.max(this.actionT, 0.1);
    if (G.t < 0.28) return;
    // release
    const aim = g.cam.forward;
    _d.set(aim.x, 0, aim.z); if (_d.lengthSq() < 0.01) _d.copy(fw); _d.normalize();
    // aim-assist: bend towards another enemy in the throw cone
    let best = null, bs = 0.8;
    for (const o of g.enemies?.list ?? []) {
      if (!o.alive || o === e) continue;
      _a.subVectors(o.pos, this.pos).setY(0); const dd = _a.length();
      if (dd < 3 || dd > 40) continue;
      const dot = _a.multiplyScalar(1 / dd).dot(_d);
      if (dot > bs) { bs = dot; best = o; }
    }
    if (best) { _a.subVectors(best.pos, this.pos).setY(0).normalize(); _d.lerp(_a, 0.8).normalize(); }
    this.yaw = Math.atan2(_d.x, _d.z);
    e.launch?.({});
    e.vel.set(_d.x * THROW_SPEED, 5.5, _d.z * THROW_SPEED);
    e.onGround = false;
    this.thrown.push({ e, t: 0, hit: new Set([e]), trail: trailOn(g, e.root ?? e.model?.group ?? this.model.group, GOLD, 0.35, 0.35) });
    this.grab = null; this.actionAnim = 'throw'; this.actionT = 0.35; this.setAnim('throw');
    this.vel.x -= _d.x * 3; this.vel.z -= _d.z * 3;
    g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.6, this.pos.z), 'FASTBALL!', GOLD, { size: 1.4 });
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 1.1), 2.5, GOLD, 0.3);
    g.audio?.play('throw', { volume: 0.8, pitch: 0.8 }); g.audio?.play('heavyhit', { volume: 0.5 });
    g.cam.shake(0.3); rumble(g, 0.6, 0.4, 140);
  }
  _thrownUpdate(dt) {
    const g = this.game;
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const T = this.thrown[i], e = T.e;
      T.t += dt;
      let done = !e.alive || T.t > 2.2;
      if (!done) {
        const c = enemyCenter(e, _c);
        g.fx?.trailPuff?.(c.x, c.y, c.z, GOLD, 0.35, 0.3, 0.02);
        for (const o of g.enemies?.list ?? []) {
          if (!o.alive || T.hit.has(o)) continue;
          if (o.center.distanceTo(c) > 1.5 + (o.radius ?? 0.5)) continue;
          T.hit.add(o);
          _d.copy(e.vel).setY(0).normalize().multiplyScalar(11).setY(5);
          hurt(g, this, o, THROW_DMG * this.dm(), { kb: _d.clone(), stun: 1.0, kind: 'melee', color: 0xffd070 });
          g.fx?.shockwave?.(o.pos.clone().setY(o.pos.y + 0.1), 3, GOLD);
          g.audio?.play('heavyhit', { volume: 0.7 }); impact(g, 0.5);
        }
        if (T.t > 0.12 && (e.onGround || Math.hypot(e.vel.x, e.vel.z) < 6)) {
          // landing / wall crunch: the thrown enemy takes the hit too
          hurt(g, this, e, 24 * this.dm(), { stun: 1.0, kind: 'melee', color: 0xffd070 });
          g.fx?.shockwave?.(e.pos.clone().setY(e.pos.y + 0.1), 4, GOLD);
          impact(g, 0.6);
          done = true;
        }
      }
      if (done) { T.trail?.stop?.(); this.thrown.splice(i, 1); }
    }
  }

  // ---- ability: TAP Claw Spin / HOLD Feral Sense ----------------------------------------------------
  _abilityUpdate(dt, input, normal) {
    const ok = normal || this.mode === 'climb';
    // ability (E / L1)
    const abDown = input.down('ability');
    if (input.pressed('ability')) { this._abT = 0; this._senseHeld = false; }
    if (abDown) {
      this._abT += dt;
      if (this._abT >= HOLD_SENSE && !this.senseOn && !this._senseHeld && ok && (this.cooldowns.sense || 0) <= 0) { this._senseHeld = true; this._senseStart(); }
    }
    if (input.released('ability')) {
      if (this.senseOn) this._senseStop();
      else if (this._abT < HOLD_SENSE && ok && this.spinT <= 0 && (this.cooldowns.spin || 0) <= 0) this._spin();
    }
    if (this.senseOn) {
      this.senseT += dt;
      if (this.senseT > SENSE_MAX || !abDown) this._senseStop();
    }
    // ability2 (R / L2): tap = rage, hold = roar
    const a2Down = input.down('ability2');
    if (input.pressed('ability2')) { this._ab2T = 0; this._roared = false; }
    if (a2Down) {
      this._ab2T += dt;
      if (this._ab2T >= HOLD_ROAR && !this._roared && ok && (this.cooldowns.roar || 0) <= 0) { this._roared = true; this._roar(); }
    }
    if (input.released('ability2')) {
      if (!this._roared && this._ab2T < HOLD_ROAR && (this.cooldowns.rage || 0) <= 0 && this.rageT <= 0) this._startRage();
    }
  }

  _senseStart() {
    const g = this.game;
    this.senseOn = true; this.senseT = 0; this._scentT = 0;
    this._extend();
    g.audio?.play('whoosh', { volume: 0.4, pitch: 0.6 });
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 14, GOLD, 0.6);
    g.hud?.toast?.('FERAL SENSE');
  }
  _senseStop(silent = false) {
    if (this.senseOn && !silent) this.useCooldown('sense', SENSE_CD);
    this.senseOn = false; this.senseFx?.hide();
  }
  _senseTick(dt) {
    const g = this.game;
    this.senseFx.update(dt, g.enemies?.list ?? [], this.pos, SENSE_RANGE, this.senseOn);
    if (!this.senseOn) return;
    this._scentT -= dt;
    if (this._scentT <= 0) {
      this._scentT = 0.14;
      let n = 0;
      const c = this.center;
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || n >= 6) continue;
        const d = e.pos.distanceTo(this.pos);
        if (d > SENSE_RANGE) continue;
        n++;
        // scent thread from nose to prey, plus a pulse above their head
        _b.copy(enemyCenter(e, _w)).sub(c);
        const len = _b.length(); if (len < 0.5) continue;
        _b.multiplyScalar(Math.min(1, 9 / len)).add(c);
        g.fx?.beam?.(c.clone(), _b.clone(), e.isBoss ? GOLD : RED, 0.03, 0.16);
        g.fx?.glow?.(_a.set(e.pos.x, e.pos.y + e.height + 0.5, e.pos.z), e.isBoss ? GOLD : RED, 0.9, 0.2);
      }
    }
  }

  // ---- ability2 hold: Feral Roar ---------------------------------------------------------------------------
  _roar() {
    const g = this.game;
    this.useCooldown('roar', ROAR_CD);
    this._extend();
    this.invuln = Math.max(this.invuln, 0.35);
    this.actionAnim = 'smash'; this.actionT = 0.6; this.setAnim('smash');
    this.vel.x *= 0.2; this.vel.z *= 0.2;
    g.audio?.play('roar', { volume: 1 }); g.audio?.play('boss_roar', { volume: 0.5, pitch: 1.2 });
    g.cam.shake(0.8); rumble(g, 1, 0.9, 450);
    g.slowmo?.(0.18, 0.5);
    const c = this.pos.clone().setY(this.pos.y + 0.15);
    // expanding shock rings + a red flash
    for (let k = 0; k < 3; k++) this.timers.after(k * 0.11, () => { if (this.active) g.fx?.ring?.(c, ROAR_RADIUS * (0.55 + k * 0.25), k === 1 ? GOLD : RED, 0.55); });
    g.fx?.shockwave?.(c.clone(), ROAR_RADIUS * 0.8, RED);
    g.fx?.burst?.(this.center, RED, 30, 10, 0.7, 0.3);
    g.fx?.flash?.(this.center, RED, 6, 0.3);
    g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.6, this.pos.z), 'FERAL ROAR', RED, { size: 1.5 });
    // stagger: light damage + fear shove (bosses only flinch: their super armour ignores the stun)
    for (const e of enemiesNear(g, this.pos, ROAR_RADIUS)) {
      _d.subVectors(e.pos, this.pos).setY(0);
      const dd = _d.length() || 1; _d.multiplyScalar(1 / dd);
      const f = 1 - 0.5 * dd / ROAR_RADIUS;
      e.takeDamage?.(5 * this.dm(), { knockback: _d.clone().multiplyScalar(9 * f).setY(2.5), stun: e.isBoss ? 0.4 : 1.8 * f + 0.5, source: this, kind: 'roar' });
      if (e.isBoss) e.slowTimer = Math.max(e.slowTimer ?? 0, 1.2);
      else if (e.alive) { e.slowTimer = Math.max(e.slowTimer ?? 0, 3.5); e.stunTimer = Math.max(e.stunTimer ?? 0, 1.2 * f + 0.4); }
      g.fx?.burst?.(enemyCenter(e, _c), GOLD, 6, 4, 0.35, 0.14);
    }
    this.addFocus(6);
  }

  // ---- visuals (after physics) ---------------------------------------------------------------------------------
  updateVisuals(dt) {
    const g = this.game;
    this.slash.update(dt); this.dig.update(dt);
    this.wounds.update(dt, this.hp / this.maxHp, this.regenning, g, this);
    this._senseTick(dt);
    this._thrownUpdate(dt);
    if (this.dead) this._senseStop();
  }

  // ---- ultimate: Weapon X frenzy -----------------------------------------------------
  _startUlt() {
    const g = this.game;
    this._senseStop(true); this.grab = null;
    // greedy nearest-neighbour chain of up to 8 enemies
    const pool = enemiesNear(g, this.pos, ULT_RANGE).filter((e) => e.alive);
    if (!pool.length) { g.hud?.toast?.('No targets in range'); return; }
    const list = [];
    let cur = this.pos;
    while (list.length < ULT_MAX && pool.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pool.length; i++) { const d = pool[i].pos.distanceToSquared(cur); if (d < bd) { bd = d; bi = i; } }
      const e = pool.splice(bi, 1)[0]; list.push(e); cur = e.pos;
    }
    this.focus = 0;
    this.ult = { list, i: 0, phase: 'dash', t: 0, from: this.pos.clone(), strikes: 0, base: 0 };
    this.mode = 'ult'; this.modeT = 0; this.gravityScale = 0;
    this.invuln = 30; this.spinT = 0; this.actionT = 0; this.bufferT = 0;
    this._extend();
    this._trail?.stop?.(); this._trail = null;
    g.slowmo?.(0.6, 0.55);
    g.audio?.play('roar'); g.hud?.toast?.('WEAPON X'); g.cam.shake(0.5); rumble(g, 0.8, 0.8, 300);
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 7, RED, 0.6);
    this._ultNext();
  }
  _ultNext() {
    const U = this.ult;
    while (U.i < U.list.length && !U.list[U.i].alive) U.i++;
    U.t = 0; U.from.copy(this.pos);
    U.phase = U.i < U.list.length ? 'dash' : 'wind';
    U.strikes = 0;
    if (U.phase === 'wind') U.base = this.pos.y;
  }
  _ultTick(dt) {
    const g = this.game, U = this.ult;
    U.total = (U.total ?? 0) + dt;
    if (g._slowmo < 0.2 && U.phase !== 'end') g.slowmo?.(0.3, 0.55);
    this.invuln = Math.max(this.invuln, 0.5);
    if (U.total > 12) this._ultFinish(false);
  }
  _ultMove(dt) {
    const g = this.game, U = this.ult;
    if (!U) { this._endMode(); return; }
    this.gravityScale = 0; this.vel.set(0, 0, 0);
    U.t += dt;
    if (U.phase === 'dash') {
      const e = U.list[U.i];
      if (!e || !e.alive) { U.i++; this._ultNext(); return; }
      // destination: beside the enemy on the side we come from
      _a.subVectors(U.from, e.pos).setY(0); if (_a.lengthSq() < 0.01) _a.set(0, 0, 1); _a.normalize();
      _b.set(e.pos.x + _a.x * 1.25, e.pos.y, e.pos.z + _a.z * 1.25);
      const k = clamp(U.t / ULT_DASH, 0, 1);
      _c.copy(this.pos);
      this.pos.lerpVectors(U.from, _b, k * k * (3 - 2 * k));
      this.yaw = Math.atan2(-_a.x, -_a.z);
      this.setAnim('dash', 30);
      // streak trail + afterimage glints
      g.fx?.beam?.(_c.clone().setY(_c.y + 0.9), this.pos.clone().setY(this.pos.y + 0.9), GOLD, 0.35, 0.3);
      g.fx?.beam?.(_c.clone().setY(_c.y + 0.5), this.pos.clone().setY(this.pos.y + 0.5), RED, 0.15, 0.25);
      g.fx?.glow?.(this.center, GOLD, 1.6, 0.18);
      if (k >= 1) { U.phase = 'slash'; U.t = 0; U.strikes = 0; this._ultStrike(e); }
    } else if (U.phase === 'slash') {
      const e = U.list[U.i];
      if (e) { _a.subVectors(e.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
      if (U.strikes < 2 && U.t > ULT_SLASH * 0.5) { U.strikes = 2; if (e && e.alive) this._ultStrike(e, true); }
      if (U.t >= ULT_SLASH) { U.i++; this._ultNext(); }
    } else if (U.phase === 'wind') {
      // spring up, then the big ground slash
      this.setAnim('smash');
      this.pos.y = U.base + Math.sin(clamp(U.t / 0.28, 0, 1) * Math.PI * 0.5) * 1.8;
      if (U.t >= 0.28) this._ultFinish(true);
    }
  }
  _ultStrike(e, second = false) {
    const g = this.game;
    const dir = _d.subVectors(e.pos, this.pos).setY(0).normalize();
    const kb = e.alive ? dir.clone().multiplyScalar(2).setY(0) : undefined;
    hurt(g, this, e, (second ? 30 : 34) * this.dm(), { kb, stun: 2.0, kind: 'melee', color: 0xffd070 });
    this._applyBleed(e);
    this._slashFx(dir.clone(), second ? 1 : 0);
    const c = enemyCenter(e, _c).clone();
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI, v = _a.set(Math.cos(a), Math.sin(a) * 0.7, Math.sin(a * 2) * 0.4).multiplyScalar(1.4);
      g.fx?.beam?.(c.clone().sub(v), c.clone().add(v), k ? STEEL : RED, 0.06, 0.2);
    }
    g.fx?.burst?.(c, BLOOD, 8, 6, 0.4, 0.15);
    g.fx?.flash?.(c, 0xffe0a0, 3, 0.1);
    g.audio?.play(second ? 'heavyhit' : 'punch', { volume: 0.7, pitch: 1.1 }); g.cam.shake(0.12); rumble(g, 0.4, 0.4, 70);
    if (this.rageT > 0) this.heal(1.5);
  }
  _ultFinish(slam) {
    const g = this.game, U = this.ult;
    this.ult = null; this._endMode();
    this.invuln = Math.max(0, Math.min(this.invuln, 0.8));
    g._slowmo = 0; g.timeScale = 1;
    if (!slam) return;
    const c = this.pos.clone(); c.y = U && U.base != null ? U.base : c.y;
    this.pos.y = c.y + 0.2;
    const fw = this.forward;
    // big ground slash: radiating blade lines + shockwave
    for (let k = 0; k < 8; k++) {
      const a = this.yaw + (k - 3.5) * 0.45;
      const to = c.clone().add(_a.set(Math.sin(a), 0.05, Math.cos(a)).multiplyScalar(14));
      g.fx?.beam?.(c.clone().setY(c.y + 0.3), to, k % 2 ? GOLD : STEEL, 0.28, 0.45);
    }
    const hits = g.combat?.aoe?.({ center: c, radius: 11, damage: 110 * this.dm(), knockback: 24, up: 13, stun: 2.2, source: this, falloff: true }) ?? [];
    this._hitFx(hits);
    impactFx(g, c, 11, GOLD, 1.0);
    g.fx?.shockwave?.(c.clone(), 9, 0xffffff);
    g.fx?.flash?.(c.clone().setY(c.y + 1.5), 0xffd070, 7, 0.35);
    g.audio?.play('smash'); g.audio?.play('roar', { volume: 0.7 }); rumble(g, 1, 1, 600);
    g.slowmo?.(0.3, 0.25);
    this.actionAnim = 'land'; this.actionT = 0.5; this.setAnim('land');
    this.vel.set(-fw.x * 2, 4, -fw.z * 2);
  }
}
