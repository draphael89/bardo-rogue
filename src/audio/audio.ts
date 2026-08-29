// Web Audio layer. Decodes Foley at boot, plays it with pitch variance and round-robin variants,
// places every sound in the room from the (x, y) the sim already hands us, and routes EVERYTHING
// through Master > { Music, Ambience, SFX, UI } > limiter > destination.
// It also runs the bed: a synthesized drone ambience plus a two-layer combat loop that crossfades
// with the number of live enemies. The bed is generated as sample data (no music assets to ship)
// and every loop is seamless by construction: tonal partials are snapped to whole cycles per loop,
// noise beds are filtered with a warm-up pass, transients decay before the seam.
//
// Presentation only. Nothing in src/sim/ imports this file, and nothing here reads sim state
// except through the values sfxMap hands us after a tick.

import { ASSET_BASE } from '@/assetBase'
import { bedToneFor } from './bedTone'
import type { LayoutId } from '@/sim/layouts'

export type BusName = 'music' | 'ambience' | 'sfx' | 'ui'

export interface PlayOpts {
  gain?: number
  pitch?: number
  pitchVar?: number
  delay?: number
  bus?: BusName
  loop?: boolean
  x?: number           // world position of the source. With y, places the sound in the room.
  y?: number
  fadeIn?: number      // seconds to reach `gain`; 0 (default) starts at full level
  startSilent?: boolean // start at silence and wait for a fade; used by the combat layers
  ducked?: boolean     // route through the bus's duck stage: the bed and the ambience, never a stinger
  flat?: boolean       // place it in the stereo image but do not attenuate it with distance
  lead?: boolean       // skip the SFX crowd stage: your verbs and the danger tells stay full
}

/** A started sound. Buffer sources free themselves on end; only hold a Voice for loops. */
export interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
  level: number      // linear gain this voice sits at when fully faded in
  stop(fade?: number): void
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/**
 * Seconds the master takes to reach silence before a pause stops the clock, and to come back after.
 * Long enough to cover a transient's tail, short enough that pausing still feels instant.
 */
export const SUSPEND_FADE = 0.06

/** 0..1 slider -> linear gain on a dB curve. Store the slider, never the gain. */
export function sliderToGain(slider01: number, floorDb = -60): number {
  if (slider01 <= 0) return 0
  if (slider01 >= 1) return 1
  return dbToGain(floorDb * (1 - slider01))
}

/**
 * Files that ship in the asset manifest and are deliberately never heard: the fighting-game
 * announcer and its round voice-overs. The bardo does not have a ring announcer, so the game's
 * punctuation is struck bowls (see `bell`). Listed here rather than merely left unmapped, so
 * `load()` does not spend boot time decoding them or hold them in memory for the whole run.
 */
export const ANNOUNCER = new Set([
  'round_1', 'round_2', 'round_3', 'fight', 'final_round',
  'flawless_victory', 'you_lose', 'gameover1',
])

// ---------------------------------------------------------------------------
// The mix. Every level and time constant lives here so the whole graph can be
// read (and printed) as one table. Gameplay numbers live in src/tuning.ts;
// these are mix numbers and belong with the graph they describe.
// ---------------------------------------------------------------------------
export const MIX = {
  masterDb: -1,
  // Measured, not guessed. With Music at -7 and SFX at -8.5 a hit cleared the bed by only 2.3 dB
  // of 50 ms RMS in a three-enemy fight, so the swarm sat inside the music instead of over it.
  // Music then went to -10, and the bed still won a second argument: rendered alone over the bed,
  // half the one-shots in the game (a bolt fired across the room, a footstep, a stagger) moved the
  // master RMS by less than 0.1 dB. The bed is continuous and the cues are 30 ms long, so the bed
  // wins any tie. Music -12 with SFX -14 leaves the bed clearly present at p50 (-24 dBFS in the
  // 108-event render) while the loudest 1% of the SFX bus sits 14 dB over it, and no bus reaches
  // 0 dBFS in a wave-3 spawn burst, so the limiter stays the safety net it is meant to be.
  busDb: { music: -12, ambience: -14, sfx: -14, ui: -11 } as Record<BusName, number>,
  // Safety net on Master, not a mixing tool. It should be nearly idle in a normal fight.
  // The out trim owns the ceiling: it is what keeps a wave-3 spawn burst under -1 dBFS.
  // Chrome's DynamicsCompressor adds its own make-up gain, so a fixed trim after it owns the ceiling.
  limiter: { thresholdDb: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.10 },
  outTrimDb: -1.6,
  // Ducks the BED only: its own gain stage in front of the Music and Ambience faders, fed by
  // the looping bed voices and nothing else. So a duck cannot overwrite a volume slider, cannot
  // recover to a stale level, does not touch the SFX that triggered it, and — the reason the
  // stage sits in front of the fader rather than behind it — does not duck the struck bowls that
  // ARE the wave-start stinger, which share the Music bus with the bed.
  // Five callers, four depths (see `by`): -13 dB when the player is hit, -9 dB under a
  // wave-start bowl, -6 dB for the length of an enemy wind-up or a spawn telegraph, -5 dB
  // under the player's own commit so a swing or dodge still clears the bed in a pile-up.
  // A tell is always deeper than a commit, so the warning still wins arbitration.
  // `hold` is the time at full depth before the release starts. It is longer than the fastest
  // re-trigger the game can produce, so a second duck arriving mid-gesture deepens it instead of
  // catching the release halfway back up and pumping.
  duck: {
    depthDb: -11, attack: 0.012, hold: 0.12, release: 0.42,
    // Who is allowed to make room, how much, and how long AFTER the event the room opens.
    // Spread into duck() at the call site, so the printed table and the running game cannot
    // drift apart. The wind-up duck is the shallow, short one: the tell has its own band
    // (bedNotch) and only needs the bed to lean back, not to leave. Arbitration below means a
    // wind-up arriving under a player-hurt duck is ignored rather than cutting the deeper
    // gesture short.
    //
    // The third number is the delay, and it exists because a duck under a transient measured as
    // a HOLE: the player-hurt duck used to start at the same instant as the hurt sound, so the
    // 30 ms window that contains the blow contained the bed falling away too, and the damage
    // moment came out 2.9 dB QUIETER than the bed it played over. Emphasis is the sound's job.
    // The duck now opens 80 ms later — after the transient — so it lengthens the hit's tail
    // instead of eating its front.
    // [depthDb, release, delay]
    by: {
      playerHurt: [-13, 0.5, 0.08],
      waveStart: [-9, 0.6, 0],
      enemyWindup: [-6, 0.15, 0],
      spawnTelegraph: [-6, 0.2, 0],
      // Shallower than a tell. Delayed 80 ms, same reason as playerHurt: a duck that
      // starts with the woosh measures as a HOLE (the bed falls more than the 30 ms
      // sweep adds). The duck lengthens the commit's tail. A light-swing chain
      // re-triggers inside the hold, so the bed stays down for the string and recovers
      // once, instead of pumping once per press.
      playerCommit: [-5, 0.16, 0.08],
    } as Record<string, readonly [number, number, number]>,
  },
  // Buses with a duck stage in front of the fader. The rest have no stage at all.
  ducked: ['music', 'ambience'] as readonly BusName[],
  // The danger tells own 2-4 kHz. A static peaking cut on the bed and the ambience legs -- behind
  // the duck stage, in front of the fader, so it never touches a stinger or an SFX -- keeps that
  // band free instead of making every wind-up fight for it. A permanent hole in one band the bed
  // does not need costs the bed far less than a duck deep enough to be heard through it.
  bedNotch: { hz: 2828, q: 1.4, db: -10 },
  // The room's air. A lowshelf on the ducked legs only — never the tell notch, never SFX.
  // playbackRate lives on the voices; this is the weight under it.
  layoutShelf: { hz: 180, q: 0.7 },
  // At most `max` starts of one sound group inside `window` seconds; the rest are dropped.
  voiceCap: { window: 0.07, max: 4 },
  // Space. Every sim event already carries (x, y); this is what turns it into a stereo image.
  // The player is the ears (sfxMap sets the listener from player-origin events). Pan is x only:
  // the room is read left-to-right. Level falls off with true distance. A sub-millisecond
  // inter-channel delay decorrelates the two sides the way an off-centre source really does,
  // so a placed one-shot is not two identical copies of one mono click.
  space: {
    panWidth: 240,     // px of |dx| that reaches panLimit — half the arena
    panLimit: 0.75,    // never hard-pan: a sound at the wall stays present on both sides
    distanceRef: 160,  // gain = 1 / (1 + dist/ref): -6.0 dB at 160 px, -10.4 dB at 340 px
    itdMs: 0.42,       // inter-channel delay at full pan (a human head tops out near 0.66 ms)
    panDeadzone: 0.02, // below this the panner is skipped entirely
    // Two starts of one sound group at the same instant are queued `step` apart, so a
    // four-enemy spawn is four placed events instead of one 4x thud.
    stagger: { cluster: 0.02, step: 0.038 },
  },
  bed: {
    bpm: 84,
    beatsPerBar: 4,
    combatBars: 2,      // combat loop length: 2 bars = 5.714 s
    ambienceBars: 4,    // drone loop length: 4 bars = 11.429 s
    ambienceDb: 0,      // ambience voice level inside the Ambience bus, when out of combat
    ambienceDuckDb: -8, // ambience recedes under the combat bed
    bedDb: 2,           // combat layer A ("pulse") inside the Music bus
    driveDb: -1.5,      // combat layer B ("churn")
    fadeIn: 1.1,        // seconds to reach a layer's level
    fadeOut: 2.2,       // seconds to fall away; longer so a clear breathes out
    ambienceFade: 1.6,
    // Layer B hysteresis, so it cannot flutter at the boundary.
    driveOnEnemies: 2,
    driveOffEnemies: 1,
    driveOnHp01: 0.4,   // or the player is hurt this low with anything alive
  },
} as const

