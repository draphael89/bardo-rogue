# Bardo Rogue: Art Direction

This is the target function. Read it before you author any asset, tune any light, or judge any frame.

Eleven critic rounds on one empty room lost eleven times, and the named gap was the same sentence every time: *assembled, not authored*. The builder had no written target, so it hill-climbed on "more furniture, bigger plate, slight asymmetry." This document replaces guessing with rules. A rule you can measure beats a reference you can admire.

**How to use it.** A builder reads the sections for the surface class it is about to make. A critic names every gap as "violates §N" and cites the number. Taste is not a gap. See §11.

---

## §0. Fixed constraints

Do not relitigate these. Build to them.

| Constraint | Value | Why it is fixed |
|---|---|---|
| Internal render target | 480 × 270 | Integer-upscales perfectly to 1080p (4×) and 1440p. It is Hyper Light Drifter's exact resolution. Measured clean today. |
| World grid | 16 px per tile | The sim, collision, and every shipped tile assume it. |
| Lineage | Elevated pixel art (Gungeon / HLD) | Not Hades' HD painted rendering. We study Hades for light, mass, and composition, never for its brushwork. |
| Character canvas | 32 × 32 (see §4.1) | Decided here. Most expensive decision to reverse. |
| Damage rule | No untelegraphed damage | The telegraph is a visual budget, not a gameplay footnote. See §6.7. |

**Build to the renderer we have.** The stack already gives you: a baked 1× room texture (`tilemap.ts` renders the whole floor into one `RenderTexture`), arbitrary 1× vector overlays baked into that same texture, a multiplied lightmap with tinted additive sources (`light.ts`), additive atmosphere sprites, and a colour grade. Everything in this document is reachable with those. Nothing here asks for a new renderer.

---

## §1. Palette

Canonized from `tools/make-bardo-tiles.ts`. This palette is the only authored identity artifact the project has. Do not invent a replacement. Extend it by realm (§9), never by whim.

### 1.1 Value bands

Value, not hue, is the load-bearing axis. Every colour belongs to a band. Bands are relative luminance (0.2126R + 0.7152G + 0.0722B).

| Band | Luminance | Role |
|---|---|---|
| **B0 Void** | 0–8 % | Outside the room. Deepest occlusion. |
| **B1 Ground** | 8–20 % | Floor body, wall face, cloth, wood. Most of the frame lives here. |
| **B2 Form** | 20–35 % | Lit floor, prop bodies, shadow side of characters. |
| **B3 Edge** | 35–52 % | Prop lit faces, character bodies, worn metal. |
| **B4 Trim** | 52–72 % | Bone, gold, wall cope, character highlights. Small areas only. |
| **B5 Light** | 72–95 % | Specular, flame cores, stars, telegraphs. Tiny areas only. |

### 1.2 Canon palette

**Shadow / void**

| Name | Hex | Band | Use |
|---|---|---|---|
| `void` | `#08070E` | B0 | Space outside the room. Deepest crevice. |
| `mortar` | `#0A0C12` | B0 | Wall joints, hard occlusion. |
| `grout` | `#0C0E16` | B0 | Floor joints. |
| `seal0` | `#12141C` | B1 | UI panel fill, dark inlay. |
| `slate0` | `#1C2434` | B1 | Floor body, contact shadow. |

**Stone**

| Name | Hex | Band | Use |
|---|---|---|---|
| `slate1` | `#2E3A4E` | B2 | Floor slab body. |
| `slate2` | `#425066` | B2 | Lit slab face. |
| `slate3` | `#58667C` | B3 | Slab north edge. |
| `slateHi` | `#76849A` | B4 | Chip, specular on wet stone. Under 2 % of a tile. |
| `nave0` `nave1` `nave2` | `#343C4C` `#485262` `#5E6876` | B2–B3 | Second stone family. Use to make one floor area read as a different quarry. |
| `naveWarm` | `#5C503A` | B2 | Warm stain in stone. The only warm in the floor. |

**Wall (use with §2.3 — the wall is dark)**

| Name | Hex | Band | Use |
|---|---|---|---|
| `brickLo` | `#767E8E` | B3 | Wall face body. **Ceiling value for a wall face.** |
| `brick` | `#949CAC` | B4 | Wall course highlight. 1 px runs only. |
| `brickHi` | `#BCC2D0` | B4 | Reserved. Cope underside. |
| `cope` | `#D2D8E2` | B4 | Wall top cap, 1–2 px. |
| `copeHi` | `#ECF0F6` | B5 | Cope specular, 1 px, on the key-light side only. |

**Metal**

| Name | Hex | Band | Use |
|---|---|---|---|
| `iron` | `#26262E` | B1 | Iron body. |
| `ironHi` | `#4C4C56` | B2 | Iron lit face. |
| `goldDim` | `#8C7040` | B3 | Gold shadow. Panel borders. |
| `gold` | `#D4B060` | B4 | Gold body. **The threshold colour (§8).** |
| `goldHot` | `#F0D080` | B5 | Gold specular. 1–2 px. |

