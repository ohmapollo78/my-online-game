# ANIMAL DASH — Art Upgrade Development Progress

Roadmap: Stage 0 inspection → 1 Pug → 2 other four animals → 3 Stadium → 4 Arena → 5 obstacles & power-ups →
6 animations & VFX → 7 lighting/materials/polish → 8 optimisation & final QA.
Each stage ends with a tested, integrated result and **waits for approval** before the next stage starts.

| Stage | Status | Approved |
| --- | --- | --- |
| 0 — Inspection & backup | ✅ Complete (2026-11-24) | ✅ Approved |
| 1 — Pug character (Blender → GLB) | ✅ Complete (2026-11-24) | ⏳ awaiting approval |
| 2 — Husky, Rottweiler, Orange Cat, Black Cat | Not started | |
| 3 — Stadium Sprint environment | Not started | |
| 4 — Crazy Obstacle Arena environment | Not started | |
| 5 — Obstacle & power-up assets | Not started | |
| 6 — Animations & VFX | Not started | |
| 7 — Lighting, materials & polish | Not started | |
| 8 — Optimisation & final QA | Not started | |

---

## Stage 1 — Pug character (complete, awaiting approval)

Backup before the stage: `backups/animal-dash-pre-stage1-20261124-1915.zip`.

### What was built
| Item | File |
| --- | --- |
| Shared Blender toolkit (primitives, voxel-remesh fusing, vertex-colour painting, materials, 17-bone armature, skin weights, animation baking, review renders, GLB export) | `assets/blender/scripts/common/animal_kit.py` |
| Pug generator script | `assets/blender/scripts/characters/pug.py` |
| Blender source | `assets/blender/sources/pug.blend` |
| Review renders (front / side / back, Eevee) | `assets/renders/pug_*.png` |
| Exported model | `client/public/models/characters/pug.glb` — 22 692 triangles, 785 KB, 17 joints, clips `Idle` (4 s loop) and `Run` (1 gallop cycle) |
| Engine: GLB parser + clip sampler | `client/src/engine/gltf.ts` |
| Engine: skinned meshes (vertex joints/weights), skinned colour + shadow shaders | `engine/mesh.ts`, `engine/shaders.ts`, `engine/renderer.ts` |
| Character registry (GLB → 2 GPU meshes: matte fur + glossy eyes/nose; anchors for hats/glasses) | `client/src/characters/glbCharacters.ts` |
| Actor: Idle/Run from Blender clips (Run phase-locked to distance → no foot sliding); jump, slide, stumble, knockdown, knockback, pit fall, exhaustion, victory from the existing procedural animator on the same skeleton; per-joint cross-fades; blink and tongue procedural | `client/src/characters/actor.ts` |
| Debug / verification tools | `tools/glbDebug.ts`, `tools/stage1Check.mjs`, `tools/stage1Cosmetics.mjs` |

Pug design: big round head with fused jowls and a flat black muzzle mask, painted forehead wrinkles, large glossy
brown eyes with two highlights, black glossy nose with nostrils, small smile, floppy dark velvet ears, chubby
single-piece body and legs with toe bumps and paw pads, curled tail, red collar with gold tag, fake ambient
occlusion and belly/back colour gradients in the vertex colours.

Fallbacks: if the GLB fails to load, the procedural Pug is used; `?glb=0` forces the procedural models.

### Tests (actual results)
| Test | Result |
| --- | --- |
| GLB loads and converts in the game | PASS — `pug: GLB ok (22692 tris, 2 clips)` |
| Skin correctness (rest pose `jointWorld × inverseBind` = identity for all 17 joints) | PASS (`tools/glbDebug.ts`) |
| Outward normals on all ellipsoid parts | PASS (100 %) |
| Character select, menu lineup, portrait icon rendered from the GLB | PASS (screenshots) |
| Full single-player race as the Pug (autopilot) — idle at countdown, running, jump, slide, finish, victory hop, results podium | PASS (`docs/stage1/01–09*.png`) |
| Cosmetics on the GLB Pug: crown, cap, sunglasses, round glasses, scarf, vest, gold skin | PASS after fix (`docs/stage1/10-cosmetics-*.png`) |
| Console errors/warnings during the run | PASS — 0 |
| Client typecheck + production build | PASS |
| Gameplay / server / shared simulation | Not modified in this stage |

### Bugs found and fixed during the stage
1. **Clip evaluator overwrote its scratch matrix during recursion** → Pug rendered lying on its side / as a blob.
   Fixed (parent resolved before computing the local matrix); verified rest skin = identity.
2. **Inward normals on all small parts** (axis swap in the ellipsoid helper mirrored the mesh) → eyes, nose and
   ears rendered pale grey in-game while looking fine in Blender. Fixed in the toolkit + automated normal check.
3. **Glasses hidden inside the larger head** → anchors now derived from the GLB's eye vertices.

### Performance
* Same production build, back-to-back A/B (`tools/perfProbe.mjs` with `AB_GLB=1`): GLB Pug 37.0 / 37.9 FPS vs
  procedural Pug 42.3 / 34.6 FPS — **no measurable difference beyond run-to-run noise**.
* Absolute FPS on this laptop during this session was much lower than the pre-stage baseline (57–59 FPS),
  including with the old procedural models, because of heavy background load (Teams, Edge, screen recorder).
  **The 60 FPS target therefore has not been re-verified after Stage 1**; it should be re-measured on an idle
  machine (planned for Stage 8, or earlier on request).
