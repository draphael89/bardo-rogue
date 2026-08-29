# Bardo Rogue — Art Production Brief

A paste-ready mandate for an agent producing shipped art through this repository's pipeline. Hand an
agent one PHASE of this brief, not the whole file: each phase is one bounded PR with its own
acceptance bar. Phases are ordered by dependency, not preference — skipping ahead produces assets the
later phases would have to regenerate.

Read before any work, in this order:

1. `ART_DIRECTION.md` — the art bible. Every prompt is DERIVED from it (`buildPrompt` in
   `tools/art/generate.ts` derives its clauses from §1/§2/§4/§10); if the look must change, change
   the bible first (§11.2.4: write the rule, then cite it), never a freehand prompt.
2. `docs/ART_PIPELINE_AUDIT.md` — why this pipeline exists and what it measured.
3. `CLAUDE.md` + `HARNESS.md` — the repo rules and the capture tools you will judge with.

## Iron laws (all phases)

- **The game owns the contract.** Providers return candidates into `.art-cache/`; nothing enters
  `public/assets/` except through `pnpm art compile` passing its gates. Never hand-edit a compiled
  asset, a hash, or a sidecar.
- **A human owns approval and spend.** Approval into `art/approved/` records a human decision —
  never make it on your own judgment. Never make a paid provider call without the user's explicit
  go-ahead for that batch's size; run one single-image canary before any batch.
  Dry-run is the default and `--live` is the only thing that spends; a key in the environment does
  not arm the CLI by itself.
- **Judge in motion.** A sheet is not done at a pretty PNG: capture `pnpm poses`, `pnpm strip` for
  every combat clip, `pnpm shot` in a real scenario, and READ the images. Static approval of
  animated art is how foot-sliding and scale-pop ship.
- **Zero unexplained findings.** Gates that fail block, and judged findings block unless a
  checked-in waiver names the exact gate id and the reason. If you disagree with a gate, fix the
  gate with a test — do not loosen it in passing.
- **Provenance for every pixel.** Prompts live in `art/prompts/` and are hashed by the compiler;
  masters live in `art/approved/`; generation manifests record request, references, candidates,
  and cost.
- **Sim is untouchable.** No change under `src/sim/` or `src/tuning.ts` for art reasons, ever. If a
  replay hash moves, the change is wrong.

Command crib:

    pnpm art generate art/specs/<gen-spec>.json [--provider pixellab|retrodiffusion] [--live]
    pnpm art compile art/specs/<spec>.json        # stages, gates, promotes only on PASS
    pnpm art gate public/assets/sprites/<x>.png   # re-check a shipped sheet standalone
    pnpm art approve art/approved/<x>.png --id <identity.vN> --by <human>   # HUMAN decision only
    pnpm art preview <sheet.png>                  # 1x + magnified on the room's floor value
    pnpm poses | pnpm shot | pnpm strip | pnpm sim    # judge in the actual game

---

## Phase 0 — Reconcile the two remediation lanes — DONE

Two lanes remediated the pipeline in parallel after the PR #7 review and only one merged. They have
been reconciled into one pipeline on `main`, taking the stronger mechanism per concern and carrying
each lane's fixes for the other's regressions. What that means for every phase below:

- **Spending is opt-in.** `pnpm art generate` is dry-run by default; only `--live` sends a paid
  request, an unknown `--provider` is rejected rather than cast, and a failed POST is never retried.
  Candidates are written to disk as they arrive, so a mid-batch failure keeps what you paid for and
  says so.
- **Approval is enforced, not documented.** Every master in `art/approved/` carries a hash-verified
  receipt; compiling into `public/assets/` verifies it and stops when the master is missing,
  unreceipted, or edited since approval. `pnpm art approve` records a human decision — never run it
  on your own initiative.
- **Gates block.** Two tiers: objective failures never pass, and judged findings block promotion
  unless the spec carries a waiver naming the exact gate id and a written reason. A stale waiver, a
  waiver over a passing gate, or one on an objective gate fails the run itself.
- **Provenance is derived.** Specs name a prompt file and an approved anchor; the compiler hashes
  both and rejects hand-typed values.
- **The suite proves the assets.** `tests/art/reproducibility.test.ts` recompiles every spec into a
  temp directory and hashes it against what is committed, so a hand-edited asset or a stale sidecar
  fails `pnpm test`. CI itself is still **parked** at `ci/github-actions.yml`: the pushing identity
  has no `workflows` scope and GitHub rejects the push outright (attempted and refused during the
  reconciliation). Every gate in it was verified locally. Activating it is one human commit —
  `git mv ci/github-actions.yml .github/workflows/ci.yml` plus the two-file flip its header
  describes — so until then, run the gates by hand before merging.
