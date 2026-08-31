// Custody properties of the PixelLab import lane, on a synthetic export so the suite never touches
// the network or the account.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { contentHash, assembleAnimation, importCharacter, validateArchiveEntries } from '../../tools/art/pixellab'

let dir: string, unpack: string, manifestPath: string

/** A minimal 3.1-shaped export: one state, two rotations, one 3-frame animation of 8x10 cells. */
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bardo-pixellab-'))
  unpack = join(dir, 'unpacked')
  const anim = join(unpack, 'Idle', 'animations', 'walk', 'south')
  mkdirSync(anim, { recursive: true })
  mkdirSync(join(unpack, 'Idle', 'rotations'), { recursive: true })
  const cell = async (w: number, h: number, r: number) =>
    sharp({ create: { width: w, height: h, channels: 4, background: { r, g: 20, b: 30, alpha: 255 } } }).png().toBuffer()
  for (let i = 0; i < 3; i++) writeFileSync(join(anim, `frame_${String(i).padStart(3, '0')}.png`), await cell(8, 10, 40 + i))
  writeFileSync(join(unpack, 'Idle', 'rotations', 'south.png'), await cell(8, 10, 90))
  writeFileSync(join(unpack, 'metadata.json'), JSON.stringify({ export_date: 'first' }))

  manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    version: 1, kind: 'import', characterId: 'test', states: [{
      id: 'test', name: 'Idle', folder: 'Idle', rotations: ['south'], animations: { walk: { south: 3 } },
    }],
  }))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('contentHash', () => {
  it('ignores metadata.json, which is the only member that changes between downloads', () => {
    // Measured against the live account: two downloads of an unchanged character are the same 179331
    // bytes with DIFFERENT archive hashes, because metadata.json stamps a fresh export_date and all
    // 89 png members are byte-identical. Hashing the archive therefore cannot answer "same pixels?".
    const before = contentHash(unpack)
    writeFileSync(join(unpack, 'metadata.json'), JSON.stringify({ export_date: 'second, different' }))
    expect(contentHash(unpack), 'a new export_date must not change the content identity').toBe(before)
  })

  it('changes when a single pixel of a single frame changes', async () => {
    const before = contentHash(unpack)
    const f = join(unpack, 'Idle', 'animations', 'walk', 'south', 'frame_001.png')
    writeFileSync(f, await sharp({ create: { width: 8, height: 10, channels: 4, background: { r: 200, g: 20, b: 30, alpha: 255 } } }).png().toBuffer())
    expect(contentHash(unpack)).not.toBe(before)
  })
})

describe('provider import trust boundary', () => {
  it('rejects ids before they can select an output or removal path', async () => {
    await expect(importCharacter('../outside', dir)).rejects.toThrow(/expected UUID/)
  })

  it('rejects traversal, absolute paths, duplicate paths and links before extraction', () => {
    const file = (name: string) => ({ name, type: 'file' as const, uncompressedBytes: 1 })
    expect(() => validateArchiveEntries([file('../outside.png')])).toThrow(/unsafe archive path/)
    expect(() => validateArchiveEntries([file('/outside.png')])).toThrow(/unsafe archive path/)
    expect(() => validateArchiveEntries([file('Idle\\outside.png')])).toThrow(/unsafe archive path/)
    expect(() => validateArchiveEntries([file('Idle/frame.png'), file('idle/frame.png')])).toThrow(/duplicate archive path/)
    expect(() => validateArchiveEntries([{ name: 'Idle/link', type: 'other', uncompressedBytes: 1 }])).toThrow(/not a regular file or directory/)
  })

  it('does not replace a known-good import with an incomplete provider export', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const existing = join(dir, id)
    mkdirSync(join(existing, 'unpacked'), { recursive: true })
    writeFileSync(join(existing, 'unpacked', 'kept.txt'), 'known good')
    writeFileSync(join(existing, 'manifest.json'), 'known good manifest')

    const incomplete = join(dir, 'incomplete')
    mkdirSync(incomplete)
    writeFileSync(join(incomplete, 'metadata.json'), JSON.stringify({
      group_id: id,
      export_version: '3.1',
      states: [{
        folder: 'Idle',
        character: { id, name: 'Idle' },
        frames: { rotations: { south: 'Idle/missing.png' }, animations: {} },
      }],
    }))
    const zip = join(dir, 'incomplete.zip')
    execFileSync('zip', ['-q', zip, 'metadata.json'], { cwd: incomplete })

    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(readFileSync(zip)))
    const token = process.env['PIXELLAB_SECRET']
    process.env['PIXELLAB_SECRET'] = 'test-only'
    try {
      await expect(importCharacter(id, dir)).rejects.toThrow(/archive is incomplete/)
      expect(readFileSync(join(existing, 'unpacked', 'kept.txt'), 'utf8')).toBe('known good')
      expect(readFileSync(join(existing, 'manifest.json'), 'utf8')).toBe('known good manifest')
      expect(readdirSync(existing).some(name => name.startsWith('.import-'))).toBe(false)
    } finally {
      fetch.mockRestore()
      if (token === undefined) delete process.env['PIXELLAB_SECRET']
      else process.env['PIXELLAB_SECRET'] = token
    }
  })
})

describe('assembleAnimation', () => {
  it('pads non-square provider frames to a square cell', async () => {
    // v3 returns a TALLER canvas than it was given when the pose needs the room — 128x160 for a
    // raised greatsword, measured. The compiler's contract is one SQUARE cell, so a naive layout
    // mis-slices every frame after the first.
    const r = await assembleAnimation({
      manifestPath, state: 'Idle', animation: 'walk', direction: 'south', clip: 'run', cols: 3,
      outDir: join(dir, 'out'),
    })
    expect(r.cell, 'cell is the larger of width/height').toBe(10)
    expect([r.width, r.height]).toEqual([30, 10])
    expect(r.frames).toEqual(['run0', 'run1', 'run2'])
    const meta = await sharp(readFileSync(r.master)).metadata()
    expect([meta.width, meta.height]).toEqual([30, 10])
  })

  it('refuses a direction the manifest does not have, instead of assembling a short sheet', async () => {
    await expect(assembleAnimation({
      manifestPath, state: 'Idle', animation: 'walk', direction: 'north', clip: 'run', outDir: join(dir, 'out'),
    })).rejects.toThrow(/no animation "walk" in direction "north"/)
  })

  it('names the states it does have when asked for one it does not', async () => {
    await expect(assembleAnimation({
      manifestPath, state: 'Armed', animation: 'walk', direction: 'south', clip: 'run', outDir: join(dir, 'out'),
    })).rejects.toThrow(/have: Idle/)
  })
})
