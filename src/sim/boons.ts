import { tuning, type SwingDef } from '@/tuning'
import type { Enemy, World } from './world'
import type { RewardFamily } from './session'
import { damageEnemy, type DamageResult } from './combat'
import { applyBrand, applyBurn } from './status'
import { hasLineOfSight } from './collision'

// Append-only integer flags keep replay hashes compact. The original `cleave` id remains the
// canonical code name; its authored player-facing name is Cleaving Grace.
export const BOON = {
  cleave: 1 << 0,
  ashenEdge: 1 << 1,
  finalJudgment: 1 << 2,
  betweenStep: 1 << 3,
  mirrorSteel: 1 << 4,
  afterimage: 1 << 5,
  emberKiss: 1 << 6,
  bloodDebt: 1 << 7,
  unanswered: 1 << 8,
  torchlight: 1 << 9,
  crossroads: 1 << 10,
  pyre: 1 << 11,
} as const
export type BoonId = keyof typeof BOON

// Two powers keep this realm, and neither is an Olympian: the gods of the sky have no business in
// the country of the dead. Both were chosen because the game's own premise summons them.
//
// THE KINDLY ONES are the Erinyes, who pursue exactly one crime — blood spilled and oaths broken —
// which is the crime the protagonist is here to answer for. They are called kindly the way a wound
// is called clean: to avoid saying the true name aloud. Their gifts are not gifts. Every one of them
// is a debt written on someone else, and the mechanic is the same as the myth: you mark a thing, and
// what is owed comes due.
//
// HECATE holds the torch at the crossroads. She is the goddess of the threshold, of the moment
// between one place and the next — which is what this whole game is named after. Her vows are all
// about passage: the step through, the way back, the door that is also a weapon. She faces three
// ways at once, which is why her boons pay out for going where you were not.
export type Deity = 'fury' | 'hecate'

export interface DeityDef {
  id: Deity
  name: string
  epithet: string
  family: RewardFamily
  /** Spoken once, when the offer appears. Written to be read in under two seconds. */
  greeting: string
}

export const DEITIES: Record<Deity, DeityDef> = {
  fury: {
    id: 'fury', name: 'THE KINDLY ONE', epithet: 'she who remembers the blood', family: 'blade',
    greeting: 'I know the count. Let me help you add to it.',
  },
  hecate: {
    id: 'hecate', name: 'HECATE', epithet: 'torchbearer at the crossroads', family: 'veil',
    greeting: 'Every door is a choice. I light both sides.',
  },
}

export interface BoonDef {
  id: BoonId
  name: string
  deity: Deity
  family: RewardFamily
  vow: string
  detail: string
  /** A duo vow is never offered until its prerequisites are already in hand. */
  requires?: BoonId[]
}

