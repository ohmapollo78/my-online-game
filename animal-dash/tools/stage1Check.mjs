// Stage 1 verification: Blender Pug GLB in the real game.
// Usage: GAME_URL=http://localhost:5173 node stage1Check.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../docs/stage1');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { checks: [], errors: [] };
const check = (ok, msg) => { result.checks.push({ ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

const browser = await puppeteer.launch({
  executablePath: BROWSER, headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => result.errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') result.errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(GAME_URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.menu', { timeout: 30000 });
const click = (t) => page.evaluate((x) => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.includes(x)); b?.click(); return !!b; }, t);
const shot = (f) => page.screenshot({ path: path.join(OUT, f) }).then(() => console.log('  shot', f));
const waitFor = async (fn, timeout = 60000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg)) return true; await sleep(250); } return false; };

const report = await page.evaluate(() => window.__glbReport);
console.log('GLB report:', report);
check(Array.isArray(report) && report.some((r) => r.startsWith('pug: GLB ok')), 'pug.glb loaded and converted');
await sleep(1500);
await shot('01-menu-lineup.png');

// character select (Pug)
await click('CHARACTERS'); await sleep(500);
await page.evaluate(() => document.querySelectorAll('.char-card')[0].click());
await sleep(2000);
await shot('02-character-select-pug.png');
const portrait = await page.evaluate(() => document.querySelector('.char-card img')?.getAttribute('src')?.length ?? 0);
check(portrait > 1000, 'Pug portrait rendered from the GLB model');
await click('SELECT'); await sleep(400);

// race as the Pug (autopilot drives the player)
await click('PLAY'); await sleep(400);
await page.evaluate(() => document.querySelectorAll('.char-card')[0].click());
await click('CONFIRM'); await sleep(400);
await click('NEXT'); await sleep(300);
await page.evaluate(() => [...document.querySelectorAll('.segb')].find((b) => b.textContent === '5').click());
await click('START RACE');
await page.waitForFunction(() => window.__app && window.__app.source, { timeout: 30000 });
await page.evaluate(() => window.__app.source.enableAutopilot('hard'));
await waitFor(() => window.__app.source.time() > -2.2);
await shot('03-race-start-idle.png');
const info = await page.evaluate(() => window.__app.source.infos[0]);
check(info.animal === 0, 'player is the Pug');
await waitFor(() => window.__app.source.time() > 6);
await shot('04-race-running.png');
// capture a jump and a slide/knockdown if they happen
const states = { jump: false, slide: false, knock: false };
const t0 = Date.now();
while (Date.now() - t0 < 50000 && (!states.jump || !states.slide)) {
  const st = await page.evaluate(() => window.__app.source.render[0].state);
  if (st === 2 && !states.jump) { states.jump = true; await shot('05-race-jump.png'); }
  if (st === 3 && !states.slide) { states.slide = true; await shot('06-race-slide.png'); }
  if (st === 5 && !states.knock) { states.knock = true; await shot('07-race-knockdown.png'); }
  await sleep(60);
}
check(states.jump, 'jump state rendered with the GLB Pug');
check(states.slide, 'slide state rendered with the GLB Pug');
// measure frame times mid-race
const perf = await page.evaluate(() => new Promise((res) => {
  const t = []; let last = performance.now(); const end = last + 10000;
  const f = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ fps: +(t.length / 10).toFixed(1), p50: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), draws: window.__renderer.stats.draws, tris: window.__renderer.stats.tris }); } };
  requestAnimationFrame(f);
}));
console.log('perf', JSON.stringify(perf));
result.perf = perf;
const fin = await waitFor(() => window.__app.source && window.__app.source.me().finished === 1, 150000);
check(fin, 'Pug finished the race');
await sleep(1200);
await shot('08-finish-victory.png');
const res = await waitFor(() => !!document.querySelector('.results'), 60000);
check(res, 'results screen reached');
await sleep(1500);
await shot('09-results-podium.png');
const errs = result.errors.filter((e) => !/DevTools|favicon|AudioContext/i.test(e));
check(errs.length === 0, `no console errors/warnings (${errs.length})`);
if (errs.length) console.log(errs.slice(0, 10));
fs.writeFileSync(path.join(OUT, 'stage1-results.json'), JSON.stringify({ ...result, glbReport: report }, null, 2));
await browser.close();
console.log(result.checks.every((c) => c.ok) ? 'STAGE 1 CHECKS PASSED' : 'STAGE 1 CHECKS FAILED');
