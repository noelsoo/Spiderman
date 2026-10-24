// Procedural car models + instanced far-LOD. Cars face +Z, origin at the ground under the centre of the car.
// Bodies are lofted from cross-sections (rounded shoulders, tumblehome, real wheel arches), so a sedan, hatchback, SUV, sports
// car, van and minibus all have their own silhouette. A near model is 7 draw calls: paint (body + roof, one mesh), glass,
// trim (bumpers, grille, chrome, plates), lamps (head + tail, swapped for braking) and 3 wheel meshes (2 steering wheels and
// one rear axle). Door seams, arch shadows and the taxi / police liveries come from canvas atlases; clearcoat paint is only on
// the high / ultra tiers. Shared geometries / materials / atlases; no per-frame allocations.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isSg } from './traffic.js';

export const KINDS = ['sedan', 'taxi', 'suv', 'sports', 'police', 'van', 'bus'];

/** Gameplay + collision spec per kind. vmax m/s, accel m/s^2 (at standstill), brake m/s^2, grip 1 = normal. */
export const SPECS = {
  sedan:  { L: 4.7, W: 1.85, H: 1.47, wb: 2.8, wr: 0.34, ww: 0.24, vmax: 42, accel: 7.0, brake: 22, grip: 1.15, mass: 1500, hp: 100, mesh: 'sedan' },
  taxi:   { L: 4.7, W: 1.85, H: 1.47, wb: 2.8, wr: 0.34, ww: 0.24, vmax: 40, accel: 6.6, brake: 22, grip: 1.1, mass: 1550, hp: 105, mesh: 'sedan' },
  suv:    { L: 4.9, W: 2.0, H: 1.82, wb: 2.95, wr: 0.42, ww: 0.28, vmax: 38, accel: 6.0, brake: 20, grip: 1.0, mass: 2100, hp: 140, mesh: 'suv' },
  sports: { L: 4.4, W: 1.95, H: 1.29, wb: 2.65, wr: 0.35, ww: 0.32, vmax: 60, accel: 11.5, brake: 28, grip: 1.55, mass: 1300, hp: 85, mesh: 'sports' },
  police: { L: 4.9, W: 1.9, H: 1.5, wb: 2.9, wr: 0.35, ww: 0.25, vmax: 50, accel: 9.5, brake: 25, grip: 1.3, mass: 1800, hp: 130, mesh: 'sedan' },
  van:    { L: 5.4, W: 2.0, H: 2.3, wb: 3.3, wr: 0.38, ww: 0.26, vmax: 32, accel: 4.6, brake: 18, grip: 0.9, mass: 2600, hp: 150, mesh: 'van' },
  // 12 m single-deck city bus: heavy, slow to accelerate, wide turning circle
  bus:    { L: 12, W: 2.55, H: 3.15, wb: 5.9, wr: 0.5, ww: 0.3, vmax: 22, accel: 2.6, brake: 11, grip: 0.8, mass: 12000, hp: 420, mesh: 'bus' },
};
for (const k of KINDS) {
  const s = SPECS[k];
  s.R = s.W / 2 - 0.05;                       // collision sphere radius
  const reach = s.L / 2 - s.R;
  const nc = Math.max(3, Math.ceil((s.L - 2 * s.R) / (2 * s.R)) + 1);   // enough spheres to cover the length (3 for cars, 5 for the bus)
  s.cols = Array.from({ length: nc }, (_, i) => -reach + (2 * reach * i) / (nc - 1));   // sphere offsets along the car axis
  s.half = new THREE.Vector2(s.W / 2, s.L / 2);
}

// ------------------------------------------------------------------ paint
export const PAINTS = [
  0x15161a, 0xe6e6e8, 0x9ea4ab, 0xa31d1d, 0x1f3c82, 0x23402f, 0x575c63, 0xcf6a1a, 0xc7b38a, 0x5b1f6a, 0x1f6f78,
];
export const VAN_PAINTS = [0xe6e6e8, 0x5a3b22, 0x1f3c82, 0x9ea4ab, 0xdcdcdc];
/** Taxi body colour: New York yellow; set to Singapore taxi blue by initCarAssets on the Singapore map (live binding). */
export let TAXI_YELLOW = 0xf2b600;
export const POLICE_WHITE = 0xeeeeef;
const SG_TAXI = 0x1f5fb8;

let A = null; // shared assets
let QUALITY = 'high';

const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

// ------------------------------------------------------------------ body style (hatchback / minibus come from the paint colour)
/** Deterministic body style for a kind + paint, so the near model and the far instanced LOD always agree. */
export function styleFor(kind, hex) {
  const mesh = SPECS[kind].mesh;
  if (mesh === 'bus') return 'bus';
  const h = (((hex >> 16) & 255) * 31 + ((hex >> 8) & 255) * 17 + (hex & 255) * 7) % 10;
  if (kind === 'sedan') return h < 4 ? 'hatch' : 'sedan';
  if (kind === 'van') return h % 2 === 1 ? 'minibus' : 'van';
  return mesh;
}
const STYLE_SPEC = { sedan: 'sedan', hatch: 'sedan', suv: 'suv', sports: 'sports', van: 'van', minibus: 'van' };

