# AI-First Art Pipeline Audit

Audit date: 2026-08-28. Scope: how Bardo Rogue's art gets made from here — what to keep from the
Kenney-era stack, which AI-first production pipeline to build, and the smallest system that
produces a large amount of beautiful, cohesive, game-ready art.

## TL;DR

**Recommendation: the Pixel-Native Factory (Workflow 3, scored 84/100).** Generate characters
with pixel-art-native models behind a hard asset contract: **Retro Diffusion** (palette-forced,
true 1× grid) authors each character's *identity sheet*; **PixelLab** (character v3 + skeleton
animation) turns the approved identity into directions and semantic pose frames; a beefed-up
`tools/process-sprite-sheet.mjs` normalizes everything to the canon palette with per-frame pivots
and machine-checkable gates; `ART_DIRECTION.md` stays the enforcement layer. Environments, VFX,
telegraphs, decals, and UI stay **code-native** — that pipeline already exists in this repo and is
already the best-looking part of the game. Frontier image models (GPT Image, Nano Banana) are
demoted to concepting and reference boards; they never ship pixels again.

The game's biggest architectural advantage is that it does not need flipbook animation. The
renderer selects **semantic poses from sim state** (`heroFrame()`, `bruteFrameIndex()`), with
timing owned by `src/tuning.ts`. What a character costs is therefore a *pose sheet* — 8–16 named
drawings plus pivots — not a 200-frame animation. That is exactly the artifact today's pixel-art
models can produce reliably, and exactly the thing general image models cannot.

---

## 1. Inventory: asset on disk → pixels on screen

```
public/assets/**  (committed PNG/OGG/WOFF2)
  └─ manifest.json          flat file lists per directory; rewritten by BOTH `pnpm assets` and `pnpm tiles`
      └─ atlas.ts           loadAtlas(): fixed sheet filenames, hard-coded columns/cell sizes,
         │                  index-addressed sub-textures, runtime white-silhouette baking per sheet
         └─ views/*.ts      semantic frame maps (HERO, BRUTE consts) + per-frame pivot tables
             │              (HERO_PIVOT_Y, BRUTE_PIVOT, BRUTE_HEAD) hard-coded in TypeScript
             └─ EntityView  body/weapon/shadow sprites, feet-anchor, feet-Y z-sort, squash/flash
                 └─ 480×270 RenderTexture → integer upscale → grade/postfx
```

Animation is **not** a flipbook player. The sim state machine (`state` + `stateTick` measured
against `tuning.ts` windows) selects a pose each tick; procedural transforms (squash, lean, hop,
weapon arcs) animate the Kenney puppets; authored sheets zero those transforms and swap frames.
Attack frames are locked to the hitbox windows by construction — art cannot desync from combat.

Current asset families and how each is produced today:

| Family | Source today | Status |
|---|---|---|
| Room tiles (16 px, 8-col) | `tools/make-bardo-tiles.ts` — **code**, canon palette, built to ART_DIRECTION §§1–2 | Original. Strong. |
| Props (32 px, 4-col) | same tool | Original; some off-palette colours flagged by §1.3.2 |
| Hero (32 px ×16 poses) | GPT-image sheet → `process-sprite-sheet.mjs` | Original but muddy (see §3) |
| Brute (48 px ×8 poses) | same | Original but muddy |
| Caster/Charger/Warden/Dummy | **Kenney Tiny Dungeon** indices (`SPRITE`/`WEAPON` in `views/shared.ts`) + procedural puppet transforms | Kenney |
| Player fallback (vertical/diagonal actions) | Kenney tile 96 + hand-typed 16 px ASCII poses (`ROLL_ART` in `views/player.ts`) | Mixed |
| Telegraphs, impacts, swing arcs | **code** (`enemy-brute.ts`, `player.ts` Graphics rasterisers) | Original. Excellent. |
| Particles | Kenney Particle Pack (soft 512 px shapes → 64 px) | Kenney; violates §6.1/§6.2 in spirit |
| Decals | Kenney Splat Pack | Kenney |
| Light masks | Kenney circle masks | Fine (lightmap is not pixel art) |
| Fonts (HUD) | 4 Kenney webfonts | Kenney; §7.2 wants an authored bitmap face |
| Audio | Kenney packs | Out of scope here |
| `micro.png` | Kenney Micro Roguelike | **Loaded but unused — dead weight** |

