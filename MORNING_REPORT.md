# Bardo Rogue — overnight art and first-minute closeout

**Date:** 2026-08-30  
**Branch:** `codex/bardo-first-sixty-seconds`  
**Recorded proof head before the final report updates:** `c696f668548174cc77bfb83d80c1919fa04ed058`
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
- `310537e`, `712adf4`, `d2d8e49` — fixed-clock title, descent, combat, and screenshot evidence.
- `0c2abd4`, `e8b8ca9`, `ac5bb72` — Acheron shore, Cocytus weep, and Minos verdict dressing.
- `455a4e9`, `d2b8904`, `b017a2d`, `f50ccb1` — deterministic realm/room evidence and live resize coverage across every first-minute UI surface.
- `1a4093d` — dagger/heavy stress regeneration now fails on any drift from its committed evidence.
- `c696f66` — exact room evidence covers every production layout and the real Styx/Phlegethon nodes.

## The three inherited polish gaps

1. **Letterbox stars:** closed after a runtime correction. A deterministic 390×844 probe disproved
   the earlier source-level answer: the bars resolved to `(0,0,2)` beside a `(0,0,4)` target sky.
   `src/render/starfield.ts` now starts both surfaces from the same authored void and star colours
   before the shared frame grade. All four tested boundaries resolve to `(0,0,4)` at 390×844 and
   900×506; `tests/render/starfield.test.ts` guards against reintroducing a gutter-only ambient pass.
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
using 10 canonical colours, binary alpha, and a 12-colour cap. The Hall of Minos study likewise
stayed reference-only: its admitted result is one code-authored verdict stele and one transparent
wax-red sentencing rule in the native sheets. A later four-realm ImageGen board was deliberately
rejected as too ornate; only its material premise survived as low iron-link overlays for Styx/Oath
Court and sparse wine-dark seams for Phlegethon. `pnpm art approve` was not run.

The candidate constraints are in `docs/CHARACTER_HARD_CONSTRAINTS.md`. Dagger and heavy armor each
render 42 frames across south/north/east, six compiled sheets in total, computed sockets, 1× floor
sheets, and black tests. Their 1,062 automated gates have zero blocking failures. This proves the
pipeline and silhouette constraints, not the final identity or Look.

## Attended observations

The curated exact-head title, arrival, descent, first-fight, and viewport frames are tracked in
`public/progress/shots/` as `title-menu.png`, `bardo-arrival-r7.png`, `descent-r7-*.png`, and
`first-fight-r7.png`, `acheron-shore-r7.png`, `cocytus-weep-r7.png`, `minos-verdict-r7.png`, plus `viewport-390x844-*.png` and
`viewport-900x506-title-r7.png`. The broader scratch study remains local and intentionally ignored under
`shots/attended/`:

- `first-minute/` and `keyboard-route/`: title, Settings, Credits, descent beats, rack, first fight,
  and the exact-head teaching strip.
- `veteran-relic/causeway-v2.png`: the final causeway; the body reads from low helm, shoulder, and
  wine mantle while staying subordinate to the Keeper light.
- `combat-*.png` and `replay-contact-strip.png`: Acheron, Lethe, Asphodel, Phlegethon, the
  Antechamber, Minos, and contact cadence.
- `viewport-*`: 390×844 portrait, 900×506, 1280×720, 1920×1080, and fullscreen.
- `ui/`: title Settings/Credits and pause menu/Settings at native, portrait, and wide desktop sizes.
- `exact-head-room-gates/`: exact room composites and numeric gate results.

