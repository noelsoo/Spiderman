// Weapons system: guns any hero can use, aiming, shops. Contract: docs/ARCHITECTURE.md#weapons
//
//   equipped: WeaponDef | null      owned: Map<id, WState{clip, reserve, ammo}>      aiming: bool       shops: [{pos, yaw, name}]
//   purchase(def) / purchaseAmmo(def) → { ok, msg }       equip(def|null)       cycle(dir)       reset()
//   update(dt)  — called by main before player.update while on foot
//   Camera zoom is applied inside a wrapper around game.cam.update so hero/vehicle camera code never sees it.
import * as THREE from 'three';
import { WEAPONS, MEDKIT, SHOP_ITEMS, WEAPON_BY_ID } from './defs.js';
import { buildGunMesh, buildStorefront, gunSvg } from './models.js';
import { ShopUI } from './shop.js';

export { WEAPONS, WEAPON_BY_ID, SHOP_ITEMS, MEDKIT };

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const damp = THREE.MathUtils.damp;
const lerp = THREE.MathUtils.lerp;

export class WState {
  constructor(clip, reserve) { this.clip = clip; this.reserve = reserve; }
  get ammo() { return this.reserve; }   // alias for the architecture doc wording
}

const SHOP_NAMES = ['Stark Armory', 'Midtown Munitions', "Hell's Kitchen Arms", 'Brooklyn Ballistics'];
const SHOP_ZONES = [[3, 6], [6, 9], [1, 3], [7, 1]];  // block (i, j) near spawn, east, west, north-east

export class Weapons {
  constructor(game) {
    this.game = game;
    this.equipped = null;
    this.owned = new Map();
    this.aiming = false;
    this.shops = [];
    this.nearShop = null;
    this.reloadProgress = -1;               // 0..1 while reloading, -1 otherwise
    this.scoped = false;

    this._guns = new Map();                 // def.id -> mesh
    this._gun = null;
    this._cd = 0; this._reload = 0; this._reloadT = 0;
    this._bloom = 0; this._aimBlend = 0; this._shotAge = 9; this._throwT = 0;
    this._fireWas = false; this._reloadWas = false; this._emptyT = 0;
    this._aimPt = new THREE.Vector3(); this._aimEnemy = null;
    this._ao = null;                        // camera offsets applied for the duration of cam.update
    this._t = 0; this._promptT = 0; this._crimeT = 0; this._hitT = 0;
    this._hidModel = null;
    this._ui = null;
    this._zoomI = 0; this._rp = 0; this._ry = 0; this._shotN = 0; this._breath = 3; this._breathHold = false;
    this._casings = [];
  }

  // ===================================================================== lifecycle
  async build() {
    const g = this.game;
    const given = g.world?.shops;
    const list = Array.isArray(given) && given.length ? given.map((s, i) => ({ pos: s.pos.clone(), yaw: s.yaw ?? 0, name: s.name || SHOP_NAMES[i % SHOP_NAMES.length] })) : this._pickShops();
    for (const s of list) this._makeShop(s);

    // Always-called hook (menu + playing): camera zoom, ambient animation, pickups, shop prompts.
    const cam = g.cam, orig = cam.update.bind(cam);
    cam.update = (dt, targetPos, look, o) => {
      orig(dt, targetPos, look, o);
      this._ambient(dt);
    };
    g.events.on('vehicle:enter', () => { this.aiming = false; this._fireWas = false; });
    g.events.on('cash', (e) => this._cashUi(e));
  }

  reset() {
    this.equipped = null; this.owned.clear(); this.aiming = false;
    this._cd = 0; this._reload = 0; this.reloadProgress = -1; this._bloom = 0; this._aimBlend = 0; this._shotAge = 9;
    this._setGun(null);
    this.game.combat?.reset?.();
    this._showModelAgain();
    this._ui = null;
    this._zoomI = 0; this._rp = this._ry = 0; this._breath = 3;
  }

  onHeroSwitch(from, to) {
    this._showModelAgain();
    if (this._gun) this._attach(to);
    this._hook(to);
  }

