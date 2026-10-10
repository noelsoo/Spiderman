// Procedural villain models (set A): Kraven, The Lizard (+ lizardman), Doctor Octopus (+ octobot drone).
// Registered through registerModel(); every character follows the CharacterModel contract
// (group, height, handR/handL/chest/head, update(dt, anim, entity), setTint, dispose) and reuses the rig/anim states.
import * as THREE from 'three';
import { buildRig, makeDims, ProcModel, J } from './rig.js';
import { registerModel } from './index.js';
import { P, addHook, buildBody, addFace, finish } from './characters.js';
import {
  G, std, metal, glow, symMat, sphereGeo, boxGeo, cylGeo, coneGeo, mergeParts, rng, drawTex, grainNormal, fabricNormal, skinMaps, seg,
} from './common.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2;
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;

function eulerFor(dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
}

/** wrap model.update so the hooks / tentacles can see the owning entity */
function captureEntity(model, after) {
  const orig = model.update.bind(model);
  model.update = (dt, anim, entity) => {
    model.extra.ent = entity || null;
    orig(dt, anim, entity);
    after?.(dt, anim, entity);
  };
}

/** Tube along a polyline with a per-point radius function (ribbed mechanical tentacle). */
class SegTube {
  constructor({ segs = 26, radial = 8, material }) {
    this.segs = segs; this.radial = radial;
    const nv = (segs + 1) * radial + 1;
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
    const tip = (segs + 1) * radial;
    for (let j = 0; j < radial; j++) idx.push(segs * radial + j, tip, segs * radial + ((j + 1) % radial));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this.pts = Array.from({ length: segs + 1 }, () => new V3());
    this.T = new V3(); this.N = new V3(); this.B = new V3();
  }
  /** pts already filled in this.pts; rad(u) -> radius */
  rebuild(rad) {
    const { segs, radial, pts: P_, T, N, B } = this;
    const pos = this.geo.attributes.position.array;
    N.set(0, 1, 0);
    for (let i = 0; i <= segs; i++) {
      const a = P_[Math.max(0, i - 1)], b = P_[Math.min(segs, i + 1)];
      T.subVectors(b, a).normalize();
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize(); B.crossVectors(T, N);
      const r = rad(i / segs);
      for (let j = 0; j < radial; j++) {
        const an = (j / radial) * Math.PI * 2, cs = Math.cos(an) * r, sn = Math.sin(an) * r;
        const o = (i * radial + j) * 3;
        pos[o] = P_[i].x + N.x * cs + B.x * sn; pos[o + 1] = P_[i].y + N.y * cs + B.y * sn; pos[o + 2] = P_[i].z + N.z * cs + B.z * sn;
      }
    }
    const o = (segs + 1) * radial * 3, e = P_[segs];
    pos[o] = e.x + T.x * 0.03; pos[o + 1] = e.y + T.y * 0.03; pos[o + 2] = e.z + T.z * 0.03;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  dispose() { this.geo.dispose(); }
}

// ================================================================== KRAVEN
function kravenTextures() {
  const skin = drawTex('kravenSkin', 256, 256, (ctx, W, H) => {
    ctx.fillStyle = '#b98860'; ctx.fillRect(0, 0, W, H);
    const r = rng(11);
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${90 + r() * 40},${55 + r() * 20},40,0.08)`; ctx.fillRect(r() * W, r() * H, 3 + r() * 6, 3 + r() * 6); }
    // tribal tattoo bands
    ctx.fillStyle = 'rgba(25,15,12,0.85)';
    for (let b = 0; b < 5; b++) {
      const y = 20 + b * 48;
      ctx.fillRect(0, y, W, 4);
      for (let x = 0; x < W; x += 16) { ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x + 8, y + 22 + r() * 8); ctx.lineTo(x + 16, y + 4); ctx.fill(); }
    }
    // symbiote veins
    ctx.strokeStyle = 'rgba(20,6,30,0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      let x = r() * W, y = r() * H; ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 24; y += 14 + r() * 14; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
  const vein = drawTex('kravenVein', 256, 256, (ctx, W, H) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const r = rng(11);
    for (let i = 0; i < 400; i++) r(); // keep rng stream aligned with the skin texture is not required, veins just need to look similar
    ctx.strokeStyle = '#9a40ff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const r2 = rng(77);
    for (let i = 0; i < 14; i++) {
      let x = r2() * W, y = r2() * H; ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r2() - 0.5) * 24; y += 14 + r2() * 14; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
  return { skin, vein };
}

export function buildKraven() {
  const dims = makeDims(1.08, { headR: 0.112 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('kraven', rig, { prof: { stance: 'feral', cadence: 1.15, stride: 1.1, armSwing: 0.9, lean: 1.2, flipDodge: false, tempo: 1.05 } });
  const k = dims.k;
  const { skin: skinT, vein: veinT } = kravenTextures();
  const skin = std(0xffffff, { map: skinT, emissive: 0xffffff, emissiveMap: veinT, emissiveIntensity: 0.55, roughness: 0.7 });
  const pants = std(0x2a2118, { roughness: 0.85, normalMap: fabricNormal(6, 0.5, 'kfab'), normalScale: new V2(0.7, 0.7) });
  const boots = std(0x1d150f, { roughness: 0.7, normalMap: grainNormal('leather', 5, 2.4), normalScale: new V2(0.8, 0.8) });
  const info = buildBody(model, {
    mats: { default: skin, pelvis: pants, thigh: pants, shin: pants, foot: boots, hand: skin },
    torso: { sx: 1.34, sz: 0.86, chestR: 1.14, waistR: 0.95 },
    head: { R: 0.112, sx: 0.92, sy: 1.08, sz: 1.0 },
    arm: { u0: 0.058, u1: 0.048, f0: 0.048, f1: 0.038, ub: 0.14, fb: 0.14 },
    leg: { t0: 0.09, t1: 0.064, s0: 0.064, s1: 0.046, tb: 0.07, sb: 0.07 },
    foot: [0.06, 0.056, 0.16], hand: [0.043, 0.056, 0.052], pelvis: [0.38, 0.2, 0.27],
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  addFace(model, H, { tex: { skin: '#b98860', iris: '#d03050', brow: '#120c08', mood: 'angry', stubble: 0.9 }, skin: std(0xb98860, { roughness: 0.7 }) });
  // black mane of hair
  const hairM = std(0x120c08, { roughness: 0.9 });
  P(model, hj, G('kravenHair', () => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), hairM, { pos: [0, H.y0 + hr * 0.28, -hr * 0.12], scale: [hr * 1.08, hr * 1.02, hr * 1.16] });
  P(model, hj, G('kravenHairBack', () => new THREE.ConeGeometry(1, 1, 8)), hairM, { pos: [0, H.y0 - hr * 0.55, -hr * 0.85], scale: [hr * 0.8, hr * 1.6, hr * 0.6], rot: [0.25, 0, 0] });
  // lion-mane vest: fur collar + spiky mane
  const fur = std(0xa87430, { roughness: 0.95, normalMap: grainNormal('fur', 3, 3.0), normalScale: new V2(0.9, 0.9) });
  const furD = std(0x5a3a14, { roughness: 0.95 });
  const vestPts = [[0.02, 0.0001], [0.04, 0.16], [0.14, 0.185], [0.26, 0.185], [0.31, 0.15], [0.325, 0.0001]].map(([y, r]) => [y * k, r * k * 1.03]);
  P(model, cj, G('kravenVest' + k, () => { const pts = vestPts.map(([y, r]) => new V2(r, y)); return new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(18).map((v) => new V2(Math.max(v.x, 0.0001), v.y)), seg(20, 10)); }), furD, { scale: [1.42, 1, 0.94] });
  const r1 = rng(31);
  const mane = (n, R, y, len, tilt, rad, key, sx = 1, sz = 1) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r1() * 0.2, l = len * (0.75 + r1() * 0.5);
      const d = new V3(Math.sin(a), tilt, Math.cos(a));
      parts.push({ geo: coneGeo(rad, l, 5), pos: [Math.sin(a) * R * sx, y, Math.cos(a) * R * sz], rot: eulerFor(d) });
    }
    return mergeParts(key, parts);
  };
  P(model, cj, mane(22, 0.19 * k, 0.33 * k, 0.17 * k, 0.9, 0.036 * k, 'kmane1' + k, 1.38, 0.95), fur, {});
  P(model, cj, mane(18, 0.2 * k, 0.26 * k, 0.15 * k, 0.4, 0.034 * k, 'kmane2' + k, 1.4, 0.98), furD, {});
  P(model, hj, mane(10, hr * 0.8, H.y0 - hr * 0.1, 0.1 * k, 0.1, 0.03 * k, 'kmane3' + k, 1, 1), fur, {});
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.AL : J.AR], sphereGeo(0.085, 10, 8), fur, { pos: [s * 0.03, 0.03, 0], scale: [1.2, 0.8, 1.15] });
  // belt + loincloth
  P(model, model.j[J.SP], cylGeo(0.14 * k, 0.15 * k, 0.05 * k, 14), boots, { pos: [0, 0.06 * k, 0], scale: [1.3, 1, 0.84] });
  // knives (reverse grip) + spear on the back
  const steel = metal(0xc8ccd2, { roughness: 0.25 });
  const blade = mergeParts('kravenKnife', [{ geo: boxGeo(0.02, 0.2, 0.05), pos: [0, -0.15, 0.02] }, { geo: coneGeo(0.025, 0.07, 4), pos: [0, -0.285, 0.02], rot: [Math.PI, 0, 0] }, { geo: boxGeo(0.035, 0.03, 0.09), pos: [0, -0.04, 0.0] }]);
  for (const s of [1, -1]) P(model, model.j[s > 0 ? J.WL : J.WR], blade, steel, { pos: [0, -dims.hand * 0.4, 0.02], rot: [0.3, 0, 0] });
  const spear = mergeParts('kravenSpear', [
    { geo: cylGeo(0.016, 0.016, 1.7, 6), pos: [0, 0, 0] }, { geo: coneGeo(0.04, 0.26, 5), pos: [0, 0.98, 0] },
    { geo: cylGeo(0.022, 0.022, 0.2, 6), pos: [0, -0.7, 0] },
  ]);
  const spearMesh = P(model, cj, spear, std(0x4a3320, { roughness: 0.8 }), { pos: [0.12 * k, 0.2 * k, -0.17 * k], rot: [0.12, 0, 0.5] });
  model.spear = spearMesh;
  // claws (rage)
  const clawM = glow(0xd070ff, 1.6);
  const claws = [];
  for (const s of [1, -1]) {
    const cl = [];
    for (let i = -1; i <= 1; i++) cl.push({ geo: coneGeo(0.012 * k, 0.17 * k, 5), pos: [i * 0.03 * k, -0.11 * k, 0.05 * k], rot: [Math.PI + 0.3, 0, i * 0.1] });
    const m = P(model, model.j[s > 0 ? J.WL : J.WR], mergeParts('kravenclaw' + k, cl), clawM, { pos: [0, -dims.hand * 0.5, 0], cast: false });
    m.visible = false; claws.push(m);
  }
  model.setRage = (on) => {
    for (const c of claws) c.visible = !!on;
    skin.emissiveIntensity = on ? 1.5 : 0.55;
    model.extra.rage = !!on;
  };
  return finish(model);
}

// ================================================================== LIZARD
export function buildLizard(opts = {}) {
  const small = !!opts.small;
  const dims = makeDims(small ? 1.0 : 1.15, { headR: small ? 0.105 : 0.13, neck: small ? 0.07 : 0.1 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel(small ? 'lizardman' : 'lizard', rig, { prof: { stance: 'feral', cadence: small ? 1.35 : 0.9, stride: 1.1, armSwing: 1.0, lean: 1.5, wide: 0.08, hunch: 1, bob: 1.3, flipDodge: false, tempo: small ? 1.15 : 0.95 } });
  const k = dims.k;
  const sk = skinMaps(small ? '#7a9a2c' : '#3f8f3a', small ? '#4f6a1c' : '#2a6a2a', small ? 8 : 3);
  const green = std(0xffffff, { map: sk.map, normalMap: sk.normal, normalScale: new V2(1.2, 1.2), roughness: 0.55, metalness: 0.05 });
  const belly = std(small ? 0xcbd28a : 0xb7cf7a, { roughness: 0.6 });
  const info = buildBody(model, {
    mats: { default: green, abdomen: belly },
    torso: { sx: 1.5, sz: 1.1, chestR: 1.3, waistR: 1.0 },
    head: { R: dims.headR, sx: 0.82, sy: 0.8, sz: 1.05 },
    arm: { u0: 0.06, u1: 0.048, f0: 0.05, f1: 0.04, ub: 0.2, fb: 0.2, shoulder: 1.3 },
    leg: { t0: 0.098, t1: 0.07, s0: 0.07, s1: 0.05, tb: 0.15, sb: 0.2 },
    armM: 1.25, foreM: 1.4, legM: 1.1, neckR: 0.065,
    foot: [0.07, 0.05, 0.19], hand: [0.05, 0.065, 0.06], pelvis: [0.42, 0.22, 0.28],
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  // snout, jaw, teeth
  P(model, hj, sphereGeo(1, 14, 10), green, { pos: [0, H.y0 - hr * 0.2, hr * 1.12], scale: [hr * 0.58, hr * 0.46, hr * 1.1] });
  const jaw = std(small ? 0xa8b868 : 0x7fb060, { roughness: 0.55 });
  P(model, hj, sphereGeo(1, 12, 8), jaw, { pos: [0, H.y0 - hr * 0.62, hr * 1.0], scale: [hr * 0.5, hr * 0.2, hr * 0.98] });
  const teeth = [];
  for (let i = 0; i < 6; i++) {
    const z = hr * (0.7 + i * 0.22);
    for (const s of [1, -1]) {
      teeth.push({ geo: coneGeo(0.009, 0.045, 4), pos: [s * hr * 0.4, H.y0 - hr * 0.44, z], rot: [Math.PI, 0, 0] });
      teeth.push({ geo: coneGeo(0.008, 0.035, 4), pos: [s * hr * 0.36, H.y0 - hr * 0.52, z], rot: [0, 0, 0] });
    }
  }
  P(model, hj, mergeParts('lizTeeth' + hr, teeth), std(0xf2eedc, { roughness: 0.3 }), { cast: false });
  // eyes + brow ridge
  const eyeM = glow(small ? 0xffb020 : 0xffe030, 2.2);
  for (const s of [1, -1]) {
    P(model, hj, sphereGeo(1, 10, 8), eyeM, { pos: [s * hr * 0.62, H.y0 + hr * 0.18, hr * 0.62], scale: [hr * 0.2, hr * 0.2, hr * 0.2], cast: false });
    P(model, hj, boxGeo(hr * 0.5, hr * 0.12, hr * 0.5), green, { pos: [s * hr * 0.58, H.y0 + hr * 0.4, hr * 0.62], rot: [0.1, 0, -s * 0.4] });
  }
  // crest of spines on head and back
  const sp = [];
  for (let i = 0; i < 7; i++) sp.push({ geo: coneGeo(0.022 * k, (0.09 + (i === 3 ? 0.05 : 0)) * k, 5), pos: [0, (0.02 + i * 0.058) * k, -0.14 * k - Math.sin(i / 6 * 3) * 0.02], rot: [-2.4, 0, 0] });
  P(model, cj, mergeParts('lizCrest' + k, sp), std(small ? 0x4f6a1c : 0x1f5a28, { roughness: 0.5 }), {});
  P(model, hj, coneGeo(0.03, 0.14, 5), green, { pos: [0, H.y0 + hr * 0.7, -hr * 0.5], rot: [-1.0, 0, 0] });
  // claws on both hands
  for (const s of [1, -1]) {
    const cl = [];
    for (let i = -1; i <= 1; i++) cl.push({ geo: coneGeo(0.012 * k, 0.12 * k, 5), pos: [i * 0.03 * k, -0.08 * k, 0.04 * k], rot: [Math.PI + 0.3, 0, i * 0.12] });
    P(model, model.j[s > 0 ? J.WL : J.WR], mergeParts('lizclaw' + k, cl), std(0xe8e0c0, { roughness: 0.35 }), { pos: [0, -dims.hand * 0.5, 0] });
  }
  // torn lab coat
  if (!small) {
    const cloth = std(0xd8d4c4, { roughness: 0.92, side: THREE.DoubleSide });
    const strips = [];
    const rg = rng(8);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, l = (0.22 + rg() * 0.2) * k;
      strips.push({ geo: boxGeo(0.07 * k, l, 0.01), pos: [Math.sin(a) * 0.17 * k * 1.3, -l * 0.5 - 0.02 * k, Math.cos(a) * 0.17 * k], rot: [0.12 * Math.cos(a), a, 0.1 * (rg() - 0.5)] });
    }
    P(model, model.j[J.SP], mergeParts('lizCoat' + k, strips), cloth, { pos: [0, -0.02 * k, 0] });
    for (const s of [1, -1]) P(model, model.j[s > 0 ? J.AL : J.AR], boxGeo(0.1 * k, 0.2 * k, 0.012), cloth, { pos: [s * 0.04 * k, -0.08 * k, -0.02], rot: [0, 0, s * 0.12] });
  }
  // tail
  const tailM = std(0xffffff, { map: sk.map, normalMap: sk.normal, roughness: 0.55 });
  const tail = new SegTube({ segs: 20, radial: 8, material: tailM });
  model.j[J.H].add(tail.mesh);
  const len = (small ? 1.2 : 1.9) * k * 1.0;
  captureEntity(model);
  addHook(model, (c, m) => {
    const ent = m.extra.ent;
    const pose = ent?.tailPose ?? 0, sway = ent?.state === 'tail' ? 0.4 : 1;
    const drop = model.hipsBase;
    for (let i = 0; i <= tail.segs; i++) {
      const u = i / tail.segs, p = tail.pts[i];
      const lat = Math.sin(c.tm * 1.6 + u * 3.2) * 0.22 * u * k * sway + pose * 1.25 * Math.pow(u, 1.3) * len * 0.55;
      const back = -0.08 * k - u * len * (1 - Math.abs(pose) * 0.35);
      const y = -0.03 * k - Math.pow(u, 1.5) * drop * 0.88 + Math.sin(c.tm * 2.1 + u * 4) * 0.03 * u + Math.abs(pose) * 0.1 * u * k;
      p.set(lat, y, back);
    }
    const r0 = 0.092 * k * (small ? 0.8 : 1);
    tail.rebuild((u) => (r0 * (1 - u * 0.93)) + 0.008);
  }, () => tail.dispose());
  return finish(model);
}

// ================================================================== DOCTOR OCTOPUS
export function buildDocOck() {
  const dims = makeDims(1.06, { headR: 0.115 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('docock', rig, { prof: { stance: 'thug', cadence: 0.9, stride: 0.9, armSwing: 0.6, lean: 0.8, flipDodge: false, tempo: 0.95 } });
  const k = dims.k;
  const fn = fabricNormal(6, 0.5, 'dofab'), fnS = new V2(0.7, 0.7);
  const coat = std(0x2e7a44, { roughness: 0.8, normalMap: fn, normalScale: fnS });
  const yellow = std(0xd6ad2a, { roughness: 0.75, normalMap: fn, normalScale: fnS });
  const dark = std(0x1c211c, { roughness: 0.7 });
  const skin = std(0xd2a27c, { roughness: 0.7 });
  const info = buildBody(model, {
    mats: { default: coat, pelvis: yellow, thigh: yellow, shin: yellow, foot: dark, hand: yellow, neck: skin, head: skin, abdomen: yellow },
    torso: { sx: 1.36, sz: 0.9, chestR: 1.1, waistR: 1.05 },
    head: { R: 0.115, sx: 0.92, sy: 1.06, sz: 1.0 },
    arm: { u0: 0.056, u1: 0.048, f0: 0.046, f1: 0.038, ub: 0.1, fb: 0.12 },
    leg: { t0: 0.092, t1: 0.066, s0: 0.066, s1: 0.048, tb: 0.06, sb: 0.06 },
    foot: [0.06, 0.054, 0.16], hand: [0.043, 0.054, 0.05], pelvis: [0.4, 0.22, 0.28],
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  addFace(model, H, { tex: { skin: '#d2a27c', eyes: false, brows: false, mood: 'angry', stubble: 0.2 }, skin });
  P(model, hj, G('docHair', () => new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.46)), std(0x4a3320, { roughness: 0.9 }), { pos: [0, H.y0 + hr * 0.32, -hr * 0.04], scale: [hr * 1.06, hr * 1.0, hr * 1.1] });
  // goggles
  const lens = glow(0xffb020, 1.8);
  for (const s of [1, -1]) {
    P(model, hj, cylGeo(0.05, 0.05, 0.04, 14), dark, { pos: [s * hr * 0.42, H.y0 + hr * 0.08, hr * 0.86], rot: [Math.PI / 2, 0, 0] });
    P(model, hj, cylGeo(0.04, 0.04, 0.044, 14), lens, { pos: [s * hr * 0.42, H.y0 + hr * 0.08, hr * 0.88], rot: [Math.PI / 2, 0, 0], cast: false });
  }
  P(model, hj, G('docStrap', () => new THREE.TorusGeometry(1, 0.1, 6, 20)), dark, { pos: [0, H.y0 + hr * 0.08, 0], scale: [hr * 1.0, hr * 1.0, hr * 1.0], rot: [Math.PI / 2, 0, 0] });
  // yellow collar + belt
  P(model, cj, cylGeo(0.075 * k, 0.1 * k, 0.07 * k, 12), yellow, { pos: [0, 0.4 * k, 0], scale: [1.2, 1, 0.9] });
  P(model, model.j[J.SP], cylGeo(0.14 * k, 0.15 * k, 0.05 * k, 14), dark, { pos: [0, 0.06 * k, 0], scale: [1.36, 1, 0.9] });
  // back harness with four sockets
  const steel = metal(0x7d8a86, { roughness: 0.35 });
  const roots = [[0.15, 0.27, -0.17], [-0.15, 0.27, -0.17], [0.19, 0.1, -0.15], [-0.19, 0.1, -0.15]].map((r) => new V3(r[0] * k, r[1] * k, r[2] * k));
  P(model, cj, mergeParts('docHarness' + k, [
    { geo: boxGeo(0.36 * k, 0.4 * k, 0.07 * k), pos: [0, 0.2 * k, -0.15 * k] },
    ...roots.map((r) => ({ geo: cylGeo(0.05 * k, 0.06 * k, 0.07 * k, 10), pos: [r.x * 1.12, r.y, r.z - 0.04 * k], rot: [Math.PI / 2, 0, 0] })),
  ]), steel, {});
  // four tentacles
  const tubeM = metal(0x8a9490, { roughness: 0.3 });
  const fuseM = symMat({ id: 'docfuse', color: 0x050508, rim: 0x8a30ff, rimK: 0.8, rough: 0.18 });
  const clawM = metal(0xb0b6b4, { roughness: 0.25 });
  const tents = [];
  for (let i = 0; i < 4; i++) {
    const tube = new SegTube({ segs: 26, radial: 8, material: tubeM });
    model.group.add(tube.mesh);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa4a0, metalness: 0.8, roughness: 0.3, emissive: 0x000000 });
    const hub = new THREE.Mesh(sphereGeo(1, 10, 8), hubMat); hub.castShadow = true; hub.scale.setScalar(0.12);
    const prongG = G('docProng', () => { const g = new THREE.ConeGeometry(0.035, 0.34, 5); g.translate(0, 0.17, 0); g.rotateX(Math.PI / 2); return g; });
    const pa = new THREE.Mesh(prongG, clawM), pb = new THREE.Mesh(prongG, clawM);
    pa.castShadow = pb.castShadow = true;
    model.group.add(hub, pa, pb);
    tents.push({ tube, hub, hubMat, pa, pb, cur: new V3(), init: false, ph: i * 1.7, gait: 0 });
  }
  model.tubeMats = { normal: tubeM, fused: fuseM };
  const idleTips = [new V3(1.35, 0.05, 0.95), new V3(-1.35, 0.05, 0.95), new V3(1.45, 0.05, -0.95), new V3(-1.45, 0.05, -0.95)];
  const _r = new V3(), _t = new V3(), _c1 = new V3(), _c2 = new V3(), _d = new V3(), _out = new V3(), _tan = new V3(), _q = new THREE.Quaternion(), _e = new V3(), _up = new V3(0, 1, 0);
  let gaitPh = 0;
  const bez = (u, R, c1, c2, T, out) => {
    const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
    return out.set(R.x * a + c1.x * b + c2.x * c + T.x * d, R.y * a + c1.y * b + c2.y * c + T.y * d, R.z * a + c1.z * b + c2.z * c + T.z * d);
  };
  model.fused = false;
  model.setFuse = (on) => {
    model.fused = !!on;
    for (const t of tents) { t.tube.mesh.material = on ? fuseM : tubeM; }
  };
  captureEntity(model, (dt) => {
    const ent = model.extra.ent;
    model.group.parent?.updateMatrixWorld(true);
    model.group.updateMatrixWorld(true);
    const spd = ent ? Math.hypot(ent.vel.x, ent.vel.z) : 0;
    gaitPh += dt * (2 + spd * 0.9);
    const tm = model.time;
    for (let i = 0; i < 4; i++) {
      const t = tents[i], st = ent?.tents?.[i];
      const alive = st ? st.alive : true;
      t.tube.mesh.visible = t.hub.visible = t.pa.visible = t.pb.visible = alive;
      if (!alive) continue;
      _r.copy(roots[i]); cj.localToWorld(_r); model.group.worldToLocal(_r);
      let rate = 7;
      if (st && st.tgt) { _t.copy(st.tgt); model.group.worldToLocal(_t); rate = st.rate ?? 12; }
      else {
        _t.copy(idleTips[i]);
        const lift = spd > 0.6 ? Math.max(0, Math.sin(gaitPh + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.2 : 0))) : 0;
        _t.y += lift * 0.55; _t.z += Math.sin(gaitPh + (i % 2 ? Math.PI : 0)) * 0.28 * Math.min(1, spd / 4);
        _t.x += Math.sin(tm * 0.9 + t.ph) * 0.07; _t.z += Math.cos(tm * 0.7 + t.ph) * 0.07;
      }
      if (!t.init) { t.cur.copy(_t); t.init = true; }
      t.cur.lerp(_t, 1 - Math.exp(-rate * Math.min(dt, 0.05)));
      const T = t.cur;
      _d.subVectors(T, _r); const L = _d.length() || 0.01;
      _out.set(_d.x, 0, _d.z); if (_out.lengthSq() < 1e-4) _out.set(Math.sign(_r.x) || 1, 0, 0); _out.normalize();
      const sideX = Math.sign(_r.x) || 1;
      _c1.set(_r.x + sideX * 0.35 + _out.x * 0.18 * L, _r.y + 0.55 + 0.28 * L, _r.z + _out.z * 0.18 * L - 0.1);
      _c2.set(T.x - _out.x * 0.12 * L, T.y + 0.3 + 0.3 * L, T.z - _out.z * 0.12 * L);
      for (let s = 0; s <= t.tube.segs; s++) bez(s / t.tube.segs, _r, _c1, _c2, T, t.tube.pts[s]);
      const r0 = 0.095 - i * 0.0, rs = 0.5 + 0.5 * 0;
      t.tube.rebuild((u) => (r0 * (1 - 0.5 * u) + 0.012) * (1 + 0.32 * Math.pow(0.5 + 0.5 * Math.cos(u * 9 * Math.PI * 2), 2)) * clamp(1.15 - L * 0.03, 0.7, 1.15));
      // claw at the tip, aligned with the final tangent
      bez(0.97, _r, _c1, _c2, T, _tan); _tan.subVectors(T, _tan).normalize();
      _q.setFromUnitVectors(new V3(0, 0, 1), _tan);
      const open = st ? (st.open ?? 0.35) : 0.35 + 0.15 * Math.sin(tm * 2 + t.ph);
      t.hub.position.copy(T); t.pa.position.copy(T); t.pb.position.copy(T);
      t.pa.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(_up, open)).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), 0.12));
      t.pb.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(_up, -open)).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), 0.12));
      // weak-point glow
      const weak = st?.weak ? 0.5 + 0.5 * Math.sin(tm * 8) : 0;
      t.hubMat.emissive.setRGB(weak, weak * 0.1, weak * 0.05);
      t.hubMat.emissiveIntensity = 1.5;
      t.hub.scale.setScalar(0.11 + weak * 0.05);
    }
  });
  addHook(model, null, () => { for (const t of tents) { t.tube.dispose(); t.hubMat.dispose(); } });
  return finish(model);
}

// ================================================================== OCTOBOT (hover drone)
export function buildOctobot() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6f8a78, metalness: 0.7, roughness: 0.35, emissive: 0x000000 });
  const dark = std(0x1d2420, { roughness: 0.5, metalness: 0.6 });
  const eyeM = glow(0xff3030, 2.4);
  const body = new THREE.Mesh(sphereGeo(1, 16, 12), bodyMat); body.scale.set(0.34, 0.28, 0.34); body.position.y = 0.4;
  const ring = new THREE.Mesh(G('octoRing', () => new THREE.TorusGeometry(1, 0.12, 8, 20)), dark); ring.scale.set(0.4, 0.4, 0.4); ring.position.y = 0.4; ring.rotation.x = Math.PI / 2;
  const eye = new THREE.Mesh(sphereGeo(1, 10, 8), eyeM); eye.scale.set(0.11, 0.11, 0.08); eye.position.set(0, 0.42, 0.3);
  const gun = new THREE.Mesh(cylGeo(0.03, 0.04, 0.22, 8), dark); gun.rotation.x = Math.PI / 2; gun.position.set(0, 0.3, 0.34);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.3, 0.46); group.add(muzzle);
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const l = new THREE.Mesh(coneGeo(0.04, 0.3, 5), bodyMat); l.position.set(Math.sin(a) * 0.22, 0.17, Math.cos(a) * 0.22); l.rotation.set(Math.cos(a) * 0.5 + Math.PI, 0, -Math.sin(a) * 0.5);
    group.add(l); legs.push(l);
  }
  const glowU = new THREE.Mesh(sphereGeo(1, 8, 6), glow(0x40ffa0, 1.8)); glowU.scale.set(0.12, 0.05, 0.12); glowU.position.y = 0.1;
  group.add(body, ring, eye, gun, glowU);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const anchor = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); group.add(o); return o; };
  const model = {
    id: 'octobot', group, height: 0.8, handR: anchor(-0.3, 0.4, 0.1), handL: anchor(0.3, 0.4, 0.1), chest: anchor(0, 0.4, 0.2), head: anchor(0, 0.5, 0),
    footL: anchor(0.1, 0, 0), footR: anchor(-0.1, 0, 0), muzzle, customRotation: false, thrusters: [], extra: {},
    update(dt, anim) {
      const t = performance.now() / 1000;
      ring.rotation.z += dt * 6;
      const st = anim?.state || 'idle';
      body.position.y = ring.position.y = 0.4 + Math.sin(t * 4) * 0.015;
      eyeM.color.setRGB(2.4, st === 'shoot' ? 2.4 : 0.35, st === 'shoot' ? 2.4 : 0.2);
      group.rotation.z = st === 'stunned' ? Math.sin(t * 30) * 0.2 : 0;
    },
    setVariant() {},
    setTint(color, amount = 0) { bodyMat.emissive.set(color ?? 0xffffff).multiplyScalar(amount); },
    dispose() { bodyMat.dispose(); group.removeFromParent(); },
  };
  return model;
}

registerModel('kraven', buildKraven);
registerModel('lizard', () => buildLizard({}));
registerModel('lizardman', () => buildLizard({ small: true }));
registerModel('docock', buildDocOck);
registerModel('octobot', buildOctobot);
