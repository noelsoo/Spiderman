// Shared base classes for villain batch B (Goblin / Loki / Ultron / Carnage and their minions).
//   FlyerB : Enemy that can hover (flying=true -> zero gravity, velocity steered toward this.fw with this.flyAccel)
//   BossB  : FlyerB + boss plumbing (intro, phases 66/33, poise/stagger, telegraph helpers, projectile helpers, death)
import * as THREE from 'three';
import { Enemy, rnd, clamp } from '../Enemy.js';

export { rnd, clamp, THREE };
export const _o = new THREE.Vector3();
export const _a = new THREE.Vector3();
export const _b = new THREE.Vector3();
export const _f = new THREE.Vector3();
export const _d = new THREE.Vector3();

const HEAVY_KINDS = new Set(['hammer', 'rock', 'missile', 'aoe', 'shield', 'lightning', 'slam', 'shock', 'clap', 'charge']);

export class FlyerB extends Enemy {
  constructor(game, manager, cfg) {
    super(game, manager, cfg);
    this.flying = false; this.flyAccel = 14; this.fw = new THREE.Vector3();
    this.cd = { any: 1 };
    this.sub = '';
  }

  /** steer toward a world point (flying). speed m/s, arrives smoothly. */
  steer(tx, ty, tz, speed, accel = this.flyAccel) {
    const dx = tx - this.pos.x, dy = ty - this.pos.y, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.05) { this.fw.set(0, 0, 0); this.flyAccel = accel; return d; }
    const s = Math.min(speed, d * 3.2);
    this.fw.set(dx / d * s, dy / d * s, dz / d * s);
    this.flyAccel = accel;
    return d;
  }
  hold() { this.fw.set(0, 0, 0); }

  /** terrain / rooftop height under (x,z) reachable from refY. */
  floorAt(x, z, refY) { return this.game.physics.heightAt(x, z, refY + 2.2); }

  _physics(dt, incapacitated) {
    if (this.flying && !this.ballistic) {
      const v = this.vel, a = this.flyAccel * dt, w = this.fw;
      v.x += clamp(w.x - v.x, -a, a); v.y += clamp(w.y - v.y, -a, a); v.z += clamp(w.z - v.z, -a, a);
      this.wish.set(w.x, 0, w.z);
    }
    super._physics(dt, incapacitated);
  }

  ring(x, y, z, r, color, life) { this.game.fx.ring(_o.set(x, y + 0.12, z), r, color, life); }
  muzzle(out, joint = 'handR') {
    const h = this.model[joint] ?? this.model.handR;
    if (h) { h.updateWorldMatrix(true, false); return h.getWorldPosition(out); }
    this.forward(_f);
    return out.set(this.pos.x + _f.x * 0.8, this.pos.y + this.height * 0.7, this.pos.z + _f.z * 0.8);
  }
  say(text, color = 0xffe040, o = {}) { this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.8, this.pos.z), text, color, { size: 1.5, life: 1.3, ...o }); }
}

