import { createRenderApp } from '@/render/app'
import { loadAtlas, loadFonts } from '@/render/atlas'
import { Presenter } from '@/render/presenter'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import type { World } from '@/sim/world'
import type { InputFrame } from '@/sim/input'
import { InputSystem } from '@/input'
import { Loop } from '@/loop'
import { AudioSystem } from '@/audio/audio'
import { playEventSfx } from '@/audio/sfxMap'
import { Metrics } from '@/sim/metrics'
import { DebugOverlay } from '@/debug/overlay'
import { installApi } from '@/debug/api'
import { makeBot, type BotName } from '@/sim/bots'
import { ARENA_COLS, ARENA_ROWS, TILE } from '@/sim/arena'

async function boot() {
  const q = new URLSearchParams(location.search)
  const seed = +(q.get('seed') ?? 1)
  const scenario = q.get('scenario') ?? 'full'
  const god = q.get('god') === '1'
  const debug = q.get('debug') === '1'
  const mute = q.get('mute') === '1'
  const botName = q.get('bot') as BotName | null

  const manifest = await (await fetch('/assets/manifest.json')).json() as Record<string, string[]>
  await loadFonts()
  const ra = await createRenderApp(document.getElementById('app')!, { w: ARENA_COLS * TILE, h: ARENA_ROWS * TILE })
  const atlas = await loadAtlas(manifest)
  const audio = new AudioSystem()
  audio.muted = mute
  audio.load(manifest.audio) // not awaited: the game starts silent-then-sound rather than waiting

  let world: World = createWorld(seed, scenario, { god })
  let metrics = new Metrics()
  const presenter = new Presenter(ra, atlas, world)
  presenter.particles.attachRenderer(ra.app.renderer)
  presenter.onEvent = ev => playEventSfx(audio, ev)
  const input = new InputSystem(ra)
  const overlay = new DebugOverlay(ra.layers.debug, ra.layers.hud)
  overlay.setVisible(debug)
  let bot: ((w: World) => InputFrame) | null = botName ? makeBot(botName) : null

  const reset = (s = seed, sc = scenario, opts: { god?: boolean } = { god }) => {
    world = createWorld(s, sc, opts)
    metrics = new Metrics()
    presenter.bindWorld(world)
    presenter.handleEvents([{ type: 'restart' }])
  }

  const tick = () => {
    const frame = bot ? bot(world) : input.sample(world)
    if (input.isDebugToggle()) overlay.toggle()
    stepWorld(world, frame)
    metrics.consume(world, world.events)
    presenter.handleEvents(world.events)
    world.events.length = 0
    if (world.wantsRestart) reset()
  }

  const loop = new Loop({
    tick,
    render: (alpha, dt) => { presenter.render(alpha, dt); overlay.update(world, loop); ra.renderFrame() },
    timeScale: () => world.timeScale,
  })

  installApi({
    getWorld: () => world,
    reset, tick,
    setOverride: f => { input.override = f },
    setBot: b => { bot = b },
    loop,
    get metrics() { return metrics },
    mute: m => { audio.muted = m ?? !audio.muted; return audio.muted },
    debug: v => { overlay.setVisible(v ?? !overlay.visible); return overlay.visible },
  })

  window.addEventListener('keydown', e => { if (e.code === 'F1') { e.preventDefault(); overlay.toggle() } })
  loop.start()
  presenter.hud.showBanner(scenario === 'full' ? 'BARDO' : scenario.toUpperCase(), 'WASD move · mouse aim · click attack · space dodge', 2.5)
}

boot().catch(err => { console.error(err); document.body.innerHTML = `<pre style="color:#f88;padding:16px">${String(err?.stack ?? err)}</pre>` })
