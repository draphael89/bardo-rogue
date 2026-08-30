import { describe, it, expect, afterEach } from 'vitest'
import { Container, Point } from 'pixi.js'
import type { RenderApp } from '@/render/app'
import { InputSystem } from '@/input'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { finishRun, prepareWeapon, startRun } from '@/sim/session'
import { stepWorld } from '@/sim/step'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'

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
const aimDeg = (f: { aimX: number; aimY: number }) => Math.round(Math.atan2(f.aimY, f.aimX) * 180 / Math.PI)

function harness(pad?: FakePad) {
  const win = new FakeTarget()
  const canvas = new FakeCanvas()
  const g = globalThis as Record<string, unknown>
  g.window = win
  Object.defineProperty(globalThis, 'navigator', {
    value: pad ? { getGamepads: () => [pad] } : {}, configurable: true, writable: true,
  })
  const worldContainer = new Container()
  const ra = {
    app: { canvas }, world: worldContainer, screen: { x: 0, y: 0 }, scale: 1,
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
  const quickRhythm = (swings: number[]) => swings.every((v, i) => v === i % 2)

  it('holding the attack key flows the quick two-cut rhythm without a heavy', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => {
      // a real browser sends one keydown per press; the auto-repeats that follow carry repeat=true
      h.win.fire('keydown', key('KeyJ', t > 0))
    })
    expect(swings.length).toBeGreaterThan(1)
    expect(quickRhythm(swings), `quick rhythm broke: ${swings}`).toBe(true)
  })

  it('holding the mouse button flows the quick rhythm too', () => {
    const h = harness()
    const swings = swingsOver(h.input, 150, t => { if (t === 0) h.canvas.fire('mousedown', { button: 0 }) })
    expect(swings.length).toBeGreaterThan(1)
    expect(quickRhythm(swings), `quick rhythm broke: ${swings}`).toBe(true)
  })

  it('holding a gamepad attack button flows the quick rhythm too', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const swings = swingsOver(h.input, 150, t => { pad.buttons[2]!.pressed = t > 0 })
    expect(swings.length).toBeGreaterThan(1)
    expect(quickRhythm(swings), `quick rhythm broke: ${swings}`).toBe(true)
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

describe('modal input', () => {
  it('does not turn menu navigation into the next live aim direction', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.win.fire('keydown', key('ArrowRight'))
    expect(aimDeg(h.input.sample(w))).toBe(0)
    h.win.fire('keyup', key('ArrowRight'))

    w.roomPhase = 'reward'
    h.input.sample(w)
    h.win.fire('keydown', key('ArrowLeft'))
    expect(h.input.sample(w).choiceDelta).toBe(-1)
    h.win.fire('keyup', key('ArrowLeft'))

    w.roomPhase = 'fighting'
    expect(aimDeg(h.input.sample(w))).toBe(0)
  })

  it('does not let a keypress buffered during the killing blow claim the offer', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.input.sample(w)                                   // one live tick, so the boundary has a prior state

    // The offer opens on the SAME tick the last enemy dies, so a mash landing in that 16.7 ms window
    // is still latched when the modal's first sample runs. It used to become `confirm` immediately
    // and take options[0] before a frame of the screen had been drawn.
    h.win.fire('keydown', key('KeyJ'))
    w.roomPhase = 'reward'
    expect(h.input.sample(w).confirm).toBe(false)

    // A press the player makes once the screen is up is still accepted at once.
    h.win.fire('keydown', key('KeyJ'))
    expect(h.input.sample(w).confirm).toBe(true)
  })

  it('re-guards on a second offer opened in the same modal run', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.input.sample(w)
    w.roomPhase = 'reward'
    w.phaseTick = 100
    h.input.sample(w)
    h.win.fire('keydown', key('Enter'))
    expect(h.input.sample(w).confirm).toBe(true)         // the first vow is claimed

    // The ferryman's payout opens a second offer without ever leaving `reward`, so a boolean
    // boundary saw no edge at all. The stamped phaseTick is what makes it one.
    h.win.fire('keydown', key('Enter'))
    w.phaseTick = 101
    expect(h.input.sample(w).confirm).toBe(false)
  })

  it('accepts a fresh gamepad attack press but never inherits a held combat attack', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'empty')
    pad.buttons[2]!.pressed = true
    expect(h.input.sample(w).attack).toBe(true)
    w.roomPhase = 'reward'
    expect(h.input.sample(w).confirm).toBe(false)
    pad.buttons[2]!.pressed = false
    expect(h.input.sample(w).confirm).toBe(false)
    pad.buttons[2]!.pressed = true
    expect(h.input.sample(w).confirm).toBe(true)
  })

  it('requires sticks and buttons held through a modal to release before they can drive combat again', () => {
    const pad: FakePad = { axes: [1, 0, -1, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'empty')
    pad.buttons[2]!.pressed = true
    const combat = h.input.sample(w)
    expect(combat.moveX).toBe(1)
    expect(combat.aimX).toBe(-1)
    expect(combat.attack).toBe(true)

    // The same physical holds cannot become a menu confirm on entry.
    w.roomPhase = 'reward'
    const entered = h.input.sample(w)
    expect(entered.confirm).toBe(false)
    expect(entered.moveX).toBe(0)

    // Release once in the modal, then make fresh menu input. It is accepted normally.
    pad.axes.fill(0); pad.buttons[2]!.pressed = false
    expect(h.input.sample(w).confirm).toBe(false)
    pad.axes[0] = 1; pad.axes[2] = -1; pad.buttons[2]!.pressed = true
    expect(h.input.sample(w).confirm).toBe(true)

    // Holds active in the menu cannot leak out through the other side of the boundary either.
    w.roomPhase = 'fighting'
    const exited = h.input.sample(w)
    expect(exited.moveX).toBe(0)
    expect(exited.attack).toBe(false)
    expect(exited.attackHeld).toBe(false)

    pad.axes.fill(0); pad.buttons[2]!.pressed = false
    h.input.sample(w)
    pad.axes[0] = -1; pad.axes[3] = -1; pad.buttons[2]!.pressed = true
    const rearmed = h.input.sample(w)
    expect(rearmed.moveX).toBe(-1)
    expect(aimDeg(rearmed)).toBe(-90)
    expect(rearmed.attack).toBe(true)
    expect(rearmed.attackHeld).toBe(true)
  })
})

