import { tuning } from '@/tuning'
import { setDoorWalkable } from './arena'
import type { EnemyKind } from './events'
import { offerReward } from './rewards'
import { parkForModal, storeRunHealth, type ShopGood, type ShopOffer } from './session'
import type { World } from './world'

export const SHOP_GOODS: [ShopGood, ShopGood, ShopGood] = ['heal', 'vessel', 'vow']

const COUNTED = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE']
export function obolsLabel(n: number): string {
  return `${COUNTED[n] ?? n} OBOL${n === 1 ? '' : 'S'}`
}

/** Charon sells in the same grammar as the toll: price first, then what you get. */
export const SHOP_COPY: Record<ShopGood, { name: string; get cost(): string; detail: string }> = {
  heal: {
    name: 'A SIP',
    get cost() { return obolsLabel(tuning.economy.shop.healCost) },
    get detail() {
      const n = tuning.economy.shop.healAmount
      return `${n === 1 ? 'One vessel' : n === 2 ? 'Two vessels' : `${n} vessels`}. Drink, and stand.`
    },
  },
  vessel: {
    name: 'A CUP',
    get cost() { return obolsLabel(tuning.economy.shop.vesselCost) },
    get detail() {
      const n = tuning.economy.shop.vesselAmount
      return `${n === 1 ? 'One more breath' : `${n} more breaths`} the boat will hold.`
    },
  },
  vow: {
    name: 'A WORD',
    get cost() { return obolsLabel(tuning.economy.shop.vowCost) },
    detail: 'He names what a god would give.',
  },
}

export function remembrancesFor(depth: number, won: boolean): number {
  return depth * tuning.economy.remembrancePerDepth
    + (won ? tuning.economy.remembranceOnVictory : 0)
}

export function shopCost(good: ShopGood): number {
  const s = tuning.economy.shop
  switch (good) {
    case 'heal': return s.healCost
    case 'vessel': return s.vesselCost
    case 'vow': return s.vowCost
    default: { const _e: never = good; return _e }
  }
}

export function grantObols(world: World, amount: number): void {
  const run = world.session.run
  if (!run || run.result !== 'active' || amount <= 0) return
  run.obols += amount
  world.emit({ type: 'obolsGained', amount, total: run.obols })
}

export function grantKillObols(world: World, kind: EnemyKind): void {
  grantObols(world, tuning.economy.obolsPerKill[kind])
}

export function grantClearObols(world: World): void {
  grantObols(world, tuning.economy.obolsPerClear)
}

export function offerShop(world: World): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  run.pendingShop = { goods: SHOP_GOODS, focus: 0 }
  world.roomPhase = 'reward'
  world.phaseTick = world.tick
  parkForModal(world)
  world.doorOpen = false
  setDoorWalkable(world.arena, false)
  world.emit({ type: 'shopOffered', purse: run.obols })
}

function applyGood(world: World, good: ShopGood): void {
  const p = world.player
  const s = tuning.economy.shop
  switch (good) {
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + s.healAmount)
      storeRunHealth(world)
      return
    case 'vessel':
      p.maxHp += s.vesselAmount
      p.hp = Math.min(p.maxHp, p.hp + s.vesselAmount)
      storeRunHealth(world)
      return
    case 'vow':
      offerReward(world, 'veil')
      return
    default: { const _e: never = good; return _e }
  }
}

export function updateShop(world: World, input: { choiceDelta?: -1 | 0 | 1; confirm?: boolean }): void {
  const run = world.session.run
  const offer: ShopOffer | null | undefined = run?.pendingShop
  if (!offer || !run || world.roomPhase !== 'reward') return
  const delta = input.choiceDelta ?? 0
  if (delta) {
    offer.focus = ((offer.focus + delta + 3) % 3) as 0 | 1 | 2
    world.emit({ type: 'shopFocus', focus: offer.focus })
    return
  }
  if (world.tick - world.phaseTick < tuning.run.modalArmTicks) return
  if (!input.confirm) return
  const good = offer.goods[offer.focus]
  const cost = shopCost(good)
  if (run.obols < cost) return
  run.obols -= cost
  run.pendingShop = null
  world.emit({ type: 'shopBought', good, cost, purse: run.obols })
  applyGood(world, good)
  if (good === 'vow') return
  // Heal and vessel stand in for the landing's old veil offer. The ferryman's paid-out blade
  // still arrives — it was bought with a vessel of life, not with this coin.
  if (run.riteBoonOwed && run.result === 'active') {
    run.riteBoonOwed = false
    offerReward(world, 'blade', true)
    return
  }
  world.roomPhase = 'exits'
  world.phaseTick = world.tick
  world.doorOpen = world.hasNextRoom()
  setDoorWalkable(world.arena, world.doorOpen)
}
