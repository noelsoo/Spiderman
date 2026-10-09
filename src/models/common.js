// Shared helpers for the procedural character models: geometry/material caches, canvas textures,
// symbiote shader, tendrils. Everything cached here is shared between instances (goons x20+).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V2 = THREE.Vector2, V3 = THREE.Vector3;

// ---------------------------------------------------------------- caches
const gcache = new Map();
/** Cached geometry. Never dispose these (shared). */
export function G(key, fn) {
  let g = gcache.get(key);
  if (!g) { g = fn(); g.userData.shared = true; gcache.set(key, g); }
  return g;
}
const mcache = new Map();
export function M(key, fn) {
  let m = mcache.get(key);
  if (!m) { m = fn(); m.userData.shared = true; mcache.set(key, m); }
  return m;
}

export function std(color, o = {}) {
  const key = 'std' + color + JSON.stringify(o);
  return M(key, () => {
    const { map, ...rest } = o;
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...rest, map: map ?? null });
  });
}
export function metal(color, o = {}) { return std(color, { metalness: 0.9, roughness: 0.32, ...o }); }
export function glow(color, k = 2, o = {}) {
  const key = 'glow' + color + k + JSON.stringify(o);
  return M(key, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, ...o }));
}
/** Per-instance glow material (for thrusters etc. the model animates). */
export function glowInstance(color, k = 2, o = {}) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o });
}