describe('reveal gate on death and victory', () => {
  // The gate lives in the device layer only: sample() swallows confirm/restart until the staged
  // card has actually shown the way out. Bots, replays and the debug override feed the sim
  // directly (src/main.ts), so the pinned replay fixtures never pass through it.

  it('swallows keyboard confirm and restart until the death card reveals the way out', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    w.player.state = 'dead'
    w.player.deathTick = w.tick
    const N = tuning.reveal.deathMinTicks
    for (let age = 1; age < N; age++) {
      w.tick++
      h.win.fire('keydown', key('Enter')); h.win.fire('keyup', key('Enter'))
      h.win.fire('keydown', key('KeyR')); h.win.fire('keyup', key('KeyR'))
      const f = h.input.sample(w)
      expect(f.confirm ?? false, `confirm leaked at age ${age}`).toBe(false)
      expect(f.restart, `restart leaked at age ${age}`).toBe(false)
    }
    w.tick++                    // age === N: the gate opens
    h.win.fire('keydown', key('Enter')); h.win.fire('keyup', key('Enter'))
    expect(h.input.sample(w).confirm).toBe(true)
    h.win.fire('keydown', key('KeyR')); h.win.fire('keyup', key('KeyR'))
    expect(h.input.sample(w).restart).toBe(true)
  })

  it('gates a fresh gamepad press the same way: the gate sits where devices are normalized', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'empty')
    h.input.sample(w)           // one live sample so the modal flip is a boundary, not the first frame
    w.player.state = 'dead'
    w.player.deathTick = w.tick
    w.tick += 2                 // past the boundary, still far inside the gate
    h.input.sample(w)
    pad.buttons[2]!.pressed = true          // a fresh edge, not a hold inherited across the boundary
    expect(h.input.sample(w).confirm ?? false).toBe(false)
    pad.buttons[2]!.pressed = false
    h.input.sample(w)
    w.tick = w.player.deathTick + tuning.reveal.deathMinTicks
    pad.buttons[2]!.pressed = true
    expect(h.input.sample(w).confirm).toBe(true)
  })

  it('holds the victory confirm until the card has been readable', () => {
    const h = harness()
    const w = createWorld(1, 'loop')
    prepareWeapon(w)
    startRun(w, 'threshold')
    finishRun(w, 'won')         // sets roomPhase 'resolved' and phaseTick = tick
    const N = tuning.reveal.victoryMinTicks
    for (let age = 1; age < N; age++) {
      w.tick++
      h.win.fire('keydown', key('Enter')); h.win.fire('keyup', key('Enter'))
      expect(h.input.sample(w).confirm ?? false, `confirm leaked at age ${age}`).toBe(false)
    }
    w.tick++
    h.win.fire('keydown', key('Enter')); h.win.fire('keyup', key('Enter'))
    expect(h.input.sample(w).confirm).toBe(true)
  })

  it('leaves restart alone while the run is live', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.win.fire('keydown', key('KeyR')); h.win.fire('keyup', key('KeyR'))
    expect(h.input.sample(w).restart).toBe(true)
  })

  it('the debug override bypasses the gate entirely', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    w.player.state = 'dead'
    w.player.deathTick = w.tick
    w.tick++                    // age 1, deep inside the gate
    h.input.override = { ...emptyInput(), confirm: true, restart: true }
    const f = h.input.sample(w)
    expect(f.confirm).toBe(true)
    expect(f.restart).toBe(true)
  })

  it('the sim itself stays ungated: a scripted confirm one tick after death still returns', () => {
    const w = createWorld(1, 'loop')
    w.player.state = 'dead'
    w.player.deathTick = w.tick
    stepWorld(w, { ...emptyInput(), confirm: true })
    expect(w.player.state).toBe('free')
    expect(w.returns).toBe(1)
  })
})

