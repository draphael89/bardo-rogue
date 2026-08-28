import { setDoorWalkable } from './arena'
import { BOONS, BOON_IDS, grantBoon, hasBoon, type BoonId } from './boons'
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

function synergyFollowup(world: World): BoonId | null {
  if (hasBoon(world, 'ashenEdge') && !hasBoon(world, 'finalJudgment')) return 'finalJudgment'
  if (hasBoon(world, 'finalJudgment') && !hasBoon(world, 'ashenEdge')) return 'ashenEdge'
  if (hasBoon(world, 'betweenStep') && !hasBoon(world, 'finalJudgment')) return 'finalJudgment'
  if (hasBoon(world, 'afterimage') && !hasBoon(world, 'ashenEdge')) return 'ashenEdge'
  if (hasBoon(world, 'mirrorSteel') && !hasBoon(world, 'ashenEdge')) return 'ashenEdge'
  return null
}

export function offerReward(world: World, family: RewardFamily): void {
  const run = world.session.run
  if (!run || run.result !== 'active') return
  // Judgment is a payoff, not a promise. Offering it before the run has any way to create Brand
  // would make the player's first reward do literally nothing in the next room.
  const canBrand = hasBoon(world, 'ashenEdge') || hasBoon(world, 'betweenStep')
  const available = BOON_IDS.filter(id => !hasBoon(world, id) && (id !== 'finalJudgment' || canBrand))
  const preferred = shuffled(world, available.filter(id => BOONS[id].family === family))
  const others = shuffled(world, available.filter(id => BOONS[id].family !== family))
  // A marked door is a promise, not merely a weight. During this three-reward slice at least one
  // unowned boon from either family must remain; reserve it before a cross-family combo follow-up.
  const promised = preferred.shift()
  if (!promised) throw new Error(`no eligible ${family} boon remains for the marked reward`)
  const picked: BoonId[] = []
  const followup = synergyFollowup(world)
  if (followup && available.includes(followup) && !picked.includes(followup)) picked.push(followup)
  if (!picked.includes(promised)) picked.push(promised)
  for (const id of [...preferred, ...others]) if (!picked.includes(id) && picked.length < 3) picked.push(id)
  // The slice grants only three rewards from a six-boon pool, so this is an invariant. Keeping the
  // guard explicit makes a future content edit fail loudly instead of showing an empty card.
  if (picked.length < 3) throw new Error('reward pool exhausted before three choices could be offered')
  const options = picked.slice(0, 3) as [BoonId, BoonId, BoonId]
  run.pendingReward = { family, options, focus: 0 }
  world.roomPhase = 'reward'
  world.phaseTick = world.tick
  world.timeScale = 1
  world.slowmoTicks = 0
  world.freeze = 0
  world.player.state = 'free'
  world.player.stateTick = 0
  world.player.attackQueuedAt = -1
  world.player.dodgeQueuedAt = -1
  world.player.dodgeTick = -1
  world.player.dodgeRead = 0
  world.player.dodgeProcTick = -1
  world.player.bladeActionConnected = false
  world.player.vx = world.player.vy = 0
  world.doorOpen = false
  setDoorWalkable(world.arena, false)
  world.emit({ type: 'rewardOffered', options })
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
  if (world.session.run) world.session.run.pendingReward = null
  world.roomPhase = 'exits'
  world.phaseTick = world.tick
  world.doorOpen = world.hasNextRoom()
  setDoorWalkable(world.arena, world.doorOpen)
  world.emit({ type: 'boonChosen', boon: id, x: world.player.x, y: world.player.y })
}
