# Agent harness

How to run, drive, inspect, and regression-test the game without a human at the keyboard.
Stack: PixiJS v8 + Vite + TypeScript strict, pnpm. Sim ticks at 60 Hz; 1 tile = 16 px; view is a 640x360 target (world drawn at 1.5x, so a tile is 24 target px), integer-upscaled.

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
| `pnpm matrix` | Seeded acceptance gate: every seed must resolve and come home; reports the win-rate band (`tools/matrix.ts`) |
| `pnpm perf:sim -- --mode replay|loop|dense ...` | Repeated deterministic simulation timings with a golden hash/outcome check (`tools/perf-sim.ts`) |
| `pnpm perf:render -- --profile warden|dense ...` | Clean Browser/Pixi timings; optional `--cpu`/`--heap` attribution runs separately. Requires the Warden to be active after warmup, rejects page errors, repeats its hash, and asserts dense render purity (`tools/perf-render.ts`; needs a server). |
| `pnpm smoke` | Drives both endings of the production loop in a real browser and asserts the golden path (`tools/smoke.ts`; needs a server) |
| `pnpm realm-air -- --url <server> [--seed n] [--min-median m] [--shots 1]` | Measures whether a realm actually changes the room: mean RGB of every node's play area, pairwise separation, and whether each realm reads the temperature the ledger claims (`tools/realm-air.ts`; needs a server). Bare, it reports; with `--min-median` it exits non-zero. |
| `pnpm record-bot -- --bot kite --scenario full --seed 1 --out replays/x.json` | Record one bot run |
| `pnpm poses` | Pose sheet of key animation frames (`tools/poses.ts`) |
| `pnpm strip -- ...` | Frame strip of anything that moves, for judging motion (`tools/strip.ts`; writes a JSON state/event sidecar beside the PNG) |
| `pnpm assets` / `pnpm tiles` | Regenerate `public/assets/` (Kenney subset, then the original bardo tilesets). Both rewrite `manifest.json`; run `tiles` **after** `assets` or the bardo sprites drop out. |
| `pnpm room:gate -- [--url <server>] [--shot-dir <dir>] [--out <json>]` | Blocks room-source dimension, palette, alpha, material-span, and Bardo negative-space drift. With a live server it also proves native composite dimensions and exact 1x frame value/highlight/focality budgets (`tools/room-art-gates.ts`). |
| `pnpm build` | Web build, then `tools/check-build.ts` gates the payload (no evidence, no video, no missing asset, within budget) |
| `pnpm check:build` | Re-run the built-payload gate against the current `dist/` |
| `pnpm art` / `pnpm palette` / `pnpm fx` | Run the authored-art gates, canonical-palette gate, or rebuild the Bardo FX sheets |
| `pnpm desktop:dev` | Electron shell against the already-running `:5173`. Does NOT start Vite; HMR still works inside the shell. |
| `pnpm desktop:build` | `pnpm build` (payload gate included) then compiles `desktop/*.cts` to `desktop/out/*.cjs` |
| `pnpm desktop:start` | Runs the PACKAGED code path (`app://bardo/`) against the local `dist/`, without packaging anything |
| `pnpm smoke:desktop` | Tier-3: drives the real Electron app under Playwright and checks hosting, incl. replay-hash parity with `pnpm sim` |
| `pnpm site:build` | Everything PlayBardo.com serves: the landing page (`site/src` + `site/art-src` -> `site/dist`, responsive AVIF/WebP, hashed assets) AND the playable game rebuilt under the `/play/` base into `site/dist/play` (`tools/build-site.ts`). It writes the game straight there, never through the repo's own `dist/`, which stays at base `/` for the desktop host. |
| `pnpm site:deploy` | Builds, then ships `site/dist` to PlayBardo.com (Cloudflare Pages project `playbardo`, production branch `main`). The project is **direct upload, not Git-connected** -- merging to `main` deploys nothing, this command is the only thing that does. Needs `npx wrangler login` once per machine. |
| `pnpm desktop:dist:signed-local` | Build a Developer ID-signed arm64 app, dmg, and zip without contacting Apple's notarization service. |
| `pnpm desktop:verify` | Verify the local app signature, identity, Hardened Runtime, entitlements, icon, arm64 executable, dmg, and zip. |
| `APPLE_KEYCHAIN_PROFILE=bardo-notary pnpm desktop:dist` | Build, sign, notarize, and staple the release artifacts on macOS. |
| `pnpm desktop:verify:notarized` | Run the local checks plus Gatekeeper assessment and stapling validation. |

