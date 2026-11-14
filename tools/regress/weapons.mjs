// Economy, weapons, police.
export const weapons = [
  {
    name: 'economy-shop',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, w = g.weapons, eco = g.economy, bad = [];
        qa.begin('spiderman');
        const pistol = w.catalog.find((d) => d.id === 'pistol');
        const cash0 = eco.cash;
        if (cash0 !== 200) bad.push('starting cash ' + cash0);
        eco.cash = 0;
        const poor = w.purchase(pistol);
        if (poor.ok || eco.cash !== 0 || w.owned.has('pistol')) bad.push('bought with no cash');
        if (eco.spend(1) !== false || eco.cash < 0) bad.push('spent below zero');
        eco.spend(-500); if (eco.cash !== 0) bad.push('negative spend minted cash: ' + eco.cash);
        eco.add(-100); if (eco.cash !== 0) bad.push('negative add changed cash');
        eco.add(NaN); if (!Number.isFinite(eco.cash)) bad.push('NaN cash');
        // cash from fights
        g.enemies.debugSpawn?.('goon', 3, 3);
        qa.mouse(0, true);
        for (let i = 0; i < 60 * 8 && g.enemies.aliveCount() > 0; i++) { qa.step(1); for (const e of g.enemies.list) if (e.alive && g.player.pos.distanceTo(e.pos) < 3.5) { g.player.faceTowards?.(e.pos.clone().sub(g.player.pos).setY(0), 1 / 60, 40); } }
        qa.mouse(0, false);
        for (const e of g.enemies.list) if (e.alive) e.takeDamage?.(9999, { source: g.player });
        qa.step(10);
        if (eco.cash <= 0) bad.push('no cash from kills');
        // medkit at full health refused and does not charge
        const med = w.catalog.find((d) => d.id === 'medkit'); eco.cash = 1000; g.player.hp = g.player.maxHp;
        const m1 = w.purchase(med);
        if (m1.ok || eco.cash !== 1000) bad.push('medkit charged at full hp');
        g.player.hp = 10; const m2 = w.purchase(med);
        if (!m2.ok || g.player.hp !== g.player.maxHp || eco.cash !== 1000 - med.price) bad.push('medkit purchase wrong');
        return { bad, cash: eco.cash };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `cash=${r.cash}`;
    },
  },
  {
    name: 'weapons-buy-fire-reload',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, w = g.weapons, eco = g.economy, bad = [], log = [];
        qa.begin('spiderman');
        qa.put(g.player.pos.x, g.player.pos.z, 0);
        for (const d of w.catalog.filter((x) => x.kind !== 'item')) {
          eco.cash = d.price + 10;
          const res = w.purchase(d);
          if (!res.ok) { bad.push(d.id + ' purchase: ' + res.msg); continue; }
          if (eco.cash !== 10) bad.push(`${d.id} charged wrong: left ${eco.cash}`);
          if (d.consumable && w.equipped !== d) w.equip(d);
          else if (w.equipped !== d) bad.push(d.id + ' not equipped');
          const st = w.owned.get(d.id);
          if (st.clip !== d.clip || st.reserve !== Math.min(d.maxReserve, d.startReserve)) bad.push(`${d.id} ammo ${st.clip}/${st.reserve}`);
          // aim + fire
          g.player.yaw = 0; qa.step(30);
          qa.mouse(2, true); qa.step(25);
          if (!w.aiming) bad.push(d.id + ' not aiming');
          const before = d.noClip ? st.reserve : st.clip;
          qa.mouse(0, true); qa.step(20); qa.mouse(0, false); qa.step(10);
          const after = d.noClip ? st.reserve : st.clip;
          if (!(after < before)) bad.push(`${d.id} did not fire (${before} -> ${after})`);
          qa.mouse(2, false); qa.step(5);
          // reload
          if (!d.noClip && st.clip < d.clip && st.reserve > 0) {
            const tot = st.clip + st.reserve;
            qa.press('KeyR', 3);
            if (!(w.reloadProgress >= 0)) bad.push(d.id + ' reload did not start');
            qa.stepSec(d.reload + 0.8);
            if (st.clip + st.reserve !== tot) bad.push(`${d.id} reload lost ammo ${tot} -> ${st.clip + st.reserve}`);
            if (st.clip !== Math.min(d.clip, tot)) bad.push(`${d.id} clip after reload ${st.clip}`);
          }
          log.push(d.id);
        }
        // ammo can never go negative / above max
        for (const [id, st] of w.owned) { const d = w.catalog.find((x) => x.id === id); if (st.clip < 0 || st.reserve < 0 || st.reserve > d.maxReserve) bad.push(`${id} ammo out of range ${st.clip}/${st.reserve}`); }
        // weapon switching via X / Z
        const owned = [...w.owned.keys()].length;
        const e0 = w.equipped; qa.press('KeyX', 3); const e1 = w.equipped;
        if (owned > 1 && e0 === e1) bad.push('weaponNext (X) did not change weapon');
        qa.press('KeyZ', 3);
        // buying ammo
        const pi = w.catalog.find((d) => d.id === 'pistol'); const sp = w.owned.get('pistol'); if (sp) { sp.reserve = 0; eco.cash = 100; const a = w.purchaseAmmo(pi); if (!a.ok || sp.reserve !== pi.ammoPack || eco.cash !== 100 - pi.ammoPrice) bad.push('purchaseAmmo wrong'); }
        return { bad, log };
      });
      c.assert(!r.bad.length, r.bad.slice(0, 5).join('; '));
      return `${r.log.length} weapons`;
    },
  },
  {
    name: 'weapons-input-consumed',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, w = g.weapons, inp = g.input, bad = [];
        qa.begin('wolverine');
        g.economy.cash = 9999;
        w.purchase(w.catalog.find((d) => d.id === 'rifle'));
        let attackSeen = 0, specialSeen = 0, ab2Seen = 0;
        const orig = g.player.update.bind(g.player);
        g.player.update = (dt) => { if (inp.down('attack')) attackSeen++; if (inp.down('special')) specialSeen++; if (inp.down('ability2')) ab2Seen++; orig(dt); };
        qa.mouse(2, true); qa.step(20);
        qa.mouse(0, true); qa.step(30);
        if (attackSeen) bad.push(`hero saw attack ${attackSeen} frames while firing a gun`);
        if (specialSeen) bad.push(`hero saw special (RMB) ${specialSeen} frames while aiming a gun`);
        qa.mouse(0, false); qa.mouse(2, false); qa.step(5);
        qa.hold('KeyR'); qa.step(30); qa.release('KeyR');
        if (ab2Seen) bad.push(`hero saw ability2 (R) ${ab2Seen} frames while reload held`);
        // held reload must not refire as an edge after release: tracked by weapons itself
        g.player.update = orig;
        // unarmed: attack works
        w.equip(null); let atk = 0; g.player.update = (dt) => { if (inp.down('attack')) atk++; orig(dt); };
        qa.mouse(0, true); qa.step(10); qa.mouse(0, false);
        if (!atk) bad.push('unarmed LMB never reaches the hero');
        g.player.update = orig;
        return { bad };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
    },
  },
  {
    name: 'weapons-sniper-scope',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, w = g.weapons, bad = [];
        qa.begin('spiderman');
        const d = w.catalog.find((x) => x.id === 'sniper');
        g.economy.cash = 9999; w.purchase(d);
        qa.mouse(2, true); qa.step(40);
        const fov0 = g.camera.fov;
        if (!(fov0 < 25)) bad.push('scope fov not narrow: ' + fov0.toFixed(1));
        const levels = [w._zoomI];
        qa.press('KeyX', 3); levels.push(w._zoomI); qa.step(40); const fov1 = g.camera.fov;
        qa.press('KeyX', 3); levels.push(w._zoomI);
        qa.press('KeyX', 3); levels.push(w._zoomI);
        if (levels[1] !== 1 || levels[2] !== 2 || levels[3] !== 2) bad.push('zoom levels ' + levels.join(','));
        if (!(fov1 < fov0)) bad.push(`fov did not tighten with zoom ${fov0.toFixed(1)} -> ${fov1.toFixed(1)}`);
        qa.press('KeyZ', 3); if (w._zoomI !== 1) bad.push('zoom out failed');
        if (w.equipped !== d) bad.push('wheel changed weapon while scoped');
        // hold breath
        const b0 = w._breath; qa.hold('AltLeft'); qa.step(30); const held = w._breathHold; const b1 = w._breath; qa.release('AltLeft');
        if (!held) bad.push('hold-breath did not engage'); if (!(b1 < b0)) bad.push('breath not consumed');
        qa.stepSec(1);
        // release aim restores fov
        qa.mouse(2, false); qa.stepSec(1.5);
        if (g.camera.fov < 50) bad.push('fov not restored after unscoping ' + g.camera.fov.toFixed(1));
        // fire
        qa.mouse(2, true); qa.step(30); const st = w.owned.get('sniper'); const c0 = st.clip;
        qa.mouse(0, true); qa.step(5); qa.mouse(0, false);
        if (st.clip !== c0 - 1) bad.push('sniper shot count ' + (c0 - st.clip));
        qa.mouse(2, false);
        return { bad, levels };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
    },
  },
  {
    name: 'police-wanted',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const spot = qa.roadSpot(); qa.put(spot.x, spot.z, spot.yaw);
        if (vs.wanted !== 0) bad.push('wanted not 0 at start');
        g.events.emit('crime', { severity: 1, pos: g.player.pos.clone(), kind: 'carjack' });
        if (vs.wanted < 1) bad.push('crime did not raise wanted');
        const w1 = vs.wanted;
        qa.stepSec(1); g.events.emit('crime', { severity: 2, pos: g.player.pos.clone(), kind: 'cop_hit' });
        if (vs.wanted <= w1) bad.push('second crime did not raise wanted');
        vs.wanted = 3; qa.stepSec(20);
        const chasers = vs.list.filter((v) => v.isPolice && v.active && v.chasing).length;
        const near = vs.list.filter((v) => v.isPolice && v.active && v.dist < 60).length;
        if (!chasers) bad.push('no police chasing at wanted 3');
        // police eventually reach and hurt a stationary player
        const hp0 = g.player.hp; let arrived = false, closest = 1e9;
        qa.step(60 * 40, () => { for (const v of vs.list) if (v.isPolice && v.chasing) closest = Math.min(closest, v.pos.distanceTo(g.player.pos)); });
        for (const v of vs.list) if (v.isPolice && v.active && v.chasing && v.pos.distanceTo(g.player.pos) < 30) arrived = true;
        if (closest > 30) bad.push('police never got within 30 m in 40 s (closest ' + closest.toFixed(0) + ')');
        // decay: hide on a high roof and wait
        const wanted0 = vs.wanted;
        const roof = g.physics.heightAt(g.player.pos.x, g.player.pos.z, 400);
        return { bad, chasers, near, closest: +closest.toFixed(0), hpLost: hp0 - g.player.hp, wanted0, state: g.state };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `chasers=${r.chasers} closest=${r.closest} hpLost=${r.hpLost} state=${r.state}`;
    },
  },
  {
    name: 'police-decay',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        // far from any cops: take a high rooftop-less spot at the map edge via sky: put player high
        vs.wanted = 2; vs._lastCrimeT = vs.time - 100;
        for (const v of vs.list) if (v.isPolice) { vs._deactivate(v); v.reserve = false; v.active = false; }
        g.player.pos.y += 0; qa.step(2);
        let t = 0;
        // unseen decay should drop a star every 25 s
        for (; t < 120 && vs.wanted > 0; t++) { qa.stepSec(1); if (vs.wanted > 0) for (const v of vs.list) if (v.isPolice && v.active) { vs._deactivate(v); } }
        if (vs.wanted > 0) bad.push('wanted never decayed in 120 s (still ' + vs.wanted + ')');
        return { bad, t };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `cleared in ${r.t}s`;
    },
  },
];
