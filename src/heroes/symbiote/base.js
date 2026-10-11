// Shared base for the symbiote heroes (Venom, Carnage, Anti-Venom).
// Owns traversal that is NOT Spider-Man's web-swing:
//   * tendril launch / zip      swing (Shift / R2): a thick tendril snaps onto a ledge / wall and yanks the hero there
//   * wall crawl                claws dig in; fast and menacing (auto-attach when launching into / pushing against a tall wall)
//   * jump jets (hold jump)     holding jump while rising pours extra lift into the leap, then the membrane wings glide
//   * dash dodge                short i-frame dash
// Subclasses implement combat(dt, input) / tick(dt, input) and tune `mv` (movement config).
import * as THREE from 'three';
import { Hero, approach } from '../Hero.js';
import { TendrilPool } from '../spider/tendrils.js';
import { Timers, aimInfo, enemyCenter, rumble, clamp, damp, objPos } from '../avengers/util.js';
import { hurt } from '../squad/util.js';
import { Wings } from './wings.js';

export const SYM_KINDS = ['goon', 'venom', 'carnage', 'carnage_spawn', 'symbiote'];
export const isSymbiote = (e) => { const k = e && e.kind; return !!k && SYM_KINDS.some((s) => k.includes(s)); };
export const UPV = new THREE.Vector3(0, 1, 0);

const V3 = THREE.Vector3;
const _w = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _ai = {};
const _hp = new V3();

export class SymbioteHero extends Hero {
  constructor(game, cfg) {
    super(game, cfg);
    this.mv = cfg.mv;
    const mh = this.model.height || cfg.height;
    this.baseScale = cfg.height / mh;
    this.sizeMul = 1; this.sizeTarget = 1;
    this.baseRadius = this.radius; this.baseHeight = this.height;
    this.tcfg = cfg.tendril ?? {};
    this.timers = new Timers();
    this.pool = null;
    this.state = 'free'; this.stateT = 0;      // free | launch | wall | glide
    this.actionT = 0; this.actionAnim = 'idle'; this.actionMoveMul = 1;
    this.chain = 0; this.chainT = 0;
    this.dashT = 0; this.dashDir = new V3(); this.dodgeAge = 9;
    this.anchor = new V3(); this.anchorN = new V3(0, 1, 0); this.dest = new V3(); this.rope = null;
    this.launchT = 0; this.launchSp = 0; this.launchWall = false; this.launchTarget = null; this._stall = 0;
    this.wallN = new V3(0, 0, 1); this.wallLost = 0; this.wallLock = 0; this.stickWall = 0; this.wallBox = null;
    this.jumpBoostT = 0; this.airT = 0; this.airJumps = 1; this.flipT = 0; this._glideT = 0;
    this.speedMul = 1; this.dmgOutMul = 1; this.dmgTakenMul = 1; this.stepT = 0;
    this._impactVy = 0; this.fovAdd = 0; this.punch = 0;
    this.wings = cfg.wings ? new Wings(this.model, cfg.wings) : null;
    this._xh = null;
  }

  // ------------------------------------------------------------------ lifecycle
  _pool() {
    if (!this.pool) {
      this.pool = new TendrilPool(this.game.scene, this.tcfg.count ?? 28, 16, 6);
      if (this.tcfg.material) for (const t of this.pool.list) t.mesh.material = this.tcfg.material;
    }
    return this.pool;
  }

  onActivate() {
    this.state = 'free'; this.stateT = 0; this.actionT = 0; this.dashT = 0; this.gravityScale = 1;
    this.sizeMul = 1; this.sizeTarget = 1; this.fovAdd = 0; this.punch = 0;
    this._pool().clear();
    this.wings?.set(0);
    this.airJumps = 1; this.wallLock = 0; this.stickWall = 0;
    this.onSymActivate?.();
  }
  onDeactivate() {
    this._cleanup();
    this.onSymDeactivate?.();
  }
  _cleanup() {
    this.timers.clear();
    this.pool?.clear();
    this.rope = null;
    this.wings?.set(0);
    this.state = 'free'; this.gravityScale = 1; this.actionT = 0; this.dashT = 0;
    this.game.cam.fovKick = 0;
    this.sizeMul = 1; this.sizeTarget = 1; this.radius = this.baseRadius; this.height = this.baseHeight;
    this._setReticle(null);
    this.onCleanup?.();
  }

