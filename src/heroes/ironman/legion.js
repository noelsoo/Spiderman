// Iron Legion mini-drones: small repulsor drones that hover around the fight for a few seconds, shoot the nearest
// enemies and blow up when their timer ends. Geometry + materials are shared module-level assets (never per drone),
// drone groups are pooled (hidden, not destroyed) so repeated deployments allocate nothing.
import * as THREE from 'three';

const GOLD = 0xffcc33, CYAN = 0xaaf0ff;
let ASSETS = null;
function assets() {
  if (ASSETS) return ASSETS;
  ASSETS = {
    body: new THREE.SphereGeometry(0.2, 12, 9),
    plate: new THREE.CylinderGeometry(0.17, 0.2, 0.08, 10),
    fin: new THREE.BoxGeometry(0.34, 0.03, 0.12),
    glowGeo: new THREE.SphereGeometry(1, 8, 6),
    red: new THREE.MeshStandardMaterial({ color: 0xb01c1c, metalness: 0.7, roughness: 0.35, emissive: 0x200404 }),
    gold: new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.8, roughness: 0.3, emissive: 0x302000 }),
    eye: new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  return ASSETS;
}
function buildDrone() {
  const A = assets();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(A.body, A.red));
  const plate = new THREE.Mesh(A.plate, A.gold); plate.rotation.x = Math.PI / 2; plate.position.z = 0.14; g.add(plate);
  const eyeL = new THREE.Mesh(A.glowGeo, A.eye); eyeL.scale.setScalar(0.03); eyeL.position.set(-0.06, 0.03, 0.19); g.add(eyeL);
  const eyeR = new THREE.Mesh(A.glowGeo, A.eye); eyeR.scale.setScalar(0.03); eyeR.position.set(0.06, 0.03, 0.19); g.add(eyeR);
  const fin = new THREE.Mesh(A.fin, A.gold); fin.position.y = 0.0; g.add(fin);
  const glow = new THREE.Mesh(A.glowGeo, A.glow); glow.scale.set(0.27, 0.27, 0.27); g.add(glow);
  const flame = new THREE.Mesh(A.glowGeo, A.flame); flame.scale.set(0.09, 0.09, 0.2); flame.position.y = -0.2; g.add(flame);
  g.scale.setScalar(1.9);
  g.visible = false;
  return { group: g, flame, glow };
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _to = new THREE.Vector3();

export class Legion {
  constructor(hero, max = 4) {
    this.hero = hero; this.max = max;
    this.pool = []; this.live = [];
    this.scene = hero.game.scene;
  }
  get count() { return this.live.length; }

  /** Deploy a drone from `from` (world pos). life in seconds. */
  deploy(from, life = 11, index = 0) {
    if (this.live.length >= this.max) this._expire(this.live[0], false);
    let d = this.pool.pop();
    if (!d) { d = buildDrone(); this.scene.add(d.group); }
    d.group.position.copy(from); d.group.visible = true;
    d.pos = d.group.position;
    d.vel = d.vel ?? new THREE.Vector3();
    d.vel.set((index % 2 ? 1 : -1) * 4, 7, 2).applyAxisAngle(_v.set(0, 1, 0), this.hero.yaw);
    d.t = 0; d.life = life; d.fireCd = 0.6 + index * 0.25; d.target = null; d.scanT = 0; d.idx = index;
    d.ph = Math.random() * 6.28; d.hit = 0;
    this.live.push(d);
    return d;
  }

