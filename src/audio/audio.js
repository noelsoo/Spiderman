// Procedural WebAudio engine: every sound effect and every music track is synthesised at runtime
// (no audio files). Contract: see docs/ARCHITECTURE.md#audio
//
//   unlock()                         resume the AudioContext (call from a user gesture)
//   play(name, { volume, pitch, pos })   one-shot SFX, optional 3D attenuation/pan relative to game.camera
//   music('roam'|'combat'|'boss'|'victory'|null)   crossfade to a track
//   duck(bool)                       lower the music (pause menu)
//   engine(on, rpm)                  looping car engine; setEngine(rpm 0..1, load 0..1) every frame (auto-stops if not refreshed)
//   siren(on)                        looping police wail; horn(on) held horn
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
      // city reverb (generated impulse response) + urban-canyon slapback echo, both fed by per-sound sends
      this.verbIn = ctx.createGain();
      const verb = ctx.createConvolver(); verb.buffer = makeIR(ctx, 2.8, 3.2);
      const verbOut = ctx.createGain(); verbOut.gain.value = 0.8;
      this.verbIn.connect(verb); verb.connect(verbOut); verbOut.connect(this.sfxBus);
      this.slapIn = ctx.createGain();
      const dl = ctx.createDelay(1); dl.delayTime.value = 0.13;
      const fb = ctx.createGain(); fb.gain.value = 0.3;
      const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 2600;
      this.slapIn.connect(dl); dl.connect(slp); slp.connect(fb); fb.connect(dl); slp.connect(this.sfxBus);
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
    const rec = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
    if (typeof rec !== 'function') return;
    try {
      const ctx = this.ctx, now = ctx.currentTime;
      if (now - (this._lastPlay[name] || 0) < (MIN_GAP[name] ?? 0.03)) return; // anti-spam
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
      const nodes = [out];
      if (opts.pos && this.game.camera) { // far sounds are duller
        const dist = this.game.camera.position.distanceTo(opts.pos);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(700, 16000 / (1 + dist / 22));
        out.connect(lp); tail = lp; nodes.push(lp);
      }
      if (ctx.createStereoPanner && pan !== 0) { const sp = ctx.createStereoPanner(); sp.pan.value = pan; tail.connect(sp); tail = sp; nodes.push(sp); }
      tail.connect(this.sfxBus);
      const rv = REVERB[name], sl = SLAP[name];
      if (rv && this.verbIn) { const sg = ctx.createGain(); sg.gain.value = rv; tail.connect(sg); sg.connect(this.verbIn); nodes.push(sg); }
      if (sl && this.slapIn) { const sg = ctx.createGain(); sg.gain.value = sl; tail.connect(sg); sg.connect(this.slapIn); nodes.push(sg); }
      const v = { ctx, out, t: now + 0.001, pitch: opts.pitch ?? 1, noise: this.noiseBuf, dest: out };
      rec(v);
      // free the nodes after the longest sound has surely ended
      setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } } }, 4500);
    } catch { /* never throw from audio */ }
  }


  // ---- looping voices: engine, siren, horn ----------------------------------------------------
  /** Explicit engine control: engine(true, rpm) starts / updates it, engine(false) stops it. */
  engine(on, rpm = 0.2, load = 0) {
    if (!this.ok) return;
    try {
      if (!on) { this._stopEngine(); return; }
      if (!this.running) return;
      this._engExplicit = true;
      this._engineSet(rpm, load);
    } catch { /* ignore */ }
  }

  /** Per-frame engine update from the vehicle system. Auto-stops ~0.3 s after the last call. */
  setEngine(rpm = 0.2, load = 0) {
    if (!this.running) return;
    try { this._engExplicit = false; this._engineSet(rpm, load); } catch { /* ignore */ }
  }

  _engineSet(rpm, load) {
    const ctx = this.ctx, t = ctx.currentTime;
    rpm = Math.max(0, Math.min(1, +rpm || 0)); load = Math.max(0, Math.min(1, +load || 0));
    let e = this._eng;
    if (!e) {
      const out = ctx.createGain(); out.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5; lp.frequency.value = 400;
      const shaper = ctx.createWaveShaper(); const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
      shaper.curve = curve;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const o3 = ctx.createOscillator(); o3.type = 'triangle';
      const o4 = ctx.createOscillator(); o4.type = 'sawtooth'; const g4 = ctx.createGain(); g4.gain.value = 0.12; o4.connect(g4); g4.connect(shaper);
      const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
      g1.gain.value = 0.5; g2.gain.value = 0.22; g3.gain.value = 0.5;
      // cylinder-firing wobble
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; const lg = ctx.createGain(); lg.gain.value = 0.18;
      lfo.connect(lg); lg.connect(g1.gain);
      o1.connect(g1); o2.connect(g2); o3.connect(g3);
      g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
      shaper.connect(lp); lp.connect(out); out.connect(this.sfxBus);
      // intake / road noise
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 500;
      const ng = ctx.createGain(); ng.gain.value = 0.0;
      n.connect(nf); nf.connect(ng); ng.connect(out);
      [o1, o2, o3, o4, lfo, n].forEach((x) => x.start(t));
      e = this._eng = { out, lp, o1, o2, o3, o4, lfo, n, nf, ng, last: 0, rpm };
      this.play('engine_start');
    }
    const f = 34 + rpm * 96;                       // fundamental, Hz
    e.o1.frequency.setTargetAtTime(f, t, 0.05);
    e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.o3.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    e.o4.frequency.setTargetAtTime(f * 3.02, t, 0.05);
    if (e.rpm - rpm > 0.18) { // upshift: brief lift-off dip and a burble
      e.out.gain.cancelScheduledValues(t); e.out.gain.setValueAtTime(0.03, t); this.play('shift', { volume: 0.6 });
    }
    e.rpm = rpm;
    e.lfo.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    e.lp.frequency.setTargetAtTime(260 + rpm * 700 + load * 900, t, 0.06);
    e.nf.frequency.setTargetAtTime(400 + rpm * 1800, t, 0.08);
    e.ng.gain.setTargetAtTime(0.04 + load * 0.18 + rpm * 0.05, t, 0.08);
    e.out.gain.setTargetAtTime(0.1 + load * 0.08 + rpm * 0.05, t, 0.06);
    e.last = performance.now();
  }

  _stopEngine() {
    const e = this._eng; if (!e) return;
    this._eng = null;
    const t = this.ctx.currentTime;
    try {
      e.out.gain.cancelScheduledValues(t); e.out.gain.setTargetAtTime(0.0001, t, 0.08);
      setTimeout(() => { try { [e.o1, e.o2, e.o3, e.o4, e.lfo, e.n].forEach((x) => x.stop()); e.out.disconnect(); } catch { /* ignore */ } }, 500);
    } catch { /* ignore */ }
  }

  /** Police siren wail on/off. */
  siren(on) {
    if (!this.ok) return;
    try {
      if (!on) {
        const s = this._sir; if (!s) return;
        this._sir = null; const t = this.ctx.currentTime;
        s.g.gain.setTargetAtTime(0.0001, t, 0.1);
        setTimeout(() => { try { s.o.stop(); s.lfo.stop(); s.drift?.stop(); s.g.disconnect(); } catch { /* ignore */ } }, 600);
        return;
      }
      if (this._sir || !this.running) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 900;
      const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.55;
      const lg = ctx.createGain(); lg.gain.value = 330; lfo.connect(lg); lg.connect(o.frequency);
      const drift = ctx.createOscillator(); drift.frequency.value = 0.13; const dg = ctx.createGain(); dg.gain.value = 60; drift.connect(dg); dg.connect(o.detune); drift.start(t); // slow pitch drift ~ Doppler
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.045, t, 0.15);
      o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
      o.start(t); lfo.start(t);
      this._sir = { o, lfo, g, drift };
    } catch { /* ignore */ }
  }

  /** Held horn: horn(true) while the button is down, horn(false) on release. (play('horn') is a single honk.) */
  horn(on) {
    if (!this.ok) return;
    try {
      if (!on) {
        const h = this._horn; if (!h) return;
        this._horn = null; const t = this.ctx.currentTime;
        h.g.gain.setTargetAtTime(0.0001, t, 0.03);
        setTimeout(() => { try { h.a.stop(); h.b.stop(); h.g.disconnect(); } catch { /* ignore */ } }, 300);
        return;
      }
      if (this._horn || !this.running) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.16, t, 0.01);
      const a = ctx.createOscillator(), b = ctx.createOscillator(); a.type = b.type = 'sawtooth'; a.frequency.value = 392; b.frequency.value = 494;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      a.connect(lp); b.connect(lp); lp.connect(g); g.connect(this.sfxBus); a.start(t); b.start(t);
      this._horn = { a, b, g };
    } catch { /* ignore */ }
  }

  _loopWatchdog() {
    const e = this._eng;
    if (e && !this._engExplicit && performance.now() - e.last > 350) this._stopEngine();
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
      this._loopWatchdog();
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

function makeIR(ctx, secs, decay) {
  const len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, a = Math.pow(1 - t, decay);
      lp += (((Math.random() * 2 - 1) * a) - lp) * (0.25 + 0.6 * (1 - t)); // darker as it decays
      d[i] = lp * 2.2 * (i < 400 ? i / 400 : 1);
    }
  }
  return buf;
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
  // ---- v2: guns -------------------------------------------------------------------------------
  pistol: (v) => { noise(v, { f0: 3200, f1: 700, q: 0.7, d: 0.09, v: 0.8 }); thump(v, 260, 70, 0.1, 0.65); noise(v, { type: 'lowpass', f0: 900, f1: 180, d: 0.3, v: 0.22, at: 0.03 }); },
  smg: (v) => { noise(v, { f0: 3600, f1: 900, q: 0.8, d: 0.06, v: 0.65 }); thump(v, 300, 90, 0.07, 0.5); noise(v, { type: 'lowpass', f0: 1000, f1: 250, d: 0.14, v: 0.15, at: 0.02 }); },
  shotgun: (v) => { noise(v, { type: 'lowpass', f0: 5000, f1: 220, q: 0.6, d: 0.38, v: 1.0 }); thump(v, 150, 38, 0.3, 0.95); noise(v, { f0: 1800, f1: 400, d: 0.12, v: 0.5 }); noise(v, { type: 'lowpass', f0: 600, f1: 90, d: 0.7, a: 0.05, v: 0.3, at: 0.05 }); },
  rifle: (v) => { noise(v, { f0: 3000, f1: 500, q: 0.7, d: 0.11, v: 0.9 }); thump(v, 200, 48, 0.16, 0.85); noise(v, { type: 'lowpass', f0: 800, f1: 120, d: 0.5, v: 0.28, at: 0.03 }); },
  sniper: (v) => { noise(v, { type: 'lowpass', f0: 6000, f1: 160, q: 0.6, d: 0.5, v: 1.0 }); thump(v, 130, 30, 0.4, 1.0); osc(v, { f0: 1800, f1: 400, d: 0.1, v: 0.18, type: 'sawtooth', lp: 3000 }); noise(v, { type: 'lowpass', f0: 500, f1: 70, d: 1.4, a: 0.1, v: 0.35, at: 0.12 }); },
  rpg: (v) => { noise(v, { f0: 2400, f1: 300, q: 1, d: 0.5, a: 0.01, v: 0.7 }); thump(v, 110, 36, 0.35, 0.7); noise(v, { type: 'highpass', f0: 1500, f1: 600, d: 0.9, a: 0.1, v: 0.25, at: 0.1 }); },
  reload: (v) => { thump(v, 700, 400, 0.04, 0.3); noise(v, { f0: 3500, f1: 3500, q: 6, d: 0.03, v: 0.4 }); osc(v, { f0: 1100, f1: 900, d: 0.04, v: 0.12, type: 'square', at: 0.28 }); noise(v, { f0: 2500, f1: 2500, q: 5, d: 0.04, v: 0.5, at: 0.28 }); thump(v, 500, 250, 0.06, 0.35, 0.36); },
  empty: (v) => { noise(v, { f0: 4500, f1: 4500, q: 8, d: 0.025, v: 0.5 }); osc(v, { f0: 1500, f1: 1200, d: 0.03, v: 0.1, type: 'square' }); },
  // ---- v2: vehicles -------------------------------------------------------------------------
  engine_start: (v) => { osc(v, { f0: 55, f1: 34, d: 0.5, a: 0.02, v: 0.22, type: 'sawtooth', lp: 300 }); osc(v, { f0: 38, f1: 70, d: 0.45, a: 0.15, v: 0.2, type: 'square', lp: 260 }); noise(v, { type: 'lowpass', f0: 400, f1: 900, d: 0.5, a: 0.1, v: 0.15 }); },
  shift: (v) => { noise(v, { type: 'lowpass', f0: 1200, f1: 300, d: 0.16, v: 0.3 }); thump(v, 90, 50, 0.08, 0.25); },
  horn: (v) => { osc(v, { f0: 392, f1: 392, d: 0.42, a: 0.01, v: 0.16, type: 'sawtooth', lp: 1800 }); osc(v, { f0: 494, f1: 494, d: 0.42, a: 0.01, v: 0.14, type: 'sawtooth', lp: 1800 }); },
  siren_blip: (v) => { osc(v, { f0: 700, f1: 1300, d: 0.4, a: 0.05, v: 0.12, type: 'square', lp: 2200 }); osc(v, { f0: 1300, f1: 700, d: 0.4, a: 0.05, v: 0.12, type: 'square', lp: 2200, at: 0.4 }); },
  siren: (v) => { SFX.siren_blip(v); },
  screech: (v) => { noise(v, { type: 'bandpass', f0: 2300, f1: 1700, q: 7, d: 0.5, a: 0.04, v: 0.3 }); noise(v, { type: 'bandpass', f0: 3400, f1: 2600, q: 9, d: 0.45, a: 0.06, v: 0.18 }); osc(v, { f0: 1500, f1: 1100, d: 0.4, a: 0.05, v: 0.04, type: 'sawtooth', lp: 2400 }); },
  crash: (v) => { thump(v, 120, 30, 0.35, 0.95); noise(v, { type: 'lowpass', f0: 3500, f1: 120, d: 0.5, v: 0.85 }); noise(v, { f0: 1800, f1: 600, q: 2, d: 0.25, v: 0.5, at: 0.02 }); osc(v, { f0: 600, f1: 180, d: 0.12, v: 0.12, type: 'square', at: 0.05 }); },
  glass: (v) => { for (let i = 0; i < 9; i++) osc(v, { f0: 3000 + Math.random() * 5000, f1: 2500 + Math.random() * 4000, d: 0.12 + Math.random() * 0.2, v: 0.05, at: Math.random() * 0.22, type: 'triangle' }); noise(v, { type: 'highpass', f0: 5000, f1: 3000, d: 0.35, v: 0.3 }); },
  carjack: (v) => { thump(v, 160, 55, 0.12, 0.7); noise(v, { f0: 1800, f1: 800, q: 2, d: 0.08, v: 0.5 }); noise(v, { type: 'highpass', f0: 3000, f1: 3000, d: 0.03, v: 0.4, at: 0.14 }); thump(v, 200, 80, 0.14, 0.75, 0.2); osc(v, { f0: 250, f1: 120, d: 0.2, v: 0.15, type: 'sawtooth', lp: 900, at: 0.22 }); },
  // ---- v2: economy / police -----------------------------------------------------------------
  cash: (v) => { osc(v, { f0: 1319, f1: 1319, d: 0.1, v: 0.14, type: 'square', lp: 4000 }); osc(v, { f0: 1760, f1: 1760, d: 0.35, a: 0.002, v: 0.14, type: 'square', lp: 5000, at: 0.07 }); osc(v, { f0: 3520, f1: 3520, d: 0.25, v: 0.05, at: 0.07 }); },
  wanted: (v) => { [0, 0.16].forEach((a) => { osc(v, { f0: 880, f1: 880, d: 0.12, v: 0.12, type: 'square', lp: 2500, at: a }); osc(v, { f0: 660, f1: 660, d: 0.12, v: 0.1, type: 'square', lp: 2500, at: a + 0.08 }); }); },
  // ---- v2: hero powers ---------------------------------------------------------------------
  claw: (v) => { noise(v, { type: 'highpass', f0: 2500, f1: 7000, q: 0.8, d: 0.12, v: 0.4 }); osc(v, { f0: 3200, f1: 1800, d: 0.18, v: 0.07, type: 'sawtooth', lp: 6000 }); osc(v, { f0: 4200, f1: 2400, d: 0.2, v: 0.05, at: 0.03, type: 'sawtooth', lp: 7000 }); },
  slash: (v) => { noise(v, { f0: 900, f1: 5200, q: 1.5, d: 0.16, a: 0.015, v: 0.4 }); osc(v, { f0: 2400, f1: 900, d: 0.14, v: 0.06, type: 'triangle' }); },
  shield: (v) => { osc(v, { f0: 1400, f1: 1380, d: 0.5, a: 0.002, v: 0.18, type: 'sine' }); osc(v, { f0: 2100, f1: 2090, d: 0.4, a: 0.002, v: 0.1, type: 'sine' }); osc(v, { f0: 3000, f1: 2980, d: 0.3, v: 0.05 }); thump(v, 300, 120, 0.06, 0.5); noise(v, { f0: 4000, f1: 4000, q: 6, d: 0.04, v: 0.35 }); },
  bow: (v) => { noise(v, { f0: 1200, f1: 400, q: 2, d: 0.08, v: 0.2 }); osc(v, { f0: 220, f1: 110, d: 0.14, v: 0.22, type: 'triangle' }); noise(v, { type: 'highpass', f0: 2500, f1: 5000, d: 0.2, v: 0.2, at: 0.02 }); },
  arrow: (v) => { SFX.bow(v); },
  magic: (v) => { osc(v, { f0: 300, f1: 900, d: 0.5, a: 0.04, v: 0.14, type: 'sine' }); osc(v, { f0: 450, f1: 1350, d: 0.5, a: 0.04, v: 0.1, type: 'triangle', detune: 14 }); noise(v, { f0: 1000, f1: 5000, q: 4, d: 0.45, a: 0.05, v: 0.14 }); osc(v, { f0: 90, f1: 140, d: 0.4, v: 0.14, type: 'sawtooth', lp: 400 }); },
  hex: (v) => { SFX.magic(v); osc(v, { f0: 1800, f1: 600, d: 0.25, v: 0.07, type: 'square', lp: 3000, at: 0.05 }); },
  pickup: (v) => { [660, 990, 1320].forEach((f, i) => osc(v, { f0: f, f1: f, d: 0.16, v: 0.12, at: i * 0.055 })); },
};