/**
 * Timbres for `bell`, as [frequency ratio, amplitude, decay scale]. `bowl` is the struck singing
 * bowl that punctuates a wave. `plate` is denser and more metallic: a heavy blade being raised.
 * `tone` is nearly pure, so a glide on it reads as one pitch rising rather than as a clang.
 */
const PARTIALS = {
  bowl: [[1, 0.5, 1], [2.76, 0.28, 0.55], [5.40, 0.14, 0.3], [8.93, 0.08, 0.17]],
  plate: [[1, 0.46, 1], [1.41, 0.30, 0.72], [2.09, 0.22, 0.46], [3.17, 0.13, 0.30], [4.51, 0.07, 0.20]],
  tone: [[1, 0.62, 1], [1.50, 0.16, 0.75], [2.00, 0.09, 0.5], [3.01, 0.04, 0.35]],
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>

export type BellTimbre = keyof typeof PARTIALS

export interface BellOpts {
  glideTo?: number       // bend the ring to this frequency by its end; omitted = a fixed pitch
  partials?: BellTimbre
  strike?: number        // 0..1 on the 8 ms strike noise; 0 for a pure tell, 1 for a struck bowl
  x?: number             // place it in the room, like any one-shot
  y?: number
  cap?: string           // voice-cap group: four brutes winding up together is one tell, not four
}

/**
 * The duck stage's scheduled gain over time, as numbers: `delay` seconds flat, then
 * setTargetAtTime to `depth` with a one-third time constant, hold, then setTargetAtTime back to
 * 1. `t` is measured from the EVENT, so a delayed duck shows its flat head — the window the
 * transient gets to itself. This is the schedule the code writes, printed; duck-curves.json
 * measures the same thing off a rendered signal.
 */
function duckCurve(depthDb: number, release: number, delay = 0): { t: number; gainMul: number; db: number }[] {
  const d = dbToGain(depthDb), a = MIX.duck.attack / 3, r = release / 3
  const holdEnd = MIX.duck.attack + MIX.duck.hold
  const atHold = 1 + (d - 1) * (1 - Math.exp(-holdEnd / a))
  return [0, 0.005, 0.012, 0.03, 0.06, 0.08, 0.085, 0.1, 0.132, 0.2, 0.3, 0.45, 0.6, 0.9, 1.4].map(t => {
    const u = t - delay
    const v = u <= 0 ? 1
      : u <= holdEnd ? 1 + (d - 1) * (1 - Math.exp(-u / a))
      : 1 + (atHold - 1) * Math.exp(-(u - holdEnd) / r)
    return { t, gainMul: +v.toFixed(4), db: +(20 * Math.log10(v)).toFixed(2) }
  })
}

/** Magnitude of the RBJ peaking biquad, in dB. Used only to print the notch as numbers. */
function peakingDb(hz: number, eq: { hz: number; q: number; db: number }, sr: number): number {
  const A = Math.pow(10, eq.db / 40), w0 = 2 * Math.PI * eq.hz / sr, al = Math.sin(w0) / (2 * eq.q), c = Math.cos(w0)
  const b = [1 + al * A, -2 * c, 1 - al * A], a = [1 + al / A, -2 * c, 1 - al / A]
  const w = 2 * Math.PI * hz / sr
  const mag = (k: number[]) => Math.hypot(k[0] + k[1] * Math.cos(w) + k[2] * Math.cos(2 * w), -(k[1] * Math.sin(w) + k[2] * Math.sin(2 * w)))
  return 20 * Math.log10(mag(b) / mag(a))
}

export class AudioSystem {
  ctx: BaseAudioContext | null = null
  master: GainNode | null = null
  limiter: DynamicsCompressorNode | null = null
  outTrim: GainNode | null = null
  bus: Record<BusName, GainNode> | null = null
  /** Pre-fader duck stage for the bed legs. 1.0 when nothing is making room. */
  duckStage: Partial<Record<BusName, GainNode>> = {}
  /** Competing SFX sit here. Lead voices (your swing, a tell) join the SFX fader past it. */
  crowd: GainNode | null = null
  /** The static 2-4 kHz cut that reserves the tell band, one per ducked bus. */
  bedNotch: Partial<Record<BusName, BiquadFilterNode>> = {}
  /** Per-layout lowshelf on the same legs. The Hall is heavier than the Gate. */
  layoutShelf: Partial<Record<BusName, BiquadFilterNode>> = {}
  /** Offline rendering only: added to ctx.currentTime so a whole fight can be scheduled ahead. */
  timeOffset = 0

  private buffers = new Map<string, AudioBuffer>()
  private groups = new Map<string, string[]>()
  private lastPick = new Map<string, number>()
  private busLevel: Record<BusName, number> = { music: 1, ambience: 1, sfx: 1, ui: 1 }
  private slider: Record<BusName | 'master', number> = { master: 1, music: 1, ambience: 1, sfx: 1, ui: 1 }
  private starts = new Map<string, number[]>()
  private slots = new Map<string, number>()
  private duckUntil = 0
  private duckDepth = 1        // linear multiplier the stage is scheduled to at this instant
  private listener = { x: 0, y: 0 }

  private bedBuffers: { ambience?: AudioBuffer; bed?: AudioBuffer; drive?: AudioBuffer } = {}
  private bedVoices: { ambience?: Voice; bed?: Voice; drive?: Voice } = {}
  private bedStarted = false
  private bedSuppressed = false
  private bedBuilding = false
  private driveOn = false
  private driveApplied = false
  private combatOn = false
  private lastCombat: [number, number] = [0, 1]
  private layout: LayoutId = 'bardo'

  private _muted = false
  get muted(): boolean { return this._muted }
  set muted(m: boolean) {
    if (m === this._muted) return
    this._muted = m
    if (this.master) {
      const t = this.now()
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setTargetAtTime(m ? 0 : this.masterLevel(), t, 0.02)
    }
    if (!m) this.ensureBed()
  }

  private _suspended = false
  /** The real context, recorded at load(). Never the offline renderer's, which must not be paused. */
  private liveCtx: AudioContext | null = null
  private suspendGen = 0
  get suspended(): boolean { return this._suspended }
  /** Whether browser policy is still withholding the live clock from non-gesture input. */
  get needsGesture(): boolean {
    return !this._muted && this.liveCtx !== null && this.liveCtx.state !== 'running'
  }

  /**
   * Pause owns the whole clock, not the master fader. Fading alone would leave the bed's loops and
   * every scheduled voice running behind the pause screen: the music would come back bars further on
   * than where it stopped, a door stinger queued 1.2 s out would fire the instant play resumed, and
   * a tab left paused would keep a synthesiser awake indefinitely. Suspending freezes `currentTime`
   * itself, and every deadline in this file is expressed in context time, so nothing drifts or
   * expires while the game is away.
   *
   * The fade is not decoration. Half the cues here are 30-200 ms transients, and cutting the clock
   * mid-waveform clicks on the way down and finishes a chopped hit on the way up — so the master
   * ramps to silence first and the clock stops a beat later, under cover.
   */
  /**
   * Ask the browser to let the clock run, if it is not running and we did not stop it ourselves.
   *
   * The two listeners installed by `load` cover mouse and keyboard. A controller-only player fires
   * neither — and a gamepad button is not a user activation in any browser — so without a path that
   * asks again they were the one input device that got a silent game. This cannot force a refused
   * resume; it makes sure the game keeps asking, so audio starts the moment the browser allows it.
   * Cheap enough to call every frame: it returns before touching a promise unless there is
   * something to fix.
   */
  tryUnlock(): void {
    if (this._suspended) return
    const c = this.liveCtx
    if (!c || c.state === 'running') return
    void c.resume().catch(() => { /* refused without a gesture; we will ask again */ })
  }

  /** Resume inside a real pointer/key activation and report the browser's actual decision. */
  async resumeFromGesture(): Promise<boolean> {
    this.setSuspended(false)
    const c = this.liveCtx
    if (this._muted || !c) return true
    try { await c.resume() } catch { return false }
    return c.state === 'running'
  }

  setSuspended(s: boolean): void {
    if (s === this._suspended) return
    this._suspended = s
    const c = this.liveCtx
    if (!c) return
    const gen = ++this.suspendGen
    const master = this.master
    const level = () => (this._muted ? 0 : this.masterLevel())

    if (s) {
      if (master) {
        const t = this.now()
        master.gain.cancelScheduledValues(t)
        master.gain.setTargetAtTime(0, t, SUSPEND_FADE / 3)
      }
      // A rapid pause/unpause must not land this suspend after the resume; the generation guard is
      // what keeps a mashed Escape key from wedging the game silent.
      setTimeout(() => {
        if (gen !== this.suspendGen || !this._suspended) return
        void c.suspend().catch(() => { /* already closed or refused; the fade still silenced it */ })
      }, SUSPEND_FADE * 1000)
      return
    }

    void c.resume().then(() => {
      if (gen !== this.suspendGen || this._suspended) return
      if (!master) return
      const t = this.now()
      master.gain.cancelScheduledValues(t)
      master.gain.setTargetAtTime(level(), t, SUSPEND_FADE / 3)
    }).catch(() => {
      // A programmatic resume outside a user gesture can be refused. Bring the fader back anyway so
      // the game is audible again the moment the browser lets the context run.
      if (gen !== this.suspendGen || this._suspended || !master) return
      master.gain.setTargetAtTime(level(), this.now(), SUSPEND_FADE / 3)
    })
  }

  // sliderToGain, not a raw multiply: the pause card shows three identical sliders, and the master
  // answering linearly while the buses answer on the -60 dB curve made equal positions sound wildly
  // different (master 0.5 was -6 dB where music 0.5 was -30 dB).
  private masterLevel(): number { return dbToGain(MIX.masterDb) * sliderToGain(this.slider.master) }
  private now(): number { return (this.ctx?.currentTime ?? 0) + this.timeOffset }

  /**
   * Decode every file and build the graph. `ctx` is only passed by the offline mix renderer;
   * the game leaves it out and gets a real AudioContext plus the gesture unlock.
   */
  async load(files: string[], base = `${ASSET_BASE}audio/`, ctx?: BaseAudioContext): Promise<void> {
    if (!ctx && typeof AudioContext === 'undefined') return
    this.ctx = ctx ?? new AudioContext()
    // Only a context we created is ours to pause. OfflineAudioContext also declares suspend(), but
    // its version takes a required time argument and pausing a render would wedge it forever.
    this.liveCtx = ctx ? null : (this.ctx as AudioContext)
    this.buildGraph()
    files = files.filter(f => !ANNOUNCER.has(f.replace('.ogg', '')))
    await Promise.all(files.map(async f => {
      try {
        const res = await fetch(base + f)
        const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer())
        const name = f.replace('.ogg', '')
        this.buffers.set(name, buf)
        const group = name.replace(/[_-]?\d+$/, '')
        if (!this.groups.has(group)) this.groups.set(group, [])
        this.groups.get(group)!.push(name)
      } catch (e) { console.warn('audio load failed', f, e) }
    }))
    for (const g of this.groups.values()) g.sort()
    await this.buildBed()
    if (typeof window !== 'undefined' && 'resume' in this.ctx) {
      const c = this.ctx as AudioContext
      // The gesture unlock must not undo a deliberate pause: a player who pauses before ever
      // clicking would otherwise get the bed back by dismissing the dialog. It also stays installed
      // as the recovery path for a suspend the browser initiated on its own (mobile audio focus, a
      // backgrounded tab) - without it, an interrupted context stays silent with nothing to revive it.
      window.addEventListener('pointerdown', () => this.tryUnlock())
      window.addEventListener('keydown', () => this.tryUnlock())
    }
  }

  private buildGraph(): void {
    const ctx = this.ctx!
    this.master = ctx.createGain()
    this.master.gain.value = this._muted ? 0 : this.masterLevel()
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = MIX.limiter.thresholdDb
    this.limiter.knee.value = MIX.limiter.knee
    this.limiter.ratio.value = MIX.limiter.ratio
    this.limiter.attack.value = MIX.limiter.attack
    this.limiter.release.value = MIX.limiter.release
    this.outTrim = ctx.createGain()
    this.outTrim.gain.value = dbToGain(MIX.outTrimDb)
    this.master.connect(this.limiter); this.limiter.connect(this.outTrim); this.outTrim.connect(ctx.destination)
    this.duckStage = {}; this.bedNotch = {}; this.layoutShelf = {}
    const mk = (b: BusName) => {
      const g = ctx.createGain()
      // The slider may have been set before the context existed (settings load at boot, the graph
      // at the first gesture); a bus that ignored it here would discard the player's saved volume.
      this.busLevel[b] = dbToGain(MIX.busDb[b]) * sliderToGain(this.slider[b])
      g.gain.value = this.busLevel[b]
      g.connect(this.master!)
      if (MIX.ducked.includes(b)) {
        const d = ctx.createGain()
        d.gain.value = 1
        const notch = ctx.createBiquadFilter()
        notch.type = 'peaking'
        notch.frequency.value = MIX.bedNotch.hz
        notch.Q.value = MIX.bedNotch.q
        notch.gain.value = MIX.bedNotch.db
        const shelf = ctx.createBiquadFilter()
        shelf.type = 'lowshelf'
        shelf.frequency.value = MIX.layoutShelf.hz
        shelf.Q.value = MIX.layoutShelf.q
        shelf.gain.value = 0
        // bed -> duck -> tell-band notch -> room shelf -> fader -> Master. Stingers join
        // at the fader, so they are neither ducked, notched, nor retuned by the floor.
        d.connect(notch); notch.connect(shelf); shelf.connect(g)
        this.duckStage[b] = d
        this.bedNotch[b] = notch
        this.layoutShelf[b] = shelf
      }
      return g
    }
    this.bus = { music: mk('music'), ambience: mk('ambience'), sfx: mk('sfx'), ui: mk('ui') }
    this.crowd = ctx.createGain()
    this.crowd.gain.value = 1
    this.crowd.connect(this.bus.sfx)
  }

  /** 0..1 slider on a dB curve. `master` scales everything; a bus scales one leg. */
  setLevel(target: BusName | 'master', slider01: number): void {
    this.slider[target] = slider01
    if (!this.ctx) return
    const t = this.now()
    if (target === 'master') {
      if (!this.master) return
      if (!this._muted) this.master.gain.setTargetAtTime(this.masterLevel(), t, 0.02)
      return
    }
    if (!this.bus) return
    this.busLevel[target] = dbToGain(MIX.busDb[target]) * sliderToGain(slider01)
    this.bus[target].gain.setTargetAtTime(this.busLevel[target], t, 0.02)
  }

  // -------------------------------------------------------------------------
  // Space
  // -------------------------------------------------------------------------

  /** Move the ears. sfxMap calls this from the events whose (x, y) IS the player. */
  setListener(x: number, y: number): void { this.listener.x = x; this.listener.y = y }

  /** Where the ears are, for the mix report. */
  get ears(): Readonly<{ x: number; y: number }> { return this.listener }

  /**
   * Where a world point lands in the stereo image. Public so the mix report can print a
   * pan column without re-deriving the formula.
   */
  spatial(x: number, y: number): { pan: number; gain: number; itd: number; dist: number } {
    const S = MIX.space
    const dx = x - this.listener.x, dy = y - this.listener.y
    const dist = Math.hypot(dx, dy)
    const pan = Math.max(-S.panLimit, Math.min(S.panLimit, dx / S.panWidth))
    return { pan, dist, gain: 1 / (1 + dist / S.distanceRef), itd: Math.abs(pan) / S.panLimit * S.itdMs / 1000 }
  }

  /** The node a bus leaves through on its way to Master — a tap here measures the whole bus. */
  busOut(b: BusName): GainNode | null { return this.bus?.[b] ?? null }

  /** The whole graph as numbers, for the mix report. */
  graph(): unknown {
    return {
      master: { db: MIX.masterDb, gain: +this.masterLevel().toFixed(4) },
      limiter: { ...MIX.limiter, outTrimDb: MIX.outTrimDb, outTrimGain: +dbToGain(MIX.outTrimDb).toFixed(4) },
      buses: (Object.keys(MIX.busDb) as BusName[]).map(b => ({ bus: b, db: MIX.busDb[b], gain: +dbToGain(MIX.busDb[b]).toFixed(4) })),
      duck: {
        ...MIX.duck,
        callers: Object.entries(MIX.duck.by).map(([event, [depthDb, release, delay]]) => ({
          event, depthDb, release, delay,
          gesture: +(delay + MIX.duck.attack + MIX.duck.hold + release).toFixed(3),
          curve: duckCurve(depthDb, release, delay),
        })),
        targetGainMultiplier: +dbToGain(MIX.duck.depthDb).toFixed(4),
        applies: [...MIX.ducked],
        stage: 'own GainNode in front of the bus fader, fed by the bed loops only: bed -> duck -> fader -> Master. Stingers (the struck bowls) join at the fader and are never ducked.',
        arbitration: 'deeper wins, longer extends; a weaker+shorter duck is ignored',
      },
      bedNotch: {
        ...MIX.bedNotch,
        stage: 'peaking biquad between the duck stage and the room shelf: it shapes the bed and the ambience only, never a stinger and never an SFX',
        reserves: 'the danger tells (enemyWindup, spawnTelegraph) and the dodge sweep live in this band',
        response: [500, 1000, 1500, 2000, 2828, 4000, 6000, 9000].map(hz => ({ hz, db: +peakingDb(hz, MIX.bedNotch, 48000).toFixed(2) })),
      },
      layoutShelf: {
        ...MIX.layoutShelf,
        layout: this.layout,
        tone: bedToneFor(this.layout),
        stage: 'lowshelf after the tell notch, before the fader. playbackRate on the voices. The tell band does not move.',
      },
      bed: MIX.bed,
      space: {
        ...MIX.space,
        chain: 'source -> clip gain -> [splitter -> far-channel delay -> merger] -> stereo panner -> BUS',
        curve: [0, 40, 80, 120, 160, 200, 240, 320].map(dx => {
          const s = { ...MIX.space }
          const pan = Math.max(-s.panLimit, Math.min(s.panLimit, dx / s.panWidth))
          const x = (pan + 1) * Math.PI / 4     // StereoPannerNode is equal-power
          const l = Math.cos(x), r = Math.sin(x)
          return {
            dx, pan: +pan.toFixed(3),
            distGainDb: +(20 * Math.log10(1 / (1 + dx / s.distanceRef))).toFixed(2),
            lDb: +(20 * Math.log10(l)).toFixed(2), rDb: +(20 * Math.log10(r)).toFixed(2),
            lrSpreadDb: +(20 * Math.log10(r / l)).toFixed(2),
            itdMs: +(Math.abs(pan) / s.panLimit * s.itdMs).toFixed(3),
          }
        }),
      },
    }
  }

  // -------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------

  /** name is an exact stem ("woosh3") or a group ("woosh") for anti-repeat round-robin. */
  play(name: string, o: PlayOpts = {}): Voice | null {
    if (this._muted || !this.ctx || !this.bus) return null
    if (!o.loop && !this.allow(name)) return null
    let key = name
    const group = this.groups.get(name)
    if (group && group.length > 1) {
      const last = this.lastPick.get(name) ?? -1
      let i = Math.floor(Math.random() * group.length)
      if (i === last) i = (i + 1) % group.length
      this.lastPick.set(name, i); key = group[i]
    } else if (group) key = group[0]
    const buf = this.buffers.get(key)
    if (!buf) return null
    const pv = o.pitchVar ?? 0.08
    return this.start(buf, {
      ...o,
      delay: (o.delay ?? 0) + (o.loop ? 0 : this.slot(name)),
      pitch: (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * pv),
    })
  }

  /**
   * Four chargers spawning on one tick used to sum into a single 4x thud. Queue same-instant
   * starts of one group a few tens of ms apart and they read as four separate arrivals.
   * Returns the extra delay in seconds.
   */
  private slot(name: string): number {
    const S = MIX.space.stagger, t = this.now()
    const prev = this.slots.get(name)
    const at = prev !== undefined && prev >= t - S.cluster ? prev + S.step : t
    this.slots.set(name, at)
    return at - t
  }

  /** Start a decoded or generated buffer on a bus. Returns a Voice so loops can be faded. */
  private start(buf: AudioBuffer, o: PlayOpts & { pitch?: number }): Voice {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = !!o.loop
    src.playbackRate.value = o.pitch ?? 1
    const pos = o.x !== undefined && o.y !== undefined ? this.spatial(o.x, o.y) : null
    // `flat` keeps the pan and the inter-channel delay but drops the distance law. Struck metal is
    // the game's warning system, and a caster stands at the far wall: a tell that loses 8 dB to
    // the room is a tell you answer late. Incidental Foley still falls off normally.
    const level = (o.gain ?? 1) * (pos && !o.flat ? pos.gain : 1)
    const g = ctx.createGain()
    const t = this.now() + (o.delay ?? 0)
    const silent = !!o.startSilent || !!(o.fadeIn && o.fadeIn > 0)
    g.gain.setValueAtTime(silent ? 0.0001 : level, t)
    if (o.fadeIn && o.fadeIn > 0 && !o.startSilent) g.gain.setTargetAtTime(level, t, o.fadeIn / 3)
    src.connect(g); this.route(g, pos, o.bus ?? 'sfx', !!o.ducked, !!o.lead)
    src.start(t)
    const voice: Voice = {
      src, gain: g, level,
      stop: (fade = 0) => {
        const now = this.now()
        if (fade > 0) {
          g.gain.cancelScheduledValues(now)
          g.gain.setTargetAtTime(0, now, fade / 3)
          src.stop(now + fade + 0.1)
        } else src.stop(now)
      },
    }
    return voice
  }

  /**
   * Connect one voice's gain to its bus, through the stereo image when the sound has a place
   * in the room. Level difference alone leaves the two channels identical in shape, so the far
   * channel is also delayed by the inter-channel time of a source that far off-axis. The
   * splitter's up-mix is discrete, so the gain node is forced to stereo first — otherwise a
   * mono clip would arrive with one silent side.
   */
  private route(g: GainNode, pos: { pan: number; itd: number } | null, bus: BusName, ducked = false, lead = false): void {
    const target = (ducked ? this.duckStage[bus] : undefined)
      ?? (bus === 'sfx' && !lead && this.crowd ? this.crowd : this.bus![bus])
    if (!pos || Math.abs(pos.pan) < MIX.space.panDeadzone) { g.connect(target); return }
    const ctx = this.ctx!
    const panner = ctx.createStereoPanner()
    panner.pan.value = pos.pan
    panner.connect(target)
    if (pos.itd <= 0) { g.connect(panner); return }
    g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'
    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    const delay = ctx.createDelay(0.01)
    delay.delayTime.value = pos.itd
    const far = pos.pan < 0 ? 1 : 0          // a source on the left reaches the right side later
    split.connect(merge, 1 - far, 1 - far)
    split.connect(delay, far); delay.connect(merge, 0, far)
    merge.connect(panner)
    g.connect(split)
  }

  /** Loop a decoded file (ambience stems that ship as assets would use this). */
  loop(name: string, o: PlayOpts = {}): Voice | null {
    return this.play(name, { pitchVar: 0, ...o, loop: true })
  }

  /** Ramp a running voice to a dB level relative to its own start level. -Infinity fades out. */
  fadeVoice(v: Voice | undefined, db: number, seconds: number): void {
    if (!v || !this.ctx) return
    const t = this.now()
    const to = db === -Infinity ? 0 : v.level * dbToGain(db)
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setTargetAtTime(to, t, Math.max(0.01, seconds) / 3)
  }

  /** Ramp two voices in opposite directions over one window. Targets are dB on each voice's own level. */
  crossfade(out: Voice | undefined, into: Voice | undefined, seconds = 1, outDb = -Infinity, intoDb = 0): void {
    this.fadeVoice(out, outDb, seconds)
    this.fadeVoice(into, intoDb, seconds)
  }

  /** Short synthesized noise sweep layered under the sword whoosh. Placed with its whoosh. */
  swish(gain = 0.35, ms = 120, pitch = 1, at?: { x: number; y: number }, lead = false): void {
    if (this._muted || !this.ctx || !this.bus) return
    if (!this.allow('swish')) return
    const ctx = this.ctx
    const n = Math.floor(ctx.sampleRate * ms / 1000)
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.sin(t * Math.PI) }
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9
    const t0 = this.now()
    f.frequency.setValueAtTime(600 * pitch, t0); f.frequency.exponentialRampToValueAtTime(2600 * pitch, t0 + ms / 1000)
    const pos = at ? this.spatial(at.x, at.y) : null
    const g = ctx.createGain(); g.gain.setValueAtTime(gain * (pos ? pos.gain : 1), t0)
    src.connect(f); f.connect(g); this.route(g, pos, 'sfx', false, lead); src.start(t0)
  }

  /**
   * Struck metal. One generator, two jobs:
   *  - the game's punctuation (wave start, room clear): a bowl on the Music bus. This is what
   *    replaces the fighting-game announcer.
   *  - the danger tell (enemy wind-up, spawn telegraph): a bright ring on the SFX bus, pitched
   *    into the 2-4 kHz band the bed is notched out of, so the cue that says "this is about to
   *    hurt" never has to shout over the bed to be heard.
   * `glideTo` bends the ring over its length (a caster charging reads as a rising tone),
   * `partials` picks the timbre, `strike` scales the 8 ms noise transient, `cap` groups the tell
   * under the voice cap, and x/y place it in the room like any other one-shot.
   */
  bell(gain = 0.5, hz = 523.25, decay = 1.6, bus: BusName = 'music', delay = 0, o: BellOpts = {}): void {
    if (this._muted || !this.ctx || !this.bus) return
    if (o.cap && !this.allow(o.cap)) return
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const n = Math.floor(sr * (decay + 0.05))
    const buf = ctx.createBuffer(1, n, sr)
    const d = buf.getChannelData(0)
    const bend = o.glideTo ? Math.pow(o.glideTo / hz, 1 / n) : 1   // per-sample ratio: an exponential glide
    for (const [ratio, amp, dk] of PARTIALS[o.partials ?? 'bowl']) {
      const tau = decay * dk
      let phase = 0, f = hz * ratio
      for (let i = 0; i < n; i++) {
        d[i] += amp * Math.sin(phase) * Math.exp(-(i / sr) / tau)
        phase += 2 * Math.PI * f / sr
        f *= bend
      }
    }
    // strike noise, 8 ms
    const nAtk = Math.floor(sr * 0.008), strike = 0.25 * (o.strike ?? 1)
    for (let i = 0; i < nAtk; i++) d[i] += (Math.random() * 2 - 1) * strike * (1 - i / nAtk)
    let peak = 0
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]))
    if (peak > 0) for (let i = 0; i < n; i++) d[i] = d[i] / peak * 0.9
    this.start(buf, { gain, bus, delay, x: o.x, y: o.y, flat: true, lead: bus === 'sfx' })
  }

  /**
   * The body of a blow. A sine that falls from `fromHz` to `toHz` inside about 45 ms and rings
   * out, with a few ms of contact noise on the front.
   *
   * It exists to own 60-150 Hz. The danger tells live at 2-4 kHz, every impact and most of the
   * bed's energy live at 200-600 Hz, and the bed's own low end is a steady 55 Hz drone — so a
   * transient here is heard as weight rather than as one more voice in the busiest band in the
   * mix. This is what carries the damage moment: the emphasis belongs to the sound, not to the
   * duck that follows it.
   */
  thump(gain = 0.8, fromHz = 190, toHz = 58, decay = 0.22, o: { x?: number; y?: number; click?: number; bendMs?: number } = {}): void {
    if (this._muted || !this.ctx || !this.bus) return
    const ctx = this.ctx, sr = ctx.sampleRate
    const n = Math.floor(sr * (decay + 0.05))
    const buf = ctx.createBuffer(1, n, sr)
    const d = buf.getChannelData(0)
    const bend = (o.bendMs ?? 45) / 1000
    let phase = 0
    for (let i = 0; i < n; i++) {
      const t = i / sr
      phase += 2 * Math.PI * (toHz + (fromHz - toHz) * Math.exp(-t / bend)) / sr
      // 2 ms of attack ramp: a sine started at full level from zero phase is a click, not a hit
      d[i] = Math.sin(phase) * Math.exp(-t / decay) * (1 - Math.exp(-t / 0.002))
    }
    const nAtk = Math.floor(sr * 0.012), click = 0.3 * (o.click ?? 1)
    for (let i = 0; i < nAtk; i++) d[i] += (Math.random() * 2 - 1) * click * (1 - i / nAtk) ** 2
    let peak = 0
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]))
    if (peak > 0) for (let i = 0; i < n; i++) d[i] = d[i] / peak * 0.9
    this.start(buf, { gain, bus: 'sfx', x: o.x, y: o.y, flat: true, lead: true })
  }

  // -------------------------------------------------------------------------
  // Ducking: Music + Ambience only, absolute targets, never restacked.
  // -------------------------------------------------------------------------
  duck(depthDb: number = MIX.duck.depthDb, release: number = MIX.duck.release, delay = 0): void {
    if (!this.ctx) return
    // `delay` moves the whole gesture later, transient first. Everything below — arbitration,
    // hold, release — is measured from where the ramp actually starts, so a delayed duck cannot
    // be cut short by an earlier immediate one and vice versa.
    const t = this.now() + delay
    if (t >= this.duckUntil) this.duckDepth = 1        // the last duck has fully released
    // A deeper duck always wins and a longer one extends the hold. Comparing end times alone
    // dropped the -13 dB player-hit duck whenever a shallower wave-start duck was still in
    // flight, which is exactly the moment the music has to get out of the way.
    const depth = Math.min(this.duckDepth, dbToGain(depthDb))
    const end = t + MIX.duck.attack + MIX.duck.hold + release
    if (end <= this.duckUntil && depth >= this.duckDepth) return
    this.duckDepth = depth
    this.duckUntil = Math.max(this.duckUntil, end)
    const holdEnd = this.duckUntil - release
    for (const b of MIX.ducked) {
      const g = this.duckStage[b]?.gain
      if (!g) continue
      g.cancelScheduledValues(t)
      g.setTargetAtTime(depth, t, MIX.duck.attack / 3)
      g.setTargetAtTime(1, holdEnd, release / 3)
    }
    // The same gesture carves the SFX pile: lead voices (your swing, a tell) already
    // joined the fader past this node, so they stay full while the crowd leans back.
    const crowd = this.crowd?.gain
    if (crowd) {
      crowd.cancelScheduledValues(t)
      crowd.setTargetAtTime(depth, t, MIX.duck.attack / 3)
      crowd.setTargetAtTime(1, holdEnd, release / 3)
    }
  }

  // -------------------------------------------------------------------------
  // The bed
  // -------------------------------------------------------------------------

  /** Called from sfxMap after each batch of events. alive = live enemies, hp01 = player hp fraction. */
  setCombat(alive: number, hp01: number): void {
    if (!this.ctx) return
    this.lastCombat = [alive, hp01]
    this.ensureBed()
    const B = MIX.bed
    const combat = alive > 0
    if (this.driveOn) {
      if (alive <= B.driveOffEnemies && hp01 > B.driveOnHp01) this.driveOn = false
    } else if (combat && (alive >= B.driveOnEnemies || hp01 <= B.driveOnHp01)) this.driveOn = true
    if (!combat) this.driveOn = false
    if (combat !== this.combatOn) {
      this.combatOn = combat
      const { ambience, bed } = this.bedVoices
      if (combat) this.crossfade(ambience, bed, B.fadeIn, B.ambienceDuckDb, 0)
      else this.crossfade(bed, ambience, B.fadeOut, -Infinity, 0)
    }
    const driveWanted = this.driveOn
    if (driveWanted !== this.driveApplied) {
      this.driveApplied = driveWanted
      this.fadeVoice(this.bedVoices.drive, driveWanted ? 0 : -Infinity, driveWanted ? B.fadeIn * 0.8 : B.fadeOut)
    }
  }

  /** Retune the one bed to the floor. Same loops; the Hall is heavier than the Gate. */
  setLayout(layout: LayoutId): void {
    if (layout === this.layout) return
    this.layout = layout
    this.applyLayoutTone(false)
  }

  private applyLayoutTone(immediate: boolean): void {
    if (!this.ctx) return
    const tone = bedToneFor(this.layout)
    const t = this.now()
    for (const v of Object.values(this.bedVoices)) {
      if (!v) continue
      if (immediate) v.src.playbackRate.value = tone.rate
      else v.src.playbackRate.setTargetAtTime(tone.rate, t, 0.35)
    }
    for (const shelf of Object.values(this.layoutShelf)) {
      if (!shelf) continue
      if (immediate) shelf.gain.value = tone.shelfDb
      else shelf.gain.setTargetAtTime(tone.shelfDb, t, 0.35)
    }
  }
  /** The running bed voices, for a mix debug view or an offline level check. Read only. */
  get layers(): Readonly<{ ambience?: Voice; bed?: Voice; drive?: Voice }> { return this.bedVoices }

  /** Fade the whole bed away (death) and keep it away until resumeBed(). */
  stopBed(fade = 1.4): void {
    this.bedSuppressed = true
    for (const v of Object.values(this.bedVoices)) v?.stop(fade)
    this.bedVoices = {}
    this.bedStarted = false
    this.combatOn = false; this.driveOn = false; this.driveApplied = false
  }

  /** Let the bed come back on the next setCombat() — a new run. */
  resumeBed(): void { this.bedSuppressed = false }

  private ensureBed(): void {
    if (this.bedStarted || this.bedSuppressed || this._muted || !this.ctx || !this.bus) return
    if (!this.bedBuffers.ambience || !this.bedBuffers.bed || !this.bedBuffers.drive) {
      // muted at boot (every screenshot run): the loops were never generated. Do it now, then re-enter.
      // when the loops land, re-apply whatever the fight is doing by then
      if (!this.bedBuilding) { this.bedBuilding = true; void this.buildBed().then(() => { this.bedBuilding = false; this.setCombat(...this.lastCombat) }) }
      return
    }
    this.bedStarted = true
    const B = MIX.bed
    // one shared start time: bed and drive stay sample-aligned forever
    const at = 0.05
    this.bedVoices.ambience = this.start(this.bedBuffers.ambience, { gain: dbToGain(B.ambienceDb), bus: 'ambience', loop: true, fadeIn: 2, delay: at, ducked: true })
    // both combat layers share one start time, so they stay sample-aligned forever
    this.bedVoices.bed = this.start(this.bedBuffers.bed, { gain: dbToGain(B.bedDb), bus: 'music', loop: true, delay: at, startSilent: true, ducked: true })
    this.bedVoices.drive = this.start(this.bedBuffers.drive, { gain: dbToGain(B.driveDb), bus: 'music', loop: true, delay: at, startSilent: true, ducked: true })
    this.combatOn = false; this.driveOn = false; this.driveApplied = false
    this.applyLayoutTone(true)
  }

  /**
   * Generate the three bed loops. Each renderer yields between passes and we hand the thread
   * back after every one, so boot never blocks longer than a frame. The bed is generated at
   * GEN_SR and resampled on playback: it has nothing above 6 kHz, and this halves both the
   * generation cost and the memory it sits in.
   */
  private async buildBed(): Promise<void> {
    if (!this.ctx || this._muted) return   // a muted run (pnpm shot/poses) never pays for this
    const sr = Math.min(this.ctx.sampleRate, GEN_SR)
    const spb = 60 / MIX.bed.bpm                       // seconds per beat
    const bar = spb * MIX.bed.beatsPerBar
    const drive = async (g: Generator<void, [F32, F32]>) => {
      for (;;) { const r = g.next(); if (r.done) return r.value; await nextTask() }
    }
    this.bedBuffers.ambience = this.toBuffer(await drive(renderAmbience(sr, bar * MIX.bed.ambienceBars)), sr)
    this.bedBuffers.bed = this.toBuffer(await drive(renderCombatBed(sr, bar * MIX.bed.combatBars, spb)), sr)
    this.bedBuffers.drive = this.toBuffer(await drive(renderCombatDrive(sr, bar * MIX.bed.combatBars, spb)), sr)
  }

  private toBuffer(ch: [F32, F32], sr: number): AudioBuffer {
    const buf = this.ctx!.createBuffer(2, ch[0].length, sr)
    buf.copyToChannel(ch[0], 0); buf.copyToChannel(ch[1], 1)
    return buf
  }

  // -------------------------------------------------------------------------
  private allow(name: string): boolean {
    const t = this.now(), w = MIX.voiceCap.window
    let a = this.starts.get(name)
    if (!a) { a = []; this.starts.set(name, a) }
    while (a.length && a[0] < t - w) a.shift()
    if (a.length >= MIX.voiceCap.max) return false
    a.push(t)
    return true
  }
}

