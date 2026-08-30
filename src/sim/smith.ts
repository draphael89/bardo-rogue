import { tuning } from '@/tuning'
import { applyTownHealth } from './session'
import type { World } from './world'

export type SmithBeat = 'stranger' | 'afterDeath' | 'afterVictory' | 'unburied' | 'commit' | 'cut' | 'sold' | 'vesselWait' | 'vesselSold' | 'owned'

const KEPT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'] as const

function keptCount(n: number): string {
  return KEPT_WORDS[n] ?? String(n)
}

export const SMITH_LINES: Record<SmithBeat, string> = {
  get stranger() {
    return `Bring ${keptCount(tuning.economy.smith.rerollCost).toLowerCase()} of what the dead keep. I turn the next offer.`
  },
  afterDeath: 'You came back thinner. The anvil still spends.',
  afterVictory: 'Minos named you. I do not.',
  unburied: 'You left one on the bank. He will not stay there.',
  commit: 'You chose the weight. The judge keeps the circle.',
  cut: 'You chose the crossing. The judge keeps the veil.',
  sold: 'Once a descent I will turn the offer. After that you live with it.',
  get vesselWait() {
    return `${keptCount(tuning.economy.smith.vesselCost)} of what you kept. A cup that does not spill on the way home.`
  },
  vesselSold: 'The boat holds one more. Every descent from here.',
  owned: 'It is already in the steel. Go.',
}

function beatOf(world: World, bought: 'reroll' | 'vessel' | null): SmithBeat {
  const m = world.session.meta
  // The one you left is the first thing he is allowed to say. A cup bought on the same
  // step still stays; its line waits for the next approach.
  if (world.session.lastMystery === 'leave') return 'unburied'
  if (world.session.lastAttempt?.contract) return world.session.lastAttempt.contract
  if (bought === 'reroll') return 'sold'
  if (bought === 'vessel') return 'vesselSold'
  if (m.rerollUnlocked && m.vesselUnlocked) return 'owned'
  if (m.rerollUnlocked) return 'vesselWait'
  if (m.victories > 0) return 'afterVictory'
  if (m.attempts > 0) return 'afterDeath'
  return 'stranger'
}

/** Walk-in, once per approach. Buying is the same verb as taking the blade. */
export function tryTalkSmith(world: World): void {
  if (world.roomPhase !== 'town') return
  const smith = world.arena.smith
  if (!smith) return
  const p = world.player
  const dx = p.x - smith.x
  const dy = p.y - smith.y
  const r = tuning.economy.smith.radius
  const near = dx * dx + dy * dy <= r * r
  if (!near) {
    world.arena.smithNear = false
    return
  }
  if (world.arena.smithNear) return
  world.arena.smithNear = true

  const meta = world.session.meta
  const s = tuning.economy.smith
  let bought: 'reroll' | 'vessel' | null = null
  if (!meta.rerollUnlocked && meta.remembrances >= s.rerollCost) {
    meta.remembrances -= s.rerollCost
    meta.rerollUnlocked = true
    bought = 'reroll'
    world.emit({ type: 'rerollUnlocked', cost: s.rerollCost, remembrances: meta.remembrances })
  } else if (meta.rerollUnlocked && !meta.vesselUnlocked && meta.remembrances >= s.vesselCost) {
    meta.remembrances -= s.vesselCost
    meta.vesselUnlocked = true
    bought = 'vessel'
    applyTownHealth(world)
    world.emit({ type: 'vesselUnlocked', cost: s.vesselCost, remembrances: meta.remembrances })
  }
  const beat = beatOf(world, bought)
  if (beat === 'unburied') world.session.lastMystery = null
  if (beat === 'commit' || beat === 'cut') world.session.lastAttempt = null
  world.emit({ type: 'smithSpoke', beat, line: SMITH_LINES[beat], x: smith.x, y: smith.y })
}
