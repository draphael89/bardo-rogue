# BARDO — Combat, Feel, and Art Quality Audit

**Date:** 2026-08-29  
**Audited revision:** `49258c8` (`main`)  
**Kind:** independent player-first audit of the current game.  
**Not a closeout.** `COMBAT_FEEL_AUDIT.md` still contains a useful historical baseline (76/100 at `1ef5b18`) and then a 95/100 implementation closeout. That closeout grades *whether the listed systems were built*. This document grades *how combat actually plays*. Those are different questions. The 95 is not the current quality of the fight.

**Overall combat: 68 / 100**  
**Assessment:** Unusually complete melee bones for a slice. Not yet exceptional combat. The gap is not missing juice, missing verbs, or a broken input contract. The gap is that the fight’s truth lives on the floor and in VFX, while the actors — the things a player actually watches — stay too still, too coarse, and too mixed in style to carry a high-end action game.

---

## Bottom line

BARDO already has the combat *architecture* of a serious action game: a pure deterministic sim, one RAF, vector movement, discrete-vs-held input, shared blade sweep, composed screen feedback, honest roll distance, and three enemy verbs that actually ask different questions.

What it does not yet have is combat that *feels* excellent for a human playing the production loop.

The single change that would most improve the game from here:

**Make the actor the tell.** Keep the floor language. Stop treating a three-pose clip as a finished attack. Put every enemy the player meets in the first two rooms on a body that counts down commitment the way the brute’s *floor* already does. Do not add another weapon, another juice layer, or another enemy until that sentence is visible.

That is a presentation-and-animation-architecture problem with a mechanical teaching consequence. Better paintings poured into the current three-phase sampler will still pop. Worse Kenney bodies standing on excellent floor tells will still kill a new player who is watching the sprite.

---

## How this was earned

Played and inspected at `49258c8`. No gameplay code was changed.

**Played**

- Production loop (`/?seed=1`): hub, rack, first-room deaths. A remote play session died twice in about seven seconds to the Fallen Hoplite without being able to name the blow. A second session completed dummy lab and caster-only, confirmed hitstop and the caster aim line, and still failed to finish a full human loop — the north door is a physical overlap, not a click, and that blocked the playtester.
- Isolated: `wave1`, `brute-only`, `caster-only`, `charger-swarm`, `dummy`, `boss` (god + kite).
- I did **not** complete a continuous human keyboard clear of the full production loop. Hub friction and remote input are part of the evidence, not an excuse to skip the fight. The loop was completed by the skilled bot and inspected as posed frames.

**Measured**

| Probe | Result |
|---|---|
| `full` / kite / seeds 1–8 | **8/8** clear, 59.5–67.3 s, 1–4 damage |
| `full` / naive-melee / 1–8 | **0/8**, deaths 14.1–30.4 s |
| `wave1` / idle / 1–8 | **8/8** dead at 9.0–9.3 s |
| `loop` / slice-kite / 1–8 | **6/8** won, 39–48 s; two deaths at Minos |
| `loop` / slice-naive / 1–8 | **0/8**, deaths 19–32 s, two rooms in |
| Held roll vs run, 60 ticks | run 92.6 px/s, roll-spam 90.9 px/s — roll cannot replace running |
| Light | 67 ms startup / 67 ms active / 217 ms recover (350 ms hit, 467 ms whiff), 50 ms hitstop, 25 px / 130° |
| Light 2 | same clock, 150°, opposite sweep |
| Heavy | 200 ms startup / 117 ms active / 400 ms recover (717 ms hit, 950 ms whiff), 133 ms hitstop, 31 px / 215° |
| Roll | 24 px, 217 ms travel, **217 ms i-frames** (whole travel), 117 ms landing |
| Brute tell | 450 ms plant-to-hurt |
| Caster aim | 400 ms, lock at 66% |
| Charger freeze | 267 ms, 150 ms committed |

**Looked at**

- Pose sheet of 35 key frames.
- Tick strips: light chain, heavy, roll, brute tell, caster aim, charger dash.
- Still shots: hub/title, wave 1, mid-`full`, Minos.
- Hero / brute sheets, clip sampler, player/enemy views, tuning, input, step, weapons, boons, rooms, waves.

