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
  const strip = (o) => { const { roughness, metalness, envMapIntensity, ...rest } = o; return rest; };
  const Mat = (o) => (low ? new THREE.MeshLambertMaterial(strip(o)) : new THREE.MeshStandardMaterial(o));
  const wallMats = []; // emissive intensity animated with time of day
  const wall = (f, o = {}) => {
    const m = Mat({
      map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 1,
      vertexColors: true, roughness: 0.9, metalness: 0, ...o,
    });
    wallMats.push(m);
    return m;
  };
  const F = T.facades;
  const M = {
    glassTeal: wall(F.glassTeal, { roughness: 0.2, metalness: 0.55, envMapIntensity: 1.3 }),
    glassBlue: wall(F.glassBlue, { roughness: 0.18, metalness: 0.6, envMapIntensity: 1.4 }),
    glassSteel: wall(F.glassSteel, { roughness: 0.25, metalness: 0.5, envMapIntensity: 1.2 }),
    brownstone: wall(F.brownstone, { roughness: 0.92 }),
    redbrick: wall(F.redbrick, { roughness: 0.92 }),
    limestone: wall(F.limestone, { roughness: 0.85 }),
    concrete: wall(F.concrete, { roughness: 0.85 }),
    storefront: wall(T.storefront, { roughness: 0.6 }),
    roof: Mat({ map: T.roof, vertexColors: true, roughness: 0.95 }),
        sidewalk: Mat({ map: T.sidewalk, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grass: new THREE.MeshLambertMaterial({ map: T.grass, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    pond: Mat({ vertexColors: true, color: 0x2a7a8c, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    markings: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    asphalt: Mat({ map: T.asphalt, roughness: 0.92 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  M.sidewalk.userData.keep = true;
  return { M, wallMats };
}
