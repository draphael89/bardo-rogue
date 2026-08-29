# Bardo Rogue — Expanded Game Plan

> **HISTORICAL — superseded by `VERTICAL_SLICE_PLAN.md`.** This audit was written at `1ef5b18`, before the
> production loop was assembled. Its section 1-2 findings (no reward drafting, no boss, no persistence,
> the default URL booting the `full` arena, the Bardo reusing the Crossing) describe a build that no
> longer exists. Read it for the reasoning that led to the slice, not for the state of the game.

Current-tree audit: 2026-08-28, commit `1ef5b18` (`origin/main`). This expands the combat audit in `AUDIT_REPORT.md` against the game that exists now, 21 commits later. The priorities in section 8 supersede the older report's separate strike lists.

## 1. Verdict

The project now has most of the *mechanical proofs* needed for a short action-roguelike loop, but they are not yet assembled into the game a player launches.

- The default URL still boots directly into the three-wave `full` combat scenario, not the town (`src/main.ts:22-29`).
- A Bardo, a two-door room choice, a second combat room, a quiet reward room, a boon, a second weapon, a boss, and death-to-hub return all exist—but as separate scenarios and proofs (`src/sim/scenarios.ts:9-26`; `HARNESS.md:29-37`).
- The `run` scenario proves room clear → marked doors → another room, and the `loop` scenario proves hub → first fight. Neither proves weapon preparation → several rewards → differentiated build → boss → successful return.
- The current Bardo is the Crossing combat room reused without enemies. The hero arrives holding the sword, with five combat hearts and the combat control strip still visible. There is no rack, pickup, town-specific room, or preparation state (`src/sim/rooms.ts:39-45`; `src/sim/world.ts:72-106`).
- The reward path grants one max HP by walking into a vessel. The only boon, `cleave`, is granted only by the isolated `blessed` scenario. There is no offer, choice, stacking, status, synergy, rarity, or run acquisition (`src/sim/offering.ts:4-18`; `src/sim/boons.ts:4-44`).
- Death return is a real and valuable foundation: `run`/`loop` revive inside the same deterministic world, clear the run boon, reset HP, and enter the Bardo (`src/sim/return.ts:6-39`). A successful run has no equivalent conclusion: the Crossing and Shore are terminal, and pressing R while alive rebuilds the scenario rather than completing a run (`src/sim/rooms.ts:25-46`; `src/sim/step.ts:16-21`).

The correct next move is not a large roguelike framework. It is one controlled structural extraction—explicit session/run state plus an explicit room phase—followed by assembling the existing proofs into one four-encounter slice with six composable boons.

There is **one structural reset**, not a rewrite: extract run-lifetime state from the room combat `World` before building reward content. Keep the deterministic sim, input, combat, enemies, room definitions, renderer, replays, and presenter rebuild path.

## 2. What a player can experience today

### Default launch

The player opens on The Threshold with the sword already equipped. Thirty ticks later a three-wave combat begins. Clearing it opens no traversable next room because the default scenario has no exits. The clear prompt asks for R; death also asks for R; both rebuild the same combat scenario.

This is still a combat prototype, not the requested game loop.

### Hidden `?scenario=loop` launch

The player appears in a quiet room named The Bardo. A north door is already open and starts The Threshold. This proves a hub can sit before a run, but visually and mechanically it is not yet preparation:

- the room is the Crossing layout reused;
- the sword is already in hand;
- no rack or interactable exists;
- combat hearts and combat controls remain visible;
- there is one bright exit and no other town affordance.

It reads as an empty combat room before a door, not as home.

### Hidden `?scenario=run` launch

The player clears two Brutes in The Threshold. Two marked exits open:

- north: combat, leading to The Crossing;
- east: gift, leading to The Far Shore.

This is the strongest current roguelike proof. The choice is physical, readable, deterministic, and does not interrupt motion (`src/sim/rooms.ts:25-38,119-134`; `src/render/tilemap.ts:22-112`). It still ends immediately after the chosen destination:

- Crossing contains one Caster and two Chargers, then has no exit;
- Shore contains one +1 max-HP vessel, then has no exit;
- neither path reaches the boon, Warden, or Bardo on success.

### Isolated proofs

- `blessed`: the sword has one wider, longer, harder `cleave` modifier.
- `bow`: the hero begins with a mechanically distinct ranged weapon.
- `boss`: one Warden with a second phase at half health.
- `shore`: one walk-in health reward.
- `run`/`loop`: death then R returns to The Bardo.

These prove the code can support the pieces. They do not give a player build formation or a complete attempt.

## 3. System inventory

