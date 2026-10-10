// Generic, data-driven objective runners for the campaign. Each step type is a small class:
//   new Step(campaign, def, index) → start() / update(dt) / end(), and `done` flips to true when complete.
//   skip() completes the step immediately (used by Campaign.debugSkip()).
// Types: cutscene talk tutorial goto defeat survive defend collect chase boss.
// Nothing here ever requires a specific hero.
import * as THREE from 'three';
import { ENEMY_KINDS } from '../enemies/index.js';
import { avenueX, streetZ, L as CITY } from '../world/city.js';

const _v = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hypot2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------------------------------- places
const nearestNode = (x, z) => [clamp(Math.round((x + 400) / 100), 0, 9), clamp(Math.round((z + 595) / 70), 0, 17)];
const PLACES = {
  plaza: () => new THREE.Vector3(avenueX(5), 0, streetZ(5)),                                    // Times-Square-style billboard block
  parkC: (g) => (g.world?.landmarks?.['Central Park'] ?? new THREE.Vector3(100, 0, 0)).clone().setY(0),
  depot: () => new THREE.Vector3(avenueX(4), 0, streetZ(12)),
  towerBase: (g) => {
    const t = g.world?.landmarks?.['Avengers Tower'];
    const [a, s] = t ? nearestNode(t.x, t.z) : [4, 5];
    return new THREE.Vector3(avenueX(a), 0, streetZ(s));
  },
  deckStart: () => new THREE.Vector3(-448, 24.05, 35),                                           // bridge deck, inside the world bounds
  deckC: () => new THREE.Vector3(-492, 24.05, 35),
  spawn: (g) => (g.world?.spawnPoint?.pos ?? new THREE.Vector3()).clone().setY(0),
};
const KEEP_Y = new Set(['deckStart', 'deckC']);

/** Resolve a place spec (see missions.js) to a fresh Vector3 (y snapped to the ground unless the spec fixes it). */
export function resolvePlace(c, spec) {
  const g = c.game;
  if (typeof spec === 'function') spec = spec(c);
  if (spec?.isVector3) return spec.clone();
  if (typeof spec === 'string') spec = { place: spec };
  spec = spec || {};
  const p = new THREE.Vector3();
  let keepY = false;
  if (spec.place) { p.copy((PLACES[spec.place] ?? PLACES.plaza)(g, c)); keepY = KEEP_Y.has(spec.place); }
  else if (spec.node) p.set(avenueX(spec.node[0]), 0, streetZ(spec.node[1]));
  else if (spec.rel === 'player') {
    const pl = g.player?.pos ?? p, a = spec.ang ?? Math.random() * 6.28, d = spec.dist ?? 20;
    p.set(pl.x + Math.sin(a) * d, pl.y, pl.z + Math.cos(a) * d);
  } else if (spec.shop) {
    const shops = g.world?.shops ?? g.weapons?.shops ?? [];
    const pl = g.player?.pos ?? p;
    let best = null, bd = Infinity;
    for (const s of shops) { const d = hypot2(s.pos, pl); if (d < bd) { bd = d; best = s; } }
    if (best) p.copy(best.pos); else p.set(pl.x + 40, 0, pl.z);
  } else if (spec.van) {
    p.copy(c.mem.vanPos ?? PLACES.depot(g));
  }
  p.x += spec.dx || 0; p.z += spec.dz || 0;
  if (spec.y !== undefined) p.y = spec.y;
  else if (!keepY && !spec.shop) p.y = g.physics.heightAt(p.x, p.z, spec.maxY ?? 4);
  else if (spec.shop) p.y = g.physics.heightAt(p.x, p.z, 4);
  return p;
}

/** A walkable position in the ring r0..r1 around `center` (avoids building interiors, the river and the sky). */
export function groundPoint(c, center, r0, r1, out = new THREE.Vector3()) {
  const phys = c.game.physics, b = c.game.world?.bounds;
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2, r = rnd(r0, r1);
    let x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    if (b) { x = clamp(x, b.minX + 6, b.maxX - 6); z = clamp(z, b.minZ + 6, b.maxZ - 6); }
    const y = phys.heightAt(x, z, center.y + 2.5);
    if (Math.abs(y - center.y) > 3.2) continue;
    if (x < CITY.RIVER_X + 10 && y < 5) continue;
    _v.set(x, y + 0.9, z);
    if (phys.inside(_v)) continue;
    return out.set(x, y, z);
  }
  const y = phys.heightAt(center.x + r0, center.z, center.y + 2.5);
  return out.set(center.x + r0, y, center.z);
}

