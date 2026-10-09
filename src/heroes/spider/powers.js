// Spider-Man 2 style powers split out of SpiderMan.js: Symbiote Strike / Tendril Tear / Symbiote Punch / Rampage,
// classic-suit Arm Spin / Spider Slam / Yank & Slam / Web Throw, parry + counter.
// Every function takes the hero `h` (a SpiderMan) and uses its helpers: _center _hand _fx _play _rumble _later _task _hit _impact.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const BLACK = 0x07070c, PURPLE = 0x7a3cff;
const rnd = (a, b) => a + Math.random() * (b - a);

const alive = (h, range, from = null) => {
  const f = from || h.pos, out = [];
  for (const e of h.game.enemies?.list ?? []) {
    if (!e.alive || e.untargetable) continue;
    if (Math.hypot(e.pos.x - f.x, e.pos.z - f.z) <= range) out.push(e);
  }
  return out;
};

/** Glossy black + white splash used by every symbiote hit. */
export function symImpact(h, p, size = 1) {
  const fx = h.game.fx;
  fx.burst(p, BLACK, Math.round(18 * size), 8 * size, 0.5, 0.32);
  fx.burst(p, 0xffffff, Math.round(8 * size), 6, 0.3, 0.14);
  fx.ring(p, 1.5 * size, BLACK, 0.3); fx.ring(p, 0.9 * size, 0xffffff, 0.2);
  fx.flash(p, PURPLE, 2.5 * size, 0.12);
}

function tendrilTo(h, target, o = {}) {
  const getTo = typeof target === 'function' ? target : (out) => out.copy(target.center ?? target.pos);
  const side = o.side ?? (Math.random() < 0.5 ? -1 : 1);
  return h.tendrils.spawn({
    from: (out) => { h._center(out); out.y += 0.1; out.x += Math.cos(h.yaw) * 0.35 * side; out.z -= Math.sin(h.yaw) * 0.35 * side; return out; },
    to: getTo, life: o.life ?? 0.7, grow: o.grow ?? 0.12, width: o.width ?? 0.13, wiggle: o.wiggle ?? 0.7, delay: o.delay ?? 0, arc: o.arc ?? 0.1,
  });
}
function tendrilBurst(h, n, len = 9, life = 0.4, from = null) {
  const c = (from || h._center(new THREE.Vector3())).clone();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, el = rnd(-0.1, 0.8);
    const to = c.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(len * rnd(0.7, 1.2)));
    h.tendrils.spawn({ from: c, to, life, grow: 0.1, width: 0.12, wiggle: 1.0, arc: 0.05 });
  }
}

// =============================================================================== SYMBIOTE
/** Symbiote Strike: tendrils impale the target, launch it, then slam it back down. */
export function symbioteStrike(h, e) {
  if (!h.useCooldown('special', 2.4)) return false;
  const mul = h._dmgMul();
  const dir = new THREE.Vector3(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z).normalize();
  h.yaw = Math.atan2(dir.x, dir.z);
  h.lash = { kind: 'strike', t: 0, dir: dir.clone(), dur: 0.85, pulse: 99 };
  h.setAnim('cast', 1); h._play('symbiote'); h._rumble(0.5, 0.4, 140);
  for (let i = 0; i < 3; i++) tendrilTo(h, e, { life: 0.9, grow: 0.11, delay: 0.05 + i * 0.03, width: 0.15 - i * 0.02 });
  // anticipation 0.2 s, then impale
  h._later(0.2, () => {
    if (!e.alive) return;
    const p = e.center.clone();
    h._hit(e, 30 * mul, { stun: 1.5, kind: 'symbiote', heavy: true, point: p, kb: dir.clone().multiplyScalar(5).setY(18) });
    symImpact(h, p, 1.3); h._impact(0.85, true); h._play('heavyhit', { pos: p });
    h.game.hud?.hitMarker?.(false);
  });
  // slam back down
  h._later(0.62, () => {
    if (!e.alive || e.isBoss) return;
    e.vel.set(0, -32, 0);
    tendrilTo(h, e, { life: 0.3, grow: 0.06, width: 0.12 });
    h._task((dt, T) => {
      if (!e.alive) return true;
      T.t = (T.t || 0) + dt;
      if (e.onGround || T.t > 0.9) {
        const p = e.pos.clone();
        h.game.combat?.aoe?.({ center: p, radius: 3.8, damage: 20 * mul, knockback: 12, up: 5, stun: 1.0, source: h, team: 'player' });
        h._fx('shockwave', p.clone().setY(p.y + 0.1), 4, BLACK); symImpact(h, p.clone().setY(p.y + 0.3), 1.2);
        h._impact(0.9, true);
        return true;
      }
      return false;
    });
  });
  return true;
}

