// Street people for the GTA-style city: 'civilian' (many looks) and 'cop'.
// ONE SkinnedMesh and ONE shared material per person (1 draw call, +1 for a cop's pistol), driven by the existing
// ProcModel joint rig. Clothes, hair, face detail, bags and phones are merged into that mesh with vertex colours.
// A shared procedural cloth atlas (denim, knit, pinstripe, plaid, floral, batik, ...) is sampled per part through a tiny
// onBeforeCompile hook (attribute aPat = atlas cell + repeat), so there is still a single material for every person.
// No per-frame allocations: the rig update is the plain ProcModel one, plus a hook that raises an arm for phone users.
import * as THREE from 'three';
import { buildRig, makeDims, ProcModel, J } from './rig.js';
import { G, M, limbGeo, profileGeo, mergeColored } from './common.js';

const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

export const CIVILIAN_VARIANTS = ['suit', 'hoodie', 'jacket', 'dress', 'delivery', 'jogger', 'tourist', 'hivis', 'student', 'elder',
  'casual', 'shorts', 'blouse', 'kurta', 'sari', 'kurung', 'batik', 'office'];

// ================================================================== cloth atlas
const CELL = 128;
const PATS = {
  plain: { c: 0, r: 0, gain: 1.0, tile: 0.3 }, weave: { c: 1, r: 0, gain: 1.05, tile: 0.1 }, denim: { c: 2, r: 0, gain: 1.18, tile: 0.14 },
  knit: { c: 3, r: 0, gain: 1.1, tile: 0.1 }, pin: { c: 4, r: 0, gain: 1.05, tile: 0.2 }, plaid: { c: 5, r: 0, gain: 1.08, tile: 0.2 },
  floral: { c: 6, r: 0, gain: 1.6, tile: 0.2 }, dots: { c: 7, r: 0, gain: 1.06, tile: 0.14 },
  batik: { c: 0, r: 1, gain: 1.4, tile: 0.2 }, stripes: { c: 1, r: 1, gain: 1.05, tile: 0.16 }, gingham: { c: 2, r: 1, gain: 1.08, tile: 0.16 },
  leather: { c: 3, r: 1, gain: 1.12, tile: 0.2 }, paisley: { c: 4, r: 1, gain: 1.35, tile: 0.2 }, hair: { c: 5, r: 1, gain: 1.12, tile: 0.2 },
  tweed: { c: 6, r: 1, gain: 1.12, tile: 0.12 }, rib: { c: 7, r: 1, gain: 1.06, tile: 0.08 }, mesh: { c: 0, r: 2, gain: 1.05, tile: 0.08 },
};
let atlasTex = null;
function makeAtlas() {
  if (atlasTex) return atlasTex;
  const cv = document.createElement('canvas'); cv.width = CELL * 8; cv.height = CELL * 4;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cell = (name, fn, noise = 8) => {
    const { c, r } = PATS[name]; g.save(); g.beginPath(); g.rect(c * CELL, r * CELL, CELL, CELL); g.clip(); g.translate(c * CELL, r * CELL);
    fn(); g.restore();
    if (noise) { const id = g.getImageData(c * CELL, r * CELL, CELL, CELL), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * noise * 2; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, c * CELL, r * CELL); }
  };
  const wrap = (fn) => { for (const ox of [-CELL, 0, CELL]) for (const oy of [-CELL, 0, CELL]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  const fill = (col) => { g.fillStyle = col; g.fillRect(0, 0, CELL, CELL); };
  cell('plain', () => fill('#ececec'), 9);
  cell('weave', () => { fill('#e6e6e6'); for (let i = 0; i < 64; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.18)'; g.fillRect(i * 2, 0, 1, CELL); g.fillStyle = i % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.12)'; g.fillRect(0, i * 2, CELL, 1); } }, 5);
  cell('denim', () => { fill('#d2d2d2'); g.lineWidth = 1; for (let k = -CELL; k < CELL * 2; k += 3) { g.strokeStyle = (k / 3) % 2 ? 'rgba(0,0,40,0.16)' : 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(k, 0); g.lineTo(k + CELL, CELL); g.stroke(); } for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * CELL, 0, 1 + rnd() * 3, CELL); } }, 12);
  cell('knit', () => { fill('#e4e4e4'); wrap(() => { g.lineWidth = 1.6; for (let y = 0; y < CELL; y += 8) for (let x = 0; x < CELL; x += 8) { g.strokeStyle = 'rgba(0,0,0,0.30)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 6); g.lineTo(x + 8, y); g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x, y + 1.5); g.lineTo(x + 4, y + 7.5); g.lineTo(x + 8, y + 1.5); g.stroke(); } }); }, 5);
  cell('pin', () => { fill('#ededed'); for (let x = 0; x < CELL; x += 8) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(x, 0, 1.3, CELL); } for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, i * 3, CELL, 1); } }, 5);
  cell('plaid', () => { fill('#ececec'); for (const p of [10, 58, 100]) { const w = p === 58 ? 26 : 12; g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(p, 0, w, CELL); g.fillRect(0, p, CELL, w); } g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(70, 0, 2, CELL); g.fillRect(0, 70, CELL, 2); }, 6);
  cell('floral', () => { fill('#8e8e8e'); wrap(() => { for (let i = 0; i < 7; i++) { const x = rnd() * CELL, y = rnd() * CELL, s = 0.8 + rnd() * 0.6; g.fillStyle = '#a2a2a2'; g.beginPath(); g.ellipse(x + 8 * s, y + 9 * s, 4 * s, 9 * s, 0.6, 0, 6.3); g.fill(); g.beginPath(); g.ellipse(x - 9 * s, y + 8 * s, 4 * s, 9 * s, -0.7, 0, 6.3); g.fill(); g.fillStyle = '#f6f6f6'; for (let p = 0; p < 5; p++) { const a = p * 1.2566; g.beginPath(); g.arc(x + Math.cos(a) * 6 * s, y + Math.sin(a) * 6 * s, 5 * s, 0, 6.3); g.fill(); } g.fillStyle = '#c4c4c4'; g.beginPath(); g.arc(x, y, 3 * s, 0, 6.3); g.fill(); } }); }, 6);
  cell('dots', () => { fill('#ededed'); wrap(() => { for (let y = 0; y < CELL; y += 32) for (let x = 0; x < CELL; x += 32) { g.fillStyle = '#7e7e7e'; g.beginPath(); g.arc(x + 8 + ((y / 32) % 2) * 16, y + 8, 5, 0, 6.3); g.fill(); } }); }, 5);
  cell('batik', () => { fill('#dcdcdc'); wrap(() => { g.lineWidth = 1.6; for (let y = 0; y < CELL; y += 32) for (let x = 0; x < CELL; x += 32) { const cx = x + 16, cy = y + 16; g.strokeStyle = '#6a6a6a'; for (let k = 0; k < 4; k++) { g.save(); g.translate(cx, cy); g.rotate(k * Math.PI / 2); g.beginPath(); g.ellipse(0, 8, 6, 11, 0, 0, 6.3); g.stroke(); g.restore(); } g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(cx, cy, 2.6, 0, 6.3); g.fill(); g.fillStyle = '#a8a8a8'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + (k % 2) * 32, y + ((k / 2) | 0) * 32, 2, 0, 6.3); g.fill(); } } }); }, 5);
  cell('stripes', () => { fill('#efefef'); for (let y = 0; y < CELL; y += 16) { g.fillStyle = '#9c9c9c'; g.fillRect(0, y, CELL, 8); } }, 5);
  cell('gingham', () => { fill('#efefef'); g.fillStyle = 'rgba(0,0,0,0.24)'; for (let p = 0; p < CELL; p += 16) { g.fillRect(p, 0, 8, CELL); g.fillRect(0, p, CELL, 8); } }, 5);
  cell('leather', () => { fill('#cdcdcd'); for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(0,0,0,${0.06 + rnd() * 0.1})`; g.lineWidth = 1; g.beginPath(); const x = rnd() * CELL, y = rnd() * CELL; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 18, y + (rnd() - 0.5) * 18); g.stroke(); } }, 14);
  cell('paisley', () => { fill('#dedede'); wrap(() => { for (let i = 0; i < 6; i++) { const x = (i % 3) * 43 + 6, y = ((i / 3) | 0) * 64 + 10; g.strokeStyle = '#6e6e6e'; g.lineWidth = 1.5; g.fillStyle = '#b0b0b0'; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 22, y - 6, x + 26, y + 26, x + 6, y + 30); g.bezierCurveTo(x + 14, y + 20, x + 8, y + 10, x, y); g.fill(); g.stroke(); g.fillStyle = '#6e6e6e'; g.beginPath(); g.arc(x + 11, y + 14, 2, 0, 6.3); g.fill(); } }); }, 5);
  cell('hair', () => { fill('#d6d6d6'); for (let i = 0; i < 120; i++) { const x = rnd() * CELL, w = 0.8 + rnd() * 1.6; g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.08 + rnd() * 0.2})` : `rgba(255,255,255,${0.1 + rnd() * 0.3})`; g.fillRect(x, 0, w, CELL); } }, 4);
  cell('tweed', () => { fill('#dadada'); g.lineWidth = 1.4; for (let y = 0; y < CELL; y += 6) for (let x = 0; x < CELL; x += 6) { g.strokeStyle = (Math.floor(y / 6) % 2) ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.4)'; g.beginPath(); if ((Math.floor(x / 12) + Math.floor(y / 6)) % 2) { g.moveTo(x, y); g.lineTo(x + 6, y + 6); } else { g.moveTo(x + 6, y); g.lineTo(x, y + 6); } g.stroke(); } }, 6);
  cell('rib', () => { fill('#e8e8e8'); for (let x = 0; x < CELL; x += 6) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 2, CELL); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 3, 0, 1, CELL); } }, 4);
  cell('mesh', () => { fill('#e2e2e2'); for (let y = 0; y < CELL; y += 4) for (let x = 0; x < CELL; x += 4) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + 1, y + 1, 2, 2); } }, 4);
  atlasTex = new THREE.CanvasTexture(cv);
  atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;
  atlasTex.anisotropy = 4; atlasTex.generateMipmaps = true; atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  return atlasTex;
}

const pedMat = () => M('pedMat2', () => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 });
  let tex = null;
  try { tex = makeAtlas(); } catch { tex = null; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.patMap = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPat;\nvarying vec4 vPat;\nvarying vec2 vPUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = aPat; vPUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPat;\nvarying vec2 vPUv;\nuniform sampler2D patMap;')
      .replace('#include <map_fragment>', `
        vec2 pRep = max(vPat.zw, vec2(1.0));
        vec2 pUv = vPUv * pRep;
        vec2 pCell = floor(vPat.xy + 0.5);
        vec2 pF = fract(pUv);
        vec2 pA = (pCell + 0.02 + pF * 0.96) * vec2(0.125, 0.25);
        vec2 pdx = dFdx(pUv) * vec2(0.125, 0.25), pdy = dFdy(pUv) * vec2(0.125, 0.25);
        vec3 pT = textureGrad(patMap, pA, pdx, pdy).rgb;
        diffuseColor.rgb *= pT;`);
  };
  m.customProgramCacheKey = () => 'pedpat2';
  return m;
});
const gunMat = () => M('pedGun', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }));