- **Registration is explicit.** Three fit modes — `grid` (+ `register`/`nudge`), `pose` (one shared
  source square, judged pivots), `shared` (structural registration) — and the Brute ships at a 64 px
  cell where his committed wind-up reads taller than his idle.

Anything the reconciliation deliberately left open is follow-on work, not a blocker: `puff()` still
scale-tweens where `dust()` no longer does (§6.5), god-rays are not yet alpha-quantized (§6.6),
sparks still scale (§6.3), and §6.8's chromatic-aberration violation is untouched.

## Phase 1 — Title screen (first generated deliverable)

Why first: one asset, one approval, no engine coupling, and the largest perceived-quality jump per
asset. It also rehearses the direction→gate→approve loop on a big canvas before anything
mass-scale.

- Inventory first: no dedicated title state exists today (the "title" in `hud.ts` is the wave
  card). Building a render-only title scene — art, logotype, ambience, input-to-start — is in
  scope for this phase; it must not touch the sim.
- Composition comes from the bible, not from taste-of-the-day: the floating room in the void (§8.1
  — "every space floats", the strongest identity asset the project owns), star-sky panes, the hero
  as a small readable silhouette with ember/gold against wine/slate dark — NOT a close-up character
  portrait (faces are where generated art collapses into generic AI slop fastest). The depicted
  scene is threshold imagery: it carries §8.2's five mandatory elements (a star-sky opening, gold
  marking a crossing, the floor bearing a name, something unfinished, two living things and one
  dead one), and §8.3's forbidden framings — clocks, hourglasses, literal scales, mist-as-answer,
  ghost-sheet apparitions, limbo grey — go into the generation prompt as negative constraints,
  because they are exactly what a generator defaults to for "afterlife roguelike title".
