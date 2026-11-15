// Targeted checks for individual hero powers (effects, cooldowns, state), beyond the generic hero-abilities sweep.
// Page-side arena: the hero on a road with five tough goons in front. Installed as window.qaPower (the CSP forbids eval).
const install = () => { window.qaPower = (hero) => {
  const qa = window.qa, g = window.game;
  const { spot, restore } = qa.arena(hero);
  const p = g.player; p.maxHp = p.hp = 99999; g.enemies.running = false;
  const foes = [];
  for (let i = 0; i < 5; i++) {
    const a = spot.yaw + (i - 2) * 0.3, d = 4.5 + (i % 2);
    const e = g.enemies.spawn('goon', p.pos.clone().add({ x: Math.sin(a) * d, y: 0, z: Math.cos(a) * d }), {});
    e.maxHp = e.hp = 5000; e.ai = () => {};   // passive targets: a hero being hit cannot start a cast
    foes.push(e);
  }
  qa.step(20);
  const hp = () => foes.reduce((s, e) => s + Math.max(0, e.hp), 0);
  const lift = (h) => { p.pos.y += h; p.vel.set(0, 0, 0); p.onGround = false; qa.step(12); };
  const regroup = () => { foes.forEach((e, i) => { const a = p.yaw + (i - 2) * 0.3; e.pos.set(p.pos.x + Math.sin(a) * 4.5, g.physics.heightAt(p.pos.x, p.pos.z, 3), p.pos.z + Math.cos(a) * 4.5); e.vel.set(0, 0, 0); }); qa.step(5); };
  return { qa, g, p, foes, hp, lift, regroup, restore };
}; };

