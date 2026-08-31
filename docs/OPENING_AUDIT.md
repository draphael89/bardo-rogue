# Opening Town + Hero — art direction audit

**Date:** 2026-08-30 · **Branch:** `codex/bardo-first-sixty-seconds` · **Method:** two forensic
investigations (pipeline archaeology, AI-generation forensics), the compiled candidate measurements
from the approval package, and the orchestrator's own 1× judgement of every staged master.

Graded against excellent shipped indie games, not against the placeholder it replaced.

**Execution note, 2026-08-30:** source/target parity, colour-placement, detail-density and rejection
receipts are now implemented. A rig-emitted breathing idle plus reach/contact/settle pickup candidate
clears all 2,154 applicable gates with six measured weapon-apex waivers. It remains in `.art-cache`
pending human Look and approval, so the scorecard below is intentionally not regraded yet.

---

## 1. Executive verdict

This project has a **world-class art system pointed at 10% of its screen, a genuinely good
environment, and a protagonist who is a white blob.**

The compile → gate → approve → ship pipeline is better than most shipped indie games have: measured
thresholds with their failed predecessors recorded in comments, two-tier fail/judge severity, waivers
that are rejected if they name a passing gate, hash-verified human approval, and a byte-level
reproducibility test. It governs **two character sheets**. Everything else — every floor, wall, prop,
particle, decal, three of five enemies, and the hero for the entire opening — reaches the screen
through lanes that pipeline cannot see.

Two root causes explain nearly every symptom, and neither is "we need more assets."

**Root cause A — the hero is the only thing on screen not on the pixel grid.** The world renders at
1.5× scale. Tiles and props compensate (`atlas.ts:58` passes a `logicalSize`, so 24 source px → 24
target px, 1:1). `cut()` in `sheet.ts:200` sets no `orig`, so every authored character is resampled at
a non-integer 1.5× — each source pixel becoming an alternating 1-or-2 target pixels — and because
positions round in *world* space, the phase flips as he walks and **his outline crawls**. No gate can
see it: the gates measure the sheet, never the rendered frame. This is why nine hours of art direction
never made the hero sit in the room.

**Root cause B — generators add, and every art law in this game is subtractive.** ~58 recorded
generations across three lanes have shipped **zero pixels**. Every recorded rejection is an *excess*,
never a deficit. This is not a prompting problem and more generations will not fix it.

The good news: both are cheap. A is roughly one line. B is a lane-assignment decision plus one new
gate. Neither requires redesigning anything already built.

---

## 2. Scorecard (0–100)

### Visual — 56

| Axis | Score | Why |
|---|---|---|
| Art direction | 55 | `ART_DIRECTION.md` is genuinely excellent — measured rules, recorded dead predecessors. But direction is only as good as its reach, and it reaches the compiled lane only. The *experience* shows three different hands. |
| Character design | 35 | The hero is now designed (approved this session). Five of six actors are still Kenney puppets wrapped in runtime `Graphics` telegraphs. |
| Environment design | 68 | Code-authored, 24px native, measured. Slabs cross tile boundaries, wear paths follow real traffic, occlusion at every joint. The best-executed part of the game. |
| Composition | 70 | Islands hold 82.6–95.2% negative space; the pilgrimage axis gives the eye a destination; each island has a focal object and its own light pool. |
| Colour & palette | 80 | The canon palette is the project's strongest identity artifact. Measured: 0 off-canon pixels across 18/18 generated candidates. Hue never drifts. |
| Lighting | 72 | Recently earned: the Gate is the key at r140/s2.4, every other pool ranks under it, and the star rank was fixed (stars were the brightest pixels in the game). |
| Asset consistency | 30 | The killer. Three visually distinct hands: isometric ~600-colour concept boards, near-elevation generated set pieces with per-block bevel, and the flat code-authored world. |
| Readability | 40 | Hero clears ground-separation at Weber 1.01 against a 1.00 floor — by 0.01. The Kenney enemies measured **−0.34 to −0.55**: darker than the floor they stand on. |
| Distinctiveness | 72 | "Every space floats in void with sparse stars" is a real, ownable identity, and it is consistently held. |
| Visual polish | 35 | Crawling outlines, non-integer resampling, and a protagonist drawn in ASCII inside a view file. |

### Animation — 40

