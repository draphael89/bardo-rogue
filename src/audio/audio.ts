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
}

/** A started sound. Buffer sources free themselves on end; only hold a Voice for loops. */
export interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
  level: number      // linear gain this voice sits at when fully faded in
  stop(fade?: number): void
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** 0..1 slider -> linear gain on a dB curve. Store the slider, never the gain. */
export function sliderToGain(slider01: number, floorDb = -60): number {
  if (slider01 <= 0) return 0
  if (slider01 >= 1) return 1
  return dbToGain(floorDb * (1 - slider01))
}

// ---------------------------------------------------------------------------
// The mix. Every level and time constant lives here so the whole graph can be
// read (and printed) as one table. Gameplay numbers live in src/tuning.ts;
// these are mix numbers and belong with the graph they describe.
// ---------------------------------------------------------------------------
export const MIX = {
  masterDb: -1,
  busDb: { music: -7, ambience: -13, sfx: -8.5, ui: -9 } as Record<BusName, number>,
  // Safety net on Master, not a mixing tool. It should be nearly idle in a normal fight.
  // Chrome's DynamicsCompressor adds its own make-up gain, so a fixed trim after it owns the ceiling.
  limiter: { thresholdDb: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.10 },
  outTrimDb: -0.8,
  // Ducks Music + Ambience only. The SFX that triggered the duck keeps its level.
  duck: { depthDb: -11, attack: 0.012, release: 0.42 },
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

export class AudioSystem {
  ctx: BaseAudioContext | null = null
  master: GainNode | null = null
  limiter: DynamicsCompressorNode | null = null
  outTrim: GainNode | null = null
  bus: Record<BusName, GainNode> | null = null
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

  private masterLevel(): number { return dbToGain(MIX.masterDb) * this.slider.master }
  private now(): number { return (this.ctx?.currentTime ?? 0) + this.timeOffset }

  /**
   * Decode every file and build the graph. `ctx` is only passed by the offline mix renderer;
   * the game leaves it out and gets a real AudioContext plus the gesture unlock.
   */
  async load(files: string[], base = '/assets/audio/', ctx?: BaseAudioContext): Promise<void> {
    if (!ctx && typeof AudioContext === 'undefined') return
    this.ctx = ctx ?? new AudioContext()
    this.buildGraph()
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
      const unlock = () => { c.resume(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
      window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock)
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
    const mk = (b: BusName) => {
      const g = ctx.createGain()
      this.busLevel[b] = dbToGain(MIX.busDb[b])
      g.gain.value = this.busLevel[b]
      g.connect(this.master!)
      return g
    }
    this.bus = { music: mk('music'), ambience: mk('ambience'), sfx: mk('sfx'), ui: mk('ui') }
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

  /** The whole graph as numbers, for the mix report. */
  graph(): unknown {
    return {
      master: { db: MIX.masterDb, gain: +this.masterLevel().toFixed(4) },
      limiter: { ...MIX.limiter, outTrimDb: MIX.outTrimDb, outTrimGain: +dbToGain(MIX.outTrimDb).toFixed(4) },
      buses: (Object.keys(MIX.busDb) as BusName[]).map(b => ({ bus: b, db: MIX.busDb[b], gain: +dbToGain(MIX.busDb[b]).toFixed(4) })),
      duck: { ...MIX.duck, targetGainMultiplier: +dbToGain(MIX.duck.depthDb).toFixed(4), applies: ['music', 'ambience'] },
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
    const level = (o.gain ?? 1) * (pos ? pos.gain : 1)
    const g = ctx.createGain()
    const t = this.now() + (o.delay ?? 0)
    const silent = !!o.startSilent || !!(o.fadeIn && o.fadeIn > 0)
    g.gain.setValueAtTime(silent ? 0.0001 : level, t)
    if (o.fadeIn && o.fadeIn > 0 && !o.startSilent) g.gain.setTargetAtTime(level, t, o.fadeIn / 3)
    src.connect(g); this.route(g, pos, o.bus ?? 'sfx')
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
  private route(g: GainNode, pos: { pan: number; itd: number } | null, bus: BusName): void {
    const target = this.bus![bus]
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
  swish(gain = 0.35, ms = 120, pitch = 1, at?: { x: number; y: number }): void {
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
    src.connect(f); f.connect(g); this.route(g, pos, 'sfx'); src.start(t0)
  }

  /**
   * Struck bowl: inharmonic partials with staggered decays. This is the game's punctuation
   * (wave start, room clear) and it replaces the fighting-game announcer. Music bus, so the
   * music slider owns it.
   */
  bell(gain = 0.5, hz = 523.25, decay = 1.6, bus: BusName = 'music', delay = 0): void {
    if (this._muted || !this.ctx || !this.bus) return
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const n = Math.floor(sr * (decay + 0.05))
    const buf = ctx.createBuffer(1, n, sr)
    const d = buf.getChannelData(0)
    const partials: [number, number, number][] = [[1, 0.5, 1], [2.76, 0.28, 0.55], [5.40, 0.14, 0.3], [8.93, 0.08, 0.17]]
    for (const [ratio, amp, dk] of partials) {
      const w = 2 * Math.PI * hz * ratio / sr
      const tau = decay * dk
      for (let i = 0; i < n; i++) d[i] += amp * Math.sin(w * i) * Math.exp(-(i / sr) / tau)
    }
    // strike noise, 8 ms
    const nAtk = Math.floor(sr * 0.008)
    for (let i = 0; i < nAtk; i++) d[i] += (Math.random() * 2 - 1) * 0.25 * (1 - i / nAtk)
    let peak = 0
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]))
    if (peak > 0) for (let i = 0; i < n; i++) d[i] = d[i] / peak * 0.9
    this.start(buf, { gain, bus, delay })
  }

  // -------------------------------------------------------------------------
  // Ducking: Music + Ambience only, absolute targets, never restacked.
  // -------------------------------------------------------------------------
  duck(depthDb: number = MIX.duck.depthDb, release: number = MIX.duck.release): void {
    if (!this.ctx || !this.bus) return
    const t = this.now()
    const end = t + MIX.duck.attack + release
    if (end <= this.duckUntil) return   // a longer duck is already in flight; do not stack
    this.duckUntil = end
    const depth = dbToGain(depthDb)
    for (const b of ['music', 'ambience'] as const) {
      const g = this.bus[b].gain, level = this.busLevel[b]
      g.cancelScheduledValues(t)
      g.setTargetAtTime(level * depth, t, MIX.duck.attack / 3)
      g.setTargetAtTime(level, t + MIX.duck.attack + 0.06, release / 3)
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
    this.bedVoices.ambience = this.start(this.bedBuffers.ambience, { gain: dbToGain(B.ambienceDb), bus: 'ambience', loop: true, fadeIn: 2, delay: at })
    // both combat layers share one start time, so they stay sample-aligned forever
    this.bedVoices.bed = this.start(this.bedBuffers.bed, { gain: dbToGain(B.bedDb), bus: 'music', loop: true, delay: at, startSilent: true })
    this.bedVoices.drive = this.start(this.bedBuffers.drive, { gain: dbToGain(B.driveDb), bus: 'music', loop: true, delay: at, startSilent: true })
    this.combatOn = false; this.driveOn = false; this.driveApplied = false
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
