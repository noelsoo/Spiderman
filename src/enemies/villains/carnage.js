// CARNAGE (final boss, 2.4 m) + carnage_spawn (fast red symbiote crawlers, 50 hp).
// Pure ground brawler: fast multi-hit blade combos (short telegraphs), tendril whip sweeps, telegraphed spike eruptions, leap slams,
// crawler spawns. HEAVY hits (Hulk smash, Thor hammer/lightning, explosions, charged shield: >= 30 dmg or hammer/aoe/missile/rock kinds)
// fill poise 2.4x faster, deal +15% and stagger him longer (3.4 s vs 2.2 s). Phase 3 = enrage (faster, double whips, more spikes)
// plus "regen bursts": he stops, heals ~4% of max hp over 2 s - 150 damage during the burst interrupts it and staggers him.
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import { Enemy } from '../Enemy.js';
import '../../models/villains_b.js';
import { BossB, rnd, clamp, _o, _a, _b, _f, _d } from './b_base.js';

const RED = 0xff1830, CRIMSON = 0xb0081a;
const HEAVY = new Set(['hammer', 'rock', 'missile', 'aoe', 'shield', 'lightning', 'slam', 'shock', 'clap', 'charge']);

// ---------------------------------------------------------------------- ground spikes
class SpikePool {
  constructor(game, n = 14) {
    this.game = game; this.items = [];
    const geo = new THREE.ConeGeometry(0.34, 2.6, 6); geo.translate(0, 1.3, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0204, roughness: 0.25, metalness: 0.2, emissive: 0x7a0614, emissiveIntensity: 0.9 });
    this.geo = geo; this.mat = mat;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group(); g.visible = false;
      const c0 = new THREE.Mesh(geo, mat); const c1 = new THREE.Mesh(geo, mat), c2 = new THREE.Mesh(geo, mat);
      c1.scale.set(0.7, 0.6, 0.7); c1.position.set(0.7, 0, 0.3); c1.rotation.z = -0.35;
      c2.scale.set(0.7, 0.5, 0.7); c2.position.set(-0.55, 0, -0.5); c2.rotation.z = 0.4;
      for (const c of [c0, c1, c2]) c.castShadow = true;
      g.add(c0, c1, c2); game.scene.add(g);
      this.items.push({ g, t: -1 });
    }
  }
  fire(x, y, z) {
    const it = this.items.find((i) => i.t < 0); if (!it) return;
    it.t = 0; it.g.position.set(x, y, z); it.g.rotation.y = Math.random() * 6.28; it.g.visible = true; it.g.scale.set(1, 0.01, 1);
  }
  update(dt) {
    for (const it of this.items) {
      if (it.t < 0) continue;
      it.t += dt;
      const h = it.t < 0.12 ? it.t / 0.12 : it.t < 0.85 ? 1 : 1 - (it.t - 0.85) / 0.25;
      it.g.scale.set(1, Math.max(0.01, h), 1);
      if (it.t > 1.1) { it.t = -1; it.g.visible = false; }
    }
  }
  dispose() { for (const it of this.items) it.g.parent?.remove(it.g); this.geo.dispose(); this.mat.dispose(); this.items.length = 0; }
}

