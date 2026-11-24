// Deterministic race simulation. Runs authoritatively on the game server and in
// single-player, and in "prediction" mode on multiplayer clients (own racer only).

import { ANIMALS, DERIVED, DerivedStats } from './animals';
import {
  DT, EV, GRAVITY, IT, LANE_COUNT, RS, SLIDE_HEIGHT, COUNTDOWN_TICKS, laneX, FL,
} from './constants';
import { Rng } from './rng';
import {
  Track, laneAllowed, laneOpenAhead, obstacleHit, pitUnder, zoneContains, ZK, Obstacle, wrapS,
} from './track';
import { getTrack } from './tracks';

export interface InputState {
  boost: boolean;
  slide: boolean;
  jumpN: number;
  leftN: number;
  rightN: number;
  itemN: number;
  abilityN: number;
}
export const emptyInput = (): InputState => ({ boost: false, slide: false, jumpN: 0, leftN: 0, rightN: 0, itemN: 0, abilityN: 0 });
export const copyInput = (a: InputState): InputState => ({ ...a });

/** Every racer field is numeric so that racers can be packed into arrays for the network. */
export const RACER_FIELDS = [
  'idx', 'animal', 'isAI',
  's', 'x', 'y', 'vy', 'v', 'lane', 'stamina', 'exhausted', 'state', 'stateT', 'slideT', 'slideLock',
  'grounded', 'coyote', 'invuln', 'landT', 'jumpBuf',
  'item', 'itemLock', 'abilityCd', 'abilityT', 'nineUsed', 'shield',
  'tRocket', 'tMeat', 'tFrozen', 'tGateSpeed', 'tGateAccel', 'tGateRed', 'tMagnet', 'tPad', 'kbV',
  'boosting', 'finished', 'finishTime', 'place', 'nextCp', 'nextObs', 'lastHitObs', 'lastHitT', 'respawnS',
  'aJump', 'aLeft', 'aRight', 'aItem', 'aAbility',
  'stItems', 'stAvoided', 'stBoosts', 'stHits', 'stKnock', 'stGates', 'stItemsUsed',
] as const;
export type RacerField = typeof RACER_FIELDS[number];
export type Racer = Record<RacerField, number>;

export interface Entity { id: number; type: number; s: number; x: number; v: number; owner: number; ttl: number; age: number; }
export const ENT = { BANANA: 0, CHICKEN: 1 } as const;
export const ATTACK_CHARGE = 8;

/** k = event type (EV.*), a = racer, b = target/aux, c = extra (e.g. attack kind) */
export interface SimEvent { t: number; a: number; b: number; k: number; c: number; }

export interface SimRacerInit { animal: number; isAI: boolean; }
export interface SimOptions { trackId: string; racers: SimRacerInit[]; seed: number; authoritative: boolean; }

export interface RaceResultEntry {
  idx: number; place: number; finished: boolean; time: number;
  items: number; avoided: number; boosts: number; hits: number; knockdowns: number; gates: number;
}

export const BOOST_MULT = 1.4;
const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

export function newRacer(idx: number, animal: number, isAI: boolean): Racer {
  const r = {} as Racer;
  for (const f of RACER_FIELDS) r[f] = 0;
  r.idx = idx; r.animal = animal; r.isAI = isAI ? 1 : 0;
  r.item = IT.NONE; r.lastHitObs = -1; r.grounded = 1; r.state = RS.IDLE;
  r.stamina = DERIVED[animal].staminaMax;
  return r;
}

export function isControllable(r: Racer): boolean {
  return r.state === RS.RUN || r.state === RS.JUMP || r.state === RS.SLIDE || r.state === RS.STUMBLE;
}

export function racerFlags(r: Racer): number {
  let f = 0;
  if (r.boosting) f |= FL.BOOSTING;
  if (r.shield) f |= FL.SHIELD;
  if (r.tRocket > 0) f |= FL.ROCKET;
  if (r.tMeat > 0) f |= FL.MEAT;
  if (r.tFrozen > 0) f |= FL.FROZEN;
  if (r.abilityT > 0) f |= FL.ABILITY;
  if (r.exhausted) f |= FL.EXHAUSTED;
  if (r.tMagnet > 0) f |= FL.MAGNET;
  if (r.grounded) f |= FL.GROUNDED;
  if (r.finished) f |= FL.FINISHED;
  if (r.invuln > 0) f |= FL.INVULN;
  if (r.tGateSpeed > 0 || r.tGateRed > 0 || r.tPad > 0 || r.tGateAccel > 0) f |= FL.GATE_BOOST;
  return f;
}

