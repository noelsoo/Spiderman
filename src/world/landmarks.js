// Hand-built landmarks: Avengers Tower, Empire-State-style spire, suspension bridge.
import * as THREE from 'three';
import { STYLES } from './materials.js';
import { emitTier, addBox, L, colX, rowZ, streetZ } from './city.js';

const snapTo = (v, m) => Math.round(v / m) * m;

function glowRing(ctx, x0, z0, x1, z1, y, h, col) {
  const g = ctx.glow;
  g.walls(x0 - 0.25, y, z0 - 0.25, x1 + 0.25, y + h, z1 + 0.25, 1, 1, 0, col);
}

export function buildAvengersTower(ctx) {
  const tx = colX(3), tz = rowZ(4);
  const st = STYLES.glassBlue, py = st.py;
  const tiers = [
    [66, 42, 0, 28.8], [51, 36, 28.8, 108], [39, 30, 108, 216], [33, 27, 216, 284.4], [21, 21, 284.4, 306],
  ];
  const rects = [];
  tiers.forEach(([w, d, y0, y1], n) => {
    const x0 = tx - w / 2, x1 = tx + w / 2, z0 = tz - d / 2, z1 = tz + d / 2;
    emitTier(ctx, n === 0 ? 'glassSteel' : 'glassBlue', x0, y0, z0, x1, snapTo(y1, 0.1), z1, { id: 'avengers' + n, type: 'building', uOff: 0.25 * n });
    rects.push({ x0, x1, z0, z1, y0, y1 });
    if (n >= 1) glowRing(ctx, x0, z0, x1, z1, y1 - 2.0, 0.7, [1.3, 2.6, 4.6]);
  });
  const top = rects[4], up = rects[3];
  // spire
  ctx.chunks.bucket(tx, tz, 'prop').boxAll(tx - 3, 306, tz - 3, tx + 3, 336, tz + 3, 3, [0.55, 0.58, 0.64]);
  addBox(ctx, tx - 3, 306, tz - 3, tx + 3, 336, tz + 3, 'building', 'avengers_spire');
  ctx.glow.boxAll(tx - 0.6, 336, tz - 0.6, tx + 0.6, 340, tz + 0.6, 1, [6, 0.3, 0.2]);
  // vertical glow strips on the upper shaft corners
  for (const sx of [up.x0, up.x1]) for (const sz of [up.z0, up.z1]) ctx.glow.boxAll(sx - 0.5, up.y0, sz - 0.5, sx + 0.5, up.y1, sz + 0.5, 1, [1.4, 2.8, 5]);

  // AVENGERS signs on the four faces of the upper shaft
  const sb = ctx.signBucket;
  const sy0 = 246, o = 0.35;
  const uw = up.x1 - up.x0, ud = up.z1 - up.z0, cx = tx, cz = tz;
  let w = uw - 4, h = w / 4;
  sb.quad([cx - w / 2, sy0, up.z1 + o], [cx + w / 2, sy0, up.z1 + o], [cx + w / 2, sy0 + h, up.z1 + o], [cx - w / 2, sy0 + h, up.z1 + o], 0, 0, 1, 0, 0, 1, 1);
  sb.quad([cx + w / 2, sy0, up.z0 - o], [cx - w / 2, sy0, up.z0 - o], [cx - w / 2, sy0 + h, up.z0 - o], [cx + w / 2, sy0 + h, up.z0 - o], 0, 0, -1, 0, 0, 1, 1);
  w = ud - 4; h = w / 4;
  sb.quad([up.x1 + o, sy0, cz + w / 2], [up.x1 + o, sy0, cz - w / 2], [up.x1 + o, sy0 + h, cz - w / 2], [up.x1 + o, sy0 + h, cz + w / 2], 1, 0, 0, 0, 0, 1, 1);
  sb.quad([up.x0 - o, sy0, cz - w / 2], [up.x0 - o, sy0, cz + w / 2], [up.x0 - o, sy0 + h, cz + w / 2], [up.x0 - o, sy0 + h, cz - w / 2], -1, 0, 0, 0, 0, 1, 1);

  // landing pad cantilevered off the +Z face
  const padY = 240, pw = 30, pd = 24;
  const px0 = tx - pw / 2, px1 = tx + pw / 2, pz0 = up.z1, pz1 = up.z1 + pd;
  const pb = ctx.chunks.bucket(tx, pz1, 'prop');
  pb.boxClosed(px0, padY - 3, pz0, px1, padY, pz1, 3, [0.3, 0.32, 0.36]);
  for (const sx of [px0 + 1.5, px1 - 1.5]) {
    pb.cylBetween([sx, padY - 3, pz1 - 1.5], [sx, padY - 24, pz0], 0.7, [0.3, 0.32, 0.36]);
  }
  // parapet-free pad edge lights
  ctx.glow.walls(px0, padY, pz0, px1, padY + 0.3, pz1, 1, 1, 0, [1.2, 2.2, 3.5]);
  addBox(ctx, px0, padY - 3, pz0, px1, padY, pz1, 'roof', 'avengers_pad');
  const padMat = new THREE.MeshStandardMaterial({ map: ctx.T.pad, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(pw - 1, pd - 1), padMat);
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(tx, padY + 0.06, (pz0 + pz1) / 2 + 0.2);
  decal.receiveShadow = true;
  ctx.group.add(decal);

  const mid = new THREE.Vector3(tx, 340, tz);
  ctx.landmarks['Avengers Tower'] = mid;
  ctx.landmarks['Avengers Pad'] = new THREE.Vector3(tx, padY + 0.05, (pz0 + pz1) / 2);
  return { pos: new THREE.Vector3(tx, 0, tz), padPos: ctx.landmarks['Avengers Pad'] };
}

export function buildEmpireSpire(ctx) {
  const tx = colX(6), tz = rowZ(7);
  const tiers = [
    [66, 42, 0, 28], [51, 30, 28, 92], [39, 24, 92, 168], [30, 18, 168, 188], [21, 15, 188, 208], [15, 12, 208, 232], [9, 9, 232, 244],
  ];
  tiers.forEach(([w, d, y0, y1], n) => {
    const x0 = tx - w / 2, x1 = tx + w / 2, z0 = tz - d / 2, z1 = tz + d / 2;
    emitTier(ctx, 'limestone', x0, y0, z0, x1, y1, z1, { id: 'empire' + n, type: 'building', uOff: 0.125 * n, col: [1, 0.97, 0.9] });
    if (n >= 3) glowRing(ctx, x0, z0, x1, z1, y1 - 3, 1.4, [4.2, 2.3, 0.9]);
  });
  const pb = ctx.chunks.bucket(tx, tz, 'roof');
  pb.boxAll(tx - 2.5, 244, tz - 2.5, tx + 2.5, 270, tz + 2.5, 4, [0.85, 0.82, 0.75]);
  pb.boxAll(tx - 1.5, 270, tz - 1.5, tx + 1.5, 300, tz + 1.5, 4, [0.85, 0.82, 0.75]);
  addBox(ctx, tx - 2.5, 244, tz - 2.5, tx + 2.5, 270, tz + 2.5, 'building', 'empire_s1');
  addBox(ctx, tx - 1.5, 270, tz - 1.5, tx + 1.5, 300, tz + 1.5, 'building', 'empire_s2');
  ctx.chunks.bucket(tx, tz, 'prop').boxAll(tx - 0.5, 300, tz - 0.5, tx + 0.5, 336, tz + 0.5, 1, [0.6, 0.6, 0.65]);
  addBox(ctx, tx - 0.5, 300, tz - 0.5, tx + 0.5, 336, tz + 0.5, 'prop', 'empire_mast');
  ctx.glow.boxAll(tx - 2.6, 258, tz - 2.6, tx + 2.6, 262, tz + 2.6, 1, [4.5, 3.6, 2.2]);
  ctx.glow.boxAll(tx - 0.7, 336, tz - 0.7, tx + 0.7, 340, tz + 0.7, 1, [6, 0.4, 0.3]);
  ctx.landmarks['Empire Spire'] = new THREE.Vector3(tx, 340, tz);
}

export function buildBridge(ctx) {
  const zc = streetZ(9), hw = 14, y0 = 20.5, y1 = 24;
  const xa = -424, xb = -1000;
  const t1 = -505, t2 = -825;
  const STEEL = [0.2, 0.24, 0.22], STONE = [0.72, 0.62, 0.5], RAIL = [0.3, 0.32, 0.3];
  const prop = (x, z) => ctx.chunks.bucket(x, z, 'prop');
  const roofB = (x, z) => ctx.chunks.bucket(x, z, 'roof');

  // deck (visual segmented for culling, one physics box)
  for (let x = xa; x > xb; x -= 100) {
    const x2 = Math.max(x - 100, xb), mx = (x + x2) / 2;
    prop(mx, zc).boxClosed(x2, y0, zc - hw, x, y1 - 0.05, zc + hw, 4, STEEL);
    ctx.chunks.bucket(mx, zc, 'asphalt').top(x2, zc - hw + 0.4, x, zc + hw - 0.4, y1, 8, [1, 1, 1]);
    for (const s of [-1, 1]) {
      prop(mx, zc).boxAll(x2, y1, zc + s * (hw - 0.4) - 0.2, x, y1 + 1.1, zc + s * (hw - 0.4) + 0.2, 2, RAIL);
      // sidewalk strip (raised)
      ctx.chunks.bucket(mx, zc, 'sidewalk').boxAll(x2, y1 - 0.01, zc + s * (hw - 2.6) - 1.7, x, y1 + 0.2, zc + s * (hw - 2.6) + 1.7, 6, [1, 1, 1]);
    }
    const mk = ctx.chunks.bucket(mx, zc, 'markings');
    for (const s of [-1, 1]) mk.top(x2, zc + s * 0.2 - 0.12, x, zc + s * 0.2 + 0.12, y1 + 0.04, 4, [0.95, 0.72, 0.12]);
    for (const off of [-4.4, 4.4]) for (let dx = x2 + 2; dx < x - 3; dx += 9) mk.top(dx, zc + off - 0.1, dx + 3.5, zc + off + 0.1, y1 + 0.04, 4, [0.9, 0.9, 0.86]);
  }
  addBox(ctx, xb, y0, zc - hw, xa, y1, zc + hw, 'bridge', 'bridge_deck');

  // near abutment + far anchorage
  roofB(xa, zc).boxAll(xa - 12, 0, zc - 17, xa - 1, y0, zc + 17, 4, STONE);
  addBox(ctx, xa - 12, 0, zc - 17, xa - 1, y0, zc + 17, 'bridge', 'bridge_abut');
  roofB(xb, zc).boxAll(xb - 34, 0, zc - 22, xb - 2, 34, zc + 22, 4, STONE);
  addBox(ctx, xb - 34, 0, zc - 22, xb - 2, 34, zc + 22, 'bridge', 'bridge_anchor');

  // towers
  const topY = 92, line = [];
  for (const tx of [t1, t2]) {
    for (const s of [-1, 1]) {
      const z0 = zc + s * 18 - 3.5, z1 = zc + s * 18 + 3.5;
      roofB(tx, zc).boxAll(tx - 5, -6, z0, tx + 5, topY, z1, 4, STONE);
      addBox(ctx, tx - 5, -6, z0, tx + 5, topY, z1, 'bridge', 'bridge_tower');
      // flared footing
      roofB(tx, zc).boxAll(tx - 7, -6, z0 - 1.5, tx + 7, 4, z1 + 1.5, 4, STONE);
      // pointed-arch spandrels
      for (let k = 0; k < 4; k++) {
        const inner = s > 0 ? z0 : z1;
        const wd = 4 - k, yy = 66 - k * 2.4;
        roofB(tx, zc).boxAll(tx - 4, yy - 2.4, s > 0 ? inner - wd : inner, tx + 4, yy, s > 0 ? inner : inner + wd, 4, STONE);
      }
      ctx.glow.boxAll(tx - 0.5, topY, zc + s * 18 - 0.5, tx + 0.5, topY + 2, zc + s * 18 + 0.5, 1, [6, 0.3, 0.2]);
    }
    roofB(tx, zc).boxAll(tx - 4.5, 66, zc - 14.5, tx + 4.5, 74, zc + 14.5, 4, STONE);
    roofB(tx, zc).boxAll(tx - 4.5, 84, zc - 14.5, tx + 4.5, topY, zc + 14.5, 4, STONE);
    addBox(ctx, tx - 4.5, 66, zc - 14.5, tx + 4.5, 74, zc + 14.5, 'bridge', 'bridge_beam');
    addBox(ctx, tx - 4.5, 84, zc - 14.5, tx + 4.5, topY, zc + 14.5, 'bridge', 'bridge_beam');
  }

  // cables
  const cab = prop(-660, zc);
  const cableY = (xA, yA, xB, yB, u, sag) => yA + (yB - yA) * u - sag * 4 * u * (1 - u);
  const span = (xA, yA, zA, xB, yB, zB, sag, segs, s) => {
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const p = [xA + (xB - xA) * u, cableY(xA, yA, xB, yB, u, sag), zA + (zB - zA) * u];
      if (prev) cab.cylBetween(prev, p, 0.55, [0.12, 0.13, 0.12]);
      prev = p;
      if (i > 0 && i < segs && i % 2 === 0) {
        const deckZ = zc + s * (hw - 0.6);
        line.push(p[0], p[1], p[2], p[0], y1 + 1.0, deckZ);
      }
    }
  };
  for (const s of [-1, 1]) {
    const zt = zc + s * 18, zd = zc + s * (hw + 0.2);
    // main span: dips close to the deck near mid-span
    const segs = 40;
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, e = 2 * u - 1;
      const p = [t1 + (t2 - t1) * u, 32 + (topY - 3 - 32) * e * e, zc + s * (hw + 0.2 + (18 - hw - 0.2) * e * e)];
      if (prev) cab.cylBetween(prev, p, 0.6, [0.12, 0.13, 0.12]);
      if (i % 2 === 0 && i > 0 && i < segs) line.push(p[0], p[1], p[2], p[0], y1 + 1.0, zc + s * (hw - 0.6));
      prev = p;
    }
    span(t1, topY - 3, zt, xa - 1, y1 + 3, zd, 6, 14, s);
    span(t2, topY - 3, zt, xb, y1 + 3, zd, 10, 18, s);
    // diagonal stays
    for (const [tx, dir, n] of [[t1, 1, 8], [t1, -1, 3], [t2, -1, 8], [t2, 1, 3]]) {
      for (let k = 1; k <= n; k++) line.push(tx, topY - 6, zt, tx + dir * k * 18, y1 + 1.0, zc + s * (hw - 0.6));
    }
    // deck lamps
    for (let x = xa - 20; x > xb + 10; x -= 36) {
      prop(x, zc).boxAll(x - 0.12, y1, zc + s * (hw - 0.6) - 0.12, x + 0.12, y1 + 6, zc + s * (hw - 0.6) + 0.12, 1, STEEL);
      ctx.glow.boxAll(x - 0.4, y1 + 6, zc + s * (hw - 0.6) - 0.4, x + 0.4, y1 + 6.4, zc + s * (hw - 0.6) + 0.4, 1, [3.5, 2.5, 1.4]);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x9a9488 }));
  lines.frustumCulled = false;
  ctx.group.add(lines);

  ctx.landmarks['Bridge Tower'] = new THREE.Vector3(t1, topY, zc);
  ctx.landmarks['Bridge Deck'] = new THREE.Vector3(-650, y1 + 0.05, zc);
}
