// LOKI (boss) + loki_illusion (1 hp decoy).
// Ground fighter: sceptre blasts (fan volleys), sustained sceptre beam sweep, melee combos, green-smoke teleports (>= 6 s apart),
// illusion copies (one hit shatters them; only the real Loki takes damage; the real one drops tiny gold glints at his feet),
// summons symbiote goons (phase 2+), frost/energy shockwave (phase 3, jumpable).
// FAIRNESS: stays on the ground, teleports end in a short blink-strike, poise breaks give 2.4-3.4 s stagger (copies shatter).
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import { Enemy } from '../Enemy.js';
import '../../models/villains_b.js';
import { BossB, rnd, clamp, _o, _a, _b, _f, _d, fireBolt } from './b_base.js';

const GREEN = 0x40ff90, GOLD = 0xffd860, FROST = 0x8ff0ff;

export class Loki extends BossB {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'loki', modelId: 'loki', name: 'LOKI', hp: 3200, radius: 0.55, height: 1.95, speed: 6.6, mass: 8, gravity: 28, poise: 230, deathColor: GREEN });
    this.cd = { any: 2.2, blast: 1, beam: 6, tele: 5, illus: 8, goons: 14, shock: 8, glint: 1 };
    this.dirSign = Math.random() < 0.5 ? -1 : 1; this.dirT = 2;
    this.dest = new THREE.Vector3(); this.follow = ''; this.swings = 0; this.swingMax = 2; this._t = 0;
    this.ghostSlots = [];
    this.waveR = 0; this.waveHit = false;
    this.beamA0 = 0; this.beamDir = 1; this.beamPitch = 0;
  }

  damageMult(a, o) {
    if (this.state === 'phase') return 0.35;
    if (this.state === 'stagger') return 1.25;
    return 1;
  }
  canStagger() { return ['chase', 'blast', 'beam', 'melee', 'shock'].includes(this.state); }
  startStagger(heavy) {
    this._go('stagger'); this.staggerT = heavy ? 3.4 : 2.4;
    this.shatterGhosts();
    this.say('STAGGERED!');
    this.game.audio?.play?.('heavyhit', { pos: this.pos }); this.game.cam.shake(0.3);
    this.game.fx.burst(this.center, GREEN, 18, 6, 0.5, 0.3);
  }
  get ghosts() { return this.minions.filter((m) => m.kind === 'loki_illusion' && m.alive); }
  shatterGhosts() { for (const g of this.minions) if (g.kind === 'loki_illusion' && g.alive) g.takeDamage(999, {}); }

  // ---------------------------------------------------------------- helpers
  muz(out) { return this.muzzle(out, 'muzzle'); }
  vanishTo(dest, follow) {
    this.dest.copy(dest); this.follow = follow || '';
    this._go('vanish');
  }
  pickBlinkPoint(out, r0 = 4.5, r1 = 7) {
    const pl = this.target;
    this.manager._ringPoint(pl.pos, r0, r1, out);
    return out;
  }

  // ---------------------------------------------------------------- ai
  introStart() { }
  think(dt) {
    const pl = this.target;
    this.model.fx.glint = Math.max(0, this.model.fx.glint - dt * 2);
    if (!pl) { this.setAnim('idle', 1); return; }
    // real-Loki tell: tiny gold glints at his feet
    if (this.state !== 'vanish' && this.cd.glint <= 0) {
      this.cd.glint = 1.3; this.model.fx.glint = 1;
      this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 0.12, this.pos.z), GOLD, 3, 1.4, 0.7, 0.1);
    }
    if (this.phase === 3 && Math.random() < dt * 4) this.game.fx.smoke(_o.set(this.pos.x + rnd(-0.4, 0.4), this.pos.y + rnd(0.2, 1.8), this.pos.z + rnd(-0.4, 0.4)), 0.7, 0.8, null, 0.02);
    if (this.pendingPhase !== this.phase && this.state === 'chase') { this._startPhase(); return; }
    switch (this.state) {
      case 'intro': this.setAnim('cast', 0.8); this.facePlayer(dt, 4); if (this.stateT > 1.6) { this.cd.any = 0.8; this._go('chase'); } break;
      case 'chase': this._chase(dt); break;
      case 'blast': this._blast(dt); break;
      case 'beam': this._beam(dt); break;
      case 'melee': this._melee(dt); break;
      case 'vanish': this._vanish(dt); break;
      case 'illus': this._illus(dt); break;
      case 'goons': this._goons(dt); break;
      case 'shock': this._shock(dt); break;
      case 'phase': this._phase(dt); break;
      case 'rec':
        this.attacking = false; this.windup = 0; this.setAnim('idle', 1); this.facePlayer(dt, 3);
        if (this.stateT > this._rt) this._go('chase');
        else if (this.pendingPhase !== this.phase && this.stateT > this._rt * 0.5) this._startPhase();
        break;
      case 'stagger':
        this.setAnim('stunned', 0.9); this.attacking = false; this.windup = 0;
        if (this.stateT > this.staggerT) { this.cd.any = 0.6; this._go('chase'); }
        break;
      default: this._go('chase');
    }
  }

  _recover(t) { this._rt = t; this.attacking = false; this.windup = 0; this._go('rec'); }

  _chase(dt) {
    const pl = this.target, sp = this.sp, d = this.dist;
    this.attacking = false; this.windup = 0;
    this.facePlayer(dt, 7);
    this.dirT -= dt; if (this.dirT <= 0) { this.dirSign = -this.dirSign; this.dirT = rnd(1.5, 3); }
    if (d > 11) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * 1.25 * sp); this.setAnim('run', 1.1); }
    else if (d > 6) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * 0.75 * sp); this.strafe(this.dirSign, this.speed * 0.35); this.wish.add(_o.set(this.dx / (d || 1), 0, this.dz / (d || 1)).multiplyScalar(this.speed * 0.6)); this.setAnim('run', 0.9); }
    else if (d < 2.6) { this.strafe(this.dirSign, this.speed * 0.6); this.setAnim('run', 0.8); }
    else { this.strafe(this.dirSign, this.speed * 0.45); this.setAnim('run', 0.7); }
    if (this.cd.any > 0) return;

    const opts = [];
    if (d < 9) opts.push(['melee', d < 5 ? 8 : 4]);
    if (d > 2 && this.hasLOS && this.cd.blast <= 0) opts.push(['blast', 4]);
    if (d > 3 && this.hasLOS && this.cd.beam <= 0) opts.push(['beam', 2 + this.phase]);
    if (this.cd.tele <= 0) opts.push(['tele', 3]);
    if (this.cd.illus <= 0 && this.ghosts.length === 0) opts.push(['illus', 4]);
    if (this.phase >= 2 && this.cd.goons <= 0 && this.liveMinions() < 4) opts.push(['goons', 3]);
    if (this.phase >= 3 && this.cd.shock <= 0 && d < 14) opts.push(['shock', 5]);
    if (!opts.length) { this.cd.any = 0.4; return; }
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot, pick = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
    switch (pick) {
      case 'melee': this.swings = 0; this.swingMax = this.phase === 1 ? 2 : 3; this._go('melee'); this.sub = 'approach'; break;
      case 'blast': this._go('blast'); this.cd.blast = rnd(2.5, 4) / sp; break;
      case 'beam': this._go('beam'); this.cd.beam = rnd(8, 11) / sp; break;
      case 'tele': this.pickBlinkPoint(_d, 4.5, 6.5); this.cd.tele = 6.5; this.vanishTo(_d, 'strike'); break;
      case 'illus': this._go('illus'); this.cd.illus = this.phase === 1 ? 18 : 14; break;
      case 'goons': this._go('goons'); this.cd.goons = 24; break;
      case 'shock': this._go('shock'); this.cd.shock = 13; break;
    }
  }

  // ---- sceptre blast fan -----------------------------------------------
  _blast(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    const total = 0.75 / sp;
    this.attacking = true;
    this.facePlayer(dt, this.stateT < total - 0.2 ? 9 : 0);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('cast', sp);
      this.muz(_a);
      fx.glow(_a, GREEN, 0.9 + this.stateT * 1.4, 0.1);
      fx.beam(_a, pl.center, GREEN, 0.03, 0.05);
      if (this.stateT <= dt) this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 1.4 });
      if (this.stateT >= total) {
        this.sub = 'fired'; this.windup = 0;
        const n = this.phase === 1 ? 1 : this.phase === 2 ? 3 : 5;
        this.muz(_a);
        _b.set(pl.center.x + pl.vel.x * 0.25 - _a.x, pl.center.y - _a.y, pl.center.z + pl.vel.z * 0.25 - _a.z);
        const yaw0 = Math.atan2(_b.x, _b.z), hy = Math.hypot(_b.x, _b.z), vy = _b.y / Math.max(hy, 1);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.17;
          _f.set(Math.sin(yaw0 + off), vy, Math.cos(yaw0 + off));
          fireBolt(this.game, this, _a, _f, { speed: 30, damage: 11, color: GREEN, size: 0.3, radius: 0.4, life: 2.5 });
        }
        fx.flash(_a, GREEN, 3, 0.15);
        this.game.audio?.play?.('laser', { pos: this.pos });
        this.stateT = 0;
      }
    } else {
      this.windup = 0; this.setAnim('cast', 0.6);
      if (this.stateT > 0.5) { this.cd.any = rnd(1.2, 2.2) / sp; this._recover(0.5 / sp); }
    }
  }

  // ---- sustained beam sweep ---------------------------------------------
  _beam(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    const total = 1.05 / sp, SWEEP = 1.0, R = 26;
    this.attacking = true;
    if (this.sub === '') {
      this.setAnim('cast', sp);
      this.windup = Math.max(0, total - this.stateT);
      if (this.stateT < total - 0.4) { this.beamA0 = Math.atan2(this.dx, this.dz); this.beamDir = Math.random() < 0.5 ? -1 : 1; this.muz(_a); this.beamPitch = clamp((pl.center.y - _a.y) / Math.max(this.dist, 5), -0.3, 0.25); }
      this.faceYawTo(this.beamA0 - this.beamDir * 0.55, dt, 10);
      this.muz(_a);
      // telegraph: the start line (bright) and the end of the sweep (faint)
      for (const [off, w, al] of [[-0.55, 0.05, 1], [0.55, 0.02, 0.5]]) {
        const a = this.beamA0 + this.beamDir * off;
        _b.set(_a.x + Math.sin(a) * 14, _a.y + this.beamPitch * 14, _a.z + Math.cos(a) * 14);
        fx.beam(_a, _b, al > 0.7 ? GREEN : 0x2a8a50, w, 0.05);
      }
      fx.glow(_a, GREEN, 0.8 + this.stateT, 0.1);
      if (this.stateT <= dt) this.game.audio?.play?.('boss_roar', { pitch: 1.5, volume: 0.45 });
      if (this.stateT >= total) { this.sub = 'sweep'; this.stateT = 0; this.windup = 0; this._tick = 0; }
    } else if (this.sub === 'sweep') {
      this.windup = 0; this.setAnim('cast', 1);
      const u = clamp(this.stateT / SWEEP, 0, 1);
      const a = this.beamA0 + this.beamDir * (-0.55 + 1.1 * u);
      this.faceYawTo(a, dt, 14);
      this.muz(_a);
      _f.set(Math.sin(a), this.beamPitch, Math.cos(a)).normalize();
      const hit = this.game.physics.raycast(_a, _f, R);
      const len = hit ? hit.distance : R;
      _b.copy(_a).addScaledVector(_f, len);
      fx.beam(_a, _b, GREEN, 0.34, 0.08);
      if (Math.random() < 0.5) fx.lightning(_a, _b, 0xb0ffd0, 0.08, 1);
      this._tick -= dt;
      if (this._tick <= 0) { this._tick = 0.1; this.game.combat.hitscan({ origin: _a, dir: _f, range: len, damage: 7, team: 'enemy', width: 1.0, source: this }); }
      this.game.cam.shake(0.05);
      if (this.stateT >= SWEEP) { this.sub = 'end'; this.stateT = 0; }
    } else {
      this.setAnim('cast', 0.5);
      if (this.stateT > 0.5) { this.cd.any = rnd(1.4, 2.4) / sp; this._recover(0.7 / sp); }
    }
  }

  // ---- sceptre melee ---------------------------------------------------------
  _melee(dt) {
    const pl = this.target, sp = this.sp;
    if (this.sub === 'approach') {
      this.facePlayer(dt, 9); this.setAnim('run', 1.3);
      if (this.dist > 3.0 && this.stateT < 1.4) this.moveToward(pl.pos.x, pl.pos.z, this.speed * 1.6 * sp);
      else { this.sub = 'wind'; this.stateT = 0; }
      return;
    }
    if (this.sub === 'follow') {
      this.windup = 0; this.attacking = false; this.setAnim('punch2', 0.6); this.facePlayer(dt, 6);
      if (this.stateT > 0.2 / sp) {
        if (this.swings >= this.swingMax) { this.cd.any = rnd(1.3, 2.3) / sp; this._recover(0.9 / sp); }
        else { this.sub = 'wind'; this.stateT = 0; }
      }
      return;
    }
    const last = this.swings >= this.swingMax - 1;
    const total = (this.swings === 0 ? 0.6 : last ? 0.55 : 0.42) / sp;
    this.attacking = true;
    this.windup = Math.max(0, total - this.stateT);
    this.facePlayer(dt, this.windup > 0.15 ? 9 : 0);
    this.setAnim(last ? 'punch3' : (this.swings % 2 ? 'punch2' : 'punch1'), sp);
    if (this.stateT <= dt) this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), last ? 4.4 : 3.6, GREEN, total);
    if (this.stateT >= total) {
      this.windup = 0; this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
      this.vel.x += _f.x * 6; this.vel.z += _f.z * 6;
      this.game.combat.melee({ origin: _o, forward: _f, range: last ? 3.8 : 3.3, arc: last ? 150 : 120, damage: last ? 17 : 12, knockback: last ? 13 : 8, up: last ? 5 : 2, team: 'enemy', source: this });
      this.game.fx.lightning(_a.copy(_o), _b.copy(_o).addScaledVector(_f, 3), GREEN, 0.12, 1);
      this.game.audio?.play?.('whoosh', { pos: this.pos });
      this.swings++; this.sub = 'follow'; this.stateT = 0;
    }
  }

  // ---- teleport -------------------------------------------------------------------
  _vanish(dt) {
    const fx = this.game.fx;
    this.attacking = false; this.windup = 0;
    if (this.sub === '') {
      this.sub = 'hidden';
      this.untargetable = true; this.root.visible = false;
      fx.burst(_o.set(this.pos.x, this.pos.y + 1, this.pos.z), GREEN, 26, 5, 0.7, 0.4);
      fx.smoke(_o, 1.6, 1.2, null, 0.02); fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 3, GREEN, 0.5);
      this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 1.6 });
      this.wish.set(0, 0, 0); this.vel.x = this.vel.z = 0;
    }
    this.setAnim('idle', 1);
    // pre-show the arrival spot
    if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) fx.burst(_o.set(this.dest.x, this.dest.y + 0.3, this.dest.z), GREEN, 2, 1.5, 0.5, 0.2);
    if (this.stateT > (this.follow === 'illus' ? 0.9 : 0.6)) {
      this.pos.copy(this.dest); this.vel.set(0, 0, 0);
      this.untargetable = false; this.root.visible = true;
      fx.burst(_o.set(this.pos.x, this.pos.y + 1, this.pos.z), GREEN, 26, 5, 0.7, 0.4);
      fx.smoke(_o, 1.6, 1.2, null, 0.02);
      fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 3.4, GREEN, 0.5);
      this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 1.2 });
      this.invuln = 0;
      if (this.follow === 'strike') { this.swings = 0; this.swingMax = this.phase === 1 ? 2 : 3; this._go('melee'); this.sub = 'wind'; this.stateT = 0.05; }
      else { this.cd.any = 0.7; this._go('chase'); }
    }
  }

  // ---- illusions ------------------------------------------------------------------
  _illus(dt) {
    const pl = this.target;
    this.attacking = true; this.windup = 0;
    this.setAnim('cast', 1); this.facePlayer(dt, 4); this.wish.set(0, 0, 0);
    if (this.stateT <= dt) { this.game.audio?.play?.('boss_roar', { pitch: 1.5, volume: 0.5 }); this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 5, GREEN, 0.9); }
    if (Math.random() < 0.6) this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 1.5, this.pos.z), GREEN, 2, 3, 0.5, 0.25);
    if (this.stateT > 1.1) this._spawnIllusions(this.phase === 1 ? 2 : this.phase === 2 ? 3 : 4);
  }
  _spawnIllusions(n) {
    const pl = this.target, phys = this.game.physics;
    const slots = [];
    const a0 = Math.random() * 6.28;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / (n + 1)) * 6.28;
      let x = pl.pos.x + Math.cos(a) * 8, z = pl.pos.z + Math.sin(a) * 8, y = pl.pos.y;
      if (phys.inside(_o.set(x, y + 1, z)) || Math.abs(phys.heightAt(x, z, y + 2.5) - y) > 2) { this.manager._ringPoint(pl.pos, 5, 9, _b); x = _b.x; y = _b.y; z = _b.z; }
      slots.push(new THREE.Vector3(x, y, z));
    }
    const realI = Math.floor(Math.random() * slots.length);
    let gi = 0;
    for (let i = 0; i < slots.length; i++) {
      if (i === realI) continue;
      const gh = this.spawnMinion('loki_illusion', slots[i], { setBoss: false });
      gi++;
    }
    this.cd.tele = Math.max(this.cd.tele, 6.5);
    this.vanishTo(slots[realI], 'illus');
  }

  // ---- goons ------------------------------------------------------------------------
  _goons(dt) {
    this.attacking = true; this.windup = 0; this.setAnim('cast', 1); this.facePlayer(dt, 3); this.wish.set(0, 0, 0);
    if (this.stateT <= dt) { this.game.audio?.play?.('symbiote', { pos: this.pos }); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 7, 0x7a2bd0); this.game.cam.shake(0.3); }
    if (this.stateT > 1.2 && this.sub !== 'done') {
      this.sub = 'done';
      const n = this.phase === 3 ? 3 : 2;
      for (let i = 0; i < n; i++) { const e = this.manager.spawnMinion(this.pos, 6 + i * 0.6, (i / n) * 6.28 + Math.random()); if (e) { e.owner = this; this.minions.push(e); } }
    }
    if (this.stateT > 1.9) { this.cd.any = rnd(1.2, 2); this._recover(0.5); }
  }

  // ---- frost shockwave (phase 3) -------------------------------------------------------
  _shock(dt) {
    const fx = this.game.fx, pl = this.target, sp = this.sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    const total = 1.3 / sp;
    this.facePlayer(dt, 3);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT) + 0.5;
      this.setAnim('cast', 0.8);
      if (Math.floor(this.stateT * 4) !== Math.floor((this.stateT - dt) * 4)) fx.ring(_o.set(this.pos.x, this.pos.y + 0.12, this.pos.z), 14, FROST, 0.45);
      if (Math.random() < 0.7) fx.burst(_o.set(this.pos.x + rnd(-1, 1), this.pos.y + 0.2, this.pos.z + rnd(-1, 1)), FROST, 2, 3, 0.6, 0.2);
      if (this.stateT <= dt) this.game.audio?.play?.('boss_roar', { pitch: 0.8, volume: 0.6 });
      if (this.stateT >= total) { this.sub = 'wave'; this.stateT = 0; this.waveR = 1; this.waveHit = false; this.windup = 0.3; this.game.cam.shake(0.7); this.game.audio?.play?.('thunder'); }
    } else if (this.sub === 'wave') {
      this.setAnim('smash', 1);
      this.waveR += 16 * dt;
      _o.set(this.pos.x, this.pos.y + 0.12, this.pos.z);
      fx.ring(_o, this.waveR, FROST, 0.2);
      if (Math.floor(this.waveR * 2) !== Math.floor((this.waveR - 16 * dt) * 2)) fx.dust(_o, 8, this.waveR * 0.9, 0.3);
      if (!this.waveHit && pl.pos.y < this.pos.y + 1.3) {
        const dpl = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
        if (Math.abs(dpl - this.waveR) < 1.5) {
          this.waveHit = true;
          if (this.game.combat.damagePlayer(20, this.pos, this)) {
            const h = dpl || 1; pl.vel.x += (pl.pos.x - this.pos.x) / h * 14; pl.vel.z += (pl.pos.z - this.pos.z) / h * 14; pl.vel.y = Math.max(pl.vel.y, 5);
            fx.burst(pl.center, FROST, 20, 6, 0.6, 0.3);
          }
        }
      }
      if (this.waveR > 15) { this.windup = 0; this.cd.any = rnd(1.5, 2.5); this._recover(0.9); }
    }
  }

  // ---- phase change -------------------------------------------------------------------------
  _startPhase() {
    this.phase = this.pendingPhase;
    this._go('phase'); this.attacking = true; this.poise = 0;
    this.game.audio?.play?.('boss_roar'); this.game.cam.shake(0.8);
    this.game.hud?.toast?.(this.phase === 2 ? 'LOKI: "You are beneath me!"' : 'LOKI IS CONSUMED BY THE SYMBIOTE!');
    if (this.phase === 3) this.game.fx.burst(this.center, 0x7a2bd0, 30, 7, 0.8, 0.4);
  }
  _phase(dt) {
    this.setAnim('cast', 1); this.wish.set(0, 0, 0); this.facePlayer(dt, 3);
    if (this.sub === '' && this.stateT > 0.9) {
      this.sub = 'wave';
      _o.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
      this.game.fx.shockwave(_o, 13, this.phase === 3 ? 0x7a2bd0 : GREEN);
      this.game.combat.aoe({ center: _o, radius: 10, damage: 8, knockback: 14, up: 4, team: 'enemy', source: this });
    }
    if (this.stateT > 1.8) {
      this.attacking = false; this.cd.any = 0.8;
      this.shatterGhosts();
      this._spawnIllusions(this.phase === 2 ? 3 : 4);
    }
  }

  onDeathExtra() { this.shatterGhosts(); }
}

