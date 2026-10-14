// Venom (Marvel's Spider-Man 2): a heavy bruiser-predator. Nothing here is a web-swing.
//
// Controls (keyboard / pad):
//   attack  LMB/J/Square     claw + tendril combo (4 hits; air: diving claw slam). While holding an enemy: slam it into the ground
//   special RMB/K/R1         TENDRIL GRAB: seize an enemy up to 18 m away and drag it in. Then attack = slam, ability E/L1 = throw
//                            (hold aim RMB/L2 for the zoomed reticle: attack / fire throws exactly where you aim)
//   ability E/L1             TENDRIL BARRAGE: six tendrils impale everything in a cone (cooldown 9 s)
//   ability2 R/L2            DEVOUR a stunned / weakened enemy next to you (heals 25%, bosses take big damage instead),
//                            or with nobody to eat: CAMOUFLAGE (6 s invisible, first hit from stealth does x2)
//   dodge C/Ctrl/Circle      dash dodge. Hold it (0.5 s) or press attack right after = SYMBIOTE ROAR (stagger everything near)
//   swing Shift/R2           TENDRIL LAUNCH: shoot a tendril at a ledge / wall and yank yourself there in a big arc
//   jump (hold)              jump jets: holding space while rising feeds the leap; keep holding at the top to GLIDE on the membrane
//   sprint                   gorilla gallop (heavy footfalls); walk into tall walls to claw up them
//   ultimate Q/R3            WE ARE VENOM: grow huge for 10 s, every hit erupts in tendril shockwaves, ends with a ground slam
import * as THREE from 'three';
import { SymbioteHero } from './symbiote/base.js';
import { SpikePool } from './symbiote/spikes.js';
import { assistAim, enemyCenter, rumble, impactFx, hitStop, PressureWaves, damp, objPos } from './avengers/util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _as = {};

const PURPLE = 0x7a2bd0, BLUE = 0x2f6bff, RED = 0xd01020, DUST = 0x9a8f7a;
const GRAB_RANGE = 18, THROW_SPEED = 46;
const CLAW = [
  { anim: 'punch1', t: 0.40, hit: 0.14, dmg: 22, range: 3.5, arc: 130, kb: 8, up: 2, stun: 0.35, lunge: 7 },
  { anim: 'punch2', t: 0.40, hit: 0.14, dmg: 24, range: 3.5, arc: 130, kb: 9, up: 2, stun: 0.35, lunge: 7 },
  { anim: 'kick', t: 0.48, hit: 0.18, dmg: 28, range: 4.8, arc: 170, kb: 13, up: 3, stun: 0.5, lunge: 4, lash: true },
  { anim: 'smash', t: 0.78, hit: 0.38, dmg: 46, range: 4.2, arc: 150, kb: 16, up: 8, stun: 1.2, lunge: 3, heavy: true, slam: true },
];

let SKIN = null;
function skin() {
  return SKIN || (SKIN = {
    tend: new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.16, metalness: 0.4, emissive: 0x10063a, emissiveIntensity: 0.35 }),
    spike: new THREE.MeshStandardMaterial({ color: 0x07070c, roughness: 0.2, metalness: 0.4, emissive: 0x2a0a66, emissiveIntensity: 0.8 }),
  });
}

export class VenomHero extends (SymbioteHero) {
  constructor(game) {
    const S = skin();
    super(game, {
      id: 'venom', name: 'Venom', color: '#1a1a2a', modelId: 'venom',
      maxHp: 320, walkSpeed: 7, runSpeed: 13, jumpSpeed: 12, gravity: 28, radius: 0.6, height: 2.3, airControl: 0.45, mass: 3,
      usesAim: true, aimPreset: { fov: 55, distance: 4.4, shoulder: 1.05, height: 2.5 },
      tendril: { material: S.tend, count: 30 },
      wings: { color: 0x050508, emissive: 0x2a0a66 },
      mv: {
        walk: 7, run: 13, sprint: 20, jump: 12, boost: 36, boostT: 0.75, jumpFwd: 2, airCtl: 0.45, stepShake: 0.05,
        wallSpeed: 10, wallSprint: 17, wallJumpOut: 14, wallJumpUp: 16,
        glide: true, glideSpeed: 24, glideFall: -4.5,
        dashSp: 20, dashTime: 0.22, dodgeCd: 0.7, fxColor: PURPLE,
        launch: { range: 70, minDist: 6, speed: 42, accel: 85, lift: 0.5, steer: 3, cd: 0.35, maxT: 2.2, endDist: 2, releaseUp: 5, keep: 0.9, width: 0.17 },
      },
    });
    this.spikes = new SpikePool(game.scene, 40, S.spike);
    this.waves = new PressureWaves(game.scene, 4);
    this.held = null; this.thrown = [];
    this.camoT = 0; this._camoMats = null;
    this.ultT = 0; this._shockCd = 0; this._inShock = false; this._ultSpikeT = 0;
    this.dodgeHold = 0; this.roared = false;
    this._camSaved = null; this.camBump = 0;
    this.slamPending = false; this.diveT = 0;
    this.focus = 0;
  }

