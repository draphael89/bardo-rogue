import { ASSET_BASE } from '@/assetBase'
import { createRenderApp, fitViewWidth } from '@/render/app'
import { loadAtlas, loadFonts } from '@/render/atlas'
import { Presenter } from '@/render/presenter'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import { abandonRun, canAbandon, canReturn } from '@/sim/return'
import type { World } from '@/sim/world'
import type { InputFrame } from '@/sim/input'
import { InputSystem, PAD_CHOICE_LEFT, PAD_CHOICE_RIGHT, PAD_MENU_CONFIRM, PAD_MENU_DOWN, PAD_MENU_UP, PAD_RESTART } from '@/input'
import { Loop } from '@/loop'
import { AudioSystem } from '@/audio/audio'
import { playEventSfx } from '@/audio/sfxMap'
import { Metrics } from '@/sim/metrics'
import { DebugOverlay } from '@/debug/overlay'
import { installApi } from '@/debug/api'
import { makeBot, type BotName } from '@/sim/bots'
import { decodeReplay, isEncodedReplay, MAX_REPLAY_FRAMES, quantizeFrame, replayToJson, type Replay, type EncodedReplay } from '@/sim/replay'
import { downloadJson, Recorder } from '@/input/recorder'
import { tuning } from '@/tuning'
import { Text } from 'pixi.js'
import { defaultMetaState, type MetaState } from '@/sim/session'
import { captureCheckpoint, restoreCheckpoint } from '@/sim/checkpoint'
import { bumpRevision, defaultSave, serializeSave, parseSave, CONTENT_REVISION, type BardoSave } from '@/sim/save'
import { detectPlatform, PROFILE_ID } from '@/platform'
import { loadSave, saveFilename } from '@/platform/saveFile'
import { titleNudge, townTally } from '@/render/titleMenu'
import { nudgeSlider } from '@/sim/storage'
import { applyPlaytestCondition, asPlaytestCondition, canRecordPlainReplay, conditionOfBundle, PLAYTEST_CONDITIONS, type PlaytestCondition } from '@/playtest'
import { TitleFlow } from '@/titleFlow'

