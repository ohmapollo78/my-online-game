// End-to-end multiplayer test with two real Colyseus clients over WebSocket.
// Usage: start the server, then `npm run test:net` (SERVER_URL env to target a remote server).
import { Client, Room } from 'colyseus.js';
import { MSG, encodeInput, decodeSnapshot, ResultsMsg, RaceInitMsg, decodeEvents } from '@shared/protocol';
import { emptyInput } from '@shared/sim';
import { EV } from '@shared/constants';

const URL = process.env.SERVER_URL ?? 'ws://localhost:2567';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond: boolean, msg: string) => { console.log(`${cond ? '  PASS' : '  FAIL'} ${msg}`); if (!cond) failures++; };

interface Bot { name: string; room: Room; init?: RaceInitMsg; results?: ResultsMsg; snaps: number; lastTick: number; item: number; seq: number; inp: ReturnType<typeof emptyInput>; attacks: number; itemUses: number; lastS: number; }

function wire(b: Bot) {
  const room = b.room;
  room.onMessage(MSG.RACE_INIT, (m: RaceInitMsg) => { b.init = m; room.send(MSG.LOADED); });
  b.room.onMessage(MSG.SNAP, (a: number[]) => {
    const s = decodeSnapshot(a);
    b.snaps++; b.lastTick = s.tick;
    if (b.init && b.init.myIdx >= 0) { b.item = s.racers[b.init.myIdx].item; b.lastS = s.racers[b.init.myIdx].s; }
  });
  b.room.onMessage(MSG.EVENTS, (a: number[]) => {
    for (const e of decodeEvents(a).events) { if (e.k === EV.ATTACK_HIT) b.attacks++; if (e.k === EV.ITEM_USE) b.itemUses++; }
  });
  b.room.onMessage(MSG.RESULTS, (m: ResultsMsg) => { b.results = m; });
  b.room.onMessage(MSG.NOTICE, () => {});
  b.room.onMessage(MSG.PONG, () => {});
  b.room.onMessage(MSG.EMOTE, () => {});
}

async function main() {
  console.log(`Multiplayer test against ${URL}`);
  const ca = new Client(URL), cb = new Client(URL);
  const ra = await ca.create('race', { private: true, name: 'Alice', animal: 1 });
  const code = ra.roomId;
  check(/^[A-Z]{3,4}\d{3}$/.test(code), `private room created with code ${code}`);
  const rb = await cb.joinById(code, { name: 'Bob', animal: 3 });
  check(rb.roomId === code, 'client B joined with the room code');
  const A: Bot = { name: 'A', room: ra, snaps: 0, lastTick: 0, item: -1, seq: 0, inp: emptyInput(), attacks: 0, itemUses: 0, lastS: 0 };
  const B: Bot = { name: 'B', room: rb, snaps: 0, lastTick: 0, item: -1, seq: 0, inp: emptyInput(), attacks: 0, itemUses: 0, lastS: 0 };
  wire(A); wire(B);
  await sleep(400);
  const players = () => [...(ra.state as any).players.values()];
  check(players().length === 2, `lobby shows 2 players on client A (${players().map((p: any) => p.name).join(', ')})`);
  check([...(rb.state as any).players.values()].length === 2, 'lobby shows 2 players on client B');
  check((ra.state as any).hostId === ra.sessionId, 'creator is host');

  ra.send(MSG.ANIMAL, 0); rb.send(MSG.ANIMAL, 4); // Pug vs Black Cat
  ra.send(MSG.SETTINGS, { mapId: 'stadium', aiFill: true, aiCount: 2, aiDifficulty: 'normal' });
  rb.send(MSG.SETTINGS, { mapId: 'arena' }); // non-host: must be ignored
  await sleep(300);
  check((ra.state as any).mapId === 'stadium', 'non-host cannot change settings');
  rb.send(MSG.START); await sleep(200);
  check((ra.state as any).phase === 'lobby', 'non-host cannot start the race');
  rb.send(MSG.READY, true); ra.send(MSG.READY, true);
  await sleep(300);
  const pa = players().find((p: any) => p.id === ra.sessionId), pb = players().find((p: any) => p.id === rb.sessionId);
  check(pa.animal === 0 && pb.animal === 4, 'animal selections synchronised (Pug, Black Cat)');
  ra.send(MSG.START);
  await sleep(1500);
  check(!!A.init && !!B.init, 'both clients received RACE_INIT');
  check(A.init!.racers.length === 4 && A.init!.racers.filter((r) => r.isAI).length === 2, '2 humans + 2 AI, AI flagged as AI');
  check(A.init!.myIdx !== B.init!.myIdx && A.init!.myIdx >= 0, 'distinct racer slots');
  check(A.init!.racers[A.init!.myIdx].animal === 0 && B.init!.racers[B.init!.myIdx].animal === 4, 'selected animals used in race');

  // drive both bots: boost, lane-hop, jump, use items whenever held
  let tick = 0;
  let dropped = false, didDrop = false;
  const t0 = Date.now();
  while ((!A.results || !B.results) && Date.now() - t0 < 200000) {
    tick++;
    for (const b of [A, B]) {
      if (b === B && dropped) continue;
      b.inp.boost = tick % 120 < 60;
      if (tick % 25 === 0) b.inp.jumpN++;
      if (tick % 90 === 0) (tick % 180 === 0 ? b.inp.leftN++ : b.inp.rightN++);
      if (b.item >= 0 && tick % 10 === 0) b.inp.itemN++;
      if (tick % 300 === 0) b.inp.abilityN++;
      b.room.send(MSG.INPUT, encodeInput(++b.seq, b.inp));
    }
    // mid-race: drop client B's socket without consent, then reconnect with the token
    if (!didDrop && A.lastTick > 900) {
      dropped = true; didDrop = true;
      const token = rb.reconnectionToken;
      const sBefore = B.lastS;
      (rb.connection as any).transport.ws.close();
      await sleep(2500);
      try {
        const rb2 = await cb.reconnect(token);
        B.room = rb2; B.init = undefined; wire(B);
        rb2.send(MSG.RESYNC);
        await sleep(800);
        check(!!B.init && B.lastS > sBefore, `B reconnected mid-race, kept slot & progress (s ${sBefore.toFixed(0)} -> ${B.lastS.toFixed(0)})`);
        dropped = false;
      } catch (e) { check(false, `reconnect failed: ${e}`); }
    }
    await sleep(33);
  }
  check(A.snaps > 200 && B.snaps > 100, `snapshots streamed (A=${A.snaps}, B=${B.snaps})`);
  check(A.itemUses > 0, `items used during race (${A.itemUses} item uses, ${A.attacks} attack hits seen)`);
  check(!!A.results && !!B.results, 'both clients received results');
  if (A.results && B.results) {
    const sa = JSON.stringify(A.results), sb = JSON.stringify(B.results);
    check(sa === sb, 'final rankings identical on both clients');
    console.log('  Results:', A.results.entries.map((e) => `${e.place}. ${e.name}${e.isAI ? ' [AI]' : ''} ${e.time.toFixed(2)}s coins=${e.coins}`).join(' | '));
  }
  await sleep(300);
  // quick match
  const q1 = await new Client(URL).joinOrCreate('race', { name: 'Q1', animal: 2 });
  const q2 = await new Client(URL).joinOrCreate('race', { name: 'Q2', animal: 1 });
  check(q1.roomId === q2.roomId && q1.roomId !== code, `quick match placed both players in public room ${q1.roomId}`);
  await q1.leave(); await q2.leave();
  await A.room.leave(); await B.room.leave();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL MULTIPLAYER TESTS PASSED');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
