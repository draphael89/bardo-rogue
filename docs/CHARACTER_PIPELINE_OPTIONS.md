# Character pipeline options — costed comparison

Status: **DRAFT for human review.** Written 2026-08-29 for CHARACTER_FOUNDATION.md §11 and
exploration-phase item 2. Nothing here is decided; the user locks the pipeline.

The question: what single authoritative source of truth produces the player character, so that
weapon 20 and armor set 30 are pleasant to make? The disqualifier, from the brief: any pipeline
where a new weapon means rebuilding the character from scratch.

Method. Every claim below is tagged **[measured]** (verified in this repo or run live this
session), **[source]** (a cited primary account), or **[judgment]** (my estimate). Two live
experiments ran today: a PixelLab character + two animations (3 generations spent, evidence:
`docs/pipeline-evidence-pixellab.png`), and a Blender headless render spike (evidence:
`docs/pipeline-evidence-blender-spike.png`).

---

## 0. What already exists, and what it means for every option

The repo already owns the *downstream* half of any pipeline. All four options plug in at the same
seam — "produce a master image" — and everything after that seam is built, tested, and should not
be rebuilt:

- **The compiler takes an arbitrary source image** and produces a contract-conforming sheet:
  despill → binary alpha → map every source pixel to canon → per-output-pixel vote → salience
  rescue → fit → pivot → emit (`tools/art/compile.ts:1-11`). Any renderer, generator, or hand tool
  that emits a PNG feeds it. [measured]
- **Sheets are addressed by semantic frame name**, and the sidecar carries per-frame pivots,
  `anchorX`, and sockets as bbox fractions that survive recompile scale
  (`tools/art/compile.ts:90-113`, `art/specs/brute.json:59-99`). [measured]
- **Timing can never desync from hitboxes.** Combat clips carry no timing; the renderer derives
  the frame from `stateTick` against `tuning.ts`, and the compiler fails the build if a clip's
  `sim.ref` does not resolve to a real tuning window with a live phase
  (`src/render/sheet.ts:1-13`, `tools/art/compile.ts:34-86`). Consequence: **"change attack
  timing" is already free in every option below.** [measured]
- **The renderer binds body texture + white silhouette per frame** and takes anchors from the
  sidecar (`src/render/views/player.ts:492-511`); whites are baked at load
  (`src/render/atlas.ts:63`), so any conforming sheet gets hit-flash and rim treatment free.
  [measured]
- **Gates measure what a critic measures**: palette subset, silhouette mass, connectivity, ground
  separation vs the rendered floor, per-form light direction, height cap, socket-on-drawing,
  inter-frame identity, centroid continuity, planted feet (`tools/art/gates.ts:253-457`), with
  hash-verified human approval upstream (`tools/art/approve.ts`). [measured]

So the options differ in exactly two things: **what produces the master frames**, and **whether
registration data (pivots, anchorX, sockets) is computed or judged by hand**.

The current cost of "judged by hand" is on record: the brute's `anchorX` values are "the judged
planted-foot position … carried over from the hand-placed 48px registration, not re-guessed"
(`art/specs/brute.json:44`), and the hero's 16 side frames each carry a hand-declared pivot and,
on four frames, a hand-judged 1px nudge (`art/specs/hero.json:43-188,264`). [measured]

Current inventory, one identity, no equipment variation yet: 6 sheets, 56 frames (side 16,
north 16, south 16, two 4-frame rolls), authored at the pre-ADR-0002 32px cell. ADR 0002 re-authors
the whole catalogue at 64px/~39px body — meaning **the entire frame set regenerates regardless of
which pipeline wins. This is the cheapest moment a pipeline change will ever have** (the same
argument ADR 0002 itself makes). [measured]

---

## Option A — 3D mannequin rendered to pixel frames (the Dead Cells lineage)

### The primary source, since we are copying its principle

