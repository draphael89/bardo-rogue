import type { SimEvent } from '@/sim/events'
import type { AudioSystem } from './audio'

// Event -> layered sounds. Keep gains modest; the mix matters more than any one sample.
export function playEventSfx(a: AudioSystem, ev: SimEvent): void {
  switch (ev.type) {
    case 'swing':
      a.play('woosh', { gain: ev.heavy ? 0.9 : 0.6, pitch: ev.heavy ? 0.8 : 1.1, pitchVar: 0.1 })
      a.swish(ev.heavy ? 0.45 : 0.3, ev.heavy ? 170 : 110, ev.heavy ? 0.8 : 1.1)
      break
    case 'hit':
      a.play('impactPunch_medium', { gain: 0.9, pitch: ev.heavy ? 0.85 : 1 })
      if (ev.kind === 'brute') a.play('impactPlate_medium', { gain: 0.5, pitch: 1.1 })
      if (ev.kind === 'charger') a.play('impactGeneric_light', { gain: 0.5, pitch: 1.3 })
      if (ev.killed) { a.play('impactPunch_heavy', { gain: 0.9, pitch: 0.9 }); a.play('creature', { gain: 0.35, pitch: 0.9 }) }
      break
    case 'playerHurt':
      a.play('hurt', { gain: 0.8 }); a.play('hitHelmet', { gain: 0.6 }); a.duck(0.4, 0.3)
      break
    case 'playerDeath':
      a.play('gameover1', { gain: 0.7, pitchVar: 0 }); a.play('you_lose', { gain: 0.7, pitchVar: 0, delay: 0.5 })
      break
    case 'dodge':
      a.play('cloth', { gain: 0.7, pitch: 1.2 }); a.play('woosh3', { gain: 0.35, pitch: 1.4 })
      break
    case 'footstep':
      a.play('footstep_concrete', { gain: 0.18, pitch: 1.1, pitchVar: 0.15 })
      break
    case 'boltFired':
      a.play('laserRetro', { gain: 0.35, pitch: 0.7 })
      break
    case 'boltCut':
      a.play('swordStone', { gain: 0.8, pitch: 1.2 }); a.play('impactGeneric_light', { gain: 0.5 })
      break
    case 'boltHitWall':
      a.play('impactGeneric_light', { gain: 0.25, pitch: 0.8 })
      break
    case 'enemyWindup':
      if (ev.kind === 'brute') a.play('swordMetal', { gain: 0.35, pitch: 0.7 })
      else if (ev.kind === 'caster') a.play('laserRetro', { gain: 0.12, pitch: 1.6 })
      else a.play('creature', { gain: 0.25, pitch: 1.4 })
      break
    case 'enemyAttack':
      if (ev.kind === 'brute') { a.play('woosh', { gain: 0.6, pitch: 0.75 }) }
      else if (ev.kind === 'charger') a.play('woosh', { gain: 0.4, pitch: 1.5 })
      break
    case 'spawn':
      a.play('lowFrequency_explosion', { gain: 0.25, pitch: 1.4 })
      break
    case 'waveStart':
      a.play(ev.wave === ev.total && ev.total > 1 ? 'final_round' : `round_${Math.min(3, ev.wave)}`, { gain: 0.8, pitchVar: 0 })
      a.play('jingles-hit_03', { gain: 0.5, pitchVar: 0, delay: 0.1 })
      break
    case 'waveClear':
      a.play('confirmation_001', { gain: 0.5, pitchVar: 0 })
      break
    case 'roomClear':
      a.play('jingles-hit_07', { gain: 0.8, pitchVar: 0 }); a.play('flawless_victory', { gain: 0.7, pitchVar: 0, delay: 0.4 }); a.play('doorOpen_1', { gain: 0.6, delay: 1.2 })
      break
  }
}
