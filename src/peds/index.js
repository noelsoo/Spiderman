// Pedestrians and street cops. Peds walk the sidewalk lines next to the blocks (and the crosswalks), idle at corners,
// flee from gunfire / explosions / fast cars, tumble when hit by cars and can be punched or shot.
// Contract: docs/ARCHITECTURE.md#vehicles (game.peds)
//
// API:  list: Ped[] (pos, alive, takeDamage(n,{knockback}))   cops: Ped[]
//       hitByCar(ped, car, speed, dirSign) -> {killed}   ejectDriver(car, doorPos)   scare(pos, r, kind)   blast(pos, r)
//       spawnCops(car, n)   dismissCops()   copsSee(pos, r)
import * as THREE from 'three';
import { buildCharacter } from '../models/index.js';

const PZ0 = -595, PZP = 70, PX0 = -400, PXP = 100;
const ZA = 9.6, ZB = 60.4, XA = 12.6, XB = 87.4;
const Z_MIN = -598, Z_MAX = 598, X_MIN = -412.8, X_MAX = 512.8;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3();
const H = 1.75;

function nextCorner(c, dir, zAxis) {
  const base = zAxis ? PZ0 : PX0, per = zAxis ? PZP : PXP, A = zAxis ? ZA : XA, B = zAxis ? ZB : XB;
  const k = Math.floor((c - base) / per + 1e-9), loc = c - base - k * per, e = 0.05;
  if (dir > 0) { if (loc < A - e) return base + k * per + A; if (loc < B - e) return base + k * per + B; return base + (k + 1) * per + A; }
  if (loc > B + e) return base + k * per + B; if (loc > A + e) return base + k * per + A; return base + (k - 1) * per + B;
}
const inRange = (c, zAxis) => (zAxis ? c > Z_MIN && c < Z_MAX : c > X_MIN && c < X_MAX);
function onBlock(c, zAxis) {
  const base = zAxis ? PZ0 : PX0, per = zAxis ? PZP : PXP, A = zAxis ? ZA : XA, B = zAxis ? ZB : XB;
  const loc = ((c - base) % per + per) % per;
  return loc > A - 0.3 && loc < B + 0.3;
}

export class Ped {
  constructor(mgr, cop, idx) {
    this.mgr = mgr; this.game = mgr.game; this.cop = cop; this.idx = idx;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.radius = 0.38; this.height = H; this.speedWalk = rnd(1.25, 1.75);
    this.hp = cop ? 70 : 40; this.maxHp = this.hp;
    this.active = false; this.hidden = true; this.dead = false; this.deadT = 0;
    this.state = 'walk'; this.stateT = 0;
    this.airTime = 0; this.carCd = 0; this.tumble = 0; this.downT = 0;
    this.axisZ = true; this.fixed = 0; this.dir = 1; this.corner = 0;
    this.anim = { state: 'idle', t: 0, speed: 0, blend: 0 };
    this.threat = new THREE.Vector3(); this.fireT = rnd(0.6, 1.4); this.atkT = 0; this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0;
    this.fightT = 0; this.leaveT = 0; this.y0 = 0;
    this.model = buildCharacter(cop ? 'cop' : 'civilian', { variant: idx });
    const mh = this.model.height || H;
    this.k = H / mh; this.mh = mh;
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ';
    this.root.add(this.model.group);
    this.root.scale.setScalar(this.k);
    this.model.group.position.set(0, -mh * 0.5, 0);
    this.root.visible = false;
    this.game.scene.add(this.root);
  }
  get alive() { return this.active && !this.dead; }
  get center() { return _x.set(this.pos.x, this.pos.y + H * 0.55, this.pos.z); }

  setAnim(state, speed = 1) {
    if (this.anim.state !== state) { this.anim.state = state; this.anim.t = 0; }
    this.anim.speed = speed;
  }

  /** Generic damage API (also used by the player's melee / gun checks). */
  takeDamage(n, o = {}) {
    if (!this.active || this.dead) return 0;
    this.hp -= n;
    const kb = o.knockback;
    if (kb) { this.vel.x += kb.x * 0.6; this.vel.z += kb.z * 0.6; this.vel.y = Math.max(this.vel.y, kb.y > 0 ? kb.y * 0.7 : 3); }
    this.mgr._wasHit(this, n, o);
    return n;
  }
}

