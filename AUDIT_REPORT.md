# Bardo Rogue — Oracle Audit

**Audited 27 August 2026.** Repository: `/Users/davidraphael/Desktop/bardo-rogue-web`. Exact head: `68072486b5c2f886aef49363cf625647dbb73a4e`, branch `main`. Read against `VISION.md`, including its full-game requirements. Scores use the requested commercial-game scale.

## 1. TL;DR

- **Bones: 58/100. Game today: 38/100.** A useful combat prototype, not yet a scalable roguelike foundation.
- **Bones verdict:** keep the pure simulation, fixed tick, event boundary, and Pixi. Make one bounded composition reset before rooms, boons, and another weapon multiply the assumptions.
- **Gameplay verdict:** impact effects exist; satisfying control and repeat play are unproven. The whole combo retains its first aim. A projectile can kill after room clear.
- **Art verdict:** custom animated pixel art fits this renderer. Replace the asset/animation contract, not Pixi. The present static bodies and room hierarchy miss the reference bar.
- **Most important move:** replace the empty-room beauty loop with a trustworthy combat proof: repair the measurement defects, fix chain targeting, then run a human five-attempt trial.
- Checks pass: typecheck, 18 tests, production build, and three replay fixtures twice in Node and once in Chrome.
- Full-room kite clears **8/8 in 37.8–43.3 simulated seconds**; naive melee clears **1/8**. These are bot outcomes, not human difficulty or fun proof.
- Real keyboard play remains a gap. Chrome accepted discrete attacks/dodges, but its supported controls did not provide held movement. I did not invent a personal playthrough.

### Scope and evidence discipline

I read the full plan at `/Users/davidraphael/.claude/plans/web-roguelike-action-rpg-glimmering-pnueli.md`, the four project/vision/harness directives, all **44 TypeScript files in `src/`**, all **8 tools**, both test files, replay definitions, asset manifest, and the progress timeline. The source read was not a sample. I inspected the captured images and all five movement strips. One fresh critic inspected anonymous comparison exhibits independently.

No source, tests, tools, replay fixtures, committed assets, or progress timeline were edited. No asset generators, provider generation, commits, or second Vite server were run. New work is this report and evidence in [public/progress/audit](public/progress/audit/). The existing server on port 5173 was reused. Before/after source fingerprints are included there.

**Evidence limits:** I did not complete several continuous keyboard runs, hear the final audio mix, exercise a physical gamepad, test Safari/Firefox, or measure a production build on a low-end device. God-mode enemy poses are controlled observations, not human play. The 200-projectile rendering test extended the pool **only in browser memory**; production cannot spawn that count. Recommendations and content counts below are proposals, not implemented features.

Source citations use repository-relative paths and exact line numbers at the audited head. The plan's line numbers refer to the absolute plan path above. Raw command results, state traces, and screenshots accompany the report.

### Corrections to the supplied snapshot

| Claim in the brief/plan | What exists at the audited head |
|---|---|
| Three commits; dirty implementation | Five commits; clean before audit. The last two commits already contain the authored arena and critic/process changes. |
| Event ring buffer; no allocations per tick | `World.events` is a growing array; `emit` pushes objects. Collision returns a new result object per move. `world.ts:65–90`, `collision.ts:5–21`. |
| Everything lives in tuning | Caster idle, initial cooldown, tracking lock, strafe cadence, recovery, and several visual timings are hardcoded. `enemies/caster.ts:5–53`, `render/views.ts:55–74,170`. |
| Integer upscale everywhere | True at the tested 1920×1080/DPR 1. Fractional fallback exists; 900×506 used **1.874×**. A 390-pixel viewport cropped a 480-pixel image. `render/app.ts:49–59`, `viewport-results.json`. |
| Pooled ParticleContainer | Pooled ordinary Sprites, allocated on demand, capped at 1,500. `render/particles.ts:7–44`. |
| Filters only while active | Aberration is temporary; the color-grade filter always runs on the upscaled quad. `render/postfx.ts:79–107`. |
| Caster aims at player position at fire time | It stops tracking eight ticks before firing. This is a useful commitment window, not necessarily a defect. `enemies/caster.ts:38–41`. |
| Wave 3 has one Brute | Two Brutes, two Casters, then six Chargers. Full room totals 15 enemies. `waves.ts:10–19`. |
| Eleven independent blind failures | Eleven builder rounds are recorded. Round 1 explicitly says the critic was billing-blocked and the builder read the stills. Do not promote that record to eleven verified independent trials. `progress/data.json:17–26`. |
| Gauntlet still prioritizes the empty arena | Current `GAUNTLET.md:9` already says sword first and two-stall parking. The progress page still says round 11/building, and the promised `gauntlet/state.json` does not exist. |

## 2. Scorecard

| Dimension | Score | Confidence | Biggest gap | Highest-leverage change |
|---|---:|---|---|---|
| A. Architecture and bones | 64 | High | Room combat owns assumptions that belong to a run | Put explicit run state above a room world |
| B. Harness and agent velocity | 59 | High | Several measurements look stronger than they are | Repair hash, dodge accounting, reset metrics, and capture clock |
| C. Combat feel and juice | 45 | Low | Strong effects cover weak control/pose differentiation | Redirect at chain boundaries; prove contact/recovery with players |
| D. Enemy design and readability | 57 | Medium | Three roles, but little pattern or spatial composition | One authored mixed encounter with a readable fan attack |
| E. Gameplay and fun | 36 | Low | No evidence people want a fifth run | Run a blind five-attempt combat trial before content expansion |
| F. Run structure readiness | 32 | High | No run, room lifecycle, graph, reward, or save | Three rooms, one choice, one persistent outcome |
| G. Art evolvability | 58 | Medium | Numeric tile IDs and one-texture views | Semantic clips, pivots, and one animated hero/enemy proof |
| H. Visual quality today | 35 | Medium | Actors lose to the background and emblem | Establish actor contrast and authored material hierarchy |
| I. Audio and music | 33 | Low | One master bus; no music/ambience system | Separate mix buses and one measured combat cue |
| J. UI, HUD, and meta | 31 | High | Combat labels are not a game shell | Pause/options, boon choice, and readable return summary |
| K. Performance and browser | 57 | Medium | Capacity and batching fail before simulation cost does | Profile a supported moving 200-bolt encounter across browsers |
| L. Code quality and maintainability | 65 | High | Small readable modules, incomplete invariants/tests | Test contracts and delete misleading/dead surface area |
| M. Theme and identity | 30 | Medium | The fiction does not yet change a decision | Give death/rescue a visible consequence in the town |
| N. Process and loop | 44 | High | Evaluation history/state cannot support its claims | Matched evidence, independent critic, human gate, honest parking |

**Weighting:** these are judgments, not an arithmetic average. Bones weight simulation correctness and trustworthy iteration most, followed by run/weapon/boon extensibility and the art boundary. Those strengths earn 58; absent composition and false-positive evidence prevent 70. Today's game weights control, readable combat decisions, and repeat-play motivation most. Existing effects earn credit, but missing human proof, generic presentation, and no run consequence hold it at 38. Missing town content does not mean the simulation should be rewritten.

## 3. Dimension reports

### A. Architecture and bones — 64, high confidence

**Three strongest pieces of evidence**

1. `src/sim/` has no executable DOM, Pixi, wall-clock, or `Math.random` dependency. `step.ts:12–33` supplies one ordered tick. All three replay fixtures reproduced their pinned hashes in Node and Chrome. See `browser-replay-parity.json` and the six replay logs.
2. Presentation reads state/events: `main.ts:64–76` advances simulation, consumes metrics, presents events, then clears them. `presenter.ts:135–195` changes views, not combat truth. This is a valuable boundary for replacing art.
3. `world.ts:54–88` is a compact room world, not an engine disaster. But it constructs one arena, carries one sword-shaped player, fixed pools, wave state, and no run owner. `player.ts:42–48,120–128` reads the global sword chain directly. These are real scaling seams.

**Biggest gap:** ownership above the room. Changing global tuning for an item would modify a shared definition rather than one actor's derived stats. Putting inventory, dialogue, shop, and room graph into `World` would create the monolith that does not yet exist.

**Strongest move:** introduce a small run owner, immutable room/weapon definitions, and actor-local derived stats while implementing actual examples. Keep `World` as the room simulation. Do not introduce an ECS, plugin framework, universal effect language, or abstract scene engine.

Pooling is useful, but “zero allocation” is false and unnecessary as an absolute rule at these measured costs. `collision.ts:5–21`, `world.ts:90,96`, and event literals allocate. Fix measurable pressure, not the prose ideal. Separate cosmetic/layout RNG from encounter RNG before new art or rooms accidentally change combat seeds (`arena.ts:52`, `world.ts:83–84`).

### B. Harness and agent velocity — 59, high confidence

**Three strongest pieces of evidence**

1. Typecheck, 18 tests, 72 requested bot cases, three replay fixtures twice, 29 poses, and all requested state screenshots ran. This is already an effective inspection surface. Commands and outputs are in the appendix.
2. The hash omits state that changes the future. My probe changed player FSM state, velocity, aim, swing angle, input buffer, invulnerability, god mode, and wave timer without changing the hash **760607364**. `hash.ts:14–17`; `probes.json → hashBlindSpots`.
3. Dodge metrics miss a projectile passing through an invulnerable dodge and can count two successes for one dodge. `projectiles.ts:20`, `combat.ts:59–63`, `metrics.ts:21–22`; both cases reproduced. `__game.metrics` also remains bound to the old Metrics object after reset (`debug/api.ts:52`), while `state().metrics` updates correctly (`:68`).

**Biggest gap:** convenient observations are being used as stronger proof than their definitions allow.

**Strongest move:** make one canonical quantized input path and a complete future-state checkpoint/hash; give each dodge an identity and count a documented outcome once; expose current metrics through a getter. Add assertions to pose/capture conditions.

`headless.ts:41` feeds raw bot floats while `main.ts:71` and `record-bot.ts:27` quantize. All eight full-kite end hashes differed between raw/quantized probes; seed 8's dodge-success count also changed. Existing replay comparisons remain valid because the replay supplies the same frames.

`shot.ts:28–42` waits, bulk-steps, then renders a few frames. It does not advance the presentation clock once per sim tick. A kill can occur before its view exists, skipping sprite shatter (`presenter.ts:88–90`). Banners can still say “WAVE 1” in a late simulated frame. The audit's motion traces rendered every step to avoid this. The supplied contact-sheet tool assembles images; it does not capture timed motion. A short video/GIF plus timestamps, input trace, exact revision, and expected pose would close the gap. My delay probe did **not** reproduce initial-tick overshoot; do not list it as a confirmed bug.

### C. Combat feel and juice — 45, low confidence

**Three strongest pieces of evidence**

1. The controlled combo strip has anticipation, two alternating sweeps, a later heavy stroke, contact flash, freeze, knockback, and recovery. With contacts, swings began at ticks **1,18,35**; first damage was tick **8**, player attack state tick 7. `chain-strip.png`, `chain-trace.json`; `player.ts:87–96`.
2. A turn during the first attack never reaches subsequent swings: the probe requested upward aim, yet swing events at ticks **1,15,29 all used angle 0**. `player.ts:29,124`; `probes.json → comboRetarget`. The first aim locks the whole chain, not just one committed strike.
3. Native Chrome presses produced two swings and one dodge in a recorded 240-tick smoke test. A dodge buffered during light recovery began at the expected boundary in the separate trace. This proves input latching/cancellation, not human responsiveness or satisfaction. `native-keyboard-smoke.json`, `probes.json → cancelBoundary`.

**Biggest gap:** the visual budget is stronger than the player's ability to express intent. The heavy attack has larger numbers and longer recovery, but its small rotating body/weapon does not sell a distinct full-body action.

**Strongest move:** sample the current requested aim when the next attack begins, while preserving commitment during an active strike. Give the third swing a readable authored anticipation/contact/recovery silhouette. Test that exact interaction before increasing shake or particle count.

| Feedback stage | Verdict and evidence |
|---|---|
| Input | Press latching exists (`input/index.ts:16–19,48–49`); no end-to-end latency measurement. |
| Anticipation | Numerically distinct 6/6/10-tick startups; tiny whole-body transforms communicate less than authored poses (`tuning.ts`, `views.ts:69–74`). |
| Attack/contact | Wide arcs are useful, but geometry activates across the sector while the visible stroke sweeps through it. Align these deliberately (`player.ts:90–104`, `views.ts:101–119`). |
| Impact | Light/heavy freeze, flash, shake, kick, particles, and heavy aberration exist. Kill frames briefly wash out local detail (`presenter.ts:76–103`; kill strip). |
| Reaction | Light poise on Brutes and heavy stagger make commitment matter (`combat.ts:19–54`). Ordinary reactions share the same squash vocabulary. |
| Environment | Blood persists; enemies disappear into debris. It records combat, but broad flashes compete with incoming tells (kill/Brute strips). |
| Sound | Layered event mapping is present; audible quality not verified (`audio/sfxMap.ts:7–24`). |
| Recovery | Cancel windows are explicit. Recovery poses largely ease a rotated static sprite home (`views.ts:115–119`). |

