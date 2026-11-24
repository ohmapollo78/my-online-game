# Multiplayer test report

Test date: 2026-11-24 · Server: Colyseus 0.16 (Node 24, Windows 11) · Clients: Chrome (puppeteer-core), in-app Chromium, Node `colyseus.js`

## Summary

| Area | Result |
| --- | --- |
| Private room create / join by code | ✅ Pass (codes like `DOG985`, `PAW522`, case-insensitive join) |
| Lobby sync (players, animals, ready, host, settings) | ✅ Pass — updates immediately on all clients |
| Host-only settings & start | ✅ Pass — non-host attempts are ignored by the server |
| Quick Match | ✅ Pass — two clients placed in the same public room |
| AI fill, AI clearly labelled | ✅ Pass — `🤖 AI` everywhere (lobby, HUD, name tags, results) |
| Synchronized countdown & shared race instance | ✅ Pass |
| Real-time movement of each other | ✅ Pass — view offset matches theory (see below) |
| Jump/slide/boost sync, power-ups against each other | ✅ Pass — attack hits and item effects arrive via server events |
| Identical final rankings | ✅ Pass — results JSON byte-identical on both clients (3 separate runs) |
| Disconnect → automatic reconnection mid-race | ✅ Pass — slot and progress preserved (Node and browser clients) |
| Reconnection fails → player replaced by labelled AI | ✅ Pass — e.g. `Bob (AI)` finished the race |
| Rate limiting / abuse kick | ✅ Pass (verified accidentally during testing, see "Issues found") |
| Two computers on different internet connections | ⏳ **Not yet run** — requires your public deployment (steps in DEPLOYMENT.md) |

## Test 1 — Automated Node clients (`npm --prefix server run test:net`)

Two real `colyseus.js` WebSocket clients against the running server. All 19 checks pass:

```
PASS private room created with code PUG894
PASS client B joined with the room code
PASS lobby shows 2 players on client A (Alice, Bob)
PASS lobby shows 2 players on client B
PASS creator is host
PASS non-host cannot change settings
PASS non-host cannot start the race
PASS animal selections synchronised (Pug, Black Cat)
PASS both clients received RACE_INIT
PASS 2 humans + 2 AI, AI flagged as AI
PASS distinct racer slots
PASS selected animals used in race
PASS B reconnected mid-race, kept slot & progress (s 314 -> 412)
PASS snapshots streamed (A=1511, B=1466)
PASS items used during race (21 item uses, 3 attack hits seen)
PASS both clients received results
PASS final rankings identical on both clients
PASS quick match placed both players in public room RUN587
ALL MULTIPLAYER TESTS PASSED
```

## Test 2 — Two real browser clients (production build, `tools/visualTest.mjs`)

Client A and client B run in **two separate Chrome processes** (separate storage, like two computers) against the
production server (game + WebSocket on one origin). Flow: A creates a private room → B types the code in lowercase →
B picks Black Cat and READY → A picks Pug, sets AI count 2 → A starts → both race with keyboard bots that boost,
jump, use items and abilities → results.

| Check | Run 1 (`PAW522`) | Run 2 (`PUG115`, full suite) |
| --- | --- | --- |
| Room code generated | PASS | PASS |
| Host lobby shows Bob (Black Cat, READY) immediately | PASS | PASS |
| Both clients entered the same race | PASS | PASS |
| Clients control different racers | PASS | PASS |
| Host's view of guest vs guest's own position | PASS — 3.19 m (theory 3.18 m) | PASS — 3.04 m (theory 3.09 m) |
| Both clients received final results | PASS | PASS |
| Final rankings identical | PASS | PASS |

"Theory" = guest speed × (100 ms interpolation delay + latency); the measured gap matching it shows remote racers are
interpolated smoothly and the local racer is predicted ahead, as designed.

Network statistics (stadium, 2 laps, ~85 s):

| Metric | Host (run 1 / run 2) | Guest (run 1 / run 2) |
| --- | --- | --- |
| Snapshots received (20 Hz) | 1 659 / 1 509 | 1 659 / 1 509 |
| Late / out-of-order snapshots | 0 / 0 | 0 / 0 |
| Inputs sent (30 Hz + button edges) | 2 952 / 2 832 | 2 895 / 2 760 |
| Avg prediction correction per snapshot | 0.09 m / 0.18 m | 0.12 m / 0.20 m |
| Max correction | 1.83 m / 1.07 m | 2.28 m / 1.91 m |
| Corrections > 6 m (snaps) | 0 / 0 | 0 / 0 |
| RTT (same machine) | 2–3 ms | 2 ms |

Full machine-readable output: [test-results.json](test-results.json). Screenshots: `13-multiplayer-lobby.png`,
`14-multiplayer-race-host.png`, `14b-multiplayer-race-guest.png`, `15-multiplayer-results.png`.

Server clock health (new diagnostics in the room log): race clock equals wall clock at every 10-second checkpoint
(`sim tick 4806 (80.1s) wall 80.1s`), with catch-up ticks absorbing Windows timer jitter.

## Test 3 — Browser reconnection (in-app browser, two tabs)

Client B's WebSocket was force-closed 20 s into a race. Observed client status: `online → reconnecting (20.06 s) →
online (21.0 s)`. B kept its racer and finished as a human; the two "big corrections" (max 20.8 m) were the expected
snap after the 1-second outage, after which steady-state correction returned to ~0.2 m.

## Snapshot & bandwidth design

* Server → client: 20 Hz snapshots of quantized integers (msgpack). Per remote racer 9 numbers; full state only for the
  receiving player; plus entities and taken pickups. ≈ 0.5–1 KB per snapshot for 8 racers.
* Client → server: input only — 7 integers (`seq, held-buttons bits, jump/left/right/item/ability counters`) at 30 Hz,
  plus an immediate send on any button edge.
* The client never sends positions, speeds, items or results.

## Issues found and fixed during testing

| Issue | Cause | Fix |
| --- | --- | --- |
| Lobby showed "join failed" right after joining | Lobby rendered before the first state patch arrived | Render a "Joining room…" placeholder until state syncs; join errors handled separately |
| Reconnected client missed `RACE_INIT` | Server pushed it before handlers were re-registered | Client sends `resync` after reconnecting; server replies with race setup |
| Rate-limit kick of a legitimate test client | Test harness ran two frame loops (≈120 inputs/s) | Inputs halved to 30 Hz + edges; limiter widened (120/s, burst 240, kick only on sustained flood) |
| Unhelpful "[object ProgressEvent]" error | Network error object surfaced as text | Friendly "Cannot reach the game server (url)" message |
| Average prediction error ~0.5 m | Client couldn't tell how many ticks had consumed its last acknowledged input | Server sends `ticksSinceAck`; replay window is exact (error now 0.09–0.24 m) |
| Race clock fell behind under heavy CPU load | Server clamped late updates to 250 ms (dropped time) | Catch-up of missed ticks (≤1 s backlog, ≤30 ticks/update) + clock diagnostics |

## Remaining work

* **Different-network test** (acceptance criterion): deploy publicly (DEPLOYMENT.md) and run the 5-step check from two
  networks; optionally `SERVER_URL=wss://<host> npm --prefix server run test:net`.
* Horizontal scaling beyond one server process needs Colyseus Redis presence/driver.
