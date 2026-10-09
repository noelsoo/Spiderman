// All textures are generated procedurally on canvases (no downloads).
import * as THREE from 'three';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function mk(c, aniso, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const mul = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

function warmLight(rng) {
  const r = rng();
  if (r < 0.12) return [205, 228, 255];
  if (r < 0.3) return [255, 236, 190];
  return [255, 190 + rng() * 40, 110 + rng() * 40];
}

function noiseFill(g, w, h, base, amp, rng) {
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rng() - 0.5) * amp;
    img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/**
 * Facade tile: 8 x 8 windows. Returns { map, emissive }.
 * opt: kind glass|brick|stone|concrete, lit (0..1), base [r,g,b], pane [r,g,b]
 */
function facade(opt, rng, aniso) {
  const S = 512, cols = 8, rows = 8, cw = S / cols, ch = S / rows;
  const [c, g] = cv(S, S);
  const [e, ge] = cv(S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);

  const litPane = (x, y, w, h) => {
    const l = warmLight(rng), k = 0.55 + rng() * 0.45;
    g.fillStyle = rgb(l[0], l[1], l[2], 0.92); g.fillRect(x, y, w, h);
    const grd = ge.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, rgb(l[0] * k, l[1] * k, l[2] * k)); grd.addColorStop(1, rgb(l[0] * k * 0.7, l[1] * k * 0.7, l[2] * k * 0.7));
    ge.fillStyle = grd; ge.fillRect(x, y, w, h);
  };

  if (opt.kind === 'glass') {
    g.fillStyle = rgb(...mul(opt.base, 0.7)); g.fillRect(0, 0, S, S);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw, y = cy * ch, k = 0.8 + rng() * 0.45;
      const px = x + 1.5, py = y + ch * 0.05, pw = cw - 3, ph = ch * 0.74;
      if (rng() < opt.lit) { litPane(px, py, pw, ph); }
      else {
        const grd = g.createLinearGradient(0, py, 0, py + ph);
        grd.addColorStop(0, rgb(...mul(opt.pane, k * 1.35))); grd.addColorStop(1, rgb(...mul(opt.pane, k * 0.75)));
        g.fillStyle = grd; g.fillRect(px, py, pw, ph);
      }
      // mullion + slab edge
      g.fillStyle = rgb(...mul(opt.base, 0.35)); g.fillRect(x, y, 1.5, ch); g.fillRect(x, y + ch * 0.8, cw, 3);
    }
    // diagonal reflection streaks
    g.globalAlpha = 0.07; g.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const x0 = rng() * S, w = 20 + rng() * 50;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + w, 0); g.lineTo(x0 + w - 120, S); g.lineTo(x0 - 120, S); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  } else if (opt.kind === 'brick') {
    g.fillStyle = rgb(...mul(opt.base, 1.35)); g.fillRect(0, 0, S, S); // mortar
    for (let by = 0, row = 0; by < S; by += 8, row++) {
      for (let bx = -(row % 2) * 8; bx < S; bx += 16) {
        const k = 0.82 + rng() * 0.3;
        g.fillStyle = rgb(...mul(opt.base, k)); g.fillRect(bx + 1, by + 1, 14, 6);
      }
    }
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw, y = cy * ch;
      const wx = x + cw * 0.22, ww = cw * 0.56, wy = y + ch * 0.2, wh = ch * 0.62;
      g.fillStyle = rgb(...mul(opt.trim, 0.95)); g.fillRect(wx - 3, wy - 5, ww + 6, wh + 9); // frame + lintel
      g.fillRect(wx - 5, wy + wh + 2, ww + 10, 4); // sill
      if (rng() < opt.lit) litPane(wx, wy, ww, wh);
      else {
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        grd.addColorStop(0, rgb(70, 90, 110)); grd.addColorStop(1, rgb(25, 32, 42));
        g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
      }
      g.fillStyle = rgb(...mul(opt.trim, 0.8)); g.fillRect(wx + ww / 2 - 1, wy, 2, wh); g.fillRect(wx, wy + wh * 0.4, ww, 2);
    }
  } else if (opt.kind === 'stone') {
    noiseFill(g, S, S, opt.base, 14, rng);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw, y = cy * ch;
      g.fillStyle = rgb(...mul(opt.base, 1.1)); g.fillRect(x, y, 8, ch); // pier
      g.fillStyle = rgb(...mul(opt.base, 0.8)); g.fillRect(x + 8, y + ch * 0.82, cw - 8, ch * 0.18); // spandrel
      g.fillStyle = rgb(190, 160, 90, 0.8); g.fillRect(x + 8, y + ch * 0.80, cw - 8, 2); // brass band
      const wx = x + cw * 0.26, ww = cw * 0.5, wy = y + ch * 0.1, wh = ch * 0.68;
      g.fillStyle = rgb(...mul(opt.base, 0.55)); g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      if (rng() < opt.lit) litPane(wx, wy, ww, wh);
      else {
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        grd.addColorStop(0, rgb(95, 115, 135)); grd.addColorStop(1, rgb(35, 42, 55));
        g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
      }
    }
  } else { // concrete ribbon windows
    noiseFill(g, S, S, opt.base, 18, rng);
    for (let cy = 0; cy < rows; cy++) {
      const y = cy * ch;
      g.fillStyle = rgb(...mul(opt.base, 0.8)); g.fillRect(0, y + ch * 0.82, S, ch * 0.18);
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cw, px = x + 3, py = y + ch * 0.14, pw = cw - 6, ph = ch * 0.62;
        if (rng() < opt.lit) litPane(px, py, pw, ph);
        else {
          const grd = g.createLinearGradient(0, py, 0, py + ph);
          grd.addColorStop(0, rgb(...mul(opt.pane, 1.3))); grd.addColorStop(1, rgb(...mul(opt.pane, 0.7)));
          g.fillStyle = grd; g.fillRect(px, py, pw, ph);
        }
        g.fillStyle = rgb(...mul(opt.base, 0.6)); g.fillRect(x, y, 3, ch);
      }
    }
  }
  const map = mk(c, aniso), emissive = mk(e, aniso);
  return { map, emissive };
}

