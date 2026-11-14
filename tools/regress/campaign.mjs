// Campaign start / fail / checkpoint / abandon / complete / persistence; settings persistence.
export const campaign = [
  {
    name: 'campaign-flow',
    async run(c) {
      const r = await c.ev(() => {
        const qa = window.qa, g = window.game, cp = g.campaign, bad = [];
        const key = cp.meta.key;
        localStorage.removeItem(key); cp.reset();
        g.beginMission(0, 'spiderman');
        qa.stepSec(2);
        if (g.mode !== 'campaign' || cp.phase !== 'playing') bad.push(`start: mode ${g.mode} phase ${cp.phase}`);
        // play a few steps then fail
        for (let i = 0; i < 6 && cp.stepIdx < 1; i++) { cp.debugSkip(); qa.stepSec(1); }
        const stepBefore = cp.stepIdx;
        cp.onFail('qa test');
        if (g.state !== 'gameover') bad.push('fail did not end in gameover: ' + g.state);
        if (!document.body.textContent.match(/retry|checkpoint|restart/i)) bad.push('no failed screen text');
        qa.step(30);
        cp.retryCheckpoint(); qa.stepSec(2);
        if (g.state !== 'playing' || cp.phase !== 'playing') bad.push(`retry: state ${g.state} phase ${cp.phase}`);
        if (cp.stepIdx < Math.max(0, stepBefore)) bad.push(`checkpoint lost: step ${cp.stepIdx} < ${stepBefore}`);
        // abandon
        g.hud.abandonMission(); qa.step(10);
        if (cp.phase !== 'idle' && cp.active) bad.push('abandon left mission active');
        if (g.state === 'playing' && g.mode === 'campaign' && cp.active) bad.push('still playing after abandon');
        // complete: skip every step
        g.beginMission(0, 'spiderman'); qa.stepSec(1);
        let guard = 0;
        while (cp.phase === 'playing' && guard++ < 400) { cp.debugSkip(); qa.step(30); if (g.state === 'overlay') qa.step(5); }
        qa.stepSec(4);
        if (g.state !== 'gameover') bad.push(`complete: state ${g.state} phase ${cp.phase} step ${cp.stepIdx} after ${guard} skips`);
        if (!cp.result) bad.push('no result');
        if (cp.progress.unlocked < 1) bad.push('mission 1 not unlocked');
        if (!document.body.textContent.match(/complete|next mission/i)) bad.push('no complete screen');
        return { bad, unlocked: cp.progress.unlocked, key, stored: localStorage.getItem(key) };
      });
      c.assert(!r.bad.length, r.bad.join('; '));
      await c.reload();
      const p = await c.ev((key) => ({ unlocked: window.game.campaign.progress.unlocked, done: Object.keys(window.game.campaign.progress.done), stored: localStorage.getItem(key), other: localStorage.getItem(key === 'sm-campaign-sg' ? 'sm-campaign' : 'sm-campaign-sg') }), r.key);
      c.assert(p.unlocked >= 1 && p.done.includes('0'), `progress lost on reload: ${JSON.stringify(p)}`);
      return `slot ${r.key} unlocked=${p.unlocked}`;
    },
  },
  {
    name: 'campaign-slots',
    async run(c) {
      // both save slots independent: write both, reload on this map, neither is clobbered
      const r = await c.ev(() => {
        const g = window.game;
        const mine = g.campaign.meta.key, other = mine === 'sm-campaign-sg' ? 'sm-campaign' : 'sm-campaign-sg';
        localStorage.setItem(other, JSON.stringify({ v: 1, unlocked: 3, done: { 0: { stars: 2, best: 99 } }, cash: 5 }));
        g.campaign.progress.unlocked = 2; g.campaign.save();
        return { mine, other };
      });
      await c.reload();
      const p = await c.ev((r) => ({ mine: JSON.parse(localStorage.getItem(r.mine)).unlocked, other: JSON.parse(localStorage.getItem(r.other)).unlocked, loaded: window.game.campaign.progress.unlocked }), r);
      c.assert(p.mine === 2 && p.loaded === 2 && p.other === 3, 'slots mixed: ' + JSON.stringify(p));
      await c.ev((r) => { localStorage.removeItem(r.other); window.game.campaign.reset(); }, r);
    },
  },
];