**Limits.** Audio was muted. No headphones, no physical pad, no target Mac. Cloud SwiftShader. First play session misread several systems (invented a stamina bar, claimed no hitstop, claimed 10-tile knockback). Those claims were discarded after strips and sim measurement. The useful residue from that session is the *confusion*: a new player can die without understanding the blow.

Granola had no BARDO combat meetings. Prior audits were treated as claims to test.

---

## What the game actually is

The default URL is a complete attempt, not a sandbox:

Bardo (unarmed hub) → walk into the rack → Acheron Gate (two brutes) → one of three blade vows → Lethe Cistern *or* Field of Asphodel → vow → Charon’s Landing (pay a heart for a fourth vow, or refuse and owe a shade) → Oath-Bound, then mixed pressure → vow → Hall of Minos (slam / ring / fan, veil break) → return.

Combat verbs in that loop: walk, aim, light, heavy, roll, cut a bolt. One weapon. Twelve vows, three picks (four if you pay). No bow. No contact damage. Only telegraphed hits hurt.

The `full` scenario is a different, longer curriculum (six waves, ~60 s skilled). The production loop is shorter and denser: four rooms, ~40 s when a bot plays it well.

---

## Scorecard

Calibration: 90+ ships next to Hades / Gungeon with no excuses. 70–89 is a strong commercial-indie foundation. 50–69 is a solid prototype with remaining structure. Scores are weighted toward player authority, readability, and whether the fight stays interesting — not toward whether a system exists in code.

| Dimension | Score | Evidence | What blocks 85+ |
|---|---:|---|---|
| Movement | **84** | Vector accel/brake/reversal; 4 / 3 / 2 ticks; diagonal no longer cheats. Feels immediate. | Slightly digital. Almost no coast. Fine for this game; not the gap. |
| Input / responsiveness | **88** | Edge-latched actions, directional pulses, blur clear, modal re-arm, 200 ms discrete buffers, freeze-aware capture, one RAF. | Hub door is a physical overlap a playtester could not find. Not a buffer bug — a teaching/UX hole that blocked the combat proof. |
| Dodge / roll | **73** | Honest 24 px; cannot beat a run; i-frames cover all travel; landing has a steer floor; wall slide is real. | Side travel collapses to a smear. Perfect-dodge / Reversal is rare even for kite (often 1–3 of ~20 rolls). The signature loop is under-expressed. |
| Attack feel | **77** | Light is a readable poke with 50 ms hitstop and a real crescent. Heavy is a *verb*: 200 ms coil, 133 ms freeze, 215° slam, early dodge cancel then a plant. Whiff costs. Shared sweep. | Lights 1 and 2 are the same clock. Body holds one pose per phase. Weight is sold by VFX and freeze, not by the actor. |
| Weapon identity | **48** | Blade has two weights. Heavy can open from free, from light recovery, or from late roll. | One weapon in the loop. Lights are mirrors. Bow exists as `?scenario=bow` and is parked. Boons modify the sword more than they change how you stand. |
| Hit detection / hurtboxes | **91** | `swingProgress` is shared. LOS. Per-swing dedupe. Guard is a facing arc, not a fail-to-register. Dummy knockback scale 0 (so dummy lab lies about shove). | Live knockback on a surviving brute is a tile-scale shove, not a baseball bat. First play notes that claimed 10-tile knockback were dummy-lab and god-mode misreads. |
| Enemy movement / spacing | **80** | Brute walks at you. Caster holds 90–130 px. Charger orbits then commits a lane. Family tell-gap of 8 ticks. | Three spacing games, then they repeat. Furniture is décor more than cover. |
| Enemy attack design | **82** | Three distinct questions plus a guard rule plus a taught boss rotation. No contact damage. Bolt-cut is a real answer to range. | Oath-Bound is the only new *decision* after the first room. Minos is a well-authored pattern machine wearing a Kenney-scale body. |
| Telegraph clarity | **66** | Floor language is excellent: brute rungs, caster line that hardens on the lock tick, charger lane at true hurt width, Warden circle/spokes/fan. | Bodies do not count down. Brute windup holds a raised pose for most of 450 ms. Caster/charger/oathbound are Kenney puppets. A player watching actors — the correct habit — dies confused. Debug overlay makes the fight look solved; that must not be mistaken for player readability. |
| Impact / juice | **81** | Hitstop 3 / 8, action-level camera caps, contact crescent + wound, kill shatter, hurt red, composed not stacked. | Adequate-to-good. Not the limiter. More particles will not make the sword feel heavier. |
| Animation | **56** | Right contract: sim owns time, clip names contact. Brute attack clip has five frames. Hero swings have three. | `swingClipFrame` uses first / contact / last. Extra cells in a sheet are ignored. Side roll is three poses; travel is a smear. Mixed pipelines (authored sheets, Kenney, ASCII roll table, code-drawn Minos). |
| Player readability | **68** | Authored 32 px hero, three viewpoints, sword in the drawing. Silhouette is a fighter. | Early generation art. Two-frame run. Three-pose swings. Dark floor eats the maroon body. North/south vs side can pop on diagonals even with hysteresis. |
| Enemy readability | **64** | Brute is a real silhouette and the only authored enemy. Floor tells are classy. | Caster, charger, oathbound, and stock warden still share Kenney Tiny Dungeon indices (`SPRITE` in `views/shared.ts`). Oath-Bound is a tinted brute. The elite’s rule is mechanical, not visible as a held shield. |
| Difficulty / fairness | **70** | Skill gradient is real: idle dies in 9 s; mash dies; kite clears. Deaths are attributable *if* you watched the floor. | Production Room 1 is **two** brutes (`SLICE_ROOM_1`) while comments still say it teaches one body. First human deaths feel random. 5 HP, 1 damage, 40 hurt i-frames — a short, punchy life that punishes unread tells. |
| Interesting play | **69** | Spacing + punish beats mash. Bolt-cut, heavy interrupt, flank/burn/commit on the elite are real. | Dominant skilled policy is kite and poke. Reversal is a beautiful system that typical play barely sees. Lights do not ask different jobs. |
| Combat over a run | **58** | Three vows, a branch, a toll, an elite, a judge. The loop exists. | ~40 s skilled. Same three tells. One weapon. Boons are mostly on-hit riders. The fight does not transform; it accumulates modifiers. |
| Presentation cohesion | **52** | Lighting, grade, floor tells, and contact language share a hand. | The roster does not. Authored hero + Kenney wizard + code-drawn judge + procedural charger is not one combat cast. |
| **Overall** | **68** | Bones of a great melee game; experience of a strong prototype. | Actors, clip vocabulary, first-minute teaching, one-weapon loop. |

