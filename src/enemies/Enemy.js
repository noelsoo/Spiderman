// Enemy base class: ground physics, knockback/launch/stun/web/death state, model sync.
// Subclasses implement ai(dt) (set this.wish, this.faceYaw/this.lookAt..., this.anim via setAnim) and optionally interrupt().
import * as THREE from 'three';
import { buildCharacter } from '../models/index.js';

const _v = new THREE.Vector3();
const TAU = Math.PI * 2;
export const rnd = (a, b) => a + Math.random() * (b - a);

let COCOON = null;
function cocoonAssets() {
  if (COCOON) return COCOON;
  COCOON = {
    geo: new THREE.SphereGeometry(1, 12, 9),
    fill: new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }),
    wire: new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.95, toneMapped: false }),
  };
  return COCOON;
}

export class Enemy {
  /**
   * @param cfg { kind, modelId, hp, radius, height, speed, mass, gravity, isBoss, name }
   */
  constructor(game, manager, cfg) {
    this.game = game; this.manager = manager;
    this.kind = cfg.kind; this.isBoss = !!cfg.isBoss; this.team = 'enemy';
    this.name = cfg.name ?? cfg.kind;
    this.maxHp = cfg.hp; this.hp = cfg.hp;
    this.radius = cfg.radius ?? 0.45; this.height = cfg.height ?? 1.85;
    this.speed = cfg.speed ?? 5; this.mass = cfg.mass ?? 1; this.gravity = cfg.gravity ?? 28;
    this.alive = true; this.untargetable = false;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.yaw = Math.random() * TAU;
    this.onGround = false;
    this.wish = new THREE.Vector3();      // desired horizontal velocity (m/s), set by ai()
    this.anim = { state: 'idle', t: 0, speed: 0, blend: 0 };
    this.windup = 0;                       // seconds until an attack lands (spider-sense reads this)
    this.attacking = false;                // true during windup/strike
    this.state = 'chase'; this.stateT = 0;

    this.stunTimer = 0; this.webTimer = 0; this.slowTimer = 0; this.kbTimer = 0; this.flash = 0; this.invuln = 0;
    this.launched = false; this.downTimer = 0; this.tumble = 0;
    this.deathT = 0; this.removed = false; this.ballistic = false;
    this.damageTaken = 1; this.superArmor = !!cfg.isBoss;
    this.hasLOS = true; this._losT = Math.random() * 0.3;
    this._stuck = 0; this._stuckDir = 0; this._lastX = 0; this._lastZ = 0;
    this.dist = 99; this.dx = 0; this.dz = 0;       // horizontal vector/dist to player, refreshed each update
    this.target = null;
    this.hitCount = 0;

    this.model = buildCharacter(cfg.modelId ?? cfg.kind, {});
    const k = this.height / (this.model.height || this.height);
    this.k = k;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.root.add(this.model.group);
    this.root.scale.setScalar(k);
    this.model.group.position.y = -(this.model.height || this.height) * 0.5;
    this.model.group.traverse?.((o) => { if (o.isMesh) o.castShadow = true; });
    game.scene.add(this.root);
    this.cocoon = null;
  }

  // ------------------------------------------------------------------ state getters
  get stunned() { return this.stunTimer > 0 || this.launched || this.downTimer > 0; }
  get webbed() { return this.webTimer > 0; }

  spawnAt(pos, yaw = 0) {
    this.pos.copy(pos); this.vel.set(0, 0, 0); this.yaw = yaw;
    this._lastX = pos.x; this._lastZ = pos.z;
    this.invuln = 0.6;
    this.center.set(pos.x, pos.y + this.height * 0.55, pos.z);
    this._syncModel(0);
    return this;
  }

  // ------------------------------------------------------------------ damage
  takeDamage(amount, o = {}) {
    if (!this.alive || this.invuln > 0 || amount <= 0) return 0;
    amount *= this.damageTaken;
    this.hp -= amount; this.flash = 0.14; this.hitCount++;
    const kb = o.knockback;
    const m = 1 / this.mass;
    if (kb) {
      this.vel.x += kb.x * m; this.vel.z += kb.z * m;
      if (kb.y > 0) this.vel.y = Math.max(this.vel.y, kb.y * m);
      if (!this.superArmor && kb.x * kb.x + kb.z * kb.z > 1) this.kbTimer = 0.28;
    }
    const heavy = (kb && kb.y * m >= 4.5) || amount >= 34;
    if (this.hp <= 0) { this.hp = 0; this.die(o); return amount; }
    if (!this.superArmor) {
      if (heavy && this.mass < 3) this.launch(o);
      else if ((o.stun ?? 0) > 0) this._stun(o.stun);
    }
    this.onDamaged?.(amount, o);
    return amount;
  }

  _stun(s) {
    this.stunTimer = Math.max(this.stunTimer, s);
    this.interrupt();
  }

