// Captain America: shield-and-fist combo, ricochet SHIELD THROW (hold = charged, bounces off walls), Shield Charge,
// hold-to-BLOCK with a 0.2 s PARRY window, Avengers Assemble (slam + rally buff for everyone).
//   attack J/LMB/□   special K/RMB/R1 throw (hold to charge)   ability E/L1 Shield Charge   ability2 R/L2 hold = Block / Parry
//   ultimate Q/R3 Avengers Assemble   dodge C/○ = combat roll   jump twice = shield-assisted double jump   walk into low ledges = auto-vault
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { Timers, aimInfo, enemiesNear, enemyCenter, rumble, impactFx, clamp, damp, objPos, hurt, inFront, impact } from './squad/util.js';

// ---- tuning ----------------------------------------------------------------
const WALK = 6.5, RUN = 12.5, SPRINT = 15, JUMP = 11.5, DJUMP = 12, GRAV = 27;
const THROW_SPEED = 38, THROW_SPEED_CHARGED = 48, THROW_RANGE = 28, THROW_RANGE_CHARGED = 40, CHAIN_RANGE = 15, CHARGE_MIN = 0.3, CHARGE_FULL = 1.1;
const CHARGE_CD = 4, CHARGE_DIST = 12, CHARGE_TIME = 0.32;
const PARRY_WINDOW = 0.2, BLOCK_ARC = 120, BLOCK_SPEED = 3.4;
const ULT_RADIUS = 15, ULT_DMG = 85, RALLY_TIME = 15, RALLY_MUL = 1.3;
const BLUE = 0x2f6bd8, RED = 0xd8302f, WHITE = 0xffffff, GOLD = 0xffd060;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };

// ---- shield mesh (shared geometry) -------------------------------------------------
let SH = null;
function shieldAssets() {
  if (SH) return SH;
  const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 28);
  const std = (c, m = 0.9, r = 0.25) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, emissive: c, emissiveIntensity: 0.18 });
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? 0.075 : 0.18, a = Math.PI / 2 + i * Math.PI / 5; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) star.lineTo(x, y); else star.moveTo(x, y); }
  star.closePath();
  SH = {
    rings: [[0.52, 0.05, std(RED)], [0.42, 0.058, std(0xe8ecf4, 0.95, 0.2)], [0.32, 0.066, std(RED)], [0.22, 0.074, std(BLUE)]].map(([r, h, m]) => ({ geo: cyl(r, h), mat: m })),
    star: new THREE.ShapeGeometry(star), starMat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false }),
  };
  return SH;
}
function buildShield() {
  const A = shieldAssets();
  const root = new THREE.Group(), tilt = new THREE.Group(), spin = new THREE.Group();
  A.rings.forEach((r, i) => { const m = new THREE.Mesh(r.geo, r.mat); m.position.y = i * 0.004; spin.add(m); });
  for (const s of [1, -1]) {
    const st = new THREE.Mesh(A.star, A.starMat);
    st.rotation.x = -s * Math.PI / 2; st.position.y = s * 0.042; if (s < 0) st.rotation.z = Math.PI;
    spin.add(st);
  }
  tilt.add(spin); root.add(tilt);
  root.userData = { tilt, spin, noOrient: true };
  root.traverse((o) => { o.frustumCulled = false; });
  return root;
}

export class CaptainAmerica extends Hero {
  constructor(game) {
    super(game, { id: 'captain', name: 'Captain America', color: '#2f6bd8', maxHp: 190, walkSpeed: WALK, runSpeed: RUN, jumpSpeed: JUMP, gravity: GRAV, radius: 0.45, height: 1.88, airControl: 0.55, mass: 1.1 });
    this.timers = new Timers();
    this.mode = 'normal';       // normal | charge | roll | ult
    this.modeT = 0;
    this.dmgMul = 1;
    this.actionT = 0; this.actionAnim = 'idle';
    this.chain = 0; this.chainT = 0; this.bufferT = 0;
    this.jumped2 = false; this.airT = 0; this.vaultCd = 0;
    this.moveDir = new THREE.Vector3(0, 0, 1); this.modeSpeed = 0; this.chargeHit = new Set();
    // shield
    this.shieldOut = false; this.proj = null; this.fl = null; this.heldVisible = true;
    this.throwHold = 0; this.holding = false;
    this.thrownMesh = null; this.blockMesh = null;
    // block
    this.blocking = false; this.blockT = 0; this.blockCool = 1; this.parryFx = 0;
    this.stepT = 0; this.fov = 0; this._impactVy = 0; this.rallyFx = 0; this.ultT = 0; this.chargeFx = 0;
  }

