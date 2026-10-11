// Carnage: fast, chaotic slasher. Blade arms, bleeding wounds, tendril zips in any direction.
//
// Controls (keyboard / pad):
//   attack  LMB/J/Square     blade-arm combo (5 hits, very fast, every cut BLEEDS). In the air: spinning slash
//   special RMB/K/R1         WHIP STORM: 360 degrees of lashing tendrils around you for 1.5 s
//   ability E/L1             SPIKE FIELD: ground spikes erupt in a cone ahead and launch everything standing there
//   ability2 R/L2            AXE THROW: forms a symbiote axe, throws it at the reticle target, it boomerangs back
//   dodge C/Ctrl/Circle      blade dash (i-frames)
//   swing Shift/R2           TENDRIL ZIP: very fast grapple in ANY direction - onto a ledge, a wall, an enemy (slashes it), or just a mid-air propel
//   jump                     long acrobatic leap, press again in the air for a flip double jump
//   walk into tall walls     blade-arm wall climb (fast)
//   FRENZY (passive)         every hit in your combo adds speed and damage (up to +60% damage, +50% attack speed, +20% run speed)
//   ultimate Q/R3            MAXIMUM CARNAGE: spike explosion + three symbiote clones fight for you for 12 s
import * as THREE from 'three';
import { SymbioteHero } from './symbiote/base.js';
import { SpikePool } from './symbiote/spikes.js';
import { SymbioteClone } from './symbiote/clone.js';
import { assistAim, enemyCenter, rumble, impactFx, hitStop, PressureWaves, clamp, objPos } from './avengers/util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _as = {};
const RED = 0xd0101a, HOT = 0xff2a38, DUST = 0x9a8f7a;

const BLADE = [
  { anim: 'punch1', t: 0.26, hit: 0.07, dmg: 11, range: 3.3, arc: 120, kb: 3, up: 1.2, stun: 0.25, lunge: 6 },
  { anim: 'punch2', t: 0.26, hit: 0.07, dmg: 11, range: 3.3, arc: 120, kb: 3, up: 1.2, stun: 0.25, lunge: 6 },
  { anim: 'kick', t: 0.28, hit: 0.08, dmg: 12, range: 3.5, arc: 170, kb: 4, up: 1.5, stun: 0.3, lunge: 5 },
  { anim: 'punch1', t: 0.26, hit: 0.07, dmg: 13, range: 3.4, arc: 130, kb: 4, up: 1.5, stun: 0.3, lunge: 6 },
  { anim: 'uppercut', t: 0.46, hit: 0.16, dmg: 26, range: 3.7, arc: 130, kb: 5, up: 10, stun: 0.7, lunge: 4, finisher: true },
];

let SKIN = null;
function skin() {
  return SKIN || (SKIN = {
    tend: new THREE.MeshStandardMaterial({ color: 0x2a0306, roughness: 0.2, metalness: 0.3, emissive: 0x8a0510, emissiveIntensity: 0.7 }),
    spike: new THREE.MeshStandardMaterial({ color: 0x4a0408, roughness: 0.25, metalness: 0.3, emissive: 0xc0101c, emissiveIntensity: 0.9 }),
    axe: new THREE.MeshStandardMaterial({ color: 0x300408, roughness: 0.2, metalness: 0.5, emissive: 0xd0101a, emissiveIntensity: 1.0 }),
    axeBlack: new THREE.MeshStandardMaterial({ color: 0x050204, roughness: 0.3, metalness: 0.4 }),
  });
}

function axeMesh() {
  const S = skin();
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6), S.axeBlack); shaft.rotation.z = Math.PI / 2;
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.95, 4), S.axe); blade.rotation.set(0, 0, -Math.PI / 2); blade.position.set(0.5, 0, 0); blade.scale.set(1, 1, 0.22);
  const blade2 = blade.clone(); blade2.rotation.z = Math.PI / 2; blade2.position.x = -0.5;
  g.add(shaft, blade, blade2);
  g.userData.noOrient = true;
  return g;
}

