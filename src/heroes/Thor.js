// Thor: Mjolnir flight, hammer combo, returning hammer throw, lightning, God of Thunder aura, Bifrost storm.
import * as THREE from 'three';
import { Hero } from './Hero.js';
import { Timers, aimInfo, enemiesNear, enemyCenter, rumble, applyTilt, impactFx, clamp, damp, rand, objPos } from './avengers/util.js';

// ---- tuning ----------------------------------------------------------------
const FLY_SPEED = 34, FLY_ASCEND = 13, GLIDE_TIME = 1.1;
const THROW_RANGE = 34, THROW_SPEED = 48, THROW_DMG = 55, RETURN_DMG = 45, RETURN_SPEED_MIN = 30, RETURN_SPEED_MAX = 70;
const STRIKE_CD = 5, STRIKE_DMG = 90, STRIKE_RADIUS = 7, STRIKE_RANGE = 60;
const AURA_TIME = 10, AURA_CD = 25, AURA_RADIUS = 7, AURA_TICK = 0.5, AURA_DMG = 18;
const ULT_RISE = 1.0, ULT_STORM = 3, ULT_RANGE = 40, ULT_HEIGHT = 18;
const BLUE = 0x66ccff, BOLT = 0x9fd8ff;

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3();

export class Thor extends Hero {
  constructor(game) {
    super(game, { id: 'thor', name: 'Thor', color: '#66ccff', maxHp: 170, walkSpeed: 7, runSpeed: 13, jumpSpeed: 11, gravity: 26, radius: 0.5, height: 1.95, airControl: 0.5, mass: 1.4 });
    this.model.customRotation = true;
    this.timers = new Timers();
    this.dmgMul = 1;
    this.flying = false; this.glideT = 0; this.wasAirborneFlight = false;
    this.pitch = 0; this.roll = 0; this.fov = 0; this._lastYaw = 0;
    this.actionT = 0; this.actionAnim = 'idle';
    this.chain = 0; this.chainT = 0;
    this.hasHammer = true;
    this.hammerState = 'held';   // held | out | back
    this.proj = null; this.hammerT = 0; this.lastHammerPos = new THREE.Vector3();
    this.recallTarget = { pos: new THREE.Vector3(), center: new THREE.Vector3(), alive: true, radius: 0.5, height: 1 };
    this.curveSide = 1; this.backSpeed = RETURN_SPEED_MIN;
    this.auraT = 0; this.auraTick = 0; this.auraFx = 0;
    this.ult = null;
    this._impactVy = 0;
    this.audioT = 0; this.sparkT = 0;
  }

  onActivate() {
    this.flying = false; this.glideT = 0; this.ult = null; this.actionT = 0; this.gravityScale = 1;
    // Hammer may have been left out when we switched away
    this._resetHammer(true);
  }
  onDeactivate() {
    this._resetHammer(true);
    this.flying = false; this.glideT = 0; this.auraT = 0; this.ult = null; this.dmgMul = 1; this.gravityScale = 1;
    this.timers.clear();
    this.game.cam.fovKick = 0;
    this.model.group.rotation.set(0, this.yaw, 0);
    this.model.setTint?.(BLUE, 0);
  }

