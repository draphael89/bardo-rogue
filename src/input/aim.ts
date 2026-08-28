// Which direction is the player pointing, and how sure are we?
//
// Kept pure and DOM-free so it can be tested without a browser: everything here is already-resolved
// vectors, not events. `soft` means "this is intent, not precision" and lets the sim nudge the angle
// onto a nearby target. Only the mouse is precise enough to be left alone.
export interface AimSources {
  padAimX: number; padAimY: number    // right stick, past its deadzone; 0,0 when untouched
  arrowX: number; arrowY: number      // arrow keys, 8-way; 0,0 when none held
  mouseX: number; mouseY: number      // unit vector player -> cursor; 0,0 until the pointer has moved
  lockX: number; lockY: number        // hold-to-lock: unit vector to the locked target; 0,0 when unused
  moveX: number; moveY: number        // current movement intent
  lastAimX: number; lastAimY: number  // whatever we resolved last tick
}

export interface Aim { x: number; y: number; soft: boolean }

function unit(x: number, y: number, soft: boolean): Aim {
  const l = Math.hypot(x, y)
  return { x: x / l, y: y / l, soft }
}

// Highest priority first. The mouse outranks movement but not an explicit key, so a player reaching
// for the arrows is never fighting a cursor they left somewhere; the cursor never speaks at all until
// it has moved, because its start position is a real coordinate (the window corner), not a "no aim".
export function resolveAim(s: AimSources): Aim {
  if (s.padAimX || s.padAimY) return unit(s.padAimX, s.padAimY, false)
  if (s.arrowX || s.arrowY) return unit(s.arrowX, s.arrowY, true)
  if (s.mouseX || s.mouseY) return unit(s.mouseX, s.mouseY, false)
  if (s.lockX || s.lockY) return unit(s.lockX, s.lockY, true)
  if (s.moveX || s.moveY) return unit(s.moveX, s.moveY, true)
  return { x: s.lastAimX, y: s.lastAimY, soft: true }
}

// Nearest living target inside a facing cone. Null when nothing is in the cone — the caller
// should fall through to movement / last aim rather than snap 180 degrees onto a back-target.
export function aimLockTarget(
  ox: number, oy: number,
  facingX: number, facingY: number,
  coneDeg: number,
  targets: readonly { x: number; y: number }[],
): { x: number; y: number } | null {
  const fl = Math.hypot(facingX, facingY)
  const fx = fl > 0.01 ? facingX / fl : 1
  const fy = fl > 0.01 ? facingY / fl : 0
  const cosMin = Math.cos((coneDeg * Math.PI / 180) / 2)
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (const t of targets) {
    const dx = t.x - ox, dy = t.y - oy
    const d = Math.hypot(dx, dy)
    if (d < 0.5 || d >= bestD) continue
    if ((dx * fx + dy * fy) / d < cosMin) continue
    bestD = d
    best = { x: dx / d, y: dy / d }
  }
  return best
}