| Axis | Score | Why |
|---|---|---|
| Hero animation | 25 | A **2-frame run**. Three-frame swings. The heavy holds one drawing for 400 ms of a 717 ms attack, and its recovery replays the wind-up pixels via alias. |
| Environmental animation | 55 | Braziers gutter, motes drift, fog moves. Modest but correct. |
| Movement feel | 70 | The sim is well tuned and measured — 100/100 seeds resolve, skilled bot wins 78%. Input responsiveness is not the problem. |
| Animation transitions | 45 | `clipSelect.ts` is well-built and unit-tested against real damage windows. But its commit branch requires ≥2 startup frames and every shipped clip has exactly 1, so **the entire plant-pose mechanism is unreachable code**. |
| Character personality | 20 | No idle variation, no secondary motion, no weight shift. The hero stands perfectly still and runs on two frames. |
| Weapon interaction | 25 | The sword pickup is a state flip. No anticipation, no pose, no hitch, no camera acknowledgement. |

### Production system — 62

| Axis | Score | Why |
|---|---|---|
| PixelLab workflow | 25 | 21 generations, 0 shipped. §12.6 ("each new generation is conditioned on the approved pool") has **never once been exercised** — three set-piece specs declare a `references` array the endpoint they used cannot accept. |
| Style consistency | 40 | Palette is locked hard and holds. Projection, scale-in-frame, value structure, light logic and detail density are all uncontrolled — and those are what "one hand" actually means. |
| Iteration speed | 85 | The Blender lane re-renders, re-registers, re-quantises and re-gates an entire catalogue in **52 seconds** after a proportion change. Genuinely excellent. |
| Reproducibility | 90 | `tests/art/reproducibility.test.ts` sha256-compares recompiled output against the committed PNG and sidecar. A hand-edited sheet cannot ship undetected. Best-in-class. |
| Asset organization | 80 | `.art-cache` → `art/approved` (receipted) → `public/assets` (gated) is a clean, enforced custody chain. |
| Technical integration | 50 | The rig lane emits 5-pose frame names; the renderer requires different ones. A spike sheet was **not a drop-in** — the lane stopped one bridge short of shipping. |
| Scalability | 65 | The rig scales beautifully. The tile lane hardcodes a *copy* of 55 canon colours instead of reading `canon.json`, and its `T`/`PROP` index tables are a 91-entry registration table living in sim code, protected only by a comment saying "append, never reorder." |

### Experience — 49

| Axis | Score | Why |
|---|---|---|
| First impression | 65 | The title over the live Gate plaza with the descent is genuinely good and distinctly *this game*. |
| Emotional impact | 45 | The frame is atmospheric but not yet moving. Warmth without revelation. |
| Sense of place | 70 | The strongest thing the game has. It reads as a real location with history. |
| Player orientation | 60 | The pilgrimage axis works; the arrival still under-signals where to go. |
| Hero readability | 20 | A white Kenney blob for the entire opening — the single loudest defect, and the reason this audit exists. |
| Perceived craftsmanship | 45 | Care is visible in the stone and invisible in the character, which reads as "unfinished" rather than "stylised." |
| Cohesion | 35 | Three hands plus a protagonist off the pixel grid. |
| Would I keep playing | 55 | Yes — for the world. Not yet for the character. |

### **Overall: 52 / 100**

An environment worth 70 carrying a character worth 25, judged by a production system worth 62 that is
pointed at the wrong 10% of the screen.

---

## 3. What currently works — protect these

1. **The bible itself.** `ART_DIRECTION.md` converts taste into citable, measurable rules. It ended an
   eleven-round critic loop. Every recommendation below extends it rather than replacing it.
2. **The compile pipeline's internals**, each with a recorded failed predecessor: value lift solved
   once per sheet (per-cell would erase the difference between a coiled wind-up and a lit contact),
   applied as a gamma on OKLab L only (preserves material identity), palette-mapping *before* voting,
   salience rescue (without it thin blades vanish — measured), staging-then-promote.
3. **The gate suite's honesty.** Two-tier fail/judge, the deleted `warn` tier, and waivers that are
   *rejected* when they name a currently-passing gate.
4. **The approval receipt mechanism.** Hash-verified, location-coupled, enforced at two call sites.
5. **The code-authored environment.** The only lane that has ever beaten its reference games.
6. **The Blender rig.** 52-second full-catalogue iteration, registration computed from bones, palette
   lanes proven by sweep before a second of render time is spent.
7. **The sim/art timing contract.** Timing lives in `tuning.ts`; a sheet may only *assert* its contact
   frame, machine-checked at compile. This is the only thing stopping art desyncing from a hitbox.

---