async function boot() {
  const q = new URLSearchParams(location.search)
  const seed = +(q.get('seed') ?? 1)
  const scenario = q.get('scenario') ?? 'loop'
  const god = q.get('god') === '1'
  const debug = q.get('debug') === '1'
  const mute = q.get('mute') === '1'
  const botName = q.get('bot') as BotName | null
  // `?playtest=<condition>` arms a playtest session: the whole session records itself from tick 0,
  // the condition applies to LIVE play only (bots bypass it), and F4 downloads the session bundle.
  // The two conditions are not the same kind of thing. no-heavy is a frame filter, so it is baked
  // into the recording; no-dash closes the cancel WINDOW, which is not in the frames, so the bundle
  // carries the condition and every replay path re-applies it (src/playtest.ts). Protocol and the
  // session interlocks that keep a bundle honest: PLAYTEST.md.
  const playtestRaw = q.get('playtest')
  const playtest = asPlaytestCondition(playtestRaw)
  // Bots bypass playtest setup entirely, so they must not inherit its replay/export interlocks.
  let replayCondition: PlaytestCondition | null = playtest && !botName ? playtest : null
  if (playtestRaw && !playtest) console.log(`[playtest] unknown condition "${playtestRaw}"; expected ${PLAYTEST_CONDITIONS.join(' | ')}`)

  // Widen the render target to the window's aspect before anything reads it, so the room is not
  // letterboxed into the middle third of a wide monitor. HEIGHT NEVER CHANGES: the world-render
  // scale, the 16px sim grid and every tuned distance stay exactly as authored; only how much void
  // you see to the left and right moves. Snapped to 16, and floored at 640 so the HUD never has
  // less room than it was laid out for.
  // A 16:9 window computes to exactly 640, and tools/shot.ts opens a 1920x1080 viewport, so every
  // pinned evidence crop and every gauntlet protocol keeps its coordinates. `?view=640` forces it.
  const viewOverride = +(q.get('view') ?? 0)
  tuning.view.width = fitViewWidth(viewOverride)

  const manifest = await (await fetch(`${ASSET_BASE}manifest.json`)).json() as Record<string, string[]>
  await loadFonts()
  const ra = await createRenderApp(document.getElementById('app')!, viewOverride)
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
  else if (loaded.raw) console.log('[save] this save was written by a newer build; it will not be overwritten')
  else if (loaded.source === 'backup') console.log(loaded.writable
    ? '[save] the live save was unreadable; recovered from the backup copy'
    : '[save] recovered progress from the backup copy; the unreadable live slot keeps this session read-only')
  else if (loaded.source === 'unreadable') console.log('[save] this profile could not be read at all; nothing will be written over it')
  else if (!savable) console.log('[save] this save was written by a newer build; it will not be overwritten')
  // Two values on purpose: what the save document says, and what this session is actually rendering.
  // `?reduced=` is a debug override of the second only -- persisting it would let a URL param
  // permanently rewrite a player's setting the next time any autosave fires.
  let storedReducedEffects = savedSave.settings.reducedEffects
  let storedMaster = savedSave.settings.master
  let storedMusic = savedSave.settings.music
  let storedSfx = savedSave.settings.sfx
  let reducedEffects = q.has('reduced') ? q.get('reduced') !== '0' : storedReducedEffects
  let world: World = createWorld(seed, scenario, { god, ...(scenario === 'loop' ? { meta: savedSave.meta } : {}) })
  // A playtest session never resumes. The recorder's header says (seed, scenario, meta) and nothing
  // else, so replaying a bundle rebuilds a FRESH Bardo -- but a resumed world starts mid-descent at
  // the saved node. Arming a recording on one produces a bundle that is well-formed, carries the
  // right condition, passes the organizer's check, and replays frames from the Cistern into an
  // empty hub: a run that never happened, reported without a warning. The other three interlocks
  // (abandon hidden, F2/F3 locked, import refused) exist for exactly this reason; a reload mid-run
  // is the fourth. The tester loses that run, which is the outcome PLAYTEST.md already prescribes
  // for one that ended early, and the checkpoint is consumed below either way.
  const resumed = scenario === 'loop' && !playtest && !!savedSave.checkpoint
    && restoreCheckpoint(world, savedSave.checkpoint)
  // Set only for the roomEnter that the resume itself emits; cleared by the first arrival.
  let resumeEntryPending = resumed
  // Raised by a mid-run debit of PERMANENT currency, lowered by the next write that also stores a
  // checkpoint. See flushEvents: the debit and the checkpoint carrying what it bought must land
  // together, or the player pays and a reload takes the purchase back.
  let metaDebtPending = false
  if (scenario === 'loop' && savedSave.checkpoint) {
    // Consumed either way. A resumed checkpoint must not outlive its own load, or the same room can
    // be retried from its entry HP without limit; a refused one must not be retried every boot.
    savedSave = { ...savedSave, checkpoint: null }
    if (playtest) console.log('[playtest] a session is armed, so the saved descent was NOT resumed — that run is over, note it and discard its bundle')
    else if (!resumed) console.log('[save] checkpoint could not be restored; starting in the Bardo')
  }
  // Spatial audio starts with the player's actual spawn, before the first enemy tell can arrive.
  audio.setListener(world.player.x, world.player.y)
  audio.setLayout(world.rooms[world.roomIndex]?.layout ?? 'bardo')
  platform.setRunActive(world.session.run !== null)
  let userPaused = false
  let debugPaused = false
  let metrics = new Metrics()
  const presenter = new Presenter(ra, atlas, world)
  const titleFlow = new TitleFlow()
  let titleToken = 0
  const resetTitlePresenter = (): void => {
    titleFlow.cancel()
    titleToken = 0
    presenter.title.resetTransition()
    presenter.resetTitleFocus()
  }
  presenter.setReducedEffects(reducedEffects)
  const applyMix = (): void => {
    audio.setLevel('master', storedMaster)
    audio.setLevel('music', storedMusic)
    audio.setLevel('ambience', storedMusic)
    audio.setLevel('sfx', storedSfx)
    audio.setLevel('ui', storedSfx)
    presenter.title.setLevels(storedMaster, storedMusic, storedSfx)
    presenter.reward.setLevels(storedMaster, storedMusic, storedSfx)
  }
  applyMix()
  presenter.particles.attachRenderer(ra.app.renderer)
  // Refresh the ears immediately before every sound. Footsteps are cadence, not authority: a
  // stationary player and a freshly reset room must spatialize enemy tells just as accurately.
  presenter.onEvent = ev => playEventSfx(audio, ev, world.player)
  ra.onViewResize = () => { presenter.rebuildRoom(); presenter.hud.relayout(); presenter.reward.relayout(); presenter.routeMap.relayout(); presenter.title.relayout() }
  const input = new InputSystem(ra)
  const overlay = new DebugOverlay(ra.layers.debug, ra.layers.hud)
  overlay.setVisible(debug)
  let bot: ((w: World) => InputFrame) | null = botName ? makeBot(botName) : null
  const recorder = new Recorder()
  let replayFrames: InputFrame[] | null = null   // while set, these replace live/bot input
  let replayIdx = 0
  // R restarts whatever is currently running (not the URL scenario), so replays and __game.reset() restart correctly
  let cur = { seed, scenario, god }

  const reset = (s = cur.seed, sc = cur.scenario, opts: { god?: boolean; meta?: MetaState } = { god: cur.god }) => {
    if (presenter.title.visible) {
      resetTitlePresenter()
      presenter.title.setSoundGate(false)
      audio.setSuspended(true)
    }
    cur = { seed: s, scenario: sc, god: !!opts.god }
    const suppliedMeta = Object.prototype.hasOwnProperty.call(opts, 'meta')
    // A reset throws the run away, and with it whatever that run bought and never wrote down.
    // metaDebtPending means a permanent debit is live in memory and deliberately unpersisted (see
    // flushEvents). Carrying it across F2 or __game.reset() would keep the spend while the vessel
    // it paid for leaves with the run -- and worse, the latch would stay raised with no room
    // arrival left to lower it, so the NEXT thing to change meta (the Smith's reroll, bought and
    // confirmed on screen back in the Bardo) would be dropped from the envelope. savedSave.meta is
    // the last durable truth, which is exactly what a reload would have restored.
    const rolledBack = metaDebtPending && !suppliedMeta
    if (rolledBack) console.log('[save] the run was discarded before its purchase was written; the spend went with it')
    metaDebtPending = false
    const carried = rolledBack ? savedSave.meta : world.scenario === 'loop' ? world.session.meta : undefined
    const meta = sc === 'loop' ? (suppliedMeta ? opts.meta : carried) : undefined
    world = createWorld(s, sc, { ...opts, ...(meta ? { meta } : {}) })
    audio.setListener(world.player.x, world.player.y)
    audio.setLayout(world.rooms[world.roomIndex]?.layout ?? 'bardo')
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
    savedSave = bumpRevision({
      ...savedSave,
      settings: { version: 2, reducedEffects: storedReducedEffects, master: storedMaster, music: storedMusic, sfx: storedSfx },
    })
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
  // heavy verb by filtering the press at the source, so it can never be queued; the chain's
  // committed third swing is untouched, which IS the pre-verb behaviour under test.
  const filterVerbs = (f: InputFrame): InputFrame => {
    if (playtest === 'no-heavy' && f.heavy) return { ...f, heavy: false }
    return f
  }

  const flushEvents = () => {
    metrics.consume(world, world.events)
    presenter.handleEvents(world.events)
    // tests/sim/harness.test.ts hand-copies this ordering to prove the browser and headless agree
    // across a mid-replay restart. Keep the save write here -- after the events are handled, before
    // they are cleared -- and keep it read-only against `world`.
    if (world.scenario === 'loop' && world.events.some(ev =>
      ev.type === 'runStarted' || ev.type === 'roomEnter' || ev.type === 'boonChosen' || ev.type === 'riteChosen'
      || ev.type === 'shopBought' || ev.type === 'mysteryChosen' || ev.type === 'rerollUnlocked' || ev.type === 'vesselUnlocked'
      || (ev.type === 'smithSpoke' && (ev.beat === 'unburied' || ev.beat === 'cut' || ev.beat === 'commit'))
      || ev.type === 'runWon' || ev.type === 'runLost' || ev.type === 'returned'
    )) {
      // An explicit copy: reset() builds a NEW meta object, so holding the live one would leave this
      // pointing at a dead object and persist stale counters.
      // The checkpoint is a NODE-BOUNDARY save, so only a room arrival may write one. Every other
      // event here still persists meta (Remembrances are banked as they are earned) but leaves the
      // checkpoint alone: a snapshot taken after a room's reward banked would, on resume, re-enter
      // that room and grant the reward a second time — once per reload, forever.
      // An attempt that is over must leave nothing to resume into, or closing the game in the Bardo
      // and reopening it restores the last room as a live run.
      const terminal = world.events.some(ev => ev.type === 'runWon' || ev.type === 'runLost' || ev.type === 'returned')
      // Only an actual room ARRIVAL writes one. `runStarted` is flushed during the transition,
      // before enterRoom has recorded the visit or replaced the seed boundaryRng, so a checkpoint
      // taken there restores with empty history, depth 0 and RNG state 0.
      const arrived = !terminal && world.events.some(ev => ev.type === 'roomEnter')
      // A resume emits its own roomEnter (rooms.ts). Without this the checkpoint consumed at boot is
      // written straight back on the first tick, and the fight can be reloaded from entry HP forever.
      const fromResume = arrived && resumeEntryPending
      if (arrived) resumeEntryPending = false
      const writesCheckpoint = terminal || (arrived && !fromResume)
      const checkpointWrite = terminal ? { checkpoint: null }
        : arrived && !fromResume ? { checkpoint: captureCheckpoint(world) }
        : {}
      // The Unburied's memory option is the game's only mid-run change to permanent meta: it spends
      // Remembrances for max HP that lives in the RUN. The checkpoint beside it was captured at this
      // room's entry and knows nothing about the purchase, so persisting the debit on its own
      // charged the player for a vessel that the next reload handed straight back. Hold the debit
      // until a write that also stores a checkpoint, and the two halves move together: reload
      // before then and both roll back; die or win and the terminal write banks it as spent.
      if (!terminal && world.events.some(ev => ev.type === 'mysteryChosen')) metaDebtPending = true
      if (writesCheckpoint) metaDebtPending = false
      savedSave = {
        ...savedSave,
        ...(metaDebtPending ? {} : { meta: { ...world.session.meta, unlockedWeapons: [...world.session.meta.unlockedWeapons] } }),
        ...checkpointWrite,
      }
      void persist()
      platform.setRunActive(world.session.run !== null)   // so a desktop quit can ask before binning a run
    }
    world.events.length = 0
  }

  // Abandoning mutates the world from outside the recorded frame stream, so a replay of any
  // recording that spans one never returns to the hub and diverges from everything after it. The
  // row is therefore absent while ANY recording is live, not only a playtest session.
  const canGiveBack = () => !playtest && !recorder.recording && canAbandon(world)

  const giveTheAttemptBack = () => {
    if (!abandonRun(world)) return false
    flushEvents()
    setPaused(false)
    return true
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
    if (!recorder.capture(frame)) {
      console.log(`[replay] recording stopped at the ${MAX_REPLAY_FRAMES}-frame limit`)
      presenter.hud.showBanner('RECORDING LIMIT REACHED', 'reload before recording another run', 3.5)
    }
    stepWorld(world, frame)
    flushEvents()
    audio.setLayout(world.rooms[world.roomIndex]?.layout ?? 'bardo')
    if (world.wantsRestart) {
      // reset() clears replayFrames; a restart *inside* a replay keeps playing, matching runReplay()
      const frames = replayFrames, idx = replayIdx
      reset()
      replayFrames = frames; replayIdx = idx
    }
  }

  const record = (on = !recorder.recording) => {
    if (on && !recorder.recording) {
      if (!canRecordPlainReplay(replayCondition)) {
        console.log('[replay] plain recording refused: the active no-dash condition requires a playtest bundle')
        return false
      }
      reset()
      recorder.start(cur.seed, cur.scenario, cur.god, cur.scenario === 'loop' ? world.session.meta : undefined)
      console.log('[replay] recording (fresh run)')
    }
    else if (!on && recorder.recording) stopRecord()
    return recorder.recording
  }
  const stopRecord = (): Replay | null => {
    if (!canRecordPlainReplay(replayCondition)) {
      console.log('[replay] plain recording stop refused: the active no-dash condition requires a playtest bundle')
      return null
    }
    const r = recorder.stop()
    console.log(`[replay] ${r.frames.length} frames; suggested file replays/${recorder.suggestedName(r)}`)
    console.log(replayToJson(r))
    return r
  }
  const replay = (r: Replay | EncodedReplay) => {
    // A playtest bundle is an encoded replay plus its condition, and no-dash lives in the tuning
    // rather than in the frames — so replaying one without re-applying it measures a baseline run.
    // Sticky for the rest of the session on purpose: `pnpm shot --replay bundle.json` is one shot,
    // and a live session that has installed a no-dash replay is no longer a baseline session.
    const bundled = conditionOfBundle(r)
    if (bundled) {
      applyPlaytestCondition(bundled)
      if (bundled === 'no-dash' || replayCondition !== 'no-dash') replayCondition = bundled
      console.log(`[replay] playtest bundle: condition "${bundled}" applied`)
    }
    const rep = isEncodedReplay(r) ? decodeReplay(r) : r
    reset(rep.seed, rep.scenario, {
      god: rep.god,
      ...(rep.scenario === 'loop' ? { meta: rep.meta ?? defaultMetaState() } : {}),
    })
    // A replay is a measurement, even when it is installed through the live debug API after boot.
    // Do not leave the first-impression title intercepting F/V/E/I while the replay owns input.
    resetTitlePresenter()
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
      const titleUp = !!pad?.buttons[12]?.pressed
      const titleDown = !!pad?.buttons[13]?.pressed
      const titleLeft = !!pad?.buttons[14]?.pressed
      const titleRight = !!pad?.buttons[15]?.pressed
      if (titleWasUp) {
        if (titleFlow.phase === 'idle' && presenter.title.soundGated) {
          if (titleStartNow && !padTitlePrev) void beginTitleDescent(false)
        } else if (titleFlow.phase === 'idle') {
          if (titleUp && !padTitleUpPrev) presenter.title.move(-1)
          if (titleDown && !padTitleDownPrev) presenter.title.move(1)
          if (titleLeft && !padTitleLeftPrev) nudgeTitleLevel(-1)
          if (titleRight && !padTitleRightPrev) nudgeTitleLevel(1)
          if (titleStartNow && !padTitlePrev) answerTitle(false)
        }
      }
      padTitlePrev = titleStartNow
      padTitleUpPrev = titleUp
      padTitleDownPrev = titleDown
      padTitleLeftPrev = titleLeft
      padTitleRightPrev = titleRight
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
      if (userPaused && !titleWasUp) {
        const leaving = canGiveBack()
        const up = !!pad?.buttons[12]?.pressed
        const down = !!pad?.buttons[13]?.pressed
        const left = !!pad?.buttons[14]?.pressed
        const right = !!pad?.buttons[15]?.pressed
        if (up && !padPauseUpPrev) presenter.reward.movePause(-1, leaving)
        if (down && !padPauseDownPrev) presenter.reward.movePause(1, leaving)
        if (left && !padPauseLeftPrev) nudgePauseLevel(-1)
        if (right && !padPauseRightPrev) nudgePauseLevel(1)
        padPauseUpPrev = up
        padPauseDownPrev = down
        padPauseLeftPrev = left
        padPauseRightPrev = right
        const choose = PAD_PAUSE_CHOOSE.some(i => !!pad?.buttons[i]?.pressed)
        if (choose && !padPauseChoosePrev) answerPause(leaving)
        padPauseChoosePrev = choose
      } else {
        padPauseUpPrev = padPauseDownPrev = padPauseLeftPrev = padPauseRightPrev = padPauseChoosePrev = false
      }
      returnOpenThisFrame = false
      presenter.reward.setPaused(userPaused)
      // The card must be told, not left to ask the sim: canAbandon(world) is true in a playtest
      // session where giving the descent back is forbidden, and the card would draw a row that
      // navigation has no index for.
      presenter.reward.setLeaving(canGiveBack())
      presenter.routeMap.setPaused(userPaused)
      presenter.render(alpha, dt)
      if (titleFlow.phase === 'descending' && presenter.title.descentComplete) finishTitleDescent()
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
  const PAD_PAUSE_CHOOSE = [0, 2]
  let padStartPrev = false
  let padTitlePrev = false
  let padTitleUpPrev = false
  let padTitleDownPrev = false
  let padTitleLeftPrev = false
  let padTitleRightPrev = false
  let padPauseUpPrev = false
  let padPauseDownPrev = false
  let padPauseLeftPrev = false
  let padPauseRightPrev = false
  let padPauseChoosePrev = false
  let returnOpenThisFrame = false
  const firstPad = (): Gamepad | null => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    return (pads && pads[0]) || null
  }
  const padStartButton = (pad: Gamepad | null): boolean =>
    !!pad && PAD_RESTART.some(i => !!pad.buttons[i]?.pressed)
  const padWantsStart = (pad: Gamepad | null): boolean =>
    !!pad && PAD_START.some(i => !!pad.buttons[i]?.pressed)

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
    shellPause: p => {
      setPaused(p ?? !userPaused)
      return userPaused
    },
    abandon: () => giveTheAttemptBack(),
    loop,
    presenter,
    get metrics() { return metrics },
    mute: m => { audio.muted = m ?? !audio.muted; return audio.muted },
    title: show => {
      const want = show ?? !presenter.title.visible
      if (want) {
        resetTitlePresenter()
        presenter.title.setSoundGate(false)
        presenter.title.setShown(true)
        loop.paused = true
        audio.setSuspended(true)
      } else hideTitleImmediately()
      return presenter.title.visible
    },
    debug: v => { overlay.setVisible(v ?? !overlay.visible); return overlay.visible },
    record, stopRecord, replay,
    download: name => {
      if (!canRecordPlainReplay(replayCondition)) {
        console.log('[replay] plain download refused: the active no-dash condition requires a playtest bundle')
        return
      }
      if (recorder.recording) stopRecord()
      recorder.download(name)
    },
    inspectSave: () => ({
      schemaVersion: savedSave.schemaVersion,
      contentRevision: savedSave.contentRevision,
      revision: savedSave.revision,
      meta: savedSave.meta,
      checkpoint: savedSave.checkpoint,
    }),
  })

  // Re-running resize() after a fullscreen change lets the view re-fit to the new aspect. The
  // fullscreen call itself lives in src/platform (it is the host's job); this is the renderer's.
  document.addEventListener('fullscreenchange', () => ra.resize())
  const exportSave = async () => {
    // Nothing was read, so there is nothing to export: serialising the in-memory defaults here would
    // hand the player a zeroed file labelled as their backup of the inaccessible profile.
    if (loaded.source === 'unreadable') { presenter.hud.showBanner('NOTHING TO EXPORT', 'the save could not be read', 2.4); return }
    // For a save from a newer build, export the bytes as they were READ: re-serialising would emit a
    // current-schema document with the newer build's fields quietly dropped, which is indistinguishable
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
      // An import calls reset(), which stops the recorder; a playtest session has no way to rearm
      // it, so every later F4 would report that nothing is recording.
      if (playtest) { presenter.hud.showBanner('A PLAYTEST IS ARMED', 'reload without ?playtest to import', 2.4); return }
      const priorSave = savedSave
      const priorStoredReducedEffects = storedReducedEffects
      const priorStoredMaster = storedMaster
      const priorStoredMusic = storedMusic
      const priorStoredSfx = storedSfx
      savedSave = parsed.save
      storedReducedEffects = savedSave.settings.reducedEffects
      storedMaster = savedSave.settings.master
      storedMusic = savedSave.settings.music
      storedSfx = savedSave.settings.sfx
      // The imported counters and success banner are applied only after the coalesced writer says
      // the exact logical update is durable. A refused disk write therefore cannot look successful.
      if (!await persist()) {
        savedSave = priorSave
        storedReducedEffects = priorStoredReducedEffects
        storedMaster = priorStoredMaster
        storedMusic = priorStoredMusic
        storedSfx = priorStoredSfx
        presenter.hud.showBanner('SAVE NOT IMPORTED', 'the file could not be written', 2.4)
        return
      }
      reducedEffects = savedSave.settings.reducedEffects
      presenter.setReducedEffects(reducedEffects)
      applyMix()
      setPaused(false)
      // reset() rebuilds the world with the imported meta and rebinds the presenter. Deliberately not a
      // reload: that would drop ?bot=/?seed=, destroy window.__game mid-evaluate and break an attached
      // Playwright page.
      let resumedImport = false
      if (world.scenario === 'loop') {
        reset(cur.seed, cur.scenario, { god: cur.god, meta: savedSave.meta })
        // An imported document can carry a live descent. Without this the run existed only on disk:
        // the player stood in the Bardo with no sign of it, and the first room of their NEXT descent
        // overwrote the checkpoint, so the imported run was gone before they could reload into it.
        if (savedSave.checkpoint) {
          resumedImport = restoreCheckpoint(world, savedSave.checkpoint)
          resumeEntryPending = resumedImport
          // Consumed either way, exactly as at boot: a restored checkpoint must not outlive its own
          // load, or the room can be retried from entry HP forever; a refused one must not be
          // retried on every later import.
          savedSave = { ...savedSave, checkpoint: null }
          void persist()
        }
      }
      presenter.hud.showBanner(
        resumedImport ? 'DESCENT RESUMED' : 'SAVE IMPORTED',
        resumedImport ? 'the imported run continues here' : townTally(savedSave.meta.attempts, savedSave.meta.victories, savedSave.meta.remembrances),
        2.2,
      )
    } finally { importing = false }
  }

  // Arm the playtest session: record from tick zero (the world is fresh here, so no reset is
  // needed), and keep the meta snapshot the recorder was handed — the exported bundle must carry
  // the exact counters the run seed was derived from, not the ones the session has mutated since.
  // Conditions a recording cannot carry are re-applied here and, identically, by every replay path
  // (src/playtest.ts explains which is which). no-heavy rides in the frames; no-dash does not.
  if (playtest && !botName) {
    applyPlaytestCondition(playtest)
    if (playtest === 'no-dash') console.log('[playtest] no-dash: the dodge-to-attack cancel is disabled for this session')
  }
  if (playtest && !botName) {
    // The recorder takes its own defensive copy of meta and holds it for the whole session, so the
    // bundle is always stamped with the counters the run seeds were derived from.
    recorder.start(cur.seed, cur.scenario, cur.god, cur.scenario === 'loop' ? world.session.meta : undefined)
    console.log(`[playtest] session armed: condition "${playtest}", recording from tick 0 — F4 exports the bundle`)
  }
  const exportPlaytestBundle = () => {
    // A snapshot, not a stop: the session keeps recording so a tester can export after every run.
    const snapshot = recorder.snapshot()
    if (!snapshot) {
      presenter.hud.showBanner(
        recorder.limitReached ? 'RECORDING TOO LONG' : 'NOTHING RECORDING',
        recorder.limitReached ? 'discard this run and reload' : 'reload to arm the playtest',
        2.2,
      )
      return
    }
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
    downloadJson(`bundle-${playtest}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(bundle))
    presenter.hud.showBanner('BUNDLE EXPORTED', 'send the download to the organizer', 2.4)
  }

  // The title is held over the living hub: the simulation is stopped but the loop keeps rendering,
  // so the room the player is about to stand in gutters and drifts behind its own name. A run driven
  // by a bot or a replay skips it - those are measurements, not first impressions.
  const wantsTitle = scenario === 'loop' && !botName && !resumed
  presenter.title.setShown(wantsTitle)
  if (wantsTitle) presenter.resetTitleFocus()

  // One place decides what "paused" means, so the sim, the audio clock and the overlay can never
  // disagree. Pausing used to stop only the simulation: the bed kept playing behind the overlay and
  // a backgrounded tab kept a synthesiser running indefinitely.
  const setPaused = (p: boolean) => {
    // Seed the pause card's pad edges from the buttons ALREADY down when it opens. A controller
    // player pausing mid-attack holds A; without this the card sees A down with no previous state,
    // reads it as a fresh press, confirms the focused RISE row and closes on the frame it opened —
    // so pausing was impossible in exactly the case you most want to pause.
    if (p && !userPaused) {
      const pad = firstPad()
      padPauseUpPrev = !!pad?.buttons[PAD_MENU_UP]?.pressed
      padPauseDownPrev = !!pad?.buttons[PAD_MENU_DOWN]?.pressed
      padPauseLeftPrev = !!pad?.buttons[PAD_CHOICE_LEFT]?.pressed
      padPauseRightPrev = !!pad?.buttons[PAD_CHOICE_RIGHT]?.pressed
      padPauseChoosePrev = PAD_PAUSE_CHOOSE.some(i => !!pad?.buttons[i]?.pressed)
    }
    // Resuming: the press that operated the card must not also reach the game. sample() is what
    // drains latched pulses and ages pad edges, and it has not run since the pause began — so the
    // Enter that chose RESUME would confirm the modal underneath, and A would roll the player.
    const playerHeld = p || presenter.title.visible
    if (userPaused !== p) input.releaseHeldIntent()
    userPaused = p
    loop.paused = playerHeld || debugPaused
    // The debug hold freezes deterministic captures but deliberately leaves the rendered/audio
    // surface live, matching the API's original contract. Player/title pause owns the audio clock.
    audio.setSuspended(playerHeld)
  }

  // A gamepad button is not browser user activation. It may ask the browser to resume audio, but it
  // may not dismiss the title until the audio clock actually runs. A real key/click performs that
  // resume inside its activation; mute=1 bypasses the gate because silence was explicitly requested.
  const holdTitleAtGate = (soundGate: boolean): void => {
    resetTitlePresenter()
    presenter.title.setSoundGate(soundGate)
    presenter.title.setShown(true)
    loop.paused = true
    audio.setSuspended(true)
  }

  const hideTitleImmediately = (): void => {
    if (!presenter.title.visible) return
    resetTitlePresenter()
    presenter.title.setSoundGate(false)
    presenter.title.setShown(false)
    setPaused(userPaused)
  }

  const beginTitleDescent = async (gesture = false): Promise<boolean> => {
    if (!presenter.title.visible) return true
    const token = titleFlow.beginUnlock()
    if (token === null) return false
    titleToken = token
    audio.setSuspended(false)
    if (!mute) {
      if (gesture) await audio.resumeFromGesture()
      else audio.tryUnlock()
      if (!titleFlow.owns(token, 'unlocking')) return false
      if (audio.needsGesture) {
        holdTitleAtGate(true)
        return false
      }
    }
    if (!titleFlow.beginDescent(token)) return false
    presenter.title.setSoundGate(false)
    presenter.title.beginDescent()
    loop.paused = true
    return true
  }

  const finishTitleDescent = (): void => {
    if (!titleFlow.finish(titleToken)) return
    titleToken = 0
    presenter.title.setShown(false)
    presenter.resetTitleFocus()
    // The input listeners stay live while the descent owns the paused loop. Anything pressed in
    // that 1.45 s window is presentation input, not a buffered first combat action.
    input.releaseHeldIntent()
    setPaused(userPaused)
  }
  if (wantsTitle) setPaused(false)

  // Losing focus is a pause the player did not ask for but always wants: a tab switch should not
  // cost health, and it should not keep making noise from behind another window.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return
    if (presenter.title.visible) holdTitleAtGate(presenter.title.soundGated)
    else setPaused(true)
  })

  const applyReduced = (next: boolean) => {
    reducedEffects = next
    storedReducedEffects = next
    presenter.setReducedEffects(reducedEffects)
    void persist()
  }

  const applyLevelNudge = (which: 'master' | 'music' | 'sfx', delta: -1 | 1): void => {
    if (which === 'master') storedMaster = nudgeSlider(storedMaster, delta)
    else if (which === 'music') storedMusic = nudgeSlider(storedMusic, delta)
    else storedSfx = nudgeSlider(storedSfx, delta)
    applyMix()
    void persist()
  }

  const nudgeTitleLevel = (delta: -1 | 1): void => {
    const which = titleNudge(presenter.title.currentPage(), presenter.title.currentFocus())
    if (which === 'none') return
    applyLevelNudge(which, delta)
  }

  const nudgePauseLevel = (delta: -1 | 1): void => {
    const which = presenter.reward.nudgePause()
    if (which === 'none') return
    applyLevelNudge(which, delta)
  }

  const answerPause = (leaving: boolean): void => {
    const act = presenter.reward.confirmPause(leaving)
    if (act === 'resume') setPaused(false)
    else if (act === 'abandon') giveTheAttemptBack()
    else if (act === 'toggle-still') applyReduced(!reducedEffects)
    // The same host verb F carries; the row mirrors the title's so both settings pages share one order.
    // A gamepad confirm arrives from polling, outside any user activation, and the browser refuses
    // the request — say so instead of letting the row silently do nothing.
    else if (act === 'fullscreen') void platform.fullscreen().then(ok => { if (!ok) presenter.hud.showBanner('FULLSCREEN NEEDS A KEY', 'PRESS F', 2.4) })
  }

  const answerTitle = (gesture: boolean): void => {
    if (titleFlow.phase !== 'idle') return
    if (presenter.title.soundGated) { void beginTitleDescent(gesture); return }
    const act = presenter.title.confirm()
    if (act === 'descend') void beginTitleDescent(gesture)
    else if (act === 'toggle-still') applyReduced(!reducedEffects)
    // The same host verb F carries; the row exists so the control is discoverable from Settings.
    // On a gamepad confirm (no user activation) the browser refuses; the settings foot says why.
    else if (act === 'fullscreen') void platform.fullscreen().then(ok => { if (!ok) presenter.title.say('FULLSCREEN NEEDS A KEY. PRESS F') })
  }

  // A click answers the focused title verb. Registered on the window rather than the canvas so a
  // player who clicks the letterbox is not left staring at a screen that ignores them.
  window.addEventListener('mousedown', () => {
    if (!presenter.title.visible) return
    answerTitle(true)
  })

  window.addEventListener('keydown', e => {
    // F belongs to the host even while the title is holding the sim. Treating every title key as
    // "descend" swallowed the desktop app's first fullscreen press and made the advertised window
    // control appear broken until the player pressed it twice.
    if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); void platform.fullscreen(); return }
    if (presenter.title.visible) {
      if (e.repeat) return
      // F1–F3 stay harness keys on the title; everything else is a verb or is swallowed so a
      // stray letter cannot descend, and so Escape on the gate cannot open the pause card.
      if (e.code !== 'F1' && e.code !== 'F2' && e.code !== 'F3') {
        e.preventDefault()
        if (titleFlow.phase !== 'idle') return
        if (presenter.title.soundGated) { void beginTitleDescent(true); return }
        if (e.code === 'ArrowUp' || e.code === 'KeyW') { presenter.title.move(-1); return }
        if (e.code === 'ArrowDown' || e.code === 'KeyS') { presenter.title.move(1); return }
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') { nudgeTitleLevel(-1); return }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') { nudgeTitleLevel(1); return }
        if (e.code === 'Escape') { presenter.title.back(); return }
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') { answerTitle(true); return }
        if (e.code === 'KeyV') applyReduced(!reducedEffects)
        return
      }
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
      e.preventDefault()
      if (e.code === 'Escape' && userPaused && presenter.reward.backPause(canGiveBack())) return
      setPaused(!userPaused)
      return
    }
    if (userPaused && !e.repeat) {
      const leaving = canGiveBack()
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); presenter.reward.movePause(-1, leaving); return }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); presenter.reward.movePause(1, leaving); return }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); nudgePauseLevel(-1); return }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); nudgePauseLevel(1); return }
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') {
        e.preventDefault()
        answerPause(leaving)
        return
      }
    }
    if (e.code === 'KeyV' && !e.repeat && !importing) applyReduced(!reducedEffects)
    if (e.code === 'F1') { e.preventDefault(); overlay.toggle() }
    // The dev recording keys are locked out while a playtest session is armed: F2 would restart the
    // recorder against a mutated meta and F3 would end the session outright, either way silently
    // gutting the bundle a tester is about to hand over.
    if (e.code === 'F2') { e.preventDefault(); if (playtest) console.log('[playtest] F2 is disabled while a session is armed'); else record() }
    if (e.code === 'F3') { e.preventDefault(); if (playtest) console.log('[playtest] F3 is disabled while a session is armed'); else { if (recorder.recording) stopRecord(); recorder.download() } }
    if (e.code === 'F4' && playtest && !e.repeat) { e.preventDefault(); exportPlaytestBundle() }
    // Save management is reachable only from the pause screen, so it can never fire mid-fight.
    if (userPaused && !importing && e.code === 'KeyE' && !e.repeat) { e.preventDefault(); void exportSave() }
    if (userPaused && !importing && e.code === 'KeyI' && !e.repeat) { e.preventDefault(); void importSave() }
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
    else if (loaded.raw) presenter.hud.showBanner('SAVE FROM A NEWER BUILD', 'playing without saving, nothing will be overwritten', 3.5)
    else if (loaded.source === 'backup') presenter.hud.showBanner(
      'SAVE RESTORED',
      loaded.writable ? 'recovered from the backup copy' : 'backup recovered; progress here will not be saved',
      3.5,
    )
    else if (!savable) presenter.hud.showBanner('SAVE FROM A NEWER BUILD', 'playing without saving, nothing will be overwritten', 3.5)
    else if (loaded.source === 'damaged') presenter.hud.showBanner('SAVE WAS DAMAGED', 'a fresh start; the damaged file is kept', 3.5)
  }
}

boot().catch(err => { console.error(err); document.body.innerHTML = `<pre style="color:#f88;padding:16px">${String(err?.stack ?? err)}</pre>` })
