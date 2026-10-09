// HUD, menus and prompts. Contract: see docs/ARCHITECTURE.md#hud
// All DOM lives inside #hud. Menus are driven by keyboard, mouse and gamepad (polled in update()).
import './hud.css';

const ORDER = ['spiderman', 'ironman', 'hulk', 'thor'];

const EMBLEM = {
  spiderman: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><ellipse cx="12" cy="13" rx="3" ry="4.5" fill="#fff"/><circle cx="12" cy="7.5" r="2" fill="#fff"/><path d="M9.2 10 3 5M9 13l-6 1M9.4 15.5 4 21M14.8 10 21 5M15 13l6 1M14.6 15.5 20 21"/></svg>',
  ironman: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2" fill="#fff"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>',
  hulk: '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="6" cy="9" r="2.4"/><circle cx="10.5" cy="7.2" r="2.4"/><circle cx="15" cy="7.2" r="2.4"/><circle cx="19" cy="9.6" r="2.2"/><path d="M4.5 10h16.5l-1 7a3 3 0 0 1-3 2.6H9a4 4 0 0 1-3.8-2.8z"/></svg>',
  thor: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M14 1 4.5 13.5H11L9 23l10.5-13.5H13z"/></svg>',
};

const HERO_INFO = {
  spiderman: { name: 'Spider-Man', color: '#e8213a', powers: ['Web-swing, zip & wall-run', 'Web Wings glide', 'Symbiote suit & Surge'] },
  ironman: { name: 'Iron Man', color: '#f0b429', powers: ['Repulsors & micro-missiles', 'Thruster flight', 'Unibeam'] },
  hulk: { name: 'Hulk', color: '#4cc24b', powers: ['Super-jump & ground slam', 'Thunderclap & rock throw', 'Rage & Worldbreaker'] },
  thor: { name: 'Thor', color: '#5aa9ff', powers: ['Mjolnir throw & recall', 'Lightning & storm', 'Hammer flight & Bifrost'] },
};

const HERO_CONTROLS = {
  spiderman: 'Swing, web-shot, web-zip, symbiote suit, Surge',
  ironman: 'Fly, repulsor, missiles, Unibeam',
  hulk: 'Charge-jump, slam, clap, Rage, Worldbreaker',
  thor: 'Hammer, lightning, storm, Bifrost',
};

// action -> [keyboard label, PlayStation glyph, Xbox glyph]
const GLYPHS = {
  jump: ['SPACE', '✕', 'A'], dodge: ['C', '○', 'B'], attack: ['J / LMB', '□', 'X'], ultimate: ['F', '△', 'Y'],
  ability: ['E', 'L1', 'LB'], special: ['K / RMB', 'R1', 'RB'], ability2: ['R', 'L2', 'LT'], swing: ['SHIFT', 'R2', 'RT'],
  sprint: ['ALT', 'L3', 'LS'], recenter: ['V', 'R3', 'RS'], heroNext: ['TAB', '▶', '▶'], heroPrev: ['[', '◀', '◀'],
  pause: ['ESC', 'OPTIONS', 'MENU'], map: ['M', 'TOUCHPAD', 'VIEW'],
};
const PS_CLASS = { jump: 'x', dodge: 'o', attack: 'sq', ultimate: 'tr' };

