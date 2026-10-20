// All textures are generated procedurally on canvases (no downloads).
// Facades come as { map, emissive, normal, orm } (orm: G = roughness, B = metalness, multiplied by the material values).
import * as THREE from 'three';
import { mulberry32 } from './geo.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}
function mk(c, aniso, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const mul = (c = [128, 128, 128], k = 1) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const gray = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
const orm = (rough, metal) => `rgb(255,${(rough * 255) | 0},${(metal * 255) | 0})`;

function warmLight(rng) {
  const r = rng();
  if (r < 0.1) return [205, 228, 255];
  if (r < 0.2) return [255, 246, 220];
  if (r < 0.34) return [255, 236, 190];
  return [255, 190 + rng() * 40, 110 + rng() * 40];
}
const CURTAINS = [[200, 170, 140], [150, 62, 60], [70, 110, 150], [210, 205, 190], [90, 130, 90], [170, 120, 60], [120, 90, 140]];

function noiseFill(g, w, h, base, amp, rng) {
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rng() - 0.5) * amp;
    img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** Height canvas -> tangent-space normal map canvas (wraps around, so it tiles). */
function normalFromHeight(hc, strength) {
  const S = hc.width, src = hc.getContext('2d').getImageData(0, 0, S, S).data;
  const [c, g] = cv(S, S);
  const img = g.createImageData(S, S), o = img.data;
  const H = (x, y) => src[(((y + S) % S) * S + ((x + S) % S)) * 4];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = -(H(x + 1, y) - H(x - 1, y)) / 255 * strength, ny = (H(x, y + 1) - H(x, y - 1)) / 255 * strength;
    const l = 1 / Math.hypot(nx, ny, 1), i = (y * S + x) * 4;
    o[i] = (nx * l * 0.5 + 0.5) * 255; o[i + 1] = (ny * l * 0.5 + 0.5) * 255; o[i + 2] = (l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Colour + emissive + height + orm canvases that are drawn with the same (S x S) coordinates. */
function layers(S, S2, extras) {
  const [c, g] = cv(S, S), [e, ge] = cv(S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const L = { S, S2, extras, c, g, e, ge };
  if (extras) {
    const [h, gh] = cv(S2, S2), [m, gm] = cv(S2, S2);
    gh.scale(S2 / S, S2 / S); gm.scale(S2 / S, S2 / S);
    L.h = h; L.gh = gh; L.m = m; L.gm = gm;
  }
  return L;
}
/** fill the same rect on several layers; spec = { c, e, h, m } style strings (omitted = untouched) */
function R(L, x, y, w, h, s) {
  if (s.c) { L.g.fillStyle = s.c; L.g.fillRect(x, y, w, h); }
  if (s.e) { L.ge.fillStyle = s.e; L.ge.fillRect(x, y, w, h); }
  if (L.extras) {
    if (s.h !== undefined) { L.gh.fillStyle = typeof s.h === 'number' ? gray(s.h) : s.h; L.gh.fillRect(x, y, w, h); }
    if (s.m) { L.gm.fillStyle = s.m; L.gm.fillRect(x, y, w, h); }
  }
}

function drawLit(L, x, y, w, h, rng, wm) {
  const l = warmLight(rng), k = 0.55 + rng() * 0.5;
  const { g, ge } = L;
  let grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, rgb(l[0], l[1], l[2], 0.96)); grd.addColorStop(1, rgb(l[0] * 0.72, l[1] * 0.72, l[2] * 0.72, 0.96));
  g.fillStyle = grd; g.fillRect(x, y, w, h);
  grd = ge.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, rgb(l[0] * k, l[1] * k, l[2] * k)); grd.addColorStop(1, rgb(l[0] * k * 0.6, l[1] * k * 0.6, l[2] * k * 0.6));
  ge.fillStyle = grd; ge.fillRect(x, y, w, h);
  // ceiling light pool
  if (rng() < 0.55) {
    const rg = ge.createRadialGradient(x + w * (0.3 + rng() * 0.4), y, 0, x + w * 0.5, y, w * 0.8);
    rg.addColorStop(0, 'rgba(255,245,215,0.55)'); rg.addColorStop(1, 'rgba(255,245,215,0)');
    ge.fillStyle = rg; ge.fillRect(x, y, w, h);
  }
  const r = rng();
  if (r < 0.55) { // curtains
    const cw = w * (0.12 + rng() * 0.16), cc = CURTAINS[(rng() * CURTAINS.length) | 0];
    for (const cx of [x, x + w - cw]) {
      g.fillStyle = rgb(cc[0], cc[1], cc[2], 0.95); g.fillRect(cx, y, cw, h);
      ge.fillStyle = rgb(cc[0] * k * 0.5, cc[1] * k * 0.5, cc[2] * k * 0.5); ge.fillRect(cx, y, cw, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx + cw * 0.35, y, 2, h); g.fillRect(cx + cw * 0.7, y, 2, h);
      ge.fillStyle = 'rgba(0,0,0,0.3)'; ge.fillRect(cx + cw * 0.35, y, 2, h); ge.fillRect(cx + cw * 0.7, y, 2, h);
    }
  } else if (r < 0.8) { // half-drawn blinds
    const bh = h * (0.25 + rng() * 0.5);
    for (let yy = y; yy < y + bh; yy += 7) {
      g.fillStyle = 'rgba(225,210,185,0.95)'; g.fillRect(x, yy, w, 4);
      ge.fillStyle = rgb(l[0] * k * 0.55, l[1] * k * 0.55, l[2] * k * 0.55); ge.fillRect(x, yy, w, 4);
    }
  }
  if (rng() < 0.4) { // furniture / plant silhouette
    const w2 = w * (0.18 + rng() * 0.3), h2 = h * (0.15 + rng() * 0.32), x2 = x + w * (0.1 + rng() * 0.5);
    g.fillStyle = 'rgba(35,24,18,0.85)'; g.fillRect(x2, y + h - h2, w2, h2);
    ge.fillStyle = 'rgba(0,0,0,0.78)'; ge.fillRect(x2, y + h - h2, w2, h2);
  }
  if (L.extras) { L.gm.fillStyle = orm(0.5, 0); L.gm.fillRect(x, y, w, h); } // lit rooms: not mirror-like
}

function drawDark(L, x, y, w, h, rng, pane, hi = 1.35) {
  const { g } = L;
  const r = rng();
  if (r < 0.14) { // closed curtains
    const cc = CURTAINS[(rng() * CURTAINS.length) | 0], k = 0.28 + rng() * 0.2;
    g.fillStyle = rgb(cc[0] * k, cc[1] * k, cc[2] * k); g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let xx = x + w * 0.1; xx < x + w; xx += w * 0.14) g.fillRect(xx, y, 3, h);
    if (L.extras) { L.gm.fillStyle = orm(0.8, 0); L.gm.fillRect(x, y, w, h); }
    return;
  }
  const k = 0.8 + rng() * 0.4;
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, rgb(...mul(pane, k * hi))); grd.addColorStop(1, rgb(...mul(pane, k * 0.55)));
  g.fillStyle = grd; g.fillRect(x, y, w, h);
  if (r < 0.28) { // blinds
    const bh = h * (0.2 + rng() * 0.6);
    for (let yy = y; yy < y + bh; yy += 7) { g.fillStyle = 'rgba(150,140,125,0.85)'; g.fillRect(x, yy, w, 3.5); }
  } else if (r < 0.4) { // dim interior
    g.fillStyle = 'rgba(20,24,34,0.55)'; g.fillRect(x, y + h * 0.35, w, h * 0.65);
  }
  // soft sky-glint streak
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.beginPath(); g.moveTo(x + w * 0.55, y); g.lineTo(x + w * 0.85, y); g.lineTo(x + w * 0.25, y + h); g.lineTo(x - w * 0.05, y + h); g.closePath(); g.fill();
}

