// Shared head builder: displaced skull (brow ridge, sockets, nose, cheekbones, jaw, chin), painted face texture,
// ears, hair caps / strand ribbons, beard patches. All geometry lives in unit-ellipsoid coordinates and is
// scaled by the head mesh transform (R*sx, R*sy, R*sz), so it can be cached and shared between instances.
import * as THREE from 'three';
import { G, M, phys, std, seg, rng, texRes, mkCanvas, mkTex, mkNormalTex, heightToNormal, heightOf, sharedTexCache as texCache } from './common.js';

const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gs = (x, c, s) => { const d = (x - c) / s; return Math.exp(-d * d); };

export const SKULL_DEFAULT = {
  hollow: 0.3, brow: 0.055, browLat: 0.22, socket: 0.05, lid: 0.018, nose: 0.2, noseW: 1, cheek: 0.045, taper: 0.22, jawFlare: 0, jawBone: 0.03,
  chin: 0.07, chinW: 0.26, muzzle: 0.025, lips: 1, back: 0.05, fore: 0.02, temple: 0.02, eyeAz: 0.34, eyeLat: 0.05,
};

function polySd(px, py, pts) { // signed distance to polygon (negative inside)
  let d = Infinity, s = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    const ex = xj - xi, ey = yj - yi, wx = px - xi, wy = py - yi;
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = wx - ex * t, dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    const c1 = py >= yi, c2 = py < yj, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** direction d (unit) -> displaced point in unit-ellipsoid coordinates, written to out */
export function skullPoint(d, p, out) {
  const lat = Math.asin(clamp(d.y, -1, 1)), az = Math.atan2(d.x, d.z), aa = Math.abs(az);
  let r = 1;
  const front = d.z > -0.2;
  if (front) {
    // brow ridge (+ glabella), temple dent
    r += p.brow * gs(lat, p.browLat, 0.1) * gs(aa, 0, 0.75) * (1 + 0.35 * gs(aa, 0, 0.18));
    r -= p.temple * gs(lat, 0.12, 0.2) * gs(aa, 1.0, 0.22);
    r += p.fore * gs(lat, 0.52, 0.22) * gs(aa, 0, 0.55);
    // eye socket (dent) and upper lid ridge
    const ea = p.eyeAz, el = p.eyeLat;
    r -= p.socket * gs(lat, el, 0.1) * gs(aa, ea, 0.15);
    r += p.lid * gs(lat, el + 0.075, 0.035) * gs(aa, ea, 0.13);
    r -= 0.012 * gs(lat, el - 0.085, 0.03) * gs(aa, ea, 0.14);
    // nose: bridge rising to a tip, with alae
    const t = clamp((0.06 - lat) / 0.4, 0, 1);
    const nh = p.nose * (0.25 + 0.75 * t * t) * sm(-0.44, -0.33, lat);
    r += nh * gs(aa, 0, (0.05 + 0.06 * t) * p.noseW);
    r += p.nose * 0.42 * gs(aa, 0.115 * p.noseW, 0.06) * gs(lat, -0.3, 0.07);
    // cheekbones + hollows
    r += p.cheek * gs(lat, -0.12, 0.16) * gs(aa, 0.62, 0.22);
    r -= p.cheek * p.hollow * gs(lat, -0.45, 0.14) * gs(aa, 0.65, 0.25);
    // mouth: muzzle, lips, mouth line
    r += p.muzzle * gs(lat, -0.5, 0.14) * gs(aa, 0, 0.35);
    r += p.lips * (0.02 * gs(lat, -0.47, 0.04) * gs(aa, 0, 0.16) + 0.028 * gs(lat, -0.565, 0.045) * gs(aa, 0, 0.17));
    r -= 0.012 * p.lips * gs(lat, -0.515, 0.014) * gs(aa, 0, 0.17);
    // chin + jaw bone
    r += p.chin * gs(lat, -0.8, 0.14) * gs(aa, 0, p.chinW);
    r += p.jawBone * gs(lat, -0.6, 0.18) * gs(aa, 1.05, 0.28);
  }
  const bk = Math.max(0, -d.z);
  r += p.back * bk * sm(-0.6, 0.3, lat);
  let wdt = (1 - p.taper * sm(0, -0.9, lat)) * (1 + p.jawFlare * gs(lat, -0.55, 0.3));
  // optional shallow sockets following an eye outline (masked heads: lenses sit in these)
  if (p.sock && d.z > 0) {
    const s = p.sock, x = Math.abs(az) * s.R * s.sx, y = d.y * s.R * s.sy;
    const sd = polySd(x, y, s.pts);
    const du = s.depth / s.R;
    r -= du * (1 - sm(0, s.soft, sd));
    r += du * 0.45 * gs(sd, s.soft * 1.1, s.soft * 0.55);
  }
  out.set(d.x * r * wdt, d.y * r, d.z * r);
  return out;
}

/** average normals of coincident vertices (UV seams / poles) so the surface shades continuously */
export function weldNormals(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count, map = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 4e4)},${Math.round(pos.getY(i) * 4e4)},${Math.round(pos.getZ(i) * 4e4)}`;
  const acc = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = key(i); let a = map.get(k);
    if (!a) { a = [0, 0, 0]; map.set(k, a); }
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc[i] = a;
  }
  for (let i = 0; i < n; i++) { const a = acc[i], l = Math.hypot(a[0], a[1], a[2]) || 1; nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  nor.needsUpdate = true;
  return geo;
}

/** generic (na+1) x (nb+1) grid; fn(i/na, j/nb, out) -> position; uv from fnUV */
function gridGeo(na, nb, fn, fnUV, flip) {
  const pos = new Float32Array((na + 1) * (nb + 1) * 3), uv = new Float32Array((na + 1) * (nb + 1) * 2), idx = [];
  const v = new V3(), u2 = [0, 0];
  for (let j = 0; j <= nb; j++) for (let i = 0; i <= na; i++) {
    const k = j * (na + 1) + i;
    fn(i / na, j / nb, v); pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    fnUV(i / na, j / nb, u2); uv[k * 2] = u2[0]; uv[k * 2 + 1] = u2[1];
  }
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
    const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const _d = new V3(), _o = new V3();
const dirOf = (a, lat, out) => out.set(Math.sin(a) * Math.cos(lat), Math.sin(lat), Math.cos(a) * Math.cos(lat));

/** full displaced head, unit-ellipsoid coordinates. UV matches THREE.SphereGeometry (front = u 0.25). */
export function skullGeo(spec, key) {
  const p = { ...SKULL_DEFAULT, ...spec };
  return G('skull' + key + '_' + seg(100, 40) + JSON.stringify(p, (k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)), () => {
    const na = Math.round((p.na ?? 48) * seg(100, 40) / 100), nb = Math.round((p.nb ?? 34) * seg(100, 40) / 100);
    const g = gridGeo(na, nb, (u, v, out) => {
      const x = u * 2 - 1, a = Math.PI * Math.sign(x) * Math.pow(Math.abs(x), 1.3);
      const lat = (v - 0.5) * Math.PI;
      skullPoint(dirOf(a, lat, _d), p, out);
    }, (u, v, o) => { const x = u * 2 - 1, a = Math.PI * Math.sign(x) * Math.pow(Math.abs(x), 1.3); o[0] = 0.25 + a / (Math.PI * 2); o[1] = v; }, false);
    weldNormals(g);
    return g;
  });
}

/**
 * patch hugging the skull (hair cap, cowl, beard, lenses). a in [aMin,aMax]; lat = lerp(top(a), bot(a), t^pw).
 * thick(a, lat, t) is extra radius in unit coordinates. uv: u across a, v = 1 - t.
 */
export function shellGeo(spec, key, o) {
  const p = { ...SKULL_DEFAULT, ...spec };
  return G('shell' + key, () => {
    const { aMin = -Math.PI, aMax = Math.PI, na = 40, nb = 14, top = () => Math.PI / 2, bot, thick = () => 0.03, pw = 1, post, cx } = o;
    const g = gridGeo(na, nb, (u, v, out) => {
      const a = lerp(aMin, aMax, u), lt = top(a), lb = bot(a), lat = lerp(lt, lb, Math.pow(v, pw));
      skullPoint(dirOf(a, lat, _d), p, out);
      out.multiplyScalar(1 + thick(a, lat, v));
      if (post) post(out, a, lat, v);
    }, (u, v, uv) => { uv[0] = u; uv[1] = 1 - v; }, true);
    weldNormals(g);
    return g;
  });
}
/** piecewise-linear table lookup on |a|: tab = [[a, val], ...] */
export function tab(t) { return (a) => { a = Math.abs(a); for (let i = 1; i < t.length; i++) if (a <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (a - t[i - 1][0]) / (t[i][0] - t[i - 1][0])); return t[t.length - 1][1]; }; }

/** head-local point in metres for (azimuth, latitude, extra radius) on the displaced skull. Origin = head centre. */
export function skullMetres(H, spec, a, lat, thick = 0, out = new V3()) {
  const p = { ...SKULL_DEFAULT, ...spec };
  skullPoint(dirOf(a, lat, _o), p, out);
  return out.multiplyScalar(1 + thick).set(out.x * H.R * H.sx, out.y * H.R * H.sy, out.z * H.R * H.sz);
}

/** flat tapering ribbon along `pts` (head-local metres); lies tangent to the head (side = tangent x outward). */
export function ribbonGeo(key, pts, w0, w1, wMid = 0) {
  return G('rib' + key, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new V3(...q)));
    const N = seg(10, 6), P = curve.getPoints(N), pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, c = P[i], tan = curve.getTangent(t), out = new V3(c.x, 0, c.z - 0.0).normalize();
      if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
      const side = new V3().crossVectors(tan, out).normalize();
      const w = lerp(w0, w1, t) * (1 + wMid * Math.sin(t * Math.PI)) * (t > 0.82 ? 1 - (t - 0.82) / 0.18 * 0.85 : 1);
      pos.push(c.x - side.x * w, c.y - side.y * w, c.z - side.z * w, c.x + side.x * w, c.y + side.y * w, c.z + side.z * w);
      uv.push(0, 1 - t, 1, 1 - t);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------------ textures
function faceCanvasSize() { const W = clamp(texRes(), 512, 1024); return [W, W / 2]; }

/** painted face on the equirect head UV. Coordinates while painting: (azimuth, latitude) in radians, y up, front = 0. */
export function faceTexture2(o = {}) {
  const {
    skin = '#e0b090', shade = null, iris = '#4a78b8', brow = '#3a2a1a', lip = '#b4605a', white = '#f1ede4', mood = 'calm', stubble = 0, blush = 0.12,
    browW = 0.045, lash = 0.011, lid = 0, eyeSize = 1, female = false, teeth = false, age = 0, pupil = '#07080b', bag = 0.1, sclera = null, glowEyes = false, seed = 7,
  } = o;
  const key = 'face2' + JSON.stringify(o) + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const [W, H] = faceCanvasSize(), [c, ctx] = mkCanvas(W, H), s = W / (Math.PI * 2), r = rng(seed);
  const sk = new THREE.Color(skin), dk = shade ? new THREE.Color(shade) : sk.clone().multiplyScalar(0.72);
  const css = (col, a = 1) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = skin; ctx.fillRect(0, 0, W, H);
  // pore noise + subtle vertical tone
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI, tone = 1 + 0.06 * Math.sin(lat * 2.2) - 0.1 * Math.max(0, -lat - 0.7);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, n = (r() - 0.5) * 9 + (Math.sin(x * 0.31 + y * 0.17) + Math.sin(x * 0.07 - y * 0.13)) * 1.6;
      d[i] = clamp(d[i] * tone + n, 0, 255); d[i + 1] = clamp(d[i + 1] * tone + n * 0.9, 0, 255); d[i + 2] = clamp(d[i + 2] * tone + n * 0.8, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.setTransform(s, 0, 0, -s, W * 0.25, H / 2);
  const angry = mood === 'angry', smirk = mood === 'smirk', stern = mood === 'stern', smile = mood === 'smile';
  const blurRad = (x, y, rad, col, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, css(col, a)); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
  // blush, sockets, nose + under-lip shading
  const bl = new THREE.Color(female ? '#e0707a' : '#d0605a');
  for (const sd of [-1, 1]) {
    blurRad(sd * 0.56, -0.2, 0.28, bl, blush);
    blurRad(sd * 0.34, 0.04, 0.2, dk, 0.2);
    blurRad(sd * 0.34, -0.06, 0.12, dk, bag);
    blurRad(sd * 0.1, -0.2, 0.12, dk, 0.1);
  }
  blurRad(0, -0.43, 0.09, dk, 0.1); // under nose
  blurRad(0, -0.69, 0.1, dk, 0.14); // under lower lip
  if (age) for (const sd of [-1, 1]) { ctx.strokeStyle = css(dk, 0.2 * age); ctx.lineWidth = 0.008; ctx.beginPath(); ctx.moveTo(sd * 0.14, -0.3); ctx.quadraticCurveTo(sd * 0.28, -0.42, sd * 0.31, -0.58); ctx.stroke(); }
  // nostrils + nose side
  for (const sd of [-1, 1]) {
    ctx.fillStyle = 'rgba(40,18,12,0.6)'; ctx.beginPath(); ctx.ellipse(sd * 0.058, -0.345, 0.016, 0.009, sd * -0.3, 0, 6.3); ctx.fill();
    ctx.strokeStyle = css(dk, 0.2); ctx.lineWidth = 0.01; ctx.beginPath(); ctx.moveTo(sd * 0.075, -0.02); ctx.quadraticCurveTo(sd * 0.1, -0.18, sd * 0.115, -0.31); ctx.stroke();
  }
  // eyes
  const ew = 0.125 * eyeSize, eh = 0.05 * eyeSize * (angry ? 0.9 : 1);
  for (const sd of [-1, 1]) {
    ctx.save(); ctx.translate(sd * 0.34, 0.05); ctx.scale(sd, 1);
    ctx.rotate(angry ? 0.12 : smirk ? 0.04 : 0.03);
    const almond = () => { ctx.beginPath(); ctx.moveTo(-ew, -0.004); ctx.bezierCurveTo(-ew * 0.5, eh * 1.55, ew * 0.4, eh * 1.45, ew, 0.01); ctx.bezierCurveTo(ew * 0.4, -eh * 0.95, -ew * 0.5, -eh * 1.0, -ew, -0.004); ctx.closePath(); };
    almond();
    ctx.fillStyle = sclera || white; ctx.fill();
    ctx.save(); almond(); ctx.clip();
    const gz = smirk ? 0.012 : 0;
    const ig = ctx.createRadialGradient(gz, 0, 0.004, gz, 0, 0.05);
    const ic = new THREE.Color(iris); ig.addColorStop(0, css(ic.clone().multiplyScalar(1.25), 1)); ig.addColorStop(0.7, css(ic, 1)); ig.addColorStop(1, css(ic.clone().multiplyScalar(0.35), 1));
    ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(gz, 0.002, 0.05 * eyeSize, 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(10,10,14,0.65)'; ctx.lineWidth = 0.006; ctx.stroke();
    ctx.fillStyle = pupil; ctx.beginPath(); ctx.arc(gz, 0.002, 0.021 * eyeSize, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.arc(gz - 0.014, 0.017, 0.0085, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(gz + 0.014, -0.014, 0.005, 0, 6.3); ctx.fill();
    // upper-lid shadow
    const lg = ctx.createLinearGradient(0, eh * 1.4, 0, -eh * 0.2); lg.addColorStop(0, 'rgba(20,8,6,0.55)'); lg.addColorStop(0.55, 'rgba(20,8,6,0.08)'); lg.addColorStop(1, 'rgba(20,8,6,0)');
    ctx.fillStyle = lg; ctx.fillRect(-ew, -eh * 1.2, ew * 2, eh * 3);
    if (lid > 0) { ctx.fillStyle = css(dk, 1); ctx.beginPath(); ctx.moveTo(-ew * 1.2, eh * (0.55 - 1.5 * lid)); ctx.lineTo(ew * 1.2, eh * (1.0 - 0.9 * lid)); ctx.lineTo(ew * 1.2, eh * 3); ctx.lineTo(-ew * 1.2, eh * 3); ctx.fill(); }
    ctx.restore();
    // lid line, lashes, crease, lower lid
    ctx.strokeStyle = 'rgba(25,12,8,0.92)'; ctx.lineCap = 'round'; ctx.lineWidth = lash;
    ctx.beginPath(); ctx.moveTo(-ew, -0.004); ctx.bezierCurveTo(-ew * 0.5, eh * 1.55, ew * 0.4, eh * 1.45, ew, 0.01); ctx.stroke();
    if (female) { ctx.lineWidth = lash * 0.8; ctx.beginPath(); ctx.moveTo(ew * 0.9, 0.012); ctx.quadraticCurveTo(ew * 1.12, 0.02, ew * 1.2, 0.04); ctx.stroke(); }
    ctx.strokeStyle = css(dk, 0.55); ctx.lineWidth = 0.007;
    ctx.beginPath(); ctx.moveTo(-ew * 0.8, 0.025); ctx.bezierCurveTo(-ew * 0.4, eh * 2.5, ew * 0.4, eh * 2.4, ew * 0.95, 0.032); ctx.stroke();
    ctx.strokeStyle = css(dk, 0.4); ctx.lineWidth = 0.005;
    ctx.beginPath(); ctx.moveTo(-ew * 0.8, -0.006); ctx.bezierCurveTo(-ew * 0.4, -eh * 1.1, ew * 0.4, -eh * 1.05, ew * 0.9, -0.002); ctx.stroke();
    ctx.restore();
  }
  // eyebrows: tapered, with hair strokes
  const bc = new THREE.Color(brow);
  for (const sd of [-1, 1]) {
    const a0 = 0.1, a1 = 0.36, a2 = 0.66;
    const yIn = angry ? 0.19 : stern ? 0.2 : 0.215, yMid = angry ? 0.235 : female ? 0.285 : 0.255, yOut = angry ? 0.235 : female ? 0.2 : 0.215;
    const th = browW * (female ? 0.7 : 1);
    const up = [[a0, yIn + th * 0.5], [a1, yMid + th * 0.35], [a2, yOut + th * 0.1]], lo = [[a2, yOut - th * 0.1], [a1, yMid - th * 0.45], [a0, yIn - th * 0.5]];
    ctx.fillStyle = css(bc, 0.95); ctx.beginPath(); ctx.moveTo(sd * up[0][0], up[0][1]);
    ctx.quadraticCurveTo(sd * up[1][0], up[1][1] + th * 0.2, sd * up[2][0], up[2][1]); ctx.lineTo(sd * lo[0][0], lo[0][1]);
    ctx.quadraticCurveTo(sd * lo[1][0], lo[1][1] - th * 0.1, sd * lo[2][0], lo[2][1]); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(bc.clone().multiplyScalar(0.7), 0.55); ctx.lineWidth = 0.003;
    for (let i = 0; i < 26; i++) { const t = r(), x = lerp(a0, a2, t), y = lerp(yIn, yOut, t) + Math.sin(t * Math.PI) * (yMid - (yIn + yOut) / 2) + (r() - 0.5) * th * 0.8; ctx.beginPath(); ctx.moveTo(sd * x, y); ctx.lineTo(sd * (x + 0.035), y + 0.012 * (r() - 0.3)); ctx.stroke(); }
  }
  // mouth
  const my = -0.52, mw = (female ? 0.2 : 0.23) * (angry ? 1.35 : 1);
  const lc = new THREE.Color(lip);
  if (teeth) {
    ctx.fillStyle = '#1c0708'; ctx.beginPath(); ctx.moveTo(-mw, my + 0.01); ctx.quadraticCurveTo(0, my + 0.07, mw, my + 0.01); ctx.quadraticCurveTo(0, my - 0.1, -mw, my + 0.01); ctx.fill();
    ctx.fillStyle = '#e6e0c8';
    for (let i = 0; i < 9; i++) { const x = lerp(-mw * 0.82, mw * 0.82, i / 8); ctx.beginPath(); ctx.roundRect?.(x - 0.016, my + 0.002, 0.03, 0.026, 0.006); ctx.fill(); ctx.fillRect(x - 0.014, my - 0.058 + Math.abs(x) * 0.05, 0.026, 0.024); }
    ctx.strokeStyle = css(lc, 1); ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(-mw, my + 0.012); ctx.quadraticCurveTo(0, my + 0.075, mw, my + 0.012); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-mw, my + 0.012); ctx.quadraticCurveTo(0, my - 0.105, mw, my + 0.012); ctx.stroke();
  } else {
    const sy = smile ? 0.025 : smirk ? 0.02 : angry || stern ? -0.012 : 0.004, asym = smirk ? 0.016 : 0;
    const cl = [-mw, sy - asym], cr = [mw, sy + asym];
    const up = (female ? 0.05 : 0.04), lo = (female ? 0.065 : 0.05);
    ctx.fillStyle = css(lc.clone().multiplyScalar(0.9), 1);
    ctx.beginPath(); ctx.moveTo(cl[0], my + cl[1]); ctx.bezierCurveTo(-mw * 0.55, my + up * 0.6, -mw * 0.22, my + up, 0, my + up * 0.7); ctx.bezierCurveTo(mw * 0.22, my + up, mw * 0.55, my + up * 0.6, cr[0], my + cr[1]);
    ctx.bezierCurveTo(mw * 0.5, my - 0.008, -mw * 0.5, my - 0.008, cl[0], my + cl[1]); ctx.fill();
    ctx.fillStyle = css(lc.clone().multiplyScalar(1.1), 1);
    ctx.beginPath(); ctx.moveTo(cl[0], my + cl[1]); ctx.bezierCurveTo(-mw * 0.5, my - 0.008, mw * 0.5, my - 0.008, cr[0], my + cr[1]); ctx.bezierCurveTo(mw * 0.55, my - lo, -mw * 0.55, my - lo, cl[0], my + cl[1]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.ellipse(0, my - lo * 0.5, mw * 0.3, 0.009, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(40,12,12,0.85)'; ctx.lineWidth = 0.007; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cl[0], my + cl[1]); ctx.bezierCurveTo(-mw * 0.5, my - 0.008, mw * 0.5, my - 0.008, cr[0], my + cr[1]); ctx.stroke();
  }
  // stubble / beard shadow
  if (stubble > 0) {
    const gl = ctx.createRadialGradient(0, -0.7, 0.1, 0, -0.62, 0.95); gl.addColorStop(0, `rgba(30,22,16,${0.22 * stubble})`); gl.addColorStop(1, 'rgba(30,22,16,0)');
    ctx.fillStyle = gl; ctx.fillRect(-1.4, -1.5, 2.8, 1.4);
    ctx.fillStyle = `rgba(28,20,14,${0.55 * stubble})`;
    for (let i = 0; i < 5200 * stubble; i++) { const a = (r() * 2 - 1) * 1.15, l = -0.28 - r() * 0.8; if (Math.abs(a) < 0.24 && l > -0.58 && l < -0.46) continue; if (l < -0.28 - 0.35 * (1 - Math.abs(a))) ctx.fillRect(a, l, 0.004, 0.004); }
  }
  const t = mkTex(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
  texCache.set(key, t); return t;
}

/** skin height detail (pores) as a tiling normal map; apply with a small normalScale */
export function skinPoreNormal() {
  const key = 'skinpore' + texRes();
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, [c, ctx] = mkCanvas(W, W), r = rng(77);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 2600; i++) { const v = 90 + r() * 90; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.beginPath(); ctx.arc(r() * W, r() * W, 0.7 + r() * 1.3, 0, 6.3); ctx.fill(); }
  const t = mkNormalTex(heightToNormal(heightOf(ctx, W, W), W, W, 1.6)); t.repeat.set(10, 5);
  texCache.set(key, t); return t;
}

/** skin material carrying the painted face */
export function faceMaterial(o = {}) {
  const tex = faceTexture2(o);
  return M('facemat' + tex.uuid + (o.rough ?? ''), () => new THREE.MeshPhysicalMaterial({
    map: tex, roughness: o.rough ?? 0.56, metalness: 0, normalMap: skinPoreNormal(), normalScale: new THREE.Vector2(o.pore ?? 0.22, o.pore ?? 0.22),
    sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffc8b0), clearcoat: 0.06, clearcoatRoughness: 0.5,
  }));
}

/** strand texture: u across, v along the strand. returns {map, normal} */
export function hairMaps(base = '#d2a947', hi = null, seed = 5, fine = 1) {
  const key = 'hairmaps' + base + hi + seed + fine;
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, [c, ctx] = mkCanvas(W, W), r = rng(seed), b = new THREE.Color(base), h = hi ? new THREE.Color(hi) : b.clone().multiplyScalar(1.5);
  ctx.fillStyle = '#' + b.clone().multiplyScalar(0.7).getHexString(); ctx.fillRect(0, 0, W, W);
  const [c2, x2] = mkCanvas(W, W); x2.fillStyle = '#000'; x2.fillRect(0, 0, W, W);
  for (let i = 0; i < 190 * fine; i++) {
    const x = r() * W, w = 0.8 + r() * 2.2, k = r(), col = b.clone().lerp(h, k * k).multiplyScalar(0.75 + r() * 0.5);
    ctx.strokeStyle = `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.85)`; ctx.lineWidth = w;
    x2.strokeStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`; x2.lineWidth = w;
    const wob = (r() - 0.5) * 14;
    for (const cx of [ctx, x2]) { cx.beginPath(); cx.moveTo(x, 0); cx.bezierCurveTo(x + wob, W * 0.33, x - wob, W * 0.66, x + wob * 0.4, W); cx.stroke(); }
  }
  const g = ctx.createLinearGradient(0, 0, 0, W); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
  const map = mkTex(c), normal = mkNormalTex(heightToNormal(heightOf(x2, W, W), W, W, 2.2));
  const out = { map, normal }; texCache.set(key, out); return out;
}
export function hairMaterial(base, o = {}) {
  const m = hairMaps(base, o.hi, o.seed, o.fine);
  return M('hairmat' + base + (o.hi || '') + (o.seed || 5) + (o.rough ?? '') + (o.dbl ? 'd' : ''), () => new THREE.MeshPhysicalMaterial({
    map: m.map, normalMap: m.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: o.rough ?? 0.5, metalness: 0, sheen: 1, sheenRoughness: 0.35,
    sheenColor: new THREE.Color(o.sheen ?? 0xffe6b0), clearcoat: 0.15, clearcoatRoughness: 0.4, side: o.dbl ? THREE.DoubleSide : THREE.FrontSide,
  }));
}

/** ears: flattened lobes on both sides of the skull */
export function earsGeo(H, spec) {
  return G('ears' + H.R + H.sx + H.sy + H.sz + (spec?.earAz ?? ''), () => {
    const parts = [];
    for (const sd of [1, -1]) {
      const g = new THREE.SphereGeometry(1, 10, 8);
      g.scale(H.R * 0.05, H.R * 0.2, H.R * 0.13); g.rotateZ(sd * 0.1); g.rotateY(sd * 0.25);
      g.translate(sd * H.R * H.sx * 0.99, -H.R * H.sy * 0.06, -H.R * H.sz * 0.08);
      parts.push(g);
    }
    const g = new THREE.BufferGeometry(), pos = [], nor = [], uv = [], idx = [];
    let off = 0;
    for (const p of parts) {
      const P = p.attributes.position, N = p.attributes.normal, U = p.attributes.uv;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(U.getX(i), U.getY(i)); }
      for (const i of p.index.array) idx.push(i + off);
      off += P.count;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
  });
}
