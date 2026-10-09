// Headless smoke test: builds nothing, serves ./dist, boots the game, plays a few seconds
// with scripted input, fails on any console error / page error, and saves screenshots.
//   npm run build && npm run smoke [-- --hero=ironman --seconds=8 --out=tools/shots]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(join(process.execPath, '../../lib/node_modules/playwright')));
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const heroes = (args.hero || 'spiderman,ironman,hulk,thor').split(',');
const seconds = Number(args.seconds || 4);
const out = resolve(args.out || 'tools/shots');
mkdirSync(out, { recursive: true });

const root = resolve(args.dist || 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { const body = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('nf'); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.setDefaultTimeout(180000);
// Software GL (swiftshader) renders slowly; pause the loop, draw one frame, then capture.
const shot = async (name) => {
  await page.evaluate(() => { const g = window.game; g.renderer.setAnimationLoop(null); g.composer.render(); });
  await page.screenshot({ path: join(out, name), timeout: 180000 });
  await page.evaluate(() => { const g = window.game; g.clock.getDelta(); g.renderer.setAnimationLoop(() => g.frame()); });
};
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 60000 });
await shot('menu.png');

const fps = {};
for (const hero of heroes) {
  await page.evaluate((h) => { const g = window.game; g.hud.hideMenus?.(); g.begin(h); }, hero);
  const keys = ['KeyW', 'Space', 'ShiftLeft', 'KeyJ', 'KeyK', 'KeyE', 'KeyR', 'KeyC'];
  const t0 = Date.now();
  const f0 = await page.evaluate(() => window.game.renderer.info.render.frame);
  await page.keyboard.down('KeyW');
  let i = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const k = keys[i++ % keys.length];
    if (k !== 'KeyW') { await page.keyboard.down(k); await page.waitForTimeout(250); await page.keyboard.up(k); }
    await page.mouse.move(640 + Math.sin(i) * 100, 360);
    await page.waitForTimeout(150);
  }
  await page.keyboard.up('KeyW');
  await page.evaluate(() => { window.game.player.focus = 100; });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(600);
  const f1 = await page.evaluate(() => window.game.renderer.info.render.frame);
  fps[hero] = ((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1);
  await shot(`${hero}.png`);
  const st = await page.evaluate(() => ({ state: window.game.state, pos: window.game.player.pos.toArray().map((v) => +v.toFixed(1)), hp: window.game.player.hp, enemies: window.game.enemies.list?.filter?.((e) => e.alive).length }));
  console.log(hero, JSON.stringify(st), 'fps≈', fps[hero]);
}

await browser.close();
server.close();
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of [...new Set(errors)].slice(0, 20)) console.error(' -', e.slice(0, 600));
  process.exit(1);
}
console.log('\nSMOKE OK — screenshots in', out);