**Why 68, not 76 or 95.** The 76 historical audit was about broken input, two RAFs, diagonal cheat, and additive camera. Those are largely fixed. The 95 closeout then scored the *repair*. This audit scores the *fight*. A game can have a truthful action queue and still have a sword whose body does not sell the swing. That is where BARDO is.

---

## What is already excellent

Do not rebuild these.

**1. The sim / present split, and the numbers file.**  
`src/sim/` is still the truth. Presentation reads state and events. Every feel number that matters is in `src/tuning.ts`. This is why agents can iterate without inventing a second clock. It is the best asset in the repo.

**2. The input contract.**  
Discrete taps queue; holds only sustain a chain; releasing does not spawn a phantom swing; dodge during travel is not a second roll; heavy has its own request; roll wins, then heavy, then light. That is how commitment should work. The 76-audit buffer death is gone.

**3. Shared blade truth.**  
The crescent and the hurt sector consume `swingProgress`. Contact pose is asserted to the live window. This is the correct way to take high-quality attack art later. Do not invert it (do not let sheets own timing).

**4. Floor telegraph grammar.**  
Brute rungs march to the hurt tick. Caster line searches, then hardens on `casterLockTick`. Charger lane is the true dash width and ignites when aim locks. Warden speaks in circle, spokes, and fan. These are not placeholder circles. They will survive better sprites. They are why the *systems* of readability are good even when a first playthrough fails.

**5. Three enemy verbs, not three statlines.**  
Brute = commitment and punish. Caster = cross or cut. Charger = count the freeze, leave the lane. Oath-Bound adds one rule (guard: heavy, flank, or burn). Minos rotates slam / ring / fan and changes cadence at half. This is real encounter design. Do not add a fourth ordinary walker.

**6. The roll’s *mechanical* promise.**  
24 px, full-travel i-frames, ghost through bodies, landing steer, cannot beat a run. That is a dodge, not a second sprint. Keep it.

