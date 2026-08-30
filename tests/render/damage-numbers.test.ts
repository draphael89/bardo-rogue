import { Container, Text } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DamageNumbers } from '@/render/damageNumbers'
import { simClock } from '@/render/hud'
import { tuning } from '@/tuning'

// DamageNumbers only needs the shared tick. Mocking the HUD keeps this focused Node test from
// constructing the browser-only crisp-text WebGL filter while retaining the production clock seam.
vi.mock('@/render/hud', () => ({ simClock: { tick: 0 } }))

afterEach(() => { simClock.tick = 0 })

describe('damage-number pixel scale', () => {
  it.each([false, true])('keeps the %s weight on whole target-pixel scales', heavy => {
    const layer = new Container()
    const numbers = new DamageNumbers(layer)
    simClock.tick = 0
    numbers.show(32, 32, heavy ? 2 : 1, heavy)
    numbers.update()

    const label = layer.children[0] as Text
    expect(label.scale.x * tuning.view.worldScale).toBeCloseTo(2)

    simClock.tick = 3
    numbers.update()
    expect(label.scale.x * tuning.view.worldScale).toBeCloseTo(1)

    label.destroy()
  })
})
