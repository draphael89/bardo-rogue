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
- Any change in `src/sim/` or `src/tuning.ts` breaks the pinned hashes in `tests/sim/replay.test.ts`. If intended: `pnpm record-bots`, paste the printed hashes into the test. Never hand-edit a hash.
- `pnpm shot`/`pnpm poses` never start Vite; use `--stepwise 1` for a deterministic frame (free-run overshoots by up to 4 ticks).

## Assets
`public/assets/` is committed. Two generators write it and both rewrite `manifest.json`: `pnpm assets` (Kenney subset, needs `KENNEY_DIR` + `unzip`) then `pnpm tiles` (original `bardo_room.png`/`bardo_props.png`). Running `assets` after `tiles` drops the bardo sprites from the manifest. Never edit generated files; change the tool.
Room tile indices: `src/sim/arena.ts` (bardo_room sheet). Character/weapon indices (still Kenney Tiny Dungeon): `src/render/views.ts` (`SPRITE`, `WEAPON`).
