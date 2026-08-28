# Bardo Rogue — Platform Strategy: Web-First Development, Native Mac Distribution

Evaluated 2026-08-28 against commit `4d44311`. Every claim below about the current repository was
verified against the tree, the test suite, a headless sim benchmark, and a production build — not
assumed from the stack names.

**The verdict, up front:** keep the browser as the primary and only day-to-day development target,
and add a ~2-file Electron shell as a *validation and distribution* target, introduced behind a
platform seam the codebase has already half-built (`StorageLike` in `src/sim/storage.ts`). Electron
wins not because it is fashionable but because it is the only desktop option whose runtime is the
*same browser engine the entire test harness already runs on*, which means the deterministic replay
hashes, the Playwright screenshot tooling, and `window.__game` carry into the packaged app
unchanged. Its costs (download size, RAM) land on dimensions Bardo does not care about; every
alternative's costs land on the dimensions Bardo cares about most (testing, agent iteration, one
engine everywhere).

---

## A. Current Platform Architecture

What Bardo actually is today:

- **Runtime:** PixiJS v8.20 on WebGL (`preference: 'webgl'`, antialias off, Pixi ticker disabled —
  the game owns its frame). Everything renders into a 480×270 `RenderTexture`, blitted at integer
  physical-pixel scale. One dependency in the shipping bundle: `pixi.js`.
- **Simulation:** `src/sim/` (~3,700 LOC) is pure TypeScript — no DOM, no Pixi, no `Math.random`,
  no `Date`. Fixed 60 Hz step (`src/loop.ts`, accumulator with a 5-step catch-up cap and render
  interpolation). Deterministic given `(seed, scenario, InputFrame[])`; FNV state hashes are pinned
  in `tests/sim/replay.test.ts` and must match between Node and the browser.
- **Presentation:** `src/render/` + `src/audio/` (raw Web Audio) read sim state and `world.events`,
  never mutate. All numbers in `src/tuning.ts`.
- **Input:** keyboard, mouse, **and gamepad** already funnel into one quantized `InputFrame` per
  tick (`src/input/index.ts` — Gamepad API with edge detection). Fullscreen already wired (F key,
  Fullscreen API). Focus-loss clears latched input.
- **Persistence:** `src/sim/storage.ts` defines a `StorageLike` interface (get/set/removeItem) with
  versioned, defensively-parsed schemas (`MetaStateV1`, `SettingsStateV1`). `src/main.ts` injects
  `localStorage` as the adapter. The sim never touches a browser storage API directly. **The
  "Game Save Model → Persistence Interface → Platform Adapter" architecture the addendum asks for
  already exists in embryo.** Replays even embed meta so loop replays are hermetic.
- **Harness:** `window.__game` (step/reset/setInput/bot/state/hash/frameStats/record/replay), URL
  params, five bots, RLE replay format, `pnpm sim` (headless Node), `pnpm shot`/`pnpm poses`
  (Playwright + Chromium + SwiftShader), gauntlet loop with evidence protocol. 184 Vitest tests in
  ~4.3 s; `tsc --noEmit` clean.
- **Payload (measured, this commit):** production JS **844 KB** across 14 chunks (almost all Pixi),
  game assets **1.7 MB** (1.3 MB of it audio). The whole shippable game is ~2.5 MB. The 131 MB
  `dist/` is an artifact of `public/progress/` (the 125 MB gauntlet evidence journal) being copied
  into the build; it is dev-only and would be excluded from any player build.
- **No CI, no backend, no accounts, no network calls at runtime** beyond fetching its own assets.

## B. Current Constraints — Real vs. Hypothetical

Measured on this container (no GPU, software rendering available to Playwright via SwiftShader):

| Question | Answer | Evidence |
| --- | --- | --- |
| CPU / sim bound? | **No, by ~3 orders of magnitude.** | `pnpm sim --scenario full --bot kite`: **avg 15.6 µs per tick** (max spike 1,051 µs incl. JIT warm-up) against a 16,667 µs budget — ~0.1% of frame. Two full runs simulate in 1.2 s wall including Node startup. |
| GPU / draw-call bound? | No. 480×270 target, a few dozen pooled sprites, particles, a handful of filters, one RT blit. **SwiftShader (software GL) renders it** — that is the whole screenshot harness. | `tools/shot.ts` launches Chromium with `--use-angle=swiftshader`. |
| JS-main-thread bound? | No. Sim + render share the thread with enormous headroom; the loop's own `frameStats()` p50/p95 gates in the gauntlet are the watchdog. | `src/loop.ts`, `HARNESS.md` |
| Asset-loading bound? | No. 1.7 MB total; audio deliberately not awaited at boot. | `src/main.ts:49` |
| Memory bound? | No. Pooled entities, no per-tick allocation in sim (project rule). | `CLAUDE.md` |
| Physics / networking? | None exist. | — |

