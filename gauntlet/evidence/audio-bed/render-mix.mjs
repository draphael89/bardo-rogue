// Offline audio evidence for the audio-bed piece. Nothing here is a re-implementation:
// it imports src/audio/audio.ts and src/audio/sfxMap.ts through the Vite dev server and renders
// them in a real Chromium OfflineAudioContext, so the numbers describe the shipped code.
//
// usage: node gauntlet/evidence/audio-bed/render-mix.mjs --out gauntlet/evidence/audio-bed/w2r1
//        (the dev server must be up on :5173 — it serves both /src and /assets/audio)
//
// writes: mix.wav, mix-hurt.wav, levels.json, duck-curves.json, event-map.json, event-timeline.json
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const out = args.out ?? 'gauntlet/evidence/audio-bed/w2r1'
const url = args.url ?? 'http://localhost:5173'
const SR = 48000, SECONDS = 10
mkdirSync(out, { recursive: true })

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'))
const replays = {
  wave1: JSON.parse(readFileSync('replays/naive-wave1-s3.json', 'utf8')),
  full: JSON.parse(readFileSync('replays/kite-full-s2.json', 'utf8')),
}

const browser = await chromium.launch()
const page = await browser.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))
// A blank same-origin page, NOT the game: booting the game shares the src/sim module instances
// with this script, and the ticks it runs before we can pause it changed the replay's event
// count between runs. /src and /assets still come from the dev server, so the code under test
// is the real thing.
await page.route('**/audio-evidence-probe.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>audio evidence probe</title>' }))
await page.goto(`${url}/audio-evidence-probe.html`)

// ---------------------------------------------------------------------------
// 1. event timelines, straight out of the pure sim
// ---------------------------------------------------------------------------
const timelines = await page.evaluate(async (replays) => {
  const { createWorld } = await import('/src/sim/scenarios.ts')
  const { stepWorld } = await import('/src/sim/step.ts')
  const { decodeReplay, isEncodedReplay } = await import('/src/sim/replay.ts')
  const run = (raw) => {
    const rep = isEncodedReplay(raw) ? decodeReplay(raw) : raw
    const w = createWorld(rep.seed, rep.scenario, { god: rep.god })
    const rows = []
    for (const f of rep.frames) {
      stepWorld(w, f)
      for (const ev of w.events) rows.push({ tick: w.tick, t: +(w.tick / 60).toFixed(4), ev: { ...ev } })
      w.events.length = 0
      if (w.wantsRestart) break
    }
    return { seed: rep.seed, scenario: rep.scenario, ticks: w.tick, rows }
  }
  return { wave1: run(replays.wave1), full: run(replays.full) }
}, replays)

const hist = rows => rows.reduce((h, r) => (h[r.ev.type] = (h[r.ev.type] ?? 0) + 1, h), {})
// wave-1 fight from its first tick; worst case = the 10 s from the wave-3 bell in the full run
const w1 = timelines.wave1.rows.filter(r => r.t < SECONDS)
const T0 = 20
const worst = timelines.full.rows.filter(r => r.t >= T0 && r.t < T0 + SECONDS).map(r => ({ ...r, t: +(r.t - T0).toFixed(4) }))