| Area | Status | Current evidence | What it means |
| --- | --- | --- | --- |
| Startup flow | Partially built | URL selects a scenario; default is `full` (`src/main.ts:22-29`) | The launch path must point at the real loop, while debug scenarios remain. |
| Player spawn | Already built | Room owns `playerStart`; room entry repositions and clears motion (`src/sim/arena.ts:57-76`; `src/sim/rooms.ts:68-94`) | Keep this. Add town-specific spawn and preparation state. |
| Weapon pickup | Missing but straightforward | Player starts with blade code `0`; no pickup/rack path (`src/sim/weapons.ts:3-18`) | Add a walk-in rack interaction using the offering pattern. |
| Weapon architecture | Partially built | Blade and bow have distinct simulation and presentation paths (`src/sim/weapons.ts`; `src/sim/bow.ts`; `src/sim/player.ts`) | Good proof, but hard-coded branching and `Player.arm` are not yet a scalable loadout system. |
| Dungeon entry | Partially built | Bardo north exit targets Threshold in `loop` (`src/sim/rooms.ts:39-45`) | It needs to require/confirm a chosen weapon and create a fresh `RunState`. |
| Room architecture | Already built at prototype scale | `RoomDef` owns id, kind, waves, exits (`src/sim/rooms.ts:8-21`) | Extend instead of replacing: encounter id, reward spec, tags, and boss/result metadata. |
| Encounter lifecycle | Partially built | Waves are pending/active/done; clear cancels hostile bolts and opens exits (`src/sim/waves.ts:52-102`) | Add explicit reward and exit phases; wave state alone must not become the campaign state machine. |
| Enemy spawning | Already built | Data groups, delays, remaining-count gates, telegraph queue (`src/sim/waves.ts:5-49`) | Keep. Move authored encounter lists out of the global wave file as content grows. |
| Room-clear detection | Already built | Last group + no remaining bodies emits `roomClear` (`src/sim/waves.ts:73-102`) | Reliable base for reward creation. |
| Room transitions | Partially built | Door overlap calls room-by-id; presenter rebuilds tilemap, props, lights, and atmosphere (`src/sim/rooms.ts:103-134`; `src/render/presenter.ts:466-483`) | Add a short transition state and remove reliance on an instantaneous flash. |
| Reward systems | Partially built | One physical +1 max-HP offering (`src/sim/offering.ts:4-18`) | Keep physical pickups for simple resources; boons need a three-choice offer. |
| Upgrade systems | Proof only | One hard-coded bit and one stat resolver (`src/sim/boons.ts:4-44`) | Replace before content scale with stacks plus a few typed effect primitives. |
| Run state | Partially built, foundational gap | Seed, room index, boon bits, returns, weapon, and HP are flat fields on `World` (`src/sim/world.ts:72-106`) | Extract a run-lifetime object instead of adding more fields to room combat state. |
| Death/restart | Partially built | Hub graphs return to Bardo; all other scenarios rebuild (`src/sim/return.ts`; `src/main.ts:76-95`) | Correct fiction exists only in special scenarios. Make it the production rule and add win return. |
| Scene transitions | Partially built | Same Pixi scene is rebound/rebuilt; no title/loading/fade state | Enough for this slice. Add only a short door wipe/fade, not a scene framework. |
| Procedural systems | Minimal | Deterministic gameplay/visual RNG; fixed authored room graph and encounters | Use authored rooms with seeded encounter selection. Do not generate geometry now. |
| Persistence | Missing and foundational for meta only | No local/session storage or save adapter exists | Add a versioned save envelope after `RunState`; persist counters/unlocks, not a tree. |
| Modifier extension points | Partially built | Central player hit resolution, typed sim events, shared friendly/hostile projectiles, one swing resolver | Natural hooks exist for on-hit, heavy-hit, kill, successful-dodge, and projectile-cut effects. |

### Already built and worth preserving

- deterministic pure simulation and replay hashing;
- responsive movement, aim, dodge, sword chain, hit-stop, bullet time, and typed events;
- rooms as data and a working renderer rebuild on room entry;
- wave/encounter definitions, spawn telegraphs, clear detection, and post-clear projectile cleanup;
- physical marked exits, including a real two-way choice;
- one physical offering;
- one modifier proof;
- one mechanically distinct second weapon;
- one two-phase boss proof;
- death card and deterministic return to a named hub;
- strong headless, screenshot, replay, and debug instrumentation.

### Missing but straightforward

- a distinct Bardo room layout;
- a sword rack and walk-in pickup;
- suppression of combat HUD/attacks while unarmed in town;
- default boot into the Bardo;
- room transition fade/wipe;
- route/run summary on victory and death;
- connecting the Warden and existing rooms into the production graph;
- a small versioned save adapter once the state boundary exists.

### Missing and foundational

- explicit `RunState` separate from room combat state;
- explicit room phases: entering, fighting, reward, exits, transitioning, resolved;
- deterministic reward offers and choice input/UI;
- a composable modifier/status/trigger layer;
- run victory and return-to-town semantics;
- room history and a graph traversal record;
- a clean `RunState` versus `MetaState` ownership boundary.

### Premature or unnecessary for this slice

