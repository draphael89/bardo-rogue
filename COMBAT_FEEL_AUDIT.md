# Combat, Controls & Game-Feel Deep Audit

## Implementation closeout — 2026-08-28

**Final implementation score:** **95/100**

**Release judgment:** Every audited combat dimension is at or above 90. The remaining work is
human sensory and device certification, not a known implementation blocker.

This closeout evaluates the combat overhaul in the current working tree against
`origin/main` (`4d443115fc89`). The 76/100 report below is retained intact as the historical baseline
that motivated the work; its findings should not be read as the state of the current implementation.
A fresh independent critic traced input through simulation, collision, presentation, and audio,
reviewed current motion strips and browser evidence, and reproduced the automated gates before
scoring the result.

| Dimension | Final score | Decisive change |
|---|---:|---|
| Movement | 92 | Vector-normalized acceleration, quick reversal, reliable wall slide |
| Responsiveness | 94 | Edge-latched input, freeze-aware buffers, single next-tick action contract |
| Player control / agency | 96 | Retained explicit aim, hard lock, cover play, blade/bolt interaction |
| Dodge / roll feel | 95 | Exact travel promise, real iframe truth, Reversal choice, authored vertical tumble |
| Attack feel | 95 | Distinct commitments, truthful swept arcs, contact anatomy, hit/whiff pricing |
| Input handling | 97 | Tap/blur/modal safety, per-control gamepad rearm, stable aim ownership |
| Physics / collision | 95 | Deterministic rounded-tile rays and shared terrain authority for hits and tells |
| Animation timing | 95 | Latched viewpoints, motion-bridged counters, shared mechanical/visual timing |
| Enemy attack readability | 97 | Exact finite tells and a swept phase-two Warden decision grammar |
| Hit feedback | 97 | Immutable provenance, contact classes, causal reactions, action-level hierarchy |
| Camera | 93 | Capped directional kick, guarded restraint, wall-normal punctuation, reduced-effects path |
| Audio feedback | 93 | Authoritative listener, event-specific cues, buses, ducking, caps, limiter |
| Visual feedback | 97 | Separate guard, graze, Reversal, contact, kill, wall, and lock languages |
| Overall combat juice | 96 | Truthful near-misses, reactions, scars, time, camera, particles, and sound compose |
| Overall polish | 94 | Shared contracts, deterministic evidence, lifecycle coverage, clean replay fixtures |
| **Overall combat** | **95** | Cohesive, skill-sensitive combat with a truthful signature counter-loop |

### Design resolution

The pass followed five rules. First, every action makes a promise: a roll is safe only during its
authored iframe window, a wall can end travel, and cover blocks the tell and the damage alike.
Second, commitment creates decisions rather than dropped inputs: buffers survive freezes, but
startup, recovery, and whiff costs remain meaningful. Third, enemies speak different visual
languages instead of sharing louder circles; the Warden deliberately rotates slam, ring, and fan,
then changes cadence in phase two. Fourth, contact feedback describes what actually happened:
guarded damage cannot impersonate an exposed heavy hit, and a delayed arrow, echo, judgment, or
backlash cannot borrow the player's current sword pose. Fifth, intensity is earned once per action;
cleaving three bodies adds local wounds without multiplying camera trauma three times.

The result is a coherent first pass rather than a collection of stronger effects. North/south hero
views keep direction through attacks, hurt, and dodge. The depth-axis roll uses four body-only keys
plus a separately held weapon, with a diagonal boots-over-head apex that reads as rotation at native
scale. Enemy telegraphs terminate at exact collision cover and actual hurt reach. The Warden's guard,
poise break, phase transition, patterns, and punish windows now form a learnable fight instead of a
large-health version of an ordinary enemy.

The final delight pass adds one signature idea without changing the damage economy. A true
pass-through opens a twenty-player-tick **Reversal** breath; the player chooses blade or bow, and
the hostile clock resumes on the first live blade tick or arrow release. Ordinary roll-cancels never
overlap live contact with invulnerability, old hurt i-frames cannot counterfeit the reward, and
cancel, hurt, death, room, reward, and return boundaries all close it. Contact now distinguishes
guard, pierce, blade body, blade edge, and burst from immutable hit data. Enemies answer those causes
with directional, mass-aware reactions; committed momentum earns a wall-normal stone punctuation
without bonus damage. Near-miss wakes remain on the actual threat path, and persistent scars recede
while hostile floor information is live. These are recognition systems, not hidden DPS systems.

### Acceptance evidence

- `pnpm test`: 24/24 files, 292/292 tests.
- `pnpm typecheck` and `pnpm build`: pass.
- All three pinned replay fixtures pass their deterministic hash and sanity contracts; the refreshed
  Reversal and Warden browser strips report no console or page errors.
- Skilled full-encounter bot: 8/8 clears across seeds 1–8, 59.5–67.3 seconds, taking 1–4 damage;
  naive melee: 0/8 clears.
- Isolated Warden policy: 7/8 clears, 21.3–23.1 seconds. This bot gate measures decision/pacing
  coverage, not human tell comprehension; the complete encounter remains 8/8.
- Focused Warden contract sweep: worst sampled tick 1.451 ms against the 2 ms gate.
- Prior browser play probe: 1.7 ms p50, 8.3 ms p95 across 126 frames, with zero catch-up drops.
- Two independent directional release gates pass every melee/roll sub-score at 91–94; the final
  north/south roll strips preserve monotonic 22.5 px travel and visible weapon continuity.
- Terrain audit: 13,500 randomized circle rays and 200,000 reverse line-of-sight pairs without a
  mismatch or asymmetry; four simultaneous exact Charger tells rendered in about 0.91 ms under
  headless SwiftShader.
- Audio mix evidence covers 91 manifested assets; peak remained below -7 dBFS with zero clipped
  samples in both combat and hurt mixes.

The audio and camera scores are structural implementation judgments. A final headphone/speaker
audition, several human keyboard/controller sessions, high-DPR/low-end hardware coverage, and a
maximum-density phase-two fight remain release QA. Those checks may tune comfort or mix values, but
no unresolved correctness defect is being hidden behind the score.

---

## Historical baseline audit

**Audit date:** 2026-08-28

**Audited revision:** `1ef5b18a7280b34b93b0ed23528bc95b3948139c` (`origin/main`)

**Overall score:** **76/100**
**Assessment:** Strong, intentional combat prototype; not yet at the 90+ “incredibly tight” bar.

## Executive judgment

Bardo Rogue already has more game-feel infrastructure than its small surface area suggests. The combat simulation is deterministic and fixed-step. Attacks share their authored motion curves with their live hit sectors. The roll has distinct launch, travel, brake, landing, invulnerability, body-ghosting, and perfect-dodge states. Hits coordinate freeze, knockback, recoil, camera motion, contact shapes, flashes, particles, audio events, and damage-state animation. Enemy attacks—especially the brute—telegraph well. The current work is not missing “juice” in the simple sense of needing more particles or stronger shake.

The game is held below the reference bar by four more fundamental issues:

