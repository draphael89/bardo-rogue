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
import { decodeReplay, isEncodedReplay, quantizeFrame, replayToJson, type Replay, type EncodedReplay } from '@/sim/replay'
import { Recorder } from '@/input/recorder'
import { tuning } from '@/tuning'
import { Text } from 'pixi.js'

async function boot() {
  const q = new URLSearchParams(location.search)
  const seed = +(q.get('seed') ?? 1)
  const scenario = q.get('scenario') ?? 'full'
  const god = q.get('god') === '1'
  const debug = q.get('debug') === '1'
  const mute = q.get('mute') === '1'
  const botName = q.get('bot') as BotName | null

  // Widen the render target to the window's aspect before anything reads it, so the room is not
  // letterboxed into the middle third of a wide monitor. HEIGHT NEVER CHANGES: sprite scale, the
  // 16px grid and every tuned distance stay exactly as authored; only how much void you see to the
  // left and right moves. Snapped to 16 so the tile grid still lands on whole tiles, and floored at
  // 480 so the HUD never has less room than it was laid out for.
  // A 16:9 window computes to exactly 480, and tools/shot.ts opens a 1920x1080 viewport, so every
  // pinned evidence crop and every gauntlet protocol keeps its coordinates. `?view=480` forces it.
  const viewOverride = +(q.get('view') ?? 0)
  if (viewOverride >= 480) tuning.view.width = Math.round(viewOverride / 16) * 16
  else {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight)
    const want = Math.round((tuning.view.height * aspect) / 16) * 16
    tuning.view.width = Math.max(480, Math.min(768, want))
  }

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
  const recorder = new Recorder()
  let replayFrames: InputFrame[] | null = null   // while set, these replace live/bot input
  let replayIdx = 0
  // R restarts whatever is currently running (not the URL scenario), so replays and __game.reset() restart correctly
  let cur = { seed, scenario, god }

  const reset = (s = cur.seed, sc = cur.scenario, opts: { god?: boolean } = { god: cur.god }) => {
    cur = { seed: s, scenario: sc, god: !!opts.god }
    world = createWorld(s, sc, opts)
    metrics = new Metrics()
    replayFrames = null
    if (recorder.recording) { recorder.stop(); console.log('[replay] recording stopped by restart') }
    presenter.bindWorld(world)
    presenter.handleEvents([{ type: 'restart' }])
  }

  const tick = () => {
    // always sample live input, even when a bot or replay drives the sim, so latched presses do not pile up
    const live = input.sample(world)
    let frame: InputFrame
    if (replayFrames) {
      frame = replayFrames[replayIdx++]
      if (replayIdx >= replayFrames.length) { replayFrames = null; console.log('[replay] finished; back to live input') }
    } else frame = quantizeFrame(bot ? bot(world) : live)
    recorder.capture(frame)
    stepWorld(world, frame)
    metrics.consume(world, world.events)
    presenter.handleEvents(world.events)
    world.events.length = 0
    if (world.wantsRestart) {
      // reset() clears replayFrames; a restart *inside* a replay keeps playing, matching runReplay()
      const frames = replayFrames, idx = replayIdx
      reset()
      replayFrames = frames; replayIdx = idx
    }
  }

  const record = (on = !recorder.recording) => {
    if (on && !recorder.recording) { reset(); recorder.start(cur.seed, cur.scenario, cur.god); console.log('[replay] recording (fresh run)') }
    else if (!on && recorder.recording) stopRecord()
    return recorder.recording
  }
  const stopRecord = () => {
    const r = recorder.stop()
    console.log(`[replay] ${r.frames.length} frames; suggested file replays/${recorder.suggestedName(r)}`)
    console.log(replayToJson(r))
    return r
  }
  const replay = (r: Replay | EncodedReplay) => {
    const rep = isEncodedReplay(r) ? decodeReplay(r) : r
    reset(rep.seed, rep.scenario, { god: rep.god })
    replayFrames = rep.frames.length ? rep.frames : null
    replayIdx = 0
  }

  const recText = new Text({ text: '', style: { fontFamily: 'Kenney Pixel', fontSize: 16, fill: 0xff5050 }, resolution: 1 })
  recText.anchor.set(0.5, 0); recText.position.set(tuning.view.width / 2, 4)
  ra.layers.hud.addChild(recText)
  const updateRecText = () => {
    recText.text = recorder.recording ? 'REC' : replayFrames ? 'REPLAY' : ''
    recText.visible = !!recText.text && (replayFrames ? true : Math.floor(performance.now() / 500) % 2 === 0)
  }

  const loop = new Loop({
    tick,
    render: (alpha, dt) => { presenter.render(alpha, dt); overlay.update(world, loop); updateRecText(); ra.renderFrame() },
    timeScale: () => world.timeScale,
  })

  installApi({
    getWorld: () => world,
    reset, tick,
    setOverride: f => { input.override = f },
    setBot: b => { bot = b },
    loop,
    presenter,
    get metrics() { return metrics },
    mute: m => { audio.muted = m ?? !audio.muted; return audio.muted },
    debug: v => { overlay.setVisible(v ?? !overlay.visible); return overlay.visible },
    record, stopRecord, replay,
    download: name => { if (recorder.recording) stopRecord(); recorder.download(name) },
  })

  window.addEventListener('keydown', e => {
    if (e.code === 'F1') { e.preventDefault(); overlay.toggle() }
    if (e.code === 'F2') { e.preventDefault(); record() }
    if (e.code === 'F3') { e.preventDefault(); if (recorder.recording) stopRecord(); recorder.download() }
  })
  loop.start()
  if (scenario === 'run') presenter.hud.showBanner(world.roomName, 'clear the room', 1.8)
  else if (scenario === 'loop') presenter.hud.showBanner(world.roomName, 'the door starts the next attempt', 1.8)
  else if (scenario === 'full' || scenario === 'empty') presenter.hud.showBanner('THE THRESHOLD', '', 1.5)
  else if (scenario === 'shore') presenter.hud.showBanner('THE FAR SHORE', 'a life waits', 1.8)
  else if (scenario === 'blessed') presenter.hud.showBanner('THE THRESHOLD', 'the blade reaches farther', 1.8)
  else if (scenario === 'bow') presenter.hud.showBanner('THE THRESHOLD', 'the string is taut', 1.8)
  else if (scenario === 'boss') presenter.hud.showBanner('THE WARDEN', 'the first judge', 1.8)
  else presenter.hud.showBanner(scenario.toUpperCase(), '', 1.2)
}

boot().catch(err => { console.error(err); document.body.innerHTML = `<pre style="color:#f88;padding:16px">${String(err?.stack ?? err)}</pre>` })