/** A rooftop point within maxR of center (never inside the park rectangle). */
export function rooftopPoint(c, center, maxR, minY = 8, maxY = 70) {
  const w = c.game.world;
  if (!w?.randomRooftopPoint) return null;
  for (let i = 0; i < 90; i++) {
    const p = w.randomRooftopPoint();
    if (!p || p.y < minY || p.y > maxY) continue;
    if (Math.hypot(p.x - center.x, p.z - center.z) > maxR) continue;
    if (Math.hypot(p.x - c.game.player.pos.x, p.z - c.game.player.pos.z) < 22) continue;
    return p;
  }
  return null;
}

const BUILTIN = new Set(['goon', 'hunter', 'venom']);
export function pickKind(spec) {
  if (Array.isArray(spec)) { for (const k of spec) if (ENEMY_KINDS.has(k) || BUILTIN.has(k)) return k; return spec[spec.length - 1]; }
  return spec;
}

// ---------------------------------------------------------------------------------------------------- visuals
let _beamGeo = null;
export function makeBeacon(color = 0xffe58a, radius = 3, height = 70) {
  const grp = new THREE.Group();
  _beamGeo ??= new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  const beam = new THREE.Mesh(_beamGeo, mat);
  beam.scale.set(radius, height, radius); beam.position.y = height / 2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius * 1.05, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
  grp.add(beam, ring);
  grp.userData.update = (t) => { mat.opacity = 0.18 + Math.sin(t * 3) * 0.06; ring.scale.setScalar(1 + Math.sin(t * 2.5) * 0.04); };
  grp.userData.dispose = () => { ring.geometry.dispose(); ring.material.dispose(); mat.dispose(); };
  return grp;
}

