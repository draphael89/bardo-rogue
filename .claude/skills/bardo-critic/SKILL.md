---
name: bardo-critic
description: >-
  The Bardo Rogue judging layer for the /gauntlet harness. /gauntlet owns the loop (blind critics,
  both exhibit orders, one gap per round, PARKED after two stalls). This skill owns what the harness
  cannot know about this game: how each piece is rendered for judgment with pnpm shot / poses / sim,
  the fixed rubric axes scored every round, the automated gates computed from pnpm sim and
  frameStats, the one-gap output contract, the lane and owns map, and the stall-then-split rule.
  Use it when writing gauntlet/wave-args.json, capturing evidence, judging a wave, or when a piece
  has lost twice in a row. Triggers: "gauntlet", "critic", "evidence protocol", "blind compare",
  "wave-args", "biggest gap", "stalled", "parked", "which piece next", "is it fun yet".
---

# Bardo critic: evidence, rubric, gates

Read `VISION.md` section 1 first. The bar splits by piece: Hades for the loop, town, boons, and
writing; Enter the Gungeon for combat density, bullet patterns, and the pixel-art dungeon look.
Judge against the real games, never against "good for a web game" or "good for AI".

## 1. Rules that hold for every piece

- The dev server must already be on :5173. `pnpm shot` and `pnpm poses` never start it.
- Always `--stepwise 1`. Free-run overshoots by up to 4 ticks and the round-over-round diff turns to noise.
- Fixed seed, fixed tick, fixed scenario per piece, chosen before wave 1 and never changed.
- Anything that moves gets a frame strip, never a single still. A still hides bad motion.
- Feel pieces get numbers next to the images: startup, active, and recovery ticks from
  `__game.state()`, hit-stop ticks, `frameStats()` p95.
- Reference stills live in `gauntlet/evidence/reference/` with neutral names (`ref-combat-01.jpg`).
  A filename with the bar's name in it leaks to the critic and `check-args.mjs` rejects it.
  `public/progress/ref/` has files named after the games; copy them under neutral names.
- The critic sees evidence files only. No source, no builder notes, no tuning numbers as prose.
- Never copy the reference's composition. Rounds 4 to 11 of the arena mirrored the reference room
  prop for prop. That is an automatic gap under the Originality axis, not progress.

## 2. Evidence protocol per piece type

Paste the matching block into `pieces.<id>.protocol`. `<E>` is `gauntlet/evidence/<piece>/w<N>r<M>/`.

**Still look** (arena, HUD, title, death card, boon screen)
```
pnpm shot -- --scenario <scenario> --seed 1 --ticks <tick> --stepwise 1 --out <E>/still.png
```
Then a 4x crop of the focal region (`node tools/zoom-tiles.mjs` for tiles, or `sharp` extract) as
`<E>/crop.png`. Two files, same crop box every round.

**Motion** (sword chain, dodge roll, hit impact, kill, each enemy telegraph through recovery)
```
pnpm poses -- --only <swing|dodge|brute|caster|charger|kill> --out <E>/poses.png
```
plus a strip of 8 to 12 frames every 2 ticks from a fixed start, posed with
`pnpm shot -- --scenario <s> --seed 1 --stepwise 1 --ticks <T+2k> --eval "__game.setInput({...})"`,
stitched left to right into `<E>/strip.png`. There is no strip tool yet; the first motion piece's
builder adds `tools/strip.ts` (harness work, in its `owns`). Record the tick numbers in `notes`.

**Behavior** (enemy AI, wave pacing, boss phases)
```
pnpm sim -- --scenario <s> --bot <idle|naive-melee|kite> --seeds 1-8   > <E>/sim.json
```
plus the motion strip of the telegraph and a `__game.state()` trace sampled every 10 ticks over
600 ticks into `<E>/trace.json`. The critic reads tell-to-damage time and punish windows from the
trace, not from the builder.

**Performance** (any piece that adds projectiles, particles, filters)
`frameStats()` p50/p95/max via `--eval` on the heaviest scenario, and `maxTickUs` from `pnpm sim`,
written to `<E>/perf.json`. A beautiful frame at 24 fps loses.

