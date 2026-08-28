import type { SimEvent } from '@/sim/events'
import { MIX, type AudioSystem } from './audio'
import { tuning } from '@/tuning'

// The one place sim events become sound. Keep per-event gains modest: the buses do the balancing.
//
// The mix is ranked by CAUSE, not by consequence, with one exception. Loudest is what is about
// to happen to you (an enemy winding up, a spawn arriving) and the one consequence that is also
// information — you took damage; then what you did about it (dodge, swing); then the rewards
// (you hit them, you killed them). A game that shouts about the sword landing and whispers
// about the cleaver being raised is teaching the wrong half of the fight. The tells also carry
// their own reserved band (2-4 kHz, see MIX.bedNotch) and a short duck, so they are heard without
// having to out-shout the 200-600 Hz region where the bed and every impact already live.
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
      // your own commit: it has to clear the bed, and its air sits above the impact it will cause
      a.play('woosh', { ...at, gain: ev.heavy ? 1 : 0.78, pitch: ev.heavy ? 0.8 : 1.1, pitchVar: 0.1 })
      a.swish(ev.heavy ? 1.06 : 0.85, ev.heavy ? 170 : 110, ev.heavy ? 0.95 : 1.35, ev)
      break
    case 'hit':
      // the consequence, deliberately under the cause: a landed hit is confirmation, not news.
      // It still owns 200-600 Hz, where nothing else in the mix is competing for the top.
      a.play('impactPunch_medium', { ...at, gain: 0.5, pitch: ev.heavy ? 0.85 : 1 })
      if (ev.kind === 'brute') a.play('impactPlate_medium', { ...at, gain: 0.24, pitch: 1.1 })
      if (ev.kind === 'charger') a.play('impactGeneric_light', { ...at, gain: 0.32, pitch: 1.3 })
      if (ev.killed) { a.play('impactPunch_heavy', { ...at, gain: 0.5, pitch: 0.9 }); a.play('creature', { ...at, gain: 0.28, pitch: 0.9 }) }
      break
    case 'playerHurt':
      // The damage moment, and the loudest single thing the game can do. It leads with a 190 ->
      // 58 Hz thump, because 60-150 Hz is the one band nothing else in the mix uses: the tells
      // own 2-4 kHz, the impacts own 200-600, the bed's low end is a steady 55 Hz drone. Weight
      // is free there, so the hit does not have to out-shout anything to be felt.
      // The voice and the helmet ride on top for the detail. The duck lives on Music + Ambience
      // and now opens 80 ms LATER (MIX.duck.by.playerHurt) — it lengthens this sound's tail
      // instead of hollowing out its front, which is what made the damage moment measure
      // quieter than the bed it plays over.
      a.thump(1.05, 190, 58, 0.24, { click: 1.1 })
      a.play('hurt4', { gain: 0.62, pitchVar: 0.05 })
      a.play('hitHelmet3', { gain: 0.42, pitchVar: 0.05 })
      a.duck(...MIX.duck.by.playerHurt)
      break
    case 'playerDeath':
      a.play('impactSoft_heavy', { gain: 0.8, pitch: 0.75 })
      a.bell(1.2, 98, 4.5)                  // one low bowl, struck once
      a.stopBed(1.8)
      break
    case 'dodge':
      // the survival move. Its sweep lives in the reserved band, so it reads over any fight.
      // One fixed take, never the round-robin: the cloth group spans 15 dB between its takes
      // (cloth1 -13 dBFS, cloth4 -28), and the i-frame confirmation is the one sound that must
      // never arrive quieter than the last time you dodged.
      a.play('woosh3', { gain: 1.4, pitch: 1.45, pitchVar: 0 })
      a.play('cloth1', { gain: 1.28, pitch: 1.2, pitchVar: 0.04 })
      a.swish(1.28, 90, 1.7, ev)
      break
    case 'dodged':
      // an attack passed through the i-frames: the near miss is the reward, never varied
      a.play('woosh4', { gain: 1.2, pitch: 0.55, pitchVar: 0 }); a.swish(1.2, 220, 0.6)
      break
    case 'dodgeEnd':
      a.play('cloth2', { gain: 2.2, pitch: 1.15, pitchVar: 0.12 })   // the quiet take: a tail, not a cue
      break
    case 'footstep':
      a.play('footstep_concrete', { gain: 0.26, pitch: 1.1, pitchVar: 0.15 })
      break
    case 'boltFired':
      // a bolt in the air is a threat, not a flourish
      a.play('laserRetro', { ...at, gain: 1, pitch: 0.7 })
      break
    case 'boltCut':
      a.play('swordStone2', { ...at, gain: 0.9, pitch: 1.2 }); a.play('impactGeneric_light', { ...at, gain: 0.5 })
      break
    case 'boltHitWall':
      a.play('impactGeneric_light', { ...at, gain: 0.4, pitch: 0.8 })
      break
    case 'enemyWindup':
      // The loudest thing in the game. There are 20-28 ticks of runway before the blow lands, so
      // the tell gets a ring long enough to still be sounding when you have to act on it. It sits
      // in the band the bed is notched out of, and it takes the bed down -6 dB while it rings.
      a.duck(...MIX.duck.by.enemyWindup)
      if (ev.kind === 'brute') {
        a.bell(1.2, 3000, 0.3, 'sfx', 0, { ...at, partials: 'plate', glideTo: 2450, strike: 0.55, cap: 'tell' })
        a.play('swordMetal', { ...at, gain: 0.3, pitch: 0.7 })
      } else if (ev.kind === 'caster') {
        a.bell(0.72, 2100, 0.3, 'sfx', 0, { ...at, partials: 'tone', glideTo: 3600, strike: 0.25, cap: 'tell' })
        a.play('laserRetro', { ...at, gain: 0.22, pitch: 1.6 })
      } else {
        a.bell(1.07, 2200, 0.24, 'sfx', 0, { ...at, partials: 'plate', glideTo: 3400, strike: 0.4, cap: 'tell' })
        a.play('creature', { ...at, gain: 0.28, pitch: 1.4 })
      }
      break
    case 'enemyAttack':
      // the commit, still above the impact it may cause. A caster's release is its bolt (below).
      if (ev.kind === 'brute') {
        a.play('woosh', { ...at, gain: 1.2, pitch: 0.8 })
        a.bell(0.95, 2600, 0.2, 'sfx', 0, { ...at, partials: 'plate', glideTo: 1500, cap: 'strike' })
        a.swish(0.6, 200, 0.7, ev)
      } else if (ev.kind === 'charger') {
        a.play('woosh', { ...at, gain: 0.9, pitch: 1.5 })
        a.bell(0.82, 3200, 0.16, 'sfx', 0, { ...at, partials: 'plate', glideTo: 2000, cap: 'strike' })
        a.swish(0.5, 120, 1.5, ev)
      }
      break
    case 'enemyStagger':
      a.play('impactPlate_medium', { ...at, gain: 0.4, pitch: 1.35 })
      break
    case 'spawnTelegraph':
      // something is arriving where you are standing: a tell, and priced like one
      a.play('lowFrequency_explosion', { ...at, gain: 0.4, pitch: 0.55 })
      a.bell(0.82, 2350, 0.8, 'sfx', 0, { ...at, partials: 'tone', glideTo: 3050, strike: 0.2, cap: 'tell' })
      a.duck(...MIX.duck.by.spawnTelegraph)
      break
    case 'spawn':
      a.play('lowFrequency_explosion', { ...at, gain: 0.4, pitch: 1.4 })
      break
    case 'waveStart':
      // two struck bowls, a fifth apart, on the Music bus. No announcer.
      a.bell(1, 196, 2.2)
      a.bell(0.65, 293.66, 1.8, 'music', 0.26)
      a.duck(...MIX.duck.by.waveStart)
      break
    case 'waveClear':
      a.bell(0.7, 349.23, 2.6)
      break
    case 'roomClear':
      a.bell(1, 261.63, 3.6)
      a.bell(0.6, 392, 3.0, 'music', 0.45)
      a.play('doorOpen_1', { gain: 0.6, delay: 1.2, bus: 'ui' })
      break
    case 'roomEnter':
      a.play('doorOpen_1', { gain: 0.45, bus: 'ui' })
      a.bell(0.6, 196, 1.8)
      break
    case 'offeringTaken':
      a.bell(0.55, 392, 2.4)
      a.bell(0.28, 523.25, 1.8, 'music', 0.2)
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
