// Instanced trees, street lamps, traffic, clouds and steam vents. All cheap.
import * as THREE from 'three';
import { Bucket } from './geo.js';
import { avenueX, streetZ } from './city.js';

const _o = new THREE.Object3D();
const _c = new THREE.Color();

export function makeTreesAndLamps(ctx, group) {
  const all = ctx.trees;
  const makeSet = (trees, detail) => {
    if (!trees.length) return;
    const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 3.4, 5); trunkG.translate(0, 1.7, 0);
    const canG = new THREE.IcosahedronGeometry(2.6, detail); canG.scale(1, 1.15, 1); canG.translate(0, 5.4, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x4a3322 }), trees.length);
    const can = new THREE.InstancedMesh(canG, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
    trees.forEach((t, i) => {
      _o.position.set(t[0], 0, t[1]); _o.rotation.set(0, t[3] * 6.28, 0); _o.scale.setScalar(t[2]); _o.updateMatrix();
      trunk.setMatrixAt(i, _o.matrix); can.setMatrixAt(i, _o.matrix);
      const r = t[3];
      if (r < 0.12) _c.setRGB(0.5, 0.28, 0.05); else if (r < 0.2) _c.setRGB(0.55, 0.4, 0.06);
      else _c.setRGB(0.1 + r * 0.12, 0.26 + r * 0.16, 0.05 + r * 0.05);
      can.setColorAt(i, _c);
    });
    can.castShadow = true; can.receiveShadow = true; trunk.receiveShadow = true;
    group.add(trunk, can);
  };
  makeSet(all.filter((t) => t[4]), 1);
  makeSet(all.filter((t) => !t[4]), 0);
  if (ctx.lamps.length) {
    const poleG = new THREE.CylinderGeometry(0.09, 0.14, 8.6, 5); poleG.translate(0, 4.3, 0);
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x25282a }), ctx.lamps.length);
    const headG = new THREE.BoxGeometry(0.5, 0.18, 1.1);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.4, 1.2) }), ctx.lamps.length);
    ctx.lamps.forEach(([x, z, dx, dz], i) => {
      _o.position.set(x, 0, z); _o.rotation.set(0, 0, 0); _o.scale.setScalar(1); _o.updateMatrix();
      poles.setMatrixAt(i, _o.matrix);
      _o.position.set(x + dx * 0.9, 8.5, z + dz * 0.9); _o.rotation.set(0, Math.atan2(dx, dz), 0); _o.updateMatrix();
      heads.setMatrixAt(i, _o.matrix);
    });
    poles.castShadow = false;
    group.add(poles, heads);
  }
}

export class Traffic {
  constructor(rng, group, quality) {
    const N = quality === 'high' ? 520 : quality === 'medium' ? 320 : 140;
    const body = new Bucket(), lights = new Bucket();
    // faces +Z
    body.boxClosed(-0.95, 0.18, -2.15, 0.95, 0.55, 2.15, 2, [0.07, 0.07, 0.08]);
    body.boxClosed(-0.95, 0.55, -2.15, 0.95, 1.05, 2.15, 2, [1, 1, 1]);
    body.boxClosed(-0.82, 1.05, -1.2, 0.82, 1.55, 1.25, 2, [0.33, 0.38, 0.45]);
    for (const x of [-0.7, 0.7]) lights.boxAll(x - 0.22, 0.62, 2.14, x + 0.22, 0.86, 2.2, 1, [5, 4.4, 3.2]);
    for (const x of [-0.7, 0.7]) lights.boxAll(x - 0.22, 0.66, -2.2, x + 0.22, 0.86, -2.14, 1, [4, 0.15, 0.1]);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.body = new THREE.InstancedMesh(body.toGeometry(), mat, N);
    this.lights = new THREE.InstancedMesh(lights.toGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), N);
    this.lights.instanceMatrix = this.body.instanceMatrix;
    this.body.frustumCulled = false; this.lights.frustumCulled = false;
    this.body.castShadow = false; this.body.receiveShadow = false;
    group.add(this.body, this.lights);