**Audio** (sfx, music, mix)
No image can judge sound. Evidence is the event-to-sound map (`src/audio/sfxMap.ts` wiring as a
table), gain and ducking curves as numbers, and a 10 s `OfflineAudioContext` render if one exists.
The critic judges structure and levels, says so, and scores with lowered confidence.

## 3. Rubric: the same seven axes, every round, 0 to 5

Score all seven every round so round 11 is comparable to round 1. If no axis moves for two rounds
the piece is stuck by arithmetic, not by feel.

1. **Readability.** One frame tells you what is happening and what will hurt you.
2. **Material and light.** Surfaces have weight; light has a hierarchy and a focal point.
3. **Feel chain.** Anticipation, contact, impact, recovery all present and proportionate.
4. **Composition.** A focal point, asymmetry with intent, nothing grid-snapped by accident.
5. **Pixel integrity.** Grid-aligned, integer scale, no shimmer, one consistent sprite scale.
6. **Density.** How much is happening per second compared with the bar.
7. **Originality.** A fan of the reference would not call it a copy.

## 4. Verdict and gap contract

Closed vocabulary, no prose lists. The critic returns:

```json
{ "professional": "A" | "B" | "cannot_tell", "confidence": 1-5,
  "axes": { "readability": 0-5, "material": 0-5, "feel": 0-5, "composition": 0-5,
            "pixel": 0-5, "density": 0-5, "originality": 0-5 },
  "biggest_gap": { "element": "<one noun phrase>", "stronger_does": "<what the stronger exhibit does>",
                   "fix": "<one direction>", "repro": "<file, frame index or tick where it shows>" } }
```

One gap. The builder fixes that one at the root. A gap without a `repro` is rejected.

## 5. Automated gates, run before any critic

A failing gate is a loss and costs no critic tokens. Gates are **scoped**: universal gates run on
every piece; balance gates run only on pieces whose `owns` includes `src/sim/waves.ts`,
`src/sim/scenarios.ts`, `src/tuning.ts`, or an enemy file. A HUD or audio piece is never failed by a
balance number it does not control.

**Universal — every piece, every round.**

- `pnpm typecheck && pnpm test` green. If `src/sim/` or `src/tuning.ts` changed, the replay hashes
  were re-pinned with `pnpm record-bots`, never by hand.
- Determinism: the fixture hash from `pnpm test` equals `__game.hash()` after `__game.replay()` of
  the same fixture in the browser.
- Perf: `frameStats()` p95 at or under 16.6 ms and `maxTickUs` at or under 2000 on the heaviest
  scenario in the piece's protocol.
- No silent drops: zero `poolOverflow` events across the piece's scenario run. A pattern that looks
  like it fired while bullets were dropped is an invisible correctness bug, and it appears exactly
  when the screen is busiest.

**Balance — only for pieces that own balance.**

- Floor: `pnpm sim -- --scenario wave1 --bot idle --seeds 1-8` — `deaths` is 1 on every seed.
- **Variance.** `pnpm sim -- --scenario full --bot kite --seeds 1-8` — `clearSeconds` spread
  (max minus min) at or above 6 s, AND `damageTaken` not identical across all 8 seeds. Today the
  spread is 5.5 s and `damageTaken` is exactly 4 on every seed: the room is solved and memorizable,
  which is the deepest fun deficit in the slice. Seeds must change the fight, not the décor.
- Dodge economy, measured directly rather than through a bot's policy: (a) roll travel speed
  (`dodge.distance / dodge.ticks * 60`) must not exceed `player.maxSpeed` by more than 20 percent —
  today it is 146.7 px/s against 95 px/s, a 54 percent free-travel bonus that makes rolling strictly
  better than running; (b) a never-attacking dodge-spam bot must die in `full` within 60 s — today it
  survives a 120 s cap because a rolling player is uncatchable by melee.
  Report `successfulDodges / dodges` every round but never fail a piece on it. Measured at 0.03 for
  the kite bot, because that bot rolls away from a telegraph rather than through an attack: the ratio
  describes the bot's policy, not the game's design. The old skill asserted a 0.6–0.8 band that had
  never been measured against a real run.
