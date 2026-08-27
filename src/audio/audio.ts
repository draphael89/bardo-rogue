// Tiny Web Audio layer: decode everything at boot, play with pitch variation, round-robin variants, a duckable bus.
export interface PlayOpts { gain?: number; pitch?: number; pitchVar?: number; delay?: number }

export class AudioSystem {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private groups = new Map<string, string[]>()
  private lastPick = new Map<string, number>()
  muted = false
  private duckUntil = 0

  async load(files: string[], base = '/assets/audio/'): Promise<void> {
    if (typeof AudioContext === 'undefined') return
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination)
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
    const unlock = () => { this.ctx?.resume(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock)
  }

  // name may be an exact file stem ("woosh3") or a group ("woosh") for round-robin
  play(name: string, o: PlayOpts = {}): void {
    if (this.muted || !this.ctx || !this.master) return
    let key = name
    const group = this.groups.get(name)
    if (group && group.length > 1) {
      const last = this.lastPick.get(name) ?? -1
      let i = Math.floor(Math.random() * group.length)
      if (i === last) i = (i + 1) % group.length
      this.lastPick.set(name, i); key = group[i]
    } else if (group) key = group[0]
    const buf = this.buffers.get(key)
    if (!buf) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const pv = o.pitchVar ?? 0.08
    src.playbackRate.value = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * pv)
    const g = this.ctx.createGain(); g.gain.value = o.gain ?? 1
    src.connect(g); g.connect(this.master)
    src.start(this.ctx.currentTime + (o.delay ?? 0))
  }

  // short synthesized noise sweep layered under the sword whoosh
  swish(gain = 0.35, ms = 120, pitch = 1): void {
    if (this.muted || !this.ctx || !this.master) return
    const ctx = this.ctx
    const n = Math.floor(ctx.sampleRate * ms / 1000)
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.sin(t * Math.PI) }
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9
    f.frequency.setValueAtTime(600 * pitch, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(2600 * pitch, ctx.currentTime + ms / 1000)
    const g = ctx.createGain(); g.gain.value = gain
    src.connect(f); f.connect(g); g.connect(this.master); src.start()
  }

  duck(seconds = 0.35, to = 0.35): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setValueAtTime(to, t)
    this.master.gain.linearRampToValueAtTime(1, t + seconds)
    this.duckUntil = t + seconds
  }
}
