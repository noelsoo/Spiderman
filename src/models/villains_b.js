// Villain models (batch B): Green Goblin (+ glider, drone), Loki (+ illusion), Ultron (+ drone), Carnage (+ crawler).
// Same procedural rig as the heroes. Per-entity control channels live in `model.fx` (plain numbers written by the AI):
//   goblin   fx.glider 0..1 (riding)         ultron   fx.jet 0..1                carnage  fx.whip 0..1, fx.whipAng -1..1, fx.rage 0..1
//   loki     fx.glint 0..1 (real-one tell)   all      setVariant('symbiote'|'infected') where the boss has a phase-3 look
import * as THREE from 'three';
import { registerModel } from './index.js';
import { buildRig, makeDims, ProcModel, J } from './rig.js';
import {
  G, std, metal, glow, phys, withRim, symMat, sphereGeo, boxGeo, cylGeo, coneGeo, mergeParts, rng, seg,
  fabricNormal, grainNormal, drawTex, Tendril,
} from './common.js';
import { P, addHook, buildBody, addFace, finish } from './characters.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2;
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;
const fab = (name = 'vbfab', p = 6) => ({ normalMap: fabricNormal(p, 0.55, name), normalScale: new V2(0.7, 0.7) });
const cloth = (color, o = {}) => std(color, { roughness: 0.82, ...fab(), ...o });
const leather = (color, o = {}) => std(color, { roughness: 0.7, normalMap: grainNormal('leather', 5, 2.4), normalScale: new V2(0.9, 0.9), ...o });

// ===================================================================== PropModel (non-humanoid: drones etc.)
class PropModel {
  constructor(id, height) {
    this.id = id; this.height = height; this.group = new THREE.Group();
    this.handR = new THREE.Object3D(); this.handL = new THREE.Object3D(); this.chest = new THREE.Object3D(); this.head = new THREE.Object3D();
    this.group.add(this.handR, this.handL, this.chest, this.head);
    this.footL = new THREE.Object3D(); this.footR = new THREE.Object3D();
    this.customRotation = false; this.thrusters = [];
    this.fx = {}; this._mats = new Map(); this._tint = new THREE.Color(); this.tintAmt = 0; this.t = Math.random() * 10; this.ticks = [];
    this.parts = [];
  }
  own(mat) {
    if (mat.isMeshBasicMaterial) return mat;
    let c = this._mats.get(mat);
    if (!c) { c = mat.clone(); c.userData.baseEm = c.emissive ? c.emissive.clone() : null; c.userData.baseI = c.emissiveIntensity ?? 1; this._mats.set(mat, c); }
    return c;
  }
  add(parent, geo, mat, o = {}) {
    const m = new THREE.Mesh(geo, this.own(mat));
    if (o.pos) m.position.set(...o.pos);
    if (o.rot) m.rotation.set(...o.rot);
    if (o.scale) { if (typeof o.scale === 'number') m.scale.setScalar(o.scale); else m.scale.set(...o.scale); }
    m.castShadow = o.cast ?? true;
    parent.add(m); this.parts.push(m);
    return m;
  }
  setVariant() {}
  setTint(color, amount = 0) {
    const a = clamp(amount, 0, 1);
    if (a < 0.002 && this.tintAmt < 0.002) return;
    this.tintAmt = a; if (color !== undefined && color !== null) this._tint.set(color);
    for (const c of this._mats.values()) {
      if (!c.userData.baseEm) continue;
      c.emissive.copy(c.userData.baseEm).lerp(this._tint, a);
      c.emissiveIntensity = lerp(c.userData.baseI, 1.6, a);
    }
  }
  update(dt, anim, entity) {
    dt = Math.min(Math.max(dt, 0), 0.05); this.t += dt;
    for (const f of this.ticks) f(dt, anim, entity, this);
  }
  dispose() { this.group.removeFromParent(); for (const c of this._mats.values()) c.dispose(); this._mats.clear(); }
}

/** forward/side speed of an entity in its own frame */
function localVel(entity, out) {
  if (!entity || !entity.vel) return out.set(0, 0, 0);
  const sy = Math.sin(entity.yaw || 0), cy = Math.cos(entity.yaw || 0), v = entity.vel;
  return out.set(v.x * cy - v.z * sy, v.y, v.x * sy + v.z * cy);
}
const _lv = new V3();

// ===================================================================== shared pieces
/** one static tapered tube (horns, spikes...) */
function staticTube(model, parent, mat, segs, r0, r1, fn) {
  const t = new Tendril({ segs, radial: 6, r0, r1, material: mat, ref: new V3(0, 0, 1) });
  t.update(fn);
  t.mesh.castShadow = true;
  parent.add(t.mesh);
  addHook(model, null, () => t.dispose());
  return t;
}

