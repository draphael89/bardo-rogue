import { describe, expect, it } from 'vitest'
import { modalInputArmed } from '@/sim/rewards'
import { createWorld } from '@/sim/scenarios'
import { tuning } from '@/tuning'

describe('modal input gate', () => {
  it('arms on the same tick in the sim and the reduced-effects prompt', () => {
    const world = createWorld(1, 'empty')
    world.phaseTick = 10
    world.tick = 10 + tuning.run.modalArmTicks - 1
    expect(modalInputArmed(world)).toBe(false)
    world.tick++
    expect(modalInputArmed(world)).toBe(true)
  })
})
