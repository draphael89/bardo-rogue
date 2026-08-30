# Pipeline-proof spike: the Veteran mannequin as a rigged Blender scene, rendered headless.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio --factory-startup \
#     --python tools/spike/mannequin.py -- --out .art-cache/spike/renders [--px 512] \
#     [--leg-scale 1.0] [--facings south,north,east] [--save-blend path.blend]
#     [--weapon none|greatsword|dagger] [--armor base|heavy]
#
# `--weapon none` is the DEFAULT and the identity variant: unarmed is authored FIRST, so a baked
# weapon can never force the renderer's stock fallback, and its five action cells carry SS8's shared
# body grammar (hurt, death, dodge, fall, land) instead of an attack chain.
# Run `node tools/spike/lanes.mjs` BEFORE this script: it proves each authored material still owns
# its own canon ramp under the exposure below, which is the thing a render cannot tell you.
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
WEAPON = arg("--weapon", "none")
ARMOR = arg("--armor", "base")
if WEAPON not in ("greatsword", "dagger", "none"):
    sys.exit(f"[spike] unsupported --weapon {WEAPON!r}; expected greatsword, dagger or none")
if ARMOR not in ("base", "heavy"):
    sys.exit(f"[spike] unsupported --armor {ARMOR!r}; expected base or heavy")
VARIANT = ("veteran"
           + ("-heavy" if ARMOR == "heavy" else "")
           + ("-dagger" if WEAPON == "dagger" else "")
           + ("-unarmed" if WEAPON == "none" else ""))

# ---------------------------------------------------------------- constants
CANVAS = 64                       # art px per cell
PITCH = radians(20)               # camera pitch below horizontal: the game's mild top-down read
# The exposure pair, bisected against `tools/spike/lanes.mjs`'s k window and against the real gates.
# Overridable from the CLI ONLY so the bisect is cheap; the checked-in values are the answer, and
# the band is NARROW because two gates pull opposite ways. MEASURED, sun 1.07, visor on seal0:
#   ambient 1.65 -> east ground-separation 0.99, a HARD failure
#   ambient 1.72 / 1.75 / 1.78 -> 507/507 green in all three facings
#   ambient 1.83, 1.88 -> south hurt (and at 1.88 east idle) light-direction 0.42-0.52
# Below the band the body sits on its shadow step and disappears into the floor; above it the
# body sits on its lit step and `familyLightScore`, which is a SIGN TEST for a two-step form,
# starts flipping on one-pixel differences in mean row. 1.79 is the middle of the measured band.
SUN_ENERGY = float(arg("--sun", "1.07"))
AMBIENT_STRENGTH = float(arg("--ambient", "1.75"))
AMBIENT_COLOR = (0.75, 0.75, 0.75)   # NEUTRAL: a tinted fill drags a shaded lane off its own ramp
# Key direction, measured in SCREEN space rather than guessed: these two angles project to a key
# 15.5 deg left of straight down, which is SS2.1 Law 2 read literally. The old 35/-18 pair
# measured 29.5 deg and put more of the beam along the VIEW axis than above it, which is what
# let a lit plane sit below its own shadow in a run frame and trip `light-direction`.
# Ground separation is bought with the AMBIENT term instead of by tilting the key frontal: a
# uniform fill raises every pixel's multiplier without reordering which planes are brighter.
SUN_PITCH = float(arg('--sun-pitch', '20'))
SUN_YAW = float(arg('--sun-yaw', '-12'))
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
    # EEVEE Next's horizon-scan GI darkens crevices FAR below the flat ambient floor — measured, it
    # took a pauldron underside to k=0.21 when the ambient floor was 0.86, which is exactly what
    # drags a steel plane out of its own lane and into boneDim. The lane window is only defensible
    # while shading is ambient + key + the key's own cast shadow, so the extra occlusion goes.
    for _k in ("use_raytracing", "use_gtao", "use_fast_gi"):
        if hasattr(scene.eevee, _k):
            setattr(scene.eevee, _k, False)

# ---------------------------------------------------------------- materials


