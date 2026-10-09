// Venom boss. 2.6 m, ~2500 hp. Three phases, poise/stagger windows, big telegraphs.
//   phase 1: claw combos, leap slam (shockwave), tendril grab (pulls the player in)
//   phase 2 (<60% hp): + symbiote goo volleys, summons goons, faster
//   phase 3 (<25% hp): enraged roar, multi-leaps, faster still
import * as THREE from 'three';
import { Enemy, rnd, clamp } from './Enemy.js';

const _o = new THREE.Vector3();
const _f = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const PURPLE = 0x7a2bd0;

export class Venom extends Enemy {
  constructor(game, manager) {
    super(game, manager, { kind: 'venom', modelId: 'venom', name: 'VENOM', hp: 2500, radius: 1.1, height: 2.6, speed: 7.2, mass: 14, isBoss: true, gravity: 30 });
    this.phase = 1; this.pendingPhase = 1;
    this.poise = 0; this.poiseMax = 240;
    this.cd = { leap: 4, tendril: 6, goo: 3, summon: 8, any: 2.2 };
    this.swings = 0; this.swingMax = 3;
    this.leapsLeft = 0;
    this.target3 = new THREE.Vector3();   // leap landing
    this.pullT = 0;
    this.summoned = 0;
    this.roarT = 0;
    this.perch = false;
    this.superArmor = true;
    this.state = 'idle'; this.stateT = 0;
  }

  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.15 : 1.35; }
  _go(s) { this.state = s; this.stateT = 0; }

  /** Start the entrance. perchPos = where he stands (rooftop); he roars then leaps at the player. */
  begin(perched) {
    this.perch = perched;
    this.untargetable = false;
    if (perched) { this._go('perch'); this.invuln = 99; }
    else { this._beginLeapTo(this.target?.pos ?? this.pos, 0, 'air'); this.invuln = 99; }
    this.game.audio?.music?.('boss');
  }

  onInterrupt() {}

  // ----------------------------------------------------------------- damage
  takeDamage(amount, o = {}) {
    if (!this.alive) return 0;
    if (this.state === 'perch' || this.state === 'entrance') return 0;
    if (this.state === 'roar') amount *= 0.25;
    else if (this.state === 'stagger') amount *= 1.3;
    const dealt = super.takeDamage(amount, o);
    if (dealt <= 0) return 0;
    if (!this.alive) return dealt;
    // poise -> stagger
    this.poise += dealt;
    const frac = this.hp / this.maxHp;
    if (this.phase < 2 && frac <= 0.6) this.pendingPhase = 2;
    if (this.phase < 3 && frac <= 0.25) this.pendingPhase = 3;
    const safe = this.state === 'chase' || this.state === 'claw' || this.state === 'recover' || this.state === 'tendril' || this.state === 'goo' || this.state === 'summon';
    if (this.poise >= this.poiseMax * (this.phase === 3 ? 1.3 : 1) && safe && this.pendingPhase === this.phase) {
      this.poise = 0;
      this.attacking = false; this.windup = 0;
      this._go('stagger');
      this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.8, this.pos.z), 'STAGGERED!', 0xffe040, { size: 1.6, life: 1.4 });
      this.game.audio?.play?.('heavyhit', { pos: this.pos });
      this.game.cam.shake(0.3);
    }
    return dealt;
  }

  // ----------------------------------------------------------------- AI
  ai(dt) {
    const pl = this.target;
    for (const k in this.cd) this.cd[k] -= dt;
    this.poise = Math.max(0, this.poise - 12 * dt);
    if (this.pullT > 0 && pl) this._pull(dt);
    if (!pl && this.state !== 'perch') { this.setAnim('idle', 0.8); return; }
    const d = this.dist;
    const sp = this.sp;
    const s = this.state;

    // phase change (only from calm states)
    if (this.pendingPhase !== this.phase && (s === 'chase' || s === 'recover')) { this._startRoar(); return; }

    switch (s) {
      case 'idle': case 'chase': {
        if (s === 'idle') this._go('chase');
        this.facePlayer(dt, 6 * sp);
        this.setAnim('run', 0.9 * sp);
        this.attacking = false; this.windup = 0;
        if (d > 3.4) this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * (d > 14 ? 1.5 : 1)); else this.wish.set(0, 0, 0);
        if (this.cd.any <= 0) this._chooseAttack(d);
        break;
      }
      case 'perch': {
        // standing on a rooftop, roaring, then leaping down at the player
        if (this.stateT === dt) { this.game.audio?.play?.('boss_roar'); this.game.cam.shake(0.6); }
        if (this.target) this.facePlayer(dt, 3);
        this.setAnim('cast', 0.8);
        if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.lightning(_a.copy(this.center), _b.copy(this.center).add(_o.set(rnd(-4, 4), rnd(-1, 3), rnd(-4, 4))), PURPLE, 0.2, 2);
        if (this.stateT > 2.4 && this.target) {
          const pp = this.target.pos;
          _o.set(this.pos.x - pp.x, 0, this.pos.z - pp.z); if (_o.lengthSq() < 1) _o.set(1, 0, 0);
          _o.normalize().multiplyScalar(7).add(pp);
          this._beginLeapTo(_o, 5.5, 'air');
        }
        break;
      }
      case 'claw': this._claw(dt); break;
      case 'leapWind': this._leapWind(dt); break;
      case 'air': this._air(dt); break;
      case 'tendril': this._tendril(dt); break;
      case 'goo': this._goo(dt); break;
      case 'summon': this._summon(dt); break;
      case 'roar': this._roar(dt); break;
      case 'stagger': {
        this.setAnim('stunned', 0.8);
        this.attacking = false; this.windup = 0;
        if (this.stateT > 2.2) { this.cd.any = 0.5; this._go('chase'); }
        break;
      }
      case 'recover': {
        this.attacking = false; this.windup = 0;
        this.setAnim('idle', 0.8);
        this.facePlayer(dt, 3);
        if (this.stateT > this.recoverT) { this._go('chase'); }
        break;
      }
      default: this._go('chase');
    }
  }

  _recover(t) { this.recoverT = t / this.sp; this.attacking = false; this.windup = 0; this._go('recover'); }

  _chooseAttack(d) {
    const ph = this.phase;
    const opts = [];
    if (d < 5.5) opts.push(['claw', 6]);
    else if (d < 12) opts.push(['claw', 3]);
    if (d > 6 && this.cd.leap <= 0) opts.push(['leap', 5]);
    if (d > 6 && d < 22 && this.cd.tendril <= 0 && this.hasLOS) opts.push(['tendril', 4]);
    if (ph >= 2 && d > 7 && this.cd.goo <= 0) opts.push(['goo', 5]);
    if (ph >= 2 && this.cd.summon <= 0 && this.manager.aliveMinions() < 4) opts.push(['summon', 3]);
    if (!opts.length) { this.cd.any = 0.4; return; }
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot, pick = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
    switch (pick) {
      case 'claw':
        this.swings = 0; this.swingMax = ph === 1 ? 3 : 4; this._go('claw'); this.sub = 'approach'; break;
      case 'leap': this.leapsLeft = ph === 3 ? 2 + (Math.random() < 0.5 ? 1 : 0) : 0; this._go('leapWind'); this.cd.leap = 8 - ph; break;
      case 'tendril': this._go('tendril'); this.cd.tendril = 9; break;
      case 'goo': this._go('goo'); this.cd.goo = ph === 3 ? 5 : 7; break;
      case 'summon': this._go('summon'); this.cd.summon = 26; break;
    }
  }

  // ---- claw combo -----------------------------------------------------
  _claw(dt) {
    const pl = this.target, sp = this.sp;
    if (this.sub === 'approach') {
      this.facePlayer(dt, 8);
      this.setAnim('run', 1.3 * sp);
      if (this.dist > 3.6 && this.stateT < 2.0) this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * 1.7);
      else { this.sub = 'wind'; this.stateT = 0; this.attacking = false; }
      return;
    }
    const last = this.swings >= this.swingMax - 1;
    const heavy = last;
    const total = (heavy ? 1.0 : 0.65) / sp;
    if (this.sub === 'wind') {
      if (!this.attacking) {
        this.attacking = true;
        this.game.fx.ring(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), heavy ? 5.2 : 4, 0xff2040, total);
        this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.7 });
      }
      this.windup = Math.max(0, total - this.stateT);
      this.facePlayer(dt, this.windup > 0.2 ? 7 : 0);
      this.setAnim(heavy ? 'smash' : (this.swings % 2 ? 'punch2' : 'punch1'), sp);
      if (this.stateT >= total) {
        this.windup = 0;
        this.forward(_f);
        _o.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
        this.vel.x += _f.x * 7; this.vel.z += _f.z * 7;
        const dmg = heavy ? 26 : 15;
        const hit = this.game.combat.melee({ origin: _o, forward: _f, range: heavy ? 4.6 : 4.0, arc: heavy ? 150 : 120, damage: dmg, knockback: heavy ? 15 : 8, up: heavy ? 6 : 2, team: 'enemy', source: this });
        if (heavy) {
          this.game.fx.shockwave(_o.set(this.pos.x + _f.x * 2.4, this.pos.y + 0.1, this.pos.z + _f.z * 2.4), 4.5, PURPLE);
          this.game.cam.shake(0.45);
          this.game.audio?.play?.('smash', { pos: this.pos });
        } else this.game.audio?.play?.('punch', { pos: this.pos });
        this.swings++;
        this.sub = 'follow'; this.stateT = 0;
      }
    } else if (this.sub === 'follow') {
      this.windup = 0; this.attacking = false;
      this.setAnim(this.swings % 2 ? 'punch2' : 'punch1', sp * 0.6);
      this.facePlayer(dt, 5);
      if (this.stateT > 0.22 / sp) {
        if (this.swings >= this.swingMax) { this.cd.any = rnd(1.2, 2.2) / sp; this._recover(heavyRecover(this)); }
        else { this.sub = 'wind'; this.stateT = 0; this.attacking = false; }
      }
    }
  }

  // ---- leap slam ---------------------------------------------------------
  _leapWind(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.9 / sp;
    if (!this.attacking) { this.attacking = true; this.game.audio?.play?.('boss_roar', { pitch: 1.3, volume: 0.5 }); }
    this.windup = Math.max(0, total - this.stateT) + 0.55;     // landing is shortly after take-off
    this.facePlayer(dt, 6);
    this.setAnim('charge', sp);
    // landing marker follows the player until 0.25 s before take-off
    if (this.stateT < total - 0.25) { this.target3.copy(pl.pos); this.target3.x += pl.vel.x * 0.45; this.target3.z += pl.vel.z * 0.45; }
    if (Math.floor(this.stateT * 5) !== Math.floor((this.stateT - dt) * 5)) {
      this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), 7.5, 0xff2040, 0.3);
    }
    if (this.stateT >= total) this._beginLeapTo(this.target3, 0);
  }

  /** Launch a ballistic arc to land at `to` (landing y taken from `to.y`). */
  _beginLeapTo(to, extraH = 0, how = 'air') {
    const dx = to.x - this.pos.x, dz = to.z - this.pos.z, dy = to.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    const T = clamp(dist / 20, 0.8, 1.5) + (dy < -8 ? Math.sqrt(-dy * 2 / this.gravity) * 0.5 : 0);
    this.vel.x = dx / T; this.vel.z = dz / T;
    this.vel.y = (dy + 0.5 * this.gravity * T * T) / T + extraH * 0.3;
    this.onGround = false;
    this.target3.copy(to);
    this._go('air');
    this.ballistic = true;
    this.attacking = true;
    this.noClip = false;
    this.invuln = Math.max(this.invuln, 0);
    this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.6 });
    this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 0.3, this.pos.z), PURPLE, 14, 6, 0.5, 0.35);
  }

  _air(dt) {
    this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', 1);
    if (this.target) this.faceYawTo(Math.atan2(this.vel.x, this.vel.z), dt, 8);
    this.windup = 0;
    // landing indicator
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), 7.5, 0xff2040, 0.25);
    if (this.stateT > 0.25 && this.onGround) this._landSlam();
    else if (this.stateT > 3.5) this._landSlam();
    // trail
    this.game.fx.trailPuff(this.pos.x, this.pos.y + 1.3, this.pos.z, PURPLE, 0.8, 0.25, 0.03);
  }

  _landSlam() {
    const g = this.game;
    this.ballistic = false;
    const entering = this.invuln > 50;
    if (entering) this.invuln = 0.5;
    this.attacking = false;
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    g.combat.aoe({ center: _o, radius: 7.5, damage: 26, knockback: 16, up: 8, team: 'enemy', source: this, falloff: true });
    g.fx.shockwave(_o, 9, PURPLE);
    g.fx.explosion(_o.setY(this.pos.y + 0.5), 3, PURPLE);
    g.cam.shake(0.9);
    g.audio?.play?.('smash', { pos: this.pos });
    g.input?.rumble?.(0.8, 0.5, 220);
    if (entering) { g.hud?.toast?.('VENOM'); this.manager.onBossLanded?.(); }
    if (this.leapsLeft > 0 && this.target) {
      this.leapsLeft--;
      this.target3.copy(this.target.pos);
      this._go('leapWind'); this.stateT = 0.55 / this.sp; // short crouch between chained leaps
      return;
    }
    this.cd.any = rnd(1.0, 1.8);
    this._recover(0.9);
  }

  // ---- tendril grab -----------------------------------------------------
  _tendril(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.95 / sp;
    this.handPos(_a);
    if (!this.attacking) { this.attacking = true; this.game.audio?.play?.('symbiote', { pos: this.pos }); }
    this.windup = Math.max(0, total - this.stateT);
    this.facePlayer(dt, this.windup > 0.25 ? 9 : 0);
    this.setAnim('cast', sp);
    if (this.windup > 0) {
      // thin telegraph line + gathering goo
      _b.copy(pl.center);
      this.game.fx.beam(_a, _b, 0xff2040, 0.02, 0.05);
      this.game.fx.burst(_a, PURPLE, 1, 2, 0.3, 0.3);
    } else {
      // release
      this.windup = 0;
      this.forward(_f);
      _b.set(pl.center.x - this.pos.x, 0, pl.center.z - this.pos.z).normalize();
      const inCone = _b.dot(_f) > 0.85;
      const vis = this.game.physics.lineOfSight(_a, pl.center);
      const range = this.dist < 24;
      if (inCone && vis && range) {
        this.game.fx.beam(_a, pl.center, PURPLE, 0.28, 0.35);
        this.game.fx.lightning(_a, pl.center, PURPLE, 0.3, 3);
        this.game.combat.damagePlayer(8, this.pos, this);
        this.pullT = 0.55;
        this.cd.any = 0.2;
        this.swings = 0; this.swingMax = 1;
        this._go('claw'); this.sub = 'approach'; this.attacking = false;
      } else {
        this.game.fx.beam(_a, _b.copy(_f).multiplyScalar(14).add(_a), PURPLE, 0.2, 0.25);
        this.cd.any = 1;
        this._recover(1.1);
      }
    }
  }

  _pull(dt) {
    const pl = this.target;
    this.pullT -= dt;
    _b.set(this.pos.x - pl.pos.x, 0, this.pos.z - pl.pos.z);
    const d = _b.length();
    if (d < 3.6) { this.pullT = 0; return; }
    _b.multiplyScalar(1 / d);
    const sp = Math.min(30, d * 5);
    pl.vel.x = _b.x * sp; pl.vel.z = _b.z * sp;
    if (pl.vel.y < 2) pl.vel.y = 2;
    this.handPos(_a);
    this.game.fx.beam(_a, pl.center, PURPLE, 0.2, 0.06);
  }

  handPos(out) {
    const h = this.model.handR;
    if (h) { h.updateWorldMatrix(true, false); return h.getWorldPosition(out); }
    this.forward(_f);
    return out.set(this.pos.x + _f.x * 1.2, this.pos.y + 1.8, this.pos.z + _f.z * 1.2);
  }

  // ---- goo volley --------------------------------------------------------
  _goo(dt) {
    const pl = this.target, sp = this.sp;
    const total = 0.8 / sp;
    this.attacking = true;
    this.facePlayer(dt, 8);
    this.setAnim('throw', sp);
    if (this.sub !== 'fired') {
      this.windup = Math.max(0, total - this.stateT);
      if (this.stateT === dt) this.game.audio?.play?.('symbiote', { pos: this.pos });
      this.handPos(_a);
      if (Math.random() < 0.6) this.game.fx.burst(_a, PURPLE, 1, 2, 0.3, 0.35);
      if (this.stateT >= total) {
        this.windup = 0; this.sub = 'fired';
        const n = this.phase === 3 ? 5 : 3;
        _b.set(pl.center.x - _a.x, pl.center.y - _a.y, pl.center.z - _a.z);
        const dist = _b.length(); _b.normalize();
        const speed = 26;
        // lead the target a little and lob (gravity 5)
        const tt = dist / speed;
        _b.set(pl.center.x + pl.vel.x * tt * 0.6 - _a.x, pl.center.y + 0.5 * 5 * tt * tt - _a.y, pl.center.z + pl.vel.z * tt * 0.6 - _a.z).normalize();
        const yaw0 = Math.atan2(_b.x, _b.z);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.17;
          const dir = _f.set(Math.sin(yaw0 + off) * Math.hypot(_b.x, _b.z), _b.y, Math.cos(yaw0 + off) * Math.hypot(_b.x, _b.z));
          this.game.combat.projectile({ pos: _a, vel: dir.clone().multiplyScalar(speed), damage: 10, kind: 'symbiote', team: 'enemy', source: this, life: 3, radius: 0.55 });
        }
        this.game.fx.flash(_a, PURPLE, 2, 0.15);
        this.stateT = 0;
      }
    } else {
      this.windup = 0;
      if (this.stateT > 0.5 / sp) { this.sub = ''; this.cd.any = rnd(1.2, 2); this._recover(0.6); }
    }
  }

  // ---- summon ------------------------------------------------------------
  _summon(dt) {
    this.attacking = true; this.windup = 0;
    this.facePlayer(dt, 3);
    this.setAnim('cast', this.sp);
    if (this.stateT === dt) { this.game.audio?.play?.('boss_roar'); this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 8, PURPLE); this.game.cam.shake(0.4); }
    if (this.stateT > 1.1 && this.sub !== 'done') {
      this.sub = 'done';
      const n = this.phase === 3 ? 3 : 2;
      for (let i = 0; i < n; i++) this.manager.spawnMinion(this.pos, 6 + i * 0.5, (i / n) * Math.PI * 2 + Math.random());
    }
    if (this.stateT > 1.8) { this.sub = ''; this.cd.any = rnd(1, 2); this._recover(0.4); }
  }

  // ---- roar (phase change) --------------------------------------------------
  _startRoar() {
    this.phase = this.pendingPhase;
    this._go('roar'); this.sub = '';
    this.poise = 0;
    this.attacking = true; this.windup = 0;
    this.game.audio?.play?.('boss_roar');
    this.game.hud?.toast?.(this.phase === 2 ? 'VENOM is getting serious!' : 'VENOM IS ENRAGED!');
    this.cd.any = 1.5;
    if (this.phase === 3) this.model.setTint?.(0xff2040, 0.0);
  }

  _roar(dt) {
    this.setAnim('cast', 1);
    this.wish.set(0, 0, 0);
    const T = 2.0;
    if (this.stateT < dt * 1.5) { this.game.cam.shake(1.0); }
    if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) {
      this.game.cam.shake(0.25);
      this.game.fx.lightning(_a.set(this.pos.x, this.pos.y + 1.5, this.pos.z), _b.set(this.pos.x + rnd(-8, 8), this.pos.y + rnd(0, 6), this.pos.z + rnd(-8, 8)), PURPLE, 0.25, 3);
    }
    if (this.sub !== 'wave' && this.stateT > 0.9) {
      this.sub = 'wave';
      this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 14, PURPLE);
      this.game.combat.aoe({ center: _o.set(this.pos.x, this.pos.y + 0.5, this.pos.z), radius: 11, damage: 8, knockback: 14, up: 4, team: 'enemy', source: this });
      if (this.phase === 2) this.cd.summon = 0.5;
    }
    if (this.stateT > T) { this.attacking = false; this._go('chase'); }
  }

  // ----------------------------------------------------------------- death
  onDeath() {
    const g = this.game;
    g.hud?.hideBoss?.();
    g.slowmo?.(1.4, 0.2);
    g.cam.shake(1.2);
    g.audio?.play?.('boss_roar', { pitch: 0.7 });
    for (let i = 0; i < 4; i++) {
      _o.set(this.pos.x + rnd(-1.2, 1.2), this.pos.y + rnd(0.5, 2.5), this.pos.z + rnd(-1.2, 1.2));
      g.fx.explosion(_o, 3.5, PURPLE);
    }
    g.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 16, PURPLE);
    g.fx.lightning(_a.set(this.pos.x, this.pos.y + 6, this.pos.z), _b.set(this.pos.x, this.pos.y + 0.5, this.pos.z), 0xd0a0ff, 0.6, 4);
    this.manager.onBossDeath(this);
  }

  onLand() { /* slam handled by state machine */ }
}

function heavyRecover(v) { return v.phase === 1 ? 1.5 : v.phase === 2 ? 1.2 : 0.9; }