export class Peds {
  constructor(game) {
    this.game = game;
    this.list = []; this.cops = [];
    this.anchor = new THREE.Vector3();
    this.built = false; this.time = 0;
    this._prevAtk = ''; this._copsDismissed = 0; this._spawnBudget = 0;
    this._lastCrime = 0;
  }

  async build() {
    const g = this.game;
    const q = g.settings?.quality ?? 'high';
    const n = { low: 24, medium: 40, high: 60, ultra: 80 }[q] ?? 60;
    this.target = n;
    for (let i = 0; i < n + 4; i++) this.list.push(new Ped(this, false, i));
    for (let i = 0; i < 8; i++) { const c = new Ped(this, true, i); this.cops.push(c); this.list.push(c); }
    this.renderR = { low: 55, medium: 70, high: 85, ultra: 95 }[q] ?? 80;
    // wrap fx.explosion so every blast (heroes included) scares / launches pedestrians
    const fx = g.fx;
    if (fx && fx.explosion && !fx._pedWrapped) {
      const orig = fx.explosion.bind(fx);
      fx.explosion = (pos, radius = 4, color) => { orig(pos, radius, color); this.blast(pos, radius * 2.2); };
      fx._pedWrapped = true;
    }
    g.events.on('weapon:fired', (e) => this._onGunshot(e));
    this.built = true;
    this._setAnchor();
    this.reset();
  }

  reset() {
    if (!this.built) return;
    this._setAnchor();
    for (const p of this.list) { this._deactivate(p); }
    let c = 0;
    for (const p of this.list) {
      if (p.cop) continue;
      if (c++ >= this.target) break;
      this._spawnWalker(p, true);
    }
  }

  _setAnchor() {
    const g = this.game, v = g.vehicles;
    if (v?.driving) this.anchor.copy(v.driving.pos);
    else if ((g.state === 'playing' || g.state === 'paused' || g.state === 'overlay') && g.player?.active) this.anchor.copy(g.player.pos);
    else if (g.world?.menuFocus) this.anchor.copy(g.world.menuFocus);
    else if (g.world?.spawnPoint) this.anchor.copy(g.world.spawnPoint.pos);
  }

  _deactivate(p) {
    p.active = false; p.hidden = true; p.root.visible = false; p.dead = false; p.state = 'walk';
    p.vel.set(0, 0, 0); p.tumble = 0; p.airTime = 0; p.carCd = 0; p.hp = p.maxHp;
  }

  // ===================================================================== spawning
  _spawnWalker(p, initial = false) {
    const ax = this.anchor.x, az = this.anchor.z;
    const minR = initial ? 8 : 38, maxR = 135;
    for (let tries = 0; tries < 10; tries++) {
      const zAxis = Math.random() < 0.5;
      let fixed, c;
      if (zAxis) {
        const a = clamp(Math.round((ax + rnd(-maxR, maxR) - PX0) / PXP), 0, 9);
        fixed = PX0 + a * PXP + (Math.random() < 0.5 ? -XA : XA);
        c = clamp(az + rnd(-maxR, maxR), Z_MIN + 6, Z_MAX - 6);
        if (!inRange(fixed, false)) continue;
      } else {
        const s = clamp(Math.round((az + rnd(-maxR, maxR) - PZ0) / PZP), 0, 17);
        fixed = PZ0 + s * PZP + (Math.random() < 0.5 ? -ZA : ZA);
        c = clamp(ax + rnd(-maxR, maxR), X_MIN + 6, X_MAX - 6);
        if (!inRange(fixed, true)) continue;
      }
      const x = zAxis ? fixed : c, z = zAxis ? c : fixed;
      const d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      if (!initial && d < 75 && this.game.vehicles?._visible?.(x, 1, z, 1.5)) continue;
      p.axisZ = zAxis; p.fixed = fixed; p.dir = Math.random() < 0.5 ? 1 : -1;
      p.corner = nextCorner(c, p.dir, zAxis);
      if (!inRange(p.corner, zAxis)) { p.dir = -p.dir; p.corner = nextCorner(c, p.dir, zAxis); if (!inRange(p.corner, zAxis)) continue; }
      p.pos.set(x, onBlock(c, zAxis) ? 0.15 : 0, z);
      p.vel.set(0, 0, 0); p.hp = p.maxHp = 40; p.dead = false; p.deadT = 0; p.active = true; p.hidden = false;
      p.state = Math.random() < 0.12 ? 'idle' : 'walk'; p.stateT = rnd(1, 4);
      p.speedWalk = rnd(1.25, 1.8); p.tumble = 0; p.airTime = 0; p.carCd = 0; p.yaw = Math.atan2(zAxis ? 0 : p.dir, zAxis ? p.dir : 0);
      p.model.setTint?.(0xffffff, 0);
      p.setAnim('idle', 0);
      p.root.visible = true;
      return true;
    }
    return false;
  }

