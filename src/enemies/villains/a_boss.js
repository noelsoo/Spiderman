// Shared base for the "A" villain bosses (Kraven, Lizard, Doc Ock).
// Provides: intro, phases (66% / 33%), poise -> stagger, guaranteed "exposed" windows (fairness rule),
// delayed events, ground hazard / trap zones, player root + pin (grab), minion calls, ballistic leaps, death.
import * as THREE from 'three';
import { Enemy, rnd, clamp } from '../Enemy.js';

const V3 = THREE.Vector3;
const _o = new V3(), _f = new V3(), _a = new V3(), _b = new V3(), _p = new V3();

let ZG = null;
function zoneAssets() {
  if (ZG) return ZG;
  ZG = {
    disc: new THREE.CircleGeometry(1, 28),
    ring: new THREE.RingGeometry(0.86, 1, 28),
  };
  return ZG;
}

export class VillainBoss extends Enemy {
  constructor(game, manager, cfg) {
    super(game, manager, { isBoss: true, gravity: 30, ...cfg });
    this.bossTitle = cfg.title ?? cfg.name;
    this.accent = cfg.accent ?? 0x7a2bd0;
    this.phase = 1; this.pendingPhase = 1;
    this.poise = 0; this.poiseMax = cfg.poise ?? 260;
    this.cd = { any: 2 };
    this.state = 'intro'; this.stateT = 0; this.sub = '';
    this.restCount = 0; this.restEvery = cfg.restEvery ?? 3;
    this.recoverT = 1; this.exposeT = 3.4;
    this.minions = [];
    this._later = [];
    this.zones = [];
    this.pin = null;
    this._introDone = false;
    this.target3 = new V3();
    this.leapCb = null;
    this.untargetable = false;
    this.superArmor = true;
    this.unstaggerable = new Set(['intro', 'roar', 'stagger', 'exposed', 'air']);
    this.stats = { attacks: {}, phases: [1], staggers: 0, exposed: 0 };   // for tests / telemetry
  }

  get sp() { return this.phase === 1 ? 1 : this.phase === 2 ? 1.12 : 1.3; }
  go(s) { this.state = s; this.stateT = 0; this.sub = ''; }
  count(name) { this.stats.attacks[name] = (this.stats.attacks[name] || 0) + 1; }

  // ------------------------------------------------------------------ delayed events / zones
  later(t, fn) { this._later.push({ t, fn }); }

  update(dt) {
    super.update(dt);
    if (!this.alive) return;
    for (let i = this._later.length - 1; i >= 0; i--) {
      const l = this._later[i]; l.t -= dt;
      if (l.t <= 0) { this._later.splice(i, 1); l.fn(); }
    }
    this._tickZones(dt);
    this._tickPin(dt);
    this.extraUpdate?.(dt);
  }

  addZone(z) {
    const A = zoneAssets();
    z.pos = z.pos.clone(); z.t = z.life ?? 8; z.armT = z.armT ?? 0; z.tickT = 0; z.used = false;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const rmat = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const d = new THREE.Mesh(A.disc, mat); const r = new THREE.Mesh(A.ring, rmat);
    d.rotation.x = r.rotation.x = -Math.PI / 2;
    g.add(d, r); g.scale.set(z.r, 1, z.r); g.position.set(z.pos.x, z.pos.y + 0.08, z.pos.z);
    this.game.scene.add(g);
    z.mesh = g; z.mat = mat; z.rmat = rmat;
    if (this.zones.length >= 10) this._killZone(this.zones.shift());
    this.zones.push(z);
    return z;
  }
  _killZone(z) {
    z.mesh.parent?.remove(z.mesh);
    z.mat.dispose(); z.rmat.dispose();
  }
  _clearZones() { for (const z of this.zones) this._killZone(z); this.zones.length = 0; }