**7. Composed impact.**  
Screen kick is per action with a sqrt crowd cap. Freeze takes max, not sum. Guarded hits whisper. Kills get a release without washing the next tell. The juice *systems* are already in the right shape.

**8. The skill gradient.**  
Kite clears; mash dies; idle dies in wave 1. That is the correct shape. Do not flatten it with HP inflation.

---

## What is merely adequate

These work. They are not why someone would replay the room for the feel.

- **Light attack.** 67 ms to contact, 50 ms freeze, a bright crescent. It pokes and confirms. It does not yet have a body that coils, lands, and recovers as a sentence.
- **Movement.** Sharp and reliable. A little dead at the top of the stick — on/off rather than pressure — but keyboard-first is a chosen fit.
- **Hitstop and camera.** Present, ranked, capped. You can see freeze 3 and freeze 8 on the strips. They are not missing. They are also not carrying the game.
- **Boon layer.** Twelve vows, two powers, one reachable duo. They change numbers and a few verbs (cleave arc, bolt reflect, roll echo, burn dropping a guard). They do not yet make two runs *feel* like different weapons.
- **Minos as a pattern teacher.** The contract is good. The body is not. The fight is learnable from floor geometry. It is not yet a character.

---

## What is actively weakening the experience

### 1. The actor is not the tell

**Observed.** Brute windup strip: the hammer stays up while `windup` ticks 0 → 18. The floor rungs (when they draw) are the clock. Caster: Kenney wizard + pink line. The line is excellent; the body is a tint and a squat. Charger: Kenney critter + red lane. The lane is excellent; the body is a vibration. First play session: dead in ~7 s, could not name the blow, until F1 printed `telgr / windup / raise`.

**Why it matters.** High-end action games teach with silhouettes. Gungeon’s jammed gun, Hades’ coil, a Dark Souls raise — you look at the *thing*. BARDO taught the *floor*. That is a valid bullet-hell move, and the floor work is good. It is not enough when the player’s attention is on the 16–32 px actor, which is where it should be.

**Art or structure?** Both, and they do not excuse each other. Kenney caster/charger/oathbound is unfinished art. A brute that holds one raised pose for most of 450 ms is a **clip and staging** problem. The floor tell will not be fixed by a prettier still. A painted Kenney-scale wizard without a body countdown will still fail the first-minute test.

**Target.** Greyscale the frame, crop out the floor marks, and you can still say *when* and *what*. The brute already has the right *idea* in its five-frame attack clip (`windupEarly, windupCommit, release, contact, recover`). The hold is too long on one cell. Caster/charger need that idea at all.

### 2. The clip sampler cannot use better animation

**Observed.** `swingClipFrame` returns `frames[0]` for the entire startup, the contact name for the entire active window, and `frames[last]` for recovery. Hero clips are exactly three names. Heavy recovery *aliases* `heavyStart`. Adding in-between cells to a sheet today does **nothing**.

**Why it matters.** This is the trap the art pipeline will walk into. You can spend a month painting a six-frame greatsword and the game will still show three stills. The 95 closeout called animation 95 because contact is truthful. Truthful and *expressive* are different. Exceptional combat animation is anticipation that *moves*, contact that *lands*, recovery that *returns the feet* — several drawings inside each sim window, still slaved to `stateTick`.

**Art or structure?** **Architectural.** Incoming high-quality art will not solve it. The sampler has to change first, or the art will be wasted.

**Target.** A clip may list N frames inside startup / active / recovery. The sampler maps them across the *sim* window. Contact remains the asserted frame on the first live tick. Sheets that still have three names keep working.

### 3. The side roll loses the body

**Observed.** Dodge strip, ticks 1–13: the fighter becomes a dark horizontal smear. Vertical rolls have a four-key tumble (`bardo_hero_*_roll`). Side uses the three-phase dodge clip plus lean. Mechanical travel is exact (24 px). Visual travel is a blob.

**Why it matters.** The roll is one of three verbs. If it does not read as a body turning over, the player cannot see i-frames, heading, or the landing. They will either spam it as a panic smear or ignore it and run — which is already the better travel.