Scaling to the full VISION.md ambition (Hades-structure × Gungeon-density: multiple realms,
bullet patterns, hundreds of projectiles) multiplies the sim workload perhaps 50–100×. That is
still ~1–2 ms per tick — comfortable. The resolution is fixed at 480×270 by art direction, so GPU
load barely grows. **No credible version of this game is performance-constrained on a browser
runtime, and any option scored below gets zero credit for "native is faster."**

The constraints that are *real* today are not performance:

1. **Save durability.** Meta progression lives in `localStorage`. Browsers may evict it (Safari's
   ITP caps script-writable storage at 7 days for infrequently-visited origins; users clear site
   data; private windows). For a roguelike whose core promise is "what you rescued, unlocked, and
   learned stays with you," this is the single genuine platform weakness in the current
   architecture.
2. **Browser chrome vs. game input.** In browser fullscreen, **Escape exits fullscreen** — but
   Escape is the game's pause key. Cmd+W closes the tab mid-run. F-keys, pinch-zoom, and the
   address bar all leak through. A browser tab cannot fully own its keys; a desktop window can.
3. **No app identity or distribution artifact.** Nothing a tester double-clicks; no Steam path.
4. **Steam overlay/cloud/achievements** obviously require a packaged build eventually.

Everything else — latency, frame pacing, rendering ceiling, audio — is hypothetical at this
game's workload and stays hypothetical at the full vision's workload.

---

## C. The Five Credible Options

Technologies that are variations of one strategy were collapsed: NW.js and Electron are the same
strategy (bundled Chromium); Neutralino/Wails/Capacitor-desktop and Tauri are the same strategy
(OS WebView shell). What remains is five genuinely distinct strategies.

### Option 1 — Pure Web, Polished (installable PWA, no native shell)

**What it is.** Ship the game as a website. Add a manifest + service worker so it installs as a
dock icon with its own window; use `navigator.storage.persist()` and save export/import to shore
up persistence. No packaging at all.

**Fit to the repo.** Zero change. The current architecture *is* this option.

**Workflow.** Unchanged: edit → Vite HMR → harness. Nothing added, ever.

**Runtime.** The user's browser (or its PWA window — same engine, slightly less chrome).

**Saves.** localStorage/IndexedDB + `persist()` (a *request*, not a guarantee) + manual export
files as the real backup. Eviction risk reduced, not eliminated.

**Testing.** Exactly today's three tiers minus tier 3 (there is no package to smoke-test).

**Performance.** Identical to today. Fine.

**Native experience.** A PWA window is better than a tab but still cannot own Escape in
fullscreen, has no menu bar identity, no filesystem saves, no Steam. The "beautiful dedicated Mac
app" goal is simply not reachable here.

**Steam.** None. Steam requires a shipped binary; adopting one later means starting Option 2/3
from scratch anyway (cheap, but this option contributes nothing toward it).

**Risks.** Save eviction stories from real players; the game permanently reads as "a web page."

**Score: 62.** Perfect on every high-weight development dimension (100s across agility, agent
fit, unification, testing, debuggability), but it forfeits the entire second layer of the
strategy: no durable saves, no app identity, no Steam. It is not really a competitor — it is the
baseline that the winning option must preserve. It survives in the recommendation as "the browser
remains the primary target"; it just can't be the *whole* answer.

### Option 2 — Electron Shell (bundled Chromium desktop runtime)

**What it is.** A `desktop/` folder containing a main process (~60 lines: create a
`BrowserWindow`, load the game, wire menus/fullscreen/quit-confirm) and a preload script (~40
lines: expose a filesystem-backed `StorageLike` over `contextBridge`). electron-builder produces a
signed, notarized `.dmg`/`.zip`. The game code is byte-identical to the web build.

**Fit to the repo.** Surgical. `src/main.ts` already injects storage; the only game-side change is
a `src/platform/` seam that picks "browser adapter" or "desktop adapter injected by preload" at
boot. The sim is untouched, so **every pinned replay hash stays valid**. In dev, the Electron
window can simply load `http://localhost:5173` — the shell itself gets Vite HMR for free.

