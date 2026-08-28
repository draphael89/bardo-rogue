# Bardo Vertical Slice Plan

**Date:** 2026-08-28
**Audited revision:** `4d44311` (`main`), branch `claude/bardo-vertical-slice-audit-6c7inj`
**Companion documents:** `VISION.md` (the full-game vision), `COMBAT_FEEL_AUDIT.md` (combat deep audit at `1ef5b18`), `ART_DIRECTION.md` (the art bible), `AUDIT_REPORT.md` / `EXPANDED_GAME_PLAN.md` (historical audits, both now stale — see §A).

This document is the unified plan requested by the game-loop audit (Appendix B) and the vertical-slice addendum: one verdict, one gap analysis, one rank-ordered list of what to do next. All claims were re-verified against the current tree, not carried forward from earlier audits.

**Evidence base for this audit:** full read of `src/sim/` (all 30 files), the entry point, input, tuning, and the render/audio surfaces; `pnpm typecheck` green; `pnpm test` green (**184 tests, 14 files**); fresh headless runs of the production loop (`slice-kite` seeds 1–60, `slice-naive` seeds 1–20); five Playwright screenshots along the golden path (Bardo, Threshold fight, Veiled Crossing fight, reward offer, Warden fight), reproducible via:

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

**How far from the desired slice:** the vision's vertical slice asks for an opening screen, a hub with an NPC and visible meta progression, one realm with authored mythology, node-based route choice, run and meta currencies, a shop, statuses, deity-framed boons, and a boss — on top of exceptional combat. Today the game has the combat, the loop skeleton, four encounters, six boons, one branch, one boss, and counters that persist but change nothing. That is roughly **the bottom half of the slice built to a high bar, and the top half absent**.

**What is already strong:** the deterministic sim and replay/bot/screenshot harness (the single best asset in the repo); the combat feel chain; the session/run/room state boundary; the physical, menu-free town verbs (rack, doors, marked exits); the behavioral six-boon system with its one-hook composition point (`resolveWeaponOnHit`); death-as-return in the fiction; a cohesive authored look for the one environment that exists.

**The biggest risks, in order:**
1. **Fun is unproven by humans.** Every number in this repo was validated by bots and frame strips. Zero recorded human sessions. The vision's own gate — "nothing is built on a layer that has not yet proven fun" (`VISION.md` §5) — is unmet at the layer everything now sits on.
2. **The first run repeats after every reload.** `startRun` derives the attempt seed from `world.seed` (URL, default 1) and in-memory `world.returns`; persistent `meta.attempts` is not mixed in (`src/sim/session.ts:88`). Day-two players replay day-one's exact run.
3. **A run is one authored graph, not a system.** Room geometry is four hard-coded builders keyed by `RoomKind` (`src/sim/arena.ts:35`, `112`); the slice graph is literal TypeScript (`src/sim/rooms.ts:56-107`). Fine for six rooms; a wall for a realm.
4. **No shell.** No title, no settings, no pause-owned audio, no abandon-run, keyboard-only overlay instructions. It reads as a dev build the moment the player is not fighting.
5. **Scope gravity.** The vision names pets, eggs, artifact tiers, god summons, armor, two economies, legendary events. Building even half of those now would bury the fun proof under systems. Section M is the protection.

**The next milestone** (defined precisely in §E): **"The First Gate"** — one Greek realm slice on the existing loop: title screen → Bardo hub with one NPC and one visible permanent unlock → the Greek gate → a generated 7-node run (combat / elite / shop / event / rest / boss) → obol economy → 12 deity-framed boons + 3 statuses → recast judge boss → return. One weapon at run start, with the bow as the first meta unlock. Pets, eggs, artifact tiers, summons: explicitly deferred.

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

---

## C. Vision-to-Reality Gap Analysis

Grades are 0–100 for **what a player experiences today** (not what the architecture promises), calibrated the way the project's own audits demand: 90+ ships next to Hades/Gungeon without excuses. Two tables: the vision's pillars, then the game-loop dimensions from the loop audit.

### C.1 Pillars

