// Procedural WebAudio engine: every sound effect and every music track is synthesised at runtime
// (no audio files). Contract: see docs/ARCHITECTURE.md#audio
//
//   unlock()                         resume the AudioContext (call from a user gesture)
//   play(name, { volume, pitch, pos })   one-shot SFX, optional 3D attenuation/pan relative to game.camera
//   music('roam'|'combat'|'boss'|'victory'|null)   crossfade to a track
//   duck(bool)                       lower the music (pause menu)
//   update(dt)                       music scheduler + automatic roam <-> combat switching
//
// Everything is wrapped so that a missing / locked AudioContext never throws.

const MIDI = (n) => 440 * Math.pow(2, (n - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);

// ---- music definitions (A minor) ------------------------------------------------------------
const X = 1;
const TRACKS = {
  roam: {
    bpm: 84, swing: 0.16, loop: true, padGain: 0.075, bassWave: 'sine', bassGain: 0.30,
    chords: [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [60, 64, 67, 71, 74], [55, 59, 62, 65, 69]], // Am9 Fmaj9 Cmaj9 G6/9-ish
    roots: [33, 29, 36, 31],
    kick:  [X,0,0,0, 0,0,0,0, 0,0,X,0, 0,0,0,0],
    snare: [0,0,0,0, X,0,0,0, 0,0,0,0, X,0,0,X*0],
    hat:   [X,0,X,0, X,0,X,0, X,0,X,0, X,0,X,X],
    bassPat: [X,0,0,0, 0,0,X,0, 0,0,X,0, 0,0,0,0],
    lead: 0.28, leadScale: [69, 72, 74, 76, 79, 81], arp: false,
    drumGain: 0.8,
  },
  combat: {
    bpm: 108, swing: 0.05, loop: true, padGain: 0.06, bassWave: 'sawtooth', bassGain: 0.17,
    chords: [[57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67], [52, 56, 59, 64]],
    roots: [33, 29, 31, 28],
    kick:  [X,0,0,0, X,0,0,X, 0,0,X,0, X,0,0,0],
    snare: [0,0,0,0, X,0,0,0, 0,0,0,0, X,0,0,X],
    hat:   [X,X,X,X, X,X,X,X, X,X,X,X, X,X,X,X],
    bassPat: [X,0,X,0, X,0,X,X, X,0,X,0, X,0,X,0],
    lead: 0, arp: true, arpOct: 0, drumGain: 1,
  },
  boss: {
    bpm: 136, swing: 0, loop: true, padGain: 0.07, bassWave: 'sawtooth', bassGain: 0.22, dark: true,
    chords: [[45, 57, 60, 64, 70], [45, 57, 60, 63, 69], [41, 53, 57, 60, 66], [44, 56, 59, 63, 68]],
    roots: [33, 33, 29, 32],
    kick:  [X,0,X,0, X,0,X,0, X,0,X,X, X,0,X,0],
    snare: [0,0,0,0, X,0,0,0, 0,0,0,X, X,0,0,0],
    hat:   [X,X,X,X, X,X,X,X, X,X,X,X, X,X,X,X],
    bassPat: [X,X,0,X, X,X,0,X, X,X,0,X, X,0,X,X],
    lead: 0, arp: true, arpOct: 12, drumGain: 1.15,
  },
  victory: { bpm: 100, loop: false, sting: true },
};

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ok = false;
    this.unlocked = false;
    this.wanted = null;        // track requested before the context was running
    this.track = null;         // current track name
    this._ducked = false;
    this._lastPlay = {};
    this._autoT = 0;
    this._combatHold = 0;
    this._manual = false;      // boss / victory forced by the game
    this._step = 0; this._next = 0;
    this._trackGain = null;
    this._init();
  }

  _init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(comp); comp.connect(ctx.destination);
      // 2s of white noise reused by every noise voice
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.ok = true;
      this._applyVolumes(true);
    } catch { this.ok = false; }
  }

  get running() { return this.ok && this.ctx.state === 'running'; }

  unlock() {
    if (!this.ok) return;
    try {
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        p?.then?.(() => this._onRunning()).catch?.(() => {});
      } else this._onRunning();
    } catch { /* ignore */ }
  }

  _onRunning() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.wanted !== undefined && this.wanted !== null && !this.track) this.music(this.wanted);
  }

  _applyVolumes(immediate = false) {
    if (!this.ok) return;
    const s = this.game.settings || {};
    const vol = s.volume ?? 0.8, mus = s.music ?? 0.5;
    const t = this.ctx.currentTime;
    const m = vol, mb = mus * 0.9 * (this._ducked ? 0.3 : 1);
    if (immediate) { this.master.gain.value = m; this.musicBus.gain.value = mb; this.sfxBus.gain.value = 0.9; }
    else {
      this.master.gain.setTargetAtTime(m, t, 0.05);
      this.musicBus.gain.setTargetAtTime(mb, t, 0.15);
    }
  }

  duck(on) { this._ducked = !!on; this._applyVolumes(); }

  // ---- SFX ----------------------------------------------------------------------------------
  play(name, opts = {}) {
    if (!this.running) return;
    const rec = SFX[name];
    if (!rec) return;
    try {
      const ctx = this.ctx, now = ctx.currentTime;
      if (now - (this._lastPlay[name] || 0) < 0.03) return; // anti-spam
      this._lastPlay[name] = now;
      let vol = opts.volume ?? 1;
      let pan = 0;
      if (opts.pos && this.game.camera) {
        const cam = this.game.camera;
        const p = opts.pos.clone();
        const dist = cam.position.distanceTo(p);
        if (dist > 160) return;
        vol *= 1 / (1 + dist / 14);
        if (dist > 0.5) { cam.worldToLocal(p); pan = Math.max(-1, Math.min(1, p.x / Math.max(3, dist))); }
        if (vol < 0.01) return;
      }
      const out = ctx.createGain();
      out.gain.value = vol;
      let tail = out;
      if (ctx.createStereoPanner && pan !== 0) { const sp = ctx.createStereoPanner(); sp.pan.value = pan; out.connect(sp); tail = sp; }
      tail.connect(this.sfxBus);
      const v = { ctx, out, t: now + 0.001, pitch: opts.pitch ?? 1, noise: this.noiseBuf, dest: out };
      rec(v);
      // free the gain node after the longest sound (3 s) has surely ended
      setTimeout(() => { try { out.disconnect(); tail.disconnect?.(); } catch { /* ignore */ } }, 3500);
    } catch { /* never throw from audio */ }
  }

  // ---- music --------------------------------------------------------------------------------
  music(track) {
    this.wanted = track;
    if (!this.ok) return;
    if (track === 'boss' || track === 'victory') this._manual = true;
    else this._manual = false;
    if (!this.running) { this.unlock(); if (!this.running) return; }
    if (track === this.track) return;
    try {
      const ctx = this.ctx, t = ctx.currentTime;
      const old = this._trackGain;
      if (old) {
        old.gain.cancelScheduledValues(t);
        old.gain.setValueAtTime(old.gain.value, t);
        old.gain.linearRampToValueAtTime(0, t + 1.6);
        setTimeout(() => { try { old.disconnect(); } catch { /* ignore */ } }, 2200);
      }
      this.track = track;
      this._trackGain = null;
      if (!track || !TRACKS[track]) return;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + (track === 'victory' ? 0.05 : 1.4));
      g.connect(this.musicBus);
      this._trackGain = g;
      this._step = 0; this._bar = 0;
      this._next = t + 0.08;
      this._stingDone = false;
    } catch { /* ignore */ }
  }

  update(dt) {
    if (!this.ok) return;
    try {
      this._applyVolumeTimer = (this._applyVolumeTimer || 0) + dt;
      if (this._applyVolumeTimer > 0.25) { this._applyVolumeTimer = 0; this._applyVolumes(); }
      if (!this.running) return;
      const g = this.game;
      // auto switching between roam and combat (and boss when a boss is nearby)
      if (g.state === 'playing' && g.player && !(this._manual && this.track === 'victory')) {
        this._autoT -= dt; this._combatHold -= dt;
        if (this._autoT <= 0) {
          this._autoT = 0.5;
          let near = false, boss = false;
          const list = g.enemies?.list || [];
          const pp = g.player.pos;
          for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (!e.alive && e.alive !== undefined) continue;
            const d = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
            if (e.isBoss && d < 140) boss = true;
            if (d < 40) near = true;
          }
          if (near) this._combatHold = 4;
          if (boss) { if (this.track !== 'boss') { this.music('boss'); this._manual = false; } }
          else if (!(this._manual && this.track === 'boss')) {
            const want = this._combatHold > 0 ? 'combat' : 'roam';
            if (this.track !== want && this.track !== 'victory') { this.music(want); this._manual = false; }
            else if (this.track === 'boss') { this.music(want); this._manual = false; }
          }
        }
      }
      this._schedule();
    } catch { /* ignore */ }
  }

  _schedule() {
    const def = TRACKS[this.track];
    if (!def || !this._trackGain) return;
    const ctx = this.ctx;
    if (this._next < ctx.currentTime - 0.5) this._next = ctx.currentTime + 0.05; // tab was hidden
    const stepDur = 60 / def.bpm / 4;
    while (this._next < ctx.currentTime + 0.35) {
      if (def.sting) { this._sting(this._next); this._next = Infinity; this.track = 'victory'; return; }
      this._playStep(def, this._step, this._next + ((this._step % 2) ? (def.swing || 0) * stepDur : 0), stepDur);
      this._step++;
      this._next += stepDur;
      if (this._step % 16 === 0) this._bar++;
    }
  }

  _playStep(def, step, t, sd) {
    const s = step % 16, bar = this._bar % 4, dst = this._trackGain, ctx = this.ctx;
    const dg = def.drumGain;
    if (def.kick[s]) kick(ctx, dst, t, 0.9 * dg);
    if (def.snare[s]) snare(ctx, dst, t, 0.5 * dg, this.noiseBuf);
    if (def.hat[s]) hat(ctx, dst, t, (s % 4 === 0 ? 0.16 : 0.09) * dg, this.noiseBuf, def.bpm > 120 ? 0.03 : 0.045);
    const chord = def.chords[bar];
    if (def.bassPat[s]) {
      const n = def.roots[bar] + ((s === 6 || s === 14) && def.bassWave === 'sine' ? 12 : 0);
      bassNote(ctx, dst, t, MIDI(n), sd * 1.8, def.bassGain, def.bassWave, def.dark);
    }
    if (s === 0) padChord(ctx, dst, t, chord, sd * 16, def.padGain, def.dark);
    if (def.lead && s % 2 === 0 && Math.random() < def.lead) {
      const n = def.leadScale[(Math.random() * def.leadScale.length) | 0];
      pluck(ctx, dst, t, MIDI(n), 0.5, 0.11);
    }
    if (def.arp) {
      const n = chord[(s * 2 + (s >> 2)) % chord.length] + 12 + (def.arpOct || 0) + (s % 8 === 7 ? 12 : 0);
      if (s % 2 === 0 || def.bpm > 120) pluck(ctx, dst, t, MIDI(n), 0.18, def.dark ? 0.07 : 0.06, def.dark ? 'sawtooth' : 'square');
    }
  }

  _sting(t) {
    const ctx = this.ctx, dst = this._trackGain;
    const notes = [57, 64, 69, 72, 76, 81, 84];
    notes.forEach((n, i) => pluck(ctx, dst, t + i * 0.11, MIDI(n), 0.9, 0.16, 'triangle'));
    padChord(ctx, dst, t + 0.7, [57, 64, 69, 72, 76], 3.5, 0.12, false);
    kick(ctx, dst, t + 0.7, 0.8);
    setTimeout(() => { if (this.track === 'victory') { this.music(null); } }, 5200);
  }
}