1. There are two independent animation-frame owners. The custom loop updates the low-resolution render texture, while Pixi's auto-started ticker presents that texture to the canvas on a separate schedule. Instrumentation observed the final-stage render occurring before the texture update, producing a likely extra display frame of latency and making the built-in frame metrics incomplete.
2. Action-button presses are latched at the browser boundary, but directional taps and focus loss are not fully reliable, and the action queue is not reliable across commitment windows. A complete WASD/arrow press-release between samples can disappear; blur can leave a just-latched mouse attack behind. Separately, the eight-tick action buffers decrement while an action is locked, so early presses disappear. A dodge requested during most of the heavy attack, or an attack requested early in a roll, can do nothing with no explicit feedback.
3. Per-axis steering makes diagonal acceleration about 41% faster than cardinal acceleration at the start, and the roll landing returns useful movement authority very late. The result is technically controlled but direction-dependent movement and a vulnerable landing that can feel sticky.
4. Effects are strong but not composed at the interaction level. A single heavy hitting three targets emits three full camera kicks and three recoil impulses. The measured kick was about 15.6 low-resolution pixels, making the most successful hits less readable.

The path to 90 is therefore: make the frame path singular, make the action contract truthful, normalize movement response, tune the landing, aggregate feedback by player action, and prove those decisions in a longer encounter. A particle-system rewrite is not an immediate priority.

## Audit basis and limitations

This was a code, simulation, browser, and captured-frame audit in the cloud workspace. It included:

- all 110 automated tests, which pass across nine test files;
- TypeScript checking, which passes;
- deterministic frame strips for a roll, perfect dodge, light attack, full combo, and brute tell;
- browser-native keyboard events for movement, independent arrow-key aim, held attack, and all four dodge bindings;
- deterministic bot runs across eight seeds for the first wave, third wave, and complete encounter;
- targeted traces of acceleration, roll velocity/authority, every-tick buffer behavior, and whiff-chain cadence;
- render-call instrumentation inside the browser;
- current-load and synthetic render stress probes.

This environment cannot replace hands-on play by several humans on their own keyboards, displays, speakers, and browsers. In particular, audio was inspected structurally but not judged by listening, and the synthetic graphics probe ran on cloud SwiftShader rather than a representative Mac GPU. Feel scores are therefore evidence-backed design judgments with **medium confidence**, not claims that bot success measures human enjoyment.

The audit's frame captures were ephemeral workspace evidence and are not committed. Generated audit output belongs in `/shots/` or `/.context/`; both are explicitly gitignored. The reusable evidence is the pinned revision plus the commands below. No gameplay implementation was changed at the audited revision.

### Reproduction protocol

To reproduce the historical baseline without changing the current checkout:

```bash
AUDITED=1ef5b18a7280b34b93b0ed23528bc95b3948139c
git worktree add /tmp/bardo-feel-audit "$AUDITED"
cd /tmp/bardo-feel-audit
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm sim -- --scenario full --bot kite --seeds 1-8 --ticks 10800
pnpm sim -- --scenario full --bot naive-melee --seeds 1-8 --ticks 10800
pnpm sim -- --scenario wave1 --bot kite --seeds 1-8 --ticks 10800
pnpm sim -- --scenario wave1 --bot naive-melee --seeds 1-8 --ticks 10800
pnpm sim -- --scenario wave3 --bot kite --seeds 1-8 --ticks 10800
pnpm sim -- --scenario wave3 --bot naive-melee --seeds 1-8 --ticks 10800
```

For deterministic visual evidence, start `pnpm dev` in that worktree and run, in a second shell:

```bash
pnpm strip -- --scenario dummy --eval "near(first(), -18, 0)" --hold '{"attack":true,"attackHeld":true,"aimX":1}' --frames 20 --every 1 --crop player,160,120 --out shots/audit-combo.png
pnpm strip -- --scenario wave1 --bot kite --from 300 --frames 12 --every 2 --out shots/audit-wave1.png
pnpm shot -- --scenario full --seed 1 --ticks 600 --bot kite --stepwise 1 --out shots/audit-full-s1-t600.png
```

The strip tool writes a JSON state/event sidecar next to its PNG. These commands cover the checked tests, encounter metrics, tick-aligned animation evidence, and browser render path without depending on an untracked capture bundle.

---

## 1. Current State

### Architecture inventory

| Concern | Current implementation | Primary code |
|---|---|---|
| Game loop | 60 Hz fixed simulation, interpolated display rendering, maximum five catch-up ticks, excess accumulator discarded after a severe hitch | `src/loop.ts:3-39` |
| Browser input | Action keys are latched, but WASD/arrows read held state only and can lose a full press-release between samples; blur clears keyboard state but can leave a latched mouse press | `src/input/index.ts:14-76` |
| Keyboard controls | WASD movement; arrows aim; J/Z/left-click attack; Space/Left Shift/K/X dodge; keyboard-only play works | `src/input/index.ts:49-76` |
| Aim selection | Right stick → arrows → mouse → movement → last aim; arrows and movement are “soft” and receive aim assist | `src/input/aim.ts:21-29` |
| Player state | `free`, `dodge`, `attack`, `dead`; tick-indexed transitions and two simple countdown buffers | `src/sim/player.ts:12-102`, `src/sim/world.ts:10-34` |
| Movement | Normalized target velocity, but per-axis acceleration/deceleration/reversal; 95 px/s maximum | `src/sim/player.ts:104-158`, `src/sim/player.ts:257-272` |
| Blade attacks | Three-hit chain; startup/active/recovery; whiff penalty; hit-confirm chain/cancel timing; limited early steering; authored windup/lunge/sweep | `src/tuning.ts:51-61`, `src/sim/player.ts:91-189` |
| Bow/projectiles | Committed draw/recovery and pooled projectiles; bolts can be cut to punish their caster | `src/sim/bow.ts`, `src/sim/player.ts:177-187` |
| Dodge | 24-tick state, 13-tick travel, exact 32 px path, ticks 1–10 invulnerable, body ghost throughout travel, attack cancel from tick 11 | `src/tuning.ts:35-50`, `src/sim/player.ts:116-137`, `src/sim/step.ts:67-89` |
| Perfect dodge/time dilation | A single successful pass triggers a cold visual/audio event and makes enemies/projectiles run at 25% for 24 player ticks while player/input remain at 60 Hz | `src/sim/combat.ts:115-125`, `src/sim/step.ts:43-64`, `src/tuning.ts:87-92` |
| Hit detection | Expanding swept arc against enemy/projectile circles; renderer and simulation use the same sweep/lunge functions | `src/sim/combat.ts:6-42`, `src/sim/player.ts:160-189` |
| Damage and poise | Per-enemy damage/knockback/stagger rules; maximum global freeze; boss/brute armor rules | `src/sim/combat.ts:45-113` |
| Walls/body collision | Circle represented by its axis-aligned bounds against tiles; per-axis wall slide; soft pair separation routed through wall solver | `src/sim/collision.ts:3-47` |
| Enemies/encounters | Brute, caster, charger, warden plus scripted room/wave definitions; 32-enemy and 64-projectile pools | `src/sim/enemies/`, `src/sim/waves.ts`, `src/sim/rooms.ts`, `src/sim/world.ts:64-117` |
| Animation | Procedural/art-directed actor views with authored roll pose table, attack anticipation/contact/recovery poses, enemy tell states | `src/render/views/player.ts`, `src/render/views/enemies.ts`, `src/tuning.ts:220-237` |
| Camera/feedback | Look-ahead, anticipation lean, trauma shake, additive directional kick, punch zoom, player recoil, contact stamp, hit flash, particles, post effects | `src/render/camera.ts`, `src/render/presenter.ts:112-174`, `src/render/postfx.ts` |
| Particles | Pooled ordinary Pixi sprites, maximum 1,500, rendered into the pixel-scale target | `src/render/particles.ts:6-45` |
| Audio | Event-driven music, ambience, combat SFX, mix buses, ducking, limiter and positional treatment; 91 audio assets. Load is asynchronous and does not block play | `src/audio/`, `src/main.ts:41-53` |
| Presentation | World/HUD render into a 480×270-class render texture; a screen sprite scales it to the canvas; DPR capped at 3 | `src/render/app.ts:31-94` |

