// Builds and draws the static environment of a map (chunked for frustum culling,
// instanced crowd and trees). Each map has its own visual identity.
import { TrackDef, Track, laneRangeAt } from '@shared/track';
import { getTrack } from '@shared/tracks';
import { laneX, LANE_COUNT } from '@shared/constants';
import { MeshBuilder, Mesh, M, RGB, writeInstance } from '../engine/mesh';
import { Renderer } from '../engine/renderer';
import { TrackPath } from './trackPath';
import { mat4, compose, hexToRgb, Mat4 } from '../engine/math';
import { adTexture, bannerTexture, checkerTexture, scoreboardTexture } from '../engine/textures';

const c = (h: number): RGB => hexToRgb(h);
const STEP = 2;
const CHUNK = 40;
const ID = mat4();

interface TexMesh { mesh: Mesh; tex: WebGLTexture | null; emissive?: number; anim?: number; shadow?: boolean; }

export class TrackScene {
  readonly path: TrackPath;
  readonly track: Track;
  readonly def: TrackDef;
  private static: TexMesh[] = [];
  private instanced: TexMesh[] = [];
  private balloons: { mesh: Mesh; x: number; y: number; z: number; ph: number }[] = [];
  edgeL: Float32Array; edgeR: Float32Array; // visual edges per metre
  private gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, def: TrackDef) {
    this.gl = gl;
    this.def = def;
    this.track = getTrack(def.id);
    this.path = new TrackPath(def);
    const n = Math.ceil(this.path.lapLength) + 2;
    this.edgeL = new Float32Array(n); this.edgeR = new Float32Array(n);
    this.computeEdges();
    this.buildSurface();
    if (def.id === 'stadium') this.buildStadium(); else this.buildArena();
    this.buildWalls();
    this.buildStartFinish();
  }

  applyEnvironment(r: Renderer): void {
    const e = r.env;
    if (this.def.id === 'stadium') {
      e.sunDir = norm([0.35, 0.85, 0.4]); e.sunColor = [1.3, 1.2, 1.05]; e.sky = [0.6, 0.72, 0.95]; e.ground = [0.32, 0.3, 0.26];
      e.fog = [0.75, 0.86, 1.0]; e.fogDensity = 0.0028; e.skyTop = [0.18, 0.45, 0.92]; e.skyHorizon = [0.72, 0.87, 1.0]; e.skyBottom = [0.5, 0.6, 0.5]; e.clouds = true;
    } else {
      e.sunDir = norm([-0.4, 0.8, 0.3]); e.sunColor = [1.3, 1.18, 1.0]; e.sky = [0.58, 0.72, 0.95]; e.ground = [0.3, 0.36, 0.22];
      e.fog = [0.78, 0.9, 1.0]; e.fogDensity = 0.0032; e.skyTop = [0.2, 0.52, 0.95]; e.skyHorizon = [0.78, 0.9, 1.0]; e.skyBottom = [0.45, 0.6, 0.4]; e.clouds = true;
    }
  }

  // ------------------------------------------------------------------ edges
  private computeEdges(): void {
    const n = this.edgeL.length;
    const fullL = laneX(0) - 1.2, fullR = laneX(LANE_COUNT - 1) + 1.2;
    const rawL = new Float32Array(n), rawR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [mn, mx] = laneRangeAt(this.track, i);
      rawL[i] = laneX(mn) - 1.2; rawR[i] = laneX(mx) + 1.2;
    }
    for (let i = 0; i < n; i++) {
      let l = rawL[i], r = rawR[i];
      for (let d = 1; d <= 20; d++) {
        const j = Math.min(n - 1, i + d), k = Math.max(0, i - d);
        l = Math.max(l, rawL[j] + (fullL - rawL[j]) * (d / 20));
        r = Math.min(r, rawR[j] + (fullR - rawR[j]) * (d / 20));
        if (d <= 8) { l = Math.max(l, rawL[k] + (fullL - rawL[k]) * (d / 8)); r = Math.min(r, rawR[k] + (fullR - rawR[k]) * (d / 8)); }
      }
      this.edgeL[i] = l; this.edgeR[i] = r;
    }
  }
  edgeAt(s: number, right: boolean): number {
    const i = Math.max(0, Math.min(this.edgeL.length - 1, Math.round(this.path.wrap(s))));
    return right ? this.edgeR[i] : this.edgeL[i];
  }

  private inPit(s: number, lane: number): boolean {
    for (const p of this.track.pits) if (s >= p.s0 && s <= p.s1 && lane >= p.lane0 && lane <= p.lane1) return true;
    return false;
  }

  // ------------------------------------------------------------------ track surface
  private buildSurface(): void {
    const L = this.path.lapLength;
    const stadium = this.def.id === 'stadium';
    const P = [0, 0, 0], Q = [0, 0, 0];
    const tiles = [c(0x9b7bff), c(0x4fc3ff), c(0x34d39a), c(0xffc93c), c(0xff7eb6)];
    for (let cs = 0; cs < L; cs += CHUNK) {
      const b = new MeshBuilder();
      const lines = new MeshBuilder();
      const ce = Math.min(L, cs + CHUNK);
      for (let s = cs; s < ce - 0.001; s += STEP) {
        const s2 = Math.min(ce, s + STEP);
        const bounds = (ss: number) => {
          const el = this.edgeAt(ss, false), er = this.edgeAt(ss, true);
          const xs = [el];
          for (let k = 0; k < LANE_COUNT - 1; k++) xs.push(Math.min(er, Math.max(el, laneX(k) + 0.8)));
          xs.push(er);
          return xs;
        };
        const xa = bounds(s), xb = bounds(s2);
        for (let k = 0; k < LANE_COUNT; k++) {
          if (this.inPit(s + 1, k)) continue;
          if (xa[k + 1] - xa[k] < 0.01 && xb[k + 1] - xb[k] < 0.01) continue;
          const col: RGB = stadium
            ? (Math.floor(s / 4) % 2 ? c(0xd2543f) : c(0xcc4e3a))
            : tiles[(Math.floor(s / 10) + k) % tiles.length];
          const shadeK = stadium ? 1 : ((Math.floor(s / 10) + k) % 2 ? 1 : 0.92);
          const cc: RGB = [col[0] * shadeK, col[1] * shadeK, col[2] * shadeK];
          const v0 = this.vert(b, s, xa[k], 0, cc), v1 = this.vert(b, s, xa[k + 1], 0, cc);
          const v2 = this.vert(b, s2, xb[k + 1], 0, cc), v3 = this.vert(b, s2, xb[k], 0, cc);
          b.quad(v0, v3, v2, v1);
        }
        // lane lines (white) for the stadium; edge lines for both
        const lineXs = stadium ? xa.map((_, i) => i) : [0, LANE_COUNT];
        for (const i of lineXs) {
          const x0 = xa[i], x1 = xb[i];
          if (i > 0 && i < LANE_COUNT && (xa[i] <= xa[0] + 0.01 || xa[i] >= xa[LANE_COUNT] - 0.01)) continue;
          const w = i === 0 || i === LANE_COUNT ? 0.12 : 0.07;
          const lc: RGB = [0.97, 0.97, 0.97];
          const a = this.vert(lines, s, x0 - w, 0.012, lc), bb = this.vert(lines, s, x0 + w, 0.012, lc);
          const cc2 = this.vert(lines, s2, x1 + w, 0.012, lc), d = this.vert(lines, s2, x1 - w, 0.012, lc);
          lines.quad(a, d, cc2, bb);
        }
        // track thickness skirt so elevated sections don't look paper thin
        if (!stadium) {
          for (const side of [0, 1]) {
            const x0 = side ? xa[LANE_COUNT] : xa[0], x1 = side ? xb[LANE_COUNT] : xb[0];
            const sc: RGB = c(0x6a4bd1);
            const a = this.vert(b, s, x0, 0, sc), bb = this.vert(b, s, x0, -1.2, sc), cc2 = this.vert(b, s2, x1, -1.2, sc), d = this.vert(b, s2, x1, 0, sc);
            b.quad(a, bb, cc2, d);
          }
        }
      }
      void P; void Q;
      this.static.push({ mesh: b.build(this.gl), tex: null, shadow: false });
      if (lines.vertexCount) this.static.push({ mesh: lines.build(this.gl), tex: null, shadow: false });
    }
  }

  private tmpP = [0, 0, 0];
  private vert(b: MeshBuilder, s: number, x: number, y: number, col: RGB, em = 0, u = 0, v = 0): number {
    this.path.point(s, x, y, this.tmpP);
    return b.vertex(ID, this.tmpP[0], this.tmpP[1], this.tmpP[2], 0, 1, 0, col, em, u, v);
  }

  /** Ribbon following the track at lateral offsets (xa..xb) and heights (ya..yb). */
  /** uvLen > 0: u runs along +s; uvLen < 0: u runs along -s (for text read from the other side). v=0 on the b edge. */
  private ribbon(b: MeshBuilder, s0: number, s1: number, xa: (s: number) => number, xb: (s: number) => number, ya: number, yb: number, col: (s: number) => RGB, step = STEP, em = 0, uvLen = 0, flipN = false): void {
    const P = this.tmpP;
    const R = [0, 0, 0], F = [0, 0, 0], Pp = [0, 0, 0];
    for (let s = s0; s < s1 - 0.001; s += step) {
      const s2 = Math.min(s1, s + step);
      const cc = col(s);
      const pts = [[s, xa(s), ya], [s, xb(s), yb], [s2, xb(s2), yb], [s2, xa(s2), ya]];
      const ids = pts.map(([ss, x, y], i) => {
        this.path.point(ss, x, y, P);
        const dx = xb(ss) - xa(ss), dy = yb - ya;
        const nl = (Math.hypot(dx, dy) || 1) * (flipN ? -1 : 1);
        this.path.sample(ss, Pp, F, R);
        const nx = -dy / nl, ny = dx / nl; // normal in (lateral, up)
        const ul = Math.abs(uvLen);
        const u = uvLen > 0 ? (ss - s0) / ul : uvLen < 0 ? 1 - (ss - s0) / ul : 0;
        return b.vertex(ID, P[0], P[1], P[2], R[0] * nx, ny, R[2] * nx, cc, em, u, i === 1 || i === 2 ? 0 : 1);
      });
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  // ------------------------------------------------------------------ STADIUM
  private buildStadium(): void {
    const gl = this.gl;
    const L = this.path.lapLength;
    const bnd = this.path.bounds;
    const cx = (bnd.minX + bnd.maxX) / 2, cz = (bnd.minZ + bnd.maxZ) / 2;
    // ground: grass with mowing stripes
    const g = new MeshBuilder();
    const size = 700, cells = 70;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const x = cx - size / 2 + (i + 0.5) * (size / cells), z = cz - size / 2 + (j + 0.5) * (size / cells);
      const stripe = Math.floor((x - cx) / 8) % 2 === 0;
      g.plane(M(x, -0.05, z), size / cells, size / cells, stripe ? c(0x4fae3f) : c(0x46a038));
    }
    this.static.push({ mesh: g.build(gl), tex: null, shadow: false });

    const stands = new MeshBuilder();
    const roof = new MeshBuilder();
    const sectionCols = [c(0x2f6bff), c(0x9b4dff), c(0xffc21a), c(0xff4f8a), c(0x22c0b8)];
    const tiersR = 9, tiersL = 5;
    const addStands = (b: MeshBuilder, side: 1 | -1, tiers: number, s0: number, s1: number, gap: number) => {
      const base = (s: number) => (side > 0 ? this.edgeAt(s, true) + gap : -(this.edgeAt(s, false) - gap) );
      for (let t = 0; t < tiers; t++) {
        const o0 = (s: number) => side * (base(s) + t * 1.6), o1 = (s: number) => side * (base(s) + (t + 1) * 1.6);
        const h = 1.0 + t * 0.95;
        // riser then step surface
        this.ribbon(b, s0, s1, o0, o0, h - 0.95, h, () => c(0xe8e4dc), 4, 0, 0, side < 0);
        this.ribbon(b, s0, s1, side > 0 ? o0 : o1, side > 0 ? o1 : o0, h, h, (s) => sectionCols[Math.floor(s / 40) % sectionCols.length], 4);
      }
      // back wall
      const ob = (s: number) => side * (base(s) + tiers * 1.6);
      this.ribbon(b, s0, s1, ob, ob, 0, 1.0 + tiers * 0.95 + 3, () => c(0xd8d2c6), 4, 0, 0, side < 0);
      // roof canopy
      const or0 = (s: number) => side * (base(s) + tiers * 1.6 + 0.5), or1 = (s: number) => side * (base(s) + tiers * 0.4);
      this.ribbon(roof, s0, s1, side > 0 ? or1 : or0, side > 0 ? or0 : or1, 1.0 + tiers * 0.95 + 5.5, 1.0 + tiers * 0.95 + 3.2, () => c(0xf4f6fb), 4);
      return base;
    };
    const baseR = addStands(stands, 1, tiersR, 0, L, 6);
    const leftRanges: [number, number][] = [[10, 150], [370, 670], [890, 1030]];
    const baseLs = leftRanges.map(([a, b]) => addStands(stands, -1, tiersL, a, b, 7));
    // stands receive shadows but don't cast them (huge, always-visible geometry in the shadow pass)
    this.static.push({ mesh: stands.build(gl), tex: null, shadow: false });
    this.static.push({ mesh: roof.build(gl), tex: null, shadow: false });

    // crowd: low-poly people (~60 tris), instanced in ~105 m sections so off-screen sections are culled.
    // Hair is baked into the head's vertex colours (instance colour tints skin, hair stays dark).
    const bodyB = new MeshBuilder().box(M(0, 0.45, 0), 0.5, 0.7, 0.32, [1, 1, 1]).box(M(-0.3, 0.75, 0, 0, 0, 0.5), 0.12, 0.5, 0.12, [1, 1, 1]).box(M(0.3, 0.75, 0, 0, 0, -0.5), 0.12, 0.5, 0.12, [1, 1, 1]);
    const headB = new MeshBuilder().sphere(M(0, 1.03, 0), 0.19, 0.21, 0.19, (_x, y) => (y > 0.1 ? [0.35, 0.3, 0.28] : [1, 1, 1]), 6, 4);
    const people: { s: number; x: number; y: number; yaw: number }[] = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let s = 0; s < L; s += 1.5) {
      for (let t = 0; t < tiersR; t++) if (rnd() > 0.15) people.push({ s: s + rnd() * 0.4, x: baseR(s) + t * 1.6 + 0.8, y: 1.0 + t * 0.95, yaw: Math.PI / 2 });
    }
    leftRanges.forEach(([a, b], k) => {
      for (let s = a; s < b; s += 1.5) for (let t = 0; t < tiersL; t++) if (rnd() > 0.15) people.push({ s, x: baseLs[k](s) * -1 - t * 1.6 - 0.8, y: 1.0 + t * 0.95, yaw: -Math.PI / 2 });
    });
    const shirts = [0xff4f4f, 0x2f6bff, 0xffc21a, 0x34d39a, 0xff7eb6, 0x9b4dff, 0xffffff, 0xff8a00, 0x22c0b8].map(c);
    const skins = [0xf1c7a3, 0xd9a57b, 0xa86b45, 0x6b4128, 0xffdcc2].map(c);
    const SECTION = 105;
    const m = mat4();
    const CP = [0, 0, 0];
    for (let s0 = 0; s0 < L; s0 += SECTION) {
      const group = people.filter((p) => p.s >= s0 && p.s < s0 + SECTION);
      if (!group.length) continue;
      const bodyMesh = bodyB.build(gl, true), headMesh = headB.build(gl, true);
      const bodyData = new Float32Array(group.length * 20), headData = new Float32Array(group.length * 20);
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      group.forEach((p, i) => {
        this.path.frame(p.s, p.x, p.y, m, p.yaw);
        const sh = shirts[Math.floor(rnd() * shirts.length)], sk = skins[Math.floor(rnd() * skins.length)];
        const ph = rnd();
        writeInstance(bodyData, i, m, sh[0], sh[1], sh[2], ph);
        writeInstance(headData, i, m, sk[0], sk[1], sk[2], ph);
        CP[0] = m[12]; CP[1] = m[13]; CP[2] = m[14];
        minX = Math.min(minX, CP[0]); minY = Math.min(minY, CP[1]); minZ = Math.min(minZ, CP[2]);
        maxX = Math.max(maxX, CP[0]); maxY = Math.max(maxY, CP[1] + 1.5); maxZ = Math.max(maxZ, CP[2]);
      });
      for (const mesh of [bodyMesh, headMesh]) {
        mesh.center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
        mesh.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 2;
        mesh.cullInstanced = true;
      }
      bodyMesh.setInstances(bodyData, group.length);
      headMesh.setInstances(headData, group.length);
      this.instanced.push({ mesh: bodyMesh, tex: null, anim: 1, shadow: false }, { mesh: headMesh, tex: null, anim: 1, shadow: false });
    }

    // advertising boards on a low wall along the outside edge, and on the infield
    const ads: [string, string, string, string][] = [
      ['ZOOMIES', '#2f6bff', '#ffffff', '#5b8cff'], ['PAWSOME', '#ffc21a', '#c2185b', '#ffd95a'], ['WOOF FUEL', '#ff4f4f', '#ffffff', '#ff7a7a'],
      ['PURRFECT', '#9b4dff', '#ffe14a', '#b57bff'], ['TAIL WAG TV', '#22c0b8', '#ffffff', '#4fd8d0'], ['CRUNCHY BONES', '#ff8a00', '#ffffff', '#ffab45'],
    ];
    ads.forEach((ad, k) => {
      const b = new MeshBuilder();
      for (let s = k * 12; s < L; s += ads.length * 12) {
        const xr = (ss: number) => this.edgeAt(ss, true) + 1.4;
        this.ribbon(b, s, s + 11.5, xr, xr, 0, 1.1, () => [1, 1, 1], 11.5, 0.15, -11.5);
      }
      for (let s = k * 16 + 4; s < L; s += ads.length * 16) {
        const xl = (ss: number) => this.edgeAt(ss, false) - 1.6;
        this.ribbon(b, s, s + 11.5, xl, xl, 0, 1.0, () => [1, 1, 1], 11.5, 0.15, 11.5, true);
      }
      this.static.push({ mesh: b.build(gl), tex: adTexture(gl, ad[0], ad[1], ad[2], ad[3]) });
    });
    // roof banners (paw prints)
    const banners = new MeshBuilder();
    for (let s = 0; s < L; s += 10) {
      const xr = (ss: number) => baseR(ss) + 0.3;
      this.ribbon(banners, s, s + 9, xr, xr, 1 + tiersR * 0.95 + 3.4, 1 + tiersR * 0.95 + 5.2, () => [1, 1, 1], 9, 0.2, -9);
    }
    this.static.push({ mesh: banners.build(gl), tex: bannerTexture(gl, '🐾 ANIMAL DASH 🐾', '#7a3cff', '#ffe14a') });

    // inner curb (red/white)
    const curb = new MeshBuilder();
    const xl0 = (s: number) => this.edgeAt(s, false) - 0.05, xl1 = (s: number) => this.edgeAt(s, false) - 0.4;
    this.ribbon(curb, 0, L, xl1, xl0, 0.12, 0.12, (s) => (Math.floor(s / 2) % 2 ? c(0xffffff) : c(0xd8262f)), 2);
    this.static.push({ mesh: curb.build(gl), tex: null });

    // light towers, scoreboard, flags, balloons
    const deco = new MeshBuilder();
    const towerS = [L * 0.15, L * 0.35, L * 0.65, L * 0.85];
    const P = [0, 0, 0];
    for (const s of towerS) {
      this.path.point(s, baseR(s) + tiersR * 1.6 + 4, 0, P);
      deco.cylinder(M(P[0], 0, P[2]), 0.5, 0.8, 32, c(0xb8bcc8), 10);
      const yaw = this.path.heading(s) + Math.PI / 2;
      deco.box(M(P[0], 33, P[2], 0.3, yaw, 0), 8, 4, 0.6, c(0x3a3f4a));
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) deco.box(M(P[0] + Math.cos(yaw) * (i * 1.8 - 2.7), 32.2 + j * 1.6, P[2] - Math.sin(yaw) * (i * 1.8 - 2.7), 0.3, yaw, 0), 1.4, 1.2, 0.8, c(0xfffbe6), 1);
    }
    // flags along the roof
    for (let s = 0; s < L; s += 22) {
      this.path.point(s, baseR(s) + tiersR * 1.6, 1 + tiersR * 0.95 + 5.5, P);
      deco.cylinder(M(P[0], P[1], P[2]), 0.06, 0.06, 4, c(0xdddddd), 6);
      const col = [c(0xff4f4f), c(0x2f6bff), c(0xffc21a), c(0x34d39a), c(0xff7eb6)][Math.floor(s / 22) % 5];
      deco.box(M(P[0], P[1] + 3.4, P[2] + 0.6), 0.04, 1, 1.3, col);
    }
    this.static.push({ mesh: deco.build(gl), tex: null });
    // scoreboard behind the first turn
    const sb = new MeshBuilder();
    const sbS = 260;
    this.path.point(sbS, baseR(sbS) + tiersR * 1.6 + 6, 0, P);
    const yaw = this.path.heading(sbS) - Math.PI / 2;
    sb.box(M(P[0], 10, P[2], 0, yaw, 0), 1, 20, 1, c(0x555a66));
    sb.box(M(P[0], 22, P[2], 0, yaw, 0), 24, 12, 1.2, c(0x22263a));
    this.static.push({ mesh: sb.build(gl), tex: null });
    const screen = new MeshBuilder();
    screen.box(M(P[0] + Math.sin(yaw) * 0.65, 22, P[2] + Math.cos(yaw) * 0.65, 0, yaw, 0), 22, 10.5, 0.05, [1, 1, 1], 0.9);
    this.static.push({ mesh: screen.build(gl), tex: scoreboardTexture(gl), emissive: 0.85 });

    // hot-air balloons
    const balloonCols = [[0xff4f4f, 0xffc21a], [0x2f6bff, 0xffffff], [0x9b4dff, 0x34d39a], [0xff7eb6, 0x4fc3ff]];
    balloonCols.forEach(([a, b2], i) => {
      const bm = new MeshBuilder();
      bm.sphere(M(0, 0, 0), 7, 8, 7, (x, _y, z) => (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 6)) % 2 ? c(a) : c(b2)), 20, 14);
      bm.cylinder(M(0, -9.5, 0), 2.2, 1.2, 1.5, c(0xffc21a), 12);
      bm.box(M(0, -11, 0), 2, 1.6, 2, c(0x8a5a2b));
      const ang = (i / 4) * Math.PI * 2 + 0.5;
      this.balloons.push({ mesh: bm.build(gl), x: cx + Math.cos(ang) * 190, y: 45 + i * 8, z: cz + Math.sin(ang) * 140, ph: i * 1.7 });
    });
    void tiersL;
  }

  // ------------------------------------------------------------------ ARENA
  private buildArena(): void {
    const gl = this.gl;
    const L = this.path.lapLength;
    const bnd = this.path.bounds;
    const pad = 160;
    const x0 = bnd.minX - pad, x1 = bnd.maxX + pad, z0 = bnd.minZ - pad, z1 = bnd.maxZ + pad;
    const N = 110;
    const noise = (x: number, z: number) => Math.sin(x * 0.021) * Math.cos(z * 0.017) * 5 + Math.sin(x * 0.05 + z * 0.04) * 1.6 + Math.cos(z * 0.09 - x * 0.03) * 0.8;
    const heights = new Float32Array((N + 1) * (N + 1));
    const g = new MeshBuilder();
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / N, z = z0 + ((z1 - z0) * j) / N;
      const near = this.path.distanceTo(x, z);
      const ty = this.path.heightAt(near.s) - 1.4;
      const k = Math.min(1, Math.max(0, (near.d - 12) / 40));
      heights[i * (N + 1) + j] = ty * (1 - k) + (noise(x, z) + ty * 0.5) * k;
    }
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / N, z = z0 + ((z1 - z0) * j) / N;
      const h = heights[i * (N + 1) + j];
      const hx = heights[Math.min(N, i + 1) * (N + 1) + j] - heights[Math.max(0, i - 1) * (N + 1) + j];
      const hz = heights[i * (N + 1) + Math.min(N, j + 1)] - heights[i * (N + 1) + Math.max(0, j - 1)];
      const cell = (x1 - x0) / N;
      const v = 0.5 + 0.5 * Math.sin(x * 0.13) * Math.cos(z * 0.11);
      const col: RGB = [0.33 + v * 0.08, 0.66 + v * 0.1, 0.25 + v * 0.05];
      g.vertex(ID, x, h, z, -hx / (2 * cell), 1, -hz / (2 * cell), col, 0);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j;
      g.quad(a, a + 1, a + N + 2, a + N + 1);
    }
    this.static.push({ mesh: g.build(gl), tex: null, shadow: false });

    // bumpers (inflatable, alternating colours) along both edges
    const bump = new MeshBuilder();
    const bl = (s: number) => this.edgeAt(s, false) - 0.1, bl2 = (s: number) => this.edgeAt(s, false) - 0.7;
    const br = (s: number) => this.edgeAt(s, true) + 0.1, br2 = (s: number) => this.edgeAt(s, true) + 0.7;
    const bc = (s: number) => (Math.floor(s / 3) % 2 ? c(0xff4f8a) : c(0xffffff));
    for (const [a, b2] of [[bl2, bl], [br, br2]] as const) {
      this.ribbon(bump, 0, L, a, a, 0, 0.8, bc, 1);
      this.ribbon(bump, 0, L, b2, b2, 0, 0.8, bc, 1);
      this.ribbon(bump, 0, L, a, b2, 0.8, 0.8, bc, 1);
    }
    this.static.push({ mesh: bump.build(gl), tex: null });

    // pits: water below and dark walls
    const water = new MeshBuilder();
    for (const pit of this.track.pits) {
      const xa = () => laneX(pit.lane0) - 0.8, xb = () => laneX(pit.lane1) + 0.8;
      this.ribbon(water, pit.s0, pit.s1, xa, xb, -5, -5, () => c(0x2a9df4), 1, 0.25);
      this.ribbon(water, pit.s0, pit.s1, xa, xa, -5, 0, () => c(0x3a2d6b), 1);
      this.ribbon(water, pit.s0, pit.s1, xb, xb, 0, -5, () => c(0x3a2d6b), 1);
    }
    if (water.vertexCount) this.static.push({ mesh: water.build(gl), tex: null, shadow: false });

    // trees (instanced) and bushes
    const tree = new MeshBuilder().cylinder(M(0, 0, 0), 0.25, 0.35, 2.2, c(0x7a4a26), 8)
      .cylinder(M(0, 1.8, 0), 0, 2.4, 3.2, c(0x2f9a45), 10).cylinder(M(0, 3.4, 0), 0, 1.8, 2.6, c(0x37b04f), 10);
    const treeMesh = tree.build(gl, true);
    const trees: number[][] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 900 && trees.length < 380; k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      const near = this.path.distanceTo(x, z);
      if (near.d < 16) continue;
      const i = Math.round(((x - x0) / (x1 - x0)) * N), j = Math.round(((z - z0) / (z1 - z0)) * N);
      trees.push([x, heights[i * (N + 1) + j] - 0.2, z, 0.8 + rnd() * 0.9]);
    }
    const td = new Float32Array(trees.length * 20);
    const m = mat4();
    trees.forEach((t, i) => {
      compose(m, t[0], t[1], t[2], 0, rnd() * 6, 0, t[3], t[3], t[3]);
      const tint = 0.85 + rnd() * 0.3;
      writeInstance(td, i, m, tint, tint, tint, rnd());
    });
    treeMesh.setInstances(td, trees.length);
    this.instanced.push({ mesh: treeMesh, tex: null, anim: 2, shadow: true });

    // inflatable arches at checkpoints + decorative flags
    const deco = new MeshBuilder();
    const P = [0, 0, 0];
    for (const cp of this.track.checkpoints) {
      this.path.point(cp, 0, 0, P);
      const yaw = this.path.heading(cp);
      deco.torus(M(P[0], P[1], P[2], -Math.PI / 2, yaw + Math.PI, 0), 8.4, 0.7, (x, y) => (Math.floor(Math.atan2(y, x) * 4) % 2 ? c(0xffc21a) : c(0x4fc3ff)), 28, 10, Math.PI);
    }
    for (let s = 20; s < L; s += 30) {
      for (const side of [-1, 1]) {
        this.path.point(s, side * (this.edgeAt(s, side > 0) * side + 3), 0, P);
        deco.cylinder(M(P[0], P[1], P[2]), 0.07, 0.07, 5, c(0xeeeeee), 6);
        deco.box(M(P[0], P[1] + 4.2, P[2] + 0.6), 0.04, 1.2, 1.4, [c(0xff4f4f), c(0x2f6bff), c(0xffc21a), c(0x9b4dff)][Math.floor(s / 30) % 4]);
      }
    }
    this.static.push({ mesh: deco.build(gl), tex: null });
    // spectator stand near the start
    const st = new MeshBuilder();
    for (let t = 0; t < 4; t++) {
      const xo = (s: number) => this.edgeAt(s, true) + 4 + t * 1.6;
      const h = 0.8 + t * 0.9 + this.path.heightAt(0) * 0;
      this.ribbon(st, 0, 100, xo, (s) => xo(s) + 1.6, h, h, (s) => [c(0xff4f8a), c(0x4fc3ff), c(0xffc21a)][Math.floor(s / 20) % 3], 4);
      this.ribbon(st, 0, 100, xo, xo, h - 0.9, h, () => c(0xffffff), 4);
    }
    this.static.push({ mesh: st.build(gl), tex: null });
    const ads = new MeshBuilder();
    for (let s = 110; s < L; s += 140) {
      const xr = (ss: number) => this.edgeAt(ss, true) + 1.3;
      this.ribbon(ads, s, s + 10, xr, xr, 0.2, 1.3, () => [1, 1, 1], 10, 0.15, -10);
    }
    this.static.push({ mesh: ads.build(gl), tex: adTexture(gl, 'GO WILD!', '#34d39a', '#ffffff', '#5fe3b2') });
    // balloons
    [[0xff7eb6, 0xffffff], [0xffc21a, 0x2f6bff], [0x34d39a, 0xff4f4f]].forEach(([a, b2], i) => {
      const bm = new MeshBuilder();
      bm.sphere(M(0, 0, 0), 6, 7, 6, (x, _y, z) => (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 6)) % 2 ? c(a) : c(b2)), 20, 14);
      bm.box(M(0, -9, 0), 1.8, 1.4, 1.8, c(0x8a5a2b));
      this.balloons.push({ mesh: bm.build(gl), x: bnd.minX + (bnd.maxX - bnd.minX) * (0.2 + i * 0.3), y: 50 + i * 10, z: bnd.minZ + (bnd.maxZ - bnd.minZ) * (0.3 + (i % 2) * 0.4), ph: i });
    });
  }

  // ------------------------------------------------------------------ divider walls
  private buildWalls(): void {
    const b = new MeshBuilder();
    for (const w of this.def.walls) {
      const xa = () => laneX(w.lane0) - 0.65, xb = () => laneX(w.lane1) + 0.65;
      const col = (s: number) => (Math.floor(s / 2.5) % 2 ? c(0xffc21a) : c(0x2f2f3a));
      this.ribbon(b, w.s0 + 2, w.s1, xa, xa, 0, 1.3, col, 1);
      this.ribbon(b, w.s0 + 2, w.s1, xb, xb, 1.3, 0, col, 1);
      this.ribbon(b, w.s0 + 2, w.s1, xa, xb, 1.3, 1.3, () => c(0xff4f4f), 1);
      // nose cone
      const P = [0, 0, 0];
      this.path.point(w.s0 + 1.5, (laneX(w.lane0) + laneX(w.lane1)) / 2, 0, P);
      b.cylinder(M(P[0], P[1], P[2]), 0.2, (laneX(w.lane1) - laneX(w.lane0)) / 2 + 0.7, 1.6, c(0xff4f4f), 12);
    }
    if (b.vertexCount) this.static.push({ mesh: b.build(this.gl), tex: null });
  }

  private buildStartFinish(): void {
    const gl = this.gl;
    const L = this.path.lapLength;
    const finishS = this.def.laps > 1 ? 0 : this.def.length;
    const posts = new MeshBuilder();
    const P = [0, 0, 0];
    for (const [s, label] of [[0, 'START'], [finishS, 'FINISH']] as [number, string][]) {
      if (label === 'FINISH' && finishS === 0) continue;
      const el = this.edgeAt(s, false) - 1.2, er = this.edgeAt(s, true) + 1.2;
      for (const x of [el, er]) { this.path.point(s, x, 0, P); posts.cylinder(M(P[0], P[1], P[2]), 0.45, 0.45, 7.5, c(0xffffff), 12); }
      const yaw = this.path.heading(s);
      this.path.point(s, (el + er) / 2, 7.2, P);
      posts.box(M(P[0], P[1], P[2], 0, yaw, 0), er - el + 1, 0.6, 0.6, c(0x2f2f3a));
    }
    this.static.push({ mesh: posts.build(gl), tex: null });
    const banner = new MeshBuilder();
    for (const s of finishS === 0 ? [0] : [0, finishS]) {
      const el = this.edgeAt(s, false) - 1.2, er = this.edgeAt(s, true) + 1.2;
      const yaw = this.path.heading(s);
      this.path.point(s, (el + er) / 2, 5.6, P);
      banner.box(M(P[0], P[1], P[2], 0, yaw, 0), er - el, 2.4, 0.3, [1, 1, 1], 0.2, 0);
    }
    this.static.push({ mesh: banner.build(gl), tex: bannerTexture(gl, 'ANIMAL DASH', '#ff4f8a', '#ffffff') });
    // checkered line on the ground
    const line = new MeshBuilder();
    for (const s of finishS === 0 ? [0] : [0, finishS]) {
      const el = this.edgeAt(s, false), er = this.edgeAt(s, true);
      const cols = 20, sq = (er - el) / cols;
      for (let row = 0; row < 3; row++) for (let k = 0; k < cols; k++) {
        const cc: RGB = (row + k) % 2 ? [0.08, 0.08, 0.08] : [0.97, 0.97, 0.97];
        const sa = s - 0.75 + row * 0.5, sb2 = sa + 0.5, xa = el + k * sq, xb = xa + sq;
        const a = this.vert(line, sa, xa, 0.02, cc), b2 = this.vert(line, sa, xb, 0.02, cc), c2 = this.vert(line, sb2, xb, 0.02, cc), d = this.vert(line, sb2, xa, 0.02, cc);
        line.quad(a, d, c2, b2);
      }
    }
    this.static.push({ mesh: line.build(gl), tex: null, shadow: false });
    void checkerTexture;
    void L;
  }

  draw(r: Renderer, time: number): void {
    for (const it of this.static) r.draw(it.mesh, ID, { tex: it.tex, emissive: it.emissive ?? 0, rim: 0.05, shadow: it.shadow !== false, spec: 0.05 });
    for (const it of this.instanced) r.draw(it.mesh, ID, { anim: it.anim ?? 0, rim: 0.05, shadow: it.shadow === true, spec: 0.02, cull: it.mesh.cullInstanced });
    const m = this.tmpM;
    for (const b of this.balloons) {
      compose(m, b.x + Math.sin(time * 0.1 + b.ph) * 6, b.y + Math.sin(time * 0.4 + b.ph) * 2, b.z, 0, time * 0.05, 0);
      r.draw(b.mesh, m, { rim: 0.2, shadow: false });
    }
  }
  private tmpM: Mat4 = mat4();
}

function norm(v: number[]): number[] { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
