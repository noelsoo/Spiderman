// Wolverine: feral speed, claw combo with bleed, Lunge maul, Claw Spin, Berserker Rage, Healing Factor, Weapon X frenzy.
//   attack J/LMB/□   special K/RMB/R1 Lunge   ability E/L1 Claw Spin   ability2 R/L2 Berserker Rage   ultimate Q/R3 Weapon X
//   dodge C/○ = roll;  dodge while holding sprint/swing = slide;  attack in air = diving claw drop;  walk into walls = claw climb
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { Timers, aimInfo, enemiesNear, enemyCenter, rumble, impactFx, clamp, damp, objPos, hurt, trailOn, impact } from './squad/util.js';

// ---- tuning ----------------------------------------------------------------
const WALK = 7, RUN = 12.5, SPRINT = 16, CLIMB = 11, JUMP = 15, GRAV = 28;
const LUNGE_RANGE = 18, LUNGE_CD = 3, LUNGE_SPEED = 44;
const SPIN_CD = 6, SPIN_RADIUS = 5, SPIN_TIME = 0.8;
const RAGE_TIME = 10, RAGE_CD = 20, RAGE_DMG = 1.6, RAGE_ATK = 1.6, RAGE_SPEED = 1.12;
const HEAL_DELAY = 2.5, HEAL_RATE = 6;
const BLEED_TIME = 3, BLEED_TICK = 0.5, BLEED_DMG = 2.4;
const ULT_RANGE = 25, ULT_MAX = 8, ULT_DASH = 0.13, ULT_SLASH = 0.1;
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
  }

  onActivate() {
    this.mode = 'normal'; this.modeT = 0; this.actionT = 0; this.spinT = 0; this.gravityScale = 1;
    this.lunge = null; this.ult = null; this.sinceHit = 99;
    this.dmgMul = 1; this.atkSpeed = 1; this.speedMul = 1; this.rageT = 0;
  }
  onDeactivate() {
    const g = this.game;
    this.timers.clear(); this.bleeds.clear();
    this.mode = 'normal'; this.lunge = null; this.spinT = 0; this.gravityScale = 1;
    if (this.ult) { this.ult = null; g._slowmo = 0; g.timeScale = 1; }
    this.rageT = 0; this.dmgMul = 1; this.atkSpeed = 1; this.speedMul = 1;
    this.model.setTint?.(RED, 0); this._tintOn = false;
    this._setClaws(false);
    this._trail?.stop?.(); this._trail = null;
    g.cam.fovKick = 0;
  }

  get abilityHints() {
    return [
      { action: 'special', label: 'Lunge', cooldown: this.cooldownFrac('lunge'), active: this.mode === 'lunge' },
      { action: 'ability', label: 'Claw Spin', cooldown: this.cooldownFrac('spin'), active: this.spinT > 0 },
      { action: 'ability2', label: 'Berserker Rage', cooldown: this.cooldownFrac('rage'), active: this.rageT > 0 },
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
      if (input.pressed('special') && (normal || this.mode === 'climb') && this.spinT <= 0 && (this.cooldowns.lunge || 0) <= 0) this._lunge();
      if (input.pressed('ability') && (normal || this.mode === 'climb') && (this.cooldowns.spin || 0) <= 0) this._spin();
      if (input.pressed('ability2') && (this.cooldowns.rage || 0) <= 0 && this.rageT <= 0) this._startRage();
      if (input.pressed('dodge') && normal && (this.cooldowns.dodge || 0) <= 0) this._dodge(input);
      if (input.pressed('ultimate') && this.focus >= 100) this._startUlt();
    }
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
      case 'ult': this._ultMove(dt); return;
      case 'roll': this._rollMove(dt, input); return;
      case 'slide': this._slideMove(dt, input); return;
      case 'dive': this.gravityScale = 2; this.setAnim('smash'); this._extend(); if (this.modeT > 2.5) this._endMode(); return;
      case 'climb': this._climb(dt, input, wish, mag); return;
      default: break;
    }
    this.noWallT += dt; this.grabCd -= dt;
    // claw-climb: pressing into a wall in the air, or a tall wall from the ground
    if (this.grabCd <= 0 && this.onWall && input.move.y > 0.3) {
      _a.copy(this.wallNormal).negate();
      if (!this.onGround && (wish.dot(_a) > 0.3 || this.vel.y < 6)) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
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
    const up = input.move.y > 0.15 ? CLIMB : input.move.y < -0.15 ? -6 : 0;
    _a.set(-n.z, 0, n.x);
    const side = Math.sign(g.cam.right.dot(_a)) || 1;
    const lat = input.move.x * 8 * side;
    this.vel.set(-n.x * 3 + _a.x * lat, up, -n.z * 3 + _a.z * lat);
    this.yaw = Math.atan2(-n.x, -n.z);
    this.setAnim(up !== 0 || Math.abs(lat) > 0.5 ? 'wallrun' : 'wallidle', Math.abs(up));
    this.climbFx -= dt;
    if (this.climbFx <= 0 && (up !== 0 || Math.abs(lat) > 0.5)) {
      this.climbFx = 0.17;
      g.fx?.sparks?.(this.pos.clone().setY(this.pos.y + this.height * 0.9), n, STEEL, 4, 5, 0.25, 0.08);
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
    for (let k = -1; k <= 1; k++) {
      const p0 = c.clone().addScaledVector(fwd, 0.5).addScaledVector(r, -1.0 * flip).add(_b.set(0, 0.75 - k * 0.0, 0));
      p0.y += k * 0.12;
      const p1 = c.clone().addScaledVector(fwd, 1.5).addScaledVector(r, 1.0 * flip).add(_b.set(0, -0.45, 0));
      p1.y += k * 0.12;
      g.fx?.beam?.(p0, p1, STEEL, 0.05, 0.13);
    }
    if (step === 3) { const p = c.clone().addScaledVector(fwd, 1.4); g.fx?.beam?.(p.clone().setY(this.pos.y + 0.1), p.clone().setY(this.pos.y + 2.2), GOLD, 0.12, 0.18); }
  }

  _dive() {
    const g = this.game;
    this.mode = 'dive'; this.modeT = 0;
    this.vel.x *= 0.25; this.vel.z *= 0.25; this.vel.y = -38; this.gravityScale = 2;
    this._extend(); this.setAnim('smash');
    this._trail?.stop?.(); this._trail = trailOn(g, this.model.chest ?? this.model.group, GOLD, 0.25, 0.3);
    g.audio?.play('whoosh', { pitch: 1.4 }); g.cam.shake(0.08);
  }
  onLand() {
    const g = this.game, vy = -this._impactVy;
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
  _lunge() {
    const g = this.game;
    const t = this.findTarget(LUNGE_RANGE, 110) ?? g.enemies?.nearest?.(this.pos, LUNGE_RANGE) ?? null;
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
    this.useCooldown('lunge', LUNGE_CD);
    this.lunge = { e: t, phase: 'fly', t: 0, hits: 0, hitT: 0 };
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
      if (d < 1.8 || L.t > 0.9) { L.phase = 'maul'; L.t = 0; L.hitT = 0; L.hits = 0; this.vel.set(0, 0, 0); g.cam.shake(0.25); g.audio?.play('heavyhit'); }
      return;
    }
    // maul: pin the target and rake it
    this.gravityScale = 0;
    _b.set(e.pos.x, e.pos.y, e.pos.z).sub(_w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.05));
    this.vel.set((_b.x - this.pos.x) * 14, (_b.y + 0.3 - this.pos.y) * 14, (_b.z - this.pos.z) * 14);
    _d.subVectors(e.pos, this.pos).setY(0); if (_d.lengthSq() > 0.01) this.yaw = Math.atan2(_d.x, _d.z);
    e.vel.x = 0; e.vel.z = 0;
    this.invuln = Math.max(this.invuln, 0.3);
    this.setAnim(L.hits % 2 ? 'punch2' : 'punch1');
    L.hitT -= dt;
    if (L.hitT <= 0) {
      L.hitT = 0.14 / this.atkSpeed; L.hits++;
      const last = L.hits >= 6;
      const kb = last ? _a.subVectors(e.pos, this.pos).setY(0).normalize().multiplyScalar(14).setY(7).clone() : undefined;
      hurt(g, this, e, (last ? 28 : 9) * this.dm(), { kb, stun: last ? 1.2 : 0.5, kind: 'melee', color: last ? 0xffd070 : 0xff9090 });
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

  // ---- ultimate: Weapon X frenzy -----------------------------------------------------
  _startUlt() {
    const g = this.game;
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
