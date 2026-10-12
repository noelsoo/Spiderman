// Settings menu: tabbed, keyboard / mouse / gamepad driven, with live preview and a description line.
// Installed onto the HUD prototype (see hud.js). Model + "apply" code lives in settings-core.js.
import { DEFAULTS, applyKey, applyAll, applyPreset } from './settings-core.js';
import { BINDINGS, DEFAULT_KEYS } from '../core/input.js';

const TABS = [
  { id: 'gameplay', label: 'Gameplay', short: 'Game' },
  { id: 'controls', label: 'Controls', short: 'Ctrl' },
  { id: 'camera', label: 'Camera', short: 'Cam' },
  { id: 'graphics', label: 'Graphics', short: 'Gfx' },
  { id: 'audio', label: 'Audio', short: 'Audio' },
  { id: 'access', label: 'Access', short: 'Access' },
];

const pct = (v) => `${Math.round(v * 100)}%`;
const mult = (v) => `${v.toFixed(2)}x`;
const onOff = [[true, 'ON'], [false, 'OFF']];

// action -> label for the keyboard rebinding list
const KEY_ROWS = [
  ['jump', 'Jump / Web Wings', 'Jump, double-jump, glide and handbrake.'],
  ['swing', 'Swing / Fly', 'Hold to web-swing (Spider-Man) or fly (Iron Man, Thor).'],
  ['attack', 'Attack', 'Primary melee attack (also left mouse button).'],
  ['special', 'Special', 'Heavy or special attack (also right mouse button).'],
  ['ability', 'Ability', 'First hero ability.'],
  ['ability2', 'Ability 2', 'Second hero ability.'],
  ['ultimate', 'Ultimate', 'Unleash your ultimate when Focus is full.'],
  ['dodge', 'Dodge / Block', 'Dodge roll; Captain America holds it to block.'],
  ['interact', 'Interact', 'Enter and exit cars, use shops, pick things up.'],
  ['wheel', 'Hero wheel (hold)', 'Hold to open the character wheel.'],
  ['aim', 'Aim', 'Aim down sights with a weapon (also right mouse button).'],
  ['fire', 'Fire', 'Fire the equipped weapon (also left mouse button).'],
  ['reload', 'Reload', 'Reload the equipped weapon.'],
  ['pause', 'Pause', 'Open the pause menu. Esc always works as well.'],
  ['map', 'Map', 'Open the city map.'],
];
const RESERVED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);
// actions that are allowed to share a key (they are used in different situations)
const SHARES = [['ability2', 'reload'], ['jump', 'handbrake']];
const shares = (a, b) => SHARES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const MOUSE = { 0: 'LMB', 1: 'MMB', 2: 'RMB' };

