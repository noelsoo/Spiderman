// ChunkSet variant with a per-material chunk size: tall glass towers stay in small chunks (good culling / shadow culling),
// flat ground-level stuff (roads, markings, paving, lights) is merged into much bigger chunks to save draw calls.
import * as THREE from 'three';
import { Bucket } from '../geo.js';

const SIZES = { road: 1100, markings: 1100, sidewalk: 800, grass: 800, pond: 2400, street: 800, night: 1100, beacon: 2400, prop: 900, pool: 4000, white: 800 };

export class SgChunks {
  constructor(base = 500) { this.base = base; this.map = new Map(); }
  bucket(x, z, name) {
    if (name === 'prop') name = 'roof';
    const s = SIZES[name] || this.base;
    const k = `${name}:${Math.floor((x + 3000) / s)}:${Math.floor((z + 3000) / s)}`;
    let b = this.map.get(k);
    if (!b) { b = new Bucket(); b.matName = name; this.map.set(k, b); }
    return b;
  }
  build(group, mats, { cast = true, receive = true, skipCast = [] } = {}) {
    let n = 0;
    for (const b of this.map.values()) {
      if (b.empty) continue;
      const name = b.matName;
      const m = new THREE.Mesh(b.toGeometry(), mats[name]);
      m.castShadow = cast && !skipCast.includes(name);
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
      n++;
    }
    return n;
  }
}
