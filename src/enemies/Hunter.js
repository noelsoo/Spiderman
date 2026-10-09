// KravenHunter: ranged rifleman. Keeps distance, strafes, sometimes ducks behind cover, laser-sight telegraph (0.8 s) then a bullet.
import * as THREE from 'three';
import { Enemy, rnd } from './Enemy.js';

const _m = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class KravenHunter extends Enemy {
  constructor(game, manager, wave = 1, rooftop = false) {
    super(game, manager, { kind: 'hunter', modelId: 'hunter', hp: Math.round(80 * (1 + 0.1 * (wave - 1))), radius: 0.45, height: 1.85, speed: 4.8, mass: 1.1 });
    this.wave = wave;
    this.rooftop = rooftop;
    this.dmg = 9 * (1 + 0.06 * (wave - 1));
    this.shotCd = rnd(1.5, 3.5);
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = rnd(1, 3);
    this.coverT = rnd(5, 9);
    this.cover = null; this.coverHold = 0;
    this.aimT = 0;
    this.anchor = new THREE.Vector3();
    this.locked = false;
    this.leash = 9;
  }

  spawnAt(pos, yaw) { this.anchor.copy(pos); return super.spawnAt(pos, yaw); }

  onInterrupt() {
    if (this.state === 'aim' || this.state === 'fire') { this.state = 'move'; this.stateT = 0; }
    this.shotCd = Math.max(this.shotCd, 1.2);
  }

  _go(s) { this.state = s; this.stateT = 0; }

  muzzle(out) {
    const mz = this.model.muzzle;
    if (mz) { mz.updateWorldMatrix(true, false); return mz.getWorldPosition(out); }
    out.set(Math.sin(this.yaw) * 0.7 + this.pos.x, this.pos.y + 1.3, Math.cos(this.yaw) * 0.7 + this.pos.z);
    return out;
  }

  /** Don't walk off rooftops: cancel wish components that lead over an edge. */
  _edgeSafe() {
    if (!this.rooftop || (this.wish.x === 0 && this.wish.z === 0)) return;
    const phys = this.game.physics;
    const l = this.wish.length();
    const nx = this.wish.x / l, nz = this.wish.z / l;
    const px = this.pos.x + nx * 1.4, pz = this.pos.z + nz * 1.4;
    if (phys.heightAt(px, pz, this.pos.y + 1.2) < this.pos.y - 1.2) this.wish.set(0, 0, 0);
    else if (Math.hypot(px - this.anchor.x, pz - this.anchor.z) > this.leash) this.wish.set(0, 0, 0);
  }

  ai(dt) {
    const m = this.manager;
    if (!this.target) { this.setAnim('idle', 1); return; }
    const d = this.dist;
    this.shotCd -= dt;
    const pl = this.target;

    switch (this.state) {
      case 'move': {
        this.facePlayer(dt, 7);
        if (d > 70) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * 1.8); this.setAnim('run', 1.3); break; }
        // periodically consider ducking behind cover
        this.coverT -= dt;
        if (this.coverT <= 0 && !this.rooftop) { this.coverT = rnd(7, 12); this._findCover(); }
        if (this.cover) {
          const cd = this.moveToward(this.cover.x, this.cover.z, this.speed * 1.2);
          this.setAnim('run', 1.1);
          if (cd < 0.8) { this.wish.set(0, 0, 0); this.coverHold -= dt; this.setAnim('idle', 1); if (this.coverHold <= 0) this.cover = null; }
          else if (this.stateT > 6) this.cover = null;
          this._edgeSafe();
          break;
        }
        const lo = this.rooftop ? 10 : 11, hi = this.rooftop ? 40 : 18;
        if (!this.hasLOS && !this.rooftop) {
          this.moveToward(pl.pos.x, pl.pos.z, this.speed); this.setAnim('run', 1);
        } else if (d < lo - 3) {
          // back away
          this.wish.set(-this.dx / d * this.speed, 0, -this.dz / d * this.speed); this.setAnim('run', -1);
          if (d < 2.6 && this.shotCd > 0.4) { this.shotCd = 0.4; }
        } else if (d > hi) {
          this.moveToward(pl.pos.x, pl.pos.z, this.speed); this.setAnim('run', 1);
        } else {
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeDir = -this.strafeDir; this.strafeT = rnd(1.2, 3); }
          this.strafe(this.strafeDir, this.speed * 0.5); this.setAnim('run', 0.6);
        }
        this._edgeSafe();
        if (this.shotCd <= 0 && this.hasLOS && d < (this.rooftop ? 55 : 35) && m.requestToken(this, 'ranged')) {
          this._go('aim'); this.aimT = 0; this.locked = false;
        }
        break;
      }
      case 'aim': {
        const total = 0.8;
        this.attacking = true;
        this.windup = Math.max(0, total - this.stateT);
        this.setAnim('shoot', 0.3);
        // track the player until the last 0.3 s, then lock the aim point (so a dodge works)
        if (this.windup > 0.3) {
          _aim.copy(pl.center);
          _aim.x += pl.vel.x * 0.12; _aim.z += pl.vel.z * 0.12; _aim.y += pl.vel.y * 0.05;
          this.facePlayer(dt, 12);
          this.aimPoint = this.aimPoint || new THREE.Vector3();
          this.aimPoint.copy(_aim);
        }
        this.muzzle(_a);
        const ap = this.aimPoint ?? pl.center;
        // laser line (extends slightly past the target)
        _b.subVectors(ap, _a); const l = _b.length() || 1;
        _b.multiplyScalar((l + 4) / l).add(_a);
        const flicker = this.windup < 0.3 ? 0.05 : 0.025;
        this.game.fx.beam(_a, _b, 0xff2020, flicker, 0.06);
        if (this.stateT === dt) this.game.fx.flash(_a, 0xff2020, 0.6, 0.15);
        if (!this.hasLOS && this.stateT > 0.4) { this.attacking = false; this.windup = 0; this.manager.releaseToken(this); this.shotCd = 0.8; this._go('move'); break; }
        if (this.stateT >= total) this._fire();
        break;
      }
      case 'fire': {
        this.windup = 0;
        this.setAnim('shoot', 1.2);
        if (this.stateT > 0.55) { this.shotCd = rnd(1.8, 3.4) - Math.min(0.8, this.wave * 0.2); this._go('move'); }
        break;
      }
      default: this._go('move');
    }
  }

  _fire() {
    const g = this.game;
    this.muzzle(_a);
    const ap = this.aimPoint ?? this.target.center;
    _b.subVectors(ap, _a).normalize();
    _b.x += rnd(-0.015, 0.015); _b.y += rnd(-0.015, 0.015); _b.z += rnd(-0.015, 0.015);
    _b.normalize();
    g.combat.projectile({ pos: _a, vel: _b.clone().multiplyScalar(72), damage: this.dmg, kind: 'bullet', team: 'enemy', source: this, radius: 0.18, life: 2 });
    g.fx.flash(_a, 0xffc060, 1.5, 0.08);
    g.fx.burst(_a, 0xffd080, 5, 5, 0.15, 0.2);
    g.audio?.play?.('hunter_shot', { pos: this.pos });
    this.attacking = false; this.windup = 0; this.aimPoint = null;
    this.manager.releaseToken(this);
    this._go('fire');
  }

  /** Pick a nearby spot hidden from the player. */
  _findCover() {
    const g = this.game, pl = this.target;
    if (!pl) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(5, 11);
      const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      _m.set(x, this.pos.y + 1.4, z);
      if (g.physics.inside(_m)) continue;
      if (!g.physics.lineOfSight(_m, pl.center)) {
        this.cover = this.cover || new THREE.Vector3();
        this.cover.set(x, this.pos.y, z);
        this.coverHold = rnd(1.3, 2.6);
        return;
      }
    }
  }
}
