// ULTRON (boss, 2.6 m) + ultron_drone (flying sentry, 80 hp).
// Hovers just above street level. Attacks: eye-laser sweeps (telegraphed lines), chest beam, homing rocket fists, drone summons,
// hover punches, and (phase 3, symbiote-infected) tendril lashes.
// FAIRNESS: every ~8 s he rises, telegraphs a ground-pound and SLAMS DOWN (shockwave), then stays GROUNDED ~4 s on foot
// (+30% damage taken). Poise breaks also drop him to the ground for 2.6-3.4 s. His hover height is low enough for melee anyway.
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import '../../models/villains_b.js';
import { BossB, FlyerB, rnd, clamp, _o, _a, _b, _f, _d } from './b_base.js';

const RED = 0xff2020, EMBER = 0xff7a30;

export class Ultron extends BossB {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'ultron', modelId: 'ultron', name: 'ULTRON', hp: 4000, radius: 0.95, height: 2.6, speed: 7, mass: 20, gravity: 0, poise: 300, deathColor: EMBER });
    this.flying = true; this.flyAccel = 14;
    this.cd = { any: 3, laser: 2, chest: 9, rockets: 5, summon: 10, slam: 9, lash: 4, punch: 2 };
    this.orbitA = rnd(0, 6.28); this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.hoverH = 1.7;
    this.target3 = new THREE.Vector3();
    this.A0 = 0; this.dirS = 1; this.pitch = 0; this.dropAt = 0;
    this.groundT = 4.4; this.swings = 0; this._t = 0; this.staggerT = 0; this.relI = 0; this.relT = 0; this.nRock = 2;
    this.grounded = false;
  }

  damageMult(a, o) {
    switch (this.state) {
      case 'intro': return 0.25;
      case 'phase': return 0.35;
      case 'grounded': case 'stagger': case 'liftoff': return 1.3;
      default: return 1;
    }
  }
  canStagger() { return ['hover', 'laser', 'chest', 'rockets', 'summon', 'punch', 'lash'].includes(this.state); }
  startStagger(heavy) {
    this.flying = false; this.gravity = 28; this.vel.set(0, -2, 0); this.windup = 0; this.attacking = false;
    this.staggerT = heavy ? 3.4 : 2.6;
    this.cd.slam = Math.max(this.cd.slam, 6);
    this.say('SYSTEMS DOWN!', 0xffe040);
    this.game.audio?.play?.('heavyhit', { pos: this.pos }); this.game.cam.shake(0.4);
    this.game.fx.burst(this.center, EMBER, 24, 7, 0.6, 0.3);
    this._go('stagger');
  }

  eye(out) { this.muzzle(out, 'head'); this.forward(_f); out.x += _f.x * 0.28; out.z += _f.z * 0.28; out.y += 0.18; return out; }
  chestP(out) { return this.muzzle(out, 'chest'); }

  // ---------------------------------------------------------------- ai
  introStart() { this.flying = true; this.gravity = 0; }
  _hoverY(x, z) {
    const pl = this.target;
    return Math.max(pl ? pl.pos.y : 0, this.floorAt(x, z, (pl ? pl.pos.y : this.pos.y) + 12)) + this.hoverH + Math.sin(this.stateT * 1.7) * 0.18;
  }

  think(dt) {
    const pl = this.target;
    this.model.fx.jet = this.flying ? 1 : 0;
    if (!pl) { this.hold(); this.setAnim('hover', 1); return; }
    if (this.pendingPhase !== this.phase && this.state === 'hover') { this._startPhase(); return; }
    switch (this.state) {
      case 'intro': {
        this.flying = true; this.gravity = 0;
        this.steer(this.pos.x, this._hoverY(this.pos.x, this.pos.z) + 3, this.pos.z, 6, 10);
        this.setAnim('hover', 1); this.facePlayer(dt, 4);
        if (this.stateT > 2.0) { this.cd.any = 1.0; this.cd.slam = 8; this._go('hover'); }
        break;
      }
      case 'hover': this._hover(dt); break;
      case 'laser': this._laser(dt); break;
      case 'chest': this._chest(dt); break;
      case 'rockets': this._rockets(dt); break;
      case 'summon': this._summon(dt); break;
      case 'punch': this._punch(dt); break;
      case 'lash': this._lash(dt); break;
      case 'slam': this._slam(dt); break;
      case 'grounded': this._grounded(dt); break;
      case 'liftoff': this._liftoff(dt); break;
      case 'stagger': this._stagger(dt); break;
      case 'phase': this._phase(dt); break;
      default: this._go('hover');
    }
  }

  _hover(dt) {
    const pl = this.target, sp = this.sp, d = this.dist;
    this.attacking = false; this.windup = 0;
    this.orbitA += this.orbitDir * dt * 0.28 * sp;
    const R = d < 5.5 ? 5.5 : 9.5;
    const tx = pl.pos.x + Math.cos(this.orbitA) * R, tz = pl.pos.z + Math.sin(this.orbitA) * R;
    this.steer(tx, this._hoverY(tx, tz), tz, 8.5 * sp, 14);
    this.facePlayer(dt, 6);
    this.setAnim(Math.hypot(this.vel.x, this.vel.z) > 5 ? 'fly' : 'hover', 1);
    if (this.cd.any > 0) return;
    if (this.cd.slam <= 0) { this._startSlam(); return; }
    const opts = [];
    if (d < 5 && this.cd.punch <= 0) opts.push(['punch', 8]);
    if (this.hasLOS && d < 26 && this.cd.laser <= 0) opts.push(['laser', 5]);
    if (this.hasLOS && d < 28 && this.cd.chest <= 0) opts.push(['chest', 3]);
    if (this.hasLOS && this.cd.rockets <= 0) opts.push(['rockets', 5]);
    if (this.cd.summon <= 0 && this.liveMinions('ultron_drone') < 3) opts.push(['summon', 3]);
    if (this.phase >= 3 && d < 8 && this.cd.lash <= 0) opts.push(['lash', 7]);
    if (!opts.length) { this.cd.any = 0.4; return; }
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot, pick = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
    switch (pick) {
      case 'punch': this.swings = 0; this._go('punch'); this.sub = 'approach'; this.cd.punch = rnd(3, 5); break;
      case 'laser': this._go('laser'); this.cd.laser = rnd(6, 8) / sp; break;
      case 'chest': this._go('chest'); this.cd.chest = rnd(12, 15) / sp; break;
      case 'rockets': this.nRock = this.phase === 1 ? 2 : this.phase === 2 ? 3 : 4; this._go('rockets'); this.cd.rockets = rnd(8, 10) / sp; break;
      case 'summon': this._go('summon'); this.cd.summon = 24; break;
      case 'lash': this._go('lash'); this.cd.lash = 8; break;
    }
  }
  _back(t) { this.cd.any = t; this.attacking = false; this.windup = 0; this._go('hover'); }

  // ---- eye lasers --------------------------------------------------------------
  _laser(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    const total = 1.0 / sp, SWEEP = this.phase === 3 ? 1.0 : 1.3, SPAN = 0.62;
    this.hold(); this.attacking = true;
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('cast', 0.8);
      if (this.stateT < total - 0.35) { this.A0 = Math.atan2(this.dx, this.dz); this.dirS = Math.random() < 0.5 ? -1 : 1; this.D = clamp(this.dist, 5, 22); }
      this.faceYawTo(this.A0 - this.dirS * SPAN, dt, 10);
      this.eye(_a);
      const gy = pl.pos.y + 0.9;
      for (const [off, w, col] of [[-SPAN, 0.06, RED], [SPAN, 0.025, 0x802020]]) {
        const a = this.A0 + this.dirS * off;
        _b.set(this.pos.x + Math.sin(a) * this.D, gy, this.pos.z + Math.cos(a) * this.D);
        fx.beam(_a, _b, col, w, 0.05);
        if (this.phase >= 2 && off < 0) { _b.set(this.pos.x + Math.sin(this.A0 - this.dirS * off) * this.D, gy, this.pos.z + Math.cos(this.A0 - this.dirS * off) * this.D); fx.beam(_a, _b, 0x802020, 0.025, 0.05); }
      }
      fx.glow(_a, RED, 0.5 + this.stateT * 1.5, 0.1);
      if (this.stateT <= dt) this.game.audio?.play?.('laser', { pos: this.pos, pitch: 0.6, volume: 0.6 });
      if (this.stateT >= total) { this.sub = 'sweep'; this.stateT = 0; this.windup = 0; this._tick = 0; }
    } else if (this.sub === 'sweep') {
      this.setAnim('cast', 1);
      const u = clamp(this.stateT / SWEEP, 0, 1);
      const beams = this.phase >= 2 ? 2 : 1;
      this.eye(_a);
      this.faceYawTo(this.A0 + this.dirS * (-SPAN + 2 * SPAN * u), dt, 14);
      this._tick -= dt;
      const tick = this._tick <= 0; if (tick) this._tick = 0.1;
      const gy = this.target.pos.y + 0.9;
      for (let i = 0; i < beams; i++) {
        const sgn = i ? -1 : 1;
        const a = this.A0 + this.dirS * sgn * (-SPAN + 2 * SPAN * u);
        _b.set(this.pos.x + Math.sin(a) * this.D, gy, this.pos.z + Math.cos(a) * this.D);
        _d.subVectors(_b, _a).normalize();
        const hit = this.game.physics.raycast(_a, _d, this.D + 12);
        const len = hit ? hit.distance : this.D + 12;
        _b.copy(_a).addScaledVector(_d, len);
        fx.beam(_a, _b, RED, 0.28, 0.07);
        if (Math.random() < 0.3) fx.sparks?.(_b, _d, 0xffa060, 4, 6, 0.2, 0.08);
        if (tick) this.game.combat.hitscan({ origin: _a, dir: _d, range: len, damage: 7, team: 'enemy', width: 1.0, source: this });
      }
      this.game.cam.shake(0.05);
      if (this.stateT >= SWEEP) { this.sub = 'end'; this.stateT = 0; }
    } else {
      this.windup = 0;
      if (this.stateT > 0.5) this._back(rnd(1.2, 2.2) / sp);
    }
  }

  // ---- chest beam ------------------------------------------------------------------
  _chest(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    const total = 1.5 / sp, FIRE = 0.6;
    this.hold(); this.attacking = true;
    this.chestP(_a);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('smash', 0.5);
      this.facePlayer(dt, this.windup > 0.35 ? 8 : 0);
      if (this.windup > 0.3) { _d.set(pl.center.x - _a.x, pl.center.y - _a.y, pl.center.z - _a.z).normalize(); this._dir = (this._dir || new THREE.Vector3()).copy(_d); }
      const w = 0.04 + (this.stateT / total) * 0.18;
      _b.copy(_a).addScaledVector(this._dir ?? _d, 30);
      fx.beam(_a, _b, RED, w, 0.05);
      fx.glow(_a, RED, 0.6 + this.stateT * 2, 0.1);
      if (this.stateT <= dt) this.game.audio?.play?.('laser', { pos: this.pos, pitch: 0.4, volume: 0.7 });
      if (this.stateT >= total) { this.sub = 'fire'; this.stateT = 0; this.windup = 0; this._tick = 0; this.game.cam.shake(0.5); }
    } else if (this.sub === 'fire') {
      this.setAnim('smash', 1);
      _d.copy(this._dir);
      const hit = this.game.physics.raycast(_a, _d, 40);
      const len = hit ? hit.distance : 40;
      _b.copy(_a).addScaledVector(_d, len);
      fx.beam(_a, _b, 0xffd0d0, 0.9, 0.08); fx.beam(_a, _b, RED, 1.5, 0.08);
      fx.lightning(_a, _b, 0xff9090, 0.08, 1);
      this._tick -= dt;
      if (this._tick <= 0) { this._tick = 0.1; this.game.combat.hitscan({ origin: _a, dir: _d, range: len, damage: 13, team: 'enemy', width: 2.0, source: this, knockback: 8 }); }
      this.game.cam.shake(0.12);
      if (this.stateT >= FIRE) { this.sub = 'end'; this.stateT = 0; }
    } else { this.windup = 0; if (this.stateT > 0.7) this._back(rnd(1.6, 2.6) / sp); }
  }

  // ---- rocket fists ---------------------------------------------------------------------
  _rockets(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.95 / sp;
    this.hold(); this.attacking = true; this.facePlayer(dt, 6);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('shoot', 0.8);
      this.muzzle(_a, 'handR'); this.game.fx.glow(_a, EMBER, 0.9 + this.stateT, 0.1);
      this.muzzle(_a, 'handL'); this.game.fx.glow(_a, EMBER, 0.9 + this.stateT, 0.1);
      if (this.stateT <= dt) this.game.audio?.play?.('missile', { pos: this.pos });
      if (this.stateT >= total) { this.sub = 'rel'; this.relI = 0; this.relT = 0; this.windup = 0; }
    } else if (this.sub === 'rel') {
      this.setAnim('shoot', 1.3);
      this.relT -= dt;
      if (this.relI < this.nRock && this.relT <= 0) {
        this.muzzle(_a, this.relI % 2 ? 'handL' : 'handR');
        _f.set(this.relI % 2 ? 1 : -1, 0.8, 0.5).applyAxisAngle(_d.set(0, 1, 0), this.yaw).normalize();
        this.game.combat.projectile({ pos: _a, vel: _f.clone().multiplyScalar(14), kind: 'missile', damage: 14, blast: 3.6, homing: pl, turn: 1.6, life: 3.6, team: 'enemy', source: this, knockback: 8 });
        this.game.fx.burst(_a, EMBER, 8, 4, 0.3, 0.25);
        this.relI++; this.relT = 0.28;
      }
      if (this.relI >= this.nRock && this.relT < -0.4) this._back(rnd(1.4, 2.4) / sp);
    }
  }

  _summon(dt) {
    this.hold(); this.attacking = true; this.windup = 0;
    this.setAnim('cast', 1); this.facePlayer(dt, 3);
    if (this.stateT <= dt) { this.game.audio?.play?.('boss_roar', { pitch: 1.3, volume: 0.5 }); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 6, RED); }
    if (this.stateT > 1.2 && this.sub !== 'done') {
      this.sub = 'done';
      const n = this.phase === 3 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + Math.random();
        this.spawnMinion('ultron_drone', _o.set(this.pos.x + Math.cos(a) * 3.5, this.pos.y + 1, this.pos.z + Math.sin(a) * 3.5));
      }
    }
    if (this.stateT > 1.8) this._back(rnd(1.4, 2.2));
  }

  // ---- hover punch --------------------------------------------------------------------------
  _punch(dt) {
    const pl = this.target, sp = this.sp;
    if (this.sub === 'approach') {
      this.facePlayer(dt, 9); this.setAnim('fly', 1);
      this.steer(pl.pos.x, this._hoverY(pl.pos.x, pl.pos.z), pl.pos.z, 12 * sp, 24);
      if (this.dist < 3.6 || this.stateT > 1.3) { this.sub = 'wind'; this.stateT = 0; }
      return;
    }
    this.hold();
    if (this.sub === 'follow') {
      this.windup = 0; this.attacking = false; this.setAnim('punch2', 0.6); this.facePlayer(dt, 6);
      if (this.stateT > 0.22 / sp) { if (this.swings >= 2) this._back(rnd(1.4, 2.4) / sp); else { this.sub = 'wind'; this.stateT = 0; } }
      return;
    }
    const total = (this.swings ? 0.5 : 0.65) / sp;
    this.attacking = true; this.windup = Math.max(0, total - this.stateT);
    this.facePlayer(dt, this.windup > 0.2 ? 8 : 0);
    this.setAnim(this.swings ? 'punch2' : 'punch1', 1);
    if (this.stateT <= dt) this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 4.4, RED, total);
    if (this.stateT >= total) {
      this.windup = 0; this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
      this.vel.x += _f.x * 8; this.vel.z += _f.z * 8;
      this.game.combat.melee({ origin: _o, forward: _f, range: 4.4, arc: 120, damage: this.swings ? 18 : 14, knockback: this.swings ? 14 : 8, up: this.swings ? 5 : 2, team: 'enemy', source: this });
      this.game.audio?.play?.('smash', { pos: this.pos }); this.game.cam.shake(0.25);
      this.swings++; this.sub = 'follow'; this.stateT = 0;
    }
  }

  // ---- tendril lash (phase 3) -----------------------------------------------------------------
  _lash(dt) {
    const sp = this.sp;
    const total = 1.0 / sp;
    this.hold(); this.attacking = true; this.facePlayer(dt, 4);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT); this.setAnim('smash', 0.6);
      if (Math.floor(this.stateT * 5) !== Math.floor((this.stateT - dt) * 5)) this.game.fx.ring(_o.set(this.pos.x, this.floorAt(this.pos.x, this.pos.z, this.pos.y) + 0.12, this.pos.z), 6.4, RED, 0.3);
      if (this.stateT >= total) {
        this.sub = 'hit'; this.stateT = 0; this.windup = 0;
        _o.set(this.pos.x, this.floorAt(this.pos.x, this.pos.z, this.pos.y) + 0.3, this.pos.z);
        this.game.combat.aoe({ center: _o, radius: 6.4, damage: 20, knockback: 13, up: 5, team: 'enemy', source: this });
        this.game.fx.shockwave(_o, 8, 0x401018); this.game.fx.burst(_o, 0x000000, 24, 7, 0.5, 0.3); this.game.cam.shake(0.5);
        this.game.audio?.play?.('symbiote', { pos: this.pos });
      }
    } else if (this.stateT > 0.6) this._back(rnd(1.4, 2.2));
  }

  // ---- ground-pound -------------------------------------------------------------------------------
  _startSlam() { this._go('slam'); this.attacking = true; this.cd.slam = 999; }
  _slam(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    this.attacking = true;
    if (this.sub === '') {
      const gy = Math.max(pl.pos.y, this.floorAt(pl.pos.x, pl.pos.z, pl.pos.y + 12));
      this.facePlayer(dt, 6); this.setAnim('fly', 1);
      this.steer(pl.pos.x + Math.cos(this.orbitA) * 3, gy + 8.5, pl.pos.z + Math.sin(this.orbitA) * 3, 16 * sp, 30);
      if (this.pos.y > gy + 7 || this.stateT > 1.4) { this.sub = 'lock'; this.stateT = 0; this.target3.copy(pl.pos); this.game.audio?.play?.('boss_roar', { pitch: 0.7, volume: 0.7 }); }
    } else if (this.sub === 'lock') {
      const total = 1.1 / sp;
      this.windup = Math.max(0, total - this.stateT) + 0.5;
      this.setAnim('charge', 0.6); this.facePlayer(dt, 6);
      this.steer(this.target3.x, this.pos.y, this.target3.z, 7, 20);
      if (this.stateT < total - 0.3) this.target3.copy(pl.pos);
      if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.ring(this.target3.x, this.target3.y, this.target3.z, 8, RED, 0.35);
      _a.set(this.target3.x, this.target3.y + 0.2, this.target3.z);
      fx.beam(this.center, _a, RED, 0.06, 0.06);
      if (this.stateT >= total) { this.sub = 'drop'; this.stateT = 0; this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.5 }); }
    } else {
      this.setAnim('smash', 1.4);
      _d.set(this.target3.x - this.pos.x, this.target3.y - this.pos.y, this.target3.z - this.pos.z);
      const dist = _d.length(); _d.normalize();
      this.fw.copy(_d).multiplyScalar(46); this.flyAccel = 200;
      fx.trailPuff(this.pos.x, this.pos.y + 1, this.pos.z, EMBER, 1.0, 0.3, 0.05);
      if (dist < 2.6 || this.onGround || this.stateT > 2.2) this._impact();
    }
  }
  _impact() {
    const g = this.game;
    const gy = this.floorAt(this.pos.x, this.pos.z, this.pos.y + 1);
    _o.set(this.pos.x, Math.max(gy, this.pos.y - 0.5) + 0.3, this.pos.z);
    g.combat.aoe({ center: _o.clone(), radius: 8, damage: 24, knockback: 16, up: 8, team: 'enemy', source: this });
    g.fx.shockwave(_o, 12, EMBER); g.fx.explosion(_o.clone().setY(_o.y + 0.5), 3.4, EMBER);
    g.cam.shake(1.0); g.input?.rumble?.(0.9, 0.6, 250); g.audio?.play?.('smash', { pos: this.pos }); g.audio?.play?.('explosion', { pos: this.pos });
    this.flying = false; this.gravity = 28; this.vel.set(0, 0, 0); this.windup = 0; this.attacking = false;
    this.say('GROUNDED!', 0xffe040);
    this.groundT = this.phase === 3 ? 3.9 : 4.5;
    this._go('grounded'); this.swings = 0;
  }
  _grounded(dt) {
    const pl = this.target, sp = this.sp, d = this.dist;
    this.hold();
    if (this.stateT < 1.0) { this.setAnim('stunned', 0.8); this.windup = 0; this.attacking = false; return; }
    switch (this.sub) {
      case '': {
        this.attacking = false; this.windup = 0; this.facePlayer(dt, 8);
        if (this.stateT > this.groundT) { this._go('liftoff'); return; }
        if (d > 3.3) { this.moveToward(pl.pos.x, pl.pos.z, 5.5 * sp); this.setAnim('run', 0.9); }
        else { this.sub = 'wind'; this._t = 0; this.swings = 0; }
        break;
      }
      case 'wind': {
        const total = (this.swings ? 0.5 : 0.65) / sp;
        this._t += dt; this.attacking = true; this.windup = Math.max(0, total - this._t); this.facePlayer(dt, this.windup > 0.2 ? 8 : 0);
        this.setAnim(this.swings ? 'punch2' : 'punch1', 1);
        if (this._t <= dt) this.ring(this.pos.x, this.pos.y, this.pos.z, 4.4, RED, total);
        if (this._t >= total) {
          this.windup = 0; this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
          this.vel.x += _f.x * 5; this.vel.z += _f.z * 5;
          this.game.combat.melee({ origin: _o, forward: _f, range: 4.2, arc: 120, damage: this.swings ? 18 : 14, knockback: this.swings ? 14 : 8, up: this.swings ? 5 : 2, team: 'enemy', source: this });
          this.game.audio?.play?.('smash', { pos: this.pos });
          this.swings++; this._t = 0; this.sub = this.swings >= 2 ? 'rec' : 'follow';
        }
        break;
      }
      case 'follow': this.windup = 0; this._t += dt; this.setAnim('punch2', 0.6); this.facePlayer(dt, 6); if (this._t > 0.22) { this.sub = 'wind'; this._t = 0; } break;
      case 'rec': this.windup = 0; this.attacking = false; this._t += dt; this.setAnim('idle', 1); this.facePlayer(dt, 3); if (this._t > 1.0) this.sub = ''; break;
      default: this.sub = '';
    }
  }
  _liftoff(dt) {
    this.hold(); this.setAnim('hover', 1); this.attacking = false; this.windup = 0;
    if (this.stateT <= dt) { this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 0.2, this.pos.z), EMBER, 16, 5, 0.5, 0.3); this.game.audio?.play?.('whoosh', { pos: this.pos }); }
    if (this.stateT > 0.5) { this.flying = true; this.gravity = 0; this.vel.y = 7; this.cd.slam = rnd(8, 9); this.cd.any = 1.2; this._go('hover'); }
  }
  _stagger(dt) {
    this.hold(); this.setAnim('stunned', 0.9); this.attacking = false; this.windup = 0;
    if (Math.random() < dt * 6) this.game.fx.lightning(_a.set(this.pos.x, this.pos.y + 1.6, this.pos.z), _b.set(this.pos.x + rnd(-1.5, 1.5), this.pos.y + rnd(0.5, 3), this.pos.z + rnd(-1.5, 1.5)), RED, 0.15, 1);
    if (this.stateT > this.staggerT) { this.cd.any = 0.6; this._go('liftoff'); }
  }

  // ---- phase change ------------------------------------------------------------------------------
  _startPhase() {
    this.phase = this.pendingPhase; this._go('phase'); this.attacking = true; this.poise = 0;
    this.game.audio?.play?.('boss_roar'); this.game.cam.shake(0.8);
    if (this.phase === 2) this.game.hud?.toast?.('ULTRON: "There are no strings on me."');
    else { this.game.hud?.toast?.('ULTRON IS INFECTED!'); this.model.setVariant?.('infected'); this.bossTitle = 'SYMBIOTE ULTRON'; this.game.fx.burst(this.center, 0x000000, 34, 8, 0.8, 0.4); }
  }
  _phase(dt) {
    this.hold(); this.setAnim('cast', 1); this.facePlayer(dt, 3);
    if (this.sub === '' && this.stateT > 0.8) {
      this.sub = 'wave'; _o.set(this.pos.x, this.pos.y, this.pos.z);
      this.game.fx.shockwave(_o, 12, this.phase === 3 ? 0x501018 : RED);
      this.game.combat.aoe({ center: _o, radius: 9, damage: 8, knockback: 14, up: 4, team: 'enemy', source: this });
      this.cd.summon = 0.5;
    }
    if (this.stateT > 1.8) { this.attacking = false; this.cd.any = 0.8; this._go('hover'); }
  }
}