// ---- synth primitives -----------------------------------------------------------------------
function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** Filtered noise burst. f0 -> f1 filter sweep. */
function noise(v, o = {}) {
  const { ctx, dest, noise: buf } = v;
  const t = v.t + (o.at || 0);
  const d = o.d ?? 0.15;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = o.type || 'bandpass';
  f.Q.value = o.q ?? 1;
  const f0 = (o.f0 ?? 1000) * v.pitch, f1 = (o.f1 ?? f0) * v.pitch;
  f.frequency.setValueAtTime(Math.max(20, f0), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + d);
  const g = ctx.createGain();
  env(g, t, o.a ?? 0.004, d, o.v ?? 0.5);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t, Math.random() * 1.5); src.stop(t + d + (o.a ?? 0.004) + 0.05);
}

function osc(v, o = {}) {
  const { ctx, dest } = v;
  const t = v.t + (o.at || 0);
  const d = o.d ?? 0.15;
  const s = ctx.createOscillator();
  s.type = o.type || 'sine';
  const f0 = (o.f0 ?? 440) * v.pitch, f1 = (o.f1 ?? o.f0 ?? 440) * v.pitch;
  s.frequency.setValueAtTime(Math.max(10, f0), t);
  s.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + d);
  if (o.detune) s.detune.value = o.detune;
  const g = ctx.createGain();
  env(g, t, o.a ?? 0.004, d, o.v ?? 0.3);
  let node = s;
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; s.connect(f); node = f; }
  node.connect(g); g.connect(dest);
  s.start(t); s.stop(t + d + (o.a ?? 0.004) + 0.05);
}