// ------------------------------------------------------------------ smooth profile curves (monotone-ish cubic Hermite)
function curve(pts) {
  const n = pts.length, m = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let s = (b[1] - a[1]) / ((b[0] - a[0]) || 1);
    if (i > 0 && i < n - 1 && (pts[i][1] - pts[i - 1][1]) * (pts[i + 1][1] - pts[i][1]) <= 0) s = 0;
    m[i] = s;
  }
  return (z) => {
    if (z <= pts[0][0]) return pts[0][1];
    if (z >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0; while (pts[i + 1][0] < z) i++;
    const [z0, v0] = pts[i], [z1, v1] = pts[i + 1], h = z1 - z0, t = (z - z0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------ hull definitions (design coordinates; scaled to the spec L / W)
// hw: half width, yb: sill height, yt: top of the lower body (hood / belt / deck), cab: cabin height above the belt.
const HULL_DEF = {
  sedan: {
    L: 4.84, W: 1.85, nose: 2.42, tail: -2.42, wz: [1.45, -1.42], belt: 0.95, headY: 0.7, tailY: 0.82, lampX: 0.58,
    hw: [[-2.42, 0.72], [-2.34, 0.82], [-2.15, 0.89], [-1.85, 0.925], [1.8, 0.925], [2.1, 0.905], [2.32, 0.84], [2.42, 0.76]],
    yb: [[-2.42, 0.46], [-2.25, 0.36], [-2.0, 0.31], [2.0, 0.31], [2.25, 0.35], [2.42, 0.45]],
    yt: [[-2.42, 0.8], [-2.32, 0.9], [-2.0, 0.975], [-1.5, 0.972], [1.15, 0.95], [1.5, 0.94], [1.95, 0.865], [2.3, 0.75], [2.42, 0.64]],
    cab: [[-1.5, 0], [-1.28, 0.2], [-1.02, 0.38], [-0.78, 0.49], [0.3, 0.49], [0.68, 0.44], [1.12, 0]],
    cw0: 0.87, cw1: 0.72, rows: [0.2, 0.86], winSegs: [1], roofZ: [-0.8, 0.32],
    sideGlass: [[-1.08, -0.07], [0.07, 0.99]], frontGlass: [0.32, 1.12], rearGlass: [-1.5, -0.8],
    doors: [[0.92, 0.04], [-0.02, -0.98]], topSeams: [[1.13, 0.95], [-1.45, 0.972], [0.2, 0.0]], sill: 0.36,
  },
  hatch: {
    L: 4.17, W: 1.85, nose: 2.12, tail: -2.05, wz: [1.3, -1.22], belt: 0.93, headY: 0.68, tailY: 0.86, lampX: 0.58,
    hw: [[-2.05, 0.76], [-1.97, 0.85], [-1.8, 0.905], [-1.5, 0.925], [1.5, 0.925], [1.8, 0.905], [2.02, 0.84], [2.12, 0.76]],
    yb: [[-2.05, 0.46], [-1.9, 0.36], [-1.7, 0.31], [1.7, 0.31], [1.95, 0.35], [2.12, 0.45]],
    yt: [[-2.05, 0.82], [-1.98, 0.9], [-1.8, 0.94], [0.95, 0.93], [1.3, 0.92], [1.7, 0.85], [2.0, 0.74], [2.12, 0.63]],
    cab: [[-2.0, 0], [-1.92, 0.2], [-1.7, 0.44], [-1.35, 0.54], [0.2, 0.54], [0.58, 0.48], [0.98, 0]],
    cw0: 0.87, cw1: 0.74, rows: [0.2, 0.86], winSegs: [1], roofZ: [-1.35, 0.2],
    sideGlass: [[-1.7, -0.95], [-0.85, -0.07], [0.07, 0.78]], frontGlass: [0.2, 0.98], rearGlass: [-2.0, -1.35],
    doors: [[0.8, 0.0], [-0.05, -0.88]], topSeams: [[0.99, 0.93], [-1.95, 0.9]], sill: 0.36,
  },
  suv: {
    L: 4.9, W: 2.0, nose: 2.45, tail: -2.45, wz: [1.5, -1.45], belt: 1.17, headY: 0.86, tailY: 0.98, lampX: 0.66,
    hw: [[-2.45, 0.86], [-2.38, 0.93], [-2.2, 0.98], [-1.9, 1.0], [1.9, 1.0], [2.2, 0.97], [2.38, 0.92], [2.45, 0.84]],
    yb: [[-2.45, 0.56], [-2.3, 0.44], [-2.1, 0.4], [2.1, 0.4], [2.3, 0.44], [2.45, 0.54]],
    yt: [[-2.45, 0.96], [-2.4, 1.1], [-2.2, 1.18], [1.3, 1.17], [1.8, 1.11], [2.2, 0.99], [2.4, 0.86], [2.45, 0.74]],
    cab: [[-2.42, 0], [-2.34, 0.46], [-2.2, 0.62], [-1.9, 0.65], [0.5, 0.65], [1.05, 0.56], [1.55, 0]],
    cw0: 0.95, cw1: 0.87, rows: [0.2, 0.86], winSegs: [1], roofZ: [-2.0, 0.5],
    sideGlass: [[-2.15, -1.05], [-0.92, -0.04], [0.1, 1.0]], frontGlass: [0.5, 1.55], rearGlass: [-2.42, -2.0],
    doors: [[1.08, 0.06], [0.0, -0.98]], topSeams: [[1.56, 1.17], [-2.36, 1.1]], sill: 0.46, rails: true,
  },
  sports: {
    L: 4.4, W: 1.95, nose: 2.2, tail: -2.2, wz: [1.32, -1.3], belt: 0.82, headY: 0.55, tailY: 0.74, lampX: 0.62,
    hw: [[-2.2, 0.8], [-2.1, 0.92], [-1.9, 0.975], [-1.4, 0.99], [1.4, 0.99], [1.9, 0.96], [2.1, 0.88], [2.2, 0.76]],
    yb: [[-2.2, 0.4], [-2.05, 0.31], [-1.8, 0.28], [1.8, 0.28], [2.05, 0.3], [2.2, 0.34]],
    yt: [[-2.2, 0.62], [-2.1, 0.77], [-1.8, 0.87], [-1.3, 0.89], [-0.2, 0.82], [0.9, 0.83], [1.35, 0.83], [1.8, 0.79], [2.05, 0.62], [2.2, 0.46]],
    cab: [[-1.4, 0], [-1.05, 0.2], [-0.6, 0.38], [-0.1, 0.47], [0.3, 0.47], [0.7, 0.34], [1.05, 0]],
    cw0: 0.88, cw1: 0.68, rows: [0.2, 0.86], winSegs: [1], roofZ: [-0.3, 0.3],
    sideGlass: [[-0.8, 0.7]], frontGlass: [0.3, 1.05], rearGlass: [-1.4, -0.3],
    doors: [[0.92, -0.62]], topSeams: [[1.06, 0.78], [-1.45, 0.88]], sill: 0.34, spoiler: true,
  },
  van: {
    L: 5.4, W: 2.0, nose: 2.7, tail: -2.7, wz: [1.7, -1.6], belt: 1.18, headY: 0.8, tailY: 1.05, lampX: 0.7,
    hw: [[-2.7, 0.94], [-2.6, 0.98], [-2.3, 1.0], [2.0, 1.0], [2.4, 0.97], [2.6, 0.92], [2.7, 0.86]],
    yb: [[-2.7, 0.5], [-2.55, 0.44], [-2.3, 0.42], [2.3, 0.42], [2.55, 0.46], [2.7, 0.52]],
    yt: [[-2.7, 1.12], [-2.6, 1.18], [1.45, 1.18], [1.95, 1.1], [2.4, 0.95], [2.7, 0.76]],
    cab: [[-2.7, 0], [-2.62, 1.0], [-2.48, 1.07], [0.5, 1.07], [1.5, 0]],
    cw0: 0.98, cw1: 0.95, rows: [0.1, 0.56, 0.8], winSegs: [1], roofZ: [-2.5, 0.5],
    sideGlass: [[0.3, 1.25]], frontGlass: [0.5, 1.5], rearGlass: null,
    doors: [[1.3, 0.2], [0.1, -1.4], [-1.5, -2.4]], topSeams: [[1.5, 1.18]], sill: 0.5, cargo: true,
  },
  minibus: {
    L: 5.4, W: 2.0, nose: 2.7, tail: -2.7, wz: [1.7, -1.6], belt: 1.18, headY: 0.8, tailY: 1.05, lampX: 0.7,
    hw: [[-2.7, 0.94], [-2.6, 0.98], [-2.3, 1.0], [2.0, 1.0], [2.4, 0.97], [2.6, 0.92], [2.7, 0.86]],
    yb: [[-2.7, 0.5], [-2.55, 0.44], [-2.3, 0.42], [2.3, 0.42], [2.55, 0.46], [2.7, 0.52]],
    yt: [[-2.7, 1.12], [-2.6, 1.18], [1.45, 1.18], [1.95, 1.1], [2.4, 0.95], [2.7, 0.76]],
    cab: [[-2.7, 0], [-2.62, 0.95], [-2.48, 1.05], [0.5, 1.05], [1.5, 0]],
    cw0: 0.98, cw1: 0.95, rows: [0.1, 0.56, 0.8], winSegs: [1], roofZ: [-2.5, 0.5],
    sideGlass: [[-2.35, -1.55], [-1.45, -0.65], [-0.55, 0.15], [0.3, 1.25]], frontGlass: [0.5, 1.5], rearGlass: [-2.66, -2.5],
    doors: [[1.3, 0.2], [0.1, -0.5]], topSeams: [[1.5, 1.18]], sill: 0.5, cargo: false,
  },
};

function makeHull(style, spec) {
  const d = HULL_DEF[style];
  const h = { style, ...d, spec, wr: spec.wr, ww: spec.ww };
  h.hwF = curve(d.hw); h.ybF = curve(d.yb); h.ytF = curve(d.yt); h.cabF = curve(d.cab);
  h.Ra = spec.wr + 0.075;
  h.cy = h.wz.map((z) => Math.max(h.ybF(z), spec.wr - 0.03));
  h.wx = h.wz.map((z) => h.hwF(z) - spec.ww / 2 - 0.025);
  h.roofTop = d.belt + Math.max(...d.cab.map((c) => c[1]));
  h.cz0 = d.cab[0][0]; h.cz1 = d.cab[d.cab.length - 1][0];
  h.Y1 = h.roofTop + 0.03;
  // lamps never float above the body: keep them under the hood / deck line at the nose and tail
  h.headY = Math.min(d.headY, h.ytF(d.nose - 0.12) - 0.06);
  h.tailY = Math.min(d.tailY, h.ytF(d.tail + 0.12) - 0.05);
  return h;
}

// ------------------------------------------------------------------ canvas atlases
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
const GEN_CELL = { sedan: [0, 0], hatch: [1, 0], suv: [2, 0], sports: [3, 0], van: [0, 1], minibus: [1, 1] };
const LIV_ROW = { taxi_ny: 0, taxi_sg: 1, police_ny: 2, police_sg: 3 };

/** (z, y) -> pixel inside a cell */
const cellMap = (h, x0, y0, w, hh) => ({ px: (z) => x0 + ((z - h.tail) / (h.nose - h.tail)) * w, py: (y) => y0 + (1 - y / h.Y1) * hh, sx: w / (h.nose - h.tail), sy: hh / h.Y1 });

function drawBodyCell(g, h, x0, y0, w, hh, { base = '#ffffff', mirror = false, extra = null } = {}) {
  const M = cellMap(h, x0, y0, w, hh), spec = h.spec;
  g.save(); g.beginPath(); g.rect(x0, y0, w, hh); g.clip();
  g.fillStyle = base; g.fillRect(x0, y0, w, hh);
  // ambient occlusion: darker toward the sill, soft shade around the wheel arches
  const grad = g.createLinearGradient(0, M.py(h.sill - 0.08), 0, M.py(h.sill + 0.5));
  grad.addColorStop(0, 'rgba(0,0,0,0.34)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(x0, M.py(h.sill + 0.5), w, M.py(h.sill - 0.08) - M.py(h.sill + 0.5));
  for (const wz of h.wz) {
    const r = M.sx * (h.Ra + 0.12), k = M.sx / M.sy, cx = M.px(wz), cyk = M.py(spec.wr) * k;
    g.save(); g.scale(1, M.sy / M.sx);
    const gr = g.createRadialGradient(cx, cyk, M.sx * h.Ra * 0.8, cx, cyk, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cyk, r, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // character line along the shoulder
  g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = Math.max(1, w / 400);
  g.beginPath(); g.moveTo(M.px(h.tail + 0.4), M.py(h.belt - 0.14)); g.lineTo(M.px(h.nose - 0.4), M.py(h.belt - 0.1)); g.stroke();
  // door seams
  g.strokeStyle = 'rgba(0,0,0,0.62)'; g.lineWidth = Math.max(1.2, w / 330); g.lineCap = 'round';
  const lo = h.sill + 0.02, hi = h.belt - 0.015;
  for (const [zf, zr] of h.doors) {
    g.beginPath(); g.moveTo(M.px(zf), M.py(lo + 0.03)); g.lineTo(M.px(zf), M.py(hi)); g.moveTo(M.px(zr), M.py(lo + 0.03)); g.lineTo(M.px(zr), M.py(hi));
    g.moveTo(M.px(zf), M.py(lo + 0.03)); g.quadraticCurveTo(M.px(zf), M.py(lo), M.px(zf - Math.sign(zf - zr) * 0.04), M.py(lo)); g.lineTo(M.px(zr + Math.sign(zf - zr) * 0.04), M.py(lo)); g.quadraticCurveTo(M.px(zr), M.py(lo), M.px(zr), M.py(lo + 0.03));
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.moveTo(M.px(zr + Math.sign(zf - zr) * 0.08), M.py(h.belt - 0.12)); g.lineTo(M.px(zf - Math.sign(zf - zr) * 0.08), M.py(h.belt - 0.12)); g.stroke(); g.strokeStyle = 'rgba(0,0,0,0.62)';
  }
  // hood / boot / tailgate shut lines (they show on the top surface because the uv follows z)
  g.lineWidth = Math.max(1.2, w / 380);
  for (const [z, y] of h.topSeams) { g.beginPath(); g.moveTo(M.px(z), M.py(y - 0.035)); g.lineTo(M.px(z), M.py(y + 0.03)); g.stroke(); }
  if (extra) extra(g, M, mirror, h);
  g.restore();
}

function drawGenericAtlas() {
  const big = QUALITY === 'high' || QUALITY === 'ultra';
  const W = big ? 2048 : 1024, H = big ? 1024 : 512, cw = W / 4, ch = H / 4;
  const [c, g] = mkCanvas(W, H);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  for (const style of Object.keys(GEN_CELL)) {
    const [cx, cy] = GEN_CELL[style];
    const h = makeHull(style, SPECS[STYLE_SPEC[style]]);
    drawBodyCell(g, h, cx * cw, cy * ch, cw, ch);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = true;
  return t;
}

function drawText(g, M, mirror, txt, z, y, size, color, weight = 'bold') {
  g.save(); g.translate(M.px(z), M.py(y)); if (mirror) g.scale(-1, 1);
  g.fillStyle = color; g.font = `${weight} ${Math.round(size * M.sy)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 0, 0); g.restore();
}

function drawLiveryAtlas() {
  const big = QUALITY === 'high' || QUALITY === 'ultra';
  const W = big ? 1024 : 512, H = big ? 1024 : 512, cw = W / 2, ch = H / 4;
  const [c, g] = mkCanvas(W, H);
  const h = makeHull('sedan', SPECS.sedan);
  const hp = makeHull('sedan', SPECS.police);
  for (const mirror of [false, true]) {
    const x0 = mirror ? cw : 0;
    // New York taxi: yellow, checker band, door text
    drawBodyCell(g, h, x0, 0 * ch, cw, ch, { base: '#f2b600', mirror, extra: (g2, M, mir) => {
      const y0 = 0.52, y1 = 0.6;
      const cellH = (M.py(y0) - M.py(y1)) / 2;
      for (let i = 0; i < 44; i++) for (let r = 0; r < 2; r++) if ((i + r) % 2 === 0) { g2.fillStyle = '#111'; g2.fillRect(M.px(-2.2 + i * 0.1), M.py(y1) + r * cellH, M.sx * 0.1, cellH); }
      drawText(g2, M, mir, 'TAXI', 0.55, 0.78, 0.12, '#111');
      drawText(g2, M, mir, '5K27', -0.5, 0.75, 0.1, '#111');
    } });
    // Singapore taxi: blue, white lower door, orange stripe, "TAXI" and fleet number
    drawBodyCell(g, h, x0, 1 * ch, cw, ch, { base: '#1f5fb8', mirror, extra: (g2, M, mir) => {
      g2.fillStyle = '#f3f3f0'; g2.fillRect(M.px(-1.85), M.py(0.55), M.sx * 3.7, M.py(h.sill + 0.03) - M.py(0.55));
      g2.fillStyle = '#f08a1c'; g2.fillRect(M.px(-1.9), M.py(0.58), M.sx * 3.8, M.sy * 0.03);
      drawText(g2, M, mir, 'TAXI', 0.46, 0.8, 0.13, '#ffffff');
      drawText(g2, M, mir, 'SH 4271', -0.5, 0.45, 0.1, '#1f3f7a');
    } });
    // New York police: white, navy band + text
    drawBodyCell(g, hp, x0, 2 * ch, cw, ch, { base: '#f2f2f4', mirror, extra: (g2, M, mir) => {
      g2.fillStyle = '#1b2c58'; g2.fillRect(M.px(-2.3), M.py(0.86), M.sx * 4.6, M.sy * 0.27);
      g2.fillStyle = '#c8321e'; g2.fillRect(M.px(-2.3), M.py(0.87), M.sx * 4.6, M.sy * 0.02);
      drawText(g2, M, mir, 'POLICE', -0.1, 0.69, 0.16, '#ffffff');
    } });
    // Singapore police: white, blue + red side stripes
    drawBodyCell(g, hp, x0, 3 * ch, cw, ch, { base: '#f4f4f6', mirror, extra: (g2, M, mir) => {
      g2.fillStyle = '#1a3f9a'; g2.fillRect(M.px(-2.3), M.py(0.86), M.sx * 4.6, M.sy * 0.16);
      g2.fillStyle = '#d0202a'; g2.fillRect(M.px(-2.3), M.py(0.7), M.sx * 4.6, M.sy * 0.045);
      drawText(g2, M, mir, 'POLICE', 0.0, 0.62, 0.13, '#1a3f9a');
    } });
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** number plates + the roof sign face. 4 x 4 cells of 256 x 64: row 0 front plates, row 1 rear plates, row 2 sign faces, last cell white. */
function drawPlateAtlas() {
  const sg = isSg();
  const [c, g] = mkCanvas(1024, 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 256);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const L = 'ABCDEFGHJKLMNPRSTUVXYZ', D = '0123456789';
  const pick = (s) => s[(rnd() * s.length) | 0];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    const x = col * 256, y = row * 64;
    const rear = row === 1;
    g.fillStyle = sg ? (rear ? '#f2c200' : '#f4f4f2') : '#f1f0e8'; g.fillRect(x + 2, y + 2, 252, 60);
    g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, 248, 56);
    g.fillStyle = '#111'; g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = sg ? `S${pick(L)}${pick(L)} ${pick(D)}${pick(D)}${pick(D)}${pick(D)}${pick(L)}` : `${pick(L)}${pick(L)}${pick(L)}-${pick(D)}${pick(D)}${pick(D)}${pick(D)}`;
    g.fillText(txt, x + 128, y + 34);
    if (!sg) { g.fillStyle = '#1b3f8a'; g.fillRect(x + 6, y + 6, 244, 10); }
  }
  // sign faces
  g.fillStyle = '#fff6c8'; g.fillRect(2, 130, 252, 60); g.fillStyle = '#161616'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 128, 162);
  g.fillStyle = '#ffffff'; g.fillRect(768 + 4, 192 + 4, 248, 56); // plain white texel block (last cell)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const plateUV = (rear, variant) => { const col = variant & 3, row = rear ? 1 : 0; return [col * 0.25 + 0.01, 1 - (row + 1) * 0.25 + 0.02, col * 0.25 + 0.24, 1 - row * 0.25 - 0.02]; };
const SIGN_UV = [0.01, 1 - 3 * 0.25 + 0.02, 0.24, 1 - 2 * 0.25 - 0.02];
const WHITE_UV = [0.97, 0.03];

export function initCarAssets(quality = 'high') {
  if (A) return A;
  QUALITY = quality;
  if (isSg()) TAXI_YELLOW = SG_TAXI;
  const physical = quality === 'high' || quality === 'ultra';
  A = {
    quality,
    physical,
    sg: isSg(),
    paint: new Map(),
    livery: new Map(),
    glass: physical
      ? new THREE.MeshPhysicalMaterial({ color: 0x070c12, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.02, vertexColors: true })
      : new THREE.MeshStandardMaterial({ color: 0x070c12, roughness: 0.05, metalness: 0.92, envMapIntensity: 1.6, vertexColors: true }),
    trim: null,
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }),
    lamp: null,
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.5), toneMapped: false }),
    tailOff: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.03, 0.03), toneMapped: false }),
    tailOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 0.25, 0.18), toneMapped: false }),
    charred: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, metalness: 0.1 }),
    sign: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6), toneMapped: false }),
    barBase: new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.5 }),
    lod: new THREE.MeshLambertMaterial({ vertexColors: true }),
    geo: {},
    atlasGen: null, atlasLiv: null, atlasPlate: null,
  };
  try { A.atlasGen = drawGenericAtlas(); A.atlasLiv = drawLiveryAtlas(); A.atlasPlate = drawPlateAtlas(); } catch { /* no canvas: plain paint */ }
  A.trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.7, map: A.atlasPlate });
  A.lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, map: A.atlasPlate });
  return A;
}

const paintProps = (o) => (A.physical
  ? new THREE.MeshPhysicalMaterial({ metalness: 0.4, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.15, vertexColors: true, ...o })
  : new THREE.MeshStandardMaterial({ metalness: 0.4, roughness: 0.42, vertexColors: true, ...o }));

export function paintMaterial(hex) {
  const a = A;
  let m = a.paint.get(hex);
  if (!m) { m = paintProps({ color: hex, map: a.atlasGen }); a.paint.set(hex, m); }
  return m;
}
function liveryMaterial(name) {
  let m = A.livery.get(name);
  if (!m) { m = paintProps({ color: 0xffffff, map: A.atlasLiv, metalness: 0.3 }); A.livery.set(name, m); }
  return m;
}

// ------------------------------------------------------------------ geometry helpers
const ROT_Y90 = new THREE.Matrix4().makeRotationY(Math.PI / 2);

/** Extrude a side profile ([z,y] points) across the car width. Used for the far-LOD silhouette only. */
function extrudeProfile(pts, width) {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geo.translate(0, 0, -width / 2);
  geo.applyMatrix4(ROT_Y90);
  return geo;
}

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function plain(g) { // keep attributes consistent for merging: position/normal/uv only, non-indexed
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) out.deleteAttribute(k);
  return out;
}

// ------------------------------------------------------------------ triangle soup builder (paint / glass groups)
class Soup {
  constructor() { this.p = []; this.u = []; this.c = []; }
  tri(a, b, c, ua, ub, uc, ca, cb, cc, cen) {
    // orient outward (away from cen)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    if (nx * (a[0] - cen[0]) + ny * (a[1] - cen[1]) + nz * (a[2] - cen[2]) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; [cb, cc] = [cc, cb]; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }
  geometry(sx, sz, crease) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(this.p);
    for (let i = 0; i < p.length; i += 3) { p[i] *= sx; p[i + 2] *= sz; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.u), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    return toCreasedNormals(g, crease);
  }
}

const WHITE = [1, 1, 1], DARK = [0.035, 0.035, 0.04];
const inRange = (z, list) => { if (!list) return false; for (const r of list) if (z >= r[0] - 1e-6 && z <= r[1] + 1e-6) return true; return false; };

/** atlas uv for a body point: cell chosen per triangle (left / right side) so livery text reads correctly on both flanks */
function makeUV(h, cellR, cellL, cols, rows) {
  const f = (cell, z, y) => {
    const u = clamp((z - h.tail) / (h.nose - h.tail), 0.004, 0.996), v = clamp(y / h.Y1, 0.004, 0.996);
    return [(cell[0] + u) / cols, 1 - (cell[1] + 1 - v) / rows];
  };
  return {
    at: (left, z, y) => f(left ? cellL : cellR, z, y),
    flat: (left) => f(left ? cellL : cellR, h.tail + 0.004 * (h.nose - h.tail), h.Y1 * 0.996),
  };
}

function bodyStations(h) {
  const s = new Set(), add = (z) => { if (z >= h.tail - 1e-6 && z <= h.nose + 1e-6) s.add(+z.toFixed(4)); };
  for (let z = h.tail; z <= h.nose + 1e-6; z += 0.32) add(z);
  for (const d of [0.04, 0.12, 0.25]) { add(h.tail + d); add(h.nose - d); }
  add(h.tail); add(h.nose);
  for (const wz of h.wz) for (let k = 0; k <= 12; k++) add(wz + Math.cos((Math.PI * k) / 12) * h.Ra);
  add(h.cz0); add(h.cz1);
  return [...s].sort((a, b) => a - b);
}
function bodyRing(h, z) {
  const W = h.hwF(z), yB = h.ybF(z), yT = h.ytF(z);
  let yA = yB;
  for (let i = 0; i < h.wz.length; i++) { const dz = Math.abs(z - h.wz[i]); if (dz < h.Ra) yA = Math.max(yA, h.cy[i] + Math.sqrt(h.Ra * h.Ra - dz * dz)); }
  yA = Math.min(yA, yT - 0.1);
  const wi = Math.max(0.05, W - h.ww - 0.04), side = (t) => yA + t * (yT - yA);
  const eT = Math.min(0.06, (yT - yA) * 0.25);
  return [[0, yB], [wi, yB], [wi + 0.02, yA], [W - 0.04, yA], [W * 0.995, yA + 0.015], [W, side(0.2)], [W, side(0.5)], [W * 0.99, side(0.8)], [W * 0.955, yT - eT], [W * 0.87, yT - eT * 0.3], [W * 0.55, yT - 0.006], [0, yT]];
}
function cabinStations(h) {
  const s = new Set(), add = (z) => { if (z >= h.cz0 - 1e-6 && z <= h.cz1 + 1e-6) s.add(+z.toFixed(4)); };
  for (let z = h.cz0; z <= h.cz1 + 1e-6; z += 0.14) add(z);
  for (const p of h.cab) add(p[0]);
  for (const r of [...h.sideGlass, h.frontGlass, h.rearGlass, h.roofZ]) if (r) { add(r[0]); add(r[1]); }
  for (const dz of [0.03, 0.06]) { add(h.cz0 + dz); add(h.cz1 - dz); }
  return [...s].sort((a, b) => a - b);
}
function cabinRing(h, z) {
  const hc = h.cabF(z), base = h.belt - 0.03, top = h.belt + hc, wb = h.cw0, wt = h.cw1, hh = top - base;
  const pts = [[wb, base]];
  for (const f of h.rows) pts.push([lerp(wb, wt, f), base + f * hh]);
  const k1 = Math.min(0.07, hc * 0.14), k2 = Math.min(0.025, hc * 0.06), k3 = Math.min(0.008, hc * 0.02);
  pts.push([wt + 0.012, top - k1], [wt * 0.9, top - k2], [wt * 0.55, top - k3], [0, top]);
  return pts;
}

function emitBody(h, paint, glass, uvm) {
  // ---- lower body
  const zs = bodyStations(h), M = 12, N = 2 * (M - 1);
  const full = (half) => { const r = []; for (let i = 0; i < M; i++) r.push([half[i][0], half[i][1], i]); for (let i = M - 2; i >= 1; i--) r.push([-half[i][0], half[i][1], i]); return r; };
  const rings = zs.map((z) => full(bodyRing(h, z)));
  for (let si = 0; si < zs.length - 1; si++) {
    const R0 = rings[si], R1 = rings[si + 1], z0 = zs[si], z1 = zs[si + 1], cen = [0, 0.6, (z0 + z1) / 2];
    for (let j = 0; j < N; j++) {
      const a = R0[j], b = R0[(j + 1) % N], c = R1[(j + 1) % N], d = R1[j];
      const seg = Math.min(a[2], b[2]), under = seg <= 2;
      const col = under ? DARK : WHITE, left = a[0] + b[0] > 0;
      const P = (r, z) => [r[0], r[1], z];
      const uv = (r, z) => (under ? uvm.flat(left) : uvm.at(left, z, r[1]));
      paint.tri(P(a, z0), P(b, z0), P(c, z1), uv(a, z0), uv(b, z0), uv(c, z1), col, col, col, cen);
      paint.tri(P(a, z0), P(c, z1), P(d, z1), uv(a, z0), uv(c, z1), uv(d, z1), col, col, col, cen);
    }
  }
  // end caps (nose / tail faces)
  const cap = (ring, z, nz) => {
    let cx = 0, cy = 0; for (const r of ring) cy += r[1]; cy /= ring.length;
    const cen = [0, cy, z - nz * 1], uvc = uvm.flat(false);
    for (let j = 0; j < ring.length; j++) { const a = ring[j], b = ring[(j + 1) % ring.length]; paint.tri([cx, cy, z], [a[0], a[1], z], [b[0], b[1], z], uvc, uvc, uvc, WHITE, WHITE, WHITE, cen); }
  };
  cap(rings[0], zs[0], -1); cap(rings[rings.length - 1], zs[zs.length - 1], 1);
  // ---- cabin (roof, pillars, glass)
  const cz = cabinStations(h), nRows = h.rows.length;
  const cr = cz.map((z) => cabinRing(h, z)), mc = cr[0].length;
  const fullC = (half) => { const r = []; for (let i = 0; i < mc; i++) r.push([half[i][0], half[i][1], i]); for (let i = mc - 2; i >= 0; i--) r.push([-half[i][0], half[i][1], i]); return r; };
  for (let si = 0; si < cz.length - 1; si++) {
    const R0 = fullC(cr[si]), R1 = fullC(cr[si + 1]), z0 = cz[si], z1 = cz[si + 1], zm = (z0 + z1) / 2, cen = [0, h.belt, zm];
    for (let j = 0; j < R0.length - 1; j++) {
      const a = R0[j], b = R0[j + 1], c = R1[j + 1], d = R1[j];
      const seg = Math.min(a[2], b[2]);
      let isGlass = false;
      if (seg < nRows) isGlass = h.winSegs.includes(seg) && inRange(zm, h.sideGlass);
      else if (seg > nRows) isGlass = inRange(zm, [h.frontGlass]) || inRange(zm, h.rearGlass ? [h.rearGlass] : null);
      // a roof panel never counts as glass
      if (seg > nRows && inRange(zm, [h.roofZ]) && !(zm < h.roofZ[0] || zm > h.roofZ[1])) isGlass = false;
      const left = a[0] + b[0] > 0;
      const P = (r, z) => [r[0], r[1], z];
      if (isGlass) {
        const gc = 0.78 + 0.22 * (1 - clamp((a[1] + c[1]) / 2 - h.belt, 0, 1) / Math.max(0.2, h.roofTop - h.belt)); // slightly darker toward the roof
        const col = [gc, gc, gc], pu = [0.5, 0.5];
        glass.tri(P(a, z0), P(b, z0), P(c, z1), pu, pu, pu, col, col, col, cen);
        glass.tri(P(a, z0), P(c, z1), P(d, z1), pu, pu, pu, col, col, col, cen);
      } else {
        const uv = (r, z) => uvm.at(left, z, r[1]);
        paint.tri(P(a, z0), P(b, z0), P(c, z1), uv(a, z0), uv(b, z0), uv(c, z1), WHITE, WHITE, WHITE, cen);
        paint.tri(P(a, z0), P(c, z1), P(d, z1), uv(a, z0), uv(c, z1), uv(d, z1), WHITE, WHITE, WHITE, cen);
      }
    }
  }
}

// ------------------------------------------------------------------ trim (bumpers, grille, chrome, plates, mirrors ...) and lamps
const BLACK = [0.03, 0.03, 0.034], CHROME = [0.82, 0.84, 0.88], GREY = [0.12, 0.125, 0.14];
class Boxes {
  constructor() { this.list = []; }
  box(w, h, d, x, y, z, col, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    const gg = g.toNonIndexed();
    const n = gg.attributes.position.count, c = new Float32Array(n * 3), uv = new Float32Array(n * 2), u0 = o.uv;
    const src = gg.attributes.uv;
    for (let i = 0; i < n; i++) {
      c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
      if (u0) { uv[i * 2] = lerp(u0[0], u0[2], src.getX(i)); uv[i * 2 + 1] = lerp(u0[1], u0[3], src.getY(i)); } else { uv[i * 2] = WHITE_UV[0]; uv[i * 2 + 1] = WHITE_UV[1]; }
    }
    gg.setAttribute('color', new THREE.BufferAttribute(c, 3)); gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.list.push(gg);
    return this;
  }
  sym(w, h, d, x, y, z, col, o = {}) { this.box(w, h, d, x, y, z, col, o); this.box(w, h, d, -x, y, z, col, { ...o, ry: o.ry ? -o.ry : o.ry, rz: o.rz ? -o.rz : o.rz }); return this; }
  geometry(sx, sz) {
    const g = mergeGeometries(this.list.map((q) => { const p = plain(q); return p; }), false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz); }
    p.needsUpdate = true;
    return g;
  }
}

/** ribbon around a wheel arch, on the outer wall (dark flare) */
function archFlares(T, h) {
  for (let i = 0; i < h.wz.length; i++) {
    const wz = h.wz[i], cy = h.cy[i], r0 = h.Ra, r1 = h.Ra + 0.05, W = h.hwF(wz);
    const steps = 14;
    for (let k = 0; k < steps; k++) {
      const a0 = (Math.PI * k) / steps, a1 = (Math.PI * (k + 1)) / steps, am = (a0 + a1) / 2;
      const rm = (r0 + r1) / 2, zc = wz + Math.cos(am) * rm, yc = cy + Math.sin(am) * rm;
      if (yc < h.ybF(zc) + 0.01 || yc > h.ytF(zc) - 0.09) continue;
      const len = Math.hypot((Math.cos(a1) - Math.cos(a0)) * rm, (Math.sin(a1) - Math.sin(a0)) * rm) + 0.015;
      for (const sx of [1, -1]) T.box(0.022, r1 - r0, len, sx * (h.hwF(zc) + 0.004), yc, zc, BLACK, { rx: -(am + Math.PI / 2) });
    }
    void W;
  }
}

function buildTrim(h, kind, plateVar) {
  const T = new Boxes(), spec = h.spec, W = h.hwF(0), hn = h.hwF(h.nose - 0.12), ht = h.hwF(h.tail + 0.12);
  const nose = h.nose, tail = h.tail, yb = h.ybF(0), belt = h.belt;
  const sed = h.style === 'sedan' || h.style === 'hatch';
  // front: bumper lower, grille, intake, chrome
  T.box(hn * 1.7, 0.1, 0.12, 0, h.ybF(nose - 0.1) + 0.1, nose - 0.05, BLACK);
  T.box(hn * 1.15, 0.06, 0.06, 0, h.ybF(nose - 0.1) + 0.2, nose - 0.03, GREY);
  const gy = h.headY - 0.02, gw = hn * 0.95;
  T.box(gw, 0.11, 0.05, 0, gy, nose - 0.02, BLACK);
  T.box(gw + 0.03, 0.015, 0.055, 0, gy + 0.063, nose - 0.02, CHROME); T.box(gw + 0.03, 0.015, 0.055, 0, gy - 0.063, nose - 0.02, CHROME);
  for (let i = -3; i <= 3; i++) T.box(0.012, 0.1, 0.055, i * gw * 0.15, gy, nose - 0.018, CHROME);
  T.box(0.09, 0.07, 0.06, 0, gy, nose - 0.012, CHROME);
  // plates
  const pu = plateUV(false, plateVar), ru = plateUV(true, plateVar + 1);
  T.box(0.52, 0.12, 0.012, 0, h.ybF(nose - 0.1) + 0.19, nose + 0.002, [1, 1, 1], { uv: pu });
  T.box(0.52, 0.12, 0.012, 0, h.tailY - 0.14, tail - 0.003, [1, 1, 1], { uv: ru });
  // rear: bumper, chrome strip
  T.box(ht * 1.75, 0.13, 0.1, 0, h.ybF(tail + 0.1) + 0.1, tail + 0.06, BLACK);
  T.box(ht * 1.6, 0.02, 0.05, 0, h.tailY - 0.22, tail - 0.005, CHROME);
  // sills and wheel arch flares
  const zf = h.wz[0] - h.Ra - 0.02, zr = h.wz[1] + h.Ra + 0.02;
  for (const sx of [1, -1]) T.box(0.03, 0.07, zf - zr, sx * (W + 0.005), h.sill - 0.04, (zf + zr) / 2, BLACK);
  archFlares(T, h);
  // belt line / window surround strip, door handles
  const sr = h.rows[h.winSegs[0] - 0] ?? 0.2, wf = h.winSegs[0] === 0 ? 0 : h.rows[h.winSegs[0] - 1];
  for (const [a, b] of h.sideGlass) for (let z = a; z < b - 1e-6; z += 0.15) {
    const zc = Math.min(b, z + 0.15), zm = (z + zc) / 2, y = h.belt - 0.03 + wf * (h.cabF(zm) + 0.03), x = lerp(h.cw0, h.cw1, wf) + 0.006;
    for (const sx of [1, -1]) T.box(0.014, 0.02, zc - z + 0.01, sx * x, y, zm, BLACK);
  }
  void sr;
  for (const [zf2, zr2] of h.doors) for (const sx of [1, -1]) T.box(0.02, 0.026, 0.14, sx * (h.hwF(zr2) + 0.008), belt - 0.1, zr2 + (zf2 > zr2 ? 0.13 : -0.13), CHROME);
  // mirrors
  const mz = h.doors[0][0] - 0.06, mx = h.hwF(mz) + 0.07;
  for (const sx of [1, -1]) { T.box(0.15, 0.085, 0.12, sx * mx, belt + 0.07, mz, BLACK); T.box(0.1, 0.03, 0.03, sx * (mx - 0.09), belt + 0.03, mz + 0.02, BLACK); }
  // wipers
  const wzz = h.frontGlass[1] - 0.12, wy = belt + h.cabF(wzz) + 0.02;
  T.box(0.6, 0.012, 0.014, -0.25, wy, wzz, BLACK, { rz: 0.08 }); T.box(0.5, 0.012, 0.014, 0.35, wy, wzz, BLACK, { rz: 0.08 });
  // roof panel edge (rain gutter)
  if (h.rails) { for (const sx of [1, -1]) T.box(0.05, 0.05, h.roofZ[1] - h.roofZ[0], sx * (h.cw1 - 0.02), h.roofTop + 0.04, (h.roofZ[0] + h.roofZ[1]) / 2, BLACK); for (const zz of [-1.4, -0.6, 0.2]) T.box(h.cw1 * 2 - 0.02, 0.03, 0.05, 0, h.roofTop + 0.06, zz, BLACK); }
  // shark-fin antenna
  if (sed) T.box(0.04, 0.05, 0.12, 0, h.roofTop + 0.03, h.roofZ[0] + 0.2, BLACK);
  // style extras
  if (h.style === 'suv') { T.box(W * 1.9, 0.12, 0.1, 0, h.ybF(nose) + 0.05, nose - 0.14, GREY); for (const sx of [1, -1]) T.box(0.025, 0.1, zf - zr, sx * (W + 0.008), h.sill + 0.04, (zf + zr) / 2, BLACK); }
  if (h.style === 'sports') {
    const sy = h.ytF(tail + 0.2) + 0.2;
    T.box(1.5, 0.04, 0.34, 0, sy - 0.04, tail + 0.28, BLACK); for (const sx of [1, -1]) T.box(0.04, 0.16, 0.16, sx * 0.55, sy - 0.12, tail + 0.28, BLACK);
    T.box(W * 1.6, 0.04, 0.4, 0, h.ybF(nose) + 0.01, nose - 0.2, BLACK);
    for (const sx of [1, -1]) { T.box(0.4, 0.015, 0.4, sx * 0.4, h.ytF(1.3) + 0.002, 1.3, BLACK, { rx: -0.15 }); T.box(0.055, 0.045, 0.06, sx * 0.4, h.ybF(tail) + 0.1, tail - 0.03, CHROME); T.box(0.03, 0.09, 0.4, sx * (W + 0.005), h.sill + 0.34, h.wz[0] - 0.62, BLACK); }
  }
  if (h.style === 'van' || h.style === 'minibus') {
    T.box(W * 1.9, 0.16, 0.14, 0, h.ybF(nose) + 0.1, nose - 0.08, GREY);
    if (h.style === 'van') { T.box(0.012, h.roofTop - h.belt - 0.1, 0.012, 0, (h.belt + h.roofTop) / 2, tail - 0.002, BLACK); for (const yy of [0.2, 0.75]) for (const sx of [1, -1]) T.box(0.06, 0.1, 0.014, sx * 0.9, h.belt + yy, tail - 0.002, GREY); T.box(0.5, 0.06, 0.4, 0.2, h.roofTop + 0.03, -0.8, GREY); }
    for (const sx of [1, -1]) T.box(0.03, 0.04, 2.2, sx * (W + 0.01), h.belt - 0.24, -0.7, GREY);
  }
  if (kind === 'police') { // push bar + light bar base
    T.box(hn * 1.3, 0.18, 0.04, 0, h.ybF(nose) + 0.28, nose + 0.04, BLACK); T.box(0.04, 0.3, 0.04, 0.3, h.ybF(nose) + 0.27, nose + 0.03, BLACK); T.box(0.04, 0.3, 0.04, -0.3, h.ybF(nose) + 0.27, nose + 0.03, BLACK);
    const z = (h.roofZ[0] + h.roofZ[1]) / 2; T.box(0.9, 0.05, 0.3, 0, h.roofTop + 0.025, z, BLACK);
  }
  return T;
}

function boxVC(g, col) { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }

function buildLamps(h, kind, braking) {
  const T = new Boxes(), nose = h.nose, tail = h.tail, lx = h.lampX;
  const HEAD = [3.0, 2.9, 2.5], DRL = [3.6, 3.6, 3.4], AMB = [2.4, 1.0, 0.1];
  const yaw = 0.3;
  // headlights: main cluster, DRL strip, indicator, fog lamp
  const hz = nose - 0.075 - (h.hwF(nose - 0.1) < 0.75 ? 0.04 : 0);
  T.box(0.34, 0.09, 0.045, lx, h.headY, hz, HEAD, { ry: yaw }); T.box(0.34, 0.09, 0.045, -lx, h.headY, hz, HEAD, { ry: -yaw });
  T.box(0.28, 0.016, 0.05, lx - 0.02, h.headY - 0.065, hz + 0.004, DRL, { ry: yaw }); T.box(0.28, 0.016, 0.05, -lx + 0.02, h.headY - 0.065, hz + 0.004, DRL, { ry: -yaw });
  T.box(0.07, 0.04, 0.048, lx + 0.17, h.headY - 0.015, hz - 0.045, AMB, { ry: yaw }); T.box(0.07, 0.04, 0.048, -lx - 0.17, h.headY - 0.015, hz - 0.045, AMB, { ry: -yaw });
  if (h.style !== 'van' && h.style !== 'minibus') { T.box(0.12, 0.05, 0.04, lx * 0.8, h.ybF(nose) + 0.23, nose - 0.035, [1.6, 1.5, 1.2]); T.box(0.12, 0.05, 0.04, -lx * 0.8, h.ybF(nose) + 0.23, nose - 0.035, [1.6, 1.5, 1.2]); }
  // tail lights: lens, indicator, reverse, centre bar
  const RED = braking ? [4.2, 0.1, 0.07] : [0.62, 0.035, 0.03], AMBT = braking ? [2.0, 0.9, 0.1] : [0.55, 0.25, 0.02], REV = braking ? [0.8, 0.8, 0.8] : [0.45, 0.45, 0.45];
  const tz = tail + 0.065 - (h.hwF(tail + 0.1) < 0.8 ? 0.0 : 0.03);
  T.box(0.42, 0.11, 0.045, lx, h.tailY, tz, RED, { ry: Math.PI - yaw * 0.8 }); T.box(0.42, 0.11, 0.045, -lx, h.tailY, tz, RED, { ry: Math.PI + yaw * 0.8 });
  T.box(0.14, 0.035, 0.047, lx - 0.1, h.tailY - 0.09, tz - 0.003, AMBT, { ry: Math.PI }); T.box(0.14, 0.035, 0.047, -lx + 0.1, h.tailY - 0.09, tz - 0.003, AMBT, { ry: Math.PI });
  T.box(0.08, 0.035, 0.047, lx + 0.12, h.tailY - 0.09, tz - 0.003, REV, { ry: Math.PI }); T.box(0.08, 0.035, 0.047, -lx - 0.12, h.tailY - 0.09, tz - 0.003, REV, { ry: Math.PI });
  if (h.style !== 'van' && h.style !== 'minibus' && h.style !== 'suv') T.box(lx * 2 - 0.6, 0.04, 0.04, 0, h.tailY, tail + 0.0, braking ? [3.0, 0.2, 0.14] : [0.4, 0.03, 0.025]);
  if (braking) T.box(0.4, 0.025, 0.03, 0, h.roofTop - 0.03, h.rearGlass ? h.rearGlass[0] + 0.1 : tail, [3.5, 0.2, 0.14]); // high-mounted brake light (sits in the rear glass)
  // taxi roof sign
  if (kind === 'taxi') {
    const g = new THREE.BoxGeometry(0.62, 0.17, 0.22), z = (h.roofZ[0] + h.roofZ[1]) / 2, y = h.roofTop + 0.1;
    g.translate(0, y, z);
    const gg = g.toNonIndexed(), n = gg.attributes.position.count, c = new Float32Array(n * 3), uv = new Float32Array(n * 2), src = gg.attributes.uv;
    for (let i = 0; i < n; i++) {
      const face = Math.floor(i / 6); // BoxGeometry order +x,-x,+y,-y,+z,-z
      const front = face === 4 || face === 5;
      c[i * 3] = 2.2; c[i * 3 + 1] = 2.0; c[i * 3 + 2] = 1.5;
      if (front) { uv[i * 2] = lerp(SIGN_UV[0], SIGN_UV[2], src.getX(i)); uv[i * 2 + 1] = lerp(SIGN_UV[1], SIGN_UV[3], src.getY(i)); } else { uv[i * 2] = WHITE_UV[0]; uv[i * 2 + 1] = WHITE_UV[1]; }
    }
    gg.setAttribute('color', new THREE.BufferAttribute(c, 3)); gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    T.list.push(gg);
  }
  return T;
}

// ------------------------------------------------------------------ wheels
function wheelGeometry(r, w) {
  const seg = QUALITY === 'low' ? 14 : 22;
  const parts = [];
  // tyre: rounded lathe profile (radius, axial)
  const hw = w / 2;
  const prof = [[0.62, 0.94], [0.7, 1.0], [0.84, 1.0], [0.95, 0.92], [1.0, 0.7], [1.0, 0.0]];
  const pts = prof.map(([rr, aa]) => new THREE.Vector2(rr * r, -aa * hw));
  for (let i = prof.length - 2; i >= 0; i--) pts.push(new THREE.Vector2(prof[i][0] * r, prof[i][1] * hw));
  const tire = new THREE.LatheGeometry(pts, seg); tire.rotateZ(Math.PI / 2);
  parts.push(colored(plain(tire), 0x0b0b0c));
  // rim lip + dished face
  const rimPts = [new THREE.Vector2(0.6 * r, hw * 0.84), new THREE.Vector2(0.56 * r, hw * 0.8), new THREE.Vector2(0.5 * r, hw * 0.55), new THREE.Vector2(0.18 * r, hw * 0.6), new THREE.Vector2(0.17 * r, hw * 0.78), new THREE.Vector2(0.0001, hw * 0.8)];
  for (const s of [1, -1]) { const rim = new THREE.LatheGeometry(rimPts.map((p) => new THREE.Vector2(p.x, p.y * s)), seg); rim.rotateZ(Math.PI / 2); parts.push(colored(plain(rim), 0x8f949c)); }
  // spokes (5, outward face of both sides) and brake disc / caliper behind
  for (const s of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.BoxGeometry(0.04, r * 0.44, r * 0.115); sp.translate(0, r * 0.37, 0); sp.rotateX((i / 5) * Math.PI * 2); sp.translate(s * hw * 0.72, 0, 0);
      parts.push(colored(plain(sp), 0x7d838c));
    }
    const hub = new THREE.CylinderGeometry(r * 0.15, r * 0.15, 0.05, 10); hub.rotateZ(Math.PI / 2); hub.translate(s * hw * 0.8, 0, 0); parts.push(colored(plain(hub), 0x555a62));
  }
  const disc = new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 0.42, 18); disc.rotateZ(Math.PI / 2); parts.push(colored(plain(disc), 0x2a2c30));
  const cal = new THREE.BoxGeometry(w * 0.5, r * 0.22, r * 0.3); cal.translate(0, r * 0.3, r * 0.2); parts.push(colored(plain(cal), 0x8a1c1c));
  return mergeGeometries(parts, false);
}

// ------------------------------------------------------------------ assembled geometry sets (cached)
function liveryName(kind) { return kind === 'taxi' ? (A.sg ? 'taxi_sg' : 'taxi_ny') : kind === 'police' ? (A.sg ? 'police_sg' : 'police_ny') : null; }

function buildGeometries(style, spec, kind) {
  const liv = liveryName(kind);
  const key = `${style}|${liv || ''}|${spec.wr}|${spec.ww}|${spec.L}|${spec.W}`;
  if (A.geo[key]) return A.geo[key];
  const h = makeHull(style, spec);
  const sx = spec.W / h.W, sz = spec.L / h.L;
  let uvm;
  if (liv) { const row = LIV_ROW[liv]; uvm = makeUV(h, [0, row], [1, row], 2, 4); }
  else { const c = GEN_CELL[style]; uvm = makeUV(h, c, c, 4, 4); }
  const paint = new Soup(), glass = new Soup();
  emitBody(h, paint, glass, uvm);
  const body = paint.geometry(sx, sz, Math.PI / 4.2), gl = glass.geometry(sx, sz, Math.PI / 5);
  const lampOff = buildLamps(h, kind, false).geometry(sx, sz), lampOn = buildLamps(h, kind, true).geometry(sx, sz);
  const wheel = wheelGeometry(spec.wr, spec.ww);
  const pair = (() => { const a = wheel.clone(), b = wheel.clone(); const x = h.wx[1] * sx; a.translate(x, 0, 0); b.translate(-x, 0, 0); return mergeGeometries([a, b], false); })();
  // far LOD: extruded silhouette, vertex colours so the instance colour tints the paint only
  const bodyPoly = [], steps = 16;
  for (let i = 0; i <= steps; i++) { const z = h.tail + ((h.nose - h.tail) * i) / steps; bodyPoly.push([z * sz, h.ytF(z)]); }
  for (let i = steps; i >= 0; i--) { const z = h.tail + ((h.nose - h.tail) * i) / steps; bodyPoly.push([z * sz, h.ybF(z)]); }
  const cabPoly = [], cs = 12;
  for (let i = 0; i <= cs; i++) { const z = h.cz0 + ((h.cz1 - h.cz0) * i) / cs; cabPoly.push([z * sz, h.belt + h.cabF(z)]); }
  cabPoly.push([h.cz1 * sz, h.belt - 0.03], [h.cz0 * sz, h.belt - 0.03]);
  const lodBody = colored(plain(extrudeProfile(bodyPoly, spec.W)), 0xffffff);
  const lodGlass = colored(plain(extrudeProfile(cabPoly, spec.W - 0.12)), 0x10161c);
  const stubs = [];
  for (const wz of h.wz) for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(spec.wr, spec.wr, spec.ww + 0.05, 7); g.rotateZ(Math.PI / 2);
    g.translate(s * (spec.W / 2 - 0.12), spec.wr, wz * sz); stubs.push(colored(plain(g), 0x0b0b0c));
  }
  const lod = mergeGeometries([lodBody, lodGlass, ...stubs], false);
  const wzs = h.wz.map((z) => z * sz), wxs = h.wx.map((x) => x * sx);
  return (A.geo[key] = { h, body, glass: gl, kind, lampOff, lampOn, wheel, pair, lod, wzs, wxs, sx, sz, trims: {} });
}
/** trim carries the number plates, so it is cached per plate variant (4) on top of the shared body set */
function trimFor(G, plateVar) { return G.trims[plateVar] || (G.trims[plateVar] = buildTrim(G.h, G.kind, plateVar).geometry(G.sx, G.sz)); }
const lodCache = new Map();
function lodGeometry(style, spec) {
  if (spec.mesh === 'bus') return busLod();
  const key = `${style}|${spec.wr}|${spec.W}|${spec.L}`;
  let g = lodCache.get(key);
  if (!g) { g = buildGeometries(style, spec, spec.mesh === 'sedan' ? 'sedan' : spec.mesh === 'van' ? 'van' : spec.mesh).lod; lodCache.set(key, g); }
  return g;
}

// ------------------------------------------------------------------ model
export class CarModel {
  constructor(kind) {
    const spec = SPECS[kind];
    this.kind = kind; this.spec = spec;
    this.plateVar = (Math.random() * 4) | 0;
    this.style = styleFor(kind, kind === 'taxi' ? TAXI_YELLOW : kind === 'police' ? POLICE_WHITE : PAINTS[0]);
    const G = buildGeometries(this.style, spec, kind);
    this.root = new THREE.Group();
    const shadow = A.quality === 'high' || A.quality === 'ultra';
    this.paintMeshes = [];
    const mk = (geo, mat, cast = false) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast && shadow; m.matrixAutoUpdate = true; this.root.add(m); return m; };
    const livMat = kind === 'taxi' || kind === 'police' ? liveryMaterial(liveryName(kind)) : null;
    this.body = mk(G.body, livMat || paintMaterial(PAINTS[0]), true);
    this.roof = this.body;                     // roof panel is part of the body mesh now
    this.paintMeshes.push(this.body);
    this.glass = mk(G.glass, A.glass);
    this.trim = mk(trimFor(G, this.plateVar), A.trim);
    this.head = mk(G.lampOff, A.lamp);         // head + tail lamps in one mesh; braking swaps the geometry
    this.tail = this.head;
    this.lights = this.head;
    this.braking = false;
    this.steerPivots = []; this.wheels = [];
    // front wheels (steering pivots) and one rear axle mesh carrying both rear wheels
    this._frontPivots = [];
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(G.wheel, A.wheel); m.castShadow = false;
      const piv = new THREE.Group(); piv.add(m); this.root.add(piv); this.steerPivots.push(piv); this._frontPivots.push(piv); this.wheels.push(m);
      piv.userData.side = sx;
    }
    const rear = new THREE.Mesh(G.pair, A.wheel); rear.castShadow = false; this.root.add(rear); this.wheels.push(rear); this._rear = rear;
    this._placeWheels(G);
    this.extras = {};
    if (kind === 'taxi') this.extras.sign = this.head;
    if (kind === 'police') {
      const z = (G.h.roofZ[0] + G.h.roofZ[1]) / 2 * G.sz, y = G.h.roofTop;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.02, 0.02), toneMapped: false }));
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.04, 0.25), toneMapped: false }));
      bar.position.set(0.25, y + 0.11, z); bar2.position.set(-0.25, y + 0.11, z);
      this.root.add(bar, bar2);
      this.extras.red = bar; this.extras.blue = bar2;
    }
    this.root.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });
    this.spin = 0;
    this._sirenPhase = 0;
    this._hex = undefined;
  }

  _placeWheels(G) {
    const wr = this.spec.wr;
    this._frontPivots.forEach((p, i) => { const sx = i === 0 ? 1 : -1; p.position.set(sx * G.wxs[0], wr, G.wzs[0]); });
    this._rear.position.set(0, wr, G.wzs[1]);
  }

  /** switch the body style (sedan <-> hatchback, van <-> minibus) when a pooled model is re-used for another paint */
  _setStyle(style) {
    if (style === this.style) return;
    this.style = style;
    const G = buildGeometries(style, this.spec, this.kind);
    this.body.geometry = G.body; this.glass.geometry = G.glass; this.trim.geometry = trimFor(G, this.plateVar);
    this._lampG = G;
    this.head.geometry = this.braking ? G.lampOn : G.lampOff;
    this.wheels[0].geometry = G.wheel; this.wheels[1].geometry = G.wheel; this._rear.geometry = G.pair;
    this._placeWheels(G);
    if (this.extras.red) { const z = (G.h.roofZ[0] + G.h.roofZ[1]) / 2 * G.sz, y = G.h.roofTop; this.extras.red.position.set(0.25, y + 0.11, z); this.extras.blue.position.set(-0.25, y + 0.11, z); }
  }

  setPaint(hex) {
    this._hex = hex;
    this._setStyle(styleFor(this.kind, hex));
    if (this.kind === 'taxi' || this.kind === 'police') { const m = liveryMaterial(liveryName(this.kind)); for (const p of this.paintMeshes) p.material = m; return; }
    const mat = paintMaterial(hex);
    for (const m of this.paintMeshes) m.material = mat;
  }
  setCharred(on) {
    for (const m of this.paintMeshes) m.material = on ? A.charred : (this.kind === 'taxi' || this.kind === 'police' ? liveryMaterial(liveryName(this.kind)) : paintMaterial(this._hex ?? 0x555555));
    if (on) { this.setBrake(false); this.siren(false, 0); }
  }
  setBrake(on) {
    if (on === this.braking) return;
    this.braking = on;
    const G = this._lampG || buildGeometries(this.style, this.spec, this.kind);
    this.head.geometry = on ? G.lampOn : G.lampOff;
  }
  /** steer: wheel angle in rad, positive = right. dist: metres rolled this frame (signed). */
  wheelsUpdate(steer, dist) {
    this.spin += dist / this.spec.wr;
    for (const p of this.steerPivots) p.rotation.y = -steer;
    for (const w of this.wheels) w.rotation.x = this.spin;
  }
  siren(on, t) {
    const e = this.extras;
    if (!e.red) return;
    const f = on ? (Math.floor(t * 9) % 2 === 0) : null;
    e.red.material.color.setRGB(f === true ? 6 : 0.25, f === true ? 0.2 : 0.02, f === true ? 0.15 : 0.02);
    e.blue.material.color.setRGB(f === false ? 0.2 : 0.02, f === false ? 0.9 : 0.04, f === false ? 6 : 0.25);
  }
}

// ------------------------------------------------------------------ far-LOD instancing
export class CarInstancer {
  constructor(scene, capacity) {
    this.meshes = {}; this.counts = {};
    this.tmp = new THREE.Object3D(); this.tmp.rotation.order = 'YXZ';
    this.keys = [];
    const seen = {};
    const variants = { sedan: ['sedan', 'hatch'], van: ['van', 'minibus'] };
    for (const k of KINDS) {
      const spec = SPECS[k];
      for (const style of (variants[k] || [spec.mesh])) {
        const key = k + '|' + style;
        if (seen[key]) continue; seen[key] = 1;
        const im = new THREE.InstancedMesh(lodGeometry(style, spec), A.lod, capacity);
        im.frustumCulled = false; im.count = 0; im.castShadow = false; im.receiveShadow = false;
        im.setColorAt(0, new THREE.Color(1, 1, 1));
        scene.add(im);
        this.meshes[key] = im; this.counts[key] = 0; this.keys.push(key);
      }
    }
  }
  begin() { for (const k of this.keys) this.counts[k] = 0; }
  add(kind, x, y, z, yaw, pitch, roll, color) {
    const key = kind + '|' + styleFor(kind, color.getHex());
    const im = this.meshes[key] || this.meshes[kind + '|' + SPECS[kind].mesh];
    const kk = this.meshes[key] ? key : kind + '|' + SPECS[kind].mesh, i = this.counts[kk]++;
    if (i >= im.instanceMatrix.count) { this.counts[kk]--; return; }
    const t = this.tmp;
    t.position.set(x, y, z); t.rotation.set(pitch, yaw, roll); t.updateMatrix();
    im.setMatrixAt(i, t.matrix); im.setColorAt(i, color);
  }
  end() {
    for (const k of this.keys) {
      const im = this.meshes[k]; im.count = this.counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  dispose() { for (const k of this.keys) this.meshes[k].removeFromParent(); }
}

export const assets = () => A;

// ------------------------------------------------------------------ city bus (12 m, boxy: MTA blue/white in New York, SBS purple/white in Singapore)
const busGeo = {};
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
function busColors() {
  return A.sg
    ? { body: lin(0xe9e9ee), band: lin(0x5a2a8c), band2: lin(0xc8102e), roof: lin(0xd4d6dc) }
    : { body: lin(0xe6e8ec), band: lin(0x0b3a8f), band2: lin(0xf2b600), roof: lin(0xd0d3d8) };
}
const BUS = { W: 2.55, L: 12, H: 3.15, y0: 0.5, zF: 6, zR: -6, wzF: 3.3, wzR: -2.6, glass0: 1.38, glass1: 2.78 };
function buildBusGeometries() {
  if (busGeo.body) return busGeo;
  const C = busColors(), W = BUS.W, hx = W / 2, H = BUS.H, y0 = BUS.y0, GL = [0.03, 0.045, 0.06];
  const P = new Boxes(), G = new Boxes(), T = new Boxes(), Lo = new Boxes(), Lb = new Boxes();
  const bodyH = H - y0;
  // main hull, rounded roof edges (two angled slabs), lower skirt band + thin accent line
  P.box(W, bodyH - 0.2, BUS.L - 0.3, 0, y0 + (bodyH - 0.2) / 2, 0, C.body);
  P.box(W - 0.3, 0.3, BUS.L - 0.3, 0, H - 0.17, 0, C.roof);
  for (const sx of [-1, 1]) P.box(0.34, 0.34, BUS.L - 0.3, sx * (hx - 0.12), H - 0.2, 0, C.body, { rz: sx * Math.PI / 4 });
  P.box(W - 0.2, bodyH - 0.3, 0.3, 0, y0 + (bodyH - 0.3) / 2 + 0.05, BUS.zF - 0.15, C.body);          // front cap
  P.box(W - 0.2, bodyH - 0.3, 0.3, 0, y0 + (bodyH - 0.3) / 2 + 0.05, BUS.zR + 0.15, C.body);          // rear cap
  for (const sx of [-1, 1]) {
    P.box(0.04, 0.62, BUS.L - 0.34, sx * (hx + 0.005), y0 + 0.33, 0, C.band);
    P.box(0.04, 0.09, BUS.L - 0.34, sx * (hx + 0.005), y0 + 0.74, 0, C.band2);
    P.box(0.04, 0.12, BUS.L - 0.34, sx * (hx + 0.005), BUS.glass0 - 0.1, 0, C.band);              // belt line under the windows
  }
  P.box(W - 0.1, 0.5, 0.05, 0, y0 + 0.3, BUS.zF + 0.005, C.band);                                  // front skirt
  P.box(W - 0.1, 0.5, 0.05, 0, y0 + 0.3, BUS.zR - 0.005, C.band);
  // windows: continuous dark band with pillars; doors (front and rear-centre) as darker glass panels
  const gh = BUS.glass1 - BUS.glass0, gy = (BUS.glass0 + BUS.glass1) / 2;
  for (const sx of [-1, 1]) {
    G.box(0.05, gh, 9.9, sx * (hx + 0.012), gy, -0.4, GL);
    for (let i = 0; i <= 7; i++) { const z = -5.2 + i * 1.3; P.box(0.07, gh + 0.06, 0.1, sx * (hx + 0.016), gy, z, C.body); }
  }
  G.box(W - 0.3, 1.45, 0.05, 0, 2.08, BUS.zF + 0.015, GL);                                           // windscreen
  G.box(W - 0.5, 0.7, 0.05, 0, 1.95, BUS.zR - 0.015, GL);                                             // rear window
  P.box(0.07, 1.5, 0.1, 0, 2.08, BUS.zF + 0.02, C.body);                                             // windscreen centre post
  // trim: bumpers, wheel arches, roof AC pod, mirrors, door seams
  T.box(W - 0.05, 0.22, 0.2, 0, y0 + 0.05, BUS.zF + 0.05, BLACK);
  T.box(W - 0.05, 0.22, 0.2, 0, y0 + 0.05, BUS.zR - 0.05, BLACK);
  T.box(1.3, 0.3, 0.06, 0, y0 + 0.62, BUS.zF + 0.035, GREY);                                         // grille
  T.box(1.2, 0.3, 0.05, 0, y0 + 0.62, BUS.zR - 0.03, GREY);                                           // engine louvres
  for (const sx of [-1, 1]) {
    for (const wz of [BUS.wzF, BUS.wzR]) T.box(0.07, 1.0, 1.35, sx * (hx + 0.02), 0.62, wz, BLACK);
    T.box(0.1, 0.55, 0.05, sx * (hx + 0.02), 0.5 + 1.0, BUS.zF - 0.5, BLACK);                         // door seams, front door
    T.box(0.35, 0.5, 0.06, sx * (hx + 0.28), 2.35, BUS.zF - 0.4, BLACK, { ry: sx * 0.15 });            // mirror
  }
  T.box(1.6, 0.34, 3.2, 0, H + 0.1, -3.4, GREY);
  T.box(1.0, 0.2, 1.6, 0, H + 0.05, 1.6, GREY);
  // lamps
  const HEAD = [3.0, 2.9, 2.5], DEST = [2.4, 1.1, 0.12];
  for (const sx of [-1, 1]) Lo.box(0.4, 0.16, 0.05, sx * 0.95, y0 + 0.5, BUS.zF + 0.045, HEAD);
  Lo.box(1.6, 0.2, 0.05, 0, 3.0, BUS.zF + 0.02, DEST);                                                // destination sign
  Lo.box(1.0, 0.18, 0.05, 0, 2.95, BUS.zR - 0.02, DEST);
  const tails = (b, on) => { const R = on ? [4.2, 0.1, 0.07] : [0.62, 0.035, 0.03]; for (const sx of [-1, 1]) { b.box(0.22, 0.5, 0.05, sx * 1.1, 1.0, BUS.zR - 0.04, R); b.box(0.2, 0.14, 0.05, sx * 1.1, 1.38, BUS.zR - 0.04, on ? [2.0, 0.9, 0.1] : [0.55, 0.25, 0.02]); } };
  tails(Lo, false); tails(Lb, true);
  for (const sx of [-1, 1]) Lb.box(0.4, 0.16, 0.05, sx * 0.95, y0 + 0.5, BUS.zF + 0.045, HEAD);
  Lb.box(1.6, 0.2, 0.05, 0, 3.0, BUS.zF + 0.02, DEST); Lb.box(1.0, 0.18, 0.05, 0, 2.95, BUS.zR - 0.02, DEST);
  busGeo.body = P.geometry(1, 1); busGeo.glass = G.geometry(1, 1); busGeo.trim = T.geometry(1, 1);
  busGeo.lampOff = Lo.geometry(1, 1); busGeo.lampOn = Lb.geometry(1, 1);
  busGeo.wheel = wheelGeometry(0.5, 0.3);
  busGeo.pair = (() => { const a = busGeo.wheel.clone(), b = busGeo.wheel.clone(); const x = hx - 0.2; a.translate(x, 0, 0); b.translate(-x, 0, 0); return mergeGeometries([a, b], false); })();
  return busGeo;
}
let busLodG = null;
function busLod() {
  if (busLodG) return busLodG;
  const C = busColors(), parts = [];
  const bx = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(colored(plain(g), new THREE.Color().setRGB(col[0], col[1], col[2]))); };
  bx(BUS.W, BUS.H - BUS.y0, BUS.L, 0, BUS.y0 + (BUS.H - BUS.y0) / 2, 0, C.body);
  for (const sx of [-1, 1]) {
    bx(0.04, 0.62, BUS.L - 0.3, sx * (BUS.W / 2 + 0.01), BUS.y0 + 0.33, 0, C.band);
    bx(0.05, BUS.glass1 - BUS.glass0, 9.9, sx * (BUS.W / 2 + 0.012), (BUS.glass0 + BUS.glass1) / 2, -0.4, [0.03, 0.045, 0.06]);
    for (const wz of [BUS.wzF, BUS.wzR]) { const g = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 7); g.rotateZ(Math.PI / 2); g.translate(sx * (BUS.W / 2 - 0.15), 0.5, wz); parts.push(colored(plain(g), 0x0b0b0c)); }
  }
  bx(BUS.W - 0.3, 1.45, 0.05, 0, 2.08, BUS.zF + 0.02, [0.03, 0.045, 0.06]);
  busLodG = mergeGeometries(parts, false);
  return busLodG;
}

export class BusModel {
  constructor() {
    const kind = 'bus', spec = SPECS.bus;
    this.kind = kind; this.spec = spec;
    const G = buildBusGeometries();
    this.root = new THREE.Group();
    this.paintMat = BusModel._paint ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
    const shadow = A.quality === 'high' || A.quality === 'ultra';
    const mk = (geo, mat, cast = false) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast && shadow; this.root.add(m); return m; };
    this.body = mk(G.body, this.paintMat, true);
    this.paintMeshes = [this.body];
    this.glass = mk(G.glass, A.glass);
    this.trim = mk(G.trim, A.trim);
    this.head = mk(G.lampOff, A.lamp);
    this.tail = this.head; this.lights = this.head;
    this.braking = false;
    this.steerPivots = []; this.wheels = [];
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(G.wheel, A.wheel);
      const piv = new THREE.Group(); piv.add(m); piv.position.set(sx * (BUS.W / 2 - 0.2), spec.wr, BUS.wzF);
      this.root.add(piv); this.steerPivots.push(piv); this.wheels.push(m);
    }
    const rear = new THREE.Mesh(G.pair, A.wheel); rear.position.set(0, spec.wr, BUS.wzR); this.root.add(rear); this.wheels.push(rear);
    this.extras = {};
    this.spin = 0;
  }
  setPaint() { /* single livery per map */ }
  setCharred(on) { this.body.material = on ? A.charred : this.paintMat; if (on) this.setBrake(false); }
  setBrake(on) {
    if (on === this.braking) return;
    this.braking = on;
    const G = buildBusGeometries();
    this.head.geometry = on ? G.lampOn : G.lampOff;
  }
  wheelsUpdate(steer, dist) {
    this.spin += dist / this.spec.wr;
    for (const p of this.steerPivots) p.rotation.y = -steer;
    for (const w of this.wheels) w.rotation.x = this.spin;
  }
  siren() {}
}