- a full Slay-the-Spire map UI;
- procedural room geometry or a general dungeon generator;
- more than one realm;
- multiple town buildings, NPC schedules, shops, dialogue trees, or environmental story systems;
- a permanent power tree, currencies, keepsakes, aspects, heat, rarity ladders, duo/legendary tiers, or save-resume mid-room;
- more weapons before the sword's build system is proven;
- dozens of boons before six can create and expose synergy;
- mobile/touch support;
- increasing the projectile pool before one representative pattern demonstrates the need.

## 4. Roguelike foundation scorecard

Scores grade the game a player launches today, not isolated scenario potential. A 90 means the exact experienced slice could ship beside the references without structural or experiential excuses.

| Dimension | Score | What prevents 90+ |
| --- | ---: | --- |
| Core gameplay loop | **28** | Default launch is one repeatable arena; the town, branching room, reward, boon, boss, and return are not one loop. |
| Town / home-base clarity | **18** | Hidden behind `?scenario=loop`, visually a reused combat room, sword already equipped, no rack/NPC/building/preparation affordance, combat HUD still active. |
| Run startup | **25** | A door can start Threshold, but default launch bypasses it and no weapon choice or new-run creation is legible. |
| Room lifecycle | **52** | Spawn → fight → clear → open door is solid; reward, exit gating, transition, boss result, and success resolution are absent. |
| Encounter pacing | **42** | Roles and wave gates exist, but idle dies at 8.6s, competent full clears are 30.8–36.3s, and no human pacing study validates tension or recovery. |
| Room-to-room progression | **45** | One two-door branch and one combat transition work; both branches terminate after a single destination and no run goes deeper. |
| Player choice | **24** | One combat-versus-health door choice exists in a hidden scenario. There is no upgrade choice, route plan, weapon choice, or downstream consequence. |
| Reward excitement | **14** | The only in-run reward is +1 max HP; `cleave` is scenario-injected and has no reveal or choice. |
| Build diversity | **12** | A production run can acquire no boon and change no behavior. Blade/bow and `cleave` are disconnected debug proofs. |
| Emergent synergy potential | **23** | Typed events and central combat functions help, but one additive modifier, no statuses, no stacks, and no cross-boon hooks cannot produce discovery. |
| Weapon extensibility | **51** | Bow proves a second moveset is possible, but the player controller and presenter still branch directly on a two-value enum and no loadout/selection contract exists. |
| Run-state architecture | **38** | Some run fields survive room entry and clear on return, but they are mixed into `World`; there is no history, result, pending reward, serialization, or state above a room. |
| Death / restart loop | **50** | The hidden loop returns to a named Bardo in the same world and clears run power. Default death restarts the same room; victory never returns home. |
| Meta-progression readiness | **13** | No persistent save, unlock ownership, versioning, or adapter exists. The deterministic boundary is promising but not an experienced or implemented meta foundation. |
| Replayability | **21** | Seeds change encounter behavior, but content, route, reward, and build remain effectively fixed; there is little reason for an immediate second run. |
| Sense of anticipation | **30** | Marked doors and the clear beat create a glimpse of “what next,” but there is no multi-room escalation, reward reveal, build forecast, realm climax, or successful return. |
| Overall roguelike foundation | **32** | Strong combat/simulation bones and several isolated proofs, but the shipped experience is still a combat prototype rather than a roguelike vertical slice. |

## 5. Room progression decision

### Recommendation: graph-backed Hades doors

Use an authored room graph internally, but expose only the next one or two choices as physical, reward-marked doors after combat. Do not build a full-route map for this slice.

| Criterion | Physical reward doors | Full node map | Graph-backed doors |
| --- | --- | --- | --- |
| Immediacy / combat flow | Excellent | Weakest; opens a planning screen | Excellent |
| Exploration | Strong at room scale | Abstract rather than spatial | Strong now; can add overview later |
| Player agency | Tactical, one step ahead | Strategic, whole-route | Tactical now with real graph consequences |
| Anticipation | High: the door is visible in the room | High: future nodes are visible | High without leaving the action space |
| Strategic planning | Limited | Excellent | Moderate; show reward + threat tier one step ahead |
| Replayability | Good with changing exits | Good with changing graphs | Good with authored graph pools and seed-driven exits |
| Information shown | Next reward/category | Most of the act | Next reward/category and optional challenge mark |
| Implementation cost here | Low; mostly exists | High: graph UI, focus, map state, layout, save | Low-medium: add reward preview/history to current exits |
| Expansion path | Can become repetitive alone | Strong but commits the game to menu planning | Best: optional realm overview can be added later without changing traversal |

Why this fits Bardo Rogue:

