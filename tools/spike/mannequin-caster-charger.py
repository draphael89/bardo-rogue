# THE LAMPAD and THE EMPUSA — sim kinds `caster` and `charger` — as rigged Blender scenes.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio --factory-startup \
#     --python-exit-code 1 --python tools/spike/mannequin-caster-charger.py -- \
#     --actor caster --out .art-cache/actors/caster/renders [--px 512] [--save-blend x.blend]
#
# SIBLING FILE ON PURPOSE, twice over. (1) tools/spike/mannequin.py hardcodes CANVAS 64, FEET_ROW 60,
# HIP_Z 13.5 and authors the Veteran's identity anchors (crest, visor, wine garment, gold marks)
# UNCONDITIONALLY on the base body, so a --flag there would edit a shared code path and invalidate
# all three committed hero stress exhibits. (2) tools/spike/mannequin-actors.py is the sibling agent's
# warden/oathbound/dummy rig; two agents editing one armature file is how a body silently drifts.
# What IS shared with both is the contract: the same camera pitch, the same MEASURED exposure pair,
# the same V() z pre-stretch, the same marker-bone export, and the same rig.json shape — so the
# generic assembler (assemble-actors.mjs) and evidence tool read this rig without a special case.
#
# Run `node tools/spike/lanes-caster-charger.mjs` BEFORE this script: it proves each authored material
# still owns its own canon ramp under this exposure, which is the thing a render cannot tell you.
#
# EAST PROJECTION IS THE WHOLE GEOMETRY ARGUMENT, and every number below depends on it. The armature
# yaws +90deg for east, so a local point (lx, ly, lz) lands at world (-ly, lx, lz): local -Y (the
# character's FORWARD) becomes screen RIGHT, and local +/-X becomes depth, tilting screen height by
# only 0.342 px per unit. Every (y, z) pair below is therefore literally the east silhouette. Both
# actors ship east-only with `mirror: true`, which is the brute contract src/render/views/enemies.ts
# already implements (`b.scale.set(sx * e.facing, sy)`) — so the renderer binds these with no
# behaviour change at all.
import bpy
import json
import math
import os
import sys
from math import radians, cos, sin, pi
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

# ---------------------------------------------------------------- args
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, dflt):
    if name not in argv:
        return dflt
    i = argv.index(name)
    if i + 1 >= len(argv):
        sys.exit(f"[cc] {name} needs a value")
    return argv[i + 1]


ACTOR = arg("--actor", "caster")
if ACTOR not in ("caster", "charger"):
    sys.exit(f"[cc] unsupported --actor {ACTOR!r}; expected caster or charger")
OUT = arg("--out", f".art-cache/actors/{ACTOR}/renders")
SAVE_BLEND = arg("--save-blend", "")
ONLY = arg("--only", "")
FACINGS = arg("--facings", "east").split(",")

# ART_DIRECTION §4.1's canvas ladder, chosen by each actor's MEASURED motion envelope:
#   caster  64 — a toppling pole with a lamp swinging off a crook is a tall envelope, and the crook
#                is BODY, so its rise sits inside gates.ts's bbox height measurement. Cap on a 64
#                cell is round(64*26/32) = 52; on a 48 cell it would be 39 and this would need a
#                waiver for being correct.
#   charger 36 — small/flying (radius 4), and its longest frame is 30px WIDE, not tall. Cap 29.
CANVAS = 64 if ACTOR == "caster" else 36
FEET_ROW = 60 if ACTOR == "caster" else 33
PX = int(arg("--px", str(CANVAS * 8)))

PITCH = radians(20)
# The MEASURED exposure pair (mannequin.py:65-88). Do not move it for an actor: below the band a body
# sits on its own shadow step and fails ground-separation as a HARD gate; above it familyLightScore —
# a sign test on a two-step form — flips on one-pixel differences in mean row.
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
    # EEVEE Next's horizon-scan GI darkens crevices far below the flat ambient floor, which is what
    # drags a plane out of its own lane. The lane window is only defensible while shading is
    # ambient + key + the key's own cast shadow.
    for _k in ("use_raytracing", "use_gtao", "use_fast_gi"):
        if hasattr(scene.eevee, _k):
            setattr(scene.eevee, _k, False)


