import { tuning } from '@/tuning'
import { applyTownHealth } from './session'
import type { World } from './world'

export type SmithBeat = 'stranger' | 'afterDeath' | 'afterVictory' | 'unburied' | 'sold' | 'vesselWait' | 'vesselSold' | 'owned'

const KEPT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'] as const

function keptCount(n: number): string {
  return KEPT_WORDS[n] ?? String(n)
}

export const SMITH_LINES: Record<SmithBeat, string> = {
  get stranger() {
    return `Bring ${keptCount(tuning.economy.smith.rerollCost).toLowerCase()} of what the dead keep. Strike when you mean to turn the next offer.`
  },
  afterDeath: 'You came back thinner. The anvil still spends.',
  afterVictory: 'Minos named you. I do not.',
  unburied: 'You left one on the bank. He will not stay there.',
  sold: 'Once a descent I will turn the offer. After that you live with it.',
  get vesselWait() {
    return `${keptCount(tuning.economy.smith.vesselCost)} of what you kept. Strike when you mean to forge a cup that does not spill.`
  },
  vesselSold: 'The boat holds one more. Every descent from here.',
  owned: 'It is already in the steel. Go.',
}

function beatOf(world: World, bought: 'reroll' | 'vessel' | null): SmithBeat {
  const m = world.session.meta
  // The one you left is the first thing he is allowed to say. Approach clears it before
  // any later purchase can answer with its own line.
  if (world.session.lastMystery === 'leave') return 'unburied'
  if (bought === 'reroll') return 'sold'
  if (bought === 'vessel') return 'vesselSold'
  if (m.rerollUnlocked && m.vesselUnlocked) return 'owned'
  if (m.rerollUnlocked) return 'vesselWait'
  if (m.victories > 0) return 'afterVictory'
  if (m.attempts > 0) return 'afterDeath'
  return 'stranger'
}

/** Approach starts the meeting. A later light-action edge makes the purchase deliberate. */
export function tryTalkSmith(world: World, confirm: boolean): void {
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
  if (!world.arena.smithNear) {
    world.arena.smithNear = true
    const beat = beatOf(world, null)
    if (beat === 'unburied') world.session.lastMystery = null
    world.emit({ type: 'smithSpoke', beat, line: SMITH_LINES[beat], x: smith.x, y: smith.y })
    return
  }
  if (!confirm) return

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
  if (!bought) return
  const beat = beatOf(world, bought)
  if (beat === 'unburied') world.session.lastMystery = null
  world.emit({ type: 'smithSpoke', beat, line: SMITH_LINES[beat], x: smith.x, y: smith.y })
}
