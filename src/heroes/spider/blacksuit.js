// Spider-Man's BLACK SUIT (Marvel's Spider-Man 2 Peter-symbiote, comics Secret Wars) as a complete alternate moveset.
// Peter in the suit stays agile and aggressive (he still swings, zips and crawls); it is NOT the hulking Venom hero.
//
// CONTROL MAP (black suit on; keyboard / pad)
//   swing  Shift / R2        thick glossy black web-lines, swingMax 60 m/s, stronger pump; jump off a swing = SURGE LAUNCH
//   jump   Space / X         (hold in the air = black membrane Web Wings, dive 52 m/s)    wall crawl leaves a goo trail
//   attack J, LMB / []       tendril combo: Jab (2 hits) > Lash (3 sweeping hits) > SYMBIOTE SLAM (pins enemies to the ground)
//                            hold = charged Symbiote Punch
//   special tap K, R1, RMB-tap   TENDRIL LASH (quick-fire whip, pulls the target in)
//   special hold K / R1 (>0.35 s) SYMBIOTE GRAB: pull an enemy in, keep holding, AIM with the camera, release to THROW
//   ability E / L1 (enemies near, on foot / in the air):
//        tap            SYMBIOTE STRIKE   (impale + launch + slam, cd 4.5 s)
//        E + attack     TENDRIL TEAR      (within 0.3 s: pull the group in, then explode, cd 9 s)
//        E + jump       RAMPAGE           (ground eruption: AoE knock-up + juggle, cd 7 s)
//        no enemies within 30 m, or swinging / wall / gliding: E = Tendril Zip (unchanged traversal)
//   aim    RMB / L2 hold     SYMBIOTE ABILITIES instead of web gadgets; fire LMB / R2; E / L1 / wheel / D-pad cycle:
//        1 Symbiote Spikes (tap = 3-spike volley, hold ~0.9 s = piercing Heavy Spike)  2 Goo Bomb  3 Tendril Snare
//   dodge  C / O             SYMBIOTE PHASE: leaves a tendril decoy that enemies attack (explodes); perfect dodge = auto-counter
//   ultimate Q / R3          SYMBIOTE SURGE: huge tendril eruption + slow-mo + follow-up waves, ends in RAGE
//   ability2 tap R / L2      back to the classic suit (0.6 s goo transformation, i-frames)
//   passive SYMBIOTE RAGE    hits fill the meter; at 100 you RAGE (x1.35 damage, +10% speed, black-red aura, drains ~14 s);
//                            while raging and not hitting anything the suit eats ~1.2 HP/s (never below 1).
import * as THREE from 'three';
import * as P from './powers.js';

const BLACK = 0x07070c, PURPLE = 0x7a3cff, RAGE = 0xff1a30, GOO = 0x2a0a55;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const rnd = (a, b) => a + Math.random() * (b - a);
const _o = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3(), _i = new THREE.Vector3();

export const BS = {
  swingMax: 60, swingPump: 11.5, launchUp: 24, wallSpeed: 11, glideSpeed: 25, diveSpeed: 52, diveFall: -32,
  reach: 4.0, lungeRange: 10,
  rageHit: 3.2, rageDrain: 100 / 14, rageIdle: 2.5, rageIdleDecay: 3, rageMul: 1.35, rageSpeed: 1.1, rageHp: 1.2,
  strikeCd: 4.5, tearCd: 9, rampageCd: 7, whipCd: 0.5, grabCd: 5.5, decoyCd: 2.5, chord: 0.3,
  transform: 0.6,
};

const ULT_T = { windup: 0.55, end: 3.5, finale: 3.0 };
// aim abilities
export const AIM_ABILITIES = [
  { id: 'spikes', name: 'Symbiote Spikes', max: 6, rech: 0.9 },
  { id: 'goo', name: 'Goo Bomb', max: 3, rech: 6 },
  { id: 'snare', name: 'Tendril Snare', max: 3, rech: 7 },
];

// ------------------------------------------------------------------------------------------------ goo splats
let GOO_TEX = null;
function gooTexture() {
  if (GOO_TEX) return GOO_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  const grd = x.createRadialGradient(0, 0, 4, 0, 0, 60);
  grd.addColorStop(0, 'rgba(10,4,18,1)'); grd.addColorStop(0.7, 'rgba(6,2,12,0.97)'); grd.addColorStop(1, 'rgba(6,2,12,0)');
  x.fillStyle = grd; x.beginPath(); x.arc(0, 0, 44, 0, Math.PI * 2); x.fill();
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  x.fillStyle = 'rgba(6,2,12,0.96)';
  for (let i = 0; i < 16; i++) { // ragged splash lobes + drips
    const a = r() * Math.PI * 2, d = 30 + r() * 24, rr = 5 + r() * 9;
    x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2); x.fill();
    x.lineWidth = 3 + r() * 3; x.strokeStyle = 'rgba(6,2,12,0.95)'; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * d, Math.sin(a) * d); x.stroke();
  }
  x.strokeStyle = 'rgba(150,90,255,0.38)'; x.lineWidth = 2; x.beginPath(); x.arc(-6, -6, 22, 3.6, 5.2); x.stroke();
  GOO_TEX = new THREE.CanvasTexture(c);
  return GOO_TEX;
}

class GooPool {
  constructor(scene, n = 28) {
    this.geo = new THREE.CircleGeometry(1, 20);
    this.mat = new THREE.MeshBasicMaterial({
      map: gooTexture(), transparent: true, opacity: 0.96, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, this.mat); m.visible = false; m.frustumCulled = false; m.renderOrder = 4;
      scene.add(m); this.items.push({ mesh: m, t: 0, life: 0, size: 1 });
    }
    this.cursor = 0;
  }
  drop(point, normal, size = 1.2, life = 4) {
    let it = null;
    for (let k = 0; k < this.items.length; k++) { const c = this.items[(this.cursor + k) % this.items.length]; if (!c.mesh.visible) { it = c; this.cursor = (this.cursor + k + 1) % this.items.length; break; } }
    if (!it) { it = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length; }
    it.t = 0; it.life = life; it.size = size;
    const m = it.mesh;
    m.position.copy(point).addScaledVector(normal, 0.05);
    m.lookAt(_o.copy(point).add(normal)); m.rotateZ(Math.random() * 6.28);
    m.scale.setScalar(size * 0.3); m.visible = true;
    return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const grow = Math.min(1, it.t / 0.18), left = it.life - it.t;
      it.mesh.scale.setScalar(it.size * (0.3 + 0.7 * (1 - Math.pow(1 - grow, 3))) * Math.min(1, Math.max(0, left / 0.8)));
      if (left <= 0) it.mesh.visible = false;
    }
  }
  clear() { for (const it of this.items) it.mesh.visible = false; }
}

// ------------------------------------------------------------------------------------------------ spikes
class SpikePool {
  constructor(scene, n = 18) {
    this.geo = new THREE.ConeGeometry(0.07, 1.25, 6); this.geo.rotateX(Math.PI / 2); this.geo.translate(0, 0, 0.3);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x040408, roughness: 0.15, metalness: 0.5, emissive: 0x4a1a99, emissiveIntensity: 0.8 });
    this.items = [];
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(this.geo, this.mat); m.visible = false; m.frustumCulled = false; scene.add(m); this.items.push(m); }
    this.cursor = 0;
  }
  get(scale = 1) {
    let m = null;
    for (let k = 0; k < this.items.length; k++) { const c = this.items[(this.cursor + k) % this.items.length]; if (!c.visible) { m = c; this.cursor = (this.cursor + k + 1) % this.items.length; break; } }
    if (!m) { m = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length; }
    m.visible = true; m.scale.set(scale, scale, scale * 1.3);
    return m;
  }
  clear() { for (const m of this.items) m.visible = false; }
}

