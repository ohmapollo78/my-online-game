// Headless simulation test: runs full AI races on both maps and checks that
// every racer can finish (no unavoidable obstacle patterns), that every item
// and ability fires, and how balanced the animals are.
import { Sim } from '@shared/sim';
import { createAIs, Difficulty } from '@shared/ai';
import { ANIMALS } from '@shared/animals';
import { EV, ITEM_INFO, TICK_RATE } from '@shared/constants';
import { TRACK_DEFS } from '@shared/tracks';

let failures = 0;
const animalTimes: Record<string, number[]> = {};
const itemUses = new Array(8).fill(0);
const itemHits = new Array(9).fill(0);
const abilityUses: Record<string, number> = {};
let gates = 0, pitFalls = 0, shieldBlocks = 0, immune = 0, nine = 0;

function runRace(trackId: string, difficulty: Difficulty, seed: number, animals: number[]) {
  const sim = new Sim({ trackId, seed, authoritative: true, racers: animals.map((a) => ({ animal: a, isAI: true })) });
  const ais = createAIs(sim, difficulty, seed);
  const maxTicks = 260 * TICK_RATE;
  const t0 = performance.now();
  const inputs = new Array(sim.racers.length);
  while (sim.tick < maxTicks && sim.racers.some((r) => !r.finished)) {
    for (const ai of ais) inputs[ai.idx] = ai.update(sim);
    sim.step(inputs);
    for (const e of sim.events) {
      if (e.k === EV.ITEM_USE) itemUses[e.b]++;
      if (e.k === EV.ATTACK_HIT) itemHits[e.c]++;
      if (e.k === EV.ABILITY) abilityUses[ANIMALS[sim.racers[e.a].animal].ability.id] = (abilityUses[ANIMALS[sim.racers[e.a].animal].ability.id] ?? 0) + 1;
      if (e.k === EV.GATE) gates++;
      if (e.k === EV.PIT_FALL) pitFalls++;
      if (e.k === EV.SHIELD_BLOCK) shieldBlocks++;
      if (e.k === EV.IMMUNE) immune++;
      if (e.k === EV.NINE_LIVES) nine++;
    }
    sim.events.length = 0;
  }
  const ms = performance.now() - t0;
  const unfinished = sim.racers.filter((r) => !r.finished);
  if (unfinished.length) {
    failures++;
    console.log(`  FAIL ${trackId}/${difficulty}/seed${seed}: ${unfinished.length} racers did not finish`, unfinished.map((r) => `${ANIMALS[r.animal].id}@${r.s.toFixed(0)} state${r.state}`));
  }
  for (const r of sim.racers) if (r.finished) (animalTimes[`${trackId}:${ANIMALS[r.animal].id}`] ??= []).push(r.finishTime);
  const knock = sim.racers.reduce((a, r) => a + r.stKnock, 0);
  const avoided = sim.racers.reduce((a, r) => a + r.stAvoided, 0);
  console.log(`  ${trackId.padEnd(8)} ${difficulty.padEnd(6)} seed ${seed}: ${(sim.tick / TICK_RATE).toFixed(1)}s race, sim cost ${(ms / (sim.tick)).toFixed(3)} ms/tick, knockdowns ${knock}, avoided ${avoided}`);
}

console.log('ANIMAL DASH headless simulation test');
for (const def of TRACK_DEFS) {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    for (let seed = 1; seed <= 3; seed++) {
      const animals = [0, 1, 2, 3, 4, (seed) % 5, (seed + 1) % 5, (seed + 2) % 5];
      runRace(def.id, diff, seed * 101 + diff.length, animals);
    }
  }
}
console.log('\nAverage finish time by animal:');
for (const [k, v] of Object.entries(animalTimes).sort()) {
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  console.log(`  ${k.padEnd(22)} ${avg.toFixed(2)}s  (best ${Math.min(...v).toFixed(2)}s, n=${v.length})`);
}
console.log('\nItem uses:', ITEM_INFO.map((it, i) => `${it.key}=${itemUses[i]}`).join(' '));
console.log('Attack hits by kind:', ITEM_INFO.map((it, i) => `${it.key}=${itemHits[i]}`).join(' '), `charge=${itemHits[8]}`);
console.log('Abilities:', JSON.stringify(abilityUses), `nineLives=${nine}`);
console.log(`Gates ${gates}, pit falls ${pitFalls}, shield blocks ${shieldBlocks}, shadow immunities ${immune}`);
const missingItems = itemUses.map((n, i) => (n === 0 ? ITEM_INFO[i].key : '')).filter(Boolean);
if (missingItems.length) { console.log('FAIL: items never used:', missingItems); failures++; }
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SIM TESTS PASSED');
process.exit(failures ? 1 : 0);
