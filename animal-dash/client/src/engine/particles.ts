// Pooled CPU particle system rendered as instanced billboards (no per-frame allocation).
export class ParticleSystem {
  readonly max: number;
  count = 0;
  // simulation state (struct-of-arrays)
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private maxLife: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private col: Float32Array; private grav: Float32Array; private drag: Float32Array;
  private add: Uint8Array;
  /** GPU data: posSize(4) + color(4) per particle, split by blend mode */
  alphaData: Float32Array; addData: Float32Array;
  alphaCount = 0; addCount = 0;

  constructor(max = 4000) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f(); this.s0 = f(); this.s1 = f(); this.grav = f(); this.drag = f();
    this.col = new Float32Array(max * 4);
    this.add = new Uint8Array(max);
    this.alphaData = new Float32Array(max * 8);
    this.addData = new Float32Array(max * 8);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number,
    r: number, g: number, b: number, a: number, gravity = 0, additive = false, drag = 0): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = size0; this.s1[i] = size1;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.grav[i] = gravity; this.drag[i] = drag; this.add[i] = additive ? 1 : 0;
  }

  burst(n: number, /* count */ x: number, y: number, z: number, speed: number, life: number, size: number, r: number, g: number, b: number, a = 1, gravity = -6, additive = false, up = 0.5): void {
    for (let k = 0; k < n; k++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI - Math.PI / 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, Math.cos(th) * Math.cos(ph) * sp, (Math.abs(Math.sin(ph)) + up) * sp, Math.sin(th) * Math.cos(ph) * sp,
        life * (0.6 + Math.random() * 0.6), size, size * 0.2, r, g, b, a, gravity, additive, 1.5);
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr + this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      i++;
    }
    this.alphaCount = 0; this.addCount = 0;
    for (let k = 0; k < this.count; k++) {
      const t = 1 - this.life[k] / this.maxLife[k];
      const size = this.s0[k] + (this.s1[k] - this.s0[k]) * t;
      const fade = Math.min(1, (1 - t) * 3) * Math.min(1, t * 12 + 0.2);
      const arr = this.add[k] ? this.addData : this.alphaData;
      const j = (this.add[k] ? this.addCount++ : this.alphaCount++) * 8;
      arr[j] = this.px[k]; arr[j + 1] = this.py[k]; arr[j + 2] = this.pz[k]; arr[j + 3] = size;
      arr[j + 4] = this.col[k * 4]; arr[j + 5] = this.col[k * 4 + 1]; arr[j + 6] = this.col[k * 4 + 2]; arr[j + 7] = this.col[k * 4 + 3] * fade;
    }
  }

  clear(): void { this.count = 0; this.alphaCount = 0; this.addCount = 0; }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.s0[i] = this.s0[last]; this.s1[i] = this.s1[last];
    this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last]; this.add[i] = this.add[last];
    for (let c = 0; c < 4; c++) this.col[i * 4 + c] = this.col[last * 4 + c];
  }
}