**Art or structure?** The north/south rolls show the intended language. The side axis was left on a thinner clip plus a leftover ASCII pose table in `views/player.ts` (`ROLL_ART`) that authored blade play no longer uses for the body. **Structural leftover + thin clip**, not “we need more i-frames.” I-frames already cover the whole travel. Adding more safety would make the smear *more* dominant.

**Target.** A side roll that is four readable silhouettes, weapon continuous, travel still 24 px. Do not lengthen i-frames.

### 4. Production Room 1 teaches the wrong lesson

**Observed.** Comments in `waves.ts` say Room 1 teaches commitment. `SLICE_ROOM_1` spawns **two** brutes. `full` wave 1 is one brute. Idle dies to one brute in 9 s. A human in the loop meets two, with Kenney-scale / still-pose tells, 5 HP, 1 damage.

**Why it matters.** The first death should teach “the raised hammer is the clock.” Two overlapping 450 ms slams teach “the room is random.” That is how you get seven-second deaths and a player who never learns the floor language you spent so much care on.

**Art or structure?** **Content.** Cheap to fix. Do not wait for art.

**Target.** One brute, full tell, a punish, the door. The second body arrives in the branch or at Charon’s Landing.

### 5. Lights 1 and 2 are one attack

**Observed.** Same startup, active, recovery, damage, radius, hitstop, move scales. Differences: 130° vs 150°, sweep +1 / −1, 13 vs 15 px lunge.

**Why it matters.** A three-hit chain that is really “poke, poke-the-other-way, slam” has no mid-chain decision. The heavy is the only identity beat. That is why mash-and-backpedal showed up in god-mode notes, and why kite can solve the slice with lights and spacing.

**Art or structure?** **Design.** New frames will not invent a job for light 2. Give it a job (step-in, tighter arc, shorter recover on hit, or a different recover that sets up the heavy) or stop calling it a chain.

### 6. The signature counter is almost never the fight

**Observed.** Kite on `full`: 18–25 rolls, **0–7** successful pass-throughs (often 1–3). Grazes are common (10–19). Reversal is twenty player ticks of 25% world speed after a *true* overlap. It is a lovely system. Typical skilled play is “don’t be there.”

**Why it matters.** The closeout treats Reversal as the combat signature. If a competent policy almost never earns it, the signature is a trick, not the loop. Exceptional combat is a loop you *do*, every room.

**Art or structure?** **Design / teaching.** Do not widen i-frames. Do not deepen the slow. Either stage one charger or one bolt so the first rooms *ask* for a pass-through, or accept that the signature is spacing and stop dressing the game as a counter-sim.

### 7. One weapon, and the second one is a debug room

**Observed.** `ARM.blade` / `ARM.bow`. Loop rack grants the blade. Bow is `scenario=bow`. Gauntlet piece `arm` is parked: two rounds lost, re-enter behind authored bow art.

**Why it matters.** Vision says every weapon has a distinct feel. Today the game has a sword with two timings. That is allowed for a slice — if the sword is exceptional. It is not exceptional yet. Shipping a second weapon into the current clip sampler would multiply a thin animation contract.

**Art or structure?** Missing content, correctly parked. Do not unpark it to paper over the sword.

---

## What is missing (and should stay missing for now)

| Missing | Verdict |
|---|---|
| Second weapon in the loop | Defer until the sword’s body sells weight. |
| Gungeon-density bullets | The 64-pool is honest. Density architecture is still correctly deferred. |
| Contact damage | Keep off. The tell budget depends on it. |
| Lock-on as the default | Soft assist + optional Q lock is enough. Do not become a lock-on action game. |
| More enemy kinds | Four questions (three verbs + guard) plus a judge is enough until those four *read*. |
| More juice classes | Already composed. Adding a new hit style would hide the actor problem. |
| Rewriting collision / input / RAF | Done. Leave them. |

---

## Art versus structure — explicit split

**Will be largely fixed by high-quality art (if the sampler can play it)**

- Hero paintings that look early-generation, maroon-on-slate contrast, two-frame run.
- Kenney caster, charger, oathbound, dummy.
- Code-drawn / Kenney-tinted Minos body.
- Room tiles that still lose a still-frame comparison to Gungeon.
- Bow and arrow presentation (already parked on this).

**Will not be fixed by better paintings alone**