  /** Pull a pooled civilian (or steal the farthest one) for scripted events. */
  _grab() {
    let best = null, bd = -1;
    for (const p of this.list) { if (!p.cop && !p.active) return p; }
    for (const p of this.list) {
      if (p.cop || !p.active) continue;
      const d = Math.hypot(p.pos.x - this.anchor.x, p.pos.z - this.anchor.z);
      if (d > bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Driver pulled out of a car by a carjack: tumbles out, then runs away (or fights back). */
  ejectDriver(car, doorPos, quiet) {
    const p = this._grab();
    if (!p) return null;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw), rx = -cy, rz = sy;
    const side = -1; // driver sits on the left
    p.active = true; p.hidden = false; p.dead = false; p.root.visible = true; p.hp = p.maxHp = 40; p.carCd = 1.2;
    p.pos.set(car.pos.x + rx * side * (car.spec.W / 2 + 0.2), car.pos.y + 0.2, car.pos.z + rz * side * (car.spec.W / 2 + 0.2));
    p.vel.set(rx * side * 4.5 + sy * 0.5, 3.5, rz * side * 4.5 + cy * 0.5);
    p.yaw = car.yaw; p.airTime = 0.6; p.state = 'down'; p.downT = 0.9; p.tumble = 0;
    p.snapLine = true;
    p.next = Math.random() < 0.28 && !quiet ? 'fight' : 'flee';
    p.threat.copy(car.pos);
    p.model.setTint?.(0xffffff, 0);
    return p;
  }

  spawnCops(car, n = 2) {
    let made = 0;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw), rx = -cy, rz = sy;
    for (const c of this.cops) {
      if (made >= n) break;
      if (c.active) continue;
      const side = made % 2 ? 1 : -1;
      c.active = true; c.hidden = false; c.dead = false; c.deadT = 0; c.hp = c.maxHp = 70; c.root.visible = true;
      c.pos.set(car.pos.x + rx * side * (car.spec.W / 2 + 0.8) + sy * 0.4, car.pos.y, car.pos.z + rz * side * (car.spec.W / 2 + 0.8) + cy * 0.4);
      c.vel.set(0, 0, 0); c.state = 'cop'; c.stateT = 0; c.fireT = rnd(0.5, 1.2); c.tumble = 0; c.airTime = 0; c.carCd = 0; c.leaveT = 0;
      c.model.setTint?.(0xffffff, 0);
      made++;
    }
    return made;
  }
  dismissCops() {
    for (const c of this.cops) if (c.active && c.state !== 'leave') { c.state = 'leave'; c.leaveT = rnd(4, 9); }
  }
  copsSee(pos, r) {
    for (const c of this.cops) {
      if (!c.active || c.dead) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < r) return true;
    }
    return false;
  }

  // ===================================================================== reactions
  scare(pos, r, kind = 'gun') {
    for (const p of this.list) {
      if (!p.active || p.dead || p.cop) continue;
      const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z;
      if (dx * dx + dz * dz > r * r) continue;
      if (kind === 'horn' && Math.random() < 0.6) continue;
      this._flee(p, pos);
    }
  }

  _flee(p, from, t = rnd(4.5, 8)) {
    if (p.cop || p.dead || p.state === 'down' || p.state === 'fight') return;
    p.state = 'flee'; p.stateT = t; p.threat.copy(from);
    // run along the line, away from the threat
    const along = p.axisZ ? p.pos.z - from.z : p.pos.x - from.x;
    const ndir = along >= 0 ? 1 : -1;
    if (ndir !== p.dir) { p.dir = ndir; p.corner = nextCorner(p.axisZ ? p.pos.z : p.pos.x, p.dir, p.axisZ); }
  }