// ---------------------------------------------------------------------- Carnage
export class Carnage extends BossB {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'carnage', modelId: 'carnage', name: 'CARNAGE', hp: 4800, radius: 0.95, height: 2.4, speed: 8.8, mass: 18, gravity: 30, poise: 320, heavyPoise: 2.4, deathColor: RED });
    this.cd = { any: 2, combo: 0, whip: 6, spikes: 8, leap: 7, spawn: 14, regen: 12 };
    this.swings = 0; this.swingMax = 3; this.target3 = new THREE.Vector3(); this.leapsLeft = 0;
    this.spikes = new SpikePool(game);
    this.pending = [];       // scheduled spike eruptions {x,y,z,t}
    this.regenDmg = 0; this.staggerT = 2.2; this._t = 0; this.sweeps = 0; this._rt = 1;
    this.hits = 0;
  }

  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.12 : 1.3; }

  damageMult(a, o) {
    let m = 1;
    switch (this.state) {
      case 'intro': return 0.3;
      case 'phase': return 0.35;
      case 'regen': m = 1.2; break;
      case 'stagger': m = 1.25; break;
    }
    if (a >= 30 || HEAVY.has(o.kind ?? '')) m *= 1.15;
    return m;
  }
  canStagger() { return ['chase', 'combo', 'whip', 'spikes', 'leapWind', 'spawn', 'rec'].includes(this.state); }
  startStagger(heavy) {
    this.attacking = false; this.windup = 0; this.pending.length = 0; this.model.fx.whip = 0;
    this.staggerT = heavy ? 3.4 : 2.2;
    this.say(heavy ? 'SMASHED!' : 'STAGGERED!');
    this.game.audio?.play?.('heavyhit', { pos: this.pos }); this.game.cam.shake(heavy ? 0.5 : 0.3);
    this.game.fx.burst(this.center, RED, 22, 7, 0.6, 0.3);
    this._go('stagger');
  }
  onBossHit(dealt, o, heavy) {
    this.hits++;
    if (this.state === 'regen') {
      this.regenDmg += dealt;
      if (this.regenDmg >= 150) { this.say('REGEN BROKEN!', 0x60ffa0); this.poise = 0; this.startStagger(true); }
    }
  }

  update(dt) { super.update(dt); this.spikes.update(dt); this._eruptions(dt); }
  dispose() { this.spikes.dispose(); super.dispose(); }

  // ---------------------------------------------------------------- ai
  think(dt) {
    const pl = this.target;
    this.model.fx.rage = this.phase === 3 ? 1 : this.phase === 2 ? 0.4 : 0;
    if (this.state !== 'whip') this.model.fx.whip += ((this.state === 'combo' ? 0.15 : 0) - this.model.fx.whip) * Math.min(1, 6 * dt);
    if (!pl) { this.setAnim('idle', 1); return; }
    if (this.pendingPhase !== this.phase && (this.state === 'chase' || this.state === 'rec')) { this._startPhase(); return; }
    switch (this.state) {
      case 'intro': this.setAnim('cast', 0.8); this.facePlayer(dt, 4); if (this.stateT > 1.8) { this.cd.any = 0.8; this._go('chase'); } break;
      case 'chase': this._chase(dt); break;
      case 'combo': this._combo(dt); break;
      case 'whip': this._whip(dt); break;
      case 'spikes': this._spikes(dt); break;
      case 'leapWind': this._leapWind(dt); break;
      case 'air': this._air(dt); break;
      case 'spawn': this._spawn(dt); break;
      case 'regen': this._regen(dt); break;
      case 'phase': this._phase(dt); break;
      case 'rec':
        this.attacking = false; this.windup = 0; this.setAnim('idle', 1); this.facePlayer(dt, 3);
        if (this.stateT > this._rt) this._go('chase');
        break;
      case 'stagger':
        this.setAnim('stunned', 0.8); this.attacking = false; this.windup = 0;
        if (Math.random() < dt * 8) this.game.fx.burst(_o.set(this.pos.x + rnd(-0.6, 0.6), this.pos.y + rnd(0.5, 2), this.pos.z + rnd(-0.6, 0.6)), RED, 2, 2, 0.5, 0.2);
        if (this.stateT > this.staggerT) { this.cd.any = 0.5; this._go('chase'); }
        break;
      default: this._go('chase');
    }
  }
  _recover(t) { this._rt = t; this.attacking = false; this.windup = 0; this._go('rec'); }

  _chase(dt) {
    const pl = this.target, sp = this.sp, d = this.dist;
    this.attacking = false; this.windup = 0;
    this.facePlayer(dt, 8);
    if (d > 3.2) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * (d > 14 ? 1.35 : 1)); this.setAnim('run', 1.1 * sp); }
    else { this.setAnim('idle', 1); }
    if (this.cd.any > 0) return;
    const opts = [];
    if (d < 6) opts.push(['combo', 8]); else if (d < 14) opts.push(['combo', 3]);
    if (d < 10 && this.cd.whip <= 0) opts.push(['whip', 5]);
    if (d > 3 && d < 24 && this.cd.spikes <= 0) opts.push(['spikes', 5]);
    if (d > 6 && this.cd.leap <= 0) opts.push(['leap', 5]);
    if (this.cd.spawn <= 0 && this.liveMinions('carnage_spawn') < 4) opts.push(['spawn', this.phase === 1 ? 2 : 3]);
    if (this.phase >= 3 && this.cd.regen <= 0 && this.hp < this.maxHp * 0.3 && d > 5) opts.push(['regen', 9]);
    if (!opts.length) { this.cd.any = 0.4; return; }
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot, pick = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
    switch (pick) {
      case 'combo': this.swings = 0; this.swingMax = this.phase === 1 ? 3 : this.phase === 2 ? 4 : 5; this._go('combo'); this.sub = 'approach'; break;
      case 'whip': this.sweeps = this.phase === 3 ? 2 : 1; this._go('whip'); this.cd.whip = rnd(7, 9) / sp; break;
      case 'spikes': this._go('spikes'); this.cd.spikes = rnd(10, 13) / sp; break;
      case 'leap': this.leapsLeft = this.phase === 3 ? 1 + (Math.random() < 0.5 ? 1 : 0) : 0; this._go('leapWind'); this.cd.leap = 9 - this.phase; break;
      case 'spawn': this._go('spawn'); this.cd.spawn = 24; break;
      case 'regen': this._go('regen'); this.cd.regen = 22; this.regenDmg = 0; break;
    }
  }

  // ---- blade combo ------------------------------------------------------------------
  _combo(dt) {
    const pl = this.target, sp = this.sp;
    if (this.sub === 'approach') {
      this.facePlayer(dt, 10); this.setAnim('run', 1.4);
      if (this.dist > 3.4 && this.stateT < 1.8) this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * 1.7);
      else { this.sub = 'wind'; this.stateT = 0; }
      return;
    }
    const last = this.swings >= this.swingMax - 1;
    if (this.sub === 'follow') {
      this.windup = 0; this.attacking = false; this.setAnim(this.swings % 2 ? 'punch2' : 'punch1', sp * 0.7); this.facePlayer(dt, 8);
      if (this.stateT > 0.1 / sp) {
        if (this.swings >= this.swingMax) { this.cd.any = rnd(1.0, 1.8) / sp; this._recover((this.phase === 1 ? 1.5 : this.phase === 2 ? 1.25 : 1.0)); }
        else { this.sub = 'wind'; this.stateT = 0; }
      }
      return;
    }
    const total = (this.swings === 0 ? 0.45 : last ? 0.5 : 0.3) / sp;
    this.attacking = true; this.windup = Math.max(0, total - this.stateT);
    this.facePlayer(dt, this.windup > 0.12 ? 10 : 0);
    this.setAnim(last ? 'punch3' : this.swings % 3 === 2 ? 'kick' : (this.swings % 2 ? 'punch2' : 'punch1'), sp);
    if (this.stateT <= dt) this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), last ? 5 : 3.9, RED, total);
    if (this.stateT >= total) {
      this.windup = 0; this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.3, this.pos.z);
      this.vel.x += _f.x * 8; this.vel.z += _f.z * 8;
      this.game.combat.melee({ origin: _o, forward: _f, range: last ? 4.6 : 3.6, arc: last ? 170 : 130, damage: (last ? 18 : 10) + (this.phase - 1), knockback: last ? 14 : 7, up: last ? 5 : 1.5, team: 'enemy', source: this });
      this.game.audio?.play?.(last ? 'smash' : 'whoosh', { pos: this.pos });
      if (last) { this.game.cam.shake(0.35); this.game.fx.shockwave(_o.set(this.pos.x + _f.x * 2.2, this.pos.y + 0.1, this.pos.z + _f.z * 2.2), 4.5, RED); }
      this.swings++; this.sub = 'follow'; this.stateT = 0;
    }
  }

  // ---- tendril whip sweep --------------------------------------------------------------
  _whip(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx, mf = this.model.fx;
    const total = 0.9 / sp, SW = 0.42;
    this.attacking = true; this.wish.set(0, 0, 0);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('cast', 0.7);
      this.facePlayer(dt, this.windup > 0.25 ? 8 : 0);
      mf.whip += (0.4 - mf.whip) * Math.min(1, 8 * dt); mf.whipAng = -1;
      this.forward(_f);
      const a = Math.atan2(_f.x, _f.z);
      for (const off of [-1.4, 1.4]) { _a.set(this.pos.x, this.pos.y + 0.15, this.pos.z); _b.set(this.pos.x + Math.sin(a + off) * 9.2, this.pos.y + 0.15, this.pos.z + Math.cos(a + off) * 9.2); fx.beam(_a, _b, RED, 0.07, 0.05); }
      if (Math.floor(this.stateT * 4) !== Math.floor((this.stateT - dt) * 4)) fx.ring(_o.set(this.pos.x, this.pos.y + 0.12, this.pos.z), 9.2, RED, 0.3);
      if (this.stateT <= dt) this.game.audio?.play?.('symbiote', { pos: this.pos, pitch: 0.7 });
      if (this.stateT >= total) { this.sub = 'sweep'; this.stateT = 0; this.windup = 0.2; this._hitDone = false; this._dir = this.sweeps % 2 ? 1 : -1; }
    } else if (this.sub === 'sweep') {
      this.setAnim('smash', 1);
      const u = clamp(this.stateT / SW, 0, 1);
      mf.whip += (1 - mf.whip) * Math.min(1, 20 * dt);
      mf.whipAng = this._dir * (-1 + 2 * u);
      if (!this._hitDone && u >= 0.5) {
        this._hitDone = true; this.windup = 0;
        this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
        this.game.combat.melee({ origin: _o, forward: _f, range: 9, arc: 160, damage: this.phase === 3 ? 15 : 18, knockback: 13, up: 5, team: 'enemy', source: this });
        this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.6 }); this.game.cam.shake(0.3);
        fx.burst(_o.set(this.pos.x + _f.x * 5, this.pos.y + 0.6, this.pos.z + _f.z * 5), RED, 14, 6, 0.4, 0.3);
      }
      if (u >= 1) {
        this.sweeps--;
        if (this.sweeps > 0) { this.sub = 'sweep'; this.stateT = 0; this._hitDone = false; this._dir = -this._dir; this.windup = 0.2; }
        else { this.sub = 'end'; this.stateT = 0; }
      }
    } else {
      mf.whip += (0 - mf.whip) * Math.min(1, 6 * dt);
      this.setAnim('idle', 1);
      if (this.stateT > 0.4) { this.cd.any = rnd(1.2, 2) / sp; this._recover(0.8 / sp); }
    }
  }

  // ---- spike eruptions -------------------------------------------------------------------------
  _spikes(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    const total = 1.05 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    this.facePlayer(dt, 5);
    if (this.sub === '') {
      this.setAnim('cast', 0.9);
      this.windup = Math.max(0, total - this.stateT);
      if (this.stateT <= dt) {
        const n = this.phase === 1 ? 5 : this.phase === 2 ? 7 : 9;
        this.pts = [];
        this.pts.push({ x: pl.pos.x + pl.vel.x * 0.4, z: pl.pos.z + pl.vel.z * 0.4 });
        const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, dl = Math.hypot(dx, dz) || 1;
        for (let i = 1; i < n; i++) {
          if (i % 2) { const t = i / n; this.pts.push({ x: this.pos.x + dx * t * 0.9 + rnd(-1.5, 1.5), z: this.pos.z + dz * t * 0.9 + rnd(-1.5, 1.5) }); }
          else { const a = Math.random() * 6.28, r = rnd(2.5, 7); this.pts.push({ x: pl.pos.x + Math.cos(a) * r, z: pl.pos.z + Math.sin(a) * r }); }
        }
        for (const p of this.pts) p.y = this.game.physics.heightAt(p.x, p.z, pl.pos.y + 2.5);
        this.game.audio?.play?.('symbiote', { pos: this.pos });
      }
      if (this.pts && Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) for (const p of this.pts) { fx.ring(_o.set(p.x, p.y + 0.12, p.z), 2.4, RED, 0.3); }
      if (this.pts) for (const p of this.pts) if (Math.random() < 0.3) fx.burst(_o.set(p.x, p.y + 0.2, p.z), RED, 1, 1.5, 0.4, 0.2);
      if (this.stateT >= total) {
        this.sub = 'fire'; this.stateT = 0; this.windup = 0;
        const half = this.phase >= 2;
        this.pts.forEach((p, i) => this.pending.push({ x: p.x, y: p.y, z: p.z, t: half && i % 2 ? 0.45 : 0 }));
      }
    } else if (this.sub === 'fire') {
      this.setAnim('smash', 1);
      if (this.stateT > 0.75) { this.cd.any = rnd(1.2, 2) / sp; this._recover(1.0 / sp); }
    }
  }
  _eruptions(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]; p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      this.spikes.fire(p.x, p.y, p.z);
      _o.set(p.x, p.y + 0.4, p.z);
      this.game.combat.aoe({ center: _o.clone(), radius: 2.2, damage: 16, knockback: 6, up: 9, team: 'enemy', source: this, falloff: false });
      this.game.fx.burst(_o, RED, 12, 6, 0.5, 0.3); this.game.fx.dust(_o, 8, 2.2);
      this.game.audio?.play?.('hit', { pos: _o, pitch: 0.6 });
    }
  }

  // ---- leap slam ----------------------------------------------------------------------------------
  _leapWind(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.85 / sp;
    this.attacking = true; this.windup = Math.max(0, total - this.stateT) + 0.5;
    this.facePlayer(dt, 6); this.setAnim('charge', sp); this.wish.set(0, 0, 0);
    if (this.stateT < total - 0.25) { this.target3.copy(pl.pos); this.target3.x += pl.vel.x * 0.45; this.target3.z += pl.vel.z * 0.45; }
    if (Math.floor(this.stateT * 5) !== Math.floor((this.stateT - dt) * 5)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), 6.5, RED, 0.3);
    if (this.stateT <= dt) this.game.audio?.play?.('boss_roar', { pitch: 1.3, volume: 0.5 });
    if (this.stateT >= total) this._beginLeap();
  }
  _beginLeap() {
    const to = this.target3;
    const dx = to.x - this.pos.x, dz = to.z - this.pos.z, dy = to.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    const T = clamp(dist / 20, 0.7, 1.3);
    this.vel.x = dx / T; this.vel.z = dz / T; this.vel.y = (dy + 0.5 * this.gravity * T * T) / T;
    this.onGround = false; this._go('air'); this.ballistic = true; this.attacking = true;
    this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.6 });
    this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 0.3, this.pos.z), RED, 14, 6, 0.5, 0.35);
  }
  _air(dt) {
    this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', 1);
    this.faceYawTo(Math.atan2(this.vel.x, this.vel.z), dt, 8); this.windup = 0;
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), 6.5, RED, 0.25);
    this.game.fx.trailPuff(this.pos.x, this.pos.y + 1.2, this.pos.z, RED, 0.8, 0.25, 0.03);
    if ((this.stateT > 0.25 && this.onGround) || this.stateT > 3.2) this._land();
  }
  _land() {
    const g = this.game;
    this.ballistic = false; this.attacking = false;
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    g.combat.aoe({ center: _o.clone(), radius: 6.5, damage: 22, knockback: 15, up: 8, team: 'enemy', source: this });
    g.fx.shockwave(_o, 9, RED); g.fx.explosion(_o.clone().setY(this.pos.y + 0.5), 2.6, RED);
    g.cam.shake(0.8); g.input?.rumble?.(0.8, 0.5, 200); g.audio?.play?.('smash', { pos: this.pos });
    if (this.leapsLeft > 0 && this.target) { this.leapsLeft--; this.target3.copy(this.target.pos); this._go('leapWind'); this.stateT = 0.6 / this.sp; return; }
    this.cd.any = rnd(1.0, 1.8); this._recover(1.1);
  }

  // ---- spawn crawlers -----------------------------------------------------------------------------
  _spawn(dt) {
    this.attacking = true; this.windup = 0; this.wish.set(0, 0, 0);
    this.setAnim('cast', 1); this.facePlayer(dt, 3);
    if (this.stateT <= dt) { this.game.audio?.play?.('boss_roar', { pitch: 1.1 }); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 7, RED); this.game.cam.shake(0.4); }
    if (this.stateT > 1.1 && this.sub !== 'done') {
      this.sub = 'done';
      const n = this.phase === 1 ? 2 : this.phase === 2 ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + Math.random();
        const p = _o.set(this.pos.x + Math.cos(a) * 3.4, this.pos.y, this.pos.z + Math.sin(a) * 3.4);
        this.spawnMinion('carnage_spawn', p);
        this.game.fx.burst(_o.setY(this.pos.y + 0.8), RED, 12, 5, 0.5, 0.3);
      }
    }
    if (this.stateT > 1.8) { this.cd.any = rnd(1.2, 2); this._recover(0.5); }
  }

  // ---- regeneration burst (phase 3) --------------------------------------------------------------------
  _regen(dt) {
    this.attacking = true; this.windup = 0; this.wish.set(0, 0, 0);
    this.setAnim('cast', 0.7); this.facePlayer(dt, 3);
    this.model.fx.rage = 1.4;
    if (this.stateT <= dt) { this.game.audio?.play?.('symbiote', { pos: this.pos, pitch: 0.6 }); this.say('REGENERATING...', 0xff6080); }
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.12, this.pos.z), 4.2, RED, 0.35);
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * 6.28, r = rnd(2, 4);
      _a.set(this.pos.x + Math.cos(a) * r, this.pos.y + rnd(0.2, 2.2), this.pos.z + Math.sin(a) * r);
      this.game.fx.burst(_a, RED, 1, -2, 0.5, 0.2);
    }
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.04 / 2.0 * dt);
    if (this.stateT > 2.0) { this.cd.any = rnd(1, 1.8); this._recover(0.6); }
  }

  // ---- phase change -------------------------------------------------------------------------------------
  _startPhase() {
    this.phase = this.pendingPhase; this._go('phase'); this.attacking = true; this.poise = 0;
    this.game.audio?.play?.('boss_roar'); this.game.cam.shake(0.9);
    this.game.hud?.toast?.(this.phase === 2 ? 'CARNAGE: "LET THERE BE CARNAGE!"' : 'CARNAGE IS ENRAGED!');
    this.cd.spawn = this.phase === 2 ? 0.5 : this.cd.spawn;
  }
  _phase(dt) {
    this.wish.set(0, 0, 0); this.setAnim('cast', 1); this.facePlayer(dt, 3);
    if (this.sub === '' && this.stateT > 0.9) {
      this.sub = 'wave'; _o.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
      this.game.fx.shockwave(_o, 14, RED);
      this.game.combat.aoe({ center: _o, radius: 11, damage: 8, knockback: 14, up: 4, team: 'enemy', source: this });
    }
    if (this.stateT > 2.0) { this.attacking = false; this.cd.any = 0.8; this._go('chase'); }
  }

  onDeathExtra() { this.pending.length = 0; this.model.fx.whip = 0; }
}