- The logotype is AUTHORED pixel type per §7.2 (the game's one bitmap font discipline), never
  generated — the generator prompt already excludes text/labels/watermarks (`BIBLE_RULES`,
  `tools/art/generate.ts`), and generated type garbles.
- Canonize the asset class first: a full-canvas plate is neither a character nor a tile. Add a
  `plate` row to §1.3.1's budget ladder and to `art/palette/canon.json`'s `budgets` (pick the
  number deliberately — boss-tier 24 is a defensible start) per §11.2.4, so the palette gate and
  `buildPrompt` enforce it. Gate a plate on what makes sense — palette subset, no partial alpha,
  §3 value structure — and do NOT force character gates (silhouette mass, ground separation) onto
  scenery. No new frameworks: a `kind: "plate"` with a sensible gate subset is the whole ask.
- Route A (no API key — the precedent that produced every current master): the agent AUTHORS the
  prompt files in `art/prompts/` (derived from the bible, negative constraints included) and the
  compile spec, then STOPS and hands the prompts to the user to run through GPT Image out-of-band.
  The user deposits 6–8 returned candidates into `art/source/`; the agent alpha-mattes, compiles,
  gates, and lays out a candidate sheet for the pick.
- Route B (key present): Retro Diffusion at large canvas. A dry-run cannot reveal size ceilings —
  check the provider's published docs for the maximum canvas, then confirm with ONE user-authorized
  single-image probe at target size before promising 480×270 in one call. Tiled generation is
  acceptable; visible seams are not.
- Ambience: any motion on the title obeys §6.1 (integer positions, 8/16-step rotation) and §6.6
  (4-level alpha) — this is the first thing a player sees. Verify by capturing several
  `pnpm shot --stepwise 1` frames a few ticks apart and checking positions land on integer
  480×270 pixels and alphas/rotations step through quantized levels rather than drifting.
- STOP for the user three times: prompt handoff (Route A), master pick from the candidate sheet,
  and sign-off on the in-game capture.

Acceptance: title master approved into `art/approved/`; shipped title renders in-game
palette-clean; stepwise captures show quantized ambience; user sign-off recorded in the PR.

## Phase 2 — Hero re-master + weapon (raising the quality ceiling)

Why now, and not before: the directional sheets exist, but every hero pixel on main descends from
~1254px GPT illustrations crushed ~39:1 — the audit's measured ceiling (hi-res-to-32px "tops out at
'acceptable'", `docs/ART_PIPELINE_AUDIT.md`). The raise comes from generating AT native 32px with a
pixel-native provider, conditioned on the approved identity so it stays the same character.
Requires a provider key and an authorized budget; without both, stop at the dry-run and report.

1. Identity re-roll: `art/specs/gen-hero-identity.json` — 8 candidates via
   `--provider retrodiffusion` (conditioned on the approved pool) AND `--provider pixellab`. For
   the pixellab run, first pin the spec's `references` to the single approved hero master —
   bitforge takes exactly one style image and the adapter rejects a pool. Gate all candidates,
   `pnpm art preview` the survivors on the room's floor value, STOP: the user approves exactly one
   (receipted).
2. Directions: extend `tools/art/generate.ts` with the character endpoints —
   `/create-character-v3`, `/generate-8-rotations-v3`, and `/background-jobs/{job_id}` polling —
   exactly the way the image endpoints were done: requests as reviewable data, pinned by contract
   tests against the published OpenAPI (`tests/art/generate.test.ts` is the pattern; the first
   adapter shipped 404-ing endpoints BECAUSE it had no such tests). Mirror east↔west only; never
   mirror north/south.
3. Animation: `/animate-with-skeleton` (or `/animate-with-text-v3`) for run and idle cycles; the
   attack chain STAYS pose-based against tuning windows — combat timing never enters art metadata.
   Compile through the existing specs; the contact-boundary tests must stay green untouched.
4. Weapon: the sheet format and compiler already support per-frame sockets — the Brute's `maulHead`
   (`art/specs/brute.json`) is the precedent — but hero frames carry NONE today. First author
   judged hand-socket entries on every swing frame in the hero specs and recompile; only then
   generate socket-attached weapon sprites (greatsword variants, then the bow) conditioned on the
   same pool. Acceptance is a weapon swap that tracks the hand socket through a full swing strip
   without desync.
5. Telemetry per batch (the manifests record it): candidates generated, gate rejection rate, cost,
   human touches. Report cost-per-accepted-asset — this number decides whether Phase 3 mass
   production is affordable.

Acceptance: new masters approved by the user; every regenerated sheet passes gates with zero
unexplained findings; swing/dodge/brute strips re-captured and READ; `pnpm sim` balance unchanged;
replay hashes untouched.

## Phase 3 — Opening town (mass production, last on purpose)

Town is 10× the asset count of everything above. It waits until the style pool is locked (Phase 2)
because every batch is conditioned on the approved masters — mass-producing before the pool settles
bakes drift into thirty assets instead of three.

1. Design before pixels: the town is a game-design object. Write the blockout first — purpose,
   room graph, walk paths, beats (the repo's level-design skill covers this) — and get the user's
   yes on the blockout BEFORE generating anything.
2. Surfaces: extend the code tile lane (`pnpm tiles`) for floors/walls, which must carry §2.1
   Law 1's three-scale variation and obey §2.3's wall-is-dark rule. §12.1 assigns tiles exclusively
   to the Code lane, so before using `rd_tile__tileset` for organic surfaces the code lane cannot
   express, AMEND §12.1 to record that exception (per §11.2.4), then cite it.
3. Props: generated candidates against the existing prop gates, ONE FAMILY PER PR (all market
   stalls, or all shrine props) so each batch conditions on the pool and the review stays
   judgeable.
4. NPCs: the proven Phase-2 character loop, one identity at a time.

Acceptance per PR: family compiles clean, sits on the room's floor value in `pnpm art preview`, and
is judged in a real `pnpm shot` of the town scene, not in isolation.

## Reporting (every phase)

Close each PR with the standard accounting: what changed, why, what was tested, what materially
improved, what was deliberately not added, the remaining gap, and a 0–100 self-assessment with no
grade inflation. If a phase assumption proves wrong mid-flight (a provider limit, a gate that
fights the art), stop and report with evidence instead of improvising around it.

## Do not

- Approve art, or write anything into `art/approved/`, without an explicit human decision to
  record.
- Spend provider credits without the user's go-ahead for that batch; never retry a paid POST.
- Add ComfyUI, LoRA training, 3D prerendering, Aseprite automation, a database, or an orchestration
  framework — the audit scored these lanes and the answer was no.
- Generate logotypes, UI text, or anything typographic.
- Touch `src/sim/`, `src/tuning.ts`, or a pinned replay hash.
- Widen a phase: one phase, one PR, one accounting.
