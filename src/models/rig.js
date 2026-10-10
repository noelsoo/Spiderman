// Articulated humanoid rig (nested Object3D joints) + procedural animation + tint/variant plumbing.
// Left = +X, right = -X, forward = +Z, up = +Y. Joint rotations use XYZ Euler.
//   rotation.x < 0 swings a hanging limb FORWARD; knee rotation.x > 0 bends the shin backward.
//   shoulder rotation.z > 0 raises the LEFT arm outwards (RIGHT arm uses negative z).
import * as THREE from 'three';

const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// joint indices
export const J = { H: 0, SP: 1, CH: 2, NK: 3, HD: 4, AL: 5, AR: 6, EL: 7, ER: 8, WL: 9, WR: 10, TL: 11, TR: 12, KL: 13, KR: 14, FL: 15, FR: 16 };
const NJ = 17, POSK = NJ; // pseudo joint index for hips position offset in keys
const MIR = [0, 1, 2, 3, 4, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15];
const JNAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'thL', 'thR', 'knL', 'knR', 'ftL', 'ftR'];

export function mirrorKey(k) { return k.map(([j, x, y, z]) => (j === POSK ? [j, -x, y, z] : [MIR[j], x, -y, -z])); }

// ------------------------------------------------------------------ rig
export function makeDims(k = 1, o = {}) {
  const b = { footH: 0.09, shin: 0.43, thigh: 0.45, drop: 0.04, hipW: 0.10, pelvis: 0.05, spine: 0.20, chest: 0.34, neck: 0.07, headR: 0.115, shW: 0.20, upper: 0.30, fore: 0.27, hand: 0.09 };
  const d = {};
  for (const key in b) d[key] = b[key] * k;
  Object.assign(d, o);
  d.k = k;
  return d;
}

export function buildRig(d, headScaleY = 1.05) {
  const group = new THREE.Group();
  const mk = (parent, x, y, z, name) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.name = name; parent.add(o); return o; };
  const hipsY = d.footH + d.shin + d.thigh + d.drop;
  const hips = mk(group, 0, hipsY, 0, 'hips');
  const spine = mk(hips, 0, d.pelvis, 0, 'spine');
  const chest = mk(spine, 0, d.spine, 0, 'chest');
  const neck = mk(chest, 0, d.chest, 0, 'neck');
  const head = mk(neck, 0, d.neck, 0, 'head');
  const shY = d.chest - 0.07 * d.k;
  const shL = mk(chest, d.shW, shY, 0, 'shL'), shR = mk(chest, -d.shW, shY, 0, 'shR');
  const elL = mk(shL, 0, -d.upper, 0, 'elL'), elR = mk(shR, 0, -d.upper, 0, 'elR');
  const wrL = mk(elL, 0, -d.fore, 0, 'wrL'), wrR = mk(elR, 0, -d.fore, 0, 'wrR');
  const thL = mk(hips, d.hipW, -d.drop, 0, 'thL'), thR = mk(hips, -d.hipW, -d.drop, 0, 'thR');
  const knL = mk(thL, 0, -d.thigh, 0, 'knL'), knR = mk(thR, 0, -d.thigh, 0, 'knR');
  const ftL = mk(knL, 0, -d.shin, 0, 'ftL'), ftR = mk(knR, 0, -d.shin, 0, 'ftR');
  const handL = mk(wrL, 0, -d.hand * 0.55, 0, 'handL'), handR = mk(wrR, 0, -d.hand * 0.55, 0, 'handR');
  const chestPt = mk(chest, 0, d.chest * 0.55, d.k * 0.14, 'chestPt');
  const joints = [hips, spine, chest, neck, head, shL, shR, elL, elR, wrL, wrR, thL, thR, knL, knR, ftL, ftR];
  const height = hipsY + d.pelvis + d.spine + d.chest + d.neck + d.headR * headScaleY * 1.95;
  return { group, joints, hipsY, handL, handR, chestPt, height, dims: d };
}

// ------------------------------------------------------------------ pose container
class Pose {
  constructor() { this.r = new Float32Array(NJ * 3); this.hp = new Float32Array(3); this.ikT = new Float32Array(6); this.ikP = new Float32Array(6); this.ikOn = [0, 0]; this.reset(); }
  reset() { this.r.fill(0); this.hp.fill(0); this.flat = 1; this.ground = true; this.rate = 14; this.rifle = 0; this.aim = 0; this.zeta = 1; this.ikOn[0] = this.ikOn[1] = 0; }
  /** arm IK target in chest space. side 0 = right, 1 = left. pole = elbow direction hint (optional) */
  ik(side, x, y, z, px = side ? 0.55 : -0.55, py = -1, pz = -0.35) {
    const i = side * 3; this.ikT[i] = x; this.ikT[i + 1] = y; this.ikT[i + 2] = z; this.ikP[i] = px; this.ikP[i + 1] = py; this.ikP[i + 2] = pz; this.ikOn[side] = 1;
  }
  set(j, x, y = 0, z = 0) { const i = j * 3; this.r[i] = x; this.r[i + 1] = y; this.r[i + 2] = z; }
  add(j, x, y = 0, z = 0) { const i = j * 3; this.r[i] += x; this.r[i + 1] += y; this.r[i + 2] += z; }
  pos(x, y, z) { this.hp[0] = x; this.hp[1] = y; this.hp[2] = z; }
  /** Blend toward an absolute key (array of [joint,x,y,z]) with weight w. */
  mix(key, w) {
    if (w <= 0.0001) return;
    for (const [j, x, y, z] of key) {
      if (j === POSK) { this.hp[0] = lerp(this.hp[0], x, w); this.hp[1] = lerp(this.hp[1], y, w); this.hp[2] = lerp(this.hp[2], z, w); }
      else { const i = j * 3; this.r[i] = lerp(this.r[i], x, w); this.r[i + 1] = lerp(this.r[i + 1], y, w); this.r[i + 2] = lerp(this.r[i + 2], z, w); }
    }
  }
}