/** Vowel-ish growl: detuned saws through two moving formant filters. */
function growl(v, o = {}) {
  const { ctx, dest } = v;
  const t = v.t, d = o.d ?? 0.9, f = (o.f ?? 90) * v.pitch;
  const g = ctx.createGain();
  env(g, t, o.a ?? 0.06, d, o.v ?? 0.45);
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4;
  f1.frequency.setValueAtTime(o.fa ?? 500, t); f1.frequency.linearRampToValueAtTime(o.fb ?? 900, t + d);
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 5;
  f2.frequency.setValueAtTime(1500, t); f2.frequency.linearRampToValueAtTime(1100, t + d);
  const sum = ctx.createGain(); sum.gain.value = 1;
  const lfo = ctx.createOscillator(); lfo.frequency.value = o.lfo ?? 28;
  const lg = ctx.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(sum.gain);
  [-14, 0, 12, 25].forEach((dt) => {
    const s = ctx.createOscillator(); s.type = 'sawtooth'; s.detune.value = dt * 3;
    s.frequency.setValueAtTime(f * 1.2, t); s.frequency.exponentialRampToValueAtTime(f * 0.7, t + d);
    s.connect(sum); s.start(t); s.stop(t + d + 0.1);
  });
  sum.connect(f1); sum.connect(f2); f1.connect(g); f2.connect(g); g.connect(dest);
  lfo.start(t); lfo.stop(t + d + 0.1);
}