export class CarnageHero extends SymbioteHero {
  constructor(game) {
    const S = skin();
    super(game, {
      id: 'carnage', name: 'Carnage', color: '#c0101c', modelId: 'carnage',
      maxHp: 240, walkSpeed: 8, runSpeed: 15, jumpSpeed: 15.5, gravity: 27, radius: 0.5, height: 2.1, airControl: 0.5, mass: 1.3,
      tendril: { material: S.tend, count: 32 },
      mv: {
        walk: 8, run: 15, sprint: 23, jump: 15.5, jumpFwd: 6, doubleJump: true, airCtl: 0.6, stepShake: 0,
        wallSpeed: 15, wallSprint: 22, wallJumpOut: 13, wallJumpUp: 15,
        dashSp: 27, dashTime: 0.2, dodgeCd: 0.5, fxColor: RED,
        launch: { range: 60, minDist: 4, speed: 64, accel: 220, lift: 0, steer: 2, cd: 0.3, maxT: 1.2, endDist: 2, releaseUp: 3, keep: 0.7, width: 0.12, turn: 400, anyHit: true, enemyZip: true, airDash: 22, anim: 'zip', pitches: [0.35, 0.6, 0.9, 0.15] },
      },
    });
    this.spikes = new SpikePool(game.scene, 60, S.spike);
    this.waves = new PressureWaves(game.scene, 3);
    this.bleeds = new Map();
    this.frenzy = 0; this._frenzyMark = 0;
    this.storm = null;
    this.axes = [];
    this.clones = [];
    this.ultT = 0;
  }

  onSymActivate() { this.bleeds.clear(); }
  onCleanup() {
    this.spikes.clear(); this.waves.clear();
    this.storm = null;
    for (const p of this.axes) p.remove?.();
    this.axes.length = 0;
    for (const c of this.clones) c.dispose();
    this.clones.length = 0;
    this.ultT = 0; this.locked = false;
    this.bleeds.clear();
    this.dmgOutMul = 1; this.speedMul = 1;
    if (this.model.fx) { this.model.fx.whip = 0; this.model.fx.rage = 0; }
  }

  get abilityHints() {
    return [
      { action: 'swing', label: 'Tendril Zip', cooldown: this.cooldownFrac('launch'), active: this.state === 'launch' },
      { action: 'special', label: 'Whip Storm', cooldown: this.cooldownFrac('storm'), active: !!this.storm },
      { action: 'ability', label: 'Spike Field', cooldown: this.cooldownFrac('spikes') },
      { action: 'ability2', label: 'Axe Throw', cooldown: this.cooldownFrac('axe'), active: this.axes.length > 0 },
      { action: 'attack', label: this.frenzy > 0.3 ? 'Frenzy x' + (1 + this.frenzy * 0.6).toFixed(1) : 'Blade Combo', cooldown: 0, active: this.frenzy > 0.3 },
      { action: 'ultimate', label: 'Maximum Carnage', cooldown: 1 - this.focus / 100, active: this.ultT > 0 },
    ];
  }

