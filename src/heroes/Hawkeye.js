// Hawkeye: precision archer. Bow aiming (hold ability2), trick arrows (ability cycles), grapple arrow (swing),
// quick shot (special), bow-staff combo (attack), backflip-shot dodge, Arrow Storm ultimate.
//
//   R / L2        hold = draw + aim (over-the-shoulder), release or RMB/R1 = loose.  Charge raises speed + damage.
//   RMB / R1      quick shot (aim-assisted standard arrow) when not aiming
//   E / L1        cycle trick arrow (Explosive / Shock / Net / Cluster); used by the next AIMED shot (4 s recharge)
//   Shift / R2    grapple arrow to a ledge / wall in the aim direction and zip up
//   LMB / J       bow-staff combo (3 hits)      C / Ctrl  backflip + arrow at the nearest enemy
//   Q / R3        Arrow Storm
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { Timers, Cable, aimInfo, enemiesNear, objPos, rumble, clamp, damp, rand, makeArrow } from './mystic/util.js';

// ---- tuning ----------------------------------------------------------------
const PURPLE = 0xb88cff;
const TRICKS = [
  { id: 'explosive', label: 'Explosive', color: 0xff8a30 },
  { id: 'shock', label: 'Shock', color: 0x9fe8ff },
  { id: 'net', label: 'Net', color: 0xffffff },
  { id: 'cluster', label: 'Cluster', color: 0x7dff8a },
];
const TUNE = {
  drawTime: 0.85, aimWalk: 3.4, aimDist: 2.8, aimShoulder: 0.9, aimFov: -12,
  gravity: 9, shootCd: 0.35, trickCd: 4,
  quickSpeed: 75, quickDmg: 20, quickCd: 0.28, quickRange: 50,
  aimSpeed0: 55, aimSpeed1: 95, aimDmg0: 28, aimDmg1: 85,
  trickDmg0: 22, trickDmg1: 40,
  expRadius: 5, expDmg: 70,
  shockDmg: 24, shockStun: 2, chainDmg: 20, chainRange: 12, chainN: 3,
  netTime: 3, netRadius: 3.6,
  bombN: 5, bombDmg: 26, bombRadius: 3.2,
  grappleRange: 60, grappleCd: 1.2, zipSpeed: 52,
  combo: [{ dmg: 14, anim: 'punch1', kb: 1.5 }, { dmg: 17, anim: 'punch2', kb: 2.5 }, { dmg: 28, anim: 'kick', kb: 12 }],
  dodgeCd: 1.4, dodgeDmg: 30,
  ultN: 12, ultRange: 40, ultDmg: 55, ultRadius: 4.5, ultInterval: 0.07,
};

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Vector3(), _d = new THREE.Vector3();

export class Hawkeye extends Hero {
  constructor(game) {
    super(game, { id: 'hawkeye', name: 'Hawkeye', color: '#8a4fd1', maxHp: 150, walkSpeed: 6.5, runSpeed: 12.5, jumpSpeed: 10, gravity: 25, radius: 0.42, height: 1.85, airControl: 0.5, mass: 1 });
    this.timers = new Timers();
    this.cable = new Cable(game.scene);
    this.stuck = [];
    this.trick = 0;
    this.aiming = false; this.charge = 0; this._cam = null;
    this.chain = 0; this.chainT = 0; this.actionT = 0; this.actionAnim = 'idle';
    this.state = 'free';           // free | zip | flip | ult
    this.zipTarget = new THREE.Vector3(); this.zipHit = new THREE.Vector3(); this.zipN = new THREE.Vector3();
    this.zipKind = 'ledge'; this.zipT = 0; this.zipSpeed = 0; this.zipStuck = 0; this._zipLast = new THREE.Vector3();
    this.flipT = 0; this.ult = null;
    this.drawFx = 0;
  }

