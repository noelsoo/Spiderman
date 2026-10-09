// One car: arcade bicycle-model dynamics shared by AI cars, parked cars and the car the player drives.
// pos = ground centre, yaw: forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw). steer > 0 turns right.
import * as THREE from 'three';
import { SPECS } from './models.js';

const GRAV = 26;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Vehicle {
  constructor(mgr, kind, id) {
    this.mgr = mgr; this.game = mgr.game; this.id = id;
    this.kind = kind; this.spec = SPECS[kind];
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.yawRate = 0; this.vy = 0;
    this.speed = 0;                 // signed forward speed, m/s
    this.slip = 0;                  // lateral speed (drift amount)
    this.steerAng = 0;              // wheel angle, rad (+ = right)
    this.ctrl = { t: 0, b: 0, s: 0, hb: false };
    this.maxHp = this.spec.hp; this.hp = this.maxHp;
    this.driver = null;             // 'ai' | 'player' | null
    this.group = new THREE.Group(); this.group.rotation.order = 'YXZ';
    this.model = null;              // CarModel while near the player
    this.color = new THREE.Color(1, 1, 1); this.hex = 0xffffff;
    this.active = false;            // part of the simulation (false = pooled / hidden)
    this.asleep = true;             // parked & motionless
    this.wrecked = false; this.wreckT = 0;
    this.thrown = false; this.held = false; this.sinking = 0;
    this.ai = null; this.parked = false; this.isPolice = kind === 'police';
    this.owned = false;             // the player has driven it before
    this.invuln = 0; this.hitCd = 0;
    this.airborne = false; this.accel = 0; this.latAcc = 0;
    this.smokeT = 0; this.slipT = 0; this.honkT = 0;
    this.chasing = false; this.dist = 0;
    this.rolled = 0;                // metres rolled this frame (wheel spin)
    this.group.visible = false;
  }

  get fwdX() { return Math.sin(this.yaw); }
  get fwdZ() { return Math.cos(this.yaw); }
  forward(out = _a) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out = _b) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }
  get radius() { return this.spec.L * 0.5; }
  explode() { this.mgr.explodeVehicle(this); }

  setKind(kind) { this.kind = kind; this.spec = SPECS[kind]; this.maxHp = this.spec.hp; this.isPolice = kind === 'police'; }

  place(x, z, yaw, speed = 0) {
    this.pos.set(x, 0, z); this.yaw = yaw; this.vy = 0; this.yawRate = 0; this.steerAng = 0; this.pitch = 0; this.roll = 0;
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    this.vel.set(sx * speed, 0, sz * speed); this.speed = speed; this.slip = 0;
    this.ctrl.t = this.ctrl.b = this.ctrl.s = 0; this.ctrl.hb = false;
    this.hp = this.maxHp; this.wrecked = false; this.wreckT = 0; this.sinking = 0; this.thrown = false; this.held = false;
    this.invuln = 0.5; this.asleep = speed === 0; this.airborne = false; this.chasing = false; this.active = true;
    this.driver = null; this.owned = false;
  }

  /** Arcade dynamics for one step. */
  step(dt) {
    const sp = this.spec, c = this.ctrl;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let fx = sy, fz = cy, rx = -cy, rz = sy;
    let vlon = this.vel.x * fx + this.vel.z * fz;
    let vlat = this.vel.x * rx + this.vel.z * rz;
    const v0 = vlon;
    const grounded = !this.airborne;

    // ---- engine / brakes
    let a = 0;
    const t = c.t, b = c.b;
    const rel = Math.abs(vlon) / sp.vmax;
    if (grounded) {
      if (t > 0.01) {
        if (vlon < -1.5) a += sp.brake * t;
        else a += sp.accel * t * (1 - Math.pow(Math.min(1, rel), 2.2)) * (vlon < 6 ? 1 + (6 - Math.max(0, vlon)) * 0.06 : 1);
      }
      if (b > 0.01) {
        if (vlon > 1.5) a -= sp.brake * b;
        else if (vlon > -sp.vmax * 0.28) a -= sp.accel * 0.85 * b * (1 - Math.pow(Math.min(1, -vlon / (sp.vmax * 0.28)), 2));
        else a += 0;
      }
      if (t < 0.01 && b < 0.01) a -= Math.sign(vlon) * Math.min(Math.abs(vlon) / Math.max(dt, 1e-3), 1.6 + rel * 2.5); // engine braking / rolling
      if (c.hb) a -= Math.sign(vlon) * Math.min(Math.abs(vlon) / Math.max(dt, 1e-3), 6.5);
    }
    vlon += a * dt;
    if (Math.abs(vlon) > sp.vmax * 1.04) vlon *= 1 - Math.min(1, 2.5 * dt);
    this.accel += (a - this.accel) * Math.min(1, 8 * dt);

    // ---- steering (bicycle model, grip limited)
    const sNorm = clamp(Math.abs(vlon) / (sp.vmax * 0.7), 0, 1);
    const maxAng = 0.62 - 0.5 * Math.pow(sNorm, 0.8);
    const target = c.s * maxAng;
    this.steerAng += (target - this.steerAng) * Math.min(1, (Math.abs(target) > Math.abs(this.steerAng) ? 7 : 11) * dt);
    let wTarget = grounded ? -(vlon / sp.wb) * Math.tan(this.steerAng) : 0;
    const latMax = sp.grip * 9.8 * 1.15;
    let wMax = latMax / Math.max(Math.abs(vlon), 3);
    if (c.hb && Math.abs(vlon) > 6) { wMax *= 1.9; wTarget *= 1.35; }
    wTarget = clamp(wTarget, -wMax, wMax);
    this.yawRate += (wTarget - this.yawRate) * Math.min(1, (c.hb ? 6 : 10) * dt);
    // keep spinning bodies from rotating forever
    if (!grounded) this.yawRate *= 1 - Math.min(1, 0.4 * dt);
    this.yaw += this.yawRate * dt;

    // ---- rebuild velocity in the old frame, then re-project onto the rotated frame
    const vx = fx * vlon + rx * vlat, vz = fz * vlon + rz * vlat;
    const sBefore = Math.hypot(vx, vz);
    const sy2 = Math.sin(this.yaw), cy2 = Math.cos(this.yaw);
    fx = sy2; fz = cy2; rx = -cy2; rz = sy2;
    let nl = vx * fx + vz * fz;
    let nt = vx * rx + vz * rz;
    if (grounded) {
      const slipping = Math.abs(nt) > 5.5 || (c.hb && Math.abs(nl) > 6);
      let k = c.hb ? 0.9 : slipping ? 3.2 : 9.5 * sp.grip;
      if (Math.abs(nt) > 9 && !c.hb) k = 2.2;
      const d = nt * (1 - Math.exp(-k * dt));
      nt -= d;
      nl += Math.sign(nl || 1) * Math.abs(d) * (c.hb ? 0.15 : 0.92);
      const sNow = Math.hypot(nl, nt);
      if (sNow > sBefore && sBefore > 0.01) { const s = sBefore / sNow; nl *= s; nt *= s; }
    }
    this.vel.x = fx * nl + rx * nt; this.vel.z = fz * nl + rz * nt;
    this.speed = nl; this.slip = nt;
    this.latAcc += (this.yawRate * nl - this.latAcc) * Math.min(1, 6 * dt);
    this.rolled = nl * dt;
    void v0;
  }

  /** Vertical motion + ground following. Returns landing impact speed (0 if none). */
  vertical(dt, groundF, groundR, groundC) {
    const gy = Math.max(groundC, (groundF + groundR) * 0.5);
    let impact = 0;
    if (this.pos.y > gy + 0.06 || this.vy > 0.8) {
      this.airborne = true;
      this.vy -= GRAV * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gy) {
        impact = -this.vy; this.pos.y = gy; this.vy = impact > 7 ? impact * 0.12 : 0; this.airborne = this.vy > 0.8;
      }
    } else {
      this.airborne = false;
      this.pos.y += (gy - this.pos.y) * Math.min(1, 25 * dt);
      this.vy = 0;
    }
    const L = this.spec.wb;
    const slope = Math.atan2(groundF - groundR, L);
    let pT = this.airborne ? clamp(-this.vy * 0.02, -0.3, 0.3) : -slope;
    pT += clamp(-this.accel * 0.0035, -0.05, 0.05);
    this.pitch += (pT - this.pitch) * Math.min(1, 9 * dt);
    const rT = clamp(this.latAcc * 0.0045, -0.08, 0.08);
    this.roll += (rT - this.roll) * Math.min(1, 8 * dt);
    return impact;
  }

  /** Apply damage; explodes at 0. src: 'crash' | 'bullet' | 'blast' | 'fire' ... */
  damage(n, src = 'crash') {
    if (this.wrecked || this.invuln > 0 || n <= 0) return;
    this.hp -= n;
    if (this.hp <= 0) { this.hp = 0; this.mgr.explodeVehicle(this, src); }
  }

  syncGroup() {
    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.set(this.pitch, this.yaw, this.roll);
  }
}