/**
 * Facade tile: 8 x 8 windows. opt: kind glass|brick|stone|concrete, lit (0..1), base [r,g,b], pane [r,g,b]
 */
function facade(opt, rng, aniso, S, extras) {
  const S2 = Math.min(S, 512), cols = 8, rows = 8, cw = S / cols, ch = S / rows;
  const L = layers(S, S2, extras);
  const { g, ge } = L;
  const wallM = orm(opt.kind === 'glass' ? 0.5 : 0.92, opt.kind === 'glass' ? 0.5 : 0);
  const winM = orm(0.08, opt.kind === 'glass' ? 0.9 : 0.55);
  const win = (x, y, w, h, kind = opt.kind) => {
    const lit = rng() < opt.lit;
    if (lit) drawLit(L, x, y, w, h, rng); else { drawDark(L, x, y, w, h, rng, opt.pane || [64, 88, 112], kind === 'glass' ? 1.35 : 1.0); if (extras) { L.gm.fillStyle = winM; L.gm.fillRect(x, y, w, h); } }
  };

  if (opt.kind === 'glass') {
    R(L, 0, 0, S, S, { c: rgb(...mul(opt.base, 0.7)), h: 150, m: wallM });
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw, y = cy * ch;
      const px = x + 3, py = y + ch * 0.05, pw = cw - 6, ph = ch * 0.74;
      R(L, px, py, pw, ph, { h: 70 });
      win(px, py, pw, ph);
      // mullion + slab edge
      R(L, x, y, 3, ch, { c: rgb(...mul(opt.base, 0.35)), h: 215 });
      R(L, x, y + ch * 0.8, cw, 6, { c: rgb(...mul(opt.base, 0.35)), h: 230, m: orm(0.5, 0.6) });
      R(L, x, y + ch * 0.8 + 6, cw, ch * 0.2 - 6, { c: rgb(...mul(opt.base, 0.55)), h: 150, m: orm(0.45, 0.5) });
    }
    g.globalAlpha = 0.06; g.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const x0 = rng() * S, w = 40 + rng() * 100;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + w, 0); g.lineTo(x0 + w - 240, S); g.lineTo(x0 - 240, S); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  } else if (opt.kind === 'brick') {
    R(L, 0, 0, S, S, { c: rgb(...mul(opt.base, 1.3)), h: 70, m: wallM }); // mortar
    const bh = S / 128, bw = S / 52;
    for (let by = 0, row = 0; by < S; by += bh, row++) {
      for (let bx = -(row % 2) * bw / 2; bx < S; bx += bw) {
        const k = 0.8 + rng() * 0.34;
        R(L, bx + 1, by + 1, bw - 2, bh - 2, { c: rgb(...mul(opt.base, k)), h: 150 + rng() * 40 });
      }
    }
    // soot / weathering streaks
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let i = 0; i < 40; i++) g.fillRect(rng() * S, 0, 6 + rng() * 14, S * (0.2 + rng() * 0.8));
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw, y = cy * ch;
      const wx = x + cw * 0.22, ww = cw * 0.56, wy = y + ch * 0.2, wh = ch * 0.62;
      R(L, wx - 6, wy - 10, ww + 12, wh + 18, { c: rgb(...mul(opt.trim, 0.95)), h: 205, m: orm(0.8, 0) }); // frame + lintel
      R(L, wx - 10, wy + wh + 4, ww + 20, 9, { c: rgb(...mul(opt.trim, 0.85)), h: 235, m: orm(0.8, 0) }); // sill
      R(L, wx, wy, ww, wh, { h: 40 });
      win(wx, wy, ww, wh);
      R(L, wx + ww / 2 - 2, wy, 4, wh, { c: rgb(...mul(opt.trim, 0.8)), h: 225 });
      R(L, wx, wy + wh * 0.4, ww, 4, { c: rgb(...mul(opt.trim, 0.8)), h: 225 });
    }
  } else if (opt.kind === 'stone') {
    noiseFill(g, S, S, opt.base, 16, rng);
    R(L, 0, 0, S, S, { h: 140, m: wallM });
    for (let yy = 0; yy < S; yy += 24) R(L, 0, yy, S, 2, { c: rgb(...mul(opt.base, 0.82)), h: 100 }); // courses
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw, y = cy * ch;
      R(L, x, y, 16, ch, { c: rgb(...mul(opt.base, 1.1)), h: 200 }); // pier
      R(L, x + 16, y + ch * 0.82, cw - 16, ch * 0.18, { c: rgb(...mul(opt.base, 0.8)), h: 120 }); // spandrel
      R(L, x + 16, y + ch * 0.79, cw - 16, 4, { c: rgb(190, 160, 90, 0.85), h: 235, m: orm(0.35, 0.8) }); // brass band
      const wx = x + cw * 0.26, ww = cw * 0.5, wy = y + ch * 0.1, wh = ch * 0.68;
      R(L, wx - 4, wy - 4, ww + 8, wh + 8, { c: rgb(...mul(opt.base, 0.55)), h: 215 });
      R(L, wx, wy, ww, wh, { h: 45 });
      win(wx, wy, ww, wh);
      R(L, wx + ww / 2 - 1.5, wy, 3, wh, { c: rgb(...mul(opt.base, 0.5)), h: 225 });
    }
  } else if (opt.kind === 'hdb') { // Singapore HDB slab block: colour-banded walls, open corridors, stair cores
    noiseFill(g, S, S, opt.base, 14, rng);
    R(L, 0, 0, S, S, { h: 150, m: wallM });
    for (let cy = 0; cy < rows; cy++) {
      const y = cy * ch;
      // corridor slab edge + parapet wall with a coloured band
      R(L, 0, y + ch * 0.9, S, ch * 0.1, { c: rgb(...mul(opt.base, 0.62)), h: 235 });
      R(L, 0, y + ch * 0.58, S, ch * 0.32, { c: rgb(...mul(opt.base, 0.93)), h: 175 });
      R(L, 0, y + ch * 0.55, S, ch * 0.035, { c: rgb(...mul(opt.base, 1.1)), h: 225 });
      R(L, 0, y + ch * 0.62, S, ch * 0.04, { c: rgb(...opt.accent), h: 160 });
      // corridor rail posts and the dark recess behind them
      R(L, 0, y + ch * 0.66, S, ch * 0.24, { c: rgb(...mul(opt.base, 0.8)), h: 120 });
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cw;
        const core = cx === 3 || cx === 4; // stair / lift core
        if (core) {
          R(L, x, y, cw, ch, { c: rgb(...mul(opt.accent, 0.9)), h: 190, m: wallM });
          R(L, x + cw * 0.38, y + ch * 0.15, cw * 0.24, ch * 0.62, { h: 45 });
          win(x + cw * 0.38, y + ch * 0.15, cw * 0.24, ch * 0.62);
        } else {
          const wx = x + cw * 0.16, ww = cw * 0.68, wy = y + ch * 0.1, wh = ch * 0.43;
          R(L, wx - 3, wy - 3, ww + 6, wh + 6, { c: rgb(...mul(opt.base, 0.55)), h: 210 }); // frame
          R(L, wx, wy, ww, wh, { h: 45 });
          win(wx, wy, ww, wh, 'glass');
          R(L, wx + ww / 2 - 1.5, wy, 3, wh, { c: rgb(...mul(opt.base, 0.5)), h: 220 });
          R(L, wx - 6, wy + wh + 3, ww + 12, 6, { c: rgb(...mul(opt.base, 0.7)), h: 230 }); // sill / AC ledge
          // AC condenser or hanging washing, sparsely
          const r2 = rng();
          if (r2 < 0.12) R(L, x + cw * 0.55, y + ch * 0.64, cw * 0.32, ch * 0.2, { c: rgb(170, 172, 170), h: 215 });
          else if (r2 < 0.2) { const lc = [[220, 70, 60], [60, 120, 200], [235, 220, 90], [240, 240, 240]][(rng() * 4) | 0]; R(L, x + cw * 0.3, y + ch * 0.56, cw * 0.1, ch * 0.3, { c: rgb(...lc), h: 170 }); R(L, x + cw * 0.5, y + ch * 0.56, cw * 0.1, ch * 0.3, { c: rgb(...lc), h: 170 }); }
        }
      }
    }
  } else if (opt.kind === 'shop') { // Singapore shophouse: pastel plaster, arched shuttered windows, five-foot-way pilasters
    noiseFill(g, S, S, opt.base, 12, rng);
    R(L, 0, 0, S, S, { h: 140, m: wallM });
    for (let cy = 0; cy < rows; cy++) {
      const y = cy * ch;
      R(L, 0, y + ch * 0.9, S, ch * 0.1, { c: rgb(...mul(opt.base, 1.12)), h: 230 }); // string course
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cw;
        R(L, x, y, cw * 0.1, ch, { c: rgb(...mul(opt.base, 1.1)), h: 200 }); // pilaster
        const wx = x + cw * 0.22, ww = cw * 0.56, wy = y + ch * 0.18, wh = ch * 0.66;
        R(L, wx - 3, wy - 5, ww + 6, wh + 8, { c: rgb(...mul(opt.base, 1.15)), h: 215 }); // moulded surround
        R(L, wx, wy, ww, wh, { c: rgb(...mul(opt.trim, 0.8)), h: 60 });
        if (rng() < 0.45) { // louvred shutters, half open
          const open = rng() < 0.5, sw2 = ww * (open ? 0.3 : 0.5);
          for (const sx of [wx, wx + ww - sw2]) {
            R(L, sx, wy, sw2, wh, { c: rgb(...opt.trim), h: 175 });
            for (let ly = wy + 3; ly < wy + wh; ly += 5) R(L, sx, ly, sw2, 1.6, { c: rgb(...mul(opt.trim, 0.55)), h: 120 });
          }
          if (open) win(wx + sw2, wy, ww - sw2 * 2, wh, 'glass');
        } else win(wx, wy, ww, wh, 'glass');
        R(L, wx - 6, wy + wh + 2, ww + 12, 5, { c: rgb(...mul(opt.base, 0.8)), h: 235 });
      }
    }
  } else { // concrete ribbon windows
    noiseFill(g, S, S, opt.base, 22, rng);
    R(L, 0, 0, S, S, { h: 150, m: wallM });
    for (let cy = 0; cy < rows; cy++) {
      const y = cy * ch;
      R(L, 0, y + ch * 0.82, S, ch * 0.18, { c: rgb(...mul(opt.base, 0.8)), h: 120 });
      R(L, 0, y + ch * 0.82 - 3, S, 4, { c: rgb(...mul(opt.base, 1.2)), h: 225 });
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cw, px = x + 6, py = y + ch * 0.14, pw = cw - 12, ph = ch * 0.62;
        R(L, px - 3, py - 3, pw + 6, ph + 6, { c: rgb(...mul(opt.base, 0.6)), h: 205 });
        R(L, px, py, pw, ph, { h: 45 });
        win(px, py, pw, ph);
        R(L, x, y, 6, ch, { c: rgb(...mul(opt.base, 0.6)), h: 200 });
      }
    }
  }
  // weathering: rain streaks run down from sills and parapets (colour layer only)
  if (opt.kind !== 'glass') {
    for (let i = 0; i < 70; i++) {
      const x = rng() * S, y0 = rng() * S, l = 30 + rng() * 150, w = 2 + rng() * 7;
      const gr = g.createLinearGradient(0, y0, 0, y0 + l);
      gr.addColorStop(0, 'rgba(25,22,18,0.16)'); gr.addColorStop(1, 'rgba(25,22,18,0)');
      g.fillStyle = gr; g.fillRect(x, y0, w, l);
    }
    for (let i = 0; i < 6; i++) { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.05)'); g.fillStyle = gr; g.fillRect(rng() * S, 0, 20 + rng() * 60, S); }
  } else {
    // curtain-wall: individual panes catch a different slice of sky; vary roughness/metal a little per pane
    g.globalAlpha = 0.07;
    for (let i = 0; i < 28; i++) { g.fillStyle = rng() < 0.5 ? '#bfe6ff' : '#0a1a24'; g.fillRect(((rng() * cols) | 0) * cw + 3, ((rng() * rows) | 0) * ch + ch * 0.05, cw - 6, ch * 0.74); }
    g.globalAlpha = 1;
  }
  const out = { map: mk(L.c, aniso), emissive: mk(L.e, aniso) };
  if (extras) {
    out.normal = mk(normalFromHeight(L.h, opt.kind === 'glass' ? 2.2 : 3.2), aniso, false);
    out.orm = mk(L.m, aniso, false);
  }
  return out;
}

