# Art asset pipeline (Blender → GLB → WebGL2 game)

Every 3D asset is produced by a **Python script run in headless Blender**, so assets are reproducible
and reviewable as code. Generated `.blend` sources are kept for manual touch-ups.

```
assets/
  blender/
    scripts/common/        shared helpers (materials, rigging, export settings)
    scripts/characters/    one script per animal  -> pug.py, husky.py, ...
    scripts/environments/  stadium.py, arena.py
    scripts/props/         obstacles and power-ups
    scripts/env_check.py   Stage 0 pipeline probe
    sources/               saved .blend files written by the scripts
  reference/               art-direction reference images
  renders/                 turntable / preview renders for review
client/public/models/
  characters/  environments/  props/   exported .glb files served by Vite at /models/...
```

Run a script (Blender 5.3 is at `C:\Program Files\Blender Foundation\Blender 5.3\blender.exe`):

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --factory-startup --python assets/blender/scripts/characters/pug.py
```

Export conventions (agreed in Stage 0):
* glTF 2.0 binary (`.glb`), **no Draco** (the in-house loader reads plain accessors), embedded PNG textures.
* Units: metres. Character feet at origin, facing **+Z** in glTF (Blender −Y forward is converted by the exporter).
* Characters: one armature; bone names match the game's skeleton
  (`body, head, ear_L, ear_R, eyes, tongue, tail0-2, leg_FL_up/low, leg_FR_up/low, leg_BL_up/low, leg_BR_up/low`)
  so the existing procedural animation states keep working; baked clips `Idle` and `Run` are exported too.
* ≤ 4 joint influences per vertex; ≤ 25k triangles and ≤ 1 MB per character GLB
  (Stage 1 Pug: 22.7k triangles, 785 KB; the initial 15k target was raised because the eyes/face detail needs it).
* Build every part with the `animal_kit.py` helpers: they guarantee outward normals (inward normals render
  pale grey in the game even though Blender's viewport hides them).
* Check an export with `npx --prefix server tsx tools/glbDebug.ts <file.glb>`: rest skin must be identity
  (all joints `0.00`) and ellipsoid parts must report 100% outward normals.
