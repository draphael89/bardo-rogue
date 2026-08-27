# Adaptive music in Web Audio

Adaptive music changes with play instead of looping one track. Two techniques
combine:

- Vertical layering: several stems (base, drums, bass, tension pad) play in sync.
  Only their gains change. Seamless, because all stems share one timeline.
- Horizontal re-sequencing: the track is split into segments (intro, loop A,
  combat, outro). You choose which segment plays next and switch on a bar.

Both live in `src/audio/`. Inputs come from `world.events` and world state.
Nothing here is visible to `src/sim/`.

## Vertical layering

Author all stems at the same BPM and the same length. Bounce them aligned.
Start every stem at the same `AudioContext` time, looping, with gain 0. Then
only touch gains. Because stems never restart, intensity can change at any time
without losing sync.

```ts
const stems = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>()
function startStems(names: string[], at = ctx.currentTime + 0.05) {
  for (const n of names) {
    const src = ctx.createBufferSource(); src.buffer = buffers.get(n)!; src.loop = true
    const gain = ctx.createGain(); gain.gain.value = 0
    src.connect(gain); gain.connect(bus.music)
    src.start(at)                       // one shared start time keeps them sample-aligned
    stems.set(n, { src, gain })
  }
}
function fadeStem(name: string, to: number, seconds = 0.8) {
  const g = stems.get(name)!.gain.gain
  g.cancelScheduledValues(ctx.currentTime)
  g.setTargetAtTime(to, ctx.currentTime, seconds / 3)
}
```

Fades of 0.5 to 1.5 s feel musical. Instant cuts feel mechanical. Long pads
tolerate longer fades; drums want the short end.

## Horizontal re-sequencing

Switch segments only at a bar boundary. Queue the request; apply it when the
clock crosses the next bar. Segment loops must be sample-accurate at bar
boundaries, or the seam clicks.

```ts
const secPerBar = 60 / bpm * beatsPerBar
let segmentStart = 0, pending: string | null = null
function requestSegment(name: string) { pending = name }
function tickMusic() {                  // called from the render loop, not the sim
  if (!pending) return
  const elapsed = ctx.currentTime - segmentStart
  const nextBar = segmentStart + Math.ceil(elapsed / secPerBar) * secPerBar
  if (nextBar - ctx.currentTime < 0.1) {        // schedule slightly ahead, never in the past
    startSegment(pending, nextBar); segmentStart = nextBar; pending = null
  }
}
```

Transition strategies, in rising order of polish:

- Immediate crossfade (about 0.2 s): fine for low-stakes changes such as a menu.
- Quantized switch: wait for the next beat, bar, or phrase. The default.
- Transition segments: short bridge clips written to connect A to B.
- Stingers: one-shot accents over the bed for an event (boss appears, deity
  speaks, room clear). They never alter the loop. Play them through the Music
  bus so the music slider controls them.

## Mapping play to intensity

Drive music from one smoothed intensity value in 0..1, not from raw events.
Compute it in the presenter or in `src/audio/` from world state after each tick.

```ts
let intensity = 0, level = 0
function updateIntensity(enemiesNear: number, playerHp01: number) {
  const raw = Math.min(enemiesNear / 5, 1) * (1 - 0.4 * playerHp01)
  intensity += (raw - intensity) * 0.05           // smooth so it does not flicker
  // hysteresis: different thresholds up and down, or the music oscillates at the edge
  if (level < 1 && intensity > 0.6) level = 1
  else if (level >= 1 && intensity < 0.4) level = 0
  fadeStem('drums', level >= 1 ? 1 : 0)
}
```

Events that should move intensity directly: `waveStart` (step up, request the
combat segment), `waveClear` (let it decay), `roomClear` (outro segment plus
stinger), `playerDeath` (stop stems with a 1 s fade, play the death stinger).

## Per-realm music

Each realm is a data package: bpm, beats per bar, stem list, segment list,
stinger list. Load the package with the realm, start its stems when the first
room begins, and fade the whole Music bus over 1 to 1.5 s on realm change.
Keep the layer names (`base`, `drums`, `tension`) the same across realms so the
intensity code does not change per realm.

## Budget

Every stem is a decoded buffer in memory and a live voice. Four to six stems per
realm is plenty. Decode music at realm load, not at boot, and drop the old
realm's buffers when the new one starts.
