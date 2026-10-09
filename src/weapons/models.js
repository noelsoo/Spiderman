// Procedural gun meshes, 2D shop icons (from the same part lists), storefront markers and cash bundles.
import * as THREE from 'three';

const MAT_DEF = {
  M: { c: 0x2b2e36, m: 0.85, r: 0.38 }, D: { c: 0x14161b, m: 0.6, r: 0.5 }, G: { c: 0x4a505c, m: 0.85, r: 0.3 },
  W: { c: 0x7a4a24, m: 0.0, r: 0.75 }, O: { c: 0x4d5a2f, m: 0.3, r: 0.6 }, R: { c: 0xc0262d, m: 0.3, r: 0.5 },
  X: { c: 0xe9ecf2, m: 0.1, r: 0.55 },
};
const SVG_COL = { M: '#7d8596', D: '#454b58', G: '#a3abbb', W: '#a8683a', O: '#7d9248', R: '#e5424b', X: '#f4f6fb', L: '#74dcff' };

const matCache = new Map();
function material(key, accent) {
  const id = key === 'A' ? 'A' + accent : key;
  let m = matCache.get(id);
  if (m) return m;
  if (key === 'L') m = new THREE.MeshBasicMaterial({ color: 0x6fe0ff, toneMapped: false });
  else if (key === 'A') m = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.45, metalness: 0.3, emissive: accent, emissiveIntensity: 0.55 });
  else { const d = MAT_DEF[key] || MAT_DEF.M; m = new THREE.MeshStandardMaterial({ color: d.c, metalness: d.m, roughness: d.r }); }
  matCache.set(id, m);
  return m;
}

/** Gun mesh: grip at the origin, barrel along +Z. userData.muzzle is an Object3D at the barrel tip. */
export function buildGunMesh(def) {
  const g = new THREE.Group();
  g.name = 'gun:' + def.id;
  const body = new THREE.Group(); g.add(body);
  for (const [shape, z0, z1, y0, y1, mk, th, rot = 0, tip = 1] of def.parts) {
    const len = z1 - z0, h = y1 - y0, zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
    const t = th ?? Math.max(0.02, h);
    let geo;
    if (shape === 'b') geo = new THREE.BoxGeometry(t, h, len);
    else {
      const r = h / 2;
      geo = new THREE.CylinderGeometry(r * (shape === 'k' ? tip : 1), r, len, 12, 1);
      geo.rotateX(Math.PI / 2); // axis -> z, the (r*tip) end at +z
    }
    const mesh = new THREE.Mesh(geo, material(mk, def.accent));
    mesh.castShadow = false;
    if (rot) {
      // rotate about the part centre (clockwise in side view = +x rotation)
      const piv = new THREE.Group(); piv.position.set(0, yc, zc); piv.rotation.x = THREE.MathUtils.degToRad(rot);
      mesh.position.set(0, 0, 0); piv.add(mesh); body.add(piv);
    } else { mesh.position.set(0, yc, zc); body.add(mesh); }
  }
  body.scale.setScalar(def.scale ?? 1);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, def.muzzle ? def.muzzle[1] * (def.scale ?? 1) : 0.05, def.muzzle ? def.muzzle[0] * (def.scale ?? 1) : 0.3);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