/** Tendril Tear: yank every enemy in range into a ring, then explode outward. */
export function tendrilTear(h) {
  const list = alive(h, 15).sort((x, y) => Math.hypot(x.pos.x - h.pos.x, x.pos.z - h.pos.z) - Math.hypot(y.pos.x - h.pos.x, y.pos.z - h.pos.z)).slice(0, 7);
  if (!list.length) return false;
  if (!h.useCooldown('tear', 7)) return false;
  const mul = h._dmgMul();
  h.lash = { kind: 'tear', t: 0, dir: h.forward, dur: 1.15, pulse: 99 };
  h.setAnim('cast', 1.2); h._play('symbiote'); h._play('venom', { volume: 0.5 });
  h._rumble(0.7, 0.6, 250); h.game.cam.shake(0.25);
  list.forEach((e, i) => tendrilTo(h, e, { life: 0.95, grow: 0.09, delay: i * 0.025, width: 0.16, wiggle: 0.9 }));
  const ang0 = Math.random() * 6;
  h._task((dt, T) => {
    T.t = (T.t || 0) + dt;
    list.forEach((e, i) => {
      if (!e.alive || e.isBoss && i > 0) return;
      const a = ang0 + (i / list.length) * Math.PI * 2;
      _c.set(h.pos.x + Math.cos(a) * 2.5, e.pos.y, h.pos.z + Math.sin(a) * 2.5);
      _d.set(_c.x - e.pos.x, 0, _c.z - e.pos.z); const d = _d.length();
      e.stunTimer = Math.max(e.stunTimer, 0.5); e.interrupt?.();
      if (!e.isBoss && d > 0.3) { _d.multiplyScalar(1 / d); const sp = Math.min(30, d * 10); e.vel.x = _d.x * sp; e.vel.z = _d.z * sp; if (e.vel.y < 3 && e.onGround) e.vel.y = 3.5; }
    });
    if (T.t < 0.5) return false;
    // detonate
    const c = h.pos.clone();
    h.game.combat?.aoe?.({ center: c, radius: 6, damage: 36 * mul, knockback: 28, up: 11, stun: 1.6, source: h, team: 'player', falloff: true });
    h._fx('shockwave', c.clone().setY(c.y + 0.1), 6.5, BLACK); h._fx('ring', c.clone().setY(c.y + 0.2), 5, PURPLE, 0.45);
    h._fx('flash', h._center(new THREE.Vector3()), PURPLE, 6, 0.25);
    h._fx('burst', h._center(new THREE.Vector3()), BLACK, 60, 12, 0.7, 0.36);
    tendrilBurst(h, 12, 8, 0.4);
    h._impact(1.0, true); h.game.cam.shake(0.8); h._play('heavyhit'); h._play('symbiote');
    h._fx('text', _a.set(h.pos.x, h.pos.y + 2.6, h.pos.z), 'TENDRIL TEAR', 0xc8a0ff, { size: 1.3, life: 1 });
    return true;
  });
  return true;
}

