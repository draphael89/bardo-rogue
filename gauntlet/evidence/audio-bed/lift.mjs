// Ranks every event in the mix by loudness, the way the wave-2 critic ranked it: the best 30 ms
// RMS in the 80 ms after an event's tick, against the 140 ms of bed before it. Broadband and in
// six bands, because a 30 ms mid-band cue cannot move a broadband RMS that the bed's sub owns.
//
// Two tables, because they answer different questions:
//   solo-levels.json  each event rendered ALONE over the bed. This is the sound design: what the
//                     event map is worth, with no accident of what happened 100 ms earlier.
//   event-lift.json   the same measurement inside mix.wav and mix-hurt.wav. In a dense fight an
//                     event is measured against its neighbours, not against the bed, so this
//                     table compresses. Read the order, not the absolute dB.
//
// usage: node gauntlet/evidence/audio-bed/lift.mjs --out gauntlet/evidence/audio-bed/w2r4
//        (run render-mix.mjs into the same directory first; the dev server must be up on :5173)
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const dir = args.out ?? 'gauntlet/evidence/audio-bed/w2r4'
const url = args.url ?? 'http://localhost:5173'
const SR = 48000
const BANDS = [[80, 200], [200, 600], [600, 1200], [1200, 2400], [2400, 4800], [4800, 12000]]
const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'))
const db = v => v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -99

// RBJ bandpass, constant 0 dB peak gain, forward only.
function bandpass(x, lo, hi, sr) {
  const f0 = Math.sqrt(lo * hi), Q = f0 / (hi - lo)
  const w0 = 2 * Math.PI * f0 / sr, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0)
  const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v }
  return y
}
const rmsOf = (x, from, to) => {
  from = Math.max(0, from); to = Math.min(x.length, to)
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}
/** best 30 ms in the 80 ms after `t`, against the 140 ms before it */
function lane(x, t, sr) {
  const i = Math.round(t * sr), w = Math.round(0.03 * sr)
  let best = 0
  for (let s = i; s + w <= i + Math.round(0.08 * sr); s += Math.round(0.005 * sr)) best = Math.max(best, rmsOf(x, s, s + w))
  const bed = rmsOf(x, i - Math.round(0.14 * sr), i)
  return { best: db(best), bed: db(bed), lift: +(db(best) - db(bed)).toFixed(1) }
}
function rank(rows) {
  for (const r of rows) {
    const names = Object.keys(r.bands)
    r.bestBand = names.reduce((a, b) => r.bands[b].lift > r.bands[a].lift ? b : a)
    r.bestLiftDb = r.bands[r.bestBand].lift
  }
  rows.sort((a, b) => b.bestLiftDb - a.bestLiftDb)
  return rows
}
const table = rows => rows.map(r => `${r.event.padEnd(21)} ${String(r.broadLiftDb).padStart(6)} ${String(r.bestLiftDb).padStart(9)}  ${r.bestBand.padStart(11)}`)

// ---------------------------------------------------------------------------
// 1. in-mix: the rendered wavs plus the event stream they were fed
// ---------------------------------------------------------------------------
const readWav = p => {
  const b = readFileSync(p)
  const n = b.readUInt32LE(40) / 4
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) m[i] = (b.readInt16LE(44 + i * 4) + b.readInt16LE(46 + i * 4)) / 2 / 32768
  return m
}
const label = ev => {
  if (['enemyWindup', 'enemyAttack', 'hit', 'kill'].includes(ev.type)) return `${ev.type}/${ev.kind}`
  if (ev.type === 'swing') return ev.heavy ? 'swing/heavy' : 'swing'
  return ev.type
}
const med = a => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)]
const tl = JSON.parse(readFileSync(`${dir}/event-timeline.json`, 'utf8'))
const inMix = {}
for (const [file, key] of [['mix.wav', 'wave1'], ['mix-hurt.wav', 'worstCase']]) {
  const x = readWav(`${dir}/${file}`)
  const lanes = { broad: x, ...Object.fromEntries(BANDS.map(([lo, hi]) => [`${lo}-${hi}`, bandpass(x, lo, hi, SR)])) }
  const by = new Map()
  // events inside the first 140 ms have no bed behind them (the render starts at silence), so
  // their "lift" would be against nothing. They are dropped, not measured.
  for (const r of tl[key].rows.filter(r => r.t >= 0.2)) {
    const l = label(r.ev)
    if (!by.has(l)) by.set(l, [])
    by.get(l).push(Object.fromEntries(Object.entries(lanes).map(([k, lane_]) => [k, lane(lane_, r.t, SR)])))
  }
  inMix[file] = rank([...by.entries()].map(([event, arr]) => ({
    event, n: arr.length,
    broadLiftDb: +med(arr.map(a => a.broad.lift)).toFixed(1),
    bands: Object.fromEntries(BANDS.map(([lo, hi]) => [`${lo}-${hi}`, { lift: +med(arr.map(a => a[`${lo}-${hi}`].lift)).toFixed(1) }])),
  })))
}

