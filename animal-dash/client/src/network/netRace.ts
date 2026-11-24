// Online race driver.
//  * Local racer: client-side prediction with the shared Sim (prediction mode), inputs sent
//    every tick, reconciled against the authoritative state + replay of unacknowledged inputs,
//    with the visual correction smoothed out (no teleporting).
//  * Remote racers & entities: snapshot interpolation ~100 ms in the past.
//  * Items, pickups, collisions between racers, results: purely server authoritative.
import { Sim, InputState, copyInput, emptyInput, SimEvent, Racer, racerFlags } from '@shared/sim';
import { DT, EV, TICK_RATE } from '@shared/constants';
import { MSG, RaceInitMsg, RacerInfo, ResultsMsg, Snapshot, decodeSnapshot, decodeEvents, applyOwnState, encodeInput } from '@shared/protocol';
import { RaceSource, RacerRender } from '../game/raceSource';
import { EntityView } from '../items/itemRenderer';
import { NetClient } from './netClient';

const HISTORY = 256;
const INTERP_DELAY_TICKS = 6; // 100 ms
/** Events the client predicts itself for its own racer (server copies are ignored). */
const PREDICTED = new Set<number>([EV.JUMP, EV.LAND, EV.SLIDE, EV.BOOST, EV.GATE, EV.HIT_OBS, EV.KNOCKDOWN, EV.RECOVER, EV.CHECKPOINT,
  EV.EXHAUSTED, EV.ABILITY, EV.RAMP, EV.PIT_FALL, EV.RESPAWN, EV.NINE_LIVES, EV.SMASH, EV.FINISH]);

export class NetRace implements RaceSource {
  readonly online = true;
  readonly sim: Sim;
  infos: RacerInfo[];
  myIdx: number;
  readonly render: RacerRender[];
  private snaps: Snapshot[] = [];
  private history: (InputState | null)[] = new Array(HISTORY).fill(null);
  private seq = 0;
  private predTick = 0;
  private started = false;
  private acc = 0;
  private recvTick = 0; // smoothed estimate of the newest snapshot tick, advanced in real time
  private err = { s: 0, x: 0, y: 0 };
  private events: SimEvent[] = [];
  private res: ResultsMsg | null = null;
  private boxesTaken = new Set<number>();
  private picksTaken = new Set<number>();
  private ents: EntityView[] = [];
  private unsub: (() => void)[] = [];
  stats = { corrections: 0, bigCorrections: 0, maxError: 0, sumError: 0, avgError: 0, snapshots: 0, lateSnapshots: 0, inputsSent: 0 };
  private lastSent: InputState | null = null;
  get track() { return this.sim.track; }

  constructor(private net: NetClient, init: RaceInitMsg) {
    this.infos = init.racers;
    this.myIdx = init.myIdx;
    this.sim = new Sim({ trackId: init.trackId, seed: init.seed, authoritative: false, racers: init.racers.map((r) => ({ animal: r.animal, isAI: r.isAI })) });
    this.sim.startTick = init.startTick;
    this.render = this.sim.racers.map((r) => ({ idx: r.idx, s: r.s, x: r.x, y: r.y, v: 0, vy: 0, state: r.state, flags: 0, place: r.idx + 1, finished: false, lateral: 0 }));
    this.unsub.push(net.on(MSG.SNAP, (a: number[]) => this.onSnapshot(a)));
    this.unsub.push(net.on(MSG.EVENTS, (a: number[]) => this.onEvents(a)));
    this.unsub.push(net.on(MSG.RESULTS, (r: ResultsMsg) => { this.res = r; }));
    this.unsub.push(net.on(MSG.RACE_INIT, (m: RaceInitMsg) => { // resync after reconnection
      this.infos = m.racers; this.myIdx = m.myIdx; this.snaps = []; this.started = false;
    }));
  }