// ---------------------------------------------------------------------------
// 2. the renders
// ---------------------------------------------------------------------------
const renderOne = (events, label) => page.evaluate(async ({ events, files, sr, seconds, label }) => {
  const { AudioSystem, MIX, dbToGain } = await import('/src/audio/audio.ts')
  const { playEventSfx, resetSfxState } = await import('/src/audio/sfxMap.ts')
  const BUSES = ['music', 'ambience', 'sfx', 'ui']
  const NCH = 2 + BUSES.length * 2
  const ctx = new OfflineAudioContext({ numberOfChannels: NCH, length: Math.round(sr * seconds), sampleRate: sr })
  const a = new AudioSystem()
  await a.load(files, '/assets/audio/', ctx)
  // parallel taps: one render, every bus measured in it. Master is measured post limiter+trim.
  a.outTrim.disconnect()
  const merge = ctx.createChannelMerger(NCH)
  const tap = (node, base) => {
    const g = ctx.createGain()
    g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'
    const s = ctx.createChannelSplitter(2)
    node.connect(g); g.connect(s); s.connect(merge, 0, base); s.connect(merge, 1, base + 1)
  }
  tap(a.outTrim, 0)
  BUSES.forEach((b, i) => tap(a.busOut(b), 2 + i * 2))
  merge.connect(ctx.destination)

  // the announcer must not even be resident
  const announcerLoaded = ['round_1', 'round_2', 'round_3', 'fight', 'final_round', 'flawless_victory', 'you_lose', 'gameover1']
    .filter(n => a.play(n, { gain: 0 }) !== null)

  resetSfxState()
  a.setCombat(0, 1)                       // start the bed out of combat, as a fresh room does
  for (const e of events) { a.timeOffset = e.t; playEventSfx(a, e.ev) }
  a.timeOffset = 0

  // loop-seam audit on the generated bed buffers, before rendering consumes them
  const seam = {}
  for (const [k, v] of Object.entries(a.layers)) {
    if (!v?.src?.buffer) continue
    const buf = v.src.buffer
    const per = []
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c), n = d.length
      const diffs = new Float32Array(n - 1)
      for (let i = 0; i < n - 1; i++) diffs[i] = Math.abs(d[i + 1] - d[i])
      const sorted = Float32Array.from(diffs).sort()
      per.push({
        wrapStepAbs: +Math.abs(d[0] - d[n - 1]).toFixed(6),
        interiorMaxStepAbs: +sorted[sorted.length - 1].toFixed(6),
        interiorP9999StepAbs: +sorted[Math.floor((n - 2) * 0.9999)].toFixed(6),
        endValue: +d[n - 1].toFixed(6), startValue: +d[0].toFixed(6),
      })
    }
    const bars = k === 'ambience' ? MIX.bed.ambienceBars : MIX.bed.combatBars
    const wantSec = bars * MIX.bed.beatsPerBar * 60 / MIX.bed.bpm
    seam[k] = {
      seconds: +buf.duration.toFixed(6), musicalSeconds: +wantSec.toFixed(6),
      driftMs: +((buf.duration - wantSec) * 1000).toFixed(4), bars, channels: per,
    }
  }

  const buf = await ctx.startRendering()
  const meas = (base) => {
    const L = buf.getChannelData(base), R = buf.getChannelData(base + 1)
    let peak = 0, sum = 0, clipped = 0, near = 0
    for (let i = 0; i < L.length; i++) {
      for (const v of [L[i], R[i]]) {
        const x = Math.abs(v)
        if (x > peak) peak = x
        if (x > 1) clipped++
        else if (x >= 0.999) near++
        sum += v * v
      }
    }
    const rms = Math.sqrt(sum / (L.length * 2))
    const db = v => v > 0 ? +(20 * Math.log10(v)).toFixed(2) : -999
    return { peak: +peak.toFixed(5), peakDb: db(peak), rms: +rms.toFixed(5), rmsDb: db(rms), clippedSamples: clipped, samplesAtOrAbove0999: near }
  }
  // Short-window loudness, so a sparse stream of impacts can be compared with a continuous bed:
  // 50 ms RMS windows, then percentiles. p50 of Music is the bed's steady level; p99 of SFX is
  // what a hit actually reaches. The gap between them is the masking answer.
  const loud = (base) => {
    const L = buf.getChannelData(base), R = buf.getChannelData(base + 1)
    const w = Math.round(sr * 0.05), out = []
    for (let i = 0; i + w <= L.length; i += w) {
      let sum = 0
      for (let j = i; j < i + w; j++) sum += L[j] * L[j] + R[j] * R[j]
      out.push(Math.sqrt(sum / (w * 2)))
    }
    out.sort((x, y) => x - y)
    const db = v => v > 0 ? +(20 * Math.log10(v)).toFixed(2) : -99
    const q = p => db(out[Math.min(out.length - 1, Math.floor(out.length * p))])
    return { windowMs: 50, p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: db(out[out.length - 1]) }
  }
  const levels = { masterOut: meas(0) }
  BUSES.forEach((b, i) => { levels[b] = meas(2 + i * 2) })
  const loudness = { masterOut: loud(0) }
  BUSES.forEach((b, i) => { loudness[b] = loud(2 + i * 2) })

  // envelope for the waveform image: min/max per column, master + every bus
  const COLS = 1600
  const env = {}
  const lanes = [['masterOut', 0], ...BUSES.map((b, i) => [b, 2 + i * 2])]
  for (const [name, base] of lanes) {
    const L = buf.getChannelData(base), R = buf.getChannelData(base + 1)
    const step = L.length / COLS, mn = [], mx = []
    for (let c = 0; c < COLS; c++) {
      let lo = 0, hi = 0
      for (let i = Math.floor(c * step); i < Math.floor((c + 1) * step); i++) {
        const v = (L[i] + R[i]) / 2
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      mn.push(+lo.toFixed(4)); mx.push(+hi.toFixed(4))
    }
    env[name] = { min: mn, max: mx }
  }

  // master as 16-bit stereo PCM, base64
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  const pcm = new Int16Array(L.length * 2)
  for (let i = 0; i < L.length; i++) {
    pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)))
    pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)))
  }
  const bytes = new Uint8Array(pcm.buffer)
  let b64 = '', CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) b64 += String.fromCharCode(...bytes.subarray(i, i + CH))
  return { label, levels, loudness, env, seam, announcerLoaded, pcm: btoa(b64), sr, frames: L.length, graph: a.graph(), busDb: MIX.busDb }
}, { events, files: manifest.audio, sr: SR, seconds: SECONDS, label })

