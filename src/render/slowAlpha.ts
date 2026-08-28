import { SLOW_FULL } from '@/sim/world'

// Render interpolation for everything behind the slow-motion gate.
//
// Bodies on the stretched clock only move on the ticks the gate lets through, so interpolating them
// with the plain per-tick alpha makes them hold still for three frames and then jump a whole tick.
// `slowAcc` is where the gate's accumulator stands after the last tick, so this sweeps 0..1 across
// the whole stretched interval and lands exactly on 1 as the next world tick fires.
//
// At full speed slowAcc is always 0 and slowRate is SLOW_FULL, so this is the identity on alpha.
export function slowAlphaFor(slowAcc: number, slowRate: number, alpha: number): number {
  const a = (slowAcc + alpha * slowRate) / SLOW_FULL
  return a > 1 ? 1 : a
}