1. Combat is the primary verb. The player should finish a kill, read two door symbols in the same frame, and keep moving.
2. Rooms are fixed-camera authored spaces. A physical exit makes the room feel like a place and uses the spatial vocabulary already built.
3. Short, dense runs benefit more from immediate one-step tradeoffs than long-horizon route optimization.
4. The current code already has `RoomExit { dir, to, mark }`, multiple doors, overlap traversal, and a renderer for marks. The lowest-risk path is to deepen that model.
5. The graph remains real in data. `RunState.roomHistory` and seeded graph selection preserve future shops, secrets, rescues, realm branches, and an optional pause-map without forcing that UI now.

Minimum information on an exit:

- reward family: Blade, Veil, Life, or later Currency;
- optional threat mark: ordinary or hard;
- no exact boon name and no multi-room forecast in the first slice.

The reward shown on a door is earned after clearing the destination room. That creates anticipation and a meaningful risk/reward commitment without adding a second choice screen before every fight.

## 6. The smallest high-leverage primitives

### 6.1 Session, run, room

Extract the existing fields; do not create a parallel game.

```ts
interface GameSession {
  meta: MetaStateV1
  preparedWeapon: ArmId | null
  run: RunState | null
  world: World
}

interface RunState {
  seed: number
  weapon: ArmId
  boons: BoonStack[]
  hp: number
  maxHp: number
  depth: number
  roomId: string
  roomHistory: RoomVisit[]
  pendingReward: RewardOffer | null
  result: 'active' | 'won' | 'lost'
}

interface MetaStateV1 {
  version: 1
  attempts: number
  victories: number
  unlockedWeapons: ArmId[] // only blade in this slice
}
```

`World` remains deterministic room combat. `GameSession` owns town/run transitions. Current and maximum health live canonically on `RunState`; entering a room copies them into `World.player`, and leaving or taking damage/a Life vessel copies them back. The first slice may retain one `World` as an optimization, but every transition still exercises this transfer contract so reconstructing a room cannot heal the player or discard an upgrade. Replays should record session commands (choose weapon, choose boon, choose exit) alongside combat input or lower them into the same deterministic input stream.

### 6.2 Explicit room phase

Use one small lifecycle:

```text
entering → fighting → reward → exits → transitioning → resolved
```

The current `WaveState` remains inside `fighting`. `doorOpen` becomes a result of phase rather than an independent campaign flag. This prevents rewards, doors, victory, and waves from racing each other.

### 6.3 Reward offer

A `RewardOffer` is three deterministic boon ids produced from the run RNG and filtered by tags, prerequisites, duplicates, and exclusions. The sim pauses after clear; one common focus/selection command works for keyboard and gamepad; selection mutates `RunState`, then opens exits.

Do not build deity portraits, rarity animation, rerolls, selling, or duo-boon UI yet. Give the single prototype deity a name, a one-line voice, and a consistent stone-card presentation so the reward is authored rather than a debug menu.

### 6.4 Four modifier primitives

Replace the one-off bitmask before adding boon content. The first system needs only:

1. **Stat transform** — reach, arc, timing, projectile speed, knockback.
2. **Apply/consume status** — a fixed small status set with stacks and duration on an enemy.
3. **Trigger** — on hit, heavy hit, kill, successful dodge, or projectile cut.
4. **Emit effect** — prime the next action, spawn a friendly projectile, or produce a bounded area hit.

This is enough to create behavioral combinations without inventing a general scripting language. Keep arbitrary exceptional logic as typed handlers registered by boon id; promote a pattern into data only after two boons genuinely share it.

### 6.5 Six boons, not sixty

The first pool should make the sword change shape, create one status loop, and connect melee to dodge/projectile play:

| Boon | Effect | Primitive proved |
| --- | --- | --- |
| Cleaving Grace | Light swings gain reach and arc; no flat damage bonus | stat/shape transform; evolves current `cleave` proof |
| Ashen Edge | Light hits apply one Brand, max three | on-hit + status |
| Final Judgment | A heavy consumes Brand and bursts once per stack around the target | consume + bounded area effect |
| Between-Step | A successful i-frame dodge primes the next hit to apply maximum Brand | successful-dodge trigger + run flag |
| Mirror Steel | Cutting a hostile bolt reflects a friendly version instead of only deleting it | projectile-cut trigger + friendly projectile |
| Afterimage | A successful i-frame dodge emits a short sword echo that uses weapon on-hit effects | dodge trigger + shared hit pipeline |

Demonstrated discoveries:

- **Ashen Edge + Final Judgment:** lights load a target; the committed heavy becomes a detonation decision.
- **Between-Step + Final Judgment:** dodge through danger, then cash the primed Brand into an immediate heavy burst.
- **Afterimage + Ashen Edge:** aggressive dodges seed Brand across a crowd before the real sword connects.
- **Mirror Steel + Ashen Edge:** if all friendly weapon hits share on-hit effects, reflected bolts can mark targets for a later heavy.
- **Cleaving Grace + Ashen Edge + Final Judgment:** wider crowd marking converts geometry into a room-clear build, not just a larger number.

