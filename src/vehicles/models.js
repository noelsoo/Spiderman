// Procedural car models + instanced far-LOD. Cars face +Z, origin at the ground under the centre of the car.
// Shared geometries / materials; each full model is <= 12 meshes (body, glass, roof, trim, head/tail lights, 4 wheels, extras).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const KINDS = ['sedan', 'taxi', 'suv', 'sports', 'police', 'van'];

/** Gameplay + collision spec per kind. vmax m/s, accel m/s^2 (at standstill), brake m/s^2, grip 1 = normal. */
export const SPECS = {
  sedan:  { L: 4.7, W: 1.85, H: 1.47, wb: 2.8, wr: 0.34, ww: 0.24, vmax: 42, accel: 7.0, brake: 22, grip: 1.15, mass: 1500, hp: 100, mesh: 'sedan' },
  taxi:   { L: 4.7, W: 1.85, H: 1.47, wb: 2.8, wr: 0.34, ww: 0.24, vmax: 40, accel: 6.6, brake: 22, grip: 1.1, mass: 1550, hp: 105, mesh: 'sedan' },
  suv:    { L: 4.9, W: 2.0, H: 1.82, wb: 2.95, wr: 0.42, ww: 0.28, vmax: 38, accel: 6.0, brake: 20, grip: 1.0, mass: 2100, hp: 140, mesh: 'suv' },
  sports: { L: 4.4, W: 1.95, H: 1.29, wb: 2.65, wr: 0.35, ww: 0.32, vmax: 60, accel: 11.5, brake: 28, grip: 1.55, mass: 1300, hp: 85, mesh: 'sports' },
  police: { L: 4.9, W: 1.9, H: 1.5, wb: 2.9, wr: 0.35, ww: 0.25, vmax: 50, accel: 9.5, brake: 25, grip: 1.3, mass: 1800, hp: 130, mesh: 'sedan' },
  van:    { L: 5.4, W: 2.0, H: 2.3, wb: 3.3, wr: 0.38, ww: 0.26, vmax: 32, accel: 4.6, brake: 18, grip: 0.9, mass: 2600, hp: 150, mesh: 'van' },
};
for (const k of KINDS) {
  const s = SPECS[k];
  s.R = s.W / 2 - 0.05;                       // collision sphere radius
  const reach = s.L / 2 - s.R;
  s.cols = [-reach, 0, reach];                // sphere offsets along the car axis
  s.half = new THREE.Vector2(s.W / 2, s.L / 2);
}

// ------------------------------------------------------------------ paint
export const PAINTS = [
  0x15161a, 0xe6e6e8, 0x9ea4ab, 0xa31d1d, 0x1f3c82, 0x23402f, 0x575c63, 0xcf6a1a, 0xc7b38a, 0x5b1f6a, 0x1f6f78,
];
export const VAN_PAINTS = [0xe6e6e8, 0x5a3b22, 0x1f3c82, 0x9ea4ab, 0xdcdcdc];
export const TAXI_YELLOW = 0xf2b600;
export const POLICE_WHITE = 0xeeeeef;

let A = null; // shared assets
let QUALITY = 'high';

export function initCarAssets(quality = 'high') {
  if (A) return A;
  QUALITY = quality;
  const physical = quality === 'high' || quality === 'ultra';
  A = {
    quality,
    physical,
    paint: new Map(),
    glass: new THREE.MeshStandardMaterial({ color: 0x080d12, roughness: 0.06, metalness: 0.92, emissive: 0x04080c, envMapIntensity: 1.4 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.55, metalness: 0.3 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5 }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.5), toneMapped: false }),
    tailOff: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.03, 0.03), toneMapped: false }),
    tailOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 0.25, 0.18), toneMapped: false }),
    charred: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, metalness: 0.1 }),
    sign: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6), toneMapped: false }),
    barBase: new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.5 }),
    lod: new THREE.MeshLambertMaterial({ vertexColors: true }),
    geo: {},
  };
  return A;
}