**What changes.** Added: `src/platform/` (~100 LOC), `desktop/` (~150 LOC + config), two pnpm
scripts, one smoke-test tool. Removed/reorganized: nothing.

**Workflow.** *Agent changes combat code → browser hot reload → `pnpm shot`/`pnpm sim` validate →
commit.* The desktop shell is touched only when shell code changes or before a release:
`pnpm desktop:dev` to eyeball it, `pnpm smoke:desktop` in release prep. Packaging never enters the
inner loop.

**Runtime.** Chromium (the exact engine family `tools/shot.ts` already tests against) + a Node
main process that does nothing but window/menu/fs. All gameplay stays in the renderer, i.e., in
the same code the browser runs.

**Saves.** Preload adapter: reads the save dir into memory at boot, write-through with atomic
temp-file-rename plus one rolling `.bak`, under `~/Library/Application Support/Bardo Rogue/`.
Same versioned JSON documents `storage.ts` already defines. Browser keeps localStorage. Steam
Cloud later points at the same directory — zero code.

**Testing.** The decisive advantage: **Playwright drives Electron natively**
(`_electron.launch()`), and the page object it returns is the same API `tools/shot.ts` uses. The
tier-3 smoke test is ~50 lines: launch packaged app → `waitForFunction(!!window.__game)` →
stepwise 300 ticks → **compare `__game.hash()` against `pnpm sim` for the same seed** → screenshot
→ save write/read/corrupt-recovery roundtrip → fullscreen toggle. Same engine means the hash
parity check is *expected* to pass, not hoped.

**Performance.** ~120 MB download, ~250 MB RAM — the two costs, and both are irrelevant for a
desktop game on an Apple Silicon MacBook Pro (Steam builds routinely run 1–100 GB). Frame pacing,
WebGL path, Web Audio, Gamepad API: identical to the tested browser. Native arm64 Electron builds
exist; ProMotion is handled by the existing interpolating loop.

**Native experience.** Real app icon, Dock presence, menu bar, native fullscreen that does *not*
surrender Escape, Cmd+W/Cmd+Q interception with "abandon run?" confirm, windowed/fullscreen
persistence, files on disk. Chromium mediates the window, but for a game that owns its whole
canvas, the player cannot tell.

**Steam.** The most-proven path for web-tech games (Vampire Survivors shipped its early Steam
success on exactly this stack). `steamworks.js` gives achievements/cloud/rich presence from the
main process; achievements can be driven by the existing `world.events` stream through a thin
adapter. Overlay on macOS needs the known `in-process-gpu` switch and is the weakest point — but
Steam's macOS overlay is broadly weak, and overlay is cosmetic for this game. Windows/Linux later:
same shell, same engine, add builder targets.

**Risks.** Chromium/Electron version churn (mitigate: pin the version, upgrade on your schedule —
you ship the browser, so a Safari update can never break the shipped game, which is a *reduction*
in platform risk vs. Options 1/3/4); download-size sneers (irrelevant to Steam); signing/notarization
friction at release time (one-time setup, Developer ID cert).

**Score: 88.** Highest combined value on exactly the dimensions weighted highest: it preserves
the browser loop untouched, keeps one TypeScript codebase agents already navigate, reuses the
harness down to the hash check, and buys durable saves + app identity + the proven Steam route.
Its real costs are on dimensions this project explicitly does not care about.

### Option 3 — Tauri 2 (Rust host + OS WebView: WKWebView on macOS)

**What it is.** Same "thin shell over the existing web build" strategy, but the shell is a small
Rust binary and the engine is the OS's WebView. ~15 MB app, ~half the RAM of Electron.

