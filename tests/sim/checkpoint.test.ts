import { describe, expect, it } from 'vitest'
import { captureCheckpoint, parseCheckpoint, restoreCheckpoint } from '@/sim/checkpoint'
import { hashWorld } from '@/sim/hash'
import { enterRoomById } from '@/sim/rooms'
import { Rng } from '@/sim/rng'
import { serializeSave, parseSave, defaultSave } from '@/sim/save'
import { createWorld } from '@/sim/scenarios'
import { prepareWeapon, startRun } from '@/sim/session'

function beginFirstCombat(seed = 11) {
  const world = createWorld(seed, 'loop')
  prepareWeapon(world, 'blade')
  startRun(world, 'threshold')
  const first = world.session.run!.map!.nodes[0]!.id
  enterRoomById(world, first)
  return world
}

describe('Rng.fromState', () => {
  it('continues the same stream', () => {
    const a = new Rng(99)
    a.next(); a.next()
    const b = Rng.fromState(a.state)
    expect(b.next()).toBe(a.next())
    expect(b.next()).toBe(a.next())
  })
})

describe('node-boundary checkpoint', () => {
  it('is null in town and after the attempt has not started', () => {
    expect(captureCheckpoint(createWorld(1, 'loop'))).toBeNull()
  })

  it('captures the current node and restores an equivalent opening', () => {
    const live = beginFirstCombat()
    const snap = captureCheckpoint(live)
    expect(snap).not.toBeNull()
    if (!snap) return
    const first = live.rooms[live.roomIndex]!.id
    expect(snap.roomId).toBe(first)
    expect(snap.history.map(v => v.id)).toEqual([first])
    expect(snap.map?.nodes.map(n => n.id)).toEqual(live.session.run!.map!.nodes.map(n => n.id))
    expect(snap.map?.nodes.some(n => n.id === 'warden')).toBe(true)

    const a = createWorld(1, 'loop', { meta: { version: 1, attempts: live.session.meta.attempts, victories: 0, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] } })
    const b = createWorld(1, 'loop', { meta: { version: 1, attempts: live.session.meta.attempts, victories: 0, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] } })
    expect(restoreCheckpoint(a, snap)).toBe(true)
    expect(restoreCheckpoint(b, snap)).toBe(true)
    expect(a.session.meta.attempts).toBe(live.session.meta.attempts)
    expect(a.rooms[a.roomIndex]!.id).toBe(first)
    const river = live.rooms.find(r => r.id === 'cocytus' || r.id === 'phlegethon')!
    expect(a.rooms.find(r => r.id === river.id)!.layout).toBe(river.layout)
    expect(a.session.run?.boonBits).toBe(live.session.run?.boonBits)
    expect(hashWorld(a)).toBe(hashWorld(b))
  })

  it('round-trips through the save envelope without losing the run', () => {
    const live = beginFirstCombat()
    const snap = captureCheckpoint(live)!
    const save = { ...defaultSave(), meta: live.session.meta, checkpoint: snap, revision: 1 }
    const raw = serializeSave(save)
    const parsed = parseSave(raw)
    expect(parsed.kind).toBe('ok')
    expect(parsed.save.checkpoint?.roomId).toBe(live.rooms[live.roomIndex]!.id)
    expect(parsed.save.checkpoint?.map?.nodes.map(n => n.id)).toEqual(snap.map?.nodes.map(n => n.id))
    expect(serializeSave(parsed.save)).toBe(raw)
  })

  it('drops a damaged checkpoint and keeps the profile', () => {
    const raw = serializeSave({
      ...defaultSave(),
      meta: { version: 1, attempts: 4, victories: 1, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] },
      checkpoint: { version: 1, roomId: 'threshold' } as never,
    })
    const parsed = parseSave(raw)
    expect(parsed.kind).toBe('ok')
    expect(parsed.save.meta.attempts).toBe(4)
    expect(parsed.save.checkpoint).toBeNull()
    expect(parseCheckpoint({ version: 1, roomId: 'threshold' })).toBeNull()
  })
})

describe('restoreCheckpoint refuses a node this build does not have', () => {
  // The guard used to compare run.roomId against snap.roomId — but it assigned run.roomId FROM the
  // snapshot first, so it could never return false. A checkpoint naming an unknown room therefore
  // reported success and left the player in the hub holding a live run, on every reload.
  it('returns false instead of stranding the player with a live run', () => {
    const world = beginFirstCombat()
    const snap = captureCheckpoint(world)!
    expect(snap).not.toBeNull()

    const fresh = createWorld(11, 'loop')
    const ok = restoreCheckpoint(fresh, { ...snap, roomId: 'a-room-no-route-contains' })
    expect(ok).toBe(false)
  })

  it('still restores a node the route does contain', () => {
    const world = beginFirstCombat()
    const snap = captureCheckpoint(world)!
    const fresh = createWorld(11, 'loop')
    expect(restoreCheckpoint(fresh, snap)).toBe(true)
    expect(fresh.rooms[fresh.roomIndex]?.id).toBe(snap.roomId)
  })
})

describe('a checkpoint only ever describes a node entry', () => {
  // Capturing after a room banked its reward meant resume re-entered that room and granted it
  // again — once per reload, without limit.
  it('is null in town, so coming home cannot be resumed into', () => {
    const world = createWorld(11, 'loop')
    expect(captureCheckpoint(world)).toBeNull()
  })
})

