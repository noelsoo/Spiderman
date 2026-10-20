// Hawkeye helpers: enemy status visuals (ice shell / net / EMP arcs), stun helper, focus-aim mark sprites, smoke clouds.
// All meshes are pooled and reused; dispose() releases everything.
import * as THREE from 'three';

const MACHINE = /drone|octobot|ultron|sentry|robot|mech|bot\b|sentinel|turret/i;
/** Is this enemy a machine (EMP target)? */
export const isMachine = (e) => MACHINE.test(e.kind || '') || MACHINE.test(e.name || '');

/** Stun an enemy directly through the timers Enemy.update reads. Bosses get at most 0.8 s. Returns seconds applied. */
export function stunEnemy(e, seconds) {
  if (!e || !e.alive) return 0;
  const s = e.isBoss ? Math.min(seconds, 0.8) : seconds;
  e.stunTimer = Math.max(e.stunTimer ?? 0, s);
  e.interrupt?.();
  return s;
}

// ---------------------------------------------------------------------------------------------
const SHELL = {
  ice: { fill: 0x9fe4ff, wire: 0xffffff, fo: 0.38 },
  net: { fill: 0xffffff, wire: 0xffffff, fo: 0.08 },
  emp: { fill: 0x4cb8ff, wire: 0xc8f2ff, fo: 0.18 },
};

export class StatusFx {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.geo = new THREE.IcosahedronGeometry(1, 1);
    this.mats = {};
    for (const k in SHELL) {
      const c = SHELL[k];
      this.mats[k] = {
        fill: new THREE.MeshBasicMaterial({ color: c.fill, transparent: true, opacity: c.fo, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        wire: new THREE.MeshBasicMaterial({ color: c.wire, wireframe: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
      };
    }
    this.active = new Map();   // enemy -> entry
    this.free = [];
  }
  _make() {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(this.geo, this.mats.ice.fill), wire = new THREE.Mesh(this.geo, this.mats.ice.wire);
    fill.frustumCulled = wire.frustumCulled = false; wire.scale.setScalar(1.02);
    g.add(fill, wire); this.scene.add(g);
    return { g, fill, wire };
  }
  /** Wrap enemy `e` in a status shell for `seconds`. kind: ice | net | emp. dmgMul only applies to non-bosses (ice). */
  apply(e, kind, seconds, dmgMul = 1) {
    if (!e || !e.alive) return;
    let en = this.active.get(e);
    if (!en) {
      const o = this.free.pop() ?? this._make();
      en = { e, o, t: 0, life: 0, kind, prevDmg: null };
      this.active.set(e, en);
      o.g.visible = true;
    }
    en.kind = kind; en.t = 0; en.life = seconds;
    en.o.fill.material = this.mats[kind].fill; en.o.wire.material = this.mats[kind].wire;
    if (dmgMul !== 1 && !e.isBoss && en.prevDmg === null) { en.prevDmg = e.damageTaken ?? 1; e.damageTaken = en.prevDmg * dmgMul; }
    const h = e.height ?? 1.85, r = e.radius ?? 0.45;
    en.o.g.scale.set(r * 1.7, h * 0.58, r * 1.7);
    this.fx?.burst?.(e.center ?? e.pos, SHELL[kind].fill, 14, 4, 0.5, 0.16);
  }
  _release(en, shatter) {
    if (en.prevDmg !== null) en.e.damageTaken = en.prevDmg;
    en.o.g.visible = false; this.free.push(en.o);
    this.active.delete(en.e);
    if (shatter && this.fx) {
      const c = en.e.center ?? en.e.pos;
      this.fx.burst(c, SHELL[en.kind].fill, 22, 7, 0.6, 0.2);
      if (en.kind === 'ice') this.fx.sparks?.(c, THREE.Object3D.DEFAULT_UP, 0xffffff, 10, 8, 0.4, 0.1);
    }
  }
  update(dt) {
    const t = performance.now() * 0.001;
    for (const en of [...this.active.values()]) {
      en.t += dt;
      const e = en.e;
      if (!e.alive || en.t >= en.life || e.removed) { this._release(en, true); continue; }
      const c = e.center ?? e.pos;
      en.o.g.position.set(e.pos.x, e.pos.y + (e.height ?? 1.8) * 0.5, e.pos.z);
      const left = en.life - en.t;
      const m = this.mats[en.kind];
      if (en.kind === 'emp') {
        en.o.wire.visible = Math.sin(t * 60 + en.t * 30) > -0.2;
        if (Math.random() < 0.18) this.fx?.lightning?.(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2)), c.clone(), 0x9fe8ff, 0.15, 1);
      } else en.o.wire.visible = true;
      // fade as it is about to break
      const f = left < 0.5 ? left / 0.5 : 1;
      m.fill.opacity = SHELL[en.kind].fo * f; m.wire.opacity = 0.9 * f;
    }
  }
  clear() { for (const en of [...this.active.values()]) this._release(en, false); }
  dispose() {
    this.clear();
    for (const o of this.free) this.scene.remove(o.g);
    this.geo.dispose();
    for (const k in this.mats) { this.mats[k].fill.dispose(); this.mats[k].wire.dispose(); }
  }
}

// ---------------------------------------------------------------------------------------------
// Focus-aim target marks: little crosshair sprites that sit on enemies, always on top.
let MARK_TEX = null;
function markTex() {
  if (MARK_TEX) return MARK_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#ff5a5a'; x.lineWidth = 7; x.shadowColor = '#ff2020'; x.shadowBlur = 12; x.lineCap = 'round';
  x.beginPath(); x.arc(64, 64, 38, 0, Math.PI * 2); x.stroke();
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; x.beginPath(); x.moveTo(64 + Math.cos(a) * 24, 64 + Math.sin(a) * 24); x.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); x.stroke(); }
  MARK_TEX = new THREE.CanvasTexture(c);
  return MARK_TEX;
}
export class MarkPool {
  constructor(scene, n = 6) {
    this.scene = scene; this.items = []; this.mat = new THREE.SpriteMaterial({ map: markTex(), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.mat); s.visible = false; s.renderOrder = 999; s.scale.setScalar(1.3);
      scene.add(s); this.items.push({ s, e: null });
    }
  }
  has(e) { return this.items.some((m) => m.e === e); }
  get count() { let n = 0; for (const m of this.items) if (m.e) n++; return n; }
  add(e) {
    if (this.has(e)) return false;
    const slot = this.items.find((m) => !m.e);
    if (!slot) return false;
    slot.e = e; slot.s.visible = true; return true;
  }
  list() { return this.items.filter((m) => m.e).map((m) => m.e); }
  update(dt, time) {
    for (const m of this.items) {
      if (!m.e) continue;
      if (!m.e.alive) { m.e = null; m.s.visible = false; continue; }
      const e = m.e;
      m.s.position.set(e.pos.x, e.pos.y + (e.height ?? 1.8) * 0.62, e.pos.z);
      const k = 1.1 + 0.18 * Math.sin(time * 14);
      m.s.scale.setScalar(k * Math.max(1, (e.height ?? 1.8) / 1.8));
      m.s.material.rotation = time * 1.5;
    }
  }
  clear() { for (const m of this.items) { m.e = null; m.s.visible = false; } }
  dispose() { for (const m of this.items) this.scene.remove(m.s); this.mat.dispose(); }
}
