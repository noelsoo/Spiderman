// Captain America's sidearm: a classic M1911-style pistol. Grip at the origin, barrel along +Z (parent to model.handR).
// userData.muzzle = Object3D at the barrel tip. Shared materials, tiny part count.
import * as THREE from 'three';

let MATS = null;
function mats() {
  return MATS ??= {
    steel: new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.85, roughness: 0.35 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.7, roughness: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4224, metalness: 0.05, roughness: 0.75 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 }),
  };
}

export function buildPistol() {
  const M = mats();
  const g = new THREE.Group(); g.name = 'cap:pistol';
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = false; g.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  add(box(0.03, 0.045, 0.2), M.steel, 0, 0.05, 0.05);                 // slide
  add(box(0.028, 0.02, 0.17), M.frame, 0, 0.018, 0.04);               // frame
  add(box(0.032, 0.115, 0.05), M.frame, 0, -0.04, -0.03, 0.2);        // grip
  const gp = box(0.036, 0.09, 0.034); add(gp, M.wood, 0, -0.04, -0.033, 0.2);
  const barrel = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 10); barrel.rotateX(Math.PI / 2);
  add(barrel, M.steel, 0, 0.05, 0.175);                               // barrel tip
  add(box(0.008, 0.034, 0.045), M.frame, 0, -0.005, 0.03);            // trigger guard
  add(box(0.006, 0.014, 0.01), M.brass, 0, 0.078, 0.14);              // front sight
  add(box(0.012, 0.012, 0.012), M.steel, 0, 0.078, -0.04);            // hammer / rear sight
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05, 0.205); g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}