// ------------------------------------------------------------------ attack keys (right-handed; left via mirrorKey)
const { H, SP, CH, NK, HD, AL, AR, EL, ER, WL, WR, TL, TR, KL, KR, FL, FR } = J;
const K = {
  jabW: [[AR, 0.55, 0, -0.15], [ER, -1.9, 0, 0], [AL, -0.9, 0, 0.35], [EL, -1.5, 0, 0], [CH, 0.05, -0.3, 0], [SP, 0, -0.15, 0], [H, 0.05, 0.1, 0], [TL, -0.35, 0, 0.12], [KL, 0.4, 0, 0], [TR, 0.35, 0, -0.1], [KR, 0.5, 0, 0]],
  jabS: [[AR, -1.5, 0, -0.12], [ER, -0.12, 0, 0], [AL, -0.5, 0, 0.35], [EL, -1.6, 0, 0], [CH, 0.12, 0.5, 0], [SP, 0, 0.2, 0], [H, 0.15, -0.1, 0], [HD, 0, -0.3, 0], [TL, -0.6, 0, 0.12], [KL, 0.5, 0, 0], [TR, 0.3, 0, -0.12], [KR, 0.2, 0, 0], [POSK, 0, 0, 0.12]],
  hookW: [[AL, -0.2, 0.55, 1.5], [EL, -1.5, 0, 0], [AR, -0.7, 0, -0.35], [ER, -1.6, 0, 0], [CH, 0.05, 0.45, 0], [H, 0.05, 0.25, 0], [TL, -0.3, 0, 0.15], [KL, 0.4, 0, 0], [TR, 0.4, 0, -0.1], [KR, 0.5, 0, 0]],
  hookS: [[AL, -0.2, -1.2, 1.5], [EL, -1.35, 0, 0], [AR, -0.7, 0, -0.35], [ER, -1.6, 0, 0], [CH, 0.1, -0.7, 0], [H, 0.1, -0.2, 0], [HD, 0, 0.35, 0], [TL, -0.5, 0, 0.12], [KL, 0.4, 0, 0], [TR, 0.3, 0, -0.1], [KR, 0.25, 0, 0], [POSK, 0, 0, 0.1]],
  bigW: [[AR, 1.25, -0.2, -0.5], [ER, -1.0, 0, 0], [AL, -1.0, 0, 0.4], [EL, -1.2, 0, 0], [CH, -0.08, -0.75, 0], [SP, 0, -0.2, 0], [H, -0.05, -0.3, 0], [TL, -0.55, 0, 0.2], [KL, 0.75, 0, 0], [TR, 0.5, 0, -0.2], [KR, 0.8, 0, 0], [POSK, 0, 0, -0.1]],
  bigS: [[AR, -1.65, 0, -0.1], [ER, -0.08, 0, 0], [AL, -0.3, 0, 0.5], [EL, -1.6, 0, 0], [CH, 0.2, 0.9, 0], [SP, 0, 0.25, 0], [H, 0.28, 0.25, 0], [HD, 0, -0.4, 0], [TL, -0.9, 0, 0.18], [KL, 0.8, 0, 0], [TR, 0.7, 0, -0.2], [KR, 0.1, 0, 0], [POSK, 0, 0, 0.3]],
  kickW: [[TR, -1.15, 0, -0.1], [KR, 1.8, 0, 0], [H, -0.1, 0, 0], [CH, -0.1, 0, 0], [AL, -0.6, 0, 0.7], [EL, -0.5, 0, 0], [AR, -0.2, 0, -0.9], [ER, -0.5, 0, 0], [KL, 0.3, 0, 0]],
  kickS: [[TR, -1.6, 0, -0.1], [KR, 0.12, 0, 0], [FR, 0.5, 0, 0], [H, -0.3, 0.2, 0], [CH, -0.25, 0, 0], [HD, 0.15, 0, 0], [AL, -0.3, 0, 1.1], [EL, -0.4, 0, 0], [AR, 0.5, 0, -1.2], [ER, -0.4, 0, 0], [KL, 0.3, 0, 0], [TL, 0.05, 0, 0.05]],
  upW: [[AR, 0.45, 0, -0.2], [ER, -1.7, 0, 0], [AL, -0.8, 0, 0.3], [EL, -1.8, 0, 0], [CH, 0.28, -0.35, 0], [H, 0.2, 0.1, 0], [TL, -0.95, 0, 0.1], [KL, 1.5, 0, 0], [TR, 0.5, 0, -0.1], [KR, 1.4, 0, 0]],
  upS: [[AR, -2.75, 0, -0.1], [ER, -0.3, 0, 0], [AL, -0.8, 0, 0.35], [EL, -1.7, 0, 0], [CH, -0.18, 0.55, 0], [H, -0.05, -0.1, 0], [HD, -0.3, -0.3, 0], [TL, -0.2, 0, 0.1], [KL, 0.25, 0, 0], [TR, 0.1, 0, -0.1], [KR, 0.05, 0, 0]],
  thrW: [[AR, 2.7, 0, -0.4], [ER, -1.0, 0, 0], [AL, -1.3, 0, 0.3], [EL, -0.4, 0, 0], [CH, -0.2, -0.6, 0], [H, -0.1, -0.2, 0], [TL, -0.5, 0, 0.15], [KL, 0.5, 0, 0], [TR, 0.5, 0, -0.1], [KR, 0.6, 0, 0]],
  thrS: [[AR, -1.7, 0, -0.1], [ER, -0.15, 0, 0], [AL, 0.3, 0, 0.5], [EL, -0.8, 0, 0], [CH, 0.35, 0.75, 0], [H, 0.2, 0.2, 0], [TL, -0.75, 0, 0.12], [KL, 0.5, 0, 0], [TR, 0.6, 0, -0.1], [KR, 0.2, 0, 0], [POSK, 0, 0, 0.15]],
  thr2W: [[AL, 2.9, 0, 0.25], [AR, 2.9, 0, -0.25], [EL, -0.5, 0, 0], [ER, -0.5, 0, 0], [CH, -0.45, 0, 0], [H, -0.2, 0, 0], [HD, -0.3, 0, 0], [TL, -0.4, 0, 0.2], [KL, 0.5, 0, 0], [TR, 0.3, 0, -0.2], [KR, 0.5, 0, 0]],
  thr2S: [[AL, -1.25, 0, 0.12], [AR, -1.25, 0, -0.12], [EL, -0.2, 0, 0], [ER, -0.2, 0, 0], [CH, 0.55, 0, 0], [H, 0.3, 0, 0], [HD, 0.1, 0, 0], [TL, -0.7, 0, 0.2], [KL, 0.6, 0, 0], [TR, 0.5, 0, -0.2], [KR, 0.2, 0, 0], [POSK, 0, 0, 0.2]],
  smashW: [[AL, -3.05, 0, 0.18], [AR, -3.05, 0, -0.18], [EL, -0.35, 0, 0], [ER, -0.35, 0, 0], [CH, -0.3, 0, 0], [H, -0.2, 0, 0], [HD, -0.25, 0, 0], [TL, -0.2, 0, 0.2], [KL, 0.4, 0, 0], [TR, 0.2, 0, -0.2], [KR, 0.4, 0, 0]],
  smashS: [[AL, -0.9, 0, 0.12], [AR, -0.9, 0, -0.12], [EL, -0.25, 0, 0], [ER, -0.25, 0, 0], [CH, 0.6, 0, 0], [H, 0.4, 0, 0], [HD, 0.25, 0, 0], [TL, -0.55, 0, 0.2], [KL, 0.8, 0, 0], [TR, -0.25, 0, -0.2], [KR, 0.6, 0, 0], [POSK, 0, 0, 0.25]],
  catS: [[AR, -1.35, 0, -0.2], [ER, -0.35, 0, 0], [AL, -0.5, 0, 0.45], [EL, -1.3, 0, 0], [CH, 0.12, 0.45, 0], [H, 0.08, 0.1, 0], [HD, 0, -0.25, 0], [TL, -0.5, 0, 0.12], [KL, 0.45, 0, 0], [TR, 0.4, 0, -0.1], [KR, 0.3, 0, 0]],
  land: [[H, 0.35, 0, 0], [CH, 0.25, 0, 0], [TL, -1.0, 0, 0.15], [TR, -0.9, 0, -0.15], [KL, 1.7, 0, 0], [KR, 1.6, 0, 0], [AL, -0.4, 0, 0.7], [AR, -0.4, 0, -0.7], [EL, -0.5, 0, 0], [ER, -0.5, 0, 0]],
};
const KL_ = {}; // mirrored (left) versions
for (const n of ['jabW', 'jabS', 'bigW', 'bigS', 'kickW', 'kickS', 'upW', 'upS', 'thrW', 'thrS']) KL_[n] = mirrorKey(K[n]);

/** attack envelope: -1 = fully wound up, +1 = fully struck */
function atk(t, w, s, h, r) {
  if (t < w) return -sm(t / w);
  if (t < w + s) return -1 + 2 * sm((t - w) / s);
  if (t < w + s + h) return 1;
  const k = (t - w - s - h) / r; return k >= 1 ? 0 : 1 - sm(k);
}

// ------------------------------------------------------------------ default profile
const PROF = {
  stance: 'ready', cadence: 1, stride: 1, armSwing: 1, lean: 1, bob: 1, flyStyle: 'super', flipDodge: true,
  shoot: 'palm', throwStyle: 'one', rifle: false, hunch: 0, wide: 0, tempo: 1, hover: 'iron',
};

function stance(p, f, legs = true) {
  switch (f.stance) {
    case 'ready':
      p.set(AL, -0.35, 0, 0.22); p.set(AR, -0.35, 0, -0.22); p.set(EL, -1.35); p.set(ER, -1.35);
      p.set(CH, 0.1, -0.1); p.set(SP, 0.05, -0.15); p.set(HD, -0.08, -0.1); p.set(H, 0.06, 0.2);
      if (legs) { p.set(TL, -0.22, 0, 0.1); p.set(TR, 0.18, 0, -0.1); p.set(KL, 0.45); p.set(KR, 0.35); }
      break;
    case 'hulk':
      p.set(AL, 0.05, 0.1, 0.5 + f.wide); p.set(AR, 0.05, -0.1, -0.5 - f.wide); p.set(EL, -0.5); p.set(ER, -0.5);
      p.set(CH, 0.18); p.set(HD, -0.12); p.set(H, 0.06);
      if (legs) { p.set(TL, 0, 0, 0.22); p.set(TR, 0, 0, -0.22); p.set(KL, 0.22); p.set(KR, 0.22); }
      break;
    case 'feral':
      p.set(AL, -0.25, 0, 0.42); p.set(AR, -0.25, 0, -0.42); p.set(EL, -1.25); p.set(ER, -1.25);
      p.set(CH, 0.2, -0.08); p.set(SP, 0.08, -0.1); p.set(HD, -0.14, -0.08); p.set(H, 0.1, 0.12);
      if (legs) { p.set(TL, -0.3, 0, 0.26); p.set(TR, 0.14, 0, -0.26); p.set(KL, 0.62); p.set(KR, 0.5); }
      break;
    case 'thug':
      p.set(AL, -0.12, 0, 0.14); p.set(AR, -0.12, 0, -0.14); p.set(EL, -0.55); p.set(ER, -0.55);
      p.set(CH, 0.12); p.set(HD, 0.1); p.set(NK, 0.1);
      if (legs) { p.set(TL, 0, 0, 0.08); p.set(TR, 0, 0, -0.08); p.set(KL, 0.1); p.set(KR, 0.1); }
      break;
    case 'rifle':
      p.set(CH, 0.05, 0.1); p.set(HD, 0, -0.1);
      if (legs) { p.set(TL, -0.12, 0, 0.1); p.set(TR, 0.1, 0, -0.1); p.set(KL, 0.2); p.set(KR, 0.2); }
      break;
    default: // relaxed / proud
      p.set(AL, 0.04, 0, 0.12); p.set(AR, 0.04, 0, -0.12); p.set(EL, -0.15); p.set(ER, -0.15);
      if (legs) { p.set(TL, 0, 0, 0.06); p.set(TR, 0, 0, -0.06); p.set(KL, 0.05); p.set(KR, 0.05); }
      p.set(CH, -0.03);
  }
}

