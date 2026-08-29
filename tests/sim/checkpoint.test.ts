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
