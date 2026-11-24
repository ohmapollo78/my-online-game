// Visuals for obstacles, zones (gates/ramps/surfaces) and moving platforms. Every moving
// obstacle is animated from the same time function the simulation uses for collisions.
import { OK, ZK, Obstacle, obstacleXOffset, sweeperAngle, ballS, crateState, platformCenter, PitDef } from '@shared/track';
import { laneX, LANE_WIDTH } from '@shared/constants';
import { MeshBuilder, Mesh, M, RGB } from '../engine/mesh';
import { Renderer } from '../engine/renderer';
import { mat4, multiply, compose, hexToRgb, Mat4 } from '../engine/math';
import { TrackScene } from '../tracks/trackScene';
import { chevronTexture, gateTexture } from '../engine/textures';

const c = (h: number): RGB => hexToRgb(h);
const stripes = (a: RGB, b: RGB, f = 6) => (x: number) => (Math.floor((x + 50) * f) % 2 ? a : b);

interface ObsVis { o: Obstacle; base: Mesh; moving?: Mesh; extra?: Mesh; xc: number; }
interface ZoneVis { mesh: Mesh; tex: WebGLTexture | null; alpha: number; emissive: number; s: number; }

export class ObstacleRenderer {
  private list: ObsVis[] = [];
  private zones: ZoneVis[] = [];
  private platforms: { pit: PitDef; idx: number; mesh: Mesh }[] = [];
  private warn: Mesh;
  private m = mat4(); private m2 = mat4(); private m3 = mat4();

  constructor(private gl: WebGL2RenderingContext, private scene: TrackScene) {
    for (const o of scene.track.obstacles) this.list.push(this.build(o));
    this.buildZones();
    for (const pit of scene.track.pits) pit.platforms.forEach((p, idx) => {
      const w = (p.lane1 - p.lane0 + 1) * LANE_WIDTH;
      const b = new MeshBuilder();
      b.box(M(0, -0.25, p.len / 2), w, 0.5, p.len, (x, _y, z) => (Math.floor(z / 1.5) % 2 ? c(0xffc21a) : c(0x3a3f4a)));
      b.box(M(0, -0.6, p.len / 2), w * 0.3, 0.4, p.len * 0.9, c(0x555a66));
      this.platforms.push({ pit, idx, mesh: b.build(gl) });
    });
    this.warn = new MeshBuilder().cylinder(M(0, 0, 0), 0.9, 0.9, 0.02, c(0xff2a2a), 24, true, 1).build(gl);
  }

