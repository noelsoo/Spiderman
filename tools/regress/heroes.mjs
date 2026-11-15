// Heroes: every action of every hero, tapped, held and used in the air next to a group of goons.
// Catches abilities that throw, produce NaN positions, never deal damage, or leave broken ability hints.
const HEROES = ['spiderman', 'ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet', 'venom', 'carnage', 'antivenom'];
const KEYS = ['KeyJ', 'KeyK', 'KeyE', 'KeyR', 'KeyC', 'ShiftLeft', 'KeyQ'];

export const heroes = HEROES.map((hero) => ({
  name: `hero-abilities-${hero}`,
  async run(c) {
    const r = await c.ev(({ hero, KEYS }) => {
      const qa = window.qa, g = window.game, bad = [], thrown = [];
      const { spot, restore } = qa.arena(hero);
      const p = g.player;
      p.maxHp = p.hp = 99999;
      g.enemies.running = false;
      const ring = () => {
        const out = [];
        for (let i = 0; i < 5; i++) {
          const a = spot.yaw + (i - 2) * 0.35, d = 4 + (i % 2) * 2;
          out.push(g.enemies.spawn('goon', p.pos.clone().add({ x: Math.sin(a) * d, y: 0, z: Math.cos(a) * d }), {}));
        }
        for (const e of out) { e.maxHp = e.hp = 5000; }
        return out;
      };
      let foes = ring();
      const hpSum = () => foes.reduce((s, e) => s + Math.max(0, e.hp), 0);
      const start = hpSum();
      const safe = (label, fn) => { try { fn(); } catch (e) { thrown.push(`${label}: ${String(e && e.stack || e).split('\n').slice(0, 2).join(' @ ').slice(0, 260)}`); } };
      const settle = () => { g.input.keys.clear(); g.input.mouseButtons.clear(); safe('settle', () => qa.step(50)); };
      const hints = () => safe('abilityHints', () => {
        const h = g.player.abilityHints;
        if (!Array.isArray(h) || !h.length) bad.push('abilityHints empty');
        else for (const x of h) if (typeof x.label !== 'string' || !x.label || !(x.cooldown === undefined || Number.isFinite(x.cooldown))) bad.push('bad hint ' + JSON.stringify(x).slice(0, 120));
      });
      for (const k of KEYS) {
        p.focus = 100; p.hp = p.maxHp;
        if (foes.filter((e) => e.alive).length < 3) foes = ring();
        safe(`tap ${k}`, () => qa.press(k, 3)); hints(); settle();
        safe(`hold ${k}`, () => { qa.hold(k); qa.step(55); qa.release(k); }); hints(); settle();
        safe(`air ${k}`, () => { qa.hold('Space'); qa.step(14); qa.release('Space'); qa.step(6); qa.press(k, 3); }); settle();
        safe(`air hold ${k}`, () => { qa.hold('Space'); qa.step(14); qa.release('Space'); qa.step(6); qa.hold(k); qa.step(40); qa.release(k); }); settle();
        safe(`move+${k}`, () => { qa.hold('KeyW'); qa.step(10); qa.press(k, 3); qa.release('KeyW'); }); settle();
        if (!qa.finite(g.player.pos) || !qa.finite(g.player.vel)) { bad.push(`NaN after ${k}`); break; }
        if (g.state !== 'playing') { bad.push(`state ${g.state} after ${k}`); break; }
      }
      // mash the basic attack to make sure plain combat lands
      safe('mash', () => { for (let i = 0; i < 40; i++) { qa.press('KeyJ', 2); qa.step(8); } });
      const dealt = Math.round(start - hpSum());
      for (const e of g.enemies.list) if (!qa.finite(e.pos)) { bad.push('NaN enemy'); break; }
      if (g.player.id !== hero) bad.push(`ended as ${g.player.id}`);
      restore();
      safe('deactivate', () => { qa.begin(hero === 'spiderman' ? 'ironman' : 'spiderman'); qa.step(30); });
      return { bad, thrown: [...new Set(thrown)], dealt, errs: qa.errors.slice(0, 4) };
    }, { hero, KEYS });
    c.assert(!r.thrown.length, 'threw: ' + r.thrown.slice(0, 4).join(' | '));
    c.assert(!r.bad.length, r.bad.slice(0, 4).join('; '));
    c.assert(r.dealt > 0, 'no damage dealt to nearby goons by any ability');
    return `damage ${r.dealt}`;
  },
}));
