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
