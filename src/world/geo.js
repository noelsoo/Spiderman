// Tiny non-indexed geometry accumulator used to merge city geometry per material.
import * as THREE from 'three';

export const WHITE = [1, 1, 1];
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();
let _cyl = null;
const cylBase = () => (_cyl ||= new THREE.CylinderGeometry(1, 1, 1, 5, 1, false).toNonIndexed());

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Bucket {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  get empty() { return this.p.length === 0; }

  /** a,b,c,d counter-clockwise seen from outside; uv: a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1) */
  quad(a, b, c, d, nx, ny, nz, u0, v0, u1, v1, col = WHITE) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let i = 0; i < 6; i++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    this.u.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }

  /** four side faces; u in units of 1/tw along the face, v = y / th. */
  walls(x0, y0, z0, x1, y1, z1, tw, th, uOff = 0, col = WHITE) {
    const w = (x1 - x0) / tw, d = (z1 - z0) / tw, v0 = y0 / th, v1 = y1 / th;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, uOff, v0, uOff + w, v1, col);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, uOff, v0, uOff + w, v1, col);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, uOff, v0, uOff + d, v1, col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, uOff, v0, uOff + d, v1, col);
  }

  top(x0, z0, x1, z1, y, s = 8, col = WHITE) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, x0 / s, z1 / s, x1 / s, z0 / s, col);
  }

  bottom(x0, z0, x1, z1, y, s = 8, col = WHITE) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], 0, -1, 0, x0 / s, z0 / s, x1 / s, z1 / s, col);
  }

  boxAll(x0, y0, z0, x1, y1, z1, s = 4, col = WHITE) {
    this.walls(x0, y0, z0, x1, y1, z1, s, s, 0, col);
    this.top(x0, z0, x1, z1, y1, s, col);
  }

  /** full closed box (with bottom) */
  boxClosed(x0, y0, z0, x1, y1, z1, s = 4, col = WHITE) {
    this.boxAll(x0, y0, z0, x1, y1, z1, s, col);
    this.bottom(x0, z0, x1, z1, y0, s, col);
  }

  /** append any (indexed or not) geometry with position/normal/uv, transformed by matrix. */
  addGeo(geo, matrix, col = WHITE) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
      this.u.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.c.push(col[0], col[1], col[2]);
    }
  }

  /** thin 5-sided cylinder between two points */
  cylBetween(a, b, r, col = WHITE) {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.divideScalar(len);
    _q.setFromUnitVectors(_up, _dir);
    _mid.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _scl.set(r, len, r);
    _mat.compose(_mid, _q, _scl);
    this.addGeo(cylBase(), _mat, col);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Spatially chunked buckets: one merged Mesh per (chunk, material). */
export class ChunkSet {
  constructor(size = 300) { this.size = size; this.map = new Map(); }
  bucket(x, z, name) {
    if (name === 'prop') name = 'roof';
    const k = Math.floor((x + 3000) / this.size) * 1000 + Math.floor((z + 3000) / this.size);
    let e = this.map.get(k);
    if (!e) { e = {}; this.map.set(k, e); }
    return (e[name] ||= new Bucket());
  }
  /** returns meshes added to group */
  build(group, mats, { cast = true, receive = true, skipCast = [] } = {}) {
    let n = 0;
    for (const e of this.map.values()) {
      for (const [name, b] of Object.entries(e)) {
        if (b.empty) continue;
        const m = new THREE.Mesh(b.toGeometry(), mats[name]);
        m.castShadow = cast && !skipCast.includes(name);
        m.receiveShadow = receive;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        group.add(m);
        n++;
      }
    }
    return n;
  }
}
