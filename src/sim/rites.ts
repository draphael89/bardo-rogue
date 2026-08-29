import { tuning } from '@/tuning'
import type { InputFrame } from './input'
import type { World } from './world'
import { startWaves, queueSpawn } from './waves'
import { parkForModal } from './session'

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

// The card has to say the number the sim actually charges. Writing 'A LIFE' beside a tuning
// value of two is exactly the trick the comment above forbids, so the words are built from the
// number — as a getter, because `tuning` is live-editable through the debug API.
const VESSELS = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE']
function vesselPrice(n: number): string {
  if (n === 1) return 'A LIFE, FOR GOOD'
  return `${VESSELS[n] ?? n} LIVES, FOR GOOD`
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
        get cost() { return vesselPrice(tuning.rites.toll.lifeCost) },
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
  // Asked once per run. A dead or finished run, and a room walked into a second time, both go
  // straight to the fight rather than reopening a permanent decision.
  if (!run || run.result !== 'active' || run.riteAnswer) { beginRoomFight(world); return }
  run.pendingRite = { id, focus: 0 }
  world.roomPhase = 'entering'
  world.phaseTick = world.tick
  parkForModal(world)
  world.emit({ type: 'riteOffered', rite: id })
}

export function updateRite(world: World, input: InputFrame): void {
  const run = world.session.run
  const rite = run?.pendingRite
  if (!run || !rite || world.roomPhase !== 'entering') return
  if (input.choiceDelta) {
    rite.focus = rite.focus === 0 ? 1 : 0
    world.emit({ type: 'riteFocus', focus: rite.focus })
    // A frame can carry both a nudge and a confirm — two keys inside one 16.7 ms sample. On a
    // reward that is merely abrupt; here it would commit a permanent cost to a card the player
    // never saw highlighted, so a frame that moves the selection cannot also take it.
    return
  }
  // The toll costs a vessel for the rest of the descent, so it earns the same arming window the
  // offer gets — you walk into this room still holding attack from the last one.
  if (world.tick - world.phaseTick < tuning.run.modalArmTicks) return
  if (!input.confirm) return

  const paid = rite.focus === 0
  run.pendingRite = null
  if (paid) {
    // Taken from the ceiling, not from the bar: a toll you could pay by walking in hurt is not a
    // toll. The current bar comes down with it, so the price is the same whenever you arrive.
    // He is never paid out of the last vessel, and what he is not paid he does not answer: the
    // owed vow is conditional on the charge actually landing, or the toll would become free at 1.
    const p = world.player
    const charged = Math.min(tuning.rites.toll.lifeCost, Math.max(0, p.maxHp - 1))
    p.maxHp -= charged
    p.hp = Math.min(p.hp, p.maxHp)
    run.maxHp = p.maxHp
    run.hp = p.hp
    run.riteBoonOwed = charged > 0
  } else {
    run.riteDebt = true
  }
  run.riteAnswer = paid ? 'paid' : 'refused'
  world.emit({ type: 'riteChosen', rite: rite.id, paid, x: world.player.x, y: world.player.y })
  beginRoomFight(world)
}

/**
 * Start whatever this room is. Every room passes through here, so this is also the one place that
 * knows a refused toll follows you: the debt is collected in the boss room and nowhere else.
 */
export function beginRoomFight(world: World): void {
  const room = world.rooms[world.roomIndex]
  // Only into a room that is going to run waves: a body queued into a room with no wave tracking
  // would arrive after the door had already opened, with nothing left to clear it.
  if (room.boss && room.waves?.length) collectDebt(world)
  // Gated on the boss room exactly as the debt is. LEAVE HIM promises "He follows you to the judge"
  // (mystery.ts), but an ungated collect consumed the hunt in whichever combat room came next --
  // Cocytus or the Antechamber -- so the one consequence the choice sells never reached Minos.
  if (room.boss && room.waves?.length) collectHunt(world)
  if (room.waves?.length) {
    startWaves(world, room.waves)
    world.roomPhase = 'fighting'
  } else {
    world.roomPhase = room.exits?.length ? 'exits' : 'resolved'
  }
  world.phaseTick = world.tick
}

// The river sends what it kept. Its mark goes down on the floor as the player walks in and the body
// arrives long after, so the judge gets his entrance first and the debt reads as a consequence
// rather than as one more spawn. The announcement rides the arrival, not the queueing — see
// updateSpawnQueue, which is the only place that knows when it actually wades ashore.
function collectDebt(world: World): void {
  const run = world.session.run
  if (!run?.riteDebt) return
  run.riteDebt = false
  const T = tuning.rites.toll
  queueSpawn(world, { kind: T.debtKind, x: T.debtX, y: T.debtY }, { ticks: T.debtDelay, debt: true })
}

function collectHunt(world: World): void {
  const run = world.session.run
  if (!run?.mysteryHunt) return
  run.mysteryHunt = false
  const M = tuning.economy.mystery
  queueSpawn(world, { kind: M.huntKind, x: M.huntX, y: M.huntY }, { ticks: M.huntDelay, hunt: true })
}
