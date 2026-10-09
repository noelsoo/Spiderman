// Third-person orbit camera with collision, speed-based FOV and screen shake.
import * as THREE from 'three';

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

  shake(amount) { this._shake = Math.min(1.5, this._shake + amount); }

  recenter(facingYaw) { this.yaw = facingYaw + Math.PI; this.pitch = -0.15; }

  /** Camera-relative move vector in world space from a 2D input. */
  moveVector(input2, out = new THREE.Vector3()) {
    return out.set(0, 0, 0).addScaledVector(this.forward, input2.y).addScaledVector(this.right, input2.x);
  }

  /** Direction the camera looks (full 3D), useful for aiming. */
  aimDirection(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  update(dt, targetPos, look, { speed = 0 } = {}) {
    const req = this._aimReq; this._aimReq = null;
    if (req) Object.assign(this.aimParams, { fov: 45, distance: 2.6, shoulder: 0.85, height: 1.55, sensitivity: null, blend: 12, scope: false }, req);
    const ap = this.aimParams;
    this.aimT = THREE.MathUtils.damp(this.aimT, req ? 1 : 0, ap.blend, dt);
    if (this.aimT < 0.001) this.aimT = 0;
    const a = this.aimT;
    const sens = 1 + ((ap.sensitivity ?? ap.fov / this.baseFov) - 1) * a;
    this.yaw += look.x * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * sens, -1.35, 1.1);
    const followDist = this.targetDistance + Math.min(speed * 0.05, 3) * (1 - a);
    this.distance = THREE.MathUtils.damp(this.distance, followDist + (ap.distance - followDist) * a, a > 0 ? 18 : 4, dt);

    this.target.copy(targetPos); this.target.y += this.heightOffset + (ap.height - this.heightOffset) * a;
    if (this._first) { this._smoothTarget.copy(this.target); this._first = false; }
    // stiff follow so fast swinging doesn't lag the hero off-screen
    const k = 1 - Math.exp(-18 * dt);
    this._smoothTarget.lerp(this.target, k);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
    const pivot = this._smoothTarget.clone().addScaledVector(this.right, this.shoulder + (ap.shoulder - this.shoulder) * a);

    // collision: pull the camera in front of walls
    let dist = this.distance;
    const hit = this.physics.raycast(pivot, back, dist + 0.3);
    if (hit) dist = Math.max(0.8, hit.distance - 0.3);
    const pos = pivot.clone().addScaledVector(back, dist);
    if (pos.y < 0.3) pos.y = 0.3;

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