// ---------------------------------------------------------------------------
// Synthesis. Pure functions of (sampleRate, length). Deterministic: the noise
// uses a seeded LCG, so the same build always renders the same bed and the
// offline mix report is reproducible.
// ---------------------------------------------------------------------------

type F32 = Float32Array<ArrayBuffer>

/** The bed is generated at this rate and resampled on playback; nothing in it lives above 6 kHz. */
const GEN_SR = 24000
/** Samples per generation slice. Keeps every main-thread block well inside one frame at boot. */
const CHUNK = 150000

/**
 * Hand the thread back for one task. MessageChannel, not setTimeout: nested timeouts are
 * clamped to 4 ms, which would stretch a 250 ms build across several seconds of boot.
 */
const nextTask: () => Promise<void> = typeof MessageChannel !== 'undefined'
  ? () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })
  : () => new Promise(r => setTimeout(r, 0))

/** Run `body` over [0,n) in slices, yielding the thread between them. */
function* chunked(n: number, body: (from: number, to: number) => void): Generator<void> {
  for (let c = 0; c < n; c += CHUNK) { body(c, Math.min(n, c + CHUNK)); yield }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1 }
}

/** Round f to a whole number of cycles per loop so the partial is phase-continuous at the seam. */
const snap = (f: number, loopSec: number): number => Math.max(1, Math.round(f * loopSec)) / loopSec