// ------------------------------------------------------------------ state poses: (m, p, c) with c = {t, sp, dt, tm, vl, st, f}
const S = {};
S.idle = (m, p, c) => {
  const br = Math.sin(c.tm * 1.9), f = c.f;
  stance(p, f);
  p.add(CH, br * 0.018 + f.hunch * 0.0, Math.sin(c.tm * 0.4) * 0.03);
  p.add(NK, -br * 0.01); p.add(HD, 0, Math.sin(c.tm * 0.37) * 0.08);
  p.add(AL, 0, 0, br * 0.015); p.add(AR, 0, 0, -br * 0.015);
  p.hp[1] = br * 0.004;
  // weight shifts, per-instance phase
  const ws = Math.sin(c.tm * 0.23 + m.seed) * Math.sin(c.tm * 0.11 + m.seed * 2.1);
  p.hp[0] = ws * 0.018; p.add(H, 0, 0, ws * 0.02); p.add(TL, ws * 0.05, 0, ws * 0.03); p.add(TR, -ws * 0.05, 0, ws * 0.03);
  p.add(HD, Math.sin(c.tm * 0.17 + m.seed) * 0.03, 0, 0);
};
function runCycle(m, p, c, sprint, k = 1) {
  const f = c.f, sp = c.sp;
  const amp = clamp(0.32 + sp * 0.06, 0.4, 1.05) * f.stride * (sprint ? 1.12 : 1);
  // foot planting: leg angular rate is derived from ground speed so planted feet move back at ~body speed
  const legL = m.dims.thigh + m.dims.shin;
  const om = clamp(sp * 0.82 / (legL * Math.sin(Math.min(amp, 1.2)) + 0.001), 3.2, 24) * f.cadence * k;
  m.phase += c.dt * om;
  const ph = m.phase;
  stance(p, f, false);
  const g = f.gait ? clamp((sp - 1.0) / 5.0, 0, 1) : 1; // pedestrians: relaxed walk -> jog
  const fl = Math.sin(ph), fr = Math.sin(ph + Math.PI);
  p.set(TL, -fl * amp, 0, 0.04 + f.wide * 0.1); p.set(TR, -fr * amp, 0, -0.04 - f.wide * 0.1);
  p.set(KL, (0.18 + 0.95 * Math.max(0, Math.cos(ph))) * amp * 1.35);
  p.set(KR, (0.18 + 0.95 * Math.max(0, Math.cos(ph + Math.PI))) * amp * 1.35);
  const aa = (0.55 + (sprint ? 0.25 : 0)) * amp * f.armSwing * (f.gait ? 0.5 + 0.5 * g : 1);
  const spreadL = p.r[AL * 3 + 2], spreadR = p.r[AR * 3 + 2];
  p.set(AL, fl * aa, 0, spreadL * 0.5 + 0.1); p.set(AR, fr * aa, 0, spreadR * 0.5 - 0.1);
  const eb = f.gait ? lerp(0.22, 1.0, g) : (f.stance === 'hulk' ? 0.8 : 1.0);
  p.set(EL, -eb - 0.35 * Math.max(0, -fl) - (sprint ? 0.3 : 0));
  p.set(ER, -eb - 0.35 * Math.max(0, -fr) - (sprint ? 0.3 : 0));
  p.set(H, (0.1 + sp * 0.014) * f.lean * (sprint ? 1.25 : 1) * (f.gait ? 0.35 + 0.65 * g : 1), fl * 0.14 * (f.gait ? 0.5 + 0.5 * g : 1), 0);
  p.set(SP, 0.03, -fl * 0.2, 0); p.set(CH, 0.05, 0, fl * 0.035);
  p.set(HD, -0.1 * f.lean, fl * 0.05, 0);
  p.hp[1] = Math.abs(Math.cos(ph)) * 0.03 * f.bob * clamp(sp / 6, 0.4, 1.6);
  p.flat = 0.75;
  if (f.knuckle) { // Hulk: heavy gorilla run, knuckles near the ground, body slammed forward on each step
    const sq = Math.max(0, Math.sin(ph * 2)) * 0.05;
    p.set(H, 0.5 + sq, fl * 0.2, fl * 0.05); p.set(CH, 0.3, -fl * 0.25); p.set(SP, 0.1, -fl * 0.15); p.set(HD, -0.55, 0);
    p.set(AL, -0.15 + fl * 0.65, 0, 0.32 + f.wide); p.set(AR, -0.15 + fr * 0.65, 0, -0.32 - f.wide); p.set(EL, -0.18 - Math.max(0, -fl) * 0.4); p.set(ER, -0.18 - Math.max(0, -fr) * 0.4);
    p.hp[1] -= 0.04; p.hp[1] += Math.abs(Math.cos(ph)) * 0.05;
  }
}
S.run = (m, p, c) => runCycle(m, p, c, false);
S.sprint = (m, p, c) => runCycle(m, p, c, true);
S.charge = (m, p, c) => {
  if (c.f.charge === 'shield') { S.block(m, p, c, true); return; }
  runCycle(m, p, c, true, 1.15);
  p.set(H, 0.75 * c.f.lean, 0.25, 0); p.set(HD, -0.6, -0.2, 0); p.set(CH, 0.2, -0.2);
  p.set(AL, -1.25, 0, 0.35); p.set(AR, -1.25, 0, -0.35); p.set(EL, -1.8); p.set(ER, -1.8);
};
S.jump = (m, p, c) => {
  m.fallSpeed = 4;
  stance(p, c.f, false);
  p.ground = false; p.flat = 0; p.rate = 11;
  p.set(AL, -1.9, 0, 0.55); p.set(AR, -1.9, 0, -0.55); p.set(EL, -0.35); p.set(ER, -0.35);
  p.set(TL, -0.7, 0, 0.12); p.set(KL, 1.1); p.set(TR, 0.1, 0, -0.12); p.set(KR, 0.7);
  p.set(H, 0.05); p.set(HD, -0.15); p.set(CH, -0.1);
  p.set(FL, 0.5); p.set(FR, 0.7);
};
S.fall = (m, p, c) => {
  m.fallSpeed = Math.max(m.fallSpeed || 0, -(c.vl.y || 0));
  stance(p, c.f, false);
  p.ground = false; p.flat = 0; p.rate = 9;
  const w = Math.sin(c.tm * 9) * 0.1;
  p.set(AL, -1.25 + w, 0, 0.9); p.set(AR, -1.25 - w, 0, -0.9); p.set(EL, -0.5); p.set(ER, -0.5);
  p.set(TL, -0.35, 0, 0.2); p.set(KL, 0.5 + w); p.set(TR, 0.25, 0, -0.2); p.set(KR, 0.6 - w);
  p.set(H, 0.12); p.set(HD, -0.2); p.set(CH, 0.05);
  p.set(FL, 0.4); p.set(FR, 0.4);
};
const HEROLAND = [[H, 0.55, 0, 0], [CH, 0.35, 0, 0], [HD, -0.5, 0, 0], [TL, -1.7, 0, 0.2], [KL, 2.05, 0, 0], [TR, 0.75, 0, -0.25], [KR, 2.3, 0, 0], [FR, 1.0, 0, 0],
  [AR, -0.35, 0, -0.5], [ER, -0.2, 0, 0], [AL, 0.55, 0, 1.0], [EL, -0.35, 0, 0], [POSK, 0, -0.05, 0]];
