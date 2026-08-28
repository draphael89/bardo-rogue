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
import { defaultMetaState, type MetaStateV1 } from '@/sim/session'
import { bumpRevision, defaultSave, serializeSave, parseSave, type BardoSave } from '@/sim/save'
import { detectPlatform, PROFILE_ID } from '@/platform'
import { loadSave, saveFilename } from '@/platform/saveFile'

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

  const platform = detectPlatform()
  // `?save=off` runs the game against a fresh profile and writes nothing. Evidence captures use it so
  // a machine that has actually played -- attempts counted, reduced effects persisted -- cannot tint a
  // screenshot or move a `loop` hash (hashWorld folds session.meta into that scenario's hash).
  const noSave = q.get('save') === 'off'
  const loaded = noSave
    ? { save: defaultSave({ profileId: PROFILE_ID }), writable: false, source: 'default' as const }
    : await loadSave(platform.saves, PROFILE_ID, { preferredReducedEffects: platform.prefersReducedMotion() })
  // The authoritative save document. Held here rather than read back out of the world at write time:
  // the envelope carries meta AND settings, and a non-`loop` world's session.meta is the zeroed
  // default, so composing a write from it would wipe real progress the moment V is pressed.
  let savedSave: BardoSave = loaded.save
  const savable = loaded.writable
  if (loaded.source === 'backup') console.log('[save] the live save was unreadable; recovered from the backup copy')
  if (!savable) console.log('[save] this save was written by a newer build; it will not be overwritten')
  let reducedEffects = q.has('reduced') ? q.get('reduced') !== '0' : savedSave.settings.reducedEffects
  let world: World = createWorld(seed, scenario, { god, ...(scenario === 'loop' ? { meta: savedSave.meta } : {}) })
  let userPaused = false
  let metrics = new Metrics()
  const presenter = new Presenter(ra, atlas, world)
  presenter.setReducedEffects(reducedEffects)
  presenter.particles.attachRenderer(ra.app.renderer)
  presenter.onEvent = ev => playEventSfx(audio, ev)
  ra.viewOverride = viewOverride
  ra.onViewResize = () => { presenter.rebuildRoom(); presenter.hud.relayout(); presenter.reward.relayout() }
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

  // One write path for the whole envelope, refused outright for a save this build cannot represent.
  // Writes are coalesced into a single slot and chained: two in flight at once (V pressed on the same
  // frame as a `returned` event) could each rotate the live copy into the backup, leaving both slots
  // holding the new revision and the previous-known-good gone. The chain always ends in a catch --
  // an unhandled rejection here would surface as a page error and fail every evidence capture.
  let writing: Promise<void> | null = null
  let queued: string | null = null
  const drain = (): void => {
    if (writing || queued === null) return
    const payload = queued
    queued = null
    writing = platform.saves.write(PROFILE_ID, payload)
      .catch(err => { console.log(`[save] write failed: ${String(err)}`) })
      .then(() => { writing = null; drain() })
  }
  const persist = () => {
    if (!savable) return
    savedSave = bumpRevision({ ...savedSave, settings: { version: 1, reducedEffects } })
    queued = serializeSave(savedSave)      // only the newest payload survives; older ones are stale by definition
    drain()
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
    // tests/sim/harness.test.ts hand-copies this ordering to prove the browser and headless agree
    // across a mid-replay restart. Keep the save write here -- after the events are handled, before
    // they are cleared -- and keep it read-only against `world`.
    if (world.scenario === 'loop' && world.events.some(ev => ev.type === 'runStarted' || ev.type === 'runWon' || ev.type === 'returned')) {
      // An explicit copy: reset() builds a NEW meta object, so holding the live one would leave this
      // pointing at a dead object and persist stale counters.
      savedSave = { ...savedSave, meta: { ...world.session.meta, unlockedWeapons: [...world.session.meta.unlockedWeapons] } }
      persist()
      platform.setRunActive(world.session.run !== null)   // so a desktop quit can ask before binning a run
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
    render: (alpha, dt) => { presenter.reward.setPaused(userPaused); presenter.render(alpha, dt); overlay.update(world, loop); updateRecText(); ra.renderFrame() },
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

  // Re-running resize() after a fullscreen change lets the view re-fit to the new aspect. The
  // fullscreen call itself lives in src/platform (it is the host's job); this is the renderer's.
  document.addEventListener('fullscreenchange', () => ra.resize())

  const exportSave = () => {
    void platform.exportFile(serializeSave(savedSave), saveFilename(new Date()))
    presenter.hud.showBanner('SAVE EXPORTED', 'CHECK YOUR DOWNLOADS', 2.0)
  }
  const importSave = async () => {
    const text = await platform.importFile()
    if (text === null) return
    const parsed = parseSave(text, { profileId: PROFILE_ID })
    if (parsed.kind === 'corrupt') { presenter.hud.showBanner('SAVE NOT READ', 'that file is not a bardo save', 2.2); return }
    if (parsed.kind === 'future') { presenter.hud.showBanner('SAVE NOT READ', 'it came from a newer build', 2.2); return }
    // The profile already here is one this build cannot represent. Applying an import would show the
    // player new counters that the next reload silently reverts, so refuse rather than half-apply.
    if (!savable) { presenter.hud.showBanner('PROFILE IS NEWER', 'this build must not overwrite it', 2.4); return }
    // A live run holds sim state no import can reconcile; refuse rather than half-apply it.
    if (world.session.run) { presenter.hud.showBanner('A RUN IS UNDERWAY', 'return to the bardo first', 2.2); return }
    savedSave = parsed.save
    reducedEffects = savedSave.settings.reducedEffects
    presenter.setReducedEffects(reducedEffects)
    persist()
    userPaused = false; loop.paused = false
    // reset() rebuilds the world with the imported meta and rebinds the presenter. Deliberately not a
    // reload: that would drop ?bot=/?seed=, destroy window.__game mid-evaluate and break an attached
    // Playwright page.
    if (world.scenario === 'loop') reset(cur.seed, cur.scenario, { god: cur.god, meta: savedSave.meta })
    presenter.hud.showBanner('SAVE IMPORTED', `${savedSave.meta.attempts} ATTEMPTS · ${savedSave.meta.victories} VICTORIES`, 2.2)
  }

  window.addEventListener('keydown', e => {
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { e.preventDefault(); userPaused = !userPaused; loop.paused = userPaused }
    if (e.code === 'KeyV' && !e.repeat) {
      reducedEffects = !reducedEffects
      presenter.setReducedEffects(reducedEffects)
      persist()
    }
    if (e.code === 'F1') { e.preventDefault(); overlay.toggle() }
    if (e.code === 'F2') { e.preventDefault(); record() }
    if (e.code === 'F3') { e.preventDefault(); if (recorder.recording) stopRecord(); recorder.download() }
    if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); void platform.fullscreen() }
    // Save management is reachable only from the pause screen, so it can never fire mid-fight.
    if (userPaused && e.code === 'KeyE' && !e.repeat) { e.preventDefault(); exportSave() }
    if (userPaused && e.code === 'KeyI' && !e.repeat) { e.preventDefault(); void importSave() }
  })
  loop.start()
  if (!noSave) platform.persistHint()   // after first paint: a permission prompt must never land on a black screen
  if (scenario === 'run') presenter.hud.showBanner(world.roomName, 'clear the room', 1.8)
  else if (scenario === 'loop') presenter.hud.showBanner(world.roomName, '', 1.5)
  else if (scenario === 'full' || scenario === 'empty') presenter.hud.showBanner('THE THRESHOLD', '', 1.5)
  else if (scenario === 'shore') presenter.hud.showBanner('THE FAR SHORE', 'a life waits', 1.8)
  else if (scenario === 'blessed') presenter.hud.showBanner('THE THRESHOLD', 'the blade reaches farther', 1.8)
  else if (scenario === 'bow') presenter.hud.showBanner('THE THRESHOLD', 'the string is taut', 1.8)
  else if (scenario === 'boss') presenter.hud.showBanner('THE WARDEN', 'the first judge', 1.8)
  else presenter.hud.showBanner(scenario.toUpperCase(), '', 1.2)
}

boot().catch(err => { console.error(err); document.body.innerHTML = `<pre style="color:#f88;padding:16px">${String(err?.stack ?? err)}</pre>` })
