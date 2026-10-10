// KRAVEN THE HUNTER boss (symbiote-infected). 2.0 m, 3000 hp, agile.
//   attacks : knives (combo), pounce (telegraphed leap), spear throw, bolas (root), net traps (telegraphed circles), call hunters
//   phases  : 66% -> more spears + 3 traps + hunters; 33% -> symbiote rage (faster, glowing claws, 4-hit combo)
//   fairness: every 3 attacks he is EXPOSED for 3.4 s, poise -> 3 s stagger, all big attacks have a windup
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import { VillainBoss, rnd } from './a_boss.js';
import '../../models/villains_a.js';

const V3 = THREE.Vector3;
const _o = new V3(), _f = new V3(), _a = new V3(), _b = new V3(), _d = new V3();
const RED = 0xff2040, ACC = 0xb030ff;

let SG = null;
function spearAssets() {
  if (SG) return SG;
  const g = new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6); g.rotateX(Math.PI / 2);
  const t = new THREE.ConeGeometry(0.08, 0.34, 6); t.rotateX(Math.PI / 2); t.translate(0, 0, 1.0);
  SG = {
    shaft: g, tip: t,
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25, emissive: 0x401060, emissiveIntensity: 0.5 }),
    ball: new THREE.SphereGeometry(0.2, 10, 8),
    cord: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }),
  };
  return SG;
}
function spearMesh() { const A = spearAssets(); const m = new THREE.Group(); const a = new THREE.Mesh(A.shaft, A.wood), b = new THREE.Mesh(A.tip, A.steel); a.castShadow = b.castShadow = true; m.add(a, b); return m; }
function bolaMesh() {
  const A = spearAssets(); const m = new THREE.Group();
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(A.ball, A.cord); b.position.set(Math.cos(i * 2.1) * 0.35, 0, Math.sin(i * 2.1) * 0.35); m.add(b); }
  m.userData.noOrient = true;
  return m;
}

