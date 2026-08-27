# Bardo Rogue: Oracle Audit

You are two people at once. The **Auditor** reads every file, runs every tool, plays the game, and grades what exists with evidence. The **Oracle** knows what this game must become and tells us, without mercy, what stands between here and there. You have full context below. Use all of it. Then go further than it.

Read `VISION.md` first. It is the full game this slice must grow into, and every score in this audit is graded against that vision, not against the one-room slice. Its section 7 adds required sections to your report.

Your output is a written report (see section 9). You change no source code. You may run tools, write screenshots and scratch files, and edit `public/progress/` if you want to publish your findings there. You do not commit.

---

## 1. The vision

A browser action-roguelike in the lineage of **Enter the Gungeon** and **Hades**. Not "good for a web game". Not "good for AI-built". Good next to those two, blind, frame by frame.

The full game: a run with **rooms, floors, bosses, weapons and items, death and return**. Combat feel, enemy behavior, bullet patterns, atmosphere, art, sound, music, UI, run structure, all at the bar. Locked 60 fps in a normal browser. Theme: **the bardo**, the space between death and rebirth. Working title: Bardo Rogue.

What we want from you is a judgment of the **bones**: is this foundation one you would build that full game on? Where will it hold and where will it crack? And is the thing that exists today actually fun?

Three questions above all others:

1. **Are the bones strong?** Architecture, determinism, harness, tuning discipline, extensibility. Can a team of agents build a whole game on this without a rewrite?
2. **Is the juice and gameplay there?** Does the sword feel like a sword? Would a person replay the room five times because it feels good? If not, what exactly is missing?
3. **Can the art evolve?** We started on placeholder Kenney sprites on purpose. Can this codebase move to custom, flawless, beautiful art (PixelLab-generated, hand-authored, or both) without ripping out the render layer? What does that path look like?

Everything else you grade feeds those three.

---

## 2. What we built and why

Read this so you do not re-derive it. Then verify it against the code, because the code is the truth and this summary may drift.

### The slice
One arena (26x15 tiles), three waves, one greatsword, three enemies. Clear the room, banner, door opens, `R` restarts. That is the whole game today.

- **Brute** (ogre sprite): melee pressure. 20-tick windup, lunge, 34-tick recovery. Ignores light-hit stagger; the slam staggers it. Teaches spacing and the punish window.
- **Caster** (wizard sprite): ranged pressure. Keeps 90 to 130 px, aims 24 ticks, fires a bolt you can cut with the sword. Teaches priority and crossing under fire.
- **Charger** (spider sprite): timing pressure. Hovers, freezes 16 ticks, dashes 80 px. Packs of 3 to 4. Teaches dodge timing and rewards wide arcs.

Player: 95 px/s move, 18-tick dodge roll with i-frames on ticks 2 to 12, three-hit chain (2 / 2 / 4 damage; the third is a slow committed overhead slam with big hit-stop). 8-tick input buffer. Cancel windows on every swing. HP 5, every enemy hit = 1. No contact damage (Hades rule: only telegraphed attacks hurt).

### Deliberate design calls
These were chosen, not defaulted. Challenge each one.

- **No contact damage.** Every hit must be attributable to a readable telegraph.
- **Fixed camera, whole arena on screen.** Bullet-hell readability over scrolling. Camera still shakes, kicks, punch-zooms.
- **"Greatsword" is timing, not sprite size.** Heavy feel from a slow committed third hit with hit-stop, because non-integer scaling of pixel art looks bad.
- **Melee is primary.** Bolt-cutting gives melee a ranged interaction without adding a gun.
- **Procedural puppet animation.** The Kenney library has zero attack, walk, hit, or death frames for top-down pixel characters. Every character is one static 16x16 sprite. So bodies and weapons are separate sprites tweened in code (squash, lean, bob, swing arcs). Nuclear Throne and Gungeon-likes do this. It made every feel parameter a number in one file and needed no frames. It also may be a ceiling. Judge that.
- **Internal resolution 480x270**, rendered to a RenderTexture, nearest-neighbor integer upscale (4x at 1080p). Particles, arcs, decals live inside the low-res target so they pixelate for free and match the 16 px art.

