import type { EnemyKind } from '../events'

export interface SpawnDef { kind: EnemyKind; x: number; y: number } // in tiles
export interface WaveGroup { delay: number; spawns: SpawnDef[]; whenRemainingAtMost?: number; mirrorX?: boolean }
export interface WaveDef { groups: WaveGroup[] }

// Lives here (not in waves.ts) so room graphs can import tables without the
// rooms → slice → waves → world → rooms cycle that leaves bindings undefined.

// The reference fight is a curriculum, not a pile of health: read one body, choose across a firing
// line, route a dash, then combine the verbs under pressure. Whole formations may mirror per seed;
// relative spacing never changes, so variation asks for a new first decision without changing fairness.
export const ROOM_WAVES: WaveDef[] = [
  { groups: [{ delay: 0, mirrorX: true, spawns: [{ kind: 'brute', x: 8, y: 4.5 }] }] },
  { groups: [{ delay: 0, mirrorX: true, spawns: [
    { kind: 'brute', x: 16, y: 5.5 },
    { kind: 'caster', x: 3, y: 3.5 },
  ] }, { delay: 30, whenRemainingAtMost: 1, mirrorX: true, spawns: [
    { kind: 'caster', x: 22, y: 9.5 },
  ] }] },
  { groups: [
    { delay: 0, mirrorX: true, spawns: [{ kind: 'charger', x: 4, y: 10.5 }, { kind: 'caster', x: 21.5, y: 3.5 }] },
    { delay: 45, whenRemainingAtMost: 1, mirrorX: true, spawns: [{ kind: 'brute', x: 7, y: 4.5 }] },
  ] },
  {
    groups: [
      { delay: 0, mirrorX: true, spawns: [{ kind: 'brute', x: 9, y: 4.5 }, { kind: 'brute', x: 16, y: 4.5 }, { kind: 'caster', x: 2.5, y: 3 }, { kind: 'caster', x: 23.5, y: 3 }] },
      { delay: 30, whenRemainingAtMost: 2, mirrorX: true, spawns: [{ kind: 'charger', x: 2.5, y: 8 }, { kind: 'charger', x: 23.5, y: 8 }, { kind: 'charger', x: 7, y: 3 }, { kind: 'charger', x: 19, y: 3 }] },
      { delay: 0, whenRemainingAtMost: 2, mirrorX: true, spawns: [{ kind: 'charger', x: 12.5, y: 3 }, { kind: 'charger', x: 12.5, y: 12.5 }] },
    ],
  },
  { groups: [
    { delay: 0, mirrorX: true, spawns: [
      { kind: 'caster', x: 3, y: 3.5 },
      { kind: 'brute', x: 13, y: 5 },
      { kind: 'charger', x: 5, y: 11 },
    ] },
    { delay: 20, whenRemainingAtMost: 2, mirrorX: true, spawns: [
      { kind: 'caster', x: 22, y: 3.5 }, { kind: 'charger', x: 21, y: 11 },
    ] },
    { delay: 20, whenRemainingAtMost: 1, mirrorX: true, spawns: [
      { kind: 'brute', x: 18, y: 5 }, { kind: 'charger', x: 4, y: 7.5 },
    ] },
  ] },
  // Coda: three clean two-body phrases. The density falls but the verbs alternate, letting a good
  // player finish in rhythm instead of surviving the hardest pile and then mopping up leftovers.
  { groups: [
    { delay: 0, mirrorX: true, spawns: [{ kind: 'brute', x: 8, y: 5 }, { kind: 'caster', x: 21, y: 4 }] },
    { delay: 24, whenRemainingAtMost: 0, mirrorX: true, spawns: [{ kind: 'charger', x: 5, y: 10 }, { kind: 'charger', x: 21, y: 10 }] },
    { delay: 24, whenRemainingAtMost: 0, mirrorX: true, spawns: [{ kind: 'caster', x: 4, y: 4 }, { kind: 'brute', x: 18, y: 5.5 }] },
  ] },
]

