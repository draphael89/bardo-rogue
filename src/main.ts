import { createRenderApp, fitViewWidth } from '@/render/app'
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
import { loadMeta, loadSettings, saveMeta, saveSettings } from '@/sim/storage'
import { defaultMetaState, type MetaStateV1 } from '@/sim/session'

async function boot() {
  const q = new URLSearchParams(location.search)
  const seed = +(q.get('seed') ?? 1)
  const scenario = q.get('scenario') ?? 'loop'
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
  tuning.view.width = fitViewWidth(viewOverride)

  const manifest = await (await fetch('/assets/manifest.json')).json() as Record<string, string[]>
  await loadFonts()
  const ra = await createRenderApp(document.getElementById('app')!, { w: ARENA_COLS * TILE, h: ARENA_ROWS * TILE })
  const atlas = await loadAtlas(manifest)
  const audio = new AudioSystem()
  audio.muted = mute
  audio.load(manifest.audio) // not awaited: the game starts silent-then-sound rather than waiting

  const browserStorage = typeof localStorage === 'undefined' ? undefined : localStorage
  const preferredReducedEffects = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const storedSettings = loadSettings(browserStorage, preferredReducedEffects)
  let reducedEffects = q.has('reduced') ? q.get('reduced') !== '0' : storedSettings.reducedEffects
  let world: World = createWorld(seed, scenario, { god, ...(scenario === 'loop' ? { meta: loadMeta(browserStorage) } : {}) })
  let userPaused = false
  let metrics = new Metrics()
  const presenter = new Presenter(ra, atlas, world)
  presenter.setReducedEffects(reducedEffects)
  presenter.particles.attachRenderer(ra.app.renderer)
  presenter.onEvent = ev => playEventSfx(audio, ev)
  ra.viewOverride = viewOverride
  ra.onViewResize = () => { presenter.rebuildRoom(); presenter.hud.relayout(); presenter.reward.relayout(); presenter.title.relayout() }
  const input = new InputSystem(ra)
  const overlay = new DebugOverlay(ra.layers.debug, ra.layers.hud)
  overlay.setVisible(debug)
  let bot: ((w: World) => InputFrame) | null = botName ? makeBot(botName) : null
  const recorder = new Recorder()
  let replayFrames: InputFrame[] | null = null   // while set, these replace live/bot input
  let replayIdx = 0
  // R restarts whatever is currently running (not the URL scenario), so replays and __game.reset() restart correctly
  let cur = { seed, scenario, god }

  const reset = (s = cur.seed, sc = cur.scenario, opts: { god?: boolean; meta?: MetaStateV1 } = { god: cur.god }) => {
    cur = { seed: s, scenario: sc, god: !!opts.god }
    const suppliedMeta = Object.prototype.hasOwnProperty.call(opts, 'meta')
    const meta = sc === 'loop' ? (suppliedMeta ? opts.meta : world.scenario === 'loop' ? world.session.meta : undefined) : undefined
    world = createWorld(s, sc, { ...opts, ...(meta ? { meta } : {}) })
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
    if (world.scenario === 'loop' && world.events.some(ev => ev.type === 'runStarted' || ev.type === 'runWon' || ev.type === 'returned')) {
      saveMeta(world.session.meta, browserStorage)
    }
    world.events.length = 0
    if (world.wantsRestart) {
      // reset() clears replayFrames; a restart *inside* a replay keeps playing, matching runReplay()
      const frames = replayFrames, idx = replayIdx
      reset()
      replayFrames = frames; replayIdx = idx
    }
  }

  const record = (on = !recorder.recording) => {
    if (on && !recorder.recording) {
      reset()
      recorder.start(cur.seed, cur.scenario, cur.god, cur.scenario === 'loop' ? world.session.meta : undefined)
      console.log('[replay] recording (fresh run)')
    }
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
    reset(rep.seed, rep.scenario, {
      god: rep.god,
      ...(rep.scenario === 'loop' ? { meta: rep.meta ?? defaultMetaState() } : {}),
    })
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
    render: (alpha, dt) => {
      // The pad is polled here rather than in the input system because the simulation is stopped
      // while the title is up, and a controller player must not be the one person who cannot start.
      // The same poll keeps asking for the audio clock: a gamepad button is not a user activation,
      // and the unlock listeners inside AudioSystem only hear mouse and keyboard, so a controller-
      // only player was also the one person who got a silent game.
      if (padAnyButton()) audio.tryUnlock()
      if (presenter.title.visible && padWantsStart()) dismissTitle()
      presenter.reward.setPaused(userPaused)
      presenter.render(alpha, dt)
      overlay.update(world, loop)
      updateRecText()
      ra.renderFrame()
    },
    timeScale: () => world.timeScale,
  })

  // Start, A, X, or either shoulder — the same buttons that confirm everywhere else in the game.
  const PAD_START = [0, 2, 3, 5, 7, 9]
  const firstPad = (): Gamepad | null => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    return (pads && pads[0]) || null
  }
  const padWantsStart = (): boolean => {
    const pad = firstPad()
    return !!pad && PAD_START.some(i => !!pad.buttons[i]?.pressed)
  }
  const padAnyButton = (): boolean => {
    const pad = firstPad()
    return !!pad && pad.buttons.some(b => b?.pressed)
  }

  installApi({
    getWorld: () => world,
    reset, tick,
    setOverride: f => { input.override = f },
    setBot: b => { bot = b },
    loop,
    presenter,
    get metrics() { return metrics },
    mute: m => { audio.muted = m ?? !audio.muted; return audio.muted },
    title: show => {
      const want = show ?? !presenter.title.visible
      if (want) { presenter.title.setShown(true); loop.paused = true; audio.setSuspended(true) }
      else dismissTitle()
      return presenter.title.visible
    },
    debug: v => { overlay.setVisible(v ?? !overlay.visible); return overlay.visible },
    record, stopRecord, replay,
    download: name => { if (recorder.recording) stopRecord(); recorder.download(name) },
  })

  // Fullscreen is the only lever that actually enlarges the stage. The target is drawn at an INTEGER
  // scale in physical pixels, so the room's size on screen steps rather than slides: a 713px-tall
  // viewport caps it at 5, and 6 needs 810 (270 * 6 / dpr 2). Fullscreen buys exactly that, which is
  // a 20% larger room, and it costs nothing in crispness because the scale stays a whole number.
  // Re-running resize() after the change lets the view re-fit to the new aspect.
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    } catch { /* the browser refused; nothing to recover, the game keeps running windowed */ }
  }
  document.addEventListener('fullscreenchange', () => ra.resize())
  // A click answers the title too. Registered on the window rather than the canvas so a player who
  // clicks the letterbox is not left staring at a screen that ignores them.
  window.addEventListener('mousedown', () => dismissTitle())

  // The title is held over the living hub: the simulation is stopped but the loop keeps rendering,
  // so the room the player is about to stand in gutters and drifts behind its own name. A run driven
  // by a bot or a replay skips it - those are measurements, not first impressions.
  const wantsTitle = scenario === 'loop' && !botName
  presenter.title.setShown(wantsTitle)

  // One place decides what "paused" means, so the sim, the audio clock and the overlay can never
  // disagree. Pausing used to stop only the simulation: the bed kept playing behind the overlay and
  // a backgrounded tab kept a synthesiser running indefinitely.
  const setPaused = (p: boolean) => {
    const held = p || presenter.title.visible
    userPaused = p
    loop.paused = held
    audio.setSuspended(held)
  }
  const dismissTitle = () => {
    if (!presenter.title.visible) return
    presenter.title.setShown(false)
    loop.paused = userPaused
    audio.setSuspended(userPaused)
  }
  if (wantsTitle) { loop.paused = true; audio.setSuspended(true) }

  // Losing focus is a pause the player did not ask for but always wants: a tab switch should not
  // cost health, and it should not keep making noise from behind another window. It does NOT apply
  // while the title is up — the game is already stopped there, and adopting a user-pause would leave
  // the player staring at the pause card the moment they dismissed the title.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !presenter.title.visible) setPaused(true)
  })

  // While the title is up the simulation is stopped, so nothing is sampling input: it needs its own
  // way out. Any key or click answers it, and the key that answers it does nothing else — a player
  // dismissing a title screen with Escape should not land in a pause menu.
  const TITLE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'KeyJ', 'KeyZ', 'Escape', 'KeyP'])
  window.addEventListener('keydown', e => {
    if (presenter.title.visible) {
      if (e.repeat) return
      if (TITLE_KEYS.has(e.code) || e.code.startsWith('Key') || e.code.startsWith('Digit')) {
        e.preventDefault()
        dismissTitle()
      }
      return
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { e.preventDefault(); setPaused(!userPaused) }
    if (e.code === 'KeyV' && !e.repeat) {
      reducedEffects = !reducedEffects
      presenter.setReducedEffects(reducedEffects)
      saveSettings({ version: 1, reducedEffects }, browserStorage)
    }
    if (e.code === 'F1') { e.preventDefault(); overlay.toggle() }
    if (e.code === 'F2') { e.preventDefault(); record() }
    if (e.code === 'F3') { e.preventDefault(); if (recorder.recording) stopRecord(); recorder.download() }
    if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); void toggleFullscreen() }
  })
  loop.start()
  if (scenario === 'run') presenter.hud.showBanner(world.roomName, 'clear the room', 1.8)
  else if (scenario === 'loop') presenter.hud.showBanner(world.roomName, '', 1.5)
  else if (scenario === 'full' || scenario === 'empty') presenter.hud.showBanner('THE THRESHOLD', '', 1.5)
  else if (scenario === 'shore') presenter.hud.showBanner('THE FAR SHORE', 'a life waits', 1.8)
  else if (scenario === 'blessed') presenter.hud.showBanner('THE THRESHOLD', 'the blade reaches farther', 1.8)
  else if (scenario === 'bow') presenter.hud.showBanner('THE THRESHOLD', 'the string is taut', 1.8)
  else if (scenario === 'boss') presenter.hud.showBanner('MINOS', 'judge of the first gate', 1.8)
  else presenter.hud.showBanner(scenario.toUpperCase(), '', 1.2)
}

boot().catch(err => { console.error(err); document.body.innerHTML = `<pre style="color:#f88;padding:16px">${String(err?.stack ?? err)}</pre>` })
