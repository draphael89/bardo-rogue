# Bardo Vertical Slice Plan

**Date:** 2026-08-29 (revision 3)
**Audited revision:** `6852aa0` (`cursor/43111337`) — *Greek gate: rites, deities, Minos, and the Oath-Bound elite*
**Interactive scorecard:** open `bardo-vertical-slice-plan.canvas.tsx` beside the chat.

**Revision 3 — overnight audit.** Re-verified against this worktree, not against earlier write-ups. `pnpm typecheck` green. `pnpm test` **655 / 52 files**. Fresh `slice-kite` seeds 1–8 after the loop-lead fix: **7 wins**, 48.4–54.4 s, seed 6 lost at 56 s; every run home in the Bardo. `slice-naive` seeds 1–8: 0 wins, death at 16.1–34.2 s, two to four chambers, all home. Playwright stills: title over the living Bardo (unarmed body and rack readable), unarmed hub, rack pickup (`THE BLADE REMEMBERS`, door open), Kindly One offer, Charon's Landing toll. Gauntlet wave 2 parked nine pieces on authored art; wave 3 is an asset-kit wave, not another critique grind. C.1 / C.2 are a live re-grade of what a player sits in now (overall loop foundation **76**). The scorecard canvas matches.

---

# Bardo Vertical Slice Plan (historical header)

**Date:** 2026-08-28
**Audited revision:** `4d44311` (`main`), branch `claude/bardo-vertical-slice-audit-6c7inj`
**Companion documents:** `VISION.md` (the full-game vision), `COMBAT_FEEL_AUDIT.md` (combat deep audit at `1ef5b18`), `ART_DIRECTION.md` (the art bible), `AUDIT_REPORT.md` / `EXPANDED_GAME_PLAN.md` (historical audits, both now stale — see §A).

**Revision 2 — synthesis.** This plan was cross-reviewed against an independent vertical-slice plan authored against revision `1ef5b18` (three commits behind HEAD). That plan's current-state audit is stale — it describes a build without the loop, boons, boss, or persistence that exist at HEAD — but several of its design calls beat v1 of this document and are adopted here: the independent-heavy and dash-attack combat questions (Phase 1), node-boundary save/resume instead of replay fast-forward, the Remembrances + Smith-reroll meta proof with the bow deferred, leaner enemy counts built around one guard-break elite, Minos and the named Greek spaces, the recombining-phases boss principle, and a cultural-review gate for mythological material.

---

## STATUS — what has since been built

**The hero the renderer can load (2026-08-30, late).** The staged hero candidate was immaculate and
uninstallable: `src/render/views/player.ts` demands clips `run, dodge, light1, light2, heavy`, frames
`idle, hurt, dead`, and separate `bardo_hero_{north,south}_roll` sheets with a four-frame `roll`
clip, while the candidate shipped `light0, light1, heavy`, a frame named `death`, and no roll sheet
at all — so it would have compiled green, passed 507 gates and then thrown at load. Both halves are
closed in the generator, never by editing a compiled asset: a single-pass rename in `mannequin.py`
and `assemble.mjs`, and a new vertical roll (`ROLL_TURN`/`ROLL_TUMBLE`/`ROLL_LIMBS` plus a 2x2 sheet
emitter) that clears 104/104 gates with zero waivers. The roll measured three things worth keeping —
a harder curl makes the sprite taller rather than rounder near the camera's 60-degree foreshortening;
the tumble needs a per-facing sign because the key light belongs to the room and one shared sign put
north at Weber 0.71-0.81 against a 1.00 floor; and the roll is unarmed-only, which is the live
contract rather than a concession. The Oath-Bound's shield leaf became a flat `brickLo` mark instead
of a shaded `brickLo`/`brick` lane, cutting sheet median luminance 0.4122 -> 0.3774 (8.4%) with 78/78
still green — an honest half-fix that leaves the actor brighter than the hero. The warden, caster and
charger were deliberately left alone: each passes every automated gate and each fails the one test
the gates cannot run, and all three need a new silhouette rather than a polish pass. Typecheck exit
0, 930/930, matrix 78/0 with zero stranded seeds, replay hashes unmoved and `record-bots` correctly
not run. **The wiring has since happened, for the hero alone.** `EntityView.tile` is nullable and
`createPlayerView` passes null, so the player's body is authored with no Kenney fallback behind it: a
view that failed to bind draws a hole, which is a bug report, rather than a knight, which is a
regression that ships. The caster, charger, warden, Oath-Bound and dummy are still `tiny_dungeon.png`
indices, as are the weapon sprites — the player's own bow still borrows one.

**Art cycle checkpoints (2026-08-30, `codex/bardo-first-sixty-seconds`).** Room source art now has a
locked 24px tile / 48px prop contract while simulation and layout remain 16px / 32px logical. The
static room composite is baked at native art density and returned to logical world size, so the
640×360 target sees one source pixel per target pixel at the 1.5× world scale. `pnpm room:gate`
blocks wrong dimensions, partial alpha, palette drift, collapsed material spans, Bardo island
negative-space loss, composite-size drift, value-budget drift, and top-one-percent focality. Named
1× before/after frames are in `shots/`. The title then became a local left inscription which leaves
the Bardo Gate visible, with compact Settings/Credits steles and one guarded, reduced-motion-aware
Gate-to-player descent. The Gate gained render-only architectural mass; collision and replay state
remain untouched. Live cancellation proof survives beyond the old completion time, the room gate is
green, and the suite is 911/911. The locked Veteran rig now also carries dagger-specific attack
grammar and silhouette-changing heavy armor: 42 frames each, three facings, computed registration,
1,062 total real gates with zero blocking, and committed 1×/black-test exhibits. The failed first
dagger compile established that shared fit is a long-weapon decision, not an east-facing default.
`docs/CHARACTER_HARD_CONSTRAINTS.md` is drafted from that evidence but explicitly awaits the user's
lock. The arrival causeway now stages a warm Keeper light against cold abandoned braziers, damp pier
stone, and a numen lantern; a code-authored fallen Veteran relic replaces the generic ossuary on the
same already-solid cell. The relic stays within the canonical palette, binary-alpha, and colour-cap
contracts, while ImageGen studies remain reference-only. Acheron's lower lane now resolves the
art bible's promised shore as one silt lip over a two-tile dark-water body without changing any
solid. Cocytus now gives its west-edge weep one cold reflection that expires before the dry fight
circle, and a paler cyan surface distinct from Acheron's indigo. The deterministic measured median
realm separation is 11.31 with no wrong-temperature rooms. Look and Fun
remain human gates. The
Hall of Minos now keeps its unequal scale but gains a broken, goldless verdict stele and a narrow
wax-red sentence behind the boss, without marking the fight circle or changing collision. The
alternate spines now carry sparse code-authored material motifs rather than tint alone: iron oath
links at Styx and the Oath Court, dead-wine heat seams at Phlegethon, all outside the fight circle.
letterbox and target sky now enter the shared frame grade from identical authored colours; exact
390×844 and 900×506 probes keep all four target boundaries continuous. The attended evidence and
exact-head ledger are recorded in `MORNING_REPORT.md`.

**Graphics overhaul, `claude/game-graphics-overhaul-e99c1a`.** The Bardo's light now has a source and
a rank: the Gate is the key at r140/s2.4, every other pool sits a rank under it, and the arrival
landing has its own lamp and its own pool so the player spawns *inside* light rather than beside it.
Three authored 32×48 wedges (`shaft_01..03`) replace two stretched Kenney noise discs that were
running at an effective ~0.007 alpha, and the beam falls through the Gate's own opening onto the
plaza. The brightest pixel of both the title and the arrival frame is no longer a star. **Two changes
from the same pass were taken back after reading them at 1×**: a re-authored Gate bake whose pylons
and arch face came to share one value, so the monument resolved into a flat slab instead of an arch;
and a `bakeBardoGateSpill` whose four baked plateaus read as a cream sticker on the plaza. The
level-2 and level-4 floor ramps were reverted with them — `bardo_room.png` is the sheet all fourteen
layouts pave from, so a brass ramp authored for the Bardo's embers also put an olive-gold chip into
Cocytus, the coldest floor in the game. `pnpm art:stress-hero` now gates three variants including the
**unarmed** body (507/507, zero waivers, two committed exhibits) — the one the whole opening is
played in, and the one whose crest currently reads as horns. Room gate **78/78**; suite **930/930**;
matrix 78/0 with zero stranded seeds; replay hashes unmoved. The human `pnpm art approve` has since
been given: **the hero in the shipping build is the authored Veteran**, and Kenney tile 96 no longer
draws the player in any facing.

The sections below are the plan as written. This block records what was executed against it, so the
document does not become the next stale audit. Tests: **275 passing**; `pnpm matrix` 100/100 seeds
resolve on both loop bots (kite 93%, naive 0%); `pnpm smoke` boots the title with a real keypress,
drives both endings through a real browser taking opposite sides of the toll, and requires real
frames to render over every key screen (hub, toll, offer, boss, death and victory cards). An
external audit's hash-aliasing finding led to a full sweep of `hashWorld`: every field is now
written unconditionally, with three pinned collision regressions.

CI lives at `ci/github-actions.yml` rather than `.github/workflows/ci.yml`: the GitHub App that
pushes this branch is refused on that path by both git and the REST API, so the pipeline is parked
one `git mv` away from being live.

| Plan item | State |
|---|---|
| Task 1 — truth pass | **Done.** Attempt-keyed run seeds; sim-authoritative death cause; tile router; hashed solids; pause owns audio. The death card names what you carried (the vows), who took you, and — when Minos did — which sentence: THE CIRCLE, THE VEIL, or THE FAN. |
| Task 1 — CI and instruments | **Instruments done; workflow parked.** `tools/smoke.ts` and `tools/matrix.ts` are manual gates, and `ci/github-actions.yml` is an inactive template pending separate workflow authorization. The matrix separates the hard soft-lock gate from a reported balance band. `tests/docs.test.ts` pins `HARNESS.md` against the encoder so the agent contract cannot rot again. |
| Task 2 — the heavy as its own verb | **Done** (the prototype half; the human A/B remains). Right mouse / L / C / pad Y, its own queue, priority stated once as roll > heavy > light, a chain-cutting cancel, a roll launch, inert on the bow. Ten contract tests. The dash attack is named in the swing event and given the roll's cold colour and a tighter swish. |
| Task 7 — statuses, boons, gods | **Done.** Burn joins Brand in `src/sim/status.ts`; twelve vows across two powers with one duo; the offer screen is a meeting with a named, drawn deity. |
| Boss | **Done, and phase two now recombines.** Minos still teaches slam, then ring, then fan. After the veil breaks, each sentence brings the next: the circle throws the veil, the veil throws the fan, the fan plants the circle. The tell that named a sentence does not get shorter. |
| Realm identity (part of Task 8) | **Partly done.** Named spaces have distinct dress. Combat HUD names the shade (HOPLITE / LAMPAD / EMPUSA / OATH-BOUND), not LEFT n. The loop no longer stamps WAVE 1, ROOM CLEARED / WALK NORTH, or a second copy of the room name over the plan. Arrival is the footer. You already pressed Descend. Palette package and authored recast sprites are still later. |
| Pacing — THE TOLL (not in the plan as written) | **Done.** The run was four fights and three offers with no breath. Charon's Landing now asks before it fights: pay a permanent vessel of life and he hands you a fourth vow from across the crossroads, or cross owed and one more shade wades into the Hall of Minos. It reuses the `entering` room phase the audit had flagged as doing no work, and it is one authored rite rather than an event framework with one entry. `src/sim/rites.ts`, ten tests, and the ferryman is the third portrait on the speaker plate. |
| Task 10 — shell | **Done (the verbs).** Title over the living hub is DESCEND / SETTINGS / CREDITS. Settings owns STILL THE ROOM (same persist as V) and MUSIC / SOUND in eight steps, pad and keyboard. Pause opens the same mix: RISE / GIVE THE DESCENT BACK / SETTINGS. Credits names the cast, not the toolchain. Pause is BETWEEN BREATHS — no PAUSED. The loop no longer stamps ROOM CLEARED over the plan. A pad-glyph pass remains later. Fullscreen is the host's F. |
| Task 3 — rooms-as-data | **Done.** `src/sim/content/slice.ts` is the graph; `roomsFor` is a thin reader. Layout ids live in `src/sim/layouts.ts`. |
| Task 4 — generated route + exits map | **Done.** `startRun` picks `first-gate`, `late-shop`, `field-fork`, `fire-ford`, `styx-gate`, or `ash-march` from the attempt seed. Early shop: landing then Cocytus. Late shop: Cocytus then landing. Field-fork: Acheron is a single door; the Field chooses Lethe or the Reach, never both. Fire-ford: landing then Phlegethon. Styx-gate: the first fight is the oath river. Ash-march: both rivers, no bank. The exits strip names the plan: VEIL, BLADE, BANK, RIVER, OATH, JUDGE. The last row is the rest of the spine, not a THEN header. The footer names this floor; the strip does not reprint it. |
| Task 4 — six chambers | **Done (the spine).** A path is six rooms: Acheron or Styx → Lethe or Asphodel → Landing → Cocytus or Phlegethon → Antechamber → Minos. The Oath-Bound stands alone in the Antechamber; the Landing no longer teaches the shield inside a crowd. The strip names OATH before JUDGE. |
| Task 4 — half-recognize | **Done (dress + live fill).** Styx, Cocytus, Phlegethon, and the Antechamber have their own overlays on threshold masonry. A live descent picks a same-kind dress for combat and elite rooms; the catalog and a fixed fill stay the authored floors. Elite door glow matches the seal. |
| Task 5 — node-boundary save | **Done.** Schema 3, `src/sim/checkpoint.ts`. Resume re-enters the node from `boundaryRng`. |
| Task 6 — obols / Remembrances / shop | **Done.** Landing's post-fight reward is Charon's stall (`heal` / `vessel` / `vow`). Obols die with the attempt; Remembrances bank on `finishRun`. |
| Phase 3 — mystery (The Unburied) | **Done.** Live fill flips the utility node: shop **or** the Unburied, never both. Toll stays. Three cards: a coin, a memory, or leave him — leave sends a hunt into the Hall. The body wears the bank; the fight strip and the death card name THE UNBURIED, not a fallen Hoplite. The Smith names the one you left, once. |
| Phase 4 — Smith reroll | **Done (the unlock).** Walk into the west shade; three Remembrances buy one reforging per descent (`L` / heavy on an offer). |
| Phase 4 — banked vessel | **Done.** After the reforging, five Remembrances buy one cup that stays: +1 max HP in town and on every later descent. The shop cup still dies with the attempt. |
| Phase 4 — return home | **Done.** Death or victory banks Remembrances; the Bardo banner names what you kept, or calls you west to the anvil when three are waiting and the Smith has not been paid. |
| Phase 7 — abandon-run | **Done.** Pause offers RISE or GIVE THE DESCENT BACK (confirm twice). Remembrances bank; the death card does not play. |
| Task 9 — bow | **Not started.** Debug probe only. |