  // ------------------------------------------------------------------ lifecycle
  onSymActivate() {
    const c = this.game.cam;
    this._camSaved = { d: c.targetDistance };
    this.camBump = 0;
  }
  onCleanup() {
    this._release(false);
    this._endCamo(true);
    for (const t of this.thrown) if (t.e) t.e.gravity = t.grav;
    this.thrown.length = 0;
    this.spikes.clear(); this.waves.clear();
    if (this._devouring) { this.drop(this._devouring, 0.3); this._devouring = null; }
    this.ultT = 0; this.dmgOutMul = 1; this.dmgTakenMul = 1; this.speedMul = 1; this.locked = false;
    if (this._camSaved && this.camBump > 0.01) this.game.cam.targetDistance = this._camSaved.d;
    this.camBump = 0; this.diveT = 0;
  }
  onDodge() { this.roared = false; }

  get abilityHints() {
    const devour = !!this._devourTarget();
    if (this.held) {
      return [
        { action: 'attack', label: 'Slam' },
        { action: 'ability', label: 'Throw', cooldown: 0 },
        { action: 'ability2', label: 'Devour', cooldown: this.cooldownFrac('devour') },
        { action: 'ultimate', label: 'We Are Venom', cooldown: 1 - this.focus / 100, active: this.ultT > 0 },
      ];
    }
    return [
      { action: 'swing', label: 'Tendril Launch', cooldown: this.cooldownFrac('launch'), active: this.state === 'launch' },
      { action: 'special', label: 'Tendril Grab', cooldown: this.cooldownFrac('grab') },
      { action: 'ability', label: 'Tendril Barrage', cooldown: this.cooldownFrac('barrage') },
      { action: 'ability2', label: devour ? 'Devour' : 'Camouflage', cooldown: devour ? this.cooldownFrac('devour') : this.cooldownFrac('camo'), active: this.camoT > 0 },
      { action: 'dodge', label: 'Roar (hold)', cooldown: this.cooldownFrac('roar') },
      { action: 'ultimate', label: 'We Are Venom', cooldown: 1 - this.focus / 100, active: this.ultT > 0 },
    ];
  }

  // ------------------------------------------------------------------ damage hooks
  registerHit() {
    super.registerHit();
    if (this.ultT > 0 && !this._inShock && this._shockCd <= 0) this._hitShock();
  }
  takeDamage(amount, fromPos) {
    if (this.camoT > 0) this._endCamo(false);
    return super.takeDamage(amount, fromPos);
  }
  get dmgMul() { return this.dmgOutMul; }
  /** Damage scale for the next attack: stealth x2 (consumes camouflage). */
  _atkMul() {
    if (this.camoT > 0) { this._endCamo(false); this.say('AMBUSH x2', 0xff5050, 1.5); return this.dmgMul * 2; }
    return this.dmgMul;
  }

  // ------------------------------------------------------------------ per-frame
  tick(dt, input) {
    this.waves.update(dt); this.spikes.update(dt);
    this._shockCd -= dt;
    if (this._devouring) { if (this._devouring.e.alive) this.carry(this._devouring, dt, 1.3, 0.62, 0.25); }
    this._camoTick(dt);
    this._thrownTick(dt);
    if (this.ultT > 0) this._ultTick(dt);
    // camera pull-back while huge
    const want = this.ultT > 0 ? 2.8 : 0;
    this.camBump = damp(this.camBump, want, 3, dt);
    if (this._camSaved && (this.camBump > 0.02 || this._camBumped)) {
      this.game.cam.targetDistance = this._camSaved.d + this.camBump;
      this._camBumped = this.camBump > 0.02;
    }
    // size, hit-box and stats while huge
    const k = this.sizeMul;
    this.radius = this.baseRadius * (1 + (k - 1) * 0.5); this.height = this.baseHeight * (1 + (k - 1) * 0.55);
    if (this.held && this.state === 'wall') this._release(true);
    this._setReticle(this.aiming ? 'web' : null);
  }