  onActivate() {
    this.mode = 'normal'; this.actionT = 0; this.gravityScale = 1; this.jumped2 = false;
    this.thrownMesh ??= buildShield();
    this.blockMesh ??= buildShield();
    this.blockMesh.userData.tilt.rotation.x = Math.PI / 2;   // face forward (disc normal -> +Z)
    this.blockMesh.userData.tilt.rotation.z = 0;
    this.blockMesh.visible = false; this.thrownMesh.visible = false;
    this.game.scene.add(this.blockMesh);
    this.shieldOut = false; this.proj = null; this.fl = null; this.blocking = false; this.holding = false; this.throwHold = 0;
    this._setHeld(true);
  }
  onDeactivate() {
    const g = this.game;
    this.timers.clear();
    if (this.proj) { this.proj.remove?.(); this._dropProj(); }
    this.shieldOut = false; this.proj = null; this.fl = null;
    this.blocking = false; this.holding = false; this.mode = 'normal'; this.gravityScale = 1;
    this._xhair(g, null);
    if (this.blockMesh) { this.blockMesh.visible = false; this.blockMesh.parent?.remove(this.blockMesh); }
    if (this.thrownMesh) this.thrownMesh.parent?.remove(this.thrownMesh);
    this.heldVisible = false; this._setHeld(true);
    g.cam.fovKick = 0;
  }

  get abilityHints() {
    const rally = (this.game.rallyUntil ?? 0) > this.game.time;
    return [
      { action: 'special', label: 'Shield Throw', cooldown: this.shieldOut ? 1 : 0, active: this.shieldOut || this.holding },
      { action: 'ability', label: 'Shield Charge', cooldown: this.cooldownFrac('charge'), active: this.mode === 'charge' },
      { action: 'ability2', label: 'Block / Parry', cooldown: 0, active: this.blocking },
      { action: 'ultimate', label: 'Avengers Assemble', cooldown: 1 - this.focus / 100, active: rally || this.mode === 'ult' },
    ];
  }

  /** Damage multiplier incl. the Avengers Assemble rally. */
  dm() { return this.dmgMul * ((this.game.rallyUntil ?? 0) > this.game.time ? RALLY_MUL : 1); }

  // ---- held shield model hooks (all optional) ----------------------------------------
  _setHeld(vis) {
    if (vis === this.heldVisible) return;
    this.heldVisible = vis;
    const m = this.model;
    if (vis) { if (m.attachShield) m.attachShield(); else if (m.shield) m.shield.visible = true; }
    else { if (m.detachShield) m.detachShield(); else if (m.shield) m.shield.visible = false; }
  }
  _handPos(out) {
    return objPos(this.model.handL ?? this.model.handR, out, this.center);
  }