// ---------------------------------------------------------------------- illusion
export class LokiIllusion extends Enemy {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'loki_illusion', modelId: 'loki_illusion', name: 'Loki', hp: 1, radius: 0.5, height: 1.95, speed: 5.4, mass: 4 });
    this.life = 14; this.atk = rnd(1.2, 2.6); this.sub = ''; this._t = 0; this.dirSign = Math.random() < 0.5 ? -1 : 1;
    this.shimmerT = rnd(0, 1);
  }
  takeDamage(amount, o = {}) {
    if (!this.alive || this.invuln > 0 || amount <= 0) return 0;
    this.shatter();
    return amount;
  }
  launch() {}
  _stun() {}
  web() { this.shatter(); }
  die(o) { this.shatter(); }
  shatter() {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.windup = 0; this.attacking = false;
    this.manager.releaseToken(this);
    const fx = this.game.fx;
    fx.burst(this.center, GREEN, 34, 7, 0.8, 0.28);
    fx.burst(this.center, 0xd8ffe8, 14, 4, 0.5, 0.18);
    fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 2.2, GREEN, 0.4);
    this.game.audio?.play?.('hit', { pos: this.pos, pitch: 1.8 });
    this.root.visible = false; this.removed = true;
  }
  ai(dt) {
    const pl = this.target;
    this.life -= dt; if (this.life <= 0) { this.shatter(); return; }
    if (!pl) { this.setAnim('idle', 1); return; }
    this.shimmerT -= dt;
    if (this.shimmerT <= 0) { this.shimmerT = rnd(0.4, 0.9); this.game.fx.burst(_o.set(this.pos.x, this.pos.y + rnd(0.2, 1.8), this.pos.z), GREEN, 1, 1.2, 0.5, 0.12); }
    const d = this.dist;
    this.atk -= dt;
    this.facePlayer(dt, 7);
    if (this.sub === '') {
      if (d > 5) { this.moveToward(pl.pos.x, pl.pos.z, this.speed); this.setAnim('run', 1); }
      else { this.strafe(this.dirSign, this.speed * 0.5); this.setAnim('run', 0.7); }
      if (this.atk <= 0) {
        if (d < 4.5 && this.manager.requestToken(this, 'melee')) { this.sub = 'wind'; this._t = 0; this.attacking = true; }
        else if (d >= 4.5 && d < 18 && this.hasLOS && this.manager.requestToken(this, 'ranged')) { this.sub = 'cast'; this._t = 0; this.attacking = true; }
      }
    } else if (this.sub === 'wind') {
      this._t += dt; this.windup = Math.max(0, 0.7 - this._t); this.setAnim('punch1', 1);
      if (this._t >= 0.7) {
        this.windup = 0; this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
        this.game.combat.melee({ origin: _o, forward: _f, range: 3, arc: 110, damage: 6, knockback: 5, up: 1, team: 'enemy', source: this });
        this.manager.releaseToken(this); this.sub = ''; this.attacking = false; this.atk = rnd(2.5, 4);
      }
    } else if (this.sub === 'cast') {
      this._t += dt; this.windup = Math.max(0, 0.95 - this._t); this.setAnim('cast', 1);
      if (this._t >= 0.95) {
        this.windup = 0;
        this.model.muzzle?.updateWorldMatrix(true, false); this.model.muzzle?.getWorldPosition(_a);
        _b.set(pl.center.x - _a.x, pl.center.y - _a.y, pl.center.z - _a.z);
        fireBolt(this.game, this, _a, _b, { speed: 21, damage: 5, color: GREEN, size: 0.24, radius: 0.35, life: 2.5 });
        this.manager.releaseToken(this); this.sub = ''; this.attacking = false; this.atk = rnd(3, 4.5);
      }
    }
  }
  onDeath() {}
}

registerEnemy('loki', Loki);
registerEnemy('loki_illusion', LokiIllusion);
