// Provider contract tests.
//
// The first shipped adapter pointed at endpoints that 404 and passed a float where the schema wants an
// integer — and stayed green, because nothing pinned the request shape. These tests are that pin. They
// spend no money: `requests()` is pure request-building, and `generate()` runs against a mocked fetch.
// The pinned values come from https://api.pixellab.ai/v2/openapi.json (fetched 2026-08-28) and Retro
// Diffusion's published API doc.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import {
  buildPrompt, decodeImages, generate, isPng, parseProvider, requests, resolveReferences,
  type GenerateSpec,
} from '../../tools/art/generate'

let dir: string
let refPng: Buffer

const spec = (over: Partial<GenerateSpec> = {}): GenerateSpec => ({
  subject: 'a test subject',
  size: 32,
  kind: 'character',
  palette: ['mortar', 'iron', 'ironHi', 'bone'],
  count: 3,
  ...over,
})

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bardo-gen-'))
  refPng = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } } }).png().toBuffer()
  writeFileSync(join(dir, 'ref-b.png'), refPng)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.unstubAllGlobals())

describe('parseProvider', () => {
  it('accepts the two known providers and nothing else', () => {
    expect(parseProvider('pixellab')).toBe('pixellab')
    expect(parseProvider('retrodiffusion')).toBe('retrodiffusion')
    expect(() => parseProvider('pixellab ')).toThrow(/unknown provider/)
    expect(() => parseProvider('midjourney')).toThrow(/unknown provider/)
  })
})

describe('resolveReferences', () => {
  it('errors on a named file that does not exist, rather than silently generating unconditioned', () => {
    expect(() => resolveReferences([join(dir, 'nope.png')])).toThrow(/does not exist/)
  })
  it('errors on a directory that resolves no PNGs', () => {
    const empty = join(dir, 'empty'); mkdirSync(empty, { recursive: true })
    expect(() => resolveReferences([empty])).toThrow(/no PNGs/)
  })
  it('orders lexicographically by path, not by checkout-dependent mtime', () => {
    const pool = join(dir, 'pool'); mkdirSync(pool, { recursive: true })
    // Write in reverse name order so mtime order and name order disagree.
    writeFileSync(join(pool, 'hero-v2.png'), refPng)
    writeFileSync(join(pool, 'hero-v1.png'), refPng)
    expect(resolveReferences([pool]).map(r => r.file)).toEqual([join(pool, 'hero-v1.png'), join(pool, 'hero-v2.png')])
    // Capped: the lexicographically LAST files win — the newest versions under the -vN convention.
    expect(resolveReferences([pool], 1).map(r => r.file)).toEqual([join(pool, 'hero-v2.png')])
  })
  it('hashes the file content', () => {
    const [r] = resolveReferences([join(dir, 'ref-b.png')])
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.b64).toBe(refPng.toString('base64'))
  })
})

describe('pixellab requests', () => {
  it('pixflux: correct endpoint, no style image, palette lock present', async () => {
    const reqs = await requests('pixellab', spec(), 'tok')
    expect(reqs).toHaveLength(3)
    for (const r of reqs) {
      expect(r.url).toBe('https://api.pixellab.ai/v2/create-image-pixflux')
      const b = r.body as Record<string, unknown>
      expect(b.image_size).toEqual({ width: 32, height: 32 })
      expect(b.color_image).toMatchObject({ type: 'base64' })
      expect(b.style_image).toBeUndefined()
      expect(b.description).toContain('a test subject')
    }
    expect(reqs[0].headers.Authorization).toBe('Bearer tok')
  })
  it('bitforge: selected by a reference, integer style_strength, exactly one style image', async () => {
    const reqs = await requests('pixellab', spec({ references: [join(dir, 'ref-b.png')] }), 'tok')
    for (const r of reqs) {
      expect(r.url).toBe('https://api.pixellab.ai/v2/create-image-bitforge')
      const b = r.body as { style_strength: number; style_image: { type: string; base64: string } }
      expect(Number.isInteger(b.style_strength)).toBe(true)
      expect(b.style_strength).toBeGreaterThanOrEqual(1)
      expect(b.style_strength).toBeLessThanOrEqual(100)
      expect(b.style_image.base64).toBe(refPng.toString('base64'))
    }
  })
  it('rejects more than one style reference instead of picking one silently', async () => {
    const pool = join(dir, 'pool2'); mkdirSync(pool, { recursive: true })
    writeFileSync(join(pool, 'a.png'), refPng)
    writeFileSync(join(pool, 'b.png'), refPng)
    await expect(requests('pixellab', spec({ references: [pool] }), 'tok')).rejects.toThrow(/exactly one/)
  })
  it('increments the seed per candidate so candidates differ', async () => {
    const reqs = await requests('pixellab', spec({ seed: 7 }), 'tok')
    expect(reqs.map(r => (r.body as { seed: number }).seed)).toEqual([7, 8, 9])
  })
  it('enum values match the published schema', async () => {
    const [r] = await requests('pixellab', spec(), 'tok')
    const b = r.body as Record<string, string>
    expect(['single color black outline', 'single color outline', 'selective outline', 'lineless']).toContain(b.outline)
    expect(['flat shading', 'basic shading', 'medium shading', 'detailed shading', 'highly detailed shading']).toContain(b.shading)
    expect(['low detail', 'medium detail', 'highly detailed']).toContain(b.detail)
    expect(['side', 'low top-down', 'high top-down']).toContain(b.view)
  })
})