export class Sim {
  track: Track;
  racers: Racer[];
  tick = 0;
  startTick = COUNTDOWN_TICKS;
  entities: Entity[] = [];
  nextEntityId = 1;
  boxRespawn: number[];
  pickupRespawn: number[];
  events: SimEvent[] = [];
  rng: Rng;
  authoritative: boolean;
  finishedCount = 0;
  firstFinishTick = -1;
  /** zone state per racer (recomputed every tick) */
  private zIce: boolean[] = [];
  private zMud: boolean[] = [];
  private zRec: boolean[] = [];

  constructor(opts: SimOptions) {
    this.track = getTrack(opts.trackId);
    this.rng = new Rng(opts.seed);
    this.authoritative = opts.authoritative;
    this.racers = opts.racers.map((ri, i) => newRacer(i, ri.animal, ri.isAI));
    // grid: one row across 8 lanes
    const order = [3, 4, 2, 5, 1, 6, 0, 7];
    this.racers.forEach((r, i) => {
      r.lane = order[i % LANE_COUNT];
      r.x = laneX(r.lane);
      r.s = i >= LANE_COUNT ? -3 : 0;
    });
    this.boxRespawn = this.track.boxes.map(() => 0);
    this.pickupRespawn = this.track.pickups.map(() => 0);
  }

  get time(): number { return (this.tick - this.startTick) * DT; }
  timeAtTick(tick: number): number { return (tick - this.startTick) * DT; }

  private ev(t: number, a: number, b = -1, k = 0, c = 0): void { this.events.push({ t, a, b, k, c }); }

  /** Advance the whole race by one tick. inputs[i] belongs to racer i. */
  step(inputs: (InputState | undefined)[]): void {
    this.tick++;
    if (this.tick < this.startTick) return;
    const t = this.time;
    for (let i = 0; i < this.racers.length; i++) this.stepRacer(this.racers[i], inputs[i] ?? EMPTY, t);
    if (this.authoritative) {
      this.updateEntities(t);
      this.interactions(t);
      this.updatePlaces();
    }
  }

  /** Prediction: advance a single racer at a specific server tick (no item/entity authority). */
  stepSingle(idx: number, input: InputState, tick: number): void {
    this.tick = tick;
    if (tick < this.startTick) return;
    this.stepRacer(this.racers[idx], input, this.timeAtTick(tick));
  }

