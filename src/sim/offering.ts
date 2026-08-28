import { tuning } from '@/tuning'
import type { World } from './world'

// Walk-in room gift. The gift door's promise: something in the next chamber changes you.
export function tryCollectOffering(world: World): void {
  const o = world.arena.offering
  if (!o || world.arena.offeringTaken) return
  if (world.player.state === 'dead') return
  const dx = world.player.x - o.x
  const dy = world.player.y - o.y
  const r = tuning.run.offeringRadius
  if (dx * dx + dy * dy > r * r) return
  world.arena.offeringTaken = true
  const gain = tuning.run.offeringHp
  world.player.maxHp += gain
  world.player.hp = Math.min(world.player.maxHp, world.player.hp + gain)
  const run = world.session.run
  if (run) { run.hp = world.player.hp; run.maxHp = world.player.maxHp }
  world.emit({ type: 'offeringTaken', kind: o.kind, x: o.x, y: o.y })
}