S.land = (m, p, c) => {
  S.idle(m, p, c);
  const fs = clamp((m.fallSpeed || 8) / 13, 0.3, 1.25);
  if (c.f.landStyle === 'hero' && fs > 0.75) { // superhero landing: kneel, fist to the ground, hold, then rise
    const w = c.t < 0.55 ? sm(c.t / 0.12) : 1 - sm((c.t - 0.55) / 0.35);
    p.mix(HEROLAND, w); p.rate = 16; p.ground = true; return;
  }
  p.mix(K.land, Math.exp(-c.t * 7) * 0.95 * fs);
  p.hp[1] -= 0.04 * fs * Math.exp(-c.t * 8);
  p.rate = 20; p.zeta = 0.65;
};
S.swing = (m, p, c) => {
  const side = m.swingArm, v = c.vl;
  const hs = Math.hypot(v.x, v.z);
  const pitch = m.customRotation ? 0 : clamp(-Math.atan2(v.y, Math.max(hs, 3)) * 0.8, -0.9, 0.7);
  p.ground = false; p.flat = 0; p.rate = 9;
  const aJ = side > 0 ? AL : AR, aE = side > 0 ? EL : ER, oJ = side > 0 ? AR : AL, oE = side > 0 ? ER : EL;
  // reaching arm: toward the web anchor if known
  if (m.webDir) {
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, -1, 0), m.webDir);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    p.set(aJ, e.x, e.y, e.z);
  } else p.set(aJ, -2.7, 0, side * 0.25);
  p.set(aE, -0.12);
  p.set(oJ, 0.7, 0, -side * 0.55); p.set(oE, -0.9);
  // legs tuck at the bottom of the arc (falling / level) and stretch out as the swing rises toward release
  const tuck = clamp(0.95 - v.y * 0.07, 0.12, 1.0) + 0.05 * Math.sin(c.tm * 2.3);
  p.set(TL, -0.55 * tuck - 0.1, 0, 0.1); p.set(KL, 1.5 * tuck); p.set(TR, 0.1 - 0.2 * tuck, 0, -0.1); p.set(KR, 1.3 * tuck + 0.2);
  p.set(FL, 0.7); p.set(FR, 0.7);
  p.set(H, pitch, 0, -side * 0.12); p.set(CH, 0.1, side * 0.2, 0); p.set(HD, -pitch * 0.5 - 0.1, 0, 0);
};
/** Spider-Man SM2 perch: deep crouch on the balls of the feet, knees wide, right hand planted between the feet, left forearm on the knee, head up scanning. */
S.perch = (m, p, c) => {
  const br = Math.sin(c.tm * 1.7), scan = Math.sin(c.tm * 0.45) * 0.5 + Math.sin(c.tm * 0.19) * 0.25;
  p.ground = true; p.flat = 1; p.rate = 9; p.zeta = 1;
  p.set(H, 0.6, 0, 0); p.set(SP, 0.2, 0, 0); p.set(CH, 0.3 + br * 0.012, 0.12, 0); p.set(NK, -0.25, 0, 0);
  p.set(HD, -0.85 + Math.sin(c.tm * 0.31) * 0.05, scan * 0.8, 0);
  p.set(TL, -1.95, 0, 0.55); p.set(TR, -2.0, 0, -0.55); p.set(KL, 2.0); p.set(KR, 2.05);
  p.set(FL, 0.75); p.set(FR, 0.75);
  p.set(AR, -1.3, 0, 0.0); p.set(ER, -0.35); p.set(WR, 0.25);
  p.set(AL, -0.75, 0, 0.42); p.set(EL, -1.25); p.set(WL, 0.2);
  p.pos(0, 0.06, 0.03);
};
S.zip = (m, p, c) => {
  const v = c.vl; const hs = Math.hypot(v.x, v.z);
  p.ground = false; p.flat = 0; p.rate = 12;
  const side = m.swingArm;
  p.set(H, m.customRotation ? 0 : clamp(Math.PI / 2 - Math.atan2(v.y, Math.max(hs, 0.5)), 0.15, 2.5) * 0.85, 0, 0);
  p.set(AL, -2.9, 0, 0.1); p.set(AR, -2.9, 0, -0.1); p.set(EL, -0.1); p.set(ER, -0.1);
  if (side > 0) p.set(AR, 0.4, 0, -0.3); else p.set(AL, 0.4, 0, 0.3);
  p.set(TL, 0.35, 0, 0.12); p.set(TR, 0.55, 0, -0.1); p.set(KL, 0.3); p.set(KR, 0.15); p.set(FL, 0.9); p.set(FR, 0.9);
  p.set(HD, -0.7); p.set(NK, -0.3);
};
// SM2 wall crawl. Local frame while on a wall: +Y = direction of travel along the wall, +Z = into the wall (chest to the wall).
// Phase is driven by distance travelled. Group A = right hand + left foot, group B = left hand + right foot (spider crawl);
// at sprint speed the pairs merge into a bounding scramble (both hands plant, both legs kick).
S.wallrun = (m, p, c) => {
  const f = c.f;
  const bound = sm((c.sp - 9.5) / 3.5);
  m.phase += c.dt * c.sp * lerp(2.9, 1.8, bound) * (f.cadence || 1);
  const ph = m.phase, a = Math.sin(ph), b = Math.sin(ph + Math.PI * (1 - bound));
  const ex = m.extra; (ex.plant ||= [0, 0]); ex.plant[0] = sm(0.5 - b * 1.2); ex.plant[1] = sm(0.5 - a * 1.2); ex.wall = 1;
  p.ground = false; p.flat = 0; p.rate = 26; p.zeta = 0.8;
  p.set(H, 0.08 - bound * 0.08, 0, (a - b) * 0.05 + bound * 0); p.pos(0, -0.12 + bound * Math.sin(ph * 2) * 0.03, 0.04);
  p.set(SP, 0.04, (a - b) * 0.1, 0); p.set(CH, 0.05, (a - b) * 0.14, (a - b) * 0.04); p.set(NK, -0.35, 0, 0); p.set(HD, -0.55, Math.sin(ph * 0.5) * 0.08, 0);
  // arms: reach above the head with elbows out, pull down while planted
  p.set(AR, -2.35 - a * 0.42, 0, -(0.62 + a * 0.12)); p.set(ER, -0.55 - Math.max(0, -a) * 0.55); p.set(WR, -0.5, 0, 0);
  p.set(AL, -2.35 - b * 0.42, 0, 0.62 + b * 0.12); p.set(EL, -0.55 - Math.max(0, -b) * 0.55); p.set(WL, -0.5, 0, 0);
  // legs: knees splayed out toward the wall, opposite-limb push
  p.set(TL, -1.25 - a * 0.38, 0, 0.55 + a * 0.12); p.set(KL, 1.3 + a * 0.4); p.set(FL, 0.7);
  p.set(TR, -1.25 - b * 0.38, 0, -(0.55 + b * 0.12)); p.set(KR, 1.3 + b * 0.4); p.set(FR, 0.7);
};
S.wallidle = (m, p, c) => {
  const br = Math.sin(c.tm * 1.7), sc = Math.sin(c.tm * 0.5) * 0.7 + Math.sin(c.tm * 0.23) * 0.3;
  const ex = m.extra; (ex.plant ||= [0, 0]); ex.plant[0] = ex.plant[1] = 1; ex.wall = 1;
  p.ground = false; p.flat = 0; p.rate = 10; p.zeta = 1;
  p.set(H, 0.06, 0, 0); p.pos(0, -0.12, 0.05);
  p.set(AL, -2.5, 0, 0.7 + br * 0.02); p.set(AR, -2.45, 0, -0.72 - br * 0.02); p.set(EL, -0.4); p.set(ER, -0.42); p.set(WL, -0.5); p.set(WR, -0.5);
  p.set(TL, -1.3, 0, 0.7); p.set(TR, -1.25, 0, -0.72); p.set(KL, 1.4 + br * 0.03); p.set(KR, 1.35 - br * 0.03); p.set(FL, 0.7); p.set(FR, 0.7);
  p.set(SP, 0.03, sc * 0.1, 0); p.set(CH, 0.05 + br * 0.02, sc * 0.12, 0); p.set(NK, -0.3, sc * 0.35, 0); p.set(HD, -0.5 + Math.sin(c.tm * 0.37) * 0.12, sc * 0.55, 0);
};
S.glide = (m, p, c) => {
  const v = c.vl; const hs = Math.hypot(v.x, v.z);
  const climb = Math.atan2(v.y, Math.max(hs, 3));
  p.ground = false; p.flat = 0; p.rate = 7;
  const sway = Math.sin(c.tm * 1.6) * 0.05;
  const bank = clamp(c.yawRate * 0.09, -0.7, 0.7);
  p.set(H, m.customRotation ? 0 : 1.12 - climb * 0.6, m.customRotation ? 0 : -bank * 0.8, 0);
  p.set(AL, 0.2, -0.2, 1.5 + sway); p.set(AR, 0.2, 0.2, -1.5 - sway); p.set(EL, -0.08); p.set(ER, -0.08);
  p.set(TL, 0.15, 0, 0.4); p.set(TR, 0.15, 0, -0.4); p.set(KL, 0.1); p.set(KR, 0.1);
  p.set(FL, 0.9); p.set(FR, 0.9); p.set(HD, -0.85); p.set(NK, -0.2);
};
function flyPitch(c, base = 1.25) {
  const v = c.vl; const hs = Math.hypot(v.x, v.z); const sp = Math.hypot(hs, v.y);
  const k = clamp((sp - 2) / 8, 0, 1);
  const climb = Math.atan2(v.y, Math.max(hs, 0.5));
  return lerp(0.12, clamp(Math.PI / 2 - climb, 0.1, 2.6) * (base / (Math.PI / 2)), k);
}
S.fly = (m, p, c) => {
  const f = c.f, hov = Math.sin(c.tm * 3) * 0.03;
  p.ground = false; p.flat = 0; p.rate = 8;
  const pitch = m.customRotation ? 0 : flyPitch(c, f.flyStyle === 'iron' ? 1.35 : f.flyStyle === 'witch' ? 0.85 : 1.25);
  const bank = clamp(c.yawRate * 0.1, -0.8, 0.8), kk = Math.sin(clamp(pitch, 0, 1.6));
  p.set(H, pitch, m.customRotation ? 0 : -bank * kk * 0.9, m.customRotation ? 0 : -bank * (1 - kk));
  if (f.flyStyle === 'witch') {
    const w2 = Math.sin(c.tm * 2.2) * 0.06;
    p.set(AL, -0.2 + w2, 0, 1.15); p.set(AR, -0.2 - w2, 0, -1.15); p.set(EL, -0.25); p.set(ER, -0.25);
    p.set(WL, -0.35); p.set(WR, -0.35);
    p.set(TL, 0.42, 0, 0.1); p.set(TR, 0.5, 0, -0.06); p.set(KL, 0.5 + w2); p.set(KR, 0.62 - w2); p.set(FL, 1.0); p.set(FR, 1.0);
    p.set(HD, -0.5 * (m.customRotation ? 1 : kk)); p.set(NK, -0.1); p.set(CH, -0.12, 0, 0);
  } else if (f.flyStyle === 'iron') {
    p.set(AL, 0.45, 0, 0.18); p.set(AR, 0.45, 0, -0.18); p.set(EL, -0.1); p.set(ER, -0.1);
    p.set(TL, 0.12, 0, 0.05); p.set(TR, 0.12, 0, -0.05); p.set(KL, 0.08); p.set(KR, 0.08); p.set(FL, 1.0); p.set(FR, 1.0);
    p.set(HD, -0.9 * (m.customRotation ? 1 : kk)); p.set(NK, -0.2);
  } else {
    p.set(AR, -3.0 + hov, 0, -0.05); p.set(ER, -0.05); p.set(AL, 0.35, 0, 0.25); p.set(EL, -0.5);
    p.set(TL, 0.18, 0, 0.08); p.set(TR, 0.12, 0, -0.06); p.set(KL, 0.35); p.set(KR, 0.2); p.set(FL, 0.9); p.set(FR, 0.9);
    p.set(HD, -0.85 * (m.customRotation ? 1 : kk)); p.set(NK, -0.2); p.set(CH, -0.05, 0.1);
  }
  p.hp[1] = hov;
};
S.hover = (m, p, c) => {
  const f = c.f, b = Math.sin(c.tm * 2.4);
  p.ground = false; p.flat = 0; p.rate = 8;
  p.set(H, 0.06 + b * 0.015, 0, 0);
  if (f.hover === 'witch') {
    p.set(AL, -0.1, 0, 1.2 + b * 0.05); p.set(AR, -0.1, 0, -1.2 - b * 0.05); p.set(EL, -0.3); p.set(ER, -0.3);
    p.set(WL, -0.4); p.set(WR, -0.4);
    p.set(TL, 0.28, 0, 0.06); p.set(TR, 0.34, 0, -0.04); p.set(KL, 0.75 + b * 0.05); p.set(KR, 0.9 - b * 0.05); p.set(FL, 1.1); p.set(FR, 1.1);
    p.set(CH, -0.1); p.set(HD, 0.05, Math.sin(c.tm * 0.5) * 0.15);
    p.set(H, 0.02 + b * 0.015, 0, 0); p.hp[1] = b * 0.05;
    return;
  }
  if (f.hover === 'iron') {
    p.set(AL, -0.15, 0, 0.55); p.set(AR, -0.15, 0, -0.55); p.set(EL, -0.55); p.set(ER, -0.55);
    p.set(WL, -0.5); p.set(WR, -0.5);
    p.set(TL, -0.1, 0, 0.12); p.set(TR, 0.12, 0, -0.12); p.set(KL, 0.25); p.set(KR, 0.4); p.set(FL, 0.8); p.set(FR, 0.8);
  } else {
    p.set(AL, 0.1, 0, 0.3); p.set(AR, -0.5, 0, -0.35); p.set(EL, -0.4); p.set(ER, -0.9);
    p.set(TL, -0.15, 0, 0.1); p.set(TR, 0.1, 0, -0.1); p.set(KL, 0.3); p.set(KR, 0.5); p.set(FL, 0.7); p.set(FR, 0.7);
  }
  p.set(CH, 0.02); p.set(HD, 0, Math.sin(c.tm * 0.5) * 0.15);
  p.hp[1] = b * 0.03;
};
S.dash = (m, p, c) => {
  p.ground = false; p.flat = 0; p.rate = 22;
  p.set(H, 0.95, 0, 0); p.pos(0, -0.05, 0);
  p.set(AL, 0.95, 0, 0.25); p.set(AR, 0.95, 0, -0.25); p.set(EL, -0.4); p.set(ER, -0.4);
  p.set(TL, 0.65, 0, 0.1); p.set(KL, 0.5); p.set(TR, -0.5, 0, -0.1); p.set(KR, 0.2); p.set(FL, 0.9); p.set(FR, 0.9);
  p.set(HD, -0.7);
};
S.dodge = (m, p, c) => {
  if (!c.f.flipDodge) { S.dash(m, p, c); return; }
  p.ground = false; p.flat = 0; p.rate = 40;
  const dur = 0.48, a = clamp(c.t / dur, 0, 1);
  const tuck = Math.sin(clamp(a * 1.15, 0, 1) * Math.PI);
  p.set(H, a * Math.PI * 2 * (m.flipDir ?? 1), 0, 0);
  p.pos(0, 0.32 * tuck, 0);
  p.set(TL, -1.7 * tuck, 0, 0.1); p.set(TR, -1.7 * tuck, 0, -0.1); p.set(KL, 2.0 * tuck); p.set(KR, 2.0 * tuck);
  p.set(AL, -1.3 * tuck, 0, 0.3); p.set(AR, -1.3 * tuck, 0, -0.3); p.set(EL, -1.6 * tuck); p.set(ER, -1.6 * tuck);
  p.set(CH, 0.5 * tuck); p.set(HD, 0.3 * tuck);
};
S.punch1 = (m, p, c) => { stance(p, c.f); const a = atk(c.t, 0.07, 0.07, 0.1, 0.26); p.mix(K.jabW, Math.max(0, -a)); p.mix(K.jabS, Math.max(0, a)); p.rate = 30; };
S.punch2 = (m, p, c) => { stance(p, c.f); const a = atk(c.t, 0.07, 0.07, 0.1, 0.26); p.mix(K.hookW, Math.max(0, -a)); p.mix(K.hookS, Math.max(0, a)); p.rate = 30; };
S.punch3 = (m, p, c) => { stance(p, c.f); const a = atk(c.t, 0.14, 0.08, 0.14, 0.32); p.mix(K.bigW, Math.max(0, -a)); p.mix(K.bigS, Math.max(0, a)); p.rate = 28; };
S.kick = (m, p, c) => { stance(p, c.f); const a = atk(c.t, 0.1, 0.07, 0.12, 0.28); p.mix(K.kickW, Math.max(0, -a)); p.mix(K.kickS, Math.max(0, a)); p.rate = 28; };
S.uppercut = (m, p, c) => { stance(p, c.f); const a = atk(c.t, 0.12, 0.08, 0.14, 0.3); p.mix(K.upW, Math.max(0, -a)); p.mix(K.upS, Math.max(0, a)); p.rate = 28; };
S.throw = (m, p, c) => {
  stance(p, c.f); const a = atk(c.t, 0.18, 0.08, 0.15, 0.3); p.rate = 26;
  const two = c.f.throwStyle === 'two';
  p.mix(two ? K.thr2W : K.thrW, Math.max(0, -a)); p.mix(two ? K.thr2S : K.thrS, Math.max(0, a));
};
S.catch = (m, p, c) => { // Thor: arm snaps out to catch Mjolnir, then recoils with the impact
  stance(p, c.f); const w = c.t < 0.08 ? 1 : Math.max(0, 1 - sm((c.t - 0.08) / 0.34)); p.mix(K.catS, w);
  const rc = c.t < 0.2 ? Math.sin(Math.min(1, c.t / 0.2) * Math.PI) : 0; p.add(CH, -0.12 * rc, 0, 0); p.add(AR, 0.3 * rc, 0, 0); p.rate = 30;
};
S.smash = (m, p, c) => { stance(p, c.f); const a = atk(c.t, 0.3, 0.09, 0.2, 0.4); p.mix(K.smashW, Math.max(0, -a)); p.mix(K.smashS, Math.max(0, a)); p.rate = 26; };
/** two-handed ranged hold. Chest-space IK targets keep the grip hand pointing straight along +Z. */
S.aim = (m, p, c) => {
  const f = c.f, k = m.dims.k;
  stance(p, f);
  p.rate = 16;
  if (m.rifleCfg) { p.aim = 1; p.set(CH, 0.05, 0.25); p.set(HD, 0, -0.2); p.set(H, 0.04, 0.2, 0); return; }
  const br = Math.sin(c.tm * 1.9) * 0.01;
  const ap = m._aimP, sa = Math.sin(ap), ca = Math.cos(ap), piv = 0.27 * k;
  const IK = (side, x, y, z, a, b, d) => { const ry = y - piv; p.ik(side, x, piv + ry * ca + z * sa, z * ca - ry * sa, a, b, d); }; // rotate target about the shoulder line by camera pitch
  p.add(CH, -ap * 0.25); p.add(SP, -ap * 0.1);
  if (f.aimStyle === 'web') { // Spider-Man: one arm thrust out, wrist cocked up, other arm guards
    p.set(H, 0.06, 0.1, 0); p.set(CH, 0.08 - ap * 0.25, 0.2); p.set(HD, -0.05, -0.15); p.set(TL, -0.3, 0, 0.2); p.set(TR, 0.22, 0, -0.2); p.set(KL, 0.5); p.set(KR, 0.42);
    IK(0, -0.07 * k, 0.28 * k + br, 0.62 * k); p.set(WR, -0.7);
    p.set(AL, -0.5, 0, 0.45); p.set(EL, -1.45);
    return;
  }
  if (f.aimStyle === 'bow') {
    const dr = m.draw;
    p.set(CH, 0.03, 0.55, 0); p.set(SP, 0, 0.1); p.set(H, 0.02, -0.25, 0); p.set(HD, 0, -0.62 - dr * 0.12, 0.0);
    p.set(TL, -0.24, 0, 0.2); p.set(TR, 0.2, 0, -0.2); p.set(KL, 0.3); p.set(KR, 0.25);
    IK(1, 0.1 * k, 0.32 * k + br, 0.64 * k);                                    // bow hand, arm straight
    IK(0, lerp(-0.04, -0.15, dr) * k, lerp(0.3, 0.485, dr) * k, lerp(0.44, 0.12, dr) * k, -1, 0.1, -0.85); // string hand to the cheek, elbow back/out
    return;
  }
  p.set(CH, 0.05, 0, 0); p.set(HD, -0.06, 0, 0); p.set(H, 0.04, 0.0, 0);
  p.set(TL, -0.26, 0, 0.14); p.set(TR, 0.2, 0, -0.14); p.set(KL, 0.32); p.set(KR, 0.28);
  const rec = m._rec || 0;
  IK(0, -0.075 * k, (0.27 + br) * k, (0.5 - 0.05 * rec) * k);
  IK(1, -0.02 * k, (0.265 + br) * k, 0.63 * k, 0.6, -1, -0.2);
};
S.block = (m, p, c, charging) => {
  const f = c.f;
  if (charging) runCycle(m, p, c, true, 1.1); else stance(p, f);
  p.rate = 16;
  const b = Math.sin(c.tm * 3) * 0.02;
  p.set(AL, -1.05, 0, 0.12); p.set(EL, -1.75 + b);
  p.set(AR, charging ? p.r[AR * 3] : -0.8, 0, -0.3); if (!charging) p.set(ER, -1.7); 
  p.set(CH, 0.14, 0.3, 0); p.set(HD, -0.08, -0.25, 0); p.set(H, charging ? 0.35 : 0.1, charging ? 0.0 : 0.12, 0);
  if (!charging) { p.set(TL, -0.3, 0, 0.16); p.set(KL, 0.55); p.set(TR, 0.32, 0, -0.16); p.set(KR, 0.5); }
};
S.shoot = (m, p, c) => {
  if (c.f.shoot === 'gun') { m._rec = Math.exp(-c.t * 16); S.aim(m, p, c); p.add(CH, -0.05 * m._rec); p.rate = 24; return; }
  if (c.f.shoot === 'bow') { S.aim(m, p, c); p.rate = 24; return; }
  stance(p, c.f);
  const rec = Math.exp(-c.t * 14);
  p.rate = 22;
  if (c.f.shoot === 'rifle') { p.aim = 1; p.set(CH, 0.05, 0.25); p.set(HD, 0, -0.2); p.set(H, 0.04, 0.2, 0); p.add(CH, -0.04 * rec); return; }
  p.set(AR, -1.52 + 0.14 * rec, 0, -0.1); p.set(ER, -0.06); p.set(WR, c.f.shoot === 'web' ? -0.5 * rec : 0);
  p.set(AL, -0.75, 0, 0.45); p.set(EL, -1.5);
  p.set(CH, 0.05 - 0.05 * rec, 0.35); p.set(HD, 0, -0.3); p.set(H, 0.04, 0.1);
  if (c.f.stance === 'ready') { p.set(TL, -0.4, 0, 0.14); p.set(KL, 0.45); p.set(TR, 0.3, 0, -0.14); p.set(KR, 0.4); }
};
S.cast = (m, p, c) => {
  stance(p, c.f);
  const tr = Math.sin(c.tm * 40) * 0.02, e = sm(c.t / 0.2);
  p.rate = 12;
  if (c.f.castStyle === 'hex') { // arms thrust forward and out, fingers splayed
    p.mix([[AL, -1.75, 0, 0.55], [AR, -1.75, 0, -0.55], [EL, -0.25, 0, 0], [ER, -0.25, 0, 0], [CH, 0.1, 0, 0], [HD, -0.15, 0, 0], [H, 0.02, 0, 0],
      [TL, -0.28, 0, 0.18], [TR, 0.22, 0, -0.18], [KL, 0.35, 0, 0], [KR, 0.3, 0, 0], [WL, -0.5, 0, 0], [WR, -0.5, 0, 0]], e);
    p.add(AL, tr, 0, tr); p.add(AR, -tr, 0, tr);
    return;
  }
  p.mix([[AL, -2.7, 0, 0.75], [AR, -2.7, 0, -0.75], [EL, -0.3, 0, 0], [ER, -0.3, 0, 0], [CH, -0.22, 0, 0], [HD, -0.45, 0, 0], [H, -0.04, 0, 0],
    [TL, -0.1, 0, 0.22], [TR, 0.1, 0, -0.22], [KL, 0.2, 0, 0], [KR, 0.2, 0, 0], [WL, -0.3, 0, 0], [WR, -0.3, 0, 0]], e);
  p.add(AL, tr, 0, tr); p.add(AR, -tr, 0, tr);
};
S.stunned = (m, p, c) => {
  stance(p, m._stunProf || (m._stunProf = { ...c.f, stance: 'thug' }));
  const w = Math.sin(c.tm * 5);
  p.rate = 10;
  p.set(CH, 0.4, w * 0.12, w * 0.1); p.set(NK, 0.3, 0, w * 0.15); p.set(HD, 0.35, 0, -w * 0.25);
  p.set(AL, -0.3, 0, 0.3); p.set(AR, -0.2, 0, -0.35); p.set(EL, -0.5); p.set(ER, -0.7);
  p.set(TL, -0.35, 0, 0.12); p.set(KL, 0.6 + w * 0.1); p.set(TR, 0.1, 0, -0.12); p.set(KR, 0.5 - w * 0.1);
  p.set(H, 0.15, w * 0.15, w * 0.08);
};
S.dead = (m, p, c) => {
  p.ground = false; p.flat = 0; p.rate = 5.5;
  const roll = m.deadRoll ?? 0;
  const t = sm(c.t / 0.55);
  p.set(H, -Math.PI / 2 * t, 0, roll * t);
  p.pos(0, 0.17 * m.dims.k - m.hipsBase + 0.0, 0);
  p.hp[1] = lerp(0, p.hp[1], t);
  p.set(AL, 0.1, 0, 0.8); p.set(AR, 0.2, 0, -0.9); p.set(EL, -0.2); p.set(ER, -0.35);
  p.set(TL, 0, 0, 0.18); p.set(TR, 0, 0, -0.22); p.set(KL, 0.1); p.set(KR, 0.15); p.set(HD, 0.15, 0.3, 0.1);
  p.set(FL, 0.4); p.set(FR, 0.3);
};