  onActivate() { this._reset(); }
  onDeactivate() {
    this._endAim();
    this._reset();
    for (const s of this.stuck) s.mesh.parent?.remove(s.mesh);
    this.stuck.length = 0;
  }
  _reset() {
    this.state = 'free'; this.ult = null; this.actionT = 0; this.chain = 0; this.gravityScale = 1; this.customMovement = false;
    this.cable.hide(); this.timers.clear();
  }

  get abilityHints() {
    const t = TRICKS[this.trick];
    return [
      { action: 'special', label: 'Quick Shot', cooldown: this.cooldownFrac('quick') },
      { action: 'ability', label: 'Arrow: ' + t.label, cooldown: this.cooldownFrac('trick') },
      { action: 'ability2', label: 'Draw Bow', cooldown: 0, active: this.aiming },
      { action: 'swing', label: 'Grapple Arrow', cooldown: this.cooldownFrac('grapple'), active: this.state === 'zip' },
      { action: 'ultimate', label: 'Arrow Storm', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  // ---- main update ----------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this._updateStuck(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.chain = 0; }

    if (this.ult) { this._ultUpdate(dt); return; }
    if (this.state === 'zip') { this._zipUpdate(dt, input); return; }
    if (this.state === 'flip') { this._flipUpdate(dt); return; }
    this.customMovement = false;

    const armed = !!g.weapons?.equipped;

    if (input.pressed('ultimate') && this.focus >= 100) { this._startUlt(); return; }
    if (input.pressed('ability')) this._cycleTrick();
    if (input.pressed('swing') && this._tryGrapple()) return;
    if (input.pressed('dodge') && this._tryDodge()) return;

    // bow aiming
    if (!armed && input.down('ability2') && this.actionT <= 0.05) {
      if (!this.aiming) this._beginAim();
      this._aimUpdate(dt, input);
      if (input.pressed('special') || input.released('ability2')) this._releaseAimed();
    } else if (this.aiming) {
      if (!input.down('ability2') && !armed) this._releaseAimed(); else this._endAim();
    } else if (!armed && input.pressed('special')) this._quickShot();

    if (!this.aiming && input.pressed('attack') && this.actionT <= 0.12) this._melee();
  }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    if (this.aiming) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > TUNE.aimWalk) { const k = TUNE.aimWalk / hs; this.vel.x *= k; this.vel.z *= k; }
      this.faceTowards(this.game.cam.forward, dt, 20);
      this.setAnim('shoot', hs);
    } else if (this.actionT > 0) this.setAnim(this.actionAnim, this.anim.speed);
  }

  // ---- helpers ----------------------------------------------------------------
  _muzzle(out) { return objPos(this.model.bow ?? this.model.handL, out, this.center); }
  _fx(name, ...a) { return this.game.fx?.[name]?.(...a); }

  _cycleTrick() {
    this.trick = (this.trick + 1) % TRICKS.length;
    const t = TRICKS[this.trick];
    this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.5), t.label.toUpperCase() + ' ARROW', t.color);
    this.game.audio?.play('switch', { volume: 0.4 });
  }

  // ---- aiming ----------------------------------------------------------------
  _beginAim() {
    this.aiming = true; this.charge = 0; this.drawFx = 0;
    this.game.hud?.setCrosshair?.('bow');
    this.game.audio?.play('whoosh', { volume: 0.25, pitch: 1.4 });
  }
  _endAim() {
    if (!this.aiming) return;
    this.aiming = false; this.charge = 0;
    this.game.hud?.setCrosshair?.(null);
  }
  _aimUpdate(dt, input) {
    this.game.cam.requestAim?.({ fov: 50 - 16 * this.charge, distance: TUNE.aimDist, shoulder: TUNE.aimShoulder, height: 1.6 });
    this.game.hud?.setCrosshair?.('bow');
    this.charge = Math.min(1, this.charge + dt / TUNE.drawTime);
    this.setAnim('shoot', 0);
    if (this.charge > 0.2) {
      this.drawFx -= dt;
      if (this.drawFx <= 0) { this.drawFx = 0.08; this._muzzle(_m); this._fx('glow', _m, PURPLE, 0.25 + this.charge * 0.5, 0.12); }
    }
    if (this.charge >= 1 && !this._full) { this._full = true; this._fx('ring', _a.copy(this._muzzle(_m)), 0.8, PURPLE, 0.25); rumble(this.game, 0.1, 0.3, 60); }
    if (this.charge < 1) this._full = false;
  }
  _releaseAimed() {
    const charge = this.charge;
    this._endAim();
    if (!this.useCooldown('shoot', TUNE.shootCd)) return;
    this._muzzle(_m);
    aimInfo(this, 140, _aim);
    _d.subVectors(_aim.point, _m);
    if (_d.length() < 3) _d.copy(_aim.dir);
    _d.normalize();
    const trick = this.cooldowns.trick > 0 ? null : TRICKS[this.trick];
    if (trick) this.useCooldown('trick', TUNE.trickCd);
    const speed = TUNE.aimSpeed0 + (TUNE.aimSpeed1 - TUNE.aimSpeed0) * charge;
    const dmg = trick ? TUNE.trickDmg0 + (TUNE.trickDmg1 - TUNE.trickDmg0) * charge : TUNE.aimDmg0 + (TUNE.aimDmg1 - TUNE.aimDmg0) * charge;
    this._shootArrow(_m, _d, { speed, dmg, trick: trick?.id, color: trick?.color ?? PURPLE, heavy: charge > 0.8 });
    this.actionT = 0.2; this.actionAnim = 'shoot';
    this.yaw = Math.atan2(_d.x, _d.z);
    this.game.cam.shake(0.08 + charge * 0.2);
    rumble(this.game, 0.2 + charge * 0.5, 0.2, 80 + charge * 80);
    this.vel.x -= _d.x * charge * 2; this.vel.z -= _d.z * charge * 2;   // bow recoil
  }

  _quickShot() {
    if (!this.useCooldown('quick', TUNE.quickCd)) return;
    this._muzzle(_m);
    const tgt = this.findTarget(TUNE.quickRange, 55);
    if (tgt) { _d.copy(tgt.center ?? tgt.pos).sub(_m); _d.y += 0.1; }
    else { aimInfo(this, 100, _aim); _d.subVectors(_aim.point, _m); if (_d.length() < 3) _d.copy(_aim.dir); }
    _d.normalize();
    this._shootArrow(_m, _d, { speed: TUNE.quickSpeed, dmg: TUNE.quickDmg, color: PURPLE });
    this.yaw = Math.atan2(_d.x, _d.z);
    this.actionT = 0.22; this.actionAnim = 'shoot';
    this.setAnim('shoot', 0);
  }

  // ---- arrows ----------------------------------------------------------------
  _shootArrow(from, dir, o = {}) {
    const g = this.game;
    const mesh = makeArrow(o.color ?? PURPLE);
    const proj = g.combat.projectile({
      kind: 'repulsor', pos: from, vel: _c.copy(dir).multiplyScalar(o.speed ?? 70), damage: o.dmg ?? 20, radius: 0.18, life: o.life ?? 2.6,
      gravity: o.gravity ?? TUNE.gravity, color: o.color ?? PURPLE, mesh, source: this, knockback: 4, up: 1.2,
      stun: o.trick === 'shock' ? TUNE.shockStun : 0.3, heavy: !!o.heavy, homing: o.homing ?? null, turn: o.turn ?? 3.5,
      user: { trick: o.trick, hit: null, boom: o.boom },
      onHit: (e, p) => {
        p.user.hit = e;
        const head = p.pos.y > e.pos.y + e.height * 0.82;
        g.hud?.hitMarker?.(head);
        if (head) {
          e.takeDamage?.(p.damage, { source: this, kind: 'arrow', stun: 0.3 });
          g.fx?.text?.(_a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'HEADSHOT', 0xffd24a, { size: 1.5 });
          g.slowmo?.(0.05, 0.05); g.cam.shake(0.2); rumble(g, 0.5, 0.5, 100);
        }
      },
      onExpire: (p) => this._arrowEnd(p),
    });
    proj.user.trail = g.fx?.trail?.(mesh, o.color ?? PURPLE, o.homing ? 0.18 : 0.12, 0.35);
    mesh.quaternion.setFromUnitVectors(_b.set(0, 0, 1), dir);
    g.audio?.play('throw', { volume: 0.5, pitch: 1.6 });
    return proj;
  }

  _arrowEnd(p) {
    const g = this.game, u = p.user;
    u.trail?.stop?.();
    const mesh = p.mesh;
    const pos = _a.copy(p.pos);
    const hit = u.hit;
    const worldHit = !hit && p.life > 0;
    // detonations
    if (u.boom) {
      g.combat.explode(pos.clone(), TUNE.ultRadius, TUNE.ultDmg, { source: this, color: 0xff8a30 });
    } else switch (u.trick) {
      case 'explosive':
        g.combat.explode(pos.clone(), TUNE.expRadius, TUNE.expDmg, { source: this, color: 0xff8a30 });
        break;
      case 'shock': this._shock(pos, hit); break;
      case 'net': this._net(pos, hit); break;
      case 'cluster': this._cluster(pos); break;
      default: break;
    }
    // stick standard / dud arrows into walls briefly
    if (worldHit && !u.boom && (!u.trick || u.trick === 'net')) {
      _d.copy(p.vel).normalize();
      mesh.position.copy(pos).addScaledVector(_d, -0.35);
      this.stuck.push({ mesh, t: 3.5 });
      this._fx('sparks', pos.clone(), _d.clone().negate(), PURPLE, 6, 5, 0.25, 0.08);
    } else mesh.parent?.remove(mesh);
  }

  _updateStuck(dt) {
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i]; s.t -= dt;
      if (s.t <= 0) { s.mesh.parent?.remove(s.mesh); this.stuck.splice(i, 1); }
    }
  }

  _shock(pos, hit) {
    const g = this.game;
    const col = 0x9fe8ff;
    this._fx('flash', pos.clone(), col, 4, 0.2);
    this._fx('burst', pos.clone(), col, 16, 6, 0.4, 0.2);
    g.audio?.play('lightning', { volume: 0.7 });
    let prev = pos.clone();
    const used = new Set();
    let first = hit;
    if (!first) { const near = enemiesNear(g, pos, 6); first = near[0] || null; if (first) first.takeDamage?.(TUNE.shockDmg, { stun: TUNE.shockStun, source: this, kind: 'shock' }); }
    if (first) used.add(first);
    let cur = first;
    if (cur) { this._zapFx(prev, cur); prev = (cur.center ?? cur.pos).clone(); }
    for (let i = 0; i < TUNE.chainN; i++) {
      const cand = enemiesNear(g, prev, TUNE.chainRange).filter((e) => !used.has(e))[0];
      if (!cand) break;
      used.add(cand);
      this._zapFx(prev, cand);
      cand.takeDamage?.(TUNE.chainDmg, { stun: TUNE.shockStun, source: this, kind: 'shock', knockback: _b.set(0, 3, 0) });
      this.registerHit();
      prev = (cand.center ?? cand.pos).clone();
    }
  }
  _zapFx(a, e) {
    const c = e.center ?? e.pos;
    this._fx('lightning', a.clone(), c.clone(), 0x9fe8ff, 0.35, 3);
    this._fx('burst', c.clone(), 0x9fe8ff, 8, 4, 0.3, 0.15);
  }

  _net(pos, hit) {
    const g = this.game;
    const list = enemiesNear(g, pos, TUNE.netRadius);
    if (hit && !list.includes(hit)) list.push(hit);
    for (const e of list) e.web?.(TUNE.netTime);
    this._fx('ring', pos.clone(), TUNE.netRadius, 0xffffff, 0.35);
    this._fx('burst', pos.clone(), 0xffffff, 18, 5, 0.5, 0.18);
  }

  _cluster(pos) {
    const g = this.game;
    this._fx('burst', pos.clone(), 0x7dff8a, 14, 5, 0.4, 0.2);
    for (let i = 0; i < TUNE.bombN; i++) {
      const a = (i / TUNE.bombN) * Math.PI * 2 + rand(0, 0.5);
      const v = new THREE.Vector3(Math.cos(a) * rand(4, 7), rand(5, 8), Math.sin(a) * rand(4, 7));
      g.combat.projectile({
        kind: 'repulsor', pos: pos.clone().setY(pos.y + 0.3), vel: v, damage: 0, radius: 0.15, life: 0.75, gravity: 22, color: 0x7dff8a, size: 0.22, source: this,
        onExpire: (p) => { g.combat.explode(p.pos.clone(), TUNE.bombRadius, TUNE.bombDmg, { source: this, color: 0x9dff6a, knockback: 10, up: 5 }); },
        user: {},
      });
    }
  }

  // ---- melee ----------------------------------------------------------------
  _melee() {
    const step = TUNE.combo[this.chain % 3];
    const near = this.game.enemies?.nearest?.(this.pos, 4);
    if (near) { _d.subVectors(near.pos, this.pos).setY(0); if (_d.lengthSq() > 0.01) this.yaw = Math.atan2(_d.x, _d.z); }
    else { const f = this.game.cam.forward; if (this.input_moving()) this.yaw = Math.atan2(f.x, f.z); }
    this.setAnim(step.anim, 1); this.actionAnim = step.anim; this.actionT = 0.34;
    const fwd = this.forward;
    if (this.onGround) { this.vel.x += fwd.x * 5; this.vel.z += fwd.z * 5; }
    this.game.combat.melee({ origin: this.center, forward: fwd, range: 2.8, arc: 130, damage: step.dmg, knockback: step.kb, up: this.chain % 3 === 2 ? 5 : 2, stun: 0.35, source: this, heavy: this.chain % 3 === 2 });
    this.game.audio?.play(this.chain % 3 === 2 ? 'kick' : 'punch', { volume: 0.6 });
    this.chain = (this.chain + 1) % 3; this.chainT = 1;
  }
  input_moving() { return this.game.input.move.lengthSq() > 0.05; }

  // ---- dodge: backflip + shot ----------------------------------------------------------------
  _tryDodge() {
    if (!this.useCooldown('dodge', TUNE.dodgeCd)) return false;
    const g = this.game;
    const tgt = g.enemies?.nearest?.(this.pos, 45);
    if (tgt) { _d.subVectors(tgt.pos, this.pos).setY(0); if (_d.lengthSq() > 0.01) this.yaw = Math.atan2(_d.x, _d.z); }
    else { const f = g.cam.forward; this.yaw = Math.atan2(f.x, f.z); }
    const fwd = this.forward;
    this.vel.set(-fwd.x * 11, this.onGround ? 8 : Math.max(this.vel.y, 4), -fwd.z * 11);
    this.onGround = false;
    this.state = 'flip'; this.flipT = 0; this.invuln = Math.max(this.invuln, 0.45);
    this.setAnim('dodge', 1);
    g.audio?.play('dodge');
    this.timers.after(0.2, () => {
      if (!this.active) return;
      this._muzzle(_m);
      const t = tgt && tgt.alive ? tgt : g.enemies?.nearest?.(this.pos, 45);
      if (t) _d.copy(t.center ?? t.pos).sub(_m);
      else { _d.copy(this.forward); }
      _d.normalize();
      this._shootArrow(_m, _d, { speed: 80, dmg: TUNE.dodgeDmg, color: PURPLE });
    });
    return true;
  }
  _flipUpdate(dt) {
    this.flipT += dt; this.customMovement = true; this.gravityScale = 1;
    this.vel.x = damp(this.vel.x, 0, 1.5, dt); this.vel.z = damp(this.vel.z, 0, 1.5, dt);
    this.setAnim('dodge', 1);
    if (this.flipT > 0.65 || (this.onGround && this.flipT > 0.2)) { this.state = 'free'; this.customMovement = false; }
  }

  // ---- grapple arrow ----------------------------------------------------------------
  _tryGrapple() {
    if ((this.cooldowns.grapple || 0) > 0) return false;
    const g = this.game;
    aimInfo(this, TUNE.grappleRange, _aim);
    const hit = _aim.hit;
    if (!hit) return false;
    const c = this.center;
    const dist = hit.point.distanceTo(c);
    if (dist > TUNE.grappleRange || dist < 3) return false;
    const nrm = hit.normal;
    this.zipHit.copy(hit.point);
    if (Math.abs(nrm.y) < 0.5 && hit.box) {
      const top = hit.box.max.y;
      if (top - hit.point.y < 12 && hit.box.data?.type !== 'prop') {
        this.zipKind = 'ledge';
        this.zipTarget.set(hit.point.x - nrm.x * 1.1, top + 0.1, hit.point.z - nrm.z * 1.1);
        this.zipN.copy(nrm).setY(0).normalize();
        this.zipHit.set(hit.point.x, top, hit.point.z);
      } else {
        this.zipKind = 'wall';
        this.zipTarget.copy(hit.point).addScaledVector(nrm, this.radius + 0.3); this.zipTarget.y -= 0.9;
        this.zipN.copy(nrm).setY(0).normalize();
      }
    } else if (nrm.y >= 0.5) { this.zipKind = 'ground'; this.zipTarget.copy(hit.point).y += 0.05; }
    else return false;
    this._endAim();
    this.useCooldown('grapple', TUNE.grappleCd);
    this.state = 'zip'; this.zipT = 0; this.zipSpeed = Math.max(18, this.vel.length() * 0.7); this.zipStuck = 0; this._zipLast.copy(this.pos);
    this.setAnim('zip', 20);
    // arrow stuck at the anchor
    const m = makeArrow(PURPLE);
    m.position.copy(this.zipHit).addScaledVector(nrm, 0.1);
    m.quaternion.setFromUnitVectors(_b.set(0, 0, 1), _c.copy(nrm).negate());
    g.scene.add(m); this.stuck.push({ mesh: m, t: 2.5 });
    g.audio?.play('zip'); g.audio?.play('throw', { volume: 0.5 });
    rumble(g, 0.3, 0.2, 80);
    this._fx('burst', this.zipHit.clone(), PURPLE, 10, 4, 0.3, 0.15);
    return true;
  }
  _zipUpdate(dt, input) {
    this.customMovement = true; this.gravityScale = 0; this.zipT += dt;
    this._muzzle(_m);
    this.cable.set(_m, this.zipHit);
    if (input.pressed('jump')) { this.vel.y = Math.max(this.vel.y, 0) + 8; this._zipEnd(false); return; }
    const to = _a.copy(this.zipTarget).sub(this.pos); const dist = to.length();
    if (dist < 1.1 || this.zipT > 1.7) { this._zipEnd(true); return; }
    this.zipSpeed = approach(this.zipSpeed, TUNE.zipSpeed, 160 * dt);
    const sp = Math.min(this.zipSpeed, Math.max(6, dist / Math.max(dt, 1e-3) * 0.9));
    to.multiplyScalar(1 / dist);
    this.vel.copy(to).multiplyScalar(sp);
    if (Math.hypot(this.vel.x, this.vel.z) > 1) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    if (this.zipT > 0.3) {
      this.zipStuck += this.pos.distanceTo(this._zipLast) < sp * dt * 0.25 ? dt : -dt * 2;
      if (this.zipStuck > 0.25) { this._zipEnd(true); return; }
    }
    this._zipLast.copy(this.pos);
    this.setAnim('zip', sp);
  }
  _zipEnd(done) {
    this.cable.hide();
    this.state = 'free'; this.customMovement = false; this.gravityScale = 1;
    if (!done) return;
    if (this.zipKind === 'ledge') {
      this.vel.set(-this.zipN.x * 3, 2, -this.zipN.z * 3);
      this.yaw = Math.atan2(-this.zipN.x, -this.zipN.z);
      this.game.audio?.play('land', { volume: 0.5 });
    } else { const sp = this.vel.length(); if (sp > 16) this.vel.multiplyScalar(16 / sp); }
  }

  // ---- ultimate: Arrow Storm ----------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this._endAim();
    this.focus = 0;
    this.ult = { phase: 'leap', t: 0, n: 0, next: 0, targets: [] };
    this.invuln = Math.max(this.invuln, 4);
    this.state = 'free'; this.customMovement = true;
    this.vel.set(0, 17, 0); this.onGround = false;
    g.slowmo?.(2.4, 0.4);
    g.hud?.toast?.('ARROW STORM');
    g.audio?.play('whoosh'); g.audio?.play('thunder', { volume: 0.3 });
    this._fx('ring', _a.copy(this.pos).setY(this.pos.y + 0.1), 5, PURPLE, 0.5);
    this.setAnim('jump', 1);
  }
  _ultUpdate(dt) {
    const g = this.game, u = this.ult;
    u.t += dt; this.customMovement = true;
    this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt);
    if (u.phase === 'leap') {
      this.gravityScale = 0.6; this.setAnim('jump', 1);
      if (u.t > 0.4 || this.vel.y < 2) {
        u.phase = 'volley'; u.t = 0;
        u.targets = enemiesNear(g, this.pos, TUNE.ultRange).slice(0, TUNE.ultN);
      }
    } else {
      this.gravityScale = 0; this.vel.y = damp(this.vel.y, 0, 8, dt);
      this.setAnim('shoot', 0); this.yaw += dt * 4;
      u.next -= dt;
      while (u.next <= 0 && u.n < TUNE.ultN) {
        u.next += TUNE.ultInterval;
        this._ultArrow(u, u.n++);
      }
      if (u.n >= TUNE.ultN && u.t > TUNE.ultN * TUNE.ultInterval + 0.35) {
        this.ult = null; this.gravityScale = 1; this.customMovement = false; this.invuln = Math.max(this.invuln, 1);
      }
    }
  }
  _ultArrow(u, i) {
    this._muzzle(_m);
    _m.y += 0.4;
    const tgt = u.targets.length ? u.targets[i % u.targets.length] : null;
    const a = (i / TUNE.ultN) * Math.PI * 2;
    if (tgt && tgt.alive) _d.set(Math.cos(a) * 0.8, 1.2, Math.sin(a) * 0.8);
    else { const f = this.forward; _d.set(f.x * 0.9 + Math.cos(a) * 0.5, -0.5, f.z * 0.9 + Math.sin(a) * 0.5); }
    _d.normalize();
    this._shootArrow(_m, _d, {
      speed: 34, dmg: 15, color: 0xff8a30, boom: true, life: 3, gravity: 0,
      homing: tgt && tgt.alive ? tgt : null, turn: 6,
    });
    this._fx('burst', _m.clone(), 0xff8a30, 5, 3, 0.25, 0.15);
    this.game.audio?.play('throw', { volume: 0.35, pitch: 1.2 + i * 0.03 });
    this.game.cam.shake(0.05);
  }

  updateVisuals(dt) {
    if (this.state === 'zip') this.setAnim('zip', 20);
  }
}