  // ------------------------------------------------------------------ racer
  private stepRacer(r: Racer, inp: InputState, t: number): void {
    const d = DERIVED[r.animal];
    const def = ANIMALS[r.animal];
    const track = this.track;
    const dt = DT;

    r.invuln = Math.max(0, r.invuln - dt);
    r.itemLock = Math.max(0, r.itemLock - dt);
    r.abilityCd = Math.max(0, r.abilityCd - dt);
    r.abilityT = Math.max(0, r.abilityT - dt);
    r.tRocket = Math.max(0, r.tRocket - dt);
    r.tMeat = Math.max(0, r.tMeat - dt);
    r.tFrozen = Math.max(0, r.tFrozen - dt);
    r.tGateSpeed = Math.max(0, r.tGateSpeed - dt);
    r.tGateAccel = Math.max(0, r.tGateAccel - dt);
    r.tGateRed = Math.max(0, r.tGateRed - dt);
    r.tMagnet = Math.max(0, r.tMagnet - dt);
    r.tPad = Math.max(0, r.tPad - dt);
    r.landT = Math.max(0, r.landT - dt);
    r.jumpBuf = Math.max(0, r.jumpBuf - dt);
    r.coyote = Math.max(0, r.coyote - dt);
    if (r.state === RS.IDLE) r.state = RS.RUN;

    if (r.finished) {
      r.boosting = 0;
      r.v = approach(r.v, 7, 14 * dt);
      r.s += r.v * dt;
      r.x = approach(r.x, laneX(r.lane), 4 * dt);
      if (!r.grounded) { r.vy -= GRAVITY * dt; r.y += r.vy * dt; if (r.y <= 0) { r.y = 0; r.vy = 0; r.grounded = 1; } }
      return;
    }

    // ---------------- input edges (counters make edges robust to packet batching)
    let wantJump = false, laneDelta = 0, wantItem = false, wantAbility = false;
    const dj = inp.jumpN - r.aJump;
    if (dj !== 0) { if (dj > 0 && dj < 50) wantJump = true; r.aJump = inp.jumpN; }
    const dl = inp.leftN - r.aLeft;
    if (dl < 0 || dl > 50) r.aLeft = inp.leftN; else if (dl > 0) { r.aLeft++; laneDelta -= 1; }
    const dr = inp.rightN - r.aRight;
    if (dr < 0 || dr > 50) r.aRight = inp.rightN; else if (dr > 0) { r.aRight++; laneDelta += 1; }
    if (this.authoritative) {
      const di = inp.itemN - r.aItem;
      if (di !== 0) { if (di > 0 && di < 50) wantItem = true; r.aItem = inp.itemN; }
    }
    const da = inp.abilityN - r.aAbility;
    if (da !== 0) { if (da > 0 && da < 50) wantAbility = true; r.aAbility = inp.abilityN; }

    // ---------------- state timers
    switch (r.state) {
      case RS.KNOCKDOWN:
        r.stateT -= dt;
        if (r.stateT <= 0) { r.state = RS.RECOVER; r.stateT = 0.4; this.ev(t, r.idx, -1, EV.RECOVER); }
        break;
      case RS.RECOVER:
        r.stateT -= dt;
        if (r.stateT <= 0) { r.state = r.grounded ? RS.RUN : RS.JUMP; r.invuln = Math.max(r.invuln, 1.0); }
        break;
      case RS.KNOCKBACK:
        r.stateT -= dt;
        if (r.stateT <= 0) { r.state = RS.KNOCKDOWN; r.stateT = d.knockdownTime * 0.5; }
        break;
      case RS.STUMBLE:
        r.stateT -= dt;
        if (r.stateT <= 0) r.state = r.grounded ? RS.RUN : RS.JUMP;
        break;
      case RS.SLIDE:
        r.slideT += dt;
        if ((r.slideT >= 0.6 && !inp.slide) || r.slideT >= 1.4) r.state = RS.RUN;
        break;
      case RS.FALLPIT:
        r.stateT -= dt;
        if (r.stateT <= 0) this.respawn(r, t);
        break;
    }
    if (!inp.slide) r.slideLock = 0;

    const ctrl = isControllable(r);

    // ---------------- actions
    if (ctrl) {
      if (laneDelta !== 0) {
        const nl = r.lane + laneDelta;
        if (laneAllowed(track, nl, r.s) && laneAllowed(track, nl, r.s + 4)) r.lane = nl;
      }
      const canJump = (r.grounded || r.coyote > 0) && r.state !== RS.STUMBLE;
      if (wantJump) { if (canJump) this.doJump(r, t, d.jumpV); else r.jumpBuf = 0.15; }
      else if (r.jumpBuf > 0 && canJump) this.doJump(r, t, d.jumpV);

      if (inp.slide && !r.slideLock) {
        if (r.grounded && r.state === RS.RUN) {
          r.state = RS.SLIDE; r.slideT = 0; r.slideLock = 1; this.ev(t, r.idx, -1, EV.SLIDE);
        } else if (!r.grounded && r.state === RS.JUMP) {
          r.vy = Math.min(r.vy, -16); r.slideLock = 1; // fast-fall
        }
      }
      if (wantAbility) this.tryAbility(r, t);
      if (wantItem) this.useItem(r, t);
    }

    // ---------------- auto-steer around narrowing sections / dividers
    if (!laneOpenAhead(track, r.lane, r.s, 21)) {
      let best = -1;
      for (let k = 1; k < LANE_COUNT && best < 0; k++) {
        for (const sgn of [-1, 1]) {
          const l = r.lane + sgn * k;
          let ok = true;
          for (let m = r.lane + sgn; sgn > 0 ? m <= l : m >= l; m += sgn) if (!laneAllowed(track, m, r.s)) { ok = false; break; }
          if (ok && laneOpenAhead(track, l, r.s, 21)) { best = l; break; }
        }
      }
      if (best >= 0) r.lane = best;
    }

    // ---------------- zones
    let onIce = false, onMud = false, inRec = false;
    let prevLs = wrapS(track, r.s);
    for (const z of track.zones) {
      if (z.kind === ZK.RECOVERY || z.kind === ZK.MUD || z.kind === ZK.ICE || z.kind === ZK.BOOSTPAD) {
        if (zoneContains(z, prevLs, r.x)) {
          if (z.kind === ZK.RECOVERY) inRec = true;
          else if (z.kind === ZK.MUD) onMud = r.grounded === 1;
          else if (z.kind === ZK.ICE) onIce = r.grounded === 1;
          else if (r.grounded) { if (r.tPad <= 0) this.ev(t, r.idx, -1, EV.GATE); r.tPad = 1.2; }
        }
      }
    }
    this.zIce[r.idx] = onIce; this.zMud[r.idx] = onMud; this.zRec[r.idx] = inRec;

    // ---------------- lateral
    let lat = def.agility;
    if (!r.grounded) lat *= def.airControl;
    if (r.state === RS.STUMBLE) lat *= 0.7;
    if (onIce) lat *= 0.45;
    if (!ctrl) lat *= 0.35;
    r.x = approach(r.x, laneX(r.lane), lat * dt);

    // ---------------- speed
    const boostWant = inp.boost && ctrl && !r.exhausted && r.stamina > 0;
    if (boostWant && !r.boosting) { r.stBoosts++; this.ev(t, r.idx, -1, EV.BOOST); }
    r.boosting = boostWant ? 1 : 0;

    if (ctrl) {
      let mult = 1;
      if (r.exhausted) mult *= 0.8;
      if (r.boosting) mult *= BOOST_MULT;
      if (r.tRocket > 0) mult *= 1.6;
      if (r.tMeat > 0) mult *= 1.15;
      if (r.abilityT > 0) {
        const ab = def.ability.id;
        if (ab === 'icedash') mult *= 1.65;
        else if (ab === 'bullcharge') mult *= 1.3;
        else if (ab === 'shadowstep' && r.abilityT > def.ability.duration - 1.5) mult *= 1.25;
      }
      if (r.tGateRed > 0) mult *= 1.45;
      else if (r.tGateSpeed > 0 || r.tPad > 0) mult *= 1.2;
      if (r.tGateAccel > 0) mult *= 1.08;
      if (r.tFrozen > 0) mult *= 0.6;
      if (onMud && r.tRocket <= 0) mult *= 0.6;
      if (r.state === RS.SLIDE) mult *= 0.93;
      if (r.state === RS.STUMBLE) mult *= 0.55;
      const target = d.maxSpeed * mult;
      let acc = d.accel * (r.boosting ? 1.4 : 1) * (r.tGateAccel > 0 ? 2.2 : 1) * (onIce ? 0.5 : 1);
      if (!r.grounded) acc *= 0.35;
      r.v = r.v < target ? Math.min(target, r.v + acc * dt) : Math.max(target, r.v - 10 * dt);
    } else if (r.state === RS.KNOCKDOWN) r.v = approach(r.v, 0, 22 * dt);
    else if (r.state === RS.RECOVER) r.v = approach(r.v, d.maxSpeed * 0.25, d.accel * dt);
    else if (r.state === RS.KNOCKBACK) r.v = approach(r.v, 0, 12 * dt);
    else if (r.state === RS.FALLPIT) r.v = approach(r.v, 0, 30 * dt);

    // ---------------- stamina
    if (r.boosting) r.stamina -= d.drain * dt;
    else {
      let rg = d.regen;
      if (inRec) rg *= 3;
      if (!ctrl) rg *= 1.3;
      r.stamina = Math.min(d.staminaMax, r.stamina + rg * dt);
    }
    if (r.stamina <= 0) {
      r.stamina = 0;
      if (!r.exhausted) { r.exhausted = 1; r.boosting = 0; this.ev(t, r.idx, -1, EV.EXHAUSTED); }
    }
    if (r.exhausted && r.stamina >= d.staminaMax * 0.35) r.exhausted = 0;

    // ---------------- integrate
    r.s += r.v * dt;
    const ls = wrapS(track, r.s);
    if (ls < prevLs - 1) { prevLs -= track.lapLength; r.nextObs = 0; } // crossed into a new lap

    // ramps & gates (crossing based)
    for (const z of track.zones) {
      if (prevLs < z.s0 && ls >= z.s0) {
        const inLane = r.x >= laneX(z.lane0) - 0.8 && r.x <= laneX(z.lane1) + 0.8;
        if (!inLane) continue;
        if (z.kind === ZK.RAMP) {
          if (r.grounded && ctrl) {
            r.vy = 11; r.grounded = 0; if (r.state === RS.SLIDE || r.state === RS.RUN) r.state = RS.JUMP;
            this.ev(t, r.idx, -1, EV.RAMP);
          }
        } else if (z.kind <= ZK.GATE_RED) this.applyGate(r, z.kind, t, d);
      }
    }

    this.vertical(r, inp, t);

    // ---------------- obstacles
    if (r.invuln <= 0 && r.state !== RS.FALLPIT) {
      const meat = r.tMeat > 0 ? 1.25 : 1;
      const h = r.state === RS.SLIDE ? SLIDE_HEIGHT : (r.state === RS.KNOCKDOWN || r.state === RS.RECOVER ? 0.5 : def.height * meat);
      const obs = track.obstacles;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (o.sMin > ls + 2) break;
        if (o.sMax < ls - 2) continue;
        if (o.id === r.lastHitObs && t - r.lastHitT < 1.6) continue;
        if (obstacleHit(o, t, ls, r.x, r.y, h)) { this.hitObstacle(r, o, t); break; }
      }
    }
    const obs = track.obstacles;
    while (r.nextObs < obs.length && obs[r.nextObs].sMax < ls) {
      const o = obs[r.nextObs];
      if (o.id !== r.lastHitObs && r.x >= o.xMin - 0.4 && r.x <= o.xMax + 0.4) r.stAvoided++;
      r.nextObs++;
    }

