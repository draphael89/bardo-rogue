import type { World, PlayerState, EnemyState, ProjectileKind } from './world'
import type { EnemyKind } from './events'
import type { WaveState } from './world'
import type { MysteryChoice, RoomPhase, RoomReward, ShopGood } from './session'
import type { RiteId } from './rites'
import { ARM } from './weapons'
import { BOON } from './boons'

// Stable integer codes. Enum order is part of the hash contract: append, never reorder.
const PLAYER_STATE: Record<PlayerState, number> = { free: 0, dodge: 1, attack: 2, dead: 3, hurt: 4 }
const ENEMY_STATE: Record<EnemyState, number> = {
  idle: 0, chase: 1, windup: 2, attack: 3, recover: 4, stagger: 5, dead: 6,
  position: 7, aim: 8, hover: 9, freeze: 10, dash: 11, phase: 12,
}
const ENEMY_KIND: Record<EnemyKind, number> = { brute: 0, caster: 1, charger: 2, dummy: 3, warden: 4, oathbound: 5 }
const WAVE_STATE: Record<WaveState, number> = { idle: 0, pending: 1, active: 2, done: 3 }
const ROOM_PHASE: Record<RoomPhase, number> = { town: 0, entering: 1, fighting: 2, reward: 3, exits: 4, transitioning: 5, resolved: 6, claiming: 7 }
const PROJECTILE_KIND: Record<ProjectileKind, number> = { bolt: 0, arrow: 1, mirror: 2, echo: 3 }
const RITE: Record<RiteId, number> = { toll: 0 }
const SHOP: Record<ShopGood, number> = { heal: 0, vessel: 1, vow: 2 }
const MYSTERY: Record<MysteryChoice, number> = { coin: 0, memory: 1, leave: 2 }
const SHRINE: Record<RoomReward, number> = { blade: 0, veil: 1, shop: 2, mystery: 3 }