| Pillar | Score | What holds it below 90 |
|---|---:|---|
| Combat | **80** | Human tuning unproven; moveset is one weapon + no special; Caster/Charger/Warden lack authored clips; encounter density never stresses the tell hierarchy. The chain itself (input → contact → recovery) is near the bar. |
| Player (controls/movement/dodge) | **82** | The remaining gaps are validation gaps (latency on real hardware, A/B of landing/perfect-dodge windows), not design gaps. |
| Enemies | **68** | Three archetypes + one boss are excellently authored questions, but three archetypes cannot fill a realm; no elites, no support enemy, no pattern vocabulary beyond aimed bolts, dashes, and one radial ring. |
| Encounters | **60** | Slice rooms are distinct authored questions, but there are four of them, no modifiers, no hazards, no environmental verbs. |
| Hub | **45** | Reads as "home, prepare, depart" — a real achievement in one room — but there is exactly one verb (walk into rack) and nothing that acknowledges your history beyond two counters. |
| Realm traversal | **40** | One two-way branch that rejoins. Marked doors are a genuinely good primitive; there is no map, no route planning, no unknown to anticipate. |
| Progression (run + meta) | **45** | Three behavioral boons per run is real run progression; meta progression is two numbers that change nothing (`storage.ts:29` actively clamps unlocks). |
| Rewards | **50** | Boons are behavioral, deterministic, door-promised — the right foundation. But boons are the *only* reward: no heal, no currency, no artifact, no economy of choosing between reward types. |
| Narrative | **25** | Tone is present (room names, vows, "return with your name"); no character, no dialogue, no reactive line has ever been spoken. |
| Art | **62** | The one environment family is cohesive, moody, authored (verified in screenshots). Everything shares Bardo masonry; no realm identity exists; enemy bodies still lean on Kenney bases + deformation except hero/Brute. |
| Animation | **70** | Hero and Brute authored sets are strong; roll table excellent; the other three enemies and the bow are procedurally staged. |
| VFX | **85** | The contact language (crescent, wounds, cold dodge ring, per-action caps) is the closest thing to shipping quality in the repo. Diminishing returns here — deliberately hold. |
| Audio | **70** | Architecture (buses, ducking, tell band, arbitration) is beyond prototype; content is one synthesized bed; nothing has been validated by listening; pause/audio contract broken. |
| UI/UX | **45** | Combat HUD and reward cards are clean; there is no title, no settings, no gamepad parity in overlays ("A / D OR ARROWS… ENTER" hard-coded — verified in screenshot), no abandon, no volume control. |
| Persistence | **35** | Versioned meta with graceful fallback is correct scaffolding; but the first-run seed repeats every reload (`session.ts:88`), nothing mid-run survives a refresh, and unlocks are clamped. |
| Agent/developer tooling | **88** | Best-in-class for this stage: deterministic replays with pinned hashes, full-loop bots, shot/strip/pose tools, live tuning, metrics. Gaps: no CI, slice-bot exit navigation fails 3–5% of seeds, `HARNESS.md` replay-flag docs drifted from `replay.ts:19`. |

### C.2 Game-loop dimensions (from the loop audit)

| Dimension | Score | What keeps it from 90+ |
|---|---:|---|
| Core gameplay loop | **70** | Complete and legible end to end; but compact (bot: 29–36 s; human: minutes), economy-free, and the first run repeats per reload. |
| Town / home-base clarity | **55** | "This is home, that is the run" reads instantly; nothing else to do or learn there yet. |
| Run startup | **65** | The physical rack beats any menu; one weapon, no loadout dimension, nothing to weigh before departing. |
| Room lifecycle | **75** | Explicit phases, tested transitions, HP handoff, projectile cleanup; `entering` does no work, and geometry/waves are code, not content. |
| Encounter pacing | **55** | Rooms are authored questions with clean arrival tells; the whole run has no valley — three boon screens arrive back-to-back-to-back with no rest, shop, or breath. |
| Room-to-room progression | **45** | One branch, both sides rejoin next room; door marks promise families truthfully; no anticipation deeper than one door. |
| Player choice | **55** | 3 boon picks + 1 route pick per run, family-guaranteed doors are honest; the choice vocabulary is one-dimensional (which boon family). |
| Reward excitement | **50** | The boons themselves change behavior (the bar the loop audit set); the presentation is an anonymous card, and there is never a non-boon option to want. |
| Build diversity | **45** | Six boons, no stacking, two real synergy lines (Brand→Judgment, dodge-primes). Discoverable in ~3 runs. |
| Emergent synergy potential | **60** | `resolveWeaponOnHit` as the single hook for blade/mirror/echo is exactly the right shape — the ceiling is high, the pool is small. |
| Weapon extensibility | **40** | Bow exists and plays differently, but is unreachable in production; weapon logic is `if (armOf(world) === ARM.bow)` branches through the controller and views (`player.ts:68,95,159,182`). |
| Run-state architecture | **75** | Clean boundary, deterministic, explicitly tested (HP handoff, reset paths); schema is minimal and has no serialization/resume story. |
| Death / restart loop | **78** | Death-as-return inside the fiction, fast, with persistent counters — the Hades trick works. Death card omits the build, killer attribution is presentation-inferred, no abandon-run. |
| Meta-progression readiness | **35** | The boundary exists and persists; not one thing a player does changes the next run. |
| Replayability | **40** | Seed repetition on reload + six boons + one branch = runs 4+ feel solved. The *bones* (seeded variation, mirrored formations, family doors) are ready for far more. |
| Sense of anticipation | **45** | Marked doors and the boss silhouette door create real pull; nothing is ever unknown, secret, or rare. |
| **Overall roguelike foundation** | **62** | The loop is proven and the architecture is honest; content breadth, economy, variation, and shell are where a player feels the prototype. |

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
- Boon pool (6 → 12) + deity framing on the existing reward screen.
- Gamepad parity + prompts on all overlays; pause owning audio and visibility loss.
- Docs: `HARNESS.md` replay flags (16 attackHeld / 32 confirm / 64 left / 128 right per `replay.ts:19`), and mark `EXPANDED_GAME_PLAN.md` §1–2 and `AUDIT_REPORT.md` as historical (both describe pre-assembly states).
- Audio content: one realm music bed with layers, on the existing bus architecture.

