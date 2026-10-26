// Merlion fish body: one smooth tapered tube lofted along the curl curve, with a procedural overlapping-scale texture
// and normal map, a forked tail fluke and a spiky dorsal fin. All in the statue's local (u forward, v lateral, y up) frame.
import * as THREE from 'three';

const TAU = Math.PI * 2;

/** Overlapping fish scales. Returns { map, normalMap } canvas textures (tileable). */
export function makeScaleTextures(size = 512, cols = 8, quality = 'high') {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return [c, c.getContext('2d', { willReadFrequently: true })]; };
  const [hc, hx] = mk(), [ac, ax] = mk();
  hx.fillStyle = '#202020'; hx.fillRect(0, 0, size, size);
  ax.fillStyle = '#d9dbdd'; ax.fillRect(0, 0, size, size);
  const cw = size / cols, rows = cols * 2;               // rows overlap by half a scale height
  const rh = size / rows;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = -1; j < rows + 1; j++) {
    for (let i = -1; i < cols + 1; i++) {
      const cx = (i + (j & 1 ? 0.5 : 0)) * cw + cw * 0.5, cy = j * rh + rh * 0.5, R = cw * 0.62;
      const tint = 232 + Math.floor(rnd() * 20);
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        const x = cx + ox, y = cy + oy;
        if (x < -R || x > size + R || y < -R || y > size + R) continue;
        // height: low in the middle of the covered top, rising to a rim at the exposed lower edge
        const g = hx.createRadialGradient(x, y - R * 0.35, R * 0.1, x, y, R);
        g.addColorStop(0, '#585858'); g.addColorStop(0.6, '#9a9a9a'); g.addColorStop(0.92, '#f4f4f4'); g.addColorStop(1, '#303030');
        hx.fillStyle = g; hx.beginPath(); hx.arc(x, y, R, 0, Math.PI, false); hx.lineTo(x - R, y - R); hx.lineTo(x + R, y - R); hx.closePath();
        hx.fill();
        hx.beginPath(); hx.arc(x, y, R, 0, TAU); hx.fill();
        // albedo: faint rim shading and per-scale tint
        const a = ax.createRadialGradient(x, y - R * 0.3, R * 0.1, x, y, R);
        a.addColorStop(0, `rgb(${tint - 6},${tint - 4},${tint})`); a.addColorStop(0.75, `rgb(${tint},${tint + 1},${tint + 2})`); a.addColorStop(0.95, `rgb(${tint - 22},${tint - 20},${tint - 16})`); a.addColorStop(1, `rgb(${tint - 60},${tint - 58},${tint - 54})`);
        ax.fillStyle = a; ax.beginPath(); ax.arc(x, y, R, 0, TAU); ax.fill();
      }
    }
  }
  // height -> normal map (Sobel, wrapping)
  const src = hx.getImageData(0, 0, size, size).data;
  const out = ax.createImageData(size, size), o = out.data;
  const H = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  const k = quality === 'low' ? 2.5 : 4.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * k, ny = dy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const p = (y * size + x) * 4;
    o[p] = (nx * 0.5 + 0.5) * 255; o[p + 1] = (ny * 0.5 + 0.5) * 255; o[p + 2] = (nz * 0.5 + 0.5) * 255; o[p + 3] = 255;
  }
  const [nc, nxc] = mk(); nxc.putImageData(out, 0, 0);
  const map = new THREE.CanvasTexture(ac), normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap };
}

/**
 * Build the body meshes. `spine` is a CatmullRomCurve3 in (u, y, 0). `toWorld(u, v)` -> [x, z].
 * Returns { group, mat, samples } where samples are the spine points with radii (for collision boxes).
 */
