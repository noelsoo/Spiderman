// Spider-Man (classic + Symbiote suit), modelled on Marvel's Spider-Man 2.
// Owns: web-swinging (corner swings, slingshot launch), wall crawl/run, web-zip, Web Wings (+ dive), melee combo with
// finishers, web-shooter AIMING with six gadgets, parry / perfect dodge, symbiote suit powers, ultimates.
// Helpers live in ./spider/* (rope renderer, tendrils, gadgets, powers).
//
// Control summary (keyboard / pad)
//   Shift / R2 (hold)  web-swing (auto-chains while held)     Space / X   jump, wall jump, point-launch off a swing,
//   hold in air while falling = Web Wings (stick back = dive)  hold on a perch / idle on a wall = SLINGSHOT launch
//   E / L1             web-zip to aim point / zip boost        RMB / L2 (hold)  AIM: over-the-shoulder web shooter
//   J / []  combo (lunges at nearest enemy; hold = Arm Spin / Spider Slam, symbiote: charged Symbiote Punch)
//   K / R1  web shot (hold = web pull / web throw) ; symbiote: tap Symbiote Strike, hold Tendril Tear
//   RMB / L2 tap  web shot / toggle suit (R on keyboard)       C / O   dodge (perfect dodge) ; just before a hit = PARRY
//   Q / R3  ultimate (Focus 100): Web Bomb / Rampage
//   while aiming: LMB / R2 fire the selected gadget, E / L1 or mouse wheel / D-pad down cycle gadgets, K / R1 quick web
import * as THREE from 'three';
import { Hero, approach } from './Hero.js';
import { RopeLine } from './spider/rope.js';
import { TendrilPool } from './spider/tendrils.js';
import { Gadgets } from './spider/gadgets.js';
import * as P from './spider/powers.js';

// ---- tuning ---------------------------------------------------------------
const TUNE = {
  walk: 7, run: 15, sprint: 21, jump: 11.5, gravity: 27, aimWalk: 4.4,
  // swing
  swingGravity: 26, swingMax: 56, swingPump: 9, swingSteer: 16, swingReel: 14, ropeShorten: 0.9,
  anchorMin: 10, anchorMax: 95, groundClear: 4, swingMinRise: 6, launchUp: 17,
  // wall
  wallSpeed: 7, wallSprint: 14, wallSymbiote: 10, wallOffset: 0.4, wallJumpOut: 11, wallJumpUp: 12.5,
  // zip
  zipRange: 60, zipSpeed: 58, zipBoost: 34, zipBoostCd: 2.2,
  // glide
  glideFall: -4, glideSpeed: 22, glideTurn: 2.4, diveSpeed: 40, diveFall: -24,
  // slingshot
  slingMin: 0.16, slingMax: 1.1, slingSpeed: 30, slingBonus: 30,
  // combat
  lungeRange: 8, dodgeSpeed: 18, dodgeTime: 0.42, perfectWindow: 0.25, parryWindup: 0.15, parryRange: 5.5,
  holdAttack: 0.32,
  symDamage: 1.7,
};

const UP = new THREE.Vector3(0, 1, 0);
const lerp1 = (a, b, t) => a + (b - a) * t;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _w = new THREE.Vector3(), _hp = new THREE.Vector3(), _hp2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

const clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class SpiderMan extends Hero {
  constructor(game) {
    super(game, {
      id: 'spiderman', name: 'Spider-Man', color: '#e0202a', maxHp: 120,
      walkSpeed: TUNE.walk, runSpeed: TUNE.run, jumpSpeed: TUNE.jump, gravity: TUNE.gravity,
      radius: 0.42, height: 1.8, airControl: 0.5, mass: 0.9,
      usesAim: true, aimPreset: { fov: 48, distance: 2.3, shoulder: 0.8, height: 1.6 },
    });
    this.lines = {
      swing: new RopeLine(game.scene), zip: new RopeLine(game.scene), pull: new RopeLine(game.scene, { radius: 0.045, tip: 0.016 }),
    };
    this.tendrils = new TendrilPool(game.scene);
    this.gadgets = new Gadgets(this);
    this.symbiote = false;
    this.consumesWeaponWheel = false; // true while aiming: the weapons system should not cycle guns with the wheel / D-pad down
    this._resetState();
    this._installWallHands();
  }

  /** Spread the fingers flat on the wall while crawling / clinging (runs after the glove hook). */
  _installWallHands() {
    const m = this.model, j = m.j;
    if (!j || !m.hooks?.fns || m._wallHands) return;
    m._wallHands = true;
    const hands = [9, 10].map((wj, hi) => {
      const sd = hi === 0 ? 1 : -1;
      const fingers = j[wj].children.filter((o) => o.children.length === 1 && o.children[0].children.length === 0 && o.position.y < -0.07 && !o.isMesh).sort((a, b) => (-sd * a.position.x) - (-sd * b.position.x));
      return { sd, fingers, w: 0 };
    });
    m.hooks.fns.push((c, mm) => {
      const on = mm.extra?.wall ? 1 : 0;
      for (let hi = 0; hi < 2; hi++) {
        const h = hands[hi];
        h.w += (on * (0.6 + 0.4 * (mm.extra.plant?.[hi] ?? 1)) - h.w) * (1 - Math.exp(-14 * c.dt));
        if (h.w < 0.02) continue;
        h.fingers.forEach((p1, i) => {
          const spread = (i - 1.5) * 0.2;
          p1.rotation.z = lerp1(p1.rotation.z, -h.sd * 0.1, h.w); p1.rotation.x = lerp1(p1.rotation.x, spread, h.w);
          p1.children[0].rotation.z = lerp1(p1.children[0].rotation.z, -h.sd * 0.05, h.w);
        });
      }
    });
  }

  _resetState() {
    this.state = 'free'; // free | swing | wall | zip | glide | ult
    this.symbiote = false; this.model.setVariant?.('classic');
    this.anchor = new THREE.Vector3(); this.ropeLen = 20; this.ropeTarget = 20; this.swingT = 0;
    this.hand = 0; this.swingLock = 0; this.swingTry = 0; this.reattach = 0;
    this.wallN = new THREE.Vector3(0, 0, 1); this.wallLost = 0; this.wallLock = 0;
    this.zipTarget = new THREE.Vector3(); this.zipKind = 'ground'; this.zipN = new THREE.Vector3(); this.zipT = 0; this.zipSpeed = 0;
    this.zipStuck = 0; this._zipLast = new THREE.Vector3(); this.zipHit = new THREE.Vector3();
    this.airT = 0; this.groundT = 0; this.jumpArmed = false; this.perchT = 0; this.stillT = 0; this.edgeT = 0; this.nearEdge = false; this.ledgePerch = false; this.rollT = 0; this.slam = false; this.slamPower = null; this.boostT = 0;
    this.atk = null; this.atkStep = 0; this.atkReset = 0;
    this.dodgeT = 0; this.dodgeAge = 99; this.dodgeDir = new THREE.Vector3();
    this.lash = null; this.ult = null; this.holdSpecial = 0; this.pullUsed = false; this.pullLineT = 0; this.pullTarget = null;
    this.senseT = 0; this.senseScan = 0; this.senseShown = false;
    this.fovK = 0; this._pose = null; this._preVy = 0; this.vaultT = 0;
    this.stats = { dmg: 1 };
    this.customMovement = true; this.gravityScale = 1;
    this.model.customRotation = false;
    // v3
    this._tasks = [];
    this.gadgets.reset();
    this.aimAirT = 0; this._xh = false; this._wasAim = false; this.aimFov = this.aimPreset.fov; this.aimEnemy = null; this.aimPitch = 0;
    this.shootT = 0; this.counterT = 0; this.counterTarget = null;
    this.sling = null; this.slingK = 0; this.spin = null;
    this.atkHold = 0; this.charging = false; this.holdUsed = false; this.punchCharge = 0;
    this.trickT = 0; this.trickDir = 1; this.slamLeapT = 0;
    this._edge = { ab: false, wn: false, wp: false, abPrev: false, wnPrev: false, wpPrev: false };
    this.tendrils.clear();
  }

  onActivate() {
    this._resetState();
    this.color = '#e0202a';
    this.cooldowns = {};
  }
  onDeactivate() {
    for (const l of Object.values(this.lines)) l.hide();
    this.tendrils.clear();
    if (this._xh) this.game.hud?.setCrosshair?.(null);
    this._xh = false; this.consumesWeaponWheel = false;
    this.model.customRotation = false; this.game.cam.fovKick = 0; this.gravityScale = 1;
  }

  get abilityHints() {
    const sym = this.symbiote, G = this.gadgets;
    return [
      { action: 'swing', key: 'swing', label: 'Web Swing', cooldown: 0, active: this.state === 'swing' },
      { action: 'special', key: 'special', label: sym ? 'Symbiote Strike' : 'Web Shot', cooldown: this.cooldownFrac('special') },
      { action: 'ability', key: 'ability', label: this.aiming ? 'Next Gadget' : 'Web Zip', cooldown: this.aiming ? 0 : this.cooldownFrac('zip'), active: this.state === 'zip' },
      { action: 'ability2', key: 'ability2', label: sym ? 'Classic Suit' : 'Symbiote Suit', cooldown: this.cooldownFrac('suit'), active: sym },
      { action: 'dodge', key: 'dodge', label: 'Dodge / Parry', cooldown: this.cooldownFrac('dodge') },
      { action: 'aim', key: 'aim', label: G.label(), cooldown: G.frac(), active: this.aiming },
      { action: 'ultimate', key: 'ultimate', label: sym ? 'Rampage' : 'Web Bomb', cooldown: 1 - this.focus / 100, active: this.focus >= 100 },
    ];
  }

  // ---- helpers -------------------------------------------------------------
  _center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z); }
  _hand(out) {
    const h = this.hand ? this.model.handL : this.model.handR;
    const o = h || this.model.chest;
    if (o) o.getWorldPosition(out); else this._center(out);
    return out;
  }
  _fx(name, ...args) { return this.game.fx?.[name]?.(...args); }
  _play(name, opts) { this.game.audio?.play?.(name, opts); }
  _rumble(s, w, ms) { this.game.input.rumble(s, w, ms); }
  _wish(input, out = _w) { return this.game.cam.moveVector(input.move, out); }
  _groundDist() { return this.pos.y - this.game.physics.heightAt(this.pos.x, this.pos.z, this.pos.y + 0.6); }
  _later(sec, fn) { this._tasks.push({ t: sec, fn, later: true }); }
  /** fn(dt, T) runs every frame until it returns true (T.t is free scratch space). */
  _task(fn) { this._tasks.push({ t: 0, fn }); }
  _tickTasks(dt) {
    const list = this._tasks;
    for (let i = 0; i < list.length; i++) {
      const T = list[i];
      if (T.later) {
        T.t -= dt; if (T.t > 0) continue;
        try { T.fn(); } catch (err) { console.error(err); }
        list.splice(i--, 1);
      } else {
        let done = true;
        try { done = T.fn(dt, T); } catch (err) { console.error(err); }
        if (done) list.splice(i--, 1);
      }
    }
  }
  _hit(e, amount, o) { return this.gadgets._dmg(e, amount, o); }
  /** Impact feel: camera shake, rumble and (for heavy hits) a brief hit-stop. power 0..1 */
  _impact(power, sym = false) {
    const g = this.game;
    g.cam.shake(0.04 + 0.3 * power);
    this._rumble(0.15 + 0.7 * power, 0.15 + 0.3 * power, 50 + 120 * power);
    if (power >= 0.55 && (g._slowmo ?? 0) <= 0.07) g.slowmo?.(sym ? 0.06 : 0.05, 0.05);
  }
  _aimTargetNear(r) { return this.game.enemies?.nearest?.(this.pos, r) ?? null; }
  _webbedNear(range) {
    let best = null, bd = range * range;
    for (const e of this.game.enemies?.list ?? []) {
      if (!e.alive || !e.webbed || e.isBoss) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d2 = dx * dx + dz * dz;
      if (d2 > bd) continue;
      bd = d2; best = e;
    }
    return best;
  }

  /** Orient the model: forward vector + up vector (Gram-Schmidt'd), smoothed. */
  _setPose(fwd, up, rate = 12) {
    this._pose = { fwd: (this._pose?.fwd ?? new THREE.Vector3()).copy(fwd), up: (this._pose?.up ?? new THREE.Vector3()).copy(up), rate };
  }
  _applyPose(dt) {
    const g = this.model.group;
    if (!this._pose) { if (this.model.customRotation) { this.model.customRotation = false; g.rotation.set(0, this.yaw, 0); } return; }
    const { fwd, up, rate } = this._pose;
    _y.copy(up).normalize();
    _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).addScaledVector(_y, -_y.y * 0);
    _z.normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    if (!this.model.customRotation) { this.model.customRotation = true; g.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0)); }
    g.quaternion.slerp(_q, 1 - Math.exp(-rate * dt));
  }
  /** Pitch the upright model forward by theta along heading `dir` (horizontal), with bank. */
  _leanPose(dirFlat, theta, bank = 0, rate = 10) {
    _a.copy(dirFlat); _a.y = 0; if (_a.lengthSq() < 1e-6) _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); _a.normalize();
    const c = Math.cos(theta), s = Math.sin(theta);
    _b.set(_a.z, 0, -_a.x); // right-ish
    _c.copy(UP).multiplyScalar(c).addScaledVector(_a, s).addScaledVector(_b, bank);
    _d.copy(_a).multiplyScalar(c).addScaledVector(UP, -s);
    this._setPose(_d, _c, rate);
  }

  // ---- anchor search ---------------------------------------------------------
  _swingHeading(input, out) {
    const cam = this.game.cam;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    out.set(0, 0, 0);
    if (hs > 5) out.addScaledVector(_a.set(this.vel.x, 0, this.vel.z).normalize(), 0.9);
    out.addScaledVector(cam.forward, hs > 5 ? 0.5 : 1);
    const wish = cam.moveVector(input.move, _b);
    if (wish.lengthSq() > 0.01) out.addScaledVector(wish.normalize(), 0.9);
    if (out.lengthSq() < 1e-4) out.copy(cam.forward);
    out.y = 0; return out.normalize();
  }

  /** Pick a swing anchor: building edges/sides ahead and above. Returns {point, normal, score} or null. */
  findAnchor(heading, minRise = TUNE.swingMinRise) {
    return this._findAnchor(heading, minRise, 72) || this._findAnchor(heading, minRise, TUNE.anchorMax);
  }
  _findAnchor(heading, minRise, maxRay) {
    const phys = this.game.physics;
    const c = this._center(new THREE.Vector3());
    const base = Math.atan2(heading.x, heading.z);
    const elevs = [64, 52, 42, 33, 25];
    if (this.pos.y > 40) elevs.push(16);
    const yawOffs = [0, 0.28, -0.28, 0.6, -0.6, 0.95, -0.95];
    let best = null, bestScore = -Infinity;
    const dir = new THREE.Vector3(), pt = new THREE.Vector3();
    for (const eDeg of elevs) {
      const e = eDeg * Math.PI / 180;
      for (const yo of yawOffs) {
        const a = base + yo;
        dir.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
        const hit = phys.raycast(c, dir, maxRay, { ignoreGround: true });
        if (!hit || hit.normal.y < -0.5) continue;
        pt.copy(hit.point);
        let wall = Math.abs(hit.normal.y) < 0.5;
        // snap to the roof edge above a wall hit (web visibly lands on the building top)
        if (wall && hit.box) {
          const top = hit.box.max.y;
          if (top - pt.y < 28 && top > c.y + minRise) {
            const edge = _hp.set(pt.x, top + 0.1, pt.z).addScaledVector(hit.normal, 0.25);
            if (phys.lineOfSight(c, edge)) pt.copy(edge); else pt.addScaledVector(hit.normal, 0.25);
          } else pt.addScaledVector(hit.normal, 0.25);
        } else pt.addScaledVector(hit.normal, 0.25);
        const rise = pt.y - c.y;
        const dist = c.distanceTo(pt);
        const hd = Math.hypot(pt.x - c.x, pt.z - c.z);
        if (rise < minRise || dist < TUNE.anchorMin || hd < 5) continue;
        const maxLen = Math.min(dist * TUNE.ropeShorten, pt.y - TUNE.groundClear);
        if (maxLen < 9 || maxLen < dist * 0.62) continue;
        let score = Math.min(rise, 45) * 0.5 + (dist >= 18 && dist <= 55 ? 14 : -Math.abs(dist - 36) * 0.35);
        score -= Math.abs(yo) * 9;
        const nh = Math.abs(hit.normal.x * heading.x + hit.normal.z * heading.z);
        if (wall) score += (1 - nh) * 8;           // faces parallel to travel: swing along the street
        if (hit.box && pt.y > hit.box.max.y - 0.5) score += 8; // roof-edge bonus
        if (hd < dist * 0.4) score -= 6;             // too vertical
        if (score > bestScore) { bestScore = score; best = { point: pt.clone(), normal: hit.normal.clone(), score }; }
      }
    }
    // corner swing: when turning, grab the vertical edge of the building you are rounding
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 8 && (this.vel.x * heading.x + this.vel.z * heading.z) / hs < 0.93) {
      const corner = this._cornerAnchor(c, heading, minRise, maxRay);
      if (corner && corner.score > bestScore - 2) best = corner;
    }
    return best;
  }
  _cornerAnchor(c, heading, minRise, maxRay) {
    const phys = this.game.physics;
    const boxes = phys.query(c.x - maxRay, c.z - maxRay, c.x + maxRay, c.z + maxRay);
    let best = null, bs = -Infinity;
    const pt = new THREE.Vector3();
    for (const b of boxes) {
      const ty = b.data?.type;
      if (ty === 'prop' || ty === 'water') continue;
      const top = b.max.y;
      if (top < c.y + minRise + 3 || top < 14) continue;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      for (let k = 0; k < 4; k++) {
        const px = k & 1 ? b.max.x : b.min.x, pz = k & 2 ? b.max.z : b.min.z;
        const ox = Math.sign(px - cx) || 1, oz = Math.sign(pz - cz) || 1;
        const ax = px + ox * 0.45, az = pz + oz * 0.45, ay = Math.min(top + 0.1, c.y + 36);
        const dx = ax - c.x, dz = az - c.z, hd = Math.hypot(dx, dz);
        if (hd < 8 || hd > maxRay) continue;
        const cos = (dx * heading.x + dz * heading.z) / hd;
        if (cos < 0.5) continue;
        const rise = ay - c.y, dist = Math.hypot(hd, rise);
        if (rise < minRise || dist < TUNE.anchorMin) continue;
        const maxLen = Math.min(dist * TUNE.ropeShorten, ay - TUNE.groundClear);
        if (maxLen < 9 || maxLen < dist * 0.62) continue;
        pt.set(ax, ay, az);
        if (!phys.lineOfSight(c, pt)) continue;
        const score = Math.min(rise, 45) * 0.5 + (dist >= 18 && dist <= 55 ? 14 : -Math.abs(dist - 36) * 0.35) + cos * 10 + 14;
        if (score > bs) { bs = score; best = { point: pt.clone(), normal: new THREE.Vector3(ox, 0, oz).normalize(), score }; }
      }
    }
    return best;
  }

  // ===========================================================================
  //  MAIN ABILITY UPDATE
  // ===========================================================================
  updateAbilities(dt, input) {
    const g = this.game;
    this.customMovement = true;
    this.airT = this.onGround ? 0 : this.airT + dt;
    this.groundT = this.onGround ? 0 : this.groundT + dt;
    if (!this.onGround && !input.down('jump')) this.jumpArmed = true;
    if (this.onGround) this.jumpArmed = false;
    this.swingLock = Math.max(0, this.swingLock - dt);
    this.swingTry = Math.max(0, this.swingTry - dt);
    this.reattach = Math.max(0, this.reattach - dt);
    this.wallLock = Math.max(0, this.wallLock - dt);
    this.perchT = Math.max(0, this.perchT - dt);
    this.rollT = Math.max(0, this.rollT - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.vaultT = Math.max(0, this.vaultT - dt);
    this.atkReset = Math.max(0, this.atkReset - dt);
    this.shootT = Math.max(0, this.shootT - dt);
    this.trickT = this.onGround ? 0 : Math.max(0, this.trickT - dt);
    if (this.counterT > 0) { this.counterT -= dt; if (this.counterT <= 0) { this.counterTarget = null; g.hud?.prompt?.('attack', ''); } }
    if (this.atkReset <= 0 && !this.atk) this.atkStep = 0;
    this.dodgeAge += dt;
    this._pose = null;
    this._tickTasks(dt);
    this.gadgets.update(dt);
    this._updateSense(dt);
    this._updateAimState(dt, input);

    if (this.state !== 'ult') {
      if (this.pressedAbility2()) this._toggleSuit();
      if (input.pressed('ultimate') && this.focus >= 100) this._startUltimate();
      else if (input.pressed('dodge')) this._startDodge(input);
    }

    // dodge keeps control briefly
    if (this.dodgeT > 0) this._updateDodge(dt);

    switch (this.state) {
      case 'free': this._updateFree(dt, input); break;
      case 'swing': this._updateSwing(dt, input); break;
      case 'wall': this._updateWall(dt, input); break;
      case 'zip': this._updateZip(dt, input); break;
      case 'glide': this._updateGlide(dt, input); break;
      case 'ult': this._updateUltimate(dt); break;
    }
    this._updateFov(dt);
    this._preVy = this.vel.y;
  }

  // ---- AIM (Spider-Man 2 web-shooter aim) -------------------------------------
  _updateAimState(dt, input) {
    const g = this.game;
    // own edge detection for the gadget-cycle inputs (consume() would make `pressed` fire every frame)
    const e = this._edge;
    const ab = input.down('ability'), wn = input.down('weaponNext'), wp = input.down('weaponPrev');
    e.ab = ab && !e.abPrev; e.wn = wn && !e.wnPrev; e.wp = wp && !e.wpPrev;
    e.abPrev = ab; e.wnPrev = wn; e.wpPrev = wp;

    const canAim = this.aiming && (this.state === 'free' || this.state === 'wall' || this.state === 'swing' || this.state === 'glide') && !this.dead;
    if (this.aiming && !canAim) g.cam._aimReq = null; // zip / ultimate: no zoom
    this.consumesWeaponWheel = canAim;
    if (canAim && !this._xh) { g.hud?.setCrosshair?.('web'); this._xh = true; }
    if (!canAim && this._xh) { g.hud?.setCrosshair?.(null); this._xh = false; }
    if (canAim && !this._wasAim) { this.hand = 0; this._play('ui_move', { volume: 0.4, pitch: 1.5 }); }
    this._wasAim = canAim;
    this.aimPitch = g.cam.pitch;
    if (!canAim) { this.aimEnemy = null; return; }
    // tighter zoom when a target is under the reticle
    const ray = this.gadgets.aimRay(120);
    this.aimEnemy = ray.enemy;
    const want = ray.enemy ? this.aimPreset.fov - 8 : this.aimPreset.fov;
    this.aimFov = THREE.MathUtils.damp(this.aimFov, want, 10, dt);
    g.cam.requestAim({ ...this.aimPreset, fov: this.aimFov });
  }

  _aimUpdate(dt, input) {
    const G = this.gadgets, e = this._edge;
    if (e.ab || e.wn) G.cycle(1);
    if (e.wp) G.cycle(-1);
    input.consume('ability', 'weaponNext', 'weaponPrev');
    this.hand = 0;
    const pressed = this.firePressed(), held = this.fireDown();
    if (pressed || held) {
      if (G.tryFire(pressed, held) && this.onGround) {
        // a little recoil step so the shot has weight
        this.vel.x *= 0.6; this.vel.z *= 0.6;
      }
    }
  }

  // ---- FREE (ground + air) ---------------------------------------------------
  _updateFree(dt, input) {
    this.gravityScale = 1;
    const aiming = this.aiming;
    const busy = this.atk || this.lash || this.dodgeT > 0 || this.spin;
    if (this.onGround) this.aimAirT = 0;
    if (aiming) {
      this._aimUpdate(dt, input);
      // aerial aim: gravity drops to 30% for up to 1.5 s (SM2 air tricks)
      if (!this.onGround && this.aimAirT < 1.5) {
        this.aimAirT += dt; this.gravityScale = 0.3;
        if (this.vel.y < -6) this.vel.y = approach(this.vel.y, -6, 60 * dt);
      }
    }

    if (!aiming) {
      if (input.pressed('ability') && this._tryZip(input)) return;
      if (input.down('swing') && this.swingLock <= 0 && this.reattach <= 0 && this.swingTry <= 0 && !this.dodgeT && !this.spin && !this.sling) {
        this.swingTry = 0.1;
        if (this._tryStartSwing(input)) return;
      }
      if (this.wallLock <= 0 && this.vaultT <= 0 && this.onWall && !this.dodgeT && this._canWall(input)) { this._enterWall(); return; }

      // Web Wings
      if (!this.onGround && !busy && this.airT > 0.25 && this.vel.y < -1 &&
          (input.pressed('jump') || (input.down('jump') && this.jumpArmed)) && this._groundDist() > 3) {
        this.state = 'glide'; this.glideSpeed = Math.max(Math.hypot(this.vel.x, this.vel.z), 12); this._play('whoosh');
        return;
      }
    }

    this._combatInputs(dt, input);
    this._locomote(dt, input, busy);
  }

  _locomote(dt, input, busy) {
    const wish = this._wish(input, _w);
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const aiming = this.aiming;
    const sprint = input.down('sprint') && !aiming;
    const topSpeed = aiming ? TUNE.aimWalk : (sprint ? TUNE.sprint : (mag > 0.95 && this.game.settings?.autoSprint !== false ? TUNE.run : TUNE.walk));
    const target = topSpeed * mag * (this.symbiote ? 1.08 : 1);
    const rolling = this.rollT > 0;
    const charging = this.charging || this.sling;

    if (this.dodgeT > 0 || this.perchT > 0.2) {
      // handled elsewhere / short stun
    } else if (this.spin) {
      // arm spin owns the velocity
    } else if (this.atk || this.lash || charging) {
      if (this.onGround) { this.vel.x = approach(this.vel.x, 0, 45 * dt); this.vel.z = approach(this.vel.z, 0, 45 * dt); }
    } else if (this.onGround) {
      const accel = hs > target + 1 ? 16 : 70;
      if (rolling) { /* keep momentum through the roll */ this.vel.x = approach(this.vel.x, 0, 6 * dt); this.vel.z = approach(this.vel.z, 0, 6 * dt); }
      else {
        this.vel.x = approach(this.vel.x, wish.x * target, accel * dt);
        this.vel.z = approach(this.vel.z, wish.z * target, accel * dt);
      }
      if (aiming) { /* base class turns us toward the camera */ }
      else if (mag > 0.01 && !rolling) this.faceTowards(wish, dt, 14);
      else if (rolling && hs > 2) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 10);
    } else {
      // air: steer without killing swing momentum
      const cap = Math.max(hs, aiming ? TUNE.aimWalk : TUNE.run);
      if (mag > 0.01) {
        this.vel.x += wish.x * 16 * mag * dt; this.vel.z += wish.z * 16 * mag * dt;
        const nh = Math.hypot(this.vel.x, this.vel.z);
        if (nh > cap) { this.vel.x *= cap / nh; this.vel.z *= cap / nh; }
      }
      if (hs > 20 && this.boostT <= 0) { const k = 1 - 0.12 * dt; this.vel.x *= k; this.vel.z *= k; }
      const fh = Math.hypot(this.vel.x, this.vel.z);
      if (fh > 3 && !aiming) this.faceTowards(_a.set(this.vel.x, 0, this.vel.z), dt, 8);
      if (this.atk?.air) this.vel.y = approach(this.vel.y, 0.6, 40 * dt);
    }

    // jump (coyote time) / slingshot launch when perched
    if (!this._slingUpdate(dt, input, mag)) {
      if (input.pressed('jump') && (this.onGround || this.groundT < 0.1) && !this.atk && this.dodgeT <= 0 && !this.spin) this._jump();
    }

    // animation
    if (!this.atk && !this.lash && this.dodgeT <= 0 && !this.spin && !this.charging) {
      const h2 = Math.hypot(this.vel.x, this.vel.z);
      if (this.sling) this.setAnim('charge', 1);
      else if (this.shootT > 0 && (this.aiming || !this.onGround || h2 < 4)) { if (this.anim.state !== 'shoot') this.setAnim('shoot', 1); }
      else if (aiming) this.setAnim('aim', h2);
      else if (this.trickT > 0) this.setAnim('dodge', 14);
      else if (this.perchT > 0) this.setAnim('land', 0);
      else if (this.onGround) {
        if (this.rollT > 0) this.setAnim('land', h2);
        else if (this._perching(dt, mag, h2)) this.setAnim('perch', 0);
        else this.setAnim(h2 > 0.6 ? (h2 > TUNE.walk + 1.5 ? 'sprint' : 'run') : 'idle', h2);
      } else this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', h2);
      if (this.trickT > 0) {
        const k = 1 - this.trickT / 0.75;
        this._leanPose(_a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), k * Math.PI * 2 * this.trickDir, 0, 30);
      } else if (!aiming && !this.onGround && h2 > 14 && this.vel.y < 6) this._leanPose(_a.set(this.vel.x, 0, this.vel.z), 0.35, 0, 6);
    } else if (this.charging) this.setAnim('charge', 1);
    if (mag > 0.1 || this.aiming || this.airT > 0.15) { this.stillT = 0; this.ledgePerch = false; }
  }

  /** SM2 spider-crouch: standing still > 0.6 s with a >3 m drop a step away, or right after a ledge zip. */
  _perching(dt, mag, h2) {
    if (mag > 0.1) { this.stillT = 0; this.ledgePerch = false; return false; }
    if (h2 > 0.6 && !this.ledgePerch) { this.stillT = 0; return false; }
    this.stillT += dt;
    this.edgeT -= dt;
    if (this.edgeT <= 0) { // re-probe the surroundings a few times a second
      this.edgeT = 0.2; this.nearEdge = false;
      const ph = this.game.physics, x = this.pos.x, z = this.pos.z, y = this.pos.y;
      for (let i = 0; i < 4 && !this.nearEdge; i++) {
        const a = this.yaw + i * Math.PI / 2;
        if (y - ph.heightAt(x + Math.sin(a) * 1.0, z + Math.cos(a) * 1.0, y + 0.6) > 3) this.nearEdge = true;
      }
    }
    return this.ledgePerch || (this.stillT > 0.6 && this.nearEdge);
  }

  _jump() {
    this.vel.y = TUNE.jump; this.onGround = false; this.groundT = 1; this._play('jump'); this.rollT = 0;
  }

  /** Perched on a rooftop and standing still: hold jump to crouch/charge, release to slingshot. Returns true while it owns jump. */
  _slingUpdate(dt, input, mag) {
    const perched = this.onGround && !this.aiming && !this.atk && !this.lash && this.dodgeT <= 0 && !this.spin &&
      this.groundContact && this.groundContact.data?.type !== 'prop' && this.groundContact.max.y > 6 && mag < 0.1;
    if (!this.sling) {
      if (perched && input.pressed('jump')) this.sling = { t: 0 };
      else { this.slingK = Math.max(0, this.slingK - dt * 4); return false; }
    }
    const S = this.sling;
    if (!this.onGround || mag > 0.3 || this.aiming) { this.sling = null; if (this.onGround) this._jump(); return false; }
    if (!input.down('jump')) {
      this.sling = null;
      if (S.t < TUNE.slingMin) this._jump(); else this._slingLaunch(S.t / TUNE.slingMax);
      return true;
    }
    S.t = Math.min(TUNE.slingMax, S.t + dt);
    this.slingK = S.t / TUNE.slingMax;
    this.vel.x = approach(this.vel.x, 0, 40 * dt); this.vel.z = approach(this.vel.z, 0, 40 * dt);
    if (S.t > TUNE.slingMin && Math.random() < dt * 14) this._fx('burst', this.pos.clone().setY(this.pos.y + 0.2), 0xffffff, 2, 2, 0.3, 0.1);
    if (this.slingK > 0.97 && !S.full) { S.full = true; this._play('ui_move', { pitch: 1.8, volume: 0.5 }); this._rumble(0.2, 0.4, 60); }
    this.game.cam.shake(0.01 + this.slingK * 0.03);
    return true;
  }
  _slingLaunch(charge, wallN = null) {
    const dir = this.game.cam.aimDirection(new THREE.Vector3());
    if (dir.y < 0.4) { dir.y = 0.4; dir.normalize(); }
    const sp = TUNE.slingSpeed + TUNE.slingBonus * clamp(charge, 0, 1);
    this.vel.copy(dir).multiplyScalar(sp);
    if (wallN) this.vel.addScaledVector(wallN, 4);
    this.state = 'free'; this.onGround = false; this.groundT = 1; this.boostT = 0.8; this.gravityScale = 1; this.wallLock = 0.3; this.jumpArmed = false;
    this.yaw = Math.atan2(dir.x, dir.z); this.atk = null;
    this.setAnim('jump', sp); this._play('zip'); this._play('whoosh'); this._rumble(0.6, 0.4, 140); this.game.cam.shake(0.3);
    this._fx('burst', this.pos.clone().setY(this.pos.y + 0.3), 0xffffff, 24, 8, 0.5, 0.2);
    this._fx('ring', this.pos.clone().setY(this.pos.y + 0.1), 3, 0xffffff, 0.35);
    this._fx('text', _a.set(this.pos.x, this.pos.y + 2.4, this.pos.z), 'SLINGSHOT', 0xffffff, { size: 0.9, life: 0.6 });
    this.slingK = 0;
  }

  onLand() {
    const vy = this._preVy;
    if (this.state === 'free' || this.state === 'glide') {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (vy < -17 && hs > 4) { this.rollT = 0.5; this._play('land'); this.game.cam.shake(0.25); this._rumble(0.5, 0.3, 120); this._fx('burst', this.pos.clone().setY(this.pos.y + 0.1), 0xbbbbbb, 12, 4); }
      else if (vy < -17) { this.perchT = 0.35; this._play('land'); this.game.cam.shake(0.2); }
      else if (vy < -7) this._play('land');
    }
    this.trickT = 0;
    if (this.slam) P.landSlam(this);
  }

  // ---- SWING -----------------------------------------------------------------
  _tryStartSwing(input, headingOverride) {
    const heading = headingOverride ?? this._swingHeading(input, new THREE.Vector3());
    const a = this.findAnchor(heading);
    if (!a) return false;
    this._attachSwing(a, heading);
    return true;
  }

  _attachSwing(a, heading) {
    this.anchor.copy(a.point);
    const c = this._center(_c);
    const d = c.distanceTo(this.anchor);
    this.ropeLen = d;
    this.ropeTarget = clamp(Math.min(d * TUNE.ropeShorten, this.anchor.y - TUNE.groundClear), 9, 200);
    this.swingT = 0; this.state = 'swing'; this.hand ^= 1; this.atk = null; this.lash = null; this.spin = null; this.sling = null;
    this.wallLock = 0; this.aimAirT = 0;
    this.lines.swing.begin(1);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround || hs < 8) {
      // launch hop toward the anchor
      this.vel.x += heading.x * 6; this.vel.z += heading.z * 6; this.vel.y = Math.max(this.vel.y, 7);
      this.onGround = false;
    }
    this.setAnim('swing', hs);
    this._play('thwip'); this._rumble(0.2, 0.15, 60);
    this._fx('burst', this.anchor.clone(), 0xffffff, 6, 3, 0.3, 0.15);
  }

  _endSwing(boost) {
    this.state = 'free'; this.lines.swing.hide(); this.gravityScale = 1;
    if (boost) {
      const hv = _a.set(this.vel.x, 0, this.vel.z); const hs = hv.length();
      if (hs > 1) {
        hv.multiplyScalar(1 / hs);
        const r = _b.copy(this._center(_c)).sub(this.anchor); const ahead = clamp((r.x * hv.x + r.z * hv.z) / Math.max(1, r.length()), 0, 1);
        // release boost: the later in the arc (more "ahead" of the anchor) the harder the fling
        if (ahead > 0.15 && this.vel.y > -2) { this.vel.addScaledVector(hv, 3 + 8 * ahead); this.vel.y += 3 + 6 * ahead; this.boostT = Math.max(this.boostT, 0.25); }
      }
    }
    this.swingLock = 0;
  }

  _updateSwing(dt, input) {
    this.gravityScale = 0; this.swingT += dt;
    const cam = this.game.cam;
    const c = this._center(_c);
    const hs = Math.hypot(this.vel.x, this.vel.z);

    // aiming drops the web (aerial aim takes over)
    if (this.aiming) { this._endSwing(true); this.swingLock = 0.2; return; }

    // point launch
    if (input.pressed('jump')) {
      this.vel.y = Math.max(this.vel.y, 0) + TUNE.launchUp;
      this.vel.x *= 1.06; this.vel.z *= 1.06;
      this._endSwing(false); this.swingLock = 0.35; this.jumpArmed = false;
      this._play('jump'); this._fx('burst', this.pos.clone(), 0xffffff, 10, 5); this._rumble(0.4, 0.2, 80);
      this.setAnim('jump', hs); this.boostT = 0.3;
      return;
    }
    if (!input.down('swing')) { this._endSwing(true); this._play('whoosh', { volume: 0.5 }); return; }
    if (input.pressed('ability') && this._tryZip(input)) { this.lines.swing.hide(); return; }

    // rope blocked by geometry? re-anchor or let go
    if (!this.game.physics.lineOfSight(c, this.anchor)) {
      const a = this.findAnchor(this._swingHeading(input, new THREE.Vector3()), 3);
      if (a) { this._attachSwing(a, this.forward); return; }
      this._endSwing(false); this.swingLock = 0.2; return;
    }
    if (this.onWall && this.swingT > 0.25 && this.vel.length() < (this._swingSp || 0) * 0.65) { this._endSwing(false); this.reattach = 0.05; return; }
    this._swingSp = this.vel.length();
    if (this.onGround && this.swingT > 0.4) { this._endSwing(false); this.reattach = 0.1; return; }

    // gravity
    this.vel.y -= TUNE.swingGravity * dt;

    // steering + bottom-of-arc pump
    const wish = this._wish(input, _w);
    const r = _a.copy(c).sub(this.anchor); const d = Math.max(0.01, r.length()); const n = _b.copy(r).multiplyScalar(1 / d);
    if (wish.lengthSq() > 0.01) {
      wish.addScaledVector(n, -wish.dot(n));
      this.vel.addScaledVector(wish, TUNE.swingSteer * dt);
    }
    const sp0 = this.vel.length();
    if (this.vel.y < 0.5 && sp0 > 1 && sp0 < TUNE.swingMax) {
      // descending: speed boost (more at the bottom)
      const depth = clamp((c.y - (this.anchor.y - this.ropeLen)) / this.ropeLen, 0, 1);
      this.vel.addScaledVector(_d.copy(this.vel).multiplyScalar(1 / sp0), TUNE.swingPump * (1 - depth * 0.6) * dt);
    }

    // rope length: reel toward target, never let the arc touch the ground
    const lenCap = this.anchor.y - TUNE.groundClear;
    this.ropeTarget = Math.min(this.ropeTarget, lenCap);
    this.ropeLen = approach(this.ropeLen, Math.max(7, this.ropeTarget), (this.ropeTarget < lenCap - 0.01 ? TUNE.swingReel : 28) * dt);
    if (this.ropeLen < 7.5 && this.swingT > 0.3) { this._endSwing(true); return; }

    // constraint (predictive, energy-preserving)
    if (d >= this.ropeLen - 0.05) { const vr = this.vel.dot(n); if (vr > 0) this.vel.addScaledVector(n, -vr); }
    let sp = this.vel.length();
    if (sp > TUNE.swingMax) { this.vel.multiplyScalar(TUNE.swingMax / sp); sp = TUNE.swingMax; }
    if (dt > 1e-5) {
      const cn = _d.copy(c).addScaledVector(this.vel, dt);
      const r2 = _hp.copy(cn).sub(this.anchor); const d2 = r2.length();
      if (d2 > this.ropeLen) {
        r2.multiplyScalar(this.ropeLen / d2); cn.copy(this.anchor).add(r2);
        this.vel.copy(cn).sub(c).multiplyScalar(1 / dt);
        const sp2 = this.vel.length();
        const keep = d >= this.ropeLen - 0.8 ? Math.max(sp, 0) : sp2;
        if (sp2 > 1e-3 && keep > sp2) this.vel.multiplyScalar(Math.min(keep, TUNE.swingMax) / sp2);
        if (this.vel.length() > TUNE.swingMax) this.vel.setLength(TUNE.swingMax);
      }
    }

    // auto-release late in the arc while the button is still held, then chain
    const hv = _a.set(this.vel.x, 0, this.vel.z); const hlen = hv.length();
    if (hlen > 3 && this.swingT > 0.5) {
      hv.multiplyScalar(1 / hlen);
      const rr = _b.copy(c).sub(this.anchor);
      const ahead = (rr.x * hv.x + rr.z * hv.z) / Math.max(1, rr.length());
      if ((ahead > 0.55 && this.vel.y > 0.5) || this.swingT > 4.5) {
        this._endSwing(true); this.reattach = 0.14; this._play('whoosh', { volume: 0.6 });
        return;
      }
    }

    // facing / visuals state
    if (hlen > 2) this.yaw += angDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 10 * dt);
    this.setAnim('swing', this.vel.length());
    const toA = _c.copy(this.anchor).sub(c).normalize();
    _d.set(this.vel.x, 0, this.vel.z);
    this._setPoseSwing(toA, _d);
    if (this.swingT % 0.6 < dt) this._play('swing', { volume: 0.4, pitch: 0.8 + sp / 90 });
  }
  _setPoseSwing(toAnchor, hdir) {
    // hang from the rope: body "up" leans toward the anchor, head leads travel
    _y.copy(UP).multiplyScalar(0.55).addScaledVector(toAnchor, 0.45);
    this._setPose(hdir.lengthSq() > 0.01 ? hdir : _z.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), _y, 9);
  }

  // ---- WALL ------------------------------------------------------------------
  _canWall(input) {
    if (this.wallNormal.lengthSq() < 0.1) return false;
    const box = this.wallContact ?? this.lastContact;
    if (box && box.data?.type === 'prop') return false;
    if (box && box.max.y < this.pos.y + 2.5) return false;
    const wish = this._wish(input, _w); const m = wish.length();
    if (m > 0.3) {
      const into = -wish.dot(this.wallNormal) / m;
      if (into > 0.5) return true;
    }
    return false;
  }
  _enterWall() {
    this.state = 'wall'; this.wallN.copy(this.wallNormal).setY(0).normalize(); this.wallLost = 0; this._wallBox = this.wallContact; this._wallK = 0; (this._wallUp ||= new THREE.Vector3()).copy(UP);
    this.atk = null; this.lash = null; this.spin = null; this.lines.swing.hide(); this.aimAirT = 0;
    // convert some momentum into climbing speed
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.vel.y = Math.max(this.vel.y, Math.min(sp * 0.6, 12));
    this.setAnim('wallrun', sp); this._play('land', { volume: 0.4 });
  }
  _leaveWall() {
    this.state = 'free'; this.wallLock = 0.25; this.gravityScale = 1; this.sling = null;
    this.yaw = Math.atan2(this.wallN.x, this.wallN.z);
  }
  _updateWall(dt, input) {
    this.gravityScale = 0;
    const cam = this.game.cam;
    if (this.onWall) { this.wallN.lerp(_a.copy(this.wallNormal).setY(0), 0.5).normalize(); this.wallLost = 0; } else this.wallLost += dt;
    const n = this.wallN;
    const aimHold = this.aiming;
    if (aimHold) this._aimUpdate(dt, input);

    // jump: wall jump, or (idle on the wall) hold to charge a slingshot launch
    const wishJ = this._wish(input, _w);
    const idle = wishJ.length() < 0.1;
    let jumpNow = false;
    if (this.sling) {
      if (!input.down('jump')) {
        const S = this.sling; this.sling = null;
        if (S.t < TUNE.slingMin) jumpNow = true;
        else { this._slingLaunch(S.t / TUNE.slingMax, n); this._leaveWall(); this.wallLock = 0.3; this.state = 'free'; return; }
      } else {
        this.sling.t = Math.min(TUNE.slingMax, this.sling.t + dt); this.slingK = this.sling.t / TUNE.slingMax;
        if (this.slingK > 0.97 && !this.sling.full) { this.sling.full = true; this._play('ui_move', { pitch: 1.8, volume: 0.5 }); this._rumble(0.2, 0.4, 60); }
        if (!idle) { this.sling = null; jumpNow = true; }
      }
    } else if (input.pressed('jump')) {
      if (idle && !aimHold) this.sling = { t: 0 }; else jumpNow = true;
    }
    if (jumpNow) {
      const wish = this._wish(input, _w);
      this.vel.set(n.x * TUNE.wallJumpOut, TUNE.wallJumpUp, n.z * TUNE.wallJumpOut);
      this.vel.addScaledVector(wish, 3);
      this._leaveWall(); this.jumpArmed = false; this._play('jump'); this._fx('burst', this.pos.clone(), 0xffffff, 8, 4);
      this.setAnim('jump', 10); return;
    }
    if (!aimHold && !this.sling) {
      if (input.down('swing') && this.swingTry <= 0) {
        this.swingTry = 0.1;
        // swing off the wall: aim away from it, biased by the camera
        const hd = _b.copy(cam.forward).addScaledVector(this._wish(input, _c), 0.5).addScaledVector(n, 0.35); hd.y = 0; hd.normalize();
        if (this._tryStartSwing(input, hd.clone())) return;
      }
      if (input.pressed('ability') && this._tryZip(input)) return;
    }
    this._combatInputs(dt, input, false);

    const wish = this._wish(input, _w); const mag = Math.min(1, wish.length());
    const t = _a.set(-n.z, 0, n.x);
    let up = mag > 0.05 ? clamp(-wish.dot(n), -1, 1) : 0;
    let side = mag > 0.05 ? wish.dot(t) : 0;
    if (mag > 0.05 && Math.abs(up) < 0.35 && Math.abs(side) < 0.35) { up = 0; side = 0; }
    if (aimHold || this.sling) { up = 0; side = 0; }
    const speed = input.down('sprint') ? TUNE.wallSprint : this.symbiote ? TUNE.wallSymbiote : TUNE.wallSpeed;
    const tx = t.x * side * speed, tz = t.z * side * speed, ty = up * speed;
    const acc = 70 * dt;
    const stick = this.onWall ? 2.5 : 7;
    this.vel.x = approach(this.vel.x, tx - n.x * stick, acc); this.vel.z = approach(this.vel.z, tz - n.z * stick, acc);
    this.vel.y = approach(this.vel.y, ty, acc);

    const box = this.wallContact ?? this._wallBox ?? this.lastContact;
    if (this.wallContact) this._wallBox = this.wallContact;
    // vault over the roof edge
    if (box && box.data?.type !== 'prop' && this.vel.y > 1 && this.pos.y + 0.75 >= box.max.y && up > 0.15) {
      this.vel.set(-n.x * 5.5, 6.5, -n.z * 5.5);
      this.state = 'free'; this.vaultT = 0.5; this.wallLock = 0.5; this.gravityScale = 1; this.sling = null;
      this.yaw = Math.atan2(-n.x, -n.z); this.setAnim('jump', 6); this._play('whoosh', { volume: 0.5 });
      return;
    }
    if (this.onGround && up < -0.1) { this.state = 'free'; this.wallLock = 0.3; this.gravityScale = 1; this.sling = null; return; }
    if (this.wallLost > 0.15) { this._leaveWall(); return; }

    // speed along the wall plane (ignores the stick-to-wall component)
    const vn = this.vel.x * n.x + this.vel.z * n.z;
    _a.set(this.vel.x - n.x * vn, this.vel.y, this.vel.z - n.z * vn);
    const sp = _a.length();
    if (this.sling) this.setAnim('charge', 1);
    else if (this.shootT > 0) { if (this.anim.state !== 'shoot') this.setAnim('shoot', 1); }
    else this.setAnim(sp > 1.2 ? 'wallrun' : 'wallidle', sp);
    this.yaw = Math.atan2(-n.x, -n.z);
    // chest to the wall; head points along the direction of travel (world-up when still / climbing straight up)
    const wu = this._wallUp || (this._wallUp = new THREE.Vector3(0, 1, 0));
    if (sp > 2.5) {
      _a.multiplyScalar(1 / sp);
      if (_a.y < -0.25) { _a.y = -0.25; _a.normalize(); }
      wu.lerp(_a, 1 - Math.exp(-7 * dt)).normalize();
    } else wu.lerp(UP, 1 - Math.exp(-5 * dt)).normalize();
    this._setPose(_b.copy(n).negate(), wu, 11);
  }

  // ---- ZIP -------------------------------------------------------------------
  _tryZip(input) {
    if ((this.cooldowns.zip || 0) > 0) return false;
    const phys = this.game.physics, cam = this.game.cam;
    const origin = _hp2.copy(this.game.camera.position);
    const dir = cam.aimDirection(new THREE.Vector3());
    const hit = phys.raycast(origin, dir, TUNE.zipRange + 14);
    let ok = false;
    const c = this._center(_c);
    if (hit && hit.point.distanceTo(c) <= TUNE.zipRange && hit.point.distanceTo(c) > 3) {
      const nrm = hit.normal;
      this.zipHit.copy(hit.point);
      if (Math.abs(nrm.y) < 0.5 && hit.box) {
        const top = hit.box.max.y;
        if (top - hit.point.y < 9 && hit.box.data?.type !== 'prop') {
          // ledge: climb onto the roof edge
          this.zipKind = 'ledge';
          this.zipTarget.set(hit.point.x - nrm.x * 1.1, top + 0.1, hit.point.z - nrm.z * 1.1);
          this.zipN.copy(nrm).setY(0).normalize();
          // aim a little over the edge first so we don't scrape the wall on the way up
          this.zipHit.set(hit.point.x, top, hit.point.z);
        } else {
          this.zipKind = 'wall';
          this.zipTarget.copy(hit.point).addScaledVector(nrm, this.radius + 0.02).y -= 0.9;
          this.zipN.copy(nrm).setY(0).normalize();
        }
        ok = true;
      } else if (nrm.y >= 0.5) {
        this.zipKind = 'ground'; this.zipTarget.copy(hit.point).y += 0.05; ok = true;
      }
    }
    if (!ok) {
      // zip boost in free air
      return useZipBoost(this);
    }
    this.useCooldown('zip', 0.8);
    this.state = 'zip'; this.zipT = 0; this.zipSpeed = Math.max(18, this.vel.length() * 0.7); this.zipStuck = 0;
    this._zipLast.copy(this.pos); this.atk = null; this.lash = null; this.spin = null; this.sling = null; this.lines.swing.hide();
    this.hand ^= 1; this.setAnim('zip', 20);
    this.lines.zip.begin(0.9);
    this._play('zip'); this._rumble(0.3, 0.2, 80);
    return true;
  }

  _updateZip(dt, input) {
    this.gravityScale = 0; this.zipT += dt;
    if (input.pressed('jump')) { // bail out with a hop
      this.vel.y = Math.max(this.vel.y, 0) + 8; this.state = 'free'; this.lines.zip.hide(); this.jumpArmed = false; return; }
    const to = _a.copy(this.zipTarget).sub(this.pos); const dist = to.length();
    if (dist < 1.1 || this.zipT > 1.6) { this._finishZip(); return; }
    this.zipSpeed = approach(this.zipSpeed, TUNE.zipSpeed, 150 * dt);
    const sp = Math.min(this.zipSpeed, Math.max(6, dist / Math.max(dt, 1e-3) * 0.9));
    to.multiplyScalar(1 / dist);
    this.vel.copy(to).multiplyScalar(sp);
    if (Math.hypot(this.vel.x, this.vel.z) > 1) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    // stuck detection (scraping geometry)
    if (this.zipT > 0.3) {
      this.zipStuck += this.pos.distanceTo(this._zipLast) < sp * dt * 0.25 ? dt : -dt * 2;
      if (this.zipStuck > 0.25) { this._finishZip(); return; }
    }
    this._zipLast.copy(this.pos);
    this.setAnim('zip', sp);
    this._leanPose(to, 1.0, 0, 12);
  }
  _finishZip() {
    this.lines.zip.hide();
    const kind = this.zipKind;
    this.state = 'free'; this.gravityScale = 1;
    const dir = _a.copy(this.vel); const sp = dir.length();
    if (kind === 'ledge') {
      this.vel.set(-this.zipN.x * 3, 2, -this.zipN.z * 3); this.perchT = 0.35; this.ledgePerch = true; this.yaw = Math.atan2(-this.zipN.x, -this.zipN.z);
      this._play('land', { volume: 0.5 });
    } else if (kind === 'wall') {
      this.wallNormal.copy(this.zipN); this.wallN.copy(this.zipN);
      this.vel.set(-this.zipN.x * 2, 0, -this.zipN.z * 2);
      this.state = 'wall'; this.wallLost = -0.6; this.setAnim('wallidle', 0); this.atk = null;
    } else {
      this.vel.multiplyScalar(sp > 16 ? 16 / sp : 1);
    }
  }

  // ---- GLIDE (Web Wings) -----------------------------------------------------
  _updateGlide(dt, input) {
    this.gravityScale = 0;
    if (this.aiming) { this.state = 'free'; this.gravityScale = 1; this.jumpArmed = false; return; }
    if (input.down('swing') && this.swingTry <= 0) {
      this.swingTry = 0.1;
      if (this._tryStartSwing(input)) return;
    }
    if (input.pressed('ability') && this._tryZip(input)) return;
    if (!input.down('jump') || this.onGround) { this.state = 'free'; this.gravityScale = 1; this.jumpArmed = false; return; }
    if (this.onWall && this.wallLock <= 0 && this._canWall(input)) { this._enterWall(); return; }
    this._combatInputs(dt, input, false);

    const wish = this._wish(input, _w); const mag = Math.min(1, wish.length());
    let turn = 0;
    // stick back = boost dive (trade height for speed), stick forward after a dive = pull up
    const dive = input.move.y < -0.45;
    const boost = input.down('sprint');
    if (mag > 0.1 && !dive) {
      const want = Math.atan2(wish.x, wish.z); const d = angDiff(this.yaw, want);
      turn = clamp(d, -TUNE.glideTurn * dt, TUNE.glideTurn * dt); this.yaw += turn;
    } else if (dive && Math.abs(input.move.x) > 0.2) {
      turn = -input.move.x * TUNE.glideTurn * 0.6 * dt; this.yaw += turn;
    }
    const topSpeed = dive ? TUNE.diveSpeed : boost ? TUNE.glideSpeed * 1.5 : TUNE.glideSpeed;
    this.glideSpeed = approach(this.glideSpeed, topSpeed, (this.glideSpeed > topSpeed ? 5 : dive ? 22 : 9) * dt);
    this.vel.x = Math.sin(this.yaw) * this.glideSpeed; this.vel.z = Math.cos(this.yaw) * this.glideSpeed;
    let fall = dive ? TUNE.diveFall : TUNE.glideFall;
    if (!dive && this.glideSpeed > TUNE.glideSpeed + 4 && input.move.y > 0.3) fall = 3 + (this.glideSpeed - TUNE.glideSpeed) * 0.25; // pull up: bleed speed into lift
    this.vel.y = approach(this.vel.y, fall, (dive ? 40 : 22) * dt);
    if (!dive && fall > 0) this.glideSpeed = Math.max(TUNE.glideSpeed, this.glideSpeed - 6 * dt);
    this.setAnim('glide', this.glideSpeed);
    this._leanPose(_a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), dive ? 1.45 : 1.05, clamp(-turn / Math.max(dt, 1e-3) * 0.25, -0.5, 0.5), 8);
    if (dive && Math.random() < 0.5) this._fx('burst', this.pos.clone().setY(this.pos.y + 1), 0xffffff, 1, 1, 0.2, 0.08);
  }

  // ===========================================================================
  //  COMBAT
  // ===========================================================================
  _dmgMul() { return this.symbiote ? TUNE.symDamage : 1; }

  _aimTarget(range, cone) {
    return this.game.enemies?.findTarget?.(this._center(new THREE.Vector3()), this.game.cam.forward, range, cone) ?? null;
  }

  _combatInputs(dt, input, melee = true) {
    if (this.lash) this._updateLash(dt);
    if (this.spin && !P.updateSpin(this, dt)) { /* finished */ }
    if (this.atk) this._updateAttack(dt, input);
    else if (melee && input.pressed('attack') && this.dodgeT <= 0 && this.rollT <= 0.2 && !this.spin && !this.sling && !this.charging) this._attackPressed(input);
    if (melee) this._holdAttack(dt, input);

    // special: classic = web shot (tap) / pull + throw (hold); symbiote = Strike (tap) / Tendril Tear (hold)
    const sdown = input.down('special');
    const tap = this._aimTap === 'special';
    if (sdown) this.holdSpecial += dt;
    const free = !this.atk && !this.lash && !this.spin;
    if (!this.symbiote) {
      if ((input.pressed('special') || tap) && free) this._webShot(input);
      if (sdown && this.holdSpecial > 0.4 && !this.pullUsed) this._webPull();
    } else {
      if (sdown && this.holdSpecial >= 0.45 && !this.pullUsed && free) { this.pullUsed = true; P.tendrilTear(this); }
      if ((tap || (input.released('special') && this.holdSpecial < 0.32 && !this.pullUsed)) && free) this._symStrike(input);
    }
    if (!sdown) { this.holdSpecial = 0; this.pullUsed = false; }
  }

  _attackPressed(input) {
    // PARRY counter window: next attack is a huge counter
    if (this.counterT > 0 && this.counterTarget?.alive && this._counterStrike()) return;
    // air trick: attack in mid-air with nobody nearby
    if (!this.onGround && !this.aiming && this.state === 'free' && !this._aimTargetNear(10) && this.airT > 0.12 && this.useCooldown('trick', 0.9)) { this._airTrick(); return; }
    this._startAttack(input);
  }

  _airTrick() {
    this.trickT = 0.75; this.trickDir = Math.random() < 0.5 ? -1 : 1;
    if (this.vel.y < 3) this.vel.y += 3;
    this.addFocus(8);
    this.setAnim('dodge', 14);
    this._play('whoosh', { pitch: 1.3 }); this._rumble(0.15, 0.2, 60);
    this._fx('text', _a.set(this.pos.x, this.pos.y + 2.4, this.pos.z), 'AIR TRICK', 0xffffff, { size: 0.8, life: 0.7 });
    this._fx('ring', this._center(_b), 1.4, 0xffffff, 0.3);
  }

  /** Hold the attack button: classic = Arm Spin (or Spider Slam at a distant target), symbiote = charged Symbiote Punch. */
  _holdAttack(dt, input) {
    const down = input.down('attack') && !this.aiming && this.dodgeT <= 0 && !this.spin && this.state === 'free';
    if (down) {
      this.atkHold += dt;
      if (this.atkHold >= TUNE.holdAttack && !this.holdUsed && !this.atk) {
        if (!this.onGround) { this.holdUsed = true; P.spiderSlam(this, null); return; }
        if (this.symbiote) {
          if (!this.charging) { this.charging = true; this._play('symbiote', { volume: 0.4, pitch: 0.7 }); }
          this.punchCharge = clamp((this.atkHold - TUNE.holdAttack) / 0.9, 0, 1);
          this.setAnim('charge', 1);
          if (Math.random() < dt * 20) this._fx('burst', this._hand(_hp).clone(), 0x07070c, 3, 3, 0.3, 0.12);
          if (this.punchCharge >= 1 && !this._chargeFull) { this._chargeFull = true; this._rumble(0.4, 0.6, 80); this._fx('ring', this._center(_b), 1.6, 0x7a3cff, 0.3); }
          this.game.cam.shake(0.01 + this.punchCharge * 0.04);
        } else {
          this.holdUsed = true;
          const t = this._aimTargetNear(22);
          const far = t && Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) > 6;
          if (far) P.spiderSlam(this, t); else P.armSpin(this);
        }
      }
    } else {
      if (this.charging) { this.charging = false; this._chargeFull = false; P.symbiotePunch(this, this.punchCharge); }
      this.atkHold = 0; this.holdUsed = false; this.punchCharge = 0;
    }
  }

  _startAttack(input) {
    const air = !this.onGround;
    const step = this.atkReset > 0 ? this.atkStep : 0;
    this._beginStep(step, air, input);
  }

  _beginStep(step, air, input) {
    // anticipation (wind-up) -> impact -> recovery
    const dur = [0.36, 0.36, 0.56][step], hitAt = [0.13, 0.13, 0.24][step];
    this.atk = { step, t: 0, dur, hitAt, hit: false, queued: false, air };
    const names = air ? ['punch1', 'kick', 'smash'] : ['punch1', 'punch2', this.symbiote ? 'uppercut' : 'kick'];
    this.setAnim(names[step], 1);
    // web finisher: a webbed enemy gets yanked in and slammed
    if (step === 2 && !air && !this.symbiote) {
      const wt = this._webbedNear(14);
      if (wt) {
        this.atk.yank = wt; this.atk.hitAt = 0.19;
        this.yaw = Math.atan2(wt.pos.x - this.pos.x, wt.pos.z - this.pos.z);
        this.vel.x = 0; this.vel.z = 0; this.setAnim('throw', 1);
        this._play('thwip'); return;
      }
    }
    // lunge toward the nearest enemy in the input / facing direction (freeflow style)
    const wish = this._wish(input, _a); const fdir = wish.lengthSq() > 0.04 ? wish.clone().normalize() : this.forward;
    const tgt = this.game.enemies?.findTarget?.(this._center(new THREE.Vector3()), fdir, TUNE.lungeRange, 110) ?? null;
    if (tgt) {
      const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z; const dist = Math.hypot(dx, dz);
      this.yaw = Math.atan2(dx, dz);
      const ls = clamp((dist - 1.5) / 0.16, 0, 34);
      this.vel.x = (dx / Math.max(dist, 0.01)) * ls; this.vel.z = (dz / Math.max(dist, 0.01)) * ls;
      if (air) this.vel.y = clamp((tgt.pos.y - this.pos.y) / 0.14, -18, 18);
      this.atk.target = tgt;
    } else {
      this.yaw += angDiff(this.yaw, Math.atan2(fdir.x, fdir.z)) * 0.8;
      this.vel.x = Math.sin(this.yaw) * 4; this.vel.z = Math.cos(this.yaw) * 4;
    }
    this._play('whoosh', { volume: 0.5 });
  }

  _updateAttack(dt, input) {
    const a = this.atk; a.t += dt;
    if (input.pressed('attack') && a.t > 0.08) a.queued = true;
    if (a.target && a.t < 0.18 && a.target.alive !== false) { // keep tracking while lunging
      this.yaw += angDiff(this.yaw, Math.atan2(a.target.pos.x - this.pos.x, a.target.pos.z - this.pos.z)) * Math.min(1, 20 * dt);
    }
    if (!a.hit && a.t >= a.hitAt) { a.hit = true; this._doMelee(a); }
    if (a.t >= a.dur) {
      const next = (a.step + 1) % 3;
      this.atk = null; this.atkStep = next; this.atkReset = 0.7;
      if (a.queued) { this._beginStep(next, !this.onGround, input); }
    }
  }

  _doMelee(a) {
    const mul = this._dmgMul(); const air = a.air; const fin = a.step === 2;
    if (a.yank) { if (a.yank.alive) P.yankSlam(this, a.yank); return; }
    const dmg = (air ? [13, 13, 22] : [15, 15, 28])[a.step] * mul;
    const origin = this._center(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const hits = this.game.combat?.melee?.({
      origin, forward: fwd, range: fin ? 3.3 : 2.7, arc: 120, damage: dmg,
      knockback: (fin ? 14 : 4.5) * (this.symbiote ? 1.3 : 1), up: fin ? (air ? -2 : 6) : 1.2, stun: fin ? 0.7 : 0.3,
      source: this, team: 'player',
    }) || [];
    if (hits.length) {
      this._impact(fin ? 0.7 : 0.3, this.symbiote);
      this.vel.x *= 0.25; this.vel.z *= 0.25;   // brief hit-pause on the attacker
      for (const t of hits) {
        const p = t.center ?? t.pos;
        if (this.symbiote) {
          P.symImpact(this, p, fin ? 1.2 : 0.8);
          this.tendrils.spawn({ from: (o) => this._hand(o), to: p.clone(), life: 0.28, grow: 0.06, width: 0.1, wiggle: 0.5, arc: 0.04 });
        }
      }
    }
    if (a.air && fin) { this.slam = true; this.slamPower = 'air'; this.vel.y = -26; this.vel.x *= 0.3; this.vel.z *= 0.3; }
  }

  /** Quick web shot (tap RMB / K / R1). While aiming it flies exactly down the crosshair. */
  _webShot(input) {
    if (!this.useCooldown('special', 0.45)) return;
    const hand = this._hand(new THREE.Vector3());
    let tgt = null, aimPt;
    if (this.aiming) {
      const ray = this.gadgets.aimRay(100);
      aimPt = ray.point.clone(); tgt = null;
    } else {
      tgt = this._aimTarget(45, 22);
      if (tgt) aimPt = (tgt.center ?? tgt.pos).clone();
      else {
        const dir = this.game.cam.aimDirection(new THREE.Vector3());
        const hit = this.game.physics.raycast(this.game.camera.position, dir, 80);
        aimPt = hit ? hit.point.clone() : this.game.camera.position.clone().addScaledVector(dir, 80);
      }
    }
    const v = aimPt.sub(hand).normalize().multiplyScalar(60);
    if (!this.aiming) this.yaw += angDiff(this.yaw, Math.atan2(v.x, v.z)) * 0.7;
    this.hand ^= 1;
    this.game.combat?.projectile?.({
      pos: hand, vel: v, damage: 6 * this._dmgMul(), radius: 0.35, life: 1.4, color: 0xffffff, size: 0.16, kind: 'web',
      team: 'player', homing: tgt, source: this,
      onHit: (t, p) => { t?.web?.(3); this._fx('burst', t?.center ?? hand, 0xffffff, 10, 4, 0.4, 0.15); this.game.hud?.hitMarker?.(!!t && p.pos.y > t.pos.y + t.height * 0.8); },
    });
    this.setAnim('shoot', 1); this.anim.t = 0; this.shootT = 0.25;
    this._play('thwip'); this._rumble(0.15, 0.2, 50);
  }

  _webPull() {
    // a webbed enemy is swung around you and thrown into the others
    const wt = this._webbedNear(30);
    if (wt) {
      this.pullUsed = true;
      if (P.webThrow(this, wt)) { this.yaw = Math.atan2(wt.pos.x - this.pos.x, wt.pos.z - this.pos.z); return; }
    }
    const tgt = this._aimTarget(32, 25);
    if (!tgt || tgt.isBoss) { this.pullUsed = true; return; }
    const d = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
    if (d < 4) { this.pullUsed = true; return; }
    if (!this.useCooldown('pull', 2.5)) { this.pullUsed = true; return; }
    this.pullUsed = true;
    const dir = _a.set(this.pos.x - tgt.pos.x, 0, this.pos.z - tgt.pos.z).normalize();
    tgt.web?.(1.2);
    const kb = dir.clone().multiplyScalar(Math.min(32, d * 2.6)); kb.y = 5;
    tgt.takeDamage?.(4 * this._dmgMul(), { knockback: kb, stun: 0.9, source: this, kind: 'web' });
    this.pullLineT = 0.25; this.pullTarget = tgt; this.lines.pull.begin(0.5);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.setAnim('throw', 1); this.shootT = 0.3;
    this._play('thwip'); this._play('whoosh'); this._rumble(0.5, 0.3, 120);
  }

  // ---- Symbiote strike / lash --------------------------------------------------
  _symStrike(input) {
    let tgt = null;
    if (this.aiming) tgt = this.aimEnemy;
    if (!tgt) tgt = this._aimTarget(16, 70);
    if (!tgt) tgt = this._aimTargetNear(9);
    if (tgt && P.symbioteStrike(this, tgt)) return;
    if (!tgt) this._startLash(input);
  }

  _startLash(input) {
    if (!this.useCooldown('special', 3)) return;
    const tgt = this._aimTarget(12, 70);
    let dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (tgt) dir.set(tgt.pos.x - this.pos.x, 0, tgt.pos.z - this.pos.z).normalize();
    else { const w = this._wish(input, _a); if (w.lengthSq() > 0.04) dir.copy(w).normalize(); else dir.copy(this.game.cam.forward); }
    this.yaw = Math.atan2(dir.x, dir.z);
    this.lash = { t: 0, pulse: 0, dir };
    this.setAnim('cast', 1);
    this._play('symbiote'); this._rumble(0.6, 0.4, 160);
  }
  _updateLash(dt) {
    const L = this.lash; L.t += dt;
    if (this.onGround) { this.vel.x = approach(this.vel.x, 0, 40 * dt); this.vel.z = approach(this.vel.z, 0, 40 * dt); }
    while (L.pulse < 3 && L.t >= 0.1 + L.pulse * 0.13) {
      const last = L.pulse === 2; L.pulse++;
      const origin = this._center(new THREE.Vector3());
      const hits = this.game.combat?.melee?.({
        origin, forward: L.dir, range: 8.5, arc: 150, damage: (last ? 30 : 20) * this._dmgMul() * 0.8,
        knockback: last ? 18 : 6, up: last ? 8 : 2, stun: last ? 1 : 0.5, source: this, team: 'player',
      }) || [];
      // tendrils fan out
      for (let i = 0; i < 5; i++) {
        const ang = (i - 2) * 0.28 + (Math.random() - 0.5) * 0.15;
        const dd = new THREE.Vector3(L.dir.x * Math.cos(ang) - L.dir.z * Math.sin(ang), 0.1 + Math.random() * 0.3, L.dir.x * Math.sin(ang) + L.dir.z * Math.cos(ang)).normalize();
        this.tendrils.spawn({ from: origin.clone(), to: origin.clone().addScaledVector(dd, 6 + Math.random() * 3), life: 0.32, grow: 0.07, width: 0.12, wiggle: 0.8, arc: 0.04 });
      }
      for (const t of hits) P.symImpact(this, t.center ?? t.pos, last ? 1.2 : 0.8);
      if (hits.length) { this._impact(last ? 0.8 : 0.35, true); this._play(last ? 'heavyhit' : 'hit'); }
      this._play('whoosh', { volume: 0.5 });
    }
    if (L.t > (L.dur ?? 0.6)) this.lash = null;
  }

  // ---- Dodge + parry + spider sense --------------------------------------------
  /** SM2 parry: pressing dodge in the last 0.15 s of a melee wind-up staggers the attacker and opens a counter window. */
  _tryParry() {
    const list = this.game.enemies?.list; if (!list) return false;
    let best = null, bd = 1e9;
    for (const e of list) {
      if (!e.alive || !(e.windup > 0) || e.windup > TUNE.parryWindup) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d > TUNE.parryRange || d >= bd) continue;
      bd = d; best = e;
    }
    if (!best || !this.useCooldown('parry', 0.9)) return false;
    const e = best, g = this.game;
    this.cooldowns.dodge = 0.35; this._cdMax = this._cdMax || {}; this._cdMax.dodge = 0.35;
    this.atk = null; this.lash = null; this.spin = null; this.charging = false;
    this.yaw = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    const dir = _a.set(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize();
    e.interrupt?.();
    if (e.isBoss) { if (e.poise !== undefined) e.poise += (e.poiseMax || 100) * 0.45; e.slowTimer = Math.max(e.slowTimer || 0, 1.5); }
    this._hit(e, 6 * this._dmgMul(), { stun: 1.7, kind: 'parry', kb: dir.clone().multiplyScalar(9).setY(3), heavy: true });
    this.invuln = Math.max(this.invuln, 0.6);
    this.counterT = 1.6; this.counterTarget = e;
    this.addFocus(25);
    this.setAnim('punch2', 1.4);
    g.slowmo?.(0.4, 0.25);
    this._fx('text', _b.set(this.pos.x, this.pos.y + 2.5, this.pos.z), 'PARRY', 0xffd060, { size: 1.5, life: 1.0 });
    this._fx('ring', this._center(_c), 3.2, 0xffd060, 0.35); this._fx('burst', _c.copy(e.center ?? e.pos), 0xffd060, 24, 8, 0.4, 0.2);
    this._fx('flash', e.center ?? e.pos, 0xffe8a0, 4, 0.15);
    g.hud?.prompt?.('attack', 'COUNTER');
    this._play('perfect'); this._play('heavyhit'); this._rumble(0.8, 0.8, 160); g.cam.shake(0.25);
    return true;
  }

  _counterStrike() {
    const e = this.counterTarget; if (!e?.alive) return false;
    this.counterT = 0; this.counterTarget = null; this.game.hud?.prompt?.('attack', '');
    const mul = this._dmgMul();
    const dir = new THREE.Vector3(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z); const dist = dir.length(); dir.normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    this.vel.x = dir.x * clamp((dist - 1.3) / 0.1, 0, 38); this.vel.z = dir.z * clamp((dist - 1.3) / 0.1, 0, 38);
    this.atk = { step: 2, t: 0, dur: 0.6, hitAt: 99, hit: true, queued: false, air: false, special: true };
    this.setAnim(this.symbiote ? 'uppercut' : 'smash', 1); this._play('whoosh');
    this._later(0.1, () => {
      const origin = this._center(new THREE.Vector3());
      const fwd = new THREE.Vector3(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize();
      const hits = this.game.combat?.melee?.({ origin, forward: fwd, range: 3.8, arc: 140, damage: 55 * mul, knockback: 20, up: 9, stun: 2, heavy: true, source: this, team: 'player' }) || [];
      this._fx('text', _a.set(this.pos.x, this.pos.y + 2.5, this.pos.z), 'COUNTER', 0xffffff, { size: 1.4, life: 0.9 });
      if (hits.length) {
        for (const t of hits) { if (this.symbiote) P.symImpact(this, t.center, 1.4); else { this._fx('burst', t.center, 0xffffff, 20, 8, 0.4, 0.2); this._fx('ring', t.center, 2.2, 0xffd060, 0.3); } }
        this._impact(1, this.symbiote); this.game.cam.shake(0.6); this.game.slowmo?.(0.18, 0.1); this.game.hud?.hitMarker?.(true);
      }
    });
    return true;
  }

  _startDodge(input) {
    if (this.dodgeT > 0) return;
    if (this._tryParry()) return;
    if (!this.useCooldown('dodge', 0.7)) return;
    const wish = this._wish(input, _a);
    if (wish.lengthSq() > 0.04) this.dodgeDir.copy(wish).setY(0).normalize();
    else this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (this.state === 'swing') { this._endSwing(false); this.swingLock = 0.25; }
    if (this.state === 'wall') { this._leaveWall(); }
    if (this.state === 'zip') { this.lines.zip.hide(); this.state = 'free'; }
    if (this.state === 'glide') { this.state = 'free'; }
    this.state = 'free'; this.gravityScale = 1;
    this.atk = null; this.lash = null; this.spin = null; this.sling = null; this.charging = false; this.trickT = 0;
    this.dodgeT = TUNE.dodgeTime; this.dodgeAge = 0; this.invuln = Math.max(this.invuln, TUNE.dodgeTime);
    this.vel.x = this.dodgeDir.x * TUNE.dodgeSpeed; this.vel.z = this.dodgeDir.z * TUNE.dodgeSpeed;
    this.vel.y = this.onGround ? 3.5 : Math.max(this.vel.y, 2.5);
    this.onGround = false;
    this.setAnim('dodge', TUNE.dodgeSpeed);
    this._play('dodge'); this._fx('burst', this.pos.clone().setY(this.pos.y + 1), 0xffffff, 6, 3, 0.25, 0.12);
  }
  _updateDodge(dt) {
    this.dodgeT -= dt;
    const k = clamp(this.dodgeT / TUNE.dodgeTime, 0, 1);
    const sp = 6 + 12 * k;
    this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
    if (this.state === 'free') this.setAnim('dodge', sp);
  }

  takeDamage(amount, fromPos) {
    if (this.dead) return false;
    if (this.dodgeT > 0 && this.dodgeAge <= TUNE.perfectWindow) {
      // perfect dodge: negate, slow-mo, reward
      this.cooldowns.dodge = 0;
      this.addFocus(20);
      this.game.slowmo?.(0.6, 0.3);
      this._fx('text', this._center(new THREE.Vector3()).setY(this.pos.y + 2.4), 'PERFECT DODGE', '#9fe8ff');
      this._fx('ring', this.pos.clone().setY(this.pos.y + 0.1), 3.5, 0x9fe8ff);
      this._play('perfect'); this._rumble(0.4, 0.8, 140);
      this.dodgeAge = 99; // consume
      return false;
    }
    if (this.dodgeT > 0 || this.state === 'ult') return false;
    const r = super.takeDamage(amount, fromPos);
    if (r) { this.atk = null; this.lash = null; this.spin = null; this.sling = null; this.charging = false; this.slingK = 0; this.trickT = 0; }
    return r;
  }

  _updateSense(dt) {
    this.senseScan -= dt;
    if (this.senseScan > 0) { this.senseT = Math.max(0, this.senseT - dt); return; }
    this.senseScan = 0.08;
    let danger = false;
    const list = this.game.enemies?.list;
    if (list) {
      for (const e of list) {
        if (!e.alive || !(e.windup > 0)) continue;
        const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
        if (dx * dx + dz * dz < 18 * 18) { danger = true; break; }
      }
    }
    if (danger) {
      this.senseT = 0.25;
      if (!this.senseShown) {
        this.senseShown = true;
        this.game.hud?.prompt?.('dodge', '!');
        this._fx('ring', this.pos.clone().setY(this.pos.y + 1.9), 0.9, 0xffffff);
        this._play('perfect', { volume: 0.35, pitch: 1.6 });
        this._rumble(0.1, 0.5, 60);
      }
    } else if (this.senseShown && this.senseT <= 0) {
      this.senseShown = false;
      this.game.hud?.prompt?.('dodge', '');
    }
    this.senseT = Math.max(0, this.senseT - 0.08);
  }

  // ---- Suit + ultimates ------------------------------------------------------
  _toggleSuit() {
    if (!this.useCooldown('suit', 1.0)) return;
    this.symbiote = !this.symbiote;
    this.model.setVariant?.(this.symbiote ? 'symbiote' : 'classic');
    this.color = this.symbiote ? '#15151c' : '#e0202a';
    this.maxHp = this.symbiote ? 140 : 120; this.hp = Math.min(this.maxHp, this.hp + (this.symbiote ? 20 : 0));
    this.charging = false; this.spin = null;
    const p = this._center(new THREE.Vector3());
    this._fx('burst', p, this.symbiote ? 0x07070c : 0xe0202a, 40, 8, 0.7, 0.3);
    this._fx('ring', this.pos.clone().setY(this.pos.y + 0.1), 3.5, this.symbiote ? 0x07070c : 0xe0202a);
    this._fx('flash', p, this.symbiote ? 0x8844ff : 0xff3030, 4, 0.2);
    if (this.symbiote) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.tendrils.spawn({ from: (o) => this._center(o), to: p.clone().add(new THREE.Vector3(Math.cos(a) * 2.2, 0.2 + (i % 3) * 0.5, Math.sin(a) * 2.2)), life: 0.55, grow: 0.2, width: 0.1, wiggle: 1.2, arc: 0.2 }); }
    this.game.cam.shake(0.3); this._play(this.symbiote ? 'symbiote' : 'switch'); this._rumble(0.6, 0.6, 200);
    this.game.hud?.toast?.(this.symbiote ? 'SYMBIOTE SUIT' : 'CLASSIC SUIT');
  }

  _startUltimate() {
    if (this.state === 'swing') this._endSwing(false);
    if (this.state === 'wall') this._leaveWall();
    this.lines.zip.hide();
    this.focus = 0; this.state = 'ult'; this.atk = null; this.lash = null; this.spin = null; this.sling = null; this.charging = false; this.dodgeT = 0;
    this.ult = { t: 0, fired: false, sym: this.symbiote };
    this.invuln = Math.max(this.invuln, this.symbiote ? P.RAMPAGE.total + 0.4 : 1.3);
    this.setAnim(this.symbiote ? 'cast' : 'throw', 1);
    this._play(this.symbiote ? 'symbiote' : 'thwip'); this._rumble(0.6, 0.6, 250);
    if (this.symbiote) P.rampageStart(this);
  }
  _updateUltimate(dt) {
    const U = this.ult; U.t += dt;
    if (U.sym) {
      this.setAnim('cast', 1.6);
      if (P.rampageUpdate(this, dt, U)) { this.state = 'free'; this.gravityScale = 1; this.ult = null; }
      return;
    }
    this.gravityScale = 0.15;
    this.vel.x = approach(this.vel.x, 0, 30 * dt); this.vel.z = approach(this.vel.z, 0, 30 * dt); this.vel.y = approach(this.vel.y, 0, 30 * dt);
    const c = this._center(new THREE.Vector3());
    if (!U.fired && U.t >= 0.25) {
      U.fired = true;
      const cb = this.game.combat;
      const en = this.game.enemies?.inRadius?.(this.pos, 15) ?? [];
      for (const e of en) {
        if (e.isBoss) { e.web?.(2); } else e.web?.(5);
        this._fx('beam', c, e.center ?? e.pos, 0xffffff, 0.12, 0.35);
        this._fx('burst', e.center ?? e.pos, 0xffffff, 16, 5, 0.6, 0.2);
      }
      cb?.aoe?.({ center: this.pos.clone(), radius: 15, damage: 10, knockback: 3, up: 2, stun: 0.5, source: this, team: 'player', falloff: false });
      this._fx('shockwave', this.pos.clone().setY(this.pos.y + 0.1), 15, 0xffffff);
      this._fx('ring', this.pos.clone().setY(this.pos.y + 1), 15, 0xe8f6ff);
      this._fx('flash', c, 0xffffff, 5, 0.25);
      this.game.cam.shake(0.6); this._rumble(0.8, 0.8, 300); this._play('thwip'); this._play('explosion');
      this.game.hud?.toast?.('WEB BOMB');
    }
    if (U.t > 0.65) { this.state = 'free'; this.gravityScale = 1; this.ult = null; }
  }

  // ---- misc ------------------------------------------------------------------
  _updateFov(dt) {
    let t = 0;
    const sp = this.vel.length();
    switch (this.state) {
      case 'swing': t = clamp((sp - 12) * 0.3, 0, 12); break;
      case 'zip': t = 14; break;
      case 'glide': t = 5 + (this.glideSpeed > 26 ? (this.glideSpeed - 26) * 0.6 : 0); break;
      case 'ult': t = 10; break;
      default: t = this.boostT > 0 ? 10 : (sp > 22 ? (sp - 22) * 0.3 : 0);
    }
    if (this.sling || this.charging) t -= 6 * Math.max(this.slingK, this.punchCharge);
    if (this.symbiote) t += 2;
    this.fovK = THREE.MathUtils.damp(this.fovK, t, 6, dt);
    this.game.cam.fovKick = this.fovK;
  }

  // ---- visuals ---------------------------------------------------------------
  updateVisuals(dt) {
    const L = this.lines;
    this.tendrils.update(dt);
    if (this.dead) {
      L.swing.hide(); L.zip.hide(); L.pull.hide();
      this.state = 'free'; this.gravityScale = 1; this.customMovement = false; this._pose = null;
      if (this._xh) { this.game.hud?.setCrosshair?.(null); this._xh = false; }
    }
    if (this.state === 'swing') { this._hand(_hp); L.swing.update(dt, _hp, this.anchor, 0.97); } else L.swing.hide();
    if (this.state === 'zip') { this._hand(_hp); L.zip.update(dt, _hp, this.zipHit, 1); } else L.zip.hide();
    if (this.pullLineT > 0 && this.pullTarget) {
      this.pullLineT -= dt;
      this._hand(_hp);
      L.pull.update(dt, _hp, this.pullTarget.center ?? this.pullTarget.pos, 0.6);
    } else L.pull.hide();

    this._applyPose(dt);
    if (this.state === 'wall' && this.model.customRotation) {
      // chest-center sits wallOffset off the wall surface; blend in over the first moments so entry doesn't pop
      const g = this.model.group; const n = this.wallN;
      this._wallK = Math.min(1, (this._wallK ?? 1) + dt * 7);
      const k = this._wallK * this._wallK * (3 - 2 * this._wallK);
      _a.set(this.pos.x + n.x * (TUNE.wallOffset - this.radius), this.pos.y + this.height * 0.5, this.pos.z + n.z * (TUNE.wallOffset - this.radius));
      _b.set(0, this.height * 0.5, 0).applyQuaternion(g.quaternion);
      _a.sub(_b);
      g.position.lerp(_a, k);
    } else if (this.model.customRotation && (this.state === 'swing' || this.state === 'glide' || this.state === 'zip')) {
      this.model.group.position.y = this.pos.y + 0.0;
    }
  }
}

