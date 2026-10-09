// Combat: melee arcs, AoE, projectiles (web / repulsor / missile / hammer / rock / bullet / symbiote), hitscan.
// Contract: docs/ARCHITECTURE.md#combat
//
// Extras beyond the contract:
//   explode(pos, radius, damage, {team, source, color, knockback, up, stun}) -> targets   fx explosion + aoe
//   projectile opts: knockback, stun, up, webTime, blast (explosion radius), turn (homing rad/s), world:false (ignore city),
//                    update(proj, dt) -> false to remove, heavy, tracer
//   proj: { pos, vel, prev, age, life, dead, hits:Set, remove(), ...opts }
//   On the player evading (takeDamage returned false while invulnerable) calls player.onAttackEvaded?.(source, amount).
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const HEAVY_DMG = 24;

const KIND_DEFAULTS = {
  web:      { color: 0xffffff, size: 0.2,  radius: 0.3,  life: 1.5, gravity: 0 },
  repulsor: { color: 0x9fe8ff, size: 0.22, radius: 0.35, life: 2.0, gravity: 0 },
  missile:  { color: 0xff8a30, size: 0.14, radius: 0.4,  life: 4.0, gravity: 0, blast: 4.5 },
  hammer:   { color: 0x9fd8ff, size: 0.4,  radius: 0.7,  life: 5.0, gravity: 0, world: false },
  rock:     { color: 0x7a7468, size: 0.7,  radius: 0.8,  life: 4.0, gravity: 20, blast: 4.5 },
  bullet:   { color: 0xffc060, size: 0.05, radius: 0.12, life: 2.5, gravity: 0 },
  symbiote: { color: 0x7a2bd0, size: 0.38, radius: 0.5,  life: 4.0, gravity: 5 },
};