  private build(o: Obstacle): ObsVis {
    const gl = this.gl;
    const xc = (laneX(o.lane0) + laneX(o.lane1)) / 2;
    const w = (o.lane1 - o.lane0 + 1) * LANE_WIDTH;
    const base = new MeshBuilder();
    let moving: MeshBuilder | null = null;
    let extra: MeshBuilder | null = null;
    const post = (b: MeshBuilder, x: number, h: number, col: RGB) => { b.cylinder(M(x, 0, 0), 0.07, 0.09, h, col, 10); b.box(M(x, 0.03, 0), 0.25, 0.06, 0.6, c(0x2f2f3a)); };
    switch (o.kind) {
      case OK.HURDLE: {
        for (let k = 0; k <= o.lane1 - o.lane0; k++) {
          const x = -w / 2 + LANE_WIDTH * (k + 0.5);
          post(base, x - 0.7, 0.68, c(0x2f6bff)); post(base, x + 0.7, 0.68, c(0x2f6bff));
          base.box(M(x, 0.62, 0), 1.52, 0.14, 0.06, stripes(c(0xd8262f), c(0xffffff), 3));
        }
        break;
      }
      case OK.LOWWALL:
        base.roundBox(M(0, 0.42, 0), w - 0.1, 0.84, 1.0, (x, y) => (y > 0.25 ? c(0xffc21a) : Math.floor(x * 1.2 + 50) % 2 ? c(0x2f6bff) : c(0x4fc3ff)));
        break;
      case OK.HIGHBAR: {
        post(base, -w / 2 + 0.1, 1.9, c(0x9b4dff)); post(base, w / 2 - 0.1, 1.9, c(0x9b4dff));
        base.box(M(0, 1.35, 0), w, 0.9, 0.2, (x, y) => (y > 0.3 ? stripes(c(0xffc21a), c(0x1c1c22), 2.5)(x) : c(0xff4f8a)));
        for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.45) base.box(M(x, 0.86, 0.04), 0.36, 0.16, 0.03, c(0xffffff));
        break;
      }
      case OK.MOVWALL: {
        base.box(M(0, 0.03, 0), w, 0.06, 0.3, c(0x3a3f4a));
        moving = new MeshBuilder();
        moving.roundBox(M(0, 1.3, 0), 2 * LANE_WIDTH - 0.1, 2.6, 0.8, (_x, y) => (y > 0.9 ? c(0xff4f8a) : y > -0.9 ? c(0xffffff) : c(0xff4f8a)));
        moving.sphere(M(0, 1.3, 0.42), 0.35, 0.35, 0.1, c(0xffc21a), 10, 8, 0.4);
        break;
      }
      case OK.MOVHURDLE: {
        base.box(M(0, 0.03, 0), w, 0.06, 0.3, c(0x3a3f4a));
        moving = new MeshBuilder();
        const hw = 3 * LANE_WIDTH;
        for (const x of [-hw / 2 + 0.15, 0, hw / 2 - 0.15]) { moving.cylinder(M(x, 0.05, 0), 0.07, 0.07, 0.62, c(0xffc21a), 8); moving.sphere(M(x, 0.08, 0), 0.12, 0.08, 0.12, c(0x222222), 8, 6); }
        moving.box(M(0, 0.62, 0), hw, 0.14, 0.08, stripes(c(0x34d39a), c(0xffffff), 3));
        break;
      }
      case OK.SWEEPER: {
        const r = o.radius ?? 2.4;
        base.cylinder(M(0, 0, 0), 0.5, 0.6, 0.2, c(0x3a3f4a), 16);
        base.cylinder(M(0, 0, 0), 0.22, 0.22, 1.2, c(0xff4f4f), 12);
        moving = new MeshBuilder();
        moving.box(M(0, 0.45, 0), r * 2, 0.28, 0.28, stripes(c(0xff4f4f), c(0xffffff), 1.5));
        moving.sphere(M(r, 0.45, 0), 0.24, 0.24, 0.24, c(0xffc21a), 10, 8);
        moving.sphere(M(-r, 0.45, 0), 0.24, 0.24, 0.24, c(0xffc21a), 10, 8);
        break;
      }
      case OK.SWING: {
        const span = laneX(o.lane1) - laneX(o.lane0) + 3.6;
        base.cylinder(M(-span / 2, 0, 0), 0.18, 0.2, 6.2, c(0x9b4dff), 10);
        base.cylinder(M(span / 2, 0, 0), 0.18, 0.2, 6.2, c(0x9b4dff), 10);
        base.box(M(0, 6.1, 0), span + 0.4, 0.35, 0.35, stripes(c(0xffc21a), c(0x9b4dff), 1));
        moving = new MeshBuilder(); // pendulum hangs from its pivot (y=6) down to the block
        moving.box(M(0, -2.3, 0), 0.06, 4.6, 0.06, c(0x333333));
        moving.roundBox(M(0, -4.9, 0), 1.45, 1.6, 1.2, (_x, y) => (y > 0 ? c(0x34d39a) : c(0xffffff)));
        break;
      }
      case OK.BALL: {
        // chute marking along the lane + giant spiked ball
        const len = o.sLen ?? 80;
        void len;
        moving = new MeshBuilder();
        moving.sphere(M(0, 0, 0), 1.1, 1.1, 1.1, (x, y, z) => (Math.abs(y) < 0.12 || Math.abs(x) < 0.12 ? c(0x5a5f6a) : c(0x2a2d35)), 20, 14);
        for (let i = 0; i < 26; i++) {
          const th = Math.acos(1 - (2 * (i + 0.5)) / 26), ph = i * 2.399963;
          const dx = Math.sin(th) * Math.cos(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.sin(ph);
          const rx = Math.atan2(Math.hypot(dx, dz), dy);
          const ry = Math.atan2(dx, dz);
          moving.cylinder(M(dx * 0.95, dy * 0.95, dz * 0.95, rx, ry, 0), 0.01, 0.16, 0.45, c(0xb8bcc8), 6);
        }
        break;
      }
      case OK.CRATE: {
        moving = new MeshBuilder();
        moving.box(M(0, 0.65, 0), w - 0.2, 1.3, 1.3, (x, y) => (Math.abs(y - 0) > 0.5 || Math.abs(x) > w / 2 - 0.35 ? c(0x8a5a2b) : c(0xb07a3f)));
        moving.box(M(0, 0.65, 0.66), w - 0.4, 0.15, 0.02, c(0x6a4020));
        extra = new MeshBuilder().cylinder(M(0, 0, 0), (w - 0.1) / 2, (w - 0.1) / 2, 0.03, c(0x111111), 20);
        break;
      }
    }
    return { o, xc, base: base.build(gl), moving: moving?.build(gl), extra: extra?.build(gl) };
  }

