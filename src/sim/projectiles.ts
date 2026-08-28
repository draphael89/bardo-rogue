import { DT, tuning } from '@/tuning'
import type { World } from './world'
import { isSolid } from './arena'
import { damageEnemy, hurtPlayer, isPlayerDodgeInvulnerable, noteNearMiss } from './combat'
import { resolveWeaponOnHit } from './boons'

export function updateProjectiles(world: World): void {
  const p = world.player
  for (const b of world.projectiles) {
    if (!b.active) continue
    b.x += b.vx * DT; b.y += b.vy * DT
    b.life--
    if (b.life <= 0 || isSolid(world.arena, b.x, b.y)) {
      b.active = false
      if (b.kind === 'arrow') world.emit({ type: 'arrowHitWall', x: b.x, y: b.y })
      else if (b.kind === 'mirror' || b.kind === 'echo') world.emit({ type: 'friendlyProjectileEnded', kind: b.kind, x: b.x, y: b.y })
      else world.emit({ type: 'boltHitWall', x: b.x, y: b.y })
      continue
    }
    if (b.team === 1) {
      for (const e of world.enemies) {
        if (!e.active || e.state === 'dead') continue
        if (Math.hypot(e.x - b.x, e.y - b.y) > b.radius + e.radius) continue
        const brandBefore = e.brand
        const source = b.kind === 'mirror' ? 'mirror' : b.kind === 'echo' ? 'echo' : 'arrow'
        damageEnemy(world, e, b.damage, b.angle, tuning.bow.knockback, false, tuning.bow.hitstop, b.actionId, {
          source,
          originX: b.px, originY: b.py,
          direction: b.angle,
          sweep: 0,
          cleave: false,
          contactDepth: 1,
        })
        resolveWeaponOnHit(world, e, false, brandBefore, b.angle, b.actionId)
        b.active = false
        break
      }
      continue
    }
    if (p.state === 'dead') continue
    const d = Math.hypot(p.x - b.x, p.y - b.y)
    const hitR = b.radius + p.radius
    if (d <= hitR) {
      if (isPlayerDodgeInvulnerable(world)) {
        hurtPlayer(world, b.angle, b.damage) // announces the read once; the bolt stays
        continue
      }
      hurtPlayer(world, b.angle, b.damage)
      b.active = false
    } else if (d <= hitR + tuning.bullet.grazePx) {
      noteNearMiss(world, b.angle, b.x, b.y, 'projectile')
    }
  }
}