### Revision 3 (2026-08-28, audited at `6852aa0`)

A fresh three-track audit (sim, presentation, tooling) re-verified this block against `main` and locked
four decisions with the user. The suite at `6852aa0` measures **512 passing tests in 32 files**
(`pnpm test`, 2026-08-28 — the "275 passing" above was already stale when written); `pnpm matrix`
holds the hard no-strand gate at 100/100 seeds (measured 2026-08-29 after rebasing onto the modal
arm gate: kite 73% wins, 39.8–52.3 s clears; naive 0% — both inside the soft band).

**Fresh findings, queued into the revised ordering below:** the death card omits the build the victory
card shows, and both cards accept confirm on tick 1 before the staged reveal (no minimum beat); the
reward screen's prompts hardcode keyboard wording on a gamepad (the HUD hint row is device-aware; the
prompts are not) and it lacks the rite screen's same-frame nudge/commit guard (`rites.ts:81-86`); the
pause card's three actions are keyboard-only; `audio.ts`'s `setLevel()` is correct and has zero
callers (no volume control ships); R and Start are dead mid-run (no abandon).

**Decisions of record:**
1. **Process.** The PR loop (plan → build → multi-agent adversarial review → fix → merge) is the
   standing directive; the gauntlet is retired (banner in `GAUNTLET.md`, dispositions in
   `public/progress/data.json`). The blind-critique protocol survives only as the realm-art
   acceptance gate (three exhibits, §G.5).
2. **Art budget.** The PixelLab cycle expiring 2026-09-04 deliberately lapses unspent. Generation
   happens next cycle, inside the realm phase. **Unresolved and owned by PR 6:** the art bible does
   not merely lack a Greek entry, it *deliberately defers Greek* — "the realm that would read as a
   Hades copy, and we win nothing by inviting that comparison first" (`ART_DIRECTION.md` §9) — while
   the shipped game is Acheron, Lethe, Asphodel, Charon, Minos and Hecate throughout. Either the
   bible's realm order or the realm we built has to move; do not start generating art until that is
   settled. Then the §9 Greek entry first, followed by the
   ASSET-KIT order discipline, integration timeboxed with a two-loss stop rule.
3. **Seed-1 first run.** A brand-new profile's first-ever run being universal (URL seed 1, attempt 1)
   is kept as an authored decision: it is a tunable onboarding and comparable playtest telemetry.
   Attempt-keying already fixed reload staleness. When the route generator lands, a test asserts the
   attempt-0 route is a valid teaching route.
4. **The toll is not the utility node.** Charon's Landing keeps THE TOLL as the fixed pre-boss beat in
   every generated route; the utility node (shop XOR *The Unburied*, never both) is a separate
   mid-route role. *The Unburied* joins `rites.ts` as its second consumer (the debt target
   generalizes from "the boss room" to "the next room"); the shop is a node handler, not a rite. The
   toll's price stays vessels, never obols, and is re-tuned once the shop sells healing.

### Revision 4 (2026-08-29) — PR #13 merged in

PR #13 (`first-gate-sitting-loop`) shipped Revision 3's PRs 2–5 in one branch: rooms-as-data plus six
route spines, the obol/Remembrance economy with the Smith, node-boundary checkpoints, and a realm
dress pass. Revision 3's remainder table is therefore deleted rather than updated — it planned work
that now exists. The four decisions above still stand; decision 2's Greek contradiction is still open
and now more urgent, because the realm dress landed against a bible that defers Greek.

What the merge itself had to settle, recorded here because a future reader will wonder:
- **One schema 3, not two.** Both branches independently bumped `SAVE_SCHEMA_VERSION` to 3 for
  different documents — PR #12 for volume sliders, PR #13 for the checkpoint. Two builds each
  stamping 3 for an incompatible payload is precisely the failure the version exists to prevent, so
  3 is now defined once as the union: real checkpoint, settings V2, widened meta.
- **One pause card.** PR #13's paged card (RISE / GIVE THE DESCENT BACK / SETTINGS) won on structure
  and voice; PR #12's master bus was ported onto it, so the mix is master + music + sound.
- **One latch release.** PR #13's `releaseHeldIntent` replaced PR #12's `absorbLatched` — both had
  been auto-merged into the class with no conflict marker, and both were being called.

The live ledger below is PR #13's, kept as written.

### Revision 5 (2026-08-29) — the review round on the merge itself

Three defects in the merge's own work, each found by reading the wiring rather than by a failing
test, each now covered by a test that goes red without its fix.

- **One authority for the abandon row.** The pause card asked the sim (`canAbandon(world)`) when it
  drew and asked the shell (`canGiveBack()`) when it navigated. The two disagree exactly where it
  matters: a playtest session forbids abandoning while a run is plainly live. So the card painted a
  "GIVE THE DESCENT BACK" row that navigation had no index for, and choosing it opened SETTINGS —
  and PLAYTEST.md's promise that the row is hidden was simply false. The overlay no longer reaches
  into the sim; the shell sets `setLeaving()` every frame, and `canAbandon` has one caller.
- **The Escape key had drifted onto the same wrong answer**, returning a focus index off the end of
  the shorter card.
- **A no-dash bundle did not replay as a no-dash run.** `no-heavy` is a frame filter and rides in the
  recording; `no-dash` closes a cancel WINDOW, and a window is not in the frames. Nothing on the
  replay side re-applied it, so every no-dash bundle replayed as a baseline run and diverged at the
  tester's first dodge-into-attack — which would have quietly falsified the condition the fun gate
  exists to measure. The condition now lives in `src/playtest.ts`, rides in the bundle, and is
  re-applied by `pnpm sim`, by `pnpm shot`, and by `__game.replay()`. Measured on identical frames:
  hash 3380115452 baseline against 272518353 no-dash, and `--playtest baseline` reproduces the
  baseline hash exactly from the no-dash bundle.

A second round on the same PR then closed nine more, all of them the same shape — something real
happened and the checkpoint beside it did not know:

- **A refused toll became nothing.** `enterRoom` runs `beginRoomFight` — which clears `riteDebt`
  into a 150-tick delayed spawn — BEFORE it emits the `roomEnter` the checkpoint rides on, so the
  snapshot stored `false` with the shade in a queue no checkpoint carries. Reload in the Hall and
  Minos came alone, permanently. Same for the Unburied's hunt.
- **The Unburied went to the wrong room entirely.** `collectDebt` was gated on the boss room and
  `collectHunt` was not, so the hunt was spent in whichever fight came next. LEAVE HIM promises
  "He follows you to the judge"; it never did.
- **A resumed attempt restarted its own clock**, so a nine-minute descent reloaded once reported
  ninety seconds.
- **The memory option charged for a vessel a reload took back** — the one mid-run debit of
  permanent currency, persisted against a checkpoint captured before the purchase.
- **An imported descent existed only on disk**, and the next descent's first room overwrote it.
- **A checkpoint could outlive the route it named.** A content update that moves doors while
  keeping the room id would have walked the player down a route their snapshot never generated.
- **The Smith forgot the answer he had not spoken to yet** (`lastMystery` is session state that no
  document carried; the mid-run half is fixed, the town half needs `MetaStateV2`).
- **A playtest session resumed a saved descent**, arming a recorder at tick 0 of a world that was
  already mid-run — producing a well-formed bundle that replays into a run that never happened.
  A playtest now never resumes, which is the fourth session interlock.
- **The death stele could not hold its own build line.** Measured against the shipped font: two vow
  names is 240px in a 164px row, and the counted form the three-vow case has always used is
  171-173px — so the abbreviation never fit either. The renderer now walks a ladder and stops at
  the first form that measures inside the row.

Gates after both rounds: 816 tests / 62 files, matrix 100/100 (kite 88%, naive 0%, unchanged from
before either round), build ok, browser smoke both endings, desktop smoke clean, pinned replay
hashes untouched. Every fix was confirmed red with itself reverted.

Known flake, not a regression: `pnpm smoke:desktop` failed once on the corrupt-save check
("browser has been closed") and once on the import banner check (it sampled a transient ROOM
CLEARED). Both passed on re-run, and three consecutive clean runs followed. The suite has a timing
weakness worth its own pass.

### Revision 6 (2026-08-29) — the graphics overhaul is decided

A grilled design session (four rounds, every decision confirmed by the user) reset the visual bar to
nine named concept images and settled the opening of the game. Durable rationale lives in
`docs/adr/0001` and `docs/adr/0002`; the enforceable rules are in the amended `ART_DIRECTION.md`;
the vocabulary is in `CONTEXT.md`. Decisions of record:

1. **Decision 2's Greek contradiction is closed** — and was already closed in the bible: §9.0 ("THE
   FIRST GATE") makes Greek the first production realm, keeping the Hades fear as a forbidden list.
   The generation freeze is lifted. Greek is the first realm of several: Duat, Niflheim and Mictlan
   entries stand in §9; the Bardo and the hero are pantheon-neutral.
2. **The render target moves to 640 × 360** via a 1.5× world-render scale (ADR 0002). The sim is
   untouched; art density becomes 24 px/tile, hero ~39–40 px body on a 64 canvas, ladder ×1.5.
   Combat rooms keep placeholder art (scaled, temporarily scruffy) until their recast phase.
3. **The Bardo becomes one continuous ~64 × 36-tile room of floating islands** under a new generic
   follow camera (ADR 0001): a south-to-north pilgrimage line, Seals foreshadowing the other
   pantheons, three silent inhabitants (Smith, Ferryman, Keeper), void-to-the-glass presentation,
   fullscreen toggle. Combat rooms stay 26 × 15.
4. **The hero is regenerated from scratch** — the approved masters were judged below the new bar.
   Authored unarmed-first with a paired sword state (kills the baked-sword fallback for good),
   tripled frame budget. The Brute re-derives at the new density; Kenney actors await recasts.