export class BossB extends FlyerB {
  constructor(game, manager, cfg) {
    super(game, manager, { isBoss: true, ...cfg });
    this.bossTitle = cfg.bossTitle ?? cfg.name;
    this.phase = 1; this.pendingPhase = 1;
    this.poise = 0; this.poiseMax = cfg.poise ?? 240; this.heavyPoise = cfg.heavyPoise ?? 1.6;
    this.state = 'intro'; this.stateT = 0;
    this.introDone = false;
    this.minions = [];
    this.superArmor = true;
    this.deathColor = cfg.deathColor ?? 0xffa040;
  }

  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.12 : 1.28; }
  _go(s) { this.state = s; this.stateT = 0; this.sub = ''; this.attacking = false; this.windup = 0; }

  // ------------------------------------------------------------------ overridable hooks
  damageMult(amount, o) { return 1; }
  canStagger() { return false; }
  startStagger(heavy) {}
  onBossHit(dealt, o, heavy) {}
  think(dt) {}
  introStart() {}

  // ------------------------------------------------------------------ damage
  takeDamage(amount, o = {}) {
    if (!this.alive) return 0;
    const m = this.damageMult(amount, o);
    if (m <= 0) return 0;
    const dealt = super.takeDamage(amount * m, o);
    if (dealt <= 0 || !this.alive) return dealt;
    const kind = o.kind ?? 'melee';
    const heavy = dealt >= 30 || (HEAVY_KINDS.has(kind) && dealt >= 14);
    this._phaseCheck();
    this.poise += dealt * (heavy ? this.heavyPoise : 1);
    this.onBossHit(dealt, o, heavy);
    if (this.poise >= this.poiseMax * (this.phase === 3 ? 1.25 : 1) && this.canStagger() && this.pendingPhase === this.phase) {
      this.poise = 0;
      this.startStagger(heavy);
    }
    return dealt;
  }
  _phaseCheck() {
    const f = this.hp / this.maxHp;
    if (this.pendingPhase < 2 && f <= 0.66) this.pendingPhase = 2;
    if (this.pendingPhase < 3 && f <= 0.33) this.pendingPhase = 3;
  }

  // ------------------------------------------------------------------ ai
  ai(dt) {
    if (!this.introDone) {
      this.introDone = true;
      const g = this.game;
      g.audio?.play?.('boss_roar'); g.audio?.music?.('boss'); g.cam?.shake?.(0.6);
      g.hud?.toast?.(this.name);
      this.introStart();
    }
    for (const k in this.cd) this.cd[k] -= dt;
    this.poise = Math.max(0, this.poise - 12 * dt);
    this._phaseCheck();
    this.think(dt);
  }

  // ------------------------------------------------------------------ minions
  spawnMinion(kind, pos, opts = {}) {
    const e = this.manager.spawn(kind, pos, { wave: Math.max(2, this.manager.stats?.wave ?? 2), ...opts });
    if (e) { e.owner = this; this.minions.push(e); }
    return e;
  }
  liveMinions(kind) { this.minions = this.minions.filter((m) => m.alive && !m.removed); return kind ? this.minions.filter((m) => m.kind === kind).length : this.minions.length; }
  killMinions() { for (const m of this.minions) if (m.alive) m.takeDamage(99999, {}); this.minions.length = 0; }

  // ------------------------------------------------------------------ death
  onDeath() {
    const g = this.game;
    this.flying = false; this.gravity = 28; this.ballistic = false; this.untargetable = false;
    this.root.visible = true;
    g.hud?.hideBoss?.();
    g.slowmo?.(1.4, 0.2);
    g.cam?.shake?.(1.2);
    g.audio?.play?.('boss_roar', { pitch: 0.7 });
    for (let i = 0; i < 4; i++) {
      _o.set(this.pos.x + rnd(-1.2, 1.2), this.pos.y + rnd(0.5, 2.5), this.pos.z + rnd(-1.2, 1.2));
      g.fx.explosion(_o, 3.2, this.deathColor);
    }
    g.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 14, this.deathColor);
    this.killMinions();
    this.onDeathExtra?.();
    this.manager.onBossDeath(this);
  }
}

// ---------------------------------------------------------------------- projectile helpers
/** Aim a ballistic arc from `from` so that it lands at `to` in T seconds. Returns velocity in `out`. */
export function lobVelocity(from, to, T, gravity, out) {
  return out.set((to.x - from.x) / T, (to.y - from.y + 0.5 * gravity * T * T) / T, (to.z - from.z) / T);
}

/** Simple energy bolt that hurts the player. */
export function fireBolt(game, source, from, dir, o = {}) {
  const speed = o.speed ?? 28;
  return game.combat.projectile({
    pos: from, vel: _f.copy(dir).normalize().multiplyScalar(speed).clone(), damage: o.damage ?? 8, kind: o.kind ?? 'repulsor', color: o.color ?? 0xff4040,
    size: o.size ?? 0.26, radius: o.radius ?? 0.35, life: o.life ?? 3, team: 'enemy', source, world: true, knockback: o.knockback ?? 4, up: 1.5,
    homing: o.homing ?? null, turn: o.turn ?? 3.5, gravity: o.gravity ?? 0, mesh: o.mesh, onHit: o.onHit, onExpire: o.onExpire, update: o.update,
  });
}