const SHOP_NAMES = ['DELI', 'PIZZA', 'CAFE', 'BOOKS', 'PHARMACY', 'LAUNDRY', 'NAILS', 'TAILOR', 'BAGELS', 'NOODLES', 'FLORIST', 'GROCERY', 'BARBER', 'TACOS', 'VINYL', 'OPTICAL', 'BAKERY', 'WINE & SPIRITS', 'ELECTRONICS', 'DINER', 'COMICS', 'SUSHI', 'THRIFT', 'HARDWARE'];
const SIGN_COLORS = [[240, 70, 70], [250, 200, 70], [90, 220, 255], [255, 120, 200], [120, 255, 160], [255, 255, 255], [255, 150, 60]];

function storefront(rng, aniso, big, extras) {
  const W = big ? 2048 : 1024, H = big ? 384 : 192, bays = 6, bw = W / bays, k = W / 2048;
  const [c, g] = cv(W, H); const [e, ge] = cv(W, H);
  g.fillStyle = '#1d1a1a'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  g.scale(k * (big ? 1 : 1), k * (big ? 1 : 1)); ge.scale(k, k);
  // draw in a 2048 x 384 coordinate system
  const BW = 2048 / bays;
  const awn = [[170, 40, 40], [30, 90, 60], [30, 50, 110], [200, 170, 110], [90, 40, 90], [210, 120, 30]];
  for (let i = 0; i < bays; i++) {
    const x = i * BW, a = awn[(rng() * awn.length) | 0], sc = SIGN_COLORS[(rng() * SIGN_COLORS.length) | 0];
    // fascia + neon sign text
    g.fillStyle = '#211c1b'; g.fillRect(x + 8, 10, BW - 16, 62);
    ge.fillStyle = '#000'; ge.fillRect(x + 8, 10, BW - 16, 62);
    const name = SHOP_NAMES[(rng() * SHOP_NAMES.length) | 0];
    for (const [ctx, mulv] of [[g, 1], [ge, 0.85]]) {
      ctx.font = '700 42px "Arial Black", Impact, "DejaVu Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = rgb(sc[0], sc[1], sc[2]); ctx.shadowBlur = ctx === ge ? 14 : 6;
      ctx.fillStyle = rgb(sc[0] * mulv, sc[1] * mulv, sc[2] * mulv);
      ctx.fillText(name, x + BW / 2, 42, BW - 40);
      ctx.shadowBlur = 0;
    }
    // striped awning
    const sw = (BW - 24) / 10;
    for (let s = 0; s < 10; s++) { g.fillStyle = s % 2 ? rgb(...mul(a, 1.3)) : rgb(...mul(a, 0.75)); g.fillRect(x + 12 + s * sw, 80, sw, 44); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 12, 124, BW - 24, 6);
    // lit shop window
    const l2 = warmLight(rng), kk = 0.6 + rng() * 0.4;
    const gy0 = 138, gy1 = 372;
    const grd = g.createLinearGradient(0, gy0, 0, gy1);
    grd.addColorStop(0, rgb(l2[0], l2[1], l2[2])); grd.addColorStop(1, rgb(l2[0] * 0.55, l2[1] * 0.5, l2[2] * 0.45));
    g.fillStyle = grd; g.fillRect(x + 20, gy0, BW - 40, gy1 - gy0);
    const eg = ge.createLinearGradient(0, gy0, 0, gy1);
    eg.addColorStop(0, rgb(l2[0] * kk, l2[1] * kk, l2[2] * kk)); eg.addColorStop(1, rgb(l2[0] * kk * 0.55, l2[1] * kk * 0.55, l2[2] * kk * 0.55));
    ge.fillStyle = eg; ge.fillRect(x + 20, gy0, BW - 40, gy1 - gy0);
    // goods silhouettes on shelves
    for (let sh = 0; sh < 3; sh++) {
      const sy = gy0 + 40 + sh * 62;
      g.fillStyle = 'rgba(30,20,14,0.8)'; g.fillRect(x + 28, sy + 40, BW - 56, 5);
      ge.fillStyle = 'rgba(0,0,0,0.75)'; ge.fillRect(x + 28, sy + 40, BW - 56, 5);
      for (let n = 0; n < 9; n++) {
        const gw = 10 + rng() * 22, gh = 14 + rng() * 26, gx = x + 34 + rng() * (BW - 90);
        const col = rng() < 0.5 ? 'rgba(40,28,20,0.75)' : rgb(120 + rng() * 120, 70 + rng() * 120, 60 + rng() * 120, 0.8);
        g.fillStyle = col; g.fillRect(gx, sy + 40 - gh, gw, gh);
        ge.fillStyle = 'rgba(0,0,0,0.35)'; ge.fillRect(gx, sy + 40 - gh, gw, gh);
      }
    }
    // door in some bays, frame, mullions, OPEN sign
    g.fillStyle = '#15110f';
    g.fillRect(x + 20, gy0 - 4, BW - 40, 5); g.fillRect(x + 20, gy1, BW - 40, 6);
    g.fillRect(x + 16, gy0, 6, gy1 - gy0); g.fillRect(x + BW - 22, gy0, 6, gy1 - gy0);
    if (rng() < 0.5) { g.fillRect(x + BW * 0.62, gy0, 6, gy1 - gy0); g.fillRect(x + BW * 0.62 + 90, gy0, 6, gy1 - gy0); }
    if (rng() < 0.6) {
      g.fillStyle = '#ff3b30'; g.fillRect(x + BW * 0.12, gy0 + 14, 62, 26);
      ge.fillStyle = rgb(255, 60, 40); ge.fillRect(x + BW * 0.12, gy0 + 14, 62, 26);
      g.fillStyle = '#000'; g.font = '700 16px Arial'; g.textAlign = 'center'; g.fillText('OPEN', x + BW * 0.12 + 31, gy0 + 28);
    }
  }
  return { map: mk(c, aniso), emissive: mk(e, aniso) };
}

