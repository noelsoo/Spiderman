// Procedural builders for every character. All geometry/materials are cached and shared between instances.
import * as THREE from 'three';
import { buildRig, makeDims, ProcModel, J } from './rig.js';
import {
  G, std, metal, glow, glowInstance, symMat, limbGeo, profileGeo, sphereGeo, boxGeo, cylGeo, coneGeo, capsuleGeo,
  mergeParts, rng, webTexture, emblemTexture, camoTexture, leopardTexture, eyeGeo, Tendril,
  M as M2, phys, withRim, webNormal, fabricNormal, grainNormal, panelMaps, skinMaps, faceTexture, faceShell, seg, qk, quality,
} from './common.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2;
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;

// ------------------------------------------------------------------ helpers
export function P(model, joint, geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  if (o.pos) m.position.set(...o.pos);
  if (o.rot) m.rotation.set(...o.rot);
  if (o.scale) { if (typeof o.scale === 'number') m.scale.setScalar(o.scale); else m.scale.set(...o.scale); }
  joint.add(m);
  model.reg(m, o.slot, o);
  return m;
}
export function addHook(model, fn, dispose) {
  if (!model.hooks) model.hooks = { fns: [], disposers: [], update(c, m) { for (const f of this.fns) f(c, m); }, dispose(m) { for (const d of this.disposers) d(m); } };
  if (fn) model.hooks.fns.push(fn);
  if (dispose) model.hooks.disposers.push(dispose);
}

/** piecewise-linear lookup in [[y, r], ...] */
export function radiusAt(pts, y) {
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const t = (y - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return lerp(pts[i - 1][1], pts[i][1], t); }
  return pts[pts.length - 1][1];
}

/** extruded eye shape wrapped onto an ellipsoid head. side +1 = character's left (+X) */
export function eyeWrap(kind, side, head, o = {}) {
  const { dx = 0, dy = 0, grow = 1, lift = 0.004, depth = 0.006 } = o;
  const { R, sx, sy, sz, y0 } = head;
  const key = `eyew${kind}${side}${R}${sx}${sy}${sz}${y0}${dx}${dy}${grow}${lift}${depth}`;
  return G(key, () => {
    const g = eyeGeo(kind, depth).clone();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) * grow + dx, y = pos.getY(i) * grow + dy;
      const t = pos.getZ(i);
      x *= side;
      const phi = x / (R * sx);
      const sinT = clamp(y / (R * sy), -0.97, 0.97), cosT = Math.sqrt(1 - sinT * sinT);
      const r = R * (1 + (lift + t) / R);
      pos.setXYZ(i, sx * Math.sin(phi) * cosT * r, y0 + sy * sinT * r, sz * Math.cos(phi) * cosT * r);
    }
    if (side < 0) { // restore winding
      for (let i = 0; i < pos.count; i += 3) {
        const a = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)], b = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
        pos.setXYZ(i + 1, ...b); pos.setXYZ(i + 2, ...a);
      }
    }
    g.computeVertexNormals();
    return g;
  });
}

/** curved decal plane hugging the chest ellipse */
export function curvedPlane(w, h, rx, rz, pad = 0.004) {
  return G(`cp${w}_${h}_${rx}_${rz}_${pad}`, () => {
    const g = new THREE.PlaneGeometry(w, h, 10, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const k = Math.sqrt(Math.max(0.05, 1 - (x / rx) ** 2));
      pos.setZ(i, rz * k + pad);
    }
    g.computeVertexNormals();
    return g;
  });
}

const FLAT = [[-0.1, 0.0001]];
/**
 * Generic humanoid body. spec.mats: slotKey -> Material; spec.slots: partName -> slotKey.
 * Returns info used by decals.
 */
export function buildBody(model, s) {
  const d = model.dims, k = d.k, j = model.j;
  const mats = s.mats, slots = s.slots || {};
  const mt = (part) => mats[slots[part] ?? part] ?? mats.default;
  const sl = (part) => slots[part] ?? part;
  const T = s.torso || {};
  const sx = T.sx ?? 1.25, sz = T.sz ?? 0.78, cR = T.chestR ?? 1, wR = T.waistR ?? 1;
  const key = `body${k}_${sx}_${sz}_${cR}_${wR}_${d.spine}_${d.chest}_${qk()}`;
  const SL = seg(16, 8), SS = seg(14, 8); // limb / sphere segments by graphics quality

  // pelvis
  const pel = s.pelvis || [0.36, 0.2, 0.26];
  P(model, j[J.H], sphereGeo(1, seg(18, 10), seg(12, 7)), mt('pelvis'), { slot: sl('pelvis'), pos: [0, 0.0, 0], scale: [pel[0] * k * 0.5, pel[1] * k * 0.5, pel[2] * k * 0.5] });
  // abdomen
  const abPts = [[-0.1, 0.0001], [-0.08, 0.125 * wR], [0.0, 0.14 * wR], [0.1, 0.125 * wR], [0.2, 0.14 * wR], [0.26, 0.1 * wR]].map(([y, r]) => [y * k, r * k]);
  const abdomen = P(model, j[J.SP], profileGeo(key + 'ab', abPts, seg(20, 10), 16), mt('abdomen'), { slot: sl('abdomen'), scale: [sx, 1, sz] });
  // chest
  const chPts = [[-0.08, 0.0001], [-0.06, 0.118 * wR], [0.05, 0.138 * wR + 0.0 * cR], [0.15, 0.158 * cR], [0.24, 0.178 * cR], [0.29, 0.178 * cR], [0.325, 0.14 * cR], [0.36, 0.085 * cR], [0.395, 0.05 * cR], [0.415, 0.0001]].map(([y, r]) => [y * k, r * k]);
  P(model, j[J.CH], profileGeo(key + 'ch', chPts, seg(26, 12), 22), mt('chest'), { slot: sl('chest'), scale: [sx, 1, sz] });
  const chestRad = (y) => ({ rx: radiusAt(chPts, y) * sx, rz: radiusAt(chPts, y) * sz });

  // neck + head
  const H = s.head || {};
  const hR = H.R ?? d.headR, hsx = H.sx ?? 0.92, hsy = H.sy ?? 1.05, hsz = H.sz ?? 1.0;
  P(model, j[J.NK], cylGeo((s.neckR ?? 0.05) * k, (s.neckR ?? 0.05) * 1.15 * k, d.neck * 2.2, seg(12, 8)), mt('neck'), { slot: sl('neck'), pos: [0, d.neck * 0.3, 0] });
  const y0 = hR * hsy * 0.95;
  const head = P(model, j[J.HD], sphereGeo(1, seg(32, 14), seg(24, 10)), mt('head'), { slot: sl('head'), pos: [0, y0, 0], scale: [hR * hsx, hR * hsy, hR * hsz] });
  const headInfo = { R: hR, sx: hsx, sy: hsy, sz: hsz, y0 };

  // arms
  const A = s.arm || {};
  const u0 = (A.u0 ?? 0.05) * k * (s.armM ?? 1), u1 = (A.u1 ?? 0.04) * k * (s.armM ?? 1), f0 = (A.f0 ?? 0.04) * k * (s.foreM ?? s.armM ?? 1), f1 = (A.f1 ?? 0.03) * k * (s.foreM ?? s.armM ?? 1);
  const sb = A.shoulder ?? 1.1;
  const hand = s.hand || [0.045, 0.055, 0.05];
  for (const side of [1, -1]) {
    const sh = j[side > 0 ? J.AL : J.AR], el = j[side > 0 ? J.EL : J.ER], wr = j[side > 0 ? J.WL : J.WR];
    if (!s.noShoulderBall) P(model, sh, sphereGeo(1, SS, 10), mt('shoulder'), { slot: sl('shoulder'), pos: [side * u0 * 0.15, 0.015 * k, 0], scale: [u0 * sb * 1.15, u0 * sb * 1.1, u0 * sb * 1.1] });
    P(model, sh, limbGeo(d.upper, u0, u1, A.ub ?? 0.14, 0.3, SL), mt('upperArm'), { slot: sl('upperArm') });
    P(model, el, sphereGeo(1, 10, 8), mt('upperArm'), { slot: sl('upperArm'), scale: [u1 * 1.02, u1 * 1.02, u1 * 1.02] });
    P(model, el, limbGeo(d.fore, f0, f1, A.fb ?? 0.18, 0.28, SL), mt('foreArm'), { slot: sl('foreArm') });
    P(model, wr, sphereGeo(1, seg(14, 8), seg(10, 7)), mt('hand'), { slot: sl('hand'), pos: [0, -d.hand * 0.5, 0.0], scale: [hand[0] * k, hand[1] * k, hand[2] * k] });
  }
  // legs
  const L = s.leg || {};
  const t0 = (L.t0 ?? 0.085) * k * (s.legM ?? 1), t1 = (L.t1 ?? 0.058) * k * (s.legM ?? 1), s0 = (L.s0 ?? 0.058) * k * (s.legM ?? 1), s1 = (L.s1 ?? 0.04) * k * (s.legM ?? 1);
  const foot = s.foot || [0.055, 0.045, 0.14];
  for (const side of [1, -1]) {
    const th = j[side > 0 ? J.TL : J.TR], kn = j[side > 0 ? J.KL : J.KR], ft = j[side > 0 ? J.FL : J.FR];
    P(model, th, limbGeo(d.thigh, t0, t1, L.tb ?? 0.1, 0.3, SL), mt('thigh'), { slot: sl('thigh') });
    P(model, kn, sphereGeo(1, 10, 8), mt('thigh'), { slot: sl('thigh'), scale: [t1 * 1.02, t1 * 1.02, t1 * 1.02] });
    P(model, kn, limbGeo(d.shin, s0, s1, L.sb ?? 0.14, 0.25, SL), mt('shin'), { slot: sl('shin') });
    P(model, ft, sphereGeo(1, seg(14, 8), seg(10, 7)), mt('foot'), { slot: sl('foot'), pos: [0, -d.footH * 0.5 + foot[1] * k * 0.4, foot[2] * k * 0.32], scale: [foot[0] * k, foot[1] * k + 0.01, foot[2] * k] });
  }
  return { headInfo, chestRad, head, abdomen, hr: hR };
}

