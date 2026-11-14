// Animation contact-sheet harness. Steps a CharacterModel through scripted anim states at 60 Hz with a fake
// hero/enemy entity and renders N frames per state (columns), side view + 3/4 view (rows), plus a numeric
// foot-slide report for locomotion states.   anim.html?id=spiderman&states=idle,run,sprint&frames=10&cell=150
import * as THREE from 'three';
import { buildCharacter } from '/src/models/index.js';
import '/src/enemies/villains/index.js';

const qs = new URLSearchParams(location.search);
const id = qs.get('id') || 'spiderman';
const states = (qs.get('states') || 'idle,run').split(',');
const N = Number(qs.get('frames') || 10);
const CW = Number(qs.get('cell') || 150), CH = Math.round(CW * 1.35);
const views = (qs.get('views') || 'side,q').split(',');
globalThis.game = { settings: { quality: 'high' } };

const rows = states.length * views.length;
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setPixelRatio(1); r.setSize(CW * N, CH * rows); r.toneMapping = THREE.ACESFilmicToneMapping;
const wrap = document.getElementById('wrap'); wrap.appendChild(r.domElement); r.domElement.style.display = 'block';
r.setScissorTest(true);

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x3a4048);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x444444, 1.2));
const sun = new THREE.DirectionalLight(0xfff0dd, 3); sun.position.set(2, 4, 3); scene.add(sun);
const rim = new THREE.DirectionalLight(0x88aaff, 1.5); rim.position.set(-3, 2, -3); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffe8d8, 1.1); fill.position.set(0.5, -0.4, 4); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x59606a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const stripes = []; // scroll back at ground speed so foot sliding is visible against them
const smat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
for (let i = 0; i < 24; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(6, 0.01, 0.06), smat); s.position.y = 0.005; scene.add(s); stripes.push(s); }

const m = buildCharacter(id, {});
scene.add(m.group);
const H = m.height || 1.8;
const V3 = THREE.Vector3;
const ent = { pos: new V3(), vel: new V3(), yaw: 0, hp: 100, swingAnchor: null, swingSide: 0, game: { cam: { forward: new V3(0, 0, 1), pitch: 0 } } };
const anim = { state: 'idle', t: 0, speed: 0 };
const DT = 1 / 60;
const AIR = (vy0) => ({ air: true, vy0 });

