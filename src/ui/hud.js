// HUD, menus, character wheel and prompts. Contract: see docs/ARCHITECTURE.md (v2 additions).
// All DOM lives inside #hud. Menus are driven by keyboard, mouse and gamepad. Gamepad reads go ONLY through the
// input abstraction (input.padButton / input.move / input.rightStick / input.padInfo / input.lastRawButton), never
// through raw navigator.getGamepads() buttons, so they work for every controller profile.
import './hud.css';

const ORDER = ['spiderman', 'ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet'];

const S = (body, fill = 'none') => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const EMBLEM = {
  spiderman: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><ellipse cx="12" cy="13" rx="3" ry="4.5" fill="#fff"/><circle cx="12" cy="7.5" r="2" fill="#fff"/><path d="M9.2 10 3 5M9 13l-6 1M9.4 15.5 4 21M14.8 10 21 5M15 13l6 1M14.6 15.5 20 21"/></svg>',
  ironman: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2" fill="#fff"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>',
  hulk: '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="6" cy="9" r="2.4"/><circle cx="10.5" cy="7.2" r="2.4"/><circle cx="15" cy="7.2" r="2.4"/><circle cx="19" cy="9.6" r="2.2"/><path d="M4.5 10h16.5l-1 7a3 3 0 0 1-3 2.6H9a4 4 0 0 1-3.8-2.8z"/></svg>',
  thor: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M14 1 4.5 13.5H11L9 23l10.5-13.5H13z"/></svg>',
  wolverine: S('<path d="M5 3l3.5 18M11.5 2.5l2.5 19M18 3l1 18" stroke-width="2.6"/>'),
  captain: S('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.2"/><polygon points="12,7.4 13.4,10.7 17,11 14.3,13.4 15.1,17 12,15.1 8.9,17 9.7,13.4 7,11 10.6,10.7" fill="#fff" stroke="none"/>'),
  hawkeye: S('<path d="M7 3.5c9 5 9 12 0 17"/><path d="M7 3.5v17M3.5 12H21M17.5 8.5 21 12l-3.5 3.5"/>'),
  scarlet: S('<path d="M12 2.5 20 7.2v9.6L12 21.5 4 16.8V7.2z"/><path d="M12 7c3 0 4.5 3 2.5 5s-5 1-4.2-1.8" stroke-width="1.5"/><circle cx="12" cy="12" r="1.6" fill="#fff" stroke="none"/>'),
};

const HERO_INFO = {
  spiderman: { name: 'Spider-Man', color: '#e8213a', powers: ['Web-swing, zip, wall-run', 'Web Wings glide', 'Symbiote suit & Surge'] },
  ironman: { name: 'Iron Man', color: '#f0b429', powers: ['Repulsors & missiles', 'Thruster flight', 'Unibeam'] },
  hulk: { name: 'Hulk', color: '#4cc24b', powers: ['Super-jump & slam', 'Thunderclap, rock throw', 'Rage & Worldbreaker'] },
  thor: { name: 'Thor', color: '#5aa9ff', powers: ['Mjolnir throw & recall', 'Lightning & storm', 'Hammer flight, Bifrost'] },
  wolverine: { name: 'Wolverine', color: '#f2c230', powers: ['Adamantium claws', 'Lunge', 'Healing factor', 'Berserker rage'] },
  captain: { name: 'Captain America', color: '#2f6bd8', powers: ['Shield throw (ricochet)', 'Block & parry', 'Charge'] },
  hawkeye: { name: 'Hawkeye', color: '#8a4fd1', powers: ['Trick arrows', 'Bow aim', 'Grapple arrow'] },
  scarlet: { name: 'Scarlet Witch', color: '#e0254f', powers: ['Hex bolts', 'Telekinesis', 'Levitation', 'Reality warp'] },
};

const HERO_CONTROLS = {
  spiderman: 'Swing, web-shot, web-zip, symbiote suit, Surge',
  ironman: 'Fly, repulsor, missiles, Unibeam',
  hulk: 'Charge-jump, slam, clap, Rage, Worldbreaker',
  thor: 'Hammer, lightning, storm, Bifrost',
  wolverine: 'Claw combo, lunge, healing factor, Berserker',
  captain: 'Shield throw + ricochet, block / parry, charge',
  hawkeye: 'Trick arrows, bow aim, grapple',
  scarlet: 'Hex bolts, telekinesis, levitation, Reality Warp',
};

// action -> [keyboard label, PlayStation glyph, Xbox glyph]   (Controls v2)
const GLYPHS = {
  jump: ['SPACE', '✕', 'A'], dodge: ['C', '○', 'B'], attack: ['J / LMB', '□', 'X'], interact: ['F', '△', 'Y'],
  ability: ['E', 'L1', 'LB'], special: ['K / RMB', 'R1', 'RB'], ability2: ['R', 'L2', 'LT'], swing: ['SHIFT', 'R2', 'RT'],
  ultimate: ['Q', 'R3', 'RS'], sprint: ['ALT', 'L3', 'LS'], recenter: ['V', 'V', 'V'], heroNext: [']', 'D-pad →', 'D-pad →'], heroPrev: ['[', 'D-pad ←', 'D-pad ←'],
  pause: ['ESC', 'OPTIONS', 'MENU'], map: ['M', 'TOUCHPAD', 'VIEW'], wheel: ['TAB', 'D-pad ↑', 'D-pad ↑'], weaponNext: ['X', 'D-pad ↓', 'D-pad ↓'],
  weaponPrev: ['Z', 'Z', 'Z'], aim: ['RMB', 'L2', 'LT'], fire: ['LMB', 'R2', 'RT'], reload: ['R', 'auto', 'auto'],
  throttle: ['W', 'R2', 'RT'], brake: ['S', 'L2', 'LT'], handbrake: ['SPACE', '✕', 'A'], horn: ['H', 'L3', 'LS'], steer: ['A D', 'L STICK', 'L STICK'],
};
const PS_CLASS = { jump: 'x', dodge: 'o', attack: 'sq', interact: 'tr', handbrake: 'x' };

const ON_FOOT = [
  ['Move / Look', 'W A S D / Mouse', 'L stick / R stick'], ['Jump / Web Wings', 'Space', '✕'],
  ['Swing / Fly (hold)', 'Shift', 'R2'], ['Attack', 'LMB / J', '□'], ['Special', 'RMB / K', 'R1'],
  ['Ability', 'E', 'L1'], ['Ability 2', 'R', 'L2'], ['Ultimate (full Focus)', 'Q', 'R3 (click R stick)'],
  ['Dodge', 'C / Ctrl', '○'], ['Sprint', 'Alt', 'L3'], ['Interact: car, shop', 'F', '△'],
  ['Hero wheel (hold)', 'Tab', 'D-pad ↑'], ['Quick switch', '[ ]  /  1 - 8', 'D-pad ◀ ▶'],
  ['Recenter camera', 'V / MMB', '-'], ['Map', 'M', 'Touchpad / Share'], ['Pause', 'Esc / P', 'Options'],
];
const DRIVING = [
  ['Accelerate', 'W / ↑', 'R2 (analog)'], ['Brake / reverse', 'S / ↓', 'L2 (analog)'], ['Steer', 'A D / ← →', 'L stick'],
  ['Handbrake', 'Space', '✕'], ['Horn', 'H', 'L3'], ['Exit car', 'F', '△'], ['Camera', 'Mouse', 'R stick'],
  ['Take the wheel (hero wheel)', 'Tab', 'D-pad ↑'],
];
const WEAPONS = [
  ['Aim', 'RMB', 'L2'], ['Fire', 'LMB', 'R2'], ['Reload', 'R', 'automatic'],
  ['Next weapon', 'X / wheel ↓', 'D-pad ↓'], ['Previous weapon', 'Z / wheel ↑', '-'],
  ['Shop', 'F at a shop', '△ at a shop'], ['Melee (gun out)', 'J / K', '□ / R1'],
];

