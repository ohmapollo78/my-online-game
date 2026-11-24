// Track model. The simulation lives in "track space": s = distance along the
// centre line, x = lateral offset (+ right), y = height above the track surface.
// Rendering maps track space into world space using the path segments.

import { LANE_COUNT, LANE_WIDTH, laneX, RACER_HALF_LEN, RACER_HALF_W } from './constants';

export interface PathSeg { len: number; turn: number; rise: number; }

export const OK = {
  HURDLE: 0,
  LOWWALL: 1,
  HIGHBAR: 2,
  MOVWALL: 3,
  MOVHURDLE: 4,
  SWEEPER: 5,
  SWING: 6,
  BALL: 7,
  CRATE: 8,
} as const;

export const OBSTACLE_NAMES = ['Hurdle', 'Foam Wall', 'Slide Bar', 'Moving Wall', 'Moving Hurdle', 'Sweeper', 'Swinging Barrier', 'Rolling Ball', 'Falling Crate'];

export interface ObstacleDef {
  kind: number;
  s: number;
  lane0: number;
  lane1: number;
  period?: number;
  phase?: number; // seconds
  radius?: number;
  sLen?: number; // rolling ball chute length
  speed?: number;
}

export interface Obstacle extends ObstacleDef {
  id: number;
  hd: number; // half depth along s
  y0: number;
  y1: number;
  major: boolean;
  sMin: number;
  sMax: number;
  xMin: number; // lateral sweep extent (for stats / culling)
  xMax: number;
}

export const ZK = {
  GATE_GREEN: 0,
  GATE_BLUE: 1,
  GATE_YELLOW: 2,
  GATE_RED: 3,
  RAMP: 4,
  RECOVERY: 5,
  MUD: 6,
  ICE: 7,
  BOOSTPAD: 8,
} as const;

export interface ZoneDef { kind: number; s0: number; s1: number; lane0: number; lane1: number; }

export interface PlatformDef { sOff: number; len: number; lane0: number; lane1: number; amp: number; period: number; phase: number; }
export interface PitDef { s0: number; s1: number; lane0: number; lane1: number; platforms: PlatformDef[]; }
export interface LaneSpan { s0: number; s1: number; min: number; max: number; }
export interface WallDef { s0: number; s1: number; lane0: number; lane1: number; }
export interface Spot { s: number; lane: number; }

export interface TrackDef {
  id: 'stadium' | 'arena';
  name: string;
  subtitle: string;
  difficulty: string;
  description: string;
  segs: PathSeg[];
  /** total race length = lap length * laps */
  length: number;
  laps: number;
  narrow: LaneSpan[];
  walls: WallDef[];
  obstacles: ObstacleDef[];
  zones: ZoneDef[];
  pits: PitDef[];
  boxes: Spot[];
  pickups: Spot[];
  checkpoints: number[];
}

export interface Track {
  def: TrackDef;
  length: number;
  lapLength: number;
  laps: number;
  obstacles: Obstacle[]; // sorted by sMin
  zones: ZoneDef[];
  pits: PitDef[];
  boxes: Spot[];
  pickups: Spot[];
  checkpoints: number[];
}

const OBS_SPEC: Record<number, { hd: number; y0: number; y1: number; major: boolean }> = {
  [OK.HURDLE]: { hd: 0.15, y0: 0, y1: 0.7, major: false },
  [OK.LOWWALL]: { hd: 0.5, y0: 0, y1: 0.85, major: true },
  [OK.HIGHBAR]: { hd: 0.25, y0: 0.72, y1: 3.0, major: true },
  [OK.MOVWALL]: { hd: 0.4, y0: 0, y1: 2.6, major: true },
  [OK.MOVHURDLE]: { hd: 0.15, y0: 0, y1: 0.7, major: false },
  [OK.SWEEPER]: { hd: 0, y0: 0, y1: 0.75, major: false },
  [OK.SWING]: { hd: 0.6, y0: 0, y1: 2.2, major: true },
  [OK.BALL]: { hd: 1.15, y0: 0, y1: 2.3, major: true },
  [OK.CRATE]: { hd: 0.65, y0: 0, y1: 1.3, major: true },
};