  private buildZones(): void {
    const gl = this.gl;
    const scene = this.scene;
    const P = [0, 0, 0];
    const groups = new Map<string, { b: MeshBuilder; tex: WebGLTexture | null; alpha: number; emissive: number }>();
    const group = (key: string, tex: WebGLTexture | null, alpha = 1, emissive = 0) => {
      let g = groups.get(key);
      if (!g) { g = { b: new MeshBuilder(), tex, alpha, emissive }; groups.set(key, g); }
      return g.b;
    };
    const gateInfo: Record<number, [number, string, string]> = {
      [ZK.GATE_GREEN]: [0x34e36a, 'BOOST', '#1fa84a'], [ZK.GATE_BLUE]: [0x3aa0ff, 'STAMINA', '#1e6fd8'],
      [ZK.GATE_YELLOW]: [0xffd21a, 'ACCEL', '#c89b00'], [ZK.GATE_RED]: [0xff3030, 'DANGER', '#c01818'],
    };
    for (const z of scene.track.zones) {
      const x0 = laneX(z.lane0) - LANE_WIDTH / 2, x1 = laneX(z.lane1) + LANE_WIDTH / 2;
      const xc = (x0 + x1) / 2, w = x1 - x0;
      if (z.kind <= ZK.GATE_RED) {
        const [col, label, css] = gateInfo[z.kind];
        const m = scene.path.frame(z.s0, xc, 0, mat4());
        const frame = group('gateframe', null);
        for (const sx of [-1, 1]) appendM(frame, m, (b) => b.box(M(sx * (w / 2), 1.6, 0), 0.35, 3.2, 0.35, c(col), 0.3));
        appendM(frame, m, (b) => b.box(M(0, 3.25, 0), w + 0.35, 0.3, 0.35, c(col), 0.3));
        appendM(group(`gatelabel${z.kind}`, gateTexture(gl, label, css), 1, 0.6), m, (b) => b.box(M(0, 3.75, 0), Math.min(w, 3.2), 0.7, 0.2, [1, 1, 1]));
        appendM(group(`gatepanel${z.kind}`, chevronTexture(gl, css, '#ffffff'), 0.45, 0.8), m, (b) => b.box(M(0, 1.6, 0), w - 0.35, 3.1, 0.04, [1, 1, 1]));
      } else if (z.kind === ZK.RAMP) {
        const m = scene.path.frame(z.s0 + 2, xc, 0, mat4());
        appendM(group('ramp', chevronTexture(gl, '#2f6bff', '#ffd21a')), m, (b) => b.wedge(M(0, 0, 0), w - 0.2, 0.7, 4, [1, 1, 1]));
      } else {
        const len = z.s1 - z.s0;
        const kind = z.kind === ZK.RECOVERY ? 'rec' : z.kind === ZK.MUD ? 'mud' : z.kind === ZK.ICE ? 'ice' : 'pad';
        const b = group(kind, kind === 'pad' ? chevronTexture(gl, '#18a84a', '#b6ffcf') : null,
          kind === 'rec' ? 0.45 : kind === 'ice' ? 0.6 : 1, kind === 'rec' ? 0.7 : kind === 'pad' ? 0.6 : 0);
        const col: RGB = kind === 'rec' ? c(0x3aa0ff) : kind === 'mud' ? c(0x6b4423) : kind === 'ice' ? c(0xc8f0ff) : [1, 1, 1];
        for (let s = z.s0; s < z.s1; s += 2) {
          const s2 = Math.min(z.s1, s + 2);
          const pts = [[s, x0], [s, x1], [s2, x1], [s2, x0]].map(([ss, xx]) => scene.path.point(ss, xx, 0.03, [0, 0, 0]));
          const ids = pts.map((p, i) => b.vertex(ID, p[0], p[1], p[2], 0, 1, 0, col, 0, i === 1 || i === 2 ? 1 : 0, ((s - z.s0) + (i >= 2 ? 2 : 0)) / 4));
          b.quad(ids[0], ids[3], ids[2], ids[1]);
        }
        if (kind === 'mud') for (let k = 0; k < len * 1.5; k++) {
          const s = z.s0 + Math.random() * len, x = x0 + Math.random() * w;
          scene.path.point(s, x, 0, P);
          b.sphere(M(P[0], P[1], P[2]), 0.3 + Math.random() * 0.3, 0.08, 0.3 + Math.random() * 0.3, c(0x55361b), 8, 4);
        }
        void len;
      }
    }
    for (const [, g] of groups) this.zones.push({ mesh: g.b.build(gl), tex: g.tex, alpha: g.alpha, emissive: g.emissive, s: 0 });
  }

