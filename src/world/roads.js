// Road network data derived from the city constants (for traffic / pedestrians / minimap).
import { L, avenueX, streetZ, AVES, STREETS, BLOCKS, streetSpans, hasDriveAve, parkOf } from './grid.js';

/**
 * roads = {
 *   avenues:       [{ k, x, zMin, zMax, width, drive }]   north-south roads (x = centre line): Manhattan k 0..18, Brooklyn k -9..-7
 *   streets:       [{ k, z, xMin, xMax, width }]           east-west roads (z = centre line), one entry per street per island
 *                                                          (street k -14..31; Manhattan x -400..1400, Brooklyn x -1300..-1100)
 *   intersections: [{ x, z, a, s }]                        every avenue x street crossing; a / s are the avenue / street indices
 *   sidewalks:     [{ x0, x1, z0, z1, width, park, district }]  one rectangle per city block; the walkable strip is the ring of `width` m
 *                                                          inside the rectangle (the interior is buildings, or lawn when park = true)
 * }
 * Lane model used by the ambient traffic: avenue lanes sit at x + {-8.25,-2.75,+2.75,+8.25}
 * (negative offsets drive +z, positive drive -z), street lanes at z + {-4,+4} (+4 drives +x, -4 drives -x).
 * Avenue 18 (x = 1400) is on the map edge and not drivable (`drive: false`).
 */
export function buildRoads(shops = []) {
  const avenues = [], streets = [], intersections = [], sidewalks = [];
  for (const k of AVES) avenues.push({ k, x: avenueX(k), zMin: L.MINZ, zMax: L.MAXZ, width: L.AVE_W, drive: hasDriveAve(k) });
  for (const s of STREETS) for (const sp of streetSpans) streets.push({ k: s, z: streetZ(s), xMin: sp.xMin, xMax: sp.xMax, width: L.ST_W });
  for (const a of avenues) for (const s of STREETS) intersections.push({ x: a.x, z: streetZ(s), a: a.k, s });
  for (const b of BLOCKS) {
    sidewalks.push({ x0: b.cx - L.BW / 2, x1: b.cx + L.BW / 2, z0: b.cz - L.BD / 2, z1: b.cz + L.BD / 2, width: 4, park: !!parkOf(b.i, b.j), district: b.district });
  }
  return { avenues, streets, intersections, sidewalks, shops };
}
