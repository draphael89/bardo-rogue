import { tuning } from '@/tuning'
import type { World } from './world'
import { angleDiff, deg } from './math'

export function startDraw(world: World): void {
  const p = world.player
  p.state = 'attack'
  p.stateTick = 0
  p.attackQueuedAt = -1
  p.swingIndex = 0
  p.bladeActionConnected = false
  p.swingAngle = p.aimAngle
  p.swingId = ++world.swingCounter
  p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
  world.emit({ type: 'draw', x: p.x, y: p.y, angle: p.swingAngle })
}

export function looseArrow(world: World): void {
  const p = world.player
  const B = tuning.bow
  const x = p.x + Math.cos(p.swingAngle) * B.muzzle
  const y = p.y + Math.sin(p.swingAngle) * B.muzzle
  world.fireProjectile(x, y, p.swingAngle, B.speed, B.radius, B.life, 1, B.damage, p.swingId)
  world.emit({ type: 'arrowLoose', x, y, angle: p.swingAngle })
}

export function bowMoveScale(world: World): number {
  const p = world.player
  const B = tuning.bow
  const rec = p.stateTick - B.draw
  if (rec < 0) return B.moveDraw
  return B.moveRecover + (1 - B.moveRecover) * Math.min(1, rec / B.recover)
}

export function bowSteer(world: World, aim: number): void {
  const p = world.player
  const B = tuning.bow
  if (p.stateTick >= B.steerTicks) return
  const max = deg(tuning.player.attack.steerRateDeg)
  const d = angleDiff(p.swingAngle, aim)
  p.swingAngle += d > max ? max : d < -max ? -max : d
  p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
}