// ---------------------------------------------------------------------------
// 2. solo: one event at a time, over the bed, through the real AudioSystem
// ---------------------------------------------------------------------------
const browser = await chromium.launch()
const page = await browser.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.route('**/audio-solo-probe.html', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>audio solo probe</title>' }))
await page.goto(`${url}/audio-solo-probe.html`)
const solo = await page.evaluate(async ({ files, bands }) => {
  const { AudioSystem } = await import('/src/audio/audio.ts')
  const { playEventSfx, resetSfxState } = await import('/src/audio/sfxMap.ts')
  const P = { x: 240, y: 135 }, E = { x: 320, y: 150 }, FAR = { x: 430, y: 200 }
  const cases = [
    ['enemyWindup/brute', { type: 'enemyWindup', id: 1, kind: 'brute', ...E }],
    ['enemyWindup/caster', { type: 'enemyWindup', id: 1, kind: 'caster', ...FAR }],
    ['enemyWindup/charger', { type: 'enemyWindup', id: 1, kind: 'charger', ...E }],
    ['enemyAttack/brute', { type: 'enemyAttack', id: 1, kind: 'brute', ...E, angle: 0 }],
    ['enemyAttack/charger', { type: 'enemyAttack', id: 1, kind: 'charger', ...E, angle: 0 }],
    ['spawnTelegraph', { type: 'spawnTelegraph', ...E, kind: 'brute' }],
    ['boltFired', { type: 'boltFired', ...FAR, angle: 0 }],
    ['dodge', { type: 'dodge', ...P, angle: 0 }],
    ['dodged', { type: 'dodged', ...P }],
    ['dodgeEnd', { type: 'dodgeEnd', ...P }],
    ['swing', { type: 'swing', ...P, angle: 0, swing: 0, heavy: false }],
    ['swing/heavy', { type: 'swing', ...P, angle: 0, swing: 2, heavy: true }],
    ['playerHurt', { type: 'playerHurt', ...P, angle: 0, hp: 3, maxHp: 5 }],
    ['hit killing', { type: 'hit', ...E, angle: 0, damage: 4, heavy: true, targetId: 1, kind: 'brute', killed: true }],
    ['hit/brute', { type: 'hit', ...E, angle: 0, damage: 2, heavy: false, targetId: 1, kind: 'brute', killed: false }],
    ['hit/charger', { type: 'hit', ...E, angle: 0, damage: 2, heavy: false, targetId: 1, kind: 'charger', killed: false }],
    ['boltCut', { type: 'boltCut', ...E }],
    ['boltHitWall', { type: 'boltHitWall', ...E }],
    ['enemyStagger', { type: 'enemyStagger', id: 1, ...E }],
    ['spawn', { type: 'spawn', id: 1, kind: 'brute', ...E }],
    ['footstep', { type: 'footstep', ...P }],
    ['waveStart', { type: 'waveStart', wave: 1, total: 3 }],
    ['bed only (control)', null],
  ]
  const bp = (x, lo, hi, sr) => {
    const f0 = Math.sqrt(lo * hi), Q = f0 / (hi - lo)
    const w0 = 2 * Math.PI * f0 / sr, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0)
    const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0
    const y = new Float32Array(x.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v }
    return y
  }
  const db = v => v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -99
  const sr = 48000, at = 2.0, out = []
  for (const [label, ev] of cases) {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: sr * 4, sampleRate: sr })
    const a = new AudioSystem()
    await a.load(files, '/assets/audio/', ctx)
    resetSfxState()
    a.setCombat(1, 1)                 // in combat: both bed layers up, the worst case for masking
    a.setListener(P.x, P.y)
    if (ev) { a.timeOffset = at; playEventSfx(a, ev); a.timeOffset = 0 }
    const buf = await ctx.startRendering()
    const L = buf.getChannelData(0), R = buf.getChannelData(1)
    const mono = new Float32Array(L.length)
    for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2
    const i0 = Math.round(at * sr), w = Math.round(0.03 * sr)
    const lane = x => {
      const rms = (f, t) => { let s = 0; for (let i = f; i < t; i++) s += x[i] * x[i]; return Math.sqrt(s / (t - f)) }
      let best = 0
      for (let s = i0; s + w <= i0 + Math.round(0.08 * sr); s += Math.round(0.005 * sr)) best = Math.max(best, rms(s, s + w))
      return { best: db(best), bed: db(rms(i0 - Math.round(0.14 * sr), i0)), lift: +(db(best) - db(rms(i0 - Math.round(0.14 * sr), i0))).toFixed(1) }
    }
    let peak = 0
    for (let i = i0; i < i0 + Math.round(0.6 * sr); i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
    const broad = lane(mono)
    out.push({
      event: label, broadLiftDb: broad.lift, best30Db: broad.best, bedDb: broad.bed, peakDb: db(peak),
      bands: Object.fromEntries(bands.map(([lo, hi]) => [`${lo}-${hi}`, lane(bp(mono, lo, hi, sr))])),
    })
  }
  return out
}, { files: manifest.audio, bands: BANDS })
await browser.close()
rank(solo)

writeFileSync(`${dir}/solo-levels.json`, JSON.stringify({
  note: 'Each event rendered alone over the full combat bed in a real OfflineAudioContext, listener at the player. lift = best 30 ms RMS in the 80 ms after the event, minus the 140 ms of bed before it. "bed only (control)" is the same measurement with no event: any row at the control\'s level is inaudible in that band.',
  order: 'the intended hierarchy is danger (wind-up, attack, telegraph) > the player\'s own action (dodge, swing) > consequence (hurt, hit, kill) > incidental (footstep, wall hit)',
  rows: solo,
}, null, 1))
writeFileSync(`${dir}/event-lift.json`, JSON.stringify({
  note: 'The same measurement inside the two rendered mixes. Median over every instance of the event. Events in the first 200 ms are dropped: the render starts from silence, so they have no bed to be measured against.',
  mixes: inMix, pageErrors: errs,
}, null, 1))
console.log('SOLO (each event alone over the bed)\n' + 'event'.padEnd(21) + '  broad  bestLift  band')
console.log(table(solo).join('\n'))
for (const [f, rows] of Object.entries(inMix)) {
  console.log(`\nIN MIX: ${f}\n` + 'event'.padEnd(21) + '  broad  bestLift  band')
  console.log(table(rows).join('\n'))
}
if (errs.length) console.log('pageErrors', errs)