let G = null; // shared geometry/material cache
function shared() {
  if (G) return G;
  const bm = (color, o = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...o });
  G = {
    sphere: new THREE.SphereGeometry(1, 14, 10),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
    cone: new THREE.ConeGeometry(1, 1, 8),
    rock: new THREE.DodecahedronGeometry(1, 0),
    webMat: bm(0xffffff),
    repMat: bm(0xcff4ff, { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    repGlow: bm(0x4cc8ff, { blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false }),
    bulletMat: bm(0xffe0a0, { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    gooMat: new THREE.MeshStandardMaterial({ color: 0x07030c, roughness: 0.25, metalness: 0.2, emissive: 0x3a0f66, emissiveIntensity: 0.9 }),
    rockMat: new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.95, flatShading: true }),
    missileBody: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.4, metalness: 0.7 }),
    missileNose: new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.5 }),
    flameMat: bm(0xffb050, { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
  };
  return G;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this._hitstopCd = 0;
  }

  get enemyList() { return this.game.enemies?.list ?? []; }

  reset() {
    for (const p of this.projectiles) this._dispose(p, false);
    this.projectiles.length = 0;
  }

  // ===================================================================== hit resolution
  /** Damage player (team 'enemy' attacks). Returns true if damage landed. */
  damagePlayer(amount, fromPos, source = null) { return this._hurtPlayer(amount, fromPos, source); }

  /** Deal damage to an enemy with all the feel. first = play audio/hitstop (once per attack). */
  _hurtEnemy(e, amount, kb, stun, source, kind, point, heavyFlag, first) {
    const g = this.game;
    const dealt = e.takeDamage(amount, { knockback: kb, stun, source, kind });
    if (!(dealt > 0)) return false;
    const heavy = heavyFlag || dealt >= HEAVY_DMG;
    const p = point ?? e.center;
    g.fx.hitSpark(p, heavy ? 0xffd070 : 0xfff2c0, heavy);
    _a.set(e.pos.x, e.pos.y + e.height + 0.35, e.pos.z);
    g.fx.text(_a, String(Math.round(dealt)), heavy ? 0xffb030 : 0xffffff, heavy ? { size: 1.35 } : null);
    if (first) {
      g.audio?.play?.(heavy ? 'heavyhit' : 'hit', { pos: p });
      g.input?.rumble?.(heavy ? 0.6 : 0.25, heavy ? 0.4 : 0.15, heavy ? 120 : 60);
      g.cam?.shake?.(heavy ? 0.18 : 0.05);
      if (heavy && g._slowmo <= 0.05) g.slowmo?.(0.05, 0.05);
    }
    g.player?.registerHit?.();
    return true;
  }

  _hurtPlayer(amount, fromPos, source) {
    const pl = this.game.player;
    if (!pl || pl.dead) return false;
    const ok = pl.takeDamage(amount, fromPos);
    if (ok) {
      const st = this.game.enemies?.stats;
      if (st) st.damageTaken = (st.damageTaken || 0) + amount;
      this.game.fx.hitSpark(pl.center, 0xff5050, amount >= HEAVY_DMG);
      if (amount >= HEAVY_DMG) this.game.cam.shake(0.3);
    } else if (pl.invuln > 0) pl.onAttackEvaded?.(source, amount);
    return ok;
  }

  _targets(team) {
    if (team === 'enemy') { const p = this.game.player; return p && !p.dead ? [p] : []; }
    return this.enemyList;
  }

  // ===================================================================== melee
  melee(o) {
    const { origin, forward, range = 2.2, arc = 100, damage = 10, knockback = 6, up = 2, stun = 0.3, source = null, team = 'player' } = o;
    const hits = [];
    const cosHalf = Math.cos(THREE.MathUtils.degToRad(arc * 0.5));
    _dir.set(forward.x, 0, forward.z);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    _dir.normalize();
    const list = this._targets(team);
    let first = true;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.alive === false || t.untargetable) continue;
      const cy = t.pos.y;
      if (origin.y > cy + t.height + 1.2 || origin.y < cy - 1.8) continue;
      _a.set(t.pos.x - origin.x, 0, t.pos.z - origin.z);
      const dist = _a.length();
      if (dist > range + t.radius) continue;
      if (dist > t.radius + 0.4) {
        _a.multiplyScalar(1 / dist);
        // widen the cone for nearby targets so close enemies are never "missed"
        const closeBonus = dist < t.radius + 1 ? 0.35 : 0;
        if (_a.dot(_dir) < cosHalf - closeBonus) continue;
      } else _a.copy(_dir);
      _b.copy(_a).multiplyScalar(knockback).setY(up);
      _c.set(t.pos.x - _a.x * t.radius, t.pos.y + t.height * 0.6, t.pos.z - _a.z * t.radius);
      if (team === 'enemy') {
        if (this._hurtPlayer(damage, origin, source)) { hits.push(t); if (up > 5) t.vel?.add?.(_b); }
      } else if (this._hurtEnemy(t, damage, _b.clone(), stun, source, 'melee', _c, !!o.heavy, first)) { hits.push(t); first = false; }
    }
    return hits;
  }

  // ===================================================================== AoE
  aoe(o) {
    const { center, radius, damage = 20, knockback = 12, up = 6, stun = 0.6, source = null, team = 'player', falloff = true } = o;
    const hits = [];
    const list = this._targets(team);
    let first = true;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.alive === false || t.untargetable) continue;
      // distance from the blast centre to the target's capsule axis
      const cy = THREE.MathUtils.clamp(center.y, t.pos.y, t.pos.y + t.height);
      const dx = t.pos.x - center.x, dz = t.pos.z - center.z, dy = cy - center.y;
      const d = Math.hypot(dx, dy, dz) - t.radius;
      if (d > radius) continue;
      const f = falloff ? 1 - 0.65 * Math.max(0, d) / radius : 1;
      const h = Math.hypot(dx, dz) || 1;
      _b.set(dx / h * knockback * f, up * f, dz / h * knockback * f);
      if (team === 'enemy') {
        if (this._hurtPlayer(damage * f, center, source)) {
          hits.push(t);
          // blast shoves the player harder than the generic hit
          t.vel.x += _b.x * 0.5; t.vel.z += _b.z * 0.5; t.vel.y = Math.max(t.vel.y, _b.y * 0.6);
        }
      } else {
        _c.set(t.pos.x, t.pos.y + t.height * 0.6, t.pos.z);
        if (this._hurtEnemy(t, damage * f, _b.clone(), stun, source, 'aoe', _c, damage * f >= HEAVY_DMG, first)) { hits.push(t); first = false; }
      }
    }
    return hits;
  }

  /** fx + AoE in one call. */
  explode(pos, radius, damage, o = {}) {
    this.game.fx.explosion(pos, radius, o.color ?? 0xffa040);
    this.game.audio?.play?.('explosion', { pos });
    return this.aoe({ center: pos, radius, damage, knockback: o.knockback ?? 14, up: o.up ?? 7, stun: o.stun ?? 0.8, source: o.source, team: o.team ?? 'player', falloff: o.falloff ?? true });
  }

  // ===================================================================== hitscan
  hitscan(o) {
    const { origin, dir, range = 100, damage = 10, team = 'player', width = 0.5, source = null, knockback = 4, stun = 0.2 } = o;
    _dir.copy(dir).normalize();
    let maxT = range;
    const wall = this.game.physics.raycast(origin, _dir, range);
    if (wall) maxT = wall.distance;
    let best = null, bestT = maxT;
    const list = this._targets(team);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.alive === false || t.untargetable) continue;
      const rr = width * 0.5 + t.radius;
      // sample 3 spheres along the capsule axis
      for (let s = 0; s < 3; s++) {
        const y = t.pos.y + Math.max(t.radius, Math.min(t.height - t.radius, t.height * (0.15 + 0.35 * s)));
        _a.set(t.pos.x - origin.x, y - origin.y, t.pos.z - origin.z);
        const proj = _a.dot(_dir);
        if (proj < 0 || proj > bestT + rr) continue;
        const d2 = _a.lengthSq() - proj * proj;
        if (d2 <= rr * rr) {
          const tt = Math.max(0, proj - Math.sqrt(Math.max(0, rr * rr - d2)));
          if (tt < bestT) { bestT = tt; best = t; }
        }
      }
    }
    if (o.tracer) {
      _b.copy(origin).addScaledVector(_dir, best ? bestT : maxT);
      this.game.fx.beam(origin, _b, o.tracer, 0.06, 0.08);
    }
    if (!best) return null;
    const point = origin.clone().addScaledVector(_dir, bestT);
    if (team === 'enemy') this._hurtPlayer(damage, origin, source);
    else {
      _b.copy(_dir).multiplyScalar(knockback).setY(1.5);
      this._hurtEnemy(best, damage, _b.clone(), stun, source, 'hitscan', point, !!o.heavy, true);
    }
    return { target: best, point };
  }

  // ===================================================================== projectiles
  projectile(o) {
    const k = KIND_DEFAULTS[o.kind] ?? KIND_DEFAULTS.repulsor;
    const p = {
      kind: o.kind ?? 'repulsor',
      pos: o.pos.clone(), prev: o.pos.clone(), vel: o.vel.clone(), origin: o.pos.clone(),
      damage: o.damage ?? 10, radius: o.radius ?? k.radius, life: o.life ?? k.life,
      gravity: o.gravity ?? k.gravity, color: o.color ?? k.color, size: o.size ?? k.size,
      team: o.team ?? 'player', pierce: !!o.pierce, homing: o.homing ?? null,
      onHit: o.onHit, onExpire: o.onExpire, mesh: o.mesh ?? null, ownMesh: !o.mesh,
      update: o.update, source: o.source ?? null,
      knockback: o.knockback ?? (o.kind === 'rock' ? 10 : 5), up: o.up ?? 1.5, stun: o.stun ?? 0.25,
      webTime: o.webTime ?? 2.5, blast: o.blast ?? k.blast ?? 0, turn: o.turn ?? 3.5,
      world: o.world ?? k.world ?? true, heavy: !!o.heavy, tracer: o.tracer,
      age: 0, dead: false, hits: new Set(), spin: Math.random() * 6,
      speed: o.vel.length(), trailAcc: 0, remove: null, user: o.user,
    };
    // missile/rock with a caller-supplied onHit: the caller does its own splash, so no built-in blast or direct damage
    if (o.onHit && (p.kind === 'missile' || p.kind === 'rock') && o.blast === undefined) { p.blast = 0; p.noDamage = true; }
    p.remove = () => { p.dead = true; };
    if (!p.mesh) p.mesh = this._buildMesh(p);
    if (p.mesh && !p.mesh.parent) this.game.scene.add(p.mesh);
    if (p.mesh) { p.mesh.position.copy(p.pos); this._orient(p); }
    if (p.kind === 'missile') this.game.audio?.play?.('missile', { pos: p.pos });
    this.projectiles.push(p);
    return p;
  }

  _buildMesh(p) {
    const S = shared();
    let m;
    switch (p.kind) {
      case 'web': m = new THREE.Mesh(S.sphere, S.webMat); m.scale.setScalar(p.size); break;
      case 'repulsor': {
        m = new THREE.Group();
        const core = new THREE.Mesh(S.sphere, S.repMat); core.scale.set(p.size * 0.5, p.size * 0.5, p.size * 1.8);
        const glow = new THREE.Mesh(S.sphere, S.repGlow); glow.scale.set(p.size, p.size, p.size * 2.6);
        m.add(core, glow); break;
      }
      case 'missile': {
        m = new THREE.Group();
        const body = new THREE.Mesh(S.cyl, S.missileBody); body.rotation.x = Math.PI / 2; body.scale.set(0.07, 0.55, 0.07);
        const nose = new THREE.Mesh(S.cone, S.missileNose); nose.rotation.x = Math.PI / 2; nose.position.z = 0.36; nose.scale.set(0.07, 0.2, 0.07);
        const flame = new THREE.Mesh(S.cone, S.flameMat); flame.rotation.x = -Math.PI / 2; flame.position.z = -0.4; flame.scale.set(0.07, 0.4, 0.07);
        m.add(body, nose, flame); break;
      }
      case 'rock': m = new THREE.Mesh(S.rock, S.rockMat); m.scale.set(p.size, p.size * 0.85, p.size * 1.1); m.castShadow = true; break;
      case 'bullet': m = new THREE.Mesh(S.cyl, S.bulletMat); m.rotation.order = 'YXZ'; m.userData.streak = true; break;
      case 'symbiote': m = new THREE.Mesh(S.sphere, S.gooMat); m.scale.setScalar(p.size); break;
      default: m = new THREE.Mesh(S.sphere, S.repMat); m.scale.setScalar(p.size);
    }
    return m;
  }

  _orient(p) {
    const m = p.mesh;
    if (!m) return;
    const sp = p.vel.lengthSq();
    if (p.kind === 'rock') { p.spin += 0.2; m.rotation.x += 0.12; m.rotation.z += 0.08; return; }
    if (p.kind === 'symbiote' || p.kind === 'web') return;
    if (sp < 1e-4) return;
    if (p.kind === 'bullet') {
      _dir.copy(p.vel).normalize();
      _q.setFromUnitVectors(UP, _dir);
      m.quaternion.copy(_q);
      m.scale.set(0.035, 1.6, 0.035);
      return;
    }
    if (m.userData.noOrient) return;
    _dir.copy(p.vel).normalize();
    m.lookAt(m.position.x + _dir.x, m.position.y + _dir.y, m.position.z + _dir.z);
  }

  _dispose(p, expire = true) {
    if (p.disposed) return;
    p.disposed = true; p.dead = true;
    if (p.mesh && p.ownMesh) p.mesh.parent?.remove(p.mesh); // geometries/materials are shared
    if (expire) p.onExpire?.(p);
  }

  update(dt) {
    if (dt <= 0) return;
    const list = this.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (!p.dead) this._step(p, dt);
      if (p.dead) {
        this._dispose(p, true);
        list[i] = list[list.length - 1]; list.pop();
      }
    }
  }

  _step(p, dt) {
    const g = this.game;
    p.age += dt; p.life -= dt;
    if (p.life <= 0) { this._expire(p); return; }

    // homing
    if (p.homing) {
      const h = p.homing;
      if (h.alive === false || h.dead) p.homing = null;
      else {
        const c = h.center ?? h.pos;
        _a.subVectors(c, p.pos);
        const d = _a.length();
        if (d > 0.01) {
          _a.multiplyScalar(1 / d);
          _b.copy(p.vel).normalize();
          _b.lerp(_a, Math.min(1, p.turn * dt)).normalize();
          const sp = p.kind === 'missile' ? Math.min(p.speed * 1.6, p.vel.length() + 30 * dt) : p.vel.length();
          p.vel.copy(_b).multiplyScalar(sp);
        }
      }
    } else if (p.kind === 'missile') {
      const sp = Math.min(p.speed * 1.6, p.vel.length() + 30 * dt);
      p.vel.setLength(sp);
    }
    if (p.gravity) p.vel.y -= p.gravity * dt;

    p.prev.copy(p.pos);
    p.pos.addScaledVector(p.vel, dt);

    if (p.mesh) p.mesh.position.copy(p.pos);
    if (p.update) {
      // let custom code (e.g. Thor's returning hammer) own movement; if it moves the mesh we respect that
      _d.copy(p.mesh ? p.mesh.position : p.pos);
      if (p.update(p, dt) === false) { this._expire(p); return; }
      if (p.mesh && p.mesh.position.equals(_d)) p.mesh.position.copy(p.pos);
    }
    if (p.mesh) this._orient(p);

    // swept tests
    _d.subVectors(p.pos, p.prev);
    const len = _d.length();
    this._trailFx(p, len);
    if (len < 1e-5) return;
    _d.multiplyScalar(1 / len);

    let wallHit = null, segLen = len;
    if (p.world) {
      wallHit = g.physics.raycast(p.prev, _d, len + p.radius * 0.35);
      if (wallHit) segLen = Math.min(len, wallHit.distance);
    }

    // targets
    const list = this._targets(p.team);
    const n = Math.min(24, Math.max(1, Math.ceil(segLen / Math.max(0.25, p.radius))));
    let hitSomething = false;
    for (let s = 1; s <= n && !(hitSomething && !p.pierce); s++) {
      const t = segLen * s / n;
      _c.copy(p.prev).addScaledVector(_d, t);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.alive === false || e.untargetable || p.hits.has(e)) continue;
        const rr = p.radius + e.radius;
        const dx = _c.x - e.pos.x, dz = _c.z - e.pos.z;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (_c.y < e.pos.y - p.radius || _c.y > e.pos.y + e.height + p.radius) continue;
        p.hits.add(e);
        p.pos.copy(_c);
        this._onTargetHit(p, e);
        hitSomething = true;
        if (!p.pierce) break;
      }
    }
    if (hitSomething && !p.pierce) { if (p.mesh) p.mesh.position.copy(p.pos); p.dead = true; return; }
    if (wallHit && p.world) {
      p.pos.copy(wallHit.point);
      this._onWorldHit(p, wallHit);
      p.dead = true;
    }
  }

  _trailFx(p, len) {
    const fx = this.game.fx;
    switch (p.kind) {
      case 'web': {
        const src = p.source?.model?.handR;
        if (src) src.getWorldPosition(_a); else _a.copy(p.origin);
        fx.beam(_a, p.pos, 0xffffff, 0.022, 0.07);
        break;
      }
      case 'repulsor': fx.trailPuff(p.pos.x, p.pos.y, p.pos.z, p.color, 0.3, 0.2, 0.02); break;
      case 'bullet': fx.trailPuff(p.pos.x, p.pos.y, p.pos.z, 0xffa040, 0.14, 0.1, 0.0); break;
      case 'symbiote':
        fx.trailPuff(p.pos.x, p.pos.y, p.pos.z, 0x8a30e0, 0.35, 0.3, 0.05);
        if (Math.random() < 0.5) fx.smoke(p.pos, 0.35, 0.6, null, 0.03);
        break;
      case 'missile':
        fx.trailPuff(p.pos.x, p.pos.y, p.pos.z, 0xffa040, 0.55, 0.25, 0.02);
        fx.smoke(p.pos, 0.55, 1.1, null, 0.45);
        break;
      case 'rock': if (Math.random() < 0.4) fx.smoke(p.pos, 0.5, 0.5, null, 0.3); break;
      default: break;
    }
  }

  _expire(p) {
    if (p.blast && p.kind !== 'hammer') this._blast(p, p.pos);
    p.dead = true;
  }

  _blast(p, point) {
    this.explode(point, p.blast, p.damage, { team: p.team, source: p.source, color: p.kind === 'rock' ? 0xc8b890 : 0xffa040, knockback: p.knockback + 6 });
    if (p.kind === 'rock') this.game.fx.dust(point, 14, 4);
  }

  _onTargetHit(p, e) {
    const g = this.game;
    if (p.noDamage) {
      // caller handles damage in onHit
    } else if (p.blast) {
      this._blast(p, p.pos);
    } else if (p.team === 'enemy') {
      this._hurtPlayer(p.damage, p.prev, p.source);
      if (p.kind === 'symbiote') this._splat(p.pos, 0x7a2bd0);
    } else {
      _b.copy(p.vel).setY(0);
      if (_b.lengthSq() > 1e-6) _b.normalize();
      _b.multiplyScalar(p.knockback).setY(p.up);
      this._hurtEnemy(e, p.damage, _b.clone(), p.stun, p.source, p.kind, p.pos, p.heavy, true);
      if (p.kind === 'web') {
        e.web?.(p.webTime);
        g.fx.burst(p.pos, 0xffffff, 14, 4, 0.5, 0.2);
      }
    }
    p.onHit?.(e, p);
  }

  _onWorldHit(p, hit) {
    const fx = this.game.fx;
    if (p.blast) this._blast(p, p.pos);
    else switch (p.kind) {
      case 'web': fx.burst(p.pos, 0xffffff, 12, 3.5, 0.5, 0.2); fx.ring(p.pos, 0.8, 0xffffff, 0.25); break;
      case 'repulsor': fx.burst(p.pos, 0x9fe8ff, 12, 5, 0.35, 0.22); fx.flash(p.pos, 0x7fd8ff, 2, 0.1); break;
      case 'bullet': fx.sparks(p.pos, hit.normal, 0xffd080, 6, 7, 0.25, 0.08); break;
      case 'symbiote': this._splat(p.pos, 0x7a2bd0); break;
      default: fx.burst(p.pos, p.color, 8, 4, 0.3, 0.2);
    }
    p.onExpire?.(p); p.onExpire = null; // world impact counts as expiry
  }

  _splat(pos, color) {
    const fx = this.game.fx;
    fx.burst(pos, color, 16, 5, 0.5, 0.3);
    fx.smoke(pos, 0.9, 0.9, null, 0.03);
    fx.ring(pos, 1.4, color, 0.3);
    this.game.audio?.play?.('symbiote', { pos });
  }
}