The agent evaluation loop already exists and is the single most valuable piece of pipeline
infrastructure in the repo: `pnpm shot` / `pnpm poses` / `pnpm strip` / `pnpm sim`, the
deterministic sim, `window.__game`, replay pinning, the gauntlet blind-critic protocol, and
`ART_DIRECTION.md` §11.1's computable gates.

## 2. Reusable infrastructure / Kenney assumptions / missing primitives

**Keep regardless of art style**

- The sim/render split and the deterministic harness (shot/poses/sim/strip + `__game`). This *is*
  the "run game → capture → evaluate" half of an agent art loop; most teams have to build it.
- 480×270, 16 px grid, integer upscale, nearest sampling, per-sprite pixel rounding.
- The semantic-pose animation model with timing in `tuning.ts`. It converts "animation" from a
  content problem into a data problem (N named drawings + pivots per character).
- `EntityView` (feet anchor, feet-Y sort, shadow, white-silhouette flash/rim contract —
  `whiteSheet()` in `atlas.ts` means any new sheet gets hit-flash for free).
- `make-bardo-tiles.ts` and the whole art-as-code environment pipeline, including the baked
  1× room `RenderTexture`.
- The procedural VFX/telegraph language (Bayer dithers, integer-row blobs, authored spark tables).
  This is already at shipped-game quality and is the asset class code agents do *best*.
- `ART_DIRECTION.md` (the art bible exists and has computable gates) and the `pixel-art-sprites`
  skill (timing bands, stride formula, outline rules — already written as a generation spec).
- `process-sprite-sheet.mjs`'s *shape*: deterministic normalizer + JSON metrics sidecar + pass gate.

**Kenney-specific assumptions to retire**

- `SPRITE`/`WEAPON` index constants into `tiny_dungeon.png`, and the puppet model they imply: a
  16 px body sprite + a *separate weapon sprite* transformed in code. Authored sheets draw the
  weapon into the pose (the brute migration proves it); the two-sprite model should not survive.
- 16 px characters (Forbidden list §10.20; canvas decision §4.1 is 32 px).
- Kenney particles (soft radial alpha), splat decals, HUD webfonts, `micro.png`.
- `manifest.json` being rewritten wholesale by two competing tools (`assets` after `tiles` drops
  the bardo sheets — a standing footgun documented in CLAUDE.md).

**Missing primitives (needed before any generator can scale)**

1. **A sheet metadata sidecar.** Frame maps, pivots, and anchor points are TypeScript constants
   (`HERO`, `HERO_PIVOT_Y`, `BRUTE_PIVOT`, `BRUTE_HEAD`). Every new character means hand-editing
   the renderer. The contract in §8 moves this to `<sheet>.json` next to the PNG.