On-hit trigger priority is deterministic: Between-Step spends its prime and applies maximum Brand first; Final Judgment then consumes the resulting Brand on a heavy; ordinary light-hit Brand applies last. Thus a primed heavy on an unbranded target detonates immediately and cannot leave the prime armed for a later hit.

The system has succeeded only when a tester can identify at least two of those interactions without being told.

## 7. Immediate vertical slice

Target: one complete, replayable attempt of **four encounters**—three combat rooms and the existing Warden—lasting roughly **6–10 minutes** while content is still small.

```text
The Bardo
  → take sword from rack
  → cross the dungeon threshold
Room 1: fixed teaching encounter
  → choose 1 of 3 boons
  → choose 1 of 2 reward-marked doors
Room 2A or 2B: distinct mixed encounter
  → choose 1 of 3 boons from the promised family
  → rejoin the route
Room 3: hard mixed encounter
  → choose 1 of 3 boons
The Warden
  → victory summary → return to The Bardo
Any death
  → death summary → return to The Bardo
```

### Town

- A distinct `bardo` room kind, not the Crossing combat room.
- One weapon rack with one sword and clearly empty future slots.
- Three scenery clusters at most: the rack, the dungeon threshold, and one Bardo-specific focal object.
- No enemies, attacks, combat wave counter, or full combat HUD.
- Walk into the sword to equip it. The north threshold becomes the obvious run entrance.
- The player reads: **home → preparation → way forward** within five seconds and without a banner explaining it.

### Run start

- Crossing the threshold creates a fresh `RunState` with the chosen sword and a deterministic seed.
- HP resets, boons are empty, history begins, and the first authored encounter loads.
- The default game URL launches here through the Bardo. Debug scenario URLs remain for the harness.

### Encounters

1. **Room 1:** two Brutes with enough spacing to teach commitment and punish. No late spawn surprise.
2. **Room 2A:** one Caster plus two staggered Chargers; movement/line management.
3. **Room 2B:** one Brute plus two Casters; target priority and bolt cutting.
4. **Room 3:** one hard mixed encounter assembled from existing enemies, with a clear escalation but no new enemy type.
5. **Boss:** existing Warden, tuned and connected as the endpoint rather than expanded with another phase.

Only four encounters are required because two boon choices are enough to start a build and a third lets the run confirm it before the climax. More rooms would currently repeat content rather than prove a system.

### Room progression

- Room 1 is fixed.
- After its reward, two physical doors preview the reward family in Room 2A/2B.
- Both branches rejoin at Room 3; there is no route map.
- At most two exits are visible. One-step information preserves flow.
- Room 3 leads to a boss-marked door.

### Rewards

- A guaranteed three-boon offer after each of Rooms 1–3.
- Six total authored boons from section 6.5.
- A Blade- or Veil-marked door reserves at least one eligible option from that family in the destination room's offer; combo follow-ups may fill another slot but cannot displace the marked promise.
- The physical Life vessel remains additive wherever it appears; it is not part of the four-encounter loop today and never replaces any of the three guaranteed boon offers. A future route that makes Life exclusive must be scoped and tested as an explicit exception rather than silently weakening this guarantee.
- Selection pauses combat and uses one keyboard/gamepad focus model.
- The chosen boon is visible in a compact run-build strip or pause summary; no inventory grid is needed.

### Synergy proof

Seed the offer rules so every run has a fair chance to see a follow-up to its first mechanic. Do not guarantee one scripted combo, but do prevent three unrelated offers from making synergy impossible.

Success criteria:

- by Room 2, a player can state how their sword differs from the starting sword;
- by the Warden, at least 70% of testers have two boons that interact;
- at least half of testers correctly discover one interaction without tooltip text naming the combo;
- players voluntarily start another attempt to try a different pair.

### Run end

- Death: existing death card adds rooms reached, time, weapon, and boons; one input returns to Bardo.
- Victory: Warden clear creates a parallel run-summary beat, marks `result = won`, and returns to Bardo.
- Run boons, HP upgrades, room history, and seed disappear on return.
- Meta persists only attempts, victories, and unlocked weapons. No permanent damage upgrades.
- The sword returns to the rack so preparation remains legible on the next attempt.

### Absolutely do not build yet

- another realm, weapon, boss, or enemy type;
- a large town, NPC dialogue system, buildings, shops, or permanent upgrade tree;
- a Spire map, procedural room geometry, biome streaming, or save-resume mid-run;
- boon rarity, leveling, rerolls, curses, duo/legendary tiers, keepsakes, or currencies;
- dozens of stat-only boons;
- a general effect scripting language;
- mobile controls or multiplayer.

## 8. Unified top 10 changes

Ranked by expected improvement to player experience, confidence, leverage across systems, and complexity. This is one plan across combat and roguelike structure.

### 1. Ship the authored hero-and-core-enemy asset kit, then revalidate combat at native scale

