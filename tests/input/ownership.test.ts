import { describe, expect, it } from 'vitest'
import {
  ControllerRearm,
  RETAINED_AIM_RELEASE_DEG,
  RetainedExplicitAim,
} from '@/input/ownership'

const buttons = (...down: number[]) => Array.from({ length: 4 }, (_, i) => down.includes(i))

describe('retained explicit aim ownership', () => {
  it('retains through continued movement and magnitude changes, then yields to a new direction', () => {
    const aim = new RetainedExplicitAim()
    aim.acquire(-1, 0, true, 1, 0)
    expect(aim.release(0.25, 0)).toMatchObject({ x: -1, y: 0, soft: true })
    expect(aim.release(1, 0)).toMatchObject({ x: -1, y: 0 })
    expect(aim.release(0, -1)).toBeNull()
  })

  it('ignores analog drift but compares against the anchored direction, not the previous sample', () => {
    const aim = new RetainedExplicitAim()
    aim.acquire(0, -1, false, 1, 0)
    const under = (RETAINED_AIM_RELEASE_DEG - 2) * Math.PI / 180
    expect(aim.release(Math.cos(under), Math.sin(under))).toMatchObject({ soft: false })
    const over = (RETAINED_AIM_RELEASE_DEG + 2) * Math.PI / 180
    expect(aim.release(Math.cos(over), Math.sin(over))).toBeNull()
  })

  it('treats movement begun after an idle explicit aim as a fresh facing request', () => {
    const aim = new RetainedExplicitAim()
    aim.acquire(-1, 0, true, 0, 0)
    expect(aim.release(0, 0)).toMatchObject({ x: -1, y: 0 })
    expect(aim.release(1, 0)).toBeNull()
  })

  it('anchors to the latest movement made while explicit aim is still held', () => {
    const aim = new RetainedExplicitAim()
    aim.acquire(1, 0, true, 1, 0)
    aim.acquire(1, 0, true, 0, -1)
    expect(aim.release(0, -1)).toMatchObject({ x: 1, y: 0 })
    expect(aim.release(1, 0)).toBeNull()
  })

  it('clears all ownership state on an external authority reset', () => {
    const aim = new RetainedExplicitAim()
    aim.acquire(-1, 0, true, 1, 0)
    aim.clear()
    expect(aim.release(1, 0)).toBeNull()
  })
})

describe('controller release-to-rearm', () => {
  it('passes ordinary controls through', () => {
    const gate = new ControllerRearm(4)
    expect(gate.sample({ moveActive: true, aimActive: true, buttons: buttons(1) }))
      .toEqual({ move: true, aim: true, buttons: [false, true, false, false] })
  })

  it('after blur suppresses each held channel until that channel is neutral', () => {
    const gate = new ControllerRearm(4)
    gate.sample({ moveActive: true, aimActive: true, buttons: buttons(0, 1) })
    gate.disarmAll()
    expect(gate.sample({ moveActive: true, aimActive: true, buttons: buttons(0, 1) }))
      .toEqual({ move: false, aim: false, buttons: [false, false, false, false] })

    // Attack 0 and movement rearm independently; aim and button 1 remain suppressed while held.
    expect(gate.sample({ moveActive: false, aimActive: true, buttons: buttons(1) }))
      .toEqual({ move: false, aim: false, buttons: [false, false, false, false] })
    expect(gate.sample({ moveActive: true, aimActive: true, buttons: buttons(0, 1) }))
      .toEqual({ move: true, aim: false, buttons: [true, false, false, false] })

    gate.sample({ moveActive: true, aimActive: false, buttons: buttons(0) })
    expect(gate.sample({ moveActive: true, aimActive: true, buttons: buttons(0, 1) }))
      .toEqual({ move: true, aim: true, buttons: [true, true, false, false] })
  })

  it('at a modal boundary suppresses prior holds but accepts genuinely fresh controls', () => {
    const gate = new ControllerRearm(4)
    gate.sample({ moveActive: true, aimActive: false, buttons: buttons(0) })
    gate.disarmActive()
    expect(gate.sample({ moveActive: true, aimActive: true, buttons: buttons(0, 1) }))
      .toEqual({ move: false, aim: true, buttons: [false, true, false, false] })
  })
})
