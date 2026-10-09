// Shared helpers for Hawkeye + Scarlet Witch (all defensive, no allocations in hot paths where avoidable).
import * as THREE from 'three';
export { Timers, aimInfo, enemiesNear, enemyCenter, objPos, clamp, damp, rand, rumble, UP } from '../avengers/util.js';

const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Thin cylinder between two points (grapple cable). */
export class Cable {
  constructor(scene, color = 0xc9a6ff, radius = 0.03) {
    const geo = new THREE.CylinderGeometry(radius, radius, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.scene = scene; scene.add(this.mesh);
  }
  set(a, b) {
    const d = _d.subVectors(b, a); const len = d.length();
    if (len < 0.05) { this.mesh.visible = false; return; }
    this.mesh.position.copy(a);
    this.mesh.quaternion.setFromUnitVectors(_up, d.multiplyScalar(1 / len));
    this.mesh.scale.set(1, len, 1);
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ---- arrows ---------------------------------------------------------------------------
let ARROW = null;
function arrowAssets() {
  if (ARROW) return ARROW;
  const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.95, 5).rotateX(Math.PI / 2);   // along +Z
  const tip = new THREE.ConeGeometry(0.035, 0.16, 6).rotateX(Math.PI / 2).translate(0, 0, 0.55);
  const fin = new THREE.PlaneGeometry(0.1, 0.16).translate(0, 0, -0.42);
  const glowG = new THREE.SphereGeometry(1, 8, 6);
  const mats = {};
  ARROW = {
    shaft, tip, fin, glowG, mats,
    wood: new THREE.MeshBasicMaterial({ color: 0xe8e0d0, toneMapped: false }),
    fm: new THREE.MeshBasicMaterial({ color: 0x8a4fd1, side: THREE.DoubleSide, toneMapped: false }),
  };
  return ARROW;
}
/** Arrow mesh (tip towards +Z). `color` tints the head glow. */
export function makeArrow(color = 0xb88cff, scale = 1) {
  const A = arrowAssets();
  const key = String(color);
  if (!A.mats[key]) {
    A.mats[key] = {
      head: new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      glow: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    };
  }
  const M = A.mats[key];
  const g = new THREE.Group();
  g.add(new THREE.Mesh(A.shaft, A.wood));
  g.add(new THREE.Mesh(A.tip, M.head));
  const f1 = new THREE.Mesh(A.fin, A.fm), f2 = new THREE.Mesh(A.fin, A.fm); f2.rotation.z = Math.PI / 2;
  g.add(f1, f2);
  const gl = new THREE.Mesh(A.glowG, M.glow); gl.scale.set(0.09, 0.09, 0.24); gl.position.z = 0.5; g.add(gl);
  g.scale.setScalar(scale);
  return g;
}

// ---- hex magic ------------------------------------------------------------------------
let HEX = null;
export function hexAssets() {
  if (HEX) return HEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#ff7a96'; x.fillStyle = '#ff3560'; x.lineWidth = 6; x.lineCap = 'round';
  x.shadowColor = '#ff2050'; x.shadowBlur = 14;
  x.beginPath(); x.arc(64, 64, 48, 0, Math.PI * 2); x.stroke();
  x.beginPath();
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; const px = 64 + Math.cos(a) * 30, py = 64 + Math.sin(a) * 30; i ? x.lineTo(px, py) : x.moveTo(px, py); }
  x.closePath(); x.stroke();
  x.beginPath(); x.moveTo(64, 30); x.lineTo(64, 98); x.moveTo(36, 80); x.lineTo(92, 48); x.stroke();
  const tex = new THREE.CanvasTexture(c);
  HEX = {
    tex,
    rune: new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    runeGeo: new THREE.PlaneGeometry(0.7, 0.7),
    domeGeo: new THREE.IcosahedronGeometry(1, 2),
    dome: new THREE.MeshBasicMaterial({ color: 0xff2050, wireframe: true, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    fill: new THREE.MeshBasicMaterial({ color: 0xff1c48, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    core: new THREE.MeshBasicMaterial({ color: 0xffd0da, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ color: 0xff2050, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  return HEX;
}
/** Red energy bolt mesh, elongated along +Z. */
export function makeHexBolt(size = 1) {
  const H = hexAssets();
  const g = new THREE.Group();
  const core = new THREE.Mesh(H.sphere, H.core); core.scale.set(0.09 * size, 0.09 * size, 0.3 * size);
  const glow = new THREE.Mesh(H.sphere, H.glow); glow.scale.set(0.2 * size, 0.2 * size, 0.55 * size);
  g.add(core, glow);
  return g;
}