export function addEyes(model, headInfo, kind, mat, rimMat, o = {}) {
  const hj = model.j[J.HD];
  for (const side of [1, -1]) {
    P(model, hj, eyeWrap(kind, side, headInfo, { lift: 0.006, depth: 0.004, ...o }), mat, { slot: o.slot ?? 'eyes', cast: false });
    if (rimMat) P(model, hj, eyeWrap(kind, side, headInfo, { lift: 0.002, depth: 0.004, grow: o.rimGrow ?? 1.2, dx: o.rimDx ?? -0.004, dy: o.rimDy ?? 0.0 }), rimMat, { slot: 'rim', cast: false });
  }
}

/** painted face (eyes/brows/mouth) on a thin shell over the front of the head + nose + ears. */
export function addFace(model, H, o = {}) {
  const hj = model.j[J.HD], R = H.R;
  const tex = faceTexture(o.tex || {});
  const mat = M2('faceMat' + tex.uuid, () => new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.62, metalness: 0, depthWrite: false, polygonOffsetFactor: -2, polygonOffset: true }));
  P(model, hj, faceShell(1, o.phi ?? 0.95, o.t0 ?? 0.27, o.t1 ?? 0.8), mat, { pos: [0, H.y0, 0], scale: [R * H.sx * 1.004, R * H.sy * 1.004, R * H.sz * 1.004], cast: false });
  const skin = o.skin;
  if (skin && o.nose !== false) P(model, hj, sphereGeo(1, 10, 8), skin, { pos: [0, H.y0 - R * 0.12, R * H.sz * 0.97], scale: [R * 0.14, R * 0.2, R * 0.2] });
  if (skin && o.ears !== false) for (const sd of [1, -1]) P(model, hj, sphereGeo(1, 8, 6), skin, { pos: [sd * R * H.sx * 0.97, H.y0 - R * 0.02, -R * 0.05], scale: [R * 0.1, R * 0.22, R * 0.15] });
  return mat;
}
export function finish(model, variant) {
  if (variant && model.variants) model.setVariant(variant);
  model.snap();
  return model;
}

// ================================================================== SPIDER-MAN
const SPIDER_VARIANTS = () => {
  const nS = new V2(0.85, 0.85);
  const suit = (kind, o = {}) => withRim(phys(0xffffff, {
    map: webTexture(kind), normalMap: webNormal(kind), normalScale: nS, roughness: 0.5, metalness: 0.06,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x8fa2ff), clearcoat: 0.18, clearcoatRoughness: 0.45, ...o,
  }), 0xa8c0ff, 0.16);
  const sym = (id, kind = 'black') => symMat({ id, map: webTexture(kind), normalMap: webNormal(kind), normalScale: 1.1, color: 0xffffff });
  const symPlain = symMat({ id: 'p', normalMap: fabricNormal(5, 0.5, 'symfab'), normalScale: 0.5 });
  const eyeW = std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.2 });
  const emb = std(0xffffff, { map: emblemTexture('#ffffff'), transparent: true, alphaTest: 0.4, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.15, side: THREE.DoubleSide });
  const rim = std(0x050505, { roughness: 0.4 });
  const cloth = (color, o = {}) => withRim(phys(color, { roughness: 0.55, normalMap: fabricNormal(6, 0.55, 'spfab'), normalScale: nS, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff9aa0), ...o }), 0xa8c0ff, 0.12);
  return {
    classic: {
      torso: suit('torso'), arms: suit('red'), legs: suit('blue'),
      boots: cloth(0xa00c1a), gloves: cloth(0xb40f1e),
      head: suit('red', { roughness: 0.42 }),
      eyes: eyeW, rim, emblem: emb, belt: cloth(0x12204f),
    },
    symbiote: {
      torso: sym('t'), arms: sym('a'), legs: sym('l'), boots: symPlain, gloves: symPlain, head: sym('h'),
      eyes: std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.2 }), rim: std(0x000000, { roughness: 0.3 }), emblem: emb, belt: symPlain,
    },
  };
};

