// DOCTOR OCTOPUS boss (3600 hp) + OCTOBOT drone minion.
//   attacks : tentacle swipes, telegraphed line SLAMS, grab-and-throw (mash attack/dodge to escape, auto-release 1.5 s),
//             debris throws (car-sized chunks, kind 'rock'), rooftop climb (returns to the ground after 10 s with a dive),
//             calls octobots
//   phase 2 : tentacles are weak points - the glowing one soaks damage; destroying it staggers him
//   phase 3 : symbiote-fused tentacles (regrow, goo on slams)
//   fairness: every 3 attacks 3.4 s exposed, poise stagger, dive-landing exposes him 3.4 s, rooftop stay <= 10 s
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import { Enemy, rnd, clamp } from '../Enemy.js';
import { VillainBoss } from './a_boss.js';
import '../../models/villains_a.js';

const V3 = THREE.Vector3;
const _o = new V3(), _f = new V3(), _a = new V3(), _b = new V3(), _d = new V3(), _s = new V3(), _e = new V3();
const GREEN = 0x40e060, RED = 0xff2040, PURPLE = 0x8a30ff;
const IDLE = [[1.35, 0.95], [-1.35, 0.95], [1.45, -0.95], [-1.45, -0.95]];

export class DocOck extends VillainBoss {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'docock', modelId: 'docock', name: 'DOCTOR OCTOPUS', title: 'DOCTOR OCTOPUS', hp: 3600, radius: 0.85, height: 2.3, speed: 6.4, mass: 12, accent: GREEN, poise: 476 });
    this.cd = { any: 2, slam: 4, grab: 8, debris: 5, climb: 9, call: 10, swipe: 0 };
    this.engage = 5.2;
    this.tents = [0, 1, 2, 3].map((i) => ({ i, alive: true, hp: 300, max: 300, tgt: null, rate: 9, open: 0.35, weak: false, v: new V3() }));
    this.swings = 0; this.swingMax = 2;
    this.lines = [];
    this.rockN = 1;
    this.callsPhase = 0; this.forceCall = false;
    this.roof = null; this.roostT = 0;
    this.holdIdx = 0; this.holdRes = '';
    this.unstaggerable.add('roost');
    this.leapR = 6;
  }
  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.1 : 1.25; }
  phaseToast(p) { return p === 2 ? 'DOC OCK: "Behold my arms!" - break his tentacles!' : 'DOC OCK: SYMBIOTE-FUSED TENTACLES!'; }

  aliveTents() { return this.tents.filter((t) => t.alive); }
  activeTent() { return this.tents.find((t) => t.alive) ?? null; }
  setWeak() { const a = this.phase >= 2 ? this.activeTent() : null; for (const t of this.tents) t.weak = t === a; }
  releaseTents() { for (const t of this.tents) { t.tgt = null; t.rate = 9; t.open = 0.35; } }
  setTip(t, p, rate = 12, open = 0.35) { if (!t.tgt) t.tgt = new V3(); t.tgt.copy(p); t.rate = rate; t.open = open; }

  onPhaseStart(p) {
    this.callsPhase = 0; this.forceCall = true;
    if (p === 2) this.setWeak();
    if (p === 3) {
      for (const t of this.tents) { t.alive = true; t.hp = t.max = 280; }
      this.model.setFuse?.(true); this.model.setTint?.(0x8a30ff, 0.15);
      this.setWeak();
      this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 12, PURPLE);
    }
  }

  onBossHit(dealt) {
    if (this.phase < 2 || this.state === 'intro') return;
    const t = this.activeTent(); if (!t) return;
    t.hp -= dealt * 0.9;
    if (t.hp <= 0) this.destroyTent(t);
  }
  tentBase(i, out) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), x = IDLE[i][0] * this.k, z = IDLE[i][1] * this.k;
    return out.set(this.pos.x + x * cy + z * sy, this.pos.y + 0.5, this.pos.z - x * sy + z * cy);
  }
  destroyTent(t) {
    const g = this.game;
    t.alive = false; t.tgt = null;
    this.tentBase(t.i, _o);
    g.fx.explosion(_o, 2.6, 0xffa040); g.fx.burst(_o, 0xffe080, 18, 7, 0.6, 0.25); g.fx.lightning(_o, _a.set(_o.x, _o.y + 3, _o.z), 0xffe080, 0.3, 3);
    g.fx.text(_a.set(this.pos.x, this.pos.y + this.height + 1.2, this.pos.z), 'TENTACLE DESTROYED!', 0xffa040, { size: 1.5, life: 1.4 });
    g.audio?.play?.('explosion', { pos: this.pos }); g.cam.shake(0.5);
    this.setWeak();
    if (!this.unstaggerable.has(this.state)) this.stagger(2.8);
    else this.poise = this.poiseMax * 0.9;
  }

  // ------------------------------------------------------------------ attack choice
  pickAttack(d) {
    const c = this.cd, o = [], nt = this.aliveTents().length;
    if (this.forceCall && this.minionsAlive() < 3) { this.forceCall = false; return 'call'; }
    if (c.call <= 0 && this.callsPhase < 2 && this.minionsAlive() === 0) o.push(['call', 3]);
    if (d < 7.5) o.push(['swipe', 7]);
    if (nt && d < 18 && c.slam <= 0) o.push(['slam', 6]);
    if (nt && d < 14 && c.grab <= 0) o.push(['grab', 5]);
    if (d > 6 && c.debris <= 0 && this.hasLOS) o.push(['debris', 5]);
    if (d > 4 && c.climb <= 0) { const r = this._findRoof(); if (r) { this.roof = r; o.push(['climb', 4]); } else c.climb = 5; }
    return this.pick(o);
  }
  onPick(p) { if (p === 'swipe') { this.swings = 0; this.swingMax = this.phase === 1 ? 2 : 3; } }

  chase(dt) {
    const pl = this.target, d = this.dist, sp = this.sp;
    this.attacking = false; this.windup = 0; this.releaseTents();
    this.facePlayer(dt, 6 * sp);
    if (d > this.engage + 0.5) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * (d > 14 ? 1.5 : 1)); this.setAnim('run', 0.8 * sp); }
    else { this.wish.set(0, 0, 0); this.setAnim('idle', 1); }
    if (this.cd.any <= 0) {
      const pick = this.pickAttack(d);
      if (pick) { this.count(pick); this.go(pick); this.onPick(pick); }
      else this.cd.any = 0.35;
    }
  }
  recovering() { this.releaseTents(); }

  _alive(n) { return this.aliveTents().slice(0, n); }

  // ------------------------------------------------------------------ swipes
  st_swipe(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    if (this.sub === '') this.sub = 'approach';
    if (this.sub === 'approach') {
      this.facePlayer(dt, 8); this.setAnim('run', sp);
      if (this.dist > 4.4 && this.stateT < 1.6) this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * 1.4);
      else { this.sub = 'wind'; this.stateT = 0; }
      return;
    }
    const total = (this.swings === this.swingMax - 1 ? 0.85 : 0.6) / sp;
    const ts = this._alive(2);
    this.forward(_f); _s.set(_f.z, 0, -_f.x);                // right vector
    const side = this.swings % 2 ? -1 : 1;
    if (this.sub === 'wind') {
      this.attacking = true; this.windup = Math.max(0, total - this.stateT);
      this.facePlayer(dt, this.windup > 0.2 ? 7 : 0); this.setAnim('punch1', 0.5 * sp);
      if (this.stateT === dt) g.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 5.6, RED, total);
      ts.forEach((t, n) => this.setTip(t, _o.set(this.pos.x + _s.x * 3.2 * side * (n ? -1 : 1) - _f.x * 0.5, this.pos.y + 2.2, this.pos.z + _s.z * 3.2 * side * (n ? -1 : 1) - _f.z * 0.5), 10, 0.8));
      if (this.stateT >= total) {
        this.windup = 0; this.sub = 'hit'; this.stateT = 0;
        ts.forEach((t, n) => this.setTip(t, _o.set(this.pos.x - _s.x * 3.2 * side * (n ? -1 : 1) + _f.x * 3.6, this.pos.y + 0.8, this.pos.z - _s.z * 3.2 * side * (n ? -1 : 1) + _f.z * 3.6), 40, 0.2));
        this.vel.x += _f.x * 5; this.vel.z += _f.z * 5;
        this.strike(5.9, 150, this.phase === 3 ? 18 : 14, 10, 2.5, 1.0);
        g.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.8 });
        if (this.swings === this.swingMax - 1) { g.cam.shake(0.3); g.audio?.play?.('heavyhit', { pos: this.pos }); }
        this.swings++;
      }
    } else if (this.sub === 'hit') {
      this.windup = 0; this.attacking = false; this.setAnim('punch2', 0.7);
      if (this.stateT > 0.25 / sp) {
        if (this.swings >= this.swingMax) { this.cd.any = rnd(1, 1.8); this.releaseTents(); this.rest(1.2); }
        else { this.sub = 'wind'; this.stateT = 0; }
      }
    }
  }

  // ------------------------------------------------------------------ line slams
  st_slam(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 1.2 / sp, L = 12;
    this.attacking = true; this.wish.set(0, 0, 0);
    const ts = this._alive(this.phase);
    if (this.sub === '') {
      this.sub = 'wind';
      const base = Math.atan2(this.dx, this.dz), n = ts.length;
      this.lines = ts.map((t, k) => ({ t, ang: base + (k - (n - 1) / 2) * 0.42 }));
    }
    if (this.sub === 'wind') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('smash', 0.35 * sp);
      if (this.windup > 0.35) { // lines re-aim at the player until the last moment, then lock
        const base = Math.atan2(this.dx, this.dz), n = this.lines.length;
        this.lines.forEach((l, k) => { l.ang = base + (k - (n - 1) / 2) * 0.42; });
        this.facePlayer(dt, 8);
      }
      for (const l of this.lines) {
        _d.set(Math.sin(l.ang), 0, Math.cos(l.ang));
        _a.set(this.pos.x, this.pos.y + 0.12, this.pos.z); _b.copy(_a).addScaledVector(_d, L);
        _b.y = this.groundY(_b.x, _b.z) + 0.12;
        g.fx.beam(_a, _b, RED, this.windup < 0.35 ? 0.16 : 0.07, 0.07);
        if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) g.fx.ring(_b, 1.7, RED, 0.2);
        this.setTip(l.t, _o.set(this.pos.x + _d.x * 1.2, this.pos.y + 5.2, this.pos.z + _d.z * 1.2), 8, 0.9);
      }
      if (this.stateT >= total) {
        this.windup = 0; this.sub = 'hit'; this.stateT = 0;
        let hit = false;
        for (const l of this.lines) {
          _d.set(Math.sin(l.ang), 0, Math.cos(l.ang));
          _e.set(this.pos.x + _d.x * L, this.groundY(this.pos.x + _d.x * L, this.pos.z + _d.z * L), this.pos.z + _d.z * L);
          this.setTip(l.t, _e, 55, 0.1);
          // damage along the segment
          if (pl && !pl.dead) {
            const px = pl.pos.x - this.pos.x, pz = pl.pos.z - this.pos.z;
            const tt = clamp(px * _d.x + pz * _d.z, 0, L), dx = px - _d.x * tt, dz = pz - _d.z * tt;
            if (Math.hypot(dx, dz) < 1.7 && pl.pos.y < this.pos.y + 1.0) {
              hit = true;
              g.combat.damagePlayer(this.phase === 3 ? 24 : 20, _o.set(this.pos.x + _d.x * tt, this.pos.y, this.pos.z + _d.z * tt), this);
              pl.vel.y = Math.max(pl.vel.y, 7);
            }
          }
          g.fx.shockwave(_o.set(_e.x, _e.y + 0.1, _e.z), 4, this.phase === 3 ? PURPLE : 0xc8c8b0); g.fx.dust(_e, 12, 3);
          for (let s = 1; s <= 4; s++) g.fx.dust(_o.set(this.pos.x + _d.x * L * s / 4, this.pos.y + 0.1, this.pos.z + _d.z * L * s / 4), 4, 1.5);
          if (this.phase === 3) { this.addZone({ kind: 'dot', pos: _e, r: 1.8, life: 4, armT: 0, color: PURPLE, dmg: 4 }); }
        }
        g.cam.shake(hit ? 0.8 : 0.5); g.audio?.play?.('smash', { pos: this.pos }); g.input?.rumble?.(0.7, 0.4, 200);
      }
    } else if (this.sub === 'hit') {
      this.windup = 0; this.setAnim('smash', 0.35);
      if (this.stateT > 0.55) { this.releaseTents(); this.cd.slam = 8 - this.phase; this.cd.any = rnd(1, 1.7); this.rest(1.3); }
    }
  }

  // ------------------------------------------------------------------ grab and throw
  st_grab(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 1.15 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    const t = this.aliveTents()[0];
    if (!t) { this.rest(0.5); return; }
    if (this.sub === '') { this.sub = 'wind'; this.lock = this.lock || new V3(); this.lock.copy(pl.pos); }
    if (this.sub === 'wind') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('throw', 0.4 * sp);
      if (this.windup > 0.3) { this.lock.copy(pl.pos); this.lock.x += pl.vel.x * 0.12; this.lock.z += pl.vel.z * 0.12; this.facePlayer(dt, 9); }
      _a.set(this.pos.x, this.pos.y + 1.5, this.pos.z); _b.set(this.lock.x, this.lock.y + 0.2, this.lock.z);
      g.fx.beam(_a, _b, RED, this.windup < 0.3 ? 0.12 : 0.04, 0.06);
      if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) g.fx.ring(_o.set(this.lock.x, this.lock.y + 0.12, this.lock.z), 2.2, RED, 0.2);
      this.setTip(t, _o.set(this.lock.x, this.lock.y + 3.2, this.lock.z), 9, 1.0);
      if (this.stateT >= total) {
        this.windup = 0; this.sub = 'lunge'; this.stateT = 0;
        this.setTip(t, _o.set(this.lock.x, this.lock.y + 0.5, this.lock.z), 60, 1.0);
        g.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.6 });
        const ok = !pl.dead && pl.invuln <= 0 && Math.hypot(pl.pos.x - this.lock.x, pl.pos.z - this.lock.z) < 2.4 && Math.abs(pl.pos.y - this.lock.y) < 1.8;
        if (ok) {
          this.holdIdx = t.i; this.holdRes = '';
          g.combat.damagePlayer(8, this.pos, this);
          const tip = t.tgt;
          this.holdPlayer(1.5, (p) => { p.set(tip.x, tip.y - 1.3, tip.z); }, 9);
          this.sub = 'hold'; this.stateT = 0;
          g.fx.text(_a.set(pl.pos.x, pl.pos.y + 2.4, pl.pos.z), 'GRABBED! MASH ATTACK / DODGE!', 0xffe040, { size: 1.3, life: 1.3 });
          g.cam.shake(0.4);
        }
      }
    } else if (this.sub === 'lunge') {
      this.setAnim('throw', 0.9);
      if (this.stateT > 0.5) { this.releaseTents(); this.cd.grab = 11; this.cd.any = rnd(1, 1.6); this.rest(1.3); }
    } else if (this.sub === 'hold') {
      this.setAnim('throw', 0.2);
      // lift the victim above the boss, toward the throw direction
      this.forward(_f);
      _o.set(this.pos.x + _f.x * 1.8, this.pos.y + 4.6, this.pos.z + _f.z * 1.8);
      t.tgt.lerp(_o, Math.min(1, dt * 5)); t.rate = 12;
      if (!this.pin && this.stateT > 0.05) { this.releaseTents(); this.cd.grab = 12; this.cd.any = rnd(1, 1.6); this.rest(1.4); }
    }
  }
  onGrabEnd(pl) {      // timed out: throw
    const g = this.game;
    this.forward(_f);
    g.combat.damagePlayer(20, this.pos, this);
    pl.vel.set(_f.x * 20, 9, _f.z * 20);
    g.fx.text(_o.set(pl.pos.x, pl.pos.y + 2, pl.pos.z), 'THROWN!', 0xff8040, { size: 1.4, life: 1 });
    g.cam.shake(0.7); g.audio?.play?.('whoosh', { pos: this.pos }); g.input?.rumble?.(0.8, 0.5, 250);
  }
  onGrabBroken(pl) {   // player mashed free
    const g = this.game;
    pl.vel.set(0, -2, 0);
    this.poise += this.poiseMax * 0.45;
    g.fx.text(_o.set(pl.pos.x, pl.pos.y + 2, pl.pos.z), 'BROKE FREE!', 0x60ffa0, { size: 1.4, life: 1 });
    g.fx.burst(_o.set(pl.pos.x, pl.pos.y + 1, pl.pos.z), 0xffe040, 14, 5, 0.4, 0.2);
    g.audio?.play?.('heavyhit', { pos: this.pos });
  }

  // ------------------------------------------------------------------ debris throw
  st_debris(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 1.25 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    if (this.sub === '') { this.sub = 'wind'; this.rockN = this.phase; this.aim = this.aim || new V3(); }
    if (this.sub === 'wind') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('smash', 0.3 * sp);
      if (this.windup > 0.35) { this.facePlayer(dt, 8); this.aim.copy(pl.pos); this.aim.x += pl.vel.x * 0.55; this.aim.z += pl.vel.z * 0.55; }
      this.forward(_f);
      const ts = this._alive(2);
      ts.forEach((t, n) => this.setTip(t, _o.set(this.pos.x + _f.x * 1.2 + (n ? -1 : 1) * 1.2, this.pos.y + 3.4 + Math.sin(this.stateT * 6 + n) * 0.2, this.pos.z + _f.z * 1.2), 8, 0.9));
      if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) { g.fx.ring(_o.set(this.aim.x, this.aim.y + 0.12, this.aim.z), 4.8, RED, 0.25); g.fx.dust(_a.set(this.pos.x + _f.x * 2.5, this.pos.y + 0.1, this.pos.z + _f.z * 2.5), 5, 1.5); }
      if (this.stateT >= total) { this._fireRocks(); this.sub = 'fired'; this.stateT = 0; }
    } else {
      this.windup = 0; this.setAnim('throw', 1.1);
      if (this.stateT > 0.6) { this.releaseTents(); this.cd.debris = 8; this.cd.any = rnd(1, 1.6); this.rest(1.0); }
    }
  }
  _fireRocks(n = this.rockN) {
    const g = this.game;
    this.forward(_f);
    _a.set(this.pos.x + _f.x * 1.2, this.pos.y + this.height + 1.4, this.pos.z + _f.z * 1.2);
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * 4.2;
      _e.set(this.aim.x + _f.z * off, this.aim.y, this.aim.z - _f.x * off);
      const T = clamp(Math.hypot(_e.x - _a.x, _e.z - _a.z) / 20, 0.7, 1.8), G = 16;
      const vel = new V3((_e.x - _a.x) / T, (_e.y + 0.9 - _a.y + 0.5 * G * T * T) / T, (_e.z - _a.z) / T);
      g.combat.projectile({ pos: _a, vel, damage: 24, kind: 'rock', team: 'enemy', source: this, radius: 1.0, size: 1.5, life: 4, gravity: G, blast: 4.8, knockback: 12, up: 6 });
      const ex = _e.x, ey = _e.y, ez = _e.z;
      for (let k = 0.2; k < T; k += 0.28) this.later(k, () => g.fx.ring(_o.set(ex, ey + 0.12, ez), 4.8, RED, 0.3));
    }
    g.audio?.play?.('throw', { pos: this.pos, pitch: 0.6 }); g.cam.shake(0.3);
  }

  // ------------------------------------------------------------------ rooftop climb -> roost -> dive
  _findRoof() {
    const ph = this.game.physics, pl = this.target;
    for (let i = 0; i < 70; i++) {
      const ang = Math.random() * Math.PI * 2, r = rnd(8, 30);
      const x = this.pos.x + Math.cos(ang) * r, z = this.pos.z + Math.sin(ang) * r;
      const y = ph.heightAt(x, z, this.pos.y + 18);
      const dy = y - this.pos.y;
      if (dy < 4.5 || dy > 18) continue;
      if (pl && Math.hypot(x - pl.pos.x, z - pl.pos.z) < 6) continue;
      // flat roof: a 2 m neighbourhood at the same height, with solid below and air above
      let ok = true;
      for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(ph.heightAt(x + ox, z + oz, y + 1) - y) > 0.3) { ok = false; break; }
      if (!ok || ph.inside(_o.set(x, y + 1.2, z))) continue;
      return new V3(x, y, z);
    }
    return null;
  }
  st_climb(dt) {
    const sp = this.sp, g = this.game, roof = this.roof;
    this.attacking = true; this.wish.set(0, 0, 0);
    if (!roof) { this.rest(0.3); return; }
    const total = 1.0 / sp;
    this.windup = Math.max(0, total - this.stateT) + 0.5;
    this.setAnim('charge', 0.5); this.faceYawTo(Math.atan2(roof.x - this.pos.x, roof.z - this.pos.z), dt, 8);
    this.tents.forEach((t, i) => t.alive && this.setTip(t, this.tentBase(i, _o).setY(this.pos.y), 14, 0.6));
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) { g.fx.ring(_o.set(roof.x, roof.y + 0.12, roof.z), 4, 0xffe040, 0.3); g.fx.dust(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 4, 2); }
    if (this.stateT >= total) { this.cd.climb = 22; this.leapTo(roof, () => this._roostLand(), 6); }
  }
  _roostLand() {
    const g = this.game;
    this.releaseTents();
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    g.fx.shockwave(_o, 8, GREEN); g.fx.dust(_o, 14, 4); g.cam.shake(0.5); g.audio?.play?.('smash', { pos: this.pos });
    this.roostT = 0; this.cd.debris = 1.0;
    this.go('roost');
    g.hud?.toast?.('Doc Ock climbs a rooftop - he must come down!');
  }
  st_roost(dt) {
    const pl = this.target, g = this.game, sp = this.sp;
    this.roostT += dt; this.wish.set(0, 0, 0); this.attacking = false; this.windup = 0;
    this.facePlayer(dt, 5); this.setAnim('idle', 1);
    this.aim = this.aim || new V3();
    if (this.roostT > 10 || this.dist > 60) { this.go('dive'); return; }
    if (this.sub === '') this.sub = 'idle';
    if (this.sub === 'idle') {
      if (this.stateT > 1.6) { this.sub = 'wind'; this.stateT = 0; this.rockN = 1; }
    } else if (this.sub === 'wind') {
      const total = 1.0 / sp;
      this.attacking = true; this.windup = Math.max(0, total - this.stateT);
      this.setAnim('smash', 0.35);
      if (this.windup > 0.3) { this.aim.copy(pl.pos); this.aim.x += pl.vel.x * 0.5; this.aim.z += pl.vel.z * 0.5; }
      if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) g.fx.ring(_o.set(this.aim.x, this.aim.y + 0.12, this.aim.z), 4.8, RED, 0.25);
      this.forward(_f);
      this._alive(2).forEach((t, n) => this.setTip(t, _o.set(this.pos.x + _f.x * 1.2 + (n ? -1 : 1) * 1.2, this.pos.y + 3.4, this.pos.z + _f.z * 1.2), 8, 0.9));
      if (this.stateT >= total) { this._fireRocks(1); this.releaseTents(); this.sub = 'idle'; this.stateT = 0; this.windup = 0; this.attacking = false; }
    }
  }
  st_dive(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 0.85 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    this.windup = Math.max(0, total - this.stateT) + 0.6;
    this.facePlayer(dt, 8); this.setAnim('charge', 0.5);
    if (this.stateT < total - 0.25) { this.target3.copy(pl.pos); this.target3.x += pl.vel.x * 0.45; this.target3.z += pl.vel.z * 0.45; }
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) g.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), this.leapR, RED, 0.25);
    if (this.stateT >= total) this.leapTo(this.target3, () => this._diveLand());
  }
  _diveLand() {
    const g = this.game;
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    this.groundBlast(_o, this.leapR, 22, 14, 8, 1.0);
    g.fx.shockwave(_o, 10, GREEN); g.fx.explosion(_o.setY(this.pos.y + 0.5), 3, GREEN);
    g.cam.shake(0.9); g.audio?.play?.('smash', { pos: this.pos }); g.input?.rumble?.(0.8, 0.5, 220);
    this.cd.any = 1.0;
    this.expose(3.4);          // grounded and winded
  }

  // ------------------------------------------------------------------ call octobots
  st_call(dt) {
    this.attacking = true; this.windup = 0; this.wish.set(0, 0, 0);
    this.setAnim('cast', 0.9); this.facePlayer(dt, 4);
    if (this.stateT < dt * 1.5) { this.game.audio?.play?.('boss_roar', { pitch: 1.2, volume: 0.6 }); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 9, GREEN); }
    if (this.stateT > 1.0 && this.sub !== 'done') { this.sub = 'done'; this.callMinions('octobot', this.phase === 3 ? 3 : 2); this.callsPhase++; this.cd.call = 30; }
    if (this.stateT > 1.6) { this.cd.any = rnd(1, 1.6); this.rest(0.5); }
  }

  extraUpdate() { /* tentacle state is read by the model */ }
  onDied() { for (const t of this.tents) { t.alive = false; } this.model.setFuse?.(false); }
}

