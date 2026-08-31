// The approval boundary, exercised.
//
// Acceptance from the external review, each as a test: unapproved production compilation fails; a
// modified master invalidates its receipt; prompt and reference hashes are computed from files and
// change when the files change; no failing or unapproved command touches a production PNG or sidecar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import { verifyApproval, writeReceipt, receiptPathFor, isProductionPath } from '../../tools/art/approve'
import { compileSheet, type CompileSpec } from '../../tools/art/compile'
import { canon } from '../../tools/art/palette'

let dir: string
let srcPng: string

// A 32x32 single-cell source: a solid iron block with a bone crown, enough to compile.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bardo-approve-'))
  const c = canon().colors
  const raw = Buffer.alloc(32 * 32 * 4)
  const put = (x: number, y: number, rgb: readonly number[]) => {
    const o = (y * 32 + x) * 4
    raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255
  }
  // A connected figure, not a filled block: the gates reject a rectangle (94% bbox fill) and reject
  // a perforated one (disconnected islands), so a fixture that must survive a real CLI compile has
  // to be a legible silhouette — narrow head over a wider torso, ~65% fill, one 4-connected mass.
  for (let y = 18; y < 28; y++) for (let x = 10; x < 22; x++) put(x, y, c.iron.rgb)
  for (let y = 8; y < 18; y++) for (let x = 14; x < 18; x++) put(x, y, c.iron.rgb)
  for (let x = 14; x < 18; x++) put(x, 8, c.ironHi.rgb)
  for (let x = 10; x < 22; x++) put(x, 27, c.slate0.rgb)
  for (let y = 6; y < 8; y++) for (let x = 13; x < 19; x++) put(x, y, c.bone.rgb)
  srcPng = join(dir, 'src.png')
  await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } }).png().toFile(srcPng)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const spec = (over: Partial<CompileSpec> = {}): CompileSpec => ({
  id: 'test.approve', kind: 'prop', input: srcPng, output: join(dir, 'out.png'),
  cell: 32, cols: 1, rows: 1, maxColors: 8, coverage: 0.4, salience: false, despeckle: false,
  palette: ['slate0', 'iron', 'ironHi', 'bone'], colourPlacement: 'pipeline-fixture',
  frames: [{ name: 'block', i: 0, pivot: [16, 30] }],
  ...over,
})