  launch(o = {}) {
    if (this.launched) return;
    this.launched = true; this.tumble = 0;
    this.stunTimer = Math.max(this.stunTimer, 0.5);
    if (this.vel.y < 4) this.vel.y = 5;
    this.interrupt();
    this.onGround = false;
  }

  /** Spider-Man web stun. */
  web(seconds = 2.5) {
    if (!this.alive) return;
    if (this.isBoss) { this.slowTimer = Math.max(this.slowTimer, Math.min(seconds, 1.5)); return; }
    this.webTimer = Math.max(this.webTimer, seconds);
    this.vel.x = 0; this.vel.z = 0;
    this.interrupt();
    if (!this.cocoon) {
      const A = cocoonAssets();
      const mh = this.model.height || this.height;
      this.cocoon = new THREE.Group();
      const fill = new THREE.Mesh(A.geo, A.fill), wire = new THREE.Mesh(A.geo, A.wire);
      this.cocoon.add(fill, wire);
      this.cocoon.scale.set(0.55 * mh * 0.55, 0.62 * mh * 0.5, 0.55 * mh * 0.55);
      this.cocoon.position.y = -0.02 * mh;
      this.root.add(this.cocoon);
    }
    this.cocoon.visible = true;
    this.game.fx.burst(this.center, 0xffffff, 12, 3, 0.4, 0.18);
  }

  /** Cancel any running attack (called on stun / launch / web). */
  interrupt() {
    this.windup = 0; this.attacking = false;
    this.manager.releaseToken(this);
    this.onInterrupt?.();
  }

