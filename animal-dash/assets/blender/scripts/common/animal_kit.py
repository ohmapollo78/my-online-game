"""Shared Blender toolkit for ANIMAL DASH characters (Blender 5.3, run headless).

Conventions
-----------
* All authoring coordinates are GAME coordinates: x = side, y = up, z = forward (metres).
  `G(x, y, z)` converts to Blender space (x, -z, y); the glTF exporter (+Y up) converts back,
  so the exported GLB is in game coordinates with the animal facing +Z.
* The armature has the 17 bones the game's animation system expects (see BONES).
* Colours live in a per-vertex colour attribute "Col"; three materials: Fur (matte),
  Gloss (eyes/nose) and Glow (eye highlights, emissive).
"""
import math
import os
import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

BONES = [
    "body", "head", "ear_L", "ear_R", "eyes", "tongue", "tail0", "tail1", "tail2",
    "leg_FL_up", "leg_FL_low", "leg_FR_up", "leg_FR_low", "leg_BL_up", "leg_BL_low", "leg_BR_up", "leg_BR_low",
]
PARENT = {
    "head": "body", "ear_L": "head", "ear_R": "head", "eyes": "head", "tongue": "head",
    "tail0": "body", "tail1": "tail0", "tail2": "tail1",
    "leg_FL_up": "body", "leg_FL_low": "leg_FL_up", "leg_FR_up": "body", "leg_FR_low": "leg_FR_up",
    "leg_BL_up": "body", "leg_BL_low": "leg_BL_up", "leg_BR_up": "body", "leg_BR_low": "leg_BR_up",
}


def G(x, y, z):
    return Vector((x, -z, y))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 24


