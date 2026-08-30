// Browser/Pixi profile driver. Budget timings run without profiler overhead; optional CPU/heap
// attribution uses a separate pass. Fixed-frame hashes and page errors gate every result.
//
// Start `pnpm dev`, then:
//   pnpm perf:render -- --profile warden --frames 600 --out /tmp/render.json
import { writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import type { Presenter } from '../src/render/presenter'
import type { SimEvent } from '../src/sim/events'
import type { World } from '../src/sim/world'

type Profile = 'warden' | 'dense'

interface RenderState {
  tick: number
  room: Record<string, unknown>
  player: Record<string, unknown>
  enemies: readonly unknown[]
  bolts: number
}

interface BrowserGame {
  world: World
  presenter: Presenter
  loop: { stop(): void }
  pause(value: boolean): boolean
  bot(name: 'idle' | null): void
  reset(): void
  hash(): number
  step(count: number): void
  state(): RenderState
}

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
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`)
  })
  await page.goto(`${url}/?scenario=${profile === 'warden' ? 'boss' : 'empty'}&seed=1&mute=1&save=off&god=1`)
  const cdp = await context.newCDPSession(page)

  const setupProfile = async () => {
    await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30000 })
    return page.evaluate((kind) => {
      const game = (window as unknown as { __game: BrowserGame }).__game
      game.pause(true)
      game.loop.stop()
      game.bot(kind === 'warden' ? 'idle' : null)
      game.reset()
      if (kind === 'dense') {
        const world = game.world
        for (let i = 0; i < 32; i++) world.spawnEnemy('charger', 48 + (i % 8) * 38, 44 + Math.floor(i / 8) * 34)
        for (let i = 0; i < 64; i++) world.fireProjectile(80 + (i % 16) * 18, 64 + Math.floor(i / 16) * 30, 0, 0, 2, 10000, 0, 1, 0, 'bolt', 'caster')
        world.events.length = 0
        game.presenter.handleEvents([])
      }
      const renderer = game.presenter.ra.app.renderer as unknown as { gl?: WebGLRenderingContext }
      const gl = renderer.gl
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return {
        hash: game.hash(),
        enemies: game.world.enemies.filter(enemy => enemy.active).length,
        projectiles: game.world.projectiles.filter(projectile => projectile.active).length,
        renderer: gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
        vendor: gl && ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
        userAgent: navigator.userAgent,
        dpr: devicePixelRatio,
        viewport: [innerWidth, innerHeight],
      }
    }, profile)
  }

  const setup = await setupProfile()

  const runFrames = async (count: number, advance: boolean) => page.evaluate(async ({ count, advance }) => {
    const game = (window as unknown as { __game: BrowserGame }).__game
    const workMs: number[] = []
    const eventMs: number[] = []
    const renderMs: number[] = []
    const intervalsMs: number[] = []
    let previous = performance.now()
    let currentEventMs = 0
    const handleEvents = game.presenter.handleEvents
    game.presenter.handleEvents = (events: readonly SimEvent[]) => {
      const start = performance.now()
      handleEvents.call(game.presenter, events)
      currentEventMs += performance.now() - start
    }
    try {
      for (let i = 0; i < count; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const frameStart = performance.now()
        intervalsMs.push(frameStart - previous)
        previous = frameStart
        currentEventMs = 0
        if (advance) game.step(1)
        const renderStart = performance.now()
        game.presenter.render(1, 1 / 60)
        game.presenter.ra.renderFrame()
        const currentRenderMs = performance.now() - renderStart
        eventMs.push(currentEventMs)
        renderMs.push(currentRenderMs)
        workMs.push(currentEventMs + currentRenderMs)
      }
    } finally {
      game.presenter.handleEvents = handleEvents
    }
    return { workMs, eventMs, renderMs, intervalsMs, hash: game.hash(), state: game.state() }
  }, { count, advance })

  await runFrames(warmups, profile === 'warden')
  const hashAfterWarmup = await page.evaluate(() => (window as unknown as { __game: BrowserGame }).__game.hash())
  const measured = await runFrames(frames, profile === 'warden')
  if (profile === 'dense' && (setup.hash !== hashAfterWarmup || hashAfterWarmup !== measured.hash)) {
    throw new Error(`render mutated simulation hash: ${setup.hash} -> ${hashAfterWarmup} -> ${measured.hash}`)
  }
  const repeatedHash = profile === 'warden' ? await page.evaluate((ticks) => {
    const game = (window as unknown as { __game: BrowserGame }).__game
    game.reset()
    game.pause(true)
    game.loop.stop()
    game.bot('idle')
    game.step(ticks)
    return game.hash()
  }, warmups + frames) : measured.hash
  if (profile === 'warden' && repeatedHash !== measured.hash) {
    throw new Error(`non-deterministic Warden hash: ${measured.hash} != ${repeatedHash}`)
  }

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

  let cpuJson: string | null = null
  let heapJson: string | null = null
  if (args.cpu || args.heap) {
    await page.reload()
    await setupProfile()
    await runFrames(warmups, profile === 'warden')
    if (args.cpu) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
      await cdp.send('Profiler.start')
    }
    if (args.heap) {
      await cdp.send('HeapProfiler.enable')
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 })
    }
    await runFrames(frames, profile === 'warden')
    if (args.cpu) cpuJson = JSON.stringify((await cdp.send('Profiler.stop')).profile)
    if (args.heap) heapJson = JSON.stringify((await cdp.send('HeapProfiler.stopSampling')).profile)
  }

  const state = measured.state
  const result = {
    scenario: `render:${profile}`,
    profile,
    warmups,
    frames,
    environment: setup,
    workMs: measured.workMs,
    eventMs: measured.eventMs,
    renderMs: measured.renderMs,
    intervalsMs: measured.intervalsMs,
    summary: {
      workMs: summarize(measured.workMs),
      eventMs: summarize(measured.eventMs),
      renderMs: summarize(measured.renderMs),
      intervalsMs: summarize(measured.intervalsMs),
    },
    golden: {
      hashStart: setup.hash,
      hashAfterWarmup,
      hashAfter: measured.hash,
      repeatedHash,
      renderOnly: profile === 'dense',
      state: { tick: state.tick, room: state.room, player: state.player, enemies: state.enemies.length, bolts: state.bolts },
    },
    resources: resourceTotals,
  }
  await page.waitForTimeout(0)
  if (pageErrors.length) throw new Error(`render profile reported page errors:\n${pageErrors.join('\n')}`)
  if (args.resources) writeFileSync(args.resources, JSON.stringify(resources, null, 2) + '\n')
  if (args.cpu) writeFileSync(args.cpu, cpuJson!)
  if (args.heap) writeFileSync(args.heap, heapJson!)
  const json = JSON.stringify(result, null, 2) + '\n'
  if (args.out) writeFileSync(args.out, json)
  process.stdout.write(json)
} finally {
  await browser.close()
}
