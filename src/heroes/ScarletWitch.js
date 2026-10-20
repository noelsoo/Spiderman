// Scarlet Witch: chaos magic. Levitation + flight, hex bolts, telekinesis, chaos wave, hex shield, reality warp.
//
//   Space (air, held)   float / hover; otherwise a slow fall         Shift / R2  flight (camera-relative, floaty)
//   LMB / J / []        enemy within ~4.5 m: Chaos tendril combo (lash, lash, wrap-and-slam + Hex Bolt volley ender)
//                       otherwise (or hold): hex bolts (homing a little), every 3rd = hex burst AoE
//   RMB / K / R1        grounded / hovering: telekinetic grab (target within 30 m). Hold to keep it in front of you,
//                       release = hurl, LMB while holding = slam.  While FLYING (Shift/R2 held): Reality Warp zone
//   E / L1              tap: Chaos Wave (cone shockwave, 5 s)   HOLD (0.4 s+, aim ring) and release: Chaos Lift & Crush
//   R / L2              tap: Hex Shield (6 s)                    HOLD (0.4 s+) and release: Mind Control one enemy (7 s)
//   C / Ctrl / O        red-mist dash                              Q / R3  Reality Warp ("No More") ultimate
import * as THREE from 'three';
import { Hero } from './Hero.js';
import { Timers, aimInfo, enemiesNear, objPos, rumble, clamp, damp, rand, makeHexBolt, hexAssets } from './mystic/util.js';
import { TendrilPool } from './mystic/tendril.js';
import { MindGames } from './mystic/mind.js';

const RED = 0xff2a55, PINK = 0xff7a96;
const TUNE = {
  flySpeed: 23, flyRise: 8, flyRate: 1.5, hoverSpeed: 6.5, fallMax: 6.5, fallGs: 0.4,
  boltCd: 0.2, boltSpeed: 48, boltDmg: 11, burstDmg: 16, burstRadius: 4.5, burstAoe: 30,
  grabRange: 30, grabDist: 5.5, grabMax: 7, throwSpeed: 40, throwHit: 40, slamDmg: 50, slamRadius: 4.5,
  waveCd: 5, waveRange: 15, waveArc: 115, waveDmg: 28, waveKb: 24,
  shieldTime: 6, shieldCd: 18, shieldAbsorb: 0.3, shieldTick: 0.3, shieldDmg: 14, shieldReach: 2.6,
  dashCd: 1, dashSpeed: 27, dashT: 0.28,
  ultRange: 35, ultLift: 1.7, ultCrush: 0.6, ultDmg: 250, ultBossDmg: 200,
  holdT: 0.4,
  crushCd: 14, crushR: 10, crushMax: 14, crushLift: 1.25, crushDmg: 55, crushBoss: 40, crushRange: 32,
  mindCd: 16, mindTime: 7, mindRange: 35,
  warpCd: 22, warpR: 7.5, warpTime: 7, warpConfuse: 4, warpRange: 30,
  tendrilRange: 4.6, tendrilDmg: [16, 18, 28], tendrilKb: [5, 5, 16], volleyDmg: 9, volleyN: 5,
};

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _hp = new THREE.Vector3();

export class ScarletWitch extends Hero {
  constructor(game) {
    super(game, { id: 'scarlet', name: 'Scarlet Witch', color: '#e0254f', maxHp: 140, walkSpeed: 6.5, runSpeed: 12, jumpSpeed: 10, gravity: 24, radius: 0.42, height: 1.75, airControl: 0.6, mass: 0.9 });
    this.timers = new Timers();
    this.airT = 0; this.flying = false; this.hovering = false;
    this.chain = 0; this.chainT = 0; this.hand = 0; this.actionT = 0; this.actionAnim = 'idle';
    this.glow = 0; this.wispT = 0; this.flyFxT = 0;
    this.grab = null; this.thrown = [];
    this.shieldT = 0; this.shieldTick = 0; this.shieldHit = 0; this.shield = null;
    this.dash = 0; this.ult = null; this.overlay = null;
    this.tend = new TendrilPool(game.scene, 18, 14);
    this.mind = new MindGames(this);
    this.holdE = 0; this.holdR = 0; this.aimFxT = 0; this.mcTarget = null;
    this.mchain = 0; this.mchainT = 0; this.meleeT = 0;
    this.crush = null; this.zone = null; this.trails = []; this.swirl = 0; this.crushPt = new THREE.Vector3();
  }

  onActivate() { this._reset(); }
  onDeactivate() {
    this._release(false);
    this.thrown.length = 0;
    this._shieldOff();
    this._overlay(0);
    this._cancelCrush(); this._zoneOff();
    this.mind.releaseAll(); this.tend.clear(); this._stopTrails();
    this._reset();
    this.model.setHexGlow?.(0);
  }
  _reset() {
    this.flying = false; this.hovering = false; this.ult = null; this.dash = 0; this.actionT = 0; this.chain = 0;
    this.gravityScale = 1; this.customMovement = false; this.timers.clear();
    this.holdE = 0; this.holdR = 0; this.mchain = 0; this.mchainT = 0; this.meleeT = 0; this.mcTarget = null;
  }