export function buildMerlionBody(spine, toWorld, radiusAt, quality = 'high') {
  const low = quality === 'low';
  const { map, normalMap } = makeScaleTextures(low ? 256 : 512, 8, quality);
  const mat = low
    ? new THREE.MeshLambertMaterial({ color: 0xf1f1ee, map })
    : new THREE.MeshStandardMaterial({ color: 0xf3f3f0, map, normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
  mat.side = THREE.DoubleSide;
  const group = new THREE.Group();
  const N = low ? 48 : 96, M = low ? 20 : 36;
  const len = spine.getLength();
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  const pos = [], uv = [], idx = [];
  const ring = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N; spine.getPointAt(t, P); spine.getTangentAt(t, T);
    const nx = -T.y, ny = T.x;                   // in-plane normal: outer side of the curl (the fish's back)
    const r = radiusAt(t);
    ring.push({ t, u: P.x, y: P.y, nx, ny, r, tx: T.x, ty: T.y });
    for (let j = 0; j <= M; j++) {
      const a = j / M * TAU, c = Math.cos(a), s = Math.sin(a);
      // slightly flattened sides and a little extra on the back for a proper fish section
      const rr = r * (1 + 0.05 * Math.max(0, c));
      const u = P.x + nx * c * rr, y = P.y + ny * c * rr, v = s * r * 0.96;
      const [x, z] = toWorld(u, v);
      pos.push(x, y, z);
      uv.push(j / M * 3, t * len / 3.4);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // end caps (fan to a centre vertex)
  const cap = (i, flip) => {
    const rg = ring[i]; const [cx, cz] = toWorld(rg.u, 0);
    const ci = pos.length / 3; pos.push(cx, rg.y, cz); uv.push(1.5, rg.t * len / 3.4);
    for (let j = 0; j < M; j++) { const a = i * (M + 1) + j; if (flip) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1); }
  };
  cap(0, false); cap(N, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // check orientation: normals should point away from the spine; flip winding if not
  {
    const nr = geo.attributes.normal, ps = geo.attributes.position; const rg = ring[Math.floor(N / 2)];
    const k = Math.floor(N / 2) * (M + 1);
    const [cx, cz] = toWorld(rg.u, 0);
    const dx = ps.getX(k) - cx, dy = ps.getY(k) - rg.y, dz = ps.getZ(k) - cz;
    if (dx * nr.getX(k) + dy * nr.getY(k) + dz * nr.getZ(k) < 0) {
      const ix = geo.index.array; for (let q = 0; q < ix.length; q += 3) { const tmp = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = tmp; }
      geo.computeVertexNormals();
    }
  }
  // weld the UV seam normals
  {
    const nr = geo.attributes.normal;
    for (let i = 0; i <= N; i++) {
      const a = i * (M + 1), b = a + M;
      const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1;
      nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
    }
  }
  const body = new THREE.Mesh(geo, mat); body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
  group.add(body);

  // ---- ribbon helper: grid of (a in [0,1], b in [0,1]) -> world, double sided, shares the scale material -------------------
  const grid = (na, nb, f, uvs = [4, 4]) => {
    const p = [], q = [], ix = [];
    for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
      const [u, v, y] = f(i / na, j / nb); const [x, z] = toWorld(u, v);
      p.push(x, y, z); q.push(i / na * uvs[0], j / nb * uvs[1]);
    }
    for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) { const a = i * (nb + 1) + j, b = a + nb + 1; ix.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(q, 2));
    g.setIndex(ix); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); return m;
  };

  // ---- dorsal fin: a scalloped sail along the back (outer side of the curl) --------------------------------------------------
  {
    const t0 = 0.22, t1 = 0.9, spikes = 9;
    const tmp = new THREE.Vector3(), tg = new THREE.Vector3();
    grid(spikes * 8, 3, (a, b) => {
      const t = t0 + (t1 - t0) * a; spine.getPointAt(t, tmp); spine.getTangentAt(t, tg);
      const nx = -tg.y, ny = tg.x, r = radiusAt(t) * 1.04;
      const ph = (a * spikes) % 1, saw = ph < 0.8 ? ph / 0.8 : (1 - ph) / 0.2;            // swept-back spikes
      const hgt = (0.35 + 0.65 * saw) * (0.4 + 1.0 * Math.sin(Math.PI * Math.min(1, a * 1.05))) * (1.7 - t * 0.9);
      const o = r * 0.85 + hgt * b * 1.6;
      return [tmp.x + nx * o - tg.x * b * 0.5 * hgt, 0.0 + (b - 0.5) * 0.14 * (1 - b), tmp.y + ny * o - tg.y * b * 0.5 * hgt].map((v, k) => v);
    }, [spikes * 2, 1]);
  }
  return { group, mat, ring, len };
}

/** Forked tail fluke at the end of the spine. */
export function buildFluke(spine, toWorld, mat, group) {
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  spine.getPointAt(1, P); spine.getTangentAt(1, T);
  const nx = -T.y, ny = T.x;
  const SPAN = 5.6, LEN = 5.4;
  const grid = (na, nb, f) => {
    const p = [], q = [], ix = [];
    for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
      const [u, v, y] = f(-1 + 2 * i / na, j / nb); const [x, z] = toWorld(u, v);
      p.push(x, y, z); q.push(i / na * 3, j / nb * 3);
    }
    for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) { const a = i * (nb + 1) + j, b = a + nb + 1; ix.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(q, 2));
    g.setIndex(ix); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m);
  };
  // a in [-1, 1] across, b in [0, 1] from the peduncle to the trailing edge; two lobes with a central notch, tips swept back
  grid(24, 8, (a, b) => {
    const aa = Math.abs(a);
    const trail = LEN * (0.28 + 0.72 * Math.pow(Math.sin(Math.min(1, aa * 1.0) * Math.PI * 0.5), 0.8)) * (aa > 0.97 ? 1 : 1);
    const along = b * trail;
    const wide = SPAN * a * (0.12 + 0.88 * Math.pow(b, 0.8)) * (1 - 0.15 * b * (1 - aa));
    const cup = 0.45 * aa * aa * b;                       // lobes curve up and back
    const u = P.x + T.x * along + nx * (cup * 0.8), y = P.y + T.y * along + ny * (cup * 0.8);
    return [u, wide, y];
  });
}
