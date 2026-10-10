// Campaign director: "Sinister Symbiosis". Contract: docs/ARCHITECTURE.md#campaign
//
//   game.campaign.missions            MISSIONS (src/campaign/missions.js)
//   game.campaign.progress            { unlocked, done: { [id]: { stars, best } }, cash }   persisted in localStorage 'sm-campaign'
//   game.campaign.start(id)           called by game.begin(hero, { mode:'campaign', missionId })
//   game.campaign.update(dt)          every playing frame (before enemies)
//   game.campaign.onFail(reason)      all heroes down / objective failed
//   game.campaign.retryCheckpoint()   restart at the current objective step      restart()   restart the mission
//   game.campaign.abandon()           back to the chapter list
//   game.campaign.debugSkip()         complete the current objective (or skip a running cutscene)
//
// The HUD side lives in src/ui/campaign-ui.js (menus, subtitles, letterbox, mission complete / failed screens).
import * as THREE from 'three';
import { MISSIONS, SPEAKERS } from './missions.js';
import { STEP_TYPES, resolvePlace, groundPoint, pickKind, setupChase } from './objectives.js';

const KEY = 'sm-campaign';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Campaign {
  constructor(game) {
    this.game = game;
    this.missions = MISSIONS;
    this.speakers = SPEAKERS;
    this.progress = this._load();
    this.active = null;          // mission definition being played
    this.run = null;             // { retries, checkpoint:{step,pos}, hero }
    this.step = null;
    this.stepIdx = -1;
    this.time = 0;               // play time of this attempt (excludes cutscenes and menus)
    this.phase = 'idle';         // idle | playing | ending | over
    this.mem = {};               // per-run scratch shared by steps (van position, chase state)
    this.maxAlive = 16;
    this.dlg = { queue: [], cur: null, t: 0, gap: 0 };
    this.cine = null;
    this._resume = null;
    this._burnT = 3;
    this._enter = false;
    addEventListener('keydown', (e) => { if (this.cine && (e.code === 'Enter' || e.code === 'NumpadEnter')) this._enter = true; }, true);
  }

  // ====================================================================== persistence
  _load() {
    const def = { v: 1, unlocked: 0, done: {}, cash: 0 };
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && typeof o === 'object') return { ...def, ...o, done: { ...(o.done || {}) } };
    } catch { /* private mode */ }
    return def;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.progress)); } catch { /* ignore */ } }
  reset() { this.progress = { v: 1, unlocked: 0, done: {}, cash: 0 }; this.save(); }
  unlockAll() { this.progress.unlocked = this.missions.length - 1; this.save(); }
  isUnlocked(id) { return id <= this.progress.unlocked; }
  stars(id) { return this.progress.done[id]?.stars ?? 0; }
  get totalStars() { return Object.values(this.progress.done).reduce((a, d) => a + (d.stars || 0), 0); }

  find(id) {
    if (typeof id === 'number') return this.missions[id];
    if (/^\d+$/.test(String(id))) return this.missions[+id];
    return this.missions.find((m) => m.key === id) ?? this.missions[0];
  }

  // ====================================================================== helpers for steps
  resolve(spec) { return resolvePlace(this, spec); }
  prepareChase(g, at) { return setupChase(this, at); }
  aliveCount() { let n = 0; for (const e of this.game.enemies.list) if (e.alive) n++; return n; }

  spawn(kindSpec, pos, opts = {}) {
    const kind = pickKind(kindSpec);
    return this.game.enemies.spawn(kind, pos, opts);
  }

  setObjective(text, progress) {
    const hud = this.game.hud;
    hud?.objective?.(text, progress);
    const m = this.active;
    if (m) hud?.setObjectiveTag?.(`${m.title} · ${this._objNumber()}/${this._objCount()}`);
  }
  _objCount() { return this.active.steps.filter((s) => s.type !== 'cutscene' && s.type !== 'talk').length; }
  _objNumber() {
    let n = 0;
    for (let i = 0; i <= this.stepIdx && i < this.active.steps.length; i++) { const t = this.active.steps[i].type; if (t !== 'cutscene' && t !== 'talk') n++; }
    return Math.max(1, n);
  }
  setWaypoint(pos) {
    const en = this.game.enemies;
    if (pos) { en.objectivePos.copy(pos); en.objectiveActive = true; } else en.objectiveActive = false;
  }
  setTimer(text) { this.game.hud?.setTimer?.(text); }

  teleportPlayer(pos, yaw) {
    const g = this.game, p = g.player;
    if (g.vehicles?.driving) g.vehicles.tryInteract?.();
    p.pos.copy(pos); p.vel.set(0, 0, 0);
    if (yaw !== undefined) { p.yaw = yaw; g.cam.recenter(yaw); }
    g.fx?.ring?.(_v.set(pos.x, pos.y + 0.15, pos.z), 3.5, 0x5fd6ff, 0.6);
    g.fx?.burst?.(_v.set(pos.x, pos.y + 1, pos.z), 0x5fd6ff, 24, 6, 0.6, 0.3);
  }

  // ====================================================================== dialogue (radio subtitles)
  say(lines) {
    for (const l of lines ?? []) this.dlg.queue.push(l);
  }
  dialogueIdle() { return !this.dlg.cur && !this.dlg.queue.length && this.dlg.gap <= 0; }
  clearDialogue() { this.dlg.queue.length = 0; this.dlg.cur = null; this.dlg.gap = 0; this.game.hud?.hideSubtitle?.(); }
  _lineTime(l) { return l.dur ?? Math.max(2.6, 1.3 + l.text.length * 0.052); }
  tickDialogue(dt) {
    const d = this.dlg, hud = this.game.hud;
    if (d.cur) {
      d.t -= dt;
      if (d.t <= 0) { d.cur = null; d.gap = 0.35; hud?.hideSubtitle?.(); }
    } else if (d.gap > 0) d.gap -= dt;
    else if (d.queue.length) {
      const l = d.queue.shift();
      d.cur = l; d.t = this._lineTime(l);
      const sp = SPEAKERS[l.who] ?? { name: l.who === 'HERO' ? (this.game.player?.name ?? 'Hero') : l.who, color: '#ffffff' };
      hud?.showSubtitle?.(sp.name, l.text, sp.color);
      this.game.audio?.play?.('ui_move', { volume: 0.5 });
    }
  }

  // ====================================================================== cutscenes (overlay state: gameplay frozen, we own the camera)
  playCutscene(o) {
    const g = this.game;
    const lines = o.lines ?? [];
    const cine = this.cine = {
      t: 0, lines: lines.slice(), li: -1, lt: 0, skip: false, cam: o.cam ?? null, onEnd: o.onEnd, started: false, fade: 0,
      from: null, to: null, look: null, orbit: null, dur: Math.max(o.cam?.dur ?? 4, 2), fadeT: 0,
    };
    this._enter = false;
    this.clearDialogue();
    if (o.cam) {
      const c = o.cam;
      if (c.orbit) cine.orbit = { center: c.orbit, radius: c.radius ?? 15, height: c.height ?? 5, a0: Math.random() * 6.28 };
      else {
        cine.from = this.resolve(c.from); cine.to = this.resolve(c.to ?? c.from);
        cine.look = this.resolve(c.look ?? c.to);
      }
    }
    // teleport behind a quick fade
    if (o.teleport) {
      cine.tele = { pos: this.resolve(o.teleport), yaw: o.teleportYaw, done: false };
      cine.fadeT = 0.5;
    }
    const handler = {
      update: (rawDt) => this._cutsceneUpdate(rawDt),
      onClose: () => this._cutsceneEnd(),
    };
    this.game.hud?.setLetterbox?.(true);
    if (!g.openOverlay(handler)) { this._cutsceneEnd(); }
  }
  skipCutscene() { if (this.cine) this.cine.skip = true; }
  _cutsceneUpdate(rawDt) {
    const g = this.game, c = this.cine, hud = g.hud;
    if (!c) return false;
    c.t += rawDt;
    // teleport under fade
    if (c.tele && !c.tele.done) {
      c.fade = Math.min(1, c.fade + rawDt / 0.35);
      hud?.setFade?.(c.fade);
      if (c.fade >= 1) { this.teleportPlayer(c.tele.pos, c.tele.yaw); c.tele.done = true; c.t = 0; }
      return true;
    } else if (c.tele && c.fade > 0 && !c.skip) {
      c.fade = Math.max(0, c.fade - rawDt / 0.5);
      hud?.setFade?.(c.fade);
    }
    // camera
    const cam = g.camera;
    const u = clamp(c.t / c.dur, 0, 1);
    if (c.orbit) {
      const o = c.orbit, a = o.a0 + c.t * 0.35;
      cam.position.set(o.center.x + Math.sin(a) * o.radius, o.center.y + o.height, o.center.z + Math.cos(a) * o.radius);
      _look.set(o.center.x, o.center.y + 1.8, o.center.z);
      cam.lookAt(_look);
    } else if (c.from) {
      cam.position.lerpVectors(c.from, c.to, smooth(u));
      _look.copy(c.look); _look.y += 2;
      cam.lookAt(_look);
    }
    // dialogue (blocking)
    const d = this.dlg;
    if (c.li < 0 || (c.lt -= rawDt) <= 0) {
      c.li++;
      if (c.li < c.lines.length) {
        const l = c.lines[c.li];
        c.lt = this._lineTime(l);
        const sp = SPEAKERS[l.who] ?? { name: l.who, color: '#fff' };
        hud?.showSubtitle?.(sp.name, l.text, sp.color);
      } else { c.lt = 0; hud?.hideSubtitle?.(); }
    }
    const input = g.input;
    if (c.t > 0.4 && (this._enter || input.pressed('jump') || input.pressed('interact'))) c.skip = true;
    const linesDone = c.li >= c.lines.length;
    if (c.skip || (linesDone && c.t >= c.dur)) return false;
    return true;
  }
  _cutsceneEnd() {
    const c = this.cine; this.cine = null;
    const hud = this.game.hud;
    hud?.setLetterbox?.(false); hud?.hideSubtitle?.(); hud?.setFade?.(0);
    this._enter = false;
    if (c?.tele && !c.tele.done) this.teleportPlayer(c.tele.pos, c.tele.yaw);
    c?.onEnd?.();
  }

  // ====================================================================== lifecycle
  start(id) {
    const g = this.game;
    this.stop();
    const m = this.find(id);
    if (!m) return;
    const resume = this._resume; this._resume = null;
    this.active = m;
    this.run = { retries: resume?.retries ?? 0, checkpoint: null, hero: g.player?.id };
    this.mem = {}; this.time = 0; this.phase = 'playing'; this.stepIdx = -1; this.step = null;
    this.dlg = { queue: [], cur: null, t: 0, gap: 0 };
    g.enemies.mode = 'campaign'; g.enemies.objectiveActive = false; g.enemies.running = true;
    g.hud?.hideBoss?.();

    // place the hero at the mission start
    const sp = resume?.pos ?? this.resolve(m.start);
    const face = m.face ? this.resolve(m.face) : this.resolve(m.steps[0]?.at ?? m.start);
    const yaw = Math.atan2(face.x - sp.x, face.z - sp.z);
    g.player.pos.set(sp.x, sp.y + 0.1, sp.z); g.player.vel.set(0, 0, 0); g.player.yaw = yaw;
    g.cam.recenter(yaw);

    if (!resume) {
      g.hud?.showBanner?.(m.chapter.toUpperCase(), m.title.toUpperCase(), 3600);
      g.audio?.music?.('roam');
    } else {
      g.hud?.showBanner?.('CHECKPOINT', m.title.toUpperCase(), 2200);
    }
    this._pending = resume?.step ?? 0;      // game.begin() flips state to 'playing' after start(): begin on the first update
  }

  stop() {
    const g = this.game;
    if (this.step) { try { this.step.end(); } catch (e) { console.error(e); } }
    if (this.cine && g.state === 'overlay') { this.cine = null; g.overlay = null; }
    this.cine = null;
    this.step = null; this.active = null; this.phase = 'idle'; this.stepIdx = -1; this.mem = {}; this._pending = null;
    g.enemies.objectiveActive = false;
    g.hud?.objective?.('');
    g.hud?.setObjectiveTag?.('OBJECTIVE');
    g.hud?.setTimer?.(null); g.hud?.setAllyBar?.(null); g.hud?.hideSubtitle?.(); g.hud?.setLetterbox?.(false); g.hud?.setFade?.(0);
    g.hud?.hideBoss?.();
    this.dlg = { queue: [], cur: null, t: 0, gap: 0 };
  }

  _beginStep(i) {
    const m = this.active, g = this.game;
    if (this.step) { try { this.step.end(); } catch (e) { console.error(e); } this.step = null; }
    g.hud?.setTimer?.(null); g.hud?.setAllyBar?.(null);
    if (i >= m.steps.length) { this.complete(); return; }
    this.stepIdx = i;
    const def = m.steps[i];
    const Cls = STEP_TYPES[def.type];
    if (!Cls) { console.warn('[campaign] unknown step type', def.type); this._beginStep(i + 1); return; }
    // checkpoint = the start of every non-cutscene step
    if (def.type !== 'cutscene' && def.type !== 'talk') this.run.checkpoint = { step: i, pos: g.player.pos.clone() };
    this.step = new Cls(this, def, i);
    this.step.start();
  }

  update(dt) {
    if (this.phase === 'idle' || !this.active) return;
    const g = this.game;
    if (this.phase === 'ending') {
      this.tickDialogue(dt);
      this._endT -= dt;
      if (this._endT <= 0) this._showResult();
      return;
    }
    if (this.phase !== 'playing') return;
    if (this._pending !== null && this._pending !== undefined) { const i = this._pending; this._pending = null; this._beginStep(i); }
    this.time += dt;
    this.tickDialogue(dt);
    const s = this.step;
    if (s) {
      s.update(dt);
      if (this.phase !== 'playing') return;      // the step may have failed the mission
      if (s.done && this.step === s) this._beginStep(this.stepIdx + 1);
    }
    if (this.active?.burn) this._burn(dt);
  }

  _burn(dt) {
    this._burnT -= dt;
    if (this._burnT > 0) return;
    this._burnT = 2.2 + Math.random() * 2.5;
    const p = this.game.player.pos, a = Math.random() * 6.28, r = 50 + Math.random() * 90;
    _v.set(p.x + Math.cos(a) * r, 0.3, p.z + Math.sin(a) * r);
    this.game.fx?.explosion?.(_v, 3.2, 0xff5a20);
    this.game.fx?.smoke?.(_v, 3, 3, null, 0.05);
  }

  // ====================================================================== end states
  complete() {
    if (this.phase !== 'playing') return;
    const g = this.game, m = this.active;
    this.phase = 'ending'; this._endT = 2.6;
    const stats = { ...(g.enemies.stats ?? {}) };
    if (this.step) { try { this.step.end(); } catch (e) { console.error(e); } this.step = null; }
    g.enemies.objectiveActive = false;
    g.enemies.reset?.();          // clears leftovers
    g.enemies.mode = 'campaign';
    g.hud?.hideBoss?.(); g.hud?.objective?.(''); g.hud?.setTimer?.(null); g.hud?.setAllyBar?.(null);
    g.hud?.showBanner?.('MISSION COMPLETE', m.title.toUpperCase(), 2800);
    g.audio?.music?.('victory');
    this.dlg.queue.length = 0;
    this.say(m.outro ?? []);
    // result
    const dmg = stats.damageTaken || 0;
    const timeOk = this.time <= m.par;
    const noFail = this.run.retries === 0;
    const lowDmg = dmg <= m.dmgLimit;
    const flags = [
      { label: 'Mission complete', ok: true },
      { label: `Finish in under ${Math.floor(m.par / 60)}:${String(m.par % 60).padStart(2, '0')}`, ok: timeOk },
      { label: `No retries and under ${m.dmgLimit} damage taken`, ok: noFail && lowDmg },
    ];
    const stars = flags.filter((f) => f.ok).length;
    const prev = this.progress.done[m.id];
    const newBest = !prev || this.time < prev.best;
    this.progress.done[m.id] = { stars: Math.max(prev?.stars ?? 0, stars), best: prev ? Math.min(prev.best, this.time) : this.time };
    const hadNext = m.id + 1 < this.missions.length;
    if (hadNext) this.progress.unlocked = Math.max(this.progress.unlocked, m.id + 1);
    const reward = Math.round(m.reward * (prev ? 0.5 : 1));
    this.progress.cash = (this.progress.cash || 0) + reward;
    this.save();
    g.economy.add(reward, g.player.pos);
    this.result = {
      mission: m, stars, flags, time: this.time, par: m.par, cash: reward, replay: !!prev, damage: Math.round(dmg),
      kills: stats.kills || 0, best: this.progress.done[m.id].best, newBest,
      next: hadNext ? this.missions[m.id + 1] : null, finale: !hadNext, totalStars: this.totalStars,
    };
  }

  _showResult() {
    const g = this.game;
    this.phase = 'over';
    g.state = 'gameover';
    g.input.exitPointerLock();
    g.hud?.showMissionComplete?.(this.result);
  }

  /** All heroes down (called by main) or an objective failed. */
  onFail(reason = 'Mission failed') {
    const g = this.game;
    if (this.phase !== 'playing' || !this.active) return;
    this.phase = 'over';
    this.run.retries++;
    this.clearDialogue();
    g.enemies.objectiveActive = false;
    g.state = 'gameover';
    g.input.exitPointerLock();
    g.hud?.hideBoss?.(); g.hud?.setTimer?.(null);
    g.audio?.music?.(null);
    g.hud?.showMissionFailed?.({ mission: this.active, reason, step: this.stepIdx, hasCheckpoint: !!this.run.checkpoint });
  }
  fail(reason) { this.onFail(reason); }

  retryCheckpoint() {
    const g = this.game, m = this.active, cp = this.run?.checkpoint;
    if (!m) return;
    this._resume = cp ? { step: cp.step, pos: cp.pos.clone(), retries: this.run.retries } : { retries: this.run.retries };
    const hero = g.player?.id ?? 'spiderman';
    g.hud?.hideMenus?.();
    g.beginMission(m.id, hero);
  }
  restart() {
    const g = this.game, m = this.active;
    if (!m) return;
    this._resume = null;
    g.hud?.hideMenus?.();
    g.beginMission(m.id, g.player?.id ?? 'spiderman');
  }

  /** Back to the chapter list. */
  abandon() { this.game.hud?.abandonMission?.(); }

  // ====================================================================== debug
  debugSkip() {
    if (this.phase !== 'playing' || !this.active) return false;
    if (this.cine) { this.cine.skip = true; return true; }
    const s = this.step;
    if (!s) return false;
    s.skip();
    return true;
  }
  get current() { return this.active; }
  get objective() { return this.step?.def ?? null; }
}