/** Symbiote Punch: charged hold-attack with huge knockback. c = charge 0..1 */
export function symbiotePunch(h, c) {
  const mul = h._dmgMul();
  const t = h._aimTargetNear?.(6) ?? null;
  const fwd = _a.set(Math.sin(h.yaw), 0, Math.cos(h.yaw));
  if (t) { fwd.set(t.pos.x - h.pos.x, 0, t.pos.z - h.pos.z).normalize(); h.yaw = Math.atan2(fwd.x, fwd.z); }
  h.atk = { step: 2, t: 0, dur: 0.6, hitAt: 99, hit: true, queued: false, air: false, special: true };
  h.setAnim('smash', 1); h._play('whoosh'); h._play('symbiote', { volume: 0.5 });
  h.vel.x = fwd.x * (8 + 8 * c); h.vel.z = fwd.z * (8 + 8 * c);
  const dir = fwd.clone();
  // fist of tendrils: anticipation is the charge itself, so the strike lands almost instantly
  h._later(0.08, () => {
    const origin = h._center(new THREE.Vector3());
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.18;
      const to = origin.clone().add(new THREE.Vector3(dir.x * Math.cos(a) - dir.z * Math.sin(a), 0.05 + i * 0.05, dir.x * Math.sin(a) + dir.z * Math.cos(a)).multiplyScalar(3.8 + 2.2 * c));
      h.tendrils.spawn({ from: (o) => h._hand(o), to, life: 0.4, grow: 0.07, width: 0.14, wiggle: 0.5, arc: 0.03 });
    }
    const hits = h.game.combat?.melee?.({
      origin, forward: dir, range: 4.2 + 1.5 * c, arc: 110, damage: (34 + 60 * c) * mul, knockback: 26 + 24 * c, up: 6 + 5 * c, stun: 1.6 + c, heavy: true, source: h, team: 'player',
    }) || [];
    if (hits.length) {
      for (const e of hits) symImpact(h, e.center, 1.2 + c);
      h._impact(0.8 + 0.2 * c, true); h.game.cam.shake(0.4 + 0.4 * c);
      h._fx('shockwave', h.pos.clone().add(dir.clone().multiplyScalar(2)).setY(h.pos.y + 0.1), 4 + 2 * c, BLACK);
      h.game.hud?.hitMarker?.(false);
    } else h._fx('ring', origin.clone().addScaledVector(dir, 2), 1.5, BLACK, 0.25);
    h._play('heavyhit'); h._rumble(0.9, 0.5, 160);
  });
  h.atkReset = 0.7; h.atkStep = 0;
}

// =============================================================================== CLASSIC (spider-arms style)
export function armSpin(h) {
  if (!h.useCooldown('armspin', 3.5)) return false;
  h.spin = { t: 0, pulses: 0, dir: h.forward };
  h.setAnim('cast', 1.5); h._play('whoosh'); h._rumble(0.3, 0.3, 100);
  return true;
}
/** Returns true while spinning. */
export function updateSpin(h, dt) {
  const S = h.spin; if (!S) return false;
  S.t += dt;
  const mul = h._dmgMul();
  h.vel.x *= Math.exp(-6 * dt); h.vel.z *= Math.exp(-6 * dt);
  if (!h.onGround) h.vel.y = Math.max(h.vel.y, -3);
  const ang = (S.t / 0.8) * Math.PI * 6;
  h._setPose(_a.set(Math.sin(h.yaw + ang), 0, Math.cos(h.yaw + ang)), UP, 40);
  h.setAnim('cast', 2);
  const times = [0.12, 0.3, 0.48, 0.66];
  while (S.pulses < times.length && S.t >= times[S.pulses]) {
    const last = S.pulses === times.length - 1; S.pulses++;
    const c = h.pos.clone(); c.y += 0.9;
    const hits = h.game.combat?.aoe?.({ center: c, radius: 4.4, damage: (last ? 24 : 12) * mul, knockback: last ? 18 : 8, up: last ? 9 : 3, stun: last ? 1.1 : 0.6, source: h, team: 'player', falloff: false }) || [];
    for (let i = 0; i < 4; i++) {
      const a = ang + (i / 4) * Math.PI * 2, o = h._center(new THREE.Vector3());
      h._fx('beam', o, o.clone().add(new THREE.Vector3(Math.sin(a) * 4, 0.3, Math.cos(a) * 4)), 0xff4040, 0.14, 0.14);
    }
    h._fx('ring', c, 4.4, 0xffffff, 0.3); h._play('whoosh', { volume: 0.6 });
    if (hits.length) { h._impact(last ? 0.8 : 0.35, false); h.game.hud?.hitMarker?.(false); }
  }
  if (S.t >= 0.8) { h.spin = null; h.atkReset = 0.4; }
  return !!h.spin;
}