Objective observations: the causeway centre now measures roughly twice the perimeter value; the
four Bardo islands retain 82.6%–95.2% negative space; the Bardo frame remains below the highlight
budget and retains a concentrated focal peak. The exact room gate samples all 13 production-loop
layouts once across the real first-gate, Fire Ford, and Styx Gate spines; the dedicated Styx and
Phlegethon nodes are asserted separately from alternate dresses, and Bardo is captured before any
run is installed so its HUD is the fresh first-minute state. UI panels remain comfortable at native size and above,
real keyboard input reaches the first fight, and reduced motion snaps the descent instead of animating it.
At 390×844 and 900×506, the sampled sky values now remain continuous across every target boundary;
the tracked portrait frames preserve the complete title and Bardo rather than clipping either.
The 390-pixel portrait fit is intact but physically small: it is routing and no-crop proof, not a
claim of comfortable keyboard play or user acceptance at that width.
At Acheron, the lower fight lane now reads as one silt lip over a two-tile water body; the same-solid
test proves this is geographic dress rather than hidden collision, and its exact exhibit is
byte-identical across independent boots at SHA-256
`e3a4b425ab34c35545beb70b2038b936f75f3ee49e5103a75233c9ecfbddc9ff`.
At Cocytus, a single cold reflection now belongs to the west-edge weep and expires before the dry
fight circle; its floor and dark are paler and more cyan than Acheron's indigo river. The deterministic
realm-air pass moves Acheron/Cocytus from distance 1.09 to 3.36 and outside the closest pair; median
room separation rose from 10.54 to 11.32; after the final Minos dress the exact-head median is
11.31, still with no wrong-temperature rooms. The exact
combat exhibit is byte-identical at SHA-256
`519384bda07ee327f77a42a855bddb82ae5161c96c7e46c5c759d02c94823902`.
At Minos, the existing unequal scale now answers a broken verdict stele and a narrow wax-red sentence
beneath the Judge. Both are non-solid dress behind the fight lanes; the stele spends no gold and the
circle at `(13, 8)` remains bare. The exact tick-3,000 combat exhibit is byte-identical across clean
boots at SHA-256 `2041adda274fce80d0c9dd1ebd22a62df9688dbfbd81a9c284f9aa3f926f704d`.
At real 640×360 presentation scale, Styx's two iron fastenings remain readable beside the black-water
banks without resembling pickups; Oath Court repeats the motif at opposite edges; Phlegethon's two
dead-wine seams read as heat without borrowing bright ember, gold, or the central combat field.

Subjective questions left deliberately open: whether the causeway has the desired emotional weight,
whether the Veteran relic is poignant rather than merely legible, whether combat reads as satisfying
at human speed, and whether the dagger/heavy identity deserves approval. **Look and Fun are OPEN,
user-only gates.** No agent or automated play awarded them.

## Exact-head proof ledger