Thomas Vasseur (Motion Twin's sole artist for the first year), "Art Design Deep Dive: Using a 3D
pipeline for 2D animation in Dead Cells," Game Developer, Jan 2018
(gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-):
model + skeleton in 3DS Max, exported FBX; a homebrew tool renders "in a very small size and
without antialiasing"; models deliberately crude ("when the ingame height of the character will
only be 50 pixels … spending lots of time on the 3D model seems quite cost inefficient"); each
frame exports PNG + normal map with a basic toon shader; pose-to-pose animation with minimal
frames, interpolation "before or after the key frames. Never in-between"; **equipment is attached
to the model and re-rendered — "easy as pie"**; timing "adjusted dozens of times in minutes";
**no hand cleanup at all**. Stated costs: unsolved pixel flicker, and "the disappointing level of
details is and always will be an issue in my eyes." [source]

### How it works here, concretely

- **Blender 5.2.0 LTS is installed** (`/Applications/Blender.app`) and headless Python scripting
  works (`Blender -b -noaudio --python-expr` verified this session). [measured]
- New assets: `art/mannequin/mannequin.blend` — one mesh + armature + an action library (one
  action per animation state). **The .blend is the single authoritative source of truth** §11
  demands; it is versioned like a spec.
- New tool: `tools/art/render.ts` (`pnpm art render <spec>`) drives a Blender Python script
  headless: for each (state, keyframe, facing) it sets the action and frame, orbits the ortho
  camera (E/N/S; W is the existing `mirror: true`), renders at 8× (512px cell), and **exports the
  projected 2D positions of named bones** (hand grips, weapon tip, feet) to JSON.
- A small emitter turns that JSON into the compile spec's `frames[]` — pivots, `anchorX`, sockets
  **computed, not judged**. This deletes the whole hand-registration lane and makes the
  planted-feet and socket gates pass by construction.
- The 512px renders feed `pnpm art compile` **unchanged**: canon quantization, gates, sidecar,
  approval. The pixel look is made by the existing reducer, not by a new one.
- Spike result from today: a ~25-line bpy script of raw primitives (no rig), Workbench shading,
  one ortho render, box-downscale + 5-gray quantize → a **readable 46px running figure carrying a
  blade** (`docs/pipeline-evidence-blender-spike.png`; small figure at right is 1×). Crude, muddy,
  ten minutes of work — but the silhouette reads and faces correctly at 1×. The geometry→ortho→
  reduce path is real. [measured]
- Optional polish tier: a hand or AI pixel-over pass on *approved key frames only* (idle, contact
  frames), gated by the existing identity-drift metric. Dead Cells shipped with zero cleanup;
  treat cleanup as a budget the art direction may spend, not a pipeline stage.

### Costs

- **Setup [judgment]:** mannequin mesh + rig 1–2 days (Rigify or a hand-built 15-bone rig; CF §5's
  exaggeration list — shoulder rotation, torso twist, pelvic rotation — is a rig checklist);
  body-grammar action library (idle, run, turn, hurt, death, dodge — ~8 states of 3–6 key poses)
  2–4 days; render harness + bone-socket export 1–2 days; materials/light rig tuned until gates
  pass 1–2 days. **~5–10 working days to the first fully gated sheet set.** The honest caveat:
  pose quality is where all the artistry lives (CF §5: "beauty is strong poses more than frame
  count"), and first-pass poses will be programmer art. The pipeline makes iteration cheap; it
  does not make taste.
- **New weapon family [judgment]:** model the weapon (hours) + author the weapon-family action set
  (ready stance, light chain, heavy, recovery — the CF §4 grammar), 0.5–2 days of posing —
  then re-render every direction in minutes. This is the exact operation Vasseur calls out as the
  pipeline's reason to exist. [source]
- **New armor set [judgment]:** model overlay meshes parented to the rig (hours–1 day), re-render
  everything (minutes). **No re-animation.** Shape families (CF §7) are literal: armor is geometry
  that widens shoulders or adds mass, inside the rig's known envelope.
- **Proportion change [measured principle, judgment on hours]:** edit the mesh/rig once, re-render
  the entire catalogue automatically. Minutes to hours. **A is the only option where this is
  cheap — and it is the operation CF §1 says the exploration phase will do repeatedly.**
- **Timing change:** free (tuning.ts), as everywhere.
- **Pose correction / propagate an improvement:** edit one action or the mesh; re-render; every
  equipment set inherits it. This is §11's "propagate improvements across existing equipment"
  answered structurally.

### Quality ceiling at 39–40px

High for motion, medium for per-pixel detail. Dead Cells is the measured ceiling: expressive,
readable, fast — and its own artist calls the detail level disappointing. [source] Our canon
quantization + gates + optional key-frame pixel-over should land at or above Dead Cells' finish,
below a master pixel artist's hand. Flicker between frames is the named risk; the reducer's vote +
despeckle and the gates' identity metrics are mitigations that Dead Cells did not have.

### Risks

- Posing skill is unproven in this team (agent-authored poses judged by human + gates). The proof
  below tests exactly this first.
- A new toolchain dependency (Blender pinned at 5.2 LTS; renders must be deterministic for CI —
  Workbench/EEVEE determinism across machines needs verifying; worst case, renders are committed
  like approved masters rather than rebuilt in CI).
- Shading→canon mapping needs a real light rig (the spike's default studio light is too muddy);
  1–2 days of the setup budget, iterated against the value-band gates.
- Note on Spline 3D MCP: available in this session, but it is a cloud editor — not a deterministic,
  local, CI-runnable repo tool. At most a mesh-generation aid feeding the .blend. [judgment]

### Smallest convincing proof

1–2 days: crude rigged mannequin; idle + 4-pose run + one 5-pose greatsword swing
(anticipation→commitment→impact→follow-through→recovery, CF §5); render E/S/N; auto-emit spec with
computed sockets/anchors; through `pnpm art compile` + gates; `pnpm poses` + black test; in-game
via `pnpm shot`. Success = objective gates pass, the black test names it, the swing reads at 1×,
and a deliberate proportion tweak re-renders the whole set in under 5 minutes.

---

## Option B — Socket-composited 2D layering (paper-doll done right)

### How it would work here

The socket half exists: per-frame bbox-fraction sockets in specs (`art/specs/brute.json:59-99`),
compiled to cell pixels in the sidecar (`tools/art/compile.ts:96-100`), gated against the drawing
(`tools/art/gates.ts:356-365`). Missing: a compositing stage. Compile would gain: equipment
overlay sheets aligned per frame, a per-frame z-order (weapon behind body on some frames), and —
for CF §7's "equipment can replace body regions" — per-frame region masks in the base sidecar.
Compositing at compile time (into baked sheets) keeps the runtime untouched; compositing at
runtime would touch `EntityView` and multiply draw calls. Compile extension: 2–4 days. [judgment]

### The two problems that price it out as the foundation

1. **Weapon families change the body, and overlays cannot.** CF §4 is explicit: a dagger
   compresses the stance, a maul shifts the center of gravity. A composited weapon is "a sprite
   glued to a hand" — the exact thing the brief forbids. So every weapon family needs new *body*
   sheets anyway, and B reduces to Option D (or A) for the biggest content axis. B only helps with
   armor-over-identical-poses, the smaller half of the problem. [measured, from the brief]
2. **The content cost of aligned overlays at 40px is the famous one.** Every armor piece must be
   drawn to register pixel-perfectly on ~56+ frames × directions — and our generation lane's track
   record on *whole sheets* (7 attempts for the north master, below) says generated *overlays*
   that must match an existing frame pixel-for-pixel will be worse. Digital Sun on Moonlighter,
   80.lv interview: "if you want to add more weapons or armors to Moonlighter, you need to create
   a crazy amount of sprite, in 4 views!" — named as their limiting factor for content. [source]
3. **Proportion change breaks every overlay ever authored.** During an exploration phase whose
   whole point is proportion iteration, this is close to the disqualifier. [judgment]

### Where the idea survives

As a *variation tier on top of Option A*, not a foundation: aarthificial's Astortion rig
(youtube.com/watch?v=HsOKwUwL1bE; explainer: dev.to/derlin/this-guy-may-just-have-revolutionized-2d-pixel-animation-37ip)
stores per-pixel region coordinates so one animation sheet drives unlimited *texture-level*
appearances — recolors, materials, trims — without re-animating. That covers silhouette-neutral
armor variants cheaply; silhouette-*changing* armor goes through A's re-render. (Honesty note:
Astortion later abandoned pixel art entirely — youtube.com/watch?v=j3A1dF_T8-Q — cite as the
experiment's endpoint, not its verdict.) [source]

### Costs (as a foundation)

Setup 2–4 days of compile work; **new armor set: days of hand-aligned drawing per set**; new
weapon: no help (full body sheets, see D); proportion change: catastrophic. Quality ceiling: high
per still frame, with CF §7's "looks modular" risk live in every combination.

### Smallest convincing proof

One helmet overlay composited onto the existing hero side sheet's 16 frames, through gates + black
test. If one helmet takes more than a day to sit right, the option has priced itself.

---

## Option C — Skeleton-driven 2D tooling (PixelLab MCP)

### What the live test measured today (3 generations, character id `d3a1df3b`)

Evidence: `docs/pipeline-evidence-pixellab.png` — top row: 8-direction rotations + template run;
bottom row: the custom greatsword swing. All [measured]:

- **Character creation is fast and cheap.** A 40px featureless mannequin, 8 directions, standard
  mode: 1 generation, ~4 minutes. Body measured 41px tall in a 56px canvas — the size request was
  honored almost exactly.
- **Proportion control is soft, not exact.** Custom proportions are a standard-mode-only hint
  (`head_size: 1.1` etc. produced a visibly bigger head than requested); **pro and v3 modes —
  the quality modes — ignore proportion parameters entirely** (tool contract). We cannot fix
  proportions exactly by parameters. The one exact-control path: v3 `reference_image` mode
  *rotates a sprite we author ourselves* into 8 directions — identity ours, rotation labor theirs.
- **Template locomotion is genuinely good.** `running-8-frames`, east, 1 generation: a real gait
  with extension, arm counter-swing, lean, consistent identity. This is the tool's strength.
- **Free-text combat animation failed the test.** v3 custom, "heavy two-handed greatsword swing,
  coiled anticipation, committed downward strike", 1 generation: the unarmed mannequin was handed
  a **hallucinated glowing energy blade that materializes mid-clip**, the weapon changes shape
  frame to frame, and no anticipation→impact arc reads. Unusable as-is for the weapon-family
  grammar — which CF §4 says is where the character's personality lives. The template library has
  **zero armed-combat animations** (walks, runs, punches, kicks only). The keyframe route exists
  (v3 custom start/end frames, single direction) — but then *we* author the key poses, and
  PixelLab is an in-betweener.
- **Export carries no registration data.** The spritesheet zip is a uniform grid PNG + layout JSON
  whose only pivot field is the string `"cell-center"`. No per-frame pivots, no feet anchors, no
  sockets, no skeleton export. Every judged-registration cost we pay today
  (`art/specs/brute.json:44`) stays. Palette is uncontrolled (17 arbitrary grays in the test);
  our compile quantizes to canon, so this is absorbable.
- **Equipment = whole-character regeneration.** `create_character_state` ("wearing red armor") is
  20–40 generations per state, claims identity preservation (unverified by us), and **animations
  do not transfer across states** — every clip re-runs per state. A rough hero at 10 clips × 8
  directions ≈ 80–160 generations per equipment state. [measured from tool contracts; the
  per-state animation cost is arithmetic, judgment on clip count]
- Account state: Tier 3 subscription, 877 generations remaining, resets 2026-09-04. Noted per the
  brief: a billing cycle must not decide architecture, and does not here.

### Costs

Setup: ~1–2 days (download/registration tooling into the compile lane — the `generate.ts` pixellab
provider already exists for stills, `tools/art/generate.ts:212-218`). New weapon family: the weak
combat quality above is the blocker, not the price. New armor: 20–40 gens + full re-animation +
full re-registration by hand. Proportion change: not exactly controllable. Timing: free as always.

### Verdict shape

Not a foundation: it fails "modify proportions exactly," fails weapon-grammar quality today, and
exports no registration. It is a strong **accelerator inside A or D**: template locomotion
in-betweens, and v3 reference-rotation to turn one authored master into 8 directions.

### Proof

Already run this session — 3 generations, artifacts above.

---

## Option D — Status quo plus (per-identity gpt-image against a locked mannequin reference)

### How it works here

Keep the existing generation lane exactly as is (`tools/art/generate.ts:86-100` builds the bible
prompt; `references` conditions on the approved pool, ceiling of four images,
`tools/art/generate.ts:142`). Add the locked mannequin reference sheet to every prompt. Each
equipment set = regenerate the full sheet catalogue as new masters, re-register by hand, gate,
human-approve.

### The measured divergence record

This lane produced the current hero, and the file names carry its iteration count: the north sheet
reached approval at **v7** (`art/approved/bardo_hero_north_alpha_v7.png`), the south at **v4**,
each roll sheet at **v3** — for *one* identity, *one* equipment state, with the prompt already
demanding "Match one identity throughout" across a strict 16-cell grid
(`art/prompts/bardo_hero_north_alpha_v7.txt`). Every accepted master then needed hand-judged
pivots and nudges per frame (`art/specs/hero.json`). [measured]

That is the honest price of one drawer that samples rather than remembers: **each regeneration is
a fresh draw conditioned on references, not a locked body.** Reference conditioning narrows
divergence; it does not remove it. CF §11 names this failure by name: "never dozens of
independently drawn versions that diverge."

### Costs

Setup: 0 days (exists). New weapon family: ≈ the first hero again — multiple candidate rounds ×
5–6 sheets × human approval × hand registration; days per family. [measured baseline, judgment on
repeat] New armor set: the same. Proportion change: regenerate *everything*, with per-sheet drift
risk. Propagating an improvement: regenerate every equipment set ever approved — the cost *grows*
with the catalogue.

### Verdict shape

By the brief's own test, **disqualified as the production line**: weapon 20 means re-drawing the
character 20 times and hoping the sampler holds. It was the right bootstrap (it produced the
current hero and brute, and the compile/gate/approve machinery it forced into existence is the
part every other option keeps). It remains the right tool for *singular* assets — bosses, props,
the identity master's initial exploration.

---

## Comparison table

Setup in working days; marginal costs per §11's operations. M = measured, J = judgment.

| | A: 3D mannequin | B: 2D socket compositing | C: PixelLab | D: gpt-image + reference |
|---|---|---|---|---|
| Single source of truth | **Yes — the .blend** | No (base + N overlays) | Partial (their model, not ours) | No (per-sheet samples) |
| Setup | 5–10 d (J) | 2–4 d compile + content (J) | 1–2 d (J) | 0 d (M) |
| New weapon family | 0.5–2 d poses, re-render in minutes (J) | No help — full body sheets anyway (M, CF §4) | Blocked: combat quality failed live test (M) | Days: candidate rounds + hand registration (M baseline) |
| New armor set | Hours–1 d mesh, no re-animation (J) | Days of hand-aligned overlays per set (J) | 20–40 gens + re-animate + re-register all (M) | Same as a new hero (M baseline) |
| Proportion change | Minutes–hours, catalogue-wide (M principle) | Breaks every overlay (J) | Soft hints only; quality modes ignore them (M) | Full regen, drift risk per sheet (M) |
| Attack timing change | Free — tuning.ts, all options (M) | Free (M) | Free (M) | Free (M) |
| Registration (pivots/sockets) | **Computed from bones** (design) | Hand-judged, ×N overlays | None exported — all hand (M) | Hand-judged (M) |
| Quality ceiling @ 39–40px | Motion high, detail medium (source: Dead Cells) | Detail high, "looks modular" risk (CF §7) | Locomotion high, combat low (M) | Stills high, identity drift across catalogue (M) |
| Named risk | Pose taste unproven; flicker; Blender dep | Combinatorial sprite explosion (source: Moonlighter) | Vendor lock; no registration data; cycle resets 9-04 | Divergence grows with catalogue |

## Recommendation

**Option A as the foundation, run through the existing compile→gate→approve machinery unchanged,
with C and B's surviving ideas as tiers on top:**

1. The Blender mannequin (.blend: mesh + rig + action library) is the single authoritative source
   of truth. Weapons and armor are meshes on the rig; poses and proportions live in one file;
   re-render is minutes. Registration (pivots, anchorX, sockets) becomes computed output, deleting
   the hand-judged lane. This is the only option that makes *all eight* of §11's cheap-iteration
   operations cheap, and it is the literal lineage of the principle the brief names.
2. PixelLab stays as an accelerator where it measured well: template locomotion references, v3
   in-betweening of our authored keyframes, v3 reference-rotation — never as the pose author for
   combat, never as the proportion authority.
3. Silhouette-neutral armor variation ships as palette/texture remap over one sheet (the
   aarthificial tier); silhouette-changing armor goes through the rig and re-renders.
4. gpt-image remains for singular set-pieces and identity concepting, feeding the same gates.

**The proof to run first** is Option A's: 1–2 days, crude mannequin, idle + run + one full
greatsword swing arc, three facings, computed sockets, through compile + gates + black test +
in-game shot — ending with a deliberate proportion tweak re-rendering the whole set in under five
minutes. It attacks the two genuinely unproven claims (agent-authored pose quality at 40px, and
gate-passing shading from a 3D render) while every already-measured fact above stands independent
of it. If the swing does not read at 1×, we have lost two days, and options C-as-in-betweener and
D-for-keyframes are the fallback *inside the same compile contract* — the seam holds either way.

## Where evidence is thin — stated plainly

- All Option A day-costs are estimates; nobody has built the rig yet. The spike proves the render
  path, not the pose quality — that is precisely what the first proof buys.
- Dead Cells' cleanup-free finish uses engine-side normal-map lighting we do not have; our finish
  relies on the canon quantizer + gates instead. Comparable, not identical. [judgment]
- PixelLab's identity preservation across `create_character_state` and its keyframe in-betweening
  quality were *not* tested today (cost discipline); both are cheap follow-ups if C's accelerator
  role is taken up.
- Blasphemous-style full hand animation was not costed as an option: no pixel-artist labor exists
  in this production, and every primary account of that lane (Eastward's ~70k frames, Moonlighter
  above) prices it out for a solo/agent team. If that changes, it re-enters as a polish tier, not
  a pipeline.
