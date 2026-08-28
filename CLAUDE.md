# Bardo Rogue

Browser action-roguelike vertical slice: one arena, three waves, one sword. PixiJS v8 + Vite + TypeScript strict, pnpm.
Design rationale and the full plan: `/Users/davidraphael/.claude/plans/web-roguelike-action-rpg-glimmering-pnueli.md`.
Agent harness (URL params, `window.__game`, shot/pose/headless tools, replays): `HARNESS.md`.
Standing directive for agents working here: `GAUNTLET.md` (build/critic loop, commit after every passed piece, keep `public/progress/data.json` current).

## Rules that keep the game tunable
- `src/sim/` is pure TypeScript: no DOM, no pixi, no `Math.random`, no `Date`. It is deterministic given (seed, scenario, inputs) and runs headless in Vitest and `tools/headless.ts`.
- Presentation (`src/render/`, `src/audio/`) reads sim state + `world.events` and never mutates the sim.
- Every gameplay and feel number lives in `src/tuning.ts`. Do not hardcode numbers in systems.
- Time is in ticks (60 Hz); distances in px (1 tile = 16 px); speeds in px/s.
- Entities are pooled; no per-tick allocations in the sim.

## Verify before claiming done
- `pnpm typecheck` and `pnpm test` must be green.
- Visual changes: `pnpm poses` (pose sheet of ~30 key frames) and/or `pnpm shot -- --scenario wave1 --bot naive-melee --ticks 500`, then Read the PNG.
- Balance changes: `pnpm sim -- --scenario full --bot kite --seeds 1-8` and compare against the targets in the plan (skilled clear 60–120 s, idle dies in wave 1).
- The dev server is usually already running on :5173; check before starting another.
- Platform changes (`src/platform/`, `desktop/`): `pnpm desktop:build && pnpm smoke:desktop` — 15 hosting checks including replay-hash parity between the packaged app and `pnpm sim`. Never needed for a gameplay change.
- Any change to what `stepWorld` or `createWorld` can reach (most of `src/sim/`, and `src/tuning.ts`) breaks the pinned hashes in `tests/sim/replay.test.ts`. If intended: `pnpm record-bots`, paste the printed hashes into the test. Never hand-edit a hash, and never run `record-bots` to make a failure go away — it would launder real drift into the fixtures. `src/sim/save.ts` and `src/sim/storage.ts` are pure document code that the sim never calls (`tests/sim/boundary.test.ts` asserts it), so editing them must NOT change a hash.
- `pnpm shot`/`pnpm poses` never start Vite; use `--stepwise 1` for a deterministic frame (free-run overshoots by up to 4 ticks).

## Platform
The browser is the development target and stays first-class; `desktop/` is a thin Electron host around the same build. `src/sim/` and `src/render/` never learn which host they are in — everything host-specific goes behind `src/platform/`. Saves are one versioned JSON envelope (`src/sim/save.ts`), stored in localStorage on the web and in `userData/saves` on the desktop. The full rationale, phases and the Steam path: `PLATFORM_STRATEGY.md`.

## Assets
`public/assets/` is committed. A release build copies ONLY `public/assets` (publicDir is off for `command === 'build'`), so anything else added under `public/` will not ship; `tools/check-build.ts` fails the build if a required file or a manifest-named asset is missing, or if evidence, a video or an oversized payload got in. Two generators write it and both rewrite `manifest.json`: `pnpm assets` (Kenney subset, needs `KENNEY_DIR` + `unzip`) then `pnpm tiles` (original `bardo_room.png`/`bardo_props.png`). Running `assets` after `tiles` drops the bardo sprites from the manifest. Never edit generated files; change the tool.
Room tile indices: `src/sim/arena.ts` (bardo_room sheet). Character/weapon indices (still Kenney Tiny Dungeon): `src/render/views.ts` (`SPRITE`, `WEAPON`).
