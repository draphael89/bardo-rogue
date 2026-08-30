import type { World, Enemy } from '../world'
import { updateBrute } from './brute'
import { updateCaster } from './caster'
import { updateCharger } from './charger'
import { updateWarden } from './warden'
import { updateOathbound } from './oathbound'
import { applyEnemyKnockback } from './common'
import { tickStatuses } from '../status'

export function updateEnemies(world: World): void {
  for (const e of world.enemies) {
    if (!e.active) continue
    e.poseTick++
    e.stateTick++
    if (e.flash > 0) e.flash--
    tickStatuses(world, e)
    if (!e.active || e.state === 'dead') continue
    switch (e.kind) {
      case 'brute': updateBrute(world, e); break
      case 'caster': updateCaster(world, e); break
      case 'charger': updateCharger(world, e); break
      case 'dummy': if (e.state === 'stagger') { e.state = 'idle' } break
      case 'oathbound': updateOathbound(world, e); break
      case 'warden': updateWarden(world, e); break
      default: { const _n: never = e.kind; void _n }
    }
    // An attack above may have ended the run. Do not tick a later body's status or AI behind the
    // terminal event on this same simulation tick, or move the body that caused the verdict.
    if (world.scenario === 'loop' && world.session.run && world.session.run.result !== 'active') return
    applyEnemyKnockback(world, e)
  }
}
