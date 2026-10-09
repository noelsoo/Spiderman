// Hulk: heavy brawler. Super-jump, wall climb, smash combo, thunderclap / rock throw, leap smash, rage, Worldbreaker.
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { Timers, aimInfo, enemiesNear, enemyCenter, rumble, impactFx, clamp, damp, objPos } from './avengers/util.js';

// ---- tuning ----------------------------------------------------------------
const WALK = 7, RUN = 14, BULLDOZE = 24, CLIMB_SPEED = 8;
const SUPER_MAX_H = 45, SUPER_MIN_H = 8, CHARGE_MIN = 0.15, CHARGE_FULL = 1.25, SMALL_JUMP = 17;
const CLAP_CD = 6, CLAP_RANGE = 14, ROCK_CD = 5;
const LEAP_CD = 7, LEAP_RANGE = 40;
const RAGE_TIME = 8, RAGE_CD = 20, RAGE_DMG = 1.5, RAGE_SPEED = 1.25;
const ULT_RADIUS = 25, ULT_DMG = 220;
const GREEN = 0x55c232, DUST = 0x9a8f7a;

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

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
    this.noWallT = 0; this.climbN = new THREE.Vector3();
    this._impactVy = 0;
    this.ult = null;
    this._camSaved = null;
    this.fov = 0;
  }

  onActivate() {
    const c = this.game.cam;
    this._camSaved = { d: c.targetDistance, h: c.heightOffset };
    c.targetDistance = 9; c.heightOffset = 2.8;
    this.mode = 'normal'; this.charging = false; this.jumpCharge = 0; this.actionT = 0; this.gravityScale = 1;
  }
  onDeactivate() {
    const c = this.game.cam;
    if (this._camSaved) { c.targetDistance = this._camSaved.d; c.heightOffset = this._camSaved.h; this._camSaved = null; }
    c.fovKick = 0;
    this.timers.clear();
    this.mode = 'normal'; this.charging = false; this.rageT = 0; this.dmgMul = 1; this.speedMul = 1; this.ult = null;
    this.gravityScale = 1;
    this.model.setTint?.(0x55ff22, 0);
  }

  get abilityHints() {
    return [
      { action: 'jump', label: 'Super Jump', cooldown: 0, active: this.charging && this.jumpCharge > CHARGE_MIN },
      { action: 'special', label: 'Thunderclap', cooldown: Math.max(this.cooldownFrac('clap'), 0) },
      { action: 'ability', label: this.onGround ? 'Leap Smash' : 'Ground Pound', cooldown: this.cooldownFrac('leap') },
      { action: 'ability2', label: 'Rage', cooldown: this.cooldownFrac('rage'), active: this.rageT > 0 },
      { action: 'ultimate', label: 'Worldbreaker', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  // ---- update ----------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;
    this.modeT += dt;
    this.customMovement = true;

    this._rage(dt);
    this._ultTick(dt);

    const busy = this.actionT > 0 || this.ult;
    if (!this.ult) {
      this._abilities(dt, input, busy);
    }
    this._movement(dt, input);

    this._impactVy = this.vel.y;
    // sprint camera feedback
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.fov = damp(this.fov, this.onGround && hs > RUN + 2 ? 8 : 0, 4, dt);
    g.cam.fovKick = this.fov + (this.mode === 'super' ? clamp(this.vel.y / 52, 0, 1) * 8 : 0);
  }

  defaultMovement() {}

  _abilities(dt, input, busy) {
    const g = this.game;
    if (this.mode === 'climb') { if (input.pressed('attack') && !busy) this._meleeCombo(); return; }
    if (input.pressed('attack') && !busy) {
      if (!this.onGround && this.mode !== 'dive') this._dive(); else if (this.onGround) this._meleeCombo();
    }
    if (input.pressed('special') && !busy && (this.cooldowns.clap || 0) <= 0) this._clap();
    if (input.pressed('ability') && !busy) {
      if (!this.onGround) { if (this.mode !== 'dive') this._dive(); }
      else if ((this.cooldowns.leap || 0) <= 0) this._leapSmash();
    }
    if (input.pressed('ability2') && (this.cooldowns.rage || 0) <= 0 && this.rageT <= 0) this._startRage();
    if (input.pressed('ultimate') && this.focus >= 100 && !this.ult) this._startUlt();
    if (input.pressed('dodge') && this.onGround && (this.cooldowns.charge || 0) <= 0 && !busy && !this.charging) this._shoulderCharge(input);
  }

  // ---- movement ----------------------------------------------------------------
  _movement(dt, input) {
    const g = this.game, cam = g.cam;
    const wish = cam.moveVector(input.move, _w);
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();
    const mul = this.speedMul;
    const noMove = this.actionT > 0 && this.mode === 'normal';

    // --- special modes first
    if (this.mode === 'ultRise' || this.mode === 'ultSlam') { this._ultMove(dt); return; }
    if (this.mode === 'dash') { this._dashMove(dt); return; }
    if (this.mode === 'dive') { this.gravityScale = 2.2; this.setAnim('smash'); return; }

    // wall climb
    if (this.mode === 'climb') { this._climb(dt, input, wish, mag); return; }
    this.noWallT += dt; this.grabCd = (this.grabCd ?? 0) - dt;
    if (this.grabCd <= 0 && !this.onGround && this.onWall && input.move.y > 0.3 && this.mode !== 'leap') {
      _a.copy(this.wallNormal).negate();
      if (wish.dot(_a) > 0.35 || this.vel.y < 6 && wish.dot(_a) > 0) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
    }
    if (this.grabCd <= 0 && this.onGround && this.onWall && mag > 0.4 && this.mode === 'normal' && !this.charging) {
      _a.copy(this.wallNormal).negate();
      if (wish.dot(_a) > 0.6 && this._wallTall()) { this._startClimb(); this._climb(dt, input, wish, mag); return; }
    }

    this.gravityScale = 1;

    // --- jump charge
    if (this.onGround && this.mode !== 'leap') {
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
    const bull = input.down('swing') && this.onGround && mag > 0.1 && !this.charging && !noMove;
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
      if (mag > 0.01 && !noMove && !this.charging) this.faceTowards(wish, dt, airborne ? 4 : 8);
    }
    if (this.mode === 'super' && this.onGround && this.modeT > 0.2) this.mode = 'normal';

    // --- footsteps / bulldoze
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 6) {
      this.stepT -= dt;
      const cad = bull ? 0.26 : hs > RUN - 1 ? 0.34 : 0.48;
      if (this.stepT <= 0) {
        this.stepT = cad;
        g.cam.shake(bull ? 0.08 : hs > RUN - 1 ? 0.035 : 0.012);
        g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.1), DUST, 3, 3, 0.4, 0.3);
        if (hs > RUN - 1) { g.audio?.play('land', { volume: 0.25, pitch: 0.6 }); rumble(g, 0.15, 0.1, 60); }
      }
    }
    if (bull) {
      this.bullT -= dt;
      if (this.bullT <= 0) {
        this.bullT = 0.22;
        const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 3.4, arc: 120, damage: 14 * this.dmgMul, knockback: 16, up: 3, stun: 0.5, source: this }) ?? [];
        if (hits.length) { for (const h of hits) this.registerHit(); g.audio?.play('heavyhit', { volume: 0.6 }); g.cam.shake(0.15); rumble(g, 0.5, 0.3, 90); }
      }
    }

    // --- anim
    if (this.actionT > 0 && this.mode === 'normal') this.setAnim(this.actionAnim, hs);
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
    g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.3), DUST, 30, 9, 0.8, 0.4);
    g.audio?.play('smash', { volume: 0.7 }); g.audio?.play('roar', { volume: 0.4 + f * 0.3 });
    rumble(g, 0.4 + f * 0.5, 0.6, 250);
    g.combat?.aoe?.({ center: this.pos.clone(), radius: 4 + f * 3, damage: 10 + f * 20, knockback: 10, up: 7, stun: 0.6, source: this });
  }

  // ---- wall climbing --------------------------------------------------------------
  _wallTall() {
    // only start climbing from the ground when there is wall above head height
    _a.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z);
    _b.copy(this.wallNormal).negate();
    const hit = this.game.physics.raycast(_a, _b, this.radius + 1.2, { ignoreGround: true });
    return !!hit;
  }
  _startClimb() {
    this.mode = 'climb'; this.modeT = 0; this.noWallT = 0;
    this.climbN.copy(this.wallNormal);
    this.charging = false; this.jumpCharge = 0;
    this.game.audio?.play('smash', { volume: 0.4 });
    this.game.fx?.burst?.(this.pos.clone().setY(this.pos.y + 1.5), DUST, 14, 5, 0.5, 0.3);
    this.game.cam.shake(0.1);
  }
  _climb(dt, input, wish, mag) {
    const g = this.game;
    this.gravityScale = 0;
    if (this.onWall) { this.noWallT = 0; this.climbN.copy(this.wallNormal); } else this.noWallT += dt;
    const n = this.climbN;
    // leap off
    if (input.pressed('jump')) {
      this.mode = 'normal'; this.gravityScale = 1;
      this.vel.set(n.x * 16, 20, n.z * 16); this.grabCd = 0.4;
      g.audio?.play('jump', { pitch: 0.6 }); this.onWall = false;
      this.yaw = Math.atan2(n.x, n.z);
      return;
    }
    // let go
    if (input.move.y < -0.4 || (this.onGround && input.move.y <= 0.1)) {
      this.mode = 'normal'; this.gravityScale = 1; this.vel.set(n.x * 3, 0, n.z * 3); return;
    }
    if (this.noWallT > 0.18) {
      // cleared the ledge: vault over it
      this.mode = 'normal'; this.gravityScale = 1;
      this.vel.set(-n.x * 7, 10, -n.z * 7); this.grabCd = 0.6;
      g.audio?.play('whoosh'); return;
    }
    const up = input.move.y > 0.15 ? CLIMB_SPEED * this.speedMul : input.move.y < -0.15 ? -5 : 0;
    // lateral along wall
    _a.set(-n.z, 0, n.x);
    const side = Math.sign(g.cam.right.dot(_a)) || 1;
    const lat = input.move.x * 5 * side * this.speedMul;
    this.vel.set(-n.x * 3 + _a.x * lat, up, -n.z * 3 + _a.z * lat);
    this.yaw = Math.atan2(-n.x, -n.z);
    this.setAnim(up !== 0 ? 'wallrun' : 'wallidle', Math.abs(up));
    this.stepT -= dt;
    if (this.stepT <= 0 && up !== 0) {
      this.stepT = 0.4; g.cam.shake(0.05);
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
    if (this.mode === 'dive') { r = 9; dmg = 85; shake = 0.9; kind = 'dive'; }
    else if (this.mode === 'leap') { r = 8; dmg = 70; shake = 0.8; kind = 'leap'; }
    else if (this.mode === 'super' || vy > 20) { r = clamp(4 + vy * 0.2, 4, 15); dmg = 25 + vy * 1.4; shake = clamp(0.3 + vy * 0.014, 0.3, 1.0); kind = 'super'; }
    else if (vy > 13) { r = 3.5; dmg = 12; shake = 0.2; }
    if (this.mode !== 'climb') { this.mode = 'normal'; this.gravityScale = 1; }
    if (r > 0) {
      g.combat?.aoe?.({ center: this.pos.clone(), radius: r, damage: dmg * this.dmgMul, knockback: 12 + r, up: 8, stun: 1.0, source: this });
      impactFx(g, this.pos, r, GREEN, shake);
      g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), r * 0.6, DUST, 0.7);
      g.audio?.play('smash'); if (kind !== 'normal') g.audio?.play('heavyhit', { volume: 0.7 });
      rumble(g, clamp(shake, 0.3, 1), 0.6, 120 + shake * 300);
      if (kind !== 'normal') { this.actionAnim = 'land'; this.actionT = 0.35; this.setAnim('land'); }
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
    const anims = ['punch1', 'punch2', 'smash'], dmg = [40, 42, 75], kn = [12, 12, 26], up = [3, 3, 10], dur = [0.5, 0.5, 0.85], delay = [0.18, 0.18, 0.3];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.3;
    g.audio?.play('whoosh', { volume: 0.7, pitch: 0.6 });
    this.timers.after(delay[step], () => {
      if (!this.active) return;
      const fwd = this.forward;
      const hits = g.combat?.melee?.({ origin: this.center, forward: fwd, range: 3.8, arc: 140, damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: step === 2 ? 1.2 : 0.4, source: this }) ?? [];
      for (const h of hits) { this.registerHit(); g.fx?.burst?.(enemyCenter(h, _b).clone(), 0xffffff, 8, 6, 0.3, 0.25); }
      if (hits.length) { g.audio?.play(step === 2 ? 'smash' : 'heavyhit'); rumble(g, 0.5 + step * 0.2, 0.4, 120); }
      g.cam.shake(0.12 + step * 0.2);
      if (step === 2) {
        const c = this.pos.clone().addScaledVector(fwd, 3.2);
        g.combat?.aoe?.({ center: c, radius: 5.5, damage: 30 * this.dmgMul, knockback: 14, up: 6, stun: 0.8, source: this });
        impactFx(g, c, 5.5, DUST, 0.3);
        g.audio?.play('smash', { volume: 0.8 });
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
    g.audio?.play('roar', { volume: 0.5 }); g.cam.shake(0.2);
  }
  _dashMove(dt) {
    const g = this.game;
    this.gravityScale = 1;
    this.dashT -= dt; this.hitT -= dt;
    this.vel.x = this.dashDir.x * 32; this.vel.z = this.dashDir.z * 32;
    this.setAnim('dash', 32);
    if (this.hitT <= 0) {
      this.hitT = 0.1;
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.dashDir, range: 3.4, arc: 150, damage: 30 * this.dmgMul, knockback: 22, up: 5, stun: 1.0, source: this }) ?? [];
      if (hits.length) { for (const h of hits) this.registerHit(); g.audio?.play('heavyhit'); g.cam.shake(0.3); rumble(g, 0.6, 0.4, 120); }
    }
    this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.15; g.cam.shake(0.06); g.fx?.burst?.(this.pos.clone().setY(this.pos.y + 0.1), DUST, 4, 3, 0.4, 0.3); }
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
    this.actionAnim = 'cast'; this.actionT = 0.6; this.setAnim('cast');
    this.timers.after(0.25, () => {
      if (!this.active) return;
      const fwd = this.forward, p = this.pos;
      for (const e of enemiesNear(g, p, CLAP_RANGE)) {
        _b.subVectors(e.pos, p).setY(0);
        const d = _b.length(); if (d > 0.01) _b.divideScalar(d);
        if (d > 1.5 && _b.dot(fwd) < Math.cos(THREE.MathUtils.degToRad(75))) continue;
        const kb = _b.clone().multiplyScalar(18); kb.y = 5;
        e.takeDamage?.(30 * this.dmgMul, { knockback: kb, stun: 2.6, source: this, kind: 'clap' });
        this.registerHit();
      }
      const c = p.clone().addScaledVector(fwd, 4);
      g.fx?.shockwave?.(c, 12, 0xffffff);
      g.fx?.ring?.(p.clone().setY(p.y + 1.2), 8, 0xffffff, 0.4);
      g.fx?.ring?.(c.clone().setY(c.y + 1), 14, GREEN, 0.6);
      g.fx?.flash?.(c.clone().setY(c.y + 1.5), 0xffffff, 6, 0.2);
      g.audio?.play('clap');
      g.cam.shake(0.7); rumble(g, 0.9, 0.9, 260);
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
    g.audio?.play('smash', { volume: 0.7 }); g.cam.shake(0.3); rumble(g, 0.5, 0.4, 150);
    this.actionAnim = 'throw'; this.actionT = 0.75; this.setAnim('throw');
    this.timers.after(0.4, () => {
      if (!this.active) return;
      const from = this.pos.clone(); from.y += this.height + 0.6; from.addScaledVector(this.forward, 0.8);
      aimInfo(this, 70, _aim);
      const t = this.findTarget(55, 40);
      const to = t ? enemyCenter(t, _c).clone() : _aim.point.clone();
      const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
      const speed = 36, tt = dist / speed, grav = 10;
      const vel = dir.clone().multiplyScalar(speed); vel.y += 0.5 * grav * tt;
      let done = false;
      const boom = (p) => {
        if (done) return; done = true;
        const c = (p?.pos ?? to).clone();
        g.combat?.aoe?.({ center: c, radius: 5, damage: 35 * this.dmgMul, knockback: 14, up: 7, stun: 1, source: this });
        impactFx(g, c, 5, DUST, 0.4); g.audio?.play('smash'); g.audio?.play('explosion', { volume: 0.4 });
      };
      g.combat?.projectile?.({ pos: from, vel, damage: 80 * this.dmgMul, radius: 1.3, life: 4, gravity: grav, color: 0x8a7f70, size: 1.3, kind: 'rock', team: 'player', pierce: false, source: this, onHit: (tg, p) => boom(p), onExpire: (p) => boom(p) });
      g.audio?.play('throw'); g.cam.shake(0.15);
    });
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
    this.setAnim('jump');
  }

  // ---- rage ---------------------------------------------------------------------------------------
  _startRage() {
    const g = this.game;
    this.useCooldown('rage', RAGE_CD);
    this.rageT = RAGE_TIME; this.dmgMul = RAGE_DMG; this.speedMul = RAGE_SPEED;
    this.actionAnim = 'cast'; this.actionT = 0.9; this.setAnim('cast');
    this.invuln = Math.max(this.invuln, 0.5);
    g.audio?.play('roar'); g.cam.shake(0.7); rumble(g, 0.8, 0.8, 400);
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 9, GREEN, 0.7);
    g.fx?.burst?.(this.center, GREEN, 40, 9, 0.8, 0.35);
    g.hud?.toast?.('RAGE!');
  }
  _rage(dt) {
    if (this.rageT <= 0) return;
    this.rageT -= dt;
    const pulse = 0.4 + 0.12 * Math.sin(this.game.time * 10);
    this.model.setTint?.(0x44ff22, this.rageT > 0 ? pulse : 0);
    this._rageFx = (this._rageFx ?? 0) - dt;
    if (this._rageFx <= 0) { this._rageFx = 0.18; this.game.fx?.burst?.(this.center.add(_a.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.3), (Math.random() - 0.5) * 1.2)), GREEN, 2, 2, 0.5, 0.25); }
    this.heal?.(dt * 3);
    if (this.rageT <= 0) { this.dmgMul = 1; this.speedMul = 1; this.model.setTint?.(0x44ff22, 0); this.game.hud?.toast?.('Rage over'); }
  }

  // ---- ultimate: Worldbreaker Smash --------------------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this.focus = 0; this.charging = false;
    const t = this.findTarget(45, 120);
    this.ult = { target: t ? t.pos.clone() : this.pos.clone().addScaledVector(this.forward, 10), t: 0 };
    this.mode = 'ultRise'; this.modeT = 0; this.gravityScale = 0;
    this.invuln = Math.max(this.invuln, 3);
    this.vel.set(0, 42, 0);
    g.audio?.play('roar'); g.cam.shake(0.6); g.slowmo?.(0.5, 0.35);
    g.hud?.toast?.('WORLDBREAKER');
    impactFx(g, this.pos, 8, GREEN, 0.5);
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
    for (const e of enemiesNear(g, c, ULT_RADIUS)) this.registerHit();
    impactFx(g, c, ULT_RADIUS, GREEN, 1.4);
    g.fx?.shockwave?.(c.clone(), ULT_RADIUS * 0.6, 0xffffff);
    g.fx?.flash?.(c.clone().setY(c.y + 2), 0xbfff99, 8, 0.4);
    g.fx?.burst?.(c.clone().setY(c.y + 0.5), DUST, 80, 16, 1.2, 0.6);
    this.timers.after(0.15, () => g.fx?.ring?.(c.clone().setY(c.y + 0.1), ULT_RADIUS * 0.8, GREEN, 0.9));
    this.timers.after(0.3, () => g.fx?.ring?.(c.clone().setY(c.y + 0.1), ULT_RADIUS, DUST, 1.1));
    g.audio?.play('smash'); g.audio?.play('explosion'); g.audio?.play('roar');
    rumble(g, 1, 1, 800);
    g.slowmo?.(0.45, 0.2);
    this.actionAnim = 'land'; this.actionT = 0.7; this.setAnim('land');
    this.vel.set(0, 0, 0);
  }

  updateVisuals(dt) {
    // tiny breathing/jump-charge squash handled by the model via anim; nothing scene-side to maintain
  }
}