/** One-pole lowpassed noise that loops seamlessly: pass 1 warms the filter, pass 2 is kept. */
function loopNoise(n: number, sr: number, cutoff: number, seed: number, highpass = false): F32 {
  const rnd = lcg(seed)
  const raw: F32 = new Float32Array(n)
  for (let i = 0; i < n; i++) raw[i] = rnd()
  const out: F32 = new Float32Array(n)
  const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr)
  let y = 0
  for (let p = 0; p < 2; p++) for (let i = 0; i < n; i++) { y += a * (raw[i] - y); if (p === 1) out[i] = highpass ? raw[i] - y : y }
  return out
}

/**
 * Mono loop -> stereo. The right channel is the same loop read a few ms earlier, wrapped
 * around the loop point: still perfectly seamless, decorrelates the noise beds, and gives the
 * tonal partials a frequency-dependent phase offset instead of one flat rotation. Half the
 * synthesis work of rendering two channels.
 */
function stereo(M: F32, sr: number, ms: number, peak: number): [F32, F32] {
  const n = M.length
  let m = 0
  for (let i = 0; i < n; i++) { const a = Math.abs(M[i]); if (a > m) m = a }
  if (m > 0) { const k = peak / m; for (let i = 0; i < n; i++) M[i] *= k }
  const d = Math.round(sr * ms / 1000) % n
  const R: F32 = new Float32Array(n)
  for (let i = 0; i < n; i++) R[i] = M[(i - d + n) % n] * 0.86 + M[i] * 0.14
  return [M, R]
}