**Supernatural**

| Name | Hex | Band | Use |
|---|---|---|---|
| `sky` | `#0E122C` | B0 | Inside every window, door, and well. Star-sky. |
| `star` | `#B0C4FF` | B4 | Star pixel, cold. |
| `goldStar` | `#FFE2A0` | B5 | Star pixel, warm. 1 in 3 stars. |
| `ember` | `#FF7A18` | B3 | Flame body. |
| `emberHi` | `#FFCC56` | B5 | Flame core. |
| `emberLo` | `#B03010` | B2 | Flame shadow, scorch. |

**Cloth / organic**

| Name | Hex | Band | Use |
|---|---|---|---|
| `purple0` | `#2A0E1C` | B0 | Wine cloth shadow. |
| `purple1` | `#4E1C2E` | B1 | Wine cloth body. |
| `purple2` | `#762E40` | B2 | Wine cloth lit. |
| `purple3` | `#9E4658` | B3 | Wine cloth highlight. |
| `boneLo` | `#5A4E42` | B2 | Bone hollow. Warm, never grey. |
| `boneDim` | `#90806C` | B3 | Bone shadow face. |
| `bone` | `#D0C0A8` | B4 | Bone body. The eye's second stop. |
| `woodLo` | `#261A16` | B1 | Wood shadow. |
| `wood` | `#3C2A22` | B1 | Wood body. |
| `woodHi` | `#5C4230` | B2 | Wood lit face, plank end. |

**Ambient (renderer, not pixels)**

| Name | Hex | Use |
|---|---|---|
| `ambientTint` | `#1E1C38` | Indigo void. Every room's fill light. Never change it; change what intrudes on it. |

### 1.3 Palette rules

1. **Max colours per asset.** Floor/wall tile: **10**. Prop (32×32): **12**. Character (32×32): **16**. Boss: **24**. Effect sprite: **6**. Counting includes the outline colour and excludes full alpha.
2. **No off-palette colour without a realm entry.** The current 32×32 props use ad-hoc spring green `#56C448`, pot red `#9C302A`, book blue `#30488C`. These belong to no family and read as clip art dropped into the room. Fold them into a realm ramp or delete them.
3. **Every asset spans at least 3 bands.** An asset entirely inside one band has no form.
4. **No pure black, no pure white.** Ever. `#08070E` and `#ECF0F6` are the ends.
5. **Fractional alpha is not a colour.** See §2.1.

---

## §2. Materials

This section is the one that lost eleven rounds. The current tiles are a flat fill, a symmetric bevel, and 7 % random noise flecks. That is a texture swatch, not a material. A material has weight when it shows **where the light comes from**, **where it has been worn**, and **what it is joined to**.

### 2.1 The four laws

**Law 1 — Three scales.** Every surface carries variation at three scales:
- **Macro (2–6 tiles):** a stain, a wear path, a crack run, a soot fan, a baked light pool. Crosses tile boundaries. *This is the scale the room has none of today, and it is the whole difference between a floor and a texture.*
- **Meso (within one tile):** the slab's own break-up, a chip, a joint that is not straight.
- **Micro (1–2 px):** pitting. Under 6 % of the tile. **Clustered at edges and low points, never uniform-random.** Uniform noise reads as film grain and flattens everything under it.

**Law 2 — One light direction, always.** Key from the top of the frame (north), 15° to the left. Every solid form gets four parts: a 1 px highlight on its north edge, a body value, a 1–2 px core shadow on its south edge, and a **cast shadow on whatever is south of it**. A bevel that is identical on all four sides is a border, not lighting. That is what the current `slabFloor` draws.

**Law 3 — Occlusion is not optional.** Wherever two surfaces meet, darken the joint by at least 2 bands below the darker surface, for 1–3 px.
- Wall meets floor → a 3 px gradient strip running the whole wall.
- Prop meets floor → a hard-edged contact ellipse, `slate0` at 36 % (already shipped; keep it).
- Slab meets slab → a 1 px `grout` joint that varies in value where the floor is wet or shadowed.

Missing occlusion is the single largest cause of "assembled, not authored."

**Law 4 — Value carries material, hue carries realm.** Two adjacent materials must differ by **≥ 2 value bands**, or by **≥ 60° of hue at equal value**. Equal value plus close hue means the transition vanishes at 1×. Lit faces shift warm **and desaturate** toward the light colour; shadow faces shift cool toward `ambientTint`. A material shaded by scaling RGB uniformly reads as plastic.

**Law 5 — No anti-aliasing in a 1× bake.** Any `Graphics` primitive baked into the room texture (`bakeSeal`, the prop shadow ellipses) produces anti-aliased edges and fractional-alpha pixels that are not in the palette. This is why the dais reads as a sticker pasted on the floor. **Rule: primitives baked at 1× use integer-aligned rectangles at alpha 1.0, or they are replaced by authored tiles.** Curves are authored, not stroked.