// states where the hunter holds the rifle with both hands (IK)
const RIFLE_STATES = new Set(['idle', 'run', 'sprint', 'shoot', 'aim', 'jump', 'fall', 'land', 'swing', 'hover', 'fly', 'glide', 'zip', 'wallrun', 'wallidle']);

// ------------------------------------------------------------------ model
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _mat = new THREE.Matrix4();
const _pq = new THREE.Quaternion(), _ax = new V3(1, 0, 0), _t3 = new V3(), _pole = new V3(), _a = new V3(), _b = new V3(), _u = new V3(), _f = new V3(), _n = new V3(), _X = new V3(), _Y = new V3(), _Z = new V3(), _E = new V3(), _perp = new V3();

export class ProcModel {
  /**
   * @param {string} id
   * @param {object} rig  from buildRig
   * @param {object} cfg  { prof, variants:{name:{slot:Material}}, variant, hooks:{update(ctx)}, rifle:{node,gripR,gripL} }
   */
  constructor(id, rig, cfg = {}) {
    this.id = id; this.rig = rig; this.group = rig.group; this.dims = rig.dims; this.height = rig.height;
    this.hipsBase = rig.hipsY;
    const j = rig.joints;
    this.j = j;
    this.handR = rig.handR; this.handL = rig.handL; this.chest = rig.chestPt; this.head = j[J.HD];
    this.footL = j[J.FL]; this.footR = j[J.FR];
    this.customRotation = false;
    this.prof = { ...PROF, ...(cfg.prof || {}) };
    this.variants = cfg.variants || null;
    this.variant = null;
    this.hooks = cfg.hooks || null;
    this.rifleCfg = cfg.rifle || null;
    this.parts = [];
    this.pose = new Pose();
    this.cur = new Float32Array(NJ * 3); this.hpCur = new Float32Array(3);
    this.phase = Math.random() * 6.28; this.time = Math.random() * 10;
    this.state = 'idle'; this.swingArm = Math.random() < 0.5 ? 1 : -1; this.flipDir = 1; this.deadRoll = (Math.random() - 0.5) * 0.5;
    this.groundK = 1; this.lastYaw = null; this.yawRate = 0;
    this.vl = new V3(); this.webDir = null; this.tintAmt = 0; this._tint = new THREE.Color(); this._clones = new Map();
    this.thrusters = []; this.extra = {};
    this.seed = Math.random() * 20; this.fallSpeed = 8; this.vel = new Float32Array(NJ * 3); this.hpVel = new Float32Array(3); this._sp = 0; this._acc = 0; this._look = 0; this._lookP = 0; this._aimP = 0;
    this.draw = 0; this._rec = 0; this._al = 0; this._ikp = 0; this._ikr = { x: 0, y: 0, z: 0, e: 0 }; this._cq = new THREE.Quaternion(); this._hq = new THREE.Quaternion();
    this.sx = this.sy = 1;
    this._ctx = { t: 0, sp: 0, dt: 0.016, tm: 0, vl: this.vl, st: 'idle', f: this.prof, yawRate: 0, m: this };
  }