export function paintMaterial(hex) {
  const a = A;
  let m = a.paint.get(hex);
  if (!m) {
    m = a.physical
      ? new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.1 })
      : new THREE.MeshStandardMaterial({ color: hex, metalness: 0.45, roughness: 0.42 });
    a.paint.set(hex, m);
  }
  return m;
}

// ------------------------------------------------------------------ geometry helpers
const ROT_Y90 = new THREE.Matrix4().makeRotationY(Math.PI / 2);

/** Extrude a side profile ([z,y] points) across the car width. Result: x centred, z forward, y up. */
function extrudeProfile(pts, width, { bevel = 0.07, curve = 2 } = {}) {
  const shape = new THREE.Shape();
  // shape x = -z so that the +90deg Y rotation maps it onto +z
  pts.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  shape.closePath();
  const bt = bevel;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.05, width - bt * 2), bevelEnabled: bevel > 0, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: curve, steps: 1, curveSegments: 1,
  });
  geo.translate(0, 0, -(width - bt * 2) / 2);
  geo.applyMatrix4(ROT_Y90);
  return geo;
}

function box(w, h, d, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function plain(g) { // keep attributes consistent for merging: position/normal/uv only, non-indexed
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  return out;
}
const merge = (list) => mergeGeometries(list.map(plain), false);

function wheelGeometry(r, w) {
  const tire = new THREE.CylinderGeometry(r, r, w, QUALITY === 'low' ? 10 : 16); tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.63, r * 0.63, w + 0.03, QUALITY === 'low' ? 6 : 12); rim.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(r * 0.22, r * 0.22, w + 0.06, 6); hub.rotateZ(Math.PI / 2);
  // a couple of "spokes" so the spin reads
  const sp1 = new THREE.BoxGeometry(w + 0.05, r * 1.2, r * 0.14);
  const sp2 = new THREE.BoxGeometry(w + 0.05, r * 0.14, r * 1.2);
  return mergeGeometries([colored(plain(tire), 0x0a0a0b), colored(plain(rim), 0xb8bdc4), colored(plain(hub), 0x30343a), colored(plain(sp1), 0x6c7178), colored(plain(sp2), 0x6c7178)], false);
}

// ------------------------------------------------------------------ per-kind shapes
// profiles are [z, y] lists, front = +z
function shapesFor(mesh) {
  switch (mesh) {
    case 'sports': return {
      body: [[-2.2, 0.36], [-2.23, 0.78], [-1.55, 0.9], [0.1, 0.84], [1.35, 0.72], [2.18, 0.52], [2.22, 0.38], [1.9, 0.3], [-1.9, 0.3]],
      cabin: [[-1.25, 0.86], [-0.6, 1.25], [0.3, 1.25], [0.95, 0.8]],
      roof: [-0.62, 0.34, 1.25, 1.29], wheelZ: [1.32, -1.3], wheelX: 0.9, track: 0.9,
      nose: 2.2, tail: -2.2, headY: 0.58, tailY: 0.72, light: 0.62,
    };
    case 'suv': return {
      body: [[-2.45, 0.44], [-2.46, 1.15], [-2.0, 1.22], [1.35, 1.16], [2.2, 1.0], [2.46, 0.7], [2.44, 0.5], [2.15, 0.42], [-2.15, 0.42]],
      cabin: [[-2.28, 1.18], [-2.1, 1.82], [0.55, 1.82], [1.3, 1.18]],
      roof: [-2.12, 0.58, 1.82, 1.87], wheelZ: [1.5, -1.45], wheelX: 0.96, track: 1.0,
      nose: 2.46, tail: -2.46, headY: 0.82, tailY: 0.9, light: 0.72,
    };
    case 'van': return {
      body: [[-2.7, 0.42], [-2.7, 2.25], [0.6, 2.25], [0.6, 1.2], [2.0, 1.1], [2.7, 0.85], [2.68, 0.5], [2.3, 0.42], [-2.3, 0.42]],
      cabin: [[0.58, 1.2], [0.62, 2.1], [1.0, 2.1], [1.85, 1.22]],
      roof: [0.6, 1.0, 2.1, 2.16], wheelZ: [1.7, -1.6], wheelX: 0.96, track: 1.0,
      nose: 2.7, tail: -2.7, headY: 0.85, tailY: 1.0, light: 0.76,
    };
    default: return { // sedan / taxi / police
      body: [[-2.4, 0.4], [-2.42, 0.86], [-1.6, 0.95], [1.35, 0.93], [2.0, 0.84], [2.4, 0.66], [2.42, 0.46], [2.15, 0.32], [-2.1, 0.32]],
      cabin: [[-1.5, 0.94], [-0.95, 1.4], [0.5, 1.4], [1.15, 0.94]],
      roof: [-0.98, 0.52, 1.4, 1.45], wheelZ: [1.5, -1.42], wheelX: 0.9, track: 0.92,
      nose: 2.42, tail: -2.42, headY: 0.66, tailY: 0.8, light: 0.68,
    };
  }
}

