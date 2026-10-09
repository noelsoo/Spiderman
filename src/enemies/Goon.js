// SymbioteGoon: melee brawler. chase -> circle -> (token) -> engage -> telegraphed windup -> strike -> recover. Occasional lunge.
import * as THREE from 'three';
import { Enemy, rnd } from './Enemy.js';

const _o = new THREE.Vector3();
const _f = new THREE.Vector3();

export class SymbioteGoon extends Enemy {
  constructor(game, manager, wave = 1) {
    const sc = rnd(0.95, 1.08);
    super(game, manager, { kind: 'goon', modelId: 'goon', hp: Math.round(60 * (1 + 0.1 * (wave - 1))), radius: 0.45, height: 1.85 * sc, speed: 5.2 + wave * 0.35 + rnd(-0.4, 0.4), mass: 1 });
    this.wave = wave;
    this.dmg = 8 * (1 + 0.08 * (wave - 1));
    this.atkCd = rnd(0.8, 2.5);
    this.circleDir = Math.random() < 0.5 ? -1 : 1;
    this.circleT = rnd(1, 3);
    this.sub = '';           // sub-state within attack
    this.kind2 = 'punch';    // current attack type
    this.hitsLeft = 1;
    this.lungeHit = false;
  }

  onInterrupt() {
    if (this.state !== 'chase') { this.state = 'chase'; this.stateT = 0; }
    this.atkCd = Math.max(this.atkCd, rnd(0.6, 1.2));
  }

  _go(s) { this.state = s; this.stateT = 0; }

  ai(dt) {
    const m = this.manager;
    if (!this.target) { this.setAnim('idle', 1); return; }
    const d = this.dist;
    this.atkCd -= dt;
    const spd = this.speed;

    switch (this.state) {
      case 'chase': {
        this.facePlayer(dt, 8);
        if (d > 55) { this.moveToward(this.target.pos.x, this.target.pos.z, spd * 1.8); this.setAnim('run', 1.4); break; }
        const wantAttack = this.atkCd <= 0 && d < 9 && this.hasLOS;
        if (wantAttack && m.requestToken(this, 'melee')) {
          this.kind2 = d > 4.5 && d < 9 && Math.random() < 0.35 ? 'lunge' : (Math.random() < 0.3 ? 'kick' : 'punch');
          this.hitsLeft = this.kind2 === 'punch' && this.wave >= 2 && Math.random() < 0.4 ? 2 : 1;
          this._go(this.kind2 === 'lunge' ? 'windup' : 'engage');
          break;
        }
        // keep a ring around the player; close in when far
        const want = 4.2;
        if (d > want + 2.5) { this.moveToward(this.target.pos.x, this.target.pos.z, spd); this.setAnim('run', spd / 5); }
        else {
          this.circleT -= dt;
          if (this.circleT <= 0) { this.circleDir = -this.circleDir; this.circleT = rnd(1.5, 3.5); }
          this.strafe(this.circleDir, spd * 0.55);
          // drift to ring distance
          const rad = d > want ? 1 : -1;
          this.wish.x += (this.dx / (d || 1)) * rad * spd * 0.35; this.wish.z += (this.dz / (d || 1)) * rad * spd * 0.35;
          this.setAnim('run', 0.7);
        }
        break;
      }
      case 'engage': {
        this.facePlayer(dt, 10);
        if (d > 1.9 && this.stateT < 1.6) { this.moveToward(this.target.pos.x, this.target.pos.z, spd * 1.5); this.setAnim('run', 1.4); }
        else this._go('windup');
        break;
      }
      case 'windup': {
        const total = this.kind2 === 'lunge' ? 0.8 : this.kind2 === 'kick' ? 0.7 : 0.55;
        if (!this.attacking) {
          this.attacking = true;
          this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z), '!', 0xff3030, { life: 0.5, size: 0.8, rise: 1 });
        }
        this.windup = Math.max(0, total - this.stateT);
        this.facePlayer(dt, this.windup > 0.15 ? 9 : 0);
        this.setAnim(this.kind2 === 'lunge' ? 'charge' : this.kind2 === 'kick' ? 'kick' : 'punch1', 1);
        if (this.stateT >= total) {
          this.windup = 0;
          if (this.kind2 === 'lunge') { this._go('lunge'); this.lungeHit = false; this.game.audio?.play?.('whoosh', { pos: this.pos }); }
          else this._strike();
        }
        break;
      }
      case 'lunge': {
        this.forward(_f);
        this.wish.set(_f.x * 15, 0, _f.z * 15);
        this.vel.x = this.wish.x; this.vel.z = this.wish.z;
        this.setAnim('punch2', 1.3);
        if (!this.lungeHit && this.stateT > 0.08) {
          _o.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
          const hit = this.game.combat.melee({ origin: _o, forward: _f, range: 1.9, arc: 120, damage: this.dmg * 1.3, knockback: 8, up: 3, team: 'enemy', source: this });
          if (hit.length) this.lungeHit = true;
        }
        if (this.stateT > 0.38 || this.lungeHit) { this.vel.x *= 0.2; this.vel.z *= 0.2; this._recover(0.9); }
        break;
      }
      case 'strike': {
        // short pause between combo hits
        this.facePlayer(dt, 10);
        this.setAnim('punch2', 1);
        if (this.stateT > 0.25) { this.kind2 = 'punch'; this._go('windup2'); }
        break;
      }
      case 'windup2': {
        const total = 0.4;
        this.windup = Math.max(0, total - this.stateT);
        this.facePlayer(dt, 8);
        this.setAnim('punch2', 1);
        if (this.stateT >= total) { this.windup = 0; this._strike(true); }
        break;
      }
      case 'recover': {
        this.windup = 0;
        this.setAnim('idle', 1);
        this.facePlayer(dt, 4);
        if (this.stateT > this.recoverT) { this.atkCd = rnd(1.2, 2.6) - Math.min(0.6, this.wave * 0.12); this._go('chase'); }
        break;
      }
      default: this._go('chase');
    }
  }

  _recover(t) { this.recoverT = t; this.attacking = false; this.manager.releaseToken(this); this._go('recover'); }

  _strike(second = false) {
    this.forward(_f);
    _o.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    const kick = this.kind2 === 'kick';
    this.game.audio?.play?.('whoosh', { pos: this.pos });
    this.game.combat.melee({ origin: _o, forward: _f, range: 2.3, arc: 110, damage: this.dmg * (kick ? 1.3 : 1), knockback: kick ? 9 : 6, up: kick ? 3 : 1.5, team: 'enemy', source: this });
    this.hitsLeft--;
    if (this.hitsLeft > 0 && !second) { this._go('strike'); this.windup = 0; return; }
    this._recover(kick ? 0.9 : 0.7);
  }
}
