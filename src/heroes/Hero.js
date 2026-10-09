// Base class for every playable hero. Subclasses (SpiderMan, IronMan, Hulk, Thor) override hooks.
//
// Coordinate conventions
//   - y is up, units are metres, ground is y = 0
//   - hero.pos is the FEET position
//   - hero.yaw is facing: forward = (sin(yaw), 0, cos(yaw)); models face +Z at yaw 0
//
// Update order each frame (driven by HeroManager in main.js):
//   hero.update(dt) -> updateAbilities(dt) -> (defaultMovement(dt) unless this.customMovement) -> physicsStep(dt) -> syncModel(dt)
import * as THREE from 'three';
import { buildCharacter } from '../models/index.js';

const _tmp = new THREE.Vector3();

export class Hero {
  /**
   * @param {object} game  shared game context (see main.js `Game`)
   * @param {object} cfg   stats: id, name, maxHp, walkSpeed, runSpeed, jumpSpeed, gravity, radius, height, color
   */
  constructor(game, cfg) {
    this.game = game;
    this.id = cfg.id;
    this.name = cfg.name;
    this.color = cfg.color ?? '#ffffff';
    this.maxHp = cfg.maxHp ?? 100;
    this.hp = this.maxHp;
    this.walkSpeed = cfg.walkSpeed ?? 6;
    this.runSpeed = cfg.runSpeed ?? 12;
    this.jumpSpeed = cfg.jumpSpeed ?? 9;
    this.gravity = cfg.gravity ?? 24;
    this.radius = cfg.radius ?? 0.45;
    this.height = cfg.height ?? 1.8;
    this.airControl = cfg.airControl ?? 0.35;
    this.mass = cfg.mass ?? 1;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.onGround = false;
    this.onWall = false;
    this.wallNormal = new THREE.Vector3();
    this.lastContact = null;          // last physics box touched
    this.wallContact = null;          // box of the wall currently touched (null when not on a wall)
    this.groundContact = null;        // box currently stood on (null on the street / in the air)
    this.customMovement = false;      // subclass sets true while swinging / flying / etc.
    this.gravityScale = 1;
    this.invuln = 0;                  // seconds of i-frames
    this.focus = 0;                   // 0..100, ultimate meter (fills from combat)
    this.combo = 0; this.comboTimer = 0;
    this.anim = { state: 'idle', t: 0, speed: 0, blend: 0 }; // read by the model
    this.cooldowns = {};              // name -> seconds remaining
    this.active = false;
    this.dead = false;

    // Aim convention (heroes with usesAim = true; ignored while a gun is equipped — the weapons system owns aiming):
    //   hold aim (RMB / L2) ≥ AIM_HOLD s → this.aiming (camera zooms to this.aimPreset automatically)
    //   quick tap of RMB → special, quick tap of L2 → ability2   (read via this.pressedSpecial() / this.pressedAbility2())
    //   while aiming, fire (LMB / R2) is claimed for the hero → this.fireDown() / this.firePressed()
    this.usesAim = cfg.usesAim ?? false;
    this.aimPreset = cfg.aimPreset ?? { fov: 50, distance: 2.4, shoulder: 0.85, height: 1.6 };
    this.aiming = false; this.aimTime = 0;
    this._aimDown = false; this._aimHeld = 0; this._aimSrc = null; this._aimTap = null; this._fire = false; this._firePrev = false;

    this.model = buildCharacter(cfg.modelId ?? cfg.id, { hero: this });
    this.model.group.visible = false;
    game.scene.add(this.model.group);
  }

  // ---- lifecycle -------------------------------------------------------
  activate(pos, vel, yaw) {
    this.active = true; this.dead = false;
    this.pos.copy(pos); if (vel) this.vel.copy(vel); else this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.model.group.visible = true;
    this.onActivate();
  }
  deactivate() { this.active = false; this.model.group.visible = false; this.customMovement = false; this.onDeactivate(); }

  // ---- hooks for subclasses ------------------------------------------
  onActivate() {}
  onDeactivate() {}
  /** Read input, fire abilities, set customMovement. */
  updateAbilities(dt) {}
  /** Extra per-frame visuals (weblines, thrusters, lightning). Called after physics. */
  updateVisuals(dt) {}
  /** HUD ability list: [{ action: 'special', label: 'Web Shot', cooldown: 0..1 }] */
  get abilityHints() { return []; }

  // ---- main update ---------------------------------------------------
  update(dt) {
    const input = this.game.input;
    for (const k in this.cooldowns) if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    this.anim.t += dt;

    this._updateAim(dt, input);
    if (!this.dead) this.updateAbilities(dt, input);
    if (!this.customMovement && !this.dead) this.defaultMovement(dt, input);
    this.physicsStep(dt);
    this.syncModel(dt);
    this.updateVisuals(dt);
  }