The dodge is mechanically a decision: initial and late vulnerability, fixed travel, and attack-cancel timing exist. Whether it feels like a decision is still unproven. The broken “successful dodge” metric cannot settle it.

### D. Enemy design and readability — 57, medium confidence

**Three strongest pieces of evidence**

1. The roles differ: Brute commits at close range; Caster creates a lane; Charger punishes a position. Brute light-hit poise and heavy stagger distinguish damage from interruption (`combat.ts:19–54`; the three enemy modules).
2. Tell clocks are inspectable. Brute: 20-tick windup, six lunge ticks, then first active contact, roughly **450 ms** from windup entry. Caster: 24 ticks to fire, last eight committed; impact follows travel. Charger: 16-tick freeze, earliest dash contact on the next tick, roughly **283 ms**. `brute.ts`, `caster.ts:36–45`, `charger.ts`; matching strips/traces.
3. The Brute's raised weapon/red state and Charger's crouch/travel read in isolation. In overlap, the Brute damage flash is easier to see than its cause. The independent critic reached the same limitation (`blind-critic.md`). `wave3-dash.png` shows small, muted actors around a dominant floor panel.

**Biggest gap:** encounter composition. These are three pursuit/timing roles, not a full spatial vocabulary. AI has no general route/line-of-sight solution for authored obstacles; the current open arena hides that requirement.

**Strongest move:** author one mixed encounter with a three-lane Caster fan, a committed Brute punish window, and a delayed Charger entry. Measure where damage came from and whether players can explain it. Add pattern authorship before another ten enemy skins.

Next roster roles should create different decisions: stationary lane controller, protected support, area-denial enemy, interruptible channeler, and one elite modifier with an unmistakable tell. A three-phase boss needs scheduled emitters and phase state. More HP is not a new role. Keep recoveries hittable; do not make “hard” mean chasing retreating targets longer.

### E. Gameplay and fun — 36, low confidence

**Three strongest pieces of evidence**

1. Full kite clears 8/8, always with four damage taken; naive clears 1/8. There is a useful skill-policy separation. But kite clears in 37.8–43.3 seconds, not 60–120 (`sim-matrix.json`).
2. Wave 1 is solved identically across eight seeds: naive clears in 5.8 seconds, kite in 7.9, idle dies in 8.6. Seeds do not create eight materially different first-wave encounters. Full naive deaths occur at 19.5–21.8 seconds. These violate the stated proxy targets, not a measured new-player target.
3. The controlled strips show satisfying ingredients at contact, but the room has no reward, interacting object, alternate route, or consequence beyond a restart banner. `waves.ts:67–79`, `hud.ts:56–59`; room-clear image.

**Biggest gap:** a reason to practice the combat beyond passing the room, backed by proof that practicing is enjoyable.

**Strongest move:** test the corrected sword and one mixed encounter with five new players, five attempts each. Record deaths, attribution, voluntary restarts, whiffs, and which choice they believe changed the outcome. Do not use bots or an AI critic to certify enjoyment.

There is no honest basis to say a person would replay this five times. It is **not proven fun yet**. That is stronger than “add content and it will become fun,” and narrower than claiming no one could enjoy it. The direct fun section below separates observation from prediction.

### F. Run structure readiness — 32, high confidence

**Three strongest pieces of evidence**

1. `World` creates `buildArena` itself (`world.ts:80–85`). `scenarios.ts` configures combat setups in code. `waves.ts` is an encounter sequencer, not a room graph or run director.
2. `doorOpen` is a flag set at clear (`waves.ts:70–75`). Presentation changes a door sprite (`presenter.ts:125`). There is no door traversal, room history, inventory, reward choice, boss result, town, or persistent save.
3. `Presenter.bindWorld` resets actors/effects but keeps the old tilemap, props, lighting, and atmosphere (`presenter.ts:58–69`, versus construction at `:39–54`). A second differently shaped room would not become correct by calling reset.

**Biggest gap:** room creation and room completion have no durable owner or lifecycle.

**Strongest move:** make three room definitions, two reward-marked exits, an explicit transition, and one save checkpoint. Keep combat world state transient; keep chosen weapon, boons, currency, room history, and seed in a run. Prove return and reload before authoring a floor.

The fixed camera does not block this. Hardcoded offsets, room construction, and presentation ownership do. A wave director can remain inside each room; do not stretch its numeric index into a campaign state machine.

### G. Art evolvability — 58, medium confidence

**Three strongest pieces of evidence**

1. Sim and renderer are separate, and Pixi already supports arbitrary textures/render targets. Actors have semantic simulation state and continuous aim. None of that requires Kenney (`main.ts:39–43`, `render/atlas.ts`, `world.ts:15–45`).
2. Asset identity is currently numeric (`views.ts:8–9`), each view stores one normal/white texture (`:18–30`), and attacks animate a detached weapon around a static body (`:92–133`). The manifest is an inventory, not a clip/pivot/timing specification.
3. Room drawing already bakes static imagery (`tilemap.ts:91–118`), so a painted pixel room is feasible. However props, collision, lights, atmosphere, and the seal have separate hardcoded assumptions. The 719-line generator and eleven-round timeline demonstrate production friction, not a mathematical limit on generated pixels.

**Biggest gap:** a documented asset contract that makes replacement routine and lets authored animation preserve combat timing.

**Strongest move:** import one custom hero and one Brute, each with directional clips, anchors, hurt flash, and matching contact markers. Keep simulation timings authoritative. Prove that both new and puppet entities work in the same encounter before a wholesale asset commission.

Keep 480×270 for the next proof. Keep a 16-pixel logical collision grid, but stop requiring every illustrated object or body to fit a 16×16 tile. Test a 24–32-pixel-tall hero at the actual game camera. More internal pixels alone will not solve weak silhouettes or material hierarchy. Details of the migration are in section 8.

### H. Visual quality today — 35, medium confidence

**Three strongest pieces of evidence**

1. At 1920×1080/DPR 1, the target scales exactly 4× (`viewport-results.json`). The room has consistent borders, shadows, and a restrained palette. This is visible craft, not a missing renderer.
2. The neutral paired exhibits lose to both supplied references. The fresh critic chose the Gungeon exhibit in both orders and the Hades exhibit in the combat pair. Its largest gap was **actor-to-background hierarchy** (`comparison-ab.png`, `comparison-ba.png`, `combat-comparison.png`, `blind-critic.md`).
3. The central gray slab/emblem occupies the most valuable action space, while tiny actors share muted values with the floor. Red anticipation helps but becomes ambiguous in overlap. Rotation and squash rerasterize body silhouettes from frame to frame (dodge/Brute/chain strips; `views.ts:63–85`). Grid-aligned output is not a guarantee of stable sprite shape.

**Biggest gap:** focal hierarchy. The room announces itself more clearly than the action.

**Strongest move:** lower floor contrast around combat, increase actor silhouette/value separation, and replace the flat central badge with one original architectural focal object placed so it does not obscure play. Test at native game scale before examining an enlarged crop.

The comparisons are not controlled equivalence: empty room versus boss spectacle; top-down pixel scene versus isometric action. They support a presentation gap, not a numeric scientific margin. The official Gungeon strip at 9–11 seconds adds a more specific lesson: bright patterned threats against quiet floor values create readable lanes (`reference-pattern-strip.png`). No matched Hades sword/roll/clear sequence was obtained. A fair next round must match subject size, action phase, HUD state, and exposure.

### I. Audio and music — 33, low confidence

**Three strongest pieces of evidence**

1. The manifest contains **91 audio files, 1,059,608 bytes**. Event mappings layer whoosh/noise, impact materials, hurt, footsteps, kills, tells, and announcements (`audio/sfxMap.ts:7–58`). This is more than a single sound per action.
2. Everything connects to one master gain (`audio.ts:15–16,46–52`). Hurt ducks that master (`:70–76`), including the hurt/impact sounds, not a music bus. There are no music layers, ambience transport, limiter, positional pan, voice budget, or priority policy.
3. A clear at one HP still schedules `flawless_victory` (`sfxMap.ts:58`; automated-clear state: four damage taken). Audio unlock listeners install only after asynchronous decoding finishes (`audio.ts:17–30`), leaving an early-interaction timing risk. I did not reproduce that race or hear the mix.

**Biggest gap:** a coherent mix and sound identity for prolonged combat, not the number of clips.

**Strongest move:** keep Web Audio; add master, effects, music, and ambience gains with bounded effect voices and metering. Make hurt duck music/ambience. Build one two-layer room cue driven by encounter state. Record a repeatable combat clip and review it on speakers and headphones.

Do not certify loudness, bass weight, clipping, or musical quality from this audit. Inspectable mappings are source proof, not listening proof. Replace arcade result announcements with the game's tone before writing a town full of mournful characters.

### J. UI, HUD, and meta — 31, high confidence

**Three strongest pieces of evidence**

1. Hearts, wave text, room/death banners, and a short controls hint exist (`hud.ts:17–66`). The settled death image shows a clear restart instruction; the room-clear image is legible.
2. Hearts are constructed once from base tuning, not current max HP (`hud.ts:17–18,48`). The controls hint lists devices, not action meanings, and disappears after 4.2 seconds (`:15,35,62–65`). The large wave title competes with the action in captured frames.
3. There is keyboard/mouse and basic gamepad sampling (`input/index.ts:30–84`), but no title, pause/menu, options, rebinding, boon selection, inventory, map, dialogue, summary, or semantic focus model. A 390-pixel viewport crops the playfield (`viewport-390.png`).

**Biggest gap:** a readable, navigable game shell and choice interface.

**Strongest move:** build one consistent pause/options and three-choice boon modal with keyboard/gamepad focus. Include shake/flash reduction, clear action labels, and a summary showing why a run ended. Use a common choice command/state model, not menu code inside combat events.

Do not scope touch controls now. State desktop keyboard/mouse and gamepad as the first supported audience. Phone access to the audit/progress page is a different requirement from phone playability.

### K. Performance and browser — 57, medium confidence

**Three strongest pieces of evidence**

1. Warm Node stress with 32 static dummies and 64 stationary projectiles gave **2.375 µs median / 2.666 µs p95**, over 10,000 samples after 500 warmup ticks. Ordinary bot runs were cheap; cold maxima reached **12,097 µs** in wave3 idle. Neither is a browser FPS test (`probes.json`, sim matrix).
2. Chrome 151 on this Apple M5 Pro, 1920×1080/DPR 1, with 32 dummies, 1,500 persistent particles, and a synthetic 200-bolt pool extension: **8.4 ms median / 14.6 ms p95 / 17.3 ms maximum rAF interval**, 120 samples after 45 warmup frames. The simulation was paused; the real presentation loop ran. This supports local rendering headroom only (`browser-perf.json`).
3. Production admitted **64 of 200** requested projectiles and silently rejected 136. The synthetic 200 scene made **408 GL draw calls per interval**, versus 136 at 64 and 10 at zero. `world.ts:55,112–114`; `probes.json`, `browser-perf.json`. `views.ts`'s BoltView alternates normal/additive drawing; `presenter.ts:154–158` also finds each bolt by scanning the pool.

**Biggest gap:** supported content capacity, batching, and representative browser proof.

**Strongest move:** support a bounded 256-slot projectile pool with explicit overflow behavior, then run an actual moving 200-bolt boss pattern. Group compatible bolt layers, remove per-view full-pool searches, and measure draw calls, rAF intervals, GPU work, and allocations at 1080p/4K. Do this before a ParticleContainer rewrite; ordinary Sprite pooling alone was not the measured failure.

`frameStats()` times the loop callback, excluding the independent Pixi stage ticker and actual display interval (`loop.ts:19–31`, `render/app.ts:27,61–62`). Short shot p95 values of 6.9–13.2 ms cannot certify locked 60 fps. Grade-off samples saved one draw but were noisy; they do not isolate GPU shader cost. The always-on grade runs at final output resolution, so “480×270 makes fill rate trivial” is not a safe budget claim.

