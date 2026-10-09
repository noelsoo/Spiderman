// Post-processing pipeline (graphics agent). API: createPost(game) -> { render(dt), setSize(w,h), setTint(color, amount), setQuality(q) }
//
//   scene -> MSAA HDR target (+ depth texture on high/ultra)
//         -> [high/ultra] half-res depth-only ambient occlusion (+ depth-aware blur) multiplied into the image
//         -> bloom (UnrealBloomPass on the HDR image)
//         -> final pass: speed radial blur + chromatic aberration, sun shafts + lens flare (high/ultra),
//            ACES tone mapping, filmic contrast, teal/orange split toning, vignette, grain, full-screen tint.
// 'low' renders straight to the canvas (no passes at all) unless a tint is requested.
// No per-frame allocations: every uniform object is created once.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { resolveQuality, tierIndex } from './quality.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---------------------------------------------------------------- ambient occlusion (depth only)
const AO_FRAG = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uProjInv, uProj;
uniform vec2 uTexel;
uniform float uRadius, uIntensity, uAspect, uMaxDist;
varying vec2 vUv;
vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 > 0.9999995) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  float dist = -P.z;
  if (dist > uMaxDist) { gl_FragColor = vec4(1.0); return; }
  vec3 Pr = viewPos(vUv + vec2(uTexel.x, 0.0)), Pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 Pu = viewPos(vUv + vec2(0.0, uTexel.y)), Pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  if (N.z < 0.0) N = -N;
  float rpx = min(uRadius * uProj[1][1] * 0.5 / dist, 0.12);
  vec2 rad = vec2(rpx / uAspect, rpx);
  float a0 = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(AO_SAMPLES);
    float a = a0 + float(i) * 2.399963;
    vec2 o = vec2(cos(a), sin(a)) * sqrt(fi) * rad;
    vec3 v = viewPos(vUv + o) - P;
    float vd = length(v);
    float ndv = dot(N, v) / (vd + 1e-4);
    float fall = 1.0 - smoothstep(uRadius * 0.7, uRadius * 1.8, vd);
    occ += max(ndv - 0.12, 0.0) * fall;
  }
  occ /= float(AO_SAMPLES);
  float ao = 1.0 - clamp(occ * uIntensity, 0.0, 1.0);
  float fade = clamp((rpx / uTexel.y - 1.5) / 5.0, 0.0, 1.0) * (1.0 - smoothstep(uMaxDist * 0.6, uMaxDist, dist));
  gl_FragColor = vec4(vec3(mix(1.0, ao, fade)), 1.0);
}`;

const AO_BLUR_FRAG = /* glsl */`
uniform sampler2D tAO, tDepth;
uniform vec2 uTexel;       // texel of the AO target
uniform float uNear, uFar;
varying vec2 vUv;
float linZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
void main(){
  float zc = -linZ(texture2D(tDepth, vUv).x);
  float sum = texture2D(tAO, vUv).r, wsum = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * 1.6;
    float z = -linZ(texture2D(tDepth, uv).x);
    float w = exp(-abs(z - zc) * 24.0 / max(zc, 1.0)) ;
    sum += texture2D(tAO, uv).r * w; wsum += w;
  }
  gl_FragColor = vec4(vec3(sum / wsum), 1.0);
}`;

const AO_COMP_FRAG = /* glsl */`
uniform sampler2D tColor, tAO;
uniform float uStrength;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb;
  float ao = texture2D(tAO, vUv).r;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  ao = mix(ao, 1.0, smoothstep(1.6, 5.0, lum));   // do not darken emissives / sun glints
  gl_FragColor = vec4(c * mix(1.0, ao, uStrength), 1.0);
}`;

// 1x1 target: how much of the sun is visible (sky pixels in the depth buffer), smoothed over time.
const OCC_FRAG = /* glsl */`
uniform sampler2D tDepth, tPrev;
uniform vec2 uSunUV;
uniform float uAspect, uBlend;
varying vec2 vUv;
void main(){
  float vis = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.399963, r = sqrt((float(i) + 0.5) / 12.0) * 0.022;
    vec2 uv = uSunUV + vec2(cos(a) / uAspect, sin(a)) * r;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vis += step(0.9999995, texture2D(tDepth, uv).x) * inside;
  }
  vis /= 12.0;
  float prev = texture2D(tPrev, vec2(0.5)).r;
  gl_FragColor = vec4(mix(prev, vis, uBlend), 0.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- final grade
const FINAL_FRAG = /* glsl */`
uniform sampler2D tColor, tOcc;
uniform vec2 uRes, uSunUV;
uniform float uAspect, uTime, uSpeed, uSunVis, uGrain, uVig, uContrast;
uniform vec3 uSunCol, uTint;
uniform float uTintAmt;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  vec3 col;
  #ifdef FX_SPEED
  if (uSpeed > 0.02) {
    float blur = uSpeed * 0.07, ca = uSpeed * 0.06;
    col = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      vec2 o = d * (float(i) / 6.0) * blur;
      col.r += texture2D(tColor, uv - o * (1.0 + ca)).r;
      col.g += texture2D(tColor, uv - o).g;
      col.b += texture2D(tColor, uv - o * (1.0 - ca)).b;
    }
    col /= 7.0;
  } else
  #endif
  col = texture2D(tColor, uv).rgb;

  #ifdef FX_SUN
  if (uSunVis > 0.001) {
    vec2 toSun = uSunUV - uv;
    vec2 ts = toSun * vec2(uAspect, 1.0);
    float sd = length(ts);
    // light shafts: radial march toward the sun, keeping only the very bright sky near the disc
    float j = hash12(gl_FragCoord.xy + uTime) * 0.5;
    vec3 sh = vec3(0.0);
    for (int i = 0; i < 14; i++) {
      vec2 p = uv + toSun * ((float(i) + j) / 14.0) * 0.8;
      vec3 s = texture2D(tColor, p).rgb;
      float l = dot(s, vec3(0.3, 0.6, 0.1));
      sh += s * smoothstep(1.4, 3.5, l);
    }
    sh /= 14.0;
    col += sh * uSunVis * 0.5 * exp(-sd * 1.3);
    // lens flare (analytic ghosts), faded by how much of the sun is visible
    float occ = texture2D(tOcc, vec2(0.5)).r;
    float f = occ * uSunVis;
    if (f > 0.002) {
      vec2 sv = (uSunUV - 0.5) * vec2(uAspect, 1.0);
      vec2 pc = d * vec2(uAspect, 1.0);
      vec3 fl = vec3(0.0);
      fl += vec3(1.0, 0.75, 0.45) * 0.10 * exp(-sd * 9.0);                         // glare
      fl += vec3(0.5, 0.8, 1.0) * 0.30 * exp(-abs(uv.y - uSunUV.y) * 140.0) * exp(-abs(ts.x) * 3.2); // anamorphic streak
      // ghosts along the line through screen centre
      vec2 g1 = -sv * 0.45, g2 = -sv * 0.9, g3 = sv * 0.35, g4 = -sv * 1.6;
      fl += vec3(1.0, 0.7, 0.4) * 0.14 * smoothstep(0.075, 0.03, length(pc - g1));
      fl += vec3(0.5, 0.9, 0.7) * 0.10 * smoothstep(0.11, 0.05, length(pc - g2));
      fl += vec3(1.0, 0.5, 0.6) * 0.10 * smoothstep(0.05, 0.015, length(pc - g3));
      fl += vec3(0.6, 0.7, 1.0) * 0.14 * smoothstep(0.22, 0.17, length(pc - g4)) * smoothstep(0.12, 0.2, length(pc - g4));
      col += fl * uSunCol * f * 0.9;
    }
  }
  #endif

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 c = gl_FragColor.rgb;

  // filmic contrast + gentle saturation
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c = mix(vec3(lum), c, 1.08);
  // SM2 golden hour split toning: cool teal shadows, warm orange highlights
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(vec3(0.88, 1.01, 1.08), vec3(1.07, 1.0, 0.9), smoothstep(0.12, 0.7, l2));
  c += vec3(0.0, 0.006, 0.012) * (1.0 - l2);
  // vignette
  vec2 vq = d * vec2(uAspect * 0.62 + 0.38, 1.0);
  c *= 1.0 - uVig * smoothstep(0.28, 0.95, length(vq) * 1.35);
  // full-screen tint (ultimates)
  if (uTintAmt > 0.001) c = mix(c, c * uTint * 1.25 + uTint * 0.12, clamp(uTintAmt, 0.0, 1.0));
  // grain / dither
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export function createPost(game) {
  const { renderer, scene, camera } = game;
  let quality = resolveQuality(renderer, game.settings?.quality);
  let T = tierIndex(quality);
  let tintAmt = 0;
  const tint = new THREE.Color(1, 1, 1);
  let speedSm = 0, time = 0, frame = 0, occFlip = 0;
  const size = new THREE.Vector2();

  renderer.info.autoReset = false; // one frame = several renders; we reset once per frame in render()

  // ---- materials (created once) -----------------------------------------------------------
  const mk = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
  const aoMat = mk(AO_FRAG, {
    tDepth: { value: null }, uProjInv: { value: camera.projectionMatrixInverse }, uProj: { value: camera.projectionMatrix },
    uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.4 }, uIntensity: { value: 1.6 }, uAspect: { value: 1 }, uMaxDist: { value: 220 },
  }, { AO_SAMPLES: 10 });
  const aoBlurMat = mk(AO_BLUR_FRAG, { tAO: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 4000 } });
  const aoCompMat = mk(AO_COMP_FRAG, { tColor: { value: null }, tAO: { value: null }, uStrength: { value: 0.85 } });
  const occMat = mk(OCC_FRAG, { tDepth: { value: null }, tPrev: { value: null }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uBlend: { value: 0.2 } });
  const finalMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: null }, tOcc: { value: null }, uRes: { value: new THREE.Vector2() }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 }, uTime: { value: 0 }, uSpeed: { value: 0 }, uSunVis: { value: 0 }, uGrain: { value: 0.016 }, uVig: { value: 0.3 }, uContrast: { value: 0.32 },
      uSunCol: { value: new THREE.Color(1, 0.7, 0.4) }, uTint: { value: new THREE.Color(1, 1, 1) }, uTintAmt: { value: 0 },
    },
  });
  const quad = new FullScreenQuad(aoMat);

  // ---- render targets (rebuilt on quality / size change) -------------------------------------
  let sceneRT = null, aoRT1 = null, aoRT2 = null, resolveRT = null, occA = null, occB = null, bloom = null;
  const disposeTargets = () => {
    for (const t of [sceneRT, aoRT1, aoRT2, resolveRT, occA, occB]) t?.dispose();
    bloom?.dispose();
    sceneRT = aoRT1 = aoRT2 = resolveRT = occA = occB = bloom = null;
  };
  const hasAO = () => T >= 2, hasSun = () => T >= 2, usesPost = () => T >= 1 || tintAmt > 0.002;

  function build() {
    disposeTargets();
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0);
    if (!usesPost()) return;
    const opts = { type: THREE.HalfFloatType, samples: T >= 1 ? 4 : 0, depthBuffer: true };
    sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    if (hasAO() || hasSun()) { sceneRT.depthTexture = new THREE.DepthTexture(w, h); }
    if (hasAO()) {
      const aw = Math.max(2, (w / 2) | 0), ah = Math.max(2, (h / 2) | 0);
      const ao = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      aoRT1 = new THREE.WebGLRenderTarget(aw, ah, ao); aoRT2 = new THREE.WebGLRenderTarget(aw, ah, ao);
      resolveRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
      aoMat.defines.AO_SAMPLES = T >= 3 ? 16 : 10; aoMat.needsUpdate = true;
      aoMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      aoMat.uniforms.uIntensity.value = T >= 3 ? 1.7 : 1.5;
      aoBlurMat.uniforms.uTexel.value.set(1 / aw, 1 / ah);
    }
    if (hasSun()) {
      const o = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
      occA = new THREE.WebGLRenderTarget(1, 1, o); occB = new THREE.WebGLRenderTarget(1, 1, o);
    }
    if (T >= 1) {
      bloom = new UnrealBloomPass(new THREE.Vector2(w, h), T >= 3 ? 0.42 : T >= 2 ? 0.36 : 0.3, 0.72, 1.05);
      bloom.setSize(w, h);
    }
    finalMat.defines.FX_SPEED = 1;
    if (hasSun()) finalMat.defines.FX_SUN = 1; else delete finalMat.defines.FX_SUN;
    finalMat.needsUpdate = true;
    finalMat.uniforms.uRes.value.set(w, h);
    finalMat.uniforms.uAspect.value = w / h;
    finalMat.uniforms.uGrain.value = 0.014;
    finalMat.uniforms.uVig.value = T >= 2 ? 0.3 : 0.24;
  }
  build();

  function updateSpeed(dt) {
    const dv = game.vehicles?.driving;
    let v = 0;
    if (dv) v = Math.abs(dv.speed ?? dv.vel?.length?.() ?? 0);
    else if (game.player?.vel && game.state !== 'menu') v = game.player.vel.length();
    const target = THREE.MathUtils.smoothstep(v, 26, 62);
    speedSm += (target - speedSm) * Math.min(1, dt * (target > speedSm ? 3 : 2));
    return speedSm;
  }

  /** Sun in screen space; returns visibility 0..1 (in front of the camera, above the horizon, near the screen). */
  function sunScreen() {
    const atmo = game.world?.atmo;
    if (!atmo || atmo.pal.sunI < 0.05) return 0;
    _v.copy(atmo.sunDir).multiplyScalar(1000).add(camera.position);
    _v.project(camera);
    // behind the camera -> project() flips; check with the view-space z of the direction
    const f = atmo.sunDir.x * -camera.matrixWorld.elements[8] + atmo.sunDir.y * -camera.matrixWorld.elements[9] + atmo.sunDir.z * -camera.matrixWorld.elements[10];
    if (f < 0.05) return 0;
    const u = _v.x * 0.5 + 0.5, v = _v.y * 0.5 + 0.5;
    finalMat.uniforms.uSunUV.value.set(u, v);
    occMat.uniforms.uSunUV.value.set(u, v);
    const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
    return THREE.MathUtils.clamp((1.35 - edge) / 0.5, 0, 1) * Math.min(1, atmo.pal.sunI / 1.6) * Math.min(1, f * 4);
  }

  function render(dt = 0.016) {
    // follow quality changes (settings menu) and the world's software-renderer downgrade
    const q = resolveQuality(renderer, game.settings?.quality);
    if (q !== quality) { quality = q; T = tierIndex(q); build(); }
    time += dt;
    renderer.info.reset();
    const f0 = renderer.info.render.frame;
    if (!usesPost()) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      renderer.info.render.frame = f0 + 1;
      return;
    }
    if (!sceneRT) build();
    if (!sceneRT) { renderer.render(scene, camera); return; }

    // 1. scene (MSAA, HDR)
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    let base = sceneRT;

    // 2. ambient occlusion
    if (aoRT1) {
      aoMat.uniforms.tDepth.value = sceneRT.depthTexture;
      aoMat.uniforms.uAspect.value = camera.aspect;
      quad.material = aoMat; renderer.setRenderTarget(aoRT1); quad.render(renderer);
      aoBlurMat.uniforms.tAO.value = aoRT1.texture; aoBlurMat.uniforms.tDepth.value = sceneRT.depthTexture;
      aoBlurMat.uniforms.uNear.value = camera.near; aoBlurMat.uniforms.uFar.value = camera.far;
      quad.material = aoBlurMat; renderer.setRenderTarget(aoRT2); quad.render(renderer);
      aoCompMat.uniforms.tColor.value = sceneRT.texture; aoCompMat.uniforms.tAO.value = aoRT2.texture;
      quad.material = aoCompMat; renderer.setRenderTarget(resolveRT); quad.render(renderer);
      base = resolveRT;
    }

    // 3. bloom (adds onto `base`)
    if (bloom) bloom.render(renderer, null, base, dt, false);

    // 4. sun visibility
    const U = finalMat.uniforms;
    let sunVis = 0;
    if (occA) {
      sunVis = sunScreen();
      if (sunVis > 0.001) {
        const prev = occFlip ? occB : occA, next = occFlip ? occA : occB;
        occMat.uniforms.tDepth.value = sceneRT.depthTexture; occMat.uniforms.tPrev.value = prev.texture;
        occMat.uniforms.uAspect.value = camera.aspect; occMat.uniforms.uBlend.value = 1 - Math.exp(-dt * 12);
        quad.material = occMat; renderer.setRenderTarget(next); quad.render(renderer);
        occFlip ^= 1;
        U.tOcc.value = next.texture;
      }
      U.uSunCol.value.copy(game.world.atmo.pal.sun);
    }

    // 5. final grade to the canvas
    U.tColor.value = base.texture;
    U.uTime.value = time % 100;
    U.uSpeed.value = updateSpeed(dt);
    U.uSunVis.value = sunVis;
    if (tintAmt > 0.002) { U.uTint.value.copy(tint); U.uTintAmt.value = tintAmt; } else U.uTintAmt.value = 0;
    quad.material = finalMat;
    renderer.setRenderTarget(null);
    quad.render(renderer);
    renderer.info.render.frame = f0 + 1;
    frame++;
  }

  return {
    get quality() { return quality; },
    render,
    setSize() { build(); },
    /** Full-screen colour tint (e.g. Scarlet Witch ultimate): color = THREE.Color | hex, amount 0..1. */
    setTint(color, amount = 0) {
      const was = usesPost();
      tintAmt = THREE.MathUtils.clamp(amount, 0, 1);
      if (tintAmt > 0) tint.set(color instanceof THREE.Color ? color : _c.set(color));
      if (usesPost() !== was) build();
    },
    setQuality(q) { quality = resolveQuality(renderer, q); T = tierIndex(quality); build(); },
    dispose() { disposeTargets(); quad.dispose(); },
  };
}
