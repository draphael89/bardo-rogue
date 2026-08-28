// The authored hero has a mirrored profile plus north/south sheets. Keep this choice independent
// from Pixi so its boundary behavior is explicit and testable: combat actions latch one direction,
// while free locomotion gets a small hysteresis band around the diagonals.
export type HeroDirection = 'side' | 'north' | 'south'

export function nearestHeroDirection(angle: number): HeroDirection {
  const x = Math.abs(Math.cos(angle))
  const y = Math.abs(Math.sin(angle))
  if (y <= x) return 'side'
  return Math.sin(angle) < 0 ? 'north' : 'south'
}

export function stableHeroDirection(angle: number, previous?: HeroDirection): HeroDirection {
  if (!previous) return nearestHeroDirection(angle)
  const x = Math.abs(Math.cos(angle))
  const sy = Math.sin(angle)
  const y = Math.abs(sy)
  const margin = 0.12

  if (previous === 'side') {
    return y > x + margin ? (sy < 0 ? 'north' : 'south') : 'side'
  }

  const vertical = sy < 0 ? 'north' : 'south'
  // Crossing straight through north/south is intentional and should not inherit the old facing.
  if (vertical !== previous && y >= x) return vertical
  return x > y + margin ? 'side' : previous
}

// Four held drawings make a depth-axis dodge visibly turn even with translation/effects removed:
// dive, tuck, inverted apex, extension. The round tuck is a single snap beat; the elongated apex
// gets two ticks and the extension carries the recovery so anatomy never disappears into a held ball.
export function verticalDodgeFrame(direction: HeroDirection, stateTick: number, travelTicks: number): number {
  if (direction === 'side' || stateTick < 3 || stateTick >= travelTicks) return -1
  const tick = stateTick - 3
  const span = Math.max(1, travelTicks - 3)
  if (tick < Math.ceil(span * 0.3)) return 0
  if (tick < Math.ceil(span * 0.4)) return 1
  if (tick < Math.ceil(span * 0.6)) return 2
  return 3
}