describe('a checkpoint carries the obligations the room has already queued', () => {
  // enterRoom runs beginRoomFight -- which clears riteDebt/mysteryHunt and turns each into a
  // 150-tick delayed spawn -- BEFORE it emits the roomEnter the checkpoint rides on. Reading the
  // flag alone therefore captured `false` with the shade still in a queue no checkpoint stores, so
  // reloading in the Hall deleted the entire consequence of refusing the toll.
  it('treats a queued debt shade as still owed', () => {
    const world = beginFirstCombat()
    const run = world.session.run!
    run.riteDebt = false
    world.spawnQueue.push({ kind: 'charger', x: 10, y: 6, ticksLeft: 150, total: 150, debt: true })
    expect(captureCheckpoint(world)!.riteDebt).toBe(true)
  })

  it('treats a queued hunt the same way', () => {
    const world = beginFirstCombat()
    const run = world.session.run!
    run.mysteryHunt = false
    world.spawnQueue.push({ kind: 'charger', x: 10, y: 6, ticksLeft: 150, total: 150, hunt: true })
    expect(captureCheckpoint(world)!.mysteryHunt).toBe(true)
  })

  it('does not invent one when nothing is owed', () => {
    const world = beginFirstCombat()
    world.session.run!.riteDebt = false
    world.session.run!.mysteryHunt = false
    const snap = captureCheckpoint(world)!
    expect(snap.riteDebt).toBe(false)
    expect(snap.mysteryHunt).toBe(false)
  })

  it('survives the round trip in one form or the other', () => {
    const world = beginFirstCombat()
    world.session.run!.riteDebt = false
    world.spawnQueue.push({ kind: 'charger', x: 10, y: 6, ticksLeft: 150, total: 150, debt: true })
    const snap = captureCheckpoint(world)!
    const fresh = createWorld(11, 'loop')
    expect(restoreCheckpoint(fresh, snap)).toBe(true)
    // Either still flagged, or already re-collected into the queue by the re-entry. Both are the
    // obligation surviving; neither is it silently gone.
    expect(fresh.session.run!.riteDebt || fresh.spawnQueue.some(s => s.debt)).toBe(true)
  })
})

describe('a resumed attempt keeps its own clock', () => {
  // The world restarts at tick 0 on a reload. startedTick used to restart with it, so the eventual
  // runWon/runLost reported only the time since the resume: a nine-minute descent that was reloaded
  // once read as ninety seconds.
  it('records how long the attempt had already run', () => {
    const world = beginFirstCombat()
    world.tick = world.session.run!.startedTick + 4321
    expect(captureCheckpoint(world)!.elapsed).toBe(4321)
  })

  it('backdates startedTick so the duration continues across the reload', () => {
    const world = beginFirstCombat()
    world.tick = world.session.run!.startedTick + 4321
    const snap = captureCheckpoint(world)!
    const fresh = createWorld(11, 'loop')
    expect(restoreCheckpoint(fresh, snap)).toBe(true)
    expect(fresh.tick - fresh.session.run!.startedTick).toBe(4321)
  })

  it('reads a document written before the field existed as zero elapsed', () => {
    const world = beginFirstCombat()
    world.tick = world.session.run!.startedTick + 500
    const snap = captureCheckpoint(world)!
    const { elapsed: _dropped, ...older } = snap
    expect(parseCheckpoint(older)!.elapsed).toBe(0)
  })
})

describe('a checkpoint is refused when the route it describes no longer exists', () => {
  // snap.roomId surviving a content update is not enough: the rebuilt rooms are what door traversal
  // and the overlay read, so a moved door would walk the player down a route their snapshot never
  // generated -- silently, and only for saves that crossed the update.
  it('refuses a snapshot whose saved topology disagrees with the rebuilt one', () => {
    const world = beginFirstCombat()
    const snap = captureCheckpoint(world)!
    const moved = {
      ...snap,
      map: {
        ...snap.map!,
        nodes: snap.map!.nodes.map((n, i) => i === 0 ? { ...n, edges: [] } : n),
      },
    }
    expect(restoreCheckpoint(createWorld(11, 'loop'), moved)).toBe(false)
  })

  it('still accepts one whose topology is unchanged', () => {
    const world = beginFirstCombat()
    const snap = captureCheckpoint(world)!
    expect(restoreCheckpoint(createWorld(11, 'loop'), snap)).toBe(true)
  })

  it('accepts a mapless snapshot, which predates the route entirely', () => {
    const world = beginFirstCombat()
    const snap = captureCheckpoint(world)!
    expect(restoreCheckpoint(createWorld(11, 'loop'), { ...snap, map: null })).toBe(true)
  })
})

describe('the Smith keeps the answer he has not spoken to yet', () => {
  // lastMystery lives on the session, not the run, and the Smith consumes it after the descent. A
  // reload built a fresh session, so the one-time UNBURIED line was simply never spoken.
  it('carries a pending LEAVE HIM across the reload', () => {
    const world = beginFirstCombat()
    world.session.lastMystery = 'leave'
    const snap = captureCheckpoint(world)!
    expect(snap.lastMystery).toBe('leave')
    const fresh = createWorld(11, 'loop')
    expect(restoreCheckpoint(fresh, snap)).toBe(true)
    expect(fresh.session.lastMystery).toBe('leave')
  })

  it('reads a document written before the field existed as nothing pending', () => {
    const world = beginFirstCombat()
    const snap = captureCheckpoint(world)!
    const { lastMystery: _dropped, ...older } = snap
    expect(parseCheckpoint(older)!.lastMystery).toBeNull()
  })
})
