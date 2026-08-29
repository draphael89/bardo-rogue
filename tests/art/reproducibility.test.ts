// Checked-in assets must rebuild from their specs, byte for byte.
//
// Neither remediation lane had this: nothing proved that public/assets actually corresponds to
// art/specs + art/approved, so a hand-edited sheet or a stale sidecar could ship undetected. Each
// spec compiles into a temp directory here and the result is hashed against what is committed —
// the compiler is deterministic (fixed sharp encode options, no clocks, no randomness), so any
// mismatch is drift, not noise.
import { describe, it, expect, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compileSheet, type CompileSpec } from '../../tools/art/compile'

const SPECS = ['hero', 'hero-north', 'hero-south', 'hero-north-roll', 'hero-south-roll', 'brute']
const dir = mkdtempSync(join(tmpdir(), 'bardo-repro-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

describe('checked-in assets rebuild from their specs', () => {
  for (const name of SPECS) {
    it(`${name}: temp recompile matches the committed PNG and sidecar`, async () => {
      const spec = JSON.parse(readFileSync(`art/specs/${name}.json`, 'utf8')) as CompileSpec
      const committedPng = spec.output
      const committedSidecar = spec.sidecar ?? committedPng.replace(/\.png$/, '.json')
      spec.output = join(dir, `${name}.png`)
      spec.sidecar = undefined
      const { def } = await compileSheet(spec, `art/specs/${name}.json`)
      expect(sha(spec.output), `${name} PNG drifted from its spec`).toBe(sha(committedPng))
      // The sidecar is compared as parsed JSON (the committed file is the compiler's own emission,
      // so this is effectively byte-equality with a readable diff on failure).
      expect(def, `${name} sidecar drifted from its spec`).toEqual(JSON.parse(readFileSync(committedSidecar, 'utf8')))
    }, 30000)
  }
})
