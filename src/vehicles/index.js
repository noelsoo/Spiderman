// Vehicles: ambient traffic + parked cars (instanced far LOD, full models near), GTA-style driving, carjacking,
// wanted level + police. Contract: docs/ARCHITECTURE.md#vehicles
//
// Controls while driving (read from game.input every frame):
//   throttle = input.value('throttle') (W / R2)   brake+reverse = input.value('brake') (S / L2)
//   steer = input.move.x (A,D / L stick)           handbrake = input.down('handbrake') (Space / X)   horn = H / L3
//   exit = interact (F / triangle, handled by main.js -> tryInteract)
//   Drive-by shooting lives in weapons.updateDriving() (RMB/L1 aim, LMB/R1 fire; this file only suppresses cam auto-recenter while aiming).
import * as THREE from 'three';
import { L } from '../world/city.js';
import { KINDS, SPECS, PAINTS, VAN_PAINTS, TAXI_YELLOW, POLICE_WHITE, CarModel, CarInstancer, initCarAssets } from './models.js';
import { Vehicle } from './Vehicle.js';
import { initAI, driveAI, randomLanePlacement, randomCurbPlacement, snapToLane, axisZ } from './traffic.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3();
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const _col = new THREE.Color();

const QUALITY = {
  low:    { cars: 48,  near: 7,  nearR: 55, sim: 200 },
  medium: { cars: 90,  near: 14, nearR: 65, sim: 230 },
  high:   { cars: 140, near: 24, nearR: 78, sim: 250 },
  ultra:  { cars: 190, near: 34, nearR: 88, sim: 270 },
};
const POLICE_RESERVE = 6;
const MAX_CHASERS = 4;

