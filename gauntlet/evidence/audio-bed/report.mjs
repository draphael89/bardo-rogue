// Turns the JSON that render-mix.mjs wrote into the images the protocol asks for.
// Nothing is computed here that is not already in the JSON: this is a plotter.
// usage: node gauntlet/evidence/audio-bed/report.mjs --out gauntlet/evidence/audio-bed/w2r1
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? '1'] : []).filter(x => x.length))
const dir = args.out ?? 'gauntlet/evidence/audio-bed/w2r1'
const J = f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
const levels = J('levels.json'), duck = J('duck-curves.json'), map = J('event-map.json'), tl = J('event-timeline.json')
const envs = J('envelopes.json').mixes

const BG = '#14121a', FG = '#e8e4f0', DIM = '#8b8499', LINE = '#2b2736'
const ACC = { master: '#f0c060', music: '#7ad0ff', ambience: '#9a86ff', sfx: '#66e0a0', ui: '#ff8fb0' }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" fill="${o.fill ?? FG}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="${o.size ?? 13}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.weight ? `font-weight="${o.weight}"` : ''} ${o.rot ? `transform="rotate(${o.rot} ${x} ${y})"` : ''}>${esc(s)}</text>`
const png = async (svg, file) => {
  writeFileSync(`${dir}/${file}.svg`, svg)
  await sharp(Buffer.from(svg)).png().toFile(`${dir}/${file}.png`)
  console.log(file + '.png')
}
const frame = (w, h, title, sub) => ({
  head: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${BG}"/>`
    + T(24, 34, title, { size: 19, weight: 700 }) + T(24, 56, sub, { size: 12, fill: DIM }),
  tail: `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${LINE}"/></svg>`,
})

