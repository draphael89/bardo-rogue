import { tuning, type SwingDef } from '@/tuning'
import type { Enemy, World } from './world'
import type { RewardFamily } from './session'
import { damageEnemy } from './combat'

// Append-only integer flags keep replay hashes compact. The original `cleave` id remains the
// canonical code name; its authored player-facing name is Cleaving Grace.
export const BOON = {
  cleave: 1 << 0,
  ashenEdge: 1 << 1,
  finalJudgment: 1 << 2,
  betweenStep: 1 << 3,
  mirrorSteel: 1 << 4,
  afterimage: 1 << 5,
} as const
export type BoonId = keyof typeof BOON

export interface BoonDef {
  id: BoonId
  name: string
  family: RewardFamily
  vow: string
  detail: string
}

export const BOONS: Record<BoonId, BoonDef> = {
  cleave: {
    id: 'cleave', name: 'CLEAVING GRACE', family: 'blade', vow: 'Claim the room.',
    detail: 'Light swings carve a wider, longer arc.',
  },
  ashenEdge: {
    id: 'ashenEdge', name: 'ASHEN EDGE', family: 'blade', vow: 'Write their ending.',
    detail: 'Light weapon hits Brand foes, up to 3.',
  },
  finalJudgment: {
    id: 'finalJudgment', name: 'FINAL JUDGMENT', family: 'blade', vow: 'Commit. Then collect.',
    detail: 'Heavy hits consume Brand in a damaging burst.',
  },
  betweenStep: {
    id: 'betweenStep', name: 'BETWEEN-STEP', family: 'veil', vow: 'Pass through fear.',
    detail: 'A perfect dodge primes your next hit for 3 Brand.',
  },
  mirrorSteel: {
    id: 'mirrorSteel', name: 'MIRROR STEEL', family: 'veil', vow: 'Return what was sent.',
    detail: 'Cut hostile bolts to reflect them through enemies.',
  },
  afterimage: {
    id: 'afterimage', name: 'AFTERIMAGE', family: 'veil', vow: 'Leave an edge behind.',
    detail: 'A perfect dodge releases a short weapon echo.',
  },
}

export const BOON_IDS = Object.keys(BOON) as BoonId[]

export function hasBoon(world: World, id: BoonId): boolean {
  return (world.boonBits & BOON[id]) !== 0
}

export function activeBoons(world: World): BoonId[] {
  return BOON_IDS.filter(id => hasBoon(world, id))
}

export function grantBoon(world: World, id: BoonId): void {
  if (hasBoon(world, id)) return
  world.boonBits |= BOON[id]
  const run = world.session.run
  if (run) {
    run.boonBits = world.boonBits
    run.boons.push({ id, stacks: 1 })
  }
}

// Effective swing numbers. No allocation: callers read fields and discard.
const reach = { radius: 0, arcDeg: 0, damage: 0 }

export function swingReach(world: World, s: SwingDef): { radius: number; arcDeg: number; damage: number } {
  reach.radius = s.radius
  reach.arcDeg = s.arcDeg
  reach.damage = s.damage
  if (hasBoon(world, 'cleave') && !s.heavy) {
    const b = tuning.boons.cleave
    reach.radius += b.radiusAdd
    reach.arcDeg += b.arcAdd
    reach.damage += b.damageAdd
  }
  return reach
}

export function applyBrand(world: World, enemy: Enemy, stacks: number): void {
  if (!enemy.active || enemy.state === 'dead' || stacks <= 0) return
  enemy.brand = Math.min(tuning.boons.brandMax, enemy.brand + stacks)
  enemy.brandTicks = tuning.boons.brandTicks
  world.emit({ type: 'brandApplied', id: enemy.id, stacks: enemy.brand, x: enemy.x, y: enemy.y })
}

// Called by any friendly weapon result: blade, reflected bolt, or afterimage. Keeping one hook is
// what makes the interactions discoverable instead of a list of exceptions.
export function resolveWeaponOnHit(world: World, enemy: Enemy, heavy: boolean, brandBefore: number, angle: number): void {
  if (heavy && hasBoon(world, 'finalJudgment') && brandBefore > 0) {
    enemy.brand = 0
    enemy.brandTicks = 0
    const damage = brandBefore * tuning.boons.judgmentDamage
    const radius = tuning.boons.judgmentRadius
    const targets = world.enemies.filter(e => e.active && e.state !== 'dead' && Math.hypot(e.x - enemy.x, e.y - enemy.y) <= radius + e.radius)
    world.emit({ type: 'brandConsumed', id: enemy.id, stacks: brandBefore, x: enemy.x, y: enemy.y })
    for (const target of targets) {
      const hitAngle = target.id === enemy.id ? angle : Math.atan2(target.y - enemy.y, target.x - enemy.x)
      damageEnemy(world, target, damage, hitAngle, tuning.boons.judgmentKnockback, true, tuning.boons.judgmentHitstop)
    }
  }

  if (!heavy) {
    const primed = !!world.session.run?.primedBrand
    if (hasBoon(world, 'ashenEdge') || primed) applyBrand(world, enemy, primed ? tuning.boons.brandMax : 1)
    if (primed && world.session.run) world.session.run.primedBrand = false
  }
}

export function triggerPerfectDodge(world: World): void {
  if (hasBoon(world, 'betweenStep') && world.session.run) world.session.run.primedBrand = true
  if (!hasBoon(world, 'afterimage')) return
  const p = world.player
  const angle = Math.atan2(p.dodgeDirY, p.dodgeDirX)
  world.fireProjectile(
    p.x + Math.cos(angle) * 7,
    p.y + Math.sin(angle) * 7,
    angle,
    tuning.boons.echoSpeed,
    tuning.boons.echoRadius,
    tuning.boons.echoLife,
    1,
    tuning.boons.echoDamage,
    world.player.swingId,
    'echo',
  )
}