  // ------------------------------------------------------------------ bleeding
  bleed(e, secs = 3, dps = 6) {
    if (!e || !e.alive) return;
    const b = this.bleeds.get(e);
    if (b) { b.t = Math.max(b.t, secs); b.dps = Math.min(b.dps + 1.5, dps * 2.2); } else this.bleeds.set(e, { t: secs, dps, tick: 0.5 });
  }
  _bleedTick(dt) {
    if (!this.bleeds.size) return;
    for (const [e, b] of this.bleeds) {
      if (!e.alive || e.removed) { this.bleeds.delete(e); continue; }
      b.t -= dt; b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = 0.5;
        e.takeDamage?.(b.dps * 0.5 * this.dmgMul, { stun: 0, source: this, kind: 'bleed' });
        this.game.fx?.burst?.(enemyCenter(e, _a), RED, 4, 3, 0.4, 0.18);
        if (Math.random() < 0.35) this.game.fx?.text?.(_b.set(e.pos.x, e.pos.y + e.height + 0.3, e.pos.z), '' + Math.round(b.dps * 0.5 * this.dmgMul), 0xff3040, { size: 0.8, life: 0.6 });
      }
      if (b.t <= 0) this.bleeds.delete(e);
    }
  }

  // ------------------------------------------------------------------ frenzy
  _frenzyTick(dt) {
    const target = clamp(this.combo / 25, 0, 1);
    this.frenzy += (target - this.frenzy) * Math.min(1, 6 * dt);
    this.dmgOutMul = 1 + 0.6 * this.frenzy;
    this.speedMul = 1 + 0.2 * this.frenzy;
    if (this.model.fx) this.model.fx.rage = this.frenzy;
    const mark = Math.floor(this.combo / 10);
    if (mark > this._frenzyMark && mark <= 2) { this.say(mark === 1 ? 'FRENZY' : 'MAXIMUM FRENZY', HOT, 1.4); this.game.audio?.play('roar', { volume: 0.3, pitch: 1.4 }); }
    this._frenzyMark = mark;
  }
  get atkSpeed() { return 1 + 0.5 * this.frenzy; }

  // ------------------------------------------------------------------ per-frame
  tick(dt, input) {
    this.waves.update(dt); this.spikes.update(dt);
    this._frenzyTick(dt);
    this._bleedTick(dt);
    this._axeTick(dt);
    this._stormTick(dt);
    if (this.ultT > 0) this._ultTick(dt);
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i]; c.update(dt);
      if (!c.alive) { c.dispose(); this.clones.splice(i, 1); }
    }
  }

  onLaunchEnd(arrived, target) {
    if (arrived && target && target.alive) {
      const mul = this.dmgMul;
      this.strike(target, 20 * mul, { stun: 0.6, color: HOT });
      this.bleed(target, 4);
      this.game.fx?.burst?.(enemyCenter(target, _a), RED, 12, 6, 0.4, 0.25);
      this.actionT = 0.3; this.actionAnim = 'punch1'; this.actionMoveMul = 0.5;
      this.game.cam.shake(0.15); hitStop(this.game, 0.05, 0.06);
      this.chain = 1; this.chainT = 1.0;
    }
  }

  landSlam(v) {
    if (v > 26) {
      const g = this.game;
      g.combat?.aoe?.({ center: this.pos.clone(), radius: 3.2, damage: this.dmg(10), knockback: 7, up: 4, stun: 0.4, source: this });
      g.fx?.ring?.(_a.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 3.2, RED, 0.35);
    }
  }

  // ------------------------------------------------------------------ dispatcher
  combat(dt, input) {
    if (input.pressed('ultimate') && this.focus >= 100 && this.ultT <= 0 && this.state !== 'launch') { this._startUlt(); return; }
    if (this.locked || this.state === 'launch') return;
    if (this.actionT > 0 && !this.storm) return;
    if (this.storm) return;
    if (input.pressed('attack')) { this._blade(); return; }
    if (this.pressedSpecial()) { this._startStorm(); return; }
    if (input.pressed('ability')) { this._spikeField(); return; }
    if (this.pressedAbility2()) { this._axe(); }
  }

  // ------------------------------------------------------------------ blade combo
  _blade() {
    const g = this.game;
    if (!this.onGround && this.state !== 'wall') { this._airSlash(); return; }
    const step = this.chain = this.chainT > 0 ? (this.chain % 5) + 1 : 1;
    this.chainT = 0.9;
    const S = BLADE[step - 1];
    const spd = this.atkSpeed;
    this.faceAssist(6, 120);
    this.actionT = S.t / spd; this.actionAnim = S.anim; this.actionMoveMul = 0.35;
    if (this.state !== 'wall') { const f = this.forward; this.vel.x += f.x * S.lunge; this.vel.z += f.z * S.lunge; }
    this.setAnim(S.anim, 10);
    g.audio?.play('slash', { volume: 0.5, pitch: 1 + 0.1 * step });
    this.timers.after(S.hit / spd, () => this._bladeHit(S, step));
  }

  _bladeHit(S, step) {
    if (!this.active || this.dead) return;
    const g = this.game;
    const f = this.forward;
    const hits = g.combat?.melee?.({ origin: this.center, forward: f, range: S.range, arc: S.arc, damage: this.dmg(S.dmg), knockback: S.kb, up: S.up, stun: S.stun, source: this, heavy: !!S.finisher }) ?? [];
    for (const e of hits) this.bleed(e, 3.5);
    // slash arcs
    this.handPos(_a);
    const side = step % 2 ? 1 : -1;
    _b.copy(_a).addScaledVector(f, S.range * 0.9); _b.x += -f.z * side * 0.9; _b.z += f.x * side * 0.9;
    _c.copy(_a).addScaledVector(f, S.range * 0.9); _c.x -= -f.z * side * 0.9; _c.z -= f.x * side * 0.9;
    g.fx?.beam?.(_b, _c, 0xff4050, 0.14, 0.09);
    g.fx?.beam?.(_b.setY(_b.y + 0.5), _c.setY(_c.y - 0.5), 0xffffff, 0.05, 0.07);
    if (hits.length) {
      g.fx?.burst?.(enemyCenter(hits[0], _a), RED, 8, 6, 0.4, 0.2);
      g.cam.shake(S.finisher ? 0.25 : 0.07); rumble(g, S.finisher ? 0.7 : 0.25, 0.2, S.finisher ? 160 : 60);
    }
    if (S.finisher) { g.audio?.play('heavyhit', { volume: 0.7 }); if (hits.length) hitStop(g, 0.07, 0.05); this.lash(_b.copy(f).multiplyScalar(4).add(this.center), { life: 0.25 }); }
    if (this.model.fx) { this.model.fx.whip = 0.5; this.model.fx.whipAng = side; this.timers.after(0.12, () => { if (this.model.fx && !this.storm) this.model.fx.whip = 0; }); }
  }

  _airSlash() {
    if ((this.cooldowns.airslash || 0) > 0) return;
    const g = this.game;
    this.useCooldown('airslash', 0.35 / this.atkSpeed);
    this.actionT = 0.3 / this.atkSpeed; this.actionAnim = 'punch2'; this.actionMoveMul = 1; this.setAnim('punch2', 12);
    this.vel.y = Math.max(this.vel.y, 3);
    g.audio?.play('slash', { volume: 0.6, pitch: 1.2 });
    this.timers.after(0.08 / this.atkSpeed, () => {
      if (!this.active) return;
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 3.6, arc: 360, damage: this.dmg(14), knockback: 5, up: 3, stun: 0.3, source: this }) ?? [];
      for (const e of hits) this.bleed(e, 3.5);
      g.fx?.ring?.(this.center, 3.4, HOT, 0.2);
      g.fx?.burst?.(this.center, RED, 10, 6, 0.3, 0.2);
    });
  }

  // ------------------------------------------------------------------ whip storm
  _startStorm() {
    if (!this.useCooldown('storm', 8)) return;
    const g = this.game;
    this.storm = { t: 1.5, tick: 0, spin: 0 };
    this.actionT = 1.5; this.actionAnim = 'cast'; this.actionMoveMul = 0.5; this.setAnim('cast', 12);
    g.audio?.play('roar', { volume: 0.5, pitch: 1.3 }); g.audio?.play('symbiote', { volume: 0.5 });
    g.cam.shake(0.25);
    this.say('WHIP STORM', HOT, 1.2);
  }
  _stormTick(dt) {
    const S = this.storm; if (!S) return;
    const g = this.game;
    S.t -= dt; S.tick -= dt; S.spin += dt * 11;
    this.yaw += 11 * dt;
    if (this.model.fx) { this.model.fx.whip = 1; this.model.fx.whipAng = Math.sin(S.spin * 2); }
    if (S.tick <= 0) {
      S.tick = 0.15;
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: 5.8, arc: 360, damage: this.dmg(8), knockback: 6, up: 2.5, stun: 0.3, source: this }) ?? [];
      for (const e of hits) this.bleed(e, 3.5);
      this.chestPos(_a);
      for (let k = 0; k < 3; k++) {
        const a = S.spin + k * (Math.PI * 2 / 3) + Math.random() * 0.3;
        const end = new V3(_a.x + Math.sin(a) * 5.4, _a.y - 0.6 + Math.random() * 1.2, _a.z + Math.cos(a) * 5.4);
        this._pool().spawn({ from: (out) => objPos(this.model.chest, out, this.center), to: end, life: 0.2, grow: 0.05, width: 0.12, wiggle: 0.8, arc: 0.1 });
      }
      g.audio?.play('whoosh', { volume: 0.35, pitch: 1.5 });
      if (hits.length) { g.cam.shake(0.1); rumble(g, 0.3, 0.2, 60); }
    }
    this.actionT = Math.max(this.actionT, 0.05);
    if (S.t <= 0) {
      this.storm = null; this.actionT = 0.1;
      if (this.model.fx) this.model.fx.whip = 0;
    }
  }

  // ------------------------------------------------------------------ spike field
  _spikeField() {
    if (!this.useCooldown('spikes', 7)) return;
    const g = this.game;
    const t = this.faceAssist(14, 90);
    void t;
    const mul = this.dmgMul;
    this.actionT = 0.55; this.actionAnim = 'smash'; this.actionMoveMul = 0.15; this.setAnim('smash', 10);
    g.audio?.play('roar', { volume: 0.4, pitch: 1.2 }); g.audio?.play('smash', { volume: 0.6 });
    const f = this.forward, y = this.pos.y;
    const rows = [2.5, 5, 7.5, 10, 12.5];
    rows.forEach((d, ri) => {
      const n = 3 + ri;
      for (let k = 0; k < n; k++) {
        const ang = (k - (n - 1) / 2) * (0.5 / Math.max(1, ri * 0.4 + 0.6)) * 0.55;
        const a = this.yaw + ang;
        const x = this.pos.x + Math.sin(a) * d, z = this.pos.z + Math.cos(a) * d;
        this.spikes.spawn(x, y, z, 2.0 + Math.random() * 0.8, 0.34, 0.12 + ri * 0.07, 0.9, Math.sin(a) * 0.15, Math.cos(a) * 0.15);
      }
    });
    // two blasts: near and far halves of the field
    const hitOnce = new Set();
    const blast = (dist, r, delay) => this.timers.after(delay, () => {
      if (!this.active) return;
      const c = new V3(this.pos.x + f.x * dist, y, this.pos.z + f.z * dist);
      const hits = g.combat?.aoe?.({ center: c, radius: r, damage: this.dmg(30), knockback: 5, up: 12, stun: 1.0, source: this, falloff: false }) ?? [];
      for (const e of hits) { this.bleed(e, 4); hitOnce.add(e); }
      g.fx?.burst?.(c, RED, 14, 7, 0.5, 0.3);
      g.fx?.ring?.(c.clone().setY(y + 0.1), r, HOT, 0.4);
      g.cam.shake(0.25); rumble(g, 0.5, 0.3, 120);
    });
    blast(4.5, 4.6, 0.14); blast(10.5, 5.0, 0.42);
    void mul;
  }

  // ------------------------------------------------------------------ axe throw
  _axe() {
    if (this.axes.length || !this.useCooldown('axe', 6)) return;
    const g = this.game;
    this.actionT = 0.35; this.actionAnim = 'throw'; this.actionMoveMul = 0.3; this.setAnim('throw', 10);
    this.handPos(_a);
    assistAim(this, _a, 45, 8, _as);
    const dir = _as.dir.clone();
    this.yaw = Math.atan2(dir.x, dir.z);
    g.audio?.play('symbiote', { volume: 0.6 });
    g.fx?.burst?.(_a, RED, 10, 4, 0.3, 0.2);
    this.timers.after(0.14, () => {
      if (!this.active || this.dead) return;
      this.handPos(_a);
      const from = _a.clone();
      assistAim(this, from, 45, 8, _as);
      const d2 = _as.dir.clone();
      const self = this;
      const mesh = axeMesh();
      const u = { ret: false, trav: 0, lim: 21 };
      const p = g.combat.projectile({
        pos: from, vel: d2.multiplyScalar(40), kind: 'hammer', damage: this.dmg(28), radius: 0.9, life: 4, pierce: true, world: false,
        knockback: 7, stun: 0.4, up: 2.5, source: this, mesh, color: RED,
        onExpire: () => { mesh.parent?.remove(mesh); },
        onHit: (e) => { self.bleed(e, 4); g.fx?.burst?.(enemyCenter(e, _c), RED, 8, 6, 0.35, 0.2); },
        update: (pr, dt) => {
          if (!self.active) return false;
          mesh.rotation.z += 22 * dt; mesh.rotation.y = 0.3;
          u.trav += pr.vel.length() * dt;
          if (!u.ret && (u.trav > u.lim || pr.age > 0.75)) { u.ret = true; pr.hits.clear(); pr.life = Math.max(pr.life, 3); g.audio?.play('whoosh', { volume: 0.5 }); }
          if (u.ret) {
            _b.copy(self.center).sub(pr.pos); const d = _b.length();
            if (d < 1.4) { g.audio?.play('catch', { volume: 0.5 }); g.fx?.burst?.(self.center, RED, 8, 3, 0.3, 0.2); return false; }
            pr.vel.copy(_b.multiplyScalar(1 / d)).multiplyScalar(44);
          }
          g.fx?.trailPuff?.(pr.pos.x, pr.pos.y, pr.pos.z, RED, 0.35, 0.25, 0.04);
          return true;
        },
      });
      this.axes.push(p);
      g.audio?.play('throw'); g.audio?.play('whoosh', { volume: 0.6 });
    });
  }
  _axeTick() {
    for (let i = this.axes.length - 1; i >= 0; i--) if (this.axes[i].dead || this.axes[i].disposed) this.axes.splice(i, 1);
  }

  // ------------------------------------------------------------------ ultimate
  _startUlt() {
    const g = this.game;
    this.focus = 0; this.ultT = 12;
    this.actionT = 0.8; this.actionAnim = 'cast'; this.actionMoveMul = 0.1; this.setAnim('cast', 10);
    const c = this.pos.clone();
    g.combat?.aoe?.({ center: this.center, radius: 9.5, damage: this.dmg(60), knockback: 12, up: 9, stun: 1.4, source: this });
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 20 : 12, r = ring ? 8.5 : 4.5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.spikes.spawn(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r, 2.6 + ring * 0.6, 0.38, ring * 0.12 + i * 0.01, 1.3, Math.cos(a) * 0.25, Math.sin(a) * 0.25);
      }
    }
    this.waves.spawn(this.center, 11, HOT, 0.6, 0.6);
    g.fx?.shockwave?.(c, 10, RED); g.fx?.flash?.(this.center, HOT, 6, 0.3);
    // three clones
    for (let i = 0; i < 3; i++) {
      const a = this.yaw + (i - 1) * 1.9;
      const p = new V3(c.x + Math.sin(a) * 3.2, c.y + 0.2, c.z + Math.cos(a) * 3.2);
      this.clones.push(new SymbioteClone(g, this, p, { life: 12, scale: 0.8, baseHeight: 2.1, dmg: 15, speed: 12.5 }));
    }
    g.audio?.play('roar', { volume: 1, pitch: 1.1 }); g.audio?.play('smash', { volume: 0.8 });
    g.cam.shake(0.9); rumble(g, 1, 0.8, 400); hitStop(g, 0.1, 0.05);
    g.hud?.toast?.('MAXIMUM CARNAGE');
  }
  _ultTick(dt) {
    this.ultT -= dt;
    this.dmgOutMul += 0.3; // extra bloodlust while the clones fight
    if (this.ultT <= 0) {
      this.ultT = 0;
      for (const c of this.clones) c.life = Math.min(c.life, c.age + 0.3);
    }
  }
}