  /** call once after the builder finished: jumps joints to the idle pose */
  snap() {
    this.update(0.016, { state: 'idle', t: 0, speed: 0 }, null);
    this.cur.set(this.pose.r); this.hpCur.set(this.pose.hp); this.vel.fill(0);
    this.groundK = 1;
    this.update(0.016, { state: 'idle', t: 0, speed: 0 }, null);
    this.group.updateMatrixWorld(true);
  }

  /** register a mesh (shared geometry/material) for variants, shadows and tint */
  reg(mesh, slot, o = {}) {
    mesh.castShadow = o.cast ?? true; mesh.receiveShadow = false;
    if (slot) mesh.userData.slot = slot;
    if (o.only) mesh.userData.only = o.only;
    mesh.userData.mat = mesh.material;
    this.parts.push(mesh);
    return mesh;
  }

  setVariant(name) {
    if (!this.variants || !this.variants[name]) return;
    this.variant = name;
    const map = this.variants[name];
    for (const m of this.parts) {
      const s = m.userData.slot;
      if (s && map[s]) { m.userData.mat = map[s]; }
      if (m.userData.only) m.visible = m.userData.only === name;
      m.material = this._matFor(m.userData.mat);
    }
    this.onVariant?.(name);
  }
  _matFor(mat) {
    if (this.tintAmt <= 0.001 || !mat.emissive || mat.isMeshBasicMaterial) return mat;
    let c = this._clones.get(mat);
    if (!c) { c = mat.clone(); c.userData.baseEm = mat.emissive.clone(); c.userData.baseI = mat.emissiveIntensity ?? 1; this._clones.set(mat, c); }
    c.emissive.copy(c.userData.baseEm).lerp(this._tint, this.tintAmt);
    c.emissiveIntensity = lerp(c.userData.baseI, 1.6, this.tintAmt);
    return c;
  }
  setTint(color, amount = 0) {
    const a = clamp(amount, 0, 1);
    if (a < 0.002 && this.tintAmt < 0.002) return;
    if (color !== undefined && color !== null) { this._tc = this._tc ?? new THREE.Color(); this._tc.set(color); if (this._tcHex === this._tc.getHex() && Math.abs(a - this.tintAmt) < 0.004) return; this._tcHex = this._tc.getHex(); }
    this.tintAmt = clamp(amount, 0, 1);
    if (color !== undefined && color !== null) this._tint.set(color);
    for (const m of this.parts) m.material = this._matFor(m.userData.mat);
  }

