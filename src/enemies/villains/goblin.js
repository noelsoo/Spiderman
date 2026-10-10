// GREEN GOBLIN (boss) + goblin_drone (minion).
// Airborne on his bat glider (8-15 m): pumpkin-bomb volleys, razor-bat swarms, strafing bomb runs, drone summons.
// FAIRNESS: every ~10 s he does a telegraphed glider dive-bomb that ends with him knocked off the glider for ~5 s on foot
// (takes +35% damage). Ranged / hammer / shield / web hits while airborne also knock him off the glider ("airDmg").
// Phase 3 = symbiote goblin: faster, 6-bomb volleys, more bats.
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import '../../models/villains_b.js';
import { BossB, FlyerB, rnd, clamp, _o, _a, _b, _f, _d, lobVelocity } from './b_base.js';

const PURPLE = 0x9a30ff, ORANGE = 0xff7a20;

// ---------------------------------------------------------------------- shared visuals
let PK = null;
function pumpkinAssets() {
  if (PK) return PK;
  PK = {
    body: new THREE.SphereGeometry(1, 12, 9), stem: new THREE.CylinderGeometry(0.12, 0.2, 0.4, 6), eye: new THREE.BoxGeometry(0.4, 0.16, 0.2),
    orange: new THREE.MeshBasicMaterial({ color: new THREE.Color(ORANGE).multiplyScalar(1.7), toneMapped: false }),
    green: new THREE.MeshBasicMaterial({ color: 0x3a8a2a, toneMapped: false }), dark: new THREE.MeshBasicMaterial({ color: 0x1a0a00, toneMapped: false }),
    bat: new THREE.MeshBasicMaterial({ color: new THREE.Color(PURPLE).multiplyScalar(1.3), toneMapped: false, side: THREE.DoubleSide }),
    batGeo: (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.1, 0.9, 0, -0.1, 0.5, 0, -0.5, 0, 0, 0.1, 0.5, 0, -0.5, 0, 0, -0.35], 3)); g.computeVertexNormals(); return g; })(),
  };
  return PK;
}
function pumpkinMesh(sc = 1) {
  const A = pumpkinAssets(), g = new THREE.Group();
  const b = new THREE.Mesh(A.body, A.orange); b.scale.set(0.34 * sc, 0.3 * sc, 0.34 * sc);
  const s = new THREE.Mesh(A.stem, A.green); s.scale.setScalar(0.4 * sc); s.position.y = 0.3 * sc;
  g.add(b, s);
  for (const x of [-0.12, 0.12]) { const e = new THREE.Mesh(A.eye, A.dark); e.scale.setScalar(0.4 * sc); e.position.set(x * sc, 0.04 * sc, 0.32 * sc); g.add(e); }
  return g;
}
function batMesh() {
  const A = pumpkinAssets(), g = new THREE.Group();
  for (const s of [1, -1]) { const w = new THREE.Mesh(A.batGeo, A.bat); w.scale.set(s * 0.5, 1, 0.5); g.add(w); }
  g.userData.noOrient = false;
  return g;
}