### Typical combat transaction

```text
keydown/mousedown
  → InputSystem latches the press
  → next 60 Hz simulation tick samples and quantizes it
  → capturePlayerInput writes an attack/dodge countdown
  → updatePlayer either acts now or waits for a legal transition
  → attack sweep intersects a target
  → simulation applies damage, knockback, stagger and global freeze
  → simulation emits hit/kill events
  → Presenter maps those events to camera, recoil, flash, contact mark,
    particles, post-effect and audio
  → custom RAF renders the low-resolution root into a render texture
  → Pixi's separate auto ticker presents the screen sprite to the canvas
```

The simulation boundary is deterministic and presentation does not mutate gameplay, but the browser boundary has two edge cases: WASD/arrow directions are not latched, and blur does not clear a pending mouse click. The larger latency ambiguity enters at the last two steps. `Application.init()` is not given `autoStart: false` (`src/render/app.ts:40-44`), while a separate `requestAnimationFrame` loop is started in `src/loop.ts:15-33`. The custom loop updates only the render texture (`src/main.ts:123-126`, `src/render/app.ts:88-90`); Pixi's ticker owns the final canvas draw.

Browser instrumentation confirmed `app.ticker.started === true`. A repeated call order was:

```text
final stage draw → lighting/low-resolution target draws
```

rather than:

```text
simulation/presentation → low-resolution target draws → final stage draw
```

That can display the previous texture for one refresh and means `Loop.stats()` stops its timer before the actual final presentation. This is an architectural responsiveness issue, not a tuning issue.

### Frame-level control findings

At 60 Hz, one tick is 16.67 ms.

| Action | Current timing | Judgment |
|---|---:|---|
| Run acceleration, cardinal | 23.75 → 47.5 → 71.25 → 95 px/s in 4 ticks / 67 ms | Fast and readable |
| Run acceleration, diagonal | 33.6 → 67.2 → 95 px/s in 3 ticks / 50 ms | Incorrectly faster because both axes receive the full step |
| Stop | Tuned for 3 ticks / 50 ms | Appropriately sharp |
| Reverse through zero | Tuned for 2 ticks / 33 ms per-axis crossing | Strong intent, but vector changes are inconsistent |
| Light attack contact | Startup 4 ticks; contact at roughly 67–83 ms depending on input/render phase | Good for a deliberate blade, not instant but convincing |
| Light hitstop | 3 ticks / 50 ms | Strong without normally obscuring the fight |
| Heavy | 12 startup + 7 active + 24 recovery; 8-tick / 133 ms hitstop | Weighty and legible, but very committed |
| Roll | 24 ticks / 400 ms total; 13 ticks / 217 ms travel; exactly 32 px | Trustworthy distance and clear phases |
| Roll invulnerability | State ticks 1–10, 10 ticks / 167 ms | Honest one-tick commitment and useful pass-through window |
| Roll body ghost | Entire travel phase | Correct: collision never breaks the promise of the roll |
| Roll landing | 11 vulnerable ticks; authority rises with `u^2.4` | Too little useful control early in landing |
| Attack/dodge buffer | Nominal 8 ticks; decremented on the capture tick | Effectively about 7 future ticks / 117 ms outside hitstop |
| Perfect-dodge slow | Enemies/projectiles at 25% for 24 player ticks / 400 ms | Great concept and clean split clock; window needs human tuning |

The roll trace is particularly revealing. With movement held, travel ends at approximately x=32.0. The landing movement speeds were about 0.3, 1.6, 4.2, 8.4, 14.3, 22.2, 32.1, 44.2, 58.7, 75.6, then 95 px/s. The animation communicates a plant, but the first several vulnerable frames provide almost no escape authority. That can feel like the control stopped working even though it is following the authored curve exactly.

The buffers expose a different problem:

- A dodge pressed at light-attack state ticks 0 or 1 expires; presses around ticks 4–8 survive until the first legal recovery cancel.
- A dodge pressed during heavy state ticks 0, 1, 4, 8, 12, 16, or 20 expires. Only a press close to the legal recovery cancel starts the dodge, at about state tick 28 (467 ms from attack start).
- An attack pressed at roll ticks 0 or 2 expires; presses at ticks 4–10 survive until the attack cancel at tick 11.
- Inputs captured during hitstop are an intentional exception: the early return preserves the buffers, which is why hit-confirm chaining feels better than equivalent whiff timing (`src/sim/step.ts:29-40`).

This is not ordinary attack commitment. A committed action may correctly prevent an immediate cancel, but the current system also silently forgets a reasonable next-action request. Great action games can be strict about commitment while still being truthful about which request is queued, rejected, or replaceable.

### Keyboard-first assessment

Keyboard-only play is genuinely supported, not just nominally mapped. A browser-native smoke test showed:

- holding `D` moved the player from x=208 to x≈213.0 in 180 ms and reached vx≈63.3 while the test was in progress;
- holding `ArrowUp` and `J` produced two swings in 450 ms at −90°, proving aim can be independent from WASD;
- browser key events for Space, Left Shift, K, and X reached the dodge path correctly.

The scheme is a good fit for this arena: WASD should remain locomotion, arrow keys should remain optional explicit eight-way aim, and mouse/trackpad should remain optional precision aim. It does not need to become controller-first or lock-on-first.

The browser edge contract is incomplete at the audited revision. Attack/dodge action keys use the `pressed` latch, but WASD and arrows use only `down`, so a very quick press and release wholly between two 60 Hz samples produces no movement or aim tick. A blur clears `down` and keyboard `pressed` but not `mousePressed`, so a click latched just before focus loss can fire after focus returns. Acceptance requires full keyboard directional taps to produce exactly one sampled tick, and blur to clear keyboard, mouse-held, and mouse-latched state.

The weakness is aim ownership. Once the mouse has moved, its world-space vector is present every tick and outranks movement whenever arrows/right stick are released (`src/input/aim.ts:24-29`). A keyboard player who briefly used a trackpad can therefore return to WASD and still aim at a stale cursor. Soft aim assist also picks the smallest angle inside 20° without distance, reachability, line-of-sight, or target hysteresis (`src/sim/player.ts:236-245`). The result is usually helpful but can switch intent in clusters.

### Attacks, feedback and readability

The blade model is the strongest part of the current combat:

- startup, active sweep, contact, freeze and recovery are visually distinct;
- body windup/lunge and hit sectors read the same authored curve, but the displayed sweep is sampled one active tick behind the live sector;
- lights have a broad but not circular sector; the heavy's 215° arc feels like an earned combo release;
- hit-confirm and whiff clocks differ, giving accuracy real timing value;
- bolts can be cut and their owner punished, which creates a satisfying offensive defense;
- the brute tell has an excellent growing floor warning, raised silhouette, commit, contact and long punish phase;
- perfect dodge uses the fight's only cold palette and keeps the player at full speed while the hostile world slows.