  get abilityHints() {
    return [
      { action: 'special', label: this.hasHammer ? 'Hammer Throw' : 'Recall Hammer', cooldown: this.cooldownFrac('throw'), active: !this.hasHammer },
      { action: 'ability', label: 'Lightning Strike', cooldown: this.cooldownFrac('strike') },
      { action: 'ability2', label: 'God of Thunder', cooldown: this.cooldownFrac('aura'), active: this.auraT > 0 },
      { action: 'ultimate', label: 'Thunder Storm', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  // ---- hammer bookkeeping ----------------------------------------------------------------
  _resetHammer(silent) {
    if (this.proj) { this.proj.life = 0; this.proj.dead = true; this.proj.alive = false; this.proj = null; }
    if (!this.hasHammer) { this.model.attachHammer?.(); }
    this.hasHammer = true; this.hammerState = 'held';
  }

  // ---- main update ---------------------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;

    this._hammer(dt);
    this._aura(dt);
    if (this.ult) { this._ultUpdate(dt, input); this._finish(dt); return; }

    // flight: hold swing (needs the hammer in hand)
    const wantFly = input.down('swing') && this.hasHammer && this.actionT <= 0.2;
    if (wantFly && !this.flying) this._takeoff();
    if (!wantFly && this.flying) { this.flying = false; this.glideT = GLIDE_TIME; }
    if (this.flying) this._flyMove(dt, input);
    else if (this.glideT > 0 && !this.onGround) this._glide(dt, input);
    else { this.glideT = 0; this.customMovement = false; this.gravityScale = 1; }

    this._abilities(dt, input);
    this._finish(dt);
  }

  _finish(dt) {
    this._impactVy = this.vel.y;
    if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
    else if (this.flying) this.setAnim(this.vel.length() > 14 ? 'fly' : 'hover', this.vel.length());
    else if (this.glideT > 0 && !this.onGround) this.setAnim('glide', this.vel.length());
    const sp = this.vel.length();
    this.fov = damp(this.fov, this.flying ? 12 * clamp((sp - 10) / 25, 0, 1) : 0, 4, dt);
    this.game.cam.fovKick = this.fov;
  }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
  }

  // ---- flight -----------------------------------------------------------------------------------
  _takeoff() {
    const g = this.game;
    this.flying = true; this.glideT = 0;
    if (this.onGround) { this.vel.y = Math.max(this.vel.y, 8); this.onGround = false; }
    g.audio?.play('whoosh'); g.audio?.play('thunder', { volume: 0.3 });
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 3.5, BLUE, 0.4);
    g.fx?.lightning?.(this.center, this.center.add(_a.set(rand(-2, 2), rand(1, 3), rand(-2, 2))), BOLT, 0.15, 1);
    g.cam.shake(0.1);
  }