5. **The title becomes a camera vista** over the pilgrimage axis; DESCEND glides the camera down to
   the causeway. The 48%-alpha veil dies.
6. **Decision 2's art-budget half is revised: generation restarts now.** gpt-image is the primary
   lane (provenance shows it produced the existing masters); PixelLab spends where it is strongest
   before the cycle dies 2026-09-04 but is no longer load-bearing.
7. **Scope guards:** audio deferred; Seal unlock triggers designed later (assets ship both states);
   one replay-hash rebaseline (`pnpm record-bots`) when the new Bardo arena lands. Acceptance is
   the blind-critic protocol with the nine concepts registered in `art/reference/concepts/`.

### Revision 7 (2026-08-30) — the hero becomes a system before it becomes a picture

Revision 6's decision 4 produced a first identity round: eight screened 64×64 candidates
(`.art-cache/candidates/hero-identity-v2/`). The user rejected the framing before choosing —
every candidate is a costume whose identity lives in removable equipment — and issued a
foundational brief, canonized as `CHARACTER_FOUNDATION.md`, the standing spec for the player
character. Consequences of record:

1. **No identity master exists.** The candidate round is shelved as reference; `pnpm art approve`
   stays untouched. Identity art resumes only after the user locks a mannequin, a hard-constraints
   spec, and a production pipeline (the document's exploration phase).
2. **Revision 6's "tripled frame budget" is revised:** strong poses first (anticipation → commit →
   impact → follow-through → recovery); frames serve poses.
3. **The character production pipeline is an open architecture question** — single source of truth,
   Dead Cells principle (cheap iteration), options to be investigated and costed before locking.
4. Tracks are unaffected where independent: the engine track (ADR 0001/0002) proceeds; set-piece
   and district art proceeds under the bible; the PixelLab cycle now most likely lapses for hero
   work (as decision 2 originally planned) and spends, if at all, on non-hero assets.

### Open after the merge (audited 2026-08-29, eleven agents over PR #13)

Fixed in the merge: the double schema-3 collision, the duplicate latch release, the missing master
bus, and PR #13's three checkpoint holes (reward re-farm on reload, unlimited room retry, and a
restore guard that could never return false). What the audit found and the merge did NOT close,
ranked by what a sitting player would notice first. Each is evidenced; none is a hunch.

1. **The realm dress does not change the room.** — **CLOSED** (`claude/realm-dress-registers`).
   The cause was one layer deeper than this entry says. `dress.ts` swaps tile INDICES out of a
   single sheet and retints braziers; the floor sprite was never tinted at all, and
   `juice.light.ambientTint` put one indigo over the whole world layer in every room. So no fog
   value could have fixed it: a wine hall lit by indigo is an indigo hall. `AtmospherePreset` now
   carries `floorTint` and `ambientTint`, green held high so a floor changes hue without going
   dark. Measured with the new `pnpm realm-air` across four spines — median pair separation
   2.0–2.8/255 before, **9.5–9.7 after**, and where every room previously read blue (including the
   wine Hall and the gold Landing), **no realm now reads the wrong temperature**. The original text
   is kept below because its evidence still reads true from the outside.

   ~~Original entry.~~ Seven rooms the ledger describes as river / ash /
   ice / iron / bronze / wine-fire / wine-hall render as the same blue-grey masonry — measured mean
   RGB across the play area differs by under 4/255 between Acheron and the Hall. `fogAlpha` 0.10 and
   `rayAlpha` 0.06 (`tuning.ts:473-474`) are too low for the presets in
   `render/atmospherePresets.ts:20-105` to register. This is the single biggest gap between what the
   ledger claims and what renders.
2. **The map beat does not produce a plan.** Every spine has exactly one fork, at one depth, and both
   branches rejoin one node later — so `routeTail` returns the same chain for either door
   (`route.ts:496-504`), and the overlay shows an identical future whichever you pick. §G.1 wanted
   width 2-3 and choices at three depths. The overlay also never draws the route *so far*:
   `roomHistory` is read only to build a cache key (`render/map.ts:57-60`).
3. **One run in six has nowhere to spend.** ASH_MARCH carries no utility node at all — no shop, no
   Unburied, no toll — so its obols are unspendable (`route.ts:312-354`; 16.8% of seeds). Obols have
   no scarcity anywhere: a full clear earns 34-51 and the single purchase costs 6-12, so the purse
   counts up and never bites.
4. **The Smith spends on proximity.** Walking within 18px buys, with no confirmation and no undo, and
   the purchase banner is destroyed in the same frame by the next one (`smith.ts:62-76`).
5. **MetaStateV2 never landed.** The new persistent fields were bolted onto `MetaStateV1` with
   `version: 1` unchanged (`session.ts:93-101`), so the next meta change has no discriminator to
   migrate from. The settings payload got its bump in this merge; meta still needs one.
6. **Determinism seams.** `arena.smithNear` is per-tick state outside `hashWorld` that gates a
   purchase whose effects ARE hashed; `roomsFor` now returns module-global mutable arrays by
   reference rather than fresh ones. And no pinned replay fixture covers the `loop` scenario at all,
   so every line of new hashed state sits outside the fixture net — the "hashes must not move" rule
   is currently satisfied vacuously.
7. **Minos fires stacked lanes.** In phase two the veil sentence looses the ring and its fan
   companion from one origin on one tick, putting two bolts on an identical path — one is invisible.
   Eleven phase-two warden constants in `tuning.ts` are now dead but still read as authoritative.
8. **Shell edges.** The death stone's rows are left-anchored with no wrap or mask, so a two-vow death
   spills off the card; Settings and Credits still paint centred over the hero body that the menu
   page was moved to avoid; and a mouse cannot operate the shell — clicking SETTINGS starts a run.
9. **Evidence hygiene.** Every committed Minos and Empusa progress shot was written by the first
   commit, and the last four commits then rewrote exactly those pixels amber to wine. The progress
   page shows a renderer that no longer exists.
10. **Two props fail this PR's own gate.** `ART_DIRECTION.md` §11.1 sets the Mirror test at ≤60%;
    the committed prow measures 71% and the pan 92%.

The human fun gate remains the one thing bots cannot close, and it is still at zero sessions.


### Remaining toward 90+ (live, 2026-08-29)

The sentence in §E is playable. What still reads as unfinished when you sit down:

1. **Settings / Credits** — **Done.** The title is three verbs. Settings stills the room and sets MUSIC / SOUND in eight steps. Pause opens the same mix mid-descent — RISE / GIVE THE DESCENT BACK / SETTINGS — so a run does not have to die to go quiet. Credits names who waits. Pad glyphs remain later. Fullscreen stays the host's F.
2. **Route variety** — **Done (six spines).** Early shop, late shop, the Field as the fork, the fire ford, the Styx gate, or the ash march. Live dress no longer puts Field poppies on the rivers, the ferry shore, or the Antechamber — the only poppy left is the one on Minos' scale, and that scale can sit west or east. The Oath-Bound's floor is a lintel or an iron court. The Hall is the same wine either way. The air follows the floor: Acheron is cold river, the Landing is gold, Styx is iron, the Hall and Phlegethon are wine. The one bed retunes with the floor. The tell notch does not move. Indigo ambient light stays global. The open door stays gold. Consecutive runs still share the elite node and the judge — not the sitting of the scale.
3. **Minos look** — recombination is in; the hall dresses as a scale (two pans, short beam, bare circle). The judge lands on the Oath-Bound's clock. A death names the sentence that took you (MINOS · THE CIRCLE / THE VEIL / THE FAN), including the companion blow in phase two. The circle, the veil, and the fan are wine — gold stays on the scale; ember stays on a burning body. The windup sits above the light, so the Hall's dark does not eat the tell. Fan plants the circle with the same plate and lock rim as the taught slam. Veil/fan spokes ride the hi layer. The slam flash and the phase-two body are wine-hot, not cream. The windup bell names the sentence: circle is the low plate, veil rises, fan is a tighter woosh. Authored judge frames stay later.
4. **Smith bark** — **Done.** The one you left is the first line, even if the same step buys the cup. He asks for what you kept, not for remembrances. After a first death he still says You came back thinner. The anvil still spends. — the banner no longer whispers it in lowercase. A claimed vow keeps its written case too.
5. **Developer text** — **Mostly done.** The title verbs sit left so the rack and the unarmed body are the picture, not a card over a blackout. The verdict is SIX CHAMBERS. TWO KEPT — no clock. The Hall ends in wine, not cream. A meeting no longer captions itself THE ACHERON GATE under CLAIM. PAUSED is gone. The Hall no longer subtitles itself "the last chamber." The sound gate says WAKE THE ROOM. Coming home says 1 DESCENT. Pause gives the descent back, not the attempt. The fight strip and the stall say NO OBOLS / ONE OBOL. A meeting hides the life plate so five empty sockets do not sit under the ferryman. Pause hushes the same chrome — BETWEEN BREATHS is not a fight. The exits strip no longer stamps FIGHT / HARD / ELITE, NORTH / EAST, FIRE / ICE, THEN, or a second copy of this floor; doors read VEIL, BLADE, BANK, RIVER, OATH, JUDGE, and the last row is the rest of the spine. The footer is HERE. The one you left is THE UNBURIED; the one the river sent is THE ACCOUNT. The verdict card and the home banner name this descent's keep (`lastBanked`), not the lifetime pile. Coming home is a Bardo veil, not the same cream strobe as walking into Acheron. The home beat is 2 KEPT / the blade waits — it does not reprint THE BARDO over the footer. You wake without the blade; the rack is the ritual. A door is a dark lift; a new floor wears its own fog. The Smith asks for what you kept, not for remembrances. The Unburied's memory card costs ONE KEPT, and it does not buy. The death stone is three sentences — A FALLEN HOPLITE TOOK YOU / AN UNMARKED BLADE / ONE CHAMBER IN. NOTHING NEW — and RETURN, not R RETURN. It does not keep the fight strip on the stele. Arrival no longer reprints THE ANTECHAMBER over the footer. Leftovers: stock-scenario ROOM CLEARED / PRESS R / WAVE n (not the loop). A live mix no longer says SHADES. The first fight no longer wears UNMARKED BLADE as an empty inventory. The strip arrives when a vow or a coin does. The title tally is 1 DESCENT · UNNAMED, or N NAMED after Minos; coming home is not a failed return. Coming home asks DESCEND AGAIN; the tally sits with the verbs, not on the body, and it never says DAMNED. The meeting ends on CLAIM, or CLAIM · TURN when the Smith has been paid; a duo names THE KINDLY ONE · HECATE; the ferryman's extra meeting is WHAT THE LAST ONE PAID; the stall ends on PAY, not BUY, and the ferryman is owed, not a clerk who sells; the toll costs A LIFE, FOR GOOD. The meeting no longer says Brand, REFORGE, or names the reforging key. The Kindly One veils the room the way a pause does — she does not black it out. BETWEEN BREATHS no longer advertises E EXPORT · I IMPORT.
6. **Human fun gate** — zero recorded sessions. Bots cannot close §E. Fresh `slice-kite` seeds 1–8 after the door-flash lead: seven wins, 48–54 s, seed 6 lost in the late rooms; every run home. Fresh `slice-naive` seeds 1–8: eight losses, dead at 16–34 s after two to four chambers, every run home. The sentence plays. A person has not sat down. Do not retune for the kite loss.
7. **Authored recasts** — Lampad / Empusa / Minos still lean on Kenney. Gauntlet stays parked.
8. **First-fight lead** — **Done.** Stock arenas still hold 30 ticks. The loop's door flash is the hold (`loopLeadTicks` = `transitionTicks`). The first tell is queued when the room is entered — walking the gate no longer waits that hold a second time on an empty Acheron. The Antechamber's Oath-Bound lands on that clock, a light is bronze, and a heavy is the answer.
9. **Oath-Bound teach (sim)** — **Done.** Production-clock test: solo `oathbound`, `guardBlocked` on a light, damage on a heavy. The hoplon, the block sparks, and the OATH seal are bronze — gold stays the crossing. A turned blow used to bleach the disc cream-gold; the flash is hotter copper. Authored hoplon frames stay later.
10. **Spawn tell** — **Done.** Arrival is a wine-dark floor pad at the body's radius — filled, not a dashed reticle. The inner ring closes as the delay runs out. The burst is wine, not cream. THE ACCOUNT's ring and the coin that stays on him are brass, not the door. Two of the same shade read `2 HOPLITES`, not `2 HOPLITE`. Marks still on the floor do not get a second rail of broken gold — that read as four dots under two names. A mix is the names in arrival order — LAMPAD · 2 EMPUSAE — not 3 SHADES. One Oath-Bound is the name; there is no empty pip rail under it. The Empusa's body strobes wine-hot, not cream hell. A heavy that catches a word is a white ring and ember, not cream.