// ================================================================== geometry kit (shared, never mutated)
const sph = (a = 8, b = 6) => G(`ps${a}_${b}`, () => new THREE.SphereGeometry(1, a, b));
const bx = () => G('pbox', () => new THREE.BoxGeometry(1, 1, 1));
const cyl = (n = 8) => G('pcyl' + n, () => new THREE.CylinderGeometry(1, 1, 1, n));
const dome = (n = 10) => G('pdome' + n, () => new THREE.SphereGeometry(1, n, Math.ceil(n / 2), 0, Math.PI * 2, 0, Math.PI * 0.5));
const tube = (rt, rb, h, n, hs = 1) => G(`ptube${rt.toFixed(3)}_${rb.toFixed(3)}_${h.toFixed(3)}_${n}_${hs}`, () => new THREE.CylinderGeometry(rt, rb, h, n, hs, true));
const skirtGeo = (rt, rb, h, n) => G(`pskirt${rt.toFixed(3)}_${rb.toFixed(3)}_${h.toFixed(3)}_${n}`, () => { const g = new THREE.CylinderGeometry(rt, rb, h, n, 4, true); return g; });
const torus = (r, t, n) => G(`ptor${r}_${t}_${n}`, () => new THREE.TorusGeometry(r, t, 5, n));

// ================================================================== skinned merge
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _pv = new V3(), _sv = new V3(), _v = new V3(), _n3 = new THREE.Matrix3(), _nv = new V3();
const _col = new THREE.Color();
const _bb = new THREE.Box3();
/**
 * parts: [{ bone, geo, color, pos, rot, scale, pat, tile, skin(x,y,z) -> [b0,w0,b1,w1] (bind-space-of-bone coords) }]
 * bind[b] = joint world matrix in the canonical (all rotations zero) pose. Returns a BufferGeometry in group space.
 */
function mergeSkinned(parts, bind) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), pat = new Float32Array(nv * 4);
  const sIdx = new Uint16Array(nv * 4), sW = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const geo = p.geo, pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv;
    const sc = p.scale == null ? [1, 1, 1] : typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
    _pv.set(...(p.pos || [0, 0, 0])); _q.setFromEuler(_e.set(...(p.rot || [0, 0, 0]))); _sv.set(sc[0], sc[1], sc[2]);
    _m4.compose(_pv, _q, _sv).premultiply(bind[p.bone]);
    _n3.getNormalMatrix(_m4);
    if (!geo.boundingBox) geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(_v);
    const pt = PATS[p.pat || 'plain'];
    const tile = p.tile ?? pt.tile;
    const wx = size.x * Math.abs(sc[0]), wy = size.y * Math.abs(sc[1]), wz = size.z * Math.abs(sc[2]);
    const repU = Math.max(1, Math.round(Math.PI * 0.5 * (wx + wz) / tile)), repV = Math.max(1, Math.round(wy / tile));
    _col.set(p.color); const gain = pt.gain * (p.gain ?? 1);
    const cr = Math.min(1.6, _col.r * gain), cg = Math.min(1.6, _col.g * gain), cb = Math.min(1.6, _col.b * gain);
    for (let i = 0; i < pa.count; i++) {
      const o = vo + i;
      _v.fromBufferAttribute(pa, i);
      if (p.skin) {
        const sw = p.skin(_v.x * sc[0] + _pv.x, _v.y * sc[1] + _pv.y, _v.z * sc[2] + _pv.z);
        sIdx[o * 4] = sw[0]; sW[o * 4] = sw[1]; sIdx[o * 4 + 1] = sw[2]; sW[o * 4 + 1] = sw[3];
      } else { sIdx[o * 4] = p.bone; sW[o * 4] = 1; }
      _v.applyMatrix4(_m4);
      pos[o * 3] = _v.x; pos[o * 3 + 1] = _v.y; pos[o * 3 + 2] = _v.z;
      _nv.fromBufferAttribute(na, i).applyMatrix3(_n3).normalize();
      nor[o * 3] = _nv.x; nor[o * 3 + 1] = _nv.y; nor[o * 3 + 2] = _nv.z;
      const shade = p.vary ? 1 + (Math.sin(_v.y * 40 + _v.x * 23) * 0.5) * p.vary : 1;
      col[o * 3] = cr * shade; col[o * 3 + 1] = cg * shade; col[o * 3 + 2] = cb * shade;
      uv[o * 2] = ua ? ua.getX(i) : 0; uv[o * 2 + 1] = ua ? ua.getY(i) : 0;
      pat[o * 4] = pt.c; pat[o * 4 + 1] = pt.r; pat[o * 4 + 2] = repU; pat[o * 4 + 3] = repV;
    }
    if (geo.index) { const gi = geo.index; for (let i = 0; i < gi.count; i++) idx[io++] = gi.getX(i) + vo; } else for (let i = 0; i < pa.count; i++) idx[io++] = vo + i;
    vo += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aPat', new THREE.BufferAttribute(pat, 4));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ================================================================== people tables
const ETH = {
  chinese: { skin: [0xe2b690, 0xd9aa84, 0xcf9d78, 0xc49070], hair: [0x16120e, 0x1a130e, 0x241810, 0x33241a] },
  malay: { skin: [0xb98558, 0xab784c, 0x9b6a42, 0x8a5a36], hair: [0x15100c, 0x1c140e, 0x2a1c12] },
  indian: { skin: [0x96603a, 0x84502e, 0x704226, 0x5c351d], hair: [0x110d0a, 0x18110c, 0x221710] },
  white: { skin: [0xe8b99c, 0xe0ad8e, 0xd4a07c, 0xc99470], hair: [0x15110d, 0x3b2615, 0x6b4423, 0xa77a3a, 0xd8c27a, 0x7a2e1f, 0x2a1d14] },
  black: { skin: [0x6a432a, 0x563620, 0x432917, 0x321d10], hair: [0x0d0a08, 0x14100c, 0x1e1510] },
  latino: { skin: [0xc48f68, 0xb27a52, 0x9e6a42, 0xd0a07a], hair: [0x110d0a, 0x1a130e, 0x2d1e12, 0x4a3320] },
  mideast: { skin: [0xc2926c, 0xb08058, 0x9c6c46], hair: [0x110d0a, 0x1a130e, 0x2a1d14] },
};
const MIX = {
  nyc: [['white', 0.34], ['black', 0.22], ['latino', 0.22], ['chinese', 0.12], ['indian', 0.06], ['mideast', 0.04]],
  sg: [['chinese', 0.70], ['malay', 0.14], ['indian', 0.10], ['white', 0.04], ['mideast', 0.02]],
};
const wpick = (list, r) => { let s = 0; for (const [k, w] of list) { s += w; if (r <= s) return k; } return list[0][0]; };
const pickA = (a) => a[Math.floor(Math.random() * a.length) % a.length];
const rr = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

const PAL = {
  tee: [0xdcdcdc, 0x2f3a4a, 0x8a1f2d, 0x2b6a8f, 0x3d7a4a, 0xe3b53c, 0x1b1b1f, 0x6a4a8a, 0xd86a4a, 0x4a8a8a, 0xf2f2f2, 0x3a4a7a, 0xc9a9a0],
  shirt: [0xf0f0f2, 0xb8cde8, 0x9fb7d8, 0xe8e2d0, 0x3d5a8a, 0xc4d4c0, 0xf0d8dc, 0x2f3a4a],
  dark: [0x1b1c22, 0x23262e, 0x2b3045, 0x3a3f4a, 0x1c2a45, 0x35302c],
  jeans: [0x3a5278, 0x2c3e60, 0x1f2c48, 0x536a8c, 0x15192a],
  slacks: [0x23262e, 0x3a3f4a, 0x4a4438, 0x5b564c, 0x2b3045, 0x6a6458],
  jacket: [0x86201f, 0x2f5a3a, 0x6a4a2a, 0x1f2430, 0x4a5568, 0x7a6a50, 0x2f4a6a, 0x545b3a],
  hood: [0x585d68, 0x7a3b3b, 0x2f4a6a, 0x1c1c20, 0x4a6a4a, 0x8a8f9a, 0x6a4a7a],
  bright: [0xc83a6a, 0x3a6ac8, 0xe8c840, 0x6a3ab0, 0x2aa88a, 0xe8742a, 0xd84a4a, 0x2a8ad0],
  pastel: [0xe8b4c0, 0xb4d0e8, 0xf0e0a8, 0xc8e0c0, 0xd0c0e8, 0xf0c8a8],
  shoe: [0x1a1a1a, 0xe8e8e8, 0x3a2a1e, 0x8a8a90, 0x2a3550, 0x7a2a2a],
  bag: [0x1a1a1f, 0x3a2a1e, 0x8a2a2a, 0x2a4a6a, 0x6a6a70, 0xc89a4a, 0x2f5a3a],
};