  // ---- damage: block / parry -----------------------------------------------------------
  takeDamage(amount, fromPos) {
    if (this.dead) return false;
    if (this.blocking && (!fromPos || inFront(this.pos, this.yaw, fromPos, BLOCK_ARC))) {
      const g = this.game;
      const parry = this.blockT <= PARRY_WINDOW && this.parryOk;
      _a.copy(this.center).addScaledVector(this.forward, 0.9);
      if (parry) this._parry(fromPos);
      else {
        g.fx?.hitSpark?.(_a, 0xcfe4ff, amount >= 24);
        g.fx?.burst?.(_a, 0xcfe4ff, 6, 4, 0.3, 0.12);
        g.audio?.play('heavyhit', { volume: 0.5, pitch: 0.7 });
        g.fx?.text?.(_a.clone().setY(_a.y + 0.5), 'BLOCK', 0xcfe4ff);
        g.input?.rumble?.(0.4, 0.3, 90); g.cam.shake(0.08);
        if (fromPos) { _b.subVectors(this.pos, fromPos).setY(0).normalize(); this.vel.addScaledVector(_b, 2.5); }
        this.addFocus(1.5);
      }
      return false;
    }
    return super.takeDamage(amount, fromPos);
  }
  onAttackEvaded() {
    if (this.mode === 'roll' || this.mode === 'charge') { this.addFocus(6); this.game.fx?.text?.(this.center.setY(this.pos.y + this.height + 0.5), 'DODGE', GOLD); }
  }
  _parry(fromPos) {
    const g = this.game;
    this.invuln = Math.max(this.invuln, 0.25);
    _a.copy(this.center).addScaledVector(this.forward, 0.9);
    g.fx?.text?.(_a.clone().setY(_a.y + 0.6), 'PARRY', GOLD, { size: 1.5 });
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 1), 5, WHITE, 0.4);
    g.fx?.burst?.(_a, GOLD, 18, 7, 0.4, 0.18);
    g.fx?.flash?.(_a, 0xcfe4ff, 5, 0.15);
    g.audio?.play('clap', { volume: 0.9 }); impact(g, 0.8, false);
    g.slowmo?.(0.25, 0.3);
    this.addFocus(12);
    // stun nearby attackers in front
    for (const e of enemiesNear(g, this.pos, 4.5)) {
      if (!inFront(this.pos, this.yaw, e.pos, 160)) continue;
      _b.subVectors(e.pos, this.pos).setY(0).normalize();
      hurt(g, this, e, 14 * this.dm(), { kb: _b.clone().multiplyScalar(8).setY(3), stun: 2.0, kind: 'parry', color: GOLD });
    }
    this._reflect(6);
  }
  /** Turn enemy projectiles near the shield back on the shooter. */
  _reflect(r) {
    const g = this.game;
    let n = 0;
    for (const p of g.combat?.projectiles ?? []) {
      if (p.dead || p.team !== 'enemy') continue;
      if (p.pos.distanceTo(this.center) > r) continue;
      const sp = Math.max(p.vel.length(), 20) * 1.3;
      const tgt = g.enemies?.nearest?.(p.pos, 40);
      if (tgt) _c.copy(enemyCenter(tgt, _w)).sub(p.pos); else _c.copy(p.origin).sub(p.pos);
      if (_c.lengthSq() < 0.01) _c.copy(this.forward);
      p.vel.copy(_c.normalize()).multiplyScalar(sp);
      p.team = 'player'; p.hits?.clear(); p.source = this; p.damage = Math.max(p.damage, 8) * 2.5; p.life = Math.max(p.life, 2); p.homing = null;
      g.fx?.hitSpark?.(p.pos, GOLD, true); n++;
    }
    return n;
  }

  // ---- update ----------------------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.chainT -= dt; if (this.chainT <= 0) this.chain = 0;
    this.modeT += dt; this.vaultCd -= dt; if (!this.blocking) this.blockCool += dt;
    this.customMovement = true;
    if (this.onGround) { this.airT = 0; this.jumped2 = false; } else this.airT += dt;

    // recover a shield that vanished (combat reset, etc.)
    if (this.shieldOut && (!this.proj || this.proj.disposed)) this._catch(true);

    const normal = this.mode === 'normal';
    const free = normal && this.actionT <= 0;

    // --- block (hold ability2)
    const wantBlock = input.down('ability2') && free && !this.shieldOut && !this.holding && this.mode === 'normal';
    if (wantBlock && !this.blocking) { this.blocking = true; this.blockT = 0; this.parryOk = this.blockCool >= 0.3; this._setHeld(false); this.blockMesh.visible = true; g.audio?.play('whoosh', { volume: 0.4, pitch: 0.8 }); this.setAnim('idle'); }
    else if (!wantBlock && this.blocking) { this.blocking = false; this.blockCool = 0; this.blockMesh.visible = false; if (!this.shieldOut) this._setHeld(true); }
    if (this.blocking) {
      this.blockT += dt;
      if (this.blockT <= PARRY_WINDOW + dt) this._reflect(5);
      this.parryFx -= dt;
    }

    // --- shield throw: tap = throw, hold = charge
    if (!this.shieldOut && free && !this.blocking) {
      if (input.pressed('special')) { this.holding = true; this.throwHold = 0; }
      if (this.holding) {
        this.throwHold += dt;
        if (this.throwHold > CHARGE_MIN) {
          const f = clamp((this.throwHold - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1);
          this.chargeFx -= dt;
          if (this.chargeFx <= 0) { this.chargeFx = 0.12; g.fx?.burst?.(this._handPos(_c).clone(), f >= 1 ? GOLD : 0x9fc8ff, 3, 3, 0.3, 0.15); g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 2.5 - f * 1.5, 0x9fc8ff, 0.2); if (f >= 1) rumble(g, 0.1, 0.4, 60); }
          g.cam.shake(0.01 + f * 0.03);
          g.cam.requestAim?.({ fov: 50 - f * 8, distance: 2.4, shoulder: 0.85, height: 1.6 });
          this._xhair(g, 'shield');
        }
        if (!input.down('special')) { const c = this.throwHold; this.holding = false; this.throwHold = 0; this._throw(c); }
      }
    } else if (this.holding && !free) { this.holding = false; this.throwHold = 0; }

    if (!this.holding || this.throwHold <= CHARGE_MIN) this._xhair(g, null);
    if (input.pressed('attack') && !this.blocking) {
      if (free && !this.holding) this._combo();
      else if (normal) this.bufferT = 0.3;
    }
    if (this.bufferT > 0) { this.bufferT -= dt; if (free && !this.holding && !this.blocking && normal) { this.bufferT = 0; this._combo(); } }
    if (input.pressed('ability') && normal && !this.blocking && (this.cooldowns.charge || 0) <= 0) this._charge(input);
    if (input.pressed('dodge') && normal && (this.cooldowns.dodge || 0) <= 0) this._dodge(input);
    if (input.pressed('ultimate') && this.focus >= 100 && this.mode !== 'ult') this._startUlt();

    this._rally(dt);
    this._movement(dt, input);
    this._blockVisual();

    this._impactVy = this.vel.y;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.fov = damp(this.fov, this.mode === 'charge' ? 14 : this.onGround && hs > RUN + 1 ? 6 : 0, 5, dt);
    g.cam.fovKick = this.fov;
  }

  defaultMovement() {}
  _xhair(g, k) { if (this._xh !== k) { this._xh = k; g.hud?.setCrosshair?.(k); } }

  _blockVisual() {
    if (!this.blockMesh) return;
    const m = this.blockMesh;
    if (this.mode === 'ult') return;
    if (this.mode === 'charge' && !this.shieldOut) {
      m.visible = true;
    } else if (!this.blocking) { m.visible = false; return; }
    const f = this.forward;
    m.position.set(this.pos.x + f.x * 0.8, this.pos.y + this.height * 0.55, this.pos.z + f.z * 0.8);
    m.rotation.set(0, this.yaw, 0);
    const k = this.blocking && this.blockT < 0.12 ? 0.6 + this.blockT / 0.12 * 0.4 : 1;
    m.scale.setScalar(1.45 * k);
  }

  _rally(dt) {
    const g = this.game;
    if ((g.rallyUntil ?? 0) <= g.time) return;
    this.rallyFx -= dt;
    if (this.rallyFx <= 0) {
      this.rallyFx = 0.8;
      g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 2.2, GOLD, 0.6);
    }
  }

  // ---- movement ------------------------------------------------------------------------------
  _movement(dt, input) {
    const g = this.game, cam = g.cam;
    const wish = cam.moveVector(input.move, _w);
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();

    if (this.mode === 'charge') { this._chargeMove(dt); return; }
    if (this.mode === 'roll') { this._rollMove(dt); return; }
    if (this.mode === 'ult') { this._ultMove(dt); return; }
    this.gravityScale = 1;

    const sprint = input.down('sprint') || input.down('swing');
    const busy = this.actionT > 0;
    let base = sprint ? SPRINT : mag > 0.6 ? RUN : WALK;
    let speed = base * mag;
    if (this.blocking) speed = Math.min(speed, BLOCK_SPEED * mag);
    else if (this.holding) speed *= 0.4;
    else if (busy) speed *= 0.4;
    const air = !this.onGround;
    const accel = air ? 20 : 60;
    this.vel.x = approach(this.vel.x, wish.x * speed, accel * dt);
    this.vel.z = approach(this.vel.z, wish.z * speed, accel * dt);
    if (this.blocking || this.holding) {
      _a.copy(cam.forward).setY(0); if (_a.lengthSq() > 0.01) this.faceTowards(_a, dt, 14);
    } else if (mag > 0.01 && !busy) this.faceTowards(wish, dt, air ? 6 : 14);

    // jump + shield-assisted double jump
    if (input.pressed('jump') && !this.blocking) {
      if (this.onGround) { this.vel.y = JUMP; this.onGround = false; g.audio?.play('jump'); }
      else if (!this.jumped2 && this.airT > 0.08) {
        this.jumped2 = true; this.vel.y = DJUMP;
        _a.copy(this.pos).setY(this.pos.y + 0.2);
        g.fx?.ring?.(_a, 2.6, 0xcfe4ff, 0.3); g.fx?.burst?.(_a, 0xcfe4ff, 10, 4, 0.35, 0.16);
        g.audio?.play('jump', { pitch: 1.35, volume: 0.8 }); g.audio?.play('whoosh', { volume: 0.3, pitch: 1.2 });
      }
    }
    // parkour vault over low ledges
    if (this.onGround && this.onWall && mag > 0.3 && this.vaultCd <= 0 && !this.blocking) {
      _a.copy(this.wallNormal).negate().setY(0);
      if (_a.lengthSq() > 0.01 && wish.dot(_a.normalize()) > 0.5) this._tryVault(_a);
    }

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 8) {
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.28; if (hs > RUN) g.audio?.play('land', { volume: 0.12, pitch: 1.1 }); }
    }
    if (busy) this.setAnim(this.actionAnim, hs);
    else if (this.holding && this.throwHold > CHARGE_MIN) this.setAnim('charge');
    else if (this.blocking) this.setAnim(hs > 0.5 ? 'run' : 'idle', hs * 0.5);
    else if (this.onGround) this.setAnim(hs > 0.5 ? (hs > RUN + 0.5 ? 'sprint' : 'run') : 'idle', hs);
    else this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', hs);
  }

  _tryVault(fw) {
    const g = this.game;
    const px = this.pos.x + fw.x * (this.radius + 0.6), pz = this.pos.z + fw.z * (this.radius + 0.6);
    const top = g.physics.heightAt(px, pz, this.pos.y + 1.5);
    const h = top - this.pos.y;
    if (h < 0.3 || h > 1.5) return;
    this.vaultCd = 0.5;
    this.vel.y = Math.sqrt(2 * GRAV * (h + 0.5));
    this.vel.x = fw.x * 7.5; this.vel.z = fw.z * 7.5;
    this.onGround = false; this.yaw = Math.atan2(fw.x, fw.z);
    g.audio?.play('whoosh', { volume: 0.4 });
    g.fx?.dust?.(this.pos.clone(), 5, 1.2);
    this.setAnim('jump');
  }

  onLand() {
    const g = this.game, vy = -this._impactVy;
    if (this.mode === 'ult' && this.ultPhase === 'slam') { this._ultImpact(); return; }
    if (vy > 14) { g.audio?.play('land', { volume: Math.min(0.8, vy / 30) }); g.fx?.dust?.(this.pos.clone(), 6, 1.6); }
    if (vy > 22) { this.actionAnim = 'land'; this.actionT = 0.2; this.vel.x *= 0.4; this.vel.z *= 0.4; }
  }

  // ---- dodge: combat roll ----------------------------------------------------------------------
  _dodge(input) {
    const g = this.game;
    this.useCooldown('dodge', 0.6);
    const w = g.cam.moveVector(input.move, _a);
    if (w.lengthSq() < 0.01) w.copy(this.forward);
    w.setY(0).normalize();
    this.moveDir.copy(w); this.yaw = Math.atan2(w.x, w.z);
    this.mode = 'roll'; this.modeT = 0; this.modeSpeed = 14.5;
    this.invuln = Math.max(this.invuln, 0.45);
    this.actionT = 0; this.bufferT = 0; this.chain = 0; this.holding = false; this.throwHold = 0;
    g.audio?.play('dodge');
  }
  _rollMove() {
    const k = Math.max(0.25, 1 - this.modeT / 0.45);
    this.vel.x = this.moveDir.x * this.modeSpeed * k; this.vel.z = this.moveDir.z * this.modeSpeed * k;
    this.setAnim('dodge', this.modeSpeed);
    if (this.modeT > 0.45) { this.mode = 'normal'; this.modeT = 0; }
  }

  // ---- melee combo: jab, hook, shield bash ---------------------------------------------------------
  _combo() {
    const g = this.game;
    const step = this.chain % 3;
    const t = this.findTarget(8, 80);
    if (t) { _a.subVectors(t.pos, this.pos).setY(0); if (_a.lengthSq() > 0.01) this.yaw = Math.atan2(_a.x, _a.z); }
    const fw = this.forward;
    this.vel.x += fw.x * (t ? 5.5 : 2.5); this.vel.z += fw.z * (t ? 5.5 : 2.5);
    const bash = step === 2 && !this.shieldOut;
    const anims = ['punch1', 'punch2', bash ? 'smash' : 'kick'];
    const dmg = [18, 20, bash ? 36 : 26], kn = [6, 7, bash ? 16 : 10], up = [1.5, 2, bash ? 5 : 3];
    const dur = [0.34, 0.36, 0.55], delay = [0.1, 0.1, 0.2];
    this.actionAnim = anims[step]; this.actionT = dur[step]; this.setAnim(anims[step]);
    this.chain++; this.chainT = 1.1;
    g.audio?.play('whoosh', { volume: 0.5, pitch: bash ? 0.8 : 1.1 });
    this.timers.after(delay[step], () => {
      if (!this.active || this.mode === 'ult') return;
      const fwd = this.forward;
      const hits = g.combat?.melee?.({ origin: this.center, forward: fwd, range: bash ? 3.2 : 2.7, arc: bash ? 120 : 100, damage: dmg[step] * this.dm(), knockback: kn[step], up: up[step], stun: bash ? 1.8 : 0.4, source: this, heavy: bash }) ?? [];
      if (bash) {
        const c = this.center.addScaledVector(fwd, 1.5);
        g.fx?.ring?.(c.clone().setY(this.pos.y + 0.2), 3, 0xcfe4ff, 0.35);
        g.fx?.burst?.(c, 0xcfe4ff, 14, 6, 0.35, 0.16);
        g.cam.shake(0.2);
      }
      if (hits.length) { g.audio?.play(bash ? 'smash' : step === 1 ? 'heavyhit' : 'punch', { volume: 0.7 }); impact(g, bash ? 0.8 : 0.15 + step * 0.15, bash); }
    });
  }

  // ---- special: SHIELD THROW -----------------------------------------------------------------------
  _throw(held) {
    const g = this.game;
    if (this.shieldOut) return;
    const charged = held >= CHARGE_MIN;
    const f = charged ? clamp((held - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1) : 0;
    this._handPos(_c);
    const from = _c.clone();
    const t = this.findTarget(34, charged ? 14 : 38);
    aimInfo(this, 60, _aim);
    const dir = t ? enemyCenter(t, _d).clone().sub(from) : _aim.point.clone().sub(from);
    if (dir.lengthSq() < 0.5) dir.copy(this.forward);
    dir.normalize();
    if (!t) dir.y = clamp(dir.y, -0.25, 0.3), dir.normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    const speed = charged ? THROW_SPEED_CHARGED : THROW_SPEED;
    const fl = this.fl = { phase: 'out', bounces: 0, maxB: charged ? 5 : 4, wall: 0, maxWall: charged ? 3 : 0, travelled: 0, range: charged ? THROW_RANGE_CHARGED : THROW_RANGE, speed, dmg: charged ? 34 + 22 * f : 30, mul: 1, target: null, t: 0, charged };
    const mesh = this.thrownMesh;
    mesh.visible = true; mesh.scale.setScalar(1.4);
    mesh.userData.tilt.rotation.x = 0;
    this._setHeld(false);
    this.shieldOut = true;
    this.actionAnim = 'throw'; this.actionT = 0.35; this.setAnim('throw');
    this.proj = g.combat?.projectile?.({
      pos: from, vel: dir.clone().multiplyScalar(speed), damage: fl.dmg * this.dm(), radius: 0.7, life: 9, kind: 'hammer', team: 'player', pierce: true, world: false,
      mesh, source: this, knockback: 7, up: 2.5, stun: 0.6, color: BLUE,
      update: (p, dt) => this._shieldUpdate(p, dt),
      onHit: (e, p) => this._shieldHit(e, p),
      onExpire: (p) => { if (this.proj === p) this._catch(false); },
    }) ?? null;
    if (!this.proj) { this.shieldOut = false; this._setHeld(true); return; }
    mesh.position.copy(from);
    g.audio?.play('throw', { volume: 0.9, pitch: charged ? 0.85 : 1.1 }); g.audio?.play('whoosh', { volume: 0.4 });
    g.cam.shake(charged ? 0.2 : 0.08); rumble(g, charged ? 0.6 : 0.3, 0.3, 100);
  }

  _nextTarget(p, from) {
    let best = null, bd = CHAIN_RANGE;
    for (const e of this.game.enemies?.list ?? []) {
      if (!e.alive || p.hits.has(e)) continue;
      const d = e.pos.distanceTo(from);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  _startReturn(p, keep = null) {
    const fl = this.fl; if (!fl) return;
    fl.phase = 'return'; fl.target = null; fl.mul = 0.7; fl.t = 0;
    p.hits.clear(); if (keep) p.hits.add(keep);
  }
  _shieldHit(e, p) {
    const g = this.game, fl = this.fl; if (!fl) return;
    g.audio?.play('heavyhit', { volume: 0.55, pitch: 1.35 });
    g.fx?.ring?.(p.pos.clone(), 1.8, 0xcfe4ff, 0.25);
    impact(g, fl.charged ? 0.45 : 0.25, fl.charged);
    if (fl.phase === 'return') return;
    fl.bounces++;
    if (fl.bounces >= fl.maxB) { this._startReturn(p, e); return; }
    const nx = this._nextTarget(p, p.pos);
    if (nx) {
      fl.phase = 'chain'; fl.target = nx;
      g.fx?.beam?.(p.pos.clone(), enemyCenter(nx, _w).clone(), 0x9fc8ff, 0.07, 0.15);
      g.audio?.play('clap', { volume: 0.3, pitch: 1.6 });
    } else this._startReturn(p, e);
  }
  _shieldUpdate(p, dt) {
    const g = this.game, fl = this.fl, mesh = p.mesh;
    if (!fl) return false;
    fl.t += dt;
    p.damage = fl.dmg * fl.mul * this.dm();
    // spin
    const sp = mesh.userData.spin; sp.rotation.y += 26 * dt;
    mesh.userData.tilt.rotation.z = Math.sin(fl.t * 9) * 0.18;

    if (fl.phase === 'return') {
      this._handPos(_c);
      _a.subVectors(_c, p.pos);
      const d = _a.length();
      fl.speed = Math.min(44, fl.speed + 40 * dt);
      if (d < 1.3 || fl.t > 6) { p.remove(); return true; }
      p.vel.copy(_a.multiplyScalar(1 / d)).multiplyScalar(Math.min(fl.speed, d / Math.max(dt, 1e-3)));
      g.fx?.trailPuff?.(p.pos.x, p.pos.y, p.pos.z, 0x9fc8ff, 0.35, 0.18, 0.02);
      return true;
    }
    fl.travelled += p.vel.length() * dt;
    // steering toward the chain target
    if (fl.phase === 'chain') {
      const t = fl.target;
      if (!t || !t.alive || p.hits.has(t)) {
        const nx = this._nextTarget(p, p.pos);
        if (nx) fl.target = nx; else { this._startReturn(p); return true; }
      }
      enemyCenter(fl.target, _a).sub(p.pos);
      if (_a.lengthSq() > 0.001) p.vel.copy(_a.normalize()).multiplyScalar(fl.speed);
    }
    // walls
    _d.subVectors(p.pos, p.prev);
    const len = _d.length();
    if (len > 1e-4) {
      _d.multiplyScalar(1 / len);
      const hit = g.physics.raycast(p.prev, _d, len + 0.45, { ignoreGround: true });
      if (hit && hit.distance <= len + 0.4) {
        g.fx?.burst?.(hit.point, 0xcfe4ff, 10, 5, 0.3, 0.14);
        g.fx?.sparks?.(hit.point, hit.normal, 0xffe0a0, 8, 8, 0.25, 0.08);
        g.audio?.play('clap', { volume: 0.6, pitch: 1.2 });
        if (fl.wall < fl.maxWall) {
          fl.wall++;
          _n.copy(hit.normal);
          const dn = p.vel.dot(_n);
          p.vel.addScaledVector(_n, -2 * dn);
          p.pos.copy(hit.point).addScaledVector(_n, 0.5);
          p.prev.copy(p.pos);
          mesh.position.copy(p.pos);
          // bank shot: head for the nearest un-hit enemy, else keep reflecting
          const nx = this._nextTarget(p, p.pos);
          if (nx) { fl.phase = 'chain'; fl.target = nx; }
          fl.travelled -= 6;
        } else {
          p.pos.copy(hit.point).addScaledVector(_n.copy(hit.normal), 0.5); p.prev.copy(p.pos); mesh.position.copy(p.pos);
          this._startReturn(p);
        }
      }
    }
    if (p.pos.y < 0.4) { p.pos.y = 0.4; if (p.vel.y < 0) p.vel.y *= -0.2; }
    if (fl.phase !== 'return' && fl.travelled > fl.range) this._startReturn(p);
    g.fx?.trailPuff?.(p.pos.x, p.pos.y, p.pos.z, 0xcfe4ff, 0.3, 0.15, 0.02);
    return true;
  }
  _dropProj() {
    const m = this.thrownMesh; if (m) { m.visible = false; m.parent?.remove(m); }
    this.proj = null; this.fl = null; this.shieldOut = false;
  }
  _catch(silent) {
    const g = this.game;
    this._dropProj();
    if (!this.blocking) this._setHeld(true);
    if (silent || !this.active) return;
    g.audio?.play('catch', { volume: 0.9 });
    g.fx?.ring?.(this._handPos(_c).clone(), 1.6, 0xcfe4ff, 0.3);
    g.fx?.burst?.(_c.clone(), 0xcfe4ff, 10, 4, 0.3, 0.14);
    rumble(g, 0.4, 0.4, 80);
    this.addFocus(2);
  }

  // ---- ability: Shield Charge ----------------------------------------------------------------------------
  _charge(input) {
    const g = this.game;
    this.useCooldown('charge', CHARGE_CD);
    const w = g.cam.moveVector(input.move, _a);
    const t = this.findTarget(16, 60);
    if (w.lengthSq() < 0.01) { if (t) w.subVectors(t.pos, this.pos); else w.copy(this.forward); }
    w.setY(0).normalize();
    this.moveDir.copy(w); this.yaw = Math.atan2(w.x, w.z);
    this.mode = 'charge'; this.modeT = 0; this.modeSpeed = CHARGE_DIST / CHARGE_TIME;
    this.chargeHit.clear(); this.holding = false; this.throwHold = 0; this.actionT = 0; this.bufferT = 0;
    this.invuln = Math.max(this.invuln, CHARGE_TIME + 0.1);
    this.blockMesh.scale.setScalar(1.6);
    g.audio?.play('roar', { volume: 0.35, pitch: 1.3 }); g.audio?.play('whoosh', { pitch: 0.8 }); g.cam.shake(0.2);
  }
  _chargeMove(dt) {
    const g = this.game;
    this.gravityScale = 1;
    this.vel.x = this.moveDir.x * this.modeSpeed; this.vel.z = this.moveDir.z * this.modeSpeed;
    this.setAnim('charge', this.modeSpeed);
    this.invuln = Math.max(this.invuln, 0.1);
    this.stepT -= dt;
    if (this.stepT <= 0) { this.stepT = 0.05; g.fx?.dust?.(this.pos.clone(), 3, 1.2); g.fx?.beam?.(this.center.addScaledVector(this.moveDir, -1.5), this.center, 0xcfe4ff, 0.2, 0.15); }
    for (const e of enemiesNear(g, this.pos, 3.0)) {
      if (this.chargeHit.has(e)) continue;
      _b.subVectors(e.pos, this.pos).setY(0);
      const d = _b.length(); if (d > 0.01) _b.divideScalar(d);
      if (d > 1.4 && _b.dot(this.moveDir) < 0.2) continue;
      this.chargeHit.add(e);
      _a.copy(this.moveDir).multiplyScalar(22).setY(7);
      hurt(g, this, e, 28 * this.dm(), { kb: _a.clone(), stun: 1.4, kind: 'charge', color: 0xcfe4ff });
      g.fx?.burst?.(e.center ?? e.pos, 0xcfe4ff, 10, 6, 0.3, 0.16);
      g.audio?.play('heavyhit'); impact(g, 0.65);
    }
    if (this.modeT >= CHARGE_TIME || (this.onWall && this.modeT > 0.08)) {
      this.mode = 'normal'; this.modeT = 0; this.vel.x *= 0.25; this.vel.z *= 0.25;
      g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 3, 0xcfe4ff, 0.3);
    }
  }

  // ---- ultimate: Avengers Assemble --------------------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this.focus = 0;
    if (this.proj) { this.proj.remove?.(); this._dropProj(); this._setHeld(true); }
    this.blocking = false; this.holding = false; this.actionT = 0; this.bufferT = 0;
    this.mode = 'ult'; this.modeT = 0; this.ultPhase = 'rise';
    this.invuln = 4; this.gravityScale = 0.5;
    this.vel.set(this.vel.x * 0.3, 15, this.vel.z * 0.3);
    this.setAnim('jump');
    g.audio?.play('roar', { volume: 0.6, pitch: 1.2 }); g.cam.shake(0.3);
    g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.2), 5, GOLD, 0.5);
    g.hud?.toast?.('AVENGERS ASSEMBLE!');
  }
  _ultMove(dt) {
    const g = this.game;
    this.invuln = Math.max(this.invuln, 0.2);
    if (this.ultPhase === 'rise') {
      this.gravityScale = 0.5;
      this.vel.x *= 0.96; this.vel.z *= 0.96;
      this.setAnim('jump');
      this.blockMesh.visible = true; this.blockMesh.scale.setScalar(1.6);
      this.blockMesh.position.set(this.pos.x, this.pos.y + this.height + 0.6, this.pos.z);
      this.blockMesh.rotation.set(0, this.yaw, 0);
      this.blockMesh.userData.tilt.rotation.x = 0;
      if (this.modeT > 0.42) { this.ultPhase = 'slam'; this.modeT = 0; this.gravityScale = 2.5; this.vel.set(0, -48, 0); this.blockMesh.userData.tilt.rotation.x = Math.PI / 2; g.audio?.play('whoosh', { pitch: 0.7 }); }
    } else {
      this.gravityScale = 2.5; this.setAnim('smash');
      this.vel.y = Math.min(this.vel.y, -48);
      this.blockMesh.position.set(this.pos.x, this.pos.y + 0.3, this.pos.z);
      this.blockMesh.userData.tilt.rotation.x = Math.PI / 2;
      if (this.modeT > 2.5) this._ultImpact();
    }
  }
  _ultImpact() {
    const g = this.game;
    this.mode = 'normal'; this.modeT = 0; this.gravityScale = 1; this.ultPhase = null;
    this.blockMesh.visible = false;
    const c = this.pos.clone();
    const hits = g.combat?.aoe?.({ center: c, radius: ULT_RADIUS, damage: ULT_DMG * this.dm(), knockback: 26, up: 15, stun: 2.2, source: this, falloff: true }) ?? [];
    impactFx(g, c, ULT_RADIUS, 0x4a8cff, 1.1);
    g.fx?.shockwave?.(c.clone(), ULT_RADIUS * 0.6, WHITE);
    g.fx?.flash?.(c.clone().setY(c.y + 1.5), 0xcfe4ff, 8, 0.35);
    const cols = [RED, WHITE, BLUE];
    cols.forEach((col, i) => this.timers.after(0.08 * (i + 1), () => g.fx?.ring?.(c.clone().setY(c.y + 0.1), ULT_RADIUS * (0.55 + i * 0.22), col, 0.8)));
    g.fx?.burst?.(c.clone().setY(c.y + 0.4), 0xcfe4ff, 60, 14, 1.0, 0.45);
    g.audio?.play('smash'); g.audio?.play('clap', { volume: 1 }); g.audio?.play('explosion', { volume: 0.5 }); rumble(g, 1, 1, 700);
    g.slowmo?.(0.4, 0.3);
    // rally buff for all heroes
    g.rallyUntil = g.time + RALLY_TIME;
    this.heal(30);
    g.hud?.toast?.('RALLY! +30% damage for 15s');
    this.timers.after(0.45, () => {
      if (!this.active) return;
      g.fx?.ring?.(this.pos.clone().setY(this.pos.y + 0.1), 6, GOLD, 1.0);
      g.fx?.burst?.(this.center, GOLD, 30, 8, 0.8, 0.25);
      g.audio?.play('roar', { volume: 0.4, pitch: 1.3 });
    });
    this.actionAnim = 'land'; this.actionT = 0.5; this.setAnim('land');
    this.vel.set(0, 0, 0);
    for (const h of hits) this.registerHit();
  }
}
