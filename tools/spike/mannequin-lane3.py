# The WARDEN, the OATH-BOUND and the KIT as rigged Blender scenes, rendered headless.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio --factory-startup \
#     --python-exit-code 1 --python tools/spike/mannequin-lane3.py -- \
#     --actor warden|oathbound|dummy --out .art-cache/actors/<a>/renders [--px 512]
#
# SIBLING FILE ON PURPOSE, and this one is not a preference. tools/spike/mannequin.py IS the Veteran:
# it hardcodes CANVAS 64, FEET_ROW 60, HIP_Z 13.5 and authors the identity anchors (split crest,
# visor, wine garment, gold marks) UNCONDITIONALLY on the base body, and `pnpm art:stress-hero`
# byte-compares three regenerated exhibits against committed PNGs. A flag on that file would edit a
# shared code path while the hero is being judged. Nothing here can change a hero pixel.
# (tools/spike/mannequin-actors.py is a PARALLEL sibling owned by the caster/charger lane. Same
# contract, different actors, no shared state — deliberately not one file two agents edit at once.)
#
# Run `pnpm exec tsx tools/spike/lanes-lane3.mjs` BEFORE this script. Each actor declares its OWN
# ramp, so a lane that is pure against the hero's 15 names can still leak against a 9-name subset:
# `nearestIndex` votes over the declared subset, not over canon.
#
# THE PROJECTION RULE, identical to the hero rig and the source of every number below. `V()`
# pre-stretches z by F = 1/cos(20 deg), so a point's screen height in ART PIXELS above the ground
# line is exactly:
#     SOUTH  z + 0.342*y      NORTH  z - 0.342*y      EAST  z + 0.342*x     (authored coords)
# and screen-x is  SOUTH x,  NORTH -x,  EAST -y.  The character faces -Y; +X is its right.
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
        sys.exit(f"[lane3] {name} needs a value")
    return argv[i + 1]


ACTOR = arg("--actor", "")
if ACTOR not in ("warden", "oathbound", "dummy"):
    sys.exit(f"[lane3] --actor must be warden, oathbound or dummy (got {ACTOR!r})")
OUT = arg("--out", f".art-cache/actors/{ACTOR}/renders")
PX = int(arg("--px", "512"))
SAVE_BLEND = arg("--save-blend", "")
ONLY = arg("--only", "")

# ---------------------------------------------------------------- per-actor canvas
# ART_DIRECTION §4.1's ladder, applied by MEASURED motion envelope rather than by category:
#   warden     72 — a miniboss whose whole thesis is that nothing rises above the shoulder line, so
#                   it has no tall envelope to pay 96 for. Side effect worth having: the death
#                   shatter drops to 36*36*0.65 = 842 chips against a pool max of 1500
#                   (src/render/particles.ts:36), where cell 96 spawns 1498 — one warden death would
#                   consume the entire budget.
#   oathbound  64 — the brute's own cell, because it replaces the brute's own sheet.
#   dummy      64 — mannequin.py's own constant, so the camera and ortho scale need no new solve.
CANVAS = 72 if ACTOR == "warden" else 64
FEET_ROW = 66 if ACTOR == "warden" else 60
PITCH = radians(20)
# The MEASURED exposure pair (mannequin.py:65-88). Do NOT move it for an actor: below the band a body
# sits on its shadow step and fails ground-separation as a HARD gate; above it `familyLightScore` —
# a sign test on a two-step form — flips on one-pixel differences in mean row.
SUN_ENERGY = float(arg("--sun", "1.07"))
AMBIENT_STRENGTH = float(arg("--ambient", "1.75"))
AMBIENT_COLOR = (0.75, 0.75, 0.75)
SUN_PITCH = float(arg("--sun-pitch", "20"))
SUN_YAW = float(arg("--sun-yaw", "-12"))
F = 1.0 / cos(PITCH)

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
    """An UNSHADED mark: the canon colour, emitted, with nothing for the light to do to it. The
    compiler has no material channel, so a material only owns a ramp while its own rendered range
    does not overlap another material's — which is what makes bone and gold flat marks rather than
    shaded lanes (canon's warm luminance steps interleave)."""
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


# Every base hex below is swept by tools/spike/lanes-lane3.mjs against THIS actor's declared ramp.
MAT_IRON = make_mat("iron", canon_srgb("#393942"))
MAT_STEEL = make_mat("steel", canon_srgb("#A8AFBE"), rough=0.45, spec=0.12)
# The leaf's FIELD, one grade under MAT_STEEL and the same family. MEASURED: the whole leaf in
# MAT_STEEL took b5-mass to 43.2% against the 25% sprite cap, because brickHi is B5 (0.7597) and a
# lit tower leaf is the largest mass on the actor. Sweeps brickLo@0.80-0.89 / brick@0.895-1.15, so
# the field never reaches B5 and the leaf's only B5 is its 2px rim.
# The leaf FIELD is a FLAT mark, not a shaded lane, and that is the value pass the review asked
# for. Shaded, it spanned brickLo AND brick across the largest mass on the actor, which is what
# made the Oath-Bound the brightest object in the game (mean luminance 0.2231 against the
# hero's 0.1031 — an enemy out-reading the player inverts ART_DIRECTION SS3). Flat at brickLo it
# keeps the plate read and hands the sheet's bright line back to the steel rim, which is what
# the rim was authored to be. Bone and gold are flat marks here for the same reason.
# The leaf FIELD is a FLAT mark, not a shaded lane, and that is the value pass the review asked for.
# Shaded, it spanned brickLo AND brick across the largest mass on the actor, which is what made the
# Oath-Bound the brightest thing in the game and inverted ART_DIRECTION SS3's hierarchy, where the
# hero is the brightest read on the floor. Flat at brickLo it keeps the plate read and hands the
# sheet's bright line back to the steel rim, which is what the rim was authored to be. Bone and gold
# are flat marks here for the same reason.
#
# MEASURED, both ways, on this lane: sheet median mean-luminance falls 0.4122 -> 0.3774, an 8.4% cut,
# with 78/78 gates still green and zero waivers. It does NOT finish the job — the actor is still
# brighter than the hero, and closing that gap needs the leaf below brickLo, which the palette lanes
# will not allow without restructuring them (ironHi is the iron family's, and slate/nave belong to
# the floor and to the Judge). That is a design pass, not a value pass, and it is not done here.
MAT_PLATE = make_flat("plate", canon_srgb("#767E8E"))
MAT_BLADE = make_mat("blade", canon_srgb("#C0C6D4"), rough=0.45, spec=0.12)
MAT_WINE = make_mat("wine", canon_srgb("#8A3A4C"))
MAT_WINE_DARK = make_flat("wineDark", canon_srgb("#2A0E1C"))
MAT_BONE = make_flat("boneFlat", canon_srgb("#90806C"))
MAT_GOLD = make_flat("goldFlat", canon_srgb("#D4B060"))
MAT_SLIT = make_flat("slitFlat", canon_srgb("#0A0C12"))
MAT_VISOR = make_flat("visorFlat", canon_srgb("#12141C"))
# The Judge's own stone. NAVE, not slate: canon gives nave the role "make one area read as a
# different quarry", and slate IS the floor he stands on — dressing a boss in the ground he stands
# on is the separation failure this choice exists to avoid. Measured: nave1@0.80-1.07, nave2@1.075+.
MAT_WSTONE = make_mat("wstone", canon_srgb("#505A68"))
MAT_WSTONE_DARK = make_flat("wstoneDark", canon_srgb("#343C4C"))
MAT_MASK_LO = make_flat("maskLo", canon_srgb("#5A4E42"))
MAT_MASK = make_flat("mask", canon_srgb("#90806C"))
MAT_MASK_HI = make_flat("maskHi", canon_srgb("#D0C0A8"))


