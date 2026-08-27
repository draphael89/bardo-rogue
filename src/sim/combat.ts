import { tuning } from '@/tuning'
import { angleDiff, deg } from './math'
import type { World, Enemy } from './world'

// Arc sector (center, facing angle, radius, arc) vs circle. The target's radius widens both reach and angle.
export function arcHits(cx: number, cy: number, angle: number, radius: number, arcDeg: number, tx: number, ty: number, tr: number): boolean {
  const dx = tx - cx, dy = ty - cy
  const d = Math.hypot(dx, dy)
  if (d > radius + tr) return false
  if (d <= tr) return true
  const half = deg(arcDeg) / 2 + Math.asin(Math.min(1, tr / d))
  return Math.abs(angleDiff(angle, Math.atan2(dy, dx))) <= half
}

export function addFreeze(world: World, ticks: number): void {
  world.freeze = Math.min(tuning.hitstop.max, Math.max(world.freeze, ticks))
}

export function damageEnemy(world: World, e: Enemy, damage: number, angle: number, knockback: number, heavy: boolean, hitstop: number): void {
  if (!e.active || e.state === 'dead') return
  e.hp -= damage
  e.flash = tuning.juice.flashTicks
  const kind = e.kind
  const killed = e.hp <= 0
  const scale = kind === 'dummy' ? 0 : tuning[kind].knockbackScale
  const kb = killed ? knockback * 1.5 : knockback * scale
  e.kbx += Math.cos(angle) * kb
  e.kby += Math.sin(angle) * kb
  e.facing = Math.cos(angle) > 0 ? -1 : 1 // face the attacker

  if (killed) {
    e.state = 'dead'
    e.stateTick = 0
    addFreeze(world, hitstop + tuning.hitstop.killBonus)
    world.emit({ type: 'hit', x: e.x, y: e.y, angle, damage, heavy, targetId: e.id, kind, killed: true })
    world.emit({ type: 'kill', x: e.x, y: e.y, angle, kind, id: e.id })
    e.active = false
    return
  }
  addFreeze(world, hitstop)
  world.emit({ type: 'hit', x: e.x, y: e.y, angle, damage, heavy, targetId: e.id, kind, killed: false })

  // poise: brutes only stagger from the heavy hit; everyone else staggers on any hit
  const staggers = kind === 'brute' ? heavy : kind !== 'dummy'
  if (staggers) {
    e.state = 'stagger'
    e.stateTick = 0
    e.hitDone = false
    world.emit({ type: 'enemyStagger', id: e.id, x: e.x, y: e.y })
  } else if (kind === 'brute') {
    e.kbx += Math.cos(angle) * tuning.brute.lightNudge * 10
    e.kby += Math.sin(angle) * tuning.brute.lightNudge * 10
  }
}

// Returns true if damage was applied. During dodge i-frames the sim records a successful dodge instead.
export function hurtPlayer(world: World, angle: number, damage: number): boolean {
  const p = world.player
  if (p.state === 'dead') return false
  if (isPlayerInvulnerable(world)) {
    if (p.state === 'dodge') world.emit({ type: 'dodged', x: p.x, y: p.y })
    return false
  }
  if (p.god) damage = 0
  p.hp = Math.max(0, p.hp - damage)
  p.iframes = tuning.player.hurtIFrames
  p.flash = tuning.juice.flashTicks
  p.kbx += Math.cos(angle) * tuning.player.hurtKnockback * 6
  p.kby += Math.sin(angle) * tuning.player.hurtKnockback * 6
  addFreeze(world, tuning.player.hurtHitstop)
  world.emit({ type: 'playerHurt', x: p.x, y: p.y, angle, hp: p.hp })
  if (p.hp <= 0) {
    p.state = 'dead'
    p.stateTick = 0
    p.deathTick = world.tick
    world.timeScale = tuning.player.deathSlowmo
    world.slowmoTicks = tuning.player.deathSlowmoTicks
    world.emit({ type: 'playerDeath', x: p.x, y: p.y })
  }
  return true
}

export function isPlayerInvulnerable(world: World): boolean {
  const p = world.player
  if (p.iframes > 0) return true
  if (p.state === 'dodge') {
    const d = tuning.player.dodge
    return p.stateTick >= d.iStart && p.stateTick <= d.iEnd
  }
  return false
}