### The architecture rules (from `CLAUDE.md` and `HARNESS.md`)
- `src/sim/` is pure TypeScript. No DOM, no pixi, no `Math.random`, no `Date`. Deterministic given `(seed, scenario, input frames)`. Runs headless in Vitest and Node.
- `src/render/`, `src/audio/`, `src/input/` are presentation. They read interpolated state and `world.events`. They never mutate the sim. Exactly one entry point per tick: `stepWorld(world, inputFrame)`.
- **Every number lives in `src/tuning.ts`.** No hardcoded numbers in systems. Live-editable via `window.__game.tuning`.
- Time in ticks (60 Hz), distances in px (1 tile = 16 px), speeds in px/s.
- Entities pooled in fixed-size arrays (`MAX_ENEMIES = 32`, `MAX_PROJECTILES = 64`). No per-tick allocation in the sim.
- Hit-stop is a sim freeze counter: the sim skips N ticks, presentation keeps running. Input presses during hit-stop still buffer.
- Sim emits typed events (`swing`, `hit`, `kill`, `playerHurt`, `dodge`, `boltFired`, `boltCut`, `spawn`, `waveStart`, `roomClear`, and more; see `src/sim/events.ts`). Presenter, audio, and metrics consume them.

### Why this stack
PixiJS v8 as a renderer only (batching, render textures, meshes for slash arcs, filters, particle container). Vite, TypeScript strict, Vitest, Playwright, pnpm. Phaser, Excalibur, Godot/Unity web, Canvas2D, and Three.js were considered and rejected (reasons in the plan file). Raw Web Audio for sound.

### The agent harness
This is a large part of "the bones". A game that agents can iterate on fast is a game that can reach the bar. Everything is in `HARNESS.md`. In short:

- `pnpm dev` on :5173 (strict port; usually already running, check first, never start a second).
- `pnpm typecheck`, `pnpm test` (18 tests, sim only, under a second).
- `pnpm sim -- --scenario full --bot kite --seeds 1-8` → headless bot runs, one metrics row per seed (swings, hits, whiffs, kills, dodges, damage taken, deaths, clear time, tick µs).
- `pnpm shot -- --scenario wave1 --bot naive-melee --ticks 500 --stepwise 1` → Playwright screenshot at 1920x1080 plus state JSON. `--eval` runs JS in the page first. Read the PNG.
- `pnpm poses` → a pose sheet of about 30 key animation frames.
- `window.__game` → `world`, `tuning`, `metrics`, `reset`, `step`, `setInput`, `bot`, `pause`, `hash`, `state`, `frameStats`, `record`, `replay`.
- URL params: `?scenario=wave2&seed=7&debug=1&mute=1&god=1&bot=kite`. Scenarios: `empty`, `dummy`, `brute-only`, `caster-only`, `charger-swarm`, `wave1`, `wave2`, `wave3`, `full`.
- F1 debug overlay (hitboxes, states, frame-time graph). F2 record, F3 download.
- Replays are run-length-encoded input frames. `tests/sim/replay.test.ts` pins a hash per fixture in `replays/`. Same replay must hash the same headless and in the browser. Any change to `src/sim/` or `src/tuning.ts` breaks the pinned hashes on purpose.
- `tools/contact-sheet.mjs` builds frame strips for judging motion.
- Chrome MCP and PixelLab MCP tools are available to you. Play the game yourself in Chrome.