// ================================================================== outfit generation
function genOutfit(region, forceName, forceFemale) {
  const eth = wpick(MIX[region] || MIX.nyc, Math.random());
  const female = forceFemale ?? chance(0.5);
  const E = ETH[eth];
  const skin = pickA(E.skin);
  let hairCol = pickA(E.hair);
  const o = {
    eth, female, skin, hairCol, bw: rr(0.9, 1.1), hf: female ? rr(0.93, 1.0) : rr(0.97, 1.06), top: { kind: 'tee', col: 0xdddddd, pat: 'weave' }, sleeve: 'short',
    bottom: { kind: 'jeans', col: 0x3a5278, pat: 'denim' }, shoes: { kind: 'sneaker', col: 0xe8e8e8, sole: 0xf2f2f2 },
    hair: 'short', hat: null, bag: null, phone: 0, glasses: false, beard: false, stoop: false, headphones: false, belt: true, item: null, name: 'casual',
    stride: rr(0.82, 1.0), cadence: rr(0.9, 1.1), arm: rr(0.55, 1.0), lean: rr(0.45, 0.9), bob: rr(0.7, 1.2), tempo: 1, speedK: 1,
  };
  // hair by ethnicity / gender
  const hairFor = (cult) => {
    if (female) {
      if (eth === 'black') return pickA(['curly', 'afro', 'braids', 'short', 'bob']);
      return pickA(['long', 'long', 'bob', 'pony', 'bun', 'wavy', 'short', 'side']);
    }
    if (eth === 'black') return pickA(['buzz', 'afro', 'short', 'buzz', 'braids', 'curly']);
    if (cult === 'old') return pickA(['grey', 'bald', 'balding']);
    return pickA(['short', 'side', 'short', 'buzz', 'crop', 'slick', 'curly', 'balding']);
  };
  const names = ['casual', 'casual', 'casual', 'hoodie', 'jacket', 'suit', 'office', 'dress', 'blouse', 'shorts', 'student', 'jogger', 'delivery', 'tourist', 'hivis', 'elder'];
  let name = forceName || pickA(names);
  if (!forceName) {
    if (eth === 'indian' && chance(region === 'sg' ? 0.2 : 0.14)) name = female ? 'sari' : 'kurta';
    else if (eth === 'malay' && chance(0.34)) name = female ? 'kurung' : (chance(0.5) ? 'batik' : name);
    else if (eth === 'chinese' && chance(0.06)) name = female ? 'blouse' : 'batik';
    if (female && (name === 'hivis' || name === 'delivery' && chance(0.7))) name = pickA(['blouse', 'dress', 'casual']);
    if (!female && (name === 'dress' || name === 'blouse')) name = pickA(['casual', 'office', 'jacket']);
  }
  o.name = name;
  const shoeSet = () => pickA(['sneaker', 'sneaker', 'sneaker', 'leather', 'sandal', 'flip']);
  const sk = skin;
  switch (name) {
    case 'suit': case 'office': {
      const dark = pickA(PAL.dark);
      if (female && name === 'office') { o.top = { kind: 'blouse', col: pickA(PAL.shirt.concat(PAL.pastel)), pat: pickA(['weave', 'weave', 'stripes', 'dots']) }; o.sleeve = pickA(['short', 'long']); o.bottom = { kind: chance(0.5) ? 'skirt' : 'slacks', col: dark, pat: 'weave' }; o.shoes = { kind: 'heel', col: pickA([0x1a1a1a, 0x7a2a3a, 0x3a2a1e]), sole: 0x111111 }; o.hair = hairFor(); o.bag = pickA(['hand', 'shoulder']); }
      else if (name === 'suit' || !female && chance(0.4)) { o.top = { kind: 'suit', col: dark, col2: pickA(PAL.shirt), tie: pickA([0xa01820, 0x1c3a8c, 0x2a6a3a, 0x222222, 0xc89a2a]), pat: chance(0.45) ? 'pin' : 'weave' }; o.sleeve = 'long'; o.bottom = { kind: 'slacks', col: dark, pat: 'weave' }; o.shoes = { kind: 'leather', col: pickA([0x111111, 0x3a2a1e]), sole: 0x111111 }; o.item = 'case'; o.hair = hairFor(); if (female) { o.bottom.kind = chance(0.5) ? 'skirt' : 'slacks'; o.shoes.kind = 'heel'; o.item = null; o.bag = 'hand'; } }
      else { o.top = { kind: 'shirt', col: pickA(PAL.shirt), pat: pickA(['weave', 'gingham', 'stripes', 'pin']), tie: chance(0.5) ? pickA([0xa01820, 0x1c3a8c, 0x222222]) : 0 }; o.sleeve = pickA(['long', 'short']); o.bottom = { kind: 'slacks', col: pickA(PAL.slacks), pat: 'weave' }; o.shoes = { kind: 'leather', col: pickA([0x111111, 0x3a2a1e]), sole: 0x111111 }; o.bag = chance(0.4) ? 'shoulder' : null; o.hair = hairFor(); }
      o.glasses = chance(0.3); o.beard = !female && chance(0.12); o.phone = chance(0.3) ? 1 + (chance(0.5) ? 1 : 0) : 0; break;
    }
    case 'hoodie':
      o.top = { kind: 'hoodie', col: pickA(PAL.hood), pat: 'weave' }; o.sleeve = 'long'; o.bottom = { kind: female && chance(0.4) ? 'leggings' : 'jeans', col: female ? pickA([0x1b1b1f, 0x2c3e60]) : pickA(PAL.jeans), pat: 'denim' };
      o.shoes = { kind: 'sneaker', col: pickA(PAL.shoe), sole: 0xf0f0f0 }; o.hair = chance(0.5) ? 'hood' : hairFor(); o.headphones = chance(0.25); o.phone = chance(0.45) ? 2 : 0; o.bag = chance(0.3) ? 'pack' : null; o.glasses = chance(0.15); break;
    case 'jacket':
      o.top = { kind: 'jacket', col: pickA(PAL.jacket), col2: pickA(PAL.tee), pat: pickA(['weave', 'leather', 'weave']) }; o.sleeve = 'long'; o.bottom = { kind: 'jeans', col: pickA(PAL.jeans), pat: 'denim' };
      o.shoes = { kind: pickA(['sneaker', 'boot', 'leather']), col: pickA(PAL.shoe), sole: 0x222222 }; o.hair = hairFor(); o.bag = chance(0.4) ? pickA(['shoulder', 'pack', 'hand']) : null; o.glasses = chance(0.18); o.beard = !female && chance(0.15); o.phone = chance(0.3) ? 1 : 0; break;
    case 'dress': {
      const fl = chance(0.5);
      o.female = true; o.top = { kind: 'dress', col: fl ? pickA([0x7a3a5a, 0x3a5a7a, 0xb04a5a, 0x4a7a5a]) : pickA(PAL.bright), pat: fl ? 'floral' : pickA(['weave', 'weave', 'dots']) }; o.sleeve = pickA(['none', 'short']);
      o.bottom = { kind: 'dress', col: o.top.col, pat: o.top.pat }; o.shoes = { kind: pickA(['sandal', 'sneaker', 'heel', 'flip']), col: pickA([0xe8e8e8, 0x7a2a3a, 0x3a2a1e, 0xd8b090]), sole: 0xdddddd };
      o.hair = hairFor(); o.bag = pickA(['hand', 'shoulder', 'shoulder']); o.glasses = chance(0.15); o.phone = chance(0.3) ? 2 : 0; o.stride = rr(0.7, 0.85); break;
    }
    case 'blouse':
      o.female = true; o.top = { kind: 'blouse', col: chance(0.4) ? pickA(PAL.pastel) : pickA(PAL.bright), pat: pickA(['weave', 'floral', 'dots', 'stripes']) }; o.sleeve = pickA(['short', 'none', 'three', 'long']);
      o.bottom = { kind: pickA(['jeans', 'skirt', 'slacks', 'skirt']), col: pickA(PAL.jeans.concat(PAL.slacks)), pat: 'weave' }; if (o.bottom.kind === 'jeans') o.bottom.pat = 'denim';
      o.shoes = { kind: pickA(['sneaker', 'sandal', 'heel', 'flip']), col: pickA(PAL.shoe), sole: 0xe0e0e0 }; o.hair = hairFor(); o.bag = pickA(['hand', 'shoulder', 'tote']); o.glasses = chance(0.2); o.phone = chance(0.35) ? 2 : 0; break;
    case 'delivery': {
      const brand = region === 'sg' ? pickA([0x00b14f, 0xe21b70, 0x00ccbc]) : pickA([0xe8742a, 0x2c9a4a, 0x2a7ad0]);
      o.top = { kind: 'polo', col: brand, pat: 'mesh' }; o.sleeve = 'short'; o.bottom = { kind: pickA(['trackpants', 'jeans', 'shorts']), col: 0x222833, pat: 'weave' }; o.shoes = { kind: 'sneaker', col: 0x2a2a2a, sole: 0xdddddd };
      o.hair = 'cap'; o.hat = { kind: 'cap', col: brand }; o.item = 'box'; o.itemCol = brand; o.phone = chance(0.4) ? 1 : 0; o.female = false; break;
    }
    case 'jogger':
      o.top = { kind: 'sport', col: pickA([0xe84a2a, 0x2aa8e8, 0xf0f0f0, 0x6a3ab0, 0x1c1c20, 0x2aa86a]), pat: 'mesh' }; o.sleeve = chance(0.4) ? 'none' : 'short'; o.bottom = { kind: female ? pickA(['leggings', 'shorts']) : 'shorts', col: pickA([0x181820, 0x2a2a5a, 0x1c1c20, 0x3a3a40]), pat: 'mesh' };
      o.shoes = { kind: 'sneaker', col: pickA([0xf2f2f2, 0xe84a2a, 0x2aa8e8, 0xf0c020]), sole: 0xf4f4f4 }; o.hair = female ? pickA(['pony', 'bun', 'headband']) : pickA(['short', 'crop', 'headband']); o.headphones = chance(0.5); o.phone = chance(0.2) ? 1 : 0;
      o.stride = rr(1.0, 1.1); o.cadence = rr(1.05, 1.2); o.arm = rr(1.0, 1.2); o.bw *= 0.93; o.belt = false; o.speedK = 1.7; break;
    case 'tourist':
      o.top = { kind: pickA(['tee', 'tee', 'polo']), col: pickA([0x1aa8a0, 0xf0a030, 0xe05a8a, 0x80b8e0, 0xf0e8d0]), pat: pickA(['weave', 'stripes', 'floral', 'batik']) }; o.sleeve = 'short'; o.bottom = { kind: pickA(['shorts', 'shorts', 'cargo', 'slacks']), col: pickA([0xb8a888, 0xd8d0b8, 0x7a8a6a, 0x3a5278]), pat: 'weave' };
      o.shoes = { kind: pickA(['sandal', 'sneaker', 'flip']), col: pickA([0xf0f0f0, 0x3a2a1e]), sole: 0xdddddd }; o.hair = chance(0.55) ? 'sunhat' : 'cap'; o.hat = { kind: o.hair, col: pickA([0xe8d8a0, 0xf0f0f0, 0x2a4a6a]) }; o.item = 'camera'; o.glasses = chance(0.6); o.sunglasses = chance(0.5); o.bag = chance(0.5) ? 'pack' : 'tote'; o.phone = chance(0.25) ? 2 : 0; o.bw *= 1.06; break;
    case 'hivis':
      o.top = { kind: 'hivis', col: pickA([0xc8e620, 0xf08a1c]), col2: 0x55575c, pat: 'weave' }; o.sleeve = 'long'; o.bottom = { kind: 'slacks', col: pickA([0x39404a, 0x4a4030]), pat: 'weave' }; o.shoes = { kind: 'boot', col: 0x6a4a2a, sole: 0x222222 };
      o.hair = 'hardhat'; o.hat = { kind: 'hardhat', col: pickA([0xf0c420, 0xf0f0f0, 0xe85a2a]) }; o.female = false; o.bw *= 1.08; o.beard = chance(0.25); o.hf = rr(0.98, 1.06); o.stride = rr(0.9, 1.0); break;
    case 'student':
      o.top = { kind: pickA(['tee', 'hoodie', 'shirt', 'sweater']), col: pickA(PAL.tee.concat(PAL.pastel)), pat: 'weave' }; if (o.top.kind === 'hoodie') o.top.col = pickA(PAL.hood); o.sleeve = o.top.kind === 'tee' ? 'short' : 'long';
      o.bottom = { kind: female ? pickA(['jeans', 'skirt', 'shorts', 'leggings']) : pickA(['jeans', 'shorts', 'slacks']), col: pickA(PAL.jeans), pat: 'denim' }; if (o.bottom.kind === 'skirt' || o.bottom.kind === 'slacks') { o.bottom.col = pickA([0x2a3550, 0x3a3a40, 0x6a2a3a]); o.bottom.pat = 'plaid'; }
      o.shoes = { kind: 'sneaker', col: pickA(PAL.shoe), sole: 0xf0f0f0 }; o.hair = hairFor(); o.bag = 'pack'; o.packCol = pickA(PAL.bag.concat(PAL.bright)); o.headphones = chance(0.3); o.glasses = chance(0.25); o.phone = chance(0.55) ? 2 : 0; o.hf *= 0.97; o.bw *= 0.94; break;
    case 'elder': {
      o.top = { kind: pickA(['shirt', 'sweater', 'polo']), col: pickA([0x7a6a58, 0x587a68, 0xb8a890, 0x8a9ab0, 0xc8b0b0]), pat: pickA(['weave', 'knit', 'gingham']) }; o.sleeve = pickA(['long', 'short']);
      o.bottom = { kind: female && chance(0.5) ? 'skirt' : 'slacks', col: pickA([0x4a4a52, 0x5b564c, 0x2b3045]), pat: 'weave' }; o.shoes = { kind: pickA(['leather', 'sneaker']), col: 0x2a2018, sole: 0x111111 }; o.hair = female ? pickA(['grey', 'bun', 'bob']) : pickA(['grey', 'bald', 'balding']);
      if (o.hair === 'grey') o.hairCol = 0xc8c4bc; o.stoop = true; o.glasses = chance(0.45); o.item = chance(0.4) ? 'cane' : null; o.bag = chance(0.3) ? 'tote' : null; o.stride = rr(0.6, 0.72); o.cadence = rr(0.8, 0.9); o.tempo = 0.8; o.arm = 0.5; o.speedK = 0.72; o.hf *= 0.95; o.bw *= 1.02; break;
    }
    case 'shorts':
      o.top = { kind: pickA(['tee', 'tank', 'polo']), col: pickA(PAL.tee), pat: 'weave' }; o.sleeve = o.top.kind === 'tank' ? 'none' : 'short'; o.bottom = { kind: 'shorts', col: pickA([0x3a5278, 0xb8a888, 0x1b1b1f, 0x536a8c, 0x7a8a6a, 0xd8d0b8]), pat: pickA(['denim', 'weave', 'weave']) };
      o.shoes = { kind: pickA(['flip', 'sandal', 'sneaker']), col: pickA(PAL.shoe), sole: 0xe8e8e8 }; o.hair = hairFor(); o.glasses = chance(0.2); o.sunglasses = chance(0.2); o.phone = chance(0.35) ? 2 : 0; o.bag = chance(0.2) ? 'pack' : null; if (female) o.top.kind = pickA(['tee', 'tank']); break;
    case 'kurta': {
      o.female = false; const kc = pickA([0xf2eee0, 0x3a5a8a, 0x8a3a3a, 0xc8a050, 0x2f5a4a, 0xe8d8c0]);
      o.top = { kind: 'kurta', col: kc, pat: chance(0.3) ? 'paisley' : 'weave' }; o.sleeve = 'long'; o.bottom = { kind: 'slacks', col: chance(0.6) ? 0xf0ece0 : 0x2a2a30, pat: 'weave' }; o.shoes = { kind: pickA(['sandal', 'leather', 'flip']), col: 0x3a2a1e, sole: 0x222222 }; o.hair = chance(0.12) ? 'turban' : pickA(['short', 'side', 'crop']);
      if (o.hair === 'turban') { o.hat = { kind: 'turban', col: pickA([0xe8e8f0, 0x1c3a6c, 0xd86a1c, 0x8a1f2d]) }; o.beard = true; } else o.beard = chance(0.3); o.stride = rr(0.8, 0.95); o.phone = chance(0.25) ? 1 : 0; break;
    }
    case 'sari': {
      o.female = true; const sc = pickA([0xc83a6a, 0x2a6ac8, 0xe8a020, 0x2a8a5a, 0x7a2a8a, 0xc82a2a, 0xe86a2a]);
      o.top = { kind: 'sari', col: sc, col2: pickA([0xf0e0b0, 0x2a2a30, sc]), pat: pickA(['paisley', 'weave', 'floral']) }; o.sleeve = 'short'; o.bottom = { kind: 'sari', col: sc, pat: o.top.pat }; o.shoes = { kind: pickA(['sandal', 'flip']), col: 0xc8a050, sole: 0x3a2a1e };
      o.hair = pickA(['long', 'bun', 'braids']); o.bag = chance(0.5) ? 'hand' : null; o.stride = rr(0.62, 0.78); o.cadence = rr(0.85, 0.95); break;
    }
    case 'kurung': {
      o.female = true; const kc = pickA([0x3a8a8a, 0xb04a6a, 0x7a5aa8, 0x2a6a4a, 0xd8a070, 0x4a6ab0, 0xc8607a, 0x8a3a3a]);
      o.top = { kind: 'kurung', col: kc, pat: pickA(['batik', 'floral', 'weave', 'paisley']) }; o.sleeve = 'long'; o.bottom = { kind: 'kurung', col: kc, pat: o.top.pat }; o.shoes = { kind: pickA(['sandal', 'flip', 'sneaker']), col: pickA([0x3a2a1e, 0xe8e8e8]), sole: 0xdddddd };
      o.hair = chance(0.8) ? 'tudung' : hairFor(); o.hat = o.hair === 'tudung' ? { kind: 'tudung', col: pickA([0xf0f0f0, 0x2a2a30, kc, 0xd8c0a0, 0x6a8ab0, 0xb04a6a]) } : null; o.bag = pickA(['hand', 'shoulder']); o.stride = rr(0.65, 0.8); o.phone = chance(0.3) ? 2 : 0; break;
    }
    case 'batik':
      o.female = false; o.top = { kind: 'shirt', col: pickA([0x8a5a2a, 0x2a5a7a, 0x6a3a1c, 0x3a6a5a]), pat: 'batik' }; o.sleeve = pickA(['short', 'long']); o.bottom = { kind: 'slacks', col: pickA(PAL.slacks), pat: 'weave' }; o.shoes = { kind: 'leather', col: 0x2a1c12, sole: 0x111111 }; o.hair = pickA(['short', 'side', 'grey', 'balding']); if (o.hair === 'grey') o.hairCol = 0xc8c4bc;
      o.glasses = chance(0.3); o.phone = chance(0.2) ? 1 : 0; break;
    default: { // casual
      const kind = female ? pickA(['tee', 'tee', 'tank', 'sweater', 'blouse']) : pickA(['tee', 'tee', 'polo', 'shirt', 'sweater', 'tank']);
      o.top = { kind, col: pickA(PAL.tee), pat: kind === 'sweater' ? 'knit' : pickA(['weave', 'weave', 'stripes', 'gingham']) }; o.sleeve = kind === 'sweater' || kind === 'shirt' ? pickA(['long', 'three']) : kind === 'tank' ? 'none' : 'short';
      o.bottom = { kind: female ? pickA(['jeans', 'jeans', 'skirt', 'shorts', 'leggings']) : pickA(['jeans', 'jeans', 'slacks', 'cargo']), col: pickA(PAL.jeans), pat: 'denim' }; if (o.bottom.kind === 'skirt') { o.bottom.col = pickA(PAL.bright.concat(PAL.slacks)); o.bottom.pat = 'weave'; } if (o.bottom.kind === 'cargo' || o.bottom.kind === 'slacks') { o.bottom.col = pickA([0x7a8a6a, 0x5b564c, 0x3a3f4a, 0xb8a888]); o.bottom.pat = 'weave'; }
      if (o.bottom.kind === 'leggings') { o.bottom.col = pickA([0x1b1b1f, 0x2b3045]); o.bottom.pat = 'weave'; }
      o.shoes = { kind: shoeSet(), col: pickA(PAL.shoe), sole: 0xeeeeee }; o.hair = hairFor(); o.bag = chance(0.4) ? pickA(['shoulder', 'tote', 'pack', 'hand']) : null; o.glasses = chance(0.22); o.beard = !female && chance(0.15); o.phone = chance(0.4) ? (chance(0.5) ? 1 : 2) : 0; o.headphones = chance(0.12); o.item = chance(0.15) ? 'cup' : null;
    }
  }
  if (o.top.kind === 'blouse' || o.top.kind === 'dress' || o.top.kind === 'sari' || o.top.kind === 'kurung') o.female = true;
  if (o.female && (o.bottom.kind === 'cargo')) o.bottom.kind = 'jeans';
  if (o.female && o.hair === 'buzz') o.hair = 'bob';
  if (o.female !== female) { o.hf = o.female ? rr(0.93, 1.0) : rr(0.97, 1.06); }
  if (o.eth === 'black' && o.hair === 'short' && chance(0.4)) o.hair = 'buzz';
  if (o.female && (o.hair === 'balding' || o.hair === 'bald' || o.hair === 'slick' || o.hair === 'crop')) o.hair = 'bob';
  if (o.hair === 'tudung' || o.hair === 'turban') { /* covered */ }
  return o;
}

