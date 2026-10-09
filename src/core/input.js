// Unified input: keyboard + mouse (pointer lock) + gamepad (PS4 DualShock 4 / PS5 DualSense / Xbox).
// Gameplay code only talks in actions, never raw keys or buttons.
//
// Actions:
//   jump      Space        / Cross (✕)
//   swing     Shift (hold) / R2  (analog, hold)   - web-swing, Iron Man / Thor flight boost
//   attack    LMB, J       / Square (□)
//   special   RMB, K       / R1                  - web shot, repulsor, hammer throw, Hulk clap
//   ability   E            / L1                  - web-zip / dash / gadget
//   ability2  R            / L2                  - Symbiote suit, unibeam charge, rage, lightning
//   ultimate  F            / Triangle (△)        - needs a full Focus meter
//   dodge     C, Ctrl      / Circle (○)
//   sprint    Left Alt     / L3
//   recenter  Middle mouse, V / R3
//   heroNext  Tab, ]       / D-pad right
//   heroPrev  [            / D-pad left
//   hero1..4  1..4         / -
//   pause     Esc, P       / Options
//   map       M            / Touchpad
import * as THREE from 'three';

const KEY_BINDS = {
  jump: ['Space'],
  swing: ['ShiftLeft', 'ShiftRight'],
  attack: ['KeyJ'],
  special: ['KeyK'],
  ability: ['KeyE'],
  ability2: ['KeyR'],
  ultimate: ['KeyF'],
  dodge: ['KeyC', 'ControlLeft'],
  sprint: ['AltLeft'],
  recenter: ['KeyV'],
  heroNext: ['Tab', 'BracketRight'],
  heroPrev: ['BracketLeft'],
  hero1: ['Digit1'], hero2: ['Digit2'], hero3: ['Digit3'], hero4: ['Digit4'],
  pause: ['Escape', 'KeyP'],
  map: ['KeyM'],
};
const MOUSE_BINDS = { attack: [0], recenter: [1], special: [2] };

// W3C "standard" gamepad layout (Chrome/Edge/Safari map the DS4 to this natively).
const PAD_STANDARD = {
  jump: [0], dodge: [1], attack: [2], ultimate: [3],
  ability: [4], special: [5], ability2: [6], swing: [7],
  pause: [9], sprint: [10], recenter: [11],
  heroPrev: [14], heroNext: [15], map: [17],
};
// Raw DirectInput DS4 layout (Firefox on Windows/Linux without remapping).
const PAD_DS4_RAW = {
  jump: [1], dodge: [2], attack: [0], ultimate: [3],
  ability: [4], special: [5], ability2: [6], swing: [7],
  pause: [9], sprint: [10], recenter: [11], map: [13],
};

