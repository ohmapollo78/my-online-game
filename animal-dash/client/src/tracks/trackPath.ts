// Integrates a track's path segments into a dense table so that track-space
// (s, lateral x, height y) maps to world space for rendering.
import { TrackDef } from '@shared/track';
import { Mat4 } from '../engine/math';

const STEP = 0.5;

export class TrackPath {
  readonly lapLength: number;
  readonly laps: number;
  private n: number;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private hd: Float32Array; // heading angle (forward = (sin h, 0, cos h)); right = (-cos h, 0, sin h)
  bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  constructor(def: TrackDef) {
    this.laps = def.laps;
    this.lapLength = def.segs.reduce((a, s) => a + s.len, 0);
    this.n = Math.ceil(this.lapLength / STEP) + 2;
    this.px = new Float32Array(this.n); this.py = new Float32Array(this.n); this.pz = new Float32Array(this.n); this.hd = new Float32Array(this.n);
    let x = 0, y = 0, z = 0, h = 0;
    let seg = 0, segStart = 0, segY0 = 0;
    for (let i = 0; i < this.n; i++) {
      const s = i * STEP;
      while (seg < def.segs.length - 1 && s > segStart + def.segs[seg].len) { segY0 += def.segs[seg].rise; segStart += def.segs[seg].len; seg++; }
      const sg = def.segs[seg];
      const k = Math.min(1, Math.max(0, (s - segStart) / sg.len));
      y = segY0 + sg.rise * k * k * (3 - 2 * k);
      this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.hd[i] = h;
      // advance
      const turnRate = ((sg.turn * Math.PI) / 180) / sg.len;
      const hMid = h + turnRate * STEP * 0.5;
      x += Math.sin(hMid) * STEP; z += Math.cos(hMid) * STEP;
      h += turnRate * STEP;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]); minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  wrap(s: number): number {
    if (this.laps <= 1) return Math.max(0, Math.min(this.lapLength + 40, s));
    const L = this.lapLength;
    return ((s % L) + L) % L;
  }

  /** Writes position, forward and right vectors at distance s (with extrapolation past the end). */
  sample(s: number, p: number[], f: number[], r: number[]): void {
    let extra = 0;
    if (this.laps <= 1 && s < 0) { extra = s; s = 0; } else s = this.wrap(s);
    const maxS = (this.n - 2) * STEP;
    if (s > maxS) { extra = s - maxS; s = maxS; }
    const fi = s / STEP;
    const i = Math.floor(fi);
    const t = fi - i;
    const j = Math.min(i + 1, this.n - 1);
    const h = this.hd[i] + (this.hd[j] - this.hd[i]) * t;
    const sh = Math.sin(h), ch = Math.cos(h);
    p[0] = this.px[i] + (this.px[j] - this.px[i]) * t + sh * extra;
    p[1] = this.py[i] + (this.py[j] - this.py[i]) * t;
    p[2] = this.pz[i] + (this.pz[j] - this.pz[i]) * t + ch * extra;
    f[0] = sh; f[1] = 0; f[2] = ch;
    r[0] = -ch; r[1] = 0; r[2] = sh;
  }

  heading(s: number): number {
    s = this.wrap(s);
    const i = Math.min(this.n - 1, Math.max(0, Math.round(s / STEP)));
    return this.hd[i];
  }

  private P = [0, 0, 0]; private F = [0, 0, 0]; private R = [0, 0, 0];

  point(s: number, x: number, y: number, out: number[]): number[] {
    this.sample(s, this.P, this.F, this.R);
    out[0] = this.P[0] + this.R[0] * x;
    out[1] = this.P[1] + y;
    out[2] = this.P[2] + this.R[2] * x;
    return out;
  }

  /** Model matrix at (s, x, y) facing along the track; optional extra yaw. Local +x = track left. */
  frame(s: number, x: number, y: number, out: Mat4, yaw = 0, scale = 1): Mat4 {
    this.sample(s, this.P, this.F, this.R);
    const h = Math.atan2(this.F[0], this.F[2]) + yaw;
    const sh = Math.sin(h), ch = Math.cos(h);
    // columns: local x -> left (ch, 0, -sh); y -> up; z -> forward (sh, 0, ch)
    out[0] = ch * scale; out[1] = 0; out[2] = -sh * scale; out[3] = 0;
    out[4] = 0; out[5] = scale; out[6] = 0; out[7] = 0;
    out[8] = sh * scale; out[9] = 0; out[10] = ch * scale; out[11] = 0;
    out[12] = this.P[0] + this.R[0] * x; out[13] = this.P[1] + y; out[14] = this.P[2] + this.R[2] * x; out[15] = 1;
    return out;
  }

  /** Nearest distance from a world XZ point to the centre line (coarse, for decoration placement). */
  distanceTo(x: number, z: number): { d: number; s: number } {
    let best = Infinity, bs = 0;
    for (let i = 0; i < this.n; i += 8) {
      const dx = this.px[i] - x, dz = this.pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bs = i * STEP; }
    }
    return { d: Math.sqrt(best), s: bs };
  }
  heightAt(s: number): number { this.sample(s, this.P, this.F, this.R); return this.P[1]; }
}