// ================================================================== parts builder
function buildParts(o, d, low, kind) {
  const P = []; // { bone, geo, color, pos, scale, rot, pat, skin }
  const S = low ? 6 : 8;
  const add = (bone, geo, color, pos, scale, rot, ex) => { P.push({ bone, geo, color, pos, scale, rot, ...ex }); };
  const female = o.female, bw = o.bw, sk = o.skin;
  const top = o.top, bt = o.bottom, tk = top.kind, bk = bt.kind;
  const topCol = top.col, topPat = top.pat || 'weave';
  const hr = d.headR, y0 = hr * 1.0;
  const sx = (female ? 1.06 : 1.2) * bw, sz = (female ? 0.72 : 0.78) * (0.94 + 0.06 * bw);
  const long = o.sleeve === 'long', three = o.sleeve === 'three', shortS = o.sleeve === 'short', none = o.sleeve === 'none';
  const dress = tk === 'dress' || tk === 'sari' || tk === 'kurung';
  const bulk = tk === 'jacket' || tk === 'suit' || tk === 'hoodie' || tk === 'sweater' || tk === 'hivis' ? 1.07 : tk === 'tank' || tk === 'sport' ? 0.97 : 1.0;

  // ---------------------------------------------------------------- torso (chest joint space)
  const prof = (female
    ? [[-0.2, 0.0001], [-0.19, 0.12], [-0.12, 0.134], [-0.04, 0.108], [0.04, 0.098], [0.12, 0.118], [0.19, 0.14], [0.27, 0.15], [0.32, 0.12], [0.36, 0.07], [0.395, 0.0001]]
    : [[-0.2, 0.0001], [-0.19, 0.118], [-0.1, 0.122], [0.0, 0.124], [0.1, 0.14], [0.2, 0.163], [0.28, 0.168], [0.33, 0.13], [0.365, 0.075], [0.395, 0.0001]]);
  const torsoGeo = profileGeo(`ptorso2_${female ? 'f' : 'm'}_${S}`, prof, S + 4, 12);
  const torsoSkin = tk === 'tank' || tk === 'sport' || tk === 'dress' || tk === 'blouse' || tk === 'sari';
  add(J.CH, torsoGeo, topCol, null, [sx * bulk, 1, sz * bulk], null, { pat: topPat });
  if (tk === 'sari') { // bare midriff
    add(J.CH, cyl(S + 4), sk, [0, -0.115, 0], [0.114 * sx * 1.0, 0.1, 0.114 * sz]);
  }
  if (female) for (const s of [1, -1]) add(J.CH, sph(7, 5), topCol, [s * 0.05 * bw, 0.165, 0.075 * sz * 1.18], [0.055, 0.05, 0.045], null, { pat: topPat });
  if (torsoSkin || tk === 'blouse') { // neckline / bare shoulders
    const deep = tk === 'dress' || tk === 'blouse' || tk === 'sari' ? 1 : 0.7;
    add(J.CH, sph(7, 5), sk, [0, 0.335, 0.045 * sz], [0.098 * sx * (tk === 'tank' || tk === 'sport' ? 1.0 : 0.78), 0.066 * deep + 0.02, 0.07 * sz]);
  }
  // neck
  add(J.CH, cyl(7), sk, [0, 0.39, 0], [0.046, 0.075, 0.046]);
  // ---- helpers that keep detail pieces on the (curved) chest surface
  const rAt = (y) => { for (let i = 0; i < prof.length - 1; i++) { const [y0_, r0_] = prof[i], [y1_, r1_] = prof[i + 1]; if (y >= y0_ && y <= y1_) return lerp(r0_, r1_, (y - y0_) / (y1_ - y0_)); } return 0.05; };
  const zS = (x, y) => sz * bulk * Math.sqrt(Math.max(0, rAt(y) ** 2 - (x / (sx * bulk)) ** 2));
  /** a vertical strip hugging the chest at lateral offset x from y0 up to y1 */
  const strip = (x, y0, y1, w, col, depth = 0.01, ex) => {
    const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.055));
    for (let i = 0; i < n; i++) {
      const ya = y0 + ((y1 - y0) * i) / n, yb = y0 + ((y1 - y0) * (i + 1)) / n, za = zS(x, ya), zb = zS(x, yb), len = Math.hypot(yb - ya, zb - za);
      add(J.CH, bx(), col, [x, (ya + yb) / 2, (za + zb) / 2 + depth * 0.5 + 0.002], [w, len + 0.004, depth], [Math.atan2(zb - za, yb - ya), 0, 0], ex);
    }
  };
  const collar = (col, pat, h = 0.03) => add(J.CH, tube(0.058, 0.07, h, S + 2), col, [0, 0.352, -0.004], [1.15, 1, 0.95], null, { pat });
  const belt = (col) => { add(J.CH, cyl(S + 4), col, [0, -0.114, 0], [0.136 * sx * bulk * (female ? 0.92 : 1), 0.026, 0.136 * sz * bulk * 1.05]); add(J.CH, bx(), 0xc8b070, [0, -0.114, 0.136 * sz * bulk * 1.05], [0.034, 0.022, 0.012]); };
  const hem = (col, y = -0.17, h = 0.05) => add(J.CH, cyl(S + 4), col, [0, y, 0], [0.12 * sx * bulk, h, 0.12 * sz * bulk], null, { pat: 'rib' });
  switch (tk) {
    case 'tee': if (chance(0.3) && !low) add(J.CH, bx(), pickA(PAL.bright), [0, 0.17, zS(0, 0.17) + 0.006], [0.12, 0.07, 0.01]); break;
    case 'polo': case 'shirt': case 'blouse':
      collar(topCol, topPat, 0.034);
      if (tk !== 'blouse') strip(0, 0.32, -0.08, 0.018, topCol, 0.006, { gain: 1.3, pat: topPat });
      if (top.tie) strip(0, 0.33, 0.0, 0.034, top.tie, 0.012);
      if (tk === 'shirt' && !female && chance(0.5)) add(J.CH, bx(), topCol, [0.075 * sx, 0.18, zS(0.075 * sx, 0.18) + 0.005], [0.05, 0.055, 0.01], null, { pat: topPat, gain: 0.92 });
      break;
    case 'suit': {
      strip(0, 0.33, 0.04, 0.07, top.col2 ?? 0xf2f2f2, 0.008);
      strip(0, 0.32, -0.04, 0.032, top.tie ?? 0xa01820, 0.014);
      for (const sg of [1, -1]) strip(sg * 0.05, 0.34, -0.02, 0.04, topCol, 0.016, { gain: 1.25 });
      for (const yy of [0.06, -0.02]) add(J.CH, sph(5, 4), 0x111114, [0.0, yy, zS(0, yy) + 0.02], 0.011);
      add(J.CH, bx(), 0xf2f2f2, [0.085 * sx, 0.185, zS(0.085 * sx, 0.185) + 0.01], [0.04, 0.018, 0.012]);
      belt(0x15151a); break;
    }
    case 'hoodie':
      add(J.CH, sph(7, 5), topCol, [0, 0.385, -0.065], [0.1, 0.055, 0.075], null, { pat: topPat });
      add(J.CH, bx(), topCol, [0, -0.04, zS(0, -0.04) + 0.012], [0.2 * bw, 0.1, 0.025], null, { pat: topPat, gain: 0.88 });
      for (const sg of [1, -1]) strip(sg * 0.028, 0.3, 0.12, 0.009, 0xe8e8e8, 0.008);
      break;
    case 'jacket': case 'hivis':
      strip(0, 0.34, -0.12, 0.07 * bw, top.col2 ?? 0x2a2a30, 0.012, { gain: tk === 'hivis' ? 0.9 : 1 });
      strip(0, 0.34, -0.12, 0.01, 0x15151a, 0.018);
      add(J.CH, cyl(S + 2), topCol, [0, 0.362, 0], [0.078, 0.05, 0.07], null, { pat: topPat, gain: 1.05 });
      for (const sg of [1, -1]) add(J.CH, bx(), topCol, [sg * 0.09 * sx, -0.03, zS(sg * 0.09 * sx, -0.03) + 0.008], [0.05, 0.012, 0.02], [0, 0, sg * 0.3]);
      if (tk === 'hivis') for (const yy of [0.1, 0.24]) add(J.CH, cyl(S + 4), 0xdfe3e8, [0, yy, 0], [(rAt(yy) + 0.006) * sx * bulk, 0.024, (rAt(yy) + 0.006) * sz * bulk]);
      break;
    case 'sweater': add(J.CH, tube(0.058, 0.07, 0.04, S + 2), topCol, [0, 0.352, 0], [1.15, 1, 0.95], null, { pat: 'rib' }); break;
    case 'sport': add(J.CH, bx(), 0xf0f0f0, [0.06, 0.15, zS(0.06, 0.15) + 0.005], [0.04, 0.04, 0.008]); break;
    case 'kurta': {
      add(J.H, skirtGeo(0.132, 0.2, 0.74, S + 4), topCol, [0, 0.13 - 0.37, 0], [1.2 * bw, 1, 0.84], null, { pat: top.pat, skin: legSkin(0.3, 0.74) });
      strip(0, 0.33, -0.1, 0.014, 0xe8d8a0, 0.01); add(J.CH, tube(0.052, 0.062, 0.034, S + 2), topCol, [0, 0.352, 0], [1.1, 1, 0.95]); break;
    }
    case 'kurung': {
      add(J.H, skirtGeo(0.132, 0.26, 0.94, S + 4), topCol, [0, 0.13 - 0.47, 0], [1.08 * bw, 1, 0.9], null, { pat: top.pat, skin: legSkin(0.3, 0.94), gain: 0.95 });
      add(J.CH, tube(0.052, 0.062, 0.034, S + 2), topCol, [0, 0.352, 0], [1.1, 1, 0.95]); break;
    }
    case 'sari': {
      add(J.CH, bx(), topCol, [0.0, 0.12, zS(0, 0.12) + 0.012], [0.1 * bw, 0.46, 0.03], [0.0, 0, -0.55], { pat: top.pat });
      add(J.CH, bx(), topCol, [0.05, 0.08, -zS(0, 0.1) - 0.012], [0.16, 0.5, 0.03], [0, 0, 0.15], { pat: top.pat });
      add(J.H, skirtGeo(0.132, 0.27, 0.98, S + 4), topCol, [0, 0.13 - 0.49, 0], [1.08 * bw, 1, 0.9], null, { pat: top.pat, skin: legSkin(0.3, 0.98) });
      add(J.H, cyl(S + 4), 0xe8c060, [0, 0.0, 0], [0.152 * bw, 0.016, 0.125]); break;
    }
    case 'dress': {
      const hemLen = female ? rr(0.34, 0.5) : 0.4, tl = hemLen + 0.18;
      add(J.H, skirtGeo(0.132, 0.17 + hemLen * 0.5, tl, S + 4), topCol, [0, 0.13 - tl / 2, 0], [1.08 * bw, 1, 0.84], null, { pat: topPat, skin: legSkin(0.25, tl) });
      add(J.CH, cyl(S + 4), 0x2a2a30, [0, -0.1, 0], [(rAt(-0.1) + 0.004) * sx, 0.016, (rAt(-0.1) + 0.004) * sz]); break;
    }
    default: break;
  }
  // belts for trousered outfits (not for dresses / jackets that hide it)
  if (o.belt && (bk === 'jeans' || bk === 'slacks' || bk === 'cargo') && (tk === 'tee' || tk === 'polo' || tk === 'shirt' || tk === 'sweater') && !(female && tk === 'blouse')) belt(bk === 'jeans' ? 0x3a2a1e : 0x15151a);
  if (kind === 'cop') {
    add(J.CH, bx(), 0xd8b84a, [0.075, 0.24, 0.12 * sz * 1.16], [0.034, 0.042, 0.012]);
    add(J.CH, bx(), 0x222428, [-0.115 * sx, 0.33, 0.0], [0.04, 0.05, 0.04]);
    add(J.CH, bx(), 0x0e0e12, [0, 0.2, 0.128 * sz], [0.026, 0.2, 0.012]);
    add(J.CH, cyl(S + 4), 0x0c0c10, [0, -0.115, 0], [0.132 * sx, 0.04, 0.132 * sz]);
    add(J.CH, bx(), 0xc0c0c8, [0, -0.115, 0.134 * sz], [0.04, 0.03, 0.012]);
    add(J.CH, bx(), 0x1a1a1e, [0.1 * sx, -0.12, 0.08], [0.05, 0.06, 0.05]);
    for (const sg of [1, -1]) add(J.CH, bx(), shirt2(), [sg * 0.065, 0.2, 0.128 * sz], [0.06, 0.06, 0.01]);
  }
  // bags on the torso
  const bagCol = o.bagCol ?? pickA(PAL.bag);
  if (o.bag === 'pack') add(J.CH, bx(), o.packCol ?? bagCol, [0, 0.15, -0.15], [0.23 * bw, 0.3, 0.12], null, { pat: 'weave' }), add(J.CH, bx(), 0x15151a, [0, 0.07, -0.222], [0.19 * bw, 0.1, 0.02]);
  if (o.bag === 'pack') for (const s of [1, -1]) strip(s * 0.07 * bw, 0.31, -0.05, 0.036, 0x15151a, 0.012);
  if (o.bag === 'shoulder') { // crossbody strap + bag at the right hip
    add(J.CH, bx(), bagCol, [0.0, 0.14, 0.0], [0.03, 0.55, 0.3 * 0.5], [0.0, 0, 0.62], { pat: 'leather' });
    add(J.CH, bx(), bagCol, [-0.2 * bw, -0.06, 0.02], [0.07, 0.14, 0.19], null, { pat: 'leather' });
  }
  if (o.bag === 'tote') { add(J.CH, bx(), bagCol, [-0.19 * bw, 0.31, 0.0], [0.03, 0.025, 0.2]); add(J.CH, bx(), pickA(PAL.pastel), [-0.21 * bw, -0.02, 0.0], [0.045, 0.22, 0.25], null, { pat: 'weave' }); }
  if (o.item === 'box') add(J.CH, bx(), o.itemCol, [0, 0.2, -0.2], [0.34, 0.34, 0.3], null, { pat: 'plain' }), add(J.CH, bx(), 0x1a1a1a, [0, 0.2, -0.352], [0.2, 0.1, 0.01]);
  if (o.item === 'camera') add(J.CH, bx(), 0x151518, [0.05, 0.06, 0.13], [0.09, 0.065, 0.05]), add(J.CH, cyl(6), 0x30303a, [0.05, 0.06, 0.17], [0.02, 0.02, 0.02], [Math.PI / 2, 0, 0]);
  if (tk === 'sport' && !low) add(J.CH, bx(), 0x15151a, [-0.14 * sx, 0.08, 0.06], [0.04, 0.09, 0.06]); // arm phone band

  // ---------------------------------------------------------------- pelvis / waist (tubes start slightly proud of the torso so the seam is a crisp lip)
  const wx = (female ? 1.1 : 1.2) * bw, wzs = female ? 0.8 : 0.82;
  const pelvCol = bk === 'skirt' ? bt.col : (dress || tk === 'kurta') ? topCol : bt.col;
  const trousers = bk === 'jeans' || bk === 'slacks' || bk === 'cargo' || bk === 'trackpants' || bk === 'leggings' || bk === 'shorts';
  const tailTop = tk === 'jacket' || tk === 'suit' || tk === 'hoodie' || tk === 'sweater' || tk === 'hivis';
  // crotch / hip mass
  add(J.H, sph(S + 2, S - 1), pelvCol, [0, -0.06, 0], [(female ? 0.15 : 0.14) * bw, 0.075, (female ? 0.115 : 0.108) * (0.95 + 0.05 * bw)], null, { pat: bt.pat });
  if (tailTop) add(J.H, skirtGeo(0.134 * bulk, 0.158 * bulk, 0.2, S + 4), topCol, [0, 0.13 - 0.1, 0], [wx * 1.03, 1, wzs * 1.05], null, { pat: topPat });
  else if (trousers) add(J.H, skirtGeo(0.132, 0.147, 0.22, S + 4), bt.col, [0, 0.13 - 0.11, 0], [wx, 1, wzs], null, { pat: bt.pat });
  else if (tk === 'blouse' && bk !== 'skirt' && chance(0.5)) add(J.H, skirtGeo(0.134, 0.146, 0.2, S + 4), topCol, [0, 0.13 - 0.1, 0], [wx, 1, wzs], null, { pat: topPat });
  if (bk === 'skirt') {
    const len = o.top.kind === 'suit' || o.name === 'office' ? 0.34 : rr(0.26, 0.4), tl = len + 0.18;
    add(J.H, skirtGeo(0.132, 0.19 + len * 0.3, tl, S + 4), bt.col, [0, 0.13 - tl / 2, 0], [1.08 * bw, 1, 0.85], null, { pat: bt.pat, skin: legSkin(0.25, tl) });
  }
  if (kind === 'cop') add(J.H, bx(), 0x101014, [-0.17, -0.03, 0.0], [0.045, 0.12, 0.07]);

  // ---------------------------------------------------------------- arms
  const ua = d.upper, fa = d.fore;
  const u0 = (female ? 0.041 : 0.05) * Math.min(bw, 1.1), u1 = u0 * 0.82, f1 = u0 * 0.68;
  const aBulk = bulk > 1.03 ? 1.1 : 1;
    for (const bone of [J.AL, J.AR]) {
    const lim = limbGeo(ua, u0, u1, 0.06, 0.3, S);
    if (long || three) add(bone, lim, topCol, null, [aBulk, 1, aBulk], null, { pat: topPat });
    else add(bone, lim, sk);
    if (shortS) add(bone, tube(u0 * 1.18 * aBulk, lerp(u0, u1, 0.55) * 1.16 * aBulk, ua * 0.55, S), topCol, [0, -ua * 0.275, 0], null, null, { pat: topPat });
    add(bone, sph(6, 5), none ? sk : topCol, null, u0 * 1.12 * aBulk, null, { pat: topPat });
  }
  for (const bone of [J.EL, J.ER]) {
    const lim = limbGeo(fa, u1 * 0.95, f1, 0.06, 0.3, S);
    if (long) add(bone, lim, topCol, null, [aBulk, 1, aBulk], null, { pat: topPat });
    else add(bone, lim, sk);
    if (three) add(bone, tube(u1 * 0.98 * 1.05, lerp(u1, f1, 0.4) * 1.05, fa * 0.4, S), topCol, [0, -fa * 0.2, 0], null, null, { pat: topPat });
    if (long && tk !== 'suit') add(bone, cyl(S), tk === 'hoodie' || tk === 'jacket' || tk === 'sweater' ? pickCuff(topCol) : topCol, [0, -fa * 0.93, 0], [f1 * 1.1 * aBulk, 0.026, f1 * 1.1 * aBulk], null, { pat: tk === 'hoodie' || tk === 'sweater' ? 'rib' : topPat });
    if (long && tk === 'suit') add(bone, cyl(S), 0xf2f2f2, [0, -fa * 0.96, 0], [f1 * 1.12, 0.02, f1 * 1.12]);
    // hand
    const handY = -fa - d.hand * 0.4;
    add(bone, sph(7, 5), sk, [0, handY, 0.005], [0.036, 0.05, 0.04]);
    add(bone, sph(5, 4), sk, [bone === J.EL ? -0.026 : 0.026, handY + 0.022, 0.02], [0.014, 0.03, 0.014], [0.3, 0, 0]);
    if (!low) add(bone, cyl(6), 0x2b2b30, [0, -fa * 0.97, 0], [f1 * 1.12, 0.014, f1 * 1.12]); // watch / bracelet band
  }
  // right hand holds things (ER); left stays free (EL) unless a phone is used
  const handYR = -fa - d.hand * 0.4;
  if (o.item === 'case') { add(J.ER, bx(), 0x4a3322, [0, handYR - 0.17, 0.0], [0.045, 0.24, 0.32], null, { pat: 'leather' }); add(J.ER, bx(), 0x2a1c12, [0, handYR - 0.04, 0.0], [0.02, 0.012, 0.1]); }
  if (o.item === 'cup') { add(J.ER, cyl(8), 0xf2f2f2, [0, handYR - 0.01, 0.045], [0.032, 0.09, 0.032]); add(J.ER, cyl(8), 0x4a3322, [0, handYR + 0.05, 0.045], [0.035, 0.015, 0.035]); }
  if (o.item === 'cane') { add(J.ER, cyl(5), 0x3a2a1e, [0, handYR - 0.4, 0.02], [0.012, 0.84, 0.012]); add(J.ER, cyl(5), 0x3a2a1e, [0, handYR + 0.02, 0.02], [0.013, 0.07, 0.013], [Math.PI / 2, 0, 0]); }
  if (o.bag === 'hand') { add(J.EL, bx(), bagCol, [0, -fa - 0.17, 0.0], [0.09, 0.16, 0.22], null, { pat: 'leather' }); add(J.EL, bx(), bagCol, [0, -fa - 0.05, 0], [0.012, 0.1, 0.02]); }
  if (o.bag === 'tote' && false) { /* shoulder tote handled above */ }
  if (o.phone) {
    // phone in the right hand (call: raised to the ear by the hook; text: held up in front)
    add(J.ER, bx(), 0x15151a, [0.0, handYR - 0.01, 0.03], [0.036, 0.12, 0.012], [0.2, 0, 0]);
    add(J.ER, bx(), 0x4a7aa0, [0.0, handYR - 0.01, 0.037], [0.03, 0.1, 0.002], [0.2, 0, 0], { gain: 1.2 });
  }
  if (kind === 'cop') { /* pistol parented to handR by buildCop */ }

  // ---------------------------------------------------------------- legs
  const th = d.thigh, sh = d.shin;
  const t0 = (female ? 0.07 : 0.082) * Math.min(bw, 1.12), t1 = t0 * 0.7, s0 = t1 * 0.95, s1 = s0 * 0.7;
  const full = bk === 'jeans' || bk === 'slacks' || bk === 'cargo' || bk === 'trackpants' || bk === 'leggings' || bk === 'sari' && false;
  const leggings = bk === 'leggings';
  const lk = leggings ? 0.96 : bk === 'trackpants' ? 1.05 : bk === 'cargo' ? 1.1 : bk === 'slacks' ? 1.02 : 1.0;
  for (const [tb, kb, fb] of [[J.TL, J.KL, J.FL], [J.TR, J.KR, J.FR]]) {
    const thLimb = limbGeo(th, t0, t1, 0.05, 0.3, S), shLimb = limbGeo(sh, s0, s1, 0.05, 0.25, S);
    if (full) { add(tb, thLimb, bt.col, null, [lk, 1, lk], null, { pat: bt.pat }); add(kb, shLimb, bt.col, null, [lk, 1, lk], null, { pat: bt.pat }); add(kb, sph(6, 5), bt.col, null, s0 * 0.97 * lk, null, { pat: bt.pat }); }
    else {
      add(tb, thLimb, sk); add(kb, shLimb, sk); add(kb, sph(6, 5), sk, null, s0 * 0.96);
      if (bk === 'shorts') {
        const cov = o.name === 'tourist' || bt.kind === 'shorts' && chance(0.4) ? 0.78 : 0.55;
        add(tb, tube(t0 * 1.07, lerp(t0, t1, cov) * 1.13, th * cov, S), bt.col, [0, -th * cov * 0.5, 0], null, null, { pat: bt.pat });
      }
    }
    if (bk === 'jeans' && !low && chance(0.35)) add(kb, cyl(S), bt.col, [0, -sh * 0.9, 0], [s1 * 1.14 * lk, 0.05, s1 * 1.14 * lk], null, { pat: 'denim', gain: 1.15 }); // rolled cuff
    // feet
    addShoe(add, fb, kb, o, d, sk, S, bk, low);
  }
  return P;
}
const shirt2 = () => 0x0f1b38;
const pickCuff = (c) => { _col.set(c); _col.multiplyScalar(0.8); return _col.getHex(); };

