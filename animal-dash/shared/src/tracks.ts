// The two playable maps. Layouts are hand-authored in track space so that every
// obstacle cluster always leaves a fair solution (an open lane, a jump or a slide).
// `npm run test:sim` in /server runs bots through both maps to verify this.

import { OK, ZK, TrackDef, ObstacleDef, ZoneDef, Spot, pathLength, PathSeg, buildTrack, Track } from './track';

const hurdle = (s: number, l0 = 0, l1 = 7): ObstacleDef => ({ kind: OK.HURDLE, s, lane0: l0, lane1: l1 });
const lowwall = (s: number, l0 = 0, l1 = 7): ObstacleDef => ({ kind: OK.LOWWALL, s, lane0: l0, lane1: l1 });
const highbar = (s: number, l0 = 0, l1 = 7): ObstacleDef => ({ kind: OK.HIGHBAR, s, lane0: l0, lane1: l1 });
const movwall = (s: number, l0: number, l1: number, period: number, phase = 0): ObstacleDef => ({ kind: OK.MOVWALL, s, lane0: l0, lane1: l1, period, phase });
const movhurdle = (s: number, l0: number, l1: number, period: number, phase = 0): ObstacleDef => ({ kind: OK.MOVHURDLE, s, lane0: l0, lane1: l1, period, phase });
const sweeper = (s: number, center: number, radius: number, period: number, phase = 0): ObstacleDef => ({ kind: OK.SWEEPER, s, lane0: center, lane1: center, radius, period, phase });
const swing = (s: number, l0: number, l1: number, period: number, phase = 0): ObstacleDef => ({ kind: OK.SWING, s, lane0: l0, lane1: l1, period, phase });
const ball = (s: number, lane: number, sLen: number, period: number, phase: number, speed = 12): ObstacleDef => ({ kind: OK.BALL, s, lane0: lane, lane1: lane, sLen, period, phase, speed });
const crate = (s: number, l0: number, l1: number, period: number, phase: number): ObstacleDef => ({ kind: OK.CRATE, s, lane0: l0, lane1: l1, period, phase });

const gate = (kind: number, s: number, l0: number, l1: number): ZoneDef => ({ kind, s0: s, s1: s, lane0: l0, lane1: l1 });
const ramp = (s: number, l0: number, l1: number): ZoneDef => ({ kind: ZK.RAMP, s0: s, s1: s + 4, lane0: l0, lane1: l1 });
const region = (kind: number, s0: number, s1: number, l0 = 0, l1 = 7): ZoneDef => ({ kind, s0, s1, lane0: l0, lane1: l1 });
const row = (s: number, lanes: number[]): Spot[] => lanes.map((lane) => ({ s, lane }));

// ============================================================ STADIUM SPRINT
const stadiumSegs: PathSeg[] = [
  { len: 160, turn: 0, rise: 0 },
  { len: 200, turn: 180, rise: 0 },
  { len: 320, turn: 0, rise: 0 },
  { len: 200, turn: 180, rise: 0 },
  { len: 160, turn: 0, rise: 0 },
];
const STADIUM_LAPS = 2;
const stadiumLen = pathLength(stadiumSegs) * STADIUM_LAPS;

export const STADIUM: TrackDef = {
  id: 'stadium',
  name: 'Stadium Sprint',
  subtitle: 'Professional athletics stadium',
  difficulty: 'Normal',
  description: 'Two laps of a sunny 8-lane athletics oval in front of a roaring crowd. Hurdles, slide bars, sweepers, ramps and boost gates reward clean running.',
  segs: stadiumSegs,
  length: stadiumLen,
  laps: STADIUM_LAPS,
  narrow: [],
  walls: [],
  obstacles: [
    hurdle(80),
    highbar(125, 0, 3), hurdle(125, 4, 7),
    movhurdle(205, 0, 7, 3.2),
    lowwall(275, 0, 2), lowwall(275, 5, 7),
    sweeper(335, 1.5, 2.4, 2.8), sweeper(335, 5.5, 2.4, 2.8, 1.4),
    highbar(400),
    lowwall(497, 5, 7), highbar(512, 5, 7),
    hurdle(545), hurdle(565),
    movwall(610, 0, 7, 4.2),
    hurdle(702, 2, 5),
    sweeper(755, 1.5, 2.4, 2.6), sweeper(755, 5.5, 2.4, 2.6, 1.3),
    highbar(845, 0, 2), lowwall(845, 5, 7),
    movhurdle(920, 0, 7, 3.0, 1.5),
    hurdle(965, 0, 2), hurdle(965, 5, 7),
  ],
  zones: [
    ramp(160, 3, 4), gate(ZK.GATE_GREEN, 168, 0, 1), gate(ZK.GATE_BLUE, 168, 6, 7),
    region(ZK.RECOVERY, 300, 360),
    gate(ZK.GATE_YELLOW, 470, 1, 2), gate(ZK.GATE_RED, 470, 5, 7),
    ramp(690, 0, 1), ramp(690, 6, 7),
    gate(ZK.GATE_GREEN, 800, 3, 4),
    region(ZK.BOOSTPAD, 985, 995, 3, 4),
  ],
  pits: [],
  boxes: [...row(45, [0, 2, 5, 7]), ...row(240, [1, 3, 4, 6]), ...row(650, [0, 2, 5, 7]), ...row(880, [1, 3, 4, 6])],
  pickups: [...row(440, [0, 3, 4, 7]), ...row(900, [0, 7])],
  checkpoints: [stadiumLen * 0.25, stadiumLen * 0.5, stadiumLen * 0.75],
};