// ---------------------------------------------------------------------- Green Goblin
export class GreenGoblin extends BossB {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'goblin', modelId: 'goblin', name: 'GREEN GOBLIN', hp: 3200, radius: 0.65, height: 2.0, speed: 6.5, mass: 10, gravity: 0, poise: 200, deathColor: 0x9aff40 });
    this.flying = true;
    this.cd = { any: 3, bombs: 2, strafe: 7, bats: 6, dive: 10, drones: 12, gb: 0 };
    this.airDmg = 0;
    this.orbitA = rnd(0, 6.28); this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.airT = 0;
    this.loose = [];
    this.groundT = 5.2; this.stagger = 0;
    this.target3 = new THREE.Vector3(); this.S = new THREE.Vector3(); this.E = new THREE.Vector3();
    this.relI = 0; this.relT = 0; this.swings = 0; this.bombN = 3; this._meshes = new Set();
    this.dived = 0;
    this.fly0 = true;
  }

  get airThreshold() { return this.maxHp * 0.06; }
  get airborne() { return this.flying && !this.ballistic && this.state !== 'phase' && this.state !== 'intro'; }

  // ---------------------------------------------------------------- damage rules
  damageMult(amount, o) {
    switch (this.state) {
      case 'intro': return 0.25;
      case 'phase': return 0.35;
      case 'ground': case 'fall': case 'remount': return 1.35;
      default: return 1;
    }
  }
  onBossHit(dealt, o, heavy) {
    if (!this.airborne) return;
    const k = o.kind ?? 'melee';
    const w = k === 'melee' ? 0.25 : (k === 'web' || k === 'hammer' || k === 'shield' || k === 'lightning') ? 3 : (k === 'aoe' || k === 'missile' || k === 'rock') ? 1.8 : 1.5;
    this.airDmg += dealt * w;
    if (this.airDmg >= this.airThreshold) this.knockOff('shot');
  }
  web(seconds = 2) {
    if (!this.alive) return;
    super.web(seconds);
    if (this.airborne) { this.airDmg += this.airThreshold * 0.36; this.game.fx.burst(this.center, 0xffffff, 10, 3, 0.4, 0.18); if (this.airDmg >= this.airThreshold) this.knockOff('web'); }
  }
  canStagger() { return this.state === 'ground' && this.stagger <= 0; }
  startStagger(heavy) {
    this.stagger = heavy ? 1.8 : 1.2; this.groundT = Math.min(this.groundT + (heavy ? 1.0 : 0.6), 6.4);
    this.sub = ''; this.windup = 0; this.attacking = false;
    this.say('STAGGERED!');
  }
  interrupt() { super.interrupt(); }

  // ---------------------------------------------------------------- glider handling
  spawnLooseGlider() {
    const src = this.model.glider; if (!src) return;
    const g = src.clone(); g.visible = true;
    g.position.set(this.pos.x, this.pos.y + 0.1, this.pos.z); g.rotation.set(0, this.yaw, 0); g.scale.setScalar(this.k);
    this.game.scene.add(g);
    this.forward(_f);
    this.loose.push({ g, v: new THREE.Vector3(_f.x * 6 + rnd(-3, 3), 9, _f.z * 6 + rnd(-3, 3)), spin: rnd(-6, 6), t: 0 });
  }
  _looseTick(dt) {
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const L = this.loose[i]; L.t += dt;
      L.v.y -= 22 * dt; L.g.position.addScaledVector(L.v, dt); L.g.rotation.z += L.spin * dt; L.g.rotation.x += L.spin * 0.4 * dt;
      if (L.t > 0.5 && Math.random() < 0.4) this.game.fx.trailPuff(L.g.position.x, L.g.position.y, L.g.position.z, 0xa6ff3c, 0.5, 0.25, 0.1);
      if (L.t > 1.8 || L.g.position.y < 0) { this.game.fx.explosion(L.g.position, 2.0, 0x9aff40); L.g.parent?.remove(L.g); this.loose.splice(i, 1); }
    }
  }
  update(dt) { super.update(dt); this._looseTick(dt); }
  dispose() { for (const L of this.loose) L.g.parent?.remove(L.g); this.loose.length = 0; for (const m of this._meshes) m.parent?.remove(m); super.dispose(); }

  knockOff(why) {
    if (!this.airborne) return;
    this.airDmg = 0; this.windup = 0; this.attacking = false;
    this.flying = false; this.gravity = 28; this.vel.y = Math.min(this.vel.y, -3); this.vel.x *= 0.3; this.vel.z *= 0.3;
    this.spawnLooseGlider(); this.model.fx.glider = 0;
    this.game.audio?.play?.('heavyhit', { pos: this.pos });
    this.game.fx.burst(this.center, 0xa6ff3c, 18, 6, 0.5, 0.3);
    this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.8, this.pos.z), 'KNOCKED OFF!', 0xa6ff3c, { size: 1.6, life: 1.4 });
    this.cd.dive = Math.max(this.cd.dive, 6);
    this._go('fall');
  }

  // ---------------------------------------------------------------- bombs
  throwBomb(from, to, T, o = {}) {
    const g = this.game;
    const mesh = pumpkinMesh(o.scale ?? 1); this._meshes.add(mesh);
    const radius = o.radius ?? 3.6, dmg = o.damage ?? 15;
    let done = false;
    const boom = (p) => {
      if (done) return; done = true;
      mesh.parent?.remove(mesh); this._meshes.delete(mesh);
      g.combat.explode(p.pos.clone(), radius, dmg, { team: 'enemy', source: this, color: ORANGE, knockback: 12, up: 7, stun: 0.6 });
      g.cam.shake(0.25);
    };
    const vel = lobVelocity(from, to, T, o.gravity ?? 22, _d).clone();
    g.combat.projectile({ pos: from, vel, kind: 'rock', gravity: o.gravity ?? 22, life: T + 1.5, radius: 0.5, size: 0.3, team: 'enemy', source: this, mesh, onHit: boom, onExpire: boom });
    if (o.ring !== false) this.ring(to.x, to.y, to.z, radius, 0xff6a10, T);
  }

  // ---------------------------------------------------------------- ai
  introStart() { this.flying = true; this.gravity = 0; }

  think(dt) {
    const pl = this.target, g = this.game;
    this.model.fx.glider = this.flying || (this.state === 'remount' && this.stateT > 0.25) ? 1 : 0;
    this.airDmg = Math.max(0, this.airDmg - 3 * dt);
    if (this.flying) this.airT += dt; else this.airT = 0;
    if (!pl) { this.hold(); this.setAnim('hover', 1); return; }
    const s = this.state;

    if (this.pendingPhase !== this.phase && (s === 'fly')) { this._startPhase(); return; }

    switch (s) {
      case 'intro': {
        this.flying = true; this.gravity = 0;
        const ty = Math.max(pl.pos.y, this.floorAt(this.pos.x, this.pos.z, pl.pos.y + 20)) + 10;
        this.steer(this.pos.x, ty, this.pos.z, 9, 12);
        this.setAnim('hover', 1); this.facePlayer(dt, 4);
        if (this.stateT > 1.8) { this.cd.any = 1.2; this._go('fly'); }
        break;
      }
      case 'fly': this._fly(dt); break;
      case 'bombs': this._bombs(dt); break;
      case 'bats': this._bats(dt); break;
      case 'strafe': this._strafe(dt); break;
      case 'drones': this._drones(dt); break;
      case 'dive': this._dive(dt); break;
      case 'phase': this._phase(dt); break;
      case 'fall': this._fall(dt); break;
      case 'ground': this._ground(dt); break;
      case 'remount': this._remount(dt); break;
      default: this._go('fly');
    }
  }

  _orbit(dt, R = 13, h = 10, speed = 12) {
    const pl = this.target, phys = this.game.physics;
    this.orbitA += this.orbitDir * dt * 0.32 * this.sp;
    let tx = 0, ty = 0, tz = 0;
    for (let i = 0; i < 8; i++) {
      const a = this.orbitA + i * 0.8 * (i % 2 ? -1 : 1);
      tx = pl.pos.x + Math.cos(a) * R; tz = pl.pos.z + Math.sin(a) * R;
      ty = Math.max(pl.pos.y, this.floorAt(tx, tz, pl.pos.y + 14)) + h + Math.sin(this.stateT * 0.9) * 1.5;
      if (!phys.inside(_o.set(tx, ty, tz))) { if (i) this.orbitA = a; break; }
    }
    this.steer(tx, ty, tz, speed * this.sp, 14);
  }

  _fly(dt) {
    const pl = this.target, sp = this.sp, d = this.dist;
    this._orbit(dt, 13 - (this.phase - 1), 10, 12);
    this.facePlayer(dt, 5);
    this.setAnim(Math.hypot(this.vel.x, this.vel.z) > 4 ? 'fly' : 'hover', 1);
    this.attacking = false; this.windup = 0;
    if (this.cd.any > 0) return;
    const opts = [];
    if (this.cd.bombs <= 0) opts.push(['bombs', 5]);
    if (this.cd.bats <= 0) opts.push(['bats', 3]);
    if (this.cd.strafe <= 0 && d > 6) opts.push(['strafe', 4]);
    if (this.cd.dive <= 0) opts.push(['dive', 7]);
    if (this.phase >= 2 && this.cd.drones <= 0 && this.liveMinions('goblin_drone') < 3) opts.push(['drones', 3]);
    if (this.airT > 13 && this.cd.dive <= 1) { this._startDive(); return; }       // never stay up forever
    if (!opts.length) { this.cd.any = 0.5; return; }
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot, pick = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
    switch (pick) {
      case 'bombs': this.bombN = this.phase === 1 ? 3 : this.phase === 2 ? 4 : 6; this._go('bombs'); this.cd.bombs = rnd(5, 7) / sp; break;
      case 'bats': this._go('bats'); this.cd.bats = rnd(8, 11) / sp; break;
      case 'strafe': this._go('strafe'); this.cd.strafe = rnd(11, 14) / sp; break;
      case 'dive': this._startDive(); break;
      case 'drones': this._go('drones'); this.cd.drones = 24; break;
    }
  }

  _bombs(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.9 / sp;
    this.hold(); this.facePlayer(dt, 7);
    this.attacking = true;
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('throw', 0.8 * sp);
      if (this.stateT <= dt) this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.7 });
      this.muzzle(_a);
      if (Math.random() < 0.7) this.game.fx.burst(_a, ORANGE, 1, 2, 0.3, 0.35);
      if (this.stateT >= total) { this.sub = 'rel'; this.relI = 0; this.relT = 0; this.windup = 0; }
    } else {
      this.setAnim('throw', 1.4 * sp);
      this.relT -= dt;
      if (this.relI < this.bombN && this.relT <= 0) {
        this.muzzle(_a);
        const spread = this.phase === 3 ? 5 : 3.6;
        if (this.relI === 0) _b.set(pl.pos.x + pl.vel.x * 0.7, pl.pos.y, pl.pos.z + pl.vel.z * 0.7);
        else { const a = Math.random() * 6.28, r = rnd(1.5, spread); _b.set(pl.pos.x + Math.cos(a) * r + pl.vel.x * 0.4, pl.pos.y, pl.pos.z + Math.sin(a) * r + pl.vel.z * 0.4); }
        const T = clamp(Math.hypot(_b.x - _a.x, _b.z - _a.z) / 16, 1.0, 1.7);
        this.throwBomb(_a, _b, T);
        this.game.audio?.play?.('throw', { pos: this.pos });
        this.relI++; this.relT = 0.24 / sp;
      }
      if (this.relI >= this.bombN && this.relT < -0.35) { this.cd.any = rnd(1.4, 2.4) / sp; this._go('fly'); }
    }
  }

  _bats(dt) {
    const pl = this.target, sp = this.sp;
    const total = 1.0 / sp;
    this.hold(); this.facePlayer(dt, 7);
    this.attacking = true;
    this.setAnim('cast', sp);
    if (this.sub === '') {
      this.windup = Math.max(0, total - this.stateT);
      if (this.stateT <= dt) this.game.audio?.play?.('boss_roar', { pitch: 1.6, volume: 0.5 });
      this.muzzle(_a);
      this.game.fx.burst(_a, PURPLE, 1, 3, 0.4, 0.3);
      if (this.stateT >= total) {
        this.sub = 'done'; this.windup = 0;
        const n = this.phase === 1 ? 4 : this.phase === 2 ? 6 : 8;
        this.muzzle(_a);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.28 + rnd(0, 0.5);
          _f.set(Math.cos(a) * 0.7, rnd(0.2, 0.9), Math.sin(a) * 0.7).normalize();
          const mesh = batMesh(); this._meshes.add(mesh);
          const fl = rnd(0, 6);
          this.game.combat.projectile({
            pos: _a, vel: _f.clone().multiplyScalar(11), damage: 7, kind: 'repulsor', color: PURPLE, size: 0.3, radius: 0.4, life: 3.8, team: 'enemy', source: this,
            homing: pl, turn: 1.7, mesh, knockback: 4,
            update: (p) => { const f = Math.sin(p.age * 24 + fl) * 0.7; mesh.children[0].rotation.z = f; mesh.children[1].rotation.z = -f; },
            onExpire: () => { mesh.parent?.remove(mesh); this._meshes.delete(mesh); },
          });
        }
        this.game.fx.flash(_a, PURPLE, 3, 0.2);
        this.game.audio?.play?.('whoosh', { pos: this.pos });
      }
    } else if (this.stateT > total + 0.7) { this.cd.any = rnd(1.4, 2.4) / sp; this._go('fly'); }
  }

  _strafe(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    this.attacking = true;
    if (this.sub === '') {
      const a = rnd(0, 6.28);
      this.S.set(pl.pos.x + Math.cos(a) * 30, pl.pos.y + 9, pl.pos.z + Math.sin(a) * 30);
      this._sd = a; this.sub = 'move';
    }
    if (this.sub === 'move') {
      this.setAnim('fly', 1); this.facePlayer(dt, 6);
      this.steer(this.S.x, this.S.y, this.S.z, 26 * sp, 30);
      const d = Math.hypot(this.S.x - this.pos.x, this.S.z - this.pos.z);
      if (d < 4 || this.stateT > 2.6) { this.sub = 'tele'; this.stateT = 0; this.E.set(pl.pos.x - Math.cos(this._sd) * 32, this.pos.y, pl.pos.z - Math.sin(this._sd) * 32); }
    } else if (this.sub === 'tele') {
      const total = 0.95 / sp;
      this.hold(); this.windup = Math.max(0, total - this.stateT);
      this.faceYawTo(Math.atan2(this.E.x - this.pos.x, this.E.z - this.pos.z), dt, 10);
      this.setAnim('cast', 1);
      // ground strip under the flight path where the bombs will fall
      const gy = pl.pos.y + 0.15;
      _a.set(this.pos.x, gy, this.pos.z); _b.set(this.E.x, gy, this.E.z);
      fx.beam(_a, _b, 0xff3020, 0.35, 0.06);
      fx.beam(this.center, _b.set(this.E.x, this.E.y, this.E.z), 0xff6040, 0.05, 0.05);
      if (this.stateT >= total) { this.sub = 'run'; this.stateT = 0; this.windup = 0; this.dropT = 0; this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.8 }); }
    } else {
      this.setAnim('fly', 1.4);
      this.faceYawTo(Math.atan2(this.E.x - this.pos.x, this.E.z - this.pos.z), dt, 10);
      this.steer(this.E.x, this.E.y - 1.5, this.E.z, 32 * sp, 70);
      this.dropT -= dt;
      if (this.dropT <= 0) {
        this.dropT = 0.27 / sp;
        _a.set(this.pos.x, this.pos.y - 0.6, this.pos.z);
        this.throwBomb(_a, _b.set(this.pos.x + this.vel.x * 0.18, this.floorAt(this.pos.x, this.pos.z, this.pos.y), this.pos.z + this.vel.z * 0.18), 0.9, { scale: 0.65, radius: 2.7, damage: 10, gravity: 24, ring: false });
      }
      const d = Math.hypot(this.E.x - this.pos.x, this.E.z - this.pos.z);
      if (d < 4 || this.stateT > 2.8) { this.cd.any = rnd(1.2, 2.2) / sp; this._go('fly'); }
    }
  }

  _drones(dt) {
    this.hold(); this.facePlayer(dt, 4); this.attacking = true;
    this.setAnim('cast', 1);
    if (this.stateT > 1.1 && this.sub !== 'done') {
      this.sub = 'done';
      const n = this.phase === 3 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + Math.random();
        this.spawnMinion('goblin_drone', _o.set(this.pos.x + Math.cos(a) * 3, Math.max(this.target?.pos.y ?? 0, this.pos.y - 6) + 1, this.pos.z + Math.sin(a) * 3));
      }
      this.game.audio?.play?.('whoosh', { pos: this.pos });
    }
    if (this.stateT > 1.8) { this.cd.any = rnd(1.5, 2.5); this._go('fly'); }
  }

  _startDive() { this._go('dive'); this.attacking = true; this.cd.dive = 11 + rnd(0, 2); this.cd.any = 0.5; }
  _dive(dt) {
    const pl = this.target, sp = this.sp, fx = this.game.fx;
    this.attacking = true;
    if (this.sub === '') {
      const ty = Math.max(pl.pos.y, this.floorAt(pl.pos.x, pl.pos.z, pl.pos.y + 14)) + 17;
      this.facePlayer(dt, 6); this.setAnim('fly', 1);
      this.steer(pl.pos.x + Math.cos(this.orbitA) * 5, ty, pl.pos.z + Math.sin(this.orbitA) * 5, 18 * sp, 30);
      if (Math.abs(this.pos.y - ty) < 2 || this.stateT > 1.8) { this.sub = 'lock'; this.stateT = 0; this.target3.copy(pl.pos); this.game.audio?.play?.('boss_roar', { pitch: 1.4, volume: 0.6 }); }
    } else if (this.sub === 'lock') {
      const total = 1.25 / sp;
      this.windup = Math.max(0, total - this.stateT) + 0.5;
      this.setAnim('charge', 0.8); this.facePlayer(dt, 6);
      this.steer(this.target3.x, this.pos.y, this.target3.z, 8, 20);
      if (this.stateT < total - 0.3) this.target3.copy(pl.pos);
      if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.ring(this.target3.x, this.target3.y, this.target3.z, 6, 0xff2020, 0.35);
      _a.set(this.target3.x, this.target3.y + 0.2, this.target3.z);
      fx.beam(this.center, _a, 0xff4020, 0.06, 0.06);
      if (this.stateT >= total) { this.sub = 'drop'; this.stateT = 0; this.windup = 0.4; this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.5 }); }
    } else {
      this.setAnim('charge', 1.4);
      _d.set(this.target3.x - this.pos.x, this.target3.y + 0.8 - this.pos.y, this.target3.z - this.pos.z);
      const dist = _d.length(); _d.normalize();
      this.fw.copy(_d).multiplyScalar(42); this.flyAccel = 160;
      this.faceYawTo(Math.atan2(_d.x, _d.z), dt, 10);
      fx.trailPuff(this.pos.x, this.pos.y + 0.5, this.pos.z, 0xa6ff3c, 0.9, 0.3, 0.05);
      if (dist < 2.4 || this.onGround || this.stateT > 2.2) this._crash();
    }
  }

  _crash() {
    const g = this.game;
    const gy = this.floorAt(this.pos.x, this.pos.z, this.pos.y);
    _o.set(this.pos.x, Math.max(gy, this.pos.y - 1) + 0.4, this.pos.z);
    g.combat.explode(_o.clone(), 6, 24, { team: 'enemy', source: this, color: ORANGE, knockback: 16, up: 9, stun: 0.8 });
    g.fx.shockwave(_o.setY(this.pos.y + 0.1), 9, 0xa6ff3c);
    g.cam.shake(0.9); g.input?.rumble?.(0.8, 0.5, 220);
    this.spawnLooseGlider(); this.model.fx.glider = 0;
    this.flying = false; this.gravity = 28; this.vel.set(0, 0, 0);
    this.windup = 0; this.attacking = false; this.airDmg = 0;
    this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.8, this.pos.z), 'GLIDER DOWN!', 0xa6ff3c, { size: 1.7, life: 1.6 });
    this.groundT = Math.max(4.4, 5.4 - 0.5 * (this.phase - 1));
    this.dived++;
    this._go('ground'); this.stateT = 0; this.swings = 0; this.cd.gb = 2.5;
  }

  _fall(dt) {
    this.setAnim('fall', 1); this.hold();
    this.facePlayer(dt, 3);
    if (this.onGround && this.stateT > 0.15) {
      const g = this.game;
      g.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 5, 0xa6ff3c);
      g.combat.aoe({ center: _o.set(this.pos.x, this.pos.y + 0.3, this.pos.z), radius: 3.2, damage: 8, knockback: 10, up: 4, team: 'enemy', source: this });
      g.cam.shake(0.45);
      this.groundT = Math.max(4.4, 5.4 - 0.5 * (this.phase - 1));
      this._go('ground'); this.swings = 0; this.cd.gb = 2.5;
    } else if (this.stateT > 4) { this.groundT = 4.4; this._go('ground'); }
  }

  _ground(dt) {
    const pl = this.target, sp = this.sp, d = this.dist;
    this.cd.gb -= 0;
    if (this.stagger > 0) { this.stagger -= dt; this.setAnim('stunned', 1); this.windup = 0; return; }
    if (this.stateT < 1.3) { this.setAnim('stunned', 0.8); this.windup = 0; this.attacking = false; return; }
    switch (this.sub) {
      case '': {
        this.attacking = false; this.windup = 0;
        this.facePlayer(dt, 8);
        if (this.stateT > this.groundT) { this._go('remount'); return; }
        if (d > 7 && this.cd.gb <= 0) { this.sub = 'throw'; this._t = 0; break; }
        if (d > 2.7) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * 1.2 * sp); this.setAnim('run', 1.1); }
        else { this.sub = 'wind'; this._t = 0; this.swings = 0; }
        break;
      }
      case 'wind': {
        const total = (this.swings === 0 ? 0.6 : 0.42) / sp;
        this._t += dt; this.attacking = true;
        this.windup = Math.max(0, total - this._t);
        this.facePlayer(dt, this.windup > 0.15 ? 9 : 0);
        this.setAnim(this.swings ? 'punch2' : 'punch1', 1);
        if (this._t <= dt) this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 3.4, 0xa6ff3c, total);
        if (this._t >= total) {
          this.windup = 0; this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
          this.vel.x += _f.x * 5; this.vel.z += _f.z * 5;
          this.game.combat.melee({ origin: _o, forward: _f, range: 3.3, arc: 130, damage: this.swings ? 16 : 12, knockback: this.swings ? 12 : 7, up: this.swings ? 4 : 1.5, team: 'enemy', source: this });
          this.game.audio?.play?.('punch', { pos: this.pos });
          this.swings++; this._t = 0; this.sub = this.swings >= 2 ? 'rec' : 'follow';
        }
        break;
      }
      case 'follow': this.windup = 0; this._t += dt; this.setAnim('punch2', 0.6); this.facePlayer(dt, 6); if (this._t > 0.2) { this.sub = 'wind'; this._t = 0; } break;
      case 'rec': this.windup = 0; this.attacking = false; this._t += dt; this.setAnim('idle', 1); this.facePlayer(dt, 3); if (this._t > 0.9 / sp) { this.sub = ''; } break;
      case 'throw': {
        const total = 0.8 / sp;
        this._t += dt; this.attacking = true; this.windup = Math.max(0, total - this._t); this.facePlayer(dt, 8); this.setAnim('throw', sp);
        if (this._t >= total) {
          this.muzzle(_a); _b.set(pl.pos.x + pl.vel.x * 0.5, pl.pos.y, pl.pos.z + pl.vel.z * 0.5);
          this.throwBomb(_a, _b, clamp(Math.hypot(_b.x - _a.x, _b.z - _a.z) / 14, 0.9, 1.5), { radius: 3.2, damage: 13 });
          this.cd.gb = 3.5; this.attacking = false; this.windup = 0; this.sub = 'rec'; this._t = 0;
        }
        break;
      }
      default: this.sub = '';
    }
  }

  _remount(dt) {
    this.hold(); this.setAnim('cast', 1); this.facePlayer(dt, 4);
    this.attacking = false; this.windup = 0;
    if (this.stateT <= dt) { this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 1.2 }); this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 0.2, this.pos.z), 0xa6ff3c, 18, 5, 0.5, 0.3); }
    if (this.stateT > 0.8) {
      this.flying = true; this.gravity = 0; this.vel.y = 6; this.airDmg = 0;
      this.cd.any = 1.6; this.cd.dive = Math.max(this.cd.dive, 8);
      this._go('fly');
    }
  }

  _startPhase() {
    this.phase = this.pendingPhase; this._go('phase'); this.attacking = true;
    this.game.audio?.play?.('boss_roar'); this.game.cam.shake(0.8);
    if (this.phase === 2) this.game.hud?.toast?.('GREEN GOBLIN: "Let\'s make this fun!"');
    else {
      this.game.hud?.toast?.('SYMBIOTE GOBLIN!');
      this.model.setVariant?.('symbiote'); this.bossTitle = 'SYMBIOTE GOBLIN';
      this.game.fx.burst(this.center, PURPLE, 30, 8, 0.7, 0.4);
    }
  }
  _phase(dt) {
    this.hold(); this.setAnim('cast', 1); this.facePlayer(dt, 4);
    if (this.sub === '' && this.stateT > 0.8) {
      this.sub = 'wave';
      _o.set(this.pos.x, this.pos.y, this.pos.z);
      this.game.fx.shockwave(_o, 12, this.phase === 3 ? PURPLE : 0xa6ff3c);
      this.game.combat.aoe({ center: _o, radius: 9, damage: 8, knockback: 14, up: 4, team: 'enemy', source: this });
      if (this.liveMinions('goblin_drone') < 2) this.cd.drones = 0;
    }
    if (this.stateT > 1.8) { this.attacking = false; this.cd.any = 1.0; this._go('fly'); }
  }

  onDeathExtra() { this.spawnLooseGlider(); this.model.fx.glider = 0; }
}