The 120 Hz display path ran here; presentation is not fully rate-independent: bolt trail chance is per render (`presenter.ts:158`) and banner easing is per frame (`hud.ts:53`). Catch-up caps five ticks and drops excess accumulated time (`loop.ts:20–26`); that prevents spiraling but slows simulation relative to wall time during hitches.

Committed game assets total **1,323,222 bytes across 172 files**. Build passed in 4.363 seconds including typecheck; Vite reported 788 ms. Main JS is 326.37 kB / 98.73 kB gzip, plus split chunks. Cold network load, realm streaming, Safari, Firefox, thermal behavior, 4K, and long-session heap stability remain open. Audit reference/video files are not game payload and should not become a release bundle by accident.

### L. Code quality and maintainability — 65, high confidence

**Three strongest pieces of evidence**

1. The main loop, world, player, enemies, and event map remain small enough to trace. Pure functions and explicit states make defects reproducible. Strict typecheck and the production build pass (`typecheck.log`, `build.log`).
2. The 18 tests cover useful simulation/replay contracts, but they did not catch chain aim, post-clear death, pool overflow, wall penetration after separation, or false dodge metrics. The audit reproduced each (`tests/sim/core.test.ts`, `replay.test.ts`, `probes.json`).
3. An additional, nonstandard unused-symbol check found **10 diagnostics**, including `duckUntil`, unused imports/parameters, and a test variable. Normal project checks remain green (`unused-check.log`). `noUncheckedIndexedAccess` is disabled. The 719-line art generator mixes production tooling and drawn content, but is not itself a runtime architectural failure.

**Biggest gap:** important behavioral invariants exist in comments or targets rather than tests.

**Strongest move:** extend the current tests with the reproduced cases and precise cancel/telegraph boundaries. Delete unused fields/imports as touched; centralize values that are actual design controls. Do not “clean up” by making every literal a named constant or every enemy state a framework.

A new agent can locate the main systems quickly from the harness docs. It cannot safely assume those docs' allocation, hashing, or performance promises. Correcting documentation is part of maintainability, not a substitute for fixing behavior.

### M. Theme and identity — 30, medium confidence

**Three strongest pieces of evidence**

1. `VISION.md:9–35` provides a strong death/return and cross-realm premise. The current runtime has only one named Threshold room and generic medieval sprites (`hud.ts:27`, `views.ts:8–9`).
2. The floor emblem, spectral atmosphere, and dark palette hint at a liminal place, but no interaction expresses rescued memory, rebirth, a deity, or a consequence of death (empty/clear/death captures; `waves.ts:67–79`).
3. Current result language is “YOU DIED,” “press R,” and an arcade `flawless_victory` announcement (`hud.ts:56–59`, `sfxMap.ts:58`). The run-to-town narrative mechanism described by the vision does not exist.

**Biggest gap:** the bardo is a label and mood, not a rule or consequence.

**Strongest move:** one rescued person or recovered name changes the town after a failed run. Show that change immediately, before adding a pantheon catalog. Let the same pale soul/thread motif connect combat aftermath, boon arrival, realm exit, and return.

Do not reduce distinct religious traditions to palette swaps. The content sketch is fictional game design, not a claim about religious doctrine. Commission research and cultural review before locking deity depictions, sacred imagery, and the meaning of rebirth. This is a content-quality gate, separate from code correctness.

### N. Process and loop — 44, high confidence

**Three strongest pieces of evidence**

1. The timeline repeatedly names material weight, focal architecture, and furnishing density, while successive rounds change small tiles and props (`public/progress/data.json`). The same category of gap survives the changes. That is a stalled search method.
2. Current `GAUNTLET.md:9` already adds sword-first order, both exhibit orders, and parking after two stalls. Its later “no fixed number of rounds”/“don't stop” language remains broad (`:21,29`). The progress page has not adopted a durable parked result, and `gauntlet/state.json` is missing.
3. A fresh anonymous critique in this audit still picked the reference, but explained a different actionable priority: actor/background hierarchy. It explicitly rejected treating still strips as proof of timing (`blind-critic.md`). The historic first critic was unavailable, which limits the independence claim (`data.json:21–22`).

**Biggest gap:** the loop confuses repeated production with validated progress, and a critic preference with proof of fun.

**Strongest move:** one evidence packet per question: exact head, scenario/input, state assertion, timed clip with audio, matched reference, independent verdict, and human gate where needed. Record parked/failed/unverified distinctly. After two same-gap misses, change method or get an artist; do not merely add another prop.

The underlying builder/critic split is sound. The wrong first piece, weak art direction, insufficiently matched comparisons, and a low-level drawing tool together explain the stall better than “code cannot make art.” Two exhibit orders reduce positional bias; they are not two reviewers. A victory on one selected frame is not a commercial-quality certificate.

## 4. Oracle answers

| Question | Position, evidence, and cost of being wrong |
|---|---|
| **1. Can static puppet animation carry the whole game?** | **Not this game's hero, boss, and distinct weapon actions at the stated bar.** It can carry small ambient actors, attachments, and secondary motion. The vision explicitly calls for custom frames; strips show rotating bodies with limited pose language. Migrate one entity through semantic directional clips, then coexist with puppets. **Wrong-call cost:** commissioning too many frames too early wastes art; delaying the contract makes every weapon/view another migration. |
| **2. Is 480×270 right?** | **Keep it for the pixel lineage; revisit actor scale now, not the whole target.** The 4× capture is coherent. Material hierarchy and tiny silhouettes are the visible failures. Keep logical tiles at 16 but allow larger sprites/set pieces. Reject the fractional-scale fallback for a strict pixel mode. **Wrong-call cost:** larger UI/portrait needs could force asset rework; prove a hero, a boss silhouette, and a boon panel before mass production. |
| **3. Fixed camera: strength or cage?** | **Strength for combat; cage only if every authored location must be the same rectangle.** Use fixed, bounded combat chambers linked by short transitions. Allow a bounded follow camera later for town/exploration, not scrolling bullet fights now. `app.ts:43`, `presenter.ts:183–191` are the camera seams. **Wrong-call cost:** designing giant rooms first creates offscreen-threat and input-coordinate rework. |
| **4. Keep no contact damage?** | **Yes.** Damage must belong to a named attack, projectile, or hazard. Charger dash contact already follows that rule. Keep soft body separation, but repair its wall violation (`step.ts:43–48`, probe). Telegraph hazard activation; do not label arbitrary touching a telegraph. **Wrong-call cost:** crowding can become exploitable, so test trapping/body-blocking; blanket contact damage would obscure blame and devalue melee. |
| **5. Is the slice enough to prove fun?** | **Enough to prove the sword; insufficient to prove a roguelike run.** Fix the input defect before adding rewards. The smallest new combat content is one deliberate three-lane Caster fan: swing-cut, sidestep, and dodge should be distinguishable answers. Existing kite cuts only 0–3 bolts per full run. **Wrong-call cost:** if feel remains weak, more enemies or loot would hide it temporarily and multiply rework. |
| **6. Do eleven arena rounds disprove code-generated tiles?** | **No.** They disprove this iteration method's convergence so far. The 719-line generator can produce useful base tiles; repeated furniture edits did not create hierarchy/material craft. Use artist-led room composition, authored key props/characters, and generated candidates with pixel cleanup. **Wrong-call cost:** replacing a generator without an art direction merely makes inconsistent assets faster. |
| **7. Highest-leverage next build?** | **A trustworthy combat proof, not a fifteenth isolated polish piece.** Fix chain aim and proof defects, keep the room, add the one fan pattern only after the base sword trial, and capture real attempts with input/damage attribution. This tests control, defense, enemy composition, and the art requirements together. **Wrong-call cost:** a week of bounded testing; skipping it risks months building on an unliked action loop. |
| **8. What assumptions are wrong?** | Zero allocation/event ring claims; sufficient hash coverage; p95 callback time as FPS; all tuning is live; 64 projectiles as a full-game ceiling; pretty-room-first proof; rewards as a cure for combat. Source contradictions and probes are above. **Wrong-call cost of retaining them:** regression tests bless divergent states, bosses silently omit bullets, and agents optimize screenshots instead of decisions. |
| **9. What should not change?** | Pure fixed-tick combat, input replays, explicit commitment/recovery, no idle contact damage, melee interaction with bullets, a simulation/presentation boundary, pixel-art destination, and immediate retry. Each has useful source/trace evidence. Keep the principles, not every present constant. **Wrong-call cost:** discarding them removes the strongest iteration and fairness advantages. |
| **10. Continued iteration or structural reset?** | **One bounded composition reset, then continued iteration.** Before the third playable room and before shipping the first boon/second weapon, replace global sword/arena ownership with run → room → actor definition/state ownership. Do not replace Pixi, the fixed tick, or all enemy code. **Wrong-call cost:** too early/general becomes framework work; too late spreads sword flags and stale-room presentation across content. Prove the boundary with real rooms and two move sets. |

### 4a. Bones against every concrete vision requirement

Costs below are rough focused implementation days, not elapsed schedules or art-production quotes. They assume current scope and existing tools. They include a first proof, not production content or release QA.

| Vision capability | Current shape | File evidence | Smallest change that makes it help; cost |
|---|---|---|---|
| Run state | **Fights** | `world.ts:57–88`; `main.ts:54–61`; no run owner | Small `RunState` above room world, seeded decisions, actor loadout, room history, versioned checkpoint; **2–4 days** |
| Room graph/transitions/save | **Fights** | `arena.ts:26–105`, `scenarios.ts`, `presenter.ts:39–69` | Three data rooms, two exits, complete room presentation teardown/rebind, save/resume one checkpoint; **3–5** |
| Realm package | **Fights** | Tile/prop IDs in arena; light/atmosphere created once (`presenter.ts:41–53`) | Realm asset/palette/audio/enemy references, room loading contract, independent cosmetic RNG; **2–4** |
| Enemies/patterns/bosses | **Helps**, within the small roster | Separate FSM modules; typed attack events; `world.ts:55,112–120` capacity limits | Deterministic pattern scheduler, phase state, explicit 256-capacity policy, one 200-bolt case; **3–5** |
| Weapons | **Fights** | `player.ts:42–48,72–81,127`; sword view `views.ts:92–133`; projectile has no faction | Actor move-set definition, charge/special input, friendly projectile ownership, sword+bow proof; **3–6** |
| Boons/statuses | **Fights** | Global `tuning.player`; direct damage/status rules in `combat.ts`; no modifier owner | Derived stats plus a small typed trigger/status resolver with stable order; five behavior-changing boons first; **3–6** |
| Hazards/interactables | **Neutral** | Solid grid and props exist (`arena.ts`); no object behavior | One telegraphed hazard and one chest/rescue interaction, separate visual and collision footprints; **2–4** |
| Meta progression | **Neutral** | Reset recreates world; no persistent save (`main.ts:54–61`) | Versioned local save, run-result transaction, one unlock/currency with exactly-once reward; **2–4** |
| Town | **Neutral** | Input and rendering reusable; combat mode implicit in `main.ts` | Explicit noncombat mode, one small location, weapon rack and one NPC; **3–5** |
| Narrative | **Neutral** | Typed events are useful inputs; only banners/result sounds exist | Data dialogue keyed to recorded run facts, deterministic priority, seen-line state; **2–4** |
| Audio | **Helps**, for cues | Event map reusable; single master (`audio.ts:16,51,70`) | Separate buses, one state-driven music layer pair, bounded voices and peak meter; **2–4** |
| UI/accessibility | **Fights** | `hud.ts` hardcodes combat shell; no menu/focus state | Shared modal/choice state, pause/options, boon panel, gamepad glyphs, shake/flash settings; **3–5** |
| Performance/browser | **Helps**, with unproven budgets | Fixed tick, baked room, pooled sprites; live stress and overflow evidence | Supported moving stress scenario, batching, browser/device matrix, bounded asset loading; **2–4** |
| Agent velocity | **Helps**, after corrections | Scenarios, replays, shots, tests; false metrics/hash/capture limits above | Reusable scenario/expected-state/timed-media packet and exact-head checkpoint; **1–3** |

These tasks overlap. Do not add their estimates as though fourteen independent teams can finish them simultaneously. Room lifecycle, definitions, and save ownership are shared decisions.

**Requested concrete stress cases:** an eight-room floor touches room definitions/graph, `main.ts`, `scenarios.ts`, presenter lifecycle, and map UI. A dodge-distance passive must derive a player's distance from immutable base stats; it must not edit global tuning. A run inventory belongs above room resets. A three-phase boss needs stored phase/emitter clocks and room-hazard changes, all in the replay. Music reacts through audio state, not per-frame source recreation. Title/pause live above combat stepping. Rumble belongs in an input/output adapter consuming hurt/heavy events, with a user setting and physical-device test; it must not enter the deterministic simulation.