## 4. What reads as placeholder, generic, or AI-generated

| # | What | Evidence |
|---|---|---|
| 1 | **The unarmed hero** | Kenney stock tile 96 plus **237 lines of hand-typed ASCII pose art inside a view file**, drawn in five colours, **none of which exist in `canon.json`**. No gate, no receipt, no reproducibility test can reach it. |
| 2 | **Caster, charger, warden, oath-bound, dummy** | Kenney tiles 84/122/109/54 under runtime `Graphics`. The ground-separation gate exists *because* these sprites measured darker than their floor — and they are still shipping, because with no sidecar the gate cannot reach them. |
| 3 | **Generated set pieces** | Every candidate across all three targets came back with small brick coursing — item 1 on the forbidden list, forbidden in capitals in the prompt. `skiff-522` measures **52% edge density** against the code-authored prop sheet's 20.8%: 2.5× busier than the world it would sit in. |
| 4 | **The concept boards, used as generation references** | 45° isometric, ~600 colours, a **gold-framed glowing gate** — precisely what §8.2.2 and §10.22 forbid. When reference and rule disagree, the reference wins. That is the mechanical explanation for twelve gold-framed gates. |
| 5 | **Weapon sprites** | Kenney tiles 106/118/129. |
| 6 | **Animation frame budget** | Two-frame run; 400 ms of the heavy attack on wind-up pixels; the side dodge holds one drawing for 167 ms. |

---

## 5. Root-cause diagnosis

**A. The pixel grid (technical, ~1 line).** Detailed in §1. Characters resample at non-integer 1.5×
while the room is 1:1. Fixing it costs the Brute a third of his on-screen size and makes every
authored character crisp for the first time.

**B. Additive tool, subtractive laws (process).** Generators add. Negative prompting does not remove a
prior. The only mechanism in this project that has ever removed anything is **deleting the colour from
the palette lock** — which is why removing two colours fixed in one generation what four rounds of
prose could not.

The corollary is the actionable half:

> **Generation succeeds when an asset is a positive, self-contained noun. It fails when the asset is
> defined by a negative, or by a relation.**

- Positive noun → `skiff-522`: reads as a boat in one second, five value bands, materials genuinely
  value-separated.
- Negative → the Seal arch (defined by refusing to be lit or detailed): 0 for 3, correctly moved to
  code, where a loop of integer rects can *guarantee* the pattern never resolves into a glyph.
- Relation → every hero constraint (≤40px **of 64**, ≥2 bands **from the floor**, one hook **no other
  character has**, feet **at row 60**): **0 for 10**. A generator structurally cannot see a relation,
  because it does not have the other term.

**C. The palette lock is an alphabet, not a grammar (tooling).** A colour not in the lock cannot be
drawn — real, and load-bearing. But a colour *in* the lock appears wherever the model wants it.
Measured: `skiff-522`'s spec asked for `goldDim` as "a single bounce pixel"; it delivered **815 pixels,
14.2% of the sprite, across the whole hull.** `seal-622` was asked for a flat black mass and returned
12.3% teal moss. **The moment a colour is needed anywhere, expect it everywhere.**

**D. The gates pass what the eye rejects, always in the same direction (process).** Every gate is a
*structural* check. None is semantic. They passed two sheets a human rejected on sight, and pass
507/507 on a hero whose crest reads as horns. `CHARACTER_HARD_CONSTRAINTS.md` §1 already says it
correctly: *"A green gate says the candidate is structurally admissible, not aesthetically accepted."*

**E. Reference conditioning transfers costume, not construction.** The hero candidates matched the
concept's red tabard and gold sigil precisely, and matched none of its camera, none of the spec's
scale, and none of the silhouette rules.

---

## 6. Critique of the current PixelLab workflow

1. **The client is dead code.** 21 PixelLab generations, **0** through `tools/art/generate.ts`. Its
   371 carefully engineered lines — reference resolver, palette-PNG encoder, manifest, survivor-note
   error path, tested against the provider OpenAPI — are unexercised. Every real generation went
   through a side channel with weaker provenance than the design specifies.
2. **Specs record conditioning that did not happen.** Three set-piece specs declare `references` that
   `create_image_pixflux` cannot accept.
3. **Prompt-of-record drift.** `gen-setpiece-skiff.json`'s subject is not the text that produced the
   winner.
4. **Two lanes, one word.** PixelLab (hard palette, native canvas, binary alpha) and codex-imagegen
   (524–615 colours, `alpha: false`, 20× downsample, 9-of-12 baked checkerboards) both write to
   `candidates/` and are both called "candidates." No policy distinguishes them.
