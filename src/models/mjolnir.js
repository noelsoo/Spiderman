// Mjolnir: bevelled dark-steel head with procedural Celtic-knot / rune engraving (normal + roughness + emissive maps),
// spiral leather-wrapped handle, pommel with lug and a wrist strap simulated with verlet physics.
// Local frame: +Y = handle axis (head on top), origin = grip centre, head long axis = X. One shared set of
// geometries/materials/textures; the same mesh is used in Thor's hand and as the thrown projectile.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { quality } from './common.js';

const V3 = THREE.Vector3;

// ------------------------------------------------------------------ procedural textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** grey canvas (white = raised) -> {normal, color, rough, emissive} textures */
function maps(c, ctx, o = {}) {
  const W = c.width, H = c.height, src = ctx.getImageData(0, 0, W, H).data, r = mulberry(o.seed || 7);
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = src[i * 4] / 255;
  const [nc, nx] = canvas(W, H), [cc, cx] = canvas(W, H), [rc, rx] = canvas(W, H), [ec, ex] = canvas(W, H);
  const nd = nx.createImageData(W, H), cd = cx.createImageData(W, H), rd = rx.createImageData(W, H), ed = ex.createImageData(W, H);
  const S = o.strength || 3.2;
  const at = (x, y) => h[((y + H) % H) * W + ((x + W) % W)];
  const streak = new Float32Array(H); for (let y = 0; y < H; y++) streak[y] = (r() - 0.5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4, v = h[i];
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nX = -dx * S * 0.25, nY = dy * S * 0.25, nZ = 1; const l = Math.hypot(nX, nY, nZ); nX /= l; nY /= l; nZ /= l;
    nd.data[p] = (nX * 0.5 + 0.5) * 255; nd.data[p + 1] = (nY * 0.5 + 0.5) * 255; nd.data[p + 2] = (nZ * 0.5 + 0.5) * 255; nd.data[p + 3] = 255;
    // edge-ness from the gradient: polished ridges where the surface is raised or steep
    const edge = Math.min(1, Math.hypot(dx, dy) * 0.5);
    const ridge = Math.max(0, (v - 0.62) * 3);
    const brushed = streak[y] * 0.05 + (r() - 0.5) * 0.05;
    const base = 0.30 + (v - 0.45) * 0.28 + ridge * 0.22 + edge * 0.18 + brushed;
    const cr = Math.min(1, Math.max(0, base)) * 255;
    cd.data[p] = cr * 0.98; cd.data[p + 1] = cr * 1.0; cd.data[p + 2] = cr * 1.06; cd.data[p + 3] = 255;
    // roughness: polished on ridges / worn edges, rougher in the grooves, tiny scratches
    const rough = Math.min(1, Math.max(0.1, 0.36 - ridge * 0.1 - edge * 0.12 + (v < 0.4 ? 0.2 : 0) + (r() < 0.004 ? 0.25 : 0) + brushed * 0.5));
    rd.data[p] = 255; rd.data[p + 1] = rough * 255; rd.data[p + 2] = 255; rd.data[p + 3] = 255;
    const em = o.glowMask ? o.glowMask(v, x, y, W, H) : (v > 0.78 ? 1 : 0);
    ed.data[p] = 70 * em; ed.data[p + 1] = 175 * em; ed.data[p + 2] = 255 * em; ed.data[p + 3] = 255;
  }
  nx.putImageData(nd, 0, 0); cx.putImageData(cd, 0, 0); rx.putImageData(rd, 0, 0); ex.putImageData(ed, 0, 0);
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.shared = true; return t; };
  return { normal: mk(nc, false), color: mk(cc, true), rough: mk(rc, false), emissive: mk(ec, true) };
}

