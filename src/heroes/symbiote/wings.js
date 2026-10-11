// Symbiote membrane wings (glide). Two ribbed fans attached to the model's chest; open(0..1) spreads them.
import * as THREE from 'three';

const TIPS = [[1.0, 0.55, -0.55], [1.35, 0.1, -0.7], [1.25, -0.4, -0.65], [0.95, -0.85, -0.5]];
let GEO = null;
function geo() {
  if (GEO) return GEO;
  const pos = [];
  const O = [0.08, 0, 0];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < TIPS.length - 1; i++) tri(O, TIPS[i], TIPS[i + 1]);
  tri(O, [0.1, 0.5, -0.1], TIPS[0]);
  // ribs as thin triangles
  for (const t of TIPS) tri([O[0], O[1] + 0.03, O[2]], [t[0], t[1] + 0.025, t[2]], [t[0], t[1] - 0.025, t[2]]);
  GEO = new THREE.BufferGeometry();
  GEO.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  GEO.computeVertexNormals();
  return GEO;
}

export class Wings {
  /** @param model CharacterModel, @param o { color, emissive, height (model height) } */
  constructor(model, o = {}) {
    this.model = model;
    this.mat = new THREE.MeshStandardMaterial({ color: o.color ?? 0x050508, roughness: 0.3, metalness: 0.3, emissive: o.emissive ?? 0x2a0a55, emissiveIntensity: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    this.group = new THREE.Group();
    const s = (model.height || 2) * 0.95;
    this.left = new THREE.Mesh(geo(), this.mat); this.right = new THREE.Mesh(geo(), this.mat);
    this.right.scale.x = -1;
    this.group.add(this.left, this.right);
    this.group.position.set(0, (model.height || 2) * 0.76, -0.12);
    this.group.scale.setScalar(s);
    this.group.visible = false;
    this.group.frustumCulled = false;
    model.group.add(this.group);
    this.open = 0;
  }
  set(k, t = 0) {
    this.open = k;
    this.group.visible = k > 0.02;
    if (!this.group.visible) return;
    const flap = Math.sin(t * 9) * 0.04 * k;
    this.left.rotation.set(0, (1 - k) * 1.3, flap + (1 - k) * 0.3);
    this.right.rotation.set(0, -(1 - k) * 1.3, -flap - (1 - k) * 0.3);
    this.left.scale.set(0.3 + 0.7 * k, 1, 0.3 + 0.7 * k);
    this.right.scale.set(-(0.3 + 0.7 * k), 1, 0.3 + 0.7 * k);
  }
  dispose() { this.group.parent?.remove(this.group); this.mat.dispose(); }
}