// ======================================================================= OCTOBOT (hovering drone)
export class Octobot extends Enemy {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'octobot', modelId: 'octobot', name: 'Octobot', hp: 60, radius: 0.5, height: 0.8, speed: 6.5, mass: 0.7, gravity: 0 });
    this.isMinion = true;
    this.state = 'move'; this.shotCd = rnd(1.5, 3); this.orbit = Math.random() < 0.5 ? -1 : 1; this.orbitT = rnd(2, 4);
    this.hover = 1.1 + rnd(-0.1, 0.2); this.t = Math.random() * 6; this.aimP = new V3();
    this.dmg = 8;
  }
  onInterrupt() { if (this.state === 'aim') { this.state = 'move'; this.stateT = 0; } this.shotCd = Math.max(this.shotCd, 1.2); }
  _go(s) { this.state = s; this.stateT = 0; }
  _physics(dt, inc) {
    if (!inc) {
      const k = Math.min(1, 6 * dt);
      this.vel.x += (this.wish.x - this.vel.x) * k; this.vel.z += (this.wish.z - this.vel.z) * k;
      const ty = this.game.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 3) + this.hover + Math.sin(this.t * 2.2) * 0.12;
      this.vel.y += (clamp((ty - this.pos.y) * 5, -6, 6) - this.vel.y) * Math.min(1, 8 * dt);
    }
    super._physics(dt, inc);
  }
  ai(dt) {
    const pl = this.target, m = this.manager;
    this.t += dt; this.shotCd -= dt;
    if (!pl) { this.setAnim('idle', 1); return; }
    const d = this.dist;
    switch (this.state) {
      case 'move': {
        this.facePlayer(dt, 8);
        this.orbitT -= dt; if (this.orbitT <= 0) { this.orbit *= -1; this.orbitT = rnd(2, 4); }
        if (d > 11) { this.moveToward(pl.pos.x, pl.pos.z, this.speed); }
        else if (d < 5) { this.wish.set(-this.dx / d * this.speed * 0.8, 0, -this.dz / d * this.speed * 0.8); }
        else this.strafe(this.orbit, this.speed * 0.6);
        this.setAnim('run', 1);
        if (this.shotCd <= 0 && this.hasLOS && d < 28 && m.requestToken(this, 'ranged')) this._go('aim');
        break;
      }
      case 'aim': {
        const total = 0.9;
        this.attacking = true; this.windup = Math.max(0, total - this.stateT);
        this.setAnim('shoot', 1);
        if (this.windup > 0.25) { this.facePlayer(dt, 12); this.aimP.copy(pl.center); }
        this.model.muzzle.updateWorldMatrix(true, false); this.model.muzzle.getWorldPosition(_a);
        _b.subVectors(this.aimP, _a); const l = _b.length() || 1; _b.multiplyScalar((l + 3) / l).add(_a);
        this.game.fx.beam(_a, _b, 0xff3030, this.windup < 0.25 ? 0.05 : 0.02, 0.06);
        if (!this.hasLOS && this.stateT > 0.4) { this.attacking = false; this.windup = 0; m.releaseToken(this); this.shotCd = 1; this._go('move'); break; }
        if (this.stateT >= total) {
          _d.subVectors(this.aimP, _a).normalize();
          this.game.combat.hitscan({ origin: _a, dir: _d, damage: this.dmg, team: 'enemy', width: 0.5, range: 45, source: this, tracer: 0xff3030 });
          this.game.fx.flash(_a, 0xff3030, 1.5, 0.08); this.game.audio?.play?.('hunter_shot', { pos: this.pos, pitch: 1.6 });
          this.attacking = false; this.windup = 0; m.releaseToken(this); this.shotCd = rnd(2.4, 4); this._go('move');
        }
        break;
      }
      default: this._go('move');
    }
  }
  onDeath() {
    this.gravity = 24;
    this.game.fx.explosion(this.center, 1.6, 0xffa040);
    this.game.audio?.play?.('explosion', { pos: this.pos, volume: 0.5 });
  }
}

registerEnemy('docock', DocOck);
registerEnemy('octobot', Octobot);