  // ---- hammer hooks etc. are installed by character builders on the instance.

  update(dt, anim, entity) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    const st = (anim && anim.state) || 'idle';
    if (st !== this.state) this._stateChange(this.state, st);
    this.time += dt;
    const t = anim && anim.t !== undefined ? anim.t : 0;
    const sp = anim && anim.speed ? anim.speed : 0;
    // local velocity / turn rate
    if (entity && entity.vel && !this.customRotation) {
      const sy = Math.sin(entity.yaw || 0), cy = Math.cos(entity.yaw || 0), v = entity.vel;
      this.vl.set(v.x * cy - v.z * sy, v.y, v.x * sy + v.z * cy);
    } else if (entity && entity.vel) this.vl.set(0, entity.vel.y, Math.hypot(entity.vel.x, entity.vel.z));
    else this.vl.set(0, 0, 0);
    if (entity && entity.yaw !== undefined && dt > 0) {
      if (this.lastYaw !== null) { let d = entity.yaw - this.lastYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yawRate = lerp(this.yawRate, d / dt, 1 - Math.exp(-8 * dt)); }
      this.lastYaw = entity.yaw;
    }
    // web anchor
    this.webDir = null;
    if (st === 'swing' && entity) {
      if (entity.swingSide) this.swingArm = entity.swingSide > 0 ? 1 : -1;
      const anc = entity.swingAnchor || entity.anchor || entity.webAnchor;
      if (anc && anc.isVector3) {
        const g = this.group.position, sy = Math.sin(entity.yaw || 0), cy = Math.cos(entity.yaw || 0);
        const dx = anc.x - g.x, dy = anc.y - (g.y + this.height * 0.8), dz = anc.z - g.z;
        const d = _a.set(dx * cy - dz * sy, dy, dx * sy + dz * cy).normalize();
        if (d.y > 0.97) d.x += 0.15 * this.swingArm;
        this.webDir = (this._wd ||= new V3()).copy(d).normalize();
      }
    }

    const cam = entity && entity.game && entity.game.cam;
    const spH = Math.hypot(this.vl.x, this.vl.z);
    if (dt > 0) { this._acc = lerp(this._acc, clamp((spH - this._sp) / dt, -40, 40), 1 - Math.exp(-6 * dt)); this._sp = spH; }
    this._aimP += (((st === 'aim' || st === 'shoot') && cam ? clamp(cam.pitch || 0, -1.0, 0.9) : 0) - this._aimP) * (1 - Math.exp(-10 * dt));
    // bow draw / gun recoil envelopes
    this.draw += ((st === 'aim' ? 1 : 0) - this.draw) * (1 - Math.exp(-(st === 'shoot' ? 45 : st === 'aim' ? 6 : 8) * dt));
    this._rec *= Math.exp(-14 * dt);
    const p = this.pose; p.reset();
    const c = this._ctx; c.t = t; c.sp = sp; c.dt = dt; c.tm = this.time; c.st = st; c.yawRate = this.yawRate;
    (S[st] || S.idle)(this, p, c);

    // turn / acceleration lean (grounded locomotion only)
    if (p.ground && (st === 'run' || st === 'sprint' || st === 'charge' || st === 'idle')) {
      const mv = clamp(spH / 8, 0, 1);
      p.r[H * 3] += clamp(this._acc * 0.010, -0.1, 0.14) * mv; p.r[H * 3 + 2] += -clamp(this.yawRate * 0.028, -0.3, 0.3) * mv;
    }
    if (st.charAt(0) === 'p' && st.length === 6 || st === 'kick' || st === 'uppercut' || st === 'throw' || st === 'catch' || st === 'smash') p.zeta = Math.min(p.zeta, 0.58);
    // critically (or slightly under-) damped spring per joint: overshoot + follow-through
    const k = 1 - Math.exp(-p.rate * (this.prof.tempo || 1) * dt);
    const cur = this.cur, tr = p.r, vel = this.vel;
    {
      const om = p.rate * (this.prof.tempo || 1) * 1.35, zz = p.zeta;
      const n = Math.min(8, Math.max(1, Math.ceil(om * dt / 0.4))), h = dt / n, o2 = om * om, zo = 2 * zz * om;
      for (let sp2 = 0; sp2 < n; sp2++) for (let i = 0; i < NJ * 3; i++) { vel[i] += (o2 * (tr[i] - cur[i]) - zo * vel[i]) * h; cur[i] += vel[i] * h; }
    }
    for (let i = 0; i < 3; i++) this.hpCur[i] += (p.hp[i] - this.hpCur[i]) * k;