# ---------------------------------------------------------------- materials
def srgb_to_linear(c):
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def make_mat(name, srgb, rough=0.85, spec=0.0):
    """A SHADED lane. Specular is zero: an additive white highlight is a bigger fraction of a dark
    base than of a light one, so it shifts each material's rendered multiplier by a different amount
    and the lanes stop sharing one exposure window."""
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
    """An UNSHADED mark: the canon colour, emitted, with nothing for the light to do to it."""
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


def limb(name, bone_name, r, mat, fat=1.15, plate=False, hz=None):
    """A cylinder along a bone, or a flat PLATE when `plate`. Boxes quantize cleanly on a short ramp
    where a cylinder bands, which is why the Empusa's shin is a plate and not a sausage."""
    b = arm_data.bones[bone_name]
    head = arm.matrix_world @ b.head_local
    tail = arm.matrix_world @ b.tail_local
    mid = (head + tail) / 2
    d = tail - head
    if plate:
        bpy.ops.mesh.primitive_cube_add(size=2, location=mid)
        o = bpy.context.active_object
        o.scale = (r, (hz if hz is not None else r) * F, d.length * fat / 2)
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
# She is not a spellcaster. She is a lamp-stand that walks: the iron crook is FUSED to her spine and
# leaves the NAPE, not a hand, and the thing that aims is the lamp swinging off it. There are no arm
# bones at all — a wizard is defined by an outstretched arm and a hood, and deleting both gives a
# thing that reads as furniture until it moves, which is the correct read for a nymph who is a lamp.
# It also helps the black test rather than costing it: there is no thin arm left to mud at 1x.
if ACTOR == "caster":
    # A walking funeral lamp, not a stick under a bracket. The first 1x candidate spent 61% of its
    # height on bare legs, gave the pale column a face, and hung the lantern near its knees on a
    # 17px chain. Together those relations drew a thin person carrying a rectangular placard. Lower
    # hips, one broad wax bell, no face cue, and a chest-height dead lantern make the noun complete;
    # the crook and sim-aligned socket remain the identity and timing contract.
    HIP = 17.0

    MAT_WAX = make_mat("wax", canon_srgb("#90806C"))              # -> boneDim, SHADED. The body mid,
    #   ~38% of opaque at Weber +2.93: the ground-separation solution AND the identity, because she is
    #   pale for the reason she is dangerous — she is made of the thing that burns.
    MAT_WAX_HI = make_flat("waxHi", canon_srgb("#D0C0A8"))        # -> bone, FLAT. MEASURED: a shaded
    #   wax lane lands on boneDim across the ENTIRE k window and never reaches `bone`, so the
    #   highlight is a mark, not the top of a ramp — which is what §2.6 wants anyway.
    MAT_WAX_LO = make_flat("waxLo", canon_srgb("#5A4E42"))        # -> boneLo, FLAT. Warm hollows,
    #   never a grey shadow on bone (§2.6), and placed LOW only (see kneeHollow).
    MAT_IRON = make_mat("iron", canon_srgb("#4C4C56"))            # -> ironHi, SHADED. LIFTED off the
    #   hero's #393942, which this 12-name ramp captures WHOLE as ashFieldLit — caught in the lane
    #   sweep before Blender spent a second.
    MAT_IRON_CREV = make_flat("ironCrev", canon_srgb("#26262E"))  # -> iron, FLAT. §2.4 wants metal's
    #   two extremes to touch with no midtone between them.
    MAT_IRON_SP = make_flat("ironSp", canon_srgb("#76849A"))      # -> slateHi, FLAT. 1px specular,
    #   two segments, never a continuous edge run and never on the body.
    MAT_SHROUD = make_mat("shroud", canon_srgb("#33302A"))        # -> ashField / ashFieldLit
    MAT_GLASS = make_flat("glass", canon_srgb("#0E122C"))         # -> sky, FLAT and UNSHADED (§2.8).
    #   At 1x it is a hole in the cage: a DEAD lamp. No star pixel (half a pixel at canon density,
    #   riding a swinging lamp, so it flickers), no ember pilot light — src/render/lampadInk.ts
    #   already inks this actor entirely wine-dark, so the tell is the FX layer lighting a dead pane,
    #   which is a value AND hue change on the same 3x3 px. The lamp is drawn cold and stays cold.
    MAT_OUT_IRON = make_flat("outIron", canon_srgb("#0A0C12"))    # -> mortar
    MAT_OUT_CLTH = make_flat("outCloth", canon_srgb("#0C0E16"))   # -> grout
    MAT_OUT_WAX = make_flat("outWax", canon_srgb("#261A16"))      # -> woodLo

    bpy.ops.object.mode_set(mode="EDIT")
    bone("root", V(0, 2, 0), V(0, 5, 0))
    bone("feetCenter", V(0, 0, -2.2), V(0, -3, -2.2), "root")
    bone("pelvis", V(0, 0, HIP), V(0, 0, HIP + 3), "root")
    bone("spine", V(0, 0, HIP + 3), V(0, 0, HIP + 8), "pelvis")
    bone("chest", V(0, 0, HIP + 8), V(0, 0, HIP + 10), "spine")
    bone("head", V(0, -0.6, HIP + 10), V(0, -1.8, HIP + 13.5), "chest")
    # The crook is BODY, not a weapon. That is what puts its rise inside the height gate's own bbox
    # measurement and still clears the 52px cap on a 64 cell — so the sheet ships waiver-free.
    bone("crook", V(0, 3.5, HIP + 8), V(0, 3.5, HIP + 24), "chest")
    bone("lampArm", V(0, 3.5, HIP + 24), V(0, -9.5, HIP + 24), "crook")
    bone("lamp", V(0, -9.5, HIP + 17), V(0, -9.5, HIP + 1), "lampArm")
    for side, sx in (("R", 1), ("L", -1)):
        bone("thigh" + side, V(2.2 * sx, 0, HIP), V(2.2 * sx, 0, HIP - 11), "pelvis")
        bone("shin" + side, V(2.2 * sx, 0, HIP - 11), V(2.2 * sx, 0, 1.6), "thigh" + side)
        bone("foot" + side, V(2.2 * sx, 0, 1.6), V(2.2 * sx, -2.6, 0.6), "shin" + side)
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- the wax body. East reads local depth as width, so these `ry` values are the silhouette,
    # not hidden volume. One uninterrupted bell replaces the humanoid head / chest / waist stack.
    sphere("torso", V(0, 0, HIP + 4), 4.0, 7.5, 7.0, "spine", MAT_WAX)
    sphere("chestCap", V(0, 0, HIP + 9), 3.7, 6.8, 3.2, "chest", MAT_WAX)
    box("wick", V(0, 0, HIP + 12.0), 1.6, 2.4, 2.2, "head", MAT_WAX)
    box("pelvisBlock", V(0, 0, HIP - 1), 3.5, 6.6, 2.4, "pelvis", MAT_WAX)
    # The material-dark contour on the side away from the north-15-left key (§4.3.3), got the proven
    # way: a dark box that OVERHANGS the lit body, the capeShadow mechanism from mannequin.py, rather
    # than shading that hopes a rim appears. Never behind the crook — a backing plate there would
    # fill the closed hole, which is the one thing on this sheet no gate can see.
    box("napeShadow", V(0, 7.1, HIP + 3), 4.0, 1.1, 7.2, "spine", MAT_OUT_WAX)
    # The sheet's only B5 pixels: one unlit wick cap and the lantern wick, ~3% of opaque against a
    # 25% cap. It is centred, never projected as a nose or eye.
    box("crownCap", V(0, 0, HIP + 14.2), 1.4, 1.8, 0.5, "head", MAT_WAX_HI)

    for side, sx in (("R", 1), ("L", -1)):
        limb("thighM" + side, "thigh" + side, 1.5, MAT_WAX)
        limb("shinM" + side, "shin" + side, 1.25, MAT_WAX)
        box("footBox" + side, V(2.2 * sx, -1.2, 0.7), 1.1, 1.9, 0.7, "foot" + side, MAT_WAX)
        # Warm hollows LOW and nowhere else. Bright-high / dark-low is what keeps the bone family's
        # step-luminance-vs-mean-row correlation negative under §2.1 Law 2.
        box("kneeHollow" + side, V(2.2 * sx, 1.3, HIP - 10.6), 1.2, 0.45, 1.0, "shin" + side, MAT_WAX_LO)
        box("shinCuff" + side, V(2.2 * sx, 0, 5.6), 1.45, 1.45, 1.1, "shin" + side, MAT_IRON)

    # --- a two-step bell shroud. The upper mass carries the wax body; the narrower lower mass
    # exposes both feet and makes the taper readable in solid black rather than through colour.
    box("shroudUpper", V(0, 0, HIP - 5.0), 3.8, 8.0, 4.0, "pelvis", MAT_SHROUD)
    box("shroudLower", V(0, 0.3, HIP - 10.2), 3.4, 6.5, 2.6, "pelvis", MAT_SHROUD)
    box("shroudHem", V(0, 0.3, HIP - 13.1), 3.45, 6.55, 0.7, "pelvis", MAT_OUT_CLTH)

    # --- THE CROOK: an iron shepherd's crook fused to the spine. A closed RING above the crown —
    # stem up the nape, a top bar reaching forward, a front bar descending to the hook tip, and a
    # dark bottom bar closing the eye. The ~11x4px of void trapped inside is a CLOSED HOLE in the
    # silhouette, and no other actor owns one (the hero's split crest is an open notch at the top
    # edge, the Hoplite's hook is an over-shoulder mass, the Empusa's is a legless wedge).
    #
    # NO GATE CAN SEE IT: `components` in tools/art/gates.ts counts opaque ISLANDS, and a hole is not
    # an island. It is verified by reading the 1x black test, nine frames, and that is the first thing
    # to check. If the hole has closed, thicken the bars and reopen it before judging anything else.
    box("crookStem", V(0, 3.5, HIP + 16.0), 0.9, 1.0, 8.0, "crook", MAT_IRON)
    box("crookTop", V(0, -3.0, HIP + 23.0), 0.9, 7.5, 1.0, "lampArm", MAT_IRON)
    box("crookFront", V(0, -9.5, HIP + 20.5), 0.9, 1.0, 3.5, "lampArm", MAT_IRON)
    # The eye. A FIRST pass built this as one 11x4px slot spanning the whole arm, and the 1x black
    # test read it as a placard held overhead rather than as a hook: the hole was right, the
    # proportion was not. Kept small and set back against the stem, the arm reads as a lamp bracket
    # and the void still measures 6.5 x 3 px against the >= 3x3 minimum.
    box("crookEyeFloor", V(0, -0.75, HIP + 17.0), 0.85, 3.25, 1.0, "lampArm", MAT_IRON_CREV)
    box("crookEyeFront", V(0, -4.5, HIP + 20.0), 0.85, 0.5, 2.0, "lampArm", MAT_IRON)
    box("crookSpec", V(0, -3.0, HIP + 24.1), 0.6, 3.0, 0.35, "lampArm", MAT_IRON_SP)

    # --- the lamp: a 6x6px dead cage on a short chain, at the PROJECTED position of the sim's own
    # bolt origin — e.radius + 4 = 9 world px along the aim (src/sim/enemies/caster.ts:116). Keeping
    # the cage beside the chest makes the crook a hanger, not a second body-height rectangle.
    box("lampChain", V(0, -9.5, HIP + 13.0), 0.5, 0.5, 4.0, "lamp", MAT_IRON)
    box("lampCage", V(0, -9.5, HIP + 6.0), 1.5, 3.2, 3.0, "lamp", MAT_IRON)
    box("lampBack", V(0, -6.2, HIP + 6.0), 1.3, 0.4, 2.6, "lamp", MAT_IRON_CREV)
    box("lampRim", V(0, -9.5, HIP + 8.8), 1.0, 2.6, 0.3, "lamp", MAT_IRON_SP)
    box("lampPane", V(0, -12.6, HIP + 5.9), 1.1, 0.35, 1.8, "lamp", MAT_GLASS)
    box("lampWick", V(0, -11.0, HIP + 7.2), 0.4, 0.4, 0.4, "lamp", MAT_WAX_HI)
    box("lampFoot", V(0, -9.5, HIP + 2.8), 1.4, 2.8, 0.4, "lamp", MAT_OUT_IRON)

    marker("feetCenter", V(0, 0, -2.2), "feetCenter")
    marker("lamp", arm.matrix_world @ V(0, -9.5, HIP + 6.0), "lamp")

    # ---- poses. Sim states are idle / position / aim / recover / stagger / dead. The light key is
    # unchanged from the rig — do not re-aim the sun.
    BASE = [("R", "spine", "X", -4), ("R", "head", "X", 20)]

    def legs(front, back, fr=0, bk=0):
        """Thigh swing in degrees (NEGATIVE X = forward, matching the hero's run cycle) plus shin
        bends. Left/right is invisible in east — it is depth — so the stance that reads is the
        fore/aft one, which is why the legs are posed about X and never about Y."""
        return [("R", "thighR", "X", front), ("R", "shinR", "X", fr),
                ("R", "thighL", "X", back), ("R", "shinL", "X", bk)]

    POSES = {
        # At rest a closed vertical line whose only asymmetry is the forward crook. Nothing in the
        # silhouette says danger yet.
        "idle": BASE + legs(-7, 4, 6, 3) + [("T", "pelvis", (0, 0, -0.4))],
        # 30-40 px/s. The lamp swings OPPOSITE the travel and the crook counter-rotates, so her
        # direction is readable from the lamp one frame before the legs say it. Two cells is the whole
        # walk — a 30 px/s strafe does not earn four.
        "strafeA": BASE + legs(-24, 16, 20, 6) + [
            ("R", "crook", "X", -3), ("R", "lamp", "X", 10), ("T", "pelvis", (0, 0, -0.9)),
        ],
        "strafeB": BASE + legs(18, -22, 8, 22) + [
            ("R", "crook", "X", 3), ("R", "lamp", "X", -9), ("T", "pelvis", (0, 0, -1.1)),
        ],
        # MOTION STOPS. Both heels down for the only time on the sheet, lamp dead still and plumb,
        # head lifts. Read this frame TEMPORALLY: two heels dropping is 2px and would not survive
        # downscale on its own, but a swinging lamp going still is unmistakable at any scale.
        "settle": BASE + legs(-3, 2, 2, 2) + [("R", "head", "X", -4), ("T", "pelvis", (0, 0, 0.2))],
        # §6.7's ANNOUNCE, 24 ticks before contact against a 12-tick minimum. The ENTIRE column
        # changes shape, so the windup reads in solid black across the room.
        "aimRise": BASE + legs(-12, 9, 12, 5) + [
            ("R", "crook", "X", 18), ("R", "spine", "X", -6), ("R", "lamp", "X", -7),
            ("T", "pelvis", (0, 0, -1.1)),
        ],
        # From casterLockTick() = round(24 * 0.66) = tick 16: the tick the angle stops tracking you.
        # Crook at full forward, trailing leg straight and locked, head UP for the only time here.
        # The pose says committed because the sim IS committed; the last third is yours to cross.
        "aimLock": BASE + legs(-16, 13, 4, 0) + [
            ("R", "crook", "X", 30), ("R", "spine", "X", -7), ("R", "head", "X", -26),
            ("R", "lamp", "X", -2), ("T", "pelvis", (0, 0, -1.2)),
        ],
        # A RECOVER frame, not an aim frame: the sim fires at stateTick >= aimTicks and switches to
        # 'recover' in the same tick, so an aim-state release pose would never be displayed for a
        # single tick. The only backward recoil in the roster — the shot knocks her off her own line.
        "release": BASE + legs(-9, 16, 10, 2) + [
            ("R", "crook", "X", -6), ("R", "spine", "X", -12), ("R", "pelvis", "X", -5),
            ("R", "lamp", "X", 8), ("T", "pelvis", (0, 0.9, -0.6)),
        ],
        # The pendulum keeps moving after she has stopped, which is what makes a top-heavy vertical
        # mass read as heavy rather than as a stick.
        "recover": BASE + legs(-6, 7, 8, 4) + [
            ("R", "crook", "X", 7), ("R", "head", "X", 8), ("R", "lamp", "X", -8),
            ("T", "pelvis", (0, 0, -0.8)),
        ],
        # The column TOPPLES toward the cut: legs trail behind the hips, the crook swings past
        # vertical, the lamp overshoots outside the body contour. No other actor can topple, because
        # none of them is a pole — the 0.60 centre of gravity and the punish mechanic are one idea.
        # There is no death frame: presenter.ts shatters whatever texture is on screen on 'kill', so
        # `hurt` IS the frame that shatters, and it is drawn to shatter well.
        "hurt": BASE + [
            ("R", "pelvis", "X", -16), ("R", "spine", "X", -14), ("R", "head", "X", -18),
            ("R", "crook", "X", -22), ("R", "lamp", "X", 18),
            ("R", "thighR", "X", 26), ("R", "shinR", "X", 30),
            ("R", "thighL", "X", 34), ("R", "shinL", "X", 22),
            ("T", "pelvis", (0, 2.2, -1.6)),
        ],
    }
    FRAME_ORDER = ["idle", "strafeA", "strafeB", "settle", "aimRise",
                   "aimLock", "release", "recover", "hurt"]
    SOCKETS = {f: ["lamp"] for f in FRAME_ORDER}
    SHEET = {
        "cell": 64, "cols": 3, "rows": 3, "mirror": True,
        "palette": ["mortar", "grout", "woodLo", "sky", "iron", "ironHi", "slateHi",
                    "ashField", "ashFieldLit", "boneLo", "boneDim", "bone"],
        "colourPlacement": "caster",
        "sockets": SOCKETS,
        "clips": {
            "strafe": {"frames": ["strafeA", "strafeB"], "timing": "ticks",
                       "ticks": [6, 6], "loop": True},
            # `ref: "caster"` resolves against tuning.caster's own `aimTicks` window. NO contact key:
            # that window has no `active` phase, and compile.ts rejects a contact asserted against a
            # window with nothing live — honest anyway, since the bolt is a projectile, not an arc.
            "aim": {"frames": ["aimRise", "aimLock", "release", "recover"],
                    "timing": "sim", "sim": {"ref": "caster"}},
        },
    }

