# Bardo Rogue — Platform Strategy (v2, synthesized)

This is the merged best-of-breed plan from two independent evaluations of this repository:

- **Evaluation A** (this branch's first commit): ran against HEAD `4d44311` — 184 tests, measured
  15.6 µs/tick headless, 844 KB shipped JS, found the existing `StorageLike` seam and
  `session.ts` run/meta boundary.
- **Evaluation B** (external): ran against the older `1ef5b18` — 110 tests, 4–59 µs/tick,
  and contributed the deepest save-model, security, and Steam-operations thinking.

Both, with different scoring weights, produced the **identical ranking**: Electron > Tauri 2 >
installed PWA > custom Swift/WKWebView host > engine migration. That agreement across two
independent weightings is the strongest signal in either document: the decision is robust to how
you weight the criteria. This document keeps A's evidence (it reflects the tree that exists) and
folds in B's superior save architecture, security posture, build-defect finding, and Steam
operational detail. Facts the two evaluations disputed were re-verified against HEAD and, where
needed, primary sources; the adjudications are inlined where they matter.

**The verdict:** the browser remains the primary development target; Electron becomes the
packaged player product and release-validation target, behind a small platform seam. Apple
Silicon macOS only at first. Tauri is the named, measured fallback if Chromium overhead ever
becomes material — not the default.

---

## A. Current Platform Architecture (HEAD `4d44311`)

- **Runtime:** PixiJS v8.20 on WebGL (`preference: 'webgl'`, antialias off, Pixi ticker
  disabled — the game owns its frame). 480×270 `RenderTexture`, integer-scaled blit. One
  production dependency: `pixi.js`. TypeScript 5.9 strict, Vite 8, pnpm.
- **Simulation:** `src/sim/` (~3,700 LOC) — no DOM, no Pixi, no `Math.random`, no `Date`.
  Fixed 60 Hz step with interpolation and a 5-step catch-up cap. Deterministic given
  `(seed, scenario, InputFrame[])`; FNV hashes pinned in `tests/sim/replay.test.ts` must match
  Node and browser. Entity pools capped at `MAX_ENEMIES = 32`, `MAX_PROJECTILES = 64`
  (`src/sim/world.ts:77`).
- **Run/meta boundary (exists — B evaluated a tree that predated it):** `src/sim/session.ts`
  defines `GameSessionState { meta, preparedWeapon, run: RunState | null }`; `RunState` carries
  seed, weapon, boon stacks, hp/maxHp, depth, roomId, room history, pending reward, result.
  `MetaStateV1` is a versioned schema.
- **Persistence (exists in embryo):** `src/sim/storage.ts` — `StorageLike` interface, versioned
  defensively-parsed `MetaStateV1`/`SettingsStateV1`, corruption falls back to defaults;
  `main.ts` injects `localStorage` and autosaves meta on `runStarted`/`runWon`/`returned`
  events. The sim never touches a browser storage API. What does *not* exist: a run
  checkpoint (save-and-quit mid-run), profiles, a content-revision field, backups, or any
  non-browser adapter.
- **Input:** keyboard, mouse, and Gamepad API already converge into one quantized `InputFrame`
  per tick with edge detection and focus-loss clearing. Missing (backlog, not architecture):
  rebinding, per-device glyphs, rumble, controller-first menus, Steam Input action sets.
- **Harness:** `window.__game` (step/reset/setInput/bot/state/hash/frameStats/record/replay),
  URL params, five bots, RLE replays, `pnpm sim` (headless Node), `pnpm shot`/`pnpm poses`
  (Playwright Chromium + SwiftShader), gauntlet evidence loop. 184 Vitest tests in ~4 s.
- **Payload:** production JS 844 KB across 14 chunks (almost all Pixi); runtime assets 1.7 MB
  (1.3 MB audio). The whole shippable game is ~2.5 MB.
- **What does not exist:** a desktop runtime, packaging, signing/notarization, updates,
  Steamworks, a packaged-build smoke suite, WebKit runtime proof, a release asset boundary.

## B. Current Constraints — Real vs. Hypothetical

Adjudicated and re-verified at HEAD. Four real constraints; none is performance-of-the-runtime,
and **none is fixed by going native**.

1. **Save durability.** Meta progression lives in `localStorage`, which browsers may evict
   (Safari ITP's 7-day cap for infrequently visited origins; user-cleared site data; private
   windows). For a game whose promise is "what you earned stays," this is the top platform
   weakness. Fix: persistence hint + export/import now; filesystem saves on desktop.
2. **Key ownership and app identity.** Browser fullscreen surrenders Escape (the pause key);
   Cmd+W can kill a run; there is no double-clickable artifact and no Steam path. Only a shell
   fixes these.
3. **Release-build asset boundary (defect, verified).** `public/progress/` — the gauntlet
   evidence journal, including an 83 MB `reference-official.mp4` — is copied wholesale into
   `dist/` (125 MB of a 131 MB build). Any packaged build made from `dist/` today would ship
   internal audit evidence. Must be fixed before any desktop host exists.
4. **Watchlist, not yet a constraint: projectile presentation.** Verified at HEAD: the presenter
   resolves several projectile views via linear `w.projectiles.find(...)` scans per frame
   (`src/render/presenter.ts:695–721`), and an earlier controlled audit measured ~408 GL draw
   calls at 200 synthetic projectiles (`AUDIT_REPORT.md`) against a production cap of 64. Ample
   headroom today; the first *real* performance work as bullet density grows toward the
   Gungeon bar will be **batching and lookup structure in the presenter** — TypeScript work on
   shared code, which no packaging choice affects and no native rewrite is needed for.

Measured headroom everywhere else: sim at **15.6 µs/tick avg** (~0.1% of the 16.67 ms budget;
consistent with B's 4–59 µs range on the older tree); SwiftShader software GL renders the game
(that *is* the screenshot harness); assets 1.7 MB, loaded without blocking boot. GPU-bound has
not been established and nothing suggests it; JS-main-thread, memory, physics, network: not
constraints. Scaling to full VISION.md ambition multiplies sim cost perhaps 50–100× — still
~1–2 ms/tick.

## C. The Five Credible Options (reconciled scores)

Same five strategies in both evaluations; variations were collapsed (NW.js→Electron;
Neutralino/Wails→Tauri). Both evaluations ranked them in this order; scores below are the
reconciled synthesis (A scored 88/72/62/58/24; B scored 93/91/89/83/63 — B's compression
understated gaps its own prose asserted, A's Tauri testing penalty was partly stale; details
inline).

### 1. Electron desktop host — 90/100 (winner)

The existing Vite output inside a sandboxed `BrowserWindow`; a narrow preload bridge for
filesystem persistence and lifecycle; electron-builder (or Forge — keep it minimal either way)
produces a signed, notarized arm64 dmg/zip. Game code byte-identical to the web build.

- **Why it wins here specifically:** it ships the *same engine the entire harness already
  certifies* (Chromium — `tools/shot.ts`, pinned replay hashes, `frameStats` gates), and
  Playwright drives Electron with the same page object, so the desktop smoke tier is a ~50-line
  variant of an existing tool asserting `__game.hash()` parity against `pnpm sim`. (Playwright's
  Electron support is formally labeled experimental; the surface Bardo needs — launch, page
  eval — is its stable core.) All shell code is TypeScript; agents never leave the language.
  Dev mode loads `:5173`, so the shell itself gets HMR.
- **Packaging correction (from B, verified):** `main.ts` fetches `/assets/manifest.json` and
  the app assumes a real origin (also for storage semantics). A packaged build must serve
  `dist/` through a custom application protocol (e.g. `app://bardo/` via `protocol.handle`) —
  not `file://`. This is the one non-obvious integration task.
- **Security posture (from B):** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`; preload exposes a *named, minimal* API (`window.bardoDesktop`),
  never generic fs/shell; the smoke tier audits the exposed surface.
- **Costs:** ~120 MB download, ~250 MB RAM — irrelevant on an Apple Silicon MacBook Pro and on
  Steam; Chromium update cadence (you pin and upgrade on your schedule — which *removes* the
  risk of a user's browser update breaking the shipped game); notarization paperwork.
- **Steam:** the proven path for web-tech games (`steamworks.js`; Vampire Survivors precedent).
  Overlay needs the known `in-process-gpu` switch and macOS overlay is weak platform-wide —
  treat as runtime-proof, not assumption. Same shell later ships Windows/Linux with **one**
  engine to QA.

### 2. Tauri 2 host — 76/100 (named fallback)

Same thin-shell strategy; Rust host, WKWebView on macOS, ~15 MB app, lower RAM.

- **Testing, adjudicated against current Tauri docs:** `tauri-driver` does **not** support
  macOS ("macOS has no WKWebView driver tool available" — Tauri's own docs). The documented
  macOS path is WebdriverIO with an embedded WebDriver server inside the app (or a paid
  CrabNebula fork). So macOS automation *exists* but means adopting a second E2E toolchain and
  embedding a driver, with none of `tools/shot.ts` reused — materially worse than "same
  Playwright object," materially better than "impossible."
- The structural costs stand: the packaged player runs an engine (WebKit) nothing in the repo
  has ever tested; Rust/Cargo enters an all-TypeScript repo; debugging crosses JS/IPC/Rust;
  cross-platform later means three engines (WKWebView/WebView2/WebKitGTK) versioned by the
  user's OS. Its advantages (size, RAM) are worth ~nothing to this game.
- **Kept as the measured fallback:** if packaged Chromium overhead ever becomes material on the
  target machine (measure at Phase 7), the platform seam is the migration path and the game
  never knows.

### 3. Installed web app / PWA — 65/100 as the end-state; kept forever as the surface

Manifest + service worker + installable Dock app; `navigator.storage.persist()`; export/import.
Perfect on every development dimension — which is why it survives *inside* the recommendation
as the permanent primary target — but as the final architecture it cannot deliver durable
file-backed saves, key ownership, crash reporting, controlled runtime versions, or any Steam
path. (B scored it 89 while concluding "do not treat it as the final desktop architecture";
the score here matches that conclusion rather than contradicting it.)

### 4. Custom Swift/AppKit WKWebView host — 60/100

Maximum native polish and the only Mac App Store route; but a hand-maintained second codebase
in a second language, the same WKWebView divergence and automation gap as Tauri with less
ecosystem leverage, a fully bespoke Steamworks bridge, and a shell that contributes nothing
when Windows arrives. Justified only by unusual macOS-specific needs that do not exist.

### 5. Engine migration (Godot/Unity/native) — 30/100

Rewrites presentation, harness, and tooling to solve a performance problem that measurably does
not exist (see B: the credible bottleneck is presenter batching — shared TypeScript). Rejected.
Its one legitimate future use: if a console deal ever exists, the deterministic sim + pinned
replay corpus is the port's executable specification — an option preserved by doing nothing.

## D. Comparison Matrix (synthesized)

0–100 per dimension. Overall is judgment-weighted to Bardo's priorities (High ≈ 3×: agility,
agent-friendliness, shared code, testing, debuggability; Medium-High ≈ 2×: performance;
Medium ≈ 1×: the rest), sanity-checked against B's explicit numeric weighting — both weightings
produce the same ranking.

| Dimension (weight) | **Electron** | Tauri 2 | PWA | Swift host | Migration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development agility (H) | **94** | 90 | 100 | 85 | 30 |
| AI-agent friendliness (H) | **95** | 75 | 100 | 58 | 40 |
| Shared code / unity (H) | **98** | 96 | 100 | 94 | 18 |
| Testing harness compat (H) | **95** | 72 | 100 | 55 | 25 |
| Debuggability (H) | **96** | 76 | 99 | 65 | 60 |
| Performance (MH) | **87** | 88 | 89 | 87 | 96 |
| Visual ceiling (M) | **92** | 90 | 90 | 90 | 96 |
| Native UX (M) | **84** | 88 | 35 | 95 | 96 |
| Persistence / saves (M) | **95** | 92 | 55 | 92 | 92 |
| Local distribution (M) | **87** | 90 | 68 | 77 | 86 |
| Steam readiness (M) | **89** | 68 | 10 | 50 | 96 |
| Build/release simplicity (M) | **74** | 65 | 99 | 50 | 40 |
| Long-term flexibility (M) | **87** | 82 | 55 | 55 | 90 |
| **Overall** | **90** | **76** | **65** | **60** | **30** |

## E. Winner

**Electron as an optional desktop host around the unchanged web game**, behind `src/platform/`,
Apple Silicon macOS only at first, sandboxed with a minimal preload API and a custom `app://`
origin for packaged assets. No React, no desktop-specific frontend, no second copy of anything.
The browser remains the development product; Electron is the packaged player product and a
release-validation target. Tauri stays on file as the measured fallback.

## F. Why It Wins

1. **Engine identity with the certification chain.** Pinned replay hashes, Playwright evidence,
   and `frameStats` gates all run on Chromium today; Electron is the only shell where the
   packaged app is that same engine.
2. **The harness extends instead of forking** — `_electron.launch()` returns the same Playwright
   page `tools/shot.ts` drives; hash parity between the packaged app and `pnpm sim` is checkable
   from day one.
3. **One language.** Game, tools, tests, shell, save adapter: all TypeScript. No Cargo, no
   Xcode, no cross-language stack traces.
4. **It fixes exactly the real constraints in B** (durable saves, key ownership/app identity,
   Steam path) **and pays only costs B shows are irrelevant** (size, RAM).
5. **Proven Steam path** with the smallest later delta, and one engine across the eventual
   Windows/Linux matrix instead of three.
6. **Reversible.** ~250 lines of seam + shell; the seam is also the Tauri migration if
   measurement ever demands it.

What desktop genuinely unlocks: durable application-data saves with backups; local replay
archive → deterministic bug reports (seed + inputs = exact repro); crash/error logs outside
browser storage; app identity and clean fullscreen with owned keys; reproducible pinned runtime;
controlled offline builds; later Steamworks; optional mod/user-content directories. What it does
not unlock: combat latency, GPU capacity, frame pacing, audio quality — those were never
constrained.

## G. Target Architecture

```
                  ┌─────────────────────────────────────────────────┐
                  │              BARDO CORE (shared, unchanged)      │
                  │  src/sim/     deterministic sim, RunState/meta   │
                  │  src/render/  Pixi presenter (reads only)        │
                  │  src/audio/   Web Audio   src/input/ InputFrame  │
                  │  src/tuning.ts            debug API, replays     │
                  │  save schema: versioned envelope (see H),        │
                  │  validation + pure migrations in storage.ts      │
                  └───────────────────────┬─────────────────────────┘
                                          │
                  ┌───────────────────────▼─────────────────────────┐
                  │           PLATFORM SEAM  src/platform/           │
                  │  interface Platform {                            │
                  │    saves: SaveStore          // async, see H     │
                  │    persistHint(): void                           │
                  │    fullscreen(on?): void                         │
                  │    confirmQuitDuringRun: boolean                 │
                  │    archiveReplay?(r: EncodedReplay): void        │
                  │  }                                               │
                  │  detect(): window.bardoDesktop ?? webPlatform    │
                  └──────────┬───────────────────────┬──────────────┘
                             │                       │
        ┌────────────────────▼─────────┐  ┌──────────▼───────────────────────┐
        │ WEB HOST (primary, forever)  │  │ DESKTOP HOST  desktop/            │
        │ Vite dev @5173 · HMR         │  │ main: sandboxed BrowserWindow,    │
        │ localStorage SaveStore now;  │  │   app://bardo protocol for dist/, │
        │ IndexedDB when checkpoints/  │  │   menus, fullscreen, quit-guard   │
        │ replay archive land          │  │ preload: contextBridge → named    │
        │ __game · shot/poses/sim ·    │  │   minimal bardoDesktop API only   │
        │ gauntlet · Playwright        │  │ fs SaveStore (atomic + .bak)      │
        └──────────────────────────────┘  │ dev loads :5173 · smoke via       │
                                          │ Playwright _electron              │
                                          └──────────┬───────────────────────┘
                                                     │ same save dir, later
                                          ┌──────────▼───────────────────────┐
                                          │ FUTURE STEAM ADAPTER (docs only)  │
                                          │ steamworks.js in main process ·   │
                                          │ achievements ← world.events ·     │
                                          │ Auto-Cloud on the save directory  │
                                          └───────────────────────────────────┘
```

Boundary rules (union of both evaluations):

- `src/sim/` never imports Electron, Node, Tauri, Steam, IndexedDB, or filesystem APIs — its
  entire knowledge of the outside world stays "someone hands me parsed state."
- Feature detection lives only in `src/platform/`; `grep -r electron\|bardoDesktop src/ --exclude-dir=platform`
  stays empty. `desktop/` may not import from `src/` except types.
- Renderer stays shared; no per-host rendering forks (and one `preference: 'webgl'` everywhere)
  unless a measured platform difference forces it.
- Sandboxed renderer, context isolation on, Node integration off, allowlisted IPC only.
- No speculative abstractions: no achievements interface until the first achievement, no
  controller abstraction unless a native capability proves materially better than the Gamepad
  API, no Steam SDK in the build until there is a Steam app to test against.

## H. Save Strategy

**Canonical model (B's design, adopted, phased onto what exists).** Never serialize `World`.
The envelope grows from today's `MetaStateV1`:

```ts
interface BardoSave {
  schemaVersion: number        // migrations are pure functions with per-version fixtures
  contentRevision: string      // ties a save to the content that produced it
  profileId: string
  revision: number             // monotonic, for backup/cloud conflict visibility
  settings: SettingsState
  meta: MetaProgression        // currencies, weapons/aspects, pets, artifacts,
                               // town unlocks, story flags, statistics, heat
  checkpoint: RunCheckpoint | null   // later: save-and-quit mid-run
}
```

`RunCheckpoint` (deferred until the run structure stabilizes post-slice, but the envelope
reserves the slot now) holds only resumable *sim* truth: seed + RNG stream state, weapon, boon
stacks, realm/room and committed path, run currency/inventory, hp/status, room history,
content version. It must never contain Pixi objects, sprite/animation/audio/particle state,
DOM references, platform paths, debug state, or wall-clock time. Note `src/sim/session.ts`
already models most of this in memory (`RunState`) — the checkpoint work is serialization +
restore-equivalence tests (same hash continuing from a restored checkpoint), not a new
extraction.

**Platform interface (async, minimal):**

```ts
interface SaveStore {
  read(profileId: string): Promise<string | null>
  write(profileId: string, data: string): Promise<void>   // JSON; compression only if ever needed
  delete(profileId: string): Promise<void>
}
```

Validation, serialization, migrations, and corruption recovery live *above* the adapter in
shared TypeScript (`storage.ts` remains the pure schema layer). Boot is already async; the sim
stays synchronous and I/O-free.

| Environment | Adapter | Discipline |
| --- | --- | --- |
| Browser (now) | `localStorage` wrapped as `SaveStore` (KB-scale JSON is fine there today; churn to IndexedDB is deferred, not skipped) + `navigator.storage.persist()` at boot + **export/import** of the exact save file (eviction insurance; defines the on-disk bytes desktop will use; doubles as cross-device transfer) | Keep a `.bak` copy under a second key. |
| Browser (later) | IndexedDB `SaveStore` when `RunCheckpoint` and/or local replay archiving arrive — one transaction holding current save, previous-known-good, and revision metadata (B's design) | Same envelope, same migrations. |
| Desktop | Preload/main fs adapter under `~/Library/Application Support/Bardo Rogue/saves/` — serialize → validate → write temp → flush → rotate prior to `.bak` → atomic rename; in debug/test builds re-read and validate after write | On corruption: **preserve the corrupt file**, fall back to `.bak`, report the recovery visibly, never silently replace both copies. |
| Steam (later) | Same files, same directory; Steamworks **Auto-Cloud** pointed at it — zero code. Move to explicit Remote Storage only if conflict control demands it | `revision` + `contentRevision` make conflicts diagnosable. |

Autosave at durable boundaries — reward commitment, room transition, return to the Bardo,
unlock purchase — never per tick. (`main.ts` already saves meta on exactly these events.)

## I. Testing Strategy

- **Tier 1 — pure sim + saves (exists, extend):** Vitest — combat, encounters, replay hashes,
  collision, feel gates; add save validation, **pure migration functions with fixtures from
  every prior schema version**, checkpoint serialize/restore/hash-equivalence, corruption →
  backup recovery, reward exactly-once. ~seconds; runs on every change.
- **Tier 2 — browser gameplay harness (exists, unchanged, the golden laboratory):** `pnpm sim`
  metrics across seeds, `pnpm shot`/`poses` evidence, bots, `__game` state injection, gauntlet
  judgment. The arbiter of gameplay truth for every platform at once — because the sim is
  platform-blind, tiers 2 and 3 test *hosting*, not gameplay, and gameplay is certified once.
- **Tier 3 — desktop smoke (new, ~50 lines, `pnpm smoke:desktop`):** Playwright
  `_electron.launch()` with an isolated temporary user-data dir: app launches; window loads via
  `app://`; WebGL initializes; `__game` exists; a pinned replay's final `hash()` **equals the
  Node and browser hash**; preload exposes only the intended API surface; save write → relaunch
  → load; corrupt save preserved + `.bak` recovery; fullscreen enters/exits; renderer and
  main-process errors captured; packaged assets resolve offline; **no `public/progress`/audit
  evidence in the bundle**. Runs when `desktop/`/`src/platform/` change or before a release —
  never in the inner gameplay loop.
- **Release/hardware lane (manual, before tester/Steam builds):** physical controller
  (connect/disconnect/reconnect), audio listening pass, sleep/wake and focus changes,
  fullscreen/Spaces, cold launch, long-session memory, the signed+notarized artifact on a
  second Mac account; Steam overlay and Steam Input once introduced.
- Optional: a WebKit Playwright lane *only if* Safari remains a stated web target; it never
  enters the everyday loop.

## J. Implementation Plan

- **Phase 0 — Release asset boundary (do first; hours).** Make production builds exclude
  `public/progress` and audit evidence (move it out of `public/`, or a build-time exclude), and
  add a size/inventory assertion so a 2.5 MB game can never silently ship 125 MB of internal
  evidence again. Decide release source-map policy explicitly.
- **Phase 1 — Web golden-path hardening (hours).** `navigator.storage.persist()` at boot;
  save export/import in the pause/meta UI. Fixes the eviction risk and freezes the canonical
  save-file bytes. No sim change; hashes untouched.
- **Phase 2 — Save envelope + platform seam (1–2 days).** Grow `storage.ts` schemas into the
  `BardoSave` envelope (schemaVersion/contentRevision/profileId/revision; checkpoint slot
  reserved, not implemented); pure migrations + fixtures in tier 1. Create `src/platform/`
  (`Platform` + async `SaveStore`), move storage injection, fullscreen, and reduced-motion
  detection out of `main.ts`. All 184 tests and every pinned hash pass unchanged.
- **Phase 3 — Minimal desktop host (a day).** `desktop/` main + preload as a workspace package:
  sandboxed window, context isolation, no Node integration; dev loads `:5173` (HMR in the
  shell for free); packaged mode serves `dist/` via `app://bardo` (`protocol.handle`).
  Acceptance: game plays, `__game` alive, F fullscreen works. Unsigned local arm64 `.app`.
- **Phase 4 — Desktop filesystem saves (a day).** fs `SaveStore` with the atomic-write/backup/
  preserve-corrupt discipline from H; wired through the seam; save paths inspectable in debug.
  Prove browser and desktop deserialize the same fixture bytes.
- **Phase 5 — Desktop quality (1–2 days, only what demonstrates value).** App menu + About;
  quit/Cmd+W confirm during a live run; icon; window-state persistence; crash/log collection;
  open-save-folder + export-diagnostics; replay auto-archive of the last N runs (deterministic
  bug repro). Controller reconnect behavior. No tray, no launch-on-login, no updater yet.
- **Phase 6 — Tier-3 smoke (half a day).** `tools/desktop-smoke.ts` per section I; document in
  `HARNESS.md`.
- **Phase 7 — Distribution + measurement (a day + Apple paperwork).** Developer ID cert, sign +
  notarize, `pnpm desktop:dist` → dmg/zip a tester can double-click. On the target MacBook Pro,
  measure cold launch, memory, real rAF intervals, and a **200-projectile stress scenario** —
  this is also the tripwire for the presenter-batching watchlist (B.4) and for the Tauri
  fallback question. Ship new dmgs manually until that hurts.
- **Phase 8 — Steam readiness, not Steam (docs only).** Write `docs/steam.md` from section K.
  Keep achievement-worthy events typed; keep the SDK out of the build.

The checkpoint/save-and-quit feature (`RunCheckpoint`) is scheduled by game design — when runs
get long enough to need suspending — not by this platform work; the envelope from Phase 2 is
ready for it whenever that day comes.

## K. Steam Path

Overall rating: **shipping is straightforward; full Steamworks features are moderate; no
gameplay architecture change at any point** (given the Phase 2 seam). The eventual sequence:

1. Steamworks account, app ID, depot, launch configuration, store metadata (bureaucracy).
2. Produce the macOS `.app`; upload with SteamPipe; **set the `.app` bundle as the Mac launch
   target** (Valve's recommendation; lets Apple Silicon pick the best architecture).
3. **Auto-Cloud** on the Application Support save directory — no code.
4. Achievements: `steamworks.js` in the main process consuming forwarded `world.events`
   (~30 lines; the sim already emits kills/clears/boons/deaths). `steam_appid.txt` in dev.
5. Overlay: initialize Steam **before creating the window** if hooking requires it; add the
   known `in-process-gpu` switch; treat macOS overlay as best-effort runtime proof (it is weak
   platform-wide; it matters more on the later Windows build, where the same switch is the
   established fix).
6. Bundle and sign `libsteam_api.dylib` and any native module with the app.
7. Controller: let **Steam Input emulate a gamepad** first (Bardo's Gamepad API path already
   understands that); adopt the full Steam Input API later only for action sets and accurate
   glyphs.
8. A `beta` branch for testers. Windows/Linux when the product needs them: same shell, same
   engine, new builder targets + a per-OS Steam bridge build — game code and saves unchanged.

## L. Do Not Do This (union of both evaluations)

- Do not rewrite Bardo in Godot, Unity, Swift, Rust, or C++ for theoretical performance; the
  measured bottleneck candidate is presenter batching — shared TypeScript.
- Do not fork the game: no separate browser/desktop gameplay entry points, room/progression/
  save/content models, or rendering behavior (absent a measured platform difference).
- Do not let `src/sim/` import Electron/Node/Tauri/Steam/IndexedDB/fs — and keep feature
  detection inside `src/platform/` only (the grep stays empty).
- Do not enable Node integration in the renderer, disable the sandbox, or expose generic
  filesystem/shell APIs through preload.
- Do not serialize the `World` object; the envelope in H is the only save shape.
- Do not bind progression logic to IndexedDB, filesystem paths, or Steam Cloud specifics.
- Do not package/rebuild desktop for normal gameplay changes; if a gameplay change ever
  requires launching Electron to validate, fix the architecture instead of complying.
- Do not move the primary harness into Electron; tier 3 tests hosting, never gameplay.
- Do not implement Steam achievements, overlay control, or SDK loading before there is a Steam
  app to test against; do not chase Steam before the slice is fun.
- Do not ship `public/progress`, audit videos, comparison captures, or internal state as game
  assets (Phase 0 makes this structurally impossible).
- Do not assume "native wrapper" means better latency or rendering — it measurably does not.
- Do not pick Tauri for bundle size alone; do not keep Electron out of familiarity alone —
  the Phase 7 measurements are the standing test, and the seam keeps the fallback cheap.
- Do not add platform abstractions (achievements, telemetry, cloud, controller) before the
  first concrete second implementation exists. `StorageLike`→`SaveStore` earned its existence;
  the rest earn theirs the same way.
- Do not move browser saves to IndexedDB/OPFS before checkpoints or replay archiving create the
  need — but do define the envelope (Phase 2) before meta progression grows further.

## M2. Implementation Status (built and validated)

Tasks 1-5 below are **done and verified in this repository**; the section that follows records what
they were. What was proven, on the tree as it stands:

- `pnpm build` went 131 MB -> 5.9 MB and 8.7 s -> 1.6 s. `tools/check-build.ts` fails on planted
  evidence, a planted video, a missing required file, an asset the manifest names but the build lacks,
  and either size bound. Dev still serves `/progress` and `/assets`.
- `src/sim/save.ts` holds the envelope, its migrations and the legacy import; `src/platform/` holds
  the seam and both adapters. `grep -rn 'localStorage|matchMedia|requestFullscreen|navigator.storage|
  bardoDesktop|electron' src --include=*.ts` outside `src/platform/` is empty.
- Verified in a real browser: fresh boot writes nothing; the two legacy keys migrate and survive;
  pressing V in `?scenario=wave1` leaves meta intact; a corrupted save recovers from `.bak` with the
  corrupt bytes preserved; a schemaVersion-99 save survives a write attempt unchanged; the exported
  file is byte-identical to what is stored.
- `pnpm smoke:desktop` runs the real Electron app: 15 checks, all green, including **replay hash
  parity 4075949549 over 312 ticks** -- the same value pinned in `tests/sim/replay.test.ts` and
  produced by `pnpm sim`. The packaged app and headless Node are the same game, provably.
- 244 tests (was 184) in ~4 s. `tests/sim/boundary.test.ts` asserts the sim imports no host API and
  never reaches the save layer, which is what keeps the pinned hashes meaningful.

Two findings from building it that the plan did not anticipate, both now fixed in code:

1. **Pixi v8 breaks under a custom scheme.** `path.isUrl()` matches only `http(s):`, so under
   `app://bardo/` every root-relative asset URL lost its host and died cross-origin. One
   host-agnostic line in `src/render/atlas.ts` (`Assets.resolver.rootPath`) fixes it; it is a no-op
   on the web, verified by screenshot.
2. **Pixi v8 requires `unsafe-eval`.** A strict CSP without it stops the renderer from starting. The
   desktop CSP allows exactly that one token and locks down everything else; dropping it later means
   importing `pixi.js/unsafe-eval`.

An adversarial review of the finished diff (six lenses: correctness, Electron security, save
integrity, determinism, macOS portability, test quality) raised twenty findings; each was checked
against the code and eighteen were fixed. The ones worth remembering, because they were all invisible
to a green test suite:

- **An empty file imported as a save wiped progress.** `parseSave('')` returns a *default* document,
  and the import path refused only `corrupt` and `future` -- so a truncated download applied zeroed
  counters and announced SAVE IMPORTED. It now accepts only `ok` and `migrated`.
- **Two browser tabs silently overwrote each other**, each holding a whole document in memory. The web
  adapter now reports foreign writes through the `storage` event and the losing session stops writing
  and says so.
- **Development hooks shipped in the packaged app.** `BARDO_DESKTOP_MODE=dev` would have pointed a
  signed build -- carrying its save-file bridge -- at an http origin, and the navigation fence, the
  IPC sender check and the CSP all key off that same decision. Gated on `app.isPackaged`.
- **`?reduced=1` was written into the player's stored settings** at the next autosave.
- **A failing save store was invisible** outside the console; the first failure now banners in-game.
- **The corrupt-save smoke check raced the app's own boot recovery** and would have failed
  intermittently on a faster machine. It now asserts the outcome of that recovery instead, which
  proves more.
- **The smoke asserted an absolute `reducedEffects` value**, so it would have failed on any Mac with
  Accessibility > Reduce motion enabled. It asserts the flip now.
- **The quit confirmation would have been invisible on macOS.** A parented `showMessageBox` is a
  sheet; from a minimised or hidden app it attaches to a window nobody can see, the quit is cancelled
  and the guard's re-entrancy flag never clears -- the app simply appears to refuse to close. It now
  restores, shows and focuses the window first.
- **The smoke forced software GL everywhere**, so a Mac run would have reported success without ever
  touching the Metal-backed ANGLE path the product ships on. SwiftShader is now Linux-only, and on
  darwin the smoke asserts the renderer is *not* software.
- **A window sized on a docked 4K display reopened larger than the built-in panel.** Position was
  validated against the attached displays; size was not.
- **`electron-builder.yml` named an icon that does not exist**, which aborts the build rather than
  warning -- on the one machine where the `.app` can be produced at all.
- **`fsync` is not the durability guarantee on macOS that it is on ext4** (it needs `F_FULLFSYNC`,
  which Node cannot issue). The comment claiming otherwise was corrected rather than the code: the
  rotation, not the fsync, is what actually protects a player's previous generation.
- **`tests/sim/boundary.test.ts` had gaps of its own**, found by deliberately breaking the tree and
  watching it stay green: it never looked at `src/tuning.ts` (which most of the sim imports), its
  import matcher recognised only single quotes, and its comment stripper would have tripped on the
  repo's own inline "never Math.random" note. All four negative cases fail correctly now.

A pre-merge external review (graded 80/100, HOLD) then found seven more, all verified real and all
fixed — every one in persistence, which is where all four review rounds' genuine bugs have lived:

- **The web store swallowed write failures**, so the PROGRESS NOT SAVING warning — added for the
  desktop in the previous round — was unreachable on the web, and a failed legacy-envelope write
  shadowed a returning player's readable progress forever. The store now rejects like the desktop
  one, and the web read path falls back to the legacy keys in memory, so the upgrade write is an
  optimisation rather than a requirement.
- **A sparse `{"schemaVersion":2}` parsed as valid-with-defaults**, which is worse than corruption:
  it skipped the backup at boot, passed import, and let the next autosave rotate the last good
  generation away under zeroes. A document that arrives at the current schema must now carry its
  required fields; migrated older documents keep their leniency.
- **A quit could race the last pending save.** `persist()` is asynchronous and nothing on the close
  path waited for it. The renderer now signals writes-pending, and the desktop close path drains
  both queues (capped ~2.5s so a dead renderer cannot wedge the quit). The smoke proves the flush is
  load-bearing with a slowed-write negative control: without it the pending revision is lost,
  with it it survives.
- **An unsavable or rescued profile was console-only**; the player now gets a boot banner and a
  one-shot banner at the first suppressed write.
- **Files were read before their size was checked** in the import dialog and in the save store's
  probe; `stat` now comes first.
- **The save IPC accepted any syntactically valid profile name**; it now accepts only the profiles
  that exist.
- **The build gate checked only that manifested files exist, not that shipped files are accounted
  for** — and closing that hole surfaced two runtime sprites (`bardo_hero.png`,
  `bardo_brute.png`) hardcoded in `atlas.ts` that no check protected; they are REQUIRED entries now.

A third bot round on the fixed head found five more, again all real and again all in persistence's
edges: the web recovery could destroy the only good copy (the rotate-first write order clobbered the
good backup with corrupt bytes before the live write could fail -- live commits first now, so at
every step one slot holds the newest good generation); two tabs could still race in the window
before the storage event propagates (a heartbeat ownership lock now makes the second tab read-only
from BOOT rather than after its first clobbering write); both-copies-corrupt masqueraded as a first
boot (a distinct 'damaged' source now banners it); the build gate accepted any root-level .js as
bundle output (the 8-char content hash is required now); and the smoke drove fullscreen from the
main process instead of the player's F key (it now exercises keybind -> seam -> preload -> IPC on
every platform, plus the real window transition on macOS).

Deferred deliberately, with reasons: `RunCheckpoint` stays a reserved `null` slot until run structure
settles (the envelope is ready for it); IndexedDB stays unbuilt while saves are kilobytes; and
electron-builder is configured (`electron-builder.yml`, `build/entitlements.mac.plist`) but not
installed, because producing or signing a real `.app` needs macOS.

**One decision this work forced, recorded here:** a desktop install starts from an empty profile. The
`app://bardo` origin has its own storage partition and cannot read a browser's localStorage, so
export/import (pause screen, E and I) is the documented bridge between the two. That is why Phase 1
froze the canonical save bytes first: the file a browser exports is byte-identical to the one the
desktop host writes.

## M. Next Five Concrete Tasks

1. **Release asset boundary + size assertion.** Exclude `public/progress`/audit evidence from
   production builds; assert the built payload stays within a few MB. (Phase 0)
2. **`navigator.storage.persist()` + save export/import** in the web build — freezes the
   canonical save-file bytes and kills the eviction risk. (Phase 1)
3. **Save envelope + `src/platform/` seam.** Grow the versioned envelope (with migrations +
   fixtures, checkpoint slot reserved) and move storage/fullscreen/reduced-motion behind
   `Platform`/`SaveStore`; 184 tests and all pinned hashes unchanged. (Phase 2)
4. **Minimal sandboxed Electron host.** `desktop/` main + preload (named minimal API), dev
   loads `:5173`, packaged mode serves via `app://bardo`; unsigned local arm64 `.app` with
   `__game` alive. (Phase 3)
5. **Desktop fs saves + first smoke test.** Atomic/backup fs `SaveStore`; Playwright
   `_electron` smoke with isolated user-data dir proving launch, WebGL, replay-hash parity with
   Node and browser, save→relaunch→load, corruption→`.bak`, preload surface audit, and a clean
   evidence-free bundle. (Phases 4+6)

---

**Governing principle, kept from both evaluations:** the browser is the laboratory; Electron is
a picture frame around the same painting. One sim, one renderer, one tuning file, one save
schema, one harness — a platform seam thin enough to read in one sitting, a save model designed
before progression grows into it, and a fallback (Tauri) that stays cheap precisely because the
seam exists.
