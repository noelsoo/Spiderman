// Draw-call probe: spawn N goons in front of the camera on New York and Singapore night, log renderer.info.render.calls.
//   node tools/enemycalls.mjs [--nobake=1] [--n=5] [--shot=1] [--out=dir]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(join(process.execPath, '../../lib/node_modules/playwright'))); }
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const N = Number(args.n || 5), out = resolve(args.out || 'tools/shots'); mkdirSync(out, { recursive: true });
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { const b = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end('nf'); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const [map, pos, night] of [['nyc', null, false], ['singapore', [-380, -50], true]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.setDefaultTimeout(180000);
  await page.addInitScript(([map, nb]) => { if (nb) globalThis.__NOBAKE = true; try { localStorage.setItem('sm-settings', JSON.stringify({ map })); } catch {} }, [map, !!args.nobake]);
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 120000 });
  await page.evaluate(() => { const g = window.game; g.hud.hideMenus?.(); g.begin('spiderman'); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async ([pos, night, N, yaw]) => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    if (night) g.world.atmo.setTime(0.82);
    if (pos) { g.player.pos.set(pos[0], g.physics.heightAt(pos[0], pos[1], 3) + 1, pos[1]); g.player.vel?.set(0, 0, 0); }
    g.cam.pitch = -0.12; if (yaw !== undefined) g.cam.yaw = yaw;
    const frame = () => { g.clock.getDelta(); g.frame(); };
    for (let i = 0; i < 6; i++) frame();
    const cam = g.camera, d = cam.position.clone(); cam.getWorldDirection(d); d.y = 0; d.normalize();
    const base = g.player.pos, gy = base.y;
    for (let i = 0; i < N; i++) {
      const a = (i - (N - 1) / 2) * 0.35, c = Math.cos(a), s = Math.sin(a);
      const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c, dist = 7 + (i % 2) * 2.5;
      { const x = base.x + dx * dist, z = base.z + dz * dist; g.enemies.spawn('goon', d.clone().set(x, g.physics.heightAt(x, z, base.y + 3), z)); }
    }
    for (let i = 0; i < 8; i++) frame();
    const count = () => { g.renderer.info.autoReset = false; g.renderer.info.reset(); g.post.render(0); const c = g.renderer.info.render.calls; g.renderer.info.autoReset = true; return c; };
    const calls = count();
    const alive = g.enemies.list.filter((e) => e.alive).length;
    const hid = g.enemies.list.map((e) => e.root.visible); g.enemies.list.forEach((e) => { e.root.visible = false; });
    const noE = count();
    g.enemies.list.forEach((e, i) => { e.root.visible = hid[i]; });
    return { calls, noEnemies: noE, alive, ppos: g.player.pos.toArray().map((v) => +v.toFixed(1)), st: g.player.state, e0: g.enemies.list[0]?.pos.toArray().map((v) => +v.toFixed(1)) };
  }, [pos, night, N, args.yaw === undefined ? undefined : Number(args.yaw)]);
  console.log(map, args.nobake ? 'NOBAKE' : 'baked', JSON.stringify(r));
  if (args.shot) {
    await page.evaluate(() => { const g = window.game; g.post.render(0); });
    await page.screenshot({ path: join(out, `${map}${args.nobake ? '_before' : '_after'}.png`) });
  }
  await page.close();
}
await browser.close(); server.close();
if (errors.length) { console.error(errors.slice(0, 8).join('\n')); process.exit(1); }
