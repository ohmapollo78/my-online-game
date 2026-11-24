// ANIMAL DASH: ULTIMATE RACE — browser entry point.
import './ui/styles.css';
import { Renderer } from './engine/renderer';
import { MenuScene } from './game/menuScene';
import { App } from './game/app';
import { getTrackVisuals } from './game/raceScene';
import { net } from './network/netClient';
import { profiles } from './game/profile';
import { loadCharacterGlbs } from './characters/glbCharacters';

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  let renderer: Renderer;
  // anti-aliasing is fixed at context creation: settings toggle (applies after reload), ?msaa=0|1 overrides
  const q = new URLSearchParams(location.search);
  const msaa = q.has('msaa') ? q.get('msaa') !== '0' : profiles.settings.antialias;
  try { renderer = new Renderer(canvas, msaa); }
  catch (e) {
    root.innerHTML = `<div class="fatal"><h1>ANIMAL DASH</h1><p>WebGL2 is required. Please use an up-to-date Chrome or Edge.</p><pre>${String(e)}</pre></div>`;
    return;
  }
  renderer.resize();
  // Blender-made characters (GLB); any failure falls back to the procedural models
  const glbReport = await loadCharacterGlbs(renderer.gl);
  console.info('[characters]', glbReport.join(' | '));
  (window as any).__glbReport = glbReport;
  const menu = new MenuScene(renderer);
  getTrackVisuals(renderer.gl, 'stadium');
  menu.generatePortraits();
  const app = new App(renderer, menu, root);
  (window as any).__app = app;
  (window as any).__renderer = renderer;
  (window as any).__net = net; // exposed for automated browser tests (reconnection)

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    renderer.resize();
    // automated tests drive frames manually (background tabs have no rAF); avoid double updates
    if (!(window as any).__manualFrames) { try { app.frame(dt); } catch (e) { console.error(e); } }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.getElementById('boot')?.remove();
}

boot();
