// STUB — replaced by the models agent. Contract: see docs/ARCHITECTURE.md#models
import * as THREE from 'three';
export async function preloadModels(onProgress) { onProgress?.(1); }
export function buildCharacter(id, opts = {}) {
  const colors = { spiderman: 0xd01020, ironman: 0xb01818, hulk: 0x3c8a2e, thor: 0x2a3a6a, venom: 0x111118, goon: 0x222233, hunter: 0x6b5a3a };
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 8), new THREE.MeshStandardMaterial({ color: colors[id] ?? 0x888888 }));
  body.position.y = 0.9; body.castShadow = true; group.add(body);
  const handR = new THREE.Object3D(); handR.position.set(-0.5, 1.1, 0.2); group.add(handR);
  const handL = new THREE.Object3D(); handL.position.set(0.5, 1.1, 0.2); group.add(handL);
  const chest = new THREE.Object3D(); chest.position.set(0, 1.3, 0.3); group.add(chest);
  return { id, group, height: 1.8, handR, handL, chest, head: body, update() {}, setVariant() {}, dispose() {} };
}
