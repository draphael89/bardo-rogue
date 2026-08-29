# Art Pipeline Synthesis

Date: 2026-08-28. This document reconciles two independent audits of the same question — "what
is Bardo Rogue's AI-first art pipeline?" — and converges on one best-of-breed plan.

- **Plan A** — `docs/ART_PIPELINE_AUDIT.md` (this repo's audit, at HEAD `4d44311`): recommended
  the *Pixel-Native Factory* — Retro Diffusion identity sheets + PixelLab production behind an
  asset contract, code-native environment/VFX.
- **Plan B** — the external audit (read-only, at HEAD `1ef5b18`): recommended *GPT Image art
  direction + PixelLab production* over a deterministic local compiler, semantic atlases, and
  tick-aligned review.

## 1. Grading the two plans

Same rubric for both, ten criteria × 10 points. Grades are for the *plans as written*, not the
workflows they recommend.

| Criterion | A (this repo) | B (external) | Notes |
|---|---:|---:|---|
| Evidence base & accuracy | 9.5 | 6.5 | A: current HEAD, ran prototypes, verified vendor APIs live. B: audited 3 PRs behind — never saw the authored hero/brute sheets, `process-sprite-sheet.mjs`, the failed-in-practice GPT-sheet evidence, or the PixelLab budget; but its reading of *its* tree is careful, and it caught the 480→768 adaptive width A missed. |
| Keep/replace judgment | 9 | 7 | Both keep the right core. B wrongly demotes the code-tile lane to "transitional" — the only pipeline that has ever beaten the critic here. A is too absolute about baking weapons into frames (see §3.2). |
| Asset-contract completeness | 6.5 | 9.5 | B's contract is best-in-class: clips, per-frame ticks, markers, weapon sockets, **provenance** (model/seed/prompt-hash/lineage), candidate lifecycle. A had frames+pivots+anchors and no provenance. |
| Runtime/animation integration | 8 | 8.5 | Both keep the presenter tick-driven. A's centerpiece insight (semantic poses, not flipbooks) is sharper; B's clip design is more complete but duplicates tuning windows in asset markers (a desync risk A's model avoids). |
| Generation-lane design | 8.5 | 8 | A: pixel-native generation + palette forced *at generation time* — the single best anti-slop lever; underuses a hi-res concept lane. B: GPT-director lane is right; omits Retro Diffusion entirely and grades GPT-only production 79 against this repo's own contrary evidence. |
| Consistency mechanism | 8 | 9 | B: families-with-lineage, master references, and a correctly *staged* Scenario style-LoRA escalation. A: approved-pool compounding + palette lock, no LoRA stage. |
| Quality gates | 7.5 | 9.5 | B's animation and in-game gate batteries (centroid jumps, planted-foot stability, socket continuity, judged under hit-stop/bullet time) are the best part of either plan. A adds palette⊆canon, Weber ≥ +1.0, light direction — and the meta-lesson that current gates passed sheets a human rejects. |
| Agent operability | 8.5 | 9 | B adds the candidate→validated→approved→compiled lifecycle, "APIs for production, MCP for exploration", and the two-failure method-switch rule. A wires MCP + the existing harness. |
| Migration & pilot design | 8 | 8.5 | A: normalizer-first (prototype-proven), family-at-a-time. B: a better-shaped pilot — hero **with** its weapon family and FX in one batch, four directions not eight. |
| Parsimony & risk | 9 | 8 | Both defer ComfyUI/3D/LoRA correctly. B's full contract (sockets, markers, YAML) is partly speculative before a pilot. |
| **Total** | **83** | **84** | Effectively a tie, with orthogonal failure modes: A knows the ground truth better; B engineers the system better. |

The correct conclusion is not to pick one. A's evidence should discipline B's lane choices;
B's contract and gates should replace A's thinner versions.

## 2. Where they agree (settled — no further debate)

Both plans independently conclude: keep the sim/render split, tick-driven frame selection,
16 px grid, 480×270(→768)×integer upscale, deterministic capture tooling; the game owns the
asset contract and providers conform to it; PixelLab is the production engine for directional
characters and animation; frontier models must not render shipping sprites directly; timing
belongs to the simulation; human taste concentrates into approval gates (seed + final family);
migrate one complete family at a time starting with the hero; slop prevention is procedural,
not rhetorical. Two audits with different priors landing here makes this the load-bearing
consensus.

## 3. Where they disagree, and the ruling

**3.1 Identity substrate — hi-res GPT master (B) vs on-grid RD master (A).**
Ruling: *both, in series*. A frontier concept board explores the search space (B is right that
this is where the visual ceiling lives), but the **approved master is the pixel-native one**:
Retro Diffusion, palette-forced via `input_palette`, reference-conditioned on the chosen
concept. Approval must happen on the artifact that ships — this repo has already run the
experiment where a beautiful hi-res master died in conversion (`docs/audit-evidence-downsample.png`).
B's own citations concede GPT's minimum-canvas and drift problems; A's evidence shows the
conversion step is where identity goes to die. Concept lane is *optional per family*, mandatory
for realm-defining pieces.

**3.2 Weapons — baked into pose frames (A) vs separate sprite + per-frame sockets (B).**
Ruling: *bake the drawing, record the sockets anyway*. At 32 px, a separately-rotated weapon
sprite is the Kenney look the game is escaping, and the shipped hero sheet already proves
baked poses read better. But B is right that sockets are nearly free to capture (PixelLab's
skeleton output includes hand keypoints) and buy back what baking loses: the bow renderer,
weapon tints (`cleave`), pickups, and future weapon variety via PixelLab outfit/state variants
of the saved character rather than runtime compositing. Sockets go in the sidecar from day one;
whether a frame bakes or attaches is per-clip metadata.

**3.3 Environment tiles — permanent code lane (A) vs transitional, migrate to generated (B).**
Ruling: *A, with B's concession*. The code-tile generator is the only pipeline in this repo
that has ever won against the reference games, and it enforces ART_DIRECTION §2 in reviewable
TypeScript. It stays canonical for tiles, materials, autotiles, and floor graphics. B's valid
point survives as scope: large *set pieces* (the Scale, the Frozen Ship — 3×3-tile-plus focal
masses) may exceed sane code authoring and enter through the sprite pipeline as props under the
same contract.

**3.4 Combat FX — procedural (A) vs generated strips for signature impacts (B).**
Ruling: *A for anything gameplay-coupled*. Telegraphs and impacts in this repo are functions
of sim geometry — the brute's mark draws the actual `arcHits()` danger set and lands its
brightest frame on the damage tick. A generated strip cannot track hit geometry or tuning
changes. Generated FX strips are allowed only for non-gameplay flourishes (portals, ambient
motes, death blooms), gated like any sprite.

**3.5 GPT-only production viability — 52 (A) vs 79 (B).**
Ruling: A's number stands for *shipping pixels*; B graded the lane with mitigations this repo
already implemented and measured as insufficient (chroma-key, despill, grid slicing — the
shipped sheets still failed). B's mitigations (rigid grid templates, first-frame locking,
content-aware splitting) improve it but do not fix off-grid structure, and the generator
lineage is being deprecated. Its 90+ concept ceiling is exactly why it keeps the director seat
and loses the production seat.

**3.6 Directions — 8 (A, via ASSET-KIT) vs 4 (B).**
Ruling: *B, tightened further*: author **E + S + N** and mirror E→W for the pilot. The current
renderer distinguishes only horizontal/vertical, facing follows aim, and the weapon covers
intermediate angles. Diagonals are a later decision that gameplay must earn.

**3.7 Contract depth — thin sidecar now (A) vs full clip/marker/socket schema (B).**
Ruling: *B's schema, minus the redundancy*. Combat clips must **not** carry their own
tick-per-frame authority — frame choice for attack/dodge derives from tuning windows, which is
the repo's existing guarantee that art cannot desync from hitboxes. Markers like
`contact_start` are therefore *derived assertions* (validated against `tuning.ts`, failing the
gate on mismatch), not runtime data. Non-combat clips (idle, death, ambient) do own tick
arrays — that timing currently hides in per-view formulas and should move to data. Provenance
block adopted verbatim.

## 4. The synthesized pipeline

```text
Executable art bible
  (ART_DIRECTION.md + §12 generation spec + art/palette/canon.png + art/approved/ pool)
    │
    ├── CONCEPT (optional per family; mandatory for realm-definers)
    │     frontier model → boards, turnarounds, material studies. Never ships pixels.
    │
    ├── IDENTITY (the one human gate per family)
    │     Retro Diffusion, palette-forced, conditioned on concept + approved pool
    │     → 8–16 on-grid candidates → structural gates → HUMAN APPROVES the pixel master
    │
    ├── PRODUCTION (families, never lone files)
    │     PixelLab character-v3 from approved master → E/S/N directions (mirror W)
    │     → whole clips at once (templates / animate-with-text / skeleton), 4 candidates each
    │     → weapon states via outfit/state variants; skeleton hand keypoints → sockets
    │
    ├── COMPILE (deterministic, sharp-based)
    │     grid-safe majority-vote sampling (non-native sources only) → canon-palette mapping
    │     → shared union crop + fixed foot anchor per clip → binary alpha
    │     → sidecar: frames, pivots, sockets, clips, provenance
    │
    ├── GATE (union of both plans; hard fail)
    │     structural · pixel (palette⊆canon, Weber ≥ +1.0, silhouette, light direction)
    │     · animation (centroid jumps, planted feet, socket continuity, loop closure,
    │       contact frame validated against tuning windows)
    │     · in-game (reads at 1× in the room, under hit-stop, camera kick, bullet time)
    │
    ├── REVIEW   pnpm poses / shot / strip in pinned scenarios → gauntlet blind rounds
    │
    └── PROMOTE  .art-cache/ → art/approved/ → compiled public/assets/ → one family per commit
```

Lifecycle directories (from B): `art/specs/`, `art/references/`, `art/approved/`,
`.art-cache/` (disposable, gitignored), `public/assets/` compiled-only. Candidates never touch
`public/assets`.

Runtime additions (small): a generic `sheet(name)` accessor in `atlas.ts` reading the sidecar;
a clip-selector helper replacing per-view hardcoded frame maps and pivot tables; combat clips
resolved from tuning windows, non-combat clips from sidecar ticks. The presenter stays a pure
reader; captures stay deterministic.

Permanent code lanes: tiles/materials/autotiles (`make-bardo-tiles.ts`), gameplay-coupled FX
and telegraphs, HUD chrome. The agent loop and two-failure method-switch rule from B govern
every generated family; the gauntlet governs judgment.

## 5. Migration (supersedes §10 of Plan A where they differ)

**Immediately**
1. Normalizer v2: grid detection + majority-vote sampling + canon-palette mapping (prototype-proven).
2. Contract + loader: B's sidecar schema (with §3.7's corrections), generic accessor, migrate
   hero/brute pivots out of TypeScript. Legacy atlas stays as fallback.