  get abilityHints() {
    const cd = (...n) => Math.max(...n.map((x) => this.cooldownFrac(x)));
    return [
      { action: 'attack', label: this.mchainT > 0 ? 'Tendrils x' + this.mchain : 'Tendrils / Bolts', cooldown: 0, active: this.mchainT > 0 },
      { action: 'special', label: this.flying ? 'Warp Zone' : (this.grab ? 'Hurl' : 'Telekinesis'), cooldown: this.flying ? this.cooldownFrac('warp') : this.cooldownFrac('grab'), active: !!this.grab || !!this.zone },
      { action: 'ability', label: this.holdE >= TUNE.holdT ? 'Release: Crush' : 'Wave | Hold: Crush', cooldown: cd('wave', 'crush'), active: !!this.crush || this.holdE >= TUNE.holdT },
      { action: 'ability2', label: this.holdR >= TUNE.holdT ? 'Release: Control' : 'Shield | Hold: Mind', cooldown: cd('shield', 'mind'), active: this.shieldT > 0 || !!this.mind.controlled() },
      { action: 'swing', label: 'Flight', cooldown: 0, active: this.flying },
      { action: 'ultimate', label: 'No More', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  // ---- shield soaks damage ----------------------------------------------------------------
  takeDamage(amount, fromPos) {
    if (this.shieldT > 0 && amount > 0 && !this.dead && this.invuln <= 0) {
      amount *= TUNE.shieldAbsorb; fromPos = undefined; this.shieldHit = 0.25;
      const g = this.game;
      g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.4, this.pos.z), 'ABSORBED', RED);
      g.fx?.burst?.(this.center, RED, 14, 5, 0.35, 0.2);
      g.audio?.play('hit', { volume: 0.4 });
    }
    return super.takeDamage(amount, fromPos);
  }

  // ---- main update ----------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.chain = 0; }
    this.airT = this.onGround ? 0 : this.airT + dt;
    let glowT = 0;

    this.meleeT = Math.max(0, this.meleeT - dt);
    if (this.mchainT > 0) { this.mchainT -= dt; if (this.mchainT <= 0) this.mchain = 0; }
    this.tend.update(dt, this.game.camera.position);
    this.mind.update(dt, this.game.time);
    this._zoneUpdate(dt);
    this._crushUpdate(dt);
    this._shieldUpdate(dt);
    this._thrownUpdate(dt);
    if (this.shieldT > 0) glowT = Math.max(glowT, 0.5);

    if (this.ult) { glowT = 1; this._ultUpdate(dt); this._finish(dt, glowT); return; }

    // grab keeps running while she moves
    if (this.grab) { glowT = 1; this._grabUpdate(dt, input); }

    if (input.pressed('ultimate') && this.focus >= 100) { this._startUlt(); return; }

    // dash
    if (this.dash > 0) { this._dashUpdate(dt); this._finish(dt, 0.8); return; }
    if (input.pressed('dodge') && this._tryDash(input)) { this._finish(dt, 0.8); return; }

    // movement mode
    const wantFly = input.down('swing');
    const wantHover = !wantFly && !this.onGround && input.down('jump') && this.airT > 0.2 && this.vel.y <= 1.5;
    if (wantFly && !this.flying) this._takeoff();
    this.flying = wantFly;
    this.hovering = wantHover;
    if (this.flying) { this._fly(dt, input); glowT = Math.max(glowT, 0.5); }
    else if (this.hovering) { this._hover(dt, input); glowT = Math.max(glowT, 0.4); }
    else {
      this.customMovement = false;
      if (!this.onGround && this.vel.y < 0) { this.gravityScale = TUNE.fallGs; if (this.vel.y < -TUNE.fallMax) this.vel.y = -TUNE.fallMax; }
      else this.gravityScale = 1;
    }

    // abilities
    if (input.pressed('special') && !this.grab) { if (this.flying) this._realityWarp(); else this._tryGrab(); }
    if (this._holdE(dt, input)) glowT = 1;
    if (this._holdR(dt, input)) glowT = Math.max(glowT, 0.9);
    if (!this.grab) {
      const near = input.pressed('attack') ? this.game.enemies?.nearest?.(this.pos, TUNE.tendrilRange) : null;
      if (near && near.alive) { if (this.meleeT <= 0 && this._tendrilCombo(near)) glowT = 1; }
      else if (input.down('attack') && this.meleeT <= 0.12) { if (this._bolt()) glowT = 1; }
    }
    if (this.actionT > 0) glowT = Math.max(glowT, 0.9);
    this._finish(dt, glowT);
  }