5. **Volume buys noise, not range.** 10 hero generations → 9 unique images → 1 design → 0 usable.
   Cherry-picking assumes variance *across* candidates; here the variance is texture and the design is
   the model's prior.
6. **`kind: "prop"` is a gate hole.** It skips the three value gates. `gate-1002` passed **10/10** with
   zero pixels above B2, zero gold (§8.2.2 unmarked), and would ship **darker than the plaza it stands
   on** (Weber +0.14).
7. **The judging canvas is not the shipping form.** Both set pieces were gated as 160px single cells;
   in game they are multi-cell masses that `bakePropShadows` currently cannot place. Both 10/10s are
   provisional.
8. **Custody is asymmetric.** Every accept gets a hash-verified receipt. Every reject lives in prose.
   **The rejection corpus is this project's most valuable art data** — it is the only place it has
   learned anything — and it sits in a gitignored cache with no record.

---

## 7. Proposed visual constitution — the four articles that are missing

You already have a constitution. Do not write another. It fixes palette, value bands, tile size,
camera, outline, shadow, light direction and composition, and it is enforced where it reaches. These
four gaps are what let inconsistency through anyway.

**Article I — One pixel grid.** Every authored sprite lands 1:1 on the render target. A sheet's cell
size divided by `worldScale` is its logical size; anything else is a defect. *Enforcement: `cut()`
sets `orig`; a test asserts source:target parity for every registered sheet.*

**Article II — Colour placement, not just colour identity.** Each colour in an asset's ramp declares a
maximum share and a maximum bounding box as a fraction of the sprite. *Enforcement: a new compile
gate.* This converts the project's best art direction — currently prose in `paletteNote` fields — into
something machine-checked, and would have caught the skiff's 815 gold pixels automatically.

**Article III — Detail density has a budget.** Edge density per asset class, measured, with the
code-authored world as the reference (15.9% floor, 20.8% props). *Enforcement: a new compile gate.*
Nothing today stops a 52%-churn asset landing beside a 21%-churn world.

**Article IV — Projection is a reference image, never an adjective.** "high top-down" as a *word*
produced 10 out of 10 elevation portraits. The camera must be supplied as a rendered image at the
exact game projection. *The Blender lane can emit this for free*, which makes it the natural feeder
for the generated lane rather than its competitor.

---

## 8. The ideal PixelLab pipeline

The governing rule: **generate positive nouns, rig relations, code refusals.**

| # | Stage | Input | Tool | Output | Acceptance | Failure mode | Verification |
|---|---|---|---|---|---|---|---|
| 0 | **Classify** | an asset need | judgement | one of noun / relation / refusal | the class is unambiguous | mis-class wastes a whole round (12 gates, 3 seals) | if the brief contains "not", "without", or a comparison to another asset, it is not a noun |
| 1 | **Canonical reference** | approved master | Blender lane | one on-model 64px asset the project would defend | it passes gates *and* the eye | §12.6 has no first term today | the orchestrator's 1× judgement |
| 2 | **Projection reference** | the rig | Blender headless | mannequin rendered on a floor tile at the game camera | matches the shipped frame exactly | an adjective instead of an image | diff against a real `pnpm shot` |
| 3 | **Frame template** | canvas rules | tool | template image: cell, body cap, anchor row | the generator receives it as a reference | prose caps that nothing measures | a body-only bounds gate (the current height gate caps at 52px on a 64 cell, so the 40px rule is measured by nothing) |
| 4 | **Generate** | spec + refs 1–3 | `generate.ts` (MCP routed through it) | candidates + manifest | palette lock holds; provenance recorded | side-channel calls with no manifest | 0 off-canon pixels, 0 partial alpha |
| 5 | **Screen** | candidates | orchestrator at 1× | keep / reject **with a receipt** | every reject writes `.rejection.json` | rejects lost to prose | the rejection corpus grows |
| 6 | **Compile + gate** | master | existing pipeline | sheet + sidecar | 0 blocking; waivers exact and explained | `kind:"prop"` skipping value gates | fix the hole |
| 7 | **Bake the marks** | compiled mass | code | gold crossings, light pools, shadows | §8.2.2 satisfied | expecting the generator to place them | it never has, 12 for 12 |
| 8 | **Place** | sheet | engine | in-game at 1× with hero for scale | reads at gameplay scale | judged on a canvas that will not ship | `pnpm shot`, read at 1× |

