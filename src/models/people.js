// Street people for the GTA-style city: 'civilian' (10+ looks) and 'cop'.
// Cheap by construction: ONE shared vertex-coloured material, merged geometries cached by look
// (hi LOD <= 16 meshes, opts.lod='low' <= 7 meshes), no per-frame allocations (plain ProcModel rig, no hooks).
import * as THREE from 'three';
import { buildRig, makeDims, ProcModel, J } from './rig.js';
import { G, M, limbGeo, profileGeo, mergeColored } from './common.js';

const V3 = THREE.Vector3;
const SKIN = [0xf1d0b5, 0xe2b48c, 0xc68e63, 0xa46a45, 0x7b4a2e, 0x52331f];
const HAIR = [0x15110d, 0x3b2615, 0x6b4423, 0xa77a3a, 0xbdb6aa, 0x7a2e1f, 0xd8c27a];
const pick = (a, r) => a[Math.floor(r * a.length) % a.length];

export const CIVILIAN_VARIANTS = ['suit', 'hoodie', 'jacket', 'dress', 'delivery', 'jogger', 'tourist', 'hivis', 'student', 'elder'];
// per-variant definition. arrays = alternative colours (chosen by opts.alt / random)
const DEFS = {
  suit: { top: [0x23262e, 0x3a3f4a, 0x1c2a45], under: 0xf2f2f2, tie: [0xa01820, 0x1c3a8c, 0x2a6a3a], pants: 'top', shoes: 0x111111, hair: ['short', 'short', 'bald'], sleeve: 'long', k: [0.98, 1.02], w: 1.0, item: 'case', collar: true },
  hoodie: { top: [0x585d68, 0x7a3b3b, 0x2f4a6a], pants: [0x2a3550, 0x222226, 0x3a3a40], shoes: 0xe8e8e8, hair: ['hood'], sleeve: 'long', k: [0.95, 1.03], w: 1.02, item: 'hood' },
  jacket: { top: [0x86201f, 0x2f5a3a, 0x6a4a2a], under: 0x2a2a30, pants: [0x16161a, 0x2a3a58], shoes: 0x1a1a1a, hair: ['short', 'long', 'pony'], sleeve: 'long', k: [0.94, 1.04], w: 1.04 },
  dress: { top: [0xc83a6a, 0x3a6ac8, 0xe8c840, 0x6a3ab0], pants: 'top', shoes: 0x7a2a3a, hair: ['long', 'bun', 'pony'], sleeve: 'none', k: [0.9, 0.97], w: 0.88, item: 'skirt', female: true },
  delivery: { top: [0x2c9a4a, 0xe8742a, 0x2a7ad0], pants: [0x222833], shoes: 0x2a2a2a, hair: ['cap'], sleeve: 'short', k: [0.95, 1.03], w: 1.0, item: 'box', hat: 'cap' },
  jogger: { top: [0xe84a2a, 0x2aa8e8, 0xf0f0f0], pants: [0x181820, 0x2a2a5a], shoes: 0xf2f2f2, hair: ['pony', 'short', 'headband'], sleeve: 'none', k: [0.94, 1.02], w: 0.92, item: 'shorts' },
  tourist: { top: [0x1aa8a0, 0xf0a030, 0xe05a8a], pants: [0xb8a888, 0xd8d0b8], shoes: 0xf0f0f0, hair: ['sunhat'], sleeve: 'short', k: [0.93, 1.03], w: 1.08, item: 'camera', spots: true },
  hivis: { top: [0xc8e620, 0xf08a1c], under: 0x55575c, pants: [0x39404a, 0x4a4030], shoes: 0x6a4a2a, hair: ['hardhat'], sleeve: 'long', k: [0.98, 1.05], w: 1.1, item: 'vest', hat: 'hardhat' },
  student: { top: [0x4a6ab0, 0xb04a6a, 0x4ab08a], pants: [0x2a3550, 0x3a3a40], shoes: 0xe0e0e0, hair: ['short', 'pony', 'long'], sleeve: 'long', k: [0.9, 1.0], w: 0.94, item: 'pack' },
  elder: { top: [0x7a6a58, 0x587a68], under: 0xe8e0d0, pants: [0x4a4a52], shoes: 0x2a2018, hair: ['bald', 'grey'], sleeve: 'long', k: [0.9, 0.96], w: 1.0, stoop: true },
};