function asphalt(rng, aniso, S, extras) {
  const [c, g] = cv(S, S);
  noiseFill(g, S, S, [76, 75, 78], 30, rng);
  // coarse aggregate speckle (light and dark chips)
  for (let i = 0; i < S * 5; i++) {
    const v = rng();
    g.fillStyle = v < 0.5 ? rgb(150, 148, 145, 0.18 + rng() * 0.2) : rgb(18, 18, 20, 0.2 + rng() * 0.2);
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
  for (let i = 0; i < 90; i++) { // worn / repaired patches
    const a = rng() < 0.5 ? 0.07 : -0.06;
    g.fillStyle = a > 0 ? rgb(255, 255, 255, a) : rgb(0, 0, 0, -a);
    g.fillRect(rng() * S, rng() * S, 30 + rng() * 140, 14 + rng() * 90);
  }
  // utility-trench patches: darker, fresher asphalt with a hairline edge
  const patches = [];
  for (let i = 0; i < 6; i++) {
    const w = 80 + rng() * 170, h = 40 + rng() * 110, x = rng() * (S - w), y = rng() * (S - h);
    g.fillStyle = rgb(40, 40, 43, 0.22); g.fillRect(x, y, w, h);
    g.strokeStyle = rgb(8, 8, 10, 0.4); g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    patches.push([x, y, w, h]);
  }
  // oil drips and tyre-dark blotches
  const oils = [];
  for (let i = 0; i < 28; i++) {
    const x = rng() * S, y = rng() * S, r = 6 + rng() * 26, grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(10,10,12,0.3)'); grd.addColorStop(1, 'rgba(10,10,12,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    oils.push([x, y, r]);
  }
  // cracks: main crack plus a few branches, drawn as polylines (kept for the height map)
  g.lineCap = 'round';
  const cracks = [];
  for (let i = 0; i < 16; i++) {
    const pts = []; let x = rng() * S, y = rng() * S, ang = rng() * 6.28;
    pts.push([x, y]);
    const n = 8 + ((rng() * 8) | 0);
    for (let k = 0; k < n; k++) {
      ang += (rng() - 0.5) * 1.3; const l = 14 + rng() * 46;
      x += Math.cos(ang) * l; y += Math.sin(ang) * l; pts.push([x, y]);
      if (rng() < 0.16) { // branch
        let bx = x, by = y, ba = ang + (rng() < 0.5 ? 1 : -1) * (0.6 + rng() * 0.6); const bp = [[bx, by]];
        for (let q = 0; q < 3; q++) { ba += (rng() - 0.5); bx += Math.cos(ba) * (10 + rng() * 22); by += Math.sin(ba) * (10 + rng() * 22); bp.push([bx, by]); }
        cracks.push({ pts: bp, w: 0.8 });
      }
    }
    cracks.push({ pts, w: 1.2 + rng() * 1.4 });
  }
  const stroke = (ctx, col, wMul) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const cr of cracks) {
      ctx.strokeStyle = col; ctx.lineWidth = cr.w * wMul; ctx.beginPath();
      cr.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  };
  stroke(g, rgb(10, 10, 12, 0.7), 1);
  // tar-filled seams: a pale, slightly glossy line next to some cracks
  g.save(); g.translate(1.5, 1.5); stroke(g, rgb(140, 138, 134, 0.14), 0.7); g.restore();
  const t = mk(c, aniso);
  if (!extras) return { map: t };
  const H = S / 2, k = H / S;
  const [h, gh] = cv(H, H);
  noiseFill(gh, H, H, [128, 128, 128], 130, rng);
  gh.save(); gh.scale(k, k);
  for (const [x, y, w, hh] of patches) { gh.fillStyle = rgb(150, 150, 150, 0.6); gh.fillRect(x, y, w, hh); gh.strokeStyle = '#202020'; gh.lineWidth = 3; gh.strokeRect(x, y, w, hh); }
  stroke(gh, '#101010', 2.2); // cracks are grooves
  gh.restore();
  // roughness: dry asphalt ~0.9, polished wear and puddle sheen are lower. G = roughness, B = metalness
  const [m, gm] = cv(H, H);
  gm.fillStyle = 'rgb(255,226,0)'; gm.fillRect(0, 0, H, H);
  const img = gm.getImageData(0, 0, H, H);
  for (let i = 0; i < H * H; i++) img.data[i * 4 + 1] = 205 + rng() * 40;
  gm.putImageData(img, 0, 0);
  gm.save(); gm.scale(k, k);
  for (const [x, y, r] of oils) { // oil film and shallow puddles are glossy
    if (rng() < 0.55) continue;
    const rr = r * (1.6 + rng() * 1.4), grd = gm.createRadialGradient(x, y, 0, x, y, rr);
    grd.addColorStop(0, 'rgba(255,70,0,0.9)'); grd.addColorStop(0.6, 'rgba(255,120,0,0.45)'); grd.addColorStop(1, 'rgba(255,226,0,0)');
    gm.fillStyle = grd; gm.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  gm.globalAlpha = 0.5; stroke(gm, 'rgb(255,150,0)', 1.4); // tar seams are smoother than the aggregate
  gm.restore();
  return { map: t, normal: mk(normalFromHeight(h, 1.8), aniso, false), orm: mk(m, aniso, false) };
}

function sidewalk(rng, aniso, S, extras) {
  const [c, g] = cv(S, S);
  noiseFill(g, S, S, [166, 161, 152], 18, rng);
  const n = 4, slab = S / n;
  // each paving slab gets its own tone and a slight lean so the grid does not read as a repeat
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const t = rng();
    g.fillStyle = t < 0.5 ? rgb(255, 250, 235, 0.03 + rng() * 0.08) : rgb(0, 0, 0, 0.03 + rng() * 0.08);
    g.fillRect(i * slab, j * slab, slab, slab);
    if (rng() < 0.25) { const gr = g.createLinearGradient(i * slab, j * slab, (i + 1) * slab, (j + 1) * slab); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.08)'); g.fillStyle = gr; g.fillRect(i * slab, j * slab, slab, slab); }
  }
  for (let i = 0; i < 70; i++) { g.fillStyle = rgb(0, 0, 0, 0.03 + rng() * 0.04); g.fillRect(rng() * S, rng() * S, 20 + rng() * 80, 20 + rng() * 80); }
  for (let i = 0; i < 160; i++) { g.fillStyle = rgb(60, 56, 50, 0.4 + rng() * 0.3); g.fillRect(rng() * S, rng() * S, 2 + rng() * 3, 2 + rng() * 3); } // gum
  // salt-pitting speckle
  for (let i = 0; i < S * 3; i++) { g.fillStyle = rgb(rng() < 0.5 ? 235 : 70, rng() < 0.5 ? 232 : 66, 60, 0.12 + rng() * 0.15); g.fillRect(rng() * S, rng() * S, 1, 1 + rng() * 1.5); }
  g.strokeStyle = rgb(52, 49, 44, 0.8); g.lineWidth = 3;
  for (let i = 0; i <= S; i += slab) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  // bright bevel on the slab edges
  g.strokeStyle = rgb(230, 225, 214, 0.18); g.lineWidth = 2;
  for (let i = 0; i <= S; i += slab) { g.beginPath(); g.moveTo(i + 3, 0); g.lineTo(i + 3, S); g.stroke(); g.beginPath(); g.moveTo(0, i + 3); g.lineTo(S, i + 3); g.stroke(); }
  const cr = [];
  for (let i = 0; i < 5; i++) { const pts = []; let x = rng() * S, y = rng() * S; pts.push([x, y]); for (let k = 0; k < 5; k++) { x += (rng() - 0.5) * 70; y += (rng() - 0.5) * 70; pts.push([x, y]); } cr.push(pts); }
  const drawCr = (ctx, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; for (const pts of cr) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); } };
  drawCr(g, rgb(46, 43, 39, 0.55), 1.5);
  const t = mk(c, aniso);
  if (!extras) return { map: t };
  const [h, gh] = cv(S, S);
  noiseFill(gh, S, S, [200, 200, 200], 44, rng);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 190 + rng() * 25; gh.fillStyle = gray(v); gh.fillRect(i * slab + 4, j * slab + 4, slab - 8, slab - 8); }
  gh.strokeStyle = '#282828'; gh.lineWidth = 8;
  for (let i = 0; i <= S; i += slab) { gh.beginPath(); gh.moveTo(i, 0); gh.lineTo(i, S); gh.stroke(); gh.beginPath(); gh.moveTo(0, i); gh.lineTo(S, i); gh.stroke(); }
  drawCr(gh, '#202020', 3);
  return { map: t, normal: mk(normalFromHeight(h, 2.2), aniso, false) };
}