**Do not use `create_image_pro`** — 20–40 generations, and it buys nothing pixflux's free palette lock
already delivers. Its only case is multi-reference composition.

**PixelLab's two demonstrated strengths, both worth using:** 8-direction rotation of a master *we*
authored (identity held across all facings, 1 generation), and template locomotion (a real gait with
extension, counter-swing and lean — the best animation in the corpus, 1 generation). Both take our
identity and do labour. Neither asks it to invent under constraint.

**Missing prerequisite for the accelerator role:** `animate-with-skeleton` takes exact keypoints and
the rig can emit them; nothing in the repo emits keypoints today. That is the highest-leverage missing
piece, and it converts PixelLab's one hard failure (free-text combat) into its strength.

---

## 9. Hero plan

**Done this session:** eight masters approved with hash-verified receipts — unarmed ×3 facings, roll
×2, greatsword ×3 — with the crest reshaped from horns and the mantle given fold geometry. The ASCII
placeholder and the Kenney fallback are being deleted as this document is written.

**Next, in order:**

1. **Frames, not fidelity.** The selectors are already built and tested; nothing has ever bought
   frames for them. An 8-frame run and a 5-pose swing chain make the hero feel alive far more than any
   redraw. Note `clipSelect.ts:70` requires ≥2 startup frames — buying that frame *activates* the
   plant-pose mechanism that is currently unreachable code.
2. **Idle variation and secondary motion.** A breathing idle and cloak follow-through. Personality is
   currently 20/100 and this is most of it.
3. **Grounding.** Contact shadow scaled to the pose, foot planting checked against the (currently
   vacuous) planted-feet gate.
4. **Do not add an outline or a rim.** Ground separation is already carried by value (Weber 1.01) and
   the wine field. An outline would fight the code-authored world's flat-mass language.

---

## 10. Opening-town plan

The environment is the strongest thing here; treat this as protection, not overhaul.

1. **Bake the Gate's threshold mark.** The generated Gate has zero gold. `bakeBardoGate` already draws
   `goldDim` courses as integer-aligned rects — the exact §8.2.2 mark twelve generations could not
   produce. **Generated stone, baked light. Generation owns mass and material; code owns anything the
   eye is meant to be led to.**
2. **Finish the arrival's drench.** The Gate got revelation; the causeway got a lamp.
3. **Recast the actors from the rig, not the generator.** Every constraint the generator failed is
   computed in a rig. This is the last Kenney.
4. **Solve prop placement before approving any set piece.** `bakePropShadows` excludes by index and
   neither compiled set piece can currently be placed. Until a multi-cell footprint contract exists,
   a 10/10 is provisional.

---

## 11. The sword moment

Currently a state flip: `p.armed` changes and the sprite swaps. It is the first act of agency in the
game and it has no beat.

The whole moment, restrained, in the order that buys the most per unit of work:

1. **Proximity** — the blade's specular catches as the player enters the rack radius. Code, one light.
2. **A pickup pose** — anticipation → grasp → rise, three authored frames. The rig has the poses.
3. **Hit-stop** — 4–6 ticks at the grasp. The mechanism already exists in `tuning.hitstop`.
4. **The room answers** — the sealed north Gate's mark lights on the same tick. Already wired to
   `rackTaken`; it just needs to feel simultaneous.
5. **One sound.** One good one.

Explicitly **not**: particles, camera shake, a UI flourish, or a weapon glow. The bible forbids baked
glow, and one excellent animation with one excellent sound beats twelve effects.

---

## 12. Art vs code

| Medium | Owns | Why |
|---|---|---|
| **Blender rig** | every character, every equipment state, every combat clip | every constraint a generator failed is *computed* from bones; 52-second catalogue iteration |
| **PixelLab** | 8-direction rotation of our masters; template locomotion; positive-noun props (boats, braziers, bells, lanterns) | its two demonstrated strengths; the one class that has ever passed |
| **Code** | tiles, materials, autotiles, HUD chrome, telegraphs, impacts, swing arcs, **anything defined by refusal**, **all threshold marks and light on generated masses** | a sprite cannot track `tuning.ts`; and code can *guarantee* a pattern never resolves into a glyph — which is why the Seal arch works now and 3 generations did not |
| **Runtime** | lighting, grade, camera, post | must respond to sim state |

---

## 13. Ranked highest-leverage changes

