// Third-person orbit camera with collision, speed-based FOV and screen shake.
import * as THREE from 'three';

const _cu = new THREE.Vector3(), _cs = new THREE.Vector3(), _co = new THREE.Vector3();
const RAYS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

export class ThirdPersonCamera {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = Math.PI;      // 0 looks toward -Z
    this.pitch = -0.15;
    this.distance = 6;
    this.targetDistance = 6;
    this.heightOffset = 1.6;
    this.shoulder = 0.6;     // over-the-shoulder offset
    this.baseFov = 70;
    this.fovKick = 0;        // heroes add speed-based FOV
    this.target = new THREE.Vector3();
    this._smoothTarget = new THREE.Vector3();
    this._shake = 0;
    this._first = true;
    // Aim-down-sights / scope zoom. Any system calls requestAim() every frame it wants to aim;
    // the camera blends in, and blends back out on frames with no request.
    this._aimReq = null;
    this.aimT = 0;             // 0 = hip, 1 = fully aimed (read-only for others)
    this.aimParams = { fov: 45, distance: 2.6, shoulder: 0.85, height: 1.55, sensitivity: null, blend: 12, scope: false };
    // player preferences from the settings menu; applied on top of whatever the heroes / vehicles set
    this.pref = { dist: 1, height: 0, shoulder: 1, autoRecenter: false, aimSens: 1, shakeScale: 1 };
    this._idle = 0;
    this.minDistance = 1.6;    // never closer than this to the hero's head (prevents clipping into the hero model)
    this.pivot = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1); // flattened, for movement
    this.right = new THREE.Vector3(1, 0, 0);
  }

  /**
   * Ask for an aimed view this frame. fov in degrees (smaller = more zoom; a 4x scope is ~ 70/4),
   * distance/shoulder/height override the follow offsets, sensitivity scales look speed (defaults to fov/baseFov),
   * scope=true tells the HUD to draw a scope overlay. Call every frame while aiming.
   */
  requestAim(params = {}) { this._aimReq = params; }
  get aiming() { return this.aimT > 0.5; }
  get scoped() { return this.aimT > 0.8 && !!this.aimParams.scope; }

  shake(amount) { this._shake = Math.min(1.5, this._shake + amount * this.pref.shakeScale); }

  recenter(facingYaw) { this.yaw = facingYaw + Math.PI; this.pitch = -0.15; }

  /** Camera-relative move vector in world space from a 2D input. */
  moveVector(input2, out = new THREE.Vector3()) {
    return out.set(0, 0, 0).addScaledVector(this.forward, input2.y).addScaledVector(this.right, input2.x);
  }

  /** Direction the camera looks (full 3D), useful for aiming. */
  aimDirection(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  update(dt, targetPos, look, { speed = 0, yaw } = {}) {
    const req = this._aimReq; this._aimReq = null;
    if (req) Object.assign(this.aimParams, { fov: 45, distance: 2.6, shoulder: 0.85, height: 1.55, sensitivity: null, blend: 12, scope: false }, req);
    const ap = this.aimParams;
    this.aimT = THREE.MathUtils.damp(this.aimT, req ? 1 : 0, ap.blend, dt);
    if (this.aimT < 0.001) this.aimT = 0;
    const a = this.aimT;
    const sens = (1 + ((ap.sensitivity ?? ap.fov / this.baseFov) - 1) * a) * (1 + (this.pref.aimSens - 1) * a);
    this._idle = (Math.abs(look.x) + Math.abs(look.y) > 1e-4) ? 0 : this._idle + dt;
    if (this.pref.autoRecenter && yaw !== undefined && speed > 5 && this._idle > 1.4 && a < 0.05) {
      let diff = (yaw + Math.PI - this.yaw) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2; else if (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * (1 - Math.exp(-1.6 * dt));
    }
    this.yaw += look.x * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * sens, -1.35, 1.1);
    const followDist = this.targetDistance * this.pref.dist + Math.min(speed * 0.05, 3) * (1 - a);
    this.distance = THREE.MathUtils.damp(this.distance, followDist + (ap.distance - followDist) * a, a > 0 ? 18 : 4, dt);

    this.target.copy(targetPos); const ho = this.heightOffset + this.pref.height;
    this.target.y += ho + (ap.height - ho) * a;
    if (this._first) { this._smoothTarget.copy(this.target); this._first = false; }
    // stiff follow so fast swinging doesn't lag the hero off-screen
    const k = 1 - Math.exp(-18 * dt);
    this._smoothTarget.lerp(this.target, k);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
    const sh = this.shoulder * this.pref.shoulder;
    const pivot = this._smoothTarget.clone().addScaledVector(this.right, sh + (ap.shoulder * this.pref.shoulder - sh) * a);

    // collision: a small "sphere cast" (centre ray + 4 offset rays) so the camera never clips into walls or corners.
    let dist = this.distance;
    const r = 0.35;
    const up = _cu.set(0, 1, 0), side = _cs.crossVectors(back, up).normalize();
    for (const [ox, oy] of RAYS) {
      const o = _co.copy(pivot).addScaledVector(side, ox * r).addScaledVector(up, oy * r);
      const hit = this.physics.raycast(o, back, dist + r);
      if (hit && hit.distance - r < dist) dist = Math.max(Math.min(0.8, this.distance), hit.distance - r);
    }
    // smooth the pull-in/out so the view doesn't pop when brushing past corners
    this._colDist = this._colDist === undefined ? dist : (dist < this._colDist ? dist : THREE.MathUtils.damp(this._colDist, dist, 6, dt));
    const pos = pivot.clone().addScaledVector(back, this._colDist);
    if (pos.y < 0.3) pos.y = 0.3;
    this.pivot.copy(pivot);

    if (this._shake > 0) {
      const s = this._shake * 0.35 * (1 - a * 0.8);
      pos.x += (Math.random() - 0.5) * s; pos.y += (Math.random() - 0.5) * s; pos.z += (Math.random() - 0.5) * s;
      this._shake = Math.max(0, this._shake - dt * 2.5);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(pivot);
    const hipFov = this.baseFov + Math.min(speed * 0.35, 22) + this.fovKick;
    const fov = hipFov + (ap.fov - hipFov) * a;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = a > 0 ? fov : THREE.MathUtils.damp(this.camera.fov, fov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