/** The Threshold breathes: a low drone, a slow breath of air, a far shimmer. */
function* renderAmbience(sr: number, seconds: number): Generator<void, [F32, F32]> {
  const n = Math.round(sr * seconds)
  const M: F32 = new Float32Array(n)
  const sn = (f: number) => snap(f, seconds)
  // partial: [hz, amp, LFO hz, LFO depth, phase]
  // The combat bed owns the sub (55 Hz). The drone sits an octave above it, so the two
  // never stack coherently in the low end when both are up.
  const partials: [number, number, number, number, number][] = [
    [82.41, 0.10, sn(2 / seconds), 0.35, 1.1],
    [110, 0.44, sn(1 / seconds), 0.30, 2.3],
    [164.81, 0.150, sn(3 / seconds), 0.45, 0.6],
    [220, 0.090, sn(2 / seconds), 0.5, 3.0],
    [329.63, 0.030, sn(4 / seconds), 0.6, 1.2],
    [880, 0.016, sn(3 / seconds), 0.7, 1.7],
    [1320, 0.010, sn(5 / seconds), 0.8, 2.6],
  ]
  for (const [hz, amp, lfo, depth, ph] of partials) {
    const f = sn(hz), w = 2 * Math.PI * f / sr, wl = 2 * Math.PI * lfo / sr
    yield* chunked(n, (from, to) => {
      for (let i = from; i < to; i++) M[i] += amp * (1 - depth + depth * 0.5 * (1 - Math.cos(wl * i + ph))) * Math.sin(w * i + ph)
    })
  }
  yield
  // air: one long breath per loop, zero at both ends, plus a constant filtered floor
  const air = loopNoise(n, sr, 700, 0x9e37, false); yield
  const floor = loopNoise(n, sr, 2200, 0x2545, true); yield
  yield* chunked(n, (from, to) => {
    for (let i = from; i < to; i++) {
      const u = i / n
      const breath = 0.5 * (1 - Math.cos(2 * Math.PI * u))          // 0 -> 1 -> 0
      const b2 = 0.5 * (1 - Math.cos(4 * Math.PI * u)) * 0.35
      const env = 2.2 * (breath * 0.75 + b2)
      M[i] += air[i] * env + floor[i] * 0.35
    }
  })
  return stereo(M, sr, 11, 0.8)
}

