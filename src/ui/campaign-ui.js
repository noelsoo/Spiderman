// Campaign UI, installed onto the HUD class (see hud.js): title-adjacent screens (chapter list, hero select),
// mission complete / failed screens, subtitle bar, letterbox, banner, defend/van bar, mission timer, fade.
// Everything navigable with keyboard, mouse and gamepad through the HUD's item system (_item / _focus / _activate / _nav).
import './campaign.css';

export function installCampaignUI(HUD, H) {
  const { ORDER, HERO_INFO, EMBLEM, esc, fmtTime, cssColor } = H;
  const P = HUD.prototype;
  const stars = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(max - n);

  // ------------------------------------------------------------------ in-game layer
  P._buildCampaignLayer = function () {
    const el = document.createElement('div');
    el.className = 'cine';
    el.innerHTML = `
      <div class="lb top"></div><div class="lb bot"></div>
      <div class="banner" data-r="banner"><small data-r="bankick"></small><h2 data-r="bantitle"></h2></div>
      <div class="mtimer" data-r="mtimer"></div>
      <div class="ally" data-r="ally"><div class="nm" data-r="allynm"></div><div class="bar"><b data-r="allybar"></b></div></div>
      <div class="subs" data-r="subs"><b data-r="subwho"></b><span data-r="subtx"></span></div>
      <div class="skiph" data-r="skiph"></div>
      <div class="fade" data-r="fade"></div>`;
    this.$.screens.before(el);
    this.cine = el;
    el.querySelectorAll('[data-r]').forEach((n) => { this.$[n.dataset.r] = n; });
    this.$.skiph.addEventListener('click', () => this.game.campaign?.skipCutscene?.());
  };

  P.setObjectiveTag = function (text) {
    const k = this.$.obj?.querySelector('.k');
    if (k) k.textContent = (text || 'OBJECTIVE').toUpperCase();
  };

  P.showSubtitle = function (who, text, color = '#fff') {
    this.$.subwho.textContent = who || '';
    this.$.subwho.style.color = color;
    this.$.subtx.textContent = text || '';
    this.$.subs.style.setProperty('--sc', color);
    this.$.subs.classList.add('on');
  };
  P.hideSubtitle = function () { this.$.subs?.classList.remove('on'); };

  P.setLetterbox = function (on) {
    this.cine.classList.toggle('lbox', !!on);
    const h = this.$.skiph;
    if (on) h.innerHTML = `${this._glyph(this._usePad() ? 'jump' : 'interact')} <span>${this._usePad() ? '' : 'or ENTER '}Skip</span>`;
    h.classList.toggle('on', !!on);
  };

  P.showBanner = function (kick, title, ms = 3000) {
    this.$.bankick.textContent = kick || '';
    this.$.bantitle.textContent = title || '';
    const b = this.$.banner;
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    clearTimeout(this._banT);
    this._banT = setTimeout(() => b.classList.remove('on'), ms);
  };

  P.setTimer = function (text) {
    const t = this.$.mtimer;
    if (!t) return;
    t.textContent = text || '';
    t.classList.toggle('on', !!text);
  };

  P.setAllyBar = function (label, frac = 1, color = '#66d0ff') {
    const a = this.$.ally;
    if (!a) return;
    if (!label) { a.classList.remove('on'); return; }
    a.classList.add('on');
    if (this.$.allynm.textContent !== label) this.$.allynm.textContent = label;
    a.style.setProperty('--ac', color);
    this.$.allybar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    a.classList.toggle('low', frac < 0.3);
  };

  P.setFade = function (a) { if (this.$.fade) this.$.fade.style.opacity = String(a); };

  // ------------------------------------------------------------------ flow helpers
  P.openCampaignMenu = function () {
    this.stack = ['title'];
    this._open('campaign');
  };

  /** Back to the chapter list from a running or finished mission. */
  P.abandonMission = function () {
    const g = this.game;
    if (g.campaign?.active) this._campSel = g.campaign.active.id;
    this.hideMenus();
    g.audio?.duck?.(false); g.audio?.engine?.(false); g.audio?.siren?.(false);
    g.campaign?.stop?.();
    for (const h of Object.values(g.heroes || {})) h.deactivate?.();
    g.enemies?.reset?.();
    g.state = 'menu';
    this.maxCombo = 0;
    this.stack = ['title'];
    this._open('campaign');
    g.audio?.music?.('roam');
  };

  P._startFromSelect = function (heroId, data) {
    const g = this.game;
    g.audio?.unlock?.();
    this.lastHero = heroId;
    if (data?.mode === 'browse') { this.heroSel = heroId; this.toast(`${HERO_INFO[heroId].name} selected as your favourite`); this._back(); return; }
    this._launch(() => {
      if (data?.mode === 'campaign') g.beginMission(data.missionId, heroId);
      else g.begin(heroId);
    });
  };

  // ------------------------------------------------------------------ chapter list
  P._build_campaign = function (scr) {
    const g = this.game, C = g.campaign, ms = C.missions;
    scr.el.innerHTML = `<div class="camp">
      <div class="camp-h"><h2>${esc(C.meta.title)}</h2><div class="camp-sub"><span data-r="cstars"></span></div></div>
      <div class="camp-b"><div class="camp-list" data-r="clist"></div><div class="camp-det" data-r="cdet"></div></div>
      <div class="camp-f"></div></div>`;
    const q = (n) => scr.el.querySelector(`[data-r="${n}"]`);
    q('cstars').textContent = `${C.totalStars} / ${ms.length * 3} stars  ·  $${(C.progress.cash || 0).toLocaleString('en-US')} earned`;
    const list = q('clist'), det = q('cdet');
    const paint = (m) => {
      const locked = !C.isUnlocked(m.id), d = C.progress.done[m.id], rec = m.recommended;
      const rinfo = HERO_INFO[rec.hero];
      det.style.setProperty('--vc', m.villain.color);
      if (locked) {
        const prev = ms[m.id - 1];
        det.innerHTML = `<div class="kick">${esc(m.chapter)}</div><h3>Locked</h3><p class="brief">Complete <b>${esc(prev?.title ?? 'the previous mission')}</b> to unlock this mission.</p>`;
        return;
      }
      det.innerHTML = `<div class="kick">${esc(m.chapter)}</div><h3>${esc(m.title)}</h3>
        <div class="vill"><i class="vp" style="--vc:${m.villain.color}">${esc(m.villain.name[0])}</i><div><small>VILLAIN</small><b>${esc(m.villain.name)}</b></div></div>
        <p class="brief">${esc(m.briefing)}</p>
        <div class="rec" style="--c:${rinfo.color}"><i class="pt">${EMBLEM[rec.hero]}</i><div><small>RECOMMENDED (OPTIONAL)</small><b>${esc(rinfo.name)}</b><span>${esc(rec.why)}</span></div></div>
        <div class="facts"><div><b>$${m.reward.toLocaleString('en-US')}</b><span>Reward</span></div><div><b>${fmtTime(m.par)}</b><span>Par time</span></div><div><b>${d ? fmtTime(d.best) : '--'}</b><span>Best</span></div><div><b class="gold">${stars(d?.stars ?? 0)}</b><span>Rating</span></div></div>`;
    };
    for (const m of ms) {
      const locked = !C.isUnlocked(m.id), d = C.progress.done[m.id];
      const row = document.createElement('div');
      row.className = `mrow${locked ? ' locked' : ''}${d ? ' done' : ''}`;
      row.style.setProperty('--vc', m.villain.color);
      row.innerHTML = `<i class="n">${m.num ?? m.id}</i><div class="mt"><b>${esc(locked ? m.chapter : m.title)}</b><small>${esc(locked ? 'Locked' : m.villain.name)}</small></div><span class="ms">${locked ? 'LOCKED' : stars(d?.stars ?? 0)}</span>`;
      list.appendChild(row);
      const it = this._item(scr, row, {
        act: () => {
          if (locked) { this.toast(`Complete "${ms[m.id - 1].title}" first`); g.audio?.play('ui_back'); return; }
          this._campSel = m.id;
          this._push('heroselect', { mode: 'campaign', missionId: m.id });
        },
        onFocus: () => { paint(m); this._campSel = m.id; },
      });
    }
    const f = scr.el.querySelector('.camp-f');
    f.appendChild(this._btn(scr, 'Back', () => this._back()));
    // the other city's campaign lives on the other map: offer the switch (the game reloads)
    const other = C.sg ? { map: 'nyc', label: 'Switch to New York' } : { map: 'singapore', label: 'Switch to Singapore' };
    f.appendChild(this._btn(scr, other.label, () => { try { sessionStorage.setItem('sm-open', 'campaign'); } catch { /* ignore */ } g.switchMap(other.map); }));
    // first unlocked-but-unfinished mission, or the remembered one
    let start = this._campSel;
    if (start === undefined || start === null) {
      start = Math.min(C.progress.unlocked, ms.length - 1);
    }
    scr.index = Math.max(0, Math.min(ms.length - 1, start));
    scr.nav = (dir) => {
      if (dir === 'left' || dir === 'right') return true;
      return false;
    };
  };

  // ------------------------------------------------------------------ map choice (maps load at boot: switching reloads the page)
  const SKY = {
    nyc: '<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMax slice"><defs><linearGradient id="mn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2a66"/><stop offset="1" stop-color="#e8683a"/></linearGradient></defs><rect width="240" height="110" fill="url(#mn)"/><g fill="#0a0d1f"><rect x="6" y="52" width="22" height="58"/><rect x="30" y="34" width="18" height="76"/><rect x="50" y="62" width="26" height="48"/><path d="M82 110V40l8-22 8 22v70z"/><rect x="100" y="56" width="22" height="54"/><rect x="124" y="42" width="20" height="68"/><rect x="146" y="64" width="24" height="46"/><path d="M172 110V50h18V28h6v22h18v60z"/><rect x="214" y="58" width="22" height="52"/></g><g fill="#ffd98a" opacity=".7"><rect x="34" y="42" width="3" height="3"/><rect x="40" y="56" width="3" height="3"/><rect x="128" y="52" width="3" height="3"/><rect x="134" y="66" width="3" height="3"/><rect x="104" y="66" width="3" height="3"/><rect x="178" y="62" width="3" height="3"/><rect x="200" y="74" width="3" height="3"/><rect x="10" y="64" width="3" height="3"/></g></svg>',
    singapore: '<svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMax slice"><defs><linearGradient id="ms" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d3b5c"/><stop offset="1" stop-color="#2fb6a6"/></linearGradient></defs><rect width="240" height="110" fill="url(#ms)"/><g fill="#06141f"><path d="M40 110L52 30l12 80zM66 110L78 30l12 80zM92 110L104 30l12 80z" transform="translate(10 8)"/><rect x="40" y="26" width="86" height="8" rx="4" transform="translate(10 6)"/><path d="M158 110V62q10-24 20 0v48zM182 110V54q12-26 24 0v56z"/><rect x="0" y="96" width="240" height="14" fill="#0a2a3d"/></g><g fill="#ffd98a" opacity=".6"><rect x="164" y="76" width="3" height="3"/><rect x="190" y="70" width="3" height="3"/><rect x="198" y="84" width="3" height="3"/></g></svg>',
  };
  P._build_mapselect = function (scr) {
    const g = this.game, cur = g.world?.id === 'singapore' ? 'singapore' : 'nyc';
    scr.el.innerHTML = `<div class="msel"><h2>Free Roam</h2>
      <div class="hsub">Choose a map. Switching maps reloads the game.</div>
      <div class="mgrid"></div><div class="btnrow"></div></div>`;
    const grid = scr.el.querySelector('.mgrid');
    const defs = [
      { map: 'nyc', name: 'New York', sub: 'Manhattan', c: '#e8683a', txt: 'Skyscraper canyons, avenues and rooftops: classic web-swinging.' },
      { map: 'singapore', name: 'Singapore \u2013 Marina Bay', sub: 'Marina Bay', c: '#2fb6a6', txt: 'Waterfront towers, gardens and a glittering bay.' },
    ];
    for (const d of defs) {
      const here = d.map === cur;
      const c = document.createElement('div');
      c.className = 'mcard';
      c.style.setProperty('--c', d.c);
      c.innerHTML = `<div class="art">${SKY[d.map]}${here ? '<em class="cur">CURRENT</em>' : ''}</div>
        <div class="mi"><small>${esc(d.sub)}</small><h3>${esc(d.name)}</h3><p>${esc(d.txt)}</p><span class="go">${here ? 'Select hero' : 'Load map'}</span></div>`;
      grid.appendChild(c);
      this._item(scr, c, { act: () => { if (here) this._push('heroselect', { mode: 'freeroam' }); else g.switchMap(d.map, true); } });
    }
    scr.el.querySelector('.btnrow').appendChild(this._btn(scr, 'Back', () => this._back()));
    scr.index = cur === 'singapore' ? 1 : 0;
    scr.nav = (dir) => {
      const i = scr.index;
      if (dir === 'left' || dir === 'right') { if (i < 2) this._focus(i === 0 ? 1 : 0); return true; }
      if (dir === 'down') { if (i < 2) this._focus(2); return true; }
      if (dir === 'up') { if (i === 2) this._focus(cur === 'singapore' ? 1 : 0); return true; }
      return false;
    };
  };

  /** Legacy screen name: every map has a campaign now, so it is the chapter list for the current map. */
  P._build_campaignmap = function (scr) { return this._build_campaign(scr); };

  // ------------------------------------------------------------------ hero select
  // power / mobility / ranged / toughness, 1-5 (summary only, not gameplay values)
  const STATS = {
    spiderman: [3, 5, 3, 3, 'Agile web-slinger'], ironman: [4, 4, 5, 4, 'Armoured flyer'], hulk: [5, 3, 1, 5, 'Unstoppable brawler'],
    thor: [5, 4, 4, 4, 'God of thunder'], wolverine: [4, 3, 1, 4, 'Feral healer'], captain: [3, 3, 3, 4, 'Super-soldier'],
    hawkeye: [2, 3, 5, 2, 'Master marksman'], scarlet: [4, 3, 4, 3, 'Reality warper'], venom: [5, 4, 2, 4, 'Symbiote predator'],
    carnage: [5, 4, 2, 3, 'Chaos incarnate'], antivenom: [4, 3, 3, 5, 'Cleansing guardian'],
  };
  const STAT_LABELS = ['Power', 'Mobility', 'Ranged', 'Toughness'];
  P._build_heroselect = function (scr) {
    const g = this.game, data = scr.data || { mode: 'freeroam' };
    const camp = data.mode === 'campaign' ? g.campaign.missions[data.missionId] : null;
    const browse = data.mode === 'browse';
    const rec = camp?.recommended?.hero;
    scr.el.innerHTML = `<div class="hsel"><h2>${camp ? esc(camp.title) : browse ? 'Heroes' : 'Free Roam'}</h2>
      <div class="hsub">${camp ? `Choose your hero${rec ? ` &middot; recommended: <b>${esc(HERO_INFO[rec].name)}</b> (optional, any hero can win)` : ''}` : browse ? 'Browse the roster. Select a hero to make them your favourite.' : 'Choose your hero. Switch any time with the character wheel.'}</div>
      <div class="hbody"><div class="hgrid"></div><div class="hdet" data-r="hdet"></div></div>
      <div class="note">${camp ? 'You can switch heroes at any time during the mission.' : ''}</div>
      <div class="btnrow"></div></div>`;
    const grid = scr.el.querySelector('.hgrid'), det = scr.el.querySelector('[data-r="hdet"]');
    const paint = (id) => {
      const info = HERO_INFO[id], st = STATS[id] || [3, 3, 3, 3, ''];
      det.style.setProperty('--c', info.color);
      det.innerHTML = `<div class="hd-top"><i class="pt">${EMBLEM[id]}</i><div><small>${esc(st[4])}</small><h3>${esc(g.heroes?.[id]?.name || info.name)}</h3></div></div>
        <div class="hd-stats">${STAT_LABELS.map((l, k) => `<div><span>${l}</span><b>${[0, 1, 2, 3, 4].map((n) => `<i class="${n < st[k] ? 'on' : ''}"></i>`).join('')}</b></div>`).join('')}</div>
        <ul>${info.powers.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
    };
    ORDER.forEach((id, i) => {
      const info = HERO_INFO[id], h = g.heroes?.[id];
      const c = document.createElement('div');
      c.className = 'card'; c.dataset.id = id;
      c.style.setProperty('--c', info.color || cssColor(h?.color, '#fff'));
      c.innerHTML = `${id === rec ? '<em class="recb">RECOMMENDED</em>' : ''}<div class="pt">${EMBLEM[id]}</div><div class="ct"><h3>${esc(h?.name || info.name)}</h3><ul>${info.powers.slice(0, 3).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
      grid.appendChild(c);
      this._item(scr, c, { act: () => this._startFromSelect(id, data), onFocus: () => paint(id) });
    });
    scr.el.querySelector('.btnrow').appendChild(this._btn(scr, 'Back', () => this._back()));
    const idx = ORDER.indexOf(this.lastHero || 'spiderman');
    scr.index = idx >= 0 ? idx : 0;
    const N = ORDER.length;
    scr.nav = (dir) => {
      const COLS = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length), ROWS = Math.ceil(N / COLS);
      const i = scr.index;
      if (i === N) { // back button: up returns to the last row, same column (clamped)
        if (dir === 'up') this._focus(Math.min(N - 1, (ROWS - 1) * COLS + (this._hcol ?? 0)));
        return true;
      }
      const col = i % COLS, row = (i / COLS) | 0;
      this._hcol = col;
      const rowLen = (r) => Math.min(COLS, N - r * COLS);
      if (dir === 'left') this._focus(row * COLS + (col + rowLen(row) - 1) % rowLen(row));
      else if (dir === 'right') this._focus(row * COLS + (col + 1) % rowLen(row));
      else if (dir === 'up') { if (row > 0) this._focus(i - COLS); else this._focus(N); }
      else if (dir === 'down') { if (row < ROWS - 1) this._focus(Math.min(N - 1, i + COLS)); else this._focus(N); }
      return true;
    };
  };

  // ------------------------------------------------------------------ mission complete / failed
  P.showMissionComplete = function (res) {
    this.stack = [];
    this.$.boss.classList.remove('on');
    this.game.audio?.engine?.(false); this.game.audio?.siren?.(false);
    this._open('missionwin', res);
  };
  P.showMissionFailed = function (info) {
    this.stack = [];
    this.$.boss.classList.remove('on');
    this.game.audio?.engine?.(false); this.game.audio?.siren?.(false);
    this._open('missionfail', info);
  };

  P._build_missionwin = function (scr) {
    const g = this.game, r = scr.data;
    scr.el.innerHTML = `<div class="panel mres" style="--vc:${r.mission.villain.color}">
      <div class="kick">${r.finale ? 'CAMPAIGN COMPLETE' : 'MISSION COMPLETE'}</div>
      <h2 class="win">${esc(r.mission.title)}</h2>
      <div class="mstars">${[0, 1, 2].map((i) => `<i class="${i < r.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.28}s">★</i>`).join('')}</div>
      <ul class="flags">${r.flags.map((f) => `<li class="${f.ok ? 'ok' : 'no'}"><b>${f.ok ? '✓' : '✗'}</b>${esc(f.label)}</li>`).join('')}</ul>
      <div class="stats"><div><b>${fmtTime(r.time)}</b><span>Time</span></div><div><b>$${r.cash.toLocaleString('en-US')}</b><span>Cash</span></div><div><b>${r.kills}</b><span>Takedowns</span></div><div><b>${r.damage}</b><span>Damage taken</span></div></div>
      <div class="note">${r.newBest ? 'New best time! ' : ''}${r.replay ? 'Replay reward is halved. ' : ''}${r.next ? `Unlocked: ${esc(r.next.title)}` : esc(g.campaign.meta.finale)}</div>
      <div class="menu mm" style="margin:0 auto"></div></div>`;
    const menu = scr.el.querySelector('.menu');
    const add = (l, a) => menu.appendChild(this._btn(scr, l, a));
    if (r.next) add('Next Mission', () => { this.hideMenus(); g.beginMission(r.next.id, g.player?.id || this.lastHero || 'spiderman'); });
    add('Replay', () => g.campaign.restart());
    add('Menu', () => { this._campSel = Math.min(r.mission.id + (r.next ? 1 : 0), g.campaign.missions.length - 1); this.abandonMission(); });
    scr.back = null;
  };

  P._build_missionfail = function (scr) {
    const g = this.game, d = scr.data;
    scr.el.innerHTML = `<div class="panel mres" style="text-align:center;--vc:${d.mission.villain.color}">
      <div class="kick">${esc(d.mission.title.toUpperCase())}</div>
      <h2 class="dead">Mission Failed</h2>
      <div class="note" style="font-size:15px">${esc(d.reason || 'All heroes are down')}</div>
      <div class="menu mm" style="margin:0 auto"></div></div>`;
    const menu = scr.el.querySelector('.menu');
    const add = (l, a) => menu.appendChild(this._btn(scr, l, a));
    if (d.hasCheckpoint) add('Retry Checkpoint', () => g.campaign.retryCheckpoint());
    add('Restart Mission', () => g.campaign.restart());
    add('Menu', () => { this._campSel = d.mission.id; this.abandonMission(); });
  };
}
