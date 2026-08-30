# The ENEMY rig: two non-humanoid actors authored on the same deterministic Blender contract as
# tools/spike/mannequin.py (same camera pitch, same exposure pair, same V() z pre-stretch, same
# marker-bone export) but with their OWN armatures, meshes, canvases and pose dicts.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio --factory-startup \
#     --python-exit-code 1 --python tools/spike/mannequin-actors.py -- \
#     --actor caster --out .art-cache/actors/caster/renders [--px 512] [--save-blend x.blend]
#
# SIBLING FILE ON PURPOSE. mannequin.py hardcodes CANVAS 64, FEET_ROW 60, HIP_Z 13.5 and authors the
# Veteran's identity anchors (crest, visor, wine garment, gold marks) UNCONDITIONALLY on the base
# body. A caster or a charger is not a weapon/armor variant of that body — it is a different body, so
# a --flag on mannequin.py would edit a shared code path and invalidate all three committed hero
# stress exhibits. Nothing here can change a hero pixel.
#
# Run `node tools/spike/lanes-actors.mjs` BEFORE this script: it proves each authored material still
# owns its own canon ramp under this exposure, which is the thing a render cannot tell you.
#
# ACTOR BLOCKS ARE SELF-CONTAINED. Everything caster-specific lives under `if ACTOR == "caster"`,
# everything charger-specific under `if ACTOR == "charger"`. Adding a third actor adds a third block.
import bpy
import json
import math
import os
import sys
from math import radians, cos, pi
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

# ---------------------------------------------------------------- args
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, dflt):
    if name not in argv:
        return dflt
    i = argv.index(name)
    if i + 1 >= len(argv):
        sys.exit(f"[actors] {name} needs a value")
    return argv[i + 1]


ACTOR = arg("--actor", "caster")
if ACTOR not in ("caster", "charger"):
    sys.exit(f"[actors] unsupported --actor {ACTOR!r}; expected caster or charger")
OUT = arg("--out", f".art-cache/actors/{ACTOR}/renders")
SAVE_BLEND = arg("--save-blend", "")
ONLY = arg("--only", "")

# ART_DIRECTION §4.1's canvas ladder, chosen by the actor's own measured motion envelope:
#   caster  64 — a toppling pole with a lamp swinging off a crook is a TALL envelope
#   charger 36 — small/flying, and its longest frame is 30px WIDE, not tall
CANVAS = 64 if ACTOR == "caster" else 36
FEET_ROW = 60 if ACTOR == "caster" else 33
PX = int(arg("--px", str(CANVAS * 8)))
FACINGS = arg("--facings", "east").split(",")

PITCH = radians(20)
# The MEASURED exposure pair from mannequin.py:65-88. Do not move it for an actor: below the band a
# body sits on its shadow step and fails ground-separation as a HARD gate; above it familyLightScore
# — a sign test on a two-step form — flips on one-pixel differences in mean row.
SUN_ENERGY = float(arg("--sun", "1.07"))
AMBIENT_STRENGTH = float(arg("--ambient", "1.75"))
AMBIENT_COLOR = (0.75, 0.75, 0.75)
SUN_PITCH = float(arg("--sun-pitch", "20"))
SUN_YAW = float(arg("--sun-yaw", "-12"))
F = 1.0 / cos(PITCH)

# ---------------------------------------------------------------- scene
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
    for _k in ("use_raytracing", "use_gtao", "use_fast_gi"):
        if hasattr(scene.eevee, _k):
            setattr(scene.eevee, _k, False)