/** Combat layer A: a dark drone plus a slow heart on beats 1 and 3 of each bar. */
function* renderCombatBed(sr: number, seconds: number, spb: number): Generator<void, [F32, F32]> {
  const n = Math.round(sr * seconds)
  const M: F32 = new Float32Array(n)
  const sn = (f: number) => snap(f, seconds)
  const partials: [number, number, number, number][] = [
    [55, 0.42, 1 / seconds, 0.25],
    [65.41, 0.16, 2 / seconds, 0.4],     // minor third: the room tilts
    [82.41, 0.18, 1 / seconds, 0.3],
    [110, 0.09, 3 / seconds, 0.5],
    [130.81, 0.05, 2 / seconds, 0.6],
  ]
  for (const [hz, amp, lfoRaw, depth] of partials) {
    const w = 2 * Math.PI * sn(hz) / sr, wl = 2 * Math.PI * sn(lfoRaw) / sr
    yield* chunked(n, (from, to) => {
      for (let i = from; i < to; i++) M[i] += amp * (1 - depth + depth * 0.5 * (1 - Math.cos(wl * i))) * Math.sin(w * i)
    })
  }
  yield
  // heart: 92 -> 46 Hz glide, 160 ms decay, accented on the downbeat of each bar
  const beats = Math.round(seconds / spb)
  const rnd = lcg(0x7a11)
  for (let b = 0; b < beats; b += 2) {
    const amp = (b % 4 === 0) ? 0.62 : 0.34
    const t0 = Math.round(b * spb * sr)
    const len = Math.min(n - t0, Math.round(sr * 0.5))
    let phase = 0
    for (let i = 0; i < len; i++) {
      const t = i / sr
      const f = 46 + 46 * Math.exp(-t / 0.045)
      phase += 2 * Math.PI * f / sr
      const e = Math.exp(-t / 0.16) * amp
      M[t0 + i] += Math.sin(phase) * e + (i < sr * 0.006 ? rnd() * 0.18 * amp * (1 - i / (sr * 0.006)) : 0)
    }
  }
  yield
  // breath in before each bar line (ends exactly on the beat, so the seam is silent)
  const air = loopNoise(n, sr, 900, 0x3311, false); yield
  const bar = spb * MIX.bed.beatsPerBar
  for (let barIdx = 1; barIdx <= Math.round(seconds / bar); barIdx++) {
    const end = Math.round(barIdx * bar * sr), dur = Math.round(sr * 0.34)
    for (let i = 0; i < dur; i++) {
      const idx = end - dur + i
      if (idx < 0 || idx >= n) continue
      const u = i / dur
      M[idx] += air[idx] * Math.sin(Math.PI * u) ** 2 * 0.9 * u
    }
  }
  return stereo(M, sr, 7, 0.8)
}

