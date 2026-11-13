// Regression suite for Spider-Man: Symbiote City. Headless Chromium (software GL) driving the real game.
//   npm run build && npm run regress [-- --only=boot,vehicles --map=nyc|singapore --dist=dist]
// Frames are stepped manually (rendering stubbed) so checks are deterministic; a real render is only done
// where noted. Exit code is non-zero when any check fails. Checks live in tools/regress/checks.mjs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ALL_CHECKS } from './regress/checks.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(join(process.execPath, '../../lib/node_modules/playwright')));
}
const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const only = args.only ? String(args.only).split(',') : null;
const maps = args.map ? String(args.map).split(',') : ['nyc', 'singapore'];
const root = resolve(args.dist || join(here, '..', 'dist'));
if (!existsSync(join(root, 'index.html'))) { console.log('dist missing, building...'); execSync('npx vite build', { cwd: join(here, '..'), stdio: 'inherit' }); }
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { const body = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('nf'); }
}).listen(0);
const url = `http://localhost:${server.address().port}/index.html`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });

// Page-side helpers (window.qa). Kept in one function so it serialises into the page.
function installQA() {
  const g = () => window.game;
  const qa = window.qa = {
    errors: [],
    /** step n frames at a fixed 60 Hz; rendering is stubbed. */
    step(n = 1, each) {
      const game = g();
      for (let i = 0; i < n; i++) { game.frame(); if (each) each(i); }
    },
    stepSec(s, each) { qa.step(Math.round(s * 60), each); },
    press(code, frames = 2) { const k = g().input.keys; k.add(code); qa.step(frames); k.delete(code); qa.step(1); },
    hold(...codes) { for (const c of codes) g().input.keys.add(c); },
    release(...codes) { if (!codes.length) g().input.keys.clear(); for (const c of codes) g().input.keys.delete(c); },
    mouse(b, on) { if (on) g().input.mouseButtons.add(b); else g().input.mouseButtons.delete(b); },
    begin(hero = 'spiderman', opts) {
      const game = g();
      game.hud.hideMenus?.(); game.state = 'menu';
      game.begin(hero, opts);
      game.input.keys.clear(); game.input.mouseButtons.clear();
      qa.step(3);
    },
    /** place the player on solid ground at x,z */
    put(x, z, yaw = 0, y) {
      const game = g(), p = game.player;
      const gy = y ?? game.physics.heightAt(x, z, 3);
      p.pos.set(x, gy + 0.05, z); p.vel.set(0, 0, 0); p.yaw = yaw;
      game.cam.recenter?.(yaw);
      qa.step(2);
    },
    /** a point on a road: position + heading of some moving AI traffic car near the anchor */
    roadSpot(minDist = 20) {
      const vs = g().vehicles;
      let best = null;
      for (const v of vs.list) {
        if (!v.active || v.reserve || v.wrecked || v.driver !== 'ai' || Math.abs(v.speed) < 2 || v.kind === 'bus') continue;
        if (!best || Math.abs(v.dist - 80) < Math.abs(best.dist - 80)) best = v;
      }
      if (!best) return null;
      return { x: best.pos.x, z: best.pos.z, yaw: best.yaw };
    },
    /** park a car of `kind` on a road with the player standing beside it (on the ground). Returns the car. */
    stageCar(kind = 'sedan', { ai = false, speed = 0, side = 3.2 } = {}) {
      const game = g(), vs = game.vehicles;
      const spot = qa.roadSpot();
      if (!spot) return null;
      let v = vs.list.find((c) => c.active && !c.reserve && !c.wrecked && c.kind === kind && c.driver !== 'player' && Math.hypot(c.pos.x - spot.x, c.pos.z - spot.z) > 15);
      if (!v) {
        v = vs.list.find((c) => c.active && !c.reserve && !c.wrecked && c.kind !== 'bus' && c.kind !== 'police' && Math.hypot(c.pos.x - spot.x, c.pos.z - spot.z) > 15);
        vs._releaseModel(v); v.setKind(kind);
      }
      v.place(spot.x, spot.z, spot.yaw, speed);
      v.driver = ai ? 'ai' : null; v.ai = null; v.parked = !ai; v.asleep = !ai && speed === 0;
      if (ai) { vs._giveAI(v); v.driver = 'ai'; v.speed = speed; v.vel.set(Math.sin(v.yaw) * speed, 0, Math.cos(v.yaw) * speed); }
      v.hp = v.maxHp; v.invuln = 0;
      const sy = Math.sin(spot.yaw), cy = Math.cos(spot.yaw);
      const px = spot.x - cy * side, pz = spot.z + sy * side;   // to the car's left
      qa.put(px, pz, spot.yaw);
      return v;
    },
    finite(v) { return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); },
    snap() {
      const game = g(), p = game.player;
      return { state: game.state, hp: p?.hp, focus: p?.focus, pos: p ? [p.pos.x, p.pos.y, p.pos.z].map((v) => +v.toFixed(2)) : null, id: p?.id };
    },
  };
  // neutralise rendering + timing
  const game = g();
  game.renderer.setAnimationLoop(null);
  game.clock.getDelta = () => 1 / 60;
  qa._realRender = game.post.render.bind(game.post);
  game.post.render = () => {};
  qa.renderOnce = () => { game.post.render = qa._realRender; try { game.frame(); } finally { game.post.render = () => {}; } };
  window.addEventListener('error', (e) => qa.errors.push('window.onerror ' + e.message));
}