export function buildTrack(def: TrackDef): Track {
  const obstacles: Obstacle[] = def.obstacles.map((o, i) => {
    const spec = OBS_SPEC[o.kind];
    let sMin = o.s - spec.hd;
    let sMax = o.s + spec.hd;
    let xMin = laneX(o.lane0) - LANE_WIDTH / 2;
    let xMax = laneX(o.lane1) + LANE_WIDTH / 2;
    if (o.kind === OK.SWEEPER) {
      const r = o.radius ?? 2.4;
      sMin = o.s - r; sMax = o.s + r;
      xMin = laneX(o.lane0) - r; xMax = laneX(o.lane0) + r;
    }
    if (o.kind === OK.BALL) { sMax = o.s + (o.sLen ?? 80) + spec.hd; }
    return { ...o, id: i, hd: spec.hd, y0: spec.y0, y1: spec.y1, major: spec.major, sMin, sMax, xMin, xMax };
  });
  obstacles.sort((a, b) => a.sMin - b.sMin);
  obstacles.forEach((o, i) => (o.id = i));
  return {
    def,
    length: def.length,
    lapLength: pathLength(def.segs),
    laps: def.laps,
    obstacles,
    zones: def.zones,
    pits: def.pits,
    boxes: def.boxes,
    pickups: def.pickups,
    checkpoints: def.checkpoints,
  };
}

export function pathLength(segs: PathSeg[]): number { return segs.reduce((a, s) => a + s.len, 0); }

/** Map race distance to lap-local distance (all track features are authored per lap). */
export function wrapS(track: Track, s: number): number {
  if (track.laps <= 1) return s;
  const L = track.lapLength;
  let r = s % L;
  if (r < 0) r += L;
  return r;
}

// ---------------------------------------------------------------- lanes
export function laneRangeAt(track: Track, s: number): [number, number] {
  s = wrapS(track, s);
  let min = 0, max = LANE_COUNT - 1;
  for (const n of track.def.narrow) if (s >= n.s0 && s <= n.s1) { min = Math.max(min, n.min); max = Math.min(max, n.max); }
  return [min, max];
}

export function laneAllowed(track: Track, lane: number, s: number): boolean {
  if (lane < 0 || lane >= LANE_COUNT) return false;
  const [min, max] = laneRangeAt(track, s);
  if (lane < min || lane > max) return false;
  s = wrapS(track, s);
  for (const w of track.def.walls) if (s >= w.s0 && s <= w.s1 && lane >= w.lane0 && lane <= w.lane1) return false;
  return true;
}

/** True if a lane stays open for the whole window [s, s+ahead]. */
export function laneOpenAhead(track: Track, lane: number, s: number, ahead: number): boolean {
  for (let d = 0; d <= ahead; d += 3) if (!laneAllowed(track, lane, s + d)) return false;
  return true;
}

// ---------------------------------------------------------------- obstacles
const TAU = Math.PI * 2;

/** Lateral centre offset (m) for moving obstacles at time t. */
export function obstacleXOffset(o: ObstacleDef, t: number): number {
  const p = o.period ?? 3;
  const ph = o.phase ?? 0;
  if (o.kind === OK.MOVWALL || o.kind === OK.MOVHURDLE) {
    const w = o.kind === OK.MOVWALL ? 2 : 3;
    const a = laneX(o.lane0) - LANE_WIDTH / 2 + (w * LANE_WIDTH) / 2;
    const b = laneX(o.lane1) + LANE_WIDTH / 2 - (w * LANE_WIDTH) / 2;
    const k = 0.5 + 0.5 * Math.sin((TAU * (t + ph)) / p);
    return a + (b - a) * k;
  }
  if (o.kind === OK.SWING) {
    const a = laneX(o.lane0);
    const b = laneX(o.lane1);
    const k = 0.5 + 0.5 * Math.sin((TAU * (t + ph)) / p);
    return a + (b - a) * k;
  }
  return 0;
}

export function sweeperAngle(o: ObstacleDef, t: number): number {
  return (TAU * (t + (o.phase ?? 0))) / (o.period ?? 2.5);
}

/** Rolling ball centre s at time t, or -1 when inactive. */
export function ballS(o: ObstacleDef, t: number): number {
  const len = o.sLen ?? 80;
  const sp = o.speed ?? 12;
  const p = o.period ?? 9;
  let tau = (t + (o.phase ?? 0)) % p;
  if (tau < 0) tau += p;
  const sb = o.s + len - sp * tau;
  return sb >= o.s ? sb : -1;
}

/** Falling crate: returns crate bottom height, or -1 when not present. Also returns phase info. */
export function crateState(o: ObstacleDef, t: number): { y: number; warn: number; broken: boolean } {
  const p = o.period ?? 3.2;
  let tau = (t + (o.phase ?? 0)) % p;
  if (tau < 0) tau += p;
  if (tau < 0.7) return { y: -1, warn: tau / 0.7, broken: false };
  if (tau < 1.25) {
    const k = (tau - 0.7) / 0.55;
    return { y: 14 * (1 - k * k), warn: 1, broken: false };
  }
  if (tau < 2.05) return { y: 0, warn: 1, broken: false };
  return { y: -1, warn: 0, broken: true };
}

