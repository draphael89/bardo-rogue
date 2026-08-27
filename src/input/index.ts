import { emptyInput, type InputFrame } from '@/sim/input'
import type { World } from '@/sim/world'
import type { RenderApp } from '@/render/app'

// Keyboard + mouse + gamepad -> one InputFrame per sim tick. Presses between ticks are latched so nothing is dropped.
export class InputSystem {
  private down = new Set<string>()
  private pressed = new Set<string>()
  private mouseX = 0; private mouseY = 0
  private mouseDown = false; private mousePressed = false
  private padPrev: boolean[] = []
  override: InputFrame | null = null   // debug API can force a frame
  lastAim = { x: 1, y: 0 }

  constructor(private ra: RenderApp) {
    window.addEventListener('keydown', e => {
      if (e.repeat) return
      this.down.add(e.code); this.pressed.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    })
    window.addEventListener('keyup', e => this.down.delete(e.code))
    window.addEventListener('blur', () => this.down.clear())
    const c = ra.app.canvas
    c.addEventListener('mousemove', e => { this.mouseX = e.clientX; this.mouseY = e.clientY })
    c.addEventListener('mousedown', e => { if (e.button === 0) { this.mouseDown = true; this.mousePressed = true } })
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false })
    c.addEventListener('contextmenu', e => e.preventDefault())
  }

  sample(world: World): InputFrame {
    if (this.override) { const f = { ...this.override }; this.override = { ...this.override, attack: false, dodge: false, restart: false }; this.pressed.clear(); this.mousePressed = false; return f }
    const f = emptyInput()
    const d = this.down
    let mx = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0)
    let my = (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0) - (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0)

    // mouse aim in world space
    const rect = this.ra.app.canvas.getBoundingClientRect()
    const vx = (this.mouseX - rect.left - this.ra.screen.x) / this.ra.scale
    const vy = (this.mouseY - rect.top - this.ra.screen.y) / this.ra.scale
    const wx = vx - this.ra.arenaOffset.x, wy = vy - this.ra.arenaOffset.y
    const p = world.player
    let ax = wx - p.x, ay = wy - p.y
    let al = Math.hypot(ax, ay)
    let aimSoft = false
    if (al > 0.5) { ax /= al; ay /= al } else { ax = this.lastAim.x; ay = this.lastAim.y }

    let attack = this.mouseDown || this.mousePressed || d.has('KeyJ') || d.has('KeyZ') || this.pressed.has('KeyJ') || this.pressed.has('KeyZ')
    let dodge = this.pressed.has('Space') || this.pressed.has('ShiftLeft') || this.pressed.has('KeyK') || this.pressed.has('KeyX')
    let restart = this.pressed.has('KeyR')

    // gamepad
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const pad = pads && pads[0]
    if (pad) {
      // radial deadzone on the vector, rescaled from the deadzone edge; per-axis clipping snaps diagonals to the axes
      const dz = (x: number, y: number, t: number): [number, number] => {
        const m = Math.hypot(x, y)
        if (m < t) return [0, 0]
        const k = Math.min(1, (m - t) / (1 - t)) / m
        return [x * k, y * k]
      }
      const [lx, ly] = dz(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.25)
      const [rx, ry] = dz(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.3)
      if (lx || ly) { mx = lx; my = ly }
      if (rx || ry) { const l = Math.hypot(rx, ry); ax = rx / l; ay = ry / l; aimSoft = false }
      else if (lx || ly) { const l = Math.hypot(lx, ly); ax = lx / l; ay = ly / l; aimSoft = true }
      else if (!(this.mouseX || this.mouseY)) aimSoft = true
      const b = (i: number) => !!pad.buttons[i]?.pressed
      const edge = (i: number) => { const now = b(i); const was = this.padPrev[i] ?? false; this.padPrev[i] = now; return now && !was }
      if (b(2) || b(5) || b(7)) attack = true
      if (edge(0) || edge(1) || edge(4)) dodge = true
      if (edge(9)) restart = true
      for (let i = 0; i < 16; i++) if (i !== 0 && i !== 1 && i !== 4 && i !== 9) this.padPrev[i] = b(i)
    }

    const ml = Math.hypot(mx, my)
    if (ml > 1) { mx /= ml; my /= ml }
    f.moveX = mx; f.moveY = my
    f.aimX = ax; f.aimY = ay; f.aimSoft = aimSoft
    this.lastAim = { x: ax, y: ay }
    f.attack = attack; f.dodge = dodge; f.restart = restart
    this.pressed.clear(); this.mousePressed = false
    return f
  }

}