### 2.2 Floor stone

Minimum 5 values: joint (B0), shadow face (B1), body (B2), lit face (B2–B3), chip (B4, ≤ 2 % of the tile).

- Slabs come in **at least two sizes** and **must cross tile boundaries**. A slab that is exactly one tile is a grid, and a grid reads as graph paper. This is the single loudest failure in the current floor.
- Joints are 1 px and are not perfectly straight.
- Bake a **wear path** where the player walks: one band brighter, softened edges, following the room's traffic, not the grid.
- Floor mean luminance stays **below 30 %**. The floor is the darkest large area in the room.

### 2.3 Wall face

**The wall is dark.** Body at B1–B2, never above B3 (`brickLo` is the ceiling).

- Exactly one bright element per wall: the **top cope**, 1–2 px of B4–B5. That is the only place the key light lands.
- Below the cope, a 3–4 px vertical gradient falling into the floor's shadow.
- Brick courses read as a **one-band value change**, never as a full outlined grid.

Today's wall runs `brickLo` → `copeHi` (B3 → B5) across every course, edge to edge, around the whole room. It is the brightest and busiest large area in the frame, so the eye reads the wall ring and not the room. Fixing this one rule fixes more of the eleven-round gap than any furniture.

### 2.4 Metal

Metal is a **value range**, not a value. Minimum 5 values inside a 6 px object, and the two extremes must touch: a hard highlight adjacent to a hard shadow with no midtone between, for 1 px.

- Gold ramp: `void` (crevice) → `goldDim` → `gold` → `goldHot` (1–2 px specular).
- Iron ramp: `mortar` → `iron` → `ironHi` → `slateHi` (1 px).
- Outline metal in its own darkest value, never black.
- Worn metal breaks its highlight into 2–3 segments. A continuous highlight along a full edge reads as plastic.

### 2.5 Cloth

Cloth has **no specular**. Max 4 values, all within 2 bands.

- Read cloth by fold *shape*, not by gradient. A fold is a 1 px dark line with a 1 px lighter line beside it. Folds converge toward the point where the cloth is held or drapes over an edge.
- Rugs and banners: a woven micro pattern at a 2 or 4 px repeat, plus a border made of a **different material** (fringe in `bone`, B4).
- Cloth never touches B5.

### 2.6 Bone

Bone is B4, low chroma, **warm**. It is the lightest material allowed inside a room besides light itself, so it is the eye's deliberate second stop. Use it sparingly.

- Three values, hard terminator, no gradient.
- Deep hollows use `boneLo` `#5A4E42` — warm brown. Grey shadow on bone is the fastest way to make it look like plastic.

### 2.7 Wood

Wood is B1–B2 and warm.

- Grain runs along the plank's long axis as broken 1 px lines of ±1 band. Never full-length lines.
- Plank **ends** are the only place a bright value appears.
- Iron banding is what makes wood read as furniture instead of a brown rectangle. Untrimmed wood is a §10 forbidden barrel.

### 2.8 Glass and void

Never shade glass.