**Replace (when their second consumer arrives, not before):**
- `if (arm === …)` weapon branching → a `WeaponDef` move-set table, when the bow productionizes (task 9).
- `RoomKind`-keyed geometry builders → an authored layout registry addressed by id, when the Greek room set lands (task 5).
- Generic enemy scratch fields → per-kind state unions, when enemy #5 lands.
- `storage.ts` unlock clamp → real schema-checked unlock list, when the first unlock ships.

**Defer (see §M for the full list):** pets/eggs, artifact tiers, god summon/ultimate, second realm, duo/legendary boon tiers beyond one proof, heat, remapping, localization, projectile-pattern engine + pool raise.

**On the addendum's "one artifact / one pet / one god family as architecture tests":** build the **god family** (deity framing is the heart of the boon fantasy and costs mostly presentation), build **one artifact/keepsake** (a meta-owned run-start modifier is the cheapest possible proof of the meta→run boundary, and the blacksmith needs something to sell), **defer the pet** (an AI-driven ally is the most expensive of the three — pathing, target arbitration, rendering, balance — and proves the least about the run loop; it deserves its own milestone after the realm exists).

---

## E. Vertical Slice Definition — "The First Gate"

The player's sentence when it ships: *"I wake in the Bardo, take my blade from the rack — or the bow I earned last week — step through the Greek gate, plan a route through six chambers I half-recognize, spend obols at a shade's shop, build a sword that brands and detonates, cut down a Judge, and come home with something permanent."*

### Exists when complete

**Shell**
- Title screen: game name, *Descend* (continue meta) / *Settings* / *Credits*; loading state; failure state that isn't a stack trace.
- Pause that owns sim + audio + focus loss, with *Resume / Abandon Run / Settings*.
- Settings: music/SFX volumes, reduced effects, fullscreen — keyboard and gamepad operable.

**Hub (the Bardo)**
- Exactly as today, plus: **one NPC** (the Smith — a shade who reforges what the dead carried) with 4–6 lines of stateful bark text (first meeting, after first death, after first victory, after each unlock); **obol counter**; **one gate** (the Greek door replaces the plain threshold seal); the rack shows the bow slot filling when unlocked.
- Meta progression visible in the room: the bow on the rack, one banked vessel (+1 max HP unlock), the keepsake hook on the wall.

**Run structure (Greek realm)**
- A generated per-run node graph, depth 7: entry combat → five middle nodes drawn from {combat, elite, event, shop, rest} under constraints → Judge. Chosen through the existing physical doors; a map overlay in the `exits` phase shows the route so far and the next two choices with their marks. (Position and rationale: §G.1.)
- Run currency (**obols**) from kills and room clears; one shop node (3 offers); one rest node (heal or bank).
- 10–12 authored combat layouts; 2 authored events; elite = enemy modifier, not new art.

**Build system**
- 3 statuses (Brand + burn + chill) in one framework with one shared indicator language.
- 12 boons across **two embodied deities** (blade-war and veil-passage identities), portrait + name + one line on the existing reward screen; one hidden duo boon as the synergy ceiling proof.
- The bow as a production weapon behind the first meta unlock; `WeaponDef` table replaces arm branching.

**Enemies**
- Existing three + Warden recast with Greek names/dressing; **two new archetypes** (a shielded front-liner, a support/lament enemy — §G.3); elite modifiers; the Judge gains one additional pattern.

**Persistence**
- Attempt seeds vary across reloads; meta = attempts, victories, obols banked, unlocks (bow, vessel, keepsake), Smith dialogue state. Deterministic mid-run resume via stored (seed, meta snapshot, input log) fast-forward — the sim replays ~36k ticks in under a second headless, so a refresh restores the run without a save-schema project.

### Explicitly does NOT exist

No pets or eggs. No artifact leveling (one static keepsake only). No god summon / ultimate meter. No second realm (the other gates are sealed doors in the hub — set dressing, zero implementation). No armor overshield. No duo/legendary system beyond the one hidden duo. No dialogue trees (barks only). No minimap during combat. No heat. No remapping or localization. No touch/mobile. No projectile-pattern engine or pool raise. No procedural room geometry — authored layouts drawn by seed.

### The 90+ version

What this exact slice must feel like to grade 90+: the title screen already tells you the game's temperature. The Bardo is quiet in a way that makes the gate loud. The first fight makes your hands trust the sword within ten seconds — that part exists today. The first boon offer is a *meeting*: a name, a face, a vow, and one of the three cards makes you say "oh, that changes how I swing." The map beat is five seconds long and still produces a plan ("shop after the elite, rest before the Judge"). By room four your sword is not the sword you entered with, and you know it — enemies wear your brands, your dodge leaves an edge behind, and the burst you've been building pays off through a crowd. The Judge kills you the first three times and every death names its lesson. The return home stings and then immediately doesn't: the Smith says something new, your obols bank, the bow is one run closer, and the gate is still there. You press *Descend* again before you've decided to. Two consecutive runs never share more than half their rooms, and on run five you see an event you had never seen. Nothing anywhere — a menu, a summary, an error — reads as developer text.

