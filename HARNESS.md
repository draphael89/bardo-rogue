# Agent harness

How to run, drive, inspect, and regression-test the game without a human at the keyboard.
Stack: PixiJS v8 + Vite + TypeScript strict, pnpm. Sim ticks at 60 Hz; 1 tile = 16 px; view is 480x270 upscaled.

## The one rule

`src/sim/` is the truth. It is pure TypeScript (no DOM, no pixi), deterministic given `(seed, scenario, input frames)`.
`src/render/`, `src/audio/`, `src/input/` are presentation: they read interpolated state and `world.events`, and
they never mutate the world. Every number lives in `src/tuning.ts`. Presentation calls exactly one sim entry point
per tick: `stepWorld(world, inputFrame)`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server at http://localhost:5173 (strict port; if it is already up, reuse it) |
| `pnpm typecheck` / `pnpm test` | `tsc --noEmit` / Vitest over `tests/**` (sim only, ~2 s). Both must stay green. |
| `pnpm sim -- ...` | Headless bot or replay run in Node, prints metrics JSON (`tools/headless.ts`) |
| `pnpm shot -- ...` | Playwright: open the game, run ticks, screenshot + state JSON (`tools/shot.ts`) |
| `pnpm record-bots` | Regenerate the replay fixtures in `replays/` (`tools/record-bot.ts`) |
| `pnpm record-bot -- --bot kite --scenario full --seed 1 --out replays/x.json` | Record one bot run |
| `pnpm poses` | Pose sheet of key animation frames (`tools/poses.ts`) |

`pnpm sim -- --scenario wave3 --bot naive-melee --seeds 1-20 --ticks 10800` prints one row per seed:
swings, hitsLanded, whiffSwings, kills, dodges, successfulDodges, boltsFired, boltsCut, enemyAttacks, damageTaken,
deaths, wavesCleared, clearSeconds, deathSeconds, avgTickUs, maxTickUs. A run stops 2 s after room clear or death.

## URL params

`http://localhost:5173/?scenario=wave2&seed=7&debug=1&mute=1&god=1&bot=kite`

- `scenario`: `empty`, `dummy` (3 static targets), `blessed` (dummy room with the cleave blessing on), `bow` (dummy room, already armed with the bow), `boss` (one warden: plant, radial slam, veil-break at half life), `brute-only`, `caster-only`, `charger-swarm`, `wave1`, `wave2`, `wave3`, `full` (default), `run` (Threshold fight → two marked doors → Crossing fight north, or The Far Shore east; death then R returns to The Bardo), `loop` (starts in The Bardo; the north door begins a run), `shore` (quiet gift room, a life vessel to walk into).
- Death then R: scenarios whose room graph includes The Bardo (`run`, `loop`) revive in that hub — same world, not a rebuild. Every other scenario still sets `wantsRestart` and rebuilds the same fight.
- `seed`: integer, default 1. Same seed + same inputs = same run.
- `debug=1`: F1 overlay on. `mute=1`: no audio. `god=1`: player cannot take damage.
- `bot=idle|naive-melee|kite`: a scripted player drives the sim instead of the keyboard.

Combat slow-motion: `__game.state().slow` is `{ rate, ticks }` — rate is per-mille, 1000 is full speed. Force it with `__game.world.slowRate = 250; __game.world.slowTicks = 120`.

Keys in the game: WASD move, arrows aim (8-way, and holding one pins the facing so you strafe), mouse aim, click/J attack, Space/Shift/K dodge, R restart. With no arrow and an untouched mouse, aim follows movement.
F1 toggles the debug overlay, F2 toggles recording, F3 downloads the last recording.

## `window.__game` (src/debug/api.ts)

Available once the page has booted (`await page.waitForFunction(() => !!window.__game)`).

- `world`: the live `World` (player, enemies[], projectiles[], wave, tick, freeze). Read freely; mutate only to pose a frame.
- `tuning`: the live tuning object. Edit values in place to try numbers without a reload.
- `metrics`: `Metrics` for the current run; `metrics.summary()` gives the same fields as `pnpm sim`.
- `loop`: the fixed-step loop; `loop.paused`, `loop.frameTimes`.
- `reset(seed?, scenario?, { god? })`: fresh world. Omitted args keep the current run's seed/scenario.
- `step(n = 1)`: advance the sim n ticks by hand (pause first, or the loop keeps ticking too).
- `setInput(partial | null)`: force an `InputFrame` (`moveX moveY aimX aimY aimSoft attack dodge restart`). Edge fields (`attack`, `dodge`, `restart`) fire once, then clear. `null` returns control to the keyboard.
- `bot(name | null)`: swap in or remove a bot.
- `pause(p?)`: pause/unpause the loop, returns the new state.
- `hash()`: FNV hash of the sim state. Equal hashes = identical worlds.
- `state()`: compact JSON snapshot: tick, freeze, wave, player, offering, boons, enemies (id, kind, x, y, hp, state, stateTick), bolts, metrics.
- `frameStats()`: `{ frames, p50, p95, max }` render frame time in ms over the last 240 frames.
- `mute(m?)`, `debug(v?)`: toggle audio / overlay, return the new state.
- `record(on?)`: start (resets to a fresh run of the current seed/scenario) or stop recording. Returns whether recording.
- `stopRecord()`: stop, return the `Replay`, and log its JSON to the console.
- `download(name?)`: save the last recording as a `.json` download (stops recording first if needed).
- `replay(obj)`: reset to the replay's seed/scenario and feed its frames instead of input. Live input resumes when frames run out.