const pedMat = () => M('pedMat', () => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  return m;
});

const sph = (a = 8, b = 6) => G(`ps${a}_${b}`, () => new THREE.SphereGeometry(1, a, b));
const bx = () => G('pbox', () => new THREE.BoxGeometry(1, 1, 1));
const cyl = (n = 8) => G('pcyl' + n, () => new THREE.CylinderGeometry(1, 1, 1, n));
const dome = (n = 10) => G('pdome' + n, () => new THREE.SphereGeometry(1, n, Math.ceil(n / 2), 0, Math.PI * 2, 0, Math.PI * 0.5));
const cone = (n = 6) => G('pcone' + n, () => new THREE.ConeGeometry(1, 1, n));

function limb(len, r0, r1, seg, color, extra = {}) { return { geo: limbGeo(len, r0, r1, extra.b ?? 0.08, 0.3, seg), color, ...extra.p }; }

/** returns { head, torso, pelvis, upperArm[2], foreArm[2], thigh[2], shin[2], foot[2] } geometry parts for a hi-LOD look; or { body, arm, leg } for low */
function buildSet(def, st, lod) {
  const { k, w, skin, hair, top, under, tie, pants, shoes, hairStyle, kind } = st;
  const d = makeDims(k, { headR: 0.105 });
  const low = lod === 'low', S = low ? 6 : 8;
  const slv = def.sleeve ?? 'long';
  const sk = skin;
  const female = !!def.female, tall = k;
  const sx = (female ? 1.02 : 1.18) * w, sz = female ? 0.7 : 0.76;
  const stoop = def.stoop ? 0.05 : 0;
  // ---- torso profile (chest-joint space; goes down through the abdomen to the hips)
  const prof = [[-0.2, 0.0001], [-0.19, 0.115], [-0.05, 0.12], [0.08, 0.14], [0.2, 0.165], [0.29, 0.165], [0.33, 0.125], [0.36, 0.08], [0.395, 0.0001]].map(([y, r]) => [y * k, r * k]);
  const torsoGeo = profileGeo(`ptorso${k}_${S}`, prof, S + 4, 12);
  const torsoParts = [];
  const torsoCol = top;
  torsoParts.push({ geo: torsoGeo, color: torsoCol, scale: [sx, 1, sz] });
  const hr = d.headR;
  const y0 = hr * 1.05 * 0.95; // matches rig head origin offset used below
  const out = {};
  const rad = 0.165 * k;
  // detail on torso
  if (def.collar) torsoParts.push({ geo: bx(), color: under, pos: [0, 0.3 * k, 0.1 * k * sz * 1.1], scale: [0.09 * k, 0.16 * k, 0.012], rot: [0.05, 0, 0] }, { geo: bx(), color: tie, pos: [0, 0.2 * k, 0.125 * k], scale: [0.025 * k, 0.2 * k, 0.012] });
  if (under && !def.collar && kind !== 'dress') torsoParts.push({ geo: cyl(8), color: under, pos: [0, 0.345 * k, 0], scale: [0.075 * k, 0.04 * k, 0.065 * k] });
  if (def.item === 'vest') { // hi-vis stripes + vest panels
    for (const yy of [0.12, 0.26]) torsoParts.push({ geo: cyl(S + 4), color: 0xdfe3e8, pos: [0, yy * k, 0], scale: [rad * sx * 1.03, 0.025 * k, rad * sz * 1.03] });
  }
  if (def.item === 'box') torsoParts.push({ geo: bx(), color: 0x1c1c1c, pos: [0, 0.16 * k, -0.17 * k], scale: [0.26 * k, 0.3 * k, 0.17 * k] }, { geo: bx(), color: top, pos: [0, 0.16 * k, -0.17 * k], scale: [0.262 * k, 0.1 * k, 0.172 * k] });
  if (def.item === 'pack') torsoParts.push({ geo: bx(), color: st.packCol, pos: [0, 0.17 * k, -0.15 * k], scale: [0.22 * k, 0.28 * k, 0.11 * k] });
  if (def.item === 'camera') torsoParts.push({ geo: bx(), color: 0x151518, pos: [0.05 * k, 0.06 * k, 0.13 * k], scale: [0.09 * k, 0.065 * k, 0.05 * k] }, { geo: cyl(6), color: 0x30303a, pos: [0.05 * k, 0.06 * k, 0.17 * k], scale: [0.02 * k, 0.02 * k, 0.02 * k], rot: [Math.PI / 2, 0, 0] });
  if (def.spots) for (let i = 0; i < 9; i++) torsoParts.push({ geo: sph(5, 4), color: 0xf4f4e8, pos: [Math.sin(i * 2.3) * 0.16 * k, (0.0 + (i % 5) * 0.07) * k, Math.cos(i * 2.3) * 0.12 * k * (i < 6 ? 1 : -1)], scale: 0.018 * k });
  if (kind === 'cop') {
    torsoParts.push({ geo: bx(), color: 0xd8b84a, pos: [0.075 * k, 0.24 * k, 0.118 * k], scale: [0.032 * k, 0.04 * k, 0.012] }, // badge
      { geo: bx(), color: 0x222428, pos: [-0.12 * k * sx, 0.33 * k, 0.0], scale: [0.04 * k, 0.05 * k, 0.04 * k] }, // radio
      { geo: bx(), color: 0x0e0e12, pos: [0, 0.2 * k, 0.126 * k], scale: [0.022 * k, 0.17 * k, 0.012] }); // tie
  }
  if (def.hood || def.item === 'hood') torsoParts.push({ geo: sph(7, 5), color: top, pos: [0, 0.37 * k, -0.07 * k], scale: [0.1 * k, 0.05 * k, 0.07 * k] });
  // belt
  if (kind === 'cop' || def.item === 'vest' || def.item === 'skirt' === false) torsoParts.push({ geo: cyl(S + 4), color: kind === 'cop' ? 0x0c0c10 : 0x3a2a1e, pos: [0, -0.1 * k, 0], scale: [0.135 * k * sx, 0.03 * k, 0.135 * k * sz] });
  // neck (skin)
  torsoParts.push({ geo: cyl(7), color: sk, pos: [0, 0.39 * k, 0], scale: [0.045 * k, 0.06 * k, 0.045 * k] });
  // ---- head (head-joint space; origin at neck top)
  const headParts = [];
  headParts.push({ geo: sph(low ? 8 : 12, low ? 6 : 9), color: sk, pos: [0, y0, 0], scale: [hr * 0.92, hr * 1.06, hr] });
  if (!low) {
    for (const s of [1, -1]) headParts.push({ geo: sph(5, 4), color: 0x120e0c, pos: [s * hr * 0.38, y0 + hr * 0.05, hr * 0.9], scale: [hr * 0.09, hr * 0.07, hr * 0.06] });
    headParts.push({ geo: sph(5, 4), color: sk, pos: [0, y0 - hr * 0.15, hr * 0.97], scale: [hr * 0.13, hr * 0.17, hr * 0.15] });
    for (const s of [1, -1]) headParts.push({ geo: sph(5, 4), color: sk, pos: [s * hr * 0.9, y0 - hr * 0.05, -hr * 0.05], scale: [hr * 0.08, hr * 0.2, hr * 0.12] });
  }
  const hc = hair;
  const hs = hairStyle;
  const cap = (col, lift = 0.1) => headParts.push({ geo: dome(low ? 8 : 12), color: col, pos: [0, y0 + hr * lift, -hr * 0.03], scale: [hr * 0.98, hr * 1.1, hr * 1.04] });
  if (hs === 'short' || hs === 'grey') cap(hs === 'grey' ? 0xc8c4bc : hc, 0.12);
  else if (hs === 'long') { cap(hc, 0.1); headParts.push({ geo: sph(7, 5), color: hc, pos: [0, y0 - hr * 0.55, -hr * 0.5], scale: [hr * 0.92, hr * 1.5, hr * 0.5] }); }
  else if (hs === 'bun') { cap(hc, 0.1); headParts.push({ geo: sph(6, 5), color: hc, pos: [0, y0 + hr * 0.95, -hr * 0.55], scale: hr * 0.4 }); }
  else if (hs === 'pony') { cap(hc, 0.1); headParts.push({ geo: sph(6, 5), color: hc, pos: [0, y0 - hr * 0.4, -hr * 0.8], scale: [hr * 0.28, hr * 1.0, hr * 0.28] }); }
  else if (hs === 'headband') { cap(hc, 0.12); headParts.push({ geo: cyl(10), color: 0xe8e8ee, pos: [0, y0 + hr * 0.42, 0], scale: [hr * 0.97, hr * 0.12, hr * 1.02] }); }
  else if (hs === 'hood') { headParts.push({ geo: dome(low ? 8 : 12), color: top, pos: [0, y0 + hr * 0.05, -hr * 0.1], scale: [hr * 1.12, hr * 1.18, hr * 1.2] }); }
  else if (hs === 'cap') { cap(hc, 0.1); headParts.push({ geo: dome(low ? 8 : 12), color: top, pos: [0, y0 + hr * 0.3, 0], scale: [hr * 1.02, hr * 0.8, hr * 1.06] }, { geo: bx(), color: top, pos: [0, y0 + hr * 0.38, hr * 1.05], scale: [hr * 0.9, hr * 0.06, hr * 0.6] }); }
  else if (hs === 'hardhat') { headParts.push({ geo: dome(low ? 8 : 12), color: 0xf0c420, pos: [0, y0 + hr * 0.3, 0], scale: [hr * 1.08, hr * 0.95, hr * 1.12] }, { geo: cyl(low ? 8 : 12), color: 0xf0c420, pos: [0, y0 + hr * 0.3, hr * 0.1], scale: [hr * 1.2, hr * 0.06, hr * 1.3] }); }
  else if (hs === 'sunhat') { cap(hc, 0.1); headParts.push({ geo: cyl(low ? 8 : 12), color: 0xe8d8a0, pos: [0, y0 + hr * 0.5, 0], scale: [hr * 1.9, hr * 0.05, hr * 1.9] }, { geo: dome(low ? 8 : 12), color: 0xe8d8a0, pos: [0, y0 + hr * 0.5, 0], scale: [hr * 1.05, hr * 0.7, hr * 1.05] }); }
  else if (hs === 'copcap') { cap(hc, 0.05); headParts.push({ geo: dome(low ? 8 : 12), color: 0x16213f, pos: [0, y0 + hr * 0.38, 0], scale: [hr * 1.1, hr * 0.78, hr * 1.14] }, { geo: cyl(low ? 8 : 12), color: 0x16213f, pos: [0, y0 + hr * 0.4, hr * 0.05], scale: [hr * 1.14, hr * 0.12, hr * 1.2] }, { geo: bx(), color: 0x0c0c12, pos: [0, y0 + hr * 0.36, hr * 1.1], scale: [hr * 0.9, hr * 0.05, hr * 0.5] }, { geo: bx(), color: 0xd8b84a, pos: [0, y0 + hr * 0.56, hr * 1.07], scale: [hr * 0.22, hr * 0.22, hr * 0.04] }); }
  if (hs === 'sunhat' || kind === 'cop') { /* shades */ }
  // ---- pelvis (hips joint)
  const pelvisParts = [];
  const pelvCol = def.item === 'skirt' ? top : pants;
  pelvisParts.push({ geo: sph(S + 2, S - 1), color: pelvCol, scale: [0.19 * k * w, 0.11 * k, 0.14 * k] });
  if (def.item === 'skirt') pelvisParts.push({ geo: G(`pskirt${k}_${S}`, () => new THREE.CylinderGeometry(0.15 * k, 0.24 * k, 0.34 * k, S + 6, 1, true)), color: top, pos: [0, -0.17 * k, 0], scale: [1, 1, 0.8] });
  if (kind === 'cop') pelvisParts.push({ geo: bx(), color: 0x101014, pos: [-0.17 * k, -0.03 * k, 0.0], scale: [0.045 * k, 0.12 * k, 0.07 * k] }); // holster
  // ---- limbs
  const ua = d.upper, fa = d.fore, th = d.thigh, sh = d.shin;
  const u0 = (female ? 0.04 : 0.05) * k * Math.min(w, 1.1), u1 = u0 * 0.82, f1 = u0 * 0.7;
  const armCol = slv === 'none' ? sk : top, foreCol = slv === 'long' ? top : sk;
  const handY = -fa - d.hand * 0.4;
  const upperArm = [{ geo: limbGeo(ua, u0, u1, 0.06, 0.3, S), color: armCol }, { geo: sph(6, 5), color: armCol, scale: u0 * 1.1, pos: [0, 0.0, 0] }];
  const foreArm = [{ geo: limbGeo(fa, u1 * 0.95, f1, 0.06, 0.3, S), color: foreCol }, { geo: sph(7, 5), color: sk, pos: [0, handY, 0.005], scale: [0.036 * k, 0.05 * k, 0.04 * k] }];
  if (kind === 'cop' || slv === 'long') foreArm.push({ geo: cyl(S), color: top, pos: [0, -fa * 0.92, 0], scale: [f1 * 1.08, 0.02 * k, f1 * 1.08] });
  const t0 = (female ? 0.07 : 0.082) * k * Math.min(w, 1.12), t1 = t0 * 0.7, s0 = t1 * 0.95, s1 = s0 * 0.7;
  const shortsLeg = def.item === 'shorts' || (def.item === 'camera' || false);
  const legSkinShin = def.item === 'shorts' || def.item === 'skirt' || def.item === 'camera';
  const thighCol = def.item === 'skirt' ? sk : pants;
  const thigh = [{ geo: limbGeo(th, t0, t1, 0.05, 0.3, S), color: thighCol }];
  const shin = [{ geo: limbGeo(sh, s0, s1, 0.05, 0.25, S), color: legSkinShin ? sk : pants }, { geo: sph(6, 5), color: legSkinShin ? sk : pants, scale: s0 * 1.02 }];
  if (def.item === 'camera') thigh[0].color = pants;
  const footGeo = { geo: sph(7, 5), color: shoes, pos: [0, -d.footH * 0.5 + 0.015 * k, 0.045 * k], scale: [0.05 * k, 0.045 * k, 0.12 * k] };
  const foot = [footGeo, ...(def.item === 'shorts' ? [{ geo: cyl(6), color: 0xf4f4f4, pos: [0, 0.03 * k, 0], scale: [0.04 * k, 0.025 * k, 0.04 * k] }] : [])];
  if (def.item === 'case') foreArm.push({ geo: bx(), color: 0x4a3322, pos: [0, handY - 0.17 * k, 0.0], scale: [0.045 * k, 0.24 * k, 0.32 * k] });
  if (def.item === 'case') foreArm.push({ geo: bx(), color: 0x2a1c12, pos: [0, handY - 0.04 * k, 0.0], scale: [0.02 * k, 0.012 * k, 0.1 * k] });
  out.d = d; out.torso = torsoParts; out.head = headParts; out.pelvis = pelvisParts; out.upperArm = upperArm; out.foreArm = foreArm; out.thigh = thigh; out.shin = shin; out.foot = foot;
  out.stoop = stoop;
  return out;
}

