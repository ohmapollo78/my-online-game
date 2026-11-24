// AI opponents. Bots only produce InputState, exactly like a human, so they obey
// the same physics, stamina and cooldown rules as players.

import { ANIMALS, DERIVED } from './animals';
import { GRAVITY, IT, LANE_COUNT, laneX } from './constants';
import { Rng } from './rng';
import { InputState, Racer, Sim, emptyInput, isControllable, ENT } from './sim';
import {
  Obstacle, laneAllowed, laneOpenAhead, obstacleHit, obstacleJumpable, obstacleSlidable, wrapS, ZK, OK,
} from './track';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Personality = 'aggressive' | 'defensive' | 'speed' | 'balanced';
export const PERSONALITIES: Personality[] = ['aggressive', 'defensive', 'speed', 'balanced'];

const DIFF = {
  easy: { reaction: 0.42, mistake: 0.2, look: 1.1, boostSkill: 0.55, itemDelay: 2.5 },
  normal: { reaction: 0.25, mistake: 0.08, look: 1.5, boostSkill: 0.85, itemDelay: 1.4 },
  hard: { reaction: 0.14, mistake: 0.025, look: 1.8, boostSkill: 1, itemDelay: 0.7 },
};
const BOOST_THRESH: Record<Personality, number> = { speed: 0.25, aggressive: 0.4, balanced: 0.5, defensive: 0.68 };

export const AI_NAMES = ['Biscuit', 'Waffles', 'Pepper', 'Noodle', 'Mochi', 'Ziggy', 'Pickles', 'Turbo', 'Coco', 'Rocket', 'Peanut', 'Sushi', 'Bubbles', 'Nacho', 'Maple', 'Tofu'];

export class AIController {
  readonly idx: number;
  readonly difficulty: Difficulty;
  readonly personality: Personality;
  input: InputState = emptyInput();
  private rng: Rng;
  private laneTarget = -1;
  private nextThink = 0;
  private nextLaneStep = 0;
  private boostOn = false;
  private itemUseAt = -1;
  private itemHeldSince = -1;
  private nextAbilityCheck = 0;
  private decided = new Map<number, boolean>(); // obstacle id -> will make a mistake
  private decidedLap = 0;

  constructor(idx: number, difficulty: Difficulty, personality: Personality, seed: number) {
    this.idx = idx; this.difficulty = difficulty; this.personality = personality;
    this.rng = new Rng(seed);
  }