// ---------------------------------------------------------------------------
// 1. waveforms, one lane per bus, with the event stream above them
// ---------------------------------------------------------------------------
async function waveform(mixKey, tlKey, file) {
  const env = envs[mixKey], m = levels.mixes[mixKey].levels
  const rows = tl[tlKey].rows, seconds = levels.render.seconds
  const lanes = [['masterOut', 84], ['music', 52], ['ambience', 52], ['sfx', 52], ['ui', 52]]
  const W = 1760, PADL = 150, PADR = 40, GW = W - PADL - PADR
  const top = 190
  let h = top, y = {}
  for (const [k, lh] of lanes) { y[k] = h + lh / 2; h += lh + 26 }
  const H = h + 46
  const f = frame(W, H, `${mixKey} — 10 s OfflineAudioContext render`, `${levels.render.source} · ${levels.render.sampleRate} Hz · ${levels.mixes[mixKey].fed} sim events fed · script: ${levels.render.script}`)
  let s = f.head
  const X = t => PADL + t / seconds * GW
  // event rail
  s += T(24, top - 120, 'events (from the replay, pure sim)', { size: 11, fill: DIM })
  const seen = {}
  for (const r of rows) {
    const x = X(r.t), type = r.ev.type
    s += `<line x1="${x}" y1="${top - 112}" x2="${x}" y2="${top - 96}" stroke="${type === 'playerHurt' ? '#ff5c6a' : DIM}" stroke-width="${type === 'playerHurt' ? 2 : 1}"/>`
    const big = ['playerHurt', 'waveStart', 'waveClear', 'roomClear', 'playerDeath', 'spawn', 'kill']
    if (big.includes(type)) {
      const lvl = (seen[Math.round(x / 90)] = (seen[Math.round(x / 90)] ?? 0) + 1)
      s += T(x + 3, top - 100 - lvl * 13, type, { size: 10, fill: type === 'playerHurt' ? '#ff5c6a' : FG })
    }
  }
  // time grid
  for (let t = 0; t <= seconds; t++) {
    s += `<line x1="${X(t)}" y1="${top - 90}" x2="${X(t)}" y2="${H - 34}" stroke="${LINE}"/>`
    s += T(X(t), H - 16, t + 's', { size: 11, fill: DIM, anchor: 'middle' })
  }
  for (const [k, lh] of lanes) {
    const half = lh / 2 - 4, cy = y[k], col = ACC[k === 'masterOut' ? 'master' : k]
    s += `<line x1="${PADL}" y1="${cy}" x2="${W - PADR}" y2="${cy}" stroke="${LINE}"/>`
    for (const g of [0.5, 0.25]) for (const sg of [1, -1]) s += `<line x1="${PADL}" y1="${cy + sg * g * half}" x2="${W - PADR}" y2="${cy + sg * g * half}" stroke="#221f2c"/>`
    const mn = env[k].min, mx = env[k].max, n = mn.length
    let d = ''
    for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${(PADL + i / n * GW).toFixed(1)},${(cy - mx[i] * half).toFixed(1)} `
    for (let i = n - 1; i >= 0; i--) d += `L${(PADL + i / n * GW).toFixed(1)},${(cy - mn[i] * half).toFixed(1)} `
    s += `<path d="${d}Z" fill="${col}" fill-opacity="0.55" stroke="${col}" stroke-width="0.6"/>`
    const L = m[k]
    s += T(24, cy - 8, k === 'masterOut' ? 'MASTER OUT' : k.toUpperCase(), { size: 12, weight: 700, fill: col })
    s += T(24, cy + 8, `peak ${L.peakDb} dB`, { size: 11, fill: DIM })
    s += T(24, cy + 22, `rms  ${L.rmsDb} dB`, { size: 11, fill: DIM })
    if (k === 'masterOut') s += T(24, cy + 36, `clipped ${L.clippedSamples}`, { size: 11, fill: L.clippedSamples ? '#ff5c6a' : '#66e0a0' })
    const LD = levels.mixes[mixKey].loudness[k]
    s += T(24, cy + (k === 'masterOut' ? 50 : 36), `50ms rms p50 ${LD.p50}`, { size: 10, fill: DIM })
    s += T(24, cy + (k === 'masterOut' ? 62 : 48), `        p99 ${LD.p99}`, { size: 10, fill: DIM })
  }
  s += T(W - PADR, top - 120, 'lane scale: ±1.0 full scale, grid at -6 and -12 dB · buses are pre-limiter taps', { size: 11, fill: DIM, anchor: 'end' })
  await png(s + f.tail, file)
}

// ---------------------------------------------------------------------------
// 2. bus graph, every gain as a number
// ---------------------------------------------------------------------------
async function busGraph() {
  const g = levels.graph, W = 1500, H = 820
  const f = frame(W, H, 'Bus graph — every gain as a number', 'src/audio/audio.ts MIX. Master > { Music, Ambience > duck stage, SFX, UI } > limiter > out trim > destination')
  let s = f.head
  const box = (x, y, w, h, title, lines, col) => {
    let o = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#1c1926" stroke="${col}"/>` + T(x + 12, y + 22, title, { size: 13, weight: 700, fill: col })
    lines.forEach((l, i) => { o += T(x + 12, y + 42 + i * 17, l, { size: 12, fill: l.startsWith('!') ? '#ff5c6a' : FG }) })
    return o
  }
  const arrow = (x1, y1, x2, y2, label) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${DIM}" stroke-width="1.4" marker-end="url(#a)"/>` + (label ? T((x1 + x2) / 2, (y1 + y2) / 2 - 6, label, { size: 10, fill: DIM, anchor: 'middle' }) : '')
  s += `<defs><marker id="a" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="${DIM}"/></marker></defs>`
  const busY = { music: 110, ambience: 230, sfx: 350, ui: 470 }
  for (const b of g.buses) {
    const y = busY[b.bus], col = ACC[b.bus]
    const l1 = levels.mixes['mix.wav'].levels[b.bus], l2 = levels.mixes['mix-hurt.wav'].levels[b.bus]
    const dd = v => v.peakDb <= -900 ? 'silent in this render' : `peak ${v.peakDb} / rms ${v.rmsDb} dB`
    s += box(40, y, 380, 96, `${b.bus.toUpperCase()} bus`, [`fader   ${b.db} dB  (gain ${b.gain})`, `wave1   ${dd(l1)}`, `worst   ${dd(l2)}`], col)
    if (g.duck.applies.includes(b.bus)) {
      s += arrow(420, y + 48, 430, y + 48)
      s += box(430, y + 8, 250, 80, 'duck stage', [`idle    1.000  (0.0 dB)`, `ducked  ${g.duck.targetGainMultiplier} (${g.duck.depthDb} dB)`], '#ffb347')
      s += arrow(680, y + 48, 780, 300)
    } else s += arrow(420, y + 48, 780, 300)
  }
  s += box(780, 250, 300, 100, 'MASTER', [`${g.master.db} dB  (gain ${g.master.gain})`, `slider 0..1 -> dB curve, floor -60 dB`], ACC.master)
  s += arrow(1080, 300, 1140, 300)
  s += box(1140, 200, 320, 200, 'limiter -> out trim -> destination', [
    `threshold ${g.limiter.thresholdDb} dB   knee ${g.limiter.knee}`,
    `ratio     ${g.limiter.ratio}:1`,
    `attack    ${g.limiter.attack * 1000} ms`,
    `release   ${g.limiter.release * 1000} ms`,
    `out trim  ${g.limiter.outTrimDb} dB (gain ${g.limiter.outTrimGain})`,
    `measured peak ${levels.mixes['mix-hurt.wav'].levels.masterOut.peakDb} dB`,
    `clipped samples ${levels.mixes['mix-hurt.wav'].levels.masterOut.clippedSamples}`,
  ], '#ff8fb0')
  s += box(40, 590, 700, 195, 'duck', [
    `applies to      ${g.duck.applies.join(' + ')}   (never SFX or UI, never Master)`,
    `stage           ${g.duck.stage}`,
    `attack ${g.duck.attack * 1000} ms   hold ${g.duck.hold * 1000} ms   release ${g.duck.release * 1000} ms   depth ${g.duck.depthDb} dB`,
    `arbitration     ${g.duck.arbitration}`,
    ...g.duck.callers.map(c => `${c.event.padEnd(15)} ${c.depthDb} dB / ${c.release * 1000} ms release${c.delay ? ` / opens ${c.delay * 1000} ms AFTER the event` : ''}`),
    `measured curves duck-curves.json + duck-curves.png`,
  ], '#ffb347')
  s += box(760, 590, 700, 195, 'bed (adaptive, generated — no music files ship)', [
    `${g.bed.bpm} bpm, ${g.bed.beatsPerBar}/4   ambience loop ${g.bed.ambienceBars} bars   combat loops ${g.bed.combatBars} bars`,
    `ambience ${g.bed.ambienceDb} dB, ducks to ${g.bed.ambienceDuckDb} dB under combat`,
    `layer A "pulse" ${g.bed.bedDb} dB on aliveEnemies > 0`,
    `layer B "churn"  ${g.bed.driveDb} dB on alive >= ${g.bed.driveOnEnemies} or hp <= ${g.bed.driveOnHp01 * 100}%, off at alive <= ${g.bed.driveOffEnemies} (hysteresis)`,
    `crossfade in ${g.bed.fadeIn} s / out ${g.bed.fadeOut} s`,
    `voice cap: at most 4 starts of one sound group per 70 ms; same-instant starts staggered 38 ms apart`,
  ], ACC.music)
  await png(s + f.tail, 'bus-graph')
}

// ---------------------------------------------------------------------------
// 3. duck curves, measured
// ---------------------------------------------------------------------------
async function duckPlot() {
  const names = Object.keys(duck.scenarios)
  const W = 1500, PW = 660, PH = 250, H = 150 + Math.ceil(names.length / 2) * (PH + 96)
  const f = frame(W, H, 'Duck curves — measured, not computed', duck.note)
  let s = f.head
  names.forEach((name, i) => {
    const cx = 60 + (i % 2) * (PW + 100), cy = 152 + Math.floor(i / 2) * (PH + 96)
    const sc = duck.scenarios[name]
    const t0 = 0.4, t1 = 2.2
    const X = t => cx + (t - t0) / (t1 - t0) * PW
    const Y = db => cy + PH - (db + 16) / 16 * PH        // -16..0 dB
    s += `<rect x="${cx}" y="${cy}" width="${PW}" height="${PH}" fill="#1a1724" stroke="${LINE}"/>`
    for (const db of [0, -3, -6, -9, -12, -15]) {
      s += `<line x1="${cx}" y1="${Y(db)}" x2="${cx + PW}" y2="${Y(db)}" stroke="#241f30"/>`
      s += T(cx - 8, Y(db) + 4, db + ' dB', { size: 10, fill: DIM, anchor: 'end' })
    }
    for (let t = 0.5; t <= 2.2; t += 0.25) {
      s += `<line x1="${X(t)}" y1="${cy}" x2="${X(t)}" y2="${cy + PH}" stroke="#241f30"/>`
      s += T(X(t), cy + PH + 16, t.toFixed(2) + 's', { size: 10, fill: DIM, anchor: 'middle' })
    }
    for (const k of sc.script) s += `<line x1="${X(k.t)}" y1="${cy}" x2="${X(k.t)}" y2="${cy + PH}" stroke="#ff5c6a" stroke-dasharray="3 3"/>`
    let d = ''
    const line = sc.dense ?? sc.curve
    line.forEach((p, j) => { d += `${j ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(Math.max(-16, p.db)).toFixed(1)} ` })
    s += `<path d="${d}" fill="none" stroke="${ACC.music}" stroke-width="2"/>`
    for (const p of sc.curve) s += `<circle cx="${X(p.t)}" cy="${Y(Math.max(-16, p.db))}" r="2.2" fill="#ffffff"/>`
    s += T(cx, cy - 44, name, { size: 14, weight: 700 })
    s += T(cx, cy - 26, `triggers  ${sc.script.map(k => `${k.t}s ${k.depthDb} dB rel ${k.release}s${k.delay ? ` delay ${Math.round(k.delay * 1000)}ms` : ''}`).join(' · ')}`, { size: 11, fill: DIM })
    s += T(cx, cy - 10, `deepest ${sc.deepest.db} dB at ${sc.deepest.at}s · dots are the sampled table in duck-curves.json`, { size: 11, fill: '#ffb347' })
    for (const p of sc.curve.filter((_, j) => j % 3 === 0)) s += T(X(p.t) + 6, Y(Math.max(-16, p.db)) + 14, p.db, { size: 9, fill: DIM })
  })
  await png(s + f.tail, 'duck-curves')
}

// ---------------------------------------------------------------------------
// 4. event -> sound map, as a table
// ---------------------------------------------------------------------------
async function eventMap() {
  const rows = map.rows
  const W = 1620, RH = 22
  const H = 150 + rows.reduce((n, r) => n + Math.max(1, r.calls.length), 0) * RH + 60
  const f = frame(W, H, 'Event -> sound map', map.note)
  let s = f.head
  const cols = [[40, 'sim event'], [250, 'call'], [340, 'sound'], [640, 'gain'], [720, 'pitch'], [800, 'var'], [870, 'bus'], [980, 'placed in room'], [1130, 'detail']]
  let y = 118
  for (const [x, name] of cols) s += T(x, y, name, { size: 11, fill: DIM, weight: 700 })
  s += `<line x1="40" y1="${y + 8}" x2="${W - 40}" y2="${y + 8}" stroke="${LINE}"/>`
  y += 30
  for (const r of rows) {
    const n = Math.max(1, r.calls.length)
    s += `<rect x="34" y="${y - 15}" width="${W - 68}" height="${n * RH}" fill="${rows.indexOf(r) % 2 ? '#191624' : '#00000000'}"/>`
    s += T(40, y, r.event, { size: 12, weight: 700 })
    if (!r.calls.length) s += T(250, y, '— silent —', { size: 12, fill: DIM })
    r.calls.forEach((c, i) => {
      const yy = y + i * RH
      const col = ACC[c.bus === 'music' ? 'music' : c.bus === 'ui' ? 'ui' : c.bus === 'music+ambience' ? 'ambience' : 'sfx']
      s += T(250, yy, c.call, { size: 12, fill: col })
      s += T(340, yy, c.call === 'duck' ? `music+ambience -> ${c.depthDb} dB` : c.name, { size: 12 })
      if (c.call !== 'duck') {
        s += T(640, yy, c.gain !== undefined ? (+c.gain).toFixed(2) : '', { size: 12 })
        s += T(720, yy, c.pitch !== undefined ? (+c.pitch).toFixed(2) : '', { size: 12 })
        s += T(800, yy, c.pitchVar !== undefined ? '±' + Math.round(c.pitchVar * 100) + '%' : '', { size: 12 })
        s += T(870, yy, c.bus, { size: 12, fill: col })
        s += T(980, yy, c.placed ? 'yes (pan + dist + itd)' : c.call === 'play' ? 'no (centred)' : c.call === 'swish' ? 'with its whoosh' : 'no (centred)', { size: 11, fill: DIM })
        s += T(1130, yy, c.call === 'bell' ? `${c.hz} Hz, ${c.decay}s decay${c.delay ? `, +${c.delay}s` : ''}` : c.call === 'thump' ? `${c.hz} -> ${c.toHz} Hz drop, ${c.decay}s decay` : c.call === 'swish' ? `${c.ms} ms bandpass sweep` : c.delay ? `+${c.delay}s` : '', { size: 11, fill: DIM })
      } else s += T(640, yy, `release ${c.release}s${c.duckDelay ? `, opens +${Math.round(c.duckDelay * 1000)} ms` : ''}`, { size: 12, fill: DIM })
    })
    y += n * RH
  }
  y += 20
  s += T(40, y, `round-robin groups play a different take each time and never repeat the last (woosh x8, hurt x5, creature x5, impactPunch_medium x5, ...). Announcer files never load: ${levels.gates.announcer.loadedAndPlayable.length === 0 ? 'verified 0 playable' : 'FAIL'}`, { size: 12, fill: DIM })
  await png(s + f.tail, 'event-sound-map')
}

// ---------------------------------------------------------------------------
// 5. the gates, as one card
// ---------------------------------------------------------------------------
async function gates() {
  const G = levels.gates, W = 1500, H = 700
  const f = frame(W, H, 'Gates', 'Structure and level only. No image can judge whether the bed sounds good — that needs an ear on mix.wav.')
  let s = f.head
  let y = 110
  const row = (label, value, ok) => {
    s += T(40, y, label, { size: 13 })
    s += T(620, y, value, { size: 13, fill: ok === undefined ? FG : ok ? '#66e0a0' : '#ff5c6a' })
    y += 26
  }
  row('clipping — |sample| > 1.0 on master out, mix.wav', `${G.clipping['mix.wav']} samples`, G.clipping['mix.wav'] === 0)
  const wh = levels.mixes['mix-hurt.wav']
  row(`clipping — mix-hurt.wav (worst case: ${wh.fed} events, ${wh.hist.playerHurt ?? 0} player hits, ${wh.hist.spawn ?? 0} spawns)`, `${G.clipping['mix-hurt.wav']} samples`, G.clipping['mix-hurt.wav'] === 0)
  row('samples at or above 0.999 (inter-sample risk)', `${levels.mixes['mix.wav'].levels.masterOut.samplesAtOrAbove0999} / ${levels.mixes['mix-hurt.wav'].levels.masterOut.samplesAtOrAbove0999}`, true)
  row('master peak, mix.wav / mix-hurt.wav (must be <= -1.0 dBFS)', `${G.headroom['mix.wav']} dB / ${G.headroom['mix-hurt.wav']} dB`, G.headroom.pass)
  row('master rms, mix.wav / mix-hurt.wav', `${levels.mixes['mix.wav'].levels.masterOut.rmsDb} dB / ${levels.mixes['mix-hurt.wav'].levels.masterOut.rmsDb} dB`)
  row('announcer resident or playable', G.announcer.loadedAndPlayable.length ? G.announcer.loadedAndPlayable.join(', ') : 'none — 8 files skipped at load', G.announcer.pass)
  y += 14
  s += T(40, y, 'loop seams — the wrap step against the loop\'s own interior steps', { size: 13, weight: 700 }); y += 24
  for (const [k, v] of Object.entries(G.loopSeam.wave1)) {
    const worst = Math.max(...v.channels.map(c => c.wrapStepAbs / c.interiorP9999StepAbs))
    row(`  ${k}: ${v.bars} bars = ${v.seconds}s (musical ${v.musicalSeconds}s, drift ${v.driftMs} ms)`,
      `wrap step ${v.channels.map(c => c.wrapStepAbs).join(' / ')} vs interior p99.99 ${v.channels.map(c => c.interiorP9999StepAbs).join(' / ')} -> ${(worst * 100).toFixed(1)}% of an ordinary step`, worst < 1)
  }
  y += 14
  s += T(40, y, 'masking — does a hit clear the bed? 50 ms RMS windows', { size: 13, weight: 700 }); y += 24
  for (const k of ['mix.wav', 'mix-hurt.wav']) {
    const mk = G.masking[k]
    row(`  ${k}: SFX p99 ${mk.sfxP99} dB over Music p50 ${mk.musicP50} dB`, `${mk.gapDb} dB gap (want >= 6)`, mk.gapDb >= 6)
  }
  y += 14
  s += T(40, y, 'duck arbitration — deeper wins over a shallower duck already in flight', { size: 13, weight: 700 }); y += 24
  for (const [k, v] of Object.entries(G.duckArbitration.deepestReached)) row('  ' + k, v + ' dB', k.includes('playerHurt') ? Math.abs(v + 13) < 0.3 : true)
  y += 14
  s += T(40, y, 'Reachable duck cadence: player i-frames are 40 ticks (667 ms), so two -13 dB ducks cannot land closer than that; the curve is back within 0.2 dB by then.', { size: 11, fill: DIM })
  await png(s + f.tail, 'gates')
}

await waveform('mix.wav', 'wave1', 'waveform')
await waveform('mix-hurt.wav', 'worstCase', 'waveform-hurt')
await busGraph()
await duckPlot()
await eventMap()
await gates()