// FNV-1a over a canonical snapshot of everything the sim's outcome depends on.
// Deliberately NOT hashed: world.visualRng (cosmetic-only stream) and the arena's DECORATION, so
// re-dressing a room cannot move a gameplay hash. The arena's `solid` mask IS hashed: it is
// collision, not decoration, and a builder edit that moves a wall would otherwise surface only
// indirectly, hundreds of ticks later, as drifted trajectories.
//
// EVERY field is written unconditionally, at a fixed offset in its record. This file used to guard
// "usually zero" fields with `if (x) write(x)` to keep old pinned hashes stable when a new feature
// went unused — and that guard is an aliasing machine: two adjacent conditionals of the same width
// let (phase=1, actionPhase=0) and (phase=0, actionPhase=1) feed the digest identical bytes, so two
// different worlds hashed the same and a replay of one "verified" against the other. An audit
// reproduced three such collisions. Variable-length data (strings, lists) is always length-prefixed
// for the same reason. If a change here is intended, re-record the fixtures (`pnpm record-bots`);
// never buy hash stability back with a conditional write.
export function hashWorld(world: World): number {
  let h = 0x811c9dc5
  const byte = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193) }
  const int = (n: number) => { const v = n | 0; byte(v); byte(v >>> 8); byte(v >>> 16); byte(v >>> 24) }
  const num = (n: number) => int(Math.round(n * 1000))   // px/angles to 1/1000
  const flag = (b: boolean) => byte(b ? 1 : 0)
  const str = (s: string) => { int(s.length); for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i)) }

  int(world.tick); int(world.freeze); num(world.timeScale); int(world.slowmoTicks)
  int(world.slowTicks); int(world.slowRate); int(world.slowAcc)
  int(world.swingCounter); int(world.nextEnemyId); int(world.nextProjectileId)
  int(world.roomClearTick); flag(world.doorOpen); flag(world.wantsRestart)
  int(world.boonBits)
  int(world.returns)
  int(world.roomIndex)
  if (world.scenario === 'loop') {
    byte(ROOM_PHASE[world.roomPhase]); int(world.phaseTick); int(world.transitionTicks)
    str(world.transitionTarget ?? '')
  }
  int(world.rng.state)

  if (world.scenario === 'loop') {
    const session = world.session
    int(session.meta.attempts); int(session.meta.victories); int(session.meta.remembrances)
    flag(session.meta.rerollUnlocked)
    flag(session.meta.vesselUnlocked)
    byte(session.preparedWeapon ? ARM[session.preparedWeapon] + 1 : 0)
    const run = session.run
    flag(!!run)
    if (run) {
      int(run.seed); int(run.hp); int(run.maxHp); int(run.depth); int(run.startedTick); byte(run.result === 'active' ? 0 : run.result === 'won' ? 1 : 2)
      flag(run.primedBrand); int(run.boonBits)
      byte(run.contract === 'commit' ? 1 : run.contract === 'cut' ? 2 : 0)
      int(run.clearedRoomIds.length)
      for (const id of run.clearedRoomIds) str(id)
      int(run.roomHistory.length)
      for (const visit of run.roomHistory) { str(visit.id); int(visit.enteredTick) }
      // A flag-then-body block is the one legal shape for optional data: the flag discriminates, so
      // the body's bytes can never be mistaken for a neighbour's.
      int(run.obols)
      flag(!!run.pendingReward)
      if (run.pendingReward) {
        byte(run.pendingReward.family === 'blade' ? 0 : 1); byte(run.pendingReward.focus); flag(run.pendingReward.fromRite)
        for (const id of run.pendingReward.options) int(BOON[id])
      }
      flag(!!run.pendingShop)
      if (run.pendingShop) {
        byte(run.pendingShop.focus)
        for (const good of run.pendingShop.goods) byte(SHOP[good])
      }
      flag(!!run.pendingMystery)
      if (run.pendingMystery) {
        byte(run.pendingMystery.focus)
        for (const choice of run.pendingMystery.choices) byte(MYSTERY[choice])
      }
      flag(run.mysteryHunt)
      byte(run.killedBy === 'none' ? 0 : ENEMY_KIND[run.killedBy] + 1); flag(run.killedRanged)
      flag(!!run.pendingRite)
      if (run.pendingRite) { byte(RITE[run.pendingRite.id]); byte(run.pendingRite.focus) }
      byte(run.riteAnswer === 'paid' ? 1 : run.riteAnswer === 'refused' ? 2 : 0)
      flag(run.riteBoonOwed); flag(run.riteDebt)
      // Always written when a run exists: length 0 covers `map === null`. Ids only.
      const nodes = run.map?.nodes ?? []
      int(nodes.length)
      for (const node of nodes) str(node.id)
      str(run.map?.template ?? '')
      int(run.boundaryRng)
      int(run.rerolls)
    }
  }

  const p = world.player
  byte(PLAYER_STATE[p.state]); int(p.stateTick)
  num(p.x); num(p.y); num(p.px); num(p.py); num(p.vx); num(p.vy); num(p.kbx); num(p.kby)
  int(p.hp); int(p.maxHp); int(p.facing)
  num(p.aimAngle); num(p.moveAngle); num(p.dodgeDirX); num(p.dodgeDirY)
  int(p.swingIndex); num(p.swingAngle); int(p.swingId)
  flag(p.swingFromRoll); flag(p.bladeActionConnected); int(p.assistTargetId)
  int(p.controlTick); int(p.attackQueuedAt); int(p.heavyQueuedAt); int(p.dodgeQueuedAt); int(p.dodgeTick)
  int(p.iframes); num(p.flash); int(p.dodgeRead)
  // Preserve the historical byte stream for worlds that never earn this opt-in mechanic.
  if (p.reversalTicks || p.reversalActionId !== -1) { int(p.reversalTicks); int(p.reversalActionId) }
  num(p.moveX); num(p.moveY); int(p.footTick); int(p.deathTick); flag(p.god)
  byte(p.arm); flag(p.armed)

  let active = 0
  for (const e of world.enemies) if (e.active) active++
  int(active)
  for (const e of world.enemies) {
    if (!e.active) continue
    int(e.id); byte(ENEMY_KIND[e.kind]); byte(ENEMY_STATE[e.state]); int(e.stateTick)
    num(e.x); num(e.y); num(e.px); num(e.py); num(e.vx); num(e.vy); num(e.kbx); num(e.kby)
    int(e.hp); int(e.maxHp); num(e.radius); int(e.facing)
    num(e.aimAngle); num(e.targetX); num(e.targetY)
    int(e.lastHitSwingId); num(e.flash); flag(e.hitDone)
    num(e.orbitAngle); int(e.orbitDir); int(e.hoverTicks); int(e.cooldown); int(e.dashTicks); int(e.spawnTick)
    byte(e.phase); flag(e.phasePending); byte(e.actionPhase); byte(e.pattern); int(e.patternCursor); int(e.patternStep)
    byte(e.brand); int(e.brandTicks)
    byte(e.burn); int(e.burnTicks); int(e.burnAcc); int(e.burnActionId)
    // poseTick is a cosmetic clock, like visualRng above: deterministic presentation state, but it
    // cannot affect an outcome and therefore is deliberately outside the gameplay hash contract.
    // hunt and debt are the same class: they name the body on the strip and the death card. The fight does not change.
    flag(e.knockbackHeavy); int(e.knockbackActionId)
  }

  let bolts = 0
  for (const b of world.projectiles) if (b.active) bolts++
  int(bolts)
  for (const b of world.projectiles) {
    if (!b.active) continue
    int(b.id); num(b.x); num(b.y); num(b.px); num(b.py); num(b.vx); num(b.vy)
    num(b.radius); int(b.life); num(b.angle)
    // Damage rides the projectile, not its kind: two hostile bolts differing only in what they will
    // do to the player used to hash identically, because damage was only written for team 1.
    byte(b.team); int(b.damage); int(b.actionId)
    byte(PROJECTILE_KIND[b.kind])
    byte(b.srcKind === 'player' ? 0 : ENEMY_KIND[b.srcKind] + 1)
  }

  // Collision geometry, run-length folded: walls move the fight, so a builder edit must show here.
  const solid = world.arena.solid
  int(world.arena.cols); int(world.arena.rows)
  let runLen = 0, runVal = solid[0] ? 1 : 0
  for (let i = 0; i < solid.length; i++) {
    const v = solid[i] ? 1 : 0
    if (v === runVal) { runLen++; continue }
    int(runLen); byte(runVal)
    runVal = v; runLen = 1
  }
  int(runLen); byte(runVal)

  // The cleared room's payout is a place the player has to reach, so it is geometry the outcome
  // depends on -- not decoration. Flag-then-body, the one legal shape for optional data here.
  const shrine = world.arena.shrine
  flag(!!shrine)
  if (shrine) { num(shrine.x); num(shrine.y); byte(SHRINE[shrine.kind]) }
  flag(!!world.arena.shrineTaken)

  const w = world.wave
  int(w.index); byte(WAVE_STATE[w.state]); int(w.groupIndex); int(w.timer); int(w.total)

  int(world.spawnQueue.length)
  for (const s of world.spawnQueue) { byte(ENEMY_KIND[s.kind]); num(s.x); num(s.y); int(s.ticksLeft) }

  return h >>> 0
}