### 4b. Positions on all open design decisions

| Decision | Recommendation | Reason, cost, and boundary |
|---|---|---|
| Hades doors vs Spire nodes | **Door-first hybrid.** Two or three reward-marked exits; a compact realm map on demand showing visited rooms and one revealed branch ahead. | Keeps action moving and gives route anticipation. Store a seeded graph and committed choice; add a small map UI after doors work. Do not begin with a full-screen route planner or backtracking floor. Roughly **3–5 days** for first graph/transition/save/UI proof. |
| Realm order/count | **Two fixed-order realms for the first complete run. Three per full-length run later**, with a choice of unlocked next realm at boundaries. | Fixed early order makes learning and balance testable. Later branching expresses exploration without arbitrary difficulty jumps. Separate tier difficulty from realm identity. One extra graph rule is cheap; building interchangeable realm content is not. |
| Room production | **Authored rooms with constrained variation.** | Artists own architecture, material hierarchy, collision and sightlines; seeds select legal spawns, rewards, and a few prop variants. Avoid procedural geometry until authored-room fun and art are proven. First three room definitions plus validation: **2–4 days**, art separate. |
| Camera | **Fixed combat chambers; bounded follow only where exploration warrants it.** | No offscreen bullet attacks. Preserve a camera transform abstraction now, not a scrolling feature. **Less than a day** to isolate transforms; **2–4 days plus new encounters** if later adding follow/bounds. |
| Contact damage | **Keep none outside named attacks/hazards.** | Melee needs fair access through crowds. Fix separation and clear-state safety first. One small regression pass, not a combat redesign. |
| Deity/boon presentation | **Pause into a pixel portrait, short address, three readable choices with exact effect/stack preview.** | A 96-pixel portrait and three vertical choice rows fit 480×270 better than three decorated card columns. Use a 10–12-pixel readable font, keyboard/gamepad focus, and a details pane. Text first; optional voice later. **2–4 days UI**, portrait/writing/audio separate. |
| Scope | **The counted two-realm run below.** | Prove a beginning, route choice, evolving build, bosses, failure/return, and one persistent consequence. Do not build five religions' worth of content before this. |

### 4c. Minimum complete run, with counts

This is a **compact complete prototype**, not the eventual content promise:

- **2 realms**, initially fixed order; **8 selected nodes each**: six combat, one event/shop/rescue, one boss. Door choices select alternatives, not extra mandatory rooms.
- **12 authored combat room layouts**, six per realm, with two tested encounter configurations each. Four special-room layouts total; two boss arenas.
- **8 ordinary enemy types**, four per realm; two distinct elite modifiers; **2 bosses**, each with three clearly telegraphed phases. No additional miniboss for this milestone.
- **2 weapons:** greatsword and bow, each with basic attack and special. One starting aspect each. No aspect tree until the two identities work.
- **24 boons** offered by four deities: 16 core, four advanced, two duo, two legendary. At least half alter behavior, not just scalar damage. One explicit curse/tradeoff and repeat-stack preview.
- **1 small town**, three NPCs, weapon rack, upgrade station, and return/archive station. One rescue visibly changes a town location. Three artifacts unlock something concrete. One permanent currency and one run-only currency.
- Title, pause/options, run summary, boon list, route preview, versioned local save, and checkpoint resume. Keyboard/mouse and gamepad; no touch milestone.

Aim at **18–25 minutes** for this first complete run. Twelve combat encounters at 45–75 seconds give 9–15 minutes; two bosses at 2–3 minutes give 4–6; choices, events, and return take roughly 3–4. The final **three-realm** structure can reach the fixed 25–45-minute ambition without padding: 18 combat encounters, three bosses, and meaningful choices. These are budgets to test, not reasons to inflate enemy HP. The current 40-second room can remain a useful encounter length.

### 4d. Realm and ten-boon design sketch, written as data

**Proposed data, not implemented or balanced.** This is a fictional Greek-inspired first realm. Deity names identify proposed game roles, not claims about doctrine. Art, writing, and cultural review are required. The sketch deliberately demands room ownership, directional attacks, statuses, friendly projectiles, progression, and readable choices that the present code cannot yet express.

```yaml
realm:
  id: greek.lower_river
  title: The River of Unsaid Names
  tier: 1
  camera: fixed_chamber
  room_pool: [quay, broken_bridge, toll_hall, reed_court, archive, ferry_steps]
  variation: [legal_spawn_set, reward_offer, minor_props]
  materials: [wet_basalt, aged_bronze, bleached_reeds]
  palette: {floor: charcoal_teal, structure: pale_stone, souls: warm_ivory}
  threat_language: {projectile: bright_core, windup: directional_shape, danger: warm_red}
  signature: a ferry whose mooring ropes continue as luminous soul threads
  enemies: [oar_guard, name_scribe, reed_runner, toll_bell]
  elite_modifiers: [echoed_tell, guarded_recovery]
  hazards:
    - {id: river_surge, tell_ticks: 60, active_ticks: 90, safe_lanes: 2}
  boss:
    id: keeper_of_the_mooring
    phases:
      - {hp_above: 0.66, patterns: [aimed_triplet, oar_sweep]}
      - {hp_above: 0.33, patterns: [rotating_gapped_ring, river_surge]}
      - {hp_above: 0.00, patterns: [alternating_walls, delayed_echo]}
    projectile_budget: 200
    simultaneous_hazards_max: 1
    transition_rule: cancel_hostile_emitters_and_clear_bolts
  presentation:
    room_art: realms/lower_river/rooms
    light_preset: reflected_water
    music: {base: ferry_drone, combat: oar_pulse, boss: mooring_break}
    ambience: water_and_rope
  deities: [hermes, hecate]
  cross_realm_guest: anubis
  exit: {reward: rescued_name, town_fact: archive_first_name_returned}

boon_rules:
  slots: [attack, special, dodge, passive]
  slot_replacement: explicit_choice_with_preview
  acquisition_order: recorded_in_run
  stats: flat_then_additive_percent_then_capped_multiplier
  trigger_order: source_boon_id_then_target_id
  proc_policy: [once_per_attack_per_target, secondary_damage_cannot_retrigger_origin]
  status_time: simulation_ticks
  save: [boon_id, rank, rarity, cooldown_remaining, status_stacks]
  no_runtime_code_in_data: true

boons:
  - id: hermes.borrowed_step
    title: Borrowed Step
    slot: dodge
    rarity: common
    stacks: {max: 3, distance_multiplier: [1.15, 1.25, 1.32]}
    effect: {kind: dodge_stat, keep_duration_and_iframes: true}

  - id: hecate.lantern_cut
    title: Lantern Cut
    slot: attack
    rarity: common
    stacks: {max: 3, mark_duration_ticks: [180, 240, 300]}
    effect: {on: primary_hit, kind: apply_mark, max_marks_per_target: 1}

  - id: hecate.second_shadow
    title: Second Shadow
    slot: special
    rarity: rare
    stacks: {max: 1}
    effect: {on: special_end, kind: replay_attack_shape, delay_ticks: 30,
             damage_fraction: 0.4, origin: secondary, repeat_charge_cost: false}

  - id: hermes.stolen_momentum
    title: Stolen Momentum
    slot: passive
    rarity: common
    stacks: {max: 3, recovery_reduction_ticks: [2, 3, 4]}
    effect: {on: primary_hit_after_dodge, window_ticks: 45,
             kind: reduce_current_recovery, minimum_recovery_ticks: 4}

  - id: hecate.unbound_ember
    title: Unbound Ember
    slot: passive
    rarity: rare
    stacks: {max: 1}
    effect: {on: bolt_cut, kind: bank_charge, max_charges: 3,
             consume_on: special, result: friendly_fan, damage_each: 1}

  - id: anubis.measured_heart
    title: Measured Heart
    slot: passive
    rarity: rare
    stacks: {max: 1}
    effect: {on: dodge_avoids_damage, kind: grant_guard, charges: 1,
             duration_ticks: 120, cooldown_ticks: 360, prevent_damage: 1}

  - id: hermes.ferrymans_debt
    title: Ferryman's Debt
    slot: passive
    rarity: rare
    stacks: {max: 1}
    effect: {kind: tradeoff, room_currency_multiplier: 1.5,
             heal_received_multiplier: 0.5, expires: run_end}

  - id: hecate.returning_name
    title: Returning Name
    slot: passive
    rarity: epic
    requires: [hecate.lantern_cut]
    stacks: {max: 1}
    effect: {on: marked_enemy_killed, kind: transfer_mark,
             targets_max: 1, radius_px: 48, secondary_kills_trigger: false}

  - id: duo.crossing_without_shadow
    title: Crossing Without Shadow
    slot: passive
    rarity: duo
    requires_all: [hermes.borrowed_step, hecate.lantern_cut]
    stacks: {max: 1}
    effect: {on: dodge_end, kind: trigger_crossed_marks,
             once_per_target_per_dodge: true, consumes_marks: true,
             damage_each: 2, origin: secondary}

  - id: hecate.last_lantern
    title: Last Lantern
    slot: passive
    rarity: legendary
    requires_all: [hecate.unbound_ember, hecate.returning_name]
    stacks: {max: 1}
    effect: {on: special_with_full_charges, kind: delayed_mark_burst,
             tell_ticks: 30, radius_px: 48, target_limit: 5,
             damage_each: 2, origin: secondary}
```

Implement only the finite effect kinds needed by the first five boons. This is not permission to build a scripting VM. Rarity changes explicitly listed parameters; it does not apply a hidden global damage multiplier. Duplicate offers upgrade rank only to the stated cap; capped offers leave the pool. Duo/legendary prerequisites are visible. Save stable IDs and remaining clocks, never closures.

The present `Player` has no special/charge state, projectiles have no owner/faction, status marks have no home, and `boltCut` carries too little provenance for safe effect chaining. Those are the exact seams this sketch exposes. Resolve gameplay effects inside simulation before emitting presentation events. An audio or particle listener must never become a boon mechanic.

Tests must prove order independence where specified, explicit order where intended, no infinite secondary procs, one reward per clear, stable save/resume, and weapon-independent behavior. A +15% dodge-distance boon must change distance while preserving duration/iframes; test that instead of changing a global value and hoping.

## 5. The fun question

### What I actually experienced and what I did not

I observed the live game in Chrome, issued native J/Space presses, recorded the resulting four-second smoke test, studied god-mode enemy poses, and inspected full deterministic runs. **I did not play three continuous keyboard runs.** Held movement through the supported Chrome interface was unavailable; raw CDP input returned an explicit unsupported-method error. I did not bypass that control boundary. The saved successful replay is clearly labeled **automated**, not my best personal run.

Therefore I cannot honestly write “after ten seconds I felt…” or “after my third run I wanted another.” Here is the supported assessment at those horizons:

| Horizon | What the evidence supports | What still needs a person |
|---|---|---|
| First 10 seconds | Immediate movement/attack vocabulary, readable isolated Brute tell, real hit reaction. Idle is already dead at 8.6 seconds; native presses latched. The room/title draw more attention than the hero. | Whether the controls explain themselves and the first loss feels fair. |
| First 60 seconds | Kite has cleared before 44 seconds; naive is usually dead before 22. The room offers no further choice. Strong contacts exist, but tracking a moving target through a locked combo can frustrate intent. | Whether a player learns to commit/cancel, and whether the minute feels dense rather than repetitive. |
| Third run | Restart uses the same seed and the same encounter arrangement. There is no new build, route, reward, or narrative consequence. | Whether mastery alone produces a voluntary fourth/fifth run. No human evidence was collected. |

**Moments that work in the observed evidence:** alternating wide cuts; one heavy hit finishing or staggering a Brute; cutting a bolt; the Charger's committed travel and recovery; a kill leaving a persistent mark. **Moments that do not:** redirected input failing to redirect the next swing, overlapping muted bodies obscuring the cause of damage, an enormous title over a tiny actor, and a clear state that is not actually safe. These are supported by the strips, probes, and images, not invented tactile impressions.

### One addition, one removal, one tuning change

- **Addition:** one Caster fan pattern with three separated lanes, a clear lock cue, and cuttable bullets. It should make walking the gap, rolling, cutting, and committing to the caster different choices. This uses the existing melee/bullet hook and addresses the low observed bolt-cut count. Test it after the corrected base sword, without boons.
- **Removal:** remove the full-screen white flash from ordinary kills in an A/B build. Preserve local flash, debris, sound, and heavy-hit emphasis. In `kill-strip.png`, the broad wash hides nearby information; dense combat will amplify that cost. This is an A/B proposal, not a measured preference.
- **Tuning change:** test heavy recovery **22 → 18 ticks**, leaving startup, active window, poise, and early dodge-cancel boundary unchanged. The current heavy pays both an aim-control defect and long recovery. Fix aim first; then test whether the shorter tail preserves commitment while reducing dead time. Do not declare the new number correct before play.

