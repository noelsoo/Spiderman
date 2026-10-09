// Far skyline: a camera-following cylinder carrying a silhouette strip so the city never ends abruptly at the map edge.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform sampler2D tMask;
uniform vec3 uFog, uSun;
uniform float uNight;
varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 uv = vec2(vUv.x * 3.0, vUv.y);
  float m = texture2D(tMask, uv).a;
  if (m < 0.5) discard;
  // haze-tinted silhouette: darker than the fog so it reads against the bright horizon, lighter towards the base
  vec3 col = uFog * mix(0.55, 0.82, smoothstep(0.0, 0.7, 1.0 - vUv.y) * 0.7 + 0.2) + uSun * 0.05;
  vec2 g = floor(uv * vec2(4096.0 / 6.0, 256.0 / 8.0));
  float w = step(0.82, hash(g)) * smoothstep(0.02, 0.12, vUv.y);
  col += vec3(1.0, 0.78, 0.45) * w * uNight * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSkylineBand(group, T, atmo) {
  const geo = new THREE.CylinderGeometry(2650, 2650, 520, 64, 1, true);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: true,
    uniforms: { tMask: { value: T.skyline }, uFog: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uNight: { value: 0 } },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  mesh.position.y = 170;
  group.add(mesh);
  const apply = (pal, night) => { mat.uniforms.uFog.value.copy(pal.fog); mat.uniforms.uSun.value.copy(pal.sun); mat.uniforms.uNight.value = night; };
  atmo.onChange.push(apply);
  apply(atmo.pal, atmo.night);
  return { mesh, update(camera) { mesh.position.x = camera.position.x; mesh.position.z = camera.position.z; } };
}