/** merge a low-LOD whole-limb / whole-body mesh from a hi set */
function lowSet(set, k, d) {
  const hang = (parts, dy) => parts.map((p) => ({ ...p, pos: [(p.pos ?? [0, 0, 0])[0], (p.pos ?? [0, 0, 0])[1] + dy, (p.pos ?? [0, 0, 0])[2]] }));
  const yc = d.chest + d.neck; // head origin relative to chest joint
  const body = [...set.torso, ...hang(set.head, yc), ...set.pelvis.map((p) => ({ ...p, pos: [(p.pos ?? [0, 0, 0])[0], (p.pos ?? [0, 0, 0])[1] - d.spine - d.pelvis, (p.pos ?? [0, 0, 0])[2]] }))];
  return {
    body,
    arm: [...set.upperArm, ...hang(set.foreArm, -d.upper)],
    leg: [...set.thigh, ...hang(set.shin, -d.thigh), ...hang(set.foot, -d.thigh - d.shin)],
  };
}

const lookCache = new Map();
function getLook(def, st, lod) {
  const key = [st.kind, st.name, st.ti, st.pi, st.si, st.hi, st.hairStyle, st.k, lod, st.packCol].join('|');
  let L = lookCache.get(key);
  if (L) return L;
  const set = buildSet(def, st, lod);
  const mk = (n, parts) => mergeColored(`${key}#${n}`, parts);
  if (lod === 'low') {
    const lw = lowSet(set, st.k, set.d);
    L = { d: set.d, body: mk('body', lw.body), arm: mk('arm', lw.arm), leg: mk('leg', lw.leg) };
  } else {
    L = { d: set.d };
    for (const n of ['torso', 'head', 'pelvis', 'upperArm', 'foreArm', 'thigh', 'shin', 'foot']) L[n] = mk(n, set[n]);
  }
  lookCache.set(key, L);
  return L;
}