function buildGeometries(mesh, spec) {
  const key = mesh + (mesh === 'sedan' ? '' : '');
  if (A.geo[key]) return A.geo[key];
  const S = shapesFor(mesh);
  const W = spec.W, bevel = A.quality === 'low' ? 0 : 0.06;
  const bodyParts = [extrudeProfile(S.body, W, { bevel })];
  if (mesh === 'van') {
    // cargo box already in the profile; add a little roof lip
  }
  const body = merge(bodyParts);
  const glass = extrudeProfile(S.cabin, W - 0.16, { bevel: 0.03, curve: 1 });
  // roof slab + pillars (paint)
  const [rz0, rz1, ry0, ry1] = S.roof;
  const rw = W - 0.2;
  const roofParts = [box(rw, ry1 - ry0, rz1 - rz0 + 0.1, 0, (ry0 + ry1) / 2, (rz0 + rz1) / 2 + 0.05)];
  // pillars (A/C) as thin slanted boxes at the cabin corners
  const c = S.cabin;
  const pil = (p0, p1) => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.07, 0.07, len);
      g.rotateX(-ang); // z axis -> along the pillar in (z,y)
      g.translate(sx * (W / 2 - 0.1), (p0[1] + p1[1]) / 2, (p0[0] + p1[0]) / 2);
      roofParts.push(g);
    }
  };
  pil(c[0], c[1]); pil(c[2], c[3]);
  const roof = merge(roofParts);
  // trim: bumpers, grille, skirts, mirrors, plates
  const tr = [
    box(W - 0.1, 0.2, 0.14, 0, 0.42, S.nose - 0.02),
    box(W - 0.1, 0.2, 0.14, 0, 0.42, S.tail + 0.02),
    box(W * 0.55, 0.14, 0.05, 0, S.headY - 0.02, S.nose + 0.01),
    box(0.06, 0.1, S.wheelZ[0] - S.wheelZ[1] - 0.6, W / 2 - 0.02, 0.36, (S.wheelZ[0] + S.wheelZ[1]) / 2),
    box(0.06, 0.1, S.wheelZ[0] - S.wheelZ[1] - 0.6, -W / 2 + 0.02, 0.36, (S.wheelZ[0] + S.wheelZ[1]) / 2),
    box(0.16, 0.08, 0.14, W / 2 + 0.02, S.cabin[0][1] + 0.35, S.cabin[3][0] - 0.1),
    box(0.16, 0.08, 0.14, -W / 2 - 0.02, S.cabin[0][1] + 0.35, S.cabin[3][0] - 0.1),
  ];
  if (mesh === 'sports') tr.push(box(1.7, 0.06, 0.42, 0, 1.08, -2.05), box(0.05, 0.22, 0.2, 0.55, 0.96, -2.0), box(0.05, 0.22, 0.2, -0.55, 0.96, -2.0), box(W - 0.2, 0.08, 0.5, 0, 0.34, S.nose - 0.15));
  if (mesh === 'suv') tr.push(box(0.05, 0.05, 2.2, 0.7, 1.9, -0.8), box(0.05, 0.05, 2.2, -0.7, 1.9, -0.8));
  if (mesh === 'van') tr.push(box(W - 0.1, 0.05, 0.05, 0, 1.0, 0.59));
  const trim = merge(tr);
  const lx = W / 2 - S.light;
  const head = merge([
    box(0.38, 0.13, 0.06, S.light, S.headY, S.nose + 0.01), box(0.38, 0.13, 0.06, -S.light, S.headY, S.nose + 0.01),
  ]);
  const tail = merge([
    box(0.42, 0.12, 0.06, S.light, S.tailY, S.tail - 0.01), box(0.42, 0.12, 0.06, -S.light, S.tailY, S.tail - 0.01),
    box(0.3, 0.06, 0.05, 0, S.tailY, S.tail - 0.015),
  ]);
  void lx;
  const wheel = wheelGeometry(spec.wr, spec.ww);
  // far LOD: body + glass (dark) + wheel stubs, vertex coloured so instanceColor tints the paint only
  const lodBody = colored(plain(extrudeProfile(S.body, W, { bevel: 0 })), 0xffffff);
  const lodGlass = colored(plain(extrudeProfile(S.cabin, W - 0.1, { bevel: 0 })), 0x10161c);
  const stubs = [];
  for (const wz of S.wheelZ) for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(spec.wr, spec.wr, spec.ww + 0.05, 7); g.rotateZ(Math.PI / 2);
    g.translate(sx * (W / 2 - 0.12), spec.wr, wz); stubs.push(colored(plain(g), 0x0b0b0c));
  }
  const lod = mergeGeometries([lodBody, lodGlass, ...stubs], false);
  return (A.geo[key] = { S, body, glass, roof, trim, head, tail, wheel, lod });
}