  _updateAim(dt, input) {
    this._aimTap = null; this._firePrev = this._fire; this._fire = false;
    if (!this.usesAim || this.game.weapons?.equipped || this.dead) {
      this.aiming = false; this.aimTime = 0; this._aimDown = false; return;
    }
    const src = input.sources?.aim ?? [];
    const down = input.down('aim');
    if (down && !this._aimDown) { this._aimDown = true; this._aimHeld = 0; this._aimSrc = src.some((s) => s[0] === 'm:2') ? 'mouse' : 'pad'; }
    if (down) this._aimHeld += dt;
    if (!down && this._aimDown) {
      this._aimDown = false;
      if (this._aimHeld < AIM_HOLD) this._aimTap = this._aimSrc === 'mouse' ? 'special' : 'ability2';
    }
    // the shared physical button is ours now: stop it also triggering special / ability2 immediately
    if (down) input.consume('aim');
    this.aiming = down && this._aimHeld >= AIM_HOLD;
    this.aimTime = this.aiming ? this.aimTime + dt : 0;
    if (this.aiming) {
      this._fire = input.down('fire');
      input.consume('fire');                   // R2 / LMB fire instead of swing / punch while aiming
      this.game.cam.requestAim(this.aimPreset);
      const f = this.game.cam.forward; this.faceTowards(f, dt, 20);
    }
  }
  pressedSpecial() { return this.game.input.pressed('special') || this._aimTap === 'special'; }
  pressedAbility2() { return this.game.input.pressed('ability2') || this._aimTap === 'ability2'; }
  fireDown() { return this._fire; }
  firePressed() { return this._fire && !this._firePrev; }

  /** Walk/run/jump with camera-relative controls. */
  defaultMovement(dt, input) {
    const cam = this.game.cam;
    const wish = cam.moveVector(input.move, _tmp);
    const mag = Math.min(1, wish.length());
    const sprint = input.down('sprint') || input.move.length() > 0.95 && this.game.settings?.autoSprint;
    const speed = (sprint ? this.runSpeed : this.walkSpeed) * mag;
    if (mag > 0.01) wish.normalize();

    const control = this.onGround ? 1 : this.airControl;
    const accel = this.onGround ? 60 : 14;
    const tx = wish.x * speed, tz = wish.z * speed;
    this.vel.x = approach(this.vel.x, tx, accel * control * dt);
    this.vel.z = approach(this.vel.z, tz, accel * control * dt);
    if (mag > 0.01) this.faceTowards(wish, dt, this.onGround ? 14 : 6);

    if (this.onGround && input.pressed('jump')) {
      this.vel.y = this.jumpSpeed; this.onGround = false;
      this.game.audio?.play('jump');
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) this.setAnim(hs > 0.5 ? (hs > this.walkSpeed + 0.5 ? 'sprint' : 'run') : 'idle', hs);
    else this.setAnim(this.vel.y > 0 ? 'jump' : 'fall', hs);
  }

  /** Integrate velocity + gravity and collide with the city. */
  physicsStep(dt) {
    if (this.gravityScale) this.vel.y -= this.gravity * this.gravityScale * dt;
    const maxFall = -80;
    if (this.vel.y < maxFall) this.vel.y = maxFall;
    // sub-step fast movement so we don't tunnel through thin buildings
    const dist = this.vel.length() * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(dist / (this.radius * 0.9))));
    const sdt = dt / steps;
    let onGround = false, onWall = false, wallBox = null, groundBox = null;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, sdt);
      const res = this.game.physics.resolveCapsule(this.pos, this.radius, this.height, this.vel);
      if (res.onGround) onGround = true;
      if (res.onWall) { onWall = true; wallBox = res.wallBox; this.wallNormal.copy(res.wallNormal); }
      if (res.onGround) groundBox = res.groundBox;
      if (res.box) this.lastContact = res.box;
    }
    const wasAir = !this.onGround;
    this.onGround = onGround; this.onWall = onWall;
    this.wallContact = wallBox; this.groundContact = groundBox;
    if (wasAir && onGround) this.onLand?.(dt);
    this.game.world?.constrain?.(this);
  }

  syncModel(dt) {
    const g = this.model.group;
    g.position.copy(this.pos);
    if (!this.model.customRotation) g.rotation.set(0, this.yaw, 0);
    this.model.update?.(dt, this.anim, this);
  }

  // ---- helpers -------------------------------------------------------
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }

  faceTowards(dir, dt, rate = 12) {
    if (dir.x * dir.x + dir.z * dir.z < 1e-6) return;
    const target = Math.atan2(dir.x, dir.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, rate * dt);
  }

  setAnim(state, speed = 0) {
    if (this.anim.state !== state) { this.anim.state = state; this.anim.t = 0; }
    this.anim.speed = speed;
  }

  /** Is a cooldown ready? If so start it and return true. */
  useCooldown(name, seconds) {
    if ((this.cooldowns[name] || 0) > 0) return false;
    this.cooldowns[name] = seconds; this._cdMax = this._cdMax || {}; this._cdMax[name] = seconds;
    return true;
  }
  cooldownFrac(name) { const m = this._cdMax?.[name]; return m ? (this.cooldowns[name] || 0) / m : 0; }

  addFocus(n) { this.focus = Math.min(100, this.focus + n); }
  registerHit() { this.combo++; this.comboTimer = 2.5; this.addFocus(4); }

  /** Aim assist: nearest living enemy in front of the hero/camera within range. */
  findTarget(range = 25, coneDeg = 60) {
    return this.game.enemies?.findTarget?.(this.center, this.game.cam.forward, range, coneDeg) ?? null;
  }

  takeDamage(amount, fromPos) {
    if (this.dead || this.invuln > 0) return false;
    this.hp -= amount;
    this.invuln = 0.35;
    this.combo = 0;
    if (fromPos) {
      _tmp.subVectors(this.pos, fromPos).setY(0).normalize();
      this.vel.addScaledVector(_tmp, 6 / this.mass); this.vel.y += 3 / this.mass;
    }
    this.game.hud?.damageFlash?.();
    this.game.input.rumble(0.7, 0.4, 180);
    this.game.cam.shake(0.25);
    this.game.audio?.play('hurt');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.setAnim('dead'); this.game.onPlayerDown?.(this); }
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
}

const AIM_HOLD = 0.18;

export function approach(v, target, delta) {
  return v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);
}
