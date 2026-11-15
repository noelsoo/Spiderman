// Vehicles part 2: drive-by, bus, Hulk grab/throw, water, traffic flow and lane side.
export const vehicles2 = [
  {
    name: 'veh-driveby',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, w = g.weapons, bad = [];
        qa.begin('spiderman');
        g.economy.add(5000, null, { silent: true });
        const def = w.catalog.find((d) => d.id === 'smg');
        const res = w.purchase(def);
        if (!res.ok) return { bad: ['purchase failed ' + res.msg] };
        const v = qa.stageCar('sedan');
        qa.press('KeyF', 3);
        if (vs.driving !== v) { qa.step(30); if (vs.driving !== v) { if (vs.jack) qa.stepSec(1); else vs._enter(v, false); } }
        if (vs.driving !== v) return { bad: ['enter failed'] };
        const st = w.owned.get('smg');
        const clip0 = st.clip;
        qa.hold('KeyW');
        qa.mouse(2, true); qa.step(30);
        if (!w.drivebyAiming) bad.push('RMB did not start drive-by aim');
        qa.mouse(0, true); qa.step(40); qa.mouse(0, false); qa.mouse(2, false);
        qa.release();
        if (st.clip >= clip0) bad.push(`drive-by fire did not use ammo (${clip0} -> ${st.clip})`);
        if (v.speed < 3) bad.push('throttle cut while firing: speed ' + v.speed.toFixed(1));
        if (g.player.model.group.visible) bad.push('hero visible during drive-by');
        const c1 = st.clip; qa.mouse(0, true); qa.step(30); qa.mouse(0, false);
        if (st.clip !== c1) bad.push('fired without aiming');
        return { bad, used: clip0 - st.clip };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `rounds used ${r.used}`;
    },
  },
  {
    name: 'veh-bus',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const v = qa.stageCar('bus');
        if (!v) return { bad: ['no bus'] };
        qa.press('KeyF', 3);
        if (vs.driving !== v) return { bad: ['could not enter bus'] };
        qa.hold('KeyW'); qa.stepSec(4); qa.release();
        if (!(v.speed > 4)) bad.push('bus did not move ' + v.speed.toFixed(1));
        const cam = g.camera.position, d = Math.hypot(cam.x - v.pos.x, cam.z - v.pos.z);
        if (d < 8) bad.push('camera inside bus (dist ' + d.toFixed(1) + ')');
        qa.hold('KeyS'); qa.stepSec(6); qa.release();
        qa.press('KeyF', 3);
        if (vs.driving) bad.push('bus exit failed');
        qa.stepSec(1);
        if (g.physics.inside(g.player.center)) bad.push('inside geometry after bus exit');
        return { bad };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
    },
  },
  {
    name: 'veh-hulk-grab-throw',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('hulk');
        const v = qa.stageCar('suv', { ai: true, speed: 0 });
        v.speed = 0; v.vel.set(0, 0, 0); v.ctrl.b = 1;
        qa.press('KeyF', 3);
        if (vs.held !== v) bad.push('hulk did not grab the car');
        qa.stepSec(1);
        if (vs.held && v.pos.y < g.player.pos.y + 2) bad.push('held car not lifted: ' + (v.pos.y - g.player.pos.y).toFixed(1));
        qa.press('KeyJ', 3);
        if (!v.thrown && !v.wrecked) bad.push('car not thrown');
        qa.stepSec(5);
        if (v.thrown) bad.push('car still in flight after 5 s');
        if (vs.held) bad.push('still holding');
        if (!qa.finite(v.pos)) bad.push('NaN car');
        const v2 = qa.stageCar('sedan', { ai: true, speed: 0 }); v2.speed = 0; v2.vel.set(0, 0, 0);
        qa.press('KeyF', 3);
        if (vs.held !== v2) bad.push('second grab failed');
        g._switchCd = 0; g.switchHero('spiderman'); qa.step(5);
        if (vs.held) bad.push('car still held after hero switch');
        return { bad };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
    },
  },
  {
    name: 'veh-water',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const b = g.world.bounds;
        let wet = null;
        for (let x = b.minX + 20; x < b.maxX && !wet; x += 10) for (let z = b.minZ + 20; z < b.maxZ; z += 10) if (vs._wet(x, z) && g.physics.heightAt(x, z, 5) < 0.1 && g.physics.heightAt(x + 5, z, 5) < 0.1 && g.physics.heightAt(x - 5, z, 5) < 0.1 && vs._wet(x + 8, z) && vs._wet(x - 8, z) && vs._wet(x, z + 8) && vs._wet(x, z - 8)) { wet = { x, z }; break; }
        if (!wet) return { bad: ['no open water found on map'] };
        const v = qa.stageCar('sedan');
        vs._enter(v, false);
        v.pos.set(wet.x, 0.4, wet.z); v.vel.set(0, 0, 0); v.speed = 0;
        let sank = false;
        qa.step(60 * 4, () => { if (v.sinking > 0) sank = true; });
        if (!sank) bad.push(`car never sank in open water at ${wet.x},${wet.z}: now ${v.pos.toArray().map((q) => q.toFixed(1))} y-ground ${g.physics.heightAt(wet.x, wet.z, 5)} wet ${vs._wet(v.pos.x + 1, v.pos.z)} airborne ${v.airborne} wrecked ${v.wrecked}`);
        qa.stepSec(2);
        if (vs.driving) bad.push('player still driving a sunk car');
        const p = g.player;
        if (!qa.finite(p.pos)) bad.push('NaN pos');
        if (vs._wet(p.pos.x, p.pos.z) && p.pos.y < 0.5) bad.push('player left in water at ' + p.pos.toArray().map((x) => x.toFixed(0)));
        return { bad, at: p.pos.toArray().map((x) => +x.toFixed(0)) };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `surfaced at ${r.at}`;
    },
  },
  {
    name: 'traffic-flow',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const spot = qa.roadSpot();
        qa.put(spot.x, spot.z, spot.yaw);
        qa.stepSec(5);
        const ai = () => vs.list.filter((v) => v.active && !v.reserve && v.driver === 'ai' && !v.wrecked && v.dist < 160);
        const stuckFor = new Map(); const lastPos = new Map(); let maxStuck = 0, maxStuckCar = null;
        const samples = [];
        for (let s = 0; s < 60; s++) {
          qa.stepSec(1);
          const cars = ai();
          let still = 0;
          for (const v of cars) {
            const lp = lastPos.get(v);
            const moved = lp ? Math.hypot(v.pos.x - lp.x, v.pos.z - lp.z) : 9;
            lastPos.set(v, { x: v.pos.x, z: v.pos.z });
            if (moved < 0.3) { const t = (stuckFor.get(v) || 0) + 1; stuckFor.set(v, t); if (t > maxStuck) { maxStuck = t; maxStuckCar = `${v.kind}@${v.pos.x.toFixed(0)},${v.pos.z.toFixed(0)} dist ${v.dist.toFixed(0)}`; } still++; }
            else stuckFor.set(v, 0);
          }
          samples.push([cars.length, still]);
        }
        const last = samples.slice(-10);
        const avgN = last.reduce((a, s) => a + s[0], 0) / last.length, avgStill = last.reduce((a, s) => a + s[1], 0) / last.length;
        if (avgN < 4) bad.push('almost no AI traffic: ' + avgN.toFixed(1));
        if (avgStill / Math.max(1, avgN) > 0.6) bad.push(`traffic piled up: ${avgStill.toFixed(1)}/${avgN.toFixed(1)} stationary at the end`);
        const still = ai().filter((v) => (stuckFor.get(v) || 0) > 10);
        for (const a of still) { const n = still.filter((b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 14).length; if (n >= 6) { bad.push(`gridlock cluster of ${n} at ${a.pos.x.toFixed(0)},${a.pos.z.toFixed(0)}`); break; } }
        if (maxStuck > 45) bad.push(`a car sat still for ${maxStuck}s: ${maxStuckCar}`);
        return { bad, avgN: +avgN.toFixed(1), avgStill: +avgStill.toFixed(1), maxStuck };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `cars=${r.avgN} still=${r.avgStill} maxStuck=${r.maxStuck}s`;
    },
  },
  {
    name: 'traffic-lane-side',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const spot = qa.roadSpot(); qa.put(spot.x, spot.z, spot.yaw);
        const sg = g.world.id === 'singapore';
        let ok = 0, wrong = 0;
        for (let s = 0; s < 40; s++) {
          qa.stepSec(1.5);
          const cars = vs.list.filter((v) => v.active && !v.reserve && v.driver === 'ai' && !v.parked && Math.abs(v.speed) > 4 && v.kind !== 'bus');
          for (const a of cars) for (const b of cars) {
            if (a === b) continue;
            const za = Math.abs(Math.cos(a.yaw)) > 0.97, zb = Math.abs(Math.cos(b.yaw)) > 0.97;
            if (za && zb && Math.cos(a.yaw) > 0 && Math.cos(b.yaw) < 0 && Math.abs(a.pos.x - b.pos.x) > 1.2 && Math.abs(a.pos.x - b.pos.x) < 12 && Math.abs(a.pos.z - b.pos.z) < 60) {
              const leftHand = a.pos.x > b.pos.x;      // +Z heading drives on the left when it sits at larger x
              if (leftHand === sg) ok++; else wrong++;
            }
            const xa = Math.abs(Math.sin(a.yaw)) > 0.97, xb = Math.abs(Math.sin(b.yaw)) > 0.97;
            if (xa && xb && Math.sin(a.yaw) > 0 && Math.sin(b.yaw) < 0 && Math.abs(a.pos.z - b.pos.z) > 1.2 && Math.abs(a.pos.z - b.pos.z) < 12 && Math.abs(a.pos.x - b.pos.x) < 60) {
              const leftHand = a.pos.z < b.pos.z;      // +X heading: left side is -Z
              if (leftHand === sg) ok++; else wrong++;
            }
          }
        }
        if (ok + wrong < 3) return { bad: [], note: 'too few oncoming pairs observed (' + (ok + wrong) + ')', ok, wrong };
        if (wrong > ok * 0.15) bad.push(`${sg ? 'Singapore should be left-hand' : 'NYC should be right-hand'} traffic: ${ok} correct vs ${wrong} wrong pairs`);
        return { bad, ok, wrong };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `${r.ok} ok / ${r.wrong} wrong ${r.note || ''}`;
    },
  },
];
