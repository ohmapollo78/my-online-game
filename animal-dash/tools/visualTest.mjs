// Automated browser verification for ANIMAL DASH.
// Drives a locally installed Chrome/Edge with puppeteer-core (no browser download):
//  - captures the required screenshots
//  - plays a full single-player race on both maps (AI autopilot drives the player)
//  - plays a 2-client online race and verifies identical results
//  - records FPS / frame-time / memory / network statistics
// Usage: GAME_URL=http://localhost:3000 node visualTest.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HEADLESS = process.env.HEADLESS !== '0';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const report = { url: GAME_URL, startedAt: new Date().toISOString(), checks: [], perf: {}, net: {}, gpu: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, msg) => { report.checks.push({ ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

const launch = () => puppeteer.launch({
  executablePath: BROWSER,
  headless: HEADLESS,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const browser = await launch();
// Client B runs in a separate browser process (own storage/profile, own window) like a second computer.
let browserB = null;

async function newPage(name, b = browser) {
  const page = await b.newPage();
  page.on('pageerror', (e) => { console.log(`[${name}] pageerror`, e.message); report.checks.push({ ok: false, msg: `[${name}] page error: ${e.message}` }); });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console.error`, m.text()); });
  await page.goto(GAME_URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.menu', { timeout: 30000 });
  return page;
}
const click = (page, text) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (b) b.click(); return !!b; }, text);
const shot = async (page, file) => { await page.screenshot({ path: path.join(OUT, file) }); console.log(`  screenshot ${file}`); };
const raceTime = (page) => page.evaluate(() => (window.__app.source ? window.__app.source.time() : null));
async function waitFor(page, fn, timeout = 120000, arg, interval = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg)) return true; await sleep(interval); }
  return false;
}
const setName = (page, name) => page.evaluate((n) => { const i = document.querySelector('.name-input'); if (i) { i.value = n; i.dispatchEvent(new Event('change')); } }, name);

// ------------------------------------------------------------------ single player
const page = await newPage('A');
report.gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'no webgl2';
});
console.log('GPU:', report.gpu);
await setName(page, 'Tester');
await sleep(1500);
await shot(page, '01-main-menu.png');
await click(page, 'CHARACTERS'); await sleep(800);
await page.evaluate(() => document.querySelectorAll('.char-card')[1].click()); await sleep(800);
await shot(page, '02-character-select.png');
await click(page, 'SELECT'); await sleep(400);

/** Performance run: a full autopiloted race with no screenshots (screenshots stall frames). */
async function perfRace(trackIndex, key) {
  await click(page, 'PLAY'); await sleep(400);
  await page.evaluate(() => document.querySelectorAll('.char-card')[1].click());
  await click(page, 'CONFIRM'); await sleep(500);
  await page.evaluate((i) => document.querySelectorAll('.track-card')[i].click(), trackIndex); await sleep(300);
  await click(page, 'NEXT'); await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll('.segb')].find((b) => b.textContent === '7').click());
  await click(page, 'START RACE');
  await page.waitForFunction(() => window.__app && window.__app.source, { timeout: 30000 });
  await page.evaluate(() => window.__app.source.enableAutopilot('hard'));
  // poll rarely: every page.evaluate interrupts rendering and would distort the frame times
  const ok = await waitFor(page, () => !!document.querySelector('.results'), 240000, undefined, 3000);
  const perf = await page.evaluate(() => ({ ...window.__lastPerf, culledPerFrame: window.__renderer.stats.culled }));
  report.perf[key] = perf;
  check(ok, `performance race completed (${key})`);
  console.log('  perf', key, JSON.stringify(perf));
  await click(page, 'Main menu'); await sleep(600);
}

async function singleRace(trackIndex, prefix) {
  await click(page, 'PLAY'); await sleep(400);
  await page.evaluate(() => document.querySelectorAll('.char-card')[1].click());
  await click(page, 'CONFIRM'); await sleep(500);
  await page.evaluate((i) => document.querySelectorAll('.track-card')[i].click(), trackIndex); await sleep(400);
  if (trackIndex === 0) await shot(page, '03-map-select.png');
  await click(page, 'NEXT'); await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('.segb')].find((b) => b.textContent === '7').click());
  if (trackIndex === 0) await shot(page, '04-race-setup.png');
  await click(page, 'START RACE');
  await page.waitForFunction(() => window.__app && window.__app.source, { timeout: 30000 });
  await page.evaluate(() => window.__app.source.enableAutopilot('hard'));
  await waitFor(page, () => window.__app.source.time() > -1.6, 20000);
  if (trackIndex === 0) await shot(page, '05-countdown.png');
  await waitFor(page, (t) => window.__app.source && window.__app.source.time() > t, 60000, trackIndex === 0 ? 11 : 9);
  await shot(page, `${prefix}-race.png`);
  // power-up activation: wait for the local "Used ..." notification
  if (trackIndex === 0) {
    const got = await waitFor(page, () => [...document.querySelectorAll('.note.item')].some((n) => n.textContent.startsWith('Used')), 60000);
    if (got) await shot(page, '07-powerup-activation.png');
    check(got, 'power-up activation observed during single-player race');
  } else {
    await waitFor(page, () => window.__app.source && window.__app.source.time() > 30, 60000);
    await shot(page, `${prefix}-race-2.png`);
  }
  const fin = await waitFor(page, () => window.__app.source && window.__app.source.me().finished === 1, 180000);
  check(fin, `player finished the ${prefix} race`);
  await sleep(900);
  await shot(page, `${prefix}-finish-line.png`);
  const res = await waitFor(page, () => !!document.querySelector('.results'), 60000);
  check(res, `results screen shown (${prefix})`);
  await sleep(1500);
  await shot(page, `${prefix}-results.png`);
  const out = await page.evaluate(() => ({ perf: window.__lastPerf, results: window.__lastResults }));
  report.perf[`${prefix}-withScreenshots`] = out.perf;
  check(out.results.entries.length === 8 && out.results.entries.every((e) => e.place >= 1), `${prefix}: 8 racers ranked`);
  console.log('  perf', JSON.stringify(out.perf));
  await click(page, 'Main menu'); await sleep(600);
}
if (process.env.SKIP_SCREENSHOT_RACES !== '1') {
  await singleRace(0, '06-stadium');
  await singleRace(1, '10-arena');
}
if (process.env.SKIP_PERF !== '1') {
  await perfRace(0, 'stadium1080p');
  await perfRace(1, 'arena1080p');
}

await click(page, 'GARAGE'); await sleep(900); await shot(page, '11-garage.png');
await click(page, 'Back'); await sleep(300);
await click(page, 'SETTINGS'); await sleep(500); await shot(page, '12-settings.png');
await click(page, 'Back'); await sleep(300);

// ------------------------------------------------------------------ multiplayer (two clients)
browserB = await launch();
const pageB = await newPage('B', browserB);
// Two full renderers + the game server share one laptop here: lighten rendering for this section.
const MP_W = Number(process.env.MP_WIDTH ?? 960), MP_H = Math.round(MP_W * 9 / 16);
for (const p of [page, pageB]) {
  await p.setViewport({ width: MP_W, height: MP_H, deviceScaleFactor: 1 });
  await p.evaluate(() => { window.__renderer.renderScale = 0.75; window.__renderer.shadowsEnabled = false; });
}
await setName(page, 'Alice'); await setName(pageB, 'Bob');
await click(page, 'CREATE / JOIN'); await sleep(300); await click(page, 'CREATE ROOM');
await page.waitForSelector('.room-code .code', { timeout: 20000 });
const code = await page.$eval('.room-code .code', (e) => e.textContent);
check(/^[A-Z]{3,4}\d{3}$/.test(code), `room code generated: ${code}`);
await click(pageB, 'CREATE / JOIN'); await sleep(300);
await pageB.type('.code-input', code.toLowerCase());
await click(pageB, 'JOIN');
await pageB.waitForSelector('.room-code .code', { timeout: 20000 });
await pageB.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Change animal')).click()); await sleep(400);
await pageB.evaluate(() => document.querySelectorAll('.char-card')[4].click()); await click(pageB, 'CONFIRM'); await sleep(700);
await click(pageB, 'READY'); await sleep(800);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Change animal')).click()); await sleep(400);
await page.evaluate(() => document.querySelectorAll('.char-card')[0].click()); await click(page, 'CONFIRM'); await sleep(700);
await page.evaluate(() => [...document.querySelectorAll('.lobby-settings .segb')].find((b) => b.textContent === '2').click()); await sleep(800);
const lobbyA = await page.$eval('.slots', (e) => e.innerText);
check(lobbyA.includes('Bob') && lobbyA.includes('Black Cat') && lobbyA.includes('READY'), 'host lobby shows Bob (Black Cat, READY) immediately');
await shot(page, '13-multiplayer-lobby.png');
// page A still holds results from its single-player races: clear them so we only accept the online results
for (const p of [page, pageB]) await p.evaluate(() => { window.__lastResults = null; window.__netStats = null; });
await click(page, 'START RACE');
const startBoth = await Promise.all([page, pageB].map((p) => p.waitForFunction(() => window.__app && window.__app.source && window.__app.source.online, { timeout: 30000, polling: 200 }).then(() => true, () => false)));
check(startBoth.every(Boolean), 'both clients entered the same race');
// simple keyboard bots: boost bursts, jumps, items, abilities
for (const [p, seed] of [[page, 0], [pageB, 7]]) {
  await p.evaluate((sd) => {
    let k = 0;
    const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    setInterval(() => { k++; if (k % 50 === 0) key('ShiftLeft', true); if (k % 50 === 25) key('ShiftLeft', false); if (k % (13 + sd) === 0) { key('ArrowUp', true); key('ArrowUp', false); } if (k % 8 === 0) { key('Space', true); key('Space', false); } if (k % 150 === 0) { key('KeyE', true); key('KeyE', false); } }, 33);
  }, seed);
}
await waitFor(page, () => window.__app.source && window.__app.source.time() > 12, 60000);
await shot(page, '14-multiplayer-race-host.png');
await shot(pageB, '14b-multiplayer-race-guest.png');
const sync = await Promise.all([page, pageB].map((p) => p.evaluate(() => { const s = window.__app.source; return { me: s.myIdx, s: s.render.map((r) => r.s), v: s.render.map((r) => r.v), rtt: s.ping(), t: Date.now() }; })));
check(sync[0].me !== sync[1].me, 'clients control different racers');
// The host renders the guest ~100 ms in the past plus one-way latency; the guest's own view is predicted ahead.
const guest = sync[1].me;
const expectedLag = sync[1].v[guest] * (0.1 + (sync[0].rtt + sync[1].rtt) / 1000 + Math.abs(sync[1].t - sync[0].t) / 1000);
const dsA = Math.abs(sync[1].s[guest] - sync[0].s[guest]);
report.net.viewOffset = { metres: +dsA.toFixed(2), expectedFromLatency: +expectedLag.toFixed(2) };
check(dsA < expectedLag + 6, `host's view of guest is ${dsA.toFixed(2)} m behind guest's own (expected ≈${expectedLag.toFixed(2)} m from interpolation + latency)`);
const onlineResults = () => !!window.__lastResults && ['Alice', 'Bob'].every((n) => window.__lastResults.entries.some((e) => e.name.startsWith(n)));
const doneA = await waitFor(page, onlineResults, 200000, undefined, 1000);
const doneB = await waitFor(pageB, onlineResults, 30000, undefined, 1000);
check(doneA && doneB, 'both clients received final results');
const [rA, rB] = await Promise.all([page, pageB].map((p) => p.evaluate(() => JSON.stringify(window.__lastResults))));
check(rA === rB, 'final rankings identical on both clients');
await sleep(1500);
await shot(page, '15-multiplayer-results.png');
report.net.host = await page.evaluate(() => window.__netStats);
report.net.guest = await pageB.evaluate(() => window.__netStats);
report.perf.multiplayerHost = await page.evaluate(() => window.__lastPerf);
report.multiplayerResults = JSON.parse(rA);
console.log('net', JSON.stringify(report.net));

report.finishedAt = new Date().toISOString();
report.passed = report.checks.every((c) => c.ok);
fs.writeFileSync(path.resolve(here, '../docs/test-results.json'), JSON.stringify(report, null, 2));
console.log(report.passed ? '\nALL BROWSER TESTS PASSED' : '\nSOME BROWSER TESTS FAILED');
await browser.close();
if (browserB) await browserB.close();
process.exit(report.passed ? 0 : 1);