// two-bone skin weights for skirts / long tunics: lower part follows the nearer thigh
function legSkin(fromY, len) {
  return (x, y) => {
    // y is in hips space here (geometry already offset by pos), measure drop below the hip
    const drop = -y - fromY * 0.0;
    const t = clamp((drop - 0.02) / Math.max(0.25, len), 0, 1);
    const side = clamp(x / 0.075, -1, 1);
    const w = t * t * 0.9 * Math.abs(side);
    return [J.H, 1 - w, side > 0 ? J.TL : J.TR, w];
  };
}

function addShoe(add, fb, kb, o, d, sk, S, bk, low) {
  const sh = o.shoes, fy = -d.footH * 0.5 + 0.015;
  const sneaker = sh.kind === 'sneaker', leather = sh.kind === 'leather' || sh.kind === 'heel', boot = sh.kind === 'boot';
  const bare = sh.kind === 'sandal' || sh.kind === 'flip';
  if (bare) {
    add(fb, sph(7, 5), sk, [0, fy + 0.005, 0.045], [0.044, 0.04, 0.115]);
    add(fb, bx(), sh.col, [0, -d.footH + 0.01, 0.045], [0.09, 0.016, 0.22]);
    add(fb, bx(), sh.col, [0, fy + 0.03, 0.075], [0.092, 0.012, 0.03], [0.2, 0, 0]);
    if (sh.kind === 'sandal') add(fb, bx(), sh.col, [0, fy + 0.03, -0.03], [0.07, 0.012, 0.02]);
    return;
  }
  const col = sh.col;
  add(fb, sph(7, 5), col, [0, fy, 0.045], [0.052, 0.05, 0.12], null, { pat: leather ? 'leather' : 'plain', gain: 1 });
  add(fb, bx(), sh.sole ?? 0xf0f0f0, [0, -d.footH + 0.012, 0.045], [0.092, 0.017, 0.212], null, { pat: 'plain' });
  if (sh.kind === 'heel') add(fb, bx(), col, [0, -d.footH + 0.025, -0.045], [0.04, 0.05, 0.04]);
  if (sneaker && !low) add(fb, bx(), 0xffffff, [0, fy + 0.02, 0.09], [0.07, 0.03, 0.06], [0.3, 0, 0]);
  if (boot) add(fb, tube(0.052, 0.058, 0.11, S), col, [0, 0.0, 0.0], null, null, { pat: 'leather' });
  if (!boot && (sneaker || leather)) add(fb, tube(0.046, 0.05, 0.035, S), bk === 'shorts' || bk === 'skirt' || bk === 'dress' ? 0xf4f4f4 : col, [0, -0.005, 0]);
}

