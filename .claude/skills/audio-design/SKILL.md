---
name: audio-design
description: >
  Game audio practice for this repo's raw Web Audio layer (src/audio): bus layout
  (Master > Music / SFX / UI), volume sliders in dB, ducking without pumping, SFX
  pitch and round-robin variation, a master limiter that survives 200 projectiles,
  and adaptive music (vertical layers, bar-quantized re-sequencing, stingers,
  intensity with hysteresis). Use when the user mentions music, adaptive music,
  music layers, stems, ducking, sidechain, mix bus, audio bus, sound design, sfx,
  sound effects, volume slider, audio settings, clipping, limiter, or beat sync.
---

# Audio design

Audio in this game is a small mixing graph plus a music system. Route every
sound through a bus. Make music react to play by changing stem gains and by
switching segments on the bar, not by looping one track.

## The determinism rule

Audio never feeds `src/sim/`. The sim is deterministic given (seed, scenario,
inputs) and runs headless. It must never read `AudioContext.currentTime`, never
wait for a beat, and never import from `src/audio/`.

- Beat sync and music intensity derive from `world.events` and world state
  (enemy count, player hp, wave number). The music follows the game. The game
  never follows the music.
- The AudioContext clock is used only inside `src/audio/` to schedule stems and
  quantize transitions. If a visual should pulse to the beat, the presenter may
  read the music clock. The sim may not.
- A run with `mute=1` and a run with sound must produce the same sim hash.

## Where sounds are wired

- `src/audio/audio.ts`: `AudioSystem`. Decodes files at boot, plays buffers with
  pitch variance and round-robin groups, owns the gain nodes.
- `src/audio/sfxMap.ts`: `playEventSfx(audio, event)`. One `switch` over
  `SimEvent.type`. This is the one place to wire a new sound. Add the event to
  `src/sim/events.ts` if it does not exist, push it from the sim, then map it here.
- `src/main.ts` connects them: `presenter.onEvent = ev => playEventSfx(audio, ev)`.
- Round-robin: files named `woosh1.ogg`, `woosh2.ogg` form group `woosh`. Play the
  group name; `AudioSystem` never repeats the last pick.

## Bus layout

Target: `Master > { Music, SFX, UI }`. Today only `master` exists; every sound
connects to it. Add buses as `GainNode`s that connect to `master`, and give
`play()` a bus option. Never set hundreds of per-clip volumes by hand; balance
on buses, keep per-event gains modest in `sfxMap.ts`.

```ts
const master = ctx.createGain()
const limiter = ctx.createDynamicsCompressor()   // safety net on Master, not the mixer
limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20
limiter.attack.value = 0.003; limiter.release.value = 0.1
master.connect(limiter); limiter.connect(ctx.destination)
const bus = { music: ctx.createGain(), sfx: ctx.createGain(), ui: ctx.createGain() }
for (const b of Object.values(bus)) b.connect(master)
```

Headroom: 200 projectiles firing at once sum far above 0 dBFS. The limiter stops
the distortion, but do not lean on it. Cap voices per event type (for example at
most 4 `boltFired` sounds per frame; drop or reduce gain on the rest) so the mix
stays readable.

## Volume sliders: dB, never raw

Loudness is logarithmic. `GainNode.gain` is linear amplitude. A 0..1 slider fed
straight into `gain` feels like it does nothing until the bottom. Never assign the
slider value as dB either (0.5 would be +0.5 dB, and 0 would be full volume).

```ts
const dbToGain = (db: number) => Math.pow(10, db / 20)
// 0 -> silence, 1 -> 0 dB, and the middle of the travel is audibly the middle.
export function sliderToGain(slider01: number, floorDb = -60): number {
  if (slider01 <= 0) return 0
  return dbToGain(floorDb * (1 - slider01))
}
bus.music.gain.setTargetAtTime(sliderToGain(s), ctx.currentTime, 0.02)
```

Store the slider value, not the gain, in settings.

## Ducking

Duck the Music bus under important SFX (player hurt, boss stinger, deity voice).
Today `duck()` ramps `master`; move it to the Music bus so the SFX that caused
the duck stays loud.

Parameters: threshold about -30 dB on the key signal, ratio about 8:1 (a clear
dip, about -12 dB), attack about 10 ms so music gets out of the way, release
300 to 500 ms so it recovers smoothly. Pumping (music that audibly breathes)
means release is too short or ratio too high. Lengthen release first.

```ts
function duckMusic(depthDb = -12, attack = 0.01, release = 0.4) {
  const t = ctx.currentTime, g = bus.music.gain
  g.cancelScheduledValues(t)
  g.setTargetAtTime(dbToGain(depthDb) * musicLevel, t, attack / 3)
  g.setTargetAtTime(musicLevel, t + attack + 0.1, release / 3)
}
```

`setTargetAtTime` takes a time constant; a third of the wanted time reaches
about 95 percent. Do not use `linearRampToValueAtTime` from 0 for gains; it
clicks. Never stack ducks by multiplying the current gain; always target absolute
levels.

## SFX variation

Repeated identical samples sound like a machine gun. `AudioSystem.play` already
applies +/-8 percent pitch (`pitchVar: 0.08`) and round-robin over groups.

- Footsteps and small hits: 10 to 15 percent pitch variance, 3 or more takes.
- Weapon swings and impacts: 6 to 10 percent, so the attack keeps its identity.
- Jingles, voice, round announcers: `pitchVar: 0`. Pitch shifts on music read as
  mistakes.
- Vary gain by a few percent alongside pitch. Never vary the sample of a sound
  the player must recognize instantly (parry, dodge i-frame confirm).

## Pitfalls

- Reading the audio clock in the sim. See the determinism rule.
- Ducking on Master. The sound that triggered the duck ducks itself.
- Creating a node per sound without cleanup. `AudioBufferSourceNode` frees itself
  after `onended`; gain and filter nodes it connects to are freed with it. Do not
  keep references in a Map.
- Starting stems at different times. They drift apart forever. See the reference.
- Calling `ctx.resume()` before a user gesture. `AudioSystem.load` already
  unlocks on first pointerdown or keydown.

## Reference

- `references/adaptive-music.md`: vertical layering, horizontal re-sequencing,
  stingers, intensity mapping with hysteresis, fade timing, per-realm music.
