import { tuning } from '@/tuning'
import { setDoorWalkable } from './arena'
import { offerReward } from './rewards'
import { parkForModal, storeRunHealth, type MysteryChoice, type MysteryOffer } from './session'
import type { World } from './world'

const COUNTED = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
function counted(n: number, unit: string, plural: string): string {
  return `${COUNTED[n] ?? n} ${n === 1 ? unit : plural}`
}

export const MYSTERY_CHOICES: [MysteryChoice, MysteryChoice, MysteryChoice] = ['coin', 'memory', 'leave']

export const MYSTERY_COPY: Record<MysteryChoice, { name: string; get cost(): string; detail: string }> = {
  coin: {
    name: 'A COIN',
    get cost() { return counted(tuning.economy.mystery.coinCost, 'OBOL', 'OBOLS') },
    get detail() {
      const n = tuning.economy.mystery.coinHeal
      return n === 1 ? 'He drinks. One vessel stands.' : n === 2 ? 'He drinks. Two vessels stand.' : `He drinks. ${n} vessels stand.`
    },
  },
  memory: {
    name: 'A MEMORY',
    get cost() { return counted(tuning.economy.mystery.memoryCost, 'KEPT', 'KEPT') },
    get detail() {
      const n = tuning.economy.mystery.memoryVessel
      return n === 1 ? 'What you kept stands for one more breath.' : `What you kept stands for ${n} more breaths.`
    },
  },
  leave: {
    name: 'LEAVE HIM',
    cost: 'NOTHING NOW',
    detail: 'He follows you to the judge.',
  },
}

export function mysteryCost(choice: MysteryChoice): { kind: 'obols' | 'remembrances' | 'none'; amount: number } {
  const m = tuning.economy.mystery
  switch (choice) {
    case 'coin': return { kind: 'obols', amount: m.coinCost }
    case 'memory': return { kind: 'remembrances', amount: m.memoryCost }
    case 'leave': return { kind: 'none', amount: 0 }
    default: { const _e: never = choice; return _e }
  }
}

export function canAffordMystery(world: World, choice: MysteryChoice): boolean {
  const price = mysteryCost(choice)
  const run = world.session.run
  if (!run) return false
  switch (price.kind) {
    case 'obols': return run.obols >= price.amount
    case 'remembrances': return world.session.meta.remembrances >= price.amount
    case 'none': return true
    default: { const _e: never = price.kind; return _e }
  }
}

export function offerMystery(world: World): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  run.pendingMystery = { choices: MYSTERY_CHOICES, focus: 0 }
  world.roomPhase = 'reward'
  world.phaseTick = world.tick
  parkForModal(world)
  world.doorOpen = false
  setDoorWalkable(world.arena, false)
  world.emit({ type: 'mysteryOffered' })
}

function applyMystery(world: World, choice: MysteryChoice): void {
  const run = world.session.run
  if (!run) return
  const m = tuning.economy.mystery
  switch (choice) {
    case 'coin': {
      run.obols -= m.coinCost
      world.player.hp = Math.min(world.player.maxHp, world.player.hp + m.coinHeal)
      storeRunHealth(world)
      return
    }
    case 'memory': {
      world.session.meta.remembrances -= m.memoryCost
      world.player.maxHp += m.memoryVessel
      world.player.hp = Math.min(world.player.maxHp, world.player.hp + m.memoryVessel)
      storeRunHealth(world)
      return
    }
    case 'leave':
      run.mysteryHunt = true
      world.session.lastMystery = 'leave'
      return
    default: { const _e: never = choice; return _e }
  }
}

function closeMystery(world: World): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  if (run.riteBoonOwed) {
    run.riteBoonOwed = false
    offerReward(world, 'blade', true)
    return
  }
  world.roomPhase = 'exits'
  world.phaseTick = world.tick
  world.doorOpen = world.hasNextRoom()
  setDoorWalkable(world.arena, world.doorOpen)
}

export function updateMystery(world: World, input: { choiceDelta?: -1 | 0 | 1; confirm?: boolean }): void {
  const run = world.session.run
  const offer: MysteryOffer | null | undefined = run?.pendingMystery
  if (!offer || !run || world.roomPhase !== 'reward') return
  const delta = input.choiceDelta ?? 0
  if (delta) {
    offer.focus = ((offer.focus + delta + 3) % 3) as 0 | 1 | 2
    world.emit({ type: 'mysteryFocus', focus: offer.focus })
    return
  }
  if (world.tick - world.phaseTick < tuning.run.modalArmTicks) return
  if (!input.confirm) return
  const choice = offer.choices[offer.focus]
  if (!canAffordMystery(world, choice)) return
  applyMystery(world, choice)
  run.pendingMystery = null
  world.emit({ type: 'mysteryChosen', choice, x: world.player.x, y: world.player.y })
  closeMystery(world)
}