export function buildSpiderMan(opts = {}) {
  const dims = makeDims(0.95, { headR: 0.108, shW: 0.182 });
  const rig = buildRig(dims, 1.06);
  const model = new ProcModel('spiderman', rig, { prof: { stance: 'ready', cadence: 1.05, stride: 1.05, lean: 1.1, flipDodge: true, shoot: 'web', aimStyle: 'web' } });
  model.variants = SPIDER_VARIANTS();
  const v0 = model.variants.classic;
  const info = buildBody(model, {
    mats: { ...v0, pelvis: v0.legs, default: v0.arms },
    slots: { pelvis: 'legs', abdomen: 'torso', chest: 'torso', neck: 'head', shoulder: 'arms', upperArm: 'arms', foreArm: 'arms', hand: 'gloves', thigh: 'legs', shin: 'legs', foot: 'boots' },
    torso: { sx: 1.22, sz: 0.74, chestR: 1.02, waistR: 0.86 },
    head: { R: 0.108, sx: 0.9, sy: 1.08, sz: 1.0 },
    arm: { u0: 0.047, u1: 0.037, f0: 0.039, f1: 0.03, ub: 0.1, fb: 0.14 },
    leg: { t0: 0.082, t1: 0.054, s0: 0.054, s1: 0.036, tb: 0.1, sb: 0.12 },
    foot: [0.05, 0.04, 0.13], hand: [0.036, 0.048, 0.045],
    pelvis: [0.34, 0.2, 0.24],
  });
  addEyes(model, info.headInfo, 'spider', v0.eyes, v0.rim, { slot: 'eyes', depth: 0.008 });
  // chest + back emblem
  const cr = info.chestRad(0.2 * dims.k);
  P(model, model.j[J.CH], curvedPlane(0.2 * dims.k * 1.55, 0.22 * dims.k * 1.5, cr.rx, cr.rz, 0.003), v0.emblem, { slot: 'emblem', pos: [0, 0.2 * dims.k, 0], cast: false });
  const cb = info.chestRad(0.26 * dims.k);
  const back = P(model, model.j[J.CH], curvedPlane(0.1 * dims.k * 1.5, 0.12 * dims.k * 1.5, cb.rx, cb.rz, 0.003), v0.emblem, { slot: 'emblem', pos: [0, 0.26 * dims.k, 0], rot: [0, Math.PI, 0], cast: false });
  // web shooters
  for (const side of [1, -1]) P(model, model.j[side > 0 ? J.WL : J.WR], cylGeo(0.036 * dims.k, 0.033 * dims.k, 0.07 * dims.k, 10), std(0x1a1a24, { metalness: 0.5, roughness: 0.4 }), { pos: [0, 0.02, 0] });

  // articulated hands: 4 two-segment fingers + a thumb per hand, shared capsule geometry, same glove slot (so symbiote variant re-skins them)
  const hk = dims.k, FR_ = 0.0098 * hk;
  const hands = [];
  const FING = [[-0.62, 0.034, 0.027, 0.9], [-0.2, 0.039, 0.03, 1.0], [0.2, 0.036, 0.028, 1.05], [0.62, 0.029, 0.022, 1.15]]; // [x frac (index..pinky), prox len, dist len, relaxed curl scale]
  for (const side of [1, -1]) {
    const wr = model.j[side > 0 ? J.WL : J.WR];
    const h = { side, w: 0, fingers: [], thumb: null };
    FING.forEach(([xf, l1, l2, cs], i) => {
      const x = -side * xf * 0.034 * hk; // index sits on the inner (thumb) side
      const p1 = new THREE.Object3D(); p1.position.set(x, -dims.hand * 0.5 - 0.034 * hk, 0.004 * hk * (i === 1 || i === 2 ? 1 : 0)); wr.add(p1);
      P(model, p1, capsuleGeo(FR_, l1 * hk, 3, 6), v0.gloves, { slot: 'gloves', pos: [0, -l1 * hk * 0.5 - FR_ * 0.4, 0] });
      const p2 = new THREE.Object3D(); p2.position.set(0, -l1 * hk - FR_ * 0.8, 0); p1.add(p2);
      P(model, p2, capsuleGeo(FR_ * 0.9, l2 * hk, 3, 6), v0.gloves, { slot: 'gloves', pos: [0, -l2 * hk * 0.5 - FR_ * 0.3, 0] });
      h.fingers.push({ p1, p2, i, cs });
    });
    const t1 = new THREE.Object3D(); t1.position.set(side * -0.026 * hk, -dims.hand * 0.5 - 0.004 * hk, 0.022 * hk); wr.add(t1);
    P(model, t1, capsuleGeo(FR_ * 1.15, 0.022 * hk, 3, 6), v0.gloves, { slot: 'gloves', pos: [0, -0.016 * hk, 0] });
    const t2 = new THREE.Object3D(); t2.position.set(0, -0.03 * hk, 0); t1.add(t2);
    P(model, t2, capsuleGeo(FR_ * 1.0, 0.02 * hk, 3, 6), v0.gloves, { slot: 'gloves', pos: [0, -0.012 * hk, 0] });
    h.thumb = { t1, t2 };
    hands.push(h);
  }
  const posHand = (h, th, loose, flat) => { // th = thwip weight, loose = 0 open curl .. 1 loose fist, flat = pressed flat on a surface
    const sd = h.side;
    for (const f of h.fingers) {
      const thw = f.i === 1 || f.i === 2; // middle + ring fold in the thwip
      const relax = (0.28 + 0.62 * loose) * f.cs * (1 - 0.7 * flat) + (f.i === 3 ? 0.1 : 0) + (f.i === 0 ? -0.05 : 0);
      const c1 = thw ? lerp(relax, 1.5, th) : lerp(relax, 0.0, th * 0.9);
      const c2 = thw ? lerp(relax * 1.15, 1.55, th) : lerp(relax * 1.1, 0.02, th);
      f.p1.rotation.set(0, 0, -sd * c1);
      f.p2.rotation.set(0, 0, -sd * c2);
      f.p1.rotation.x = (f.i - 1.5) * 0.045 * (1 + flat * 2) * (1 - th); // slight spread
    }
    const T = h.thumb;
    // thwip: thumb sticks out sideways/forward; relaxed: lies along the palm
    T.t1.rotation.set(lerp(-0.25, -0.2, th), 0, -sd * lerp(0.35 + 0.35 * loose, -0.55, th));
    T.t2.rotation.set(0, 0, -sd * lerp(0.35, 0.0, th));
  };
  addHook(model, (c, m) => {
    const st = c.st;
    for (let hi = 0; hi < 2; hi++) {
      const h = hands[hi], right = h.side < 0;
      let want = 0;
      if (st === 'aim' || st === 'shoot') want = right ? 1 : 0;
      else if (st === 'swing') want = (m.swingArm > 0) === !right ? 1 : 0;
      else if (st === 'zip') want = 1;
      h.w += (want - h.w) * (1 - Math.exp(-(want > h.w ? 22 : 9) * c.dt));
      h.loose = (h.loose ?? 0.4) + ((st === 'run' || st === 'sprint' || st === 'charge' || st.startsWith('p') || st === 'uppercut' || st === 'smash' ? 1 : 0.4) - (h.loose ?? 0.4)) * (1 - Math.exp(-10 * c.dt));
      h.flat = (h.flat || 0) + ((st === 'perch' && right ? 1 : 0) - (h.flat || 0)) * (1 - Math.exp(-8 * c.dt));
      posHand(h, h.w, h.loose, h.flat);
      if (h.w > 0.02 && st !== 'aim' && st !== 'shoot') m.j[right ? J.WR : J.WL].rotation.x -= 0.45 * h.w; // cock the wrist up
    }
  });

  // symbiote tendrils (visible only in the symbiote variant)
  const tm = symMat({ id: 'tend' });
  const tends = [];
  const seeds = [[0.09, 0.12, -0.12, 0.7, 0.9, -1.4], [-0.09, 0.12, -0.12, -0.7, 0.9, -1.4], [0.0, 0.2, -0.13, 0, 1.1, -1.2]];
  seeds.forEach((sd, i) => {
    const t = new Tendril({ segs: 12, radial: 6, r0: 0.026, r1: 0.006, material: tm, ref: new V3(0, 1, 0) });
    t.mesh.userData.only = 'symbiote'; t.mesh.visible = false;
    model.j[J.CH].add(t.mesh); model.parts.push(t.mesh); t.mesh.userData.mat = tm;
    tends.push({ t, sd, ph: i * 2.1 });
  });
  // glide wings
  const wingMat = new THREE.MeshBasicMaterial({ map: webTexture('wing'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: true });
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 5 * 3), 3));
  wgeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0, 0.5, 0.5, 0, 1, 1, 1, 1, 0, 0, 0, 0.5, 0.5]), 2));
  wgeo.setIndex([0, 1, 4, 0, 4, 3, 3, 4, 2, 5, 6, 9, 5, 9, 8, 8, 9, 7]);
  const wings = new THREE.Mesh(wgeo, wingMat); wings.frustumCulled = false; wings.visible = false; wings.renderOrder = 2;
  rig.group.add(wings);
  let wingK = 0;
  const wp = [new V3(), new V3(), new V3(), new V3()];
  const j = model.j;
  addHook(model, (c, m) => {
    // tendrils
    if (m.variant === 'symbiote') {
      const sp = c.vl ? Math.hypot(c.vl.x, c.vl.z) : 0;
      for (const { t, sd, ph } of tends) {
        t.update((u, out) => {
          const w = Math.sin(c.tm * 2.3 + ph + u * 5) * 0.09 * u + Math.sin(c.tm * 4.1 + ph * 2 + u * 9) * 0.03 * u;
          out.set(sd[0] + sd[3] * 0.12 * u + w, sd[1] + sd[4] * 0.42 * u * (1 - 0.5 * u) + Math.cos(c.tm * 1.7 + ph + u * 4) * 0.06 * u, sd[2] + sd[5] * 0.4 * u - sp * 0.01 * u * u);
        });
      }
    }
    // wings
    const target = c.st === 'glide' ? 1 : 0;
    wingK += (target - wingK) * (1 - Math.exp(-9 * c.dt));
    wings.visible = wingK > 0.03;
    if (wings.visible) {
      rig.group.updateMatrixWorld(true);
      const pos = wgeo.attributes.position;
      const inv = rig.group.matrixWorld;
      for (let sdx = 0; sdx < 2; sdx++) {
        const sh = sdx ? j[J.AR] : j[J.AL], wr = sdx ? j[J.WR] : j[J.WL], an = sdx ? j[J.FR] : j[J.FL], hp = sdx ? j[J.TR] : j[J.TL];
        sh.getWorldPosition(wp[0]); wr.getWorldPosition(wp[1]); an.getWorldPosition(wp[2]); hp.getWorldPosition(wp[3]);
        for (const q of wp) rig.group.worldToLocal(q);
        const mid = wp[1].clone().add(wp[2]).multiplyScalar(0.5);
        const body = wp[0].clone().add(wp[3]).multiplyScalar(0.5);
        mid.lerp(body, 0.12);
        // order: S, W, A, H, M
        const pts = [wp[0], wp[1], wp[2], wp[3], mid];
        for (let i = 0; i < 5; i++) {
          const q = i === 0 || i === 3 ? pts[i] : pts[i].clone().lerp(body, 1 - wingK);
          pos.setXYZ(sdx * 5 + i, q.x, q.y, q.z);
        }
      }
      pos.needsUpdate = true;
    }
  }, () => { wgeo.dispose(); wingMat.dispose(); tends.forEach((x) => x.t.dispose()); });
  return finish(model, opts.variant === 'symbiote' ? 'symbiote' : 'classic');
}