function roof(rng, aniso, S) {
  const [c, g] = cv(S, S);
  noiseFill(g, S, S, [104, 100, 98], 44, rng);
  for (let i = 0; i < 40; i++) { g.fillStyle = rgb(30, 30, 32, 0.05); g.fillRect(rng() * S, rng() * S, 40 + rng() * 120, 30 + rng() * 80); }
  for (let i = 0; i < 12; i++) { g.fillStyle = rgb(190, 190, 195, 0.05); g.fillRect(rng() * S, rng() * S, 60 + rng() * 120, 40 + rng() * 80); }
  g.strokeStyle = rgb(20, 20, 22, 0.25); g.lineWidth = 2; // seams
  for (let x = 0; x < S; x += S / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  return mk(c, aniso);
}
function grass(rng, aniso) {
  const S = 512, [c, g] = cv(S, S);
  noiseFill(g, S, S, [78, 118, 52], 38, rng);
  for (let i = 0; i < 140; i++) { g.fillStyle = rgb(60 + rng() * 40, 100 + rng() * 40, 40, 0.25); g.beginPath(); g.arc(rng() * S, rng() * S, 8 + rng() * 34, 0, 6.3); g.fill(); }
  return mk(c, aniso);
}

function drawNeon(g, text, w, h, col, size = 0.62, font = '"Arial Black", Impact, "DejaVu Sans", sans-serif') {
  g.font = `900 ${Math.floor(h * size)}px ${font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = rgb(col[0], col[1], col[2]); g.shadowBlur = h * 0.22; g.fillStyle = rgb(col[0], col[1], col[2]);
  g.fillText(text, w / 2, h * 0.53, w * 0.92);
  g.shadowBlur = h * 0.05; g.fillStyle = rgb(255, 255 * 0.5 + col[1] * 0.5, 255 * 0.5 + col[2] * 0.5, 0.95);
  g.fillText(text, w / 2, h * 0.53, w * 0.92);
  g.shadowBlur = 0;
}

function sign(aniso) {
  const [c, g] = cv(1024, 256);
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 256);
  g.font = '900 176px Impact, "Arial Black", "DejaVu Sans", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#5ec8ff'; g.shadowBlur = 40; g.fillStyle = '#7fd0ff';
  g.fillText('AVENGERS', 512, 136);
  g.shadowBlur = 12; g.fillStyle = '#eaf8ff'; g.fillText('AVENGERS', 512, 136);
  const t = mk(c, aniso); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

const NEON_WORDS = ['HOTEL', 'PIZZA', 'BAR', 'DINER', 'LIVE', 'OPEN 24H', 'SUSHI', 'RAMEN', 'TACOS', 'COFFEE', 'BOOKS', 'VINYL', 'JAZZ', 'CASINO', 'CAFE', 'PUB',
  'TATTOO', 'NOODLES', 'BURGER', 'KARAOKE', 'ARCADE', 'CINEMA', 'SPA', 'DELI', 'BAGELS', 'GYM', 'CLUB', 'MOTEL', 'LOUNGE', 'HOT DOGS', 'STEAKS', 'COMICS'];
const NEON_COLS = [[255, 60, 90], [60, 220, 255], [255, 190, 60], [190, 90, 255], [90, 255, 150], [255, 110, 200], [255, 255, 255]];
/** 4 x 8 atlas of neon words, 512 x 128 per tile. */
function neonAtlas(aniso) {
  const [c, g] = cv(2048, 1024);
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 1024);
  NEON_WORDS.forEach((w, i) => {
    const col = i % 4, row = (i / 4) | 0;
    g.save(); g.translate(col * 512, row * 128);
    const cc = NEON_COLS[i % NEON_COLS.length];
    g.strokeStyle = rgb(cc[0], cc[1], cc[2], 0.55); g.lineWidth = 3; g.strokeRect(8, 8, 496, 112);
    drawNeon(g, w, 512, 128, cc, 0.5);
    g.restore();
  });
  const t = mk(c, aniso); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

const SCREEN_ADS = [
  ['STARK INDUSTRIES', 'Tomorrow, built today', [20, 90, 200], [255, 255, 255]],
  ['DAILY BUGLE', 'WALL-CRAWLER: HERO OR MENACE?', [190, 150, 30], [20, 20, 20]],
  ['OSCORP', 'Better living through science', [10, 110, 60], [220, 255, 230]],
  ['PYM PARTICLES', 'Think small.', [120, 30, 150], [255, 235, 255]],
  ['NYC JAZZ FEST', 'Live all week', [200, 40, 80], [255, 240, 200]],
  ['QUEENS COLA', 'Taste the borough', [190, 20, 20], [255, 255, 255]],
  ['HELLS KITCHEN EATS', 'Open late', [230, 110, 20], [30, 10, 0]],
  ['AVENGERS EXPO', 'Meet your heroes', [20, 40, 120], [120, 220, 255]],
];
/** 4 x 2 atlas of animated-billboard frames, 384 x 256 each. */
function screenAtlas(aniso, rng) {
  const [c, g] = cv(1536, 512);
  SCREEN_ADS.forEach((ad, i) => {
    const col = i % 4, row = (i / 4) | 0;
    g.save(); g.translate(col * 384, row * 256); g.beginPath(); g.rect(0, 0, 384, 256); g.clip();
    const grd = g.createLinearGradient(0, 0, 384, 256);
    grd.addColorStop(0, rgb(...mul(ad[2], 1.1))); grd.addColorStop(1, rgb(...mul(ad[2], 0.35)));
    g.fillStyle = grd; g.fillRect(0, 0, 384, 256);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(rng() * 384, rng() * 256, 30 + rng() * 80, 0, 6.3); g.fill(); }
    g.fillStyle = rgb(...ad[3]); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 44px "Arial Black", Impact, "DejaVu Sans", sans-serif';
    g.fillText(ad[0], 192, 108, 360);
    g.font = '600 20px Arial, "DejaVu Sans", sans-serif';
    g.fillText(ad[1], 192, 160, 350);
    g.fillStyle = rgb(ad[3][0], ad[3][1], ad[3][2], 0.9); g.fillRect(40, 190, 304, 4);
    g.restore();
  });
  const t = mk(c, aniso); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

export const SHOP_DEFS = [
  { name: 'STARK ARMORY', col: [90, 200, 255] },
  { name: "HELL'S KITCHEN ARMS", col: [255, 90, 60] },
  { name: 'QUEENS GUN CLUB', col: [255, 200, 70] },
  { name: 'OSCORP SURPLUS', col: [120, 255, 150] },
];
/** neon sign strips (1024 x 256 each, stacked) and window displays (2 x 2 of 512 x 256) */
function shopTextures(aniso, rng) {
  const [sc, sg] = cv(1024, 1024);
  sg.fillStyle = '#05080c'; sg.fillRect(0, 0, 1024, 1024);
  SHOP_DEFS.forEach((d, i) => {
    sg.save(); sg.translate(0, i * 256);
    sg.fillStyle = '#0b0f14'; sg.fillRect(0, 0, 1024, 256);
    sg.strokeStyle = rgb(d.col[0], d.col[1], d.col[2]); sg.lineWidth = 8; sg.shadowColor = rgb(d.col[0], d.col[1], d.col[2]); sg.shadowBlur = 20;
    sg.strokeRect(14, 14, 996, 228); sg.shadowBlur = 0;
    drawNeon(sg, d.name, 1024, 256, d.col, d.name.length > 14 ? 0.42 : 0.5);
    sg.restore();
  });
  const [wc, wg] = cv(1024, 512);
  SHOP_DEFS.forEach((d, i) => {
    const col = i % 2, row = (i / 2) | 0;
    wg.save(); wg.translate(col * 512, row * 256); wg.beginPath(); wg.rect(0, 0, 512, 256); wg.clip();
    const grd = wg.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#ffe2a8'); grd.addColorStop(1, '#8a5a30');
    wg.fillStyle = grd; wg.fillRect(0, 0, 512, 256);
    // back wall rack with long guns
    wg.fillStyle = 'rgba(40,26,16,0.85)'; wg.fillRect(20, 30, 472, 6); wg.fillRect(20, 96, 472, 6);
    for (let n = 0; n < 9; n++) {
      const x = 34 + n * 50 + rng() * 6;
      wg.fillStyle = 'rgba(20,14,10,0.9)'; wg.fillRect(x, 38, 34, 7); wg.fillRect(x + 22, 32, 14, 16); wg.fillRect(x - 6, 104, 40, 6); wg.fillRect(x + 18, 98, 10, 14);
    }
    // counter with pistols and ammo boxes
    wg.fillStyle = 'rgba(30,20,14,0.95)'; wg.fillRect(0, 170, 512, 86);
    wg.fillStyle = 'rgba(255,225,170,0.9)'; wg.fillRect(0, 168, 512, 5);
    for (let n = 0; n < 14; n++) {
      const x = 16 + n * 34 + rng() * 6; wg.fillStyle = n % 3 ? 'rgba(10,10,12,0.95)' : 'rgba(150,40,30,0.95)';
      wg.fillRect(x, 150 + (n % 3) * 4, 22, 14); wg.fillRect(x + 4, 160, 8, 12);
    }
    wg.fillStyle = rgb(d.col[0], d.col[1], d.col[2]); wg.globalAlpha = 0.85; wg.fillRect(180, 190, 150, 40); wg.globalAlpha = 1;
    wg.fillStyle = '#000'; wg.font = '900 22px "Arial Black", Impact, sans-serif'; wg.textAlign = 'center'; wg.textBaseline = 'middle'; wg.fillText('OPEN', 255, 211);
    wg.restore();
  });
  const st = mk(sc, aniso); st.wrapS = st.wrapT = THREE.ClampToEdgeWrapping;
  const wt = mk(wc, aniso); wt.wrapS = wt.wrapT = THREE.ClampToEdgeWrapping;
  return { signs: st, windows: wt };
}

function pad(aniso) {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#2a2d33'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f2c230'; g.lineWidth = 8; g.strokeRect(6, 6, 244, 244);
  g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 92, 0, 6.3); g.stroke();
  g.fillStyle = '#f2c230'; g.font = '900 120px Impact, "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('A', 128, 134);
  const t = mk(c, aniso); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function cloud(rng) {
  const S = 256, [c, g] = cv(S, S);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const x = S * (0.2 + rng() * 0.6), y = S * (0.35 + rng() * 0.3), r = 22 + rng() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.28)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function dot() {
  const [c, g] = cv(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** soft light pool for street lamps (additive, drawn on the ground) */
function pool() {
  const [c, g] = cv(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** far skyline silhouette strip (alpha = building mask, repeats around the horizon cylinder) */
function skylineStrip(rng) {
  const W = 4096, H = 256, [c, g] = cv(W, H);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fff';
  let x = 0;
  while (x < W) {
    const w = 28 + rng() * 90, h = 30 + Math.pow(rng(), 2.2) * 190;
    g.fillRect(x, H - h, w, h);
    if (rng() < 0.3) g.fillRect(x + w * 0.2, H - h - 14 - rng() * 30, w * 0.6, 40);
    if (rng() < 0.08) g.fillRect(x + w * 0.45, H - h - 50 - rng() * 40, 3, 60);
    x += w * (0.55 + rng() * 0.5);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}


/** Far-LOD window atlas: 8 x 8 windows (16 px cells). Pier texel (3, 3) is plain: roofs sample it with a constant uv. */
function farAtlas() {
  const S = 128, C = 16;
  const [c, g] = cv(S, S), [ce, ge] = cv(S, S);
  g.fillStyle = gray(225); g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const px = x * C + 4, py = y * C + 4;
    g.fillStyle = gray(70 + rnd() * 30); g.fillRect(px, py, 9, 10);
    if (rnd() < 0.16) { ge.fillStyle = rgb(255, 180 + rnd() * 40, 100 + rnd() * 40); ge.fillRect(px, py, 9, 10); }
  }
  const t = mk(c, 4), e = mk(ce, 4);
  return { map: t, emissive: e };
}

// How many values the original texture generator drew from the shared world rng, per tier. The world rng is advanced by the
// same amount after generating textures from a private stream, so the city layout stays identical when textures change.
const LEGACY_RNG_DRAWS = { low: 1016731, medium: 3179415, high: 4752357, ultra: 4752357 };

export function makeTextures(renderer, worldRng, quality = 'high') {
  const rng = mulberry32(0x7e57);
  const low = quality === 'low';
  const aniso = Math.min(quality === 'ultra' ? 16 : 8, renderer.capabilities.getMaxAnisotropy?.() ?? 4);
  const S = quality === 'high' || quality === 'ultra' ? 1024 : 512;
  const extras = !low;
  const f = (o) => facade(o, rng, aniso, S, extras);
  const F = {
    glassTeal: f({ kind: 'glass', base: [24, 62, 74], pane: [50, 135, 150], lit: 0.13 }),
    glassBlue: f({ kind: 'glass', base: [22, 38, 70], pane: [58, 100, 175], lit: 0.14 }),
    glassSteel: f({ kind: 'glass', base: [48, 54, 64], pane: [120, 140, 160], lit: 0.12 }),
    brownstone: f({ kind: 'brick', base: [118, 76, 58], trim: [190, 170, 145], lit: 0.2 }),
    redbrick: f({ kind: 'brick', base: [150, 66, 50], trim: [214, 205, 188], lit: 0.2 }),
    limestone: f({ kind: 'stone', base: [200, 184, 150], lit: 0.18 }),
    concrete: f({ kind: 'concrete', base: [150, 150, 148], pane: [70, 100, 130], lit: 0.15 }),
  };
  const asp = asphalt(rng, aniso, low ? 256 : 1024, extras);
  const sw = sidewalk(rng, aniso, low ? 256 : 512, extras);
  for (let i = LEGACY_RNG_DRAWS[quality] ?? LEGACY_RNG_DRAWS.high; i > 0; i--) worldRng();
  return {
    facades: F,
    /** Singapore-only facades (HDB slab block, shophouse), generated on first use so New York never pays for them. */
    ensureSg() {
      if (!F.hdb) {
        F.hdb = f({ kind: 'hdb', base: [238, 232, 220], accent: [205, 120, 95], pane: [60, 90, 110], lit: 0.26 });
        F.shophouse = f({ kind: 'shop', base: [235, 222, 200], trim: [70, 120, 105], pane: [60, 85, 100], lit: 0.22 });
      }
      return F;
    },
    storefront: storefront(rng, aniso, !low, extras),
    asphalt: asp.map, asphaltN: asp.normal, asphaltORM: asp.orm,
    sidewalk: sw.map, sidewalkN: sw.normal,
    roof: roof(rng, aniso, low ? 256 : 512),
    grass: grass(rng, aniso),
    sign: sign(aniso),
    neon: neonAtlas(aniso),
    screens: screenAtlas(aniso, rng),
    shop: shopTextures(aniso, rng),
    pad: pad(aniso),
    cloud: cloud(rng),
    dot: dot(),
    pool: pool(),
    skyline: skylineStrip(rng),
    far: farAtlas(),
    NEON_COUNT: NEON_WORDS.length,
  };
}
