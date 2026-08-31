import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { rejectionReceiptPath, verifyRejection, writeRejection } from '../../tools/art/reject'

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

async function fixture(): Promise<{ dir: string; png: string; manifest: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'bardo-reject-'))
  dirs.push(dir)
  const png = join(dir, 'candidate.png')
  const manifest = join(dir, 'run.manifest.json')
  await sharp({ create: { width: 8, height: 8, channels: 4, background: '#762E40' } }).png().toFile(png)
  writeFileSync(manifest, JSON.stringify({ provider: 'test', promptHash: 'abc' }))
  return { dir, png, manifest }
}

describe('rejection receipts', () => {
  it('keeps every committed rejection paired with a valid receipt', () => {
    const files = readdirSync('art/rejected')
    const images = files.filter(f => f.endsWith('.png')).map(f => f.replace(/\.png$/, '')).sort()
    const receipts = files.filter(f => f.endsWith('.rejection.json')).map(f => f.replace(/\.rejection\.json$/, '')).sort()
    expect(receipts).toEqual(images)
    for (const receipt of files.filter(f => f.endsWith('.rejection.json'))) verifyRejection(join('art/rejected', receipt))
  })

  it('preserves candidate, reason, and manifest behind verified hashes', async () => {
    const { dir, png, manifest } = await fixture()
    const out = writeRejection(png, 'Gold occupies the whole hull instead of one bounce pixel.', 'critic', manifest, join(dir, 'rejected'))
    expect(out.data.reason).toMatch(/whole hull/)
    expect(verifyRejection(out.receipt)).toEqual(out.data)
    expect(readFileSync(out.image).equals(readFileSync(png))).toBe(true)
  })

  it('refuses vague reasons and detects a changed rejected image', async () => {
    const { dir, png } = await fixture()
    expect(() => writeRejection(png, 'bad', 'critic', undefined, join(dir, 'rejected'))).toThrow(/specific/)
    const out = writeRejection(png, 'Silhouette collapses into an unreadable square.', 'critic', undefined, join(dir, 'rejected'))
    writeFileSync(out.image, Buffer.from('changed'))
    expect(() => verifyRejection(out.receipt)).toThrow(/no longer matches/)
  })

  it('derives a distinct receipt path without overwriting the image', () => {
    expect(rejectionReceiptPath('art/rejected/x.png')).toBe('art/rejected/x.rejection.json')
  })
})
