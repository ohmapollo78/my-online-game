// Canvas-generated textures (ads, banners, item box "?", chevrons, checkers, scoreboard).
import { makeCanvas, textureFromCanvas } from './gl';

const cache = new Map<string, WebGLTexture>();
function cached(gl: WebGL2RenderingContext, key: string, make: () => HTMLCanvasElement, repeat = false): WebGLTexture {
  let t = cache.get(key);
  if (!t) { t = textureFromCanvas(gl, make(), repeat); cache.set(key, t); }
  return t;
}

export function pawPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.25, s * 0.42, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  for (const [dx, dy] of [[-0.42, -0.2], [-0.15, -0.45], [0.15, -0.45], [0.42, -0.2]]) {
    ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s, s * 0.14, s * 0.18, dx * 0.6, 0, Math.PI * 2); ctx.fill();
  }
}

export function adTexture(gl: WebGL2RenderingContext, text: string, bg: string, fg: string, accent: string): WebGLTexture {
  return cached(gl, `ad:${text}:${bg}`, () => {
    const [c, ctx] = makeCanvas(512, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, bg); g.addColorStop(1, shade(bg, -30));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = accent;
    for (let i = 0; i < 6; i++) pawPath(ctx, 40 + i * 90, 64 + (i % 2 ? 18 : -18), 26);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg;
    ctx.font = 'bold 66px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = shade(bg, -60);
    ctx.strokeText(text, 256, 68); ctx.fillText(text, 256, 68);
    return c;
  });
}

export function questionTexture(gl: WebGL2RenderingContext): WebGLTexture {
  return cached(gl, 'question', () => {
    const [c, ctx] = makeCanvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 90);
    g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#ff9a1a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 118, 118);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 92px "Arial Black", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#c45a00'; ctx.strokeText('?', 64, 70); ctx.fillText('?', 64, 70);
    return c;
  });
}

export function chevronTexture(gl: WebGL2RenderingContext, a: string, b: string): WebGLTexture {
  return cached(gl, `chev:${a}:${b}`, () => {
    const [c, ctx] = makeCanvas(128, 256);
    ctx.fillStyle = a; ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = b;
    for (let i = 0; i < 3; i++) {
      const y = 30 + i * 80;
      ctx.beginPath(); ctx.moveTo(10, y + 50); ctx.lineTo(64, y); ctx.lineTo(118, y + 50); ctx.lineTo(118, y + 75); ctx.lineTo(64, y + 25); ctx.lineTo(10, y + 75); ctx.closePath(); ctx.fill();
    }
    return c;
  }, true);
}

export function checkerTexture(gl: WebGL2RenderingContext): WebGLTexture {
  return cached(gl, 'checker', () => {
    const [c, ctx] = makeCanvas(256, 64);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'; ctx.fillRect(x * 16, y * 16, 16, 16); }
    return c;
  }, true);
}

export function bannerTexture(gl: WebGL2RenderingContext, text: string, bg: string, fg: string): WebGLTexture {
  return cached(gl, `banner:${text}:${bg}`, () => {
    const [c, ctx] = makeCanvas(1024, 160);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 160);
    for (let x = 0; x < 1024; x += 64) { ctx.fillStyle = (x / 64) % 2 ? '#111' : '#fff'; ctx.fillRect(x, 0, 64, 18); ctx.fillStyle = (x / 64) % 2 ? '#fff' : '#111'; ctx.fillRect(x, 142, 64, 18); }
    ctx.fillStyle = fg; ctx.font = 'bold 88px "Arial Black", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.strokeStyle = '#1b1b3a'; ctx.strokeText(text, 512, 84); ctx.fillText(text, 512, 84);
    return c;
  });
}

export function scoreboardTexture(gl: WebGL2RenderingContext): WebGLTexture {
  return cached(gl, 'scoreboard', () => {
    const [c, ctx] = makeCanvas(512, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#16224a'); g.addColorStop(1, '#0b1028');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#ffcc33'; ctx.font = 'bold 54px "Arial Black", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ANIMAL DASH', 256, 80);
    ctx.fillStyle = '#5ee0ff'; ctx.font = 'bold 34px Arial, sans-serif'; ctx.fillText('ULTIMATE RACE', 256, 130);
    ctx.fillStyle = '#ff5ea8';
    for (let i = 0; i < 7; i++) pawPath(ctx, 50 + i * 69, 200, 22);
    return c;
  });
}

export function gateTexture(gl: WebGL2RenderingContext, label: string, color: string): WebGLTexture {
  return cached(gl, `gate:${label}`, () => {
    const [c, ctx] = makeCanvas(256, 64);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px "Arial Black", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 34);
    return c;
  });
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