### Where things are
- Plan and full rationale: `/Users/davidraphael/.claude/plans/web-roguelike-action-rpg-glimmering-pnueli.md`. Read it end to end. It contains the asset inventory, the rejected alternatives, the game-feel stack (input → anticipation → attack → contact → impact → reaction → environment → sound → recovery), the enemy roster with tick numbers, the encounter design, and the performance budgets.
- Standing directive for builder agents: `GAUNTLET.md` (build/critic loop, blind comparison against Gungeon and Hades footage, commit after each pass, progress page).
- Harness: `HARNESS.md`. Project rules: `CLAUDE.md`.
- `src/sim/`: `world.ts`, `step.ts`, `player.ts`, `combat.ts`, `collision.ts`, `projectiles.ts`, `enemies/{brute,caster,charger,common,index}.ts`, `waves.ts`, `scenarios.ts`, `bots.ts`, `metrics.ts`, `hash.ts`, `replay.ts`, `rng.ts`, `arena.ts`, `events.ts`, `input.ts`, `math.ts`.
- `src/render/`: `presenter.ts` (reads world + events, drives everything), `views.ts` (sprite indices, puppet animation), `anim.ts`, `particles.ts`, `tilemap.ts`, `light.ts`, `postfx.ts`, `atmosphere.ts`, `camera.ts`, `hud.ts`, `damageNumbers.ts`, `atlas.ts`, `app.ts`.
- `src/audio/`: `audio.ts`, `sfxMap.ts`. `src/input/`: `index.ts`, `recorder.ts`. `src/debug/`: `api.ts`, `overlay.ts`. `src/loop.ts`, `src/main.ts`, `src/tuning.ts`.
- `tools/`: `headless.ts`, `shot.ts`, `poses.ts`, `record-bot.ts`, `import-assets.ts` (Kenney subset), `make-bardo-tiles.ts` (719 lines; generates the original `bardo_room.png` / `bardo_props.png` tilesets), `contact-sheet.mjs`, `zoom-tiles.mjs`.
- `tests/sim/core.test.ts`, `tests/sim/replay.test.ts`. `replays/*.json`.
- `public/assets/` is generated and committed. Two generators rewrite `manifest.json`: `pnpm assets` then `pnpm tiles`. Running them in the wrong order drops the bardo sprites.
- `public/progress/`: the live progress page (`index.html`, `data.json`), `shots/` (arena rounds 1 to 11), `ref/` (Gungeon and Hades stills), `critique/` (crops used in blind comparisons).
- Kenney source library (CC0): `/Users/davidraphael/Downloads/Kenney Game Assets All-in-1 3.7.0`.

### Current state of the tree (verify with `git status` and `git log`)
- Three commits. Last: `084c4a9 First arena slice: three enemies, waves, juice, lighting, replay harness`.
- **The working tree is dirty.** About 540 insertions across 16 files, plus new untracked files (`src/render/atmosphere.ts`, `tools/make-bardo-tiles.ts`, the bardo tilesets, `public/progress/`). This is the uncommitted output of the arena "first look" work. `pnpm typecheck` and `pnpm test` are green on it.
- Another Claude session has worked in this folder. Do not assume the tree is untouched between your steps.

### The one piece that has been through the critic loop, and what happened
The GAUNTLET loop was run on a single piece: **"The Threshold"**, the empty arena before anyone swings. Eleven builder rounds. The blind critic picked the reference (a Gungeon Keep chamber) **every time**. The gaps named, in order:

1. Stock Kenney box with a ring on dirt vs an authored chamber.
2. Tan dirt and a HUD-reticle seal.
3. Lighting pass over a brick-banner kit vs a furnished place with a signature inlay.
4. Tiled layout dressed with identical plants vs an interior with materials, motifs, a memorable center.
5. Schematic tiles and a graphic hole vs material weight, shadow, lived-in density.
6. Dim brick box plus portal sticker vs furniture mass, contrasting materials, a thematic floor.
7. Prefab lobby with a crest vs a furnished interior built around one architectural object.
8. Tiled kit in bilateral symmetry, no lighting hierarchy, no authored monument.
9. Brick box of grid-snapped props and flat light vs materials, volume, a floor you would remember.

Round 4 abandoned Kenney tiles for an original generated tileset (`tools/make-bardo-tiles.ts`). It did not close the gap. Fourteen more pieces are queued behind it (HUD, sword swing, dodge, hit impact, each enemy, waves, boss, run, gear, death, audio, meta UI) and none has started.

**This is evidence. Read it as an oracle.** Eleven rounds of a tile-and-prop approach could not produce a room that beats a still frame. Is that a builder problem, a tooling problem (procedurally generated 16 px tiles from code cannot produce "material weight"), an art-direction problem (no direction exists, so every round guesses), or a process problem (a still-frame comparison of an empty room is the wrong first piece)? Decide, and say what should happen instead.

---

## 3. How to audit

Do all of it. Every score needs evidence you produced yourself. Cite file paths with line numbers, command output, screenshots you took, and state you observed.

