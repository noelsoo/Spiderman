// Lightweight symbiote clone ally (Maximum Carnage). Not an Enemy: chases the nearest enemy and slashes it via combat.melee.
import * as THREE from 'three';
import { buildCharacter } from '../../models/index.js';

const V3 = THREE.Vector3;
const _a = new V3();

export class SymbioteClone {
  constructor(game, owner, pos, o = {}) {
    this.game = game; this.owner = owner;
    this.pos = pos.clone(); this.vel = new V3(); this.yaw = owner.yaw;
    this.radius = 0.45; this.height = 1.7;
    this.life = o.life ?? 12; this.age = 0;
    this.speed = o.speed ?? 12; this.dmg = o.dmg ?? 15;
    this.atkT = 0.3 + Math.random() * 0.3; this.swing = 0;
    this.anim = { state: 'idle', t: 0, speed: 0, blend: 0 };
    this.onGround = false; this.alive = true; this.fade = 0;
    this.model = buildCharacter(o.modelId ?? 'carnage', {});
    const mh = this.model.height || 2;
    this.model.group.scale.setScalar((o.scale ?? 0.8) * (o.baseHeight ?? 2.1) / mh);
    game.scene.add(this.model.group);
    this.model.group.position.copy(this.pos);
    game.fx?.burst?.(_a.set(pos.x, pos.y + 1, pos.z), 0xd0101a, 22, 6, 0.6, 0.3);
    game.fx?.ring?.(_a.set(pos.x, pos.y + 0.1, pos.z), 3, 0xd0101a, 0.4);
  }

  update(dt) {
    const g = this.game;
    this.age += dt;
    if (this.age >= this.life) { this.alive = false; return; }
    // pick a target
    let tgt = null, bd = 1e9;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || e.untargetable) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < bd && d < 45) { bd = d; tgt = e; }
    }
    let wx = 0, wz = 0, spd = 0;
    if (tgt) {
      const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.9) { wx = dx / d; wz = dz / d; spd = this.speed * (d > 12 ? 1.3 : 1); }
      this.yaw = Math.atan2(dx, dz);
      this.atkT -= dt;
      if (d < 3.2 && this.atkT <= 0) {
        this.atkT = 0.42; this.swing = 0.3;
        g.combat?.melee?.({ origin: _a.set(this.pos.x, this.pos.y + 1, this.pos.z), forward: _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), range: 3.2, arc: 140, damage: this.dmg, knockback: 6, up: 2, stun: 0.3, source: this.owner });
        g.fx?.sparks?.(_a.set(this.pos.x + Math.sin(this.yaw) * 1.8, this.pos.y + 1.1, this.pos.z + Math.cos(this.yaw) * 1.8), _a, 0xff3040, 6, 7, 0.25, 0.1);
        g.audio?.play('slash', { volume: 0.35, pos: this.pos });
      }
    } else {
      // regroup near the owner
      const dx = this.owner.pos.x - this.pos.x, dz = this.owner.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 5) { wx = dx / d; wz = dz / d; spd = this.speed; this.yaw = Math.atan2(dx, dz); }
    }
    this.swing = Math.max(0, this.swing - dt);
    this.vel.x += (wx * spd - this.vel.x) * Math.min(1, 10 * dt);
    this.vel.z += (wz * spd - this.vel.z) * Math.min(1, 10 * dt);
    this.vel.y -= 28 * dt;
    // small hop over low obstacles
    this.pos.addScaledVector(this.vel, dt);
    const res = g.physics.resolveCapsule(this.pos, this.radius, this.height, this.vel);
    this.onGround = !!res.onGround;
    if (res.onWall && this.onGround && spd > 0) this.vel.y = 9;
    if (this.pos.y < -30) this.pos.y = 0;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.anim.t += dt;
    const st = this.swing > 0 ? (Math.floor(this.age * 5) % 2 ? 'punch2' : 'punch1') : !this.onGround ? (this.vel.y > 0 ? 'jump' : 'fall') : hs > 6 ? 'sprint' : hs > 0.5 ? 'run' : 'idle';
    if (this.anim.state !== st) { this.anim.state = st; this.anim.t = 0; }
    this.anim.speed = hs;
    const grp = this.model.group;
    grp.position.copy(this.pos); grp.rotation.set(0, this.yaw, 0);
    this.model.update?.(dt, this.anim, this);
    if (this.model.fx) this.model.fx.rage = 1;
    // dissolve in the last second
    if (this.life - this.age < 0.8 && Math.random() < 0.5) g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 1, this.pos.z), 0xd0101a, 2, 3, 0.4, 0.25);
  }

  dispose() {
    const g = this.game;
    g.fx?.burst?.(_a.set(this.pos.x, this.pos.y + 1, this.pos.z), 0xd0101a, 18, 5, 0.5, 0.3);
    this.model.group.parent?.remove(this.model.group);
    this.model.dispose?.();
  }
}
