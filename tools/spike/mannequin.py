# Pipeline-proof spike: the Veteran mannequin as a rigged Blender scene, rendered headless.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio --factory-startup \
#     --python tools/spike/mannequin.py -- --out .art-cache/spike/renders [--px 512] \
#     [--leg-scale 1.0] [--facings south,north,east] [--save-blend path.blend]
#
# Builds the locked Veteran recipe (CHARACTER_FOUNDATION.md "Exploration phase" lock: 37px standing,
# ~2.8 heads, sloped 15px shoulders, 10px stance, 10 deg lean, CoG 0.48) as an armature with named
# bones (pelvis/spine/chest/head, limbs, handR/handL grips, feetCenter) and bone-parented primitive
# meshes. Poses are authored in armature space; a crude greatsword parents to handR. Renders each
# (facing, frame) orthographic at a high-ish top-down pitch and exports every marker bone's projected
# pixel position to rig.json — the numbers the assemble step turns into computed pivots, anchorX and
# sockets. Nothing here touches public/assets.
import bpy
import json
import math
import os
import sys
from math import radians, sin, cos, pi
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

# ---------------------------------------------------------------- args
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, dflt):
    if name not in argv:
        return dflt
    i = argv.index(name)
    if i + 1 >= len(argv):
        sys.exit(f"[spike] {name} needs a value — usage: ... --python tools/spike/mannequin.py -- "
                 "[--out DIR] [--px N] [--leg-scale F] [--facings south,north,east] "
                 "[--save-blend PATH.blend] [--only frame,frame]")
    return argv[i + 1]


OUT = arg("--out", ".art-cache/spike/renders")
PX = int(arg("--px", "512"))
LEG_SCALE = float(arg("--leg-scale", "1.0"))
FACINGS = arg("--facings", "south,north,east").split(",")
SAVE_BLEND = arg("--save-blend", "")
ONLY = arg("--only", "")          # comma list of frame names, for quick pose iteration

# ---------------------------------------------------------------- constants
CANVAS = 64                       # art px per cell
PITCH = radians(20)               # camera pitch below horizontal: the game's mild top-down read
F = 1.0 / cos(PITCH)              # vertical pre-stretch so RENDERED heights match the recipe px
FEET_ROW = 60                     # ground line lands on cell row 60 (ART_DIRECTION SS4.1)

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
scene.render.resolution_x = PX
scene.render.resolution_y = PX
scene.render.film_transparent = True
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
if hasattr(scene, "eevee"):
    if hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 16

# ---------------------------------------------------------------- materials