  // ===================================================================== shops
  _pickShops() {
    const g = this.game, out = [];
    const probe = (x, z, yaw) => {
      const s = Math.sin(yaw), c = Math.cos(yaw);
      for (const lx of [-3.6, 0, 3.6]) for (const lz of [-4.6, -2.6, -0.6, 1.4]) for (const y of [0.7, 2.6]) {
        const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
        if (g.physics.inside(_a.set(wx, y, wz))) return false;
      }
      return true;
    };
    const L = { PX: 100, PZ: 70, BW: 78, BD: 54, X0: -350, Z0: -560 };
    for (let zi = 0; zi < SHOP_ZONES.length; zi++) {
      const [bi, bj] = SHOP_ZONES[zi];
      let found = null;
      for (let r = 0; r < 3 && !found; r++) {
        for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (r > 0 && di === 0 && dj === 0) continue;
          const i = bi + di * r, j = bj + dj * r;
          const cx = L.X0 + L.PX * i, cz = L.Z0 + L.PZ * j;
          for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const ex = cx + sx * (L.BW / 2 - 4.5), ez = cz + sz * (L.BD / 2 - 3.2), yaw = sz > 0 ? 0 : Math.PI;
            if (probe(ex, ez, yaw)) { found = { pos: new THREE.Vector3(ex, 0, ez), yaw, name: SHOP_NAMES[zi % SHOP_NAMES.length] }; break; }
          }
          if (found) break;
        }
      }
      if (found) out.push(found);
    }
    return out;
  }

  _makeShop(s) {
    const g = this.game;
    s.pos.y = Math.max(0, g.physics.heightAt?.(s.pos.x, s.pos.z, 2.5) ?? 0);
    const colors = [0xff7a2c, 0x36c3ff, 0xff4a7a, 0x7dff6a];
    const sf = buildStorefront(s.name, WEAPONS, colors[this.shops.length % colors.length]);
    sf.group.position.copy(s.pos); sf.group.rotation.y = s.yaw;
    g.scene.add(sf.group);
    s.group = sf.group; s.spin = sf.spin;
    this.shops.push(s);
  }

  tryInteract() {
    const p = this.game.player;
    if (!p || p.dead || this.game.state !== 'playing') return false;
    const shop = this._nearest(p.pos, 3.4);
    if (!shop) return false;
    return this.openShop(shop);
  }

  _nearest(pos, r) {
    let best = null, bd = r;
    for (const s of this.shops) {
      if (Math.abs(pos.y - s.pos.y) > 6) continue;
      const d = Math.hypot(pos.x - s.pos.x, pos.z - s.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  openShop(shop) {
    const ui = new ShopUI(this.game, this, shop);
    if (!this.game.openOverlay(ui)) { ui.onClose(); return false; }
    this.aiming = false; this._fireWas = true; this._reloadWas = true;
    this.game.audio?.play?.('ui_select');
    return true;
  }

  // ===================================================================== inventory
  /** Buy (or equip, if already owned) an item. */
  purchase(d) {
    const g = this.game, eco = g.economy, st = this.owned.get(d.id);
    if (d.kind === 'item') {
      const p = g.player;
      if (!p || p.hp >= p.maxHp) return { ok: false, msg: 'Already at full health' };
      if (!eco.spend(d.price)) return { ok: false, msg: 'Not enough cash' };
      p.heal(p.maxHp);
      g.fx?.burst?.(p.center, 0x55ff88, 24, 5, 0.6, 0.25);
      return { ok: true, msg: 'Health restored' };
    }
    if (d.consumable) {
      if (st && st.reserve >= d.maxReserve) return { ok: false, msg: `Already carrying the maximum (${d.maxReserve})` };
      if (!eco.spend(d.price)) return { ok: false, msg: 'Not enough cash' };
      if (st) st.reserve = Math.min(d.maxReserve, st.reserve + d.ammoPack);
      else this.owned.set(d.id, new WState(d.clip, Math.min(d.maxReserve, d.startReserve)));
      if (!this.equipped) this.equip(d);
      return { ok: true, msg: `Bought ${d.ammoPack} ${d.name}` };
    }
    if (st) { this.equip(d); return { ok: true, msg: `${d.name} equipped` }; }
    if (!eco.spend(d.price)) return { ok: false, msg: 'Not enough cash' };
    this.owned.set(d.id, new WState(d.clip, d.startReserve));
    this.equip(d);
    return { ok: true, msg: `${d.name} purchased` };
  }

  purchaseAmmo(d) {
    const st = this.owned.get(d.id);
    if (!st) return { ok: false, msg: 'Buy the weapon first' };
    if (st.reserve >= d.maxReserve) return { ok: false, msg: 'Ammo is full' };
    if (!this.game.economy.spend(d.ammoPrice)) return { ok: false, msg: 'Not enough cash' };
    st.reserve = Math.min(d.maxReserve, st.reserve + d.ammoPack);
    return { ok: true, msg: `+${d.ammoPack} rounds` };
  }

  _cycleList() {
    const out = [null];
    for (const d of WEAPONS) { const st = this.owned.get(d.id); if (st && (st.reserve > 0 || st.clip > 0)) out.push(d); }
    return out;
  }

  cycle(dir) {
    const list = this._cycleList();
    if (list.length === 1) { this.game.hud?.toast?.('No weapons - find a Stark Armory'); return; }
    const i = Math.max(0, list.indexOf(this.equipped));
    this.equip(list[(i + dir + list.length) % list.length]);
  }

  equip(def) {
    if (def && !this.owned.has(def.id)) return false;
    const changed = this.equipped !== def;
    this.equipped = def ?? null;
    this._reload = 0; this.reloadProgress = -1; this._cd = changed ? 0.3 : this._cd; this._bloom = 0;
    this._setGun(def);
    if (changed) {
      this.game.hud?.toast?.(def ? def.name : 'Unarmed');
      this.game.audio?.play?.(def ? 'reload' : 'ui_back', { volume: 0.5 });
    }
    return true;
  }

  // ===================================================================== gun mesh handling
  _setGun(def) {
    if (this._gun) this._gun.parent?.remove(this._gun);
    this._gun = null;
    if (!def) return;
    let m = this._guns.get(def.id);
    if (!m) { m = buildGunMesh(def); this._guns.set(def.id, m); }
    this._gun = m;
    if (this.game.player) this._attach(this.game.player);
  }

  _attach(hero) {
    const hand = hero?.model?.handR ?? hero?.model?.group;
    if (!hand || !this._gun) return;
    hand.add(this._gun);
    this._gun.position.set(0, 0, 0);
  }

  _hook(hero) {
    if (!hero || hero._wpnHooked) return;
    hero._wpnHooked = true;
    const orig = hero.syncModel, self = this;
    hero.syncModel = function (dt) {
      const mine = self.game.player === this;
      if (mine) self._preSync(this, dt);
      orig.call(this, dt);
      if (mine) self._postSync(this);
    };
  }

  _poseHold() { return !!this.equipped && (this.aiming || this._shotAge < 1.4 || this._throwT > 0); }

  _preSync(hero, dt) {
    if (!this.equipped || hero.dead || this.game.vehicles?.driving) return;
    const st = hero.anim.state;
    const ground = st === 'idle' || st === 'run' || st === 'sprint' || st === 'shoot' || st === 'throw';
    if (this._poseHold()) {
      if (!hero.customMovement) { const f = this.game.cam.forward; hero.faceTowards(_a.set(f.x, 0, f.z), dt, 26); }
      if (ground) hero.setAnim(this._throwT > 0 ? 'throw' : 'shoot', hero.anim.speed);
    }
  }

  _postSync(hero) {
    const gun = this._gun;
    if (!gun || !gun.parent) return;
    const hand = gun.parent;
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(_a);
    hand.getWorldQuaternion(_q);
    if (this._poseHold()) _b.copy(this._aimPt).sub(_a);
    else _b.set(Math.sin(hero.yaw) * 0.9, -0.55, Math.cos(hero.yaw) * 0.9);
    if (_b.lengthSq() < 1e-6) return;
    _b.normalize();
    _m.lookAt(_b, _c.set(0, 0, 0), UP);
    _q2.setFromRotationMatrix(_m);
    gun.quaternion.copy(_q.invert()).multiply(_q2);
    if (this._reload > 0 && this.equipped) {
      // reload animation: gun drops and tilts, mag swap shake, snaps back up at the end
      const t = 1 - this._reload / this._reloadT, e = Math.sin(Math.min(1, t * 1.15) * Math.PI);
      _q.setFromEuler(_e.set(e * 0.9 + (t > 0.45 && t < 0.6 ? Math.sin(t * 90) * 0.05 : 0), 0, e * 0.5));
      gun.quaternion.multiply(_q);
    }
  }

  _showModelAgain() {
    if (this._hidModel) { if (!this.game.vehicles?.driving) this._hidModel.group.visible = true; this._hidModel = null; }
    this.scoped = false;
  }

  _muzzle(out) {
    const gun = this._gun;
    if (gun) { gun.updateWorldMatrix(true, true); gun.userData.muzzle.getWorldPosition(out); return out; }
    return out.copy(this.game.player.center);
  }

  // ===================================================================== ambient hook (called every frame via cam.update)
  _ambient(dt) {
    const g = this.game;
    this._t += dt;
    for (const s of this.shops) s.spin?.(this._t);
    const p = g.player;
    const playing = g.state === 'playing' && !!p;
    const driving = g.vehicles?.driving;
    g.economy.update(dt, playing ? (driving ? driving.pos : p.pos) : null);
    this._ensureUi();
    if (!playing) { this._setUiVisible(false); return; }

    // shop proximity prompt
    this.nearShop = driving ? null : this._nearest(p.pos, 3.4);
    this._promptT -= dt;
    if (this.nearShop && this._promptT <= 0) { g.hud?.prompt?.('interact', `Browse ${this.nearShop.name}`); this._promptT = 2.2; }
    if (!this.nearShop) this._promptT = Math.min(this._promptT, 0);

    // scope hides the hero's body
    const def = this.equipped;
    const scoped = !!def?.scope && g.cam.scoped && !driving;
    this._aimBlend = g.cam.aimT;
    this._updateCasings(dt);
    if (scoped !== this.scoped) {
      this.scoped = scoped;
      if (scoped) { this._hidModel = p.model; if (p.model?.group) p.model.group.visible = false; }
      else this._showModelAgain();
    }
    this._updateUi(dt);
  }

  // ===================================================================== HUD bits (own DOM)
  _ensureUi() {
    if (this._ui?.root.isConnected) return;
    const hud = document.getElementById('hud');
    if (!hud) return;
    const mk = (cls, html = '') => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; hud.appendChild(e); return e; };
    this._ui = {
      root: hud,
      xh: mk('wpn-xh', '<i></i><i></i><i></i><i></i><i></i>'),
      scope: mk('wpn-scope', '<b></b>'),
      ammo: mk('wpn-ammo', '<span class="ic"></span><div><div class="nm"></div><div class="ct"></div><div class="rl"><i></i></div></div>'),
      cash: mk('wpn-cash', '$0'),
      sig: {},
    };
    this._ui.cash.textContent = '$' + Math.round(this.game.economy.cash).toLocaleString('en-US');
  }

  _setUiVisible(v) {
    const u = this._ui; if (!u) return;
    u.xh.classList.toggle('on', false); u.scope.classList.toggle('on', false); u.ammo.classList.toggle('on', false);
    u.cash.style.display = 'none';
    u.root.classList.remove('wpn-armed');
  }

  _cashUi(e) {
    const u = this._ui; if (!u) return;
    u.cash.textContent = '$' + Math.round(e.total).toLocaleString('en-US');
    u.cash.classList.remove('bump'); void u.cash.offsetWidth; u.cash.classList.add('bump');
  }

  _updateUi(dt) {
    const u = this._ui; if (!u) return;
    const g = this.game, def = this.equipped, hud = g.hud, own = !hud?.handlesWeapons;
    const st = def ? this.owned.get(def.id) : null;
    const armed = !!def && !g.vehicles?.driving && !g.player?.dead;
    const hasHudXh = typeof hud?.setCrosshair === 'function';
    u.cash.style.display = own ? '' : 'none';
    if (u.sig.cash !== g.economy.cash) { u.sig.cash = g.economy.cash; u.cash.textContent = '$' + Math.round(g.economy.cash).toLocaleString('en-US'); }

    // crosshair
    const showX = armed && !this.scoped;
    const spreadPx = this._spreadPx(def);
    if (hasHudXh) {
      const key = showX ? def.id + '|' + Math.round(spreadPx / 2) : '';
      if (u.sig.hx !== key) { u.sig.hx = key; hud.setCrosshair(showX ? (def.scope ? 'sniper' : def.kind === 'hitscan' ? 'gun' : 'launcher') : null, spreadPx); }
      u.xh.classList.remove('on');
    } else {
      u.xh.classList.toggle('on', showX);
      u.xh.style.setProperty('--s', spreadPx.toFixed(1) + 'px');
    }
    u.root.classList.toggle('wpn-armed', armed && !hasHudXh);
    if (this._hitT > 0) { this._hitT -= dt; u.xh.classList.toggle('hit', this._hitT > 0); }
    u.scope.classList.toggle('on', this.scoped && !hasHudXh);

    // ammo panel
    u.ammo.classList.toggle('on', armed && own);
    if (armed && own) {
      const key = def.id + '|' + st.clip + '|' + st.reserve;
      if (u.sig.am !== key) {
        u.sig.am = key;
        u.ammo.querySelector('.ic').innerHTML = u.sig.ic === def.id ? u.ammo.querySelector('.ic').innerHTML : gunSvg(def, { height: 36 });
        u.sig.ic = def.id;
        u.ammo.querySelector('.nm').textContent = def.name;
        u.ammo.querySelector('.ct').innerHTML = def.noClip ? `${st.reserve}` : `${st.clip} <small>/ ${st.reserve}</small>`;
        u.ammo.classList.toggle('empty', st.clip === 0 && st.reserve === 0);
      }
      u.ammo.querySelector('.rl i').style.width = this.reloadProgress >= 0 ? (this.reloadProgress * 100).toFixed(0) + '%' : '0';
    }
  }

  _spreadPx(def) {
    if (!def) return 0;
    const fov = THREE.MathUtils.degToRad(this.game.camera.fov);
    const rad = this._spread(def);
    return THREE.MathUtils.clamp(Math.tan(rad) / Math.tan(fov / 2) * innerHeight / 2, 5, 110);
  }

  _spread(def) {
    const p = this.game.player;
    const moving = p ? Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 10) : 0;
    const b = this.game.cam.aimT;
    let sp = lerp(def.spread, def.aimSpread, b) + moving * def.spread * 0.5 * (1 - 0.6 * b) + this._bloom + 0.0015;
    if (def.scope && b > 0.8) sp += this._swayAmt() * 0.0015 * (1 + moving * 6);
    // first-shot accuracy: a settled trigger finger is much tighter
    if (this._shotAge > 0.45 && this._bloom < 0.002) sp *= 0.45;
    return sp;
  }

  _swayAmt() { return this._breathHold ? 0.08 : 1; }

  // ===================================================================== main update (on foot)
  update(dt) {
    const g = this.game, inp = g.input, p = g.player;
    if (!p || g.state !== 'playing') return;
    this._hook(p);
    if (this._gun && !this._gun.parent) this._attach(p);

    this._cd -= dt; this._shotAge += dt; this._throwT -= dt; this._emptyT -= dt;
    this._bloom = Math.max(0, this._bloom - dt * (this.aiming ? 0.09 : 0.06));
    if (this._shotAge > 0.3) this._shotN = 0;

    const def = this.equipped;
    const scopedNow = !!def?.scope && inp.down('aim') && !p.dead;
    if (!p.dead) {
      if (scopedNow) {
        // variable zoom 4x / 8x / 12x with the same inputs that cycle weapons
        const z = def.zoom;
        if (inp.pressed('weaponNext')) { this._zoomI = Math.min(z.length - 1, this._zoomI + 1); g.audio?.play?.('ui_move', { volume: 0.4 }); }
        if (inp.pressed('weaponPrev')) { this._zoomI = Math.max(0, this._zoomI - 1); g.audio?.play?.('ui_move', { volume: 0.4 }); }
        inp.consume('weaponNext', 'weaponPrev');
      } else {
        if (inp.pressed('weaponNext')) this.cycle(1);
        if (inp.pressed('weaponPrev')) this.cycle(-1);
      }
    }
    this._recoilRecover(dt);
    if (!def || p.dead) { this.aiming = false; this._fireWas = false; this._reloadWas = false; this.reloadProgress = -1; return; }
    const st = this.owned.get(def.id);
    if (!st) { this.equip(null); return; }

    // ---- read the buttons BEFORE consuming (consume releases them)
    const aimHeld = inp.down('aim');
    const fireRaw = inp.down('fire');
    const viaMouse = inp.sources.fire.some((s) => s[0][0] === 'm');
    const wantFire = fireRaw && (aimHeld || viaMouse);
    const reloadHeld = inp.down('reload');
    inp.consume('aim', 'reload');
    if (wantFire) inp.consume('fire');
    const fireEdge = wantFire && !this._fireWas; this._fireWas = wantFire;
    const reloadEdge = reloadHeld && !this._reloadWas; this._reloadWas = reloadHeld;
    this.aiming = aimHeld;
    if (aimHeld) this._requestAim(def, dt, inp);
    else { this._breathHold = false; this._breath = Math.min(3, this._breath + dt * 0.6); }

    // aim point for the gun pose / crosshair
    if (this._poseHold()) this._aimInfo(def.range, this._aimPt);
    if (this.aiming || this._shotAge < 1.4) {
      const f = g.cam.forward; if (!p.customMovement) p.faceTowards(_a.set(f.x, 0, f.z), dt, 26);
    }

    // ---- reload
    if (this._reload > 0) {
      this._reload -= dt;
      this.reloadProgress = 1 - Math.max(0, this._reload) / this._reloadT;
      if (this._reload <= 0) this._finishReload(def, st);
    } else this.reloadProgress = -1;

    // ---- fire / reload requests
    if (this._reload <= 0) {
      if (reloadEdge && !def.noClip) this._startReload(def, st);
      const trigger = def.auto ? wantFire : fireEdge;
      if (this._cd <= 0) {
        if (def.noClip) {
          if (trigger) { if (st.reserve > 0) this._shoot(def, st, p); }
        } else if (trigger) {
          if (st.clip > 0) this._shoot(def, st, p);
          else if (st.reserve > 0) this._startReload(def, st);
          else if (fireEdge && this._emptyT <= 0) { g.audio?.play?.('empty'); g.hud?.toast?.('Out of ammo'); this._emptyT = 0.5; }
        } else if (!def.noClip && st.clip === 0 && st.reserve > 0) this._startReload(def, st);
      }
    }
    if (def.noClip && st.reserve <= 0 && this._cd <= 0) {
      // out of grenades: drop to the next weapon
      this.owned.delete(def.id);
      const list = this._cycleList();
      this.equip(list[list.length > 1 ? 1 : 0]);
    }
  }

  _requestAim(def, dt, inp) {
    const g = this.game;
    if (def.scope) {
      g.cam.requestAim({ fov: def.zoom[this._zoomI], distance: 0.15, shoulder: 0.2, height: 1.68, scope: true, blend: 14 });
      // hold breath (sprint / L3) steadies the sway for up to 3 s
      this._breathHold = inp.down('sprint') && this._breath > 0;
      if (this._breathHold) this._breath -= dt; else this._breath = Math.min(3, this._breath + dt * 0.5);
      if (this._breath <= 0) this._breathHold = false;
      // scope sway grows with movement, nearly gone when holding breath
      const mv = Math.min(1, Math.hypot(g.player.vel.x, g.player.vel.z) / 6);
      const amt = (0.0006 + mv * 0.0025) * this._swayAmt() * (def.zoom[this._zoomI] < 10 ? 0.6 : 1);
      const t = this._t;
      g.cam.yaw += Math.sin(t * 1.7) * amt * dt * 60 * 0.5;
      g.cam.pitch += Math.cos(t * 2.3) * amt * dt * 60 * 0.5;
    } else {
      g.cam.requestAim({ fov: def.adsFov ?? 52, distance: 2.4, shoulder: 0.85, height: 1.6 });
    }
  }

  _recoilRecover(dt) {
    const c = this.game.cam, k = 1 - Math.exp(-6 * dt);
    const dp = this._rp * k, dy = this._ry * k;
    this._rp -= dp; this._ry -= dy;
    c.pitch -= dp * 0.55; c.yaw -= dy * 0.7;       // part of the kick is recovered, the rest is yours to correct
  }

  _startReload(def, st) {
    if (this._reload > 0 || st.clip >= def.clip || st.reserve <= 0) return;
    this._reload = this._reloadT = def.reload;
    this.game.audio?.play?.('reload');
  }
  _finishReload(def, st) {
    const need = Math.min(def.clip - st.clip, st.reserve);
    st.clip += need; st.reserve -= need;
    this._reload = 0; this.reloadProgress = -1;
  }

  // ===================================================================== aiming helpers
  /** Camera-ray target: world hit point, with a little aim assist toward enemies near the crosshair. */
  _aimInfo(range, out) {
    const g = this.game, cam = g.camera, p = g.player;
    cam.getWorldDirection(_d);
    const dir = _d;
    _u.copy(cam.position);
    const along = Math.max(0.5, _v.subVectors(p.center, _u).dot(dir));
    _u.addScaledVector(dir, along);                                   // start in front of the camera, level with the hero
    const wall = g.physics.raycast(_u, dir, range);
    const maxT = wall ? wall.distance : range;
    let bestSc = 1, best = null;
    const assist = this._aimBlend > 0.5 ? 0.014 : 0.03;
    const list = g.enemies?.list ?? [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.untargetable) continue;
      _v.set(e.pos.x - _u.x, e.pos.y + e.height * 0.55 - _u.y, e.pos.z - _u.z);
      const proj = _v.dot(dir);
      if (proj < 1 || proj > maxT) continue;
      const perp = Math.sqrt(Math.max(0, _v.lengthSq() - proj * proj));
      const sc = perp / (e.radius * 0.95 + 0.25 + proj * assist);
      if (sc < bestSc) { bestSc = sc; best = e; }
    }
    this._aimEnemy = best;
    if (best) out.set(best.pos.x, best.pos.y + best.height * 0.55, best.pos.z);
    else out.copy(_u).addScaledVector(dir, maxT);
    return out;
  }

  _spreadDir(dir, spread, out) {
    if (spread <= 0) return out.copy(dir);
    _u.crossVectors(dir, UP); if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0); _u.normalize();
    _v.crossVectors(dir, _u).normalize();
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * spread;
    return out.copy(dir).addScaledVector(_u, Math.cos(a) * r).addScaledVector(_v, Math.sin(a) * r).normalize();
  }

  // ===================================================================== firing
  _shoot(def, st, p) {
    const g = this.game;
    this._cd = 1 / def.rate;
    this._shotAge = 0;
    if (def.noClip) st.reserve--; else st.clip--;
    const muzzle = this._muzzle(_c.clone());
    this._aimInfo(def.range, this._aimPt);
    const target = this._aimPt.clone();

    if (def.kind === 'hitscan') this._fireHitscan(def, p, muzzle, target);
    else if (def.kind === 'launcher') this._launch(def, p, muzzle, target);
    else this._throw(def, p, muzzle, target);

    // feedback
    const aimK = this.aiming ? 0.6 : 1;
    const cam = g.cam;
    // recoil pattern: vertical kick that climbs over a burst, horizontal drift that wanders, both partly recover
    this._shotN++;
    const climb = def.auto ? Math.min(1.6, 0.8 + this._shotN * 0.05) : 1;
    const kp = def.recoil * aimK * climb * (0.85 + Math.random() * 0.3);
    const ky = def.recoil * aimK * 0.45 * (Math.sin(this._shotN * 0.9) * 0.6 + (Math.random() - 0.5));
    cam.pitch += kp; cam.yaw += ky; this._rp += kp; this._ry += ky;
    this._ejectCasing(def, p);
    if (def.kind !== 'throw') {
      g.fx?.flash?.(muzzle, 0xffc060, def.heavy ? 6 : 3, 0.07);
      g.fx?.glow?.(muzzle, 0xffd890, def.kind === 'launcher' ? 1.8 : 0.7 + def.recoil * 4, 0.06);
      g.fx?.burst?.(muzzle, 0xffb050, 3, 4, 0.12, 0.12);
      if (def.kind === 'launcher') g.fx?.smoke?.(muzzle, 0.7, 0.9, null, 0.5);
      g.cam.shake(def.heavy ? 0.3 : 0.05 + def.recoil * 1.5);
    }
    g.input.rumble(Math.min(1, 0.15 + def.recoil * 8), Math.min(1, 0.2 + def.recoil * 4), def.heavy ? 160 : 55);
    g.audio?.play?.(def.sound, { pos: muzzle });
    if (p.anim.state === 'shoot' || p.anim.state === 'throw') p.anim.t = 0;
    this._bloom = Math.min(0.05, this._bloom + def.spread * 0.18 + def.recoil * 0.12);
    g.events.emit('weapon:fired', { weapon: def.id, pos: muzzle.clone() });
    this._crimeT -= 0; if (performance.now() - this._crimeT > 3000) { this._crimeT = performance.now(); g.events.emit('crime', { severity: 1, pos: muzzle.clone(), kind: 'shots' }); }
  }

  _fireHitscan(def, p, muzzle, target) {
    const g = this.game, combat = g.combat;
    _a.copy(target).sub(muzzle);
    const dist = _a.length();
    if (dist < 0.01) _a.copy(g.cam.forward);
    const base = _a.normalize().clone();
    const spread = this._spread(def);
    const dir = new THREE.Vector3();
    const multi = def.pellets > 1;
    for (let i = 0; i < (def.pellets || 1); i++) {
      this._spreadDir(base, spread, dir);
      const wall = g.physics.raycast(muzzle, dir, def.range);
      const maxT = wall ? wall.distance : def.range;
      // damage falloff with distance (sniper barely drops)
      const fo = def.scope ? 1 : multi ? Math.max(0.3, 1.1 - dist / def.range) : lerp(1, 0.55, THREE.MathUtils.clamp((dist - def.range * 0.35) / (def.range * 0.65), 0, 1));
      let dmg = def.damage * fo;
      const head = this._headTest(muzzle, dir, maxT);
      if (head) dmg *= 2;
      const hit = combat.hitscan({
        origin: muzzle, dir, range: def.range, damage: dmg, team: 'player', source: p,
        tracer: (multi && i > 3) ? 0 : def.tracer, width: multi ? 0.7 : 0.45, knockback: def.knock, stun: 0.15, heavy: !!def.heavy || !!head,
      });
      if (hit) {
        this._hitT = 0.14;
        const hs = !!head && hit.target === head;
        if (hs) g.fx?.text?.(_c.set(hit.target.pos.x, hit.target.pos.y + hit.target.height + 0.9, hit.target.pos.z), 'HEADSHOT', 0xff6a30, { size: 1.2 });
        g.hud?.hitMarker?.(hs);
        continue;
      }
      if (this._hitPed(muzzle, dir, maxT, dmg, p)) { this._hitT = 0.14; g.hud?.hitMarker?.(false); continue; }
      if (wall) this._impact(wall, i);
    }
  }

  _headTest(origin, dir, maxT) {
    const list = this.game.enemies?.list ?? [];
    let best = null, bt = maxT;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.untargetable) continue;
      _v.set(e.pos.x - origin.x, e.pos.y + e.height * 0.92 - origin.y, e.pos.z - origin.z);
      const proj = _v.dot(dir);
      if (proj < 0 || proj > bt) continue;
      const r = Math.max(0.17, e.radius * 0.45);
      if (_v.lengthSq() - proj * proj <= r * r) { bt = proj; best = e; }
    }
    return best;
  }

  _impact(wall, i) {
    const fx = this.game.fx, n = wall.normal;
    if (n.y > 0.7) { fx?.dust?.(wall.point, 4, 0.8); fx?.sparks?.(wall.point, n, 0xc8b898, 3, 4, 0.2, 0.06); }
    else { fx?.sparks?.(wall.point, n, 0xffd080, 7, 9, 0.28, 0.08); if (i < 3) fx?.smoke?.(wall.point, 0.28, 0.5, null, 0.3); }
  }

  // ---- shell casings
  _ejectCasing(def) {
    if (def.kind !== 'hitscan') return;
    const gun = this._gun; if (!gun) return;
    gun.updateWorldMatrix(true, false);
    gun.getWorldPosition(_a);
    const fw = _b.set(0, 0, 1).transformDirection(gun.matrixWorld);
    const right = _u.crossVectors(UP, fw).normalize().negate();
    const big = def.id === 'shotgun' || def.id === 'sniper';
    const c = this._casings;
    _casing ??= { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6), mat: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 }), red: new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.6 }) };
    let o = c.find((x) => !x.live);
    if (!o) {
      if (c.length >= 24) return;
      const mesh = new THREE.Mesh(_casing.geo, _casing.mat); this.game.scene.add(mesh);
      o = { mesh, vel: new THREE.Vector3(), live: false, t: 0 }; c.push(o);
    }
    o.mesh.material = def.id === 'shotgun' ? _casing.red : _casing.mat;
    o.mesh.scale.setScalar(big ? 1.7 : 1);
    o.mesh.position.copy(_a).addScaledVector(fw, 0.08).y += 0.05;
    o.vel.copy(right).multiplyScalar(2 + Math.random() * 1.5).addScaledVector(fw, -0.3 + Math.random() * 0.6).setY(2 + Math.random() * 1.5);
    o.mesh.visible = true; o.live = true; o.t = 0; o.sound = true;
  }

  _updateCasings(dt) {
    for (const o of this._casings) {
      if (!o.live) continue;
      o.t += dt;
      o.vel.y -= 16 * dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      o.mesh.rotation.x += dt * 14; o.mesh.rotation.z += dt * 9;
      const gy = this.game.physics.heightAt?.(o.mesh.position.x, o.mesh.position.z, o.mesh.position.y + 0.5) ?? 0;
      if (o.mesh.position.y < gy + 0.02) {
        o.mesh.position.y = gy + 0.02; o.vel.y *= -0.3; o.vel.x *= 0.5; o.vel.z *= 0.5;
        if (o.sound) { o.sound = false; if (o.mesh.position.distanceToSquared(this.game.camera.position) < 400) this.game.audio?.play?.('casing', { pos: o.mesh.position, volume: 0.5 }); }
      }
      if (o.t > 4) { o.live = false; o.mesh.visible = false; }
    }
  }

  _hitPed(origin, dir, maxT, damage, p) {
    const peds = this.game.peds?.list;
    if (!peds || !peds.length) return false;
    let best = null, bt = maxT;
    for (let i = 0; i < peds.length; i++) {
      const pd = peds[i];
      if (pd.alive === false || !pd.pos) continue;
      const r = (pd.radius ?? 0.4) + 0.15, h = pd.height ?? 1.8;
      for (let s = 0; s < 3; s++) {
        _v.set(pd.pos.x - origin.x, pd.pos.y + h * (0.2 + 0.3 * s) - origin.y, pd.pos.z - origin.z);
        const proj = _v.dot(dir);
        if (proj < 0 || proj > bt) continue;
        if (_v.lengthSq() - proj * proj <= r * r) { bt = proj; best = pd; }
      }
    }
    if (!best) return false;
    const pt = origin.clone().addScaledVector(dir, bt);
    best.takeDamage?.(damage, { knockback: dir.clone().multiplyScalar(5).setY(2) });
    this.game.fx?.hitSpark?.(pt, 0xff8080, false);
    this.game.events.emit('crime', { severity: best.alive === false ? 3 : 2, pos: pt, kind: best.alive === false ? 'ped_killed' : 'ped_hit' });
    return true;
  }

  /** Launch vector that lands near `target` (low arc), falling back to a 40 degree lob when out of reach. */
  _ballistic(from, to, speed, grav, out) {
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
    const dh = Math.hypot(dx, dz) || 0.001;
    const v2 = speed * speed, disc = v2 * v2 - grav * (grav * dh * dh + 2 * dy * v2);
    let ang;
    if (disc >= 0) ang = Math.atan((v2 - Math.sqrt(disc)) / (grav * dh));
    else ang = Math.PI / 4.5;
    return out.set(dx / dh * Math.cos(ang) * speed, Math.sin(ang) * speed, dz / dh * Math.cos(ang) * speed);
  }

  _launch(def, p, muzzle, target) {
    const g = this.game;
    const vel = new THREE.Vector3();
    if (def.arc) this._ballistic(muzzle, target, def.speed, def.gravity, vel);
    else vel.copy(target).sub(muzzle).normalize().multiplyScalar(def.speed);
    const rocket = !!def.rocket;
    const mesh = rocket ? null : shellMesh();
    const proj = g.combat.projectile({
      kind: rocket ? 'missile' : 'rock', pos: muzzle, vel, damage: def.damage, gravity: def.gravity, team: 'player', source: p,
      life: def.range / def.speed + 1.2, size: 0.12, radius: rocket ? 0.35 : 0.25, mesh, color: 0xffa040,
      onHit: () => {}, onExpire: (pr) => this._detonate(pr, def, p),
    });
    proj.user = { weapon: def.id };
    if (rocket) g.fx?.smoke?.(muzzle, 1.1, 1.2, null, 0.6);
  }

  _throw(def, p, muzzle, target) {
    const g = this.game;
    this._throwT = 0.35;
    p.setAnim?.('throw'); p.anim.t = 0;
    // thrown from the hand, short range clamp
    _a.copy(target).sub(muzzle);
    const d = _a.length();
    if (d > def.range) _a.multiplyScalar(def.range / d);
    _b.copy(muzzle).add(_a);
    const vel = this._ballistic(muzzle, _b, def.speed, def.gravity, new THREE.Vector3());
    const mesh = grenadeMesh();
    g.combat.projectile({
      kind: 'rock', pos: muzzle, vel, damage: def.damage, gravity: def.gravity, team: 'player', source: p, world: false,
      life: def.fuse, size: 0.1, radius: 0.12, mesh, onHit: () => {}, onExpire: (pr) => this._detonate(pr, def, p),
      update: (pr, dt) => this._grenadeBounce(pr, dt),
    });
  }

  _grenadeBounce(pr) {
    const phy = this.game.physics;
    _a.subVectors(pr.pos, pr.prev);
    const len = _a.length();
    if (len > 1e-5) {
      _a.multiplyScalar(1 / len);
      const hit = phy.raycast(pr.prev, _a, len + 0.14);
      if (hit) {
        const n = hit.normal, vn = pr.vel.dot(n);
        if (vn < 0) pr.vel.addScaledVector(n, -1.55 * vn).multiplyScalar(0.8);
        pr.pos.copy(hit.point).addScaledVector(n, 0.14);
        if (n.y > 0.5 && Math.abs(pr.vel.y) < 1.5) { pr.vel.y = 0; pr.vel.x *= 0.85; pr.vel.z *= 0.85; }
      }
    }
    if (pr.pos.y < 0.12) { pr.pos.y = 0.12; if (pr.vel.y < 0) pr.vel.y *= -0.35; pr.vel.x *= 0.85; pr.vel.z *= 0.85; }
  }

  _detonate(pr, def, p) {
    if (pr.mesh && !pr.ownMesh) pr.mesh.parent?.remove(pr.mesh);
    const g = this.game;
    const pos = pr.pos.clone();
    if (pr.vel.lengthSq() > 1) pos.addScaledVector(_a.copy(pr.vel).normalize(), -0.35);
    pos.y = Math.max(pos.y, 0.3);
    g.combat.explode(pos, def.blast, def.damage, { team: 'player', source: p, knockback: def.knock, up: 8, stun: 1.0 });
    // pedestrians caught in the blast
    for (const pd of g.peds?.list ?? []) {
      if (pd.alive === false || !pd.pos) continue;
      const d = Math.hypot(pd.pos.x - pos.x, pd.pos.y + 1 - pos.y, pd.pos.z - pos.z);
      if (d < def.blast) {
        _b.set(pd.pos.x - pos.x, 0, pd.pos.z - pos.z).normalize().multiplyScalar(10).setY(6);
        pd.takeDamage?.(def.damage * (1 - d / def.blast * 0.6), { knockback: _b.clone() });
      }
    }
    const cd = g.camera.position.distanceTo(pos);
    g.cam.shake(Math.max(0, 1 - cd / 45) * (def.blast > 9 ? 1.1 : 0.7));
    g.events.emit('crime', { severity: 2, pos: pos.clone(), kind: 'shots' });
    g.events.emit('weapon:fired', { weapon: def.id + ':blast', pos: pos.clone() });
  }
}

// shared small meshes for projectiles
let _shell = null, _gren = null, _casing = null;
function shellMesh() {
  _shell ??= {
    body: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8).rotateX(Math.PI / 2),
    nose: new THREE.ConeGeometry(0.05, 0.1, 8).rotateX(Math.PI / 2),
    m1: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 }),
    m2: new THREE.MeshStandardMaterial({ color: 0x2b2e36, metalness: 0.7, roughness: 0.4 }),
  };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(_shell.body, _shell.m1));
  const n = new THREE.Mesh(_shell.nose, _shell.m2); n.position.z = 0.16; g.add(n);
  return g;
}
function grenadeMesh() {
  _gren ??= {
    geo: new THREE.SphereGeometry(0.1, 10, 8),
    lever: new THREE.BoxGeometry(0.03, 0.02, 0.12),
    m1: new THREE.MeshStandardMaterial({ color: 0x4d5a2f, roughness: 0.6, metalness: 0.3 }),
    m2: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.4 }),
  };
  const g = new THREE.Group();
  g.add(new THREE.Mesh(_gren.geo, _gren.m1));
  const l = new THREE.Mesh(_gren.lever, _gren.m2); l.position.y = 0.1; g.add(l);
  return g;
}