- **Change:** Integrate the planned 32×32 hero, sword-chain, hit/fall/roll poses, and clear Brute/Caster/Charger silhouettes. Re-enter the parked combat pieces behind those assets.
- **Why it matters:** Nine independent critique lanes converged on authored animation/silhouette as the common ceiling (`gauntlet/ASSET-KIT.md`). Every new room and boon multiplies the visibility of the current placeholder ceiling.
- **Player problem solved:** Attacks, tells, hits, and enemy roles do not yet read with shipped-game clarity or identity.
- **Systems affected:** atlas/manifest, entity views, animation clips, HUD stamps, combat presentation; simulation timings stay authoritative.
- **Expected impact:** Very high—combat feel, readability, identity, reward presentation, and the perceived quality of every future system.
- **Complexity:** Medium-high, but already specified and additive.
- **Dependencies:** Hero style proof passes silhouette and local-contrast gates before batch generation.
- **Type:** Polish with a foundational content-pipeline effect.
- **How we know it worked:** Blind critics prefer the authored swing/roll/tell frames; all core actors meet the art-direction contrast gate; human players identify attack phase and enemy type from a single native-scale frame.

### 2. Human-playtest and retune the first combat before scaling content

- **Change:** Five new players, five attempts each; tune first-death time, room clear time, hit attribution, whiffs, dodge use, and voluntary restarts. Keep bot regressions as guardrails, not fun certification.
- **Why it matters:** Current proxies are out of target: idle dies at 8.6s; competent full clears are 30.8–36.3s; the boss ranges from 7.6s to 117.1s across seeds.
- **Player problem solved:** The game can feel abruptly lethal, too short, or inconsistently paced before rewards have time to matter.
- **Systems affected:** tuning, encounters, enemy timings, boss positioning, metrics/test fixtures.
- **Expected impact:** Very high on trust, combat satisfaction, and the value of every run system.
- **Complexity:** Low-medium.
- **Dependencies:** Authored hero/core tells should be far enough along that tests are not grading known placeholder readability.
- **Type:** Tuning.
- **How we know it worked:** Median new-player first death is at least 30s; skilled Room 1 clear is intentional rather than trivial; 80%+ of damage is correctly attributed; at least 60% voluntarily restart after death.

### 3. Extract `GameSession`, `RunState`, `MetaState`, and explicit room phases

- **Change:** Move weapon, boons, route/history, pending reward, result, and run seed out of flat room state; introduce entering/fighting/reward/exits/transition/resolved.
- **Why it matters:** This is the smallest structural change that simultaneously unlocks boons, rewards, victory, save boundaries, room history, weapon selection, and clean return semantics.
- **Player problem solved:** Existing proofs cannot form one coherent attempt and terminal rooms do not know whether the run won, lost, or merely stopped.
- **Systems affected:** world/session creation, rooms, steps, replay/hash, debug API, metrics, presenter/HUD.
- **Expected impact:** Very high architectural leverage with little visible bloat.
- **Complexity:** Medium.
- **Dependencies:** None; do before authoring boon content.
- **Type:** Foundational change.
- **How we know it worked:** A deterministic automated replay can start in Bardo, choose sword, traverse rooms, choose rewards, die or win, return, and produce the same final hash twice; room combat tests remain intact.

### 4. Make the Bardo the default, distinct, minimal home base with a sword rack

- **Change:** Add a `bardo` room kind, suppress combat state/UI, place a one-sword rack with future empty slots, and make the dungeon threshold the only obvious way forward.
- **Why it matters:** It turns startup and return into fiction and preparation with one room, while making future town growth obvious without building it.
- **Player problem solved:** The current game starts mid-prototype; the hidden hub reads as an empty reused arena and the player never chooses or collects the weapon.
- **Systems affected:** room data/art, session state, weapon pickup, presenter, HUD, default bootstrap.
- **Expected impact:** High on loop clarity, identity, anticipation, and immediate replay desire.
- **Complexity:** Low-medium.
- **Dependencies:** Run/session ownership from change 3.
- **Type:** Small system improvement plus polish.
- **How we know it worked:** In an unprompted test, 90% of players describe the room as home/preparation, find and equip the sword, and identify the dungeon entrance within five seconds.

### 5. Add the six-boon modifier/status/trigger layer and three-choice offer

- **Change:** Implement the four modifier primitives and six boons in section 6, with deterministic filtered offers and common keyboard/gamepad selection.
- **Why it matters:** This is the run-defining system and the largest source of replayability per unit of content.
- **Player problem solved:** Every current run uses the same sword the same way; rewards do not create tactics or discovery.
- **Systems affected:** run state, combat resolution, enemies/status, projectiles, dodge/cut events, UI/HUD, replay/hash, content data.
- **Expected impact:** Very high on agency, build diversity, reward excitement, synergy, and anticipation.
- **Complexity:** Medium-high.
- **Dependencies:** Change 3; reuse current `cleave` behavior as the first migration test.
- **Type:** Foundational system improvement.
- **How we know it worked:** Every boon has an isolated deterministic test; every named pair has an integration test; players can explain their altered sword by Room 2 and discover at least one interaction by the boss.