/** Side-view SVG icon from the same part list. */
export function gunSvg(def, { height = 64, accent } = {}) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [, z0, z1, a, b, , , rot = 0] of def.parts) {
    const pad = rot ? Math.max(z1 - z0, b - a) * 0.3 : 0;
    x0 = Math.min(x0, z0 - pad); x1 = Math.max(x1, z1 + pad); y0 = Math.min(y0, a - pad); y1 = Math.max(y1, b + pad);
  }
  const S = 1000, pad = 0.03;
  const w = (x1 - x0 + pad * 2) * S, h = (y1 - y0 + pad * 2) * S;
  const ac = '#' + new THREE.Color(accent ?? def.accent ?? 0xffffff).getHexString();
  const px = (z) => (z - x0 + pad) * S, py = (y) => (y1 - y + pad) * S;
  let s = '';
  for (const [shape, z0, z1, a, b, mk, , rot = 0, tip = 1] of def.parts) {
    const fill = mk === 'A' ? ac : SVG_COL[mk] || '#888';
    const cx = px((z0 + z1) / 2), cy = py((a + b) / 2);
    const tf = rot ? ` transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"` : '';
    const common = `fill="${fill}" stroke="rgba(0,0,0,.55)" stroke-width="5" stroke-linejoin="round"${tf}`;
    if (shape === 'k') {
      const hh = (b - a) * S / 2;
      s += `<polygon points="${px(z0).toFixed(1)},${(cy - hh * tip).toFixed(1)} ${px(z1).toFixed(1)},${(cy - hh * tip * 0.5 - hh * 0.5 * (1 - tip)).toFixed(1)} ${px(z1).toFixed(1)},${(cy + hh * tip * 0.5 + hh * 0.5 * (1 - tip)).toFixed(1)} ${px(z0).toFixed(1)},${(cy + hh * tip).toFixed(1)}" ${common}/>`;
    } else {
      const rx = shape === 'c' ? Math.min((b - a) * S / 2, 14) : 5;
      s += `<rect x="${px(z0).toFixed(1)}" y="${py(b).toFixed(1)}" width="${((z1 - z0) * S).toFixed(1)}" height="${((b - a) * S).toFixed(1)}" rx="${rx}" ${common}/>`;
    }
  }
  const aspect = w / h;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" style="height:${height}px;width:${Math.round(height * aspect)}px" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------- cash