export const powers = [
  {
    name: 'power-thor',
    async run(c) {
      await c.ev(install);
      const r = await c.ev(() => {
        const { qa, g, p, foes, hp, lift, regroup, restore } = window.qaPower('thor');
        const bad = [];
        // Storm Zone: hold ability
        let h0 = hp();
        qa.hold('KeyE'); qa.step(30); qa.release('KeyE');
        if (!p.zone) bad.push('hold ability did not open a storm zone ');
        if (!(p.cooldowns.storm > 0)) bad.push('storm cooldown not set');
        qa.stepSec(4);
        const zoneDmg = h0 - hp();
        if (!(zoneDmg > 0)) bad.push('storm zone dealt no damage');
        qa.stepSec(4);
        if (p.zone) bad.push('storm zone never expired');
        // tap ability still strikes
        p.cooldowns.strike = 0; qa.step(30); h0 = hp(); regroup();
        qa.press('KeyE', 3); qa.stepSec(1.2);
        if (!(p.cooldowns.strike > 0)) bad.push('tap ability did not use Lightning Strike');
        // Hammer Slam: ability in the air
        regroup(); h0 = hp(); lift(14);
        qa.press('KeyE', 3);
        if (!p.slam) bad.push('air ability did not start the hammer slam');
        qa.stepSec(1.5);
        if (p.slam) bad.push('slam flag still set after landing');
        const slamDmg = h0 - hp();
        if (!(slamDmg > 0)) bad.push('hammer slam dealt no damage');
        // Storm Dash: dodge while flying
        qa.hold('ShiftLeft'); qa.step(40);
        if (!p.flying) bad.push('could not take off');
        qa.press('KeyC', 2);
        const sp = p.vel.length();
        if (!(p.cooldowns.flydash > 0)) bad.push('storm dash cooldown not set');
        qa.release('ShiftLeft'); qa.stepSec(2);
        if (!qa.finite(p.pos)) bad.push('NaN position');
        restore();
        return { bad, zoneDmg: Math.round(zoneDmg), slamDmg: Math.round(slamDmg), dashSpeed: Math.round(sp) };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `zone ${r.zoneDmg}, slam ${r.slamDmg}, dash ${r.dashSpeed} m/s`;
    },
  },
  {
    name: 'power-captain',
    async run(c) {
      await c.ev(install);
      const r = await c.ev(() => {
        const { qa, g, p, foes, hp, lift, regroup, restore } = window.qaPower('captain');
        const bad = [];
        // Shield Shockwave: hold ability on the ground
        let h0 = hp();
        qa.hold('KeyE'); qa.step(30); qa.release('KeyE');
        if (!(p.cooldowns.bash > 0)) bad.push('hold ability did not use the shockwave');
        qa.stepSec(0.6);
        const waveDmg = h0 - hp();
        if (!(waveDmg > 0)) bad.push('shockwave dealt no damage');
        const stunned = foes.filter((e) => e.stunTimer > 0.8).length;
        if (stunned < 2) bad.push('shockwave stunned ' + stunned + ' enemies');
        qa.stepSec(1.5);
        // tap = Shield Charge
        qa.press('KeyE', 3);
        if (!(p.cooldowns.charge > 0)) bad.push('tap ability did not charge');
        qa.stepSec(1.2);
        // Shield Slam: ability in the air
        regroup(); h0 = hp(); lift(12);
        qa.press('KeyE', 3);
        if (!p.slam) bad.push('air ability did not start the shield slam');
        qa.stepSec(1.5);
        if (p.slam) bad.push('slam flag still set after landing');
        const slamDmg = h0 - hp();
        if (!(slamDmg > 0)) bad.push('shield slam dealt no damage');
        if (!qa.finite(p.pos)) bad.push('NaN position');
        restore();
        return { bad, waveDmg: Math.round(waveDmg), stunned, slamDmg: Math.round(slamDmg) };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      return `shockwave ${r.waveDmg} (${r.stunned} stunned), slam ${r.slamDmg}`;
    },
  },
];

// Spider-Man 2 style combat moves that depend on range and timing.
powers.push({
  name: 'power-spiderman-moves',
  async run(c) {
    await c.ev(install);
    const r = await c.ev(() => {
      const { qa, g, p, foes, restore } = window.qaPower('spiderman');
      const bad = [], info = {};
      const place = (e, d, y = 0) => { e.pos.set(p.pos.x + Math.sin(p.yaw) * d, g.physics.heightAt(p.pos.x, p.pos.z, 3) + y, p.pos.z + Math.cos(p.yaw) * d); e.vel.set(0, 0, 0); e.hp = e.maxHp = 5000; e.launched = false; e.onGround = true; e.stunTimer = 0; e.downTimer = 0; };
      const far = (e) => e.pos.set(p.pos.x - Math.sin(p.yaw) * 200, e.pos.y, p.pos.z - Math.cos(p.yaw) * 200);
      const only = (e, d) => { for (const o of foes) if (o !== e) far(o); place(e, d); g.cam.recenter?.(p.yaw); qa.step(10); };
      const e = foes[0];
      // web strike: nobody in reach, one enemy 16 m ahead
      only(e, 16);
      let h0 = e.hp; const z0 = p.pos.clone();
      qa.press('KeyJ', 2); qa.stepSec(1.2);
      info.strikeMoved = +p.pos.distanceTo(z0).toFixed(1); info.strikeDmg = Math.round(h0 - e.hp);
      if (!(info.strikeMoved > 8)) bad.push(`web strike did not pull the hero in (moved ${info.strikeMoved} m)`);
      if (!(info.strikeDmg > 0)) bad.push('web strike dealt no damage');
      qa.stepSec(1.5);
      // air launcher then air combo
      p.cooldowns.launcher = 0; only(e, 2.2); h0 = e.hp;
      qa.hold('KeyJ'); qa.step(26); qa.release('KeyJ');
      let maxY = 0; qa.step(25, () => { maxY = Math.max(maxY, e.pos.y - p.pos.y + (p.pos.y - g.physics.heightAt(p.pos.x, p.pos.z, 3))); });
      info.launchY = +maxY.toFixed(1);
      if (!(maxY > 2)) bad.push(`launcher did not lift the enemy (${info.launchY} m)`);
      const h1 = e.hp;
      info.trace = [];
      for (let k = 0; k < 4; k++) { qa.press('KeyJ', 2); qa.step(9); info.trace.push([Math.round(e.hp), +(e.pos.y - p.pos.y).toFixed(1), +Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z).toFixed(1), p.atk?.air ? 'air' : p.atk ? 'gnd' : '-', p.onGround ? 'G' : 'A', e.launched ? 'L' : '', e.alive ? '' : 'DEAD']); }
      info.airDmg = Math.round(h1 - e.hp);
      if (!(info.airDmg > 0)) bad.push('air combo dealt no damage to the launched enemy');
      qa.stepSec(2);
      // focus finisher: full focus, combo on one enemy
      only(e, 2.0); p.focus = 100; h0 = e.hp; let minFocus = 100;
      for (let k = 0; k < 5; k++) { qa.press('KeyJ', 2); qa.step(13, () => { minFocus = Math.min(minFocus, p.focus); }); }
      qa.stepSec(1.2);
      info.finisherFocus = Math.round(minFocus);
      if (!(minFocus <= 70)) bad.push(`focus finisher never spent a bar (min focus ${info.finisherFocus})`);
      if (!qa.finite(p.pos)) bad.push('NaN position');
      restore();
      return { bad, info };
    });
    c.assert(!r.bad.length, r.bad.join('; ') + ' ' + JSON.stringify(r.info));
    return JSON.stringify(r.info);
  },
});