The captured light attack and combo strips read well even as still frames. The perfect-dodge strip clearly shows the cold ring and player rim. It also shows the dodged projectile visually overlapping/crawling past the player for several displayed frames; the player is safe, but the prolonged overlap makes the 25% world rate more visually ambiguous than the initial success cue.

The sweep has a specific truthfulness defect despite sharing its easing function. Simulation tests active tick `k` through `sweepEase((k + 1) / active)`, while the renderer begins that displayed interval at `sweepEase(k / active)`. An enemy near the leading edge can therefore take damage one tick before the blade/crescent reaches it on screen. The contract should expose one authoritative per-tick sweep sample to both systems. Acceptance: for every swing and active tick, the displayed leading edge must equal the sector already tested by simulation throughout that display interval; it must neither lag a live sector nor predict an untested one.

The main feedback defect is additive stacking. `Presenter.handleEvents` applies a complete camera/recoil/flash package for every hit event (`src/render/presenter.ts:112-165`), and camera kicks have no magnitude cap (`src/render/camera.ts:14-16`). In a controlled three-dummy heavy hit, the result was:

- three hit events;
- camera kick magnitude ≈15.6 px at the low-resolution target;
- trauma clamped to 1.0;
- recoil magnitude ≈8.4 px;
- global freeze remained correctly capped at 8 ticks rather than tripling.

Per-target wounds, flashes, damage state, knockback and sparks should remain per-target. Screen-space motion should describe the player's one swing, with only a sublinear crowd bonus. Otherwise successful cleaves make danger harder to parse.

### Physics and collision

Wall movement is cheap, deterministic, and slides along blocked axes. Body separation cannot push an actor through a wall. Those are good foundations.

Two details hold it back:

1. `overlapsSolid` treats a circle as its bounding box (`src/sim/collision.ts:3-31`). This is conservative around tile corners and can create corner snag or a slightly larger effective body than the sprite promises.
2. `separate` halves penetration before applying weights (`src/sim/collision.ts:37-46`). With common weights summing to one, one pass corrects only half the overlap. There is no iterative convergence pass, so dense groups stay softly compressed.

This does not justify replacing collision with a physics engine. The right intervention is a small deterministic contact-solver improvement, followed by corner tests. A true circle-v-tile narrow phase is only warranted if instrumentation shows visible snag after that.

### Encounter and balance evidence

The current encounter is too short to prove the quality of its systems.

Across seeds 1–8:

| Protocol | Result |
|---|---|
| Complete encounter, spacing/punish bot | Cleared 8/8 in 30.8–36.3 s; took 1–3 damage |
| Complete encounter, aggressive naive bot | Died 8/8 in 16.5–34.4 s; cleared 1–2 waves; took all 5 damage |
| Complete encounter, idle | Died identically 8/8 at 8.6 s |
| Wave 1, spacing/punish bot | Cleared 8/8 at 5.8 s, zero damage |
| Wave 1, aggressive naive bot | Cleared 8/8 at 4.6 s, zero damage, 2/2 perfect dodges |
| Wave 3, spacing/punish bot | Cleared 7/8 in 13.5–17.6 s; one death at 22.1 s |
| Wave 3, aggressive naive bot | Cleared 7/8 in 11.9–13.8 s; one death at 14.5 s |

Bots are not players, but these are useful policy probes. The opener gives no seed-dependent variation and is solved faster by direct aggression. In wave three, the naive policy often beats the spacing/punish policy because broad arcs, stagger and short engagement distances overwhelm isolated threats. The encounter demonstrates effects; it does not yet consistently demand the movement, aim, roll, bolt-cut, cancel and punish decisions that the combat supports.

### Browser constraints and performance

The deterministic simulation is not the current bottleneck. Typical full-bot simulation work was in the low tens of microseconds per tick after warmup, with isolated process spikes but no sustained 60 Hz pressure. The fixed pools also bound gameplay allocation.

Presentation needs more disciplined measurement:

- the app currently renders the room/light scene into a low-resolution target and applies the final scaled presentation separately;
- `Loop.stats()` measures presenter plus render-target work, but not Pixi's separate final stage draw;
- DPR can rise to 3, making final effects and canvas work device-dependent;
- particles are pooled, but they are ordinary `Sprite` children and the update removes expired entries with array splices;
- the hard pools cap the design at 32 enemies and 64 projectiles; this is adequate today but below a true bullet-dense ceiling;
- audio begins loading without blocking startup (`src/main.ts:47`), so a very early action can be silent on a cold cache.

Cloud SwiftShader measurements, useful only as relative evidence, were:

| Scene | Render p50 | p95 | Meaning |
|---|---:|---:|---|
| Empty | 0.6 ms | 5.1 ms | Baseline is cheap |
| Representative wave-three state | 3.2 ms | 16.7 ms | Software renderer occasionally reaches a full 60 Hz budget |
| Artificial ceiling: 32 enemies, ~61 bolts, 1,500 particles | 79.7 ms | 122.1 ms | Current ordinary-sprite presentation cannot support every cap simultaneously on this renderer |

The ceiling scene is not a current gameplay workload and should not drive an early rewrite. First unify the frame owner and measure the complete present on target hardware. If later encounter design calls for hundreds of similar atlas-based particles, split them by base texture/blend mode into Pixi v8 `ParticleContainer`s, give each an explicit `boundsArea`, and mark only genuinely changing properties as dynamic. Complex actors, nested telegraphs, masks and filtered objects should stay in normal containers.

### Tuning problems versus systems problems

| Tuning / curve issues | Systems / architecture issues |
|---|---|
| Roll landing authority curve | Two independent RAF/ticker owners |
| Perfect-dodge slow window length/depth balance | Buffer semantics do not preserve next-action intent |
| Camera/recoil limits for crowd hits | Per-axis steering creates direction-dependent acceleration |
| Encounter timing, spacing and composition | Screen feedback is emitted per target, not composed per action |
| Heavy commitment/cancel thresholds after the input contract is defined | Soft separation only partially resolves penetration |
| Mix/ducking of time-dilation cue after listening tests | Hybrid aim has no explicit ownership/hysteresis |

The distinction matters. Tuning buffer length upward would hide some dropped inputs while creating delayed surprise actions elsewhere. The queue first needs to know what kind of request it contains and when that request is valid.

### Reference-game principles

Hades and Enter the Gungeon are useful here because they coordinate authority and consequence, not because Bardo Rogue should copy their exact mechanics.

- **Immediate intent, visible commitment.** The game reacts to the request promptly, then makes the committed phase visually unmistakable. It does not feel as if the input device stopped working.
- **A dodge is a contract.** Direction, displacement, pass-through behavior, invulnerability and recovery are learnable and consistent. Bardo Rogue is already close on distance and body ghosting; landing control and queue truthfulness are the remaining gaps.
- **Impacts are one coordinated sentence.** Pose, hit pause, target response, sound, screen response and recovery peak together. More of each element is not automatically stronger.
- **Danger survives spectacle.** Enemy tells and bullets remain legible during successful attacks. This is why screen-space feedback must be capped even when local target feedback scales up.
- **Encounters require the verbs.** A polished moveset only becomes meaningful when positioning, timing, target choice, defensive movement and punish windows outperform indiscriminate aggression.