const results = [];
let failed = 0;
const COL = { pass: '\x1b[32m', fail: '\x1b[31m', dim: '\x1b[2m', off: '\x1b[0m' };

for (const map of maps) {
  const selected = ALL_CHECKS.filter((c) => (!only || only.includes(c.name)) && (!c.maps || c.maps.includes(map)));
  if (!selected.length) continue;
  console.log(`\n=== map: ${map} ===`);
  let page = null, errors = [];
  const consoleLog = [];
  const open = async (settings = null) => {
    if (page) await page.close().catch(() => {});
    page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.setDefaultTimeout(600000);
    errors.length = 0;
    page.on('console', (m) => { const t = m.text(); consoleLog.push(t); if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e).slice(0, 500)));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.addInitScript(({ s, map }) => {
      window.__FORCE_WORLD_QUALITY = 'low';
      window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
      try { if (!sessionStorage.getItem('qa-seeded')) { sessionStorage.setItem('qa-seeded', '1'); localStorage.clear(); localStorage.setItem('sm-settings', JSON.stringify({ quality: 'low', map, ...(s || {}) })); } } catch {}
    }, { s: settings, map });
    await page.goto(url);
    await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 180000 });
    await page.evaluate(installQA);
  };
  const ctx = {
    map, args,
    get page() { return page; },
    open,
    /** reload the page keeping localStorage (persistence checks) */
    reload: async () => {
      await page.reload();
      await page.waitForFunction(() => window.game && window.game.state === 'menu', null, { timeout: 180000 });
      await page.evaluate(installQA);
    },
    ev: (fn, arg) => page.evaluate(fn, arg),
    get errors() { return errors; },
    clearErrors: () => { errors.length = 0; },
    async pageErrors() { return [...errors, ...(await page.evaluate(() => window.qa?.errors ?? []).catch(() => []))]; },
    wait: (ms) => page.waitForTimeout(ms),
    shot: async (name) => { await page.evaluate(() => window.qa.renderOnce()); await page.screenshot({ path: join(shots, name), timeout: 180000 }); },
    log: (...a) => console.log(COL.dim + '    ' + a.join(' ') + COL.off),
    assert(cond, msg) { if (!cond) throw new Error(msg); },
    consoleLog,
  };
  await open();
  for (const c of selected) {
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try {
      ctx.clearErrors();
      if (c.fresh) await open(c.settings || null);
      else await ctx.ev(() => { window.qa.errors.length = 0; });
      const r = await c.run(ctx);
      detail = r?.detail ?? (typeof r === 'string' ? r : '');
      if (!c.allowErrors) {
        const errs = await ctx.pageErrors();
        if (errs.length) throw new Error('console/page errors: ' + [...new Set(errs)].slice(0, 4).map((e) => e.slice(0, 300)).join(' | '));
      }
    } catch (e) {
      status = 'FAIL'; detail = String(e.message || e).split('\n')[0].slice(0, 700); failed++;
      try { await open(); } catch (e2) { console.log('  reopen failed', e2.message); }   // clean page for the next check
    }
    results.push({ map, name: c.name, status, detail });
    const colr = status === 'PASS' ? COL.pass : COL.fail;
    console.log(`${colr}${status}${COL.off} ${c.name} ${COL.dim}(${((Date.now() - t0) / 1000).toFixed(1)}s)${COL.off} ${detail}`);
  }
  await page.close().catch(() => {});
}
await browser.close();
server.close();
const total = results.length;
console.log(`\n${total - failed}/${total} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
