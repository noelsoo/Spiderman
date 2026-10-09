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
/** cache key for a material option bag (textures by uuid; never serialises canvases) */
function okey(o) { return Object.keys(o).map((k) => { const v = o[k]; return k + ':' + (v && v.isTexture ? v.uuid : v && v.isColor ? v.getHex() : v && v.isVector2 ? v.x + ',' + v.y : JSON.stringify(v)); }).join(';'); }
const mcache = new Map();
export function M(key, fn) {
  let m = mcache.get(key);
  if (!m) { m = fn(); m.userData.shared = true; mcache.set(key, m); }
  return m;
}

export function std(color, o = {}) {
  const key = 'std' + color + okey(o);
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
  const { color = 0x050508, rim = 0x3a64ff, rimK = 0.4, rough = 0.2, map = null, id = 'a', normalMap = null, normalScale = 0.7 } = o;
  const key = 'sym' + color + rim + rimK + rough + id + (normalMap ? normalMap.uuid : '');
  return M(key, () => {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1,
      iridescence: 0.5, iridescenceIOR: 1.5, iridescenceThicknessRange: [120, 420], map,
      normalMap, normalScale: new THREE.Vector2(normalScale, normalScale),
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

export function drawWeb(ctx, W, H, o) {
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


// ================================================================== v2: quality, detail maps, vertex-colour merges
/** 'low' | 'medium' | 'high' | 'ultra' (game.settings.quality; defaults to 'high'). */
export function quality() {
  try { const q = globalThis.game?.settings?.quality; if (q === 'low' || q === 'medium' || q === 'ultra') return q; } catch { /* ignore */ }
  return 'high';
}
/** segment multiplier for round geometry */
export function qk() { const q = quality(); return q === 'low' ? 0.62 : q === 'medium' ? 0.82 : q === 'ultra' ? 1.3 : 1; }
export function texRes() { const q = quality(); return q === 'low' ? 256 : q === 'medium' ? 512 : q === 'ultra' ? 1024 : 1024; }
const seg = (n, min = 6) => Math.max(min, Math.round(n * qk()));
export { seg };

export function phys(color, o = {}) {
  const key = 'phys' + color + okey(o);
  return M(key, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0.05, ...o }));
}

/** fresnel rim light injected into a (standard/physical) material. */
export function withRim(mat, color = 0x9fc0ff, k = 0.35, power = 2.6) {
  if (mat.userData.rimmed) return mat;
  mat.userData.rimmed = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uRimC = { value: new THREE.Color(color) };
    sh.uniforms.uRimK = { value: k };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uRimC;\nuniform float uRimK;\nvoid main() {')
      .replace('#include <opaque_fragment>',
        'float rimF2 = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), ' + power.toFixed(2) + ');\n' +
        'outgoingLight += uRimC * rimF2 * uRimK;\n#include <opaque_fragment>');
  };
  const pk = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (pk ? pk() : '') + 'rim' + power;
  return mat;
}

// ---- canvas helpers
function ntex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(...repeat);
  return t;
}
function heightToNormal(h, W, H, strength) {
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const ym = ((y - 1 + H) % H) * W, y0 = y * W, yp = ((y + 1) % H) * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const nx = (h[y0 + xm] - h[y0 + xp]) * strength, ny = (h[yp + x] - h[ym + x]) * strength;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y0 + x) * 4;
      d[o] = (nx * il * 0.5 + 0.5) * 255; d[o + 1] = (ny * il * 0.5 + 0.5) * 255; d[o + 2] = (il * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function heightOf(ctx, W, H) {
  const d = ctx.getImageData(0, 0, W, H).data, h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = d[i * 4] / 255;
  return h;
}
function blurOn(ctx, px) { if ('filter' in ctx) ctx.filter = `blur(${px}px)`; }
function blurOff(ctx) { if ('filter' in ctx) ctx.filter = 'none'; }
/** over-under woven fabric height field, period in px */
function weaveInto(h, W, H, period, amp) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / period, v = y / period, cell = (Math.floor(u) + Math.floor(v)) & 1;
    const fu = u - Math.floor(u), fv = v - Math.floor(v);
    h[y * W + x] += (cell ? Math.sin(Math.PI * fu) : Math.sin(Math.PI * fv)) * amp;
  }
}
function noiseInto(h, W, H, r, amp) { for (let i = 0; i < W * H; i++) h[i] += (r() - 0.5) * amp; }