# ================================================================= THE EMPUSA (sim kind `charger`)
# One shorn bronze limb, severed at the hip, that hovers, folds at the knee, and kicks. The only
# actor in the roster with no head, no face, no eye, and no foot on the ground. A dead-level straight
# chord is the only non-lumpy contour in the cast, and a knee is the most legible coil a 17px
# silhouette can hold: the freeze and the commit are ONE JOINT ANGLE, not an ornament that has to
# survive downscale. It is also the literal myth — the Empusa's one brazen leg.
if ACTOR == "charger":
    HOVER = 8.0           # shin centreline height. A HOVER height, not a leg length.

    MAT_BRASS = make_mat("brass", canon_srgb("#7A5E30"))      # -> naveWarm (shadow) / coinBrass (lit)
    #   The First Gate's own canon colour (§9.0 'Coin brass'), and the largest opaque area on the
    #   actor is also the edge that hits you: the bright thing is the part that touches you.
    MAT_IRON = make_mat("iron", canon_srgb("#393942"))        # -> iron / ironHi. The thigh stub: the
    #   dark aft end is what says the limb was CUT. No hole is needed to say it.
    MAT_BONE = make_flat("boneFlat", canon_srgb("#90806C"))   # -> boneDim, FLAT. The knee knuckle.
    #   Flat, not shaded, for the reason mannequin.py already records: a shaded warm lane leaks
    #   across boneLo / goldDim / boneDim / gold at every exposure.
    MAT_BONEHI = make_flat("boneHi", canon_srgb("#D0C0A8"))   # -> bone, FLAT. A cap on the knuckle's
    #   NORTH (key) face and NOWHERE else — two flat steps of one family with the bright one south is
    #   the familyLightScore landmine. ~1% of opaque against the 25% sprite b5 cap.
    MAT_SLIT = make_flat("slitFlat", canon_srgb("#0A0C12"))   # -> mortar. 1px contour on the iron.

    bpy.ops.object.mode_set(mode="EDIT")
    bone("root", V(0, 2, 0), V(0, 5, 0))
    # feetCenter stays at the ORIGIN and is never posed, so the pivot, the feetY sort and the shadow
    # ellipse need no code change, and the dash clip's foot-pivot spread is 0 BY CONSTRUCTION — no
    # `grounded: false` exemption is needed for a body that never touches the ground.
    bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
    # REST IS THE LUNGE: hip stub aft, knee at the back of the travel axis, one long shin running
    # dead level forward, heel wedge at the tip. Every other frame is that chord rotated UP about the
    # knee, so the coil is one joint angle and nothing else on the body moves.
    bone("hipStub", V(0, 12.0, HOVER + 0.4), V(0, 7.5, HOVER), "root")
    bone("shinC", V(0, 7.5, HOVER), V(0, -9.0, HOVER - 0.8), "hipStub")
    bone("heelC", V(0, -9.0, HOVER - 0.8), V(0, -13.0, HOVER - 2.6), "shinC")
    bpy.ops.object.mode_set(mode="OBJECT")

    limb("thighStub", "hipStub", 1.4, MAT_IRON, fat=1.0)
    box("hipCut", V(0, 12.3, HOVER + 0.5), 1.3, 0.45, 1.3, "hipStub", MAT_SLIT)
    # THE KNEE KNUCKLE, and it is a SHAPE, not a colour: it survives the black test with zero pixels
    # of material information. A convex knob riding on TOP of the limb's rear third, breaking the top
    # contour above the shin plate. It sits at the BACK of the travel axis on purpose — the eye is
    # never invited forward to look for a face, and knob-behind / taper-ahead states facing in one
    # frame of solid black. The hook is also the thing that MOVES: at coilLock it rises while the
    # body narrows and drops, so the same pixels carry the identity AND the telegraph.
    sphere("knuckle", V(0, 8.2, HOVER + 4.2), 2.0, 2.5, 2.7, "hipStub", MAT_BONE)
    box("knuckleCap", V(0, 8.2, HOVER + 6.3), 1.4, 1.8, 0.4, "hipStub", MAT_BONEHI)
    # MEASURED CORRECTION to the spec, which asks for a BOX here ("a plate, not a sausage") on the
    # grounds that flat faces quantize cleanly. They quantize too cleanly: a box's camera-facing side
    # is ONE surface orientation, so it renders at ONE k and lands on ONE canon name. The first
    # compile measured coinBrass at 71.2% of opaque and naveWarm at 0.1% — a flat brass blob with no
    # terminator at all, which is the §2.4 material read the two-step lane exists to buy. A cylinder
    # gradates across its camera-facing surface and splits at the lane's own terminator, and it costs
    # the silhouette NOTHING: a cylinder laid along an axis still projects as a straight-edged bar,
    # so the dead-level leading chord survives intact. The heel stays a flat wedge.
    limb("shinPlate", "shinC", 1.9, MAT_BRASS, fat=1.0)
    limb("heelWedge", "heelC", 1.7, MAT_BRASS, fat=1.0, plate=True, hz=1.3)
    box("shinLip", V(0, -1.0, HOVER + 1.5), 1.6, 5.5, 0.3, "shinC", MAT_BRASS)

    marker("feetCenter", Vector((0, 0, 0)), "feetCenter")
    marker("heel", arm.matrix_world @ V(0, -11.0, HOVER - 1.0), "heelC")

    def knee(elev, heel=0, hover=0.0, pitch=0.0):
        """`elev` is the shin chord's ELEVATION above the level lunge, in degrees — the one joint
        angle that is the whole animation. Rotating about X by -elev lifts the heel back and up.

        CORRECTION TO THE SPEC, measured rather than argued: the spec's interior-knee-angle labels
        (118 idle / 62 coilLock / 172 lunge) are not reproducible against its own bbox table. A
        two-segment chain bent 62deg off straight is a near-vertical limb, and the first render of
        those numbers measured 10x18 at coilDraw where the design asks for 19x15 — taller than wide,
        which inverts the actor's whole proportion claim. The bboxes are the design intent and the
        angle labels were the approximation, so this poses by elevation and HOLDS THE BBOX TABLE
        (and the air-gap channel, which is the other measurable the design hangs on).
        """
        return [("R", "hipStub", "X", pitch), ("R", "shinC", "X", -elev),
                ("R", "heelC", "X", heel), ("T", "hipStub", (0, 0, hover))]

    POSES = {
        # A bronze shin with a bone knob, floating. Authored distinct from hoverA by the heel drop so
        # the `duplicate-frames` gate cannot fire on a byte-identical pair.
        "idle": knee(33, heel=-8, hover=0.0),
        # Two cells buy the orbit its life; the sim already circles at orbitSpeed 1.6. No banking
        # roll: a roll about the travel axis projects to nothing in an east-only profile, so it is
        # animation that costs a frame and shows zero pixels.
        "hoverA": knee(30, heel=-14, hover=0.6),
        "hoverB": knee(24, heel=-26, hover=2.0),
        # The window where aimAngle still tracks the player: the limb is still turning.
        "coilDraw": knee(42, heel=10, hover=-0.6),
        # THE frame the design hangs on, entered at exactly chargerLockTick() = freezeTicks 16 -
        # commitLead 9 = 7. The telegraph is a body that gets SMALLER, where every other actor in the
        # roster telegraphs by getting BIGGER. Two measurable channels: the width drops ~20%, and the
        # whole body DROPS toward the floor, closing the air gap it has been advertising.
        "coilLock": knee(64, heel=26, hover=-2.0),
        # Never dead flat: a perfectly straight limb reads as a stick, and 4deg keeps one contour
        # break. One frame held for all 30 dash ticks; the afterimages and 2.7 px/tick of real travel
        # carry the rest. The longest, flattest frame any actor in this game owns.
        "lunge": knee(4, heel=-4, hover=0.2),
        # It overshot. The punish window drawn as a POSTURE, not as a pause: the lowest the body ever
        # sits while alive.
        "skid": knee(34, heel=-30, hover=-3.0),
        # hp is 2, so this is almost always the last frame it is alive in — authored already broken.
        # The one frame where the brightest mass is not the topmost pixel.
        "hurt": knee(74, heel=40, hover=-4.0, pitch=14),
    }
    FRAME_ORDER = ["idle", "hoverA", "hoverB", "coilDraw", "coilLock", "lunge", "skid", "hurt"]
    SOCKETS = {f: ["heel"] for f in FRAME_ORDER}
    SHEET = {
        "cell": 36, "cols": 4, "rows": 2, "mirror": True,
        "palette": ["mortar", "iron", "ironHi", "naveWarm", "coinBrass", "boneLo", "boneDim", "bone"],
        "sockets": SOCKETS,
        "clips": {
            # NO contact key: tuning.charger has no `active` phase and compile.ts rejects a contact
            # asserted against a window with none. Honest anyway — the dash hurts by BODY OVERLAP
            # (src/sim/enemies/charger.ts:47-49), not by an arc.
            "dash": {"frames": ["coilDraw", "coilLock", "lunge", "skid"],
                     "timing": "sim", "sim": {"ref": "charger"}},
        },
    }