### 6. Connect four encounters, one branch, and the Warden into a completable run

- **Change:** Build the graph in section 7 from existing rooms/enemies/boss; use two alternative Room 2 encounters, one hard Room 3, and the Warden endpoint.
- **Why it matters:** It converts room, choice, boon, boss, and return proofs into the first actual game.
- **Player problem solved:** Current branches dead-end, the boss is disconnected, and no successful run has a conclusion.
- **Systems affected:** room/encounter data, run graph, phases, rewards, boss result, summary, metrics/harness.
- **Expected impact:** Very high on progression, escalation, anticipation, and replayability.
- **Complexity:** Medium because most content already exists.
- **Dependencies:** Changes 3 and 5; change 2 provides pacing targets.
- **Type:** Small system integration with foundational payoff.
- **How we know it worked:** Production launch can be completed start-to-town without debug APIs; both Room 2 branches work; death and victory both clear run power; 20 seeded automated traversals have no terminal dead-end.

### 7. Turn current door marks into one-step reward and threat previews

- **Change:** Expand `DoorMark` from combat/gift to reward family plus optional hard/boss threat, and make doors open only after the reward is chosen.
- **Why it matters:** It supplies meaningful route choice with almost no interruption and no map UI.
- **Player problem solved:** The current binary icon says fight or health once; it does not let the player steer a build or anticipate the next payoff.
- **Systems affected:** `RoomExit`, graph generation, tilemap marks, room phase, HUD accessibility labels.
- **Expected impact:** High on agency and anticipation.
- **Complexity:** Low-medium.
- **Dependencies:** Changes 3 and 5.
- **Type:** Small system improvement.
- **How we know it worked:** Players correctly predict the destination reward family at least 90% of the time and can state why they chose a door; the decision takes a median under five seconds.

### 8. Add a short deterministic room transition and run-summary handoff

- **Change:** Replace instantaneous room swaps with a brief door-cross/fade/wipe; add death/victory summaries with depth, time, weapon, and boons before Bardo return.
- **Why it matters:** Transitions and conclusions make separate simulations feel like one journey and turn death into story rather than reset machinery.
- **Player problem solved:** Current rooms flash-swap; alive terminal rooms say “run it again”; the successful attempt has no payoff or return.
- **Systems affected:** room phase, presenter, HUD, audio, session result, harness poses.
- **Expected impact:** Medium-high on cohesion, fiction, and replay rhythm.
- **Complexity:** Low-medium.
- **Dependencies:** Changes 3 and 6.
- **Type:** Polish plus small system improvement.
- **How we know it worked:** No frame exposes the old room after transition commitment; a player can recount route/build from the summary; town control resumes within three seconds of confirmation.

### 9. Add a versioned save boundary, not a progression tree

- **Change:** Persist only `MetaStateV1 { attempts, victories, unlockedWeapons }` through a browser adapter with migration/version tests. Keep one unlocked blade.
- **Why it matters:** It establishes the architectural distinction between run and meta progression without committing to permanent power design.
- **Player problem solved:** Today nothing survives reload and the town has no durable relationship to past attempts.
- **Systems affected:** session bootstrap, storage adapter, schema tests, debug reset; no combat sim dependency on browser APIs.
- **Expected impact:** Medium now, high future leverage.
- **Complexity:** Low.
- **Dependencies:** Change 3 and a proven return loop.
- **Type:** Foundational scaffolding.
- **How we know it worked:** Reload preserves counters/unlocks but never preserves run boons or HP; corrupt/old data falls back safely; pure sim tests remain DOM-free.

### 10. Finish the input/accessibility shell needed by choices

- **Change:** Add pause, shared focus navigation, remappable action labels, screen-shake/flash controls, and clear gamepad glyphs for reward and summary screens.
- **Why it matters:** The first modal choice creates the need for a real UI command model; solving it once prevents every future town/menu from inventing input rules.
- **Player problem solved:** Current gameplay controls are good, but there is no pause/options/focus layer and reward selection would otherwise be mouse-first or bespoke.
- **Systems affected:** input commands, HUD/menu UI, settings persistence, postfx/camera toggles, tests.
- **Expected impact:** Medium on usability and future UI velocity.
- **Complexity:** Medium.
- **Dependencies:** Reward UI from change 5; save adapter for settings can follow change 9.
- **Type:** Foundational UI improvement and polish.
- **How we know it worked:** The whole slice is completable with keyboard-only and gamepad-only input; focus is never lost; reduced-flash/shake settings visibly cap effects; prompts match the active device.

## 9. Verification plan

### Automated