// pre = [[state, speed, seconds]]; st/sp = main state and anim speed; vel = ground speed along +Z; fn(t) per-step hook
const SC = {
  idle: { st: 'idle', win: 4 },
  walk: { pre: [['idle', 0, 0.4]], st: 'run', sp: 2.2, vel: 2.2, win: 1.1, warm: 0.8, slide: true },
  jog: { pre: [['idle', 0, 0.4]], st: 'run', sp: 4.5, vel: 4.5, win: 0.9, warm: 0.8, slide: true },
  run: { pre: [['idle', 0, 0.4]], st: 'run', sp: 7, vel: 7, win: 0.8, warm: 0.8, slide: true },
  sprint: { pre: [['idle', 0, 0.4]], st: 'sprint', sp: 14, vel: 14, win: 0.7, warm: 0.8, slide: true },
  startstop: { pre: [['idle', 0, 0.3]], st: 'run', sp: 7, vel: 7, win: 1.8, fn: (t, e) => { const v = t < 0.9 ? 7 : 0; e.vel.set(0, 0, v); setState(t < 0.9 ? 'run' : 'idle', v); } },
  turn: { pre: [['run', 7, 0.8]], st: 'run', sp: 7, vel: 7, win: 1.0, fn: (t, e) => { e.yaw = Math.min(t / 0.35, 1) * 2.4; e.vel.set(Math.sin(e.yaw) * 7, 0, Math.cos(e.yaw) * 7); } },
  jump: { pre: [['run', 7, 0.8]], st: 'jump', sp: 7, vel: 7, ...AIR(11), win: 0.9, autoFall: true },
  jumpstill: { pre: [['idle', 0, 0.5]], st: 'jump', sp: 0, ...AIR(11), win: 0.9, autoFall: true },
  fall: { pre: [['jump', 0, 0.01]], st: 'fall', sp: 0, ...AIR(-3), win: 0.9, startY: 8 },
  land: { pre: [['fall', 0, 0.01]], st: 'land', sp: 0, landFrom: 12, win: 1.0 },
  landhard: { pre: [['fall', 0, 0.01]], st: 'land', sp: 0, landFrom: 30, win: 1.2 },
  dodge: { pre: [['idle', 0, 0.4]], st: 'dodge', sp: 14, vel: 14, win: 0.6 },
  punch1: { pre: [['idle', 0, 0.5]], st: 'punch1', sp: 1, win: 0.5 },
  punch2: { pre: [['idle', 0, 0.5]], st: 'punch2', sp: 1, win: 0.5 },
  punch3: { pre: [['idle', 0, 0.5]], st: 'punch3', sp: 1, win: 0.7 },
  kick: { pre: [['idle', 0, 0.5]], st: 'kick', sp: 1, win: 0.55 },
  uppercut: { pre: [['idle', 0, 0.5]], st: 'uppercut', sp: 1, win: 0.7 },
  smash: { pre: [['idle', 0, 0.5]], st: 'smash', sp: 1, win: 1.0 },
  throw: { pre: [['idle', 0, 0.5]], st: 'throw', sp: 1, win: 0.8 },
  combo: { pre: [['idle', 0, 0.5]], st: 'punch1', sp: 1, win: 1.8, fn: (t) => setState(t < 0.36 ? 'punch1' : t < 0.72 ? 'punch2' : t < 1.08 ? 'punch3' : t < 1.4 ? 'kick' : 'idle', 1) },
  hit: { pre: [['idle', 0, 0.6]], st: 'idle', win: 1.0, hit: [0.1, 0, -1] },
  hitside: { pre: [['idle', 0, 0.6]], st: 'idle', win: 1.0, hit: [0.1, 1, 0] },
  hitrun: { pre: [['run', 7, 0.8]], st: 'run', sp: 7, vel: 7, win: 1.0, hit: [0.1, 0, -1] },
  stunned: { pre: [['idle', 0, 0.5]], st: 'stunned', sp: 1, win: 1.5 },
  dead: { pre: [['idle', 0, 0.5]], st: 'dead', sp: 1, win: 1.4 },
  swing: { pre: [['jump', 0, 0.01]], st: 'swing', sp: 18, vel: 18, win: 2.4, swing: true },
  zip: { pre: [['jump', 0, 0.01]], st: 'zip', sp: 22, vel: 22, win: 0.8, vy: 12, customRot: true },
  wallrun: { pre: [['wallidle', 0, 0.4]], st: 'wallrun', sp: 9, win: 1.0, wall: true },
  wallidle: { st: 'wallidle', sp: 0, win: 3.0, wall: true },
  glide: { pre: [['jump', 0, 0.01]], st: 'glide', sp: 22, vel: 22, vy: -3, win: 2.0, customRot: true },
  fly: { pre: [['idle', 0, 0.4]], st: 'fly', sp: 28, vel: 28, win: 1.4, customRot: true, hov: true },
  hover: { pre: [['idle', 0, 0.4]], st: 'hover', sp: 0, win: 3.0 },
  dash: { pre: [['idle', 0, 0.4]], st: 'dash', sp: 30, vel: 30, win: 0.5 },
  block: { pre: [['idle', 0, 0.5]], st: 'block', sp: 0, win: 1.5 },
  charge: { pre: [['run', 7, 0.5]], st: 'charge', sp: 16, vel: 16, win: 0.8 },
  aim: { pre: [['idle', 0, 0.5]], st: 'aim', sp: 0, win: 1.5 },
  shoot: { pre: [['aim', 0, 0.5]], st: 'shoot', sp: 0, win: 0.8 },
  cast: { pre: [['idle', 0, 0.5]], st: 'cast', sp: 0, win: 1.0 },
  perch: { pre: [['idle', 0, 0.5]], st: 'perch', sp: 0, win: 3.0 },
  lookaround: { pre: [['idle', 0, 0.5]], st: 'idle', win: 2.0, fn: (t, e) => { e.game.cam.forward.set(Math.sin(t * 1.5), 0, Math.cos(t * 1.5)); } },
};

function setState(s, sp = 0) { if (anim.state !== s) { anim.state = s; anim.t = 0; } anim.speed = sp; }
let y = 0, vy = 0, tAll = 0, grav = 27;
const _q = new THREE.Quaternion(), _e = new THREE.Euler();

function step(sc, tl) {
  anim.t += DT; tAll += DT;
  if (sc.air && tl >= 0) {
    vy -= grav * DT; y += vy * DT;
    if (y <= 0 && vy < 0) { y = 0; vy = 0; }
    if (sc.autoFall && vy < 0 && anim.state === 'jump') setState('fall', anim.speed);
  }
  ent.vel.y = vy;
  m.group.position.set(0, y, 0);
  if (!m.customRotation) m.group.rotation.set(0, ent.yaw, 0);
  m.update(DT, anim, ent);
}

function renderCell(row, col, view) {
  const cam = new THREE.PerspectiveCamera(30, CW / CH, 0.05, 80);
  const d = H * 2.9, ty = Math.max(H * 0.5, y + H * 0.45);
  const yy = view === 'side' ? 1.5708 : view === 'q' ? 0.75 : view === 'front' ? 3.14 : 0;
  cam.position.set(Math.sin(yy) * d, ty + 0.15, Math.cos(yy) * d); cam.lookAt(0, ty, 0);
  const vy_ = (rows - 1 - row) * CH;
  r.setViewport(col * CW, vy_, CW, CH); r.setScissor(col * CW, vy_, CW, CH);
  r.render(scene, cam);
}
function updateStripes(spd) {
  for (let i = 0; i < stripes.length; i++) { let z = (i * 0.75 - spd * tAll) % 18; if (z < -9) z += 18; stripes[i].position.z = z; }
}