**Fit to the repo.** Game-side, identical to Option 2 (same `src/platform/` seam; the storage
adapter calls Tauri's fs plugin over IPC). Shell-side, it adds a `src-tauri/` Rust crate, Cargo,
and rustc to the toolchain.

**Workflow.** Browser stays primary; `tauri dev` also gets Vite HMR. Day-to-day nearly as good as
Option 2 — until something breaks at the shell boundary, and then the error is in Rust, in a
second toolchain, in a WebView that is *not* the engine anything else in the repo tests.

**Runtime.** WKWebView (Safari's engine) on macOS, WebView2 (Chromium) on Windows, WebKitGTK on
Linux — **three engines across the eventual Steam matrix**, versioned by the *user's OS*, not by
you. Bardo's WebGL/Web Audio/Gamepad usage is standard and would very likely work in WKWebView on
a modern Mac — but "very likely" now needs its own QA lane, and historical WKWebView gamepad and
fullscreen quirks are exactly the papercut class this game is trying to shed.

**Saves.** Fine — fs plugin, same JSON, same directory. Equivalent to Electron here.

**Testing.** The disqualifying weakness. Playwright cannot drive WKWebView, and **`tauri-driver`
(Tauri's WebDriver bridge) does not support macOS** — the one platform this strategy targets
first. Tier-3 smoke testing becomes bespoke: AppleScript/screenshot heuristics or a hand-rolled
debug channel. The hash-parity check against the headless sim — the spine of the whole
verification culture — has no off-the-shelf transport into the packaged app. For a human-driven
project this is an annoyance; for an agent-driven project it removes the agents' eyes on the
target that ships.

**Performance.** Excellent; WKWebView WebGL rides ANGLE-on-Metal. Startup and RAM beat Electron.
None of that headroom is needed (see B).

**Native experience.** Slightly better than Electron (real native menus for free, smaller
footprint). Marginal for a fullscreen game.

**Steam.** Possible (`steamworks-rs`), thinner precedent, overlay effectively unavailable in
WKWebView, and the three-engine matrix arrives exactly when Steam adds Windows/Linux.

**Risks.** Rust enters an all-TypeScript repo agents currently navigate end-to-end; Safari-engine
divergence from every existing test artifact; macOS test-automation gap.

**Score: 72.** A genuinely good technology whose advantages (binary size, RAM) are worth ~nothing
to Bardo, and whose costs (second language, second browser engine, no macOS automation) hit the
three highest-weighted dimensions. If Bardo were a note-taking utility, Tauri would win. It is not.

### Option 4 — Hand-Rolled Native macOS Host (Swift/AppKit + WKWebView)

**What it is.** A small Xcode project: `NSWindow` + `WKWebView` loading the built game, Swift
`WKScriptMessageHandler` bridge for saves, hand-written menus/fullscreen/lifecycle. The
maximum-craft, maximum-ownership version of Option 3, with Mac App Store as a bonus path.

**Fit / changes.** Game side identical (platform seam). Shell side: a Swift codebase, Xcode
project files, code-signing config — all maintained by hand, no ecosystem doing the
window/update/packaging chores Tauri and electron-builder do.

**Workflow.** Browser primary as ever; shell iteration means Xcode builds. Agents can write
Swift, but the build/debug/sign loop lives outside the repo's tooling and outside Playwright's
reach.

**Testing.** Same WKWebView automation hole as Tauri, minus even `tauri-driver`'s
other-platform story. XCUITest could poke at the window; nothing reuses the harness.

**Native UX.** The best of all options — genuinely first-class macOS citizenship, and the only
route to the Mac App Store if that ever mattered. For a fullscreen pixel-art game, the delta over
Electron is menus and sentiment.

**Steam.** Worst path: every Steamworks call hand-bridged from Swift, and the shell contributes
nothing when Windows arrives — you would build Option 2 or 3 *then anyway*.

**Score: 58.** Beautiful, educational, and a strategic dead end: highest polish ceiling, lowest
leverage, and it dead-ends at the macOS border while consuming shell-maintenance effort the
2-file Electron main process never asks for.

### Option 5 — Runtime/Engine Migration (port to Godot/Unity, or native renderer + ported sim)

**What it is.** The "if the evidence strongly supports it" option: move the game off the web
runtime — either wholesale into a game engine, or keep the TS sim as spec and re-implement
sim + renderer natively.

**Fit to the repo.** It doesn't fit; it replaces. The pure-TS sim is the one portable piece
(deterministic, no DOM — it could be transliterated, and `tuning.ts` + the replay corpus would be
the acceptance spec, which is a genuinely unusual asset for a future port). Renderer, audio,
input, harness, gauntlet, `window.__game`, Playwright tooling: all rebuilt from zero.

**Workflow.** The browser-hot-reload/agent/harness loop — the stated reason the project is
web-first — is destroyed and must be reinvented inside an engine editor.

**What it buys.** The only option that reaches consoles, and effortless Steam. Both are
irrelevant to shipping a fun vertical slice this year, and B shows the performance motive is
absent at any plausible scale of this game.

**Score: 24.** Not a serious candidate today. Its one legitimate future use: *if* Bardo someday
signs a console deal, the deterministic sim + pinned replays become the port's executable spec.
That optionality exists precisely because the current architecture is disciplined — and requires
no action now to preserve.

---

## D. Weighted Comparison Matrix

Scores are 0–100 per dimension. The **Overall** row is *judgment-weighted to Bardo's stated
priorities* (High ≈ 3×: agility, agent-friendliness, shared code, testing, debuggability;
Medium-High ≈ 2×: performance; Medium ≈ 1×: the rest) — not an arithmetic mean, and sanity-checked
against the weighted average rather than derived from it.

| Dimension (weight) | 1 Pure Web/PWA | **2 Electron** | 3 Tauri 2 | 4 Swift/WKWebView | 5 Engine Migration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development agility (H) | 100 | **95** | 90 | 85 | 20 |
| AI-agent friendliness (H) | 100 | **95** | 70 | 55 | 35 |
| Shared code / unity (H) | 100 | **98** | 95 | 92 | 15 |
| Testing harness compat (H) | 100 | **95** | 60 | 50 | 15 |
| Debuggability (H) | 100 | **95** | 70 | 60 | 50 |
| Performance (MH) | 90 | **88** | 88 | 86 | 95 |
| Visual ceiling (M) | 90 | **90** | 88 | 88 | 95 |
| Native UX (M) | 25 | **80** | 85 | 92 | 95 |
| Persistence / saves (M) | 45 | **95** | 90 | 85 | 90 |
| Local distribution (M) | 65 | **85** | 90 | 75 | 85 |
| Steam readiness (M) | 5 | **90** | 60 | 35 | 95 |
| Build/release simplicity (M) | 100 | **70** | 60 | 45 | 40 |
| Long-term flexibility (M) | 40 | **85** | 75 | 50 | 90 |
| **Overall (weighted)** | **62** | **88** | **72** | **58** | **24** |

Reading the table honestly: Option 1 wins every development dimension and is therefore *kept* —
as the primary target inside Option 2, which costs those dimensions almost nothing (the shell is
additive, optional, and out of the inner loop). Options 3 and 4 trade the highest-weighted
dimensions for gains in the lowest-weighted ones. Option 5 trades everything for a future that
isn't being built yet.

## E. Winner

**Electron shell over the unchanged web game, added behind a `src/platform/` seam, with the
browser remaining the primary development target.** Concretely: Option 2 containing Option 1.

## F. Why It Wins

1. **Engine identity is the whole ballgame for this repo.** Bardo's quality culture runs on
   determinism: pinned replay hashes that must match headless Node and the browser, Playwright
   screenshots as evidence, `frameStats` gates. Electron is the only desktop runtime where the
   packaged app is the *same engine* those artifacts already certify. Tauri and Swift ship the
   game on an engine (WebKit) that nothing in the repo has ever tested, with no macOS automation
   bridge to start testing it.
2. **The harness extends instead of forking.** `_electron.launch()` hands back the same Playwright
   page object `tools/shot.ts` uses; the desktop smoke test is a ~50-line variation on an existing
   tool, and it can assert sim-hash parity between the packaged app and `pnpm sim` — the strongest
   possible "packaging did not introduce regressions" check, available on day one.
3. **Agents stay in one language and one mental model.** The entire surface — game, tools, tests,
   shell, save adapter — is TypeScript/JavaScript. No Cargo, no Xcode, no cross-language stack
   traces at 2 a.m.
4. **It fixes the only real constraints found in B** (save durability, key ownership/app identity,
   Steam path) **and pays only costs found irrelevant in B** (bundle size, RAM).
5. **The Steam path is the proven one for exactly this kind of game**, and the same shell carries
   to Windows/Linux with one engine to QA instead of three.
6. **It is reversible.** ~250 lines of shell + seam. If a better shell appears in two years, the
   seam is the migration; the game never knew.

## G. Target Architecture

```
                      ┌────────────────────────────────────────────┐
                      │              BARDO CORE (unchanged)         │
                      │  src/sim/      pure deterministic sim       │
                      │  src/render/   Pixi presenter (reads only)  │
                      │  src/audio/    Web Audio                    │
                      │  src/input/    kb/mouse/gamepad → InputFrame│
                      │  src/tuning.ts all numbers                  │
                      │  save schema:  MetaStateV1, SettingsStateV1 │
                      │                (versioned JSON, sim-owned)  │
                      └────────────────────┬───────────────────────┘
                                           │ consumes
                      ┌────────────────────▼───────────────────────┐
                      │        PLATFORM SEAM  src/platform/         │
                      │  interface Platform {                       │
                      │    storage: StorageLike     // exists today │
                      │    persistHint(): void      // best-effort  │
                      │    fullscreen(on?): void                    │
                      │    confirmQuitDuringRun: boolean            │
                      │    archiveReplay?(r: EncodedReplay): void   │
                      │  }                                          │
                      │  detect(): window.bardoDesktop ?? webPlatform│
                      └───────┬─────────────────────────┬──────────┘
                              │                         │
        ┌─────────────────────▼──────────┐   ┌──────────▼──────────────────────┐
        │  WEB HOST (primary, unchanged) │   │  DESKTOP HOST  desktop/          │
        │  Vite dev @5173 · HMR          │   │  main.ts   BrowserWindow, menu,  │
        │  localStorage adapter          │   │            fullscreen, quit-guard │
        │  window.__game · URL params    │   │  preload.ts contextBridge:       │
        │  pnpm shot/poses/sim · gauntlet│   │    fs StorageLike (atomic+.bak)  │
        │  Playwright chromium harness   │   │    replay archive dir            │
        └────────────────────────────────┘   │  electron-builder: dmg/zip,      │
                                             │    sign + notarize (arm64)       │
                                             │  dev: loads localhost:5173       │
                                             │  prod: loads dist/               │
                                             └──────────┬──────────────────────┘
                                                        │ same save dir, later
                                             ┌──────────▼──────────────────────┐
                                             │  FUTURE STEAM ADAPTER (docs only)│
                                             │  steamworks.js in main process   │
                                             │  achievements ← world.events     │
                                             │  Steam Cloud ← auto-cloud on the │
                                             │  existing save directory         │
                                             └─────────────────────────────────┘
```

Boundary rules that keep this from becoming enterprise abstraction soup:

- **The sim never learns any of this exists.** It already takes `StorageLike?`; that stays its
  entire knowledge of the outside world. No new interface is added until a *second* real consumer
  exists (achievements get an adapter when Steam integration starts, not before — and it will be
  a ~30-line consumer of `world.events`, which is already the sim's outbound contract).
- **`src/platform/` is the only file group allowed to feature-detect.** `main.ts` asks it for the
  platform once at boot. No `if (isElectron)` anywhere else, ever.
- **`desktop/` may not import from `src/`** except types. It is a window around the game, not part
  of it.

## H. Save Strategy

The canonical representation already exists and is correct: **versioned, defensively-parsed JSON
documents owned by the sim** (`MetaStateV1` pattern: explicit `version` field, per-field
validation, silent fallback to defaults on corruption). Keep exactly this shape and grow it
(pets, artifacts, currencies, story flags, realm progression, statistics, profiles as
`profiles/<n>.json`). Migrations are `switch (version)` upgrade functions in `src/sim/storage.ts`,
tested in Vitest with fixture files — tier-1 tests, no browser needed.

| Environment | Adapter | Notes |
| --- | --- | --- |
| Browser (now) | `localStorage` (today's code) + call `navigator.storage.persist()` at boot + a save **export/import** button (downloads/reads the same JSON) | Saves are KB-scale; localStorage is honestly fine at this size. Export/import is the eviction insurance and doubles as the cross-device story. Move to OPFS/IndexedDB only if saves outgrow strings or replay archiving comes to the web build — not speculatively. |
| Desktop | Preload fs adapter: load save dir into memory at boot; write-through with write-temp → fsync → atomic rename, keep one rolling `.bak`; on parse failure fall back to `.bak`, then defaults. Location: `~/Library/Application Support/Bardo Rogue/` | Same JSON bytes a browser export produces — a browser save imports into desktop and vice versa, for free. |
| Steam (later) | The same files, same directory. Steamworks **auto-cloud** config on that path — zero code — or `steamworks.js` cloud API if per-file control is ever needed. | Multiple profiles = multiple files; auto-cloud handles them. |

One deliberate simplification: `StorageLike` stays **synchronous** (it matches localStorage and
keeps the sim boundary trivial). The desktop adapter is sync-over-memory with async flush behind
it; at kilobyte scale this is unmeasurable and it avoids infecting the boot path with promises.

## I. Testing Strategy

The three tiers the addendum sketches map directly onto what exists, with tier 3 as the only new
build:

- **Tier 1 — headless sim (exists):** Vitest over `tests/**` — 184 tests, ~4 s. Combat,
  encounters, replays-with-pinned-hashes, collision, feel gates. Save-migration tests join here.
  Runs on every change.
- **Tier 2 — browser gameplay harness (exists):** `pnpm sim` for metrics across seed ranges,
  `pnpm shot`/`pnpm poses` for visual evidence, bots for gameplay validation, `window.__game` for
  state injection, the gauntlet for quality judgment. Runs many times per day; **remains the
  arbiter of gameplay truth**.
- **Tier 3 — desktop smoke (new, ~50 lines):** `pnpm smoke:desktop` via Playwright
  `_electron.launch()` against the packaged (or at least production-built) app: boots, `__game`
  present, 300 stepwise ticks, **`__game.hash()` equals `pnpm sim`'s hash for the same
  seed/scenario**, screenshot renders non-black, save write → relaunch → read roundtrip, corrupt
  save falls back to `.bak`, fullscreen toggles. Runs before a release or when `desktop/` or
  `src/platform/` change — *never* in the inner gameplay loop.

The invariant that makes the whole pyramid cheap: because the sim is deterministic and
platform-blind, tiers 2 and 3 are not re-testing gameplay — they are testing *hosting*. Gameplay
correctness lives in tier 1 and the tier-2 bots, once, for every platform at the same time.

## J. Implementation Plan

Ordered so the game is never disrupted and each phase is independently shippable. Phases 1–2 are
worth doing soon; 3–7 can wait until a native build is actually wanted (they total roughly a
focused week); 8 is documentation.

- **Phase 1 — Harden the web golden path (hours).** Add `navigator.storage.persist()` at boot and
  a save export/import affordance (pause or meta screen). This is pure-web insurance that also
  fixes today's one real durability risk and defines the on-disk save format desktop will use.
  No sim change; hashes untouched.
- **Phase 2 — Cut the platform seam (half a day).** Create `src/platform/` with the `Platform`
  interface and the web implementation; move the `localStorage` injection, reduced-motion
  detection, and fullscreen call from `main.ts` behind it. `main.ts` shrinks; nothing else moves.
  Tests stay green because the sim never sees the difference.
- **Phase 3 — Minimal desktop host (a day).** `desktop/main.ts` + `desktop/preload.ts` +
  electron-builder config as a workspace package. Dev mode loads `:5173` (HMR inside the shell for
  free); prod loads `dist/` with `public/progress` excluded. Acceptance: the game plays, `__game`
  works, F fullscreen works.
- **Phase 4 — Filesystem saves (a day).** The preload `StorageLike` adapter (atomic write, `.bak`,
  corruption fallback) exposed as `window.bardoDesktop.storage`; platform seam prefers it.
  Vitest-able by extracting the adapter's pure parts; roundtrip covered in tier 3.
- **Phase 5 — Desktop quality (1–2 days).** App menu + About, quit/Cmd+W confirm during a live
  run (the seam's `confirmQuitDuringRun`), icon, window-state persistence, replay auto-archive of
  the last N runs into the save dir (deterministic bug reports: seed + inputs = exact repro —
  the one genuinely new capability desktop unlocks beyond durability).
- **Phase 6 — Tier-3 smoke (half a day).** `tools/desktop-smoke.ts` as specified in I; document in
  `HARNESS.md`.
- **Phase 7 — Distribution (a day, mostly Apple paperwork).** Developer ID cert, electron-builder
  sign + notarize, `pnpm desktop:dist` → dmg/zip an outside tester can double-click. Updates: ship
  new dmgs manually until that hurts; electron-updater only when it does.
- **Phase 8 — Steam readiness (docs only).** Write `docs/steam.md` capturing section K. Build
  nothing.

## K. Steam Path

Rating for the eventual move from local Mac app to Steam release: **straightforward** — days to a
couple of weeks of integration and store bureaucracy, and *zero architectural change*, provided
the Phase 2 seam exists. The concrete delta:

1. Steamworks account, app ID, store metadata (bureaucracy, not engineering).
2. Add `steamworks.js` to `desktop/` main process; init with the app ID; `steam_appid.txt` in dev.
3. Achievements: a ~30-line main-process consumer of forwarded `world.events` (the sim already
   emits everything interesting: kills, clears, boons, deaths). No sim change.
4. Cloud saves: enable auto-cloud on the existing save directory in the Steamworks dashboard.
   No code.
5. Overlay: add the known `in-process-gpu` command-line switch and test; treat macOS overlay as
   best-effort (it is weak platform-wide). Overlay matters more on the eventual Windows build,
   where the same switch is the established fix.
6. Controller: the Gamepad API path already works; verify Steam Input's virtual-gamepad mapping,
   add a Steam Input config. Glyphs for PS/Xbox prompts are a content task, not architecture.
7. Depots/branches: electron-builder output per OS uploaded via `steamcmd`; a `beta` branch for
   testers. When Windows/Linux happen, it is the same shell and same engine — add builder targets
   and QA pass, not a new stack.

What would make it *harder* later if skipped now: only the platform seam. Everything else in this
plan can be deferred with no compounding cost.

## L. Do Not Do This

- **Do not migrate engines** (Godot/Unity/native) for performance a 15.6 µs tick and a
  SwiftShader-renderable frame demonstrably do not need. Revisit only if a console deal exists —
  and then the sim + replay corpus is the port spec, which requires no preparation today.
- **Do not fork the game.** No desktop-only gameplay code, no web-only gameplay code, ever. If a
  feature needs the shell, it goes through `src/platform/` as a capability, and the web build gets
  a graceful equivalent or a no-op.
- **Do not let `desktop/` imports leak into `src/`**, and allow feature detection only inside
  `src/platform/`. The grep for `electron`/`bardoDesktop` outside those folders should stay empty.
- **Do not put packaging in the inner loop.** If any gameplay change ever requires launching or
  building the Electron app to validate, the architecture has failed; fix that instead of
  complying.
- **Do not pick the WebView-shell aesthetic (Tauri/Swift) for its bundle size.** The 100 MB it
  saves buys a second browser engine, a second language, and no macOS test automation — trading
  the project's highest-weighted assets for its lowest-weighted one.
- **Do not build speculative platform abstractions.** No achievements interface, telemetry
  interface, or cloud-save interface until the first real second implementation is being written.
  `StorageLike` earned its existence; the rest earn theirs the same way.
- **Do not abandon the browser harness for native-only testing**, and do not let tier 3 grow into
  a gameplay suite — it tests hosting; gameplay truth stays in tiers 1–2.
- **Do not adopt IndexedDB/OPFS now** for KB-scale saves, and do not hand-write "clever"
  save-sync; export/import + fs + Steam auto-cloud cover every stated need.
- **Do not chase Steam before the slice is fun.** The gauntlet is the roadmap; Steam is Phase 8
  documentation until then.
- **Do not split rendering backends per host** (e.g., WebGPU on desktop, WebGL on web). One
  `preference: 'webgl'` everywhere until a concrete rendering need says otherwise; the evidence
  protocol depends on frames being comparable.

## M. Next Five Concrete Tasks

1. **Save export/import + `navigator.storage.persist()`** in the web build. Defines the canonical
   save-file bytes, kills the localStorage-eviction risk, requires no sim change. (Phase 1)
2. **Create `src/platform/`** — `Platform` interface + web implementation; move storage injection,
   fullscreen, and reduced-motion detection out of `main.ts` behind it. All 184 tests and every
   pinned hash must pass unchanged. (Phase 2)
3. **Add `desktop/`** — Electron main + preload + electron-builder config as a workspace package,
   with `pnpm desktop:dev` (loads `:5173`) and `pnpm desktop:build`. Acceptance: the game runs in
   the shell with `window.__game` alive. (Phase 3)
4. **Filesystem `StorageLike` adapter** in the preload (atomic write + `.bak` + corruption
   fallback) wired through the seam; meta progression survives relaunch of the packaged app.
   (Phase 4)
5. **`tools/desktop-smoke.ts` + `pnpm smoke:desktop`** — Playwright `_electron`: boot, hash-parity
   vs. `pnpm sim`, screenshot, save roundtrip, fullscreen; documented in `HARNESS.md`. (Phase 6,
   pulled early because it locks in the guarantee that packaging can never silently diverge from
   the browser game.)

---

**Governing principle, restated as the conclusion it survived:** the browser remains the
laboratory; Electron is a picture frame around the same painting. One sim, one renderer, one
tuning file, one save schema, one harness — and a platform seam thin enough to read in one
sitting. The repository was already built for this answer; the strategy above mostly consists of
not ruining it.