// ---------------------------------------------------------------- head, face, hair
function buildHead(o, d, low, kind, parts) {
  const P = parts;
  const add = (geo, color, pos, scale, rot, ex) => P.push({ bone: J.HD, geo, color, pos, scale, rot, ...ex });
  const hr = d.headR, y0 = hr * 1.0, sk = o.skin, S = low ? 8 : 12;
  const female = o.female;
  const jaw = female ? 0.9 : 1.0;
  add(sph(S, low ? 6 : 9), sk, [0, y0, 0], [hr * 0.92, hr * 1.06, hr * 0.99]);
  add(sph(S - 2, 6), sk, [0, y0 - hr * 0.46, hr * 0.1], [hr * 0.66 * jaw, hr * 0.56, hr * 0.74 * jaw]); // jaw / chin
  if (!low) {
    // eyes: sclera + iris
    const iris = o.eth === 'chinese' || o.eth === 'malay' || o.eth === 'indian' || o.eth === 'black' || o.eth === 'latino' ? 0x1a100a : pickA([0x2a4a6a, 0x3a2a1a, 0x4a6a4a, 0x1a100a]);
    for (const s of [1, -1]) {
      add(sph(6, 4), 0xf4f0ea, [s * hr * 0.37, y0 + hr * 0.08, hr * 0.84], [hr * 0.15, hr * (o.eth === 'chinese' ? 0.075 : 0.09), hr * 0.08]);
      add(sph(5, 4), iris, [s * hr * 0.37, y0 + hr * 0.08, hr * 0.9], [hr * 0.075, hr * 0.075, hr * 0.04]);
      add(bx(), o.hairCol, [s * hr * 0.37, y0 + hr * 0.27, hr * 0.86], [hr * 0.3, hr * 0.045, hr * 0.06], [0.0, 0, -s * 0.12]);
      add(sph(5, 4), sk, [s * hr * 0.9, y0 - hr * 0.05, -hr * 0.05], [hr * 0.09, hr * 0.2, hr * 0.12]);
    }
    add(sph(5, 4), sk, [0, y0 - hr * 0.16, hr * 0.97], [hr * 0.13, hr * 0.17, hr * 0.15]);
    add(bx(), female ? 0xa04a50 : 0x8a4a40, [0, y0 - hr * 0.5, hr * 0.88], [hr * 0.3, hr * 0.05, hr * 0.06]);
    if (o.beard) {
      add(sph(8, 5), o.hairCol, [0, y0 - hr * 0.5, hr * 0.2], [hr * 0.86, hr * 0.62, hr * 0.85], null, { pat: 'hair' });
      add(bx(), o.hairCol, [0, y0 - hr * 0.33, hr * 0.93], [hr * 0.34, hr * 0.06, hr * 0.06]);
    }
    if (o.glasses || o.sunglasses) {
      const gc = o.sunglasses ? 0x0b0b0e : 0x1a1a1e;
      for (const s of [1, -1]) { add(torus(hr * 0.2, hr * 0.022, 8), gc, [s * hr * 0.37, y0 + hr * 0.08, hr * 0.97], [1, 1, 1]); if (o.sunglasses) add(cyl(8), 0x101018, [s * hr * 0.37, y0 + hr * 0.08, hr * 0.96], [hr * 0.2, hr * 0.01, hr * 0.2], [Math.PI / 2, 0, 0]); }
      add(bx(), gc, [0, y0 + hr * 0.1, hr * 0.98], [hr * 0.16, hr * 0.03, hr * 0.03]);
      add(bx(), gc, [hr * 0.92, y0 + hr * 0.1, hr * 0.5], [hr * 0.03, hr * 0.03, hr * 1.0]); add(bx(), gc, [-hr * 0.92, y0 + hr * 0.1, hr * 0.5], [hr * 0.03, hr * 0.03, hr * 1.0]);
    }
    if (o.headphones) { for (const s of [1, -1]) add(sph(6, 5), 0x1c1c20, [s * hr * 0.98, y0 - hr * 0.02, 0], [hr * 0.14, hr * 0.26, hr * 0.26]); add(torus(hr * 0.98, hr * 0.04, 12), 0x1c1c20, [0, y0 + hr * 0.1, 0], [1, 1.05, 1], [0, Math.PI / 2, 0]); }
  }
  // hair / hats
  const hc = o.hairCol, hs = o.hair, domeG = dome(low ? 8 : 12);
  const tilt = [-0.28, 0, 0];
  const cap = (col, lift = 0.1, sc = 1.0, ex) => add(domeG, col, [0, y0 + hr * lift, -hr * 0.04], [hr * 0.99 * sc, hr * 1.1 * sc, hr * 1.06 * sc], tilt, { pat: 'hair', ...ex });
  switch (hs) {
    case 'short': case 'grey': cap(hs === 'grey' ? 0xc8c4bc : hc, 0.12); break;
    case 'crop': cap(hc, 0.16, 1.0); break;
    case 'buzz': cap(hc, 0.1, 0.99, { gain: 0.7 }); break;
    case 'side': cap(hc, 0.1, 1.03); add(sph(7, 5), hc, [hr * 0.25, y0 + hr * 0.72, hr * 0.52], [hr * 0.6, hr * 0.28, hr * 0.38], [0.3, 0, -0.25], { pat: 'hair' }); break;
    case 'slick': cap(hc, 0.12, 1.02); add(sph(7, 5), hc, [0, y0 + hr * 0.95, -hr * 0.1], [hr * 0.7, hr * 0.28, hr * 0.8], null, { pat: 'hair' }); break;
    case 'balding': cap(hc, -0.05, 0.99, { }); add(sph(7, 5), o.skin, [0, y0 + hr * 0.78, hr * 0.38], [hr * 0.7, hr * 0.32, hr * 0.5]); break;
    case 'bald': break;
    case 'curly': cap(hc, 0.08, 1.03); for (let i = 0; i < 9; i++) { const a = i * 0.7, el = 0.5 + (i % 3) * 0.3; add(sph(5, 4), hc, [Math.sin(a) * hr * 0.78 * Math.cos(el * 0.6), y0 + hr * (0.4 + Math.sin(el) * 0.62), Math.cos(a) * hr * 0.78 * Math.cos(el * 0.6) - hr * 0.1], hr * 0.34, null, { pat: 'hair' }); } break;
    case 'afro': add(sph(9, 7), hc, [0, y0 + hr * 0.42, -hr * 0.08], [hr * 1.18, hr * 1.12, hr * 1.2], null, { pat: 'hair' }); break;
    case 'braids': cap(hc, 0.08, 1.02); for (let i = 0; i < 7; i++) { const a = -2.4 + i * 0.8; add(cyl(5), hc, [Math.sin(a) * hr * 0.85, y0 - hr * 0.45, Math.cos(a) * hr * 0.85 - hr * 0.1], [hr * 0.09, hr * 1.5, hr * 0.09], null, { pat: 'hair' }); } break;
    case 'long': case 'wavy': cap(hc, 0.1, 1.03); add(sph(7, 5), hc, [0, y0 - hr * 0.62, -hr * 0.46], [hr * 0.98, hr * 1.7, hr * 0.5], null, { pat: 'hair' }); for (const s of [1, -1]) add(sph(6, 5), hc, [s * hr * 0.86, y0 - hr * 0.3, -hr * 0.1], [hr * 0.18, hr * 0.95, hr * 0.5], null, { pat: 'hair' }); break;
    case 'bob': cap(hc, 0.08, 1.03); add(sph(8, 5), hc, [0, y0 - hr * 0.3, -hr * 0.3], [hr * 1.0, hr * 0.95, hr * 0.85], null, { pat: 'hair' }); for (const s of [1, -1]) add(sph(6, 5), hc, [s * hr * 0.84, y0 - hr * 0.35, hr * 0.05], [hr * 0.2, hr * 0.7, hr * 0.62], null, { pat: 'hair' }); break;
    case 'bun': cap(hc, 0.1, 1.02); add(sph(6, 5), hc, [0, y0 + hr * 0.95, -hr * 0.55], hr * 0.4, null, { pat: 'hair' }); break;
    case 'pony': cap(hc, 0.1, 1.02); add(sph(6, 5), hc, [0, y0 - hr * 0.3, -hr * 0.92], [hr * 0.26, hr * 1.0, hr * 0.26], [0.3, 0, 0], { pat: 'hair' }); add(sph(5, 4), 0x222222, [0, y0 + hr * 0.4, -hr * 0.9], hr * 0.1); break;
    case 'headband': cap(hc, 0.12); add(cyl(10), 0xe8e8ee, [0, y0 + hr * 0.42, 0], [hr * 0.97, hr * 0.12, hr * 1.02]); break;
    case 'hood': add(domeG, o.top.col, [0, y0 + hr * 0.05, -hr * 0.1], [hr * 1.12, hr * 1.18, hr * 1.2], tilt, { pat: 'weave' }); add(sph(6, 5), o.top.col, [0, y0 - hr * 0.2, -hr * 0.65], [hr * 0.95, hr * 0.7, hr * 0.5], null, { pat: 'weave' }); break;
    case 'cap': cap(hc, 0.1); add(domeG, o.hat.col, [0, y0 + hr * 0.3, 0], [hr * 1.03, hr * 0.82, hr * 1.07], null); add(bx(), o.hat.col, [0, y0 + hr * 0.34, hr * 1.1], [hr * 0.9, hr * 0.06, hr * 0.62], [0.12, 0, 0]); break;
    case 'hardhat': add(domeG, o.hat.col, [0, y0 + hr * 0.3, 0], [hr * 1.08, hr * 0.95, hr * 1.12]); add(cyl(low ? 8 : 12), o.hat.col, [0, y0 + hr * 0.3, hr * 0.1], [hr * 1.2, hr * 0.06, hr * 1.3]); break;
    case 'sunhat': cap(hc, 0.1); add(cyl(low ? 8 : 12), o.hat.col, [0, y0 + hr * 0.5, 0], [hr * 1.9, hr * 0.05, hr * 1.9]); add(domeG, o.hat.col, [0, y0 + hr * 0.5, 0], [hr * 1.05, hr * 0.7, hr * 1.05]); break;
    case 'tudung': { // Malay headscarf: crown, cheeks, under the chin, back and a shoulder drape; the face stays open
      const tc = o.hat.col, wv = { pat: 'weave', tile: 0.05 };
      add(domeG, tc, [0, y0 + hr * 0.02, -hr * 0.06], [hr * 1.1, hr * 1.2, hr * 1.14], [-0.35, 0, 0], wv);
      for (const sg of [1, -1]) add(sph(8, 6), tc, [sg * hr * 0.9, y0 - hr * 0.4, -hr * 0.05], [hr * 0.3, hr * 0.85, hr * 0.85], null, wv);
      add(sph(8, 6), tc, [0, y0 - hr * 0.95, hr * 0.0], [hr * 0.92, hr * 0.48, hr * 0.85], null, wv);
      add(sph(8, 6), tc, [0, y0 - hr * 0.7, -hr * 0.55], [hr * 1.05, hr * 1.2, hr * 0.6], null, wv);
      add(sph(8, 6), tc, [0, y0 - hr * 1.55, -hr * 0.1], [hr * 1.35, hr * 0.75, hr * 0.85], null, wv);
      break;
    }
    case 'turban': {
      const tc = o.hat.col;
      add(sph(10, 7), tc, [0, y0 + hr * 0.55, -hr * 0.05], [hr * 1.12, hr * 0.95, hr * 1.18], null, { pat: 'stripes', tile: 0.06 });
      add(torus(hr * 0.92, hr * 0.18, 12), tc, [0, y0 + hr * 0.3, 0], [1.0, 1.1, 1.0], [Math.PI / 2, 0.15, 0], { pat: 'weave' });
      add(sph(8, 6), tc, [0, y0 + hr * 1.1, hr * 0.1], [hr * 0.7, hr * 0.5, hr * 0.8], null, { pat: 'stripes', tile: 0.06 });
      break;
    }
    default: cap(hc, 0.12);
  }
  if (kind === 'cop') {
    // cap with peak and badge
    const cc = o.hatCol ?? 0x16213f;
    add(domeG, cc, [0, y0 + hr * 0.38, 0], [hr * 1.1, hr * 0.78, hr * 1.14], null, { pat: 'weave' }); add(cyl(low ? 8 : 12), cc, [0, y0 + hr * 0.4, hr * 0.05], [hr * 1.14, hr * 0.12, hr * 1.2]);
    add(bx(), 0x0c0c12, [0, y0 + hr * 0.36, hr * 1.1], [hr * 0.9, hr * 0.05, hr * 0.5], [0.12, 0, 0]); add(bx(), 0xd8b84a, [0, y0 + hr * 0.56, hr * 1.07], [hr * 0.22, hr * 0.22, hr * 0.04]);
  }
}