/** Spider Slam: leap at a distant target (or dive from the air) and slam down with an AoE. */
export function spiderSlam(h, tgt) {
  if (!h.useCooldown('slam', 4)) return false;
  h.slam = true; h.slamPower = h.symbiote ? 'sym' : 'spider';
  if (h.onGround && tgt) {
    const dx = tgt.pos.x - h.pos.x, dz = tgt.pos.z - h.pos.z, d = Math.hypot(dx, dz), T = Math.min(0.75, Math.max(0.45, d / 28));
    h.vel.x = dx / T; h.vel.z = dz / T;
    h.vel.y = ((tgt.pos.y - h.pos.y) + 0.5 * h.gravity * T * T) / T;
    h.onGround = false; h.yaw = Math.atan2(dx, dz); h.slamLeapT = T;
    h.setAnim('jump', 1); h._play('jump'); h._play('whoosh');
  } else {
    h.vel.y = -36; h.vel.x *= 0.25; h.vel.z *= 0.25;
    h.setAnim('smash', 1); h._play('whoosh');
  }
  h._fx('burst', h.pos.clone().setY(h.pos.y + 0.5), h.symbiote ? BLACK : 0xffffff, 14, 5);
  return true;
}
export function landSlam(h) {
  const sym = h.symbiote, big = h.slamPower && h.slamPower !== 'air', mul = h._dmgMul();
  const r = big ? 6.5 : 5, dmg = big ? 32 : 18;
  h.slam = false; h.slamPower = null;
  h.game.combat?.aoe?.({ center: h.pos.clone(), radius: r, damage: dmg * mul, knockback: big ? 16 : 10, up: big ? 9 : 6, stun: big ? 1.1 : 0.7, source: h, team: 'player' });
  h._fx('shockwave', h.pos.clone().setY(h.pos.y + 0.1), r, sym ? BLACK : 0xffffff);
  h._fx('ring', h.pos.clone().setY(h.pos.y + 0.2), r * 0.7, sym ? PURPLE : 0xffd080, 0.4);
  h._fx('dust', h.pos.clone(), 14, r * 0.5);
  if (sym) tendrilBurst(h, big ? 10 : 5, r * 0.9, 0.35, h.pos.clone().setY(h.pos.y + 0.4));
  h._impact(big ? 0.9 : 0.6, sym); h.game.cam.shake(big ? 0.55 : 0.4); h._rumble(0.9, 0.5, 170); h._play('heavyhit');
}

/** A webbed enemy: yank it to you and slam it into the ground. */
export function yankSlam(h, e) {
  const mul = h._dmgMul();
  h.pullLineT = 0.45; h.pullTarget = e; h.lines.pull.begin(0.4);
  _a.set(h.pos.x + Math.sin(h.yaw) * 1.8, e.pos.y, h.pos.z + Math.cos(h.yaw) * 1.8);
  const T = 0.3;
  const dx = _a.x - e.pos.x, dz = _a.z - e.pos.z;
  e.launched = true; e.vel.set(dx / T, 9, dz / T);
  h._play('thwip'); h._play('whoosh'); h.setAnim('throw', 1);
  h._later(T + 0.02, () => { if (e.alive) e.vel.set(0, -30, 0); });
  h._task((dt, K) => {
    K.t = (K.t || 0) + dt;
    if (!e.alive) return true;
    if (K.t > T + 0.05 && (e.onGround || K.t > 1)) {
      const p = e.pos.clone();
      h.game.combat?.aoe?.({ center: p, radius: 3.6, damage: 34 * mul, knockback: 13, up: 6, stun: 1.2, source: h, team: 'player' });
      h._fx('shockwave', p.clone().setY(p.y + 0.1), 3.8, 0xffffff); h._fx('burst', p.clone().setY(p.y + 0.4), 0xffffff, 22, 7, 0.45, 0.2);
      h._fx('text', _b.set(p.x, p.y + 2.4, p.z), 'YANK & SLAM', 0xffffff, { size: 1.2, life: 0.9 });
      h._impact(0.85, false); h.game.hud?.hitMarker?.(false);
      return true;
    }
    return false;
  });
}