export const BOONS: Record<BoonId, BoonDef> = {
  cleave: {
    id: 'cleave', name: 'CLEAVING GRACE', deity: 'fury', family: 'blade', vow: 'Claim the room.',
    detail: 'The blade takes more of the room with it.',
  },
  ashenEdge: {
    id: 'ashenEdge', name: 'ASHEN EDGE', deity: 'fury', family: 'blade', vow: 'Write their ending.',
    detail: 'Every light writes a mark. Three is a sentence.',
  },
  finalJudgment: {
    id: 'finalJudgment', name: 'FINAL JUDGMENT', deity: 'fury', family: 'blade', vow: 'Commit. Then collect.',
    detail: 'The committed blow spends every mark in a burst.',
  },
  emberKiss: {
    id: 'emberKiss', name: "PHLEGETHON'S KISS", deity: 'fury', family: 'blade', vow: 'Let the river taste them.',
    detail: 'The committed blow leaves them burning.',
  },
  bloodDebt: {
    id: 'bloodDebt', name: 'THE DEBT PASSES', deity: 'fury', family: 'blade', vow: 'It is never settled.',
    detail: 'When one falls, the mark finds the next.',
  },
  unanswered: {
    id: 'unanswered', name: 'UNANSWERED', deity: 'fury', family: 'blade', vow: 'Do not let them finish.',
    detail: 'Catch them mid-word and the blow is twice as cruel.',
  },
  betweenStep: {
    id: 'betweenStep', name: 'BETWEEN-STEP', deity: 'hecate', family: 'veil', vow: 'Pass through fear.',
    detail: 'Pass through them and the next blow writes the whole sentence.',
  },
  mirrorSteel: {
    id: 'mirrorSteel', name: 'MIRROR STEEL', deity: 'hecate', family: 'veil', vow: 'Return what was sent.',
    detail: 'Cut what they send. Send it back through them.',
  },
  afterimage: {
    id: 'afterimage', name: 'AFTERIMAGE', deity: 'hecate', family: 'veil', vow: 'Leave an edge behind.',
    detail: 'The step through leaves a blade where you were.',
  },
  torchlight: {
    id: 'torchlight', name: 'TORCHLIGHT', deity: 'hecate', family: 'veil', vow: 'Show them the way down.',
    detail: 'The step through lights whoever stands nearest.',
  },
  crossroads: {
    id: 'crossroads', name: 'CROSSROADS', deity: 'hecate', family: 'veil', vow: 'Arrive from everywhere.',
    detail: 'Come out of the roll swinging, and you cut every side.',
  },
  // The duo, and the only place the two powers agree: she marks the debt, and the river collects it
  // from everyone standing near. It needs Final Judgment plus ANY vow of Hecate's — naming two
  // specific boons made it unreachable, because the shortest path to both was four picks long in a
  // run that grants three. The reachable path is a Hecate vow that primes the mark, then Judgment to
  // collect it, then this; both powers are represented, which is the whole point of a pact.
  pyre: {
    id: 'pyre', name: 'PYRE', deity: 'fury', family: 'blade', vow: 'Let the whole room answer.',
    detail: 'The collection sets everyone it touches on fire.',
    requires: ['finalJudgment'],
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
  // Hecate's crossroads: a swing thrown out of a roll arrives from every direction at once. The
  // reach is unchanged — this buys coverage, not range, so it rewards diving INTO a crowd. It reads
  // the flag the press latched, not the live roll clock: that clock is already dead by the time a
  // heavy out of a roll gets its blade out, so the leap — the one swing the vow is written for —
  // was the only swing that never got the circle.
  if (hasBoon(world, 'crossroads') && world.player.swingFromRoll) reach.arcDeg = 360
  return reach
}

export { applyBrand, applyBurn }

// Called by any friendly weapon result: blade, reflected bolt, or afterimage. Keeping one hook is
// what makes the interactions discoverable instead of a list of exceptions.
export function resolveWeaponOnHit(
  world: World,
  enemy: Enemy,
  heavy: boolean,
  brandBefore: number,
  angle: number,
  sourceActionId = world.player.swingId,
  result?: DamageResult,
): void {
  // Trigger priority is part of the combo contract: Between-Step marks first, then a heavy may cash
  // that mark through Final Judgment on the very same hit. The prime is spent by any weapon hit.
  const run = world.session.run
  const primed = !!run?.primedBrand
  let resolvedBrand = brandBefore
  if (primed) {
    applyBrand(world, enemy, tuning.boons.brandMax)
    resolvedBrand = enemy.brand
    run!.primedBrand = false
  }

  if (heavy && hasBoon(world, 'finalJudgment') && resolvedBrand > 0) {
    enemy.brand = 0
    enemy.brandTicks = 0
    const damage = resolvedBrand * tuning.boons.judgmentDamage
    const radius = tuning.boons.judgmentRadius
    const originX = enemy.x, originY = enemy.y
    world.emit({ type: 'brandConsumed', id: enemy.id, stacks: resolvedBrand, x: enemy.x, y: enemy.y })
    for (const target of world.enemies) {
      if (!target.active || target.state === 'dead' || Math.hypot(target.x - originX, target.y - originY) > radius + target.radius) continue
      if (!hasLineOfSight(world.arena, originX, originY, target.x, target.y)) continue
      const hitAngle = target.id === enemy.id ? angle : Math.atan2(target.y - enemy.y, target.x - enemy.x)
      // Pyre first: a body the burst is about to kill should still have caught fire, so the duo
      // reads the same whether the target survives the blast or not.
      if (hasBoon(world, 'pyre')) applyBurn(world, target, tuning.boons.pyreBurn, sourceActionId)
      damageEnemy(world, target, damage, hitAngle, tuning.boons.judgmentKnockback, true, tuning.boons.judgmentHitstop, sourceActionId, {
        source: 'judgment',
        originX, originY,
        direction: hitAngle,
        sweep: 0,
        cleave: false,
        contactDepth: Math.hypot(target.x - originX, target.y - originY) / Math.max(1, radius),
      })
    }
  }

  // The heavy's own riders. Ember Kiss is unconditional; Unanswered pays only for the read — a
  // committed swing that lands inside someone else's wind-up, which is the whole reason the weight
  // has its own button.
  if (heavy) {
    if (hasBoon(world, 'emberKiss')) applyBurn(world, enemy, tuning.boons.emberKissBurn, sourceActionId)
    if (hasBoon(world, 'unanswered') && result?.interrupted) {
      world.emit({ type: 'interrupt', id: enemy.id, x: enemy.x, y: enemy.y })
      damageEnemy(world, enemy, tuning.boons.unansweredDamage, angle, tuning.boons.unansweredKnockback, true, tuning.boons.unansweredHitstop, sourceActionId, {
        source: 'judgment',
        originX: enemy.x,
        originY: enemy.y,
        direction: angle,
        sweep: 0,
        cleave: false,
        contactDepth: 0,
      })
    }
  }

  if (!heavy && !primed && hasBoon(world, 'ashenEdge')) applyBrand(world, enemy, 1)
}

// The debt outlives the debtor. Called from the kill path, so it fires however the body fell.
export function resolveKill(world: World, enemy: Enemy): void {
  if (!hasBoon(world, 'bloodDebt') || enemy.brand <= 0) return
  let best: Enemy | null = null
  let bestD = tuning.boons.debtRange * tuning.boons.debtRange
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead' || e.id === enemy.id) continue
    const d = (e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2
    if (d < bestD) { bestD = d; best = e }
  }
  if (!best) return
  applyBrand(world, best, enemy.brand)
  world.emit({ type: 'brandPassed', fromX: enemy.x, fromY: enemy.y, toX: best.x, toY: best.y, stacks: enemy.brand })
}

// Swing ids are non-negative and the feedback gate reserves -1 as its empty sentinel. The world
// tick is unique for each real perfect-dodge trigger, so this namespace cannot collide with either
// blade/draw actions or another dodge during the same Presenter lifecycle.
export function afterimageActionId(triggerTick: number): number {
  return -triggerTick - 2
}

export function triggerPerfectDodge(world: World): void {
  if (hasBoon(world, 'betweenStep') && world.session.run) world.session.run.primedBrand = true

  // Hecate's torch finds the nearest body in the dark. One target, so it stays a reward for the
  // read rather than a room-wide answer to having been read.
  if (hasBoon(world, 'torchlight')) {
    const p = world.player
    let best: Enemy | null = null
    let bestD = tuning.boons.torchRange * tuning.boons.torchRange
    for (const e of world.enemies) {
      if (!e.active || e.state === 'dead') continue
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2
      if (d < bestD) { bestD = d; best = e }
    }
    if (best) applyBurn(world, best, tuning.boons.torchBurn, afterimageActionId(world.tick))
  }

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
    afterimageActionId(world.tick),
    'echo',
  )
}
