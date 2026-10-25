// Anti-Venom: the healer / purifier. White symbiote with black accents; devastating to other symbiotes.
//
// Controls (keyboard / pad):
//   attack  LMB/J/Square     purifying punches (4 hits). Against symbiote enemies: x1.8 damage and a much longer stun
//   special RMB/K/R1         CURE BURST: white shockwave (11 m) - hurts + stuns symbiotes badly, heals you 15 hp
//   ability E/L1             ANTIBODY SPIKES: eight white spikes volley at your target / reticle (hold aim for precision), slight homing
//   ability2 R/L2            PURGE: seize a symbiote enemy and tear the symbiote off it - huge damage; on a boss it strips the armour
//                            (boss takes +40% damage for 8 s)
//   dodge C/Ctrl/Circle      dash
//   swing Shift/R2           TENDRIL SWING: a lighter, more agile tendril launch than Venom's (more air steering)
//   jump (hold)              jump jets then glide on the white membrane; walk into walls to crawl
//   passive                  regenerates 4 hp/s, immune to symbiote goo damage-over-time
//   ultimate Q/R3            PURIFICATION WAVE: 25 m white wave - symbiotes are annihilated, everything is stunned,
//                            you are fully healed and every other hero recovers 50% hp
import * as THREE from 'three';
import { SymbioteHero, isSymbiote } from './symbiote/base.js';
import { assistAim, enemyCenter, rumble, impactFx, hitStop, PressureWaves, objPos } from './avengers/util.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _as = {};
const WHITE = 0xffffff, HALO = 0xbfd4ff, SYM_MUL = 1.8;

const PUNCH = [
  { anim: 'punch1', t: 0.34, hit: 0.11, dmg: 15, range: 3.1, arc: 120, kb: 5, up: 1.5, stun: 0.3, lunge: 5 },
  { anim: 'punch2', t: 0.34, hit: 0.11, dmg: 15, range: 3.1, arc: 120, kb: 5, up: 1.5, stun: 0.3, lunge: 5 },
  { anim: 'kick', t: 0.40, hit: 0.13, dmg: 17, range: 3.4, arc: 150, kb: 8, up: 2, stun: 0.4, lunge: 4 },
  { anim: 'uppercut', t: 0.56, hit: 0.2, dmg: 27, range: 3.4, arc: 120, kb: 6, up: 10, stun: 0.7, lunge: 3, heavy: true },
];

let SKIN = null;
function skin() {
  if (SKIN) return SKIN;
  const geo = new THREE.ConeGeometry(0.11, 1.1, 6); geo.rotateX(Math.PI / 2);
  SKIN = {
    tend: new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 0.3, metalness: 0.05, emissive: 0x6f88d8, emissiveIntensity: 0.08 }),
    spikeGeo: geo,
    spikeMat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    glowMat: new THREE.MeshBasicMaterial({ color: 0x9fc0ff, toneMapped: false, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  return SKIN;
}
function spikeMesh() {
  const S = skin();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(S.spikeGeo, S.spikeMat));
  const glow = new THREE.Mesh(S.spikeGeo, S.glowMat); glow.scale.set(1.6, 1.6, 1.1); g.add(glow);
  return g;
}

export class AntiVenomHero extends SymbioteHero {
  constructor(game) {
    const S = skin();
    super(game, {
      id: 'antivenom', name: 'Anti-Venom', color: '#f4f8ff', modelId: 'antivenom',
      maxHp: 260, walkSpeed: 7.5, runSpeed: 14, jumpSpeed: 11.5, gravity: 26, radius: 0.5, height: 2.0, airControl: 0.55, mass: 1.6,
      usesAim: true, aimPreset: { fov: 50, distance: 3.4, shoulder: 0.9, height: 1.9 },
      tendril: { material: S.tend, count: 28 },
      wings: { color: 0xeef3ff, emissive: 0x90a8ff },
      mv: {
        walk: 7.5, run: 14, sprint: 19, jump: 11.5, boost: 26, boostT: 0.7, jumpFwd: 3, airCtl: 0.6, stepShake: 0,
        wallSpeed: 9, wallSprint: 15, wallJumpOut: 12, wallJumpUp: 14,
        glide: true, glideSpeed: 22, glideFall: -3.5,
        dashSp: 22, dashTime: 0.2, dodgeCd: 0.6, fxColor: HALO,
        launch: { range: 60, minDist: 6, speed: 34, accel: 70, lift: 0.3, steer: 9, cd: 0.3, maxT: 2.4, endDist: 2, releaseUp: 5, keep: 0.92, width: 0.055 },
      },
    });
    this.waves = new PressureWaves(game.scene, 4);
    this.exposed = new Map();        // enemy -> { t } armour stripped
    this.purging = null;
    this.gooImmune = true;
    this.ultT = 0;
  }

