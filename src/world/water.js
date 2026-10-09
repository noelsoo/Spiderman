// Cheap animated river: analytic sine-wave normals, fresnel sky reflection, sun glitter. No extra render passes.
import * as THREE from 'three';

const VERT = /* glsl */`
#include <fog_pars_vertex>
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir, uSunColor, uHor, uZen, uMid, uDeep;
varying vec3 vWorld;
#include <fog_pars_fragment>
vec3 skyCol(vec3 r){
  float h = max(r.y, 0.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.28, h));
  col = mix(col, uZen, smoothstep(0.18, 0.85, h));
  float sd = max(dot(r, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.55 * exp(-abs(r.y) * 5.0) + pow(sd, 3.0) * 0.18);
  return col;
}
void main(){
  vec2 p = vWorld.xz;
  p += vec2(sin(p.y * 0.021 + uTime * 0.2), cos(p.x * 0.017 - uTime * 0.17)) * 7.0;
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  float att = 1.0 / (1.0 + dist * 0.0035);
  vec2 g = vec2(0.0);
  float t = uTime;
  g += vec2(0.8, 0.6)   * 0.35 * 0.09 * cos(dot(vec2(0.8, 0.6), p) * 0.09 + t * 0.9);
  g += vec2(-0.5, 0.86) * 0.25 * 0.16 * cos(dot(vec2(-0.5, 0.86), p) * 0.16 + t * 1.2);
  g += vec2(0.95, -0.3) * 0.12 * 0.31 * cos(dot(vec2(0.95, -0.3), p) * 0.31 + t * 1.7) * att;
  g += vec2(-0.2, -0.98)* 0.07 * 0.62 * cos(dot(vec2(-0.2, -0.98), p) * 0.62 + t * 2.3) * att;
  g += vec2(0.6, 0.8)   * 0.04 * 1.3  * cos(dot(vec2(0.6, 0.8), p) * 1.3 + t * 3.1) * att;
  g *= 0.7;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float F = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 refl = skyCol(R);
  float sd = max(dot(R, uSunDir), 0.0);
  refl += uSunColor * (pow(sd, 700.0) * 30.0 + pow(sd, 90.0) * 1.2);
  vec3 col = mix(uDeep, refl, clamp(F * 0.9 + 0.06, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function makeWater() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-1, 0.2, 0) },
    uSunColor: { value: new THREE.Color(1, 0.5, 0.2) },
    uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uMid: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color(0.02, 0.07, 0.1) },
  }]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true });
  const geo = new THREE.PlaneGeometry(560, 6000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-720, -0.6, 0);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
