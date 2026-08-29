# Bardo Rogue: Gauntlet Loop

> **STATUS (2026-08-28): retired as the standing directive.** The gauntlet froze at wave 3 with nine
> of ten pieces parked on the same missing input — authored art — while PRs #6–#9 shipped through the
> PR loop (plan -> build -> multi-agent adversarial review -> merge), which `CLAUDE.md` now names the
> standing directive. This file stays as the design record of the loop. The blind-critique protocol
> (`.claude/skills/bardo-critic`) lives on solely as the realm-art acceptance gate: three exhibits
> (a combat room, the utility node, the Hall of Minos), per `VERTICAL_SLICE_PLAN.md` §G.5.
> Parked-piece dispositions: `public/progress/data.json`.

Build a web-based roguelike action RPG / bullet hell at the level of Enter the Gungeon and Hades. Beautiful, electric, and perfect in every part: combat feel, enemy behavior, bosses, bullet patterns, atmosphere, art, sound, music, UI, run structure, and anything else you can think of. A complete run: rooms, floors, bosses, weapons and items, death and return. It must run in a normal browser at a locked 60 fps. Working title: Bardo Rogue. The bardo, the space between death and rebirth, is the theme.

**The bar is the real games.** For every piece, find actual Enter the Gungeon and Hades footage of the same moment (official press kits, wiki GIFs, frame-by-frame breakdowns) and judge ours next to it, blind. Pick whichever of the two is the fairer comparison for that piece. Reference only: never copy their art, names, characters, or lore.

## How to run it

Run the loop with `/gauntlet` (the harness: blind critics, both exhibit orders, one gap per round, PARKED after two stalls, `gauntlet/state.json` as the durable truth). Use `.claude/skills/bardo-critic` for this repo's evidence protocols, rubric axes, automated gates, lanes, and the stall-then-split rule. `VISION.md` section 5 fixes the order: prove the sword before the room is pretty.

## What exists

`pnpm dev` (port 5173) runs a deterministic 60 Hz sim with a Pixi 8 renderer and placeholder Kenney art. Inspection harness: `pnpm shot` (Playwright screenshot: `--scenario --seed --ticks --bot --stepwise --eval`), `window.__game` (`step`, `reset`, `setInput`, `bot`, `state`, `hash`, `frameStats`), `pnpm sim` (headless runs with metrics), `pnpm test`, `tools/contact-sheet.mjs` (frame strips for motion). The Chrome and PixelLab MCP tools are available. Keep the sim deterministic and the tests green; every tool above depends on it. Everything else, including the art direction and the run structure, is yours to decide and replace.

## How to work

1. Break the game into the smallest pieces that can be improved and judged on their own. You choose the pieces, not me. Fan out subagents and ultracode.

2. Each piece gets a builder and a separate critic with fresh context. The critic never sees the builder's notes or summary. It inspects the actual rendered game: screenshots, frame sequences or GIFs for anything that moves, `__game.state()` traces for behavior, and it plays it. Then it puts ours next to the real reference, blind, and says which is better. When ours loses, it names the single biggest gap and sends the builder back. Be a harsh critic. "Good for AI" is a loss.

3. No fixed number of rounds. A piece is done only when the critic picks ours in the blind comparison and is honestly wowed. /loop until then.

4. Between major waves, spawn one fresh agent to play the whole game start to finish and smooth everything into one coherent thing: one art style, one feel, no seams.

5. Keep a simple live progress page at `public/progress/index.html` (served by the dev server) updated as you go: per piece, before/after images or GIFs, the critic's verdict and biggest gap, round count, and a timeline. I will watch it from my phone. Do not wait for me.

6. Commit after every piece passes its critic so progress is never lost. When blocked, pick a sensible default, note it on the progress page, and keep going.

Don't stop until every critic is utterly wowed next to the real Enter the Gungeon and Hades, or until I stop the run.
