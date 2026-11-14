// Vehicles: enter, carjack, drive, drift, crash, explode, exit at speed, drive-by, bus, Hulk grab/throw, water, traffic.
export const vehicles = [
  {
    name: 'veh-enter-exit',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const v = qa.stageCar('sedan');
        if (!v) return { bad: ['no road car to stage'] };
        qa.press('KeyF', 3); qa.step(5);
        if (vs.driving !== v) bad.push(`enter failed (driving=${vs.driving?.kind}, enterable=${vs.nearestEnterable(g.player.pos)?.kind})`);
        if (g.player.model.group.visible) bad.push('hero model visible while driving');
        qa.hold('KeyW'); qa.stepSec(2.5); qa.release();
        const sp = v.speed;
        if (!(sp > 6)) bad.push(`car did not accelerate: ${sp.toFixed(1)}`);
        qa.hold('KeyS'); qa.stepSec(4); qa.release();
        // hold F for a long time: must exit once, not re-enter
        g.input.keys.add('KeyF'); qa.step(60); g.input.keys.delete('KeyF'); qa.step(5);
        if (vs.driving) bad.push('still driving after exit press (re-entered while held?)');
        if (!g.player.model.group.visible) bad.push('hero model hidden after exit');
        qa.stepSec(1);
        const p = g.player;
        if (g.physics.inside(p.center)) bad.push('hero inside a building after exit');
        if (p.pos.distanceTo(v.pos) > 8) bad.push('hero too far from car after exit ' + p.pos.distanceTo(v.pos).toFixed(1));
        if (!qa.finite(p.pos)) bad.push('NaN pos');
        return { bad, sp };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `top speed ${r.sp.toFixed(1)} m/s`;
    },
  },
  {
    name: 'veh-carjack',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const v = qa.stageCar('suv', { ai: true, speed: 0 });
        if (!v) return { bad: ['no staging'] };
        v.speed = 0; v.vel.set(0, 0, 0); v.ctrl.t = 0; v.ctrl.b = 1;
        const w0 = vs.wanted;
        // the heading is a road lane: face the car
        qa.press('KeyF', 3);
        if (!vs.jack) bad.push('no jack started (driver=' + v.driver + ' enterable=' + !!vs.nearestEnterable(g.player.pos) + ')');
        qa.stepSec(1.5);
        if (vs.driving !== v) bad.push('not driving jacked car');
        if (vs.wanted <= w0) bad.push('carjack did not raise wanted level');
        return { bad, wanted: vs.wanted };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `wanted=${r.wanted}`;
    },
  },
  {
    name: 'veh-drive-drift-crash',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('spiderman');
        const v = qa.stageCar('sports');
        qa.press('KeyF', 3);
        if (vs.driving !== v) return { bad: ['enter failed'] };
        v.invuln = 0;
        qa.hold('KeyW'); qa.stepSec(3);
        const yaw0 = v.yaw; let maxSlip = 0;
        qa.hold('KeyD', 'Space');
        qa.step(90, () => { maxSlip = Math.max(maxSlip, Math.abs(v.slip)); });
        qa.release('KeyD', 'Space');
        if (maxSlip < 2.5) bad.push('handbrake turn produced no drift slip ' + maxSlip.toFixed(2));
        if (Math.abs(v.yaw - yaw0) < 0.3) bad.push('car did not turn');
        // straight into a wall: damage. Aim at the nearest building by driving along the heading until blocked
        qa.release();
        let hp0 = v.hp;
        v.hp = v.maxHp; v.invuln = 0;
        qa.hold('KeyW');
        let crashed = false;
        for (let i = 0; i < 60 * 12 && !crashed; i++) { qa.step(1); if (v.hp < hp0 - 0.5 && v.hp < v.maxHp) crashed = true; if (v.wrecked) break; }
        qa.release();
        if (!crashed && !v.wrecked) bad.push('no crash damage after 12 s of driving into the street end');
        // explode
        v.hp = v.maxHp; v.invuln = 0; v.wrecked = false;
        const hp1 = g.player.hp;
        vs.explodeVehicle(v, 'test');
        qa.step(3);
        if (vs.driving) bad.push('still driving a wreck');
        if (!v.wrecked) bad.push('not wrecked');
        if (!(g.player.hp < hp1)) bad.push('player took no explosion damage');
        qa.stepSec(2);
        if (!qa.finite(g.player.pos) || !qa.finite(v.pos)) bad.push('NaN after explosion');
        if (g.physics.inside(g.player.center)) bad.push('hero inside geometry after explosion exit');
        return { bad, maxSlip };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `maxSlip=${r.maxSlip.toFixed(1)}`;
    },
  },
  {
    name: 'veh-exit-at-speed',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, vs = g.vehicles, bad = [];
        qa.begin('hulk');
        const v = qa.stageCar('sedan');
        qa.press('KeyF', 3);
        // Hulk grabs cars instead of driving; use another hero to drive
        if (vs.driving !== v) { vs._dropHeld?.(true); g.switchHero('spiderman'); qa.step(50); }
        if (vs.driving !== v) { v.owned = true; vs._enter(v, false); }
        qa.hold('KeyW'); qa.stepSec(3);
        const sp = v.speed;
        qa.release();
        const hp0 = g.player.hp;
        qa.press('KeyF', 3);
        if (vs.driving) bad.push('did not exit at speed');
        qa.stepSec(2);
        if (!qa.finite(g.player.pos)) bad.push('NaN');
        if (g.physics.inside(g.player.center)) bad.push('inside geometry after speed exit');
        if (g.player.hp < hp0 - 30) bad.push(`exit at speed cost ${hp0 - g.player.hp} hp`);
        if (g.player.pos.y < -1) bad.push('fell through ground: ' + g.player.pos.y);
        return { bad, sp };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `exited at ${r.sp.toFixed(1)} m/s`;
    },
  },
];
