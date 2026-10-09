// Cash: starts at $200, paid out on kills, plus spinning cash bundles dropped by enemies.
// Contract: docs/ARCHITECTURE.md#economy   game.events 'cash' { amount, total, pos } on every change.
import * as THREE from 'three';
import { KILL_REWARD, KILL_DROP, STARTING_CASH } from './defs.js';
import { buildCashBundle } from './models.js';

const _v = new THREE.Vector3();
const MAX_PICKUPS = 40;

export class Economy {
  constructor(game) {
    this.game = game;
    this.cash = STARTING_CASH;
    this.pickups = [];                       // { mesh, value, t, life, base }
    this.group = new THREE.Group(); this.group.name = 'cash-pickups';
    game.scene.add(this.group);
    this.earned = 0; this.spent = 0;         // run totals (stats / HUD)
    game.events.on('enemy:killed', (e) => this._onKill(e));
  }

  reset() {
    this.cash = STARTING_CASH; this.earned = 0; this.spent = 0;
    for (const p of this.pickups) this.group.remove(p.mesh);
    this.pickups.length = 0;
    this.game.events.emit('cash', { amount: 0, total: this.cash });
  }

  /** Give cash. With `pos`, shows a floating "+$50" and plays the coin sound. */
  add(amount, pos, { silent = false } = {}) {
    amount = Math.round(amount);
    if (!(amount > 0)) return;
    this.cash += amount; this.earned += amount;
    if (pos && !silent) {
      _v.copy(pos); if (!_v.y) _v.y = 1;
      this.game.fx?.text?.(_v, `+$${amount}`, 0x55ff88);
    }
    if (!silent) this.game.audio?.play?.('pickup');
    this.game.events.emit('cash', { amount, total: this.cash, pos: pos ? pos.clone() : undefined });
  }

  /** Take cash; false (and nothing changes) if the player cannot afford it. */
  spend(amount) {
    amount = Math.round(amount);
    if (this.cash < amount) return false;
    this.cash -= amount; this.spent += amount;
    this.game.events.emit('cash', { amount: -amount, total: this.cash });
    return true;
  }

  canAfford(amount) { return this.cash >= amount; }

  /** Drop a collectable bundle. */
  drop(pos, value) {
    if (this.pickups.length >= MAX_PICKUPS) { const old = this.pickups.shift(); this.group.remove(old.mesh); }
    const mesh = buildCashBundle(value >= 150);
    const gy = this.game.physics?.heightAt?.(pos.x, pos.z, pos.y + 2) ?? 0;
    const base = Math.max(gy, 0) + 0.55;
    mesh.position.set(pos.x, base, pos.z);
    this.group.add(mesh);
    this.pickups.push({ mesh, value, t: Math.random() * 6, life: 70, base, halo: mesh.children.find((c) => c.userData.halo) });
  }

  _onKill(e) {
    const kind = e.isBoss ? 'venom' : e.kind;
    const reward = KILL_REWARD[kind] ?? 0;
    if (reward > 0) this.add(reward, e.pos.clone().setY(e.pos.y + 2.2));
    if (e.isBoss) {
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.drop(_v.set(e.pos.x + Math.cos(a) * 3, e.pos.y, e.pos.z + Math.sin(a) * 3), 200 + Math.round(Math.random() * 100)); }
      return;
    }
    if (reward <= 0) return;
    const [chance, lo, hi] = KILL_DROP[kind] ?? KILL_DROP.default;
    if (Math.random() < chance) this.drop(e.pos, Math.round(lo + Math.random() * (hi - lo)));
  }

  /** Animate + collect. `focus` = position of whoever is collecting (player on foot, or the car being driven). */
  update(dt, focus) {
    const list = this.pickups;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt; p.life -= dt;
      const m = p.mesh;
      m.rotation.y += dt * 2.6;
      let remove = p.life <= 0;
      if (p.life < 5) m.visible = Math.sin(p.life * 22) > -0.2;
      if (focus) {
        const dx = focus.x - m.position.x, dz = focus.z - m.position.z, dy = focus.y + 1 - m.position.y;
        const d = Math.hypot(dx, dy, dz);
        if (d < 3.2 && d > 0.01) { const s = Math.min(d, (4.5 - d) * 3 * dt + dt * 2); m.position.x += dx / d * s; m.position.z += dz / d * s; p.base += dy / d * s * 0.5; }
        if (d < 1.5) {
          this.add(p.value, m.position.clone().setY(m.position.y + 0.8));
          this.game.fx?.burst?.(m.position, 0x55ff88, 12, 3.5, 0.5, 0.2);
          remove = true;
        }
      }
      if (remove) { this.group.remove(m); list.splice(i, 1); continue; }
      m.position.y = p.base + Math.sin(p.t * 3) * 0.12;
      if (p.halo) p.halo.scale.setScalar(1 + Math.sin(p.t * 4) * 0.12);
    }
  }
}