export function keyLabel(code) {
  if (!code) return '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'NUM ' + code.slice(6).toUpperCase();
  const map = { Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
    Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BKSP', CapsLock: 'CAPS' };
  return map[code] || code.toUpperCase();
}

/** Rows for each tab. t: slider | toggle | choice | keys | link | head */
function tabRows(g, tab) {
  const s = g.settings;
  switch (tab) {
    case 'gameplay': return [
      { t: 'choice', key: 'difficulty', label: 'Difficulty', opts: [['story', 'Story'], ['normal', 'Normal'], ['hard', 'Hard']], desc: 'Story takes half damage, Normal is the intended challenge, Hard enemies hit 50% harder. Changes apply instantly.' },
      { t: 'toggle', key: 'autoSprint', label: 'Auto-sprint', desc: 'Run automatically when the stick is fully pushed or a movement key is held. Off: hold the sprint key.' },
      { t: 'slider', key: 'aimAssist', label: 'Aim assist', min: 0, max: 1.5, step: 0.1, fmt: pct, desc: 'How strongly guns snap to enemies near the crosshair. 0% is raw aim; 100% is the default.' },
      { t: 'slider', key: 'shake', label: 'Camera shake', min: 0, max: 1.5, step: 0.1, fmt: pct, desc: 'Intensity of explosions, impacts and recoil shake. 0% disables it.' },
      { t: 'toggle', key: 'vibration', label: 'Controller vibration', desc: 'Rumble on hits, shots and landings (needs a controller that supports vibration in your browser).' },
      { t: 'slider', key: 'vibStrength', label: 'Vibration strength', min: 0, max: 1, step: 0.1, fmt: pct, desc: 'How strong the rumble is. You will feel a short pulse when you change it.', after: () => g.input.rumble(0.7, 0.7, 180) },
      { t: 'toggle', key: 'hints', label: 'Hints & prompts', desc: 'Show contextual button prompts, driving hints and the hero-switch tip.' },
      { t: 'toggle', key: 'subtitles', label: 'Subtitles', desc: 'Show radio and cutscene dialogue as text.' },
      { t: 'choice', key: 'subSize', label: 'Subtitle size', opts: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], desc: 'Size of the subtitle text.' },
    ];
    case 'controls': return [
      { t: 'slider', key: 'sensitivity', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, fmt: mult, desc: 'Camera speed with the mouse.' },
      { t: 'slider', key: 'aimSens', label: 'Aim sensitivity', min: 0.3, max: 2, step: 0.05, fmt: mult, desc: 'Extra multiplier on camera speed while aiming or scoped.' },
      { t: 'slider', key: 'stickSensitivity', label: 'Stick sensitivity', min: 0.3, max: 2.5, step: 0.05, fmt: mult, desc: 'Camera speed with the right stick.' },
      { t: 'slider', key: 'deadzone', label: 'Stick deadzone', min: 0.02, max: 0.5, step: 0.01, fmt: pct, desc: 'Ignore small stick movements. Raise it if the camera drifts on its own.' },
      { t: 'toggle', key: 'invertY', label: 'Invert Y (look)', desc: 'Push up to look down, like a flight stick.' },
      { t: 'toggle', key: 'invertX', label: 'Invert X (look)', desc: 'Reverse left / right camera movement.' },
      { t: 'choice', key: 'swingToggle', label: 'Swing / fly', opts: [[false, 'HOLD'], [true, 'TOGGLE']], desc: 'Hold the swing button, or press once to start and again to stop.' },
      { t: 'choice', key: 'aimToggle', label: 'Aim', opts: [[false, 'HOLD'], [true, 'TOGGLE']], desc: 'Hold to aim, or press once to aim and again to lower the weapon.' },
      { t: 'link', label: 'Controller', text: 'DIAGNOSTICS / REMAP ▸', desc: 'Open the controller screen: connected devices, a live view of every button, and button remapping.', act: (hud) => hud._push('controller') },
      { t: 'head', label: 'Keyboard bindings' },
      ...KEY_ROWS.map(([action, label, desc]) => ({ t: 'keys', action, label, desc: `${desc} Press Enter to rebind, then press a key. Esc cancels, Backspace restores the default.` })),
    ];
    case 'camera': return [
      { t: 'slider', key: 'fov', label: 'Field of view', min: 60, max: 100, step: 1, fmt: (v) => `${Math.round(v)}°`, desc: 'Wider shows more of the city; narrower feels closer. Preview is live behind this menu.' },
      { t: 'slider', key: 'camDist', label: 'Camera distance', min: 3, max: 12, step: 0.25, fmt: (v) => `${v.toFixed(2)} m`, desc: 'How far the camera sits behind your hero (default 6 m).' },
      { t: 'slider', key: 'camHeight', label: 'Camera height', min: 0.8, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)} m`, desc: 'Height of the camera pivot above your hero (default 1.6 m).' },
      { t: 'choice', key: 'shoulder', label: 'Shoulder', opts: [['left', 'LEFT'], ['centre', 'CENTRE'], ['right', 'RIGHT']], desc: 'Which side of the screen your hero stands on.' },
      { t: 'toggle', key: 'autoRecenter', label: 'Auto-recenter', desc: 'Gently swing the camera behind you when you move fast without touching the camera.' },
      { t: 'toggle', key: 'speedFx', label: 'Motion blur & speed lines', desc: 'Radial blur and colour fringing when you swing, fly or drive fast. Needs Medium graphics or higher.', needs: 'post' },
      { t: 'toggle', key: 'screenFx', label: 'Damage & screen effects', desc: 'Red damage vignette and the low-health pulse.' },
    ];
    case 'graphics': return [
      { t: 'choice', key: 'quality', label: 'Preset', opts: [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']], desc: 'Post-processing, shadows and render scale change instantly. World detail (props, traffic, pedestrians) needs a reload (F5). Software renderers are forced to Low.', onSet: (v) => { applyPreset(g, v); for (const k of ['quality', 'renderScale', 'shadows', 'shadowRes', 'ao']) applyKey(g, k); g.hud.toast('Reload (F5) to apply world detail'); } },
      { t: 'slider', key: 'renderScale', label: 'Render scale', min: 0.5, max: 1.5, step: 0.05, fmt: pct, desc: 'Internal resolution. Lower for speed, above 100% for supersampling (sharper, slower).' },
      { t: 'toggle', key: 'shadows', label: 'Shadows', desc: 'Dynamic sun shadows. Needs a Medium or higher preset chosen before the city loaded.' },
      { t: 'choice', key: 'shadowRes', label: 'Shadow quality', opts: [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']], desc: 'Shadow map resolution.' },
      { t: 'toggle', key: 'ao', label: 'Ambient occlusion', desc: 'Soft contact shadows in corners and under objects. Needs High graphics or above.', needs: 'ao' },
      { t: 'slider', key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.05, fmt: pct, desc: 'Glow around bright lights. Needs Medium graphics or higher.', needs: 'post' },
      { t: 'toggle', key: 'grain', label: 'Film grain', desc: 'Subtle film noise over the image. Needs Medium graphics or higher.', needs: 'post' },
      { t: 'slider', key: 'vignette', label: 'Vignette', min: 0, max: 2, step: 0.05, fmt: pct, desc: 'Darkening toward the screen corners. Needs Medium graphics or higher.', needs: 'post' },
      { t: 'slider', key: 'chroma', label: 'Chromatic aberration', min: 0, max: 2, step: 0.05, fmt: pct, desc: 'Colour fringing: speed fringe at 100%, extra lens fringing at the corners above that. Needs Medium graphics or higher.', needs: 'post' },
      { t: 'slider', key: 'brightness', label: 'Brightness', min: 0.6, max: 1.6, step: 0.02, fmt: pct, desc: 'Overall exposure of the image.' },
      { t: 'toggle', key: 'fps', label: 'FPS counter', desc: 'Show frames per second in the top-left corner.' },
      { t: 'choice', key: 'fpsCap', label: 'Frame-rate cap', opts: [[0, 'UNLIMITED'], [30, '30'], [60, '60'], [120, '120']], desc: 'Limit frames per second to save power and heat. Unlimited follows your display.' },
    ];
    case 'audio': return [
      { t: 'slider', key: 'volume', label: 'Master volume', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Overall loudness.' },
      { t: 'slider', key: 'music', label: 'Music', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Music volume.' },
      { t: 'slider', key: 'sfx', label: 'Effects', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Combat, city and vehicle sound effects.' },
      { t: 'slider', key: 'voice', label: 'Voice & dialogue', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Radio chatter and dialogue blips.' },
      { t: 'toggle', key: 'muteUnfocused', label: 'Mute when unfocused', desc: 'Silence the game when you switch to another tab or window.' },
    ];
    case 'access': return [
      { t: 'choice', key: 'colorBlind', label: 'Colour-blind mode', opts: [['off', 'OFF'], ['protanopia', 'PROTANOPIA'], ['deuteranopia', 'DEUTERANOPIA'], ['tritanopia', 'TRITANOPIA']], desc: 'Re-maps colours so red / green (or blue / yellow) differences stay visible. Applies to the whole picture, preview is instant.' },
      { t: 'toggle', key: 'highContrast', label: 'High-contrast HUD', desc: 'Solid panels, brighter outlines and heavier text on the HUD and menus.' },
      { t: 'slider', key: 'hudScale', label: 'HUD scale', min: 0.75, max: 1.5, step: 0.05, fmt: pct, desc: 'Size of the in-game HUD (health, minimap, ability icons).' },
      { t: 'toggle', key: 'reduceFlash', label: 'Reduce flashing', desc: 'Dims muzzle and explosion flashes, damage flashes and cuts screen shake.' },
      { t: 'choice', key: 'swingToggle', label: 'Swing / fly', opts: [[false, 'HOLD'], [true, 'TOGGLE']], desc: 'Press once to swing or fly and again to stop, instead of holding the button.' },
      { t: 'choice', key: 'aimToggle', label: 'Aim', opts: [[false, 'HOLD'], [true, 'TOGGLE']], desc: 'Press once to aim and again to lower the weapon, instead of holding.' },
      { t: 'slider', key: 'shake', label: 'Camera shake', min: 0, max: 1.5, step: 0.1, fmt: pct, desc: 'Intensity of explosions, impacts and recoil shake.' },
      { t: 'choice', key: 'subSize', label: 'Subtitle size', opts: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], desc: 'Size of the subtitle text.' },
      { t: 'toggle', key: 'subtitles', label: 'Subtitles', desc: 'Show radio and cutscene dialogue as text.' },
    ];
  }
  return [];
}

export function installSettingsUI(HUD, H) {
  const { esc } = H;
  const P = HUD.prototype;

  // ----- hooks into the generic menu code ---------------------------------------------------
  const origUpdate = P.update;
  P.update = function (dt) {
    origUpdate.call(this, dt);
    const sc = this.screen;
    if (sc && sc.name === 'settings') sc.tick?.(dt);
  };
  const origOpen = P._open;
  P._open = function (name, data) {
    this.game.input?.clearToggles?.();
    return origOpen.call(this, name, data);
  };

  const kbGlyph = (t) => `<span class="glyph k${t.length > 4 ? ' sh' : ''}">${esc(t)}</span>`;

  P._settingsGlyphs = function (scr) {
    const pad = this._usePad();
    const g = (a) => this._glyph(a, pad);
    const hints = pad
      ? [[g('jump'), 'Select'], [`<span class="glyph k sh">D-pad ◀ ▶</span>`, 'Change'], [`${g('ability')}${g('special')}`, 'Tabs'], [g('interact'), 'Reset tab'], [g('dodge'), 'Back']]
      : [[kbGlyph('ENTER'), 'Select'], [kbGlyph('◀ ▶'), 'Change'], [`${kbGlyph('Q')}${kbGlyph('E')}`, 'Tabs'], [kbGlyph('R'), 'Reset tab'], [kbGlyph('ESC'), 'Back']];
    scr.foot.innerHTML = hints.map(([k, l]) => `<span class="fh">${k}<em>${l}</em></span>`).join('');
    scr.capL.innerHTML = pad ? g('ability') : kbGlyph('Q');
    scr.capR.innerHTML = pad ? g('special') : kbGlyph('E');
    scr.glyphSig = `${pad}${this._xbox()}`;
  };

  // ----- build -------------------------------------------------------------------------------
  P._build_settings = function (scr) {
    const g = this.game, s = g.settings, hud = this;
    scr.el.classList.add('sett-scr');
    scr.el.innerHTML = `<div class="panel sett">
      <h2>Settings</h2>
      <div class="st-tabs"><span class="cap" data-r="capL"></span><div class="tabs" data-r="tabs"></div><span class="cap" data-r="capR"></span></div>
      <div class="st-body" data-r="body"><div class="rows" data-r="rows"></div></div>
      <div class="st-desc" data-r="desc"></div>
      <div class="st-foot" data-r="foot"></div></div>`;
    const q = (n) => scr.el.querySelector(`[data-r="${n}"]`);
    scr.rows = q('rows'); scr.body = q('body'); scr.descEl = q('desc'); scr.foot = q('foot'); scr.capL = q('capL'); scr.capR = q('capR');
    const tabsEl = q('tabs');
    const save = (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(() => g.saveSettings?.(), 160); }; })();
    scr.tab = Math.max(0, Math.min(TABS.length - 1, this._setTab ?? 0));
    scr.painters = [];

    const setDesc = (t) => { scr.descEl.textContent = t || ''; };
    const commit = (spec, v) => { s[spec.key] = v; applyKey(g, spec.key); spec.onSet?.(v); save(); };
    const repaintAll = () => scr.painters.forEach((p) => p());
    scr.repaintAll = repaintAll;

    // tab strip
    TABS.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.dataset.i = i;
      b.innerHTML = `<span class="full">${esc(t.label)}</span><span class="short">${esc(t.short)}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); switchTab(i, true); });
      tabsEl.appendChild(b);
    });
    const tabItem = () => ({ onFocus: () => setDesc('Press ◀ ▶ (or Q / E, LB / RB) to switch category.'), adj: (d) => switchTab(scr.tab + d), act: () => {} });

    const unmet = (needs) => {
      const qn = g.post?.quality || s.quality;
      if (needs === 'post') return qn === 'low' ? 'MEDIUM+' : '';
      if (needs === 'ao') return (qn === 'low' || qn === 'medium') ? 'HIGH+' : '';
      return '';
    };

    const mkRow = (label, needs) => {
      const r = document.createElement('div'); r.className = 'row st-row';
      r.innerHTML = `<span class="lbl">${esc(label)}<em class="tag"></em></span><span class="ctl-r"></span>`;
      const tag = r.querySelector('.tag');
      const p = () => { const u = needs ? unmet(needs) : ''; tag.textContent = u; r.classList.toggle('off', !!u); };
      p(); scr.painters.push(p);
      scr.rows.appendChild(r);
      return r;
    };

    const addSlider = (spec) => {
      const r = mkRow(spec.label, spec.needs), c = r.querySelector('.ctl-r');
      const bar = document.createElement('div'); bar.className = 'sl'; bar.innerHTML = '<b></b>';
      const val = document.createElement('span'); val.className = 'val';
      c.append(bar, val);
      const { min, max, step } = spec;
      const get = () => s[spec.key] ?? DEFAULTS[spec.key];
      const paint = () => { const v = get(); bar.firstChild.style.width = `${Math.max(0, Math.min(1, (v - min) / (max - min))) * 100}%`; val.textContent = spec.fmt(v); };
      const put = (v) => {
        v = Math.max(min, Math.min(max, Math.round(v / step) * step));
        v = +v.toFixed(4);
        if (v === get()) return;
        commit(spec, v); paint(); spec.after?.(v);
      };
      let drag = false;
      const fromX = (e) => { const b = bar.getBoundingClientRect(); put(min + Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * (max - min)); };
      bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = true; bar.setPointerCapture?.(e.pointerId); hud._focus(scr.items.indexOf(it), true); fromX(e); });
      bar.addEventListener('pointermove', (e) => { if (drag) fromX(e); });
      const end = () => { drag = false; };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
      bar.addEventListener('click', (e) => e.stopPropagation());
      const it = hud._item(scr, r, { adj: (d) => put(get() + d * step), act: () => {}, click: () => {}, onFocus: () => setDesc(spec.desc), spec });
      scr.painters.push(paint); paint();
      return it;
    };

    const addChoice = (spec, isToggle) => {
      const r = mkRow(spec.label, spec.needs), c = r.querySelector('.ctl-r');
      const opts = isToggle ? onOff : spec.opts;
      const l = document.createElement('i'); l.className = 'ar'; l.textContent = '◀';
      const rr = document.createElement('i'); rr.className = 'ar'; rr.textContent = '▶';
      const val = document.createElement('span'); val.className = 'val';
      c.append(l, val, rr);
      const get = () => s[spec.key] ?? DEFAULTS[spec.key];
      const paint = () => { const o = opts.find((x) => x[0] === get()) || opts[0]; val.textContent = o[1]; val.classList.toggle('on', isToggle && !!get()); val.classList.toggle('offv', isToggle && !get()); };
      const adj = (d) => {
        let i = opts.findIndex((x) => x[0] === get()); if (i < 0) i = 0;
        const n = opts.length;
        commit(spec, opts[(i + d + n) % n][0]);
        repaintAll();
      };
      l.addEventListener('click', (e) => { e.stopPropagation(); hud._focus(scr.items.indexOf(it), true); adj(-1); });
      rr.addEventListener('click', (e) => { e.stopPropagation(); hud._focus(scr.items.indexOf(it), true); adj(1); });
      const it = hud._item(scr, r, { adj, act: () => adj(1), onFocus: () => setDesc(spec.desc), spec });
      scr.painters.push(paint); paint();
      return it;
    };

    // --- key rebinding
    const conflictsFor = (action, code) => Object.keys(BINDINGS).filter((a) => a !== action && !shares(a, action) && (BINDINGS[a].k || []).includes(code));
    const addKeys = (spec) => {
      const r = mkRow(spec.label), c = r.querySelector('.ctl-r');
      const val = document.createElement('span'); val.className = 'val keys'; c.append(val);
      const paint = () => {
        const b = BINDINGS[spec.action] || {};
        const ks = (b.k || []).filter((k) => !(spec.action === 'pause' && k === 'Escape'));
        const ms = (b.m || []).map((m) => MOUSE[m] || `M${m}`);
        const warn = ks.some((k) => conflictsFor(spec.action, k).length);
        const parts = [...ks.map(keyLabel), ...ms];
        if (scr.capture?.action === spec.action) { val.innerHTML = '<span class="kc cap">PRESS A KEY…</span>'; r.classList.add('listen'); }
        else { val.innerHTML = (parts.length ? parts.map((p) => `<span class="kc">${esc(p)}</span>`).join('') : '<span class="kc none">—</span>') + (warn ? '<span class="kc warn" title="Shared with another action">⚠</span>' : ''); r.classList.remove('listen'); }
      };
      const it = hud._item(scr, r, { act: () => startCapture(spec, paint), click: () => startCapture(spec, paint), onFocus: () => setDesc(spec.desc), spec, adj: () => {} });
      scr.painters.push(paint); paint();
      return it;
    };
    const persistKeys = () => {
      const keys = {};
      for (const a of Object.keys(DEFAULT_KEYS)) { const cur = BINDINGS[a].k || [], def = DEFAULT_KEYS[a]; if (cur.join() !== def.join()) keys[a] = [...cur]; }
      s.keys = Object.keys(keys).length ? keys : null;
      save();
    };
    const startCapture = (spec, paint) => {
      scr.capture = { action: spec.action, cancel: () => { scr.capture = null; repaintAll(); setDesc(spec.desc); } };
      paint(); setDesc(`Press the new key for “${spec.label}”. Esc cancels · Backspace restores the default.`);
    };
    const finishKey = (e) => {
      const cap = scr.capture, action = cap.action, code = e.code;
      const spec = KEY_ROWS.find((r) => r[0] === action);
      if (code === 'Escape') { cap.cancel(); return; }
      if (code === 'Backspace' || code === 'Delete') {
        g.input.resetKeyBindings(action); scr.capture = null; persistKeys(); repaintAll();
        setDesc(`“${spec[1]}” restored to its default key.`); return;
      }
      if (RESERVED.has(code)) { setDesc(`${keyLabel(code)} is reserved (movement / browser). Pick another key.`); hud.game.audio?.play('ui_back'); return; }
      const others = conflictsFor(action, code);
      g.input.setKeyBinding(action, action === 'pause' ? [code, 'Escape'] : [code]);
      scr.capture = null; persistKeys(); repaintAll();
      hud.game.audio?.play('ui_select');
      const names = others.map((a) => (KEY_ROWS.find((r) => r[0] === a) || [a, a])[1]);
      setDesc(names.length ? `⚠ ${keyLabel(code)} is also used by ${names.join(', ')}. Both will trigger; rebind one of them if that is not intended.` : `“${spec[1]}” is now ${keyLabel(code)}.`);
      scr.descEl.classList.toggle('warn', names.length > 0);
    };

    const addLink = (spec) => {
      const r = mkRow(spec.label), c = r.querySelector('.ctl-r');
      c.innerHTML = `<span class="val link">${esc(spec.text)}</span>`;
      return hud._item(scr, r, { act: () => spec.act(hud), onFocus: () => setDesc(spec.desc), spec });
    };
    const addHead = (label) => { const h = document.createElement('div'); h.className = 'st-head'; h.textContent = label; scr.rows.appendChild(h); };
    const addBtn = (label, act, desc, cls = '') => {
      const b = document.createElement('div'); b.className = `btn st-btn ${cls}`; b.innerHTML = `<span>${esc(label)}</span>`;
      scr.btnRow.appendChild(b);
      return hud._item(scr, b, { act, onFocus: () => setDesc(desc), btn: true });
    };

    // --- resets
    const resetSpec = (spec) => {
      if (spec.t === 'keys') return;
      if (spec.key) {
        s[spec.key] = DEFAULTS[spec.key];
        if (spec.key === 'quality') { applyPreset(g, s.quality); for (const k of ['quality', 'renderScale', 'shadows', 'shadowRes', 'ao']) applyKey(g, k); }
        else applyKey(g, spec.key);
      }
    };
    const resetTab = () => {
      for (const sp of tabRows(g, TABS[scr.tab].id)) resetSpec(sp);
      if (TABS[scr.tab].id === 'controls') { g.input.resetKeyBindings(); s.keys = null; applyKey(g, 'keys'); }
      g.saveSettings?.(); repaintAll(); g.audio?.play('ui_back');
      setDesc(`${TABS[scr.tab].label} settings restored to defaults.`);
    };
    let confirmT = 0, confirmIt = null;
    const resetAll = () => {
      if (!confirmT) {
        confirmT = setTimeout(() => { confirmT = 0; if (confirmIt) confirmIt.el.firstChild.textContent = 'Reset all to defaults'; }, 3500);
        confirmIt.el.firstChild.textContent = 'Press again to confirm';
        setDesc('This resets EVERY setting (including key bindings) to its default.');
        return;
      }
      clearTimeout(confirmT); confirmT = 0; confirmIt.el.firstChild.textContent = 'Reset all to defaults';
      const keep = { padRemap: s.padRemap };
      Object.assign(s, JSON.parse(JSON.stringify(DEFAULTS)), keep);
      g.input.resetKeyBindings(); g.input.padRemap = {}; s.padRemap = null;
      applyPreset(g, s.quality); applyAll(g);
      g.saveSettings?.(); repaintAll(); g.audio?.play('ui_back');
      setDesc('All settings restored to defaults.');
      hud.toast('Settings reset');
    };

    // --- tab rendering
    const build = (focusIdx) => {
      scr.capture = null; scr.painters = []; scr.items = [];
      scr.rows.innerHTML = '';
      tabsEl.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('sel', i === scr.tab));
      hud._item(scr, scr.el.querySelector('.st-tabs'), tabItem());
      for (const spec of tabRows(g, TABS[scr.tab].id)) {
        if (spec.t === 'slider') addSlider(spec);
        else if (spec.t === 'toggle') addChoice(spec, true);
        else if (spec.t === 'choice') addChoice(spec, false);
        else if (spec.t === 'keys') addKeys(spec);
        else if (spec.t === 'link') addLink(spec);
        else if (spec.t === 'head') addHead(spec.label);
      }
      scr.btnRow = document.createElement('div'); scr.btnRow.className = 'st-btns';
      scr.rows.appendChild(scr.btnRow);
      addBtn('Reset tab', resetTab, 'Restore every option on this tab to its default.');
      confirmIt = addBtn('Reset all to defaults', resetAll, 'Restore every setting on every tab to its default.', 'danger');
      addBtn('Back', () => hud._back(), 'Return to the previous menu. Changes are saved automatically.');
      scr.body.scrollTop = 0;
      hud._focus(focusIdx, true);
      repaintAll();
    };
    const switchTab = (i, fromMouse) => {
      const n = TABS.length; i = ((i % n) + n) % n;
      if (i === scr.tab && !fromMouse) return;
      const onTabs = scr.index === 0;
      scr.tab = i; hud._setTab = i;
      hud.game.audio?.play('ui_move');
      build(fromMouse ? 0 : (onTabs ? 0 : 1));
    };
    scr.switchTab = switchTab;

    scr.padBtn = (b) => {
      if (scr.capture) return;
      if (b === 'l1') switchTab(scr.tab - 1);
      else if (b === 'r1') switchTab(scr.tab + 1);
      else if (b === 'tri') resetTab();
    };
    scr.onKey = (e) => {
      if (scr.capture) { finishKey(e); return true; }
      if (e.code === 'KeyQ' || e.code === 'PageUp') { switchTab(scr.tab - 1); return true; }
      if (e.code === 'KeyE' || e.code === 'PageDown') { switchTab(scr.tab + 1); return true; }
      if (e.code === 'KeyR' || e.code === 'Delete') { resetTab(); return true; }
      return false;
    };
    let gt = 0;
    scr.tick = (dt) => {
      gt -= dt; if (gt > 0) return; gt = 0.25;
      const sig = `${this._usePad()}${this._xbox()}`;
      if (sig !== scr.glyphSig) this._settingsGlyphs(scr);
      if (scr.lastQ !== g.post?.quality) { scr.lastQ = g.post?.quality; repaintAll(); }
    };
    scr.el.addEventListener('click', (e) => { if (scr.capture && !e.target.closest('.row.listen')) scr.capture.cancel(); });

    this._settingsGlyphs(scr);
    build(1);
  };
}