    // rifle IK (hunter)
    if (this.rifleCfg) this._rifle(p, st, dt, k);
    // pose-driven arm IK (aim / bow)
    this._ikp += ((p.ikOn[0] || p.ikOn[1] ? 1 : 0) - this._ikp) * (1 - Math.exp(-14 * dt));
    if (this._ikp > 0.01) {
      for (let sd = 0; sd < 2; sd++) {
        if (!p.ikOn[sd]) continue;
        const i = sd * 3, aj = sd ? AL : AR, ej = sd ? EL : ER;
        _t3.set(p.ikT[i], p.ikT[i + 1], p.ikT[i + 2]); _pole.set(p.ikP[i], p.ikP[i + 1], p.ikP[i + 2]);
        const r = this._solveArm(this.j[aj].position, _t3, sd ? 1 : -1, _pole), w = this._ikp, ci = aj * 3;
        cur[ci] = lerp(cur[ci], r.x, w); cur[ci + 1] = lerp(cur[ci + 1], r.y, w); cur[ci + 2] = lerp(cur[ci + 2], r.z, w);
        cur[ej * 3] = lerp(cur[ej * 3], r.e, w); vel[ci] = vel[ci + 1] = vel[ci + 2] = vel[ej * 3] = 0;
      }
    }

    // ground snapping
    const d = this.dims;
    const hx = cur[H * 3];
    const eff = (tj, kj) => {
      const tx = hx + cur[tj * 3], kx = cur[kj * 3], tz = cur[tj * 3 + 2];
      return (d.thigh * Math.cos(tx) + d.shin * Math.cos(tx + kx)) * Math.cos(tz);
    };
    const need = Math.max(eff(TL, KL), eff(TR, KR)) + d.footH + d.drop;
    this.groundK += ((p.ground ? 1 : 0) - this.groundK) * (1 - Math.exp(-14 * dt));
    const freeY = this.hipsBase + this.hpCur[1];
    const snapY = need + this.hpCur[1];
    const hy = lerp(freeY, snapY, this.groundK);

    // apply
    const J_ = this.j;
    for (let i = 0; i < NJ; i++) J_[i].rotation.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]);
    J_[H].position.set(this.hpCur[0], hy, this.hpCur[2]);
    // head looks toward the camera aim; torso follows a little
    let ly = 0, lp = 0;
    if (cam && cam.forward && st !== 'dead' && st !== 'dodge' && st !== 'wallrun' && st !== 'wallidle') {
      let rel = Math.atan2(cam.forward.x, cam.forward.z) - (entity.yaw || 0); rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      ly = clamp(rel, -1.0, 1.0) * (p.ground ? 1 : 0.5); lp = clamp(cam.pitch || 0, -0.8, 0.8);
    }
    this._look += (ly - this._look) * (1 - Math.exp(-7 * dt)); this._lookP += (lp - this._lookP) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this._look) > 0.002 || Math.abs(this._lookP) > 0.002) {
      J_[HD].rotation.y += this._look * 0.4; J_[NK].rotation.y += this._look * 0.2; J_[CH].rotation.y += this._look * 0.08;
      J_[HD].rotation.x -= this._lookP * 0.35 * (st === 'aim' || st === 'shoot' ? 0.4 : 1);
    }
    // foot flatten
    const fl = p.flat * this.groundK;
    J_[FL].rotation.x = cur[FL * 3] + -(hx + cur[TL * 3] + cur[KL * 3]) * fl;
    J_[FR].rotation.x = cur[FR * 3] + -(hx + cur[TR * 3] + cur[KR * 3]) * fl;

    // keep the right hand's frame aligned with the character (so +Z of a gun parented to handR points forward)
    const alWant = (st === 'aim' || st === 'shoot') && this.prof.alignHand !== 'none' ? 1 : 0;
    this._al += (alWant - this._al) * (1 - Math.exp(-16 * dt));
    if (this._al > 0.01 || this.handR.quaternion.w < 0.9999) {
      if (this._al <= 0.01) this.handR.quaternion.identity();
      else {
        const q = this._cq.copy(J_[H].quaternion).multiply(J_[SP].quaternion).multiply(J_[CH].quaternion).multiply(J_[AR].quaternion).multiply(J_[ER].quaternion).multiply(J_[WR].quaternion);
        q.invert().multiply(_pq.setFromAxisAngle(_ax, -this._aimP));
        this.handR.quaternion.identity().slerp(q, this._al);
      }
    }

    if (this.hooks && this.hooks.update) this.hooks.update(c, this);
  }

  _stateChange(prev, next) {
    if (prev === 'dodge' && this.cur) this.cur[H * 3] = ((this.cur[H * 3] % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (next === 'swing' && !this._fixedSide) this.swingArm *= -1;
    if (next === 'dodge') this.flipDir = 1;
    if (next !== 'wallrun' && next !== 'wallidle') this.extra.wall = 0;
    this.state = next;
  }

  _rifle(p, st, dt, k) {
    const rc = this.rifleCfg; const node = rc.node;
    const ik = RIFLE_STATES.has(st) ? 1 : 0;
    this._ik = lerp(this._ik ?? 0, ik, 1 - Math.exp(-12 * dt));
    this._aim = lerp(this._aim ?? 0, p.aim, 1 - Math.exp(-14 * dt));
    const a = this._aim;
    node.position.set(lerp(rc.carry.pos[0], rc.aim.pos[0], a), lerp(rc.carry.pos[1], rc.aim.pos[1], a), lerp(rc.carry.pos[2], rc.aim.pos[2], a));
    node.rotation.set(lerp(rc.carry.rot[0], rc.aim.rot[0], a), lerp(rc.carry.rot[1], rc.aim.rot[1], a), 0);
    if (this._ik < 0.02) { node.visible = true; return; }
    node.updateMatrix();
    const shR = this.j[J.AR].position, shL = this.j[J.AL].position;
    const tR = _b.copy(rc.gripR).applyMatrix4(node.matrix).clone();
    const tL = _a.copy(rc.gripL).applyMatrix4(node.matrix).clone();
    const ikR = { ...this._solveArm(shR, tR, -1) }, ikL = { ...this._solveArm(shL, tL, 1) };
    const w = this._ik;
    for (const [side, r, aj, ej] of [[-1, ikR, AR, ER], [1, ikL, AL, EL]]) {
      if (!r) continue;
      const i = aj * 3, ei = ej * 3;
      this.cur[i] = lerp(this.cur[i], r.x, w); this.cur[i + 1] = lerp(this.cur[i + 1], r.y, w); this.cur[i + 2] = lerp(this.cur[i + 2], r.z, w);
      this.cur[ei] = lerp(this.cur[ei], r.e, w);
      this.vel[i] = this.vel[i + 1] = this.vel[i + 2] = this.vel[ei] = 0;
    }
  }

  /** two-bone IK in chest space; returns euler for shoulder + elbow flexion */
  _solveArm(sh, target, side, pole) {
    const A = this.dims.upper, B = this.dims.fore + this.dims.hand * 0.35;
    const d = _f.copy(target).sub(sh); let dist = d.length();
    dist = clamp(dist, Math.abs(A - B) + 0.01, A + B - 0.005);
    d.normalize();
    const cosB = clamp((A * A + dist * dist - B * B) / (2 * A * dist), -1, 1), beta = Math.acos(cosB);
    if (pole) _perp.copy(pole); else _perp.set(side * 0.55, -1, -0.35);
    _perp.normalize();
    _perp.addScaledVector(d, -_perp.dot(d)).normalize();
    _E.copy(sh).addScaledVector(d, A * cosB).addScaledVector(_perp, A * Math.sin(beta));
    _u.copy(_E).sub(sh).normalize();
    const T = _n.copy(sh).addScaledVector(d, dist);
    const fdir = _Z.copy(T).sub(_E).normalize();
    const eAng = Math.acos(clamp(_u.dot(fdir), -1, 1));
    const nrm = _X.crossVectors(_u, fdir);
    if (nrm.lengthSq() < 1e-8) nrm.set(1, 0, 0);
    nrm.normalize();
    _X.copy(nrm).negate();
    _Y.copy(_u).negate();
    _Z.crossVectors(_X, _Y);
    _mat.makeBasis(_X, _Y, _Z);
    _q.setFromRotationMatrix(_mat);
    _e.setFromQuaternion(_q, 'XYZ');
    const e = eAng;
    const o = this._ikr; o.x = _e.x; o.y = _e.y; o.z = _e.z; o.e = -e;
    return o;
  }

  dispose() {
    this.group.removeFromParent();
    for (const c of this._clones.values()) c.dispose();
    this._clones.clear();
    this.hooks?.dispose?.(this);
  }
}
