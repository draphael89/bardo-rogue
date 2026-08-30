# Bardo Rogue — overnight art and first-minute closeout

**Date:** 2026-08-30  
**Branch:** `codex/bardo-first-sixty-seconds`  
**Implementation anchor:** `79825672ad517673d0a71826c8e7946cb79fdcc6`  
**Reconciled main:** `2b82d61c9103a34b9abdc535afe165efbad4f630`

The branch now delivers a coherent first minute: the title belongs to the Bardo Gate; DESCEND makes
one guarded in-engine passage to the unarmed body; the route from arrival, relic, rack, and first
fight reads as one pilgrimage; and the first combat room teaches its controls without adding another
modal. Room art is authored at the native 24-source-pixel contract while the simulation remains on
its original 16px logical grid.

## What changed

- `e9889c9` — native 24px tile / 48px prop art, high-resolution bake, blocking room-art gate.
- `6ce132f` — Gate-led title and 1.45s Gate-to-player descent, including reduced-motion and cancellation.
- `624f71c` — dagger and heavy-armor Blender stress variants plus a draft hard-constraints contract.
- `389271f` — native, landscape, portrait, and fullscreen viewport fit without shrinking the authored canvas.
- `d9dd659` — broken inner arris on the Gate without changing collision or light count.
- `4539e93` — merge reconciliation with `origin/main` at `2b82d61`.
- `64fc801` — compact first-fight control legend.
- `e7a9c2e` — Bardo procession inlay connecting arrival, junction, and Gate.
- `a829d40` — Keeper light, cold braziers, pier damp, numen lantern, and baked causeway wear.
- `7982567` — a code-authored fallen Veteran relic replaces the generic ossuary on the same solid cell.

## The three inherited polish gaps

1. **Letterbox stars:** closed. `src/render/starfield.ts` applies `ambientRest()` to the stars, so the
   letterbox edge no longer reveals a separate untreated sky layer.
2. **East-door `-4`:** closed. `doorEnterInset: 4` lives in `src/tuning.ts` and `src/sim/rooms.ts`
   reads the tuning value; there is no unexplained orientation-only literal.
3. **Pinned rewritten-Bardo replay:** closed. `replays/slice-kite-loop-s7.json` is pinned in
   `tests/sim/replay.test.ts` at hash `1142161593`. The exact replay wins in 3,461 ticks (57.7 s),
   crosses all six combat rooms, lands 46 hits, cuts 17 bolts, and takes one hit.

## Art custody

Shipping art in this branch is code-authored and reproducible. The dagger and heavy-armor sheets are
unapproved pipeline candidates, not player identity. ImageGen was used aggressively for composition,
material, control-strip, procession, and fallen-relic studies; no generated pixels were promoted to
`public/` or the approved catalogue. The admitted relic was redrawn through `tools/make-bardo-tiles.ts`
using 10 canonical colours, binary alpha, and a 12-colour cap. `pnpm art approve` was not run.

The candidate constraints are in `docs/CHARACTER_HARD_CONSTRAINTS.md`. Dagger and heavy armor each
render 42 frames across south/north/east, six compiled sheets in total, computed sockets, 1× floor
sheets, and black tests. Their 1,062 automated gates have zero blocking failures. This proves the
pipeline and silhouette constraints, not the final identity or Look.

## Attended observations

The curated exact-head title, arrival, descent, and first-fight frames are tracked in
`public/progress/shots/` as `title-menu.png`, `bardo-arrival-r7.png`, `descent-r7-*.png`, and
`first-fight-r7.png`. The broader scratch study remains local and intentionally ignored under
`shots/attended/`:

- `first-minute/` and `keyboard-route/`: title, Settings, Credits, descent beats, rack, first fight,
  and the exact-head teaching strip.
- `veteran-relic/causeway-v2.png`: the final causeway; the body reads from low helm, shoulder, and
  wine mantle while staying subordinate to the Keeper light.
- `combat-*.png` and `replay-contact-strip.png`: Acheron, Lethe, Asphodel, Phlegethon, the
  Antechamber, Minos, and contact cadence.
- `viewport-*`: 390×844 portrait, 900×506, 1280×720, 1920×1080, and fullscreen.
- `exact-head-room-gates/`: exact room composites and numeric gate results.

Objective observations: the causeway centre now measures roughly twice the perimeter value; the
four Bardo islands retain 82.6%–95.2% negative space; the Bardo frame remains below the highlight
budget and retains a concentrated focal peak. UI panels remain legible at the tested sizes, real
keyboard input reaches the first fight, and reduced motion snaps the descent instead of animating it.

Subjective questions left deliberately open: whether the causeway has the desired emotional weight,
whether the Veteran relic is poignant rather than merely legible, whether combat reads as satisfying
at human speed, and whether the dagger/heavy identity deserves approval. **Look and Fun are OPEN,
user-only gates.** No agent or automated play awarded them.

## Exact-head proof ledger

| Lane | Result |
|---|---|
| Typecheck | `pnpm typecheck` green |
| Full suite | `pnpm test` — 76 files, 909 tests green |
| Loop matrices | `pnpm matrix` — kite 100/100 resolved, 79 wins; naive 100/100 resolved, 0 wins |
| Pinned replay | `slice-kite-loop-s7.json` hash `1142161593`, won |
| Web package | `pnpm build` green; shipped 2.110 MB vs 4.096 MB budget, 174 files |
| Browser smoke | `pnpm smoke -- --url http://localhost:5201` green, real keyboard and both endings |
| Room art | `pnpm room:gate` green, including dimensions, alpha, palette, material spans, negative space, value, highlights, and focality |
| Regeneration | `pnpm palette` and `pnpm tiles` deterministic; no unexplained drift |
| Shipping sprite gates | 78/3 waived general, 144/2 hero, 144/4 north, 40/1 north roll, 145/2 south, 40/1 south roll; zero blocking |
| Candidate stress | `pnpm art:stress-hero` green for dagger and heavy; candidate-only |
| Desktop | `pnpm desktop:build` green; isolated `pnpm smoke:desktop` green across 23 checks and 6 launches |
| Deterministic visual evidence | `pnpm shot ... --visualMs N`; independent title boots at 500 ms are byte-identical, SHA-256 `096aca3759cd68606d6b7790d21fc66b99a6cde2028b7c0fdd172e5a92e2eed9`. Pinned replay tick 400 + visual 500 ms is also byte-identical, SHA-256 `779fa78980069598578d8e576f9add48436a1ec4bf90256669c384cba5cf5e70` |

The first desktop smoke observed one banner-timing failure on the import-durability assertion
(`ROOM CLEARED` replaced the expected acknowledgement). An isolated rerun passed the same durable
write assertion plus all corruption and relaunch checks. It is recorded as a single timing flake,
not silently converted into a clean first run.

## Custody and release ledger

- The implementation anchor and its reconciled `origin/main` are named above. The final local and
  remote branch IDs are obtained with `git rev-parse HEAD` and
  `git rev-parse origin/codex/bardo-first-sixty-seconds`; a commit cannot self-contain its own hash.
- The branch was pushed only to its existing successor branch, as authorized. No destructive Git
  operation was used.
- PR #28 exists and is open. It was created by the separate live Claude session; this closeout did
  not create, merge, close, or otherwise mutate it.
- Merge: **not performed**. Deployment/publishing: **not performed**. Release: **not declared**.
- Human Look acceptance: **OPEN**. Human Fun acceptance: **OPEN**.