function thump(v, f0 = 150, f1 = 45, d = 0.14, vol = 0.7, at = 0) { osc(v, { f0, f1, d, v: vol, at, type: 'sine' }); }

const SFX = {
  jump: (v) => { osc(v, { f0: 280, f1: 560, d: 0.12, v: 0.18 }); noise(v, { f0: 1500, f1: 2500, d: 0.08, v: 0.08 }); },
  thwip: (v) => { noise(v, { f0: 700, f1: 4500, q: 5, d: 0.13, v: 0.5 }); osc(v, { f0: 1800, f1: 500, d: 0.07, v: 0.1, type: 'square', lp: 2500 }); },
  web: (v) => { noise(v, { type: 'highpass', f0: 3500, f1: 1200, q: 0.7, d: 0.2, v: 0.25 }); },
  swing: (v) => { noise(v, { f0: 350, f1: 900, q: 0.8, d: 0.45, a: 0.12, v: 0.2 }); },
  zip: (v) => { noise(v, { f0: 500, f1: 5500, q: 3, d: 0.26, v: 0.35 }); osc(v, { f0: 400, f1: 1500, d: 0.22, v: 0.08, type: 'triangle' }); },
  punch: (v) => { thump(v, 170, 50, 0.13, 0.75); noise(v, { type: 'lowpass', f0: 2500, f1: 600, d: 0.06, v: 0.5 }); },
  hit: (v) => { thump(v, 200, 60, 0.12, 0.65); noise(v, { f0: 2200, f1: 900, q: 1.5, d: 0.07, v: 0.5 }); },
  heavyhit: (v) => { thump(v, 110, 32, 0.34, 0.95); noise(v, { type: 'lowpass', f0: 1800, f1: 120, d: 0.28, v: 0.7 }); osc(v, { f0: 700, f1: 200, d: 0.05, v: 0.2, type: 'square' }); },
  kick: (v) => { thump(v, 230, 70, 0.14, 0.6); noise(v, { f0: 2800, f1: 1400, q: 2, d: 0.05, v: 0.45 }); },
  whoosh: (v) => { noise(v, { f0: 300, f1: 1800, q: 0.9, d: 0.26, a: 0.08, v: 0.28 }); },
  land: (v) => { thump(v, 100, 38, 0.2, 0.7); noise(v, { type: 'lowpass', f0: 700, f1: 150, d: 0.14, v: 0.4 }); },
  dodge: (v) => { noise(v, { f0: 1400, f1: 300, q: 1.2, d: 0.22, a: 0.03, v: 0.28 }); },
  perfect: (v) => { osc(v, { f0: 880, f1: 880, d: 0.5, v: 0.14, type: 'sine' }); osc(v, { f0: 1320, f1: 1320, d: 0.6, v: 0.12, at: 0.06 }); osc(v, { f0: 1760, f1: 1760, d: 0.7, v: 0.09, at: 0.12 }); noise(v, { f0: 600, f1: 4000, q: 2, d: 0.3, v: 0.2 }); },
  repulsor: (v) => { osc(v, { f0: 300, f1: 1500, d: 0.26, v: 0.2, type: 'sawtooth', lp: 3000 }); osc(v, { f0: 700, f1: 2800, d: 0.22, v: 0.12 }); noise(v, { type: 'highpass', f0: 2500, f1: 6000, d: 0.18, v: 0.15 }); },
  missile: (v) => { noise(v, { f0: 1800, f1: 350, q: 1.2, d: 0.55, a: 0.02, v: 0.35 }); osc(v, { f0: 130, f1: 70, d: 0.5, v: 0.2, type: 'sawtooth', lp: 500 }); },
  unibeam: (v) => { osc(v, { f0: 180, f1: 420, d: 1.4, a: 0.1, v: 0.22, type: 'sawtooth', lp: 1800 }); osc(v, { f0: 900, f1: 1300, d: 1.4, a: 0.1, v: 0.1 }); noise(v, { type: 'highpass', f0: 3000, f1: 5000, d: 1.4, a: 0.1, v: 0.12 }); },
  thruster: (v) => { noise(v, { type: 'lowpass', f0: 1100, f1: 700, q: 0.5, d: 0.35, a: 0.05, v: 0.25 }); },
  smash: (v) => { thump(v, 90, 24, 0.55, 1.0); noise(v, { type: 'lowpass', f0: 2500, f1: 90, d: 0.5, v: 0.8 }); },
  roar: (v) => { growl(v, { d: 1.0, f: 95, v: 0.5 }); },
  clap: (v) => { thump(v, 80, 25, 0.5, 1.0); noise(v, { type: 'highpass', f0: 2000, f1: 500, d: 0.12, v: 0.7 }); noise(v, { type: 'lowpass', f0: 1500, f1: 80, d: 0.7, v: 0.6, at: 0.03 }); },
  throw: (v) => { noise(v, { f0: 250, f1: 1500, q: 1, d: 0.3, a: 0.06, v: 0.3 }); },
  hammer: (v) => { noise(v, { f0: 200, f1: 900, q: 1, d: 0.4, a: 0.1, v: 0.3 }); osc(v, { f0: 150, f1: 110, d: 0.4, v: 0.14, type: 'square', lp: 700 }); },
  catch: (v) => { thump(v, 140, 60, 0.12, 0.6); osc(v, { f0: 1500, f1: 1450, d: 0.3, v: 0.12 }); osc(v, { f0: 2300, f1: 2250, d: 0.25, v: 0.08 }); },
  thunder: (v) => {
    noise(v, { type: 'highpass', f0: 3000, f1: 800, d: 0.09, v: 0.8 });
    noise(v, { type: 'lowpass', f0: 380, f1: 60, q: 0.6, d: 2.4, a: 0.05, v: 1.0, at: 0.03 });
    noise(v, { type: 'lowpass', f0: 260, f1: 50, d: 1.6, a: 0.3, v: 0.6, at: 0.4, rate: 0.6 });
    thump(v, 70, 22, 1.2, 0.7, 0.05);
  },
  lightning: (v) => { noise(v, { type: 'highpass', f0: 5000, f1: 700, q: 0.8, d: 0.2, v: 0.6 }); osc(v, { f0: 3000, f1: 200, d: 0.18, v: 0.15, type: 'sawtooth', lp: 4000 }); osc(v, { f0: 60, f1: 55, d: 0.35, v: 0.25, type: 'square', lp: 300 }); },
  explosion: (v) => { noise(v, { type: 'lowpass', f0: 4000, f1: 60, q: 0.7, d: 1.2, v: 1.0 }); thump(v, 95, 26, 0.8, 0.9); noise(v, { f0: 800, f1: 200, d: 0.5, v: 0.4, at: 0.05 }); },
  hurt: (v) => { osc(v, { f0: 260, f1: 110, d: 0.22, v: 0.3, type: 'sawtooth', lp: 1200 }); noise(v, { f0: 900, f1: 400, d: 0.12, v: 0.25 }); },
  switch: (v) => { [440, 659, 880].forEach((f, i) => osc(v, { f0: f, f1: f * 1.01, d: 0.18, v: 0.13, at: i * 0.05, type: 'triangle' })); noise(v, { f0: 1000, f1: 6000, q: 2, d: 0.25, v: 0.15 }); },
  venom: (v) => { growl(v, { d: 0.9, f: 60, v: 0.5, lfo: 22, fa: 350, fb: 700 }); },
  symbiote: (v) => { noise(v, { f0: 500, f1: 120, q: 4, d: 0.35, v: 0.4 }); osc(v, { f0: 160, f1: 60, d: 0.3, v: 0.25, type: 'sawtooth', lp: 600 }); osc(v, { f0: 90, f1: 140, d: 0.3, v: 0.15, at: 0.05 }); },
  goon_die: (v) => { osc(v, { f0: 220, f1: 55, d: 0.4, v: 0.3, type: 'sawtooth', lp: 900 }); noise(v, { type: 'lowpass', f0: 1500, f1: 200, d: 0.3, v: 0.35 }); },
  hunter_shot: (v) => { noise(v, { f0: 2800, f1: 600, q: 0.8, d: 0.1, v: 0.7 }); thump(v, 220, 70, 0.1, 0.5); noise(v, { type: 'lowpass', f0: 700, f1: 150, d: 0.35, v: 0.2, at: 0.05 }); },
  boss_roar: (v) => { growl(v, { d: 1.7, f: 55, v: 0.7, lfo: 20, fa: 300, fb: 800 }); thump(v, 70, 22, 1.2, 0.5, 0.05); noise(v, { type: 'lowpass', f0: 600, f1: 100, d: 1.5, a: 0.2, v: 0.3 }); },
  ui_move: (v) => { osc(v, { f0: 760, f1: 700, d: 0.05, v: 0.1, type: 'triangle' }); },
  ui_select: (v) => { osc(v, { f0: 520, f1: 520, d: 0.1, v: 0.14, type: 'triangle' }); osc(v, { f0: 880, f1: 880, d: 0.16, v: 0.14, type: 'triangle', at: 0.06 }); },
  ui_back: (v) => { osc(v, { f0: 520, f1: 330, d: 0.14, v: 0.13, type: 'triangle' }); },
  pickup: (v) => { [660, 990, 1320].forEach((f, i) => osc(v, { f0: f, f1: f, d: 0.16, v: 0.12, at: i * 0.055 })); },
};

