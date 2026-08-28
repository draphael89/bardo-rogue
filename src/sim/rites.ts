import { tuning } from '@/tuning'
import type { InputFrame } from './input'
import type { World } from './world'
import { startWaves, queueSpawn } from './waves'

// A rite is the run's one non-combat beat: something the realm asks of you between fights.
//
// There is exactly one, and it is deliberately not a system. What a run needs first is a single
// beat of quiet with a real decision in it, so the shape here holds one authored rite honestly
// rather than pretending to be a framework with one entry. A weighted event pool can come later,
// when there are events to weigh.
//
// THE TOLL is Charon's due, asked on his bank. In Virgil the near shore is crowded with the
// unburied who could not pay and must wait a hundred years — the shades that fall on you at the
// Landing are exactly those, which is why the ferryman asks before they do.
//
// PAY   costs a whole vessel of life, permanently, and he hands you what the last passenger paid
//       him with: one more vow at the end of this room, from across the crossroads.
// SWIM  costs nothing now. You cross owed, and the account is read out in the Hall of Minos —
//       who is, of all the powers in this realm, the one who hears debts.
export type RiteId = 'toll'

export interface RiteChoice {
  label: string
  /** The mechanical price, stated plainly. A rite that hides its terms is a trick, not a choice. */
  cost: string
  detail: string
}

export interface RiteDef {
  id: RiteId
  speaker: string
  epithet: string
  line: string
  choices: [RiteChoice, RiteChoice]
}

export const RITES: Record<RiteId, RiteDef> = {
  toll: {
    id: 'toll',
    speaker: 'THE FERRYMAN',
    epithet: 'he who is owed',
    line: 'Everyone pays. The only question is when.',
    choices: [
      {
        label: 'PAY THE TOLL',
        cost: 'ONE VESSEL OF LIFE, FOR GOOD',
        detail: 'He carries you across, and gives you what the last one paid him with.',
      },
      {
        label: 'SWIM',
        cost: 'CROSS OWED',
        detail: 'You keep everything you carry. The judge keeps an account.',
      },
    ],
  },
}

/** Hold the room and ask. The fight does not start until this is answered. */
export function offerRite(world: World, id: RiteId): void {
  const run = world.session.run
  if (!run || run.result !== 'active') { beginRoomFight(world); return }
  run.pendingRite = { id, focus: 0 }
  world.roomPhase = 'entering'
  world.phaseTick = world.tick
  const p = world.player
  p.vx = p.vy = 0
  p.state = 'free'
  p.stateTick = 0
  p.attackQueuedAt = p.heavyQueuedAt = p.dodgeQueuedAt = -1
  world.emit({ type: 'riteOffered', rite: id })
}

export function updateRite(world: World, input: InputFrame): void {
  const run = world.session.run
  const rite = run?.pendingRite
  if (!run || !rite || world.roomPhase !== 'entering') return
  if (input.choiceDelta) {
    rite.focus = rite.focus === 0 ? 1 : 0
    world.emit({ type: 'riteFocus', focus: rite.focus })
  }
  if (!input.confirm) return

  const paid = rite.focus === 0
  run.pendingRite = null
  if (paid) {
    // Taken from the ceiling, not from the bar: a toll you could pay by walking in hurt is not a
    // toll. The current bar comes down with it, so the price is the same whenever you arrive.
    const p = world.player
    const cost = tuning.rites.toll.lifeCost
    p.maxHp = Math.max(1, p.maxHp - cost)
    p.hp = Math.min(p.hp, p.maxHp)
    run.maxHp = p.maxHp
    run.hp = p.hp
    run.riteBoonOwed = true
  } else {
    run.riteDebt = true
  }
  world.emit({ type: 'riteChosen', rite: rite.id, paid, x: world.player.x, y: world.player.y })
  beginRoomFight(world)
}

/**
 * Start whatever this room is. Every room passes through here, so this is also the one place that
 * knows a refused toll follows you: the debt is collected in the boss room and nowhere else.
 */
export function beginRoomFight(world: World): void {
  const room = world.rooms[world.roomIndex]
  if (room.boss) collectDebt(world)
  if (room.waves?.length) {
    startWaves(world, room.waves)
    world.roomPhase = 'fighting'
  } else {
    world.roomPhase = room.exits?.length ? 'exits' : 'resolved'
  }
  world.phaseTick = world.tick
}

// The river sends what it kept. It arrives late on purpose: the judge gets his entrance first, and
// a body that wades in mid-sentence reads as a consequence rather than as one more spawn.
function collectDebt(world: World): void {
  const run = world.session.run
  if (!run?.riteDebt) return
  run.riteDebt = false
  const T = tuning.rites.toll
  queueSpawn(world, { kind: T.debtKind, x: T.debtX, y: T.debtY }, T.debtDelay)
  world.emit({ type: 'riteDebtCalled' })
}
