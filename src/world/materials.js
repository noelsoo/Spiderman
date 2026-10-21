import * as THREE from 'three';

/** Facade styles: tile size in metres (8x8 windows per tile) and floor height. */
export const STYLES = {
  glassTeal: { mat: 'glassTeal', tw: 24, th: 8 * 3.6, py: 3.6 },
  glassBlue: { mat: 'glassBlue', tw: 24, th: 8 * 3.6, py: 3.6 },
  glassSteel: { mat: 'glassSteel', tw: 24, th: 8 * 3.6, py: 3.6 },
  brownstone: { mat: 'brownstone', tw: 24, th: 8 * 3.2, py: 3.2 },
  redbrick: { mat: 'redbrick', tw: 24, th: 8 * 3.2, py: 3.2 },
  limestone: { mat: 'limestone', tw: 24, th: 8 * 4, py: 4 },
  concrete: { mat: 'concrete', tw: 24, th: 8 * 3.4, py: 3.4 },
  hdb: { mat: 'hdb', tw: 24, th: 8 * 3, py: 3 },
  shophouse: { mat: 'shophouse', tw: 24, th: 8 * 3.6, py: 3.6 },
};

/**
 * Hides texture tiling on huge ground surfaces: every map lookup blends the normal tile with a second, rescaled and
 * offset lookup, weighted by low-frequency noise. No extra geometry or draw calls, a couple of extra texture taps.
 */
export function antiTile(mat) {
  if (globalThis.__NO_AT) return mat;
  if (!mat || !mat.isMeshStandardMaterial) return mat;
  mat.onBeforeCompile = (sh) => {
    const sw = (chunk, name, uv) => THREE.ShaderChunk[chunk].split(`texture2D( ${name}, ${uv} )`).join(`aTex( ${name}, ${uv} )`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
float aHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float aNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), f.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), f.x), f.y); }
vec4 aTex(sampler2D t, vec2 uv){
  float w = smoothstep(0.35, 0.65, aNoise(uv * 0.11 + 3.7));
  return mix(texture2D(t, uv), texture2D(t, uv * 0.713 + vec2(0.371, 0.613)), w);
}`)
      .replace('#include <map_fragment>', sw('map_fragment', 'map', 'vMapUv'))
      .replace('#include <roughnessmap_fragment>', sw('roughnessmap_fragment', 'roughnessMap', 'vRoughnessMapUv'))
      .replace('#include <normal_fragment_maps>', sw('normal_fragment_maps', 'normalMap', 'vNormalMapUv'));
  };
  mat.customProgramCacheKey = () => 'antiTile';
  return mat;
}

export function makeMaterials(T, quality = 'high') {
  const low = quality === 'low';
  const strip = (o) => { const { roughness, metalness, envMapIntensity, normalMap, normalScale, roughnessMap, metalnessMap, ...rest } = o; return rest; };
  const Mat = (o) => (low ? new THREE.MeshLambertMaterial(strip(o)) : new THREE.MeshStandardMaterial(o));
  const wallMats = []; // emissive intensity animated with time of day
  // roughness / metalness maps multiply the scalar values, so the scalars act as "max" values
  const wall = (f, o = {}) => {
    const m = Mat({
      map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 1,
      vertexColors: true, roughness: 0.9, metalness: 0,
      ...(f.normal ? { normalMap: f.normal, normalScale: new THREE.Vector2(1, 1) } : {}),
      ...(f.orm ? { roughnessMap: f.orm, metalnessMap: f.orm } : {}),
      ...o,
    });
    wallMats.push(m);
    return m;
  };
  const F = T.facades;
  const M = {
    // glass towers: the ORM map makes panes mirror-smooth and slabs/mullions rougher
    glassTeal: wall(F.glassTeal, { roughness: 1, metalness: 0.75, envMapIntensity: 1.5 }),
    glassBlue: wall(F.glassBlue, { roughness: 1, metalness: 0.8, envMapIntensity: 1.6 }),
    glassSteel: wall(F.glassSteel, { roughness: 1, metalness: 0.7, envMapIntensity: 1.35 }),
    brownstone: wall(F.brownstone, { roughness: 1, metalness: 0.6, envMapIntensity: 1.0 }),
    redbrick: wall(F.redbrick, { roughness: 1, metalness: 0.6, envMapIntensity: 1.0 }),
    limestone: wall(F.limestone, { roughness: 1, metalness: 0.7, envMapIntensity: 1.0 }),
    concrete: wall(F.concrete, { roughness: 1, metalness: 0.6, envMapIntensity: 1.0 }),
    // far LOD: one flat-shaded window atlas for every distant tile (tinted per vertex)
    storefront: wall(T.storefront, { roughness: 0.55, envMapIntensity: 0.8 }),
    roof: Mat({ map: T.roof, vertexColors: true, roughness: 0.95 }),
    sidewalk: Mat({ map: T.sidewalk, normalMap: T.sidewalkN, vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grass: new THREE.MeshLambertMaterial({ map: T.grass, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    pond: Mat({ vertexColors: true, color: 0x2a7a8c, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    markings: Mat({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    asphalt: Mat({ map: T.asphalt, normalMap: T.asphaltN, roughnessMap: T.asphaltORM, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
    // street furniture: neutral PBR with vertex colours (no texture)
    street: Mat({ vertexColors: true, roughness: 0.6, metalness: 0.25, envMapIntensity: 0.8 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    lamp: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(0.2, 0.2, 0.2) }),
    neon: new THREE.MeshBasicMaterial({ map: T.neon, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1, 1, 1) }),
    ad: new THREE.MeshBasicMaterial({ map: T.screens, vertexColors: true, color: new THREE.Color(1.2, 1.2, 1.2) }),
  };
  M.far = new THREE.MeshLambertMaterial({ map: T.far.map, emissiveMap: T.far.emissive, emissive: 0xffffff, emissiveIntensity: 1, vertexColors: true });
  wallMats.push(M.far);
  M.sidewalk.userData.keep = true;
  if (!low) { antiTile(M.asphalt); antiTile(M.sidewalk); }
  // the asphalt ground plane is huge: sharpen its tiling response
  if (M.asphalt.normalMap) M.asphalt.normalMap.anisotropy = M.asphalt.map.anisotropy;
  T._wallMats = wallMats; T._wall = wall;
  return { M, wallMats };
}

/** Singapore: build the HDB / shophouse facade textures + materials into M (idempotent). */
export function addSgMaterials(T, M) {
  if (M.hdb) return;
  const F = T.ensureSg();
  const ref = M.concrete, opts = { roughness: 1, metalness: 0.5, envMapIntensity: 0.9 };
  M.hdb = T._wall(F.hdb, opts); M.shophouse = T._wall(F.shophouse, opts);
  for (const m of [M.hdb, M.shophouse]) { m.emissiveIntensity = ref.emissiveIntensity; if (T._wallMats.indexOf(m) < 0) T._wallMats.push(m); }
}
