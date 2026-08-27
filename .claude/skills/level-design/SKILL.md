---
name: level-design
description: >
  Room, floor, and encounter design for Bardo Rogue: beats as data (intensity
  per room, sawtooth, rest before boss), the teaching loop for new enemies and
  hazards, the room graph with soft-lock validation, room and cover sizing in
  dodge and enemy-range units, and the blockout review checklist. Use when the
  task mentions room layout, a new room, wave pacing, encounter design, a floor,
  map structure, boss arena, doors, secret or rescue or shrine rooms, or realms.
---

# Level design

A floor is a sequence of intentional beats delivered through rooms. Author the
beats first, block the rooms out as data, prove them with bots, then dress them.
Never the reverse. Numbers come from `src/tuning.ts`; see
`references/room-metrics.md` for the sizing rules in our units.

## Workflow

1. Write the beat list for the floor (intensity per room). Review the curve.
2. Block out each room as data: walls, solids, spawns, exits. Placeholder tiles.
3. Check the room against the metrics (dodge units, enemy ranges).
4. Run it headless: `pnpm sim -- --scenario <room> --bot kite --seeds 1-8`.
   Read clear time and deaths. Then `pnpm shot` and read the PNG.
5. Fix the blockout until it plays. Only then dress with the tile sheets.

## Beats as data

Each room on a floor carries a type and an intensity from 0 to 1. Read the
column top to bottom. It must rise overall and dip for rests: a sawtooth, never
a flat high. Place a rest beat right before the boss.

```ts
// Shape only. Types: teach | fight | elite | rest | boss.
// rest covers shrine, rescue, secret, and shop rooms.
const FLOOR_BEATS = [
  { room: 'gate',     type: 'teach', intensity: 0.2 },
  { room: 'hall',     type: 'fight', intensity: 0.5 },
  { room: 'shrine',   type: 'rest',  intensity: 0.1 },
  { room: 'pit',      type: 'fight', intensity: 0.7 },
  { room: 'rescue',   type: 'rest',  intensity: 0.2 },
  { room: 'judge',    type: 'boss',  intensity: 1.0 },
]
```

Waves inside a room follow the same rule. `ROOM_WAVES` in `src/sim/waves.ts`
already reads as a small sawtooth (2 brutes, then brute plus casters, then a
swarm with reinforcements) and `waveGapTicks` is the dip between peaks. Drive
music layers and spawn density from the intensity value, not from ad hoc flags.

No filler. Every node on the map must have a type. A room with no beat is a bug.

## The teaching loop

Players learn a mechanic in four steps: introduce, develop, twist, test.

1. Introduce: the new enemy or hazard alone, in a room below the last peak.
2. Develop: pair it with one kind the player already knows.
3. Twist: change the context (cover, a pinch, a second hazard).
4. Test: under pressure, in a fight or elite room.

New mechanics meet the player before, never during, a lethal test. Today the
charger first appears in wave 3 next to four other enemies. That is a test with
no introduce. When rooms become data, give each new enemy kind its own room
first, and each realm hazard its own safe reveal.

## The room graph and soft-lock validation

Model a floor as rooms plus exits. An exit may need a key, a rescue, or an
ability. A room may grant one. This shape holds for Hades-style doors and for
Spire-style node maps alike, so the map-structure decision does not change it.

```ts
const ROOMS = {
  gate:   { exits: [{ to: 'hall' }] },
  hall:   { exits: [{ to: 'judge', needs: 'heart' }, { to: 'crypt' }] },
  crypt:  { exits: [{ to: 'hall' }], grants: 'heart' },
  judge:  { exits: [] },
}
```

Validate it: flood fill from the start. Cross an exit only when its `needs` is
already in the granted set. Repeat until nothing new is reached. The boss must
be in the reached set. Run this per seed for any generated floor, and assert it
in a headless test. Connectivity alone is not enough; order is the bug.

Gating tools, in order of preference: locks and keys (readable), soft gates
(an elite room the player can skip), one-way doors (telegraph them).
Optional branches should rejoin the main path within one or two rooms.

## Guidance in a fixed-camera room

The player sees the whole room, so "lost" is rarely the problem. The problems
are: which door, and what is behind it. Mark each exit with its reward. Light
the open door and dim the closed ones. Telegraph every spawn (40 ticks today)
and keep spawns out of the player's dodge radius.

## Blockout review checklist

- Beat list reads as a rising sawtooth. A rest precedes the boss.
- Every new enemy kind or hazard has an introduce room before its test room.
- Room graph flood-fills to the boss with keys in order, for every seed.
- Walkable rect, lanes, cover, and spawn distances pass the metrics.
- Kite bot clears the room in the target band; naive bot dies where intended.
- Every exit shows its reward. The open door reads at a glance.
- The room plays with placeholder tiles. Dressing would not rescue it.
- Checked against a real play session, not only bots.

## Pitfalls

- Dressing before it plays.
- Rooms sized by eye instead of in dodge units.
- Flat pacing: fight, fight, fight. Or a rest that lasts three rooms.
- A first-contact enemy inside a lethal wave.
- A key that sits past the door it opens.
- Filler rooms that exist to pad the floor length.