- Three-phase `swingClipFrame` / `dodgeClipFrame` ignoring extra cells.
- Brute windup that holds one pose while the floor does the acting.
- Production first room with two brutes.
- Light 1 ≅ light 2.
- Side roll travel as a smear.
- Oath-Bound sharing the brute sheet so the shield is a rule, not an object.
- Reversal rarity in actual play.
- One weapon in the loop (content, not art).
- Hub door as an invisible overlap (UX).

**The cohesion problem.** The eventual bar is one cast: player, enemies, weapons, tells, impact. Today the *language* of danger is unified on the floor and split in the actors. High-quality art must be aimed at the actor contract, not at another lighting pass on the room.

---

## Grades against the north star

The north star is not “combat works.” It is dynamic, responsive, readable, expressive, exceptionally polished.

| North-star word | Now |
|---|---|
| Dynamic | Partial. Crowds are staged. The player’s own chain is two pokes and a slam. |
| Responsive | **Yes**, at the input layer. |
| Readable | Floor: yes. Bodies: no. First minute: no. |
| Expressive | Heavy, bolt-cut, guard-break, and Reversal are expressive *as systems*. The actor does not perform them. |
| Polished | Juice and input are polished. The cast is not one piece. |

The previous closeout’s 95 described a game whose *contracts* are tight. This audit describes a game whose *performance* is not yet a performance.

---

## Sequenced roadmap

### Do now — foundations, before more art spend on the sword

**N1. Teach one body in production Room 1.**  
Change `SLICE_ROOM_1` to a single brute. Keep two-brute pressure for a later room.  
*Cause:* first deaths do not teach.  
*Target:* the first death is “I stayed in the rungs.”  
*Change:* spawn list. No new system.

**N2. Let clips have in-betweens inside sim windows.**  
Extend `swingClipFrame` / `dodgeClipFrame` / `bruteAttackClipFrame` so N frames map across startup, active, or recovery, with contact still forced on the first live tick. Keep three-name sheets valid.  
*Cause:* the art pipeline cannot express weight.  
*Target:* a six-frame heavy can exist without desyncing the hitbox.  
*Change:* `clipSelect.ts` + tests in `tests/render/clip-boundaries.test.ts`. This is the one structural edit that future art depends on.

**N3. Stop leaving side roll on a travel smear.**  
Use the same four-phase body language as the vertical rolls, or a four-frame side roll clip, still slaved to `dodge.travel`. Delete or quarantine the unused ASCII `ROLL_ART` combat poses so there is one body owner.  
*Cause:* a core verb disappears as a silhouette.  
*Target:* a still of tick 6 says “roll,” not “smudge.”  
*Change:* clip + sampler, not more i-frames.

**N4. Give light 2 a job or collapse the chain.**  
If it stays, it must change spacing or recover — not just sweep the other way.  
*Cause:* the chain has no mid decision.  
*Target:* the player can say what light 2 is *for*.  
*Change:* tuning first; only then frames.

Do **not** in this pass: new VFX framework, second weapon, i-frame buffs, deeper bullet-time, collision rewrite, particle batching.

### Do with the incoming art — same clocks, better bodies

**A1. Caster and charger authored clips on the *existing* tell clocks.**  
Lock tick, lane width, bolt speed stay. The body must plant / tremble / release on those ticks. This is the highest-leverage art spend for combat.

**A2. Hero swing in-betweens** once N2 ships. Coil that *moves*, contact that matches the crescent, recover that puts the feet back. Three viewpoints, one vocabulary.

**A3. Oath-Bound as a held shield, not a bronze brute.**  
The rule is good. It must be visible as an object with a facing arc, and fire must visibly drop that object.

**A4. Minos as a judge, not a hooded grunt.**  
Keep slam / ring / fan geometry. Replace the body so the plant *is* the slam tell.

**A5. One pass on player/floor contrast.**  
Maroon-on-slate is losing the fighter. Palette already has bone / gold / cope — use them on the hero’s lit edge, not another vignette.

### Deliberately defer

- Bow / second weapon, until the sword’s body is the reason to play.
- New enemy kinds.
- Gungeon-scale projectile pools.
- More vows that only add on-hit numbers.
- Room beauty loops (eleven rounds already lost).
- Rewriting input, RAF, movement, or feedback composition.
- Tuning Reversal depth/length until rooms actually ask for a pass-through (then tune the *staging*, not the reward).