function storefront(rng, aniso) {
  const W = 512, H = 192;
  const [c, g] = cv(W, H); const [e, ge] = cv(W, H);
  g.fillStyle = '#1d1a1a'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const awn = [[170, 40, 40], [30, 90, 60], [30, 50, 110], [200, 170, 110], [90, 40, 90]];
  const bays = 3, bw = W / bays;
  for (let i = 0; i < bays; i++) {
    const x = i * bw, a = awn[(rng() * awn.length) | 0];
    for (let s = 0; s < 8; s++) { g.fillStyle = s % 2 ? rgb(...mul(a, 1.25)) : rgb(...mul(a, 0.8)); g.fillRect(x + 6 + s * ((bw - 12) / 8), 36, (bw - 12) / 8, 24); }
    g.fillStyle = '#26211f'; g.fillRect(x + 6, 6, bw - 12, 26);
    const l = warmLight(rng);
    g.fillStyle = rgb(l[0], l[1], l[2], 0.9); g.fillRect(x + 14, 12, bw - 28, 14);
    ge.fillStyle = rgb(l[0] * 0.7, l[1] * 0.7, l[2] * 0.7); ge.fillRect(x + 14, 12, bw - 28, 14);
    const l2 = warmLight(rng), k = 0.6 + rng() * 0.4;
    const grd = g.createLinearGradient(0, 68, 0, 180);
    grd.addColorStop(0, rgb(l2[0], l2[1], l2[2])); grd.addColorStop(1, rgb(l2[0] * 0.6, l2[1] * 0.55, l2[2] * 0.5));
    g.fillStyle = grd; g.fillRect(x + 12, 68, bw - 24, 112);
    ge.fillStyle = rgb(l2[0] * k, l2[1] * k, l2[2] * k); ge.fillRect(x + 12, 68, bw - 24, 112);
    g.fillStyle = '#15110f'; g.fillRect(x + bw / 2 - 1.5, 68, 3, 112); g.fillRect(x + 12, 120, bw - 24, 3);
  }
  return { map: mk(c, aniso), emissive: mk(e, aniso) };
}

function asphalt(rng, aniso) {
  const S = 256, [c, g] = cv(S, S);
  noiseFill(g, S, S, [84, 82, 84], 28, rng);
  for (let i = 0; i < 60; i++) { g.fillStyle = rgb(0, 0, 0, 0.05 + rng() * 0.06); g.fillRect(rng() * S, rng() * S, 20 + rng() * 60, 10 + rng() * 40); }
  for (let i = 0; i < 6; i++) { g.strokeStyle = rgb(20, 20, 22, 0.5); g.lineWidth = 1; g.beginPath(); let x = rng() * S, y = rng() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
  return mk(c, aniso);
}
function sidewalk(rng, aniso) {
  const S = 256, [c, g] = cv(S, S);
  noiseFill(g, S, S, [158, 154, 146], 22, rng);
  g.strokeStyle = rgb(70, 66, 60, 0.55); g.lineWidth = 2;
  for (let i = 0; i <= S; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  return mk(c, aniso);
}
function roof(rng, aniso) {
  const S = 256, [c, g] = cv(S, S);
  noiseFill(g, S, S, [104, 100, 98], 38, rng);
  for (let i = 0; i < 20; i++) { g.fillStyle = rgb(30, 30, 32, 0.05); g.fillRect(rng() * S, rng() * S, 30 + rng() * 60, 20 + rng() * 40); }
  return mk(c, aniso);
}
function grass(rng, aniso) {
  const S = 256, [c, g] = cv(S, S);
  noiseFill(g, S, S, [78, 118, 52], 34, rng);
  for (let i = 0; i < 80; i++) { g.fillStyle = rgb(60 + rng() * 40, 100 + rng() * 40, 40, 0.25); g.beginPath(); g.arc(rng() * S, rng() * S, 6 + rng() * 22, 0, 6.3); g.fill(); }
  return mk(c, aniso);
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

export function makeTextures(renderer, rng) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 4);
  const F = {
    glassTeal: facade({ kind: 'glass', base: [24, 62, 74], pane: [50, 135, 150], lit: 0.13 }, rng, aniso),
    glassBlue: facade({ kind: 'glass', base: [22, 38, 70], pane: [58, 100, 175], lit: 0.14 }, rng, aniso),
    glassSteel: facade({ kind: 'glass', base: [48, 54, 64], pane: [120, 140, 160], lit: 0.12 }, rng, aniso),
    brownstone: facade({ kind: 'brick', base: [118, 76, 58], trim: [190, 170, 145], lit: 0.2 }, rng, aniso),
    redbrick: facade({ kind: 'brick', base: [150, 66, 50], trim: [214, 205, 188], lit: 0.2 }, rng, aniso),
    limestone: facade({ kind: 'stone', base: [200, 184, 150], lit: 0.18 }, rng, aniso),
    concrete: facade({ kind: 'concrete', base: [150, 150, 148], pane: [70, 100, 130], lit: 0.15 }, rng, aniso),
  };
  return {
    facades: F,
    storefront: storefront(rng, aniso),
    asphalt: asphalt(rng, aniso),
    sidewalk: sidewalk(rng, aniso),
    roof: roof(rng, aniso),
    grass: grass(rng, aniso),
    sign: sign(aniso),
    pad: pad(aniso),
    cloud: cloud(rng),
    dot: dot(),
  };
}
