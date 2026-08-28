import { tuning } from '@/tuning'
import type { WardenAttackPattern } from '@/sim/events'

// Shared screen motion describes one player action. Extra targets earn a square-root accent, capped
// well below linear stacking; their local wounds and reactions remain one-for-one.
export function crowdScreenMultiplier(count: number): number {
  const S = tuning.juice.hit.screen
  return Math.min(S.crowdCap, 1 + S.crowdBonus * Math.sqrt(Math.max(0, count - 1)))
}

export function guardedHitScreenScale(allContactsGuarded: boolean, killed: boolean): number {
  // Death is an unambiguous outcome and keeps its release. A surviving veil contact is confirmation,
  // not a breakthrough, so it deliberately sits below even an ordinary light hit.
  return allContactsGuarded && !killed ? tuning.juice.hit.guarded.screenScale : 1
}

export interface WardenAttackFeedback {
  trauma: number
  kick: number
  zoom: number
  flash: number
  dust: number
  pulse: boolean
}

export function wardenAttackFeedback(pattern: WardenAttackPattern): WardenAttackFeedback {
  const W = tuning.juice.warden
  if (pattern === 'ring') return { trauma: W.ringTrauma, kick: 0, zoom: 1, flash: 0, dust: 0, pulse: false }
  if (pattern === 'fan') return { trauma: W.fanTrauma, kick: W.fanKick, zoom: 1, flash: 0, dust: W.fanDust, pulse: false }
  return { trauma: W.slamTrauma, kick: W.slamKick, zoom: W.slamZoom, flash: W.slamFlash, dust: W.slamDust, pulse: true }
}

// Screen feedback is once per action, while local wounds remain per target. The world deliberately
// restarts action ids on a hub return, so the gate has an explicit lifecycle instead of assuming ids
// are globally unique for the lifetime of the Presenter.
export class ActionFeedbackGate {
  // Delayed arrows, reflections, echoes, and Judgment bursts can arrive after newer actions. A
  // single "last id" lets an older action become loud a second time when that happens; the run-local
  // sets preserve the actual contract: one screen sentence per action, regardless of event order.
  private hitActions = new Set<number>()
  private killActions = new Set<number>()

  takeHit(actionId: number): boolean {
    if (this.hitActions.has(actionId)) return false
    this.hitActions.add(actionId)
    return true
  }

  takeKill(actionId: number): boolean {
    if (this.killActions.has(actionId)) return false
    this.killActions.add(actionId)
    return true
  }

  reset(): void { this.hitActions.clear(); this.killActions.clear() }
}