// Two-room run: Threshold teaches the brute, Crossing answers with range + dash. Positions stay off furniture.
export const THRESHOLD_RUN_WAVES: WaveDef[] = [ROOM_WAVES[0]]
export const CROSSING_RUN_WAVES: WaveDef[] = [
  { groups: [{ delay: 20, spawns: [
    { kind: 'caster', x: 4, y: 3.5 },
    { kind: 'charger', x: 22, y: 4 },
    { kind: 'charger', x: 3, y: 11 },
  ] }] },
]

// The production slice is authored as distinct questions, not escalating piles.
// Room 1 teaches commitment; the branches test movement or priority; the Landing is the
// breath; the Reach combines the verbs; the Antechamber teaches the shield alone, then Minos.
// Delays are short enough to preserve momentum but long enough for each arrival tell to register.
export const SLICE_ROOM_1: WaveDef[] = [{ groups: [{ delay: 0, spawns: [
  { kind: 'brute', x: 8, y: 5 },
  { kind: 'brute', x: 19, y: 6 },
] }] }]

export const SLICE_ROOM_2_VEIL: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [{ kind: 'caster', x: 13, y: 4 }] },
  { delay: 55, spawns: [{ kind: 'charger', x: 4, y: 9 }] },
  { delay: 32, spawns: [{ kind: 'charger', x: 22, y: 10 }] },
] }]

export const SLICE_ROOM_2_BLADE: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [
    { kind: 'brute', x: 13, y: 5 },
    { kind: 'caster', x: 4, y: 4 },
    { kind: 'caster', x: 22, y: 4 },
  ] },
] }]

// The Landing keeps a small combine so the stall still follows a fight. The Oath-Bound is not
// here — a rule taught inside a crowd is a rule learned by accident.
export const SLICE_ROOM_3: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [
    { kind: 'caster', x: 21, y: 4 },
    { kind: 'charger', x: 4, y: 10 },
  ] },
  { delay: 40, whenRemainingAtMost: 1, spawns: [
    { kind: 'brute', x: 8, y: 5 },
  ] },
] }]

// After the bank: the three verbs in one room, no new rule.
export const SLICE_COCYTUS: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [
    { kind: 'brute', x: 13, y: 5 },
    { kind: 'caster', x: 4, y: 4 },
  ] },
  { delay: 36, whenRemainingAtMost: 1, spawns: [
    { kind: 'charger', x: 22, y: 10 },
    { kind: 'caster', x: 21, y: 4 },
  ] },
] }]

// The fire river asks you to cut first, then move. Two Lampads on the banks;
// the ford then sends a dash and a Hoplite. Same verbs as Cocytus, opposite order.
export const SLICE_PHLEGETHON: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [
    { kind: 'caster', x: 4, y: 5 },
    { kind: 'caster', x: 22, y: 5 },
  ] },
  { delay: 40, whenRemainingAtMost: 1, spawns: [
    { kind: 'charger', x: 13, y: 11 },
    { kind: 'brute', x: 8, y: 6 },
  ] },
] }]

// The oath river is still two bodies, not Acheron's two Hoplites. One runs;
// one holds. The first swing is a dodge or a cut, not a walk-in.
export const SLICE_STYX: WaveDef[] = [{ groups: [{ delay: 0, spawns: [
  { kind: 'charger', x: 5, y: 10 },
  { kind: 'brute', x: 20, y: 5 },
] }] }]

// The shield is a rule to be read. It is introduced ALONE.
export const SLICE_ELITE: WaveDef[] = [{ groups: [
  { delay: 0, spawns: [{ kind: 'oathbound', x: 13, y: 5 }] },
] }]

// Same opening clock as the Oath-Bound: the door flash is the hold, then the tell.
export const SLICE_WARDEN: WaveDef[] = [{ groups: [{ delay: 0, spawns: [
  { kind: 'warden', x: 13, y: 5 },
] }] }]