describe('retrodiffusion requests', () => {
  it('one batched request carrying num_images and the palette lock', async () => {
    const reqs = await requests('retrodiffusion', spec({ seed: 5 }), 'tok')
    expect(reqs).toHaveLength(1)
    expect(reqs[0].url).toBe('https://api.retrodiffusion.ai/v1/inferences')
    const b = reqs[0].body as Record<string, unknown>
    expect(b.num_images).toBe(3)
    expect(b.seed).toBe(5)
    expect(typeof b.input_palette).toBe('string')
    expect(reqs[0].headers['X-RD-Token']).toBe('tok')
  })
})

describe('prompt assembly', () => {
  it('quotes the exact ramp hexes and the forbidden list', () => {
    const p = buildPrompt(spec())
    expect(p).toContain('mortar #')
    expect(p).toContain('Never:')
    expect(p).toContain('no anti-aliasing')
  })
})

describe('response handling', () => {
  it('decodes the documented shapes', () => {
    expect(decodeImages({ base64_images: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(decodeImages({ image: { type: 'base64', base64: 'xyz' } })).toEqual(['xyz'])
    expect(decodeImages({ image: 'raw' })).toEqual(['raw'])
    expect(decodeImages({})).toEqual([])
  })
  it('recognises a PNG and rejects junk', () => {
    expect(isPng(refPng)).toBe(true)
    expect(isPng(Buffer.from('<html>error</html>'))).toBe(false)
    expect(isPng(Buffer.alloc(0))).toBe(false)
  })
})

describe('generate (mocked fetch)', () => {
  it('writes content-hash-named candidates and a manifest, only into outDir', async () => {
    vi.stubEnv('PIXELLAB_SECRET', 'test-token')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      image: { type: 'base64', base64: refPng.toString('base64') },
      usage: { type: 'usd', usd: 0.01 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = join(dir, 'candidates')
    const res = await generate('pixellab', spec({ count: 2 }), out)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every((c: unknown[]) => String(c[0]).includes('/create-image-'))).toBe(true)
    // Identical mocked payloads dedupe to one content-hash name — a rerun cannot clobber a different batch.
    const files = readdirSync(out)
    expect(files.filter(f => /^pixellab-[0-9a-f]{16}-[0-9a-f]{12}\.png$/.test(f))).toHaveLength(1)
    const manifest = JSON.parse(readFileSync(res.manifest, 'utf8'))
    expect(manifest.provider).toBe('pixellab')
    expect(manifest.candidates[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.usage).toHaveLength(2)
    expect(res.files.every(f => f.startsWith(out))).toBe(true)
  })
  it('refuses a payload that is not a PNG', async () => {
    vi.stubEnv('PIXELLAB_SECRET', 'test-token')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      image: { type: 'base64', base64: Buffer.from('<html>oops</html>').toString('base64') },
    }), { status: 200 })))
    await expect(generate('pixellab', spec({ count: 1 }), join(dir, 'c2'))).rejects.toThrow(/not a PNG/)
  })
  it('preserves paid candidates already received when a later batch request fails', async () => {
    // Lane A's guarantee, carried forward: candidates are written to disk AS THEY ARRIVE, so a 429 on
    // request two of three keeps the image request one paid for, and the error says so.
    vi.stubEnv('PIXELLAB_SECRET', 'test-token')
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) return new Response(JSON.stringify({ image: { type: 'base64', base64: refPng.toString('base64') } }), { status: 200 })
      return new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })
    }))
    const out = join(dir, 'retention')
    await expect(generate('pixellab', spec({ count: 3 }), out)).rejects.toThrow(/saved 1 candidate/)
    const files = readdirSync(out)
    expect(files.some(f => /^pixellab-[0-9a-f]{16}-[0-9a-f]{12}\.png$/.test(f))).toBe(true)
    expect(files.some(f => f.endsWith('.prompt.txt'))).toBe(true)     // written before the first paid call
    expect(files.some(f => f.endsWith('.manifest.json'))).toBe(true)  // failure path still records the run
  })

  it('surfaces a non-2xx as an error without retrying', async () => {
    vi.stubEnv('PIXELLAB_SECRET', 'test-token')
    const fetchMock = vi.fn(async () => new Response('quota', { status: 402, statusText: 'Payment Required' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generate('pixellab', spec({ count: 3 }), join(dir, 'c3'))).rejects.toThrow(/402/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // failed once, no retry, no further spend
  })
})
