// v3 helpers (powers pass 2): car launching, fear, pooled debris. Additive to util.js.
import * as THREE from 'three';

const _v = new THREE.Vector3();

/** Toss every nearby car upward and away from `center`, dent it. Returns number launched. */
export function launchCars(game, center, radius, power = 12, dmg = 40) {
  let n = 0;
  for (const v of game.vehicles?.list ?? []) {
    if (!v.active || v.held || v.thrown || v === game.vehicles?.driving || v.sinking) continue;
    const dx = v.pos.x - center.x, dz = v.pos.z - center.z, d = Math.hypot(dx, dz);
    if (d > radius || Math.abs(v.pos.y - center.y) > 4) continue;
    const k = 1 - (d / radius) * 0.6;
    v.asleep = false; v.vy = power * k;
    if (v.vel?.set) v.vel.set((dx / (d || 1)) * power * 0.6 * k, 0, (dz / (d || 1)) * power * 0.6 * k);
    v.roll = (Math.random() - 0.5) * 0.5;
    v.damage?.(dmg * k, 'hulk');
    n++;
  }
  return n;
}

/** Make non-boss enemies run away from a point for a while. Call update() every frame, clear() on deactivate. */
export class FearList {
  constructor() { this.list = []; }
  add(e, secs, from) {
    if (!e || e.isBoss || !e.alive) return false;
    const f = this.list.find((x) => x.e === e);
    if (f) { f.t = Math.max(f.t, secs); f.from = from; } else this.list.push({ e, t: secs, from });
    e.interrupt?.();
    return true;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i], e = f.e;
      f.t -= dt;
      if (f.t <= 0 || !e.alive || e.removed) { this.list.splice(i, 1); continue; }
      if (e.stunned || e.webbed) continue;
      _v.set(e.pos.x - f.from.x, 0, e.pos.z - f.from.z);
      const d = _v.length() || 1; _v.multiplyScalar(1 / d);
      e.kbTimer = Math.max(e.kbTimer ?? 0, 0.1);
      e.vel.x = _v.x * 7.5; e.vel.z = _v.z * 7.5;
      e.yaw = Math.atan2(_v.x, _v.z);
      e.setAnim?.('run', 1.3);
    }
  }
  clear() { this.list.length = 0; }
}

/** Small pool of chunky debris / handhold meshes that pop out, fall and fade. */
export class DebrisPool {
  constructor(scene, n = 16, color = 0x6f685c) {
    this.scene = scene; this.list = []; this.cursor = 0;
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat); mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh); this.list.push({ mesh, t: 0, life: 0, on: false, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
  }
  spawn(pos, size = 0.3, life = 1.2, vel = null) {
    const o = this.list[this.cursor]; this.cursor = (this.cursor + 1) % this.list.length;
    o.on = true; o.t = 0; o.life = life; o.mesh.visible = true; o.mesh.position.copy(pos);
    o.mesh.scale.setScalar(size); o.size = size;
    o.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    if (vel) o.vel.copy(vel); else o.vel.set((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3);
    o.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  }
  update(dt) {
    for (const o of this.list) {
      if (!o.on) continue;
      o.t += dt;
      if (o.t >= o.life) { o.on = false; o.mesh.visible = false; continue; }
      o.vel.y -= 18 * dt; o.mesh.position.addScaledVector(o.vel, dt);
      if (o.mesh.position.y < 0.05 && o.vel.y < 0) { o.mesh.position.y = 0.05; o.vel.multiplyScalar(0.3); }
      o.mesh.rotation.x += o.spin.x * dt; o.mesh.rotation.y += o.spin.y * dt;
      const k = o.t / o.life; if (k > 0.7) o.mesh.scale.setScalar(o.size * (1 - (k - 0.7) / 0.3));
    }
  }
  clear() { for (const o of this.list) { o.on = false; o.mesh.visible = false; } }
  dispose() { for (const o of this.list) this.scene.remove(o.mesh); this.geo.dispose(); this.mat.dispose(); }
}
