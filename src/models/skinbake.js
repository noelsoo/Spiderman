// Bakes the many small rigid meshes of a ProcModel into a few SkinnedMeshes (one per material group), so an enemy costs
// a handful of draw calls instead of ~40. Each source mesh is rigidly bound (weight 1) to the joint it hangs from, so
// the existing rig, animation, tint (model.setTint swaps the material of every registered part) and hooks keep working.
// Meshes not registered with model.reg (tendrils, tongues, overlays other code attaches) are left untouched.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const _v = new V3(), _n = new V3(), _n3 = new THREE.Matrix3(), _c = new THREE.Color();

/**
 * @param model  ProcModel just built (call before snap(), rig in canonical pose)
 * @param opts   { unify: { test(mat)->bool, material, } }  materials passing test are merged into one vertex-coloured
 *               material (vertex colour = source material colour); everything else merges per original material.
 */
export function bakeSkinned(model, opts = {}) {
  if (model.variants || globalThis.__NOBAKE) return model;
  const rig = model.rig, joints = rig.joints;
  rig.group.updateMatrixWorld(true);
  const gInv = rig.group.matrixWorld.clone().invert();
  const jIndex = new Map(); joints.forEach((j, i) => jIndex.set(j, i));
  const bind = joints.map((j) => j.matrixWorld.clone());
  const inv = bind.map((m) => m.clone().invert());
  const groups = new Map(), keep = [];
  const unis = [].concat(opts.unify || []);
  for (const m of model.parts) {
    const g = m.geometry;
    if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || Array.isArray(m.material) || !g?.attributes?.position || m.userData.noBake) { keep.push(m); continue; }
    let p = m.parent, bi = -1;
    while (p && bi < 0) { if (jIndex.has(p)) bi = jIndex.get(p); else p = p.parent; }
    if (bi < 0) { keep.push(m); continue; }
    const mat = m.userData.mat || m.material;
    const un = unis.find((u) => u.test(mat)) || null;
    const key = un ? 'U' + unis.indexOf(un) : mat.uuid;
    let gr = groups.get(key);
    if (!gr) { gr = { mat: un ? un.material : mat, un: !!un, cast: false, list: [] }; groups.set(key, gr); }
    gr.cast = gr.cast || m.castShadow;
    gr.list.push({ m, bi });
  }
  const out = [];
  for (const gr of groups.values()) {
    let nv = 0, ni = 0;
    for (const { m } of gr.list) { const g = m.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), sIdx = new Uint16Array(nv * 4), sW = new Float32Array(nv * 4), idx = new Uint32Array(ni);
    const useCol = gr.un || gr.list.some(({ m }) => m.geometry.attributes.color);
    const col = useCol ? new Float32Array(nv * 3).fill(1) : null;
    let vo = 0, io = 0;
    for (const { m, bi } of gr.list) {
      m.updateWorldMatrix(true, false);
      const mw = new THREE.Matrix4().multiplyMatrices(gInv, m.matrixWorld);
      _n3.getNormalMatrix(mw);
      const g = m.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ca = g.attributes.color;
      if (gr.un) _c.copy((m.userData.mat || m.material).color || _c.set(0xffffff));
      for (let i = 0; i < pa.count; i++) {
        const o = vo + i;
        _v.fromBufferAttribute(pa, i).applyMatrix4(mw); pos[o * 3] = _v.x; pos[o * 3 + 1] = _v.y; pos[o * 3 + 2] = _v.z;
        if (na) _n.fromBufferAttribute(na, i).applyMatrix3(_n3).normalize(); else _n.set(0, 1, 0);
        nor[o * 3] = _n.x; nor[o * 3 + 1] = _n.y; nor[o * 3 + 2] = _n.z;
        if (ua) { uv[o * 2] = ua.getX(i); uv[o * 2 + 1] = ua.getY(i); }
        sIdx[o * 4] = bi; sW[o * 4] = 1;
        if (col) {
          let r = 1, gg = 1, b = 1;
          if (gr.un) { r = _c.r; gg = _c.g; b = _c.b; }
          if (ca) { r *= ca.getX(i); gg *= ca.getY(i); b *= ca.getZ(i); }
          col[o * 3] = r; col[o * 3 + 1] = gg; col[o * 3 + 2] = b;
        }
      }
      if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo; } else for (let i = 0; i < pa.count; i++) idx[io++] = vo + i;
      vo += pa.count;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    bg.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4)); bg.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
    bg.setIndex(new THREE.BufferAttribute(idx, 1));
    out.push({ bg, gr });
  }
  // remove the sources
  for (const gr of groups.values()) for (const { m } of gr.list) { m.removeFromParent(); }
  model.parts = keep;
  const skel = new THREE.Skeleton(joints, inv);
  for (const { bg, gr } of out) {
    const mesh = new THREE.SkinnedMesh(bg, gr.mat);
    rig.group.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skel, new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new V3(0, rig.height * 0.5, 0), rig.height * 0.8);
    mesh.frustumCulled = true;
    model.reg(mesh, null, { cast: gr.cast });
    mesh.userData.mat = gr.mat;
    mesh.userData.baked = true;
  }
  model.bakedDraws = out.length;
  return model;
}