/** normal map for the Spider-Man suit: raised web lines + fine knit. Same UV layout as webTexture(kind). */
export function webNormal(kind) {
  const key = 'wn' + kind + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = texRes(), s = W / 512;
  const [c, ctx] = canvas(W, W);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
  blurOn(ctx, 0.8 * s);
  drawWeb(ctx, W, W, { line: '#fff', cols: kind === 'torso' ? 16 : 12, rows: kind === 'torso' ? 14 : 8, lw: 3.0 * s, alpha: 1 });
  blurOff(ctx);
  const h = heightOf(ctx, W, W);
  weaveInto(h, W, W, Math.max(4, 5 * s), 0.16);
  noiseInto(h, W, W, rng(3), 0.05);
  const t = ntex(heightToNormal(h, W, W, 2.4)); texCache.set(key, t); return t;
}

/** suit-fabric normal for generic UV (tile with repeat) */
export function fabricNormal(period = 6, amp = 0.5, name = 'fab') {
  const key = name + period + amp + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = Math.min(texRes(), 512);
  const h = new Float32Array(W * W);
  weaveInto(h, W, W, Math.max(3, period * W / 256), amp);
  noiseInto(h, W, W, rng(9), 0.12);
  const t = ntex(heightToNormal(h, W, W, 1.8)); texCache.set(key, t); return t;
}

/** leather / rough grain normal */
export function grainNormal(name = 'grain', cell = 5, strength = 2.2) {
  const key = name + cell + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = Math.min(texRes(), 512), [c, ctx] = canvas(W, W), r = rng(21);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, W);
  blurOn(ctx, 1.2);
  for (let i = 0; i < W * W / (cell * cell * 2); i++) {
    const x = r() * W, y = r() * W, rr = cell * (0.4 + r() * 0.7), v = 90 + r() * 110;
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.3); ctx.fill();
  }
  blurOff(ctx);
  const t = ntex(heightToNormal(heightOf(ctx, W, W), W, W, strength)); texCache.set(key, t); return t;
}

/** armour panel lines + rivets + metal flake roughness. UV: u around, v along. */
export function panelMaps(seed = 1) {
  const key = 'panel' + seed + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = Math.min(texRes(), 512), r = rng(seed * 13), s = W / 512;
  const [c, ctx] = canvas(W, W); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, W);
  blurOn(ctx, 0.9 * s);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3.2 * s; ctx.lineCap = 'round';
  const vs = [0.0, 0.25, 0.5, 0.75], hs = [0.18, 0.46, 0.7, 0.9];
  for (const u of vs) { const x = (u + (r() - 0.5) * 0.02) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, W); ctx.stroke(); }
  for (const v of hs) { const y = v * W; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.lineWidth = 2 * s;
  for (let i = 0; i < 7; i++) { // secondary plate seams
    const x = r() * W, y = r() * W, w = (0.08 + r() * 0.14) * W, hh = (0.05 + r() * 0.1) * W;
    ctx.strokeRect(x, y, w, hh);
  }
  ctx.fillStyle = '#fff';
  for (const u of vs) for (const v of hs) for (const o of [-9, 9]) { ctx.beginPath(); ctx.arc(u * W + o * s, v * W - 10 * s, 2.0 * s, 0, 6.3); ctx.fill(); }
  blurOff(ctx);
  const h = heightOf(ctx, W, W);
  noiseInto(h, W, W, r, 0.04);
  const normal = ntex(heightToNormal(h, W, W, 2.2));
  const [c2, x2] = canvas(W, W); x2.fillStyle = '#b8b8b8'; x2.fillRect(0, 0, W, W);
  for (let i = 0; i < W * W / 40; i++) { const v = 120 + r() * 135; x2.fillStyle = `rgb(${v},${v},${v})`; x2.fillRect(r() * W, r() * W, 1 + r() * 1.5, 1 + r() * 1.5); }
  x2.strokeStyle = '#fff'; x2.lineWidth = 3 * s; for (const u of vs) { const x = u * W; x2.beginPath(); x2.moveTo(x, 0); x2.lineTo(x, W); x2.stroke(); }
  for (const v of hs) { x2.beginPath(); x2.moveTo(0, v * W); x2.lineTo(W, v * W); x2.stroke(); }
  const rough = ntex(c2);
  const res = { normal, rough }; texCache.set(key, res); return res;
}

