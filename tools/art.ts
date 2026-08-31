// The art pipeline CLI. One command per stage, so an agent can drive the whole loop.
//
//   pnpm art palette                      emit canon.png / canon.gpl / canon-swatch.png from canon.json
//   pnpm art compile art/specs/hero.json  source image -> sheet PNG + sidecar, then gate it
//   pnpm art gate public/assets/sprites/bardo_hero.png   re-run gates on a compiled sheet
//   pnpm art preview <sheet.png> [--scale 6]            a 1x-and-magnified contact sheet for review
//
// Compiled output goes to public/assets. Candidates never do — they live in .art-cache/ until a human
// approves them into art/approved/.
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, basename, join } from 'node:path'
import sharp from 'sharp'
import { canon, luminance, type RGB } from './art/palette'
import { compileSheet, validateClipRefs, writeSidecar, type CompileSpec } from './art/compile'
import { makeContext, runGates, formatGates, summarise, loadPixels } from './art/gates'
import { isProductionPath, verifyApproval, writeReceipt } from './art/approve'
import { validateSheetDef, type SheetDef } from '../src/render/sheet'
import { buildPrompt, generate, parseProvider, promptHash, requests, resolveReferences, tokenFor, type GenerateSpec } from './art/generate'
import { writeRejection } from './art/reject'
import { importCharacter, assembleAnimation } from './art/pixellab'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name: string, dflt?: string): string | undefined => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? (argv[i + 1] ?? '1') : dflt
}

const usage = (): never => {
  console.error(`usage:
  pnpm art palette
  pnpm art compile <spec.json> [--out <png>]
  pnpm art gate <sheet.png> [--sidecar <json>]
  pnpm art approve <art/approved/master.png> --id <identity.vN> --by <who> [--note <why>]
  pnpm art reject <candidate.png> --reason <why> [--by <who>] [--manifest <run.manifest.json>]
  pnpm art preview <sheet.png> [--scale 6] [--out <png>]
  pnpm art generate <gen-spec.json> [--provider retrodiffusion|pixellab] [--live]
  pnpm art pixellab import <characterId>          download + hash an EXISTING family; spends nothing
  pnpm art pixellab assemble <manifest.json> --state <s> --animation <a> --direction <d> --clip <name>`)
  process.exit(1)
}

// --- pixellab -----------------------------------------------------------------------------------
// Custody for what the account already holds. Both subcommands are GETs of paid-for state, so
// neither can spend; there is no --live here because there is nothing to opt into yet.
async function cmdPixellab(): Promise<void> {
  const sub = argv[1]
  if (sub === 'import') {
    const id = argv[2]
    if (!id) usage()
    const { manifest, manifestPath } = await importCharacter(id)
    console.log(`imported ${manifest.characterId} (export ${manifest.exportVersion}, group ${manifest.groupId ?? '-'})`)
    console.log(`  zip ${manifest.zip.bytes} bytes, ${manifest.zip.files} files, sha256 ${manifest.zip.sha256.slice(0, 16)}…`)
    for (const s of manifest.states) {
      const clips = Object.entries(s.animations)
      console.log(`  state ${s.folder}: ${s.rotations.length} rotations, ${clips.length} animation group(s)${s.size ? `, ${s.size.width}x${s.size.height}` : ''}${s.view ? `, ${s.view}` : ''}`)
      for (const [name, dirs] of clips) console.log(`    ${name}: ${Object.keys(dirs).length} dir(s) x ${Object.values(dirs)[0]} frames`)
    }
    if (manifest.errors.length) console.log(`  ${manifest.errors.length} ERROR(S): ${manifest.errors.slice(0, 3).join('; ')}`)
    console.log(`manifest: ${manifestPath}`)
    return
  }
  if (sub === 'assemble') {
    const manifestPath = argv[2]
    if (!manifestPath) usage()
    const r = await assembleAnimation({
      manifestPath,
      state: flag('state') ?? 'Idle',
      animation: flag('animation') ?? usage(),
      direction: flag('direction') ?? 'south',
      clip: flag('clip') ?? 'clip',
      ...(flag('cols') ? { cols: Number(flag('cols')) } : {}),
    })
    console.log(`${r.master}  ${r.width}x${r.height}, source cell ${r.cell}`)
    console.log(`  frames: ${r.frames.join(' ')}`)
    console.log(`\nNext: write a compile spec whose "input" is that master, with "cell" set to the`)
    console.log(`TARGET cell (64 for a character) — the compiler votes ${r.cell} down to it in palette space.`)
    return
  }
  usage()
}