  update(sim: Sim): InputState {
    const r = sim.racers[this.idx];
    const inp = this.input;
    inp.slide = false;
    const t = sim.time;
    if (r.finished || t < 0) { inp.boost = false; return inp; }
    const cfg = DIFF[this.difficulty];
    const track = sim.track;
    const lap = Math.floor(r.s / track.lapLength);
    if (lap !== this.decidedLap) { this.decided.clear(); this.decidedLap = lap; }
    if (!isControllable(r)) { inp.boost = false; return inp; }
    const ls = wrapS(track, r.s);
    const d = DERIVED[r.animal];
    const def = ANIMALS[r.animal];
    const v = Math.max(r.v, 10);
    const apex = (d.jumpV * d.jumpV) / (2 * GRAVITY);

    // ---------------- lane choice
    if (t >= this.nextThink || this.laneTarget < 0) {
      this.nextThink = t + cfg.reaction * (0.6 + this.rng.next() * 0.8);
      const best = this.chooseLane(sim, r, ls, v, apex, cfg.look);
      if (this.laneTarget < 0 || best.cost < best.currentCost - 0.8) this.laneTarget = best.lane;
      if (!laneAllowed(track, this.laneTarget, r.s)) this.laneTarget = r.lane;
    }
    if (this.laneTarget !== r.lane && t >= this.nextLaneStep) {
      if (this.laneTarget < r.lane) inp.leftN++; else inp.rightN++;
      this.nextLaneStep = t + 0.1 + cfg.reaction * 0.25;
    }

    // ---------------- jump / slide for threats in our current path
    const h = def.height;
    let jumpNow = false, slideNow = false;
    for (const o of track.obstacles) {
      if (o.sMin > ls + v * 0.9 + 2) break;
      if (o.sMax < ls - 1) continue;
      let hitT = -1;
      for (let tau = 0; tau <= 0.9; tau += 0.03) {
        if (obstacleHit(o, t + tau, ls + v * tau, r.x, 0, h)) { hitT = tau; break; }
      }
      if (hitT < 0) continue;
      let mistake = this.decided.get(o.id);
      if (mistake === undefined) { mistake = this.rng.next() < cfg.mistake; this.decided.set(o.id, mistake); }
      if (mistake) continue;
      if (obstacleSlidable(o)) { if (hitT < 0.32) slideNow = true; }
      else if (obstacleJumpable(o, apex) || (o.kind === OK.BALL && apex > 2.3)) {
        const y1 = o.kind === OK.BALL ? 2.2 : o.y1;
        const disc = d.jumpV * d.jumpV - 2 * GRAVITY * (y1 + 0.1);
        const tUp = disc > 0 ? (d.jumpV - Math.sqrt(disc)) / GRAVITY : 0.3;
        if (hitT <= tUp + 0.05) jumpNow = true;
      } else if (hitT < 0.25 && o.kind === OK.CRATE && apex > 1.5) jumpNow = true;
    }
    // pits: jump at the edge of solid ground if the gap is clearable, or off the end of a platform
    for (const pit of track.pits) {
      if (ls > pit.s1 || ls < pit.s0 - 30) continue;
      const inLanes = r.x >= laneX(pit.lane0) - 0.8 && r.x <= laneX(pit.lane1) + 0.8;
      if (!inLanes) continue;
      const air = (2 * d.jumpV) / GRAVITY;
      const reach = v * air;
      if (ls < pit.s0) {
        const gap = pit.s1 - pit.s0;
        const platformOk = pit.platforms.some((p) => p.sOff === 0 && r.x >= laneX(p.lane0) - 0.8 && r.x <= laneX(p.lane1) + 0.8);
        if (!platformOk && reach > gap + 1.5 && pit.s0 - ls < v * 0.06 + 0.4) jumpNow = true;
      } else {
        for (const p of pit.platforms) {
          const end = pit.s0 + p.sOff + p.len;
          if (ls < end && end - ls < v * 0.07 + 0.5) jumpNow = true;
        }
      }
    }
    if (jumpNow && r.grounded) inp.jumpN++;
    if (slideNow) inp.slide = true;

    // ---------------- boost
    const thr = BOOST_THRESH[this.personality] * d.staminaMax;
    if (this.boostOn) { if (r.stamina < thr || r.exhausted) this.boostOn = false; }
    else if (r.stamina > thr + 18 && !r.exhausted && this.rng.next() < cfg.boostSkill * 0.08) this.boostOn = true;
    inp.boost = this.boostOn;

    // ---------------- items
    if (r.item >= 0) {
      if (this.itemHeldSince < 0) {
        this.itemHeldSince = t;
        const k = this.personality === 'aggressive' ? 0.5 : this.personality === 'defensive' ? 1.4 : 1;
        this.itemUseAt = t + (0.3 + this.rng.next() * cfg.itemDelay) * k;
      }
      if (t >= this.itemUseAt && this.shouldUseItem(sim, r, t - this.itemHeldSince)) { inp.itemN++; this.itemUseAt = t + 0.5; }
    } else this.itemHeldSince = -1;

    // ---------------- ability
    if (!def.ability.passive && r.abilityCd <= 0 && r.stamina > def.ability.cost + 10 && t >= this.nextAbilityCheck) {
      this.nextAbilityCheck = t + 0.5 + this.rng.next() * 0.8;
      if (this.shouldUseAbility(sim, r, ls, v)) inp.abilityN++;
    }
    return inp;
  }