  die(o = {}) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.deathT = 0; this.windup = 0; this.attacking = false; this.ballistic = false;
    this.launched = false; this.webTimer = 0; if (this.cocoon) this.cocoon.visible = false;
    this.manager.releaseToken(this);
    this.setAnim('dead', 1);
    const fx = this.game.fx;
    fx.burst(this.center, 0x6a2aa8, 22, 6, 0.7, 0.3);
    fx.smoke(this.center, 1.1, 1, null, 0.04);
    if (!this.isBoss) this.game.audio?.play?.('goon_die', { pos: this.pos });
    const kb = o.knockback;
    if (kb) { this.vel.x += kb.x / this.mass * 0.6; this.vel.z += kb.z / this.mass * 0.6; this.vel.y = Math.max(this.vel.y, 3); }
    this.model.setTint?.(0x000000, 0);
    this.onDeath?.(o);
    this.manager.onKill(this);
  }

  setAnim(state, speed = 1) {
    if (this.anim.state !== state) { this.anim.state = state; this.anim.t = 0; }
    this.anim.speed = speed;
  }

  // ------------------------------------------------------------------ steering helpers
  /** Move toward a point at speed (with stuck detection / sidestep). */
  moveToward(tx, tz, speed) {
    let dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.wish.set(0, 0, 0); return d; }
    dx /= d; dz /= d;
    if (this._stuck > 0) {
      const a = this._stuckDir * 1.2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = dx * c - dz * s, nz = dx * s + dz * c; dx = nx; dz = nz;
    }
    this.wish.set(dx * speed, 0, dz * speed);
    return d;
  }

  strafe(dirSign, speed) {
    // perpendicular to the direction to player
    const d = this.dist || 1;
    const px = this.dx / d, pz = this.dz / d;
    this.wish.set(-pz * dirSign * speed, 0, px * dirSign * speed);
  }

  faceYawTo(yaw, dt, rate = 8) {
    let d = yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, rate * dt);
  }
  facePlayer(dt, rate = 8) { if (this.target) this.faceYawTo(Math.atan2(this.dx, this.dz), dt, rate); }
  forward(out = _v) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  get eyePos() { return _v.set(this.pos.x, this.pos.y + this.height * 0.9, this.pos.z); }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    if (!this.alive) { this._deadUpdate(dt); return; }
    this.stateT += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) {
      this.flash -= dt;
      this.model.setTint?.(0xffffff, Math.max(0, this.flash / 0.14) * 0.8);
    }
    if (this.slowTimer > 0) this.slowTimer -= dt;
    if (this.kbTimer > 0) this.kbTimer -= dt;
    if (this.stunTimer > 0) this.stunTimer -= dt;
    if (this.downTimer > 0) this.downTimer -= dt;
    if (this.webTimer > 0) {
      this.webTimer -= dt;
      if (this.webTimer <= 0 && this.cocoon) { this.cocoon.visible = false; g.fx.burst(this.center, 0xffffff, 10, 3, 0.35, 0.18); }
    }

    const pl = g.player;
    this.target = pl && !pl.dead ? pl : null;
    if (pl) {
      this.dx = pl.pos.x - this.pos.x; this.dz = pl.pos.z - this.pos.z;
      this.dist = Math.hypot(this.dx, this.dz);
    }
    // staggered LOS test
    this._losT -= dt;
    if (this._losT <= 0) {
      this._losT = 0.3 + Math.random() * 0.15;
      if (pl) this.hasLOS = g.physics.lineOfSight(this.eyePos, pl.center);
    }

    const incapacitated = this.stunned || this.webbed || this.kbTimer > 0;
    this.wish.set(0, 0, 0);
    if (!incapacitated) this.ai(dt);
    else if (this.webbed) this.setAnim('stunned', 0.4);
    else if (this.launched) this.setAnim('stunned', 1.4);
    else if (this.downTimer > 0) this.setAnim('stunned', 0.6);
    else if (this.stunTimer > 0) this.setAnim('stunned', 1);

    this._physics(dt, incapacitated);
    this._syncModel(dt);
  }

  ai(dt) {}

  _physics(dt, incapacitated) {
    const phys = this.game.physics;
    const v = this.vel;
    const slow = this.slowTimer > 0 ? 0.45 : 1;
    if (this.ballistic) { /* airborne leap: no steering, no friction */ }
    else if (!incapacitated) {
      const accel = this.onGround ? 40 : 6;
      const tx = this.wish.x * slow, tz = this.wish.z * slow;
      const a = accel * dt;
      v.x += clamp(tx - v.x, -a, a); v.z += clamp(tz - v.z, -a, a);
    } else {
      const f = this.onGround ? (this.launched ? 1.5 : 5) : 0.3;
      const k = 1 / (1 + f * dt);
      v.x *= k; v.z *= k;
    }
    v.y -= this.gravity * dt;
    if (v.y < -60) v.y = -60;

    const dist = v.length() * dt;
    const steps = Math.min(6, Math.max(1, Math.ceil(dist / (this.radius * 0.9))));
    const sdt = dt / steps;
    let onGround = false;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(v, sdt);
      const res = phys.resolveCapsule(this.pos, this.radius, this.height, v);
      if (res.onGround) onGround = true;
    }
    const was = this.onGround;
    this.onGround = onGround;
    this.game.world?.constrain?.(this);
    if (!was && onGround) this._land();

    // stuck detection (only while trying to move)
    if (this.wish.lengthSq() > 1 && !incapacitated) {
      const moved = Math.hypot(this.pos.x - this._lastX, this.pos.z - this._lastZ);
      if (moved < this.wish.length() * dt * 0.25) {
        this._stuckT = (this._stuckT || 0) + dt;
        if (this._stuckT > 0.5 && this._stuck <= 0) { this._stuck = 0.9; this._stuckDir = Math.random() < 0.5 ? -1 : 1; this._stuckT = 0; }
      } else this._stuckT = 0;
    }
    if (this._stuck > 0) this._stuck -= dt;
    this._lastX = this.pos.x; this._lastZ = this.pos.z;
    this.center.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }

  _land() {
    if (this.launched) {
      this.launched = false;
      this.downTimer = 0.55; this.stunTimer = Math.max(this.stunTimer, 0.3);
      this.game.fx.dust(this.pos, 5, 1.6);
    }
    this.onLand?.();
  }

  _syncModel(dt) {
    const r = this.root;
    // tumble while launched, lie on back while down, then get up
    if (this.launched) this.tumble = Math.max(this.tumble - 9 * dt, -TAU);
    else if (this.downTimer > 0.15 || (!this.alive && this.deathT < 99)) {
      const target = -Math.PI / 2;
      let t0 = this.tumble % TAU; if (t0 < -Math.PI) t0 += TAU; if (t0 > 0) t0 -= TAU;
      this.tumble = t0 + (target - t0) * Math.min(1, 14 * dt);
    } else this.tumble += (0 - this.tumble) * Math.min(1, 10 * dt);
    const lie = Math.min(1, Math.abs(this.tumble) / (Math.PI / 2));
    const hy = this.height * 0.5;
    r.position.set(this.pos.x, this.pos.y + hy - (this.sink || 0) - lie * 0.12 * this.height, this.pos.z);
    r.rotation.set(this.tumble, this.yaw, 0);
    this.anim.t += dt;
    if (this.model.group.visible) {
      this.model.group.position.y = -(this.model.height || this.height) * 0.5;
      this.model.update?.(dt, this.anim, this);
    }
  }

  _deadUpdate(dt) {
    this.deathT += dt;
    if (this.deathT < 1.6) {
      this._physics(dt, true);
    }
    const lin = this.isBoss ? 1.5 : 0;
    if (this.deathT > 1.5 + lin) {
      this.sink = (this.sink || 0) + dt * 0.9;
      if (Math.random() < 0.6) { _v.set(this.pos.x + rnd(-0.4, 0.4), this.pos.y + 0.2, this.pos.z + rnd(-0.4, 0.4)); this.game.fx.burst(_v, 0x4a1a80, 1, 1.5, 0.6, 0.25); }
    }
    this._syncModel(dt);
    if (this.deathT > 2.8 + lin) this.removed = true;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.model.dispose?.();
  }
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