  landSlam(v) {
    const g = this.game;
    const big = this.ultT > 0 ? 1.6 : 1;
    if (this.diveT > 0) {
      this.diveT = 0;
      const c = this.pos.clone();
      g.combat?.aoe?.({ center: c, radius: 5 * big, damage: this.dmg(40), knockback: 14, up: 8, stun: 1.0, source: this });
      impactFx(g, c, 5.5 * big, DUST, 0.7);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 7 * big, 0xb090ff, 0.45, 0.4);
      g.audio?.play('smash', { volume: 0.8 }); hitStop(g, 0.07, 0.06); rumble(g, 0.8, 0.5, 220);
      return;
    }
    if (v > 24) {
      const c = this.pos.clone();
      g.combat?.aoe?.({ center: c, radius: 3.5 + Math.min(3, (v - 24) * 0.12), damage: this.dmg(12 + Math.min(20, v - 24)), knockback: 10, up: 5, stun: 0.6, source: this });
      impactFx(g, c, 4, DUST, 0.5);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 5, 0xb090ff, 0.4, 0.4);
      g.audio?.play('smash', { volume: 0.5 }); rumble(g, 0.5, 0.4, 150);
    }
  }

  // ------------------------------------------------------------------ combat dispatcher
  combat(dt, input) {
    if (this.locked) { this._reticleHeld(input, dt); return; }
    if (input.down('dodge')) this.dodgeHold += dt; else { this.dodgeHold = 0; }

    if (this.held) this._heldTick(dt, input);
    if (input.pressed('ultimate') && this.focus >= 100 && this.ultT <= 0 && this.state !== 'launch') {
      if (this.held) this._release(false);
      this._startUlt(); return;
    }
    if (this.state === 'launch' || this.held) return;
    const busy = this.actionT > 0;

    // roar: hold dodge for 0.4 s, or press attack right after a dodge
    if (!busy && !this.roared && (this.dodgeHold >= 0.4 || (this.dodgeAge < 0.45 && input.pressed('attack')))) {
      if ((this.cooldowns.roar || 0) <= 0) { this._roar(); return; }
    }

    if (busy) return;
    if (input.pressed('attack')) { this._claw(); return; }
    if (this.pressedSpecial()) { this._grab(); return; }
    if (input.pressed('ability')) { this._barrage(); return; }
    if (this.pressedAbility2()) {
      const t = this._devourTarget();
      if (t && (this.cooldowns.devour || 0) <= 0) this._devour(t);
      else if (!t) this._camouflage();
    }
  }

  _reticleHeld() {}

  // ------------------------------------------------------------------ claw combo
  _claw() {
    const g = this.game;
    if (!this.onGround && this.state !== 'wall') { this._airDive(); return; }
    const step = this.chain = this.chainT > 0 ? (this.chain % 4) + 1 : 1;
    this.chainT = 1.2;
    const S = CLAW[step - 1];
    this.faceAssist(7, 120);
    this.actionT = S.t; this.actionAnim = S.anim; this.actionMoveMul = 0.3;
    if (this.state !== 'wall') {
      const f = this.forward;
      this.vel.x += f.x * S.lunge; this.vel.z += f.z * S.lunge;
    }
    this.setAnim(S.anim, 8);
    g.audio?.play('claw', { volume: 0.7 }); g.audio?.play('whoosh', { volume: 0.4, pitch: 0.7 });
    const mul = this._atkMul();
    this.timers.after(S.hit, () => this._clawHit(S, step, mul));
  }

  _clawHit(S, step, mul) {
    if (!this.active || this.dead) return;
    const g = this.game;
    const f = this.forward;
    const origin = this.center;
    const hits = g.combat?.melee?.({ origin, forward: f, range: S.range * this.sizeMul ** 0.5, arc: S.arc, damage: S.dmg * mul, knockback: S.kb, up: S.up, stun: S.stun, source: this, heavy: !!S.heavy }) ?? [];
    // claw rake / tendril lash visuals
    this.handPos(_a);
    _b.copy(_a).addScaledVector(f, S.range * 0.85); _b.y -= 0.2;
    g.fx?.beam?.(_a, _b, 0xe8e6ff, 0.1, 0.1);
    g.fx?.sparks?.(_b, f, 0xb090ff, 6, 8, 0.25, 0.1);
    if (S.lash) {
      for (const sd of [-1, 1]) {
        _c.set(f.x + -f.z * 0.8 * sd, 0, f.z + f.x * 0.8 * sd).normalize();
        this.lash(origin.clone().addScaledVector(_c, S.range * 0.95), { life: 0.3, width: 0.13, wiggle: 0.6 });
      }
    }
    g.audio?.play(S.heavy ? 'heavyhit' : 'slash', { volume: 0.6 });
    if (hits.length) { g.cam.shake(S.heavy ? 0.3 : 0.12); rumble(g, S.heavy ? 0.8 : 0.4, 0.3, S.heavy ? 200 : 90); }
    if (S.slam) {
      const c = this.pos.clone().addScaledVector(f, 2.6 * Math.sqrt(this.sizeMul));
      g.combat?.aoe?.({ center: c, radius: 4.2, damage: 24 * mul, knockback: 14, up: 7, stun: 1.0, source: this });
      impactFx(g, c, 4.5, DUST, 0.6);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 6, 0xb090ff, 0.4, 0.4);
      for (let i = 0; i < 5; i++) {
        const a = this.yaw + (i - 2) * 0.35;
        this.spikes.spawn(this.pos.x + Math.sin(a) * 3.2, this.pos.y, this.pos.z + Math.cos(a) * 3.2, 1.6, 0.25, i * 0.02, 0.6, Math.sin(a) * 0.3, Math.cos(a) * 0.3);
      }
      g.audio?.play('smash', { volume: 0.7 }); hitStop(g, 0.08, 0.05); this.punch += 4;
    }
  }

  _airDive() {
    if (this.diveT > 0) return;
    const g = this.game;
    this.diveT = 2.5; this.state = 'free'; this.gravityScale = 1;
    this.vel.set(this.forward.x * 4, -34, this.forward.z * 4);
    this.actionT = 0.5; this.actionAnim = 'smash'; this.actionMoveMul = 0.1;
    this.setAnim('smash', 12);
    g.audio?.play('roar', { volume: 0.4, pitch: 1.3 }); g.audio?.play('whoosh');
    this.lash(_a.set(this.pos.x, Math.max(0, this.pos.y - 8), this.pos.z).clone(), { life: 0.4 });
  }

  // ------------------------------------------------------------------ tendril grab / throw
  _pickGrab(range) {
    this.handPos(_a);
    let t = null;
    if (this.aiming) { assistAim(this, _a, range + 6, 7, _as); t = _as.target; }
    if (!t) t = this.findTarget(range, 75);
    if (!t) {
      let bd = 1e9;
      for (const e of this.foes) {
        if (!e.alive || e.untargetable) continue;
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (d < Math.min(range, 9) && d < bd) { bd = d; t = e; }
      }
    }
    if (t) {
      const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      if (d > range) return null;
    }
    return t;
  }

  _grab() {
    const g = this.game;
    if ((this.cooldowns.grab || 0) > 0) return;
    const t = this._pickGrab(GRAB_RANGE);
    if (!t) { this.cooldowns.grab = 0.35; this.say('NO TARGET', 0xaaaaaa, 0.9); return; }
    this.useCooldown('grab', 5);
    this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    const mul = this._atkMul();
    this.actionT = 0.45; this.actionAnim = 'cast'; this.actionMoveMul = 0.2; this.setAnim('cast', 8);
    g.audio?.play('venom', { volume: 0.5 }); g.audio?.play('zip');
    if (t.isBoss) {
      // too big to drag: reel Venom in and tear into it
      const rope = this._pool().spawn({ from: (out) => objPos(this.model.handR, out, this.center), to: (out) => enemyCenter(t, out), life: 0.5, grow: 0.08, width: 0.18, wiggle: 0.5 });
      void rope;
      _a.subVectors(t.pos, this.pos).setY(0).normalize();
      this.vel.x = _a.x * 30; this.vel.z = _a.z * 30; this.vel.y = Math.max(this.vel.y, 5);
      this.timers.after(0.2, () => { if (this.active && t.alive) { this.strike(t, 42 * mul, { stun: 0.8, kb: _a.clone().multiplyScalar(5) }); hitStop(g, 0.08, 0.05); g.cam.shake(0.3); } });
      return;
    }
    this.held = this.seize(t); this.held.mul = mul;
    this.held.rope = this._pool().spawn({ from: (out) => objPos(this.model.handR, out, this.center), to: (out) => enemyCenter(t, out), life: 6, grow: 0.1, width: 0.16, wiggle: 0.5, retract: 0.2 });
    g.fx?.burst?.(enemyCenter(t, _a), PURPLE, 12, 5, 0.4, 0.25);
    g.cam.shake(0.15); rumble(g, 0.5, 0.3, 120);
    this.say('GRABBED', 0xb090ff, 1.1);
  }

  _heldTick(dt, input) {
    const g = this.game, h = this.held;
    const e = h.e;
    if (!e.alive || e.removed) { this._release(false); return; }
    this.carry(h, dt, 1.5 * Math.sqrt(this.sizeMul), 0.62);
    if (h.t > 6.5) { this._release(false); return; }
    if (this.actionT > 0 && this.actionAnim === 'smash') return;
    if (h.t < 0.2) return;
    if (this.state === 'launch' || this.state === 'wall') { this._release(false); return; }
    if (this.aiming) {
      this.handPos(_a);
      assistAim(this, _a, 80, 7, _as, e);
      this.faceTowards(g.cam.forward, dt, 18);
    }
    const aimed = this.aiming;
    if (this.firePressed() || (aimed && input.pressed('attack'))) { this._throw(true); return; }
    if (input.pressed('ability')) { this._throw(aimed); return; }
    if (input.pressed('attack')) { this._slam(); return; }
    if (input.pressed('dodge')) { this._release(false); return; }
    if (this.pressedAbility2() && (this.cooldowns.devour || 0) <= 0) { const t = this.held.e; this._devour(t); }
  }

  _release(quiet) {
    const h = this.held; if (!h) return;
    this.drop(h, 0.8);
    if (h.rope && h.rope.active) h.rope.age = Math.max(h.rope.age, h.rope.life - h.rope.retract);
    this.held = null;
    void quiet;
  }

  _slam() {
    const g = this.game, h = this.held;
    h.slam = true;
    this.actionT = 0.85; this.actionAnim = 'smash'; this.actionMoveMul = 0.1; this.setAnim('smash', 8);
    g.audio?.play('roar', { volume: 0.5, pitch: 0.8 });
    this.timers.after(0.4, () => {
      if (!this.active || this.held !== h) return;
      const e = h.e;
      const c = this.pos.clone().addScaledVector(this.forward, 2.6);
      if (h.rope && h.rope.active) h.rope.age = Math.max(h.rope.age, h.rope.life - h.rope.retract);
      this.held = null;
      e.gravity = h.grav; e.pos.set(c.x, c.y, c.z); e.vel.set(0, -10, 0);
      e.invuln = 0;
      e.takeDamage?.(80 * (h.mul ?? this.dmgMul), { knockback: new V3(0, 4, 0), stun: 2.2, source: this, kind: 'slam' });
      e.downTimer = 1.2; e.stunTimer = Math.max(e.stunTimer, 2);
      g.combat?.aoe?.({ center: c, radius: 4.8, damage: 34 * this.dmgMul, knockback: 14, up: 7, stun: 1.0, source: this });
      impactFx(g, c, 5, DUST, 0.9);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 7, 0xb090ff, 0.45, 0.4);
      g.fx?.text?.(_a.set(c.x, c.y + 2.6, c.z), 'SLAM', 0xb090ff, { size: 1.5, life: 1 });
      g.audio?.play('smash'); g.audio?.play('heavyhit');
      rumble(g, 1, 0.8, 300); hitStop(g, 0.09, 0.05); this.registerHit();
    });
  }

  _throw(aimed) {
    const g = this.game, h = this.held;
    const e = h.e;
    this.handPos(_a);
    const from = _a.clone();
    assistAim(this, from, 85, aimed ? 6 : 12, _as, e);
    const to = _as.point.clone();
    if (h.rope && h.rope.active) h.rope.age = Math.max(h.rope.age, h.rope.life - h.rope.retract);
    this.held = null;
    _b.subVectors(to, this.pos).setY(0); if (_b.lengthSq() > 0.01) this.yaw = Math.atan2(_b.x, _b.z);
    this.actionT = 0.55; this.actionAnim = 'throw'; this.actionMoveMul = 0.2; this.setAnim('throw', 8);
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    const tt = dist / THROW_SPEED;
    e.gravity = h.grav; e.pos.set(from.x, from.y - e.height * 0.5, from.z);
    e.vel.copy(dir).multiplyScalar(THROW_SPEED); e.vel.y += 0.5 * (h.grav || 28) * tt;
    e.launched = true; e.stunTimer = 2; e.downTimer = 0; e.onGround = false;
    this.thrown.push({ e, t: 0, grav: h.grav, hit: new Set(), mul: h.mul ?? this.dmgMul });
    g.audio?.play('throw'); g.audio?.play('roar', { volume: 0.4 });
    g.fx?.ring?.(from, 3, PURPLE, 0.3); g.cam.shake(0.3); rumble(g, 0.6, 0.4, 150);
  }

  _thrownTick(dt) {
    const g = this.game;
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const T = this.thrown[i], e = T.e;
      T.t += dt;
      if (!e.alive || e.removed) { this.thrown.splice(i, 1); continue; }
      e.launched = true;
      const sp = e.vel.length();
      for (const o of this.foes) {
        if (o === e || !o.alive || T.hit.has(o) || o.untargetable) continue;
        const rr = e.radius + o.radius + 0.5;
        const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (e.pos.y > o.pos.y + o.height + 0.5 || e.pos.y + e.height < o.pos.y - 0.5) continue;
        T.hit.add(o);
        _b.copy(e.vel).setY(0).normalize().multiplyScalar(14); _b.y = 6;
        this.strike(o, 55 * T.mul, { stun: 1.6, kb: _b.clone(), color: 0xb090ff });
        e.takeDamage?.(20, { stun: 1.5, source: this, kind: 'throw' });
        g.audio?.play('heavyhit'); g.cam.shake(0.25); hitStop(g, 0.06, 0.06);
      }
      if ((T.t > 0.15 && (e.onGround || sp < 12)) || T.t > 3) {
        const c = e.pos.clone();
        g.combat?.aoe?.({ center: c, radius: 4.2, damage: 36 * T.mul, knockback: 14, up: 6, stun: 1.0, source: this });
        impactFx(g, c, 4.2, DUST, 0.6);
        this.waves.spawn(c.clone().setY(c.y + 0.2), 5.5, 0xb090ff, 0.4, 0.4);
        g.audio?.play('smash', { volume: 0.7 });
        if (e.alive) { e.invuln = 0; e.takeDamage?.(30, { stun: 1.2, source: this, kind: 'throw' }); }
        this.thrown.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ tendril barrage
  _barrage() {
    const g = this.game;
    if (!this.useCooldown('barrage', 9)) return;
    const mul = this._atkMul();
    const t0 = this.faceAssist(14, 100);
    void t0;
    const f = this.forward;
    const cands = [];
    const c = this.center;
    for (const e of this.foes) {
      if (!e.alive || e.untargetable) continue;
      _a.set(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z);
      const d = _a.length();
      if (d > 16 || d < 0.3) continue;
      if (_a.multiplyScalar(1 / d).dot(f) < Math.cos(THREE.MathUtils.degToRad(55))) continue;
      if (!g.physics.lineOfSight(c, enemyCenter(e, _b))) continue;
      cands.push({ e, d });
    }
    cands.sort((x, y) => x.d - y.d);
    this.actionT = 0.85; this.actionAnim = 'cast'; this.actionMoveMul = 0.2; this.setAnim('cast', 8);
    g.audio?.play('venom', { volume: 0.6 }); g.audio?.play('roar', { volume: 0.25, pitch: 1.2 });
    g.cam.shake(0.2);
    const N = 6;
    for (let i = 0; i < N; i++) {
      const delay = 0.12 + i * 0.07;
      const side = i % 2 ? 1 : -1, hgt = 0.3 + (i % 3) * 0.25;
      const tgt = cands.length ? cands[i % cands.length].e : null;
      const extra = cands.length && i >= cands.length;
      this.timers.after(delay, () => {
        if (!this.active || this.dead) return;
        // tendrils sprout from the back / shoulders
        this.chestPos(_a);
        const rf = this.forward;
        const root = new V3(_a.x - rf.z * side * 0.5 - rf.x * 0.3, _a.y + hgt, _a.z + rf.x * side * 0.5 - rf.z * 0.3);
        if (tgt && tgt.alive) {
          this._pool().spawn({ from: root, to: (out) => enemyCenter(tgt, out), life: 0.5, grow: 0.08, width: 0.17, wiggle: 0.9, arc: 0.08 });
          _b.subVectors(this.pos, tgt.pos).setY(0).normalize().multiplyScalar(-3);
          this.strike(tgt, (extra ? 18 : 34) * mul, { stun: 1.3, kb: _b.clone().setY(extra ? 0 : 5), color: 0xb090ff });
          if (!extra) tgt.vel.y = Math.max(tgt.vel.y, 4);
          g.fx?.burst?.(enemyCenter(tgt, _c), PURPLE, 10, 5, 0.4, 0.25);
        } else {
          // no target: stab the cone ahead (hits bystanders too)
          const a = this.yaw + (i - (N - 1) / 2) * 0.28;
          _d.set(Math.sin(a), -0.08, Math.cos(a)).normalize();
          const hit = g.combat?.hitscan?.({ origin: root, dir: _d, range: 14, damage: 28 * mul, width: 1.0, source: this, knockback: 6, stun: 0.6 });
          const end = hit ? hit.point.clone() : root.clone().addScaledVector(_d, 12);
          this._pool().spawn({ from: root, to: end, life: 0.4, grow: 0.07, width: 0.15, wiggle: 0.7, arc: 0.06 });
        }
        g.audio?.play('slash', { volume: 0.4, pitch: 0.7 });
      });
    }
  }

  // ------------------------------------------------------------------ devour / camouflage
  _devourTarget() {
    if (this.held && this.held.e.alive) return this.held.e;
    let best = null, bd = 1e9;
    const f = this.forward;
    for (const e of this.foes) {
      if (!e.alive || e.untargetable) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > 3.6 * Math.sqrt(this.sizeMul)) continue;
      if (d > 0.8 && (dx * f.x + dz * f.z) / Math.max(0.01, Math.hypot(dx, dz)) < 0.2) continue;
      const frac = e.hp / e.maxHp;
      const ok = e.stunned || e.webbed || frac <= (e.isBoss ? 0.5 : 0.35);
      if (!ok) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _devour(e) {
    const g = this.game;
    if (!this.useCooldown('devour', 7)) return;
    const mul = this._atkMul();
    let h = this.held && this.held.e === e ? this.held : null;
    if (h) { this.held = null; h.rope && h.rope.active && (h.rope.age = Math.max(h.rope.age, h.rope.life - h.rope.retract)); }
    else { h = this.seize(e); }
    this.yaw = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    this.actionT = 1.2; this.actionAnim = 'smash'; this.actionMoveMul = 0.0; this.setAnim('smash', 6);
    this.locked = true;
    g.audio?.play('venom', { volume: 0.8 });
    // drag it up to the jaws
    const h2 = { e, t: 0, start: e.pos.clone(), grav: h.grav };
    this._devouring = h2;
    this.timers.after(0.5, () => {
      this._devouring = null;
      this.locked = false;
      if (!this.active || this.dead) { this.drop(h2, 0.2); return; }
      e.gravity = h2.grav ?? 28;
      e.invuln = 0;
      const c = enemyCenter(e, _c).clone();
      let heal = 0;
      if (e.isBoss) {
        const dealt = e.takeDamage?.(190 * mul, { knockback: new V3(0, 3, 0), stun: 2, source: this, kind: 'devour' }) ?? 0;
        g.fx?.text?.(_a.set(e.pos.x, e.pos.y + e.height + 0.6, e.pos.z), 'DEVOURED ' + Math.round(dealt), 0xff4040, { size: 1.6, life: 1.2 });
        heal = this.maxHp * 0.12;
      } else {
        e.takeDamage?.(e.hp + 9999, { knockback: new V3(0, 3, 0), stun: 0, source: this, kind: 'devour' });
        g.fx?.text?.(_a.set(c.x, c.y + 1, c.z), 'DEVOURED', 0xff4040, { size: 1.6, life: 1.2 });
        heal = this.maxHp * 0.25;
      }
      this.heal(heal);
      g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.4, this.pos.z), '+' + Math.round(heal), 0x66ff88, { size: 1.3, life: 1.1 });
      g.fx?.burst?.(c, RED, 28, 7, 0.7, 0.35); g.fx?.burst?.(c, PURPLE, 16, 5, 0.6, 0.3);
      g.fx?.flash?.(c, 0xff2040, 4, 0.2);
      g.audio?.play('heavyhit'); g.audio?.play('roar', { volume: 0.6 });
      g.cam.shake(0.4); rumble(g, 0.9, 0.6, 250); hitStop(g, 0.12, 0.04);
      this.addFocus(18); this.registerHit();
    });
  }

  _camouflage() {
    const g = this.game;
    if (!this.useCooldown('camo', 16)) return;
    this.camoT = 6;
    this.actionT = 0.35; this.actionAnim = 'cast'; this.actionMoveMul = 0.5; this.setAnim('cast');
    g.audio?.play('symbiote', { volume: 0.7 }); g.fx?.burst?.(this.center, PURPLE, 24, 5, 0.6, 0.3);
    g.fx?.ring?.(_a.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 3, PURPLE, 0.4);
    this._fadeModel(true);
    this.say('CAMOUFLAGE', 0xb090ff, 1.1);
  }
  _camoTick(dt) {
    if (this.camoT <= 0) return;
    this.camoT -= dt;
    // enemies lose track of us unless we are right on top of them
    const self = this;
    for (const e of this.foes) {
      if (e._blindBy === this || !e.alive) continue;
      e._blindBy = this; e._ownAi = Object.prototype.hasOwnProperty.call(e, 'ai') ? e.ai : null;
      const orig = e.ai;
      e.interrupt?.();
      e.ai = function (d) {
        if (self.camoT > 0 && e.dist > 3.5) { e.wish.set(0, 0, 0); e.setAnim?.('idle', 1); return; }
        return orig.call(e, d);
      };
    }
    if (this.camoT <= 0) this._endCamo(false);
  }
  _endCamo(quiet) {
    const had = this.camoT > 0 || !!this._camoMats;
    this.camoT = 0;
    this._unblind();
    this._fadeModel(false);
    if (had && !quiet) this.game.fx?.burst?.(this.center, PURPLE, 14, 4, 0.5, 0.25);
  }
  _unblind() {
    for (const e of this.foes) {
      if (e._blindBy !== this) continue;
      e._blindBy = null;
      if (e._ownAi) e.ai = e._ownAi; else delete e.ai;
      e._ownAi = null;
    }
  }
  /** Ghost the model: swap in cloned transparent materials, restore on end. */
  _fadeModel(on) {
    const grp = this.model.group;
    if (on) {
      if (this._camoMats) return;
      this._camoMats = [];
      grp.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const orig = o.material;
        const clone = (m) => {
          const c = m.clone(); c.transparent = true; c.opacity = 0.14; c.depthWrite = false;
          if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
          return c;
        };
        o.material = Array.isArray(orig) ? orig.map(clone) : clone(orig);
        this._camoMats.push({ o, orig });
      });
    } else if (this._camoMats) {
      for (const { o, orig } of this._camoMats) {
        const cur = o.material;
        o.material = orig;
        (Array.isArray(cur) ? cur : [cur]).forEach((m) => m.dispose?.());
      }
      this._camoMats = null;
    }
  }

  // ------------------------------------------------------------------ roar
  _roar() {
    const g = this.game;
    if (!this.useCooldown('roar', 11)) return;
    this.roared = true;
    const mul = this._atkMul();
    this.actionT = 0.7; this.actionAnim = 'cast'; this.actionMoveMul = 0.25; this.setAnim('cast', 8);
    this.dashT = 0;
    const c = this.pos.clone();
    const R = 13 * Math.sqrt(this.sizeMul);
    g.combat?.aoe?.({ center: this.center, radius: R, damage: 8 * mul, knockback: 15, up: 3, stun: 2.0, source: this, falloff: false });
    // bosses with super-armor still flinch: mark a short stagger
    for (const e of this.foes) {
      if (!e.alive || !e.isBoss) continue;
      if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < R) { e.slowTimer = Math.max(e.slowTimer || 0, 2); e.interrupt?.(); }
    }
    this.waves.spawn(this.center, R, 0xb090ff, 0.7, 0.8);
    g.fx?.shockwave?.(c, R * 0.7, PURPLE);
    g.fx?.ring?.(c.clone().setY(c.y + 0.1), R * 0.5, 0xffffff, 0.5);
    g.audio?.play('venom', { volume: 1 }); g.audio?.play('roar', { volume: 0.9, pitch: 0.8 });
    g.cam.shake(0.8); rumble(g, 1, 0.8, 350); this.punch += 8;
    this.say('ROAR', 0xb090ff, 1.4);
  }

  // ------------------------------------------------------------------ ultimate: We Are Venom
  _startUlt() {
    const g = this.game;
    this.focus = 0; this.ultT = 10;
    this.sizeTarget = 1.4; this.dmgOutMul = 1.5; this.dmgTakenMul = 0.5; this.speedMul = 1.15;
    this.heal(this.maxHp * 0.15);
    this.actionT = 0.8; this.actionAnim = 'cast'; this.actionMoveMul = 0.1; this.setAnim('cast', 8);
    const c = this.pos.clone();
    this.waves.spawn(this.center, 14, 0xb090ff, 0.7, 0.8);
    g.fx?.shockwave?.(c, 10, PURPLE); g.fx?.flash?.(this.center, PURPLE, 6, 0.3);
    g.combat?.aoe?.({ center: this.center, radius: 10, damage: 20, knockback: 14, up: 4, stun: 1.2, source: this });
    g.audio?.play('venom', { volume: 1 }); g.audio?.play('roar', { volume: 0.9, pitch: 0.7 });
    g.cam.shake(0.9); rumble(g, 1, 0.8, 400); hitStop(g, 0.1, 0.05);
    g.hud?.toast?.('WE ARE VENOM');
    this._ultSpikeT = 0;
  }
  _ultTick(dt) {
    this.ultT -= dt;
    this._ultSpikeT -= dt;
    if (this._ultSpikeT <= 0) {
      this._ultSpikeT = 0.45;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * 6.28, r = 2.6 + Math.random() * 1.8;
        this.spikes.spawn(this.pos.x + Math.cos(a) * r, this.pos.y, this.pos.z + Math.sin(a) * r, 1.6 + Math.random(), 0.22, 0, 0.55, Math.cos(a) * 0.25, Math.sin(a) * 0.25);
      }
    }
    if (this.ultT <= 0) this._endUlt();
  }
  _hitShock() {
    const g = this.game;
    this._inShock = true; this._shockCd = 0.16;
    const f = this.forward;
    const c = _c.set(this.pos.x + f.x * 2.8, this.pos.y, this.pos.z + f.z * 2.8).clone();
    g.combat?.aoe?.({ center: c, radius: 4.6, damage: 11, knockback: 9, up: 3, stun: 0.3, source: this });
    g.fx?.ring?.(c.clone().setY(c.y + 0.1), 4.6, PURPLE, 0.35);
    g.fx?.burst?.(c, PURPLE, 10, 6, 0.4, 0.3);
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * 6.28, r = 1 + Math.random() * 3;
      this.spikes.spawn(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r, 1.4 + Math.random() * 0.8, 0.2, i * 0.03, 0.5, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
    }
    this._inShock = false;
  }
  _endUlt() {
    const g = this.game;
    this.ultT = 0;
    const big = this.sizeMul;
    this.actionT = 0.85; this.actionAnim = 'smash'; this.actionMoveMul = 0; this.setAnim('smash', 8);
    this.vel.y = Math.min(this.vel.y, -18);
    this.sizeTarget = 1; this.dmgTakenMul = 1; this.speedMul = 1;
    this.timers.after(0.3, () => {
      if (!this.active) return;
      this.dmgOutMul = 1;
      const c = this.pos.clone();
      g.combat?.aoe?.({ center: c, radius: 14, damage: 120, knockback: 20, up: 9, stun: 1.8, source: this });
      impactFx(g, c, 14, DUST, 1.2);
      g.fx?.shockwave?.(c, 14, PURPLE);
      this.waves.spawn(c.clone().setY(c.y + 0.2), 14, 0xb090ff, 0.6, 0.5);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 6.28;
        this.spikes.spawn(c.x + Math.cos(a) * 5, c.y, c.z + Math.sin(a) * 5, 2.2, 0.3, i * 0.012, 0.7, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
      }
      g.audio?.play('smash', { volume: 1 }); g.audio?.play('roar', { volume: 0.7, pitch: 0.7 });
      g.cam.shake(1.2); rumble(g, 1, 1, 450); hitStop(g, 0.12, 0.04);
    });
    void big;
  }
}
