import type { World, Enemy } from '../world'
import { updateBrute } from './brute'
import { updateCaster } from './caster'
import { updateCharger } from './charger'
import { applyEnemyKnockback } from './common'

export function updateEnemies(world: World): void {
  for (const e of world.enemies) {
    if (!e.active) continue
    e.stateTick++
    if (e.flash > 0) e.flash--
    switch (e.kind) {
      case 'brute': updateBrute(world, e); break
      case 'caster': updateCaster(world, e); break
      case 'charger': updateCharger(world, e); break
      case 'dummy': if (e.state === 'stagger') { e.state = 'idle' } break
    }
    applyEnemyKnockback(world, e)
  }
}