// ================================================================== IRON MAN
export function buildIronMan() {
  const dims = makeDims(1.0, { headR: 0.11 });
  const rig = buildRig(dims, 1.1);
  const model = new ProcModel('ironman', rig, { prof: { stance: 'relaxed', flyStyle: 'iron', hover: 'iron', flipDodge: false, cadence: 0.92, stride: 0.95, armSwing: 0.8, shoot: 'palm', lean: 1.0, landStyle: 'hero' } });
  const pm = panelMaps(1), nS = new V2(0.75, 0.75);
  const red = withRim(phys(0xa0101a, { roughness: 0.34, metalness: 0.86, roughnessMap: pm.rough, normalMap: pm.normal, normalScale: nS, clearcoat: 1, clearcoatRoughness: 0.07 }), 0xffc9a0, 0.14);
  const gold = withRim(phys(0xd9a53b, { roughness: 0.3, metalness: 0.95, roughnessMap: pm.rough, normalMap: pm.normal, normalScale: nS, clearcoat: 0.6, clearcoatRoughness: 0.1 }), 0xfff0c0, 0.12);
  const dark = std(0x24242a, { metalness: 0.7, roughness: 0.45 });
  const info = buildBody(model, {
    mats: { default: red, abdomen: gold, pelvis: gold, neck: dark, head: red, shoulder: red, upperArm: red, foreArm: gold, hand: gold, thigh: red, shin: gold, foot: red, chest: red },
    torso: { sx: 1.3, sz: 0.86, chestR: 1.12, waistR: 1.0 },
    head: { R: 0.11, sx: 0.88, sy: 1.1, sz: 1.0 },
    arm: { u0: 0.054, u1: 0.045, f0: 0.05, f1: 0.04, ub: 0.08, fb: 0.1 },
    leg: { t0: 0.09, t1: 0.064, s0: 0.062, s1: 0.045, tb: 0.06, sb: 0.08 },
    foot: [0.06, 0.05, 0.15], hand: [0.045, 0.055, 0.05], pelvis: [0.36, 0.2, 0.26], armM: 1.1, legM: 1.12,
  });
  const hj = model.j[J.HD], H = info.headInfo;
  // faceplate + eye slits
  P(model, hj, G('imface', () => new THREE.SphereGeometry(1, 18, 14, Math.PI / 2 - 0.6, 1.2, 0.62, 1.9)), gold, { pos: [0, H.y0, 0], scale: [H.R * H.sx * 1.04, H.R * H.sy * 1.03, H.R * H.sz * 1.04] });
  const eyeM = glow(0xcfefff, 3);
  for (const s of [1, -1]) P(model, hj, boxGeo(0.045, 0.012, 0.01), eyeM, { pos: [s * 0.036, H.y0 + 0.02, H.R * H.sz * 0.93], rot: [0, s * 0.35, -s * 0.18], cast: false });
  P(model, hj, boxGeo(0.02, 0.03, 0.14), red, { pos: [0, H.y0 + H.R * 0.95, -0.01] });
  // arc reactor
  const cj = model.j[J.CH], cr = info.chestRad(0.22);
  const ringGeo = G('arcring', () => new THREE.TorusGeometry(0.05, 0.012, 8, 20));
  P(model, cj, ringGeo, gold, { pos: [0, 0.22, cr.rz + 0.008] });
  P(model, cj, G('arcdisc', () => new THREE.CircleGeometry(0.043, 20)), glow(0xaee8ff, 3.2), { pos: [0, 0.22, cr.rz + 0.012], cast: false });
  // chest gold trim: two curved side plates + collar
  for (const s of [1, -1]) P(model, cj, sphereGeo(1, 12, 8), gold, { pos: [s * cr.rx * 0.78, 0.12, cr.rz * 0.45], scale: [0.055, 0.1, 0.05], rot: [0, s * 0.5, s * 0.25] });
  P(model, model.j[J.NK], cylGeo(0.062 * dims.k, 0.07 * dims.k, 0.05, seg(14, 8)), gold, { pos: [0, 0.0, 0] });
  // jaw plates + helmet crest
  for (const s of [1, -1]) P(model, hj, sphereGeo(1, 10, 8), gold, { pos: [s * H.R * 0.58, H.y0 - H.R * 0.4, H.R * 0.62], scale: [H.R * 0.4, H.R * 0.5, H.R * 0.45] });
  // elbow + knee caps, shin guards
  for (const s of [1, -1]) {
    P(model, model.j[s > 0 ? J.EL : J.ER], sphereGeo(1, 12, 8), gold, { pos: [0, 0, -0.01], scale: [0.058, 0.05, 0.062] });
    P(model, model.j[s > 0 ? J.KL : J.KR], sphereGeo(1, 12, 8), red, { pos: [0, 0.01, 0.03], scale: [0.07, 0.07, 0.06] });
    P(model, model.j[s > 0 ? J.WL : J.WR], cylGeo(0.05, 0.052, 0.085, seg(14, 8)), red, { pos: [0, 0.0, 0] }); // gauntlet cuff
  }
  P(model, model.j[J.SP], cylGeo(0.14 * dims.k, 0.15 * dims.k, 0.045, seg(18, 10)), red, { pos: [0, 0.05, 0], scale: [1.32, 1, 0.9] }); // belt
  // shoulders (pauldrons)
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.AL : J.AR], sphereGeo(0.092, 14, 10), red, { pos: [s * 0.02, 0.02, 0], scale: [1.1, 0.9, 1.05] });
  // knee + elbow gold caps
  // thrusters (per-instance glow so we can drive intensity)
  const gm = glowInstance(0x9fe3ff, 2.4, { opacity: 0.4 });
  const mk = (joint, pos, r, sc = [1, 1, 1]) => { const m = new THREE.Mesh(sphereGeo(r, 12, 8), gm); m.position.set(...pos); m.scale.set(...sc); joint.add(m); m.renderOrder = 3; return m; };
  const hL = mk(model.j[J.WL], [-0.03, -dims.hand * 0.5, 0.0], 0.05);
  const hR = mk(model.j[J.WR], [0.03, -dims.hand * 0.5, 0.0], 0.05);
  const fL = mk(model.j[J.FL], [0, -0.035, 0.05], 0.065, [1, 0.5, 1.4]);
  const fR = mk(model.j[J.FR], [0, -0.035, 0.05], 0.065, [1, 0.5, 1.4]);
  model.thrusters = [hL, hR, fL, fR];
  let override = null;
  model.setThrusters = (lv) => { override = lv == null ? null : clamp(lv, 0, 1); };
  const gmFeet = glowInstance(0x9fe3ff, 2.4, { opacity: 0.4 });
  fL.material = gmFeet; fR.material = gmFeet;
  let hk = 0.4, fk = 0.3;
  addHook(model, (c) => {
    const handHot = c.st === 'shoot' || c.st === 'cast' || c.st === 'hover' ? 1 : 0.35;
    const footHot = c.st === 'fly' || c.st === 'hover' || c.st === 'dash' || c.st === 'jump' || c.st === 'cast' ? 1 : 0.28;
    hk += (handHot - hk) * (1 - Math.exp(-12 * c.dt)); fk += (footHot - fk) * (1 - Math.exp(-10 * c.dt));
    if (override !== null) { hk = fk = override; }
    gm.opacity = 0.25 + hk * 0.6 + Math.sin(c.tm * 40) * 0.05 * hk;
    gmFeet.opacity = 0.2 + fk * 0.65 + Math.sin(c.tm * 37) * 0.06 * fk;
  }, () => { gm.dispose(); gmFeet.dispose(); });
  return finish(model);
}

// ================================================================== HULK
export function buildHulk() {
  const dims = makeDims(1.42, { headR: 0.098, neck: 0.1 });
  const rig = buildRig(dims, 1.0);
  const model = new ProcModel('hulk', rig, { prof: { stance: 'hulk', cadence: 0.78, stride: 1.05, armSwing: 1.0, lean: 1.25, bob: 2.0, flipDodge: false, throwStyle: 'two', wide: 0.12, tempo: 0.9, knuckle: true } });
  const sm_ = skinMaps();
  sm_.map.repeat.set(2, 2); sm_.normal.repeat.set(2, 2);
  const skin = withRim(phys(0xffffff, { map: sm_.map, normalMap: sm_.normal, normalScale: new V2(1.1, 1.1), roughness: 0.52, metalness: 0.0, sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xa8ff90), clearcoat: 0.08, clearcoatRoughness: 0.6 }), 0xb8ff9a, 0.1);
  const skinD = std(0x3f8530, { roughness: 0.6, normalMap: sm_.normal, normalScale: new V2(0.8, 0.8) });
  const shorts = std(0x5a2d86, { roughness: 0.85, normalMap: fabricNormal(5, 0.5, 'hulkfab'), normalScale: new V2(0.7, 0.7) });
  const info = buildBody(model, {
    mats: { default: skin, pelvis: shorts, thigh: skin, shin: skin, foot: skin, neck: skin },
    torso: { sx: 1.62, sz: 0.95, chestR: 1.38, waistR: 1.05 },
    head: { R: 0.098, sx: 1.0, sy: 0.98, sz: 1.04 },
    arm: { u0: 0.062, u1: 0.05, f0: 0.054, f1: 0.042, ub: 0.3, fb: 0.35, shoulder: 1.55 },
    leg: { t0: 0.09, t1: 0.066, s0: 0.066, s1: 0.045, tb: 0.28, sb: 0.3 },
    armM: 1.75, foreM: 1.95, legM: 1.2, neckR: 0.075,
    foot: [0.062, 0.046, 0.15], hand: [0.058, 0.07, 0.07], pelvis: [0.42, 0.22, 0.28],
  });
  const k = dims.k, hj = model.j[J.HD], H = info.headInfo;
  // shorts: lathe skirt over hips and thighs
  const shortsGeo = profileGeo('hulkshorts', [[-0.22, 0.17], [-0.2, 0.2], [0.0, 0.2], [0.1, 0.17], [0.13, 0.0001]].map(([y, r]) => [y * k, r * k]), 18, 12);
  P(model, model.j[J.H], shortsGeo, shorts, { scale: [1.5, 1, 0.95] });
  const flap = G('hulkflap', () => { const g = new THREE.ConeGeometry(0.05 * k, 0.12 * k, 3); g.rotateX(Math.PI); return g; });
  for (const [x, z, r] of [[0.16, 0.0, 0.2], [-0.17, 0.02, -0.25], [0.0, 0.2, 0], [0.05, -0.2, 0.1]]) P(model, model.j[J.H], flap, shorts, { pos: [x * k * 1.2, -0.26 * k, z * k], rot: [0, 0, r] });
  P(model, model.j[J.TL], cylGeo(0.088 * k, 0.1 * k, 0.17 * k, 12), shorts, { pos: [0, -0.1 * k, 0] });
  P(model, model.j[J.TR], cylGeo(0.088 * k, 0.1 * k, 0.17 * k, 12), shorts, { pos: [0, -0.1 * k, 0] });
  // pec/ab definition
  const cr = info.chestRad(0.2 * k);
  for (const s of [1, -1]) P(model, model.j[J.CH], sphereGeo(1, 14, 10), skinD, { pos: [s * cr.rx * 0.42, 0.2 * k, cr.rz * 0.58], scale: [0.095 * k, 0.07 * k, 0.07 * k] });
  // trapezius
  P(model, model.j[J.CH], sphereGeo(1, 12, 8), skin, { pos: [0, 0.33 * k, -0.03 * k], scale: [0.19 * k, 0.06 * k, 0.11 * k] });
  // head details: brow, jaw, hair
  const hr = H.R;
  P(model, hj, sphereGeo(1, 12, 8), skinD, { pos: [0, H.y0 - hr * 0.55, hr * 0.5], scale: [hr * 0.82, hr * 0.5, hr * 0.62] }); // jaw
  for (const s of [1, -1]) P(model, hj, boxGeo(hr * 0.9, hr * 0.28, hr * 0.5), skinD, { pos: [s * hr * 0.42, H.y0 + hr * 0.22, hr * 0.8], rot: [0.0, 0, -s * 0.38] }); // angry brow
  const eyeM = glow(0xffffff, 1.6);
  for (const s of [1, -1]) P(model, hj, boxGeo(hr * 0.34, hr * 0.12, hr * 0.12), eyeM, { pos: [s * hr * 0.42, H.y0 + hr * 0.05, hr * 0.86], rot: [0, s * 0.2, -s * 0.3], cast: false });
  P(model, hj, boxGeo(hr * 0.7, hr * 0.12, hr * 0.12), std(0x1c2a18), { pos: [0, H.y0 - hr * 0.5, hr * 0.92] }); // mouth
  const hairM = std(0x15150f, { roughness: 0.9 });
  P(model, hj, G('hulkhair', () => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52)), hairM, { pos: [0, H.y0 + hr * 0.12, -hr * 0.1], scale: [hr * 1.06, hr * 1.04, hr * 1.12], rot: [-0.25, 0, 0] });
  // face: painted angry eyes/mouth + nose + ears
  addFace(model, H, { tex: { skin: '#4f9d3b', iris: '#7fd05a', brow: '#17300f', lip: '#1c3a14', mood: 'angry', brows: false }, skin: skinD });
  // abs
  const absP = [];
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) absP.push({ geo: sphereGeo(1, 10, 8), pos: [sd * 0.045 * k, -0.04 * k + i * 0.065 * k, 0.13 * k], scale: [0.05 * k, 0.034 * k, 0.03 * k] });
  P(model, model.j[J.SP], mergeParts('hulkabs' + k, absP), skinD, {});
  // wild hair spikes
  const hs = [];
  for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.6; hs.push({ geo: coneGeo(0.03, 0.09, 5), pos: [Math.sin(a) * hr * 0.9, H.y0 + hr * 0.75 + Math.cos(a * 2) * 0.01, -Math.cos(a) * hr * 0.35], rot: [-0.5 + Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.7] }); }
  P(model, hj, mergeParts('hulkspikes' + hr, hs), hairM, {});
  // fists knuckles
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.WL : J.WR], sphereGeo(1, 10, 8), skinD, { pos: [0, -dims.hand * 0.78, 0.045 * k], scale: [0.06 * k, 0.035 * k, 0.04 * k] });
  return finish(model);
}

