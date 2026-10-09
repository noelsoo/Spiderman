// EnemyManager: owns every enemy, the wave/encounter flow, attack tokens, health orbs and run stats.
// Contract: docs/ARCHITECTURE.md#enemies
//
// Extras:
//   objectivePos   Vector3 world marker for the HUD (valid while objectiveActive)     objectiveActive bool
//   debugStartBoss()   jump straight to the Venom fight (also debugSpawn(kind, n, dist))
//   boss           the Venom instance (or null)         phase   'idle'|'intro'|'travel'|'fight'|'between'|'prelude'|'boss'|'victory'
//   enemy.windup > 0  seconds until that enemy's attack lands (spider-sense); enemy.attacking bool
import * as THREE from 'three';
import { SymbioteGoon } from './Goon.js';
import { KravenHunter } from './Hunter.js';
import { Venom } from './Venom.js';
import { rnd } from './Enemy.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const MAX_ALIVE = 20;
const WAVES = [
  { goons: 4, hunters: 0, cap: 4, label: 'Wave 1' },
  { goons: 6, hunters: 2, cap: 6, label: 'Wave 2' },
  { goons: 8, hunters: 4, cap: 8, label: 'Wave 3' },
];
let ORB = null;

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.stats = { kills: 0, time: 0, wave: 0, maxCombo: 0, damageTaken: 0 };
    this.objectivePos = new THREE.Vector3();
    this.objectiveActive = false;
    this.tokens = { melee: new Set(), ranged: new Set() };
    this.maxTokens = { melee: 2, ranged: 2 };
    this.orbs = [];
    this.phase = 'idle'; this.timer = 0;
    this.boss = null;
    this.queue = []; this.waveTotal = 0; this.waveKilled = 0; this.waveIdx = 0;
    this.spawnT = 0;
    this.victoryT = -1;
    this.running = false;
    this._travelT = 0;
    this.zone = new THREE.Vector3();
  }

  // ===================================================================== lifecycle
  reset() {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
    for (const o of this.orbs) o.mesh.parent?.remove(o.mesh);
    this.orbs.length = 0;
    this.tokens.melee.clear(); this.tokens.ranged.clear();
    this.stats = { kills: 0, time: 0, wave: 0, maxCombo: 0, damageTaken: 0 };
    this.phase = 'idle'; this.timer = 0; this.boss = null; this.queue.length = 0;
    this.victoryT = -1; this.running = false; this.objectiveActive = false;
    this.game.combat?.reset?.();
    this.game.fx?.reset?.();
    this.game.hud?.hideBoss?.();
  }

  start() {
    this.running = true;
    this.phase = 'intro'; this.timer = 2.5; this.waveIdx = 0;
    this.stats.wave = 0;
    this.game.hud?.toast?.('Symbiote infection spreading across the city!');
    this._setObjective('Find the symbiote gang', 0);
  }

  get alive() { return this.list.filter((e) => e.alive); }
  aliveCount() { let n = 0; for (const e of this.list) if (e.alive) n++; return n; }
  aliveMinions() { let n = 0; for (const e of this.list) if (e.alive && !e.isBoss) n++; return n; }

  // ===================================================================== queries
  findTarget(origin, forward, range = 25, coneDeg = 60) {
    const cosC = Math.cos(THREE.MathUtils.degToRad(coneDeg * 0.5));
    let best = null, bs = Infinity;
    for (const e of this.list) {
      if (!e.alive || e.untargetable) continue;
      _v.subVectors(e.center, origin);
      const d = _v.length();
      if (d > range + e.radius || d < 1e-3) continue;
      const dot = (_v.x * forward.x + _v.y * forward.y + _v.z * forward.z) / d;
      if (dot < cosC) continue;
      const score = (1 - dot) * 3 + d / range;
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }
  inRadius(center, r) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      if (e.center.distanceTo(center) <= r + e.radius) out.push(e);
    }
    return out;
  }
  nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = e.center.distanceTo(pos) - e.radius;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ===================================================================== tokens
  requestToken(e, type = 'melee') {
    const set = this.tokens[type];
    if (set.has(e)) return true;
    if (set.size >= this.maxTokens[type]) return false;
    set.add(e); return true;
  }
  releaseToken(e) { this.tokens.melee.delete(e); this.tokens.ranged.delete(e); }

  // ===================================================================== spawning
  _clampBounds(p) {
    const b = this.game.world?.bounds;
    if (b) { p.x = THREE.MathUtils.clamp(p.x, b.minX + 5, b.maxX - 5); p.z = THREE.MathUtils.clamp(p.z, b.minZ + 5, b.maxZ - 5); }
    return p;
  }

  /** A walkable street-level position around `center` (r0..r1), avoiding building interiors. */
  _ringPoint(center, r0, r1, out) {
    const phys = this.game.physics;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(r0, r1);
      out.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
      this._clampBounds(out);
      const y = phys.heightAt(out.x, out.z, center.y + 2.5);
      out.y = y;
      _w.set(out.x, y + 0.9, out.z);
      if (!phys.inside(_w) && Math.abs(y - center.y) < 3) return out;
    }
    out.set(center.x + r0, center.y, center.z); this._clampBounds(out);
    out.y = phys.heightAt(out.x, out.z, center.y + 2.5);
    return out;
  }

  _pickZone(minD, maxD, out) {
    const g = this.game, pl = g.player;
    const pp = pl ? pl.pos : g.world?.spawnPoint?.pos ?? _w.set(0, 0, 0);
    const w = g.world;
    if (w?.randomStreetPoint) {
      for (let i = 0; i < 40; i++) {
        const p = w.randomStreetPoint();
        if (!p) break;
        const d = Math.hypot(p.x - pp.x, p.z - pp.z);
        if (d >= minD && d <= maxD) { out.set(p.x, p.y ?? 0, p.z); return out; }
      }
    }
    out.copy(pp); out.y = 0;
    const ang = Math.random() * Math.PI * 2, r = (minD + maxD) / 2;
    out.x += Math.cos(ang) * r; out.z += Math.sin(ang) * r;
    this._clampBounds(out);
    out.y = g.physics.heightAt(out.x, out.z, 3);
    if (g.physics.inside(_w.set(out.x, out.y + 1, out.z))) this._ringPoint(pp, minD, maxD, out);
    return out;
  }

  _rooftopPoint(center, maxR, out, minY = 6, maxY = 45, tries = 60) {
    const w = this.game.world, pl = this.game.player;
    if (w?.randomRooftopPoint) {
      for (let i = 0; i < tries; i++) {
        const p = w.randomRooftopPoint();
        if (!p) break;
        const dy = p.y - center.y;
        if (dy < minY || dy > maxY) continue;
        if (Math.hypot(p.x - center.x, p.z - center.z) <= maxR && (!pl || Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) > 12)) { out.set(p.x, p.y, p.z); return true; }
      }
    }
    return false;
  }

  spawn(kind, pos, opts = {}) {
    const wave = opts.wave ?? Math.max(1, this.stats.wave);
    let e;
    if (kind === 'hunter') e = new KravenHunter(this.game, this, wave, !!opts.rooftop);
    else if (kind === 'venom') e = new Venom(this.game, this);
    else e = new SymbioteGoon(this.game, this, wave);
    const pl = this.game.player;
    const yaw = pl ? Math.atan2(pl.pos.x - pos.x, pl.pos.z - pos.z) : 0;
    e.spawnAt(pos, yaw);
    e.isWave = !!opts.isWave;
    this.list.push(e);
    const fx = this.game.fx;
    if (kind !== 'venom') {
      _w.set(pos.x, pos.y + 0.15, pos.z);
      fx.ring(_w, 2.4, 0x7a2bd0, 0.5);
      fx.burst(_w.setY(pos.y + 0.8), 0x6a2aa8, 14, 4, 0.6, 0.3);
      fx.smoke(_w, 1, 1, null, 0.04);
    }
    return e;
  }

  /** Called by Venom's summon: spawn a goon around `pos`. */
  spawnMinion(pos, radius, angle) {
    if (this.aliveCount() >= MAX_ALIVE) return null;
    _v.set(pos.x + Math.cos(angle) * radius, pos.y, pos.z + Math.sin(angle) * radius);
    this._ringPoint(_v, 0.5, 2, _v);
    return this.spawn('goon', _v, { wave: Math.max(3, this.stats.wave) });
  }

  // ===================================================================== waves
  _setObjective(text, progress) {
    this.game.hud?.objective?.(text, progress);
  }

  _beginWave(idx) {
    const def = WAVES[idx];
    this.waveIdx = idx;
    this.stats.wave = idx + 1;
    this.queue.length = 0;
    for (let i = 0; i < def.goons; i++) this.queue.push('goon');
    for (let i = 0; i < def.hunters; i++) this.queue.splice(Math.floor(Math.random() * (this.queue.length + 1)), 0, 'hunter');
    this.waveTotal = this.queue.length; this.waveKilled = 0;
    const pl = this.game.player;
    if (idx === 0) {
      this._pickZone(25, 45, this.zone);
      this.phase = 'fight';
      this.game.hud?.toast?.(`${def.label}: symbiote goons!`);
    } else {
      this._pickZone(90 + idx * 25, 190 + idx * 40, this.zone);
      this.phase = 'travel'; this._travelT = 0;
      this.game.hud?.toast?.(`${def.label}: head to the marker`);
    }
    this.objectivePos.copy(this.zone); this.objectiveActive = true;
    this._refreshObjective();
    this.spawnT = 0;
  }

  _refreshObjective() {
    if (this.phase === 'travel') this._setObjective(`Reach the symbiote hotspot (${Math.round(this._distToZone())} m)`, 0);
    else this._setObjective(`Defeat the symbiote gang (${this.waveKilled}/${this.waveTotal})`, this.waveTotal ? this.waveKilled / this.waveTotal : 0);
  }
  _distToZone() { const p = this.game.player?.pos; return p ? Math.hypot(p.x - this.zone.x, p.z - this.zone.z) : 0; }

  _spawnNext() {
    const def = WAVES[this.waveIdx];
    const kind = this.queue.shift();
    const center = this.phase === 'fight' && this.waveIdx === 0 ? this.zone : this.zone;
    const pos = _v;
    let rooftop = false;
    if (kind === 'hunter') {
      rooftop = Math.random() < 0.75 && this._rooftopPoint(center, 70, pos);
      if (!rooftop) this._ringPoint(center, 14, 26, pos);
    } else this._ringPoint(center, 4, 16, pos);
    this.spawn(kind, pos, { isWave: true, wave: this.stats.wave, rooftop });
  }

  _waveAlive() { let n = 0; for (const e of this.list) if (e.alive && e.isWave) n++; return n; }

  _startBoss() {
    this.phase = 'boss';
    this.stats.wave = 4;
    const g = this.game, pl = g.player;
    const pp = pl ? pl.pos : _w.set(0, 0, 0);
    // find a tall building (rooftop) 25..50 m away to drop in from
    const phys = g.physics;
    let perch = null;
    const p = new THREE.Vector3();
    const maxY = pp.y + 70;
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
      if (this._rooftopPoint(pp, 70, p, 8, 70, 40) && Math.hypot(p.x - pp.x, p.z - pp.z) >= 15) ok = true;
    }
    if (ok) perch = p;
    else {
      p.set(0, 0, 0);
      let bestH = 0;
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = rnd(22, 48);
        const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
        const h = phys.heightAt(x, z, maxY);
        if (h > bestH && h >= pp.y + 8) { bestH = h; p.set(x, h, z); }
      }
      if (bestH >= 8) perch = p;
    }
    const venom = perch ? this.spawn('venom', perch, { wave: 4 }) : null;
    if (venom) venom.begin(true);
    else {
      _v.set(pp.x + 14, 38, pp.z);
      this._clampBounds(_v);
      const v2 = this.spawn('venom', _v, { wave: 4 });
      v2.begin(false);
      this.boss = v2;
    }
    if (venom) this.boss = venom;
    this.game.audio?.music?.('boss');
    this.game.hud?.toast?.('VENOM is here!');
    this._setObjective('Defeat VENOM', 0);
    this.objectiveActive = true;
  }

  onBossLanded() {}

  debugStartBoss() {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
    this.queue.length = 0; this.tokens.melee.clear(); this.tokens.ranged.clear();
    this.running = true;
    this._startBoss();
    return this.boss;
  }

  debugSpawn(kind = 'goon', n = 1, dist = 8) {
    const pl = this.game.player, out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.5;
      _v.set(pl.pos.x + Math.cos(a) * dist, pl.pos.y, pl.pos.z + Math.sin(a) * dist);
      out.push(this.spawn(kind, _v, { wave: 1 }));
    }
    this.running = true;
    return out;
  }

  // ===================================================================== events
  onKill(e) {
    this.stats.kills++;
    if (e.isWave) { this.waveKilled++; if (this.phase === 'fight') this._refreshObjective(); }
    if (!e.isBoss) {
      const pl = this.game.player;
      const low = pl && pl.hp < pl.maxHp * 0.4;
      const chance = (e.kind === 'hunter' ? 0.35 : 0.22) + (low ? 0.3 : 0);
      if (Math.random() < chance) this._dropOrb(e.pos);
    }
  }

  onBossDeath(v) {
    this.phase = 'victory';
    this.victoryT = 3.2;
    this.objectiveActive = false;
    // symbiote goons die with their master
    for (const e of this.list) if (e.alive && !e.isBoss) e.takeDamage(9999, {});
    this._setObjective('Venom defeated!', 1);
    this.game.audio?.music?.('victory');
  }

  // ===================================================================== orbs
  _dropOrb(pos) {
    if (!ORB) ORB = { geo: new THREE.OctahedronGeometry(0.28, 0), mat: new THREE.MeshBasicMaterial({ color: 0x40ff90, toneMapped: false }) };
    const mesh = new THREE.Mesh(ORB.geo, ORB.mat);
    mesh.position.set(pos.x, pos.y + 0.8, pos.z);
    this.game.scene.add(mesh);
    this.orbs.push({ mesh, t: 0, base: pos.y + 0.8, life: 25 });
  }

  _updateOrbs(dt) {
    const pl = this.game.player;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.t += dt; o.life -= dt;
      o.mesh.rotation.y += dt * 3;
      let remove = o.life <= 0;
      if (pl && !pl.dead) {
        const dx = pl.pos.x - o.mesh.position.x, dy = pl.pos.y + 1 - o.mesh.position.y, dz = pl.pos.z - o.mesh.position.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 4 && d > 0.01) { const s = Math.min(d, (6 - d) * 3 * dt); o.mesh.position.x += dx / d * s; o.mesh.position.y += dy / d * s; o.mesh.position.z += dz / d * s; }
        else o.mesh.position.y = o.base + Math.sin(o.t * 3) * 0.12;
        if (d < 1.5) {
          if (pl.hp < pl.maxHp) pl.heal?.(15);
          this.game.audio?.play?.('pickup');
          this.game.fx.burst(o.mesh.position, 0x40ff90, 14, 4, 0.5, 0.25);
          this.game.fx.text(_v.set(pl.pos.x, pl.pos.y + pl.height + 0.4, pl.pos.z), '+15', 0x60ff90);
          remove = true;
        }
      }
      if (o.life > 0 && Math.floor(o.t * 12) !== Math.floor((o.t - dt) * 12)) this.game.fx.glow(o.mesh.position, 0x40ff90, 0.9, 0.2);
      if (remove) { o.mesh.parent?.remove(o.mesh); this.orbs.splice(i, 1); }
    }
  }

  // ===================================================================== update
  update(dt) {
    const g = this.game;
    if (this.running) this.stats.time += dt;
    if (g.player) this.stats.maxCombo = Math.max(this.stats.maxCombo, g.player.combo || 0);

    this._updateFlow(dt);

    // enemies
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.update(dt);
      if (e.removed) { e.dispose(); list.splice(i, 1); if (this.boss === e) this.boss = null; }
    }
    this._separate();
    this._updateOrbs(dt);

    const b = this.boss;
    if (b && b.alive) {
      g.hud?.showBoss?.('VENOM', Math.max(0, b.hp), b.maxHp);
      this.objectivePos.copy(b.pos);
    }
  }

  _separate() {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        const wa = a.isBoss ? 0 : (b.isBoss ? 1 : 0.5), wb = b.isBoss ? 0 : (a.isBoss ? 1 : 0.5);
        a.pos.x -= nx * push * 2 * wa; a.pos.z -= nz * push * 2 * wa;
        b.pos.x += nx * push * 2 * wb; b.pos.z += nz * push * 2 * wb;
      }
    }
  }

  _updateFlow(dt) {
    const g = this.game, pl = g.player;
    switch (this.phase) {
      case 'idle': break;
      case 'intro':
        this.timer -= dt;
        if (this.timer <= 0) this._beginWave(0);
        break;
      case 'travel': {
        this._travelT += dt;
        this._refreshObjectiveThrottled(dt);
        if (this._distToZone() < 75 || this._travelT > 100) {
          this.phase = 'fight'; this.spawnT = 0; this.game.audio?.music?.('combat');
          this.game.hud?.toast?.('Symbiote gang ahead!');
          if (this._travelT > 100) { // player ignored the marker: bring the fight to them
            _v.copy(pl.pos); this.zone.copy(_v); this.objectivePos.copy(_v);
          }
          this._refreshObjective();
        }
        break;
      }
      case 'fight': {
        this.spawnT -= dt;
        if (this.queue.length && this.spawnT <= 0 && this._waveAlive() < WAVES[this.waveIdx].cap && this.aliveCount() < MAX_ALIVE) {
          this._spawnNext();
          this.spawnT = 0.35;
        }
        // goons far from the player drift back toward them: handled by AI (chase from any range)
        if (!this.queue.length && this._waveAlive() === 0) {
          this.waveKilled = this.waveTotal; this._refreshObjective();
          if (this.waveIdx + 1 < WAVES.length) {
            this.phase = 'between'; this.timer = 4.5;
            g.hud?.toast?.(`${WAVES[this.waveIdx].label} cleared!`);
            this.objectiveActive = false;
            g.audio?.music?.('roam');
          } else {
            this.phase = 'prelude'; this.timer = 7;
            g.hud?.toast?.('Something big is coming...');
            this._setObjective('Brace yourself...', 1);
            this.objectiveActive = false;
            g.audio?.music?.('roam');
          }
        }
        break;
      }
      case 'between':
        this.timer -= dt;
        if (this.timer <= 0) this._beginWave(this.waveIdx + 1);
        break;
      case 'prelude':
        this.timer -= dt;
        if (this.timer <= 0) this._startBoss();
        break;
      case 'boss': break;
      case 'victory':
        if (this.victoryT > 0) {
          this.victoryT -= dt;
          if (this.victoryT <= 0) { this.victoryT = -1; this.running = false; g.onVictory?.(this.stats); }
        }
        break;
    }
  }

  _refreshObjectiveThrottled(dt) {
    this._objT = (this._objT || 0) - dt;
    if (this._objT <= 0) { this._objT = 0.5; this._refreshObjective(); }
  }
}
