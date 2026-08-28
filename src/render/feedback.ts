import { tuning } from '@/tuning'
import type { SimEvent, WardenAttackPattern } from '@/sim/events'
import type { World } from '@/sim/world'

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

export function hasHostileFloorThreat(world: Pick<World, 'enemies' | 'projectiles' | 'spawnQueue'>): boolean {
  if (world.spawnQueue.length > 0) return true
  if (world.projectiles.some(projectile => projectile.active && projectile.team === 0)) return true
  return world.enemies.some(enemy => enemy.active && (
    enemy.state === 'windup' || enemy.state === 'aim' || enemy.state === 'freeze'
      || enemy.state === 'attack' || enemy.state === 'dash'
  ))
}

export const DECAL_THREAT_ALPHA = 0.18

export function decalAlphaForFrame(current: number, threatActive: boolean, dtSec: number): number {
  // Danger wins on its first presented frame. Scars may return gently after the lane clears, but
  // they never spend several frames competing with a new projectile or spawn promise.
  if (threatActive) return DECAL_THREAT_ALPHA
  return current + (1 - current) * Math.min(1, dtSec * 10)
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
  private accentActions = new Set<number>()

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

  takeAccent(actionId: number): boolean {
    if (this.accentActions.has(actionId)) return false
    this.accentActions.add(actionId)
    return true
  }

  reset(): void { this.hitActions.clear(); this.killActions.clear(); this.accentActions.clear() }
}

// The world intentionally reuses positive action ids after an in-place hub return. Keep the event
// bridge pure and exported so the real return lifecycle can be regression-tested without constructing
// Pixi's entire Presenter graph. Full world replacement remains covered by Presenter.bindWorld().
export function applyActionFeedbackLifecycle(gate: ActionFeedbackGate, event: SimEvent): boolean {
  if (event.type !== 'returned') return false
  gate.reset()
  return true
}