def V(x, y, z):
    return Vector((x, y, z * F))


# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new(ACTOR)
arm = bpy.data.objects.new(ACTOR, arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")


def bone(name, head, tail, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b


HIP_Z = 0.0


def build_bones_humanoid(leg_scale):
    """The Veteran armature, copied verbatim so the Oath-Bound inherits its solved projection.
    HIP_Z is the only proportion lever, exactly as `--leg-scale` is on the hero."""
    global HIP_Z
    LS = leg_scale
    HIP_Z = 13.5 * LS
    HZ = HIP_Z
    bone("root", V(0, 2, 0), V(0, 5, 0))
    bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
    bone("pelvis", V(0, 0, HZ), V(0, 0, HZ + 4), "root")
    bone("spine", V(0, 0, HZ + 4), V(0, 0.3, HZ + 10), "pelvis")
    bone("chest", V(0, 0.3, HZ + 10), V(0, 0, HZ + 13), "spine")
    bone("head", V(0, -1, HZ + 13), V(0, -2.8, HZ + 19.5), "chest")
    for side, sx in (("R", 1), ("L", -1)):
        bone("thigh" + side, V(2.9 * sx, 0, HZ), V(3.2 * sx, 0, HZ - 6.5 * LS), "pelvis")
        bone("shin" + side, V(3.2 * sx, 0, HZ - 6.5 * LS), V(3.2 * sx, 0, 1.6), "thigh" + side)
        bone("foot" + side, V(3.2 * sx, 0, 1.6), V(3.2 * sx, -3.8, 0.7), "shin" + side)
        bone("upperArm" + side, V(5.0 * sx, -0.3, HZ + 11.1), V(5.9 * sx, -1.2, HZ + 4.5), "chest")
        bone("foreArm" + side, V(5.9 * sx, -1.2, HZ + 4.5), V(6.1 * sx, -2.2, HZ - 0.7), "upperArm" + side)
        bone("hand" + side, V(6.1 * sx, -2.2, HZ - 0.7), V(6.1 * sx, -2.6, HZ - 3.3), "foreArm" + side)


if ACTOR == "warden":
    # NOT a humanoid: a building. The piers hang off ROOT, not off the pelvis, so the upper mass can
    # rise and fall — the void IS the charge meter — while the plinths stay planted on the floor.
    # The piers overstand the resting hem underside by 6 units, so even the biggest lift never opens
    # a gap: connectivity stays 1 component against the hard cap of 3.
    bone("root", V(0, 2, 0), V(0, 5, 0))
    bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
    bone("pelvis", V(0, 0, 20), V(0, 0, 24), "root")
    bone("chest", V(0, 0, 24), V(0, 0, 36), "pelvis")
    bone("shoulder", V(0, 0, 36), V(0, 0, 43), "chest")
    bone("lintelB", V(0, 0, 43), V(0, 0, 50), "shoulder")
    bone("head", V(0, -1, 38), V(0, -1, 46), "chest")
    for side, sx in (("R", 1), ("L", -1)):
        bone("pier" + side, V(16.0 * sx, 0, 20), V(16.0 * sx, 0, 0), "root")
        bone("upperArm" + side, V(15.0 * sx, 0, 41), V(17.0 * sx, 0, 34), "shoulder")
        bone("foreArm" + side, V(17.0 * sx, 0, 34), V(19.0 * sx, 0, 28), "upperArm" + side)
elif ACTOR == "oathbound":
    # `--leg-scale 1.10` baked in: HIP_Z 14.85. With the split crest deleted the helm crown tops out
    # at HZ + 19.0 plus a 2.0 sealed ridge, so the standing body lands ~3px under §4.1's 40px body
    # cap and the sheet needs ZERO height waivers on any cell — against the brute's three.
    build_bones_humanoid(1.10)
else:
    # The Kit has no body. Two bones do the whole job: `stack` carries the 5 deg lean, `hook` carries
    # the helm and its strap so ONLY the hung things move between the two cells.
    bone("root", V(0, 2, 0), V(0, 5, 0))
    bone("feetCenter", V(0, 0, 0), V(0, -3, 0), "root")
    bone("stack", V(0, 0, 0), V(0, 0, 8), "root")
    bone("hook", V(5.3, 0, 27.4), V(7.2, 0, 19.6), "stack")

bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- mesh helpers (mannequin.py, verbatim)
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


def limb_cyl(name, bone_name, r, mat, fat=1.15):
    b = arm_data.bones[bone_name]
    head = arm.matrix_world @ b.head_local
    tail = arm.matrix_world @ b.tail_local
    d = tail - head
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=r, depth=d.length * fat, location=(head + tail) / 2)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
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


# ================================================================= WARDEN — the gate that walks
if ACTOR == "warden":
    # THE ARCH IS TRANSPARENT AND THAT IS THE ONE THING NOT TO GET WRONG. Alpha 0 between the piers:
    # no inner face, no soffit, no back wall, no MAT_SLIT fill. §4.2 fills the sprite with solid
    # black, so an opaque dark interior turns black too and the hook dies in the exact test it exists
    # to win. NOTHING BELOW SPANS x in (-6, +6) UNDER z 20.
    # The plinths are the DARK step, and that is measured rather than chosen. As lit MAT_WSTONE
    # their big horizontal top faces put ~130px of the family's BRIGHTEST step at floor level, which
    # is half of why light-direction measured +0.68..+0.95 against the +0.35 cap on all 13 frames.
    # Dark stone at the contact line is also the correct drawing.
    box("plinthR", V(17.0, 0, 1.0), 11.0, 5.2, 1.0, "root", MAT_WSTONE_DARK)
    box("plinthL", V(-17.0, 0, 1.0), 11.0, 5.2, 1.0, "root", MAT_WSTONE_DARK)
    for _s, _sx in (("R", 1), ("L", -1)):
        # Pier: x 6..26, z 0..20. Inner face at |x| = 6 -> a 12px void. It overstands the resting hem
        # underside (z 14) by 6 so the biggest pelvis lift still leaves the mass ONE component.
        box("pier" + _s, V(16.0 * _sx, 0, 10.0), 10.0, 4.5, 10.0, "pier" + _s, MAT_WSTONE)
        # Material-dark backing — the capeShadow mechanism from the hero rig. It GUARANTEES §4.3.3's
        # 1px outline round the pier instead of hoping shading produces one.
        #
        # TWO RULES EVERY BACKING PLATE ON THIS BODY OBEYS, both bought with a failed compile.
        #  (1) CENTRED IN Y, never offset behind. Offset +y made the plates the first surface the
        #      NORTH camera sees: the whole north sheet came back mortar at Weber -0.55 on all 14
        #      frames while south passed 137/137.
        #  (2) NEVER PROUD IN +Z. A plate taller than its body shows its own TOP FACE under a 20 deg
        #      top-down camera — 1137px of mortar, half the north drawing. §4.3.3 puts the outline on
        #      the contour AWAY from the key anyway, so each plate matches its body's z-top exactly
        #      and is proud only at the sides and the bottom.
        box("pierEdge" + _s, V(16.0 * _sx, 0, 9.6), 10.8, 4.0, 10.0, "pier" + _s, MAT_SLIT)
    # Hem: 56px wide, z 14..20, overhanging each pier by 2px. That 2px step, faced dark underneath,
    # is the shadow line that says lintel-over-piers.
    box("hem", V(0, 0, 17.0), 28.0, 6.0, 3.0, "pelvis", MAT_WSTONE)
    box("hemUnder", V(0, -0.4, 14.4), 28.1, 5.7, 0.5, "pelvis", MAT_WSTONE_DARK)
    # The chest's own cast shadow on the hem top, drawn as geometry rather than left to the renderer.
    # MEASURED: from the north the hem's lit top face is 690px of nave2 — the family's BRIGHTEST step
    # — at meanY 51, low on the sheet, which is the whole of why north measured light-direction
    # +0.71..+0.88 while south passed 137/137 at -0.x. In south this band sits on the far side and is
    # mostly hidden behind the chest, so it costs that facing almost nothing.
    box("hemShadow", V(0, 3.6, 20.05), 28.0, 2.4, 0.2, "pelvis", MAT_WSTONE_DARK)
    box("shoulderShadow", V(0, 2.6, 43.05), 18.0, 2.0, 0.2, "shoulder", MAT_WSTONE_DARK)
    box("hemEdge", V(0, 0, 16.6), 28.5, 5.4, 3.0, "pelvis", MAT_SLIT)
    box("chest", V(0, 0, 28.0), 12.0, 5.0, 8.0, "chest", MAT_WSTONE)
    box("chestEdge", V(0, 0, 27.6), 12.6, 4.4, 8.0, "chest", MAT_SLIT)
    box("shoulderBlock", V(0, 0, 39.5), 18.0, 4.6, 3.5, "shoulder", MAT_WSTONE)
    box("shoulderEdge", V(0, 0, 39.1), 18.5, 4.0, 3.5, "shoulder", MAT_SLIT)
    # The lintel IS the shoulder line: a 36px bar, top at z 50 = standing height, dead level and
    # UNBROKEN. The exact inverse of the hero's split crest, which is the shape he is known by.
    box("lintel", V(0, -0.6, 46.5), 18.0, 4.0, 3.5, "lintelB", MAT_WSTONE)
    box("lintelEdge", V(0, -0.6, 46.1), 18.5, 3.4, 3.5, "lintelB", MAT_SLIT)
    # NO DARK BAND UNDER THE LINTEL. MEASURED on the staged reject: it put 36px of nave0 — the
    # family's darkest step — at meanY 22 while nave1 sat at 44 and nave2 at 43.5, and a dark step
    # NORTH of the bright ones is exactly what familyLightScore reads as bright-south. Dropping it
    # leaves nave0 as the hem underside alone, low on the sheet, where a shadow belongs.
    # The head is SUNK 3.5px below the lintel top, so the top contour stays one unbroken bar.
    # Contour and value are different channels: it is invisible in silhouette and still the
    # brightest thing on the body. That fixes the inversion measured on the hero's north sheet,
    # where his brightest pixels were his boots.
    box("head", V(0, -1.0, 42.0), 4.5, 3.4, 4.5, "head", MAT_WSTONE)
    box("recess", V(0, -3.4, 42.0), 5.2, 0.3, 5.0, "head", MAT_VISOR)
    box("maskPlate", V(0, -4.2, 42.6), 4.0, 0.4, 2.8, "head", MAT_MASK)
    box("maskLo", V(0, -4.3, 40.0), 4.0, 0.4, 0.9, "head", MAT_MASK_LO)
    # Pure `bone` is the lit upper-left rim ONLY: ~10px, well under the sprite b5-mass cap of 25%.
    # Three steps, because an 8x6 mark that is the eye's stop cannot jump boneLo->bone across two
    # bands with no midtone.
    box("maskHi", V(-1.7, -4.5, 44.7), 2.2, 0.35, 0.6, "head", MAT_MASK_HI)
    # THE JUDGMENT COURSE. §8.2.2 makes gold the threshold mark and §9.0 puts it on crossings only —
    # door frames, Charon's pole, Minos' beam. This actor IS the crossing. Segmented, because a
    # continuous highlight along a full edge reads as plastic (§2.4) and §8.2.4 wants it unfinished.
    for _i, _gx in enumerate((-7.0, 0.0, 7.0)):
        box(f"gold{_i}", V(_gx, -4.7, 47.4), 2.5, 0.4, 0.7, "lintelB", MAT_GOLD)
    # The nape block: the ONE place in the whole set where anything rises above the bar, and it is
    # the back of the head. North is therefore never a mirror of south.
    box("napeBlock", V(0, 2.8, 48.4), 4.5, 1.5, 1.3, "head", MAT_WSTONE)
    for _s, _sx in (("R", 1), ("L", -1)):
        limb_cyl("upperArmM" + _s, "upperArm" + _s, 2.5, MAT_WSTONE)
        limb_cyl("foreArmM" + _s, "foreArm" + _s, 2.2, MAT_WSTONE)
    marker("feetCenter", Vector((0, 0, 0)), "feetCenter")
    marker("mask", arm.matrix_world @ V(0, -4.6, 42.6), "head")

# ================================================================= OATH-BOUND — the gate, worn
elif ACTOR == "oathbound":
    HZ = HIP_Z
    # Base body: the Veteran's masses, ALL METAL. DELETED from the hero and not replaced — the whole
    # wine garment, MAT_BONE on both forearms, the face slit, the nape band, both crest tabs, the
    # cape sigil and the sash clasp. Wine cloth, a bone forearm and a split crest are the Veteran's
    # three §3 identity anchors; a shade wearing any of them reads as the hero from behind, which is
    # the single largest confusion risk in putting an enemy on the hero's rig. The two actors now
    # differ by MATERIAL SET, not only by shape.
    sphere("torsoBarrel", V(0, 0.4, HZ + 7.0), 5.0, 3.8, 6.2, "spine", MAT_IRON)
    sphere("chestCap", V(0, 0, HZ + 11.3), 4.7, 3.5, 3.1, "chest", MAT_IRON)
    box("pelvisBlock", V(0, 0, HZ + 1.6), 3.4, 2.6, 2.2, "pelvis", MAT_IRON)
    head_ball = sphere("headBall", V(0, -3.0, HZ + 16.0), 5.3, 5.5, 6.8, "head", MAT_IRON)
    head_ball.scale.x *= 0.76
    head_ball.scale.y *= 0.72
    head_ball.scale.z *= 0.44
    for side, sx in (("R", 1), ("L", -1)):
        sphere("deltoid" + side, V(5.0 * sx, -0.4, HZ + 10.7), 2.4, 2.5, 2.7, "upperArm" + side, MAT_IRON)
        limb_cyl("upperArmM" + side, "upperArm" + side, 1.8, MAT_IRON)
        limb_cyl("foreArmM" + side, "foreArm" + side, 1.6, MAT_IRON)
        sphere("handBall" + side, V(6.1 * sx, -2.4, HZ - 2.0), 1.5, 1.5, 1.9, "hand" + side, MAT_IRON)
        limb_cyl("thighM" + side, "thigh" + side, 2.1, MAT_IRON)
        limb_cyl("shinM" + side, "shin" + side, 1.7, MAT_IRON)
        box("footBox" + side, V(3.2 * sx, -1.7, 0.8), 1.6, 2.7, 0.8, "foot" + side, MAT_IRON)
        # The greave CAP is steel; the greave itself stays iron. Bright boots put the brightest
        # pixels on a character at floor level, which inverts §3's light hierarchy — the exact
        # defect measured on the hero's north sheet.
        box("greaveCap" + side, V(3.2 * sx, -0.4, 6.6), 2.0, 2.0, 0.6, "shin" + side, MAT_STEEL)
    box("fauld", V(0, -0.2, HZ - 0.2), 4.4, 2.9, 1.4, "pelvis", MAT_IRON)
    # Cuirass, and ONE continuous shoulder yoke where the Veteran has two pauldrons with a gap. The
    # yoke's shield-side end is 1.5 units longer, so even the yoke is not mirrored (§5.2, §10.19).
    box("cuirass", V(0, -0.9, HZ + 7.6), 5.2, 3.2, 5.0, "spine", MAT_STEEL, rot=(radians(-10), 0, 0))
    box("yoke", V(-0.75, -0.4, HZ + 11.4), 7.0, 3.2, 0.8, "chest", MAT_STEEL)
    # Helm: a steel dome over an iron skull, a visor plate covering the WHOLE front with NO slit —
    # the Oath-Bound has no face — and a low unbroken sagittal ridge, deliberately SEALED where the
    # hero's crest has a 4px void, capped at 2.0 units so it can never read as a crest and cannot
    # read as horns (the defect CHARACTER_HARD_CONSTRAINTS §9 records against the Veteran).
    box("helmCrown", V(0, -3.2, HZ + 17.0), 3.6, 3.7, 2.0, "head", MAT_STEEL)
    box("visorPlate", V(0, -6.5, HZ + 16.2), 3.0, 0.7, 3.0, "head", MAT_VISOR)
    box("helmRidge", V(0, -3.0, HZ + 19.4), 0.8, 3.9, 1.0, "head", MAT_IRON)
    # ---- THE SHIELD LEAF, parented to foreArmL so the POSE owns the guard state.
    # A Mycenaean tower leaf, deliberately NOT the round aspis: at 1x a disc is a blob, and it is the
    # shape §9.0 forbids for reading as House chrome.
    # THE 50 DEG YAW IS NOT TASTE. The character faces -Y, so a leaf held square to its facing has
    # its face normal along Y and collapses to its own 2-unit thickness in east — the failure that
    # already cost the hero its east crest. At 50 deg the leaf presents 17*sin50 + 2*cos50 = 14.3px
    # of face in east while the FORWARD edge stays a dead-straight vertical run, and a vertical line
    # is the ONE contour invariant under this camera's shear (screen height = z + 0.342x).
    LEAF_YAW = radians(50)
    LX, LY = -2.0, -8.6
    ca, sa = cos(LEAF_YAW), sin(LEAF_YAW)

    def leaf_at(dx):
        return (LX + dx * ca, LY + dx * sa)
    # Two boxes, so no CSG is needed (this rig only has box() and sphere()): an aft box at full
    # height and a forward box whose top is 4.0 units lower. THE STEP IS THE JOIN, and the step is
    # the silhouette hook — §8.2.4's missing crown block, worn by the thing that bars the gate.
    ax, ay = leaf_at(3.5)
    box("leafMain", V(ax, ay, 18.6), 5.0, 1.0, 12.2, "foreArmL", MAT_PLATE, rot=(0, 0, LEAF_YAW))
    fx, fy = leaf_at(-5.0)
    box("leafFwd", V(fx, fy, 16.6), 3.5, 1.0, 10.2, "foreArmL", MAT_PLATE, rot=(0, 0, LEAF_YAW))
    # THE HOOK IS ALSO THE BRIGHTEST LINE IN THE SHEET: a 2px MAT_STEEL rim along the FORWARD edge
    # and the TOP edge, and nowhere else on the leaf. So SS4.3.1's silhouette hook and SS3's light
    # hierarchy point at the same pixels — the pixels the player must break are the pixels the eye
    # lands on. UPPER HALF of the forward edge only: familyLightScore is a SIGN TEST on a two-step
    # form, and a bright step sitting south of its dark step is what trips light-direction.
    rx, ry = leaf_at(-8.0)
    box("leafRimFwd", V(rx, ry, 21.9), 0.7, 1.1, 5.0, "foreArmL", MAT_STEEL, rot=(0, 0, LEAF_YAW))
    tx, ty = leaf_at(3.5)
    box("leafRimTop", V(tx, ty, 30.2), 5.0, 1.1, 0.7, "foreArmL", MAT_STEEL, rot=(0, 0, LEAF_YAW))
    # The dark iron band and the gold mark sit on the CAMERA-FACING side, and getting that wrong cost
    # a whole render. The east facing rotates the armature +90 deg about Z, so an authored offset of
    # (sin50, -cos50) — the visible side in SOUTH — maps to world +y and ends up BEHIND the plate.
    # MEASURED on the compiled sheet: the actor's one gold mark rendered ZERO pixels in every frame.
    # A bright slab with no dark ground also reads as a man holding a sign rather than as a gate that
    # walks, so the band is load-bearing twice over. It is a narrow BOSS, not a face: at 14 units
    # wide the dark band measured ironHi 201px + iron 120px against brick 114px — it swallowed the
    # plate, cost the leaf its bright-steel read and flipped light-direction on `contact` to +0.42.
    ix, iy = leaf_at(-4.6)
    box("leafBoss", V(ix - 0.9 * sa, iy + 0.9 * ca, 17.4), 2.0, 0.5, 8.6, "foreArmL", MAT_IRON,
        rot=(0, 0, LEAF_YAW))
    # Oversized mortar backing: proud on every side and set behind. A MECHANISM for §4.3.3's
    # material-dark rim in every pose, not a hope that shading produces one.
    bx, by = leaf_at(0.5)
    box("leafEdge", V(bx + 1.3 * sa, by - 1.3 * ca, 18.1), 9.6, 0.8, 12.9, "foreArmL", MAT_SLIT,
        rot=(0, 0, LEAF_YAW))
    # EXACTLY ONE gold mark on the whole actor: 3x3px on the leaf's dark IRON inner face, off-centre
    # so the leaf is not a symmetric target. It sits on iron (Weber +3.6) and NEVER on brick, where
    # gold 0.698 against brick 0.610 is Weber +0.14 and would vanish.
    gx, gy = leaf_at(-4.6)
    box("leafGold", V(gx - 1.6 * sa, gy + 1.6 * ca, 22.4), 1.2, 0.35, 1.2, "foreArmL", MAT_GOLD,
        rot=(0, 0, LEAF_YAW))
    marker("feetCenter", Vector((0, 0, 0)), "feetCenter")
    # `maulHead` is not decoration: enemy-brute.ts:126 reads frame.sockets.maulHead BY NAME through a
    # MODULE-SCOPE scratch object. A sheet that omits it leaves the tell's charge glow hanging at
    # whatever the last brute in the room computed. Declared on the four attack cells, ON THE STEP —
    # so the mark that says "unfinished" is the mark that lights up as the blow arrives.
    _sx, _sy = leaf_at(-7.5)
    marker("maulHead", arm.matrix_world @ V(_sx, _sy, 24.6), "foreArmL")

# ================================================================= DUMMY — the Kit
else:
    # The Veteran's own gear stacked on a greatsword driven point-down into the flagstone. It wears
    # his exact palette ON PURPOSE: the recognition is "his kit, without him", and PROPORTION is what
    # tells them apart — a ~9:1 taper from top to floor against <= 1.5:1 for every creature.
    #
    # TWO MEASURED CORRECTIONS, both from reading the 1x contact sheet on the floor value rather than
    # from taste. Round 1 read as A MAN IN A RED TUNIC (pauldron = head, bar = shoulders, mantle =
    # torso, blade = legs). Round 2 moved the pauldron off centre and exposed the guard, and read as
    # A QUADRUPED: the bar plus a long strap made one continuous ARC, the helm sat at the end of it
    # like a head on a neck, and the wine mass was still the biggest thing on the sheet.
    #
    # THE FIX IS COMPOSITIONAL, NOT CHROMATIC, and it is the laziest one that works: make the
    # DOMINANT read a bare vertical pole crossed by two horizontal bars. Creatures have no straight
    # lines and no right angles; a pole with two crossbars is a SIGNPOST, and nothing else in the
    # roster is one. Everything else shrank to make room for it:
    #   1. 18px of BLADE stays bare and unbroken from the floor up. It is the object.
    #   2. The mantle is a RAG hanging off one arm of the guard, ~13% of the opaque area, never a
    #      mass down the middle. It stopped being a torso the moment it stopped being centred.
    #   3. The helm hangs UNDER the bar's right end on a short strap, so the gap between them is a
    #      CLOSED HOLE roofed by the bar — not an open notch, and not a neck.
    # THE BLADE IS TWO VALUES, and that is a measured fix rather than a flourish. An 18px bare
    # brickHi/cope column took b5-mass to 26.6% against the 25% sprite cap — a HARD failure — and a
    # single-value 18px bar is the paper-cutout defect the room survey already records on the hero's
    # mantle. Splitting it puts the bright steel at the TOP, where the key is, and the shadowed iron
    # at the FLOOR: the same SS3 light hierarchy whose inversion put the hero's brightest pixels on
    # his boots. b5-mass lands at 15.5%.
    # THE BLADE IS TWO VALUES, and that is a measured fix rather than a flourish. An 18px bare
    # brickHi/cope column took b5-mass to 26.6% against the 25% sprite cap — a HARD failure — and a
    # single-value 18px bar is the paper-cutout defect the room survey already records on the hero's
    # mantle. Splitting it puts the bright steel at the TOP, where the key is, and the shadowed iron
    # at the FLOOR: the same SS3 light hierarchy whose inversion put the hero's brightest pixels on
    # his boots.
    box("stem", V(0, 0, 0.9), 1.0, 0.9, 0.9, "stack", MAT_IRON)
    box("bladeLo", V(0, 0, 4.6), 1.5, 1.0, 3.6, "stack", MAT_IRON)
    box("blade", V(0, 0, 10.6), 1.5, 1.0, 2.5, "stack", MAT_BLADE)
    # ROUND 3, MEASURED OFF THE HOLE MAP (scratchpad holes.mjs, which floods the transparent outside
    # and reports what is left — `components` in gates.ts counts opaque ISLANDS, and a hole is not an
    # island, so no gate can see this). Round 2 put the guard, the helm and the mantle top at the SAME
    # height and they fused into a solid 16px slab: the blob the black test kept showing. The fix is
    # purely vertical separation — three horizontal events at three different heights, with air
    # between them:
    #     h 13..16  the 9px crossguard        (the object tell)
    #     h 17..22  the helm, off to one side (the hook, with a hole above it)
    #     h 27..29  the 18px lash bar         (the rack)
    # CROSSBAR 1: a sword driven point-down is read by point -> blade -> guard, in that order.
    # Burying it is what let round 1 read as a body.
    box("crossguard", V(0, 0, 14.5), 4.5, 1.3, 1.5, "stack", MAT_STEEL)
    box("guardEdge", V(0, 1.1, 14.5), 4.9, 1.1, 1.8, "stack", MAT_SLIT)
    # ONE gold mark, 2x2px, on the guard's exposed left arm. SS8.2.2: gold marks a crossing, and a
    # man's gear stacked where he stopped is the one crossing this object commemorates. The hero
    # carries two — the sigil and the clasp; his grave-stack keeps one.
    box("goldStud", V(-3.0, -1.5, 14.7), 1.1, 0.4, 1.0, "stack", MAT_GOLD)
    box("grip", V(0, 0, 22.0), 1.5, 1.2, 6.0, "stack", MAT_IRON)
    # CROSSBAR 2, the lash bar: 18px, x -8..+10, lashed across the grip. Two parallel horizontals on
    # one vertical is a RACK — creatures have no straight lines and no right angles, and nothing else
    # in the roster is a signpost. Weber +2.93 on its own: the ground-separation carry on a dark sheet.
    box("lashBar", V(1.0, 0, 28.0), 9.0, 1.0, 1.0, "stack", MAT_BONE)
    # The pauldron straddles the bar's LEFT END at the bar's own height. NOTHING sits above the bar
    # at centre, so the top contour is a stepped horizontal with a plate on one end — never a head.
    box("pauldron", V(-5.6, 0, 27.2), 2.5, 2.0, 2.2, "stack", MAT_IRON)
    box("pauldronEdge", V(-5.6, 1.0, 27.2), 2.8, 1.8, 2.5, "stack", MAT_SLIT)
    box("pauldronRim", V(-5.6, -0.3, 29.0), 2.5, 2.0, 0.45, "stack", MAT_STEEL)
    # The mantle: a RAG off the guard's left arm, hanging beside the pole rather than down the middle.
    # Wine in front, wine-dark behind and LARGER, so the garment carries its own material-dark outline
    # instead of floating as one flat slab of purple3. Dark only at the hem and the sides — a dark
    # collar at the top gives the wine form three steps in the wrong order and re-opens
    # light-direction, which is what four of the hero's north run frames failed on.
    box("mantleDark", V(-3.9, -1.2, 9.4), 2.6, 0.9, 5.2, "stack", MAT_WINE_DARK)
    box("mantle", V(-4.1, -2.3, 9.8), 2.1, 0.9, 4.6, "stack", MAT_WINE)
    box("mantleHem", V(-4.1, -2.5, 5.2), 1.5, 0.9, 0.8, "stack", MAT_WINE_DARK)
    # THE HOOK: the helm hung UNDER the bar's right end, with open sky between them. The gap is
    # ROOFED by the bar and FLOORED by the helm crown, so it is a CLOSED HOLE in the silhouette
    # rather than a notch — and a hole is the one feature a solid-black fill preserves perfectly.
    # No other actor owns a head that is not on a neck, and nothing else in the roster puts daylight
    # between two parts of itself. Absence always survives downscale; ornament does not.
    box("strap", V(5.3, 0, 25.0), 0.8, 0.9, 3.0, "hook", MAT_BONE)
    box("helm", V(7.6, 0, 19.0), 3.2, 2.9, 2.5, "hook", MAT_IRON)
    box("helmEdge", V(7.6, 1.1, 19.0), 3.5, 2.7, 2.8, "hook", MAT_SLIT)
    # The visor is aimed at the FLOOR. Nobody put it back on.
    box("helmVisor", V(7.6, -2.6, 18.3), 1.6, 0.6, 1.0, "hook", MAT_VISOR)
    box("helmSlit", V(7.6, -3.0, 18.3), 1.5, 0.4, 0.4, "hook", MAT_SLIT)
    marker("feetCenter", Vector((0, 0, 0)), "feetCenter")

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
    shift = (0.5 - (CANVAS - feet_row) / CANVAS) * CANVAS
    cam.location = up * shift - CAM_RIGHT * (origin_x - CANVAS / 2) - d * 300


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


# ---------------------------------------------------------------- pose machinery (mannequin.py, verbatim)
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


HIDE = {}     # frame name -> mesh names hidden for that render

# ================================================================= poses
if ACTOR == "warden":
    # The void is the charge meter, and ONE number meters it: how far the pelvis lifts. The piers
    # hang off root, so a lift raises the hem underside and the open floor under it grows.
    # MEASURED at rest: hem underside z 14, near edge y -6 -> 14 - 0.342*6 = 11.95 -> a 12px void.
    # NO PIER RAKE, and deleting it is a measured simplification rather than a lost idea. A 10 deg
    # forward rake buys ~2.5px of lean that is nearly invisible at 1x, and it MEASURED as the single
    # largest light-direction cost on the sheet: raked piers came back as the nave family's BRIGHTEST
    # step (nave2) at the very bottom of the north drawing while the whole upper body sat on nave1 —
    # textbook bright-south, +0.52..+0.81 against the +0.35 cap. The void meter was never the rake; it
    # is the pelvis lift, and that is untouched.
    def W(lift=0.0, twist=0.0, tilt=0.0, arms=None, pier_dy=(0.0, 0.0), pier_slip=0.0):
        ops = [("T", "pelvis", (0, 0, lift))]
        if pier_dy[0]:
            ops.append(("T", "pierR", (0, pier_dy[0], 0)))
        if pier_dy[1]:
            ops.append(("T", "pierL", (0, pier_dy[1], 0)))
        if pier_slip:
            ops.append(("R", "pierL", "Y", pier_slip))
        if twist:
            ops += [("R", "chest", "Z", twist * 0.35), ("R", "shoulder", "Z", twist * 0.65)]
        if tilt:
            ops.append(("R", "lintelB", "Y", tilt))
        ops += arms if arms else []
        return ops

    # Arms OUT LEVEL at lintel height: contour widens, VOID UNCHANGED. This is the discrimination the
    # whole fight depends on — the void rising means the circle is coming, the contour widening means
    # the veil is. Two different channels, so a player reading one is never reading the other.
    RING_ARMS = [("A", "upperArmR", (1, 0, 0.12)), ("A", "foreArmR", (1, 0, 0.05)),
                 ("A", "upperArmL", (-1, 0, 0.12)), ("A", "foreArmL", (-1, 0, 0.05))]
    FLUSH_ARMS = [("A", "upperArmR", (0.30, 0, -1)), ("A", "foreArmR", (0.15, 0, -1)),
                  ("A", "upperArmL", (-0.30, 0, -1)), ("A", "foreArmL", (-0.15, 0, -1))]
    POSES = {
        # ZERO VERTICAL BOB, and the renderer must honour it (pose.hop = 0, sx = sy = 1, rot = 0).
        # Every other actor bobs. An actor that does not bob reads as inevitable.
        # The one-sentence reference: a doorway standing still.
        "idle": W(),
        # Two frames of SLIDE, not a gait. speed 28 with orbitMin 52: he closes slowly and never
        # sprints, so a walk cycle would be a lie about the character. The void never changes height
        # and the lintel never rises.
        "chaseA": W(pier_dy=(-2.2, 2.2)),
        "chaseB": W(pier_dy=(2.2, -2.2)),
        # The first 20 of the 36-tick windup (clipSelect splits at ceil(windup*0.55) = 20; take the
        # boundary from tuning.warden, never from the sheet). Piers rake 10 -> 6, pelvis +3.
        "windSlamGather": W(lift=3.0),
        # The last 16 ticks. Piers at 3 deg, pelvis +5, the void at its widest. Nothing else in the
        # frame moves. windup2 is 24 in phase two: the tell does not get shorter in the DRAWING —
        # the opening stays the same size and only the hold shortens.
        "windSlamCommit": W(lift=5.0),
        # slamTicks is 4, so this single frame IS the whole active window and it must read at a
        # glance. Pelvis -5, void crushed, the hem driven down over the pier tops.
        "slamContact": W(lift=-5.0),
        # recover 48 ticks — the longest punish window he owns, AND the shared recovery drawing for
        # ring (42) and fan (40). One strong pose beats three weak ones.
        "slamRecover": W(lift=-2.5, tilt=2.5),
        "windRing": W(arms=RING_ARMS),
        # The 8 bolts leave from the hem line, not from a hand: a building does not throw.
        "ringRelease": W(arms=FLUSH_ARMS),
        # The ONLY frame in the set where the gold course is not parallel to the floor: a third tell
        # made of nothing but torso twist, over a base that does not move.
        "windFan": W(twist=-18.0),
        "fanRelease": W(twist=24.0),
        # phaseTransitionTicks 45, held. The gold course splits from THREE segments into TWO,
        # permanently — the only frame that changes the body's mark count, and a one-way door the
        # player can watch happen.
        "phase": W(lift=1.5, tilt=-1.5),
        # knockbackScale is 0.22: he is knocked back by almost nothing. Mass is proven by what
        # refuses to react — 2px of compression, ZERO translation, plinths and void unmoved.
        "hurt": W(lift=-2.0),
        # ONE pier slips and the void skews into a parallelogram. It is the only skewed void in the
        # entire set, so a stagger is legible from across the room at 1x.
        "stagger": W(lift=-1.0, tilt=-4.5, pier_slip=10.0, pier_dy=(0.0, -1.8)),
    }
    HIDE["phase"] = ["gold1"]
    FRAME_ORDER = ["idle", "chaseA", "chaseB", "windSlamGather", "windSlamCommit", "slamContact",
                   "slamRecover", "windRing", "ringRelease", "windFan", "fanRelease", "phase",
                   "hurt", "stagger"]
    # SOUTH AND NORTH ONLY, and this is arithmetic, not a shortcut. In east the screen height is
    # z + 0.342*x, so a body 56px wide in x shears by 0.342*56 = 19px of vertical. MEASURED: the east
    # renders came back 15x63 — a sliver 63px tall against the 59px height cap, failing height,
    # edge-clearance AND silhouette-mass at once, with ground separation NEGATIVE because what is
    # left is mostly outline. A flat gate seen edge-on IS a sliver; that is the design telling the
    # truth, not the rig failing. The renderer today draws the warden from a code-authored table
    # with no facing logic at all, so two authored facings is strictly more than it has.
    FACINGS = ["south", "north"]
    SHEET = dict(cell=72, cols=4, rows=4, mirror=False,
                 palette=["mortar", "seal0", "nave0", "nave1", "nave2", "boneLo", "boneDim", "bone", "gold"],
                 sockets={f: ["mask"] for f in FRAME_ORDER},
                 clips={
                     # VERIFIED against compile.ts: `ref: warden` resolves and carries `windup`,
                     # which IS in WINDOW_KEYS — but tuning.warden has no `active`, and
                     # compile.ts:65-68 rejects a contact assertion against a window with no live
                     # phase. So no contact key. Frame selection is the renderer's job off stateTick.
                     "slam": {"frames": ["windSlamGather", "windSlamCommit", "slamContact", "slamRecover"],
                              "timing": "sim", "sim": {"ref": "warden"}},
                     "chase": {"frames": ["chaseA", "chaseB"], "timing": "ticks", "ticks": [8, 8], "loop": True},
                 })

elif ACTOR == "oathbound":
    # POSTURE IS THE INVERTED VETERAN: spine BACK of vertical where the Veteran leans forward, head
    # level where he drops his low, shoulders level, stance narrow — a column base, not an A-frame.
    # A body at attention that never got the order to stand down, beside a body that stopped waiting.
    BASE = [("R", "pelvis", "X", -1), ("R", "spine", "X", -2), ("R", "chest", "X", -1),
            ("R", "thighR", "Y", 3), ("R", "thighL", "Y", -3),
            ("R", "upperArmR", "X", -4)]
    # THE ARM IS POSED BY SMALL ROTATIONS, NEVER BY AN AIM, and this is a measured correction rather
    # than a style note. `attach()` preserves world placement at REST, so the leaf is authored
    # already vertical and already forward; an ("A", "foreArmL", ...) op that swings the forearm to
    # horizontal drags the plate flat with it, and the first render came back with a 24x12 slab lying
    # across the body like a bulldozer blade instead of a 24px tall tower leaf. Rotations about X are
    # also the IN-SCREEN tilt in the east view (screen height = z + 0.342x), so they change the
    # edge's plumb without changing how much of the leaf's face is presented — which is what keeps
    # `identity:attack` under its 0.45 cosine cap.
    #
    # THE GUARD TRUTH TABLE, and the art may not deviate by one cell. oathbound.ts:22-27: guardUp()
    # is FALSE only when burn > 0, state === 'attack', or state === 'stagger'. So the forward edge is
    # PLUMB in exactly {idle, chase, windupEarly, windupCommit, recover} and OFF PLUMB in exactly
    # {release, contact, hurt}. Five up, three down.
    # NET ZERO in-screen tilt, and that is arithmetic rather than feel. BASE pitches pelvis/spine/
    # chest by -1/-2/-1, and the leaf hangs off foreArmL, so those four degrees reach it. A guard
    # that adds its own negative X on top measured ~14 deg of lean and the leading edge came back a
    # SLOPE. The hook is a dead-straight vertical run of >= 22 rows; +4 here cancels the trunk and
    # gives the edge back its plumb.
    GUARD_UP = [("R", "upperArmL", "X", 3), ("R", "foreArmL", "X", 1)]
    POSES = {
        # The reference cell: every other cell is read against this one's vertical line.
        "idle": BASE + GUARD_UP + [("R", "shinR", "X", 3), ("R", "shinL", "X", 3)],
        # Also the cell the player sees on a BLOCK, which is why no `blocked` frame is needed:
        # combat.ts:115-121 returns BLOCKED_DAMAGE before e.flash is ever set, so a turned blow can
        # never select `hurt`. The hips translate and the forward edge does not move by ONE PIXEL —
        # no other actor can hold a straight line while moving, and it costs nothing but a locked
        # foreArmL.
        "chase": BASE + GUARD_UP + [("T", "pelvis", (0, -0.6, -1.2)),
                                    ("R", "thighR", "X", -16), ("R", "shinR", "X", 20),
                                    ("R", "thighL", "X", 8), ("R", "shinL", "X", 2)],
        # Attack ticks 0-13 (windup 24, split at ceil(24*0.55) = 14). Deliberately quiet: the elite's
        # first tell must not be mistaken for the brute's, whose maul leaves the body silhouette
        # entirely. Only the rear foot loads and the yoke rotates. The edge is still PLUMB —
        # guardUp() is true here.
        "windupEarly": BASE + GUARD_UP + [("R", "chest", "Z", 7), ("R", "spine", "Z", 4),
                                          ("R", "thighR", "X", 10), ("R", "shinR", "X", -8),
                                          ("T", "pelvis", (0, 0.6, -1.0))],
        # Ticks 14-23. The ONE pre-contact cell where the edge loses plumb: it tilts 16 deg and hauls
        # BACK, 10 ticks (167 ms) before the arc tests. That is the whole telegraph and it is a
        # GEOMETRY event, not a colour event, so it survives solid black at 1x, the white hit flash
        # and a burning body. It is unmistakable against the brute's, which goes UP; this goes BACK.
        # Guard still UP: the sim has not released yet.
        "windupCommit": BASE + [("R", "upperArmL", "X", 8), ("R", "foreArmL", "X", 8),
                                ("R", "chest", "X", -9), ("R", "spine", "X", -5),
                                ("R", "chest", "Z", 8),
                                ("R", "thighR", "X", 16), ("R", "shinR", "X", -12),
                                ("T", "pelvis", (0, 1.4, -1.6))],
        # attack stateTick 0-6: the 22px lunge over lungeTicks 6. The leaf thrown forward, edge off
        # plumb, body committed over the lead foot. Guard DOWN, and it now looks it.
        "release": BASE + [("R", "upperArmL", "X", -22), ("R", "foreArmL", "X", -14),
                           ("R", "spine", "X", 8), ("R", "chest", "Z", -8),
                           ("R", "thighL", "X", -30), ("R", "shinL", "X", 26),
                           ("R", "thighR", "X", 18), ("R", "shinR", "X", -10),
                           ("T", "pelvis", (0, -1.8, -1.8))],
        # attack stateTick 7-11, exactly where the sim's arc first tests (stateTick > lungeTicks)
        # through active 5. Deepest compression, both feet readable. This is the cell most likely to
        # be on screen at the kill, and therefore the one that shatters — so it gets the most legible
        # read in the sheet.
        "contact": BASE + [("R", "upperArmL", "X", -34), ("R", "foreArmL", "X", -22),
                           ("R", "spine", "X", 12), ("R", "chest", "Z", -14), ("R", "head", "X", 6),
                           ("R", "thighL", "X", -38), ("R", "shinL", "X", 32),
                           ("R", "thighR", "X", 22), ("R", "shinR", "X", -12),
                           ("T", "pelvis", (0, -2.6, -2.6))],
        # The tail, all 32 ticks. THE COUNTERINTUITIVE CELL AND THE HONEST ONE: oathbound.ts:25
        # returns guardUp() TRUE during recover, so the leaf is back to plumb and the FRONT is still
        # covered. The art must not promise a punish window the sim does not give — proposal 1 drew
        # the guard returning across these 32 ticks and called it the flank window; the sim disagrees.
        "recover": BASE + GUARD_UP + [("R", "chest", "Z", -4),
                                      ("R", "thighL", "X", -14), ("R", "shinL", "X", 12),
                                      ("T", "pelvis", (0, -0.8, -1.4))],
        # Reached ONLY by a blow that GOT THROUGH — a heavy, a flank, or a burn: combat.ts sets
        # e.flash only AFTER guardBlocks has returned. So it is drawn as the payoff for COMMIT, not
        # as a generic recoil: the leaf yawed wide toward edge-on, and the dark iron column behind it
        # exposed for the first time in the sheet. 'oathbound' MUST stay in
        # EntityView.authoredHitReaction (views/shared.ts:47) or setFlash whitens this pose out for
        # exactly the 26 stagger ticks it was drawn for.
        "hurt": BASE + [("R", "foreArmL", "Z", 34), ("R", "upperArmL", "X", -10),
                        ("R", "chest", "X", -16), ("R", "head", "X", -20), ("R", "chest", "Z", -8),
                        ("R", "upperArmR", "X", 26),
                        ("R", "thighR", "X", -12), ("R", "shinR", "X", 22),
                        ("T", "pelvis", (0, 2.4, -1.2))],
    }
    # THE VOCABULARY IS NOT FREE. updateBruteView draws this actor through bruteFrameName
    # (enemy-brute.ts:56-67) and bruteAttackClipFrame, which own an EIGHT-NAME vocabulary and have no
    # ninth cell. Frames named `guard`, `bash`, `open` or `guardDown` would compile and then never be
    # selected. These eight names, in this order.
    FRAME_ORDER = ["idle", "chase", "windupEarly", "windupCommit", "release", "contact", "recover", "hurt"]
    FACINGS = ["east"]
    SHEET = dict(cell=64, cols=4, rows=2, mirror=True,
                 palette=["mortar", "seal0", "iron", "ironHi", "brickLo", "brick", "brickHi", "gold"],
                 sockets={f: (["maulHead"] if f in ("windupEarly", "windupCommit", "release", "contact") else [])
                          for f in FRAME_ORDER},
                 clips={
                     # tuning.oathbound carries active 5, so the contact assertion is legal and gets
                     # machine-checked by tests/render/clip-boundaries.test.ts rather than asserted
                     # in prose.
                     "attack": {"frames": ["windupEarly", "windupCommit", "release", "contact", "recover"],
                                "timing": "sim", "sim": {"ref": "oathbound", "contact": "contact"}},
                 })

else:
    POSES = {
        # The shippable floor. Point buried, 5 deg lean toward the heavier hung side, mantle hanging
        # over the blade, bar lashed across the grip, pauldron seated left, helm hung right with open
        # floor showing under the bar. It commits to one thing: this has never moved, and somebody
        # put it here. THREE INDEPENDENT HANDS ARE VISIBLE, which is how it answers §8.2.4 with
        # geometry instead of a story — a blade driven point-down (gravity does not do that), a bar
        # lashed on with bone strapping, and a helm nobody put back on.
        "idle": [("R", "stack", "Y", 3)],
        # Selected by e.flash > 0. ONLY the hung things move: the helm swings further outboard, the
        # strap tilts to follow, the void under the bar opens. Not one pixel of blade, guard, grip,
        # bar or pauldron changes. It is a PENDULUM, not a recoil — the object does not react, it
        # just has loose parts. Costs one Blender frame and one ternary; no new tuning key, no clip,
        # no sim change, no replay-hash exposure.
        "struck": [("R", "stack", "Y", 3), ("R", "hook", "Y", -22), ("T", "hook", (0, 0, -1.0))],
    }
    FRAME_ORDER = ["idle", "struck"]
    FACINGS = ["south"]
    SHEET = dict(cell=64, cols=2, rows=1, mirror=False,
                 palette=["mortar", "seal0", "iron", "ironHi", "purple0", "purple2", "purple3",
                          "boneLo", "boneDim", "bone", "brickLo", "brick", "brickHi", "cope", "gold"],
                 sockets={f: [] for f in FRAME_ORDER},
                 # NO CLIPS DECLARED. Two frames, and nothing for a clip to time — the sim reaches
                 # exactly one state on this actor (world.ts:187 gives it hp 9999 so `dead` is
                 # unreachable, and combat.ts:218 excludes it from every stagger arm). That sidesteps
                 # every clip gate by construction.
                 clips={})

FACING_ROT = {"south": 0.0, "north": pi, "east": pi / 2}

# ---------------------------------------------------------------- render + export
os.makedirs(OUT, exist_ok=True)
only = set(ONLY.split(",")) if ONLY else None
rig = {"px": PX, "canvas": CANVAS, "scale": PX / CANVAS, "pitchDeg": math.degrees(PITCH),
       "feetRow": FEET_ROW, "actor": ACTOR, "sunEnergy": SUN_ENERGY,
       "ambientStrength": AMBIENT_STRENGTH, "frameOrder": FRAME_ORDER,
       "sheet": SHEET, "facings": {}}

all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for facing in FACINGS:
    arm.rotation_euler = (0, 0, FACING_ROT[facing])
    os.makedirs(os.path.join(OUT, facing), exist_ok=True)
    rig["facings"][facing] = {"frames": {}}
    for fname in FRAME_ORDER:
        if only and fname not in only:
            continue
        hidden = set(HIDE.get(fname, []))
        for o in all_meshes:
            o.hide_render = o.name in hidden
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
                print(f"[lane3] FIT WARNING {facing}/{fname}: {mname} at art-px ({ax:.1f}, {ay:.1f}) "
                      f"— outside the {CANVAS}px cell")
        scene.render.filepath = os.path.join(OUT, facing, fname + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"[lane3] rendered {ACTOR} {facing}/{fname}")

rig_path = os.path.join(OUT, "rig.json")
with open(rig_path, "w") as f:
    json.dump(rig, f, indent=2)
print(f"[lane3] rig registration -> {rig_path}")

if SAVE_BLEND:
    os.makedirs(os.path.dirname(SAVE_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE_BLEND))
    print(f"[lane3] saved {SAVE_BLEND}")