- Two seeded session replays: each runs town → weapon → Room 1 → boon → one distinct Room 2 branch → Room 3 → boss → win → town, so Room 2A and Room 2B are each completed in a physically possible attempt.
- Death replay from every combat room: run state clears, meta counters persist, town is safe.
- Reward determinism: same seed/history produces the same legal offer; no duplicates; follow-up weighting is bounded and testable.
- Boon isolation and pair integration tests for all six boons and named synergies, including the exact Between-Step-prime → heavy → Final-Judgment detonation order on an initially unbranded target.
- Graph validation: all nonterminal rooms lead to a result; every exit target exists; boss has a success route.
- Save tests: round trip, old version migration, corrupt payload fallback, no run-state leakage.
- Existing typecheck, full test suite, replay hashes, and browser screenshot captures remain green.

### Human

- Five-second town comprehension: identify home, sword, entrance.
- First-room combat: attribution, trust, time to first death, voluntary restart.
- Reward comprehension: state what each offered boon changes before choosing.
- Build comprehension: state how the current sword differs after Rooms 1 and 2.
- Synergy discovery: observe whether combinations change tactics rather than only damage.
- Door decision: player can explain the promised reward and selected risk.
- End rhythm: after death and after victory, measure whether the player immediately begins another attempt.

## 10. What a 90+ version of this exact slice feels like

The 90+ version is not bigger. It is the same four encounters with almost no friction and no placeholder sentence left between intention and response.

I spawn in a quiet Bardo that could not be mistaken for a dungeon room. The room has one visual sentence: the rack prepares me, the threshold calls me. I take the sword because it has weight and identity in the world, not because a banner says “pick up sword.” The combat HUD wakes only when the run begins.

Room 1 teaches the blade through play. Movement answers immediately; the first light hit is crisp; the heavy is a real commitment; every Brute tell reads before it can hurt me. My first damage is attributable. My first kill is satisfying enough that I want another target before the clear animation has finished.

The reward moment changes the rhythm without feeling like a web modal. The deity/voice has presence, the three choices are legible in one read, and at least two choices make me imagine a tactic rather than compare percentages. When I choose, the sword visibly and mechanically changes on the next swing.

The exits are already part of the room. I understand what each promises and choose in a few seconds. The next encounter tests the choice I made. My build begins to form: a dodge primes a marked heavy; a wider light swing loads a crowd; a reflected bolt becomes my setup instead of only a defensive trick. The combination feels discovered, not prescribed.

Room 3 escalates without becoming clutter. The authored characters remain readable through effects. Sound tells are distinct. The Warden is a climax with stable pacing, clear phases, and a punishable rhythm—not a health bag and not a bot-pathing lottery. My build changes how I solve the fight while the sword's core identity remains intact.

Death is fair, quick, and fictional: the summary tells me what reached me and what I built, then the Bardo receives me. Victory has equal authorship. In either case, the return takes seconds, run power is gone, the rack is waiting, and I already have a different combination in mind.

For this slice to score 90+:

- 90%+ of first-time players complete the town preparation without instruction text;
- 80%+ correctly attribute damage and identify enemy intent;
- no core combat/room/reward piece loses its fair blind comparison on readability, motion, material, or hierarchy;
- the run has no dead air longer than five seconds outside an intentional reward/summary beat;
- at least 70% reach a two-boon interaction and at least half discover one without explicit combo instruction;
- the Warden's skilled clear distribution is stable enough that seed changes create variation, not 10× duration swings;
- both victory and death return to a ready-to-play town in seconds;
- a majority voluntarily begin another run in the same session.

That is the 90+ target: not “all roguelike systems present,” but a short loop in which combat, reward, route, build, climax, and return all make the next action feel irresistible.

## 11. Audit evidence

- `pnpm typecheck`: passed.
- `pnpm test`: **110/110 tests passed** across 9 files in 1.44s.
- `pnpm build`: passed; Vite built 775 modules in 468ms; main bundle 460.39 kB / 145.22 kB gzip.
- Wave 1 idle, seeds 1–8: death at 8.6s on every seed.
- Full naive-melee, seeds 1–8: died on every seed at 16.5–34.4s; reached one or two wave clears.
- Full kite, seeds 1–8: cleared every seed at 30.8–36.3s with 1–3 damage.
- Warden kite, seeds 1–8: six clears around 7.6–9.5s, one 117.1s clear, one death at 19.6s—large instability that must be explained before integration.
- Fresh browser captures inspected: default launch, hidden Bardo, two-door clear, Crossing transition, and Far Shore offering. No page errors were reported.
- Current committed visual evidence inspected: busy combat, boon-modified swing, bow release, Warden windup, death return, and the wave-2 critic/asset-kit verdicts.

The browser frame-time samples produced during concurrent SwiftShader screenshot capture contain startup stalls and are not representative performance evidence. This audit therefore makes no new 60-fps claim beyond the prior performance report. Performance is not the immediate blocker; playable-loop integration, combat readability, pacing, and build formation are.