// ------------------------------------------------------------------ model
let signTex = null;
function taxiSignMaterial() {
  if (A.taxiSign) return A.taxiSign;
  try {
    const c = document.createElement('canvas'); c.width = 64; c.height = 24;
    const g = c.getContext('2d');
    g.fillStyle = '#fff3c0'; g.fillRect(0, 0, 64, 24);
    g.fillStyle = '#1a1a1a'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 32, 13);
    signTex = new THREE.CanvasTexture(c); signTex.colorSpace = THREE.SRGBColorSpace;
    A.taxiSign = new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.8, 1.8, 1.8), toneMapped: false });
  } catch { A.taxiSign = A.sign; }
  return A.taxiSign;
}

export class CarModel {
  constructor(kind) {
    const spec = SPECS[kind];
    this.kind = kind; this.spec = spec;
    const G = buildGeometries(spec.mesh, spec);
    const S = G.S;
    this.root = new THREE.Group();
    const shadow = A.quality === 'high' || A.quality === 'ultra';
    const paintBase = kind === 'taxi' ? TAXI_YELLOW : kind === 'police' ? POLICE_WHITE : PAINTS[0];
    this.paintMeshes = [];
    const mk = (geo, mat, cast = false) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast && shadow; m.matrixAutoUpdate = true; this.root.add(m); return m; };
    this.body = mk(G.body, paintMaterial(paintBase), true);
    this.roof = mk(G.roof, paintMaterial(paintBase));
    this.paintMeshes.push(this.body, this.roof);
    this.glass = mk(G.glass, A.glass);
    this.trim = mk(G.trim, A.trim);
    this.head = mk(G.head, A.head);
    this.tail = mk(G.tail, A.tailOff);
    this.braking = false;
    this.steerPivots = []; this.wheels = [];
    S.wheelZ.forEach((wz, zi) => {
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(G.wheel, A.wheel);
        const x = sx * (spec.W / 2 - 0.1 - (spec.mesh === 'sports' && zi === 1 ? 0 : 0));
        if (zi === 0) { // front: steering pivot
          const piv = new THREE.Group(); piv.position.set(x, spec.wr, wz); piv.add(m); this.root.add(piv); this.steerPivots.push(piv);
        } else { m.position.set(x, spec.wr, wz); this.root.add(m); }
        this.wheels.push(m);
      }
    });
    if (kind === 'sports') for (const m of this.wheels) m.scale.set(1.12, 1, 1);
    this.extras = {};
    if (kind === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.17, 0.22), [A.barBase, A.barBase, A.barBase, A.barBase, taxiSignMaterial(), taxiSignMaterial()]);
      sign.position.set(0, S.roof[3] + 0.1, (S.roof[0] + S.roof[1]) / 2);
      this.root.add(sign); this.extras.sign = sign;
    }
    if (kind === 'police') {
      // black door panels in the trim, a light bar on the roof
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.02, 0.02), toneMapped: false }));
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.04, 0.25), toneMapped: false }));
      const z = (S.roof[0] + S.roof[1]) / 2;
      bar.position.set(0.25, S.roof[3] + 0.09, z); bar2.position.set(-0.25, S.roof[3] + 0.09, z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.3), A.barBase); base.position.set(0, S.roof[3] + 0.03, z);
      this.root.add(bar, bar2, base);
      this.extras.red = bar; this.extras.blue = bar2;
      // two-tone: black lower door band
      const band = merge([box(spec.W + 0.02, 0.32, 1.9, 0, 0.62, -0.1), box(spec.W + 0.02, 0.1, 0.8, 0, 0.92, S.nose - 1.25)]);
      const bm = new THREE.Mesh(band, new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5, metalness: 0.4 }));
      this.root.add(bm); this.extras.band = bm;
    }
    this.root.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });
    this.spin = 0;
    this._sirenPhase = 0;
  }

  setPaint(hex) {
    this._hex = hex;
    const mat = paintMaterial(hex);
    for (const m of this.paintMeshes) m.material = mat;
  }
  setCharred(on) {
    for (const m of this.paintMeshes) m.material = on ? A.charred : paintMaterial(this._hex ?? 0x555555);
    if (on) { this.setBrake(false); this.siren(false, 0); }
  }
  setBrake(on) {
    if (on === this.braking) return;
    this.braking = on; this.tail.material = on ? A.tailOn : A.tailOff;
  }
  /** steer: wheel angle in rad, positive = right. dist: metres rolled this frame (signed). */
  wheelsUpdate(steer, dist) {
    this.spin += dist / this.spec.wr;
    for (const p of this.steerPivots) p.rotation.y = -steer;
    for (const w of this.wheels) w.rotation.x = this.spin;
  }
  siren(on, t) {
    const e = this.extras;
    if (!e.red) return;
    const f = on ? (Math.floor(t * 9) % 2 === 0) : null;
    e.red.material.color.setRGB(f === true ? 6 : 0.25, f === true ? 0.2 : 0.02, f === true ? 0.15 : 0.02);
    e.blue.material.color.setRGB(f === false ? 0.2 : 0.02, f === false ? 0.9 : 0.04, f === false ? 6 : 0.25);
  }
}