/** A webbed enemy: swing it around you and hurl it into the others. */
export function webThrow(h, e) {
  if (!h.useCooldown('pull', 3)) return false;
  const mul = h._dmgMul();
  h.pullLineT = 1; h.pullTarget = e; h.lines.pull.begin(0.5);
  h.setAnim('throw', 1); h._play('thwip'); h._play('whoosh');
  const dirAtThrow = () => { const d = h.game.cam.aimDirection(new THREE.Vector3()); d.y = Math.max(d.y, 0.05); return d.normalize(); };
  let ang = Math.atan2(e.pos.x - h.pos.x, e.pos.z - h.pos.z), phase = 'swing', t = 0;
  const hitSet = new Set([e]);
  const vel = new THREE.Vector3();
  h._task((dt) => {
    if (!e.alive) { h.pullLineT = 0; return true; }
    t += dt;
    if (phase === 'swing') {
      ang += dt * 15;
      e.pos.set(h.pos.x + Math.sin(ang) * 2.4, h.pos.y + 0.6, h.pos.z + Math.cos(ang) * 2.4);
      e.vel.set(0, 0, 0); e.webTimer = Math.max(e.webTimer, 1); e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.3);
      h.pullLineT = 1; h.setAnim('throw', 1);
      if (t > 0.7) {
        phase = 'fly'; t = 0;
        const d = dirAtThrow(); vel.copy(d).multiplyScalar(34);
        const tgt = h.gadgets._near(h._center(_c), 20, [e], false);
        if (tgt) { vel.copy(tgt.center).sub(e.center).normalize().multiplyScalar(34); }
        e.vel.copy(vel); h.pullLineT = 0; h._play('whoosh'); h._rumble(0.5, 0.3, 100);
        h._fx('text', _b.set(e.pos.x, e.pos.y + e.height + 0.6, e.pos.z), 'WEB THROW', 0xffffff, { size: 1.1, life: 0.8 });
      }
    } else {
      e.vel.x = vel.x; e.vel.z = vel.z;
      for (const o of h.game.enemies?.list ?? []) {
        if (!o.alive || hitSet.has(o)) continue;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < o.radius + e.radius + 0.7 && Math.abs(o.pos.y - e.pos.y) < 2.4) {
          hitSet.add(o);
          h._hit(o, 24 * mul, { stun: 1.2, kind: 'web', heavy: true, kb: _d.copy(vel).setY(0).normalize().multiplyScalar(14).setY(7).clone() });
          h._fx('burst', o.center, 0xffffff, 18, 7, 0.4, 0.2); h._fx('ring', o.center, 2, 0xffffff, 0.3);
          h._impact(0.7, false); h.game.hud?.hitMarker?.(false);
          vel.multiplyScalar(0.75);
        }
      }
      if (t > 0.9 || (t > 0.1 && e.onGround)) {
        h._hit(e, 14 * mul, { stun: 1, kind: 'web', point: e.center });
        e.webTimer = Math.max(e.webTimer, 1.5);
        return true;
      }
    }
    return false;
  });
  return true;
}

// =============================================================================== RAMPAGE (symbiote ultimate)
export const RAMPAGE = { windup: 0.45, total: 4.5, pulse: 0.16 };

