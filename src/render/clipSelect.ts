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
 * The tick a RENDER FRAME must DISPLAY for the heavy's promise to have been made, given tuning's
 * `heavyCommitTick`. They are not the same number and the difference is one frame the player feels:
 * `capturePlayerInput` runs before `updatePlayer`, which increments stateTick BEFORE testing
 * `stateTick < heavyCommitTick`, so a dodge pressed on the frame showing N is judged at N+1.
 * Measured, not derived: with heavyCommitTick 4, presses on displayed ticks 0-2 cancel and presses
 * on 3-10 are silently dropped.
 *
 * It lives here, pure and parameterised, because TWO consumers need the same answer — the presenter,
 * which fires the plant dust, the blade glow and the camera drop, and `swingClipFrame`, which picks
 * the plant DRAWING. They were computed separately and disagreed by one frame, which would have put
 * a future authored plant pose behind every other cue in the commitment beat.
 */
export function promiseFrame(commitTick: number): number {
  return Math.max(0, commitTick - 1)
}

/** Which of `count` frames owns tick `t` of a phase `len` ticks long, split as evenly as the tick
 *  grid allows. `len <= 0` or a single frame collapses to 0, so a three-frame clip never branches. */
function share(t: number, len: number, count: number): number {
  if (count <= 1 || len <= 0) return 0
  return Math.min(count - 1, Math.floor((t * count) / len))
}

/**
 * A swing against its tuning window. Tuning still owns every duration; the clip owns only NAMES and
 * the contact assertion. What changed: the frames BEFORE the asserted contact spread across startup
 * and the frames AFTER it spread across recovery, instead of one drawing holding a whole phase.
 *
 * A three-frame clip is bit-identical to the old three-phase selector (one startup frame, one tail
 * frame, nothing to spread), so today's sheets do not move. The point is that authoring a fourth
 * cell now changes what the player sees: before this, a six-frame greatsword compiled, passed every
 * gate, and then played as three drawings, which made "more animation" an unreachable purchase.
 *
 * `commitTick` is the second assertion, and the reason this is not just an even divide. A heavy has
 * a tick where the sim stops accepting a dodge (tuning.player.attack.heavyCommitTick); a promise the
 * player cannot see is a promise they experience as a dropped input. When a clip authors more than
 * one startup frame, the LAST of them takes over exactly on that tick — the plant is a pose, and the
 * pose changes when the promise is made. Frames before it split the feint window.
 */
export function swingClipFrame(
  clip: SheetClip,
  w: { startup: number; active: number; recovery?: number },
  stateTick: number,
  commitTick?: number,
): string {
  const f = clip.frames
  const contact = clip.sim?.contact ?? f[Math.min(1, f.length - 1)]
  const ci = Math.max(0, f.indexOf(contact))

  if (stateTick < w.startup) {
    const commit = commitTick
    if (ci > 1 && commit !== undefined && commit > 0 && commit < w.startup) {
      // feint frames own [0, commit); the plant owns [commit, startup)
      return stateTick < commit ? f[share(stateTick, commit, ci - 1)] : f[ci - 1]
    }
    return f[share(stateTick, w.startup, ci)]
  }
  if (stateTick < w.startup + w.active) return contact
  // The tail. A whiffed swing runs longer than `recovery` (whiffPenalty) and simply holds the last
  // drawing — the penalty IS extra time on the ground, so the settle pose is the honest frame for it.
  const tail = f.length - 1 - ci
  if (tail <= 0) return f[f.length - 1]
  return f[ci + 1 + share(stateTick - w.startup - w.active, w.recovery ?? 0, tail)]
}

/**
 * Launch, travel, land — travel ends when tuning's travel window does, and everything the clip
 * declares between the first and last frame spreads across it. A three-frame clip is unchanged.
 *
 * This is the side roll's ceiling, and it is worth naming: the north and south sheets carry a
 * four-frame `roll` clip and visibly turn the body over, while `side` has no roll sheet at all and
 * falls back to this clip — one travel drawing held for ten ticks. That is why a left/right roll
 * reads as a smear and an up/down roll reads as a tumble. The fix is a sheet; this is the socket it
 * plugs into, which did not exist before.
 */
export function dodgeClipFrame(clip: SheetClip, w: { travel: number }, stateTick: number): string {
  const f = clip.frames
  if (stateTick < DODGE_START_TICKS) return f[0]
  if (stateTick < w.travel) {
    const mid = f.length - 2
    if (mid <= 1) return f[Math.min(1, f.length - 1)]
    return f[1 + share(stateTick - DODGE_START_TICKS, w.travel - DODGE_START_TICKS, mid)]
  }
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

/**
 * The four-frame vertical roll clip [dive, tuck, apex, extend], indexed by the phase split the
 * direction module computes (verticalDodgeFrame's 0..3). Names come from the clip so the roll joins
 * the same contract as every other authored clip: rename a frame in the sheet and the runtime
 * follows the sidecar, not a hardcoded array.
 */
export function rollClipFrame(clip: SheetClip, phase: number): string {
  return clip.frames[Math.max(0, Math.min(clip.frames.length - 1, phase))]
}
