// Character models: procedural by default, optional GLB override from public/models/<id>.glb.
// Contract: see docs/ARCHITECTURE.md#models
//
//   await preloadModels(onProgress)
//   buildCharacter(id, opts) -> CharacterModel
//     { id, group, height, handR, handL, chest, head, footL, footR, update(dt, anim, entity), setVariant(name),
//       customRotation, setTint(color, amount), dispose(),
//       + thrusters[] (ironman), hammer/detachHammer()/attachHammer() (thor), muzzle (hunter/cop),
//       setClaws(bool) (wolverine), shield/detachShield()/attachShield()/shieldAttached (captain), bow/arrow/handR (hawkeye), setHexGlow(0..1) (scarlet) }
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildSpiderMan, buildIronMan, buildHulk, buildThor, buildVenom, buildGoon, buildHunter } from './characters.js';
import { buildWolverine, buildCaptain, buildHawkeye, buildScarlet } from './heroes2.js';
import { buildCivilian, buildCop } from './people.js';

export const MODEL_IDS = ['spiderman', 'ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet', 'venom', 'goon', 'hunter', 'civilian', 'cop'];
const TARGET_HEIGHT = { spiderman: 1.78, ironman: 1.88, hulk: 2.7, thor: 1.95, venom: 2.6, goon: 1.8, hunter: 1.85, wolverine: 1.65, captain: 1.88, hawkeye: 1.85, scarlet: 1.75, civilian: 1.75, cop: 1.82 };

const glbs = new Map(); // id -> gltf
const BUILDERS = { spiderman: buildSpiderMan, ironman: buildIronMan, hulk: buildHulk, thor: buildThor, venom: buildVenom, goon: buildGoon, hunter: buildHunter,
  wolverine: buildWolverine, captain: buildCaptain, hawkeye: buildHawkeye, scarlet: buildScarlet, civilian: buildCivilian, cop: buildCop };

// ------------------------------------------------------------------ preload (optional GLB overrides)
/**
 * Looks for models/manifest.json (always shipped, lists which ids have a GLB; `"probe": true` makes it try every id).
 * A missing/empty manifest means nothing is requested, so there are no 404 console errors by default.
 */
export async function preloadModels(onProgress) {
  const base = (typeof document !== 'undefined' && document.baseURI) || (typeof location !== 'undefined' ? location.href : '');
  const url = (p) => { try { return new URL(`models/${p}`, base).href; } catch { return `models/${p}`; } };
  let manifest = null;
  try {
    const r = await fetch(url('manifest.json'), { cache: 'no-cache' });
    if (r.ok && /json|text/.test(r.headers.get('content-type') || 'json')) manifest = await r.json();
  } catch { /* offline / no manifest */ }
  const wanted = manifest ? (manifest.probe ? MODEL_IDS : (manifest.models || manifest.glb || []).filter((i) => MODEL_IDS.includes(i))) : [];
  let done = 0;
  const loader = new GLTFLoader();
  for (const id of wanted) {
    try {
      const r = await fetch(url(`${id}.glb`));
      if (r.ok) {
        const buf = await r.arrayBuffer();
        const magic = new Uint8Array(buf, 0, 4);
        if (magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46) { // 'glTF' (guards SPA fallbacks returning html)
          const gltf = await new Promise((res, rej) => loader.parse(buf, url(''), res, rej));
          glbs.set(id, gltf);
        }
      }
    } catch { /* silently keep procedural model */ }
    onProgress?.(++done / wanted.length);
  }
  onProgress?.(1);
  return [...glbs.keys()];
}

// ------------------------------------------------------------------ public builder
export function buildCharacter(id, opts = {}) {
  if (glbs.has(id)) {
    try { return buildGLB(id, glbs.get(id)); } catch (e) { /* fall back to procedural */ }
  }
  const b = BUILDERS[id] || BUILDERS.goon;
  const m = b(opts);
  m.id = id;
  return m;
}