export class Kraven extends VillainBoss {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'kraven', modelId: 'kraven', name: 'KRAVEN', title: 'KRAVEN THE HUNTER', hp: 3000, radius: 0.62, height: 2.0, speed: 8.4, mass: 7, accent: ACC, poise: 391 });
    this.cd = { any: 2, pounce: 6, spear: 3, bola: 8, trap: 7, call: 9 };
    this.engage = 3.2;
    this.callsPhase = 0; this.forceCall = false;
    this.swings = 0; this.swingMax = 3;
    this.traps = [];
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = 2;
    this.leapR = 4.2;
  }

  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.12 : 1.34; }
  phaseToast(p) { return p === 2 ? 'KRAVEN: "The hunt begins!"' : 'KRAVEN: SYMBIOTE RAGE!'; }
  onPhaseStart(p) {
    this.callsPhase = 0; this.forceCall = true;
    if (p === 3) { this.model.setRage?.(true); this.model.setTint?.(0x8020ff, 0.25); }
  }

  // ------------------------------------------------------------------ attack choice
  pickAttack(d) {
    const ph = this.phase, c = this.cd, o = [];
    const canCall = this.callsPhase < 1 ? c.call <= 0 : (this.callsPhase < 2 && c.call <= 0 && this.minionsAlive() === 0);
    if (this.forceCall && this.minionsAlive() < 3) { this.forceCall = false; return 'call'; }
    if (canCall && this.minionsAlive() < 3) o.push(['call', 4]);
    if (d < 4.6) o.push(['knives', 8]); else if (d < 10) o.push(['knives', 2]);
    if (d > 5 && c.pounce <= 0) o.push(['pounce', 6]);
    if (d > 7 && d < 30 && c.spear <= 0 && this.hasLOS) o.push(['spear', 5]);
    if (d > 6 && d < 24 && c.bola <= 0 && this.hasLOS) o.push(['bola', 4]);
    if (c.trap <= 0 && d < 24) o.push(['trap', 4]);
    return this.pick(o);
  }

  chase(dt) {
    const pl = this.target, d = this.dist, sp = this.sp;
    this.attacking = false; this.windup = 0;
    this.facePlayer(dt, 7 * sp);
    if (d > this.engage + 0.4) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * (d > 14 ? 1.45 : 1)); this.setAnim('run', 0.95 * sp); }
    else if (this.cd.any > 0.5 && d < 7) { // agile circle-strafe while waiting
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = rnd(1.2, 2.6); }
      this.strafe(this.strafeDir, this.speed * 0.55 * sp); this.setAnim('run', 0.7 * sp);
    } else { this.wish.set(0, 0, 0); this.setAnim('idle', 1); }
    if (this.cd.any <= 0) {
      const pick = this.pickAttack(d);
      if (pick) { this.count(pick); this.go(pick); if (pick === 'knives') { this.swings = 0; this.swingMax = this.phase === 3 ? 4 : 3; this.sub = 'approach'; } }
      else this.cd.any = 0.35;
    }
  }

  // ------------------------------------------------------------------ knives combo
  st_knives(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    if (this.sub === 'approach') {
      this.facePlayer(dt, 9); this.setAnim('run', 1.3 * sp);
      if (this.dist > 3.0 && this.stateT < 1.8) this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * 1.6);
      else { this.sub = 'wind'; this.stateT = 0; this.attacking = false; }
      return;
    }
    const last = this.swings >= this.swingMax - 1;
    const total = (last ? 0.8 : 0.52) / sp;
    if (this.sub === 'wind') {
      if (!this.attacking) {
        this.attacking = true;
        g.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), last ? 4.6 : 3.7, RED, total);
        g.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.9 });
      }
      this.windup = Math.max(0, total - this.stateT);
      this.facePlayer(dt, this.windup > 0.18 ? 8 : 0);
      this.setAnim(last ? 'kick' : (this.swings % 2 ? 'punch2' : 'punch1'), sp);
      if (this.stateT >= total) {
        this.windup = 0; this.forward(_f);
        const rage = this.phase === 3 ? 1.25 : 1;
        this.vel.x += _f.x * (last ? 11 : 6); this.vel.z += _f.z * (last ? 11 : 6);
        this.strike(last ? 4.4 : 3.6, last ? 130 : 110, (last ? 18 : 11) * rage, last ? 11 : 6, last ? 4 : 1.5);
        g.audio?.play?.(last ? 'heavyhit' : 'punch', { pos: this.pos });
        if (this.phase === 3) { _a.set(this.pos.x + _f.x * 1.8, this.pos.y + 1.3, this.pos.z + _f.z * 1.8); g.fx.sparks(_a, _f, ACC, 8, 8, 0.25, 0.1); }
        this.swings++; this.sub = 'follow'; this.stateT = 0;
      }
    } else if (this.sub === 'follow') {
      this.windup = 0; this.attacking = false;
      this.setAnim(this.swings % 2 ? 'punch2' : 'punch1', sp * 0.6);
      this.facePlayer(dt, 5);
      if (this.stateT > 0.2 / sp) {
        if (this.swings >= this.swingMax) { this.cd.any = rnd(1.0, 1.8) / sp; this.rest(1.1); }
        else { this.sub = 'wind'; this.stateT = 0; }
      }
    }
  }

  // ------------------------------------------------------------------ pounce
  st_pounce(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.85 / sp;
    this.attacking = true;
    this.windup = Math.max(0, total - this.stateT) + 0.5;
    this.facePlayer(dt, 6); this.setAnim('charge', sp * 0.7); this.wish.set(0, 0, 0);
    if (this.stateT < total - 0.25) { this.target3.copy(pl.pos); this.target3.x += pl.vel.x * 0.4; this.target3.z += pl.vel.z * 0.4; }
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), this.leapR, RED, 0.25);
    if (this.stateT >= total) this.leapTo(this.target3, () => this._pounceLand());
  }
  _pounceLand() {
    const g = this.game;
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    this.groundBlast(_o, this.leapR, 20, 12, 6);
    g.fx.shockwave(_o, 6, ACC); g.fx.dust(_o, 12, 3);
    g.cam.shake(0.5); g.audio?.play?.('smash', { pos: this.pos });
    this.cd.pounce = 7 - this.phase; this.cd.any = rnd(0.8, 1.4);
    this.rest(1.0);
  }

  // ------------------------------------------------------------------ spear volley
  st_spear(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 0.95 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    if (this.sub !== 'fired') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('throw', 0.6 * sp);
      if (this.windup > 0.3) this.facePlayer(dt, 10);
      this.handPos(_a);
      this.lead(pl, 0.1);
      _b.copy(_o.set(pl.center.x + pl.vel.x * 0.1, pl.center.y, pl.center.z + pl.vel.z * 0.1));
      g.fx.beam(_a, _b, RED, 0.02, 0.05);
      if (this.stateT >= total) {
        this.sub = 'fired'; this.windup = 0;
        const n = this.phase;                 // 1, 2, 3 spears
        _d.subVectors(_b, _a); const dist = _d.length(); _d.normalize();
        const yaw0 = Math.atan2(_d.x, _d.z), hl = Math.hypot(_d.x, _d.z);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.16;
          _f.set(Math.sin(yaw0 + off) * hl, _d.y, Math.cos(yaw0 + off) * hl);
          g.combat.projectile({ pos: _a, vel: _f.clone().multiplyScalar(38), damage: 15, kind: 'spear', team: 'enemy', source: this, radius: 0.45, life: 2.4, gravity: 3, mesh: spearMesh(), color: ACC, knockback: 7, up: 2,
            onExpire: (p) => p.mesh.parent?.remove(p.mesh) });
        }
        if (this.model.spear) { this.model.spear.visible = false; this.later(1.6, () => { if (this.model.spear) this.model.spear.visible = true; }); }
        g.audio?.play?.('throw', { pos: this.pos });
        g.fx.flash(_a, ACC, 2, 0.12);
        this.stateT = 0;
      }
    } else {
      this.windup = 0; this.setAnim('throw', 1.2);
      if (this.stateT > 0.45) { this.cd.spear = 5 - this.phase * 0.6; this.cd.any = rnd(0.8, 1.5); this.rest(0.9); }
    }
  }

  // ------------------------------------------------------------------ bolas (root on hit)
  st_bola(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 0.75 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    if (this.sub !== 'fired') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('throw', 0.7 * sp);
      if (this.windup > 0.25) this.facePlayer(dt, 10);
      this.handPos(_a); g.fx.beam(_a, _o.set(pl.center.x, pl.center.y, pl.center.z), 0xffe040, 0.02, 0.05);
      if (this.stateT >= total) {
        this.sub = 'fired'; this.windup = 0;
        const n = this.phase === 3 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const T = Math.max(0.3, this.dist / 24);
          _d.set(pl.center.x + pl.vel.x * T * 0.7 + i * 1.6, pl.center.y + 0.5 * 10 * T * T, pl.center.z + pl.vel.z * T * 0.7).sub(_a).multiplyScalar(1 / T);
          g.combat.projectile({ pos: _a, vel: _d.clone(), damage: 8, kind: 'bola', team: 'enemy', source: this, radius: 0.7, life: 3, gravity: 10, mesh: bolaMesh(), color: 0xffe040,
            onHit: (e, p) => { this.rootPlayer(0.9); g.fx.text(_o.set(pl.pos.x, pl.pos.y + pl.height + 0.5, pl.pos.z), 'ENTANGLED!', 0xffe040, { size: 1.2, life: 1 }); },
            update: (p, dt2) => { p.mesh.rotation.y += dt2 * 14; },
            onExpire: (p) => p.mesh.parent?.remove(p.mesh) });
        }
        g.audio?.play?.('throw', { pos: this.pos });
        this.stateT = 0;
      }
    } else {
      this.windup = 0;
      if (this.stateT > 0.4) { this.cd.bola = 10 - this.phase; this.cd.any = rnd(0.8, 1.5); this.rest(0.9); }
    }
  }

  // ------------------------------------------------------------------ net traps
  st_trap(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 0.8 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    this.facePlayer(dt, 6); this.setAnim('kick', 0.3);
    this.windup = Math.max(0, total - this.stateT);
    if (this.sub !== 'set' && this.stateT >= total) {
      this.sub = 'set'; this.windup = 0;
      const n = this.phase + 1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random(), r = i === 0 ? 0.4 : rnd(2.2, 5);
        const x = pl.pos.x + Math.cos(a) * r + pl.vel.x * 0.3 * (i === 0 ? 1 : 0), z = pl.pos.z + Math.sin(a) * r + pl.vel.z * 0.3 * (i === 0 ? 1 : 0);
        const y = this.groundY(x, z);
        // delayed placement so the throw reads (knife flies down)
        this.later(0.1 + i * 0.12, () => {
          _o.set(x, y, z);
          this.addZone({ kind: 'net', pos: _o, r: 1.9, life: 14, armT: 1.2, color: 0xe8e8d0, armColor: RED, dmg: 5, root: 1.3 });
          g.fx.burst(_o.setY(y + 0.4), 0xe8e8d0, 8, 3, 0.4, 0.2);
          g.fx.ring(_o.setY(y + 0.12), 1.9, 0xe8e8d0, 0.6);
        });
      }
      g.audio?.play?.('throw', { pos: this.pos });
    }
    if (this.sub === 'set' && this.stateT > total + 0.6) { this.cd.trap = 11; this.cd.any = rnd(0.8, 1.4); this.rest(0.7); }
  }

  // ------------------------------------------------------------------ call hunters
  st_call(dt) {
    this.attacking = true; this.windup = 0; this.wish.set(0, 0, 0);
    this.setAnim('cast', 0.9); this.facePlayer(dt, 4);
    if (this.stateT < dt * 1.5) { this.game.audio?.play?.('boss_roar', { pitch: 1.2, volume: 0.6 }); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 9, ACC); this.game.cam.shake(0.35); }
    if (this.stateT > 1.0 && this.sub !== 'done') {
      this.sub = 'done';
      this.callMinions('hunter', this.phase === 3 ? 3 : 2);
      this.callsPhase++; this.cd.call = 30;
    }
    if (this.stateT > 1.6) { this.cd.any = rnd(1, 1.6); this.rest(0.5); }
  }

  onDied() { this.model.setRage?.(false); }
}

registerEnemy('kraven', Kraven);
