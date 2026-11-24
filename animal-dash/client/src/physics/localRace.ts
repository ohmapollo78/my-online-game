// Single-player race driver: runs the authoritative shared Sim locally at a fixed
// 60 Hz timestep with AI opponents, and interpolates render states between ticks.
import { Sim, InputState, copyInput, emptyInput, SimEvent, Racer, racerFlags } from '@shared/sim';
import { AIController, Difficulty, PERSONALITIES, AI_NAMES } from '@shared/ai';
import { DT, FINISH_TIMEOUT_S, TICK_RATE } from '@shared/constants';
import { RacerInfo, ResultsMsg } from '@shared/protocol';
import { computeCoins } from '@shared/progression';
import { RaceSource, RacerRender } from '../game/raceSource';
import { EntityView } from '../items/itemRenderer';

export interface LocalRaceOptions { trackId: string; animal: number; name: string; cosmetics: string; aiCount: number; difficulty: Difficulty; }

export class LocalRace implements RaceSource {
  readonly online = false;
  readonly sim: Sim;
  readonly infos: RacerInfo[];
  readonly myIdx = 0;
  readonly render: RacerRender[];
  private ais: AIController[] = [];
  /** Demo/test mode: an AI drives the local racer (used by automated browser tests). */
  autopilot: AIController | null = null;
  enableAutopilot(difficulty: Difficulty = 'hard'): void {
    const a = new AIController(0, difficulty, 'aggressive', 4242);
    a.input = { ...this.inputs[0] };
    this.autopilot = a;
  }
  private inputs: InputState[];
  private acc = 0;
  private prev: { s: number; x: number; y: number }[];
  private events: SimEvent[] = [];
  private overAt = -1;
  private res: ResultsMsg | null = null;
  get track() { return this.sim.track; }

  constructor(o: LocalRaceOptions) {
    const seed = (Math.random() * 1e9) | 0;
    const n = Math.max(1, Math.min(7, o.aiCount));
    this.infos = [{ idx: 0, playerId: 'local', name: o.name, animal: o.animal, isAI: false, cosmetics: o.cosmetics }];
    const names = AI_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      // varied opponents: everyone else first, then repeats
      const animal = (o.animal + 1 + i) % 5;
      this.infos.push({ idx: i + 1, playerId: '', name: names[i], animal, isAI: true, cosmetics: '' });
    }
    this.sim = new Sim({ trackId: o.trackId, seed, authoritative: true, racers: this.infos.map((r) => ({ animal: r.animal, isAI: r.isAI })) });
    for (let i = 1; i <= n; i++) this.ais.push(new AIController(i, o.difficulty, PERSONALITIES[(i + seed) % 4], seed + i * 7919));
    this.inputs = this.infos.map(() => emptyInput());
    this.prev = this.sim.racers.map((r) => ({ s: r.s, x: r.x, y: r.y }));
    this.render = this.sim.racers.map((r) => ({ idx: r.idx, s: r.s, x: r.x, y: r.y, v: 0, vy: 0, state: r.state, flags: 0, place: r.idx + 1, finished: false, lateral: 0 }));
  }

  update(dt: number, input: InputState): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.sim.racers.forEach((r, i) => { this.prev[i].s = r.s; this.prev[i].x = r.x; this.prev[i].y = r.y; });
      this.inputs[0] = this.autopilot ? this.autopilot.update(this.sim) : copyInput(input);
      for (const ai of this.ais) this.inputs[ai.idx] = ai.update(this.sim);
      this.sim.step(this.inputs);
      if (this.sim.events.length) { this.events.push(...this.sim.events); this.sim.events.length = 0; }
      this.checkOver();
    }
    const a = this.acc / DT;
    this.sim.racers.forEach((r, i) => {
      const p = this.prev[i], o = this.render[i];
      const nx = p.x + (r.x - p.x) * a;
      o.lateral = (nx - o.x) / Math.max(dt, 1e-3);
      o.s = p.s + (r.s - p.s) * a; o.x = nx; o.y = p.y + (r.y - p.y) * a;
      o.v = r.v; o.vy = r.vy; o.state = r.state; o.flags = racerFlags(r); o.place = r.place; o.finished = !!r.finished;
    });
  }

  private checkOver(): void {
    if (this.res) return;
    const sim = this.sim;
    const me = sim.racers[0];
    if (this.overAt < 0) {
      if (me.finished) this.overAt = sim.tick + 4 * TICK_RATE;
      else if (sim.firstFinishTick >= 0) this.overAt = sim.firstFinishTick + FINISH_TIMEOUT_S * TICK_RATE;
    }
    if ((this.overAt >= 0 && sim.tick >= this.overAt) || sim.racers.every((r) => r.finished)) {
      const res = sim.results();
      this.res = {
        trackId: sim.track.def.id,
        entries: res.map((e) => ({
          ...e, name: this.infos[e.idx].name, animal: this.infos[e.idx].animal, isAI: this.infos[e.idx].isAI, playerId: this.infos[e.idx].playerId,
          coins: this.infos[e.idx].isAI ? 0 : computeCoins(e.place, res.length, e.finished, e.items, e.avoided),
        })),
      };
    }
  }

  /** Rendered racers are interpolated one tick behind, so obstacles use the same clock. */
  time(): number { return this.sim.time - DT + this.acc; }
  me(): Racer { return this.sim.racers[0]; }
  boxAvail(i: number): boolean { return this.sim.boxRespawn[i] <= this.sim.tick; }
  pickAvail(i: number): boolean { return this.sim.pickupRespawn[i] <= this.sim.tick; }
  entities(): EntityView[] { return this.sim.entities; }
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }
  isOver(): boolean { return !!this.res; }
  results(): ResultsMsg | null { return this.res; }
  ping(): number { return 0; }
  dispose(): void { /* nothing */ }
}