// ---------------------------------------------------------------------- crawler
export class CarnageSpawn extends Enemy {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'carnage_spawn', modelId: 'carnage_spawn', name: 'Carnage Spawn', hp: 50, radius: 0.42, height: 1.05, speed: 9.5, mass: 0.8 });
    this.atk = rnd(0.5, 1.6); this.circleDir = Math.random() < 0.5 ? -1 : 1; this.circleT = rnd(1, 2.5); this.sub = ''; this._t = 0; this.hit = false;
  }
  onInterrupt() { this.sub = ''; this.atk = Math.max(this.atk, 0.7); }
  ai(dt) {
    const pl = this.target;
    if (!pl) { this.setAnim('idle', 1); return; }
    const d = this.dist; this.atk -= dt;
    this.facePlayer(dt, this.sub === 'lunge' ? 0 : 10);
    if (this.sub === '') {
      if (this.atk <= 0 && d < 10 && this.manager.requestToken(this, 'melee')) { this.sub = 'wind'; this._t = 0; this.attacking = true; }
      else if (d > 4) { this.moveToward(pl.pos.x, pl.pos.z, this.speed); this.setAnim('run', 1.5); }
      else {
        this.circleT -= dt; if (this.circleT <= 0) { this.circleDir = -this.circleDir; this.circleT = rnd(1, 2.5); }
        this.strafe(this.circleDir, this.speed * 0.7); this.setAnim('run', 1.2);
      }
    } else if (this.sub === 'wind') {
      this._t += dt; this.windup = Math.max(0, 0.45 - this._t); this.setAnim('charge', 1);
      if (this._t <= dt) this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 2.4, RED, 0.45);
      if (this._t >= 0.45) { this.windup = 0; this.sub = 'lunge'; this._t = 0; this.hit = false; this.game.audio?.play?.('whoosh', { pos: this.pos }); }
    } else if (this.sub === 'lunge') {
      this._t += dt; this.forward(_f);
      this.vel.x = _f.x * 15; this.vel.z = _f.z * 15; this.setAnim('punch2', 1.4);
      if (!this.hit && this._t > 0.06) {
        _o.set(this.pos.x, this.pos.y + 0.7, this.pos.z);
        if (this.game.combat.melee({ origin: _o, forward: _f, range: 1.8, arc: 120, damage: 7, knockback: 6, up: 2, team: 'enemy', source: this }).length) this.hit = true;
      }
      if (this._t > 0.4 || this.hit) { this.vel.x *= 0.2; this.vel.z *= 0.2; this.sub = 'rec'; this._t = 0; this.attacking = false; this.manager.releaseToken(this); }
    } else {
      this._t += dt; this.setAnim('idle', 1);
      if (this._t > 0.8) { this.sub = ''; this.atk = rnd(1.6, 3); }
    }
  }
  onDeath() { this.game.fx.burst(this.center, RED, 18, 5, 0.6, 0.3); }
}

registerEnemy('carnage', Carnage);
registerEnemy('carnage_spawn', CarnageSpawn);
