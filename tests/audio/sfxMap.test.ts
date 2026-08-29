import { describe, expect, it } from 'vitest'
import { AudioSystem, type PlayOpts } from '@/audio/audio'
import { playEventSfx, resetSfxState } from '@/audio/sfxMap'
import type { HitEvent, WardenAttackPattern } from '@/sim/events'

function hit(overrides: Partial<HitEvent> = {}): HitEvent {
  return {
    type: 'hit', x: 80, y: 40, angle: 0, damage: 2, attemptedDamage: 5,
    mitigatedDamage: 3, guarded: true, heavy: true, targetId: 7, kind: 'warden',
    killed: false, actionId: 3, source: 'blade', originX: 60, originY: 40,
    direction: 0, sweep: 1, cleave: false, contactDepth: 0.8, ...overrides,
  }
}

describe('wall-roll audio truth', () => {
  it('places a restrained two-layer contact at the blocked player', () => {
    const plays: Array<{ name: string; opts: PlayOpts }> = []
    const listeners: Array<[number, number]> = []
    const audio = {
      play: (name: string, opts: PlayOpts = {}) => { plays.push({ name, opts }) },
      setListener: (x: number, y: number) => { listeners.push([x, y]) },
    } as unknown as AudioSystem

    resetSfxState()
    playEventSfx(audio, { type: 'dodgeWall', x: 41, y: 73, angle: Math.PI })

    expect(listeners).toEqual([[41, 73]])
    expect(plays.map(x => x.name)).toEqual(['swordStone2', 'impactGeneric_light'])
    expect(plays.every(x => (x.opts.gain ?? 1) < 0.5)).toBe(true)
    expect(plays.every(x => x.opts.x === 41 && x.opts.y === 73)).toBe(true)
  })
})

describe('browser audio activation truth', () => {
  function withLiveContext(context: { state: AudioContextState; resume(): Promise<void> }): AudioSystem {
    const audio = new AudioSystem()
    ;(audio as unknown as { liveCtx: typeof context }).liveCtx = context
    return audio
  }

  it('keeps asking for a real gesture after a programmatic controller resume is refused', async () => {
    const context = {
      state: 'suspended' as AudioContextState,
      resume: () => Promise.reject(new Error('not a user activation')),
    }
    const audio = withLiveContext(context)

    expect(audio.needsGesture).toBe(true)
    audio.tryUnlock()
    await Promise.resolve()
    expect(audio.needsGesture).toBe(true)
  })

  it('reports the actual gesture resume decision instead of assuming sound started', async () => {
    const accepted = {
      state: 'suspended' as AudioContextState,
      async resume() { this.state = 'running' },
    }
    const rejected = {
      state: 'suspended' as AudioContextState,
      resume: () => Promise.reject(new Error('refused')),
    }

    const audible = withLiveContext(accepted)
    expect(await audible.resumeFromGesture()).toBe(true)
    expect(audible.needsGesture).toBe(false)

    const silent = withLiveContext(rejected)
    expect(await silent.resumeFromGesture()).toBe(false)
    expect(silent.needsGesture).toBe(true)
  })
})

describe('combat audio authority', () => {
  it('keeps a guarded Warden contact lighter than exposed flesh', () => {
    const guarded: Array<{ name: string; opts: PlayOpts }> = []
    const exposed: Array<{ name: string; opts: PlayOpts }> = []
    const guardedAudio = { play: (name: string, opts: PlayOpts = {}) => { guarded.push({ name, opts }) } } as unknown as AudioSystem
    const exposedAudio = { play: (name: string, opts: PlayOpts = {}) => { exposed.push({ name, opts }) } } as unknown as AudioSystem

    playEventSfx(guardedAudio, hit())
    playEventSfx(exposedAudio, hit({ guarded: false, damage: 5, mitigatedDamage: 0 }))

    expect(guarded.map(x => x.name)).toEqual(['swordStone2', 'impactPlate_medium'])
    expect(guarded.every(x => (x.opts.gain ?? 1) < 0.25)).toBe(true)
    expect(exposed.map(x => x.name)).toContain('impactPunch_medium')
    expect(Math.max(...guarded.map(x => x.opts.gain ?? 1))).toBeLessThan(Math.max(...exposed.map(x => x.opts.gain ?? 1)))
  })

  it('gives ring and fan releases no slam thump', () => {
    const thumps: WardenAttackPattern[] = []
    const current = { pattern: 'slam' as WardenAttackPattern }
    const audio = {
      play: () => {}, bell: () => {}, swish: () => {},
      thump: () => { thumps.push(current.pattern) },
    } as unknown as AudioSystem

    for (const pattern of ['slam', 'ring', 'fan'] as const) {
      current.pattern = pattern
      playEventSfx(audio, { type: 'enemyAttack', id: 8, kind: 'warden', pattern, x: 200, y: 90, angle: 0 })
    }
    expect(thumps).toEqual(['slam'])
  })

  it('sets the current player as listener before a stationary enemy tell sounds', () => {
    const order: string[] = []
    const audio = {
      setListener: (x: number, y: number) => { order.push(`ears:${x},${y}`) },
      play: () => { order.push('play') },
      bell: () => { order.push('bell') },
    } as unknown as AudioSystem

    playEventSfx(
      audio,
      { type: 'enemyAttack', id: 8, kind: 'warden', pattern: 'ring', x: 200, y: 90, angle: 0 },
      { x: 137, y: 91 },
    )
    expect(order[0]).toBe('ears:137,91')
    expect(order.slice(1)).toEqual(['play', 'bell'])
  })

  it('drives combat intensity from authoritative current max HP after a life offering', () => {
    const combat: Array<[number, number]> = []
    const audio = {
      setListener: () => {}, setCombat: (alive: number, hp01: number) => { combat.push([alive, hp01]) },
      thump: () => {}, play: () => {}, duck: () => {}, bell: () => {},
    } as unknown as AudioSystem

    resetSfxState()
    playEventSfx(audio, { type: 'playerHurt', x: 10, y: 20, angle: 0, hp: 4, maxHp: 12, damage: 1 })
    expect(combat.at(-1)).toEqual([0, 1 / 3])
    playEventSfx(audio, { type: 'offeringTaken', kind: 'life', x: 10, y: 20, hp: 8, maxHp: 12 })
    expect(combat.at(-1)).toEqual([0, 2 / 3])
  })
})
