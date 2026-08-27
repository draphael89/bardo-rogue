import { describe, it, expect, afterEach } from 'vitest'
import { Container, Point } from 'pixi.js'
import type { RenderApp } from '@/render/app'
import { InputSystem } from '@/input'
import { createWorld } from '@/sim/scenarios'
import { stepWorld } from '@/sim/step'
import type { World } from '@/sim/world'

// The input layer is browser-side, so this stands a minimal window / canvas / gamepad in front of it and
// drives the real InputSystem, the real sim, and a real pixi world container.

type Handler = (e: unknown) => void

class FakeTarget {
  private handlers = new Map<string, Handler[]>()
  addEventListener(type: string, h: unknown) {
    const a = this.handlers.get(type) ?? []
    a.push(h as Handler)
    this.handlers.set(type, a)
  }
  fire(type: string, e: unknown = {}) { for (const h of this.handlers.get(type) ?? []) h(e) }
}

class FakeCanvas extends FakeTarget {
  getBoundingClientRect() { return { left: 0, top: 0 } }
}

interface PadButton { pressed: boolean }
interface FakePad { axes: number[]; buttons: PadButton[] }

function key(code: string, repeat = false) { return { code, repeat, preventDefault() { /* noop */ } } }

function harness(pad?: FakePad) {
  const win = new FakeTarget()
  const canvas = new FakeCanvas()
  const g = globalThis as Record<string, unknown>
  g.window = win
  Object.defineProperty(globalThis, 'navigator', {
    value: pad ? { getGamepads: () => [pad] } : {}, configurable: true, writable: true,
  })
  const worldContainer = new Container()
  const arenaOffset = { x: 0, y: 0 }
  const ra = {
    app: { canvas }, world: worldContainer, screen: { x: 0, y: 0 }, scale: 1, arenaOffset,
  } as unknown as RenderApp
  return { win, canvas, worldContainer, input: new InputSystem(ra) }
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.window
})

// Runs `ticks` sim ticks, letting `before(t)` post DOM/gamepad events first. Returns the combo index of every swing.
function swingsOver(input: InputSystem, ticks: number, before: (t: number) => void): number[] {
  const w: World = createWorld(1, 'dummy')
  const swings: number[] = []
  for (let t = 0; t < ticks; t++) {
    before(t)
    stepWorld(w, input.sample(w))
    for (const ev of w.events) if (ev.type === 'swing') swings.push(ev.swing)
    w.events.length = 0
  }
  return swings
}

describe('attack is edge-triggered', () => {
  it('holding the attack key for 150 ticks swings once', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => {
      // a real browser sends one keydown per press; the auto-repeats that follow carry repeat=true
      h.win.fire('keydown', key('KeyJ', t > 0))
    })
    expect(swings).toEqual([0])
  })

  it('holding the mouse button for 150 ticks swings once', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => {
      if (t === 0) h.canvas.fire('mousedown', { button: 0 })
    })
    expect(swings).toEqual([0])
  })

  it('holding a gamepad attack button for 150 ticks swings once', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const swings = swingsOver(h.input, 150, t => { pad.buttons[2]!.pressed = t > 0 })
    expect(swings).toEqual([0])
  })

  it('two gamepad attack buttons pressed together still swing once each press', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    // both attack buttons go down on the same tick and stay down: one swing, and no stale-padPrev double-fire after
    const swings = swingsOver(h.input, 150, t => {
      pad.buttons[2]!.pressed = t > 0
      pad.buttons[5]!.pressed = t > 0
    })
    expect(swings).toEqual([0])
  })

  it('separate presses still swing, and still chain the combo', () => {
    const h = harness()
    // one press every 40 ticks: each lands while free, so each is a fresh swing 0
    const tapped = swingsOver(h.input, 150, t => { if (t % 40 === 0) h.win.fire('keydown', key('KeyJ')) })
    expect(tapped).toEqual([0, 0, 0, 0])
    // a second press during the first swing's recovery chains into swing 1
    const h2 = harness()
    const chained = swingsOver(h2.input, 60, t => { if (t === 0 || t === 20) h2.win.fire('keydown', key('KeyJ')) })
    expect(chained).toEqual([0, 1])
  })
})

describe('mouse aim follows the live camera transform', () => {
  it('aims at the world point under the cursor while the camera is shaken, zoomed and rotated', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    const p = w.player
    // pose the world container the way Presenter.render does: pivot on the player, punch zoom, shake, roll
    const wc = h.worldContainer
    wc.pivot.set(Math.round(p.x), Math.round(p.y))
    wc.scale.set(1.15)
    wc.rotation = 0.05
    wc.position.set(Math.round(p.x) + 3, Math.round(p.y) - 2)

    const target = new Point(p.x + 40, p.y - 25)          // the world point we want to aim at
    const onScreen = wc.toGlobal(target, new Point())      // where the player sees it
    h.canvas.fire('mousemove', { clientX: onScreen.x, clientY: onScreen.y })

    const f = h.input.sample(w)
    const ex = target.x - p.x, ey = target.y - p.y
    const el = Math.hypot(ex, ey)
    expect(f.aimX).toBeCloseTo(ex / el, 4)
    expect(f.aimY).toBeCloseTo(ey / el, 4)
  })
})
