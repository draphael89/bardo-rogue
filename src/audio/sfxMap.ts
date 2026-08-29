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
    case 'playerHurt': case 'offeringTaken': hp01 = Math.max(0, Math.min(1, ev.hp / Math.max(1, ev.maxHp))); break
    case 'roomClear': case 'playerDeath': alive = 0; break
    case 'restart': case 'returned': alive = 0; hp01 = 1; a.resumeBed(); break
    default: return
  }
  a.setCombat(alive, hp01)
}

export function playEventSfx(a: AudioSystem, ev: SimEvent, listener?: Readonly<{ x: number; y: number }>): void {
  // The live game supplies the authoritative player position for every event. Callers that only
  // have an event (tests/offline tools) retain the legacy player-origin fallback below.
  if (listener) a.setListener(listener.x, listener.y)
  else listen(a, ev)
  // Every sound that happens somewhere is placed there. Non-positional punctuation (waves, the
  // room clear, the door) has no `at` and stays centred.
  const at = 'x' in ev ? { x: ev.x, y: ev.y } : {}
  switch (ev.type) {
    case 'swing':
      // your own commit: it has to clear the bed even in a pile-up (w2r5: 0.5 dB mixed lift).
      // The bed leans back 5 dB for the length of the string; the woosh itself stays on SFX.
      a.duck(...MIX.duck.by.playerCommit)
      a.play('woosh', { ...at, gain: ev.heavy ? 1.35 : 1.2, pitch: ev.heavy ? 0.8 : 1.1, pitchVar: 0.1, lead: true })
      // A swing out of a roll rides higher and tighter: the same blade, carried by the dodge.
      a.swish(ev.heavy ? 1.4 : 1.3, ev.heavy ? 170 : 110, ev.dash ? 1.7 : ev.heavy ? 1.2 : 1.45, ev, true)
      break
    case 'hit':
      // the consequence, deliberately under the cause: a landed hit is confirmation, not news.
      // It still owns 200-600 Hz, where nothing else in the mix is competing for the top.
      if (ev.guarded) {
        // The veil answers with a short, high steel refusal. It confirms contact without borrowing
        // the body-heavy punch that says the player found an opening.
        a.play('swordStone2', { ...at, gain: 0.22, pitch: 1.5 })
        a.play('impactPlate_medium', { ...at, gain: 0.16, pitch: 1.4 })
      } else {
        a.play('impactPunch_medium', { ...at, gain: 0.5, pitch: ev.heavy ? 0.85 : 1 })
        if (ev.kind === 'brute' || ev.kind === 'warden') a.play('impactPlate_medium', { ...at, gain: ev.kind === 'warden' ? 0.32 : 0.24, pitch: ev.kind === 'warden' ? 0.85 : 1.1 })
        if (ev.kind === 'charger') a.play('impactGeneric_light', { ...at, gain: 0.32, pitch: 1.3 })
      }
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
      a.play('hurt4', { gain: 0.62, pitchVar: 0.05, lead: true })
      a.play('hitHelmet3', { gain: 0.42, pitchVar: 0.05, lead: true })
      a.duck(...MIX.duck.by.playerHurt)
      break
    case 'playerDeath':
      a.play('impactSoft_heavy', { gain: 0.8, pitch: 0.75, lead: true })
      a.bell(1.2, 98, 4.5)                  // one low bowl, struck once
      a.stopBed(1.8)
      break
    case 'dodge':
      // the survival move. Its sweep lives in the reserved band, so it reads over any fight.
      // One fixed take, never the round-robin: the cloth group spans 15 dB between its takes
      // (cloth1 -13 dBFS, cloth4 -28), and the i-frame confirmation is the one sound that must
      // never arrive quieter than the last time you dodged.
      // Same commit duck as the swing: w2r5 mixed dodge lift was -0.1 dB.
      a.duck(...MIX.duck.by.playerCommit)
      a.play('woosh3', { gain: 1.55, pitch: 1.45, pitchVar: 0, lead: true })
      a.play('cloth1', { gain: 1.4, pitch: 1.2, pitchVar: 0.04, lead: true })
      a.swish(1.45, 90, 1.7, ev, true)
      break
    case 'dodgeWall':
      // A short stone/steel answer, below damage and attack contact. dodgeEnd still supplies the
      // quiet cloth settle on the same tick, making this read as interrupted travel rather than HP loss.
      a.play('swordStone2', { ...at, gain: 0.42, pitch: 0.72, pitchVar: 0.04 })
      a.play('impactGeneric_light', { ...at, gain: 0.26, pitch: 0.68, pitchVar: 0.03 })
      break
    case 'dodged':
      // an attack passed through the i-frames: the near miss is the reward, never varied
      a.play('woosh4', { gain: 1.2, pitch: 0.55, pitchVar: 0, lead: true }); a.swish(1.2, 220, 0.6, undefined, true)
      break
    case 'reversal':
      // A narrow cold-to-warm seam: audible recognition without stacking another attack whoosh.
      a.bell(0.34, 1320, 0.16, 'sfx', 0, { ...at, partials: 'tone', glideTo: 660, strike: 0.18, cap: 'strike' })
      a.play('swordMetal', { ...at, gain: 0.18, pitch: ev.weapon === 'blade' ? 1.45 : 1.75 })
      break
    case 'graze':
      // A small high breath, intentionally below the low, long perfect-dodge confirmation.
      a.play('woosh4', { gain: 0.34, pitch: 1.55, pitchVar: 0, lead: true })
      a.bell(0.16, 1800, 0.11, 'sfx', 0, { partials: 'tone', glideTo: 2400, strike: 0.08, cap: 'strike' })
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
        a.play('swordMetal', { ...at, gain: 0.3, pitch: 0.7, lead: true })
      } else if (ev.kind === 'caster') {
        a.bell(0.72, 2100, 0.3, 'sfx', 0, { ...at, partials: 'tone', glideTo: 3600, strike: 0.25, cap: 'tell' })
        a.play('laserRetro', { ...at, gain: 0.22, pitch: 1.6, lead: true })
      } else if (ev.kind === 'warden') {
        a.bell(1.35, 196, 0.7, 'sfx', 0, { ...at, partials: 'plate', glideTo: 130, strike: 0.7, cap: 'tell' })
        a.play('creature', { ...at, gain: 0.4, pitch: 0.5 })
      } else if (ev.kind === 'oathbound') {
        // Bronze, and rising: a shield being set rather than a body winding up. It shares nothing
        // with the Empusa's bell, because a player who has learned the roster by ear must not get
        // the freeze-and-dash answer from a shade that is about to plant and bash.
        a.bell(1.15, 660, 0.5, 'sfx', 0, { ...at, partials: 'bowl', glideTo: 880, strike: 0.9, cap: 'tell' })
        a.play('impactPlate_medium', { ...at, gain: 0.34, pitch: 0.85 })
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
      } else if (ev.kind === 'oathbound') {
        // The bash committing. Bronze driven forward, not a blade cutting air — it is the only
        // enemy commit in the roster that had no sound at all, so a player watching a caster across
        // the room learned about it by taking it.
        a.play('impactPlate_medium', { ...at, gain: 1.15, pitch: 0.72 })
        a.play('woosh', { ...at, gain: 0.7, pitch: 0.95 })
        a.swish(0.5, 170, 0.8, ev)
      } else if (ev.kind === 'warden') {
        if (ev.pattern === 'slam') {
          a.play('woosh', { ...at, gain: 1.4, pitch: 0.55 })
          a.thump(1.05, 150, 46, 0.26, { click: 0.85 })
          a.bell(1.05, 180, 0.28, 'sfx', 0, { ...at, partials: 'plate', glideTo: 80, cap: 'strike' })
        } else if (ev.pattern === 'ring') {
          // Outward geometry: a small rising metal bloom, no floor-impact thump.
          a.play('laserRetro', { ...at, gain: 0.28, pitch: 1.15 })
          a.bell(0.34, 880, 0.2, 'sfx', 0, { ...at, partials: 'tone', glideTo: 1320, cap: 'strike' })
        } else {
          // Aimed projectile fan: directional air, lighter than the radial body slam.
          a.play('woosh2', { ...at, gain: 0.48, pitch: 1.3 })
          a.swish(0.32, 105, 1.5, ev)
        }
      }
      break
    case 'enemyPhase':
      a.bell(1.15, 147, 3.4)
      a.bell(0.7, 220, 2.6, 'music', 0.22)
      a.play('creature', { ...at, gain: 0.45, pitch: 0.48 })
      a.duck(...MIX.duck.by.enemyWindup)
      break
    case 'enemyStagger':
      a.play('impactPlate_medium', { ...at, gain: 0.4, pitch: 1.35 })
      break
    case 'enemyWallSlam':
      a.play('swordStone1', { ...at, gain: 0.44, pitch: ev.kind === 'brute' ? 0.72 : 0.9 })
      a.play('impactGeneric_light', { ...at, gain: 0.28, pitch: 0.68 })
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
      // The door only sounds when a door is actually opening: a clear with nowhere onward (the
      // final room, a debug arena) gets the bells and nothing creaking.
      if (ev.hasNext && !ev.reward && !ev.victory) a.play('doorOpen_1', { gain: 0.6, delay: 1.2, bus: 'ui' })
      break
    case 'roomEnter':
      a.play('doorOpen_1', { gain: 0.45, bus: 'ui' })
      a.bell(0.6, 196, 1.8)
      break
    case 'roomTransition':
      a.play('doorOpen_1', { gain: 0.28, pitch: 0.82, bus: 'ui' })
      break
    case 'returned':
      a.play('doorOpen_1', { gain: 0.45, bus: 'ui' })
      a.bell(0.7, 196, 2.2)
      a.bell(0.4, 293.66, 1.6, 'music', 0.2)
      break
    case 'offeringTaken':
      a.bell(0.55, 392, 2.4)
      a.bell(0.28, 523.25, 1.8, 'music', 0.2)
      break
    case 'weaponPrepared':
      a.play('swordMetal', { ...at, gain: 0.72, pitch: 1.05, bus: 'ui' })
      a.bell(0.48, 329.63, 1.7, 'music', 0.08)
      break
    case 'runStarted':
      a.bell(0.55, 146.83, 2.2)
      break
    case 'rewardOffered':
      a.bell(0.72, 293.66, 2.8, 'ui')
      a.bell(0.38, 440, 2.1, 'music', 0.18)
      break
    case 'rewardFocus':
      a.play('impactGeneric_light', { gain: 0.14, pitch: 1.7 + ev.focus * 0.08, bus: 'ui' })
      break
    // The ferryman is not a god and does not get their bell. He gets the low end of the same
    // instrument with the struck wood left in, the way a hull knocks against a post.
    case 'riteOffered':
      a.bell(0.7, 110, 3.4, 'ui', 0, { partials: 'plate', strike: 1 })
      a.bell(0.3, 164.81, 2.6, 'music', 0.26)
      break
    case 'riteFocus':
      a.play('impactGeneric_light', { gain: 0.14, pitch: 1.3 + ev.focus * 0.1, bus: 'ui' })
      break
    case 'riteChosen':
      // Paying rings clean and holds its pitch: a coin dropped into a palm, and the transaction is
      // closed. Refusing does not ring — it slides a fifth downward and keeps going, which is the
      // sound of something being carried off rather than settled.
      if (ev.paid) a.bell(0.66, 220, 2.6, 'ui', 0, { partials: 'tone', strike: 0.8 })
      else a.bell(0.6, 130.81, 4.2, 'ui', 0, { partials: 'plate', glideTo: 87.31, strike: 0.35 })
      a.bell(0.34, ev.paid ? 329.63 : 98, 2.4, 'music', 0.22)
      break
    case 'riteDebtCalled':
      // The same falling figure, an octave down and much later. It is the only cue in the game that
      // quotes an earlier one, because it is the only consequence that crosses a room boundary.
      a.bell(0.5, 87.31, 4.4, 'music', 0, { partials: 'plate', glideTo: 65.41, strike: 0.2 })
      break
    case 'boonChosen':
      a.play('swordMetal', { ...at, gain: 0.55, pitch: 1.25, bus: 'ui' })
      a.bell(0.82, 392, 3.0, 'music')
      a.bell(0.42, 587.33, 2.2, 'music', 0.2)
      break
    case 'brandApplied':
      a.play('impactGeneric_light', { ...at, gain: 0.12 + ev.stacks * 0.03, pitch: 1.1 + ev.stacks * 0.12 })
      break
    case 'brandConsumed':
      a.play('impactPunch_heavy', { ...at, gain: 0.42 + ev.stacks * 0.08, pitch: 0.9 })
      a.thump(0.35 + ev.stacks * 0.1, 135, 62, 0.18)
      break
    // Fire announces itself once, on ignition, and then keeps quiet. A cue on every bite would put
    // a metronome under any fight where two bodies are alight.
    case 'burnApplied':
      a.play('impactGeneric_light', { ...at, gain: 0.2, pitch: 1.5 })
      break
    case 'burnTick':
    case 'burnEnded':
      break
    // A blow turned by bronze: metal, high and short, and clearly not the sound of meat.
    case 'guardBlocked':
      a.play('swordStone2', { ...at, gain: 1.0, pitch: 1.35, pitchVar: 0.08 })
      a.play('impactGeneric_light', { ...at, gain: 0.3, pitch: 1.5 })
      break
    case 'brandPassed':
      a.play('impactGeneric_light', { x: ev.toX, y: ev.toY, gain: 0.22, pitch: 1.35 })
      break
    // The interrupt is the rarest good thing a heavy can do, so it gets the loudest single sound the
    // blade has and a struck bowl over it.
    case 'interrupt':
      a.play('impactPunch_heavy', { ...at, gain: 0.5, pitch: 1.08 })
      a.bell(0.26, 1046.5, 0.9, 'ui')
      break
    case 'runWon':
      a.bell(1, 196, 4.2)
      a.bell(0.7, 293.66, 3.7, 'music', 0.18)
      a.bell(0.5, 392, 3.2, 'music', 0.36)
      a.stopBed(1.2)
      break
    case 'runLost':
      break
    case 'draw':
      a.play('cloth3', { ...at, gain: 0.55, pitch: 0.85, pitchVar: 0.04 })
      a.swish(0.42, 70, 0.7, ev)
      break
    case 'arrowLoose':
      a.play('woosh2', { ...at, gain: 0.9, pitch: 1.55, pitchVar: 0.06 })
      a.play('swordStone1', { ...at, gain: 0.28, pitch: 1.6 })
      a.swish(0.7, 140, 1.55, ev)
      break
    case 'arrowHitWall':
      a.play('impactGeneric_light', { ...at, gain: 0.35, pitch: 1.15 })
      break
    case 'friendlyProjectileEnded':
      if (ev.kind === 'mirror') {
        a.play('laserRetro', { ...at, gain: 0.35, pitch: 1.55 })
        a.play('impactGeneric_light', { ...at, gain: 0.25, pitch: 1.4 })
      } else a.play('woosh2', { ...at, gain: 0.28, pitch: 1.8 })
      break
  }
  census(a, ev)
}

/** Event-only fallback for tests and offline renderers. The live path supplies the current player
 * position directly to playEventSfx, because enemy cues must not wait for a footstep to move ears. */
function listen(a: AudioSystem, ev: SimEvent): void {
  switch (ev.type) {
    case 'footstep': case 'swing': case 'dodge': case 'dodgeWall': case 'dodgeEnd': case 'dodged': case 'reversal': case 'graze':
    case 'draw': case 'arrowLoose': case 'weaponPrepared': case 'boonChosen': case 'riteChosen':
    case 'playerHurt': case 'playerDeath': case 'returned': a.setListener(ev.x, ev.y)
  }
}

/** Tests and the offline mix renderer start from a known count. */
export function resetSfxState(): void { alive = 0; hp01 = 1 }