// virtual-standard pad buttons shown in diagnostics and the remap flow
const STD_BTN = [
  [0, '✕'], [1, '○'], [2, '□'], [3, '△'], [4, 'L1'], [5, 'R1'], [6, 'L2'], [7, 'R2'], [8, 'Share'], [9, 'Options'],
  [10, 'L3'], [11, 'R3'], [12, 'D-pad ↑'], [13, 'D-pad ↓'], [14, 'D-pad ←'], [15, 'D-pad →'], [17, 'Touchpad'],
];
const STD_NAME = Object.fromEntries(STD_BTN);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const cssColor = (c, fb = '#e8213a') => (c === undefined || c === null ? fb : typeof c === 'number' ? `#${c.toString(16).padStart(6, '0')}` : c);
const isEmbedded = () => { try { return window.top !== window.self; } catch { return true; } };

function prettyPad(id = '') {
  if (/054c.*(05c4|09cc|0ba0)|dualshock|wireless controller/i.test(id)) return 'DUALSHOCK 4';
  if (/dualsense|0ce6|0df2/i.test(id)) return 'DUALSENSE';
  if (/xbox|045e|xinput/i.test(id)) return 'XBOX CONTROLLER';
  return (id.split('(')[0].replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'GAMEPAD').toUpperCase();
}

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
    this._pp = {};            // previous pad button states for menu edge detection
    this._mmT = 0; this._mapBig = false;
    this._lastToast = '';
    this._promptT = 0;
    this._xk = null;          // crosshair kind
    this._wheelOn = false; this._wsel = null; this._wm = { x: 0, y: 0 }; this._mdx = 0; this._mdy = 0;
    this._cash = { shown: 0, target: 0 };
    this._ctxT = 0; this._nearPolice = false; this._policeT = 0;
    this._driveHinted = false; this._dhintT = 0;
    this._padT = 0; this._ctlT = 0;
    this._buildGame();
    this._applySettings();

    // audio unlock on first interaction
    const unlock = () => { this.game.audio?.unlock?.(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true });

    addEventListener('keydown', (e) => this._onKey(e), true);
    addEventListener('mousemove', (e) => { if (this._wheelOn) { this._mdx += e.movementX || 0; this._mdy += e.movementY || 0; } });
    this._registerSW();
    this._bindEvents();
  }

  // ------------------------------------------------------------------ setup
  _applySettings() {
    const s = this.game.settings || {}, inp = this.game.input;
    if (!inp) return;
    inp.invertY = !!s.invertY;
    inp.mouseSensitivity = 0.0022 * (s.sensitivity ?? 1);
    inp.stickSensitivity = 3.2 * (s.stickSensitivity ?? 1);
    if (typeof s.deadzone === 'number') inp.deadzone = s.deadzone;
  }

  _registerSW() {
    try {
      if (import.meta.env?.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL || './'}sw.js`).catch(() => {}));
      }
    } catch { /* ignore */ }
  }

  _bindEvents() {
    const ev = this.game.events;
    if (!ev?.on) return;
    ev.on('cash', (e) => {
      const amt = e?.amount || 0;
      if (this._cash.target === undefined) return;
      this.$.cash.classList.remove('bump', 'neg'); void this.$.cash.offsetWidth;
      this.$.cash.classList.add(amt < 0 ? 'neg' : 'bump');
      if (amt) {
        const f = document.createElement('span');
        f.className = `cf${amt < 0 ? ' neg' : ''}`; f.textContent = `${amt < 0 ? '-' : '+'}$${Math.abs(amt)}`;
        this.$.cashf.appendChild(f);
        setTimeout(() => f.remove(), 1300);
        while (this.$.cashf.children.length > 4) this.$.cashf.firstChild.remove();
        if (amt > 0) this.game.audio?.play?.('cash', { volume: 0.8 });
      }
    });
    ev.on('vehicle:enter', () => {
      if (!this._driveHinted) { this._driveHinted = true; this._showDriveHint(); }
    });
    ev.on('vehicle:exit', () => { this.$.dhint.classList.remove('on'); this._dhintT = 0; });
    ev.on('hero:switch', () => { this._sig.abil = ''; });
  }

  _buildGame() {
    const r = this.root;
    r.innerHTML = `
      <div class="hud-game" data-r="game">
        <div class="vignette" data-r="vig"></div>
        <div class="scope" data-r="scope"></div>
        <div class="xhair" data-r="xhair"></div>
        <div class="wp hidden" data-r="wp"><div class="dm"></div><div class="ds" data-r="wpd"></div></div>
        <div class="obj hidden" data-r="obj"><div class="k">OBJECTIVE</div><div class="tx" data-r="objtx"></div><div class="ds" data-r="objds"></div><div class="pg hidden" data-r="objpg"><b></b></div></div>
        <div class="boss" data-r="boss"><div class="nm" data-r="bossnm"></div><div class="bar"><b data-r="bossbar"></b></div></div>
        <div class="rcol" data-r="rcol">
          <div class="strip" data-r="strip"></div>
          <div class="shint" data-r="shint">Tab / D-pad ↑ &mdash; switch hero</div>
          <div class="mm" data-r="mm"><canvas data-r="mmc" width="336" height="336"></canvas></div>
          <div class="cash" data-r="cash"><span class="cur">$</span><b data-r="cashn">0</b><div class="cfl" data-r="cashf"></div></div>
          <div class="wanted" data-r="wanted"><i>★</i><i>★</i><i>★</i><i>★</i><i>★</i></div>
        </div>
        <div class="toasts" data-r="toasts"></div>
        <div class="sense" data-r="sense">!</div>
        <div class="prompt" data-r="prompt"></div>
        <div class="ctxp" data-r="ctxp"></div>
        <div class="dhint" data-r="dhint"></div>
        <div class="combo" data-r="combo"><div class="n" data-r="combon">0</div><div class="l">HIT COMBO</div><div class="t"><b data-r="combot"></b></div></div>
        <div class="badge">
          <div class="portrait" data-r="portrait"></div>
          <div class="bars">
            <div class="hname"><span data-r="hname">-</span><small data-r="hhp"></small></div>
            <div class="hp" data-r="hp"></div>
            <div class="focus" data-r="focus"><div class="ult" data-r="ult">ULTIMATE READY</div><b data-r="focusb"></b></div>
          </div>
        </div>
        <div class="wpn hidden" data-r="wpn"><div class="wn" data-r="wpnn"></div><div class="wa"><b data-r="wpnc"></b><span data-r="wpnr"></span></div></div>
        <div class="speedo hidden" data-r="speedo">
          <svg viewBox="0 0 120 70"><path class="tr" d="M10 62A50 50 0 0 1 110 62" pathLength="100"/><path class="fl" data-r="spdarc" d="M10 62A50 50 0 0 1 110 62" pathLength="100" stroke-dasharray="0 100"/></svg>
          <div class="sv"><b data-r="spdn">0</b><small>KM/H</small></div>
          <div class="ch"><span data-r="carn">CAR</span><div class="cb"><b data-r="carhp"></b></div></div>
        </div>
        <div class="abil" data-r="abil"></div>
        <div class="wheel" data-r="wheel">
          <div class="wh-ring" data-r="whring">
            <div class="wh-c"><div class="wh-ndl" data-r="whndl"></div><b data-r="whn"></b><small data-r="whh"></small><em data-r="whe">Aim with stick / mouse &middot; release to switch</em></div>
          </div>
        </div>
      </div>
      <div data-r="screens"></div>`;
    this.$ = {};
    r.querySelectorAll('[data-r]').forEach((el) => { this.$[el.dataset.r] = el; });
    this.mmCtx = this.$.mmc.getContext('2d');
    this.$.hp.innerHTML = '<i></i>'.repeat(this.SEG = 20);
    this.hpSegs = [...this.$.hp.children];
    this.starEls = [...this.$.wanted.children];
    // hero strip (compact)
    this.$.strip.innerHTML = ORDER.map((id, i) => `<div class="hs" data-id="${id}" style="--c:${HERO_INFO[id].color}" title="${HERO_INFO[id].name}"><div class="pt">${EMBLEM[id]}</div><div class="mb"><b></b></div><div class="kk">${i + 1}</div></div>`).join('');
    this.stripEls = ORDER.map((id) => this.$.strip.querySelector(`[data-id="${id}"]`));
    this.stripEls.forEach((el, i) => el.addEventListener('click', () => this.game.state === 'playing' && this.game.switchHero?.(ORDER[i])));
    this.$.strip.style.pointerEvents = 'auto';
    // character wheel items
    this.wheelEls = ORDER.map((id, i) => {
      const a = (i / ORDER.length) * Math.PI * 2;
      const el = document.createElement('div');
      el.className = 'wh-i'; el.style.setProperty('--c', HERO_INFO[id].color);
      el.style.left = `${50 + Math.sin(a) * 38}%`; el.style.top = `${50 - Math.cos(a) * 38}%`;
      el.innerHTML = `<div class="wh-p">${EMBLEM[id]}</div><div class="wh-n">${esc(HERO_INFO[id].name)}</div><div class="wh-b"><b></b></div>`;
      this.$.whring.appendChild(el);
      return el;
    });
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
    this._closeWheel(false);
    this._open('title');
    this.game.audio?.music?.('roam');
  }

  showPause() { this.stack = []; this._closeWheel(false); this._open('pause'); }

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
    this.game.audio?.engine?.(false);
    this.game.audio?.siren?.(false);
    this._open(win ? 'victory' : 'gameover', s);
  }

  setHero(hero) {
    if (!hero) return;
    this.hero = hero;
    this.lastHero = hero.id;
    const css = cssColor(hero.color ?? HERO_INFO[hero.id]?.color);
    this.root.style.setProperty('--hero', css);
    this.$.portrait.innerHTML = EMBLEM[hero.id] || '';
    this.$.hname.textContent = hero.name || HERO_INFO[hero.id]?.name || hero.id;
    this._sig.hp = -1; this._sig.abil = '';
    const c = this.game.economy?.cash ?? 0;
    if (!this._cashInit) { this._cash.shown = this._cash.target = c; this._cashInit = true; }
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

  /** Weapons system: 'pistol'|'rifle'|'shotgun'|'sniper'|'bow'|null. Sniper shows the scope overlay. */
  setCrosshair(kind) {
    kind = kind || null;
    if (kind === this._xk) return;
    this._xk = kind;
    const xh = this.$.xhair;
    xh.className = `xhair${kind ? ` k-${kind}` : ''}`;
    xh.innerHTML = kind ? (XH[kind] || XH.pistol) : '';
    this.$.scope.classList.toggle('on', kind === 'sniper');
  }

  // ------------------------------------------------------------------ glyphs
  _usePad() { return this.game.input?.lastDevice === 'gamepad'; }
  _xbox() { return /xbox|045e/i.test(this.game.input?.gamepadName || '') && !/054c|dualshock|dualsense/i.test(this.game.input?.gamepadName || ''); }
  _glyph(action, pad = this._usePad()) {
    const g = GLYPHS[action];
    if (!g) return `<span class="glyph k">${esc(action)}</span>`;
    if (!pad) return `<span class="glyph k${g[0].length > 4 ? ' sh' : ''}">${esc(g[0])}</span>`;
    if (this._xbox()) return `<span class="glyph k${g[2].length > 4 ? ' sh' : ''}">${esc(g[2])}</span>`;
    const c = PS_CLASS[action];
    return `<span class="glyph ${c ? `ps ${c}` : `k${g[1].length > 4 ? ' sh' : ''}`}">${esc(g[1])}</span>`;
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
    if (scr.name !== 'title') scr.items[scr.index].el.scrollIntoView?.({ block: 'nearest' });
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
        <div class="menu"></div>
        <div class="hint" data-r="starthint"></div>
        <div class="padind" data-r="padind" title="Controller settings"></div>
      </div>
      <div class="foot">Fan-made tribute &middot; not affiliated with Marvel or Insomniac</div>`;
    const cards = scr.el.querySelector('.cards');
    for (const id of ORDER) {
      const info = HERO_INFO[id];
      const h = this.game.heroes?.[id];
      const c = document.createElement('div');
      c.className = 'card'; c.dataset.id = id;
      c.style.setProperty('--c', cssColor(h?.color, info.color));
      c.innerHTML = `<div class="pt">${EMBLEM[id]}</div><div class="ct"><h3>${esc(h?.name || info.name)}</h3><ul>${info.powers.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
      c.addEventListener('click', () => { this.heroSel = id; this.game.audio?.play('ui_move'); this._paintCards(); });
      c.addEventListener('dblclick', () => this._start());
      cards.appendChild(c);
    }
    const menu = scr.el.querySelector('.menu');
    const mk = (label, act, cls) => { const b = this._btn(scr, label, act, cls); menu.appendChild(b); return b; };
    mk('Start', () => this._start(), 'big');
    mk('Controls', () => this._push('controls'));
    mk('Settings', () => this._push('settings'));
    scr.padind = scr.el.querySelector('[data-r="padind"]');
    scr.padind.addEventListener('click', () => { this.game.audio?.play('ui_select'); this._push('controller'); });
    scr.starthint = scr.el.querySelector('[data-r="starthint"]');
    this._paintCards();
    this._titleStatus(scr, true);
  }

  /** Controller status line on the title screen (also the help text when nothing is detected). */
  _titleStatus(scr, force) {
    const inp = this.game.input;
    const api = typeof navigator.getGamepads === 'function';
    let list = [];
    try { list = api ? [...navigator.getGamepads()].filter(Boolean) : []; } catch { list = []; }
    const connected = !!inp.pad && inp.padIndex >= 0;
    const name = connected ? prettyPad(inp.gamepadName) : '';
    const sig = `${connected}|${name}|${list.length}|${api}|${inp.isPlayStation}|${this._xbox()}`;
    if (!force && scr.padSig === sig) return;
    scr.padSig = sig;
    let html, cls;
    if (connected) {
      const key = this._xbox() ? 'A' : inp.isPlayStation ? '✕' : '✕ / A';
      html = `Controller connected: ${esc(name)} &mdash; press ${key}`;
      cls = 'ok';
    } else {
      cls = 'warn';
      if (!api) html = 'Your browser does not expose the Gamepad API. Use Chrome or Edge, in its own tab, to play with a controller.';
      else {
        html = 'No controller detected: press any button on it. If it\'s still missing, open the game in its own tab/window (embedded pages can block controllers), use Chrome/Edge, or connect via USB.';
        if (isEmbedded()) html += ' <b>This page is embedded in another page (iframe) &mdash; browsers often block controllers there.</b>';
        if (list.length) html += ` <span class="dim">Ignored device${list.length > 1 ? 's' : ''}: ${list.map((p) => esc((p.id || '?').slice(0, 48))).join(' &middot; ')}</span>`;
      }
    }
    scr.padind.className = `padind ${cls}`;
    scr.padind.innerHTML = html + ' <u>Controller settings</u>';
    const pad = connected;
    scr.starthint.innerHTML = pad
      ? `${this._glyph('jump', true)} / click to start &nbsp;&middot;&nbsp; D-pad ◀ ▶ choose hero`
      : 'Click / press Enter to start &nbsp;&middot;&nbsp; ◀ ▶ choose hero';
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
    g.audio?.engine?.(false); g.audio?.siren?.(false);
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

  // ---- generic settings rows
  _mkRow(rows, label) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span class="lbl">${label}</span><span class="ctl-r"></span>`;
    rows.appendChild(r); return r;
  }
  _rowCycle(scr, rows, label, get, set, opts, fmt = (v) => String(v).toUpperCase()) {
    const r = this._mkRow(rows, label), c = r.querySelector('.ctl-r');
    const val = document.createElement('span'); val.className = 'val'; c.appendChild(val);
    const paint = () => { val.textContent = `◀  ${fmt(get())}  ▶`; };
    const adj = (d) => { const i = opts.indexOf(get()); set(opts[(i + d + opts.length) % opts.length]); paint(); };
    const it = this._item(scr, r, { adj, act: () => adj(1) });
    paint(); it.paint = paint;
    return it;
  }
  _rowToggle(scr, rows, label, get, set) {
    const r = this._mkRow(rows, label), val = document.createElement('span'); val.className = 'val'; r.querySelector('.ctl-r').appendChild(val);
    const paint = () => { val.textContent = get() ? 'ON' : 'OFF'; };
    const adj = () => { set(!get()); paint(); };
    const it = this._item(scr, r, { adj, act: adj }); paint();
    return it;
  }
  _rowSlider(scr, rows, label, get, set, min, max, fmt = (v) => `${Math.round(v * 100)}%`) {
    const r = this._mkRow(rows, label), c = r.querySelector('.ctl-r');
    const bar = document.createElement('div'); bar.className = 'sl'; bar.innerHTML = '<b></b>';
    const val = document.createElement('span'); val.className = 'val'; val.style.minWidth = '56px';
    c.append(bar, val);
    const paint = () => { const v = get(); bar.firstChild.style.width = `${((v - min) / (max - min)) * 100}%`; val.textContent = fmt(v); };
    const put = (v) => { set(Math.max(min, Math.min(max, +v.toFixed(3)))); paint(); };
    const adj = (d) => put(get() + d * (max - min) / 20);
    bar.addEventListener('click', (e) => { e.stopPropagation(); const b = bar.getBoundingClientRect(); this._focus(scr.items.indexOf(it), true); put(min + ((e.clientX - b.left) / b.width) * (max - min)); });
    const it = this._item(scr, r, { adj, act: () => {}, click: () => {} });
    paint();
    return it;
  }

  // ---- settings
  _build_settings(scr) {
    const g = this.game, s = g.settings, inp = g.input;
    scr.el.innerHTML = '<div class="panel"><h2>Settings</h2><div class="rows"></div><div class="btnrow"></div><div class="note" data-r="note"></div></div>';
    const rows = scr.el.querySelector('.rows');
    const note = scr.el.querySelector('[data-r="note"]');
    const save = () => { g.saveSettings?.(); };
    this._rowCycle(scr, rows, 'Graphics quality', () => s.quality, (v) => { s.quality = v; save(); note.textContent = 'Quality changes apply after reloading the game (F5).'; this.toast('Reload to apply quality'); }, ['low', 'medium', 'high', 'ultra']);
    this._rowToggle(scr, rows, 'Invert Y (camera)', () => !!s.invertY, (v) => { s.invertY = v; inp.invertY = v; save(); });
    this._rowSlider(scr, rows, 'Mouse sensitivity', () => s.sensitivity ?? 1, (v) => { s.sensitivity = v; inp.mouseSensitivity = 0.0022 * v; save(); }, 0.2, 3, (v) => `${v.toFixed(2)}x`);
    this._rowSlider(scr, rows, 'Stick sensitivity', () => s.stickSensitivity ?? 1, (v) => { s.stickSensitivity = v; inp.stickSensitivity = 3.2 * v; save(); }, 0.3, 2.5, (v) => `${v.toFixed(2)}x`);
    this._rowSlider(scr, rows, 'Master volume', () => s.volume ?? 0.8, (v) => { s.volume = v; save(); g.audio?._applyVolumes?.(); }, 0, 1);
    this._rowSlider(scr, rows, 'Music volume', () => s.music ?? 0.5, (v) => { s.music = v; save(); g.audio?._applyVolumes?.(); }, 0, 1);
    const br = scr.el.querySelector('.btnrow');
    br.appendChild(this._btn(scr, 'Controller', () => this._push('controller')));
    br.appendChild(this._btn(scr, 'Back', () => this._back()));
  }

  // ---- controller settings: diagnostics + tuning + remap
  _build_controller(scr) {
    const g = this.game, s = g.settings, inp = g.input;
    scr.el.innerHTML = `<div class="panel wide"><h2>Controller</h2>
      <div class="cgrid">
        <div class="cdiag"><h3>Detected devices</h3><div data-r="cdev"></div><h3>What the game sees (standard layout)</h3><div data-r="cvirt"></div></div>
        <div class="cset"><div class="rows" data-r="crows"></div><h3>Remap a button</h3>
          <div class="chips" data-r="cchips"></div></div>
      </div>
      <div class="note remapnote" data-r="cnote"></div>
      <div class="btnrow" data-r="cbtns"></div></div>`;
    const q = (n) => scr.el.querySelector(`[data-r="${n}"]`);
    scr.cdev = q('cdev'); scr.cvirt = q('cvirt'); scr.cnote = q('cnote');
    const save = () => { g.saveSettings?.(); };
    const rows = q('crows');
    this._rowSlider(scr, rows, 'Stick deadzone', () => inp.deadzone, (v) => { inp.deadzone = v; s.deadzone = v; save(); }, 0.02, 0.5, (v) => `${Math.round(v * 100)}%`);
    this._rowSlider(scr, rows, 'Stick sensitivity', () => s.stickSensitivity ?? 1, (v) => { s.stickSensitivity = v; inp.stickSensitivity = 3.2 * v; save(); }, 0.3, 2.5, (v) => `${v.toFixed(2)}x`);
    this._rowToggle(scr, rows, 'Invert Y (camera)', () => !!s.invertY, (v) => { s.invertY = v; inp.invertY = v; save(); });
    const rum = this._mkRow(rows, 'Vibration test');
    rum.querySelector('.ctl-r').innerHTML = '<span class="val">▶ TEST</span>';
    this._item(scr, rum, { act: () => {
      const hasAct = !!(inp.pad?.vibrationActuator || inp.pad?.hapticActuators?.length);
      inp.rumble(0.9, 0.9, 400);
      scr.cnote.textContent = !inp.pad ? 'No controller active: press a button on it first.' : hasAct ? 'Rumble sent. If you felt nothing, your browser/OS may not support vibration for this pad (Chrome/Edge over USB works best).' : 'This browser does not expose vibration for this controller.';
    } });
    scr.remapIdx = 0;
    const remapRow = this._rowCycle(scr, rows, 'Remap button', () => scr.remapIdx, (v) => { scr.remapIdx = v; }, STD_BTN.map((_, i) => i), (i) => STD_BTN[i][1]);
    remapRow.act = () => this._remapStart(scr, STD_BTN[scr.remapIdx][0]);
    remapRow.click = () => this._remapStart(scr, STD_BTN[scr.remapIdx][0]);
    this._item(scr, this._mkRow(rows, 'Reset remap to default'), { act: () => this._remapReset(scr) });
    // clickable chips (mouse / touch friendly)
    const chips = q('cchips');
    for (const [std, label] of STD_BTN) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'chip'; c.dataset.std = std; c.innerHTML = `<b>${esc(label)}</b><i></i>`;
      c.addEventListener('click', (e) => { e.stopPropagation(); scr.remapIdx = STD_BTN.findIndex((x) => x[0] === std); scr.items.forEach((it) => it.paint?.()); this._remapStart(scr, std); });
      chips.appendChild(c);
    }
    scr.chips = chips;
    const br = q('cbtns');
    br.appendChild(this._btn(scr, 'Back', () => { this._remapCancel(scr, true); this._back(); }));
    this._paintRemap(scr);
    this._tickController(scr, 0, true);
  }

  _remapStart(scr, std) {
    const inp = this.game.input;
    if (!inp.pad) { scr.cnote.textContent = 'No controller active yet: press any button on it, then try again.'; return; }
    scr.listen = { std, t: 10 };
    inp.lastRawButton = -1;
    scr.cnote.innerHTML = `Press the button on your controller you want to use as <b>${esc(STD_NAME[std])}</b>&hellip; (Esc or click here to cancel)`;
    scr.cnote.classList.add('listening');
    this._paintRemap(scr);
  }
  _remapCancel(scr, silent) {
    if (!scr.listen) return;
    scr.listen = null; scr.cnote?.classList.remove('listening');
    if (!silent && scr.cnote) scr.cnote.textContent = 'Remap cancelled.';
    this._paintRemap(scr);
  }
  _remapApply(scr, raw) {
    const g = this.game, inp = g.input, std = scr.listen.std;
    scr.listen = null; scr.cnote.classList.remove('listening');
    inp.padRemap = { ...inp.padRemap, [std]: raw };
    g.settings.padRemap = { ...inp.padRemap };
    g.saveSettings?.();
    g.audio?.play('ui_select');
    scr.cnote.innerHTML = `Mapped <b>${esc(STD_NAME[std])}</b> to physical button #${raw}. Test it in &ldquo;What the game sees&rdquo;.`;
    this._paintRemap(scr);
  }
  _remapReset(scr) {
    const g = this.game;
    g.input.padRemap = {}; g.settings.padRemap = null; g.saveSettings?.();
    this._remapCancel(scr, true);
    scr.cnote.textContent = 'Button remap reset to default.';
    this._paintRemap(scr);
  }
  _paintRemap(scr) {
    const rm = this.game.input.padRemap || {};
    scr.chips?.querySelectorAll('.chip').forEach((c) => {
      const std = +c.dataset.std;
      c.classList.toggle('mapped', rm[std] !== undefined);
      c.classList.toggle('listen', scr.listen?.std === std);
      c.lastChild.textContent = rm[std] !== undefined ? `#${rm[std]}` : '';
    });
  }

  /** Live device list + virtual pad, refreshed ~10x/s while the controller screen is open. */
  _tickController(scr, dt, force) {
    const inp = this.game.input;
    if (scr.listen) {
      scr.listen.t -= dt;
      if (inp.lastRawButton >= 0) this._remapApply(scr, inp.lastRawButton);
      else if (scr.listen.t <= 0) { this._remapCancel(scr, true); scr.cnote.textContent = 'Timed out waiting for a button.'; }
    }
    this._ctlT -= dt;
    if (!force && this._ctlT > 0) return;
    this._ctlT = 0.09;
    const info = inp.padInfo?.() || [];
    const api = typeof navigator.getGamepads === 'function';
    let h = '';
    if (!api) h = '<div class="dev bad">navigator.getGamepads is not available in this browser. Use Chrome or Edge.</div>';
    else if (!info.length) {
      h = `<div class="dev bad">No device reported. Press a button on the controller (browsers hide pads until the first press).${isEmbedded() ? '<br><b>Embedded page: open the game in its own tab or window, embedded frames may block controllers.</b>' : ''}</div>`;
    }
    for (const d of info) {
      const btn = d.buttons.map((v, i) => `<i class="${v > 0.5 ? 'on' : ''}" style="--v:${v}">${i}</i>`).join('');
      const ax = d.axes.map((v, i) => `<span class="ax"><em>${i}</em><u><b style="left:${v < 0 ? 50 + v * 50 : 50}%;width:${Math.abs(v) * 50}%"></b></u></span>`).join('');
      h += `<div class="dev${d.active ? ' active' : ''}${d.usable ? '' : ' ign'}">
        <div class="dh"><span class="di">#${d.index}</span><span class="dn" title="${esc(d.id)}">${esc(d.id)}</span>${d.active ? '<span class="tag">ACTIVE</span>' : ''}${d.usable ? '' : '<span class="tag no">IGNORED</span>'}</div>
        <div class="dm">mapping: <b>${esc(d.mapping)}</b> &middot; profile: <b>${esc(d.profile)}</b> &middot; ${d.buttons.length} buttons, ${d.axes.length} axes &middot; rumble: <b>${d.rumble ? 'yes' : 'no'}</b></div>
        <div class="bt">${btn}</div><div class="axs">${ax}</div></div>`;
    }
    if (scr.devHtml !== h) { scr.devHtml = h; scr.cdev.innerHTML = h; }
    // virtual standard pad as the game interprets it (after profile translation + remap)
    let v = '<div class="vpad">' + STD_BTN.map(([i, l]) => `<span class="${inp.vb?.[i] > 0.5 ? 'on' : ''}">${esc(l)}</span>`).join('') + '</div>';
    const va = inp.va || [];
    v += '<div class="vax">' + ['LX', 'LY', 'RX', 'RY'].map((n, i) => { const a = va[i] || 0; return `<span class="ax"><em>${n}</em><u><b style="left:${a < 0 ? 50 + a * 50 : 50}%;width:${Math.abs(a) * 50}%"></b></u></span>`; }).join('') + '</div>';
    if (scr.virtHtml !== v) { scr.virtHtml = v; scr.cvirt.innerHTML = v; }
  }

  // ---- controls
  _build_controls(scr) {
    const tbl = (rows) => `<table class="kt">${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>`;
    scr.el.innerHTML = `<div class="panel wide"><h2>Controls</h2>
      <div class="ctl"><div><h3>On foot &middot; keyboard &amp; mouse / controller</h3>${tbl(ON_FOOT)}</div>
      <div><h3>DualShock 4 / DualSense</h3>${ds4Svg()}</div></div>
      <div class="ctl2"><div><h3>Driving</h3>${tbl(DRIVING)}</div><div><h3>Weapons</h3>${tbl(WEAPONS)}</div></div>
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
    if (scr.listen) { // remapping: Esc cancels, everything else belongs to the pad
      if (k === 'Escape') { this._remapCancel(scr); e.preventDefault(); e.stopPropagation(); }
      return;
    }
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
    // edge detection on the virtual standard pad (works for every controller profile)
    const cur = {
      up: inp.padButton(12), down: inp.padButton(13), left: inp.padButton(14), right: inp.padButton(15),
      ok: inp.padButton(0), back: inp.padButton(1), opt: inp.padButton(9),
    };
    const pr = this._pp; this._pp = cur;
    const any = inp.padButton(0) || inp.padButton(1) || inp.padButton(2) || inp.padButton(3) || cur.opt;
    if (any && !this._padAny) this.game.audio?.unlock?.();
    this._padAny = any;
    if (!scr || scr.name === 'loading') { this._navDir = ''; return; }
    if (performance.now() < this.lockUntil) return;
    if (scr.listen) return;                       // remap flow owns the pad
    const padActive = inp.lastDevice === 'gamepad' && !!inp.pad;
    let dir = '';
    const mx = padActive ? inp.move.x : 0, my = padActive ? inp.move.y : 0;
    if (cur.up || my > 0.6) dir = 'up';
    else if (cur.down || my < -0.6) dir = 'down';
    else if (cur.left || mx < -0.6) dir = 'left';
    else if (cur.right || mx > 0.6) dir = 'right';
    if (!dir) { this._navDir = ''; this._navT = 0; }
    else if (dir !== this._navDir) { this._navDir = dir; this._navT = 0.38; this._nav(dir); }
    else { this._navT -= dt; if (this._navT <= 0) { this._navT = 0.11; this._nav(dir); } }

    if (cur.ok && !pr.ok) this._activate();
    else if (cur.back && !pr.back) this._back();
    else if (cur.opt && !pr.opt) {
      if (scr.name === 'pause') this._resume();
      else if (scr.name === 'settings' || scr.name === 'controls' || scr.name === 'controller') this._back();
    }
  }

  _nav(dir) {
    const scr = this.screen; if (!scr) return;
    if (dir === 'up') this._focus(scr.index - 1);
    else if (dir === 'down') this._focus(scr.index + 1);
    else this._horiz(dir === 'left' ? -1 : 1);
  }

  // ------------------------------------------------------------------ character wheel
  /** Called every playing frame BEFORE gameplay. Returns true while the wheel is open (main slows time + eats sticks). */
  updateWheel(rawDt) {
    const g = this.game, inp = g.input;
    const want = g.state === 'playing' && !!g.player && !!inp?.down('wheel');
    if (want && !this._wheelOn) this._openWheel();
    if (!this._wheelOn) return false;
    if (!want) { this._closeWheel(true); return false; }

    // pick a direction: right stick > left stick > mouse movement
    let dx = 0, dy = 0, has = false;
    const rs = inp.rightStick;
    if (Math.hypot(rs.x, rs.y) > 0.45) { dx = rs.x; dy = rs.y; has = true; }
    else if (Math.hypot(inp.move.x, inp.move.y) > 0.5) { dx = inp.move.x; dy = -inp.move.y; has = true; }
    else {
      let mdx, mdy;
      if (inp.pointerLocked || inp.lockFailed) {
        mdx = -inp.look.x / (inp.mouseSensitivity || 0.0022);
        mdy = -inp.look.y / (inp.mouseSensitivity || 0.0022) * (inp.invertY ? -1 : 1);
      } else { mdx = this._mdx; mdy = this._mdy; }
      this._mdx = this._mdy = 0;
      const m = this._wm; m.x += mdx; m.y += mdy;
      const l = Math.hypot(m.x, m.y);
      if (l > 110) { m.x *= 110 / l; m.y *= 110 / l; }
      if (l > 36) { dx = m.x; dy = m.y; has = true; }
    }
    if (has) {
      const n = ORDER.length;
      let idx = Math.round(Math.atan2(dx, -dy) / (Math.PI * 2 / n));
      idx = ((idx % n) + n) % n;
      if (idx !== this._wsel) { this._wsel = idx; g.audio?.play('ui_move'); }
    }
    this._paintWheel();
    return true;
  }

  _openWheel() {
    this._wheelOn = true; this._wsel = null; this._wm.x = this._wm.y = 0; this._mdx = this._mdy = 0;
    this.$.wheel.classList.add('on');
    this.game.audio?.play('ui_select');
  }

  _closeWheel(apply) {
    if (!this._wheelOn) return;
    this._wheelOn = false;
    this.$.wheel.classList.remove('on');
    const g = this.game;
    if (apply && this._wsel !== null && g.state === 'playing') {
      const id = ORDER[this._wsel], h = g.heroes?.[id];
      if (id && g.player && id !== g.player.id) {
        if (h && h.hp > 0) g.switchHero?.(id);
        else { this.toast(`${HERO_INFO[id].name} is down`); g.audio?.play('ui_back'); }
      }
    }
    this._wsel = null;
  }

  _paintWheel() {
    const g = this.game, cur = g.player?.id;
    const focusId = this._wsel !== null ? ORDER[this._wsel] : cur;
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i], el = this.wheelEls[i], h = g.heroes?.[id];
      const down = !h || h.hp <= 0;
      el.classList.toggle('cur', id === cur);
      el.classList.toggle('sel', id === focusId);
      el.classList.toggle('down', down);
      el.lastChild.firstChild.style.width = `${h ? Math.max(0, h.hp / h.maxHp) * 100 : 0}%`;
    }
    const fh = g.heroes?.[focusId];
    const nm = fh?.name || HERO_INFO[focusId]?.name || '';
    if (this._sig.wn !== nm) { this._sig.wn = nm; this.$.whn.textContent = nm; this.$.wheel.style.setProperty('--wc', HERO_INFO[focusId]?.color || '#fff'); }
    const ht = fh ? (fh.hp <= 0 ? 'DOWN' : `${Math.ceil(fh.hp)} / ${fh.maxHp}`) : '';
    if (this._sig.wh !== ht) { this._sig.wh = ht; this.$.whh.textContent = ht; }
    this.$.whndl.style.opacity = this._wsel === null ? '0' : '1';
    if (this._wsel !== null) this.$.whndl.style.transform = `rotate(${this._wsel * (360 / ORDER.length)}deg)`;
    const e = this._wsel === null ? 'Aim with stick / mouse &middot; release to switch' : (focusId === cur ? 'Already playing this hero' : 'Release to switch');
    if (this._sig.we !== e) { this._sig.we = e; this.$.whe.innerHTML = e; }
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    const g = this.game, inp = g.input;
    this._pollPadMenu(dt);

    const playing = g.state === 'playing' || g.state === 'paused';
    this.$.game.classList.toggle('on', playing && !!g.player);
    if (this._wheelOn && g.state !== 'playing') this._closeWheel(false);

    const scr = this.screen;
    if (scr && scr.name === 'title') {
      this._padT -= dt;
      if (this._padT <= 0) { this._padT = 0.25; this._titleStatus(scr); }
    } else if (scr && scr.name === 'controller') this._tickController(scr, dt);

    if (!playing || !g.player) return;
    const p = g.player;
    const driving = g.vehicles?.driving || null;
    this.$.game.classList.toggle('drv', !!driving);

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
    if (full !== this._sig.full || this._sig.ultPad !== this._usePad()) {
      this._sig.full = full; this._sig.ultPad = this._usePad(); this.$.focus.classList.toggle('full', full);
      this.$.ult.innerHTML = `ULTIMATE READY &nbsp;${this._glyph('ultimate')}`;
    }

    // abilities (rebuild only when something changes); hidden while driving
    const pad = this._usePad();
    this.$.abil.classList.toggle('hidden', !!driving);
    const hints = p.abilityHints || [];
    const sig = pad + (this._xbox() ? 'x' : '') + hints.map((h) => h.action + h.label).join('|');
    if (sig !== this._sig.abil) {
      this._sig.abil = sig;
      this.$.abil.className = `abil${pad ? ' pad' : ''}${driving ? ' hidden' : ''}`;
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

    this._updateV2(g, p, dt, driving);

    // prompt timeout
    if (this._promptT > 0) { this._promptT -= dt; if (this._promptT <= 0) this.$.prompt.classList.remove('on'); }
    if (this._dhintT > 0) { this._dhintT -= dt; if (this._dhintT <= 0) this.$.dhint.classList.remove('on'); }

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
    if (this._mmT <= 0) { this._mmT = this._mapBig ? 0.12 : 0.06; this._drawMap(p, op, driving); }
  }

  /** v2 HUD pieces: cash, wanted, speedometer, weapon panel, crosshair, context prompts. All guarded against stub subsystems. */
  _updateV2(g, p, dt, driving) {
    // cash counter eases towards economy.cash
    const c = this._cash;
    const target = g.economy?.cash;
    if (typeof target === 'number') c.target = target;
    if (c.shown !== c.target) {
      const d = c.target - c.shown;
      c.shown = Math.abs(d) < 1 ? c.target : c.shown + d * Math.min(1, dt * 7);
      const n = Math.round(c.shown);
      if (n !== this._sig.cash) { this._sig.cash = n; this.$.cashn.textContent = n.toLocaleString('en-US'); }
    } else if (this._sig.cash === undefined) { this._sig.cash = c.shown; this.$.cashn.textContent = Math.round(c.shown).toLocaleString('en-US'); }

    // wanted stars (flash while police are near)
    const wanted = Math.max(0, Math.min(5, g.vehicles?.wanted | 0));
    this._policeT -= dt;
    if (this._policeT <= 0) {
      this._policeT = 0.3; let near = false;
      if (wanted > 0) {
        const list = g.vehicles?.list || [];
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          if (v?.kind === 'police' && v.pos && Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) < 70) { near = true; break; }
        }
        if (g.vehicles?.policeNear !== undefined) near = !!g.vehicles.policeNear;
      }
      this._nearPolice = near;
    }
    if (wanted !== this._sig.wanted) {
      if (wanted > (this._sig.wanted || 0)) g.audio?.play?.('wanted');
      this._sig.wanted = wanted;
      this.starEls.forEach((s, i) => s.classList.toggle('on', i < wanted));
    }
    this.$.wanted.classList.toggle('flash', wanted > 0 && this._nearPolice);
    this.$.wanted.classList.toggle('has', wanted > 0);

    // speedometer + car health
    this.$.speedo.classList.toggle('hidden', !driving);
    if (driving) {
      const kmh = Math.round(Math.abs(driving.speed || 0) * 3.6);
      if (kmh !== this._sig.kmh) { this._sig.kmh = kmh; this.$.spdn.textContent = kmh; this.$.spdarc.setAttribute('stroke-dasharray', `${Math.min(100, kmh / 2)} 100`); }
      const mh = driving.maxHp || driving.maxHP || 100;
      const hf = Math.max(0, Math.min(1, (driving.hp ?? mh) / mh));
      this.$.carhp.style.width = `${hf * 100}%`;
      this.$.carhp.classList.toggle('low', hf < 0.3);
      const nm = String(driving.kind || 'car').toUpperCase();
      if (nm !== this._sig.carn) { this._sig.carn = nm; this.$.carn.textContent = nm; }
    }

    // weapon panel
    const w = g.weapons?.equipped;
    this.$.wpn.classList.toggle('hidden', !w);
    if (w) {
      const wid = w.id ?? w.name;
      const st = g.weapons.owned?.get ? g.weapons.owned.get(wid) : null;
      const nm = String(w.name || w.id || '').toUpperCase();
      const clip = st?.clip, res = st?.ammo;
      const a = clip !== undefined ? `${clip}` : (res !== undefined ? (Number.isFinite(res) ? `${res}` : '∞') : '');
      const b = clip !== undefined && res !== undefined ? (Number.isFinite(res) ? ` / ${res}` : ' / ∞') : '';
      const key = `${nm}|${a}|${b}`;
      if (key !== this._sig.wpn) {
        this._sig.wpn = key; this.$.wpnn.textContent = nm; this.$.wpnc.textContent = a; this.$.wpnr.textContent = b;
        this.$.wpn.classList.toggle('empty', clip === 0 || (clip === undefined && res === 0));
      }
    }

    // crosshair: weapon-specific via setCrosshair(), otherwise the small default ring
    const xk = this._xk;
    const showX = g.state === 'playing' && !driving && p.id !== 'hulk' && !this._wheelOn;
    this.$.xhair.classList.toggle('on', showX);
    this.$.xhair.classList.toggle('aim', !!g.weapons?.aiming);
    this.$.scope.classList.toggle('on', xk === 'sniper' && showX);
    this.$.game.classList.toggle('scoped', xk === 'sniper' && showX && !!g.weapons?.aiming);

    // context prompt (enter / steal / exit car, shop)
    this._ctxT -= dt;
    if (this._ctxT <= 0) { this._ctxT = 0.1; this._context(g, p, driving); }
  }

  _context(g, p, driving) {
    let txt = '';
    if (g.state !== 'playing' || this._wheelOn) txt = '';
    else if (driving) txt = 'Exit';
    else {
      let car = null;
      try { car = g.vehicles?.nearestEnterable?.(p.pos, 4); } catch { car = null; }
      if (car) txt = (car.driver && car.driver !== 'player' && !car.owned) ? 'Steal car' : 'Enter car';
      else {
        const shops = g.weapons?.shops;
        if (shops?.length) {
          for (const s of shops) {
            const sp = s?.pos ?? s; if (!sp) continue;
            const sx = sp.x ?? sp[0], sz = sp.z ?? sp[2] ?? sp[1];
            if (Math.hypot(sx - p.pos.x, sz - p.pos.z) < 3) { txt = 'Shop'; break; }
          }
        }
      }
    }
    const pad = this._usePad();
    const sig = txt + pad + (this._xbox() ? 'x' : '');
    if (sig === this._sig.ctx) return;
    this._sig.ctx = sig;
    this.$.ctxp.classList.toggle('on', !!txt);
    if (txt) this.$.ctxp.innerHTML = `${this._glyph('interact', pad)}<span>${txt}</span>`;
  }

  _showDriveHint() {
    const pad = this._usePad();
    const items = [['throttle', 'Gas'], ['brake', 'Brake / reverse'], ['steer', 'Steer'], ['handbrake', 'Handbrake'], ['horn', 'Horn'], ['interact', 'Exit car']];
    this.$.dhint.innerHTML = `<b>DRIVING</b>` + items.map(([a, l]) => `<span>${this._glyph(a, pad)} ${l}</span>`).join('');
    this.$.dhint.classList.add('on');
    this._dhintT = 7;
  }

  _waypoint(op) {
    const g = this.game, cam = g.camera, wp = this.$.wp;
    if (!cam) return;
    const v = op.clone ? op.clone() : op;
    v.project(cam);
    const w = innerWidth, h = innerHeight;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (v.z > 1) { x = w - x; y = h - y; if (Math.abs(x - w / 2) < 1) x = w / 2; y = h - 60; }
    x = Math.max(50, Math.min(w - 50, x)); y = Math.max(60, Math.min(h - 120, y));
    wp.style.transform = `translate(${x}px, ${y}px)`;
    wp.classList.remove('hidden');
  }

  _drawMap(p, op, driving) {
    const g = this.game, ctx = this.mmCtx, c = this.$.mmc, W = c.width, big = this._mapBig, sc = W / 336;
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
    const inside = (x, y, m = 4) => big || Math.hypot(x - W / 2, y - W / 2) < W / 2 - m;
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
    // shops
    const shops = g.weapons?.shops;
    if (shops?.length) {
      ctx.font = `800 ${Math.round(11 * sc)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const s of shops) {
        const sp = s?.pos ?? s; if (!sp) continue;
        const sx = sp.x ?? sp[0], sz = sp.z ?? sp[2] ?? sp[1];
        const x = X(sx, sz), y = Y(sx, sz);
        if (!inside(x, y, 8)) continue;
        const r = 7 * sc;
        ctx.fillStyle = '#1d8f63'; ctx.strokeStyle = '#d6ffe9'; ctx.lineWidth = 1.5 * sc;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillText('$', x, y + 0.5);
      }
    }
    // police and other vehicle dots
    let dots = null;
    try { dots = g.vehicles?.mapDots?.(); } catch { dots = null; }
    if (dots?.length) {
      const flash = (performance.now() / 260 | 0) % 2;
      for (const q of dots) {
        const dp = q?.pos ?? q; if (!dp) continue;
        const dx = dp.x ?? dp[0], dz = dp.z ?? dp[2] ?? dp[1];
        const x = X(dx, dz), y = Y(dx, dz);
        if (!inside(x, y)) continue;
        const kind = q.kind ?? q.type ?? 'police';
        if (kind === 'police') ctx.fillStyle = flash ? '#3d7dff' : '#ff3b4e'; else ctx.fillStyle = q.color ?? '#c9d0e6';
        ctx.strokeStyle = '#000'; ctx.lineWidth = sc;
        ctx.beginPath(); ctx.arc(x, y, 4.5 * sc, 0, 6.283); ctx.fill(); ctx.stroke();
      }
    }
    // enemies
    const list = g.enemies?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; if (e.alive === false || !e.pos) continue;
      const x = X(e.pos.x, e.pos.z), y = Y(e.pos.x, e.pos.z);
      if (!big && Math.hypot(x - W / 2, y - W / 2) > W / 2 - 4) continue;
      ctx.fillStyle = e.isBoss ? '#b04bff' : '#ff3b4e';
      ctx.beginPath(); ctx.arc(x, y, (e.isBoss ? 7 : 4) * sc, 0, 6.283); ctx.fill();
    }
    // a parked car that belongs to the player
    const own = g.vehicles?.ownCar;
    if (own?.pos && !driving) {
      const x = X(own.pos.x, own.pos.z), y = Y(own.pos.x, own.pos.z);
      if (inside(x, y, 6)) { ctx.fillStyle = '#ffd23a'; ctx.fillRect(x - 5 * sc, y - 3.5 * sc, 10 * sc, 7 * sc); }
    }
    // objective
    if (op) {
      let x = X(op.x, op.z), y = Y(op.x, op.z);
      if (!big) { const dx = x - W / 2, dy = y - W / 2, l = Math.hypot(dx, dy), m = W / 2 - 12; if (l > m) { x = W / 2 + dx / l * m; y = W / 2 + dy / l * m; } }
      ctx.fillStyle = '#ffe58a'; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      const r = 6 * sc; ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
    }
    // player arrow (or the car you are driving)
    const yaw = driving ? (driving.yaw ?? p.yaw) : p.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const ang = Math.atan2(cc * fx + d * fz, a * fx + b * fz);
    const px = X(p.pos.x, p.pos.z), py = Y(p.pos.x, p.pos.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    if (driving) {
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.roundRect?.(-10 * sc, -6 * sc, 20 * sc, 12 * sc, 3 * sc); if (!ctx.roundRect) ctx.rect(-10 * sc, -6 * sc, 20 * sc, 12 * sc); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(14 * sc, 0); ctx.lineTo(7 * sc, 5 * sc); ctx.lineTo(7 * sc, -5 * sc); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(11 * sc, 0); ctx.lineTo(-8 * sc, 7 * sc); ctx.lineTo(-4 * sc, 0); ctx.lineTo(-8 * sc, -7 * sc); ctx.closePath(); ctx.stroke(); ctx.fill();
    }
    ctx.restore();
  }
}

