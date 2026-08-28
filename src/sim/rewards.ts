import { setDoorWalkable } from './arena'
import { BOONS, BOON_IDS, DEITIES, grantBoon, hasBoon, type BoonId, type Deity } from './boons'
import type { InputFrame } from './input'
import type { RewardFamily } from './session'
import type { World } from './world'

function shuffled(world: World, ids: BoonId[]): BoonId[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = world.rng.int(0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// A vow that pays out only through another vow is a dead card until its partner exists. Offering
// Judgment with nothing to judge, or the duo before either half is in hand, spends one of a run's
// three choices on nothing — the fastest way to make a reward screen feel like a formality.
function usable(world: World, id: BoonId): boolean {
  const def = BOONS[id]
  if (def.requires?.some(req => !hasBoon(world, req))) return false
  if (id === 'finalJudgment') return hasBoon(world, 'ashenEdge') || hasBoon(world, 'betweenStep')
  // A pact needs both powers at the table, which is a rule about the run rather than about one vow.
  if (id === 'pyre') return BOON_IDS.some(other => BOONS[other].deity === 'hecate' && hasBoon(world, other))
  return true
}

// What the run is one step away from. This is the difference between a pool of effects and a build:
// once the player has shown an intent, the offer leans toward the piece that completes it — never
// guaranteeing the combination, only refusing to hide it.
const FOLLOWUPS: Array<[BoonId, BoonId]> = [
  // the duo first: with both halves owned it is the most interesting card in the deck
  ['finalJudgment', 'pyre'],
  ['torchlight', 'pyre'],
  // a mark needs a collector, and a collector needs a mark
  ['ashenEdge', 'finalJudgment'],
  ['finalJudgment', 'ashenEdge'],
  ['betweenStep', 'finalJudgment'],
  // fire wants more fire
  ['emberKiss', 'torchlight'],
  ['torchlight', 'emberKiss'],
  // anything that drops bodies wants the debt to keep moving
  ['finalJudgment', 'bloodDebt'],
  ['afterimage', 'ashenEdge'],
  ['mirrorSteel', 'ashenEdge'],
]

function synergyFollowup(world: World): BoonId | null {
  for (const [have, want] of FOLLOWUPS) {
    if (hasBoon(world, have) && !hasBoon(world, want) && usable(world, want)) return want
  }
  return null
}

export function deityFor(family: RewardFamily): Deity {
  return family === 'blade' ? DEITIES.fury.id : DEITIES.hecate.id
}

export function offerReward(world: World, family: RewardFamily, fromRite = false): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  const available = BOON_IDS.filter(id => !hasBoon(world, id) && usable(world, id))
  const speaker = deityFor(family)
  // The door's mark is a promise about who is waiting, not merely a weight. At least one vow from
  // the marked power always appears; the rest of the card may come from either.
  const preferred = shuffled(world, available.filter(id => BOONS[id].deity === speaker))
  const others = shuffled(world, available.filter(id => BOONS[id].deity !== speaker))
  const promised = preferred.shift()
  if (!promised) throw new Error(`no eligible ${family} boon remains for the marked reward`)
  const picked: BoonId[] = []
  const followup = synergyFollowup(world)
  if (followup && available.includes(followup)) picked.push(followup)
  if (!picked.includes(promised)) picked.push(promised)
  for (const id of [...preferred, ...others]) if (!picked.includes(id) && picked.length < 3) picked.push(id)
  // With twelve vows and three offers a run can never exhaust the pool, so this is an invariant.
  // Keeping the guard explicit makes a future content edit fail loudly instead of showing a blank card.
  if (picked.length < 3) throw new Error('reward pool exhausted before three choices could be offered')
  const options = picked.slice(0, 3) as [BoonId, BoonId, BoonId]
  run.pendingReward = { family, options, focus: 0, deity: speaker, fromRite }
  world.roomPhase = 'reward'
  world.phaseTick = world.tick
  world.timeScale = 1
  world.slowmoTicks = 0
  world.freeze = 0
  world.player.state = 'free'
  world.player.stateTick = 0
  world.player.attackQueuedAt = -1
  world.player.heavyQueuedAt = -1
  world.player.dodgeQueuedAt = -1
  world.player.dodgeTick = -1
  world.player.dodgeRead = 0
  world.player.dodgeProcTick = -1
  world.player.vx = world.player.vy = 0
  world.doorOpen = false
  setDoorWalkable(world.arena, false)
  world.emit({ type: 'rewardOffered', options, deity: speaker })
}

export function updateReward(world: World, input: InputFrame): void {
  const offer = world.session.run?.pendingReward
  if (!offer || world.roomPhase !== 'reward') return
  const delta = input.choiceDelta ?? 0
  if (delta) {
    offer.focus = ((offer.focus + delta + 3) % 3) as 0 | 1 | 2
    world.emit({ type: 'rewardFocus', focus: offer.focus })
  }
  if (!input.confirm) return
  const id = offer.options[offer.focus]
  grantBoon(world, id)
  const run = world.session.run
  if (run) run.pendingReward = null
  // What the ferryman was paid with, handed over the moment the bank is clear. It comes from the
  // other side of the crossroads than the room's own mark: the coin in his hand was somebody else's.
  if (run?.riteBoonOwed && run.result === 'active') {
    run.riteBoonOwed = false
    world.emit({ type: 'boonChosen', boon: id, x: world.player.x, y: world.player.y })
    offerReward(world, offer.family === 'blade' ? 'veil' : 'blade', true)
    return
  }
  world.roomPhase = 'exits'
  world.phaseTick = world.tick
  world.doorOpen = world.hasNextRoom()
  setDoorWalkable(world.arena, world.doorOpen)
  world.emit({ type: 'boonChosen', boon: id, x: world.player.x, y: world.player.y })
}
