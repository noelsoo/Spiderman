// Static-world physics: axis-aligned boxes in a uniform XZ spatial grid.
// Everything in the city that you can stand on, crawl up or swing from is a box.
// Ground is the plane y = 0 (water is handled by the world as a kill/slow zone).
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Physics {
  constructor(cellSize = 40) {
    this.cell = cellSize;
    this.boxes = [];
    this.grid = new Map();
    this.groundY = 0;
    this._stamp = 0;
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  /** Register a solid box. data is free-form (e.g. { type: 'building', id }) */
  addBox(min, max, data = {}) {
    const box = { min: min.clone(), max: max.clone(), data, _seen: 0 };
    this.boxes.push(box);
    const x0 = Math.floor(box.min.x / this.cell), x1 = Math.floor(box.max.x / this.cell);
    const z0 = Math.floor(box.min.z / this.cell), z1 = Math.floor(box.max.z / this.cell);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz);
      let list = this.grid.get(k);
      if (!list) { list = []; this.grid.set(k, list); }
      list.push(box);
    }
    return box;
  }

  /** Boxes whose cells overlap the XZ rectangle. */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell), z1 = Math.floor(maxZ / this.cell);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const list = this.grid.get(this._key(ix, iz));
      if (!list) continue;
      for (const b of list) if (b._seen !== stamp) { b._seen = stamp; out.push(b); }
    }
    return out;
  }

  /**
   * Push a sphere out of all boxes and the ground. Mutates pos and vel.
   * Returns { onGround, onWall, wallNormal, hitCeiling, box }.
   */
  resolveSphere(pos, r, vel) {
    const res = { onGround: false, onWall: false, wallNormal: new THREE.Vector3(), hitCeiling: false, box: null, wallBox: null, groundBox: null };
    if (pos.y - r < this.groundY) {
      pos.y = this.groundY + r;
      if (vel && vel.y < 0) vel.y = 0;
      res.onGround = true;
    }
    const boxes = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._tmp || (this._tmp = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const b of boxes) {
        const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
        const cy = Math.max(b.min.y, Math.min(pos.y, b.max.y));
        const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
        let dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let nx, ny, nz, push;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d; push = r - d;
        } else {
          // centre inside the box: exit via the closest face
          const faces = [
            [pos.x - b.min.x, -1, 0, 0], [b.max.x - pos.x, 1, 0, 0],
            [pos.y - b.min.y, 0, -1, 0], [b.max.y - pos.y, 0, 1, 0],
            [pos.z - b.min.z, 0, 0, -1], [b.max.z - pos.z, 0, 0, 1],
          ];
          faces.sort((a, c) => a[0] - c[0]);
          [push, nx, ny, nz] = faces[0];
          push += r;
        }
        pos.x += nx * push; pos.y += ny * push; pos.z += nz * push;
        if (vel) {
          const vn = vel.x * nx + vel.y * ny + vel.z * nz;
          if (vn < 0) { vel.x -= vn * nx; vel.y -= vn * ny; vel.z -= vn * nz; }
        }
        res.box = b;
        if (ny > 0.7) { res.onGround = true; res.groundBox = b; }
        else if (ny < -0.7) res.hitCeiling = true;
        else { res.onWall = true; res.wallBox = b; res.wallNormal.set(nx, 0, nz).normalize(); }
      }
    }
    return res;
  }

  /**
   * Resolve a vertical capsule standing at feet position `feet` (height h, radius r).
   * Uses three spheres; returns merged result.
   */
  resolveCapsule(feet, r, h, vel) {
    const out = { onGround: false, onWall: false, wallNormal: new THREE.Vector3(), hitCeiling: false, box: null, wallBox: null, groundBox: null };
    const offsets = [r, Math.max(r, h * 0.5), Math.max(r, h - r)];
    for (const o of offsets) {
      _v.set(feet.x, feet.y + o, feet.z);
      const res = this.resolveSphere(_v, r, vel);
      feet.set(_v.x, _v.y - o, _v.z);
      if (res.onGround && o === offsets[0]) { out.onGround = true; out.groundBox = res.groundBox; }
      if (res.hitCeiling && o === offsets[2]) out.hitCeiling = true;
      if (res.onWall) { out.onWall = true; out.wallNormal.copy(res.wallNormal); out.wallBox = res.wallBox; }
      if (res.box) out.box = res.box;
    }
    return out;
  }

  /** Ray vs boxes + ground. dir must be normalised. Returns { point, normal, distance, box } or null. */
  raycast(origin, dir, maxDist = 500, { ignoreGround = false } = {}) {
    let best = null, bestT = maxDist;
    if (!ignoreGround && dir.y < -1e-6) {
      const t = (this.groundY - origin.y) / dir.y;
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = { point: origin.clone().addScaledVector(dir, t), normal: new THREE.Vector3(0, 1, 0), distance: t, box: null };
      }
    }
    // Walk the ray through grid cells, testing boxes found along the way.
    const step = this.cell * 0.5;
    const stamp = ++this._stamp;
    const steps = Math.ceil(maxDist / step) + 1;
    for (let i = 0; i <= steps; i++) {
      const t0 = i * step;
      if (t0 > bestT + this.cell) break;
      const px = origin.x + dir.x * t0, pz = origin.z + dir.z * t0;
      const list = this.grid.get(this._key(Math.floor(px / this.cell), Math.floor(pz / this.cell)));
      if (!list) continue;
      for (const b of list) {
        if (b._seen === stamp) continue;
        b._seen = stamp;
        const hit = rayBox(origin, dir, b, bestT);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          best = { point: origin.clone().addScaledVector(dir, hit.t), normal: hit.normal, distance: hit.t, box: b };
        }
      }
      // also check neighbouring cells so diagonal rays don't skip thin boxes
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const l2 = this.grid.get(this._key(Math.floor(px / this.cell) + ox, Math.floor(pz / this.cell) + oz));
        if (!l2) continue;
        for (const b of l2) {
          if (b._seen === stamp) continue;
          b._seen = stamp;
          const hit = rayBox(origin, dir, b, bestT);
          if (hit && hit.t < bestT) {
            bestT = hit.t;
            best = { point: origin.clone().addScaledVector(dir, hit.t), normal: hit.normal, distance: hit.t, box: b };
          }
        }
      }
    }
    return best;
  }

  /** Line of sight test between two points. */
  lineOfSight(a, b) {
    const d = _v.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    const dir = d.clone().divideScalar(len);
    const hit = this.raycast(a, dir, len, { ignoreGround: true });
    return !hit || hit.distance >= len - 0.05;
  }

  /** Height of the highest walkable surface under (x, z) at or below maxY. */
  heightAt(x, z, maxY = Infinity) {
    let h = this.groundY;
    for (const b of this.query(x, z, x, z)) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= maxY && b.max.y > h) h = b.max.y;
    }
    return h;
  }

  /** Is the point inside any box? */
  inside(p) {
    for (const b of this.query(p.x, p.z, p.x, p.z)) {
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return b;
    }
    return null;
  }
}

function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, nAxis = -1, nSign = 0;
  const mins = [b.min.x, b.min.y, b.min.z], maxs = [b.max.x, b.max.y, b.max.z];
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ds[a]) < 1e-9) {
      if (os[a] < mins[a] || os[a] > maxs[a]) return null;
      continue;
    }
    const inv = 1 / ds[a];
    let t1 = (mins[a] - os[a]) * inv, t2 = (maxs[a] - os[a]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return null; // origin inside the box
  const normal = new THREE.Vector3();
  normal.setComponent(nAxis, nSign);
  return { t: tmin, normal };
}