// ---- music voices ---------------------------------------------------------------------------
function kick(ctx, dst, t, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  env(g, t, 0.003, 0.22, 0.55 * vol);
  o.connect(g); g.connect(dst); o.start(t); o.stop(t + 0.3);
}
function snare(ctx, dst, t, vol, buf) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
  const g = ctx.createGain(); env(g, t, 0.002, 0.16, 0.35 * vol);
  s.connect(f); f.connect(g); g.connect(dst); s.start(t, Math.random()); s.stop(t + 0.2);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.08);
  env(og, t, 0.002, 0.1, 0.2 * vol); o.connect(og); og.connect(dst); o.start(t); o.stop(t + 0.15);
}
function hat(ctx, dst, t, vol, buf, d) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = ctx.createGain(); env(g, t, 0.001, d, vol);
  s.connect(f); f.connect(g); g.connect(dst); s.start(t, Math.random()); s.stop(t + d + 0.03);
}
function bassNote(ctx, dst, t, freq, dur, vol, wave, dark) {
  const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = dark ? 6 : 2;
  f.frequency.setValueAtTime(wave === 'sine' ? 600 : (dark ? 1400 : 900), t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
  const g = ctx.createGain(); env(g, t, 0.008, dur, vol);
  o.connect(f); f.connect(g); g.connect(dst); o.start(t); o.stop(t + dur + 0.05);
}
function padChord(ctx, dst, t, notes, dur, vol, dark) {
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = dark ? 900 : 1400; f.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
  g.gain.linearRampToValueAtTime(vol * 0.7, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
  f.connect(g); g.connect(dst);
  notes.forEach((n, i) => {
    [-6, 6].forEach((dt) => {
      const o = ctx.createOscillator(); o.type = dark ? 'sawtooth' : 'triangle';
      o.frequency.value = MIDI(n); o.detune.value = dt + (i % 2 ? 3 : -3);
      o.connect(f); o.start(t); o.stop(t + dur + 0.3);
    });
  });
}
function pluck(ctx, dst, t, freq, dur, vol, wave = 'triangle') {
  const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = ctx.createGain(); env(g, t, 0.004, dur, vol);
  o.connect(f); f.connect(g); g.connect(dst); o.start(t); o.stop(t + dur + 0.05);
}
void rnd;