1. **Read everything.** The plan file, `CLAUDE.md`, `HARNESS.md`, `GAUNTLET.md`, every file in `src/`, `tools/`, `tests/`, the progress data and timeline. About 5,000 lines of source; read all of it, not a sample.
2. **Run the checks.** `pnpm typecheck`, `pnpm test`. Note timing.
3. **Run the sims.** At minimum: `idle`, `naive-melee`, and `kite` bots on `wave1`, `wave3`, and `full`, seeds 1 to 8. Compare against the plan's targets: skilled clear 60 to 120 s, a new player dies 2 to 5 times before the first clear, time to first death at least 30 s, `idle` dies in wave 1. Report tick µs. Test determinism yourself: same seed, same replay, same hash, twice, and headless vs browser.
4. **Look.** `pnpm poses`. `pnpm shot` on `dummy`, `wave1` mid-fight, `wave3` with chargers dashing, the room-clear moment, the death moment. Use `--stepwise 1` and `--eval` to pose the exact frame you want. Zoom in on the pixels: is the integer upscale clean, is there shimmer, do hitboxes align with sprites (`debug=1`). Build frame strips with `tools/contact-sheet.mjs` for anything that moves: a full swing chain, a dodge, a Brute windup through recovery, a Charger dash, a kill.
5. **Play.** Open the game in Chrome via the MCP tools. Play `full` from the keyboard for real, several runs. Then play with `god=1` to study each enemy. Record a replay of your best run. Write down what you felt in the first 10 seconds, the first 60 seconds, and after the third run. If you cannot play with real input, say so and grade the feel from frame strips and state traces, with lowered confidence.
6. **Compare blind.** Put our frames next to the stills in `public/progress/ref/` and, where you can find them, official Gungeon and Hades GIFs of the same moment (a sword swing, a dodge roll, an enemy telegraph, a kill, a room clear). Judge which is better and name the single biggest gap. Never grade against "what an AI could do".
7. **Stress the bones.** Read the code as if you were about to add: a second room and a door transition; a floor of 8 rooms with a minimap; a boss with three phases and bullet patterns of 200 projectiles; a second weapon with a different chain; a passive item that changes dodge distance; a run-persistent inventory; a death-and-return meta loop; a title screen; music with state-driven layers; gamepad rumble. For each, name the files you would touch and whether the current shape helps or fights you. Look hard at `MAX_PROJECTILES = 64`, the event ring buffer, `World` as a single class, `waves.ts`, `scenarios.ts`, `arena.ts`, and how the presenter binds to entity kinds.
8. **Stress the art path.** Read `atlas.ts`, `views.ts`, `anim.ts`, `presenter.ts`, `import-assets.ts`, `make-bardo-tiles.ts`, and `manifest.json`. Then answer: to replace the hero with an 8-direction PixelLab character that has real walk, attack, roll, hit, and death frames, what changes? To replace the arena with a hand-painted or generated room (not a tile grid), what changes? Does the 480x270 target and 16 px tile hold for the ambition, or does the art ceiling force a resolution decision now? Can procedural puppet animation and frame animation coexist per entity? Is there an art direction document at all?
9. **Stress the process.** Read `GAUNTLET.md` and the eleven-round timeline. Is the loop (builder, blind critic, single named gap, repeat) sound? Is the first piece the right first piece? What would you change about the loop before the other fourteen pieces begin?

---

## 4. Grade every dimension, 0 to 100

Score each dimension separately. Calibrate against shipped games, not against prototypes:

- **90 to 100:** ships next to Hades or Gungeon today with no excuses.
- **70 to 89:** a strong commercial indie foundation; the remaining work is polish and content, not structure.
- **50 to 69:** a solid prototype; some structural work remains before content can scale.
- **30 to 49:** a proof of concept with real bones but major gaps.
- **0 to 29:** would need a rewrite to reach the bar.

For each dimension give the score, your confidence (low, medium, high), the three strongest pieces of evidence, the single biggest gap, and the one change that would raise the score the most.

**A. Architecture and bones.** Sim purity and determinism (verify, do not trust). Pooling and allocation discipline. Event model. Tuning discipline (grep for hardcoded numbers in `src/sim/` and `src/render/`). Type strictness. Separation of sim and presentation in practice, not just on paper. Extensibility to rooms, floors, items, weapons, bosses, meta progression. Whether `World` and `waves.ts` and `scenarios.ts` can become a run.