  _tickZones(dt) {
    const pl = this.target;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t -= dt; z.armT -= dt; z.tickT -= dt;
      const armed = z.armT <= 0;
      const pulse = 0.5 + 0.5 * Math.sin(z.t * (armed ? 10 : 5));
      z.mat.opacity = armed ? 0.16 + 0.18 * pulse : 0.06 + 0.1 * pulse;
      z.rmat.opacity = armed ? 0.9 : 0.35 + 0.3 * pulse;
      if (armed && z.armColor !== undefined && !z.armShown) { z.armShown = true; z.mat.color.setHex(z.armColor); z.rmat.color.setHex(z.armColor); this.game.fx.ring(_o.set(z.pos.x, z.pos.y + 0.12, z.pos.z), z.r, z.armColor, 0.35); }
      if (pl && !pl.dead && armed && !z.used) {
        const inside = Math.hypot(pl.pos.x - z.pos.x, pl.pos.z - z.pos.z) < z.r + 0.2 && pl.pos.y < z.pos.y + 1.1;
        if (inside) {
          if (z.kind === 'net') {
            z.used = true; z.t = Math.min(z.t, 0.5);
            this.game.combat.damagePlayer(z.dmg ?? 5, z.pos, this);
            this.rootPlayer(z.root ?? 1.3);
            this.game.fx.burst(_o.set(pl.pos.x, pl.pos.y + 0.6, pl.pos.z), 0xe8e8e0, 16, 4, 0.5, 0.2);
            this.game.fx.text(_o.set(pl.pos.x, pl.pos.y + pl.height + 0.5, pl.pos.z), 'NETTED!', 0xffe040, { size: 1.2, life: 1 });
            this.game.audio?.play?.('whoosh', { pos: z.pos });
          } else if (z.kind === 'dot' && z.tickT <= 0) {
            z.tickT = 0.5;
            this.game.combat.damagePlayer(z.dmg ?? 4, z.pos, this);
            this.game.fx.burst(_o.set(pl.pos.x, pl.pos.y + 0.3, pl.pos.z), z.color, 5, 2, 0.3, 0.2);
          }
        }
      }
      if (z.t <= 0) { this._killZone(z); this.zones.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ player root / pin (grab)
  rootPlayer(sec) {
    const pl = this.target; if (!pl) return;
    if (this.pin && this.pin.hold) return;
    this.pin = { t: sec, x: pl.pos.x, z: pl.pos.z, hold: null, mash: 0 };
  }
  /** Hold the player at follow() each frame for up to `sec`. mashNeeded presses of attack/dodge break free. */
  holdPlayer(sec, follow, mashNeeded = 5) {
    const pl = this.target; if (!pl) return;
    this.pin = { t: sec, hold: follow, mash: 0, need: mashNeeded, freed: false, x: 0, z: 0 };
  }
  releasePin() { const p = this.pin; this.pin = null; return p; }
  _tickPin(dt) {
    const p = this.pin, pl = this.game.player;
    if (!p) return;
    if (!pl || pl.dead) { this.pin = null; return; }
    p.t -= dt;
    if (p.hold) {
      const inp = this.game.input;
      if (inp.pressed('attack') || inp.pressed('dodge') || inp.pressed('jump') || inp.pressed('special')) p.mash++;
      p.hold(pl.pos);
      pl.vel.set(0, 0, 0);
      if (p.mash >= p.need) { p.freed = true; p.t = 0; }
      if (Math.floor(p.t * 10) !== Math.floor((p.t + dt) * 10)) this.game.fx.burst(_o.set(pl.pos.x, pl.pos.y + 1, pl.pos.z), 0xffe040, 1, 2, 0.25, 0.15);
      if (p.t <= 0) { this.pin = null; p.freed ? this.onGrabBroken?.(pl) : this.onGrabEnd?.(pl); }
    } else {
      pl.pos.x = p.x; pl.pos.z = p.z;
      pl.vel.x = 0; pl.vel.z = 0;
      if (p.t <= 0) this.pin = null;
    }
  }

  // ------------------------------------------------------------------ damage
  takeDamage(amount, o = {}) {
    if (!this.alive) return 0;
    if (this.state === 'intro') return 0;
    const s = this.state;
    if (s === 'roar') amount *= 0.3;
    else if (s === 'stagger') amount *= 1.3;
    else if (s === 'exposed') amount *= 1.2;
    const dealt = super.takeDamage(amount, o);
    if (dealt <= 0 || !this.alive) return dealt;
    this.onBossHit?.(dealt, o);
    this.poise += dealt;
    const frac = this.hp / this.maxHp;
    if (this.phase < 2 && frac <= 0.66) this.pendingPhase = 2;
    if (this.phase < 3 && frac <= 0.33) this.pendingPhase = 3;
    if (this.poise >= this.poiseMax * (this.phase === 3 ? 1.25 : 1) && !this.unstaggerable.has(this.state) && this.pendingPhase === this.phase && !(this.staggerCd > 0)) {
      this.poise = 0; this.staggerCd = 6;
      this.stagger(3.0);
    }
    return dealt;
  }

  stagger(t = 3.0) {
    this.attacking = false; this.windup = 0; this.ballistic = false;
    this.releasePin(); this.manager.releaseToken(this);
    this.untargetable = false; this.root.visible = true;
    this.staggerT = t;
    this.go('stagger');
    this.stats.staggers++;
    this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.8, this.pos.z), 'STAGGERED!', 0xffe040, { size: 1.6, life: 1.4 });
    this.game.audio?.play?.('heavyhit', { pos: this.pos });
    this.game.cam.shake(0.3);
  }

