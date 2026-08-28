import type { SimEvent } from '@/sim/events'
import type { AudioSystem } from './audio'
import { tuning } from '@/tuning'

// The one place sim events become sound. Keep per-event gains modest: the buses do the balancing.
// This file also keeps the only state audio needs about the fight — how many enemies are alive,
// how hurt the player is, and where the player stands — counted from events, never read out of
// the sim. Audio never touches sim.

let alive = 0
let hp01 = 1

function census(a: AudioSystem, ev: SimEvent): void {
  switch (ev.type) {
    case 'spawn': alive++; break
    case 'kill': alive = Math.max(0, alive - 1); break
    case 'playerHurt': hp01 = Math.max(0, ev.hp / tuning.player.hp); break
    case 'roomClear': case 'playerDeath': alive = 0; break
    case 'restart': alive = 0; hp01 = 1; a.resumeBed(); break
    default: return
  }
  a.setCombat(alive, hp01)
}

export function playEventSfx(a: AudioSystem, ev: SimEvent): void {
  listen(a, ev)
  // Every sound that happens somewhere is placed there. Non-positional punctuation (waves, the
  // room clear, the door) has no `at` and stays centred.
  const at = 'x' in ev ? { x: ev.x, y: ev.y } : {}
  switch (ev.type) {
    case 'swing':
      a.play('woosh', { ...at, gain: ev.heavy ? 0.8 : 0.55, pitch: ev.heavy ? 0.8 : 1.1, pitchVar: 0.1 })
      a.swish(ev.heavy ? 0.45 : 0.3, ev.heavy ? 170 : 110, ev.heavy ? 0.8 : 1.1, ev)
      break
    case 'hit':
      a.play('impactPunch_medium', { ...at, gain: 0.75, pitch: ev.heavy ? 0.85 : 1 })
      if (ev.kind === 'brute') a.play('impactPlate_medium', { ...at, gain: 0.4, pitch: 1.1 })
      if (ev.kind === 'charger') a.play('impactGeneric_light', { ...at, gain: 0.5, pitch: 1.3 })
      if (ev.killed) { a.play('impactPunch_heavy', { ...at, gain: 0.7, pitch: 0.9 }); a.play('creature', { ...at, gain: 0.3, pitch: 0.9 }) }
      break
    case 'playerHurt':
      // the duck lives on Music + Ambience, so this hit is the loudest thing in the room
      a.play('hurt', { gain: 0.75 }); a.play('hitHelmet', { gain: 0.45 }); a.duck(-13, 0.5)
      break
    case 'playerDeath':
      a.play('impactSoft_heavy', { gain: 0.8, pitch: 0.75 })
      a.bell(0.8, 98, 4.5)                  // one low bowl, struck once
      a.stopBed(1.8)
      break
    case 'dodge':
      a.play('cloth', { gain: 0.7, pitch: 1.2 }); a.play('woosh3', { gain: 0.35, pitch: 1.4 })
      break
    case 'dodged':
      // an attack passed through the i-frames: the near miss is the reward, never varied
      a.play('woosh', { gain: 0.5, pitch: 0.55, pitchVar: 0 }); a.swish(0.22, 220, 0.6)
      break
    case 'dodgeEnd':
      a.play('cloth', { gain: 0.22, pitch: 0.85, pitchVar: 0.12 })
      break
    case 'footstep':
      a.play('footstep_concrete', { gain: 0.18, pitch: 1.1, pitchVar: 0.15 })
      break
    case 'boltFired':
      a.play('laserRetro', { ...at, gain: 0.35, pitch: 0.7 })
      break
    case 'boltCut':
      a.play('swordStone', { ...at, gain: 0.65, pitch: 1.2 }); a.play('impactGeneric_light', { ...at, gain: 0.4 })
      break
    case 'boltHitWall':
      a.play('impactGeneric_light', { ...at, gain: 0.25, pitch: 0.8 })
      break
    case 'enemyWindup':
      if (ev.kind === 'brute') a.play('swordMetal', { ...at, gain: 0.35, pitch: 0.7 })
      else if (ev.kind === 'caster') a.play('laserRetro', { ...at, gain: 0.12, pitch: 1.6 })
      else a.play('creature', { ...at, gain: 0.25, pitch: 1.4 })
      break
    case 'enemyAttack':
      if (ev.kind === 'brute') a.play('woosh', { ...at, gain: 0.6, pitch: 0.75 })
      else if (ev.kind === 'charger') a.play('woosh', { ...at, gain: 0.4, pitch: 1.5 })
      break
    case 'enemyStagger':
      a.play('impactPlate_medium', { ...at, gain: 0.3, pitch: 1.35 })
      break
    case 'spawnTelegraph':
      a.play('lowFrequency_explosion', { ...at, gain: 0.12, pitch: 0.55 })
      break
    case 'spawn':
      a.play('lowFrequency_explosion', { ...at, gain: 0.25, pitch: 1.4 })
      break
    case 'waveStart':
      // two struck bowls, a fifth apart, on the Music bus. No announcer.
      a.bell(0.55, 196, 2.2)
      a.bell(0.34, 293.66, 1.8, 'music', 0.26)
      a.duck(-9, 0.6)
      break
    case 'waveClear':
      a.bell(0.4, 349.23, 2.6)
      break
    case 'roomClear':
      a.bell(0.6, 261.63, 3.6)
      a.bell(0.34, 392, 3.0, 'music', 0.45)
      a.play('doorOpen_1', { gain: 0.6, delay: 1.2, bus: 'ui' })
      break
  }
  census(a, ev)
}

/**
 * The player is the ears. These events are the only ones whose (x, y) IS the player, and one of
 * them fires whenever the player moves or acts — so the listener is never stale while anything
 * is happening, and the player's own sounds always land dead centre at full level.
 */
function listen(a: AudioSystem, ev: SimEvent): void {
  switch (ev.type) {
    case 'footstep': case 'swing': case 'dodge': case 'dodgeEnd': case 'dodged':
    case 'playerHurt': case 'playerDeath': a.setListener(ev.x, ev.y)
  }
}

/** Tests and the offline mix renderer start from a known count. */
export function resetSfxState(): void { alive = 0; hp01 = 1 }