**B. Harness and agent velocity.** Can an agent see, drive, measure, and regression-test the game without a human? Replay fidelity. Headless metrics. Screenshot and pose tooling. Debug overlay. Gaps in the harness that would slow the fourteen queued pieces (for example: no GIF export, no automated blind-compare, no per-piece scenario, no audio inspection, no way to grade motion).

**C. Combat feel and juice.** Input latency and buffer. Cancel windows. Anticipation, hit-stop, shake, flash, squash, knockback, particles, decals, aberration, zoom punch, lookahead, recovery overshoot. Sound layering, pitch variance, ducking. Judge each stage of the feedback chain and the chain as a whole, next to Hades' sword and Gungeon's impact. Is the greatsword heavy? Is the dodge a decision or a panic button?

**D. Enemy design and readability.** Do the three enemies each answer "what are you about" in one telegraph? Tell-to-damage time. Punish windows. Do they combine into interesting problems or just more of the same? Poise and stagger rules. How they read in the frame strips. What the roster is missing for a whole game (patterns, elites, minibosses, a boss).

**E. Gameplay and fun.** The hard one. Decision density per second. Is there a reason to move besides not being hit? Is the room a puzzle or a chore? Wave pacing. Difficulty curve against the plan's targets. Would a person replay this five times because it feels good, and if not, what one thing would make them? Use your own play, the bot metrics, and the frame strips as evidence.

**F. Run structure readiness.** How far is the code from a run: room graph, transitions, floor generation or authored layouts, doors, rewards, shops, a boss, death, return, unlocks. Where do rooms live (data or code)? Is the arena a special case or a first instance? Is the fixed camera a limit on room design?

**G. Art evolvability.** The path from Kenney placeholders to flawless custom art. Atlas and manifest design. Puppet animation vs frames. Sprite size and resolution decisions and whether they are reversible. The generated-tileset approach and what the eleven rounds prove. Whether an art direction exists (palette, materials, light, silhouette language, what "bardo" looks like). PixelLab integration plan. Which assets are hardest to replace and why.

**H. Visual quality today.** Pixel integrity (integer scale, no shimmer, particles matching the sprite grid). Lighting and grade. Atmosphere. Composition of the arena. The HUD. Judge against the reference stills, blind.

**I. Audio and music.** What exists, what is layered, what is missing (music, ambience, vocals, whoosh, bass). Whether the audio bus design can grow into state-driven music.

**J. UI, HUD, and meta.** Hearts, banners, room clear, death screen, restart. Title, pause, options, input prompts, gamepad. Readability at 480x270.

**K. Performance and browser.** Frame times (`frameStats`, `shot` p95), tick µs, draw calls, filter cost, Safari, 120 Hz displays, catch-up behavior, asset weight, load time. Does 60 fps hold with 200 projectiles on screen? Is there a mobile or touch story, and should there be?

**L. Code quality and maintainability.** Strict TypeScript, file sizes (`make-bardo-tiles.ts` is 719 lines), dead code, duplication, naming, comments that explain why. Whether a new agent can find its way in an hour. Test coverage of the things that matter (cancel windows, i-frames, telegraph timings, wave director, determinism).

**M. Theme and identity.** Is "the bardo" anywhere in the game beyond the name? Is there a hook that makes this not a Gungeon or Hades reskin: a mechanic, a visual signature, a tone? Does the plan give the art and audio a direction to aim at, or only a bar to clear?

**N. Process and loop.** The GAUNTLET loop as evidence: eleven rounds, zero passes, fourteen queued. Is the loop capable of converging? What must change (piece order, critic method, builder tools, art direction first) before it runs again?

Then give **one overall 0 to 100 for "the bones"** and a separate **0 to 100 for "the game as it plays today"**. Explain the weighting. Do not average; weight by what matters for reaching the full vision.

---

## 5. Questions the oracle must answer

Do not skip any. Give a position, the evidence, and the cost of being wrong.

