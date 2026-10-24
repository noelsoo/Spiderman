// v2 heroes: Wolverine, Captain America, Hawkeye, Scarlet Witch. Same rig / animation system as the originals.
import * as THREE from 'three';
import { buildRig, makeDims, ProcModel, J } from './rig.js';
import {
  G, std, metal, glow, glowInstance, phys, withRim, sphereGeo, boxGeo, cylGeo, coneGeo, capsuleGeo, mergeParts, rng, seg,
  fabricNormal, grainNormal, scaleMaps, capChestTexture, capStripesTexture, starTexture, shieldTexture, domeGeo, drawTex, faceTexture, faceShell, M,
} from './common.js';
import { P, addHook, buildBody, addFace, finish, curvedPlane, skullHead, patch, strand, addEars } from './characters.js';
import { tab, hairMaterial, skullMetres } from './face.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2;
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;
const fab = (name = 'h2fab', p = 6) => ({ normalMap: fabricNormal(p, 0.55, name), normalScale: new V2(0.7, 0.7) });
const cloth = (color, o = {}) => withRim(phys(color, { roughness: 0.6, ...fab(), sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffffff), ...o }), 0xcfe0ff, 0.1);
const leather = (color, o = {}) => std(color, { roughness: 0.7, normalMap: grainNormal('leather', 5, 2.4), normalScale: new V2(0.9, 0.9), ...o });

