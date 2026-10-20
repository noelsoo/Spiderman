// Mind games for Scarlet Witch: temporarily replace an enemy's AI so it fights other enemies.
//   mode 'control'  fights FOR the hero (hunts the nearest other enemy, otherwise escorts the hero)
//   mode 'confuse'  stumbles around and lashes out at whoever is closest (including allies)
// Bosses are never hijacked. The enemy's own ai() is restored (instance override deleted) when the timer ends,
// the enemy dies, or the hero is switched out (releaseAll).
import * as THREE from 'three';
import { hexAssets } from './util.js';

const RED = 0xff2a55;
const _k = new THREE.Vector3();

export class MindGames {
  constructor(hero) {
    this.hero = hero; this.map = new Map(); this.runes = [];
  }
  get game() { return this.hero.game; }
  has(e) { return this.map.has(e); }
  isControlled(e) { return this.map.get(e)?.mode === 'control'; }
  get count() { return this.map.size; }
  controlled() { for (const h of this.map.values()) if (h.mode === 'control') return h.e; return null; }

  apply(e, mode, dur, dmg) {
    if (!e || !e.alive || e.isBoss) return false;
    let h = this.map.get(e);
    if (h) { if (mode === 'control' || h.mode !== 'control') { h.mode = mode; h.t = Math.max(h.t, dur); } return true; }
    h = { e, mode, t: dur, atk: 0.3, scan: 0, victim: null, dmg: dmg ?? (mode === 'control' ? 22 : 12), wx: 0, wz: 0, wt: 0, rune: null, tintT: 0, fx: 0 };
    e.manager?.releaseToken?.(e);
    e.attacking = false; e.windup = 0; e.interrupt?.();
    e.ai = (dt) => this._ai(h, dt);
    h.rune = this._rune();
    this.map.set(e, h);
    return true;
  }

  _rune() {
    let r = this.runes.find((m) => !m.visible && !m.userData.used);
    if (!r) {
      const H = hexAssets();
      r = new THREE.Mesh(H.runeGeo, H.rune);
      r.rotation.x = -Math.PI / 2; r.scale.setScalar(1.4);
      this.game.scene.add(r); this.runes.push(r);
    }
    r.userData.used = true; r.visible = true;
    return r;
  }

  release(e) {
    const h = this.map.get(e); if (!h) return;
    this.map.delete(e);
    delete e.ai;
    if (h.rune) { h.rune.visible = false; h.rune.userData.used = false; }
    try { e.model?.setTint?.(RED, 0); } catch { /* optional */ }
    if (e.alive) { e.wish?.set(0, 0, 0); e.stateT = 0; }
  }
  releaseAll() { for (const e of [...this.map.keys()]) this.release(e); }

  _pick(h) {
    let best = null, bd = 28 * 28;
    for (const o of this.game.enemies?.list ?? []) {
      if (o === h.e || !o.alive || o.removed) continue;
      if (h.mode === 'control' && this.map.get(o)?.mode === 'control') continue;
      const dx = o.pos.x - h.e.pos.x, dz = o.pos.z - h.e.pos.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  _ai(h, dt) {
    const e = h.e, g = this.game, hero = this.hero;
    h.atk -= dt; h.scan -= dt; h.wt -= dt;
    if (h.scan <= 0) { h.scan = 0.3; h.victim = this._pick(h); }
    const v = h.victim && h.victim.alive ? h.victim : null;
    const spd = (e.speed || 5) * (h.mode === 'control' ? 1.35 : 0.8);
    if (v) {
      const dx = v.pos.x - e.pos.x, dz = v.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      e.faceYawTo?.(Math.atan2(dx, dz), dt, 12);
      if (d > 1.7) { e.moveToward(v.pos.x, v.pos.z, spd); e.setAnim('run', spd / 5); }
      else {
        e.wish.set(0, 0, 0);
        if (h.atk <= 0) {
          h.atk = h.mode === 'control' ? 0.7 : 0.9;
          e.setAnim('punch1', 1.3);
          _k.set(dx, 0, dz).normalize().multiplyScalar(7); _k.y = 2.5;
          v.takeDamage?.(h.dmg, { knockback: _k.clone(), stun: 0.4, source: hero, kind: 'hex' });
          g.fx?.hitSpark?.(v.center ?? v.pos, RED, false);
          g.audio?.play('hit', { volume: 0.35 });
        }
      }
    } else if (h.mode === 'control') {
      const dx = hero.pos.x - e.pos.x, dz = hero.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      if (d > 5) { e.moveToward(hero.pos.x, hero.pos.z, spd); e.setAnim('run', spd / 5); e.faceYawTo?.(Math.atan2(dx, dz), dt, 8); }
      else { e.wish.set(0, 0, 0); e.setAnim('idle', 1); }
    } else {
      if (h.wt <= 0) { h.wt = 0.8 + Math.random() * 0.8; const a = Math.random() * 6.28; h.wx = Math.sin(a); h.wz = Math.cos(a); }
      e.wish.set(h.wx * spd * 0.6, 0, h.wz * spd * 0.6);
      e.faceYawTo?.(Math.atan2(h.wx, h.wz), dt, 6);
      e.setAnim('run', 0.7);
    }
  }

  update(dt, time) {
    const g = this.game;
    for (const [e, h] of this.map) {
      h.t -= dt;
      if (!e.alive || e.removed || h.t <= 0) {
        if (e.alive && h.mode === 'control') g.fx?.burst?.(e.center, RED, 14, 4, 0.4, 0.2);
        this.release(e); continue;
      }
      h.tintT -= dt;
      if (h.tintT <= 0) { h.tintT = 0.25; e.model?.setTint?.(RED, h.mode === 'control' ? 0.45 : 0.25); }
      if (h.rune) {
        h.rune.position.set(e.pos.x, e.pos.y + e.height + 0.55 + Math.sin(time * 4) * 0.08, e.pos.z);
        h.rune.rotation.z += dt * (h.mode === 'control' ? 3 : -5);
      }
      h.fx -= dt;
      if (h.fx <= 0) { h.fx = 0.12; g.fx?.trailPuff?.(e.center.x + (Math.random() - 0.5) * 0.5, e.center.y + Math.random() * 0.8, e.center.z + (Math.random() - 0.5) * 0.5, RED, 0.35, 0.4, 0.05); }
    }
  }

  dispose() {
    this.releaseAll();
    for (const r of this.runes) r.parent?.remove(r);
    this.runes.length = 0;
  }
}