`pnpm sim -- --scenario wave3 --bot naive-melee --seeds 1-20 --ticks 10800` prints one row per seed:
swings, hitsLanded, whiffSwings, kills, dodges, successfulDodges, boltsFired, boltsCut, enemyAttacks, damageTaken
(HP actually lost — the Warden's slam counts 2, god mode counts 0), hitsTaken (times touched, god mode included),
deaths, wavesCleared, roomsEntered, boonsChosen, runResult, runSeconds, clear/death time, final room/phase, and timing.
A stock combat scenario stops 2 s after clear or death; the production `loop` stops after its return to the Bardo.

## URL params

`http://localhost:5173/?scenario=wave2&seed=7&debug=1&mute=1&god=1&bot=kite`

- `scenario`: `loop` is the default production game: Bardo rack → Greek gate → six chambers → Minos → Bardo. The attempt seed picks one of six spines: early shop, late shop, a fork at the Field of Asphodel, the fire ford (Landing then Phlegethon), the Styx gate (first fight is the oath river), or the ash march (both rivers, no bank). Debug scenarios remain: `empty`, `dummy`, `blessed`, `bow`, `boss`, `brute-only`, `caster-only`, `charger-swarm`, `wave1`, `wave2`, `wave3`, `full`, `run`, and `shore`.
- Death or victory then confirm: `loop` returns to the Bardo in the same world and clears run power. Legacy `run` also returns on death. Stock combat scenarios still set `wantsRestart` and rebuild the same fight.
- `seed`: integer, default 1. Same seed + same inputs = same run.
- `save=off`: run against a fresh profile and write nothing. `pnpm shot` and `pnpm poses` pass it by
  default (pass `--save on` to opt out), so a machine that has actually played cannot tint a capture
  or move a `loop` hash -- `hashWorld` folds `session.meta` into that scenario's hash.
- `debug=1`: F1 overlay on. `mute=1`: no audio. `god=1`: player cannot take damage. `reduced=1` caps flashes, camera movement, zoom, and disables chromatic pulses (`reduced=0` overrides an OS preference).
- `bot=idle|naive-melee|kite|slice-naive|slice-kite`: a scripted player drives the sim. The `slice-*` bots physically prepare, navigate either branch by seed parity, choose boons, fight the Warden, and return; their suffix selects the combat policy.
- `playtest=baseline|no-heavy|no-dash`: arms a playtest session (see `PLAYTEST.md`). The whole session records itself from tick 0, the condition applies to LIVE play only (bots bypass it), and **F4** downloads the session bundle — a valid encoded replay plus a `playtest` key carrying condition, build, counters, and `metrics.summary()`. The two conditions are not the same kind of thing. `no-heavy` is a frame filter: `f.heavy` is dropped before the frame is recorded, so it is baked into the bundle and replays for free. `no-dash` cannot be a filter — a same-tick dodge+attack and an attack buffered just before the roll both leak past one — so it closes the cancel **window** in `tuning` instead, and a window is not in the frames. Every replay path therefore re-applies it from the bundle's own key (`src/playtest.ts`): `pnpm sim -- --replay bundle.json` does this automatically and echoes the `playtest` field it used, and `pnpm shot -- --replay bundle.json` does the same through `__game.replay()`. `--playtest <condition>` overrides, for measuring the same frames under another condition on purpose. Four things are interlocked to keep a bundle honest: the pause card's **abandon row is absent** while a session is armed (an abandon changes the world outside the frame stream), **F2/F3 are locked out** (they would restart or end the session's recording), **an import is refused** (it calls reset(), which stops a recorder the session cannot rearm), and **a saved descent is not resumed** — the bundle header names only (seed, scenario, meta), so a replay rebuilds a fresh Bardo and frames recorded in a resumed world would replay into a run that never happened. That run is over; note it and discard its bundle.

Combat slow-motion: `__game.state().slow` is `{ rate, ticks }` — rate is per-mille, 1000 is full speed. Force it with `__game.world.slowRate = 250; __game.world.slowTicks = 120`.

Keys in the game: WASD move, arrows aim (8-way, and holding one pins the facing so you strafe), mouse aim, left-click/J/Z light attack, right-click/L/C heavy attack, Space/Shift/K/X dodge, P/Escape pause, V reduced effects, F fullscreen. The title over the Bardo is a card: W/S or arrows move, Enter/Space/J or a click answers DESCEND / SETTINGS / CREDITS; A/D or left/right set MASTER, MUSIC and SOUND on Settings; Escape or RISE returns from a page. With no arrow and an untouched mouse, aim follows movement. Rewards use A/D or left/right, then Enter/Space/attack to claim; a heavy on a live offer rerolls it once the Smith has been paid. The same confirm returns after death or victory, gated by a minimum reveal beat (`tuning.reveal`) so a press already in flight cannot skip the staged card.
While paused, arrows or W/S move the card, Enter / A chooses: RISE, or (on a live run) GIVE THE
ATTEMPT BACK — confirm twice and the Bardo takes you. E exports the save file and I imports one;
an import is refused during a live run, and refused if either file came from a newer build than this one.
F1 toggles the debug overlay, F2 toggles recording, F3 downloads the last recording.

## `window.__game` (src/debug/api.ts)

Available once the page has booted (`await page.waitForFunction(() => !!window.__game)`).

- `world`: the live `World` (player, enemies[], projectiles[], wave, tick, freeze). Read freely; mutate only to pose a frame.
- `tuning`: the live tuning object. Edit values in place to try numbers without a reload.
- `metrics`: `Metrics` for the current run; `metrics.summary()` gives the same fields as `pnpm sim`.
- `loop`: the fixed-step loop; `loop.paused`, `loop.frameTimes`.
- `reset(seed?, scenario?, { god? })`: fresh world. Omitted args keep the current run's seed/scenario.
- `step(n = 1)`: advance the sim n ticks by hand (pause first, or the loop keeps ticking too).
- `setInput(partial | null)`: force an `InputFrame` (`moveX moveY aimX aimY aimSoft attack attackHeld heavy dodge restart choiceDelta confirm reroll`). Forced action/modal fields fire once, then clear. `null` returns control to the keyboard.
- `bot(name | null)`: swap in or remove any bot listed above.
- `pause(p?)`: debug-hold the loop (audio stays live; the pause card does not appear). Returns the new state.
- `shellPause(p?)`: player-facing pause — the BETWEEN BREATHS card. Returns whether the card is up.
- `abandon()`: give a live attempt back and wake in the Bardo. Returns whether a run was ended.
- `hash()`: FNV hash of the sim state. Equal hashes = identical worlds.
- `state()`: compact JSON snapshot: tick, freeze/slow, room and phase, player/armed state, session/meta/run/obols/shop/mystery/reward/rite/history, rack/offering, boons, enemies, bolts, and metrics.
- `frameStats()`: `{ frames, p50, p95, max }` render frame time in ms over the last 240 frames.
- `mute(m?)`, `debug(v?)`: toggle audio / overlay, return the new state.
- `record(on?)`: start (resets to a fresh run of the current seed/scenario) or stop recording. Returns whether recording.
- `stopRecord()`: stop, return the `Replay`, and log its JSON to the console.
- `download(name?)`: save the last recording as a `.json` download (stops recording first if needed).
- `replay(obj)`: reset to the replay's seed/scenario and feed its frames instead of input. Live input resumes when frames run out. A playtest BUNDLE also applies its own condition (`src/playtest.ts`), and `no-dash` does that by lifting the dodge-to-attack cancel in `tuning` — which is sticky for the rest of the page, deliberately: a session that has installed a no-dash replay is no longer a baseline session. Reload before measuring anything else.
- `inspectSave()`: the in-memory envelope (`schemaVersion`, `contentRevision`, `revision`, `meta`, `checkpoint`). Null checkpoint means town or no active run.
- `gotoRoom(id, { skipRite? })`: debug jump. On `loop` it starts a run if needed, then `enterRoomById`. `skipRite` answers an unasked rite so Charon's modal does not cover the room.
- `giveRemembrances(n)`: add (or subtract) banked Remembrances. Returns the new total.

## Pose a frame and look at it

`pnpm shot -- --scenario dummy --seed 1 --stepwise 1 --ticks 60 --debug 1 --eval "__game.setInput({attack:true,aimX:1}); __game.step(4)" --out shots/swing.png`

- `--stepwise 1` pauses the loop and steps exactly `--ticks` ticks, so the state is deterministic. Without it the loop
  runs free and the reported tick can overshoot by up to 4.
- `--eval` runs JS in the page after the ticks and before the screenshot. Set `window.__out = {...}` to get values back
  in the printed JSON (`extra`). The JSON also has `state` (from `__game.state()`), `stats`, and console `errors`.
- `--press Enter --waitMs 700 --postEval "window.__out = ..."` drives and observes a real-time UI
  transition after deterministic setup. `--postEval` runs after the wait, immediately before capture.
- `--postWaitMs 1000` waits again after `--postEval`; use it to prove a cancelled async transition
  stays cancelled instead of completing late.
- Then read the PNG. The default is 1920x1080 with the 640x360 render target upscaled 3x. Pass
  `--oneX 1` for the art-review lane: the browser and PNG are exactly 640x360, and the command
  fails if capture dimensions drift.

## Record and replay

A replay is `{ v: 1, seed, scenario, god?, meta?: MetaStateV1, frames: InputFrame[] }` (`src/sim/replay.ts`). On disk it is run-length
encoded: `runs: [moveX, moveY, aimX, aimY, flags, count]` with axes as ints x10000 and flags bits
`1 aimSoft, 2 attack, 4 dodge, 8 restart, 16 attackHeld, 32 confirm, 64 choice-left, 128 choice-right, 256 heavy, 512 reroll`
(the table in `src/sim/replay.ts` is the source of truth; `pnpm test` fails if this line drifts from it). The browser quantizes every frame to 1/10000 before the sim sees it, so
what was played and what is stored are identical. A `loop` replay's hash depends on its `meta`, because `hashWorld` folds
attempts and victories in for that scenario; the pinned fixtures are all non-`loop` and carry none.

The workflow at `ci/github-actions.yml` is a parked template, not active CI. Until a separately
authorised move to `.github/workflows/ci.yml`, run the documented typecheck, test, build, matrix,
browser-smoke, art, and desktop gates manually before merging.

- Browser: F2 starts a fresh run and records; F2 again stops; F3 downloads `<scenario>-<seed>-<ticks>.json`. Move the
  file into `replays/`. A restart (R) ends the recording. "REC" blinks top-centre while recording, "REPLAY" while replaying.
- Scripted: `pnpm record-bot -- --bot kite --scenario full --seed 2 --out replays/kite-full-s2.json`.
- Headless: `pnpm sim -- --replay replays/kite-full-s2.json [--ticks 300] [--playtest <condition>]` prints hash, player, metrics. `--ticks` stops early; a playtest bundle applies its own condition unless `--playtest` overrides it.
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

- `src/sim/`: `world.ts` (state), `session.ts` (run/meta boundary), `rooms.ts` + `waves.ts` (graph/encounters),
  `rewards.ts` + `boons.ts` (offers/build effects), `preparation.ts`, `storage.ts`, `step.ts`, `player.ts`, `combat.ts`,
  `enemies/`, `projectiles.ts`, `scenarios.ts`, `bots.ts`, `metrics.ts`, `hash.ts`, `replay.ts`, `rng.ts` (never `Math.random`).
  `save.ts` is the canonical save document (envelope, validation, migrations) and `storage.ts` the two
  pre-envelope keys it migrates from; both are pure and NEITHER is reachable from `stepWorld`, which
  `tests/sim/boundary.test.ts` asserts -- editing them cannot move a replay hash.
- `src/platform/`: the seam. `index.ts` (Platform + SaveStore + `detectPlatform`), `web.ts`
  (localStorage store with a `.bak` rotation, legacy upgrade, persistence hint), `desktop.ts` (the
  Electron bridge), `saveFile.ts` (recovery order: save -> backup -> defaults), `dom.ts`. This is the
  only directory in `src/` allowed to name a host API.
- `desktop/`: the Electron host (`main.cts`, `preload.cts`, `save-store.cts`, `ipc-saves.cts`), compiled
  to `desktop/out/*.cjs` by its own tsconfig. It never imports from `src/`, and nothing in `src/`
  imports it. Tier-3 only: no gameplay change should ever need it.
- `src/render/`: `presenter.ts` reads world + events and drives sprites, particles, shake, decals, HUD; `reward.ts` owns rewards, victory, pause, build, and meta overlays.
- `src/input/`: keyboard/mouse/gamepad to `InputFrame`; `recorder.ts` captures frames.
- `src/debug/`: `api.ts` (`window.__game`), `overlay.ts` (F1).
- `src/main.ts` wires it all; `src/loop.ts` is the fixed 60 Hz accumulator with interpolation and a 5-step catch-up cap.
