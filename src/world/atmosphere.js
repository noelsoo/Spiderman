// Sky dome, sun/hemisphere lighting with a camera-following shadow frustum, fog, time of day.
import * as THREE from 'three';

const C = (r, g, b) => new THREE.Color(r, g, b);
// palettes keyed by sun elevation (sin of angle)
const STOPS = [
  { e: -0.25, zen: C(0.004, 0.008, 0.03), mid: C(0.012, 0.02, 0.06), hor: C(0.03, 0.04, 0.09), fog: C(0.02, 0.03, 0.07), sun: C(0, 0, 0), sunI: 0, hs: C(0.05, 0.08, 0.2), hg: C(0.03, 0.03, 0.05), hI: 0.55, env: 0.18, glow: 1.9 },
  { e: -0.02, zen: C(0.03, 0.06, 0.22), mid: C(0.35, 0.18, 0.28), hor: C(1.0, 0.3, 0.1), fog: C(0.62, 0.25, 0.16), sun: C(1.0, 0.35, 0.12), sunI: 1.6, hs: C(0.35, 0.3, 0.5), hg: C(0.25, 0.15, 0.13), hI: 0.6, env: 0.4, glow: 1.6 },
  { e: 0.17, zen: C(0.055, 0.17, 0.5), mid: C(0.7, 0.42, 0.34), hor: C(1.0, 0.52, 0.2), fog: C(0.8, 0.42, 0.24), sun: C(1.0, 0.56, 0.24), sunI: 3.4, hs: C(0.55, 0.6, 0.9), hg: C(0.55, 0.36, 0.22), hI: 0.85, env: 0.7, glow: 0.8 },
  { e: 0.55, zen: C(0.08, 0.26, 0.75), mid: C(0.32, 0.55, 0.9), hor: C(0.72, 0.82, 0.95), fog: C(0.6, 0.7, 0.85), sun: C(1.0, 0.93, 0.82), sunI: 3.0, hs: C(0.6, 0.75, 1.0), hg: C(0.4, 0.38, 0.33), hI: 1.0, env: 1.0, glow: 0.12 },
  { e: 1.0, zen: C(0.08, 0.26, 0.75), mid: C(0.32, 0.55, 0.9), hor: C(0.72, 0.82, 0.95), fog: C(0.6, 0.7, 0.85), sun: C(1.0, 0.95, 0.88), sunI: 3.0, hs: C(0.6, 0.75, 1.0), hg: C(0.4, 0.38, 0.33), hI: 1.0, env: 1.0, glow: 0.1 },
];
const COLOR_KEYS = ['zen', 'mid', 'hor', 'fog', 'sun', 'hs', 'hg'];
const NUM_KEYS = ['sunI', 'hI', 'env', 'glow'];

function samplePalette(e, out) {
  let i = 0;
  while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const t = Math.min(1, Math.max(0, (e - a.e) / (b.e - a.e)));
  for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t);
  for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZen, uMid, uHor, uSunDir, uSun;