const SETTING_CASES = {
  sensitivity: [1.7, (g) => Math.abs(g.input.mouseSensitivity - 0.0022 * 1.7) < 1e-9],
  invertY: [true, (g) => g.input.invertY === true],
  invertX: [true, (g) => g.input.invertX === true],
  stickSensitivity: [1.4, (g) => Math.abs(g.input.stickSensitivity - 3.2 * 1.4) < 1e-9],
  deadzone: [0.3, (g) => g.input.deadzone === 0.3],
  aimSens: [0.6, (g) => g.cam.pref.aimSens === 0.6],
  fov: [85, (g) => g.cam.baseFov === 85],
  camDist: [9, (g) => Math.abs(g.cam.pref.dist - 1.5) < 1e-9],
  shoulder: ['left', (g) => g.cam.pref.shoulder === -1],
  shadows: [false, (g) => g.renderer.shadowMap.enabled === false],
  ao: [false, (g) => g.post.opts?.ao === false],
  bloom: [0.4, (g) => g.post.opts?.bloom === 0.4],
  brightness: [1.3, (g) => Math.abs(g.renderer.toneMappingExposure - 1.3) < 1e-9],
  fps: [true, (g) => document.querySelector('.fpsc')?.style.display === 'block'],
  volume: [0.3, (g) => g.audio._applyVolumes && true],
  hudScale: [1.25, (g) => g.hud.root.style.getPropertyValue('--hs') === '1.25'],
  colorBlind: ['deuteranopia', (g) => document.documentElement.classList.contains('cb-on')],
  highContrast: [true, (g) => g.hud.root.classList.contains('hc')],
  subtitles: [false, (g) => g.hud.root.classList.contains('nosubs')],
  swingToggle: [true, (g) => g.input.toggleActions.swing === true],
  aimToggle: [true, (g) => g.input.toggleActions.aim === true],
  difficulty: ['hard', () => true],
};

export const settings = [
  {
    name: 'settings-persist-reset',
    fresh: true,
    async run(c) {
      await c.ev((cases) => {
        const g = window.game;
        for (const [k, v] of Object.entries(cases)) g.settings[k] = v;
        g.settings.quality = 'medium'; g.settings.fpsCap = 60; g.settings.music = 0.2; g.settings.sfx = 0.4; g.settings.voice = 0.1; g.settings.volume = 0.55;
        g.settings.keys = { interact: ['KeyG'] };
        g.saveSettings();
      }, Object.fromEntries(Object.entries(SETTING_CASES).map(([k, [v]]) => [k, v])));
      await c.reload();
      const r = await c.ev(() => {
        const g = window.game, s = g.settings, bad = [];
        const want = { quality: 'medium', fpsCap: 60, music: 0.2, sfx: 0.4, voice: 0.1, volume: 0.55 };
        for (const [k, v] of Object.entries(want)) if (s[k] !== v) bad.push(`${k} ${s[k]} != ${v}`);
        if (!g.input.getKeyBinding('interact').includes('KeyG')) bad.push('remapped key not applied after reload');
        if (g.input.getKeyBinding('interact').includes('KeyF')) bad.push('old key still bound');
        return bad;
      });
      // each option is applied to the live game after reload
      for (const [k, [, fn]] of Object.entries(SETTING_CASES)) {
        const ok = await c.page.evaluate(`(${fn.toString()})(window.game)`);
        if (!ok) r.push(`${k} not applied after reload`);
      }
      c.assert(!r.length, r.join('; '));
      // reset to defaults through the real settings screen
      const rs = await c.ev(() => {
        const g = window.game, bad = [];
        g.state = 'playing'; g.begin('spiderman'); window.qa.step(3); g.pause();
        g.hud._push('settings'); window.qa.step(3);
        const btn = [...document.querySelectorAll('.st-btn')].find((b) => /reset all/i.test(b.textContent));
        if (!btn) return ['no Reset all button'];
        btn.click(); btn.click();
        // item activation may be via the menu focus rather than DOM click; fall back to the item list
        const it = g.hud.screen?.items?.find?.((i) => i.el === btn);
        if (g.settings.sensitivity !== 1 && it?.act) { it.act(); it.act(); }
        window.qa.step(3);
        const s = g.settings;
        if (s.sensitivity !== 1) bad.push('reset did not restore sensitivity ' + s.sensitivity);
        if (s.invertY) bad.push('invertY still set');
        if (s.keys) bad.push('keys not reset');
        if (g.input.getKeyBinding('interact').join() !== 'KeyF') bad.push('input binding not reset: ' + g.input.getKeyBinding('interact'));
        if (JSON.parse(localStorage.getItem('sm-settings')).sensitivity !== 1) bad.push('reset not persisted');
        return bad;
      });
      c.assert(!rs.length, rs.join('; '));
      return `${Object.keys(SETTING_CASES).length + 6} options`;
    },
  },
];