// ---------------------------------------------------------------------- goblin drone
export class GoblinDrone extends FlyerB {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'goblin_drone', modelId: 'goblin_drone', name: 'Goblin Drone', hp: 45, radius: 0.5, height: 1.0, speed: 7, mass: 1.5, gravity: 0 });
    this.flying = true; this.flyAccel = 12;
    this.a = rnd(0, 6.28); this.dir = Math.random() < 0.5 ? -1 : 1;
    this.atk = rnd(1.5, 3); this.hover = rnd(2.4, 3.6); this.R = rnd(7, 10);
  }
  onInterrupt() { this.sub = ''; this.atk = Math.max(this.atk, 1); }
  ai(dt) {
    const pl = this.target;
    if (!pl) { this.hold(); return; }
    this.a += this.dir * dt * 0.6;
    const tx = pl.pos.x + Math.cos(this.a) * this.R, tz = pl.pos.z + Math.sin(this.a) * this.R;
    const ty = Math.max(pl.pos.y, this.floorAt(tx, tz, pl.pos.y + 6)) + this.hover;
    this.steer(tx, ty, tz, this.speed, 12);
    this.facePlayer(dt, 6);
    this.setAnim('idle', 1);
    this.atk -= dt;
    if (this.sub === '' && this.atk <= 0 && this.dist < 26 && this.hasLOS && this.manager.requestToken(this, 'ranged')) { this.sub = 'wind'; this._t = 0; this.attacking = true; }
    if (this.sub === 'wind') {
      this._t += dt; this.windup = Math.max(0, 0.65 - this._t);
      if (this._t >= 0.65) {
        this.windup = 0; this.attacking = false;
        _a.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
        const T = Math.hypot(pl.center.x - _a.x, pl.center.z - _a.z) / 24;
        _b.set(pl.center.x + pl.vel.x * T * 0.6 - _a.x, pl.center.y - _a.y, pl.center.z + pl.vel.z * T * 0.6 - _a.z);
        this.game.combat.projectile({ pos: _a, vel: _b.normalize().multiplyScalar(24).clone(), damage: 6, kind: 'repulsor', color: 0xa6ff3c, size: 0.24, radius: 0.35, life: 2.6, team: 'enemy', source: this });
        this.game.audio?.play?.('hunter_shot', { pos: this.pos });
        this.manager.releaseToken(this); this.sub = ''; this.atk = rnd(2.2, 3.6);
      }
    }
  }
  onDeath() {
    this.flying = false; this.gravity = 28;
    this.game.fx.explosion(this.center, 1.8, 0xa6ff3c);
    this.game.audio?.play?.('explosion', { pos: this.pos, volume: 0.5 });
  }
}

registerEnemy('goblin', GreenGoblin);
registerEnemy('goblin_drone', GoblinDrone);
