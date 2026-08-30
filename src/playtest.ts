// The A/B verb conditions for the human fun gate. Protocol and assignment table: PLAYTEST.md.
//
// Deliberately OUTSIDE src/sim/: a condition is a property of the session, not of the world. The
// sim stays deterministic given (seed, scenario, inputs) alone and never learns a condition exists.
import { tuning } from './tuning'

export const PLAYTEST_CONDITIONS = ['baseline', 'no-heavy', 'no-dash'] as const
export type PlaytestCondition = typeof PLAYTEST_CONDITIONS[number]

export function asPlaytestCondition(v: unknown): PlaytestCondition | null {
  return typeof v === 'string' && (PLAYTEST_CONDITIONS as readonly string[]).includes(v)
    ? v as PlaytestCondition
    : null
}

/**
 * Re-apply a condition that a recording cannot carry on its own.
 *
 * The two conditions are not the same kind of thing, and only one of them survives in the frames:
 *
 * `no-heavy` is a FRAME filter — main.ts drops `f.heavy` before `recorder.capture`, so the
 * condition is baked into the bundle and any replay of it reproduces the condition for free.
 * Nothing to do here, and doing something would be wrong: the frames already say heavy was never
 * pressed.
 *
 * `no-dash` cannot be a frame filter. A dodge and an attack pressed on the same free tick both pass
 * (the body is not rolling yet), and an attack buffered just before the roll is already queued —
 * either one still reaches the cancel and launches the dash attack. It closes the cancel WINDOW
 * instead, and a window is not in the frames. So every replay path must apply it again, or a
 * no-dash bundle replays as a baseline run and diverges at the tester's first dodge-into-attack.
 *
 * Idempotent: `travel` is only ever read, so applying this twice lands on the same number.
 */
export function applyPlaytestCondition(c: PlaytestCondition): void {
  // Lift the gate past the roll's own state (total is 20) so it can never be reached. A queued
  // swing is not dropped — it simply lands after the roll, like a swing queued during any state.
  if (c === 'no-dash') tuning.player.dodge.attackCancelFrom = tuning.player.dodge.travel + 99
}

/**
 * The condition a bundle was recorded under. A bundle IS an encoded replay with one extra key
 * (src/main.ts `exportPlaytestBundle`), so a plain replay simply answers null.
 */
export function conditionOfBundle(doc: unknown): PlaytestCondition | null {
  if (typeof doc !== 'object' || doc === null) return null
  const pt = (doc as { playtest?: unknown }).playtest
  if (typeof pt !== 'object' || pt === null) return null
  return asPlaytestCondition((pt as { condition?: unknown }).condition)
}

// no-heavy is present in the recorded frames; no-dash changes tuning and therefore requires the
// bundle wrapper. A plain Replay produced while that condition is installed would be mislabeled.
export function canRecordPlainReplay(condition: PlaytestCondition | null): boolean {
  return condition !== 'no-dash'
}