export const ACTIONS = Object.keys(KEY_BINDS);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheel = 0;
    this.move = new THREE.Vector2();   // x = strafe right, y = forward
    this.look = new THREE.Vector2();   // radians this frame (x = yaw, y = pitch)
    this.state = {}; this.prev = {}; this.values = {};
    for (const a of ACTIONS) { this.state[a] = false; this.prev[a] = false; this.values[a] = 0; }
    this.mouseSensitivity = 0.0022;
    this.stickSensitivity = 3.2; // rad/s at full deflection
    this.invertY = false;
    this.deadzone = 0.15;
    this.pad = null; this.padIndex = -1;
    this.gamepadName = '';
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this.listeners = { gamepadconnected: [], gamepaddisconnected: [], pointerlock: [] };
    this._padPrevDpad = 0;

    addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'AltLeft', 'ControlLeft'].includes(e.code)) e.preventDefault();
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
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.listeners.pointerlock.forEach((f) => f(this.pointerLocked));
    });
    addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index; this.gamepadName = e.gamepad.id; this.lastDevice = 'gamepad';
      this.listeners.gamepadconnected.forEach((f) => f(e.gamepad));
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) { this.padIndex = -1; this.pad = null; this.gamepadName = ''; }
      this.listeners.gamepaddisconnected.forEach((f) => f(e.gamepad));
    });
  }

  on(evt, fn) { this.listeners[evt]?.push(fn); }

  get pointerLocked() { return document.pointerLockElement === this.canvas; }
  requestPointerLock() { try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ignore */ } }
  exitPointerLock() { if (this.pointerLocked) document.exitPointerLock(); }

  _dz(v) { const a = Math.abs(v); return a < this.deadzone ? 0 : Math.sign(v) * (a - this.deadzone) / (1 - this.deadzone); }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!pad) {
      for (const p of pads) if (p && p.connected) { pad = p; this.padIndex = p.index; this.gamepadName = p.id; break; }
    }
    this.pad = pad || null;
    return this.pad;
  }

  /** Call once per frame before gameplay update. */
  update(dt) {
    for (const a of ACTIONS) { this.prev[a] = this.state[a]; this.state[a] = false; this.values[a] = 0; }
    this.move.set(0, 0); this.look.set(0, 0);
    if (!this.enabled) { this.mouseDX = this.mouseDY = 0; this.wheel = 0; return; }

    // keyboard + mouse
    for (const a of ACTIONS) {
      if (KEY_BINDS[a].some((k) => this.keys.has(k))) { this.state[a] = true; this.values[a] = 1; }
      if (MOUSE_BINDS[a]?.some((b) => this.mouseButtons.has(b))) { this.state[a] = true; this.values[a] = 1; }
    }
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.move.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.move.y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.move.x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.move.x -= 1;
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.look.x = -this.mouseDX * this.mouseSensitivity;
    this.look.y = -this.mouseDY * this.mouseSensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = this.mouseDY = 0;

    // gamepad
    const pad = this._pollPad();
    if (pad) {
      const std = pad.mapping === 'standard';
      const map = std ? PAD_STANDARD : PAD_DS4_RAW;
      const btn = (i) => pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0;
      let used = false;
      for (const a of ACTIONS) {
        const idx = map[a];
        if (!idx) continue;
        for (const i of idx) {
          const v = btn(i);
          if (v > 0.25) { this.state[a] = true; used = true; }
          this.values[a] = Math.max(this.values[a], v);
        }
      }
      // D-pad on raw DS4 arrives as a hat axis (index 9): -1 up ... clockwise
      if (!std && pad.axes.length > 9) {
        const hat = pad.axes[9];
        const right = Math.abs(hat - (-0.43)) < 0.1, left = Math.abs(hat - 0.71) < 0.1;
        if (right) { this.state.heroNext = true; used = true; }
        if (left) { this.state.heroPrev = true; used = true; }
      }
      const lx = this._dz(pad.axes[0] || 0), ly = this._dz(pad.axes[1] || 0);
      const rx = this._dz(pad.axes[std ? 2 : 2] || 0), ry = this._dz(pad.axes[std ? 3 : 5] || 0);
      if (lx || ly) { this.move.set(lx, -ly); used = true; if (this.move.lengthSq() > 1) this.move.normalize(); }
      if (rx || ry) {
        // gentle response curve for precise aiming
        const cx = Math.sign(rx) * rx * rx, cy = Math.sign(ry) * ry * ry;
        this.look.x += -cx * this.stickSensitivity * dt;
        this.look.y += -cy * this.stickSensitivity * dt * 0.75 * (this.invertY ? -1 : 1);
        used = true;
      }
      if (used) this.lastDevice = 'gamepad';
    }
    this.wheel = 0;
  }

  down(a) { return this.state[a]; }
  pressed(a) { return this.state[a] && !this.prev[a]; }
  released(a) { return !this.state[a] && this.prev[a]; }
  value(a) { return this.values[a]; }

  /** Controller rumble. strong/weak 0..1. Works on DS4/DualSense/Xbox in Chromium browsers. */
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const act = this.pad?.vibrationActuator;
    if (!act) return;
    try {
      act.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {});
    } catch { /* not supported */ }
  }

  /** Is the connected controller a PlayStation pad? Used by the HUD to show ✕ ○ □ △ glyphs. */
  get isPlayStation() { return /054c|dualshock|dualsense|wireless controller|playstation/i.test(this.gamepadName); }
}