    // ---------------- pickups (authoritative only)
    if (this.authoritative) this.collect(r, t);

    // ---------------- checkpoints & finish
    const cps = track.checkpoints;
    if (r.nextCp < cps.length && r.s >= cps[r.nextCp]) { this.ev(t, r.idx, -1, EV.CHECKPOINT); r.nextCp++; }
    if (r.s >= track.length) {
      r.finished = 1;
      r.state = RS.FINISHED;
      r.boosting = 0;
      r.finishTime = Math.max(0, t - (r.s - track.length) / Math.max(1, r.v));
      if (this.authoritative) {
        r.place = ++this.finishedCount;
        if (this.firstFinishTick < 0) this.firstFinishTick = this.tick;
      }
      this.ev(t, r.idx, -1, EV.FINISH);
    }
  }

  private doJump(r: Racer, t: number, jumpV: number): void {
    r.vy = jumpV * (r.tMeat > 0 ? 1.05 : 1);
    r.grounded = 0; r.coyote = 0; r.jumpBuf = 0;
    r.state = RS.JUMP;
    this.ev(t, r.idx, -1, EV.JUMP);
  }

  private vertical(r: Racer, inp: InputState, t: number): void {
    const dt = DT;
    if (r.state === RS.FALLPIT) {
      r.vy -= GRAVITY * dt; r.y = Math.max(-14, r.y + r.vy * dt);
      return;
    }
    if (!r.grounded) {
      r.vy -= GRAVITY * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) {
        if (pitUnder(this.track, r.s, r.x, t)) {
          if (r.y < -0.7) this.startFall(r, t);
        } else if (r.y > -0.5) {
          r.y = 0; r.grounded = 1;
          if (r.vy < -5) { r.landT = 0.25; this.ev(t, r.idx, -1, EV.LAND); }
          r.vy = 0;
          if (r.state === RS.JUMP) {
            if (inp.slide) { r.state = RS.SLIDE; r.slideT = 0; r.slideLock = 1; this.ev(t, r.idx, -1, EV.SLIDE); }
            else r.state = RS.RUN;
          }
        } else {
          // fell below the lip while under-cutting a platform edge
          this.startFall(r, t);
        }
      }
    } else if (pitUnder(this.track, r.s, r.x, t)) {
      r.grounded = 0; r.vy = 0; r.coyote = 0.12;
      if (r.state === RS.SLIDE || r.state === RS.RUN) r.state = RS.JUMP;
    }
  }

  private startFall(r: Racer, t: number): void {
    let end = r.s + 2;
    const ls = wrapS(this.track, r.s);
    for (const p of this.track.pits) if (ls >= p.s0 - 1 && ls <= p.s1 + 1) end = r.s + (p.s1 + 2 - ls);
    r.respawnS = end;
    r.state = RS.FALLPIT; r.stateT = 1.2; r.boosting = 0;
    r.stKnock++;
    this.ev(t, r.idx, -1, EV.PIT_FALL);
  }

  private respawn(r: Racer, t: number): void {
    r.s = r.respawnS; r.y = 0; r.vy = 0; r.grounded = 1;
    r.v = DERIVED[r.animal].maxSpeed * 0.4;
    r.state = RS.RUN; r.invuln = 1.5;
    if (!laneAllowed(this.track, r.lane, r.s)) {
      for (let k = 1; k < LANE_COUNT; k++) {
        if (laneAllowed(this.track, r.lane - k, r.s)) { r.lane -= k; break; }
        if (laneAllowed(this.track, r.lane + k, r.s)) { r.lane += k; break; }
      }
    }
    r.x = laneX(r.lane);
    this.ev(t, r.idx, -1, EV.RESPAWN);
  }

  private applyGate(r: Racer, kind: number, t: number, d: DerivedStats): void {
    r.stGates++;
    if (kind === ZK.GATE_GREEN) r.tGateSpeed = 2.2;
    else if (kind === ZK.GATE_BLUE) r.stamina = Math.min(d.staminaMax, r.stamina + d.staminaMax * 0.45);
    else if (kind === ZK.GATE_YELLOW) r.tGateAccel = 3;
    else if (kind === ZK.GATE_RED) { r.tGateRed = 2.6; r.v = Math.max(r.v, d.maxSpeed * 1.2); }
    this.ev(t, r.idx, kind, EV.GATE);
  }

  private hitObstacle(r: Racer, o: Obstacle, t: number): void {
    const def = ANIMALS[r.animal];
    const d = DERIVED[r.animal];
    let major = o.major;
    const ab = def.ability.id;
    const active = r.abilityT > 0;
    r.lastHitObs = o.id; r.lastHitT = t;
    if (active && ab === 'bullcharge') {
      if (!major || o.kind !== 7) { this.ev(t, r.idx, o.id, EV.SMASH); r.v *= 0.97; return; }
      major = false;
    }
    if (r.tRocket > 0 && !major) { this.ev(t, r.idx, o.id, EV.SMASH); return; }
    if ((active && ab === 'ironbark') || r.tMeat > 0) {
      if (major) major = false;
      else { r.v *= 0.9; this.ev(t, r.idx, o.id, EV.HIT_OBS); return; }
    }
    r.stHits++;
    if (major) this.knockdown(r, 1, t);
    else {
      r.v *= 0.55 + 0.3 * def.resist;
      if (isControllable(r)) { r.state = RS.STUMBLE; r.stateT = d.stumbleTime; }
      r.invuln = 0.35;
      this.ev(t, r.idx, o.id, EV.HIT_OBS);
    }
  }

  private knockdown(r: Racer, scale: number, t: number): void {
    const def = ANIMALS[r.animal];
    const d = DERIVED[r.animal];
    if (def.ability.id === 'ninelives' && !r.nineUsed) {
      r.nineUsed = 1; r.v *= 0.85; r.invuln = 1.2;
      r.state = r.grounded ? RS.RUN : RS.JUMP;
      this.ev(t, r.idx, -1, EV.NINE_LIVES);
      return;
    }
    const k = scale * (1 - def.resist * 0.35);
    r.state = RS.KNOCKDOWN; r.stateT = d.knockdownTime * k; r.v *= 0.35; r.boosting = 0;
    r.invuln = r.stateT + 0.5;
    r.stKnock++;
    this.ev(t, r.idx, -1, EV.KNOCKDOWN);
  }

  private tryAbility(r: Racer, t: number): void {
    const ab = ANIMALS[r.animal].ability;
    if (ab.passive || r.abilityCd > 0 || r.stamina < ab.cost) return;
    r.stamina -= ab.cost;
    r.abilityCd = ab.cooldown;
    r.abilityT = ab.duration;
    if (ab.id === 'icedash') r.v += 8;
    if (ab.id === 'bullcharge') r.v += 3;
    this.ev(t, r.idx, -1, EV.ABILITY);
  }

  // ------------------------------------------------------------------ items
  rollItem(r: Racer): number {
    const n = this.racers.length;
    const f = n <= 1 ? 0.5 : (Math.max(1, r.place || 1) - 1) / (n - 1);
    const lead = [2, 4, 0.6, 1, 3, 0.6, 1, 2.5];
    const last = [3, 1, 4, 3, 0.6, 3, 3, 1];
    const w = lead.map((a, i) => a + (last[i] - a) * f);
    return this.rng.weighted(w);
  }

  private collect(r: Racer, t: number): void {
    if (r.state === RS.FALLPIT) return;
    const boxes = this.track.boxes;
    const magnet = r.tMagnet > 0;
    const ls = wrapS(this.track, r.s);
    for (let i = 0; i < boxes.length; i++) {
      if (this.boxRespawn[i] > this.tick) continue;
      const b = boxes[i];
      const ds = b.s - ls;
      if (ds < -2 || ds > 26) continue;
      const near = Math.abs(ds) < 1.1 && Math.abs(laneX(b.lane) - r.x) < 1.0 && r.y < 2.4;
      const pulled = magnet && ds > -2 && ds < 25 && r.item < 0;
      if (near || pulled) {
        this.boxRespawn[i] = this.tick + 180;
        this.ev(t, r.idx, i, EV.BOX_TAKEN);
        if (r.item < 0) {
          r.item = this.rollItem(r);
          r.itemLock = 0.5;
          r.stItems++;
          this.ev(t, r.idx, r.item, EV.ITEM_GET);
        }
      }
    }
    const pk = this.track.pickups;
    const dd = DERIVED[r.animal];
    for (let i = 0; i < pk.length; i++) {
      if (this.pickupRespawn[i] > this.tick) continue;
      const p = pk[i];
      const ds = p.s - ls;
      if (ds < -2 || ds > 26) continue;
      const near = Math.abs(ds) < 1.1 && Math.abs(laneX(p.lane) - r.x) < 1.0 && r.y < 2.4;
      if (near || (magnet && ds > -2 && ds < 25)) {
        this.pickupRespawn[i] = this.tick + 360;
        r.stamina = Math.min(dd.staminaMax, r.stamina + 25);
        this.ev(t, r.idx, i, EV.STAMINA_PICK);
      }
    }
  }

  private useItem(r: Racer, t: number): void {
    if (r.item < 0 || r.itemLock > 0) return;
    const it = r.item;
    r.item = IT.NONE;
    r.stItemsUsed++;
    this.ev(t, r.idx, it, EV.ITEM_USE);
    const d = DERIVED[r.animal];
    switch (it) {
      case IT.CHICKEN: {
        for (const dl of [-1, 0, 1]) {
          const l = r.lane + dl;
          if (!laneAllowed(this.track, l, r.s)) continue;
          this.entities.push({ id: this.nextEntityId++, type: ENT.CHICKEN, s: r.s + 1.5, x: laneX(l), v: Math.max(r.v + 11, 30), owner: r.idx, ttl: 4, age: 0 });
        }
        break;
      }
      case IT.BANANA:
        this.entities.push({ id: this.nextEntityId++, type: ENT.BANANA, s: r.s - 2.2, x: r.x, v: 0, owner: r.idx, ttl: 40, age: 0 });
        break;
      case IT.ROCKET:
        r.tRocket = 2.5; r.v = Math.max(r.v, d.maxSpeed * 1.45);
        break;
      case IT.FROZEN:
        for (const o of this.racers) if (o !== r && Math.abs(o.s - r.s) <= 22) this.attack(r, o, IT.FROZEN, t);
        break;
      case IT.SHIELD:
        r.shield = 1;
        break;
      case IT.MEAT:
        r.tMeat = 5;
        break;
      case IT.CHAOS:
        for (const o of this.racers) if (o !== r && Math.abs(o.s - r.s) <= 12 && Math.abs(o.x - r.x) <= 6) this.attack(r, o, IT.CHAOS, t);
        break;
      case IT.MAGNET:
        r.tMagnet = 6;
        break;
    }
  }

  attack(att: Racer, vic: Racer, kind: number, t: number): void {
    if (vic.finished || vic.state === RS.FALLPIT) return;
    const vdef = ANIMALS[vic.animal];
    if (vic.abilityT > 0 && vdef.ability.id === 'shadowstep') { this.ev(t, vic.idx, att.idx, EV.IMMUNE); return; }
    if (vic.shield) { vic.shield = 0; this.ev(t, vic.idx, att.idx, EV.SHIELD_BLOCK); return; }
    const res = Math.min(0.9, vdef.attackResist + (vic.tMeat > 0 ? 0.4 : 0));
    const iron = vic.abilityT > 0 && vdef.ability.id === 'ironbark';
    vic.stHits++;
    this.ev(t, att.idx, vic.idx, EV.ATTACK_HIT, kind);
    const ctrl = isControllable(vic);
    switch (kind) {
      case IT.CHICKEN:
      case ATTACK_CHARGE:
        if (iron) { vic.v *= 0.92; break; }
        vic.v *= 0.45 + 0.4 * res;
        if (ctrl) { vic.state = RS.STUMBLE; vic.stateT = 0.8 * (1 - res * 0.5); }
        vic.invuln = Math.max(vic.invuln, 0.5);
        break;
      case IT.BANANA:
        if (iron) { vic.v *= 0.85; break; }
        if (res >= 0.4) { vic.v *= 0.6; if (ctrl) { vic.state = RS.STUMBLE; vic.stateT = 0.9; } }
        else this.knockdown(vic, 0.7, t);
        break;
      case IT.FROZEN:
        vic.tFrozen = 2.6 * (1 - res * 0.6) * (iron ? 0.5 : 1);
        break;
      case IT.CHAOS:
        if (iron) { vic.v *= 0.8; if (ctrl) { vic.state = RS.STUMBLE; vic.stateT = 0.3; } break; }
        vic.state = RS.KNOCKBACK; vic.kbV = -9 * (1 - res * 0.6); vic.v = vic.kbV;
        vic.vy = 7; vic.grounded = 0; vic.stateT = 0.55; vic.boosting = 0;
        vic.invuln = 1.6; vic.stKnock++;
        break;
    }
  }
  private updateEntities(t: number): void {
    const dt = DT;
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.ttl -= dt; e.age += dt;
      let remove = e.ttl <= 0;
      if (e.type === ENT.CHICKEN) {
        e.s += e.v * dt;
        // follow the track: steer into an open lane
        const lane = Math.round(e.x / 1.6 + 3.5);
        if (!laneAllowed(this.track, lane, e.s + 3)) {
          for (let k = 1; k < LANE_COUNT; k++) {
            if (laneAllowed(this.track, lane - k, e.s + 3)) { e.x = laneX(lane - k); break; }
            if (laneAllowed(this.track, lane + k, e.s + 3)) { e.x = laneX(lane + k); break; }
          }
        }
        if (e.s > this.track.length + 5) remove = true;
      }
      if (!remove) {
        for (const r of this.racers) {
          if (r.finished || r.state === RS.FALLPIT) continue;
          if (r.idx === e.owner && (e.type === ENT.CHICKEN || e.age < 1.0)) continue;
          const ds = Math.abs(r.s - e.s), dx = Math.abs(r.x - e.x);
          if (e.type === ENT.CHICKEN && ds < 0.9 && dx < 0.9 && r.y < 1.3) {
            this.attack(this.racers[e.owner], r, IT.CHICKEN, t); remove = true; break;
          }
          if (e.type === ENT.BANANA && ds < 0.7 && dx < 0.65 && r.y < 0.4) {
            this.attack(this.racers[e.owner], r, IT.BANANA, t); remove = true; break;
          }
        }
      }
      if (remove) this.entities.splice(i, 1);
    }
  }

  private interactions(t: number): void {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      const a = rs[i];
      if (a.finished || a.state === RS.FALLPIT) continue;
      const aDef = ANIMALS[a.animal];
      const charging = a.abilityT > 0 && aDef.ability.id === 'bullcharge';
      for (let j = 0; j < rs.length; j++) {
        if (i === j) continue;
        const b = rs[j];
        if (b.finished || b.state === RS.FALLPIT) continue;
        const ds = b.s - a.s;
        const dx = b.x - a.x;
        if (charging && ds > -1 && ds < 2.6 && Math.abs(dx) < 2.0 && b.invuln <= 0) {
          const dir = dx >= 0 ? 1 : -1;
          if (laneAllowed(this.track, b.lane + dir, b.s)) b.lane += dir;
          else if (laneAllowed(this.track, b.lane - dir, b.s)) b.lane -= dir;
          this.attack(a, b, ATTACK_CHARGE, t);
          b.invuln = Math.max(b.invuln, 0.8);
          continue;
        }
        // bumping: a is behind b
        if (ds > 0 && ds < 0.95 && Math.abs(dx) < 0.62 && Math.abs(a.y - b.y) < 0.8 && isControllable(a) && isControllable(b)) {
          const bDef = ANIMALS[b.animal];
          const ghost = (a.abilityT > 0 && aDef.ability.id === 'shadowstep') || (b.abilityT > 0 && bDef.ability.id === 'shadowstep');
          if (ghost) continue;
          const ma = aDef.mass * (a.tMeat > 0 ? 2 : 1);
          const mb = bDef.mass * (b.tMeat > 0 ? 2 : 1) * (1 + bDef.resist);
          if (ma > mb * 1.25 && b.invuln <= 0) {
            b.v *= 0.85; b.state = RS.STUMBLE; b.stateT = 0.35; b.invuln = 0.6;
            this.ev(t, a.idx, b.idx, EV.BUMP);
          } else a.v = Math.min(a.v, b.v * 0.97);
        }
      }
    }
  }

  updatePlaces(): void {
    const order = this.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.s - a.s;
    });
    order.forEach((r, i) => (r.place = i + 1));
  }

  /** Estimated time for unfinished racers so everybody gets a ranking. */
  results(): RaceResultEntry[] {
    this.updatePlaces();
    const t = this.time;
    return this.racers
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((r) => {
        const remaining = Math.max(0, this.track.length - r.s);
        const est = t + remaining / Math.max(8, DERIVED[r.animal].maxSpeed * 0.85);
        return {
          idx: r.idx, place: r.place, finished: !!r.finished, time: r.finished ? r.finishTime : est,
          items: r.stItems, avoided: r.stAvoided, boosts: r.stBoosts, hits: r.stHits, knockdowns: r.stKnock, gates: r.stGates,
        };
      });
  }
}

const EMPTY: InputState = emptyInput();
