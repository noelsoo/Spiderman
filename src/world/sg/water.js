// Marina Bay water: same look as the NYC river but semi-transparent so a mirrored copy of the skyline shows through.
import * as THREE from 'three';
import { makeWater } from '../water.js';

const FRAG_PATCH = [
  ['gl_FragColor = vec4(col, 1.0);', 'float a = mix(0.9, 0.5, clamp(F, 0.0, 1.0)); gl_FragColor = vec4(col, uTrans > 0.5 ? a : 1.0);'],
  ['uniform float uTime;', 'uniform float uTime; uniform float uTrans;'],
];

export function makeBayWater(transparent) {
  const w = makeWater();
  const mat = w.mesh.material;
  let fs = mat.fragmentShader;
  for (const [a, b] of FRAG_PATCH) fs = fs.replace(a, b);
  mat.fragmentShader = fs;
  w.uniforms.uTrans = { value: transparent ? 1 : 0 };
  mat.transparent = true;
  mat.depthWrite = true;
  mat.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(9000, 9000);
  geo.rotateX(-Math.PI / 2);
  w.mesh.geometry.dispose();
  w.mesh.geometry = geo;
  w.mesh.position.set(0, -0.5, 0);
  w.mesh.renderOrder = 1;
  return w;
}