/** Hulk skin: colour map with mottling + veins, normal map with pores + raised veins */
export function skinMaps(base = '#4f9d3b', vein = '#2f6e2a', seed = 4) {
  const key = 'skin' + base + vein + seed + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = Math.min(texRes(), 512), s = W / 512;
  const [c, ctx] = canvas(W, W), r = rng(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = r() * W, rr = (20 + r() * 60) * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    const light = r() < 0.5;
    g.addColorStop(0, light ? 'rgba(160,220,110,0.20)' : 'rgba(20,70,25,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  const [hc, hctx] = canvas(W, W); hctx.fillStyle = '#000'; hctx.fillRect(0, 0, W, W);
  const veins = (cx, col, lw, a) => {
    const rr = rng(seed + 5);
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    for (let i = 0; i < 16; i++) {
      let x = rr() * W, y = rr() * W, ang = rr() * 6.28;
      for (let b = 0; b < 3; b++) {
        cx.strokeStyle = col; cx.globalAlpha = a; cx.lineWidth = lw * s * (1 - b * 0.28);
        cx.beginPath(); cx.moveTo(x, y);
        let px = x, py = y, a2 = ang + (b ? (rr() - 0.5) * 1.6 : 0);
        for (let k = 0; k < 7; k++) { a2 += (rr() - 0.5) * 0.9; px += Math.cos(a2) * 26 * s; py += Math.sin(a2) * 26 * s; cx.lineTo(px, py); if (b === 0 && k === 3) { x = px; y = py; } }
        cx.stroke();
      }
    }
    cx.globalAlpha = 1;
  };
  veins(ctx, vein, 3.2, 0.55);
  blurOn(hctx, 1.4 * s); veins(hctx, '#fff', 4, 0.9); blurOff(hctx);
  const rp = rng(seed + 9);
  ctx.fillStyle = 'rgba(15,50,15,0.35)';
  const h = heightOf(hctx, W, W);
  for (let i = 0; i < W * W / 14; i++) { // pores
    const x = (rp() * W) | 0, y = (rp() * W) | 0; ctx.fillRect(x, y, 1, 1); h[y * W + x] -= 0.22; if (x + 1 < W) h[y * W + x + 1] -= 0.08;
  }
  noiseInto(h, W, W, rp, 0.07);
  const map = tex(c); const normal = ntex(heightToNormal(h, W, W, 2.0));
  const res = { map, normal }; texCache.set(key, res); return res;
}

/** overlapping scale-mail. front at canvas centre when offset.x = 0.5. */
export function scaleMaps(base = '#16275a', hi = '#3a5fb8', cells = 8) {
  const key = 'scale' + base + hi + cells + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = Math.min(texRes(), 512), cs = W / cells;
  const h = new Float32Array(W * W);
  const [c, ctx] = canvas(W, W);
  const img = ctx.createImageData(W, W), d = img.data;
  const cb = new THREE.Color(base).convertLinearToSRGB(), ch = new THREE.Color(hi).convertLinearToSRGB();
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const row = Math.floor(y / cs), off = (row & 1) ? cs / 2 : 0;
    const fx = (((x + off) % cs) + cs) % cs / cs, fy = (y % cs) / cs;
    const edge = 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - (2 * fx - 1) ** 2));
    const inside = fy < edge;
    const v = inside ? Math.pow(fy / edge, 0.8) : 0;
    h[y * W + x] = v;
    const k = inside ? 0.25 + 0.75 * v * (0.7 + 0.3 * Math.sin(fx * 3.14)) : 0.0;
    const o = (y * W + x) * 4;
    d[o] = (cb.r + (ch.r - cb.r) * k * 0.9) * 255; d[o + 1] = (cb.g + (ch.g - cb.g) * k * 0.9) * 255; d[o + 2] = (cb.b + (ch.b - cb.b) * k * 0.9) * 255; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const map = tex(c); const normal = ntex(heightToNormal(h, W, W, 3.0));
  const res = { map, normal }; texCache.set(key, res); return res;
}

