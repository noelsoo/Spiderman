// Settings model: defaults, persistence and the code that APPLIES each setting to the running game (live).
// The menu itself lives in settings.js. Everything here is idempotent: applyAll(game) can run at any time.

export const SETTINGS_KEY = 'sm-settings';

export const DEFAULTS = {
  // gameplay
  difficulty: 'normal', autoSprint: true, aimAssist: 1, shake: 1, vibration: true, vibStrength: 1, hints: true, subtitles: true, subSize: 'medium',
  // controls
  sensitivity: 1, aimSens: 1, stickSensitivity: 1, invertY: false, invertX: false, deadzone: 0.15, swingToggle: false, aimToggle: false, keys: null, padRemap: null,
  // camera
  fov: 70, camDist: 6, camHeight: 1.6, shoulder: 'right', autoRecenter: false, speedFx: true, screenFx: true,
  // graphics
  quality: 'high', renderScale: 1, shadows: true, shadowRes: 'high', ao: true, bloom: 1, grain: true, vignette: 1, chroma: 1, brightness: 1, fps: false, fpsCap: 0,
  // audio
  volume: 0.8, music: 0.5, sfx: 1, voice: 1, muteUnfocused: true,
  // accessibility
  colorBlind: 'off', highContrast: false, hudScale: 1, reduceFlash: false,
};

export function loadSettings() {
  const def = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...def, ...saved };
  } catch { return def; }
}

const DIFF = { story: 0.5, normal: 1, hard: 1.5 };
export const DIFFICULTY = ['story', 'normal', 'hard'];
const SHADOW_RES = { low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const PRESET = { // what a graphics preset sets (world detail itself needs a reload)
  low: { shadows: false, shadowRes: 'low', ao: false, renderScale: 1 },
  medium: { shadows: true, shadowRes: 'medium', ao: false, renderScale: 1 },
  high: { shadows: true, shadowRes: 'high', ao: true, renderScale: 1 },
  ultra: { shadows: true, shadowRes: 'ultra', ao: true, renderScale: 1 },
};
export const applyPreset = (game, q) => { Object.assign(game.settings, PRESET[q] || {}); };

export const SHADOW_RES_OPTS = ['low', 'medium', 'high', 'ultra'];
const tierCap = (q) => (q === 'ultra' ? 2 : q === 'high' ? 1.5 : 1);

export function pixelRatioFor(game) {
  const s = game.settings;
  return Math.max(0.35, Math.min(devicePixelRatio, tierCap(s.quality)) * (s.renderScale ?? 1));
}

// ---- colour-blind correction (daltonize: simulate, then shift the lost information into visible channels)
const SIM = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const SHIFT = {
  protanopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  deuteranopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  tritanopia: [1, 0.7, 0, 0, 1, 0, 0, 0.7, 1],
};
const mul3 = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]); return o; };
export function colorBlindMatrix(mode) {
  const S = SIM[mode], M = SHIFT[mode]; if (!S) return null;
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const err = I.map((v, i) => v - S[i]);            // I - S
  const corr = mul3(M, err).map((v, i) => v + I[i]); // I + M (I - S)
  return corr;
}

let filterEl = null;
function applyColorBlind(game) {
  const mode = game.settings.colorBlind;
  const m = colorBlindMatrix(mode);
  if (!filterEl) {
    const w = document.createElement('div');
    w.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="sm-cb" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter></svg>';
    document.body.appendChild(w.firstChild);
    filterEl = document.querySelector('#sm-cb feColorMatrix');
  }
  if (m) {
    filterEl.setAttribute('values', `${m[0]} ${m[1]} ${m[2]} 0 0  ${m[3]} ${m[4]} ${m[5]} 0 0  ${m[6]} ${m[7]} ${m[8]} 0 0  0 0 0 1 0`);
    document.documentElement.classList.add('cb-on');
  } else document.documentElement.classList.remove('cb-on');
}