// ------------------------------------------------------------------ GLB model driven by an AnimationMixer
const CLIP_HINTS = {
  idle: ['idle', 'stand', 'breath'], run: ['run', 'jog', 'walk'], sprint: ['sprint', 'run', 'jog'], jump: ['jump', 'leap', 'air'],
  fall: ['fall', 'air', 'jump'], land: ['land', 'idle'], swing: ['swing', 'web', 'air', 'fall'], wallrun: ['wallrun', 'climb', 'crawl', 'wall'],
  wallidle: ['wallidle', 'climbidle', 'cling', 'wall', 'idle'], glide: ['glide', 'fly', 'air'], zip: ['zip', 'fly', 'air'],
  fly: ['fly', 'flight', 'hover', 'air'], hover: ['hover', 'fly', 'idle'], dash: ['dash', 'roll', 'run'], dodge: ['dodge', 'roll', 'flip', 'dash'],
  punch1: ['punch1', 'punch', 'jab', 'attack', 'hit'], punch2: ['punch2', 'hook', 'punch', 'attack'], punch3: ['punch3', 'cross', 'punch', 'attack'],
  kick: ['kick', 'attack'], uppercut: ['uppercut', 'punch', 'attack'], throw: ['throw', 'toss', 'attack'], shoot: ['shoot', 'fire', 'aim', 'attack'],
  smash: ['smash', 'slam', 'attack'], charge: ['charge', 'run', 'sprint'], cast: ['cast', 'spell', 'power', 'attack'], stunned: ['stun', 'hurt', 'dizzy', 'hit'],
  dead: ['death', 'dead', 'die'], aim: ['aim', 'shoot', 'fire', 'idle'], block: ['block', 'guard', 'idle'],
};
const ONE_SHOT = new Set(['land', 'dodge', 'punch1', 'punch2', 'punch3', 'kick', 'uppercut', 'throw', 'shoot', 'smash', 'cast', 'dead']);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function buildGLB(id, gltf) {
  const group = new THREE.Group();
  const inner = cloneSkinned(gltf.scene);
  const pivot = new THREE.Group(); pivot.add(inner); group.add(pivot);
  // auto-scale to target height, feet at y = 0, centred on x/z
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const s = (TARGET_HEIGHT[id] || 1.8) / h;
  pivot.scale.setScalar(s);
  pivot.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  const meshes = [];
  inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; meshes.push(o); } });

  const bones = {};
  inner.traverse((o) => { if (o.isBone || o.type === 'Bone') bones[norm(o.name)] = o; });
  const find = (...res) => { for (const k of Object.keys(bones)) for (const re of res) if (re.test(k)) return bones[k]; return null; };
  const anchor = (bone, fallback) => {
    const o = new THREE.Object3D();
    if (bone) { bone.add(o); } else { o.position.set(...fallback); group.add(o); }
    return o;
  };
  const H = TARGET_HEIGHT[id] || 1.8;
  const handR = anchor(find(/righthand$/, /handr$/, /rhand$/, /hand.*r$/, /right.*hand/), [-0.45, H * 0.55, 0.1]);
  const handL = anchor(find(/lefthand$/, /handl$/, /lhand$/, /hand.*l$/, /left.*hand/), [0.45, H * 0.55, 0.1]);
  const head = anchor(find(/^head$/, /head$/), [0, H * 0.92, 0]);
  const chest = anchor(find(/spine2$/, /chest$/, /spine1$/, /upperchest/), [0, H * 0.72, 0.15]);
  const footL = anchor(find(/leftfoot$/, /footl$/, /lfoot$/), [0.1, 0.05, 0]);
  const footR = anchor(find(/rightfoot$/, /footr$/, /rfoot$/), [-0.1, 0.05, 0]);

  const mixer = new THREE.AnimationMixer(inner);
  const clips = gltf.animations || [];
  const actions = {};
  for (const c of clips) actions[c.name] = mixer.clipAction(c);
  const pick = (state) => {
    const hints = CLIP_HINTS[state] || CLIP_HINTS.idle;
    for (const hint of hints) { const c = clips.find((cl) => norm(cl.name).includes(hint)); if (c) return actions[c.name]; }
    return null;
  };
  const cache = {};
  let cur = null, curState = '';
  const model = {
    id, group, height: H, handR, handL, chest, head, footL, footR, customRotation: false, thrusters: [], isGLB: true,
    update(dt, anim) {
      const state = (anim && anim.state) || 'idle';
      if (state !== curState) {
        curState = state;
        const a = cache[state] !== undefined ? cache[state] : (cache[state] = pick(state));
        if (a && a !== cur) {
          a.reset(); a.enabled = true;
          a.setLoop(ONE_SHOT.has(state) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
          a.clampWhenFinished = true;
          if (cur) cur.crossFadeTo(a, 0.18, false);
          a.play(); cur = a;
        }
      }
      if (cur && (curState === 'run' || curState === 'sprint')) cur.timeScale = Math.max(0.5, (anim.speed || 6) / 7);
      else if (cur) cur.timeScale = 1;
      mixer.update(Math.min(dt, 0.05));
    },
    setVariant() {},
    setTint(color, amount = 0) {
      for (const m of meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat, i) => {
          if (!mat || !mat.emissive) return;
          if (!mat.userData._tintClone) {
            const c = mat.clone(); c.userData._tintClone = true; c.userData.base = { e: mat.emissive.clone(), i: mat.emissiveIntensity };
            if (Array.isArray(m.material)) m.material[i] = c; else m.material = c;
            mat = c;
          }
          mat.emissive.copy(mat.userData.base.e).lerp(new THREE.Color(color ?? 0xffffff), amount);
          mat.emissiveIntensity = THREE.MathUtils.lerp(mat.userData.base.i, 1.5, amount);
        });
      }
    },
    dispose() { mixer.stopAllAction(); group.removeFromParent(); },
  };
  return model;
}