/** lagged-chain cloth panel (cape / coat tail / hair curtain) hung from `joint`. Same secondary motion as Thor's cape. */
function addCloth(model, joint, o) {
  const { R = 8, C = 3, len, w0, w1, anchor, mat, resp = 1, base = 0.12, billow = 0.05, k = 1, folds = 0, foldN = 9 } = o;
  const geo = new THREE.PlaneGeometry(1, 1, C, R);
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.castShadow = true;
  joint.add(mesh); model.parts.push(mesh); mesh.userData.mat = mat;
  const ang = new Float32Array(R + 1).fill(base), rol = new Float32Array(R + 1), cp = new Float32Array((R + 1) * 3);
  addHook(model, (c) => {
    const dt = c.dt, v = c.vl;
    const stateFly = c.st === 'fly' || c.st === 'glide' || c.st === 'zip' || c.st === 'hover';
    const speedK = clamp(Math.hypot(v.x, v.z) / 14, 0, 1);
    let a0 = base + clamp(v.z * 0.045 * resp, -0.1, 1.15) - clamp(v.y * 0.025 * resp, -0.9, 0.7) * (stateFly ? 0.2 : 1);
    if (c.st === 'hover' || c.st === 'idle') a0 += Math.sin(c.tm * 1.3 + o.ph) * 0.04;
    if (c.st === 'dead') a0 = 0.02;
    a0 = clamp(a0, -0.1, 1.9);
    const r0 = clamp(v.x * 0.03 + c.yawRate * 0.07, -0.7, 0.7);
    ang[0] += (a0 - ang[0]) * (1 - Math.exp(-10 * dt)); rol[0] += (r0 - rol[0]) * (1 - Math.exp(-10 * dt));
    for (let i = 1; i <= R; i++) {
      const lag = 1 - Math.exp(-(15 - i * 1.15) * dt);
      ang[i] += (ang[i - 1] + Math.sin(c.tm * 6 + i * 0.9 + o.ph) * (0.02 + 0.07 * speedK + (stateFly ? 0.03 : 0)) * (i / R) * 2 - ang[i]) * lag;
      rol[i] += (rol[i - 1] + Math.sin(c.tm * 4.3 + i * 0.7 + o.ph) * 0.03 * (speedK + 0.2) - rol[i]) * lag;
    }
    let x = anchor.x, y = anchor.y, z = anchor.z; const sg = len / R;
    for (let i = 0; i <= R; i++) {
      cp[i * 3] = x; cp[i * 3 + 1] = y; cp[i * 3 + 2] = z;
      x += Math.sin(rol[i]) * sg; y -= Math.cos(ang[i]) * Math.cos(rol[i]) * sg; z -= Math.sin(ang[i]) * sg;
    }
    const pos = geo.attributes.position;
    for (let j = 0; j <= R; j++) {
      const w = lerp(w0, w1, j / R) * (1 + 0.1 * Math.sin(c.tm * 3 + j + o.ph) * speedK);
      for (let i = 0; i <= C; i++) {
        const u = i / C * 2 - 1;
        const bl = -(1 - u * u) * billow * k * Math.sin((j / R) * Math.PI) * (1 + speedK * 1.5) - Math.abs(u) * 0.02 * (j / R) + folds * k * Math.sin(u * foldN + 0.8 + Math.sin(c.tm * 1.9 + j * 0.5 + o.ph) * 0.15 * speedK) * Math.pow(j / R, 0.7) * (1 - 0.35 * u * u) * (1 + speedK * 0.8);
        pos.setXYZ(j * (C + 1) + i, cp[j * 3] + u * w * 0.5 * Math.cos(rol[j]), cp[j * 3 + 1], cp[j * 3 + 2] + bl - Math.sin(c.tm * 5 + j * 1.2 + u * 2) * 0.012 * speedK * (j / R));
      }
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  }, () => geo.dispose());
  return mesh;
}
const phase = () => Math.random() * 6;
const sm01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ================================================================== WOLVERINE
export function buildWolverine() {
  const dims = makeDims(0.87, { headR: 0.108, shW: 0.205, thigh: 0.4, shin: 0.4 });
  const rig = buildRig(dims, 1.04);
  const model = new ProcModel('wolverine', rig, { prof: { stance: 'feral', cadence: 1.12, stride: 1.0, armSwing: 1.1, lean: 1.35, bob: 1.2, flipDodge: true, shoot: 'palm', aimStyle: 'gun', tempo: 1.1 } });
  const k = dims.k;
  const YEL = '#f2c213', BLU = '#16348c';
  const torsoTex = drawTex('wolvTorso', 512, 512, (ctx, W, H) => {
    ctx.fillStyle = BLU; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = YEL; ctx.beginPath(); ctx.moveTo(W * 0.38, 0); ctx.lineTo(W * 0.62, 0); ctx.quadraticCurveTo(W * 0.6, H * 0.5, W * 0.57, H); ctx.lineTo(W * 0.43, H); ctx.quadraticCurveTo(W * 0.4, H * 0.5, W * 0.38, 0); ctx.fill();
    ctx.fillStyle = '#0a0a10';
    for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) {
      const y = H * (0.07 + i * 0.145), ex = W * 0.5 + sd * W * (0.115 - i * 0.003), tx = W * 0.5 + sd * W * (0.06 + (i % 2) * 0.02);
      ctx.beginPath(); ctx.moveTo(ex, y - 13); ctx.quadraticCurveTo((ex + tx) / 2, y + 2, tx, y + 14); ctx.quadraticCurveTo((ex + tx) / 2, y + 12, ex, y + 16); ctx.fill();
    }
  }, { offsetX: 0.5 });
  const blue = cloth(0x1a3a96), yellow = cloth(0xf2c213, { roughness: 0.5 });
  const torso = cloth(0xffffff, { map: torsoTex, normalScale: new V2(0.3, 0.3) });
  const skin = std(0xd8a27c, { roughness: 0.65 });
  const WLd = skullHead('wolv', { brow: 0.05, jawBone: 0.07, chin: 0.1, chinW: 0.3, taper: 0.12, cheek: 0.055, nose: 0.2, jawFlare: 0.05, muzzle: 0.03 },
    { skin: '#d8a27c', iris: '#5a3a22', brow: '#2a1a10', lip: '#8a4a40', mood: 'angry', stubble: 0.5, browW: 0.05, lid: 0.3, seed: 31, eyeSize: 1.25 });
  const info = buildBody(model, {
    headGeo: WLd.headGeo, skull: WLd.skull,
    mats: { default: blue, chest: torso, abdomen: torso, pelvis: blue, neck: skin, head: WLd.mat, shoulder: blue, upperArm: blue, foreArm: blue, hand: yellow, thigh: blue, shin: blue, foot: yellow },
    torso: { sx: 1.52, sz: 0.96, chestR: 1.14, waistR: 1.0 },
    head: { R: 0.108, sx: 0.95, sy: 1.04, sz: 1.02 },
    arm: { u0: 0.058, u1: 0.05, f0: 0.05, f1: 0.042, ub: 0.2, fb: 0.22 },
    leg: { t0: 0.094, t1: 0.064, s0: 0.064, s1: 0.045, tb: 0.14, sb: 0.14 },
    foot: [0.06, 0.05, 0.15], hand: [0.05, 0.058, 0.055], pelvis: [0.4, 0.22, 0.28], armM: 1.12, legM: 1.05, neckR: 0.065,
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  // cowl: covers the skull down to the nose bridge, frames the face with two swept-back fins; white angled lenses; sideburns
  const cowl = phys(0x142a78, { roughness: 0.5, ...fab('wolvmask', 5), sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x6a8cff) });
  patch(model, H, 'wolvcowl', { na: seg(44, 26), nb: 14, top: () => Math.PI / 2, bot: tab([[0, -0.12], [0.35, -0.15], [0.8, -0.36], [1.3, -0.34], [2.0, -0.5], [3.14, -0.56]]), thick: () => 0.04 }, cowl, { cast: true });
  const earG = G('wolvear', () => { const g = new THREE.ConeGeometry(0.036, 0.19, 5); g.translate(0, 0.095, 0); return g; });
  const lensM = glow(0xffffff, 1.8);
  const lensC = (a) => lerp(0.035, 0.115, (Math.abs(a) - 0.1) / 0.5), lensH = (a) => 0.078 * Math.sqrt(Math.max(0.02, 1 - ((Math.abs(a) - 0.36) / 0.27) ** 2));
  for (const s of [1, -1]) {
    P(model, hj, earG, cowl, { pos: [s * hr * 0.86, H.y0 + hr * 0.5, -hr * 0.12], rot: [-0.75, 0, -s * 0.62], scale: [1, 1, 0.8] });
    patch(model, H, 'wolvlens' + s, { aMin: s > 0 ? 0.1 : -0.64, aMax: s > 0 ? 0.64 : -0.1, na: 12, nb: 5, top: (a) => lensC(a) + lensH(a), bot: (a) => lensC(a) - lensH(a) * 0.75, thick: () => 0.052 }, lensM);
    patch(model, H, 'wolvchop' + s, { aMin: s > 0 ? 1.05 : -1.45, aMax: s > 0 ? 1.45 : -1.05, na: 8, nb: 8, top: () => -0.12, bot: (a) => lerp(-0.62, -0.42, (Math.abs(a) - 1.05) / 0.4), thick: () => 0.05 }, hairMaterial('#2a1a10', { hi: '#5a3a22', seed: 9, rough: 0.75, sheen: 0x555555 }));
  }
  addEars(model, H, skin);
  // belt + buckle, boots, cuffs
  P(model, model.j[J.SP], cylGeo(0.16 * k, 0.165 * k, 0.06 * k, seg(18, 10)), yellow, { pos: [0, 0.05 * k, 0], scale: [1.36, 1, 0.9] });
  P(model, model.j[J.SP], boxGeo(0.07 * k, 0.07 * k, 0.03), metal(0xcfa23a, { roughness: 0.3 }), { pos: [0, 0.05 * k, 0.14 * k] });
  for (const s of [1, -1]) {
    P(model, model.j[s > 0 ? J.KL : J.KR], cylGeo(0.062 * k, 0.05 * k, dims.shin * 0.42, seg(12, 8)), yellow, { pos: [0, -dims.shin * 0.72, 0] });
    P(model, model.j[s > 0 ? J.KL : J.KR], cylGeo(0.07 * k, 0.062 * k, 0.05 * k, seg(12, 8)), blue, { pos: [0, -dims.shin * 0.5, 0] }); // flared boot top
    P(model, model.j[s > 0 ? J.EL : J.ER], cylGeo(0.047 * k, 0.04 * k, dims.fore * 0.32, seg(12, 8)), yellow, { pos: [0, -dims.fore * 0.84, 0] }); // glove cuff
  }
  // side stripes on thighs (tiger striping continues)
  const stripes = []; for (let i = 0; i < 4; i++) stripes.push({ geo: boxGeo(0.012, 0.012, 0.07 * k - i * 0.01), pos: [0, -0.1 * k - i * 0.07 * k, 0], rot: [0, 0, 0] });
  // ---- claws: three adamantium blades per hand
  const clawMat = std(0xe9eef5, { metalness: 1, roughness: 0.1, emissive: 0x1a2430, emissiveIntensity: 1 });
  const blade = G('wolvblade', () => { const g = new THREE.ConeGeometry(0.0125, 0.36, 4, 1); g.rotateX(Math.PI); g.translate(0, -0.18, 0); g.scale(1, 1, 0.32); return g; });
  const claws = [];
  for (const s of [1, -1]) {
    const grp = new THREE.Group(); grp.position.set(0, -dims.hand * 0.55, 0.01);
    for (let i = -1; i <= 1; i++) { const b = new THREE.Mesh(blade, clawMat); b.position.set(i * 0.027 * k, 0, 0); b.castShadow = true; grp.add(b); }
    grp.visible = false; grp.scale.set(1, 0.001, 1);
    model.j[s > 0 ? J.WL : J.WR].add(grp); claws.push(grp);
  }
  let target = 0, ck = 0, cv = 0;
  model.clawsOut = false;
  model.setClaws = (on) => { target = on ? 1 : 0; model.clawsOut = !!on; };
  addHook(model, (c) => {
    // spring with overshoot: the "snikt"
    cv += ((target - ck) * 340 - cv * 24) * c.dt; ck += cv * c.dt;
    const e = Math.max(0, ck);
    for (const g of claws) { g.visible = e > 0.015; g.scale.set(0.75 + 0.25 * Math.min(e, 1.1), e, 1); }
  });
  return finish(model);
}

// ================================================================== CAPTAIN AMERICA
export function buildCaptain() {
  const dims = makeDims(0.975, { headR: 0.108, shW: 0.215 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('captain', rig, { prof: { stance: 'ready', cadence: 0.98, stride: 1.05, armSwing: 1.0, lean: 1.1, shoot: 'palm', aimStyle: 'gun', charge: 'shield', flipDodge: true, landStyle: 'hero' } });
  const k = dims.k;
  const sc = scaleMaps('#14235c', '#4466b8', 8);
  sc.map.repeat.set(3, 2); sc.normal.repeat.set(3, 2);
  const scaleMat = withRim(phys(0xffffff, { map: sc.map, normalMap: sc.normal, normalScale: new V2(1.0, 1.0), roughness: 0.42, metalness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.3 }), 0x9fc0ff, 0.14);
  const stripeTex = capStripesTexture();
  const stripes = cloth(0xffffff, { map: stripeTex });
  const red = cloth(0xa81420, { roughness: 0.5 });
  const gloveM = leather(0x4a2c18, { roughness: 0.62 });
  const navy = cloth(0x1a2a6c);
  const skin = std(0xe3b490, { roughness: 0.62 });
  const CPd = skullHead('cap', { brow: 0.05, jawBone: 0.065, chin: 0.1, chinW: 0.3, taper: 0.14, cheek: 0.05, nose: 0.19, socket: 0.05 },
    { skin: '#e3b490', iris: '#4a80c8', brow: '#6a4a24', lip: '#b0605a', mood: 'stern', stubble: 0.12, browW: 0.05, seed: 41, eyeSize: 1.3 });
  const info = buildBody(model, {
    headGeo: CPd.headGeo, skull: CPd.skull,
    mats: { default: scaleMat, chest: scaleMat, abdomen: stripes, pelvis: navy, neck: skin, head: CPd.mat, shoulder: scaleMat, upperArm: scaleMat, foreArm: scaleMat, hand: gloveM, thigh: navy, shin: red, foot: gloveM },
    torso: { sx: 1.46, sz: 0.86, chestR: 1.16, waistR: 0.9 },
    head: { R: 0.108, sx: 0.92, sy: 1.08, sz: 1.0 },
    arm: { u0: 0.058, u1: 0.047, f0: 0.047, f1: 0.037, ub: 0.14, fb: 0.14 },
    leg: { t0: 0.092, t1: 0.063, s0: 0.063, s1: 0.043, tb: 0.1, sb: 0.1 },
    foot: [0.058, 0.05, 0.15], hand: [0.046, 0.056, 0.052], pelvis: [0.38, 0.2, 0.27], armM: 1.08,
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  // star + chest
  const cr = info.chestRad(0.2 * k);
  const starM = phys(0xffffff, { map: capChestTexture(), transparent: true, alphaTest: 0.3, roughness: 0.35, metalness: 0.2, clearcoat: 0.5, side: THREE.DoubleSide });
  P(model, cj, curvedPlane(0.26 * k, 0.26 * k, cr.rx, cr.rz, 0.004), starM, { pos: [0, 0.2 * k, 0], cast: false });
  // belt, buckle, pouches
  const brown = leather(0x5a3a1e);
  P(model, model.j[J.SP], cylGeo(0.15 * k, 0.155 * k, 0.06 * k, seg(18, 10)), brown, { pos: [0, 0.055 * k, 0], scale: [1.3, 1, 0.84] });
  P(model, model.j[J.SP], boxGeo(0.05 * k, 0.05 * k, 0.025), metal(0xc9a74a, { roughness: 0.3 }), { pos: [0, 0.055 * k, 0.131 * k] });
  const pch = []; for (const x of [-0.1, 0.1]) pch.push({ geo: boxGeo(0.055 * k, 0.06 * k, 0.04 * k), pos: [x * k * 1.35, 0.055 * k, 0.1 * k], rot: [0, x * 4, 0] });
  P(model, model.j[J.SP], mergeParts('capPouch' + k, pch), brown, {});
  // leather straps: harness over the shoulders + thigh holster strap + wrist cuffs
  const strapG = G('capstrap', () => new THREE.BoxGeometry(0.03 * k, 0.17 * k, 0.012));
  for (const s of [1, -1]) {
    P(model, cj, strapG, brown, { pos: [s * cr.rx * 0.5, 0.31 * k, cr.rz * 0.72], rot: [0.35, 0, s * 0.18], cast: false });
    P(model, model.j[s > 0 ? J.TL : J.TR], cylGeo(0.071 * k, 0.067 * k, 0.025 * k, seg(12, 8)), brown, { pos: [0, -dims.thigh * 0.55, 0] });
  }
  // shoulder straps: sleeve/neck detail
  for (const s of [1, -1]) {
    P(model, model.j[s > 0 ? J.EL : J.ER], cylGeo(0.05 * k, 0.042 * k, dims.fore * 0.38, seg(12, 8)), red, { pos: [0, -dims.fore * 0.82, 0] }); // gauntlet
    P(model, model.j[s > 0 ? J.KL : J.KR], cylGeo(0.066 * k, 0.052 * k, dims.shin * 0.5, seg(12, 8)), red, { pos: [0, -dims.shin * 0.7, 0] }); // boot
  }
  // cowl: scale-mail hood with an open face, white wings, forehead 'A' and a leather chin strap
  const cowl = withRim(phys(0x16286a, { roughness: 0.45, metalness: 0.2, ...fab('capcowl', 5), clearcoat: 0.3 }), 0x9fc0ff, 0.1);
  patch(model, H, 'capcowl', { na: seg(44, 26), nb: 14, top: () => Math.PI / 2, bot: tab([[0, 0.36], [0.5, 0.24], [0.85, 0.02], [1.2, -0.08], [1.6, -0.5], [3.14, -0.64]]), thick: () => 0.04 }, cowl, { cast: true });
  const A = drawTex('capA', 128, 128, (ctx, W, Hh) => {
    ctx.fillStyle = '#f4f4f4'; ctx.font = 'bold 100px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('A', W / 2, Hh / 2 + 6);
  }, { clamp: true });
  patch(model, H, 'capA', { aMin: -0.3, aMax: 0.3, na: 8, nb: 6, top: () => 0.86, bot: () => 0.5, thick: () => 0.065 }, std(0xffffff, { map: A, transparent: true, alphaTest: 0.3, roughness: 0.5, depthWrite: false }));
  const jl = tab([[0, -0.97], [0.4, -0.92], [0.8, -0.76], [1.2, -0.42], [1.45, -0.12]]);
  patch(model, H, 'capstrap', { aMin: -1.45, aMax: 1.45, na: 28, nb: 2, top: (a) => jl(a) + 0.09, bot: (a) => jl(a) - 0.09, thick: () => 0.03 }, leather(0x7a5430, { roughness: 0.6 }), { cast: true });
  P(model, hj, boxGeo(hr * 0.2, hr * 0.17, hr * 0.06), metal(0xc9a74a, { roughness: 0.3 }), { pos: [0, H.y0 - hr * H.sy * 0.97 * 0.8, hr * H.sz * 0.62], rot: [0.55, 0, 0] });
  const wing = G('capwing', () => { const g = new THREE.ConeGeometry(0.03, 0.14, 3); g.translate(0, 0.07, 0); g.scale(1, 1, 0.25); return g; });
  const white = std(0xf0f0f0, { roughness: 0.4 });
  for (const s of [1, -1]) for (let i = 0; i < 2; i++) P(model, hj, wing, white, { pos: [s * hr * 0.98, H.y0 + hr * (0.18 + i * 0.12), -hr * 0.1 - i * 0.02], rot: [-0.9 + i * 0.3, 0, -s * (1.3 + i * 0.25)] });
  addEars(model, H, skin);

  // ---- shield on the left forearm
  const sMat = withRim(phys(0xffffff, { map: shieldTexture(), roughness: 0.28, metalness: 0.7, clearcoat: 0.7, clearcoatRoughness: 0.12, side: THREE.DoubleSide }), 0xffffff, 0.12);
  const rimMat = metal(0xc9ced6, { roughness: 0.2 });
  const SR = 0.29;
  const pivot = new THREE.Group(); pivot.position.set(0, -dims.fore * 0.5, 0);
  model.j[J.EL].add(pivot);
  const mount = new THREE.Group(); mount.position.set(0.085, 0, 0); mount.rotation.y = Math.PI / 2; pivot.add(mount);
  const shield = new THREE.Group(); mount.add(shield);
  const dome = new THREE.Mesh(domeGeo(SR, 0.07, seg(36, 16), 7), sMat); dome.castShadow = true; shield.add(dome);
  const rimM = new THREE.Mesh(G('shieldrim' + seg(36, 16), () => new THREE.TorusGeometry(SR, 0.011, 8, seg(40, 18))), rimMat); rimM.castShadow = true; shield.add(rimM);
  const back = new THREE.Mesh(G('shieldback' + seg(36, 16), () => { const g = new THREE.CircleGeometry(SR, seg(36, 16)); g.rotateY(Math.PI); return g; }), std(0x2a2a30, { roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide })); back.position.z = -0.002; shield.add(back);
  const strap = new THREE.Mesh(boxGeo(0.06, 0.1, 0.03), leather(0x3a2616)); strap.position.set(0, 0, -0.03); shield.add(strap);
  shield.traverse((o) => { if (o.isMesh) { model.parts.push(o); o.userData.mat = o.material; } });
  model.shield = shield; model.shieldAttached = true;
  model.detachShield = () => {
    model.group.updateMatrixWorld(true);
    const c = shield.clone(true); // +Z of the clone is the shield's facing direction
    shield.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    c.visible = true; c.traverse((o) => { o.visible = true; });
    shield.visible = false; model.shieldAttached = false;
    return c;
  };
  model.attachShield = () => { shield.visible = true; model.shieldAttached = true; return shield; };
  let bk = 0;
  addHook(model, (c) => {
    bk += (((c.st === 'block' || c.st === 'charge') ? 1 : 0) - bk) * (1 - Math.exp(-12 * c.dt));
    pivot.rotation.y = bk * Math.PI / 2;
    pivot.position.set(bk * 0.0, -dims.fore * 0.5, 0);
  });
  return finish(model);
}

// ================================================================== HAWKEYE
export function buildHawkeye() {
  const dims = makeDims(0.97, { headR: 0.108, shW: 0.2 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('hawkeye', rig, { prof: { stance: 'ready', cadence: 1.08, stride: 1.05, armSwing: 1.0, lean: 1.15, shoot: 'bow', aimStyle: 'bow', alignHand: 'none', flipDodge: true } });
  const k = dims.k;
  const purple = cloth(0x4a2a8c), black = cloth(0x15151c), plum = cloth(0x32205f);
  // stitched leather panels (seams, piping, dashed topstitching); front centre = texture x 0.5
  const stitchTex = (name, base, dark, thread, seams) => drawTex(name, 512, 512, (ctx, W, Hh) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, Hh); const r = rng(9);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(r() * W, r() * Hh, 2 + r() * 6, 1 + r() * 4); }
    const line = (x0, y0, x1, y1) => {
      ctx.strokeStyle = dark; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = thread; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      const dx = y1 - y0, dy = x0 - x1, l = Math.hypot(dx, dy) || 1;
      for (const o of [-8, 8]) { ctx.beginPath(); ctx.moveTo(x0 + dx / l * o, y0 + dy / l * o); ctx.lineTo(x1 + dx / l * o, y1 + dy / l * o); ctx.stroke(); }
      ctx.setLineDash([]);
    };
    for (const f of seams) line(W * (0.5 + f), 0, W * (0.5 + f), Hh);
    line(0, Hh * 0.34, W, Hh * 0.34); line(0, Hh * 0.7, W, Hh * 0.7);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, 6); ctx.fillRect(0, Hh - 6, W, 6);
  }, { offsetX: 0.5 });
  const leatherPanel = (name, base, dark, thread, seams) => phys(0xffffff, { map: stitchTex(name, base, dark, thread, seams), roughness: 0.6, normalMap: grainNormal('leather', 5, 2.4), normalScale: new V2(0.9, 0.9), sheen: 0.3, sheenColor: new THREE.Color(0xb090ff) });
  const vest = leatherPanel('hawkVest', '#4a2a8c', '#1d1040', '#d8c8ff', [0, -0.22, 0.22, -0.4, 0.4]);
  const tac = leatherPanel('hawkTac', '#1b1b22', '#08080c', '#8a8a9a', [0, -0.25, 0.25]);
  const skin = std(0xdcae8c, { roughness: 0.65 });
  const lthr = leather(0x2a2018);
  const HKd = skullHead('hawk', { brow: 0.055, jawBone: 0.07, chin: 0.09, chinW: 0.28, taper: 0.17, cheek: 0.05, nose: 0.2 },
    { skin: '#dcae8c', iris: '#6b8f5c', brow: '#2a1d14', lip: '#9a5048', mood: 'smirk', stubble: 0.8, browW: 0.048, seed: 51, eyeSize: 1.25 });
  const info = buildBody(model, {
    headGeo: HKd.headGeo, skull: HKd.skull,
    mats: { default: black, chest: vest, abdomen: tac, pelvis: black, neck: skin, head: HKd.mat, shoulder: purple, upperArm: purple, foreArm: black, hand: lthr, thigh: black, shin: black, foot: lthr },
    torso: { sx: 1.3, sz: 0.8, chestR: 1.08, waistR: 0.9 },
    head: { R: 0.108, sx: 0.92, sy: 1.08, sz: 1.0 },
    arm: { u0: 0.052, u1: 0.043, f0: 0.044, f1: 0.035, ub: 0.1, fb: 0.1 },
    leg: { t0: 0.086, t1: 0.058, s0: 0.058, s1: 0.04, tb: 0.08, sb: 0.08 },
    foot: [0.058, 0.05, 0.15], hand: [0.042, 0.054, 0.05], pelvis: [0.37, 0.2, 0.26],
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  // sunglasses (lens + frame patches on the skull, bridge, temple arms) and short cropped hair
  const lens = std(0x0b1118, { roughness: 0.12, metalness: 0.35, emissive: 0x0a1624, emissiveIntensity: 1 });
  const frameM = std(0x07070a, { roughness: 0.35 });
  const lc = (a) => lerp(0.035, 0.05, (Math.abs(a) - 0.08) / 0.55), lh = (a, g) => (0.125 + g) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs((Math.abs(a) - 0.36) / (0.3 + g * 1.4)), 3.2)), 0.5);
  for (const s of [1, -1]) {
    patch(model, H, 'hawkframe' + s, { aMin: s > 0 ? 0.03 : -0.7, aMax: s > 0 ? 0.7 : -0.03, na: 14, nb: 6, top: (a) => lc(a) + lh(a, 0.02), bot: (a) => lc(a) - lh(a, 0.02) * 0.9, thick: () => 0.062 }, frameM);
    patch(model, H, 'hawklens' + s, { aMin: s > 0 ? 0.06 : -0.67, aMax: s > 0 ? 0.67 : -0.06, na: 14, nb: 6, top: (a) => lc(a) + lh(a, 0), bot: (a) => lc(a) - lh(a, 0) * 0.9, thick: () => 0.072 }, lens);
    patch(model, H, 'hawkarm' + s, { aMin: s > 0 ? 0.6 : -1.55, aMax: s > 0 ? 1.55 : -0.6, na: 8, nb: 1, top: () => 0.075, bot: () => 0.03, thick: () => 0.058 }, frameM);
  }
  P(model, hj, boxGeo(hr * 0.16, hr * 0.035, hr * 0.05), frameM, { pos: [0, H.y0 + hr * 0.12, hr * H.sz * 1.0], cast: false });
  const hairM = hairMaterial('#2a1d14', { hi: '#5a4028', seed: 13, rough: 0.7, sheen: 0x665544 });
  patch(model, H, 'hawkhair', { na: seg(40, 24), nb: 12, top: () => Math.PI / 2, bot: tab([[0, 0.62], [0.5, 0.57], [0.9, 0.34], [1.3, 0.1], [1.8, -0.1], [3.14, -0.28]]), thick: (a, l, t) => 0.04 + 0.014 * Math.sin(a * 9) * t }, hairM, { cast: true });
  addEars(model, H, skin);
  // bandolier: a tilted leather band wrapped round the torso (right shoulder to left hip), buckle, plus the belt
  const cr = info.chestRad(0.2 * k);
  const bandG = G('hawkband' + k, () => { const g = new THREE.TorusGeometry(1, 0.0125, 6, 40); g.scale(1, 1, 1); return g; });
  const bandRx = cr.rx * 1.04, bandRz = cr.rz * 1.06;
  const band = P(model, cj, bandG, lthr, { pos: [0, 0.2 * k, 0], rot: [Math.PI / 2, 0.0, 0.0] });
  band.rotation.set(Math.PI / 2, 0, 0); band.scale.set(bandRx, bandRz, 0.9); band.rotateOnWorldAxis(new V3(0, 0, 1), -0.6);
  P(model, cj, boxGeo(0.034 * k, 0.04 * k, 0.014), metal(0xb8a060, { roughness: 0.3 }), { pos: [-cr.rx * 0.2, 0.19 * k + 0.05 * k, cr.rz * 1.02], rot: [0, 0, -0.6], cast: false });
  P(model, model.j[J.SP], cylGeo(0.14 * k, 0.15 * k, 0.05 * k, seg(16, 10)), lthr, { pos: [0, 0.055 * k, 0], scale: [1.28, 1, 0.82] });
  P(model, model.j[J.SP], boxGeo(0.045 * k, 0.04 * k, 0.014), metal(0xb8a060, { roughness: 0.3 }), { pos: [0, 0.055 * k, 0.123 * k], cast: false });
  for (const s of [1, -1]) {
    P(model, model.j[s > 0 ? J.KL : J.KR], sphereGeo(1, 10, 8), purple, { pos: [0, 0.0, 0.03], scale: [0.05 * k, 0.06 * k, 0.04 * k] });
    const el = model.j[s > 0 ? J.EL : J.ER], big = s > 0; // left (bow) arm gets the full archer's arm guard
    const gl = dims.fore * (big ? 0.82 : 0.5);
    P(model, el, cylGeo(0.047 * k, 0.041 * k, gl, seg(12, 8)), lthr, { pos: [0, -dims.fore * (big ? 0.5 : 0.6), 0] }); // bracers
    if (big) {
      P(model, el, G('hawkguardplate', () => new THREE.CylinderGeometry(0.0515 * k, 0.0455 * k, dims.fore * 0.5, 12, 1, true, -0.9, 1.8)), leather(0x3a2a1c, { roughness: 0.55 }), { pos: [0, -dims.fore * 0.45, 0], rot: [0, Math.PI / 2 * 0 + 0, 0] }); // outer plate
      for (const y of [0.22, 0.48, 0.74]) { P(model, el, cylGeo(0.0525 * k, 0.0525 * k, 0.012 * k, seg(12, 8)), lthr, { pos: [0, -dims.fore * y, 0] }); P(model, el, boxGeo(0.014 * k, 0.018 * k, 0.01), metal(0xb8a060, { roughness: 0.3 }), { pos: [0.0, -dims.fore * y, 0.052 * k], cast: false }); }
    }
  }
  // quiver + arrows on the back
  const quiver = new THREE.Group(); quiver.position.set(0.04 * k, 0.18 * k, -0.15 * k); quiver.rotation.set(0.15, 0, -0.45); cj.add(quiver);
  const qm = new THREE.Mesh(cylGeo(0.05 * k, 0.04 * k, 0.5 * k, seg(12, 8)), lthr); qm.castShadow = true; quiver.add(qm); model.parts.push(qm); qm.userData.mat = lthr;
  const arrowParts = [], shaft = cylGeo(0.0045, 0.0045, 0.3 * k, 5), fl = coneGeo(0.016, 0.05, 3);
  for (let i = 0; i < 6; i++) { const a = i * 1.05, r = 0.02 * k; arrowParts.push({ geo: shaft, pos: [Math.cos(a) * r, 0.37 * k, Math.sin(a) * r] }, { geo: fl, pos: [Math.cos(a) * r, 0.5 * k, Math.sin(a) * r], rot: [0, a, 0] }); }
  const arrowsM = new THREE.Mesh(mergeParts('hawkQuiverArrows' + k, arrowParts), std(0xd8d0b8, { roughness: 0.6 })); arrowsM.castShadow = true; quiver.add(arrowsM); model.parts.push(arrowsM); arrowsM.userData.mat = arrowsM.material;
  for (const [y, w] of [[0.1, 0.0], [-0.18, 0.0]]) { const rg = new THREE.Mesh(cylGeo(0.0525 * k - y * 0.02, 0.0525 * k - y * 0.02, 0.02 * k, seg(12, 8)), std(0x1a120c, { roughness: 0.6 })); rg.position.y = y * k; quiver.add(rg); model.parts.push(rg); rg.userData.mat = rg.material; }
  const rimQ = new THREE.Mesh(G('hawkqrim', () => new THREE.TorusGeometry(0.05 * k, 0.007, 6, 14)), metal(0xb8a060, { roughness: 0.3 })); rimQ.rotation.x = Math.PI / 2; rimQ.position.y = 0.25 * k; quiver.add(rimQ); model.parts.push(rimQ); rimQ.userData.mat = rimQ.material;
  const strapQ = new THREE.Mesh(boxGeo(0.03 * k, 0.55 * k, 0.012), lthr); strapQ.position.set(0, 0.25 * k, -0.01); strapQ.rotation.z = 0.0;
  // ---- bow in the left hand
  const bowG = new THREE.Group(); model.handL.add(bowG);
  const bowMat = phys(0x3a2a1c, { roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, normalMap: grainNormal('wood', 4, 1.2), normalScale: new V2(0.6, 0.6) });
  const curve = new THREE.CatmullRomCurve3([[0, 0.53, -0.19], [0, 0.4, -0.07], [0, 0.18, 0.02], [0, 0, 0.04], [0, -0.18, 0.02], [0, -0.4, -0.07], [0, -0.53, -0.19]].map((a) => new V3(...a)));
  const bow = new THREE.Mesh(G('hawkbow' + seg(40, 20), () => new THREE.TubeGeometry(curve, seg(40, 20), 0.012, 6, false)), bowMat); bow.castShadow = true; bowG.add(bow);
  const grip = new THREE.Mesh(cylGeo(0.017, 0.017, 0.11, 8), std(0x15151a, { roughness: 0.9 })); grip.position.set(0, 0, 0.04); bowG.add(grip);
  const strMat = std(0xe8e4d4, { roughness: 0.8 });
  const sg = G('hawkstr', () => { const g = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4); return g; });
  const sTop = new THREE.Mesh(sg, strMat), sBot = new THREE.Mesh(sg, strMat); bowG.add(sTop, sBot);
  const arrow = new THREE.Group(); bowG.add(arrow);
  const ash = new THREE.Mesh(G('hawkarrowshaft', () => { const g = new THREE.CylinderGeometry(0.0055, 0.0055, 0.72, 6); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.36); return g; }), std(0xd8d0b8, { roughness: 0.6 }));
  const ahead = new THREE.Mesh(G('hawkarrowhead', () => { const g = new THREE.ConeGeometry(0.014, 0.07, 5); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.755); return g; }), metal(0xb0b6bf, { roughness: 0.3 }));
  const afl = new THREE.Mesh(G('hawkarrowfl', () => { const g = new THREE.BoxGeometry(0.03, 0.002, 0.07); g.translate(0, 0, 0.05); return g; }), std(0xb02030, { roughness: 0.7 }));
  const afl2 = afl.clone(); afl2.rotation.z = Math.PI / 2; arrow.add(ash, ahead, afl, afl2); arrow.visible = false;
  bowG.traverse((o) => { if (o.isMesh) { model.parts.push(o); o.userData.mat = o.material; o.castShadow = true; } });
  model.bow = bowG; model.arrow = arrow; model.bowString = [sTop, sBot];
  const TIP = 0.53, TIPZ = -0.19;
  let ak = 0, vib = 0, lastDraw = 0, nockX = 0;
  addHook(model, (c, m) => {
    const aimy = c.st === 'aim' || c.st === 'shoot';
    ak += ((aimy ? 1 : 0) - ak) * (1 - Math.exp(-10 * c.dt));
    bowG.rotation.set(ak * Math.PI / 2, 0, 0);
    bowG.position.set(0, -0.01 * (1 - ak), 0.0);
    const d = m.draw;
    if (lastDraw > 0.5 && d < lastDraw - 0.05) vib = 1; // released
    lastDraw = d; vib *= Math.exp(-9 * c.dt);
    const nockZ = TIPZ - d * 0.36, nx = Math.sin(c.tm * 70) * 0.012 * vib;
    const seg2 = (mesh, sy) => {
      const dy = (0 - sy * TIP), dz = nockZ - TIPZ, len = Math.hypot(dy, dz);
      mesh.position.set(nx * 0.5, sy * TIP * 0.5, (TIPZ + nockZ) / 2); mesh.scale.set(1, len, 1); mesh.rotation.set(Math.atan2(dz, dy), 0, 0);
    };
    seg2(sTop, 1); seg2(sBot, -1);
    arrow.visible = d > 0.08 && c.st === 'aim';
    arrow.position.set(0, 0, nockZ + 0.02);
  });
  return finish(model);
}

