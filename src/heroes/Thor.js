// Thor (Marvel's Avengers style): Mjolnir throw / recall with lock-on, lightning-charged combos, hammer-spin flight,
// Bifrost dash, God of Thunder aura, God Blast heroic and Thunder Storm.
//
// Controls (keyboard / pad):
//   hold aim RMB / L2     zoom + hammer reticle with lock-on assist (works in flight too)
//   fire LMB / R2 (aiming) tap = precise hammer throw at the reticle;  HOLD = lightning-imbued throw (chain lightning)
//   tap RMB / R1          quick hammer throw (soft lock-on); with the hammer out: recall it (hits enemies on the way back)
//   attack LMB/J/Square   hammer combo; every 4th hit charges Mjolnir, the next attack / throw releases a thunder strike
//   ability E / L1        Lightning Strike (at the reticle target)
//   tap R / tap L2        on the ground: God of Thunder aura;  in flight: BIFROST dash (60 m, rainbow beam, AoE on arrival)
//   Shift / R2            hammer-spin flight (keeps flying while you aim)
//   ultimate Q / R3       on the ground: GOD BLAST (sustained lightning beam steered by the camera); airborne: Thunder Storm
import * as THREE from 'three';
import { Hero } from './Hero.js';
import {
  Timers, BeamMesh, GlowSprite, aimInfo, assistAim, enemiesNear, enemyCenter, beamDamage, rumble, applyTilt, impactFx,
  precisionHit, chainLightning, rainbowBeam, setReticle, hitStop, clamp, damp, rand, objPos,
} from './avengers/util.js';

// ---- tuning ----------------------------------------------------------------
const FLY_SPEED = 34, FLY_AIM_SPEED = 20, FLY_ASCEND = 13, GLIDE_TIME = 1.1;
const THROW_RANGE = 34, THROW_SPEED = 48, THROW_DMG = 55, RETURN_DMG = 45, RETURN_SPEED_MIN = 30, RETURN_SPEED_MAX = 70;
const IMBUE_MIN = 0.5, IMBUE_MAX = 1.0, IMBUE_RANGE = 46, IMBUE_SPEED = 58, IMBUE_DMG = 85;
const STRIKE_CD = 5, STRIKE_DMG = 90, STRIKE_RADIUS = 7, STRIKE_RANGE = 60;
const AURA_TIME = 10, AURA_CD = 25, AURA_RADIUS = 7, AURA_TICK = 0.5, AURA_DMG = 18;
const BIFROST_CD = 8, BIFROST_DIST = 60, BIFROST_DMG = 85, BIFROST_RADIUS = 7;
const ULT_RISE = 1.0, ULT_STORM = 3, ULT_RANGE = 40, ULT_HEIGHT = 18;
const BLAST_RAISE = 1.0, BLAST_TIME = 4.5, BLAST_RANGE = 90, BLAST_WIDTH = 2.6, BLAST_TICK = 0.1, BLAST_DMG = 18;
const BLUE = 0x66ccff, BOLT = 0x9fd8ff;
const AIM_PRESET = { fov: 50, distance: 2.6, shoulder: 0.9, height: 1.7 };

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _as = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3();

export class Thor extends Hero {
  constructor(game) {
    super(game, { id: 'thor', name: 'Thor', color: '#66ccff', maxHp: 170, walkSpeed: 7, runSpeed: 13, jumpSpeed: 11, gravity: 26, radius: 0.5, height: 1.95, airControl: 0.5, mass: 1.4, usesAim: true, aimPreset: AIM_PRESET });
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
    this.hGroup = null; this.hSpin = null; this.hTrail = null; this.imbued = false;
    this.tCharge = 0; this._tDown = false;
    this.charged = false; this.hitStreak = 0;       // Mjolnir storm charge from combos
    this.auraT = 0; this.auraTick = 0; this.auraFx = 0;
    this.ult = null;
    this._impactVy = 0; this._noFocus = false;
    this.audioT = 0; this.sparkT = 0; this.crackleT = 0;
    this.glow = new GlowSprite(game.scene, 0x9fd8ff);
    this.hGlow = new GlowSprite(game.scene, 0x7cc8ff);   // faint blue glow around the flying hammer
    this.hFlip = null; this._pend = null; this._chg = 0; this._flipA = Math.PI / 2;
    this.beam = new BeamMesh(game.scene, 0x7cc8ff);
    this.beamOuter = new BeamMesh(game.scene, 0x4a8cff);
    this.beamT = 0; this.beamFrom = new THREE.Vector3(); this.beamTo = new THREE.Vector3(); this.beamW = 1;
  }

  onActivate() {
    this.flying = false; this.glideT = 0; this.ult = null; this.actionT = 0; this.gravityScale = 1;
    this._resetHammer(true);
  }
  onDeactivate() {
    this._resetHammer(true);
    this.flying = false; this.glideT = 0; this.auraT = 0; this.ult = null; this.dmgMul = 1; this.gravityScale = 1;
    this.charged = false; this.hitStreak = 0; this.tCharge = 0; this._noFocus = false;
    this.timers.clear();
    this.glow.set(_a, 1, 0); this.hGlow.set(_a, 1, 0); this.beam.hide(); this.beamOuter.hide(); this.beamT = 0;
    setReticle(this, null);
    this.game.cam.fovKick = 0;
    this.model.group.rotation.set(0, this.yaw, 0);
    this.model.setTint?.(BLUE, 0);
  }

