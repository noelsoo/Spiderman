// Road network data derived from the city constants (for traffic / pedestrians / minimap).
import { L, avenueX, streetZ, colX, rowZ, isPark } from './city.js';

/**
 * roads = {
 *   avenues:       [{ x, zMin, zMax, width }]            north-south roads (x = centre line), 11 of them
 *   streets:       [{ z, xMin, xMax, width }]            east-west roads (z = centre line), 18 of them
 *   intersections: [{ x, z }]                            every avenue x street crossing (198)
 *   sidewalks:     [{ x0, x1, z0, z1, width, park }]     one rectangle per city block; the walkable strip is the ring of `width` m
 *                                                        inside the rectangle (the interior is buildings, or lawn when park = true)
 * }
 * Lane model used by the (removed) ambient traffic, handy for AI: avenue lanes sit at x + {-8.25,-2.75,+2.75,+8.25}
 * (negative offsets drive +z, positive drive -z), street lanes at z + {-4,+4} (+4 drives +x, -4 drives -x).
 */
export function buildRoads(shops = []) {
  const avenues = [], streets = [], intersections = [], sidewalks = [];
  for (let a = 0; a < 11; a++) avenues.push({ x: avenueX(a), zMin: L.MINZ, zMax: L.MAXZ, width: L.AVE_W });
  for (let s = 0; s < 18; s++) streets.push({ z: streetZ(s), xMin: avenueX(0), xMax: avenueX(10), width: L.ST_W });
  for (const a of avenues) for (const s of streets) intersections.push({ x: a.x, z: s.z });
  for (let i = 0; i < L.COLS; i++) for (let j = 0; j < L.ROWS; j++) {
    sidewalks.push({ x0: colX(i) - L.BW / 2, x1: colX(i) + L.BW / 2, z0: rowZ(j) - L.BD / 2, z1: rowZ(j) + L.BD / 2, width: 4, park: isPark(i, j) });
  }
  return { avenues, streets, intersections, sidewalks, shops };
}