# ---------------------------------------------------------------- camera + light
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = CANVAS
cam_data.clip_end = 1000
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.rotation_euler = (pi / 2 - PITCH, 0, 0)
d = Vector((0, cos(PITCH), -sin(PITCH)))
up = Vector((0, sin(PITCH), cos(PITCH)))
CAM_RIGHT = Vector((1, 0, 0))


def place_camera(feet_row, origin_x):
    """Aim the ortho window so the world origin projects at art-px (origin_x, feet_row)."""
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
bpy.context.view_layer.update()


# ---------------------------------------------------------------- pose machinery (mannequin.py)
def reset_pose():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def apply_ops(ops):
    """ops applied in order, parent-first:
      ('R', bone, axis, deg)  rotation about an armature-space axis through the bone's current head
      ('T', bone, (x, y, z))  armature-space translation"""
    for op in ops:
        pb = arm.pose.bones[op[1]]
        piv = pb.matrix.translation.copy()
        if op[0] == "R":
            rot = (Matrix.Translation(piv) @ Matrix.Rotation(radians(op[3]), 4, op[2])
                   @ Matrix.Translation(-piv))
            pb.matrix = rot @ pb.matrix
        else:
            pb.matrix = Matrix.Translation(Vector(op[2])) @ pb.matrix
        bpy.context.view_layer.update()


