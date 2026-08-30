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
        const dx = e.x - b.x, dy = e.y - b.y
        const hitR = b.radius + e.radius
        // A strict axis miss cannot touch the circle. Keep hypot for the edge/diagonal decision and
        // for the historical NaN path, where its comparison deliberately falls through.
        if (dx === dx && dy === dy && (dx > hitR || dx < -hitR || dy > hitR || dy < -hitR)) continue
        if (Math.hypot(dx, dy) > hitR) continue
        const brandBefore = e.brand
        const source = b.kind === 'mirror' ? 'mirror' : b.kind === 'echo' ? 'echo' : 'arrow'
        const result = damageEnemy(world, e, b.damage, b.angle, tuning.bow.knockback, false, tuning.bow.hitstop, b.actionId, {
          source,
          originX: b.px, originY: b.py,
          direction: b.angle,
          sweep: 0,
          cleave: false,
          contactDepth: 1,
        })
        // The shot is spent either way, but a shield that turned it also turns its riders.
        if (result.landed) resolveWeaponOnHit(world, e, false, brandBefore, b.angle, b.actionId, result)
        b.active = false
        break
      }
      continue
    }
    if (p.state === 'dead') continue
    const dx = p.x - b.x, dy = p.y - b.y
    const hitR = b.radius + p.radius
    const grazeR = hitR + tuning.bullet.grazePx
    // A projectile outside the graze square cannot hit or graze the player. Keep hypot for every
    // possible contact and for non-finite coordinates, whose comparisons historically fall through.
    if (dx === dx && dy === dy && (dx > grazeR || dx < -grazeR || dy > grazeR || dy < -grazeR)) continue
    const d = Math.hypot(dx, dy)
    if (d <= hitR) {
      const src = b.srcKind === 'player' ? 'none' : b.srcKind
      if (isPlayerDodgeInvulnerable(world)) {
        hurtPlayer(world, b.angle, b.damage, src, true, b.sentence) // announces the read once; the bolt stays
        continue
      }
      b.active = false
      hurtPlayer(world, b.angle, b.damage, src, true, b.sentence)
      // A lethal bolt ends the attempt at this contact. Later pool slots must not move, expire, or
      // emit wall hits behind the runLost event on the same tick.
      if (world.scenario === 'loop' && world.session.run && world.session.run.result !== 'active') return
    } else if (d <= grazeR) {
      noteNearMiss(world, b.angle, b.x, b.y, 'projectile')
    }
  }
}
