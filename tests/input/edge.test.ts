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

describe('attack repeats while held', () => {
  const chain = (swings: number[]) => swings.every((v, i) => v === i % 3)

  it('holding the attack key flows the combo at the chain\'s own pace', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => {
      // a real browser sends one keydown per press; the auto-repeats that follow carry repeat=true
      h.win.fire('keydown', key('KeyJ', t > 0))
    })
    expect(swings.length).toBeGreaterThan(1)
    expect(chain(swings), `chain broke: ${swings}`).toBe(true)
  })

  it('holding the mouse button flows the combo too', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => { if (t === 0) h.canvas.fire('mousedown', { button: 0 }) })
    expect(swings.length).toBeGreaterThan(1)
    expect(chain(swings), `chain broke: ${swings}`).toBe(true)
  })

  it('holding a gamepad attack button flows the combo too', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const swings = swingsOver(h.input, 150, t => { pad.buttons[2]!.pressed = t > 0 })
    expect(swings.length).toBeGreaterThan(1)
    expect(chain(swings), `chain broke: ${swings}`).toBe(true)
  })

  it('a tap swings exactly once', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => {
      if (t === 0) { h.win.fire('keydown', key('KeyJ')); h.win.fire('keyup', key('KeyJ')) }
    })
    expect(swings).toEqual([0])
  })

  it('releasing the button stops the combo', () => {
    const h = harness()
    const held = swingsOver(h.input, 150, t => h.win.fire('keydown', key('KeyJ', t > 0)))
    const h2 = harness()
    const released = swingsOver(h2.input, 150, t => {
      if (t < 40) h2.win.fire('keydown', key('KeyJ', t > 0))
      else if (t === 40) h2.win.fire('keyup', key('KeyJ'))
    })
    // a discrete press already queued before release may still spend one more swing, but held state
    // itself must never leave a chain of future swings behind
    expect(released.length).toBeLessThan(held.length)
    expect(released.length).toBeLessThanOrEqual(3)
  })

  it('releasing the mouse anywhere on the page stops the combo', () => {
    const h = harness()
    // the button often comes up outside the canvas, so the listener has to be on the window
    const swings = swingsOver(h.input, 150, t => {
      if (t === 0) h.canvas.fire('mousedown', { button: 0 })
      if (t === 20) h.win.fire('mouseup', { button: 0 })
    })
    expect(swings.length).toBeLessThanOrEqual(2)
  })

  it('drops a click latched just before focus loss', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.canvas.fire('mousedown', { button: 0 })
    h.win.fire('blur')
    const f = h.input.sample(w)
    expect(f.attack).toBe(false)
    expect(f.attackHeld).toBe(false)
  })

  it('separate presses each swing, and chain when they land in recovery', () => {
    const h = harness()
    // one tap every 40 ticks: each lands while free, so each is a fresh swing 0
    const tapped = swingsOver(h.input, 150, t => {
      if (t % 40 === 0) { h.win.fire('keydown', key('KeyJ')); h.win.fire('keyup', key('KeyJ')) }
    })
    expect(tapped).toEqual([0, 0, 0, 0])
    // a second tap during the first swing's recovery chains into swing 1
    const h2 = harness()
    const chained = swingsOver(h2.input, 60, t => {
      if (t === 0 || t === 20) { h2.win.fire('keydown', key('KeyJ')); h2.win.fire('keyup', key('KeyJ')) }
    })
    expect(chained).toEqual([0, 1])
  })
})

describe('dodge stays edge-triggered', () => {
  it('holding dodge rolls once, not forever', () => {
    const h = harness()
    const w: World = createWorld(1, 'empty')
    let rolls = 0
    for (let t = 0; t < 150; t++) {
      h.win.fire('keydown', key('Space', t > 0))
      stepWorld(w, h.input.sample(w))
      for (const ev of w.events) if (ev.type === 'dodge') rolls++
      w.events.length = 0
    }
    expect(rolls).toBe(1)
  })

  it('two gamepad dodge buttons pressed together still roll once', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w: World = createWorld(1, 'empty')
    let rolls = 0
    // both go down on the same tick and stay down: one roll, and no stale-padPrev double-fire after
    for (let t = 0; t < 150; t++) {
      pad.buttons[0]!.pressed = t > 0
      pad.buttons[1]!.pressed = t > 0
      stepWorld(w, h.input.sample(w))
      for (const ev of w.events) if (ev.type === 'dodge') rolls++
      w.events.length = 0
    }
    expect(rolls).toBe(1)
  })
})

