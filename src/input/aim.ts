// Which direction is the player pointing, and how sure are we?
//
// Kept pure and DOM-free so it can be tested without a browser: everything here is already-resolved
// vectors, not events. `soft` means "this is intent, not precision" and lets the sim nudge the angle
// onto a nearby target. Mouse and a deliberately placed right stick are left alone.
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

// Highest priority first. Q lock is explicit intent, so an idle cursor cannot defeat it. Arrows still
// beat lock and let the player break away without releasing Q; right stick remains the fastest override.
export function resolveAim(s: AimSources): Aim {
  if (s.padAimX || s.padAimY) return unit(s.padAimX, s.padAimY, false)
  if (s.arrowX || s.arrowY) return unit(s.arrowX, s.arrowY, true)
  // A held Q target is an explicit identity, not a coarse direction. Marking it soft would let the
  // simulation's short-range assist silently replace a retained long-range lock with a nearby body.
  if (s.lockX || s.lockY) return unit(s.lockX, s.lockY, false)
  if (s.mouseX || s.mouseY) return unit(s.mouseX, s.mouseY, false)
  if (s.moveX || s.moveY) return unit(s.moveX, s.moveY, true)
  return { x: s.lastAimX, y: s.lastAimY, soft: true }
}

// Nearest living target inside a facing cone. Null when nothing is in the cone — the caller
// should fall through to movement / last aim rather than snap 180 degrees onto a back-target.
export function aimLockTarget(
  ox: number, oy: number,
  facingX: number, facingY: number,
  coneDeg: number,
  targets: readonly { x: number; y: number; id?: number; active?: boolean; state?: string }[],
  options: {
    currentId?: number | null
    maxRange?: number
    breakRange?: number
    visible?: (target: { x: number; y: number }) => boolean
  } = {},
): { x: number; y: number; id?: number } | null {
  const fl = Math.hypot(facingX, facingY)
  const fx = fl > 0.01 ? facingX / fl : 1
  const fy = fl > 0.01 ? facingY / fl : 0
  const cosMin = Math.cos((coneDeg * Math.PI / 180) / 2)
  const eligible = (t: { x: number; y: number; active?: boolean; state?: string }) =>
    t.active !== false && t.state !== 'dead' && (!options.visible || options.visible(t))
  // Lock hysteresis is absolute while the held target remains valid. This is a deliberate lock, not
  // soft assist: nearby bodies crossing the ray should never make Q chatter between silhouettes.
  if (options.currentId != null) {
    for (const t of targets) {
      if (t.id !== options.currentId || !eligible(t)) continue
      const dx = t.x - ox, dy = t.y - oy
      const d = Math.hypot(dx, dy)
      if (d >= 0.5 && d <= (options.breakRange ?? options.maxRange ?? Infinity)) return { x: dx / d, y: dy / d, id: t.id }
    }
  }

  let best: { x: number; y: number; id?: number } | null = null
  let bestD = Infinity
  for (const t of targets) {
    if (!eligible(t)) continue
    const dx = t.x - ox, dy = t.y - oy
    const d = Math.hypot(dx, dy)
    if (d < 0.5 || d >= bestD || d > (options.maxRange ?? Infinity)) continue
    if ((dx * fx + dy * fy) / d < cosMin) continue
    bestD = d
    best = { x: dx / d, y: dy / d, id: t.id }
  }
  return best
}
