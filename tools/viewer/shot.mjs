import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(join(process.execPath, '../../lib/node_modules/playwright'))); }
const [,, ids, view = 'front', out = 'out.png', q = 'high', extra = ''] = process.argv;
const port = 5199;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 480 * ids.split(',').length, height: 640 } });
const errs = []; p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e.stack || e)));
await p.goto(`http://localhost:${port}/tools/viewer/index.html?ids=${ids}&view=${view}&q=${q}&top=1${extra ? '&' + extra : ''}`);
try { await p.waitForFunction(() => globalThis.__done, null, { timeout: 120000 }); } catch { console.log('TIMEOUT'); }
console.log(JSON.stringify(await p.evaluate(() => ({ info: globalThis.__info, t: globalThis.__t }))));
await p.screenshot({ path: out });
if (errs.length) console.log('ERR', errs.slice(0, 5).join('\n'));
await b.close(); srv.kill();
process.exit(0);