/** star decal (transparent bg) */
export function starTexture(color = '#ffffff') {
  const key = 'star' + color; if (texCache.has(key)) return texCache.get(key);
  const S = 256, [c, ctx] = canvas(S, S); ctx.fillStyle = color;
  drawStar(ctx, S / 2, S / 2 + 6, S * 0.46, S * 0.19);
  ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
function drawStar(ctx, cx, cy, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i & 1 ? r : R; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  ctx.closePath();
}

/** Captain America's shield: planar-UV disc texture */
export function shieldTexture() {
  if (texCache.has('shield')) return texCache.get('shield');
  const S = 512, [c, ctx] = canvas(S, S), m = S / 2;
  const ring = (r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(m, m, r * m, 0, 6.3); ctx.fill(); };
  ring(1.0, '#b3121e'); ring(0.78, '#f2f2f2'); ring(0.58, '#b3121e'); ring(0.40, '#1d3f9a');
  ctx.fillStyle = '#f4f4f4'; drawStar(ctx, m, m + 4, 0.37 * m, 0.145 * m); ctx.fill();
  // brushed scratches
  const r = rng(77); ctx.globalAlpha = 0.12;
  for (let i = 0; i < 160; i++) { ctx.strokeStyle = r() < 0.5 ? '#fff' : '#000'; ctx.lineWidth = 1; const a = r() * 6.3, rr = r() * m; ctx.beginPath(); ctx.arc(m, m, rr, a, a + 0.4 + r()); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; texCache.set('shield', t); return t;
}

/** domed disc with planar UV (normal +Z) */
export function domeGeo(R, depth, seg = 32, rings = 7) {
  return G(`dome${R}_${depth}_${seg}_${rings}`, () => {
    const pos = [], uv = [], idx = [];
    pos.push(0, 0, depth); uv.push(0.5, 0.5);
    for (let i = 1; i <= rings; i++) {
      const t = i / rings, r = t * R, z = depth * (1 - t * t * 0.92);
      for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2; pos.push(Math.cos(a) * r, Math.sin(a) * r, z); uv.push(0.5 + 0.5 * t * Math.cos(a), 0.5 + 0.5 * t * Math.sin(a)); }
    }
    for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + (j + 1) % seg);
    for (let i = 1; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = 1 + (i - 1) * seg + j, b = 1 + (i - 1) * seg + (j + 1) % seg, c2 = 1 + i * seg + j, d = 1 + i * seg + (j + 1) % seg;
      idx.push(a, c2, b, b, c2, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

// ---- face decals (partial sphere patch with painted eyes/brows/mouth). Front = canvas centre.
export function faceTexture(o = {}) {
  const { skin = '#e0b090', iris = '#4a78b8', brow = '#3a2a1a', lip = '#b4605a', white = '#f4f1ea', mood = 'calm', stubble = 0, brows = true, eyes = true, glow = false } = o;
  const key = 'face' + [skin, iris, brow, lip, white, mood, stubble, brows, eyes, glow].join('|');
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, H = 256, [c, ctx] = canvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, ey = H * 0.42, dx = W * 0.17;
  const angry = mood === 'angry', ang = angry ? 0.35 : mood === 'smirk' ? 0.08 : 0;
  if (eyes) for (const s of [-1, 1]) {
    const x = cx + s * dx;
    ctx.save(); ctx.translate(x, ey); ctx.rotate(s * ang);
    ctx.fillStyle = white; ctx.beginPath(); ctx.ellipse(0, 0, W * 0.062, H * (angry ? 0.03 : 0.036), 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = iris; ctx.beginPath(); ctx.ellipse(0, 0, W * 0.032, H * 0.032, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = glow ? '#fff' : '#05060a'; ctx.beginPath(); ctx.arc(0, 0, W * 0.016, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(-W * 0.01, -H * 0.01, W * 0.007, 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(30,15,10,0.85)'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.ellipse(0, 0, W * 0.064, H * (angry ? 0.031 : 0.038), 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.restore();
  }
  if (brows) {
    ctx.strokeStyle = brow; ctx.lineCap = 'round'; ctx.lineWidth = angry ? 7 : 5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      const x = cx + s * dx, y = ey - H * (angry ? 0.065 : 0.085);
      ctx.moveTo(x - s * W * 0.075, y + (angry ? -H * 0.015 : H * 0.012)); ctx.quadraticCurveTo(x, y - H * 0.02 * (angry ? 0 : 1), x + s * W * 0.075, y + (angry ? H * 0.03 : H * 0.005));
      ctx.stroke();
    }
  }
  // nose shading + nostrils
  ctx.fillStyle = 'rgba(70,35,20,0.28)'; ctx.beginPath(); ctx.ellipse(cx, H * 0.62, W * 0.034, H * 0.014, 0, 0, 6.3); ctx.fill();
  // mouth
  const my = H * 0.76;
  if (mood === 'angry') {
    ctx.fillStyle = '#22090a'; ctx.beginPath(); ctx.ellipse(cx, my, W * 0.11, H * 0.034, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#eee'; ctx.fillRect(cx - W * 0.09, my - H * 0.03, W * 0.18, H * 0.016);
  } else {
    ctx.strokeStyle = lip; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx - W * 0.075, my);
    ctx.quadraticCurveTo(cx, my + H * (mood === 'smirk' ? 0.025 : 0.012), cx + W * 0.075, my - (mood === 'smirk' ? H * 0.012 : 0)); ctx.stroke();
    ctx.strokeStyle = 'rgba(70,30,25,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - W * 0.05, my + H * 0.02); ctx.quadraticCurveTo(cx, my + H * 0.035, cx + W * 0.05, my + H * 0.02); ctx.stroke();
  }
  if (stubble > 0) {
    const r = rng(5); ctx.fillStyle = `rgba(30,22,16,${0.5 * stubble})`;
    for (let i = 0; i < 700 * stubble; i++) { const x = W * (0.2 + r() * 0.6), y = H * (0.62 + r() * 0.34); ctx.fillRect(x, y, 1.4, 1.4); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
/** partial-sphere shell over the front of an ellipsoid head, to carry faceTexture */
export function faceShell(R = 1, phiHalf = 0.95, t0 = 0.27, t1 = 0.78) {
  return G(`faceshell${R}_${phiHalf}_${t0}_${t1}_${qk()}`, () => new THREE.SphereGeometry(R, seg(20, 10), seg(14, 8), Math.PI / 2 - phiHalf, phiHalf * 2, Math.PI * t0, Math.PI * (t1 - t0)));
}

/**
 * Merge parts [{geo,color,pos,rot,scale}] into one vertex-coloured geometry (position+normal+color).
 * Used by the cheap street-people meshes.
 */
export function mergeColored(key, parts) {
  return G(key, () => {
    const gs = parts.map((p) => {
      let g = p.geo.clone();
      const m = new THREE.Matrix4().compose(
        p.pos ? new V3(...p.pos) : new V3(),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
        p.scale ? (typeof p.scale === 'number' ? new V3(p.scale, p.scale, p.scale) : new V3(...p.scale)) : new V3(1, 1, 1));
      g.applyMatrix4(m);
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
      const col = new THREE.Color(p.color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    });
    if (!gs.every((g) => g.index)) gs.forEach((g, i) => { if (g.index) gs[i] = g.toNonIndexed(); });
    return mergeGeometries(gs);
  });
}

/** generic cached canvas colour texture: fn(ctx, W, H). o: { offsetX, repeat:[x,y], clamp } */
export function drawTex(key, W, H, fn, o = {}) {
  const k = 'dt' + key + (o.repeat || '') + (o.offsetX || '');
  if (texCache.has(k)) return texCache.get(k);
  const [c, ctx] = canvas(W, H); fn(ctx, W, H);
  const t = tex(c, o.repeat); if (o.offsetX) t.offset.x = o.offsetX;
  if (o.clamp) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  texCache.set(k, t); return t;
}