// ================================================================== THOR
export function buildThor() {
  const dims = makeDims(1.04, { headR: 0.112 });
  const rig = buildRig(dims, 1.06);
  const model = new ProcModel('thor', rig, { prof: { stance: 'relaxed', flyStyle: 'super', hover: 'thor', flipDodge: true, cadence: 0.9, stride: 1.0, lean: 1.0, throwStyle: 'one', landStyle: 'hero' } });
  const suit = withRim(phys(0x1d2230, { roughness: 0.7, normalMap: fabricNormal(5, 0.55, 'thorfab'), normalScale: new V2(0.8, 0.8), sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x6a8cff) }), 0x9fc0ff, 0.14);
  const leather = std(0x3a2a20, { roughness: 0.75, normalMap: grainNormal('leather', 5, 2.4), normalScale: new V2(0.9, 0.9) });
  const silver = withRim(phys(0xb8bec8, { roughness: 0.28, metalness: 0.95, clearcoat: 0.5, clearcoatRoughness: 0.15, normalMap: grainNormal('brushed', 3, 1.0), normalScale: new V2(0.4, 0.4) }), 0xffffff, 0.12);
  const skin = std(0xe0b090, { roughness: 0.62 });
  const info = buildBody(model, {
    mats: { default: suit, chest: suit, abdomen: suit, pelvis: leather, neck: skin, head: skin, shoulder: silver, upperArm: suit, foreArm: suit, hand: leather, thigh: suit, shin: leather, foot: leather },
    torso: { sx: 1.38, sz: 0.82, chestR: 1.12, waistR: 0.95 },
    head: { R: 0.108, sx: 0.9, sy: 1.1, sz: 1.0 },
    arm: { u0: 0.058, u1: 0.046, f0: 0.046, f1: 0.036, ub: 0.14, fb: 0.15 },
    leg: { t0: 0.09, t1: 0.062, s0: 0.062, s1: 0.042, tb: 0.1, sb: 0.12 },
    foot: [0.058, 0.05, 0.15], hand: [0.045, 0.055, 0.052], pelvis: [0.38, 0.2, 0.27], armM: 1.1,
  });
  const k = dims.k, cj = model.j[J.CH], hj = model.j[J.HD], H = info.headInfo;
  // chest armour plate + discs
  const cr = info.chestRad(0.2 * k);
  const platePts = [[0.0, 0.0001], [0.02, 0.16], [0.1, 0.175], [0.22, 0.19], [0.31, 0.175], [0.345, 0.06], [0.355, 0.0001]].map(([y, r]) => [y * k, r * k * 1.02]);
  P(model, cj, profileGeo('thorplate', platePts, 22, 18), silver, { scale: [1.4, 1, 0.88], pos: [0, 0.0, 0] });
  const disc = G('thordisc', () => new THREE.CylinderGeometry(0.036 * k, 0.036 * k, 0.014, 14));
  const discParts = [];
  for (const [yy, xs] of [[0.27, [-0.09, 0, 0.09]], [0.19, [-0.12, -0.04, 0.04, 0.12]], [0.11, [-0.07, 0.07]]]) for (const x of xs) {
    const rxx = radiusAt(platePts, yy * k) * 1.4, rzz = radiusAt(platePts, yy * k) * 0.88;
    const ang = Math.asin(clamp((x * k) / rxx, -0.95, 0.95));
    discParts.push({ geo: disc, pos: [Math.sin(ang) * rxx, yy * k, Math.cos(ang) * rzz + 0.002], rot: [Math.PI / 2, 0, 0], });
    const last = discParts[discParts.length - 1];
    // tilt to face outward
    last.rot = [Math.PI / 2, 0, 0];
  }
  P(model, cj, mergeParts('thordiscs' + k, discParts), metal(0xe2e6ec, { roughness: 0.2 }), {});
  // belt
  P(model, model.j[J.SP], cylGeo(0.155 * k, 0.16 * k, 0.05 * k, 16), leather, { pos: [0, 0.05 * k, 0], scale: [1.28, 1, 0.8] });
  P(model, model.j[J.SP], boxGeo(0.07 * k, 0.07 * k, 0.03), silver, { pos: [0, 0.05 * k, 0.125 * k] });
  // bracers
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.EL : J.ER], limbGeo(0.17 * k, 0.047 * k, 0.04 * k, 0.04, 0.4), silver, { pos: [0, -0.07 * k, 0] });
  // hair + beard
  const hair = std(0xd2a947, { roughness: 0.75 });
  const hr = H.R;
  P(model, hj, G('thorhairc', () => new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), hair, { pos: [0, H.y0 + hr * 0.12, -hr * 0.1], rot: [-0.42, 0, 0], scale: [hr * 1.07, hr * 1.1, hr * 1.12] });
  const strands = [];
  for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.0; strands.push({ geo: capsuleGeo(0.022, 0.2, 3, 6), pos: [Math.sin(a) * hr * 0.95, H.y0 - hr * 0.5 - 0.02 * Math.abs(a), -Math.cos(a) * hr * 0.9], rot: [0.12, 0, -Math.sin(a) * 0.15], scale: [1.3, 1.1 - Math.abs(a) * 0.15, 1] }); }
  P(model, hj, mergeParts('thorstrands' + hr, strands), hair, {});
  P(model, hj, sphereGeo(1, 12, 8), hair, { pos: [0, H.y0 - hr * 0.7, hr * 0.42], scale: [hr * 0.55, hr * 0.3, hr * 0.45] }); // beard
  addFace(model, H, { tex: { skin: '#e0b090', iris: '#5aa0e8', brow: '#a8802c', lip: '#a8564e', mood: 'smirk', stubble: 0.5 }, skin });
  for (const s of [1, -1]) P(model, hj, boxGeo(hr * 0.5, hr * 0.07, hr * 0.12), hair, { pos: [s * hr * 0.4, H.y0 + hr * 0.27, hr * 0.86], rot: [0.0, s * 0.25, -s * 0.12] }); // brow ridge
  // shoulder cape clasps
  for (const s of [1, -1]) P(model, cj, sphereGeo(0.032, 8, 6), silver, { pos: [s * 0.2 * k, 0.35 * k, -0.02 * k] });

  // ---- cape: one cloth mesh driven by a lagged chain
  const R = 9, C = 4, capeLen = 1.1 * k, capeW0 = 0.46 * k, capeW1 = 0.8 * k;
  const cgeo = new THREE.PlaneGeometry(1, 1, C, R);
  const cmat = std(0xa4121b, { roughness: 0.8, side: THREE.DoubleSide, metalness: 0.0, normalMap: fabricNormal(10, 0.5, 'capefab'), normalScale: new V2(0.6, 0.6) });
  const cape = new THREE.Mesh(cgeo, cmat); cape.frustumCulled = false; cape.castShadow = true;
  cj.add(cape); model.parts.push(cape); cape.userData.mat = cmat;
  const ang = new Float32Array(R + 1).fill(0.15), rol = new Float32Array(R + 1);
  const cp = new Float32Array((R + 1) * 3);
  const anchor = new V3(0, 0.34 * k, -0.16 * k);
  addHook(model, (c, m) => {
    const dt = c.dt, v = c.vl;
    const stateFly = c.st === 'fly' || c.st === 'glide' || c.st === 'zip';
    const speedK = clamp(Math.hypot(v.x, v.z) / 14, 0, 1);
    let a0 = 0.12 + clamp(v.z * 0.045, -0.1, 1.15) - clamp(v.y * 0.025, -0.9, 0.7) * (stateFly ? 0.2 : 1);
    if (c.st === 'hover' || c.st === 'idle') a0 += Math.sin(c.tm * 1.3) * 0.03;
    if (c.st === 'dead') a0 = 0.02;
    a0 = clamp(a0, -0.1, 1.9);
    const r0 = clamp(v.x * 0.03 + c.yawRate * 0.07, -0.7, 0.7);
    ang[0] += (a0 - ang[0]) * (1 - Math.exp(-10 * dt));
    rol[0] += (r0 - rol[0]) * (1 - Math.exp(-10 * dt));
    for (let i = 1; i <= R; i++) {
      const lag = 1 - Math.exp(-(15 - i * 1.15) * dt);
      ang[i] += (ang[i - 1] + Math.sin(c.tm * 6 + i * 0.9) * (0.02 + 0.07 * speedK) * (i / R) * 2 - ang[i]) * lag;
      rol[i] += (rol[i - 1] + Math.sin(c.tm * 4.3 + i * 0.7) * 0.03 * speedK - rol[i]) * lag;
    }
    let x = anchor.x, y = anchor.y, z = anchor.z;
    const seg = capeLen / R;
    for (let i = 0; i <= R; i++) {
      cp[i * 3] = x; cp[i * 3 + 1] = y; cp[i * 3 + 2] = z;
      const a = ang[i], r = rol[i];
      x += Math.sin(r) * seg; y -= Math.cos(a) * Math.cos(r) * seg; z -= Math.sin(a) * seg;
    }
    const pos = cgeo.attributes.position;
    for (let j = 0; j <= R; j++) {
      const w = lerp(capeW0, capeW1, j / R) * (1 + 0.1 * Math.sin(c.tm * 3 + j) * speedK);
      for (let i = 0; i <= C; i++) {
        const u = i / C * 2 - 1;
        const billow = -(1 - u * u) * 0.05 * k * Math.sin((j / R) * Math.PI) * (1 + speedK * 1.5) - Math.abs(u) * 0.02 * (j / R);
        const idx = j * (C + 1) + i;
        pos.setXYZ(idx, cp[j * 3] + u * w * 0.5 * Math.cos(rol[j]), cp[j * 3 + 1], cp[j * 3 + 2] + billow - (Math.sin(c.tm * 5 + j * 1.2 + u * 2) * 0.012 * speedK * (j / R)));
      }
    }
    pos.needsUpdate = true; cgeo.computeVertexNormals();
  }, () => { cgeo.dispose(); });

  // ---- Mjolnir
  const hammer = new THREE.Group();
  const mh = metal(0x9aa1ab, { roughness: 0.3 }), mdark = metal(0x4b4f58, { roughness: 0.4 }), strap = std(0x2a1d14, { roughness: 0.8 });
  const parts = [];
  const head = new THREE.Mesh(boxGeo(0.34, 0.17, 0.17), mh); head.position.y = 0.17; hammer.add(head);
  for (const s of [1, -1]) { const e = new THREE.Mesh(boxGeo(0.04, 0.2, 0.2), mdark); e.position.set(s * 0.17, 0.17, 0); hammer.add(e); }
  const band = new THREE.Mesh(boxGeo(0.12, 0.175, 0.175), mdark); band.position.y = 0.17; hammer.add(band);
  const handle = new THREE.Mesh(cylGeo(0.022, 0.022, 0.38, 8), strap); handle.position.y = -0.05; hammer.add(handle);
  const cap = new THREE.Mesh(sphereGeo(0.032, 8, 6), mdark); cap.position.y = -0.24; hammer.add(cap);
  const loop = new THREE.Mesh(G('hammerloop', () => new THREE.TorusGeometry(0.035, 0.007, 6, 12)), strap); loop.position.set(0, -0.27, 0); hammer.add(loop);
  hammer.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  const hw = 0.82;
  let spinA = 0, spinK = 0;
  model.hammerSpin = false;
  addHook(model, (c) => { // hammer twirl while summoning (cast) or on demand
    const want = model.hammerAttached && (model.hammerSpin || c.st === 'cast') ? 1 : 0;
    spinK += (want - spinK) * (1 - Math.exp(-10 * c.dt));
    if (spinK > 0.02) { spinA += c.dt * 16 * spinK; hammer.rotation.set(Math.PI - 0.15, spinA, 0.1); } else if (spinK > 0 && model.hammerAttached) place();
  });
  const grip = { pos: new V3(0, -0.2 * hw, 0.0), rot: new THREE.Euler(Math.PI - 0.15, 0, 0.1) };
  const place = () => { hammer.position.copy(grip.pos); hammer.rotation.copy(grip.rot); hammer.scale.setScalar(hw); };
  model.handR.add(hammer); place();
  model.hammer = hammer;
  model.hammerAttached = true;
  // detach: hides the in-hand hammer and returns a world-space clone (not added to any scene) for the hero to use
  model.detachHammer = () => {
    model.group.updateMatrixWorld(true);
    const c = hammer.clone(true);
    hammer.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    hammer.visible = false; model.hammerAttached = false;
    return c;
  };
  model.attachHammer = () => { hammer.visible = true; model.hammerAttached = true; return hammer; };
  return finish(model);
}

