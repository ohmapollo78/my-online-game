// Network protocol shared by client and server.
// Clients only ever send *inputs* and lobby choices; the server owns all race state.

import { RACER_FIELDS, Racer, InputState, Sim, racerFlags, Entity, SimEvent } from './sim';

export const MSG = {
  INPUT: 'i',
  READY: 'ready',
  ANIMAL: 'animal',
  COSMETICS: 'cos',
  NAME: 'name',
  SETTINGS: 'settings',
  START: 'start',
  LOADED: 'loaded',
  RESYNC: 'resync',
  BACK_TO_LOBBY: 'tolobby',
  PING: 'ping',
  PONG: 'pong',
  EMOTE: 'emote',
  SNAP: 's',
  EVENTS: 'e',
  RACE_INIT: 'init',
  RESULTS: 'results',
  NOTICE: 'notice',
} as const;

export interface RacerInfo { idx: number; playerId: string; name: string; animal: number; isAI: boolean; cosmetics: string; }
export interface RaceInitMsg { trackId: string; seed: number; startTick: number; tick: number; racers: RacerInfo[]; myIdx: number; }

export interface ResultEntry {
  idx: number; place: number; name: string; animal: number; isAI: boolean; playerId: string;
  finished: boolean; time: number; items: number; avoided: number; boosts: number; knockdowns: number; coins: number;
}
export interface ResultsMsg { trackId: string; entries: ResultEntry[]; }

// ------------------------------------------------------------------ input
export function encodeInput(seq: number, inp: InputState): number[] {
  return [seq, (inp.boost ? 1 : 0) | (inp.slide ? 2 : 0), inp.jumpN, inp.leftN, inp.rightN, inp.itemN, inp.abilityN];
}

/** Validates an untrusted input message. Returns null when malformed. */
export function decodeInput(msg: unknown): { seq: number; inp: InputState } | null {
  if (!Array.isArray(msg) || msg.length !== 7) return null;
  for (const v of msg) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9 || Math.floor(v) !== v) return null;
  const [seq, bits, j, l, r, i, a] = msg as number[];
  return { seq, inp: { boost: (bits & 1) !== 0, slide: (bits & 2) !== 0, jumpN: j, leftN: l, rightN: r, itemN: i, abilityN: a } };
}

// ------------------------------------------------------------------ snapshots
export const COMPACT = 9;
const q = (v: number, k: number) => Math.round(v * k);

/** Part of the snapshot that is identical for every client. */
export function encodeSnapshotCommon(sim: Sim): number[] {
  const out: number[] = [sim.tick, sim.racers.length];
  for (const r of sim.racers) {
    out.push(q(r.s, 100), q(r.x, 100), q(r.y, 100), q(r.v, 100), r.state, racerFlags(r), r.place, r.item + 1, q(r.stamina, 10));
  }
  out.push(sim.entities.length);
  for (const e of sim.entities) out.push(e.id, e.type, q(e.s, 100), q(e.x, 100));
  const boxes: number[] = [];
  sim.boxRespawn.forEach((tk, i) => { if (tk > sim.tick) boxes.push(i); });
  out.push(boxes.length, ...boxes);
  const picks: number[] = [];
  sim.pickupRespawn.forEach((tk, i) => { if (tk > sim.tick) picks.push(i); });
  out.push(picks.length, ...picks);
  return out;
}

/** ticksSinceAck = server ticks simulated since the acknowledged input arrived (makes replay exact). */
export function encodeOwnState(r: Racer, ackSeq: number, ticksSinceAck = 0): number[] {
  const out: number[] = [ackSeq, ticksSinceAck];
  for (const f of RACER_FIELDS) out.push(q(r[f], 1000));
  return out;
}

export interface RemoteRacerSnap { s: number; x: number; y: number; v: number; state: number; flags: number; place: number; item: number; stamina: number; }
export interface Snapshot {
  tick: number;
  racers: RemoteRacerSnap[];
  entities: { id: number; type: number; s: number; x: number }[];
  boxesTaken: number[];
  picksTaken: number[];
  ackSeq: number;
  ticksSinceAck: number;
  own: number[] | null; // raw quantised RACER_FIELDS
}

export function decodeSnapshot(a: number[]): Snapshot {
  let p = 0;
  const tick = a[p++];
  const n = a[p++];
  const racers: RemoteRacerSnap[] = [];
  for (let i = 0; i < n; i++) {
    racers.push({ s: a[p] / 100, x: a[p + 1] / 100, y: a[p + 2] / 100, v: a[p + 3] / 100, state: a[p + 4], flags: a[p + 5], place: a[p + 6], item: a[p + 7] - 1, stamina: a[p + 8] / 10 });
    p += COMPACT;
  }
  const ne = a[p++];
  const entities = [];
  for (let i = 0; i < ne; i++) { entities.push({ id: a[p], type: a[p + 1], s: a[p + 2] / 100, x: a[p + 3] / 100 }); p += 4; }
  const nb = a[p++];
  const boxesTaken = a.slice(p, p + nb); p += nb;
  const np = a[p++];
  const picksTaken = a.slice(p, p + np); p += np;
  let ackSeq = -1, ticksSinceAck = 0;
  let own: number[] | null = null;
  if (p < a.length) { ackSeq = a[p++]; ticksSinceAck = a[p++]; own = a.slice(p, p + RACER_FIELDS.length); }
  return { tick, racers, entities, boxesTaken, picksTaken, ackSeq, ticksSinceAck, own };
}

export function applyOwnState(r: Racer, own: number[]): void {
  RACER_FIELDS.forEach((f, i) => { r[f] = own[i] / 1000; });
}

export function encodeEvents(tick: number, evs: SimEvent[]): number[] {
  const out: number[] = [tick];
  for (const e of evs) out.push(e.k, e.a, e.b, e.c);
  return out;
}
export function decodeEvents(a: number[]): { tick: number; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let p = 1; p + 3 < a.length; p += 4) events.push({ t: 0, k: a[p], a: a[p + 1], b: a[p + 2], c: a[p + 3] });
  return { tick: a[0], events };
}

export type { Entity };