  _finish(dt, glowT) {
    this.glow = damp(this.glow, glowT, 8, dt);
    this.model.setHexGlow?.(this.glow);
    if (this.actionT > 0 && !this.ult) this.setAnim(this.actionAnim, this.anim.speed);
    else if (this.grab && !this.flying && !this.hovering && this.onGround) this.setAnim('cast', 1);
    else if (this.flying) this.setAnim(this.vel.length() > 9 ? 'fly' : 'hover', this.vel.length());
    else if (this.hovering) this.setAnim('hover', 0);
    // red ribbons from the hands + a body wake while levitating / flying
    if ((this.flying || this.hovering) && !this.ult) {
      this._startTrails();
      this.swirl += dt * (this.flying ? 7 : 3.5);
      const sw = this.swirl, fxx = this.game.fx;
      fxx?.trailPuff?.(this.pos.x + Math.cos(sw) * 0.75, this.pos.y + 0.9 + Math.sin(sw * 1.7) * 0.6, this.pos.z + Math.sin(sw) * 0.75, PINK, 0.32, 0.6, 0.03);
      fxx?.trailPuff?.(this.pos.x - Math.cos(sw) * 0.75, this.pos.y + 0.9 - Math.sin(sw * 1.7) * 0.6, this.pos.z - Math.sin(sw) * 0.75, RED, 0.32, 0.6, 0.03);
    } else this._stopTrails();
    this.wispT -= dt;
    if (this.glow > 0.15 && this.wispT <= 0) {
      this.wispT = 0.06 / Math.max(0.3, this.glow);
      const fx = this.game.fx;
      for (let h = 0; h < 2; h++) {
        objPos(h ? this.model.handR : this.model.handL, _hp, this.center);
        fx?.trailPuff?.(_hp.x + rand(-0.05, 0.05), _hp.y + rand(0, 0.1), _hp.z + rand(-0.05, 0.05), RED, 0.28 * (0.5 + this.glow), 0.4, 0.04);
      }
    }
  }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    if (!this.onGround && this.vel.y < -1.5) this.setAnim('glide', 0);
  }

  // ---- levitation + flight ----------------------------------------------------------------
  _takeoff() {
    const g = this.game;
    if (this.onGround) { this.vel.y = Math.max(this.vel.y, 7); this.onGround = false; }
    g.audio?.play('whoosh', { volume: 0.5 });
    g.fx?.ring?.(_a.copy(this.pos).setY(this.pos.y + 0.1), 3, RED, 0.4);
    g.fx?.burst?.(this.center, RED, 16, 5, 0.5, 0.25);
  }
  _fly(dt, input) {
    const g = this.game, cam = g.cam;
    this.customMovement = true; this.gravityScale = 0;
    const aim = cam.aimDirection(_aim.dir).normalize();
    _w.set(0, 0, 0).addScaledVector(aim, input.move.y).addScaledVector(cam.right, input.move.x);
    let wl = _w.length(); if (wl > 1) { _w.divideScalar(wl); wl = 1; }
    if (wl > 0.1) _t.copy(_w).multiplyScalar(TUNE.flySpeed); else _t.set(0, 0, 0);
    if (input.down('jump')) _t.y += TUNE.flyRise;
    if (wl < 0.05) _t.y += Math.sin(g.time * 2) * 0.6;
    this.vel.lerp(_t, 1 - Math.exp(-(wl > 0.1 ? TUNE.flyRate : 2.5) * dt));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 3) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 6); else this.faceTowards(cam.forward, dt, 4);
    // red mist trail
    this.flyFxT -= dt;
    if (this.flyFxT <= 0) {
      this.flyFxT = 0.03;
      const sp = this.vel.length();
      g.fx?.trailPuff?.(this.pos.x + rand(-0.25, 0.25), this.pos.y + rand(0.2, 1.3), this.pos.z + rand(-0.25, 0.25), RED, 0.6 + sp * 0.01, 0.7, 0.1);
      if (Math.random() < 0.4) g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 0.9, this.pos.z), PINK, 1, 1.5, 0.5, 0.15);
    }
  }
  _hover(dt, input) {
    const g = this.game, cam = g.cam;
    this.customMovement = true; this.gravityScale = 0;
    const wish = cam.moveVector(input.move, _w);
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();
    this.vel.x = damp(this.vel.x, wish.x * TUNE.hoverSpeed * mag, 3.5, dt);
    this.vel.z = damp(this.vel.z, wish.z * TUNE.hoverSpeed * mag, 3.5, dt);
    this.vel.y = damp(this.vel.y, Math.sin(g.time * 2.4) * 0.5, 6, dt);
    if (mag > 0.1) this.faceTowards(wish, dt, 8);
    this.flyFxT -= dt;
    if (this.flyFxT <= 0) { this.flyFxT = 0.12; g.fx?.trailPuff?.(this.pos.x + rand(-0.3, 0.3), this.pos.y + 0.1, this.pos.z + rand(-0.3, 0.3), RED, 0.4, 0.6, 0.1); }
  }

  // ---- dash ----------------------------------------------------------------
  _tryDash(input) {
    if (!this.useCooldown('dash', TUNE.dashCd)) return false;
    const g = this.game;
    const wish = g.cam.moveVector(input.move, _w);
    if (wish.lengthSq() < 0.05) wish.copy(this.forward); else wish.normalize();
    this.vel.set(wish.x * TUNE.dashSpeed, this.onGround ? 1.5 : this.vel.y * 0.3, wish.z * TUNE.dashSpeed);
    this.yaw = Math.atan2(wish.x, wish.z);
    this.dash = TUNE.dashT; this.invuln = Math.max(this.invuln, TUNE.dashT + 0.1);
    this.customMovement = true; this.gravityScale = 0.2;
    g.audio?.play('dodge'); g.fx?.burst?.(this.center, RED, 14, 4, 0.4, 0.3);
    this.setAnim('dash', 1);
    return true;
  }
  _dashUpdate(dt) {
    this.dash -= dt; this.customMovement = true;
    this.setAnim('dash', 1);
    this.game.fx?.trailPuff?.(this.pos.x, this.pos.y + 0.9, this.pos.z, RED, 0.8, 0.5, 0.2);
    if (this.dash <= 0) { this.customMovement = false; this.gravityScale = 1; this.vel.x *= 0.4; this.vel.z *= 0.4; }
  }

  // ---- hex bolts ----------------------------------------------------------------
  _handPos(out) { return objPos(this.hand ? this.model.handR : this.model.handL, out, this.center); }
  _bolt() {
    const burst = this.chain % 3 === 2;
    if (!this.useCooldown('bolt', burst ? 0.5 : TUNE.boltCd)) return false;
    const g = this.game;
    this.hand ^= 1;
    this._handPos(_c);
    const tgt = this.findTarget(35, 40);
    aimInfo(this, 90, _aim);
    _b.subVectors(_aim.point, _c);
    if (_b.length() < 3) _b.copy(_aim.dir);
    if (tgt) _b.lerp(_a.subVectors(tgt.center ?? tgt.pos, _c).normalize().multiplyScalar(_b.length()), 0.6);
    _b.normalize();
    this.yaw = Math.atan2(_b.x, _b.z);
    this._spawnBolt(_c, _b, tgt, burst);
    this.actionAnim = burst ? 'cast' : (this.hand ? 'shoot' : 'throw'); this.actionT = burst ? 0.35 : 0.2;
    this.setAnim(this.actionAnim, 1);
    this.chain++; this.chainT = 0.8;
    return true;
  }
  /** One hex bolt from `from` along `dir` (both are copied). burst = big bolt that detonates as a hex burst. */
  _spawnBolt(from, dir, tgt, burst = false, dmg = null, speed = null) {
    const g = this.game;
    const pos = from.clone(), vel = dir.clone().normalize().multiplyScalar(speed ?? (burst ? 36 : TUNE.boltSpeed));
    g.combat.projectile({
      kind: 'repulsor', pos, vel, damage: dmg ?? (burst ? TUNE.burstDmg : TUNE.boltDmg),
      radius: burst ? 0.5 : 0.3, life: 1.8, color: RED, mesh: makeHexBolt(burst ? 2.2 : 1), source: this, knockback: 3, up: 1, stun: 0.2,
      homing: tgt ?? null, turn: 2.2, heavy: burst,
      onExpire: burst ? (p) => this._hexBurst(p.pos.clone()) : (p) => g.fx?.burst?.(p.pos, RED, 6, 3, 0.25, 0.15),
    });
    g.audio?.play(burst ? 'thunder' : 'whoosh', { volume: burst ? 0.3 : 0.3, pitch: 1.5 });
    g.fx?.burst?.(pos, RED, burst ? 14 : 5, 3, 0.25, 0.2);
  }
  _hexBurst(pos) {
    const g = this.game;
    g.combat.aoe({ center: pos, radius: TUNE.burstRadius, damage: TUNE.burstAoe, knockback: 13, up: 6, stun: 0.7, source: this });
    g.fx?.shockwave?.(pos.clone(), TUNE.burstRadius * 1.3, RED);
    g.fx?.ring?.(pos.clone(), TUNE.burstRadius, PINK, 0.4);
    g.fx?.burst?.(pos.clone(), RED, 26, 8, 0.6, 0.3);
    g.fx?.flash?.(pos.clone(), RED, 5, 0.2);
    g.audio?.play('explosion', { volume: 0.5 });
    g.cam.shake(0.25); rumble(g, 0.5, 0.3, 120);
    if (g._slowmo <= 0.05) g.slowmo?.(0.05, 0.05);
  }

  // ---- telekinesis ----------------------------------------------------------------
  _tryGrab() {
    const g = this.game;
    if ((this.cooldowns.grab || 0) > 0) return false;
    const e = this.findTarget(TUNE.grabRange, 50) ?? g.enemies?.nearest?.(this.pos, 10);
    if (!e || !e.alive) return false;
    this.useCooldown('grab', 0.4);
    g.audio?.play('whoosh', { volume: 0.5, pitch: 0.7 });
    g.fx?.lightning?.(this._handPos(_c).clone(), (e.center ?? e.pos).clone(), RED, 0.25, 2);
    if (e.isBoss) { e.takeDamage(60, { stun: 1.2, source: this, kind: 'hex' }); g.fx?.text?.(_a.copy(e.pos).setY(e.pos.y + e.height + 0.5), 'RESISTS', RED); return true; }
    this.grab = { e, t: 0 };
    e.model?.setTint?.(RED, 0.5);
    this.actionT = 0.3; this.actionAnim = 'cast';
    return true;
  }
  _hold(e, desired, rate, maxV) {
    _b.copy(desired).sub(e.center).multiplyScalar(rate);
    if (_b.length() > maxV) _b.setLength(maxV);
    e.vel.copy(_b);
    e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.4); e.webTimer = 0; e.onGround = false;
    e.interrupt?.();
  }
  _aura(e) {
    const fx = this.game.fx;
    if (Math.random() < 0.7) fx?.burst?.(_a.set(e.center.x + rand(-0.5, 0.5), e.center.y + rand(-0.8, 0.8), e.center.z + rand(-0.5, 0.5)), RED, 1, 1.5, 0.5, 0.2);
    if (Math.random() < 0.2) fx?.lightning?.(this._handPos(_c).clone(), e.center.clone(), RED, 0.12, 1);
  }
  _grabUpdate(dt, input) {
    const gr = this.grab, e = gr.e, g = this.game;
    if (!e.alive || e.removed) { this._release(false); return; }
    gr.t += dt;
    const aim = g.cam.aimDirection(_aim.dir).normalize();
    _t.copy(this.center).addScaledVector(aim, TUNE.grabDist);
    _t.y = clamp(_t.y, this.pos.y + 2.2, this.pos.y + 7);
    this._hold(e, _t, 8, 30);
    this._aura(e);
    this.faceTowards(g.cam.forward, dt, 8);
    if (input.pressed('attack') && gr.t > 0.15) { this._release(true, _b.set(0, -1, 0)); return; }
    if ((gr.t > 0.3 && !input.down('special')) || gr.t > TUNE.grabMax) {
      if (gr.t > TUNE.grabMax) this._release(false); else this._release(true, aim);
    }
  }
  _release(hurl, dir) {
    const gr = this.grab; if (!gr) return;
    this.grab = null;
    const e = gr.e, g = this.game;
    e.model?.setTint?.(RED, 0);
    if (!e.alive) return;
    if (!hurl) { e.vel.set(0, 0, 0); return; }
    const d = dir.clone().normalize();
    e.vel.copy(d).multiplyScalar(TUNE.throwSpeed); if (d.y > -0.9) e.vel.y += 2;
    e.launched = true;
    this.thrown.push({ e, t: 0, dir: d, hit: new Set([e]), speed: TUNE.throwSpeed });
    g.audio?.play('throw', { volume: 0.7, pitch: 0.7 });
    g.fx?.ring?.(e.center.clone(), 2.5, RED, 0.3);
    g.cam.shake(0.15); rumble(g, 0.4, 0.5, 100);
    this.actionT = 0.25; this.actionAnim = 'throw';
  }
  _thrownUpdate(dt) {
    const g = this.game;
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const th = this.thrown[i], e = th.e;
      th.t += dt;
      if (!e.alive || e.removed) { this.thrown.splice(i, 1); continue; }
      e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.3);
      g.fx?.trailPuff?.(e.center.x, e.center.y, e.center.z, RED, 0.7, 0.4, 0.1);
      for (const o of g.enemies?.list ?? []) {
        if (o === e || !o.alive || th.hit.has(o)) continue;
        if (o.center.distanceTo(e.center) < 1.5 + o.radius) {
          th.hit.add(o);
          _b.copy(th.dir).multiplyScalar(14).setY(5);
          o.takeDamage(TUNE.throwHit, { knockback: _b.clone(), stun: 1, source: this, kind: 'hex' });
          g.fx?.hitSpark?.(o.center, RED, true); g.audio?.play('heavyhit', { volume: 0.6 });
          this.registerHit();
          e.takeDamage(15, { source: this, kind: 'hex' });
        }
      }
      const slow = e.vel.length() < th.speed * 0.4;
      if ((th.t > 0.12 && (e.onGround || slow)) || th.t > 2.2) {
        this.thrown.splice(i, 1);
        _a.set(e.pos.x, e.pos.y + 0.4, e.pos.z);
        g.combat.aoe({ center: _a.clone(), radius: TUNE.slamRadius, damage: TUNE.slamDmg, knockback: 15, up: 8, stun: 1.2, source: this });
        g.fx?.shockwave?.(_a.clone(), TUNE.slamRadius * 1.4, RED);
        g.fx?.burst?.(_a.clone(), RED, 24, 7, 0.6, 0.3);
        g.fx?.flash?.(_a.clone(), RED, 5, 0.2);
        g.audio?.play('smash'); g.audio?.play('explosion', { volume: 0.5 });
        g.cam.shake(0.5); rumble(g, 0.7, 0.5, 160); if (g._slowmo <= 0.05) g.slowmo?.(0.06, 0.05);
      }
    }
  }

  // ---- chaos wave ----------------------------------------------------------------
  _chaosWave() {
    if (!this.useCooldown('wave', TUNE.waveCd)) return false;
    const g = this.game;
    const f = g.cam.forward.clone().setY(0).normalize();
    this.yaw = Math.atan2(f.x, f.z);
    g.combat.melee({ origin: _a.set(this.pos.x, this.pos.y + 1, this.pos.z), forward: f, range: TUNE.waveRange, arc: TUNE.waveArc, damage: TUNE.waveDmg, knockback: TUNE.waveKb, up: 6, stun: 1, source: this, heavy: true });
    const base = this.pos.clone();
    for (let i = 0; i < 5; i++) {
      this.timers.after(i * 0.06, () => {
        const p = base.clone().addScaledVector(f, 2 + i * 3); p.y += 0.3;
        g.fx?.ring?.(p, 2.2 + i * 0.7, i % 2 ? PINK : RED, 0.45);
        g.fx?.burst?.(p.clone().setY(p.y + 0.6), RED, 14, 7, 0.45, 0.3);
        if (i === 0) g.fx?.shockwave?.(p.clone(), 5, RED);
      });
    }
    g.fx?.flash?.(_a.set(this.pos.x, this.pos.y + 1.2, this.pos.z), RED, 5, 0.2);
    g.audio?.play('thunder', { volume: 0.5 }); g.audio?.play('whoosh');
    g.cam.shake(0.3); rumble(g, 0.7, 0.4, 150);
    this.actionT = 0.4; this.actionAnim = 'cast'; this.setAnim('cast', 1);
    return true;
  }

  // ---- hex shield ----------------------------------------------------------------
  _shieldOn() {
    if (this.shieldT > 0 || !this.useCooldown('shield', TUNE.shieldCd)) return false;
    const g = this.game, H = hexAssets();
    this.shieldT = TUNE.shieldTime; this.shieldTick = 0;
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(H.domeGeo, H.dome));
    grp.add(new THREE.Mesh(H.domeGeo, H.fill));
    grp.children[0].scale.setScalar(1.75); grp.children[1].scale.setScalar(1.7);
    const runes = [];
    for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(H.runeGeo, H.rune); grp.add(r); runes.push(r); }
    g.scene.add(grp);
    this.shield = { grp, runes, t: 0 };
    this.actionT = 0.3; this.actionAnim = 'cast'; this.setAnim('cast', 1);
    g.audio?.play('thunder', { volume: 0.3 }); g.fx?.ring?.(_a.copy(this.pos).setY(this.pos.y + 0.1), 3, RED, 0.4);
    g.fx?.flash?.(this.center, RED, 4, 0.2);
    return true;
  }
  _shieldOff() {
    if (this.shield) { this.shield.grp.parent?.remove(this.shield.grp); this.shield = null; }
    this.shieldT = 0;
  }
  _shieldUpdate(dt) {
    if (!this.shield) return;
    const g = this.game, s = this.shield;
    this.shieldT -= dt; s.t += dt; this.shieldHit = Math.max(0, this.shieldHit - dt);
    if (this.shieldT <= 0 || this.dead) { g.fx?.burst?.(this.center, RED, 24, 6, 0.5, 0.25); this._shieldOff(); return; }
    const c = this.center;
    s.grp.position.copy(c);
    const fade = clamp(this.shieldT / 0.6, 0, 1) * (0.75 + 0.25 * Math.sin(s.t * 30)) ;
    const pulse = 1 + this.shieldHit * 0.5;
    s.grp.children[0].material.opacity = (0.22 + this.shieldHit * 0.6) * (this.shieldT < 0.6 ? fade : 1);
    s.grp.children[0].rotation.y += dt * 0.6; s.grp.children[0].rotation.x += dt * 0.3;
    s.grp.scale.setScalar(pulse);
    for (let i = 0; i < s.runes.length; i++) {
      const a = s.t * 1.6 + (i / s.runes.length) * Math.PI * 2;
      const r = s.runes[i];
      r.position.set(Math.cos(a) * 1.9, Math.sin(s.t * 2 + i) * 0.6, Math.sin(a) * 1.9);
      r.rotation.set(0, Math.PI / 2 - a, 0);
    }
    this.shieldTick -= dt;
    if (this.shieldTick <= 0) {
      this.shieldTick = TUNE.shieldTick;
      for (const e of enemiesNear(g, c, TUNE.shieldReach + 0.5)) {
        if (Math.abs(e.center.y - c.y) > 2.2) continue;
        _b.subVectors(e.pos, this.pos).setY(0).normalize().multiplyScalar(9); _b.y = 3;
        if (e.takeDamage(TUNE.shieldDmg, { knockback: _b.clone(), stun: 0.4, source: this, kind: 'hex' })) {
          g.fx?.hitSpark?.(e.center, RED, false); this.registerHit();
        }
      }
    }
  }

  // ---- context helpers ----------------------------------------------------------------
  /** Ground point under the camera reticle, clamped to `range` metres from the hero. */
  _groundPoint(range, out) {
    aimInfo(this, range + 10, _aim);
    out.copy(_aim.point);
    _t.set(out.x - this.pos.x, 0, out.z - this.pos.z);
    const d = _t.length();
    if (d > range) { _t.multiplyScalar(range / d); out.x = this.pos.x + _t.x; out.z = this.pos.z + _t.z; }
    const h = this.game.physics.heightAt(out.x, out.z, Math.max(out.y, this.pos.y) + 1.5);
    out.y = Number.isFinite(h) ? h : 0;
    return out;
  }
  _lookAt(p) {
    _t.set(p.x - this.pos.x, 0, p.z - this.pos.z);
    if (_t.lengthSq() > 0.01) this.yaw = Math.atan2(_t.x, _t.z);
  }

  // ---- hold E: Chaos Magic levitate-and-crush ----------------------------------------------
  _holdE(dt, input) {
    let glow = false;
    if (input.pressed('ability')) this.holdE = 1e-4;
    if (this.holdE > 0) {
      const down = input.down('ability');
      if (down) {
        this.holdE += dt;
        if (this.holdE >= TUNE.holdT && (this.cooldowns.crush || 0) <= 0) { this._crushAim(dt); glow = true; }
      }
      if (!down || input.released('ability')) {
        const h = this.holdE; this.holdE = 0;
        if (h < TUNE.holdT) { if (this._chaosWave()) glow = true; }
        else if (this._startCrush()) glow = true;
        else if (this._chaosWave()) glow = true;
      }
    }
    return glow;
  }
  _crushAim(dt) {
    const g = this.game, pt = this.crushPt;
    this._groundPoint(TUNE.crushRange, pt);
    this._lookAt(pt);
    this.aimFxT -= dt;
    if (this.aimFxT <= 0) {
      this.aimFxT = 0.12;
      const grow = clamp((this.holdE - TUNE.holdT) / 0.6, 0, 1);
      g.fx?.ring?.(_a.set(pt.x, pt.y + 0.12, pt.z), TUNE.crushR * (0.55 + 0.45 * grow), RED, 0.3);
      g.fx?.ring?.(_a.set(pt.x, pt.y + 0.12, pt.z), TUNE.crushR * 0.35, PINK, 0.25);
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * TUNE.crushR;
        g.fx?.burst?.(_a.set(pt.x + Math.cos(a) * r, pt.y + 0.2, pt.z + Math.sin(a) * r), RED, 2, 3.5, 0.8, 0.22);
      }
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || Math.hypot(e.pos.x - pt.x, e.pos.z - pt.z) > TUNE.crushR) continue;
        g.fx?.ring?.(_a.set(e.pos.x, e.pos.y + 0.1, e.pos.z), 0.9, PINK, 0.2);
      }
      this.tend.fire(this._handPos(_c), _b.set(pt.x, pt.y + 0.3, pt.z), { life: 0.2, width: 0.1, curl: 0.5, grow: 0.5 });
    }
    this.actionT = Math.max(this.actionT, 0.1); this.actionAnim = 'cast';
  }
  _startCrush() {
    const g = this.game;
    if (!this.useCooldown('crush', TUNE.crushCd)) return false;
    const pt = this._groundPoint(TUNE.crushRange, this.crushPt);
    const vic = [], bosses = [];
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || Math.hypot(e.pos.x - pt.x, e.pos.z - pt.z) > TUNE.crushR) continue;
      (e.isBoss ? bosses : vic).push(e);
    }
    vic.sort((a, b) => Math.hypot(a.pos.x - pt.x, a.pos.z - pt.z) - Math.hypot(b.pos.x - pt.x, b.pos.z - pt.z));
    vic.length = Math.min(vic.length, TUNE.crushMax);
    if (!vic.length && !bosses.length) { this.cooldowns.crush = 0; g.fx?.text?.(_a.set(pt.x, pt.y + 1, pt.z), 'NO TARGETS', PINK); return false; }
    this._cancelCrush();
    this.crush = { phase: 'lift', t: 0, pt: pt.clone(), tendT: 0, impacts: 0, victims: vic.map((e, i) => ({ e, x: e.pos.x, z: e.pos.z, y0: e.pos.y, ph: Math.random() * 6.28, i, done: false })) };
    for (const e of vic) e.model?.setTint?.(RED, 0.5);
    for (const b of bosses) {
      b.takeDamage(TUNE.crushBoss, { stun: 1.2, source: this, kind: 'hex' });
      g.fx?.text?.(_a.copy(b.pos).setY(b.pos.y + b.height + 0.5), 'RESISTS', RED); this.registerHit();
    }
    g.fx?.shockwave?.(pt.clone(), TUNE.crushR * 1.1, RED);
    g.fx?.flash?.(_a.set(pt.x, pt.y + 1.5, pt.z), RED, 6, 0.3);
    g.hud?.toast?.('CHAOS MAGIC');
    g.audio?.play('thunder', { volume: 0.7 }); g.audio?.play('whoosh', { pitch: 0.6 });
    g.cam.shake(0.35); rumble(g, 0.6, 0.6, 300);
    this.actionT = 0.6; this.actionAnim = 'cast'; this.setAnim('cast', 1);
    return true;
  }
  _cancelCrush() {
    if (!this.crush) return;
    for (const v of this.crush.victims) v.e.model?.setTint?.(RED, 0);
    this.crush = null;
  }
  _crushUpdate(dt) {
    const c = this.crush; if (!c) return;
    const g = this.game;
    c.t += dt;
    let alive = 0;
    for (const v of c.victims) if (!v.done && v.e.alive && !v.e.removed) alive++;
    if (!alive) { this._cancelCrush(); return; }
    if (c.phase === 'lift') {
      const k = clamp(c.t / 0.55, 0, 1), ease = k * k * (3 - 2 * k);
      for (const v of c.victims) {
        const e = v.e; if (!e.alive || e.removed) continue;
        const a = g.time * 2.2 + v.ph, r = 1.3 * ease;
        _t.set(v.x + Math.cos(a) * r, v.y0 + (4.8 + (v.i % 4) * 0.9) * ease + Math.sin(g.time * 3 + v.ph) * 0.2, v.z + Math.sin(a) * r);
        this._hold(e, _t, 7, 26);
        this._aura(e);
      }
      c.tendT -= dt;
      if (c.tendT <= 0) {
        c.tendT = 0.17;
        let n = 0;
        for (const v of c.victims) {
          if (!v.e.alive || n >= 8) continue; n++;
          const e = v.e;
          this.tend.fire(this._handPos(_c), e.center, { life: 0.3, width: 0.13, curl: 0.55, waves: 2, grow: 0.3, fromFn: (o) => this._handPos(o), toFn: (o) => o.copy(e.center) });
        }
        g.fx?.ring?.(_a.set(c.pt.x, c.pt.y + 0.12, c.pt.z), TUNE.crushR * (1 - 0.35 * ease), RED, 0.25);
      }
      g.cam.shake(0.05 + 0.08 * ease);
      if (c.t >= TUNE.crushLift) {
        c.phase = 'slam'; c.t = 0;
        g.audio?.play('thunder', { volume: 0.8 }); g.audio?.play('whoosh', { pitch: 0.5, volume: 0.7 });
        for (const v of c.victims) if (v.e.alive) { v.e.vel.set(0, -50, 0); v.e.launched = true; v.e.stunTimer = Math.max(v.e.stunTimer, 0.6); }
        this.actionT = 0.3; this.actionAnim = 'throw';
      }
      return;
    }
    // slam
    for (const v of c.victims) {
      const e = v.e;
      if (v.done || !e.alive || e.removed) continue;
      e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.4);
      if (c.t < 0.5) e.vel.y = Math.min(e.vel.y, -50);
      g.fx?.trailPuff?.(e.center.x, e.center.y + 0.4, e.center.z, RED, 0.8, 0.35, 0.08);
      if ((c.t > 0.08 && e.onGround) || c.t > 1.1) {
        v.done = true; c.impacts++;
        e.model?.setTint?.(RED, 0);
        _a.set(e.pos.x, e.pos.y + 0.3, e.pos.z);
        e.takeDamage(TUNE.crushDmg, { stun: 1.6, source: this, kind: 'hex' });
        g.combat.aoe({ center: _a.clone(), radius: 2.8, damage: 14, knockback: 8, up: 4, stun: 0.6, source: this });
        if (c.impacts <= 4) { g.fx?.shockwave?.(_a.clone(), 4, RED); g.fx?.flash?.(_a.clone(), RED, 4, 0.15); g.audio?.play('smash', { volume: 0.5 }); }
        else g.fx?.ring?.(_a.clone(), 3, PINK, 0.3);
        g.fx?.burst?.(_a.clone(), RED, 16, 6, 0.5, 0.28);
        g.fx?.hitSpark?.(e.center, RED, true);
        this.registerHit();
      }
    }
    if (c.victims.every((v) => v.done || !v.e.alive || v.e.removed)) {
      g.cam.shake(0.55); rumble(g, 0.8, 0.5, 220);
      if (c.impacts > 1 && g._slowmo <= 0.05) g.slowmo?.(0.08, 0.1);
      this._cancelCrush();
    }
  }

  // ---- hold R: mind control ----------------------------------------------------------------
  _holdR(dt, input) {
    let glow = false;
    if (input.pressed('ability2')) this.holdR = 1e-4;
    if (this.holdR > 0) {
      const down = input.down('ability2');
      if (down) {
        this.holdR += dt;
        if (this.holdR >= TUNE.holdT) {
          const e = this.findTarget(TUNE.mindRange, 45) ?? this.game.enemies?.nearest?.(this.pos, 18);
          this.mcTarget = e && e.alive ? e : null;
          glow = true;
          this.aimFxT -= dt;
          if (this.mcTarget && this.aimFxT <= 0) {
            this.aimFxT = 0.1;
            const g = this.game, t = this.mcTarget;
            g.fx?.ring?.(_a.set(t.pos.x, t.pos.y + 0.1, t.pos.z), 1.1, PINK, 0.2);
            g.fx?.burst?.(_a.set(t.center.x, t.pos.y + t.height + 0.4, t.center.z), RED, 2, 1.5, 0.4, 0.2);
            this.tend.fire(this._handPos(_c), t.center, { life: 0.14, width: 0.05, curl: 0.25, grow: 0.5 });
          }
          this.actionT = Math.max(this.actionT, 0.1); this.actionAnim = 'cast';
        }
      }
      if (!down || input.released('ability2')) {
        const h = this.holdR; this.holdR = 0;
        if (h < TUNE.holdT) this._shieldOn(); else this._mindControl(this.mcTarget);
        this.mcTarget = null;
      }
    }
    return glow;
  }
  _mindControl(e) {
    const g = this.game;
    if (!e || !e.alive) { g.fx?.text?.(_a.copy(this.pos).setY(this.pos.y + this.height + 0.5), 'NO TARGET', PINK); return false; }
    if ((this.cooldowns.mind || 0) > 0) return false;
    this.useCooldown('mind', TUNE.mindCd);
    this._handPos(_c);
    g.fx?.lightning?.(_c.clone(), e.center.clone(), RED, 0.3, 3);
    this.tend.fire(_c, e.center, { life: 0.5, width: 0.2, curl: 0.8, waves: 3, fromFn: (o) => this._handPos(o), toFn: (o) => o.copy(e.center) });
    g.audio?.play('thunder', { volume: 0.5, pitch: 1.3 });
    this.actionT = 0.4; this.actionAnim = 'cast'; this.setAnim('cast', 1);
    if (e.isBoss) {
      e.takeDamage(35, { stun: 1.0, source: this, kind: 'hex' });
      g.fx?.text?.(_a.copy(e.pos).setY(e.pos.y + e.height + 0.5), 'RESISTS', RED); this.registerHit();
      return true;
    }
    const old = this.mind.controlled(); if (old && old !== e) this.mind.release(old);
    this.mind.apply(e, 'control', TUNE.mindTime);
    g.fx?.text?.(_a.copy(e.pos).setY(e.pos.y + e.height + 0.6), 'MIND CONTROL', PINK);
    g.fx?.ring?.(_a.set(e.pos.x, e.pos.y + 0.1, e.pos.z), 2.5, RED, 0.4);
    g.fx?.flash?.(e.center, RED, 4, 0.2);
    g.cam.shake(0.15); rumble(g, 0.4, 0.5, 150);
    return true;
  }

  // ---- tendril melee combo with Hex Bolt volley ender -------------------------------------------
  _tendrilCombo(near) {
    const g = this.game;
    const step = this.mchain % 3;
    this.mchain++; this.mchainT = 1.2;
    this.meleeT = [0.3, 0.32, 0.65][step];
    this._lookAt(near.pos);
    const fwd = this.forward;
    if (this.onGround) { this.vel.x += fwd.x * 3; this.vel.z += fwd.z * 3; }
    this.actionAnim = ['throw', 'shoot', 'cast'][step]; this.actionT = [0.3, 0.32, 0.6][step]; this.setAnim(this.actionAnim, 1);
    g.audio?.play('whoosh', { volume: 0.5, pitch: 1.2 });
    const nTend = step === 2 ? 5 : 3;
    const tc = near.center.clone();
    for (let i = 0; i < nTend; i++) {
      this._handPos(_c); this.hand ^= 1;
      _b.copy(tc); _b.x += rand(-0.7, 0.7); _b.y += rand(-0.6, 0.6); _b.z += rand(-0.7, 0.7);
      this.tend.fire(_c, _b, { life: step === 2 ? 0.55 : 0.34, width: step === 2 ? 0.2 : 0.14, curl: step === 2 ? 0.9 : 0.6, waves: 2 + (i % 3) * 0.5, grow: 0.25 });
    }
    g.fx?.flash?.(this._handPos(_c), RED, 3, 0.1);
    const dmg = TUNE.tendrilDmg[step], kb = TUNE.tendrilKb[step];
    if (step === 2) {
      // wrap-and-pull: enemies in front are dragged to the hero, then slammed
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || e.isBoss) continue;
        _t.set(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z);
        const d = _t.length(); if (d > TUNE.tendrilRange + 1.5 || d < 1.4) continue;
        if (_t.normalize().dot(fwd) < 0.2) continue;
        e.vel.x -= _t.x * 9; e.vel.z -= _t.z * 9;
        const ee = e;
        this.tend.fire(this._handPos(_c), e.center, { life: 0.4, width: 0.15, curl: 0.5, fromFn: (o) => this._handPos(o), toFn: (o) => o.copy(ee.center) });
      }
    }
    this.timers.after(step === 2 ? 0.22 : 0.09, () => {
      if (!this.active || this.dead) return;
      const f = this.forward;
      const hits = g.combat.melee({ origin: this.center, forward: f, range: TUNE.tendrilRange, arc: step === 2 ? 200 : 150, damage: dmg, knockback: kb, up: [1, 1, 6][step], stun: [0.3, 0.3, 1][step], source: this, heavy: step === 2 }) ?? [];
      for (const h of hits) {
        g.fx?.hitSpark?.(h.center ?? h.pos, RED, step === 2);
        g.fx?.burst?.(h.center ?? h.pos, PINK, 8, 5, 0.3, 0.2);
      }
      if (hits.length) { rumble(g, 0.25 + step * 0.2, 0.2, 90); g.audio?.play(step === 2 ? 'heavyhit' : 'hit', { volume: 0.5 }); }
      if (step === 2) {
        g.fx?.shockwave?.(_a.copy(this.pos).addScaledVector(f, 2.2), 4.5, RED);
        g.cam.shake(0.3);
      }
    });
    if (step === 2) {
      // combo ender: rapid-fire hex bolt volley
      const tg = [];
      for (const e of g.enemies?.list ?? []) if (e.alive && e.pos.distanceTo(this.pos) < 32) tg.push(e);
      tg.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
      for (let i = 0; i < TUNE.volleyN; i++) {
        this.timers.after(0.3 + i * 0.065, () => {
          if (!this.active || this.dead) return;
          const t = tg.length ? tg[i % tg.length] : null;
          this._handPos(_c); this.hand ^= 1;
          if (t && t.alive) _b.subVectors(t.center, _c); else _b.copy(this.forward);
          _b.normalize(); _b.x += rand(-0.07, 0.07); _b.y += rand(-0.04, 0.07); _b.z += rand(-0.07, 0.07);
          this._spawnBolt(_c, _b, t && t.alive ? t : null, false, TUNE.volleyDmg, 58);
        });
      }
      this.actionT = 0.8;
    }
    return true;
  }

  // ---- flight ribbons ----------------------------------------------------------------
  _startTrails() {
    if (this.trails.length) return;
    const fx = this.game.fx; if (!fx?.trail) return;
    for (const o of [this.model.handL, this.model.handR]) if (o) { const h = fx.trail(o, RED, 0.18, 0.6); if (h) this.trails.push(h); }
    if (this.model.chest) { const h = fx.trail(this.model.chest, PINK, 0.3, 0.7); if (h) this.trails.push(h); }
  }
  _stopTrails() { for (const h of this.trails) h.stop?.(); this.trails.length = 0; }

  // ---- Reality Warp zone (special while flying) ------------------------------------------
  _realityWarp() {
    const g = this.game;
    if (!this.useCooldown('warp', TUNE.warpCd)) return false;
    this._zoneOff();
    const pt = this._groundPoint(TUNE.warpRange, new THREE.Vector3());
    const H = hexAssets(), R = TUNE.warpR;
    const mats = [H.rune.clone(), H.rune.clone(), H.dome.clone(), H.fill.clone()];
    const grp = new THREE.Group(); grp.position.copy(pt);
    const disc = new THREE.Mesh(H.runeGeo, mats[0]); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.12; disc.scale.setScalar(R * 2.1);
    const disc2 = new THREE.Mesh(H.runeGeo, mats[1]); disc2.rotation.x = -Math.PI / 2; disc2.position.y = 0.16; disc2.scale.setScalar(R * 1.3);
    const wire = new THREE.Mesh(H.domeGeo, mats[2]); wire.scale.setScalar(R);
    const fill = new THREE.Mesh(H.domeGeo, mats[3]); fill.scale.setScalar(R * 0.98);
    grp.add(disc, disc2, wire, fill);
    g.scene.add(grp);
    this.zone = { pt, t: 0, tick: 0, pulse: 0, seen: new Set(), grp, mats, parts: [disc, disc2, wire, fill], r: R };
    g.fx?.shockwave?.(pt.clone(), R * 1.2, RED);
    g.fx?.flash?.(_a.set(pt.x, pt.y + 1.5, pt.z), RED, 6, 0.3);
    g.fx?.lightning?.(this._handPos(_c).clone(), new THREE.Vector3(pt.x, pt.y + 0.5, pt.z), RED, 0.3, 3);
    g.hud?.toast?.('REALITY WARP');
    g.audio?.play('thunder', { volume: 0.7 });
    g.cam.shake(0.3); rumble(g, 0.5, 0.5, 250);
    this._lookAt(pt);
    this.actionT = 0.5; this.actionAnim = 'cast'; this.setAnim('cast', 1);
    return true;
  }
  _zoneOff() {
    const z = this.zone; if (!z) return;
    this.game.scene.remove(z.grp);
    for (const m of z.mats) m.dispose();
    this.zone = null;
  }
  _zoneUpdate(dt) {
    const z = this.zone; if (!z) return;
    const g = this.game, R = z.r;
    z.t += dt;
    const k = Math.min(1, z.t / 0.45), out = clamp((TUNE.warpTime - z.t) / 0.9, 0, 1), a = Math.min(k, out);
    if (z.t >= TUNE.warpTime) { g.fx?.burst?.(z.pt, RED, 24, 6, 0.6, 0.3); this._zoneOff(); return; }
    z.grp.scale.setScalar(0.55 + 0.45 * k);
    z.mats[0].opacity = 0.85 * a; z.mats[1].opacity = 0.65 * a; z.mats[2].opacity = 0.3 * a; z.mats[3].opacity = 0.09 * a;
    z.parts[0].rotation.z += dt * 0.5; z.parts[1].rotation.z -= dt * 1.0;
    z.parts[2].rotation.y += dt * 0.4; z.parts[2].rotation.x += dt * 0.15;
    // rising motes, pulsing rings
    for (let i = 0; i < 2; i++) {
      const an = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R;
      g.fx?.burst?.(_a.set(z.pt.x + Math.cos(an) * r, z.pt.y + 0.2, z.pt.z + Math.sin(an) * r), Math.random() < 0.5 ? RED : PINK, 1, 2.2, 0.9, 0.2);
    }
    z.pulse -= dt;
    if (z.pulse <= 0) { z.pulse = 0.9; g.fx?.ring?.(_a.set(z.pt.x, z.pt.y + 0.15, z.pt.z), R * 0.9, RED, 0.6); }
    z.tick -= dt;
    if (z.tick <= 0) {
      z.tick = 0.25;
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || e.removed) continue;
        if (Math.hypot(e.pos.x - z.pt.x, e.pos.z - z.pt.z) > R || Math.abs(e.pos.y - z.pt.y) > 7) continue;
        e.slowTimer = Math.max(e.slowTimer || 0, 0.6);
        if (e.isBoss) continue;
        if (!z.seen.has(e)) {
          z.seen.add(e);
          if (this.mind.apply(e, 'confuse', TUNE.warpConfuse)) {
            g.fx?.text?.(_a.copy(e.pos).setY(e.pos.y + e.height + 0.5), 'CONFUSED', PINK);
            g.fx?.burst?.(e.center, PINK, 10, 3, 0.4, 0.2);
          }
        }
      }
    }
  }

  // ---- ultimate: Reality Warp ----------------------------------------------------------------
  _overlay(a) {
    try {
      if (a <= 0) { if (this.overlay) { this.overlay.remove(); this.overlay = null; } this.game.post?.setTint?.(RED, 0); return; }
      if (!this.overlay && typeof document !== 'undefined') {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;background:radial-gradient(ellipse at center,rgba(255,30,70,0.35),rgba(150,0,30,0.75));mix-blend-mode:multiply;opacity:0;';
        document.body.appendChild(d); this.overlay = d;
      }
      if (this.overlay) this.overlay.style.opacity = String(clamp(a, 0, 1));
      this.game.post?.setTint?.(RED, a);
    } catch { /* optional */ }
  }
  _startUlt() {
    const g = this.game;
    this._release(false);
    this.focus = 0; this.flying = false; this.hovering = false;
    const victims = enemiesNear(g, this.pos, TUNE.ultRange).slice(0, 24);
    this.ult = { phase: 'lift', t: 0, victims, zap: 0 };
    this.invuln = Math.max(this.invuln, 8);
    this.customMovement = true; this.gravityScale = 0; this.vel.set(0, 8, 0); this.onGround = false;
    g.slowmo?.(1.6, 0.35);
    g.hud?.toast?.('NO MORE');
    g.audio?.play('thunder'); g.audio?.play('whoosh', { pitch: 0.6 });
    g.fx?.shockwave?.(this.pos.clone(), 12, RED);
    g.fx?.flash?.(this.center, RED, 8, 0.5);
    g.cam.shake(0.5); rumble(g, 0.8, 0.8, 400);
    for (const e of victims) e.model?.setTint?.(RED, 0.5);
    this.setAnim('cast', 1);
  }
  _ultUpdate(dt) {
    const g = this.game, u = this.ult;
    u.t += dt; this.customMovement = true; this.setAnim('cast', 1);
    this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt);
    const c = this.center;
    if (u.phase === 'lift' || u.phase === 'crush') {
      this.gravityScale = 0; this.vel.y = damp(this.vel.y, u.t < 1 ? 5 : 0, 4, dt);
      this._overlay(Math.min(1, u.t / 0.6) * 0.8);
      const crush = u.phase === 'crush';
      const k = crush ? clamp(u.t / TUNE.ultCrush, 0, 1) : 0;
      const n = u.victims.length;
      u.zap -= dt;
      for (let i = 0; i < n; i++) {
        const e = u.victims[i];
        if (!e.alive || e.removed) continue;
        const a = (i / n) * Math.PI * 2 + g.time * 0.8;
        const r = (7 + (i % 3) * 1.8) * (1 - k * 0.85);
        _t.set(this.pos.x + Math.cos(a) * r, this.pos.y + 5.5 + (i % 4) * 1.1 + Math.sin(g.time * 3 + i) * 0.4, this.pos.z + Math.sin(a) * r);
        this._hold(e, _t, crush ? 12 : 5, 40);
        e.vel.y += 0; // keep
        if (u.zap <= 0 && Math.random() < 0.5) g.fx?.lightning?.(c.clone(), e.center.clone(), RED, 0.18, 1);
        if (Math.random() < 0.5) g.fx?.burst?.(e.center, RED, 1, 2, 0.5, 0.3);
      }
      if (u.zap <= 0) u.zap = 0.1;
      if (Math.random() < 0.5) g.fx?.burst?.(_a.set(this.pos.x + rand(-9, 9), this.pos.y + rand(0, 8), this.pos.z + rand(-9, 9)), RED, 3, 3, 0.8, 0.3);
      g.cam.shake(0.08 + k * 0.25);
      if (u.phase === 'lift' && u.t > TUNE.ultLift) { u.phase = 'crush'; u.t = 0; g.audio?.play('thunder', { volume: 0.7 }); }
      else if (crush && u.t > TUNE.ultCrush) {
        for (const e of u.victims) {
          if (!e.alive) continue;
          g.fx?.explosion?.(e.center.clone(), 2.5, RED);
          e.takeDamage(e.isBoss ? TUNE.ultBossDmg : TUNE.ultDmg, { source: this, kind: 'hex', stun: 2 });
          this.registerHit();
        }
        g.fx?.shockwave?.(this.pos.clone(), 16, RED);
        g.fx?.flash?.(c.clone(), 0xffffff, 10, 0.4);
        g.audio?.play('explosion'); g.audio?.play('thunder');
        g.cam.shake(0.9); rumble(g, 1, 1, 600); g.slowmo?.(0.35, 0.25);
        u.phase = 'drop'; u.t = 0;
        for (const e of u.victims) if (e.alive) { e.vel.set(0, -22, 0); e.launched = true; e.model?.setTint?.(RED, 0); }
      }
    } else { // drop
      this.gravityScale = 1;
      this._overlay(Math.max(0, 0.8 - u.t * 1.6));
      if (this.onGround || u.t > 0.8) {
        g.combat.aoe({ center: this.pos.clone(), radius: 14, damage: 40, knockback: 18, up: 8, stun: 1.5, source: this });
        g.fx?.shockwave?.(this.pos.clone(), 14, RED);
        this._overlay(0);
        this.ult = null; this.customMovement = false; this.gravityScale = 1; this.invuln = Math.max(this.invuln, 0.8);
      }
    }
  }

  updateVisuals(dt) {
    // upright floaty lean is left to the model; nothing extra to sync here
  }
}