export function rampageStart(h) {
  h.slowmoPending = true;
  h.game.slowmo?.(0.5, 0.3);
  h._fx('flash', h._center(new THREE.Vector3()), PURPLE, 5, 0.3);
}
/** Update the Rampage; returns true when finished. */
export function rampageUpdate(h, dt, U) {
  const mul = h._dmgMul();
  const c = h._center(new THREE.Vector3());
  // hover at the centre of the storm
  h.gravityScale = 0.1; h.vel.x *= Math.exp(-8 * dt); h.vel.z *= Math.exp(-8 * dt); h.vel.y *= Math.exp(-6 * dt);
  if (U.t < RAMPAGE.windup && U.t - dt < 0.01) { for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; h.tendrils.spawn({ from: c, to: c.clone().add(new THREE.Vector3(Math.cos(a) * 2.2, -0.8 + (i % 2) * 2, Math.sin(a) * 2.2)), life: 0.6, grow: 0.25, width: 0.14, wiggle: 1.4, arc: 0.3 }); } }
  if (!U.burst && U.t >= RAMPAGE.windup) {
    U.burst = true;
    h.game.combat?.aoe?.({ center: h.pos.clone(), radius: 20, damage: 60 * mul, knockback: 26, up: 14, stun: 2.0, source: h, team: 'player', falloff: true });
    h._fx('shockwave', h.pos.clone().setY(h.pos.y + 0.1), 20, BLACK); h._fx('ring', h.pos.clone().setY(h.pos.y + 0.2), 14, PURPLE, 0.7);
    h._fx('flash', c, PURPLE, 7, 0.35); h._fx('burst', c, BLACK, 90, 15, 0.9, 0.42);
    tendrilBurst(h, 18, 14, 0.55);
    h.game.cam.shake(1.2); h._rumble(1, 1, 450); h._play('venom'); h._play('heavyhit');
    h.game.hud?.toast?.('RAMPAGE');
  }
  if (U.t >= RAMPAGE.windup + 0.1 && U.t < RAMPAGE.total - 0.35) {
    U.acc = (U.acc || 0) + dt;
    while (U.acc >= RAMPAGE.pulse) {
      U.acc -= RAMPAGE.pulse;
      const list = alive(h, 20);
      for (let k = 0; k < 3 && list.length; k++) {
        const e = list.splice(Math.floor(Math.random() * list.length), 1)[0];
        const p = e.center.clone();
        tendrilTo(h, e, { life: 0.38, grow: 0.07, width: 0.13, wiggle: 1.0, side: k % 2 ? 1 : -1 });
        h.game.combat?.aoe?.({ center: p.clone().setY(e.pos.y), radius: 2.4, damage: 11 * mul, knockback: 9, up: 5, stun: 0.9, source: h, team: 'player', falloff: true });
        symImpact(h, p, 0.8);
      }
      tendrilBurst(h, 3, rnd(8, 14), 0.3);
      h.game.cam.shake(0.16); h._rumble(0.5, 0.6, 70);
      if (Math.random() < 0.4) h._play('hit');
    }
    // keep facing the nearest enemy
    const n = h.game.enemies?.nearest?.(h.pos, 30);
    if (n) h.yaw += Math.atan2(Math.sin(Math.atan2(n.pos.x - h.pos.x, n.pos.z - h.pos.z) - h.yaw), Math.cos(Math.atan2(n.pos.x - h.pos.x, n.pos.z - h.pos.z) - h.yaw)) * Math.min(1, 10 * dt);
  }
  if (!U.fin && U.t >= RAMPAGE.total - 0.35) {
    U.fin = true;
    h.game.combat?.aoe?.({ center: h.pos.clone(), radius: 20, damage: 50 * mul, knockback: 32, up: 16, stun: 2.2, source: h, team: 'player', falloff: true });
    h._fx('shockwave', h.pos.clone().setY(h.pos.y + 0.1), 20, BLACK); h._fx('ring', h.pos.clone().setY(h.pos.y + 0.3), 16, 0xffffff, 0.6);
    h._fx('flash', c, 0xffffff, 8, 0.3); h._fx('burst', c, BLACK, 70, 15, 0.8, 0.4);
    tendrilBurst(h, 20, 16, 0.5);
    h.game.cam.shake(1.4); h._rumble(1, 1, 500); h._play('explosion'); h._play('heavyhit');
    h.game.slowmo?.(0.25, 0.12);
  }
  return U.t >= RAMPAGE.total;
}