// ---- crosshairs ------------------------------------------------------------------------------
const XS = (inner) => `<svg viewBox="-24 -24 48 48" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">${inner}</svg>`;
const XH = {
  pistol: XS('<circle r="1.4" fill="#fff" stroke="none"/><path d="M-13 0h-6M13 0h6M0 -13v-6M0 13v6"/>'),
  rifle: XS('<circle r="1.2" fill="#fff" stroke="none"/><path d="M-8 0h-12M8 0h12M0 8v12"/>'),
  shotgun: XS('<circle r="15"/><circle r="1.4" fill="#fff" stroke="none"/><path d="M0 -15v-4M0 15v4M-15 0h-4M15 0h4"/>'),
  sniper: XS('<circle r="1.2" fill="#f33" stroke="none"/>'),
  bow: XS('<circle r="12" stroke-dasharray="3 5"/><circle r="1.4" fill="#fff" stroke="none"/><path d="M0 -12v-7M0 12v7M-12 0h-7M12 0h7"/>'),
};

// ---- DualShock 4 diagram (Controls v2) --------------------------------------------------------
function ds4Svg() {
  const L = (x1, y1, x2, y2) => `<line class="ln" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const labelsL = [
    ['L2 · Ability 2 / Aim / Brake', 58, 222, 76], ['L1 · Ability', 86, 220, 96], ['D-pad ↑ · Hero wheel (hold)', 114, 240, 144],
    ['D-pad ◀ ▶ · Quick switch', 142, 224, 160], ['D-pad ↓ · Next weapon', 170, 240, 176],
    ['Left stick · Move / Steer', 214, 285, 210], ['L3 (click) · Sprint / Horn', 244, 292, 214],
  ];
  const labelsR = [
    ['R2 · Swing / Fly / Fire / Gas', 58, 478, 76], ['R1 · Special', 86, 480, 96], ['△ · Interact (car, shop)', 114, 460, 130],
    ['○ · Dodge', 142, 490, 160], ['✕ · Jump / Handbrake', 170, 462, 190], ['□ · Attack', 198, 434, 162],
    ['Right stick · Camera', 226, 410, 210], ['R3 (click) · ULTIMATE', 254, 402, 214],
  ];
  let t = '';
  for (const [s, y, tx, ty] of labelsL) t += `<text x="6" y="${y}">${s}</text>${L(214, y - 4, tx, ty)}`;
  for (const [s, y, tx, ty] of labelsR) t += `<text x="694" y="${y}" text-anchor="end">${s}</text>${L(486, y - 4, tx, ty)}`;
  t += `<text x="260" y="22" text-anchor="end">Touchpad / Share · Map</text>${L(266, 20, 330, 110)}<text x="440" y="22">Options · Pause</text>${L(436, 20, 438, 116)}`;
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
    <circle cx="395" cy="208" r="25" fill="#10132a" stroke="#ffe58a" stroke-width="2"/><circle cx="395" cy="208" r="13" fill="#39427a"/>
    <circle cx="350" cy="186" r="7" fill="#39427a" stroke="#9aa6e6"/>
    ${t}</svg>`;
}
