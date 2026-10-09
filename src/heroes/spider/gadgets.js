// Spider-Man web-shooter gadgets (Marvel's Spider-Man 2 style): selected while aiming, fired with LMB / R2.
//   Web Shooter    rapid web blobs, 3 stacked hits fully web the enemy
//   Impact Web     heavy web: knocks back and PINS the enemy to the nearest wall / ground for 6 s
//   Electric Web   shock web that chains to 3 more enemies (stun + damage)
//   Ricochet Web   bounces between up to 4 enemies (and off walls to the nearest one)
//   Concussion     air-burst shockwave that blasts groups back
//   Upshot         launches the target into the air, then auto-webs it in mid-air
// Each gadget has charges that recharge in the background (like SM2 gadget cooldowns).
import * as THREE from 'three';

export const GADGETS = [
  { id: 'web',        name: 'Web Shooter',      max: 8, rech: 0.7, rate: 0.14, auto: true,  color: 0xffffff },
  { id: 'impact',     name: 'Impact Web',       max: 2, rech: 6.0, rate: 0.7,  auto: false, color: 0xffe9b0 },
  { id: 'electric',   name: 'Electric Web',     max: 3, rech: 5.0, rate: 0.5,  auto: false, color: 0x6fd8ff },
  { id: 'ricochet',   name: 'Ricochet Web',     max: 2, rech: 6.0, rate: 0.6,  auto: false, color: 0xffffff },
  { id: 'concussion', name: 'Concussion Blast', max: 2, rech: 8.0, rate: 0.8,  auto: false, color: 0xcfeaff },
  { id: 'upshot',     name: 'Upshot',           max: 2, rech: 7.0, rate: 0.8,  auto: false, color: 0xffffff },
];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const PIN_TIME = 6;

let DECAL_TEX = null;
function decalTexture() {
  if (DECAL_TEX) return DECAL_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64); x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineCap = 'round';
  x.lineWidth = 2.2;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 60, Math.sin(a) * 60); x.stroke(); }
  x.lineWidth = 1.6;
  for (let r = 14; r <= 58; r += 11) {
    x.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2, rr = r * (0.88 + 0.12 * ((i * 7) % 3) / 2);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) x.moveTo(px, py); else x.quadraticCurveTo(Math.cos(a - Math.PI / 12) * rr * 0.9, Math.sin(a - Math.PI / 12) * rr * 0.9, px, py);
    }
    x.stroke();
  }
  x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(0, 0, 9, 0, Math.PI * 2); x.fill();
  DECAL_TEX = new THREE.CanvasTexture(c);
  return DECAL_TEX;
}

export class Gadgets {
  constructor(hero) {
    this.h = hero;
    this.sel = 0;
    this.charges = GADGETS.map((g) => g.max);
    this.rateT = 0;
    this.pins = [];
    this.decals = [];
    this._emptyT = 0;
  }

  get cur() { return GADGETS[this.sel]; }
  reset() {
    this.sel = 0; this.charges = GADGETS.map((g) => g.max); this.rateT = 0;
    for (const p of this.pins) this._release(p, true);
    this.pins.length = 0;
    for (const d of this.decals) d.mesh.visible = false;
  }
  cycle(dir) {
    this.sel = (this.sel + dir + GADGETS.length) % GADGETS.length;
    const h = this.h, g = GADGETS[this.sel];
    h._play('ui_move');
    h.game.hud?.toast?.(`${g.name.toUpperCase()}  ${Math.floor(this.charges[this.sel])}/${g.max}`);
  }
  /** 0 = ready, 1 = just spent (for the HUD cooldown ring). */
  frac(i = this.sel) { const c = this.charges[i]; return c >= 1 ? 0 : 1 - c; }
  label(i = this.sel) { const g = GADGETS[i]; return `${g.name}  ${Math.floor(this.charges[i])}/${g.max}`; }