// ================================================================== SCARLET WITCH
export function buildScarlet() {
  const dims = makeDims(0.915, { headR: 0.106, shW: 0.17, hipW: 0.105 });
  const rig = buildRig(dims, 1.05);
  const model = new ProcModel('scarlet', rig, { prof: { stance: 'relaxed', cadence: 1.0, stride: 0.98, armSwing: 0.9, lean: 1.05, flyStyle: 'witch', hover: 'witch', castStyle: 'hex', shoot: 'palm', aimStyle: 'gun', flipDodge: true } });
  const k = dims.k;
  const crimson = cloth(0x9a0f26, { roughness: 0.45, sheen: 0.8, sheenColor: new THREE.Color(0xff6070) });
  const dark = cloth(0x5a0a18);
  // corset: panelled crimson leather with gold topstitching, front lacing, boning seams (front centre = texture x 0.5)
  const corsetTex = drawTex('scCorset', 512, 512, (ctx, W, Hh) => {
    const g = ctx.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, '#7c0c1f'); g.addColorStop(0.5, '#a1122a'); g.addColorStop(1, '#6f0a1b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
    const r = rng(5); for (let i = 0; i < 2200; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,120,120,0.05)'; ctx.fillRect(r() * W, r() * Hh, 2 + r() * 5, 2 + r() * 5); }
    const seams = [-0.42, -0.3, -0.17, -0.07, 0.07, 0.17, 0.3, 0.42];
    for (const f of seams) {
      const x = W * (0.5 + f);
      ctx.strokeStyle = 'rgba(25,0,4,0.85)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hh); ctx.stroke();
      ctx.strokeStyle = 'rgba(224,176,80,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
      for (const o of [-6, 6]) { ctx.beginPath(); ctx.moveTo(x + o, 0); ctx.lineTo(x + o, Hh); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // lacing
    ctx.fillStyle = 'rgba(20,0,4,0.9)'; ctx.fillRect(W * 0.5 - 16, 0, 32, Hh);
    ctx.strokeStyle = '#d9b25a'; ctx.lineWidth = 3;
    for (let y = 8; y < Hh; y += 26) { ctx.beginPath(); ctx.moveTo(W * 0.5 - 14, y); ctx.lineTo(W * 0.5 + 14, y + 22); ctx.moveTo(W * 0.5 + 14, y); ctx.lineTo(W * 0.5 - 14, y + 22); ctx.stroke(); ctx.fillStyle = '#e8c870'; ctx.beginPath(); ctx.arc(W * 0.5 - 15, y, 3, 0, 6.3); ctx.arc(W * 0.5 + 15, y, 3, 0, 6.3); ctx.fill(); }
    // edge trims
    ctx.fillStyle = 'rgba(214,168,70,0.95)'; ctx.fillRect(0, 0, W, 10); ctx.fillRect(0, Hh - 10, W, 10);
  }, { offsetX: 0.5 });
  const corset = phys(0xffffff, { map: corsetTex, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, normalMap: grainNormal('leather', 5, 2.4), normalScale: new V2(0.7, 0.7), sheen: 0.4, sheenColor: new THREE.Color(0xff6070) });
  const capeMat = phys(0xffffff, { map: drawTex('scCape', 256, 256, (ctx, W, Hh) => {
    const g = ctx.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, '#6a0c1c'); g.addColorStop(0.5, '#8a1026'); g.addColorStop(1, '#a8142c'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 12; i++) { const x = (i + 0.5) / 12 * W, f = ctx.createLinearGradient(x - 10, 0, x + 10, 0); f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(0.5, i & 1 ? 'rgba(0,0,0,0.22)' : 'rgba(255,110,110,0.14)'); f.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = f; ctx.fillRect(x - 10, 0, 20, Hh); }
    ctx.fillStyle = 'rgba(40,0,6,0.5)'; ctx.fillRect(0, Hh - 18, W, 18); ctx.fillStyle = 'rgba(214,168,70,0.85)'; ctx.fillRect(0, Hh - 20, W, 2.5);
    ctx.strokeStyle = 'rgba(214,168,70,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(0, Hh - 26); ctx.lineTo(W, Hh - 26); ctx.stroke(); ctx.setLineDash([]);
  }), roughness: 0.62, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff5060), side: THREE.DoubleSide, normalMap: fabricNormal(8, 0.5, 'sccapefab'), normalScale: new V2(0.5, 0.5) });
  const coatM = capeMat;
  const skin = std(0xf0cdb4, { roughness: 0.6 });
  const lthr = leather(0x2a0d10);
  const SCd = skullHead('scarlet', { brow: 0.028, socket: 0.045, lid: 0.012, nose: 0.15, noseW: 0.8, cheek: 0.055, taper: 0.3, jawBone: 0.0, chin: 0.05, chinW: 0.22, muzzle: 0.02, lips: 1.4 },
    { skin: '#f0cdb4', iris: '#4a8a58', brow: '#5a2414', lip: '#b8383e', mood: 'calm', female: true, eyeSize: 1.4, browW: 0.04, blush: 0.2, seed: 61, bag: 0.05 });
  const info = buildBody(model, {
    headGeo: SCd.headGeo, skull: SCd.skull,
    mats: { default: crimson, chest: corset, abdomen: corset, pelvis: dark, neck: skin, head: SCd.mat, shoulder: crimson, upperArm: crimson, foreArm: crimson, hand: lthr, thigh: crimson, shin: lthr, foot: lthr },
    torso: { sx: 1.08, sz: 0.74, chestR: 1.0, waistR: 0.82 },
    head: { R: 0.106, sx: 0.88, sy: 1.08, sz: 0.98 },
    arm: { u0: 0.042, u1: 0.034, f0: 0.034, f1: 0.027, ub: 0.06, fb: 0.08 },
    leg: { t0: 0.078, t1: 0.052, s0: 0.052, s1: 0.036, tb: 0.06, sb: 0.06 },
    foot: [0.05, 0.045, 0.14], hand: [0.036, 0.05, 0.044], pelvis: [0.38, 0.2, 0.26], neckR: 0.038,
  });
  const hj = model.j[J.HD], cj = model.j[J.CH], H = info.headInfo, hr = H.R;
  // hair: auburn, centre-parted, falling past the shoulders with face-framing locks
  const hairM = hairMaterial('#8a2a16', { hi: '#e0602e', seed: 17, sheen: 0xff8a50, rough: 0.45 });
  patch(model, H, 'schair', { na: seg(44, 26), nb: 16, top: () => Math.PI / 2, bot: tab([[0, 0.58], [0.45, 0.5], [0.85, 0.08], [1.2, -0.3], [1.8, -0.45], [3.14, -0.5]]), pw: 1.1,
    thick: (a, l, t) => 0.045 + 0.06 * t + 0.012 * Math.sin(a * 11 + t * 3) * t,
    post: (p, a, l, t) => { const k = sm01(0.7, 1.5, Math.abs(a)), d = sm01(0.7, 1, t) * k; p.y -= (3.4 + 0.3 * Math.sin(a * 15)) * d; p.x += Math.sin(t * 7 + a * 2) * 0.05 * d; p.x *= 1 + 0.08 * d; p.z += (Math.abs(a) < 1.5 ? 0.1 : -0.06) * d; } }, hairM, { cast: true });
  addEars(model, H, skin);
  // tiara: gold circlet with a crown of points across the brow
  const gold = phys(0xd2a23c, { roughness: 0.3, metalness: 0.8, emissive: 0x2a1a06, emissiveIntensity: 1 });
  patch(model, H, 'sctiara', { aMin: -1.35, aMax: 1.35, na: 26, nb: 2, top: (a) => 0.72 - 0.25 * (Math.abs(a) / 1.35) ** 2, bot: (a) => 0.6 - 0.28 * (Math.abs(a) / 1.35) ** 2, thick: () => 0.085 }, gold, { cast: true });
  const tp = [];
  for (let i = 0; i < 9; i++) {
    const u = i / 8 * 2 - 1, a = u * 1.15, lat = 0.72 - 0.25 * (Math.abs(a) / 1.35) ** 2;
    const pnt = skullMetres(H, H.skull, a, lat, 0.085), h = 0.04 * (1 - Math.abs(u) * 0.55);
    tp.push({ geo: coneGeo(0.012, h, 4), pos: [pnt.x, pnt.y + h * 0.5, pnt.z], rot: [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.4] });
  }
  P(model, hj, mergeParts('scCrown2' + hr, tp), gold, { pos: [0, H.y0, 0] });
  const gem = glow(0xff2040, 1.6);
  P(model, hj, sphereGeo(0.011, 8, 6), gem, { pos: [0, H.y0 + hr * H.sy * 0.66 * 0.97, hr * H.sz * 0.9], cast: false });
  // belt, standing collar, long gloves with flared cuffs and gold buckles
  const goldTrim = metal(0xd2a23c, { roughness: 0.3 });
  P(model, model.j[J.SP], cylGeo(0.118 * k, 0.126 * k, 0.03 * k, seg(16, 10)), lthr, { pos: [0, 0.015 * k, 0], scale: [1.1, 1, 0.78] });
  P(model, model.j[J.SP], boxGeo(0.045 * k, 0.04 * k, 0.014), goldTrim, { pos: [0, 0.015 * k, 0.098 * k] });
  P(model, cj, G('scCollar2' + seg(16, 10), () => new THREE.CylinderGeometry(0.07, 0.115, 0.12, seg(16, 10), 1, true, Math.PI * 0.2, Math.PI * 1.6)), coatM, { pos: [0, 0.37 * k, -0.025 * k], scale: [1.05 * k, k, 0.78 * k], cast: false });
  for (const s of [1, -1]) {
    const el = model.j[s > 0 ? J.EL : J.ER];
    P(model, el, cylGeo(0.036 * k, 0.029 * k, dims.fore * 0.72, seg(12, 8)), lthr, { pos: [0, -dims.fore * 0.52, 0] }); // long glove
    P(model, el, cylGeo(0.053 * k, 0.038 * k, 0.07 * k, seg(12, 8)), lthr, { pos: [0, -dims.fore * 0.14, 0] }); // flared cuff
    P(model, el, cylGeo(0.0385 * k, 0.0385 * k, 0.012 * k, seg(12, 8)), goldTrim, { pos: [0, -dims.fore * 0.3, 0] }); // buckle band
    P(model, el, cylGeo(0.033 * k, 0.033 * k, 0.012 * k, seg(12, 8)), goldTrim, { pos: [0, -dims.fore * 0.62, 0] });
    P(model, model.j[s > 0 ? J.KL : J.KR], cylGeo(0.058 * k, 0.045 * k, dims.shin * 0.5, seg(12, 8)), lthr, { pos: [0, -dims.shin * 0.7, 0] }); // boots
  }
  // long cape with sculpted folds (secondary motion via the lagged chain)
  addCloth(model, cj, { R: 12, C: 16, len: 1.02 * k, w0: 0.3 * k, w1: 0.74 * k, anchor: new V3(0, 0.34 * k, -0.125 * k), mat: coatM, resp: 1, base: 0.1, billow: 0.06, folds: 0.03, foldN: 11, ph: phase(), k });
  // ---- hex magic: halos, cores, wisps (per-instance additive materials)
  const halo = glowInstance(0xff1830, 2.0, { opacity: 0 }), core = glowInstance(0xff7080, 2.6, { opacity: 0 }), wispM = glowInstance(0xff3040, 2.4, { opacity: 0 });
  const hl = [], wisps = [];
  for (const s of [1, -1]) {
    const wr = model.j[s > 0 ? J.WL : J.WR];
    const h1 = new THREE.Mesh(sphereGeo(1, 12, 8), halo); h1.position.set(0, -dims.hand * 0.6, 0); h1.renderOrder = 3; wr.add(h1);
    const h2 = new THREE.Mesh(sphereGeo(1, 8, 6), core); h2.position.copy(h1.position); h2.renderOrder = 4; wr.add(h2);
    hl.push([h1, h2]);
    for (let i = 0; i < 3; i++) { const w = new THREE.Mesh(sphereGeo(0.014, 6, 5), wispM); w.renderOrder = 4; wr.add(w); wisps.push({ m: w, ph: i * 2.1 + (s > 0 ? 0 : 1), hand: wr }); }
  }
  let userLevel = 0, level = 0;
  model.hexGlow = 0;
  model.setHexGlow = (lv) => { userLevel = clamp(+lv || 0, 0, 1); };
  addHook(model, (c) => {
    const want = Math.max(userLevel, c.st === 'cast' ? 1 : 0, c.st === 'hover' || c.st === 'fly' ? 0.28 : 0.1);
    level += (want - level) * (1 - Math.exp(-10 * c.dt)); model.hexGlow = level;
    const pulse = 1 + Math.sin(c.tm * 14) * 0.12 * level;
    halo.opacity = 0.05 + level * 0.5; core.opacity = level * 0.85; wispM.opacity = level > 0.12 ? Math.min(1, level * 1.1) : 0;
    for (const [a, b] of hl) { a.scale.setScalar((0.045 + level * 0.075) * pulse); b.scale.setScalar((0.025 + level * 0.03) * pulse); a.visible = b.visible = level > 0.02; }
    for (const w of wisps) {
      const t = c.tm * 2.2 + w.ph, u = (t % 1);
      w.m.visible = level > 0.12;
      w.m.position.set(Math.cos(t * 5) * 0.06 * (0.5 + level), -0.06 - u * 0.2 * level, Math.sin(t * 5) * 0.06 * (0.5 + level));
      w.m.scale.setScalar((1 - u) * (0.6 + level));
    }
  }, () => { halo.dispose(); core.dispose(); wispM.dispose(); });
  return finish(model);
}
function hairMatCloth(m) { const c = m.clone(); c.side = THREE.DoubleSide; c.userData.shared = true; return c; }