- Glass is a flat B0–B1 fill plus specular streaks at B5, at a fixed 2:1 diagonal, covering under 15 % of the pane.
- **Star-sky panes** (the bardo's signature): fill `sky #0E122C`, single-pixel stars at ≤ 6 % density, two in three `star`, one in three `goldStar`. The frame's inner edge gets 1 px of `goldDim` as bounce.
- **The void outside the room**: `void #08070E`, same stars at ≤ 1 % density. It is never a solid black rectangle.

---

## §3. Light hierarchy

### 3.1 The anti-pattern, named

The current arena places braziers at `(0,7)` and `(25,7)` — inside the left and right walls, at the frame's edges — plus two on the north wall. The playable centre, where the eye goes and the fight happens, is the **least-lit** area, lifted only by a 0.32 vignette against a wall that is already B4–B5.

**This is backwards and it is a §3 violation.** Light the fight. Let the frame edges fall away.

### 3.2 The rules

1. **One key light per room.** Everything else is fill or accent.
2. **The key lights the focal object** (§5.1), or the focal object *is* the key.
3. **The playable centre is 1–2 bands brighter than the perimeter.** The perimeter falls to B0–B1 at the frame's edge. Light pools; it does not wash.
4. **Source budget: 1 key + at most 2 named accents + ambient.** Any further source must be a gameplay signal — a telegraph, a pickup, an open door.
5. **Brightness rank.** The brightest pixels in any frame belong to, in order: (1) an active telegraph or hit flash, (2) the player's weapon specular and player light, (3) the focal object's specular, (4) a flame core. **Static architecture is never in the top rank.** If the wall cope is the brightest thing on screen, the frame is wrong. So is a HUD heart (see §7.6).
6. **Warm key, cool ambient.** Ambient stays indigo `#1E1C38`. Warm light is always an intrusion into it. Every realm keeps this split; only the hues change.
7. **Bake the pool, do not only vignette it.** The room texture is already a single baked `RenderTexture`. Paint the centre floor one band brighter *in the art*, then let the lightmap add flicker on top. A vignette alone cannot create hierarchy because it does not know where the focal object is.
8. **Cast shadows are fixed and hard.** Direction south, 15° right. Length ≈ 0.4 × object height. Alpha ≈ 0.35. Hard-edged ellipse or offset silhouette. Never a blur.

---

## §4. Silhouette language

### 4.1 Character canvas: 32 × 32 — DECISION

**Decision: the hero and all humanoid enemies are authored on a 32 × 32 canvas, with visible art at most 26 px tall, feet anchored at row 30, leaving 2 px of contact-shadow room.**

Reasons:
- 16 px characters cannot carry the bar. In the round-11 capture the hero is a smudge at 6 % of frame height and loses to every prop in the room.
- 32 px is **already proven in this pipeline**: `bardo_props.png` ships 32 × 32 sprites through the same atlas and sort path.
- 32 is exactly 2 tiles, so authoring aligns to the 16 px grid. It is a power of two, so atlas maths stays trivial.
- A ~24 px visible body reads as 1.5 tiles, which is the Gungeon proportion.
- The 6–8 px of headroom holds helm crests, weapon arcs, hair, horns, and squash without a second atlas.
- **It costs the sim nothing.** Collision stays at radius 5, the feet anchor and feet-Y sort already exist, and the sprite simply overhangs its collider — exactly as the 32 px props already do.

**This is the most expensive decision in this document to reverse.** Once a frame set is authored at 32, every animation, every atlas cell, and every hand-placed pivot is sized to it. Change it before the first character sheet, or never.

Other canvases: small/flying enemy **24 × 24**. Large enemy or miniboss **48 × 48**. Boss **96 × 96** or **128 × 128**. Floor decal prop **16 × 16**. Prop with mass **32 × 32**. Wide furniture **48 × 32**.

### 4.2 The black test

Fill the sprite with solid black at 1× and place it on mid grey. If you cannot **name it** and **tell which way it faces** in one frame, it fails. Run this before shading anything.

### 4.3 Rules

1. **One silhouette hook per character.** A shape no other character has, at least 4 px, breaking the outer contour. Hero: a split helm crest. Brute: an asymmetric over-shoulder mass. Caster: a hooked staff head above the body line. Charger: a low legless wedge.
2. **Class reads by proportion before colour.** Brute: wide, low, top-heavy, width ≥ 0.8 × height. Caster: narrow and vertical, width ≤ 0.5 × height. Charger: wide and short, horizontal axis.
3. **Outline: 1 px, never pure black.** Use the darkest value of the material it bounds, and go darker on the side away from the key. Full black outlines flatten at this scale.
4. **Ground separation.** Every character's mid value sits **≥ 2 bands** from the floor's mean. The floor is B1–B2, so characters live at B3–B4 with B5 accents. This is why Gungeon's player is hot orange on a navy floor and why ours currently disappears.
5. **Architecture has a silhouette too.** A room's outline must be describable in one sentence. Walls may be non-rectangular. Every room carries at least one large non-grid form: an arc, a diagonal, a broken corner.

---

## §5. Composition

### 5.1 The focal-object rule

**One memorable object per room.** It is:
- **Off-centre.** On the 26 × 15 grid, its centre lands near col 9 or col 17, and near row 6 or row 10. **Never at col 13, row 7–8.**
- **Large.** At least 3 × 3 tiles.
- **Massed.** It occludes things behind it and casts a shadow. A floor decal is not a focal object. *A flat plate with a graphic circle on it is a floor decal.*
- **Lit.** It gets the key (§3.2).
- **Describable.** You could tell someone who has not seen the room what it is.

### 5.2 The symmetry ban

Mirror the frame horizontally. If **more than 60 %** of prop cells land on a prop cell, redo the room.

Near-symmetry is allowed — Gungeon uses it. It only works when the mirrored pairs differ in **kind, count, or Y**. The current room mirrors chairs, plants, runners, pillars, counters, and windows at identical Y. Two identical chairs at identical Y is the failure mode, not symmetry itself.

### 5.3 A floor you would remember

Concretely, the floor has all three:
1. **Three or more distinct materials** in areas of **unequal** size. Not two mirrored runners on a field.
2. **One large graphic form spanning ≥ 6 tiles that is not axis-aligned to the tile grid.** A diagonal, an arc, a spiral, a broken ring. The room texture is a baked `RenderTexture`, so this costs one authoring pass and zero runtime.
3. **Evidence of use:** a wear path, a scorch fan, a stain, a crack that runs somewhere and stops for a reason.

### 5.4 Space and density

- **Negative space: ≥ 35 % of the playable floor is free of props and free of pattern.** The fight needs quiet ground, and quiet ground is what makes the busy parts read.
- **Density gradient:** props cluster at the room's edges and thin toward the centre. Never distribute evenly.
- **Three depth cues per room, minimum:** occlusion (something in front of something), a cast shadow, and a value gradient from floor to wall.

---

## §6. FX and particles

Everything is authored and composited at 480 × 270, before the upscale. Nothing is authored at output resolution.

1. **Integer pixels.** Particles snap to integer positions at 480 × 270. Rotation quantizes to 8 or 16 steps. A freely rotating soft sprite is the loudest "not pixel art" tell there is.
2. **No visible soft gradient.** A gradient may live in the multiplied lightmap. It may never appear as an additive blob over the scene. If you can see the falloff ring, it is wrong. The current door glow and motes ride soft 64 px circles at alpha 0.55 and are on the edge of this rule.
3. **Sparks:** 1×1 or 1×2 px, B5, at most 3 hues, straight travel, hard cut, no tail longer than 4 frames. Sparks never scale.
4. **Blood and ichor:** chunky. 2×2 and 3×2 blobs, 3 values, hard dark rim on the ground decal. Decals persist, darken by one band, then stop.
5. **Dust:** 2–4 discrete sprites of 4–8 px with a 4-frame hand-authored expansion. Not a scale tween on one sprite.
6. **God-rays and fog quantize.** Step their alpha to 4 levels, or draw them as hard-edged pixel wedges. Continuous alpha over hard 16 px pixels is exactly the "soft full-res gloss" failure.
7. **Telegraph budget (the "no untelegraphed damage" rule).** Every damaging event owns three beats:
   - **ANNOUNCE**, ≥ 12 ticks before contact. A hue appears that exists nowhere else in the room.
   - **COMMIT**, ≥ 6 ticks. The *shape* of the hit is drawn on the ground or in the air.
   - **STRIKE**, 1–5 ticks. The hit. The brightest pixels in the frame.

   **Hue reservation.** Hostile telegraphs use the realm's reserved hostile hue (§9). Player and friendly telegraphs use `gold` → `goldHot`. No static asset in a realm may fill more than 16 contiguous pixels with that realm's hostile hue.
8. **Known violation to fix.** `postfx.ts` applies the chromatic aberration filter to the **upscaled** quad with an offset in output pixels. At 4× upscale a 2 px offset is a half-world-pixel colour fringe — soft-res gloss over hard pixels, in violation of §6.1. Quantize the offset to a multiple of the upscale factor, or move the filter before the upscale. The grade filter is fine: it is a per-pixel op with no resampling.

---

## §7. UI and type

1. **The HUD lives in the outer 24 px band** of the 480 × 270 frame and never overlaps playable floor.
2. **One bitmap font.** 5×7 caps and lowercase with 1 px descenders, 1 px letterspacing, 8 px line height. **No anti-aliasing. No sub-pixel positions.** A second display face at 8×10 is used only for room names and deity names.
3. **Text colour:** `bone #D0C0A8` on a void panel, or `gold #D4B060` for emphasis. **Never pure white** — it competes with the light hierarchy.
4. **Panels:** 1 px `goldDim` border, 1 px `void` inner shadow, `#12141C` fill at 82 % alpha. Corners are authored 3×3 pieces, not a rounded rect primitive.
5. **Resource icons** (hearts, charges, currency) are authored 8×8 or 9×9 sprites, never primitives. The empty state is a `boneDim` outline, not a grey fill.
6. **The HUD is B3–B4, maximum. It may never be the brightest thing in a frame.** In the round-11 capture the five red hearts are the most saturated pixels on screen, which is a §3.2.5 and a §7.6 violation at the same time.
7. **Room title stays.** "THE THRESHOLD" at bottom-centre, 8×10 display face, `gold`, +2 letterspacing, fading in over 20 ticks and out after 120. It is part of the motif (§8.3).

---

## §8. The bardo motif

The game already has a motif nobody wrote down. Here it is, canonized.

### 8.1 The frame

**Every space floats.** Rooms sit in `void #08070E` with sparse stars. No room ever touches the frame's edge — there is always void beyond the wall. This is the strongest identity asset the project owns. It is never dropped, in any realm, for any reason.

**Ambient is always indigo `#1E1C38`.** Warm light is always an intrusion into it.

### 8.2 What threshold imagery always contains

Every room, transition, and set piece contains all five:

1. **An opening onto the star-sky.** A door, window, crack, or well whose interior is `sky` + stars — never a solid fill, and never a room beyond it.
2. **Gold on stone.** `gold` marks a crossing and nothing else: door frames, seals, a scale's beam, a boundary line cut in the floor. It is never generic treasure trim.
3. **A named floor.** The room's name exists in the world, not only in the HUD — cut into the floor, worn into stone, carved on a stele. The player can read where they are with the HUD off.
4. **Something unfinished.** A crack, a missing slab, an unlit brazier, a chair pushed back. The bardo is a waiting room and waiting rooms show that someone left.
5. **Two of what the living use, one of what the dead use.** Doors come in pairs (the one you came from, the one you go to). Shrines, scales, biers, and mirrors are always single. This is a motif rule that also does composition work.

### 8.3 Forbidden in bardo framing

Clocks. Hourglasses. Literal scales of justice outside Duat. Mist used as the answer to everything. Ghost-sheet apparitions. "Limbo grey" — the bardo is indigo and gold, not desaturated nothing.

---

## §9. Three realms

Each realm is a data package: one palette extension, one material set, one architecture silhouette, one lighting recipe, one signature set piece, one reserved hostile hue, one forbidden list. Every realm keeps the canon shadow ramp (`void` / `grout` / `slate0`) and the `gold` accent family. Only the body family and the supernatural hue swap.

Chosen for maximum separation across three axes: **warm/high-value**, **cold/low-chroma**, **dark/high-chroma**. Greek is deliberately deferred — it is the realm that would read as a Hades copy, and we win nothing by inviting that comparison first.

---

### 9.1 DUAT — The Weighing Floor (Egyptian)

**Axis:** warm, high value, hard sun. The bright realm.

**Palette extension**

| Role | Hex |
|---|---|
| Sandstone shadow | `#2A2318` |
| Sandstone body | `#3E3324` |
| Sandstone lit | `#574734` |
| Sandstone edge | `#6E5B42` |
| Sandstone trim | `#8C7448` |
| Lapis shadow | `#1B4A5C` |
| Lapis body | `#2E7E94` |
| **Lapis hot — hostile hue** | `#6FD2E0` |
| Judgement red | `#7A1F22` |

Plus canon `gold` / `goldHot` / `bone` / `boneLo`.

**Materials.** Cut sandstone with visible chisel courses running horizontally, never a grid. Lapis and gold inlay set flush into stone — the inlay is the only B4+ on the floor. Linen: `bone` family, 3 values, hard folds. Painted plaster: flat colour fields with a 1 px `void` keyline, deliberately graphic, no shading. Sand drifts pool against every south-facing edge.

**Architecture silhouette.** Wide flat trapezoids. Battered walls that lean inward. Long horizontal lintels. Colossal seated figures cropped by the frame so you never see a whole one. Exactly one vertical: an obelisk. The room reads as *low and long with one spike*.

**Lighting.** One hard key from a ceiling slot — a visible shaft, dust-thick, quantized per §6.6. Cool lapis fill from scarab lanterns set low. Highest contrast of the three realms. Hard-edged shadows.

**Signature set piece — The Scale.** A two-pan balance filling the room's centre-left. One pan holds a feather. One pan holds what you have taken. The beam tilts in real time with the player's HP, and the floor beneath the low pan is scorched.

**Forbidden.** Pyramids on the skyline. Trailing-bandage mummies. Torch-and-boulder adventure staging. Hieroglyphs used as texture noise rather than as authored marks.

---

### 9.2 NIFLHEIM — The Rime Court (Norse)

**Axis:** cold, low chroma, low contrast. Separation comes from hue, not value.

**Palette extension**

| Role | Hex |
|---|---|
| Basalt shadow | `#0B0E12` |
| Basalt body | `#171C22` |
| Basalt lit | `#262E36` |
| Ice shadow | `#101A24` |
| Ice body | `#1A2A38` |
| Ice lit | `#27404F` |
| Ice edge | `#3A5A6A` |
| Ice trim | `#6E90A0` |
| Ice specular | `#C8E4F0` |
| Corpse-light body | `#9EC8B4` |
| **Corpse-light hot — hostile hue** | `#D8F0E4` |

**Materials.** Ice is glass (§2.8): flat dark fill, diagonal specular streaks, never shaded — and it shows what is frozen *inside* it. Basalt fractures in hexagonal columns; its grain runs vertical. Frost creeps from every joint outward, 2–4 px, as clustered micro-dither. Furs and cloth are `bone`-family, matte, heavy. **Cold gold is forbidden here:** the canon `gold` appears only on the player's own gear, so the hero stays readable against a realm that shares her value range.

**Architecture silhouette.** Vertical. Fractured basalt columns. Ice sheets standing at angles. A ceiling that is never resolved. Long diagonal cracks crossing the whole room. The room reads as *tall, broken, and unfinished upward*.

**Lighting.** No point lights. One flat overhead ambient plus emissive ice. Fog is dense and eats the room's far edge, so the playable area is defined by where you can still see. The **only warm hue in the entire realm** is the player's ember. That is the light hierarchy, delivered by scarcity.

**Signature set piece — The Frozen Ship.** A longship's prow driven up through the floor at 30°, ice-locked, half its crew still at the oars, all frost-white. It occludes a third of the room, and the fight happens around and under it.

**Forbidden.** Snowflake particles. Christmas blue. Generic ice-cave stalactites. Any teal that reads as an animated feature film.

---

### 9.3 MICTLAN — The Wind of Knives (Aztec)

**Axis:** near-black ground, highest chroma. The floor is the light source.

**Palette extension**

| Role | Hex |
|---|---|
| Obsidian void | `#0A0810` |
| Obsidian shadow | `#150F1C` |
| Obsidian body | `#241A2C` |
| Obsidian lit | `#37263F` |
| Obsidian trim | `#5A3F5E` |
| Turquoise shadow | `#0F5E58` |
| Turquoise body | `#1E9C8C` |
| Turquoise hot | `#56E0C0` |
| Blood deep | `#8A1420` |
| Blood body | `#C4342A` |
| **Marigold — hostile hue** | `#F09A20` |
| Marigold hot | `#FFD060` |

Plus canon `bone` for the abundant bone work.

**Materials.** Obsidian is glass with a **conchoidal** break: every edge is a curved shell-shaped chip, never a straight bevel, with a single 1 px `#56E0C0` catchlight. Carved basalt relief reads by cast shadow only, three values, no highlight. Turquoise is inlaid mosaic — 2×2 px tesserae with 1 px `void` grout, deliberately visible. Bone is structural here, not decorative: rails, lintels, and rungs.

**Architecture silhouette.** Stepped pyramid terraces seen top-down as concentric rectangles at 45°. Every edge is a serrated stone tooth. Rows of upright blades set into the floor. The room reads as *hard steps and teeth*.

**Lighting.** Near-black ambient. Light comes from marigold braziers set low to the floor and from turquoise glyph channels **cut into the floor itself**. The floor is the emitter, so the fight ground is the brightest ground — the exact inverse of the §3.1 anti-pattern, and the reason this realm is worth building second.

**Signature set piece — The Knife Wind.** A wall of obsidian shards crosses the room on a timer. Its telegraph is the floor glyphs brightening in the order they will be crossed, which satisfies §6.7 with architecture instead of a UI overlay.

**Forbidden.** Feathered-headdress mascot enemies. The calendar stone used as wallpaper. Sugar-skull face paint. Chili-red-and-lime as a colour scheme.

---

## §10. Forbidden list

These are proven losing moves. A frame containing one of them fails review before any other judgement.

**Materials and props**
1. Generic fantasy dungeon brick — uniform courses, mid-grey, edge to edge. (§2.3)
2. Medieval barrels and untrimmed wooden crates. (§2.7)
3. Generic torch sconces used as room dressing rather than as the key light. (§3.2)
4. Random clutter placed to fill space. Every prop answers "who put it there and why is it still here." (§5.4)
5. RPG-Maker staging: a rectangular room, a symmetric prop pair per wall, a rug in the middle.
6. Off-palette clip-art colour — spring green, terracotta pot red, primary book blue. (§1.3.2)
7. Identical props repeated at mirrored positions. (§5.2)

**Rendering**
8. Flat fill + symmetric bevel + uniform hash noise. This is what lost rounds 1 through 11. (§2.1)
9. A tile-sized slab. Slabs cross tile boundaries or they are a grid. (§2.2)
10. Anti-aliased or fractional-alpha primitives baked at 1×. (§2.1 Law 5)
11. Soft radial gradients visible over the scene. (§6.2)
12. Freely rotating soft particles. (§6.1)
13. Sub-pixel or non-integer sprite positions at 480 × 270. (§6.1)
14. Pure black or pure white pixels. (§1.3.4)

**Composition and light**
15. The brightest thing in frame being a wall, a HUD element, or a floor plate. (§3.2.5, §7.6)
16. Perimeter lights with a dark centre. (§3.1)
17. A focal "object" that is actually a flat floor decal. (§5.1)
18. A focal object at exact room centre. (§5.1)
19. Bilateral symmetry down the vertical axis. (§5.2)
20. A 16 px character. (§4.1)

**Fiction**
21. A room that touches the frame edge with no void beyond it. (§8.1)
22. Gold used as generic treasure trim rather than as a threshold mark. (§8.2.2)
23. Limbo grey. (§8.3)

---

## §11. Acceptance test

A critic uses this document to convert taste into a citation. The output of a round is **one gap**, and that gap must be expressible in this form:

> **Violates §N.M.** *[the measurement]*, where the rule requires *[the threshold]*. Fix: *[the smallest change that satisfies it]*.

If a critic cannot cite a section, the critic has found a preference, not a gap. Add the rule to this document first, then cite it.

### 11.1 Computable gates

Run these on the captured frame or the baked room texture before any subjective judgement. Each maps to one section.

| Gate | Measure | Pass | Section |
|---|---|---|---|
| Floor value | Mean luminance of playable floor pixels | ≤ 0.30 | §2.2, §3.2.3 |
| Highlight budget | Fraction of static-art pixels above 72 % luminance | ≤ 8 % | §1.1 |
| Brightest pixels | Location of the top 1 % of luminance | Within 64 px of the focal object or a character | §3.2.5 |
| Centre lift | Mean luminance of the centre 60 % vs the outer 20 % | Centre higher by ≥ 1 band | §3.1 |
| Mirror test | Fraction of prop cells matching their horizontal mirror | ≤ 60 % | §5.2 |
| Palette count | Distinct colours per asset | Tile ≤ 10, prop ≤ 12, character ≤ 16 | §1.3.1 |
| AA leak | Distinct colours in the baked room texture vs the declared palette | Equal | §2.1 Law 5 |
| Material weight | Any 8×8 patch of a surface | ≥ 4 distinct values, **and** variation present at ≥ 2 of the 3 scales | §2.1 Law 1 |
| Negative space | Playable floor free of props and pattern | ≥ 35 % | §5.4 |
| Silhouette | Sprite in solid black at 1×, named in one second | Passes for every entity | §4.2 |
| Ground separation | Character mid value vs floor mean | ≥ 2 bands apart | §4.3.4 |
| Focal placement | Focal object centre on the room grid | Not col 13, row 7–8; ≥ 3×3 tiles; casts and occludes | §5.1 |

### 11.2 Round protocol

1. Capture the frame with the harness (`pnpm shot --stepwise 1`).
2. Run §11.1. Any failed gate **is** the gap. If several fail, take the earliest section number — the sections are ordered by leverage, and a §2 failure makes every §5 judgement meaningless.
3. Only when every gate passes does the critic run the blind comparison against the reference.
4. If the reference still wins with all gates green, the gap is a **missing rule**. Write it into this document as a new numbered clause, then send the builder back against the new clause. That is how this document stops the eleven-round loop from repeating.

---

## §12. The generation spec

§1–§11 tell a builder what to make. This section tells the *pipeline* how to make it, and it is
executable: `art/palette/canon.json` is §1 in machine form, `tools/art/generate.ts` quotes §2/§4/§10
into every prompt, and `tools/art/gates.ts` measures §11.1 on every compile. A rule that is not in one
of those three places is a rule the pipeline cannot enforce.

### 12.1 The lanes

Three, and an asset belongs to exactly one:

| Lane | Owns | Tool |
|---|---|---|
| **Generated** | characters, large props, bosses | `pnpm art generate` → `pnpm art compile` |
| **Code** | tiles, materials, autotiles, VFX, telegraphs, HUD chrome | `pnpm tiles`, `pnpm fx` |
| **Runtime** | light, grade, camera, anything that must respond to sim state | `src/render/` |

The code lane is not a stopgap. Anything whose shape is a function of gameplay geometry — a
telegraph that draws the real danger set, an impact whose ramp lands on the damage tick — cannot be
a generated sprite, because a sprite cannot track `tuning.ts`. Generation is for things that are
*drawn*, not for things that are *computed*.

### 12.2 The loop

    spec → generate candidates → gate → HUMAN APPROVES the identity → directions and poses
         → compile → gate → sidecar → pnpm poses / shot / strip → blind critic → commit

One human checkpoint, and it is the identity master. Everything downstream is conditioned on it, so
an unapproved master propagates its faults into every direction and every clip. Nothing else in the
loop asks for a person.

### 12.3 What a generator is told

Never a fresh prompt. `buildPrompt()` assembles: the subject in the game's own words, the canvas from
§4.1, the asset's palette ramp as explicit hex, the silhouette rule for its class from §4.3, the
material and lighting laws from §2.1, and §10's forbidden list as negative constraints. The prompt's
hash is recorded in the sheet's sidecar, so any asset can be traced to the exact words that made it.

### 12.4 Palette ramps are per-asset and deliberate

A character gets 16 canon colours, chosen — not 16 that happened to survive quantisation. Choosing
them is an art-direction act with consequences: the Brute's first ramp included `emberLo`, and a
lifted dark wine mapped nearer that strong red than to any purple, so he read as burning rather than
aproned. Give each material a real ramp (§2.4: metal is a value range) before spending slots on
accents, and write down why in the spec's `paletteNote`.

### 12.5 Value is checked against the rendered floor, not the palette

The floor's slab colours average 0.266 luminance; the floor as *rendered* is 0.130, because the
lightmap multiplies over it. Ground separation (§4.3.4) is measured against the rendered value —
grading a sprite against the raw tile demands a body twice as bright as the room can support. This is
why the Brute shipped at Weber −0.03, darker than the stone he stands on.

### 12.6 The approved pool is the style reference

`art/approved/` holds every master a human has accepted. Each new generation is conditioned on it, so
consistency compounds rather than being re-argued per asset. An asset leaves `.art-cache/` for
`art/approved/` only by human decision, and reaches `public/assets/` only by passing the gates.