  expose(t = 3.4) {
    this.attacking = false; this.windup = 0;
    this.exposeT = t; this.restCount = 0;
    this.go('exposed');
    this.stats.exposed++;
    this.game.fx.text(_o.set(this.pos.x, this.pos.y + this.height + 0.8, this.pos.z), 'EXPOSED!', 0x60ffa0, { size: 1.4, life: 1.2 });
  }

  /** end of an attack: short recovery, and every N attacks a long exposed window (fairness rule). */
  rest(t = 1) {
    this.attacking = false; this.windup = 0;
    this.manager.releaseToken(this);
    this.restCount++;
    if (this.restCount >= this.restEvery) { this.expose(this.exposeLen ?? 3.4); return; }
    this.recoverT = t / this.sp;
    this.go('recover');
  }

  // ------------------------------------------------------------------ AI skeleton
  ai(dt) {
    const pl = this.target;
    for (const k in this.cd) this.cd[k] -= dt;
    this.poise = Math.max(0, this.poise - 14 * dt);
    if (this.staggerCd > 0) this.staggerCd -= dt;
    if (!this._introDone) { this._introDone = true; this._beginIntro(); }
    if (!pl && this.state !== 'intro') { this.setAnim('idle', 0.8); return; }
    const s = this.state;
    if (this.pendingPhase !== this.phase && (s === 'chase' || s === 'recover')) { this._startRoar(); return; }
    switch (s) {
      case 'intro': this._intro(dt); break;
      case 'chase': this.chase(dt); break;
      case 'recover':
        this.attacking = false; this.windup = 0;
        this.setAnim('idle', 0.8); this.facePlayer(dt, 3);
        this.recovering?.(dt);
        if (this.stateT > this.recoverT) this.go('chase');
        break;
      case 'stagger':
        this.setAnim('stunned', 0.8); this.attacking = false; this.windup = 0;
        if (this.stateT > (this.staggerT ?? 3)) { this.cd.any = 0.6; this.go('chase'); }
        break;
      case 'exposed':
        this.setAnim('stunned', 0.5); this.attacking = false; this.windup = 0;
        this.facePlayer(dt, 1.5);
        if (this.stateT > this.exposeT) { this.cd.any = 0.5; this.go('chase'); }
        break;
      case 'roar': this._roar(dt); break;
      case 'air': this._air(dt); break;
      default: {
        const f = this['st_' + s];
        if (f) f.call(this, dt); else this.go('chase');
      }
    }
  }

  /** default chase: subclass may override */
  chase(dt) {
    const pl = this.target, d = this.dist, sp = this.sp;
    this.facePlayer(dt, 6 * sp);
    this.attacking = false; this.windup = 0;
    if (d > this.engage) { this.moveToward(pl.pos.x, pl.pos.z, this.speed * sp * (d > 14 ? 1.5 : 1)); this.setAnim('run', 0.9 * sp); }
    else { this.wish.set(0, 0, 0); this.setAnim('idle', 1); }
    if (this.cd.any <= 0) {
      const pick = this.pickAttack(d);
      if (pick) { this.count(pick); this.go(pick); this.sub = ''; this.onPick?.(pick); }
      else this.cd.any = 0.35;
    }
  }