// ================================================================== assemble
const hookFor = (m) => ({
  update: (c) => {
    // phone users raise an arm (call) or both (text) while strolling / standing
    if (!m.phoneMode) return;
    const want = (c.st === 'idle' || (c.st === 'run' && c.sp < 3)) ? 1 : 0;
    m.phoneW += (want - m.phoneW) * Math.min(1, 5 * c.dt);
    const w = m.phoneW; if (w < 0.01) return;
    const j = m.j;
    const ar = j[J.AR].rotation, er = j[J.ER].rotation, al = j[J.AL].rotation, el = j[J.EL].rotation;
    if (m.phoneMode === 1) { // call: right hand to the ear
      ar.set(lerp(ar.x, -1.25, w), lerp(ar.y, 0.25, w), lerp(ar.z, 0.5, w));
      er.x = lerp(er.x, -2.45, w);
      j[J.HD].rotation.z += 0.1 * w;
    } else { // text: phone held in front of the chest, head tilted down
      ar.set(lerp(ar.x, -0.6, w), lerp(ar.y, 0.35, w), lerp(ar.z, 0.05, w)); er.x = lerp(er.x, -1.85, w);
      al.set(lerp(al.x, -0.6, w), lerp(al.y, -0.35, w), lerp(al.z, -0.05, w)); el.x = lerp(el.x, -1.85, w);
      j[J.HD].rotation.x += 0.35 * w;
    }
  },
});