# ---------------------------------------------------------------- materials
def srgb_to_linear(c):
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def make_mat(name, srgb, rough=0.85, spec=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(srgb), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular", "Specular IOR Level"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = spec
    return m


def make_flat(name, srgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    for k in ("Specular", "Specular IOR Level"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.0
    lin = srgb_to_linear(srgb)
    for k in ("Emission Color", "Emission"):
        if k in bsdf.inputs:
            try:
                bsdf.inputs[k].default_value = (*lin, 1.0)
            except (TypeError, ValueError):
                continue
    bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


def canon_srgb(h):
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


# ---------------------------------------------------------------- rig helpers (mannequin.py, verbatim)
def V(x, y, z):
    return Vector((x, y, z * F))


arm_data = bpy.data.armatures.new(ACTOR)
arm = bpy.data.objects.new(ACTOR, arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm


def bone(name, head, tail, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b


def attach(obj, bone_name):
    bpy.context.view_layer.update()
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


def box(name, center, hx, hy, hz, bone_name, mat, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=2, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (hx, hy, hz * F)
    if rot:
        o.rotation_euler = rot
    o.data.materials.append(mat)
    attach(o, bone_name)
    return o


def limb(name, bone_name, r, mat, fat=1.15, boxy=False, hz=None):
    """A cylinder (or a flat PLATE, `boxy`) laid along a bone. Boxes quantize cleanly on a short ramp
    where a sphere bands; the charger's shin is a plate for exactly that reason."""
    b = arm_data.bones[bone_name]
    head = arm.matrix_world @ b.head_local
    tail = arm.matrix_world @ b.tail_local
    mid = (head + tail) / 2
    d = tail - head
    if boxy:
        bpy.ops.mesh.primitive_cube_add(size=2, location=mid)
        o = bpy.context.active_object
        o.scale = (r, hz if hz is not None else r, d.length * fat / 2)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=r, depth=d.length * fat, location=mid)
        o = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(mat)
    attach(o, bone_name)
    return o


MARKERS = {}


def marker(name, world_pos, bone_name):
    e = bpy.data.objects.new("mk_" + name, None)
    e.empty_display_size = 0.5
    bpy.context.collection.objects.link(e)
    e.matrix_world = Matrix.Translation(world_pos)
    attach(e, bone_name)
    MARKERS[name] = e


# ================================================================= THE LAMPAD (sim kind `caster`)
# She is not a spellcaster: she is a lamp-stand that walks. The iron crook is FUSED to her spine and
# leaves the nape, not a hand; the thing that aims is the lamp swinging off it. Arms never leave the
# contour in any frame, because there are no arms — a wizard is defined by an outstretched arm and a
# hood, and deleting both is what makes this read as furniture until it moves.
#
# EAST PROJECTION, which is the whole geometry argument. The armature yaws +90deg for east, so local
# -Y (the character's forward) becomes screen RIGHT and local +/-X becomes depth. Every number below
# in (y, z) is therefore literally the east silhouette; local x only tilts screen height by 0.342/unit.
if ACTOR == "caster":
    HIP = 22.0                    # legs 22px of a 36px standing body = 61% (Veteran ~46%)

    MAT_WAX = make_mat("wax", canon_srgb("#90806C"))            # -> boneDim, SHADED. The body mid.
    MAT_WAX_HI = make_flat("waxHi", canon_srgb("#D0C0A8"))      # -> bone, FLAT (a shaded wax lane
    #                                                              never reaches `bone` — measured)
    MAT_WAX_LO = make_flat("waxLo", canon_srgb("#5A4E42"))      # -> boneLo, FLAT. Warm hollows.
    MAT_IRON = make_mat("iron", canon_srgb("#4C4C56"))          # -> ironHi. Lifted off the hero's
    #                                                              #393942, which this ramp eats whole.
    MAT_IRON_CREV = make_flat("ironCrev", canon_srgb("#26262E"))  # -> iron, FLAT
    MAT_IRON_SP = make_flat("ironSp", canon_srgb("#76849A"))    # -> slateHi, FLAT. 1px, 2 segments.
    MAT_SHROUD = make_mat("shroud", canon_srgb("#33302A"))      # -> ashField / ashFieldLit
    MAT_GLASS = make_flat("glass", canon_srgb("#0E122C"))       # -> sky. A DEAD pane, drawn cold.
    MAT_OUT_IRON = make_flat("outIron", canon_srgb("#0A0C12"))  # -> mortar
    MAT_OUT_CLTH = make_flat("outCloth", canon_srgb("#0C0E16"))  # -> grout
    MAT_OUT_WAX = make_flat("outWax", canon_srgb("#261A16"))    # -> woodLo

    bpy.ops.object.mode_set(mode="EDIT")
    bone("root", V(0, 2, 0), V(0, 5, 0))
    bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
    bone("pelvis", V(0, 0, HIP), V(0, 0, HIP + 3), "root")
    bone("spine", V(0, 0, HIP + 3), V(0, 0, HIP + 8), "pelvis")
    bone("chest", V(0, 0, HIP + 8), V(0, 0, HIP + 10), "spine")
    bone("head", V(0, -0.6, HIP + 10), V(0, -1.8, HIP + 13.5), "chest")
    # The crook is BODY, not a weapon. That is what puts its 8px rise inside the height gate's own
    # bbox measurement and still clears the 52px cap on a 64 cell with 6px spare — no waiver.
    bone("crook", V(0, 3.5, HIP + 8), V(0, 3.5, HIP + 24), "chest")
    bone("lampArm", V(0, 3.5, HIP + 24), V(0, -9.5, HIP + 24), "crook")
    bone("lamp", V(0, -9.5, HIP + 14), V(0, -9.5, HIP + 6), "lampArm")
    for side, sx in (("R", 1), ("L", -1)):
        bone("thigh" + side, V(2.2 * sx, 0, HIP), V(2.2 * sx, 0, HIP - 11), "pelvis")
        bone("shin" + side, V(2.2 * sx, 0, HIP - 11), V(2.2 * sx, 0, 1.6), "thigh" + side)
        bone("foot" + side, V(2.2 * sx, 0, 1.6), V(2.2 * sx, -2.6, 0.6), "shin" + side)
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- the wax column. 9px of body DEPTH, which is what east reads as width: 0.25 of the standing
    # height against the hero's measured 0.50. That 2:1 is the primary hero separator.
    sphere("torso", V(0, 0, HIP + 5), 3.0, 4.4, 6.0, "spine", MAT_WAX)
    sphere("chestCap", V(0, 0, HIP + 9), 2.8, 3.8, 2.6, "chest", MAT_WAX)
    sphere("skull", V(0, -1.0, HIP + 11.5), 2.6, 3.4, 3.2, "head", MAT_WAX)
    box("pelvisBlock", V(0, 0, HIP - 1), 2.6, 3.4, 2.2, "pelvis", MAT_WAX)
    # The dark backing that gives the column its material-dark contour on the side away from the
    # north-15-left key (§4.3.3). The capeShadow mechanism from mannequin.py, reused: a box that
    # overhangs the lit body rather than shading that hopes to produce a rim.
    box("napeShadow", V(0, 3.9, HIP + 4), 3.1, 1.1, 6.6, "spine", MAT_OUT_WAX)
    # A 1px notch where a face would be. NOT a boneLo eye socket: on a 7px head that is 3px of
    # ornament that muds at 1x, and a dark bone step high on the body is what flips familyLightScore.
    box("faceNotch", V(0, -4.0, HIP + 11.4), 1.6, 0.5, 0.5, "head", MAT_OUT_WAX)
    # bone, FLAT, capped: the crown cap and the wick tip are the sheet's only B5 pixels.
    box("crownCap", V(0, -1.0, HIP + 14.2), 2.2, 2.8, 0.5, "head", MAT_WAX_HI)

    for side, sx in (("R", 1), ("L", -1)):
        limb("thighM" + side, "thigh" + side, 1.5, MAT_WAX)
        limb("shinM" + side, "shin" + side, 1.25, MAT_WAX)
        box("footBox" + side, V(2.2 * sx, -1.2, 0.7), 1.1, 1.9, 0.7, "foot" + side, MAT_WAX)
        # Warm hollows LOW and nowhere else: bright-high / dark-low is what keeps the bone family's
        # step-vs-row correlation negative under §2.1 Law 2.
        box("kneeHollow" + side, V(2.2 * sx, 1.3, HIP - 10.6), 1.2, 0.45, 1.0, "shin" + side, MAT_WAX_LO)
        box("shinCuff" + side, V(2.2 * sx, 0, 5.6), 1.45, 1.45, 1.1, "shin" + side, MAT_IRON)

    # --- the shroud: waist to knee, the dark band that stops a pale column reading as one bar.
    box("shroud", V(0, 0, HIP - 6.0), 2.9, 4.3, 5.0, "pelvis", MAT_SHROUD)
    box("shroudHem", V(0, 0, HIP - 11.4), 2.95, 4.35, 0.7, "pelvis", MAT_OUT_CLTH)

    # --- THE CROOK. A closed ring above the crown: stem up the nape, a top bar reaching forward, a
    # front bar descending to the hook tip, and a dark bottom bar closing the eye. The 11x4px of void
    # trapped inside is a CLOSED HOLE in the silhouette — no other actor owns one, and no gate can
    # see it (`components` counts opaque islands, and a hole is not an island), so it is verified by
    # reading the 1x black test.
    box("crookStem", V(0, 3.5, HIP + 16.0), 0.9, 1.0, 8.0, "crook", MAT_IRON)
    box("crookTop", V(0, -3.0, HIP + 23.0), 0.9, 7.5, 1.0, "lampArm", MAT_IRON)
    box("crookFront", V(0, -9.5, HIP + 19.0), 0.9, 1.0, 5.0, "lampArm", MAT_IRON)
    box("crookBottom", V(0, -2.75, HIP + 17.0), 0.85, 5.75, 1.0, "lampArm", MAT_IRON_CREV)
    box("crookSpec", V(0, -3.0, HIP + 24.1), 0.6, 3.0, 0.35, "lampArm", MAT_IRON_SP)

    # --- the lamp: 6px x 5px cage on 3px of chain, hung at the PROJECTED position of the sim's own
    # bolt origin (e.radius + 4 = 9 world px along the aim, src/sim/enemies/caster.ts:116), so the
    # drawn charge and the fired bolt leave the same pixel and the aim maths needs no change.
    box("lampChain", V(0, -9.5, HIP + 12.5), 0.5, 0.5, 1.5, "lamp", MAT_IRON)
    box("lampCage", V(0, -9.5, HIP + 8.5), 1.4, 3.0, 2.5, "lamp", MAT_IRON)
    box("lampBack", V(0, -6.4, HIP + 8.5), 1.2, 0.4, 2.2, "lamp", MAT_IRON_CREV)
    box("lampRim", V(0, -9.5, HIP + 10.8), 0.9, 2.4, 0.3, "lamp", MAT_IRON_SP)
    box("lampPane", V(0, -12.4, HIP + 8.4), 1.0, 0.35, 1.5, "lamp", MAT_GLASS)
    box("lampWick", V(0, -11.0, HIP + 9.6), 0.4, 0.4, 0.4, "lamp", MAT_WAX_HI)
    box("lampFoot", V(0, -9.5, HIP + 5.8), 1.3, 2.6, 0.4, "lamp", MAT_OUT_IRON)

    lb = arm_data.bones["lamp"]
    marker("feetCenter", Vector((0, 0, 0)), "feetCenter")
    marker("lamp", arm.matrix_world @ Vector(V(0, -9.5, HIP + 8.5)), "lamp")
    SOCKETS = ["lamp"]

    # ---- poses. Sim states are idle / position / aim / recover / stagger / dead.
    BASE = [("R", "spine", "X", -4), ("R", "head", "X", 20)]

    def legs(front, back, fr=0, bk=0):
        """front/back thigh swing in degrees (negative X = forward), plus shin bends."""
        return [("R", "thighR", "X", front), ("R", "shinR", "X", fr),
                ("R", "thighL", "X", back), ("R", "shinL", "X", bk)]

    POSES = {
        # At rest a closed vertical line whose only asymmetry is the forward crook.
        "idle": BASE + legs(-7, 4, 6, 3) + [("T", "pelvis", (0, 0, -0.4))],
        # 30-40 px/s. The lamp lags the body, so her direction is readable from the lamp one frame
        # before the legs say it. Two frames is the whole walk; a 30 px/s strafe does not earn four.
        "strafeA": BASE + legs(-24, 16, 20, 6) + [
            ("R", "crook", "X", -3), ("R", "lamp", "X", 22), ("T", "pelvis", (0, 0, -0.9)),
        ],
        "strafeB": BASE + legs(18, -22, 8, 22) + [
            ("R", "crook", "X", 3), ("R", "lamp", "X", -20), ("T", "pelvis", (0, 0, -1.1)),
        ],
        # MOTION STOPS: both heels down for the only time on the sheet, lamp dead still and plumb.
        # Read this frame temporally, not spatially.
        "settle": BASE + legs(-3, 2, 2, 2) + [("R", "head", "X", -4), ("T", "pelvis", (0, 0, 0.2))],
        # §6.7's ANNOUNCE. The whole column changes shape 24 ticks before contact: crook vertical ->
        # 18deg forward, body counterweights back, height compresses.
        "aimRise": BASE + legs(-12, 9, 12, 5) + [
            ("R", "crook", "X", 18), ("R", "spine", "X", -6), ("R", "lamp", "X", -14),
            ("T", "pelvis", (0, 0, -1.8)),
        ],
        # The tick the angle stops tracking you: crook at full forward, trailing leg straight and
        # locked, head UP for the only time on the sheet.
        "aimLock": BASE + legs(-16, 13, 4, 0) + [
            ("R", "crook", "X", 30), ("R", "spine", "X", -7), ("R", "head", "X", -26),
            ("R", "lamp", "X", -4), ("T", "pelvis", (0, 0, -1.2)),
        ],
        # The only backward recoil in the roster: the shot knocks her off her own line.
        "release": BASE + legs(-9, 16, 10, 2) + [
            ("R", "crook", "X", -6), ("R", "spine", "X", -12), ("R", "pelvis", "X", -5),
            ("R", "lamp", "X", 16), ("T", "pelvis", (0, 0.9, -0.6)),
        ],
        # The pendulum keeps moving after she has stopped — which is what makes a top-heavy vertical
        # mass read as heavy rather than as a stick.
        "recover": BASE + legs(-6, 7, 8, 4) + [
            ("R", "crook", "X", 7), ("R", "head", "X", 8), ("R", "lamp", "X", -18),
            ("T", "pelvis", (0, 0, -0.8)),
        ],
        # The column TOPPLES toward the cut: legs trail behind the hips, crook swings past vertical,
        # lamp overshoots outside the body contour. This is the frame that shatters.
        "hurt": BASE + [
            ("R", "pelvis", "X", -16), ("R", "spine", "X", -14), ("R", "head", "X", -18),
            ("R", "crook", "X", -22), ("R", "lamp", "X", 34),
            ("R", "thighR", "X", 26), ("R", "shinR", "X", 30),
            ("R", "thighL", "X", 34), ("R", "shinL", "X", 22),
            ("T", "pelvis", (0, 2.2, -1.6)),
        ],
    }
    FRAME_ORDER = ["idle", "strafeA", "strafeB", "settle", "aimRise",
                   "aimLock", "release", "recover", "hurt"]

# ================================================================= THE EMPUSA (sim kind `charger`)
# One shorn bronze limb, severed at the hip, that hovers, folds at the knee, and kicks. The only
# actor in the roster with no head, no face, no eye, and no foot on the ground. Its hook is the KNEE
# KNUCKLE — a convex bone knob on a dead-level horizontal chord, with air under it — and the hook is
# also the telegraph, because the coil is one joint angle.
if ACTOR == "charger":
    HOVER = 9.0                   # shin centreline height; the air gap under it is the identity

    MAT_BRASS = make_mat("brass", canon_srgb("#7A5E30"))        # -> naveWarm / coinBrass
    MAT_IRON = make_mat("iron", canon_srgb("#393942"))          # -> iron / ironHi
    MAT_BONE = make_flat("boneFlat", canon_srgb("#90806C"))     # -> boneDim, the knuckle
    MAT_BONEHI = make_flat("boneHi", canon_srgb("#D0C0A8"))     # -> bone, the key-face cap ONLY
    MAT_SLIT = make_flat("slitFlat", canon_srgb("#0A0C12"))     # -> mortar, the 1px iron contour

    bpy.ops.object.mode_set(mode="EDIT")
    bone("root", V(0, 2, 0), V(0, 5, 0))
    # feetCenter stays at the ORIGIN and is never posed, so the pivot, the feetY sort and the shadow
    # ellipse need no code change and the dash clip's foot-pivot spread is 0 by construction.
    bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
    bone("hipStub", V(0, 9.0, HOVER), V(0, 5.5, HOVER), "root")
    bone("thighC", V(0, 5.5, HOVER), V(0, 3.0, HOVER), "hipStub")
    bone("shinC", V(0, 3.0, HOVER), V(0, -8.0, HOVER), "thighC")
    bone("heelC", V(0, -8.0, HOVER), V(0, -12.0, HOVER - 1.0), "shinC")
    bpy.ops.object.mode_set(mode="OBJECT")

    limb("thighStub", "hipStub", 2.4, MAT_IRON, fat=1.0)
    box("hipCut", V(0, 9.4, HOVER), 2.0, 0.5, 2.0, "hipStub", MAT_SLIT)
    limb("thighM", "thighC", 2.3, MAT_IRON, fat=1.1)
    # The knuckle: a bone sphere riding on TOP of the limb's rear third, breaking the top contour by
    # 4px above the shin plate. A convex knob on a dead-level horizontal line, with air under it.
    sphere("knuckle", V(0, 3.0, HOVER + 1.4), 2.4, 2.6, 2.6, "thighC", MAT_BONE)
    box("knuckleCap", V(0, 3.0, HOVER + 3.5), 1.7, 1.9, 0.45, "thighC", MAT_BONEHI)
    # The shin is a PLATE, not a sausage: the plate is what gives the straight leading chord, and a
    # flat face quantizes cleanly on an 8-name ramp where a cylinder would band.
    limb("shinPlate", "shinC", 2.0, MAT_BRASS, fat=1.0, boxy=True, hz=1.9)
    limb("heelWedge", "heelC", 1.8, MAT_BRASS, fat=1.0, boxy=True, hz=1.5)
    box("shinLip", V(0, -2.5, HOVER + 1.9), 1.6, 4.5, 0.35, "shinC", MAT_BRASS)

    marker("feetCenter", Vector((0, 0, 0)), "feetCenter")
    marker("heel", arm.matrix_world @ Vector(V(0, -11.0, HOVER - 0.8)), "heelC")
    SOCKETS = ["heel"]

    def knee(deg, heel=0, hover=0.0, pitch=0.0):
        """Interior knee angle in degrees (rest is 180 = straight), the heel's own counter-rotation,
        and the whole body's hover offset. Width IS the animation and is never normalized."""
        return [("R", "hipStub", "X", pitch), ("R", "shinC", "X", -(180 - deg)),
                ("R", "heelC", "X", heel), ("T", "hipStub", (0, 0, hover))]

    POSES = {
        # A bronze shin with a bone knob, floating. Authored distinct from hoverA by the heel drop so
        # the duplicate-frames gate cannot fire on a byte-identical pair.
        "idle": knee(118, heel=26, hover=0.0),
        "hoverA": knee(122, heel=18, hover=0.6),
        "hoverB": knee(126, heel=6, hover=2.4),
        # The window where aimAngle still tracks the player: the limb is still turning.
        "coilDraw": knee(84, heel=30, hover=-0.6),
        # THE frame the design hangs on, entered at exactly chargerLockTick() = freezeTicks 16 -
        # commitLead 9 = 7. The telegraph is a body that gets SMALLER, where every other actor in the
        # roster telegraphs by getting bigger: width drops ~23% and the body DROPS toward the floor.
        "coilLock": knee(62, heel=44, hover=-2.0),
        # Never 180: a straight limb reads as a stick. 172 keeps one contour break.
        "lunge": knee(172, heel=-6, hover=0.2),
        # It overshot. The punish window drawn as a posture, not as a pause.
        "skid": knee(96, heel=-28, hover=-3.0, pitch=-10),
        # hp is 2, so this is almost always the last frame it is alive in: authored already broken.
        # The one frame where the brightest mass is not the topmost pixel.
        "hurt": knee(48, heel=-40, hover=-4.0, pitch=26),
    }
    FRAME_ORDER = ["idle", "hoverA", "hoverB", "coilDraw", "coilLock", "lunge", "skid", "hurt"]

# ---------------------------------------------------------------- camera + light
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = CANVAS
cam_data.clip_end = 1000
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.rotation_euler = (pi / 2 - PITCH, 0, 0)
d = Vector((0, cos(PITCH), -math.sin(PITCH)))
up = Vector((0, math.sin(PITCH), cos(PITCH)))
CAM_RIGHT = Vector((1, 0, 0))


def place_camera(feet_row, origin_x):
    shift = (0.5 - (CANVAS - feet_row) / CANVAS) * CANVAS
    dx = origin_x - CANVAS / 2
    cam.location = up * shift - CAM_RIGHT * dx - d * 300


place_camera(FEET_ROW, CANVAS / 2)
scene.camera = cam

sun_data = bpy.data.lights.new("sun", type="SUN")
sun_data.energy = SUN_ENERGY
sun_data.angle = radians(3)
sun = bpy.data.objects.new("sun", sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (radians(SUN_PITCH), radians(SUN_YAW), 0)

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (*srgb_to_linear(AMBIENT_COLOR), 1.0)
bg.inputs[1].default_value = AMBIENT_STRENGTH


# ---------------------------------------------------------------- pose machinery (mannequin.py)
def reset_pose():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def apply_ops(ops):
    for op in ops:
        pb = arm.pose.bones[op[1]]
        piv = pb.matrix.translation.copy()
        if op[0] == "R":
            rot = Matrix.Translation(piv) @ Matrix.Rotation(radians(op[3]), 4, op[2]) @ Matrix.Translation(-piv)
            pb.matrix = rot @ pb.matrix
        else:
            pb.matrix = Matrix.Translation(Vector(op[2])) @ pb.matrix
        bpy.context.view_layer.update()


# ---------------------------------------------------------------- render + export
FACING_ROT = {"south": 0.0, "north": pi, "east": pi / 2}
os.makedirs(OUT, exist_ok=True)
only = set(ONLY.split(",")) if ONLY else None
rig = {"px": PX, "canvas": CANVAS, "scale": PX / CANVAS, "pitchDeg": math.degrees(PITCH),
       "feetRow": FEET_ROW, "actor": ACTOR, "sockets": SOCKETS,
       "frameOrder": FRAME_ORDER,
       "sunEnergy": SUN_ENERGY, "ambientStrength": AMBIENT_STRENGTH, "facings": {}}

for facing in FACINGS:
    arm.rotation_euler = (0, 0, FACING_ROT[facing])
    os.makedirs(os.path.join(OUT, facing), exist_ok=True)
    rig["facings"][facing] = {"frames": {}}
    for fname in FRAME_ORDER:
        if only and fname not in only:
            continue
        place_camera(FEET_ROW, CANVAS / 2)
        reset_pose()
        apply_ops(POSES[fname])
        bones = {}
        for mname, e in MARKERS.items():
            co = world_to_camera_view(scene, cam, e.matrix_world.translation)
            bones[mname] = [round(co.x * PX, 2), round((1 - co.y) * PX, 2)]
        rig["facings"][facing]["frames"][fname] = {"bones": bones}
        for mname, (mx, my) in bones.items():
            ax, ay = mx / (PX / CANVAS), my / (PX / CANVAS)
            if not (1 <= ax <= CANVAS - 1 and 1 <= ay <= CANVAS - 1):
                print(f"[actors] FIT WARNING {facing}/{fname}: {mname} at art-px ({ax:.1f}, {ay:.1f})")
        scene.render.filepath = os.path.join(OUT, facing, fname + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"[actors] rendered {ACTOR} {facing}/{fname}")

rig_path = os.path.join(OUT, "rig.json")
if only and os.path.exists(rig_path):
    with open(rig_path) as f:
        merged = json.load(f)
    for facing, fd in rig["facings"].items():
        merged.setdefault("facings", {}).setdefault(facing, {"frames": {}})["frames"].update(fd["frames"])
    rig = merged
with open(rig_path, "w") as f:
    json.dump(rig, f, indent=2)
print(f"[actors] rig registration -> {rig_path}")

if SAVE_BLEND:
    os.makedirs(os.path.dirname(SAVE_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE_BLEND))