  pick(opts) {
    if (!opts.length) return null;
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot;
    for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
    return opts[0][0];
  }

  // ------------------------------------------------------------------ intro / roar
  _beginIntro() {
    const g = this.game;
    g.audio?.play?.('boss_roar');
    g.audio?.music?.('boss');
    g.hud?.toast?.(this.bossTitle ?? this.name);
    g.cam.shake(0.7);
    g.input?.rumble?.(0.8, 0.5, 300);
    _o.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
    g.fx.shockwave(_o, 10, this.accent);
    g.fx.ring(_o, 6, this.accent, 0.8);
    g.fx.burst(_o.setY(this.pos.y + 1), this.accent, 24, 7, 0.7, 0.3);
    this.go('intro');
    this.onIntro?.();
  }
  _intro(dt) {
    this.setAnim('cast', 0.9); this.wish.set(0, 0, 0);
    this.facePlayer(dt, 4);
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.lightning(_a.set(this.pos.x, this.pos.y + 1.4, this.pos.z), _b.set(this.pos.x + rnd(-3, 3), this.pos.y + rnd(0, 3), this.pos.z + rnd(-3, 3)), this.accent, 0.2, 2);
    if (this.stateT > 2.0) { this.cd.any = 1.2; this.go('chase'); }
  }