/** Mid-air zip boost when there is no zip target. Returns true if fired. */
function useZipBoost(h) {
  if ((h.cooldowns.zipboost || 0) > 0) return false;
  h.cooldowns.zipboost = TUNE.zipBoostCd; h._cdMax = h._cdMax || {}; h._cdMax.zipboost = TUNE.zipBoostCd;
  const dir = h.game.cam.aimDirection(new THREE.Vector3());
  const sp = Math.max(TUNE.zipBoost, h.vel.length() * 0.9);
  h.vel.copy(dir).multiplyScalar(sp);
  if (h.onGround) { h.vel.y = Math.max(h.vel.y, 6); h.onGround = false; }
  h.boostT = 0.45; h.yaw = Math.atan2(dir.x, dir.z);
  h.useCooldown('zip', 0.5);
  const from = h._hand(new THREE.Vector3());
  h.lines.zip.begin(0.5);
  h._fx('beam', from, from.clone().addScaledVector(dir, 10), 0xffffff, 0.1, 0.18);
  h._fx('burst', h.pos.clone().setY(h.pos.y + 1), 0xffffff, 14, 6, 0.3, 0.15);
  h._play('zip'); h._play('whoosh'); h._rumble(0.3, 0.3, 90); h.game.cam.shake(0.1);
  return true;
}