// ---------------------------------------------------------------------- drone
export class UltronDrone extends FlyerB {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'ultron_drone', modelId: 'ultron_drone', name: 'Ultron Sentry', hp: 80, radius: 0.5, height: 1.1, speed: 8, mass: 2, gravity: 0 });
    this.flying = true; this.flyAccel = 14;
    this.a = rnd(0, 6.28); this.dir = Math.random() < 0.5 ? -1 : 1; this.atk = rnd(1.2, 2.8); this.hover = rnd(1.6, 2.6); this.R = rnd(7, 11); this.shots = 0; this.dirT = rnd(2, 4);
  }
  onInterrupt() { this.sub = ''; this.atk = Math.max(this.atk, 1); }
  ai(dt) {
    const pl = this.target;
    if (!pl) { this.hold(); return; }
    this.dirT -= dt; if (this.dirT <= 0) { this.dir = -this.dir; this.dirT = rnd(2, 4); }
    this.a += this.dir * dt * 0.7;
    const tx = pl.pos.x + Math.cos(this.a) * this.R, tz = pl.pos.z + Math.sin(this.a) * this.R;
    const ty = Math.max(pl.pos.y, this.floorAt(tx, tz, pl.pos.y + 6)) + this.hover;
    this.steer(tx, ty, tz, this.speed, 14);
    this.facePlayer(dt, 7);
    this.setAnim('idle', 1);
    this.atk -= dt;
    if (this.sub === '' && this.atk <= 0 && this.dist < 28 && this.hasLOS && this.manager.requestToken(this, 'ranged')) { this.sub = 'wind'; this._t = 0; this.attacking = true; this.shots = 0; }
    if (this.sub === 'wind') {
      this._t += dt; this.windup = Math.max(0, 0.6 - this._t);
      if (this._t >= 0.6) { this.windup = 0; this.sub = 'fire'; this._t = 0; }
    } else if (this.sub === 'fire') {
      this._t -= dt;
      if (this._t <= 0) {
        const side = this.shots % 2 ? 1 : -1;
        this.forward(_f); _a.set(this.pos.x + _f.z * 0.4 * side + _f.x * 0.4, this.pos.y + 0.5, this.pos.z - _f.x * 0.4 * side + _f.z * 0.4);
        const T = Math.hypot(pl.center.x - _a.x, pl.center.z - _a.z) / 30;
        _b.set(pl.center.x + pl.vel.x * T * 0.5 - _a.x, pl.center.y - _a.y, pl.center.z + pl.vel.z * T * 0.5 - _a.z);
        this.game.combat.projectile({ pos: _a, vel: _b.normalize().multiplyScalar(30).clone(), damage: 5, kind: 'repulsor', color: RED, size: 0.2, radius: 0.32, life: 2.2, team: 'enemy', source: this });
        this.game.audio?.play?.('laser', { pos: this.pos, volume: 0.5 });
        this.shots++; this._t = 0.2;
        if (this.shots >= 3) { this.sub = ''; this.attacking = false; this.manager.releaseToken(this); this.atk = rnd(2.4, 3.6); }
      }
    }
  }
  onDeath() {
    this.flying = false; this.gravity = 28;
    this.game.fx.explosion(this.center, 1.9, EMBER);
    this.game.audio?.play?.('explosion', { pos: this.pos, volume: 0.5 });
  }
}

registerEnemy('ultron', Ultron);
registerEnemy('ultron_drone', UltronDrone);