    const lanes = [];
    for (let a = 0; a < 11; a++) for (const off of [-8.25, -2.75, 2.75, 8.25]) lanes.push({ axis: 0, fixed: avenueX(a) + off, dir: off < 0 ? 1 : -1, min: -605, max: 605 });
    for (let s = 0; s < 18; s++) for (const off of [-4, 4]) lanes.push({ axis: 1, fixed: streetZ(s) + off, dir: off > 0 ? 1 : -1, min: -436, max: 605 });
    for (const l of lanes) { l.speed = 7 + rng() * 6; l.n = 0; }
    this.cars = [];
    const palette = [[0.02, 0.02, 0.025], [0.9, 0.9, 0.9], [0.55, 0.57, 0.6], [0.8, 0.12, 0.1], [0.1, 0.18, 0.4], [0.9, 0.62, 0.04], [0.9, 0.62, 0.04], [0.9, 0.62, 0.04], [0.25, 0.3, 0.28]];
    const assign = [];
    for (let i = 0; i < N; i++) { const l = lanes[(rng() * lanes.length) | 0]; l.n++; assign.push(l); }
    const idx = new Map();
    assign.forEach((l, i) => {
      const k = idx.get(l) || 0; idx.set(l, k + 1);
      const len = l.max - l.min, slot = len / l.n;
      const p = l.min + slot * (k + 0.15 + rng() * 0.7);
      const col = palette[(rng() * palette.length) | 0];
      this.cars.push({ l, p });
      this.body.setColorAt(i, _c.setRGB(col[0], col[1], col[2]));
    });
    this.N = N;
    this.step(0);
  }
  step(dt) {
    for (let i = 0; i < this.N; i++) {
      const c = this.cars[i], l = c.l;
      c.p += l.dir * l.speed * dt;
      if (c.p > l.max) c.p -= l.max - l.min; else if (c.p < l.min) c.p += l.max - l.min;
      if (l.axis === 0) { _o.position.set(l.fixed, 0, c.p); _o.rotation.y = l.dir > 0 ? 0 : Math.PI; }
      else { _o.position.set(c.p, 0, l.fixed); _o.rotation.y = l.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      _o.rotation.x = 0; _o.rotation.z = 0; _o.scale.set(1, 1, 1); _o.updateMatrix();
      this.body.setMatrixAt(i, _o.matrix);
    }
    this.body.instanceMatrix.needsUpdate = true;
  }
}

export class Clouds {
  constructor(rng, group, tex, quality) {
    const N = quality === 'low' ? 14 : 28;
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }), N);
    this.d = [];
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2, r = 400 + rng() * 2200;
      this.d.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: 420 + rng() * 380, s: 500 + rng() * 900, sp: 2 + rng() * 3 });
      this.mesh.setColorAt(i, _c.setRGB(1.5, 1.05 + rng() * 0.25, 0.8 + rng() * 0.3));
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    group.add(this.mesh);
    this.step(0);
  }
  step(dt) {
    for (let i = 0; i < this.d.length; i++) {
      const c = this.d[i];
      c.x += c.sp * dt; if (c.x > 2800) c.x = -2800;
      _o.position.set(c.x, c.y, c.z); _o.rotation.set(0, 0, 0); _o.scale.set(c.s, 1, c.s * 0.55); _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Steam {
  constructor(rng, group, tex, quality) {
    const vents = quality === 'low' ? 5 : 12, per = 16;
    this.n = vents * per;
    this.pos = new Float32Array(this.n * 3); this.col = new Float32Array(this.n * 3);
    this.base = []; this.age = new Float32Array(this.n);
    for (let v = 0; v < vents; v++) {
      const x = avenueX(1 + ((rng() * 8) | 0)) + (rng() < 0.5 ? -9.5 : 9.5), z = streetZ(2 + ((rng() * 14) | 0)) + (rng() < 0.5 ? -4 : 4);
      for (let k = 0; k < per; k++) { this.base.push(x, z); this.age[v * per + k] = rng() * 4; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size: 5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
    this.pts.frustumCulled = false;
    group.add(this.pts);
    this.step(0);
  }
  step(dt) {
    for (let i = 0; i < this.n; i++) {
      let a = this.age[i] + dt; if (a > 4) a -= 4; this.age[i] = a;
      const u = a / 4;
      this.pos[i * 3] = this.base[i * 2] + Math.sin(i * 12.9 + a * 1.3) * (0.3 + u * 1.5);
      this.pos[i * 3 + 1] = 0.3 + u * 9;
      this.pos[i * 3 + 2] = this.base[i * 2 + 1] + Math.cos(i * 7.7 + a) * (0.3 + u * 1.5);
      const f = Math.sin(u * Math.PI) * 0.22;
      this.col[i * 3] = f * 1.0; this.col[i * 3 + 1] = f * 0.85; this.col[i * 3 + 2] = f * 0.7;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.geometry.attributes.color.needsUpdate = true;
  }
}