/** Combat layer B: eighth-note churn, a tense fifth above, one bowl strike per two bars. */
function* renderCombatDrive(sr: number, seconds: number, spb: number): Generator<void, [F32, F32]> {
  const n = Math.round(sr * seconds)
  const M: F32 = new Float32Array(n)
  const sn = (f: number) => snap(f, seconds)
  const eighth = spb / 2
  // tense pad with tremolo locked to the eighth grid
  const pad: [number, number, number][] = [[164.81, 0.10, 0], [220, 0.075, 0.9], [246.94, 0.055, 1.8]]
  const wTrem = 2 * Math.PI * sn(1 / eighth) / sr
  for (const [hz, amp, ph] of pad) {
    const w = 2 * Math.PI * sn(hz) / sr
    yield* chunked(n, (from, to) => {
      for (let i = from; i < to; i++) M[i] += amp * (0.45 + 0.55 * (0.5 * (1 - Math.cos(wTrem * i)))) * Math.sin(w * i + ph)
    })
  }
  yield
  // eighth-note ticks: short high-passed noise, accent pattern
  const tick = loopNoise(n, sr, 1800, 0x5f2a, true)
  const nEighths = Math.round(seconds / eighth)
  const accent = [1, 0.34, 0.55, 0.34, 0.78, 0.34, 0.6, 0.42]
  for (let e = 0; e < nEighths; e++) {
    const amp = accent[e % accent.length] * 0.5
    const t0 = Math.round(e * eighth * sr), len = Math.round(sr * 0.07)
    for (let i = 0; i < len && t0 + i < n; i++) {
      const t = i / sr
      M[t0 + i] += tick[t0 + i] * Math.min(1, t / 0.004) * Math.exp(-t / 0.022) * amp
    }
  }
  // one struck bowl on bar 2, tail (1.1 s) lands well before the seam
  const bar = spb * MIX.bed.beatsPerBar
  if (seconds > bar * 1.5) {
    const t0 = Math.round(bar * sr)
    const parts: [number, number, number][] = [[523.25, 0.16, 1.1], [523.25 * 2.76, 0.08, 0.5], [523.25 * 5.40, 0.035, 0.28]]
    for (const [hz, amp, tau] of parts) {
      const w = 2 * Math.PI * hz / sr
      for (let i = 0; t0 + i < n; i++) {
        const e = amp * Math.exp(-(i / sr) / tau)
        if (e < 1e-5) break
        M[t0 + i] += e * Math.sin(w * i)
      }
    }
  }
  yield
  // rising hiss into the loop point: ends at exactly zero
  const rise0 = loopNoise(n, sr, 4000, 0xa73c, true); yield
  const rise = Math.round(sr * spb)
  for (let i = 0; i < rise; i++) {
    const idx = n - rise + i, u = i / rise
    M[idx] += rise0[idx] * (u ** 2.5) * 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.02)) ** 0.5
  }
  return stereo(M, sr, 5, 0.8)
}