Burn now sits on the body as a vertical ember vein — Brand keeps the diagonal cut and three air slashes. Three cuts, the collection ring, and the stamp at the body stay Kindly fire; they do not borrow the door's gold. The count over the head is three small slashes, not three HUD plates. A shade on fire is readable at room distance; the Oath-Bound's dropped hoplon has something to stand next to. The disc itself is bronze, so a held guard is not another gold door — including the tick a light bounces. The smear wears the vow: Kindly fire is ember and wine — not peach, not cream — Hecate is veil, Cleaving Grace stays steel and only gets wider. A primed Between-Step heats the blade, not a chevron over the helmet. A brazier tongue follows the floor — Acheron is cold river, Phlegethon is wine. Fire on a body stays ember. The Lampad's bolt and lock are wine-dark — the committed ray is wine, not a pale laser. Magenta is Hecate's; a cut-this dart does not wear the veil. The Empusa's lane is the same ink — wine while she chooses, wine-hot when she commits. Ember stays on a burning body, not on the floor she promised. Her body strobes the same wine, not cream hell. Arrival bursts are wine; THE ACCOUNT's ring is brass. Minos's sentences are the Hall: the circle, the veil, and the fan are wine. Gold stays on the scale. The veil-break ring and the slam flash are the same family — not ember, not Hecate. A Lampad dart no longer trails magenta. The one bed retunes with the floor — Acheron thinner, the Hall heavier. The tell band stays put.

Do not grind parked art. Combat-first next: keep the human fun gate honest. Do not invent a seventh spine, an Unburied attempt gate, or a shorter spawn telegraph — the mark is the tell.

This document is the unified plan requested by the game-loop audit (Appendix B) and the vertical-slice addendum: one verdict, one gap analysis, one rank-ordered list of what to do next. Sections A–N below are the original audit; the STATUS table and this remaining list are the living ledger.

