// Shared constants used by client, server and the deterministic simulation.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3; // 20 Hz snapshots
export const MAX_PLAYERS = 8;

export const LANE_COUNT = 8;
export const LANE_WIDTH = 1.6;
export const laneX = (lane: number): number => (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
export const xToLane = (x: number): number => Math.round(x / LANE_WIDTH + (LANE_COUNT - 1) / 2);

export const GRAVITY = 26;
export const RACER_HALF_LEN = 0.45;
export const RACER_HALF_W = 0.38;
export const SLIDE_HEIGHT = 0.45;

export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const FINISH_TIMEOUT_S = 25;

/** Racer states (plain object instead of const enum so isolatedModules works). */
export const RS = {
  IDLE: 0,
  RUN: 1,
  JUMP: 2,
  SLIDE: 3,
  STUMBLE: 4,
  KNOCKDOWN: 5,
  RECOVER: 6,
  KNOCKBACK: 7,
  FALLPIT: 8,
  FINISHED: 9,
} as const;

/** Item ids */
export const IT = {
  NONE: -1,
  CHICKEN: 0,
  BANANA: 1,
  ROCKET: 2,
  FROZEN: 3,
  SHIELD: 4,
  MEAT: 5,
  CHAOS: 6,
  MAGNET: 7,
} as const;

export const ITEM_INFO = [
  { id: 0, key: 'chicken', name: 'CHICKEN RUN', icon: '🐔', desc: 'Release chickens that charge forward and trip opponents.' },
  { id: 1, key: 'banana', name: 'BANANA TRAP', icon: '🍌', desc: 'Drop a peel behind you. Opponents slip and fall.' },
  { id: 2, key: 'rocket', name: 'ROCKET BOOST', icon: '🚀', desc: 'Instantly rocket forward.' },
  { id: 3, key: 'frozen', name: 'FROZEN BLAST', icon: '❄️', desc: 'Freezing wave slows nearby opponents.' },
  { id: 4, key: 'shield', name: 'SHIELD', icon: '🛡️', desc: 'Blocks one incoming attack.' },
  { id: 5, key: 'meat', name: 'GIANT MEAT', icon: '🍖', desc: 'Bigger, faster and harder to knock over.' },
  { id: 6, key: 'chaos', name: 'CHAOS BOMB', icon: '💣', desc: 'Explosion pushes nearby opponents backwards.' },
  { id: 7, key: 'magnet', name: 'MAGNET PAW', icon: '🧲', desc: 'Pulls in item boxes and stamina pickups.' },
];

/** Simulation events */
export const EV = {
  JUMP: 1,
  LAND: 2,
  SLIDE: 3,
  BOOST: 4,
  ITEM_GET: 5,
  ITEM_USE: 6,
  HIT_OBS: 7,
  KNOCKDOWN: 8,
  RECOVER: 9,
  ATTACK_HIT: 10,
  SHIELD_BLOCK: 11,
  ABILITY: 12,
  GATE: 13,
  STAMINA_PICK: 14,
  FINISH: 15,
  PIT_FALL: 16,
  RESPAWN: 17,
  NINE_LIVES: 18,
  EXHAUSTED: 19,
  CHECKPOINT: 20,
  BOX_TAKEN: 21,
  IMMUNE: 22,
  SMASH: 23,
  BUMP: 24,
  RAMP: 25,
} as const;

/** Snapshot flag bits */
export const FL = {
  BOOSTING: 1,
  SHIELD: 2,
  ROCKET: 4,
  MEAT: 8,
  FROZEN: 16,
  ABILITY: 32,
  EXHAUSTED: 64,
  MAGNET: 128,
  GROUNDED: 256,
  FINISHED: 512,
  INVULN: 1024,
  GATE_BOOST: 2048,
} as const;

export const GATE = { GREEN: 0, BLUE: 1, YELLOW: 2, RED: 3 } as const;
