// Spectra-style laser light show, Merlion spout, rain.
import * as THREE from 'three';

/** Animated additive beams over the bay. */
export class LightShow {
  constructor(group, ctx) {
    this.t = 0;
    const N = 18;
    this.facade = ctx && ctx.mbsMat;
    this.n = N;
    // beam: open cylinder along +y from 0..1, brightest at the base, fading out
    const g = new THREE.CylinderGeometry(0.5, 1, 1, 8, 6, true);
    g.translate(0, 0.5, 0);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const f = 1 - pos.getY(i); const v = Math.pow(f, 1.6); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, color: new THREE.Color(0, 0, 0) });
    this.mesh = new THREE.InstancedMesh(g, this.mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    for (let i = 0; i < N; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    this.mesh.visible = false;
    group.add(this.mesh);
    // sources: event-plaza waterfront (front beams) + SkyPark top searchlights
    this.src = [];
    for (let i = 0; i < 10; i++) this.src.push({ x: 194, y: 1.5, z: 5 + i * 20, kind: 0, i });
    for (let i = 0; i < 8; i++) this.src.push({ x: 270 + (i % 2 ? 14 : -14), y: 206, z: -80 + i * 42, kind: 1, i });
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
  }

  update(dt, night) {
    this.t += dt;
    // MBS facade: lit windows fade in with the night
    if (this.facade) this.facade.emissiveIntensity = Math.pow(Math.min(1, night * 1.3), 2) * 1.6;
    const on = night > 0.5;
    this.mesh.visible = on;
    if (!on) return;
    this.mat.color.setScalar(Math.min(1, (night - 0.5) * 2.2) * 0.85);
    const t = this.t, ph = (t % 40) / 40; // 40-second show loop
    const burst = 0.5 + 0.5 * Math.sin(t * 0.7);
    this.src.forEach((s, k) => {
      let yaw, pitch, len, rad;
      if (s.kind === 0) {
        // fan over the bay (pointing west, -x). yaw 0 -> -x ... swing +-
        const a = Math.sin(t * 0.5 + s.i * 0.55) * (0.5 + 0.5 * Math.sin(t * 0.13));
        yaw = Math.PI / 2 + Math.sin(t * 0.31 + s.i) * 0.5 + a * 0.5;       // azimuth about y, 90deg = pointing -x
        pitch = 0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8 + s.i * 0.7)) + (ph > 0.5 ? 0.3 : 0);
        len = 340; rad = 2.4 + burst * 1.2;
      } else {
        // SkyPark searchlights: pairs sweep in a cross-fan, narrow and tall
        yaw = Math.sin(t * 0.35 + s.i * 0.8) * 1.2 + (s.i % 2 ? Math.PI / 2 : -Math.PI / 2); pitch = 1.0 + 0.3 * Math.sin(t * 0.6 + s.i); len = 460; rad = 1.8 + 0.8 * burst;
      }
      // direction from yaw/pitch: horizontal dir (-cos, 0, sin)?  yaw measured from +z toward -x
      const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
      // cylinder +y -> direction
      this.q.setFromUnitVectors(UP, this.p.set(dx, dy, dz).normalize());
      this.m.compose(this.p.set(s.x, s.y, s.z), this.q, this.s.set(rad, len, rad));
      this.mesh.setMatrixAt(k, this.m);
      const hue = (t * 0.05 + s.i * 0.07 + (s.kind ? 0.55 : 0)) % 1;
      this.mesh.setColorAt(k, this.c.setHSL(hue, 1, 0.55));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
const UP = new THREE.Vector3(0, 1, 0);

/** Merlion water spout: parabolic droplets. */
export class Spout {
  constructor(group, mouth, dir) {
    this.N = 150;
    this.mouth = mouth.clone(); this.dir = dir.clone();
    const g = new THREE.SphereGeometry(0.17, 5, 4);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.75, depthWrite: false }), this.N);
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    this.t = 0; this.m = new THREE.Matrix4(); this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1);
  }
  update(dt) {
    this.t += dt;
    const sp = 8.5, up = 5.2, g = 9.8;
    const T = (2 * up) / g + 0.9;
    for (let i = 0; i < this.N; i++) {
      const ph = ((this.t * 0.9 + i / this.N) % 1) * T;
      const jitter = ((i * 7919) % 13) / 13 - 0.5;
      this.p.copy(this.mouth).addScaledVector(this.dir, sp * ph);
      this.p.y += up * ph - 0.5 * g * ph * ph + 0.0;
      this.p.x += jitter * 0.04 * ph * ph; this.p.z -= jitter * 0.04 * ph * ph;
      const y = this.p.y;
      this.s.setScalar(y < -0.4 ? 0.001 : 1);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Streak rain around the camera. */
export class Rain {
  constructor(group) {
    const N = 2400;
    const pos = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 140, y = Math.random() * 90, z = (Math.random() - 0.5) * 140;
      pos.set([x, y, z, x, y + 1, z], i * 6);
      seed[i * 2] = seed[i * 2 + 1] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lenAttr = new Float32Array(N * 2); for (let i = 0; i < N; i++) { lenAttr[i * 2] = 0; lenAttr[i * 2 + 1] = 1; }
    g.setAttribute('aEnd', new THREE.BufferAttribute(lenAttr, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uA: { value: 0 } },
      vertexShader: `uniform float uT; uniform vec3 uCam; attribute float aEnd; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uT * 38.0, 90.0); p.x += p.y * 0.12; vec3 w = p; w.x = uCam.x + mod(p.x - uCam.x + 70.0, 140.0) - 70.0; w.z = uCam.z + mod(p.z - uCam.z + 70.0, 140.0) - 70.0; w.y = uCam.y - 40.0 + p.y; w.y += aEnd * 1.6; w.x += aEnd * 0.2;
          vA = 1.0; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: `uniform float uA; void main(){ gl_FragColor = vec4(0.75, 0.82, 0.9, 0.35 * uA); }`,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    group.add(this.mesh);
  }
  update(dt, camera, amount) {
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uT.value += dt; this.mat.uniforms.uCam.value.copy(camera.position); this.mat.uniforms.uA.value = amount;
  }
}
