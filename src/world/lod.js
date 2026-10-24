// Tile LOD: every 400 m tile owns its detailed meshes (textured walls, roofs, props, markings...) and ONE merged far mesh
// (vertex-coloured boxes on a tiny window atlas). Detailed meshes show near the camera, the far mesh everywhere else.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SUPER = 3;   // far meshes of 3x3 tiles are also merged into one mesh, drawn when every tile in the block is far (about 9x fewer far draw calls)

export class TileLOD {
  constructor(nearTiles, farTiles, { nearR = 560, hyst = 60 } = {}) {
    this.nearR = nearR; this.hyst = hyst;
    this.tiles = new Map();
    for (const t of nearTiles) this.tiles.set(t.key, { x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1, near: t.meshes, far: [], mode: -1 });
    for (const t of farTiles) {
      let e = this.tiles.get(t.key);
      if (!e) { e = { x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1, near: [], far: [], mode: -1 }; this.tiles.set(t.key, e); }
      e.far = t.meshes;
    }
    this.list = [...this.tiles.values()];
    this.nearTiles = 0;
    this._buildSupers(farTiles);
  }

  /** one merged far mesh per SUPER x SUPER block of tiles (shares the far material; the per-tile far meshes stay for the mixed case) */
  _buildSupers(farTiles) {
    this.supers = [];
    const blocks = new Map();
    for (const t of farTiles) {
      if (!t.meshes.length) continue;
      const ix = Math.floor(t.key / 1000), iz = t.key % 1000;
      const k = Math.floor(ix / SUPER) * 1000 + Math.floor(iz / SUPER);
      let b = blocks.get(k);
      if (!b) { b = []; blocks.set(k, b); }
      b.push(t);
    }
    for (const tiles of blocks.values()) {
      if (tiles.length < 2) continue;
      const byMat = new Map();
      for (const t of tiles) for (const m of t.meshes) { const a = byMat.get(m.material) || []; a.push(m); byMat.set(m.material, a); }
      const meshes = [], parent = tiles[0].meshes[0].parent;
      for (const [mat, list] of byMat) {
        let geo;
        try { geo = mergeGeometries(list.map((m) => m.geometry), false); } catch { geo = null; }
        if (!geo) continue;
        const sm = new THREE.Mesh(geo, mat);
        sm.matrixAutoUpdate = false; sm.castShadow = false; sm.receiveShadow = list[0].receiveShadow; sm.visible = false;
        parent?.add(sm);
        meshes.push(sm);
      }
      if (!meshes.length) continue;
      this.supers.push({ meshes, entries: tiles.map((t) => this.tiles.get(t.key)), on: false });
    }
  }

  /** Switch tiles by distance from the camera (XZ distance to the tile rectangle). */
  update(cam) {
    const cx = cam.x, cz = cam.z;
    let nn = 0;
    for (const e of this.list) {
      const dx = cx < e.x0 ? e.x0 - cx : cx > e.x1 ? cx - e.x1 : 0, dz = cz < e.z0 ? e.z0 - cz : cz > e.z1 ? cz - e.z1 : 0;
      const d = Math.sqrt(dx * dx + dz * dz);
      const mode = d < this.nearR + (e.mode === 1 ? this.hyst : 0) ? 1 : 0;
      if (mode) nn++;
      if (mode === e.mode) continue;
      e.mode = mode;
      for (const m of e.near) m.visible = !!mode;
      for (const m of e.far) m.visible = !mode || e.near.length === 0;
    }
    this.nearTiles = nn;
    for (const sp of this.supers) {
      let all = true;
      for (const e of sp.entries) if (e.mode !== 0 && e.near.length) { all = false; break; }
      if (all !== sp.on) { sp.on = all; for (const m of sp.meshes) m.visible = all; }
      for (const e of sp.entries) for (const m of e.far) m.visible = all ? false : e.mode === 0 || e.near.length === 0;
    }
  }
}