const wav = (b64, sr) => {
  const data = Buffer.from(b64, 'base64')
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const A = await renderOne(w1, 'wave1')
const B = await renderOne(worst, 'worst-case')
writeFileSync(`${out}/mix.wav`, wav(A.pcm, A.sr))
writeFileSync(`${out}/mix-hurt.wav`, wav(B.pcm, B.sr))

// ---------------------------------------------------------------------------
// 3. duck arbitration, measured: a constant 1.0 through the Music bus, read back
// ---------------------------------------------------------------------------
const duck = await page.evaluate(async ({ sr }) => {
  const { AudioSystem, MIX, dbToGain } = await import('/src/audio/audio.ts')
  // Read straight out of MIX.duck.by, so the measured curves are the ones the game schedules —
  // including the 80 ms delay on the player-hurt duck.
  const by = (name, t) => { const [depthDb, release, delay] = MIX.duck.by[name]; return { t, name, depthDb, release, delay } }
  const scripts = {
    'playerHurt alone': [by('playerHurt', 0.5)],
    'waveStart alone': [by('waveStart', 0.5)],
    'waveStart then playerHurt +50 ms': [by('waveStart', 0.5), by('playerHurt', 0.55)],
    'playerHurt then waveStart +50 ms': [by('playerHurt', 0.5), by('waveStart', 0.55)],
    'four hits, 120 ms apart': [0, 0.12, 0.24, 0.36].map(d => by('playerHurt', 0.5 + d)),
  }
  const res = {}
  for (const [name, script] of Object.entries(scripts)) {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: sr * 3, sampleRate: sr })
    const a = new AudioSystem()
    await a.load([], '/assets/audio/', ctx)      // no files, no bed voices: this is a gain probe
    a.outTrim.disconnect()
    a.busOut('music').connect(ctx.destination)
    // the probe stands in for the bed: it enters at the duck stage, exactly where the loops do
    const cs = ctx.createConstantSource(); cs.offset.value = 1; cs.connect(a.duckStage.music ?? a.bus.music); cs.start(0)
    for (const s of script) { a.timeOffset = s.t; a.duck(s.depthDb, s.release, s.delay) }
    a.timeOffset = 0
    const d = (await ctx.startRendering()).getChannelData(0)
    const busGain = dbToGain(MIX.busDb.music)
    const at = t => { const v = d[Math.round(t * sr)] / busGain; return { t: +t.toFixed(3), gainMul: +v.toFixed(4), db: +(20 * Math.log10(Math.max(1e-6, v))).toFixed(2) } }
    let min = 1, minAt = 0
    for (let i = 0; i < d.length; i++) { const v = d[i] / busGain; if (v < min) { min = v; minAt = i / sr } }
    res[name] = {
      script, deepest: { gainMul: +min.toFixed(4), db: +(20 * Math.log10(min)).toFixed(2), at: +minAt.toFixed(3) },
      curve: [0.4, 0.5, 0.504, 0.508, 0.512, 0.52, 0.54, 0.55, 0.56, 0.57, 0.6, 0.65, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 1.8, 2.2].map(at),
      dense: Array.from({ length: 191 }, (_, i) => at(0.4 + i * 0.01)),
    }
  }
  return res
}, { sr: SR })