describe('keyboard aim', () => {
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

  it('returns arrow aim to movement on release, retains it while idle, then yields to real pointer motion', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    const p = w.player
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y - 40 })
    h.win.fire('keydown', key('ArrowLeft'))
    expect(aimDeg(h.input.sample(w))).toBe(180)
    h.win.fire('keyup', key('ArrowLeft'))
    h.win.fire('keydown', key('KeyD'))
    const moving = h.input.sample(w)
    expect(aimDeg(moving)).toBe(0)
    expect(moving.aimSoft).toBe(true)
    h.win.fire('keyup', key('KeyD'))
    expect(aimDeg(h.input.sample(w))).toBe(0) // idle preserves the last intentional direction
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y + 40 })
    const mouse = h.input.sample(w)
    expect(aimDeg(mouse)).toBe(90)
    expect(mouse.aimSoft).toBe(false)
  })

  it('retains released arrow aim while prior movement continues, then yields to a deliberate turn', () => {
    const h = harness()
    const w = createWorld(1, 'empty')
    h.win.fire('keydown', key('KeyD'))
    h.win.fire('keydown', key('ArrowLeft'))
    expect(aimDeg(h.input.sample(w))).toBe(180)

    h.win.fire('keyup', key('ArrowLeft'))
    const continued = h.input.sample(w)
    expect(continued.moveX).toBe(1)
    expect(aimDeg(continued)).toBe(180)
    expect(continued.aimSoft).toBe(true)

    h.win.fire('keydown', key('KeyW'))
    const turned = h.input.sample(w)
    expect(aimDeg(turned)).toBe(-45)
    expect(turned.aimSoft).toBe(true)
  })

  it('returns right-stick aim to left-stick movement on release without reviving a stale cursor', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'empty')
    const p = w.player
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y - 40 })
    pad.axes[2] = -1
    expect(aimDeg(h.input.sample(w))).toBe(180)
    pad.axes[2] = 0
    pad.axes[0] = 1
    const moving = h.input.sample(w)
    expect(aimDeg(moving)).toBe(0)
    expect(moving.aimSoft).toBe(true)
    pad.axes[0] = 0
    expect(aimDeg(h.input.sample(w))).toBe(0)
    h.canvas.fire('mousemove', { clientX: p.x, clientY: p.y + 40 })
    expect(aimDeg(h.input.sample(w))).toBe(90)
  })

  it('retains released right-stick aim while the left stick continues, preserving analog precision', () => {
    const pad: FakePad = { axes: [1, 0, -1, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'empty')
    expect(aimDeg(h.input.sample(w))).toBe(180)
    pad.axes[2] = 0
    const continued = h.input.sample(w)
    expect(continued.moveX).toBe(1)
    expect(aimDeg(continued)).toBe(180)
    expect(continued.aimSoft).toBe(false)

    pad.axes[0] = 0; pad.axes[1] = -1
    const turned = h.input.sample(w)
    expect(aimDeg(turned)).toBe(-90)
    expect(turned.aimSoft).toBe(true)
  })

  it('lets Q clear retained directional ownership instead of restoring it on release', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    w.arena.solid.fill(0)
    const target = w.enemies.find(e => e.active)!
    for (const e of w.enemies) e.active = false
    Object.assign(w.player, { x: 100, y: 100 })
    Object.assign(target, { active: true, state: 'idle', x: 60, y: 100 })
    h.win.fire('keydown', key('KeyD'))
    h.win.fire('keydown', key('ArrowLeft'))
    h.input.sample(w)
    h.win.fire('keyup', key('ArrowLeft'))
    expect(aimDeg(h.input.sample(w))).toBe(180)

    h.win.fire('keydown', key('KeyQ'))
    expect(aimDeg(h.input.sample(w))).toBe(180)
    expect(h.input.hardLockTargetId).toBe(target.id)
    h.win.fire('keyup', key('KeyQ'))
    const movement = h.input.sample(w)
    expect(aimDeg(movement)).toBe(0)
    expect(movement.aimSoft).toBe(true)
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

  it('exposes Q target identity read-only and clears it on release or invalidation', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    w.arena.solid.fill(0)
    const target = w.enemies.find(e => e.active)!
    Object.assign(w.player, { x: target.x - 40, y: target.y })
    h.win.fire('keydown', key('KeyQ'))
    h.input.sample(w)
    expect(h.input.hardLockTargetId).toBe(target.id)

    // Retention uses the wider break range even after the body leaves the acquisition cone/range.
    target.x = w.player.x + tuning.player.aimLockRange + 10
    h.input.sample(w)
    expect(h.input.hardLockTargetId).toBe(target.id)

    h.win.fire('keyup', key('KeyQ'))
    h.input.sample(w)
    expect(h.input.hardLockTargetId).toBeNull()

    target.x = w.player.x + 40
    h.win.fire('keydown', key('KeyQ'))
    h.input.sample(w)
    expect(h.input.hardLockTargetId).toBe(target.id)
    for (const e of w.enemies) e.active = false
    h.input.sample(w)
    expect(h.input.hardLockTargetId).toBeNull()
  })

  it('retains Q identity through mouse and temporary right-stick overrides', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'dummy')
    w.arena.solid.fill(0)
    const target = w.enemies.find(e => e.active)!
    Object.assign(w.player, { x: target.x - 40, y: target.y })
    h.canvas.fire('mousemove', { clientX: w.player.x, clientY: w.player.y - 40 })
    h.win.fire('keydown', key('KeyQ'))
    expect(aimDeg(h.input.sample(w))).toBe(0)
    expect(h.input.hardLockTargetId).toBe(target.id)

    pad.axes[3] = -1
    expect(aimDeg(h.input.sample(w))).toBe(-90)
    expect(h.input.hardLockTargetId).toBe(target.id)
    pad.axes[3] = 0
    expect(aimDeg(h.input.sample(w))).toBe(0)
    expect(h.input.hardLockTargetId).toBe(target.id)
  })
})

