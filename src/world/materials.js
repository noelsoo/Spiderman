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
};

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
  };
  M.sidewalk.userData.keep = true;
  // the asphalt ground plane is huge: sharpen its tiling response
  if (M.asphalt.normalMap) M.asphalt.normalMap.anisotropy = M.asphalt.map.anisotropy;
  return { M, wallMats };
}