---

## F. Prioritized Implementation Plan

Ordering reflects dependency and player value. Phases 0–1 are gates, not features: they make every later decision measurable and honest.

### Phase 0 — Truth pass (small, do immediately)
- **Objective:** every instrument tells the truth; the loop is trustworthy across reloads and seeds.
- **Why now:** cheap; everything later is judged through these instruments; playtests (Phase 1) need seed variety and honest summaries.
- **Work:** attempt-seed fix (`session.ts:88` mixes `meta.attempts`); sim-authoritative death cause + build on the death card + minimum summary beat; slice-bot exit navigation fix; CI (typecheck, tests, replay matrix, 100-seed headless traversal, one browser smoke via `pnpm shot` asserting the golden path states); doc sync (`HARNESS.md` flags, stale-audit banners).
- **Acceptance:** reload → different first-run offers; 100/100 seeds traverse; CI green on PR; death card shows weapon + boons + true killer.
- **Out of scope:** any new content.

### Phase 1 — The fun gate (human playtests)
- **Objective:** structured human evidence on the current slice: comprehension (rack, doors, marks, damage attribution), first-death timing, boon excitement, synergy discovery, Warden difficulty, voluntary replay.
- **Why now:** the single biggest unknown; it redirects everything downstream (encounter tuning, boon pool shape, onboarding needs). The project's own order-of-proof demands it.
- **Work:** playtest build (deploy + telemetry: metrics summary, event log, per-room damage sources, session survey); 5+ players × 3+ runs protocol; findings doc; tuning pass from findings.
- **Acceptance:** ≥5 recorded sessions; every score in §C.2 re-evidenced with human data; a written tune list executed.
- **Out of scope:** building new systems to fix playtest findings — log them into Phases 2–5.

### Phase 2 — The run spine (rooms as data, map, economy)
- **Objective:** a run that varies: generated node graph over data-defined rooms, obols, shop, rest.
- **Why now:** unlocks realm content authoring, replayability, and the economy choice vocabulary — the three biggest C.2 deficits — with one structural extraction.
- **Work:** `RoomSpec`/layout-registry extraction (§I); node-graph generation into `RunState.map`; exits-phase map overlay; obol drops + HUD; shop node (heal / +max HP / boon offer); rest node; reward tables per mark.
- **Acceptance:** existing slice reproducible as data (hashes re-pinned once); 7-node runs, ≥2 choices at ≥4 depths, two consecutive same-URL runs share ≤50% of rooms; kite bot completes runs including a purchase; all economy numbers in `tuning.ts`.
- **Out of scope:** realm dressing; event content beyond one stub.

### Phase 3 — Build depth (statuses, boons, deities, second weapon)
- **Objective:** builds that diverge: 3 statuses, 12 boons under two embodied deities, one duo; bow productionized behind the meta unlock; `WeaponDef` extraction.
- **Why now:** depends on Phase 2's reward tables; this is where run-differentiation (C.2's weakest cluster) is won.
- **Acceptance:** every boon changes behavior, none is a bare percentage; deterministic offers still honor door promises; bow-only full clears pinned as replays; status stacking/expiry unit-tested; reward screen shows deity identity.
- **Out of scope:** boon rarity/stacking economies; third weapon.