let _orbGeo = null;
function makeSample(color) {
  const grp = new THREE.Group();
  _orbGeo ??= new THREE.OctahedronGeometry(0.55, 0);
  const core = new THREE.Mesh(_orbGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  core.position.y = 1.3;
  _beamGeo ??= new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  const beam = new THREE.Mesh(_beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  beam.scale.set(0.9, 40, 0.9); beam.position.y = 20;
  grp.add(core, beam);
  grp.userData.core = core;
  grp.userData.dispose = () => { core.material.dispose(); beam.material.dispose(); };
  return grp;
}

// ---------------------------------------------------------------------------------------------------- base
class Step {
  constructor(c, def, index) {
    this.c = c; this.g = c.game; this.def = def; this.index = index;
    this.done = false; this.t = 0; this.tracked = []; this.visuals = [];
  }
  start() {}
  update() {}
  end() { this.cleanupVisuals(); }
  skip() { this.killTracked(true); this.done = true; }

  get pl() { return this.g.vehicles?.driving?.pos ?? this.g.player.pos; }
  track(e) { if (e) this.tracked.push(e); return e; }
  aliveTracked() { let n = 0; for (const e of this.tracked) if (e.alive) n++; return n; }
  killTracked(includeBoss = false) {
    for (const e of this.tracked) {
      if (!e.alive || (e.isBoss && !includeBoss)) continue;
      e.invuln = 0; e.takeDamage(1e9, {}); if (e.alive) e.die?.({});
    }
  }
  addVisual(obj3d) { this.g.scene.add(obj3d); this.visuals.push(obj3d); return obj3d; }
  cleanupVisuals() {
    for (const o of this.visuals) { o.parent?.remove(o); o.userData.dispose?.(); }
    this.visuals.length = 0;
  }
  animVisuals(dt) { for (const o of this.visuals) o.userData.update?.(this.t); }
  /** Spawn one enemy via the campaign (caps the global alive count). */
  spawnEnemy(kindSpec, pos, opts = {}) {
    const e = this.c.spawn(kindSpec, pos, opts);
    if (e) { e.spawnT = this.t; this.track(e); }
    return e;
  }
  /** Pull enemies that are stuck on unreachable roofs / far away / out of the world next to the player. */
  recoverStragglers(dt, rooftopTimeout = 38) {
    const pl = this.pl;
    for (const e of this.tracked) {
      if (!e.alive || e.isBoss) continue;
      const age = this.t - (e.spawnT ?? 0);
      const far = hypot2(e.pos, pl) > 230;
      const fell = e.pos.y < -4;
      const roofed = rooftopTimeout > 0 && e.onRoof && age > rooftopTimeout;
      if (far) e.farT = (e.farT || 0) + dt; else e.farT = 0;
      if (fell || roofed || (e.farT > 14)) {
        groundPoint(this.c, pl, 16, 28, _v);
        e.pos.copy(_v); e.vel.set(0, 0, 0); e.onRoof = false; e.farT = 0; e.invuln = 0.4;
        this.g.fx?.ring?.(_v.clone().setY(_v.y + 0.15), 2.2, 0x7a2bd0, 0.5);
      }
    }
  }
  text(t, progress) { this.c.setObjective(t, progress); }
}

// ---------------------------------------------------------------------------------------------------- cutscene / talk
class CutsceneStep extends Step {
  start() {
    const c = this.c, d = this.def;
    this.text(d.text ?? '');
    c.setWaypoint(null);
    if (d.reveal === 'van') c.prepareChase(this.g, d.at ?? 'depot');
    c.playCutscene({ lines: d.lines, cam: d.cam, teleport: d.teleport, teleportYaw: d.teleportYaw, onEnd: () => { this.done = true; } });
  }
  skip() { this.c.skipCutscene(); this.done = true; }
}

class TalkStep extends Step {
  start() { this.text('Listen to the radio'); this.c.setWaypoint(null); this.c.say(this.def.lines ?? []); }
  update() { if (this.c.dialogueIdle()) this.done = true; }
  skip() { this.c.clearDialogue(); this.done = true; }
}

// ---------------------------------------------------------------------------------------------------- goto
class GotoStep extends Step {
  start() {
    const d = this.def;
    this.at = this.c.resolve(d.at);
    this.radius = d.radius ?? 14;
    this.c.setWaypoint(this.at);
    this.addVisual(makeBeacon(0xffe58a, Math.min(this.radius * 0.5, 7), 90)).position.copy(this.at);
    this.text(d.text ?? 'Go to the marker');
    if (d.lines) this.c.say(d.lines);
  }
  update(dt) {
    this.animVisuals(dt);
    const p = this.pl;
    if (hypot2(p, this.at) < this.radius && Math.abs(p.y - this.at.y) < (this.def.dy ?? 40)) this.done = true;
  }
}

// ---------------------------------------------------------------------------------------------------- tutorial
class TutorialStep extends Step {
  start() {
    const d = this.def, g = this.g;
    this.tasks = d.tasks.map((t) => ({ ...t, k: 0, done: false }));
    this.ti = 0;
    this.at = d.at ? this.c.resolve(d.at) : null;
    this.last = this.pl.clone();
    this.promptT = 0;
    this.flag = { wheel: false, car: false };
    this.unsub = [
      g.events.on('hero:switch', () => { this.flag.wheel = true; }),
      g.events.on('vehicle:enter', () => { this.flag.car = true; }),
    ];
    this.prevGround = true; this.prevCombo = g.player.combo || 0;
    if (d.giveCash && g.economy.cash < d.giveCash) g.economy.add(d.giveCash - g.economy.cash, g.player.pos);
    if (this.at) this.addVisual(makeBeacon(0x66d0ff, 3.5, 70)).position.copy(this.at);
    if (d.lines) this.c.say(d.lines);
    this.refresh();
  }
  end() { for (const u of this.unsub ?? []) u(); super.end(); }
  skip() { this.done = true; }
  get task() { return this.tasks[this.ti]; }
  refresh() {
    const t = this.task; if (!t) return;
    const n = t.n ? ` (${Math.min(t.k, t.n)}/${t.n})` : '';
    this.text(`${t.text}${n}`, this.ti / this.tasks.length);
    this.promptT = 0;
  }
  waypointFor(t) {
    if (this.at) return this.at;
    if (t.near === 'car') {
      let best = null, bd = 170;
      const p = this.pl;
      for (const v of this.g.vehicles?.list ?? []) {
        if (!v.active || v.wrecked || v.isPolice || v.held || !v.group.visible) continue;
        const d = hypot2(v.pos, p);
        if (d < bd) { bd = d; best = v.pos; }
      }
      return best;
    }
    return null;
  }
  update(dt) {
    this.animVisuals(dt);
    const g = this.g, inp = g.input, pl = g.player, t = this.task;
    if (!t) { this.done = true; return; }
    // progress
    const p = this.pl;
    switch (t.check) {
      case 'move': t.k += Math.hypot(p.x - this.last.x, p.z - this.last.z); break;
      case 'jump': {
        const air = !pl.onGround;
        if (inp.pressed('jump') || (this.prevGround && air && pl.vel.y > 3)) t.k++;
        this.prevGround = !air; break;
      }
      case 'attack': { const cb = pl.combo || 0; if (inp.pressed('attack') || cb > this.prevCombo) t.k++; this.prevCombo = cb; break; }
      case 'dodge': if (inp.pressed('dodge') || pl.anim?.state === 'dodge' || pl.anim?.state === 'dash') t.k = t.n ?? 1; break;
      case 'wheel': if (this.flag.wheel) t.k = 1; break;
      case 'car': if (this.flag.car || g.vehicles?.driving) t.k = 1; break;
      case 'gun': if ((g.weapons?.owned?.size ?? 0) > 0) t.k = 1; break;
      default: break;
    }
    this.last.copy(p);
    if (t.k >= (t.n ?? 1)) {
      t.done = true; this.ti++;
      g.audio?.play?.('pickup');
      if (this.ti >= this.tasks.length) { this.done = true; return; }
      this.refresh();
    } else if (t.n && t.check !== 'move') this.refresh();
    const nt = this.task;
    if (nt) {
      const wp = this.waypointFor(nt);
      this.c.setWaypoint(wp);
      this.promptT -= dt;
      if (this.promptT <= 0) {
        this.promptT = 2.2;
        const [action, txt] = nt.prompt ?? [null, nt.text];
        g.hud?.prompt?.(action, txt);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------- defeat
class DefeatStep extends Step {
  start() {
    const d = this.def;
    this.groups = d.groups.map((gr) => ({ ...gr, n: gr.n, spawned: 0, delay: gr.delay ?? 0 }));
    this.total = this.groups.reduce((a, gr) => a + gr.n, 0);
    this.spawnT = 0;
    this.centerWp = this.c.resolve(this.groups[0].at);
    this.hintN = 0; this.hintT = 8;
    this.text(`${d.text ?? 'Defeat the enemies'} (0/${this.total})`, 0);
    this.c.setWaypoint(this.centerWp);
    if (d.lines) this.c.say(d.lines);
  }
  update(dt) {
    this.t += dt;
    this.spawnT -= dt;
    const d = this.def;
    if (this.spawnT <= 0) {
      for (const gr of this.groups) {
        if (gr.spawned >= gr.n || this.t < gr.delay) continue;
        if (this.c.aliveCount() >= this.c.maxAlive) break;
        const center = this.c.resolve(gr.at);
        let pos = null, roof = false;
        if (gr.rooftop) {
          const rp = rooftopPoint(this.c, center, gr.rooftopR ?? 90);
          if (rp) { pos = rp; roof = true; }
        }
        pos ??= groundPoint(this.c, center, gr.r?.[0] ?? 8, gr.r?.[1] ?? 18);
        const e = this.spawnEnemy(gr.kind, pos, { isWave: false, rooftop: roof, hpScale: gr.hpScale });
        if (e) e.onRoof = roof;
        gr.spawned++;
        this.spawnT = 0.28;
        break;
      }
    }
    const spawned = this.groups.reduce((a, gr) => a + gr.spawned, 0);
    const alive = this.aliveTracked();
    const killed = spawned - alive;
    this.text(`${d.text ?? 'Defeat the enemies'} (${killed}/${this.total})`, killed / this.total);
    // waypoint: nearest alive enemy
    let best = null, bd = Infinity;
    const pl = this.pl;
    for (const e of this.tracked) if (e.alive) { const dd = hypot2(e.pos, pl); if (dd < bd) { bd = dd; best = e; } }
    this.c.setWaypoint(best ? best.pos : this.centerWp);
    this.recoverStragglers(dt, d.rooftopTimeout ?? 38);
    if (d.hint && this.hintN < 2) { this.hintT -= dt; if (this.hintT <= 0 && alive) { this.hintT = 14; this.hintN++; this.g.hud?.prompt?.(d.hint[0], d.hint[1]); } }
    if (spawned >= this.total && alive === 0) this.done = true;
  }
}

// ---------------------------------------------------------------------------------------------------- survive
class SurviveStep extends Step {
  start() {
    const d = this.def;
    this.left = d.seconds;
    this.spawnT = 1.5;
    this.text(d.text ?? 'Survive', 0);
    this.c.setWaypoint(null);
    if (d.lines) this.c.say(d.lines);
  }
  update(dt) {
    this.t += dt; this.left -= dt;
    const sp = this.def.spawn;
    if (sp) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.aliveTracked() < sp.max && this.c.aliveCount() < this.c.maxAlive) {
        this.spawnT = sp.every;
        const pos = groundPoint(this.c, this.pl, sp.r?.[0] ?? 16, sp.r?.[1] ?? 28);
        this.spawnEnemy(sp.kind, pos, { isWave: false });
      }
    }
    this.recoverStragglers(dt, 0);
    this.text(`${this.def.text ?? 'Survive'}`, 1 - this.left / this.def.seconds);
    this.c.setTimer(fmtClock(this.left));
    if (this.left <= 0) this.done = true;
  }
  end() { this.c.setTimer(null); this.killTracked(); super.end(); }
  skip() { this.c.setTimer(null); super.skip(); }
}

// ---------------------------------------------------------------------------------------------------- defend
class DefendStep extends Step {
  start() {
    const d = this.def;
    this.at = this.c.resolve(d.at);
    this.hp = d.hp; this.maxHp = d.hp; this.left = d.seconds; this.spawnT = 2;
    this.c.setWaypoint(this.at);
    const col = d.color ?? 0x66d0ff;
    const b = this.addVisual(makeBeacon(col, 4, 60)); b.position.copy(this.at);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.8), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    crate.position.y = 0.8; b.add(crate);
    const prevDispose = b.userData.dispose;
    b.userData.dispose = () => { crate.geometry.dispose(); crate.material.dispose(); prevDispose(); };
    this.crate = crate;
    this.text(d.text ?? 'Defend the objective', 0);
    this.g.hud?.setAllyBar?.(d.label ?? 'OBJECTIVE', 1, '#' + col.toString(16).padStart(6, '0'));
    if (d.lines) this.c.say(d.lines);
    this.warned = false; this.sparkT = 0;
  }
  update(dt) {
    this.t += dt; this.left -= dt;
    this.animVisuals(dt);
    this.crate.rotation.y += dt;
    const sp = this.def.spawn;
    if (sp) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.aliveTracked() < sp.max && this.c.aliveCount() < this.c.maxAlive) {
        this.spawnT = sp.every;
        const pos = groundPoint(this.c, this.at, sp.r?.[0] ?? 14, sp.r?.[1] ?? 26);
        this.spawnEnemy(sp.kind, pos, { isWave: false });
      }
    }
    // enemies standing next to the objective chew through it; otherwise it slowly recovers
    let n = 0;
    for (const e of this.tracked) if (e.alive && hypot2(e.pos, this.at) < 9) n++;
    if (n > 0) {
      this.hp -= Math.min(n, 3) * 1.7 * dt;
      this.sparkT -= dt;
      if (this.sparkT <= 0) { this.sparkT = 0.35; this.g.fx?.burst?.(_v.set(this.at.x, this.at.y + 1, this.at.z), 0xff6040, 8, 4, 0.4, 0.2); }
      if (!this.warned) { this.warned = true; this.g.hud?.toast?.('Enemies are attacking the objective!'); }
    } else { this.hp = Math.min(this.maxHp, this.hp + 2 * dt); this.warned = false; }
    const frac = clamp(this.hp / this.maxHp, 0, 1);
    this.g.hud?.setAllyBar?.(this.def.label ?? 'OBJECTIVE', frac);
    this.text(this.def.text ?? 'Defend the objective', 1 - this.left / this.def.seconds);
    this.c.setTimer(fmtClock(this.left));
    this.recoverStragglers(dt, 0);
    if (this.hp <= 0) { this.c.fail(`${this.def.label ?? 'The objective'} was destroyed`); return; }
    if (this.left <= 0) this.done = true;
  }
  end() { this.c.setTimer(null); this.g.hud?.setAllyBar?.(null); this.killTracked(); super.end(); }
  skip() { super.skip(); }
}

// ---------------------------------------------------------------------------------------------------- collect
class CollectStep extends Step {
  start() {
    const d = this.def;
    this.samples = [];
    const center = this.c.resolve(d.at);
    const pts = [];
    for (let i = 0; i < d.n; i++) {
      let p = null;
      for (let tr = 0; tr < 12; tr++) {
        const q = groundPoint(this.c, center, d.r?.[0] ?? 15, d.r?.[1] ?? 60);
        if (pts.every((o) => hypot2(o, q) > 18)) { p = q.clone(); break; }
      }
      pts.push(p ?? groundPoint(this.c, center, d.r?.[0] ?? 15, d.r?.[1] ?? 60).clone());
    }
    for (const p of pts) {
      const s = makeSample(d.color ?? 0xb070ff);
      s.position.copy(p);
      this.addVisual(s);
      this.samples.push({ obj: s, taken: false });
    }
    this.got = 0;
    this.spawnT = 6;
    this.text(`${d.text ?? 'Collect'} (0/${d.n})`, 0);
    if (d.lines) this.c.say(d.lines);
  }
  update(dt) {
    this.t += dt;
    const d = this.def, pl = this.pl;
    let best = null, bd = Infinity;
    for (const s of this.samples) {
      if (s.taken) continue;
      s.obj.userData.core.rotation.y += dt * 2.5;
      s.obj.userData.core.position.y = 1.3 + Math.sin(this.t * 3 + s.obj.position.x) * 0.2;
      const dd = hypot2(s.obj.position, pl);
      if (dd < bd) { bd = dd; best = s; }
      if (dd < 2.8 && Math.abs(s.obj.position.y - pl.y) < 5) {
        s.taken = true; s.obj.visible = false; this.got++;
        this.g.audio?.play?.('pickup');
        this.g.fx?.burst?.(_v.set(s.obj.position.x, s.obj.position.y + 1.2, s.obj.position.z), d.color ?? 0xb070ff, 22, 6, 0.6, 0.3);
        this.g.hud?.toast?.(`${this.got}/${d.n} collected`);
      }
    }
    this.c.setWaypoint(best ? best.obj.position : null);
    this.text(`${d.text ?? 'Collect'} (${this.got}/${d.n})`, this.got / d.n);
    const gu = d.guards;
    if (gu) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.aliveTracked() < gu.max && this.c.aliveCount() < this.c.maxAlive) {
        this.spawnT = gu.every;
        const e = this.spawnEnemy(gu.kind, groundPoint(this.c, pl, gu.r?.[0] ?? 22, gu.r?.[1] ?? 34), { isWave: false });
        if (e) e.onRoof = false;
      }
      this.recoverStragglers(dt, 0);
    }
    if (this.got >= d.n) this.done = true;
  }
  end() { this.killTracked(); super.end(); }
}

