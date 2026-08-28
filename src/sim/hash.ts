import type { World, PlayerState, EnemyState, ProjectileKind } from './world'
import type { EnemyKind } from './events'
import type { WaveState } from './world'
import type { RoomPhase } from './session'
import type { RiteId } from './rites'
import { ARM } from './weapons'
import { BOON } from './boons'

// Stable integer codes. Enum order is part of the hash contract: append, never reorder.
const PLAYER_STATE: Record<PlayerState, number> = { free: 0, dodge: 1, attack: 2, dead: 3 }
const ENEMY_STATE: Record<EnemyState, number> = {
  idle: 0, chase: 1, windup: 2, attack: 3, recover: 4, stagger: 5, dead: 6,
  position: 7, aim: 8, hover: 9, freeze: 10, dash: 11,
}
const ENEMY_KIND: Record<EnemyKind, number> = { brute: 0, caster: 1, charger: 2, dummy: 3, warden: 4, oathbound: 5 }
const WAVE_STATE: Record<WaveState, number> = { idle: 0, pending: 1, active: 2, done: 3 }
const ROOM_PHASE: Record<RoomPhase, number> = { town: 0, entering: 1, fighting: 2, reward: 3, exits: 4, transitioning: 5, resolved: 6 }
const PROJECTILE_KIND: Record<ProjectileKind, number> = { bolt: 0, arrow: 1, mirror: 2, echo: 3, verdict: 4 }
const RITE: Record<RiteId, number> = { toll: 0 }

// FNV-1a over a canonical snapshot of everything the sim's outcome depends on.
// Deliberately NOT hashed: world.visualRng (cosmetic-only stream) and the arena's DECORATION, so
// re-dressing a room cannot move a gameplay hash. The arena's `solid` mask IS hashed: it is
// collision, not decoration, and a builder edit that moves a wall would otherwise surface only
// indirectly, hundreds of ticks later, as drifted trajectories.
export function hashWorld(world: World): number {
  let h = 0x811c9dc5
  const byte = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193) }
  const int = (n: number) => { const v = n | 0; byte(v); byte(v >>> 8); byte(v >>> 16); byte(v >>> 24) }
  const num = (n: number) => int(Math.round(n * 1000))   // px/angles to 1/1000
  const flag = (b: boolean) => byte(b ? 1 : 0)

  int(world.tick); int(world.freeze); num(world.timeScale); int(world.slowmoTicks)
  if (world.slowTicks) { int(world.slowTicks); int(world.slowRate); int(world.slowAcc) }
  int(world.swingCounter); int(world.nextEnemyId); int(world.nextProjectileId)
  int(world.roomClearTick); flag(world.doorOpen); flag(world.wantsRestart)
  if (world.boonBits) int(world.boonBits)
  if (world.returns) int(world.returns)
  if (world.roomIndex) int(world.roomIndex)
  if (world.scenario === 'loop') {
    byte(ROOM_PHASE[world.roomPhase]); int(world.phaseTick); int(world.transitionTicks)
    if (world.transitionTarget) for (let i = 0; i < world.transitionTarget.length; i++) byte(world.transitionTarget.charCodeAt(i))
  }
  int(world.rng.state)

  if (world.scenario === 'loop') {
    const session = world.session
    int(session.meta.attempts); int(session.meta.victories)
    byte(session.preparedWeapon ? ARM[session.preparedWeapon] + 1 : 0)
    const run = session.run
    flag(!!run)
    if (run) {
      int(run.seed); int(run.hp); int(run.maxHp); int(run.depth); int(run.startedTick); byte(run.result === 'active' ? 0 : run.result === 'won' ? 1 : 2)
      flag(run.primedBrand); int(run.boonBits); int(run.roomHistory.length)
      for (const visit of run.roomHistory) { for (let i = 0; i < visit.id.length; i++) byte(visit.id.charCodeAt(i)); int(visit.enteredTick) }
      flag(!!run.pendingReward)
      if (run.pendingReward) {
        byte(run.pendingReward.family === 'blade' ? 0 : 1); byte(run.pendingReward.focus); flag(run.pendingReward.fromRite)
        for (const id of run.pendingReward.options) int(BOON[id])
      }
      if (run.killedBy !== 'none') { byte(ENEMY_KIND[run.killedBy] + 1); flag(run.killedRanged) }
      // The toll: what is being asked, and both halves of what it left behind. A refusal has to be
      // in here or a replay could pay it in one run and swim in the next and still agree.
      flag(!!run.pendingRite)
      if (run.pendingRite) { byte(RITE[run.pendingRite.id]); byte(run.pendingRite.focus) }
      if (run.riteBoonOwed) flag(true)
      if (run.riteDebt) flag(true)
    }
  }

  const p = world.player
  byte(PLAYER_STATE[p.state]); int(p.stateTick)
  num(p.x); num(p.y); num(p.px); num(p.py); num(p.vx); num(p.vy); num(p.kbx); num(p.kby)
  int(p.hp); int(p.maxHp); int(p.facing)
  num(p.aimAngle); num(p.moveAngle); num(p.dodgeDirX); num(p.dodgeDirY)
  int(p.swingIndex); num(p.swingAngle); int(p.swingId); int(p.assistTargetId)
  int(p.controlTick); int(p.attackQueuedAt); int(p.heavyQueuedAt); int(p.dodgeQueuedAt); int(p.dodgeTick)
  int(p.iframes); num(p.flash); int(p.dodgeRead)
  num(p.moveX); num(p.moveY); int(p.footTick); int(p.deathTick); flag(p.god)
  if (p.arm) byte(p.arm)
  if (!p.armed) flag(false)

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
    if (e.phase) byte(e.phase)
    if (e.attackId) byte(e.attackId)
    if (e.brand) { byte(e.brand); int(e.brandTicks) }
    if (e.burn) { byte(e.burn); int(e.burnTicks); int(e.burnAcc) }
  }

  let bolts = 0
  for (const b of world.projectiles) if (b.active) bolts++
  int(bolts)
  for (const b of world.projectiles) {
    if (!b.active) continue
    int(b.id); num(b.x); num(b.y); num(b.px); num(b.py); num(b.vx); num(b.vy)
    num(b.radius); int(b.life); num(b.angle)
    if (b.team) { byte(b.team); int(b.damage); int(b.actionId) }
    if (b.kind !== 'bolt' && b.kind !== 'arrow') byte(PROJECTILE_KIND[b.kind])
    if (b.srcKind !== 'player') byte(ENEMY_KIND[b.srcKind] + 1)
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

  const w = world.wave
  int(w.index); byte(WAVE_STATE[w.state]); int(w.groupIndex); int(w.timer); int(w.total)

  int(world.spawnQueue.length)
  for (const s of world.spawnQueue) { byte(ENEMY_KIND[s.kind]); num(s.x); num(s.y); int(s.ticksLeft) }

  return h >>> 0
}
