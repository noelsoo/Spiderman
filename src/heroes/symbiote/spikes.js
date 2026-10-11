// Pooled ground spikes (Carnage Spike Field, Venom ultimate tendril spikes). Cones that erupt, hold and sink.
import * as THREE from 'three';

let GEO = null;
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export class SpikePool {
  constructor(scene, n = 36, material) {
    if (!GEO) { GEO = new THREE.ConeGeometry(1, 1, 6, 1); GEO.translate(0, 0.5, 0); }
    this.scene = scene; this.list = [];
    this.mat = material;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(GEO, material);
      m.visible = false; m.frustumCulled = false; m.castShadow = false;
      scene.add(m);
      this.list.push({ m, on: false, t: 0, delay: 0, life: 1, h: 1, r: 0.3 });
    }
    this.cursor = 0;
  }
  spawn(x, y, z, h = 2, r = 0.35, delay = 0, life = 0.9, tiltX = 0, tiltZ = 0) {
    const o = this.list[this.cursor]; this.cursor = (this.cursor + 1) % this.list.length;
    o.on = true; o.t = -delay; o.life = life; o.h = h; o.r = r;
    o.m.position.set(x, y - 0.05, z);
    o.m.rotation.set(tiltX, Math.random() * 6, tiltZ);
    o.m.scale.set(0.001, 0.001, 0.001); o.m.visible = false;
    return o;
  }
  update(dt) {
    for (const o of this.list) {
      if (!o.on) continue;
      o.t += dt;
      if (o.t < 0) continue;
      if (o.t >= o.life) { o.on = false; o.m.visible = false; continue; }
      const up = ease(o.t / 0.12), down = o.t > o.life - 0.3 ? 1 - ease((o.t - (o.life - 0.3)) / 0.3) : 1;
      const k = up * down;
      o.m.visible = true;
      o.m.scale.set(o.r * (0.4 + 0.6 * k), Math.max(0.001, o.h * k), o.r * (0.4 + 0.6 * k));
    }
  }
  clear() { for (const o of this.list) { o.on = false; o.m.visible = false; } }
  dispose() { for (const o of this.list) this.scene.remove(o.m); }
}