  private chooseLane(sim: Sim, r: Racer, ls: number, v: number, apex: number, look: number) {
    const track = sim.track;
    const t = sim.time;
    const def = ANIMALS[r.animal];
    const d = DERIVED[r.animal];
    const reachable: number[] = [r.lane];
    for (const dir of [-1, 1]) {
      for (let l = r.lane + dir; l >= 0 && l < LANE_COUNT; l += dir) {
        if (!laneAllowed(track, l, r.s)) break;
        reachable.push(l);
      }
    }
    let bestLane = r.lane, bestCost = Infinity, currentCost = Infinity;
    const lookDist = v * look + 4;
    for (const l of reachable) {
      let cost = Math.abs(l - r.lane) * (0.35 + 6 / def.agility * 0.1);
      if (!laneOpenAhead(track, l, r.s, 18)) cost += 100;
      const tx = laneX(l);
      // obstacles along the projected path (lateral transition modelled with agility)
      for (const o of track.obstacles) {
        if (o.sMin > ls + lookDist) break;
        if (o.sMax < ls) continue;
        let x = r.x;
        for (let tau = 0.05; tau <= look; tau += 0.08) {
          const step = def.agility * 0.08;
          x = x < tx ? Math.min(tx, x + step) : Math.max(tx, x - step);
          if (obstacleHit(o, t + tau, ls + v * tau, x, 0, def.height)) {
            if (obstacleSlidable(o) || obstacleJumpable(o, apex)) cost += 1.6;
            else cost += 40 * (1 - (tau / look) * 0.5);
            break;
          }
        }
      }
      // pits
      for (const pit of track.pits) {
        if (pit.s0 < ls || pit.s0 > ls + 70) continue;
        if (l < pit.lane0 || l > pit.lane1) continue;
        const reach = ((2 * d.jumpV) / GRAVITY) * v;
        const plat = pit.platforms.some((p) => l >= p.lane0 && l <= p.lane1);
        if (reach > pit.s1 - pit.s0 + 2) cost += 1;
        else if (plat) cost += this.difficulty === 'easy' ? 8 : 3;
        else cost += 60;
      }
      // zones (gates & surfaces)
      const lowSt = r.stamina < d.staminaMax * 0.5;
      for (const z of track.zones) {
        if (z.s0 < ls + 4 || z.s0 > ls + 70) continue;
        if (l < z.lane0 || l > z.lane1) continue;
        switch (z.kind) {
          case ZK.GATE_GREEN: cost -= this.personality === 'speed' ? 4 : 3; break;
          case ZK.GATE_RED: cost -= this.personality === 'speed' || this.personality === 'aggressive' ? 5 : 1.5; break;
          case ZK.GATE_BLUE: cost -= lowSt || this.personality === 'defensive' ? 5 : 0.5; break;
          case ZK.GATE_YELLOW: cost -= 2; break;
          case ZK.MUD: cost += 8; break;
          case ZK.ICE: cost += 1; break;
          case ZK.RAMP: cost -= 0.5; break;
          case ZK.BOOSTPAD: cost -= 3; break;
        }
      }
      // pickups
      if (r.item < 0) {
        track.boxes.forEach((b, i) => {
          if (b.lane === l && b.s > ls + 3 && b.s < ls + 55 && sim.boxRespawn[i] <= sim.tick) cost -= 3;
        });
      }
      if (r.stamina < d.staminaMax * 0.7) {
        track.pickups.forEach((p, i) => {
          if (p.lane === l && p.s > ls + 3 && p.s < ls + 55 && sim.pickupRespawn[i] <= sim.tick) cost -= 2.5;
        });
      }
      // bananas in lane
      for (const e of sim.entities) {
        if (e.type === ENT.BANANA && e.s > r.s && e.s < r.s + 40 && Math.abs(e.x - tx) < 0.8) cost += 12;
      }
      // traffic
      for (const o of sim.racers) {
        if (o === r || o.finished) continue;
        if (o.s > r.s && o.s < r.s + 6 && Math.abs(o.x - tx) < 0.8) cost += this.personality === 'aggressive' ? 0.5 : 1.5;
      }
      cost += this.rng.next() * 0.5;
      if (l === r.lane || l === this.laneTarget) currentCost = Math.min(currentCost, cost);
      if (cost < bestCost) { bestCost = cost; bestLane = l; }
    }
    return { lane: bestLane, cost: bestCost, currentCost };
  }

  private shouldUseItem(sim: Sim, r: Racer, held: number): boolean {
    const opp = sim.racers.filter((o) => o !== r && !o.finished);
    const ahead = (min: number, max: number, dx = 99) => opp.some((o) => o.s - r.s > min && o.s - r.s < max && Math.abs(o.x - r.x) < dx);
    const behind = (min: number, max: number) => opp.some((o) => r.s - o.s > min && r.s - o.s < max);
    switch (r.item) {
      case IT.CHICKEN: return ahead(3, 40, 2.6) || held > 8;
      case IT.BANANA: return behind(2, 22) || held > 10;
      case IT.FROZEN: return ahead(-22, 22) || held > 9;
      case IT.CHAOS: return opp.some((o) => Math.abs(o.s - r.s) < 10 && Math.abs(o.x - r.x) < 5) || held > 10;
      case IT.SHIELD: return this.personality !== 'defensive' || behind(0, 30) || held > 6;
      default: return true; // rocket, meat, magnet
    }
  }

  private shouldUseAbility(sim: Sim, r: Racer, ls: number, v: number): boolean {
    const id = ANIMALS[r.animal].ability.id;
    const track = sim.track;
    const clear = (dist: number) => !track.obstacles.some((o) => o.sMin > ls && o.sMin < ls + dist && r.x >= o.xMin - 0.5 && r.x <= o.xMax + 0.5);
    switch (id) {
      case 'icedash': return clear(v * 1.6) && r.grounded === 1;
      case 'ironbark': return !clear(v * 0.8) || sim.entities.some((e) => e.type === ENT.BANANA && e.s > r.s && e.s < r.s + 20 && Math.abs(e.x - r.x) < 1);
      case 'bullcharge': return sim.racers.some((o) => o !== r && o.s - r.s > 0 && o.s - r.s < 8 && Math.abs(o.x - r.x) < 2) || clear(v * 1.5);
      case 'shadowstep': return sim.entities.some((e) => Math.abs(e.s - r.s) < 15) || (clear(v * 1.2) && this.rng.next() < 0.3);
    }
    return false;
  }
}

/** Build AI controllers for racers flagged isAI. */
export function createAIs(sim: Sim, difficulty: Difficulty, seed: number): AIController[] {
  const out: AIController[] = [];
  sim.racers.forEach((r, i) => {
    if (r.isAI) out.push(new AIController(i, difficulty, PERSONALITIES[(i + seed) % PERSONALITIES.length], seed * 31 + i * 7919));
  });
  return out;
}