  update(dt, time) {
    const g = this.hero.game, hero = this.hero;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      d.t += dt; d.fireCd -= dt; d.scanT -= dt;
      if (d.t >= d.life || hero.dead) { this._expire(d, true); continue; }
      if (d.scanT <= 0) {
        d.scanT = 0.35;
        let best = null, bd = 38 * 38;
        for (const e of g.enemies?.list ?? []) {
          if (!e.alive || e.removed) continue;
          const dx = e.pos.x - d.pos.x, dz = e.pos.z - d.pos.z, dd = dx * dx + dz * dz;
          if (dd < bd) { bd = dd; best = e; }
        }
        d.target = best;
      }
      const t = d.target && d.target.alive ? d.target : null;
      // desired hover point: orbit the target at ~7 m (or the hero when idle), above head height
      const cx = t ? t.pos.x : hero.pos.x, cz = t ? t.pos.z : hero.pos.z;
      const base = t ? 7 : 3.5;
      const ang = time * (t ? 0.9 : 0.6) + d.ph + d.idx * 3.14;
      _to.set(cx + Math.cos(ang) * base, (t ? t.pos.y : hero.pos.y) + 3.4 + Math.sin(time * 2 + d.ph) * 0.4, cz + Math.sin(ang) * base);
      _w.subVectors(_to, d.pos).multiplyScalar(2.2);
      if (_w.length() > 14) _w.setLength(14);
      d.vel.lerp(_w, 1 - Math.exp(-4 * dt));
      d.pos.addScaledVector(d.vel, dt);
      const ground = g.physics.heightAt(d.pos.x, d.pos.z, d.pos.y + 1);
      if (d.pos.y < (ground || 0) + 1.2) d.pos.y = (ground || 0) + 1.2;
      // face the target (or travel direction)
      if (t) _v.set(t.center.x - d.pos.x, t.center.y - d.pos.y, t.center.z - d.pos.z); else _v.copy(d.vel);
      if (_v.lengthSq() > 0.01) d.group.lookAt(d.pos.x + _v.x, d.pos.y + _v.y, d.pos.z + _v.z);
      d.glow.scale.setScalar(0.27 + Math.sin(time * 14 + d.ph) * 0.03 + d.hit);
      d.hit = Math.max(0, d.hit - dt * 2);
      d.flame.scale.set(0.09, 0.09, 0.16 + Math.random() * 0.1);
      if (Math.random() < 0.5) g.fx?.trailPuff?.(d.pos.x, d.pos.y - 0.25, d.pos.z, 0xffaa55, 0.22, 0.3, 0.03);
      // fire
      if (t && d.fireCd <= 0 && d.pos.distanceTo(t.center) < 30) {
        d.fireCd = 0.5;
        const dir = _v.subVectors(t.center, d.pos).normalize().clone();
        const res = g.combat?.hitscan?.({ origin: d.pos.clone(), dir, range: 32, damage: 9, team: 'player', width: 0.6, source: hero, knockback: 2, stun: 0.12 });
        const to = res?.point ? res.point.clone() : d.pos.clone().addScaledVector(dir, 18);
        g.fx?.beam?.(d.pos, to, CYAN, 0.09, 0.07);
        g.fx?.burst?.(to, CYAN, 4, 3, 0.2, 0.14);
        g.fx?.flash?.(d.pos, CYAN, 1.2, 0.05);
        g.audio?.play('repulsor', { volume: 0.2, pitch: 1.6 });
        d.hit = 0.15;
      }
    }
  }

  _expire(d, boom) {
    const i = this.live.indexOf(d); if (i >= 0) this.live.splice(i, 1);
    d.group.visible = false; this.pool.push(d);
    if (!boom) return;
    const g = this.hero.game;
    const p = d.pos.clone();
    g.combat?.aoe?.({ center: p, radius: 3.2, damage: 22, knockback: 9, up: 5, stun: 0.5, source: this.hero });
    g.fx?.burst?.(p, 0xffaa55, 22, 7, 0.5, 0.3);
    g.fx?.ring?.(p, 3, CYAN, 0.35);
    g.fx?.flash?.(p, 0xffaa55, 4, 0.18);
    g.audio?.play('explosion', { volume: 0.35 });
  }

  clear() { for (let i = this.live.length - 1; i >= 0; i--) this._expire(this.live[i], false); }

  dispose() {
    this.clear();
    for (const d of this.pool) this.scene.remove(d.group);
    this.pool.length = 0;
  }
}
