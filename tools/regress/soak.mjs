// Soak: random inputs for N sim-minutes (default 10), watching errors, NaN positions and memory growth.
// --soak=<seconds> overrides the length; numbers are reported at 1, 5 and 10 sim minutes.
export const soak = [
  {
    name: 'soak',
    fresh: true,
    async run(c) {
      const total = Number(c.args.soak || 600);
      const marks = [60, 300, 600].filter((m) => m <= total); if (!marks.includes(total)) marks.push(total);
      const rows = [];
      let seed = 12345;
      for (let t = 0; t < total; t += 10) {
        const r = await c.ev(({ t, seed }) => {
          const qa = window.qa, g = window.game, bad = [];
          let s = seed + t * 7919;
          const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
          if (t === 0) { qa.begin('spiderman'); g.economy.add(8000, null, { silent: true }); window.__soakStart = performance.now(); }
          const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyJ', 'KeyK', 'KeyE', 'KeyR', 'KeyQ', 'KeyC', 'KeyF', 'KeyX', 'AltLeft'];
          const heroes = ['spiderman', 'ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet', 'venom', 'carnage', 'antivenom'];
          for (let sec = 0; sec < 10; sec++) {
            if (g.state === 'gameover') { g.hud.hideMenus(); qa.begin(heroes[(rnd() * 11) | 0]); }
            if (g.state === 'paused' || g.state === 'overlay') { g.state === 'paused' ? g.resume() : g.closeOverlay(); }
            const k = g.input.keys;
            k.clear();
            const n = 1 + ((rnd() * 4) | 0);
            for (let i = 0; i < n; i++) k.add(keys[(rnd() * keys.length) | 0]);
            if (rnd() < 0.7) k.add('KeyW');
            g.input.mouseButtons.clear();
            if (rnd() < 0.3) g.input.mouseButtons.add(rnd() < 0.5 ? 0 : 2);
            g.input.look.set(0, 0); g.input.mouseDX += (rnd() - 0.5) * 400; g.input.mouseDY += (rnd() - 0.5) * 60;
            const roll = rnd();
            if (roll < 0.08) { g._switchCd = 0; g.switchHero(heroes[(rnd() * 11) | 0]); }
            else if (roll < 0.14) { const d = g.weapons.catalog[(rnd() * 7) | 0]; if (d.kind !== 'item') g.weapons.purchase(d); }
            else if (roll < 0.2) { g.enemies.debugSpawn?.('goon', 3, 14); }
            else if (roll < 0.24) g.events.emit('crime', { severity: 1, pos: g.player.pos.clone(), kind: 'carjack' });
            else if (roll < 0.28) { const v = g.vehicles.list.find((v) => v.active && !v.reserve && !v.wrecked && v.dist < 12); if (v && !g.vehicles.driving) { g.player.pos.set(v.pos.x + 2.5, v.pos.y + 1, v.pos.z); } }
            // keep the hero alive and inside the world most of the time
            if (g.player && g.player.hp < 30 && rnd() < 0.7) g.player.hp = g.player.maxHp;
            qa.stepSec(1);
            const p = g.player;
            if (p && (!qa.finite(p.pos) || !qa.finite(p.vel))) bad.push(`NaN hero at t=${t + sec}: ${p.pos.toArray()}`);
            if (p && p.pos.y < -50) { bad.push(`hero fell out of the world y=${p.pos.y.toFixed(0)} at t=${t + sec}`); qa.put(0, 0, 0, 60); }
            for (const v of g.vehicles.list) if (v.active && !qa.finite(v.pos)) { bad.push('NaN car ' + v.kind); break; }
            for (const e of g.enemies.list) if (e.alive && !qa.finite(e.pos)) { bad.push('NaN enemy ' + e.kind); break; }
          }
          g.input.keys.clear(); g.input.mouseButtons.clear();
          return { bad, heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(0), hero: g.player.id, st: g.state };
        }, { t, seed });
        if (c.args.verbose) c.log(`t=${t + 10}s heap=${r.heap}MB hero=${r.hero} state=${r.st}`);
        c.assert(!r.bad.length, r.bad.slice(0, 3).join('; '));
        const simT = t + 10;
        if (marks.includes(simT)) {
          // one real render so renderer.info reflects what is uploaded, then GC + measure
          const m = await c.ev(async () => {
            const g = window.game, qa = window.qa;
            qa.renderOnce();
            if (window.gc) { window.gc(); await new Promise((r) => setTimeout(r, 50)); window.gc(); }
            let objs = 0, meshes = 0, lights = 0; const geos = new Set(), mats = new Set();
            g.scene.traverse((o) => { objs++; if (o.isMesh || o.isPoints || o.isLine) { meshes++; geos.add(o.geometry); if (o.material) [].concat(o.material).forEach((x) => mats.add(x)); } if (o.isLight) lights++; });
            const mem = g.renderer.info.memory;
            return {
              heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
              geometries: mem.geometries, textures: mem.textures, programs: g.renderer.info.programs?.length ?? 0,
              sceneObjs: objs, meshes, sceneGeos: geos.size, sceneMats: mats.size, lights,
              listeners: [...g.events.map.values()].reduce((a, l) => a + l.size, 0),
              cars: g.vehicles.list.length, peds: g.peds.list?.length, enemies: g.enemies.list.length, state: g.state,
            };
          });
          m.simMin = simT / 60;
          rows.push(m);
          c.log(`t=${m.simMin}min`, JSON.stringify(m));
        }
      }
      const a = rows[0], z = rows[rows.length - 1], bad = [];
      if (rows.length > 1) {
        if (z.geometries > a.geometries * 1.25 + 40) bad.push(`geometries grew ${a.geometries} -> ${z.geometries}`);
        if (z.textures > a.textures * 1.25 + 20) bad.push(`textures grew ${a.textures} -> ${z.textures}`);
        if (z.sceneObjs > a.sceneObjs * 1.3 + 300) bad.push(`scene objects grew ${a.sceneObjs} -> ${z.sceneObjs}`);
        if (a.heapMB && z.heapMB > a.heapMB * 1.6 + 60) bad.push(`JS heap grew ${a.heapMB} -> ${z.heapMB} MB`);
      }
      c.assert(!bad.length, bad.join('; '));
      return rows.map((m) => `${m.simMin}m: heap ${m.heapMB}MB geo ${m.geometries} tex ${m.textures} objs ${m.sceneObjs}`).join(' | ');
    },
  },
];