// ---------------------------------------------------------------------------
// 4. the event -> sound map, observed by recording every call the real map makes
// ---------------------------------------------------------------------------
const map = await page.evaluate(async () => {
  const { AudioSystem } = await import('/src/audio/audio.ts')
  const { playEventSfx, resetSfxState } = await import('/src/audio/sfxMap.ts')
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 4800, sampleRate: 48000 })
  const a = new AudioSystem()
  await a.load([], '/assets/audio/', ctx)
  const calls = []
  a.play = (name, o = {}) => { calls.push({ call: 'play', name, gain: o.gain ?? 1, pitch: o.pitch ?? 1, pitchVar: o.pitchVar ?? 0.08, bus: o.bus ?? 'sfx', placed: o.x !== undefined, delay: o.delay ?? 0 }); return null }
  a.swish = (gain, ms, pitch) => calls.push({ call: 'swish', name: 'synth noise sweep', gain, ms, pitch, bus: 'sfx' })
  a.bell = (gain, hz, decay, bus = 'music', delay = 0) => calls.push({ call: 'bell', name: 'synth struck bowl', gain, hz, decay, bus, delay })
  a.thump = (gain, fromHz, toHz, decay) => calls.push({ call: 'thump', name: 'synth low thump', gain, hz: fromHz, toHz, decay, bus: 'sfx' })
  a.duck = (depthDb, release, delay = 0) => calls.push({ call: 'duck', depthDb, release, duckDelay: delay, bus: 'music+ambience' })
  const P = { x: 240, y: 135 }, E = { x: 320, y: 150 }
  const cases = [
    ['swing (light)', { type: 'swing', ...P, angle: 0, swing: 0, heavy: false }],
    ['swing (heavy)', { type: 'swing', ...P, angle: 0, swing: 2, heavy: true }],
    ['hit brute', { type: 'hit', ...E, angle: 0, damage: 2, heavy: false, targetId: 1, kind: 'brute', killed: false }],
    ['hit charger', { type: 'hit', ...E, angle: 0, damage: 2, heavy: false, targetId: 1, kind: 'charger', killed: false }],
    ['hit caster', { type: 'hit', ...E, angle: 0, damage: 2, heavy: true, targetId: 1, kind: 'caster', killed: false }],
    ['hit (killing)', { type: 'hit', ...E, angle: 0, damage: 4, heavy: true, targetId: 1, kind: 'brute', killed: true }],
    ['kill', { type: 'kill', ...E, angle: 0, kind: 'brute', id: 1 }],
    ['playerHurt', { type: 'playerHurt', ...P, angle: 0, hp: 3 }],
    ['playerDeath', { type: 'playerDeath', ...P }],
    ['dodge', { type: 'dodge', ...P, angle: 0 }],
    ['dodged', { type: 'dodged', ...P }],
    ['dodgeEnd', { type: 'dodgeEnd', ...P }],
    ['footstep', { type: 'footstep', ...P }],
    ['boltFired', { type: 'boltFired', ...E, angle: 0 }],
    ['boltCut', { type: 'boltCut', ...E }],
    ['boltHitWall', { type: 'boltHitWall', ...E }],
    ['enemyWindup brute', { type: 'enemyWindup', id: 1, kind: 'brute', ...E }],
    ['enemyWindup caster', { type: 'enemyWindup', id: 1, kind: 'caster', ...E }],
    ['enemyWindup charger', { type: 'enemyWindup', id: 1, kind: 'charger', ...E }],
    ['enemyAttack brute', { type: 'enemyAttack', id: 1, kind: 'brute', ...E, angle: 0 }],
    ['enemyAttack charger', { type: 'enemyAttack', id: 1, kind: 'charger', ...E, angle: 0 }],
    ['enemyAttack caster', { type: 'enemyAttack', id: 1, kind: 'caster', ...E, angle: 0 }],
    ['enemyStagger', { type: 'enemyStagger', id: 1, ...E }],
    ['spawnTelegraph', { type: 'spawnTelegraph', ...E, kind: 'brute' }],
    ['spawn', { type: 'spawn', id: 1, kind: 'brute', ...E }],
    ['waveStart', { type: 'waveStart', wave: 1, total: 3 }],
    ['waveClear', { type: 'waveClear', wave: 1 }],
    ['roomClear', { type: 'roomClear', hasNext: true }],
    ['roomEnter', { type: 'roomEnter', name: 'THE THRESHOLD', index: 0, total: 3 }],
    ['restart', { type: 'restart' }],
    ['poolOverflow', { type: 'poolOverflow', pool: 'enemy', kind: 'brute', ...E }],
  ]
  const rows = []
  for (const [label, ev] of cases) {
    resetSfxState(); calls.length = 0
    playEventSfx(a, ev)
    rows.push({ event: label, type: ev.type, calls: [...calls] })
  }
  return rows
})