  private onSnapshot(a: number[]): void {
    const snap = decodeSnapshot(a);
    this.stats.snapshots++;
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) { this.stats.lateSnapshots++; return; }
    this.snaps.push(snap);
    if (this.snaps.length > 30) this.snaps.shift();
    const rttTicks = (this.net.rtt / 1000) * TICK_RATE;
    if (!this.started) {
      this.started = true;
      this.recvTick = snap.tick;
      this.predTick = Math.round(snap.tick + rttTicks + 2);
    } else {
      const d = snap.tick - this.recvTick;
      this.recvTick += Math.abs(d) > 20 ? d : d * 0.1;
    }
    this.boxesTaken = new Set(snap.boxesTaken);
    this.picksTaken = new Set(snap.picksTaken);
    // ---------------- reconcile the local racer
    if (snap.own && this.myIdx >= 0) {
      const r = this.sim.racers[this.myIdx];
      const before = { s: r.s, x: r.x, y: r.y };
      applyOwnState(r, snap.own);
      // The server state already includes `ticksSinceAck` ticks driven by input `ack`,
      // which correspond to our seqs ack .. ack+ticksSinceAck-1. Replay only what's left.
      const ack = snap.ackSeq + Math.max(0, snap.ticksSinceAck - 1);
      const pending = Math.min(60, Math.max(0, this.seq - ack));
      const startSeq = this.seq - pending;
      for (let k = 1; k <= pending; k++) {
        const inp = this.history[(startSeq + k) % HISTORY];
        if (inp) this.sim.stepSingle(this.myIdx, inp, snap.tick + k);
      }
      this.sim.events.length = 0; // replays never re-emit feedback
      // keep the prediction horizon close to one RTT ahead of the server
      const target = snap.tick + rttTicks + 2;
      const predNow = snap.tick + pending;
      if (Math.abs(this.predTick - target) > 8) this.predTick = Math.round(target);
      else this.predTick = predNow;
      const ex = before.s - r.s, xx = before.x - r.x, yy = before.y - r.y;
      const mag = Math.hypot(ex, xx, yy);
      if (mag > 0.01) this.stats.corrections++;
      this.stats.maxError = Math.max(this.stats.maxError, mag);
      this.stats.sumError += mag;
      this.stats.avgError = this.stats.sumError / this.stats.snapshots;
      if (mag > 6) { this.stats.bigCorrections++; this.err.s = this.err.x = this.err.y = 0; } // too large: snap
      else { this.err.s += ex; this.err.x += xx; this.err.y += yy; }
    }
  }

  private onEvents(a: number[]): void {
    const { events } = decodeEvents(a);
    for (const e of events) {
      if (e.a === this.myIdx && PREDICTED.has(e.k)) continue;
      this.events.push(e);
    }
  }

  update(dt: number, input: InputState): void {
    if (!this.started) return;
    dt = Math.min(dt, 0.1);
    // ---------------- prediction at a fixed 60 Hz
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.seq++;
      this.predTick++;
      const inp = copyInput(input);
      this.history[this.seq % HISTORY] = inp;
      if (this.myIdx >= 0) {
        this.sim.stepSingle(this.myIdx, inp, this.predTick);
        for (const e of this.sim.events) this.events.push(e);
        this.sim.events.length = 0;
      }
      // 30 Hz input stream, plus an immediate send whenever a button edge happens
      const edge = !this.lastSent || inp.jumpN !== this.lastSent.jumpN || inp.leftN !== this.lastSent.leftN || inp.rightN !== this.lastSent.rightN
        || inp.itemN !== this.lastSent.itemN || inp.abilityN !== this.lastSent.abilityN || inp.boost !== this.lastSent.boost || inp.slide !== this.lastSent.slide;
      if (edge || this.seq % 2 === 0) { this.net.send(MSG.INPUT, encodeInput(this.seq, inp)); this.lastSent = inp; this.stats.inputsSent++; }
    }
    this.recvTick += dt * TICK_RATE;
    // decay the reconciliation error (smooth correction)
    const k = Math.exp(-dt * 10);
    this.err.s *= k; this.err.x *= k; this.err.y *= k;

    // ---------------- remote interpolation
    const rt = this.recvTick - INTERP_DELAY_TICKS;
    let a: Snapshot | null = null, b: Snapshot | null = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] ?? null; break; }
    }
    if (!a) { a = this.snaps[0]; b = null; }
    const f = a && b ? Math.min(1, Math.max(0, (rt - a.tick) / (b.tick - a.tick))) : 0;
    if (a) {
      for (let i = 0; i < this.render.length; i++) {
        const o = this.render[i];
        if (i === this.myIdx) continue;
        const ra = a.racers[i], rb = b ? b.racers[i] : ra;
        if (!ra) continue;
        const nx = ra.x + (rb.x - ra.x) * f;
        o.lateral = (nx - o.x) / Math.max(dt, 1e-3);
        o.s = ra.s + (rb.s - ra.s) * f; o.x = nx; o.y = ra.y + (rb.y - ra.y) * f;
        o.v = ra.v + (rb.v - ra.v) * f; o.vy = (rb.y - ra.y) / Math.max(DT, ((b?.tick ?? a.tick + 1) - a.tick) * DT);
        const src = f > 0.5 ? rb : ra;
        o.state = src.state; o.flags = src.flags; o.place = src.place; o.finished = (src.flags & 512) !== 0;
        const sr = this.sim.racers[i];
        sr.s = o.s; sr.x = o.x; sr.y = o.y; sr.v = o.v; sr.item = src.item; sr.place = src.place; sr.stamina = src.stamina;
      }
      // entities: interpolate by id
      const prev = new Map(a.entities.map((e) => [e.id, e]));
      this.ents = (b ?? a).entities.map((e) => {
        const p = prev.get(e.id);
        return p ? { id: e.id, type: e.type, s: p.s + (e.s - p.s) * f, x: p.x + (e.x - p.x) * f } : e;
      });
    }
    // ---------------- local racer render = prediction + decaying correction
    if (this.myIdx >= 0) {
      const r = this.sim.racers[this.myIdx];
      const o = this.render[this.myIdx];
      const nx = r.x + this.err.x;
      o.lateral = (nx - o.x) / Math.max(dt, 1e-3);
      o.s = r.s + this.err.s; o.x = nx; o.y = Math.max(r.state === 8 ? -20 : 0, r.y + this.err.y);
      o.v = r.v; o.vy = r.vy; o.state = r.state; o.flags = racerFlags(r); o.place = r.place; o.finished = !!r.finished;
    }
  }

  time(): number { return this.sim.timeAtTick(this.predTick) + this.acc; }
  me(): Racer { return this.sim.racers[Math.max(0, this.myIdx)]; }
  boxAvail(i: number): boolean { return !this.boxesTaken.has(i); }
  pickAvail(i: number): boolean { return !this.picksTaken.has(i); }
  entities(): EntityView[] { return this.ents; }
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }
  isOver(): boolean { return !!this.res; }
  results(): ResultsMsg | null { return this.res; }
  ping(): number { return this.net.rtt; }
  dispose(): void { this.unsub.forEach((u) => u()); this.unsub = []; }
}

export { emptyInput };
