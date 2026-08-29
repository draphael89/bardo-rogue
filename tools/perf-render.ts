// Browser/Pixi profile driver. Starts from the real page and records both raw frame samples and
// Chrome CPU/allocation profiles. The simulation hash before/after proves presentation purity.
//
// Start `pnpm dev`, then:
//   pnpm perf:render -- --profile warden --frames 600 --out /tmp/render.json
import { writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

type Profile = 'warden' | 'dense'

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) =>
  arg.startsWith('--') ? [arg.slice(2), all[index + 1] ?? '1'] : []).filter(row => row.length))
const profile = (args.profile ?? 'warden') as Profile
const frames = +(args.frames ?? 600)
const warmups = +(args.warmups ?? 120)
const url = args.url ?? 'http://localhost:5173'

function usage(message: string): never {
  console.error(`perf-render: ${message}`)
  process.exit(2)
}

if (!['warden', 'dense'].includes(profile)) usage(`unknown --profile ${profile}`)
if (!Number.isInteger(frames) || frames < 20) usage('--frames must be an integer >= 20')
if (!Number.isInteger(warmups) || warmups < 0) usage('--warmups must be a non-negative integer')

const browser = await chromium.launch({ headless: args.headed !== '1' })
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(`${url}/?scenario=${profile === 'warden' ? 'boss' : 'empty'}&seed=1&mute=1&save=off&god=1`)
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30000 })
  const cdp = await context.newCDPSession(page)

  const setup = await page.evaluate((kind) => {
    const game = (window as any).__game
    game.pause(true)
    game.loop.stop()
    game.bot(kind === 'warden' ? 'idle' : null)
    if (kind === 'dense') {
      const world = game.world
      for (let i = 0; i < 32; i++) world.spawnEnemy('charger', 48 + (i % 8) * 38, 44 + Math.floor(i / 8) * 34)
      for (let i = 0; i < 64; i++) world.fireProjectile(80 + (i % 16) * 18, 64 + Math.floor(i / 16) * 30, 0, 0, 2, 10000, 0, 1, 0, 'bolt', 'caster')
      world.events.length = 0
      game.presenter.handleEvents([])
    }
    const gl = game.presenter.ra.app.renderer.gl
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return {
      hash: game.hash(),
      enemies: game.world.enemies.filter((enemy: any) => enemy.active).length,
      projectiles: game.world.projectiles.filter((projectile: any) => projectile.active).length,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
      userAgent: navigator.userAgent,
      dpr: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
    }
  }, profile)

  const runFrames = async (count: number, advance: boolean) => page.evaluate(async ({ count, advance }) => {
    const game = (window as any).__game
    const workMs: number[] = []
    const intervalsMs: number[] = []
    let previous = performance.now()
    for (let i = 0; i < count; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const frameStart = performance.now()
      intervalsMs.push(frameStart - previous)
      previous = frameStart
      if (advance) game.step(1)
      const workStart = performance.now()
      game.presenter.render(1, 1 / 60)
      game.presenter.ra.renderFrame()
      workMs.push(performance.now() - workStart)
    }
    return { workMs, intervalsMs, hash: game.hash(), state: game.state() }
  }, { count, advance })

  await runFrames(warmups, profile === 'warden')
  const hashBefore = await page.evaluate(() => (window as any).__game.hash())
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 })
  await cdp.send('Profiler.start')
  const measured = await runFrames(frames, profile === 'warden')
  const cpu = await cdp.send('Profiler.stop')
  const heap = await cdp.send('HeapProfiler.stopSampling')

  const summarize = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b)
    const q = (p: number) => ordered[Math.max(0, Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1))]!
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: ordered[ordered.length - 1], mean, cv: Math.sqrt(variance) / mean }
  }
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => {
    const resource = entry as PerformanceResourceTiming
    return { name: resource.name, duration: resource.duration, transferSize: resource.transferSize, decodedBodySize: resource.decodedBodySize }
  }))
  const resourceTotals = {
    count: resources.length,
    transferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
    decodedBytes: resources.reduce((sum, resource) => sum + resource.decodedBodySize, 0),
    slowest: [...resources].sort((a, b) => b.duration - a.duration).slice(0, 10),
  }
  if (args.resources) writeFileSync(args.resources, JSON.stringify(resources, null, 2) + '\n')
  const state = measured.state as any
  const result = {
    scenario: `render:${profile}`,
    profile,
    warmups,
    frames,
    environment: setup,
    workMs: measured.workMs,
    intervalsMs: measured.intervalsMs,
    summary: { workMs: summarize(measured.workMs), intervalsMs: summarize(measured.intervalsMs) },
    golden: {
      hashBefore, hashAfter: measured.hash, renderOnly: profile === 'dense',
      state: { tick: state.tick, room: state.room, player: state.player, enemies: state.enemies.length, bolts: state.bolts },
    },
    resources: resourceTotals,
  }
  if (profile === 'dense' && hashBefore !== measured.hash) throw new Error(`render mutated simulation hash: ${hashBefore} -> ${measured.hash}`)
  if (args.cpu) writeFileSync(args.cpu, JSON.stringify(cpu.profile))
  if (args.heap) writeFileSync(args.heap, JSON.stringify(heap.profile))
  const json = JSON.stringify(result, null, 2) + '\n'
  if (args.out) writeFileSync(args.out, json)
  process.stdout.write(json)
} finally {
  await browser.close()
}