- Skill gradient: `kite` clears at least 6 of 8; `naive-melee` clears at most 3 of 8. The room must
  still separate a punish policy from a mash policy.

**Struck, with the reason, so no future agent re-adds them.**

- ~~`clearSeconds` in 60 to 120 on at least 6 of 8 seeds.~~ Measured 37.8–43.3 s by four independent
  audits. The gate is unpassable, and the only ways to pass it are HP inflation or filler waves —
  both forbidden by `VISION.md` §2 ("no padding, no filler rooms"). One room clearing in ~40 s is the
  right order of magnitude inside a 25–45 minute run. Duration was never the defect; variance is.
- ~~`naive-melee` first death after tick 1800.~~ Measured 19.5–21.8 s, but `bots.ts:44` only dodges
  brute windups and never charger dashes, so the naive bot is a worse proxy than a new player.
  Report the number every round; never fail a piece on it.

Bots are regression probes, not players. No gate here proves fun. Fun is proven by a human playing
five runs and reaching for the sixth unprompted — that is a checkpoint the loop cannot run for you.

## 6. Lanes and owns

Coupled state shares one lane and runs one piece at a time. Six parallel agents on one coupled
system make defects go up; one owner cuts them by half.

| lane | pieces | owns |
| --- | --- | --- |
| visual | arena look, lighting, atmosphere, post-fx, tilesets | `src/render/{tilemap,light,postfx,atmosphere}.ts`, `src/sim/arena.ts`, `tools/make-bardo-tiles.ts`, `public/assets/sprites/bardo_*` |
| feel | sword chain, dodge roll, hit impact | `src/sim/{player,combat}.ts`, `src/tuning.ts`, `src/render/{views,presenter,particles,camera}.ts` |
| brute / caster / charger | one lane each | `src/sim/enemies/<kind>.ts` plus that kind's block in `views.ts` |
| pacing | waves, boss, run structure | `src/sim/{waves,scenarios}.ts` |
| ui | HUD, title, death card, meta UI | `src/render/hud.ts`, `src/render/damageNumbers.ts` |
| audio | sfx, music, mix | `src/audio/**` |

A builder that needs a file outside its `owns` stops and reports; it does not edit it.

## 7. Order of proof and the stall rule

`VISION.md` section 5 is fixed: prove the sword before the room is pretty. Wave 1 is the feel lane
and the three enemies, all motion pieces with strips. The arena look re-enters only after an art
direction document exists (palette, materials, light, silhouette language, what the bardo looks
like). Without one, every arena round guesses, which is what eleven rounds proved.

/gauntlet parks a piece after two stalls. When it does, never re-polish. Do exactly one of:

- **Split.** The piece was too big to judge (an empty room is a composition, a lighting model, a
  tileset, and a prop set). Judge the parts.
- **Change the tool.** Code-generated 16 px tiles could not produce material weight in eleven
  rounds. Switch pipelines (PixelLab tileset, hand-authored sheet) before spending another round.
- **Reorder.** If the piece depends on something unproven (fun before pretty, art direction before
  arena), move it behind that thing.

Write the choice and the reason into `state.json.pieces.<id>.memo` so the next wave starts from it.

## 8. Piece template for `wave-args.json`

```json
"sword-swing": {
  "spec": "Three-hit greatsword chain: anticipation, arc, contact, recovery. Heavy third hit.",
  "owns": ["src/sim/player.ts", "src/sim/combat.ts", "src/tuning.ts", "src/render/views.ts", "src/render/presenter.ts"],
  "protocol": "Motion: pnpm poses --only swing; strip of 12 frames every 2 ticks from the first attack press on scenario dummy seed 1, stepwise; state() ticks for startup/active/recovery per swing; frameStats p95.",
  "reference": ["gauntlet/evidence/reference/ref-combat-01.jpg", "gauntlet/evidence/reference/ref-combat-02.jpg"]
}
```