/** Glossy black symbiote with a bluish fresnel rim. */
export function symMat(o = {}) {
  const { color = 0x050508, rim = 0x3a64ff, rimK = 0.4, rough = 0.2, map = null, id = 'a' } = o;
  const key = 'sym' + color + rim + rimK + rough + id;
  return M(key, () => {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1,
      iridescence: 0.5, iridescenceIOR: 1.5, iridescenceThicknessRange: [120, 420], map,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = { value: new THREE.Color(rim) };
      sh.uniforms.uRimK = { value: rimK };
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec3 uRim;\nuniform float uRimK;\nvoid main() {')
        .replace('#include <opaque_fragment>',
          'float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.4);\n' +
          'outgoingLight += uRim * rimF * uRimK;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'symrim';
    return m;
  });
}

// ---------------------------------------------------------------- geometry helpers
/** Tapered, bulging limb hanging down -Y from the joint (y=0) to y=-len. Rounded caps. */
export function limbGeo(len, r0, r1, b = 0.12, bAt = 0.35, seg = 12) {
  return G(`limb${len}_${r0}_${r1}_${b}_${bAt}_${seg}`, () => {
    const pts = [];
    const c0 = r0 * 0.5, c1 = r1 * 0.5;
    pts.push(new V2(0.0001, -len - c1));
    pts.push(new V2(r1 * 0.74, -len - c1 * 0.66));
    const N = 8;
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const bulge = 1 + b * Math.exp(-(((t - bAt) / 0.28) ** 2));
      pts.push(new V2(THREE.MathUtils.lerp(r0, r1, t) * bulge, -len * t));
    }
    pts.push(new V2(r0 * 0.74, c0 * 0.66));
    pts.push(new V2(0.0001, c0));
    return new THREE.LatheGeometry(pts, seg);
  });
}
/** Lathe from [[y, r], ...] bottom to top (smoothed). */
export function profileGeo(key, pts, seg = 20, samples = 22) {
  return G(key, () => {
    const curve = new THREE.SplineCurve(pts.map(([y, r]) => new V2(r, y)));
    const p = curve.getPoints(samples).map((v) => new V2(Math.max(v.x, 0.0001), v.y));
    return new THREE.LatheGeometry(p, seg);
  });
}
export function sphereGeo(r, ws = 14, hs = 10) { return G(`sph${r}_${ws}_${hs}`, () => new THREE.SphereGeometry(r, ws, hs)); }
export function boxGeo(x, y, z) { return G(`box${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z)); }
export function cylGeo(rt, rb, h, seg = 12) { return G(`cyl${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)); }
export function coneGeo(r, h, seg = 6) { return G(`cone${r}_${h}_${seg}`, () => new THREE.ConeGeometry(r, h, seg)); }
export function capsuleGeo(r, l, cs = 4, rs = 8) { return G(`cap${r}_${l}_${cs}_${rs}`, () => new THREE.CapsuleGeometry(r, l, cs, rs)); }

/** Merge [{geo, pos, rot, scale}] into a single geometry (one draw call). */
export function mergeParts(key, parts) {
  return G(key, () => {
    const gs = parts.map((p) => {
      const g = p.geo.clone();
      const m = new THREE.Matrix4().compose(
        p.pos ? new V3(...p.pos) : new V3(),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
        p.scale ? (typeof p.scale === 'number' ? new V3(p.scale, p.scale, p.scale) : new V3(...p.scale)) : new V3(1, 1, 1));
      g.applyMatrix4(m);
      // normalise attribute set so merge works
      if (g.index) { /* keep indexed */ }
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      return g;
    });
    const allIdx = gs.every((g) => g.index);
    if (!allIdx) gs.forEach((g, i) => { if (g.index) gs[i] = g.toNonIndexed(); });
    return mergeGeometries(gs);
  });
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- canvas textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

function drawWeb(ctx, W, H, o) {
  const cols = o.cols ?? 16, rows = o.rows ?? 13;
  ctx.strokeStyle = o.line; ctx.lineWidth = o.lw ?? 2.4; ctx.lineCap = 'round';
  ctx.globalAlpha = o.alpha ?? 0.9;
  for (let i = 0; i < cols; i++) { const x = (i * W) / cols; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let j = 0; j <= rows; j++) {
    const y = (j * H) / rows;
    for (let i = 0; i < cols; i++) {
      const x0 = (i * W) / cols, x1 = ((i + 1) * W) / cols;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.quadraticCurveTo((x0 + x1) / 2, y + (H / rows) * 0.5, x1, y); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

const RED = '#c0101f', BLUE = '#1b3a9c';
const texCache = new Map();
/** kind: torso | red | blue | black | wing */
export function webTexture(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const W = 512, H = 512;
  const [c, ctx] = canvas(W, H);
  if (kind === 'torso') {
    ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H);
    // blue side panels (u=.25 and .75), v=0 bottom -> canvas bottom
    ctx.fillStyle = BLUE;
    for (const cx of [W * 0.25, W * 0.75]) {
      ctx.beginPath();
      ctx.moveTo(cx - 14, H); ctx.lineTo(cx + 14, H);
      ctx.lineTo(cx + 46, H * 0.42); ctx.lineTo(cx + 40, H * 0.18); ctx.lineTo(cx + 16, 0);
      ctx.lineTo(cx - 16, 0); ctx.lineTo(cx - 40, H * 0.18); ctx.lineTo(cx - 46, H * 0.42);
      ctx.closePath(); ctx.fill();
    }
    drawWeb(ctx, W, H, { line: '#0b0b12', cols: 16, rows: 14, lw: 2.6 });
  } else if (kind === 'red') {
    ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H); drawWeb(ctx, W, H, { line: '#0b0b12', cols: 12, rows: 8 });
  } else if (kind === 'blue') {
    ctx.fillStyle = BLUE; ctx.fillRect(0, 0, W, H); drawWeb(ctx, W, H, { line: '#080a1c', cols: 12, rows: 8 });
  } else if (kind === 'black') {
    ctx.fillStyle = '#08080c'; ctx.fillRect(0, 0, W, H); drawWeb(ctx, W, H, { line: '#2c3050', cols: 12, rows: 8, lw: 2, alpha: 0.7 });
  } else if (kind === 'wing') {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14,24,60,0.55)'; ctx.fillRect(0, 0, W, H);
    drawWeb(ctx, W, H, { line: '#bcd6ff', cols: 10, rows: 6, lw: 2.2, alpha: 0.85 });
  }
  const t = tex(c); texCache.set(kind, t); return t;
}

export function emblemTexture(color = '#ffffff', style = 'spider') {
  const key = 'emb' + color + style;
  if (texCache.has(key)) return texCache.get(key);
  const S = 256; const [c, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const cx = S / 2;
  // body
  ctx.beginPath(); ctx.ellipse(cx, S * 0.62, S * 0.062, S * 0.17, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, S * 0.37, S * 0.042, S * 0.075, 0, 0, Math.PI * 2); ctx.fill();
  const legs = [
    [[0.05, 0.31], [0.20, 0.12], [0.38, 0.05]],
    [[0.06, 0.36], [0.26, 0.22], [0.47, 0.20]],
    [[0.06, 0.41], [0.28, 0.46], [0.45, 0.68]],
    [[0.05, 0.47], [0.2, 0.66], [0.27, 0.93]],
  ];
  for (const sd of [-1, 1]) for (const leg of legs) {
    ctx.lineWidth = S * 0.032;
    ctx.beginPath();
    leg.forEach(([x, y], i) => { const px = cx + sd * x * S, py = y * S; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t); return t;
}

export function camoTexture() {
  if (texCache.has('camo')) return texCache.get('camo');
  const [c, ctx] = canvas(256, 256);
  const r = rng(7);
  ctx.fillStyle = '#6f6a42'; ctx.fillRect(0, 0, 256, 256);
  const cols = ['#4c5532', '#8a7d52', '#3a3f2a', '#9b9065'];
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath(); ctx.ellipse(r() * 256, r() * 256, 12 + r() * 30, 8 + r() * 20, r() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const t = tex(c, [2, 2]); texCache.set('camo', t); return t;
}
export function leopardTexture() {
  if (texCache.has('leo')) return texCache.get('leo');
  const [c, ctx] = canvas(256, 256);
  const r = rng(11);
  ctx.fillStyle = '#c18a3c'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) {
    const x = r() * 256, y = r() * 256, s = 7 + r() * 9, a = r() * 6;
    ctx.strokeStyle = '#1b120a'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(x, y, s, a, a + 4.6); ctx.stroke();
    ctx.fillStyle = '#7a4a1c'; ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, 6.3); ctx.fill();
  }
  const t = tex(c, [2, 1]); texCache.set('leo', t); return t;
}

// ---------------------------------------------------------------- eyes
export function eyeGeo(kind = 'spider', depth = 0.008) {
  return G('eye' + kind + depth, () => {
    const s = new THREE.Shape();
    let pts;
    if (kind === 'spider') pts = [[0.006, -0.026], [0.060, -0.016], [0.108, 0.026], [0.100, 0.056], [0.046, 0.040], [0.006, 0.012]];
    else if (kind === 'venom') pts = [[0.006, -0.12], [0.040, -0.02], [0.115, 0.07], [0.150, 0.20], [0.085, 0.15], [0.040, 0.11], [0.006, 0.02]];
    else if (kind === 'goon') pts = [[0.006, -0.012], [0.04, -0.01], [0.062, 0.012], [0.04, 0.02], [0.006, 0.01]];
    else pts = [[0.006, -0.02], [0.05, -0.01], [0.09, 0.02], [0.05, 0.03]];
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    return g;
  });
}
export function mirrorX(geo, key) { return G(key, () => { const g = geo.clone(); g.scale(-1, 1, 1); const idx = g.index; if (idx) { const a = idx.array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } idx.needsUpdate = true; } g.computeVertexNormals(); return g; }); }

// ---------------------------------------------------------------- tendrils
/** Animated tube. update(fn) where fn(u 0..1, outVec3) gives the centre-line in local space. */
export class Tendril {
  constructor({ segs = 14, radial = 6, r0 = 0.05, r1 = 0.008, material, ref = new V3(0, 0, 1) }) {
    this.segs = segs; this.radial = radial; this.r0 = r0; this.r1 = r1; this.ref = ref.clone();
    const nv = (segs + 1) * radial + 1;
    const pos = new Float32Array(nv * 3);
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
    const tip = (segs + 1) * radial;
    for (let j = 0; j < radial; j++) idx.push(segs * radial + j, tip, segs * radial + ((j + 1) % radial));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this._pts = Array.from({ length: segs + 1 }, () => new V3());
    this._t = new V3(); this._n = new V3(); this._b = new V3();
  }
  update(fn) {
    const { segs, radial, _pts: P } = this;
    for (let i = 0; i <= segs; i++) fn(i / segs, P[i]);
    const pos = this.geo.attributes.position.array;
    const T = this._t, N = this._n, B = this._b;
    N.copy(this.ref);
    for (let i = 0; i <= segs; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(segs, i + 1)];
      T.subVectors(b, a).normalize();
      // parallel transport-ish: keep N perpendicular to T
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-6) N.set(0, 1, 0).addScaledVector(T, -T.y);
      N.normalize(); B.crossVectors(T, N);
      const u = i / segs;
      const r = (this.r0 + (this.r1 - this.r0) * Math.pow(u, 0.8)) * (i === segs ? 0.7 : 1);
      for (let j = 0; j < radial; j++) {
        const an = (j / radial) * Math.PI * 2, cs = Math.cos(an) * r, sn = Math.sin(an) * r;
        const o = (i * radial + j) * 3;
        pos[o] = P[i].x + N.x * cs + B.x * sn; pos[o + 1] = P[i].y + N.y * cs + B.y * sn; pos[o + 2] = P[i].z + N.z * cs + B.z * sn;
      }
    }
    const o = (segs + 1) * radial * 3;
    const e = P[segs];
    pos[o] = e.x + T.x * this.r1 * 2; pos[o + 1] = e.y + T.y * this.r1 * 2; pos[o + 2] = e.z + T.z * this.r1 * 2;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  dispose() { this.geo.dispose(); }
}