// --- palette ----------------------------------------------------------------------------------------
// Emitted, never hand-edited. `canon.png` is what a generator is handed (Retro Diffusion
// `input_palette`, PixelLab `force_colors`); `canon.gpl` is what Aseprite loads.
async function cmdPalette(): Promise<void> {
  const c = canon()
  const names = Object.keys(c.colors).sort((a, b) => luminance(c.colors[a].rgb as RGB) - luminance(c.colors[b].rgb as RGB))
  const dir = 'art/palette'
  mkdirSync(dir, { recursive: true })

  // A flat 1px-tall strip: one pixel per canon colour, in luminance order.
  const strip = Buffer.alloc(names.length * 4)
  names.forEach((n, i) => {
    const [r, g, b] = c.colors[n].rgb
    strip[i * 4] = r; strip[i * 4 + 1] = g; strip[i * 4 + 2] = b; strip[i * 4 + 3] = 255
  })
  await sharp(strip, { raw: { width: names.length, height: 1, channels: 4 } })
    .png({ palette: false, compressionLevel: 9 }).toFile(join(dir, 'canon.png'))

  const gpl = ['GIMP Palette', `Name: ${c.name}`, 'Columns: 8', '#',
    ...names.map(n => { const [r, g, b] = c.colors[n].rgb; return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${n}` })]
  writeFileSync(join(dir, 'canon.gpl'), gpl.join('\n') + '\n')

  // A human-readable swatch, grouped by band, for review against ART_DIRECTION §1.
  const SW = 24, GAP = 2, COLS = 8
  const rows = Math.ceil(names.length / COLS)
  const W = COLS * (SW + GAP) + GAP, H = rows * (SW + GAP) + GAP
  const sheet = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 12; sheet[i * 4 + 1] = 12; sheet[i * 4 + 2] = 20; sheet[i * 4 + 3] = 255 }
  names.forEach((n, i) => {
    const cx = (i % COLS) * (SW + GAP) + GAP, cy = Math.floor(i / COLS) * (SW + GAP) + GAP
    const [r, g, b] = c.colors[n].rgb
    for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) {
      const o = ((cy + y) * W + cx + x) * 4
      sheet[o] = r; sheet[o + 1] = g; sheet[o + 2] = b; sheet[o + 3] = 255
    }
  })
  await sharp(sheet, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(dir, 'canon-swatch.png'))
  console.log(`palette: ${names.length} colours -> ${dir}/canon.png, canon.gpl, canon-swatch.png`)
}

// --- compile ----------------------------------------------------------------------------------------
async function cmdCompile(): Promise<void> {
  const specPath = argv[1]
  if (!specPath || !existsSync(specPath)) usage()
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as CompileSpec
  // Redirecting the image redirects its sidecar too. A candidate that leaves half of itself in
  // public/assets is not a candidate — it is a half-promoted asset nobody approved.
  if (flag('out')) { spec.output = flag('out')!; spec.sidecar = undefined }
  const destPng = spec.output
  const destSidecar = spec.sidecar ?? destPng.replace(/\.png$/, '.json')

  // The staging redirect below rewrites spec.output before compileSheet sees it, so the compiler's
  // own boundary check would see a cache path. Hold the human checkpoint against the DECLARED
  // destination here; compileSheet still guards programmatic callers that aim at production paths.
  if (isProductionPath(destPng)) verifyApproval(spec.provenance?.approvedSource ?? spec.provenance?.approvedReference, specPath)

  // Compile into the cache and PROMOTE only after the gates pass. Writing the declared destination
  // first means a rejected candidate has already replaced the last good production asset by the time
  // the command exits nonzero — the opposite of what the rejection message promises. The staging path
  // carries the asset id and source hash so two compiles cannot collide on a shared basename.
  const sourceTag = createHash('sha256').update(readFileSync(spec.input)).digest('hex').slice(0, 8)
  const stageDir = join('.art-cache/staging', `${spec.id}-${sourceTag}`)
  const stage = join(stageDir, basename(destPng))
  const stageSidecar = join(stageDir, basename(destSidecar))
  mkdirSync(stageDir, { recursive: true })
  spec.output = stage
  const { def, report } = await compileSheet(spec, specPath)
  writeSidecar(stageSidecar, def)

  const ctx = await makeContext(def, report)
  const gates = runGates(ctx)
  const waivers = def.waivers ?? []
  const { pass, failed, waived } = summarise(gates, waivers)
  mkdirSync('.art-cache/reports', { recursive: true })
  writeFileSync(join('.art-cache/reports', `${spec.id}-${sourceTag}.json`),
    JSON.stringify({ report, gates }, null, 2) + '\n')

  console.log(`compiled ${spec.id}: ${report.atlas.width}x${report.atlas.height}, ${report.atlas.colors} colours, ${report.atlas.indexed ? 'indexed' : 'RGBA'}`)
  console.log(`  source ${report.source.width}x${report.source.height} sha ${report.source.hash}`)
  console.log(formatGates(gates, waivers))
  if (!pass) {
    console.error(`\nBUILD REJECTED: ${failed.length} blocking finding(s).`)
    console.error(`The candidate is at ${stage} for inspection. ${destPng} is untouched.`)
    process.exit(2)
  }
  // Both halves were fully prepared in staging before either destination is touched — and BOTH
  // destination directories exist before either copy runs. Creating only the PNG's parent left a
  // spec whose sidecar lives elsewhere landing its image and then throwing on the sidecar: exactly
  // the half-promoted asset this staging dance exists to prevent.
  mkdirSync(dirname(destPng), { recursive: true })
  mkdirSync(dirname(destSidecar), { recursive: true })
  copyFileSync(stage, destPng)
  copyFileSync(stageSidecar, destSidecar)
  console.log(`  promoted -> ${destPng} + ${destSidecar}`)
  if (waived.length) console.log(`(${waived.length} finding(s) carried under checked-in waivers)`)
}

// --- approve ----------------------------------------------------------------------------------------
// Records a HUMAN approval decision as a hash-verified receipt. An agent never runs this on its own
// initiative: the command exists so a person's yes has somewhere durable to land.
function cmdApprove(): void {
  const file = argv[1]
  const id = flag('id')
  const by = flag('by')
  if (!file || !existsSync(file) || !id || !by) {
    console.error('usage: pnpm art approve <art/approved/master.png> --id <identity.vN> --by <who> [--note <why>]')
    process.exit(1)
  }
  const receipt = writeReceipt(file, id, by, flag('note'))
  console.log(`approved ${file} as ${receipt.id} (sha ${receipt.sha256.slice(0, 12)}…) by ${receipt.approvedBy}`)
}

function cmdReject(): void {
  const candidate = argv[1]
  const reason = flag('reason')
  if (!candidate) usage()
  if (!reason) usage()
  const out = writeRejection(candidate!, reason!, flag('by') ?? 'codex', flag('manifest'))
  console.log(`rejected ${candidate} -> ${out.image}`)
  console.log(`  receipt ${out.receipt} (sha ${out.data.sha256.slice(0, 12)}…)`)
}

// --- gate -------------------------------------------------------------------------------------------
async function cmdGate(): Promise<void> {
  const png = argv[1]
  if (!png || !existsSync(png)) usage()
  const sidecarPath = flag('sidecar') ?? png.replace(/\.png$/, '.json')
  const def = JSON.parse(readFileSync(sidecarPath, 'utf8')) as SheetDef
  // A sidecar is input here, not something this command just built — validate the contract and the
  // tuning links before trusting a single number in it.
  validateSheetDef(def, sidecarPath)
  validateClipRefs(def, sidecarPath)
  const { width, height } = await loadPixels(png)
  const distinct = new Set<string>()
  let partialAlpha = 0
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    if (data[i + 3] < 255) partialAlpha++
    distinct.add('#' + [data[i], data[i + 1], data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase())
  }
  // Enforce the SELECTED ramp when the sidecar records one: a colour from someone else's ramp is
  // palette drift even though it is canonical. A sidecar is untrusted input here, so a ramp naming
  // a colour canon no longer has is REPORTED as the drift it is — dereferencing it blind crashed
  // the one command whose job is to detect exactly that.
  const colors = canon().colors
  if (def.ramp) {
    const unknown = def.ramp.filter(n => !colors[n])
    if (unknown.length) {
      console.error(`  FAIL  ramp — ${sidecarPath} names ${unknown.map(n => `"${n}"`).join(', ')}, which canon no longer defines. The palette moved under this sheet; recompile it.`)
      process.exit(2)
    }
  }
  const allowed = def.ramp
    ? new Set(def.ramp.map(n => colors[n].hex))
    : new Set(Object.values(colors).map(c => c.hex))
  const report = {
    spec: sidecarPath, input: png, output: png, sidecar: sidecarPath,
    source: { width, height, hash: '' },
    atlas: { cell: def.cell, cols: def.cols, rows: def.rows, width, height, colors: distinct.size, partialAlpha, indexed: false },
    palette: [...distinct].sort(),
    offPalette: [...distinct].filter(h => !allowed.has(h)).sort(),
    frames: [],
  }
  const ctx = await makeContext(def, report as never)
  const gates = runGates(ctx)
  console.log(formatGates(gates, def.waivers ?? []))
  if (!summarise(gates, def.waivers ?? []).pass) process.exit(2)
}

// --- preview ----------------------------------------------------------------------------------------
// A sheet is judged at 1x, but a human cannot see 32px. Emit both, side by side, on the room's own
// floor value so ground separation is visible rather than theoretical.
async function cmdPreview(): Promise<void> {
  const png = argv[1]
  if (!png || !existsSync(png)) usage()
  const scale = +(flag('scale') ?? '6')
  const out = flag('out') ?? join('.art-cache/preview', basename(png))
  const meta = await sharp(png).metadata()
  const w = meta.width!, h = meta.height!
  const ground = canon().colors.slate1.rgb
  const big = await sharp(png).resize(w * scale, h * scale, { kernel: 'nearest' }).toBuffer()
  const one = await sharp(png).toBuffer()
  const W = w * scale + w + 24, H = Math.max(h * scale, h) + 16
  mkdirSync(dirname(out), { recursive: true })
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: ground[0], g: ground[1], b: ground[2], alpha: 1 } } })
    .composite([{ input: big, left: 8, top: 8 }, { input: one, left: w * scale + 16, top: 8 }])
    .png().toFile(out)
  console.log(`preview -> ${out} (${scale}x beside 1x, on canon floor value)`)
}

// --- generate ---------------------------------------------------------------------------------------
// Dry-run is the DEFAULT: it prints the assembled prompt and the exact HTTP request, so the thing that
// actually determines quality — the prompt derived from the art bible — is reviewable on its own.
// A chargeable call happens only under an explicit --live, never because a key happened to be set.
async function cmdGenerate(): Promise<void> {
  const specPath = argv[1]
  if (!specPath || !existsSync(specPath)) usage()
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as GenerateSpec
  const provider = parseProvider(flag('provider') ?? 'retrodiffusion')
  const prompt = buildPrompt(spec)
  const live = flag('live') !== undefined
  if (!live || !tokenFor(provider)) {
    const reqs = await requests(provider, spec, '<TOKEN>')
    const refs = resolveReferences(spec.references, provider === 'pixellab' ? Infinity : 4)
    console.log(`--- prompt (sha ${promptHash(prompt)}) ---\n${prompt}`)
    console.log(`\n--- style references: ${refs.length} resolved from ${JSON.stringify(spec.references ?? [])} ---`)
    for (const r of refs) console.log(`  ${r.file}  sha256 ${r.hash.slice(0, 16)}`)
    console.log(`\n--- ${reqs.length} request(s) ---\n${reqs[0].method} ${reqs[0].url}`)
    const redacted = { ...(reqs[0].body as Record<string, unknown>) }
    for (const k of ['input_palette', 'color_image', 'reference_images', 'style_image']) {
      if (k in redacted) redacted[k] = Array.isArray(redacted[k]) ? `<${(redacted[k] as unknown[]).length} base64 image(s)>` : '<base64 image>'
    }
    console.log(JSON.stringify(redacted, null, 2))
    if (reqs.length > 1) console.log(`(${reqs.length - 1} further identical request(s) with incremented seeds — this provider returns one image per call)`)
    if (!tokenFor(provider)) console.log(`\n(no API key in the environment — this was a dry run. Set the provider's key and pass --live to generate.)`)
    else console.log(`\n(dry run. Pass --live to send these requests — they are paid calls.)`)
    return
  }
  const out = await generate(provider, spec)
  console.log(`generated ${out.files.length} candidate(s) via ${out.provider} (prompt ${out.promptHash}):`)
  for (const f of out.files) console.log('  ' + f)
  console.log(`manifest: ${out.manifest}`)
  console.log(`\nNext: pick one, point a compile spec's "input" at it, and run pnpm art compile.`)
}

switch (cmd) {
  case 'palette': await cmdPalette(); break
  case 'generate': await cmdGenerate(); break
  case 'pixellab': await cmdPixellab(); break
  case 'compile': await cmdCompile(); break
  case 'approve': cmdApprove(); break
  case 'reject': cmdReject(); break
  case 'gate': await cmdGate(); break
  case 'preview': await cmdPreview(); break
  default: usage()
}
