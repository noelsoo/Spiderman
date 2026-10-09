// World: procedural golden-hour Manhattan. See docs/ARCHITECTURE.md#world
import * as THREE from 'three';
import { Bucket, ChunkSet, mulberry32 } from './geo.js';
import { makeTextures } from './textures.js';
import { makeMaterials } from './materials.js';
import { buildCity, buildBackdrop, addBox, L, colX, rowZ, avenueX, streetZ } from './city.js';
import { buildAvengersTower, buildEmpireSpire, buildBridge } from './landmarks.js';
import { Atmosphere } from './atmosphere.js';
import { makeWater } from './water.js';
import { makeTrees, Clouds, Steam } from './life.js';
import { makePools, updateScreens } from './props.js';
import { buildRoads } from './roads.js';
import { makeSkylineBand } from './backdrop.js';
import { resolveQuality } from '../render/quality.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function groundPlane(x0, x1, z0, z1, tile, y = 0) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / tile, uv.getY(i) * (z1 - z0) / tile);
  return g;
}

export class World {
  constructor(game) {
    this.game = game;
    this.bounds = { minX: L.MINX, maxX: L.MAXX, minZ: L.MINZ, maxZ: L.MAXZ };
    this.spawnPoint = { pos: new THREE.Vector3(0, 60, 0), yaw: 0 };
    this.menuFocus = new THREE.Vector3(-50, 90, -200);
    this.landmarks = {};
    this.minimap = { size: 1200, minX: L.MINX, maxX: L.MAXX, minZ: L.MINZ, maxZ: L.MAXZ, buildings: [], water: { maxX: L.RIVER_X }, park: null };
    this.riverX = L.RIVER_X;
    this.time = 0;
    this.group = new THREE.Group();
    this.specs = [];
    this.atmo = null;
  }

  async build(onProgress = () => {}) {
    const { scene, physics, renderer } = this.game;
    // software rasterisers (SwiftShader / llvmpipe) force 'low'; window.__FORCE_WORLD_QUALITY overrides (tests)
    const quality = resolveQuality(renderer, this.game.settings?.quality ?? 'high');
    this.quality = quality;
    const rng = mulberry32(20231020);
    scene.add(this.group);

    const T = makeTextures(renderer, rng, quality);
    const { M, wallMats } = makeMaterials(T, quality);
    this.mats = M;
    onProgress(0.1); await tick();

    this.atmo = new Atmosphere(this.game, quality);
    this.atmo.registerWalls(wallMats);
    this.atmo.setTime(this.atmo.t);
    onProgress(0.2); await tick();

    const ctx = {
      rng, rng2: mulberry32(777), physics, quality, T, M, group: this.group, landmarks: this.landmarks, pools: [],
      chunks: new ChunkSet(450), glow: new Bucket(), signBucket: new Bucket(),
      trees: [], lamps: [], detail: quality !== 'low',
      avengersPos: new THREE.Vector3(colX(3), 0, rowZ(4)),
    };

    buildAvengersTower(ctx);
    buildEmpireSpire(ctx);
    onProgress(0.3); await tick();

    const city = buildCity(ctx);
    this.specs = city.specs;
    this.spawnPoint = city.spawn;
    this.minimap.buildings = city.buildings;
    onProgress(0.55); await tick();

    buildBridge(ctx);
    onProgress(0.62); await tick();

    // far skyline (no physics)
    const bctx = { ...ctx, chunks: new ChunkSet(1400), detail: false };
    buildBackdrop(bctx);
    onProgress(0.7); await tick();

    // meshes
    const skipCast = ['markings', 'sidewalk', 'grass', 'pond', 'storefront', 'asphalt', 'street', 'glow', 'lamp', 'neon', 'ad'];
    ctx.chunks.build(this.group, M, { skipCast });
    bctx.chunks.build(this.group, M, { cast: false, receive: true });
    const glow = new THREE.Mesh(ctx.glow.toGeometry(), M.glow);
    glow.matrixAutoUpdate = false;
    this.group.add(glow);
    const signMat = new THREE.MeshBasicMaterial({ map: T.sign, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.4, 2.4, 2.8) });
    this.group.add(new THREE.Mesh(ctx.signBucket.toGeometry(), signMat));

    // ground + far shore, bank wall on the far side
    const ground = new THREE.Mesh(groundPlane(L.RIVER_X, 3000, -3000, 3000, quality === 'low' ? 8 : 16), M.asphalt);
    ground.receiveShadow = true;
    const farShore = new THREE.Mesh(groundPlane(-3000, -1000, -3000, 3000, quality === 'low' ? 8 : 16), M.asphalt);
    farShore.receiveShadow = true;
    this.group.add(ground, farShore);
    const bank = new Bucket();
    bank.boxAll(-1012, -4, -3000, -1000, 0.15, 3000, 6, [0.5, 0.5, 0.52]);
    this.group.add(new THREE.Mesh(bank.toGeometry(), M.sidewalk));

    const water = makeWater();
    this.group.add(water.mesh);
    this.waterU = water.uniforms;
    this.atmo.attachWater(water.uniforms);
    onProgress(0.8); await tick();

    makeTrees(ctx, this.group);
    this.pools = makePools(ctx, this.group, T.pool);
    this.trafficLights = ctx.trafficLights;
    this.signs = ctx.signs;
    this.skyline = makeSkylineBand(this.group, T, this.atmo);
    this.clouds = quality === 'low' ? new Clouds(rng, this.group, T.cloud, quality) : { step() {} };
    this.steam = new Steam(rng, this.group, T.dot, quality);
    onProgress(0.9); await tick();