function assemble(id, st, def, opts) {
  const lod = opts.lod === 'low' ? 'low' : 'high';
  const look = getLook(def, st, lod);
  const d = look.d;
  const rig = buildRig(d, 1.05);
  const model = new ProcModel(id, rig, { prof: st.prof });
  const mat = pedMat();
  const cast = opts.castShadow ?? (lod !== 'low');
  const j = model.j;
  const add = (joint, geo, ox = 0, oy = 0, oz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(ox, oy, oz); joint.add(m); model.reg(m, null, { cast }); return m; };
  if (lod === 'low') {
    add(j[J.CH], look.body);
    add(j[J.AL], look.arm); add(j[J.AR], look.arm);
    add(j[J.TL], look.leg); add(j[J.TR], look.leg);
  } else {
    add(j[J.H], look.pelvis); add(j[J.CH], look.torso); add(j[J.HD], look.head);
    add(j[J.AL], look.upperArm); add(j[J.AR], look.upperArm); add(j[J.EL], look.foreArm); add(j[J.ER], look.foreArm);
    add(j[J.TL], look.thigh); add(j[J.TR], look.thigh); add(j[J.KL], look.shin); add(j[J.KR], look.shin);
    add(j[J.FL], look.foot); add(j[J.FR], look.foot);
  }
  model.lod = lod; model.variant = st.name; model.look = st;
  model.setVariant = () => {}; // looks are fixed per instance (cheap shared geometry)
  return model;
}

