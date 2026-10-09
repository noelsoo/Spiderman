// Unified input: keyboard + mouse (pointer lock) + gamepad (PS4 DualShock 4 / PS5 DualSense / Xbox / generic).
// Gameplay code only talks in actions, never raw keys or buttons.
//
// Every raw pad is translated to a virtual W3C "standard" pad first (see PROFILES), so bindings are written once.
// Standard indices: 0 ✕  1 ○  2 □  3 △  4 L1  5 R1  6 L2  7 R2  8 Share  9 Options  10 L3  11 R3
//                   12 D-up 13 D-down 14 D-left 15 D-right 16 PS 17 Touchpad;  axes 0 LX 1 LY 2 RX 3 RY
//
// Several actions can share one physical input (RMB is both `special` and `aim`). A system that owns the input
// this frame calls input.consume('aim'): every action fed by the same physical source is released for the rest
// of the frame. Example: the weapons system consumes `aim`/`fire` while a gun is out, so heroes don't also punch.
import * as THREE from 'three';

// action -> { k: KeyboardEvent.code[], m: mouse buttons[], p: standard pad buttons[], w: wheel direction }
export const BINDINGS = {
  jump:       { k: ['Space'],                  p: [0] },
  dodge:      { k: ['KeyC', 'ControlLeft'],    p: [1] },
  attack:     { k: ['KeyJ'], m: [0],           p: [2] },
  interact:   { k: ['KeyF'],                   p: [3] },          // enter/steal/exit car, shop, pick up
  ability:    { k: ['KeyE'],                   p: [4] },
  special:    { k: ['KeyK'], m: [2],           p: [5] },
  ability2:   { k: ['KeyR'],                   p: [6] },
  swing:      { k: ['ShiftLeft', 'ShiftRight'], p: [7] },
  ultimate:   { k: ['KeyQ'],                   p: [11] },         // R3 (right stick click)
  sprint:     { k: ['AltLeft'],                p: [10] },
  recenter:   { k: ['KeyV'], m: [1] },
  pause:      { k: ['Escape', 'KeyP'],         p: [9] },
  map:        { k: ['KeyM'],                   p: [17, 8] },      // touchpad or Share
  wheel:      { k: ['Tab'],                    p: [12] },         // hold: character wheel
  heroNext:   { k: ['BracketRight'],           p: [15] },
  heroPrev:   { k: ['BracketLeft'],            p: [14] },
  weaponNext: { k: ['KeyX'], w: 1,             p: [13] },
  weaponPrev: { k: ['KeyZ'], w: -1 },
  // weapons (only meaningful while a gun is equipped; the weapons system consumes them)
  aim:        { m: [2],                        p: [6] },
  fire:       { m: [0],                        p: [7] },
  reload:     { k: ['KeyR'] },
  // driving (read as analog values by the vehicle system)
  throttle:   { k: ['KeyW', 'ArrowUp'],        p: [7] },
  brake:      { k: ['KeyS', 'ArrowDown'],      p: [6] },
  handbrake:  { k: ['Space'],                  p: [0] },
  horn:       { k: ['KeyH'],                   p: [10] },
  hero1: { k: ['Digit1'] }, hero2: { k: ['Digit2'] }, hero3: { k: ['Digit3'] }, hero4: { k: ['Digit4'] },
  hero5: { k: ['Digit5'] }, hero6: { k: ['Digit6'] }, hero7: { k: ['Digit7'] }, hero8: { k: ['Digit8'] },
};
export const ACTIONS = Object.keys(BINDINGS);

// Raw-layout -> standard translation tables. b[std] = raw button index (or ['axis', i] for analog triggers),
// a[std] = raw axis index, hat = raw axis index of a POV hat used for the D-pad.
const PROFILES = {
  standard: null,
  // Firefox on Linux (evdev, hid-sony / hid-playstation driver)
  ds4_linux: {
    b: { 0: 0, 1: 1, 2: 3, 3: 2, 4: 4, 5: 5, 6: ['axis', 2], 7: ['axis', 5], 8: 8, 9: 9, 10: 11, 11: 12, 16: 10 },
    a: { 0: 0, 1: 1, 2: 3, 3: 4 }, dpadAxes: [6, 7],
  },
  // Firefox on Windows / macOS (DirectInput / IOHID raw report order)
  ds4_dinput: {
    b: { 0: 1, 1: 2, 2: 0, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 16: 12, 17: 13 },
    a: { 0: 0, 1: 1, 2: 2, 3: 5 }, hat: 9,
  },
  // Unknown non-standard pad: assume Xbox-like order (most generic HID pads)
  generic: {
    b: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11 },
    a: { 0: 0, 1: 1, 2: 2, 3: 3 }, hat: 9,
  },
};

