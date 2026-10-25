// SingaporeWorld: Marina Bay map. Same public API as src/world/index.js (World).
import * as THREE from 'three';
import { Bucket, ChunkSet, mulberry32 } from '../geo.js';
import { SgChunks } from './chunks.js';
import { makeTextures, SHOP_DEFS } from '../textures.js';
import { makeMaterials } from '../materials.js';
import { resolveQuality } from '../../render/quality.js';
import { L, BAY, inBay, inWater, AVE, STR, MBS, MERLION, ESPL } from './layout.js';
import { buildRoadData, buildRoadMeshes, TrafficLights } from './roads.js';
import { buildCity, buildOuterBlocks, buildMarinaSouth } from './city.js';
import { buildMBS, buildArtScience, buildHelix, buildMerlion, buildFullerton, buildEsplanade, makeDurianMeshes, buildFlyer, makeFlyerWheel } from './landmarks.js';
import { buildGardens, makeSupertrees } from './gardens.js';
import { makeProps } from './props.js';
import { LightShow, Spout, Rain } from './fx.js';
import { makeBayWater } from './water.js';
import { TropicalAtmosphere } from './atmo.js';
import { addBox, emitBox } from './builders.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function groundMesh(mat, tile) {
  const shape = new THREE.Shape();
  const X0 = -1600, X1 = L.COAST, Z0 = -1600, Z1 = 1600;
  shape.moveTo(X0, -Z1); shape.lineTo(X1, -Z1); shape.lineTo(X1, -Z0); shape.lineTo(X0, -Z0); shape.closePath();
  shape.holes.push(new THREE.Path(BAY.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

export class SingaporeWorld {
  constructor(game) {
    this.game = game;
    this.id = 'singapore';
    this.bounds = { minX: L.MINX, maxX: L.MAXX, minZ: L.MINZ, maxZ: L.MAXZ };
    this.spawnPoint = { pos: new THREE.Vector3(MBS.x, 205.1, -55), yaw: -Math.PI * 0.75 };
    this.menuFocus = new THREE.Vector3(MBS.x, 120, 40);
    this.menuCamera = { pos: new THREE.Vector3(-200, 60, -120), target: new THREE.Vector3(MBS.x, 110, 40) };
    this.landmarks = {};
    this.minimap = { size: 1850, minX: L.MINX, maxX: L.MAXX, minZ: L.MINZ, maxZ: L.MAXZ, buildings: [], water: { polygon: BAY, seaMinX: L.COAST }, park: null, landmarks: {}, shops: [] };
    this.driveSide = 'left';
    this.time = 0;
    this.group = new THREE.Group();
    this.specs = [];
    this.atmo = null;
    this.rainOn = false;
  }

  async build(onProgress = () => {}) {
    const { scene, physics, renderer } = this.game;
    const quality = resolveQuality(renderer, this.game.settings?.quality ?? 'high');
    this.quality = quality;
    const low = quality === 'low';
    const rng = mulberry32(19650809);
    scene.add(this.group);

    const T = makeTextures(renderer, rng, quality);
    const { M: M0, wallMats } = makeMaterials(T, quality);
    const M = { ...M0 };
    const Mat = (o) => (low ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, ...o }));
    M.road = M0.asphalt.clone();
    M.road.polygonOffset = true; M.road.polygonOffsetFactor = -2; M.road.polygonOffsetUnits = -2;
    M.white = Mat({ vertexColors: true, roughness: 0.5, metalness: 0.05, envMapIntensity: 1.0 });
    M.night = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(0.2, 0.2, 0.2) });
    M.beacon = new THREE.MeshBasicMaterial({ vertexColors: true });
    M.pool = low ? new THREE.MeshBasicMaterial({ color: 0x35b6ff }) : new THREE.MeshStandardMaterial({ color: 0x2aa8f0, emissive: 0x0b86e8, emissiveIntensity: 1.1, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.5 });
    M.sidewalk = M0.sidewalk.clone(); M.sidewalk.color.setRGB(1.7, 1.7, 1.65);
    M.roof = M0.roof.clone(); M.roof.color.setRGB(1.9, 1.9, 1.9);
    this.mats = M;
    onProgress(0.1); await tick();

    const atmo = this.atmo = new TropicalAtmosphere(this.game, quality);
    atmo.registerWalls(wallMats);
    atmo.setTime(atmo.t);
    onProgress(0.2); await tick();

    const reflect = !low;
    const ctx = {
      rng, rng2: mulberry32(4242), physics, quality, T, M, group: this.group, landmarks: this.landmarks,
      chunks: new SgChunks(800), refl: reflect ? new ChunkSet(1e7) : null, pool: null,
      specs: this.specs, minimapB: this.minimap.buildings, minimapPark: [], palmSpots: [], detail: !low,
      isWater: inWater,
    };
    ctx.pool = ctx.chunks.bucket(MBS.x, 100, 'pool');

    buildMBS(ctx); buildArtScience(ctx); buildHelix(ctx); buildMerlion(ctx); buildFullerton(ctx); buildEsplanade(ctx); buildFlyer(ctx);
    onProgress(0.3); await tick();
    buildGardens(ctx);
    onProgress(0.4); await tick();
    buildCity(ctx); buildOuterBlocks(ctx); buildMarinaSouth(ctx);
    onProgress(0.55); await tick();

    // roads + signals
    this.shops = this._buildShops(ctx);
    this.roads = buildRoadData(this.shops);
    const rm = buildRoadMeshes(ctx);
    this.traffic = new TrafficLights(this.roads.intersections);
    this.traffic.build(this.group, ctx);
    this._shoreline(ctx);
    onProgress(0.65); await tick();

    // far skyline (no physics)
    const far = new ChunkSet(4000);
    const frng = mulberry32(99);
    const ringBox = (x, z) => {
      const w = 40 + frng() * 70, d = 40 + frng() * 70, h = 30 + Math.pow(frng(), 2) * 160;
      const st = ['glassSteel', 'glassBlue', 'concrete', 'glassTeal'][(frng() * 4) | 0];
      const sty = { glassSteel: [24, 28.8], glassBlue: [24, 28.8], concrete: [24, 27.2], glassTeal: [24, 28.8] }[st];
      far.bucket(x, z, st).walls(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, sty[0], sty[1], frng() * 4, [0.85, 0.88, 0.95]);
    };
    for (let i = 0; i < 70; i++) { ringBox(-1000 - frng() * 260, -1000 + frng() * 2200); }
    for (let i = 0; i < 40; i++) { ringBox(-900 + frng() * 1700, -1000 - frng() * 240); }
    for (let i = 0; i < 40; i++) { ringBox(-900 + frng() * 1700, 900 + frng() * 260); }

    // meshes
    const skipCast = ['markings', 'sidewalk', 'grass', 'pond', 'road', 'night', 'beacon', 'pool', 'street'];
    ctx.chunks.build(this.group, M, { skipCast: low ? Object.keys(M) : skipCast });
    far.build(this.group, M, { cast: false, receive: false });
    if (ctx.refl) {
      this.mirror = new THREE.Group();
      this.mirror.scale.y = -1; this.mirror.position.y = -1;
      const n = ctx.refl.build(this.mirror, M, { cast: false, receive: false });
      this.mirror.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.matrixAutoUpdate = false; } });
      this.group.add(this.mirror);
    }

    // ground, sea, water
    const gmat = new THREE.MeshLambertMaterial({ map: T.grass, color: new THREE.Color(1.5, 1.7, 1.15) });
    gmat.map.wrapS = gmat.map.wrapT = THREE.RepeatWrapping;
    this.group.add(groundMesh(gmat, 16));
    const water = makeBayWater(reflect);
    this.group.add(water.mesh);
    this.waterU = water.uniforms;
    atmo.attachWater(water.uniforms);
    // bay floor so the translucent water shows something dark
    const floorShape = new THREE.Shape(BAY.map(([x, z]) => new THREE.Vector2(x, -z)));
    const fg = new THREE.ShapeGeometry(floorShape); fg.rotateX(-Math.PI / 2); fg.translate(0, -7, 0);
    this.group.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x07181e })));
    onProgress(0.8); await tick();

    // instanced extras
    const props = makeProps(ctx, this.group, { palmSpots: [...ctx.palmSpots, ...rm.treeSpots.map(([x, z]) => [x, z, 1, 0.12, 0.8]), ...this._promenadeTrees(rng)], lamps: rm.lamps });
    const dur = makeDurianMeshes(ctx, this.group, quality);
    const flyer = makeFlyerWheel(ctx, this.group, quality);
    const supers = makeSupertrees(ctx, this.group, quality);
    this.show = new LightShow(this.group, ctx);
    this.spout = new Spout(this.group, ctx.merlionMouth, ctx.merlionDir);
    this.rain = new Rain(this.group);
    onProgress(0.9); await tick();

    // day / night response
    const fn = (pal, night) => {
      M.night.color.setScalar(0.05 + night * 2.6);
      M.pool.emissiveIntensity !== undefined && (M.pool.emissiveIntensity = 0.9 + night * 1.2);
      props.update(night); supers.update(night);
      dur.shellMat.emissiveIntensity = night * 0.55; dur.spikeMat.emissiveIntensity = night * 1.1;
      for (const m of wallMats) m.emissiveIntensity = pal.glow * (1 + night * 1.3);
      this._night = night;
    };
    atmo.onChange.push(fn);
    fn(atmo.pal, atmo.night);
    this._flyer = flyer;

    // data the rest of the game reads
    this.landmarks['Raffles Place'] ||= new THREE.Vector3(-440, 0, -140);
    this.minimap.park = { x: 480, z: 560, w: 560, d: 500 };
    this.minimap.parks = ctx.minimapPark;
    this.minimap.shops = this.shops.map((s) => [s.pos.x, s.pos.z, s.name]);
    this.minimap.landmarks = Object.fromEntries(Object.entries(this.landmarks).map(([k, v]) => [k, [v.x, v.z]]));
    this.ctx = ctx;
    this._buildStats = { boxes: physics.boxes.length, buildings: this.minimap.buildings.length };
    onProgress(0.96); await tick();
    try { if (!globalThis.__NOCOMPILE) renderer.compile(scene, this.game.camera); } catch (e) { console.warn('shader precompile failed', e); }
    onProgress(1);
  }

  /** quay wall + promenade around the bay, sea wall on the east coast */
  _shoreline(ctx) {
    for (let i = 0; i < BAY.length; i++) {
      const [ax, az] = BAY[i], [bx, bz] = BAY[(i + 1) % BAY.length];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const horiz = az === bz;
      let nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
      if (inBay(mx + nx * 1.5, mz + nz * 1.5)) { nx = -nx; nz = -nz; }
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
      const W = 16;
      const r = horiz ? [x0 - (nz ? 0 : 0), nz > 0 ? z0 : z0 - W, x1, nz > 0 ? z0 + W : z0] : [nx > 0 ? x0 : x0 - W, z0, nx > 0 ? x0 + W : x0, z1];
      const sb = ctx.chunks.bucket(mx, mz, 'sidewalk');
      sb.boxAll(r[0], 0, r[1], r[2], L.PROM_Y, r[3], 4, [0.86, 0.84, 0.8]);
      // quay wall down into the water
      const q = horiz ? [x0, nz > 0 ? z0 - 0.3 : z0, x1, nz > 0 ? z0 : z0 + 0.3] : [nx > 0 ? x0 - 0.3 : x0, z0, nx > 0 ? x0 : x0 + 0.3, z1];
      ctx.chunks.bucket(mx, mz, 'prop').boxAll(q[0], -2.5, q[1], q[2], 0.15, q[3], 3, [0.5, 0.5, 0.52]);
      ctx.refl && 0;
    }
    ctx.chunks.bucket(L.COAST, 0, 'prop').boxAll(L.COAST - 1, -2.5, -1600, L.COAST + 0.2, 1.1, 1600, 4, [0.55, 0.55, 0.57]);
    addBox(ctx, L.COAST - 1, 0, -1600, L.COAST + 0.2, 1.1, 1600, 'prop', 'seawall');
  }

  _promenadeTrees(rng) {
    const out = [];
    for (let i = 0; i < BAY.length; i++) {
      const [ax, az] = BAY[i], [bx, bz] = BAY[(i + 1) % BAY.length];
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 17);
      const horiz = az === bz;
      let nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
      if (inBay((ax + bx) / 2 + nx * 1.5, (az + bz) / 2 + nz * 1.5)) { nx = -nx; nz = -nz; }
      for (let k = 1; k < n; k++) {
        const t = k / n, off = 5 + (k % 2) * 6;
        out.push([ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off, k % 3 === 0 ? 1 : 0, 0.15, 0.9 + rng() * 0.3]);
      }
    }
    return out;
  }

  _buildShops(ctx) {
    // fictional local names (the texture atlas names are the New York ones)
    const SG_SHOP_NAMES = ['Lion City Armoury', 'Kampong Ballistics', 'Tanjong Tactical', 'Bayfront Munitions'];
    const defs = [
      { x: -345, z: -150, yaw: Math.PI / 2 },   // west promenade (facing the bay, +x)
      { x: -345, z: 62, yaw: Math.PI / 2 },
      { x: -118, z: 133, yaw: Math.PI },        // south promenade, facing the bay (north)
      { x: 140, z: -405, yaw: 0 },              // Esplanade side, facing south
    ];
    return defs.map((d, i) => {
      const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), tx = fz, tz = -fx;
      const cx = d.x, cz = d.z, W = 14, D = 9;
      const b = ctx.chunks.bucket(cx, cz, 'street'), nb = ctx.chunks.bucket(cx, cz, 'night');
      const col = SHOP_DEFS[i].col.map((v) => v / 255);
      // body
      b.boxXf(cx, 2.6, cz, tx !== 0 ? D * 0 + Math.abs(tx) * W + Math.abs(fx) * D : D, 5.2, Math.abs(tz) * W + Math.abs(fz) * D, 0, [0.82, 0.8, 0.74]);
      const ex = cx + fx * (D / 2), ez = cz + fz * (D / 2);
      // glowing window + door
      nb.boxXf(ex + fx * 0.05, 1.7, ez + fz * 0.05, Math.abs(tx) * (W - 3) + Math.abs(fx) * 0.12, 2.4, Math.abs(tz) * (W - 3) + Math.abs(fz) * 0.12, 0, [1.0, 0.8, 0.5]);
      b.boxXf(ex + fx * 0.6, 3.5, ez + fz * 0.6, Math.abs(tx) * (W + 0.6) + Math.abs(fx) * 1.4, 0.25, Math.abs(tz) * (W + 0.6) + Math.abs(fz) * 1.4, 0, col.map((v) => v * 0.6));
      nb.boxXf(ex + fx * 0.15, 4.6, ez + fz * 0.15, Math.abs(tx) * (W - 3) + Math.abs(fx) * 0.15, 0.8, Math.abs(tz) * (W - 3) + Math.abs(fz) * 0.15, 0, [col[0] * 1.2, col[1] * 1.2, col[2] * 1.2]);
      ctx.physics.addBox(new THREE.Vector3(cx - (Math.abs(tx) * W + Math.abs(fx) * D) / 2, 0, cz - (Math.abs(tz) * W + Math.abs(fz) * D) / 2), new THREE.Vector3(cx + (Math.abs(tx) * W + Math.abs(fx) * D) / 2, 5.2, cz + (Math.abs(tz) * W + Math.abs(fz) * D) / 2), { type: 'building', id: 'shop', height: 5.2 });
      return { pos: new THREE.Vector3(ex + fx * 1.5, L.PROM_Y, ez + fz * 1.5), yaw: d.yaw, name: SG_SHOP_NAMES[i % SG_SHOP_NAMES.length] };
    });
  }

  /** Traffic light phase of the intersection nearest (x, z): { ns, ew, x, z }. ns = cars moving along z, ew = cars moving along x. */
  trafficLightState(x, z, out = {}) { return this.traffic ? this.traffic.state(x, z, out) : Object.assign(out, { ns: 'green', ew: 'red', x, z }); }

  setTimeOfDay(t) { this.atmo?.setTime(t); }
  setDayCycle(on, secondsPerDay = 600) { if (!this.atmo) return; this.atmo.cycle = !!on; this.atmo.cycleSpeed = 1 / secondsPerDay; }
  /** Light tropical rain on/off (fades in over a few seconds). */
  setRain(on) { this.rainOn = !!on; if (this.atmo) this.atmo.rainTarget = on ? 1 : 0; }

  update(dt) {
    if (!this.atmo || !this.waterU || !this._flyer) return;
    this.time += dt;
    this.waterU.uTime.value = this.time;
    this.traffic?.update(dt);
    const g = this.game;
    const f = this._focus || (this._focus = new THREE.Vector3());
    if (g.player && g.state !== 'menu') f.copy(g.player.pos);
    else { g.camera.getWorldDirection(f); f.multiplyScalar(40).add(g.camera.position); f.y = 0; }
    this.atmo.update(dt, g.camera, f);
    const night = this._night ?? 0;
    this._flyer?.update(dt, night);
    this.show?.update(dt, night);
    this.spout?.update(dt);
    this.rain?.update(dt, g.camera, this.atmo.rain);
  }

  /** Detach everything this world added to the scene (call before swapping maps). */
  dispose() {
    const scene = this.game.scene;
    scene.remove(this.group);
    const a = this.atmo;
    if (a) { scene.remove(a.sky, a.hemi, a.sun, a.sun.target, a.moon, a.moon.target); }
    this.group.traverse((o) => { o.geometry?.dispose?.(); });
  }

  /** nearest shore point + outward direction, for popping swimmers back onto land */
  _popOut(p, v) {
    if (p.x > L.COAST - 0.5) { p.x = L.COAST - 8; p.y = 0.3; if (v) { v.x = -3; v.y = 7; v.z *= 0.2; } return; }
    let best = null, bd = 1e12;
    for (let i = 0; i < BAY.length; i++) {
      const [ax, az] = BAY[i], [bx, bz] = BAY[(i + 1) % BAY.length];
      const cx = Math.min(Math.max(p.x, Math.min(ax, bx)), Math.max(ax, bx)), cz = Math.min(Math.max(p.z, Math.min(az, bz)), Math.max(az, bz));
      const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
      if (d < bd) {
        bd = d;
        const horiz = az === bz;
        let nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
        if (inBay((ax + bx) / 2 + nx * 1.5, (az + bz) / 2 + nz * 1.5)) { nx = -nx; nz = -nz; }
        best = { x: cx, z: cz, nx, nz };
      }
    }
    let k = 10;
    p.x = best.x + best.nx * k; p.z = best.z + best.nz * k;
    while (inBay(p.x, p.z) && k < 120) { k += 8; p.x = best.x + best.nx * k; p.z = best.z + best.nz * k; }
    p.y = 0.3;
    if (v) { v.x = best.nx * 3; v.z = best.nz * 3; v.y = 7; }
  }

  /** Keep an entity ({pos, vel}) inside the map and out of the water. */
  constrain(e) {
    const p = e.pos, v = e.vel, b = this.bounds;
    if (p.x < b.minX + 1) { p.x = b.minX + 1; if (v && v.x < 0) v.x = 0; }
    else if (p.x > b.maxX - 1) { p.x = b.maxX - 1; if (v && v.x > 0) v.x = 0; }
    if (p.z < b.minZ + 1) { p.z = b.minZ + 1; if (v && v.z < 0) v.z = 0; }
    else if (p.z > b.maxZ - 1) { p.z = b.maxZ - 1; if (v && v.z > 0) v.z = 0; }
    if (p.y < 0.3 && inWater(p.x, p.z)) { this._popOut(p, v); return true; }
    return false;
  }

  randomStreetPoint() {
    const r = Math.random;
    const roads = [...AVE.filter((a) => !a.highway).map((a) => ({ ax: true, c: a.x, a0: a.z0, a1: a.z1, w: a.w })), ...STR.map((s) => ({ ax: false, c: s.z, a0: s.x0, a1: s.x1, w: s.w }))];
    const tot = roads.reduce((p, q) => p + (q.a1 - q.a0), 0);
    let t = r() * tot, rd = roads[0];
    for (const q of roads) { t -= q.a1 - q.a0; if (t <= 0) { rd = q; break; } }
    const along = rd.a0 + 20 + r() * (rd.a1 - rd.a0 - 40), off = (r() - 0.5) * (rd.w - 4);
    const x = rd.ax ? rd.c + off : along, z = rd.ax ? along : rd.c + off;
    return new THREE.Vector3(Math.min(Math.max(x, this.bounds.minX + 12), this.bounds.maxX - 12), 0.05, Math.min(Math.max(z, this.bounds.minZ + 8), this.bounds.maxZ - 8));
  }

  randomRooftopPoint() {
    const specs = this.specs;
    for (let n = 0; n < 30; n++) {
      const s = specs[(Math.random() * specs.length) | 0];
      if (!s || s.h < 25) continue;
      const t = s.tiers[s.tiers.length - 1];
      if (t.x1 - t.x0 < 6 || t.z1 - t.z0 < 6) continue;
      const x = t.x0 + 2.5 + Math.random() * (t.x1 - t.x0 - 5), z = t.z0 + 2.5 + Math.random() * (t.z1 - t.z0 - 5);
      if (Math.abs(this.game.physics.heightAt(x, z) - t.y1) > 0.05) continue;
      return new THREE.Vector3(x, t.y1 + 0.05, z);
    }
    return this.spawnPoint.pos.clone();
  }

  /** Roof corners of nearby buildings: handy swing / zip targets. */
  anchorsNear(pos, radius = 80) {
    const out = [];
    const boxes = this.game.physics.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
    for (const b of boxes) {
      const ty = b.data?.type;
      if (ty !== 'building' && ty !== 'roof' && ty !== 'bridge') continue;
      if (b.max.y < 12) continue;
      for (const cx of [b.min.x, b.max.x]) for (const cz of [b.min.z, b.max.z]) {
        const dx = cx - pos.x, dz = cz - pos.z, dy = b.max.y - pos.y;
        if (dx * dx + dz * dz + dy * dy < radius * radius) out.push(new THREE.Vector3(cx, b.max.y, cz));
      }
      if (out.length > 160) break;
    }
    return out;
  }
}

export default SingaporeWorld;