## Pose a frame and look at it

`pnpm shot -- --scenario dummy --seed 1 --stepwise 1 --ticks 60 --debug 1 --eval "__game.setInput({attack:true,aimX:1}); __game.step(4)" --out shots/swing.png`

- `--stepwise 1` pauses the loop and steps exactly `--ticks` ticks, so the state is deterministic. Without it the loop
  runs free and the reported tick can overshoot by up to 4.
- `--eval` runs JS in the page after the ticks and before the screenshot. Set `window.__out = {...}` to get values back
  in the printed JSON (`extra`). The JSON also has `state` (from `__game.state()`), `stats`, and console `errors`.
- Then Read the PNG. It is 1920x1080; the 480x270 render target is upscaled 4x.

## Record and replay

A replay is `{ v: 1, seed, scenario, god?, frames: InputFrame[] }` (`src/sim/replay.ts`). On disk it is run-length
encoded: `runs: [moveX, moveY, aimX, aimY, flags, count]` with axes as ints x10000 and flags bits
`1 aimSoft, 2 attack, 4 dodge, 8 restart`. The browser quantizes every frame to 1/10000 before the sim sees it, so
what was played and what is stored are identical.

- Browser: F2 starts a fresh run and records; F2 again stops; F3 downloads `<scenario>-<seed>-<ticks>.json`. Move the
  file into `replays/`. A restart (R) ends the recording. "REC" blinks top-centre while recording, "REPLAY" while replaying.
- Scripted: `pnpm record-bot -- --bot kite --scenario full --seed 2 --out replays/kite-full-s2.json`.
- Headless: `pnpm sim -- --replay replays/kite-full-s2.json [--ticks 300]` prints hash, player, metrics. `--ticks` stops early.
- Browser: `pnpm shot -- --replay replays/kite-full-s2.json --ticks 300 --stepwise 1` (the replay sets seed/scenario).
- Node API: `runReplay(replay, onTick?)` returns `{ world, hash, metrics }`; `encodeReplay`/`decodeReplay`, `replayToJson`/`replayFromJson`.

The same replay must give the same hash headless and in the browser at the same tick. `tests/sim/replay.test.ts`
pins the hash of each fixture in `replays/`. If a hash test fails, the sim changed: if that was intended, run
`pnpm record-bots` and paste the printed hashes into the test.

## Reading the debug overlay (F1 / `debug=1`)

- Player circle: blue = normal, green = invulnerable (dodge i-frames).
- Player arc: orange = swing startup, red = active hit window.
- Enemy circles: yellow = telegraph (windup / freeze / aim), red = attacking or dashing, green = recover or stagger
  (punish window), pink = anything else. Red arc on a brute = its hit area.
- Enemy label: `<kind initial><id> <state>:<stateTick> hp<hp>`, e.g. `b3 windup:12 hp4`. Magenta circles are bolts.
- Bottom-left: frame-time bars (red above 16.7 ms) and a line with p50/p95/max frame ms, tick, freeze (hit-stop ticks
  left), player state:stateTick and hp, alive enemies, active bolts.

## Where things are

- `src/sim/`: `world.ts` (state), `step.ts` (the tick), `player.ts`, `combat.ts`, `enemies/`, `projectiles.ts`,
  `waves.ts`, `scenarios.ts`, `bots.ts`, `metrics.ts`, `hash.ts`, `replay.ts`, `rng.ts` (never `Math.random`).
- `src/render/`: `presenter.ts` reads world + events and drives sprites, particles, shake, decals, hud.
- `src/input/`: keyboard/mouse/gamepad to `InputFrame`; `recorder.ts` captures frames.
- `src/debug/`: `api.ts` (`window.__game`), `overlay.ts` (F1).
- `src/main.ts` wires it all; `src/loop.ts` is the fixed 60 Hz accumulator with interpolation and a 5-step catch-up cap.