---

## 2. Scorecard

The overall **76/100** is weighted toward player authority, input/presentation latency, collision trust and encounter proof rather than being a simple average of the category scores.

| Dimension | Score | What already works | What prevents 90+ |
|---|---:|---|---|
| Player control | **72** | Independent movement/aim, latched roll direction, steering during attacks, full-speed player during perfect-dodge slow | Reasonable next-action requests silently expire; roll landing withholds useful authority; stale mouse can own aim |
| Movement | **82** | 67 ms cardinal acceleration, 50 ms stop, strong reversal, normalized final speed, good attack movement curves | Diagonal acceleration reaches full speed a tick earlier; early roll landing is nearly immobile |
| Input responsiveness | **80** | Action-key edges are latched, repeat handling is deliberate, hitstop preserves buffers, native keyboard path works | WASD/arrow pulses can drop; blur can retain a mouse click; separate frame owners likely add a presentation frame; design buffers expire during locks |
| Aiming | **77** | Keyboard-only independent aim works; mouse is transformed through live shaken world; radial gamepad deadzones; soft assist | No explicit device ownership, target hysteresis, reach/distance/LOS scoring; stale cursor can override WASD fallback |
| Dodge/roll feel | **78** | Exact distance, body ghost, honest startup, readable i-frames, authored poses, strong perfect-dodge reward | 11-tick vulnerable landing starts with almost no control; early queued attacks disappear; 25% projectile crawl can look ambiguous |
| Attack responsiveness | **78** | Light contact within roughly 83 ms, limited startup steering, hit-confirm chains, held combo, whiff cost | Heavy blocks dodge requests for hundreds of milliseconds; a held source and an intentional queued tap share one buffer |
| Weapon feel | **82** | Shared sweep authoring, body coil/lunge, distinct light/heavy cadence, bolt cutting, poise rules | Displayed sweep trails the live sector by one active tick; broad arcs/current encounters make aggression overly automatic; player animation vocabulary is still limited |
| Hit feedback | **88** | Excellent contact shape, freeze, wound, flash, body kick, recoil, knockback, sound event and kill release | Multi-target hits stack screen response linearly and can become less readable precisely when most successful |
| Enemy feedback | **86** | Clear telegraphs, stagger/armor differentiation, distinct silhouettes, strong brute windup/recovery | Encounter density rarely tests simultaneous tell hierarchy; some spectacle can cover the next threat |
| Physics/collision feel | **67** | Deterministic, cheap, wall-safe, roll ghosting is correct | Bounding-box circle/wall approximation and half-penetration separation produce soft crowd compression and potential corner snag |
| Camera behavior | **78** | Aim look-ahead, anticipation lean, trauma curve, quick directional kick, punch zoom | Additive kick has no cap; frame path is unsynchronized; effect intensity can outrank threat readability |
| Animation responsiveness | **74** | Excellent authored roll poses and state-driven attack/enemy posing; timing follows simulation | Locomotion and much player weapon/body motion still rely on procedural transforms/static art rather than full authored clips |
| Visual juice | **88** | Cohesive pixel-scale contact language, restrained palette hierarchy, impact/kill/perfect-dodge differentiation | More effects would now have diminishing returns; multi-hit composition and dense-frame readability need refinement |
| Audio feedback | **80*** | Large event-specific library, buses, limiter, ducking, spatial treatment, gameplay tell band | *Low-confidence score: not auditioned in this environment; cold-cache actions can precede asset load, and time dilation needs listening tests* |
| Combat readability | **80** | Enemy tells, cold dodge language, floor-plane effects and shared sweep authoring are strong | Active blade/arc display trails collision by one tick; large stacked kick/recoil and slow projectile overlap can disrupt threat tracking; dense combinations are under-tested |
| Encounter pacing | **55** | Immediate action, multiple enemy verbs, boss foundations | Complete clears take only ~31–36 s for the competent bot; opener is trivial; naive aggression often solves waves fastest |
| Overall polish | **72** | Cohesive art/feedback direction, deterministic tools, replay/debug support, many details already tuned | Hidden present latency, inconsistent queue contract, collision softness, limited player clips and short encounter reveal prototype edges |

**Why 76, exactly:** the game already looks and responds like an authored action game when one attack hits one target. That earns a score well above an average prototype. It does not yet make every input and contact trustworthy across state boundaries and crowded frames, and the encounter does not provide enough sustained pressure to prove the moveset. Those are central to felt quality, so the score cannot be carried into the 80s by VFX quality alone.

---

## 3. Biggest Problems

### 1. The visible frame is not owned by the gameplay loop

This is the highest-confidence systemic flaw. It can add one display interval after otherwise-correct input/simulation behavior, causes presentation order to vary, and excludes the final stage/filter work from performance metrics. Responsiveness cannot be tuned accurately while the measured frame is not the displayed frame.

### 2. The action queue breaks the player's expectation of future intent

The browser input layer is good, but the action state machine only stores short countdowns. A heavy that visibly commits is acceptable; a dodge request that silently vanishes during it is not. Extending every buffer is also unsafe because it can execute stale commands long after the player changed their mind.

### 3. Movement authority varies with direction and roll phase

Cardinal and diagonal motion do not share the same response curve, while the planted landing has several nearly inert yet vulnerable frames. These are small numerical differences with a large subjective cost: the player cannot form one consistent model of how quickly movement intent becomes motion.

### 4. Screen feedback scales by targets instead of by the initiating action

Local feedback should celebrate every target. Camera displacement, player recoil and full-screen flash should describe the single player action. The current three-target heavy measurement is strong evidence that these responsibilities need separating.

### 5. The encounter is not a sufficient control proof

The current combat ends quickly and often rewards broad-arc aggression over the more intentional spacing/punish policy. It cannot reveal whether target selection, aim transitions, dodge recoveries, crowd collision or layered tell readability hold up for 60–90 seconds.

### 6. Contact resolution is deliberately soft but not convergent

Only half of a pair's penetration is resolved per encounter pass. In crowds this produces compressible bodies and undermines the otherwise precise roll and attack distances.

---

## 4. Highest-Leverage Opportunities

1. **Make one RAF own sample-to-present.** This removes a systemic frame of ambiguity and makes every later timing measurement honest.
2. **Define a truthful cancel/queue contract.** Preserve intentional next actions across reasonable windows, distinguish held repeats from discrete taps, and make genuine commitment visible.
3. **Normalize vector movement and retune only the roll landing.** The roll's distance, ghosting, pose table and i-frame concept are already good; a narrow change can transform how much control it returns.
4. **Compose one screen response per player action.** Keep rich local target feedback and cap shared camera/recoil response.
5. **Build one longer control-proof encounter.** Use content as a validation instrument for movement, dodge, aim, bolt cut and target choice rather than adding health.

These opportunities are intentionally narrower than “add more juice.” The existing effects language is already one of the game's strengths.

---

## 5. Prioritized Plan: Top 10

The ranking applies **impact × confidence ÷ complexity**, with frequency folded into impact and player-control improvements winning close ties. Types are **Tuning**, **Small system improvement**, **Foundational**, or **Polish**.

