// Server-side race: owns the authoritative Sim, applies validated player inputs,
// drives AI racers, and decides when the race is over.
import { Sim, InputState, emptyInput, SimEvent } from '@shared/sim';
import { AIController, AI_NAMES, Difficulty, PERSONALITIES } from '@shared/ai';
import { DT, FINISH_TIMEOUT_S, TICK_RATE, MAX_PLAYERS } from '@shared/constants';
import { RacerInfo, ResultsMsg } from '@shared/protocol';
import { computeCoins } from '@shared/progression';

export interface SessionPlayer { sessionId: string; name: string; animal: number; cosmetics: string; }

const MAX_RACE_SECONDS = 300;

export class RaceSession {
  readonly sim: Sim;
  readonly trackId: string;
  readonly seed: number;
  readonly racers: RacerInfo[];
  readonly ais = new Map<number, AIController>();
  private inputs: InputState[];
  private lastSeq: number[];
  private bySession = new Map<string, number>();
  private acc = 0;
  pendingEvents: SimEvent[] = [];
  running = false;
  over = false;
  /** ticks simulated as catch-up (diagnostic for server load) */
  lagTicks = 0;
  private allHumansDoneTick = -1;
  private difficulty: Difficulty;

  constructor(trackId: string, seed: number, players: SessionPlayer[], aiCount: number, difficulty: Difficulty) {
    this.trackId = trackId;
    this.seed = seed;
    this.difficulty = difficulty;
    const racers: RacerInfo[] = players.slice(0, MAX_PLAYERS).map((p, i) => ({
      idx: i, playerId: p.sessionId, name: p.name, animal: p.animal, isAI: false, cosmetics: p.cosmetics,
    }));
    const n = Math.min(aiCount, MAX_PLAYERS - racers.length);
    const off = seed % AI_NAMES.length;
    const names = [...AI_NAMES.slice(off), ...AI_NAMES.slice(0, off)];
    for (let i = 0; i < n; i++) {
      const idx = racers.length;
      racers.push({ idx, playerId: '', name: names[i % names.length], animal: (seed + i * 2) % 5, isAI: true, cosmetics: '' });
    }
    this.racers = racers;
    this.sim = new Sim({ trackId, seed, authoritative: true, racers: racers.map((r) => ({ animal: r.animal, isAI: r.isAI })) });
    racers.forEach((r) => {
      if (r.isAI) this.ais.set(r.idx, new AIController(r.idx, difficulty, PERSONALITIES[(r.idx + seed) % 4], seed * 13 + r.idx * 977));
      else this.bySession.set(r.playerId, r.idx);
    });
    this.inputs = racers.map(() => emptyInput());
    this.lastSeq = racers.map(() => -1);
    this.ackTick = racers.map(() => 0);
  }

  indexOf(sessionId: string): number { return this.bySession.get(sessionId) ?? -1; }
  ackSeq(idx: number): number { return this.lastSeq[idx]; }
  ticksSinceAck(idx: number): number { return Math.max(0, Math.min(120, this.sim.tick - this.ackTick[idx])); }
  private ackTick: number[] = [];

  /** Inputs are monotonic: stale or replayed packets are ignored. */
  applyInput(sessionId: string, seq: number, inp: InputState): void {
    const idx = this.bySession.get(sessionId);
    if (idx === undefined || this.ais.has(idx)) return;
    if (seq <= this.lastSeq[idx]) return;
    this.lastSeq[idx] = seq;
    this.ackTick[idx] = this.sim.tick;
    this.inputs[idx] = inp;
  }

  /** A disconnected human is replaced by a bot that is clearly labelled as AI. */
  replaceWithAI(sessionId: string): number {
    const idx = this.bySession.get(sessionId);
    if (idx === undefined) return -1;
    this.bySession.delete(sessionId);
    const r = this.racers[idx];
    r.isAI = true; r.playerId = ''; r.name = `${r.name} (AI)`;
    this.sim.racers[idx].isAI = 1;
    const ai = new AIController(idx, this.difficulty, 'balanced', this.seed + idx);
    // continue from the player's current input counters so edges stay consistent
    ai.input = { ...this.inputs[idx], boost: false, slide: false };
    this.ais.set(idx, ai);
    return idx;
  }

  /** Advance by wall-clock delta. Returns the number of ticks simulated. */
  update(deltaMs: number): number {
    if (!this.running || this.over) return 0;
    // Catch up on missed ticks when the event loop was delayed (keeps the race in real time),
    // but never more than 1 s of backlog and 30 ticks per call to avoid a death spiral.
    this.acc = Math.min(this.acc + deltaMs / 1000, 1.0);
    let n = 0;
    while (this.acc >= DT && n < 30) {
      this.acc -= DT;
      this.tickOnce();
      n++;
      if (this.over) break;
    }
    this.lagTicks += Math.max(0, n - 1);
    return n;
  }

  private tickOnce(): void {
    for (const [idx, ai] of this.ais) this.inputs[idx] = ai.update(this.sim);
    this.sim.step(this.inputs);
    if (this.sim.events.length) { this.pendingEvents.push(...this.sim.events); this.sim.events.length = 0; }
    const sim = this.sim;
    const t = sim.time;
    const humans = sim.racers.filter((r) => !this.ais.has(r.idx));
    const allDone = sim.racers.every((r) => r.finished);
    const humansDone = humans.length > 0 && humans.every((r) => r.finished);
    if (humansDone && this.allHumansDoneTick < 0) this.allHumansDoneTick = sim.tick;
    const firstDone = sim.firstFinishTick >= 0 && sim.tick - sim.firstFinishTick > FINISH_TIMEOUT_S * TICK_RATE;
    const humansLong = this.allHumansDoneTick >= 0 && sim.tick - this.allHumansDoneTick > 4 * TICK_RATE;
    if (allDone || firstDone || humansLong || t > MAX_RACE_SECONDS || humans.length === 0 && t > 0) this.over = true;
  }

  results(): ResultsMsg {
    const res = this.sim.results();
    const total = res.length;
    return {
      trackId: this.trackId,
      entries: res.map((e) => {
        const info = this.racers[e.idx];
        return {
          idx: e.idx, place: e.place, name: info.name, animal: info.animal, isAI: info.isAI, playerId: info.playerId,
          finished: e.finished, time: e.time, items: e.items, avoided: e.avoided, boosts: e.boosts, knockdowns: e.knockdowns,
          coins: info.isAI ? 0 : computeCoins(e.place, total, e.finished, e.items, e.avoided),
        };
      }),
    };
  }
}