// ================================================================== VENOM
export function buildVenom() {
  const dims = makeDims(1.3, { headR: 0.165, neck: 0.14 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('venom', rig, { prof: { stance: 'hulk', cadence: 0.82, stride: 1.05, armSwing: 1.1, lean: 1.35, bob: 1.6, flipDodge: false, wide: 0.1, tempo: 0.95 } });
  const vn = grainNormal('venom', 9, 3.2);
  const sym = symMat({ id: 'venom', color: 0x040407, rim: 0x2f6bff, rimK: 0.75, rough: 0.16, normalMap: vn, normalScale: 0.9 });
  const info = buildBody(model, {
    mats: { default: sym },
    torso: { sx: 1.5, sz: 1.0, chestR: 1.28, waistR: 0.85 },
    head: { R: 0.165, sx: 1.25, sy: 1.0, sz: 1.1 },
    arm: { u0: 0.06, u1: 0.048, f0: 0.052, f1: 0.04, ub: 0.28, fb: 0.3, shoulder: 1.45 },
    leg: { t0: 0.09, t1: 0.066, s0: 0.066, s1: 0.045, tb: 0.25, sb: 0.28 },
    armM: 1.6, foreM: 1.8, legM: 1.2, neckR: 0.08,
    foot: [0.066, 0.05, 0.17], hand: [0.066, 0.075, 0.075], pelvis: [0.42, 0.22, 0.28],
  });
  const k = dims.k, hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  // eyes: huge jagged white
  const eyeM = std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.2 });
  addEyes(model, H, 'venom', eyeM, null, { grow: 1.1, dy: -0.01, lift: 0.012, depth: 0.01, dx: 0.0 });
  // mouth cavity
  const mouth = std(0x1a0508, { roughness: 0.6 });
  P(model, hj, sphereGeo(1, 16, 10), mouth, { pos: [0, H.y0 - hr * 0.5, hr * H.sz * 0.78], scale: [hr * H.sx * 0.92, hr * 0.3, hr * 0.32], cast: false });
  // teeth: arcs of cones
  const teeth = [], rg = rng(5);
  const N = 13;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1) * 2 - 1, phi = u * 1.05;
    const x = Math.sin(phi) * hr * H.sx * 1.0, z = Math.cos(phi) * hr * H.sz * 1.0 * 0.96;
    const yU = H.y0 - hr * 0.36 + u * u * hr * 0.2, yL = H.y0 - hr * 0.66 + u * u * hr * 0.2;
    const sz = (0.026 + rg() * 0.018) * (1 - Math.abs(u) * 0.3);
    teeth.push({ geo: coneGeo(0.011, sz * 1.6, 5), pos: [x, yU - sz * 0.5, z * 0.97 + 0.0], rot: [Math.PI + 0.1, -phi, 0] });
    teeth.push({ geo: coneGeo(0.011, sz * 1.5, 5), pos: [x, yL + sz * 0.5, z * 0.97 + 0.0], rot: [-0.1, -phi, 0] });
  }
  P(model, hj, mergeParts('venomteeth', teeth), std(0xf2efe4, { roughness: 0.35 }), { cast: false });
  // inner teeth row + gum ridge
  const t2 = [];
  for (let i = 0; i < 9; i++) { const u = i / 8 * 2 - 1, phi = u * 0.85; t2.push({ geo: coneGeo(0.008, 0.03, 4), pos: [Math.sin(phi) * hr * H.sx * 0.86, H.y0 - hr * 0.42 + u * u * hr * 0.15, Math.cos(phi) * hr * H.sz * 0.82], rot: [Math.PI + 0.15, -phi, 0] }); }
  P(model, hj, mergeParts('venomteeth2', t2), std(0xe4e0d0, { roughness: 0.4 }), { cast: false });
  // tongue
  const tongueMat = std(0xb01020, { roughness: 0.35, emissive: 0x300004, emissiveIntensity: 0.4 });
  const tongue = new Tendril({ segs: 14, radial: 6, r0: 0.026, r1: 0.007, material: tongueMat, ref: new V3(0, 1, 0) });
  hj.add(tongue.mesh);
  // brow ridge + head spikes
  for (const s of [1, -1]) P(model, hj, boxGeo(hr * 0.9, hr * 0.12, hr * 0.5), sym, { pos: [s * hr * 0.5, H.y0 + hr * 0.62, hr * 0.78], rot: [0.1, 0, -s * 0.3] });
  // claws
  for (const s of [1, -1]) {
    const cl = [];
    for (let i = -1; i <= 1; i++) cl.push({ geo: coneGeo(0.013 * k, 0.11 * k, 5), pos: [i * 0.03 * k, -0.075 * k, 0.045 * k], rot: [Math.PI + 0.35, 0, i * 0.12] });
    cl.push({ geo: coneGeo(0.013 * k, 0.09 * k, 5), pos: [-s * 0.052 * k, -0.04 * k, 0.03 * k], rot: [Math.PI + 0.5, 0, -s * 0.8] });
    P(model, model.j[s > 0 ? J.WL : J.WR], mergeParts('venomclaw' + (s > 0 ? 'L' : 'R') + k, cl), std(0xe8e6dc, { roughness: 0.3 }), { pos: [0, -dims.hand * 0.5, 0] });
  }
  // spikes along forearms / shoulders / back
  const sp = [];
  for (let i = 0; i < 4; i++) sp.push({ geo: coneGeo(0.016 * k, 0.09 * k, 5), pos: [0.0, -0.05 * k - i * 0.055 * k, -0.045 * k], rot: [-2.6, 0, 0] });
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.EL : J.ER], mergeParts('venomforespike' + k, sp), sym, { pos: [s * 0.0, 0.0, 0.0] });
  const bs = [];
  for (let i = 0; i < 5; i++) bs.push({ geo: coneGeo(0.03 * k, 0.16 * k, 5), pos: [0, (0.05 + i * 0.065) * k, -0.135 * k - Math.sin(i / 4 * 3) * 0.02], rot: [-2.2, 0, 0] });
  P(model, model.j[J.CH], mergeParts('venombackspikes' + k, bs), sym, {});
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.AL : J.AR], coneGeo(0.035 * k, 0.2 * k, 6), sym, { pos: [s * 0.04 * k, 0.1 * k, -0.02], rot: [0.1, 0, -s * 0.9] });
  // chest emblem
  const cr = info.chestRad(0.22 * k);
  const embM = std(0xffffff, { map: emblemTexture('#ffffff'), transparent: true, alphaTest: 0.4, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25, side: THREE.DoubleSide });
  P(model, model.j[J.CH], curvedPlane(0.34 * k, 0.34 * k, cr.rx, cr.rz, 0.006), embM, { pos: [0, 0.2 * k, 0], cast: false });
  // back tendrils
  const tends = [];
  const tm = symMat({ id: 'venomt', color: 0x040407, rim: 0x2f6bff, rimK: 0.75, rough: 0.16, normalMap: vn, normalScale: 0.9 });
  const roots = [[0.14, 0.3, -0.12, 0.9, 0.45, -0.7], [-0.14, 0.3, -0.12, -0.9, 0.45, -0.7], [0.08, 0.15, -0.14, 0.7, 0.0, -1.0], [-0.08, 0.15, -0.14, -0.7, 0.0, -1.0], [0.0, 0.34, -0.12, 0.0, 0.7, -0.8]];
  roots.forEach((r, i) => {
    const t = new Tendril({ segs: 16, radial: 6, r0: 0.075 * k * 0.8, r1: 0.014, material: tm, ref: new V3(0, 1, 0) });
    model.j[J.CH].add(t.mesh); tends.push({ t, r, ph: i * 1.7 });
  });
  addHook(model, (c, m) => {
    const sp2 = Math.hypot(c.vl.x, c.vl.z), len = 1.0 * k * 0.7;
    for (const { t, r, ph } of tends) {
      const rage = c.st.startsWith('punch') || c.st === 'smash' || c.st === 'cast' || c.st === 'throw' ? 1 : 0.3;
      t.update((u, out) => {
        const w1 = Math.sin(c.tm * (2.0 + rage * 3) + ph + u * 5.5) * 0.14 * u * (0.6 + rage), w2 = Math.cos(c.tm * 1.6 + ph * 1.3 + u * 4) * 0.1 * u;
        const dir = new V3(r[3], r[4], r[5]).normalize();
        out.set(r[0] + dir.x * len * u + w1, r[1] + dir.y * len * u * (1 - 0.65 * u) + w2 + u * u * 0.2 * (1 - rage), r[2] + dir.z * len * u - sp2 * 0.012 * u * u);
      });
    }
    // tongue
    const out = c.st === 'dead' ? 0.4 : 1;
    tongue.update((u, o) => {
      o.set(Math.sin(c.tm * 7 + u * 6) * 0.02 * u, H.y0 - hr * 0.55 - u * 0.2 * out + Math.sin(c.tm * 3 + u * 4) * 0.02 * u, hr * H.sz * 0.88 + u * 0.22 * out);
    });
  }, () => { tends.forEach((x) => x.t.dispose()); tongue.dispose(); });
  return finish(model);
}