// ------------------------------------------------------------------------------------------------ decoy
class Decoy {
  constructor(scene) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.2, metalness: 0.4, emissive: GOO, emissiveIntensity: 0.9, transparent: true, opacity: 0.88 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.85, 4, 10), mat); body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat); head.position.y = 1.7;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), eyeMat); e.scale.set(1.5, 0.8, 0.6); e.position.set(sx * 0.1, 1.74, 0.17); this.group.add(e); }
    this.group.add(body, head);
    this.spikes = [];
    const sg = new THREE.ConeGeometry(0.07, 0.8, 5);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(sg, mat); const a = i / 6 * Math.PI * 2; s.position.set(Math.cos(a) * 0.38, 0.9 + (i % 2) * 0.35, Math.sin(a) * 0.38); s.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2); this.group.add(s); this.spikes.push(s); }
    this.group.visible = false; scene.add(this.group);
    this.t = 0; this.life = 0; this.hp = 0; this.active = false;
  }
}

// ------------------------------------------------------------------------------------------------ black membrane wings
function wingGeometry() {
  // right wing in local space: +x outward, -z trailing; scalloped bat-wing outline fanned from the shoulder
  const ring = [
    [0.1, 0.02, 0.0], [0.7, 0.1, -0.1], [1.3, 0.12, -0.28], [2.0, 0.08, -0.55], // leading edge to the tip
    [1.62, 0.0, -0.95], [1.3, -0.06, -1.55], [0.98, -0.1, -1.1], [0.66, -0.12, -1.75], [0.34, -0.12, -1.2], [0.08, -0.1, -1.3],
  ];
  const pos = [0.35, 0, -0.55]; // hub
  for (const p of ring) pos.push(...p);
  const idx = [];
  for (let i = 0; i < ring.length - 1; i++) idx.push(0, i + 1, i + 2);
  idx.push(0, ring.length, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
class Wings {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.position.set(0, 1.36, -0.08); this.group.visible = false;
    const geo = wingGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: 0x050509, roughness: 0.3, metalness: 0.3, emissive: 0x240a52, emissiveIntensity: 0.7, side: THREE.DoubleSide });
    const bone = new THREE.LineBasicMaterial({ color: 0x8a52ff });
    this.wings = [];
    for (const sd of [1, -1]) {
      const w = new THREE.Group(); w.scale.x = sd; w.position.x = sd * 0.16;
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; w.add(m);
      for (const tip of [[2.0, 0.08, -0.55], [1.3, -0.06, -1.55], [0.66, -0.12, -1.75]]) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.1, 0.02, 0), new THREE.Vector3(...tip)]), bone); l.frustumCulled = false; w.add(l);
      }
      this.group.add(w); this.wings.push({ w, sd });
    }
    parent.add(this.group);
    this.k = 0; this.t = 0;
  }
  update(dt, on, dive) {
    this.k += ((on ? 1 : 0) - this.k) * (1 - Math.exp(-(on ? 14 : 9) * dt));
    this.t += dt;
    if (this.k < 0.02) { this.group.visible = false; return; }
    this.group.visible = true;
    const spread = this.k * (dive ? 0.62 : 1), flap = Math.sin(this.t * (dive ? 22 : 7)) * (dive ? 0.04 : 0.1);
    for (const { w, sd } of this.wings) {
      w.scale.set(sd * spread, 1, 0.55 + 0.45 * this.k);
      w.rotation.z = sd * (flap + (dive ? -0.18 : 0.05)); w.rotation.y = sd * (dive ? -0.5 : 0);
    }
  }
  hide() { this.k = 0; this.group.visible = false; }
}

// ================================================================================================ the moveset
export class BlackSuit {
  constructor(h) {
    this.h = h;
    const scene = h.game.scene;
    this.goo = new GooPool(scene);
    this.spikes = new SpikePool(scene);
    this.decal = new Decoy(scene);
    this.wings = new Wings(h.model.group);
    this.reset();
  }

  reset() {
    this.rage = 0; this.raging = false; this.rageIdle = 0; this.rageFxT = 0; this.rageTendrilT = 0; this.rageText = 0;
    this.chord = null; this.sel = 0; this.charges = AIM_ABILITIES.map((a) => a.max); this.rateT = 0;
    this.chargeT = 0; this.fprev = false; this.chargeFull = false; this.chargeFxT = 0;
    this.suitFx = null; this.tintKey = ''; this.trailT = 0; this.whipSide = 0; this.dive = false;
    this.foesT = 0; this.foes = false;
    this.decal.active = false; this.decal.group.visible = false;
    this.goo.clear(); this.spikes.clear(); this.wings.hide();
    this.h?.model?.setTint?.(0x000000, 0);
  }

  get aimDef() { return AIM_ABILITIES[this.sel]; }