// ---------------------------------------------------------------------------------------------------- chase (GTA-style fleeing van)
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function buildRoute(a0, s0, dir0, len = 26) {
  const route = [];
  let A = a0, S = s0, dir = dir0;
  route.push([A, S]);
  for (let i = 0; i < len; i++) {
    const opts = [];
    for (let k = 0; k < 4; k++) {
      if (k === (dir + 2) % 4) continue;
      const a = A + DIRS[k][0], s = S + DIRS[k][1];
      if (a < 1 || a > 8 || s < 1 || s > 16) continue;
      opts.push(k);
    }
    if (!opts.length) { dir = (dir + 2) % 4; continue; }
    let k = opts.includes(dir) && Math.random() < 0.6 ? dir : opts[(Math.random() * opts.length) | 0];
    dir = k; A += DIRS[k][0]; S += DIRS[k][1];
    route.push([A, S]);
  }
  return route;
}

/** Create the fleeing van (re-using a traffic vehicle) and its route. Idempotent per mission run. */
export function setupChase(c, atSpec) {
  const g = c.game;
  if (c.mem.chase) return c.mem.chase;
  const veh = g.vehicles;
  const at = c.resolve(atSpec ?? 'depot');
  // pick a candidate car: prefer a van far from the player's view, otherwise any inactive/idle car
  let v = null, bd = Infinity;
  for (const cand of veh.list) {
    if (cand === veh.driving || cand.reserve || cand.isPolice || cand.held || cand.thrown || cand.wrecked || cand.sinking) continue;
    const d = hypot2(cand.pos, at) - (cand.kind === 'van' ? 400 : 0);
    if (d < bd) { bd = d; v = cand; }
  }
  if (!v) return null;
  veh._releaseModel?.(v);
  v.setKind('van');
  v.hex = 0x24272e; v.color.setHex(v.hex);
  v.maxHp = 240; v.parked = false; v.reserve = false;
  const [a0, s0] = nearestNode(at.x, at.z);
  const dir0 = 2; // head north (-Z) first
  const route = buildRoute(a0, s0, dir0);
  const n0 = new THREE.Vector3(avenueX(a0), 0, streetZ(s0));
  v.place(n0.x + 4, n0.z + 22, Math.PI, 0);
  v.driver = 'mission'; v.ai = null; v.asleep = false; v.active = true; v.group.visible = true;
  v.hp = v.maxHp; v.invuln = 0.4; v.needsRelocate = false;
  v.syncGroup();
  c.mem.vanPos = v.pos.clone();
  c.mem.chase = { v, route, ri: 1, stuckT: 0, offT: 0, lastPos: v.pos.clone() };
  return c.mem.chase;
}