### 1. Make the custom loop the sole frame owner

- **Type:** Small system improvement
- **Problem:** Pixi's auto ticker and the custom fixed-step loop present on independent animation frames.
- **Evidence:** `app.ticker.started` was true. Instrumented calls repeatedly showed the final stage draw before that cycle's low-resolution target draws. `Loop.stats()` times only through `ra.renderFrame()` and not the subsequent final-stage draw.
- **Proposed change:** Initialize Pixi with `autoStart: false` or explicitly stop its ticker. In the custom RAF, run presenter updates, render lighting/root into the low-resolution texture, then call the final `app.render()` exactly once. Measure the complete sequence through the stage draw. Retain the fixed 60 Hz simulation and interpolation.
- **Why it matters:** Every control, animation and effect decision is judged through the display. One ambiguous frame is more damaging than several missing particles.
- **Expected player-visible effect:** Keyboard and mouse actions appear on the earliest possible display frame; camera, target texture and UI always belong to the same game frame; motion feels more connected.
- **Relevant systems/files:** `src/render/app.ts`, `src/main.ts`, `src/loop.ts`, render timing/debug API.
- **Implementation complexity:** Low.
- **Risk:** Low–medium. Manual rendering must preserve resizing, filters and paused/replay behavior.
- **How to test:** Assert one final-stage render per custom RAF and exact `target → stage` call order. Instrument `keydown.timeStamp → first changed presented frame`; target p95 **<25 ms at 60 Hz** on a representative Mac, with no second RAF. Include the final stage/filter in frame stats.
- **Priority:** **P0 / first**.

### 2. Replace countdown-only buffers with a truthful action-request contract

- **Type:** Foundational change, narrowly scoped to player actions
- **Problem:** Attack and dodge countdowns cannot distinguish a tap from held auto-repeat, a queued next action from a request made inside hard commitment, or a request the player has since withdrawn.
- **Evidence:** Early roll attacks and most heavy-attack dodge presses expire. The same `attackBuffer` is refreshed every tick by a held attack and by a discrete tap (`src/input/index.ts:70-76`, `src/sim/player.ts:12-16`).
- **Proposed change:** Store request kind/source and age, and define an explicit cancel matrix. Recommended first contract: (a) a discrete attack requested during a roll survives to the tick-11 attack exit; (b) dodge may cancel light startup, queues during light active, and executes at the first recovery cancel; (c) heavy has a clearly authored pre-commit dodge cancel, then a hard committed middle, then a short late queue window; (d) releasing held attack removes held-generated future intent but never removes a discrete tap; (e) a rejected request is not held for a surprising future action.
- **Why it matters:** Control is the player's belief that the game understood the command, even when it cannot execute immediately. This makes commitment deliberate instead of feeling like packet loss.
- **Expected player-visible effect:** Fewer “I pressed dodge” failures; smooth roll-to-attack and hit-confirm chains; no extra swing long after attack was released.
- **Relevant systems/files:** `src/input/index.ts`, `src/sim/input.ts`, `src/sim/world.ts`, `src/sim/player.ts`, `src/sim/bow.ts`, player/input tests and replay encoding.
- **Implementation complexity:** Medium. Replay/hash compatibility and keyboard/gamepad parity require care.
- **Risk:** Medium–high. Over-generous queues can automate combat or trigger stale actions; canceling heavy too freely erases weapon identity.
- **How to test:** Table-test every press tick across free, each light phase, every heavy phase, bow draw/recovery, roll, hitstop and hurt. Target: **no discrete request within 200 ms of its documented eligibility is dropped**, no action fires **>200 ms after the last valid request**, and no held-generated swing fires after release unless already committed. Then run tap-vs-hold human tests.
- **Priority:** **P0 / second**.

### 3. Normalize movement response in vector space

- **Type:** Small system improvement
- **Problem:** Full per-axis acceleration makes a diagonal velocity change larger than the same cardinal intent and reaches maximum speed one tick sooner.
- **Evidence:** From rest, cardinal speeds were 23.75/47.5/71.25/95 px/s; diagonal speeds were 33.6/67.2/95 px/s. Existing tests validate final diagonal speed but not equal response time.
- **Proposed change:** Limit the magnitude of the velocity delta in vector space while retaining separate intent for acceleration, braking and reversal. When a cardinal input should remove a lateral component, explicitly project/brake the unwanted component so the current crisp direction changes are not lost.
- **Why it matters:** A single physical intention should have one response curve regardless of angle. This makes small corrections predictable and keyboard movement feel engineered rather than axis-based.
- **Expected player-visible effect:** Cardinal, diagonal and arbitrary-angle starts feel equally sharp; changing from diagonal to cardinal sheds drift without a speed bump.
- **Relevant systems/files:** `src/sim/player.ts:257-272`, `src/tuning.ts:27-33`, movement tests.
- **Implementation complexity:** Low–medium.
- **Risk:** Medium. A naive vector clamp can reintroduce sideways coasting or make 90° turns too soft.
- **How to test:** Sweep input angle in 5° increments from rest and from representative existing velocities. Target **90% maximum speed in 4 ticks at every angle**, stop in **≤3 ticks**, reverse through zero in the intended **≤2 ticks**, and shed a released lateral component in **≤3 ticks**, with <2% angular variance in distance over 250 ms.
- **Priority:** **P0 / third**.

### 4. Retune the roll landing and perfect-dodge window through A/B playtests

- **Type:** Tuning
- **Problem:** The roll is mechanically honest but returns useful movement too late; the 25% hostile-world slowdown can leave a threat visually overlapping the player for a long time.
- **Evidence:** The 11-tick landing begins at only ~0.3, 1.6, 4.2, 8.4, then 14.3 px/s under held input. The captured perfect-dodge strip shows the bolt crawling across the safe player after the success cue.
- **Proposed change:** Preserve the proven 32 px travel, one-tick commitment, travel body ghost and recognizable landing. Test three landing curves with a movement-control floor and earlier rise; separately test 25%, 33%, and/or a shorter 25% perfect-dodge hostile window. Change the **window before the depth** because full-speed player actions become four times as effective at 25%.
- **Why it matters:** The player asked for easier, more satisfying dodging. The high-value change is not more invulnerability; it is faster post-roll authority and an unambiguous reward window.
- **Expected player-visible effect:** The roll still has weight and cannot replace running, but the player can steer out of danger as soon as the landing reads; perfect dodge feels like a sharp advantage rather than prolonged overlap.
- **Relevant systems/files:** `src/tuning.ts:35-50`, `src/tuning.ts:87-92`, `src/sim/player.ts:116-137`, `src/sim/step.ts:43-64`, roll presentation/audio.
- **Implementation complexity:** Low.
- **Risk:** Medium. Too much landing authority removes commitment; too long/deep a slow turns one dodge into disproportionate damage.
- **How to test:** Target first landing-frame authority of **≥25% max speed**, **≥50% within 4 landing ticks**, and **≥90% by state tick 20**. Recheck that repeated rolling travels no more than **5% faster than running** over 10 s and that i-frame/body-ghost tests remain exact. Use blinded human A/B sessions; target ≥80% agreement that direction/distance/exit are predictable and no significant increase in roll-spam success.
- **Priority:** **P0 / fourth**.

