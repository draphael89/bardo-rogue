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
  phase: 0 | 1
  count: number
  volleys: number
  spawnOffset: number
  speed: number
  lifeTicks: number
  boltRadius: number
  combinedHurtRadius: number
  firstDamagingCenterReach: number
  damagingCenterTravel: number
  fullDangerReach: number
  spread: number
  returnSweep: number
}

export function wardenProjectileContract(pattern: WardenProjectilePattern, phase: number): WardenProjectileContract {
  const W = tuning.warden
  const p2 = phase > 0
  const speed = pattern === 'ring' ? (p2 ? W.boltSpeed2 : W.boltSpeed) : (p2 ? W.fanSpeed2 : W.fanSpeed)
  const lifeTicks = pattern === 'ring' ? W.boltLife : W.fanLife
  const spawnOffset = W.radius + 4
  const combinedHurtRadius = W.boltRadius + tuning.player.radius
  const damagingCenterTravel = speed * DT * Math.max(0, lifeTicks - 1)
  return {
    pattern,
    phase: p2 ? 1 : 0,
    count: pattern === 'ring' ? (p2 ? W.boltCount2 : W.boltCount) : (p2 ? W.fanCount2 : W.fanCount),
    volleys: pattern === 'fan' && p2 ? W.fanVolleys2 : 1,
    spawnOffset,
    speed,
    lifeTicks,
    boltRadius: W.boltRadius,
    combinedHurtRadius,
    firstDamagingCenterReach: spawnOffset + speed * DT,
    damagingCenterTravel,
    fullDangerReach: spawnOffset + damagingCenterTravel + combinedHurtRadius,
    spread: pattern === 'fan' ? W.fanSpreadDeg * Math.PI / 180 : Math.PI * 2,
    returnSweep: pattern === 'fan' && p2 ? W.fanVolleySweepDeg * Math.PI / 180 : 0,
  }
}

// The phase-two fan's second beat sweeps across the first rather than repeating it. Alternating the
// direction per authored pattern cycle prevents a permanent preferred side without drawing RNG.
export function wardenProjectileAngle(
  contract: WardenProjectileContract,
  aimAngle: number,
  patternCursor: number,
  index: number,
  volley = 0,
): number {
  if (contract.pattern === 'ring') {
    const offset = aimAngle + (patternCursor & 1 ? Math.PI / contract.count : 0)
    return offset + (Math.PI * 2 * index) / contract.count
  }
  const u = contract.count === 1 ? 0.5 : index / (contract.count - 1)
  const sweepSign = patternCursor & 1 ? 1 : -1
  const sweptReturn = volley > 0 ? contract.returnSweep * sweepSign : 0
  return aimAngle + sweptReturn + (u - 0.5) * contract.spread
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
