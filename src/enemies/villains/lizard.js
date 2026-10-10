// THE LIZARD boss (~3 m, 3400 hp) + LIZARDMAN minion (1.9 m, fast, leaps).
//   attacks : claw combo, tail sweep (360 deg, JUMP or dodge it), leaping slam, acid spit (leaves goo puddles),
//             burrow -> telegraphed eruption under the player, calls lizardmen
//   fairness: after each eruption he is stuck EXPOSED for 3.6 s; every 3 attacks 3.4 s exposed; poise stagger; all attacks telegraphed
import * as THREE from 'three';
import { registerEnemy } from '../index.js';
import { Enemy, rnd, clamp } from '../Enemy.js';
import { VillainBoss } from './a_boss.js';
import '../../models/villains_a.js';

const V3 = THREE.Vector3;
const _o = new V3(), _f = new V3(), _a = new V3(), _b = new V3(), _d = new V3();
const GREEN = 0x5fe040, RED = 0xff2040;

let AG = null;
function acidAssets() {
  if (AG) return AG;
  AG = { geo: new THREE.SphereGeometry(1, 10, 8), mat: new THREE.MeshBasicMaterial({ color: 0x7dff30, toneMapped: false }) };
  return AG;
}
function acidMesh(size) { const A = acidAssets(); const m = new THREE.Mesh(A.geo, A.mat); m.scale.setScalar(size); return m; }