const KB_ROWS = [
  ['Move', 'W A S D / arrows', 'Left stick'], ['Look', 'Mouse', 'Right stick'], ['Jump / Web Wings', 'Space', '✕'],
  ['Swing / Boost (hold)', 'Shift', 'R2'], ['Attack', 'LMB / J', '□'], ['Special', 'RMB / K', 'R1'],
  ['Ability', 'E', 'L1'], ['Ability 2', 'R', 'L2'], ['Ultimate (full Focus)', 'F', '△'], ['Dodge', 'C / Ctrl', '○'],
  ['Sprint', 'Alt', 'L3'], ['Recenter camera', 'MMB / V', 'R3'], ['Switch hero', 'Tab ] [ / 1-4', 'D-pad ◀ ▶'],
  ['Pause', 'Esc / P', 'Options'], ['Map', 'M', 'Touchpad'],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.screen = null;       // { name, el, items, index, back }
    this.stack = [];
    this.lockUntil = 0;
    this.heroSel = 'spiderman';
    this.lastHero = 'spiderman';
    this.maxCombo = 0;
    this.objText = ''; this.objProg = null;
    this._sig = {};
    this._navT = 0; this._navDir = '';
    this._padPrev = {};
    this._mmT = 0; this._mapBig = false;
    this._lastToast = '';
    this._promptT = 0;
    this._buildGame();
    this._applySettings();

    // audio unlock on first interaction
    const unlock = () => { this.game.audio?.unlock?.(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true });

    addEventListener('keydown', (e) => this._onKey(e), true);
    this._registerSW();
  }

  // ------------------------------------------------------------------ setup
  _applySettings() {
    const s = this.game.settings || {}, inp = this.game.input;
    if (!inp) return;
    inp.invertY = !!s.invertY;
    inp.mouseSensitivity = 0.0022 * (s.sensitivity ?? 1);
    inp.stickSensitivity = 3.2 * (s.stickSensitivity ?? 1);
  }

  _registerSW() {
    try {
      if (import.meta.env?.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL || './'}sw.js`).catch(() => {}));
      }
    } catch { /* ignore */ }
  }

  _buildGame() {
    const r = this.root;
    r.innerHTML = `
      <div class="hud-game" data-r="game">
        <div class="vignette" data-r="vig"></div>
        <div class="xhair" data-r="xhair"></div>
        <div class="wp hidden" data-r="wp"><div class="dm"></div><div class="ds" data-r="wpd"></div></div>
        <div class="obj hidden" data-r="obj"><div class="k">OBJECTIVE</div><div class="tx" data-r="objtx"></div><div class="ds" data-r="objds"></div><div class="pg hidden" data-r="objpg"><b></b></div></div>
        <div class="boss" data-r="boss"><div class="nm" data-r="bossnm"></div><div class="bar"><b data-r="bossbar"></b></div></div>
        <div class="strip" data-r="strip"></div>
        <div class="mm" data-r="mm"><canvas data-r="mmc" width="336" height="336"></canvas></div>
        <div class="toasts" data-r="toasts"></div>
        <div class="sense" data-r="sense">!</div>
        <div class="prompt" data-r="prompt"></div>
        <div class="combo" data-r="combo"><div class="n" data-r="combon">0</div><div class="l">HIT COMBO</div><div class="t"><b data-r="combot"></b></div></div>
        <div class="badge">
          <div class="portrait" data-r="portrait"></div>
          <div class="bars">
            <div class="hname"><span data-r="hname">-</span><small data-r="hhp"></small></div>
            <div class="hp" data-r="hp"></div>
            <div class="focus" data-r="focus"><div class="ult" data-r="ult">ULTIMATE READY</div><b data-r="focusb"></b></div>
          </div>
        </div>
        <div class="abil" data-r="abil"></div>
      </div>
      <div data-r="screens"></div>`;
    this.$ = {};
    r.querySelectorAll('[data-r]').forEach((el) => { this.$[el.dataset.r] = el; });
    this.mmCtx = this.$.mmc.getContext('2d');
    // hp segments
    this.SEG = 20;
    this.$.hp.innerHTML = '<i></i>'.repeat(this.SEG);
    this.hpSegs = [...this.$.hp.children];
    // hero strip
    this.$.strip.innerHTML = ORDER.map((id, i) => `<div class="hs" data-id="${id}" style="--c:${HERO_INFO[id].color}"><div class="pt">${EMBLEM[id]}</div><div class="mb"><b></b></div><div class="kk">${i + 1}</div></div>`).join('');
    this.stripEls = ORDER.map((id) => this.$.strip.querySelector(`[data-id="${id}"]`));
    this.stripEls.forEach((el, i) => el.addEventListener('click', () => this.game.state === 'playing' && this.game.switchHero?.(ORDER[i])));
    this.$.strip.style.pointerEvents = 'auto';
  }

  // ------------------------------------------------------------------ public API
  setLoading(p, msg = '') {
    if (!this.loadEl) {
      this.loadEl = document.createElement('div');
      this.loadEl.className = 'screen loading';
      this.loadEl.innerHTML = '<h1>Spider-Man: <span style="color:#e8213a">Symbiote City</span></h1><div class="pb"><b></b></div><div class="msg"></div><div class="err"></div>';
      this.$.screens.appendChild(this.loadEl);
    }
    this.loadEl.querySelector('b').style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    this.loadEl.querySelector('.msg').textContent = `${msg} ${Math.round(p * 100)}%`;
  }

  fatal(e) {
    console.error(e);
    this.setLoading(0, 'Something went wrong');
    this.loadEl.querySelector('.err').textContent = String(e?.stack || e?.message || e);
  }

  showTitle() {
    if (this.loadEl) { this.loadEl.remove(); this.loadEl = null; }
    this.stack = [];
    this.heroSel = this.lastHero || 'spiderman';
    this.$.boss.classList.remove('on');
    this._open('title');
    this.game.audio?.music?.('roam');
  }

  showPause() { this.stack = []; this._open('pause'); }

  hideMenus() {
    this.stack = [];
    this._close();
  }

  showGameOver(stats = {}) { this._end(stats, false); }
  showVictory(stats = {}) { this._end(stats, true); }

  _end(stats, win) {
    this.stack = [];
    const s = { kills: stats.kills ?? 0, time: stats.time ?? this.game.time ?? 0, wave: stats.wave ?? '-', maxCombo: stats.maxCombo ?? this.maxCombo };
    this.maxCombo = 0;
    this.$.boss.classList.remove('on');
    this.game.audio?.music?.(win ? 'victory' : null);
    this._open(win ? 'victory' : 'gameover', s);
  }

  setHero(hero) {
    if (!hero) return;
    this.hero = hero;
    this.lastHero = hero.id;
    const col = hero.color ?? HERO_INFO[hero.id]?.color ?? '#e8213a';
    const css = typeof col === 'number' ? `#${col.toString(16).padStart(6, '0')}` : col;
    this.root.style.setProperty('--hero', css);
    this.$.portrait.innerHTML = EMBLEM[hero.id] || '';
    this.$.hname.textContent = hero.name || HERO_INFO[hero.id]?.name || hero.id;
    this._sig.hp = -1; this._sig.abil = '';
  }

  toast(text) {
    if (!text) return;
    const now = performance.now();
    if (text === this._lastToast && now - (this._lastToastT || 0) < 600) return;
    this._lastToast = text; this._lastToastT = now;
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    this.$.toasts.appendChild(el);
    while (this.$.toasts.children.length > 4) this.$.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2300);
    setTimeout(() => el.remove(), 2800);
  }

  objective(text, progress) {
    this.objText = text || ''; this.objProg = progress ?? null;
    this.$.objtx.textContent = this.objText;
    this.$.obj.classList.toggle('hidden', !this.objText);
    this.$.objpg.classList.toggle('hidden', this.objProg == null);
    if (this.objProg != null) this.$.objpg.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, this.objProg)) * 100)}%`;
  }

  showBoss(name, hp, max) {
    this.$.bossnm.textContent = name || 'BOSS';
    this.$.bossbar.style.width = `${Math.max(0, Math.min(100, (hp / (max || 1)) * 100))}%`;
    this.$.boss.classList.add('on');
  }
  hideBoss() { this.$.boss.classList.remove('on'); }

  prompt(action, text) {
    if (action === 'sense' || action === 'spidersense' || text === '!') {
      const s = this.$.sense; s.classList.remove('on'); void s.offsetWidth; s.classList.add('on');
      return;
    }
    const pad = this._usePad();
    this.$.prompt.innerHTML = `${action ? this._glyph(action, pad) : ''}<span>${esc(text || '')}</span>`;
    this.$.prompt.classList.add('on');
    this._promptT = 2.6;
  }

  damageFlash() {
    const v = this.$.vig; v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit');
  }

  // ------------------------------------------------------------------ glyphs
  _usePad() { return this.game.input?.lastDevice === 'gamepad'; }
  _xbox() { return /xbox|045e/i.test(this.game.input?.gamepadName || '') && !/054c|dualshock|dualsense/i.test(this.game.input?.gamepadName || ''); }
  _glyph(action, pad = this._usePad()) {
    const g = GLYPHS[action];
    if (!g) return `<span class="glyph k">${esc(action)}</span>`;
    if (!pad) return `<span class="glyph k${g[0].length > 4 ? ' sh' : ''}">${esc(g[0])}</span>`;
    if (this._xbox()) return `<span class="glyph k">${esc(g[2])}</span>`;
    const c = PS_CLASS[action];
    return `<span class="glyph ${c ? `ps ${c}` : 'k'}">${esc(g[1])}</span>`;
  }

  // ------------------------------------------------------------------ screens
  _close() {
    if (this.screen) { this.screen.el.remove(); this.screen = null; }
  }

  _open(name, data) {
    this._close();
    const el = document.createElement('div');
    el.className = `screen fade ${name === 'title' ? 'title' : 'dim'}`;
    this.$.screens.appendChild(el);
    const scr = { name, el, items: [], index: 0, back: null, data };
    this.screen = scr;
    this.lockUntil = performance.now() + (name === 'gameover' || name === 'victory' ? 700 : 300);
    this['_build_' + name](scr);
    this._focus(scr.index, true);
    return scr;
  }

  _push(name) { // open sub-screen, remembering the parent
    this.stack.push(this.screen.name);
    this._open(name);
  }

  _back() {
    const g = this.game;
    const prev = this.stack.pop();
    if (prev) { g.audio?.play('ui_back'); this._open(prev); return; }
    if (this.screen?.name === 'pause') { g.audio?.play('ui_back'); this._resume(); }
  }

  _resume() { this.hideMenus(); this.game.resume?.(); }

  _item(scr, el, opts) {
    const it = { el, ...opts };
    const i = scr.items.length;
    scr.items.push(it);
    el.addEventListener('mouseenter', () => { if (this.screen === scr && scr.index !== i) this._focus(i); });
    el.addEventListener('click', (e) => { if (this.screen !== scr) return; this._focus(i, true); it.click ? it.click(e) : this._activate(); });
    return it;
  }

  _focus(i, silent) {
    const scr = this.screen; if (!scr || !scr.items.length) return;
    const n = scr.items.length;
    scr.index = (i + n) % n;
    scr.items.forEach((it, k) => it.el.classList.toggle('foc', k === scr.index));
    if (!silent) this.game.audio?.play('ui_move');
  }

  _activate() {
    const it = this.screen?.items[this.screen.index];
    if (!it) return;
    this.game.audio?.unlock?.();
    this.game.audio?.play('ui_select');
    it.act?.();
  }

  _horiz(dir) {
    const scr = this.screen; if (!scr) return;
    const it = scr.items[scr.index];
    if (it?.adj) { it.adj(dir); this.game.audio?.play('ui_move'); return; }
    if (scr.name === 'title') this._selectHero(dir);
  }

  _btn(scr, label, act, cls = '') {
    const b = document.createElement('div');
    b.className = `btn ${cls}`; b.innerHTML = `<span>${esc(label)}</span>`;
    this._item(scr, b, { act });
    return b;
  }

  // ---- title
  _selectHero(dir) {
    const i = ORDER.indexOf(this.heroSel);
    this.heroSel = ORDER[(i + dir + ORDER.length) % ORDER.length];
    this.game.audio?.play('ui_move');
    this._paintCards();
  }

  _paintCards() {
    const scr = this.screen; if (!scr || scr.name !== 'title') return;
    scr.el.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === this.heroSel));
  }

  _build_title(scr) {
    scr.el.innerHTML = `
      <div class="top"><h1>Spider-Man<em>Symbiote City</em></h1></div>
      <div class="bottom">
        <div class="cards"></div>
        <div class="padind" data-r="padind"></div>
        <div class="menu"></div>
        <div class="hint" data-r="starthint"></div>
      </div>
      <div class="foot">Fan-made tribute &middot; not affiliated with Marvel or Insomniac</div>`;
    const cards = scr.el.querySelector('.cards');
    for (const id of ORDER) {
      const info = HERO_INFO[id];
      const h = this.game.heroes?.[id];
      const c = document.createElement('div');
      c.className = 'card'; c.dataset.id = id;
      const col = h?.color ? (typeof h.color === 'number' ? `#${h.color.toString(16).padStart(6, '0')}` : h.color) : info.color;
      c.style.setProperty('--c', col);
      c.innerHTML = `<div class="pt">${EMBLEM[id]}</div><h3>${esc(h?.name || info.name)}</h3><ul>${info.powers.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
      c.addEventListener('click', () => { this.heroSel = id; this.game.audio?.play('ui_move'); this._paintCards(); });
      cards.appendChild(c);
    }
    const menu = scr.el.querySelector('.menu');
    const mk = (label, act, cls) => { const b = this._btn(scr, label, act, cls); menu.appendChild(b); return b; };
    mk('Start', () => this._start(), 'big');
    mk('Controls', () => this._push('controls'));
    mk('Settings', () => this._push('settings'));
    scr.padind = scr.el.querySelector('[data-r="padind"]');
    scr.starthint = scr.el.querySelector('[data-r="starthint"]');
    this._paintCards();
  }

  _start() {
    const g = this.game, id = this.heroSel;
    g.audio?.unlock?.();
    this.lastHero = id;
    this.hideMenus();
    g.begin(id);
  }

  // ---- pause
  _build_pause(scr) {
    scr.el.innerHTML = '<div class="panel"><h2>Paused</h2><div class="menu"></div></div>';
    const menu = scr.el.querySelector('.menu');
    const add = (l, a) => menu.appendChild(this._btn(scr, l, a));
    add('Resume', () => this._resume());
    add('Controls', () => this._push('controls'));
    add('Settings', () => this._push('settings'));
    add('Restart', () => {
      const g = this.game; this.hideMenus(); g.audio?.duck?.(false);
      g.begin(g.player?.id || this.lastHero);
    });
    add('Quit to Title', () => this._quit());
  }

  _quit() {
    const g = this.game;
    this.hideMenus();
    g.audio?.duck?.(false);
    for (const h of Object.values(g.heroes || {})) h.deactivate?.();
    g.enemies?.reset?.();
    g.state = 'menu';
    this.maxCombo = 0;
    this.showTitle();
  }

  // ---- game over / victory
  _build_gameover(scr) { this._buildEnd(scr, false); }
  _build_victory(scr) { this._buildEnd(scr, true); }
  _buildEnd(scr, win) {
    const s = scr.data;
    scr.el.innerHTML = `<div class="panel" style="text-align:center"><h2 class="${win ? 'win' : 'dead'}">${win ? 'Victory' : 'Game Over'}</h2>
      <div class="note" style="font-size:14px">${win ? 'Venom is down. The city is safe... for now.' : 'The symbiote tide swallowed the city.'}</div>
      <div class="stats"><div><b>${esc(s.kills)}</b><span>Takedowns</span></div><div><b>${fmtTime(s.time)}</b><span>Time</span></div><div><b>${esc(s.wave)}</b><span>Wave</span></div><div><b>${esc(s.maxCombo)}</b><span>Max Combo</span></div></div>
      <div class="menu" style="margin:0 auto"></div></div>`;
    const menu = scr.el.querySelector('.menu');
    const add = (l, a) => menu.appendChild(this._btn(scr, l, a));
    add(win ? 'Play Again' : 'Retry', () => { const g = this.game; this.hideMenus(); g.begin(this.lastHero || 'spiderman'); });
    add('Quit to Title', () => this._quit());
  }

  // ---- settings
  _build_settings(scr) {
    const g = this.game, s = g.settings, inp = g.input;
    scr.el.innerHTML = '<div class="panel"><h2>Settings</h2><div class="rows"></div><div class="note" data-r="note"></div></div>';
    const rows = scr.el.querySelector('.rows');
    const note = scr.el.querySelector('[data-r="note"]');
    const save = () => { g.saveSettings?.(); };
    const mkRow = (label) => {
      const r = document.createElement('div'); r.className = 'row';
      r.innerHTML = `<span class="lbl">${label}</span><span class="ctl-r" style="display:flex;gap:14px;align-items:center"></span>`;
      rows.appendChild(r); return r;
    };
    const cycle = (label, key, opts, onSet) => {
      const r = mkRow(label), c = r.querySelector('.ctl-r');
      const val = document.createElement('span'); val.className = 'val'; c.appendChild(val);
      const paint = () => { val.textContent = `◀  ${String(s[key]).toUpperCase()}  ▶`; };
      const adj = (d) => { const i = opts.indexOf(s[key]); s[key] = opts[(i + d + opts.length) % opts.length]; paint(); save(); onSet?.(s[key]); };
      this._item(scr, r, { adj, act: () => adj(1) });
      paint();
    };
    const toggle = (label, key, onSet) => {
      const r = mkRow(label), val = document.createElement('span'); val.className = 'val'; r.querySelector('.ctl-r').appendChild(val);
      const paint = () => { val.textContent = s[key] ? 'ON' : 'OFF'; };
      const adj = () => { s[key] = !s[key]; paint(); save(); onSet?.(s[key]); };
      this._item(scr, r, { adj, act: adj }); paint();
    };
    const slider = (label, key, min, max, def, onSet, fmt = (v) => `${Math.round(v * 100)}%`) => {
      const r = mkRow(label), c = r.querySelector('.ctl-r');
      const bar = document.createElement('div'); bar.className = 'sl'; bar.innerHTML = '<b></b>';
      const val = document.createElement('span'); val.className = 'val'; val.style.minWidth = '56px';
      c.append(bar, val);
      const paint = () => { const v = s[key] ?? def; bar.firstChild.style.width = `${((v - min) / (max - min)) * 100}%`; val.textContent = fmt(v); };
      const set = (v) => { s[key] = Math.max(min, Math.min(max, +v.toFixed(3))); paint(); save(); onSet?.(s[key]); };
      const adj = (d) => set((s[key] ?? def) + d * (max - min) / 20);
      bar.addEventListener('click', (e) => { e.stopPropagation(); const b = bar.getBoundingClientRect(); this._focus(scr.items.indexOf(it), true); set(min + ((e.clientX - b.left) / b.width) * (max - min)); });
      const it = this._item(scr, r, { adj, act: () => {}, click: () => {} });
      paint();
    };
    cycle('Graphics quality', 'quality', ['low', 'medium', 'high'], () => { note.textContent = 'Quality changes apply after reloading the game (F5).'; this.toast('Reload to apply quality'); });
    toggle('Invert Y (camera)', 'invertY', (v) => { inp.invertY = v; });
    slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 1, (v) => { inp.mouseSensitivity = 0.0022 * v; }, (v) => `${v.toFixed(2)}x`);
    slider('Stick sensitivity', 'stickSensitivity', 0.3, 2.5, 1, (v) => { inp.stickSensitivity = 3.2 * v; }, (v) => `${v.toFixed(2)}x`);
    slider('Master volume', 'volume', 0, 1, 0.8, () => g.audio?._applyVolumes?.());
    slider('Music volume', 'music', 0, 1, 0.5, () => g.audio?._applyVolumes?.());
    const back = document.createElement('div'); back.style.cssText = 'display:flex;justify-content:center;margin-top:14px';
    back.appendChild(this._btn(scr, 'Back', () => this._back()));
    scr.el.querySelector('.panel').insertBefore(back, note);
  }

  // ---- controls
  _build_controls(scr) {
    scr.el.innerHTML = `<div class="panel"><h2>Controls</h2>
      <div class="ctl"><div><h3>Keyboard &amp; Mouse</h3><table class="kt">${KB_ROWS.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table></div>
      <div><h3>DualShock 4 / DualSense</h3>${ds4Svg()}</div></div>
      <div class="heroctl">${ORDER.map((id) => `<div style="--c:${HERO_INFO[id].color}"><b>${HERO_INFO[id].name}</b>${esc(HERO_CONTROLS[id])}</div>`).join('')}</div>
      <div class="menu" style="margin:16px auto 0;min-width:0"></div></div>`;
    scr.el.querySelector('.menu').appendChild(this._btn(scr, 'Back', () => this._back()));
  }

  // ------------------------------------------------------------------ input handling for menus
  _onKey(e) {
    const scr = this.screen;
    if (!scr || scr.name === 'loading') return;
    if (e.repeat && ['Enter', 'Escape', 'Space', 'KeyP'].includes(e.code)) return;
    const k = e.code;
    let handled = true;
    if (performance.now() < this.lockUntil && (k === 'Escape' || k === 'KeyP')) return;
    switch (k) {
      case 'ArrowUp': case 'KeyW': this._focus(scr.index - 1); break;
      case 'ArrowDown': case 'KeyS': this._focus(scr.index + 1); break;
      case 'ArrowLeft': case 'KeyA': this._horiz(-1); break;
      case 'ArrowRight': case 'KeyD': this._horiz(1); break;
      case 'Enter': case 'NumpadEnter': case 'Space': this._activate(); break;
      case 'Escape': case 'Backspace': this._back(); break;
      case 'KeyP': if (scr.name === 'pause') this._resume(); else handled = false; break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  _pollPadMenu(dt) {
    const inp = this.game.input, scr = this.screen;
    const pad = inp.pad;
    // any pad button counts as a gesture for audio
    if (pad) {
      let any = false;
      for (const b of pad.buttons) if (b.pressed) any = true;
      if (any && !this._padAny) this.game.audio?.unlock?.();
      this._padAny = any;
    }
    if (!scr || inp.lastDevice !== 'gamepad') { this._navDir = ''; return; }
    if (performance.now() < this.lockUntil) return;
    // direction from the left stick or the D-pad (standard mapping buttons 12-15)
    let dir = '';
    const mx = inp.move.x, my = inp.move.y;
    const b = (i) => pad && pad.buttons[i] && pad.buttons[i].pressed;
    const std = pad && pad.mapping === 'standard';
    if (my > 0.6 || (std && b(12))) dir = 'up';
    else if (my < -0.6 || (std && b(13))) dir = 'down';
    else if (mx < -0.6 || (std && b(14)) || inp.pressed('heroPrev')) dir = 'left';
    else if (mx > 0.6 || (std && b(15)) || inp.pressed('heroNext')) dir = 'right';
    if (!dir) { this._navDir = ''; this._navT = 0; }
    else if (dir !== this._navDir) { this._navDir = dir; this._navT = 0.38; this._nav(dir); }
    else { this._navT -= dt; if (this._navT <= 0) { this._navT = 0.11; this._nav(dir); } }

    if (inp.pressed('jump')) this._activate();
    else if (inp.pressed('dodge')) this._back();
    else if (inp.pressed('pause')) {
      if (scr.name === 'pause') this._resume();
      else if (scr.name === 'settings' || scr.name === 'controls') this._back();
    }
  }

  _nav(dir) {
    const scr = this.screen; if (!scr) return;
    if (dir === 'up') this._focus(scr.index - 1);
    else if (dir === 'down') this._focus(scr.index + 1);
    else this._horiz(dir === 'left' ? -1 : 1);
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    const g = this.game, inp = g.input;
    this._pollPadMenu(dt);

    const playing = g.state === 'playing' || g.state === 'paused';
    this.$.game.classList.toggle('on', playing && !!g.player);

    // title screen indicator + hint
    const scr = this.screen;
    if (scr && scr.name === 'title') {
      const nm = inp.gamepadName;
      const pretty = !nm ? '' : /054c|dualshock|wireless controller/i.test(nm) ? 'DUALSHOCK 4' : /dualsense|0ce6/i.test(nm) ? 'DUALSENSE' : /xbox|045e/i.test(nm) ? 'XBOX CONTROLLER' : (nm.split('(')[0].trim() || 'GAMEPAD').toUpperCase();
      const txt = pretty ? `Controller connected: ${pretty}` : '';
      if (scr.padTxt !== txt) { scr.padTxt = txt; scr.padind.textContent = txt; }
      const hint = pretty ? 'Press <span class="glyph ps x">✕</span> / click to start &nbsp;&middot;&nbsp; ◀ ▶ choose hero' : 'Click / press Enter to start &nbsp;&middot;&nbsp; ◀ ▶ choose hero';
      if (scr.hintTxt !== hint) { scr.hintTxt = hint; scr.starthint.innerHTML = hint; }
    }

    if (!playing || !g.player) return;
    const p = g.player;

    // hp / name
    const frac = Math.max(0, p.hp / p.maxHp);
    const filled = Math.ceil(frac * this.SEG - 1e-6);
    if (this._sig.hp !== filled) {
      this.hpSegs.forEach((s, i) => s.classList.toggle('f', i < filled));
      this._sig.hp = filled;
    }
    this.$.hp.classList.toggle('low', frac < 0.3 && frac > 0);
    const hpTxt = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    if (this._sig.hpTxt !== hpTxt) { this._sig.hpTxt = hpTxt; this.$.hhp.textContent = hpTxt; }
    if (this._lastHp !== undefined && p === this._lastHero && p.hp < this._lastHp - 0.01) this.damageFlash();
    this._lastHp = p.hp; this._lastHero = p;
    const low = frac < 0.28 && frac > 0 && g.state === 'playing';
    if (low !== this._sig.low) { this._sig.low = low; this.$.vig.classList.toggle('low', low); }

    // focus
    const f = Math.max(0, Math.min(100, p.focus || 0));
    this.$.focusb.style.width = `${f}%`;
    const full = f >= 99.5;
    if (full !== this._sig.full) {
      this._sig.full = full; this.$.focus.classList.toggle('full', full);
      if (full) this.$.ult.innerHTML = `ULTIMATE READY &nbsp;${this._glyph('ultimate')}`;
    }

    // abilities (rebuild only when something changes)
    const pad = this._usePad();
    const hints = p.abilityHints || [];
    const sig = pad + (this._xbox() ? 'x' : '') + hints.map((h) => h.action + h.label).join('|');
    if (sig !== this._sig.abil) {
      this._sig.abil = sig;
      this.$.abil.className = `abil${pad ? ' pad' : ''}`;
      this.$.abil.innerHTML = hints.map((h) => `<div class="ab"><div class="ic">${this._glyph(h.action, pad)}<div class="cd"></div></div><div class="lb">${esc(h.label)}</div></div>`).join('');
      this._abEls = [...this.$.abil.children];
    }
    for (let i = 0; i < hints.length; i++) {
      const h = hints[i], el = this._abEls?.[i]; if (!el) continue;
      const cd = Math.max(0, Math.min(1, h.cooldown || 0));
      el.firstChild.lastChild.style.height = `${cd * 100}%`;
      el.classList.toggle('ready', cd <= 0.01);
      el.classList.toggle('act', !!h.active);
    }

    // combo
    const combo = p.combo || 0;
    if (combo > this.maxCombo) this.maxCombo = combo;
    const showC = combo >= 2;
    this.$.combo.classList.toggle('on', showC);
    if (showC) {
      if (this._sig.combo !== combo) {
        this._sig.combo = combo; this.$.combon.textContent = combo;
        this.$.combon.classList.remove('bump'); void this.$.combon.offsetWidth; this.$.combon.classList.add('bump');
      }
      this.$.combot.style.width = `${Math.max(0, Math.min(1, (p.comboTimer || 0) / 2.5)) * 100}%`;
    }

    // hero strip
    for (let i = 0; i < ORDER.length; i++) {
      const h = g.heroes?.[ORDER[i]], el = this.stripEls[i]; if (!h) continue;
      el.classList.toggle('act', h === p);
      el.classList.toggle('down', h.hp <= 0);
      el.querySelector('.mb b').style.width = `${Math.max(0, h.hp / h.maxHp) * 100}%`;
    }

    // crosshair for ranged-capable heroes
    this.$.xhair.classList.toggle('on', g.state === 'playing' && p.id !== 'hulk');

    // prompt timeout
    if (this._promptT > 0) { this._promptT -= dt; if (this._promptT <= 0) this.$.prompt.classList.remove('on'); }

    // map toggle
    if (g.state === 'playing' && inp.pressed('map')) {
      this._mapBig = !this._mapBig; this.$.mm.classList.toggle('big', this._mapBig);
      this.$.mmc.width = this.$.mmc.height = this._mapBig ? 640 : 336; this._mmT = 0;
    }

    // objective distance + waypoint
    const op = g.enemies?.objectivePos;
    if (op && this.objText) {
      const d = Math.hypot(op.x - p.pos.x, op.z - p.pos.z);
      const ds = `${Math.round(d)} m`;
      if (this._sig.ds !== ds) { this._sig.ds = ds; this.$.objds.textContent = ds; this.$.wpd.textContent = ds; }
      this._waypoint(op);
    } else { this.$.wp.classList.add('hidden'); this.$.objds.textContent = ''; }

    // minimap (throttled)
    this._mmT -= dt;
    if (this._mmT <= 0) { this._mmT = this._mapBig ? 0.12 : 0.06; this._drawMap(p, op); }
  }

  _waypoint(op) {
    const g = this.game, cam = g.camera, wp = this.$.wp;
    if (!cam) return;
    this._v = this._v || { x: 0 };
    const v = op.clone ? op.clone() : op;
    v.project(cam);
    const w = innerWidth, h = innerHeight;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (v.z > 1) { x = w - x; y = h - y; if (Math.abs(x - w / 2) < 1) x = w / 2; y = h - 60; }
    x = Math.max(50, Math.min(w - 50, x)); y = Math.max(60, Math.min(h - 120, y));
    wp.style.transform = `translate(${x}px, ${y}px)`;
    wp.classList.remove('hidden');
  }

  _drawMap(p, op) {
    const g = this.game, ctx = this.mmCtx, c = this.$.mmc, W = c.width, big = this._mapBig;
    ctx.clearRect(0, 0, W, W);
    const mm = g.world?.minimap;
    let a, b, cc, d, ox = W / 2, oy = W / 2, cx = 0, cz = 0;
    if (big) {
      const bd = g.world?.bounds;
      const size = mm?.size || (bd ? Math.max(bd.maxX - bd.minX, bd.maxZ - bd.minZ) : 800);
      cx = bd ? (bd.minX + bd.maxX) / 2 : 0; cz = bd ? (bd.minZ + bd.maxZ) / 2 : 0;
      const s = W / size * 0.96; a = s; b = 0; cc = 0; d = s;
    } else {
      const cam = g.camera;
      let fx = 0, fz = 1;
      if (cam) { const e = cam.matrixWorld.elements; fx = -e[8]; fz = -e[10]; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l; }
      const s = (W / 2) / 120;
      a = -fz * s; b = fx * s; cc = -fx * s; d = -fz * s;
      cx = p.pos.x; cz = p.pos.z;
    }
    const X = (x, z) => ox + a * (x - cx) + b * (z - cz);
    const Y = (x, z) => oy + cc * (x - cx) + d * (z - cz);
    ctx.fillStyle = 'rgba(70,90,150,0.55)';
    if (mm?.buildings) {
      const bl = mm.buildings;
      const limit = big ? Infinity : 140;
      for (let i = 0; i < bl.length; i++) {
        const q = bl[i];
        if (!big && (Math.abs(q.x - cx) > limit || Math.abs(q.z - cz) > limit)) continue;
        const hw = q.w / 2, hd = q.d / 2;
        ctx.beginPath();
        ctx.moveTo(X(q.x - hw, q.z - hd), Y(q.x - hw, q.z - hd));
        ctx.lineTo(X(q.x + hw, q.z - hd), Y(q.x + hw, q.z - hd));
        ctx.lineTo(X(q.x + hw, q.z + hd), Y(q.x + hw, q.z + hd));
        ctx.lineTo(X(q.x - hw, q.z + hd), Y(q.x - hw, q.z + hd));
        ctx.closePath(); ctx.fill();
      }
    }
    // enemies
    const list = g.enemies?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; if (e.alive === false || !e.pos) continue;
      const x = X(e.pos.x, e.pos.z), y = Y(e.pos.x, e.pos.z);
      if (!big && Math.hypot(x - W / 2, y - W / 2) > W / 2 - 4) continue;
      ctx.fillStyle = e.isBoss ? '#b04bff' : '#ff3b4e';
      ctx.beginPath(); ctx.arc(x, y, (e.isBoss ? 7 : 4) * (W / 336), 0, 6.283); ctx.fill();
    }
    // objective
    if (op) {
      let x = X(op.x, op.z), y = Y(op.x, op.z);
      if (!big) { const dx = x - W / 2, dy = y - W / 2, l = Math.hypot(dx, dy), m = W / 2 - 12; if (l > m) { x = W / 2 + dx / l * m; y = W / 2 + dy / l * m; } }
      ctx.fillStyle = '#ffe58a'; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      const r = 6 * (W / 336); ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
    }
    // player arrow
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const ang = Math.atan2(cc * fx + d * fz, a * fx + b * fz);
    const px = X(p.pos.x, p.pos.z), py = Y(p.pos.x, p.pos.z), sc = W / 336;
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(11 * sc, 0); ctx.lineTo(-8 * sc, 7 * sc); ctx.lineTo(-4 * sc, 0); ctx.lineTo(-8 * sc, -7 * sc); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }
}

// ---- DualShock 4 diagram -----------------------------------------------------------------------
function ds4Svg() {
  const L = (x1, y1, x2, y2) => `<line class="ln" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const labelsL = [
    ['L2 · Ability 2', 62, 222, 76], ['L1 · Ability', 96, 220, 96], ['D-pad ◀ ▶ · Switch hero', 150, 228, 158],
    ['Left stick · Move', 222, 285, 210], ['L3 (click) · Sprint', 256, 290, 214],
  ];
  const labelsR = [
    ['R2 (hold) · Swing / Boost', 62, 478, 76], ['R1 · Special', 96, 480, 96], ['△ · Ultimate', 128, 460, 130],
    ['○ · Dodge', 160, 490, 160], ['✕ · Jump / Web Wings', 192, 462, 190], ['□ · Attack', 224, 434, 162],
    ['Right stick · Camera', 256, 410, 210], ['R3 (click) · Recenter', 288, 400, 214],
  ];
  let t = '';
  for (const [s, y, tx, ty] of labelsL) t += `<text x="6" y="${y}">${s}</text>${L(190, y - 4, tx, ty)}`;
  for (const [s, y, tx, ty] of labelsR) t += `<text x="694" y="${y}" text-anchor="end">${s}</text>${L(512, y - 4, tx, ty)}`;
  t += `<text x="316" y="24" text-anchor="end">Touchpad · Map</text>${L(322, 22, 340, 110)}<text x="388" y="24">Options · Pause</text>${L(384, 22, 438, 116)}`;
  return `<svg viewBox="0 0 700 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DualShock 4 controls">
    <path d="M210 100C190 100 160 120 145 180C130 240 125 300 155 310C190 320 210 260 240 225L460 225C490 260 510 320 545 310C575 300 570 240 555 180C540 120 510 100 490 100Z" fill="#161a33" stroke="#7d8ac9" stroke-width="2"/>
    <rect x="190" y="62" width="60" height="24" rx="8" fill="#2a3160" stroke="#9aa6e6"/><rect x="450" y="62" width="60" height="24" rx="8" fill="#2a3160" stroke="#9aa6e6"/>
    <rect x="185" y="88" width="72" height="14" rx="6" fill="#39427a" stroke="#9aa6e6"/><rect x="443" y="88" width="72" height="14" rx="6" fill="#39427a" stroke="#9aa6e6"/>
    <rect x="295" y="108" width="110" height="52" rx="8" fill="#10132a" stroke="#9aa6e6"/>
    <rect x="262" y="114" width="14" height="8" rx="3" fill="#39427a"/><rect x="430" y="114" width="14" height="8" rx="3" fill="#39427a"/>
    <path d="M232 144h16v12h12v16h-12v12h-16v-12h-12v-16h12z" fill="#39427a" stroke="#9aa6e6"/>
    <circle cx="460" cy="132" r="11" fill="#162a22" stroke="#62e0b4"/><text x="460" y="137" text-anchor="middle" style="fill:#62e0b4;font-size:14px">△</text>
    <circle cx="488" cy="160" r="11" fill="#2a1620" stroke="#ff6b7e"/><text x="488" y="165" text-anchor="middle" style="fill:#ff6b7e;font-size:14px">○</text>
    <circle cx="460" cy="188" r="11" fill="#16203a" stroke="#7aa8ff"/><text x="460" y="193" text-anchor="middle" style="fill:#7aa8ff;font-size:14px">✕</text>
    <circle cx="432" cy="160" r="11" fill="#2a1630" stroke="#ff9ad8"/><text x="432" y="165" text-anchor="middle" style="fill:#ff9ad8;font-size:14px">□</text>
    <circle cx="305" cy="208" r="25" fill="#10132a" stroke="#9aa6e6" stroke-width="2"/><circle cx="305" cy="208" r="13" fill="#39427a"/>
    <circle cx="395" cy="208" r="25" fill="#10132a" stroke="#9aa6e6" stroke-width="2"/><circle cx="395" cy="208" r="13" fill="#39427a"/>
    <circle cx="350" cy="186" r="7" fill="#39427a" stroke="#9aa6e6"/>
    ${t}</svg>`;
}