function assemble(id, o, kind, opts) {
  const lod = opts.lod === 'low' ? 'low' : 'high', low = lod === 'low';
  const female = o.female;
  const d = makeDims(1, female
    ? { headR: 0.104, shW: 0.172 * (0.95 + 0.05 * o.bw), hipW: 0.098, thigh: 0.445, shin: 0.425, chest: 0.33, upper: 0.285, fore: 0.255 }
    : { headR: 0.112, shW: 0.2 * (0.92 + 0.08 * o.bw), hipW: 0.1 });
  const rig = buildRig(d, 1.05);
  rig.group.updateMatrixWorld(true);
  const bind = rig.joints.map((j) => j.matrixWorld.clone());
  const inv = bind.map((m) => m.clone().invert());
  const parts = buildParts(o, d, low, kind);
  buildHead(o, d, low, kind, parts);
  const geo = mergeSkinned(parts, bind);
  geo.computeBoundingSphere();
  const model = new ProcModel(id, rig, {
    prof: { stance: 'relaxed', gait: true, cadence: o.cadence, stride: o.stride, armSwing: o.arm, lean: o.lean, bob: o.bob, flipDodge: false, shoot: 'gun', aimStyle: 'gun', tempo: o.tempo, hunch: o.stoop ? 0.15 : 0 },
    hooks: { update: (c) => hook.update(c) },
  });
  const hook = hookFor(model);
  model.phoneMode = o.phone || 0; model.phoneW = 0;
  const mesh = new THREE.SkinnedMesh(geo, pedMat());
  rig.group.add(mesh);
  mesh.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(rig.joints, inv);
  mesh.bind(skel, new THREE.Matrix4());
  mesh.boundingSphere = new THREE.Sphere(new V3(0, rig.height * 0.5, 0), rig.height * 0.75);
  mesh.frustumCulled = true;
  model.reg(mesh, null, { cast: opts.castShadow ?? !low });
  model._matFor = (m) => m; // peds are never tinted (keeps the single shared material)
  model.setVariant = () => {};
  model.lod = lod; model.variant = o.name; model.look = o; model.hf = o.hf; model.mesh = mesh;
  return model;
}

// ================================================================== CIVILIAN
export function buildCivilian(opts = {}) {
  let v = opts.variant;
  if (typeof v === 'number') v = undefined;
  if (v && !CIVILIAN_VARIANTS.includes(v)) v = undefined;
  const o = genOutfit(opts.region || 'nyc', v, opts.female);
  const m = assemble('civilian', o, 'civ', opts);
  return m.snap(), m;
}

// ================================================================== COP
export function buildCop(opts = {}) {
  const region = opts.region || 'nyc';
  const eth = wpick(MIX[region] || MIX.nyc, Math.random());
  const E = ETH[eth];
  const female = chance(0.2);
  const sg = region === 'sg';
  const shirt = sg ? 0x6f95c8 : 0x1b2a4e, pants = sg ? 0x16213f : 0x131c36;
  const o = {
    eth, female, skin: pickA(E.skin), hairCol: pickA(E.hair), bw: rr(0.98, 1.1), hf: female ? 0.97 : rr(1.0, 1.06),
    top: { kind: 'shirt', col: shirt, pat: 'weave', tie: 0 }, sleeve: sg ? 'short' : 'long', bottom: { kind: 'slacks', col: pants, pat: 'weave' }, shoes: { kind: 'leather', col: 0x0e0e10, sole: 0x0a0a0c },
    hair: female ? 'bun' : pickA(['short', 'short', 'crop']), hat: null, bag: null, phone: 0, glasses: chance(0.12), beard: false, belt: false, item: null, name: 'cop', hatCol: sg ? 0x16213f : 0x16213f,
    stride: 0.95, cadence: 1.0, arm: 0.8, lean: 0.8, bob: 1.0, tempo: 1.0,
  };
  const model = assemble('cop', o, 'cop', opts);
  model.prof.stance = 'ready';
  // service pistol in the right hand; +Z of the pistol is the barrel direction (hand frame is aligned in aim/shoot)
  const pg = mergeColored('pistol', [
    { geo: G('pbox', () => new THREE.BoxGeometry(1, 1, 1)), color: 0x1a1a1e, pos: [0, 0.012, 0.085], scale: [0.026, 0.034, 0.17] },
    { geo: G('pbox', () => new THREE.BoxGeometry(1, 1, 1)), color: 0x2a2a30, pos: [0, -0.035, 0.02], scale: [0.026, 0.07, 0.03], rot: [0.25, 0, 0] },
    { geo: G('pcyl8', () => new THREE.CylinderGeometry(1, 1, 1, 8)), color: 0x0c0c0e, pos: [0, 0.014, 0.185], scale: [0.009, 0.05, 0.009], rot: [Math.PI / 2, 0, 0] },
  ]);
  const pm = new THREE.Mesh(pg, gunMat()); pm.castShadow = opts.lod !== 'low'; pm.position.set(0, -0.005, 0.0);
  model.handR.add(pm); model.reg(pm, null, { cast: opts.lod !== 'low' });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.014, 0.215); model.handR.add(muzzle);
  model.muzzle = muzzle; model.pistol = pm;
  return model.snap(), model;
}