**Proof of fun:** five fresh players, up to five attempts each; record input plus damage source and matched audiovisual clips. Ask for unprompted attack/dodge descriptions and death attribution. A practical first gate is at least four players correctly explaining their last death and at least three choosing another attempt without prompting after attempt three. Report individual outcomes and disagreement; a tiny sample is directional, not population proof. Keep the 2–5-deaths-before-clear target as a hypothesis to measure, not a label attached to `naive-melee`.

## 6. Top ten better-off moves

Ranked by expected project benefit divided by focused cost. Estimates are deliberately coarse. “Days” means implementation effort; artist, writer, participant, and device access are separate.

| Rank | Move | Why it matters / what it unblocks | Cost | Visible or measurable success |
|---:|---|---|---|---|
| 1 | Repair proof contracts: complete hash, shared quantization, dodge identity, reset metrics, timed capture | Every later agent decision depends on these readings | 1–3 days | Perturb each future-state field and detect it; Node/browser checkpoint equality; one dodge counted once; pose assertions and per-frame capture agree |
| 2 | Correct combo aim and run the bounded combat trial | Tests whether there is a game worth scaling | 1–3 days plus players | New aim affects next swing, never current active stroke; 25 documented human attempts and voluntary-retry evidence |
| 3 | Write a compact art direction and frame grammar | Stops repeated guesses and inconsistent generated assets | 1 artist/designer day | One annotated hero/enemy/room/boon mockup at 480×270 with palette, materials, silhouettes, and threat priority agreed |
| 4 | Establish run → room → actor ownership | Prevents global tuning and room state becoming inventory/story state | 3–6 days, shared with #5/#7 | Room transition preserves loadout, clears transient combat, and resumes deterministically from a checkpoint |
| 5 | Implement three authored rooms and two honest exits | Proves lifecycle, graph, rewards, and exploration | 3–5 days plus room art | Different collision, lights, props, and music load without leftovers; each exit commits one reward exactly once |
| 6 | Prove one animated hero and enemy in the real renderer | Retires the highest art risk before large commissions | 3–8 days including cleanup | Eight-direction walk/attack/roll/hit/death clips, matched hit timing, stable pixels, puppets coexisting; blind motion review |
| 7 | Ship a sword/bow and five-boon composition proof | Exposes the needed weapon, projectile, stat, and trigger contracts | 3–7 days after ownership | Both weapons feel distinct without boons; each boon changes a documented decision; no global tuning mutation or proc loop |
| 8 | Support and profile the first dense boss pattern | Finds capacity/batching problems before content scales | 2–5 days | Real 200 moving bolts, explicit overflow, under 200 draw calls as initial budget, stable 60 fps on named target devices |
| 9 | Close death → town → next run with one rescue | Makes the bardo premise visible and gives failure a consequence | 3–6 days plus writing | Failure preserves exactly the intended unlock, one NPC reacts, reload is safe, next run starts promptly |
| 10 | Establish mix, menu, and accessibility baselines before multiplying realms | Prevents every new realm/weapon inventing its own output/control conventions | 3–5 days | Separate audio buses, recorded no-clipping mix, coherent focus/glyphs, pause, remap, shake/flash options |

The next builder should not execute all ten in parallel. The first two create the evidence that determines the size of the rest.

## 7. Full-loop path and revised order of proof

**Structural reset verdict: one, named “run and combat composition boundary.”** It precedes the first production room transition and the first shipped boon/second weapon. Replace ownership, not the simulation/renderer stack. The asset adapter is an incremental migration, not a second engine reset.

| Milestone | Playable proof | Work and reason for order |
|---|---|---|
| 0. Truth and fairness | Existing room, accurate inputs/results | Fix chain aim, post-clear damage, overlap/wall invariant, hash/metrics/capture. No new content should cover these defects. |
| 1. Sword trial | Same room is enjoyable without rewards | Human trial; one fan-pattern variant only after the base control trial. Adjust recovery/readability with evidence. |
| 2. Art contract | Same encounter with one custom hero and enemy | Prove directional frames/pivots at final camera. Do not wait for every enemy animation before the next gameplay proof. This narrows the vision's full art-swap step. |
| 3. Composition reset + three rooms | Enter a different room through a reward-marked door | Run owner, room definition, lifecycle, immutable stats, checkpoint. A real room change verifies the abstractions. |
| 4. Weapon + boon cross-check | Sword and bow each use the same five boons | Bring the second weapon forward to validate the modifier layer while it is small. Otherwise sword-shaped boons will masquerade as general data. |
| 5. One realm and one boss | Short route ends in a three-phase fight | Pattern scheduler, hazards, safe clears, one realm art/audio package, 200-bolt/browser proof. Add content only after the supporting contracts work. |
| 6. Death and return | Win or fail, return to a small town, see one consequence | Versioned meta save, one rescue/unlock, one reactive NPC. The bardo loop now exists. |
| 7. Two-realm complete run | The counted prototype in section 4c | Prove tier ramp, route choice, checkpoint/reload, build variety, repeat-run motivation. Art swap covers production rooms/roster here. |
| 8. Scale toward full release | Three-realm 25–45-minute runs | Add only validated content families: realms, weapons/aspects, boons, NPCs, story. Expand platform and accessibility QA, then heat/rare routes. |

This retains combat-first order. It changes two things: the initial custom art proof is small rather than an entire roster, and the second weapon validates boons early. It adds save/lifecycle proof before a floor makes failures hard to diagnose. No milestone passes solely because a critic likes its screenshot.

## 8. Art evolution path

### Direction before production

Write one short direction document with actual painted/edited examples: actor silhouette language; floor/wall/metal/water material treatment; light direction; danger versus reward colors; outline/value rules; camera/actor scale; UI font and portrait style; shared bardo soul motif; and what differs per realm. Include prohibited shortcuts: noisy floors under bullets, decorative threats that resemble damaging ones, giant noninteractive central badges, and arbitrary mixing of asset packs.

Keep the pixel-art destination from `VISION.md`. Do not compare a 16-pixel static hero with an HD painted hero and conclude that the renderer must change. Use the Hades reference for action clarity, decision flow, and presentation rhythm; use the Gungeon reference for pixel materials, threat separation, and patterned density.

### Pipeline, in order