class ChaseStep extends Step {
  start() {
    const d = this.def, c = this.c, g = this.g;
    this.ch = setupChase(c, d.at);
    if (!this.ch) { this.done = true; return; }
    this.v = this.ch.v;
    this.stopHp = this.v.maxHp * (d.hpFrac ?? 0.3);
    this.left = d.time ?? 200;
    this.text(d.text ?? 'Stop the van', 0);
    this.jamT = 0; this.toldJam = false;
    g.hud?.setAllyBar?.('OSCORP VAN', 1, '#ff7a4d');
    if (d.lines) c.say(d.lines);
  }
  /** Put the van back on the road, on the segment it was driving, heading for the next node. */
  recover(speed = 6) {
    const ch = this.ch, v = this.v, n = ch.route.length;
    const [a, s] = ch.route[(ch.ri - 1 + n) % n], [A, S] = ch.route[ch.ri % n];
    const dx = Math.sign(A - a), dz = Math.sign(S - s);
    const heading = Math.atan2(avenueX(A) - avenueX(a), streetZ(S) - streetZ(s));
    v.place(avenueX(a) + (-dz) * 4 + dx * 10, streetZ(s) + dx * 4 + dz * 10, heading, speed);
    v.driver = 'mission'; v.hp = Math.max(v.hp, this.stopHp + 5); v.invuln = 1;
    v.syncGroup();
    ch.stuckT = 0; ch.offT = 0; ch.lastPos.copy(v.pos);
  }
  steer(dt) {
    const ch = this.ch, v = this.v;
    const pl = this.pl;
    const dist = hypot2(v.pos, pl);
    // rubber band: slows when the hero falls behind (so heroes on foot can still catch it) and waits when far away
    let want = 21;
    if (dist > 60) want = 21 * (dist >= 140 ? 0 : 1 - ((dist - 60) / 80) * 0.88);
    // advance to the next node when close
    for (let guard = 0; guard < 3; guard++) {
      const [A, S] = ch.route[ch.ri % ch.route.length];
      const d = Math.hypot(avenueX(A) - v.pos.x, streetZ(S) - v.pos.z);
      if (d < 16 + Math.min(10, Math.abs(v.speed))) { ch.ri++; if (ch.ri >= ch.route.length) { ch.route = buildRoute(A, S, 2); ch.ri = 1; } } else break;
    }
    const [A, S] = ch.route[ch.ri % ch.route.length];
    const [pA, pS] = ch.route[(ch.ri - 1 + ch.route.length) % ch.route.length];
    const dx = Math.sign(A - pA), dz = Math.sign(S - pS);
    const tx = avenueX(A) + (-dz) * 4, tz = streetZ(S) + dx * 4;
    const err = wrapPi(Math.atan2(tx - v.pos.x, tz - v.pos.z) - v.yaw);
    v.ctrl.s = clamp(-err * 1.9, -1, 1);
    const turn = Math.abs(err);
    if (turn > 0.5) want = Math.min(want, 8);
    else if (turn > 0.25) want = Math.min(want, 14);
    const sp = v.speed;
    v.ctrl.t = clamp((want - sp) * 0.35, 0, 1);
    v.ctrl.b = sp > want + 3 ? clamp((sp - want) * 0.12, 0, 0.7) : (want < 0.5 && sp > 1.5 ? 0.6 : 0);
    v.ctrl.hb = want < 0.5 && sp < 1.5;
    if (want > 3 && Math.abs(v.speed) < 1.2 && !v.wrecked) ch.stuckT += dt; else ch.stuckT = 0;
    // leaving the road grid (clipped a corner, was moved by the traffic system, hit by a car): bounce back onto the route
    const nA = clamp(Math.round((v.pos.x + 400) / 100), 0, 9), nS = clamp(Math.round((v.pos.z + 595) / 70), 0, 17);
    const onRoad = Math.abs(v.pos.x - avenueX(nA)) < 12 || Math.abs(v.pos.z - streetZ(nS)) < 9;
    ch.offT = onRoad ? 0 : ch.offT + dt;
    const jumped = Math.hypot(v.pos.x - ch.lastPos.x, v.pos.z - ch.lastPos.z) > 30;
    ch.lastPos.copy(v.pos);
    if (ch.stuckT > 2.4 || ch.offT > 1.5 || jumped) this.recover();
  }
  update(dt) {
    this.t += dt; this.left -= dt;
    const v = this.v, g = this.g, c = this.c;
    if (!v) { this.done = true; return; }
    if (v.driver !== 'mission' && !v.wrecked && v.hp > this.stopHp) v.driver = 'mission';  // someone re-assigned it (e.g. carjack): take it back
    if (!v.active) { v.active = true; v.group.visible = true; }
    c.mem.vanPos = v.pos.clone();
    c.setWaypoint(v.pos);
    const dist = hypot2(v.pos, this.pl);
    // FRIDAY jams the engine while any hero stays close
    const jam = dist < 17 && !v.wrecked;
    if (jam) { v.damage(7 * dt, 'jam'); this.jamT += dt; if (!this.toldJam) { this.toldJam = true; g.hud?.toast?.('F.R.I.D.A.Y. is jamming the van\'s engine'); } }
    if (!v.wrecked) this.steer(dt);
    const frac = clamp((v.hp - this.stopHp) / (v.maxHp - this.stopHp), 0, 1);
    g.hud?.setAllyBar?.('OSCORP VAN', frac);
    this.text(`${this.def.text ?? 'Stop the van'}${jam ? ' (jamming)' : ` (${Math.round(dist)} m)`}`, 1 - frac);
    c.setTimer(fmtClock(this.left));
    if (v.wrecked || v.hp <= this.stopHp) { this.finish(); return; }
    if (this.left <= 0) c.fail('The van got away');
  }
  finish() {
    const v = this.v, g = this.g;
    v.driver = null; v.ctrl.t = 0; v.ctrl.b = 1; v.ctrl.hb = true; v.ctrl.s = 0;
    this.c.mem.vanPos = v.pos.clone();
    g.fx?.explosion?.(_v.set(v.pos.x, v.pos.y + 1, v.pos.z), 3, 0xffa040);
    g.hud?.toast?.('The van has stopped!');
    this.done = true;
  }
  skip() { if (this.v && !this.v.wrecked) { this.v.hp = Math.min(this.v.hp, this.stopHp); this.finish(); } this.done = true; }
  end() { this.c.setTimer(null); this.g.hud?.setAllyBar?.(null); super.end(); }
}