export class Lizard extends VillainBoss {
  constructor(game, manager, opts = {}) {
    super(game, manager, { kind: 'lizard', modelId: 'lizard', name: 'THE LIZARD', title: 'THE LIZARD', hp: 3400, radius: 1.1, height: 3.0, speed: 7.2, mass: 14, accent: GREEN, poise: 459 });
    this.cd = { any: 2, tail: 5, leap: 7, spit: 3, burrow: 11, call: 8 };
    this.engage = 3.8;
    this.swings = 0; this.swingMax = 3;
    this.tailPose = 0;
    this.leapR = 6.5;
    this.callsPhase = 0; this.forceCall = false;
    this.unstaggerable.add('burrow'); this.unstaggerable.add('under'); this.unstaggerable.add('lock');
    this.lockPos = new V3();
    this.exposeLen = 3.4;
    this.sweeps = 0;
  }
  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.12 : 1.3; }
  phaseToast(p) { return p === 2 ? 'THE LIZARD is losing control!' : 'THE LIZARD: SYMBIOTE FRENZY!'; }
  onPhaseStart(p) {
    this.callsPhase = 0; this.forceCall = true;
    if (p === 3) this.model.setTint?.(0x6020a0, 0.2);
  }

  pickAttack(d) {
    const c = this.cd, ph = this.phase, o = [];
    if (this.forceCall && this.minionsAlive() < 3) { this.forceCall = false; return 'call'; }
    if (c.call <= 0 && this.callsPhase < 2 && this.minionsAlive() === 0 && ph >= 1 && (this.callsPhase < 1 || ph >= 2)) o.push(['call', 3]);
    if (d < 5.5) { o.push(['claws', 7]); if (c.tail <= 0) o.push(['tail', 7]); }
    else if (d < 11) o.push(['claws', 2]);
    if (d > 6 && c.leap <= 0) o.push(['leap', 5]);
    if (d > 7 && d < 26 && c.spit <= 0 && this.hasLOS) o.push(['spit', 5]);
    if (d > 4 && c.burrow <= 0) o.push(['burrow', ph >= 2 ? 6 : 4]);
    if (c.tail <= 0 && d < 8) o.push(['tail', 3]);
    return this.pick(o);
  }
  onPick(p) { if (p === 'claws') { this.swings = 0; this.swingMax = this.phase === 1 ? 3 : 4; this.sub = 'approach'; } if (p === 'tail') this.sweeps = 0; }

  // ------------------------------------------------------------------ claws
  st_claws(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    if (this.sub === 'approach') {
      this.facePlayer(dt, 8); this.setAnim('run', 1.2 * sp);
      if (this.dist > 3.9 && this.stateT < 2.2) this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * 1.6);
      else { this.sub = 'wind'; this.stateT = 0; this.attacking = false; }
      return;
    }
    const last = this.swings >= this.swingMax - 1;
    const total = (last ? 1.0 : 0.62) / sp;
    if (this.sub === 'wind') {
      if (!this.attacking) { this.attacking = true; g.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), last ? 6 : 4.8, RED, total); g.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.7 }); }
      this.windup = Math.max(0, total - this.stateT);
      this.facePlayer(dt, this.windup > 0.2 ? 7 : 0);
      this.setAnim(last ? 'smash' : (this.swings % 2 ? 'punch2' : 'punch1'), sp);
      if (this.stateT >= total) {
        this.windup = 0; this.forward(_f);
        this.vel.x += _f.x * 7; this.vel.z += _f.z * 7;
        this.strike(last ? 5.2 : 4.6, last ? 150 : 120, last ? 24 : 14, last ? 15 : 8, last ? 6 : 2, 1.6);
        if (last) { g.fx.shockwave(_o.set(this.pos.x + _f.x * 2.6, this.pos.y + 0.1, this.pos.z + _f.z * 2.6), 5, GREEN); g.cam.shake(0.45); g.audio?.play?.('smash', { pos: this.pos }); }
        else g.audio?.play?.('punch', { pos: this.pos });
        this.swings++; this.sub = 'follow'; this.stateT = 0;
      }
    } else if (this.sub === 'follow') {
      this.windup = 0; this.attacking = false;
      this.setAnim(this.swings % 2 ? 'punch2' : 'punch1', sp * 0.6); this.facePlayer(dt, 5);
      if (this.stateT > 0.25 / sp) {
        if (this.swings >= this.swingMax) { this.cd.any = rnd(1.1, 2.0) / sp; this.rest(1.3); }
        else { this.sub = 'wind'; this.stateT = 0; this.attacking = false; }
      }
    }
  }

  // ------------------------------------------------------------------ tail sweep
  st_tail(dt) {
    const sp = this.sp, g = this.game, R = 5.6;
    this.wish.set(0, 0, 0); this.attacking = true;
    const total = (this.sweeps === 0 ? 1.05 : 0.6) / sp;
    if (this.sub === '') this.sub = 'wind';
    if (this.sub === 'wind') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('charge', 0.4); this.tailPose = -Math.min(1, this.stateT / 0.5) * 0.9;
      this.facePlayer(dt, this.windup > 0.3 ? 5 : 0);
      if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) g.fx.ring(_o.set(this.pos.x, this.pos.y + 0.12, this.pos.z), R, RED, 0.22);
      if (this.stateT >= total) { this.sub = 'spin'; this.stateT = 0; this.spinHit = false; this.yaw0 = this.yaw; g.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.5 }); }
    } else if (this.sub === 'spin') {
      const T = 0.5;
      this.windup = 0;
      this.setAnim('smash', 0.2);
      this.yaw += (Math.PI * 2 / T) * dt;
      this.tailPose = -0.9 + 1.9 * Math.min(1, this.stateT / T);
      g.fx.trailPuff(this.pos.x + Math.sin(this.yaw + 3.14) * 3.2, this.pos.y + 0.6, this.pos.z + Math.cos(this.yaw + 3.14) * 3.2, GREEN, 1.2, 0.3, 0.1);
      if (!this.spinHit && this.stateT > 0.12) {
        this.spinHit = true;
        _o.set(this.pos.x, this.pos.y, this.pos.z);
        const hit = this.groundBlast(_o, R, this.phase === 3 ? 26 : 22, 16, 7, 0.7);
        g.fx.shockwave(_o.setY(this.pos.y + 0.1), R + 1, GREEN); g.fx.dust(_o, 14, R * 0.8);
        g.cam.shake(hit ? 0.6 : 0.3); g.audio?.play?.('smash', { pos: this.pos });
        if (!hit && this.target && this.target.pos.y > this.pos.y + 0.9 && Math.hypot(this.dx, this.dz) < R) g.fx.text(_o.set(this.target.pos.x, this.target.pos.y + 2.2, this.target.pos.z), 'JUMPED!', 0x60ffa0, { size: 1.2, life: 0.8 });
      }
      if (this.stateT >= T) {
        this.tailPose = 0;
        this.sweeps++;
        if (this.phase === 3 && this.sweeps < 2) { this.sub = 'wind'; this.stateT = 0; }
        else { this.cd.tail = 7.5 - this.phase; this.cd.any = rnd(1, 1.8); this.rest(1.3); }
      }
    }
  }
  recovering() { this.tailPose *= 0.9; }

  // ------------------------------------------------------------------ leaping slam
  st_leap(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.95 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    this.windup = Math.max(0, total - this.stateT) + 0.6;
    this.facePlayer(dt, 6); this.setAnim('charge', 0.6 * sp);
    if (this.stateT < total - 0.25) { this.target3.copy(pl.pos); this.target3.x += pl.vel.x * 0.45; this.target3.z += pl.vel.z * 0.45; }
    if (Math.floor(this.stateT * 5) !== Math.floor((this.stateT - dt) * 5)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), this.leapR, RED, 0.3);
    if (this.stateT >= total) this.leapTo(this.target3, () => this._leapLand(), 3);
  }
  _leapLand() {
    const g = this.game;
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    this.groundBlast(_o, this.leapR, 24, 15, 8, 1.0);
    g.fx.shockwave(_o, 9, GREEN); g.fx.explosion(_o.setY(this.pos.y + 0.5), 3, GREEN);
    g.cam.shake(0.9); g.audio?.play?.('smash', { pos: this.pos }); g.input?.rumble?.(0.8, 0.5, 220);
    this.cd.leap = 9 - this.phase; this.cd.any = rnd(1, 1.8);
    this.rest(1.1);
  }

  // ------------------------------------------------------------------ acid spit
  st_spit(dt) {
    const pl = this.target, sp = this.sp, g = this.game;
    const total = 0.95 / sp;
    this.attacking = true; this.wish.set(0, 0, 0);
    if (this.sub !== 'fired') {
      this.windup = Math.max(0, total - this.stateT);
      this.setAnim('throw', 0.55 * sp); this.facePlayer(dt, this.windup > 0.3 ? 9 : 0);
      this.model.head.getWorldPosition(_a);
      if (Math.random() < 0.7) g.fx.burst(_a, GREEN, 1, 2, 0.3, 0.3);
      if (this.stateT >= total) {
        this.sub = 'fired'; this.windup = 0;
        const n = this.phase === 1 ? 1 : this.phase === 2 ? 3 : 5;
        const T = Math.max(0.35, this.dist / 24);
        _d.set(pl.center.x + pl.vel.x * T * 0.7 - _a.x, pl.center.y + 0.5 * 12 * T * T - _a.y, pl.center.z + pl.vel.z * T * 0.7 - _a.z);
        const yaw0 = Math.atan2(_d.x, _d.z), hl = Math.hypot(_d.x, _d.z);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.17;
          _f.set(Math.sin(yaw0 + off) * hl / T, _d.y / T, Math.cos(yaw0 + off) * hl / T);
          g.combat.projectile({ pos: _a, vel: _f.clone(), damage: 11, kind: 'acid', team: 'enemy', source: this, radius: 0.55, life: 3, gravity: 12, mesh: acidMesh(0.4), color: GREEN,
            onExpire: (p) => {
              p.mesh.parent?.remove(p.mesh);
              if (this.alive) {
                _o.set(p.pos.x, this.groundY(p.pos.x, p.pos.z), p.pos.z);
                this.addZone({ kind: 'dot', pos: _o, r: 2.0, life: 5, armT: 0, color: 0x7dff30, dmg: 4 });
                g.fx.burst(_o.setY(_o.y + 0.3), GREEN, 10, 4, 0.4, 0.25); g.fx.ring(_o, 2.0, GREEN, 0.3);
              }
            } });
        }
        g.audio?.play?.('symbiote', { pos: this.pos });
        this.stateT = 0;
      }
    } else {
      this.windup = 0;
      if (this.stateT > 0.5) { this.cd.spit = 5; this.cd.any = rnd(1, 1.7); this.rest(0.9); }
    }
  }

  // ------------------------------------------------------------------ burrow -> erupt
  st_burrow(dt) {
    const pl = this.target, g = this.game;
    this.attacking = true; this.windup = 0;
    if (this.sub === '') {
      this.setAnim('charge', 0.8); this.wish.set(0, 0, 0);
      if (this.stateT === dt) g.audio?.play?.('smash', { pos: this.pos, pitch: 1.4 });
      g.fx.dust(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 4, 2.5);
      if (this.stateT > 0.6) {
        this.sub = 'under'; this.stateT = 0; this.root.visible = false; this.untargetable = true;
        g.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 6, 0x8a7050); g.cam.shake(0.4);
        this.manager.releaseToken(this);
      }
    } else if (this.sub === 'under') {
      // travel underground toward the player: a dust trail shows where he is
      this.moveToward(pl.pos.x, pl.pos.z, 11 * this.sp);
      if (Math.floor(this.stateT * 10) !== Math.floor((this.stateT - dt) * 10)) { g.fx.dust(_o.set(this.pos.x, this.pos.y + 0.15, this.pos.z), 5, 1.6); g.fx.ring(_o, 1.6, 0x8a7050, 0.25); }
      if (this.stateT > 1.5 || this.dist < 3) { this.sub = 'lock'; this.stateT = 0; this.wish.set(0, 0, 0); this.lockPos.copy(pl.pos); }
    } else if (this.sub === 'lock') {
      // eruption point is fixed: dodge out of the ring
      const total = 1.0;
      this.wish.set(0, 0, 0);
      this.windup = Math.max(0, total - this.stateT);
      if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) { g.fx.ring(_o.set(this.lockPos.x, this.lockPos.y + 0.15, this.lockPos.z), 4.6, RED, 0.2); g.fx.dust(_o, 4, 3); }
      if (this.stateT >= total) this._erupt();
    }
  }
  _erupt() {
    const g = this.game;
    this.windup = 0;
    this.pos.set(this.lockPos.x, this.groundY(this.lockPos.x, this.lockPos.z), this.lockPos.z);
    this.vel.set(0, 0, 0);
    this.root.visible = true; this.untargetable = false;
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    this.groundBlast(_o, 4.6, 24, 14, 10, 1.2);
    g.fx.shockwave(_o, 10, 0x8a7050); g.fx.explosion(_o.setY(this.pos.y + 0.6), 3.5, GREEN); g.fx.dust(_o, 20, 5);
    g.cam.shake(0.9); g.audio?.play?.('smash', { pos: this.pos }); g.input?.rumble?.(0.9, 0.5, 250);
    this.cd.burrow = this.phase === 3 ? 10 : 15; this.cd.any = 1.0;
    this.expose(3.6);
  }

  // ------------------------------------------------------------------ call lizardmen
  st_call(dt) {
    this.attacking = true; this.windup = 0; this.wish.set(0, 0, 0);
    this.setAnim('cast', 0.9); this.facePlayer(dt, 4);
    if (this.stateT < dt * 1.5) { this.game.audio?.play?.('boss_roar', { pitch: 1.1, volume: 0.6 }); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 10, GREEN); this.game.cam.shake(0.4); }
    if (this.stateT > 1.1 && this.sub !== 'done') { this.sub = 'done'; this.callMinions('lizardman', this.phase === 3 ? 3 : 2); this.callsPhase++; this.cd.call = 28; }
    if (this.stateT > 1.8) { this.cd.any = rnd(1, 1.6); this.rest(0.5); }
  }

  onDied() { this.tailPose = 0; }
}