// ---------------------------------------------------------------------------
writeFileSync(`${out}/event-timeline.json`, JSON.stringify({
  note: 'Pure-sim event streams. mix.wav is fed the wave1 rows below; mix-hurt.wav the worst-case rows (the 10 s from the wave-3 bell of the full run, times rebased to 0).',
  wave1: { replay: 'replays/naive-wave1-s3.json', ticks: timelines.wave1.ticks, count: w1.length, hist: hist(w1), rows: w1 },
  worstCase: { replay: 'replays/kite-full-s2.json', window: [T0, T0 + SECONDS], count: worst.length, hist: hist(worst), rows: worst },
}, null, 1))
writeFileSync(`${out}/event-map.json`, JSON.stringify({
  note: 'Observed, not transcribed: every call src/audio/sfxMap.ts makes for one synthetic event of each type and variant, recorded through the real AudioSystem.',
  rows: map,
}, null, 1))
writeFileSync(`${out}/duck-curves.json`, JSON.stringify({
  note: 'Measured, not computed: a constant 1.0 into the Music bus, read back off the duck stage and divided by the bus gain. gainMul 1.0 = no duck.',
  scenarios: duck,
}, null, 1))
writeFileSync(`${out}/levels.json`, JSON.stringify({
  worktree: {
    note: 'The gauntlet worktree is shared and other lanes edit src/sim and src/tuning.ts while this runs, so the replay event stream can shift between captures. Recorded here so a later capture can be compared honestly.',
    head: execSync('git rev-parse --short HEAD').toString().trim(),
    dirty: execSync('git status --porcelain src/sim src/tuning.ts src/audio').toString().trim().split('\n').filter(Boolean),
    capturedAt: new Date().toISOString(),
  },
  render: {
    source: 'Chromium OfflineAudioContext, importing src/audio/audio.ts + src/audio/sfxMap.ts unmodified through the Vite dev server',
    script: 'gauntlet/evidence/audio-bed/render-mix.mjs',
    sampleRate: SR, seconds: SECONDS, files: manifest.audio.length,
    note: 'Per-bus rows are parallel taps taken in the SAME render as masterOut: post bus fader and post duck stage, pre master/limiter. masterOut is post limiter + out trim — the speaker signal, and what mix.wav contains. play() uses Math.random for pitch and variant choice, so figures move a few tenths of a dB between renders.',
  },
  mixes: {
    'mix.wav': { fed: w1.length, hist: hist(w1), levels: A.levels, loudness: A.loudness },
    'mix-hurt.wav': { fed: worst.length, hist: hist(worst), levels: B.levels, loudness: B.loudness },
  },
  gates: {
    clipping: {
      rule: 'any |sample| > 1.0 on masterOut is a loss',
      'mix.wav': A.levels.masterOut.clippedSamples, 'mix-hurt.wav': B.levels.masterOut.clippedSamples,
      pass: A.levels.masterOut.clippedSamples === 0 && B.levels.masterOut.clippedSamples === 0,
    },
    headroom: {
      rule: 'masterOut peak must stay at or under -1.0 dBFS. The limiter + trim imply a -3.8 dB ceiling for anything sustained, but its 3 ms attack deliberately lets the first transient of a bowl strike or a heavy impact through — a hard clamp would dull the strike — so the peak sits above -3.8 and well under 0.',
      'mix.wav': A.levels.masterOut.peakDb, 'mix-hurt.wav': B.levels.masterOut.peakDb,
      pass: A.levels.masterOut.peakDb <= -1 && B.levels.masterOut.peakDb <= -1,
    },
    loopSeam: { rule: 'the wrap-point step must not exceed the loop\'s own interior steps, or the loop clicks once a bar', wave1: A.seam, worstCase: B.seam },
    announcer: { rule: 'the fighting-game announcer must not be playable OR resident', loadedAndPlayable: A.announcerLoaded, pass: A.announcerLoaded.length === 0 },
    masking: {
      rule: 'a hit must clear the bed: SFX p99 (50 ms RMS) at least 6 dB over Music p50, or the bed is covering the fight',
      'mix.wav': { sfxP99: A.loudness.sfx.p99, musicP50: A.loudness.music.p50, gapDb: +(A.loudness.sfx.p99 - A.loudness.music.p50).toFixed(2) },
      'mix-hurt.wav': { sfxP99: B.loudness.sfx.p99, musicP50: B.loudness.music.p50, gapDb: +(B.loudness.sfx.p99 - B.loudness.music.p50).toFixed(2) },
    },
    duckArbitration: {
      rule: 'a deeper duck must win over a shallower one already in flight',
      deepestReached: Object.fromEntries(Object.entries(duck).map(([k, v]) => [k, v.deepest.db])),
    },
  },
  graph: A.graph,
  pageErrors: logs,
}, null, 1))
writeFileSync(`${out}/envelopes.json`, JSON.stringify({ note: 'min/max per column of the mono sum, 1600 columns over 10 s. Plot data for waveform*.png only.', cols: 1600, seconds: SECONDS, mixes: { 'mix.wav': A.env, 'mix-hurt.wav': B.env } }))
console.log(JSON.stringify({
  out, wave1Events: w1.length, worstEvents: worst.length,
  master: { 'mix.wav': A.levels.masterOut, 'mix-hurt.wav': B.levels.masterOut },
  announcerLoaded: A.announcerLoaded, pageErrors: logs,
}, null, 2))
await browser.close()