// ---------------------------------------------------------------------------------------------------- boss
class BossStep extends Step {
  start() {
    const d = this.def, c = this.c, g = this.g;
    this.center = c.resolve(d.at);
    const pos = groundPoint(c, this.center, d.r?.[0] ?? 20, d.r?.[1] ?? 28);
    const real = ENEMY_KINDS.has(d.kind) || BUILTIN.has(d.kind);
    let kind = d.kind, hpScale = d.hpScale;
    if (!real) { kind = d.fallback ?? 'hunter'; hpScale = d.fallbackHp ?? hpScale ?? 8; }
    const e = c.spawn(kind, pos, { isWave: false, hpScale, setBoss: true });
    this.boss = e; this.track(e);
    if (e) {
      e.bossTitle = d.name ?? e.bossTitle;
      e.invuln = Math.max(e.invuln, 0.6);
      if (!e.isBoss || g.enemies.boss !== e) g.enemies.boss = e;
      e.kindRequested = d.kind;
    }
    this.phases = (d.phases ?? []).map((p) => ({ ...p, fired: false }));
    this.mT = (d.minions?.every ?? 20) * 0.6;
    this.leashT = 0;
    this.text(d.text ?? 'Defeat the boss', 0);
    c.setWaypoint(pos);
    g.audio?.music?.('boss');
    if (d.intro) c.playCutscene({ lines: d.intro, cam: { orbit: e ? e.pos : pos, radius: 15, height: 5.5, dur: 4.5 } });
  }
  update(dt) {
    this.t += dt;
    const d = this.def, c = this.c, g = this.g, e = this.boss;
    if (!e || !e.alive) { this.done = true; return; }
    const frac = e.hp / e.maxHp;
    this.text(d.text ?? 'Defeat the boss', 1 - frac);
    c.setWaypoint(e.pos);
    // phases
    for (const ph of this.phases) {
      if (ph.fired || frac > ph.below) continue;
      ph.fired = true;
      if (ph.say) c.say(ph.say);
      g.hud?.toast?.(ph.toast ?? 'The enemy is getting desperate!');
      g.cam?.shake?.(0.5);
      for (const sp of ph.spawn ?? []) {
        for (let i = 0; i < (sp.n ?? 1); i++) {
          const ent = c.spawn(sp.kind, groundPoint(c, e.pos, sp.r?.[0] ?? 12, sp.r?.[1] ?? 20), { isWave: false, hpScale: sp.hpScale, setBoss: false });
          if (ent) { ent.spawnT = this.t; ent.isBoss = false; this.track(ent); }
        }
      }
    }
    // minions
    const m = d.minions;
    if (m) {
      this.mT -= dt;
      if (this.mT <= 0) {
        this.mT = m.every;
        let n = 0; for (const x of this.tracked) if (x.alive && x !== e) n++;
        if (n < m.max && c.aliveCount() < c.maxAlive) {
          const ent = this.spawnEnemy(m.kind, groundPoint(c, e.pos, m.r?.[0] ?? 14, m.r?.[1] ?? 24), { isWave: false });
          if (ent) ent.onRoof = false;
        }
      }
      this.recoverStragglers(dt, 0);
    }
    // arena leash (bridge deck): never leave a hero stranded below / away from the fight
    if (d.arena === 'deck') {
      const pl = this.pl;
      const out = pl.y < this.center.y - 8 || hypot2(pl, this.center) > 80;
      this.leashT = out ? this.leashT + dt : 0;
      if (this.leashT > 2) {
        this.leashT = 0;
        c.teleportPlayer(PLACES.deckStart(g), -Math.PI / 2);
        g.hud?.toast?.('F.R.I.D.A.Y. dropped you back on the deck');
      }
    }
  }
  skip() { this.killTracked(true); this.done = true; }
  end() {
    this.g.hud?.hideBoss?.();
    this.g.audio?.music?.('roam');
    this.killTracked(false);
    if (this.g.enemies.boss === this.boss) this.g.enemies.boss = null;
    super.end();
  }
}

export const STEP_TYPES = {
  cutscene: CutsceneStep, talk: TalkStep, tutorial: TutorialStep, goto: GotoStep, defeat: DefeatStep,
  survive: SurviveStep, defend: DefendStep, collect: CollectStep, chase: ChaseStep, boss: BossStep,
};