---

## Highest-priority weaknesses — cause, target, parsimonious fix

### P0 — Actors don’t perform the fight

- **Cause:** Floor tells and VFX are authored; bodies are stills, Kenney, or three-pose clips. The sampler cannot play more.
- **Ideal:** You read the next hurt from the enemy’s spine and the next opening from your own recovery silhouette.
- **Fix:** N2 then A1–A4. Do not add a new telegraph FX layer on top of Kenney.

### P0 — First minute is unfair

- **Cause:** Two brutes + still-pose windup + 5 HP.
- **Ideal:** First death is a lesson. Second attempt is a punish.
- **Fix:** N1. Same brute, same 450 ms, one body.

### P1 — Side roll and light 2 have no identity

- **Cause:** Travel clip is a smear; lights share a clock.
- **Ideal:** Roll is a visible tumble you choose; light 2 is a different stand.
- **Fix:** N3 and N4. No new verbs.

### P1 — The advertised signature is not the loop

- **Cause:** Competent play avoids overlap; Reversal stays a jackpot.
- **Ideal:** Either the first charger/bolt *asks* for a pass-through, or the game is honest that spacing is the signature.
- **Fix:** Stage one forced read in Room 2 (veil path already has casters/chargers — *teach* the cut and the lane there, after Room 1 is one brute). Do not buff the reward.

### P2 — Weapon identity

- **Cause:** One sword, two timings, bow parked.
- **Ideal:** The slice is a greatsword game that people replay for the sword.
- **Fix:** Finish the sword’s body (A2). Then, and only then, put the bow in the rack.

---

## What the 95/100 closeout got right — and what it hid

Right: the 76-audit defects (double RAF, dying buffers, diagonal accel, late roll land, stacked camera, soft separation, aim chatter) are largely gone. Tests and bots prove the contracts.

Hidden: those contracts are not the experience. A truthful queue makes a still pose *reliably still*. Composed juice makes a Kenney wizard *reliably sparkle*. The closeout scored the plumbing. The player scores the performance.

Use the closeout as a regression list. Do not use it as a quality rating.

---

## Reproduction

```bash
# balance
pnpm sim -- --scenario full --bot kite --seeds 1-8 --ticks 10800
pnpm sim -- --scenario full --bot naive-melee --seeds 1-8 --ticks 10800
pnpm sim -- --scenario wave1 --bot idle --seeds 1-8 --ticks 10800
pnpm sim -- --scenario loop --bot slice-kite --seeds 1-8 --ticks 18000
pnpm sim -- --scenario loop --bot slice-naive --seeds 1-8 --ticks 18000

# motion (dev server on :5173)
pnpm poses -- --out /tmp/bardo-audit/shots/poses.png
pnpm strip -- --scenario dummy --eval "near(first(), -18, 0)" --hold '{"attack":true,"attackHeld":true,"aimX":1}' --frames 24 --every 1 --crop player,200,140 --out /tmp/bardo-audit/strips/combo.png
pnpm strip -- --scenario dummy --eval "near(first(), -18, 0)" --hold '{"heavy":true,"aimX":1}' --frames 28 --every 1 --crop player,200,140 --out /tmp/bardo-audit/strips/heavy.png
pnpm strip -- --scenario dummy --hold '{"dodge":true,"moveX":1}' --frames 22 --every 1 --crop player,180,120 --out /tmp/bardo-audit/strips/dodge.png
pnpm strip -- --scenario brute-only --eval "until(() => first() && first().state==='windup', 400); near(first(), 0, 40)" --frames 16 --every 2 --crop player,220,160 --out /tmp/bardo-audit/strips/brute-tell.png
pnpm strip -- --scenario caster-only --eval "until(() => first() && first().state==='aim', 400)" --frames 14 --every 2 --out /tmp/bardo-audit/strips/caster-aim.png
pnpm strip -- --scenario charger-swarm --eval "until(() => firstIn(['freeze']), 500)" --frames 16 --every 2 --out /tmp/bardo-audit/strips/charger-dash.png
```

---

## Continuation

The logical next work is N1 + N2: one brute in the gate, and a clip sampler that can play the art you are about to pay for. Everything else in this document is context for that choice.