# ---------------------------------------------------------------- render + export
FACING_ROT = {"south": 0.0, "north": pi, "east": pi / 2}
os.makedirs(OUT, exist_ok=True)
only = set(ONLY.split(",")) if ONLY else None
rig = {"px": PX, "canvas": CANVAS, "scale": PX / CANVAS, "pitchDeg": math.degrees(PITCH),
       "feetRow": FEET_ROW, "actor": ACTOR, "frameOrder": FRAME_ORDER, "sheet": SHEET,
       "sunEnergy": SUN_ENERGY, "ambientStrength": AMBIENT_STRENGTH, "facings": {}}

for facing in FACINGS:
    arm.rotation_euler = (0, 0, FACING_ROT[facing])
    os.makedirs(os.path.join(OUT, facing), exist_ok=True)
    rig["facings"][facing] = {"frames": {}}
    for fname in FRAME_ORDER:
        if only and fname not in only:
            continue
        # ONE feet_row for every frame, so the projected feetCenter — and therefore every declared
        # pivot — is identical across the sheet and the planted-feet gate passes with spread 0.
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
                print(f"[cc] FIT WARNING {facing}/{fname}: {mname} at art-px ({ax:.1f}, {ay:.1f})")
        scene.render.filepath = os.path.join(OUT, facing, fname + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"[cc] rendered {ACTOR} {facing}/{fname}")

rig_path = os.path.join(OUT, "rig.json")
if only and os.path.exists(rig_path):
    with open(rig_path) as f:
        merged = json.load(f)
    for facing, fd in rig["facings"].items():
        merged.setdefault("facings", {}).setdefault(facing, {"frames": {}})["frames"].update(fd["frames"])
    merged["sheet"] = SHEET
    rig = merged
with open(rig_path, "w") as f:
    json.dump(rig, f, indent=2)
print(f"[cc] rig registration -> {rig_path}")

if SAVE_BLEND:
    os.makedirs(os.path.dirname(SAVE_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE_BLEND))
    print(f"[cc] saved {SAVE_BLEND}")
