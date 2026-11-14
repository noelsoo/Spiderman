// Animation contact sheets. Usage:
//   node tools/animsheet.mjs <id> <state,state,...> <out.png> [frames=10] [cell=150] [views=side,q]
// Boots the vite dev server, steps the model through each scripted state and tiles frames (columns) by state/view (rows).
// Prints a foot-slide report for locomotion states (slide ratio = |planted foot speed - ground speed| / ground speed).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(join(process.execPath, '../../lib/node_modules/playwright'))); }
const [,, id = 'spiderman', states = 'idle,run', out = 'sheet.png', frames = '10', cell = '150', views = 'side,q'] = process.argv;
const port = 5300 + Math.floor(Math.random() * 400);
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const nrows = states.split(',').length * views.split(',').length, w = Number(cell) * Number(frames), h = Math.round(Number(cell) * 1.35) * nrows;
const p = await b.newPage({ viewport: { width: w, height: h } });
const errs = []; p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e.stack || e)));
await p.goto(`http://localhost:${port}/tools/viewer/anim.html?id=${id}&states=${states}&frames=${frames}&cell=${cell}&views=${views}${process.env.TRACE ? "&trace=1" : ""}`, { waitUntil: 'commit', timeout: 120000 });
try { await p.waitForFunction(() => globalThis.__done, null, { timeout: 240000 }); } catch { console.log('TIMEOUT'); }
console.log(id, JSON.stringify(await p.evaluate(() => globalThis.__info)));
await p.screenshot({ path: out });
if (errs.length) console.log('ERR', errs.slice(0, 5).join('\n'));
await b.close(); srv.kill();
process.exit(0);
