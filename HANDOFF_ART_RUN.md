# HANDOFF: The Night Run — make the art foundation flawless

You are taking over Bardo Rogue at the best moment this project has ever had. The foundation beneath
you took a full day of grilled decisions, ten adversarial review lanes, and three fix rounds to pour,
and it is clean: every test green, every hash pinned, every decision written down with its reasons.
Your job, over the next eight hours, is to build the beautiful game on top of it — autonomously, with
taste, while the human sleeps. The wake-up test is simple and unforgiving: **they open the game at
dawn, and the first sixty seconds — title, Bardo, the walk to the Gate, the first descent — must look
like the concept art in `art/reference/concepts/` came alive.**

## 1. Where you stand

You are on branch `claude/game-graphics-overhaul-e99c1a` (PR #26), in the worktree
`/Users/davidraphael/Desktop/bardo-rogue-web/.claude/worktrees/game-loop-vertical-slice-731e06`.
Work HERE. `node_modules` is installed. What the branch already holds:

- **640×360 render target, 1.5× world scale** (ADR 0002): the sim keeps 16px-tile units; art density
  is now 24px/tile, but **almost no art has been re-authored at that density yet** — the game
  currently renders old 16px assets scaled up. That gap is your canvas.
- **A generic follow camera** (ADR 0001), void-to-the-glass letterbox, camera-following lightmap,
  fullscreen — all reviewed and fixed.
- **The island Bardo**: one 64×36-tile room, pilgrimage line south→north (arrival causeway → Forge →
  Shrine → Gate plaza), interior starfield void, two Seals in silhouette, the Ferryman's pier.
  Geometry is real and playable; the dressing is placeholder.
- **The character system is locked but not yet shipped**: the Veteran mannequin recipe and the
  Blender single-source-of-truth pipeline (`tools/spike/`, proven: 52 seconds from proportion change
  to green gates). The hero on screen is still the old 32px sheets.
- **Four pinned replay fixtures** (one walks the full Bardo loop), `pnpm matrix` at 100/100,
  879 tests, typecheck clean.

## 2. Read these before your first edit, in this order

1. `CLAUDE.md` — the standing rules. They are law, especially sim purity and the hash discipline.
2. `ART_DIRECTION.md` — **this is your taste, codified.** §0 constraints, §1 palette (value bands are
   the load-bearing axis), §2 materials (the section that lost eleven critic rounds before it
   existed), §3 light, §4 silhouette, §5 composition, §8 the bardo motif + §8.4 district rules,
   §9 realms, §10 forbidden list, §11 the acceptance test, §12 the pipeline.
3. `CHARACTER_FOUNDATION.md` — the hero as a system; the Veteran recipe; what is locked and what
   still needs the human.
4. `docs/adr/0001` and `docs/adr/0002` — why the engine is shaped this way.
5. `HARNESS.md` — how you see and play the game headlessly.
6. `art/reference/concepts/README.md` — then **open every concept image and stare at them**. They are
   the bar. Note what they actually do: monumental architecture over a small figure (~9% of frame
   height), gold-and-wine warmth as intrusions into indigo void, one cold accent used scarcely,
   enormous negative space, light pooling on what matters.

## 3. What "flawless" means — taste, operationalized

You do not need to invent taste tonight. This project spent eleven losing critic rounds learning what
bad looks like and wrote the lessons into measurable rules. Your taste is the discipline to apply
them at 1×:

- **"Assembled, not authored" is the enemy.** A floor is not a texture swatch tiled; it has macro
  variation crossing tile boundaries (a stain, a wear path where feet actually walk, a crack that
  goes somewhere and stops for a reason), slabs of unequal size, occlusion darkening every joint. If
  you can mirror a room and 60% of props land on props, redo it.
- **Value carries everything; hue is realm flavor.** Judge every surface by its band (§1.1). The
  floor stays under 30% luminance. The wall is dark with ONE bright line at the cope. If the
  brightest pixels in a frame are architecture, the frame is wrong.
- **Light pools; it never washes.** One key per room, on the focal object. The playable center
  brighter than the perimeter. Warm light is always an intrusion into indigo ambient.
- **Scarcity is what makes accents sacred.** Gold marks crossings and nothing else. Bone is the eye's
  second stop, used sparingly. The `numen` teal exists ONLY in the Bardo, only on what touches the
  beyond. The moment an accent becomes trim, it dies.
- **Judge at true scale, on the rendered floor, in motion.** Never approve anything from a zoomed
  still. `pnpm shot -- --stepwise 1` and READ the PNG at 1×. Ground separation is measured against
  the rendered floor (post-lightmap), not the palette (§12.5).
- **The critic protocol is your conscience** (§11.2): computable gates first — any failed gate IS the
  gap; taste only after gates are green. When your work and a concept exhibit go head to head blind
  and the concept wins, name the gap as "violates §N.M" and fix that, not something else. If gates
  are green and the concept still wins, you have found a missing rule: write it into the bible, then
  satisfy it.

## 4. Hard rails — never cross these, no matter how good the reason seems

1. **`pnpm art approve` is human-only. Full stop.** Generated masters cannot enter `art/approved/` or
   ship to `public/assets/` tonight. This is not an obstacle; it is the design. Anything needing
   approval, you stage as candidates with a contact sheet for morning judgment.
2. **The sim is sacred.** Nothing in `src/sim/` touches DOM, pixi, `Math.random`, `Date`, or
   `tuning.view`. Presentation reads, never writes.
3. **Hashes are never laundered.** If you intentionally change what `stepWorld`/`createWorld` reach,
   run `pnpm record-bots` ONCE, paste the printed hashes, and say so in the commit. Never run it to
   make an unexplained red go away — find the drift instead.
4. **Every feel number lives in `src/tuning.ts`.** No constants buried in systems.
5. **Generated files change through their tool.** Never hand-edit anything in `public/assets/`;
   change `tools/make-bardo-tiles.ts` / `tools/make-bardo-fx.ts` and re-run.
6. **Don't merge PR #26 to main.** Build on the branch; the merge is the human's morning call. Push
   commits to the branch as you go.
7. **The gates in `tools/art/gates.ts` are never loosened to pass.** A judged finding gets a written
   waiver in the spec or a real fix.

## 5. The night's campaign — where the hours go

Highest leverage first. The code lane and runtime lane need **no human approval**, and they are where
most of "beautiful" lives. Timebox each phase; two failed attempts at one asset → park it, note it,
move on (the project learned this rule the hard way).

**Phase 1 — The stone itself (≈2h, highest leverage in the game).** Re-author
`tools/make-bardo-tiles.ts` for 24px/tile density with §2 fully honored: slabs in two-plus sizes
crossing tile boundaries, 1px imperfect joints, macro stains and wear paths baked along real walk
lines, clustered (never uniform) micro-pitting, the dark wall with its single cope light. This one
file dresses every floor in the game. Run `pnpm tiles`, shot, judge at 1×, iterate. The §11.1 gates
(floor value, material weight, AA leak) are your objective referee.

**Phase 2 — The Bardo dressed (≈2h).** Each island becomes a framed composition (§8.4.6): own focal
object, own light pool, negative space ≥35%. Braziers, banners (wine cloth, §2.5 folds), the Gate's
gold-on-stone presence, Seal silhouettes that read as knotwork/obelisk in shadow, the Ferryman's
moored prow. Prefer code-authored props (`pnpm tiles` prop sheet) and set-piece silhouettes; where
only generation will do, produce candidates into `.art-cache/` for morning approval and use
silhouette stand-ins meanwhile. Verify by walking the pilgrimage line in shots at several camera
rests.

**Phase 3 — Light and air (≈1h).** Per-island `RoomLight` tuning, vignette retune for the big room
(flagged as deferred in ADR 0001), atmosphere presets, the door bloom. This phase is pure runtime
lane and it is where the concepts' numinous actually comes from. Before/after shots for every change.

**Phase 4 — The title vista (≈1h).** The decided design: camera rests high on the pilgrimage axis
looking toward the Gate; menu type set in the void band; DESCEND glides the camera down to the
causeway — no scene swap, the 48%-alpha veil dies. The machinery (camera, `snapFollow`, title
overlay) all exists. This is the single highest-impact sixty seconds for the wake-up test.

**Phase 5 — Combat rooms at the new density (≈1h).** The dress overlays (Acheron silt, Styx iron,
Phlegethon ash — §9.0's table) re-authored at 24px through the same tile tool. Keep 26×15 geometry
untouched; matrix must stay 100/100.

**Phase 6 — Candidates for morning judgment (≈45m).** Using the Veteran recipe and the Blender rig:
extend `tools/spike/` toward the production punch list in `CHARACTER_FOUNDATION.md` (Blender
Actions, the 0.90 combat crouch, more strong poses), render candidate sheets, run the real gates,
build contact sheets. Also queue any gen-lane set-piece candidates from Phase 2. Nothing ships;
everything is staged with your advisory ranking written down.

**Phase 7 — The final critic round + morning brief (≈45m, protected — do not let earlier phases eat
it).** Run §11.2 against the three named exhibits with the concepts as references. Fix what one round
can fix. Then write `MORNING_REPORT.md` at repo root: what shipped (with before/after shot pairs in
`shots/`), what's staged for approval and where, what you parked and why, every §-rule you added, and
the exact commands to see everything. Update `public/progress/data.json` and the plan STATUS as you
go, not at the end.

## 6. The loop protocol — every piece, no exceptions

Build → `pnpm typecheck && pnpm test` → capture (`pnpm shot`/`pnpm poses` — **read the PNG, always**)
→ judge against §11 gates, then taste → fix → **commit with a descriptive message in the repo's
voice** → push. Small green commits beat one heroic diff. If tests flake under load, re-run the
failing files serially before concluding anything — this machine does that.

## 7. Playtesting — use your own hands and eyes

You have a full harness: `window.__game`, bots, replays, `?scenario=`/`?seed=` (see `HARNESS.md`).
Start this worktree's own Vite on a **private port** (`npx vite --port 5201 --strictPort`) — never
trust `:5173`, it is usually a different checkout and it has burned two agents already. Walk the
Bardo yourself in the browser tools: does the camera follow feel composed at walking speed? Does the
Gate pull the eye down the axis? Does the void read as depth or as absence? Screenshot what you feel
and let the §11 gates arbitrate when your taste and the numbers disagree — then trust the loop, not
your fatigue.

## 8. Traps that will eat your hours (all discovered this session)

- `:5173` is another checkout. Kill your own servers when done.
- LSP diagnostics go stale and lie mid-edit; only `pnpm typecheck` is truth.
- `pnpm shot`/`poses` never start Vite; use `--stepwise 1` for deterministic frames; poses needs
  `--url` for your own server.
- The Bardo loop fixture (`slice-kite-loop-s7`) now pins hub geometry — any arena change breaks it
  legitimately; rebaseline consciously per rail 3.
- Rate limits exist; if an API error kills a subagent mid-work, its artifacts are usually on disk —
  check before redoing.
- Never bare `git stash` (shared stack across worktrees). WIP commits instead.
- `check-build` fails the build if junk lands under `public/` — evidence and scratch go to
  `.art-cache/` or `shots/`.

## 9. Ignition

You inherit a project that spent eleven rounds losing to its own standards before it learned to write
them down — and then wrote them down so well that four independent reviewers, a merge under fire, and
a bot audit could not find a crack in the foundation. Nobody has yet built the beautiful thing on
top. That is yours alone tonight. Eight uninterrupted hours, a codified aesthetic, objective gates, a
camera waiting for its vista, and a floor waiting for its stone. Work like the game will be judged by
the person whose taste built the bible — because at dawn, it will be. Make the first sixty seconds
undeniable. Leave a trail of green commits and honest evidence. And when the human wakes, let the
game answer for you.