// ================================================================== CIVILIAN
let civCount = 0;
export function buildCivilian(opts = {}) {
  let v = opts.variant;
  if (typeof v === 'number') v = CIVILIAN_VARIANTS[((v % 10) + 10) % 10];
  if (!DEFS[v]) v = CIVILIAN_VARIANTS[Math.floor(Math.random() * CIVILIAN_VARIANTS.length)];
  const def = DEFS[v];
  const r = () => Math.random();
  const arr = (a) => (Array.isArray(a) ? a : [a]);
  const alt = opts.alt ?? Math.floor(r() * 4);
  const ks = [0.9, 0.93, 0.96, 1.0, 1.04];
  const kk = ks[Math.floor(Math.max(0, Math.min(4, ((def.k[0] + (def.k[1] - def.k[0]) * r()) - 0.88) / 0.04)))];
  const top = arr(def.top)[alt % arr(def.top).length];
  const pantsDef = def.pants === 'top' ? top : arr(def.pants)[alt % arr(def.pants).length];
  const hairStyle = arr(def.hair)[Math.floor(r() * arr(def.hair).length)];
  const ti = alt % arr(def.top).length, si = opts.skin ?? Math.floor(r() * SKIN.length), hi = opts.hair ?? (v === 'elder' ? 4 : Math.floor(r() * HAIR.length));
  const st = {
    kind: 'civ', name: v, k: kk, ti, pi: alt % (Array.isArray(def.pants) ? def.pants.length : 1), si, hi, hairStyle,
    w: def.w, skin: SKIN[si], hair: HAIR[hi], top, under: def.under ?? top, tie: arr(def.tie ?? 0x222222)[alt % arr(def.tie ?? 0x222222).length], pants: pantsDef, shoes: def.shoes, packCol: arr(def.top)[(alt + 1) % arr(def.top).length],
    prof: { stance: 'relaxed', gait: true, cadence: 1.0, stride: 0.9, armSwing: def.item === 'case' ? 0.7 : 0.8, lean: def.stoop ? 0.9 : 0.7, bob: 1.0, flipDodge: false, shoot: 'gun', aimStyle: 'gun', tempo: def.stoop ? 0.8 : 1.0 },
  };
  if (v === 'jogger') { st.prof.stride = 1.05; st.prof.cadence = 1.1; }
  const m = assemble('civilian', st, def, opts);
  civCount++;
  return m.snap(), m;
}