// friendly aliases so other systems can pass weapon ids, hero ids or event names directly
Object.assign(SFX, {
  gunshot: SFX.pistol, gun: SFX.pistol, assault: SFX.rifle, ar: SFX.rifle, assault_rifle: SFX.rifle, grenade: SFX.rpg, grenade_launcher: SFX.rpg,
  coin: SFX.cash, money: SFX.cash, claws: SFX.claw, arrow_shot: SFX.bow, scarlet: SFX.hex, reality: SFX.magic, telekinesis: SFX.magic,
  glass_break: SFX.glass, tyre: SFX.screech, tire: SFX.screech, steal: SFX.carjack, engine: SFX.engine_start, shield_hit: SFX.shield, shield_throw: SFX.throw,
});
const MIN_GAP = { horn: 0.4, screech: 0.35, siren: 0.8, siren_blip: 0.8, engine_start: 0.5, smg: 0.045, cash: 0.06, crash: 0.12, glass: 0.1, wanted: 0.5, reload: 0.3 };

// ---- v2.1 realism pass: layered guns (crack + body + tail; reverb/slapback sends below), beefier impacts -------------
const crack = (v, f = 4500, d = 0.02, vol = 0.9, at = 0) => noise(v, { type: 'highpass', f0: f, f1: f * 0.6, q: 0.7, d, a: 0.0015, v: vol, at });
Object.assign(SFX, {
  pistol: (v) => { crack(v, 3800, 0.022, 0.9); noise(v, { f0: 2400, f1: 700, q: 0.8, d: 0.07, v: 0.55 }); thump(v, 240, 62, 0.11, 0.7); thump(v, 120, 50, 0.16, 0.35, 0.005); noise(v, { type: 'lowpass', f0: 900, f1: 160, d: 0.28, v: 0.18, at: 0.03 }); },
  smg: (v) => { crack(v, 4200, 0.016, 0.8); noise(v, { f0: 2800, f1: 900, q: 0.8, d: 0.045, v: 0.45 }); thump(v, 300, 90, 0.06, 0.5); },
  shotgun: (v) => { crack(v, 3000, 0.035, 1.0); noise(v, { type: 'lowpass', f0: 4500, f1: 200, q: 0.6, d: 0.32, v: 1.0 }); thump(v, 140, 34, 0.32, 1.0); thump(v, 80, 28, 0.4, 0.6, 0.01); noise(v, { type: 'lowpass', f0: 500, f1: 80, d: 0.6, a: 0.04, v: 0.28, at: 0.05 }); },
  rifle: (v) => { crack(v, 5200, 0.03, 1.0); noise(v, { f0: 3000, f1: 600, q: 0.7, d: 0.09, v: 0.7 }); thump(v, 190, 46, 0.18, 0.85); noise(v, { type: 'lowpass', f0: 800, f1: 110, d: 0.45, v: 0.25, at: 0.03 }); },
  sniper: (v) => { crack(v, 6500, 0.05, 1.0); noise(v, { type: 'lowpass', f0: 6500, f1: 140, q: 0.6, d: 0.55, v: 1.0 }); thump(v, 120, 26, 0.5, 1.0); thump(v, 60, 24, 0.7, 0.6, 0.02); osc(v, { f0: 2000, f1: 380, d: 0.12, v: 0.18, type: 'sawtooth', lp: 3200 }); noise(v, { type: 'lowpass', f0: 450, f1: 60, d: 1.6, a: 0.1, v: 0.3, at: 0.12 }); },
  rpg: (v) => { noise(v, { f0: 2400, f1: 250, q: 1, d: 0.55, a: 0.01, v: 0.7 }); thump(v, 105, 34, 0.4, 0.8); noise(v, { type: 'highpass', f0: 1500, f1: 500, d: 1.1, a: 0.12, v: 0.28, at: 0.08 }); osc(v, { f0: 90, f1: 60, d: 1.0, a: 0.1, v: 0.14, type: 'sawtooth', lp: 400, at: 0.1 }); },
  casing: (v) => { [0, 0.07, 0.12].forEach((a, i) => osc(v, { f0: 5200 - i * 700, f1: 5000 - i * 700, d: 0.07, a: 0.001, v: 0.07 / (i + 1), type: 'triangle', at: a })); noise(v, { f0: 7000, f1: 7000, q: 8, d: 0.02, v: 0.12 }); },
  punch: (v) => { thump(v, 170, 48, 0.15, 0.85); noise(v, { f0: 2400, f1: 700, q: 1.2, d: 0.05, v: 0.6 }); noise(v, { type: 'highpass', f0: 4000, f1: 2500, d: 0.02, v: 0.35 }); thump(v, 70, 32, 0.2, 0.5, 0.005); },
  hit: (v) => { thump(v, 200, 55, 0.14, 0.75); noise(v, { f0: 2200, f1: 800, q: 1.5, d: 0.06, v: 0.6 }); noise(v, { type: 'highpass', f0: 4500, f1: 3000, d: 0.018, v: 0.3 }); thump(v, 80, 34, 0.18, 0.4, 0.004); },
  heavyhit: (v) => { thump(v, 105, 28, 0.42, 1.0); thump(v, 55, 24, 0.5, 0.7, 0.01); noise(v, { type: 'lowpass', f0: 2200, f1: 100, d: 0.32, v: 0.8 }); noise(v, { type: 'highpass', f0: 3500, f1: 1800, d: 0.04, v: 0.5 }); osc(v, { f0: 700, f1: 160, d: 0.06, v: 0.2, type: 'square' }); },
  explosion: (v) => { noise(v, { type: 'highpass', f0: 3500, f1: 900, d: 0.06, v: 0.7 }); noise(v, { type: 'lowpass', f0: 4500, f1: 55, q: 0.7, d: 1.6, v: 1.0 }); thump(v, 90, 22, 1.0, 1.0); osc(v, { f0: 48, f1: 26, d: 1.6, a: 0.01, v: 0.7, type: 'sine' }); noise(v, { f0: 700, f1: 160, d: 0.7, v: 0.35, at: 0.06 }); },
  thwip: (v) => { noise(v, { type: 'highpass', f0: 1500, f1: 6000, q: 0.8, d: 0.02, v: 0.5 }); noise(v, { f0: 900, f1: 6500, q: 6, d: 0.11, v: 0.55 }); osc(v, { f0: 2400, f1: 480, d: 0.07, v: 0.1, type: 'square', lp: 3000 }); thump(v, 320, 120, 0.05, 0.25); },
  repulsor: (v) => { osc(v, { f0: 300, f1: 1500, d: 0.26, v: 0.2, type: 'sawtooth', lp: 3000 }); osc(v, { f0: 700, f1: 2800, d: 0.24, v: 0.12 }); osc(v, { f0: 2400, f1: 4800, d: 0.3, v: 0.05, type: 'triangle', at: 0.02 }); noise(v, { type: 'highpass', f0: 2500, f1: 6500, d: 0.18, v: 0.15 }); thump(v, 150, 60, 0.12, 0.35); },
  unibeam: (v) => { osc(v, { f0: 180, f1: 460, d: 1.5, a: 0.12, v: 0.22, type: 'sawtooth', lp: 1800 }); osc(v, { f0: 900, f1: 1500, d: 1.5, a: 0.1, v: 0.1 }); osc(v, { f0: 2600, f1: 3400, d: 1.5, a: 0.2, v: 0.05, type: 'triangle' }); osc(v, { f0: 60, f1: 90, d: 1.5, a: 0.15, v: 0.3, type: 'sine' }); noise(v, { type: 'highpass', f0: 3000, f1: 5500, d: 1.5, a: 0.1, v: 0.12 }); },
  thunder: (v) => { noise(v, { type: 'highpass', f0: 3000, f1: 800, d: 0.09, v: 0.8 }); noise(v, { type: 'lowpass', f0: 420, f1: 55, q: 0.6, d: 3.2, a: 0.05, v: 1.0, at: 0.03 }); noise(v, { type: 'lowpass', f0: 260, f1: 45, d: 2.6, a: 0.4, v: 0.6, at: 0.5, rate: 0.6 }); thump(v, 70, 20, 1.6, 0.8, 0.05); osc(v, { f0: 38, f1: 24, d: 2.5, a: 0.2, v: 0.5, at: 0.2 }); },
});
const REVERB = { pistol: 0.35, smg: 0.22, shotgun: 0.5, rifle: 0.45, sniper: 0.8, rpg: 0.5, explosion: 0.55, thunder: 0.6, crash: 0.25, heavyhit: 0.18, smash: 0.3, hunter_shot: 0.3, unibeam: 0.2, clap: 0.35, roar: 0.2, boss_roar: 0.35, siren_blip: 0.2, glass: 0.2 };
const SLAP = { pistol: 0.3, smg: 0.18, shotgun: 0.4, rifle: 0.4, sniper: 0.55, rpg: 0.3, explosion: 0.25, hunter_shot: 0.2 };
Object.assign(SFX, { gunshot: SFX.pistol, gun: SFX.pistol, assault: SFX.rifle, ar: SFX.rifle, assault_rifle: SFX.rifle, grenade: SFX.rpg, grenade_launcher: SFX.rpg });
REVERB.gunshot = REVERB.gun = REVERB.pistol; SLAP.gunshot = SLAP.gun = SLAP.pistol;
REVERB.assault = REVERB.ar = REVERB.assault_rifle = REVERB.rifle; SLAP.assault = SLAP.ar = SLAP.assault_rifle = SLAP.rifle;
REVERB.grenade = REVERB.grenade_launcher = REVERB.rpg; SLAP.grenade = SLAP.grenade_launcher = SLAP.rpg;
MIN_GAP.casing = 0.05;

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