function applyRenderScale(game) {
  const r = game.renderer, pr = pixelRatioFor(game);
  if (Math.abs(r.getPixelRatio() - pr) < 0.001) return;
  r.setPixelRatio(pr);
  r.setSize(innerWidth, innerHeight);
  game.post?.setSize?.(innerWidth, innerHeight);
}

function applyShadows(game) {
  const s = game.settings, r = game.renderer, sun = game.world?.atmo?.sun;
  const want = !!s.shadows && (sun ? !!sun.castShadow : true);
  if (r.shadowMap.enabled !== want) {
    r.shadowMap.enabled = want;
    game.scene.traverse((o) => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; }); });
  }
  if (sun?.castShadow) {
    const sz = SHADOW_RES[s.shadowRes] || 2048;
    if (sun.shadow.mapSize.x !== sz) { sun.shadow.mapSize.set(sz, sz); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }
}

function applyKeys(game) {
  const i = game.input, s = game.settings;
  i.applyKeyBindings(s.keys);
  i.toggleActions.swing = !!s.swingToggle;
  i.toggleActions.aim = !!s.aimToggle;
  if (!s.swingToggle && !s.aimToggle) i.clearToggles();
}

/** key -> function(game). Settings that share an effect point at the same function. */
const APPLY = {
  sensitivity: (g) => { g.input.mouseSensitivity = 0.0022 * g.settings.sensitivity; },
  stickSensitivity: (g) => { g.input.stickSensitivity = 3.2 * g.settings.stickSensitivity; },
  invertY: (g) => { g.input.invertY = !!g.settings.invertY; },
  invertX: (g) => { g.input.invertX = !!g.settings.invertX; },
  deadzone: (g) => { g.input.deadzone = g.settings.deadzone; },
  aimSens: (g) => { g.cam.pref.aimSens = g.settings.aimSens; },
  keys: applyKeys, swingToggle: applyKeys, aimToggle: applyKeys,
  shake: (g) => { g.cam.pref.shakeScale = g.settings.shake * (g.settings.reduceFlash ? 0.35 : 1); },
  reduceFlash: (g) => { APPLY.shake(g); document.documentElement.classList.toggle('no-flash', !!g.settings.reduceFlash); },
  fov: (g) => { g.cam.baseFov = g.settings.fov; },
  camDist: (g) => { g.cam.pref.dist = g.settings.camDist / 6; },
  camHeight: (g) => { g.cam.pref.height = g.settings.camHeight - 1.6; },
  shoulder: (g) => { g.cam.pref.shoulder = { left: -1, centre: 0, right: 1 }[g.settings.shoulder] ?? 1; },
  autoRecenter: (g) => { g.cam.pref.autoRecenter = !!g.settings.autoRecenter; },
  speedFx: (g) => { if (g.post?.opts) g.post.opts.speed = g.settings.speedFx ? 1 : 0; },
  screenFx: (g) => { document.documentElement.classList.toggle('no-screenfx', !g.settings.screenFx); },
  renderScale: applyRenderScale, quality: (g) => { applyRenderScale(g); },
  shadows: applyShadows, shadowRes: applyShadows,
  ao: (g) => { if (g.post?.opts) g.post.opts.ao = !!g.settings.ao; },
  bloom: (g) => { if (g.post?.opts) g.post.opts.bloom = g.settings.bloom; },
  grain: (g) => { if (g.post?.opts) g.post.opts.grain = g.settings.grain ? 1 : 0; },
  vignette: (g) => { if (g.post?.opts) g.post.opts.vignette = g.settings.vignette; },
  chroma: (g) => { if (g.post?.opts) g.post.opts.chroma = g.settings.chroma; },
  brightness: (g) => { g.renderer.toneMappingExposure = g.settings.brightness; },
  fps: (g) => { fpsEl(g).style.display = g.settings.fps ? 'block' : 'none'; },
  volume: (g) => g.audio?._applyVolumes?.(), music: (g) => g.audio?._applyVolumes?.(), sfx: (g) => g.audio?._applyVolumes?.(),
  voice: (g) => g.audio?._applyVolumes?.(), muteUnfocused: (g) => g.audio?._applyVolumes?.(),
  hints: (g) => { g.hud.root.classList.toggle('nohints', !g.settings.hints); },
  subtitles: (g) => { g.hud.root.classList.toggle('nosubs', !g.settings.subtitles); },
  subSize: (g) => { g.hud.root.dataset.subs = g.settings.subSize; },
  colorBlind: applyColorBlind,
  highContrast: (g) => { g.hud.root.classList.toggle('hc', !!g.settings.highContrast); },
  hudScale: (g) => { g.hud.root.style.setProperty('--hs', String(g.settings.hudScale)); },
};
const HEAVY = new Set(['renderScale', 'quality', 'shadows', 'shadowRes']);
const timers = {};