// ------------------------------------------------------------------ far-LOD instancing
export class CarInstancer {
  constructor(scene, capacity) {
    this.meshes = {}; this.counts = {};
    this.tmp = new THREE.Object3D(); this.tmp.rotation.order = 'YXZ';
    const seenMesh = {};
    for (const k of KINDS) {
      const spec = SPECS[k];
      const G = buildGeometries(spec.mesh, spec);
      const im = new THREE.InstancedMesh(G.lod, A.lod, capacity);
      im.frustumCulled = false; im.count = 0; im.castShadow = false; im.receiveShadow = false;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(im);
      this.meshes[k] = im; this.counts[k] = 0; void seenMesh;
    }
  }
  begin() { for (const k of KINDS) this.counts[k] = 0; }
  add(kind, x, y, z, yaw, pitch, roll, color) {
    const im = this.meshes[kind], i = this.counts[kind]++;
    if (i >= im.instanceMatrix.count) { this.counts[kind]--; return; }
    const t = this.tmp;
    t.position.set(x, y, z); t.rotation.set(pitch, yaw, roll); t.updateMatrix();
    im.setMatrixAt(i, t.matrix); im.setColorAt(i, color);
  }
  end() {
    for (const k of KINDS) {
      const im = this.meshes[k]; im.count = this.counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  dispose() { for (const k of KINDS) this.meshes[k].removeFromParent(); }
}

export const assets = () => A;
