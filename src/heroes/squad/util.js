// Shared helpers for Wolverine + Captain America. Everything is defensive: optional model hooks / stub subsystems never throw.
import * as THREE from 'three';
export { Timers, aimInfo, enemiesNear, enemyCenter, rumble, impactFx, clamp, damp, objPos } from '../avengers/util.js';

const _t = new THREE.Vector3();

/**
 * Damage one enemy directly (used for bleeds, pins, dashes where combat.melee's cone doesn't fit).
 * o: { kb:Vector3, stun, kind, color, quiet (no number), silent (no audio) }. Returns damage dealt (0 if blocked / invulnerable).
 */
export function hurt(game, hero, e, dmg, o = {}) {
  if (!e || e.alive === false) return 0;
  const dealt = e.takeDamage?.(dmg, { knockback: o.kb ?? undefined, stun: o.stun ?? 0.3, source: hero, kind: o.kind ?? 'melee' }) ?? 0;
  if (!(dealt > 0)) return 0;
  const heavy = dealt >= 24;
  const c = e.center ?? e.pos;
  game.fx?.hitSpark?.(c, o.color ?? (heavy ? 0xffd070 : 0xfff2c0), heavy);
  if (!o.quiet) {
    _t.set(e.pos.x, e.pos.y + (e.height ?? 1.8) + 0.35, e.pos.z);
    game.fx?.text?.(_t, String(Math.round(dealt)), heavy ? 0xffb030 : 0xffffff, heavy ? { size: 1.3 } : null);
  }
  if (!o.silent) game.audio?.play?.(heavy ? 'heavyhit' : 'hit', { pos: c });
  hero.registerHit?.();
  return dealt;
}

/** Ribbon trail that never throws. Returns a handle with stop(). */
export function trailOn(game, obj, color, width = 0.2, life = 0.4) {
  try { return game.fx?.trail?.(obj, color, width, life) ?? { stop() {} }; } catch { return { stop() {} }; }
}

/** Is the world position `from` inside a frontal cone (deg total) of a facing yaw at pos? */
export function inFront(pos, yaw, from, deg = 120) {
  const dx = from.x - pos.x, dz = from.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d >= Math.cos(THREE.MathUtils.degToRad(deg * 0.5));
}

/** Weighty hit feel: brief hit-stop + scaled shake + rumble. power 0..1 */
export function impact(game, power = 0.5, stop = true) {
  game.cam?.shake?.(0.06 + power * 0.4);
  game.input?.rumble?.(0.2 + power * 0.7, 0.2 + power * 0.4, 60 + power * 200);
  if (stop && power >= 0.4 && (game._slowmo ?? 0) <= 0.05) game.slowmo?.(0.05, 0.05);
}