/** Apply one setting right now (heavy ones are coalesced so dragging a slider stays smooth). */
export function applyKey(game, key) {
  const fn = APPLY[key]; if (!fn) return;
  if (HEAVY.has(key)) { clearTimeout(timers[key]); timers[key] = setTimeout(() => fn(game), 140); } else fn(game);
}

export function applyAll(game) {
  for (const k of Object.keys(APPLY)) { try { APPLY[k](game); } catch (e) { console.warn('[settings]', k, e); } }
}

/** One-time hooks: difficulty, vibration, flash reduction, focus muting, FPS counter, frame-rate cap. */
export function installSettings(game) {
  if (game._settingsInstalled) return;
  game._settingsInstalled = true;
  const s = () => game.settings;

  const cb = game.combat;
  if (cb?._hurtPlayer) {
    const orig = cb._hurtPlayer.bind(cb);
    cb._hurtPlayer = (amount, from, src) => orig(amount * (DIFF[s().difficulty] ?? 1), from, src);
  }
  const inp = game.input, rumble = inp.rumble.bind(inp);
  inp.rumble = (strong = 0.5, weak = 0.5, ms = 120) => {
    if (!s().vibration) return;
    const k = s().vibStrength ?? 1;
    rumble(Math.min(1, strong * k), Math.min(1, weak * k), ms);
  };
  const fx = game.fx;
  if (fx?.flash) {
    const fl = fx.flash.bind(fx);
    fx.flash = (pos, color, intensity = 4, life = 0.15) => fl(pos, color, s().reduceFlash ? intensity * 0.3 : intensity, life);
  }
  const a = game.audio;
  const setBlur = (v) => { if (a) { a._blurMute = v; a._applyVolumes?.(); } };
  addEventListener('blur', () => setBlur(true));
  addEventListener('focus', () => setBlur(false));
  document.addEventListener('visibilitychange', () => setBlur(document.hidden));

  // FPS counter, driven from the HUD's per-frame update
  const hud = game.hud, upd = hud.update.bind(hud);
  let acc = 0, n = 0, worst = 0;
  hud.update = (dt) => {
    upd(dt);
    if (!s().fps) return;
    acc += dt; n++; worst = Math.max(worst, dt);
    if (acc >= 0.5) {
      const el = fpsEl(game);
      el.textContent = `${Math.round(n / acc)} FPS  ${(acc / n * 1000).toFixed(1)} ms`;
      acc = 0; n = 0; worst = 0;
    }
  };
  // keep the camera's FOV in sync if something resets it
  applyAll(game);
}

let _fps = null;
function fpsEl(game) {
  if (!_fps) {
    _fps = document.createElement('div');
    _fps.className = 'fpsc'; _fps.style.display = 'none';
    game.hud.root.appendChild(_fps);
  }
  return _fps;
}

/** Frame-rate cap (called from the main loop). Returns true if this frame should be skipped. */
export function skipFrame(game, now) {
  const cap = game.settings.fpsCap;
  if (!cap) return false;
  const min = 1000 / cap - 2.2;
  if (now - (game._lastFrameT || 0) < min) return true;
  game._lastFrameT = now;
  return false;
}
