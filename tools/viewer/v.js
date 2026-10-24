import * as THREE from 'three';
import { buildCharacter } from '/src/models/index.js';
import '/src/enemies/villains/index.js';
const qs = new URLSearchParams(location.search);
const names = (qs.get('ids') || 'spiderman').split(',');
const view = qs.get('view') || 'front';
const W = 480, Hh = 640;
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(W * names.length, Hh); r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(r.domElement);
globalThis.game = { settings: { quality: qs.get('q') || 'high' } };
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x3a4048);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x444444, 1.2));
const sun = new THREE.DirectionalLight(0xfff0dd, 3); sun.position.set(2, 4, 3); scene.add(sun);
const rim = new THREE.DirectionalLight(0x88aaff, 1.5); rim.position.set(-3, 2, -3); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffe8d8, 1.1); fill.position.set(0.5, -0.4, 4); scene.add(fill); // soft front/below fill so pitched-down faces stay readable
const info = [];
const t0 = performance.now();
const models = names.map((id, i) => {
  const m = buildCharacter(id, {});
  m.group.position.x = i * 3; scene.add(m.group);
  m.update(0.016, { state: 'idle', speed: 0 }, {});
  m.update(0.016, { state: 'idle', speed: 0 }, {});
  let tris = 0; const top = []; m.group.traverse((o) => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n; top.push([Math.round(n), o.userData.slot || o.parent?.name || '?']); } });
  top.sort((a, b) => b[0] - a[0]);
  info.push({ id, tris: Math.round(tris), h: m.height, top: qs.get('top') ? top.slice(0, 14) : undefined });
  return m;
});
r.setScissorTest(true);
models.forEach((m, i) => {
  const h = m.height || 1.8;
  const cam = new THREE.PerspectiveCamera(30, W / Hh, 0.05, 50);
  const hv = view === 'head' || view === 'headq' || view === 'headside', close = view === 'face';
  const ang = view === 'q' || view === 'headq' ? 0.7 : view === 'side' || view === 'headside' ? 1.57 : view === 'back' ? 3.14 : 0;
  const dist = hv ? 0.85 + (h > 2.3 ? 0.3 : 0) : close ? h * 0.9 : h * 2.3, ty = hv ? h - 0.13 : close ? h * 0.9 : h * 0.52;
  if (hv) {
    const hp = new THREE.Vector3(); m.group.updateMatrixWorld(true); (m.head || m.group).getWorldPosition(hp); hp.y += 0.04;
    cam.position.set(hp.x + Math.sin(ang) * dist, hp.y + 0.02, hp.z + Math.cos(ang) * dist); cam.lookAt(hp);
  } else { cam.position.set(i * 3 + Math.sin(ang) * dist, ty + 0.1, Math.cos(ang) * dist); cam.lookAt(i * 3, ty, 0); }
  r.setViewport(i * W, 0, W, Hh); r.setScissor(i * W, 0, W, Hh); r.render(scene, cam);
});
globalThis.__info = info; globalThis.__done = true; globalThis.__t = performance.now() - t0;
