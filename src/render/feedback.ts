import { tuning } from '@/tuning'

// Shared screen motion describes one player action. Extra targets earn a square-root accent, capped
// well below linear stacking; their local wounds and reactions remain one-for-one.
export function crowdScreenMultiplier(count: number): number {
  const S = tuning.juice.hit.screen
  return Math.min(S.crowdCap, 1 + S.crowdBonus * Math.sqrt(Math.max(0, count - 1)))
}

// Screen feedback is once per action, while local wounds remain per target. The world deliberately
// restarts action ids on a hub return, so the gate has an explicit lifecycle instead of assuming ids
// are globally unique for the lifetime of the Presenter.
export class ActionFeedbackGate {
  private lastHit = -1
  private lastKill = -1

  takeHit(actionId: number): boolean {
    if (actionId === this.lastHit) return false
    this.lastHit = actionId
    return true
  }

  takeKill(actionId: number): boolean {
    if (actionId === this.lastKill) return false
    this.lastKill = actionId
    return true
  }

  reset(): void { this.lastHit = this.lastKill = -1 }
}