1. Is procedural puppet animation on static sprites a ceiling for the bar we set, or can it carry the whole game with a custom sprite set? If it is a ceiling, when does it become one, and what is the migration?
2. Is 480x270 with 16 px tiles the right internal resolution for "truly flawless and beautiful", or should the decision be revisited now while it is cheap? Consider Gungeon (pixel) vs Hades (HD painted) and which lineage this game is actually in.
3. Is the fixed full-arena camera a design strength or a room-design cage once there are floors?
4. Is the "no contact damage" rule right for a game with swarms and bullet patterns?
5. Is one sword, three enemies, three waves enough to prove fun, or is the fun proof waiting on content that does not exist yet? What is the smallest addition that would prove it?
6. Does the arena stall prove that code-generated tiles cannot reach the bar, and if so, what asset pipeline should replace it (PixelLab tilesets and props, hand-painted rooms, a hybrid)?
7. What is the single highest-leverage thing to build next, and why is it that and not the fourteen queued pieces in their current order?
8. What in the current plan is wrong? Name the assumptions you would strike out.
9. What should never change? Name the decisions that are load-bearing and correct, so future agents do not "improve" them.
10. If you had to bet: does this codebase reach the bar with continued iteration, or does it need one structural reset first? Where?

---

## 6. Rules of evidence

- Every claim cites a file and line, a command and its output, or a screenshot or strip you produced. "Feels off" is allowed only with a frame strip and a named stage of the feedback chain.
- Grade against the real games. "Good for a web game" and "good for AI" are losses.
- Use `--stepwise 1` for deterministic frames. Free-run overshoots by up to 4 ticks.
- Do not start a second Vite server. Check :5173 first.
- Do not edit `src/`, `tools/`, `tests/`, `replays/`, or `public/assets/`. Do not run `pnpm assets` or `pnpm tiles`. Do not commit.
- If a tool fails, say so and grade with lowered confidence. Do not skip a dimension because a tool was hard.
- Prefer the harsh truth. The person reading this wants to know what is wrong, not to feel good.

---

## 7. What "top better-off moves" means

A better-off move is a change that raises the ceiling of the whole project, not a fix for one piece. Examples of the shape: "write an art direction bible before another arena round", "replace the tile generator with a PixelLab tileset pipeline", "lift `MAX_PROJECTILES` and make projectiles a pattern system now", "add GIF export to the harness so critics can judge motion", "reorder the gauntlet: prove the sword is fun before the room is pretty".

Rank them by **leverage divided by cost**. For each: what it is, why it is load-bearing, what it costs, what it unblocks, and how we would know it worked (a measurable or visible success criterion).

---

## 8. Answer the fun question directly

A separate section. Write it as the person who played it. Say what the game is like to play for ten seconds, a minute, three runs. Name the moments that work and the moments that do not. Then say what one addition, one removal, and one tuning change would do the most for fun, and back each with evidence from play, metrics, or strips. If the honest answer is "it is not fun yet", say that and say what proof of fun would look like.

---

## 9. Deliverable

Write `AUDIT_REPORT.md` at the repo root. Structure:

1. **TL;DR** (ten lines max): the two overall scores, the verdict on the three questions in section 1, and the single most important move.
2. **Scorecard**: one row per dimension A to N with score, confidence, biggest gap, one-line fix.
3. **Dimension reports** A to N, each with the evidence, the gap, and the highest-leverage change.
4. **Oracle answers** to the ten questions in section 5.
5. **The fun question** (section 8).
6. **Top 10 better-off moves**, ranked, in the format of section 7.
7. **The full-loop path**: the ordered sequence from this slice to a complete run (rooms, floors, boss, items, death, return), with the structural work that must happen before content can scale, and where in that sequence the art swap should land.
8. **The art evolution path**: from Kenney to flawless. Pipeline, tools, resolution decision, animation decision, what to generate first, how to keep the sim untouched while the render layer changes.
9. **Do not touch**: the decisions that are correct and load-bearing.
10. **Strike list**: the assumptions in the plan and the gauntlet that you would remove.
11. **Risks and traps**: the ways this project fails if it keeps going as is.
12. **First five actions**: concrete, ordered, each with a success criterion, that a builder agent should do next.
13. **Appendix**: every command you ran with its output summary, every screenshot and strip you produced (paths), every sim table.

Put screenshots and strips under `public/progress/audit/` so they are served by the dev server and visible from a phone. If you update `public/progress/data.json` to link the report, keep the existing schema.

Write in short sentences, active voice, one meaning per word. No hedging where you have evidence. No praise without a reason. When you are done, the reader should know the score, why, and exactly what to do next.
