// Boot, heroes, switching, death, pause.
const HEROES = ['spiderman', 'ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet', 'venom', 'carnage', 'antivenom'];

export const core = [
  {
    name: 'boot',
    fresh: true,
    async run(c) {
      const r = await c.ev(() => {
        const g = window.game;
        return { state: g.state, map: g.world.id, heroes: Object.keys(g.heroes).length, title: !!document.querySelector('.screen, .title, #hud'), draw: g.renderer.info.render.calls };
      });
      c.assert(r.state === 'menu', `state ${r.state}`);
      c.assert(r.heroes === 11, `heroes ${r.heroes}`);
      c.assert(r.map === (c.map === 'singapore' ? 'singapore' : 'nyc'), `map ${r.map}`);
      // a few menu frames must not throw
      await c.ev(() => window.qa.step(30));
      return `map=${r.map}`;
    },
  },
  {
    name: 'csp',
    async run(c) {
      const r = await c.ev(() => {
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        window.qa.begin('spiderman'); window.qa.step(60);
        window.game.hud.showPause?.(); window.qa.step(5); window.game.resume();
        return { has: !!meta, viol: window.__csp };
      });
      c.assert(r.has, 'built page has no CSP meta (run npm run build first, not dev)');
      c.assert(!r.viol.length, 'CSP violations: ' + r.viol.slice(0, 4).join(' | '));
    },
  },
  {
    name: 'heroes-freeroam',
    async run(c) {
      const out = [];
      for (const h of HEROES) {
        const r = await c.ev((h) => {
          const qa = window.qa, g = window.game;
          qa.begin(h);
          qa.hold('KeyW');
          qa.stepSec(1.5, (i) => { if (i === 20) qa.press('Space'); if (i === 40) qa.press('KeyJ'); });
          qa.release();
          // abilities: tap each ability key once
          for (const k of ['KeyE', 'KeyK', 'KeyR', 'KeyQ', 'KeyC']) { g.player.focus = 100; qa.press(k, 3); qa.step(10); }
          qa.stepSec(1);
          const p = g.player;
          return { id: p.id, ok: qa.finite(p.pos) && qa.finite(p.vel), hp: p.hp, state: g.state, pos: p.pos.toArray().map((v) => +v.toFixed(1)) };
        }, h);
        c.assert(r.id === h, `${h}: player is ${r.id}`);
        c.assert(r.ok, `${h}: NaN position/velocity ${JSON.stringify(r.pos)}`);
        c.assert(r.state === 'playing', `${h}: state ${r.state}`);
        out.push(h);
      }
      return `${out.length} heroes`;
    },
  },
  {
    name: 'hero-switch',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game;
        qa.begin('spiderman');
        const log = [];
        const bad = [];
        const order = ['ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet', 'venom', 'carnage', 'antivenom', 'spiderman'];
        g.enemies.debugSpawn?.('goon', 4, 8);
        const check = (tag) => {
          for (const h of Object.values(g.heroes)) {
            if (!Number.isFinite(h.hp) || h.hp < 0 || h.hp > h.maxHp + 0.01) bad.push(`${tag}: ${h.id} hp ${h.hp}/${h.maxHp}`);
            if (!Number.isFinite(h.focus) || h.focus < 0 || h.focus > 100.01) bad.push(`${tag}: ${h.id} focus ${h.focus}`);
          }
          if (!qa.finite(g.player.pos)) bad.push(`${tag}: NaN pos`);
        };
        // quick switch via number keys / bracket
        for (let i = 0; i < order.length; i++) {
          qa.mouse(0, true); qa.step(8); qa.mouse(0, false);
          g.player.focus = 60 + i;
          const before = g.player.id;
          g._switchCd = 0;
          const ok = g.switchHero(order[i]);
          qa.step(20);
          check('switch ' + order[i]);
          if (ok && g.player.id !== order[i]) bad.push(`switch to ${order[i]} landed on ${g.player.id}`);
          log.push(g.player.id);
        }
        // cooldown bleed: switch rapidly during the 0.6 s lock, must not throw or change hero
        const now = g.player.id;
        g.switchHero('hulk'); const a = g.player.id; const again = g.switchHero('thor');
        if (again) bad.push('switch allowed during cooldown');
        qa.step(60);
        // keyboard: heroNext / Digit keys
        const k0 = g.player.id; qa.press('BracketRight', 3); qa.step(45);
        if (g.player.id === k0) bad.push('BracketRight did not cycle');
        const k1 = g.player.id; qa.press('Digit3', 3); qa.step(45);
        if (g.player.id !== 'hulk' && k1 !== 'hulk') bad.push('Digit3 did not select hero 3: ' + g.player.id);
        check('keys');
        // wheel: hold Tab, push right stick; then release
        qa.hold('Tab'); qa.step(30); const wheelOpen = g.hud._wheel?.open ?? g.hud.wheelOpen ?? null; qa.release('Tab'); qa.step(40); check('wheel');
        // active hero count: exactly one active
        const active = Object.values(g.heroes).filter((h) => h.active).length;
        if (active !== 1) bad.push(`${active} active heroes`);
        return { bad, log, wheelOpen, active };
      });
      c.assert(!r.bad.length, r.bad.slice(0, 5).join('; '));
      return `active=${r.active}`;
    },
  },
  {
    name: 'death-gameover-restart',
    async run(c) {
      await c.ev(() => {
        const qa = window.qa, g = window.game;
        qa.begin('spiderman');
        // kill every hero one by one through combat so onPlayerDown runs
        for (const h of Object.values(g.heroes)) { if (h.hp > 0 && h !== g.player) h.hp = 0; }
        g.player.invuln = 0;
        const hit = g.combat.damagePlayer(99999, null, null);
        qa.step(10);
        return { hit, hp: g.player.hp, dead: g.player.dead, id: g.player.id, state: g.state, alive: Object.values(g.heroes).filter((h) => h.hp > 0).map((h) => h.id) };
      }).then((d) => { c.note?.(JSON.stringify(d)); c._death = d; });
      for (let i = 0; i < 20; i++) { await c.wait(400); const st = await c.ev(() => { window.qa.step(20); return window.game.state; }); if (st === 'gameover') break; }
      const over = await c.ev(() => ({ state: window.game.state, scr: window.game.hud.screen?.name }));
      c.assert(over.state === 'gameover', `expected gameover, got ${over.state} ${JSON.stringify(c._death)}`);
      c.assert(over.scr === 'gameover', `expected gameover screen, got ${over.scr}`);
      const after = await c.ev(() => {
        const g = window.game, qa = window.qa;
        qa.step(60);   // frames must keep running on the game over screen
        // press the Retry button
        const btn = [...document.querySelectorAll('.btn')].find((b) => /retry/i.test(b.textContent));
        if (!btn) return { err: 'no retry button' };
        btn.click(); qa.step(10);
        const p = g.player;
        return { state: g.state, hp: p.hp, max: p.maxHp, others: Object.values(g.heroes).filter((h) => h !== p).map((h) => h.hp / h.maxHp), scr: g.hud.screen?.name ?? null };
      });
      c.assert(!after.err, after.err);
      c.assert(after.state === 'playing', `after retry state ${after.state}`);
      c.assert(after.hp === after.max && after.others.every((v) => v === 1), `hp not restored ${JSON.stringify(after)}`);
      c.assert(!after.scr, `menu still open: ${after.scr}`);
    },
  },
  {
    name: 'pause-resume',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game;
        qa.begin('ironman');
        qa.hold('KeyW'); qa.stepSec(1);
        const t0 = g.time; const p0 = g.player.pos.clone();
        qa.release();
        qa.press('Escape', 3); qa.step(5);
        const st = g.state, scr = g.hud.screen?.name;
        const tp = g.time; qa.step(120);
        const frozen = Math.abs(g.time - tp) < 1e-6;
        const mv = g.player.pos.distanceTo(p0);
        g.resume(); qa.step(5);
        const resumed = g.state;
        // double pause / resume safety
        g.resume(); g.pause(); g.pause(); g.resume(); qa.step(3);
        // blur / visibility: pause is triggered when document hidden
        return { st, scr, frozen, resumed, final: g.state, tAdv: g.time - tp };
      });
      c.assert(r.st === 'paused' && r.scr === 'pause', `pause state ${r.st}/${r.scr}`);
      c.assert(r.frozen, 'game time advanced while paused');
      c.assert(r.resumed === 'playing' && r.final === 'playing', `resume state ${r.resumed}/${r.final}`);
    },
  },
];
