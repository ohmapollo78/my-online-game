// Stage 1: verify garage cosmetics still attach correctly to the GLB Pug.
import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:4173';
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
await page.goto(GAME_URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.menu');
for (const [i, look] of [['hat_crown', 'gl_sun', 'out_scarf', ''], ['hat_cap', 'gl_round', 'out_vest', 'skin_gold']].entries()) {
  await page.evaluate(([hat, gl, out, skin]) => {
    const key = 'animaldash.profile.v1';
    const p = JSON.parse(localStorage.getItem(key));
    p.selectedAnimal = 0;
    p.unlocked = Array.from(new Set([...p.unlocked, hat, gl, out, skin].filter(Boolean)));
    p.loadout = { ...p.loadout, hat, glasses: gl, outfit: out, skin };
    localStorage.setItem(key, JSON.stringify(p));
  }, look);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.menu');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('GARAGE')).click());
  await new Promise((r) => setTimeout(r, 2500));
  const file = path.resolve(here, `../docs/stage1/10-cosmetics-${i + 1}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}
await browser.close();