# ------------------------------------------------------------------ geometry helpers
def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _select_only(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def ellipsoid(name, center, radii, rot=(0, 0, 0), segs=24, rings=16):
    """Ellipsoid in game coords. rot = game-space euler (rx, ry, rz) applied as Ry*Rx*Rz."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    rx, ry, rz = rot
    rmat = (Matrix.Rotation(ry, 3, "Y") @ Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(rz, 3, "Z"))
    for v in bm.verts:
        # proper rotation (x, y, z) -> (x, z, -y): a plain axis swap would mirror the mesh and flip normals
        gx, gy, gz = v.co.x * radii[0], v.co.z * radii[1], -v.co.y * radii[2]
        p = rmat @ Vector((gx, gy, gz))
        v.co = G(center[0] + p.x, center[1] + p.y, center[2] + p.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _link(bpy.data.objects.new(name, me))


def capsule(name, a, b, r0, r1=None, segs=32):
    """Tapered capsule between game points a and b."""
    r1 = r0 if r1 is None else r1
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    A, B = Vector(a), Vector(b)
    axis = B - A
    length = axis.length
    n = 10
    for i in range(n + 1):
        t = i / n
        r = r0 + (r1 - r0) * t
        c = A + axis * t
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=16, radius=r)
        # move the newest sphere
        for v in bm.verts:
            if not v.tag:
                v.co = G(c.x + v.co.x, c.y + v.co.z, c.z - v.co.y)
                v.tag = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    del length
    return _link(bpy.data.objects.new(name, me))


def torus(name, center, major, minor, rot=(0, 0, 0), arc=2 * math.pi, segs=48, tube=16):
    """Torus lying in the game XZ plane before rotation."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rx, ry, rz = rot
    rmat = (Matrix.Rotation(ry, 3, "Y") @ Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(rz, 3, "Z"))
    ring = []
    for i in range(segs + 1):
        u = arc * i / segs
        row = []
        for j in range(tube):
            v = 2 * math.pi * j / tube
            p = Vector(((major + minor * math.cos(v)) * math.cos(u), minor * math.sin(v), (major + minor * math.cos(v)) * math.sin(u)))
            p = rmat @ p
            row.append(bm.verts.new(G(center[0] + p.x, center[1] + p.y, center[2] + p.z)))
        ring.append(row)
    for i in range(segs):
        for j in range(tube):
            a, b2 = ring[i][j], ring[i][(j + 1) % tube]
            c, d = ring[i + 1][(j + 1) % tube], ring[i + 1][j]
            bm.faces.new((a, b2, c, d))
    if arc < 2 * math.pi - 1e-3:  # cap the ends
        for row in (ring[0], ring[-1]):
            bm.faces.new(row if row is ring[0] else list(reversed(row)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    return _link(bpy.data.objects.new(name, me))


def fuse(name, parts, voxel=0.012, smooth_iters=12, smooth_factor=0.6, target_tris=None):
    """Join primitive parts and voxel-remesh them into one seamless organic mesh."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = parts[0]
    obj.name = name
    m = obj.modifiers.new("Remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    s = obj.modifiers.new("Smooth", "SMOOTH")
    s.factor = smooth_factor
    s.iterations = smooth_iters
    _select_only(obj)
    bpy.ops.object.modifier_apply(modifier="Remesh")
    bpy.ops.object.modifier_apply(modifier="Smooth")
    if target_tris:
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris > target_tris:
            d = obj.modifiers.new("Decimate", "DECIMATE")
            d.ratio = target_tris / tris
            bpy.ops.object.modifier_apply(modifier="Decimate")
    return obj


def shade_smooth(obj):
    _select_only(obj)
    bpy.ops.object.shade_smooth()


# ------------------------------------------------------------------ colours & materials
def paint(obj, fn):
    """fn(game_pos Vector, game_normal Vector) -> (r, g, b) or (r, g, b, a). Writes the 'Col' corner attribute."""
    me = obj.data
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = attr
    loops = me.loops
    verts = me.vertices
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = verts[loops[li].vertex_index]
            p = Vector((v.co.x, v.co.z, -v.co.y))
            nrm = Vector((v.normal.x, v.normal.z, -v.normal.y))
            c = fn(p, nrm)
            attr.data[li].color = (c[0], c[1], c[2], c[3] if len(c) > 3 else 1.0)


def solid(obj, rgb):
    paint(obj, lambda p, n: rgb)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def hexc(h):
    """sRGB hex -> linear colour (Blender colour attributes are linear)."""
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


def make_material(name, roughness, emissive=0.0, specular=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    if emissive > 0:
        bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        bsdf.inputs["Emission Strength"].default_value = emissive
    return mat


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ------------------------------------------------------------------ rig
def build_armature(pivots, tails):
    """pivots/tails: bone name -> game-space point. Returns armature object."""
    arm_data = bpy.data.armatures.new("Rig")
    arm = _link(bpy.data.objects.new("Rig", arm_data))
    _select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    for name in BONES:
        b = eb.new(name)
        b.head = G(*pivots[name])
        b.tail = G(*tails[name])
        b.use_deform = True
    for name, parent in PARENT.items():
        eb[name].parent = eb[parent]
        eb[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


def weight_rigid(obj, bone):
    vg = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
    vg.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")


def weight_by_segments(obj, segments, power=6.0, max_inf=3, gate=None):
    """segments: bone -> (a, b) game points. Smooth inverse-distance skin weights.
    gate(bone, p) optionally scales a bone's influence by region (e.g. legs only below the hips)."""
    groups = {b: (obj.vertex_groups.get(b) or obj.vertex_groups.new(name=b)) for b in segments}
    segs = {b: (Vector(a), Vector(c)) for b, (a, c) in segments.items()}
    for v in obj.data.vertices:
        p = Vector((v.co.x, v.co.z, -v.co.y))
        ws = []
        for b, (a, c) in segs.items():
            d = _seg_dist(p, a, c)
            g = gate(b, p) if gate else 1.0
            if g > 0:
                ws.append((g / (d ** power + 1e-7), b))
        ws.sort(reverse=True)
        ws = ws[:max_inf]
        tot = sum(w for w, _ in ws)
        for w, b in ws:
            if w / tot > 0.02:
                groups[b].add([v.index], w / tot, "REPLACE")


def bind(arm, obj):
    obj.parent = arm
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = arm


# ------------------------------------------------------------------ animation baking
def _game_rot(rx, ry, rz):
    """Game euler (Ry*Rx*Rz) as a Blender-space 3x3 matrix."""
    # game X -> blender X, game Y -> blender Z, game Z -> blender -Y
    return (Matrix.Rotation(ry, 3, "Z") @ Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(-rz, 3, "Y"))


def bake_action(arm, name, frames, pose_fn, rest_rot=None):
    """pose_fn(frame_index, t01) -> {bone: (rx, ry, rz, tx, ty, tz, s)} in game axes, relative to rest."""
    rest_rot = rest_rot or {}
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    _select_only(arm)
    for f in range(frames + 1):
        pose = pose_fn(f, f / frames)
        for bname in BONES:
            pb = arm.pose.bones[bname]
            lr = pb.bone.matrix_local.to_3x3()
            lr_inv = lr.inverted()
            rx, ry, rz, tx, ty, tz, s = pose.get(bname, (0, 0, 0, 0, 0, 0, 1))
            br = rest_rot.get(bname, (0, 0, 0))
            rot = _game_rot(rx + br[0], ry + br[1], rz + br[2]) @ _game_rot(*br).inverted()
            q = (lr_inv @ rot @ lr).to_quaternion()
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.location = lr_inv @ G(tx, ty, tz)
            pb.scale = (s, s, s)
            pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            pb.keyframe_insert("location", frame=f + 1)
            pb.keyframe_insert("scale", frame=f + 1)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.name = name
    arm.animation_data.action = None
    return action


# ------------------------------------------------------------------ render & export
def review_renders(out_dir, prefix, target=(0, 0.45, 0), dist=2.4):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.72, 0.95, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scene.world = world
    sun = _link(bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN")))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    fill = _link(bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA")))
    fill.data.energy = 200
    fill.data.size = 3
    fill.location = G(-2, 2, 2)
    cam = _link(bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")))
    cam.data.lens = 60
    scene.camera = cam
    T = G(*target)
    paths = []
    for label, ang in (("front", 0.45), ("side", 1.57), ("back", 2.8)):
        cam.location = T + G(math.sin(ang) * dist, 0.35 * dist / 2.4, math.cos(ang) * dist) - G(0, 0, 0)
        d = (T - cam.location)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"{prefix}_{label}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    return paths


def export_glb(path):
    for o in bpy.context.view_layer.objects:
        o.select_set(o.type in ("MESH", "ARMATURE"))
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True,
        export_vertex_color="ACTIVE", export_all_vertex_colors=False,
        export_draco_mesh_compression_enable=False, export_yup=True,
        export_apply=False, export_force_sampling=True,
    )