// ================================================================== COP
export function buildCop(opts = {}) {
  const r = Math.random;
  const si = opts.skin ?? Math.floor(r() * SKIN.length), hi = opts.hair ?? Math.floor(r() * 5);
  const def = { top: 0x1b2a4e, sleeve: 'long', k: [0.98, 1.04], w: 1.06, item: 'cop' };
  const kk = [0.96, 1.0, 1.04][Math.floor(r() * 3)];
  const st = {
    kind: 'cop', name: 'cop', k: kk, ti: 0, pi: 0, si, hi, hairStyle: 'copcap', w: 1.06, skin: SKIN[si], hair: HAIR[hi], top: 0x1b2a4e, under: 0x8fa8d0, tie: 0x0e0e12, pants: 0x131c36, shoes: 0x0e0e10, packCol: 0,
    prof: { stance: 'ready', gait: true, cadence: 1.0, stride: 0.95, armSwing: 0.8, lean: 0.8, bob: 1.0, flipDodge: false, shoot: 'gun', aimStyle: 'gun', tempo: 1.0 },
  };
  const model = assemble('cop', st, def, opts);
  // service pistol in the right hand; +Z of the pistol is the barrel direction (hand frame is aligned in aim/shoot)
  const pg = mergeColored('pistol', [
    { geo: G('pbox', () => new THREE.BoxGeometry(1, 1, 1)), color: 0x1a1a1e, pos: [0, 0.012, 0.085], scale: [0.026, 0.034, 0.17] },
    { geo: G('pbox', () => new THREE.BoxGeometry(1, 1, 1)), color: 0x2a2a30, pos: [0, -0.035, 0.02], scale: [0.026, 0.07, 0.03], rot: [0.25, 0, 0] },
    { geo: G('pcyl8', () => new THREE.CylinderGeometry(1, 1, 1, 8)), color: 0x0c0c0e, pos: [0, 0.014, 0.185], scale: [0.009, 0.05, 0.009], rot: [Math.PI / 2, 0, 0] },
  ]);
  const pm = new THREE.Mesh(pg, pedMat()); pm.castShadow = opts.lod !== 'low'; pm.position.set(0, -0.005, 0.0);
  model.handR.add(pm); model.reg(pm, null, { cast: opts.lod !== 'low' });
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.014, 0.215); model.handR.add(muzzle);
  model.muzzle = muzzle; model.pistol = pm;
  return model.snap(), model;
}