// ================================================================== GOON (symbiote-infected thug)
const GOON_STYLES = [
  { top: 0x585d68, top2: 0x484c56, legs: 0x2a3550, shoes: 0xe8e8e8, hat: 'beanie', hatC: 0x1d1d22, skin: 0xc79a77, name: 'hoodie' },
  { top: 0x86201f, top2: 0x6e1a1a, legs: 0x16161a, shoes: 0x141414, hat: 'hair', hatC: 0x15110d, skin: 0x8d5d3f, name: 'jacket' },
  { top: 0x7d6f4a, top2: 0x665a3a, legs: 0x47688f, shoes: 0x3a2a20, hat: 'hood', hatC: 0x7d6f4a, skin: 0xe2b999, name: 'tan' },
];
export function buildGoon(opts = {}) {
  let vi = opts.variant;
  if (typeof vi === 'string') vi = ['a', 'b', 'c'].indexOf(vi) >= 0 ? ['a', 'b', 'c'].indexOf(vi) : GOON_STYLES.findIndex((s) => s.name === vi);
  if (!(vi >= 0 && vi < 3)) vi = Math.floor(Math.random() * 3);
  const st = GOON_STYLES[vi];
  const rnd = rng((Math.random() * 1e9) | 0);
  const kk = 0.98 + rnd() * 0.1;
  const dims = makeDims(kk * 0.96, { headR: 0.108 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('goon', rig, { prof: { stance: 'thug', cadence: 0.95, stride: 0.95, armSwing: 0.9, lean: 1.1, flipDodge: false } });
  const fn = fabricNormal(6, 0.55, 'goonfab'), fnS = new V2(0.7, 0.7);
  const top = std(st.top, { roughness: 0.85, normalMap: fn, normalScale: fnS }), top2 = std(st.top2, { roughness: 0.85, normalMap: fn, normalScale: fnS });
  const legs = std(st.legs, { roughness: 0.85, normalMap: fn, normalScale: fnS }), shoes = std(st.shoes, { roughness: 0.6, normalMap: grainNormal('leather', 5, 2.4), normalScale: fnS }), skin = std(st.skin, { roughness: 0.7 });
  const sym = symMat({ id: 'goon', rim: 0x4a3aff, rimK: 0.7 });
  const info = buildBody(model, {
    mats: { default: top, chest: top, abdomen: top2, pelvis: legs, neck: skin, head: skin, shoulder: top, upperArm: top, foreArm: top2, hand: skin, thigh: legs, shin: legs, foot: shoes },
    torso: { sx: 1.28, sz: 0.82, chestR: 1.06, waistR: 1.05 },
    head: { R: 0.108, sx: 0.92, sy: 1.08, sz: 1.0 },
    arm: { u0: 0.054, u1: 0.046, f0: 0.044, f1: 0.036, ub: 0.08, fb: 0.1 },
    leg: { t0: 0.088, t1: 0.062, s0: 0.062, s1: 0.045, tb: 0.06, sb: 0.06 },
    foot: [0.058, 0.05, 0.15], hand: [0.04, 0.052, 0.048], pelvis: [0.38, 0.22, 0.27],
  });
  const hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  // headwear
  const hatM = std(st.hatC, { roughness: 0.9 });
  if (st.hat === 'beanie') P(model, hj, G('goonbeanie', () => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), hatM, { pos: [0, H.y0 + hr * 0.25, 0], scale: [hr * 1.08, hr * 1.0, hr * 1.1] });
  else if (st.hat === 'hair') P(model, hj, G('goonhair', () => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42)), hatM, { pos: [0, H.y0 + hr * 0.3, -hr * 0.05], scale: [hr * 1.04, hr * 1.0, hr * 1.08] });
  else P(model, hj, G('goonhood', () => new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72)), hatM, { pos: [0, H.y0 + hr * 0.12, -hr * 0.12], scale: [hr * 1.18, hr * 1.2, hr * 1.2] });
  // jaw / nose / ears + brow (symbiote-bright eyes stay)
  addFace(model, H, { tex: { skin: '#' + st.skin.toString(16).padStart(6, '0'), eyes: false, brows: true, brow: '#1a120c', mood: 'angry', stubble: 0.6 }, skin });
  // glowing eyes
  const eyeM = glow(0xf4f8ff, 2.6);
  addEyes(model, H, 'goon', eyeM, null, { grow: 1.5, dy: 0.02, lift: 0.007, depth: 0.004 });
  // symbiote patches (random per instance, shared geometry / material)
  const placements = [
    [J.CH, [0.12, 0.2, 0.1], [0.07, 0.05, 0.03]], [J.CH, [-0.14, 0.12, 0.08], [0.05, 0.08, 0.03]], [J.AL, [0.0, -0.1, 0.0], [0.05, 0.1, 0.05]],
    [J.ER, [0, -0.12, 0.0], [0.045, 0.09, 0.045]], [J.HD, [-0.07, H.y0 + 0.02, 0.07], [0.06, 0.07, 0.03]], [J.KL, [0, -0.15, 0.05], [0.05, 0.07, 0.04]], [J.CH, [0.0, 0.33, -0.1], [0.09, 0.05, 0.05]],
  ];
  const nP = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < nP; i++) {
    const pl = placements[(i + Math.floor(rnd() * 7)) % placements.length];
    P(model, model.j[pl[0]], sphereGeo(1, 10, 8), sym, { pos: pl[1], scale: pl[2], rot: [rnd(), rnd(), rnd()] });
  }
  // spike & claws on one hand
  const sp = [];
  for (let i = 0; i < 3; i++) sp.push({ geo: coneGeo(0.012, 0.1, 5), pos: [(i - 1) * 0.025, -0.07, 0.03], rot: [Math.PI + 0.4, 0, (i - 1) * 0.15] });
  P(model, model.j[J.WR], mergeParts('goonclaw', sp), sym, { pos: [0, -dims.hand * 0.5, 0] });
  P(model, model.j[J.AL], coneGeo(0.035, 0.18, 5), sym, { pos: [0.03, 0.08, 0], rot: [0, 0, -0.9] });
  if (rnd() < 0.5) P(model, model.j[J.AR], coneGeo(0.03, 0.14, 5), sym, { pos: [-0.03, 0.07, 0], rot: [0, 0, 0.9] });
  if (kk !== 1) rig.group.scale.setScalar(1);
  return finish(model);
}