  _startRoar() {
    this.phase = this.pendingPhase;
    this.stats.phases.push(this.phase);
    this.go('roar'); this.poise = 0;
    this.attacking = true; this.windup = 0;
    this.manager.releaseToken(this);
    this.game.audio?.play?.('boss_roar');
    this.game.hud?.toast?.(this.phaseToast?.(this.phase) ?? `${this.name} is getting serious!`);
    this.cd.any = 1.5;
    this.restCount = 0;
  }
  _roar(dt) {
    this.setAnim('cast', 1); this.wish.set(0, 0, 0);
    if (this.stateT < dt * 1.5) { this.game.cam.shake(1.0); this.game.input?.rumble?.(1, 0.6, 350); }
    if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) {
      this.game.cam.shake(0.2);
      this.game.fx.lightning(_a.set(this.pos.x, this.pos.y + 1.5, this.pos.z), _b.set(this.pos.x + rnd(-7, 7), this.pos.y + rnd(0, 5), this.pos.z + rnd(-7, 7)), this.accent, 0.25, 3);
    }
    if (this.sub !== 'wave' && this.stateT > 0.9) {
      this.sub = 'wave';
      this.game.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 13, this.accent);
      this.game.combat.aoe({ center: _o.set(this.pos.x, this.pos.y + 0.5, this.pos.z), radius: 8, damage: 6, knockback: 12, up: 4, team: 'enemy', source: this });
      this.onPhaseStart?.(this.phase);
    }
    if (this.stateT > 2.0) { this.attacking = false; this.go('chase'); }
  }

  // ------------------------------------------------------------------ helpers
  groundY(x, z) { return this.game.physics.heightAt(x, z, this.pos.y + 4); }
  handPos(out, hand = 'handR') {
    const h = this.model[hand] ?? this.model.handR;
    if (h) { h.updateWorldMatrix(true, false); return h.getWorldPosition(out); }
    this.forward(_f);
    return out.set(this.pos.x + _f.x * 1.2, this.pos.y + this.height * 0.7, this.pos.z + _f.z * 1.2);
  }
  /** cone melee in front of the boss */
  strike(range, arc, damage, knockback, up = 2, yOff = 1.2) {
    this.forward(_f);
    _o.set(this.pos.x, this.pos.y + yOff, this.pos.z);
    return this.game.combat.melee({ origin: _o, forward: _f, range, arc, damage, knockback, up, team: 'enemy', source: this });
  }
  /** ground-level circular AoE that a jump clears (feet above `clear` metres) */
  groundBlast(center, radius, damage, kb, up, clear = 0.9) {
    const pl = this.target; if (!pl || pl.dead) return false;
    const d = Math.hypot(pl.pos.x - center.x, pl.pos.z - center.z) - 0.3;
    if (d > radius || pl.pos.y > center.y + clear) return false;
    this.game.combat.damagePlayer(damage, center, this);
    if (pl.invuln > 0.3) {
      _a.set(pl.pos.x - center.x, 0, pl.pos.z - center.z); const l = _a.length() || 1;
      pl.vel.x += _a.x / l * kb; pl.vel.z += _a.z / l * kb; pl.vel.y = Math.max(pl.vel.y, up);
    }
    return true;
  }
  lead(pl, t) { return _p.set(pl.center.x + pl.vel.x * t, pl.center.y, pl.center.z + pl.vel.z * t); }

  callMinions(kind, n, optsFn) {
    const m = this.manager; let c = 0;
    for (let i = 0; i < n; i++) {
      if (m.aliveCount() >= 17) break;
      m._ringPoint(this.pos, 5, 10, _p);
      const e = m.spawn(kind, _p.clone(), { wave: Math.max(2, m.stats.wave), ...(optsFn ? optsFn(i) : {}) });
      if (e) { this.minions.push(e); c++; }
    }
    this.minions = this.minions.filter((e) => e.alive);
    return c;
  }
  minionsAlive() { this.minions = this.minions.filter((e) => e.alive); return this.minions.length; }

  // ---- ballistic leap (shared by pounce / leap slam / rooftop climb)
  leapTo(to, cb, extraH = 0) {
    const dx = to.x - this.pos.x, dz = to.z - this.pos.z, dy = to.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    const T = clamp(dist / 20, 0.8, 1.5) + (dy < -8 ? Math.sqrt(-dy * 2 / this.gravity) * 0.5 : 0);
    this.vel.x = dx / T; this.vel.z = dz / T;
    this.vel.y = (dy + 0.5 * this.gravity * T * T) / T + extraH * 0.3;
    this.onGround = false;
    this.target3.copy(to);
    this.leapCb = cb;
    this.go('air');
    this.ballistic = true; this.attacking = true;
    this.game.audio?.play?.('whoosh', { pos: this.pos, pitch: 0.6 });
    this.game.fx.burst(_o.set(this.pos.x, this.pos.y + 0.3, this.pos.z), this.accent, 14, 6, 0.5, 0.35);
  }
  _air(dt) {
    this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', 1);
    this.faceYawTo(Math.atan2(this.vel.x, this.vel.z), dt, 8);
    this.windup = 0;
    if (Math.floor(this.stateT * 6) !== Math.floor((this.stateT - dt) * 6)) this.game.fx.ring(_o.set(this.target3.x, this.target3.y + 0.15, this.target3.z), this.leapR ?? 5, 0xff2040, 0.25);
    this.game.fx.trailPuff(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z, this.accent, 0.8, 0.25, 0.03);
    if ((this.stateT > 0.25 && this.onGround) || this.stateT > 3.5) {
      this.ballistic = false; this.attacking = false;
      const cb = this.leapCb; this.leapCb = null;
      cb?.call(this);
    }
  }

  // ------------------------------------------------------------------ death
  onDeath() {
    const g = this.game;
    this.releasePin(); this._clearZones(); this._later.length = 0;
    this.root.visible = true; this.untargetable = false;
    for (const e of this.minions) if (e.alive) e.takeDamage(9999, {});
    g.hud?.hideBoss?.();
    g.slowmo?.(1.4, 0.2);
    g.cam.shake(1.2);
    g.input?.rumble?.(1, 0.8, 500);
    g.audio?.play?.('boss_roar', { pitch: 0.7 });
    for (let i = 0; i < 4; i++) {
      _o.set(this.pos.x + rnd(-1.2, 1.2), this.pos.y + rnd(0.5, 2.5), this.pos.z + rnd(-1.2, 1.2));
      g.fx.explosion(_o, 3.5, this.accent);
    }
    g.fx.shockwave(_o.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 16, this.accent);
    this.onDied?.();
    this.manager.onBossDeath(this);
  }
}

export { rnd, clamp };
