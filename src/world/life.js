// Instanced trees, street lamps, clouds and steam vents. All cheap. (Cars live in src/vehicles now.)
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