    // landmarks reported to other modules
    this.landmarks['Central Park'] = new THREE.Vector3(colX(4.5), 0, rowZ(8));
    this.minimap.park = { x: colX(4.5), z: rowZ(8), w: 178, d: 5 * L.PZ - 16 };
    this.shops = ctx.shops.map((s) => ({ pos: s.pos, yaw: s.yaw, name: s.name }));
    this.roads = buildRoads(this.shops);
    this.minimap.shops = this.shops.map((s) => [s.pos.x, s.pos.z, s.name]);
    this._hookDayNight(M, ctx.shopMats);
    this.minimap.landmarks = Object.fromEntries(Object.entries(this.landmarks).map(([k, v]) => [k, [v.x, v.z]]));
    this.menuFocus.set(avenueX(3), 105, streetZ(7));
    this.ctx = ctx;
    onProgress(0.96); await tick();
    // pre-compile every shader now (loading screen) instead of hitching on the first frame
    try { renderer.compile(scene, this.game.camera); } catch (e) { console.warn('shader precompile failed', e); }
    onProgress(1);
  }

  /** Traffic light phase of the intersection nearest (x, z): { ns, ew, x, z } with 'red' | 'yellow' | 'green'.
   *  ns = cars moving along the avenue (z axis), ew = cars moving along a street (x axis). Pass `out` to avoid allocation. */
  trafficLightState(x, z, out = {}) { return this.trafficLights ? this.trafficLights.state(x, z, out) : Object.assign(out, { ns: 'green', ew: 'red', x, z }); }

  /** Day / night response of lamps, neon, shop windows, billboards and light pools. */
  _hookDayNight(M, shopMats) {
    const lampCol = M.lamp.color, neonCol = M.neon.color, adCol = M.ad.color;
    const pools = this.pools, sign = shopMats?.sign, win = shopMats?.win;
    const fn = (pal, night) => {
      lampCol.setScalar(0.18 + night * 3.3);
      neonCol.setScalar(0.55 + night * 1.9);
      adCol.setScalar(1.15 + night * 0.9);
      if (sign) sign.color.setScalar(1.2 + night * 1.6);
      if (win && win.emissiveIntensity !== undefined) win.emissiveIntensity = 0.55 + night * 1.3;
      if (pools) { pools.visible = night > 0.04; pools.material.color.setScalar(night * 0.9); }
      for (const s of this.signs?.meshes ?? []) s.mesh.material.color.setScalar(1.15 + night * 0.8);
    };
    this.atmo.onChange.push(fn);
    fn(this.atmo.pal, this.atmo.night);
  }

  setTimeOfDay(t) { this.atmo?.setTime(t); }
  setDayCycle(on, secondsPerDay = 600) { if (!this.atmo) return; this.atmo.cycle = !!on; this.atmo.cycleSpeed = 1 / secondsPerDay; }

  update(dt) {
    if (!this.atmo) return;
    this.time += dt;
    this.waterU.uTime.value = this.time;
    this.clouds.step(dt);
    this.steam.step(dt);
    this.trafficLights?.update(dt);
    updateScreens(this.signs, this.time);
    const g = this.game;
    const f = this._focus || (this._focus = new THREE.Vector3());
    if (g.player && g.state !== 'menu') f.copy(g.player.pos);
    else { g.camera.getWorldDirection(f); f.multiplyScalar(40).add(g.camera.position); f.y = 0; }
    this.atmo.update(dt, g.camera, f);
    this.skyline?.update(g.camera);
  }

  /** Keep an entity ({pos, vel}) inside the map and out of the river. */
  constrain(e) {
    const p = e.pos, v = e.vel, b = this.bounds;
    if (p.x < b.minX + 1) { p.x = b.minX + 1; if (v && v.x < 0) v.x = 0; }
    else if (p.x > b.maxX - 1) { p.x = b.maxX - 1; if (v && v.x > 0) v.x = 0; }
    if (p.z < b.minZ + 1) { p.z = b.minZ + 1; if (v && v.z < 0) v.z = 0; }
    else if (p.z > b.maxZ - 1) { p.z = b.maxZ - 1; if (v && v.z > 0) v.z = 0; }
    if (p.x < this.riverX - 0.5 && p.y < 0.5) {
      // fell into the river: pop out onto the waterfront promenade
      p.x = this.riverX + 10; p.y = 0.3;
      if (v) { v.x = 3; v.y = 7; v.z *= 0.2; }
      return true;
    }
    return false;
  }

  randomStreetPoint() {
    const r = Math.random;
    let x, z;
    if (r() < 0.5) { x = avenueX(1 + ((r() * 10) | 0)) + (r() - 0.5) * 14; z = L.MINZ + 25 + r() * (L.MAXZ - L.MINZ - 50); }
    else { z = streetZ((r() * 18) | 0) + (r() - 0.5) * 8; x = L.RIVER_X + 25 + r() * (L.MAXX - L.RIVER_X - 40); }
    return new THREE.Vector3(Math.min(x, L.MAXX - 12), 0.05, THREE.MathUtils.clamp(z, L.MINZ + 8, L.MAXZ - 8));
  }

  randomRooftopPoint() {
    const specs = this.specs;
    for (let n = 0; n < 24; n++) {
      const s = specs[(Math.random() * specs.length) | 0];
      if (!s || s.h < 25) continue;
      const t = s.tiers[s.tiers.length - 1];
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