// ============================================================ CRAZY OBSTACLE ARENA
const arenaSegs: PathSeg[] = [
  { len: 120, turn: 0, rise: 0 },
  { len: 100, turn: 60, rise: 4 },
  { len: 150, turn: 0, rise: 0 },
  { len: 140, turn: -90, rise: 0 },
  { len: 120, turn: 0, rise: -4 },
  { len: 120, turn: 70, rise: 0 },
  { len: 200, turn: 0, rise: 0 },
  { len: 100, turn: -60, rise: 6 },
  { len: 160, turn: 0, rise: 0 },
  { len: 150, turn: 90, rise: -6 },
  { len: 150, turn: 0, rise: 0 },
  { len: 80, turn: -40, rise: 0 },
  { len: 130, turn: 0, rise: 0 },
];
const arenaLen = pathLength(arenaSegs);

export const ARENA: TrackDef = {
  id: 'arena',
  name: 'Crazy Obstacle Arena',
  subtitle: 'Colourful outdoor obstacle course',
  difficulty: 'Hard',
  description: 'Rolling balls, swinging barriers, falling crates, ice, mud, narrow paths and branching routes with risky shortcuts over moving platforms.',
  segs: arenaSegs,
  length: arenaLen,
  laps: 1,
  narrow: [
    { s0: 170, s1: 235, min: 2, max: 5 },
    { s0: 1290, s1: 1340, min: 3, max: 4 },
  ],
  walls: [
    { s0: 420, s1: 560, lane0: 3, lane1: 4 },
    { s0: 920, s1: 1100, lane0: 2, lane1: 2 },
    { s0: 920, s1: 1100, lane0: 5, lane1: 5 },
  ],
  obstacles: [
    hurdle(90),
    swing(135, 0, 7, 3.0),
    sweeper(200, 3.5, 2.4, 2.4),
    ball(275, 1, 85, 7.5, 0), ball(275, 2, 85, 7.5, 3.6), ball(275, 5, 85, 7.5, 1.8), ball(275, 6, 85, 7.5, 5.4),
    // split #1 — left (safe-ish)
    hurdle(450, 0, 2),
    // split #1 — right (risky pit + red gate)
    lowwall(540, 5, 7),
    // ice field
    hurdle(628, 0, 3), lowwall(645, 4, 7),
    crate(742, 1, 1, 3.0, 0), crate(742, 5, 5, 3.0, 1.5), crate(760, 3, 3, 3.0, 0.8), crate(760, 6, 6, 3.0, 2.2), crate(778, 2, 2, 3.0, 2.0),
    swing(805, 0, 7, 2.8), swing(835, 0, 7, 2.8, 1.4),
    highbar(882, 2, 5),
    // split #2
    hurdle(1020, 0, 1),
    sweeper(970, 3.5, 1.9, 2.2), highbar(1010, 3, 4),
    lowwall(1080, 6, 7),
    movwall(1200, 0, 7, 3.4), movwall(1240, 0, 7, 3.4, 1.7),
    hurdle(1312, 3, 4),
    ball(1420, 0, 80, 7, 0), ball(1420, 2, 80, 7, 2.3), ball(1420, 5, 80, 7, 4.6), ball(1420, 7, 80, 7, 1.2),
    sweeper(1530, 1.5, 2.4, 2.6), sweeper(1530, 5.5, 2.4, 2.6, 1.3),
    highbar(1580), hurdle(1610),
    crate(1665, 2, 2, 2.8, 0), crate(1665, 5, 5, 2.8, 1.4),
  ],
  zones: [
    region(ZK.MUD, 495, 530, 0, 2),
    gate(ZK.GATE_RED, 505, 5, 7),
    region(ZK.ICE, 600, 665),
    gate(ZK.GATE_GREEN, 700, 1, 2), gate(ZK.GATE_YELLOW, 700, 5, 6),
    ramp(870, 0, 1), ramp(870, 6, 7),
    region(ZK.MUD, 950, 990, 0, 1),
    gate(ZK.GATE_RED, 940, 6, 7), gate(ZK.GATE_YELLOW, 1040, 6, 7),
    region(ZK.RECOVERY, 1120, 1180),
    gate(ZK.GATE_BLUE, 1370, 0, 2), gate(ZK.GATE_GREEN, 1370, 5, 7),
    gate(ZK.GATE_GREEN, 1630, 3, 4),
    region(ZK.BOOSTPAD, 1690, 1700, 2, 5),
  ],
  pits: [
    { s0: 466, s1: 486, lane0: 5, lane1: 7, platforms: [{ sOff: 0, len: 12, lane0: 5, lane1: 6, amp: 0.8, period: 2.6, phase: 0 }] },
    { s0: 960, s1: 982, lane0: 6, lane1: 7, platforms: [{ sOff: 0, len: 12, lane0: 6, lane1: 6, amp: 0.8, period: 2.2, phase: 0.5 }] },
  ],
  boxes: [
    ...row(50, [0, 2, 5, 7]), ...row(380, [1, 3, 4, 6]), ...row(520, [5, 6, 7]),
    ...row(715, [0, 3, 4, 7]), ...row(1050, [3, 4, 6, 7]), ...row(1385, [1, 3, 4, 6]), ...row(1640, [0, 7]),
  ],
  pickups: [...row(475, [0, 1, 2]), ...row(990, [3, 4]), ...row(1320, [3, 4]), ...row(1560, [0, 7])],
  checkpoints: [arenaLen * 0.25, arenaLen * 0.5, arenaLen * 0.75],
};

export const TRACK_DEFS: TrackDef[] = [STADIUM, ARENA];
const cache = new Map<string, Track>();
export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = TRACK_DEFS.find((d) => d.id === id) ?? STADIUM;
    t = buildTrack(def);
    cache.set(id, t);
  }
  return t;
}