2. **Directional coverage in the contract.** Only horizontal actions are authored; the renderer
   falls back to the Kenney puppet off-axis (`authoredBladeFor()`'s 0.92 cosine gate). The
   contract needs facing as a first-class axis (S/E/N + mirror at minimum).
3. **Legibility gates.** Current metrics check palette size, binary alpha, and non-empty frames —
   both shipped sheets **pass** while being visually muddy. Gates must also measure what the
   critic measures: silhouette (black test), ground separation (Weber contrast vs the floor ring,
   ≥ +1.0 per `gauntlet/ASSET-KIT.md`), palette *identity* against canon (not just count), and
   inter-frame identity (no drift).
4. **A generation client.** No `tools/` entry talks to any generator; the GPT-image sheets were
   made out-of-band and pasted in. The pipeline needs `tools/generate-sprite.ts` (or MCP use)
   so generation, normalization, gating, and preview are one command.

## 3. Evidence already in this repo

**Art-as-code wins for environments.** Eleven critic rounds against reference games produced
`ART_DIRECTION.md`; `make-bardo-tiles.ts` rebuilt the room to it. A fresh `pnpm shot` today shows
a room with genuine identity: void-and-stars framing, dark walls with one lit cope, light pools,
gold-as-threshold. The environment problem is *solved in principle* — it needs more realms, not a
different pipeline.

**The GPT-image experiment (2026-08-28) half-worked, and the failure is measurable.**
`art/approved/bardo_hero_alpha_v1.png` (1254² source, 16 poses) is genuinely good: consistent
character, dramatic silhouettes, correct palette family. The shipped 32 px derivative is muddy —
silhouettes collapse, limbs dissolve into noise. Root cause: the source's fake "pixels" are
~9.8 px and not aligned to the 4×4 grid (313.5 px cells), and the normalizer samples **one point
per output pixel** (`kernel: 'nearest'`), i.e. a coin flip near every edge. Re-running the same
source through a majority-vote (mode) downsampler produces visibly cleaner sheets
(`docs/audit-evidence-downsample.png`, left: shipped, right: rerun) — blades read as blades. Two
lessons: (a) the normalizer is as important as the generator; (b) even fixed, hi-res-style →
32 px tops out at "acceptable", far below what pixel-native models emit directly. Note also that
the metrics sidecar said `pass: true` for both sheets — gates that only count colours cannot
catch a collapsed silhouette.

**The renderer migration path is proven.** The brute went from Kenney puppet to an authored
48 px sheet without touching the sim: pivots + head anchors + frame map, transforms zeroed,
flash contract preserved. Each remaining enemy is the same mechanical move.

## 4. Tool landscape (August 2026, verified against live docs)

Full source list at the end. The load-bearing facts:

- **PixelLab** (pixellab.ai) — the only vendor with a complete character loop: create character
  with 4/8 directions (v3, 16–256 px, reference-image mode rotates an approved south-facing
  sprite), 50+ named skeleton animation templates, `animate-with-text-v3` (4–16 frames),
  `animate-with-skeleton` (exact keypoints, 3-frame windows), forced palettes, inpainting,
  Wang tilesets (16-tile corner-Wang — **not** our 47-blob format), plus an **official MCP
  server** (`https://api.pixellab.ai/mcp`) and `llms.txt`. $12/mo ≈ 2,000 generations; economy
  calls $0.002–0.017. Documented weaknesses: quality drops at small sizes (32 px is its marginal
  zone; community guidance is generate 48–64 px), and top-down view drift on the raw image
  models — pin `view`, use the character endpoints. The repo already has an 884-generation
  budget and an ordered asset kit (`gauntlet/ASSET-KIT.md`).
- **Retro Diffusion** (retrodiffusion.ai) — best-in-class *pixel authenticity*: generates true 1×
  grids natively (12–512 px), **`input_palette` forces output to a fixed palette** (our canon
  palette as a PNG), `reference_images` (RD Pro) for style conditioning, seamless `tile_x/y`,
  animation endpoint (4–16 frames: walk/idle/attack/custom, sheet output), free `fix_pixel_art`
  grid-recovery, background removal, and an official **MCP server**. Pay-per-image: RD Plus
  ~$0.06, Pro $0.18, animations $0.07–0.25. Weaknesses: **no rotations**, tilesets limited,
  10 req/min.
- **Frontier models** — GPT Image 2 *dropped* transparent backgrounds; gpt-image-1.5 (which made
  our sheets' lineage) is deprecated with API removal Dec 2026. Nano Banana Pro takes 14
  reference images but has no alpha and no exact pixel-size control. All of them emit
  "pixel-style" images off-grid with drifting cell sizes; the 2026 snap stack is
  **unfake.js/unfake.py** (auto grid detection) and Astropulse's **k-centroid**. Community
  consensus: good for volume/concepts, bad for hero animation; sheet frames misalign and
  identities drift between frames.
- **Local/open** — ComfyUI is fully headless/API-drivable; OpenPose ControlNet does not work at
  sprite sizes (generate large + snap); Wan 2.2 video-to-sprite workflows exist and work
  semi-reliably; RIFE/FILM interpolation produces palette mush and is unnecessary at 4–8 frames
  per action.
- **3D prerender** — the Dead Cells pipeline (3ds Max → tiny unsmoothed renders) is fully
  reproducible headlessly in Blender (`blender -b -P`), with Mixamo for retargetable clips and
  batch addons for 4/8-direction sheets; AI 3D (Tripo/Meshy) is adequate for low-poly characters
  destined to be crushed to 48 px.
- **Normalization/QA tooling** — Aseprite ($20, source-available, compiles on Linux) is fully
  scriptable headless: Lua API + `--sheet --data` JSON exports with tags and slice pivots.
  free-tex-packer-cli exports PixiJS atlases. `sharp` (already a dep) covers the rest.

## 5. Five workflows, end to end

Scoring: ten axes, 0–10 each, weighted for *this* project — characters and animation are the gap
(×1.5), consistency ×1.25, scalability/agentic/control ×1.0, iteration/integration/ceiling ×0.75,
cost ×0.5. Weighted total /100.

### W1 — The PixelLab Monolith (75/100)

All generated art through one vendor. Concept: describe a character per ART_DIRECTION §4 →
`create-character-v3` at 48–64 px with a style reference → 8 directions → skeleton-template or
text animations for the semantic pose list → export sheet → normalize (canon-palette snap, pivot
detection) → sidecar → game. Tiles via its corner-Wang generator (remapped or edge-filled to our
autotile masks), props via `generate-with-style-v2` (at ≤42 px it returns **64 candidates per
call** — cheap cherry-picking). Iteration = inpaint or re-roll with seed. Consistency = one saved
character per cast member + shared style refs + forced palette. Agent operability is best in
class: official MCP, async jobs, llms.txt.

Scores: VQ 6.5 · Anim 7 · Cons 7 · Scale 8.5 · Agent 9.5 · Iter 8.5 · Ctrl 7 · Integ 8 · Cost 9 · Ceiling 6.
**Why not the winner:** its image quality at our sizes is its documented weak spot, its raw
models drift off top-down view, and single-vendor style ceiling becomes the game's ceiling —
the exact "asset pack defines the game" trap, one level up.

### W2 — Frontier Canvas → Grid Snap (52/100)

The current experiment, upgraded: GPT Image / Nano Banana / FLUX.2 generates high-res sheets on
chroma green with style references → unfake/k-centroid grid detection + majority-vote downscale
→ canon-palette quantization → content-aware slicing (connected components, not fixed grid) →
feet-baseline re-anchoring → sidecar. Iteration via each model's edit endpoint ("same character,
now the contact frame").

Scores: VQ 5 · Anim 3.5 · Cons 4 · Scale 6 · Agent 8 · Iter 6 · Ctrl 3 · Integ 6.5 · Cost 8 · Ceiling 4.5.
**Why it loses for shipped pixels:** every weakness is structural — off-grid output, per-frame
identity drift, misaligned sheet cells, no reliable alpha (GPT Image 2 removed it; our own
chroma-key + despill exists precisely because of this), and its generator lineage is being
deprecated under us. First-hand evidence in §3: even with the normalizer fixed, output tops out
below pixel-native models. **Where it stays:** concept boards, realm exploration, style
references, the art bible's example images — it is the best *imagination* in the field.

### W3 — The Pixel-Native Factory (84/100) ← RECOMMENDED

Two pixel-native models, each doing what it is best at, behind one contract.

1. **Identity (taste gate).** For each new character: RD Plus/Pro generates the *identity sheet*
   — one south-facing 32/48 px master pose + a portrait-scale study — palette-forced to canon via
   `input_palette`, style-conditioned on the approved-asset reference pool. Generate 8–16
   candidates; gates filter; **a human approves one**. This is the single deliberate human
   checkpoint in the pipeline, and it is where "AI slop" is structurally prevented: nothing
   downstream can drift from an identity that was hand-chosen against the bible.
2. **Directions + poses.** PixelLab character-v3 consumes the approved south-facing master →
   8 directions; skeleton templates / `animate-with-text-v3` produce the semantic pose list from
   `references/animation.md` (idle, run A/B, hurt, swing chains, dodge, death — 4–16 frames,
   fitted to `tuning.ts` windows). Off-template poses (windup silhouettes, contact frames) via
   `animate-with-skeleton` keypoints or RD img2img on the master with low strength.
3. **Normalize.** `process-sprite-sheet.mjs` v2: grid detection + majority-vote sampling (needed
   only for non-native sources), **canon-palette mapping** (nearest canon colour, not free
   quantization), binary alpha, despill, per-frame **feet-baseline pivot detection** (bottom-most
   opaque run's centroid), duplicate-frame detection.
4. **Gate.** Metrics sidecar v2 (§10) — hard fail before the game ever loads it.
5. **Integrate.** `<sheet>.json` sidecar (§8) read by `atlas.ts`; renderers stop hard-coding
   pivots. `pnpm poses` + `pnpm shot` render it in situ; gauntlet judges it blind.
6. **Environment/VFX/UI stay code-native** (W5 as a component, where it scores ~95): realms are
   palette+material packages for `make-bardo-tiles.ts`, telegraphs and impacts stay Graphics
   rasterisers, particles get redrawn as authored integer-pixel sprites (a day of code), HUD
   stamps and the bitmap font are authored 8×8/5×7 assets.
7. **Iteration.** A failed gate or lost blind round names the frame; fix via PixelLab inpaint /
   RD img2img on that cell only, or agent-level pixel surgery (the repo already hand-types 16 px
   art as ASCII; single-frame touch-ups are in-scope for a coding agent at 32 px).

Scores: VQ 8.5 · Anim 7.5 · Cons 8.5 · Scale 8 · Agent 9 · Iter 7.5 · Ctrl 9 · Ceiling 8.5 · Integ 8.5 · Cost 9.
Cost at scale: PixelLab $12–24/mo covers thousands of generations; RD is cents per image —
a full cast regeneration is tens of dollars.

### W4 — The Dead Cells Factory: 3D prerender (71/100)

Blender headless as the sprite renderer: low-poly stylized character models (AI-generated via
Tripo/Meshy or hand-modeled once) + Mixamo/retargeted clips → orthographic camera, flat shading
→ render each semantic pose at 2× → majority-vote downscale + canon-palette snap + outline pass
→ sheets. Every direction and every pose is a camera angle and a keyframe; consistency is *by
construction*; re-rendering the whole cast after a style change is one script.

Scores: VQ 5 · Anim 8 · Cons 9 · Scale 9 · Agent 6.5 · Iter 4 · Ctrl 9 · Integ 5 · Cost 7 · Ceiling 7.
**Why not now:** the hard part moves to stylization — making a crushed render read as *drawn*
pixel art (cluster shading, silhouette hooks, 1 px outlines) is its own research project, and the
game's language is 8–16 strong key poses, not the smooth 30 fps interpolation this pipeline is
uniquely good at. **When to revisit:** if the roadmap becomes many characters × 8 directions ×
many actions (true 8-way movement, large bosses with long move lists), this is the escalation
path — the per-asset marginal cost is the lowest in the field once the rig library exists.

### W5 — Art as Code (73/100 as a complete pipeline; ~95 for its natural scope)

Extend what `make-bardo-tiles.ts`, `ROLL_ART`, and the telegraph rasterisers already prove: the
agent *writes* art — palettes, tiles, autotile masks, props, decals, particles, floor decals, UI
chrome, shaders — as reviewable, deterministic TypeScript against ART_DIRECTION rules, judged by
the same critic loop. Infinitely iterable, zero cost, perfect palette discipline, and the critic
gates (§11.1) run on every build.

Scores: VQ 5 · Anim 4.5 · Cons 9 · Scale 5 · Agent 10 · Iter 8 · Ctrl 10 · Integ 10 · Cost 10 · Ceiling 5.5.
**Why it can't be the whole answer:** eleven gauntlet rounds established that code hill-climbs
composition and materials well but characters need drawn anatomy; the ASCII hero poses are
serviceable at 16 px and would not carry a 32 px hero. **Why it stays half the answer:** for
environments, VFX, and UI it beats every generator on every axis that matters here.

## 6. Scorecard

| Axis (weight) | W1 PixelLab | W2 Frontier | **W3 Factory** | W4 3D | W5 Code |
|---|---|---|---|---|---|
| Visual quality (1.5) | 6.5 | 5 | **8.5** | 5 | 5 |
| Animation quality (1.5) | 7 | 3.5 | **7.5** | 8 | 4.5 |
| Consistency (1.25) | 7 | 4 | **8.5** | 9 | 9 |
| Scalability (1.0) | 8.5 | 6 | **8** | 9 | 5 |
| Agentic operability (1.0) | 9.5 | 8 | **9** | 6.5 | 10 |
| Iteration speed (0.75) | 8.5 | 6 | **7.5** | 4 | 8 |
| Determinism / control (1.0) | 7 | 3 | **9** | 9 | 10 |
| Integration (0.75) | 8 | 6.5 | **8.5** | 5 | 10 |
| Cost (0.5) | 9 | 8 | **9** | 7 | 10 |
| Long-term ceiling (0.75) | 6 | 4.5 | **8.5** | 7 | 5.5 |
| **Weighted total** | **75** | **52** | **84** | **71** | **73** |

## 7. Recommendation, answered point by point

1. **Which workflow:** W3, the Pixel-Native Factory — RD for identity, PixelLab for directions
   and poses, code for environment/VFX/UI, one contract and one gate suite over all of it.
2. **Why it wins:** it is the only option strong on all three of quality × control × automation.
   Native-grid generation with a forced canon palette eliminates the two failure modes this repo
   has already hit (off-grid mush, palette drift); PixelLab supplies the one thing nothing else
   has (rotation + skeleton animation of an *approved* sprite); both expose MCP servers an agent
   drives end to end; and the human stays exactly one approval deep — taste at the identity gate,
   never cleanup labour per frame.
3. **Keep from the Kenney era:** everything in §2's keep-list — the harness, the semantic-pose
   renderer, EntityView, the atlas path, code tiles, procedural VFX, the art bible, the gauntlet.
   Kenney *particles/decals/fonts* remain temporarily as scaffolding until their code-native or
   authored replacements land (they are the lowest-risk swaps on the list).
4. **Gradually replace:** caster → charger → warden puppets (each is the proven brute move);
   the hero + brute sheets themselves (regenerate through the factory — current ones are below
   the identity bar); Kenney particles → authored integer-pixel sprites; splat decals → authored
   16 px ichor set per §6.4; HUD hearts/stamps → authored 8×8/9×9; webfonts → one authored 5×7
   bitmap face (last); delete `micro.png`; make `import-assets.ts` additive so `assets` and
   `tiles` stop fighting over `manifest.json`.
5. **Canonical pipeline:** spec (bible §4/§6 + `references/animation.md` + tuning windows) →
   generate candidates (RD/PixelLab, seeded, palette-forced, style-referenced) → normalize
   (`process-sprite-sheet` v2) → gate (metrics v2) → sidecar (`<sheet>.json`) → `pnpm poses` /
   `pnpm shot` in situ → gauntlet blind judgment → commit. Generators conform to the contract;
   the game never adapts to a generator's format.
6. **How an agent operates it:** both vendors' MCP servers (or `tools/generate-sprite.ts`
   wrapping their REST APIs) + the existing harness. The loop: read the asset-kit item → compose
   the prompt from the bible + approved references → generate N candidates → normalize + gate →
   assemble pose sheet → write sidecar → `pnpm poses`/`shot` → run §11.1 gates + blind compare →
   re-roll/inpaint the failing frame or commit. Human input: approve identity sheets; everything
   else is machine-checked.
7. **First assets to regenerate** (follows `gauntlet/ASSET-KIT.md`, which is already correctly
   ordered by parks-released-per-generation): ① Hero identity sheet — *the style proof*, gated by
   the black test, Weber ≥ +1.0 vs floor, saturation 0.60–0.70; **nothing else is generated until
   it passes**. ② Hero 8 directions + swing chain (windup/contact/recovery). ③ Hero hurt/death
   and roll frames. ④ Brute regeneration. ⑤ Caster (hooked staff, ≤0.5 width ratio).
   ⑥ Charger (low wedge). ⑦ Floor-wound decals + HUD stamps (code/authored, not generated).
8. **Visual language:** `ART_DIRECTION.md` *is* the art bible; add a §12 "generation spec"
   (canvas sizes from §4.1, outline rule from the skill, per-material ramps, light direction,
   per-class silhouette hooks from §4.3) and ship two machine-readable artifacts: the canon
   palette as `art/palette/canon.png` (fed to RD `input_palette` / PixelLab `force_colors` /
   Aseprite `--palette`), and `art/approved/` — every approved sprite, which becomes the style
   reference for all subsequent generations. Consistency compounds: each approved asset makes the
   next generation more consistent.
9. **Preventing generic AI slop**, structurally: palette locked *at generation time*, not
   corrected after; a human-approved identity anchor per family before any mass generation; hard
   gates that reject the failure modes we've already observed (partial alpha, palette drift,
   collapsed silhouette, floor-value bodies); the blind A/B protocol against shipped-game
   references (already the gauntlet's law); the Forbidden List (§10) applied to prompts as
   negative constraints; and few strong key poses over many soft frames (the skill's "4 good
   frames beat 12 soft ones"). No raw generation ever ships — everything passes the normalizer
   and the gates or it does not exist.
10. **Practical ceiling:** honest answer — Gungeon-tier *stills* are reachable at 32–48 px with
    candidate volume and cherry-picking; expressive animation is the binding constraint. Expect
    ~85–90% machine output with occasional single-frame pixel surgery on the frames that carry
    combat feel (contact, windup). The composite ceiling is higher than any sprite ceiling alone,
    because half this game's beauty is carried by systems that are already excellent: light,
    composition, telegraphs, impacts. A player reads "distinctive authored world" from the
    *whole frame*, and the whole frame is mostly already ours.

## 8. The asset contract (to implement as `docs/ASSET_CONTRACT.md` + loader)

Per generated sheet, a sidecar `public/assets/sprites/<name>.json`:

```jsonc
{
  "cell": 32,                      // 24 | 32 | 48 | 96 per ART_DIRECTION §4.1
  "cols": 4, "rows": 4,
  "palette": "canon",              // must map 1:1 into art/palette/canon.png (+ realm extension)
  "maxColors": 16,                 // §1.3.1 budget for the class
  "facing": "east",                // authored facing; mirror serves the opposite
  "frames": {                      // semantic names, not indices — the renderer's vocabulary
    "idle":        { "i": 0,  "pivot": [16, 28] },
    "runA":        { "i": 1,  "pivot": [16, 28] },
    "light1Contact": { "i": 5, "pivot": [16, 26], "anchors": { "bladeTip": [29, 14] } }
    // ...
  }
}
```

Rules: PNG, indexed or binary-alpha RGBA; no partial alpha anywhere; feet at `pivot`, visible art
≤ cell−6 tall; outline 1 px in the material's darkest value, never pure black; one light
direction (north, 15° left); `pnpm` tools generate both PNG and sidecar — neither is ever
hand-edited. `atlas.ts` grows one generic `sheet(name)` accessor that reads the sidecar
(replacing the per-sheet hero/brute accessors), and views look up frames by semantic name.

## 9. Quality gates (metrics sidecar v2)

Automated, run by the normalizer, hard-fail: exact dimensions & grid; per-frame non-empty; zero
partial alpha; zero chroma spill; **palette ⊆ canon** (not merely ≤ N colours); per-class colour
budget; bbox within canvas margins; feet-baseline present within 2 px of declared pivot;
duplicate-frame hash check; inter-frame identity (mean palette-histogram distance below
threshold — catches the "different character per frame" drift); silhouette legibility proxy
(opaque mass 25–70% of bbox, single connected component ± weapon); **ground separation** (Weber
contrast of body mid-values vs `slate1/2` floor ring ≥ +1.0); light-direction check (top-third
mean luminance > bottom-third). Post-integration gates stay with the gauntlet: §11.1's frame
gates plus the blind compare. The lesson of §3 is written into this list: the current gates
passed two sheets a human immediately rejects, so gates must measure legibility, not just format.

## 10. Migration plan (impact × confidence ÷ complexity)

**Immediately (before any mass generation)**
1. Fix the normalizer: grid detection + majority-vote sampling + canon-palette mapping in
   `process-sprite-sheet.mjs`. (Proven by prototype; small; benefits every source.)
2. Ship the contract: sidecar format, `atlas.ts` generic accessor, migrate hero/brute pivots out
   of TS. (Unblocks every future sheet; zero visual change; replay-safe — render only.)
3. Commit `art/palette/canon.png` + bible §12 + gates v2.
4. Wire one generation client (PixelLab MCP is already budgeted; add RD when identity work
   starts) as `tools/generate-sprite.ts`.

**First family: the hero (the style proof)**
5. Hero identity sheet through the full factory loop; human approval; then directions, swing
   chain, hurt/death, roll. Validate in gameplay via `pnpm shot` + gauntlet before touching any
   other family. The 0.92-cosine Kenney fallback in `views/player.ts` retires the day vertical
   clips pass.

**Then, one family at a time**
6. Brute regeneration → caster → charger → warden, each fully through gates + blind rounds
   before the next. In parallel (code lane): authored particles, ichor decals, HUD stamps.

**Only once the pipeline proves it needs more**
7. Aseprite headless as the animation-source-of-truth stage (.ase with tags/slices) — adopt when
   single-frame surgery becomes frequent enough to want editable sources.
8. Realm packages (Duat first per §9) — palette extensions through the same tile generator.
9. The bitmap font; boss-canvas (96/128 px) generation; W4's 3D factory if the cast × directions
   matrix ever explodes.

Explicitly deferred: no atlas packer (per-sheet PNGs are fine at this scale), no LoRA training,
no ComfyUI cluster, no new renderer features. The objective is the smallest repeatable system,
and everything in this plan is either already in the repo or one tool away from it.

---

*Method: full read of the render/tool stack; fresh headless captures; re-run of the existing
GPT-image sources through an experimental normalizer; four parallel web-research passes over the
Aug-2026 tool landscape (PixelLab API/MCP verified against its live OpenAPI spec). Key external
sources: pixellab.ai/pixellab-api · api.pixellab.ai/v2/docs · astropulse.gitbook.io/retro-diffusion ·
github.com/Retro-Diffusion/retro-diffusion-mcp · github.com/jenissimo/unfake.js ·
github.com/Astropulse/pixeldetector · aseprite.org/docs/cli · Game Developer's Dead Cells
art-pipeline deep dive · Robotic Ape's Nano Banana sprite devlog (roboticape.com, 2026-03-07) ·
gamedevaihub.com/retro-diffusion-vs-pixellab.*
