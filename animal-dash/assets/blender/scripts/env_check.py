# Stage 0 environment probe: run with
#   blender --background --factory-startup --python env_check.py -- <out.glb>
# Prints Blender/Python versions, checks the glTF exporter, and exports a tiny skinned,
# animated test model to prove the GLB pipeline (armature + skin + action) works headless.
import sys
import bpy

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "env_check.glb"
print("BLENDER", bpy.app.version_string)
print("PYTHON", sys.version.split()[0])
print("GLTF_EXPORTER", hasattr(bpy.ops.export_scene, "gltf"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(0, 0, 1))
body = bpy.context.active_object
mat = bpy.data.materials.new("Fawn")
mat.diffuse_color = (0.86, 0.72, 0.52, 1)
body.data.materials.append(mat)

bpy.ops.object.armature_add(location=(0, 0, 0.5))
arm = bpy.context.active_object
body.parent = arm
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = arm
vg = body.vertex_groups.new(name=arm.data.bones[0].name)
vg.add([v.index for v in body.data.vertices], 1.0, "REPLACE")

arm.animation_data_create()
action = bpy.data.actions.new("Idle")
arm.animation_data.action = action
pb = arm.pose.bones[0]
for f, s in ((1, 1.0), (12, 1.1), (24, 1.0)):
    pb.scale = (s, s, s)
    pb.keyframe_insert("scale", frame=f)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True, export_skins=True)
print("EXPORTED", out)