  // ------------------------------------------------------------------------------- transformation
  /** Goo spreads over the suit for 0.6 s (i-frames); the variant swaps at the midpoint. */
  transform(toSym) {
    const h = this.h;
    this.suitFx = { t: 0, to: toSym, applied: false };
    h.invuln = Math.max(h.invuln, BS.transform);
    if (!toSym) { this.rage = 0; this.raging = false; this.chord = null; this._resetAimCharge(); }
    const base = h.pos;
    // goo climbs the body in a spiral: tendrils from the feet to the head
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, hh = 0.2 + i / n * 1.7;
      h.tendrils.spawn({
        from: (o) => o.set(h.pos.x + Math.cos(a) * 0.9, h.pos.y + 0.05, h.pos.z + Math.sin(a) * 0.9),
        to: (o) => o.set(h.pos.x + Math.cos(a + 1.4) * 0.25, h.pos.y + hh, h.pos.z + Math.sin(a + 1.4) * 0.25),
        life: BS.transform, grow: 0.28, width: 0.1, wiggle: 0.5, arc: 0.12, delay: i * 0.02,
      });
    }
    this.goo.drop(_o.set(base.x, h.game.physics.heightAt(base.x, base.z, base.y + 0.6) + 0.02, base.z), UP, 3.2, 1.6);
    h._fx('shockwave', _g.set(base.x, base.y + 0.1, base.z), 4, toSym ? BLACK : 0xe0202a);
  }

  // ------------------------------------------------------------------------------- rage
  addRageHit() {
    this.rageIdle = 0;
    if (this.raging) { this.rage = Math.min(100, this.rage + 2); return; }
    this.rage = Math.min(100, this.rage + BS.rageHit);
    if (this.rage >= 100) this.startRage();
  }
  startRage() {
    const h = this.h;
    this.raging = true; this.rage = 100;
    h._fx('text', _o.set(h.pos.x, h.pos.y + 2.7, h.pos.z), 'SYMBIOTE RAGE', 0xff3050, { size: 1.5, life: 1.1 });
    h._fx('ring', _g.set(h.pos.x, h.pos.y + 0.2, h.pos.z), 5, RAGE, 0.5);
    h._fx('burst', h._center(_h), RAGE, 40, 9, 0.6, 0.3);
    h._fx('flash', h._center(_h), RAGE, 5, 0.25);
    h.game.cam.shake(0.45); h._rumble(0.8, 0.8, 220); h._play('venom', { volume: 0.7 }); h._play('symbiote');
    h.game.hud?.toast?.('SYMBIOTE RAGE');
  }
  endRage() {
    this.raging = false; this.rage = 0;
    this.h._fx('burst', this.h._center(_h), BLACK, 20, 6, 0.5, 0.25);
  }

  // ------------------------------------------------------------------------------- per-frame (abilities phase)
  update(dt) {
    const h = this.h;
    this.rateT = Math.max(0, this.rateT - dt);
    // aim ability recharge
    for (let i = 0; i < AIM_ABILITIES.length; i++) {
      const a = AIM_ABILITIES[i];
      if (this.charges[i] < a.max) this.charges[i] = Math.min(a.max, this.charges[i] + dt / a.rech);
    }
    this.goo.update(dt);
    this._updateDecoy(dt);

    // transformation timeline
    const S = this.suitFx;
    if (S) {
      S.t += dt;
      h.invuln = Math.max(h.invuln, 0.05);
      if (!S.applied && S.t >= BS.transform * 0.5) { S.applied = true; h.model.setVariant?.(S.to ? 'symbiote' : 'classic'); }
      const k = Math.sin(clamp(S.t / BS.transform, 0, 1) * Math.PI);
      this._tint(S.to ? 0x120426 : 0xe0202a, Math.round(k * 0.85 * 12) / 12);
      if (S.t >= BS.transform) { this.suitFx = null; this._tint(0x000000, 0); }
    } else if (this.raging) {
      this._tint(RAGE, Math.round((0.34 + 0.12 * Math.sin(h.game.time * 9)) * 16) / 16);
    } else if (this.tintKey) this._tint(0x000000, 0);

    if (!h.symbiote) return;
    // wall crawl: goo trail
    if (h.state === 'wall') {
      this.trailT -= dt;
      if (this.trailT <= 0 && Math.hypot(h.vel.x, h.vel.y, h.vel.z) > 1.5) {
        this.trailT = 0.1;
        const n = h.wallN;
        _g.set(h.pos.x - n.x * (h.radius + 0.02), h.pos.y + 0.7 + rnd(-0.2, 0.3), h.pos.z - n.z * (h.radius + 0.02));
        this.goo.drop(_g, n, rnd(0.45, 0.8), 5);
      }
    }
    // rage meter
    this.rageIdle += dt;
    if (this.raging) {
      this.rage -= BS.rageDrain * dt;
      if (this.rage <= 0) this.endRage();
      else {
        if (this.rageIdle > 1.5 && h.hp > 1) { h.hp = Math.max(1, h.hp - BS.rageHp * dt); } // the suit feeds on you unless you keep hitting
        this.rageFxT -= dt;
        if (this.rageFxT <= 0) {
          this.rageFxT = 0.08;
          _g.set(h.pos.x + rnd(-0.4, 0.4), h.pos.y + rnd(0.2, 1.8), h.pos.z + rnd(-0.4, 0.4));
          h._fx('burst', _g, Math.random() < 0.5 ? RAGE : BLACK, 2, 2.5, 0.4, 0.14);
        }
        this.rageTendrilT -= dt;
        if (this.rageTendrilT <= 0) {
          this.rageTendrilT = 0.45;
          const a = Math.random() * 6.28;
          h.tendrils.spawn({ from: (o) => h._center(o), to: h._center(_h).add(_i.set(Math.cos(a) * 1.8, rnd(-0.3, 0.9), Math.sin(a) * 1.8)).clone(), life: 0.35, grow: 0.1, width: 0.07, wiggle: 0.9, arc: 0.08 });
        }
      }
    } else if (this.rage > 0 && this.rageIdle > BS.rageIdle) this.rage = Math.max(0, this.rage - BS.rageIdleDecay * dt);
  }

  _tint(color, amount) {
    const key = color + ':' + amount;
    if (key === this.tintKey) return;
    this.tintKey = amount > 0 ? key : '';
    this.h.model.setTint?.(color, amount);
  }

  /** Called from updateVisuals (after physics). */
  visuals(dt, state) {
    const h = this.h;
    this.wings.update(dt, h.symbiote && state === 'glide' && !h.dead, this.dive);
  }

  // ------------------------------------------------------------------------------- decoy (Symbiote Phase)
  phase() {
    const h = this.h, D = this.decal;
    if (!h.useCooldown('bsDecoy', BS.decoyCd)) return;
    D.active = true; D.t = 0; D.life = 2.6; D.hp = 4; D.group.visible = true; D.group.scale.setScalar(0.1);
    D.group.position.set(h.pos.x, h.pos.y, h.pos.z); D.group.rotation.y = h.yaw;
    h._fx('burst', h._center(_h), BLACK, 22, 6, 0.4, 0.22);
    h._fx('ring', _g.set(h.pos.x, h.pos.y + 0.1, h.pos.z), 2.4, PURPLE, 0.3);
    h._play('symbiote', { volume: 0.45, pitch: 1.4 });
  }
  _updateDecoy(dt) {
    const D = this.decal, h = this.h;
    if (!D.active) return;
    D.t += dt;
    const g = D.group;
    g.scale.setScalar(Math.min(1, D.t / 0.12));
    g.position.y = h.game.physics.heightAt(g.position.x, g.position.z, g.position.y + 0.6);
    for (let i = 0; i < D.spikes.length; i++) D.spikes[i].scale.y = 1 + 0.35 * Math.sin(D.t * 12 + i);
    const px = g.position.x, pz = g.position.z;
    const list = h.game.enemies?.list;
    if (list) for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.isBoss || e.webbed) continue;
      const dx = px - e.pos.x, dz = pz - e.pos.z, d = Math.hypot(dx, dz);
      if (d > 16 || d < 1e-3) continue;
      // distracted: they stop going after you and swarm the decoy
      if (e.stunTimer < 0.15) e.stunTimer = 0.15;
      e.faceYawTo?.(Math.atan2(dx, dz), dt, 10);
      if (d > 1.7) { e.vel.x = dx / d * 5.5; e.vel.z = dz / d * 5.5; }
      else if ((e._decoyHit ?? 0) <= h.game.time) {
        e._decoyHit = h.game.time + 0.8; D.hp--;
        e.stunTimer = Math.max(e.stunTimer, 0.5);
        h._fx('hitSpark', _g.set(px, g.position.y + 1.2, pz), 0xb070ff, false);
        h._fx('burst', _g, BLACK, 8, 4, 0.3, 0.16); h._play('hit', { pos: g.position, volume: 0.5 });
      }
    }
    if (D.t >= D.life || D.hp <= 0) this._popDecoy();
  }
  _popDecoy() {
    const D = this.decal, h = this.h;
    if (!D.active) return;
    D.active = false; D.group.visible = false;
    _o.copy(D.group.position).setY(D.group.position.y + 1);
    h.game.combat?.aoe?.({ center: _o.clone(), radius: 3.8, damage: 22 * h._dmgMul(), knockback: 14, up: 7, stun: 1.0, source: h, team: 'player' });
    P.symImpact(h, _o, 1.2);
    P.tendrilBurst(h, 8, 4.5, 0.35, _o.clone());
    h._fx('shockwave', _g.copy(_o).setY(_o.y - 0.9), 4, BLACK);
    h.game.cam.shake(0.15);
  }

  /** Perfect dodge in the black suit: a tendril counter-strike on whatever attacked. */
  perfectCounter(fromPos) {
    const h = this.h;
    let best = null, bd = 1e9;
    for (const e of h.game.enemies?.list ?? []) {
      if (!e.alive) continue;
      const d = fromPos ? Math.hypot(e.pos.x - fromPos.x, e.pos.z - fromPos.z) : Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z);
      const dm = Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z);
      if (dm > 18 || d >= bd) continue;
      bd = d; best = e;
    }
    if (!best) return;
    const e = best, mul = h._dmgMul();
    P.tendrilTo(h, e, { life: 0.45, grow: 0.05, width: 0.16 });
    P.tendrilTo(h, e, { life: 0.45, grow: 0.07, width: 0.12, delay: 0.03 });
    h._later(0.1, () => {
      if (!e.alive) return;
      const p = e.center.clone();
      h._hit(e, 40 * mul, { stun: 1.6, kind: 'symbiote', heavy: true, point: p, kb: _g.set(e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z).normalize().multiplyScalar(10).setY(12).clone() });
      P.symImpact(h, p, 1.3); h._impact(0.9, true);
      h._fx('text', _o.set(e.pos.x, e.pos.y + e.height + 1, e.pos.z), 'PHASE COUNTER', 0xc8a0ff, { size: 1.3, life: 0.9 });
      h.game.hud?.hitMarker?.(true);
    });
  }

  // ------------------------------------------------------------------------------- melee combo
  _melee(origin, fwd, range, arc, dmg, kb, up, stun, heavy = false) {
    return this.h.game.combat?.melee?.({ origin, forward: fwd, range, arc, damage: dmg * this.h._dmgMul(), knockback: kb, up, stun, heavy, source: this.h, team: 'player' }) || [];
  }
  _tendrilStrike(yaw, range, arc, dmg, kb, up, stun, size, side, heavy = false) {
    const h = this.h;
    const o = h._center(_o);
    const fwd = _f.set(Math.sin(yaw), 0, Math.cos(yaw));
    const hits = this._melee(o, fwd, range, arc, dmg, kb, up, stun, heavy);
    const end = hits.length ? (hits[0].center ?? hits[0].pos).clone() : o.clone().addScaledVector(fwd, range * 0.95);
    h.tendrils.spawn({ from: (out) => { h._center(out); out.y += 0.1; out.x += Math.cos(h.yaw) * 0.35 * side; out.z -= Math.sin(h.yaw) * 0.35 * side; return out; }, to: end, life: 0.26, grow: 0.05, width: 0.13, wiggle: 0.35, arc: 0.03 });
    for (const t of hits) P.symImpact(h, t.center ?? t.pos, size);
    if (hits.length) { h._impact(heavy ? 0.7 : 0.3, true); h.game.hud?.hitMarker?.(false); h._play('hit', { volume: 0.7 }); }
    return hits;
  }
  /** Black-suit combo hit (called at the impact frame of each step). */
  melee(a) {
    const h = this.h, st = a.step, air = a.air, yaw = h.yaw;
    const k = air ? 0.85 : 1;
    h._play('symbiote', { volume: 0.25, pitch: 1.5 });
    if (st === 0) { // Tendril Jab: two quick tendril punches
      this._tendrilStrike(yaw, BS.reach, 85, 11 * k, 3.5, 1.0, 0.25, 0.6, -1);
      h._later(0.09, () => this._tendrilStrike(h.yaw, BS.reach, 85, 11 * k, 3.5, 1.0, 0.25, 0.6, 1));
    } else if (st === 1) { // Tendril Lash: three sweeping hits
      this._tendrilStrike(yaw - 0.55, BS.reach + 0.2, 100, 9 * k, 3, 1.0, 0.25, 0.55, -1);
      h._later(0.07, () => this._tendrilStrike(h.yaw, BS.reach + 0.2, 100, 9 * k, 3, 1.0, 0.25, 0.55, 1));
      h._later(0.14, () => this._tendrilStrike(h.yaw + 0.55, BS.reach + 0.2, 100, 10 * k, 5, 1.5, 0.4, 0.65, -1));
    } else { // Symbiote Slam: two tendril fists hammer down; goo pins whatever they hit to the ground
      const hits = this._tendrilStrike(yaw, BS.reach + 0.4, 140, 26 * k, 8, 2, 1.2, 1.1, 1, true);
      const o = h._center(_o), fwd = _f.set(Math.sin(yaw), 0, Math.cos(yaw));
      _g.copy(h.pos).addScaledVector(fwd, 2.4);
      _g.y = h.game.physics.heightAt(_g.x, _g.z, _g.y + 1);
      this.goo.drop(_g, UP, 2.6, 3.5);
      h._fx('shockwave', _i.copy(_g).setY(_g.y + 0.1), 3.6, BLACK);
      if (!air) {
        for (const e of hits) this.pin(e);
        h._later(0.12, () => { for (const e of h.game.enemies?.inRadius?.(_g, 2.4) ?? []) this.pin(e); });
      }
      h.game.cam.shake(0.25);
    }
  }

  /** Pin an enemy to the ground with goo (no cocoon: it is held down by black tendrils). */
  pin(e, time = 1.7) {
    const h = this.h;
    if (!e || !e.alive) return;
    if (e.isBoss) { e.stunTimer = Math.max(e.stunTimer, 0.7); return; }
    e.launched = false; e.downTimer = Math.max(e.downTimer, time); e.stunTimer = Math.max(e.stunTimer, time + 0.2);
    e.vel.x = 0; e.vel.z = 0; e.vel.y = Math.min(e.vel.y, -10);
    e.interrupt?.();
    _g.set(e.pos.x, h.game.physics.heightAt(e.pos.x, e.pos.z, e.pos.y + 0.6), e.pos.z);
    this.goo.drop(_g, UP, 1.7, time + 1.4);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + rnd(0, 1), gx = _g.x, gy = _g.y, gz = _g.z, ex = e;
      h.tendrils.spawn({ from: new THREE.Vector3(gx + Math.cos(a) * 0.9, gy + 0.02, gz + Math.sin(a) * 0.9), to: (out) => out.set(ex.pos.x, ex.pos.y + 0.25, ex.pos.z), life: time, grow: 0.15, width: 0.1, wiggle: 0.35, arc: 0.1 });
    }
    h._fx('text', _o.set(e.pos.x, e.pos.y + e.height + 0.8, e.pos.z), 'PINNED', 0xc8a0ff, { size: 0.9, life: 0.8 });
  }

  /** Landing slam in the black suit: goo pins nearby enemies to the street. */
  slamPin(center, r) {
    const h = this.h;
    for (const e of h.game.enemies?.inRadius?.(center, r) ?? []) this.pin(e, 1.4);
    this.goo.drop(_g.set(center.x, h.game.physics.heightAt(center.x, center.z, center.y + 0.6), center.z), UP, r * 0.8, 3.5);
  }

  // ------------------------------------------------------------------------------- special: whip + grab
  whip() {
    const h = this.h;
    if (!h.useCooldown('special', BS.whipCd)) return false;
    let tgt = h.aiming ? h.aimEnemy : null;
    tgt = tgt || h._aimTarget(14, 80) || h._aimTargetNear(8);
    const side = (this.whipSide ^= 1) ? 1 : -1, mul = h._dmgMul();
    h.setAnim('shoot', 1); h.anim.t = 0; h.shootT = 0.24;
    h._play('whoosh', { pitch: 1.5 }); h._play('symbiote', { volume: 0.35, pitch: 1.3 }); h._rumble(0.25, 0.3, 70);
    if (tgt) {
      const dx = tgt.pos.x - h.pos.x, dz = tgt.pos.z - h.pos.z, d = Math.hypot(dx, dz) || 1;
      if (!h.aiming) h.yaw = Math.atan2(dx, dz);
      P.tendrilTo(h, tgt, { life: 0.34, grow: 0.045, width: 0.12, wiggle: 0.4, arc: 0.04, side });
      const kb = new THREE.Vector3(-dx / d, 0, -dz / d).multiplyScalar(clamp(d * 2.4, 4, 15)).setY(3);
      h._later(0.05, () => {
        if (!tgt.alive) return;
        const p = tgt.center.clone();
        h._hit(tgt, 17 * mul, { stun: 0.6, kind: 'symbiote', point: p, kb });
        P.symImpact(h, p, 0.7); h._impact(0.3, true); h.game.hud?.hitMarker?.(false);
        h._fx('text', _o.set(tgt.pos.x, tgt.pos.y + tgt.height + 0.5, tgt.pos.z), 'LASH', 0xc8a0ff, { size: 0.8, life: 0.5 });
      });
    } else {
      const o = h._center(_h), fwd = _f.set(Math.sin(h.yaw), 0, Math.cos(h.yaw));
      const to = o.clone().addScaledVector(fwd, 6);
      h.tendrils.spawn({ from: (out) => h._hand(out), to, life: 0.3, grow: 0.045, width: 0.12, wiggle: 0.6, arc: 0.03 });
      const hits = this._melee(o, fwd, 6, 60, 14, 6, 2, 0.5);
      for (const t of hits) P.symImpact(h, t.center ?? t.pos, 0.7);
      h._fx('ring', _g.copy(to), 1.4, PURPLE, 0.2);
    }
    return true;
  }

  /** Hold special: pull an enemy in, hold it up, aim with the camera, release to throw. */
  grab() {
    const h = this.h, g = h.game;
    if ((h.cooldowns.bsGrab || 0) > 0) return false;
    let tgt = h.aiming ? h.aimEnemy : null;
    tgt = tgt || h._aimTarget(24, 70) || h._aimTargetNear(10);
    if (!tgt) return false;
    h.useCooldown('bsGrab', BS.grabCd);
    const e = tgt, mul = h._dmgMul();
    h.lash = { kind: 'grab', t: 0, dir: h.forward, dur: 99, pulse: 99 };
    h.setAnim('throw', 1); h._play('symbiote'); h._rumble(0.4, 0.4, 100);
    const tnd = P.tendrilTo(h, e, { life: 99, grow: 0.08, width: 0.15, wiggle: 0.5, arc: 0.05, side: 1 });
    if (e.isBoss) { // too big: just yank + damage
      h._hit(e, 18 * mul, { stun: 1.0, kind: 'symbiote', point: e.center.clone() });
      e.slowTimer = Math.max(e.slowTimer, 1.5);
      h._later(0.5, () => { if (tnd) tnd.active = false; if (h.lash?.kind === 'grab') h.lash = null; });
      return true;
    }
    let phase = 'pull', t = 0, fxT = 0;
    const vel = new THREE.Vector3(), hold = new THREE.Vector3();
    const holdPoint = () => hold.set(h.pos.x + Math.sin(h.yaw) * 1.5, h.pos.y + 1.9, h.pos.z + Math.cos(h.yaw) * 1.5);
    const hitSet = new Set([e]);
    const finish = (silent) => { if (tnd) { tnd.active = false; tnd.mesh.visible = false; } if (h.lash?.kind === 'grab') h.lash = null; e.launched = false; };
    h._task((dt) => {
      if (!e.alive) { finish(); return true; }
      if (phase !== 'fly' && (h.lash?.kind !== 'grab' || h.dead)) { e.launched = false; finish(); return true; } // interrupted (hurt / dodged)
      t += dt;
      if (phase === 'pull') {
        holdPoint();
        _g.copy(hold).sub(e.center); const d = _g.length();
        e.stunTimer = Math.max(e.stunTimer, 0.3); e.launched = true; e.webTimer = 0;
        e.vel.copy(_g.multiplyScalar(1 / Math.max(d, 0.01))).multiplyScalar(Math.min(55, d / 0.06));
        if (d < 0.9 || t > 0.5) { phase = 'held'; t = 0; h._play('hit'); g.cam.shake(0.1); }
      } else if (phase === 'held') {
        holdPoint();
        e.pos.set(hold.x, hold.y - e.height * 0.55, hold.z); e.vel.set(0, 0, 0); e.launched = true; e.stunTimer = Math.max(e.stunTimer, 0.3);
        g.cam.requestAim(h.aimPreset);                   // over-the-shoulder view so you can aim the throw
        h.faceTowards(g.cam.forward, dt, 18);
        h.setAnim('throw', 1);
        fxT -= dt;
        if (fxT <= 0) { // aim line: where the throw will go
          fxT = 0.05;
          g.cam.aimDirection(_i); _h.copy(e.center);
          g.fx.beam(_h, _g.copy(_h).addScaledVector(_i, 9), PURPLE, 0.05, 0.09);
        }
        if (Math.random() < dt * 12) g.fx.burst(e.center, BLACK, 2, 2, 0.3, 0.12);
        if (!g.input.down('special') || t > 3) {
          g.cam.aimDirection(vel); vel.y = Math.max(vel.y, 0.04);
          // gentle aim assist toward an enemy near the line of fire
          let best = null, bs = 0.93;
          for (const o of g.enemies?.list ?? []) {
            if (!o.alive || o === e) continue;
            _g.copy(o.center).sub(e.center); const dd = _g.length(); if (dd > 30 || dd < 1) continue;
            const dot = _g.multiplyScalar(1 / dd).dot(vel); if (dot > bs) { bs = dot; best = o; }
          }
          if (best) vel.lerp(_g.copy(best.center).sub(e.center).normalize(), 0.7);
          vel.normalize().multiplyScalar(38);
          phase = 'fly'; t = 0; e.vel.copy(vel); e.launched = true;
          if (h.lash?.kind === 'grab') h.lash = null;
          if (tnd) { tnd.active = false; tnd.mesh.visible = false; }
          h.setAnim('throw', 1); h._play('whoosh'); h._rumble(0.5, 0.4, 100); g.cam.shake(0.2);
          h._fx('text', _o.set(e.pos.x, e.pos.y + e.height + 0.7, e.pos.z), 'SYMBIOTE THROW', 0xc8a0ff, { size: 1.1, life: 0.8 });
        }
      } else { // fly
        e.vel.x = vel.x; e.vel.z = vel.z; e.vel.y = Math.max(e.vel.y, vel.y * 0.98 - 4 * t); e.launched = true;
        g.fx.trailPuff(e.center.x, e.center.y, e.center.z, PURPLE, 0.5, 0.25, 0.05);
        for (const o of g.enemies?.list ?? []) {
          if (!o.alive || hitSet.has(o)) continue;
          if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < o.radius + e.radius + 0.7 && Math.abs(o.pos.y - e.pos.y) < 2.4) {
            hitSet.add(o);
            h._hit(o, 26 * mul, { stun: 1.2, kind: 'symbiote', heavy: true, point: o.center.clone(), kb: _g.copy(vel).setY(0).normalize().multiplyScalar(14).setY(7).clone() });
            P.symImpact(h, o.center, 0.9); h._impact(0.7, true); g.hud?.hitMarker?.(false);
            vel.multiplyScalar(0.75);
          }
        }
        if (t > 1.0 || (t > 0.12 && e.onGround)) {
          h._hit(e, 18 * mul, { stun: 1.2, kind: 'symbiote', point: e.center.clone() });
          P.symImpact(h, e.center, 1.0);
          this.goo.drop(_g.set(e.pos.x, g.physics.heightAt(e.pos.x, e.pos.z, e.pos.y + 0.6), e.pos.z), UP, 1.8, 3);
          e.launched = false;
          return true;
        }
      }
      return false;
    });
    return true;
  }

  // ------------------------------------------------------------------------------- E abilities (Strike / Tear / Rampage)
  foesNear(r) {
    const list = this.h.game.enemies?.list; if (!list) return false;
    const r2 = r * r, p = this.h.pos;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; if (!e.alive || e.untargetable) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }
  /** E / L1. Returns true if a traversal zip was started (caller returns from the state update). */
  ability(dt, input) {
    const h = this.h;
    if (!this.chord) {
      if (!input.pressed('ability')) return false;
      const busy = h.atk || h.lash || h.spin || h.dodgeT > 0 || h.charging || h.sling;
      if (busy) return false;
      if (h.state !== 'free' || !this.foesNear(30)) return h._tryZip(input);
      this.chord = { t: 0 };
    }
    const C = this.chord; C.t += dt;
    if (input.pressed('attack')) { input.consume('attack'); this.chord = null; this.tear(); return false; }
    if (input.pressed('jump')) { input.consume('jump'); this.chord = null; this.rampage(); return false; }
    if (!input.down('ability') || C.t >= BS.chord) { this.chord = null; this.strike(input); }
    return false;
  }
  strike() {
    const h = this.h;
    let tgt = h.aiming ? h.aimEnemy : null;
    tgt = tgt || h._aimTarget(16, 70) || h._aimTargetNear(10);
    if (!tgt) { h._fx('text', _o.set(h.pos.x, h.pos.y + 2.3, h.pos.z), 'NO TARGET', '#9fb0c8', { size: 0.8, life: 0.6 }); return false; }
    return P.symbioteStrike(h, tgt, 'bsStrike', BS.strikeCd);
  }
  tear() {
    const h = this.h;
    if (!P.tendrilTear(h, 'bsTear', BS.tearCd)) h._fx('text', _o.set(h.pos.x, h.pos.y + 2.3, h.pos.z), (h.cooldowns.bsTear || 0) > 0 ? 'COOLDOWN' : 'NO TARGETS', '#9fb0c8', { size: 0.8, life: 0.6 });
  }
  /** Ground eruption: AoE knock-up, then a juggle hit on everything still airborne. */
  rampage() {
    const h = this.h, g = h.game;
    if (!h.useCooldown('bsRampage', BS.rampageCd)) return false;
    const mul = h._dmgMul();
    if (h.onGround) { h.vel.y = 10; h.onGround = false; h.groundT = 1; h.jumpArmed = false; }
    const c = h.pos.clone();
    h.setAnim('cast', 1.4); h._play('symbiote'); h._play('heavyhit', { volume: 0.6 }); h._rumble(0.8, 0.6, 180);
    const hits = g.combat?.aoe?.({ center: c, radius: 7.5, damage: 24 * mul, knockback: 6, up: 15, stun: 1.6, source: h, team: 'player', falloff: true }) || [];
    g.fx.shockwave(_o.copy(c).setY(c.y + 0.1), 8, BLACK); g.fx.ring(_o.copy(c).setY(c.y + 0.2), 6, PURPLE, 0.45); g.fx.flash(h._center(_h), PURPLE, 5, 0.2);
    g.fx.burst(h._center(_h), BLACK, 40, 9, 0.6, 0.3);
    this.goo.drop(_g.set(c.x, g.physics.heightAt(c.x, c.z, c.y + 0.6), c.z), UP, 5, 3.5);
    for (let i = 0; i < 12; i++) { // spikes erupt from the ground in a ring
      const a = i / 12 * Math.PI * 2 + rnd(0, 0.4), r = rnd(2.5, 6.5);
      const bx = c.x + Math.cos(a) * r, bz = c.z + Math.sin(a) * r, by = g.physics.heightAt(bx, bz, c.y + 1);
      h.tendrils.spawn({ from: new THREE.Vector3(bx, by, bz), to: new THREE.Vector3(bx + Math.cos(a) * 0.8, by + rnd(2.5, 4.5), bz + Math.sin(a) * 0.8), life: 0.55, grow: 0.1, width: 0.2, wiggle: 0.25, arc: 0.0, delay: i * 0.012 });
    }
    h._impact(0.9, true); g.cam.shake(0.5);
    g.fx.text(_o.set(h.pos.x, h.pos.y + 2.8, h.pos.z), 'RAMPAGE', 0xc8a0ff, { size: 1.3, life: 0.9 });
    for (const e of hits) P.symImpact(h, e.center, 0.8);
    h._later(0.42, () => {
      for (const e of hits) {
        if (!e.alive || e.isBoss) continue;
        h._hit(e, 12 * mul, { stun: 0.9, kind: 'symbiote', point: e.center.clone(), kb: new THREE.Vector3(0, 6, 0) });
        P.symImpact(h, e.center, 0.6);
      }
      if (hits.length) h._impact(0.5, true);
    });
    return true;
  }

  // ------------------------------------------------------------------------------- aim: spikes / goo bomb / snare
  cycle(dir) {
    const n = AIM_ABILITIES.length;
    this.sel = (this.sel + dir + n) % n;
    this._resetAimCharge();
    const h = this.h, a = this.aimDef;
    h._play('ui_move');
    h.game.hud?.toast?.(`${a.name.toUpperCase()}  ${Math.floor(this.charges[this.sel])}/${a.max}`);
  }
  aimLabel() { const a = this.aimDef; return `${a.name}  ${Math.floor(this.charges[this.sel])}/${a.max}`; }
  aimFrac() { const c = this.charges[this.sel]; return c >= 1 ? 0 : 1 - c; }
  _resetAimCharge() { this.chargeT = 0; this.fprev = false; this.chargeFull = false; }
  aimCancel() { if (this.chargeT > 0 || this.fprev) this._resetAimCharge(); }

  /** Called every frame while aiming in the black suit. */
  aimUpdate(dt, pressed, held) {
    const h = this.h, a = this.aimDef;
    if (this.sel === 0) { // Symbiote Spikes: tap = volley, hold = piercing shot
      if (held) {
        this.chargeT += dt;
        if (this.chargeT > 0.3) {
          h.game.cam.shake(0.01 + Math.min(1, this.chargeT / 0.9) * 0.03);
          this.chargeFxT -= dt;
          if (this.chargeFxT <= 0) { this.chargeFxT = 0.07; h._fx('burst', h._hand(_h), PURPLE, 2, 2, 0.25, 0.1); }
          if (this.chargeT >= 0.9 && !this.chargeFull) { this.chargeFull = true; h._rumble(0.3, 0.6, 80); h._fx('ring', h._hand(_h), 0.9, PURPLE, 0.25); h._play('ui_move', { pitch: 1.9, volume: 0.5 }); }
        }
      } else if (this.fprev) {
        const ct = this.chargeT, full = ct >= 0.9;
        this.chargeT = 0; this.chargeFull = false;
        if (this.rateT <= 0) {
          if (full && this.charges[0] >= 2) { this.charges[0] -= 2; this.rateT = 0.6; this._heavySpike(); }
          else if (this.charges[0] >= 1) { this.charges[0] -= 1; this.rateT = 0.3; this._volley(); }
          else this._empty();
        }
      }
      this.fprev = held;
      return;
    }
    if (!pressed) return;
    if (this.rateT > 0) return;
    if (this.charges[this.sel] < 1) { this._empty(); return; }
    if (this.sel === 1) { this.charges[1] -= 1; this.rateT = 0.7; this._gooBomb(); }
    else if (this.snare()) { this.charges[2] -= 1; this.rateT = 0.5; }
  }
  _empty() {
    const h = this.h;
    if ((this._emptyT ?? 0) > h.game.time) return;
    this._emptyT = h.game.time + 0.5;
    h._play('ui_back', { volume: 0.5 });
    h._fx('text', h._center(_o).setY(h.pos.y + 2.3), 'RECHARGING', '#9fb0c8', { size: 0.8, life: 0.6 });
  }
  _fireDir(out) {
    const gd = this.h.gadgets, ray = gd.aimRay(120), m = gd._muzzle();
    out.copy(ray.point).sub(m); if (out.lengthSq() < 4) out.copy(ray.dir); out.normalize();
    return { muzzle: m, ray };
  }
  _spike(muzzle, dir, o) {
    const h = this.h, fx = h.game.fx;
    const mesh = this.spikes.get(o.scale);
    const rel = () => { mesh.visible = false; };
    return h.game.combat?.projectile?.({
      pos: muzzle, vel: dir.clone().multiplyScalar(o.speed), kind: 'spike', team: 'player', source: h, mesh, life: 120 / o.speed,
      damage: o.damage * h._dmgMul(), radius: o.radius, knockback: o.kb, up: o.up, stun: o.stun, pierce: !!o.pierce, heavy: !!o.heavy, user: {},
      update: (p) => { fx.trailPuff(p.pos.x, p.pos.y, p.pos.z, PURPLE, o.pierce ? 0.35 : 0.2, 0.18, 0.02); },
      onHit: (e, p) => {
        fx.burst(p.pos, BLACK, o.pierce ? 18 : 8, 5, 0.4, 0.2); fx.flash(p.pos, PURPLE, 2, 0.1);
        const head = p.pos.y > e.pos.y + e.height * 0.8;
        h.game.hud?.hitMarker?.(head); h._rumble(o.pierce ? 0.5 : 0.2, 0.2, 60);
        if (head) fx.text(_o.set(e.pos.x, e.pos.y + e.height + 0.9, e.pos.z), 'PRECISION', 0xc8a0ff, { size: 1, life: 0.7 });
      },
      onExpire: (p) => { rel(); if (!p.user.splat) { p.user.splat = true; fx.burst(p.pos, BLACK, 4, 3, 0.25, 0.14); } },
    });
  }
  _volley() {
    const h = this.h;
    const { muzzle } = this._fireDir(_f);
    const base = _f.clone();
    for (let i = 0; i < 3; i++) {
      const d = base.clone();
      if (i) { _h.crossVectors(base, UP).normalize(); d.addScaledVector(_h, (i === 1 ? 1 : -1) * 0.055).normalize(); }
      this._spike(muzzle, d, { speed: 90, damage: 9, radius: 0.3, kb: 3, up: 0.6, stun: 0.3, scale: 1 });
    }
    h.shootT = 0.2; h.setAnim('shoot', 1); h.anim.t = 0;
    h._play('thwip', { pitch: 0.7 }); h._play('symbiote', { volume: 0.3, pitch: 1.6 }); h._rumble(0.25, 0.2, 60); h.game.cam.shake(0.04);
    h._fx('burst', muzzle, BLACK, 6, 4, 0.25, 0.14);
    if (h.onGround) { h.vel.x *= 0.6; h.vel.z *= 0.6; }
  }
  _heavySpike() {
    const h = this.h;
    const { muzzle } = this._fireDir(_f);
    this._spike(muzzle, _f.clone(), { speed: 130, damage: 48, radius: 0.5, kb: 14, up: 2, stun: 1.2, scale: 2.2, pierce: true, heavy: true });
    h.shootT = 0.3; h.setAnim('shoot', 1); h.anim.t = 0;
    h._play('thwip', { pitch: 0.5 }); h._play('heavyhit', { volume: 0.5 }); h._rumble(0.7, 0.5, 140); h.game.cam.shake(0.18);
    h._fx('ring', muzzle, 1.2, PURPLE, 0.25);
    if (!h.onGround) h.vel.addScaledVector(_f, -3);
  }
  _gooBomb() {
    const h = this.h, g = h.game;
    const { muzzle, ray } = this._fireDir(_f);
    const T = clamp(muzzle.distanceTo(ray.point) / 36, 0.25, 1.5), G = 18;
    const v = _g.copy(ray.point).sub(muzzle).multiplyScalar(1 / T); v.y += 0.5 * G * T;
    const burst = (pos) => this._gooLand(pos);
    g.combat?.projectile?.({
      pos: muzzle, vel: v.clone(), kind: 'symbiote', team: 'player', source: h, gravity: G, life: T + 1.2, damage: 8 * h._dmgMul(), radius: 0.4, size: 0.42, knockback: 3, up: 1, stun: 0.3, user: {},
      onHit: (e, p) => { p.user.done = true; burst(p.pos.clone()); },
      onExpire: (p) => { if (p.user.done) return; p.user.done = true; burst(p.pos.clone()); },
    });
    h.shootT = 0.25; h.setAnim('shoot', 1); h.anim.t = 0;
    h._play('thwip', { pitch: 0.6 }); h._play('symbiote', { volume: 0.5 }); h._rumble(0.3, 0.3, 80);
  }
  /** Goo splashes down, slows everything near it, then detonates in a burst of tendrils. */
  _gooLand(pos) {
    const h = this.h, g = h.game, mul = h._dmgMul();
    pos.y = g.physics.heightAt(pos.x, pos.z, pos.y + 0.6) + 0.05;
    this.goo.drop(pos, UP, 3.6, 1.6);
    g.fx.burst(pos, BLACK, 18, 5, 0.5, 0.3); g.fx.ring(pos, 3.4, PURPLE, 0.35); g.fx.smoke(pos, 0.9, 0.7, null, 0.03);
    h._play('symbiote', { pos, volume: 0.6 });
    let t = 0;
    h._task((dt) => {
      t += dt;
      for (const e of g.enemies?.list ?? []) {
        if (!e.alive || Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) > 3.8) continue;
        e.slowTimer = Math.max(e.slowTimer, 0.3);
      }
      if (Math.random() < dt * 14) g.fx.burst(_g.set(pos.x + rnd(-1.5, 1.5), pos.y + 0.2, pos.z + rnd(-1.5, 1.5)), PURPLE, 2, 2, 0.3, 0.12);
      if (t < 1.1) return false;
      const hits = g.combat?.aoe?.({ center: _o.copy(pos).setY(pos.y + 0.5), radius: 5.2, damage: 36 * mul, knockback: 16, up: 12, stun: 1.4, source: h, team: 'player', falloff: true }) || [];
      g.fx.shockwave(_g.copy(pos).setY(pos.y + 0.1), 5.5, BLACK); g.fx.flash(_g.copy(pos).setY(pos.y + 1), PURPLE, 5, 0.2);
      g.fx.burst(_g, BLACK, 40, 9, 0.6, 0.3);
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + rnd(0, 0.5), r = rnd(1.2, 4.2);
        const bx = pos.x + Math.cos(a) * r, bz = pos.z + Math.sin(a) * r, by = g.physics.heightAt(bx, bz, pos.y + 1);
        h.tendrils.spawn({ from: new THREE.Vector3(bx, by, bz), to: new THREE.Vector3(bx + Math.cos(a) * 0.6, by + rnd(2.5, 5), bz + Math.sin(a) * 0.6), life: 0.5, grow: 0.09, width: 0.18, wiggle: 0.3, arc: 0, delay: i * 0.01 });
      }
      for (const e of hits) P.symImpact(h, e.center, 0.7);
      g.cam.shake(Math.max(0.1, 0.55 - pos.distanceTo(h.pos) * 0.012)); h._rumble(0.6, 0.5, 140); h._play('explosion', { pos, volume: 0.6 });
      if (hits.length >= 2) g.fx.text(_g.copy(pos).setY(pos.y + 2), `x${hits.length} GOO BOMB`, 0xc8a0ff, { size: 1.1, life: 0.9 });
      return true;
    });
  }
  /** Root the aimed enemy (and up to two neighbours) with tendrils for ~3 s. Returns false when nothing to snare. */
  snare() {
    const h = this.h, g = h.game, mul = h._dmgMul();
    let tgt = h.aimEnemy || h._aimTarget(40, 22) || null;
    if (!tgt) { h._fx('text', _o.set(h.pos.x, h.pos.y + 2.3, h.pos.z), 'NO TARGET', '#9fb0c8', { size: 0.8, life: 0.6 }); return false; }
    const victims = [tgt];
    for (const e of g.enemies?.list ?? []) {
      if (victims.length >= 3) break;
      if (e.alive && e !== tgt && !e.isBoss && Math.hypot(e.pos.x - tgt.pos.x, e.pos.z - tgt.pos.z) < 4.5) victims.push(e);
    }
    victims.forEach((e, i) => {
      P.tendrilTo(h, e, { life: 0.4, grow: 0.06, width: 0.13, delay: i * 0.05 });
      h._later(0.08 + i * 0.05, () => {
        if (!e.alive) return;
        h._hit(e, 10 * mul, { stun: 0.6, kind: 'symbiote', point: e.center.clone() });
        if (e.isBoss) { e.slowTimer = Math.max(e.slowTimer, 2.5); return; }
        const dur = i === 0 ? 3.2 : 2.4;
        for (let k = 0; k < 3; k++) {
          const a = k / 3 * 6.28 + rnd(0, 1);
          h.tendrils.spawn({ from: new THREE.Vector3(e.pos.x + Math.cos(a) * 0.8, e.pos.y, e.pos.z + Math.sin(a) * 0.8), to: (o) => o.set(e.pos.x, e.pos.y + 0.4 + k * 0.5, e.pos.z), life: dur, grow: 0.25, width: 0.1, wiggle: 0.4, arc: 0.05 });
        }
        this.goo.drop(_g.set(e.pos.x, g.physics.heightAt(e.pos.x, e.pos.z, e.pos.y + 0.6), e.pos.z), UP, 1.5, dur);
        g.fx.text(_o.set(e.pos.x, e.pos.y + e.height + 0.7, e.pos.z), 'SNARED', 0xc8a0ff, { size: 1.0, life: 0.8 });
        let t = 0;
        h._task((dt) => {
          t += dt;
          if (!e.alive || t > dur) return true;
          e.stunTimer = Math.max(e.stunTimer, 0.25); e.vel.x = 0; e.vel.z = 0; e.windup = 0;
          return false;
        });
      });
    });
    h.shootT = 0.25; h.setAnim('shoot', 1); h.anim.t = 0;
    h._play('symbiote'); h._play('thwip', { pitch: 0.8 }); h._rumble(0.4, 0.3, 100); h.game.cam.shake(0.08);
    return true;
  }

  // ------------------------------------------------------------------------------- traversal extras
  /** Jump off a swing: tendril burst throws you higher. */
  surgeLaunch() {
    const h = this.h, g = h.game;
    h.vel.y = Math.max(h.vel.y, 0) + BS.launchUp;
    h.vel.x *= 1.12; h.vel.z *= 1.12;
    g.combat?.aoe?.({ center: _o.copy(h.pos).setY(h.pos.y + 1), radius: 4.5, damage: 8 * h._dmgMul(), knockback: 8, up: 6, stun: 0.5, source: h, team: 'player' });
    g.fx.burst(h._center(_h), BLACK, 30, 8, 0.5, 0.28); g.fx.ring(_g.set(h.pos.x, h.pos.y + 0.5, h.pos.z), 3.2, PURPLE, 0.3); g.fx.flash(h._center(_h), PURPLE, 3, 0.15);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      h.tendrils.spawn({ from: (o) => h._center(o), to: h._center(new THREE.Vector3()).add(new THREE.Vector3(Math.cos(a) * 2.4, -1.4 - rnd(0, 1.5), Math.sin(a) * 2.4)), life: 0.4, grow: 0.07, width: 0.1, wiggle: 0.8, arc: 0.1 });
    }
    g.fx.text(_o.set(h.pos.x, h.pos.y + 2.4, h.pos.z), 'SURGE LAUNCH', 0xc8a0ff, { size: 0.9, life: 0.6 });
    h._play('jump'); h._play('symbiote', { volume: 0.5 }); h._rumble(0.5, 0.3, 100); g.cam.shake(0.15);
  }

  // ------------------------------------------------------------------------------- ultimate: Symbiote Surge
  ultStart() {
    const h = this.h;
    h.game.slowmo?.(0.8, 0.35);
    h._fx('flash', h._center(_h), PURPLE, 5, 0.3);
    h._fx('ring', _g.set(h.pos.x, h.pos.y + 0.2, h.pos.z), 8, PURPLE, 0.6);
    this.goo.drop(_g.set(h.pos.x, h.game.physics.heightAt(h.pos.x, h.pos.z, h.pos.y + 0.6), h.pos.z), UP, 7, 4.5);
  }
  /** Returns true when finished. */
  ultUpdate(dt, U) {
    const h = this.h, g = h.game, mul = h._dmgMul();
    h.gravityScale = 0.1; h.vel.x *= Math.exp(-8 * dt); h.vel.z *= Math.exp(-8 * dt); h.vel.y *= Math.exp(-6 * dt);
    const T = ULT_T;
    if (!U.ring) { // tendrils gather around the hero
      U.ring = true;
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        h.tendrils.spawn({ from: new THREE.Vector3(h.pos.x + Math.cos(a) * 4, h.pos.y, h.pos.z + Math.sin(a) * 4), to: (o) => h._center(o), life: T.windup, grow: 0.4, width: 0.12, wiggle: 1.2, arc: 0.25 });
      }
    }
    if (!U.burst && U.t >= T.windup) {
      U.burst = true;
      g.slowmo?.(0.9, 0.2);
      const hits = g.combat?.aoe?.({ center: h.pos.clone(), radius: 26, damage: 75 * mul, knockback: 24, up: 20, stun: 2.6, source: h, team: 'player', falloff: true }) || [];
      g.fx.shockwave(_g.set(h.pos.x, h.pos.y + 0.1, h.pos.z), 26, BLACK); g.fx.ring(_g.set(h.pos.x, h.pos.y + 0.3, h.pos.z), 18, PURPLE, 0.8);
      g.fx.flash(h._center(_h), PURPLE, 8, 0.4); g.fx.burst(h._center(_h), BLACK, 100, 16, 0.9, 0.45);
      for (let i = 0; i < 28; i++) { // a forest of tendrils erupts from the street
        const a = i / 28 * Math.PI * 2 + rnd(0, 0.3), r = 3 + (i % 4) * 4.5 + rnd(0, 2);
        const bx = h.pos.x + Math.cos(a) * r, bz = h.pos.z + Math.sin(a) * r, by = g.physics.heightAt(bx, bz, h.pos.y + 2);
        h.tendrils.spawn({ from: new THREE.Vector3(bx, by, bz), to: new THREE.Vector3(bx + Math.cos(a) * 1.5, by + rnd(6, 11), bz + Math.sin(a) * 1.5), life: 1.0, grow: 0.18, width: 0.3, wiggle: 0.45, arc: 0.02, delay: (i % 7) * 0.02 });
      }
      for (const e of hits) P.symImpact(h, e.center, 1);
      g.cam.shake(1.5); h._rumble(1, 1, 500); h._play('venom'); h._play('heavyhit'); h._play('explosion');
      g.hud?.toast?.('SYMBIOTE SURGE');
      g.fx.text(_g.set(h.pos.x, h.pos.y + 3, h.pos.z), 'SYMBIOTE SURGE', 0xc8a0ff, { size: 1.8, life: 1.4 });
    }
    if (U.t >= T.windup + 0.35 && U.t < T.finale) { // impaling waves
      U.acc = (U.acc || 0) + dt;
      while (U.acc >= 0.3) {
        U.acc -= 0.3;
        const list = P.alive(h, 28);
        for (let k = 0; k < 3 && list.length; k++) {
          const e = list.splice(Math.floor(Math.random() * list.length), 1)[0];
          const bx = e.pos.x, bz = e.pos.z, by = e.pos.y;
          h.tendrils.spawn({ from: new THREE.Vector3(bx + rnd(-1, 1), by - 0.2, bz + rnd(-1, 1)), to: new THREE.Vector3(bx, by + e.height + 1.2, bz), life: 0.45, grow: 0.07, width: 0.2, wiggle: 0.4, arc: 0.02 });
          g.combat?.aoe?.({ center: _o.set(bx, by + 0.5, bz), radius: 2.6, damage: 15 * mul, knockback: 8, up: 9, stun: 1.0, source: h, team: 'player', falloff: true });
          P.symImpact(h, e.center, 0.8);
        }
        P.tendrilBurst(h, 3, rnd(8, 14), 0.3);
        g.cam.shake(0.18); h._rumble(0.5, 0.6, 70); if (Math.random() < 0.5) h._play('hit');
      }
      const n = g.enemies?.nearest?.(h.pos, 30);
      if (n) h.yaw += Math.atan2(Math.sin(Math.atan2(n.pos.x - h.pos.x, n.pos.z - h.pos.z) - h.yaw), Math.cos(Math.atan2(n.pos.x - h.pos.x, n.pos.z - h.pos.z) - h.yaw)) * Math.min(1, 10 * dt);
    }
    if (!U.fin && U.t >= T.finale) {
      U.fin = true;
      g.combat?.aoe?.({ center: h.pos.clone(), radius: 28, damage: 60 * mul, knockback: 30, up: 18, stun: 2.4, source: h, team: 'player', falloff: true });
      g.fx.shockwave(_g.set(h.pos.x, h.pos.y + 0.1, h.pos.z), 28, BLACK); g.fx.ring(_g.set(h.pos.x, h.pos.y + 0.3, h.pos.z), 20, 0xffffff, 0.7);
      g.fx.flash(h._center(_h), 0xffffff, 8, 0.3); g.fx.burst(h._center(_h), BLACK, 80, 16, 0.8, 0.4);
      P.tendrilBurst(h, 20, 16, 0.5);
      g.cam.shake(1.5); h._rumble(1, 1, 500); h._play('explosion'); h._play('heavyhit');
      g.slowmo?.(0.5, 0.25);
    }
    if (U.t >= T.end) { // the Surge leaves you in a rage
      if (!this.raging) { this.rage = 100; this.rageIdle = 0; this.startRage(); } else this.rage = 100;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------- HUD
  hints() {
    const h = this.h, f = (n) => h.cooldownFrac(n);
    const grabbing = h.lash?.kind === 'grab';
    const list = [
      { action: 'swing', key: 'swing', label: 'Symbiote Swing', cooldown: 0, active: h.state === 'swing' },
      { action: 'special', key: 'special', label: 'Tendril Lash / Hold: Grab', cooldown: grabbing ? 0 : f('special'), active: grabbing },
    ];
    if (h.aiming) list.push({ action: 'ability', key: 'ability', label: 'Next Power', cooldown: 0 });
    else {
      list.push({ action: 'ability', key: 'ability', label: 'Symbiote Strike', cooldown: f('bsStrike') });
      list.push({ action: 'ability', key: 'ability', label: 'Tendril Tear  + Atk', cooldown: f('bsTear') });
      list.push({ action: 'ability', key: 'ability', label: 'Rampage  + Jump', cooldown: f('bsRampage') });
    }
    list.push(
      { action: 'ability2', key: 'ability2', label: this.raging ? 'Classic Suit  (RAGE)' : 'Classic Suit', cooldown: f('suit'), active: this.raging },
      { action: 'dodge', key: 'dodge', label: 'Symbiote Phase', cooldown: f('dodge') },
      { action: 'aim', key: 'aim', label: this.aimLabel(), cooldown: this.aimFrac(), active: h.aiming },
      { action: 'ultimate', key: 'ultimate', label: 'Symbiote Surge', cooldown: 1 - h.focus / 100, active: h.focus >= 100 },
    );
    return list;
  }
}
