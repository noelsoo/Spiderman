// Weapon shop overlay: keyboard, mouse and gamepad (D-pad / stick + face buttons). Appended into #hud.
import './shop.css';
import * as THREE from 'three';
import { SHOP_ITEMS, weaponStats } from './defs.js';
import { gunSvg } from './models.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export class ShopUI {
  /** @param game  @param weapons  Weapons instance  @param shop { name, pos } */
  constructor(game, weapons, shop) {
    this.game = game; this.weapons = weapons; this.shop = shop;
    this.sel = 0; this.closed = false; this.age = 0;
    this._repeat = 0; this._dirHeld = 0;
    this._prev = {};
    this._glyphKey = '';
    this._build();
    this._select(0, true);
    this._refresh();
  }

  // ------------------------------------------------------------------ DOM
  _build() {
    const g = this.game;
    const hero = g.player?.color;
    const root = document.createElement('div');
    root.className = 'wshop';
    if (hero) root.style.setProperty('--hero', typeof hero === 'number' ? '#' + new THREE.Color(hero).getHexString() : hero);
    root.innerHTML = `
      <div class="ws-panel">
        <header class="ws-head">
          <div class="ws-title"><small>${esc(this.shop.name ? 'WELCOME TO' : 'SHOP')}</small><h1>${esc(this.shop.name || 'Armory')}</h1></div>
          <div class="ws-cash"><small>CASH</small><b data-r="cash">$0</b></div>
        </header>
        <div class="ws-body">
          <ul class="ws-list" data-r="list"></ul>
          <section class="ws-detail">
            <div class="ws-hero" data-r="icon"></div>
            <h2 data-r="name"></h2>
            <p class="ws-desc" data-r="desc"></p>
            <div class="ws-stats" data-r="stats"></div>
            <div class="ws-own" data-r="own"></div>
            <div class="ws-btns">
              <button class="ws-btn buy" data-r="buy"></button>
              <button class="ws-btn ammo" data-r="ammo"></button>
            </div>
            <div class="ws-msg" data-r="msg"></div>
          </section>
        </div>
        <footer class="ws-foot" data-r="foot"></footer>
      </div>`;
    this.root = root;
    this.$ = {};
    root.querySelectorAll('[data-r]').forEach((el) => { this.$[el.dataset.r] = el; });

    this.rows = SHOP_ITEMS.map((d, i) => {
      const li = document.createElement('li');
      li.className = 'ws-row';
      li.innerHTML = `<span class="ws-ico">${gunSvg(d, { height: 30 })}</span><span class="ws-nm">${esc(d.name)}</span><span class="ws-tag"></span><span class="ws-pr">${money(d.price)}</span>`;
      li.addEventListener('mouseenter', () => { if (this.sel !== i) this._select(i); });
      li.addEventListener('click', () => { this._select(i); });
      li.addEventListener('dblclick', () => this._buy());
      this.$.list.appendChild(li);
      return li;
    });
    this.$.buy.addEventListener('click', () => this._buy());
    this.$.ammo.addEventListener('click', () => this._buyAmmo());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('wheel', (e) => { this.$.list.scrollTop += e.deltaY; }, { passive: true });

    (document.getElementById('hud') || document.body).appendChild(root);
    requestAnimationFrame(() => root.classList.add('on'));
  }

  // ------------------------------------------------------------------ input glyphs
  _pad() { return this.game.input.lastDevice === 'gamepad'; }
  _glyphs() {
    const inp = this.game.input;
    if (!this._pad()) return { nav: '<i class="k">W</i><i class="k">S</i>', buy: '<i class="k">Enter</i>', ammo: '<i class="k">E</i>', close: '<i class="k">Esc</i>' };
    if (inp.isPlayStation) return { nav: '<i class="p">D-pad</i>', buy: '<i class="p ps x">&#x2715;</i>', ammo: '<i class="p">R1</i>', close: '<i class="p ps o">&#x25EF;</i>' };
    return { nav: '<i class="p">D-pad</i>', buy: '<i class="p xb a">A</i>', ammo: '<i class="p">RB</i>', close: '<i class="p xb b">B</i>' };
  }
  _renderFoot() {
    const key = this._pad() + '|' + this.game.input.isPlayStation;
    if (key === this._glyphKey) return;
    this._glyphKey = key;
    const gl = this._glyphs();
    this.$.foot.innerHTML = `<span>${gl.nav} Browse</span><span>${gl.buy} Buy</span><span>${gl.ammo} Buy ammo</span><span>${gl.close} Leave</span>`;
    this._renderButtons();
  }

  // ------------------------------------------------------------------ state
  get item() { return SHOP_ITEMS[this.sel]; }

  _select(i, silent = false) {
    this.sel = (i + SHOP_ITEMS.length) % SHOP_ITEMS.length;
    this.rows.forEach((r, k) => r.classList.toggle('sel', k === this.sel));
    this.rows[this.sel].scrollIntoView?.({ block: 'nearest' });
    if (!silent) this.game.audio?.play?.('ui_move');
    this._refreshDetail();
  }

  _refresh() {
    const w = this.weapons, cash = this.game.economy.cash;
    this.$.cash.textContent = money(cash);
    SHOP_ITEMS.forEach((d, i) => {
      const row = this.rows[i], st = w.owned.get(d.id);
      const tag = row.querySelector('.ws-tag');
      let t = '';
      if (d.kind === 'item') t = '';
      else if (d.consumable) t = st ? `x${st.reserve}` : '';
      else if (st) t = w.equipped === d ? 'EQUIPPED' : 'OWNED';
      tag.textContent = t; tag.className = 'ws-tag' + (t ? ' on' : '');
      row.classList.toggle('owned', !!st && !d.consumable);
      row.classList.toggle('poor', cash < d.price && !(st && !d.consumable));
    });
    this._refreshDetail();
  }

  _refreshDetail() {
    const d = this.item, w = this.weapons, g = this.game, st = w.owned.get(d.id);
    this.$.icon.innerHTML = gunSvg(d, { height: 118 });
    this.$.name.textContent = d.name;
    this.$.desc.textContent = d.desc;
    const stats = weaponStats(d);
    if (stats) {
      this.$.stats.innerHTML = stats.map((s) => `<div class="ws-stat"><span>${s.label}</span><div class="bar"><i style="width:${Math.round(s.v * 100)}%"></i></div></div>`).join('')
        + `<div class="ws-chips"><span>${d.kind === 'hitscan' ? (d.pellets > 1 ? `${d.damage} x ${d.pellets} dmg` : `${d.damage} dmg`) : `${d.damage} dmg / ${d.blast} m blast`}</span>${d.noClip ? '' : `<span>Mag ${d.clip}</span>`}<span>${d.auto ? 'Full-auto' : d.kind === 'throw' ? 'Thrown' : 'Semi-auto'}</span>${d.scope ? '<span>Scoped</span>' : ''}</div>`;
    } else {
      const p = g.player;
      this.$.stats.innerHTML = `<div class="ws-stat"><span>HEALTH</span><div class="bar hp"><i style="width:${p ? Math.round(p.hp / p.maxHp * 100) : 100}%"></i></div></div>`;
    }
    if (d.kind === 'item') this.$.own.textContent = p0(g) ? `${p0(g).name}: ${Math.round(p0(g).hp)} / ${p0(g).maxHp} HP` : '';
    else if (st) this.$.own.innerHTML = d.noClip ? `You carry <b>${st.reserve}</b> (max ${d.maxReserve})` : `Ammo <b>${st.clip}</b> / ${st.reserve} <span class="dim">(max reserve ${d.maxReserve})</span>`;
    else this.$.own.textContent = 'Not owned';
    this._renderButtons();
  }

  _renderButtons() {
    const d = this.item, w = this.weapons, st = w.owned.get(d.id), gl = this._glyphs(), cash = this.game.economy.cash;
    const buy = this.$.buy, ammo = this.$.ammo;
    let buyTxt, buyOff = false;
    if (d.kind === 'item') { const p = this.game.player; buyTxt = `Use Med Kit &nbsp;${money(d.price)}`; buyOff = !p || p.hp >= p.maxHp || cash < d.price; }
    else if (d.consumable) { buyTxt = `Buy ${d.ammoPack} &nbsp;${money(d.price)}`; buyOff = cash < d.price || (st && st.reserve >= d.maxReserve); }
    else if (st) { buyTxt = w.equipped === d ? 'Equipped' : 'Equip'; }
    else { buyTxt = `Buy &nbsp;${money(d.price)}`; buyOff = cash < d.price; }
    buy.innerHTML = `${gl.buy}<span>${buyTxt}</span>`;
    buy.classList.toggle('off', !!buyOff);
    if (d.kind === 'item' || d.consumable) { ammo.classList.add('hidden'); }
    else {
      ammo.classList.remove('hidden');
      const full = st && st.reserve >= d.maxReserve;
      ammo.innerHTML = `${gl.ammo}<span>Ammo +${d.ammoPack} &nbsp;${money(d.ammoPrice)}</span>`;
      ammo.classList.toggle('off', !st || full || cash < d.ammoPrice);
    }
  }

  _say(text, bad = false) {
    const m = this.$.msg; m.textContent = text; m.className = 'ws-msg show' + (bad ? ' bad' : '');
    m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
    clearTimeout(this._mt); this._mt = setTimeout(() => m.classList.remove('show'), 2200);
  }

  _buy() {
    const d = this.item, r = this.weapons.purchase(d);
    this._result(r);
  }
  _buyAmmo() {
    const d = this.item;
    if (d.kind === 'item' || d.consumable) return;
    this._result(this.weapons.purchaseAmmo(d));
  }
  _result(r) {
    const a = this.game.audio;
    if (r.ok) { a?.play?.('pickup'); this.rows[this.sel].classList.remove('flash'); void this.rows[this.sel].offsetWidth; this.rows[this.sel].classList.add('flash'); this.game.input.rumble(0.3, 0.3, 80); }
    else a?.play?.('empty');
    this._say(r.msg, !r.ok);
    this._refresh();
  }

  // ------------------------------------------------------------------ per-frame (rawDt)
  update(dt) {
    if (this.closed) return false;
    this.age += dt;
    const inp = this.game.input, keys = inp.keys;
    this._renderFoot();

    // edge helper for keys / pad buttons
    const edge = (name, down) => { const was = this._prev[name]; this._prev[name] = down; return down && !was; };
    const k = (...c) => c.some((x) => keys.has(x));
    const pb = (i) => inp.padButton(i);

    // vertical navigation with repeat
    const my = inp.move.y;
    const dir = my > 0.55 || pb(12) ? -1 : my < -0.55 || pb(13) ? 1 : 0; // up = previous row
    if (dir === 0) { this._dirHeld = 0; this._repeat = 0; }
    else {
      if (this._dirHeld !== dir) { this._dirHeld = dir; this._repeat = 0.38; this._select(this.sel + dir); }
      else { this._repeat -= dt; if (this._repeat <= 0) { this._repeat = 0.11; this._select(this.sel + dir); } }
    }

    const buyP = edge('buy', k('Enter', 'NumpadEnter', 'Space') || pb(0));
    const ammoP = edge('ammo', k('KeyE', 'KeyR') || pb(5) || pb(2));
    const closeP = edge('close', k('Escape', 'KeyC', 'KeyP', 'Backspace') || pb(1) || pb(9));
    if (this.age > 0.2) {
      if (buyP) this._buy();
      if (ammoP) this._buyAmmo();
      if (closeP) { this.game.audio?.play?.('ui_back'); this.closed = true; }
    }
    if (this._cashSig !== this.game.economy.cash) { this._cashSig = this.game.economy.cash; this._refresh(); }
    return !this.closed;
  }

  close() { this.closed = true; }

  onClose() {
    this.root.classList.remove('on');
    const r = this.root; setTimeout(() => r.remove(), 220);
  }
}

function p0(g) { return g.player; }