/** interwoven two-strand rope (Celtic braid) along a horizontal band */
function braid(ctx, x0, x1, cy, A, lambda, w) {
  const wave = (ph) => (x) => cy + A * Math.sin(((x - x0) / lambda) * Math.PI * 2 + ph);
  const stroke = (f, a, b) => {
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    const path = () => { ctx.beginPath(); for (let x = a; x <= b; x += 2) { if (x === a) ctx.moveTo(x, f(x)); else ctx.lineTo(x, f(x)); } };
    path(); ctx.strokeStyle = '#303030'; ctx.lineWidth = w + 6; ctx.stroke();
    path(); ctx.strokeStyle = '#b4b4b4'; ctx.lineWidth = w; ctx.stroke();
    path(); ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = w * 0.45; ctx.stroke();
  };
  const f1 = wave(0), f2 = wave(Math.PI);
  stroke(f1, x0, x1); stroke(f2, x0, x1);
  for (let k = 0; x0 + (k * lambda) / 2 <= x1; k++) { // re-draw strand 1 over strand 2 at every other crossing
    const xc = x0 + (k * lambda) / 2;
    if (k % 2 === 0) { ctx.save(); ctx.beginPath(); ctx.rect(xc - w * 0.9, 0, w * 1.8, ctx.canvas.height); ctx.clip(); stroke(f1, x0, x1); ctx.restore(); }
  }
}
/** Elder-Futhark-style rune: stem + a couple of diagonal strokes */
function rune(ctx, x, y, s, r) {
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
  const n = 1 + ((r() * 2.4) | 0);
  for (let i = 0; i < n; i++) {
    const t = -0.7 + (i / Math.max(1, n)) * 1.4 + r() * 0.2, d = r() < 0.5 ? 1 : -1;
    ctx.moveTo(x, y + t * s); ctx.lineTo(x + d * s * 0.7, y + (t + (r() < 0.5 ? -0.6 : 0.6)) * s);
  }
  ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = Math.max(2, s * 0.22); ctx.lineCap = 'round'; ctx.stroke();
}
function frame(ctx, W, H, b) {
  ctx.fillStyle = '#a8a8a8'; ctx.fillRect(0, 0, W, H);          // raised rim
  ctx.fillStyle = '#6a6a6a'; ctx.fillRect(b, b, W - 2 * b, H - 2 * b); // recessed panel
  ctx.strokeStyle = '#c8c8c8'; ctx.lineWidth = Math.max(2, b * 0.16); ctx.strokeRect(b * 1.55, b * 1.55, W - 3.1 * b, H - 3.1 * b);
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const q = quality();
  const S = q === 'low' ? 192 : q === 'medium' ? 320 : 512;
  // ---- long side faces: frame + central braid + rune strips
  const SW = S, SH = Math.round(S * 0.625);
  let [c, x] = canvas(SW, SH); x.fillStyle = '#808080'; x.fillRect(0, 0, SW, SH);
  const b = SH * 0.075; frame(x, SW, SH, b);
  braid(x, b * 2.6, SW - b * 2.6, SH * 0.5, SH * 0.15, (SW - b * 5.2) / 4, SH * 0.075);
  const rr = mulberry(11); x.save();
  for (const yy of [0.2, 0.8]) for (let i = 0; i < 9; i++) rune(x, b * 3 + (i / 8) * (SW - b * 6), SH * yy, SH * 0.055, rr);
  x.restore();
  const side = maps(c, x, { seed: 3 });
  // ---- end faces: ring + quatrefoil knot
  [c, x] = canvas(S, S); x.fillStyle = '#808080'; x.fillRect(0, 0, S, S); frame(x, S, S, S * 0.07);
  x.lineWidth = S * 0.05;
  const ring = (cx0, cy0, r0, w0) => {
    x.beginPath(); x.arc(cx0, cy0, r0, 0, 6.2832); x.strokeStyle = '#303030'; x.lineWidth = w0 + 6; x.stroke();
    x.strokeStyle = '#b4b4b4'; x.lineWidth = w0; x.stroke(); x.strokeStyle = '#f0f0f0'; x.lineWidth = w0 * 0.45; x.stroke();
  };
  ring(S / 2, S / 2, S * 0.34, S * 0.05);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.2832 + 0.785; ring(S / 2 + Math.cos(a) * S * 0.14, S / 2 + Math.sin(a) * S * 0.14, S * 0.14, S * 0.04); }
  const end = maps(c, x, { seed: 5 });
  // ---- top / bottom faces: plain brushed panel with a single rune row
  [c, x] = canvas(SW, SH); x.fillStyle = '#808080'; x.fillRect(0, 0, SW, SH); frame(x, SW, SH, SH * 0.07);
  for (let i = 0; i < 7; i++) rune(x, SW * 0.14 + (i / 6) * SW * 0.72, SH * 0.5, SH * 0.1, rr);
  const top = maps(c, x, { seed: 9 });
  // ---- leather spiral wrap (diagonal bands, tileable)
  const LW = 128; [c, x] = canvas(LW, LW); x.fillStyle = '#707070'; x.fillRect(0, 0, LW, LW);
  x.fillStyle = '#707070'; x.fillRect(0, 0, LW, LW);
  for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) for (let i = 0; i < 4; i++) {
    const o = i * (LW / 4);
    x.beginPath(); x.moveTo(sx * LW, sy * LW + o); x.lineTo(sx * LW + LW, sy * LW + o + LW);
    x.strokeStyle = '#2a2a2a'; x.lineWidth = 9; x.stroke();
    x.strokeStyle = '#b8b8b8'; x.lineWidth = 5.5; x.stroke();
    x.strokeStyle = '#e4e4e4'; x.lineWidth = 2; x.stroke();
  }
  const lr = mulberry(21);
  for (let i = 0; i < 900; i++) { const v = 90 + lr() * 70; x.fillStyle = `rgba(${v},${v},${v},0.35)`; x.fillRect(lr() * LW, lr() * LW, 1.5, 1.5); }
  const leatherMaps = (() => {
    const d = x.getImageData(0, 0, LW, LW).data, [nc, nx] = canvas(LW, LW), [cc, cx] = canvas(LW, LW), nd = nx.createImageData(LW, LW), cd = cx.createImageData(LW, LW);
    const hh = (xx, yy) => d[(((yy + LW) % LW) * LW + ((xx + LW) % LW)) * 4] / 255;
    for (let yy = 0; yy < LW; yy++) for (let xx = 0; xx < LW; xx++) {
      const dx = hh(xx + 1, yy) - hh(xx - 1, yy), dy = hh(xx, yy + 1) - hh(xx, yy - 1), p = (yy * LW + xx) * 4;
      let nX = -dx * 3, nY = dy * 3, nZ = 1; const l = Math.hypot(nX, nY, nZ); nX /= l; nY /= l; nZ /= l;
      nd.data[p] = (nX * 0.5 + 0.5) * 255; nd.data[p + 1] = (nY * 0.5 + 0.5) * 255; nd.data[p + 2] = (nZ * 0.5 + 0.5) * 255; nd.data[p + 3] = 255;
      const v = hh(xx, yy), k = 0.35 + v * 0.9;
      cd.data[p] = 78 * k; cd.data[p + 1] = 54 * k; cd.data[p + 2] = 38 * k; cd.data[p + 3] = 255;
    }
    nx.putImageData(nd, 0, 0); cx.putImageData(cd, 0, 0);
    const n = new THREE.CanvasTexture(nc), col = new THREE.CanvasTexture(cc); col.colorSpace = THREE.SRGBColorSpace;
    for (const t of [n, col]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 7); t.anisotropy = 4; t.userData.shared = true; }
    return { n, col };
  })();

  const steel = (m, nrm) => new THREE.MeshPhysicalMaterial({
    color: 0xaebbd2, map: m.color, normalMap: m.normal, normalScale: new THREE.Vector2(nrm, nrm), roughnessMap: m.rough, roughness: 1, metalness: 1,
    clearcoat: 0.22, clearcoatRoughness: 0.35, emissive: 0x7fcfff, emissiveMap: m.emissive, emissiveIntensity: 0, envMapIntensity: 1.0,
  });
  const matSide = steel(side, 1.4), matEnd = steel(end, 1.4), matTop = steel(top, 1.1);
  const rim = new THREE.MeshPhysicalMaterial({ color: 0x4a5160, metalness: 1, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 1.0, emissive: 0x7fcfff, emissiveIntensity: 0 });
  const leather = new THREE.MeshStandardMaterial({ color: 0xffffff, map: leatherMaps.col, normalMap: leatherMaps.n, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.72, metalness: 0.02 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x3a281c, roughness: 0.78, metalness: 0.02 });

  const seg = q === 'low' ? 2 : 3;
  const head = new RoundedBoxGeometry(0.32, 0.2, 0.2, seg, 0.014);
  const cap = new RoundedBoxGeometry(0.034, 0.214, 0.214, seg, 0.012);
  const collar = new THREE.CylinderGeometry(0.03, 0.036, 0.026, 14);
  const wrap = new THREE.CylinderGeometry(0.0205, 0.0205, 0.33, 14, 1);
  const neck = new THREE.CylinderGeometry(0.019, 0.019, 0.1, 10);
  const pommel = new THREE.LatheGeometry([[0.0, -0.17], [0.024, -0.17], [0.03, -0.182], [0.037, -0.204], [0.034, -0.226], [0.022, -0.238], [0.0, -0.24]].map(([r0, y]) => new THREE.Vector2(r0, y)), 16);
  const ringB = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 14);
  const lug = new THREE.TorusGeometry(0.016, 0.0042, 6, 14);
  SHARED = { matSide, matEnd, matTop, rim, leather, strap, head, cap, collar, wrap, neck, pommel, ringB, lug };
  return SHARED;
}

