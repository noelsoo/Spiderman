// Scarlet Witch: chaos magic. Levitation + flight, hex bolts, telekinesis, chaos wave, hex shield, reality warp.
//
//   Space (air, held)   float / hover; otherwise a slow fall         Shift / R2  flight (camera-relative, floaty)
//   LMB / J / []        hex bolts (homing a little), every 3rd = hex burst AoE
//   RMB / K / R1        telekinetic grab (target within 30 m). Hold to keep it in front of you, release = hurl,
//                       LMB while holding = slam it into the ground
//   E / L1              Chaos Wave (cone shockwave, 5 s)           R / L2  Hex Shield (6 s, 18 s cooldown)
//   C / Ctrl / O        red-mist dash                              Q / R3  Reality Warp ("No More")
import * as THREE from 'three';
import { Hero } from './Hero.js';
import { Timers, aimInfo, enemiesNear, objPos, rumble, clamp, damp, rand, makeHexBolt, hexAssets } from './mystic/util.js';

const RED = 0xff2a55, PINK = 0xff7a96;
const TUNE = {
  flySpeed: 23, flyRise: 8, flyRate: 1.5, hoverSpeed: 6.5, fallMax: 6.5, fallGs: 0.4,
  boltCd: 0.2, boltSpeed: 48, boltDmg: 11, burstDmg: 16, burstRadius: 4.5, burstAoe: 30,
  grabRange: 30, grabDist: 5.5, grabMax: 7, throwSpeed: 40, throwHit: 40, slamDmg: 50, slamRadius: 4.5,
  waveCd: 5, waveRange: 15, waveArc: 115, waveDmg: 28, waveKb: 24,
  shieldTime: 6, shieldCd: 18, shieldAbsorb: 0.3, shieldTick: 0.3, shieldDmg: 14, shieldReach: 2.6,
  dashCd: 1, dashSpeed: 27, dashT: 0.28,
  ultRange: 35, ultLift: 1.7, ultCrush: 0.6, ultDmg: 250, ultBossDmg: 200,
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
  }

  onActivate() { this._reset(); }
  onDeactivate() {
    this._release(false);
    this.thrown.length = 0;
    this._shieldOff();
    this._overlay(0);
    this._reset();
    this.model.setHexGlow?.(0);
  }
  _reset() {
    this.flying = false; this.hovering = false; this.ult = null; this.dash = 0; this.actionT = 0; this.chain = 0;
    this.gravityScale = 1; this.customMovement = false; this.timers.clear();
  }

  get abilityHints() {
    return [
      { action: 'special', label: this.grab ? 'Hurl' : 'Telekinesis', cooldown: this.cooldownFrac('grab'), active: !!this.grab },
      { action: 'ability', label: 'Chaos Wave', cooldown: this.cooldownFrac('wave') },
      { action: 'ability2', label: 'Hex Shield', cooldown: this.cooldownFrac('shield'), active: this.shieldT > 0 },
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
    if (input.pressed('special') && !this.grab) this._tryGrab();
    if (input.pressed('ability') && this._chaosWave()) glowT = 1;
    if (input.pressed('ability2')) this._shieldOn();
    if (input.down('attack') && !this.grab) { if (this._bolt()) glowT = 1; }
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
    // red wisps from the hands
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
    const size = burst ? 2.2 : 1;
    g.combat.projectile({
      kind: 'repulsor', pos: _c, vel: _a.copy(_b).multiplyScalar(burst ? 36 : TUNE.boltSpeed), damage: burst ? TUNE.burstDmg : TUNE.boltDmg,
      radius: burst ? 0.5 : 0.3, life: 1.8, color: RED, mesh: makeHexBolt(size), source: this, knockback: 3, up: 1, stun: 0.2,
      homing: tgt && !burst ? tgt : (tgt ?? null), turn: 2.2, heavy: burst,
      onExpire: burst ? (p) => this._hexBurst(p.pos.clone()) : (p) => g.fx?.burst?.(p.pos, RED, 6, 3, 0.25, 0.15),
    });
    g.audio?.play(burst ? 'thunder' : 'whoosh', { volume: burst ? 0.3 : 0.35, pitch: 1.5 });
    g.fx?.burst?.(_c, RED, burst ? 14 : 5, 3, 0.25, 0.2);
    this.actionAnim = burst ? 'cast' : (this.hand ? 'shoot' : 'throw'); this.actionT = burst ? 0.35 : 0.2;
    this.setAnim(this.actionAnim, 1);
    this.chain++; this.chainT = 0.8;
    return true;
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