  blast(pos, radius) {
    for (const p of this.list) {
      if (!p.active || p.dead) continue;
      const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d > radius * 1.8) continue;
      if (d < radius) {
        const f = 1 - d / radius, h = d || 1;
        p.vel.set(dx / h * (6 + 12 * f), 5 + 7 * f, dz / h * (6 + 12 * f));
        p.hp -= 70 * f + 10;
        p.airTime = 0.7; p.state = 'down'; p.downT = rnd(1.8, 3); p.next = 'flee'; p.carCd = 0.6;
        if (p.hp <= 0) this._die(p, false);
      } else if (!p.cop) this._flee(p, pos, rnd(6, 9));
    }
  }

  /** Called by vehicles when a moving car overlaps a ped. */
  hitByCar(p, car, speed, dirSign = 1) {
    const sy = Math.sin(car.yaw) * dirSign, cy = Math.cos(car.yaw) * dirSign;
    const rx = -Math.cos(car.yaw), rz = Math.sin(car.yaw);
    const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
    const lat = Math.sign(dx * rx + dz * rz) || 1;
    p.vel.set(sy * speed * 0.9 + rx * lat * 2.0, 3.5 + speed * 0.16, cy * speed * 0.9 + rz * lat * 2.0);
    p.hp -= speed * 4.2;
    p.carCd = 1.2; p.airTime = 0.9; p.tumble = 0;
    p.state = 'down'; p.downT = rnd(2.2, 3.6); p.next = 'flee'; p.threat.copy(car.pos);
    this.game.audio?.play?.('hit', { pos: p.pos });
    this.game.fx?.hitSpark?.(p.center, 0xffd0a0, speed > 10);
    this.scare(p.pos, 18, 'car');
    if (p.hp <= 0) { this._die(p, false); return { killed: true }; }
    return { killed: false };
  }

  _die(p, byPlayer) {
    if (p.dead) return;
    p.dead = true; p.deadT = 0; p.hp = 0; p.state = 'dead';
    p.setAnim('dead', 1);
    if (p.cop) this._copDown(p);
    if (p.cop) { /* wanted bump handled via crime event */ }
  }
  _copDown(p) {
    this.game.events.emit('crime', { severity: 2, pos: p.pos.clone(), kind: 'cop_hit' });
  }

  /** Damage dealt by the player (melee / gun) or generic takeDamage. */
  _wasHit(p, n, o) {
    const byPlayer = o?.source === this.game.player || o?.byPlayer;
    if (p.hp <= 0) {
      this._die(p, true);
      if (byPlayer && !p.cop) this.game.events.emit('crime', { severity: 1, pos: p.pos.clone(), kind: 'ped_killed' });
      return;
    }
    if (p.cop) {
      if (byPlayer) this.game.events.emit('crime', { severity: 1, pos: p.pos.clone(), kind: 'cop_hit' });
      p.state = 'cop'; return;
    }
    if (p.state !== 'down') { p.state = 'down'; p.downT = rnd(1.2, 2.2); p.next = 'flee'; p.airTime = 0.2; p.threat.copy(this.game.player?.pos ?? p.pos); }
    if (byPlayer) this.game.events.emit('crime', { severity: 1, pos: p.pos.clone(), kind: 'ped_hit' });
    this.scare(p.pos, 14, 'melee');
  }

  _onGunshot(e) {
    const g = this.game, pl = g.player;
    if (!pl || !e?.pos) return;
    // trace the shot along the camera aim and hurt whoever stands in it
    const dir = g.cam.aimDirection(_w);
    const o = _v.copy(e.pos);
    let maxT = 90;
    const wall = g.physics.raycast(o, dir, maxT);
    if (wall) maxT = wall.distance;
    let best = null, bt = maxT;
    for (const p of this.list) {
      if (!p.active || p.dead || p.hidden) continue;
      _x.set(p.pos.x - o.x, p.pos.y + H * 0.55 - o.y, p.pos.z - o.z);
      const t = _x.dot(dir);
      if (t < 0 || t > bt) continue;
      const d2 = _x.lengthSq() - t * t;
      if (d2 < 0.42 * 0.42 + 0.1) { bt = t; best = p; }
    }
    if (best) {
      const dmg = e.weapon?.damage ?? 25;
      best.takeDamage(dmg, { knockback: _x.copy(dir).setY(0).multiplyScalar(5).setY(2), source: pl, kind: 'gun' });
      g.fx?.hitSpark?.(best.center, 0xff6060, false);
    }
  }

  // ===================================================================== update
  update(dt) {
    if (!this.built || dt <= 0) return;
    const g = this.game;
    this.time += dt;
    this._setAnchor();
    const ax = this.anchor.x, az = this.anchor.z;
    const pl = g.player, playing = g.state === 'playing' && pl?.active;
    const driving = g.vehicles?.driving;
    let spawns = 3;
    let activeCount = 0;
    if (playing && !driving) this._playerMelee(dt);

    for (const p of this.list) {
      if (!p.active) continue;
      const dx = p.pos.x - ax, dz = p.pos.z - az, d = Math.hypot(dx, dz);
      p.dist = d;
      if (!p.cop && !p.dead) activeCount++;
      // recycle far-away walkers
      if (!p.cop && d > 150 && p.state !== 'down') { if (!this._spawnWalker(p)) { /* try later */ } continue; }
      if (p.carCd > 0) p.carCd -= dt;
      this._updatePed(p, dt, playing, driving);
      // render culling + animation LOD
      const vis = d < this.renderR;
      p.hidden = !vis;
      if (p.root.visible !== vis) p.root.visible = vis;
      if (vis) this._syncModel(p, dt, d);
    }
    // top up
    if (activeCount < this.target) {
      for (const p of this.list) {
        if (spawns <= 0) break;
        if (p.cop || p.active) continue;
        if (this._spawnWalker(p)) { spawns--; }
        else break;
      }
    }
  }

  _updatePed(p, dt, playing, driving) {
    const g = this.game;
    p.stateT -= dt;
    switch (p.state) {
      case 'walk': case 'idle': case 'flee': this._walk(p, dt); break;
      case 'down': this._down(p, dt); break;
      case 'dead': this._deadUpdate(p, dt); break;
      case 'fight': this._fight(p, dt, playing, driving); break;
      case 'cop': this._cop(p, dt, playing, driving); break;
      case 'leave': this._leave(p, dt); break;
      default: p.state = 'walk';
    }
    // keep inside the world
    const b = g.world?.bounds;
    if (b) { p.pos.x = clamp(p.pos.x, b.minX + 1, b.maxX - 1); p.pos.z = clamp(p.pos.z, b.minZ + 1, b.maxZ - 1); }
    // run-over awareness: fast car heading at us
    if (p.state === 'walk' || p.state === 'idle') {
      const veh = g.vehicles?.driving;
      if (veh && Math.abs(veh.speed) > 15) {
        const dx = p.pos.x - veh.pos.x, dz = p.pos.z - veh.pos.z;
        if (dx * dx + dz * dz < 14 * 14 && (dx * veh.vel.x + dz * veh.vel.z) > 0) this._flee(p, veh.pos, rnd(3, 5));
      }
    }
  }

  _walk(p, dt) {
    const fleeing = p.state === 'flee';
    if (p.state === 'idle') {
      p.setAnim('idle', 0);
      if (p.stateT <= 0) { p.state = 'walk'; p.stateT = rnd(8, 20); }
      this._settleToLine(p, dt);
      return;
    }
    if (fleeing && p.stateT <= 0) { p.state = 'walk'; p.stateT = rnd(8, 20); }
    const speed = fleeing ? 5.4 : p.speedWalk;
    const c = p.axisZ ? p.pos.z : p.pos.x;
    const step = p.dir * speed * dt;
    let nc = c + step;
    if ((p.dir > 0 && nc >= p.corner) || (p.dir < 0 && nc <= p.corner)) {
      nc = p.corner;
      this._setCoord(p, nc);
      this._atCorner(p, fleeing);
    } else this._setCoord(p, nc);
    this._settleToLine(p, dt);
    const heading = p.axisZ ? (p.dir > 0 ? 0 : Math.PI) : (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    p.yaw += wrapPi(heading - p.yaw) * Math.min(1, 10 * dt);
    p.setAnim('run', fleeing ? 6.2 : 1.7);
    // sidewalk height
    const hy = onBlock(p.axisZ ? p.pos.z : p.pos.x, p.axisZ) ? 0.15 : 0;
    p.pos.y += (hy - p.pos.y) * Math.min(1, 12 * dt);
  }
  _setCoord(p, c) { if (p.axisZ) p.pos.z = c; else p.pos.x = c; }
  _settleToLine(p, dt) {
    // after being knocked off the line, drift back onto it
    const lat = p.axisZ ? p.pos.x : p.pos.z;
    const nl = lat + (p.fixed - lat) * Math.min(1, 3.5 * dt);
    if (p.axisZ) p.pos.x = nl; else p.pos.z = nl;
  }
  _atCorner(p, fleeing) {
    // options: straight, turn left, turn right, (rare) reverse
    const c = p.axisZ ? p.pos.z : p.pos.x;
    const opts = [];
    const straightC = nextCorner(c, p.dir, p.axisZ);
    if (inRange(straightC, p.axisZ)) opts.push({ t: 's', w: fleeing ? 2 : 4 });
    // turning: new line is perpendicular with fixed = c
    for (const nd of [-1, 1]) {
      const newAxisZ = !p.axisZ;
      const newFixed = c;
      if (!inRange(newFixed, p.axisZ)) continue;
      const here = p.fixed; // the coordinate along the new axis
      const nc = nextCorner(here, nd, newAxisZ);
      if (!inRange(nc, newAxisZ)) continue;
      opts.push({ t: 'turn', nd, w: 2.2 });
    }
    if (!opts.length || Math.random() < 0.03) { p.dir = -p.dir; p.corner = nextCorner(c, p.dir, p.axisZ); if (!inRange(p.corner, p.axisZ)) p.corner = c; return; }
    let sum = 0; for (const o of opts) sum += o.w;
    let r = Math.random() * sum, ch = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { ch = o; break; } }
    if (ch.t === 's') { p.corner = straightC; }
    else {
      const oldFixed = p.fixed;
      p.axisZ = !p.axisZ; p.fixed = c; p.dir = ch.nd;
      p.corner = nextCorner(oldFixed, p.dir, p.axisZ);
      if (p.axisZ) { p.pos.z = oldFixed; p.pos.x = p.fixed; } else { p.pos.x = oldFixed; p.pos.z = p.fixed; }
    }
    if (!fleeing && Math.random() < 0.17) { p.state = 'idle'; p.stateT = rnd(1.5, 5); }
  }

  _down(p, dt) {
    const g = this.game;
    p.airTime = Math.max(0, p.airTime - dt);
    p.vel.y -= 24 * dt;
    p.pos.addScaledVector(p.vel, dt);
    const res = g.physics.resolveCapsule(p.pos, 0.35, 0.9, p.vel);
    const floor = onBlock(p.axisZ ? p.pos.z : p.pos.x, p.axisZ) ? 0 : 0;
    if (p.pos.y <= floor && p.vel.y <= 0) { p.pos.y = floor; p.vel.y = 0; if (p.airTime > 0.25) p.airTime = 0.25; }
    const grounded = p.pos.y <= floor + 0.02 || res.onGround;
    if (grounded) { const k = Math.exp(-4.5 * dt); p.vel.x *= k; p.vel.z *= k; }
    p.setAnim('stunned', 1);
    p.inAir = !grounded;
    if (!grounded) p.tumble = Math.max(p.tumble - 11 * dt, -TAU);
    else p.downT -= dt;
    if (grounded && p.downT <= 0) {
      p.snapLine = false; p.inAir = false;
      // re-attach to the nearest sidewalk line (axis closest to where we landed)
      this._snapToLine(p);
      if (p.next === 'fight') { p.state = 'fight'; p.fightT = rnd(5, 8); } else { p.state = 'flee'; p.stateT = rnd(5, 8); }
      p.vel.set(0, 0, 0);
    }
  }
  _snapToLine(p) {
    // choose the closest of the two line families
    const x = p.pos.x, z = p.pos.z;
    const a = clamp(Math.round((x - PX0) / PXP), 0, 9);
    const lx = [PX0 + a * PXP - XA, PX0 + a * PXP + XA];
    const s = clamp(Math.round((z - PZ0) / PZP), 0, 17);
    const lz = [PZ0 + s * PZP - ZA, PZ0 + s * PZP + ZA];
    let bestD = 1e9, bz = true, bf = 0;
    for (const f of lx) { const d = Math.abs(x - f); if (d < bestD && inRange(f, false)) { bestD = d; bz = true; bf = f; } }
    for (const f of lz) { const d = Math.abs(z - f); if (d < bestD && inRange(f, true)) { bestD = d; bz = false; bf = f; } }
    p.axisZ = bz; p.fixed = bf;
    const c = bz ? z : x;
    const away = bz ? z - p.threat.z : x - p.threat.x;
    p.dir = away >= 0 ? 1 : -1;
    p.corner = nextCorner(c, p.dir, bz);
    if (!inRange(p.corner, bz)) { p.dir = -p.dir; p.corner = nextCorner(c, p.dir, bz); }
  }

  _deadUpdate(p, dt) {
    p.deadT += dt;
    const g = this.game;
    p.vel.y -= 24 * dt;
    p.pos.addScaledVector(p.vel, dt);
    g.physics.resolveCapsule(p.pos, 0.35, 0.9, p.vel);
    if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; }
    const k = Math.exp(-5 * dt); p.vel.x *= k; p.vel.z *= k;
    p.setAnim('dead', 1);
    p.inAir = p.pos.y > 0.05 && p.deadT < 1.2;
    if (p.inAir) p.tumble = Math.max(p.tumble - 10 * dt, -TAU);
    if (p.deadT > 14 || (p.dist > 90 && p.deadT > 3)) { if (p.cop) { this._deactivate(p); } else if (!this._spawnWalker(p)) this._deactivate(p); }
  }

  _fight(p, dt, playing, driving) {
    const g = this.game, pl = g.player;
    p.fightT -= dt;
    if (!playing || !pl || pl.dead || driving || p.fightT <= 0) { p.state = 'flee'; p.stateT = rnd(5, 8); this._snapToLine(p); return; }
    const dx = pl.pos.x - p.pos.x, dz = pl.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
    p.yaw += wrapPi(Math.atan2(dx, dz) - p.yaw) * Math.min(1, 10 * dt);
    p.atkT -= dt;
    if (d > 1.5) {
      p.pos.x += dx / d * 4.6 * dt; p.pos.z += dz / d * 4.6 * dt; p.setAnim('run', 5.5);
      g.physics.resolveCapsule(p.pos, 0.35, 0.9, _v.set(0, 0, 0));
    } else {
      p.setAnim('punch1', 1);
      if (p.atkT <= 0) { p.atkT = 1.1; pl.takeDamage?.(5, p.pos); }
    }
    p.pos.y += ((onBlock(p.pos.z, true) ? 0 : 0) - p.pos.y) * Math.min(1, 10 * dt);
  }

  _leave(p, dt) {
    p.leaveT -= dt;
    p.setAnim('run', 2);
    const dx = p.pos.x - this.anchor.x, dz = p.pos.z - this.anchor.z, d = Math.hypot(dx, dz) || 1;
    p.pos.x += dx / d * 2.2 * dt; p.pos.z += dz / d * 2.2 * dt;
    p.yaw += wrapPi(Math.atan2(dx, dz) - p.yaw) * Math.min(1, 6 * dt);
    if (p.leaveT <= 0 && (p.dist > 45 || p.leaveT < -6)) this._deactivate(p);
  }

  _cop(p, dt, playing, driving) {
    const g = this.game, pl = g.player;
    if (!playing || !pl || pl.dead) { p.setAnim('idle', 0); return; }
    const wanted = g.vehicles?.wanted ?? 0;
    if (wanted <= 0 && p.state === 'cop') { p.state = 'leave'; p.leaveT = rnd(3, 6); return; }
    const tgt = driving ?? pl;
    const dx = tgt.pos.x - p.pos.x, dz = tgt.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
    const los = d < 45 && g.physics.lineOfSight(_v.set(p.pos.x, p.pos.y + 1.4, p.pos.z), _w.set(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z));
    p.yaw += wrapPi(Math.atan2(dx, dz) - p.yaw) * Math.min(1, 9 * dt);
    p.strafeT -= dt;
    if (p.strafeT <= 0) { p.strafeT = rnd(1.2, 2.6); p.strafe = Math.random() < 0.5 ? -1 : 1; }
    let mv = 0, st = 0;
    if (!los || d > 16) mv = 4.4; else if (d < 8) mv = -2.5; else st = p.strafe * 1.8;
    const rx = dz / d, rz = -dx / d;
    p.pos.x += (dx / d * mv + rx * st) * dt; p.pos.z += (dz / d * mv + rz * st) * dt;
    g.physics.resolveCapsule(p.pos, 0.35, 0.9, _v.set(0, 0, 0));
    p.pos.y += (0 - p.pos.y) * Math.min(1, 10 * dt);
    p.fireT -= dt;
    p.shootT = (p.shootT || 0) - dt;
    p.setAnim(p.shootT > 0 ? 'shoot' : mv !== 0 || st !== 0 ? 'run' : 'idle', Math.abs(mv) + Math.abs(st));
    if (los && p.fireT <= 0 && d < 40 && (!driving || true)) {
      p.fireT = rnd(0.85, 1.6);
      const o = _v.set(p.pos.x, p.pos.y + 1.4, p.pos.z);
      p.model.handR?.getWorldPosition?.(o);
      const aim = _w.set(tgt.pos.x - o.x + rnd(-0.9, 0.9), tgt.pos.y + 1.1 - o.y + rnd(-0.5, 0.5), tgt.pos.z - o.z + rnd(-0.9, 0.9)).normalize();
      g.combat.projectile({ pos: o.clone(), vel: aim.clone().multiplyScalar(52), damage: driving ? 1.5 : 4, kind: 'bullet', team: 'enemy', life: 1.2, source: null, world: true });
      g.audio?.play?.('hunter_shot', { pos: p.pos, volume: 0.5 });
      g.fx?.flash?.(o, 0xffd070, 2, 0.06);
      p.shootT = 0.3; p.setAnim('shoot', 1);
    }
  }

  // ===================================================================== melee by the player
  _playerMelee() {
    const g = this.game, pl = g.player;
    const st = pl.anim?.state;
    const isAtk = st === 'punch1' || st === 'punch2' || st === 'punch3' || st === 'kick' || st === 'uppercut' || st === 'smash';
    const key = isAtk ? st + ':' + Math.floor((pl.anim.t ?? 0) < 0.12 ? 1 : 0) : '';
    const fresh = isAtk && this._prevAtk !== st && (pl.anim.t ?? 0) < 0.2;
    this._prevAtk = isAtk ? st : '';
    void key;
    if (!fresh) return;
    const f = pl.forward;
    const range = pl.id === 'hulk' ? 3.6 : 2.5;
    for (const p of this.list) {
      if (!p.active || p.dead || p.hidden) continue;
      const dx = p.pos.x - pl.pos.x, dz = p.pos.z - pl.pos.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(p.pos.y - pl.pos.y) > 2) continue;
      if ((dx * f.x + dz * f.z) / (d || 1) < 0.15 && d > 1.0) continue;
      const dmg = st === 'smash' ? 60 : st === 'uppercut' ? 28 : 16;
      p.takeDamage(dmg, { knockback: _x.set(dx / (d || 1) * 6, 3, dz / (d || 1) * 6), source: pl, kind: 'melee' });
    }
  }

  // ===================================================================== visuals
  _syncModel(p, dt, d) {
    const r = p.root;
    // animation LOD: far peds update at half rate
    p._lodT = (p._lodT || 0) + dt;
    const lodStep = d > 55 ? 0.066 : 0;
    if (p._lodT < lodStep) { this._place(p); return; }
    const mdt = p._lodT; p._lodT = 0;
    p.anim.t += mdt;
    this._place(p);
    p.model.update?.(mdt, p.anim, p);
    void r;
  }
  _place(p) {
    const r = p.root;
    const lying = (p.state === 'down' && !p.inAir && p.downT > 0.45) || (p.state === 'dead' && !p.inAir);
    if (!p.inAir) {
      let t0 = p.tumble % TAU; if (t0 < -Math.PI) t0 += TAU; if (t0 > 0) t0 -= TAU;
      p.tumble = t0 + ((lying ? -Math.PI / 2 : 0) - t0) * 0.25;
    }
    const lie = Math.min(1, Math.abs(p.tumble) / (Math.PI / 2));
    r.position.set(p.pos.x, p.pos.y + H * 0.5 - lie * 0.14 * H, p.pos.z);
    r.rotation.set(p.tumble, p.yaw, 0);
  }
}