export class Vehicles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.driving = null;
    this.wanted = 0;
    this.heat = 0;
    this.enterable = null;
    this.time = 0;
    this.built = false;
    this.anchor = new THREE.Vector3();
    this.chaseTarget = new THREE.Vector3(); this.chaseVel = new THREE.Vector3();
    this.grid = new Map(); this._gridPool = [];
    this.jack = null; this.held = null;
    this._camSave = null; this._lookIdle = 0; this._hornT = 0; this._rumbleT = 0; this._sirenT = 0;
    this._lastCrime = {}; this._unseenT = 0; this._lastCrimeT = -99; this._policeT = 0; this._copsOutT = 0;
    this._modelPool = {}; this._frame = 0; this._promptT = 0;
    this.stats = { sim: 0, near: 0, far: 0 };
    this._tmpCars = [];
  }

  // ===================================================================== build / reset
  async build() {
    const g = this.game;
    const qn = g.settings?.quality ?? 'high';
    this.Q = QUALITY[qn] ?? QUALITY.high;
    this.quality = qn;
    initCarAssets(qn);
    const N = this.Q.cars;
    this.instancer = new CarInstancer(g.scene, N + POLICE_RESERVE + 8);
    this.root = new THREE.Group(); this.root.name = 'vehicles';
    g.scene.add(this.root);

    const mix = [['sedan', 0.34], ['taxi', 0.16], ['suv', 0.2], ['sports', 0.08], ['van', 0.12], ['police', 0.04]];
    const pickKind = () => { let r = Math.random(), s = 0; for (const [k, w] of mix) { s += w; if (r <= s) return k; } return 'sedan'; };
    let id = 0;
    for (let i = 0; i < N; i++) {
      const v = new Vehicle(this, pickKind(), id++);
      v.parked = i < N * 0.3 && v.kind !== 'police' && v.kind !== 'taxi';
      this._addVehicle(v);
    }
    for (let i = 0; i < POLICE_RESERVE; i++) {
      const v = new Vehicle(this, 'police', id++); v.reserve = true;
      this._addVehicle(v);
      v.active = false; v.group.visible = false;
    }
    this._setAnchor();
    for (const v of this.list) if (!v.reserve) this._relocate(v, true);

    // events
    const ev = g.events;
    ev.on('crime', (e) => this.addCrime(e.kind ?? 'crime', e.severity ?? 1, e.pos));
    ev.on('weapon:fired', (e) => this._onGunfire(e));
    this.built = true;
  }

  _addVehicle(v) {
    v.hex = this._pickColor(v);
    v.color.setHex(v.hex);
    this.root.add(v.group);
    this.list.push(v);
  }
  _pickColor(v) {
    if (v.kind === 'taxi') return TAXI_YELLOW;
    if (v.kind === 'police') return POLICE_WHITE;
    const pal = v.kind === 'van' ? VAN_PAINTS : PAINTS;
    return pal[(Math.random() * pal.length) | 0];
  }

  reset() {
    if (this.driving) this._exit(true, true);
    if (this.held) this._dropHeld(true);
    this.jack = null;
    this.wanted = 0; this.heat = 0; this._unseenT = 0; this._lastCrime = {};
    if (!this.built) return;
    const sp = this.game.world?.spawnPoint?.pos;
    if (sp) this.anchor.copy(sp);
    for (const v of this.list) {
      if (v.reserve) { this._deactivate(v); continue; }
      this._relocate(v, true);
    }
  }

  _deactivate(v) {
    v.active = false; v.group.visible = false; v.chasing = false; v.driver = null; v.ai = null;
    this._releaseModel(v);
  }

  _setAnchor() {
    const g = this.game;
    if (this.driving) this.anchor.copy(this.driving.pos);
    else if ((g.state === 'playing' || g.state === 'paused' || g.state === 'overlay') && g.player?.active) this.anchor.copy(g.player.pos);
    else if (g.world?.menuFocus) this.anchor.copy(g.world.menuFocus);
    else if (g.world?.spawnPoint) this.anchor.copy(g.world.spawnPoint.pos);
  }

  // ===================================================================== placement
  _visible(x, y, z, r = 3) {
    _sph.center.set(x, y, z); _sph.radius = r;
    return _fr.intersectsSphere(_sph);
  }

  /** (Re)place a car on the road around the anchor. `initial`: allow any distance (fills the whole ring). */
  _relocate(v, initial = false) {
    if (v === this.driving || v === this.jack?.v || v.held || v.thrown) return false;
    const ax = this.anchor.x, az = this.anchor.z;
    const minR = initial ? 0 : 85, maxR = this.Q.sim - 12;
    const out = this._pl || (this._pl = {});
    for (let tries = 0; tries < 8; tries++) {
      const p = v.parked ? randomCurbPlacement(ax, az, minR, maxR, out) : randomLanePlacement(ax, az, minR, maxR, out);
      if (!p) continue;
      const d = Math.hypot(p.x - ax, p.z - az);
      if (!initial && d < 170 && this._visible(p.x, 1, p.z, 4)) continue;
      // keep clear of other cars (and the player)
      let clear = true;
      for (const c of this.list) {
        if (c === v || !c.active) continue;
        const dx = c.pos.x - p.x, dz = c.pos.z - p.z;
        if (dx * dx + dz * dz < 40) { clear = false; break; }
      }
      if (!clear) continue;
      this._releaseModel(v);
      if (v.kind !== 'taxi' && v.kind !== 'police') { v.hex = this._pickColor(v); }
      v.color.setHex(v.hex);
      v.place(p.x, p.z, p.yaw, v.parked ? 0 : 0);
      v.needsRelocate = false; v.copsOut = false; v.ai = null;
      if (!v.parked) {
        v.driver = 'ai';
        initAI(v, p, v.isPolice ? rnd(14, 19) : undefined);
        v.speed = v.ai.cruise * 0.7;
        v.vel.set(Math.sin(v.yaw) * v.speed, 0, Math.cos(v.yaw) * v.speed);
        v.asleep = false;
      } else { v.driver = null; v.asleep = true; }
      v.group.visible = true; v.syncGroup();
      return true;
    }
    return false;
  }

  // ===================================================================== queries
  _rebuildGrid() {
    for (const arr of this.grid.values()) { arr.length = 0; this._gridPool.push(arr); }
    this.grid.clear();
    for (const v of this.list) {
      if (!v.active || v.thrown || v.held) continue;
      const k = this._key(Math.floor(v.pos.x / 10), Math.floor(v.pos.z / 10));
      let a = this.grid.get(k);
      if (!a) { a = this._gridPool.pop() || []; this.grid.set(k, a); }
      a.push(v);
    }
  }
  _key(ix, iz) { return (ix + 1024) * 4096 + (iz + 1024); }
  queryCars(x, z, r, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - r) / 10), x1 = Math.floor((x + r) / 10), z0 = Math.floor((z - r) / 10), z1 = Math.floor((z + r) / 10);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.grid.get(this._key(ix, iz));
      if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
    }
    return out;
  }

  honkOk(v) { return this.time - (v.honkT || -9) > 2.2; }
  honk(v) {
    if (!this.honkOk(v)) return;
    v.honkT = this.time;
    if (v.dist < 90) this.game.audio?.play?.('horn', { pos: v.pos, pitch: 0.85 + Math.random() * 0.3, volume: 0.7 });
  }

  /** Closest enterable car: edge distance <= r. Cars in front of the player are preferred. */
  nearestEnterable(pos, r = 4) {
    const p = this.game.player;
    let best = null, bs = 1e9;
    const fx = p ? Math.sin(p.yaw) : 0, fz = p ? Math.cos(p.yaw) : 1;
    for (const v of this.list) {
      if (!v.active || v.wrecked || v.thrown || v.held || v === this.driving || v.sinking) continue;
      const dx = pos.x - v.pos.x, dz = pos.z - v.pos.z;
      if (dx * dx + dz * dz > (r + 4) * (r + 4)) continue;
      if (Math.abs(pos.y - v.pos.y) > 3.2) continue;
      if (Math.abs(v.speed) > 10) continue;
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
      const lon = dx * sy + dz * cy, lat = dx * -cy + dz * sy;
      const ex = Math.max(0, Math.abs(lat) - v.spec.W / 2), ez = Math.max(0, Math.abs(lon) - v.spec.L / 2);
      const d = Math.hypot(ex, ez);
      if (d > r) continue;
      // prefer what the player faces
      const toX = -dx, toZ = -dz, tl = Math.hypot(toX, toZ) || 1;
      const facing = (toX * fx + toZ * fz) / tl;
      const score = d - facing * 0.8;
      if (score < bs) { bs = score; best = v; }
    }
    return best;
  }

  mapDots() {
    const out = [];
    for (const v of this.list) {
      if (!v.active || !v.isPolice || v.wrecked) continue;
      if (v.dist > 450) continue;
      out.push({ x: v.pos.x, z: v.pos.z, kind: 'police', chasing: !!v.chasing });
    }
    const cops = this.game.peds?.cops;
    if (cops) for (const c of cops) if (c.active && !c.dead) out.push({ x: c.pos.x, z: c.pos.z, kind: 'cop' });
    return out;
  }

  // ===================================================================== enter / exit
  tryInteract() {
    if (this.jack) return true;
    if (this.driving) { this._exit(false); return true; }
    const g = this.game, p = g.player;
    if (!p || p.dead || !p.active) return false;
    if (this.held) { this._dropHeld(false); return true; }
    const v = this.nearestEnterable(p.pos, 4.2);
    if (!v) return false;
    if (p.id === 'hulk') { this._hulkGrab(v); return true; }
    if (v.driver === 'ai') {
      // carjack: hero walks to the driver door, the driver is yanked out
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
      const door = new THREE.Vector3(v.pos.x - (-cy) * (v.spec.W / 2 + 0.7) + sy * 0.4, v.pos.y, v.pos.z - sy * (v.spec.W / 2 + 0.7) + cy * 0.4);
      this.jack = { v, t: 0, door, ejected: false };
      v.driver = null; v.ai = null; v.chasing = false; v.ctrl.t = 0; v.ctrl.b = 1; v.ctrl.hb = true; v.asleep = false;
      g.audio?.play?.('horn', { pos: v.pos, volume: 0.5 });
      return true;
    }
    this._enter(v, !v.owned);
    if (v.parked && Math.random() < 0.25) { this.honk(v); this.honk(v); }
    return true;
  }

  _enter(v, stolen) {
    const g = this.game, p = g.player;
    this.driving = v; v.driver = 'player'; v.asleep = false; v.parked = false; v.invuln = 0.6; v.chasing = false;
    v.ctrl.t = 0; v.ctrl.b = 0; v.ctrl.hb = false;
    p.model.group.visible = false;
    p.vel.set(0, 0, 0);
    const cam = g.cam;
    this._camSave = { d: cam.targetDistance, h: cam.heightOffset, s: cam.shoulder };
    cam.targetDistance = 8.5; cam.heightOffset = 2.2; cam.shoulder = 0;
    this._lookIdle = 0;
    g.audio?.play?.('door');
    g.events.emit('vehicle:enter', { vehicle: v, stolen: !!stolen });
    v.owned = true;
    this._carryHero();
  }

  _carryHero() {
    const v = this.driving, p = this.game.player;
    if (!v || !p) return;
    p.pos.set(v.pos.x, v.pos.y + 0.4, v.pos.z);
    p.vel.set(0, 0, 0);
    p.yaw = v.yaw;
    p.model.group.visible = false;
    p.onGround = true;
  }

  /** forced: ejected by an explosion / river. quiet: no events (reset). */
  _exit(forced = false, quiet = false) {
    const v = this.driving, g = this.game, p = g.player;
    if (!v) return;
    this.driving = null;
    const cam = g.cam;
    if (this._camSave) { cam.targetDistance = this._camSave.d; cam.heightOffset = this._camSave.h; cam.shoulder = this._camSave.s; this._camSave = null; }
    cam.fovKick = 0;
    v.driver = null; v.ctrl.t = 0; v.ctrl.b = 0.4; v.ctrl.s = 0; v.ctrl.hb = false;
    if (p) {
      const spot = this._exitSpot(v, forced);
      p.pos.copy(spot);
      if (forced) p.vel.set(v.vel.x * 0.6, 7, v.vel.z * 0.6); else p.vel.set(v.vel.x * 0.15, 0.5, v.vel.z * 0.15);
      p.yaw = v.yaw; p.onGround = false;
      p.model.group.visible = true;
      p.model.group.position.copy(p.pos);
    }
    if (!quiet) g.events.emit('vehicle:exit', { vehicle: v });
  }

  _exitSpot(v, forced) {
    const phys = this.game.physics;
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const rx = -cy, rz = sy;
    const hw = v.spec.W / 2 + 1.0, hl = v.spec.L / 2 + 1.3;
    const cands = [[-hw, 0.3], [hw, 0.3], [0, -hl], [0, hl], [-hw - 1.5, 0.3], [hw + 1.5, 0.3]];
    if (forced) cands.unshift([-hw - 1, -1.5], [hw + 1, -1.5]);
    for (const [lat, lon] of cands) {
      const x = v.pos.x + rx * lat + sy * lon, z = v.pos.z + rz * lat + cy * lon;
      if (x < L.RIVER_X + 3) continue;
      let ok = true;
      for (const y of [v.pos.y + 0.3, v.pos.y + 1.0, v.pos.y + 1.7]) { if (phys.inside(_v.set(x, y, z))) { ok = false; break; } }
      if (!ok) continue;
      return new THREE.Vector3(x, Math.max(v.pos.y, phys.heightAt(x, z, v.pos.y + 0.8)), z);
    }
    return new THREE.Vector3(v.pos.x, v.pos.y + 3.2, v.pos.z);
  }

  onHeroSwitch(from, to) {
    if (this.held) this._dropHeld(false);
    if (this.driving && to) {
      to.model.group.visible = false;
      this._carryHero();
    }
  }

  // ===================================================================== Hulk: lift & throw
  _hulkGrab(v) {
    const g = this.game;
    if (v.driver === 'ai') { g.peds?.ejectDriver?.(v, v.pos, true); g.events.emit('crime', { severity: 1, pos: v.pos.clone(), kind: 'carjack' }); }
    v.driver = null; v.ai = null; v.held = true; v.asleep = false; v.chasing = false; v.parked = false;
    this.held = v;
    g.hud?.toast?.('Throw: attack / special   Drop: interact');
  }
  _dropHeld(quiet) {
    const v = this.held; if (!v) return;
    this.held = null; v.held = false;
    v.vel.set(0, 0, 0); v.vy = 0; v.pitch = 0; v.roll = 0; v.speed = 0;
    v.pos.y = 0; v.asleep = false; v.invuln = 0.5;
    if (!quiet) v.damage(8, 'drop');
  }
  _throwHeld() {
    const v = this.held, g = this.game, p = g.player;
    if (!v) return;
    this.held = null; v.held = false; v.thrown = true;
    this._attachModel(v);
    const dir = g.cam.aimDirection(new THREE.Vector3()); dir.y = Math.max(dir.y, 0) * 0.5 + 0.12; dir.normalize();
    const pos = v.pos.clone();
    g.audio?.play?.('throw');
    g.combat.projectile({
      pos, vel: dir.multiplyScalar(38), damage: 90, kind: 'rock', mesh: v.group, radius: 2.3, life: 3.2, gravity: 14,
      blast: 7, knockback: 20, up: 9, stun: 1.4, heavy: true, source: p,
      onExpire: (pr) => {
        v.thrown = false; v.pos.copy(pr.pos); v.pos.y = Math.max(0, v.pos.y - 0.2);
        v.hp = 0; v.wrecked = true; v.wreckT = 0; v.roll = (Math.random() < 0.5 ? 1 : -1) * 2.6; v.pitch = 0; v.vel.set(0, 0, 0); v.speed = 0; v.asleep = true; v.vy = 0;
        v.model?.setCharred(true);
        v.group.visible = true;
      },
    });
    g.cam.shake(0.3);
  }

  // ===================================================================== update
  update(dt) {
    if (!this.built || dt <= 0) return;
    const g = this.game;
    this.time += dt; this._frame++;
    this._setAnchor();
    // camera frustum (last frame's matrices) for spawn / lod decisions
    _pm.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    this._rebuildGrid();

    const p = g.player;
    const playing = g.state === 'playing' && p && p.active;
    if (this.jack && playing) this._updateJack(dt);
    else if (this.jack) this.jack = null;
    if (this.held) this._updateHeld(dt, playing);
    if (this.driving && playing) this._driveInput(dt);
    if (this.driving) this._carryHero();

    // chase target
    if (this.driving) { this.chaseTarget.copy(this.driving.pos); this.chaseVel.copy(this.driving.vel); }
    else if (p) { this.chaseTarget.copy(p.pos); this.chaseVel.copy(p.vel); }

    const reloc = this.Q.sim + 10, sim = reloc;
    let nSim = 0;
    const list = this.list;
    this._movers = this._movers || [];
    this._movers.length = 0;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v.active) continue;
      const dxa = v.pos.x - this.anchor.x, dza = v.pos.z - this.anchor.z;
      const d = Math.hypot(dxa, dza);
      v.dist = d;
      if (v.thrown) continue;
      if (v.held) continue;
      const isDriven = v === this.driving;
      if (!isDriven && !(this.jack && this.jack.v === v)) {
        if (v.sinking === 0 && (d > reloc || (v.needsRelocate && !this._visible(v.pos.x, 1, v.pos.z, 4))) && !(v.wrecked && d < reloc)) {
          if (v.reserve && !this.wanted) { this._deactivate(v); continue; }
          if (this._relocate(v)) continue;
        }
      }
      if (d > sim && !isDriven) continue;
      nSim++;
      if (v.invuln > 0) v.invuln -= dt;
      if (v.hitCd > 0) v.hitCd -= dt;
      if (v.wrecked) { this._updateWreck(v, dt); if (!v.asleep) this._move(v, dt); continue; }
      if (v.sinking > 0) { this._updateSinking(v, dt); continue; }

      // control
      if (v.driver === 'ai') driveAI(v, this, dt);
      else if (v.driver === null && !isDriven) {
        v.ctrl.t = 0; v.ctrl.b = Math.abs(v.speed) > 0.2 ? 0.5 : 0; v.ctrl.s = 0; v.ctrl.hb = Math.abs(v.speed) < 3;
      }
      if (v.asleep && v.driver === null && !this.jack) { this._updateDamageFx(v, dt); continue; }
      this._move(v, dt);
      if (Math.abs(v.speed) > 2.5 || isDriven) this._movers.push(v);
      this._updateDamageFx(v, dt);
      // settle back to sleep when parked
      if (v.driver === null && Math.abs(v.speed) < 0.15 && Math.abs(v.slip) < 0.15 && Math.abs(v.yawRate) < 0.05 && !v.airborne) { v.asleep = true; v.vel.set(0, 0, 0); v.speed = 0; }
    }
    this.stats.sim = nSim;

    this._carCollisions(dt);
    this._hitPeopleAndEnemies(dt);
    this._updatePolice(dt);

    // driven-car feedback
    if (this.driving) this._driveFeedback(dt);
    this._updateRender(dt);

    // prompt target for the HUD
    this._promptT -= dt;
    if (this._promptT <= 0) {
      this._promptT = 0.12;
      this.enterable = (!this.driving && playing && !this.jack && !this.held) ? this.nearestEnterable(p.pos, 4.2) : null;
    }
  }

  // ----------------------------------------------------------------- one car: control -> dynamics -> world collision
  _move(v, dt) {
    const phys = this.game.physics;
    v.step(dt);
    // sub-stepped integration + collision against the city boxes
    const dist = Math.hypot(v.vel.x, v.vel.z) * dt;
    const near = v.dist < 150 || v === this.driving;
    let steps = near ? Math.min(6, Math.max(1, Math.ceil(dist / 0.9))) : 1;
    const sdt = dt / steps;
    let maxImpact = 0, hitSide = 0;
    for (let i = 0; i < steps; i++) {
      v.pos.x += v.vel.x * sdt; v.pos.z += v.vel.z * sdt;
      if (near) { const r = this._collideWorld(v); if (r.impact > maxImpact) { maxImpact = r.impact; hitSide = r.side; } }
    }
    // bounds
    const b = this.game.world?.bounds;
    if (b) {
      if (v.pos.x < b.minX + 3) { v.pos.x = b.minX + 3; if (v.vel.x < 0) v.vel.x *= -0.2; }
      else if (v.pos.x > b.maxX - 3) { v.pos.x = b.maxX - 3; if (v.vel.x > 0) v.vel.x *= -0.2; }
      if (v.pos.z < b.minZ + 3) { v.pos.z = b.minZ + 3; if (v.vel.z < 0) v.vel.z *= -0.2; }
      else if (v.pos.z > b.maxZ - 3) { v.pos.z = b.maxZ - 3; if (v.vel.z > 0) v.vel.z *= -0.2; }
    }
    // vertical
    let gF = 0, gR = 0, gC = 0;
    if (near) {
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), lim = v.pos.y + 0.7, hh = v.spec.wb * 0.5;
      gF = phys.heightAt(v.pos.x + sy * hh, v.pos.z + cy * hh, lim);
      gR = phys.heightAt(v.pos.x - sy * hh, v.pos.z - cy * hh, lim);
      gC = phys.heightAt(v.pos.x, v.pos.z, lim);
    }
    const landed = v.vertical(dt, gF, gR, gC);
    if (landed > 5) { maxImpact = Math.max(maxImpact, landed * 0.6); this._crashFx(v, landed * 0.7, 0); }
    // river
    if (v.pos.x < L.RIVER_X - 1 && v.pos.y < 0.6 && gC < 0.2 && !v.airborne && v.sinking === 0) {
      v.sinking = 0.001; v.invuln = 99;
      this.game.fx?.burst?.(v.pos, 0xcfe8ff, 24, 6, 0.8, 0.5);
      this.game.fx?.ring?.(_v.set(v.pos.x, 0.2, v.pos.z), 5, 0xcfe8ff);
      this.game.audio?.play?.('splash', { pos: v.pos });
    }
    if (maxImpact > 4) {
      const dmg = Math.pow(maxImpact - 4, 1.55) * 0.6;
      if (v.hitCd <= 0) {
        v.hitCd = 0.15;
        v.damage(dmg, 'crash');
        this._crashFx(v, maxImpact, hitSide);
        if (v.driver === 'ai') { v.ai && (v.ai.blockedT = 0); this.honk(v); }
      }
    }
    // wheel animation / group sync are done in _updateRender
  }

  _collideWorld(v) {
    const phys = this.game.physics, sp = v.spec;
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const rx = -cy, rz = sy;
    let impact = 0, side = 0;
    const cy0 = v.pos.y + 1.0;
    for (let i = 0; i < sp.cols.length; i++) {
      const o = sp.cols[i];
      const ox = v.pos.x + sy * o, oz = v.pos.z + cy * o;
      _v.set(ox, cy0, oz);
      _w.set(v.vel.x, 0, v.vel.z);
      phys.resolveSphere(_v, sp.R, _w);
      const dx = _v.x - ox, dz = _v.z - oz;
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      const l = Math.sqrt(l2), nx = dx / l, nz = dz / l;
      v.pos.x += dx; v.pos.z += dz;
      const vn = v.vel.x * nx + v.vel.z * nz;
      if (vn < 0) {
        const imp = -vn;
        const rest = imp > 6 ? 0.28 : 0.05;
        v.vel.x -= (1 + rest) * vn * nx; v.vel.z -= (1 + rest) * vn * nz;
        // glancing blows keep some speed, head-on ones lose most of it (handled by the normal removal)
        const nr = nx * rx + nz * rz;
        v.yawRate += -o * nr * imp * 0.055 + (o === 0 ? -nr * imp * 0.02 : 0);
        if (imp > impact) { impact = imp; side = nr; }
        if (v.driver === 'ai') v.ai && (v.ai.stuckT += 0.1);
      }
    }
    return { impact, side };
  }

  _crashFx(v, impact, side) {
    const g = this.game;
    if (impact < 4) return;
    const big = impact > 11;
    g.fx?.sparks?.(_v.set(v.pos.x, v.pos.y + 0.7, v.pos.z), _w.set(0, 1, 0), 0xffd080, big ? 14 : 6, 7, 0.3, 0.1);
    if (big) g.fx?.dust?.(v.pos, 8, 2.5);
    if (v.dist < 70) {
      g.audio?.play?.('crash', { pos: v.pos, volume: clamp(impact / 16, 0.3, 1.2) });
      if (big) g.audio?.play?.('heavyhit', { pos: v.pos, volume: 0.8 });
    }
    if (v === this.driving) {
      g.cam.shake(clamp(impact * 0.035, 0.1, 0.9));
      g.input.rumble(clamp(impact / 16, 0.3, 1), clamp(impact / 20, 0.2, 0.8), 160 + impact * 8);
    }
  }

  _updateDamageFx(v, dt) {
    const g = this.game, fx = g.fx;
    const frac = v.hp / v.maxHp;
    if (!(frac < 0.3) || v.wrecked) return;
    v.smokeT -= dt;
    if (v.smokeT > 0) return;
    const near = v.dist < 130;
    v.smokeT = frac < 0.1 ? 0.05 : 0.1;
    if (!near) { if (frac < 0.1) v.damage(3.5 * 0.1, 'fire'); return; }
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    _v.set(v.pos.x + sy * v.spec.L * 0.32, v.pos.y + 1.0, v.pos.z + cy * v.spec.L * 0.32);
    fx?.smoke?.(_v, frac < 0.1 ? 1.3 : 0.9, frac < 0.1 ? 1.5 : 1.1, _w.set(0, 1.8, 0), frac < 0.1 ? 0.03 : 0.2);
    if (frac < 0.1) {
      fx?.burst?.(_v, 0xff7a20, 3, 3.5, 0.45, 0.35);
      fx?.glow?.(_v, 0xff9030, 1.4, 0.2);
      if (Math.random() < 0.12) fx?.flash?.(_v, 0xff7a20, 3, 0.15);
      v.damage(3.5 * 0.1 * (v.driver === 'player' ? 0.9 : 1), 'fire');
    }
  }

  _updateWreck(v, dt) {
    v.wreckT += dt;
    v.ctrl.t = 0; v.ctrl.b = 0; v.ctrl.hb = true;
    if (v.wreckT < 25 && v.dist < 140 && Math.random() < dt * 6) {
      const fx = this.game.fx;
      _v.set(v.pos.x + rnd(-0.8, 0.8), v.pos.y + 1.1, v.pos.z + rnd(-1, 1));
      fx?.smoke?.(_v, 1.2, 1.4, _w.set(0, 2.2, 0), 0.04);
      if (v.wreckT < 12) fx?.burst?.(_v, 0xff6a18, 2, 2.5, 0.4, 0.3);
    }
    if (Math.abs(v.speed) < 0.15 && !v.airborne) v.asleep = true;
    if (v.wreckT > 50 && !this._visible(v.pos.x, 1, v.pos.z, 4)) v.needsRelocate = true;
    if (v.wreckT > 80) v.needsRelocate = true;
    if (v.needsRelocate && v.dist < this.Q.sim) {
      // vanish in a puff instead of popping
      if (v.wreckT > 80) { this.game.fx?.smoke?.(_v.set(v.pos.x, 1, v.pos.z), 2, 1.2, null, 0.1); v.parked = Math.random() < 0.3; this._relocate(v); }
    }
  }

  _updateSinking(v, dt) {
    v.sinking += dt;
    v.vel.multiplyScalar(Math.max(0, 1 - 1.8 * dt)); v.speed *= 0.9;
    v.pos.y -= 1.0 * dt; v.pitch += 0.4 * dt; v.roll += 0.3 * dt;
    v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
    if (Math.random() < dt * 8) this.game.fx?.burst?.(_v.set(v.pos.x, 0.1, v.pos.z), 0xcfe8ff, 3, 2.5, 0.6, 0.3);
    if (v.sinking > 1.6) {
      if (v === this.driving) {
        this._exit(true);
        const p = this.game.player;
        p.pos.set(L.RIVER_X + 9, 0.3, v.pos.z); p.vel.set(3, 7, 0);
        this.game.hud?.toast?.('Car sunk! Swam to the quay');
      }
      v.sinking = 0; v.invuln = 0; v.pitch = v.roll = 0; v.vel.set(0, 0, 0);
      v.parked = Math.random() < 0.3; v.hp = v.maxHp; v.wrecked = false;
      this._releaseModel(v);
      if (!this._relocate(v)) { this._deactivate(v); }
    }
  }

  // ----------------------------------------------------------------- explosion
  explodeVehicle(v, src = 'crash') {
    if (v.wrecked) return;
    const g = this.game;
    v.wrecked = true; v.wreckT = 0; v.hp = 0; v.chasing = false;
    const wasDriver = v.driver;
    v.ai = null; v.ctrl.t = 0; v.ctrl.b = 0; v.ctrl.hb = true;
    _v.set(v.pos.x, v.pos.y + 0.9, v.pos.z);
    g.fx?.explosion?.(_v, 5.5, 0xffa040);
    g.audio?.play?.('explosion', { pos: v.pos });
    g.combat?.aoe?.({ center: _v.clone(), radius: 7.5, damage: 60, knockback: 15, up: 9, stun: 1.2, team: 'player', source: null });
    g.peds?.blast?.(v.pos, 9);
    for (const c of this.list) {
      if (c === v || !c.active || c.wrecked) continue;
      const dx = c.pos.x - v.pos.x, dz = c.pos.z - v.pos.z, d = Math.hypot(dx, dz);
      if (d > 9) continue;
      c.asleep = false;
      c.vel.x += dx / (d || 1) * 7; c.vel.z += dz / (d || 1) * 7;
      c.damage(55 * (1 - d / 9), 'blast');
    }
    const p = g.player;
    if (this.driving === v) {
      this._exit(true);
      p.takeDamage?.(32, v.pos);
      g.cam.shake(1.0);
      g.input.rumble(1, 1, 400);
    } else if (p && !this.driving && Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z) < 7) {
      p.takeDamage?.(22, v.pos);
    }
    v.driver = null;
    v.vy = 7; v.airborne = true; v.yawRate += rnd(-2, 2); v.asleep = false;
    v.vel.x *= 0.4; v.vel.z *= 0.4;
    this._releaseModelCharred(v);
    if (wasDriver === 'ai' && src !== 'drop') { /* the driver is not simulated; he is just gone */ }
    if (v.isPolice) this.addCrime('cop_car', 1, v.pos, true);
  }

  // ----------------------------------------------------------------- driven car
  _driveInput(dt) {
    const v = this.driving, inp = this.game.input;
    const c = v.ctrl;
    c.t = inp.value('throttle'); c.b = inp.value('brake'); c.s = inp.move.x; c.hb = inp.down('handbrake');
    if (Math.abs(c.s) < 0.05) c.s = 0;
    if (inp.down('horn')) {
      this._hornT -= dt;
      if (this._hornT <= 0) { this._hornT = 0.42; this.game.audio?.play?.('horn', { pos: v.pos, volume: 1 }); this.game.peds?.scare?.(v.pos, 12, 'horn'); }
    } else this._hornT = 0;
    // camera: free look, auto re-centre behind the car after 1.5 s without look input
    const cam = this.game.cam;
    if (inp.look.x * inp.look.x + inp.look.y * inp.look.y > 1e-6 || inp.down('recenter') || this.game.weapons?.drivebyAiming) this._lookIdle = 0; else this._lookIdle += dt;
    if (this._lookIdle > 1.5) {
      const k = 1 - Math.exp(-2.6 * dt);
      cam.yaw += wrapPi(v.yaw + Math.PI - cam.yaw) * k;
      cam.pitch += (-0.17 - cam.pitch) * k;
    }
    cam.fovKick = clamp((Math.abs(v.speed) - 30) * 0.2, 0, 8) * 0.5 + (c.hb && Math.abs(v.slip) > 3 ? 1.5 : 0);
    cam.targetDistance = 8.5 + Math.min(2.5, Math.abs(v.speed) * 0.04);
  }

  _driveFeedback(dt) {
    const v = this.driving, g = this.game;
    this._rumbleT -= dt;
    if (this._rumbleT <= 0 && g.input.lastDevice === 'gamepad') {
      this._rumbleT = 0.28;
      const sl = Math.min(1, Math.abs(v.slip) / 8);
      g.input.rumble(sl * 0.35, 0.03 + 0.09 * Math.min(1, Math.abs(v.speed) / v.spec.vmax) + sl * 0.3, 320);
    }
    // tire smoke
    if (!v.airborne && (Math.abs(v.slip) > 4.5 || (v.ctrl.hb && Math.abs(v.speed) > 9))) {
      v.slipT -= dt;
      if (v.slipT <= 0) {
        v.slipT = 0.05;
        const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), rx = -cy, rz = sy, bz = -v.spec.wb * 0.5;
        for (const sx of [-1, 1]) {
          _v.set(v.pos.x + sy * bz + rx * sx * 0.85, v.pos.y + 0.15, v.pos.z + cy * bz + rz * sx * 0.85);
          g.fx?.smoke?.(_v, 0.7, 0.7, _w.set(rx * sx * 0.5, 0.6, 0), 0.5);
        }
        g.audio?.play?.('skid', { pos: v.pos, volume: 0.5 });
      }
    }
  }

  // ----------------------------------------------------------------- carjack animation
  _updateJack(dt) {
    const j = this.jack, g = this.game, p = g.player, v = j.v;
    j.t += dt;
    v.ctrl.t = 0; v.ctrl.b = 1; v.ctrl.hb = true; v.ctrl.s = 0;
    // refresh the door position (car may still be rolling)
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    j.door.set(v.pos.x + cy * (v.spec.W / 2 + 0.7) + sy * 0.4, v.pos.y, v.pos.z - sy * (v.spec.W / 2 + 0.7) + cy * 0.4);
    const k = 1 - Math.exp(-14 * dt);
    p.pos.x += (j.door.x - p.pos.x) * k; p.pos.z += (j.door.z - p.pos.z) * k;
    p.vel.set(0, 0, 0);
    p.faceTowards?.(_v.set(v.pos.x - p.pos.x, 0, v.pos.z - p.pos.z), dt, 16);
    p.setAnim?.('punch1', 1);
    if (!j.ejected && j.t > 0.2) {
      j.ejected = true;
      g.peds?.ejectDriver?.(v, j.door, false);
      g.audio?.play?.('door');
      g.audio?.play?.('hit', { pos: v.pos });
      g.events.emit('crime', { severity: 1, pos: v.pos.clone(), kind: 'carjack' });
    }
    if (j.t >= 0.8) {
      this.jack = null;
      v.hp = Math.max(v.hp, v.maxHp * 0.25);
      this._enter(v, true);
    }
  }

  _updateHeld(dt, playing) {
    const v = this.held, g = this.game, p = g.player;
    if (!playing || !p || p.id !== 'hulk') { this._dropHeld(false); return; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    v.pos.set(p.pos.x + sy * 0.6, p.pos.y + 3.3 + 0.1 * Math.sin(this.time * 6), p.pos.z + cy * 0.6);
    v.yaw = p.yaw; v.pitch = 0.18; v.roll = 0.1 * Math.sin(this.time * 5);
    v.dist = 0; this._attachModel(v); v.syncGroup(); v.group.visible = true;
    const inp = g.input;
    if (inp.pressed('attack') || inp.pressed('special')) this._throwHeld();
  }

  // ----------------------------------------------------------------- car <-> car
  _carCollisions(dt) {
    const list = this.list;
    const cars = this._tmpCars;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.active || a.asleep || a.thrown || a.held || a.dist > 160 || a.sinking) continue;
      this.queryCars(a.pos.x, a.pos.z, 7, cars);
      for (let k = 0; k < cars.length; k++) {
        const b = cars[k];
        if (b === a || b.thrown || b.sinking) continue;
        if (!b.asleep && b.id < a.id) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const reach = a.spec.L * 0.5 + b.spec.L * 0.5;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.8) continue;
        this._collidePair(a, b);
      }
    }
  }

  _collidePair(a, b) {
    const sa = a.spec, sb = b.spec;
    const asy = Math.sin(a.yaw), acy = Math.cos(a.yaw), bsy = Math.sin(b.yaw), bcy = Math.cos(b.yaw);
    let best = 0, nx = 0, nz = 0, cx = 0, cz = 0;
    const ra = sa.R, rb = sb.R;
    for (const oa of sa.cols) {
      const ax = a.pos.x + asy * oa, az = a.pos.z + acy * oa;
      for (const ob of sb.cols) {
        const bx = b.pos.x + bsy * ob, bz = b.pos.z + bcy * ob;
        const dx = ax - bx, dz = az - bz;
        const d2 = dx * dx + dz * dz, rr = ra + rb;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.001, pen = rr - d;
        if (pen > best) { best = pen; nx = dx / d; nz = dz / d; cx = (ax + bx) / 2; cz = (az + bz) / 2; }
      }
    }
    if (best <= 0) return;
    a.asleep = false; b.asleep = false;
    const ima = 1 / sa.mass, imb = 1 / sb.mass, sum = ima + imb;
    const bAnch = b.driver === null && b.asleep === false && Math.abs(b.speed) < 0.1 ? 1 : 1;
    void bAnch;
    a.pos.x += nx * best * (ima / sum); a.pos.z += nz * best * (ima / sum);
    b.pos.x -= nx * best * (imb / sum); b.pos.z -= nz * best * (imb / sum);
    const vrel = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
    if (vrel >= 0) return;
    const imp = -vrel;
    const j = (1.28 * imp) / sum;
    a.vel.x += nx * j * ima; a.vel.z += nz * j * ima;
    b.vel.x -= nx * j * imb; b.vel.z -= nz * j * imb;
    // spin from off-centre hits
    const iA = (sa.L * sa.L + sa.W * sa.W) / 12 * 0.8, iB = (sb.L * sb.L + sb.W * sb.W) / 12 * 0.8;
    a.yawRate += ((cz - a.pos.z) * nx - (cx - a.pos.x) * nz) * j * ima / iA * 0.6;
    b.yawRate += ((cz - b.pos.z) * -nx - (cx - b.pos.x) * -nz) * j * imb / iB * 0.6;
    a.yawRate = clamp(a.yawRate, -4, 4); b.yawRate = clamp(b.yawRate, -4, 4);
    if (imp > 3) {
      const base = Math.pow(imp - 3, 1.45) * 0.9;
      const wa = sb.mass / (sa.mass + sb.mass), wb = sa.mass / (sa.mass + sb.mass);
      // traffic-on-traffic fender benders never wreck a car on their own; the player's collisions are real
      const real = a === this.driving || b === this.driving || a.chasing || b.chasing || a.held || b.held;
      const soft = (v, dmg) => (real ? dmg : Math.min(dmg * 0.5, Math.max(0, v.hp - v.maxHp * 0.45)));
      if (a.hitCd <= 0) { a.hitCd = 0.15; a.damage(soft(a, base * wa * 1.6), 'crash'); }
      if (b.hitCd <= 0) { b.hitCd = 0.15; b.damage(soft(b, base * wb * 1.6), 'crash'); }
      this._crashFx(a, imp, 0);
      if (b === this.driving) this._crashFx(b, imp, 0);
      if (a.driver === 'ai') { this.honk(a); if (a.ai) { a.ai.blockedT = 0; } }
      if (b.driver === 'ai') this.honk(b);
      this.game.fx?.sparks?.(_v.set(cx, a.pos.y + 0.7, cz), _w.set(nx, 0.3, nz), 0xffd080, 8, 6, 0.3, 0.1);
      if (this.driving && (a === this.driving || b === this.driving) && ((a.isPolice && a.chasing) || (b.isPolice && b.chasing))) this.game.cam.shake(0.15);
    }
  }

  // ----------------------------------------------------------------- cars vs pedestrians / enemies / the on-foot player
  _hitPeopleAndEnemies(dt) {
    const g = this.game, peds = g.peds, enemies = g.enemies?.list;
    const p = g.player;
    const movers = this._movers;
    for (let m = 0; m < movers.length; m++) {
      const v = movers[m];
      if (v.dist > 120 && v !== this.driving) continue;
      const sp = Math.abs(v.speed);
      if (sp < 2.5) continue;
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), rx = -cy, rz = sy;
      const hl = v.spec.L * 0.5 + 0.25, hw = v.spec.W * 0.5 + 0.3;
      const dirSign = Math.sign(v.speed) || 1;
      if (peds) {
        const pl = peds.list;
        for (let i = 0; i < pl.length; i++) {
          const q = pl[i];
          if (!q.active || q.hidden || q.dead || q.airTime > 0.3 || q.carCd > 0) continue;
          const dx = q.pos.x - v.pos.x, dz = q.pos.z - v.pos.z;
          if (dx * dx + dz * dz > 36) continue;
          const lon = dx * sy + dz * cy, lat = dx * rx + dz * rz;
          if (Math.abs(lon) > hl + 0.3 || Math.abs(lat) > hw + q.radius) continue;
          if (Math.abs(q.pos.y - v.pos.y) > 1.8) continue;
          if (lon * dirSign < -hl * 0.3 && sp < 6) continue; // got touched by the rear only at low speed
          const res = peds.hitByCar(q, v, sp, dirSign);
          if (v.driver === 'player') {
            g.events.emit('crime', { severity: 1, pos: q.pos.clone(), kind: res?.killed ? 'ped_killed' : 'ped_hit' });
          }
          if (sp > 12) v.damage(sp * 0.12, 'ped');
          g.cam.shake(v === this.driving ? 0.12 : 0.03);
          if (v === this.driving) g.input.rumble(0.4, 0.5, 90);
          if (v.driver === 'ai') this.honk(v);
        }
      }
      // enemies: only the player's car (or a police car) bowls them over
      if (enemies && v === this.driving && sp > 5) {
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (!e.alive) continue;
          if ((e._carHitT || 0) > this.time) continue;
          const dx = e.pos.x - v.pos.x, dz = e.pos.z - v.pos.z;
          if (dx * dx + dz * dz > 49) continue;
          const lon = dx * sy + dz * cy, lat = dx * rx + dz * rz;
          if (Math.abs(lon) > hl + e.radius || Math.abs(lat) > hw + e.radius) continue;
          e._carHitT = this.time + 0.6;
          _v.set(sy * dirSign * sp * 0.9 + rx * lat * 1.2, 6 + sp * 0.12, cy * dirSign * sp * 0.9 + rz * lat * 1.2);
          e.takeDamage?.(Math.min(80, sp * 2.4), { knockback: _v.clone(), stun: 1.3, source: p, kind: 'vehicle' });
          g.fx?.hitSpark?.(e.center ?? e.pos, 0xffd070, true);
          g.audio?.play?.('heavyhit', { pos: e.pos });
          g.cam.shake(0.25); g.input.rumble(0.7, 0.5, 120);
          v.damage(2 + sp * 0.12, 'enemy');
        }
      }
      // AI / police cars running the on-foot player over
      if (p && !this.driving && v.driver === 'ai' && p.active && !p.dead && !this.jack) {
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
        if (dx * dx + dz * dz < 36 && Math.abs(p.pos.y - v.pos.y) < 1.6) {
          const lon = dx * sy + dz * cy, lat = dx * rx + dz * rz;
          if (Math.abs(lon) < hl + p.radius && Math.abs(lat) < hw + p.radius && lon * dirSign > -hl * 0.4 && sp > 4) {
            _v.set(sy * dirSign, 0, cy * dirSign);
            if (p.takeDamage?.(Math.min(35, 6 + sp * 1.1), _w.set(p.pos.x - _v.x * 2, p.pos.y, p.pos.z - _v.z * 2))) {
              p.vel.x += _v.x * sp * 0.7; p.vel.z += _v.z * sp * 0.7; p.vel.y = Math.max(p.vel.y, 6);
              p.onGround = false;
            }
          }
        }
      }
    }
  }

  // ===================================================================== wanted level + police
  addCrime(kind, severity = 1, pos = null, silent = false) {
    const cd = { carjack: 2, ped_hit: 4, ped_killed: 4, shots: 9, cop_hit: 2.5, cop_car: 6 };
    const grp = (kind === 'ped_hit' || kind === 'ped_killed') ? 'ped' : kind;
    const last = this._lastCrime[grp] ?? -99;
    if (this.time - last < (cd[kind] ?? 2)) return;
    this._lastCrime[grp] = this.time;
    const before = this.wanted;
    this.wanted = Math.min(5, this.wanted + Math.max(1, Math.round(severity)));
    this._unseenT = 0; this._lastCrimeT = this.time;
    if (this.wanted > before && !silent) this.game.hud?.toast?.(`Wanted ${'*'.repeat(this.wanted)}`);
  }

  _onGunfire(e) {
    const g = this.game, peds = g.peds;
    if (!peds || !e?.pos) return;
    peds.scare?.(e.pos, 38, 'gun');
    if (this.time - (this._lastCrime.shots ?? -99) < 9) return;
    let near = false;
    for (const q of peds.list) {
      if (!q.active || q.hidden || q.dead || q.cop) continue;
      const dx = q.pos.x - e.pos.x, dz = q.pos.z - e.pos.z;
      if (dx * dx + dz * dz < 28 * 28) { near = true; break; }
    }
    if (near && Math.random() < 0.4) this.addCrime('shots', 1, e.pos);
  }

  _updatePolice(dt) {
    const g = this.game;
    const wanted = this.wanted;
    const target = this.chaseTarget;
    this._policeT -= dt;
    const cops = [];
    for (const v of this.list) if (v.active && v.isPolice && !v.wrecked && !v.thrown && !v.held) cops.push(v);

    // who sees the player (for star decay)
    let seen = false;
    if (wanted > 0) {
      for (const v of cops) {
        const d = Math.hypot(v.pos.x - target.x, v.pos.z - target.z);
        if (d < 28 || (d < 75 && g.physics.lineOfSight(_v.set(v.pos.x, 1.2, v.pos.z), _w.set(target.x, target.y + 1, target.z)))) { seen = true; break; }
      }
      if (!seen && g.peds?.copsSee?.(target, 70)) seen = true;
      if (seen) this._unseenT = 0; else if (this.time - this._lastCrimeT > 6) this._unseenT += dt;
      if (this._unseenT > 25) {
        this._unseenT = 0; this.wanted = Math.max(0, this.wanted - 1);
        g.hud?.toast?.(this.wanted ? `Wanted level down: ${'*'.repeat(this.wanted)}` : 'Wanted level cleared');
      }
    } else this._unseenT = 0;

    // pick the chasers: closest police cars
    if (wanted > 0) {
      cops.sort((a, b) => a.dist - b.dist);
      let n = 0;
      for (const v of cops) {
        const ok = n < MAX_CHASERS && v.dist < 380 && v.driver === 'ai';
        if (ok && !v.chasing) { v.chasing = true; if (!v.ai) this._giveAI(v); }
        else if (!ok) v.chasing = false;
        if (v.chasing) n++;
      }
      // reinforcements
      const want = Math.min(MAX_CHASERS, 1 + wanted);
      if (n < want && this._policeT <= 0) {
        this._policeT = 2.2;
        const r = this.list.find((v) => v.reserve && !v.active);
        if (r) this._spawnPolice(r);
      }
    } else {
      for (const v of cops) {
        v.chasing = false;
        if (v.reserve && v.dist > 140 && !this._visible(v.pos.x, 1, v.pos.z, 4)) this._deactivate(v);
      }
      g.peds?.dismissCops?.();
    }

    // sirens + on-foot arrests-lite: cruisers park next to the hero and the cops get out
    this._sirenT -= dt;
    for (const v of cops) {
      if (!v.chasing) continue;
      if (this._sirenT <= 0 && v.dist < 110) { g.audio?.play?.('siren', { pos: v.pos, volume: 0.7 }); this._sirenT = 1.1; }
      if (!this.driving && !v.copsOut && v.dist < 40) {
        const d = Math.hypot(v.pos.x - target.x, v.pos.z - target.z);
        if (d < 24 && Math.abs(v.speed) < 5) { v.copsOut = true; g.peds?.spawnCops?.(v, 2); }
      }
      if (this.driving && v.copsOut) v.copsOut = false;
    }
  }

  _giveAI(v) {
    const p = snapToLane(v.pos.x, v.pos.z, v.yaw, 0);
    initAI(v, p, rnd(16, 22));
    v.driver = 'ai';
  }

  _spawnPolice(v) {
    const ax = this.anchor.x, az = this.anchor.z;
    const out = this._pl || (this._pl = {});
    for (let tries = 0; tries < 10; tries++) {
      const p = randomLanePlacement(ax, az, 90, 170, out);
      if (!p) continue;
      if (this._visible(p.x, 1, p.z, 4) && Math.hypot(p.x - ax, p.z - az) < 150) continue;
      v.parked = false; v.active = true; v.reserve = true;
      this._releaseModel(v);
      v.hex = POLICE_WHITE; v.color.setHex(v.hex);
      v.place(p.x, p.z, p.yaw, 0);
      v.driver = 'ai'; v.needsRelocate = false; v.copsOut = false;
      initAI(v, p, rnd(18, 24));
      v.speed = 12; v.vel.set(Math.sin(v.yaw) * 12, 0, Math.cos(v.yaw) * 12); v.asleep = false;
      v.chasing = true; v.group.visible = true; v.syncGroup();
      return true;
    }
    return false;
  }

  // ===================================================================== rendering: instanced far LOD / full near models
  _acquireModel(kind) {
    const pool = this._modelPool[kind] || (this._modelPool[kind] = []);
    return pool.pop() || new CarModel(kind);
  }
  _attachModel(v) {
    if (v.model) return;
    const m = this._acquireModel(v.kind);
    m.setPaint(v.hex);
    v.group.add(m.root);
    v.model = m;
    m.setCharred(!!v.wrecked);
  }
  _releaseModel(v) {
    const m = v.model; if (!m) return;
    v.group.remove(m.root);
    m.setCharred(false); m.siren(false, 0); m.setBrake(false);
    (this._modelPool[v.kind] || (this._modelPool[v.kind] = [])).push(m);
    v.model = null;
  }
  _releaseModelCharred(v) { if (v.model) v.model.setCharred(true); }

  _updateRender(dt) {
    const inst = this.instancer;
    inst.begin();
    const Q = this.Q;
    // candidates for full models
    const cand = this._cand || (this._cand = []);
    cand.length = 0;
    for (const v of this.list) {
      if (!v.active || v.thrown || v.held) continue;
      const lim = v.model ? Q.nearR + 12 : Q.nearR;
      if (v.dist < lim) cand.push(v);
      else if (v.model) this._releaseModel(v);
    }
    cand.sort((a, b) => a.dist - b.dist);
    let near = 0, far = 0;
    const cap = Q.near;
    const drivenForce = this.driving;
    for (let i = 0; i < cand.length; i++) {
      const v = cand[i];
      const isNear = i < cap || v === drivenForce;
      if (!isNear) { if (v.model) this._releaseModel(v); continue; }
      if (!v.model && !v.wrecked && !this._visible(v.pos.x, v.pos.y + 1, v.pos.z, 4) && v.dist > 14) { continue; } // not in view: let it stay instanced
      this._attachModel(v);
    }
    for (const v of this.list) {
      if (!v.active || v.thrown || v.held) continue;
      v.syncGroup();
      if (v.model) {
        near++;
        v.group.visible = true;
        const m = v.model, c = v.ctrl;
        m.wheelsUpdate(v.steerAng, v.rolled || 0);
        m.setBrake(!v.wrecked && (c.b > 0.15 || c.hb || (v.driver === null && Math.abs(v.speed) > 0.5 && c.b > 0)));
        if (m.extras.red) m.siren(v.chasing && !v.wrecked, this.time);
      } else {
        far++;
        v.group.visible = false;
        inst.add(v.kind, v.pos.x, v.pos.y, v.pos.z, v.yaw, v.pitch, v.wrecked ? 0 : 0, v.wrecked ? _col.setHex(0x161616) : v.color);
      }
    }
    // held / thrown cars keep their full model visible
    inst.end();
    this.stats.near = near; this.stats.far = far;
  }
}
