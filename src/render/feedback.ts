import { tuning } from '@/tuning'

// Shared screen motion describes one player action. Extra targets earn a square-root accent, capped
// well below linear stacking; their local wounds and reactions remain one-for-one.
export function crowdScreenMultiplier(count: number): number {
  const S = tuning.juice.hit.screen
  return Math.min(S.crowdCap, 1 + S.crowdBonus * Math.sqrt(Math.max(0, count - 1)))
}
