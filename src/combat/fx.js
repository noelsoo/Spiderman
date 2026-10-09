// FX: pooled particles (additive + smoke), rings, beams, lightning, flash lights, floating text, ribbon trails.
// Contract: docs/ARCHITECTURE.md#fx. Everything is pre-allocated; the hot paths (emit/update) do not allocate.
//
// Extras beyond the contract:
//   explosion(pos, radius, color)   fireball sphere + ring + sparks + smoke + flash
//   hitSpark(pos, color, heavy)     impact star burst + tiny flash
//   smoke(pos, size, life, vel?)    dark, normal-blended puff (dust / missile trails)
//   glow(pos, color, size, life)    single soft additive billboard blob
//   reset()                         clear everything
import * as THREE from 'three';

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

const POINT_VS = /* glsl */`
attribute vec3 aColor; attribute vec2 aP; uniform float uScale;
varying vec3 vC; varying float vA;
void main() {
  vC = aColor; vA = aP.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aP.x <= 0.0 ? 0.0 : clamp(aP.x * uScale / max(0.1, -mv.z), 0.0, 320.0);
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FS = /* glsl */`
varying vec3 vC; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC, a * vA);
}`;

class Particles {
  constructor(scene, max, blending, uniforms) {
    this.max = max; this.cursor = 0; this.alive = 0; this.dirty = false;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.prm = new Float32Array(max * 2);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    const mk = (a, n) => { const at = new THREE.BufferAttribute(a, n); at.setUsage(THREE.DynamicDrawUsage); return at; };
    g.setAttribute('position', mk(this.pos, 3));
    g.setAttribute('aColor', mk(this.col, 3));
    g.setAttribute('aP', mk(this.prm, 2));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms,
      transparent: true, depthWrite: false, blending, toneMapped: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 12 : 11;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav, drag, grow) {
    const i = this.cursor; this.cursor = (i + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.size[i] = size; this.grow[i] = grow;
    this.prm[i * 2] = size; this.prm[i * 2 + 1] = 1;
    this.dirty = true;
  }

  update(dt) {
    if (this.alive <= 0 && !this.dirty) return;
    const { pos, vel, life, maxLife, grav, drag, size, grow, prm } = this;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      let l = life[i];
      if (l <= 0) continue;
      l -= dt;
      const i3 = i * 3, i2 = i * 2;
      if (l <= 0) { life[i] = 0; prm[i2] = 0; prm[i2 + 1] = 0; continue; }
      life[i] = l; alive++;
      const k = 1 / (1 + drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = (vel[i3 + 1] - grav[i] * dt) * k; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = l / maxLife[i];
      prm[i2] = size[i] * (1 + (grow[i] - 1) * (1 - t));
      prm[i2 + 1] = t > 0.35 ? 1 : t / 0.35;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aP.needsUpdate = true;
    this.dirty = alive > 0;
  }

  clear() { this.life.fill(0); this.prm.fill(0); this.alive = 0; this.dirty = true; }
}

export class FX {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.uniforms = { uScale: { value: 800 } };
    this.add = new Particles(scene, 2000, THREE.AdditiveBlending, this.uniforms);
    this.dark = new Particles(scene, 400, THREE.NormalBlending, this.uniforms);
    this._ds = new THREE.Vector2();

    this._initRings(scene);
    this._initSpheres(scene);
    this._initBeams(scene);
    this._initLightning(scene);
    this._initLights(scene);
    this._initText(scene);
    this._initTrails(scene);
  }

  // ---------------------------------------------------------------- particles
  _col(color) { return _c.set(color); }

  /** Radial burst of additive sparks. */
  burst(pos, color = 0xffffff, count = 20, speed = 6, life = 0.6, size = 0.25) {
    const c = this._col(color), r = c.r, g = c.g, b = c.b;
    const a = this.add;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = Math.sqrt(1 - u * u);
      const sp = speed * rnd(0.3, 1);
      a.emit(pos.x, pos.y, pos.z, Math.cos(th) * s * sp, u * sp, Math.sin(th) * s * sp,
        r, g, b, size * rnd(0.6, 1.2), life * rnd(0.6, 1), 6, 1.8, 0.3);
    }
  }

  /** Directional spark spray (dir need not be normalised). */
  sparks(pos, dir, color = 0xfff0b0, count = 10, speed = 10, life = 0.35, size = 0.12) {
    const c = this._col(color), r = c.r, g = c.g, b = c.b;
    const a = this.add;
    _v.copy(dir).normalize();
    for (let i = 0; i < count; i++) {
      const sp = speed * rnd(0.4, 1);
      a.emit(pos.x, pos.y, pos.z,
        (_v.x + rnd(-0.6, 0.6)) * sp, (_v.y + rnd(-0.3, 0.9)) * sp, (_v.z + rnd(-0.6, 0.6)) * sp,
        r, g, b, size * rnd(0.6, 1.3), life * rnd(0.5, 1), 18, 1.2, 0.2);
    }
  }

  /** Dark normal-blended puff for smoke / dust. */
  smoke(pos, size = 0.8, life = 1, vel = null, shade = 0.12) {
    this.dark.emit(pos.x + rnd(-0.1, 0.1), pos.y + rnd(-0.1, 0.1), pos.z + rnd(-0.1, 0.1),
      (vel ? vel.x : 0) + rnd(-0.4, 0.4), (vel ? vel.y : 0) + rnd(0.2, 1), (vel ? vel.z : 0) + rnd(-0.4, 0.4),
      shade, shade * 0.95, shade * 0.9, size, life, -0.3, 1.5, 2.6);
  }

  /** Dust cloud kicked up at ground level. */
  dust(pos, count = 12, radius = 3, shade = 0.16) {
    for (let i = 0; i < count; i++) {
      const th = Math.random() * TAU, sp = radius * rnd(0.3, 1.1);
      this.dark.emit(pos.x, pos.y + 0.2, pos.z, Math.cos(th) * sp, rnd(0.3, 1.5), Math.sin(th) * sp,
        shade, shade * 0.95, shade * 0.88, rnd(1, 2.2), rnd(0.6, 1.1), -0.2, 3, 2.4);
    }
  }

  /** Single soft additive blob (muzzle glow, projectile core). */
  glow(pos, color = 0xffffff, size = 1, life = 0.15) {
    const c = this._col(color);
    this.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, c.r, c.g, c.b, size, life, 0, 0, 0.4);
  }

  /** Low-level emit for projectile trails etc. (additive). */
  trailPuff(x, y, z, color, size, life, jitter = 0.05) {
    const c = this._col(color);
    this.add.emit(x, y, z, rnd(-jitter, jitter) * 10, rnd(-jitter, jitter) * 10, rnd(-jitter, jitter) * 10,
      c.r, c.g, c.b, size, life, 0, 2, 0.2);
  }

  // ---------------------------------------------------------------- rings / shockwaves
  _initRings(scene) {
    const geo = new THREE.RingGeometry(0.82, 1, 56, 1);
    geo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 9;
      scene.add(mesh);
      this.rings.push({ mesh, mat, t: 0, life: 1, r: 1, active: false, r0: 0.2 });
    }
    this._ringCursor = 0;
  }

  ring(pos, radius = 3, color = 0xffffff, life = 0.5) {
    const o = this.rings[this._ringCursor]; this._ringCursor = (this._ringCursor + 1) % this.rings.length;
    o.active = true; o.t = 0; o.life = life; o.r = radius; o.r0 = 0.15;
    o.mat.color.set(color); o.mat.opacity = 1;
    o.mesh.position.copy(pos); o.mesh.visible = true; o.mesh.scale.setScalar(0.15);
  }

  shockwave(pos, radius = 8, color = 0xffffff) {
    this.ring(pos, radius, color, 0.55);
    _v3.copy(pos).y += 0.15;
    this.ring(_v3, radius * 0.65, 0xffffff, 0.4);
    this.dust(pos, Math.min(26, 8 + radius * 1.5), radius * 0.9);
    this.burst(_v3, color, 14, radius * 1.2, 0.5, 0.3);
  }

  // ---------------------------------------------------------------- spheres (explosions)
  _initSpheres(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this.spheres = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 9;
      scene.add(mesh);
      this.spheres.push({ mesh, mat, t: 0, life: 1, r: 1, active: false });
    }
    this._sphCursor = 0;
  }

  explosion(pos, radius = 4, color = 0xffa040) {
    const o = this.spheres[this._sphCursor]; this._sphCursor = (this._sphCursor + 1) % this.spheres.length;
    o.active = true; o.t = 0; o.life = 0.45; o.r = radius * 0.7;
    o.mat.color.set(color); o.mat.opacity = 0.9;
    o.mesh.position.copy(pos); o.mesh.visible = true; o.mesh.scale.setScalar(0.2);
    this.ring(_v3.copy(pos).setY(Math.max(0.1, pos.y * 0.0 + 0.12)), radius * 1.4, color, 0.45);
    this.burst(pos, color, 28, radius * 3, 0.7, 0.45);
    this.burst(pos, 0xffffff, 10, radius * 2, 0.35, 0.3);
    for (let i = 0; i < 6; i++) {
      _v2.set(rnd(-1, 1) * radius * 0.5, rnd(0, 1) * radius * 0.5, rnd(-1, 1) * radius * 0.5).add(pos);
      this.smoke(_v2, radius * 0.5, rnd(0.8, 1.4), null, 0.035);
    }
    this.flash(pos, color, 6, 0.3);
    this.game.cam?.shake?.(Math.min(0.5, radius * 0.07));
  }

  hitSpark(pos, color = 0xfff0c0, heavy = false) {
    this.sparks(pos, _up, color, heavy ? 16 : 8, heavy ? 12 : 8, heavy ? 0.45 : 0.3, heavy ? 0.16 : 0.1);
    this.burst(pos, 0xffffff, heavy ? 6 : 3, 3, 0.18, heavy ? 0.5 : 0.32);
    if (heavy) { this.ring(pos, 1.4, color, 0.25); this.flash(pos, color, 3, 0.1); }
  }

  // ---------------------------------------------------------------- beams
  _initBeams(scene) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geo.translate(0, 0.5, 0);
    this.beams = [];
    for (let i = 0; i < 32; i++) {
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const grp = new THREE.Group();
      const glow = new THREE.Mesh(geo, glowMat), core = new THREE.Mesh(geo, coreMat);
      grp.add(glow, core); grp.visible = false; grp.frustumCulled = false;
      glow.frustumCulled = core.frustumCulled = false; glow.renderOrder = core.renderOrder = 13;
      scene.add(grp);
      this.beams.push({ grp, glow, core, glowMat, coreMat, t: 0, life: 0.1, w: 0.1, active: false });
    }
    this._beamCursor = 0;
  }

  beam(from, to, color = 0xffffff, width = 0.15, life = 0.1) {
    const o = this.beams[this._beamCursor]; this._beamCursor = (this._beamCursor + 1) % this.beams.length;
    _v.subVectors(to, from);
    const len = _v.length();
    if (len < 1e-4) return;
    _v.divideScalar(len);
    _q.setFromUnitVectors(_up, _v);
    o.grp.position.copy(from); o.grp.quaternion.copy(_q);
    o.active = true; o.t = 0; o.life = Math.max(0.016, life); o.w = width; o.len = len;
    o.glowMat.color.set(color);
    o.coreMat.color.set(color).lerp(_c.set(0xffffff), 0.75);
    o.glow.scale.set(width * 2.2, len, width * 2.2);
    o.core.scale.set(width * 0.7, len, width * 0.7);
    o.grp.visible = true;
  }

  // ---------------------------------------------------------------- lightning
  _initLightning(scene) {
    const MAXSEG = 300;
    this.bolts = [];
    for (let i = 0; i < 10; i++) {
      const arr = new Float32Array(MAXSEG * 6);
      const geo = new THREE.BufferGeometry();
      const at = new THREE.BufferAttribute(arr, 3); at.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', at);
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false; line.visible = false; line.renderOrder = 14;
      scene.add(line);
      this.bolts.push({ line, geo, arr, at, mat, t: 0, life: 0.2, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), branches: 3, regen: 0, maxSeg: MAXSEG });
    }
    this._boltCursor = 0;
    this._pts = new Float32Array(3 * 64);
  }

  lightning(from, to, color = 0x9fd8ff, life = 0.2, branches = 3) {
    const o = this.bolts[this._boltCursor]; this._boltCursor = (this._boltCursor + 1) % this.bolts.length;
    o.active = true; o.t = 0; o.life = life; o.branches = branches; o.regen = 0;
    o.from.copy(from); o.to.copy(to);
    o.mat.color.set(color).lerp(_c.set(0xffffff), 0.45); o.mat.opacity = 1;
    o.line.visible = true;
    this._genBolt(o);
    this.sparks(to, _up, color, 6, 7, 0.3, 0.1);
    this.glow(to, color, 1.4, 0.15);
  }

  _genBolt(o) {
    const arr = o.arr, pts = this._pts;
    const dx = o.to.x - o.from.x, dy = o.to.y - o.from.y, dz = o.to.z - o.from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const n = Math.max(5, Math.min(30, Math.round(len / 1.1)));
    // perpendicular basis
    _v.set(dx / len, dy / len, dz / len);
    _v2.crossVectors(_v, Math.abs(_v.y) > 0.9 ? _v3.set(1, 0, 0) : _up).normalize();
    _v3.crossVectors(_v, _v2).normalize();
    const amp = Math.min(2.2, len * 0.07 + 0.2);
    let vi = 0;
    // main path points into pts (n+1 points, up to 31 -> fits 64)
    for (let i = 0; i <= n; i++) {
      const t = i / n, edge = Math.sin(Math.PI * t);
      const j1 = rnd(-1, 1) * amp * edge, j2 = rnd(-1, 1) * amp * edge;
      pts[i * 3] = o.from.x + dx * t + _v2.x * j1 + _v3.x * j2;
      pts[i * 3 + 1] = o.from.y + dy * t + _v2.y * j1 + _v3.y * j2;
      pts[i * 3 + 2] = o.from.z + dz * t + _v2.z * j1 + _v3.z * j2;
    }
    // 3 jittered copies for apparent thickness
    for (let copy = 0; copy < 3; copy++) {
      const ox = copy === 0 ? 0 : rnd(-0.06, 0.06), oy = copy === 0 ? 0 : rnd(-0.06, 0.06), oz = copy === 0 ? 0 : rnd(-0.06, 0.06);
      for (let i = 0; i < n && vi + 6 <= arr.length; i++) {
        arr[vi++] = pts[i * 3] + ox; arr[vi++] = pts[i * 3 + 1] + oy; arr[vi++] = pts[i * 3 + 2] + oz;
        arr[vi++] = pts[i * 3 + 3] + ox; arr[vi++] = pts[i * 3 + 4] + oy; arr[vi++] = pts[i * 3 + 5] + oz;
      }
    }
    // branches
    for (let b = 0; b < o.branches && n > 3; b++) {
      const si = 1 + ((Math.random() * (n - 2)) | 0);
      let px = pts[si * 3], py = pts[si * 3 + 1], pz = pts[si * 3 + 2];
      let dirx = dx / len + rnd(-0.9, 0.9), diry = dy / len + rnd(-0.9, 0.9), dirz = dz / len + rnd(-0.9, 0.9);
      const dl = Math.hypot(dirx, diry, dirz) || 1; dirx /= dl; diry /= dl; dirz /= dl;
      const segs = 3 + ((Math.random() * 4) | 0), step = Math.min(1.6, len * 0.08 + 0.4);
      for (let s = 0; s < segs && vi + 6 <= arr.length; s++) {
        const nx = px + (dirx + rnd(-0.5, 0.5)) * step, ny = py + (diry + rnd(-0.5, 0.5)) * step, nz = pz + (dirz + rnd(-0.5, 0.5)) * step;
        arr[vi++] = px; arr[vi++] = py; arr[vi++] = pz; arr[vi++] = nx; arr[vi++] = ny; arr[vi++] = nz;
        px = nx; py = ny; pz = nz;
      }
    }
    o.geo.setDrawRange(0, vi / 3);
    o.at.needsUpdate = true;
  }

  // ---------------------------------------------------------------- flash lights
  _initLights(scene) {
    this.lights = [];
    // Light count must stay constant (changing it recompiles every lit material), so pool them at intensity 0.
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      scene.add(l);
      this.lights.push({ light: l, t: 0, life: 0.1, peak: 0, active: false });
    }
  }

  flash(pos, color = 0xffffff, intensity = 4, life = 0.15) {
    // pick the free light or the one closest to expiry
    let best = this.lights[0], bs = Infinity;
    for (const o of this.lights) {
      const s = o.active ? (o.life - o.t) / o.life : -1;
      if (s < bs) { bs = s; best = o; }
    }
    best.active = true; best.t = 0; best.life = life; best.peak = intensity * 40;
    best.light.color.set(color); best.light.position.copy(pos); best.light.intensity = best.peak;
  }

  // ---------------------------------------------------------------- floating text
  _initText(scene) {
    this.texts = [];
    for (let i = 0; i < 28; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
      const spr = new THREE.Sprite(mat);
      spr.visible = false; spr.renderOrder = 30; spr.frustumCulled = false;
      scene.add(spr);
      this.texts.push({ spr, mat, tex, ctx: canvas.getContext('2d'), canvas, t: 0, life: 1, active: false, vy: 2, size: 1, vx: 0 });
    }
    this._textCursor = 0;
  }

  text(pos, string, color = 0xffffff, opts = null) {
    const o = this.texts[this._textCursor]; this._textCursor = (this._textCursor + 1) % this.texts.length;
    const ctx = o.ctx;
    ctx.clearRect(0, 0, 256, 64);
    let fs = 44;
    ctx.font = `900 ${fs}px "Arial Black", Impact, sans-serif`;
    while (ctx.measureText(string).width > 238 && fs > 16) { fs -= 3; ctx.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(string, 128, 34);
    ctx.fillStyle = '#' + _c.set(color).getHexString();
    ctx.fillText(string, 128, 34);
    o.tex.needsUpdate = true;
    o.active = true; o.t = 0; o.life = opts?.life ?? 0.9; o.vy = opts?.rise ?? 2.2; o.size = opts?.size ?? 1;
    o.vx = rnd(-0.6, 0.6);
    o.spr.position.set(pos.x + rnd(-0.25, 0.25), pos.y, pos.z + rnd(-0.25, 0.25));
    o.mat.opacity = 1; o.spr.visible = true;
  }

  // ---------------------------------------------------------------- ribbon trails
  _initTrails(scene) {
    this.trailN = 24;
    this.trails = [];
    const N = this.trailN;
    const index = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i < 10; i++) {
      const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
      const geo = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 3);
      pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pa); geo.setAttribute('color', ca);
      geo.setIndex(index);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 12;
      scene.add(mesh);
      const h = {
        mesh, pos, col, pa, ca, active: false, following: false, obj: null, width: 0.2, life: 0.4, r: 1, g: 1, b: 1,
        sx: new Float32Array(N), sy: new Float32Array(N), sz: new Float32Array(N), st: new Float32Array(N), count: 0, clock: 0,
        stop() { this.following = false; this.obj = null; },
      };
      this.trails.push(h);
    }
  }

  trail(object3D, color = 0xffffff, width = 0.2, life = 0.4) {
    let h = null;
    for (const t of this.trails) if (!t.active) { h = t; break; }
    if (!h) { h = this.trails[0]; }
    h.active = true; h.following = true; h.obj = object3D; h.width = width; h.life = life;
    _c.set(color); h.r = _c.r; h.g = _c.g; h.b = _c.b;
    h.count = 0; h.clock = 0; h.mesh.visible = true;
    return h;
  }

  _updateTrail(h, dt) {
    h.clock += dt;
    const N = this.trailN;
    if (h.following) {
      if (!h.obj || !h.obj.parent) h.stop();
      else {
        h.obj.getWorldPosition(_v);
        // shift samples (newest at index 0)
        const c0 = h.count;
        if (c0 === 0 || _v2.set(h.sx[0], h.sy[0], h.sz[0]).distanceToSquared(_v) > 0.0004) {
          for (let i = Math.min(c0, N - 1); i > 0; i--) { h.sx[i] = h.sx[i - 1]; h.sy[i] = h.sy[i - 1]; h.sz[i] = h.sz[i - 1]; h.st[i] = h.st[i - 1]; }
          h.sx[0] = _v.x; h.sy[0] = _v.y; h.sz[0] = _v.z; h.st[0] = h.clock;
          h.count = Math.min(N, c0 + 1);
        } else { h.sx[0] = _v.x; h.sy[0] = _v.y; h.sz[0] = _v.z; h.st[0] = h.clock; }
      }
    }
    // drop expired samples
    while (h.count > 0 && h.clock - h.st[h.count - 1] > h.life) h.count--;
    if (h.count < 2) {
      if (!h.following) { h.active = false; h.mesh.visible = false; }
      for (let i = 0; i < N * 6; i++) h.col[i] = 0;
      h.ca.needsUpdate = true;
      return;
    }
    const cam = this.game.camera.position;
    const pos = h.pos, col = h.col;
    for (let i = 0; i < N; i++) {
      const j = Math.min(i, h.count - 1);
      const x = h.sx[j], y = h.sy[j], z = h.sz[j];
      const a = Math.min(h.count - 1, j + 1), b = Math.max(0, j - 1);
      _v.set(h.sx[b] - h.sx[a], h.sy[b] - h.sy[a], h.sz[b] - h.sz[a]);
      _v2.set(cam.x - x, cam.y - y, cam.z - z);
      _v3.crossVectors(_v, _v2);
      const l = _v3.length();
      if (l > 1e-6) _v3.multiplyScalar(1 / l); else _v3.set(0, 1, 0);
      const age = i < h.count ? (h.clock - h.st[j]) / h.life : 1;
      const f = i < h.count ? Math.max(0, 1 - age) : 0;
      const w = h.width * 0.5 * f;
      const k = i * 6;
      pos[k] = x + _v3.x * w; pos[k + 1] = y + _v3.y * w; pos[k + 2] = z + _v3.z * w;
      pos[k + 3] = x - _v3.x * w; pos[k + 4] = y - _v3.y * w; pos[k + 5] = z - _v3.z * w;
      const br = f * f;
      col[k] = col[k + 3] = h.r * br; col[k + 1] = col[k + 4] = h.g * br; col[k + 2] = col[k + 5] = h.b * br;
    }
    h.pa.needsUpdate = true; h.ca.needsUpdate = true;
  }

  // ---------------------------------------------------------------- frame update
  update(dt) {
    const g = this.game;
    const ds = g.renderer.getDrawingBufferSize(this._ds);
    this.uniforms.uScale.value = ds.y / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov) * 0.5));

    this.add.update(dt);
    this.dark.update(dt);

    for (const o of this.rings) {
      if (!o.active) continue;
      o.t += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.active = false; o.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      o.mesh.scale.setScalar(Math.max(0.05, o.r * (0.1 + 0.9 * e)));
      o.mat.opacity = (1 - k) * 0.9;
    }
    for (const o of this.spheres) {
      if (!o.active) continue;
      o.t += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.active = false; o.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k);
      o.mesh.scale.setScalar(o.r * (0.2 + 0.8 * e));
      o.mat.opacity = 0.9 * (1 - k) * (1 - k);
    }
    for (const o of this.beams) {
      if (!o.active) continue;
      o.t += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.active = false; o.grp.visible = false; continue; }
      const s = 1 - k * 0.7;
      o.glow.scale.set(o.w * 2.2 * s, o.len, o.w * 2.2 * s);
      o.core.scale.set(o.w * 0.7 * s, o.len, o.w * 0.7 * s);
      o.glowMat.opacity = 0.4 * (1 - k); o.coreMat.opacity = 1 - k;
    }
    for (const o of this.bolts) {
      if (!o.active) continue;
      o.t += dt; o.regen += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.active = false; o.line.visible = false; continue; }
      if (o.regen > 0.04) { o.regen = 0; this._genBolt(o); }
      o.mat.opacity = Math.min(1, (1 - k) * 1.6);
    }
    for (const o of this.lights) {
      if (!o.active) continue;
      o.t += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.active = false; o.light.intensity = 0; continue; }
      o.light.intensity = o.peak * (1 - k) * (1 - k);
    }
    const cam = g.camera.position;
    for (const o of this.texts) {
      if (!o.active) continue;
      o.t += dt;
      const k = o.t / o.life;
      if (k >= 1) { o.active = false; o.spr.visible = false; continue; }
      o.spr.position.y += o.vy * (1 - k) * dt;
      o.spr.position.x += o.vx * dt;
      const dist = o.spr.position.distanceTo(cam);
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.6 : 1.2 - Math.min(0.3, (k - 0.12) * 0.4);
      const h = THREE.MathUtils.clamp(dist * 0.085, 0.6, 4) * pop * o.size;
      o.spr.scale.set(h * 4, h, 1);
      o.mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
    for (const h of this.trails) if (h.active) this._updateTrail(h, dt);
  }

  reset() {
    this.add.clear(); this.dark.clear();
    for (const o of this.rings) { o.active = false; o.mesh.visible = false; }
    for (const o of this.spheres) { o.active = false; o.mesh.visible = false; }
    for (const o of this.beams) { o.active = false; o.grp.visible = false; }
    for (const o of this.bolts) { o.active = false; o.line.visible = false; }
    for (const o of this.lights) { o.active = false; o.light.intensity = 0; }
    for (const o of this.texts) { o.active = false; o.spr.visible = false; }
    for (const h of this.trails) { h.active = false; h.following = false; h.mesh.visible = false; }
  }
}