const info = {};
const _fl = new V3(), _fr = new V3();
let rowBase = 0;
for (const name of states) {
  const sc = SC[name];
  if (!sc) { console.error('unknown state', name); continue; }
  ent.yaw = 0; ent.vel.set(0, 0, 0); y = sc.startY || 0; vy = 0; ent.hp = 100; ent.swingAnchor = null; ent.game.cam.forward.set(0, 0, 1);
  m.customRotation = false; m.group.quaternion.identity(); m.extra.wall = 0;
  anim.state = 'idle'; anim.t = 0;
  for (let i = 0; i < 90; i++) { anim.t += DT; m.update(DT, anim, ent); }
  for (const [s, sp, dur] of sc.pre || []) { setState(s, sp); ent.vel.set(0, 0, sp); for (let t = 0; t < dur; t += DT) step({}, -1); }
  setState(sc.st, sc.sp ?? 0);
  ent.vel.set(0, 0, sc.vel || 0);
  if (sc.vy0 !== undefined) vy = sc.vy0;
  if (sc.vy !== undefined) vy = sc.vy;
  if (sc.landFrom) m.fallSpeed = sc.landFrom;
  if (sc.wall) { m.customRotation = true; m.group.quaternion.setFromEuler(_e.set(-Math.PI / 2, 0, 0)); }
  if (sc.swing || sc.customRot) m.customRotation = true;
  for (let t = 0; t < (sc.warm || 0); t += DT) { sc.fn?.(t, ent); step(sc, -1); }
  if (sc.warm) anim.t = sc.warm;
  const feet = [];
  let k = 0, tl = 0, hitDone = false;
  while (tl <= sc.win + 1e-6) {
    sc.fn?.(tl, ent);
    if (sc.hit && !hitDone && tl >= sc.hit[0]) { hitDone = true; ent.hp -= 10; ent.vel.x += sc.hit[1] * 5; ent.vel.z += sc.hit[2] * 5; m.hitReact?.(new V3(sc.hit[1], 0, sc.hit[2]), 1); }
    if (sc.swing) {
      const a = tl * 1.3;
      ent.vel.set(0, Math.sin(a - 0.9) * 8, 18);
      m.group.quaternion.setFromEuler(_e.set(0.5 * Math.sin(a - 1.0) - 0.15, 0, 0));
      ent.swingAnchor = (ent.swingAnchor || new V3()).set(0, 30 - y, 22); ent.swingSide = 1;
    }
    if (sc.wall) m.group.position.set(0, 0.9, 0);
    step(sc, tl);
    if (sc.wall) m.group.position.set(0, 0.9, 0);
    if (sc.slide) { m.group.updateMatrixWorld(true); m.footL.getWorldPosition(_fl); m.footR.getWorldPosition(_fr); feet.push([_fl.y, _fl.z, _fr.y, _fr.z]); }
    if (k < N && tl >= k * sc.win / (N - 1) - 1e-6) {
      m.group.updateMatrixWorld(true);
      for (let vi = 0; vi < views.length; vi++) { updateStripes(sc.vel || 0); renderCell(rowBase + vi, k, views[vi]); }
      k++;
    }
    tl += DT;
  }
  if (sc.slide && feet.length > 10) {
    let tot = 0, n = 0;
    for (const [yi, zi] of [[0, 1], [2, 3]]) {
      const ys = feet.map((f) => f[yi]); const lo = Math.min(...ys), hi = Math.max(...ys), th = lo + (hi - lo) * 0.2 + 0.015;
      for (let i = 1; i < feet.length; i++) if (feet[i][yi] < th && feet[i - 1][yi] < th) { tot += Math.abs((feet[i][zi] - feet[i - 1][zi]) / DT + sc.vel); n++; }
    }
    info[name] = { trace: qs.get('trace') ? feet.filter((_, i) => i % 3 === 0).map((f) => f.map((v) => +v.toFixed(2)).join(',')) : undefined, ground: sc.vel, slideMps: n ? +(tot / n).toFixed(2) : null, ratio: n ? +(tot / n / sc.vel).toFixed(2) : null, planted: n };
  }
  const lab = document.createElement('div');
  lab.style.cssText = `position:absolute;left:3px;top:${rowBase * CH + 2}px;color:#fff;background:#0008;padding:1px 4px;`;
  lab.textContent = `${id}/${name} ${sc.win}s`; wrap.appendChild(lab);
  rowBase += views.length;
}
globalThis.__info = info; globalThis.__done = true;
