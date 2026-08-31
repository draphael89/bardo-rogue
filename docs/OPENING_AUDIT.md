# Opening Town + Hero — art direction audit, v2

**Date:** 2026-08-30 (evening) · **Branch:** `claude/bardo-rogue-art-phase-2` · **Baseline:** `4ffbab5`
(PR #28 merged) · **Method:** the game played and photographed at 1× through `pnpm shot`, every
number below measured off those PNGs or read out of the shipped sidecars; two forensic passes over
the art pipeline and the hero's animation contract.

v1 of this document graded the build **52/100** *before* PR #28. It is preserved in git history.
This version re-grades what actually ships now and corrects two of v1's conclusions.

Graded against excellent shipped indie games, not against the placeholder it replaced.

**Execution note, 2026-08-30:** source/target parity, colour-placement, detail-density and rejection
receipts are now implemented. A rig-emitted breathing idle plus reach/contact/settle pickup candidate
clears all 2,154 applicable gates with six measured weapon-apex waivers. Contact now plants for four
stopped ticks, while held movement cancels settle into the armed run instead of skating a static pose
through the rack. The candidate remains in `.art-cache` pending human Look and approval, so the
scorecard below is intentionally not regraded yet.

**Composition note, 2026-08-30:** the rendered-frame blind spot is now covered for three named Bardo
moments. Arrival, central axis and Gate plaza each pass a full-band centre-lift check at 640×360/1×
(0.089 vs 0.033, 0.093 vs 0.055, and 0.149 vs 0.049 respectively), plus the existing value,
highlight and top-one focality gates. A source-backed north threshold now breaks the axis's former
four-way equality without changing collision. The named concept exhibits still win all three blind
composition pairs, so §15 item 5 and the scorecard remain open rather than being awarded by metric.

**Actor-candidate note, 2026-08-30:** the Lampad now has a rig-only east candidate whose walking
funeral-lamp silhouette clears 109/109 gates with zero waivers, stays at or below the caster's locked
0.5 width/height ceiling in every pose, and maintains Weber +1.54 to +1.64 across all nine frames.
The chest-height lantern carries a steady flame. The two failed carrier/placard iterations have
rejection receipts. It is not approved or integrated, so the Kenney inventory and scorecard below
remain unchanged.

---

## 1. Executive verdict

**PR #28 was real. The hero is on the grid, crisp, and authored. The next gap is not darkness, not
asset count, and not PixelLab prompting — it is that your light is the wrong colour and your hero has
no face.**

Three findings reframe the work, and two of them contradict things this project currently believes.

**Finding 1 — PixelLab has never produced a single pixel in this game, and the thing that did cannot
draw.** `tools/art/generate.ts` — 371 tested lines, a reference resolver, a palette encoder, a
manifest writer — has never been executed. There are zero manifests, zero prompt files, and
`.art-cache/candidates/` has never existed. Every one of the eight shipped hero masters says
`"provider": "blender-mannequin-spike"`. The hero is a **Blender rig render**, quantised to canon.

That rig is excellent at what it does: it computes proportion, registration, pivots, sockets, planted
feet and an 8-frame gait, and it re-renders the whole catalogue in 52 seconds. It solves every
constraint a generator structurally could not. **It also cannot draw.** The shipped hero has no face,
no visor, no jaw; his torso is a stack of axis-aligned rectangles; his mantle is a wine blob with no
hem or fold; his two legs read as one column. He is geometrically correct and artistically empty.

**Finding 2 — the game is not too dark. Measured, its blacks match the concept boards almost
exactly.** I assumed otherwise from the first screenshot and the measurement corrected me:

| | B0+B1 share | mean L | brightest 5% (rgb) | warmth of brightest 5% |
|---|---|---|---|---|
| concept-02 *Death is the Door* | — | — | (161, 115, 71) | **+0.78** |
| concept-03 *The Trial* | — | — | (139, 107, 74) | **+0.61** |
| concept-05 *Town Between Worlds* | 95.4 % | 0.124 | (112, 78, 49) | **+0.79** |
| **the game, arrival** | **95.8 %** | **0.094** | **(76, 73, 73)** | **+0.04** |
| **the game, Gate plaza** | 88.6 % | 0.128 | (80, 74, 74) | +0.08 |

*(warmth = (r − b) ÷ mean channel. Bands are perceptual L, cbrt of relative luminance, six equal
steps.)*

The concepts and the game hold **the same amount of black**. The concepts' lit surfaces are deep
amber; the game's are **neutral grey**. That is the whole visual gap between this build and the
picture the project is chasing, and it is measurable, consistent across every board and every island,
and fixable without drawing anything.

The mechanism is architectural, not artistic. `light.ts` composes a lightmap and **multiplies** it
over the world — its own comment says so: *"the lightmap only ever DARKENS."* A multiply cannot make
cold stone warm. `#ffd9a0` over `slate2 #425066` is still blue. The Bardo's six braziers all declare
correct warm tints (`0xffd9a0`, `0xff7a18`, `0xffc078`, `0xffab5c`); none of that warmth can reach a
surface, by construction.

**Finding 3 — the frame breaks the bible's own §3.2.5, and it is measurable.** §3.2.5: *"Static
architecture is never in the top rank. If the wall cope is the brightest thing on screen, the frame is
wrong."* In the arrival frame, of the 3.02 % of pixels above Y=70, the single most common colour is
**`#3e495b` at 31.9 %** — that is `slate2`, cold blue-grey **stone**. Cold architecture is the
brightest large mass in the opening shot of the game.

The good news in all three: none of them needs a new asset, a new tool, or a new constitution. You
already have the best art bible I have read in a hobby project. The gap is enforcement on the pixels
that ship, not doctrine.

---

## 2. Scorecard (0–100)

### Visual — 57

| Axis | v1 | now | Why |
|---|---|---|---|
| Art direction | 55 | **58** | The bible is genuinely excellent and its reach grew (characters now compile through it). But the shipped frame violates §3.2.5 and §3.2.6 measurably, and nothing detects that. |
| Character design | 35 | **38** | Now authored, on-grid, one hand, consistent across 8 sheets. Still: no face, no interior modelling, a domino silhouette at 1×, and 4 of 6 actors are Kenney. |
| Environment design | 68 | **60** | Marked **down** on measurement, not on regression. `buildBardo` is sophisticated — four islands, ranked pools, a worn spine, a fainter fork, staggered links, seals as teasers. At 1× it renders as **flat grey rectangles**: ~19 props over 465 paved cells, and nothing stands up. |
| Composition | 70 | **66** | The plan is good; the frame does not sell it. Three of the four islands are visually identical, so there is no pull toward any of them. |
| Colour & palette | 80 | **72** | Canon holds absolutely — 0 off-canon pixels. But the palette is *used* monochromatically: 55 colours, and the frame reads as grey with orange dots. |
| Lighting | 72 | **48** | The largest correction in this document. Pools are ranked, tuned and coupled to the bake — configured beautifully. What renders is a multiply that cannot warm anything, and cold stone in the top brightness rank. |
| Asset consistency | 30 | **45** | Hero and Brute are now one hand from one rig. Caster, charger, warden and dummy are still visibly from another game. |
| Readability | 40 | **52** | The grid fix is real and the hero is crisp. Value hierarchy is inverted: the blade (B5) out-ranks the body (B0–B1), and the helmet out-ranks the face that isn't there. |
| Distinctiveness | 72 | **74** | "Islands in a starfield void" is ownable and held everywhere. |
| Visual polish | 35 | **55** | Crawling outlines are gone — the single biggest win in #28. Remaining: a bone-white ring at the hero's feet brighter than the hero, a raw staircase on the blade's diagonal, no cast shadow from anything onto stone. |

### Animation — 50

| Axis | v1 | now | Why |
|---|---|---|---|
| Hero animation | 25 | **52** | v1's "2-frame run" is stale. Measured from the sidecars: an **8-frame run at 4 ticks each** (32-tick loop, 7.5 fps), and **5-pose chains** for light1 / light2 / heavy. That is a real animation set. |
| Environmental animation | 55 | **55** | Braziers gutter, motes drift, fog moves, flame tongues take their source's colour. Modest and correct. |
| Movement feel | 70 | **72** | 957 tests green, matrix measured, no seed strands a player. Input responsiveness is not a problem here. |
| Animation transitions | 45 | **58** | `clipSelect` is well built and the plant-pose branch is now **reachable** — every swing clip ships `ci = 2`, and the heavy passes `commitTick = 3`. v1 called it dead code; it is live for the heavy. The light swings still take an even split because they pass no commit tick. |
| Character personality | 20 | **25** | **Idle is one static cell.** No idle clip exists in any sidecar. No breathing, no weight shift, no cloak follow-through, no secondary motion, no face to emote with. The dodge's middle frame holds 10 ticks on one drawing; the heavy's commit holds 9. |
| Weapon interaction | 25 | **38** | More fires than v1 credited: `swordMetal` + a 329.63 Hz bell, the Gate's mark lights, the rack redraws without its blade. But the hero does not move, and a full-width gold HUD banner is the loudest thing in the frame. |

### Production system — 67

| Axis | v1 | now | Why |
|---|---|---|---|
| PixelLab workflow | 25 | **20** | Marked **down**, because the honest finding is worse than "the workflow is weak": **there is no workflow.** The client has never run. Two set-piece candidates exist, made through the MCP by hand, never approved, and their inputs are gone from disk. |
| Style consistency | 40 | **58** | The rig gives characters one hand, one light rig, one palette lane. Projection, scale-in-frame and detail density are still unmeasured for anything generated. |
| Iteration speed | 85 | **88** | 52 seconds to re-render, re-register, re-quantise and re-gate the whole catalogue after a proportion change. Better than most studios. |
| Reproducibility | 90 | **92** | `tests/art/reproducibility.test.ts` sha256-compares recompiled output against the committed PNG and sidecar. A hand-edited sheet cannot ship undetected. |
| Asset organization | 80 | **84** | `.art-cache` → `art/approved` (hash-verified receipt) → `public/assets` (gated). Candidates cannot write into production *by construction* — the approval check keys on the output path. |
| Technical integration | 50 | **62** | The rig → sidecar → renderer bridge now works end to end for the hero, including sockets in world px. The five actor specs exist and are complete, but every `input` points at `.art-cache/actors/…`, which is **not on disk** — the lane cannot be re-run without re-rendering. |
| Scalability | 65 | **68** | The rig scales. The tile lane still hardcodes a *copy* of 55 canon colours instead of reading `canon.json`, and the `T`/`PROP` index tables remain a 91-entry registration table in sim code. |

### Experience — 55

| Axis | v1 | now | Why |
|---|---|---|---|
| First impression | 65 | **66** | The title card over the live Gate plaza is good and distinctly this game. |
| Emotional impact | 45 | **45** | Atmospheric, not yet moving. There is no single object in the frame that makes you say "look at that." The concepts each have three. |
| Sense of place | 70 | **70** | Still the strongest thing here. |
| Player orientation | 60 | **52** | The spine works. But the Forge, Shrine and Pier measure 96.9 / 97.4 / 98.1 % in B0+B1 — three of the four islands you are invited to explore are, at 1×, dark grey rectangles. Nothing pulls. |
| Hero readability | 20 | **48** | The largest single gain. He is crisp, on-grid, and the wine mantle gives him a colour identity. He is also a dark domino with a grey box for a head. |
| Perceived craftsmanship | 45 | **52** | Care is visible in the stone logic and the rig. It is not visible in the frame, which is the only place it counts. |
| Cohesion | 35 | **50** | One hand for the two authored characters; the other four actors are still foreign. |
| Would I keep playing | 55 | **60** | Yes, for the world and now partly for the character. |

### **Overall: 52 → 57**

Five points for one PR, and honestly earned: the grid fix, the authored hero and the 8-frame run are
all real. The score did not move further because I marked **Lighting down 24 points** on measurement.
That is not a regression — it is v1 grading the *configuration* and v2 grading the *frame*.

---

## 3. What currently works — protect these

1. **`ART_DIRECTION.md`.** It converts taste into citable, measurable rules, and it already names both
   of this build's biggest defects (§3.2.5 brightness rank, §3.2.6 warm key / cool ambient). **Do not
   write another constitution.** Enforce this one.
2. **The Blender rig.** 52-second catalogue iteration, registration computed from bones rather than
   judged, lighting constants derived from gate sweeps, per-frame camera framing auto-solved, and a
   two-pass compile that discovers its own waivers instead of hand-writing them. Genuinely excellent
   engineering.
3. **The custody chain.** `.art-cache` → receipted `art/approved` → gated `public/assets`, with the
   approval boundary enforced *by output path* so a candidate lane physically cannot ship.
4. **Reproducibility.** sha256 recompile comparison. Best-in-class.
5. **The sim/art timing contract.** Timing lives in `tuning.ts`; a sheet may only *assert* its contact
   frame, machine-checked at compile. This is the only thing stopping art desyncing from a hitbox.
6. **`buildBardo`'s composition logic.** Four islands under a footprint cap, ranked light pools with a
   real gap between ranks, a worn pilgrimage spine plus a fainter fork, staggered side links so the
   middle latitude never reads as a boulevard, seals as silhouette-only teasers. **The plan is better
   than the render.** Fix the render; do not touch the plan.
7. **The pixel grid, as of #28.** One source pixel is one target pixel. Protect it with a test.

---

## 4. What reads as placeholder, generic, or AI-generated

| # | What | Evidence |
|---|---|---|
| 1 | **The hero's head** | A grey rectangle with a lighter cap. No visor, no jaw, no eye slit. The pauldrons are brighter than the head, so **the eye lands on his shoulders, not his face.** At 1× he is a domino. |
| 2 | **Caster, charger, warden, dummy** | Kenney tiles 84 / 122 / 54 / 109 under runtime `Graphics`. In the pose sheet the caster is a magenta blob with a red laser and the charger is a white-red streak — visibly from another game. |
| 3 | **The bone ring at the hero's feet** | `#d1c3ae` (canon `bone`), a bright ellipse ring under every actor, **brighter than the entire hero body**. It is the first thing the eye finds on the character. |
| 4 | **The blade's diagonal** | A raw 2-1-2-1 staircase in near-white with a pure-black edge running its full length. The clearest "rendered, not drawn" tell on the sprite, and the highest-value object in most frames. |
| 5 | **Three of the four islands** | Forge, Shrine and Pier at 96.9 / 97.4 / 98.1 % B0+B1. Each holds 1–3 props. The island named "the Forge" contains one brazier, one slag shard and an NPC — **there is no forge**. |
| 6 | **`BOW_ART` in `views/bow.ts`** | 3 × 16×16 hand-typed ASCII frames in 6 off-canon colours. The same class of defect deleted from `player.ts` in #28. **Two of its three frames are unreachable** — `key` is assigned `'rest'` at init and the only reassignment is a ternary whose condition is always false, so `draw` and `loose` never render. |
| 7 | **The idle** | One static cell, held forever, in every direction, armed and unarmed. |
| 8 | **The pickup banner** | A full-width gold HUD bar is the loudest object in the frame at the game's first moment of agency. |

---

## 5. Root-cause diagnosis

Separated as requested. Note which bucket is *empty*: **"we need more assets" is not a root cause here.**

### Art direction — 1 problem, and it is not the doctrine

**The bible reaches the sheet and not the frame.** Every gate in `tools/art/gates.ts` measures a
sprite sheet in isolation: dimensions, binary alpha, palette subset, colour budget, B5 mass, per-frame
silhouette mass, connectivity, ground separation against a *constant* floor value of 0.1297, light
direction, edge clearance, height, sockets, identity distance, clip centroids, loop closure, planted
feet. **Not one of them looks at a rendered frame of the actual game.** That is why a §3.2.5 violation
— cold architecture in the top brightness rank — has shipped in the opening shot for the project's
whole life with 507/507 gates green.

### Asset quality — 1 problem

**The rig cannot draw.** It gives you correct geometry, correct registration, correct motion and
perfect consistency. It cannot give you a face, a fold, an artist's accent, an exaggeration, or a
deliberate asymmetry — because none of those are computable from bones. The shipped hero has roughly
8 readable shapes on a 37 px figure; a Hyper Light Drifter or Death's Door protagonist at that size
carries 15–20. This is the *correct* division of labour to have discovered; the missing half is a
drawing pass, and it does not exist in the pipeline today.

### Animation — 2 problems

1. **No idle.** Not a weak idle — **no idle clip exists in any sidecar.** A game's protagonist stands
   still more than he does anything else, and yours is a photograph.
2. **Long holds inside short clips.** The dodge's middle frame owns 10 of 20 ticks; the heavy's commit
   owns 9 of 12 startup ticks. The frames exist; the *pacing* concentrates them badly.

### Composition — 2 problems

1. **Nothing stands up.** Every island is a flat paved slab inside a 1-tile wall ring. The concept
   boards read as places because they have columns, arches, shelves, ladders, banners — vertical mass
   that occludes and casts. The game has no occluding verticals at all outside the Gate.
2. **Prop density is roughly one object per 24 paved tiles.** The concepts run 8–15 objects per
   platform. This is the difference between "a location" and "a floor plan."

### Technical — 2 problems

1. **The lightmap multiplies.** Warm light physically cannot warm cold stone through a multiply. This
   is the mechanism behind the +0.04 warmth measurement and it is the single highest-leverage fix in
   this document.
2. **A bone-coloured ring renders at every actor's foot**, out-ranking the actor.

### Tooling — 1 problem

**Nothing measures a rendered frame.** `pnpm room:gate` comes closest, and it gates room *sources* and
Bardo negative space, not the composited frame's brightness rank or hue split. Both of my headline
measurements took about thirty lines of `sharp` and could run in CI tomorrow.

### PixelLab workflow — see §6. In one line: it does not exist.

### Process — 1 problem, inherited from v1 and still true

**Generation succeeds when an asset is a positive, self-contained noun. It fails when the asset is
defined by a negative, or by a relation.** ~58 generations shipped zero pixels; every rejection was an
excess, never a deficit. The corollary that matters for §8: a *third* mode exists that this framing
missed — **transformation**. Editing an image that is already correct is neither a negative nor a
relation, because the model has the other term in its hand. That is the opening for PixelLab.

---

## 6. Critique of the current PixelLab workflow

**There is no current PixelLab workflow. This is not a criticism of how you use it; it is the finding.**

1. **The client has never been executed.** `tools/art/generate.ts` writes a prompt file *before* the
   first paid request, writes a manifest on every exit path, and creates `.art-cache/candidates/`.
   Repo-wide there are **zero** prompt files, **zero** manifests, and that directory has never
   existed. All 21 recorded PixelLab generations went through the MCP by hand.
2. **Provenance is therefore asymmetric.** Every shipped sidecar names `blender-mannequin-spike` or
   `openai`. Nothing names `pixellab`. The two set-piece specs that do (`setpiece-gate`,
   `setpiece-skiff`) are marked candidate-only, were never approved, and their input masters are gone
   from disk — those 10/10 gate results are now unreproducible.
3. **The subscription is lapsing unspent** (`VERTICAL_SLICE_PLAN.md`), which is the right call for the
   role PixelLab was being asked to play and the wrong call for the role §8 proposes.
4. **Specs record conditioning that could not happen.** Three `gen-setpiece-*.json` files name
   references under `art/reference/concepts/`. That is not the approved pool, so §12.6's compounding
   ("each new generation is conditioned on the approved pool") **has never once been exercised** —
   there has never been a first term.
5. **The concept boards were used as style references, and they contradict the bible.** They are 45°
   isometric, ~79,000 colours, with a gold-framed glowing gate — precisely what §8.2.2 and §10.22
   forbid. When a reference and a rule disagree, the reference wins. That is the mechanical
   explanation for twelve gold-framed gates. **Use them to judge, never to condition.**
6. **`kind: "prop"` is a live gate hole.** Ground separation, per-frame ground separation and height
   are emitted **only** when `kind === 'character'`, and connectivity is downgraded from fail to judge.
   A prop is never checked for whether it is darker than the floor it stands on.
7. **The judging canvas is not the shipping form.** Both set pieces were gated as single 160 px cells;
   in game they are multi-cell masses, and `bakePropShadows` excludes by index and cannot place them.
   Solve the multi-cell footprint contract before approving any set piece.
8. **Custody is one-sided.** Every accept gets a hash-verified receipt; every reject lives in prose in
   a gitignored cache. The rejection corpus is the most valuable art data this project has generated,
   and it is the only part with no record.

**What PixelLab actually measured well at, in this project's own logs:** 8-direction rotation of a
master *you* authored (identity held across all facings, one generation), and template locomotion (a
real gait with extension, counter-swing and lean — the best animation in the corpus, one generation).
Both take your identity and do labour on it. Neither asks it to invent under constraint. That is the
shape of the answer in §8.

**Do not use `create_image_pro`.** 20–40 credits, and it buys nothing pixflux's free palette lock
already delivers. Its only case is multi-reference composition.

---

## 7. The visual constitution

**You have one. Do not write another.** `ART_DIRECTION.md` already fixes palette, value bands, tile
size, camera, outline, shadow, light direction, silhouette and composition. Four articles are missing,
and all four are *enforcement*, not doctrine.

**Article I — One pixel grid.** Every authored sprite lands 1:1 on the render target. A sheet's cell
size divided by `worldScale` is its logical size; anything else is a defect.
*Enforcement:* `cut()` sets `orig` (done in #28). **A test asserting source:target parity per
registered sheet does not exist and should be your first commit** — two dozen concurrent worktrees can
regress it silently, and no gate can see it.

**Article II — The frame is gated, not only the sheet.** A composited 1× frame of the opening must
satisfy: (a) the brightest 5 % of pixels have warmth ≥ +0.45; (b) no static architecture colour is the
most common member of that set; (c) the darkest 50 % has a non-zero blue floor (b ≥ 10).
*Enforcement:* a new `pnpm frame:gate` running the thirty lines of `sharp` used to produce §1's table,
over three canonical shots. **This is the missing gate class, and it catches the defect that has
shipped for a year.**

**Article III — Colour placement, not just colour identity.** Each colour in an asset's ramp declares
a maximum share and a maximum bounding box as a fraction of the sprite.
*Enforcement:* a new compile gate. This converts your best prose (`paletteNote`) into something
machine-checked and would have caught the skiff's 815 gold pixels automatically.

**Article IV — Projection is a reference image, never an adjective.** "high top-down" as a *word*
produced 10 of 10 elevation portraits. The camera must be supplied as a rendered image at the exact
game projection. **The rig emits this for free**, which makes it the natural feeder for any generated
lane rather than its competitor.

---

## 8. The production pipeline — the real proposal

**Invert PixelLab's role. It is not your generator. It is your finishing pass.**

The rig produces figures that are *correct and lifeless*. A generator asked to invent a hero under
relational constraints fails 0-for-10. But a model handed a correct image and asked to **change one
thing about it** is doing neither invention nor constraint satisfaction — it has the other term in
front of it. That is `edit_image`, `inpaint_image` and `correct_pixelart`, and it is the one mode this
project has never tried.

### Ownership

| Medium | Owns | Why |
|---|---|---|
| **Blender rig** | proportion, registration, pivots, sockets, planted feet, gait, every combat clip's *geometry*, all directional consistency | every constraint a generator failed is *computed* from bones; 52-second catalogue iteration |
| **PixelLab (edit lane)** | the **drawing pass** over rig output: face and visor, fabric folds, lit edges, foot separation, blade cleanup; 8-direction rotation of an authored master; skeleton-driven in-betweens | the one mode where the model has the other term; both its measured strengths live here |
| **PixelLab (create lane)** | positive-noun props only: a brazier, a lantern, a bell, a boat, a crate | the one generation class that has ever passed |
| **Code** | tiles, autotiles, materials, HUD, telegraphs, impacts, swing arcs, **anything defined by refusal**, and **every threshold mark and light pool on a generated mass** | a sprite cannot track `tuning.ts`, and code can *guarantee* a pattern never resolves into a glyph |
| **Runtime** | lighting, grade, camera, post | must respond to sim state |
| **gpt-image** | concepting and marketing only | 500–600 colours, `alpha: false`, baked checkerboards — never an asset source |

### The stages

| # | Stage | Input | Tool | Output | Acceptance | Failure mode | Verification |
|---|---|---|---|---|---|---|---|
| 0 | **Classify** | an asset need | judgement | noun / relation / refusal / **transformation** | the class is unambiguous | mis-class wastes a whole round (12 gates, 3 seals) | if the brief contains "not", "without", or a comparison, it is not a noun — route it to rig, code, or the edit lane |
| 1 | **Pose** | pose data | rig | 512 px renders + `rig.json` bones | every marker projects inside the cell (`FIT WARNING` is a hard stop) | a pose that leaves the cell | the rig prints it |
| 2 | **Compile** | renders | `pnpm art compile` | sheet + sidecar | 0 blocking gates; waivers exact, explained, and currently firing | `kind:"prop"` skipping the value gates | the existing suite |
| 3 | **Draw** ← *new* | one compiled cell | PixelLab `edit_image` / `inpaint_image`, palette-locked | the same cell with a face, folds, a lit edge | silhouette and pivot **unchanged**; palette still canon; ≤ 16 colours | the edit moves the silhouette, breaking every pivot and socket downstream | diff the alpha mask against the input — it must be identical |
| 4 | **Propagate** ← *new* | the drawn cell + the rig's other cells | PixelLab `create_character_state` / `animate_character` with rig keypoints | the drawing carried across all frames and facings | identity gate ≤ 0.45 across the clip | hand-drawing 137 cells | the existing `identity:*` gates |
| 5 | **Screen** | candidates | you, at 1×, on the room's floor value | keep / reject **with a receipt** | every reject writes `.rejection.json` with a reason | rejects lost to prose | the rejection corpus grows |
| 6 | **Approve** | master | `pnpm art approve` (human only) | hash-verified receipt | sha256 matches at compile | an edited master shipping silently | the reproducibility test |
| 7 | **Bake the marks** | compiled mass | code | gold crossings, light pools, cast shadows | §8.2.2 satisfied | expecting the generator to place them | it never has, 12 for 12 |
| 8 | **Gate the frame** ← *new* | the shipped build | `pnpm frame:gate` | brightness rank, warmth, hue floor | Article II | judging a sheet and shipping a frame | the §1 measurements, in CI |

**The missing prerequisite is small and specific:** `animate_character` takes exact keypoints and the
rig already computes every marker's projected pixel position into `rig.json`. Nothing emits them in
PixelLab's format today. That one adapter converts PixelLab's single hard failure (free-text combat
poses) into its strongest mode.

---

## 9. Hero plan

**The hero's problem is one word: face.** Everything else about him is now correct.

1. **Give him a head.** A visor slit, a jaw line, one dark socket, a lit brow edge — four or five
   pixels that make the eye land on the head instead of the pauldrons. Today the pauldrons are the
   brightest thing on the body and the head is darker than they are. This is the single highest-value
   art change in the game and it is roughly 20 pixels, repeated across 3 facings.
2. **Give the body interior modelling.** Two separated legs with a gap, a hem on the mantle, a fold or
   two, a lit top edge on the greave. He currently has ~8 readable shapes and needs ~15.
3. **Author an idle clip.** Two or three frames, 20–30 ticks each: a breath, a settle, a slow blade
   dip. Personality is 25/100 and this is most of it. There is no idle clip in any sidecar today.
4. **Re-pace the long holds.** Split the dodge's 10-tick middle and the heavy's 9-tick commit. The
   frames to do it with already exist in the chain.
5. **Kill the bone ring at his feet**, and pull the blade's value down one band so the character
   out-ranks his weapon.
6. **Do not add an outline or a rim.** Ground separation is already carried by value and the wine
   mantle. An outline would fight the code-authored world's flat-mass language. (The existing white
   rim on a perfect dodge is a *reward*, one tick, and should stay.)

Route 1 and 2 through §8 stage 3 — this is exactly the pass the rig cannot do and the edit lane can.

---

## 10. Opening-town plan

Protection and addition, not overhaul. The composition logic is good.

1. **Make light additive and amber.** The one change that moves this build closest to its own concept
   boards, and it draws nothing. Add a warm additive pass over the existing multiply so a lit surface
   can actually exceed its unlit colour. Target: brightest-5 % warmth ≥ +0.45 (concepts run +0.61 to
   +0.79; you are at +0.04).
2. **Lift the shadow floor off pure black.** The darkest 50 % of your arrival frame is `rgb(0, 0, 4)`;
   the concepts run `rgb(3–9, 3–9, 13–26)` — a blue-violet, not a void. `postfx` already has
   `uShadowTint` and `uShadowLift`; this is a number.
3. **Stand three to five things up on every island.** Columns, a ladder, a shelf, a hanging banner, a
   broken arch. Code-authored props on the existing sheet grammar. This is what separates the concept
   boards from a floor plan, and every island currently has 1–3 objects.
4. **Give the Forge a forge, the Shrine an altar, the Pier a boat.** Each island is named for
   something it does not contain. One strong focal object each is worth more than twenty small props.
5. **Bake the Gate's threshold mark.** `bakeBardoGate` already draws `goldDim` courses as
   integer-aligned rects — the exact §8.2.2 mark that twelve generations could not produce.
   **Generated stone, baked light: generation owns mass and material; code owns anything the eye is
   meant to be led to.**
6. **Do not lift the ambient.** I tested it: `ambientDarkness` 0.44 → 0.24 and `vignette` 0.40 → 0.22
   moved mean L only 0.094 → 0.104 and made the frame flatter. The darkness is not the defect. *(One
   worthwhile exception measured: `arena.ts`'s `edge` term at `1 - dEdge / 3` puts 71.8 % of paved
   cells at the darkest level; the file's own comment records `1 - dEdge / 2` as the revert. I tried
   it — B2 share 3.7 % → 7.0 %, and the stone visibly regains material. Worth taking on its own
   merits, but it is a texture fix, not the light fix.)*

---

## 11. The sword moment

More of it works than v1 credited. `swordMetal` plays with a 329.63 Hz bell, the Gate's mark lights on
the same tick, the doors open, and the rack redraws without its blade. The beats exist; the **staging**
does not.

In order of value per unit of work:

1. **Cut the banner.** A full-width gold HUD bar is currently the loudest object in the frame at the
   game's first moment of agency, and it is UI. Let the room say it.
2. **A pickup pose** — anticipation → grasp → rise, three authored frames. The rig has the poses.
3. **Hit-stop, 4–6 ticks at the grasp.** `tuning.hitstop` already exists.
4. **Proximity specular** — the blade's edge catches as you enter the rack radius. Code, one light.
   This also solves a real problem: **the rack is currently not visually distinguishable** in the
   frame, and it is the one object the first minute is about.
5. **Keep the sound.** It is already good.

Explicitly **not**: particles, camera shake, a UI flourish, or a weapon glow. One excellent animation
with one excellent sound beats twelve effects.

---

## 12. Art vs code

Covered in §8's ownership table. The one line worth repeating, because it is the rule this project
learned the hard way and keeps re-deriving:

> **Generation owns mass and material. Code owns anything the eye is meant to be led to.**

And the new corollary this audit adds:

> **The rig owns geometry. Only a drawing pass owns character.**

---

## 13. Ranked highest-leverage changes

Ranked by perceived quality × readability ÷ cost, with dependency order respected.

| # | Change | Impact | Cost | Reuse | Risk |
|---|---|---|---|---|---|
| 1 | **Additive warm light + a non-black shadow floor** | Closes the single largest measured gap to the concept boards (+0.04 → +0.6 warmth). Changes every frame in the game. | ~1 day | every room, every realm | must not break the room-gate's value budgets — measure |
| 2 | **Give the hero a face** (visor, jaw, brow) via the PixelLab edit lane | The eye finally lands on the character. Character design 38 → 60+. | ~20 px × 3 facings + the lane | every actor after him | the edit must not move the silhouette — diff the alpha |
| 3 | **`pnpm frame:gate`** (Article II) + the source:target parity test (Article I) | Converts the two defects that shipped for a year into build failures. ~60 lines total. | half a day | forever | none |
| 4 | **An idle clip** (2–3 frames) + re-pace the dodge and heavy holds | Personality 25 → 50. The protagonist stops being a photograph. | rig time | all actors | none |
| 5 | **Stand things up + one focal object per island** | Turns a floor plan into a place. Sense of place 70 → 85, orientation 52 → 70. | 1–2 sessions, code-authored | every realm's rooms | prop footprint contract needed for multi-cell |
| 6 | **The sword moment's staging** (cut banner, 3-frame pose, hit-stop, proximity specular) | The first act of agency gets a beat. | ~half a session | every pickup after it | none |
| 7 | **Recast caster / charger / warden / dummy from the rig** | Kills the last Kenney; fixes enemies measured darker than their floor. Note the five specs already exist and are complete — but their `.art-cache` inputs are gone, so the lane must be re-run. | 1–2 sessions | — | needs identity rounds |
| 8 | **Rejection receipts** (`pnpm art reject --reason`) | Preserves the most valuable corpus this project has. | ~1 hour | forever | none |
| 9 | **Delete `BOW_ART`** and the `SPRITE.player` / dead `restoreSword` entries | Removes the last view-file-authored pixels; two of three bow frames are already unreachable. | ~1 hour | — | none |

**What is deliberately *not* on this list:** more generations, more props, particles, camera shake, a
new palette, a new constitution, and a hero redesign. The hero's construction is correct. He needs a
face, not a rebuild.

---

## 14. Phased plan

**Phase 0 — Stop / preserve / remove.**
*Stop:* passing the concept boards to any generator as a style reference; `create_image_pro`;
generating anything defined by a negative or a relation; grading the *configuration* instead of the
frame.
*Preserve:* the bible, the gate suite, the receipt mechanism, the reproducibility test, the rig, the
code-tile lane, `buildBardo`'s composition, the sim/art timing contract, the pixel grid.
*Remove:* `BOW_ART`, `SPRITE.player`, `restoreSword`, and eventually `tiny_dungeon.png`.
**Done when** `grep -rn "SPRITE.player\|BOW_ART" src/` is empty.

**Phase 1 — Enforcement lock.** Article I's parity test and Article II's `frame:gate`, both in CI.
Article III's colour-placement gate. The rig emits projection and on-model references.
**Done when** a build fails because cold architecture is the brightest mass in the opening frame.

**Phase 2 — Light.** Additive warm pass; shadow floor lifted off black; the `edge` term revert
measured on its own merits; the bone ring at the feet removed; the blade dropped one value band.
**Done when** the arrival frame measures brightest-5 % warmth ≥ +0.45 and no static architecture
colour leads that set.

**Phase 3 — Hero.** The edit lane stood up (stage 3 of §8) and proven on one cell. Face, folds, foot
separation propagated across 3 facings × 2 families. An idle clip. The long holds re-paced.
**Done when** the hero reads as a character at 1×, in motion, standing still, in every state — and a
stranger can tell which way he is facing without seeing him move.

**Phase 4 — Town.** Verticals and one focal object per island. The Gate's threshold mark baked. The
multi-cell prop footprint contract solved.
**Done when** each island is identifiable at a glance from any other, and the arrival wins a blind
compare against concept-05 on composition.

**Phase 5 — Interaction.** The sword moment's five beats. Ambient environmental motion.
**Done when** the pickup has anticipation, contact and consequence, and the room answers on the same
tick without a HUD banner carrying it.

**Phase 6 — Pipeline.** Rig keypoints emitted for `animate_character`. Rejection receipts. Actor
recasts. Every generation routed through one client with a manifest.
**Done when** a new actor goes identity → gated candidate → approval package without a human writing
a prompt by hand.

---

## 15. Definition of done — the opening-town vertical slice

1. No Kenney texture and no view-file-authored pixel reaches the screen in the first sixty seconds.
2. Every authored sprite renders 1:1 on the pixel grid, **and a test asserts source:target parity per
   sheet.** *(The fix shipped in #28; the test still does not exist.)*
3. `pnpm frame:gate` is green on the arrival, the axis and the Gate plaza: brightest-5 % warmth
   ≥ +0.45, no static architecture colour leading that set, shadow floor blue and non-zero.
4. The hero reads as a character at 1×, in motion **and standing still**, armed and unarmed — with a
   face, an idle clip, an 8-frame run, and no fallback path alive in the code.
5. The sword pickup has anticipation, contact and consequence; the room answers on the same tick; and
   no HUD banner is carrying the moment.
6. Each of the four islands is identifiable at a glance from any other, and each contains the thing it
   is named for.
7. The arrival, the axis and the Gate plaza each pass §11.1 **and** win a blind compare against their
   named concept exhibit on composition.
8. Every shipped asset has a receipt; every rejected candidate has a rejection receipt with a reason.
9. Colour-placement and detail-density gates exist and are green on every shipped asset.
10. `pnpm typecheck`, `pnpm test`, `pnpm matrix -- --seeds 1-100`, the pinned replays and
    `pnpm room:gate` are all green.
11. **The user plays the first minute and does not want to change anything.** This gate is theirs
    alone, and **no agent may award it.**

---

## Appendix — how every number here was produced

All measurements are off PNGs written by `pnpm shot -- --oneX 1` against a private dev server, so one
PNG pixel is one target pixel. Bands are perceptual L (cbrt of relative luminance) in six equal steps.
Warmth is `(r − b) ÷ mean(r,g,b)` over a luminance-sorted percentile band.

| Shot | mean L | B0 | B0+B1 | unique colours |
|---|---|---|---|---|
| title over the plaza | 0.108 | 74.3 % | 90.8 % | 1009 |
| arrival (the first frame of play) | 0.094 | 75.3 % | 95.8 % | 1265 |
| Gate plaza | 0.128 | 64.4 % | 88.6 % | 1010 |
| the rack, before pickup | 0.115 | 67.1 % | 90.4 % | 622 |
| the Forge | 0.084 | 83.4 % | **96.9 %** | 1106 |
| the Shrine | 0.076 | 83.3 % | **97.4 %** | 1047 |
| the Pier | 0.083 | 79.4 % | **98.1 %** | 1117 |
| a combat room (`wave1`), for contrast | 0.143 | 65.2 % | 90.7 % | 1332 |
| concept-05 *Town Between Worlds* | 0.124 | 78.0 % | 95.4 % | 79 024 |

Two experiments were run against the live source and **reverted**; `git status` was clean afterward:

- `HUB.ambientDarkness` 0.44 → 0.24 and `vignette` 0.40 → 0.22: mean L 0.094 → 0.104, B0 75.3 → 71.4 %.
  **Marginal — the ambient is not the lever.**
- `arena.ts` `edge` term `1 - dEdge / 3` → `1 - dEdge / 2` (the revert its own comment records): mean L
  0.094 → 0.104, **B2 3.7 → 7.0 %**, and the stone visibly regains material read at 1×.

Baseline at the time of writing: `pnpm typecheck` green, `pnpm test` **957 passed / 81 files**.