  get dmgMul() { return this.dmgOutMul; }
  dmg(n) { return n * this.dmgMul; }

  takeDamage(amount, fromPos) {
    if (this.dead || this.invuln > 0) return false;
    const ok = super.takeDamage(amount * this.dmgTakenMul, fromPos);
    if (ok && this.dead) this._cleanup();
    return ok;
  }

  syncModel(dt) {
    super.syncModel(dt);
    this.sizeMul = damp(this.sizeMul, this.sizeTarget, 6, dt);
    this.model.group.scale.setScalar(this.baseScale * this.sizeMul);
  }

  // ------------------------------------------------------------------ small helpers
  get foes() { return this.game.enemies?.list ?? []; }
  handPos(out) { return objPos(this.model.handR, out, this.center); }
  chestPos(out) { return objPos(this.model.chest, out, this.center); }
  say(text, color = 0xffffff, size = 1.2) {
    this.game.fx?.text?.(_hp.set(this.pos.x, this.pos.y + this.height + 0.9, this.pos.z), text, color, { size, life: 1 });
  }
  _setReticle(kind) {
    const g = this.game;
    if (kind && g.weapons?.equipped) kind = null;
    if (this._xh === kind) return;
    if (!kind && !this._xh) return;
    this._xh = kind || null;
    g.hud?.setCrosshair?.(kind || null);
  }
  /** Direct damage with spark / number / registerHit. */
  strike(e, dmg, o = {}) { return hurt(this.game, this, e, dmg, o); }
  /** Face the nearest enemy in front (or the camera / stick direction) before an attack. */
  faceAssist(range = 6, cone = 110) {
    const t = this.findTarget(range, cone);
    if (t) { this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z); return t; }
    const wish = this.game.cam.moveVector(this.game.input.move, _w);
    if (wish.lengthSq() > 0.04) this.yaw = Math.atan2(wish.x, wish.z);
    else { const f = this.game.cam.forward; this.yaw = Math.atan2(f.x, f.z); }
    return null;
  }
  /** Pull an enemy along with the hero (grab / purge). h = { e, t, start, grav }. */
  carry(h, dt, ahead = 1.5, lift = 0.62, pullT = 0.3) {
    const e = h.e;
    h.t += dt;
    const f = this.forward;
    _hp.set(this.pos.x + f.x * ahead, this.pos.y + this.height * lift - e.height * 0.5, this.pos.z + f.z * ahead);
    if (h.t < pullT && h.start) {
      const k = clamp(h.t / pullT, 0, 1), s = 1 - (1 - k) * (1 - k);
      e.pos.lerpVectors(h.start, _hp, s);
    } else e.pos.copy(_hp);
    e.vel.set(0, 0, 0); e.gravity = 0; e.launched = false;
    e.stunTimer = Math.max(e.stunTimer, 0.5); e.downTimer = Math.max(e.downTimer, 0.5); e.webTimer = 0;
    e.yaw = this.yaw + Math.PI;
    e.center.set(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z);
  }
  /** Start grabbing an enemy (interrupt AI, zero gravity). Returns the carry record. */
  seize(e) {
    const h = { e, t: 0, start: e.pos.clone(), grav: e.gravity };
    e.gravity = 0; e.vel.set(0, 0, 0); e.launched = false; e.interrupt?.();
    e.stunTimer = Math.max(e.stunTimer, 1);
    return h;
  }
  drop(h, stun = 0.6) {
    if (!h || !h.e) return;
    const e = h.e;
    e.gravity = h.grav ?? 28; e.downTimer = stun; e.stunTimer = Math.max(e.stunTimer, stun);
  }
  retractRope() { if (this.rope && this.rope.active) this.rope.age = Math.max(this.rope.age, this.rope.life - this.rope.retract); this.rope = null; }
  /** Quick tendril line from the hand (or a Vector3 / fn) to a point or fn. */
  lash(to, o = {}) {
    const hand = this.model.handR;
    const from = o.from ?? ((out) => objPos(hand, out, this.center));
    return this._pool().spawn({ from, to, life: o.life ?? 0.28, grow: o.grow ?? 0.07, width: o.width ?? 0.11, wiggle: o.wiggle ?? 0.5, arc: o.arc ?? 0.05, delay: o.delay ?? 0 });
  }

  // ------------------------------------------------------------------ main hook
  updateAbilities(dt, input) {
    const g = this.game;
    this.customMovement = true;
    this.timers.update(dt);
    this.actionT = Math.max(0, this.actionT - dt);
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.chain = 0; }
    this.dashT = Math.max(0, this.dashT - dt);
    this.dodgeAge += dt;
    this.wallLock = Math.max(0, this.wallLock - dt);
    this.stickWall = Math.max(0, this.stickWall - dt);
    this.flipT = Math.max(0, this.flipT - dt);
    this.stateT += dt;
    this.pool?.update(dt);
    this.punch = damp(this.punch, 0, 7, dt);

    this.tick(dt, input);
    this.combat(dt, input);
    this._movement(dt, input);

    this._impactVy = this.vel.y;
    this.wings?.set(this.state === 'glide' ? 1 : 0, g.time);
    g.cam.fovKick = this.fovAdd + this.punch + (this.state === 'launch' ? 7 : 0) + (this.state === 'glide' ? 4 : 0);
  }

  tick() {}
  combat() {}
  defaultMovement() {}

  onLand() {
    const v = -this._impactVy;
    this.airT = 0; this.airJumps = 1; this.jumpBoostT = 0;
    if (this.state === 'glide') { this.state = 'free'; this.gravityScale = 1; }
    if (v > 12) this.game.audio?.play('land', { volume: clamp(v / 40, 0.25, 0.9), pitch: 0.7 });
    if (v > 20) this.landSlam?.(v);
  }

  // ------------------------------------------------------------------ movement state machine
  _wish(input, out) {
    this.game.cam.moveVector(input.move, out);
    const m = Math.min(1, out.length());
    if (m > 0.01) out.normalize();
    out.mag = m;
    return out;
  }

  _movement(dt, input) {
    const wish = this._wish(input, _w); const mag = wish.mag;
    if (this.dead) return;
    if (this.locked) { this._lockedMove(dt); return; }
    if (this.dashT > 0 && this.state !== 'wall') { this._dashMove(dt); return; }
    switch (this.state) {
      case 'launch': this._updateLaunch(dt, input, wish, mag); return;
      case 'wall': this._updateWall(dt, input, wish, mag); return;
      case 'glide': this._updateGlide(dt, input, wish, mag); return;
      default: this._free(dt, input, wish, mag);
    }
  }

  /** Subclass sets this.locked for cinematic moves (ultimates): velocity decays, gravity on. */
  _lockedMove(dt) {
    this.gravityScale = 1;
    this.vel.x = approach(this.vel.x, 0, 30 * dt); this.vel.z = approach(this.vel.z, 0, 30 * dt);
    if (this.actionT > 0) this.setAnim(this.actionAnim);
  }

  _dashMove(dt) {
    const mv = this.mv;
    this.vel.x = this.dashDir.x * mv.dashSp; this.vel.z = this.dashDir.z * mv.dashSp;
    if (!this.onGround) this.vel.y = Math.max(this.vel.y, 0);
    this.gravityScale = 1;
    this.yaw = Math.atan2(this.dashDir.x, this.dashDir.z);
    this.setAnim('dodge', mv.dashSp);
    if (Math.random() < 0.6) this.game.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 1, this.pos.z), this.mv.fxColor ?? 0x7a2bd0, 1, 2, 0.3, 0.3);
  }

  _tryDodge(input, wish, mag) {
    if (!input.pressed('dodge') || this.dashT > 0 || (this.cooldowns.dodge || 0) > 0) return false;
    this.cooldowns.dodge = this.mv.dodgeCd ?? 0.6;
    if (mag > 0.1) this.dashDir.copy(wish); else this.dashDir.copy(this.forward);
    this.dashDir.y = 0; this.dashDir.normalize();
    this.dashT = this.mv.dashTime; this.dodgeAge = 0;
    this.invuln = Math.max(this.invuln, this.mv.dashTime + 0.12);
    this.game.audio?.play('dodge');
    this.game.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 1, this.pos.z), this.mv.fxColor ?? 0x7a2bd0, 10, 4, 0.4, 0.3);
    this.onDodge?.();
    return true;
  }

  _free(dt, input, wish, mag) {
    const g = this.game, mv = this.mv, cam = g.cam;
    this.gravityScale = 1;
    const grounded = this.onGround;
    if (grounded) { this.airT = 0; this.airJumps = 1; } else this.airT += dt;

    // --- wall attach
    if (this.wallLock <= 0 && this.onWall) {
      _a.copy(this.wallNormal).setY(0);
      if (_a.lengthSq() > 0.01) {
        _a.normalize(); const into = -wish.dot(_a);
        const fwdKey = input.move.y > 0.25 && mag > 0.2 && into > 0.35;
        if (this.stickWall > 0 || (!grounded && fwdKey) || (grounded && mag > 0.4 && into > 0.6 && this._wallTall(_a))) {
          this._enterWall(_a); this._updateWall(dt, input, wish, mag); return;
        }
      }
    }
    if (this._tryDodge(input, wish, mag)) { this._dashMove(dt); return; }

    // --- tendril launch
    if (mv.launch && input.pressed('swing') && (this.cooldowns.launch || 0) <= 0 && !this.dead) {
      if (this._tryLaunch(input, wish)) return;
    }

    // --- jump
    if (input.pressed('jump')) {
      if (grounded) {
        this.vel.y = mv.jump; this.onGround = false; this.jumpBoostT = mv.boostT ?? 0; this.airT = 0;
        if (mag > 0.1) { this.vel.x += wish.x * (mv.jumpFwd ?? 2); this.vel.z += wish.z * (mv.jumpFwd ?? 2); }
        g.audio?.play('jump', { pitch: 0.65 });
        g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 0x9a8f7a, 6, 3, 0.4, 0.3);
      } else if (mv.doubleJump && this.airJumps > 0) {
        this.airJumps--; this.vel.y = mv.jump * 0.95; this.flipT = 0.55; this.jumpBoostT = 0;
        const dir = mag > 0.1 ? wish : this.forward;
        this.vel.x = dir.x * Math.max(10, Math.hypot(this.vel.x, this.vel.z)); this.vel.z = dir.z * Math.max(10, Math.hypot(this.vel.x, this.vel.z));
        g.audio?.play('whoosh', { volume: 0.6 });
        g.fx?.ring?.(_a.set(this.pos.x, this.pos.y + 0.9, this.pos.z), 1.6, mv.fxColor ?? 0xff2030, 0.3);
      }
    }
    if (this.jumpBoostT > 0) {
      if (input.down('jump') && this.vel.y > 0) {
        this.vel.y += mv.boost * dt; this.jumpBoostT -= dt;
        if (mag > 0.1) { this.vel.x += wish.x * 10 * dt; this.vel.z += wish.z * 10 * dt; }
        if (Math.random() < 0.5) g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 0.3, this.pos.z), mv.fxColor ?? 0x7a2bd0, 1, 2, 0.35, 0.28);
      } else this.jumpBoostT = 0;
    }
    // --- glide
    if (mv.glide && !grounded && this.jumpBoostT <= 0 && this.airT > 0.35 && this.vel.y < 1.5 && input.down('jump') && this.stateT > 0.15) {
      this.state = 'glide'; this.stateT = 0; this.glideSp = Math.max(Math.hypot(this.vel.x, this.vel.z), 12);
      g.audio?.play('whoosh', { volume: 0.6 });
      return;
    }

    // --- ground / air locomotion
    const sprint = input.down('sprint') || (mag > 0.95 && g.settings?.autoSprint);
    const base = sprint ? mv.sprint : (mag > 0.6 ? mv.run : mv.walk);
    let speed = base * mag * this.speedMul;
    if (this.actionT > 0) speed *= this.actionMoveMul;
    const control = grounded ? 1 : (mv.airCtl ?? 0.45);
    const accel = (grounded ? 55 : 24) * control;
    if (this.flipT > 0) { /* keep the flip's momentum */ } else {
      this.vel.x = approach(this.vel.x, wish.x * speed, accel * dt);
      this.vel.z = approach(this.vel.z, wish.z * speed, accel * dt);
    }
    if (this.actionT <= 0 && mag > 0.01) this.faceTowards(wish, dt, grounded ? 12 : 6);
    const hs = Math.hypot(this.vel.x, this.vel.z);

    // footsteps: heavy thuds on a gallop
    if (grounded && hs > mv.run + 1 && mv.stepShake) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = hs > mv.run + 5 ? 0.3 : 0.4;
        g.cam.shake(mv.stepShake);
        g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 0x9a8f7a, 3, 3, 0.4, 0.3);
        g.audio?.play('land', { volume: 0.25, pitch: 0.55 });
      }
    }
    this.fovAdd = damp(this.fovAdd, grounded && hs > mv.run + 2 ? 7 : 0, 4, dt);

    // --- anim
    if (this.actionT > 0) this.setAnim(this.actionAnim, hs);
    else if (this.flipT > 0) this.setAnim('dodge', 10);
    else if (grounded) this.setAnim(hs > 0.5 ? (hs > mv.run + 1 ? 'sprint' : 'run') : 'idle', hs);
    else this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', hs);
  }

  // ------------------------------------------------------------------ tendril launch
  _findAnchor(wish) {
    const L = this.mv.launch;
    const range = L.range;
    aimInfo(this, range + 30, _ai);
    const c = this.center;
    const hit = _ai.hit;
    if (hit) {
      const d = hit.point.distanceTo(c);
      const ok = d <= range && d >= (L.minDist ?? 5) && (L.anyHit || (hit.point.y > this.pos.y + 3 && hit.normal.y < 0.85));
      if (ok) return this._snapTop(hit, d);
    }
    // fallback: probe upward cones around the travel heading
    const heading = wish.mag > 0.1 ? Math.atan2(wish.x, wish.z) : Math.atan2(this.game.cam.forward.x, this.game.cam.forward.z);
    let best = null, bestScore = -1e9;
    const pitches = L.pitches ?? [0.5, 0.75, 1.0, 0.25];
    const offs = [0, 0.35, -0.35, 0.7, -0.7];
    for (const p of pitches) for (const yo of offs) {
      const a = heading + yo, cp = Math.cos(p);
      _d.set(Math.sin(a) * cp, Math.sin(p), Math.cos(a) * cp);
      const h = this.game.physics.raycast(c, _d, range, { ignoreGround: true });
      if (!h || h.distance < (L.minDist ?? 5) || h.point.y < this.pos.y + 3) continue;
      const score = h.point.y * 0.25 - h.distance * 0.06 - Math.abs(yo) * 4;
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return best ? this._snapTop(best, best.distance) : null;
  }

  /** A wall hit under a roof edge snaps to that edge, so the yank lands on the ledge. */
  _snapTop(hit, dist) {
    const out = { point: hit.point.clone(), normal: hit.normal.clone(), dist, top: false };
    const box = hit.box;
    if (this.mv.launch.snapTop !== false && box && Math.abs(hit.normal.y) < 0.5 && box.data?.type !== 'prop') {
      const rise = box.max.y - hit.point.y;
      if (rise > 1.2 && rise < 46) { out.point.y = box.max.y - 0.5; out.top = true; }
      else if (rise <= 1.2) out.top = true;
    }
    return out;
  }

  _tryLaunch(input, wish) {
    const g = this.game, L = this.mv.launch;
    let a = this._findAnchor(wish);
    let enemy = null;
    if (L.enemyZip) {
      // snap to an enemy under the reticle (Carnage zips onto targets)
      const t = this.findTarget(L.range, 22);
      if (t && g.physics.lineOfSight(this.center, t.center ?? t.pos)) {
        enemy = t;
        _a.copy(enemyCenter(t, _b)).sub(this.center); const d = _a.length();
        a = { point: enemyCenter(t, new V3()), normal: _a.clone().multiplyScalar(-1 / Math.max(d, 0.01)), dist: d };
      }
    }
    if (!a && L.airDash) {
      g.cam.aimDirection(_d).normalize();
      const h = g.physics.raycast(this.center, _d, L.airDash, { ignoreGround: true });
      const dd = h ? Math.max(2, h.distance - 1.2) : L.airDash;
      a = { point: this.center.clone().addScaledVector(_d, dd), normal: _d.clone().negate(), dist: dd, free: true };
    }
    if (!a) { this.cooldowns.launch = 0.2; return false; }
    this.useCooldown('launch', L.cd);
    this.anchor.copy(a.point); this.anchorN.copy(a.normal);
    this.launchWall = !a.free && Math.abs(a.normal.y) < 0.5 && !enemy; this.launchTop = !!a.top;
    this.launchTarget = enemy;
    // pull destination = the point the hero's centre should reach
    if (enemy) this.dest.copy(a.point).addScaledVector(a.normal, 1.6);
    else if (a.free) this.dest.copy(a.point);
    else if (a.normal.y > 0.5) this.dest.copy(a.point).y += this.height * 0.6;
    else { this.dest.copy(a.point).addScaledVector(a.normal, this.radius + 0.3); if (a.top) this.dest.y += 1.1; }
    this.state = 'launch'; this.stateT = 0; this.launchT = 0; this._stall = 0;
    this.launchSp = Math.max(this.vel.length() * 0.8, L.startSp ?? 14);
    this.gravityScale = 0; this.jumpBoostT = 0; this.dashT = 0; this.onGround = false;
    this.rope = this._pool().spawn({ from: (out) => objPos(this.model.handR, out, this.center), to: this.anchor, life: 3, grow: 0.07, width: L.width ?? 0.14, wiggle: 0.35, arc: 0.04, retract: 0.18 });
    g.audio?.play('zip'); g.audio?.play('symbiote', { volume: 0.4 });
    g.fx?.burst?.(this.anchor, this.mv.fxColor ?? 0x7a2bd0, 10, 4, 0.4, 0.3);
    g.fx?.ring?.(this.anchor, 1.2, this.mv.fxColor ?? 0x7a2bd0, 0.3);
    this.setAnim(L.anim ?? 'swing', 12);
    this.yaw = Math.atan2(this.dest.x - this.pos.x, this.dest.z - this.pos.z);
    return true;
  }

  _endLaunch(arrived) {
    const L = this.mv.launch;
    this.state = 'free'; this.stateT = 0; this.gravityScale = 1;
    this.retractRope();
    this.airT = 0.2; this.airJumps = 1;
    if (arrived && this.launchWall && !this.launchTarget && this.launchTop) {
      // landed on the roof edge: vault over it
      this.vel.set(-this.anchorN.x * 7, 14, -this.anchorN.z * 7);
      this.wallLock = 0.6; this.stickWall = 0; this.yaw = Math.atan2(-this.anchorN.x, -this.anchorN.z);
      this.game.audio?.play('whoosh', { volume: 0.6 });
    } else if (arrived && this.launchWall && !this.launchTarget) {
      this.vel.multiplyScalar(0.25); this.vel.addScaledVector(this.anchorN, -2);
      this.stickWall = 0.55; this.wallLock = 0;
    } else {
      this.vel.multiplyScalar(L.keep ?? 0.85);
      if (arrived && L.releaseUp) this.vel.y = Math.max(this.vel.y, 0) + L.releaseUp;
    }
    this.onLaunchEnd?.(arrived, this.launchTarget);
    this.launchTarget = null;
  }

  _updateLaunch(dt, input, wish, mag) {
    const g = this.game, L = this.mv.launch;
    this.launchT += dt;
    this.gravityScale = 0;
    // follow a moving target
    if (this.launchTarget) {
      if (!this.launchTarget.alive) { this._endLaunch(false); return; }
      enemyCenter(this.launchTarget, this.anchor);
      _a.copy(this.anchor).sub(this.center).normalize();
      this.dest.copy(this.anchor).addScaledVector(_a, -1.6);
    }
    _a.subVectors(this.dest, this.center);
    const d = _a.length();
    if (d < (L.endDist ?? 1.8) || this.launchT > L.maxT) { this._endLaunch(d < (L.endDist ?? 1.8) + 2.5); return; }
    _a.multiplyScalar(1 / Math.max(d, 0.001));
    this.launchSp = approach(this.launchSp, L.speed, (L.accel ?? 70) * dt);
    // arc: bow upward early in the pull, flatten as we close in
    const bow = (L.lift ?? 0) * clamp(1 - this.launchT / 0.7, 0, 1) * clamp(d / 18, 0.2, 1);
    _b.copy(_a); _b.y += bow; _b.normalize();
    // lateral steering with the stick
    if (mag > 0.1 && L.steer) { _c.set(-_b.z, 0, _b.x); _b.addScaledVector(_c, wish.dot(_c) * L.steer * 0.04); _b.normalize(); }
    const spd = this.launchSp * (this.speedMul > 1 ? 1.1 : 1);
    const rate = (L.turn ?? 110) * dt;
    this.vel.x = approach(this.vel.x, _b.x * spd, rate);
    this.vel.y = approach(this.vel.y, _b.y * spd, rate);
    this.vel.z = approach(this.vel.z, _b.z * spd, rate);
    this.faceTowards(_a, dt, 12);
    this.setAnim(L.anim ?? 'swing', spd);
    if (Math.random() < 0.7) g.fx?.burst?.(_c.set(this.pos.x, this.pos.y + 1, this.pos.z), this.mv.fxColor ?? 0x7a2bd0, 1, 2, 0.3, 0.3);
    // jump = let go with a boost
    if (input.pressed('jump') && this.launchT > 0.12) { this._endLaunch(false); this.vel.y += 7; this.jumpBoostT = 0; g.audio?.play('whoosh'); return; }
    if (input.pressed('dodge') && this.launchT > 0.1) { this._endLaunch(false); return; }
    // blocked: stalled against geometry
    const sp = this.vel.length();
    if (this.launchT > 0.25 && sp < spd * 0.25) this._stall += dt; else this._stall = 0;
    if (this._stall > 0.15) {
      if (this.onWall && d < 8) { this.stickWall = 0.5; this.state = 'free'; this.gravityScale = 1; this.retractRope(); this.launchTarget = null; return; }
      this._endLaunch(false);
    } else if (this.onWall && this.launchT > 0.2 && this.launchWall && d < 7 && !this.launchTop) {
      this._endLaunch(true);
    }
  }

  // ------------------------------------------------------------------ wall crawl
  _wallTall(n) {
    _b.set(this.pos.x, this.pos.y + this.height + 0.5, this.pos.z);
    _c.copy(n).negate();
    return !!this.game.physics.raycast(_b, _c, this.radius + 1.2, { ignoreGround: true });
  }
  _enterWall(n) {
    this.state = 'wall'; this.stateT = 0; this.wallN.copy(n); this.wallLost = 0; this.gravityScale = 0;
    this.vel.multiplyScalar(0.2); this.dashT = 0; this.jumpBoostT = 0; this.airJumps = 1;
    this.retractRope();
    this.game.audio?.play('claw', { volume: 0.6 });
    this.game.fx?.sparks?.(_a.set(this.pos.x - n.x * this.radius, this.pos.y + this.height * 0.6, this.pos.z - n.z * this.radius), n, 0xffd080, 8, 6, 0.3, 0.1);
    this.game.cam.shake(0.08);
  }
  _leaveWall() { this.state = 'free'; this.stateT = 0; this.gravityScale = 1; this.wallLock = 0.3; this.stickWall = 0; }

  _updateWall(dt, input, wish, mag) {
    const g = this.game, mv = this.mv;
    this.gravityScale = 0;
    if (this.onWall) { this.wallN.lerp(_a.copy(this.wallNormal).setY(0), 0.5); if (this.wallN.lengthSq() > 1e-4) this.wallN.normalize(); this.wallLost = 0; } else this.wallLost += dt;
    const n = this.wallN;

    // wall leap / drop
    if (input.pressed('jump')) {
      this.vel.set(n.x * mv.wallJumpOut, mv.wallJumpUp, n.z * mv.wallJumpOut);
      this.vel.addScaledVector(wish, 3);
      this._leaveWall(); this.jumpBoostT = (mv.boostT ?? 0) * 0.5; this.airT = 0.1;
      g.audio?.play('jump', { pitch: 0.7 }); g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 1, this.pos.z), 0x9a8f7a, 8, 4, 0.4, 0.3);
      this.setAnim('jump', 10); return;
    }
    if (input.pressed('dodge')) { this.vel.set(n.x * 6, -2, n.z * 6); this._leaveWall(); return; }
    if (mv.launch && input.pressed('swing') && (this.cooldowns.launch || 0) <= 0) {
      if (this._tryLaunch(input, wish)) return;
    }

    const t = _a.set(-n.z, 0, n.x);
    let up = mag > 0.05 ? clamp(-wish.dot(n), -1, 1) : 0;
    let side = mag > 0.05 ? wish.dot(t) : 0;
    if (mag > 0.05 && Math.abs(up) < 0.35 && Math.abs(side) < 0.35) { up = 0; side = 0; }
    if (this.actionT > 0) { up *= 0.3; side *= 0.3; }
    const speed = (input.down('sprint') ? mv.wallSprint : mv.wallSpeed) * this.speedMul;
    const tx = t.x * side * speed, tz = t.z * side * speed, ty = up * speed;
    const acc = 90 * dt, stick = this.onWall ? 2.5 : 7;
    this.vel.x = approach(this.vel.x, tx - n.x * stick, acc);
    this.vel.z = approach(this.vel.z, tz - n.z * stick, acc);
    this.vel.y = approach(this.vel.y, ty, acc);

    const box = this.wallContact ?? this.wallBox ?? this.lastContact;
    if (this.wallContact) this.wallBox = this.wallContact;
    // mantle over the roof edge
    if (box && box.data?.type !== 'prop' && this.vel.y > 1 && this.pos.y + 0.75 >= box.max.y && up > 0.15) {
      this.vel.set(-n.x * 6, 7.5, -n.z * 6);
      this.state = 'free'; this.stateT = 0; this.wallLock = 0.5; this.gravityScale = 1;
      this.yaw = Math.atan2(-n.x, -n.z); this.setAnim('jump', 6); g.audio?.play('whoosh', { volume: 0.5 });
      return;
    }
    if (this.onGround && up < -0.1) { this.state = 'free'; this.wallLock = 0.3; this.gravityScale = 1; return; }
    if (this.wallLost > 0.15) { this._leaveWall(); return; }

    const vn = this.vel.x * n.x + this.vel.z * n.z;
    const sp = Math.hypot(this.vel.x - n.x * vn, this.vel.z - n.z * vn, this.vel.y);
    if (this.actionT > 0 && this.actionAnim !== 'idle') this.setAnim(this.actionAnim, sp);
    else this.setAnim(sp > 1.2 ? 'wallrun' : 'wallidle', sp);
    this.yaw = Math.atan2(-n.x, -n.z);
    if (sp > 3 && Math.random() < 0.3) g.fx?.sparks?.(_b.set(this.pos.x - n.x * this.radius, this.pos.y + this.height * 0.6, this.pos.z - n.z * this.radius), n, 0xffd080, 2, 4, 0.2, 0.08);
    this.wallCrawlTick?.(dt, sp);
  }

  // ------------------------------------------------------------------ glide
  _updateGlide(dt, input, wish, mag) {
    const mv = this.mv, g = this.game;
    if (!input.down('jump') || this.onGround) { this.state = 'free'; this.stateT = 0; this.gravityScale = 1; return; }
    if (this._tryDodge(input, wish, mag)) { this.state = 'free'; this._dashMove(dt); return; }
    if (mv.launch && input.pressed('swing') && (this.cooldowns.launch || 0) <= 0 && this._tryLaunch(input, wish)) return;
    if (this.wallLock <= 0 && this.onWall && mag > 0.2) {
      _a.copy(this.wallNormal).setY(0).normalize();
      if (-wish.dot(_a) > 0.35) { this._enterWall(_a); return; }
    }
    this.gravityScale = 0;
    this.vel.y = approach(this.vel.y, mv.glideFall, 22 * dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (mag > 0.1) {
      const sp = Math.max(mv.glideSpeed * 0.6, Math.min(mv.glideSpeed, hs + 6 * dt));
      this.vel.x = approach(this.vel.x, wish.x * sp, 16 * dt); this.vel.z = approach(this.vel.z, wish.z * sp, 16 * dt);
    } else {
      this.vel.x = approach(this.vel.x, 0, 4 * dt); this.vel.z = approach(this.vel.z, 0, 4 * dt);
    }
    if (hs > 1) { _a.set(this.vel.x, 0, this.vel.z); this.faceTowards(_a, dt, 6); }
    this.setAnim('glide', hs);
    this.airT += dt;
    if (Math.random() < 0.25) g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 1.2, this.pos.z), this.mv.fxColor ?? 0x7a2bd0, 1, 1.5, 0.4, 0.25);
  }
}

export { rumble, clamp, damp, objPos };
