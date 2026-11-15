// Enemies: free roam waves, AI reaches the player, stuck relocation.
export const enemies = [
  {
    name: 'enemies-wave-reach',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, bad = [];
        qa.begin('spiderman');
        const spot = qa.roadSpot(); qa.put(spot.x, spot.z, spot.yaw);
        g.player.maxHp = g.player.hp = 99999; g.player.invuln = 0;
        qa.stepSec(8);
        let spawned = g.enemies.aliveCount();
        // the wave director should have spawned something within a minute
        let t = 0; while (t++ < 60 && g.enemies.aliveCount() === 0) qa.stepSec(1);
        spawned = g.enemies.aliveCount();
        if (!spawned) bad.push('no free-roam enemies after 70 s (phase ' + g.enemies.phase + ')');
        let closest = 1e9;
        qa.step(60 * 40, () => { for (const e of g.enemies.list) if (e.alive) closest = Math.min(closest, Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z)); });
        if (spawned && closest > 6) bad.push('enemies never reached the player in 40 s (closest ' + closest.toFixed(1) + ')');
        return { bad, spawned, closest: +closest.toFixed(1), phase: g.enemies.phase };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `spawned=${r.spawned} closest=${r.closest} phase=${r.phase}`;
    },
  },
  {
    name: 'enemies-ranged-shoot',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, bad = [];
        qa.begin('spiderman');
        const spot = qa.roadSpot(); qa.put(spot.x, spot.z, spot.yaw);
        g.player.maxHp = g.player.hp = 99999;
        g.enemies.running = true;
        const hp0 = g.player.hp;
        const hs = [];
        for (let i = 0; i < 3; i++) hs.push(g.enemies.spawn('hunter', g.player.pos.clone().add({ x: 12 + i * 2, y: 0, z: 6 }), {}));
        qa.stepSec(25);
        const hurt = hp0 - g.player.hp;
        if (!(hurt > 0)) bad.push('hunters dealt no damage in 25 s');
        for (const h of hs) if (!qa.finite(h.pos)) bad.push('NaN hunter');
        return { bad, hurt: Math.round(hurt) };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `damage dealt ${r.hurt}`;
    },
  },
  {
    name: 'enemies-stuck-relocate',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, bad = [];
        qa.begin('spiderman');
        const spot = qa.roadSpot(); qa.put(spot.x, spot.z, spot.yaw);
        g.player.maxHp = g.player.hp = 99999;
        const e = g.enemies.spawn('goon', g.player.pos.clone().add({ x: 80, y: 0, z: 80 }), {});
        e.update = () => {};            // wedged: never moves on its own
        const d0 = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z);
        qa.stepSec(26);
        const d1 = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z);
        if (!(d1 < d0 - 20)) bad.push(`stuck enemy not relocated: ${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
        return { bad, d0: Math.round(d0), d1: Math.round(d1) };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `${r.d0} m -> ${r.d1} m`;
    },
  },
];