  get abilityHints() {
    return [
      { action: 'special', label: this.hasHammer ? 'Hammer Throw' : 'Recall Hammer', cooldown: this.cooldownFrac('throw'), active: !this.hasHammer || this.charged },
      { action: 'ability', label: 'Lightning Strike', cooldown: this.cooldownFrac('strike') },
      { action: 'ability2', label: this.flying ? 'Bifrost' : 'God of Thunder', cooldown: this.flying ? this.cooldownFrac('bifrost') : this.cooldownFrac('aura'), active: this.auraT > 0 },
      { action: 'ultimate', label: this.flying || !this.onGround ? 'Thunder Storm' : 'God Blast', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  registerHit() { this.combo++; this.comboTimer = 2.5; if (!this._noFocus) this.addFocus(4); }

  // ---- hammer bookkeeping ----------------------------------------------------------------
  _resetHammer(silent) {
    this._pend = null;
    if (this.proj) { this.proj.life = 0; this.proj.dead = true; this.proj.alive = false; this.proj = null; }
    this._dropHammerMesh();
    if (!this.model.hammerAttached) { this.model.attachHammer?.(); }
    this.hasHammer = true; this.hammerState = 'held'; this.imbued = false;
    void silent;
  }
  _dropHammerMesh() {
    if (this.hTrail) { this.hTrail.stop?.(); this.hTrail = null; }
    if (this.hGroup?.parent) this.hGroup.parent.remove(this.hGroup);
    this.hGlow?.set(_a, 1, 0);
  }
  /** Flying hammer visual: the one real Mjolnir mesh leaves the hand and is re-parented under a wrapper the projectile moves.
   *  hGroup (travel direction, +Z) > hFlip (head-first / handle-first) > hSpin (spin about the handle axis) > Mjolnir. */
  _hammerMesh() {
    const g = this.game;
    if (!this.hGroup) {
      this.hGroup = new THREE.Group(); this.hFlip = new THREE.Group(); this.hSpin = new THREE.Group();
      this.hGroup.add(this.hFlip); this.hFlip.add(this.hSpin);
      this.hGroup.userData.noOrient = true;
    }
    if (this.model.hammerAttached) {
      const hm = this.model.detachHammer?.();
      if (hm) { hm.position.set(0, -0.26, 0); hm.quaternion.identity(); hm.scale.setScalar(1.5); this.hSpin.add(hm); this.model.mjolnir?.snap?.(); }
    }
    if (!this.hGroup.parent) g.scene.add(this.hGroup);
    return this.hGroup;
  }

  // ---- main update ---------------------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) { this.chain = 0; if (this.chainT < -3) this.hitStreak = Math.min(this.hitStreak, 0); }

    this._hammer(dt);
    this._aura(dt);
    if (this.ult) {
      setReticle(this, null);
      if (this.ult.type === 'blast') this._blastUpdate(dt, input); else this._ultUpdate(dt, input);
      this._finish(dt); return;
    }
    setReticle(this, this.aiming ? 'hammer' : null);

    // flight: hold swing (needs the hammer in hand); aiming in flight keeps you up (R2 is "fire" on a pad then)
    const wantFly = (input.down('swing') || (this.flying && this.aiming)) && this.hasHammer && this.actionT <= 0.2;
    if (wantFly && !this.flying) this._takeoff();
    if (!wantFly && this.flying) { this.flying = false; this.glideT = GLIDE_TIME; }
    if (this.flying) this._flyMove(dt, input);
    else if (this.glideT > 0 && !this.onGround) this._glide(dt, input);
    else { this.glideT = 0; this.customMovement = false; this.gravityScale = 1; }

    this._aimedThrow(dt, input);
    this._abilities(dt, input);
    this._finish(dt);
    void g;
  }

  _finish(dt) {
    this._impactVy = this.vel.y;
    if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
    else if (this.tCharge > 0.1 && this.aiming) this.setAnim('charge');
    else if (this.aiming && !this.ult) this.setAnim('aim', this.vel.length());
    else if (this.flying) this.setAnim(this.vel.length() > 14 ? 'fly' : 'hover', this.vel.length());
    else if (this.glideT > 0 && !this.onGround) this.setAnim('glide', this.vel.length());
    const sp = this.vel.length();
    this.fov = damp(this.fov, this.flying && !this.aiming ? 12 * clamp((sp - 10) / 25, 0, 1) : 0, 4, dt);
    this.game.cam.fovKick = this.fov;
    if (this.aiming && !this.ult) {
      const f = clamp(this.tCharge / IMBUE_MAX, 0, 1);
      if (f > 0.2) this.game.cam.requestAim({ ...AIM_PRESET, fov: 50 - f * 8 });
    }
  }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    if (this.aiming) {
      const lim = this.walkSpeed * 0.85, hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > lim && this.onGround) { this.vel.x *= lim / hs; this.vel.z *= lim / hs; }
      this.faceTowards(this.game.cam.forward, dt, 20);
      this.setAnim(this.onGround ? 'aim' : (this.vel.y > 0 ? 'jump' : 'fall'), hs);
    }
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
    const spd = this.aiming ? FLY_AIM_SPEED : FLY_SPEED;
    if (wl > 0.1) tgt.copy(_w).multiplyScalar(spd);
    else tgt.set(0, 0, 0);
    if (input.down('jump')) tgt.y += FLY_ASCEND;
    if (input.down('dodge')) tgt.y -= FLY_ASCEND;
    if (wl < 0.05 && !input.down('jump')) tgt.y += Math.sin(g.time * 2.2) * 0.5;
    this.vel.lerp(tgt, 1 - Math.exp(-(wl > 0.1 ? 2.2 : 3.5) * dt));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.aiming) this.faceTowards(cam.forward, dt, 20);
    else if (hs > 3) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 8);
    else this.faceTowards(cam.forward, dt, 5);
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
    if (this.aiming) this.faceTowards(cam.forward, dt, 16);
    else if (hs > 2) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 6);
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
    const charging = this.tCharge > 0.05;
    if (input.pressed('attack') && free && !charging) this._combo();
    if (this.pressedSpecial()) {
      if (this.hasHammer && free && (this.cooldowns.throw || 0) <= 0) this._throw({ aimed: false, imbued: this.charged });
      else if (!this.hasHammer && this.hammerState === 'out') this._startReturn();
    }
    if (input.pressed('ability') && free && (this.cooldowns.strike || 0) <= 0) this._strike();
    if (this.pressedAbility2()) {
      if (this.flying) { if ((this.cooldowns.bifrost || 0) <= 0) this._bifrost(); }
      else if ((this.cooldowns.aura || 0) <= 0 && this.auraT <= 0) this._startAura();
    }
    if (input.pressed('ultimate') && this.focus >= 100) {
      if (this.flying || !this.onGround) this._startUlt(); else this._startBlast();
    }
    if (!this.flying && this.onGround && input.pressed('dodge') && (this.cooldowns.dash || 0) <= 0) {
      this.useCooldown('dash', 0.8);
      const w = g.cam.moveVector(input.move, _a); if (w.lengthSq() < 0.01) w.copy(this.forward);
      w.normalize(); this.vel.x = w.x * 26; this.vel.z = w.z * 26; this.yaw = Math.atan2(w.x, w.z);
      this.invuln = Math.max(this.invuln, 0.25); this.actionAnim = 'dash'; this.actionT = 0.3;
      g.audio?.play('whoosh'); g.fx?.lightning?.(this.center, this.center.addScaledVector(w, -3), BOLT, 0.12, 1);
    }
  }

  /** Aimed hammer: tap fire = precise throw, hold = lightning-imbued throw (released on button up). Fire while it is out = recall. */
  _aimedThrow(dt, input) {
    const g = this.game;
    const fd = this.aiming && this.fireDown();
    if (this.aiming) {
      if (this.hasHammer && this.hammerState === 'held') {
        if (fd) {
          this.tCharge = Math.min(IMBUE_MAX, this.tCharge + dt);
          const f = this.tCharge / IMBUE_MAX;
          if (this.tCharge > 0.2) {
            this.crackleT -= dt;
            if (this.crackleT <= 0) {
              this.crackleT = 0.06;
              const h = objPos(this.model.handR, _a, this.center);
              g.fx?.lightning?.(h.clone(), h.clone().add(_b.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).multiplyScalar(0.8 + f * 1.2)), BOLT, 0.1, 1);
            }
            g.cam.shake(0.01 + f * 0.03); rumble(g, 0.05 + f * 0.3, 0.1 + f * 0.3, 50);
            if (f >= 1 && !this._full) { this._full = true; g.audio?.play('ui_move', { pitch: 1.6 }); g.fx?.flash?.(objPos(this.model.handR, _a, this.center), BOLT, 4, 0.15); }
          }
        } else if (this._tDown && this.actionT <= 0.15 && (this.cooldowns.throw || 0) <= 0) {
          this._throw({ aimed: true, imbued: this.tCharge >= IMBUE_MIN || this.charged, power: this.tCharge });
          this.tCharge = 0; this._full = false;
        } else { this.tCharge = fd ? this.tCharge : 0; this._full = false; }
      } else if (!this.hasHammer && this.hammerState === 'out' && this.firePressed()) this._startReturn();
      else this.tCharge = 0;
    } else { this.tCharge = 0; this._full = false; }
    this._tDown = fd;
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
    const dur = armed ? [0.38, 0.38, 0.7] : [0.3, 0.3, 0.45], delay = armed ? [0.13, 0.13, 0.3] : [0.08, 0.08, 0.14];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.1;
    g.audio?.play('whoosh', { volume: 0.5 });
    if (armed) { const tr = g.fx?.trail?.(this.model.mjolnir?.tip ?? this.model.handR, this.charged ? 0xc8e8ff : 0xdfe9f5, 0.22, 0.26); if (tr) this.timers.after(dur[step] + 0.05, () => tr.stop?.()); }
    if (this.charged && armed) g.fx?.lightning?.(objPos(this.model.handR, _a, this.center).clone(), objPos(this.model.handR, _b, this.center).clone().add(_c.set(0, 3, 0)), BOLT, 0.2, 2);
    this.timers.after(delay[step], () => {
      if (!this.active) return;
      const fwd = this.forward;
      const hits = g.combat?.melee?.({ origin: this.center, forward: fwd, range: armed ? 3.4 : 2.6, arc: 120, damage: dmg[step] * this.dmgMul, knockback: kn[step], up: up[step], stun: step === 2 ? 1 : 0.3, source: this, heavy: armed && step === 2 }) ?? [];
      for (const h of hits) g.fx?.burst?.(enemyCenter(h, _b).clone(), armed ? BOLT : 0xffffff, 8, 5, 0.3, 0.2);
      if (hits.length) {
        g.audio?.play(step === 2 ? 'heavyhit' : 'hammer'); rumble(g, 0.3 + step * 0.2, 0.2, 100);
        if (armed) {
          this.hitStreak += hits.length;
          if (this.charged) {
            // release the stored storm on the first thing struck
            this.charged = false;
            const tp = hits[0].pos.clone();
            this._bolt(tp, 70 * this.dmgMul, 6, true);
            hitStop(g, 0.09, 0.05);
          } else if (this.hitStreak >= 4) this._chargeMjolnir();
          if (step === 2 && !hits.length) hitStop(g, 0.05, 0.1);
        }
      }
      if (armed && step === 2) {
        // lightning-infused finisher
        const c = this.pos.clone().addScaledVector(fwd, 3);
        const hand = objPos(this.model.handR, _c, this.center).clone();
        g.fx?.lightning?.(hand.clone().setY(hand.y + 6), c.clone().setY(c.y + 0.2), BOLT, 0.25, 4);
        for (const h of hits) g.fx?.lightning?.(c.clone().setY(c.y + 1), enemyCenter(h, _b).clone(), BOLT, 0.25, 2);
        g.combat?.aoe?.({ center: c, radius: 5, damage: 35 * this.dmgMul, knockback: 14, up: 7, stun: 1, source: this });
        impactFx(g, c, 5, BLUE, 0.45);
        g.fx?.flash?.(c.clone().setY(c.y + 1), BOLT, 6, 0.2);
        g.audio?.play('thunder'); g.audio?.play('lightning', { volume: 0.6 });
        rumble(g, 0.7, 0.5, 200);
        if (hits.length) hitStop(g, 0.08, 0.05);
      } else g.cam.shake(0.1);
    });
  }

  _chargeMjolnir() {
    const g = this.game;
    this.charged = true; this.hitStreak = 0;
    g.hud?.toast?.('MJOLNIR CHARGED');
    g.audio?.play('thunder', { volume: 0.5, pitch: 1.3 }); g.audio?.play('lightning', { volume: 0.5 });
    const h = objPos(this.model.handR, _a, this.center).clone();
    g.fx?.lightning?.(h.clone().setY(h.y + 7), h, 0xc8e8ff, 0.3, 3);
    g.fx?.flash?.(h, BOLT, 5, 0.25); g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 4, BOLT, 0.4);
    rumble(g, 0.5, 0.4, 150); g.cam.shake(0.15);
  }

  // ---- hammer throw -------------------------------------------------------------------------------------------
  /** opts: aimed (precise reticle throw vs soft lock-on), imbued (lightning chain), power (0..1 charge) */
  _throw(opts = {}) {
    const g = this.game;
    const { aimed = false, imbued = false, power = 0 } = opts;
    this.useCooldown('throw', 0.5);
    const from = objPos(this.model.handR, _a, this.center).clone();
    const aa = assistAim(this, from, 80, aimed ? 6 : 14, _as);
    const to = aa.point.clone();
    const dir = to.clone().sub(from).normalize();
    const range = imbued ? IMBUE_RANGE : THROW_RANGE, speed = imbued ? IMBUE_SPEED : THROW_SPEED;
    const dist = clamp(from.distanceTo(to) + 6, 12, range);
    this.hasHammer = false; this.hammerState = 'out'; this.hammerT = 0; this.outLife = dist / speed + 0.16;
    this.imbued = imbued; if (imbued && this.charged) this.charged = false;
    this.curveSide = Math.random() < 0.5 ? -1 : 1;
    this.lastHammerPos.copy(from);
    if (!aimed || !this.aiming) this.yaw = Math.atan2(dir.x, dir.z);
    this.actionAnim = 'throw'; this.actionT = 0.4; this.setAnim('throw');
    g.audio?.play('throw');
    const tok = this._pend = {};
    // wind-up (the rig's throw pose cocks the arm back), then release on the forward stroke
    this.timers.after(0.16, () => {
      if (this._pend !== tok || !this.active) return;
      this._pend = null;
      this._release(to, dist, speed, imbued, power);
    });
  }

  _release(to, dist, speed, imbued, power) {
    const g = this.game;
    const from = objPos(this.model.handR, _a, this.center).clone();
    const dir = to.clone().sub(from); if (dir.lengthSq() < 1e-4) dir.copy(this.forward); dir.normalize();
    const mesh = this._hammerMesh();
    mesh.position.copy(from);
    this.lastHammerPos.copy(from); this.hammerT = 0; this.outLife = dist / speed;
    g.audio?.play('whoosh');
    g.fx?.flash?.(from, BOLT, imbued ? 5 : 3, 0.12);
    if (imbued) { g.fx?.lightning?.(from.clone(), from.clone().addScaledVector(dir, 4), 0xc8e8ff, 0.2, 3); g.cam.shake(0.2); rumble(g, 0.6, 0.4, 140); g.audio?.play('thunder', { volume: 0.4 }); }
    else g.cam.shake(0.06);
    if (this.hTrail) this.hTrail.stop?.();
    this.hTrail = g.fx?.trail?.(this.model.mjolnir?.tip ?? this.hGroup, imbued ? 0xe0f2ff : 0xbfe6ff, imbued ? 0.7 : 0.4, 0.4) ?? null;
    const dmg = (imbued ? IMBUE_DMG * (0.8 + 0.2 * power) : THROW_DMG) * this.dmgMul;
    this.proj = g.combat?.projectile?.({
      pos: from, vel: dir.clone().multiplyScalar(speed), damage: dmg, radius: imbued ? 1.3 : 1.1, life: this.outLife, color: BOLT, size: 0.5, mesh,
      kind: 'hammer', team: 'player', pierce: true, source: this, heavy: imbued, knockback: imbued ? 9 : 5,
      onHit: (tg, p) => this._hammerHit(tg, p, dmg, imbued),
      onExpire: (p) => { if (this.hammerState === 'out') { if (p?.pos) this.lastHammerPos.copy(p.pos); this._startReturn(); } },
    }) ?? null;
  }

  _hammerHit(tg, p, dmg, imbued) {
    const g = this.game;
    g.audio?.play('hammer'); g.audio?.play('heavyhit', { volume: 0.7 }); rumble(g, 0.5, 0.4, 100);
    const pt = p?.pos ?? tg.pos;
    g.fx?.ring?.(pt.clone(), imbued ? 4.5 : 2.8, 0xdfeeff, 0.3); g.fx?.shockwave?.(pt.clone(), imbued ? 4 : 2.4, BOLT);
    g.fx?.burst?.(pt.clone(), 0xfff2c0, 16, 9, 0.35, 0.18); g.fx?.hitSpark?.(pt.clone(), 0xffffff, true);
    g.cam.shake(0.14); if (!imbued) hitStop(g, 0.06, 0.07);
    g.fx?.lightning?.(pt.clone(), enemyCenter(tg, _c).clone(), BOLT, 0.12, 1);
    if (this.aiming || imbued) precisionHit(this, tg, pt, dmg);
    if (imbued) {
      chainLightning(this, tg, dmg * 0.45, 4, 10, 0xc8e8ff);
      g.fx?.flash?.(pt.clone(), 0xd8f0ff, 5, 0.15); g.fx?.ring?.(pt.clone(), 4, BOLT, 0.3);
      g.audio?.play('lightning', { volume: 0.6 }); g.cam.shake(0.25); hitStop(g, 0.07, 0.06);
    }
  }

  _startReturn() {
    if (this.hammerState !== 'out') return;
    const g = this.game;
    if (this._pend) { this._pend = null; this.hasHammer = true; this.hammerState = 'held'; return; } // recalled during the wind-up
    if (this.proj) { this.proj.life = 0; this.proj.dead = true; this.proj.alive = false; if (this.proj.pos) this.lastHammerPos.copy(this.proj.pos); }
    this.hammerState = 'back'; this.hammerT = 0; this.backSpeed = RETURN_SPEED_MIN;
    const hand = objPos(this.model.handR, _a, this.center);
    const dir = _b.subVectors(hand, this.lastHammerPos).normalize();
    this.recallTarget.pos.copy(hand); this.recallTarget.center.copy(hand);
    const mesh = this._hammerMesh();
    const imbued = this.imbued;
    this.proj = g.combat?.projectile?.({
      pos: this.lastHammerPos.clone(), vel: dir.clone().multiplyScalar(RETURN_SPEED_MIN), damage: RETURN_DMG * this.dmgMul, radius: 1.1, life: 5, color: BOLT, size: 0.5, mesh,
      kind: 'hammer', team: 'player', pierce: true, homing: this.recallTarget, source: this,
      onHit: (tg, p) => this._hammerHit(tg, p, RETURN_DMG, false) || (imbued && chainLightning(this, tg, RETURN_DMG * 0.35, 2, 8, 0xc8e8ff)),
    }) ?? null;
    g.audio?.play('whoosh'); g.audio?.play('thunder', { volume: 0.25, pitch: 1.4 });
    g.fx?.lightning?.(this.lastHammerPos.clone(), hand.clone(), 0xc8e8ff, 0.2, 2);
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
    this.backSpeed = Math.min(RETURN_SPEED_MAX, this.backSpeed + 55 * dt, 16 + dist * 7);
    _b.subVectors(hand, cur).normalize();
    _c.set(-_b.z, 0, _b.x).multiplyScalar(this.curveSide * clamp(dist * 0.4, 0, 7));
    this.recallTarget.pos.copy(hand).add(_c); this.recallTarget.center.copy(this.recallTarget.pos);
    if (p?.vel) {
      _t.subVectors(this.recallTarget.pos, cur).normalize().multiplyScalar(this.backSpeed);
      p.vel.lerp(_t, 1 - Math.exp(-7 * dt));
    }
    if (dist < 1.0 || this.hammerT > 4.5 || !p) this._catch();
    void g;
  }

  _catch() {
    const g = this.game;
    if (this.proj) { this.proj.life = 0; this.proj.dead = true; this.proj.alive = false; this.proj = null; }
    this._dropHammerMesh();
    this.model.attachHammer?.();
    this.hasHammer = true; this.hammerState = 'held'; this.imbued = false;
    this.useCooldown('throw', 0.3);
    this.actionAnim = 'catch'; this.actionT = 0.42; this.setAnim('catch');
    const hand = objPos(this.model.handR, _a, this.center).clone();
    g.audio?.play('catch'); g.fx?.flash?.(hand, BOLT, 5, 0.15);
    g.fx?.lightning?.(hand.clone().add(_b.set(0, 2, 0)), hand, BOLT, 0.15, 3);
    g.fx?.burst?.(hand, BOLT, 14, 5, 0.3, 0.2);
    g.fx?.ring?.(hand.clone(), 1.6, 0xdfeeff, 0.2); g.fx?.hitSpark?.(hand.clone(), 0xffffff, true);
    g.cam.shake(0.2); rumble(g, 0.5, 0.3, 110);
  }

  // ---- lightning strike -------------------------------------------------------------------------------------------------
  _strike() {
    const g = this.game;
    this.useCooldown('strike', STRIKE_CD);
    const aa = assistAim(this, this.center, STRIKE_RANGE, this.aiming ? 8 : 14, _as);
    const pt = aa.target ? aa.target.pos.clone() : aa.point.clone();
    if (pt.distanceTo(this.pos) > STRIKE_RANGE) pt.sub(this.pos).setLength(STRIKE_RANGE).add(this.pos);
    _a.subVectors(pt, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z);
    this.actionAnim = 'cast'; this.actionT = 0.55; this.setAnim('cast');
    g.audio?.play('thunder', { volume: 0.5, pitch: 1.2 });
    g.fx?.ring?.(pt.clone().setY(pt.y + 0.1), STRIKE_RADIUS, BOLT, 0.35);
    g.fx?.lightning?.(this.center, this.center.add(_b.set(0, 8, 0)), BOLT, 0.2, 2);
    const charged = this.charged; if (charged) this.charged = false;
    this.timers.after(0.3, () => this._bolt(pt, STRIKE_DMG * (charged ? 1.4 : 1) * this.dmgMul, STRIKE_RADIUS * (charged ? 1.3 : 1), true));
  }

  _bolt(pt, dmg, radius, big) {
    const g = this.game;
    g.fx?.lightning?.(new THREE.Vector3(pt.x + rand(-2, 2), pt.y + 80, pt.z + rand(-2, 2)), pt.clone(), 0xc8e8ff, big ? 0.35 : 0.22, big ? 6 : 3);
    g.fx?.flash?.(pt.clone().setY(pt.y + 2), 0xd8f0ff, big ? 8 : 5, big ? 0.25 : 0.15);
    g.fx?.burst?.(pt.clone().setY(pt.y + 0.3), BOLT, big ? 30 : 14, 9, 0.5, 0.3);
    if (big) g.fx?.shockwave?.(pt.clone(), radius, BOLT); else g.fx?.ring?.(pt.clone().setY(pt.y + 0.1), radius, BOLT, 0.3);
    g.combat?.aoe?.({ center: pt.clone(), radius, damage: dmg, knockback: big ? 14 : 8, up: big ? 9 : 5, stun: big ? 1.2 : 0.6, source: this });
    g.audio?.play(big ? 'thunder' : 'lightning', { volume: big ? 0.9 : 0.5 });
    if (big) { g.cam.shake(0.55); rumble(g, 0.8, 0.6, 250); } else g.cam.shake(0.08);
  }

  // ---- Bifrost dash ------------------------------------------------------------------------------------------------------
  _bifrost() {
    const g = this.game;
    this.useCooldown('bifrost', BIFROST_CD);
    const dir = g.cam.aimDirection(_aim.dir).normalize().clone();
    const from = this.center;
    const hit = g.physics.raycast(from, dir, BIFROST_DIST);
    const dist = hit ? Math.max(2, hit.distance - 1.6) : BIFROST_DIST;
    const to = from.clone().addScaledVector(dir, dist);
    // the rainbow bridge, damage along it, then the arrival slam
    rainbowBeam(g, from, to, 1.1, 0.8);
    g.fx?.flash?.(from, 0xffffff, 8, 0.3);
    g.fx?.ring?.(from.clone(), 5, 0xffffff, 0.5);
    g.fx?.burst?.(from, 0xffffff, 26, 9, 0.5, 0.3);
    beamDamage(this, from, dir, dist, 2.4, 45, 12, 0.8, 'bifrost', true);
    this.pos.copy(to); this.pos.y -= this.height * 0.5;
    const gh = g.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 1.5);
    if (this.pos.y < gh) this.pos.y = gh;
    this.vel.copy(dir).multiplyScalar(18);
    this.invuln = Math.max(this.invuln, 0.5);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.actionAnim = 'cast'; this.actionT = 0.35; this.setAnim('cast');
    const arrive = this.center;
    g.fx?.flash?.(arrive, 0xffffff, 9, 0.3);
    g.fx?.burst?.(arrive, 0xffffff, 30, 10, 0.6, 0.35);
    impactFx(g, this.pos, BIFROST_RADIUS, BOLT, 0.8);
    g.fx?.lightning?.(arrive.clone().setY(arrive.y + 30), arrive.clone(), 0xffffff, 0.3, 4);
    const hits = g.combat?.aoe?.({ center: arrive, radius: BIFROST_RADIUS, damage: BIFROST_DMG * this.dmgMul, knockback: 18, up: 8, stun: 1.4, source: this }) ?? [];
    g.audio?.play('thunder'); g.audio?.play('explosion', { volume: 0.5 }); g.audio?.play('whoosh', { volume: 0.9 });
    g.cam.shake(0.8); rumble(g, 1, 0.8, 300); this.fov += 22;
    g.slowmo?.(0.18, 0.3);
    if (hits.length) hitStop(g, 0.06, 0.06);
    g.fx?.text?.(arrive.clone().setY(arrive.y + 2.2), 'BIFROST', 0xffffff, { size: 1.4, life: 1 });
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

  // ---- ultimate A: God Blast (sustained beam from the raised hammer) -------------------------------------------------------
  _startBlast() {
    const g = this.game;
    this.focus = 0; this.charged = false; this.tCharge = 0;
    this._resetHammerIfOut();
    this.flying = false; this.glideT = 0;
    this.ult = { type: 'blast', phase: 'raise', t: 0, tick: 0, n: 0, y0: this.pos.y, sfx: 0, shakeT: 0 };
    this.invuln = Math.max(this.invuln, BLAST_RAISE + BLAST_TIME + 1);
    this._noFocus = true; this.customMovement = true;
    g.slowmo?.(0.9, 0.3); g.audio?.play('thunder'); g.hud?.toast?.('GOD BLAST');
    impactFx(g, this.pos, 8, BLUE, 0.6);
    g.fx?.lightning?.(this.pos.clone().setY(this.pos.y + 40), this.center, 0xffffff, 0.35, 5);
  }
  _resetHammerIfOut() { if (!this.hasHammer) this._resetHammer(true); }

  _hammerTip(out) {
    const h = objPos(this.model.handR, out, this.center);
    return out.set(h.x, h.y + 0.9, h.z);
  }

  _blastUpdate(dt, input) {
    const g = this.game, u = this.ult;
    u.t += dt;
    this.customMovement = true;
    this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt);
    this.gravityScale = 0;
    const hover = u.y0 + 1.6;
    this.vel.y = clamp((hover - this.pos.y) * 4, -6, 8);
    this.faceTowards(g.cam.forward, dt, 14);
    const tip = this._hammerTip(_a).clone();
    if (u.phase === 'raise') {
      this.setAnim('cast');
      const f = clamp(u.t / BLAST_RAISE, 0, 1);
      g.cam.requestAim({ fov: 64 - f * 6, distance: 5.2, shoulder: 1.3, height: 2.3, blend: 5 });
      g.fx?.lightning?.(tip.clone().setY(tip.y + 12 * (1 - f) + 4), tip.clone(), 0xc8e8ff, 0.1, 2);
      g.fx?.flash?.(tip, BOLT, 2 + f * 6, 0.06);
      for (let i = 0; i < 2; i++) g.fx?.lightning?.(this.center, this.center.add(_b.set(rand(-3, 3), rand(-2, 4), rand(-3, 3))), BOLT, 0.1, 1);
      g.cam.shake(0.03 + f * 0.1); rumble(g, 0.1 + f * 0.6, 0.2 + f * 0.7, 60);
      this.glow.set(tip, 0.6 + f * 3, 0.6 + f * 0.4);
      if (u.t >= BLAST_RAISE) { u.phase = 'beam'; u.t = 0; g.audio?.play('thunder'); g.audio?.play('lightning'); g.cam.shake(1.0); rumble(g, 1, 1, 300); g.fx?.flash?.(tip, 0xffffff, 10, 0.3); g.fx?.ring?.(tip.clone(), 7, BOLT, 0.5); }
      return;
    }
    if (u.phase === 'beam') {
      this.setAnim('cast');
      g.cam.requestAim({ fov: 60, distance: 5.2, shoulder: 1.3, height: 2.3, blend: 6 });
      aimInfo(this, 140, _aim);
      const dir = _aim.point.clone().sub(tip).normalize();
      const hit = g.physics.raycast(tip, dir, BLAST_RANGE);
      const len = hit ? hit.distance : BLAST_RANGE;
      const to = tip.clone().addScaledVector(dir, len);
      this.beamFrom.copy(tip); this.beamTo.copy(to); this.beamW = BLAST_WIDTH * (1 + 0.15 * Math.sin(u.t * 41)); this.beamT = 0.1;
      this.glow.set(tip, 2.6 + Math.random() * 0.5, 1);
      // crackling sheath around the shaft
      for (let i = 0; i < 2; i++) {
        const p0 = tip.clone().lerp(to, Math.random() * 0.9), p1 = p0.clone().add(_b.set(rand(-2, 2), rand(-2, 2), rand(-2, 2)));
        g.fx?.lightning?.(p0, p1, 0xc8e8ff, 0.1, 1);
      }
      u.tick -= dt;
      if (u.tick <= 0) {
        u.tick = BLAST_TICK; u.n++;
        beamDamage(this, tip, dir, len, BLAST_WIDTH * 0.8, BLAST_DMG, 12, 0.5, 'godblast', u.n % 4 === 0);
        g.combat?.aoe?.({ center: to.clone(), radius: 5, damage: 8, knockback: 9, up: 4, stun: 0.4, source: this, falloff: false });
        g.fx?.burst?.(to, BOLT, 8, 10, 0.5, 0.35); g.fx?.flash?.(to, 0xd8f0ff, 6, 0.12);
        if (u.n % 3 === 0) { g.fx?.ring?.(to.clone().setY(to.y + 0.15), 4 + Math.random() * 3, BOLT, 0.3); g.fx?.dust?.(to, 4, 4); }
        if (u.n % 5 === 0) {
          const near = enemiesNear(g, to, 8);
          if (near[0]) chainLightning(this, near[0], 12, 3, 9, 0xc8e8ff);
          g.fx?.lightning?.(new THREE.Vector3(to.x + rand(-3, 3), to.y + 60, to.z + rand(-3, 3)), to.clone(), 0xffffff, 0.25, 4);
        }
      }
      u.sfx -= dt; if (u.sfx <= 0) { u.sfx = 0.45; g.audio?.play('lightning', { volume: 0.7 }); g.audio?.play('thunder', { volume: 0.3 }); }
      u.shakeT -= dt; if (u.shakeT <= 0) { u.shakeT = 0.1; rumble(g, 0.6, 0.9, 120); }
      g.cam.shake(0.07);
      if (u.t >= BLAST_TIME) { u.phase = 'end'; u.t = 0; g.cam.shake(0.4); g.fx?.flash?.(tip, 0xffffff, 8, 0.25); g.fx?.ring?.(tip.clone(), 6, BOLT, 0.5); }
      return;
    }
    this.setAnim('hover');
    this.glow.set(tip, 1, 0);
    if (u.t > 0.5) { this.ult = null; this._noFocus = false; this.customMovement = false; this.gravityScale = 1; this.beamT = 0; this.actionT = 0; }
  }

  // ---- ultimate B: Thunder Storm (airborne) ---------------------------------------------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this.focus = 0; this._resetHammer(true);
    this.flying = false; this.glideT = 0;
    this.ult = { type: 'storm', phase: 'rise', t: 0, strike: 0, sound: 0, y0: this.pos.y };
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
    impactFx(g, c, 16, BLUE, 1.3);
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
    const g = this.game;
    const sp = this.vel.length();
    let pitchT = 0;
    if (this.flying && !this.ult) {
      _a.copy(this.vel).normalize();
      pitchT = Math.acos(clamp(sp > 0.5 ? _a.y : 1, -1, 1)) * clamp((sp - 6) / 24, 0, 1) * 0.95;
      if (this.aiming) pitchT *= 0.35;
    } else if (this.glideT > 0 && !this.onGround) pitchT = 0.5;
    this.pitch = damp(this.pitch, pitchT, 6, dt);
    const yawRate = dt > 0 ? Math.atan2(Math.sin(this.yaw - this._lastYaw), Math.cos(this.yaw - this._lastYaw)) / dt : 0;
    this._lastYaw = this.yaw;
    let rollT = 0;
    if (this.flying && !this.ult) {
      rollT = clamp(-yawRate * 0.15, -0.6, 0.6) * clamp(sp / 25, 0, 1);
      if (this.aiming) { const lat = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw); rollT += clamp(-lat * 0.02, -0.4, 0.4); }
    }
    this.roll = damp(this.roll, rollT, 5, dt);
    applyTilt(this, this.pitch, this.roll);

    // flying Mjolnir: head leads, spins about its own handle axis; on the way back it turns to arrive handle-first
    this.model.hammerSpin = this.flying && this.hasHammer && !this.ult;
    if (this.hGroup?.parent && this.hSpin) {
      const v = this.proj?.vel;
      if (v && v.lengthSq() > 1) { _d.copy(this.hGroup.position).add(v); this.hGroup.lookAt(_d); }
      let k = 0;
      if (this.hammerState === 'back') { _b.copy(objPos(this.model.handR, _a, this.center)); k = clamp((9 - this.hGroup.position.distanceTo(_b)) / 6, 0, 1); k = k * k * (3 - 2 * k); }
      this._flipA = Math.PI / 2 - k * Math.PI;
      this.hFlip.rotation.x = this._flipA;
      this.hSpin.rotation.y += dt * (this.hammerState === 'back' ? 17 : 15) * (1 - k * 0.9);
      this.model.mjolnir?.update?.(dt);
      const hp = this.hGroup.position;
      this.hGlow.set(hp, this.imbued ? 3.2 : 1.9, this.imbued ? 0.55 : 0.28);
      if (Math.random() < (this.imbued ? 0.9 : 0.4)) g.fx?.burst?.(hp.clone(), this.imbued ? 0xc8e8ff : BOLT, 1, 1, 0.25, 0.15);
      // short crackling arcs wrapped around the flying hammer
      if (Math.random() < (this.imbued ? 0.9 : 0.55)) g.fx?.lightning?.(hp.clone().add(_b.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))), hp.clone().add(_b.set(rand(-0.9, 0.9), rand(-0.9, 0.9), rand(-0.9, 0.9))), this.imbued ? 0xc8e8ff : BOLT, 0.08, 1);
      if (this.imbued && Math.random() < 0.5) g.fx?.lightning?.(hp.clone(), hp.clone().add(_b.set(rand(-1.6, 1.6), rand(-1.6, 1.6), rand(-1.6, 1.6))), 0xc8e8ff, 0.1, 1);
      this.audioT -= dt;
      if (this.audioT <= 0) { this.audioT = 0.28; g.audio?.play('whoosh', { volume: 0.35, pitch: 0.9 + Math.random() * 0.3 }); }
    } else this.hGlow.set(_a, 1, 0);
    // engraving glow: charged storm / imbue / God of Thunder aura / charging a throw
    const wantChg = (this.charged || this.imbued || this.auraT > 0) ? 0.75 + 0.25 * Math.sin(g.time * 22) : (this.tCharge > 0.15 ? clamp(this.tCharge / IMBUE_MAX, 0, 1) * 0.8 : 0);
    this._chg = damp(this._chg, wantChg, 10, dt);
    this.model.setHammerCharge?.(this._chg);
    // stored storm in Mjolnir / imbue charge: glow + crackle at the hand
    if (!this.ult) {
      if (this.charged && this.hasHammer) {
        const h = objPos(this.model.hammer ?? this.model.handR, _a, this.center);
        this.glow.set(h, 1.0 + Math.sin(g.time * 18) * 0.25, 0.8);
        this.crackleT -= dt;
        if (this.crackleT <= 0) { this.crackleT = 0.18; g.fx?.lightning?.(h.clone(), h.clone().add(_b.set(rand(-0.8, 0.8), rand(0.3, 1.6), rand(-0.8, 0.8))), BOLT, 0.12, 1); }
      } else if (this.tCharge > 0.15 && this.hasHammer) {
        const h = objPos(this.model.handR, _a, this.center);
        this.glow.set(h, 0.6 + (this.tCharge / IMBUE_MAX) * 1.8, 0.85);
      } else this.glow.set(_a, 1, 0);
    }
    // beam visual (God Blast)
    if (this.beamT > 0) {
      this.beamT -= dt;
      this.beam.show(this.beamFrom, this.beamTo, Math.max(0.05, this.beamW), 0.25);
      this.beamOuter.show(this.beamFrom, this.beamTo, Math.max(0.05, this.beamW * 2.2), 0.35);
      this.beamOuter.core.material.opacity = 0; this.beamOuter.glow.material.opacity = 0.3;
      if (this.beamT <= 0) { this.beam.hide(); this.beamOuter.hide(); }
    } else if (this.beam.group.visible) { this.beam.hide(); this.beamOuter.hide(); }
  }
}