**Live evidence (2026-08-29, this window):** `pnpm typecheck` green. `pnpm test` **657 / 52 files**. After the type ramp and this morning's Hall pass: slam / veil / fan floor tells are wine and sit above the light; the fan's planted circle uses the taught slam plate; slam flash and phase-two body are wine-hot; the Empusa coil is wine-hot, not pale rose; Minos's windup bell names the sentence. WAVE / ROOM CLEARED / PRESS R stay gated off the loop. The exits strip still reads VEIL / BLADE and the rest of the spine; the death stone is NOT YET REBORN / RETURN; the title after a return is DESCEND AGAIN and `1 DESCENT · UNNAMED · 2 KEPT`. Coming home is unarmed, rack waiting, and the banner names the keep — 2 KEPT / the blade waits — not THE BARDO again. Pause is BETWEEN BREATHS / RISE / GIVE THE DESCENT BACK / SETTINGS — no export line. The Smith keeps his sentence. Credits name the cast, not the toolchain. The stall ends on PAY. The toll is ANSWER / A LIFE, FOR GOOD / SWIM. The Unburied is A COIN / A MEMORY / LEAVE HIM. The verdict is YOU RETURN WITH YOUR NAME / WAKE IN THE BARDO. Settings is STILL THE ROOM / MUSIC / SOUND. Acheron names 2 HOPLITES. The Antechamber is OATH-BOUND, no empty rail. The Hall's plate samples wine (`#4f1a2c`), not the door; the footer is THE HALL OF MINOS. Live overall loop foundation: **76**. Human sessions: zero. HEAD `62bb548` on [PR #13](https://github.com/draphael89/bardo-rogue/pull/13).

**Evidence base for the original audit:** full read of `src/sim/` (all 30 files), the entry point, input, tuning, and the render/audio surfaces; `pnpm typecheck` green; `pnpm test` green (**184 tests, 14 files**); fresh headless runs of the production loop (`slice-kite` seeds 1–60, `slice-naive` seeds 1–20); five Playwright screenshots along the golden path (Bardo, Threshold fight, Veiled Crossing fight, reward offer, Warden fight), reproducible via:


```bash
pnpm sim -- --scenario loop --bot slice-kite --seeds 1-60 --ticks 18000
pnpm sim -- --scenario loop --bot slice-naive --seeds 1-20 --ticks 18000
pnpm shot -- --scenario loop --seed 1 --stepwise 1 --ticks 40 --out shots/town.png
pnpm shot -- --scenario loop --seed 1 --stepwise 1 --bot slice-kite --ticks 430 \
  --eval "let g=window.__game;let n=0;while(g.world.roomPhase!=='reward'&&n++<400)g.step(1);g.bot(null)" \
  --out shots/reward.png
pnpm shot -- --scenario loop --seed 1 --stepwise 1 --bot slice-kite --ticks 1700 --out shots/warden.png
```

---

## A. Executive Verdict

**The loop surgery is done. The game is real. What it needs now is a fun proof, a run spine that can vary, and a shell.**

The default URL boots a complete, deterministic attempt loop: wake in the Bardo → walk into the blade rack → the threshold unseals → fight Room 1 → choose one of three behavioral boons → choose one of two marked doors → fight the branch → boon → fight the Black Step → boon → two-phase Warden → victory or death → return to the Bardo with persistent attempt/victory counters. Every piece of that sentence is implemented, tested, hashed, and replayable (`src/sim/rooms.ts:56`, `src/sim/session.ts:82`, `src/sim/rewards.ts:25`, `src/sim/return.ts:14`).

**Combat is no longer the risk.** The combat-feel audit at `1ef5b18` scored 76/100 and listed ten prioritized fixes. Commits #2–#5 closed nearly all of the structural ones — verified at HEAD:

| Combat audit item | Status at `4d44311` | Evidence |
|---|---|---|
| 1. Single frame owner (Pixi auto-ticker double-RAF) | **Fixed** | `src/render/app.ts:42-47` (`autoStart: false`, `app.ticker.stop()`) |
| 2. Truthful action-queue contract | **Largely fixed** | `player.controlTick` intent ages only when the player can act; held-vs-discrete attack split (`attackHeld`); dodge re-press during travel rejected (`src/sim/player.ts:13-26`, `src/sim/world.ts:28-31`) |
| 3. Vector-space movement normalization | **Fixed** | `src/sim/player.ts:311-341` |
| 4. Roll landing authority | **Fixed** | `landMoveMin: 0.28`, `landMoveExp: 1.2`, travel 13 / total 20 (`src/tuning.ts:39-50`) |
| 5. Per-action screen feedback | **Fixed** | `ActionFeedbackGate` + sqrt crowd caps (`src/render/feedback.ts`) |
| 6. Convergent separation / circle-vs-tile | **Fixed** | 4-pass deterministic separation (`src/sim/step.ts:92-110`); closest-point narrow phase with bisection tangent (`src/sim/collision.ts:3-40`) |
| 7. Aim ownership + target hysteresis | **Fixed** | assist scored by angle + distance + LOS with 8° retained-target hysteresis (`src/sim/player.ts:269-290`) |
| 8. Longer control-proof encounter | **Fixed** | six-wave curriculum `full` scenario (`src/sim/waves.ts:17-56`) |
| 9. Authored player animation set | **Partial** | authored hero + Brute clip sets landed in #5; Caster/Charger/Warden remain procedurally staged |
| 10. Density budget | **Deferred (correctly)** | pools still 32/64 (`src/sim/world.ts:77-78`); no content yet demands more |

One open combat-design question survived every audit unasked until the cross-review: **the heavy attack has no input of its own** — it is only reachable as the third swing of the chain (`beginAttack` always starts swing 0; `InputFrame` has no heavy field, `src/sim/input.ts`). Every heavy-triggered boon therefore requires finishing a chain first. Whether the heavy should be an independent, deliberate verb is now a Phase 1 human-gate question, not an assumption in either direction (§H.1).

**How far from the desired slice:** the vision's vertical slice asks for an opening screen, a hub with an NPC and visible meta progression, one realm with authored mythology, node-based route choice, run and meta currencies, a shop, statuses, deity-framed boons, and a boss — on top of exceptional combat. Today the game has the combat, the loop skeleton, four encounters, six boons, one branch, one boss, and counters that persist but change nothing. That is roughly **the bottom half of the slice built to a high bar, and the top half absent**.

**What is already strong:** the deterministic sim and replay/bot/screenshot harness (the single best asset in the repo); the combat feel chain; the session/run/room state boundary; the physical, menu-free town verbs (rack, doors, marked exits); the behavioral six-boon system with its one-hook composition point (`resolveWeaponOnHit`); death-as-return in the fiction; a cohesive authored look for the one environment that exists.

**The biggest risks, in order:**
1. **Fun is unproven by humans.** Every number in this repo was validated by bots and frame strips. Zero recorded human sessions. The vision's own gate — "nothing is built on a layer that has not yet proven fun" (`VISION.md` §5) — is unmet at the layer everything now sits on.
2. **The first run repeats after every reload.** `startRun` derives the attempt seed from `world.seed` (URL, default 1) and in-memory `world.returns`; persistent `meta.attempts` is not mixed in (`src/sim/session.ts:88`). Day-two players replay day-one's exact run.
3. **A run is one authored graph, not a system.** Room geometry is four hard-coded builders keyed by `RoomKind` (`src/sim/arena.ts:35`, `112`); the slice graph is literal TypeScript (`src/sim/rooms.ts:56-107`). Fine for six rooms; a wall for a realm.
4. **No shell.** No title, no settings, no pause-owned audio, no abandon-run, keyboard-only overlay instructions. It reads as a dev build the moment the player is not fighting.
5. **Scope gravity.** The vision names pets, eggs, artifact tiers, god summons, armor, two economies, legendary events. Building even half of those now would bury the fun proof under systems. Section M is the protection.

**The next milestone** (defined precisely in §E): **"The First Gate"** — one Greek realm slice on the existing loop: title screen → Bardo hub with the Smith and one visible permanent unlock → the Greek gate → a generated 6–7-node run (combat / elite / utility / boss) from fixed topology templates → obols in the run, Remembrances banked home → ~12 deity-framed boons over a two-status framework → Minos, Judge of the First Gate → return. One weapon this milestone; the bow stays a debug probe and headlines the *next* one. Pets, eggs, artifact tiers, summons: explicitly deferred.

---

## B. Current-State Architecture

The engine is PixiJS v8 + Vite + TypeScript strict, pnpm, Vitest, Playwright. ~6,700 lines of sim/entry source, ~7,600 lines of render views + audio, all strictly split:

**Simulation (`src/sim/`)** — pure TypeScript, no DOM/pixi/`Math.random`/`Date`, deterministic given (seed, scenario, input frames). One entry point per tick: `stepWorld(world, input)` (`src/sim/step.ts:19`). Fixed 60 Hz; distances in px; every gameplay number in `src/tuning.ts` (331 lines).

- **`World`** (`world.ts`) — one long-lived instance owning the room combat state: pooled enemies (32) and projectiles (64), wave director state, room phase, hit-stop (`freeze`), two slow-motion clocks (room-clear `timeScale` and per-mille bullet-time `slowRate`), gameplay vs visual RNG streams, and the `session` object.
- **Session / run / room boundary** (`session.ts`) — `GameSessionState { meta, preparedWeapon, run }`. `RunState` holds seed, weapon, boons + `boonBits`, hp/maxHp, depth, room history, pending reward, result. Health is explicitly stored/restored across room boundaries (`storeRunHealth`/`restoreRunHealth`). `MetaStateV1 { attempts, victories, unlockedWeapons }` persists via versioned localStorage (`storage.ts`), which currently clamps `unlockedWeapons` back to `['blade']` on both load and save (`storage.ts:29,43`).
- **Rooms** (`rooms.ts`) — `RoomDef { id, kind, waves, exits[{dir,to,mark}], reward, boss }`; phases `town → entering → fighting → reward → exits → transitioning → resolved`; physical door entry (`tryEnterDoor`), 8-tick transitions, per-room arena rebuild from the visual RNG stream.
- **Combat** — the player controller (`player.ts`, 341 lines) implements a two-light + committed-heavy chain with buffer/steer/cancel/whiff-confirm rules; the dodge is a 24 px promise with full-travel i-frames, ghosting, graze/perfect reads, and bullet time; `combat.ts` owns the shared swing curves (sim and renderer read the same functions, so the crescent is the hitbox), damage/poise/stagger, and the player hurt/death path (which authoritatively sets `finishRun(world,'lost')`).
- **Enemies** (`enemies/`) — brute, caster (cuttable bolts + backlash punish), charger, dummy, and the two-phase Warden; a shared tile-search pathing helper. Enemy scratch state is generic reused fields (`targetX`, `dashTicks`, `orbitAngle`… `world.ts:44-61`).
- **Boons** (`boons.ts`) — six behavioral boons as append-only bit flags; one composition hook `resolveWeaponOnHit` shared by blade, reflected bolts, and echoes; Brand is the one status (stacks + expiry on the enemy). **Rewards** (`rewards.ts`) — deterministic three-card offers honoring door-family promises, gating Final Judgment until Brand exists, and steering toward missing combo halves.
- **Waves** (`waves.ts`) — authored spawn groups with delays, `whenRemainingAtMost` gates, and seed-mirrored formations; room clear cancels hostile bolts, opens doors or offers rewards, detects boss victory.
- **Harness** — replays (RLE input + meta snapshot, pinned hashes in `tests/sim/replay.test.ts`), five bots including full-loop `slice-*` drivers, world hashing, metrics, headless runner, Playwright shot/strip/poses tools, `window.__game` debug API. 184 tests cover core feel contracts, encounter flow, rewards, replay parity, and the full slice.

**Presentation (`src/render/`, `src/audio/`)** — reads sim state + `world.events`, never mutates. `presenter.ts` (962 lines) drives views, camera trauma/kick/zoom (capped per action via `feedback.ts`), particles, decals, lightmap, postfx; `hud.ts` (1,404 lines) owns hearts, banners, boss bar, build strip, death card; `reward.ts` owns reward/victory/pause overlays. Views are per-entity modules; hero and Brute now have authored clip sets (`views/player.ts` 711 lines, `views/enemy-brute.ts` 676). Audio (`audio.ts`, 967 lines) has buses, ducking, a synthesized ambience/combat bed, intensity layers, and crowd arbitration — but pause does not stop it, and there are no user volume controls.

**Entry (`main.ts`)** — `?scenario=loop` is the default; loads meta, wires input/loop/debug/recording, saves meta on run events. Shell keys (pause, fullscreen, reduced effects, record) are raw `window.addEventListener('keydown')` — keyboard-only.

**One deliberate determinism nuance:** `hashWorld` excludes the arena on purpose — it is built from the cosmetic RNG stream so decoration stays free to change (`hash.ts:19-21`). Collision-relevant geometry changes are still caught indirectly (trajectories diverge and position hashes with them), but hashing only the `solid` mask would catch them at tick 0 instead of tick ~200. Cheap improvement, scheduled in §K.

---

## C. Vision-to-Reality Gap Analysis

Grades are 0–100 for **what a player experiences today** (not what the architecture promises), calibrated the way the project's own audits demand: 90+ ships next to Hades/Gungeon without excuses. Two tables: the vision's pillars, then the game-loop dimensions from the loop audit.

### C.1 Pillars

Live re-grade 2026-08-29 against the sitting game, not the architecture.

| Pillar | Score | What holds it below 90 |
|---|---:|---|
| Combat | **82** | Independent heavy and a named dash exist. Feel pieces are gauntlet-parked. One production weapon. Human sessions: zero. |
| Player (controls/movement/dodge) | **84** | The remaining gaps are validation (latency, landing windows) on real hands, not missing verbs. |
| Enemies | **74** | Oath-Bound is a real elite; Minos has three narratable sentences and a recombining phase two. Still three archetypes + one boss; Lampad / Empusa / Minos still lean Kenney. |
| Encounters | **72** | Six chambers, live dress, a toll, a shop or the Unburied, a solo elite teach. No hazards, no support enemy. |
| Hub | **78** | Unarmed wake, rack ritual, Smith, Remembrances, reroll, banked vessel, Greek gate. One room. Unarmed body is still Kenney stock because the authored idle has a baked sword. |
| Realm traversal | **76** | Six spines from the attempt seed, an exits-phase map, per-layout air. Consecutive runs still share the elite node and Minos. |
| Progression (run + meta) | **76** | Twelve vows, two gods, one duo, Brand + Burn. Meta plays: reforging and a cup that stays. Bow is still a debug probe. |
| Rewards | **78** | Meetings, a stall (heal / vessel / vow), the Unburied, a toll that costs a life. The vocabulary is no longer only boons. |
| Narrative | **64** | Title premise, Smith bark, death sentences, named shades, a ferryman who asks. No dialogue trees (deferred). |
| Art | **70** | Named floors dress differently; the Hall is a scale; wine is the hostile hue. Authored recasts for Lampad / Empusa / Minos / unarmed hero stay parked. |
| Animation | **70** | Hero and Brute authored; the rest procedurally staged. Do not grind. |
| VFX | **86** | Contact language plus wine spawn, wine Minos, bronze oath, ember burn vein. Hold. |
| Audio | **76** | Pause owns the clock; Settings steps MUSIC / SOUND; the one bed retunes with the floor. Still one synthesized bed, never heard by a sitting player. |
| UI/UX | **80** | Title / Settings / Credits / pause mix / abandon / map / death stone. The Hall's plate is Minos's life — wine, like the sentences, not a gold door-bar. Pad glyphs later. The verbs sit left so the rack and the body read. |
| Persistence | **78** | Attempt-keyed seeds, Remembrances, unlocks, node-boundary resume. CI workflow still parked. |
| Agent/developer tooling | **90** | 655 tests, shot / strip / sim, pinned hashes. CI template is one `git mv` from live. |

### C.2 Game-loop dimensions (from the loop audit)

Live re-grade 2026-08-29. Kite seeds 1–8 after the loop-lead fix: 7 wins in 48–54 s, seed 6 lost, all home. Naive seeds 1–8 all die at 16–34 s and come home.

| Dimension | Score | What keeps it from 90+ |
|---|---:|---|
| Core gameplay loop | **84** | The First Gate sentence plays. Kite 7/8 after the lead fix; naive 0/8. A person has not sat down. |
| Town / home-base clarity | **78** | Wake unarmed, take the blade, talk to the Smith, step the gate. Still one room. |
| Run startup | **76** | The rack is the ritual. One weapon. Nothing to weigh except going. |
| Room lifecycle | **82** | `entering` is the toll. Layouts are data. Geometry is still four builders. |
| Encounter pacing | **74** | Landing is a breath; the Unburied is an unknown. Still a short, dense run. |
| Room-to-room progression | **76** | Six spines, a map that names VEIL / BLADE / BANK / RIVER / OATH / JUDGE. Elite and Minos stay. |
| Player choice | **74** | Route, rite, shop or leave-him, twelve vows. Still one production weapon. |
| Reward excitement | **74** | A meeting, a stall, a body on the bank. You can want a cup or a coin, not only a vow. |
| Build diversity | **70** | Twelve vows, Brand + Burn, one duo. Discoverable in a handful of runs — the proof size, not a catalog. |
| Emergent synergy potential | **72** | One hit hook + two statuses + one hidden duo. Ceiling is high; pool is still a proof. |
| Weapon extensibility | **42** | Bow is a debug probe. Controller still branches on arm id. Deferred. |
| Run-state architecture | **84** | Route, obols, Remembrances, node-boundary resume. Deterministic. |
| Death / restart loop | **86** | Death is a return. The stone names who took you and what you carried. Pause can give the descent back. |
| Meta-progression readiness | **76** | Three Remembrances buy a turn; five more buy a cup that stays. Visible in the room. |
| Replayability | **72** | Six spines + live dress. Consecutive runs still share the elite and the judge. |
| Sense of anticipation | **70** | The map is five seconds and produces a plan. The Unburied is rare. Nothing is a second realm. |
| **Overall roguelike foundation** | **76** | The loop is the game. What 90+ still needs is a sitting person, authored recasts, and end-of-run rooms that do not always rhyme. |

---

## D. Keep / Improve / Replace / Defer

**Keep (load-bearing; do not "improve"):**
- Sim purity, fixed tick, event boundary, pooling, integer-coded append-only ids for hashing (`weapons.ts:3`, `boons.ts:8`).
- The replay/bot/hash harness and the rule that sim changes re-pin hashes via `pnpm record-bots`.
- Fixed full-arena camera at 480×270 with integer upscale; tuning-file discipline.
- Physical town verbs: rack pickup, walk-into doors, marked exits as promises (`rewards.ts:34-37` enforces the promise — keep that invariant forever).
- No contact damage; every hit attributable to a telegraph. Revisit only if swarm content ever exists, which this milestone does not add.
- The single-hook boon composition (`resolveWeaponOnHit`) and deterministic trigger priority.
- Death-as-return (`return.ts`) — one world instance, no reload.
- Per-action screen feedback gating (`feedback.ts`) and the contact/dodge visual language.

**Improve (in place, this milestone):**
- Attempt-seed sourcing (`session.ts:88`) — mix persistent `meta.attempts`.
- Summaries: sim-authoritative killer, build shown on death, minimum beat before confirm.
- Slice-bot exit navigation (reuse the enemies' tile search) so the traversal matrix can be an acceptance gate.
- Rooms/waves/graph from literal TS toward data (see §I) — an extraction, not a rewrite.
- The combat verb set: A/B an independent heavy and a named dash attack in the Phase 1 human gate (§H.1–2); adopt only what wins.
- Boon pool (6 → ~12) + deity framing on the existing reward screen.
- Gamepad parity + prompts on all overlays; pause owning audio and visibility loss.
- Docs: `HARNESS.md` replay flags (16 attackHeld / 32 confirm / 64 left / 128 right per `replay.ts:19`), and mark `EXPANDED_GAME_PLAN.md` §1–2 and `AUDIT_REPORT.md` as historical (both describe pre-assembly states).
- Audio content: one realm music bed with layers, on the existing bus architecture.

**Replace (when their second consumer arrives, not before):**
- `RoomKind`-keyed geometry builders → an authored layout registry addressed by id, when the Greek room set lands (task 3).
- Generic enemy scratch fields → per-kind state unions, when enemy #5 lands.
- `storage.ts` unlock clamp → real schema-checked unlock list, when the first unlock (the Smith's reroll) ships.
- `if (arm === …)` weapon branching → a `WeaponDef` move-set table — **deferred with the bow to the next milestone**; the extraction and its second consumer travel together.

**Defer (see §M for the full list):** the bow as a production weapon, pets/eggs, artifact/keepsake slots and tiers, god summon/ultimate, second realm, duo/legendary boon tiers beyond one proof, a third status, heat, remapping, localization, projectile-pattern engine + pool raise.

**On the addendum's "one artifact / one pet / one god family as architecture tests":** build the **god family** (deity framing is the heart of the boon fantasy and costs mostly presentation). For the meta boundary, the cheapest honest proof is **not** an artifact slot but the **Smith's reroll unlock bought with Remembrances** — one persistent currency, one purchase, one visible change to every future run, zero new loadout runtime. **Defer the artifact/keepsake slot** with that argument, and **defer the pet** (an AI-driven ally is the most expensive of the three — pathing, target arbitration, rendering, balance — and proves the least about the run loop; it deserves its own milestone after the realm exists).

---

## E. Vertical Slice Definition — "The First Gate"

The player's sentence when it ships: *"I wake in the Bardo, take my blade from the rack, trade Remembrances with the Smith, step through the Greek gate, plan a route through six chambers I half-recognize, spend obols at a shade's shop, build a sword that brands and detonates, cut down Minos, and come home with something permanent."*

### Exists when complete

**Shell**
- Title screen: game name, *Descend* (continue meta) / *Settings* / *Credits*; loading state; failure state that isn't a stack trace.
- Pause that owns sim + audio + focus loss, with *Resume / Abandon Run / Settings*.
- Settings: music/SFX volumes, reduced effects, fullscreen — keyboard and gamepad operable.

**Hub (the Bardo)**
- Exactly as today, plus: **the Smith** (a shade who reforges what the dead carried) with 4–6 lines of stateful bark text (first meeting, after first death, after first victory, after the unlock); **Remembrance counter**; **one gate** (the Greek door replaces the plain threshold seal); the rack keeps one visibly empty slot — a promise, not a product.
- Meta progression visible in the room: the Smith's reroll unlock, one banked vessel (+1 max HP unlock), the Remembrance count.

**Run structure (Greek realm)**
- A generated per-run route, depth 6–7, drawn from **fixed topology templates**: entry combat → combat branch → utility (shop **or** mystery, never both) → combat → elite → Minos. Chosen through the existing physical doors; a map overlay in the `exits` phase shows the route so far and the next choices with their marks. (Position and rationale: §G.1.)
- Run currency (**obols**) from kills and clears, mostly lost on death; **Remembrances** persist home either way, so death still banks bounded progress without touching combat difficulty.
- One shop (3 offers: heal / +max HP / boon); one authored mystery event (*The Unburied*, §G.2); 5 named spaces + 2–3 combat-layout variants.

**Build system**
- Two statuses — Brand (exists) + **Burn** — in one generalized framework with one shared indicator language.
- **~12 boons across two embodied gods**: the existing six rebranded under a war-god and a psychopomp identity (they already split blade/veil), plus 4–6 new drawn from Burn, the heavy, the dash attack, and obols; **one hidden duo** as the synergy ceiling proof. Portrait + name + one line on the existing reward screen.
- The Smith's **reroll unlock** (one boon-offer reroll per run) as the milestone's meta-progression proof.

**Combat verbs**
- Quick chain, heavy, dodge — plus two Phase 1 prototypes behind tuning flags: an **independent heavy input** and a **named dash attack** (the existing dodge-to-attack cancel given identity and boon hooks). Adopted only if the human gate says they win.

**Enemies**
- The existing three recast as **Fallen Hoplite / Lampad / Empusa** (names, dressing; behavior already proven); **one elite — the Oath-Bound Hoplite**, whose frontal guard breaks to a heavy or a status rather than to extra health; **Minos, Judge of the First Gate** (three readable attacks, recombining phase two — §G.3). One support archetype (a Lament that shields or hastens others) is the sole stretch goal, added only if playtests show encounter monotony.

**Persistence**
- Attempt seeds vary across reloads; meta = attempts, victories, Remembrances, unlocks (reroll, vessel), Smith dialogue state. **Node-boundary save/resume**: RunState (seed, route, current node, hp, obols, boons, weapon) serializes at every reward/door boundary; a refresh re-enters the current node fresh rather than restoring mid-combat frames. Rooms rebuild deterministically, so this is a small schema, not a save system.

### Explicitly does NOT exist

No second production weapon (the bow stays a debug architecture probe; the rack's empty slot is set dressing). No pets or eggs. No artifact/keepsake slot or leveling. No god summon / ultimate meter. No third status. No second realm (the other gates are sealed doors in the hub — zero implementation). No armor overshield. No duo/legendary system beyond the one hidden duo. No dialogue trees (barks only). No minimap during combat. No heat. No remapping or localization. No touch/mobile. No projectile-pattern engine or pool raise. No procedural room geometry — authored layouts drawn by seed. No full introductory cutscene — a short in-engine arrival beat at most.

### The 90+ version

What this exact slice must feel like to grade 90+: the title screen already tells you the game's temperature. The Bardo is quiet in a way that makes the gate loud, and taking the blade reads as ritual, not procedure. The first fight makes your hands trust the sword within ten seconds — that part exists today. The first boon offer is a *meeting*: a name, a face, a vow, and one of the three cards makes you say "oh, that changes how I swing." The map beat is five seconds long and still produces a plan ("shop after the elite? or the Unburied and pray"). By room four your sword is not the sword you entered with, and you know it — enemies wear your brands and burns, and the detonation you've been building pays off through a crowd; by the third boon you can *explain* your build and you've found one interaction you didn't anticipate. The Oath-Bound's guard teaches you why the heavy exists. Minos is introduced, escalates by recombining what he already taught, and kills you the first three times with deaths you can narrate. The return home stings and then immediately doesn't: the Smith says something new, your Remembrances bank, the reroll is one run closer, and the gate is still there. You press *Descend* again before you've decided to. Two consecutive runs never share most of their rooms, and on run five you meet the Unburied for the first time. Nothing anywhere — a menu, a summary, an error — reads as developer text.

---

## F. Prioritized Implementation Plan

Ordering reflects dependency and player value. Phases 0–1 are gates, not features: they make every later decision measurable and honest. (Sequencing note: economy lands before build depth because the Smith's reroll unlock spends Remembrances.)

### Phase 0 — Truth pass (small, do immediately)
- **Objective:** every instrument tells the truth; the loop is trustworthy across reloads and seeds.
- **Why now:** cheap; everything later is judged through these instruments; playtests (Phase 1) need seed variety, honest summaries, and working pause.
- **Work:** attempt-seed fix (`session.ts:88` mixes `meta.attempts`); sim-authoritative death cause + build on the death card + minimum summary beat; pause owns audio + visibility loss (pulled forward — it is cheap and broken); slice-bot exit navigation fix; CI (typecheck, tests, replay matrix, 100-seed headless traversal, one browser smoke via `pnpm shot` asserting the golden path states); doc sync (`HARNESS.md` flags, stale-audit banners).
- **Acceptance:** reload → different first-run offers; 100/100 seeds traverse; manual release gates green; death card shows weapon + boons + true killer; pause silences audio ≤100 ms.
- **Out of scope:** any new content.

### Phase 1 — The fun gate (human playtests + combat-verb prototypes)
- **Objective:** structured human evidence on the current slice — comprehension (rack, doors, marks, damage attribution), first-death timing, boon excitement, synergy discovery, Warden difficulty, voluntary replay — **plus** A/B verdicts on two combat-verb prototypes: an independent heavy input and a named dash attack (both behind tuning flags; the heavy touches `InputFrame` and the replay format, so it is prototyped here and committed only once).
- **Why now:** the single biggest unknown; it redirects everything downstream. The heavy question specifically shapes the boon pool (heavy-triggered payoffs are currently gated behind finishing a chain) and must be answered before Phase 4 authors twelve boons around the verb set.
- **Work:** playtest build (deploy + telemetry: metrics summary, event log, input log, per-room damage sources, survey); 5–8 players × 3+ runs; prototype flags; findings doc; tuning pass from findings.
- **Acceptance:** ≥5 recorded sessions; players distinguish the three enemy roles, explain their deaths, and use quick/heavy deliberately; the heavy/dash question has a written verdict; every score in §C.2 re-evidenced with human data.
- **Out of scope:** building new systems to fix playtest findings — log them into Phases 2–6.

### Phase 2 — The run spine (rooms as data, route, resume)
- **Objective:** a run that varies and survives a refresh: generated route over data-defined rooms, map overlay, node-boundary save.
- **Why now:** unlocks realm authoring, replayability, and anticipation — three of the biggest C.2 deficits — with one structural extraction.
- **Work:** `RoomSpec`/layout-registry extraction (§I); fixed-topology route generation into `RunState.map`; exits-phase map overlay (pad-navigable); RunState serialization at node boundaries + resume; route history in summaries.
- **Acceptance:** existing slice reproducible as data (hashes re-pinned once); 6–7-node runs with choices at ≥3 depths; every seeded route reaches Minos (validated by the manual matrix); refresh mid-run resumes at the current node in <2 s; two consecutive same-URL runs differ in most rooms.
- **Out of scope:** realm dressing; arbitrary procedural graphs; secret branches.

### Phase 3 — Economy and the utility node
- **Objective:** power-vs-safety-vs-future choices, and death that still banks something: obols, Remembrances, one shop, one mystery event.
- **Why now:** depends on Phase 2's route (the utility node needs somewhere to live); must precede Phase 4 (the reroll unlock spends Remembrances).
- **Work:** obol drops + HUD counter; Remembrance awards (depth- and first-time-weighted) surviving death; shop node (heal / +max HP / boon offer); *The Unburied* mystery event (health / obols / Remembrance tradeoff); run summaries show both currencies.
- **Acceptance:** shop-versus-mystery reads as a real route tradeoff in playtests; the kite bot completes runs including a purchase, deterministically; death banks bounded Remembrances without changing combat numbers; all economy values in `tuning.ts`.
- **Out of scope:** second shop type, currency conversion, price scaling systems.

### Phase 4 — Build depth (statuses, boons, deities, the Smith's unlock)
- **Objective:** builds that diverge and rewards that feel like meetings: Burn joins Brand, ~12 boons under two embodied gods, one hidden duo, the reroll unlock.
- **Why now:** the verb-set verdict (Phase 1) and reward tables (Phase 2) and Remembrances (Phase 3) are all inputs to it.
- **Work:** generalize Brand's fields into fixed status slots; add Burn; rebrand the existing six boons under the two god identities; author 4–6 new boons on Burn/heavy/dash/obols; one duo; deity portrait + name + vow line on the reward screen; the Smith sells the reroll (removing the `storage.ts:29` clamp, `MetaStateV2` + migration).
- **Acceptance:** every boon behavioral, none a bare percentage; three picks form at least three recognizably different build identities; deterministic offers still honor door promises; status stacking/expiry unit-tested; reward screen shows a god; a fresh profile can earn and buy the reroll and use it next run.
- **Out of scope:** rarity, stacking economies, third status, boon removal.

### Phase 5 — Realm identity (Greek)
- **Objective:** the run reads as *a place*: the five named spaces, palette/material/audio package, enemy recasts, the Oath-Bound elite, two encounter modifiers.
- **Why now:** content lands on the Phase 2 spine and Phase 4 systems; art identity is the historically slowest loop (the gauntlet's 11-round arena stall) so it gets its own phase with timeboxes and the `ART_DIRECTION.md` §11 gates. **Settle the realm contradiction first** — §9 sketches Duat/Niflheim/Mictlan and explicitly defers Greek as the one realm that would invite a Hades comparison, yet Greek is the realm that shipped. Resolve that, then write the §9 entry for whichever way it lands.
- **Acceptance:** players identify the realm without reading its title; blind-critique protocol on three exhibits (a combat room, the utility node, the boss arena); the teaching-loop rule holds (the elite is met alone before it joins formations); both modifiers reachable and bot-completable.
- **Out of scope:** second realm; signature set pieces beyond the Hall of Minos.

### Phase 6 — Minos
- **Objective:** a climax that tests learned skills: the Warden rebuilt as Minos, Judge of the First Gate — three attacks, a recombining second phase, an introduction beat.
- **Why now:** it inherits the realm package and the proven verb set; a boss built earlier would be tuned against a moveset still in flux.
- **Work:** keep the slam cycle as one attack; add an aimed lane/verdict attack and judgment zones that re-shape safe space; phase two recombines rather than accelerates; arena imagery (the scales); intro beat and defeat sequence; boss audio state.
- **Acceptance:** every attack tests a named learned skill (spacing, dodge timing, bolt-cutting, heavy commitment); deaths are explainable in playtests; phase two changes decisions, not just speed.

### Phase 7 — Shell, hardening, acceptance
- **Objective:** it opens, pauses, saves, and remembers like a real game — and the *milestone* is proven, not just its parts.
- **Work:** title/loading/settings/credits; abandon-run; gamepad parity + prompts on every overlay with golden screenshots in CI; full browser smoke of both victory and death paths; seeded route matrices; save-corruption recovery; controller pass; performance captures; accessibility basics (volume sliders, reduced effects, separate shake/flash toggles); **cultural/writing review of all Greek material**; final human acceptance round.
- **Acceptance:** a pad-only player goes title → run → death → title without a keyboard; default URL completes victory and death golden paths in CI; no terminal seed exists; human acceptance gates from §E's 90+ description are individually checked.

**Continuous (all phases):** combat polish backlog — authored clips for Lampad/Empusa/Minos to the hero/Hoplite standard, audio listening pass, real-hardware latency spot-check; hold VFX where it is.

---

## G. First Greek Realm Plan

### G.1 Route structure — the map question, answered

**Recommendation: a shallow generated route from fixed topology templates, presented through the existing physical doors, with a five-second map overlay between fights.** Not pure Hades doors, not a full Spire map screen. (Both plans that examined this repo independently converged on exactly this hybrid.)

- The room-to-room *moment* stays what the slice already proves: clear the room, doors unseal, walk through the one you choose. Combat flow is never interrupted by a scene change; the door marks keep their promise semantics (`rewards.ts:34`).
- The *planning* layer comes from showing the generated route (depth 6–7, width 2–3) in the `exits` phase overlay: the path so far, the next doors' node types and reward families — node type and family are revealed, exact contents and modifiers stay hidden. Anticipation and strategy without a second game mode.
- **Why not pure Hades doors:** with no visible route, choice collapses back to "which reward next" — the slice already has that and §C.2 shows it isn't enough anticipation.
- **Why not a full Spire map:** a separate map scene is a second UI surface to build and pace, and at 30–90 s per room the plan horizon is short enough that revealed-type visibility captures nearly all the planning value at a fraction of the cost.
- **Generation is template selection, not graph invention:** a handful of validated fixed topologies with eligible node variants filled by the gameplay stream. Deterministic, hashable, serializable (resume-ready by construction), and CI-validatable for boss reachability. The static slice graph remains as a test fixture.

### G.2 Spaces, nodes, and unpredictability (and why these counts)

- **Depth 6–7** (entry + 4–5 + Minos): at 45–90 s per fight plus beats, a run lands at 8–12 minutes — dense-not-long, and long enough for three boons plus economy decisions to compound.
- **The five named spaces:**
  - **The Acheron Gate** — entry combat; the recast roster taught in its simplest pairing.
  - **The Field of Asphodel** — open arena favoring movement and the Empusa's dash lanes; telegraphed flame vents as the realm's one hazard.
  - **The Lethe Cistern** — tight line-of-sight room favoring Lampad pressure and bolt-cutting.
  - **Charon's Landing** — the shared utility vignette, dressed as shop or as the Unburied's mooring.
  - **The Hall of Minos** — the boss arena, judicial imagery, the scales.
- Plus **2–3 combat-layout variants** of the three combat spaces, so consecutive runs differ in most rooms without demanding ten new authored floors. This is the honest minimum; if playtests report room fatigue, variants are cheap to add on the layout registry.
- **Every run contains:** exactly one utility node (shop **or** mystery — the exclusivity *is* the tradeoff), exactly one elite before Minos, hazard vents in at most one room.
- **Unpredictability, three tiers, no event machinery:** one common modifier (staggered reinforcements — exists in the wave grammar today), one uncommon modifier (the Oath-Bound joins a normal encounter, door marked with an improved reward), one authored mystery (*The Unburied* — a shade begging passage: pay obols for a blessing, give a Remembrance for a greater one, or refuse and be hunted into the next room). A weighted, deterministically eligible pool. Legendary-event infrastructure is explicitly deferred.

### G.3 Enemies and the boss

Keep brute/caster/charger *behavior* — recast their bodies and names: **Fallen Hoplite** (committed melee, heavy-punishable), **Lampad** (underworld-flame lanes, cuttable bolts), **Empusa** (orbit and dash-line pressure). Behavior is proven; identity is what's missing.

- **One elite, not a fourth archetype: the Oath-Bound Hoplite.** Frontal guard that breaks to a heavy or a status proc, not extra health — it showcases the heavy (and the independent-heavy verb if Phase 1 adopts it), gives every build a different answer to the same wall, and reuses the Hoplite chassis. A fourth ordinary enemy would add less than this one rule; the support-archetype Lament is the single named stretch if encounter monotony shows up in playtests.
- **Minos, Judge of the First Gate** (rebuilt Warden): three readable attacks — the committed radial judgment slam (exists), an aimed verdict lane/projectile wall, and summoned judgment zones that re-shape safe space. **Phase two recombines those attacks instead of accelerating them**; the current phase-two bolt ring becomes one component, not the whole phase. Introduction beat, defeat sequence, the scales in the arena.

### G.4 Boons, statuses, rewards

- **Two gods embodied**, mapped onto the families the code already has: the blade family becomes a war-god identity, the veil family a psychopomp identity (Ares-shaped and Hermes-shaped without committing to names yet — portraits, epithets, one vow line each). The existing six boons rebrand cleanly (Cleaving Grace / Ashen Edge / Final Judgment under war; Between-Step / Mirror Steel / Afterimage under passage).
- **4–6 new boons** drawn from the new surface area: Burn appliers and payoffs, dash-attack riders, heavy-commitment rewards, an obol-greed vow. Every one behavioral; zero bare percentages. **One hidden duo** (requires boons from both gods) as the "I didn't know the sword could do this" ceiling.
- **Statuses: Brand + Burn.** Two is the smallest set that forces the framework out of Brand-specific fields and makes the new boons interesting; Chill is deferred. Both wear one indicator language and respect the reserved danger-tell band.
- **Reward vocabulary at doors:** boon (by god) / obols / heart / utility / boss — the power-vs-safety-vs-future economy the loop audit found missing, plus the Smith's reroll once unlocked.

### G.5 Mythology bar

Rooms named from the geography (§G.2), events and barks written by someone who assumes the player might actually love this material, no "skeleton dungeon with a Greek texture pack." Two gates before shipping: the project's own blind-critique protocol next to Hades' Greek rooms on three exhibits, and a **source-led cultural/writing review** — a discipline worth installing on the first realm precisely because later realms (Aztec, Buddhist, Yoruba…) will demand it.

---

## H. Combat Quality Plan

Combat is the strongest layer; the plan is to *hold* it while the game grows around it, answer one open design question, and close the residue:

1. **A/B the independent heavy (Phase 1).** Today the heavy exists only as chain-swing three (`beginAttack` → swing 0; no heavy field in `InputFrame`). That makes every heavy-triggered boon a chain-completion reward and removes "open with the committed hit" as a choice. Prototype a dedicated heavy input behind a flag and let humans decide. If adopted: it changes the input schema and replay format — commit once, re-pin once. If rejected: document why, because the question will return with weapon two.
2. **Name the dash attack.** The dodge-to-attack cancel already exists mechanically (`dodge.attackCancelFrom`); give it identity — its own pose accent, sound, and boon hook — so it becomes a verb players *know* they have, at near-zero sim cost.
3. **Human tuning A/B (Phase 1):** roll landing curve, perfect-dodge window (window before depth), heavy commit threshold — the combat audit's protocol, finally run with humans.
4. **Elite as combat showcase:** the Oath-Bound's guard is the heavy's reason to exist in room play, not just against Brutes.
5. **Boss attacks test learned skills:** each Minos pattern maps to a named verb (spacing, dodge timing, bolt-cutting, heavy commitment); phase two recombines.
6. **Authored clips for Lampad, Empusa, Minos** to the hero/Hoplite standard (the commit-#5 pattern is proven; strips pinned at state boundaries).
7. **Readability at presentation scale:** verify actor/telegraph legibility at real window sizes — small bodies compete with the room and HUD in busy frames; statuses (Burn) must join Brand's indicator system without a third visual grammar.
8. **Audio listening pass:** the one dimension never validated by a human ear; validate ducking, the tell band, and pause behavior together.
9. **Latency spot-check on real hardware** (keydown→photon p95 < 25 ms at 60 Hz) now that the frame path is single-owner.
10. **Hold the line:** no new VFX systems, no pool raises, no pattern engine until a Phase 5–6 encounter measurably needs them; no ultimate/summon until the base verbs are exceptional. New combat content must pass the existing feel gates: telegraph → commit → punish window, attributable damage, per-action screen caps.

---

## I. Content and Systems Architecture

The rule that has served this repo: **extract an abstraction at its second consumer, prove it by reproducing the first consumer bit-for-bit (or re-pin once), never build it speculatively.** Applied:

- **`RoomSpec` + layout registry** (second consumer: the first Greek space) — layout id → authored builder, spawn waves, exit slots, reward table id, dressing preset id. `rooms.ts`'s static graphs become fixtures; `arena.ts` builders become registry entries.
- **Route generation in `RunState.map`**: fixed topology templates + eligible variants, filled by the gameplay stream at `startRun`; serialized trivially (it's data + seed), hashed, CI-validated for boss reachability, safe spawns, and legal rewards. Doors bind to edges.
- **`StatusDef` + fixed per-enemy status slots** (second consumer: Burn) — id, stacks, expiry, tick hook, on-consume hook. Brand's fields (`brand`, `brandTicks`) generalize into a small fixed array — pooled, no per-tick allocation, hash-covered.
- **Boon triggers** stay centralized and typed; add hook points only when a boon needs one (`onWeaponHit` exists; `onKill`, `onRoomEnter`, `onStatusApplied` as the new pool demands). Data-driven boon authoring waits until the pool passes ~20.
- **`RealmPackage`** (single consumer for now — keep it a folder convention, not a framework): palette/tile indices, dressing presets, enemy pool, god pool, boss id, music set. The presenter already swaps arenas per room; realm is one more lookup.
- **`WeaponDef` — deferred with the bow.** The extraction and its second consumer travel together (next milestone); extracting now would be speculative by this section's own rule.
- **Run vs meta state** — the boundary is already correct (`session.ts`); extend, don't rework: `RunState` gains `obols`, `map`/route, current node; `MetaStateV2` gains `remembrances`, real `unlocks` (reroll, vessel), `smithState`, with a v1→v2 migration and the load clamp removed. Determinism rule stays: meta is read once at world construction and recorded into replays (already true — `replay.ts` stores the meta snapshot).
- **Node-boundary save/resume**: serialize (build version, meta, RunState) at every reward/door boundary; resume constructs the world and re-enters the current node fresh. Rooms rebuild deterministically, so no mid-combat frames are ever stored; cross-version resumes are refused. (The replay machinery remains the *debug* reproduction tool — full-run input logs for bug reports — but the product save is the small schema, which survives tuning changes that would invalidate a replay.)
- **Hash the arena's `solid` mask** (not decoration) so collision-relevant builder changes surface at tick 0 instead of via delayed trajectory divergence; the cosmetic exclusion in `hash.ts:19-21` stays for everything else.

---

## J. Presentation and Art Plan

Highest perceptual leverage per unit of work, in order:

1. **God framing on the reward screen** — portrait, name, epithet, vow line. Turns the slice's weakest *felt* moment ("anonymous card") into its signature moment. The 480×270 answer: a half-height portrait panel sliding over the darkened arena — the existing overlay already owns the screen. Restrained arrival, no cutscene.
2. **Title screen** — one painted-in-pixels key image, three options, the game's name. First impression of temperature; currently the game boots into a fetch.
3. **Map overlay** — the five-second route beat; shares the overlay/gamepad work with rewards.
4. **Greek palette + dressing variant** — recolor and re-dress the four proven builders per `ART_DIRECTION.md` rules before authoring wholly new layouts; write the missing Greek §9 entry first; hold every round to the §11 computable gates and timebox environment-beauty iterations (the 11-round arena stall must not repeat).
5. **Enemy recasts + clip completion** (Fallen Hoplite dressing on the authored Brute set; Lampad/Empusa/Minos to the same standard) — identity and feel in one pass.
6. **Semantic asset ids** — as the recast assets land, name them (`greek.hoplite.attack`, not atlas index 37) in a validated manifest with clips, pivots, and timings; new content stops accruing numeric-index debt, existing content migrates opportunistically.
7. **Summary parity** — death and victory as mirrored cards: cause, weapon, build, route, obols/Remembrances, depth, time.
8. **New surfaces are new modules** — title, map, shop, barks, dialogue each get their own overlay module; `hud.ts` (1,404 lines) stops growing.
9. **The Smith's presentation** — one authored character sprite + bark box in the hub; the barks are the whole narrative budget of this slice.

---

## K. Agent-Native Development Plan

The harness is already the repo's superpower; the gaps are operational:

- **CI** (Phase 0): typecheck, 184+ tests, replay-hash matrix, 100-seed headless traversal of `loop`, one Playwright smoke asserting golden-path states and zero console errors. Every PR, no exceptions — this codebase's determinism makes CI unusually cheap and unusually trustworthy. Phase 7 extends it to both victory and death golden paths.
- **Bot navigation fix**: route bots to exits via the enemies' tile search; make "all seeds traverse" an acceptance gate forever (it currently fails on seeds 13/23/37 of 60 — bot defect, not graph defect, but it blocks the matrix).
- **Route validation**: every generated topology template is checked for boss reachability, legal rewards, safe spawns, and valid door geometry — at build time, not at play time.
- **Debug API additions**: `grant(boonId)`, `giveObols(n)`, `giveRemembrances(n)`, `gotoNode(id)`, `forceOffer([ids])`, `forceEvent(id)`, `inspectSave()` — reward/event/economy work needs the same pose-a-frame ergonomics combat already has.
- **Golden screenshots** for overlays (title, reward, map, shop, summaries, pause) diffed at fixed seeds/ticks once the parked workflow is separately activated — the presentation layer finally gets regression cover.
- **Playtest telemetry**: `metrics.summary()` + event log + survey auto-bundled per session; sessions replayable by construction (store the input log). Human evidence becomes as citable as bot evidence.
- **Asset-manifest validation** as semantic ids land: missing clips, invalid rectangles, pivots, naming.
- **Doc discipline**: `HARNESS.md` is the agent contract — CI greps its flag table against `replay.ts` so it can never drift again; stale planning docs carry a status banner; add a conventional README describing the playable product.
- **Determinism guardrails**: hash coverage extends to statuses, obols, route, and resume state the moment each lands (plus the arena `solid` mask, §I); any new sim module ships with a replay fixture.

---

## L. Risk Register

| # | Risk | Likelihood | Impact | Evidence | Mitigation |
|---|---|---|---|---|---|
| 1 | **The slice isn't fun for humans** (comprehension, difficulty, or boon excitement misses) | Medium-high | Critical | Zero human sessions on record; all validation is bots/strips; naive bot dies 20/20, kite wins 57/60 — the skill gradient exists but tells us nothing about *enjoyment* | Phase 1 gate before any spine/content work; telemetry + replayable sessions; tune before building |
| 2 | **Realm art reads as a Bardo reskin, or stalls** | Medium-high | High | 11 gauntlet rounds lost on one empty room; every current room and character shares one visual language | Greek §9 in the art bible first; variant-of-proven-builders before new layouts; §11 computable gates; timeboxed rounds; blind critique on three exhibits only |
| 3 | **Scope explosion from the vision** (pets, eggs, artifacts, summons, second weapon, economies) | High | High | The vision doc itself; every prior audit flagged it; the cross-review's leaner counts won several arguments against v1 of this plan | §E "does not exist" list + §M deferrals are the contract; one-of-each architecture tests only where cheap (gods yes, reroll yes, artifact no, pet no) |
| 4 | **Content-scaling debt bites mid-milestone** (enemy scratch fields, geometry-in-code) | Medium | Medium | `Enemy` field reuse; `RoomKind` builders; `player.ts` arm branches (deferred with the bow) | Extract-at-second-consumer schedule is *inside* the task list (task 3); never extract ahead of it |
| 5 | **Determinism/replay discipline erodes** as UI, meta, resume, and economy land | Low-medium | High | Every past addition kept hashes green — but route/resume/economy touch more surface than boons did | Hash + fixture per new sim module; CI replay matrix; meta read-once rule enforced in review; node-boundary saves keep combat out of serialization |
| 6 | **Browser/regression blind spots** (audio contract, gamepad, resize, storage) | Medium | Medium | 184 tests are Node-only; pause/audio bug already shipped | Phase 0 smoke + golden screenshots; listening pass in §H |
| 7 | **Boss regresses to a bigger health bar** | Medium | High | The Warden today is one slam cycle + one ring; that pattern under time pressure becomes "more HP" | Three-attacks + recombining-phase acceptance criteria in Phase 6; each attack maps to a named learned skill |
| 8 | **Presentation monoliths slow iteration** (`hud.ts` 1,404 lines, `presenter.ts` 962, `audio.ts` 967) | Medium | Medium | File sizes; every overlay lands in the same two files | New surfaces are new modules (§J.8); split `hud.ts` opportunistically when touched |
| 9 | **Mythological material lands superficial or insensitive** | Medium | High | The vision spans living and historical traditions; nothing in the pipeline currently reviews cultural content | Source-led writing pass + cultural review gate per realm, installed on realm one (§G.5); never copy living ritual into combat set dressing |

---

## M. Explicit Deferrals

Compelling, and not this milestone. Each waits for a named trigger:

1. **The bow as a production weapon + the `WeaponDef` extraction** — the headline of the *next* milestone, once the First Gate's verb set is human-proven; the debug `bow` scenario keeps the architecture honest meanwhile.
2. **Pets & eggs** — after the realm ships; needs its own milestone (ally AI, arbitration, balance). The egg loop (discover → feed → hatch) is designed enough to slot in later.
3. **Artifact/keepsake slot and leveling tiers** — the Smith's reroll proves the meta boundary without a loadout runtime; artifacts return when there is a loadout screen worth having.
4. **God summon / ultimate meter** — a fourth combat verb deserves a combat-audit cycle of its own, on top of a proven realm.
5. **A third status (Chill)** — Brand + Burn prove the framework; add Chill when a weapon or realm needs the slow.
6. **Second realm (and realm-choice branching)** — after the Greek realm passes its blind critique; the other gates are literally set dressing until then.
7. **Duo/legendary/rarity economies** — one hidden duo is the proof; economies need ≥20 boons to mean anything.
8. **Heat / pact modifiers** — needs victories to be routine first.
9. **Armor / overshield** — HP + vessels is legible; add layers only if playtests show the damage economy needs them.
10. **Projectile-pattern engine + pool raise** — profile-gated, per the combat audit; no current encounter needs it.
11. **Contact-damage revisit, scrolling camera, resolution change** — the fixed decisions stay fixed until a concrete encounter design breaks them.
12. **Secret rooms and legendary-event infrastructure** — the three-tier modifier pool (§G.2) is the seed; machinery follows content demand.
13. **Remapping, localization, colorblind modes, touch** — after the slice has an audience beyond playtests (volume + reduced-effects + shake/flash toggles ship now; the rest is post-slice).
14. **Dialogue system / editor** — barks only until narrative has a second character.
15. **Full introductory cutscene** — a short in-engine arrival beat carries the fiction this milestone.
16. **Online accounts, cloud saves, achievements** — not before there is a game.

---

## N. The Next 10 Tasks

> **Ordering superseded** by the Revision 3 table in the STATUS block (2026-08-28): tasks 1, 2
> (prototype half), 7, and the boss shipped in PR #9; the remainder runs as PRs 1–7 there. The task
> specs below remain the definitions of record.

In exact priority order. Each is scoped to be one implementation task/PR. Format per task: **what · why · systems · impact/complexity · depends on · type · done when**.

**1. Truth pass: seeds, summaries, pause-audio, bots, CI, docs.**
Mix `meta.attempts` into the run seed (`session.ts:88`); record the killing source in the sim and show weapon + boons + true killer on the death card with a minimum beat; make pause own audio + visibility loss; fix slice-bot exit navigation via the enemies' tile search; add manual gates (typecheck, tests, replay hashes, 100-seed traversal, one golden-path browser smoke) and park the workflow template pending authorization; sync `HARNESS.md` flags and banner the stale audits. · Every later decision is measured through these instruments, and Phase 1's testers need variety and honest feedback. · sim/session, combat, bots, audio, CI, docs. · High impact / low complexity. · Nothing. · Fixes + tooling. · **Done when** two fresh loads produce different first-run offers, 100/100 seeds traverse, a scripted death shows the true killer and full build, pause silences audio ≤100 ms, and the manual gates are green.

**2. Run the human fun gate with the heavy and dash-attack prototypes.**
Playtest build (telemetry bundle: metrics, event log, input log, survey) + an independent-heavy input and a named dash attack behind tuning flags + 5–8-player × 3-run protocol + findings doc + tuning pass. · The largest unknown in the project, and the verb-set verdict shapes the boon pool before it is authored. · deploy, telemetry, input prototype, tuning, docs. · Critical / medium. · Task 1. · Validation + prototype. · **Done when** ≥5 session bundles exist, players distinguish enemy roles and explain deaths, the heavy/dash question has a written verdict, and the tune list is merged.

**3. Extract rooms-as-data (`RoomSpec` + layout registry).**
Layout builders registered by id; graph/waves/rewards as data; static slice graph becomes a fixture. · The single extraction that unlocks route generation, realm authoring, and layout variety. · sim/rooms, arena, waves, tests. · High / medium. · Task 1 (CI safety net). · Foundational. · **Done when** the existing slice reproduces bit-for-bit from data (or one re-pin) and a new room ships without touching sim logic files.

**4. Generate the route from fixed topology templates, with the exits-phase map overlay.**
Seeded 6–7-node route (entry → combat branch → utility → combat → elite → Minos) in `RunState.map`; doors bind to edges; overlay shows path + next node types and reward families, pad-navigable; CI validates every template for reachability. · Converts one authored branch into a planned route — anticipation, agency, replay variety in one move. · sim (route gen), render (overlay), HUD, CI. · High / medium. · Task 3. · Foundational. · **Done when** two same-URL runs differ in most rooms, choices appear at ≥3 depths, no seeded route can strand, and the overlay works on gamepad.

**5. Node-boundary save/resume.**
Serialize (build version, meta, RunState incl. route/node/hp/boons) at every reward/door boundary; resume re-enters the current node fresh; refuse cross-version saves; `inspectSave()` in the debug API. · A 10-minute run must survive a refresh, and the schema doubles as the run-state contract for everything after it. · sim/session, storage, boot, debug API. · High / medium. · Task 4. · Foundational. · **Done when** a mid-run refresh resumes at the current node in <2 s, run-reset still clears every temporary effect, and corrupted saves fall back to the Bardo without data loss.

**6. Obol + Remembrance economy with the utility node.**
Obol drops + HUD counter; Remembrances banked home through death and victory; shop node (heal / +max HP / boon); *The Unburied* mystery event; both currencies on run summaries. · Adds the power-vs-safety-vs-future choice vocabulary and makes death bank bounded progress without touching combat difficulty. · sim (economy, node handlers), HUD, audio, events. · High / medium. · Task 4. · Small system cluster. · **Done when** the kite bot completes runs including a purchase deterministically, shop-vs-mystery reads as a real tradeoff in playtests, and all values live in `tuning.ts`.

**7. Status framework + ~12 boons + god framing + the Smith's reroll.**
Generalize Brand into fixed status slots and add Burn; rebrand the six boons under two embodied gods and author 4–6 new (Burn/heavy/dash/obol hooks) + one hidden duo; portrait + name + vow on the reward screen; the Smith sells the reroll for Remembrances (`MetaStateV2` + migration, clamp removed). · This is where builds diverge, rewards become meetings, and meta progression changes play for the first time. · sim (statuses, boons, rewards, session), reward overlay, hub, art. · High / medium-high. · Tasks 2 (verb verdict), 6 (Remembrances). · Foundational + polish. · **Done when** three picks form three recognizable build identities, statuses are unit-tested, the offer screen shows a god, and a fresh profile can earn, buy, and use the reroll.

**8. The Greek realm package.**
Greek §9 in `ART_DIRECTION.md`; palette/material/audio package; the five named spaces + 2–3 combat variants on the layout registry; Fallen Hoplite / Lampad / Empusa recasts; the Oath-Bound Hoplite elite (guard breaks to heavy or status); flame-vent hazard; two encounter modifiers. · The run must read as a place, and the elite gives the heavy its room-play showcase. · content packs, render, audio, enemies. · High / high. · Tasks 3, 7. · Foundational content. · **Done when** players identify the realm unlabeled, the elite is taught alone before joining formations, and three exhibits pass the blind-critique protocol.

**9. Minos, Judge of the First Gate.**
Rebuild the Warden: keep the slam, add a verdict lane attack and judgment zones, phase two recombines rather than accelerates; intro beat, defeat sequence, the scales, boss audio state. · The run needs a climax that tests learned skills rather than a larger health bar. · boss AI, arena, presentation, audio, narrative. · High / medium-high. · Tasks 2 (verbs), 8 (realm). · System + polish. · **Done when** each attack tests a named learned skill, phase two changes decisions in playtests, and deaths are explainable.

**10. Shell v1 + hardening + acceptance.**
Title/loading/settings/credits; abandon-run; gamepad parity + prompts on every overlay with golden screenshots; browser smoke of both victory and death golden paths; save-corruption recovery; controller and performance passes; volume + shake/flash toggles; cultural/writing review of all Greek material; final human acceptance against §E's 90+ checklist. · The difference between a prototype and a game you hand to someone — proven as a whole, not as parts. · main, overlays, audio, input, CI, review. · Medium-high / medium. · Tasks 1–9 (it wraps them). · Shell + hardening. · **Done when** a pad-only player goes title → run → death → title without a keyboard, both golden paths run in CI, no terminal seed exists, and the acceptance gates are individually checked.

---

## Final principle

The order above is built so that the moment of truth arrives as early as possible: after task 2, a human being either says *"I understand what Bardo is"* about the combat and the loop — or tells us exactly why not, while the cost of changing course is still one phase, not seven. Everything after that point spends effort only on what survived contact with a player.
