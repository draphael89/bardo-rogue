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
