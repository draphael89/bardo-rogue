import { DT, tuning } from '@/tuning'
import type { Arena } from '../arena'
import { raycastSolidDistance } from '../collision'

export type WardenProjectilePattern = 'ring' | 'fan'

// One source of truth for both the bolts the simulation creates and the lanes presentation promises.
// `fullDangerReach` is measured from the Warden's centre to the farthest player centre that a live
// projectile can touch in open floor. Projectiles move before their life counter is tested, and the
// life==0 move is discarded before collision, hence the exact (lifeTicks - 1) damaging steps.
export interface WardenProjectileContract {
  pattern: WardenProjectilePattern
  count: number
  spawnOffset: number
  speed: number
  lifeTicks: number
  boltRadius: number
  combinedHurtRadius: number
  firstDamagingCenterReach: number
  damagingCenterTravel: number
  fullDangerReach: number
  spread: number
}

export function wardenProjectileContract(pattern: WardenProjectilePattern): WardenProjectileContract {
  const W = tuning.warden
  // Phase two recombines slam/ring/fan. Density stays the taught sentence; faster/fatter
  // volleys were acceleration, not a new decision.
  const speed = pattern === 'ring' ? W.boltSpeed : W.fanSpeed
  const lifeTicks = pattern === 'ring' ? W.boltLife : W.fanLife
  const spawnOffset = W.radius + 4
  const combinedHurtRadius = W.boltRadius + tuning.player.radius
  const damagingCenterTravel = speed * DT * Math.max(0, lifeTicks - 1)
  return {
    pattern,
    count: pattern === 'ring' ? W.boltCount : W.fanCount,
    spawnOffset,
    speed,
    lifeTicks,
    boltRadius: W.boltRadius,
    combinedHurtRadius,
    firstDamagingCenterReach: spawnOffset + speed * DT,
    damagingCenterTravel,
    fullDangerReach: spawnOffset + damagingCenterTravel + combinedHurtRadius,
    spread: pattern === 'fan' ? W.fanSpreadDeg * Math.PI / 180 : Math.PI * 2,
  }
}

export function wardenProjectileAngle(
  contract: WardenProjectileContract,
  aimAngle: number,
  patternCursor: number,
  index: number,
): number {
  if (contract.pattern === 'ring') {
    const offset = aimAngle + (patternCursor & 1 ? Math.PI / contract.count : 0)
    return offset + (Math.PI * 2 * index) / contract.count
  }
  const u = contract.count === 1 ? 0.5 : index / (contract.count - 1)
  return aimAngle + (u - 0.5) * contract.spread
}

// Exact terrain-clipped endpoint for the centre line used by a tell. It includes the combined hurt
// radius in open floor, but a wall still ends the promise at the wall instead of painting danger
// through cover.
export function wardenThreatReach(
  arena: Arena,
  originX: number,
  originY: number,
  angle: number,
  contract: WardenProjectileContract,
): number {
  return raycastSolidDistance(arena, originX, originY, angle, contract.fullDangerReach)
}

// Used by control-policy regression bots. This is the same finite, terrain-clipped capsule the tell
// depicts: being near an infinite mathematical ray is not a threat, and cover terminates it.
export function wardenLaneThreatensPoint(
  arena: Arena,
  originX: number,
  originY: number,
  angle: number,
  contract: WardenProjectileContract,
  pointX: number,
  pointY: number,
): boolean {
  const lastCenterReach = contract.spawnOffset + contract.damagingCenterTravel
  const reach = raycastSolidDistance(arena, originX, originY, angle, lastCenterReach)
  if (reach < contract.firstDamagingCenterReach) return false
  const dx = Math.cos(angle), dy = Math.sin(angle)
  const rx = pointX - originX, ry = pointY - originY
  const along = Math.max(contract.firstDamagingCenterReach, Math.min(reach, rx * dx + ry * dy))
  return Math.hypot(rx - dx * along, ry - dy * along) <= contract.combinedHurtRadius
}
