"""ANIMAL DASH — Pug "The Little Tank" (Stage 1).

Run headless:
  blender --background --factory-startup --python assets/blender/scripts/characters/pug.py

Outputs
  client/public/models/characters/pug.glb   (mesh + 17-bone skin + Idle/Run clips)
  assets/blender/sources/pug.blend
  assets/renders/pug_{front,side,back}.png
All positions below are GAME coordinates (x side, y up, z forward), unscaled model units
(the game scales the Pug by 1.45).
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "common"))
import animal_kit as K  # noqa: E402
from mathutils import Vector  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
OUT_GLB = os.path.join(ROOT, "client", "public", "models", "characters", "pug.glb")
OUT_BLEND = os.path.join(ROOT, "assets", "blender", "sources", "pug.blend")
RENDERS = os.path.join(ROOT, "assets", "renders")

# ---------------------------------------------------------------- palette (sRGB hex -> linear)
FAWN = K.hexc(0xE3BC86)
FAWN_DARK = K.hexc(0xC49663)
FAWN_LIGHT = K.hexc(0xF2DDB6)
MASK = K.hexc(0x2B211C)
MASK_SOFT = K.hexc(0x4A3A30)
NOSE = K.hexc(0x151110)
IRIS = K.hexc(0x5A3418)
PUPIL = K.hexc(0x0B0807)
WHITE = K.hexc(0xFAFAF8)
COLLAR = K.hexc(0xD8262F)
GOLD = K.hexc(0xF2C230)
TONGUE = K.hexc(0xFF6F8A)
PAD = K.hexc(0x5A4038)

# ---------------------------------------------------------------- skeleton (game coords)
BODY_Y = 0.3945
HEAD = (0.0, 0.5945, 0.34)
HIP_Y, KNEE_Y = 0.282, 0.152
LX, ZF, ZB = 0.15, 0.20, -0.20
PIV = {
    "body": (0, BODY_Y, 0), "head": HEAD,
    "ear_L": (-0.205, HEAD[1] + 0.15, HEAD[2] - 0.01), "ear_R": (0.205, HEAD[1] + 0.15, HEAD[2] - 0.01),
    "eyes": (0, HEAD[1] + 0.05, HEAD[2] + 0.245), "tongue": (0, HEAD[1] - 0.13, HEAD[2] + 0.27),
    "tail0": (0, BODY_Y + 0.1375, -0.331), "tail1": (0, BODY_Y + 0.21, -0.36), "tail2": (0, BODY_Y + 0.25, -0.33),
    "leg_FL_up": (-LX, HIP_Y, ZF), "leg_FL_low": (-LX, KNEE_Y, ZF), "leg_FR_up": (LX, HIP_Y, ZF), "leg_FR_low": (LX, KNEE_Y, ZF),
    "leg_BL_up": (-LX, HIP_Y, ZB), "leg_BL_low": (-LX, KNEE_Y, ZB), "leg_BR_up": (LX, HIP_Y, ZB), "leg_BR_low": (LX, KNEE_Y, ZB),
}


def tail_of(name):
    p = Vector(PIV[name])
    children = [c for c, par in K.PARENT.items() if par == name and not c.startswith("ear") and c not in ("eyes", "tongue")]
    if name == "body":
        return tuple(p + Vector((0, 0.12, 0)))
    if name.endswith("_up"):
        return PIV[name.replace("_up", "_low")]
    if name.endswith("_low"):
        return tuple(p + Vector((0, -0.11, 0.02)))
    if children:
        return PIV[children[0]]
    return tuple(p + Vector((0, 0.06, 0)))


def build():
    K.reset_scene()
    fur = K.make_material("Fur", roughness=0.72, specular=0.25)
    gloss = K.make_material("Gloss", roughness=0.12, specular=0.9)
    glow = K.make_material("Glow", roughness=0.3, emissive=3.0)
    meshes = []

    # ------------------------------------------------ body + legs (one seamless fused mesh)
    parts = [
        K.ellipsoid("torso", (0, 0.40, -0.02), (0.27, 0.245, 0.35)),
        K.ellipsoid("chest", (0, 0.39, 0.19), (0.255, 0.235, 0.2)),
        K.ellipsoid("rump", (0, 0.405, -0.22), (0.25, 0.235, 0.19)),
        K.ellipsoid("neck", (0, 0.50, 0.27), (0.175, 0.15, 0.15), rot=(-0.6, 0, 0)),
        K.ellipsoid("belly_roll", (0, 0.31, 0.02), (0.235, 0.12, 0.3)),
    ]
    for sx in (-1, 1):
        for z, front in ((ZF, True), (ZB, False)):
            x = sx * LX
            if not front:
                parts.append(K.ellipsoid("thigh", (x * 0.95, 0.31, z - 0.01), (0.1, 0.13, 0.135)))
            else:
                parts.append(K.ellipsoid("shoulder", (x * 0.95, 0.32, z + 0.01), (0.09, 0.11, 0.11)))
            parts.append(K.capsule("upper", (x, HIP_Y + 0.03, z), (x, KNEE_Y, z + (0.0 if front else -0.01)), 0.072, 0.063))
            parts.append(K.capsule("lower", (x, KNEE_Y, z), (x, 0.045, z + 0.015), 0.062, 0.057))
            parts.append(K.ellipsoid("paw", (x, 0.036, z + 0.04), (0.074, 0.048, 0.088)))
            for t in (-1, 0, 1):
                parts.append(K.ellipsoid("toe", (x + t * 0.035, 0.03, z + 0.11), (0.028, 0.03, 0.03)))
    body = K.fuse("PugBody", parts, voxel=0.0085, smooth_iters=10, smooth_factor=0.55, target_tris=6000)

    def body_col(p, n):
        c = FAWN
        # lighter belly/chest, darker saddle along the back, soft occlusion near the ground
        c = K.mix(c, FAWN_LIGHT, K.smoothstep(0.34, 0.22, p.y) * K.smoothstep(-0.1, 0.25, -abs(p.x) + 0.12) * 0.8)
        c = K.mix(c, FAWN_DARK, K.smoothstep(0.55, 0.64, p.y) * 0.6)
        c = K.mix(c, FAWN_LIGHT, K.smoothstep(0.1, 0.03, p.y) * 0.5)  # paws
        if p.y < 0.04 and n.y < -0.4:
            c = PAD
        ao = 0.82 + 0.18 * K.smoothstep(0.0, 0.3, p.y)
        return tuple(ch * ao for ch in c)

    K.paint(body, body_col)
    K.set_material(body, fur)
    seg = {"body": ((0, 0.40, -0.32), (0, 0.42, 0.32))}
    for sx, side in ((-1, "L"), (1, "R")):
        for z, fb in ((ZF, "F"), (ZB, "B")):
            x = sx * LX
            seg[f"leg_{fb}{side}_up"] = ((x, HIP_Y + 0.02, z), (x, KNEE_Y, z))
            seg[f"leg_{fb}{side}_low"] = ((x, KNEE_Y, z), (x, 0.0, z + 0.06))

    def gate(bone, p):
        if bone == "body":
            return 1.0
        return K.smoothstep(0.36, 0.25, p.y)  # legs only bend the lower body

    K.weight_by_segments(body, seg, gate=gate)
    meshes.append(body)

    # ------------------------------------------------ head (fused): big round skull, jowls, flat muzzle
    hx, hy, hz = HEAD
    hc = (hx, hy + 0.02, hz + 0.02)
    hparts = [
        K.ellipsoid("skull", hc, (0.295, 0.272, 0.285)),
        K.ellipsoid("jowl", (hx - 0.12, hy - 0.1, hz + 0.16), (0.13, 0.11, 0.12)),
        K.ellipsoid("jowl", (hx + 0.12, hy - 0.1, hz + 0.16), (0.13, 0.11, 0.12)),
        K.ellipsoid("muzzle", (hx, hy - 0.07, hz + 0.225), (0.135, 0.095, 0.095)),
        K.ellipsoid("brow", (hx - 0.12, hy + 0.11, hz + 0.2), (0.095, 0.06, 0.07)),
        K.ellipsoid("brow", (hx + 0.12, hy + 0.11, hz + 0.2), (0.095, 0.06, 0.07)),
    ]
    head = K.fuse("PugHead", hparts, voxel=0.0075, smooth_iters=8, smooth_factor=0.5, target_tris=5000)

    def head_col(p, n):
        rel = p - Vector(HEAD)
        c = FAWN
        # black face mask: muzzle + around the eyes, with a soft edge
        face = K.smoothstep(0.13, 0.22, rel.z) * K.smoothstep(0.12, 0.02, rel.y)
        eye_patch = max(0.0, 1.0 - ((abs(rel.x) - 0.13) ** 2 / 0.0045 + (rel.y - 0.05) ** 2 / 0.006)) * K.smoothstep(0.12, 0.2, rel.z)
        m = max(face, min(1.0, eye_patch * 1.6))
        c = K.mix(c, MASK, m)
        # forehead wrinkles (darker folds)
        if rel.z > 0.08 and 0.07 < rel.y < 0.24 and abs(rel.x) < 0.17:
            band = max(0.0, math.sin((rel.y - 0.07) * 56.0)) ** 6
            c = K.mix(c, FAWN_DARK, band * 0.85 * K.smoothstep(0.17, 0.05, abs(rel.x)))
        # lighter cheeks, shaded underside
        c = K.mix(c, FAWN_LIGHT, K.smoothstep(-0.05, -0.15, rel.y) * (1 - m) * 0.5)
        ao = 0.85 + 0.15 * K.smoothstep(-0.25, 0.1, rel.y)
        return tuple(ch * ao for ch in c)

    K.paint(head, head_col)
    K.set_material(head, fur)
    K.weight_rigid(head, "head")
    meshes.append(head)

    # ------------------------------------------------ eyes (glossy, big and expressive)
    center = Vector(hc)
    light_dir = Vector((-0.35, 0.45, 0.0))  # shared key-light direction for highlights
    for sx in (-1, 1):
        e = Vector((hx + sx * 0.128, hy + 0.05, hz + 0.222))
        fwd = (e - center).normalized()
        fwd = (fwd + Vector((0, 0, 1.2))).normalized()
        sclera = K.ellipsoid("sclera", tuple(e), (0.082, 0.085, 0.066), segs=32, rings=20)
        K.solid(sclera, WHITE)
        iris_c = e + fwd * 0.045
        iris = K.ellipsoid("iris", tuple(iris_c), (0.06, 0.064, 0.035), rot=(math.asin(-fwd.y), math.atan2(fwd.x, fwd.z), 0))
        K.paint(iris, lambda p, n, ic=iris_c: K.mix(IRIS, K.hexc(0x8A5A2E), K.smoothstep(0.045, 0.015, (p - ic).length)))
        pupil = K.ellipsoid("pupil", tuple(iris_c + fwd * 0.012), (0.036, 0.04, 0.026), rot=(math.asin(-fwd.y), math.atan2(fwd.x, fwd.z), 0))
        K.solid(pupil, PUPIL)
        for o in (sclera, iris, pupil):
            K.set_material(o, gloss)
            K.weight_rigid(o, "eyes")
            meshes.append(o)
        # highlights sit on the eye surface, both placed toward the same light direction
        for k, r in ((1.0, 0.018), (-0.7, 0.009)):
            d = (fwd + light_dir * k).normalized()
            hl = K.ellipsoid("highlight", tuple(e + d * 0.071), (r, r, r * 0.5), segs=12, rings=8)
            K.solid(hl, WHITE)
            K.set_material(hl, glow)
            K.weight_rigid(hl, "eyes")
            meshes.append(hl)

    # ------------------------------------------------ nose, mouth, tongue
    nose = K.ellipsoid("nose", (hx, hy - 0.02, hz + 0.318), (0.058, 0.036, 0.034))
    K.solid(nose, NOSE)
    K.set_material(nose, gloss)
    K.weight_rigid(nose, "head")
    meshes.append(nose)
    for sx in (-1, 1):
        nos = K.ellipsoid("nostril", (hx + sx * 0.022, hy - 0.025, hz + 0.347), (0.011, 0.008, 0.006), segs=12, rings=8)
        K.solid(nos, PUPIL)
        K.set_material(nos, fur)
        K.weight_rigid(nos, "head")
        meshes.append(nos)
    mouth = K.torus("mouth", (hx, hy - 0.1, hz + 0.29), 0.055, 0.009, rot=(-1.3, 0, math.pi), arc=math.pi, segs=24, tube=8)
    K.solid(mouth, PUPIL)
    K.set_material(mouth, fur)
    K.weight_rigid(mouth, "head")
    meshes.append(mouth)
    tongue = K.ellipsoid("tongue", (hx, hy - 0.145, hz + 0.29), (0.04, 0.014, 0.065), rot=(0.35, 0, 0))
    K.solid(tongue, TONGUE)
    K.set_material(tongue, gloss)
    K.weight_rigid(tongue, "tongue")
    meshes.append(tongue)

    # ------------------------------------------------ floppy velvet ears
    for sx, bone in ((-1, "ear_L"), (1, "ear_R")):
        px, py, pz = PIV[bone]
        ear = K.ellipsoid("ear", (px + sx * 0.045, py - 0.055, pz + 0.05), (0.105, 0.1, 0.03), rot=(0.25, sx * 0.55, sx * 0.55))
        K.paint(ear, lambda p, n: K.mix(MASK, MASK_SOFT, 0.25))
        K.set_material(ear, fur)
        K.weight_rigid(ear, bone)
        meshes.append(ear)

    # ------------------------------------------------ collar with gold tag
    collar = K.torus("collar", (0, 0.49, 0.30), 0.2, 0.036, rot=(0.95, 0, 0), segs=40, tube=10)
    K.solid(collar, COLLAR)
    K.set_material(collar, fur)
    K.weight_rigid(collar, "body")
    meshes.append(collar)
    tag = K.ellipsoid("tag", (0, 0.36, 0.44), (0.038, 0.038, 0.012), rot=(0.6, 0, 0))
    K.solid(tag, GOLD)
    K.set_material(tag, gloss)
    K.weight_rigid(tag, "body")
    meshes.append(tag)

    # ------------------------------------------------ curly tail
    tx, ty, tz = PIV["tail0"]
    tail = K.torus("tail", (tx, ty + 0.055, tz - 0.01), 0.058, 0.031, rot=(0, 0, math.pi / 2), arc=math.pi * 1.6, segs=28, tube=10)
    K.paint(tail, lambda p, n: K.mix(FAWN, FAWN_DARK, 0.3))
    K.set_material(tail, fur)
    K.weight_rigid(tail, "tail0")
    meshes.append(tail)

    for m in meshes:
        K.shade_smooth(m)

    # ------------------------------------------------ rig + skin
    arm = K.build_armature(PIV, {b: tail_of(b) for b in K.BONES})
    for m in meshes:
        K.bind(arm, m)
    return arm, meshes


# ---------------------------------------------------------------- animation (same motion model as the game)
def run_pose(f, t01):
    ph = t01 * 2 * math.pi
    A = 0.95
    s = math.sin
    lift = lambda v: max(0.0, v)  # noqa: E731
    rock = s(ph) * 0.12
    flop = s(ph + 1.2) * 0.35
    pose = {
        "leg_FL_up": (-s(ph) * A, 0, 0, 0, 0, 0, 1), "leg_FR_up": (-s(ph + 0.4) * A, 0, 0, 0, 0, 0, 1),
        "leg_BL_up": (-s(ph + math.pi) * A * 0.9, 0, 0, 0, 0, 0, 1), "leg_BR_up": (-s(ph + math.pi + 0.4) * A * 0.9, 0, 0, 0, 0, 0, 1),
        "leg_FL_low": (lift(math.cos(ph)) * 1.2, 0, 0, 0, 0, 0, 1), "leg_FR_low": (lift(math.cos(ph + 0.4)) * 1.2, 0, 0, 0, 0, 0, 1),
        "leg_BL_low": (-lift(math.cos(ph + math.pi)) * 1.1, 0, 0, 0, 0, 0, 1), "leg_BR_low": (-lift(math.cos(ph + math.pi + 0.4)) * 1.1, 0, 0, 0, 0, 0, 1),
        "body": (rock, 0, 0, 0, abs(s(ph)) * 0.06 * 1.45, 0, 1),
        "head": (-rock * 0.9, 0, 0, 0, 0, 0, 1),
        "ear_L": (flop - 0.2, 0, -0.2 - abs(flop) * 0.5, 0, 0, 0, 1),
        "ear_R": (flop - 0.2, 0, 0.2 + abs(flop) * 0.5, 0, 0, 0, 1),
        "tail0": (0, s(ph * 2) * 0.35, 0, 0, 0, 0, 1),
    }
    return pose


def idle_pose(f, t01):
    T = 4.0
    t = t01 * T
    s = math.sin
    br = s(2 * math.pi * t / 2.0) * 0.025
    return {
        "body": (0, 0, 0, 0, br * 0.3, 0, 1 + br * 0.6),
        "head": (s(2 * math.pi * t / 4.0) * 0.08, s(2 * math.pi * t / 4.0) * 0.35, s(2 * math.pi * t / 2.0) * 0.06, 0, 0, 0, 1),
        "ear_L": (0, 0, -0.15 - max(0.0, s(2 * math.pi * t / 1.0)) * 0.05, 0, 0, 0, 1),
        "ear_R": (0, 0, 0.15 + max(0.0, s(2 * math.pi * t / 1.0 + 1)) * 0.05, 0, 0, 0, 1),
        "tail0": (0, s(2 * math.pi * t / 0.5) * 0.5, 0, 0, 0, 0, 1),
    }


def main():
    arm, meshes = build()
    K.bake_action(arm, "Run", 24, run_pose)
    K.bake_action(arm, "Idle", 96, idle_pose)
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    os.makedirs(RENDERS, exist_ok=True)
    K.export_glb(OUT_GLB)
    tris = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
    print("PUG_TRIS", tris)
    print("PUG_GLB", OUT_GLB, os.path.getsize(OUT_GLB))
    import bpy
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    if "--no-render" not in sys.argv:
        for p in K.review_renders(RENDERS, "pug", target=(0, 0.42, 0.05), dist=2.1):
            print("RENDER", p)


main()