// ================================================================== HUNTER (Kraven's hunters)
export function buildHunter() {
  const dims = makeDims(0.99, { headR: 0.108 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('hunter', rig, { prof: { stance: 'rifle', cadence: 1.0, stride: 1.0, armSwing: 0.4, lean: 1.0, flipDodge: false, shoot: 'rifle', aimStyle: 'gun' } });
  const hn = fabricNormal(6, 0.55, 'hunfab'), hnS = new V2(0.8, 0.8);
  const camo = std(0xffffff, { map: camoTexture(), roughness: 0.9, normalMap: hn, normalScale: hnS });
  const khaki = std(0x8b7d56, { roughness: 0.9, normalMap: hn, normalScale: hnS });
  const leo = std(0xffffff, { map: leopardTexture(), roughness: 0.85 });
  const dk = std(0x2b2a22, { roughness: 0.9 });
  const leather = std(0x3b2b1c, { roughness: 0.75, normalMap: grainNormal('leather', 5, 2.4), normalScale: hnS });
  const skin = std(0xc89c78, { roughness: 0.7 });
  const info = buildBody(model, {
    mats: { default: khaki, chest: khaki, abdomen: khaki, pelvis: camo, neck: skin, head: dk, shoulder: khaki, upperArm: khaki, foreArm: khaki, hand: leather, thigh: camo, shin: camo, foot: leather },
    torso: { sx: 1.26, sz: 0.8, chestR: 1.04, waistR: 0.95 },
    head: { R: 0.108, sx: 0.92, sy: 1.08, sz: 1.0 },
    arm: { u0: 0.053, u1: 0.044, f0: 0.043, f1: 0.035, ub: 0.08, fb: 0.1 },
    leg: { t0: 0.086, t1: 0.06, s0: 0.06, s1: 0.045, tb: 0.06, sb: 0.06 },
    foot: [0.058, 0.055, 0.16], hand: [0.04, 0.052, 0.05], pelvis: [0.38, 0.2, 0.27],
  });
  const k = dims.k, hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  // tactical vest (slightly larger shell) with leopard accents
  const vestPts = [[0.02, 0.0001], [0.04, 0.155], [0.14, 0.18], [0.26, 0.18], [0.31, 0.14], [0.325, 0.0001]].map(([y, r]) => [y * k, r * k * 1.02]);
  P(model, cj, profileGeo('hunterVest', vestPts, 20, 14), dk, { scale: [1.3, 1, 0.86] });
  P(model, cj, profileGeo('hunterVestLeo', [[0.28, 0.0001], [0.285, 0.185], [0.33, 0.19], [0.36, 0.15], [0.37, 0.0001]].map(([y, r]) => [y * k, r * k]), 20, 10), leo, { scale: [1.35, 1, 0.95] }); // fur collar
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.AL : J.AR], sphereGeo(0.075, 12, 8), leo, { pos: [s * 0.02, 0.03, 0], scale: [1.1, 0.8, 1.1] }); // leopard shoulder pads
  // pouches + belt
  const cr = info.chestRad(0.15 * k);
  const pouches = [];
  for (const x of [-0.12, -0.04, 0.04, 0.12]) pouches.push({ geo: boxGeo(0.06 * k, 0.08 * k, 0.04 * k), pos: [x * k * 1.3, 0.13 * k, cr.rz * 0.98], rot: [0, x * 1.5, 0] });
  P(model, cj, mergeParts('hunterpouch' + k, pouches), leather, {});
  P(model, model.j[J.SP], cylGeo(0.14 * k, 0.15 * k, 0.05 * k, 14), leather, { pos: [0, 0.06 * k, 0], scale: [1.28, 1, 0.82] });
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.TL : J.TR], boxGeo(0.06, 0.12, 0.08), leather, { pos: [s * 0.08, -0.16 * k, 0.02] }); // thigh pouches
  // knee pads
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.KL : J.KR], sphereGeo(0.05, 8, 6), dk, { pos: [0, 0.0, 0.035], scale: [1, 1, 0.8] });
  // helmet / mask + goggles
  const hood = G('hunterhood', () => new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.78));
  P(model, hj, hood, camo, { pos: [0, H.y0 + hr * 0.1, -hr * 0.03], scale: [hr * 1.06, hr * 1.1, hr * 1.1] });
  P(model, hj, sphereGeo(1, 12, 8), dk, { pos: [0, H.y0 - hr * 0.55, hr * 0.42], scale: [hr * 0.7, hr * 0.5, hr * 0.62] }); // lower-face mask
  const gogM = glow(0xffc040, 1.8);
  for (const s of [1, -1]) {
    P(model, hj, cylGeo(0.036, 0.036, 0.03, 12), dk, { pos: [s * hr * 0.4, H.y0 + hr * 0.1, hr * 0.88], rot: [Math.PI / 2, 0, 0] });
    P(model, hj, cylGeo(0.029, 0.029, 0.035, 12), gogM, { pos: [s * hr * 0.4, H.y0 + hr * 0.1, hr * 0.9], rot: [Math.PI / 2, 0, 0], cast: false });
  }
  P(model, hj, boxGeo(hr * 1.9, 0.02, 0.02), dk, { pos: [0, H.y0 + hr * 0.1, hr * 0.15] }); // goggle strap hint
  // leopard cap band
  P(model, hj, G('hunterband', () => new THREE.TorusGeometry(1, 0.1, 6, 20)), leo, { pos: [0, H.y0 + hr * 0.5, 0], scale: [hr * 0.95, hr * 0.95, hr * 0.95], rot: [Math.PI / 2, 0, 0] });

  // rifle (attached to chest, arms IK to grips)
  const rifle = new THREE.Group();
  const gun = std(0x23252a, { roughness: 0.5, metalness: 0.6 });
  const body = new THREE.Mesh(boxGeo(0.07, 0.1, 0.46), gun); body.position.set(0, 0, 0.1); rifle.add(body);
  const barrel = new THREE.Mesh(cylGeo(0.012, 0.014, 0.5, 8), gun); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015, 0.58); rifle.add(barrel);
  const stock = new THREE.Mesh(boxGeo(0.06, 0.12, 0.22), leather); stock.position.set(0, -0.015, -0.24); rifle.add(stock);
  const scope = new THREE.Mesh(cylGeo(0.02, 0.02, 0.2, 8), gun); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.085, 0.12); rifle.add(scope);
  const mag = new THREE.Mesh(boxGeo(0.04, 0.12, 0.06), gun); mag.position.set(0, -0.1, 0.12); rifle.add(mag);
  const grip = new THREE.Mesh(boxGeo(0.035, 0.1, 0.04), leather); grip.position.set(0, -0.09, -0.05); grip.rotation.x = 0.3; rifle.add(grip);
  rifle.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.015, 0.84); rifle.add(muzzle);
  cj.add(rifle);
  model.rifle = rifle; model.muzzle = muzzle;
  model.rifleCfg = {
    node: rifle,
    gripR: new V3(0, -0.07, -0.05), gripL: new V3(0, -0.03, 0.36),
    carry: { pos: [-0.1 * k, 0.12 * k, 0.2 * k], rot: [0.5, 0.3] },
    aim: { pos: [-0.12 * k, 0.285 * k, 0.2 * k], rot: [0.0, 0.05] },
  };
  return finish(model);
}