| Lane | Result |
|---|---|
| Typecheck | `pnpm typecheck` green |
| Full suite | `pnpm test` — 77 files, 911 tests green |
| Loop matrices | `pnpm matrix` — kite 100/100 resolved, 79 wins; naive 100/100 resolved, 0 wins |
| Pinned replay | `slice-kite-loop-s7.json` hash `1142161593`, won |
| Web package | `pnpm build` green; shipped 2.110 MB vs 4.096 MB budget, 174 files |
| Browser smoke | `pnpm smoke -- --url http://localhost:5201 --seed N` green with real keyboard and both endings on Ash March seed 2, Styx Gate seed 10, and Fire Ford seed 31. Toll rendering is required only on routes that actually reach the Landing; early deaths and bankless spines no longer create a false failure |
| Viewport transitions | `pnpm smoke:viewport -- --url http://localhost:5201` green through 640×360 → 1400×600 → 390×844 → 1920×700 → 900×506 → 640×360 across title menu/Settings/Credits, game HUD, and pause menu/Settings; target and UI bounds remain contained, tick stays 0 |
| Room art | `pnpm room:gate` owns every render and is green across the fresh pre-run Bardo plus all 12 production route layouts, including the named Styx and Phlegethon nodes, dimensions, alpha, palette, material spans, negative space, value, highlights, focality, and browser errors; two complete outputs are byte-identical at SHA-256 `4464422c2d45fdd404d0ac49c3d645a6e4c971720c5413750e23a2549a8d4884` |
| Realm separation | `pnpm realm-air -- --url http://localhost:5201 --seed N` installs the real seeded route before measuring it and owns every render. Exact repeat pairs are byte-identical for first-gate seed 1 (`ff8533e3…`, median 11.31), Fire Ford seed 31 (`9cb35419…`, 10.61), and Styx Gate seed 10 (`2bc3a662…`, 10.79); zero skipped rooms, browser errors, or temperature violations. No arbitrary pass threshold invented |
| Regeneration | `pnpm palette`, `pnpm assets`, and `pnpm tiles` deterministic; the 192×288 room sheet and 192×192 prop sheet regenerate byte-identically with no unexplained drift |
| Shipping sprite gates | 78/3 waived general, 144/2 hero, 144/4 north, 40/1 north roll, 145/2 south, 40/1 south roll; zero blocking |
| Candidate stress | `pnpm art:stress-hero` green for dagger and heavy; all four regenerated 1×/black-test artifacts byte-identical to committed exhibits; candidate-only, with in-game motion and user Look still open |
| Desktop | Exact current `pnpm desktop:build` and `pnpm smoke:desktop` are green on the first run across 23 checks and 6 launches |
| Performance | SwiftShader exact-head probes: Warden render p50 1.2 ms / p95 2.2 ms; synthetic 32-enemy + 64-projectile render stress p50 24–25 ms / p95 31–32 ms with render-only hash unchanged. Pinned replay and dense sim each repeated 100× with stable hashes; stress figures are not a native-GPU or Fun claim |
| Deterministic visual evidence | `pnpm shot ... --visualMs N` owns every render from before boot. Three independent exact-current live-bot captures at seed 7 / tick 400 + visual 500 ms are byte-identical, SHA-256 `b9e4fa9db6383cd281cb4d2cf57317af232167a831a4559cdb54a4279b928f3d`; this player-facing exhibit omits the replay diagnostic while the separate pinned-replay lane retains hash truth. Three title boots are byte-identical at `c1318840345230773edac472c8d31e25f78f4ce3b719954c83a85075abfc4bb4`; two independent captures match at each of the four descent phases. |
| Viewport boundary evidence | 390×844 title SHA-256 `ed3d89b4a1a7225ce1100589116c275c75575a0593648811d3066cd01fc9b8d1`; 390×844 game `ebcc7c8c21b34bdd12d1ce29f1439aa953f863a8efc15f8d492e6d5659fd3969`; 900×506 title `becb27e095f6a2f2b0e3c4348b3de7344fc90e81e4e510c0d30ecd39855c7446` |

The first fixed-clock capture implementation was not sufficient. A fresh five-run probe found two
alternating first-fight hashes: an uncontrolled number of zero-time boot renders still consumed the
seeded FX streams. The evidence lane now swallows rAF before boot and invokes the production render
hook itself in fixed quanta. The older `096aca...` / `779fa...` screenshot hashes are invalidated;
the hashes above are the clean-room replacements. This is a tooling correction, not a visual change.

The first desktop smoke observed one banner-timing failure on the import-durability assertion
(`ROOM CLEARED` replaced the expected acknowledgement). An isolated rerun passed the same durable
write assertion plus all corruption and relaunch checks. It is recorded as a single timing flake,
not silently converted into a clean first run.

## Custody and release ledger

- The recorded proof head and its reconciled `origin/main` are named above. The final local and
  remote branch IDs are obtained with `git rev-parse HEAD` and
  `git rev-parse origin/codex/bardo-first-sixty-seconds`; a commit cannot self-contain its own hash.
- The branch was pushed only to its existing successor branch, as authorized. No destructive Git
  operation was used.
- PR #28 exists and is open. It was created by the separate live Claude session; this closeout did
  not create, merge, close, or otherwise mutate it.
- Merge: **not performed**. Deployment/publishing: **not performed**. Release: **not declared**.
- Human Look acceptance: **OPEN**. Human Fun acceptance: **OPEN**.