def srgb_to_linear(c):
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def make_mat(name, srgb, rough=0.85, spec=0.0):
    """A SHADED lane. Specular defaults to zero on purpose: an additive white highlight is a bigger
    fraction of a dark base than of a light one, so it shifts each material's rendered multiplier by
    a different amount and the lanes stop sharing one exposure window. Only the two bright metals
    ask for it back."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    lin = srgb_to_linear(srgb)
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular", "Specular IOR Level"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = spec
    return m


def make_flat(name, srgb):
    """An UNSHADED mark: the canon colour, emitted, with nothing for the light to do to it.

    The compiler has no material channel — `reduce()` snaps every sample to the globally nearest
    canon entry — so a material only owns a ramp when its own shaded range does not overlap another
    material's. `tools/spike/lanes.mjs` sweeps that and proves what cannot coexist: a SHADED bone
    lane leaks into brickLo, brick or gold at every exposure, because canon's warm luminance steps
    interleave (boneLo 0.313 / goldDim 0.449 / boneDim 0.510 / gold 0.698 / bone 0.759). Bone and
    gold therefore become flat marks, which is what SS7 already calls them: "bone wrapping" and
    "gold marks boundaries and identity accents, never the armor body".
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    for k in ("Specular", "Specular IOR Level"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.0
    lin = srgb_to_linear(srgb)
    for k in ("Emission Color", "Emission"):        # 4.x renamed the socket; probe both
        if k in bsdf.inputs:
            try:
                bsdf.inputs[k].default_value = (*lin, 1.0)
            except (TypeError, ValueError):
                continue
    bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


def canon_srgb(hexstr):
    return tuple(int(hexstr[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


# Three SHADED lanes and four FLAT marks. Every base colour is chosen so that its rendered range
# lands on its own canon names and nobody else's — run `node tools/spike/lanes.mjs` before Blender.
MAT_IRON = make_mat("iron", canon_srgb("#393942"))            # -> iron / ironHi
MAT_WINE = make_mat("wine", canon_srgb("#8A3A4C"))            # -> purple2 / purple3
MAT_STEEL = make_mat("steel", canon_srgb("#A8AFBE"), rough=0.45, spec=0.12)   # -> brick / brickHi
MAT_BLADE = make_mat("blade", canon_srgb("#C0C6D4"), rough=0.45, spec=0.12)   # -> brickHi / cope
MAT_BONE = make_flat("boneFlat", canon_srgb("#90806C"))       # boneDim, Weber +2.93
MAT_GOLD = make_flat("goldFlat", canon_srgb("#D4B060"))       # gold, exactly twice per body
MAT_SLIT = make_flat("slitFlat", canon_srgb("#0A0C12"))       # mortar: the face slit and nape band
# The visor is its OWN flat value, and that is structural as well as pretty. `familyLightScore`
# scores each connected same-family form, and a form with exactly two steps returns +/-1 on a
# one-pixel difference in their mean rows. An iron visor put a dark mass at the TOP of the iron
# body — measured, run6 south flipped to +1.00 the moment exposure moved the torso to its lit
# step. seal0 is its own family, one step, and the gate skips single-step forms.
MAT_VISOR = make_flat("visorFlat", canon_srgb("#12141C"))     # seal0: the dark face of the helm
MAT_WINE_DARK = make_flat("wineDarkFlat", canon_srgb("#2A0E1C"))  # purple0: the cape's material-dark hem

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


def box(name, center, hx, hy, hz, bone_name, mat, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=2, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (hx, hy, hz * F)
    if rot:
        o.rotation_euler = rot            # set BEFORE attach: attach() preserves matrix_world
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
sphere("torsoBarrel", V(0, 0.4, HZ + 7.0), 5.2, 4.0, 6.4, "spine", MAT_IRON)
sphere("chestCap", V(0, 0, HZ + 11.3), 4.9, 3.6, 3.2, "chest", MAT_IRON)
box("pelvisBlock", V(0, 0, HZ + 1.6), 3.4, 2.6, 2.2, "pelvis", MAT_IRON)
# The head is a HELM, not a skull: iron, so bone can leave the head and never neighbour gold.
head_ball = sphere("headBall", V(0, -3.0, HZ + 16.0), 5.3, 5.5, 6.8, "head", MAT_IRON)
for side, sx in (("R", 1), ("L", -1)):
    sphere("deltoid" + side, V(5.0 * sx, -0.4, HZ + 10.7), 2.4, 2.5, 2.7, "upperArm" + side, MAT_IRON)
    limb_cyl("upperArmM" + side, "upperArm" + side, 1.8, MAT_IRON)
    # Bone wrapping (SS7) lives on BOTH forearms — the part of the contour that moves most, and a
    # Weber +2.93 flat that reads at 1x while the rest of the arm is iron.
    limb_cyl("foreArmM" + side, "foreArm" + side, 1.55, MAT_BONE)
    sphere("handBall" + side, V(6.1 * sx, -2.4, HZ - 2.0), 1.5, 1.5, 1.9, "hand" + side, MAT_IRON)
    limb_cyl("thighM" + side, "thigh" + side, 2.1, MAT_IRON)
    limb_cyl("shinM" + side, "shin" + side, 1.7, MAT_IRON)
    box("footBox" + side, V(3.2 * sx, -1.7, 0.8), 1.6, 2.7, 0.8, "foot" + side, MAT_IRON)

# ---------------------------------------------------------------- the persistent identity anchors
# These sit on the BASE body, unconditionally, so every weapon and armor family inherits them (SS3).
#
# THE PROJECTION RULE that governs every head mesh. `V()` pre-stretches z by F = 1/cos(20 deg), so a
# point's screen height in ART PIXELS above the ground line is exactly:
#     SOUTH  z + 0.342*y      NORTH  z - 0.342*y      EAST  z + 0.342*x        (authored coords)
# North is therefore the binding facing for anything forward of centre, and the measured north idle
# body was ALREADY 40px — at the hard cap in docs/CHARACTER_HARD_CONSTRAINTS.md with zero headroom.
# Compressing the dome is the only budget the crest may spend. The comment two blocks down records
# what happens when that is skipped: an earlier crest quietly took north idle/run to 44-45px.
#
# The arithmetic, so the next edit does not have to rediscover it. With the dome at (y0, z0_h) and
# radii (rx, ry, rz), and a tab at (y0, hy, hz) topping out at T = z0_t + hz:
#     dome_top_N = z0_h + 0.342*|y0| + D,  D = sqrt(0.342^2*ry^2 + rz^2)
#     tab_top_N  = T + 0.342*(|y0| + hy)
#     visible crest above the dome = T - z0_h - D + 0.308   — the SAME in south and north
# So a taller dome and a taller crest compete for one budget, and north's cap sets T. These numbers
# spend it at ~2.9 art px of tab standing clear in every facing.
head_ball.scale.x *= 0.76      # helm/shoulder width 0.46 — the concept exhibit reads about 0.42
head_ball.scale.y *= 0.72      # DEPTH. y is screen-x in east; an 11-unit-deep skull read as a snout
head_ball.scale.z *= 0.44

# ANCHOR 1 — the split crest. Two matched steel tabs, symmetric in X, at ONE depth and ONE height,
# which is what the concept exhibit shows and what keeps their tops matched in south AND north.
# (A depth stagger buys east a void but costs north its pair: in a top-down view the near tab drops
# 0.342 px per unit of depth, and at any stagger wide enough to separate them in east the aft tab
# falls below the dome and north sees one tab, not two.) East reads the pair as one raised tab with
# a step in it; that is measured and reported, not claimed.
for _s, _sx in (("L", -1), ("R", 1)):
    box("crest" + _s, V(3.0 * _sx, -3.0, HZ + 20.37), 1.0, 0.9, 2.8, "head", MAT_STEEL)

# ANCHOR 3 — the face. A flat visor PLATE turns the dome into a great helm (the concept exhibit's
# helm is a flat dark block, not a ball), and the slit is inset into that plate rather than chasing
# a curved surface. Sized off the COMPILER's floor, not off taste: `despeckle()` erases a lone dark
# pixel whose four neighbours agree and its brightness protection covers only speculars, so the slit
# is 4.6 x 1.6 art px — three cells wide and two rows tall after the vote.
# A flat CROWN squares off the dome. Without it the tabs rise from the shoulders of a ball and read
# as ears with air between them and the skull; on a flat crown they read as a crest. The concept
# exhibit's helm is a block, not a head.
box("helmCrown", V(0, -3.2, HZ + 17.0), 3.6, 3.7, 2.0, "head", MAT_IRON)
box("visorPlate", V(0, -6.4, HZ + 16.6), 2.9, 0.7, 2.4, "head", MAT_VISOR)
box("faceSlit", V(0, -7.3, HZ + 17.3), 2.3, 0.5, 0.8, "head", MAT_SLIT)
box("napeBand", V(0, 1.0, HZ + 17.2), 2.3, 0.5, 1.1, "head", MAT_SLIT)

# ANCHOR 2 — ONE wine garment in five meshes, sized as a GARMENT against a 10.4-unit torso rather
# than as trim. `waistWrap` is a CLOSED band whose radii exceed pelvisBlock's, so it protrudes all
# round: that is the mechanical guarantee for SS3.3's "coherent patch visible from every facing".
# The cape is TWO boxes, not one: a wine-dark backing that overhangs the lit body by 1.1 units on
# every side, so the garment carries its own material-dark outline (SS4.3.3) instead of floating as
# one flat slab of purple3. Measured before this: 46.8% of the north sheet was a single value.
# The dark backing tops out just BELOW the lit body, never above it, and that is load-bearing:
# `familyLightScore` fits a line through the luminance steps of each connected form, and a form
# with exactly two steps scores +/-1 on a half-pixel difference in their mean rows. With a dark
# collar the cape read as "bright side south" and four north run frames failed light-direction
# at +1.00 while idle passed at -1.00. Dark only at the hem and the sides is both the correct
# reading of a hanging garment and the stable one.
box("capeShadow", V(0, 4.3, HZ + 2.98), 6.5, 1.0, 7.0, "spine", MAT_WINE_DARK)
box("mantleBack", V(0, 5.1, HZ + 3.6), 5.4, 0.9, 6.5, "spine", MAT_WINE)
# The ONE asymmetry in the set: the left corner hangs lower. It is why the crest does not have to be
# asymmetric, and it is what stops the north silhouette being a perfect mirror of itself.
box("hemNotch", V(-4.4, 4.3, HZ - 5.6), 2.1, 1.0, 1.4, "spine", MAT_WINE_DARK)
box("sashFront", V(0, -3.5, HZ + 7.8), 4.8, 0.9, 1.9, "spine", MAT_WINE, rot=(0, radians(30), 0))
sphere("waistWrap", V(0, 0, HZ + 1.6), 4.0, 3.1, 1.9, "pelvis", MAT_WINE)
box("wrapHem", V(0, 0, HZ - 0.2), 3.95, 3.05, 0.4, "pelvis", MAT_WINE_DARK)

# The shoulders: the exhibit's second-loudest mass, on both sides, with a 1px cool rim so BRIGHT
# METAL owns the top of the torso instead of wine. Outer |x| 8.8 against the deltoid's 7.4 is
# +1.4/side, inside SS6's ~3px allowance; torso +1/side (cape), lower legs and head height base.
for _s, _sx in (("R", 1), ("L", -1)):
    box("pauldron" + _s, V(5.8 * _sx, -0.4, HZ + 10.8), 3.0, 3.3, 2.0, "upperArm" + _s, MAT_IRON)
    box("pauldronRim" + _s, V(5.8 * _sx, -0.4, HZ + 12.6), 3.05, 3.35, 0.45, "upperArm" + _s, MAT_STEEL)

# Gold, exactly twice, both FLAT. SS7: gold marks boundaries and identity, never the armor body.
# The cape sigil is north's mark (literally the concept exhibit's shot); the baldric clasp is
# south's. It rides the sash at the SHOULDER, not the hip: measured at the hip, six south run
# frames swung a bone forearm into 4-neighbour contact with it, which is the boneDim<->gold
# collision this whole ramp exists to close. At the shoulder the count across 42 cells is zero.
box("capeSigil", V(0, 5.95, HZ + 6.0), 1.35, 0.35, 1.35, "spine", MAT_GOLD)
box("sashClasp", V(-2.8, -4.4, HZ + 9.4), 0.9, 0.45, 1.0, "spine", MAT_GOLD)

# The stress armor is geometry on the same rig, not a painted overlay. It deliberately changes
# shoulder, torso and greave silhouettes while leaving joints, hands and the head readable. This
# is candidate evidence for the cheap-variation claim; it never enters a shipping asset directory.
if ARMOR == "heavy":
    # The head-envelope reservation and the split crest MOVED to the base body above: SS3 requires
    # the anchors to survive every armor family, and an anchor that only exists under heavy armor is
    # not persistent. Heavy armor now adds mass around anchors it inherits.
    # Shallower and shorter than the first stress set: authored against a mannequin that had no
    # anchors, the old cuirass swallowed the sash and the waist wrap, and heavy south compiled with
    # TEN colours and no wine at all — SS3.3 asks equipment to leave a coherent patch from every
    # facing, so armour that hides the garment fails the clause it is meant to survive.
    box("heavyCuirass", V(0, -0.6, HZ + 7.4), 5.7, 3.0, 5.2, "spine", MAT_IRON,
        rot=(radians(-13), 0, 0))
    box("heavyChestLip", V(0, -3.1, HZ + 11.0), 5.2, 0.8, 0.9, "chest", MAT_STEEL)
    box("heavyFauld", V(0, -0.2, HZ - 0.2), 4.8, 2.9, 1.5, "pelvis", MAT_IRON)
    for side, sx in (("R", 1), ("L", -1)):
        box("heavyPauldron" + side, V(6.0 * sx, -0.4, HZ + 10.6), 3.1, 3.4, 2.2,
            "upperArm" + side, MAT_IRON)
        box("heavyGreave" + side, V(3.2 * sx, -0.4, 4.0), 2.1, 2.0, 3.3,
            "shin" + side, MAT_STEEL, rot=(radians(9), 0, 0))

# Weapon in the right hand. Greatsword is the established stress proof; dagger is intentionally
# short enough that a broad two-handed arc cannot fake a distinct family at 1x. `none` is authored
# FIRST and is the DEFAULT, so a baked weapon can never force the renderer's Kenney fallback: the
# unarmed sheet exists before any armed sheet does.
sword = []
if WEAPON != "none":
    hb = arm_data.bones["handR"]
    h_head = arm.matrix_world @ hb.head_local
    h_tail = arm.matrix_world @ hb.tail_local
    sword_dir = (h_tail - h_head).normalized()

    def sword_box(name, center, hx, hy, hz):
        bpy.ops.mesh.primitive_cube_add(size=2, location=center)
        o = bpy.context.active_object
        o.name = name
        o.scale = (hx, hy, hz)
        o.rotation_euler = sword_dir.to_track_quat("Z", "Y").to_euler()
        # The blade is the ONE material the unarmed body never authors: `cope` stays off the
        # unarmed sheet, which IS SS7's "one slot free for the weapon material" — proved by the
        # compile report's used-colour count rather than asserted. Grip and guard stay iron.
        o.data.materials.append(MAT_BLADE if "Blade" in name else MAT_IRON)
        attach(o, "handR")
        sword.append(o)
        return o

    grip_c = h_head + sword_dir * (hb.length * 0.5)
    if WEAPON == "dagger":
        sword_box("daggerGrip", grip_c - sword_dir * 1.8, 0.48, 0.48, 1.8)
        sword_box("daggerGuard", h_tail + sword_dir * 0.2, 2.6, 0.65, 0.55)
        sword_box("daggerBlade", h_tail + sword_dir * 5.3, 1.25, 0.55, 4.8)
        WEAPON_TIP = 10.2
        WEAPON_MID = 5.4
    else:
        sword_box("swordGrip", grip_c - sword_dir * 3.4, 0.55, 0.55, 3.4)
        sword_box("swordGuard", h_tail + sword_dir * 0.3, 4.5, 0.8, 0.7)
        sword_box("swordBlade", h_tail + sword_dir * 12.5, 1.6, 0.65, 11.5)
        WEAPON_TIP = 23.0
        WEAPON_MID = 12.0

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
hbr = arm_data.bones["handR"]
marker("handR", arm.matrix_world @ ((hbr.head_local + hbr.tail_local) / 2), "handR")
hbl = arm_data.bones["handL"]
marker("handL", arm.matrix_world @ ((hbl.head_local + hbl.tail_local) / 2), "handL")
sp = arm_data.bones["spine"]
marker("spine", arm.matrix_world @ ((sp.head_local + sp.tail_local) / 2), "spine")
hd = arm_data.bones["head"]
marker("head", arm.matrix_world @ ((hd.head_local + hd.tail_local) / 2), "head")
if WEAPON != "none":
    marker("bladeTip", h_tail + sword_dir * WEAPON_TIP, "handR")
    marker("bladeMid", h_tail + sword_dir * WEAPON_MID, "handR")

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
# CLAMPED, and measured rather than guessed. The compiler snaps every sample to the nearest canon
# entry, so a material owns a ramp only while its rendered multiplier k stays inside the window
# `tools/spike/lanes.mjs` sweeps. The old 5.0/0.55 pair measured k = 0.02..1.72 on the cloth, wide
# enough that a wine field quantizes into iron and the design silently disappears. These two
# constants are the bisected result; the measured band is recorded in the spec provenance.
sun_data.energy = SUN_ENERGY
sun_data.angle = radians(3)
sun = bpy.data.objects.new("sun", sun_data)
bpy.context.collection.objects.link(sun)
# Key from the top of the frame, 15 deg to the left (SS2.1 Law 2), tipped toward the camera so the
# facing side is lit. Euler set directly: X tips the beam toward +Y (over the camera's shoulder),
# negative Y yaws it so the light comes from screen-left.
sun.rotation_euler = (radians(SUN_PITCH), radians(SUN_YAW), 0)

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (*srgb_to_linear(AMBIENT_COLOR), 1.0)
bg.inputs[1].default_value = AMBIENT_STRENGTH

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

if WEAPON == "none":
    # SS8's SHARED BODY GRAMMAR, not an attack chain: with no weapon there is no swing to author, and
    # the five cells the greatsword spends on its arc buy hurt / death / dodge / fall / land instead.
    # Exactly five, so FRAMES stays 14 and the 4x4 grid needs no compiler work.
    POSES.pop("swingAnticipate"), POSES.pop("swingCommit"), POSES.pop("swingImpact")
    POSES.pop("swingFollow"), POSES.pop("swingRecover")
    POSES.update({
        # Lost initiative: the trunk thrown BACK, head last to arrive, both arms splayed wide so the
        # silhouette gains width exactly where idle had none.
        "hurt": BASE + [
            # The recoil is carried ENTIRELY by the chest, head and arms: pelvis and spine keep their
            # BASE angles, untouched. The cape hangs off `spine`, and tipping the trunk back by even
            # 7 degrees takes its whole face out of the key — measured, that flipped the north cape
            # from purple3 to purple2 in one frame and failed `identity:sheet:hurt` at 0.46-0.50.
            ("R", "chest", "X", -18), ("R", "head", "X", -23),
            ("R", "chest", "Z", -7), ("R", "head", "Z", 11),
            ("A", "upperArmR", (0.62, -0.20, -0.66)), ("A", "foreArmR", (0.82, -0.34, -0.28)),
            ("A", "upperArmL", (-0.62, -0.20, -0.66)), ("A", "foreArmL", (-0.82, -0.34, -0.28)),
            ("R", "thighR", "X", -14), ("R", "shinR", "X", 24),
            ("R", "thighL", "X", 6), ("R", "shinL", "X", 6),
            ("T", "pelvis", (0, 2.8, -1.4)),
        ],
        # A collapse onto the knees, not a lie-down: the pivot still lands on `feetCenter`, and the
        # cape and crest stay in frame so `identity:sheet:death` still reads as the same character.
        #
        # LEG ARITHMETIC, because getting it wrong sinks the sprite into the floor and the only
        # symptom is an edge-clearance failure. With a hip drop d, thigh angle a from vertical and
        # an ABSOLUTE shin angle s = a + shin_rotation, the ankle lands at
        #     z = (13.5 - d) - 6.5*cos(a) - 5.4*cos(s)      and standing (0,0,0) gives 1.6.
        # So d = 11.9 - 6.5*cos(a) - 5.4*cos(s) keeps the feet ON the floor at any crouch depth.
        "death": BASE + [
            ("R", "spine", "X", 26), ("R", "chest", "X", 14), ("R", "head", "X", 22),
            ("R", "pelvis", "Z", 8), ("R", "spine", "Z", 11),
            ("R", "thighR", "X", -10), ("R", "shinR", "X", 112),      # a =10, s =102: heel back, up
            ("R", "thighL", "X", -4), ("R", "shinL", "X", 100),
            ("R", "thighR", "Y", -6), ("R", "thighL", "Y", 6),
            ("A", "upperArmR", (0.40, -0.62, -0.68)), ("A", "foreArmR", (0.26, -0.86, -0.44)),
            ("A", "upperArmL", (-0.34, -0.66, -0.67)), ("A", "foreArmL", (-0.20, -0.88, -0.43)),
            ("T", "pelvis", (0, -0.6, -6.4)),
        ],
        # The tuck launch: everything coils toward the direction of travel before the feet leave.
        "dodge": BASE + [
            ("R", "spine", "X", 24), ("R", "chest", "X", 11), ("R", "head", "X", 9),
            ("R", "thighR", "X", -70), ("R", "shinR", "X", 100),      # a =70, s =30
            ("R", "thighL", "X", -64), ("R", "shinL", "X", 94),
            ("A", "upperArmR", (0.34, -0.64, -0.69)), ("A", "foreArmR", (0.18, -0.88, -0.26)),
            ("A", "upperArmL", (-0.34, -0.64, -0.69)), ("A", "foreArmL", (-0.18, -0.88, -0.26)),
            ("T", "pelvis", (0, -1.6, -4.9)),
        ],
        # Airborne apex: feet clear of the authored floor plane, which is why the clip declares
        # `grounded: false` — there the pivot spread IS the lift, not foot-sliding.
        "fall": BASE + [
            ("R", "spine", "X", 32), ("R", "chest", "X", 16), ("R", "head", "X", 15),
            ("R", "thighR", "X", -88), ("R", "shinR", "X", 96),
            ("R", "thighL", "X", -78), ("R", "shinL", "X", 90),
            ("A", "upperArmR", (0.30, -0.82, -0.48)), ("A", "foreArmR", (0.12, -0.94, 0.30)),
            ("A", "upperArmL", (-0.30, -0.82, -0.48)), ("A", "foreArmL", (-0.12, -0.94, 0.30)),
            ("T", "pelvis", (0, -1.0, 5.4)),
        ],
        # The plant: weight caught on a wide base, the right hand dropped toward the floor.
        "land": BASE + [
            ("R", "spine", "X", 17), ("R", "chest", "X", 8), ("R", "head", "X", 11),
            ("R", "thighR", "Y", -9), ("R", "thighL", "Y", 9),
            ("R", "thighR", "X", -58), ("R", "shinR", "X", 83),       # a =58, s =25
            ("R", "thighL", "X", -50), ("R", "shinL", "X", 74),
            ("A", "upperArmR", (0.46, -0.58, -0.67)), ("A", "foreArmR", (0.36, -0.42, -0.83)),
            ("A", "upperArmL", (-0.58, -0.28, -0.60)), ("A", "foreArmL", (-0.66, -0.22, -0.52)),
            ("T", "pelvis", (0, -1.3, -3.7)),
        ],
    })

if WEAPON == "dagger":
    # A short weapon earns a different body. The attack stays low, travels forward, keeps the
    # off-hand between chest and threat, and recovers inside the silhouette. Reusing the greatsword
    # arc with a shorter mesh would be the exact "weapon glued to a hand" failure this stress lane
    # exists to expose.
    DAGGER_STANCE = [
        ("R", "thighR", "Y", -5), ("R", "thighL", "Y", 5),
        ("R", "shinR", "X", 22), ("R", "shinL", "X", 18),
        ("R", "thighR", "X", -17), ("R", "thighL", "X", -12),
        ("T", "pelvis", (0, 0, -3.0)),
    ]
    POSES.update({
        "swingAnticipate": BASE + DAGGER_STANCE + [
            ("R", "pelvis", "Z", -10), ("R", "spine", "Z", -18), ("R", "spine", "X", 9),
            ("A", "upperArmR", (-0.45, 0.30, 0.12)), ("A", "foreArmR", (-0.66, 0.18, 0.08)),
            ("A", "handR", (-0.75, 0.12, 0.02)),
            ("A", "upperArmL", (0.20, -0.72, 0.28)), ("A", "foreArmL", (0.18, -0.82, 0.12)),
            ("T", "pelvis", (0, 0.8, -0.6)),
        ],
        "swingCommit": BASE + DAGGER_STANCE + [
            ("R", "thighR", "X", -28), ("R", "shinR", "X", 36),
            ("R", "pelvis", "Z", 5), ("R", "spine", "Z", 12), ("R", "spine", "X", 12),
            ("A", "upperArmR", (0.38, -0.78, 0.10)), ("A", "foreArmR", (0.62, -0.74, 0.05)),
            ("A", "handR", (0.82, -0.52, 0.02)),
            ("A", "upperArmL", (-0.12, -0.78, 0.22)), ("A", "foreArmL", (-0.18, -0.86, 0.10)),
            ("T", "pelvis", (0, -1.2, -1.4)),
        ],
        "swingImpact": BASE + DAGGER_STANCE + [
            ("R", "thighR", "X", -34), ("R", "shinR", "X", 42),
            ("R", "thighL", "X", 8), ("R", "pelvis", "Z", 15), ("R", "spine", "Z", 24),
            ("R", "spine", "X", 14), ("R", "head", "Z", -12),
            ("A", "upperArmR", (0.78, -0.50, 0.05)), ("A", "foreArmR", (0.92, -0.30, 0.02)),
            ("A", "handR", (0.98, -0.12, 0.00)),
            ("A", "upperArmL", (-0.24, -0.70, 0.20)), ("A", "foreArmL", (-0.32, -0.78, 0.08)),
            ("T", "pelvis", (0.8, -2.0, -1.8)),
        ],
        "swingFollow": BASE + DAGGER_STANCE + [
            ("R", "pelvis", "Z", 24), ("R", "spine", "Z", 31), ("R", "head", "Z", -18),
            ("A", "upperArmR", (-0.45, -0.62, 0.04)), ("A", "foreArmR", (-0.66, -0.48, 0.02)),
            ("A", "handR", (-0.80, -0.32, 0.00)),
            ("A", "upperArmL", (0.18, -0.62, 0.30)), ("A", "foreArmL", (0.22, -0.76, 0.14)),
            ("T", "pelvis", (0.4, -1.0, -1.0)),
        ],
        "swingRecover": BASE + DAGGER_STANCE + [
            ("R", "pelvis", "Z", 5), ("R", "spine", "Z", 8), ("R", "spine", "X", 8),
            ("A", "upperArmR", (-0.20, 0.18, 0.05)), ("A", "foreArmR", (-0.34, 0.08, 0.02)),
            ("A", "handR", (-0.52, 0.02, 0.00)),
            ("A", "upperArmL", (0.12, -0.55, 0.25)), ("A", "foreArmL", (0.14, -0.66, 0.10)),
            ("T", "pelvis", (0, -0.2, -0.4)),
        ],
    })

ACTION_FRAMES = (["hurt", "death", "dodge", "fall", "land"] if WEAPON == "none" else
                 ["swingAnticipate", "swingCommit", "swingImpact", "swingFollow", "swingRecover"])
FRAME_ORDER = ["idle"] + [f"run{i}" for i in range(8)] + ACTION_FRAMES
SWORD_FRAMES = {f for f in FRAME_ORDER if f.startswith("swing")}
FACING_ROT = {"south": 0.0, "north": pi, "east": pi / 2}

# ---------------------------------------------------------------- render + export
os.makedirs(OUT, exist_ok=True)
only = set(ONLY.split(",")) if ONLY else None
rig = {"px": PX, "canvas": CANVAS, "scale": PX / CANVAS, "pitchDeg": math.degrees(PITCH),
       "legScale": LEG_SCALE, "feetRow": FEET_ROW, "weapon": WEAPON, "armor": ARMOR,
       "sunEnergy": SUN_ENERGY, "ambientStrength": AMBIENT_STRENGTH,
       "variant": VARIANT, "facings": {}}

for facing in FACINGS:
    arm.rotation_euler = (0, 0, FACING_ROT[facing])
    os.makedirs(os.path.join(OUT, facing), exist_ok=True)
    rig["facings"][facing] = {"frames": {}}
    for fname in FRAME_ORDER:
        if only and fname not in only:
            continue
        swing = fname in SWORD_FRAMES
        # The dagger lunge travels farther through the body than the greatsword plant. Give those
        # five cells two extra rows of recovery room instead of waiving a clipped foot.
        if swing:
            feet_row = 55 if WEAPON == "dagger" else 57
        elif fname.startswith("run"):
            feet_row = 58
        elif WEAPON == "none" and fname in ACTION_FRAMES:
            # The five shared-grammar cells travel further through the body than idle does; give
            # them the same three rows of recovery room the greatsword plant gets.
            feet_row = 57
        else:
            feet_row = FEET_ROW
        EAST_OX = {"swingAnticipate": 38, "swingCommit": 34, "swingImpact": 26,
                   "swingFollow": 26, "swingRecover": 30}
        origin_x = EAST_OX.get(fname, 32) if facing == "east" and WEAPON == "greatsword" else 32
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
        for k in ("px", "canvas", "scale", "pitchDeg", "legScale", "feetRow", "weapon", "armor", "variant"):
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
