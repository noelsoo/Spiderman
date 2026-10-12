// Tile LOD: every 400 m tile owns its detailed meshes (textured walls, roofs, props, markings...) and ONE merged far mesh
// (vertex-coloured boxes on a tiny window atlas). Detailed meshes show near the camera, the far mesh everywhere else.
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
  }
}