export function obstacleHit(o: Obstacle, t: number, s: number, x: number, y: number, h: number): boolean {
  if (s + RACER_HALF_LEN < o.sMin || s - RACER_HALF_LEN > o.sMax) return false;
  switch (o.kind) {
    case OK.HURDLE:
    case OK.LOWWALL:
    case OK.HIGHBAR: {
      if (Math.abs(s - o.s) > o.hd + RACER_HALF_LEN) return false;
      const x0 = laneX(o.lane0) - LANE_WIDTH / 2, x1 = laneX(o.lane1) + LANE_WIDTH / 2;
      if (x + RACER_HALF_W < x0 || x - RACER_HALF_W > x1) return false;
      return y < o.y1 && y + h > o.y0;
    }
    case OK.MOVWALL:
    case OK.MOVHURDLE: {
      if (Math.abs(s - o.s) > o.hd + RACER_HALF_LEN) return false;
      const w = (o.kind === OK.MOVWALL ? 2 : 3) * LANE_WIDTH;
      const cx = obstacleXOffset(o, t);
      if (Math.abs(x - cx) > w / 2 + RACER_HALF_W - 0.1) return false;
      return y < o.y1 && y + h > o.y0;
    }
    case OK.SWING: {
      if (Math.abs(s - o.s) > o.hd + RACER_HALF_LEN) return false;
      const cx = obstacleXOffset(o, t);
      if (Math.abs(x - cx) > 0.75 + RACER_HALF_W - 0.1) return false;
      return y < o.y1 && y + h > o.y0;
    }
    case OK.SWEEPER: {
      if (y >= o.y1) return false;
      const r = o.radius ?? 2.4;
      const th = sweeperAngle(o, t);
      const dx = x - laneX(o.lane0);
      const ds = s - o.s;
      const along = dx * Math.cos(th) + ds * Math.sin(th);
      const perp = Math.abs(-dx * Math.sin(th) + ds * Math.cos(th));
      return Math.abs(along) < r && perp < 0.15 + 0.4;
    }
    case OK.BALL: {
      const sb = ballS(o, t);
      if (sb < 0) return false;
      if (Math.abs(s - sb) > 1.15 + RACER_HALF_LEN - 0.15) return false;
      if (Math.abs(x - laneX(o.lane0)) > 1.15 + RACER_HALF_W - 0.35) return false;
      return y < 2.1;
    }
    case OK.CRATE: {
      if (Math.abs(s - o.s) > o.hd + RACER_HALF_LEN) return false;
      const x0 = laneX(o.lane0) - LANE_WIDTH / 2 + 0.1, x1 = laneX(o.lane1) + LANE_WIDTH / 2 - 0.1;
      if (x + RACER_HALF_W < x0 || x - RACER_HALF_W > x1) return false;
      const c = crateState(o, t);
      if (c.y < 0) return false;
      return y < c.y + 1.3 && y + h > c.y;
    }
  }
  return false;
}

/** Whether an obstacle can be cleared by jumping (for a given jump apex) or sliding. */
export function obstacleJumpable(o: Obstacle, apex: number): boolean {
  if (o.kind === OK.HURDLE || o.kind === OK.MOVHURDLE || o.kind === OK.SWEEPER || o.kind === OK.LOWWALL) return apex > o.y1 + 0.15;
  return false;
}
export function obstacleSlidable(o: Obstacle): boolean { return o.kind === OK.HIGHBAR; }

// ---------------------------------------------------------------- zones / pits
export function zoneContains(z: ZoneDef, s: number, x: number): boolean {
  if (s < z.s0 || s > z.s1) return false;
  return x >= laneX(z.lane0) - LANE_WIDTH / 2 && x <= laneX(z.lane1) + LANE_WIDTH / 2;
}

export function platformCenter(p: PlatformDef, t: number): number {
  const c = (laneX(p.lane0) + laneX(p.lane1)) / 2;
  return c + p.amp * Math.sin((TAU * (t + p.phase)) / p.period);
}
export const platformHalfW = (p: PlatformDef): number => ((p.lane1 - p.lane0 + 1) * LANE_WIDTH) / 2;

/** Returns the pit the racer is over (and unsupported by a platform), or null. */
export function pitUnder(track: Track, s: number, x: number, t: number): PitDef | null {
  s = wrapS(track, s);
  for (const pit of track.pits) {
    if (s < pit.s0 || s > pit.s1) continue;
    if (x < laneX(pit.lane0) - LANE_WIDTH / 2 || x > laneX(pit.lane1) + LANE_WIDTH / 2) continue;
    for (const p of pit.platforms) {
      const ps = pit.s0 + p.sOff;
      if (s >= ps - 0.3 && s <= ps + p.len + 0.3 && Math.abs(x - platformCenter(p, t)) <= platformHalfW(p) + 0.1) return null;
    }
    return pit;
  }
  return null;
}
