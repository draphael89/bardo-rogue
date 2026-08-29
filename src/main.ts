import { createRenderApp, fitViewWidth } from '@/render/app'
import { loadAtlas, loadFonts } from '@/render/atlas'
import { Presenter } from '@/render/presenter'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { abandonRun, canReturn } from '@/sim/return'
import { pauseRowKinds } from '@/render/reward'
import type { World } from '@/sim/world'
import type { InputFrame } from '@/sim/input'
import { InputSystem, PAD_RESTART } from '@/input'
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
import { bumpRevision, defaultSave, serializeSave, parseSave, CONTENT_REVISION, type BardoSave } from '@/sim/save'
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
  // `?playtest=<condition>` arms a playtest session: the whole session records itself from tick 0,
  // the named verb condition filters LIVE input only (bots and replays bypass it, and the filtered
  // frames are what gets recorded, so an exported bundle replays exactly as the tester played), and
  // F4 downloads the session bundle. Conditions and protocol: PLAYTEST.md.
  const PLAYTEST_CONDITIONS = ['baseline', 'no-heavy', 'no-dash'] as const
  type PlaytestCondition = typeof PLAYTEST_CONDITIONS[number]
  const playtestRaw = q.get('playtest')
  const playtest: PlaytestCondition | null =
    playtestRaw && (PLAYTEST_CONDITIONS as readonly string[]).includes(playtestRaw) ? playtestRaw as PlaytestCondition : null
  if (playtestRaw && !playtest) console.log(`[playtest] unknown condition "${playtestRaw}"; expected ${PLAYTEST_CONDITIONS.join(' | ')}`)

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

  // `?save=off` runs the game against a fresh profile and writes nothing -- not even the one-time
  // legacy storage upgrade. Evidence captures use it so a machine that has actually played -- attempts
  // counted, reduced effects persisted -- cannot tint a screenshot or move a `loop` hash (hashWorld
  // folds session.meta into that scenario's hash).
  const noSave = q.get('save') === 'off'
  const platform = detectPlatform()
  // Claim before loadSave: recovery may re-arm the live slot from a backup, which is a write just as
  // surely as an autosave. Browsers without Web Locks stay read-only; a localStorage heartbeat is
  // not atomic and therefore cannot authorise whole-document writes safely.
  const ownership = noSave ? 'unavailable' : await platform.claimSaves?.(PROFILE_ID) ?? 'acquired'
  const ownsProfile = ownership === 'acquired'
  const loaded = noSave
    ? { save: defaultSave({ profileId: PROFILE_ID }), writable: false, source: 'default' as const }
    : await loadSave(platform.saves, PROFILE_ID, {
      preferredReducedEffects: platform.prefersReducedMotion(),
      repair: ownsProfile,
    })
  // The authoritative save document. Held here rather than read back out of the world at write time:
  // the envelope carries meta AND settings, and a non-`loop` world's session.meta is the zeroed
  // default, so composing a write from it would wipe real progress the moment V is pressed.
  let savedSave: BardoSave = loaded.save
  let savable = loaded.writable && ownsProfile
  if (noSave) console.log('[save] save=off: this session reads and writes nothing')
  else if (ownership === 'busy') console.log('[save] another tab owns this profile; this session will not write')
  else if (ownership === 'unavailable') console.log('[save] exclusive browser save locking is unavailable; this session will not write')
  else if (loaded.preservationFailed) console.log('[save] damaged bytes could not be preserved; this session will not write')
  else if (loaded.source === 'damaged') console.log('[save] the save was damaged and no backup was usable; a fresh profile started, the damaged bytes are kept')
  else if (loaded.source === 'backup') console.log('[save] the live save was unreadable; recovered from the backup copy')
  else if (loaded.source === 'unreadable') console.log('[save] this profile could not be read at all; nothing will be written over it')
  else if (!savable) console.log('[save] this save was written by a newer build; it will not be overwritten')
  // Two values on purpose: what the save document says, and what this session is actually rendering.
  // `?reduced=` is a debug override of the second only -- persisting it would let a URL param
  // permanently rewrite a player's setting the next time any autosave fires.
  let storedReducedEffects = savedSave.settings.reducedEffects
  let reducedEffects = q.has('reduced') ? q.get('reduced') !== '0' : storedReducedEffects
  // The three sliders the pause card shows. Applied immediately: setLevel stores the value even
  // before the AudioContext exists, and buildGraph honours it when the first gesture arrives.
  const volumes = { master: savedSave.settings.volMaster, music: savedSave.settings.volMusic, sfx: savedSave.settings.volSfx }
  const applyVolumes = () => {
    audio.setLevel('master', volumes.master)
    audio.setLevel('music', volumes.music); audio.setLevel('ambience', volumes.music)
    audio.setLevel('sfx', volumes.sfx); audio.setLevel('ui', volumes.sfx)
  }
  applyVolumes()
  let world: World = createWorld(seed, scenario, { god, ...(scenario === 'loop' ? { meta: savedSave.meta } : {}) })
  // Spatial audio starts with the player's actual spawn, before the first enemy tell can arrive.
  audio.setListener(world.player.x, world.player.y)
  platform.setRunActive(world.session.run !== null)
  let userPaused = false
  let debugPaused = false
  let metrics = new Metrics()
  const presenter = new Presenter(ra, atlas, world)
  presenter.setReducedEffects(reducedEffects)
  presenter.particles.attachRenderer(ra.app.renderer)
  // Refresh the ears immediately before every sound. Footsteps are cadence, not authority: a
  // stationary player and a freshly reset room must spatialize enemy tells just as accurately.
  presenter.onEvent = ev => playEventSfx(audio, ev, world.player)
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
    audio.setListener(world.player.x, world.player.y)
    platform.setRunActive(world.session.run !== null)
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
  interface PendingWrite { payload: string; settle: Array<(ok: boolean) => void> }
  let writing: Promise<void> | null = null
  let queued: PendingWrite | null = null
  let writeFailed = false
  let suppressedPersistShown = false
  const drain = (): void => {
    if (writing || queued === null) return
    const pending = queued
    queued = null
    platform.setSaving?.(true)             // so a desktop quit waits for this write instead of racing it
    writing = platform.saves.write(PROFILE_ID, pending.payload)
      .then(() => { for (const settle of pending.settle) settle(true) })
      .catch(err => {
        for (const settle of pending.settle) settle(false)
        console.log(`[save] write failed: ${String(err)}`)
        // Say it once, in the game, rather than only in a console nobody has open. A player whose
        // disk is full or whose save directory is unwritable otherwise loses a whole session's
        // progress without a single hint that anything went wrong.
        if (!writeFailed) { writeFailed = true; presenter.hud.showBanner('PROGRESS NOT SAVING', 'this run will not be recorded', 3.0) }
      })
      .then(() => {
        writing = null
        if (queued === null) platform.setSaving?.(false)
        drain()
      })
  }
  const persist = (): Promise<boolean> => {
    if (!savable) {
      // The write is suppressed by design (a newer build's save, or a profile we could not read).
      // The boot banner said why once; this says WHEN it starts costing something -- at the first
      // moment the player earned a save that is not going to happen.
      if (!noSave && !suppressedPersistShown) { suppressedPersistShown = true; presenter.hud.showBanner('PROGRESS NOT SAVING', 'this profile cannot be written', 3.0) }
      return Promise.resolve(false)
    }
    savedSave = bumpRevision({ ...savedSave, settings: { version: 2, reducedEffects: storedReducedEffects, volMaster: volumes.master, volMusic: volumes.music, volSfx: volumes.sfx } })
    const payload = serializeSave(savedSave)
    return new Promise(resolve => {
      if (queued) {
        queued.payload = payload          // only the newest payload survives; older ones are stale by definition
        queued.settle.push(resolve)        // but every caller waits for that newest payload to become durable
      } else queued = { payload, settle: [resolve] }
      drain()
    })
  }

  // The A/B verb conditions, applied to live device input only. no-heavy removes the independent
  // heavy verb (the chain's committed third swing is untouched, which IS the pre-verb behaviour).
  // no-dash drops attack intent while the body is rolling, so the dodge-to-attack cancel never sees
  // a press; a swing after the roll needs a fresh press on landing.
  const filterVerbs = (f: InputFrame): InputFrame => {
    if (playtest === 'no-heavy' && f.heavy) return { ...f, heavy: false }
    if (playtest === 'no-dash' && world.player.state === 'dodge' && (f.attack || f.attackHeld || f.heavy)) {
      return { ...f, attack: false, attackHeld: false, heavy: false }
    }
    return f
  }

  const tick = () => {
    // The Start press that confirms a death/victory return is consumed by THIS tick — and by the
    // time render() runs, canReturn is already false again. Latch the pre-tick state so the pause
    // toggle can tell "the run is live" apart from "you just confirmed a return with this press".
    if (canReturn(world)) returnOpenThisFrame = true
    // always sample live input, even when a bot or replay drives the sim, so latched presses do not pile up
    const live = input.sample(world)
    // The Q reticle describes the controls actually driving this run. It is presentation-only and
    // deliberately disappears while a deterministic replay or bot owns the simulation input.
    presenter.setHardLockTarget(!replayFrames && !bot ? input.hardLockTargetId : null)
    let frame: InputFrame
    if (replayFrames) {
      frame = replayFrames[replayIdx++]
      if (replayIdx >= replayFrames.length) { replayFrames = null; console.log('[replay] finished; back to live input') }
    } else frame = quantizeFrame(bot ? bot(world) : filterVerbs(live))
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
      void persist()
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
    // A replay is a measurement, even when it is installed through the live debug API after boot.
    // Do not leave the first-impression title intercepting F/V/E/I while the replay owns input.
    presenter.title.setSoundGate(false)
    presenter.title.setShown(false)
    // Recompute the hold after hiding the title: the initial title is what paused a fresh boot, but
    // an explicit player pause remains authoritative if a replay is installed later.
    setPaused(userPaused)
    replayFrames = rep.frames.length ? rep.frames : null
    replayIdx = 0
  }

  const recText = new Text({ text: '', style: { fontFamily: 'Kenney Mini', fontSize: 16, fill: 0xff5050 }, resolution: 1 })
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
      // while the title is up (and while paused), and a controller player must not be the one
      // person who cannot start — or unpause. One snapshot per frame; getGamepads() allocates.
      const pad = firstPad()
      const titleWasUp = presenter.title.visible
      const titleStartNow = padWantsStart(pad)
      if (titleWasUp && titleStartNow && !padTitlePrev) void dismissTitle()
      padTitlePrev = titleStartNow
      // Start is the controller's pause. During the loop's live gameplay the sim ignores the pad's
      // legacy restart mapping entirely, so a controller-only player had NO route to the pause
      // screen — the only listeners are keyboard P and Escape. Edge-triggered against its own
      // previous state, and never on the frame that dismissed the title, or the same press would
      // land the player straight in the pause card. On the death and victory screens Start keeps
      // its existing job (confirm the return) — judged by whether a return was open when this
      // frame's ticks BEGAN, because the tick that consumed the press has already closed it.
      const startNow = padStartButton(pad)
      if (startNow && !padStartPrev && !titleWasUp && world.scenario === 'loop' && !returnOpenThisFrame && !canReturn(world)) {
        setPaused(!userPaused)
      }
      padStartPrev = startNow
      returnOpenThisFrame = false
      // The pause card's pad navigation, polled here for the same reason Start is: the sim (and with
      // it the input system) is stopped while paused. Standard-mapping d-pad is buttons 12-15; A is 0.
      if (userPaused && !titleWasUp) {
        const up = !!pad?.buttons[12]?.pressed, down = !!pad?.buttons[13]?.pressed
        const left = !!pad?.buttons[14]?.pressed, right = !!pad?.buttons[15]?.pressed
        const a = !!pad?.buttons[0]?.pressed
        if (up && !padMenuPrev.up) movePauseFocus(-1)
        if (down && !padMenuPrev.down) movePauseFocus(1)
        if (left && !padMenuPrev.left) pauseAdjust(-1)
        if (right && !padMenuPrev.right) pauseAdjust(1)
        if (a && !padMenuPrev.a && pauseRowKind() !== 'abandon') pauseActivate()
        padAHeld = a
        padMenuPrev = { up, down, left, right, a }
      } else {
        padAHeld = false
        padMenuPrev = { up: false, down: false, left: false, right: false, a: false }
      }
      // Abandon is a held confirmation, advanced on the render clock because the sim is paused.
      const holdingAbandon = userPaused && pauseRowKind() === 'abandon' && (abandonKeyHeld || padAHeld)
      abandonHold = holdingAbandon ? Math.min(1, abandonHold + dt / ABANDON_HOLD_SEC) : 0
      if (holdingAbandon && abandonHold >= 1) {
        abandonKeyHeld = false
        abandonRun(world)
        setPaused(false)
        presenter.hud.showBanner('THE RUN ENDS HERE', 'the bardo takes you back', 2.2)
      }
      presenter.reward.setPadActive(!!pad)
      if (userPaused) {
        presenter.reward.setPauseMenu({
          focus: pauseFocus,
          volumes: { ...volumes },
          reduced: reducedEffects,
          runActive: pauseRunActive(),
          hold: abandonHold,
        })
      }
      presenter.reward.setPaused(userPaused)
      presenter.render(alpha, dt)
      overlay.update(world, loop)
      updateRecText()
      ra.renderFrame()
    },
    timeScale: () => world.timeScale,
  })

  // Start, A, X, or either shoulder — the same buttons that confirm everywhere else in the game.
  // The pause listens to PAD_RESTART, the input system's own Start mapping, so remapping the button
  // there moves both jobs together.
  const PAD_START = [0, 2, 3, 5, 7, ...PAD_RESTART]
  let padStartPrev = false
  let padTitlePrev = false
  let returnOpenThisFrame = false
  const firstPad = (): Gamepad | null => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    return (pads && pads[0]) || null
  }
  const padStartButton = (pad: Gamepad | null): boolean =>
    !!pad && PAD_RESTART.some(i => !!pad.buttons[i]?.pressed)
  const padWantsStart = (pad: Gamepad | null): boolean =>
    !!pad && PAD_START.some(i => !!pad.buttons[i]?.pressed)

  // ---- pause menu ------------------------------------------------------------------------------
  // The card's rows live in pauseRowKinds (shared with the painter). Shell UX constants stay here:
  // they are menu feel, not gameplay, so they do not belong in tuning.ts.
  const ABANDON_HOLD_SEC = 0.9   // deliberate, but short enough that it never reads as broken
  const VOL_STEP = 0.1
  let pauseFocus = 0
  let abandonHold = 0
  let abandonKeyHeld = false
  let padAHeld = false
  let padMenuPrev = { up: false, down: false, left: false, right: false, a: false }
  const pauseRunActive = () => !!world.session.run && world.session.run.result === 'active' && world.player.state !== 'dead'
  const pauseRowKind = () => pauseRowKinds(pauseRunActive())[pauseFocus] ?? 'resume'
  const movePauseFocus = (dir: number) => {
    const rows = pauseRowKinds(pauseRunActive())
    pauseFocus = (pauseFocus + dir + rows.length) % rows.length
    abandonHold = 0; abandonKeyHeld = false
  }
  const toggleReduced = () => {
    reducedEffects = !reducedEffects
    storedReducedEffects = reducedEffects       // an explicit player choice, so it is the one that persists
    presenter.setReducedEffects(reducedEffects)
    void persist()
  }
  const pauseAdjust = (dir: number) => {
    const kind = pauseRowKind()
    if (kind === 'master' || kind === 'music' || kind === 'sfx') {
      volumes[kind] = Math.min(1, Math.max(0, Math.round((volumes[kind] + dir * VOL_STEP) * 10) / 10))
      applyVolumes()
      void persist()
    } else if (kind === 'reduced') toggleReduced()
  }
  const pauseActivate = () => {
    const kind = pauseRowKind()
    if (kind === 'resume') setPaused(false)
    else if (kind === 'reduced') toggleReduced()
    // 'abandon' is hold-driven (see render), so a stray tap can never end a run
  }

  installApi({
    getWorld: () => world,
    reset, tick,
    setOverride: f => { input.override = f },
    setBot: b => { bot = b },
    pause: p => {
      debugPaused = p ?? !debugPaused
      loop.paused = debugPaused || userPaused || presenter.title.visible
      return loop.paused
    },
    loop,
    presenter,
    get metrics() { return metrics },
    mute: m => { audio.muted = m ?? !audio.muted; return audio.muted },
    title: show => {
      const want = show ?? !presenter.title.visible
      if (want) { presenter.title.setShown(true); loop.paused = true; audio.setSuspended(true) }
      else void dismissTitle()
      return presenter.title.visible
    },
    debug: v => { overlay.setVisible(v ?? !overlay.visible); return overlay.visible },
    record, stopRecord, replay,
    download: name => { if (recorder.recording) stopRecord(); recorder.download(name) },
  })

  // Re-running resize() after a fullscreen change lets the view re-fit to the new aspect. The
  // fullscreen call itself lives in src/platform (it is the host's job); this is the renderer's.
  document.addEventListener('fullscreenchange', () => ra.resize())
  const exportSave = async () => {
    // Nothing was read, so there is nothing to export: serialising the in-memory defaults here would
    // hand the player a zeroed file labelled as their backup of the inaccessible profile.
    if (loaded.source === 'unreadable') { presenter.hud.showBanner('NOTHING TO EXPORT', 'the save could not be read', 2.4); return }
    // For a save from a newer build, export the bytes as they were READ: re-serialising would emit a
    // schemaVersion-2 document with the newer build's fields quietly dropped, which is indistinguishable
    // from a real one.
    // The call has to happen inside the keydown the browser is still processing (the download click
    // needs that gesture), so it is started before anything is awaited.
    const written = await platform.exportFile(loaded.raw ?? serializeSave(savedSave), saveFilename(new Date()))
    if (!written) { presenter.hud.showBanner('SAVE NOT EXPORTED', 'nothing was written', 2.0); return }
    presenter.hud.showBanner('SAVE EXPORTED', savable ? 'CHECK YOUR DOWNLOADS' : 'EXPORTED AS FOUND', 2.0)
  }
  let importing = false
  const importSave = async () => {
    if (importing) return
    importing = true
    try {
      const text = await platform.importFile()
      if (text === null) return
      const parsed = parseSave(text, { profileId: PROFILE_ID })
      if (parsed.kind === 'future') { presenter.hud.showBanner('SAVE NOT READ', 'it came from a newer build', 2.2); return }
      // Only a document this build actually read counts. 'empty' is the dangerous one: an empty or
      // whitespace-only file parses to a DEFAULT save, and accepting it would write zeroed counters
      // over real progress while the banner cheerfully said SAVE IMPORTED.
      if (parsed.kind !== 'ok' && parsed.kind !== 'migrated') { presenter.hud.showBanner('SAVE NOT READ', 'that file is not a bardo save', 2.2); return }
      if (!savable) { presenter.hud.showBanner('PROFILE IS READ ONLY', 'this session must not overwrite it', 2.4); return }
      // A live run holds sim state no import can reconcile; refuse rather than half-apply it.
      if (world.session.run) { presenter.hud.showBanner('A RUN IS UNDERWAY', 'return to the bardo first', 2.2); return }
      const priorSave = savedSave
      const priorStoredReducedEffects = storedReducedEffects
      savedSave = parsed.save
      storedReducedEffects = savedSave.settings.reducedEffects
      // The imported counters and success banner are applied only after the coalesced writer says
      // the exact logical update is durable. A refused disk write therefore cannot look successful.
      if (!await persist()) {
        savedSave = priorSave
        storedReducedEffects = priorStoredReducedEffects
        presenter.hud.showBanner('SAVE NOT IMPORTED', 'the file could not be written', 2.4)
        return
      }
      reducedEffects = savedSave.settings.reducedEffects
      presenter.setReducedEffects(reducedEffects)
      volumes.master = savedSave.settings.volMaster
      volumes.music = savedSave.settings.volMusic
      volumes.sfx = savedSave.settings.volSfx
      applyVolumes()
      setPaused(false)
      // reset() rebuilds the world with the imported meta and rebinds the presenter. Deliberately not a
      // reload: that would drop ?bot=/?seed=, destroy window.__game mid-evaluate and break an attached
      // Playwright page.
      if (world.scenario === 'loop') reset(cur.seed, cur.scenario, { god: cur.god, meta: savedSave.meta })
      presenter.hud.showBanner('SAVE IMPORTED', `${savedSave.meta.attempts} ATTEMPTS · ${savedSave.meta.victories} VICTORIES`, 2.2)
    } finally { importing = false }
  }

  // Arm the playtest session: record from tick zero (the world is fresh here, so no reset is
  // needed), and keep the meta snapshot the recorder was handed — the exported bundle must carry
  // the exact counters the run seed was derived from, not the ones the session has mutated since.
  let playtestMeta: MetaStateV1 | undefined
  if (playtest && !botName) {
    playtestMeta = cur.scenario === 'loop'
      ? { ...world.session.meta, unlockedWeapons: [...world.session.meta.unlockedWeapons] }
      : undefined
    recorder.start(cur.seed, cur.scenario, cur.god, playtestMeta)
    console.log(`[playtest] session armed: condition "${playtest}", recording from tick 0 — F4 exports the bundle`)
  }
  const exportPlaytestBundle = () => {
    if (!recorder.recording) { presenter.hud.showBanner('NOTHING RECORDING', 'reload to arm the playtest', 2.2); return }
    // A snapshot, not a stop: the session keeps recording so a tester can export after every run.
    const snapshot: Replay = { v: 1, seed: cur.seed, scenario: cur.scenario, frames: [...recorder.frames] }
    if (cur.god) snapshot.god = true
    if (playtestMeta) snapshot.meta = playtestMeta
    // The bundle IS a valid encoded replay with one extra key, so `pnpm sim -- --replay bundle.json`
    // replays it with no unwrapping. The condition rides along for the analyst, not the decoder.
    const bundle = {
      ...JSON.parse(replayToJson(snapshot)) as Record<string, unknown>,
      playtest: {
        condition: playtest,
        build: CONTENT_REVISION,
        exportedAt: new Date().toISOString(),
        attempts: world.session.meta.attempts,
        victories: world.session.meta.victories,
        metrics: metrics.summary(),
      },
    }
    const name = `bundle-${playtest}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    const href = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = href; a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    presenter.hud.showBanner('BUNDLE EXPORTED', 'send the download to the organizer', 2.4)
  }

  // The title is held over the living hub: the simulation is stopped but the loop keeps rendering,
  // so the room the player is about to stand in gutters and drifts behind its own name. A run driven
  // by a bot or a replay skips it - those are measurements, not first impressions.
  const wantsTitle = scenario === 'loop' && !botName
  presenter.title.setShown(wantsTitle)

  // One place decides what "paused" means, so the sim, the audio clock and the overlay can never
  // disagree. Pausing used to stop only the simulation: the bed kept playing behind the overlay and
  // a backgrounded tab kept a synthesiser running indefinitely.
  const setPaused = (p: boolean) => {
    if (p && !userPaused) { pauseFocus = 0; abandonHold = 0; abandonKeyHeld = false }
    const playerHeld = p || presenter.title.visible
    userPaused = p
    loop.paused = playerHeld || debugPaused
    // The debug hold freezes deterministic captures but deliberately leaves the rendered/audio
    // surface live, matching the API's original contract. Player/title pause owns the audio clock.
    audio.setSuspended(playerHeld)
  }

  // A gamepad button is not browser user activation. It may ask the browser to resume audio, but it
  // may not dismiss the title until the audio clock actually runs. A real key/click performs that
  // resume inside its activation; mute=1 bypasses the gate because silence was explicitly requested.
  const dismissTitle = async (gesture = false): Promise<boolean> => {
    if (!presenter.title.visible) return true
    audio.setSuspended(false)
    if (!mute) {
      if (gesture) await audio.resumeFromGesture()
      else audio.tryUnlock()
      if (audio.needsGesture) {
        presenter.title.setSoundGate(true)
        loop.paused = true
        return false
      }
    }
    presenter.title.setSoundGate(false)
    presenter.title.setShown(false)
    setPaused(userPaused)
    return true
  }
  if (wantsTitle) setPaused(false)

  // Losing focus is a pause the player did not ask for but always wants: a tab switch should not
  // cost health, and it should not keep making noise from behind another window.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !presenter.title.visible) setPaused(true)
  })

  // A click answers the title too. Registered on the window rather than the canvas so a player who
  // clicks the letterbox is not left staring at a screen that ignores them.
  window.addEventListener('mousedown', () => { void dismissTitle(true) })

  window.addEventListener('keydown', e => {
    // F belongs to the host even while the title is holding the sim. Treating every title key as
    // "descend" swallowed the desktop app's first fullscreen press and made the advertised window
    // control appear broken until the player pressed it twice.
    if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); void platform.fullscreen(); return }
    if (presenter.title.visible) {
      if (e.repeat) return
      e.preventDefault()
      void dismissTitle(true)
      return
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { e.preventDefault(); setPaused(!userPaused) }
    if (e.code === 'KeyV' && !e.repeat && !importing) toggleReduced()
    // The pause card's keyboard navigation. Sliders accept key repeat (holding a direction slides);
    // the toggle and the rows do not, or one hold would flip them like a strobe.
    if (userPaused && !importing) {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) movePauseFocus(-1) }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); if (!e.repeat) movePauseFocus(1) }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); if (!e.repeat || pauseRowKind() !== 'reduced') pauseAdjust(-1) }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); if (!e.repeat || pauseRowKind() !== 'reduced') pauseAdjust(1) }
      // Enter only — Space is the dodge key, and a press latched behind the pause would roll the
      // player the instant the card closes.
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
        e.preventDefault()
        if (pauseRowKind() === 'abandon') abandonKeyHeld = true
        else pauseActivate()
      }
    }
    if (e.code === 'F1') { e.preventDefault(); overlay.toggle() }
    if (e.code === 'F2') { e.preventDefault(); record() }
    if (e.code === 'F3') { e.preventDefault(); if (recorder.recording) stopRecord(); recorder.download() }
    if (e.code === 'F4' && playtest && !e.repeat) { e.preventDefault(); exportPlaytestBundle() }
    // Save management is reachable only from the pause screen, so it can never fire mid-fight.
    if (userPaused && !importing && e.code === 'KeyE' && !e.repeat) { e.preventDefault(); void exportSave() }
    if (userPaused && !importing && e.code === 'KeyI' && !e.repeat) { e.preventDefault(); void importSave() }
  })
  // Releasing the confirm key mid-hold cancels the abandon; the render loop drains the bar to zero.
  window.addEventListener('keyup', e => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') abandonKeyHeld = false
  })
  if (!noSave) {
    platform.watchForeignWrites?.(() => {
      if (!savable) return
      savable = false
      console.log('[save] save ownership was invalidated; this session will stop writing')
      presenter.hud.showBanner('SAVE OWNERSHIP LOST', 'progress here will not be saved', 3.0)
    })
  }

  loop.start()
  if (!noSave) platform.persistHint()   // after first paint: a permission prompt must never land on a black screen
  if (scenario === 'run') presenter.hud.showBanner(world.roomName, 'clear the room', 1.8)
  else if (scenario === 'loop') presenter.hud.showBanner(world.roomName, '', 1.5)
  else if (scenario === 'full' || scenario === 'empty') presenter.hud.showBanner('THE THRESHOLD', '', 1.5)
  else if (scenario === 'shore') presenter.hud.showBanner('THE FAR SHORE', 'a life waits', 1.8)
  else if (scenario === 'blessed') presenter.hud.showBanner('THE THRESHOLD', 'the blade reaches farther', 1.8)
  else if (scenario === 'bow') presenter.hud.showBanner('THE THRESHOLD', 'the string is taut', 1.8)
  else if (scenario === 'boss') presenter.hud.showBanner('MINOS', 'judge of the first gate', 1.8)
  else presenter.hud.showBanner(scenario.toUpperCase(), '', 1.2)

  // A profile that will not be saved, or one that had to be rescued, is told to the PLAYER at boot,
  // not just the console -- overriding the room banner in exactly the rare case where the warning
  // matters more than the room name. save=off skips it, so evidence captures stay clean.
  if (!noSave) {
    if (ownership === 'busy') presenter.hud.showBanner('ANOTHER TAB IS PLAYING', 'progress here will not be saved', 3.5)
    else if (ownership === 'unavailable') presenter.hud.showBanner('PROGRESS NOT SAVING', 'exclusive browser locking is unavailable', 3.5)
    else if (loaded.source === 'unreadable') presenter.hud.showBanner('SAVE COULD NOT BE READ', 'playing without saving, nothing will be overwritten', 3.5)
    else if (loaded.preservationFailed) presenter.hud.showBanner('SAVE WAS DAMAGED', 'playing read-only; damaged bytes could not be preserved', 3.5)
    else if (!savable) presenter.hud.showBanner('SAVE FROM A NEWER BUILD', 'playing without saving, nothing will be overwritten', 3.5)
    else if (loaded.source === 'damaged') presenter.hud.showBanner('SAVE WAS DAMAGED', 'a fresh start; the damaged file is kept', 3.5)
    else if (loaded.source === 'backup') presenter.hud.showBanner('SAVE RESTORED', 'recovered from the backup copy', 3.0)
  }
}

boot().catch(err => { console.error(err); document.body.innerHTML = `<pre style="color:#f88;padding:16px">${String(err?.stack ?? err)}</pre>` })
