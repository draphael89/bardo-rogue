import { tuning } from '@/tuning'
import type { Enemy, World } from './world'
import { damageEnemy } from './combat'

// Statuses are the vocabulary boons compose through. There are two, and they are deliberately
// different shapes rather than two flavours of the same thing:
//
//   BRAND is a debt. It does nothing on its own and only pays out when something collects it, which
//   is why every Brand boon is really a boon about *when you choose to cash in*.
//   BURN is a sentence already being carried out. It needs no follow-up and cannot be banked.
//
// Both live as named fields on Enemy rather than a generic slot array: at two statuses an array is
// indirection with no payer, and named fields stay cheap, hashable and readable in a state dump.
// The behaviour is shared here so a third status is an edit to one file, not an archaeology project.

export function applyBrand(world: World, enemy: Enemy, stacks: number): void {
  if (!alive(enemy) || stacks <= 0) return
  enemy.brand = Math.min(tuning.boons.brandMax, enemy.brand + stacks)
  enemy.brandTicks = tuning.boons.brandTicks
  world.emit({ type: 'brandApplied', id: enemy.id, stacks: enemy.brand, x: enemy.x, y: enemy.y })
}

// The river's touch. Stacks deepen it and refresh its clock; they never extend it past its authored
// life, so a crowd that keeps catching fire still burns out on a schedule the player can read.
export function applyBurn(world: World, enemy: Enemy, stacks: number, actionId: number): void {
  if (!alive(enemy) || stacks <= 0) return
  const B = tuning.status.burn
  const before = enemy.burn
  enemy.burn = Math.min(B.maxStacks, enemy.burn + stacks)
  enemy.burnTicks = B.ticks
  enemy.burnActionId = actionId
  // A fresh ignition starts its first bite promptly; a refresh does not restart the meter, or
  // re-applying every half second would keep the damage permanently one tick away.
  if (before === 0) enemy.burnAcc = B.interval
  world.emit({ type: 'burnApplied', id: enemy.id, stacks: enemy.burn, x: enemy.x, y: enemy.y })
}

// One call per enemy per world tick, from the enemy update. Expiry and damage both live here so the
// two statuses can never drift out of step with each other or with the slow-motion clock.
export function tickStatuses(world: World, enemy: Enemy): void {
  if (enemy.brandTicks > 0 && --enemy.brandTicks === 0) enemy.brand = 0
  if (enemy.burn <= 0) return

  const B = tuning.status.burn
  if (enemy.burnTicks > 0 && --enemy.burnTicks === 0) {
    enemy.burn = 0
    enemy.burnAcc = 0
    enemy.burnActionId = -1
    world.emit({ type: 'burnEnded', id: enemy.id, x: enemy.x, y: enemy.y })
    return
  }
  if (--enemy.burnAcc > 0) return
  enemy.burnAcc = B.interval
  if (!alive(enemy)) return
  // Fire has no direction and earns no hit-stop: it is a consequence, not a blow. Freezing the game
  // on a damage-over-time tick would stutter the whole fight every time a crowd was alight.
  world.emit({ type: 'burnTick', id: enemy.id, stacks: enemy.burn, x: enemy.x, y: enemy.y })
  damageEnemy(world, enemy, B.damage * enemy.burn, enemy.aimAngle, 0, false, 0, enemy.burnActionId, {
    source: 'backlash',
    originX: enemy.x,
    originY: enemy.y,
    direction: enemy.aimAngle,
    sweep: 0,
    cleave: false,
    contactDepth: 0,
  }, { silent: true })
}

export function clearStatuses(enemy: Enemy): void {
  enemy.brand = 0; enemy.brandTicks = 0
  enemy.burn = 0; enemy.burnTicks = 0; enemy.burnAcc = 0; enemy.burnActionId = -1
}

function alive(e: Enemy): boolean {
  return e.active && e.state !== 'dead'
}