// ======================================================================= LIZARDMAN (minion)
export class Lizardman extends Enemy {
  constructor(game, manager, opts = {}) {
    const wave = opts.wave ?? 1;
    super(game, manager, { kind: 'lizardman', modelId: 'lizardman', name: 'Lizardman', hp: Math.round(150 * (1 + 0.08 * (wave - 1))), radius: 0.55, height: 1.9, speed: 8.4, mass: 1.6 });
    this.dmg = 9 * (1 + 0.05 * (wave - 1));
    this.state = 'chase'; this.swings = 0; this.leapCd = rnd(2, 4); this.target3 = new V3();
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rnd(1, 2);
    this.isMinion = true;
  }
  _go(s) { this.state = s; this.stateT = 0; }
  onInterrupt() { if (this.state !== 'chase') this._go('chase'); this.ballistic = false; }
  ai(dt) {
    const pl = this.target, m = this.manager;
    this.leapCd -= dt;
    if (!pl) { this.setAnim('idle', 1); return; }
    const d = this.dist;
    switch (this.state) {
      case 'chase': {
        this.attacking = false; this.windup = 0;
        this.facePlayer(dt, 9);
        if (d > 2.6) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * (d > 14 ? 1.3 : 1)); this.setAnim('run', 1.3); }
        else { this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = rnd(1, 2); } this.strafe(this.strafeDir, 3); this.setAnim('run', 0.8); }
        if (d > 6 && d < 13 && this.leapCd <= 0 && this.hasLOS && m.requestToken(this, 'melee')) { this._go('leapWind'); this.target3.copy(pl.pos); }
        else if (d < 3.1 && m.requestToken(this, 'melee')) { this._go('claw'); this.swings = 0; }
        break;
      }
      case 'claw': {
        const total = 0.5;
        this.attacking = true; this.windup = Math.max(0, total - this.stateT);
        this.facePlayer(dt, this.windup > 0.15 ? 10 : 0);
        this.setAnim(this.swings ? 'punch2' : 'punch1', 1.1);
        if (this.stateT >= total) {
          this.forward(_f); _o.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
          this.vel.x += _f.x * 4; this.vel.z += _f.z * 4;
          this.game.combat.melee({ origin: _o, forward: _f, range: 2.7, arc: 110, damage: this.dmg, knockback: 6, up: 1.5, team: 'enemy', source: this });
          this.swings++;
          if (this.swings >= 2) { this.attacking = false; this.manager.releaseToken(this); this._go('recover'); } else this.stateT = 0;
        }
        break;
      }
      case 'recover': this.windup = 0; this.attacking = false; this.setAnim('idle', 1); this.facePlayer(dt, 4); if (this.stateT > 0.8) this._go('chase'); break;
      case 'leapWind': {
        const total = 0.65;
        this.attacking = true; this.windup = Math.max(0, total - this.stateT) + 0.4;
        this.facePlayer(dt, 9); this.setAnim('charge', 0.6);
        if (this.stateT < total - 0.2) this.target3.copy(pl.pos);
        if (this.stateT === dt || Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.12, this.target3.z), 2.2, RED, 0.2);
        if (this.stateT >= total) {
          const dx = this.target3.x - this.pos.x, dz = this.target3.z - this.pos.z, T = clamp(Math.hypot(dx, dz) / 14, 0.5, 0.9);
          this.vel.set(dx / T, 0.5 * this.gravity * T, dz / T); this.onGround = false; this.ballistic = true; this._go('air');
        }
        break;
      }
      case 'air': {
        this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', 1);
        if (this.stateT > 0.2 && this.onGround || this.stateT > 2) {
          this.ballistic = false; this.attacking = false;
          _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
          this.game.combat.aoe({ center: _o, radius: 2.4, damage: this.dmg * 1.4, knockback: 8, up: 4, team: 'enemy', source: this });
          this.game.fx.dust(_o, 8, 2);
          this.leapCd = rnd(4, 7); this.manager.releaseToken(this); this._go('recover');
        }
        break;
      }
      default: this._go('chase');
    }
  }
}

registerEnemy('lizard', Lizard);
registerEnemy('lizardman', Lizardman);