describe('controller focus rearm', () => {
  it('does not inherit movement, aim, attack, or dodge held across blur', () => {
    const pad: FakePad = { axes: [-1, 0, 0, -1], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    pad.buttons[0]!.pressed = true
    pad.buttons[2]!.pressed = true
    const h = harness(pad)
    const w = createWorld(1, 'empty')
    const before = h.input.sample(w)
    expect(before.moveX).toBe(-1)
    expect(aimDeg(before)).toBe(-90)
    expect(before.attack).toBe(true)
    expect(before.attackHeld).toBe(true)
    expect(before.dodge).toBe(true)

    h.win.fire('blur')
    // A fresh keyboard direction proves the still-held right stick is not silently retaining aim.
    h.win.fire('keydown', key('KeyD'))
    const held = h.input.sample(w)
    expect(held.moveX).toBe(1)
    expect(aimDeg(held)).toBe(0)
    expect(held.attack).toBe(false)
    expect(held.attackHeld).toBe(false)
    expect(held.dodge).toBe(false)

    h.win.fire('keyup', key('KeyD'))
    pad.axes.fill(0); pad.buttons[0]!.pressed = false; pad.buttons[2]!.pressed = false
    h.input.sample(w)
    pad.axes[0] = 1; pad.axes[2] = -1; pad.buttons[0]!.pressed = true; pad.buttons[2]!.pressed = true
    const rearmed = h.input.sample(w)
    expect(rearmed.moveX).toBe(1)
    expect(aimDeg(rearmed)).toBe(180)
    expect(rearmed.attack).toBe(true)
    expect(rearmed.attackHeld).toBe(true)
    expect(rearmed.dodge).toBe(true)
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

describe('releaseHeldIntent: the press that operated the pause card stays out of the game', () => {
  // The shell pause stops the loop, so sample() — the only thing that drains latched pulses and
  // ages pad edges — does not run while the card is up. main.ts calls releaseHeldIntent on both
  // edges of the pause.

  it('drops a latched Enter instead of confirming the modal underneath', () => {
    const h = harness()
    const w = createWorld(1, 'loop')
    prepareWeapon(w)
    startRun(w, 'bardo')
    finishRun(w, 'won')
    w.tick += tuning.reveal.victoryMinTicks   // past the reveal: only the release can stop this press

    h.win.fire('keydown', key('Enter'))       // the press that chose RISE while paused
    h.input.releaseHeldIntent()
    expect(h.input.sample(w).confirm ?? false).toBe(false)
  })

  it('makes a held pad button re-arm before it can drive the game again', () => {
    const pad: FakePad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    const h = harness(pad)
    const w = createWorld(1, 'dummy')
    pad.buttons[0]!.pressed = true            // A, held to operate the card
    h.input.releaseHeldIntent()
    expect(h.input.sample(w).dodge).toBe(false)
    expect(h.input.sample(w).dodge).toBe(false)   // still held: still disarmed
    pad.buttons[0]!.pressed = false
    h.input.sample(w)                             // neutral sample re-arms it
    pad.buttons[0]!.pressed = true
    expect(h.input.sample(w).dodge).toBe(true)
  })

  it('drops held movement too, so WASD steering the card cannot walk the first unpaused tick', () => {
    const h = harness()
    const w = createWorld(1, 'dummy')
    h.win.fire('keydown', key('KeyW'))
    h.input.releaseHeldIntent()
    expect(h.input.sample(w).moveY).toBe(0)
    // A fresh press after the card closes walks again.
    h.win.fire('keydown', key('KeyW'))
    expect(h.input.sample(w).moveY).toBeLessThan(0)
  })
})

describe('the reveal is a modal: combat input does not run behind the card', () => {
  it('blanks movement and attacks while the victory summary is up', () => {
    const h = harness()
    const w = createWorld(1, 'loop')
    prepareWeapon(w)
    startRun(w, 'bardo')
    finishRun(w, 'won')
    h.win.fire('keydown', key('KeyW'))
    h.win.fire('keydown', key('KeyJ'))
    const f = h.input.sample(w)
    expect(f.moveY).toBe(0)
    expect(f.attack).toBe(false)
    expect(f.dodge).toBe(false)
  })

  it('leaves a stock scenario idling in resolved fully playable', () => {
    // No run, so no card — blanking here would freeze every wave and dummy scenario.
    const h = harness()
    const w = createWorld(1, 'dummy')
    w.roomPhase = 'resolved'
    h.win.fire('keydown', key('KeyW'))
    expect(h.input.sample(w).moveY).toBeLessThan(0)
  })
})