  /** Draw everything near the camera. sNear: the camera racer's race distance. */
  draw(r: Renderer, t: number, sNear: number): void {
    const path = this.scene.path;
    const lapL = path.lapLength;
    const laps = this.scene.def.laps;
    const ls = laps > 1 ? ((sNear % lapL) + lapL) % lapL : sNear;
    for (const z of this.zones) r.draw(z.mesh, ID, { tex: z.tex, alpha: z.alpha, emissive: z.emissive, shadow: z.alpha >= 1, rim: 0.1, cull: false });
    const m = this.m, m2 = this.m2, m3 = this.m3;
    for (const v of this.list) {
      const o = v.o;
      let ds = o.s - ls;
      if (laps > 1) { if (ds < -lapL / 2) ds += lapL; else if (ds > lapL / 2) ds -= lapL; }
      if (o.kind !== OK.BALL && (ds < -40 || ds > 260)) continue;
      if (o.kind === OK.BALL && (o.s + (o.sLen ?? 80) - ls < -40 || ds > 260)) continue;
      switch (o.kind) {
        case OK.HURDLE: case OK.LOWWALL: case OK.HIGHBAR:
          path.frame(o.s, v.xc, 0, m); r.draw(v.base, m); break;
        case OK.MOVWALL: case OK.MOVHURDLE:
          path.frame(o.s, v.xc, 0, m); r.draw(v.base, m);
          path.frame(o.s, obstacleXOffset(o, t), 0, m); r.draw(v.moving!, m); break;
        case OK.SWEEPER: {
          path.frame(o.s, laneX(o.lane0), 0, m); r.draw(v.base, m);
          compose(m2, 0, 0, 0, 0, sweeperAngle(o, t) + Math.PI, 0);
          multiply(m3, m, m2); r.draw(v.moving!, m3); break;
        }
        case OK.SWING: {
          path.frame(o.s, (laneX(o.lane0) + laneX(o.lane1)) / 2, 0, m); r.draw(v.base, m);
          // the barrier hangs from a trolley that runs along the overhead beam and swings
          // slightly with its velocity (the hit box follows the trolley exactly)
          const cx = obstacleXOffset(o, t);
          const vel = (obstacleXOffset(o, t + 0.02) - cx) / 0.02;
          path.frame(o.s, cx, 6.0, m);
          compose(m2, 0, 0, 0, 0, 0, -vel * 0.06);
          multiply(m3, m, m2); r.draw(v.moving!, m3); break;
        }
        case OK.BALL: {
          const sb = ballS(o, t);
          if (sb < 0) break;
          path.frame(sb, laneX(o.lane0), 1.1, m);
          compose(m2, 0, 0, 0, -(sb / 1.1), 0, 0);
          multiply(m3, m, m2); r.draw(v.moving!, m3, { rim: 0.2, spec: 0.6 }); break;
        }
        case OK.CRATE: {
          const st = crateState(o, t);
          if (st.warn > 0 && st.y !== 0) {
            path.frame(o.s, v.xc, 0.04, m);
            compose(m2, 0, 0, 0, 0, 0, 0, 0.4 + st.warn * 0.6, 1, 0.4 + st.warn * 0.6);
            multiply(m3, m, m2);
            r.draw(this.warn, m3, { alpha: 0.35 + 0.3 * Math.sin(t * 20), emissive: 1, shadow: false });
          }
          if (st.y >= 0) { path.frame(o.s, v.xc, st.y, m); r.draw(v.moving!, m); }
          break;
        }
      }
    }
    for (const p of this.platforms) {
      const pd = p.pit.platforms[p.idx];
      const s0 = p.pit.s0 + pd.sOff;
      if (s0 - ls < -40 || s0 - ls > 260) continue;
      path.frame(s0, platformCenter(pd, t), 0, m);
      r.draw(p.mesh, m);
    }
  }
}

const ID = mat4();
function appendM(target: MeshBuilder, m: Mat4, fn: (b: MeshBuilder) => void): void {
  const tmp = new MeshBuilder();
  fn(tmp);
  // bake transform into vertices
  const v = tmp.v;
  for (let i = 0; i < v.length; i += 12) {
    const x = v[i], y = v[i + 1], z = v[i + 2], nx = v[i + 3], ny = v[i + 4], nz = v[i + 5];
    v[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; v[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; v[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    v[i + 3] = m[0] * nx + m[4] * ny + m[8] * nz; v[i + 4] = m[1] * nx + m[5] * ny + m[9] * nz; v[i + 5] = m[2] * nx + m[6] * ny + m[10] * nz;
  }
  target.append(tmp);
}