  _flyMove(dt, input) {
    const g = this.game, cam = g.cam;
    this.customMovement = true; this.gravityScale = 0;
    const aim = cam.aimDirection(_aim.dir).normalize();
    _w.set(0, 0, 0).addScaledVector(aim, input.move.y).addScaledVector(cam.right, input.move.x);
    let wl = _w.length(); if (wl > 1) { _w.divideScalar(wl); wl = 1; }
    const tgt = _t;
    if (wl > 0.1) tgt.copy(_w).multiplyScalar(FLY_SPEED);
    else tgt.set(0, 0, 0);
    if (input.down('jump')) tgt.y += FLY_ASCEND;
    if (input.down('dodge')) tgt.y -= FLY_ASCEND;
    if (wl < 0.05 && !input.down('jump')) tgt.y += Math.sin(g.time * 2.2) * 0.5;
    this.vel.lerp(tgt, 1 - Math.exp(-(wl > 0.1 ? 2.2 : 3.5) * dt));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 3) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 8); else this.faceTowards(cam.forward, dt, 5);
    if (this.onGround && this.vel.y <= 0.5 && !input.down('jump') && wl < 0.3) { /* skimming the ground: stay flying while swing held */ }
    // lightning crackle + whoosh
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 0.12;
      const c = this.center;
      g.fx?.lightning?.(c.clone().add(_b.set(rand(-0.6, 0.6), rand(-0.5, 0.8), rand(-0.6, 0.6))), c.clone().add(_c.set(rand(-1.8, 1.8), rand(-1.5, 1.8), rand(-1.8, 1.8))), BOLT, 0.1, 1);
    }
    this.audioT -= dt;
    if (this.audioT <= 0) { this.audioT = 0.5; g.audio?.play('whoosh', { volume: 0.3 + clamp(hs / FLY_SPEED, 0, 1) * 0.4 }); }
    g.cam.shake(0.006);
    this.wasAirborneFlight = true;
  }

  _glide(dt, input) {
    const g = this.game, cam = g.cam;
    this.customMovement = true; this.glideT -= dt;
    this.gravityScale = 0.3;
    const wish = cam.moveVector(input.move, _w);
    this.vel.x = damp(this.vel.x, this.vel.x + wish.x * 14, 2.0, dt) * Math.exp(-0.5 * dt);
    this.vel.z = damp(this.vel.z, this.vel.z + wish.z * 14, 2.0, dt) * Math.exp(-0.5 * dt);
    if (this.vel.y < -6) this.vel.y = damp(this.vel.y, -6, 6, dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 2) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 6);
    if (input.pressed('jump')) { this.glideT = 0; }
    if (this.glideT <= 0) { this.customMovement = false; this.gravityScale = 1; }
  }

  onLand() {
    const g = this.game;
    const vy = -this._impactVy;
    if (this.ult || this.flying) return;
    if (this.wasAirborneFlight || vy > 22) {
      const r = 3.5 + clamp(vy * 0.1, 0, 3);
      g.combat?.aoe?.({ center: this.pos.clone(), radius: r, damage: 15 + clamp(vy, 0, 30), knockback: 9, up: 4, stun: 0.5, source: this });
      impactFx(g, this.pos, r, BLUE, 0.25 + clamp(vy * 0.01, 0, 0.3));
      g.fx?.lightning?.(this.pos.clone().setY(this.pos.y + 5), this.pos.clone(), BOLT, 0.15, 2);
      g.audio?.play('land'); g.audio?.play('thunder', { volume: 0.4 });
      rumble(g, 0.4, 0.3, 140);
      this.actionAnim = 'land'; this.actionT = 0.35; this.setAnim('land');
    }
    this.wasAirborneFlight = false; this.flying = false; this.glideT = 0; this.gravityScale = 1;
  }

  // ---- abilities -------------------------------------------------------------------------------------
  _abilities(dt, input) {
    const g = this.game;
    const free = this.actionT <= 0;
    if (input.pressed('attack') && free) this._combo();
    if (input.pressed('special')) {
      if (this.hasHammer && free && (this.cooldowns.throw || 0) <= 0) this._throw();
      else if (!this.hasHammer && this.hammerState === 'out') this._startReturn();
    }
    if (input.pressed('ability') && free && (this.cooldowns.strike || 0) <= 0) this._strike();
    if (input.pressed('ability2') && (this.cooldowns.aura || 0) <= 0 && this.auraT <= 0) this._startAura();
    if (input.pressed('ultimate') && this.focus >= 100) this._startUlt();
    if (!this.flying && this.onGround && input.pressed('dodge') && (this.cooldowns.dash || 0) <= 0) {
      this.useCooldown('dash', 0.8);
      const w = g.cam.moveVector(input.move, _a); if (w.lengthSq() < 0.01) w.copy(this.forward);
      w.normalize(); this.vel.x = w.x * 26; this.vel.z = w.z * 26; this.yaw = Math.atan2(w.x, w.z);
      this.invuln = Math.max(this.invuln, 0.25); this.actionAnim = 'dash'; this.actionT = 0.3;
      g.audio?.play('whoosh'); g.fx?.lightning?.(this.center, this.center.addScaledVector(w, -3), BOLT, 0.12, 1);
    }
  }

  _combo() {
    const g = this.game;
    const step = this.chain % 3;
    const armed = this.hasHammer;
    const t = this.findTarget(10, 80);
    if (t) { _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
    const fw = this.forward;
    this.vel.x += fw.x * (t ? 6 : 3); this.vel.z += fw.z * (t ? 6 : 3);
    const anims = armed ? ['punch1', 'punch2', 'smash'] : ['punch1', 'punch2', 'kick'];
    const dmg = armed ? [30, 32, 60] : [14, 14, 22], kn = armed ? [8, 8, 20] : [5, 5, 10], up = armed ? [2, 2, 8] : [1, 1, 3];
    const dur = armed ? [0.38, 0.38, 0.65] : [0.3, 0.3, 0.45], delay = armed ? [0.12, 0.12, 0.25] : [0.08, 0.08, 0.14];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.1;
    g.audio?.play('whoosh', { volume: 0.5 });
    this.timers.after(delay[step], () => {
      if (!this.active) return;
      const fwd = this.forward;
      const hits = g.combat?.melee?.({ origin: this.center, forward: fwd, range: armed ? 3.4 : 2.6, arc: 120, damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: step === 2 ? 1 : 0.3, source: this }) ?? [];
      for (const h of hits) { this.registerHit(); g.fx?.burst?.(enemyCenter(h, _b).clone(), armed ? BOLT : 0xffffff, 8, 5, 0.3, 0.2); }
      if (hits.length) { g.audio?.play(step === 2 ? 'heavyhit' : 'hammer'); rumble(g, 0.3 + step * 0.2, 0.2, 100); }
      if (armed && step === 2) {
        // lightning-infused finisher
        const c = this.pos.clone().addScaledVector(fwd, 3);
        const hand = objPos(this.model.handR, _c, this.center).clone();
        g.fx?.lightning?.(hand.clone().setY(hand.y + 6), c.clone().setY(c.y + 0.2), BOLT, 0.25, 4);
        for (const h of hits) g.fx?.lightning?.(c.clone().setY(c.y + 1), enemyCenter(h, _b).clone(), BOLT, 0.25, 2);
        g.combat?.aoe?.({ center: c, radius: 5, damage: 35 * this.dmgMul, knockback: 14, up: 7, stun: 1, source: this });
        impactFx(g, c, 5, BLUE, 0.4);
        g.fx?.flash?.(c.clone().setY(c.y + 1), BOLT, 6, 0.2);
        g.audio?.play('thunder'); g.audio?.play('lightning', { volume: 0.6 });
        rumble(g, 0.7, 0.5, 200);
      } else g.cam.shake(0.1);
    });
  }

  // ---- hammer throw -------------------------------------------------------------------------------------------
  _throw() {
    const g = this.game;
    this.useCooldown('throw', 0.5);
    aimInfo(this, THROW_RANGE + 20, _aim);
    const t = this.findTarget(50, 40);
    const from = objPos(this.model.handR, _a, this.center).clone();
    const to = t ? enemyCenter(t, _b).clone() : _aim.point.clone();
    const dir = to.clone().sub(from).normalize();
    // keep it level-ish so the return arc looks right
    const dist = clamp(from.distanceTo(to) + 6, 12, THROW_RANGE);
    this.model.detachHammer?.();
    this.hasHammer = false; this.hammerState = 'out'; this.hammerT = 0; this.outLife = dist / THROW_SPEED;
    this.curveSide = Math.random() < 0.5 ? -1 : 1;
    this.lastHammerPos.copy(from);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.actionAnim = 'throw'; this.actionT = 0.4; this.setAnim('throw');
    g.audio?.play('throw'); g.audio?.play('whoosh');
    g.fx?.flash?.(from, BOLT, 3, 0.12);
    this.proj = g.combat?.projectile?.({
      pos: from, vel: dir.clone().multiplyScalar(THROW_SPEED), damage: THROW_DMG * this.dmgMul, radius: 1.1, life: this.outLife, color: BOLT, size: 0.5,
      kind: 'hammer', team: 'player', pierce: true, source: this,
      onHit: (tg) => { this.registerHit(); g.audio?.play('hammer'); rumble(g, 0.4, 0.3, 80); g.fx?.lightning?.(from.clone(), enemyCenter(tg, _c).clone(), BOLT, 0.12, 1); },
      onExpire: (p) => { if (this.hammerState === 'out') { if (p?.pos) this.lastHammerPos.copy(p.pos); this._startReturn(); } },
    }) ?? null;
  }

  _startReturn() {
    if (this.hammerState !== 'out') return;
    const g = this.game;
    if (this.proj) { this.proj.life = 0; this.proj.dead = true; this.proj.alive = false; if (this.proj.pos) this.lastHammerPos.copy(this.proj.pos); }
    this.hammerState = 'back'; this.hammerT = 0; this.backSpeed = RETURN_SPEED_MIN;
    const hand = objPos(this.model.handR, _a, this.center);
    const dir = _b.subVectors(hand, this.lastHammerPos).normalize();
    this.recallTarget.pos.copy(hand); this.recallTarget.center.copy(hand);
    this.proj = g.combat?.projectile?.({
      pos: this.lastHammerPos.clone(), vel: dir.clone().multiplyScalar(RETURN_SPEED_MIN), damage: RETURN_DMG * this.dmgMul, radius: 1.1, life: 5, color: BOLT, size: 0.5,
      kind: 'hammer', team: 'player', pierce: true, homing: this.recallTarget, source: this,
      onHit: (tg) => { this.registerHit(); g.audio?.play('hammer'); rumble(g, 0.3, 0.2, 70); },
    }) ?? null;
    g.audio?.play('whoosh');
  }

  _hammer(dt) {
    if (this.hammerState === 'held') return;
    const g = this.game;
    this.hammerT += dt;
    const p = this.proj;
    if (p?.pos) this.lastHammerPos.copy(p.pos);
    if (this.hammerState === 'out') {
      if (this.hammerT > (this.outLife ?? 1) + 0.25) this._startReturn(); // fallback if onExpire never fired
      return;
    }
    // returning: steer along a curve into the hand
    const hand = objPos(this.model.handR, _a, this.center);
    const cur = p?.pos ?? this.lastHammerPos;
    const dist = cur.distanceTo(hand);
    this.backSpeed = Math.min(RETURN_SPEED_MAX, this.backSpeed + 55 * dt);
    _b.subVectors(hand, cur).normalize();
    // lateral offset that shrinks as the hammer closes in => curved path
    _c.set(-_b.z, 0, _b.x).multiplyScalar(this.curveSide * clamp(dist * 0.4, 0, 7));
    this.recallTarget.pos.copy(hand).add(_c); this.recallTarget.center.copy(this.recallTarget.pos);
    if (p?.vel) {
      _t.subVectors(this.recallTarget.pos, cur).normalize().multiplyScalar(this.backSpeed);
      p.vel.lerp(_t, 1 - Math.exp(-7 * dt));
    }
    if (dist < 1.8 || this.hammerT > 4.5 || !p) this._catch();
  }

  _catch() {
    const g = this.game;
    if (this.proj) { this.proj.life = 0; this.proj.dead = true; this.proj.alive = false; this.proj = null; }
    this.model.attachHammer?.();
    this.hasHammer = true; this.hammerState = 'held';
    this.useCooldown('throw', 0.3);
    const hand = objPos(this.model.handR, _a, this.center).clone();
    g.audio?.play('catch'); g.fx?.flash?.(hand, BOLT, 5, 0.15);
    g.fx?.lightning?.(hand.clone().add(_b.set(0, 2, 0)), hand, BOLT, 0.15, 3);
    g.fx?.burst?.(hand, BOLT, 14, 5, 0.3, 0.2);
    g.cam.shake(0.1); rumble(g, 0.4, 0.2, 90);
  }

  // ---- lightning strike -------------------------------------------------------------------------------------------------
  _strike() {
    const g = this.game;
    this.useCooldown('strike', STRIKE_CD);
    aimInfo(this, STRIKE_RANGE, _aim);
    const t = this.findTarget(STRIKE_RANGE, 50);
    const pt = t ? t.pos.clone() : _aim.point.clone();
    if (pt.distanceTo(this.pos) > STRIKE_RANGE) pt.sub(this.pos).setLength(STRIKE_RANGE).add(this.pos);
    _a.subVectors(pt, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z);
    this.actionAnim = 'cast'; this.actionT = 0.55; this.setAnim('cast');
    g.audio?.play('thunder', { volume: 0.5, pitch: 1.2 });
    g.fx?.ring?.(pt.clone().setY(pt.y + 0.1), STRIKE_RADIUS, BOLT, 0.35);
    g.fx?.lightning?.(this.center, this.center.add(_b.set(0, 8, 0)), BOLT, 0.2, 2);
    this.timers.after(0.3, () => this._bolt(pt, STRIKE_DMG * this.dmgMul, STRIKE_RADIUS, true));
  }

  _bolt(pt, dmg, radius, big) {
    const g = this.game;
    g.fx?.lightning?.(new THREE.Vector3(pt.x + rand(-2, 2), pt.y + 80, pt.z + rand(-2, 2)), pt.clone(), 0xc8e8ff, big ? 0.35 : 0.22, big ? 6 : 3);
    g.fx?.flash?.(pt.clone().setY(pt.y + 2), 0xd8f0ff, big ? 8 : 5, big ? 0.25 : 0.15);
    g.fx?.burst?.(pt.clone().setY(pt.y + 0.3), BOLT, big ? 30 : 14, 9, 0.5, 0.3);
    if (big) g.fx?.shockwave?.(pt.clone(), radius, BOLT); else g.fx?.ring?.(pt.clone().setY(pt.y + 0.1), radius, BOLT, 0.3);
    const hits = g.combat?.aoe?.({ center: pt.clone(), radius, damage: dmg, knockback: big ? 14 : 8, up: big ? 9 : 5, stun: big ? 1.2 : 0.6, source: this }) ?? [];
    for (const h of hits) this.registerHit();
    g.audio?.play(big ? 'thunder' : 'lightning', { volume: big ? 0.9 : 0.5 });
    if (big) { g.cam.shake(0.5); rumble(g, 0.8, 0.6, 250); } else g.cam.shake(0.08);
  }

  // ---- God of Thunder aura ----------------------------------------------------------------------------------------------------
  _startAura() {
    const g = this.game;
    this.useCooldown('aura', AURA_CD);
    this.auraT = AURA_TIME; this.dmgMul = 1.3; this.auraTick = 0;
    this.actionAnim = 'cast'; this.actionT = 0.7; this.setAnim('cast');
    this.invuln = Math.max(this.invuln, 0.4);
    g.audio?.play('thunder'); g.cam.shake(0.5); rumble(g, 0.7, 0.7, 300);
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 9, BOLT, 0.6);
    g.fx?.flash?.(this.center, BOLT, 6, 0.3);
    g.hud?.toast?.('GOD OF THUNDER');
  }

  _aura(dt) {
    if (this.auraT <= 0) return;
    const g = this.game;
    this.auraT -= dt;
    this.model.setTint?.(0xaee4ff, this.auraT > 0 ? 0.3 + 0.1 * Math.sin(g.time * 14) : 0);
    this.auraFx -= dt;
    if (this.auraFx <= 0) {
      this.auraFx = 0.07;
      const c = this.center;
      const end = c.clone().add(_a.set(rand(-1, 1), rand(-0.8, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 3.2)));
      g.fx?.lightning?.(c.clone().add(_b.set(rand(-0.3, 0.3), rand(-0.3, 0.5), rand(-0.3, 0.3))), end, BOLT, 0.1, 1);
    }
    this.auraTick -= dt;
    if (this.auraTick <= 0) {
      this.auraTick = AURA_TICK;
      const near = enemiesNear(g, this.pos, AURA_RADIUS);
      for (const e of near.slice(0, 6)) {
        g.fx?.lightning?.(this.center, enemyCenter(e, _c).clone(), BOLT, 0.15, 2);
        _b.subVectors(e.pos, this.pos).setY(0).normalize().multiplyScalar(4); _b.y = 2;
        e.takeDamage?.(AURA_DMG * this.dmgMul, { knockback: _b.clone(), stun: 0.3, source: this, kind: 'lightning' });
      }
      if (near.length) { g.audio?.play('lightning', { volume: 0.3 }); this.addFocus(1.5); }
    }
    if (this.auraT <= 0) { this.dmgMul = 1; this.model.setTint?.(0xaee4ff, 0); g.hud?.toast?.('Aura faded'); }
  }

  // ---- ultimate: Bifrost / Thunder Storm ---------------------------------------------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this.focus = 0; this._resetHammer(true);
    this.flying = false; this.glideT = 0;
    this.ult = { phase: 'rise', t: 0, strike: 0, sound: 0, y0: this.pos.y };
    this.invuln = Math.max(this.invuln, ULT_RISE + ULT_STORM + 1.5);
    g.slowmo?.(0.5, 0.3); g.audio?.play('thunder'); g.hud?.toast?.('THUNDER STORM');
    impactFx(g, this.pos, 8, BLUE, 0.5);
    this.customMovement = true;
  }

  _ultUpdate(dt, input) {
    const g = this.game, u = this.ult;
    u.t += dt;
    this.customMovement = true;
    this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt);
    if (u.phase === 'rise') {
      this.gravityScale = 0;
      this.vel.y = damp(this.vel.y, ULT_HEIGHT / ULT_RISE * 1.3, 5, dt);
      if (this.pos.y - u.y0 > ULT_HEIGHT || u.t > ULT_RISE) { u.phase = 'storm'; u.t = 0; g.audio?.play('thunder'); g.cam.shake(0.6); }
      this.setAnim('fly');
      g.fx?.lightning?.(this.center, this.center.add(_a.set(rand(-3, 3), rand(-2, 3), rand(-3, 3))), BOLT, 0.12, 1);
    } else if (u.phase === 'storm') {
      this.gravityScale = 0; this.vel.y = damp(this.vel.y, 0, 6, dt);
      this.setAnim('cast');
      this.yaw += dt * 3;
      u.strike -= dt;
      if (u.strike <= 0) {
        u.strike = 0.11;
        const near = enemiesNear(g, this.pos, ULT_RANGE);
        let pt;
        if (near.length) { const e = near[(u.n = ((u.n ?? -1) + 1)) % near.length]; pt = e.pos.clone(); pt.x += rand(-1, 1); pt.z += rand(-1, 1); }
        else { pt = this.pos.clone(); const a = Math.random() * Math.PI * 2, r = rand(6, 30); pt.x += Math.cos(a) * r; pt.z += Math.sin(a) * r; pt.y = g.physics.heightAt(pt.x, pt.z, this.pos.y); }
        this._bolt(pt, 55 * this.dmgMul, 4, false);
      }
      u.sound -= dt; if (u.sound <= 0) { u.sound = 0.4; g.audio?.play('thunder', { volume: 0.6 }); rumble(g, 0.7, 0.9, 200); }
      g.cam.shake(0.06);
      g.fx?.lightning?.(this.center, this.center.add(_a.set(rand(-4, 4), rand(-3, 4), rand(-4, 4))), BOLT, 0.1, 2);
      if (u.t > ULT_STORM) { u.phase = 'dive'; u.t = 0; this.gravityScale = 2.5; this.vel.y = -60; this.setAnim('smash'); g.audio?.play('whoosh'); }
    } else {
      this.gravityScale = 2.5; this.vel.y = Math.min(this.vel.y, -50);
      this.setAnim('smash');
      if (this.onGround || u.t > 2.5) this._ultImpact();
    }
  }

  _ultImpact() {
    const g = this.game;
    this.ult = null; this.gravityScale = 1; this.customMovement = false; this.vel.set(0, 0, 0);
    const c = this.pos.clone();
    g.combat?.aoe?.({ center: c, radius: 16, damage: 130 * this.dmgMul, knockback: 24, up: 14, stun: 2, source: this });
    impactFx(g, c, 16, BLUE, 1.2);
    g.fx?.shockwave?.(c.clone(), 10, 0xffffff);
    g.fx?.flash?.(c.clone().setY(c.y + 2), 0xd8f0ff, 9, 0.4);
    for (let i = 0; i < 6; i++) g.fx?.lightning?.(c.clone().setY(c.y + 40), c.clone().add(new THREE.Vector3(Math.cos(i) * 5, 0, Math.sin(i) * 5)), BOLT, 0.3, 4);
    g.audio?.play('thunder'); g.audio?.play('explosion'); g.audio?.play('smash');
    rumble(g, 1, 1, 700); g.slowmo?.(0.4, 0.25);
    this.actionAnim = 'land'; this.actionT = 0.6; this.setAnim('land');
    this.wasAirborneFlight = false;
  }

  // ---- visuals ------------------------------------------------------------------------------------------------------------------------
  updateVisuals(dt) {
    const sp = this.vel.length();
    let pitchT = 0;
    if (this.flying && !this.ult) {
      _a.copy(this.vel).normalize();
      pitchT = Math.acos(clamp(sp > 0.5 ? _a.y : 1, -1, 1)) * clamp((sp - 6) / 24, 0, 1) * 0.95;
    } else if (this.glideT > 0 && !this.onGround) pitchT = 0.5;
    this.pitch = damp(this.pitch, pitchT, 7, dt);
    const yawRate = dt > 0 ? Math.atan2(Math.sin(this.yaw - this._lastYaw), Math.cos(this.yaw - this._lastYaw)) / dt : 0;
    this._lastYaw = this.yaw;
    this.roll = damp(this.roll, this.flying ? clamp(-yawRate * 0.15, -0.6, 0.6) * clamp(sp / 25, 0, 1) : 0, 6, dt);
    applyTilt(this, this.pitch, this.roll);
    // keep the thrown hammer's own glow trail light
    if (this.hammerState !== 'held' && this.proj?.pos && Math.random() < 0.5) this.game.fx?.burst?.(this.proj.pos.clone(), BOLT, 1, 1, 0.25, 0.15);
  }
}