| # | Change | Impact | Cost | Reuse | Risk |
|---|---|---|---|---|---|
| 1 | **The pixel-grid fix** (`cut()` sets `orig`) | Every authored character becomes crisp and stops crawling. Fixes "pasted on" globally. | ~1 line | every sprite, forever | Brute shrinks by ⅓ — verify |
| 2 | **Ship the approved hero; delete the ASCII placeholder and the Kenney fallback** | Removes the loudest defect in the game | 1 session | — | frame-name bridge must be exact |
| 3 | **Adopt the noun/relation/refusal lane law** | Stops burning generations on classes that structurally cannot succeed | a decision | all future art | none |
| 4 | **Colour-placement gate** (share + bbox per colour) | Converts the best art direction from prose into enforcement | ~half a day | every generated asset | none |
| 5 | **On-model + projection references** | Starts the §12.6 compounding that has never begun | rig emits both free | every generation | none |
| 6 | **Buy the hero frames** (8-frame run, 5-pose chains, breathing idle) | Personality 20 → 60 | rig time | all actors | none |
| 7 | **Recast the five actors from the rig** | Kills the last Kenney; fixes enemies darker than their floor | 1–2 sessions | — | needs identity rounds |
| 8 | **Rejection receipts** (`pnpm art reject --reason`) | Preserves the most valuable corpus this project has | ~1 hour | forever | none |

---

## 14. Phased plan

**Phase 0 — Stop / preserve / remove.**
*Stop:* generating anything defined by a negative or a relation; passing the concept boards to
generators as style references (they contradict the bible and win); `create_image_pro`.
*Preserve:* the bible, the gate suite, the receipt mechanism, the reproducibility test, the code-tile
lane, the rig, the sim/art timing contract.
*Remove:* the ASCII pose art and its off-palette colour table; the Kenney player fallback; eventually
`tiny_dungeon.png` and the `SPRITE`/`WEAPON` index tables.
**Done when:** no Kenney texture binds to the player and no view file contains authored pixels.

**Phase 1 — Art-direction lock.** The four missing articles (§7). Colour-placement and detail-density
gates written; the on-model and projection references emitted from the rig; the frame template plus a
body-only bounds gate. **Done when** a generation can be rejected *automatically* for putting the
right colour in the wrong place.

**Phase 2 — Hero.** Ship the approved masters behind the pixel-grid fix; then buy frames (8-frame run,
5-pose chains, breathing idle, cloak follow-through). **Done when** the hero reads as a character at
1× in motion, on the grid, in every state, with no fallback path alive.

**Phase 3 — Opening town.** Bake the Gate's threshold mark; finish the arrival drench; solve the
multi-cell prop footprint contract. **Done when** the arrival measures a full band of centre lift *and*
wins its blind compare against concept-02 on composition, not just on structure.

**Phase 4 — Animation + interaction.** The sword moment's five beats (§11); ambient environmental
motion. **Done when** the pickup has anticipation, contact and consequence, and a first-time player
pauses on it.

**Phase 5 — Integration + polish.** Actor recasts from the rig; delete `tiny_dungeon.png`; weapon
sprites folded into body sheets. **Done when** `grep -r tiny_dungeon src/` is empty.

**Phase 6 — Production pipeline.** Route every generation through one client; add rejection receipts;
emit rig keypoints for `animate-with-skeleton`. **Done when** a new actor goes identity → gated
candidate → approval package without a human writing a prompt by hand.

---

## 15. Definition of done — the opening-town vertical slice

The slice is complete when **all** of these hold:

1. No Kenney texture and no view-file-authored pixel reaches the screen in the first sixty seconds.
2. Every authored sprite renders 1:1 on the pixel grid; a test asserts source:target parity per sheet.
3. The hero reads as a character at 1×, in motion, in every state, armed and unarmed — with an
   8-frame run, a breathing idle, and no fallback path alive in the code.
4. The sword pickup has anticipation, contact and consequence, and the room answers on the same tick.
5. The arrival, the axis and the Gate plaza each pass §11.1 **and** win a blind compare against their
   named concept exhibit on composition.
6. Every shipped asset has a receipt; every rejected candidate has a rejection receipt with a reason.
7. Colour-placement and detail-density gates exist and are green on every shipped asset.
8. A new asset can go from identity decision to gated candidate without a hand-written prompt.
9. `pnpm typecheck`, `pnpm test`, `pnpm matrix -- --seeds 1-100`, the pinned replays and
   `pnpm room:gate` are all green.
10. **The user plays the first minute and does not want to change anything.** This gate is theirs
    alone, and no agent may award it.