* Draw cost per GLB character: 2 draw calls (was 15–17 for the procedural rigid parts).

### Known issues / limitations
* The GLB Pug is 22.7k triangles (budget raised to 25k; see `assets/README.md`).
* Sunglasses sit slightly in front of the face (cosmetic, minor).
* Cosmetic skins on GLB characters are applied as a colour tint, not a full recolour.
* The other four animals are still procedural until Stage 2.

---

## Stage 0 — Project inspection and backup (complete)

### Existing game architecture
* **Client:** TypeScript + Vite, **raw WebGL2** renderer (`client/src/engine`): forward lighting, 2048² PCF shadow map,
  hemisphere ambient, rim light, fog, ACES tonemapping, instancing, frustum culling, particles.
* **Characters today:** procedural meshes built in code (`characters/animalModels.ts`), a fixed 17-bone rigid hierarchy
  (each bone owns a mesh), animated procedurally by `animations/animator.ts` (idle, run, jump, land, slide, stumble,
  knockdown, recover, knockback, pit fall, exhaustion, 4 victory styles). Cosmetics attach to head/body bones.
* **Environments today:** generated in code from the track path (`tracks/trackScene.ts`); obstacles and items in
  `obstacles/obstacleRenderer.ts` and `items/itemRenderer.ts`.
* **Gameplay:** deterministic shared simulation (`shared/src`), authoritative Colyseus server. **Visuals are fully
  decoupled from gameplay** — collisions use track-space data, never mesh geometry — so art can be replaced without
  touching mechanics.

### Tools available
| Tool | Result |
| --- | --- |
| Blender | **5.3.0** installed at `C:\Program Files\Blender Foundation\Blender 5.3\blender.exe` (not on PATH; scripts call it by full path) |
| Python | System `python` is only the Microsoft Store stub (not installed). **Blender's bundled Python 3.13.13** is used for all asset scripts — sufficient. |
| glTF exporter | Built into Blender (`export_scene.gltf`); Draco and meshoptimizer libraries also present |
| Headless pipeline test | ✅ `assets/blender/scripts/env_check.py` built a mesh + armature + skin + keyframed "Idle" action and exported a GLB in 0.3 s. Parsed result: 3 nodes, 1 mesh, 1 skin, 1 animation. |

### GLB compatibility of the game engine
**The engine cannot load GLB files yet.** Findings:
* No glTF parser, no texture-image loading from GLB, no skinned-mesh shader (vertex layout is position/normal/colour/uv only).
* Animation is procedural per rigid bone; there is no keyframe-clip player.

Required engine work (planned as the first part of Stage 1, gameplay untouched):
1. `engine/gltf.ts` — GLB parser: buffers/accessors, meshes & primitives, PBR base-colour/texture/emissive materials,
   node hierarchy, skins (inverse bind matrices), animations (translation/rotation/scale, LINEAR/STEP, quaternion slerp).
2. Skinned shader variant (`JOINTS_0`/`WEIGHTS_0`, up to ~64 joint matrices as uniforms — well within WebGL2 limits)
   plus a skinned depth shader so characters keep casting shadows.
3. Character integration that **keeps every existing animation state**: the GLB armature uses the same 17 bone names,
   so the procedural animator keeps driving jump/slide/knockdown/victory etc., blended with the baked `Idle`/`Run`
   clips from Blender. Cosmetic attachment points map to the `head`/`body` bones.
4. Fallback: if a GLB fails to load, the current procedural model is used, so the game never breaks.

Export conventions are documented in `assets/README.md` (no Draco, metres, +Z forward, ≤4 weights, ≤15k tris and
≤1 MB per character).

### Backup
`ANIMAL DASH/backups/animal-dash-stage0-20261124-1912.zip` — full source, docs, screenshots and tests (92 files,
11.8 MB; `node_modules` and build output excluded — restore with `npm install` + `npm run build`). Verified by
listing key files inside the archive. (No git on this machine, so zip backups are taken before each stage.)

### Asset folder structure (created)
```
assets/blender/scripts/{common,characters,environments,props}   generation scripts
assets/blender/sources                                           saved .blend files
assets/reference   assets/renders                                art reference, review renders
client/public/models/{characters,environments,props}             exported GLB files served at /models/...
```

### Gameplay changes in Stage 0
None. The only code-adjacent additions are the probe script, folder skeleton, `assets/README.md` and this file.

### Stage 1 plan (pending approval)
1. Engine: GLB loader + skinned rendering + clip player (with procedural fallback) — unit-checked with the probe GLB.
2. `assets/blender/scripts/characters/pug.py`: premium cartoon Pug built in Blender — subdivided organic body, big
   head and expressive glossy eyes with highlights and eyelids, black muzzle/ear mask, forehead wrinkles, curled tail,
   red collar with tag; materials with subtle colour gradients; 17-bone armature with automatic weights;
   `Idle` and `Run` actions; review renders saved to `assets/renders/`.
3. Export `client/public/models/characters/pug.glb`, replace the procedural Pug in character select, lobby, race
   and results; test rendering, scale, animation states, cosmetics and movement in a real race; measure FPS.
4. Report with screenshots and wait for approval.

### Known issues / notes
* Reference art (the image you shared in chat) is not saved as a file in the project; if you can save it to
  `assets/reference/`, it can be used for side-by-side comparison renders.
* Characters produced by script in Blender will be stylised and clean, but sculpted fur-level detail like the
  reference illustration is beyond what procedural Blender modelling achieves; the target is a high-quality cartoon
  game-model look.