### 5. Aggregate screen-space feedback once per swing/tick

- **Type:** Small system improvement + Polish
- **Problem:** Camera kick, player recoil, zoom and flash are applied once per target hit, while one swing should create one shared screen gesture.
- **Evidence:** A three-target heavy produced ≈15.6 px camera kick, trauma 1.0 and ≈8.4 px recoil. Freeze correctly used maximum-not-sum semantics, proving the simulation already has the right composition precedent.
- **Proposed change:** Group same-swing hit events for screen feedback. Keep every wound, flash, shard, target knockback and damage response. Emit one camera/recoil/flash envelope, with a sublinear count bonus such as `base × min(cap, 1 + k × sqrt(extraTargets))` and explicit caps. Give kills a compatible accent rather than another complete displacement impulse.
- **Why it matters:** Power and readability are not opposites if local and global feedback have different responsibilities.
- **Expected player-visible effect:** Cleaves feel larger through the number of bodies reacting, but the room and next telegraph remain trackable.
- **Relevant systems/files:** `src/render/presenter.ts`, `src/render/camera.ts`, `src/tuning.ts` juice values, presenter/camera tests.
- **Implementation complexity:** Low–medium.
- **Risk:** Low. Poor grouping across ticks could weaken staggered contacts; grouping must use swing/tick identity rather than arbitrary time.
- **How to test:** One-, three-, and six-target captures. Target three-target heavy camera kick **≤6.5 px**, recoil **≤5 px**, trauma **≤0.7 before kill accent**, while all three targets retain local contact marks. In playtests, require the next enemy tell to remain identifiable during the hit.
- **Priority:** **P0 / fifth**.

### 6. Make body separation converge and preserve wall tangency

- **Type:** Small system improvement
- **Problem:** A pair resolves only half its penetration per pass, so crowds stay compressed and wall contacts can feel soft.
- **Evidence:** `separate()` computes `(minimumDistance - distance) × 0.5` and then applies weights that normally sum to one (`src/sim/collision.ts:37-46`). Only one pair pass occurs in `src/sim/step.ts:70-90`.
- **Proposed change:** Resolve the full minimum translation according to normalized inverse-mass weights, run a small fixed number of deterministic solver iterations for active contacts, and remove velocity components that continue pushing into a blocked wall/contact. Keep roll travel ghosting. Add true circle-v-tile corner distance only if post-change traces still show false corner collision.
- **Why it matters:** Precise attacks and rolls need bodies that occupy stable, believable space. Soft overlap makes reach and escape gaps visually untrustworthy.
- **Expected player-visible effect:** Cleaner crowd lanes, less squeezing into enemies, firmer wall sliding, fewer small separation jitters.
- **Relevant systems/files:** `src/sim/collision.ts`, `src/sim/step.ts`, enemy movement/knockback, deterministic hash and collision tests.
- **Implementation complexity:** Medium.
- **Risk:** Medium. Full correction can introduce order bias, jitter, or crowd explosions unless iterations and weights are stable.
- **How to test:** Property tests for wall safety and deterministic hashes; pair/crowd/wall-pin fixtures at multiple insertion orders. Target end-of-tick penetration **<0.25 px**, no alternating contact jitter >0.25 px, and no wall penetration. Human-test corner slides and escape from three-body pins.
- **Priority:** **P1 / sixth**.

### 7. Add explicit hybrid-aim ownership and target hysteresis

- **Type:** Small system improvement
- **Problem:** A mouse that moved once remains a live higher-priority source than movement, and soft assist can jump to any closer-angle target with no stickiness or reach context.
- **Evidence:** `mouseSeen` is permanent and `resolveAim` evaluates mouse before movement. `aimAssist` selects only by angular difference inside 20°.
- **Proposed change:** Track the last **explicitly active** aim device. Arrow aim stays authoritative after release until the mouse actually moves/clicks or right stick crosses its deadzone; mouse precision returns immediately on actual pointer activity. For movement fallback, score assist by angle plus reachable distance and line-of-sight, retain the current assisted target until a challenger beats it by a clear margin, and never assist precision mouse aim.
- **Why it matters:** Hybrid input should increase choice without letting an idle device steal intent. Target stability matters more than a larger assist cone.
- **Expected player-visible effect:** Keyboard-only circle-strafing stays intentional; moving after touching the trackpad no longer attacks a forgotten cursor; clustered targets do not cause aim chatter.
- **Relevant systems/files:** `src/input/index.ts`, `src/input/aim.ts`, `src/sim/input.ts`, `src/sim/player.ts:236-245`, replay format/tests.
- **Implementation complexity:** Medium.
- **Risk:** Medium. Sticky aim can feel like lock-on; device switching must remain immediate and discoverable.
- **How to test:** Deterministic mouse→arrows→WASD→mouse sequences, symmetric target clusters and targets crossing the assist boundary. Target explicit-device acquisition on the **next sim tick**, zero aim-owner changes without new source activity, and no assisted target switch until the challenger exceeds a defined score margin. Validate entirely keyboard-only play separately.
- **Priority:** **P1 / seventh**.

### 8. Author one 60–90 second control-proof encounter

- **Type:** Tuning + encounter/system composition
- **Problem:** The current 31–36 second clear and trivial opener do not sustain enough pressure to validate the combat verbs; naive broad-arc aggression is often fastest.
- **Evidence:** Both bots clear wave one untouched, the naive policy is 1.2 s faster, and the naive policy clears seven of eight wave-three seeds in less time than the spacing/punish bot.
- **Proposed change:** Build one reference encounter with staged spatial problems, not extra health: a readable single-threat opening, a cross-angle caster/melee pair that makes movement and target choice matter, a bolt-cut opportunity, a constrained punish window, and a final mixed pattern that tests dodge exit direction. Vary spawn side/timing from the seeded RNG while preserving fairness. Do not increase effect density until tell hierarchy survives.
- **Why it matters:** An encounter is the integration test for controls. It exposes dominant strategies, collision compression, lost aim ownership and feedback occlusion that dummy tests cannot.
- **Expected player-visible effect:** A compact but complete combat arc: learn, read, reposition, defend, punish, master. Deliberate play clearly outperforms mashing without becoming slow.
- **Relevant systems/files:** `src/sim/rooms.ts`, `src/sim/waves.ts`, enemy tuning/AI, bots, metrics/replays, encounter tests.
- **Implementation complexity:** Medium.
- **Risk:** Medium. More simultaneous threats can conceal control defects or become unfair; HP inflation would lengthen without improving the test.
- **How to test:** Target skilled clear **60–90 s**, naive-policy clear rate **<25%**, new-player first death no earlier than **30 s median**, and damage attribution/readability **≥90%** in post-run questions. Require successful runs to use movement, dodge, attack and at least one bolt cut/punish. Run seeds and human sessions; bots are guardrails, not balance authorities.
- **Priority:** **P1 / eighth**.

### 9. Author a compact player combat-animation set around the simulation timings

