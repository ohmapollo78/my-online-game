// Frame-time probe: starts an autopiloted Stadium race and samples real rAF frame times
// for several graphics configurations. Usage: GAME_URL=http://localhost:3000 node perfProbe.mjs
import puppeteer from 'puppeteer-core';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:3000';
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SECONDS = Number(process.env.SECONDS ?? 15);
const configs = process.env.AB_GLB ? [
  { name: 'GLB pug', q: '', shadows: true, scale: 1 },
  { name: 'procedural pug (?glb=0)', q: '?glb=0', shadows: true, scale: 1 },
  { name: 'GLB pug (repeat)', q: '', shadows: true, scale: 1 },
  { name: 'procedural pug (repeat)', q: '?glb=0', shadows: true, scale: 1 },
] : [
  { name: 'default (MSAA, shadows, 100%)', q: '', shadows: true, scale: 1 },
  { name: 'no MSAA', q: '?msaa=0', shadows: true, scale: 1 },
  { name: 'no shadows', q: '', shadows: false, scale: 1 },
  { name: 'render scale 80%', q: '', shadows: true, scale: 0.8 },
  { name: 'no MSAA + 80%', q: '?msaa=0', shadows: true, scale: 0.8 },
];
const browser = await puppeteer.launch({
  executablePath: BROWSER, headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const results = [];
for (const c of configs) {
  const page = await browser.newPage();
  await page.goto(GAME_URL + c.q, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.menu');
  await page.evaluate((cfg) => { window.__renderer.shadowsEnabled = cfg.shadows; window.__renderer.renderScale = cfg.scale; }, c);
  const click = (t) => page.evaluate((x) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(x))?.click(), t);
  await click('PLAY'); await new Promise((r) => setTimeout(r, 300));
  await click('CONFIRM'); await new Promise((r) => setTimeout(r, 300));
  await click('NEXT'); await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => [...document.querySelectorAll('.segb')].find((b) => b.textContent === '7').click());
  await click('START RACE');
  await page.waitForFunction(() => window.__app && window.__app.source);
  await page.evaluate(() => window.__app.source.enableAutopilot('hard'));
  await new Promise((r) => setTimeout(r, 5000));
  const r = await page.evaluate((secs) => new Promise((res) => {
    const t = []; let last = performance.now(); const end = last + secs * 1000;
    const f = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ n: t.length, fps: +(t.length / secs).toFixed(1), p50: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), p99: +t[Math.floor(t.length * 0.99)].toFixed(1) }); } };
    requestAnimationFrame(f);
  }), SECONDS);
  results.push({ config: c.name, ...r });
  console.log(c.name.padEnd(34), JSON.stringify(r));
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results));