  onCleanup() {
    this.waves.clear();
    for (const [e] of this.exposed) this._unexpose(e);
    this.exposed.clear();
    if (this.purging) { this.drop(this.purging, 0.3); this.purging = null; }
    this.locked = false;
  }

  get abilityHints() {
    return [
      { action: 'swing', label: 'Tendril Swing', cooldown: this.cooldownFrac('launch'), active: this.state === 'launch' },
      { action: 'special', label: 'Cure Burst', cooldown: this.cooldownFrac('cure') },
      { action: 'ability', label: 'Antibody Spikes', cooldown: this.cooldownFrac('spikes') },
      { action: 'ability2', label: 'Purge', cooldown: this.cooldownFrac('purge'), active: !!this.purging },
      { action: 'attack', label: 'Purify Punch', cooldown: 0 },
      { action: 'ultimate', label: 'Purification Wave', cooldown: 1 - this.focus / 100, active: this.ultT > 0 },
    ];
  }

  // ------------------------------------------------------------------ helpers
  /** Extra damage against symbiote enemies (total x1.8) plus a long stun. */
  purify(e, base, stun = 1.5) {
    if (!e || !e.alive || !isSymbiote(e)) return false;
    const extra = base * (SYM_MUL - 1);
    e.invuln = 0;
    const dealt = e.takeDamage?.(extra, { stun, source: this, kind: 'purify' }) ?? 0;
    const c = enemyCenter(e, _a);
    this.game.fx?.burst?.(c, WHITE, 10, 5, 0.4, 0.22);
    this.game.fx?.burst?.(c, 0x3a1060, 6, 3, 0.5, 0.25);
    if (dealt > 0) this.game.fx?.text?.(_b.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), '+' + Math.round(dealt), HALO, { size: 1.0, life: 0.7 });
    return true;
  }
  _expose(e, secs = 8, mul = 1.4) {
    const cur = this.exposed.get(e);
    if (cur) { cur.t = secs; return; }
    e.damageTaken = (e.damageTaken ?? 1) * mul;
    e.model?.setTint?.(0xffffff, 0.35);
    this.exposed.set(e, { t: secs, mul });
  }
  _unexpose(e) {
    const x = this.exposed.get(e);
    if (!x) return;
    e.damageTaken = (e.damageTaken ?? 1) / x.mul;
    e.model?.setTint?.(0xffffff, 0);
  }
  _exposeTick(dt) {
    if (!this.exposed.size) return;
    for (const [e, x] of this.exposed) {
      x.t -= dt;
      if (!e.alive || e.removed || x.t <= 0) { if (e.alive) this._unexpose(e); this.exposed.delete(e); continue; }
      if (Math.random() < 0.15) this.game.fx?.burst?.(enemyCenter(e, _a), WHITE, 1, 2, 0.5, 0.15);
    }
  }

  // ------------------------------------------------------------------ per-frame
  tick(dt, input) {
    this.waves.update(dt);
    if (!this.dead && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);
    this._exposeTick(dt);
    if (this.purging) this._purgeTick(dt);
    if (this.ultT > 0) this.ultT -= dt;
    this._setReticle(this.aiming ? 'repulsor' : null);
  }

  // ------------------------------------------------------------------ dispatcher
  combat(dt, input) {
    if (input.pressed('ultimate') && this.focus >= 100 && this.ultT <= 0 && this.state !== 'launch' && !this.purging) { this._startUlt(); return; }
    if (this.locked || this.state === 'launch' || this.actionT > 0) return;
    if (input.pressed('attack')) { this._punch(); return; }
    if (this.pressedSpecial()) { this._cure(); return; }
    if (input.pressed('ability')) { this._spikes(); return; }
    if (this.pressedAbility2()) this._purge();
  }

  // ------------------------------------------------------------------ purifying punches
  _punch() {
    const g = this.game;
    const step = this.chain = this.chainT > 0 ? (this.chain % 4) + 1 : 1;
    this.chainT = 1.1;
    const S = PUNCH[step - 1];
    this.faceAssist(6, 120);
    this.actionT = S.t; this.actionAnim = S.anim; this.actionMoveMul = 0.35;
    if (this.state !== 'wall' && this.onGround) { const f = this.forward; this.vel.x += f.x * S.lunge; this.vel.z += f.z * S.lunge; }
    this.setAnim(S.anim, 10);
    g.audio?.play('punch', { volume: 0.55, pitch: 1.1 });
    this.timers.after(S.hit, () => {
      if (!this.active || this.dead) return;
      const dmg = this.dmg(S.dmg);
      const hits = g.combat?.melee?.({ origin: this.center, forward: this.forward, range: S.range, arc: S.arc, damage: dmg, knockback: S.kb, up: S.up, stun: S.stun, source: this, heavy: !!S.heavy }) ?? [];
      let sym = 0;
      for (const e of hits) if (this.purify(e, dmg, S.heavy ? 2.4 : 1.5)) sym++;
      this.handPos(_a);
      g.fx?.flash?.(_a, HALO, 3, 0.12);
      g.fx?.burst?.(_a, WHITE, 6, 5, 0.3, 0.18);
      if (hits.length) { g.cam.shake(S.heavy ? 0.25 : 0.08); rumble(g, S.heavy ? 0.7 : 0.3, 0.2, S.heavy ? 160 : 70); }
      if (S.heavy) { g.audio?.play('heavyhit', { volume: 0.6 }); if (hits.length) hitStop(g, 0.07, 0.05); this.waves.spawn(this.center, 3.2, HALO, 0.3, 0.7); }
      if (sym) g.audio?.play('symbiote', { volume: 0.4, pitch: 1.6 });
    });
  }

  // ------------------------------------------------------------------ cure burst
  _cure() {
    if (!this.useCooldown('cure', 9)) return;
    const g = this.game;
    const R = 11;
    this.actionT = 0.5; this.actionAnim = 'cast'; this.actionMoveMul = 0.2; this.setAnim('cast', 10);
    this.timers.after(0.15, () => {
      if (!this.active || this.dead) return;
      const dmg = this.dmg(18);
      const hits = g.combat?.aoe?.({ center: this.center, radius: R, damage: dmg, knockback: 12, up: 5, stun: 0.8, source: this, falloff: false }) ?? [];
      let n = 0;
      for (const e of hits) {
        if (isSymbiote(e)) { n++; e.invuln = 0; e.takeDamage?.(e.isBoss ? 45 * this.dmgMul : 60 * this.dmgMul, { stun: 2.2, source: this, kind: 'purify' }); }
      }
      this.heal(15);
      g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.4, this.pos.z), '+15', 0x66ff88, { size: 1.3, life: 1.1 });
      const c = this.pos.clone();
      this.waves.spawn(this.center, R, WHITE, 0.6, 0.7);
      g.fx?.shockwave?.(c, R, WHITE);
      g.fx?.ring?.(c.clone().setY(c.y + 0.1), R * 0.6, HALO, 0.5);
      g.fx?.flash?.(this.center, WHITE, 6, 0.25);
      g.fx?.burst?.(this.center, WHITE, 30, 8, 0.7, 0.3);
      g.audio?.play('explosion', { volume: 0.4, pitch: 1.6 }); g.audio?.play('symbiote', { volume: 0.7, pitch: 1.5 });
      g.cam.shake(0.45); rumble(g, 0.8, 0.5, 220);
      if (n) hitStop(g, 0.08, 0.05);
    });
  }

  // ------------------------------------------------------------------ antibody spikes
  _spikes() {
    if (!this.useCooldown('spikes', 7)) return;
    const g = this.game;
    this.handPos(_a);
    assistAim(this, _a, 70, this.aiming ? 6 : 11, _as);
    const target = _as.target;
    const point = _as.point.clone();
    this.yaw = Math.atan2(point.x - this.pos.x, point.z - this.pos.z);
    this.actionT = 0.85; this.actionAnim = 'shoot'; this.actionMoveMul = 0.4; this.setAnim('shoot', 10);
    g.audio?.play('repulsor', { volume: 0.5, pitch: 1.5 });
    const N = 8;
    for (let i = 0; i < N; i++) {
      this.timers.after(0.06 + i * 0.07, () => {
        if (!this.active || this.dead) return;
        const side = i % 2 ? 1 : -1;
        this.chestPos(_b);
        const rf = this.forward;
        const from = new V3(_b.x - rf.z * side * 0.45, _b.y + 0.15 + (i % 3) * 0.12, _b.z + rf.x * side * 0.45);
        const aimTo = target && target.alive ? enemyCenter(target, new V3()) : point;
        const dir = aimTo.clone().sub(from).normalize();
        dir.x += (Math.random() - 0.5) * 0.06; dir.y += (Math.random() - 0.5) * 0.06; dir.z += (Math.random() - 0.5) * 0.06; dir.normalize();
        const mesh = spikeMesh();
        const dmg = this.dmg(14);
        g.combat.projectile({
          pos: from, vel: dir.multiplyScalar(58), kind: 'repulsor', color: WHITE, damage: dmg, radius: 0.35, life: 1.6,
          homing: target && target.alive ? target : null, turn: 2.6, knockback: 4, stun: 0.3, up: 1, source: this, mesh,
          onHit: (e) => this.purify(e, dmg, 1.2),
          onExpire: () => { mesh.parent?.remove(mesh); },
        });
        g.fx?.flash?.(from, HALO, 2, 0.08);
        g.audio?.play('repulsor', { volume: 0.25, pitch: 2 + Math.random() * 0.3 });
      });
    }
    g.cam.shake(0.1);
  }

  // ------------------------------------------------------------------ purge
  _pickSymbiote() {
    let best = null, bd = 1e9;
    const f = this.forward;
    for (const e of this.foes) {
      if (!e.alive || e.untargetable || !isSymbiote(e)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 10) continue;
      if (d > 3.5 && (dx * f.x + dz * f.z) / d < 0.3) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  _purge() {
    const g = this.game;
    if ((this.cooldowns.purge || 0) > 0) return;
    const e = this._pickSymbiote();
    if (!e) { this.cooldowns.purge = 0.4; this.say('NO SYMBIOTE', 0xaaaaaa, 0.9); return; }
    this.useCooldown('purge', 12);
    this.yaw = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    this.actionT = 1.0; this.actionAnim = 'cast'; this.actionMoveMul = 0; this.setAnim('cast', 10);
    this.locked = true;
    const h = this.seize(e);
    h.mul = this.dmgMul;
    h.rope = this._pool().spawn({ from: (out) => objPos(this.model.handR, out, this.center), to: (out) => enemyCenter(e, out), life: 1.0, grow: 0.12, width: 0.13, wiggle: 0.5, retract: 0.15 });
    this.purging = h;
    g.audio?.play('symbiote', { volume: 0.8, pitch: 1.4 });
    g.fx?.burst?.(enemyCenter(e, _a), WHITE, 12, 5, 0.4, 0.22);
  }
  _purgeTick(dt) {
    const g = this.game, h = this.purging, e = h.e;
    if (!e.alive || e.removed) { this.purging = null; this.locked = false; return; }
    this.carry(h, dt, 1.3, 0.6, 0.3);
    // white light pours in, black goo is torn out
    if (Math.random() < 0.7) {
      enemyCenter(e, _a);
      g.fx?.burst?.(_a, WHITE, 2, 3, 0.4, 0.2);
      g.fx?.burst?.(_b.set(_a.x + (Math.random() - 0.5) * 0.8, _a.y + (Math.random() - 0.5), _a.z + (Math.random() - 0.5) * 0.8), 0x2a0a40, 2, 4, 0.5, 0.28);
    }
    if (h.t > 0.3 && !h.rippedNow && h.t >= 0.62) {
      h.rippedNow = true;
      this._rip(h);
    }
  }
  _rip(h) {
    const g = this.game, e = h.e;
    this.purging = null; this.locked = false;
    e.gravity = h.grav ?? 28; e.invuln = 0;
    if (h.rope && h.rope.active) h.rope.age = Math.max(h.rope.age, h.rope.life - h.rope.retract);
    const c = enemyCenter(e, _c).clone();
    if (e.isBoss) {
      e.takeDamage?.(70 * h.mul, { stun: 1.5, source: this, kind: 'purge' });
      this._expose(e, 8, 1.4);
      g.fx?.text?.(_a.set(e.pos.x, e.pos.y + e.height + 1.1, e.pos.z), 'ARMOUR STRIPPED  +40%', HALO, { size: 1.5, life: 1.6 });
    } else {
      e.takeDamage?.(150 * h.mul, { knockback: new V3(0, 5, 0), stun: 2.5, source: this, kind: 'purge' });
      g.fx?.text?.(_a.set(e.pos.x, e.pos.y + e.height + 1.0, e.pos.z), 'PURGED', HALO, { size: 1.5, life: 1.2 });
      if (e.alive) { e.downTimer = 1.5; e.stunTimer = Math.max(e.stunTimer, 3); }
    }
    g.fx?.burst?.(c, WHITE, 36, 9, 0.7, 0.3);
    g.fx?.burst?.(c, 0x2a0a40, 24, 8, 0.8, 0.35);
    g.fx?.shockwave?.(e.pos.clone(), 5, WHITE);
    g.fx?.flash?.(c, WHITE, 6, 0.25);
    g.audio?.play('heavyhit'); g.audio?.play('symbiote', { volume: 0.9, pitch: 0.8 }); g.audio?.play('roar', { volume: 0.4, pitch: 1.8 });
    g.cam.shake(0.5); rumble(g, 0.9, 0.6, 250); hitStop(g, 0.1, 0.04);
    this.addFocus(15); this.registerHit();
  }

  // ------------------------------------------------------------------ ultimate: Purification Wave
  _startUlt() {
    const g = this.game;
    this.focus = 0; this.ultT = 1.2;
    this.actionT = 1.1; this.actionAnim = 'cast'; this.actionMoveMul = 0; this.setAnim('cast', 10);
    this.invuln = Math.max(this.invuln, 1.3);
    const R = 25, c = this.pos.clone();
    this.waves.spawn(this.center, R, WHITE, 1.0, 0.75);
    this.timers.after(0.18, () => this.waves.spawn(this.center, R * 0.7, HALO, 0.9, 0.6));
    g.fx?.shockwave?.(c, R, WHITE);
    [0.3, 0.6, 1.0].forEach((k, i) => this.timers.after(i * 0.2, () => g.fx?.ring?.(c.clone().setY(c.y + 0.1), R * k, WHITE, 0.7)));
    g.fx?.flash?.(this.center, WHITE, 10, 0.5);
    g.audio?.play('explosion', { volume: 0.7, pitch: 1.4 }); g.audio?.play('symbiote', { volume: 1, pitch: 1.6 });
    g.audio?.play('roar', { volume: 0.5, pitch: 1.8 });
    g.cam.shake(1.1); rumble(g, 1, 1, 500);
    g.slowmo?.(0.35, 0.3);
    g.hud?.toast?.('PURIFICATION WAVE');

    // everything is hit and stunned; symbiotes are annihilated as the wave reaches them
    this.timers.after(0.1, () => {
      if (!this.active) return;
      g.combat?.aoe?.({ center: this.center, radius: R, damage: this.dmg(25), knockback: 14, up: 7, stun: 3.0, source: this, falloff: false });
    });
    for (const e of this.foes) {
      if (!e.alive || e.untargetable) continue;
      const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
      if (d > R + e.radius) continue;
      const delay = 0.12 + (d / R) * 0.7;
      this.timers.after(delay, () => {
        if (!this.active || !e.alive) return;
        e.invuln = 0;
        e.stunTimer = Math.max(e.stunTimer, 3);
        if (isSymbiote(e)) {
          const dmg = e.isBoss ? 260 : 220;
          e.takeDamage?.(dmg * this.dmgMul, { knockback: new V3((e.pos.x - c.x) / (d || 1) * 6, 6, (e.pos.z - c.z) / (d || 1) * 6), stun: 3, source: this, kind: 'purify' });
          g.fx?.burst?.(enemyCenter(e, _a), WHITE, 22, 8, 0.6, 0.28);
          g.fx?.burst?.(_a, 0x2a0a40, 10, 5, 0.6, 0.3);
          if (e.alive && e.isBoss) this._expose(e, 8, 1.25);
        }
      });
    }
    // healing light for the whole team
    const heroes = g.heroes ? (Array.isArray(g.heroes) ? g.heroes : Object.values(g.heroes)) : [];
    for (const h of heroes) {
      if (!h || h.hp <= 0 || h.dead) continue;
      if (h === this) h.hp = h.maxHp; else h.heal(h.maxHp * 0.5);
    }
    this.hp = this.maxHp;
    g.fx?.text?.(_a.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z), 'TEAM HEALED', 0x66ff88, { size: 1.5, life: 1.5 });
    impactFx(g, c, 8, WHITE, 0.8);
  }
}