/** lagged-chain cape hung from a joint (compact port of the hero cloth) */
function addCape(model, joint, o) {
  const { R = 7, C = 2, len, w0, w1, anchor, mat, ph = 0 } = o;
  const geo = new THREE.PlaneGeometry(1, 1, C, R);
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.castShadow = true;
  joint.add(mesh); model.parts.push(mesh); mesh.userData.mat = mat;
  const ang = new Float32Array(R + 1).fill(0.1), rol = new Float32Array(R + 1), cp = new Float32Array((R + 1) * 3);
  addHook(model, (c) => {
    const dt = c.dt, v = c.vl;
    const speedK = clamp(Math.hypot(v.x, v.z) / 12, 0, 1);
    let a0 = 0.1 + clamp(v.z * 0.05, -0.1, 1.1);
    if (c.st === 'idle') a0 += Math.sin(c.tm * 1.3 + ph) * 0.04;
    if (c.st === 'dead') a0 = 0.02;
    const r0 = clamp(v.x * 0.03 + c.yawRate * 0.07, -0.7, 0.7);
    ang[0] += (a0 - ang[0]) * (1 - Math.exp(-10 * dt)); rol[0] += (r0 - rol[0]) * (1 - Math.exp(-10 * dt));
    for (let i = 1; i <= R; i++) {
      const lag = 1 - Math.exp(-(15 - i * 1.2) * dt);
      ang[i] += (ang[i - 1] + Math.sin(c.tm * 6 + i * 0.9 + ph) * (0.02 + 0.08 * speedK) * (i / R) * 2 - ang[i]) * lag;
      rol[i] += (rol[i - 1] + Math.sin(c.tm * 4.3 + i * 0.7 + ph) * 0.03 * (speedK + 0.2) - rol[i]) * lag;
    }
    let x = anchor.x, y = anchor.y, z = anchor.z; const sg = len / R;
    for (let i = 0; i <= R; i++) {
      cp[i * 3] = x; cp[i * 3 + 1] = y; cp[i * 3 + 2] = z;
      x += Math.sin(rol[i]) * sg; y -= Math.cos(ang[i]) * Math.cos(rol[i]) * sg; z -= Math.sin(ang[i]) * sg;
    }
    const pos = geo.attributes.position;
    for (let j = 0; j <= R; j++) {
      const w = lerp(w0, w1, j / R);
      for (let i = 0; i <= C; i++) {
        const u = i / C * 2 - 1;
        const bl = -(1 - u * u) * 0.05 * Math.sin((j / R) * Math.PI) * (1 + speedK * 1.5);
        pos.setXYZ(j * (C + 1) + i, cp[j * 3] + u * w * 0.5 * Math.cos(rol[j]), cp[j * 3 + 1], cp[j * 3 + 2] + bl);
      }
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  }, () => geo.dispose());
  return mesh;
}

// ===================================================================== GREEN GOBLIN
function batWingGeo() {
  return G('vb_batwing', () => {
    const s = new THREE.Shape();
    s.moveTo(0.1, 0.55); s.lineTo(0.9, 0.5); s.lineTo(1.9, -0.02); s.lineTo(1.6, -0.1);
    s.lineTo(1.55, -0.4); s.lineTo(1.2, -0.2); s.lineTo(1.05, -0.55); s.lineTo(0.7, -0.28); s.lineTo(0.45, -0.7); s.lineTo(0.1, -0.62); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
    g.rotateX(Math.PI / 2);          // shape y -> +z (forward), thickness -> -y
    g.translate(0, 0.0175, 0);
    return g;
  });
}
const GLIDER_METAL = () => std(0x3a8a48, { roughness: 0.45, metalness: 0.2, emissive: 0x0c3a18, emissiveIntensity: 0.6 });
const GLIDER_WING = () => std(0x6a2fa8, { roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide, emissive: 0x20083a, emissiveIntensity: 0.7 });

function buildGlider(model) {
  const g = new THREE.Group(); g.name = 'glider';
  const add = (geo, mat, o = {}) => {
    const m = new THREE.Mesh(geo, mat);
    if (o.pos) m.position.set(...o.pos); if (o.rot) m.rotation.set(...o.rot); if (o.scale) m.scale.set(...o.scale);
    m.castShadow = true; g.add(m); return m;
  };
  const metalM = GLIDER_METAL(), wingM = GLIDER_WING();
  add(sphereGeo(1, seg(16, 8), seg(8, 6)), metalM, { pos: [0, -0.02, 0.05], scale: [0.4, 0.07, 1.15] });                 // deck
  for (const s of [1, -1]) {
    const w = add(batWingGeo(), wingM, { pos: [s * 0.22, 0.0, -0.1], rot: [0, 0, s * 0.09], scale: [s * 0.72, 1, 0.8] });       // bat wings
    w.userData.wing = s;
    add(cylGeo(0.09, 0.11, 0.55, 10), metalM, { pos: [s * 0.27, -0.06, -0.85], rot: [Math.PI / 2, 0, 0] });                  // engine pods
    add(coneGeo(0.045, 0.22, 4), metalM, { pos: [s * 0.1, 0.03, 1.12], rot: [-0.6, 0, s * 0.1] });                            // bat ears
  }
  add(sphereGeo(1, 10, 8), metalM, { pos: [0, -0.02, 1.08], scale: [0.13, 0.1, 0.17] });                                       // bat head
  const jet = add(coneGeo(0.17, 0.95, 8), glow(0xa6ff3c, 2.4, { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), { pos: [0, -0.04, -1.5], rot: [-Math.PI / 2, 0, 0] });
  jet.castShadow = false;
  g.userData.jet = jet;
  return g;
}

export function buildGoblin() {
  const dims = makeDims(1.0, { headR: 0.118 });
  const rig = buildRig(dims, 1.1);
  const green = metal(0x2f7d3c, { roughness: 0.34 }), greenD = metal(0x1b4a26, { roughness: 0.4 });
  const purple = cloth(0x5b2a8e), skinM = leather(0x15151a), maskM = metal(0x3c9a44, { roughness: 0.3 });
  const symA = symMat({ id: 'gobsym', color: 0x050509, rim: 0x9a3cff, rimK: 0.8, rough: 0.18 });
  const symB = symMat({ id: 'gobsym2', color: 0x08060c, rim: 0x70ff50, rimK: 0.55, rough: 0.2 });
  const model = new ProcModel('goblin', rig, {
    prof: { stance: 'ready', cadence: 1.05, stride: 1.0, armSwing: 0.9, lean: 1.2, flipDodge: false, hover: 'iron', flyStyle: 'iron', tempo: 1.1 },
    variants: {
      normal: { armor: green, tunic: purple, mask: maskM, armorD: greenD, eyes: glow(0xffe23a, 3) },
      symbiote: { armor: symA, tunic: symB, mask: symA, armorD: symA, eyes: glow(0xff40ff, 3) },
    },
  });
  model.customRotation = true;
  model.fx = { glider: 1, glint: 0 };
  const info = buildBody(model, {
    mats: { armor: green, tunic: purple, mask: maskM, armorD: greenD, hand: skinM, foot: skinM, default: purple },
    slots: { chest: 'armor', shoulder: 'armor', foreArm: 'armorD', shin: 'armorD', abdomen: 'tunic', pelvis: 'tunic', upperArm: 'tunic', thigh: 'tunic', head: 'mask', neck: 'mask' },
    torso: { sx: 1.3, sz: 0.85, chestR: 1.1, waistR: 0.95 },
    head: { R: 0.118, sx: 0.88, sy: 1.18, sz: 0.95 },
    arm: { u0: 0.055, u1: 0.047, f0: 0.05, f1: 0.04, ub: 0.1, fb: 0.14, shoulder: 1.25 },
    leg: { t0: 0.088, t1: 0.062, s0: 0.062, s1: 0.045, tb: 0.06, sb: 0.12 },
    foot: [0.058, 0.05, 0.15], hand: [0.045, 0.058, 0.052], pelvis: [0.38, 0.22, 0.27],
  });
  const k = dims.k, hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  // glowing yellow eyes (angled slits), pointed nose/chin, ears, hood
  const eyeM = glow(0xffe23a, 3);
  for (const s of [1, -1]) {
    P(model, hj, sphereGeo(1, 10, 8), eyeM, { slot: 'eyes', pos: [s * hr * 0.4, H.y0 + hr * 0.12, hr * 0.84], scale: [hr * 0.3, hr * 0.13, hr * 0.12], rot: [0, 0, -s * 0.38], cast: false });
    P(model, hj, coneGeo(0.03 * k, 0.17 * k, 4), maskM, { pos: [s * (hr * H.sx + 0.015 * k), H.y0 + hr * 0.12, -hr * 0.1], rot: [0, 0, -s * 1.15] });   // pointed ears
  }
  P(model, hj, coneGeo(0.03 * k, 0.1 * k, 5), maskM, { pos: [0, H.y0 - hr * 0.1, hr * 1.0], rot: [Math.PI / 2, 0, 0] });                         // nose
  P(model, hj, coneGeo(0.05 * k, 0.12 * k, 5), maskM, { pos: [0, H.y0 - hr * 1.15, hr * 0.5], rot: [Math.PI + 0.45, 0, 0] });                    // chin
  const hoodM = cloth(0x4a1f78);
  P(model, hj, G('vb_hood', () => new THREE.SphereGeometry(1, seg(16, 8), seg(10, 6), 0, Math.PI * 2, 0, Math.PI * 0.62)), hoodM, { pos: [0, H.y0 + hr * 0.18, -hr * 0.2], scale: [hr * 1.12, hr * 1.18, hr * 1.12] });
  P(model, hj, coneGeo(0.05 * k, 0.28 * k, 6), hoodM, { pos: [0, H.y0 + hr * 1.35, -hr * 0.95], rot: [-1.15, 0, 0] });                            // hood tail
  // armour details: belt, shoulder spikes, forearm blades
  P(model, model.j[J.SP], cylGeo(0.15 * k, 0.15 * k, 0.05 * k, seg(14, 8)), leather(0x2a1a10), { pos: [0, 0.02 * k, 0], scale: [1.3, 1, 0.84] });
  for (const s of [1, -1]) {
    P(model, model.j[s > 0 ? J.AL : J.AR], coneGeo(0.03 * k, 0.17 * k, 5), greenD, { pos: [s * 0.045 * k, 0.1 * k, 0], rot: [0, 0, -s * 0.9] });
  }
  // glider
  const glider = buildGlider(model);
  model.group.add(glider);
  model.glider = glider;
  model.setVariant('normal');
  let gl = 1;
  const wings = glider.children.filter((c) => c.userData.wing);
  addHook(model, (c, m) => {
    const tgt = clamp(m.fx.glider, 0, 1);
    gl += (tgt - gl) * (1 - Math.exp(-9 * c.dt));
    glider.visible = gl > 0.03;
    glider.scale.setScalar(Math.max(0.01, gl));
    const j = glider.userData.jet;
    if (j) { const f = 0.85 + Math.sin(c.tm * 40) * 0.1 + Math.random() * 0.1; j.scale.set(f, f * 1.1, f); }
    for (const w of wings) w.rotation.z = w.userData.wing * (0.09 + Math.sin(c.tm * 2.2) * 0.03);
    // surf stance while riding: bent knees, forward lean, arms out for balance
    if (gl > 0.5) {
      const J_ = m.j, a = clamp((gl - 0.5) * 2, 0, 1);
      J_[J.KL].rotation.x += 0.42 * a; J_[J.KR].rotation.x += 0.5 * a;
      J_[J.TL].rotation.x -= 0.3 * a; J_[J.TR].rotation.x -= 0.34 * a;
      J_[J.H].rotation.x += 0.12 * a; J_[J.H].position.y -= 0.2 * a;
      if (c.st === 'hover' || c.st === 'fly' || c.st === 'idle') { J_[J.AL].rotation.z += 0.45 * a; J_[J.AR].rotation.z -= 0.45 * a; }
    }
  });
  return finish(model, 'normal');
}

export function buildGoblinDrone() {
  const m = new PropModel('goblin_drone', 1.0);
  const body = new THREE.Group(); m.group.add(body); body.position.y = 0.5;
  const metalM = metal(0x244a30, { roughness: 0.4 }), purple = std(0x5b2a8e, { roughness: 0.5, metalness: 0.3 });
  m.add(body, sphereGeo(1, 14, 10), metalM, { scale: [0.3, 0.2, 0.46] });
  m.add(body, sphereGeo(1, 10, 8), glow(0xff4020, 2.8), { pos: [0, 0.02, 0.4], scale: [0.1, 0.07, 0.08], cast: false });
  for (const s of [1, -1]) {
    const w = m.add(body, batWingGeo(), GLIDER_WING(), { pos: [s * 0.2, 0.05, -0.1], scale: [s * 0.32, 1, 0.32] });
    w.userData.side = s; m.ticks.push((dt, a, e, mm) => { w.rotation.z = s * (0.1 + Math.sin(mm.t * 14 + (s > 0 ? 0 : 1)) * 0.28); });
    m.add(body, coneGeo(0.03, 0.2, 4), metalM, { pos: [s * 0.1, 0.18, 0.28], rot: [-0.5, 0, s * 0.2] });
    m.add(body, cylGeo(0.03, 0.03, 0.36, 6), purple, { pos: [s * 0.3, -0.08, 0.2], rot: [Math.PI / 2, 0, 0] });              // little guns
  }
  const jet = m.add(body, coneGeo(0.1, 0.45, 8), glow(0xa6ff3c, 2.4, { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), { pos: [0, -0.02, -0.62], rot: [-Math.PI / 2, 0, 0], cast: false });
  m.handR.position.set(0, 0.5, 0.5); m.head.position.set(0, 0.55, 0.35); m.chest.position.set(0, 0.5, 0.2);
  m.ticks.push((dt, anim, ent, mm) => {
    body.position.y = 0.5 + Math.sin(mm.t * 4) * 0.05;
    const lv = localVel(ent, _lv);
    body.rotation.x += (clamp(lv.z * 0.035, -0.4, 0.5) - body.rotation.x) * Math.min(1, 8 * dt);
    body.rotation.z += (clamp(-lv.x * 0.04, -0.5, 0.5) - body.rotation.z) * Math.min(1, 8 * dt);
    const f = 0.9 + Math.random() * 0.25; jet.scale.set(f, f, f);
    if (ent && ent.windup > 0) m.setTint(0xff3010, 0.6); else if (!ent || ent.flash <= 0) m.setTint(null, 0);
  });
  return m;
}

// ===================================================================== LOKI
function lokiMats(illusion) {
  if (illusion) {
    const gh = M_ghost();
    return { green: gh, gold: gh, dark: gh, skin: gh, cape: gh, hair: gh, boot: gh };
  }
  return {
    green: cloth(0x1f6b45), gold: metal(0xdcb040, { roughness: 0.26 }), dark: leather(0x14181a),
    skin: std(0xe6d3c4, { roughness: 0.7 }), cape: cloth(0x14573a, { side: THREE.DoubleSide }), hair: std(0x0c0c0e, { roughness: 0.5 }), boot: leather(0x101315),
  };
}
let _ghost = null;
function M_ghost() {
  if (!_ghost) {
    _ghost = new THREE.MeshStandardMaterial({ color: 0x2fe08a, emissive: 0x18c870, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    _ghost.userData.shared = true;
  }
  return _ghost;
}

function buildLokiImpl(illusion) {
  const dims = makeDims(1.02, { headR: 0.112 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel(illusion ? 'loki_illusion' : 'loki', rig, { prof: { stance: 'ready', cadence: 0.95, stride: 1.0, armSwing: 0.8, lean: 1.0, flipDodge: false, tempo: 1.0 } });
  model.fx = { glint: 0 };
  const Mt = lokiMats(illusion);
  const info = buildBody(model, {
    mats: { chest: Mt.green, abdomen: Mt.dark, pelvis: Mt.dark, neck: Mt.skin, head: Mt.skin, shoulder: Mt.gold, upperArm: Mt.green, foreArm: Mt.gold, hand: Mt.dark, thigh: Mt.dark, shin: Mt.gold, foot: Mt.boot, default: Mt.green },
    torso: { sx: 1.18, sz: 0.78, chestR: 1.02, waistR: 0.9 },
    head: { R: 0.112, sx: 0.9, sy: 1.08, sz: 0.98 },
    arm: { u0: 0.05, u1: 0.043, f0: 0.045, f1: 0.037, ub: 0.08, fb: 0.14, shoulder: 1.2 },
    leg: { t0: 0.082, t1: 0.058, s0: 0.058, s1: 0.042, tb: 0.05, sb: 0.12 },
    foot: [0.056, 0.05, 0.15], hand: [0.04, 0.052, 0.048], pelvis: [0.36, 0.2, 0.26],
  });
  const k = dims.k, hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  if (!illusion) addFace(model, H, { tex: { skin: '#e6d3c4', iris: '#2f9a58', brow: '#0c0c0e', mood: 'smirk', stubble: 0 }, skin: Mt.skin });
  // helmet: gold cap, brow band, cheek guards, long curved horns, slicked hair
  P(model, hj, G('vb_helm', () => new THREE.SphereGeometry(1, seg(18, 8), seg(10, 6), 0, Math.PI * 2, 0, Math.PI * 0.46)), Mt.gold, { pos: [0, H.y0 + hr * 0.2, -hr * 0.04], scale: [hr * 1.06, hr * 1.1, hr * 1.1] });
  P(model, hj, G('vb_hair', () => new THREE.SphereGeometry(1, seg(14, 8), seg(8, 6), 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.5)), Mt.hair, { pos: [0, H.y0 - hr * 0.1, -hr * 0.3], scale: [hr * 0.98, hr * 1.2, hr * 0.95] });
  for (const s of [1, -1]) {
    P(model, hj, boxGeo(0.014 * k, 0.1 * k, 0.07 * k), Mt.gold, { pos: [s * hr * 0.88, H.y0 - hr * 0.35, hr * 0.28], rot: [0, s * 0.3, 0] });
    staticTube(model, hj, Mt.gold, 10, 0.026 * k, 0.004 * k, (u, out) => {
      const a = u * 1.5;
      out.set(s * (hr * 0.85 + Math.sin(a) * 0.17 * k), H.y0 + hr * 0.55 + (1 - Math.cos(a)) * 0.34 * k + u * 0.08 * k, -hr * 0.1 - u * 0.15 * k);
    });
  }
  // gold collar plate + belt
  P(model, model.j[J.CH], cylGeo(0.07 * k, 0.095 * k, 0.07 * k, seg(14, 8)), Mt.gold, { pos: [0, 0.37 * k, 0.0], scale: [1.4, 1, 1.0] });
  P(model, model.j[J.SP], cylGeo(0.13 * k, 0.13 * k, 0.045 * k, seg(14, 8)), Mt.gold, { pos: [0, 0.03 * k, 0], scale: [1.22, 1, 0.8] });
  P(model, model.j[J.CH], boxGeo(0.07 * k, 0.2 * k, 0.012 * k), Mt.gold, { pos: [0, 0.2 * k, info.chestRad(0.2 * k).rz * 0.98], cast: false });
  // cape
  addCape(model, model.j[J.CH], { len: 1.25 * k, w0: 0.34 * k, w1: 0.62 * k, anchor: new V3(0, 0.33 * k, -0.115 * k), mat: Mt.cape, ph: Math.random() * 6 });
  // sceptre in the right hand
  const sc = new THREE.Group();
  const stM = illusion ? Mt.gold : metal(0xcfa030, { roughness: 0.25 });
  const gemM = illusion ? Mt.gold : glow(0x58ff9a, 3);
  const mk = (geo, mat, o) => { const m = new THREE.Mesh(geo, mat); m.position.set(...(o.pos || [0, 0, 0])); if (o.rot) m.rotation.set(...o.rot); if (o.scale) m.scale.set(...o.scale); m.castShadow = !illusion; sc.add(m); model.parts.push(m); m.userData.mat = mat; return m; };
  mk(cylGeo(0.016 * k, 0.018 * k, 1.6 * k, 8), stM, { pos: [0, 0.3 * k, 0] });
  mk(coneGeo(0.06 * k, 0.32 * k, 4), stM, { pos: [0, 1.28 * k, 0] });
  mk(boxGeo(0.012 * k, 0.26 * k, 0.1 * k), stM, { pos: [0, 1.1 * k, 0], rot: [0, 0, 0] });
  mk(boxGeo(0.1 * k, 0.26 * k, 0.012 * k), stM, { pos: [0, 1.1 * k, 0] });
  const gem = mk(sphereGeo(1, 10, 8), gemM, { pos: [0, 1.06 * k, 0], scale: [0.045 * k, 0.07 * k, 0.045 * k] });
  gem.castShadow = false;
  sc.position.set(0, 0.0, 0.0); sc.rotation.x = Math.PI / 2;
  model.handR.add(sc);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 1.4 * k, 0); sc.add(muzzle);
  model.muzzle = muzzle; model.sceptre = sc;
  addHook(model, (c, m) => {
    const p = 1 + Math.sin(c.tm * 5) * 0.12 + m.fx.glint * 0.6;
    gem.scale.set(0.045 * k * p, 0.07 * k * p, 0.045 * k * p);
  });
  if (illusion) {
    addHook(model, (c) => { _ghost.opacity = 0.42 + Math.sin(c.tm * 9) * 0.08 + Math.sin(c.tm * 23) * 0.04; });
    model.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    for (const p of model.parts) p.castShadow = false;
  }
  return finish(model);
}
export function buildLoki() { return buildLokiImpl(false); }
export function buildLokiIllusion() { return buildLokiImpl(true); }

// ===================================================================== ULTRON
export function buildUltron() {
  const dims = makeDims(1.28, { headR: 0.135 });
  const rig = buildRig(dims, 1.05);
  const chrome = metal(0xcfd4de, { roughness: 0.16 }), gun = metal(0x5d636f, { roughness: 0.3 }), dark = metal(0x1b1e26, { roughness: 0.4 });
  const redG = glow(0xff1c1c, 3.2);
  const symT = symMat({ id: 'ultsym', color: 0x040407, rim: 0xff2030, rimK: 0.7, rough: 0.16 });
  const model = new ProcModel('ultron', rig, {
    prof: { stance: 'hulk', cadence: 0.9, stride: 0.95, armSwing: 0.7, lean: 0.8, flipDodge: false, wide: 0.0, hover: 'iron', flyStyle: 'iron', tempo: 0.9 },
    variants: { normal: { chrome, gun }, infected: { chrome, gun } },
  });
  model.customRotation = true;
  model.fx = { jet: 1 };
  const info = buildBody(model, {
    mats: { chrome, gun, dark, default: chrome },
    slots: { chest: 'chrome', abdomen: 'gun', pelvis: 'gun', neck: 'gun', head: 'chrome', shoulder: 'chrome', upperArm: 'gun', foreArm: 'chrome', hand: 'gun', thigh: 'gun', shin: 'chrome', foot: 'gun' },
    torso: { sx: 1.3, sz: 0.82, chestR: 1.12, waistR: 0.85 },
    head: { R: 0.135, sx: 0.92, sy: 1.12, sz: 1.04 },
    arm: { u0: 0.058, u1: 0.048, f0: 0.054, f1: 0.045, ub: 0.1, fb: 0.2, shoulder: 1.35 },
    leg: { t0: 0.082, t1: 0.058, s0: 0.056, s1: 0.04, tb: 0.05, sb: 0.14 },
    armM: 1.15, legM: 1.0, neckR: 0.045,
    foot: [0.06, 0.05, 0.16], hand: [0.058, 0.068, 0.064], pelvis: [0.38, 0.22, 0.26],
  });
  const k = dims.k, hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  // face: glowing angry eye slits, grille mouth, brow + crest
  for (const s of [1, -1]) {
    P(model, hj, boxGeo(hr * 0.5, hr * 0.1, hr * 0.12), redG, { pos: [s * hr * 0.4, H.y0 + hr * 0.12, hr * H.sz * 0.9], rot: [0.05, -s * 0.35, -s * 0.38], cast: false });
    P(model, hj, boxGeo(hr * 0.62, hr * 0.12, hr * 0.28), chrome, { pos: [s * hr * 0.4, H.y0 + hr * 0.3, hr * H.sz * 0.78], rot: [0.2, -s * 0.3, -s * 0.38] });
    P(model, hj, boxGeo(0.014 * k, hr * 0.55, hr * 0.5), gun, { pos: [s * hr * H.sx * 0.98, H.y0 - hr * 0.35, hr * 0.15], rot: [0, 0, -s * 0.1] });
  }
  P(model, hj, boxGeo(hr * 0.75, hr * 0.12, hr * 0.1), redG, { pos: [0, H.y0 - hr * 0.55, hr * H.sz * 0.88], cast: false });
  const bars = []; for (let i = -2; i <= 2; i++) bars.push({ geo: boxGeo(0.006 * k, hr * 0.15, 0.012 * k), pos: [i * hr * 0.15, H.y0 - hr * 0.55, hr * H.sz * 0.93] });
  P(model, hj, mergeParts('vb_ultbars', bars), dark, { cast: false });
  P(model, hj, boxGeo(0.02 * k, hr * 0.42, hr * 1.9), chrome, { pos: [0, H.y0 + hr * 1.0, -hr * 0.1], rot: [-0.1, 0, 0] });
  // chest reactor + shoulder plates + wrist rocket ports
  const cr = info.chestRad(0.2 * k);
  P(model, model.j[J.CH], sphereGeo(1, 14, 10), redG, { pos: [0, 0.2 * k, cr.rz * 0.93], scale: [0.065 * k, 0.065 * k, 0.025 * k], cast: false });
  P(model, model.j[J.CH], boxGeo(0.2 * k, 0.04 * k, 0.03 * k), dark, { pos: [0, 0.31 * k, cr.rz * 0.9], cast: false });
  for (const s of [1, -1]) {
    P(model, model.j[s > 0 ? J.AL : J.AR], boxGeo(0.12 * k, 0.05 * k, 0.16 * k), chrome, { pos: [s * 0.08 * k, 0.1 * k, 0], rot: [0, 0, -s * 0.35] });
    P(model, model.j[s > 0 ? J.WL : J.WR], cylGeo(0.05 * k, 0.05 * k, 0.05 * k, 10), redG, { pos: [0, 0.0, 0.0], scale: [1, 1, 1], cast: false });
    P(model, model.j[s > 0 ? J.EL : J.ER], boxGeo(0.07 * k, 0.12 * k, 0.04 * k), gun, { pos: [0, -0.07 * k, -0.045 * k] });
  }
  // thrusters under the feet
  const jets = [];
  for (const j of [J.FL, J.FR]) {
    const m = P(model, model.j[j], coneGeo(0.07 * k, 0.45 * k, 8), glow(0xff5a2a, 2.4, { transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), { pos: [0, -0.28 * k, 0.04 * k], rot: [Math.PI, 0, 0], cast: false });
    jets.push(m);
  }
  // symbiote infection (phase 3): black patches + tendrils (only visible in the 'infected' variant)
  const patches = [[J.CH, [0.1, 0.1, 0.1], [0.1, 0.16, 0.05]], [J.CH, [-0.12, 0.24, 0.08], [0.08, 0.1, 0.05]], [J.HD, [-0.07, H.y0 + 0.02, 0.1], [0.07, 0.09, 0.05]],
    [J.EL, [0, -0.1, 0.0], [0.06, 0.12, 0.06]], [J.ER, [0, -0.12, 0.0], [0.055, 0.1, 0.055]], [J.KL, [0, -0.15, 0.03], [0.06, 0.1, 0.05]], [J.CH, [0.05, 0.16, -0.1], [0.14, 0.2, 0.06]]];
  for (const [jn, p, s] of patches) P(model, model.j[jn], sphereGeo(1, 10, 8), symT, { pos: p.map((v) => v * k), scale: s.map((v) => v * k), only: 'infected' });
  const tends = [];
  const roots = [[0.14, 0.3, -0.12, 0.9, 0.5, -0.5], [-0.14, 0.3, -0.12, -0.9, 0.5, -0.5], [0.0, 0.34, -0.13, 0.0, 0.8, -0.6], [0.1, 0.14, -0.14, 0.8, -0.1, -0.7], [-0.1, 0.14, -0.14, -0.8, -0.1, -0.7]];
  roots.forEach((r, i) => {
    const t = new Tendril({ segs: 14, radial: 6, r0: 0.05 * k, r1: 0.01, material: symT, ref: new V3(0, 1, 0) });
    t.mesh.visible = false; model.j[J.CH].add(t.mesh); tends.push({ t, r, ph: i * 1.7 });
  });
  model.onVariant = (name) => { for (const x of tends) x.t.mesh.visible = name === 'infected'; };
  const tmpD = new V3();
  addHook(model, (c, m) => {
    const hov = c.st === 'hover' || c.st === 'fly' || c.st === 'stunned' ? 1 : 0;
    const f = hov ? clamp(m.fx.jet, 0, 1) : 0;
    for (const j of jets) { j.visible = f > 0.05; const s = f * (0.85 + Math.random() * 0.3); j.scale.set(s, s * 1.1, s); }
    if (m.variant === 'infected') {
      const rage = c.st === 'smash' || c.st === 'cast' || c.st.startsWith('punch') ? 1 : 0.35;
      for (const { t, r, ph } of tends) {
        tmpD.set(r[3], r[4], r[5]).normalize();
        const len = 1.0 * k;
        t.update((u, out) => {
          const w1 = Math.sin(c.tm * (2 + rage * 3) + ph + u * 5.5) * 0.15 * u * (0.6 + rage), w2 = Math.cos(c.tm * 1.6 + ph * 1.3 + u * 4) * 0.1 * u;
          out.set(r[0] * k + tmpD.x * len * u + w1, r[1] * k + tmpD.y * len * u * (1 - 0.6 * u) + w2, r[2] * k + tmpD.z * len * u);
        });
      }
    }
  }, () => tends.forEach((x) => x.t.dispose()));
  return finish(model, 'normal');
}

export function buildUltronDrone() {
  const m = new PropModel('ultron_drone', 1.1);
  const body = new THREE.Group(); m.group.add(body); body.position.y = 0.55;
  const chrome = metal(0xc8ced8, { roughness: 0.2 }), gun = metal(0x555b68, { roughness: 0.3 });
  m.add(body, sphereGeo(1, 14, 10), chrome, { scale: [0.3, 0.27, 0.3] });
  m.add(body, cylGeo(0.42, 0.42, 0.04, 20), gun, { pos: [0, 0, 0], scale: [1, 1, 1] });
  const eye = m.add(body, sphereGeo(1, 10, 8), glow(0xff1c1c, 3.2), { pos: [0, 0.02, 0.27], scale: [0.12, 0.08, 0.06], cast: false });
  m.add(body, sphereGeo(1, 8, 6), glow(0xff1c1c, 2.4), { pos: [0, 0.31, 0], scale: [0.06, 0.04, 0.06], cast: false });
  for (const s of [1, -1]) {
    m.add(body, cylGeo(0.03, 0.04, 0.4, 8), gun, { pos: [s * 0.36, -0.1, 0.18], rot: [Math.PI / 2, 0, 0] });
    m.add(body, boxGeo(0.04, 0.04, 0.16), gun, { pos: [s * 0.2, -0.04, 0.08], rot: [0, s * 0.3, 0] });
    m.add(body, coneGeo(0.07, 0.3, 8), glow(0xff5a2a, 2.4, { transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), { pos: [s * 0.3, -0.3, -0.05], rot: [Math.PI, 0, 0], cast: false });
  }
  m.handR.position.set(-0.36, 0.45, 0.4); m.handL.position.set(0.36, 0.45, 0.4); m.head.position.set(0, 0.55, 0.2); m.chest.position.set(0, 0.55, 0.1);
  const lv = new V3();
  m.ticks.push((dt, anim, ent, mm) => {
    body.position.y = 0.55 + Math.sin(mm.t * 3.2) * 0.04;
    localVel(ent, lv);
    body.rotation.x += (clamp(lv.z * 0.03, -0.4, 0.5) - body.rotation.x) * Math.min(1, 8 * dt);
    body.rotation.z += (clamp(-lv.x * 0.035, -0.5, 0.5) - body.rotation.z) * Math.min(1, 8 * dt);
    eye.scale.set(0.12 * (1 + (ent && ent.windup > 0 ? 0.8 : 0)), 0.08, 0.06);
  });
  return m;
}

// ===================================================================== CARNAGE
function carnageTexture() {
  return drawTex('vb_carnage', 256, 256, (ctx, W, H) => {
    const r = rng(11);
    ctx.fillStyle = '#b30a1c'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,60,60' : '90,0,10'},${0.08 + r() * 0.14})`; ctx.beginPath(); ctx.ellipse(r() * W, r() * H, 8 + r() * 26, 4 + r() * 16, r() * 3, 0, 6.3); ctx.fill(); }
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = `rgba(6,0,2,${0.65 + r() * 0.3})`; ctx.lineWidth = 5 + r() * 14;
      const x = r() * W, y0 = r() * H, len = 40 + r() * 120;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.bezierCurveTo(x + (r() - 0.5) * 60, y0 + len * 0.33, x + (r() - 0.5) * 70, y0 + len * 0.66, x + (r() - 0.5) * 40, y0 + len); ctx.stroke();
    }
  }, { repeat: [1, 1] });
}
function carnageMats() {
  const tex = carnageTexture();
  const red = withRim(phys(0xffffff, { map: tex, roughness: 0.26, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.12, emissive: 0x330005, emissiveIntensity: 0.7 }), 0xff3a50, 0.5);
  const black = symMat({ id: 'carb', color: 0x0a0204, rim: 0xff1830, rimK: 0.9, rough: 0.16 });
  return { red, black };
}

function carnageBody(model, dims, o = {}) {
  const { red, black } = carnageMats();
  const k = dims.k;
  const info = buildBody(model, {
    mats: { default: red, hand: black, foot: black, shoulder: black },
    torso: { sx: o.sx ?? 1.45, sz: o.sz ?? 0.95, chestR: o.chestR ?? 1.22, waistR: 0.85 },
    head: { R: dims.headR, sx: 1.2, sy: 1.0, sz: 1.08 },
    arm: { u0: 0.058, u1: 0.046, f0: 0.05, f1: 0.04, ub: 0.22, fb: 0.24, shoulder: 1.35 },
    leg: { t0: 0.09, t1: 0.064, s0: 0.064, s1: 0.044, tb: 0.2, sb: 0.24 },
    armM: o.armM ?? 1.4, foreM: o.foreM ?? 1.5, legM: 1.15, neckR: 0.07,
    foot: [0.064, 0.05, 0.17], hand: [0.064, 0.074, 0.07], pelvis: [0.4, 0.22, 0.28],
  });
  return { info, red, black, k };
}

export function buildCarnage() {
  const dims = makeDims(1.24, { headR: 0.155, neck: 0.13 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('carnage', rig, { prof: { stance: 'feral', cadence: 0.9, stride: 1.12, armSwing: 1.2, lean: 1.5, bob: 1.5, flipDodge: false, wide: 0.1, tempo: 1.2 } });
  model.fx = { whip: 0, whipAng: 0, rage: 0 };
  const { info, red, black, k } = carnageBody(model, dims);
  const hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  // huge white eyes with black rims
  const eyeM = glow(0xfff4f4, 2.2);
  for (const s of [1, -1]) {
    P(model, hj, sphereGeo(1, 12, 8), black, { pos: [s * hr * 0.46, H.y0 + hr * 0.2, hr * 0.84], scale: [hr * 0.4, hr * 0.23, hr * 0.12], rot: [0, 0, -s * 0.5], cast: false });
    P(model, hj, sphereGeo(1, 12, 8), eyeM, { pos: [s * hr * 0.46, H.y0 + hr * 0.2, hr * 0.9], scale: [hr * 0.33, hr * 0.17, hr * 0.1], rot: [0, 0, -s * 0.5], cast: false });
  }
  // grin
  const mouth = std(0x16020a, { roughness: 0.6 });
  P(model, hj, sphereGeo(1, 16, 10), mouth, { pos: [0, H.y0 - hr * 0.5, hr * H.sz * 0.74], scale: [hr * H.sx * 1.0, hr * 0.34, hr * 0.36], cast: false });
  const teeth = [], rg = rng(8), N = 15;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1) * 2 - 1, phi = u * 1.12;
    const x = Math.sin(phi) * hr * H.sx * 1.04, z = Math.cos(phi) * hr * H.sz * 0.98 * 0.96;
    const yU = H.y0 - hr * 0.32 + u * u * hr * 0.28, yL = H.y0 - hr * 0.7 + u * u * hr * 0.28;
    const sz = (0.03 + rg() * 0.02) * (1 - Math.abs(u) * 0.3);
    teeth.push({ geo: coneGeo(0.0115, sz * 1.7, 5), pos: [x, yU - sz * 0.5, z], rot: [Math.PI + 0.1, -phi, 0] });
    teeth.push({ geo: coneGeo(0.0115, sz * 1.6, 5), pos: [x, yL + sz * 0.5, z], rot: [-0.1, -phi, 0] });
  }
  P(model, hj, mergeParts('vb_carteeth', teeth), std(0xf4f0e6, { roughness: 0.35 }), { cast: false });
  const tongueM = std(0x8a0818, { roughness: 0.35, emissive: 0x300004, emissiveIntensity: 0.5 });
  const tongue = new Tendril({ segs: 14, radial: 6, r0: 0.026, r1: 0.007, material: tongueM, ref: new V3(0, 1, 0) });
  hj.add(tongue.mesh);
  // blade arms (forearm blades) + shoulder/back spikes
  const bladeG = G('vb_blade', () => { const g = new THREE.ConeGeometry(0.05, 1, 4); g.scale(1, 1, 0.28); g.rotateX(Math.PI); g.translate(0, -0.5, 0); return g; });
  for (const s of [1, -1]) {
    const wr = model.j[s > 0 ? J.WL : J.WR];
    P(model, wr, bladeG, black, { pos: [0, -dims.hand * 0.4, 0.0], scale: [k * 1.2, 1.15 * k, k * 1.2] });
    P(model, model.j[s > 0 ? J.EL : J.ER], coneGeo(0.022 * k, 0.16 * k, 5), black, { pos: [0, -0.08 * k, -0.05 * k], rot: [-2.4, 0, 0] });
    P(model, model.j[s > 0 ? J.AL : J.AR], coneGeo(0.04 * k, 0.24 * k, 6), black, { pos: [s * 0.045 * k, 0.1 * k, 0], rot: [0.1, 0, -s * 0.9] });
  }
  const bs = [];
  for (let i = 0; i < 5; i++) bs.push({ geo: coneGeo(0.03 * k, 0.17 * k, 5), pos: [0, (0.05 + i * 0.065) * k, -0.14 * k], rot: [-2.2, 0, 0] });
  P(model, model.j[J.CH], mergeParts('vb_carbackspikes' + k, bs), black, {});
  // tendrils: 5 back writhers + 2 long whips from the shoulders
  const tends = [];
  const roots = [[0.12, 0.32, -0.12, 0.9, 0.5, -0.7], [-0.12, 0.32, -0.12, -0.9, 0.5, -0.7], [0.0, 0.36, -0.13, 0.0, 0.8, -0.8], [0.09, 0.14, -0.14, 0.8, 0.0, -0.9], [-0.09, 0.14, -0.14, -0.8, 0.0, -0.9]];
  roots.forEach((r, i) => {
    const t = new Tendril({ segs: 14, radial: 6, r0: 0.05 * k, r1: 0.01, material: black, ref: new V3(0, 1, 0) });
    model.j[J.CH].add(t.mesh); tends.push({ t, r, ph: i * 1.7 });
  });
  const whips = [];
  for (const s of [1, -1]) {
    const t = new Tendril({ segs: 20, radial: 6, r0: 0.055 * k, r1: 0.008, material: red, ref: new V3(0, 1, 0) });
    model.j[J.CH].add(t.mesh); whips.push({ t, s });
  }
  const tmpD = new V3();
  addHook(model, (c, m) => {
    const fx = m.fx, sp2 = Math.hypot(c.vl.x, c.vl.z);
    const rage = clamp((c.st.startsWith('punch') || c.st === 'kick' || c.st === 'smash' || c.st === 'cast' ? 1 : 0.35) + fx.rage * 0.6, 0, 1.4);
    for (const { t, r, ph } of tends) {
      tmpD.set(r[3], r[4], r[5]).normalize();
      const len = 1.3 * k;
      t.update((u, out) => {
        const w1 = Math.sin(c.tm * (2.2 + rage * 3.5) + ph + u * 5.5) * 0.17 * u * (0.6 + rage), w2 = Math.cos(c.tm * 1.7 + ph * 1.3 + u * 4) * 0.12 * u;
        out.set(r[0] * k + tmpD.x * len * u + w1, r[1] * k + tmpD.y * len * u * (1 - 0.55 * u) + w2 + u * u * 0.12, r[2] * k + tmpD.z * len * u - sp2 * 0.012 * u * u);
      });
    }
    // whips: relaxed = trailing behind the shoulders; extended = a horizontal sweep that follows fx.whipAng
    const ext = clamp(fx.whip, 0, 1);
    for (const { t, s } of whips) {
      const L = lerp(1.1, 3.1, ext) / 1;
      t.update((u, out) => {
        // relaxed curve
        const rx = s * (0.2 + 0.55 * u) + Math.sin(c.tm * 2.2 + u * 6 + s) * 0.1 * u;
        const ry = 0.3 + Math.sin(c.tm * 1.8 + u * 5) * 0.14 * u - u * 0.5 * (1 - 0.3 * u);
        const rz = -0.12 - u * 0.9 + Math.cos(c.tm * 2 + u * 4) * 0.09 * u;
        // extended: arc in the horizontal plane; angle sweeps from outside (s side) across the front
        const a = (fx.whipAng * 1.35) * -s * (s > 0 ? 1 : 1) + s * 0.3;
        const dist = L * u * k;
        const ex = Math.sin(a + s * (0.2 * (1 - u))) * dist + s * 0.18 * k, ez = Math.cos(a) * dist, ey = 0.28 * k + Math.sin(u * 3.14) * 0.22 * k + Math.sin(c.tm * 18 + u * 9) * 0.03 * ext * u;
        out.set(lerp(rx * k, ex, ext), lerp(ry * k, ey, ext), lerp(rz * k, ez, ext));
      });
    }
    const out = c.st === 'dead' ? 0.4 : 1;
    tongue.update((u, o) => { o.set(Math.sin(c.tm * 7 + u * 6) * 0.02 * u, H.y0 - hr * 0.55 - u * 0.2 * out + Math.sin(c.tm * 3 + u * 4) * 0.02 * u, hr * H.sz * 0.88 + u * 0.24 * out); });
  }, () => { tends.forEach((x) => x.t.dispose()); whips.forEach((x) => x.t.dispose()); tongue.dispose(); });
  return finish(model);
}

export function buildCarnageSpawn() {
  const dims = makeDims(0.56, { headR: 0.15 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('carnage_spawn', rig, { prof: { stance: 'feral', cadence: 1.4, stride: 1.2, armSwing: 1.4, lean: 2.3, bob: 1.6, hunch: 1, flipDodge: false, wide: 0.15, tempo: 1.5 } });
  model.fx = {};
  const { info, red, black, k } = carnageBody(model, dims, { sx: 1.25, sz: 0.9, armM: 1.25, foreM: 1.35 });
  const hj = model.j[J.HD], H = info.headInfo, hr = H.R;
  const eyeM = glow(0xfff4f4, 2.2);
  for (const s of [1, -1]) P(model, hj, sphereGeo(1, 10, 8), eyeM, { pos: [s * hr * 0.46, H.y0 + hr * 0.2, hr * 0.88], scale: [hr * 0.3, hr * 0.15, hr * 0.1], rot: [0, 0, -s * 0.5], cast: false });
  P(model, hj, sphereGeo(1, 12, 8), std(0x16020a, { roughness: 0.6 }), { pos: [0, H.y0 - hr * 0.5, hr * H.sz * 0.78], scale: [hr * H.sx * 0.95, hr * 0.28, hr * 0.3], cast: false });
  const teeth = [];
  for (let i = 0; i < 9; i++) { const u = i / 8 * 2 - 1, phi = u * 1.0; teeth.push({ geo: coneGeo(0.01, 0.03, 4), pos: [Math.sin(phi) * hr * H.sx * 0.98, H.y0 - hr * 0.4 + u * u * hr * 0.2, Math.cos(phi) * hr * H.sz * 0.9], rot: [Math.PI + 0.1, -phi, 0] }); }
  P(model, hj, mergeParts('vb_spawnteeth', teeth), std(0xf4f0e6, { roughness: 0.35 }), { cast: false });
  const bladeG = G('vb_blade', () => { const g = new THREE.ConeGeometry(0.05, 1, 4); g.scale(1, 1, 0.28); g.rotateX(Math.PI); g.translate(0, -0.5, 0); return g; });
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.WL : J.WR], bladeG, black, { pos: [0, -dims.hand * 0.4, 0], scale: [k * 1.2, 0.8 * k * 1.15, k * 1.2] });
  const t = new Tendril({ segs: 10, radial: 5, r0: 0.04 * k, r1: 0.008, material: red, ref: new V3(0, 1, 0) });
  model.j[J.CH].add(t.mesh);
  addHook(model, (c) => {
    t.update((u, out) => { out.set(Math.sin(c.tm * 5 + u * 5) * 0.08 * u * k, 0.2 * k + u * 0.4 * k, -0.1 * k - u * 0.9 * k); });
  }, () => t.dispose());
  return finish(model);
}

// ===================================================================== registration
registerModel('goblin', buildGoblin);
registerModel('goblin_drone', buildGoblinDrone);
registerModel('loki', buildLoki);
registerModel('loki_illusion', buildLokiIllusion);
registerModel('ultron', buildUltron);
registerModel('ultron_drone', buildUltronDrone);
registerModel('carnage', buildCarnage);
registerModel('carnage_spawn', buildCarnageSpawn);