3. `art/` lifecycle directories, `canon.png`, bible §12, gates v2 (union list).
4. Generation clients: PixelLab (budgeted) + Retro Diffusion, as `tools/generate-sprite.ts`;
   MCP for exploration, direct API for production jobs.

**Pilot — one bounded proof family (B's shape, A's order)**
5. Hero: RD identity master (black test, Weber ≥ +1.0, saturation 0.60–0.70; nothing else
   generates until it passes) → E/S/N + mirror → idle/run/hurt/death → the swing chain and
   dodge translated to 32×32 clips → greatsword states + sockets. Measure rejection rate,
   cost, agent interventions, and human touches per approved asset.

**Then, family by family**
6. Brute regeneration → caster → charger → warden; code lane in parallel: authored particles,
   ichor decals, HUD stamps. Kenney survives only in a named legacy/greybox namespace.

**Only when evidence requires**
7. Scenario style-LoRA once ~20–30 approved Bardo assets exist (B's staging — the current
   sheets must never become the training set). 3D prerender lane for a humanoid boss 2D
   generation cannot hold. ComfyUI only if provider drift, privacy, or unit cost becomes
   measured. Aseprite as editable-source stage when single-frame surgery becomes frequent.

## 6. Why the synthesis beats both parents

On the §1 rubric it inherits A's 9.5 evidence discipline and lane choices, B's 9.5 contract
and gates, B's lifecycle and pilot shape, A's parsimony rulings on tiles and FX — and resolves
every disagreement with a reason traceable to repository evidence rather than preference.
Self-graded honestly: ~92/100, with the remaining risk exactly where both parents put it —
whether 32 px generated animation holds identity through a full combat sentence. That is what
the pilot exists to measure, cheaply, before anything else is built.
