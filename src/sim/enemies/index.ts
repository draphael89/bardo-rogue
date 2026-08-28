import type { World, Enemy } from '../world'
import { updateBrute } from './brute'
import { updateCaster } from './caster'
import { updateCharger } from './charger'
import { updateWarden } from './warden'
import { applyEnemyKnockback } from './common'

export function updateEnemies(world: World): void {
  for (const e of world.enemies) {
    if (!e.active) continue
    e.stateTick++
    if (e.flash > 0) e.flash--
    if (e.brandTicks > 0 && --e.brandTicks === 0) e.brand = 0
    switch (e.kind) {
      case 'brute': updateBrute(world, e); break
      case 'caster': updateCaster(world, e); break
      case 'charger': updateCharger(world, e); break
      case 'dummy': if (e.state === 'stagger') { e.state = 'idle' } break
      case 'warden': updateWarden(world, e); break
      default: { const _n: never = e.kind; void _n }
    }
    applyEnemyKnockback(world, e)
  }
}