/** drive the engraving glow (charged state). k 0..1 */
export function setMjolnirCharge(k) {
  if (!SHARED) return;
  const e = k * 2.6;
  SHARED.matSide.emissiveIntensity = SHARED.matEnd.emissiveIntensity = SHARED.matTop.emissiveIntensity = e;
  SHARED.rim.emissiveIntensity = k * 0.25;
}

// ------------------------------------------------------------------ strap physics
const N = 12;            // closed loop nodes (node 0 anchored at the pommel lug)
const REST = 0.03;       // local metres between nodes
const ANCHOR = new V3(0, -0.27, 0);

class Strap {
  constructor(group, material) {
    this.group = group;
    this.p = []; this.o = []; for (let i = 0; i < N; i++) { this.p.push(new V3()); this.o.push(new V3()); }
    this.inv = new THREE.Matrix4(); this.tmp = new V3(); this.last = new V3(); this.fresh = true; this.acc = 0;
    const R = 6;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * R * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * R * 3), 3));
    const idx = [];
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; for (let k = 0; k < R; k++) { const k2 = (k + 1) % R; const a = i * R + k, b = j * R + k, c = j * R + k2, d = i * R + k2; idx.push(a, b, d, b, c, d); } }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    group.add(this.mesh);
    this.R = R;
  }
  snap() { this.fresh = true; }
  update(dt) {
    const g = this.group;
    g.updateWorldMatrix(true, false);
    const s = g.matrixWorld.getMaxScaleOnAxis(), rest = REST * s;
    const anchor = this.tmp.copy(ANCHOR).applyMatrix4(g.matrixWorld);
    if (this.fresh || anchor.distanceToSquared(this.last) > 9) {
      // hang straight down as a closed loop: down one side, up the other
      const half = N / 2;
      for (let i = 0; i < N; i++) {
        const side = i < half ? 1 : -1, row = i < half ? i : N - i;
        this.p[i].set(side * 0.012, ANCHOR.y - row * REST, 0).applyMatrix4(g.matrixWorld);
        this.o[i].copy(this.p[i]);
      }
      this.fresh = false;
    }
    this.last.copy(anchor);
    dt = Math.min(dt, 1 / 30); if (dt <= 0) { this.write(); return; }
    const n = Math.max(1, Math.round(dt / (1 / 60))), h = dt / n;
    for (let s2 = 0; s2 < n; s2++) {
      const wanchor = this.tmp.copy(ANCHOR).applyMatrix4(g.matrixWorld);
      for (let i = 1; i < N; i++) {
        const p = this.p[i], o = this.o[i];
        const vx = (p.x - o.x) * 0.985, vy = (p.y - o.y) * 0.985, vz = (p.z - o.z) * 0.985;
        o.copy(p); p.x += vx; p.y += vy - 9.8 * h * h; p.z += vz;
      }
      this.p[0].copy(wanchor); this.o[0].copy(wanchor);
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < N; i++) {
          const a = this.p[i], b = this.p[(i + 1) % N];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-6, k = (d - rest) / d;
          const wa = i === 0 ? 0 : 0.5, wb = (i + 1) % N === 0 ? 0 : 0.5, ws = wa + wb || 1;
          a.x += dx * k * wa / ws * 1; a.y += dy * k * wa / ws; a.z += dz * k * wa / ws;
          b.x -= dx * k * wb / ws; b.y -= dy * k * wb / ws; b.z -= dz * k * wb / ws;
        }
        // keep the loop open: opposite nodes may not come closer than a strap width
        for (let i = 1; i < N / 2; i++) {
          const a = this.p[i], b = this.p[N - i], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-6, min = 0.026 * s;
          if (d < min) { const k = (min - d) / d * 0.5; a.x -= dx * k; a.y -= dy * k; a.z -= dz * k; b.x += dx * k; b.y += dy * k; b.z += dz * k; }
        }
        // stay out of the handle / pommel (a thin vertical capsule around the hammer's own axis)
        for (let i = 1; i < N; i++) {
          const q = this.tmp.copy(this.p[i]); g.worldToLocal(q);
          if (q.y > -0.255 && q.y < 0.2) { const rr = Math.hypot(q.x, q.z); if (rr < 0.032) { const sc = 0.032 / (rr || 1e-5); q.x = rr ? q.x * sc : 0.032; q.z *= rr ? sc : 1; this.p[i].copy(g.localToWorld(q)); } }
        }
        this.p[0].copy(wanchor);
      }
    }
    this.write();
  }
  write() {
    const g = this.group, R = this.R;
    this.inv.copy(g.matrixWorld).invert();
    const L = [];
    for (let i = 0; i < N; i++) L.push(this.tmp.clone().copy(this.p[i]).applyMatrix4(this.inv));
    const T = new V3(), A = new V3(), B = new V3(), ref = new V3(0, 0, 1);
    for (let i = 0; i < N; i++) {
      T.subVectors(L[(i + 1) % N], L[(i + N - 1) % N]).normalize();
      A.crossVectors(T, Math.abs(T.z) > 0.92 ? new V3(1, 0, 0) : ref).normalize(); B.crossVectors(T, A).normalize();
      for (let k = 0; k < R; k++) {
        const th = (k / R) * Math.PI * 2, c = Math.cos(th) * 0.0085, s = Math.sin(th) * 0.0035; // flat strap: wide along A, thin along B
        const o = (i * R + k) * 3;
        this.pos[o] = L[i].x + A.x * c + B.x * s; this.pos[o + 1] = L[i].y + A.y * c + B.y * s; this.pos[o + 2] = L[i].z + A.z * c + B.z * s;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  dispose() { this.geo.dispose(); }
}

// ------------------------------------------------------------------ builder
export function buildMjolnir() {
  const S = shared();
  const group = new THREE.Group(); group.name = 'mjolnir';
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; group.add(m); return m; };
  // head: face order for BoxGeometry groups = +x, -x, +y, -y, +z, -z
  const head = new THREE.Mesh(S.head, [S.matEnd, S.matEnd, S.matTop, S.matTop, S.matSide, S.matSide]);
  head.position.y = 0.3; head.castShadow = true; group.add(head);
  for (const sg of [1, -1]) add(S.cap, S.rim, sg * 0.168, 0.3, 0);
  add(S.collar, S.rim, 0, 0.197, 0);
  add(S.neck, S.rim, 0, 0.145, 0);
  add(S.wrap, S.leather, 0, -0.015, 0);
  add(S.ringB, S.rim, 0, 0.155, 0); add(S.ringB, S.rim, 0, -0.172, 0);
  add(S.pommel, S.rim, 0, 0, 0);
  add(S.lug, S.rim, 0, -0.258, 0);
  const strap = new Strap(group, S.strap);
  const tip = new THREE.Object3D(); tip.position.set(0.17, 0.3, 0); group.add(tip); // head end (trail anchor)
  return { group, tip, strap, update: (dt) => strap.update(dt), snap: () => strap.snap(), setCharge: setMjolnirCharge, dispose: () => strap.dispose() };
}
