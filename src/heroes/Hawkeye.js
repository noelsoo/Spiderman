// Hawkeye: precision archer. Bow aiming, 11 trick arrows with a quick-select, multi-nock, ricochet, focus-aim marks,
// grapple + cable zipline, parkour roll / vault, bow-staff combo, backflip-shot dodge, Arrow Storm ultimate.
//
//   RMB / L2 hold   draw + aim (zoom deepens with draw); LMB / R2 (or releasing a full draw) looses; quick tap RMB / R1 = quick shot
//   AIRBORNE aim    FOCUS AIM: time slows, floaty fall; crosshair over enemies MARKS them (up to 5); loose = homing volley at every mark
//   while aiming    K / R1 or J / square = MULTI-NOCK (3-arrow fan, 5 at full draw, locks on to targets)
//   E / L1          TAP = next trick arrow (double-tap = previous)   HOLD (0.28 s) = fire the selected trick arrow straight away
//                   (aimed shots also use the selected trick when it is ready)
//                   Tricks: Explosive, Shock, Net/Bola, Cluster, EMP (stuns drones + robots), Cryo (freeze), Smoke, Sonic,
//                   Pym (giant), Cable (zipline / yank), Ricochet (bounces to 3 more enemies)
//   Shift / R2      grapple arrow to a ledge / wall in the aim direction and zip up
//   LMB / J         bow-staff combo (4 hits, last = point-blank shot)
//   C / Ctrl        moving: parkour ROLL (or VAULT over low cover); standing still: backflip + arrow;  hard landings auto-roll
//   Q / R3          Arrow Storm
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { Timers, Cable, aimInfo, enemiesNear, objPos, rumble, clamp, damp, rand, makeArrow } from './mystic/util.js';
import { StatusFx, MarkPool, stunEnemy, isMachine } from './hawkeye/status.js';

// ---- tuning ----------------------------------------------------------------
const PURPLE = 0xb88cff;
const TRICKS = [
  { id: 'explosive', label: 'Explosive', color: 0xff8a30, cd: 4 },
  { id: 'shock', label: 'Shock', color: 0x9fe8ff, cd: 4 },
  { id: 'net', label: 'Net / Bola', color: 0xffffff, cd: 4.5 },
  { id: 'cluster', label: 'Cluster', color: 0x7dff8a, cd: 5 },
  { id: 'emp', label: 'EMP', color: 0x55b8ff, cd: 6 },
  { id: 'cryo', label: 'Cryo', color: 0xaee8ff, cd: 6 },
  { id: 'smoke', label: 'Smoke', color: 0xb0b6c0, cd: 7 },
  { id: 'sonic', label: 'Sonic', color: 0xffe08a, cd: 6 },
  { id: 'giant', label: 'Pym Giant', color: 0xff4a4a, cd: 9 },
  { id: 'cable', label: 'Cable Line', color: 0xffd24a, cd: 5 },
  { id: 'ricochet', label: 'Ricochet', color: 0xff66d8, cd: 5 },
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
  holdTrick: 0.28, tapDouble: 0.3,
  empR: 7, empDmg: 12, empMachineDmg: 40, empStun: 3.6,
  cryoR: 4.2, cryoTime: 3.6, cryoDmg: 8, cryoMul: 1.35,
  smokeR: 5.5, smokeTime: 6, smokeReduce: 0.5,
  sonicR: 9, sonicDmg: 14, sonicStun: 1.8,
  giantDmg: 38, giantR: 6, giantBoom: 50,
  ricN: 3, ricRange: 24, ricDmg: [30, 26, 22, 18],
  cableRange: 120, lineSpeed: 46, lineCd: 1.5,
  nockDmg: 0.62, nockCd: 1.1,
  focusScale: 0.32, focusBudget: 2.6, markMax: 5, volleyDmg: 42,
  rollSpeed: 14, rollTime: 0.46, vaultMax: 2.0, parkourCd: 0.8,
  ultN: 12, ultRange: 40, ultDmg: 55, ultRadius: 4.5, ultInterval: 0.07,
};