- **Type:** Polish
- **Problem:** The roll and enemy tells have clear authored poses, while locomotion and parts of blade combat still lean on static sprites plus procedural transform work.
- **Evidence:** The roll strip reads launch/dive/tuck/extend/plant/rise exceptionally well. Attack timing reads, but the body contributes less anticipation, directional footwork and recovery information than the weapon/contact effects.
- **Proposed change:** Add a deliberately small set: eight-direction or mirrored four-direction locomotion, light anticipation/contact/recovery, heavy coil/contact/recovery, and hurt. Keep simulation state/tick and the shared swing curves as the source of truth; animation must visualize those phases rather than delaying them. Preserve the current procedural layer where it improves continuity.
- **Why it matters:** At the 90+ bar, the player should understand commitment and recovered control from the silhouette before reading a particle or HUD element.
- **Expected player-visible effect:** Movement feels less like a sliding sprite; attacks show force travelling through the body; cancel availability and vulnerable recovery become intuitively visible.
- **Relevant systems/files:** `src/render/views/player.ts`, atlas generation/assets/manifest, `src/tuning.ts` pose data, screenshot/strip tools.
- **Implementation complexity:** Medium–high, primarily art iteration.
- **Risk:** Medium. Extra anticipation frames or asynchronous animation would add apparent input lag and desynchronize hitboxes.
- **How to test:** Pin strips at every startup/active/recovery/cancel boundary and overlay hit sectors. Require contact pose and first live hit sector on the same sim tick, recovered locomotion pose within one displayed frame of control restoration, and readable silhouettes at native 16 px scale without VFX.
- **Priority:** **P2 / ninth**.

### 10. Establish a density budget before expanding projectile/VFX architecture

- **Type:** Foundational, deferred until encounter demand is real
- **Problem:** Current pools and ordinary-sprite particles are adequate for the shipped scene but cannot be assumed to support Gungeon-like projectile/particle density, especially at high DPR with final effects.
- **Evidence:** Simulation is cheap; the artificial 32-enemy/~61-bolt/1,500-particle SwiftShader scene was not. Current frame stats omit final presentation, and the projectile pool caps at 64.
- **Proposed change:** After recommendation 1, add complete CPU/GPU-present telemetry and define a representative density scene. Raise pools only when design needs them. If same-texture particle sprites dominate, group compatible particles by base texture/blend in Pixi v8 `ParticleContainer`, specify `boundsArea`, enable only necessary `dynamicProperties`, and consider `roundPixels`. Keep actors, filters, masks and nested telegraphs out. Avoid per-frame allocation in the hot update path and replace live-array splicing only if profiles show it matters.
- **Why it matters:** The browser can support a much harder fight, but stable frame pacing is itself game feel. Architecture should follow measured content pressure, not an abstract maximum.
- **Expected player-visible effect:** Denser patterns and stronger local effects without input hitching, uneven animation or sudden resolution-dependent drops.
- **Relevant systems/files:** `src/loop.ts`, `src/render/app.ts`, `src/render/particles.ts`, `src/render/postfx.ts`, `src/sim/world.ts`, projectile views/lighting, performance tools.
- **Implementation complexity:** Medium–high if batching becomes necessary; low for telemetry/budgets.
- **Risk:** Medium–high. Premature `ParticleContainer` migration would lose per-particle capabilities or split batches by texture/blend anyway; synthetic optimization can miss Safari/Firefox costs.
- **How to test:** On target Chrome, Safari and Firefox at representative DPR, target full present **p95 ≤8 ms**, simulation **p95 ≤1 ms**, long frames >16.7 ms **<1%**, and no visible hitch during a reference scene of roughly **200 hostile projectiles plus representative combat particles**. Record draw calls, allocations and GPU time where available.
- **Priority:** **P2 / tenth; profile-gated**.

### Work classification summary

| Class | Recommendations | Order principle |
|---|---|---|
| Tuning | 4, encounter values within 8 | Exhaust these after the frame/input contracts make measurement trustworthy |
| Small system improvements | 1, 3, 5, 6, 7 | Highest engineering return; most reuse the existing architecture |
| Foundational | 2, density work within 10 | Action semantics are urgent; density architecture is deferred and profile-gated |
| Polish | feedback component of 5, 9, later audio/time-dilation mix | Preserve and refine the existing visual language rather than multiplying it |

---

## 6. Immediate Pass

If there is one focused implementation pass, do these five things in this order:

1. **Unify sample-to-present under one RAF** and make frame stats cover the final canvas draw.
2. **Write the action cancel/queue table as tests**, then implement typed discrete/held requests for blade, bow and roll.
3. **Normalize movement acceleration in vector space** without losing the current fast brake/reversal.
4. **Aggregate multi-hit screen feedback** and establish camera/recoil caps.
5. **Implement three live-tunable roll landing variants** and run a short 5-player × 5-run A/B protocol using the same reference encounter/replay setup.

The first pass should explicitly **not** add a new VFX framework, rewrite collision into a general physics engine, migrate every particle, or make the perfect-dodge slow deeper. Those changes either lack evidence or distract from the control contract.

Acceptance gate for the pass:

- one RAF and one final canvas render per displayed frame;
- p95 keydown-to-visible response under 25 ms on the target 60 Hz setup;
- no documented next-action request inside 200 ms of eligibility is lost;
- identical acceleration response at cardinal and diagonal angles;
- landing returns at least 25% movement authority immediately and 90% by state tick 20;
- three-target heavy stays within the camera/recoil caps while retaining per-target feedback;
- every active-tick blade and crescent edge exactly matches the sector already tested by simulation;
- all deterministic hashes, 110 existing tests, new tick-table tests, keyboard smoke tests and screenshot strips pass.

If those changes validate in human play, the expected experience is approximately **83–85/100** without adding a new enemy, weapon, shader, or particle class. The exact score depends on whether the new queue contract feels empowering without producing stale actions.

---

## 7. Ideal End State

The target is not “Hades effects” or “Gungeon bullets.” It is the shared quality underneath them:

- A keyboard event becomes visible in the earliest possible display frame, with one measured sample-to-present path.
- WASD has the same acceleration and stopping behavior in every direction. A 90° correction removes drift immediately enough to feel intentional.
- Keyboard-only aim is stable and independent. Mouse/trackpad precision is available the instant it moves, but an idle cursor never steals control.
- A roll starts in the requested direction, travels a learnable distance, passes through bodies, makes its invulnerability legible, and returns meaningful steering on the visible landing. Perfect timing briefly gives the player the world without making the threat visually nonsensical.
- A light attack responds quickly, remains steerable only while it looks steerable, and flows into a deliberate queue. A heavy visibly crosses a commit point, rewards the commitment, and never makes a correctly timed dodge request feel lost.
- One hit has a clean anticipation → contact → freeze → target response → recovery sentence. A crowd hit adds bodies, wounds and sparks, not uncontrolled camera displacement.
- Enemy danger remains readable during the player's most spectacular success. Every damage event can be attributed after the fact.
- Bodies hold stable space, walls slide cleanly, and the player never needs to learn invisible differences between sprite, hurtbox and crowd compression.
- One 60–90 second encounter repeatedly asks the player to move, aim, dodge, cut, choose and punish. Mastery shortens the fight because of better decisions, not because broad-arc mashing happens to dominate.
- Audio, animation, camera and time dilation reinforce the same simulation tick. The full scene holds a stable 60 fps on target browsers with headroom for input, audio and browser variability.

At that point, every limitation reads as a deliberate commitment rather than missing control. The player does not merely see more juice; they trust the game enough to play faster. That is the 90+ state, and it is achievable within the current architecture without turning the project into a different game.
