import { Point } from 'pixi.js'
import { emptyInput, type InputFrame } from '@/sim/input'
import { aimLockTarget, resolveAim } from './aim'
import { tuning } from '@/tuning'
import type { World } from '@/sim/world'
import { hasLineOfSight } from '@/sim/arena'
import type { RenderApp } from '@/render/app'

// Gamepad buttons read as edges. Every index here must be sampled through edge() every tick or its padPrev
// goes stale and it fires twice.
const PAD_ATTACK = [2, 5, 7]      // X / RB / RT
const PAD_DODGE = [0, 1, 4]       // A / B / LB
const PAD_RESTART = [9]           // start
const PAD_CHOICE_LEFT = 14
const PAD_CHOICE_RIGHT = 15
const PAD_EDGE = new Set([...PAD_ATTACK, ...PAD_DODGE, ...PAD_RESTART, PAD_CHOICE_LEFT, PAD_CHOICE_RIGHT])

// Keyboard + mouse + gamepad -> one InputFrame per sim tick. Presses between ticks are latched so nothing is dropped.
export class InputSystem {
  private down = new Set<string>()
  private pressed = new Set<string>()
  private mouseX = 0; private mouseY = 0
  private mouseSeen = false          // (0,0) is the window corner, not "no cursor" — see resolveAim
  private mouseOwnsAim = false       // arrows/right stick retain ownership until real pointer activity
  private explicitAimOwns = false    // released arrows/stick hold last aim instead of falling through to WASD
  private mousePressed = false
  private mouseHeld = false
  private padPrev: boolean[] = []
  private cursorScreen = new Point()
  private cursorWorld = new Point()
  override: InputFrame | null = null   // debug API can force a frame
  lastAim = { x: 1, y: 0 }
  private lockedTargetId: number | null = null