1. **Choose an actual hero silhouette at game scale.** Keep 480×270. Test 24–32-pixel body height with a stable foot anchor, shadow footprint, and visible weapon. Put it beside all three current enemies and a large boss silhouette.
2. **Author a master character and directional reference.** Use an artist, PixelLab candidates, or both. The official [PixelLab API documentation](https://api.pixellab.ai/v2/docs) describes directional character/animation workflows; that is capability evidence, not a guarantee of consistent production art. No generation was run for this audit.
3. **Generate/author walk, three attacks, roll, hurt, and death**, in eight directions where silhouette changes justify them. Use hand cleanup for contact poses, hands/weapons, pivots, and transitions. Do not accept all generated frames as a coherent set without review.
4. **Replace numeric IDs with semantic asset entries** containing frame rectangles, duration ticks, direction, pivot/feet, optional weapon sockets, shadow footprint, and flash-mask handling. Keep source art, editable cleanup, provenance/license, and import settings together.
5. **Adapt `atlas.ts` and `EntityView`.** A clip chooses its texture from simulation state/action tick/direction. Cache flash textures or masks per frame. Keep squash, recoil, hop, trails, and camera effects as restrained secondary motion. Puppet mode remains valid per entity; it must not rotate an already authored full-body attack twice.
6. **Validate timing.** Authored contact markers must match the sim's active window. The sim does not wait for a visual frame or a load promise. Freeze combat-driven pose time during hit-stop, while deliberate particles/camera may continue. Add screenshots at each timing boundary, not only an appealing midpoint.
7. **Build one authored room as layers:** floor/background, occluding foreground, collision, props, emitters/lights, exits, and interaction anchors. The floor may be one painted pixel texture rather than tiled art. Keep collision and semantic objects as data. Do not derive walls from opaque pixels.
8. **Prove transition/disposal.** `Presenter.bindWorld` must replace every room-bound view and resource. Load a radically different second room repeatedly; inspect geometry, particles, lights, sound, and resource counts. Then scale the pipeline.

**Hardest replacements:** the hero's directional weapon/body relationship; a boss spanning multiple collision/telegraph regions; and room set pieces whose visual footprint exceeds their collision tile. Simple floor textures are easy. The current shatter code samples a texture assuming the old sprite shape (`particles.ts`); it needs frame-aware bounds and should not turn a 64-pixel boss into uncontrolled debris. The importer/generator both rewrite the manifest, so asset ownership must become one explicit build step before automation produces a second pack.

**Resolution decision gate:** keep 480×270 unless the hero/boss/boon-panel proof fails legibility after competent art and layout. If it does, compare a single 640×360 version before producing the rest. Do not mix scales per realm or upsample old art and call that more detail. Fix strict integer output/letterboxing and declare a minimum playable viewport. The present phone crop is not an art problem.

## 9. Do not touch

- Pure, deterministic combat time and explicit input frames. They made this audit reproducible.
- Simulation state separate from presentation/audio. Art swaps should not change damage rules.
- Named attacks with commitment and punish windows. Preserve fairness while tuning their values.
- No damage from merely touching an idle enemy. Hazards and dash attacks must remain attributable.
- Melee cutting bullets. It is the strongest existing bridge between sword combat and the requested density.
- Small modules and direct functions. Do not replace them with an ECS or generic effect platform without a demonstrated need.
- Pixel-art destination; fixed combat-room visibility; low-resolution effects that share the game's visual scale.
- Fast reset, useful bot policies, and replay fixtures. Strengthen their contracts rather than deleting inconvenient checks.

These are principles, not protected bugs. The hash fields, pool capacity, global tuning ownership, art IDs, and every current effect magnitude are changeable.

## 10. Strike list

1. **“All numbers are in tuning, and live edits are universal.”** They are not. Grade uniforms are captured in the constructor; numerous AI/render values are local. Classify design controls versus implementation constants.
2. **“A matching hash proves identical worlds.”** Not with the current field list and quantization. Hash future state and validate checkpoints.
3. **“Successful dodges / dodges measures defensive skill.”** Not until projectile avoidance and deduplication are correct.
4. **“No allocations; event ring; ParticleContainer.”** Replace inaccurate architecture prose with the implementation and a measured allocation budget.
5. **“Shot p95 means locked 60 fps.”** It measures a callback. Keep CPU, rAF, GPU, frame presentation, and device/browser lanes separate.
6. **“64 bullets is enough because this room uses few.”** It fails the explicit 200-projectile vision and silently changes attacks under saturation.
7. **“480×270 makes output fill cost trivial.”** Final-quad filters run at output resolution. Test 4K and weaker devices.
8. **“One static sprite per entity is the final animation plan.”** It contradicts the fixed custom-frame pillar and weakens weapon identity.
9. **“Win an empty-room still before proving combat.”** Current GAUNTLET text already corrects this; make execution and progress state match.
10. **“Eleven rounds mean eleven independent trials.”** The record does not prove that. Record reviewer independence and missing evidence.
11. **“Keep looping until wowed” without an enforceable stall boundary.** After two same-gap misses, change the method and park the work honestly.
12. **“A 60–120-second room is inherently better.”** Current clears are shorter. Test decision density and total run duration; do not pad HP to satisfy a stale proxy.
13. **“A seed sweep simulates new players.”** It measures one policy over seeded initial conditions. Human learning remains a separate experiment.
14. **“More decoration, more flash, or more boons will fix weak control.”** The aim probe and strips provide a concrete reason to address control first.

## 11. Risks and traps

| Risk | Failure mode | Guardrail |
|---|---|---|
| False confidence from harness | Green tests/hashes hide changed future state or unreadable motion | Contract tests, checkpoint comparison, timed audiovisual captures |
| Scope inflation | Five realms, hundreds of boons, and a town arrive before a fun sword | Counted two-realm milestone and human gates |
| Global mutable tuning | One boon affects every actor or replay environment | Immutable definitions, local derived state, content revision in saves/replays |
| Trigger explosions | On-hit/kill/echo boons recurse or duplicate rewards | Stable source IDs, explicit proc policy, capped targets, deterministic ordering |
| Room lifecycle leaks | New room retains old collision art, light, props, sound, or resources | Different-room transition/reload loop with resource inspection |
| Silent capacity loss | Boss pattern looks easier or inconsistent because spawns fail | Explicit overflow/capacity telemetry; admitted-count assertions |
| Visual noise | Floor, title, flash, and effects hide attack cause | Native-scale motion review with actor/threat hierarchy |
| Asset incoherence | More generated art creates more cleanup than content | One master style/character, provenance, import validation, artist acceptance |
| Miscalibrated difficulty | Bot targets encourage sponge enemies or unreadable swarms | Human learning/death attribution and separate room/run duration budgets |
| Cultural flattening | Distinct underworld traditions become interchangeable monster skins | Research, editorial ownership, and cultural review before content lock |
| Browser overclaim | A fast Mac and a tiny sample become a platform guarantee | Named hardware/browser matrix, long moving stress test, cold-load measurements |
| Process drift | Docs say parked/sword-first while UI says building/arena-first | One durable state record, exact head, evidence links, no invented pass |

## 12. First five actions for the next builder

1. **Add failing regression tests for chain aim, post-clear projectile damage, wall overlap, full-pool spawn behavior, hash coverage, and dodge counting.** Extend existing suites. Success: each test fails for its intended reason on this head; the proposed fix makes it pass without weakening assertions.
2. **Repair the bounded defects and capture path.** Make metrics current after reset; share frame quantization; capture rendering at known tick intervals. Success: Node/browser checkpoints and visible pose/contact boundaries agree, including kill shatter and settled death state.
3. **Run the corrected sword trial.** Keep one room, no boons or town. Capture five people over five attempts, including sound. Success: the report contains actual voluntary-retry and death-attribution evidence, and one next tuning decision justified by it.
4. **Write and test the art contract.** One hero, one Brute, one native-scale room crop and boon-panel mockup; direction, pivots, contact timing, and cleanup included. Success: independent motion review can identify the three attacks and incoming tell without debug overlays.
5. **Build the composition proof.** Run owner, three data rooms, two exits, save checkpoint; then sword/bow plus five small boons. Success: a room transition changes all room presentation, preserves exactly the chosen run state, and replay/save-resume yields the same complete checkpoint.

Stop between these gates when evidence contradicts the plan. Do not build the rest of the content list as a way to avoid the result.

## 13. Appendix — reproducible evidence

Detailed tables, command summaries, capture inventory, limitations, and source preservation follow.

### 13a. Check and command results

All repository commands ran from the root. Exact argument arrays, stdout, stderr, exit codes, and elapsed times for substantive checks are in [commands.jsonl](public/progress/audit/commands.jsonl). The [shell command ledger](public/progress/audit/shell-command-ledger.md) also lists inspection/asset-analysis commands; the [browser command ledger](public/progress/audit/browser-command-ledger.md) lists browser operations, including failed attempts. Generated helper scripts are retained for reproduction. Ordinary source reads are evidence acquisition, not validation passes.

| Command / evidence log | Exit | Elapsed seconds | Result |
|---|---:|---:|---|
| [`git status --short`](public/progress/audit/git-before.log) | 0 | 0.02 | See recorded output |
| [`pnpm typecheck`](public/progress/audit/typecheck.log) | 0 | 2.651 | Project typecheck passed |
| [`pnpm test`](public/progress/audit/tests.log) | 0 | 1.294 | 18/18 tests, two files |
| [`pnpm sim -- --scenario wave1 --bot idle --seeds 1-8`](public/progress/audit/sim-wave1-idle.log) | 0 | 0.653 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario wave1 --bot naive-melee --seeds 1-8`](public/progress/audit/sim-wave1-naive-melee.log) | 0 | 0.619 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario wave1 --bot kite --seeds 1-8`](public/progress/audit/sim-wave1-kite.log) | 0 | 0.602 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario wave3 --bot idle --seeds 1-8`](public/progress/audit/sim-wave3-idle.log) | 0 | 1.058 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario wave3 --bot naive-melee --seeds 1-8`](public/progress/audit/sim-wave3-naive-melee.log) | 0 | 1.059 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario wave3 --bot kite --seeds 1-8`](public/progress/audit/sim-wave3-kite.log) | 0 | 0.827 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario full --bot idle --seeds 1-8`](public/progress/audit/sim-full-idle.log) | 0 | 0.65 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario full --bot naive-melee --seeds 1-8`](public/progress/audit/sim-full-naive-melee.log) | 0 | 0.75 | Eight seeds; all rows below |
| [`pnpm sim -- --scenario full --bot kite --seeds 1-8`](public/progress/audit/sim-full-kite.log) | 0 | 0.662 | Eight seeds; all rows below |
| [`pnpm sim -- --replay replays/idle-wave1-s5.json`](public/progress/audit/replay-idle-wave1-s5-1.log) | 0 | 0.591 | Replay completed; hash/state in log |
| [`pnpm sim -- --replay replays/naive-wave1-s3.json`](public/progress/audit/replay-naive-wave1-s3-1.log) | 0 | 0.573 | Replay completed; hash/state in log |
| [`pnpm sim -- --replay replays/kite-full-s1.json`](public/progress/audit/replay-kite-full-s1-1.log) | 0 | 0.631 | Replay completed; hash/state in log |
| [`pnpm sim -- --replay replays/idle-wave1-s5.json`](public/progress/audit/replay-idle-wave1-s5-2.log) | 0 | 0.617 | Replay completed; hash/state in log |
| [`pnpm sim -- --replay replays/naive-wave1-s3.json`](public/progress/audit/replay-naive-wave1-s3-2.log) | 0 | 0.591 | Replay completed; hash/state in log |
| [`pnpm sim -- --replay replays/kite-full-s1.json`](public/progress/audit/replay-kite-full-s1-2.log) | 0 | 0.576 | Replay completed; hash/state in log |
| [`pnpm poses -- --out public/progress/audit/poses.png`](public/progress/audit/poses.log) | 0 | 16.58 | 29 poses; no FAILED output |
| [`pnpm shot -- --scenario dummy --ticks 60 --stepwise 1 --out public/progress/audit/dummy-stock.png`](public/progress/audit/shot-dummy-stock.log) | 0 | 4.127 | PNG plus state; capture-clock caveat applies |
| [`pnpm exec tsx public/progress/audit/probes.ts`](public/progress/audit/probes.log) | 0 | 0.554 | Targeted invariants, quantization, and warm simulation stress |
| [`pnpm shot -- … (exact arguments in log)`](public/progress/audit/shot-empty.log) | 0 | 4.802 | PNG plus state; capture-clock caveat applies |
| [`pnpm shot -- … (exact arguments in log)`](public/progress/audit/shot-dummy-debug.log) | 0 | 3.521 | PNG plus state; capture-clock caveat applies |
| [`pnpm shot -- … (exact arguments in log)`](public/progress/audit/shot-wave1-fight.log) | 0 | 4.093 | PNG plus state; capture-clock caveat applies |
| [`pnpm shot -- … (exact arguments in log)`](public/progress/audit/shot-wave3-dash.log) | 0 | 4.044 | PNG plus state; capture-clock caveat applies |
| [`pnpm shot -- … (exact arguments in log)`](public/progress/audit/shot-room-clear.log) | 0 | 3.919 | PNG plus state; capture-clock caveat applies |
| [`pnpm shot -- … (exact arguments in log)`](public/progress/audit/shot-death.log) | 0 | 3.317 | PNG plus state; capture-clock caveat applies |
| [`pnpm shot -- --scenario empty --ticks 0 --stepwise 1 --eval 'window.__out={tick:__game.world.tick}' --out public/progress/audit/stepwise-delay-probe.png`](public/progress/audit/shot-stepwise-delay-probe.log) | 0 | 2.696 | PNG plus state; capture-clock caveat applies |
| [`pnpm build`](public/progress/audit/build.log) | 0 | 4.363 | Typecheck + production build passed; Vite 788 ms |
| [`pnpm sim -- --replay public/progress/audit/automated-clear-replay.json`](public/progress/audit/replay-audit-clear.log) | 0 | 0.514 | Replay completed; hash/state in log |
| [`pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`](public/progress/audit/unused-check.log) | 2 | 1.592 | 10 diagnostics under additional flags; not a standard project gate |

An earlier unlogged timing pass also passed: `/usr/bin/time -p pnpm typecheck`, real 3.93 s; `pnpm test`, 18/18 with Vitest duration 767 ms and about 2.09 s shell time. Repeated checks in the table are the retained machine-readable measurements. `node public/progress/audit/make-sheets.mjs` invoked the existing contact-sheet tool for all five strips. `ffprobe` identified the official reference as 1920×1080, 50 fps, 22.5 s. `ffmpeg` generated the overview, 9–11 s pattern strip, and short silent comparison clip.

### 13b. Simulation matrix and targets

| Scenario | Bot | Clears / 8 | Deaths / 8 | Clear seconds | Death seconds | Max observed tick µs |
|---|---|---:|---:|---|---|---:|
| wave1 | idle | 0 | 8 | — | 8.6 | 623 |
| wave1 | naive-melee | 8 | 0 | 5.8 | — | 784 |
| wave1 | kite | 8 | 0 | 7.9 | — | 736 |
| wave3 | idle | 0 | 8 | — | 8.2–8.8 | 12097 |
| wave3 | naive-melee | 3 | 5 | 15.1–16.5 | 12.5–16.4 | 7156 |
| wave3 | kite | 8 | 0 | 16.6–21.4 | — | 2449 |
| full | idle | 0 | 8 | — | 8.6 | 726 |
| full | naive-melee | 1 | 7 | 29.8 | 19.5–21.8 | 814 |
| full | kite | 8 | 0 | 37.8–43.3 | — | 608 |

**Target assessment:** idle dies in wave 1: pass. Full skilled-proxy clear at 60–120 s: 0/8, all faster. Full naive-proxy first death at least 30 s: 0/7 deaths meet it. Two-to-five human deaths before first clear: **unmeasured**. The plan also expects idle death within 20 s; do not apply the new-player 30 s threshold to idle. Full-kite successful-dodge events total **2 over 152 dodges**; that ratio is not a success rate because the accounting is defective. Sim seconds count fixed ticks, including freeze ticks, and do not reconstruct wall-clock slow motion. Headless runs include a post-outcome tail, so end time is later than clear/death time.

The following tables include **every one of the 72 requested runs**. S/H/W = swings / hits landed / whiff swings. D/S = dodges / recorded successful-dodge events. F/C = bolts fired / cut. A/Wv = enemy attacks / waves cleared. End = final tick / reported simulated seconds, including the tail. Avg/max µs are the headless timed tick path, which includes bot/metrics overhead; they are not isolated renderer or GPU measurements. Full fields remain in [sim-matrix.json](public/progress/audit/sim-matrix.json).

#### wave1 / idle

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 13 / 623 |
| 2 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 7.2 / 253 |
| 3 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 4.2 / 291 |
| 4 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 3.9 / 195 |
| 5 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 2.6 / 116 |
| 6 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.4 / 49 |
| 7 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1 / 16 |
| 8 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.3 / 201 |

#### wave1 / naive-melee

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 17.7 / 784 |
| 2 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 9 / 312 |
| 3 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 6.3 / 189 |
| 4 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 5 / 338 |
| 5 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 4.2 / 116 |
| 6 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 4.5 / 328 |
| 7 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 2.2 / 76 |
| 8 | clear 5.8 | 467 / 7.8 | 8/8/0 | 2 | 2/0 | 0 | 0/0 | 3/1 | 2 / 35 |

#### wave1 / kite

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 17.7 / 736 |
| 2 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 8.4 / 285 |
| 3 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 5.5 / 205 |
| 4 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 3.2 / 51 |
| 5 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 3.4 / 222 |
| 6 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 2.2 / 32 |
| 7 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 2.9 / 74 |
| 8 | clear 7.9 | 596 / 9.9 | 5/8/0 | 2 | 5/0 | 1 | 0/0 | 6/1 | 2.8 / 266 |

#### wave3 / idle

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | death 8.2 | 614 / 10.2 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 22/0 | 64.6 / 12097 |
| 2 | death 8.4 | 625 / 10.4 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 21/0 | 8 / 213 |
| 3 | death 8.8 | 651 / 10.8 | 0/0/0 | 0 | 0/0 | 5 | 10/0 | 25/0 | 5.3 / 429 |
| 4 | death 8.7 | 642 / 10.7 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 22/0 | 2 / 47 |
| 5 | death 8.3 | 620 / 10.3 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 21/0 | 5.2 / 416 |
| 6 | death 8.2 | 614 / 10.2 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 21/0 | 2.5 / 275 |
| 7 | death 8.7 | 641 / 10.7 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 22/0 | 2.1 / 103 |
| 8 | death 8.7 | 641 / 10.7 | 0/0/0 | 0 | 0/0 | 5 | 8/0 | 22/0 | 2.5 / 82 |

#### wave3 / naive-melee

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | death 13.9 | 955 / 15.9 | 16/16/2 | 9 | 3/0 | 5 | 12/0 | 22/0 | 31.7 / 7156 |
| 2 | clear 16.5 | 1110 / 18.5 | 22/18/5 | 10 | 4/0 | 4 | 12/0 | 21/1 | 10 / 1217 |
| 3 | death 15.2 | 1032 / 17.2 | 21/16/5 | 9 | 3/0 | 5 | 14/1 | 23/0 | 4.2 / 376 |
| 4 | death 12.5 | 873 / 14.6 | 17/14/4 | 7 | 4/0 | 5 | 12/0 | 20/0 | 5 / 1003 |
| 5 | clear 15.1 | 1026 / 17.1 | 21/18/4 | 10 | 4/0 | 4 | 10/1 | 17/1 | 3.7 / 483 |
| 6 | death 16.4 | 1103 / 18.4 | 20/16/5 | 9 | 3/0 | 5 | 14/1 | 24/0 | 4.5 / 876 |
| 7 | death 15.1 | 1026 / 17.1 | 18/16/3 | 9 | 3/0 | 5 | 14/1 | 23/0 | 3 / 411 |
| 8 | clear 16.1 | 1086 / 18.1 | 24/18/7 | 10 | 4/0 | 4 | 13/0 | 22/1 | 2.5 / 150 |

#### wave3 / kite

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | clear 16.6 | 1116 / 18.6 | 16/16/5 | 10 | 5/0 | 3 | 13/2 | 22/1 | 20.6 / 858 |
| 2 | clear 20.2 | 1334 / 22.2 | 17/18/3 | 10 | 10/0 | 4 | 15/3 | 30/1 | 12.3 / 2449 |
| 3 | clear 21.4 | 1403 / 23.4 | 16/17/4 | 10 | 11/0 | 4 | 16/1 | 28/1 | 5.4 / 229 |
| 4 | clear 18.2 | 1211 / 20.2 | 13/18/0 | 10 | 12/1 | 4 | 13/1 | 26/1 | 2.7 / 225 |
| 5 | clear 17.5 | 1170 / 19.5 | 16/17/2 | 10 | 9/0 | 3 | 15/1 | 26/1 | 4 / 632 |
| 6 | clear 19.9 | 1313 / 21.9 | 13/18/0 | 10 | 11/1 | 3 | 17/2 | 29/1 | 3 / 212 |
| 7 | clear 16.6 | 1115 / 18.6 | 16/18/4 | 10 | 5/1 | 2 | 13/0 | 22/1 | 2.6 / 356 |
| 8 | clear 18.4 | 1223 / 20.4 | 13/18/1 | 10 | 6/0 | 1 | 14/0 | 23/1 | 1.9 / 44 |

#### full / idle

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 14.3 / 726 |
| 2 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 6.9 / 235 |
| 3 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 4.7 / 220 |
| 4 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.9 / 62 |
| 5 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.4 / 22 |
| 6 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.9 / 215 |
| 7 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.6 / 199 |
| 8 | death 8.6 | 637 / 10.6 | 0/0/0 | 0 | 0/0 | 5 | 0/0 | 9/0 | 1.3 / 48 |

#### full / naive-melee

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | clear 29.8 | 1909 / 31.8 | 34/34/0 | 15 | 5/0 | 4 | 15/2 | 24/3 | 12 / 679 |
| 2 | death 21.8 | 1426 / 23.8 | 26/25/1 | 8 | 5/0 | 5 | 12/1 | 20/2 | 7.2 / 814 |
| 3 | death 20.4 | 1348 / 22.5 | 23/23/0 | 7 | 4/0 | 5 | 10/2 | 17/2 | 3.2 / 304 |
| 4 | death 21.7 | 1423 / 23.7 | 26/25/1 | 8 | 5/0 | 5 | 12/1 | 20/2 | 2.3 / 231 |
| 5 | death 20.3 | 1340 / 22.3 | 23/23/0 | 7 | 4/0 | 5 | 10/2 | 17/2 | 1.9 / 163 |
| 6 | death 19.5 | 1290 / 21.5 | 23/22/1 | 6 | 4/0 | 5 | 10/1 | 17/2 | 2 / 272 |
| 7 | death 19.5 | 1290 / 21.5 | 23/22/1 | 6 | 4/0 | 5 | 10/1 | 17/2 | 2 / 184 |
| 8 | death 19.5 | 1290 / 21.5 | 23/22/1 | 6 | 4/0 | 5 | 10/1 | 17/2 | 1.8 / 87 |

#### full / kite

| Seed | Outcome seconds | End tick / s | S/H/W | Kills | D/S | Damage | F/C | A/Wv | Avg / max µs |
|---:|---|---|---|---:|---|---:|---|---|---|
| 1 | clear 40.6 | 2559 / 42.6 | 30/34/2 | 15 | 17/1 | 4 | 26/2 | 45/3 | 9.3 / 608 |
| 2 | clear 43.3 | 2721 / 45.4 | 30/34/3 | 15 | 22/0 | 4 | 29/3 | 47/3 | 5.5 / 382 |
| 3 | clear 39.6 | 2498 / 41.6 | 29/34/0 | 15 | 21/0 | 4 | 28/2 | 43/3 | 2.8 / 302 |
| 4 | clear 39.3 | 2477 / 41.3 | 29/34/2 | 15 | 15/1 | 4 | 24/1 | 39/3 | 1.8 / 242 |
| 5 | clear 37.9 | 2393 / 39.9 | 27/34/0 | 15 | 17/0 | 4 | 24/0 | 40/3 | 1.6 / 333 |
| 6 | clear 37.8 | 2390 / 39.8 | 28/34/1 | 15 | 17/0 | 4 | 25/0 | 41/3 | 1.5 / 177 |
| 7 | clear 37.8 | 2390 / 39.8 | 27/34/0 | 15 | 19/0 | 4 | 25/0 | 41/3 | 1.6 / 193 |
| 8 | clear 40.5 | 2552 / 42.5 | 33/34/5 | 15 | 24/0 | 4 | 28/2 | 48/3 | 1.6 / 143 |

### 13c. Replay and targeted invariant results

| Fixture | Ticks | Node pass 1 | Node pass 2 | Chrome | Result |
|---|---:|---:|---:|---:|---|
| idle-wave1-s5 | 637 | 922136030 | 922136030 | 922136030 | Matching partial-state hash |
| naive-wave1-s3 | 467 | 4088532343 | 4088532343 | 4088532343 | Matching partial-state hash |
| kite-full-s1 | 2559 | 1072443597 | 1072443597 | 1072443597 | Matching partial-state hash |

The newly recorded **automated** full-kite clear is 2,438 frames, seed 1, god false, 40.6 s, 15 kills, four damage, one HP remaining. Node replay hash: **3352101617**. [Replay](public/progress/audit/automated-clear-replay.json), [state](public/progress/audit/automated-clear-state.json), [Node result](public/progress/audit/replay-audit-clear.log). The 240-frame [native-input smoke replay](public/progress/audit/native-input-smoke-replay.json) contains two attacks and one dodge, not a full playthrough.

| Probe | Observed result | Consequence |
|---|---|---|
| Hash omissions | Eight future-affecting field changes retain hash 760607364 | Hash equality is incomplete proof |
| Combo retarget | Swing events at ticks 1/15/29 all angle 0 despite turned input | Fix at next-swing boundary |
| Post-clear projectile | Clear with one live bolt and HP 1; dead at tick 2, door still open | Room completion must define safety |
| Projectile capacity | 200 requests, 64 admitted, 136 rejected | Pattern silently changes under saturation |
| Enemy capacity | 32 active; queued Brute expires, queue becomes zero, no Brute spawns | Failed spawns need an explicit policy |
| Projectile dodge | Invulnerable avoidance, no dodged event | Success counter undercounts |
| Duplicate dodge | Two avoided hurt calls during one dodge, two success events | Success counter can overcount |
| Wall overlap | Separation pushed player x to 20.101; overlaps solid wall | Resolve separation without leaving legal geometry |
| Bot quantization | Eight raw/quantized end hashes differ; seed 8 dodge event changes | Use one canonical input path |
| Cancel boundary | Dodge requested at tick 12, starts at tick 13 | Buffered recovery cancel works at this boundary |
| Reset metrics | __game.metrics retained old instance; state().metrics current | Fix debug getter |
| Viewport | 900 wide: 1.874x; 390 wide: 480-pixel image at x=-45 | Strict pixel mode/minimum viewport needed |

Reproduce the first ten probes with `pnpm exec tsx public/progress/audit/probes.ts`; source, output, and parameter values are retained. These are scratch probes, not committed regression tests. The post-clear and overflow cases are deliberately constructed valid states, not claims that every ordinary seed reaches them.

### 13d. Performance measurements

**Warm simulation:** 32 static dummies; 500 warmup ticks, then 10,000 samples. Stationary projectiles; no renderer. This does not represent 32 fully active AI agents.

| Projectiles | Median µs | p95 µs | Maximum µs |
|---:|---:|---:|---:|
| 0 | 1.417 | 1.542 | 145.708 |
| 32 | 1.916 | 2.333 | 212.583 |
| 64 | 2.375 | 2.666 | 340.666 |

**Chrome rendering:** Apple M5 Pro / ANGLE Metal; Chrome 151; 1920×1080, DPR 1, approximately 120 Hz. Each case uses 32 static dummies and 1,500 persistent colocated additive particles. Simulation paused; normal presentation/tickers run. 45 warmup + 120 measured rAF intervals. The 200 case extends the pool in memory. No sample exceeded 20 ms. Heap snapshots ranged about 41–52 MB; this is not a leak test. GL counts are instrumented JavaScript-visible draw entry points, not GPU timings.

| Bolts | Grade | rAF median / p95 / max ms | GL draws median | Callback p95 ms |
|---:|---|---|---:|---:|
| 0 | on | 8.3 / 9.4 / 14.8 | 10 | 2.2 |
| 0 | off | 8.3 / 13.2 / 17.3 | 9 | 2.2 |
| 64 | on | 8.3 / 15.2 / 17.1 | 136 | 2.4 |
| 64 | off | 8.3 / 10.3 / 13.8 | 135 | 2.3 |
| 200 | on | 8.4 / 14.6 / 17.3 | 408 | 2.9 |
| 200 | off | 8.4 / 10.5 / 16.0 | 407 | 2.9 |

The original long browser evaluation timed out at the transport limit. The completed retained run used an asynchronous capture and later readback. It did not require source changes. [Probe](public/progress/audit/browser-perf-probe.js), [results](public/progress/audit/browser-perf.json). Do not use the grade-on/off delta as an isolated shader benchmark; samples are short and order-dependent.

### 13e. Capture inventory and interpretation

All PNG files are under `public/progress/audit/`. The [evidence index](public/progress/audit/index.html) provides a browser/phone-friendly gallery. Screenshots used explicit reset/stepwise states. Simulation determinism does not seed presentation particles. The five motion strips use selected, **nonuniform** tick intervals; frame numbers map to the ticks below. They are pose sequences, not uniformly timed GIFs.

- [chain strip](public/progress/audit/chain-strip.png): ticks 1, 4, 7, 8, 11, 18, 25, 35, 43, 49, 60, 84. [State/event trace](public/progress/audit/chain-trace.json). Raw frames `chain-00.png` through `chain-11.png`; sheet `chain-sheet.png`.
- [dodge strip](public/progress/audit/dodge-strip.png): ticks 1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 18, 22. [State/event trace](public/progress/audit/dodge-trace.json). Raw frames `dodge-00.png` through `dodge-11.png`; sheet `dodge-sheet.png`.
- [brute strip](public/progress/audit/brute-strip.png): ticks 1, 5, 10, 15, 19, 20, 23, 26, 27, 32, 48, 70. [State/event trace](public/progress/audit/brute-trace.json). Raw frames `brute-00.png` through `brute-11.png`; sheet `brute-sheet.png`.
- [charger strip](public/progress/audit/charger-strip.png): ticks 1, 4, 8, 12, 15, 16, 19, 23, 29, 38, 49, 70. [State/event trace](public/progress/audit/charger-trace.json). Raw frames `charger-00.png` through `charger-11.png`; sheet `charger-sheet.png`.
- [kill strip](public/progress/audit/kill-strip.png): ticks 1, 4, 7, 8, 9, 11, 14, 18, 24, 32, 44, 64. [State/event trace](public/progress/audit/kill-trace.json). Raw frames `kill-00.png` through `kill-11.png`; sheet `kill-sheet.png`.

| State / comparison | Artifact | Interpretation |
|---|---|---|
| Pose sheet | [poses.png](public/progress/audit/poses.png) | 29 poses; source tool has no per-pose success assertion |
| Empty arena | [empty.png](public/progress/audit/empty.png) | Seed 1, tick 60 |
| Dummy debug | [dummy-debug.png](public/progress/audit/dummy-debug.png) | Tick 8, active hit geometry |
| Stock dummy capture | [dummy-stock.png](public/progress/audit/dummy-stock.png) | Stock stepwise call, tick 60 |
| Wave 1 fight | [wave1-fight.png](public/progress/audit/wave1-fight.png) | Tick 210, naive-melee |
| Wave 3 dash | [wave3-dash.png](public/progress/audit/wave3-dash.png) | Tick 335, god-mode kite, active Charger dash |
| Room clear | [room-clear.png](public/progress/audit/room-clear.png) | Tick 2438, HP 1; bulk capture effects differ from a real-time playthrough |
| Death moment | [death.png](public/progress/audit/death.png) | Tick 556; simulation dead while presentation banner still catches up |
| Settled death | [death-settled.png](public/progress/audit/death-settled.png) | Tick 600; banner timer explicitly cleared to inspect final death UI |
| Chrome replay clear | [chrome-clear.png](public/progress/audit/chrome-clear.png) | End of full replay fixture |
| Stepwise delay probe | [stepwise-delay-probe.png](public/progress/audit/stepwise-delay-probe.png) | Observed requested tick 0; no reproduced overshoot |
| Fractional viewport | [viewport-900.png](public/progress/audit/viewport-900.png) | 900x506, DPR 1 |
| Narrow viewport | [viewport-390.png](public/progress/audit/viewport-390.png) | 390x844, DPR 1, horizontal crop |
| Anonymous pair | [comparison-ab.png](public/progress/audit/comparison-ab.png) | Our empty frame / supplied Gungeon boss still |
| Order reversal | [comparison-ba.png](public/progress/audit/comparison-ba.png) | Same pair reversed; one critic |
| Combat pair | [combat-comparison.png](public/progress/audit/combat-comparison.png) | Our wave1 frame / supplied Hades combat still |
| Neutral exhibits | [exhibit-1.png](public/progress/audit/exhibit-1.png) | Exhibits 1 through 4 are the individual normalized pair inputs |
| Official overview | [reference-overview.png](public/progress/audit/reference-overview.png) | One frame per second from official 22.5 s Gungeon website video |
| Official pattern strip | [reference-pattern-strip.png](public/progress/audit/reference-pattern-strip.png) | 9–11 s; 6 frames per second; final two cells cross a source edit |

Every generated PNG: [brute-00.png](public/progress/audit/brute-00.png), [brute-01.png](public/progress/audit/brute-01.png), [brute-02.png](public/progress/audit/brute-02.png), [brute-03.png](public/progress/audit/brute-03.png), [brute-04.png](public/progress/audit/brute-04.png), [brute-05.png](public/progress/audit/brute-05.png), [brute-06.png](public/progress/audit/brute-06.png), [brute-07.png](public/progress/audit/brute-07.png), [brute-08.png](public/progress/audit/brute-08.png), [brute-09.png](public/progress/audit/brute-09.png), [brute-10.png](public/progress/audit/brute-10.png), [brute-11.png](public/progress/audit/brute-11.png), [brute-sheet.png](public/progress/audit/brute-sheet.png), [brute-strip.png](public/progress/audit/brute-strip.png), [chain-00.png](public/progress/audit/chain-00.png), [chain-01.png](public/progress/audit/chain-01.png), [chain-02.png](public/progress/audit/chain-02.png), [chain-03.png](public/progress/audit/chain-03.png), [chain-04.png](public/progress/audit/chain-04.png), [chain-05.png](public/progress/audit/chain-05.png), [chain-06.png](public/progress/audit/chain-06.png), [chain-07.png](public/progress/audit/chain-07.png), [chain-08.png](public/progress/audit/chain-08.png), [chain-09.png](public/progress/audit/chain-09.png), [chain-10.png](public/progress/audit/chain-10.png), [chain-11.png](public/progress/audit/chain-11.png), [chain-sheet.png](public/progress/audit/chain-sheet.png), [chain-strip.png](public/progress/audit/chain-strip.png), [charger-00.png](public/progress/audit/charger-00.png), [charger-01.png](public/progress/audit/charger-01.png), [charger-02.png](public/progress/audit/charger-02.png), [charger-03.png](public/progress/audit/charger-03.png), [charger-04.png](public/progress/audit/charger-04.png), [charger-05.png](public/progress/audit/charger-05.png), [charger-06.png](public/progress/audit/charger-06.png), [charger-07.png](public/progress/audit/charger-07.png), [charger-08.png](public/progress/audit/charger-08.png), [charger-09.png](public/progress/audit/charger-09.png), [charger-10.png](public/progress/audit/charger-10.png), [charger-11.png](public/progress/audit/charger-11.png), [charger-sheet.png](public/progress/audit/charger-sheet.png), [charger-strip.png](public/progress/audit/charger-strip.png), [chrome-clear.png](public/progress/audit/chrome-clear.png), [combat-comparison.png](public/progress/audit/combat-comparison.png), [comparison-ab.png](public/progress/audit/comparison-ab.png), [comparison-ba.png](public/progress/audit/comparison-ba.png), [death-settled.png](public/progress/audit/death-settled.png), [death.png](public/progress/audit/death.png), [dodge-00.png](public/progress/audit/dodge-00.png), [dodge-01.png](public/progress/audit/dodge-01.png), [dodge-02.png](public/progress/audit/dodge-02.png), [dodge-03.png](public/progress/audit/dodge-03.png), [dodge-04.png](public/progress/audit/dodge-04.png), [dodge-05.png](public/progress/audit/dodge-05.png), [dodge-06.png](public/progress/audit/dodge-06.png), [dodge-07.png](public/progress/audit/dodge-07.png), [dodge-08.png](public/progress/audit/dodge-08.png), [dodge-09.png](public/progress/audit/dodge-09.png), [dodge-10.png](public/progress/audit/dodge-10.png), [dodge-11.png](public/progress/audit/dodge-11.png), [dodge-sheet.png](public/progress/audit/dodge-sheet.png), [dodge-strip.png](public/progress/audit/dodge-strip.png), [dummy-debug.png](public/progress/audit/dummy-debug.png), [dummy-stock.png](public/progress/audit/dummy-stock.png), [empty.png](public/progress/audit/empty.png), [exhibit-1.png](public/progress/audit/exhibit-1.png), [exhibit-2.png](public/progress/audit/exhibit-2.png), [exhibit-3.png](public/progress/audit/exhibit-3.png), [exhibit-4.png](public/progress/audit/exhibit-4.png), [kill-00.png](public/progress/audit/kill-00.png), [kill-01.png](public/progress/audit/kill-01.png), [kill-02.png](public/progress/audit/kill-02.png), [kill-03.png](public/progress/audit/kill-03.png), [kill-04.png](public/progress/audit/kill-04.png), [kill-05.png](public/progress/audit/kill-05.png), [kill-06.png](public/progress/audit/kill-06.png), [kill-07.png](public/progress/audit/kill-07.png), [kill-08.png](public/progress/audit/kill-08.png), [kill-09.png](public/progress/audit/kill-09.png), [kill-10.png](public/progress/audit/kill-10.png), [kill-11.png](public/progress/audit/kill-11.png), [kill-sheet.png](public/progress/audit/kill-sheet.png), [kill-strip.png](public/progress/audit/kill-strip.png), [poses.png](public/progress/audit/poses.png), [reference-overview.png](public/progress/audit/reference-overview.png), [reference-pattern-strip.png](public/progress/audit/reference-pattern-strip.png), [room-clear.png](public/progress/audit/room-clear.png), [stepwise-delay-probe.png](public/progress/audit/stepwise-delay-probe.png), [viewport-390.png](public/progress/audit/viewport-390.png), [viewport-900.png](public/progress/audit/viewport-900.png), [wave1-fight.png](public/progress/audit/wave1-fight.png), [wave3-dash.png](public/progress/audit/wave3-dash.png).

Primary reference provenance: [Enter the Gungeon official site](https://www.enterthegungeon.com/) links the [source video](https://res.cloudinary.com/devolver-digital/video/upload/v1768419021/gungeon/enterthegungeon.mp4). The downloaded `reference-official.mp4` is 22.5 seconds at 50 fps. The [two-second silent pattern clip](public/progress/audit/reference-pattern-clip.mp4) and extracted frames are for comparison. [Supergiant’s Hades page](https://www.supergiantgames.com/games/hades/) was consulted; its linked YouTube showcase could not be fetched, so no matched Hades motion claim is made. Existing supplied reference stills remain in `public/progress/ref/`. No reference art was imported into the game.

### 13f. Coverage, failures, and preservation

**Read coverage:** all source/tool/test files below, plus VISION.md, CLAUDE.md, HARNESS.md, GAUNTLET.md, the full 180-line plan, critic instructions, package/lock/config files, replay fixtures, manifest, and progress HTML/data. Binary assets were inventoried, not individually artist-reviewed. The relevant rendered assets were inspected in the captures.

- **src:** `src/audio/audio.ts`, `src/audio/sfxMap.ts`, `src/debug/api.ts`, `src/debug/overlay.ts`, `src/input/index.ts`, `src/input/recorder.ts`, `src/loop.ts`, `src/main.ts`, `src/render/anim.ts`, `src/render/app.ts`, `src/render/atlas.ts`, `src/render/atmosphere.ts`, `src/render/camera.ts`, `src/render/damageNumbers.ts`, `src/render/hud.ts`, `src/render/light.ts`, `src/render/particles.ts`, `src/render/postfx.ts`, `src/render/presenter.ts`, `src/render/tilemap.ts`, `src/render/views.ts`, `src/sim/arena.ts`, `src/sim/bots.ts`, `src/sim/collision.ts`, `src/sim/combat.ts`, `src/sim/enemies/brute.ts`, `src/sim/enemies/caster.ts`, `src/sim/enemies/charger.ts`, `src/sim/enemies/common.ts`, `src/sim/enemies/index.ts`, `src/sim/events.ts`, `src/sim/hash.ts`, `src/sim/input.ts`, `src/sim/math.ts`, `src/sim/metrics.ts`, `src/sim/player.ts`, `src/sim/projectiles.ts`, `src/sim/replay.ts`, `src/sim/rng.ts`, `src/sim/scenarios.ts`, `src/sim/step.ts`, `src/sim/waves.ts`, `src/sim/world.ts`, `src/tuning.ts`.
- **tools:** `tools/contact-sheet.mjs`, `tools/headless.ts`, `tools/import-assets.ts`, `tools/make-bardo-tiles.ts`, `tools/poses.ts`, `tools/record-bot.ts`, `tools/shot.ts`, `tools/zoom-tiles.mjs`.
- **tests:** `tests/sim/core.test.ts`, `tests/sim/replay.test.ts`.

**Tool/coverage limits:** raw Chrome held-key dispatch was unsupported; discrete native keypresses worked. No continuous personal playthrough or best personal replay exists. Initial scratch Python import used the wrong module form for a hyphenated file, then was corrected with `runpy`. One browser motion setup redeclared a lexical variable, then was corrected with block scope. The first long performance call hit a three-second transport limit; asynchronous readback succeeded. A report patch had a malformed added line and was reapplied without source changes. `gauntlet/state.json` lookup failed because it is absent. The stricter unused check failed with ten diagnostics as documented. These failures are not silently counted as passes. Audio listening, physical gamepad/rumble, Safari, Firefox, 4K, cold-load, long-run memory, and human repeat-play proof remain open.

**Preservation:** final source check pinned the same head `68072486b5c2f886aef49363cf625647dbb73a4e`. SHA-256 comparison of **236 protected files** found **zero changed, added, or deleted**. Scope: `src/`, `tools/`, `tests/`, `replays/`, `public/assets/`, vision/project/harness/gauntlet docs, package/lockfile, and existing progress data. See [before](public/progress/audit/source-before.json), [after](public/progress/audit/source-after.json), and [comparison](public/progress/audit/source-preservation.json). Only this report and the audit evidence directory are new. No commit was created.

**Final recommendation:** retain the engine kernel. Hold broad content production until the proof defects and combat-control issue are closed and people choose another run. Then make the bounded composition reset, prove the art contract, and build the counted complete run.
