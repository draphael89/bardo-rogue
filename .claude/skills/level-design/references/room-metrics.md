# Room metrics in our units

Size rooms in dodge distances and enemy ranges, never by eye. All numbers come
from `src/tuning.ts` as of 2026-08-27. Read that file before you rely on them;
the debug API can change them live.

## The base unit: one dodge

- 1 tile = 16 px. 1 dodge (D) = `player.dodge.distance` = 44 px = 2.75 tiles.
- Dodge takes 18 ticks. I-frames run from tick 2 to 12.
- Player top speed 95 px/s, about 6 tiles/s. One tile takes about 10 ticks.

## Today's room in D

- Room 26 x 15 tiles = 416 x 240 px. Walkable `inner` rect 24 x 12 tiles
  = 384 x 192 px = 8.7 D wide, 4.4 D tall.
- Crossing the width takes 4.0 s at top speed; the height 2.0 s.
- Pillar bases sit at columns 7 and 18, rows 6 and 11. Column gap 176 px = 4 D.
  Row gap 80 px = 1.8 D, one charger dash.

## Enemy ranges in D

Brute (`tuning.brute`)
- Starts a windup at `attackRange` 26 px. Windup 20 ticks.
- Lunge 24 px + hit radius 20 px = 44 px = exactly 1 D of threat from where
  the windup starts. One dodge away or sideways at the windup clears the hit.
  This equality is load-bearing; assert it (see below).
- Speed 48 px/s, half the player's. The player can always walk away.

Caster (`tuning.caster`)
- Holds a band from `prefMin` 90 to `prefMax` 130 px = 2.0 to 3.0 D
  (5.6 to 8.1 tiles). Retreats inside 70 px.
- Bolt 110 px/s, lives 180 ticks, so range 330 px. Every bolt crosses the room.
- Aim 24 ticks, cooldown 70 ticks. Bolts die on solid cells
  (`src/sim/projectiles.ts`), so any solid tile is cover.
- A caster needs a free run of at least prefMax + 1 D = 174 px (11 tiles) on
  some axis to hold its band. In a shorter room it pins to a wall. That is a
  valid choice for a punish room, not a default.

Charger (`tuning.charger`)
- Hovers at 50 to 70 px (1.1 to 1.6 D). Freezes 16 ticks, then dashes 80 px
  (1.8 D) at 160 px/s, which takes 30 ticks.
- A full-length dash needs hoverMax + dashDist = 150 px (9 tiles, 3.4 D) of
  clear run. Give chargers lanes, or accept wall-clipped dashes.
- One dodge perpendicular to the dash line is a clean sidestep.

## Sizing rules

- Fight space: the walkable rect is at least 4 D on the short axis when casters
  spawn, 3 D otherwise. Today's 4.4 D passes.
- Lane: any lane meant for fighting is at least 2 D (88 px, 5.5 tiles) wide,
  so a sideways dodge from a brute lands and a bolt can be sidestepped.
- Pinch: anything narrower than 1 D (44 px, 3 tiles) is travel, not combat.
  No spawn within 1 D of a pinch.
- Cover: at least one solid cell within 2 D of each caster spawn side, so the
  player can break line of fire without crossing the room.
- Spawn distance: no first-group spawn within 1 D of the player's entry point
  (`playerStart` today, the entry door once rooms link). The 40-tick telegraph
  gives the player 63 px of movement, so 1 D is the floor, not the target.
  First groups today sit 2.4 D or more away. Later groups may spawn anywhere
  with a telegraph; the wave 3 reinforcement at (12.5, 12.5) is 18 px from
  the start and relies on the player having moved.
- Boss arena: at least 6 D on the short axis. Boss telegraphs will be longer
  than a brute's and the player needs two dodges of retreat, not one.

## Assert these in a headless test when rooms become data

Add `tests/sim/rooms.test.ts` that reads each room definition and the tuning
values and checks:

- `brute.lungeDist + brute.hitRadius <= player.dodge.distance`.
- Walkable rect short axis >= 4 D when the room's spawn list has a caster.
- Every first-group spawn is >= 1 D from the room's entry point.
- Every caster spawn has a solid cell within 2 D.
- Room graph flood-fills from start to boss with keys in order, per seed.

Compute D and the ranges from `tuning` inside the test. Do not paste numbers.
When tuning changes and a room stops passing, the test names the room.