uniform float uStars;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.28, up));
  col = mix(col, uZen, smoothstep(0.18, 0.85, up));
  // below horizon fades to a warm-dark haze
  col = mix(col, uHor * 0.45, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // horizon glow toward the sun, broad + tight
  float hz = exp(-abs(h) * 5.0);
  col += uSun * (pow(sd, 6.0) * 0.55 * hz + pow(sd, 3.0) * 0.18) ;
  col += uSun * pow(sd, 48.0) * 0.8;
  float disc = smoothstep(0.99955, 0.99985, sd);
  col += uSun * disc * 14.0 * step(-0.02, uSunDir.y + 0.02);
  if (uStars > 0.01 && h > 0.0) {
    float s = step(0.9985, hash(floor(d * 380.0)));
    col += vec3(s) * uStars * smoothstep(0.0, 0.3, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Atmosphere {
  constructor(game, quality) {
    this.game = game;
    this.quality = quality;
    const { scene } = game;
    this.t = 0.72;
    this.cycle = false;
    this.cycleSpeed = 1 / 600; // fraction of a day per second when enabled
    this.pal = { zen: C(0, 0, 0), mid: C(0, 0, 0), hor: C(0, 0, 0), fog: C(0, 0, 0), sun: C(0, 0, 0), hs: C(0, 0, 0), hg: C(0, 0, 0), sunI: 0, hI: 0, env: 0, glow: 1 };
    this.sunDir = new THREE.Vector3(-0.95, 0.2, 0.25).normalize();
    this.wallMats = [];
    this.onChange = [];

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: {
        uZen: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uSunDir: { value: this.sunDir }, uSun: { value: new THREE.Color() }, uStars: { value: 0 },
      },
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 0.8);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc080, 3);
    this.sun.castShadow = quality !== 'low';
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 5; c.far = 1500;
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 0.35;
    }
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.FogExp2(0xcc8855, 0.00072);

    // reflection environment rendered from a tiny copy of the sky
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), this.skyMat);
    this.envScene.add(this.envMesh);
    this.pmrem = new THREE.PMREMGenerator(game.renderer);
    this.envRT = null;
    this._tmp = new THREE.Vector3();
    this._bx = new THREE.Vector3(); this._by = new THREE.Vector3();
    this._envAcc = 0;
    this.waterUniforms = null;
    this.setTime(this.t, true);
  }

  registerWalls(mats) { this.wallMats = mats; }

  setTime(t, force = false, skipEnv = false) {
    this.t = ((t % 1) + 1) % 1;
    const a = (this.t - 0.25) * Math.PI * 2;
    const e = Math.sin(a);
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.25).normalize();
    samplePalette(e, this.pal);
    const p = this.pal;
    const u = this.skyMat.uniforms;
    u.uZen.value.copy(p.zen); u.uMid.value.copy(p.mid); u.uHor.value.copy(p.hor); u.uSun.value.copy(p.sun);
    u.uStars.value = THREE.MathUtils.clamp((-e - 0.02) * 6, 0, 1.2);
    this.hemi.color.copy(p.hs); this.hemi.groundColor.copy(p.hg); this.hemi.intensity = p.hI;
    this.sun.color.copy(p.sun); this.sun.intensity = p.sunI;
    this.sun.visible = p.sunI > 0.02;
    const fog = this.game.scene.fog;
    fog.color.copy(p.fog);
    fog.density = 0.00072 * (e < 0.05 ? 1.15 : 1);
    this.game.scene.background = null;
    for (const m of this.wallMats) m.emissiveIntensity = p.glow;
    if (this.waterUniforms) this.updateWater();
    if (!skipEnv) this.refreshEnv();
  }

  attachWater(uniforms) { this.waterUniforms = uniforms; this.updateWater(); }
  updateWater() {
    const w = this.waterUniforms, p = this.pal;
    w.uSunDir.value.copy(this.sunDir);
    w.uSunColor.value.copy(p.sun).multiplyScalar(Math.min(1.5, p.sunI * 0.5));
    w.uHor.value.copy(p.hor); w.uZen.value.copy(p.zen); w.uMid.value.copy(p.mid);
    w.uDeep.value.set(0.015, 0.06, 0.09).lerp(p.hs, 0.05);
  }

  refreshEnv() {
    const scene = this.game.scene;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 200);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    scene.environment = rt.texture;
    scene.environmentIntensity = this.pal.env;
  }

  update(dt, camera, focus) {
    if (this.cycle) {
      this.t = (this.t + dt * this.cycleSpeed) % 1;
      this._envAcc += dt;
      const refresh = this._envAcc > 5;
      if (refresh) this._envAcc = 0;
      this.setTime(this.t, false, !refresh);
    }
    this.sky.position.copy(camera.position);
    // shadow frustum follows the focus point, snapped to texels to avoid shimmering
    const sun = this.sun, T = sun.target.position;
    T.copy(focus);
    const dir = this.sunDir;
    if (sun.castShadow) {
      const bx = this._bx.set(0, 1, 0).cross(dir).normalize();
      const by = this._by.copy(dir).cross(bx).normalize();
      const texel = 150 / 2048;
      const px = T.dot(bx), py = T.dot(by);
      T.addScaledVector(bx, Math.round(px / texel) * texel - px).addScaledVector(by, Math.round(py / texel) * texel - py);
    }
    sun.position.copy(T).addScaledVector(dir.y > 0.02 ? dir : this._tmp.set(0.3, 0.5, 0.3).normalize(), 700);
    sun.target.updateMatrixWorld();
  }
}