  constructor(private ra: RenderApp) {
    window.addEventListener('keydown', e => {
      if (e.repeat) return
      this.down.add(e.code); this.pressed.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    })
    window.addEventListener('keyup', e => this.down.delete(e.code))
    // drop held AND latched state: a press caught just before focus loss must not fire on return,
    // and a button still down when the tab goes away must not keep swinging forever
    window.addEventListener('blur', () => {
      this.down.clear(); this.pressed.clear()
      this.mousePressed = false; this.mouseHeld = false
    })
    const c = ra.app.canvas
    c.addEventListener('mousemove', e => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.mouseSeen = true; this.mouseOwnsAim = true; this.explicitAimOwns = false })
    c.addEventListener('mousedown', e => { if (e.button === 0) { this.mousePressed = true; this.mouseHeld = true; this.mouseOwnsAim = true; this.explicitAimOwns = false } })
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouseHeld = false })
    c.addEventListener('contextmenu', e => e.preventDefault())
  }

  sample(world: World): InputFrame {
    if (this.override) { const f = { ...this.override }; this.override = { ...this.override, attack: false, dodge: false, restart: false, choiceDelta: 0, confirm: false }; this.pressed.clear(); this.mousePressed = false; return f }
    const f = emptyInput()
    const d = this.down
    // A complete keydown/keyup pair can occur between two 60 Hz samples. `pressed` latches that
    // pulse until this sample, while `down` carries a hold; treating either as active means even a
    // very fast directional tap expresses exactly one tick of intent instead of disappearing.
    const keyActive = (code: string) => d.has(code) || this.pressed.has(code)
    let mx = (keyActive('KeyD') ? 1 : 0) - (keyActive('KeyA') ? 1 : 0)
    let my = (keyActive('KeyS') ? 1 : 0) - (keyActive('KeyW') ? 1 : 0)
    // arrows are aim, not a second set of movement keys: WASD walks, arrows point, and holding one
    // pins the facing so you can circle a target instead of orbiting it face-first
    const arrowX = (keyActive('ArrowRight') ? 1 : 0) - (keyActive('ArrowLeft') ? 1 : 0)
    const arrowY = (keyActive('ArrowDown') ? 1 : 0) - (keyActive('ArrowUp') ? 1 : 0)
    if (arrowX || arrowY) { this.mouseOwnsAim = false; this.explicitAimOwns = true }

    // mouse aim in world space. Canvas -> the 480x270 render target, then through the INVERSE of the live world
    // container transform, so shake / punch-zoom / camera roll cannot split the ray you see from the ray the sim uses.
    let mouseAimX = 0, mouseAimY = 0
    if (this.mouseSeen && this.mouseOwnsAim) {
      const rect = this.ra.app.canvas.getBoundingClientRect()
      const vx = (this.mouseX - rect.left - this.ra.screen.x) / this.ra.scale
      const vy = (this.mouseY - rect.top - this.ra.screen.y) / this.ra.scale
      const cw = this.ra.world.toLocal(this.cursorScreen.set(vx, vy), undefined, this.cursorWorld)
      const p = world.player
      const ax = cw.x - p.x, ay = cw.y - p.y
      const al = Math.hypot(ax, ay)
      if (al > 0.5) { mouseAimX = ax / al; mouseAimY = ay / al }
    }

    // Press and hold are different promises. A press may queue one future action; held state only
    // sustains combo flow while the button is still down, so releasing can never cause a surprise swing.
    let attack = this.mousePressed || this.pressed.has('KeyJ') || this.pressed.has('KeyZ')
    let attackHeld = this.mouseHeld || d.has('KeyJ') || d.has('KeyZ')
    // dodge stays an edge: holding it would just be free travel
    let dodge = this.pressed.has('Space') || this.pressed.has('ShiftLeft') || this.pressed.has('KeyK') || this.pressed.has('KeyX')
    let restart = this.pressed.has('KeyR')

    // gamepad
    let padAimX = 0, padAimY = 0
    let padChoiceDelta: -1 | 0 | 1 = 0
    let padAttackEdge = false
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
      padAimX = rx; padAimY = ry
      if (rx || ry) { this.mouseOwnsAim = false; this.explicitAimOwns = true; mouseAimX = 0; mouseAimY = 0 }
      const b = (i: number) => !!pad.buttons[i]?.pressed
      const edge = (i: number) => { const now = b(i); const was = this.padPrev[i] ?? false; this.padPrev[i] = now; return now && !was }
      // no short-circuit: every listed button must be sampled or padPrev goes stale and it double-fires next tick
      const anyEdge = (ids: readonly number[]) => { let hit = false; for (const i of ids) if (edge(i)) hit = true; return hit }
      for (const i of PAD_ATTACK) if (b(i)) attackHeld = true
      padAttackEdge = anyEdge(PAD_ATTACK)                   // a modal must never inherit a combat hold
      if (padAttackEdge) attack = true
      if (anyEdge(PAD_DODGE)) dodge = true
      if (anyEdge(PAD_RESTART)) restart = true
      const choiceLeft = edge(PAD_CHOICE_LEFT), choiceRight = edge(PAD_CHOICE_RIGHT)
      padChoiceDelta = choiceLeft === choiceRight ? 0 : choiceLeft ? -1 : 1
      for (let i = 0; i < 16; i++) if (!PAD_EDGE.has(i)) this.padPrev[i] = b(i)
    }

    const ml = Math.hypot(mx, my)
    if (ml > 1) { mx /= ml; my /= ml }
    f.moveX = mx; f.moveY = my
    let lockX = 0, lockY = 0
    if (keyActive('KeyQ')) {
      const p = world.player
      const lock = aimLockTarget(
        p.x, p.y,
        this.lastAim.x, this.lastAim.y,
        tuning.player.aimLockConeDeg,
        world.enemies,
        {
          currentId: this.lockedTargetId,
          maxRange: tuning.player.aimLockRange,
          breakRange: tuning.player.aimLockBreakRange,
          visible: t => hasLineOfSight(world.arena, p.x, p.y, t.x, t.y),
        },
      )
      if (lock) { lockX = lock.x; lockY = lock.y; this.lockedTargetId = lock.id ?? null }
      else this.lockedTargetId = null
    } else this.lockedTargetId = null
    const aim = resolveAim({
      padAimX, padAimY, arrowX, arrowY,
      mouseX: mouseAimX, mouseY: mouseAimY,
      lockX, lockY,
      moveX: this.explicitAimOwns ? 0 : mx, moveY: this.explicitAimOwns ? 0 : my,
      lastAimX: this.lastAim.x, lastAimY: this.lastAim.y,
    })
    f.aimX = aim.x; f.aimY = aim.y; f.aimSoft = aim.soft
    this.lastAim = { x: aim.x, y: aim.y }
    f.attack = attack; f.attackHeld = attackHeld; f.dodge = dodge; f.restart = restart
    if (world.roomPhase === 'reward') {
      const left = this.pressed.has('ArrowLeft') || this.pressed.has('KeyA')
      const right = this.pressed.has('ArrowRight') || this.pressed.has('KeyD')
      f.choiceDelta = left === right ? padChoiceDelta : left ? -1 : 1
      f.confirm = this.pressed.has('Enter') || this.pressed.has('Space') || this.pressed.has('KeyJ') || this.pressed.has('KeyZ') || this.mousePressed || padAttackEdge || dodge
      f.moveX = 0; f.moveY = 0; f.attack = false; f.attackHeld = false; f.dodge = false
    } else if (world.player.state === 'dead' || (world.roomPhase === 'resolved' && world.session.run?.result !== 'active')) {
      f.confirm = this.pressed.has('Enter') || this.pressed.has('Space') || this.pressed.has('KeyJ') || this.pressed.has('KeyZ') || this.mousePressed || padAttackEdge || dodge
    }
    this.pressed.clear(); this.mousePressed = false
    return f
  }

}