let cashGeo = null;
const cashMats = {};
export function buildCashBundle(big = false) {
  const g = new THREE.Group();
  cashGeo ??= {
    bill: new THREE.BoxGeometry(0.34, 0.07, 0.18),
    band: new THREE.BoxGeometry(0.1, 0.075, 0.185),
    halo: new THREE.RingGeometry(0.35, 0.55, 28).rotateX(-Math.PI / 2),
  };
  cashMats.bill ??= new THREE.MeshStandardMaterial({ color: 0x3fbf5a, roughness: 0.6, emissive: 0x1a8a38, emissiveIntensity: 0.9 });
  cashMats.band ??= new THREE.MeshStandardMaterial({ color: 0xf2f0d8, roughness: 0.7, emissive: 0x555544, emissiveIntensity: 0.4 });
  cashMats.halo ??= new THREE.MeshBasicMaterial({ color: 0x4dff8a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const n = big ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(cashGeo.bill, cashMats.bill); b.position.set(0, i * 0.075, 0); b.rotation.y = (i - 1) * 0.35;
    const band = new THREE.Mesh(cashGeo.band, cashMats.band); band.position.copy(b.position); band.rotation.y = b.rotation.y;
    g.add(b, band);
  }
  const halo = new THREE.Mesh(cashGeo.halo, cashMats.halo); halo.position.y = -0.18; halo.userData.halo = true;
  g.add(halo);
  g.scale.setScalar(big ? 1.5 : 1.15);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------- storefront
function signTexture(text, sub, color) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 256);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const col = '#' + new THREE.Color(color).getHexString();
  let fs = 128;
  x.font = `900 ${fs}px "Arial Black", Impact, sans-serif`;
  while (x.measureText(text).width > 960 && fs > 40) { fs -= 6; x.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; }
  x.shadowColor = col; x.shadowBlur = 36; x.fillStyle = col; x.fillText(text, 512, 104);
  x.shadowBlur = 12; x.fillStyle = '#fff'; x.fillText(text, 512, 104);
  x.shadowBlur = 14; x.shadowColor = '#fff'; x.fillStyle = '#e8f6ff'; x.font = '700 50px "Segoe UI", Arial, sans-serif';
  x.fillText(sub, 512, 212);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function beaconTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

/**
 * Storefront with neon sign, floating gun hologram and a tall light column.
 * Local frame: origin = entrance point on the ground, +Z = toward the street (where the player stands).
 * Returns { group, spin(t, dt) }.
 */
export function buildStorefront(name, defs, color = 0xff7a2c) {
  const g = new THREE.Group();
  g.name = 'shop:' + name;
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3, ...o });
  const glow = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, ...o });
  const dark = std(0x16181f), steel = std(0x2d313c, { metalness: 0.8, roughness: 0.4 }), wall = std(0x1e2430);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  add(new THREE.BoxGeometry(8, 0.12, 5.4), dark, 0, 0.06, -2.1);                       // pad
  add(new THREE.BoxGeometry(6.6, 3.5, 0.3), wall, 0, 1.75, -4.5);                      // back wall
  add(new THREE.BoxGeometry(0.3, 3.5, 3.2), wall, -3.15, 1.75, -2.9);                  // side walls
  add(new THREE.BoxGeometry(0.3, 3.5, 3.2), wall, 3.15, 1.75, -2.9);
  add(new THREE.BoxGeometry(7.4, 0.28, 4.6), steel, 0, 3.64, -2.5);                    // roof
  add(new THREE.BoxGeometry(7.4, 0.12, 0.12), glow(color), 0, 3.46, 0.02);             // awning neon edge
  add(new THREE.BoxGeometry(6.2, 1.0, 0.8), steel, 0, 0.62, -1.35);                    // counter
  add(new THREE.BoxGeometry(6.0, 0.06, 0.7), glow(color), 0, 1.15, -1.35);             // counter top glow
  for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(0.08, 2.6, 0.06), glow(color, { transparent: true, opacity: 0.55 }), i * 1.2, 1.8, -4.33);

  // guns on the back wall
  const rack = [0, 1, 2, 3, 4, 6].map((i) => defs[i]).filter(Boolean);
  rack.forEach((d, i) => {
    const m = buildGunMesh(d);
    const col = i % 3, row = (i / 3) | 0, sc = 1.15;
    const holder = new THREE.Group(); holder.position.set(-1.9 + col * 1.9, 2.55 - row * 0.85, -4.25);
    m.scale.setScalar(sc); m.rotation.y = Math.PI / 2; m.position.x = -(d.muzzle?.[0] ?? 0.4) * 0.45 * sc;
    holder.add(m); g.add(holder);
  });

  // neon sign above the roof
  const tex = signTexture(name.toUpperCase(), 'GUNS  -  AMMO  -  GEAR', color);
  const sign = add(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }), 0, 4.75, -2.2);
  add(new THREE.BoxGeometry(6.6, 1.7, 0.1), dark, 0, 4.75, -2.27);
  add(new THREE.BoxGeometry(0.15, 1.2, 0.15), steel, -2.4, 4.0, -2.3); add(new THREE.BoxGeometry(0.15, 1.2, 0.15), steel, 2.4, 4.0, -2.3);

  // floating gun hologram
  const holo = new THREE.Group(); holo.position.set(0, 7.2, -2.2); g.add(holo);
  const hd = defs[3] || defs[0], hg = buildGunMesh(hd), hs = 2.6;
  hg.scale.setScalar(hs); hg.rotation.y = Math.PI / 2; hg.position.x = -(hd.muzzle?.[0] ?? 0.4) * 0.45 * hs;
  holo.add(hg);
  const ringM = glow(color, { transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.62, 48).rotateX(-Math.PI / 2), ringM); ring.position.y = -0.9; holo.add(ring);

  // light column
  const btex = beaconTexture();
  const beamM = new THREE.MeshBasicMaterial({ map: btex, color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 150, 20, 1, true), beamM); beam.position.set(0, 75, -2.2); beam.frustumCulled = false; g.add(beam);
  const beamM2 = beamM.clone(); beamM2.opacity = 0.25;
  const beam2 = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 150, 20, 1, true), beamM2); beam2.position.copy(beam.position); beam2.frustumCulled = false; g.add(beam2);

  // entrance ring
  const entM = glow(color, { transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ent = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 40).rotateX(-Math.PI / 2), entM); ent.position.y = 0.16; g.add(ent);
  const entFill = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40).rotateX(-Math.PI / 2), glow(color, { transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })); entFill.position.y = 0.15; g.add(entFill);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    group: g,
    spin(t) {
      holo.rotation.y = t * 0.9; holo.position.y = 7.2 + Math.sin(t * 1.6) * 0.25;
      ent.scale.setScalar(1 + Math.sin(t * 3) * 0.06); entM.opacity = 0.55 + Math.sin(t * 3) * 0.25;
      beamM.opacity = 0.62 + Math.sin(t * 2.2) * 0.12;
      sign.material.opacity = 0.9 + Math.sin(t * 9.0) * 0.04;
    },
  };
}
