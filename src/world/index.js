// STUB — replaced by the world agent. Contract: see docs/ARCHITECTURE.md#world
import * as THREE from 'three';
export class World {
  constructor(game) { this.game = game; this.spawnPoint = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 }; this.menuFocus = new THREE.Vector3(0, 60, 0); this.bounds = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }; }
  async build(onProgress) {
    const { scene, physics } = this.game;
    scene.background = new THREE.Color(0x8fb5e0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
    const sun = new THREE.DirectionalLight(0xffe0b0, 2); sun.position.set(100, 200, 50); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: 0x333338 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      if (i === 0 && j === 0) continue;
      const h = 30 + Math.random() * 120, x = i * 80, z = j * 80, w = 40;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: 0x8890a0 }));
      m.position.set(x, h / 2, z); scene.add(m);
      physics.addBox(new THREE.Vector3(x - w / 2, 0, z - w / 2), new THREE.Vector3(x + w / 2, h, z + w / 2), { type: 'building' });
    }
    onProgress?.(1);
  }
  update(dt) {}
  constrain(hero) {}
}