describe('keyboard aim', () => {
  const aimDeg = (f: { aimX: number; aimY: number }) => Math.round(Math.atan2(f.aimY, f.aimX) * 180 / Math.PI)

  it('preserves a complete WASD or arrow tap between simulation samples', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.win.fire('keydown', key('KeyD')); h.win.fire('keyup', key('KeyD'))
    h.win.fire('keydown', key('ArrowUp')); h.win.fire('keyup', key('ArrowUp'))
    const pulse = h.input.sample(w)
    expect(pulse.moveX).toBe(1)
    expect(aimDeg(pulse)).toBe(-90)
    expect(h.input.sample(w).moveX).toBe(0) // latched intent is exactly one tick, never a phantom hold
  })

  it('never aims at a cursor that has not moved', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    // the fake canvas puts client (0,0) up and left of the player, exactly like a real untouched window
    h.win.fire('keydown', key('KeyD'))
    const f = h.input.sample(w)
    expect(aimDeg(f)).toBe(0)          // walks right, swings right
    expect(f.aimSoft).toBe(true)       // intent, so the sim may finish the angle
  })

  it('aims with the arrows, independently of where you walk', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.win.fire('keydown', key('KeyD'))
    h.win.fire('keydown', key('ArrowLeft'))
    const f = h.input.sample(w)
    expect(aimDeg(f)).toBe(180)        // retreating right, striking left
    expect(f.moveX).toBe(1)            // and the arrow did not steal the movement
  })

  it('locks onto a target in the facing cone while Q is held', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    const target = w.enemies.find(e => e.active && e.x > w.player.x)!
    w.player.x = target.x - 40
    w.player.y = target.y
    h.win.fire('keydown', key('KeyQ'))
    const f = h.input.sample(w)
    expect(aimDeg(f)).toBe(0)
    expect(f.aimSoft).toBe(false)
  })

  it('does not let short-range assist replace a retained Q target', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    w.arena.solid.fill(0)
    const [locked, crossing] = w.enemies
    for (const e of w.enemies) e.active = false
    Object.assign(w.player, { x: 100, y: 100, aimAngle: 0 })
    Object.assign(locked, { active: true, state: 'idle', x: 220, y: 100 })
    Object.assign(crossing, { active: false, state: 'idle', x: 140, y: 105 })

    h.win.fire('keydown', key('KeyQ'))
    expect(aimDeg(h.input.sample(w))).toBe(0) // acquire the long-range target
    crossing.active = true                    // a closer body now crosses the same aim cone
    const retained = h.input.sample(w)
    expect(retained.aimSoft).toBe(false)
    expect(aimDeg(retained)).toBe(0)
    stepWorld(w, retained)
    expect(w.player.assistTargetId).toBe(0)
    expect(w.player.aimAngle).toBeCloseTo(0, 8)
  })

  it('lets explicit Q lock outrank a cursor that moved earlier', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    const target = w.enemies.find(e => e.active)!
    w.player.x = target.x - 40
    w.player.y = target.y
    h.canvas.fire('mousemove', { clientX: w.player.x, clientY: w.player.y - 40 })
    h.win.fire('keydown', key('KeyQ'))
    expect(aimDeg(h.input.sample(w))).toBe(0)
  })

  it('keeps keyboard aim ownership until the pointer actually moves again', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    const p = w.player
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y - 40 })
    h.win.fire('keydown', key('ArrowLeft'))
    expect(aimDeg(h.input.sample(w))).toBe(180)
    h.win.fire('keyup', key('ArrowLeft'))
    h.win.fire('keydown', key('KeyD'))
    expect(aimDeg(h.input.sample(w))).toBe(180)
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y + 40 })
    expect(aimDeg(h.input.sample(w))).toBe(90)
  })

  it('lets the mouse outrank movement once it has actually moved', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    const p = w.player
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y - 40 })
    h.win.fire('keydown', key('KeyD'))
    const f = h.input.sample(w)
    expect(aimDeg(f)).toBe(-90)
    expect(f.aimSoft).toBe(false)      // the mouse is precise; leave it alone
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