describe('receipts', () => {
  it('the two shipped masters verify against their checked-in receipts', () => {
    expect(verifyApproval('art/approved/bardo_hero_alpha_v1.png', 't').id).toBe('actor.hero.identity.v1')
    expect(verifyApproval('art/approved/bardo_brute_alpha_v1.png', 't').id).toBe('actor.brute.identity.v1')
  })
  it('rejects a reference with no receipt, and a reference outside the pool', () => {
    expect(() => verifyApproval(undefined, 't')).toThrow(/receipted master in art\/approved/)
    expect(() => verifyApproval('art/prompts/actor.hero.identity.v1.txt', 't')).toThrow(/not under art\/approved/)
  })
  it('a modified master invalidates its receipt', () => {
    const master = 'art/approved/tmp-test-master.png'
    try {
      copyFileSync(srcPng, master)
      writeReceipt(master, 'test.identity.v1', 'vitest')
      expect(verifyApproval(master, 't').id).toBe('test.identity.v1')
      // Revise the master after approval: one byte of paint.
      const buf = readFileSync(srcPng)
      writeFileSync(master, Buffer.concat([buf, Buffer.from([0])]))
      expect(() => verifyApproval(master, 't')).toThrow(/does not match its receipt/)
    } finally {
      rmSync(master, { force: true })
      rmSync(receiptPathFor(master), { force: true })
    }
  })
  it('refuses a non-PNG target, whose receipt path would be the file itself', () => {
    expect(() => receiptPathFor('art/approved/README.md')).toThrow(/not a \.png/)
    expect(() => writeReceipt('art/approved/README.md', 'x', 'vitest')).toThrow(/not a \.png/)
    expect(readFileSync('art/approved/README.md', 'utf8')).toMatch(/^# Approved masters/)
  })

  it('refuses to receipt a file outside art/approved', () => {
    expect(() => writeReceipt(srcPng, 'x', 'vitest')).toThrow(/not under art\/approved/)
  })
  it('classifies production vs candidate paths', () => {
    expect(isProductionPath('public/assets/sprites/x.png')).toBe(true)
    expect(isProductionPath('.art-cache/staging/x.png')).toBe(false)
    expect(isProductionPath(join(dir, 'x.png'))).toBe(false)
  })
})

describe('computed provenance', () => {
  it('hashes the checked-in prompt file, and the hash follows the file', async () => {
    const pf = join(dir, 'prompt.txt')
    writeFileSync(pf, 'first prompt\n')
    const a = await compileSheet(spec({ provenance: { provider: 'test', promptFile: pf } }))
    writeFileSync(pf, 'second prompt\n')
    const b = await compileSheet(spec({ provenance: { provider: 'test', promptFile: pf } }))
    expect(a.def.source?.promptHash).toMatch(/^[0-9a-f]{64}$/)
    expect(b.def.source?.promptHash).not.toBe(a.def.source?.promptHash)
  })
  it('rejects a typed promptHash and a typed referenceHashes', async () => {
    await expect(compileSheet(spec({ provenance: { provider: 'x', promptHash: 'see some doc' } })))
      .rejects.toThrow(/computed from provenance.promptFile/)
    await expect(compileSheet(spec({ provenance: { provider: 'x', referenceHashes: ['abc'] } })))
      .rejects.toThrow(/computed from the approved anchor/)
  })
  it('holds approvedSource to the pool and to the compile input itself', async () => {
    // Lane A's custody distinction, carried forward: approvedSource is a human-approved editable
    // source that IS the compile input — a different path, or one outside art/approved/, is a lie.
    await expect(compileSheet(spec({ provenance: { provider: 'x', approvedSource: srcPng } })))
      .rejects.toThrow(/must live under art\/approved/)
    await expect(compileSheet(spec({ provenance: { provider: 'x', approvedSource: 'art/approved/bardo_hero_alpha_v1.png' } })))
      .rejects.toThrow(/must name the retained compile input/)
    await expect(compileSheet(spec({ provenance: { provider: 'x', approvedReference: srcPng } })))
      .rejects.toThrow(/must live under art\/approved/)
  })

  it('derives referenceHashes from the approved master content', async () => {
    const a = await compileSheet(spec({ provenance: { provider: 'x', approvedReference: 'art/approved/bardo_hero_alpha_v1.png' } }))
    const receipt = JSON.parse(readFileSync('art/approved/bardo_hero_alpha_v1.approval.json', 'utf8'))
    expect(a.def.source?.referenceHashes).toEqual([receipt.sha256])
  })
})

describe('promotion writes both halves or neither', () => {
  it('creates the sidecar directory too, so a sidecar living elsewhere cannot half-promote', async () => {
    // The PNG's parent was created and the sidecar's was not, so a spec that parks its sidecar in a
    // different directory landed the image and then threw — the exact half-promoted state staging
    // exists to prevent.
    const png = join(dir, 'promote', 'sheets', 'x.png')
    const sidecar = join(dir, 'promote', 'meta', 'x.json')
    const specPath = join(dir, 'split-dest.json')
    writeFileSync(specPath, JSON.stringify(spec({ output: png, sidecar })))
    const r = spawnSync('pnpm', ['exec', 'tsx', 'tools/art.ts', 'compile', specPath], { encoding: 'utf8', timeout: 120000 })
    const out = String(r.stderr) + String(r.stdout)
    // ENOENT is the bug's signature: the PNG lands, then the sidecar copy dies on a missing parent.
    expect(out, out).not.toMatch(/ENOENT/)
    expect(out, out).toMatch(/promoted ->/)
    expect(existsSync(png)).toBe(true)
    expect(existsSync(sidecar)).toBe(true)
  }, 130000)
})

describe('production promotion (CLI)', () => {
  it('an unapproved production compile fails and writes nothing to public/assets', () => {
    const specPath = join(dir, 'prod-spec.json')
    const dest = 'public/assets/sprites/tmp-test-unapproved.png'
    writeFileSync(specPath, JSON.stringify(spec({ output: dest, sidecar: dest.replace('.png', '.json') })))
    try {
      const r = spawnSync('pnpm', ['exec', 'tsx', 'tools/art.ts', 'compile', specPath], { encoding: 'utf8', timeout: 120000 })
      expect(r.status).not.toBe(0)
      expect(String(r.stderr) + String(r.stdout)).toMatch(/approvedReference|approval/)
      expect(existsSync(dest)).toBe(false)
      expect(existsSync(dest.replace('.png', '.json'))).toBe(false)
    } finally {
      rmSync(dest, { force: true })
      rmSync(dest.replace('.png', '.json'), { force: true })
    }
  })
})
