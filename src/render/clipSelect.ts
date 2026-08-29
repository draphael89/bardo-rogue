// Frame selection from sidecar clips. Pure: no pixi, no DOM — Vitest runs it headless against the
// real tuning numbers, which is what makes the contact assertion in a sidecar TESTABLE instead of
// documentation.
//
// The contract (src/render/sheet.ts): tuning owns every sim-timed duration; a clip carries frame
// NAMES and one assertion — which frame is the contact. Before this module the player and brute views
// each rebuilt the frame vocabulary by hand ('light1' + phase), so the sidecar's contact assertion
// was connected to nothing: renaming a frame in the sheet or asserting the wrong contact changed no
// behaviour and failed no test. Views now read names FROM the clip, so the assertion IS the runtime
// selection, and the boundary tests in tests/render/clip-boundaries.test.ts hold it against the sim's
// actual damage windows.
import type { SheetClip } from './sheet'

/** Ticks of dodgeStart before the travel frame. Presentation-only: the sim's dodge windows do not
 *  subdivide startup, and 3 ticks is the judged minimum for the launch pose to read at 60Hz. */
export const DODGE_START_TICKS = 3

/**
 * A three-phase swing against its tuning window: frames[0] through startup, the asserted contact
 * frame while the sim's hit arc is live (stateTick - startup in [0, active)), the last frame after.
 * The sim tests damage from stateTick === startup (src/sim/player.ts), so the contact drawing appears
 * on the first damage-active tick by construction.
 */
export function swingClipFrame(clip: SheetClip, w: { startup: number; active: number }, stateTick: number): string {
  const f = clip.frames
  if (stateTick < w.startup) return f[0]
  if (stateTick < w.startup + w.active) return clip.sim?.contact ?? f[Math.min(1, f.length - 1)]
  return f[f.length - 1]
}

/** The dodge triplet: launch, travel, land — travel ends when tuning's travel window does. */
export function dodgeClipFrame(clip: SheetClip, w: { travel: number }, stateTick: number): string {
  const f = clip.frames
  if (stateTick < DODGE_START_TICKS) return f[0]
  if (stateTick < w.travel) return f[Math.min(1, f.length - 1)]
  return f[f.length - 1]
}

/**
 * The brute's five-frame attack clip [windupEarly, windupCommit, release, contact, recover] across
 * its three sim states. The sim's arc first tests at stateTick > lungeTicks (src/sim/enemies/
 * brute.ts), so the asserted contact frame takes over exactly there.
 */
export function bruteAttackClipFrame(
  clip: SheetClip,
  w: { windup: number; lungeTicks: number },
  state: 'windup' | 'attack' | 'recover',
  stateTick: number,
): string {
  const f = clip.frames
  if (state === 'windup') return stateTick < Math.ceil(w.windup * 0.55) ? f[0] : f[1]
  if (state === 'attack') return stateTick <= w.lungeTicks ? f[2] : clip.sim?.contact ?? f[3]
  return f[f.length - 1]
}

/** A ticks-timed loop (idle, run): the clip owns its durations; time is presenter seconds at 60Hz. */
export function tickClipFrame(clip: SheetClip, timeSeconds: number): string {
  const ticks = clip.ticks!
  let total = 0
  for (const t of ticks) total += t
  let k = Math.floor(timeSeconds * 60) % total
  for (let i = 0; i < ticks.length; i++) {
    if (k < ticks[i]) return clip.frames[i]
    k -= ticks[i]
  }
  return clip.frames[0]
}