  update(dt) {
    this.rateT = Math.max(0, this.rateT - dt);
    this._emptyT = Math.max(0, this._emptyT - dt);
    for (let i = 0; i < GADGETS.length; i++) {
      const g = GADGETS[i];
      if (this.charges[i] < g.max) this.charges[i] = Math.min(g.max, this.charges[i] + dt / g.rech);
    }
    this._updatePins(dt);
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.t += dt;
      const left = d.life - d.t;
      d.mesh.material.opacity = Math.max(0, Math.min(0.9, left * 1.2));
      if (left <= 0) d.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------------ aiming
  /** Camera-centre ray vs the world and the enemies. Returns { origin, dir, point, enemy, head, dist }. */
  aimRay(range = 140) {
    const g = this.h.game;
    const origin = g.camera.position.clone();
    const dir = g.cam.aimDirection(new THREE.Vector3());
    const wall = g.physics.raycast(origin, dir, range);
    let bestT = wall ? wall.distance : range;
    let enemy = null, head = false;
    const assist = g.input?.lastDevice === 'gamepad' ? 0.3 : 0.05;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || e.untargetable) continue;
      for (let s = 0; s < 4; s++) {
        const isHead = s === 3;
        const y = e.pos.y + e.height * (isHead ? 0.9 : [0.25, 0.5, 0.72][s]);
        const rr = (isHead ? 0.25 : e.radius * 1.05) + assist;
        _a.set(e.pos.x - origin.x, y - origin.y, e.pos.z - origin.z);
        const proj = _a.dot(dir);
        if (proj < 1.5 || proj > bestT + rr) continue;
        const d2 = _a.lengthSq() - proj * proj;
        if (d2 > rr * rr) continue;
        const tt = Math.max(1.5, proj - Math.sqrt(Math.max(0, rr * rr - d2)));
        if (tt < bestT || (enemy === e && isHead)) { bestT = tt; enemy = e; head = isHead; }
      }
    }
    const point = origin.clone().addScaledVector(dir, bestT);
    return { origin, dir, point, enemy, head, dist: bestT, wall };
  }

  _muzzle() {
    const h = this.h;
    const m = h._hand(new THREE.Vector3());
    if (!h.game.physics.lineOfSight(h._center(_o), m)) m.copy(h._center(new THREE.Vector3()));
    return m;
  }

  _proj(kind, speed, o) {
    const h = this.h, ray = this.aimRay();
    const muzzle = this._muzzle();
    const dir = _d.copy(ray.point).sub(muzzle);
    if (dir.lengthSq() < 4) dir.copy(ray.dir);
    dir.normalize();
    const range = 120;
    const p = h.game.combat?.projectile?.({
      pos: muzzle, vel: dir.clone().multiplyScalar(speed), team: 'player', source: h, kind, life: range / speed,
      user: {}, ...o,
    });
    return { p, ray, dir: dir.clone(), muzzle };
  }

  // ------------------------------------------------------------------ firing
  /** held = fire button is being held (auto-fire gadgets repeat), returns true when something was fired. */
  tryFire(pressed, held) {
    const def = this.cur;
    if (!(pressed || (held && def.auto))) return false;
    if (this.rateT > 0) return false;
    if (this.charges[this.sel] < 1) {
      if (pressed && this._emptyT <= 0) {
        this._emptyT = 0.5; this.h._play('ui_back', { volume: 0.5 });
        this.h._fx('text', this.h._center(new THREE.Vector3()).setY(this.h.pos.y + 2.3), 'RECHARGING', '#9fb0c8', { size: 0.8, life: 0.6 });
      }
      return false;
    }
    this.charges[this.sel] -= 1; this.rateT = def.rate;
    this['_' + def.id]();
    return true;
  }

  _fired(rumble = 0.2, shake = 0.04) {
    const h = this.h;
    h.shootT = 0.22; h.setAnim('shoot', 1);
    h.anim.t = 0;
    h._play('thwip'); h._rumble(rumble, rumble * 0.8, 60); h.game.cam.shake(shake);
  }

  _hitFeedback(precision, pos, heavy = false) {
    const h = this.h;
    h.game.hud?.hitMarker?.(precision);
    h._rumble(heavy ? 0.5 : 0.2, 0.2, heavy ? 110 : 50);
    h.addFocus(precision ? 5 : 2);
  }

  _dmg(e, amount, o = {}) {
    const { stun = 0.4, kb = null, kind = 'gadget', point = null, heavy = false, first = true } = o;
    const cb = this.h.game.combat;
    if (cb?._hurtEnemy) return cb._hurtEnemy(e, amount, kb || new THREE.Vector3(), stun, this.h, kind, point || e.center, heavy, first);
    return e.takeDamage(amount, { knockback: kb, stun, source: this.h, kind }) > 0;
  }

  _precision(e, p, mul) {
    const h = this.h;
    this._dmg(e, 5 * mul, { stun: 1.5, kind: 'web', point: p.pos, heavy: true });
    h._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'PRECISION', 0xffc040, { size: 1.1, life: 0.8 });
    h._fx('hitSpark', p.pos, 0xffd040, true);
  }
  _isHead(e, p) { return p.pos.y > e.pos.y + e.height * 0.8; }

  _near(from, range, exclude, los = true) {
    const g = this.h.game; let best = null, bd = range * range;
    for (const e of g.enemies?.list ?? []) {
      if (!e.alive || e.untargetable || exclude.includes(e)) continue;
      const dx = e.center.x - from.x, dy = e.center.y - from.y, dz = e.center.z - from.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd && (!los || g.physics.lineOfSight(from, e.center))) { bd = d2; best = e; }
    }
    return best;
  }

  // ---- Web Shooter ---------------------------------------------------------
  _web() {
    const h = this.h, mul = h._dmgMul();
    this._proj('web', 72, {
      damage: 4 * mul, radius: 0.32, size: 0.13, webTime: 0.12, knockback: 2, up: 0.5, stun: 0.3,
      onHit: (e, p) => {
        const now = h.game.time ?? 0;
        e._wsN = (e._wsT !== undefined && now - e._wsT < 3.5) ? (e._wsN || 0) + 1 : 1; e._wsT = now;
        e.slowTimer = Math.max(e.slowTimer || 0, 1.0);
        const head = this._isHead(e, p);
        if (head) this._precision(e, p, mul);
        if (e._wsN >= 3) {
          e.web?.(5); e._wsN = 0;
          h._fx('text', _a.set(e.pos.x, e.pos.y + e.height + 0.5, e.pos.z), 'WEBBED', 0xdff4ff, { size: 1.0, life: 0.8 });
          h._fx('ring', e.pos, 1.8, 0xffffff, 0.3);
        }
        this._hitFeedback(head, p.pos);
      },
    });
    this._fired(0.12, 0.02);
  }

  // ---- Impact Web ----------------------------------------------------------
  _impact() {
    const h = this.h, mul = h._dmgMul();
    this._proj('web', 54, {
      damage: 20 * mul, radius: 0.5, size: 0.4, webTime: 0.15, knockback: 12, up: 1.5, stun: 0.8, heavy: true,
      onHit: (e, p) => {
        const head = this._isHead(e, p);
        if (head) this._precision(e, p, mul);
        this._pin(e, p);
        h.game.cam.shake(0.3); this._hitFeedback(head, p.pos, true); h._play('heavyhit');
      },
    });
    this._fired(0.5, 0.15);
  }

  _decal(point, normal) {
    let d = this.decals.find((x) => !x.mesh.visible);
    if (!d) {
      if (this.decals.length >= 8) d = this.decals[0];
      else {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({
          map: decalTexture(), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
        m.renderOrder = 4; m.frustumCulled = false; this.h.game.scene.add(m);
        d = { mesh: m, t: 0, life: PIN_TIME }; this.decals.push(d);
      }
    }
    d.t = 0; d.life = PIN_TIME + 0.5;
    d.mesh.position.copy(point).addScaledVector(normal, 0.05);
    d.mesh.lookAt(_o.copy(point).add(normal));
    d.mesh.rotateZ(Math.random() * 6);
    d.mesh.scale.setScalar(1.7);
    d.mesh.visible = true;
    return d;
  }

  _pin(e, p) {
    const h = this.h, g = h.game;
    if (e.isBoss) { e.web?.(2); return; }
    const old = this.pins.findIndex((q) => q.e === e);
    if (old >= 0) { this._release(this.pins[old], true); this.pins.splice(old, 1); }
    const hd = _b.set(p.vel.x, 0, p.vel.z);
    if (hd.lengthSq() < 1e-4) hd.copy(h.forward); hd.normalize();
    const c = e.center;
    const hit = g.physics.raycast(c, hd, 11, { ignoreGround: true });
    e.web?.(PIN_TIME);
    if (hit && hit.distance > 1 && Math.abs(hit.normal.y) < 0.6) {
      const to = hit.point.clone().addScaledVector(hit.normal, e.radius + 0.14);
      const gy = g.physics.heightAt(to.x, to.z, to.y + 0.5);
      to.y = Math.max(to.y, gy + e.height * 0.55);
      const d = this._decal(hit.point, hit.normal);
      this.pins.push({ e, to, normal: hit.normal.clone(), state: 'fly', t: 0, hold: PIN_TIME, decal: d });
      e.launched = false; e.interrupt?.();
    } else {
      // no wall nearby: pin them to the ground right where they stand
      e.downTimer = Math.max(e.downTimer || 0, 0.6);
      const gp = _a.set(e.pos.x, e.pos.y + 0.05, e.pos.z);
      this._decal(gp, new THREE.Vector3(0, 1, 0));
    }
    h._fx('ring', e.pos, 2.2, 0xffffff, 0.4);
  }

  _release(pin, silent = false) {
    const e = pin.e;
    if (e && e.alive) { e.webTimer = silent ? 0.01 : 0.01; }
    if (pin.decal) pin.decal.life = Math.min(pin.decal.life, pin.decal.t + 0.4);
  }

  _updatePins(dt) {
    for (let i = this.pins.length - 1; i >= 0; i--) {
      const p = this.pins[i], e = p.e;
      p.t += dt;
      if (!e.alive || e.removed || p.t > p.hold) {
        this._release(p); this.pins.splice(i, 1);
        if (e.alive) this.h._fx('burst', e.center, 0xffffff, 12, 3, 0.35, 0.18);
        continue;
      }
      e.webTimer = Math.max(e.webTimer, 0.5);
      if (p.state === 'fly') {
        _a.copy(p.to).sub(e.center); const d = _a.length();
        if (d < 0.7 || p.t > 0.55) { p.state = 'stuck'; this.h._fx('burst', p.to, 0xffffff, 14, 4, 0.4, 0.2); this.h.game.cam.shake(0.12); this.h._play('hit', { pos: p.to }); }
        else { _a.multiplyScalar(1 / d); e.vel.copy(_a).multiplyScalar(Math.min(46, d / Math.max(dt, 1e-3) * 0.9)); }
      }
      if (p.state === 'stuck') {
        e.pos.set(p.to.x, p.to.y - e.height * 0.55, p.to.z);
        e.vel.set(0, 0, 0); e.launched = false;
      }
    }
  }

  // ---- Electric Web --------------------------------------------------------
  _electric() {
    const h = this.h, mul = h._dmgMul();
    this._proj('repulsor', 62, {
      damage: 14 * mul, radius: 0.4, size: 0.3, color: 0x6fd8ff, knockback: 3, up: 0.8, stun: 1.2, webTime: 1,
      onHit: (e, p) => {
        const head = this._isHead(e, p);
        if (head) this._precision(e, p, mul);
        this._arc(e);
        this._hitFeedback(head, p.pos, true);
      },
    });
    this._fired(0.3, 0.06);
    h._play('repulsor', { pitch: 1.6, volume: 0.6 });
  }

  _arc(first) {
    const h = this.h, fx = h.game.fx, mul = h._dmgMul();
    const hits = [first]; let cur = first;
    fx.lightning(_a.copy(first.center).add(_b.set(0, 1.2, 0)), first.center, 0x9fe8ff, 0.3, 4);
    fx.flash(first.center, 0x6fd8ff, 4, 0.2);
    for (let i = 0; i < 3; i++) {
      const nxt = this._near(cur.center, 9.5, hits);
      if (!nxt) break;
      hits.push(nxt);
      const from = cur.center.clone(), n = nxt;
      h._later(0.08 * (i + 1), () => {
        if (!n.alive) return;
        fx.lightning(from, n.center, 0x6fd8ff, 0.28, 4);
        fx.burst(n.center, 0x6fd8ff, 14, 6, 0.35, 0.16);
        fx.flash(n.center, 0x6fd8ff, 3, 0.15);
        this._dmg(n, 10 * mul, { stun: 1.3, kind: 'shock', heavy: false });
        h._play('lightning', { pos: n.pos, volume: 0.6 });
      });
      cur = nxt;
    }
    // lingering shock crackle on everyone hit
    hits.forEach((e, k) => {
      for (let j = 1; j <= 3; j++) h._later(0.1 * k + 0.22 * j, () => {
        if (!e.alive) return;
        fx.lightning(_a.set(e.pos.x, e.pos.y + 0.1, e.pos.z), _b.set(e.pos.x, e.pos.y + e.height, e.pos.z), 0x6fd8ff, 0.12, 2);
        e.stunTimer = Math.max(e.stunTimer, 0.25);
      });
    });
    if (hits.length > 1) h._fx('text', _a.set(first.pos.x, first.pos.y + first.height + 1.3, first.pos.z), `CHAIN x${hits.length}`, 0x9fe8ff, { size: 1.0, life: 0.9 });
  }

  // ---- Ricochet Web --------------------------------------------------------
  _ricochet() {
    const h = this.h, mul = h._dmgMul();
    this._proj('web', 66, {
      damage: 12 * mul, radius: 0.34, size: 0.16, webTime: 0.12, knockback: 3, up: 0.8, stun: 0.5,
      onHit: (e, p) => { p.user.done = true; this._bounce(p.pos.clone(), e); this._hitFeedback(this._isHead(e, p), p.pos); },
      onExpire: (p) => { if (p.user.done) return; p.user.done = true; this._bounce(p.pos.clone(), null); },
    });
    this._fired(0.2, 0.04);
  }

  _bounce(start, first) {
    const h = this.h, fx = h.game.fx, mul = h._dmgMul();
    const visited = first ? [first] : [];
    let pos = first ? first.center.clone() : start.clone();
    while (visited.length < 4) {
      const tgt = this._near(pos, 15, visited);
      if (!tgt) break;
      visited.push(tgt);
      const from = pos.clone(), delay = 0.1 * (visited.length - (first ? 1 : 0)), k = visited.length;
      h._later(delay, () => {
        fx.beam(from, tgt.center, 0xffffff, 0.07, 0.12);
        if (!tgt.alive) return;
        this._dmg(tgt, 12 * mul, { stun: 0.6, kind: 'web', kb: _b.copy(tgt.center).sub(from).setY(0).normalize().multiplyScalar(4).setY(1) });
        tgt.web?.(1.8);
        fx.burst(tgt.center, 0xffffff, 12, 5, 0.4, 0.18); fx.ring(tgt.center, 1.4, 0xffffff, 0.25);
        h._play('thwip', { pos: tgt.pos, pitch: 1.2 + 0.1 * k });
        h.game.hud?.hitMarker?.(false);
      });
      pos = tgt.center.clone();
    }
    if (visited.length >= 2) h._fx('text', _a.set(pos.x, pos.y + 1.4, pos.z), `RICOCHET x${visited.length}`, 0xffffff, { size: 1.0, life: 0.9 });
    if (!first && visited.length) fx.burst(start, 0xffffff, 10, 4, 0.3, 0.15);
  }

  // ---- Concussion Blast ----------------------------------------------------
  _concussion() {
    const h = this.h;
    const { p, dir } = this._proj('repulsor', 70, {
      damage: 3, radius: 0.4, size: 0.4, color: 0xcfeaff, knockback: 2, up: 0.5, stun: 0.2, life: 0.7,
      onHit: (e, q) => { q.user.done = true; this._detonate(q.pos.clone()); },
      onExpire: (q) => { if (q.user.done) return; q.user.done = true; this._detonate(q.pos.clone()); },
    });
    if (!h.onGround) h.vel.addScaledVector(dir, -3.5);
    this._fired(0.6, 0.18);
    h._play('explosion', { volume: 0.4, pitch: 1.6 });
  }

  _detonate(pos) {
    const h = this.h, g = h.game, fx = g.fx, mul = h._dmgMul();
    const hits = g.combat?.aoe?.({ center: pos, radius: 7, damage: 18 * mul, knockback: 22, up: 8, stun: 1.4, source: h, team: 'player', falloff: true }) ?? [];
    fx.shockwave(pos, 7, 0xcfeaff); fx.ring(pos, 5, 0xffffff, 0.45); fx.flash(pos, 0xcfeaff, 7, 0.22);
    fx.burst(pos, 0xffffff, 40, 12, 0.5, 0.3); fx.burst(pos, 0x9fd8ff, 24, 8, 0.6, 0.25);
    const dist = pos.distanceTo(h.pos);
    g.cam.shake(Math.max(0.1, 0.6 - dist * 0.012)); h._rumble(0.8, 0.6, 180); h._play('explosion', { pos });
    if (hits.length) { h.addFocus(3 * hits.length); g.hud?.hitMarker?.(false); if (hits.length >= 3) h._fx('text', _a.set(pos.x, pos.y + 2, pos.z), `x${hits.length} BLASTED`, 0xcfeaff, { size: 1.1 }); }
  }

  // ---- Upshot --------------------------------------------------------------
  _upshot() {
    const h = this.h, mul = h._dmgMul();
    this._proj('web', 62, {
      damage: 12 * mul, radius: 0.36, size: 0.22, webTime: 0.12, knockback: 0, up: 0, stun: 0.3,
      onHit: (e, p) => { this._launch(e); this._hitFeedback(this._isHead(e, p), p.pos, true); },
    });
    this._fired(0.3, 0.08);
  }

  _launch(e) {
    const h = this.h, fx = h.game.fx;
    if (e.isBoss) { e.web?.(2); return; }
    e.launch?.({}); e.vel.set(0, 18, 0); e.onGround = false;
    fx.ring(e.pos, 2.4, 0xffffff, 0.4); fx.burst(e.pos, 0xffffff, 16, 6, 0.4, 0.2);
    h._play('heavyhit', { pos: e.pos });
    let hang = 0, stage = 0;
    h._task((dt) => {
      if (!e.alive) return true;
      if (stage === 0) {
        if (e.vel.y <= 1.5) {              // reached the apex: web them up there
          stage = 1; e.web?.(3.2);
          fx.beam(h._hand(_a), e.center, 0xffffff, 0.1, 0.25); fx.burst(e.center, 0xffffff, 22, 6, 0.5, 0.22);
          fx.text(_b.set(e.pos.x, e.pos.y + e.height + 0.6, e.pos.z), 'UPSHOT', 0xffffff, { size: 1.1, life: 0.9 });
          h._play('thwip', { pos: e.pos });
        }
      } else if (stage === 1) {
        hang += dt; e.vel.set(0, 0, 0); e.webTimer = Math.max(e.webTimer, 0.3); e.launched = true;
        if (hang > 0.85) { stage = 2; hang = 0; }
      } else if (stage === 2) {
        e.webTimer = 0.01;
        hang += dt;
        if (e.onGround || hang > 2) {
          this._dmg(e, 10 * h._dmgMul(), { stun: 0.8, kind: 'slam', point: e.center });
          fx.dust?.(e.pos, 6, 2);
          return true;
        }
      }
      return false;
    });
  }
}