def srgb_to_linear(c):
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def make_mat(name, srgb, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    lin = srgb_to_linear(srgb)
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular", "Specular IOR Level"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.15
    return m


MAT_CLOTH = make_mat("cloth", (0.30, 0.36, 0.46))    # slate family
MAT_IRON = make_mat("iron", (0.16, 0.16, 0.20))      # iron family
MAT_BONE = make_mat("boneM", (0.78, 0.72, 0.60))     # bone family (head)
MAT_STEEL = make_mat("steel", (0.86, 0.89, 0.93), rough=0.45)  # blade -> brick/cope

# ---------------------------------------------------------------- armature: the Veteran recipe
# Coordinates are ART PIXELS; z is pre-stretched by F so the pitched camera renders recipe heights.
# Character faces -Y (toward the camera in the south facing). Right hand side is +X.


def V(x, y, z):
    return Vector((x, y, z * F))


arm_data = bpy.data.armatures.new("veteran")
arm = bpy.data.objects.new("veteran", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")

LS = LEG_SCALE
HIP_Z = 13.5 * LS                 # the proportion the finale changes: leg length


def bone(name, head, tail, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b


bone("root", V(0, 2, 0), V(0, 5, 0))
bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
bone("pelvis", V(0, 0, HIP_Z), V(0, 0, HIP_Z + 4), "root")
bone("spine", V(0, 0, HIP_Z + 4), V(0, 0.3, HIP_Z + 10), "pelvis")
bone("chest", V(0, 0.3, HIP_Z + 10), V(0, 0, HIP_Z + 13), "spine")
bone("head", V(0, -1, HIP_Z + 13), V(0, -2.8, HIP_Z + 19.5), "chest")
for side, sx in (("R", 1), ("L", -1)):
    bone("thigh" + side, V(2.9 * sx, 0, HIP_Z), V(3.2 * sx, 0, HIP_Z - 6.5 * LS), "pelvis")
    bone("shin" + side, V(3.2 * sx, 0, HIP_Z - 6.5 * LS), V(3.2 * sx, 0, 1.6), "thigh" + side)
    bone("foot" + side, V(3.2 * sx, 0, 1.6), V(3.2 * sx, -3.8, 0.7), "shin" + side)
    bone("upperArm" + side, V(5.0 * sx, -0.3, HIP_Z + 11.1), V(5.9 * sx, -1.2, HIP_Z + 4.5), "chest")
    bone("foreArm" + side, V(5.9 * sx, -1.2, HIP_Z + 4.5), V(6.1 * sx, -2.2, HIP_Z - 0.7), "upperArm" + side)
    bone("hand" + side, V(6.1 * sx, -2.2, HIP_Z - 0.7), V(6.1 * sx, -2.6, HIP_Z - 3.3), "foreArm" + side)
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- meshes, bone-parented


def attach(obj, bone_name):
    """Bone-parent obj, preserving its current world placement at rest pose."""
    bpy.context.view_layer.update()   # loc/rot/scale assignments are lazy; matrix_world must be fresh
    b = arm_data.bones[bone_name]
    tail_mat = arm.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_parent_inverse = tail_mat.inverted()
    obj.matrix_world = world
    bpy.context.view_layer.update()


def sphere(name, center, rx, ry, rz, bone_name, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (rx, ry, rz * F)
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    attach(o, bone_name)
    return o


def box(name, center, hx, hy, hz, bone_name, mat):
    bpy.ops.mesh.primitive_cube_add(size=2, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (hx, hy, hz * F)
    o.data.materials.append(mat)
    attach(o, bone_name)
    return o


def limb_cyl(name, bone_name, r, mat, fat=1.15):
    b = arm_data.bones[bone_name]
    head = arm.matrix_world @ b.head_local
    tail = arm.matrix_world @ b.tail_local
    mid = (head + tail) / 2
    d = tail - head
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=r, depth=d.length * fat, location=mid)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    attach(o, bone_name)
    return o


HZ = HIP_Z
sphere("torsoBarrel", V(0, 0.4, HZ + 7.0), 5.2, 4.0, 6.4, "spine", MAT_CLOTH)
sphere("chestCap", V(0, 0, HZ + 11.3), 4.9, 3.6, 3.2, "chest", MAT_CLOTH)
box("pelvisBlock", V(0, 0, HZ + 1.6), 3.4, 2.6, 2.2, "pelvis", MAT_IRON)
sphere("headBall", V(0, -3.0, HZ + 17.7), 5.3, 5.5, 6.8, "head", MAT_BONE)
for side, sx in (("R", 1), ("L", -1)):
    sphere("deltoid" + side, V(5.0 * sx, -0.4, HZ + 10.7), 2.4, 2.5, 2.7, "upperArm" + side, MAT_CLOTH)
    limb_cyl("upperArmM" + side, "upperArm" + side, 1.8, MAT_CLOTH)
    limb_cyl("foreArmM" + side, "foreArm" + side, 1.55, MAT_CLOTH)
    sphere("handBall" + side, V(6.1 * sx, -2.4, HZ - 2.0), 1.5, 1.5, 1.9, "hand" + side, MAT_IRON)
    limb_cyl("thighM" + side, "thigh" + side, 2.1, MAT_CLOTH)
    limb_cyl("shinM" + side, "shin" + side, 1.7, MAT_CLOTH)
    box("footBox" + side, V(3.2 * sx, -1.7, 0.8), 1.6, 2.7, 0.8, "foot" + side, MAT_IRON)

# Greatsword in the right hand: crude gray blade, guard, grip. Rest blade points down along the arm.
hb = arm_data.bones["handR"]
h_head = arm.matrix_world @ hb.head_local
h_tail = arm.matrix_world @ hb.tail_local
sword_dir = (h_tail - h_head).normalized()
sword = []


def sword_box(name, center, hx, hy, hz):
    bpy.ops.mesh.primitive_cube_add(size=2, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (hx, hy, hz)
    o.rotation_euler = sword_dir.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(MAT_STEEL if "Blade" in name else MAT_IRON)
    attach(o, "handR")
    sword.append(o)
    return o


grip_c = h_head + sword_dir * (hb.length * 0.5)
sword_box("swordGrip", grip_c - sword_dir * 3.4, 0.55, 0.55, 3.4)
sword_box("swordGuard", h_tail + sword_dir * 0.3, 4.5, 0.8, 0.7)
sword_box("swordBlade", h_tail + sword_dir * 12.5, 1.6, 0.65, 11.5)

# ---------------------------------------------------------------- marker empties (the rig's registration truth)
MARKERS = {}


def marker(name, world_pos, bone_name):
    e = bpy.data.objects.new("mk_" + name, None)
    e.empty_display_size = 0.5
    bpy.context.collection.objects.link(e)
    e.matrix_world = Matrix.Translation(world_pos)
    attach(e, bone_name)
    MARKERS[name] = e


marker("feetCenter", Vector((0, 0, 0)), "feetCenter")
marker("handR", (h_head + h_tail) / 2, "handR")
hbl = arm_data.bones["handL"]
marker("handL", arm.matrix_world @ ((hbl.head_local + hbl.tail_local) / 2), "handL")
sp = arm_data.bones["spine"]
marker("spine", arm.matrix_world @ ((sp.head_local + sp.tail_local) / 2), "spine")
hd = arm_data.bones["head"]
marker("head", arm.matrix_world @ ((hd.head_local + hd.tail_local) / 2), "head")
marker("bladeTip", h_tail + sword_dir * 23.0, "handR")
marker("bladeMid", h_tail + sword_dir * 12.0, "handR")

# ---------------------------------------------------------------- camera + light
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = CANVAS
cam_data.clip_end = 1000
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.rotation_euler = (pi / 2 - PITCH, 0, 0)
d = Vector((0, cos(PITCH), -sin(PITCH)))          # view direction (north, pitched down)
up = Vector((0, sin(PITCH), cos(PITCH)))
CAM_RIGHT = Vector((1, 0, 0))


def place_camera(feet_row, origin_x):
    """Aim the ortho window so the world origin projects at art-px (origin_x, feet_row)."""
    shift = (0.5 - (CANVAS - feet_row) / CANVAS) * CANVAS
    dx = origin_x - CANVAS / 2                       # camera moves right -> subject moves left
    cam.location = up * shift - CAM_RIGHT * dx - d * 300


place_camera(FEET_ROW, CANVAS / 2)
scene.camera = cam

sun_data = bpy.data.lights.new("sun", type="SUN")
sun_data.energy = 5.0
sun_data.angle = radians(3)
sun = bpy.data.objects.new("sun", sun_data)
bpy.context.collection.objects.link(sun)
# Key from the top of the frame, 15 deg to the left (SS2.1 Law 2), tipped toward the camera so the
# facing side is lit. Euler set directly: X tips the beam toward +Y (over the camera's shoulder),
# negative Y yaws it so the light comes from screen-left.
sun.rotation_euler = (radians(35), radians(-18), 0)

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (*srgb_to_linear((0.30, 0.33, 0.40)), 1.0)
bg.inputs[1].default_value = 0.55

bpy.context.view_layer.update()
probe = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
print(f"[spike] ground origin projects at px ({probe.x * PX:.1f}, {(1 - probe.y) * PX:.1f}) of {PX}")

# ---------------------------------------------------------------- pose machinery


def reset_pose():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def apply_ops(ops):
    """ops, applied in order (parent-first):
      ('R', bone, axis, deg)  rotation about an armature-space axis through the bone's current head
      ('T', bone, (x, y, z))  armature-space translation
      ('A', bone, (x, y, z))  AIM: rotate so the bone points along an armature-space direction —
                              robust under whatever trunk twist already moved the bone."""
    for op in ops:
        pb = arm.pose.bones[op[1]]
        piv = pb.matrix.translation.copy()
        if op[0] == "R":
            rot = Matrix.Translation(piv) @ Matrix.Rotation(radians(op[3]), 4, op[2]) @ Matrix.Translation(-piv)
            pb.matrix = rot @ pb.matrix
        elif op[0] == "A":
            tail = pb.matrix @ Vector((0, pb.bone.length, 0))
            cur = (tail - piv).normalized()
            target = Vector(op[2]).normalized()
            axis = cur.cross(target)
            if axis.length > 1e-6:
                rot = (Matrix.Translation(piv)
                       @ Matrix.Rotation(cur.angle(target), 4, axis.normalized())
                       @ Matrix.Translation(-piv))
                pb.matrix = rot @ pb.matrix
        else:
            pb.matrix = Matrix.Translation(Vector(op[2])) @ pb.matrix
        bpy.context.view_layer.update()


# The Veteran's posture, applied under every pose: ~10 deg trunk lean, arms hanging heavy and forward.
BASE = [
    ("R", "pelvis", "X", 3), ("R", "spine", "X", 5), ("R", "chest", "X", 3), ("R", "head", "X", -1),
    ("R", "upperArmR", "X", -5), ("R", "upperArmL", "X", -5),
]


def run_frame(i):
    p = 2 * pi * i / 8

    def knee(ph):
        return 12 + 42 * max(0.0, sin(ph - 4.2))
    ops = BASE + [
        ("R", "spine", "X", 4), ("R", "pelvis", "Z", -4 * sin(p)), ("R", "spine", "Z", 5 * sin(p)),
        ("T", "pelvis", (0, 0, -1.5 + 1.0 * abs(cos(p)))),
        ("R", "thighR", "X", -(30 * sin(p) + 5)), ("R", "shinR", "X", knee(p)),
        ("R", "footR", "X", -8 * sin(p)),
        ("R", "thighL", "X", -(30 * sin(p + pi) + 5)), ("R", "shinL", "X", knee(p + pi)),
        ("R", "footL", "X", -8 * sin(p + pi)),
        ("R", "upperArmR", "X", 24 * sin(p) - 6), ("R", "foreArmR", "X", -(24 + 10 * sin(p))),
        ("R", "upperArmL", "X", 24 * sin(p + pi) - 6), ("R", "foreArmL", "X", -(24 + 10 * sin(p + pi))),
    ]
    return ops


SWING_STANCE = [
    ("R", "thighR", "Y", -8), ("R", "thighL", "Y", 8),
    ("R", "shinR", "X", 16), ("R", "shinL", "X", 16),
    ("R", "thighR", "X", -10), ("R", "thighL", "X", -10),
    ("T", "pelvis", (0, 0, -2.2)),
]

POSES = {
    "idle": BASE + [
        ("R", "upperArmR", "Y", -4), ("R", "upperArmL", "Y", 4),
        ("R", "thighR", "X", -2), ("R", "thighL", "X", -2),
        ("R", "shinR", "X", 4), ("R", "shinL", "X", 4),
        ("T", "pelvis", (0, 0, -0.3)),
    ],
    **{f"run{i}": run_frame(i) for i in range(8)},
    # The greatsword arc: anticipation -> commit -> impact -> follow-through -> recovery (CF SS5).
    # Arms and wrists are AIMED at armature-space directions (blade extends along the hand bone),
    # sweeping a continuous diagonal arc: up-back-right -> overhead -> forward-down -> low-left.
    "swingAnticipate": BASE + SWING_STANCE + [
        ("R", "pelvis", "Z", 12), ("R", "spine", "Z", 22), ("R", "chest", "Z", 10),
        ("R", "spine", "X", -6), ("R", "head", "Z", -26), ("R", "head", "X", -4),
        ("A", "upperArmR", (0.60, 0.55, 0.42)),
        ("A", "foreArmR", (0.32, 0.55, 0.55)),
        ("A", "handR", (0.42, 0.22, 0.58)),
        ("A", "upperArmL", (0.85, 0.10, 0.35)), ("A", "foreArmL", (0.75, 0.20, 0.63)),
        ("T", "pelvis", (0, 0.8, -1.6)),
    ],
    "swingCommit": BASE + SWING_STANCE + [
        ("R", "pelvis", "Z", 4), ("R", "spine", "Z", 8), ("R", "chest", "Z", 2),
        ("R", "spine", "X", 4), ("R", "head", "Z", -8),
        ("A", "upperArmR", (0.18, -0.30, 0.94)),
        ("A", "foreArmR", (0.24, -0.50, 0.83)),
        ("A", "handR", (0.55, -0.45, 0.38)),
        ("A", "upperArmL", (0.52, -0.17, 0.82)), ("A", "foreArmL", (0.40, -0.30, 0.87)),
        ("T", "pelvis", (0, 0, 0.4)),
    ],
    "swingImpact": BASE + SWING_STANCE + [
        ("R", "thighL", "X", -22), ("R", "shinL", "X", 16),
        ("R", "thighR", "X", 14), ("R", "shinR", "X", -6),
        ("R", "pelvis", "Z", -8), ("R", "spine", "Z", -18), ("R", "chest", "Z", -8),
        ("R", "spine", "X", 8), ("R", "head", "Z", 14),
        ("A", "upperArmR", (-0.10, -0.58, -0.30)),
        ("A", "foreArmR", (-0.16, -0.68, -0.28)),
        ("A", "handR", (-0.40, -0.44, -0.22)),
        ("A", "upperArmL", (0.51, -0.59, -0.63)), ("A", "foreArmL", (0.30, -0.75, -0.59)),
        ("T", "pelvis", (0, -0.8, -0.6)),
    ],
    "swingFollow": BASE + SWING_STANCE + [
        ("R", "thighL", "X", -16), ("R", "thighR", "X", 10),
        ("R", "pelvis", "Z", -14), ("R", "spine", "Z", -26), ("R", "chest", "Z", -10),
        ("R", "spine", "X", 8), ("R", "head", "Z", 20),
        ("A", "upperArmR", (-0.50, -0.55, -0.67)),
        ("A", "foreArmR", (-0.64, -0.45, -0.30)),
        ("A", "handR", (-0.68, -0.40, -0.22)),
        ("A", "upperArmL", (-0.07, -0.40, -0.90)), ("A", "foreArmL", (-0.20, -0.35, -0.91)),
        ("T", "pelvis", (0, -1.0, -0.2)),
    ],
    "swingRecover": BASE + SWING_STANCE + [
        ("R", "thighL", "X", -6), ("R", "thighR", "X", 4),
        ("R", "pelvis", "Z", -4), ("R", "spine", "Z", -8), ("R", "head", "Z", 6),
        ("R", "spine", "X", 2),
        ("A", "upperArmR", (-0.30, -0.20, -0.75)),
        ("A", "foreArmR", (-0.35, -0.25, -0.30)),
        ("A", "handR", (-0.45, -0.30, -0.27)),
        ("A", "upperArmL", (0.23, -0.20, -0.95)), ("A", "foreArmL", (0.20, -0.25, -0.95)),
        ("T", "pelvis", (0, -0.3, 0.6)),
    ],
}

FRAME_ORDER = ["idle"] + [f"run{i}" for i in range(8)] + [
    "swingAnticipate", "swingCommit", "swingImpact", "swingFollow", "swingRecover"]
SWORD_FRAMES = {f for f in FRAME_ORDER if f.startswith("swing")}
FACING_ROT = {"south": 0.0, "north": pi, "east": pi / 2}

# ---------------------------------------------------------------- render + export
os.makedirs(OUT, exist_ok=True)
only = set(ONLY.split(",")) if ONLY else None
rig = {"px": PX, "canvas": CANVAS, "scale": PX / CANVAS, "pitchDeg": math.degrees(PITCH),
       "legScale": LEG_SCALE, "feetRow": FEET_ROW, "facings": {}}

for facing in FACINGS:
    arm.rotation_euler = (0, 0, FACING_ROT[facing])
    os.makedirs(os.path.join(OUT, facing), exist_ok=True)
    rig["facings"][facing] = {"frames": {}}
    for fname in FRAME_ORDER:
        if only and fname not in only:
            continue
        swing = fname in SWORD_FRAMES
        feet_row = 57 if swing else (58 if fname.startswith("run") else FEET_ROW)
        EAST_OX = {"swingAnticipate": 38, "swingCommit": 34, "swingImpact": 26,
                   "swingFollow": 26, "swingRecover": 30}
        origin_x = EAST_OX.get(fname, 32) if facing == "east" else 32
        place_camera(feet_row, origin_x)
        for o in sword:
            o.hide_render = not swing
        reset_pose()
        apply_ops(POSES[fname])
        bones = {}
        for mname, e in MARKERS.items():
            if mname.startswith("blade") and fname not in SWORD_FRAMES:
                continue
            co = world_to_camera_view(scene, cam, e.matrix_world.translation)
            bones[mname] = [round(co.x * PX, 2), round((1 - co.y) * PX, 2)]
        rig["facings"][facing]["frames"][fname] = {
            "bones": bones, "sword": fname in SWORD_FRAMES}
        for mname, (mx, my) in bones.items():
            ax, ay = mx / (PX / CANVAS), my / (PX / CANVAS)
            if not (1 <= ax <= CANVAS - 1 and 1 <= ay <= CANVAS - 1):
                print(f"[spike] FIT WARNING {facing}/{fname}: {mname} projects at art-px ({ax:.1f}, {ay:.1f}) — outside the {CANVAS}px cell")
        scene.render.filepath = os.path.join(OUT, facing, fname + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"[spike] rendered {facing}/{fname}")

rig_path = os.path.join(OUT, "rig.json")
if only:
    # Partial render: merge into the existing rig so the frames NOT re-rendered keep their bones.
    # A rig.json holding only the subset would break the next assemble (all 14 PNGs still exist,
    # but the rig would lack the other frames' registration).
    if os.path.exists(rig_path):
        with open(rig_path) as f:
            merged = json.load(f)
        for k in ("px", "canvas", "scale", "pitchDeg", "legScale", "feetRow"):
            if merged.get(k) != rig[k]:
                print(f"[spike] WARNING: --only run changes {k} ({merged.get(k)} -> {rig[k]}); "
                      "frames not re-rendered keep stale geometry")
            merged[k] = rig[k]
        for facing, fd in rig["facings"].items():
            merged.setdefault("facings", {}).setdefault(facing, {"frames": {}})["frames"].update(fd["frames"])
        rig = merged
    else:
        print("[spike] WARNING: --only with no existing rig.json — writing just the subset; "
              "assemble needs a full render first")
with open(rig_path, "w") as f:
    json.dump(rig, f, indent=2)
print(f"[spike] rig registration -> {rig_path}")

if SAVE_BLEND:
    os.makedirs(os.path.dirname(SAVE_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE_BLEND))
    print(f"[spike] saved {SAVE_BLEND}")