### Phase 4 — Realm identity (Greek)
- **Objective:** the run reads as *a place*: palette/tileset variant, Greek names and geography, two new enemies + elites, the Judge recast with one new pattern, realm music layers, 2 authored events.
- **Why now:** content lands on the Phase 2 spine and Phase 3 systems; art identity is the historically slowest loop (the gauntlet's 11-round arena stall) so it gets its own phase with timeboxes and the `ART_DIRECTION.md` §11 gates. **Add a Greek section to `ART_DIRECTION.md` §9 first** — the bible sketches Duat/Niflheim/Mictlan but not the realm we chose to build.
- **Acceptance:** blind-critique protocol on three exhibits (a combat room, the shop, the Judge arena); teaching-loop rule holds for both new enemies (first seen alone, then combined); event nodes reachable and completable by bot.
- **Out of scope:** second realm; signature set pieces beyond the Judge arena.

### Phase 5 — Shell & meta
- **Objective:** it opens, pauses, saves, and remembers like a real game: title, settings, pause-owned audio, abandon; Smith NPC + obol banking + three unlocks (bow, vessel, keepsake); deterministic resume.
- **Why now:** last because it wraps whatever the game has become; nothing in it blocks Phases 1–4, and pieces (pause/audio) can land opportunistically earlier.
- **Acceptance:** full loop playable start-to-finish on gamepad only; audio silent ≤100 ms after pause; refresh mid-run resumes within 2 s; a fresh profile's first three runs produce one visible permanent change each.

**Continuous (all phases):** combat polish backlog — authored clips for Caster/Charger/Warden, audio listening pass, real-hardware latency spot-check; hold VFX where it is.

---

## G. First Greek Realm Plan

### G.1 Route structure — the map question, answered

**Recommendation: a generated node graph presented through the existing physical doors, with a five-second map overlay between fights.** Not pure Hades doors, not a full Spire map screen.

- The room-to-room *moment* stays exactly what the slice already proves: clear the room, doors unseal, walk through the one you choose. Combat flow is never interrupted by a scene change; the door marks keep their promise semantics (`rewards.ts:34`).
- The *planning* layer the user wants from Spire comes from showing the generated graph (depth 7, width 2–3) in the `exits` phase overlay: your path so far, the next two doors' node types, and the silhouettes beyond them (shop before the Judge? elite now or never?). Anticipation and strategy without a second game mode.
- **Why not pure Hades doors:** with no visible graph, route choice collapses back to "which reward next" — the slice already has that and §C.2 shows it isn't enough anticipation.
- **Why not a full Spire map:** a separate map scene is a second UI surface to build and pace, and at 30–90 s per room the plan horizon is short enough that two-ahead visibility captures nearly all of the planning value at a fraction of the cost.
- **Cost:** graph generation is one pure-sim module writing `RunState.map` (seeded, hashable, serializable — resume-ready by construction); the overlay is one render module; doors bind to node edges instead of a static `to`. The static slice graph remains as a test fixture.

### G.2 Node and room counts (and why)

- **Depth 7** (entry + 5 + Judge): at 45–90 s per fight plus beats, a run lands at 8–12 minutes — dense-not-long, matching the vision, and long enough for three-to-four boons plus economy decisions to compound.
- **Node pool per run:** every run contains ≥1 shop and ≥1 rest (the valley the current slice lacks), ≤1 elite before the Judge, ≥1 event slot at 60% probability. Constraint-based draw, not free RNG — controlled randomness.
- **10–12 authored combat layouts** across the existing four-builder bones: the smallest pool where two consecutive runs share ≤50% of rooms and a layout repeats at most once per run. Fewer and run three feels solved; more delays the milestone for thin returns.
- **2 authored events** to start (e.g., *the Shade's Toll*: an obol-beggar — pay for a blessing, refuse and be hunted; *the Lethe Draught*: unlearn one boon to draw two offers). Events are the rarity band seed — the architecture (§I reward tables + event specs) matters more than the count.

### G.3 Enemies

Keep brute/caster/charger as recast shades (names/dressing; behavior already proven). Add exactly two archetypes, each a new *question*, taught alone before combined:

1. **Shield-bearer ("Myrmidon shade")** — blocks frontal light hits; broken by a heavy, a dodge-through, or any status proc. Teaches positioning and gives every build a different answer to the same wall. Reuses brute chassis + one new state.
2. **Lament ("Mourning shade")** — support: a keening channel that hastens or shields nearby shades until interrupted. Creates target-priority pressure the current roster never asks for; pairs multiplicatively with every existing enemy. Reuses caster chassis.

**Elites:** modifier layer, not new bodies — *Branded* (fights at +speed, drops triple obols), *Vengeful* (death burst telegraphed), *Judged* (armored until first status). One modifier per elite node.

**Boss:** recast the Warden as **the First Judge** (Rhadamanthys flavor — the fiction already calls him "the first judge", `main.ts:195`). Keep both existing phases; add one pattern (a sweeping verdict beam or wave that partitions the arena) and one arena feature (the scales — two floor plates that alternate hazard, giving the fight geography). One boss done fully beats a boss framework.

### G.4 Boons, statuses, rewards

- **Two deities embodied:** the blade family becomes a war-god identity, the veil family a psychopomp identity (Ares-shaped and Hermes-shaped without needing the names yet — portraits, epithets, one vow line each). Six boons per family: the existing six, plus six new drawn from the status framework (burn-on-heavy, chill-on-graze, status-detonation variants, an obol-greed boon) — every one behavioral, zero bare percentages.
- **One hidden duo** (requires three boons across both families) as the "I didn't know the sword could do this" ceiling.
- **Statuses:** Brand (exists), **Burn** (DoT that ticks louder on Branded foes), **Chill** (slow that composes with bullet time). Three is the smallest set that proves the framework composes with boons, enemies, and elites without exploding the tuning matrix.
- **Reward vocabulary at doors:** boon / obols / heart / event / shop / rest — the power-vs-safety-vs-future economy the loop audit found missing.

### G.5 Mythology bar

Rooms named from the geography (the Asphodel Field, the Bank of Lethe, the Weighing Floor); events and barks that assume the player might actually love this material; no "skeleton dungeon with a Greek texture pack". The realm must pass the project's own blind-critique gate next to Hades' Tartarus rooms on three exhibits before it ships.

---

## H. Combat Quality Plan

Combat is the strongest layer; the plan is to *hold* it while the game grows around it, plus close the residue:

1. **Human tuning A/B (Phase 1):** roll landing curve, perfect-dodge window (window before depth), heavy commit threshold — the combat audit's protocol, finally run with humans.
2. **Authored clips for Caster, Charger, Warden** to hero/Brute standard (the pattern from commit #5 is proven; ~1 enemy per pass, strips pinned at state boundaries).
3. **Audio listening pass:** the one dimension never validated by a human ear; validate ducking, the tell band, and pause behavior together.
4. **Latency spot-check on real hardware** (keydown→photon p95 < 25 ms at 60 Hz) now that the frame path is single-owner.
5. **Status readability in the contact language:** burn/chill must join Brand's indicator system without adding a third visual grammar; danger tells keep the reserved band.
6. **Hold the line:** no new VFX systems, no pool raises, no pattern engine until a Phase 4 encounter measurably needs them. New combat content (shield-break, lament interrupt, Judge pattern) must each pass the existing feel gates: telegraph → commit → punish window, attributable damage, per-action screen caps.

---

## I. Content and Systems Architecture

The rule that has served this repo: **extract an abstraction at its second consumer, prove it by reproducing the first consumer bit-for-bit (or re-pin once), never build it speculatively.** Applied:

- **`WeaponDef`** (second consumer: production bow) — swings/draw model, movement scalars, cancel windows, pose set id, sfx set id. Kills the `armOf()` branches in `player.ts`/views. Integer ids stay append-only for hashes.
- **`StatusDef` + fixed per-enemy status slots** (second consumer: burn) — id, stacks, expiry, tick hook, on-consume hook. Brand's fields (`brand`, `brandTicks`) generalize into a small fixed array — pooled, no per-tick allocation, hash-covered.
- **Boon triggers** stay centralized and typed; add hook points only when a boon needs one (`onWeaponHit` exists; `onKill`, `onRoomEnter`, `onStatusApplied` as the new twelve demand). Data-driven boon authoring waits until the pool passes ~20.
- **`RoomSpec` + layout registry** (second consumer: first new Greek room) — layout id → authored builder, spawn waves, exit slots, reward table id, dressing preset id. `rooms.ts`'s static graphs become fixtures; `arena.ts` builders become registry entries.
- **`RealmPackage`** (single consumer for now — keep it a folder convention, not a framework): palette/tile indices, dressing presets, enemy pool, deity pool, boss id, music set. The presenter already swaps arenas per room; realm is one more lookup.
- **Node graph in `RunState.map`**: generated by the gameplay stream at `startRun`, serialized trivially (it's data + seed), hashed. Doors bind to edges.
- **Run vs meta state** — the boundary is already correct (`session.ts`); extend, don't rework: RunState gains `obols`, `map`, `keepsake`; MetaStateV2 gains `obolsBanked`, real `unlocks`, `smithState`, with a v1→v2 migration and the load clamp removed. Determinism rule stays: meta is read once at world construction and recorded into replays (already true — `replay.ts` stores the meta snapshot).
- **Deterministic resume**: persist (build version, seed, meta snapshot, RLE input log) each room transition; resume = construct + fast-forward. Costs almost nothing given the existing replay machinery; refuses cross-version resumes by design.

---

## J. Presentation and Art Plan

Highest perceptual leverage per unit of work, in order:

1. **Deity framing on the reward screen** — portrait, name, epithet, vow line. Turns the slice's weakest *felt* moment ("anonymous card") into its signature moment. The 480×270 answer: a half-height portrait panel sliding over the darkened arena — the existing overlay already owns the screen.
2. **Title screen** — one painted-in-pixels key image, three options, the game's name. First impression of temperature; currently the game boots into a fetch.
3. **Map overlay** — the five-second route beat; shares the overlay/gamepad work with rewards.
4. **Greek palette + dressing variant** — recolor and re-dress the four proven builders per `ART_DIRECTION.md` rules before authoring wholly new layouts; write the missing Greek §9 entry first; hold every round to the §11 computable gates and timebox environment-beauty iterations (the 11-round arena stall must not repeat).
5. **Enemy clip completion** (Caster/Charger/Warden) — feel-adjacent; already planned in §H.
6. **Summary parity** — death and victory as mirrored cards: cause, weapon, build, route, depth, time.
7. **Smith NPC presentation** — one authored character sprite + bark box in the hub; the barks are the whole narrative budget of this slice.

---

## K. Agent-Native Development Plan

The harness is already the repo's superpower; the gaps are operational:

- **CI** (Phase 0): typecheck, 184+ tests, replay-hash matrix, 100-seed headless traversal of `loop`, one Playwright smoke asserting golden-path states and zero console errors. Every PR, no exceptions — this codebase's determinism makes CI unusually cheap and unusually trustworthy.
- **Bot navigation fix**: route bots to exits via the enemies' tile search; make "all seeds traverse" an acceptance gate forever (it currently fails on seeds 13/23/37 of 60 — bot defect, not graph defect, but it blocks the matrix).
- **Debug API additions**: `grant(boonId)`, `giveObols(n)`, `gotoNode(id)`, `forceOffer([ids])`, `forceEvent(id)` — reward/event/economy work needs the same pose-a-frame ergonomics combat already has.
- **Golden screenshots** for overlays (title, reward, map, summaries, pause) diffed in CI at fixed seeds/ticks — the presentation layer finally gets regression cover.
- **Playtest telemetry**: `metrics.summary()` + event log + survey auto-bundled per session; sessions replayable by construction (store the input log). Human evidence becomes as citable as bot evidence.
- **Doc discipline**: `HARNESS.md` is the agent contract — CI greps its flag table against `replay.ts` so it can never drift again; stale planning docs carry a status banner.
- **Determinism guardrails**: hash coverage extends to statuses, obols, map, and resume state the moment each lands; any new sim module ships with a replay fixture.

---

## L. Risk Register

| # | Risk | Likelihood | Impact | Evidence | Mitigation |
|---|---|---|---|---|---|
| 1 | **The slice isn't fun for humans** (comprehension, difficulty, or boon excitement misses) | Medium-high | Critical | Zero human sessions on record; all validation is bots/strips; naive bot dies 20/20, kite wins 57/60 — the skill gradient exists but tells us nothing about *enjoyment* | Phase 1 gate before any spine/content work; telemetry + replayable sessions; tune before building |
| 2 | **Realm art identity stalls** | Medium | High | 11 gauntlet rounds lost on one empty room; environment beauty is the repo's slowest historical loop | Greek §9 in the art bible first; variant-of-proven-builders before new layouts; §11 computable gates; timeboxed rounds; blind critique on three exhibits only |
| 3 | **Scope explosion from the vision** (pets, eggs, artifacts, summons, second economy nuances) | High | High | The vision doc itself; every prior audit flagged it | §E "does not exist" list + §M deferrals are the contract; one-of-each architecture tests only where cheap (deity, keepsake) |
| 4 | **Content-scaling debt bites mid-milestone** (weapon branches, enemy scratch fields, geometry-in-code) | Medium | Medium | `player.ts` arm branches; `Enemy` field reuse; `RoomKind` builders | Extract-at-second-consumer schedule is *inside* the task list (tasks 5, 9); never extract ahead of it |
| 5 | **Determinism/replay discipline erodes** as UI, meta, resume, and economy land | Low-medium | High | Every past addition kept hashes green — but map/resume/economy touch more surface than boons did | Hash + fixture per new sim module; CI replay matrix; meta read-once rule enforced in review |
| 6 | **Browser/regression blind spots** (audio contract, gamepad, resize, storage) | Medium | Medium | 184 tests are Node-only; pause/audio bug already shipped | Phase 0 smoke + golden screenshots; listening pass in §H |
| 7 | **Presentation monoliths slow iteration** (`hud.ts` 1,404 lines, `presenter.ts` 962, `audio.ts` 967) | Medium | Medium | File sizes; every overlay lands in the same two files | New surfaces (title, map, shop, barks) are new modules; split `hud.ts` opportunistically when touched |

---

## M. Explicit Deferrals

Compelling, and not this milestone. Each waits for a named trigger:

1. **Pets & eggs** — after the realm ships; needs its own milestone (ally AI, arbitration, balance). The egg loop (discover → feed → hatch) is designed enough to slot in later.
2. **Artifact leveling tiers** — one static keepsake proves the slot; tiers need play data on whether keepsakes are even picked.
3. **God summon / ultimate meter** — a fourth combat verb deserves a combat-audit cycle of its own, on top of a proven realm.
4. **Second realm (and realm-choice branching)** — after the Greek realm passes its blind critique; the other gates are literally set dressing until then.
5. **Armor / overshield** — HP 5 + vessels is legible; add layers only if playtests show damage economy needs them.
6. **Duo/legendary/rarity economies** — one hidden duo is the proof; economies need ≥20 boons to mean anything.
7. **Heat / pact modifiers** — needs victories to be routine first.
8. **Mid-run save beyond deterministic resume** — resume-by-replay covers the refresh case; a real save schema waits for runs >15 min or cross-device needs.
9. **Projectile-pattern engine + pool raise** — profile-gated, per the combat audit; no current encounter needs it.
10. **Contact-damage revisit, scrolling camera, resolution change** — the fixed decisions stay fixed until a concrete encounter design breaks them.
11. **Remapping, localization, colorblind modes, touch** — after the slice has an audience beyond playtests (volume + reduced-effects ship now; the rest is post-slice).
12. **Dialogue system** — barks only until narrative has a second character.

---

## N. The Next 10 Tasks

In exact priority order. Each is scoped to be one implementation task/PR. Format per task: **what · why · systems · impact/complexity · depends on · type · done when**.

**1. Vary attempt seeds across reloads.**
Mix persistent `meta.attempts` into the run-seed derivation in `startRun` (`src/sim/session.ts:88`), keeping replays exact via the already-recorded meta snapshot. · Kills the "same first run every day" defect — the cheapest replayability win in the repo. · sim/session, replay tests. · High impact / trivial complexity. · Nothing. · Small fix. · **Done when** two fresh page loads with different stored `attempts` produce different Room-1 offers, and re-pinned replay tests pass.

**2. Fix slice-bot exit navigation; stand up CI with a traversal matrix.**
Route bots to doors with the enemies' tile search; add a workflow running typecheck, tests, replay hashes, `slice-kite`/`slice-naive` seed matrices, and one Playwright golden-path smoke. · Makes "every seed completes" an enforceable invariant and protects everything after it. · bots, tools, CI. · High / low-medium. · Nothing. · Tooling. · **Done when** seeds 1–100 all reach the Bardo (currently 3/60 stall at `black-step/exits`) and CI blocks red PRs.

**3. Death/victory summary parity with sim-authoritative cause.**
Record the killing source in the sim at `hurtPlayer`; death card gains weapon + boons + route; both summaries hold a minimum beat before confirm. · Every death should teach; today the card guesses the killer and hides the build. · sim/combat, events, HUD. · Medium-high / low. · Nothing. · Small system + polish. · **Done when** a scripted death shows the true killer and full build, and hashes are re-pinned once.

**4. Run the human fun gate.**
Playtest build (telemetry bundle: metrics, event log, input log, survey) + 5-player × 3-run protocol + findings doc + one tuning pass. · The largest unknown in the project; everything in Phases 2–5 is cheaper to aim afterward. · deploy, telemetry, docs, tuning. · Critical / medium (process, not code). · Tasks 1–3 (variety + honest summaries first). · Validation. · **Done when** ≥5 session bundles exist, findings are written against §C.2's dimensions, and the tune list is merged.

**5. Extract rooms-as-data (`RoomSpec` + layout registry).**
Layout builders registered by id; graph/waves/rewards as data; static slice graph becomes a fixture. · The single extraction that unlocks map generation, realm authoring, and layout variety. · sim/rooms, arena, waves, tests. · High / medium. · Task 2 (CI safety net). · Foundational. · **Done when** the existing slice reproduces bit-for-bit from data (or one re-pin) and a new room ships without touching sim logic files.

**6. Generate the node-map run (v1) with the exits-phase map overlay.**
Seeded 7-node graph (combat/elite/event/shop/rest/boss with §G.2 constraints) in `RunState.map`; doors bind to edges; overlay shows path + next choices, pad-navigable. · Converts one authored branch into a planned route — anticipation, agency, replay variety in one move. · sim (graph gen), render (overlay), HUD. · High / medium. · Task 5. · Foundational. · **Done when** two same-URL runs share ≤50% of rooms, ≥2 choices appear at ≥4 depths, and the overlay works on gamepad.

**7. Obol economy: drops, shop node, rest node.**
Kills/clears drop obols; shop offers heal / +max-HP / boon; rest heals or banks; all numbers in tuning. · Adds the power-vs-safety-vs-future choice the loop audit found missing, and gives runs a valley. · sim (economy, node handlers), HUD, audio. · High / medium. · Task 6. · Small system cluster. · **Done when** the kite bot completes runs that include a purchase and a rest, deterministically.

**8. Status framework + 12 boons + deity framing.**
Generalize Brand into fixed status slots (add Burn, Chill); expand to 12 behavioral boons across two embodied deities (portrait, name, vow) + one hidden duo; keep door-family guarantees. · This is where builds diverge and rewards start feeling like meetings. · sim (statuses, boons, rewards), reward overlay, art. · High / medium-high. · Task 7 (reward tables). · Foundational + polish. · **Done when** every boon is behavioral, statuses are unit-tested for stacking/expiry/interaction, and the offer screen shows a deity.

**9. `WeaponDef` extraction + production bow behind the first meta unlock.**
Move-set table replaces `armOf()` branching; rack gains the bow slot; the Smith sells the unlock for banked obols (removing the `storage.ts:29` clamp, `MetaStateV2` + migration). · Proves weapons-as-system and makes meta progression change play for the first time. · sim (weapons, player), views, storage, hub. · High / medium-high. · Task 7 (obols), Task 5. · Foundational. · **Done when** a bow-only full clear is a pinned replay and a fresh profile can earn, buy, rack-select, and run the bow.

**10. Shell v1: title, pause-owned audio, settings, abandon.**
Title scene (Descend/Settings/Credits), pause stops sim + audio and handles visibility loss, settings (volumes, reduced effects, fullscreen), abandon-run — all pad-operable, all overlays given prompts + golden screenshots. · The difference between a prototype and a game you hand to someone. · main, render overlays, audio, input. · Medium-high / medium. · Independent (can land any time; last among the ten by player-value ordering). · Shell/polish. · **Done when** a pad-only player can go title → run → death → title without touching a keyboard, and pause silences audio ≤100 ms.

*(Phases 4–5 content — Greek dressing, new enemies, the Judge, the Smith, resume — queues immediately behind these ten; they are sequenced in §F and specified in §G.)*

---

## Final principle

The order above is built so that the moment of truth arrives as early as possible: after task 4, a human being either says *"I understand what Bardo is"* about the combat and the loop — or tells us exactly why not, while the cost of changing course is still one phase, not five. Everything after that point spends effort only on what survived contact with a player.
