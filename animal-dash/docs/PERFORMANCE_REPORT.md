# Performance report

Test machine: Windows 11 Enterprise laptop, **Intel UHD Graphics (integrated, 0xA721) via ANGLE/Direct3D 11**,
Chrome (headless, GPU-accelerated), 1920×1080, device scale 1. This is a deliberately modest GPU — discrete GPUs
will have significant headroom. All numbers are from full autopiloted 8-racer races on the production build.

## Frame rate (1080p, default settings: MSAA on, shadows on, 100% resolution)

Measured by the in-game frame-time recorder over an entire race, with the test harness polling only every 3 s.

| Map | Frames | Avg FPS | Median frame | p95 frame | p99 frame | Max frame | 1% low FPS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stadium Sprint (2 laps, 8 racers) | 4 401 | **58.9** | 16.7 ms | 17.1 ms | 33.3 ms | 34.2 ms | 30.0 |
| Crazy Obstacle Arena (8 racers) | 3 754 | **59.4** | 16.7 ms | 17.1 ms | 32.4 ms | 49.5 ms | 30.9 |

Frames are vsync-locked at 60 Hz; occasional single missed vsyncs (p99 ≈ 33 ms) occur on this iGPU, mostly when the
full crowd is in view. Minimum FPS over a whole race: 29.2 (Stadium), 20.2 (Arena, one frame).
A previous run measured 56.8 / 59.3 FPS — run-to-run variance on a shared laptop is ±2 FPS.

### Settings sweep (Stadium, 15-second rAF samples mid-race)

| Configuration | FPS | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| Default (MSAA, shadows, 100%) | 57.5 | 16.7 ms | 17.2 ms | 33.5 ms |
| No MSAA | 58.8 | 16.7 ms | 17.0 ms | 33.3 ms |
| No shadows | 56.6 | 16.7 ms | 33.0 ms | 33.6 ms |
| Render scale 80% | **59.7** | 16.7 ms | 17.1 ms | **17.5 ms** |
| No MSAA + 80% | 59.3 | 16.7 ms | 16.9 ms | 33.1 ms |

Conclusion: the game meets the 60 FPS target on an integrated GPU at 1080p; **Settings → Graphics → Resolution:
Balanced (80%)** gives a fully stable 60 FPS on such hardware. Higher refresh rates are used automatically when
the display and GPU allow (rendering is delta-time based; the simulation is a fixed 60 Hz step).

## Rendering statistics

| Map | Draw calls / frame | Triangles / frame | Crowd sections culled / frame |
| --- | --- | --- | --- |
| Stadium Sprint | ~210 | 0.58 M (was 1.40 M before optimisation) | ~41 of 50 |
| Crazy Obstacle Arena | ~40–125 | 0.10–0.12 M | — |

Optimisations in place: instanced crowd (≈5 k spectators, ~60 tris each) split into 105 m sections with frustum
culling; instanced trees; chunked static track geometry with per-chunk bounding spheres; sphere frustum culling for
every mesh; obstacles/items only drawn within 260 m of the camera; shadow map follows the camera (2048², texel
snapped) and huge static geometry (stands) only receives shadows; pooled particle system (struct-of-arrays, single
upload per blend mode); pooled draw-item objects and scratch matrices (no per-frame allocations in the renderer hot
path); 3-octave procedural sky.

## Memory

| Measure | Value |
| --- | --- |
| JS heap during a race (Chrome `performance.memory`) | 9–17 MB |
| Client download (production) | 319 KB JS (110 KB gzipped) + 19 KB CSS; no textures/audio files — everything is procedural |
| Server process RSS (idle / during a race) | ~76 MB |

## Simulation & server

| Measure | Value |
| --- | --- |
| Simulation cost | ~0.04 ms per tick for 8 racers incl. AI (headless test, `npm run test:sim`) |
| Server tick | fixed 60 Hz; snapshots 20 Hz; inputs 30 Hz + button edges |
| Server clock accuracy | race clock = wall clock at every 10 s checkpoint during browser tests (catch-up absorbs Windows timer jitter) |
| Snapshot size | ≈0.5–1 KB (8 racers, quantized integers, msgpack) |

## Network synchronisation quality (two Chrome clients, local server)

| Metric | Host | Guest |
| --- | --- | --- |
| Avg prediction correction / snapshot | 0.09–0.18 m | 0.12–0.20 m |
| Max correction | 1.07–1.83 m | 1.91–2.28 m |
| Hard snaps (>6 m) | 0 | 0 |
| Late snapshots | 0 | 0 |

(Ranges over the two final runs.) Corrections are smoothed (exponential decay, 10/s) so they are not visible as
teleports. Remote racers are interpolated 100 ms in the past; measured offset matched theory (3.04 m measured vs
3.09 m predicted at race speed).

## Known performance limitations

* On integrated GPUs the Stadium at 100% resolution occasionally misses vsync (p95 33 ms). Use 80% resolution for a
  locked 60 FPS. (The in-game FPS counter can be toggled in Settings.)
* Two full game clients + server on one laptop (only relevant for local multiplayer testing) is heavy; the automated
  multiplayer test lowers render scale for that reason.
* Real-world network latency over the internet has not been measured yet — that requires the public deployment test
  (see MULTIPLAYER_TEST_REPORT.md).