const _aim = { dir: new THREE.Vector3(), point: new THREE.Vector3() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Vector3(), _d = new THREE.Vector3();

export class Hawkeye extends Hero {
  constructor(game) {
    super(game, { id: 'hawkeye', name: 'Hawkeye', color: '#8a4fd1', maxHp: 150, walkSpeed: 6.5, runSpeed: 12.5, jumpSpeed: 10, gravity: 25, radius: 0.42, height: 1.85, airControl: 0.5, mass: 1, usesAim: true, aimPreset: { fov: 50, distance: TUNE.aimDist, shoulder: TUNE.aimShoulder, height: 1.6 } });
    this.timers = new Timers();
    this.cable = new Cable(game.scene);
    this.stuck = [];
    this.trick = 0;
    this.charge = 0; this._wasAiming = false;
    this.chain = 0; this.chainT = 0; this.actionT = 0; this.actionAnim = 'idle';
    this.state = 'free';           // free | zip | flip | ult
    this.zipTarget = new THREE.Vector3(); this.zipHit = new THREE.Vector3(); this.zipN = new THREE.Vector3();
    this.zipKind = 'ledge'; this.zipT = 0; this.zipSpeed = 0; this.zipStuck = 0; this._zipLast = new THREE.Vector3();
    this.flipT = 0; this.ult = null;
    this.drawFx = 0;
    this.status = new StatusFx(game.scene, game.fx);
    this.marks = new MarkPool(game.scene);
    this.lineCable = new Cable(game.scene, 0xffd24a, 0.025); this.lineT = 0; this.lineA = new THREE.Vector3(); this.lineHit = new Set(); this.lineTick = 0;
    this._abT = 0; this._abFired = false; this._tapT = 99;
    this.smokes = [];
    this.focusing = false; this.focusLeft = TUNE.focusBudget; this._markT = 0;
    this.moveT = 0; this.moveKind = 'roll'; this.moveDir = new THREE.Vector3(0, 0, 1); this.moveHit = new Set();
    this._impactVy = 0;
  }

  onActivate() { this._reset(); }
  onDeactivate() {
    this._endAim();
    this._reset();
    for (const s of this.stuck) s.mesh.parent?.remove(s.mesh);
    this.stuck.length = 0;
    this.status.clear(); this.marks.clear(); this.lineCable.hide(); this.smokes.length = 0;
    this.game.timeScale = this.game._slowmo > 0 ? this.game.timeScale : 1;
  }
  _reset() {
    this.focusLeft = TUNE.focusBudget; this.status?.clear(); this.marks?.clear(); this.state = 'free'; this.ult = null; this.actionT = 0; this.chain = 0; this.gravityScale = 1; this.customMovement = false;
    this.cable.hide(); this.timers.clear(); this.focusing = false; this.moveT = 0; this._abT = 0; this._abFired = false;
  }

  get abilityHints() {
    const t = TRICKS[this.trick];
    const bow = this.aiming ? 'Triple Shot (K / R1)' : !this.onGround && !this.armedBlock ? 'Bow (air hold: Focus)' : 'Draw Bow (hold)';
    return [
      { action: 'ability', label: t.label + ' (tap: next, hold: fire)', cooldown: this.cooldownFrac('trick') },
      { action: 'special', label: bow, cooldown: this.aiming ? this.cooldownFrac('nock') : 0, active: this.aiming || this.focusing },
      { action: 'swing', label: 'Grapple Arrow', cooldown: this.cooldownFrac('grapple'), active: this.state === 'zip' },
      { action: 'dodge', label: this.input_moving() ? 'Roll / Vault' : 'Backflip Shot', cooldown: Math.max(this.cooldownFrac('dodge'), this.cooldownFrac('parkour')), active: this.state === 'flip' || this.state === 'roll' || this.state === 'vault' },
      { action: 'ultimate', label: 'Arrow Storm', cooldown: 1 - this.focus / 100, active: !!this.ult },
    ];
  }

  takeDamage(amount, fromPos) {
    // standing in your own smoke cloud halves incoming damage
    for (const sm of this.smokes) if (this.pos.distanceTo(sm.pos) < sm.r) { amount *= TUNE.smokeReduce; break; }
    return super.takeDamage(amount, fromPos);
  }

  // ---- main update ----------------------------------------------------------------
  updateAbilities(dt, input) {
    const g = this.game;
    this.timers.update(dt);
    this._updateStuck(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.chain = 0; }

    this._impactVy = this.vel.y;
    if (this.ult) { this._ultUpdate(dt); return; }
    if (this.state === 'zip') { this._zipUpdate(dt, input); return; }
    if (this.state === 'flip') { this._flipUpdate(dt); return; }
    if (this.state === 'roll' || this.state === 'vault') { this._moveUpdate(dt); return; }
    this.customMovement = false;

    const armed = !!g.weapons?.equipped;

    if (input.pressed('ultimate') && this.focus >= 100) { this._startUlt(); return; }
    this._trickInput(dt, input);
    if (input.pressed('swing') && this._tryGrapple()) return;
    if (input.pressed('dodge') && (this._tryParkour() || this._tryDodge())) return;

    // bow: hold aim (RMB / L2) to draw, fire (LMB / R2) or release a full draw to loose; tap aim = quick shot
    if (!armed) {
      if (this.aiming) {
        if (!this._wasAiming) this._beginAim();
        this._aimUpdate(dt, input);
        this._focusUpdate(dt);
        if (input.pressed('special') || input.pressed('attack')) this._multiNock();
        else if (this.firePressed()) this._releaseAimed();
      } else {
        if (this._wasAiming) { if (this.charge > 0.6 || this.marks.count) this._releaseAimed(); this._endAim(); }
        this._focusOff(dt);
        if (this.pressedSpecial() || this.pressedAbility2()) this._quickShot();
      }
    } else { if (this._wasAiming) this._endAim(); this._focusOff(dt); }
    this._wasAiming = this.aiming;

    if (!this.aiming && input.pressed('attack') && this.actionT <= 0.12) this._melee();
  }

  get armedBlock() { return !!this.game.weapons?.equipped; }

  defaultMovement(dt, input) {
    super.defaultMovement(dt, input);
    this.gravityScale = this.focusing ? 0.3 : 1;
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

  _cycleTrick(dir = 1) {
    this.trick = (this.trick + dir + TRICKS.length) % TRICKS.length;
    const t = TRICKS[this.trick];
    this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.5), t.label.toUpperCase() + ' ARROW', t.color);
    this._muzzle(_m); this._fx('glow', _m, t.color, 0.9, 0.2); this._fx('ring', _a.copy(_m), 0.7, t.color, 0.2);
    this.game.audio?.play('switch', { volume: 0.4, pitch: 0.9 + (this.trick / TRICKS.length) * 0.8 });
  }

  // E / L1: tap = next trick, double-tap = previous, hold = fire the selected trick at the crosshair
  _trickInput(dt, input) {
    this._tapT += dt;
    if (input.pressed('ability')) { this._abT = 0; this._abFired = false; }
    if (input.down('ability')) {
      this._abT += dt;
      if (this._abT > 0.08 && !this._abFired) {          // charging glow in the trick colour
        this.drawFx -= dt;
        if (this.drawFx <= 0) { this.drawFx = 0.06; this._muzzle(_m); this._fx('glow', _m, TRICKS[this.trick].color, 0.3 + (this._abT / TUNE.holdTrick) * 0.7, 0.1); }
      }
      if (!this._abFired && this._abT >= TUNE.holdTrick) { this._abFired = true; this._fireTrick(); }
    }
    if (input.released('ability') && !this._abFired && this._abT < TUNE.holdTrick) {
      if (this._tapT < TUNE.tapDouble) this._cycleTrick(-2); else this._cycleTrick(1);   // double-tap nets one step back
      this._tapT = 0;
    }
  }

  _fireTrick() {
    const t = TRICKS[this.trick];
    if ((this.cooldowns.trick || 0) > 0) { this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.5), 'RECHARGING', 0x888888); return; }
    this.useCooldown('trick', t.cd);
    this._muzzle(_m);
    aimInfo(this, 140, _aim);
    _d.subVectors(_aim.point, _m);
    if (_d.length() < 3) _d.copy(_aim.dir);
    _d.normalize();
    this._shootTrick(t, _m, _d, 0.55);
    this.yaw = Math.atan2(_d.x, _d.z);
    this.actionT = 0.25; this.actionAnim = 'shoot'; this.setAnim('shoot', 0);
    this.game.cam.shake(0.1); rumble(this.game, 0.3, 0.2, 70);
  }

  _shootTrick(t, from, dir, charge) {
    const speed = TUNE.aimSpeed0 + (TUNE.aimSpeed1 - TUNE.aimSpeed0) * charge;
    const dmg = TUNE.trickDmg0 + (TUNE.trickDmg1 - TUNE.trickDmg0) * charge;
    const o = { speed, dmg, trick: t.id, color: t.color, heavy: charge > 0.8 };
    if (t.id === 'giant') { o.speed = 48; o.dmg = TUNE.giantDmg; o.scale = 4.5; o.pierce = true; o.gravity = 3; o.radius = 0.85; o.life = 2.2; }
    if (t.id === 'cable') { o.speed = 95; o.gravity = 2; o.life = TUNE.cableRange / 90 + 0.2; o.dmg = 16; }
    if (t.id === 'ricochet') { o.speed = 90; o.gravity = 4; }
    return this._shootArrow(from, dir, o);
  }

  // ---- aiming ----------------------------------------------------------------
  _beginAim() {
    this.charge = 0; this.drawFx = 0;
    this.game.hud?.setCrosshair?.('bow');
    this.game.audio?.play('whoosh', { volume: 0.25, pitch: 1.4 });
  }
  _endAim() {
    this.charge = 0;
    this.game.hud?.setCrosshair?.(null);
  }
  _aimUpdate(dt, input) {
    this.game.cam.requestAim?.({ fov: 50 - 16 * this.charge, distance: TUNE.aimDist, shoulder: TUNE.aimShoulder, height: 1.6 });
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
    this.charge = 0; this._full = false;
    if (!this.useCooldown('shoot', TUNE.shootCd)) return;
    this._muzzle(_m);
    aimInfo(this, 140, _aim);
    _d.subVectors(_aim.point, _m);
    if (_d.length() < 3) _d.copy(_aim.dir);
    _d.normalize();
    // focus-aim volley: every marked enemy eats a homing arrow
    if (this.marks.count) { this._volley(); this.actionT = 0.3; this.actionAnim = 'shoot'; return; }
    const trick = this.cooldowns.trick > 0 ? null : TRICKS[this.trick];
    if (trick) this.useCooldown('trick', trick.cd);
    const speed = TUNE.aimSpeed0 + (TUNE.aimSpeed1 - TUNE.aimSpeed0) * charge;
    const dmg = TUNE.aimDmg0 + (TUNE.aimDmg1 - TUNE.aimDmg0) * charge;
    if (trick) this._shootTrick(trick, _m, _d, charge);
    else this._shootArrow(_m, _d, { speed, dmg, color: PURPLE, heavy: charge > 0.8 });
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
    const mesh = makeArrow(o.color ?? PURPLE, o.scale ?? 1);
    const proj = g.combat.projectile({
      kind: 'repulsor', pos: from, vel: _c.copy(dir).multiplyScalar(o.speed ?? 70), damage: o.dmg ?? 20, radius: o.radius ?? 0.18, life: o.life ?? 2.6, pierce: !!o.pierce,
      gravity: o.gravity ?? TUNE.gravity, color: o.color ?? PURPLE, mesh, source: this, knockback: 4, up: 1.2,
      stun: o.trick === 'shock' ? TUNE.shockStun : 0.3, heavy: !!o.heavy, homing: o.homing ?? null, turn: o.turn ?? 3.5,
      user: { trick: o.trick, hit: null, boom: o.boom, ric: o.trick === 'ricochet' ? new Set() : null, cableOrigin: o.trick === 'cable' ? from.clone() : null },
      onHit: (e, p) => {
        p.user.hit = e;
        if (p.user.trick === 'giant') { this._fx('shockwave', e.pos.clone(), 0xff4a4a, 3); this._fx('burst', e.center ?? e.pos, 0xff4a4a, 12, 6, 0.4, 0.25); e.launch?.({}); }
        if (p.user.trick === 'ricochet') { p.user.ric.add(e); this._ricochet(e.center ?? e.pos, p.user.ric, TUNE.ricN, 0); }
        if (p.user.trick === 'cable') this._yank(e);
        const head = p.user.trick !== 'giant' && p.pos.y > e.pos.y + e.height * 0.82;
        g.hud?.hitMarker?.(head);
        if (head) {
          e.takeDamage?.(p.damage, { source: this, kind: 'arrow', stun: 0.3 });
          g.fx?.text?.(_a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'HEADSHOT', 0xffd24a, { size: 1.5 });
          g.slowmo?.(0.05, 0.05); g.cam.shake(0.2); rumble(g, 0.5, 0.5, 100);
        }
      },
      onExpire: (p) => this._arrowEnd(p),
    });
    proj.user.trail = g.fx?.trail?.(mesh, o.color ?? PURPLE, o.scale ? 0.5 : o.homing ? 0.18 : 0.12, 0.35);
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
      case 'emp': this._emp(pos.clone()); break;
      case 'cryo': this._cryo(pos.clone()); break;
      case 'smoke': this._smoke(pos.clone()); break;
      case 'sonic': this._sonic(pos.clone()); break;
      case 'giant': this._giantImpact(pos.clone(), mesh, p); break;
      case 'ricochet': if (worldHit) this._ricochet(pos.clone(), u.ric, TUNE.ricN + 1, 0); break;
      case 'cable': if (worldHit) this._cableAnchor(p, u.cableOrigin); break;
      default: break;
    }
    // stick standard / dud arrows into walls briefly
    if (u.trick === 'giant') { /* mesh handled by _giantImpact */ }
    else if (worldHit && !u.boom && (!u.trick || u.trick === 'net' || u.trick === 'cable')) {
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

  // ---- focus aim (airborne): slow motion + marks -----------------------------------------------------
  _focusUpdate(dt) {
    const g = this.game;
    const air = !this.onGround && this.state === 'free';
    if (air && this.aimTime > 0.08 && this.focusLeft > 0) {
      if (!this.focusing) {
        this.focusing = true;
        this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.6), 'FOCUS', 0xff6a6a, { size: 0.6 });
        g.audio?.play('whoosh', { volume: 0.3, pitch: 0.5 });
      }
      this.focusLeft -= dt / TUNE.focusScale;      // budget is in real seconds
      g.slowmo?.(0.06, TUNE.focusScale);
      this.vel.y = Math.max(this.vel.y, -6);       // hang in the air
      this._markT -= dt;
      if (this._markT <= 0) {
        this._markT = 0.06;
        const t = this._rayTarget();
        if (t && this.marks.count < TUNE.markMax && this.marks.add(t)) {
          g.audio?.play('switch', { volume: 0.35, pitch: 1.6 + this.marks.count * 0.15 });
          this._fx('burst', (t.center ?? t.pos).clone(), 0xff5a5a, 8, 3, 0.3, 0.14);
          rumble(g, 0.15, 0.3, 40);
        }
      }
    } else this.focusing = false;
  }
  /** Enemy closest to the camera aim ray (3D, so it works when aiming down from the air). */
  _rayTarget() {
    const g = this.game;
    g.cam.aimDirection(_aim.dir).normalize();
    const o = g.camera.position;
    let best = null, bs = Infinity;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || this.marks.has(e)) continue;
      _c.copy(e.center ?? e.pos).sub(o);
      const t = _c.dot(_aim.dir);
      if (t < 2 || t > 90) continue;
      const perp = Math.sqrt(Math.max(0, _c.lengthSq() - t * t));
      const tol = 1.1 + (e.radius ?? 0.5) + t * 0.035;
      if (perp > tol) continue;
      if (perp / tol < bs) { bs = perp / tol; best = e; }
    }
    return best;
  }
  _focusOff(dt) {
    this.focusing = false;
    if (this.onGround) this.focusLeft = Math.min(TUNE.focusBudget, this.focusLeft + dt * 1.2);
    if (!this.aiming && this.marks.count && !this._wasAiming) this.marks.clear();
  }
  _volley() {
    const g = this.game;
    const list = this.marks.list();
    this.marks.clear();
    this.focusing = false;
    g.slowmo?.(0.5 + list.length * 0.08, 0.4);
    g.cam.shake(0.2);
    this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.6), 'FOCUS VOLLEY x' + list.length, 0xff6a6a, { size: 0.7 });
    list.forEach((e, i) => this.timers.after(i * 0.07, () => {
      if (!this.active || !e.alive) return;
      this._muzzle(_m);
      _d.copy(e.center ?? e.pos).sub(_m).normalize();
      this._shootArrow(_m, _d, { speed: 95, dmg: TUNE.volleyDmg, color: 0xff5a5a, homing: e, turn: 10, gravity: 0, heavy: true });
      this._fx('burst', _m.clone(), 0xff5a5a, 4, 3, 0.2, 0.12);
    }));
  }

  // ---- multi-nock: 3 / 5 arrow fan with lock-on --------------------------------------------------------
  _multiNock() {
    if (!this.useCooldown('nock', TUNE.nockCd)) return;
    const g = this.game;
    const charge = Math.max(0.4, this.charge);
    const n = this.charge >= 0.95 ? 5 : 3;
    this.charge = 0; this._full = false;
    this._muzzle(_m);
    aimInfo(this, 140, _aim);
    const base = _c.subVectors(_aim.point, _m);
    if (base.length() < 3) base.copy(_aim.dir);
    base.normalize();
    const base2 = base.clone();
    // pick lock-on candidates nearest to the crosshair line
    const cands = enemiesNear(g, this.pos, 55).map((e) => ({ e, dot: _b.copy(e.center ?? e.pos).sub(_m).normalize().dot(base2) })).filter((o) => o.dot > 0.9).sort((a, b) => b.dot - a.dot).slice(0, n);
    const dmg = (TUNE.aimDmg0 + (TUNE.aimDmg1 - TUNE.aimDmg0) * charge) * TUNE.nockDmg;
    for (let i = 0; i < n; i++) {
      const ang = (i - (n - 1) / 2) * 0.1;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      _d.set(base2.x * ca - base2.z * sa, base2.y + (i - (n - 1) / 2) * 0.012, base2.x * sa + base2.z * ca).normalize();
      const tgt = cands[i]?.e ?? null;
      this._shootArrow(_m, _d, { speed: 85, dmg, color: PURPLE, homing: tgt, turn: 4.5, heavy: false });
    }
    this.yaw = Math.atan2(base2.x, base2.z);
    this.actionT = 0.25; this.actionAnim = 'shoot';
    this._fx('burst', _m.clone(), PURPLE, 14, 5, 0.3, 0.2);
    this._fx('ring', _m.clone(), 1.1, PURPLE, 0.25);
    this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.5), n === 5 ? 'MULTI-NOCK x5' : 'MULTI-NOCK', PURPLE, { size: 0.55 });
    g.cam.shake(0.18); rumble(g, 0.5, 0.3, 90);
    this.vel.x -= base2.x * 2.5; this.vel.z -= base2.z * 2.5;
  }

  // ---- trick arrow payloads ---------------------------------------------------------------------------------
  _ricochet(from, used, left, idx) {
    if (left <= 0) return;
    const g = this.game;
    let best = null, bd = TUNE.ricRange;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || used.has(e)) continue;
      const d = e.pos.distanceTo(from);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    used.add(best);
    const e = best, start = from.clone();
    this.timers.after(0.1, () => {
      if (!this.active) return;
      const c = (e.center ?? e.pos).clone();
      this._fx('beam', start, c, 0xffffff, 0.07, 0.3);
      this._fx('lightning', start.clone(), c.clone(), 0xff66d8, 0.35, 1);
      this._fx('glow', start.clone(), 0xff66d8, 1.1, 0.2);
      if (e.alive) {
        const dmg = TUNE.ricDmg[Math.min(idx + 1, TUNE.ricDmg.length - 1)];
        _d.subVectors(c, start).setY(0).normalize().multiplyScalar(5).setY(2);
        const dealt = e.takeDamage?.(dmg, { knockback: _d.clone(), stun: 0.45, source: this, kind: 'arrow' }) ?? 0;
        if (dealt > 0) {
          this._fx('hitSpark', c.clone(), 0xff66d8, false);
          this._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 0.4, e.pos.z), String(Math.round(dealt)), 0xff9ae8);
          this.registerHit();
        }
        this.game.audio?.play('hit', { volume: 0.5, pitch: 1.4 + idx * 0.15 });
      }
      this._ricochet(c, used, left - 1, idx + 1);
    });
  }

  _yank(e) {
    const g = this.game;
    if (!e || !e.alive) return;
    _d.subVectors(this.pos, e.pos).setY(0);
    const dist = _d.length(); _d.normalize();
    const k = e.isBoss ? 0.4 : 1;
    e.vel.x += _d.x * Math.min(24, 8 + dist * 0.9) * k; e.vel.z += _d.z * Math.min(24, 8 + dist * 0.9) * k; e.vel.y = Math.max(e.vel.y, 4);
    stunEnemy(e, 0.9);
    this._muzzle(_m);
    this._fx('beam', _m.clone(), (e.center ?? e.pos).clone(), 0xffd24a, 0.07, 0.35);
    this._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'REELED IN', 0xffd24a);
    g.audio?.play('zip', { volume: 0.5 });
  }

  _emp(pos) {
    const g = this.game, R = TUNE.empR, col = 0x55b8ff;
    this._fx('flash', pos.clone(), col, 5, 0.25);
    this._fx('ring', pos.clone(), R, col, 0.5);
    this.timers.after(0.08, () => this._fx('ring', pos.clone(), R * 0.7, 0xffffff, 0.4));
    this._fx('burst', pos.clone(), col, 22, 8, 0.5, 0.22);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand(0, 0.6);
      this._fx('lightning', pos.clone(), pos.clone().add(new THREE.Vector3(Math.cos(a) * R, rand(0, 2), Math.sin(a) * R)), col, 0.3, 2);
    }
    g.audio?.play('lightning', { volume: 0.8 });
    g.cam.shake(0.25);
    for (const e of enemiesNear(g, pos, R)) {
      const mach = isMachine(e);
      const dmg = mach ? (e.isBoss ? 60 : TUNE.empMachineDmg) : TUNE.empDmg;
      e.takeDamage?.(dmg, { stun: mach ? 0 : 0.5, source: this, kind: 'emp', knockback: _d.subVectors(e.pos, pos).setY(0).normalize().multiplyScalar(3).setY(1).clone() });
      if (!e.alive) continue;
      if (mach) {
        const s = stunEnemy(e, TUNE.empStun);
        this.status.apply(e, 'emp', s);
        if (!e.isBoss && (e.gravity ?? 28) < 5) e.vel.y = -3;    // sentries drop out of the air
        this._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'SHORTED OUT', col, { size: 1.2 });
      }
    }
  }

  _cryo(pos) {
    const g = this.game, R = TUNE.cryoR, col = 0xaee8ff;
    this._fx('flash', pos.clone(), col, 4, 0.25);
    this._fx('ring', pos.clone(), R, col, 0.55);
    this._fx('shockwave', pos.clone(), R * 1.2, 0xffffff);
    this._fx('burst', pos.clone(), col, 30, 6, 0.8, 0.2);
    this._fx('burst', pos.clone(), 0xffffff, 12, 3, 1.0, 0.35);
    g.audio?.play('clap', { volume: 0.5, pitch: 1.6 });
    for (const e of enemiesNear(g, pos, R)) {
      e.takeDamage?.(TUNE.cryoDmg, { stun: 0.2, source: this, kind: 'cryo' });
      if (!e.alive) continue;
      if (e.isBoss) { e.slowTimer = Math.max(e.slowTimer ?? 0, 2); this.status.apply(e, 'ice', 1.2, 1); }
      else { e.web?.(TUNE.cryoTime); this.status.apply(e, 'ice', TUNE.cryoTime, TUNE.cryoMul); }
      this._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'FROZEN', col, { size: 1.2 });
    }
  }

  _smoke(pos) {
    if (this.smokes.length >= 3) this.smokes.shift();
    pos.y = Math.max(pos.y, this.game.physics?.heightAt?.(pos.x, pos.z, pos.y + 1) ?? pos.y);
    this.smokes.push({ pos: pos.clone(), t: TUNE.smokeTime, r: TUNE.smokeR, puff: 0 });
    this._fx('burst', pos.clone(), 0xb0b6c0, 18, 5, 0.5, 0.3);
    this._fx('dust', pos.clone(), 14, TUNE.smokeR * 0.8, 0.55);
    this._fx('text', _a.copy(pos).setY(pos.y + 2), 'SMOKE SCREEN', 0xcfd4dc);
    this.game.audio?.play('whoosh', { volume: 0.6, pitch: 0.7 });
  }
  _smokeTick(dt) {
    const g = this.game;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const sm = this.smokes[i];
      sm.t -= dt; sm.puff -= dt;
      if (sm.t <= 0) { this.smokes.splice(i, 1); continue; }
      if (sm.puff <= 0) {
        sm.puff = 0.07;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * sm.r;
          this._fx('smoke', _a.set(sm.pos.x + Math.cos(a) * rr, sm.pos.y + rand(0.3, 3), sm.pos.z + Math.sin(a) * rr), rand(2.2, 3.4), 2.4, null, 0.5);
        }
      }
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || e.pos.distanceTo(sm.pos) > sm.r) continue;
        e.slowTimer = Math.max(e.slowTimer ?? 0, 0.5);     // coughing, groping blind
      }
    }
  }

  _sonic(pos) {
    const g = this.game, R = TUNE.sonicR;
    for (let k = 0; k < 4; k++) this.timers.after(k * 0.07, () => this._fx('ring', pos.clone().setY(pos.y + 0.2 + k * 0.25), R * (0.5 + k * 0.17), k % 2 ? 0xffffff : 0xffe08a, 0.5));
    this._fx('shockwave', pos.clone(), R, 0xffe08a);
    this._fx('flash', pos.clone(), 0xffe08a, 4, 0.2);
    g.audio?.play('clap', { volume: 1, pitch: 0.7 }); g.audio?.play('thunder', { volume: 0.4, pitch: 1.4 });
    g.cam.shake(0.55); rumble(g, 0.7, 0.8, 250);
    const hits = g.combat.aoe({ center: pos, radius: R, damage: TUNE.sonicDmg, knockback: 16, up: 4, stun: TUNE.sonicStun, source: this, falloff: false }) ?? [];
    for (const e of hits) {
      if (!e.alive) continue;
      e.slowTimer = Math.max(e.slowTimer ?? 0, 3);        // ears ringing
      stunEnemy(e, e.isBoss ? 0.5 : TUNE.sonicStun);
    }
  }

  _giantImpact(pos, mesh, p) {
    const g = this.game;
    const R = TUNE.giantR;
    this._fx('shockwave', pos.clone(), R * 1.3, 0xff4a4a);
    this._fx('burst', pos.clone(), 0xff4a4a, 26, 9, 0.6, 0.35);
    this._fx('flash', pos.clone(), 0xff6a4a, 6, 0.3);
    g.combat.aoe({ center: pos, radius: R, damage: TUNE.giantBoom, knockback: 20, up: 9, stun: 1.4, source: this, falloff: true });
    g.audio?.play('smash', { volume: 1 });
    g.cam.shake(0.7); rumble(g, 0.9, 0.7, 300); g.slowmo?.(0.1, 0.3);
    _d.copy(p.vel).normalize();
    mesh.position.copy(pos).addScaledVector(_d, -0.9);
    this.stuck.push({ mesh, t: 4.5 });
  }

  _cableAnchor(p, origin) {
    const g = this.game;
    if (this.state !== 'free' || this.ult) return;
    _d.copy(p.vel).normalize();
    const hit = g.physics.raycast(_b.copy(p.pos).addScaledVector(_d, -0.7), _d, 2);
    if (!hit) return;
    const nrm = hit.normal;
    if (this.pos.distanceTo(hit.point) < 4) return;
    this.zipHit.copy(hit.point);
    this.zipN.copy(nrm).setY(0); if (this.zipN.lengthSq() > 0.01) this.zipN.normalize();
    this.zipTarget.copy(hit.point).addScaledVector(nrm, this.radius + 0.55);
    if (Math.abs(nrm.y) < 0.5) this.zipTarget.y -= 0.9;
    this.zipKind = 'line';
    this.state = 'zip'; this.zipT = 0; this.zipSpeed = Math.max(18, this.vel.length() * 0.7); this.zipStuck = 0; this._zipLast.copy(this.pos);
    this.lineA.copy(origin ?? this.center); this.lineT = 4.5; this.lineHit = new Set(); this.lineTick = 0;
    this.setAnim('zip', 20);
    const m = makeArrow(0xffd24a);
    m.position.copy(hit.point).addScaledVector(nrm, 0.1);
    m.quaternion.setFromUnitVectors(_b.set(0, 0, 1), _c.copy(nrm).negate());
    g.scene.add(m); this.stuck.push({ mesh: m, t: 4.5 });
    g.audio?.play('zip'); rumble(g, 0.3, 0.2, 80);
    this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.5), 'ZIPLINE', 0xffd24a);
    this._fx('burst', hit.point.clone(), 0xffd24a, 12, 4, 0.3, 0.15);
  }

  // ---- parkour: roll / vault ----------------------------------------------------------------------------------
  _tryParkour() {
    if (!this.onGround || (this.cooldowns.parkour || 0) > 0) return false;
    const g = this.game, input = g.input;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (input.move.lengthSq() < 0.1 && hs < 5) return false;           // standing still: backflip shot instead
    const w = g.cam.moveVector(input.move, _a);
    if (w.lengthSq() < 0.01) w.set(this.vel.x, 0, this.vel.z);
    w.setY(0).normalize();
    this.moveDir.copy(w);
    this.useCooldown('parkour', TUNE.parkourCd);
    this.yaw = Math.atan2(w.x, w.z);
    this.moveHit.clear();
    // low cover ahead? vault it
    const hit = g.physics.raycast(_b.set(this.pos.x, this.pos.y + 0.45, this.pos.z), w, 2.2, { ignoreGround: true });
    const h = hit?.box ? hit.box.max.y - this.pos.y : 99;
    if (hit && h > 0.35 && h <= TUNE.vaultMax) {
      this.moveKind = 'vault'; this.state = 'vault'; this.moveT = 0.7;
      this.vel.set(w.x * 9, Math.sqrt(2 * this.gravity * (h + 0.9)), w.z * 9);
      this.onGround = false;
      this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.4), 'VAULT', 0xe8e0ff);
      g.audio?.play('jump', { pitch: 1.3 });
    } else {
      this._startRoll(w, false);
    }
    return true;
  }
  _startRoll(w, landing) {
    const g = this.game;
    this.moveDir.copy(w); this.moveKind = 'roll'; this.state = 'roll'; this.moveT = TUNE.rollTime; this.moveHit.clear();
    this.yaw = Math.atan2(w.x, w.z);
    this.invuln = Math.max(this.invuln, 0.5);
    this.customMovement = true;
    this.setAnim('dodge', 1);
    this._fx('dust', this.pos.clone(), landing ? 10 : 6, landing ? 2 : 1.2);
    g.audio?.play(landing ? 'land' : 'dodge', { volume: 0.6 });
    if (landing) this._fx('text', _a.copy(this.pos).setY(this.pos.y + this.height + 0.4), 'ROLL', 0xe8e0ff);
  }
  _moveUpdate(dt) {
    const g = this.game;
    this.customMovement = true; this.gravityScale = 1;
    this.moveT -= dt;
    this.setAnim('dodge', 1);
    const w = this.moveDir;
    if (this.state === 'roll') {
      const k = 0.55 + 0.45 * Math.max(0, this.moveT / TUNE.rollTime);
      this.vel.x = w.x * TUNE.rollSpeed * k; this.vel.z = w.z * TUNE.rollSpeed * k;
      this._rollDust = (this._rollDust ?? 0) - dt;
      if (this._rollDust <= 0) { this._rollDust = 0.07; this._fx('dust', this.pos.clone(), 1, 0.6); }
      // shoulder through anyone in the way
      for (const e of enemiesNear(g, this.pos, 1.5)) {
        if (this.moveHit.has(e)) continue;
        this.moveHit.add(e);
        e.takeDamage?.(10, { knockback: _d.copy(w).multiplyScalar(5).setY(2).clone(), stun: 0.5, source: this, kind: 'melee' });
        this._fx('hitSpark', (e.center ?? e.pos).clone(), 0xe8e0ff, false);
      }
      if (this.moveT <= 0) { this.state = 'free'; this.customMovement = false; this.vel.x *= 0.6; this.vel.z *= 0.6; }
    } else {   // vault
      if (this.moveT > 0.1) { this.vel.x = w.x * 9; this.vel.z = w.z * 9; }
      if (this.moveT <= 0 || (this.onGround && this.moveT < 0.55)) { this.state = 'free'; this.customMovement = false; }
    }
  }
  onLand() {
    const vy = -this._impactVy, g = this.game;
    if (this.state !== 'free' || this.ult) return;
    if (vy > 14 && g.input.move.lengthSq() > 0.1) {
      const w = g.cam.moveVector(g.input.move, _a).setY(0);
      if (w.lengthSq() > 0.01) { this._startRoll(w.normalize(), true); return; }
    }
    if (vy > 10) { g.audio?.play('land', { volume: 0.4 }); this._fx('dust', this.pos.clone(), 5, 1.5); }
  }

  // ---- melee ----------------------------------------------------------------
  _melee() {
    const step = this.chain % 4;
    const M = [
      { dmg: 14, anim: 'punch1', kb: 1.5, up: 2 }, { dmg: 17, anim: 'punch2', kb: 2.5, up: 2 },
      { dmg: 22, anim: 'kick', kb: 7, up: 3 }, { dmg: 30, anim: 'uppercut', kb: 16, up: 6 },
    ][step];
    const near = this.game.enemies?.nearest?.(this.pos, 4);
    if (near) { _d.subVectors(near.pos, this.pos).setY(0); if (_d.lengthSq() > 0.01) this.yaw = Math.atan2(_d.x, _d.z); }
    else { const f = this.game.cam.forward; if (this.input_moving()) this.yaw = Math.atan2(f.x, f.z); }
    this.setAnim(M.anim, 1); this.actionAnim = M.anim; this.actionT = step === 3 ? 0.46 : 0.34;
    const fwd = this.forward;
    if (this.onGround) { this.vel.x += fwd.x * 5; this.vel.z += fwd.z * 5; }
    this.game.combat.melee({ origin: this.center, forward: fwd, range: 2.8, arc: 130, damage: M.dmg, knockback: M.kb, up: M.up, stun: 0.35, source: this, heavy: step >= 2 });
    this.game.audio?.play(step >= 2 ? 'kick' : 'punch', { volume: 0.6 });
    this._bowSwingFx(step, fwd);
    this.chain = (this.chain + 1) % 4; this.chainT = 1;
  }
  // bow-staff swing arcs; the 4th hit ends in a point-blank shot
  _bowSwingFx(step, fwd) {
    const g = this.game;
    const c = this.center, r = _b.set(fwd.z, 0, -fwd.x);
    const flip = step % 2 ? -1 : 1;
    const tilt = [0.5, -0.5, 0.0, 1.0][step];
    let prev = null;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6 - 0.5) * 2.4 * flip;
      const pt = c.clone().addScaledVector(fwd, Math.cos(a) * 1.6).addScaledVector(r, Math.sin(a) * 1.6);
      pt.y += tilt * Math.sin(a) * 0.9 - 0.1;
      if (prev) this._fx('beam', prev, pt, step === 3 ? 0xffffff : PURPLE, 0.07 + i * 0.01, 0.14);
      prev = pt;
    }
    if (step === 3) {
      this._muzzle(_m);
      _d.copy(fwd).setY(0.05).normalize();
      this._fx('beam', _m.clone(), _m.clone().addScaledVector(_d, 7), 0xffffff, 0.14, 0.2);
      this._fx('burst', _m.clone(), PURPLE, 14, 7, 0.3, 0.2);
      this._fx('flash', _m.clone(), PURPLE, 4, 0.15);
      g.cam.shake(0.2);
    }
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
      if (top - hit.point.y < 45 && hit.box.data?.type !== 'prop') {
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
    if (dist < 1.1 || this.zipT > 2.4) { this._zipEnd(true); return; }
    const top = this.zipKind === 'line' ? TUNE.lineSpeed : TUNE.zipSpeed;
    this.zipSpeed = approach(this.zipSpeed, top, 160 * dt);
    if (this.zipKind === 'line') this._lineKick(dt);
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
  _lineKick(dt) {
    this.lineTick -= dt;
    if (this.lineTick > 0) return;
    this.lineTick = 0.06;
    for (const e of enemiesNear(this.game, this.pos, 1.9)) {
      if (this.lineHit.has(e)) continue;
      this.lineHit.add(e);
      _d.copy(this.vel).setY(0).normalize().multiplyScalar(12).setY(5);
      e.takeDamage?.(22, { knockback: _d.clone(), stun: 0.7, source: this, kind: 'melee' });
      this._fx('hitSpark', (e.center ?? e.pos).clone(), 0xffd24a, true);
      this.registerHit(); this.game.cam.shake(0.15);
    }
  }
  _zipEnd(done) {
    if (this.zipKind === 'line') this.cable.hide();
    this.cable.hide();
    this.state = 'free'; this.customMovement = false; this.gravityScale = 1;
    if (!done) return;
    if (this.zipKind === 'ledge') {
      this.vel.set(-this.zipN.x * 3, 2, -this.zipN.z * 3);
      this.yaw = Math.atan2(-this.zipN.x, -this.zipN.z);
      this.game.audio?.play('land', { volume: 0.5 });
    } else if (this.zipKind === 'line') { const sp = this.vel.length(); if (sp > 24) this.vel.multiplyScalar(24 / sp); this.vel.y += 5; }
    else { const sp = this.vel.length(); if (sp > 16) this.vel.multiplyScalar(16 / sp); }
  }

  // ---- ultimate: Arrow Storm ----------------------------------------------------------------
  _startUlt() {
    const g = this.game;
    this._endAim(); this.charge = 0;
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
    this.status.update(dt);
    this.marks.update(dt, this.game.time ?? 0);
    this._smokeTick(dt);
    if (this.lineT > 0) {
      this.lineT -= dt;
      if (this.lineT > 0) this.lineCable.set(this.lineA, this.zipHit); else this.lineCable.hide();
    }
  }
}