// Devices some OSes expose alongside the real controller; never pick them.
const NOT_A_PAD = /motion|sensor|accel|gyro|touchpad|keyboard|mouse|consumer control|system control/i;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheelAcc = 0; this._wheelPulse = 0;
    this.move = new THREE.Vector2();   // x = strafe right, y = forward
    this.look = new THREE.Vector2();   // radians this frame (x = yaw, y = pitch)
    this.rightStick = new THREE.Vector2(); // raw right stick (-1..1), for wheel selection
    this.state = {}; this.prev = {}; this.values = {}; this.sources = {};
    for (const a of ACTIONS) { this.state[a] = false; this.prev[a] = false; this.values[a] = 0; this.sources[a] = []; }
    this.consumed = new Set();
    this.mouseSensitivity = 0.0022;
    this.stickSensitivity = 3.2; // rad/s at full deflection
    this.invertY = false;
    this.deadzone = 0.15;
    this.pad = null; this.padIndex = -1;
    this.gamepadName = ''; this.padProfile = 'none';
    this.padRemap = {};              // { stdIndex: rawIndex } user overrides from the controller settings screen
    this.vb = new Float32Array(18);  // virtual standard buttons this frame
    this.va = new Float32Array(4);   // virtual standard axes this frame
    this.lastRawButton = -1;         // last raw button index that went down (for the remap UI)
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this.lockFailed = false;
    this.listeners = { gamepadconnected: [], gamepaddisconnected: [], pointerlock: [] };
    this._rawPrev = new Map();       // pad index -> previous raw button states

    addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'AltLeft', 'ControlLeft', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.lastDevice = 'keyboard';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button); this.lastDevice = 'keyboard';
      if (!this.pointerLocked) this.requestPointerLock();
    });
    addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      // If pointer lock was refused (some embedded frames), still steer the camera with raw mouse movement.
      if (!this.pointerLocked && !this.lockFailed) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    addEventListener('wheel', (e) => { this.wheelAcc += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      this.listeners.pointerlock.forEach((f) => f(this.pointerLocked));
    });
    addEventListener('gamepadconnected', (e) => {
      if (!this._usable(e.gamepad)) return;
      if (this.padIndex < 0) this._select(e.gamepad);
      this.lastDevice = 'gamepad';
      this.listeners.gamepadconnected.forEach((f) => f(e.gamepad));
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) { this.padIndex = -1; this.pad = null; this.gamepadName = ''; this.padProfile = 'none'; }
      this._rawPrev.delete(e.gamepad.index);
      this.listeners.gamepaddisconnected.forEach((f) => f(e.gamepad));
    });
  }

  on(evt, fn) { this.listeners[evt]?.push(fn); }

  get pointerLocked() { return document.pointerLockElement === this.canvas; }
  requestPointerLock() {
    try {
      if (!this.canvas.requestPointerLock) { this.lockFailed = true; return; }
      this.canvas.requestPointerLock()?.catch?.(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }
  exitPointerLock() { if (this.pointerLocked) document.exitPointerLock(); }

  _dz(v) { const a = Math.abs(v); return a < this.deadzone ? 0 : Math.sign(v) * (a - this.deadzone) / (1 - this.deadzone); }

  _usable(p) { return p && p.connected !== false && p.buttons && p.buttons.length >= 4 && !NOT_A_PAD.test(p.id || ''); }

  _profileFor(p) {
    if (p.mapping === 'standard') return 'standard';
    const sony = /054c|sony|playstation|dualshock|dualsense|wireless controller/i.test(p.id);
    if (sony) return p.axes.length >= 8 && p.buttons.length <= 13 ? 'ds4_linux' : 'ds4_dinput';
    return 'generic';
  }

  _select(p) {
    this.padIndex = p.index; this.pad = p; this.gamepadName = p.id; this.padProfile = this._profileFor(p);
  }

  /** All pads the browser reports, for the controller diagnostics screen. */
  padInfo() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    return pads.filter(Boolean).map((p) => ({
      index: p.index, id: p.id, mapping: p.mapping || '(none)', usable: this._usable(p), active: p.index === this.padIndex,
      profile: this._profileFor(p), buttons: p.buttons.map((b) => +(b.value || (b.pressed ? 1 : 0)).toFixed(2)),
      axes: p.axes.map((v) => +v.toFixed(2)), rumble: !!p.vibrationActuator,
    }));
  }

  _pollPad() {
    let pads = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch { pads = []; }
    // Switch to whichever usable pad had a button go down this frame (handles phantom/duplicate devices).
    for (const p of pads) {
      if (!this._usable(p)) continue;
      const prev = this._rawPrev.get(p.index) || [];
      const now = p.buttons.map((b) => b.pressed || b.value > 0.5);
      for (let i = 0; i < now.length; i++) if (now[i] && !prev[i]) {
        if (p.index !== this.padIndex) this._select(p);
        if (p.index === this.padIndex) this.lastRawButton = i;
      }
      this._rawPrev.set(p.index, now);
    }
    let pad = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!this._usable(pad)) {
      pad = null; this.padIndex = -1;
      // prefer a standard-mapped pad, then any usable one
      const cands = pads.filter((p) => this._usable(p));
      const best = cands.find((p) => p.mapping === 'standard') || cands[0];
      if (best) { this._select(best); pad = best; }
    }
    this.pad = pad;
    return pad;
  }

  /** Translate the raw pad into this.vb / this.va (virtual standard layout). */
  _translate(pad) {
    this.vb.fill(0); this.va.fill(0);
    const raw = (i) => { const b = pad.buttons[i]; return b ? (b.value || (b.pressed ? 1 : 0)) : 0; };
    const prof = PROFILES[this.padProfile];
    if (!prof) {
      for (let i = 0; i < 18; i++) this.vb[i] = raw(i);
      for (let i = 0; i < 4; i++) this.va[i] = pad.axes[i] || 0;
    } else {
      for (const [std, src] of Object.entries(prof.b)) {
        this.vb[std] = Array.isArray(src) ? Math.max(0, ((pad.axes[src[1]] ?? -1) + 1) / 2) : raw(src);
      }
      for (const [std, src] of Object.entries(prof.a)) this.va[std] = pad.axes[src] || 0;
      if (prof.dpadAxes) {
        const dx = pad.axes[prof.dpadAxes[0]] || 0, dy = pad.axes[prof.dpadAxes[1]] || 0;
        this.vb[12] = dy < -0.5 ? 1 : 0; this.vb[13] = dy > 0.5 ? 1 : 0; this.vb[14] = dx < -0.5 ? 1 : 0; this.vb[15] = dx > 0.5 ? 1 : 0;
      } else if (prof.hat !== undefined && pad.axes.length > prof.hat) {
        // POV hat: -1 up, then clockwise in steps of 2/7; > 1 means centred
        const h = pad.axes[prof.hat];
        if (h >= -1.05 && h <= 1.05) {
          const dir = Math.round((h + 1) / (2 / 7)) % 8; // 0 up,1 up-right,2 right,...
          this.vb[12] = [7, 0, 1].includes(dir) ? 1 : 0; this.vb[15] = [1, 2, 3].includes(dir) ? 1 : 0;
          this.vb[13] = [3, 4, 5].includes(dir) ? 1 : 0; this.vb[14] = [5, 6, 7].includes(dir) ? 1 : 0;
        }
      }
      // Some raw drivers report triggers as both a button and an axis; take whichever is larger.
      if (!Array.isArray(prof.b[6])) this.vb[6] = Math.max(this.vb[6], raw(prof.b[6]));
    }
    for (const [std, rawIdx] of Object.entries(this.padRemap)) this.vb[std] = raw(rawIdx);
  }

  /** Call once per frame before gameplay update. */
  update(dt) {
    for (const a of ACTIONS) { this.prev[a] = this.state[a]; this.sources[a].length = 0; }
    this.consumed.clear();
    this.move.set(0, 0); this.look.set(0, 0); this.rightStick.set(0, 0);
    const wheel = this.wheelAcc; this.wheelAcc = 0;
    if (!this.enabled) { this.mouseDX = this.mouseDY = 0; this._recompute(); return; }

    // keyboard + mouse sources
    for (const a of ACTIONS) {
      const bnd = BINDINGS[a];
      if (bnd.k) for (const k of bnd.k) if (this.keys.has(k)) this.sources[a].push(['k:' + k, 1]);
      if (bnd.m) for (const b of bnd.m) if (this.mouseButtons.has(b)) this.sources[a].push(['m:' + b, 1]);
      if (bnd.w && wheel && Math.sign(wheel) === bnd.w) this.sources[a].push(['w:' + bnd.w, 1]);
    }
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.move.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.move.y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.move.x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.move.x -= 1;
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.look.x = -this.mouseDX * this.mouseSensitivity;
    this.look.y = -this.mouseDY * this.mouseSensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = this.mouseDY = 0;

    // gamepad sources
    const pad = this._pollPad();
    if (pad) {
      this._translate(pad);
      let used = false;
      for (const a of ACTIONS) {
        const p = BINDINGS[a].p;
        if (!p) continue;
        for (const i of p) { const v = this.vb[i]; if (v > 0.25) { this.sources[a].push(['p:' + i, v]); used = true; } }
      }
      const lx = this._dz(this.va[0]), ly = this._dz(this.va[1]);
      const rx = this._dz(this.va[2]), ry = this._dz(this.va[3]);
      if (lx || ly) { this.move.set(lx, -ly); used = true; if (this.move.lengthSq() > 1) this.move.normalize(); }
      if (rx || ry) {
        this.rightStick.set(rx, ry);
        const cx = Math.sign(rx) * rx * rx, cy = Math.sign(ry) * ry * ry; // gentle curve for precise aim
        this.look.x += -cx * this.stickSensitivity * dt;
        this.look.y += -cy * this.stickSensitivity * dt * 0.75 * (this.invertY ? -1 : 1);
        used = true;
      }
      if (used) this.lastDevice = 'gamepad';
    }
    this._recompute();
  }

  _recompute() {
    for (const a of ACTIONS) {
      let v = 0;
      for (const [src, val] of this.sources[a]) if (!this.consumed.has(src) && val > v) v = val;
      this.values[a] = v; this.state[a] = v > 0.25;
    }
  }

  /** Claim an action's physical inputs for the rest of this frame (releases every action sharing them). */
  consume(...actions) {
    for (const a of actions) for (const [src] of this.sources[a] || []) this.consumed.add(src);
    this._recompute();
  }
  /** Claim movement / camera so nothing else reads them this frame (e.g. while the character wheel is open). */
  consumeSticks() { this.move.set(0, 0); this.look.set(0, 0); }

  down(a) { return this.state[a]; }
  pressed(a) { return this.state[a] && !this.prev[a]; }
  released(a) { return !this.state[a] && this.prev[a]; }
  value(a) { return this.values[a]; }

  /** Is a virtual standard pad button held (for menus)? */
  padButton(i) { return this.vb[i] > 0.5; }

  /** Controller rumble. strong/weak 0..1. Works on DS4/DualSense/Xbox in Chromium browsers. */
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const pad = this.pad;
    try {
      const act = pad?.vibrationActuator;
      if (act?.playEffect) act.playEffect(act.type || 'dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {});
      else pad?.hapticActuators?.[0]?.pulse?.(Math.min(1, Math.max(strong, weak)), ms);
    } catch { /* not supported */ }
  }

  /** Is the connected controller a PlayStation pad? Used by the HUD to show ✕ ○ □ △ glyphs. */
  get isPlayStation() { return /054c|sony|dualshock|dualsense|wireless controller|playstation/i.test(this.gamepadName); }
}
