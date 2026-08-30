import { Point } from 'pixi.js'
import { emptyInput, type InputFrame } from '@/sim/input'
import { aimLockTarget, resolveAim } from './aim'
import { tuning } from '@/tuning'
import type { World } from '@/sim/world'
import { hasLineOfSight } from '@/sim/collision'
import type { RenderApp } from '@/render/app'
import { ControllerRearm, RetainedExplicitAim } from './ownership'

// Gamepad buttons read as edges. Every index here must be sampled through edge() every tick or its padPrev
// goes stale and it fires twice.
const PAD_ATTACK = [2, 5, 7]      // X / RB / RT
const PAD_HEAVY = [3, 6]          // Y / LT — the weight sits under a different finger than the light
const PAD_DODGE = [0, 1, 4]       // A / B / LB
// Start. Exported because main.ts's controller-pause poll listens to the same physical button:
// one constant, or remapping it here would silently split "pause" and "restart" onto different keys.
export const PAD_RESTART = [9]
export const PAD_CHOICE_LEFT = 14
export const PAD_CHOICE_RIGHT = 15
// D-pad vertical, standard mapping. Read by the shell's pause card (main.ts), which polls the pad
// itself because the sim — and with it this system's sample() — is stopped while paused.
export const PAD_MENU_UP = 12
export const PAD_MENU_DOWN = 13
export const PAD_MENU_CONFIRM = 0
const PAD_EDGE = new Set([...PAD_ATTACK, ...PAD_HEAVY, ...PAD_DODGE, ...PAD_RESTART, PAD_CHOICE_LEFT, PAD_CHOICE_RIGHT])

function modalInput(world: World): boolean {
  return world.roomPhase === 'reward'
    || world.roomPhase === 'entering'
    || world.player.state === 'dead'
    || (world.roomPhase === 'resolved' && !!world.session.run && world.session.run.result !== 'active')
}

// A boolean could only see the FIRST modal of a run of them. After the ferryman's toll, rewards.ts
// opens a second offer on the same tick the first is confirmed, so `modalInput` never goes false in
// between and the boundary below never fired: one mash claimed both vows. `phaseTick` is stamped on
// every one of those transitions, so keying on it makes each new modal its own boundary.
function modalKey(world: World): string {
  return modalInput(world) ? `modal:${world.phaseTick}` : 'live'
}

// Keyboard + mouse + gamepad -> one InputFrame per sim tick. Presses between ticks are latched so nothing is dropped.
export class InputSystem {
  private down = new Set<string>()
  private pressed = new Set<string>()
  private mouseX = 0; private mouseY = 0
  private mouseSeen = false          // (0,0) is the window corner, not "no cursor" — see resolveAim
  private mouseOwnsAim = false       // explicit aim suppresses a stale cursor until real pointer activity
  private mousePressed = false
  private mouseHeld = false
  private mouseHeavyPressed = false
  private padPrev: boolean[] = []
  private controllerRearm = new ControllerRearm(16)
  private retainedExplicitAim = new RetainedExplicitAim()
  private lastModal: string | null = null
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
      this.mousePressed = false; this.mouseHeld = false; this.mouseHeavyPressed = false
      this.mouseOwnsAim = false
      this.lockedTargetId = null
      this.retainedExplicitAim.clear()
      this.controllerRearm.disarmAll()
    })
    const c = ra.app.canvas
    c.addEventListener('mousemove', e => {
      this.mouseX = e.clientX; this.mouseY = e.clientY; this.mouseSeen = true; this.mouseOwnsAim = true
      this.retainedExplicitAim.clear()
    })
    c.addEventListener('mousedown', e => {
      if (e.button === 0) {
        this.mousePressed = true; this.mouseHeld = true
      } else if (e.button === 2) this.mouseHeavyPressed = true
      else return
      this.mouseOwnsAim = true
      this.retainedExplicitAim.clear()
    })
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouseHeld = false })
    c.addEventListener('contextmenu', e => e.preventDefault())
  }

  sample(world: World): InputFrame {
    const modal = modalInput(world)
    // The boundary is keyed, not merely flagged: `modal` itself still gates aim and the menu branch
    // below, and must stay a boolean.
    const boundaryKey = modalKey(world)
    if (this.lastModal === null) this.lastModal = boundaryKey
    else if (boundaryKey !== this.lastModal) {
      // Everything physically down at the boundary has to be released before it drives the menu.
      this.controllerRearm.disarmActive()
      // ...and so does anything merely LATCHED. `pressed` holds keydowns that arrived since the last
      // sample, and the offer opens on the very tick the last enemy dies — so the attack you were
      // mashing through the killing blow was still sitting here, became `confirm` on the modal's
      // first tick, and took options[0] before a single frame of the screen had been shown. Only the
      // gamepad was ever guarded; the keyboard and the mouse were not.
      this.down.clear(); this.pressed.clear()
      this.mousePressed = false; this.mouseHeld = false; this.mouseHeavyPressed = false
      this.retainedExplicitAim.clear()
      this.mouseOwnsAim = false
      this.lockedTargetId = null
      this.lastModal = boundaryKey
    }
    if (this.override) {
      const f = { ...this.override }
      this.override = { ...this.override, attack: false, heavy: false, dodge: false, restart: false, choiceDelta: 0, confirm: false }
      this.pressed.clear(); this.mousePressed = false; this.mouseHeavyPressed = false; this.lockedTargetId = null
      this.retainedExplicitAim.clear(); this.controllerRearm.disarmAll()
      return f
    }
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
    if (arrowX || arrowY) this.mouseOwnsAim = false

    // mouse aim in world space. Canvas -> the 640x360 render target, then through the INVERSE of the live world
    // container transform, so the follow camera, world scale, shake, punch-zoom and camera roll cannot split
    // the ray you see from the ray the sim uses.
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
    // Two clean rows for the two hands that reach here: J/K/L and Z/X/C, light/dodge/heavy.
    let heavy = this.mouseHeavyPressed || this.pressed.has('KeyL') || this.pressed.has('KeyC')
    // dodge stays an edge: holding it would just be free travel
    let dodge = this.pressed.has('Space') || this.pressed.has('ShiftLeft') || this.pressed.has('KeyK') || this.pressed.has('KeyX')
    let restart = this.pressed.has('KeyR')

    // gamepad. Raw physical state is sampled first; focus/modal rearm decides which channels may
    // reach gameplay. The gate is sampled even with no pad so a disconnect counts as neutral.
    let padAimX = 0, padAimY = 0
    let padChoiceDelta: -1 | 0 | 1 = 0
    let padAttackEdge = false
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const pad = pads && pads[0]
    let rawPadMoveX = 0, rawPadMoveY = 0, rawPadAimX = 0, rawPadAimY = 0
    const rawButtons = Array.from({ length: 16 }, () => false)
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
      rawPadMoveX = lx; rawPadMoveY = ly; rawPadAimX = rx; rawPadAimY = ry
      for (let i = 0; i < rawButtons.length; i++) rawButtons[i] = !!pad.buttons[i]?.pressed
    }
    const allowedPad = this.controllerRearm.sample({
      moveActive: !!(rawPadMoveX || rawPadMoveY),
      aimActive: !!(rawPadAimX || rawPadAimY),
      buttons: rawButtons,
    })
    if (allowedPad.move) { mx = rawPadMoveX; my = rawPadMoveY }
    if (allowedPad.aim) { padAimX = rawPadAimX; padAimY = rawPadAimY }
    if (padAimX || padAimY) { this.mouseOwnsAim = false; mouseAimX = 0; mouseAimY = 0 }
    if (pad) {
      const b = (i: number) => !!allowedPad.buttons[i]
      const edge = (i: number) => { const now = b(i); const was = this.padPrev[i] ?? false; this.padPrev[i] = now; return now && !was }
      // no short-circuit: every listed button must be sampled or padPrev goes stale and it double-fires next tick
      const anyEdge = (ids: readonly number[]) => { let hit = false; for (const i of ids) if (edge(i)) hit = true; return hit }
      for (const i of PAD_ATTACK) if (b(i)) attackHeld = true
      padAttackEdge = anyEdge(PAD_ATTACK)                   // a modal must never inherit a combat hold
      if (padAttackEdge) attack = true
      if (anyEdge(PAD_HEAVY)) heavy = true
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
    const lockHeld = !modal && keyActive('KeyQ')
    if (lockHeld) {
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

    let retainedX = 0, retainedY = 0, retainedSoft = true
    if (modal) {
      // Aim during a modal is not a future combat instruction. The controller gate above still
      // records its raw state so a held stick must return neutral before it can own aim on exit.
      this.retainedExplicitAim.clear()
      this.mouseOwnsAim = false
    } else {
      // A precise pointer or an explicit target identity supersedes any released directional aim.
      // Active arrows/right stick then acquire a fresh retained direction in normal priority order.
      if (lockHeld || mouseAimX || mouseAimY) this.retainedExplicitAim.clear()
      const retained = (padAimX || padAimY)
        ? this.retainedExplicitAim.acquire(padAimX, padAimY, false, mx, my)
        : (arrowX || arrowY)
          ? this.retainedExplicitAim.acquire(arrowX, arrowY, true, mx, my)
          : this.retainedExplicitAim.release(mx, my)
      if (retained) {
        retainedX = retained.x; retainedY = retained.y; retainedSoft = retained.soft
      }
    }
    const aim = resolveAim({
      padAimX, padAimY, arrowX, arrowY,
      mouseX: mouseAimX, mouseY: mouseAimY,
      lockX, lockY,
      retainedX, retainedY, retainedSoft,
      moveX: mx, moveY: my,
      lastAimX: this.lastAim.x, lastAimY: this.lastAim.y,
    })
    f.aimX = aim.x; f.aimY = aim.y; f.aimSoft = aim.soft
    if (!modal) this.lastAim = { x: aim.x, y: aim.y }
    f.attack = attack; f.attackHeld = attackHeld; f.heavy = heavy; f.dodge = dodge; f.restart = restart
    // Both modal screens take the same two keys and swallow everything else, so the sword can never
    // be swung at a menu. `entering` is the rite; `reward` is the offer.
    // One definition of "the confirm was pressed", shared by the two modal branches below — a
    // confirm source added to one and not the other would answer menus but fail to answer a return.
    // One definition of "the confirm was pressed", shared by the two modal branches below — a
    // confirm source added to one and not the other would answer menus but fail to answer a return.
    // Heavy is deliberately NOT folded in: on a reward screen it is the Smith's reroll instead, so
    // each branch adds it on its own terms.
    const confirmBase = this.pressed.has('Enter') || this.pressed.has('Space') || this.pressed.has('KeyJ') || this.pressed.has('KeyZ') || this.mousePressed || padAttackEdge || dodge
    if (world.roomPhase === 'reward' || world.roomPhase === 'entering') {
      const left = this.pressed.has('ArrowLeft') || this.pressed.has('KeyA')
      const right = this.pressed.has('ArrowRight') || this.pressed.has('KeyD')
      f.choiceDelta = left === right ? padChoiceDelta : left ? -1 : 1
      // A heavy on a live offer is the reroll, not the claim; anywhere else it still confirms.
      const reforging = world.roomPhase === 'reward' && heavy && !!world.session.run?.pendingReward
      f.confirm = confirmBase || (!reforging && heavy)
      f.reroll = reforging
      f.moveX = 0; f.moveY = 0; f.attack = false; f.attackHeld = false; f.heavy = false; f.dodge = false
    } else if (world.player.state === 'dead' || (world.roomPhase === 'resolved' && world.session.run?.result !== 'active')) {
      // The reveal owns its opening beats: canReturn() is true on the killing tick itself, so a
      // press already streaming in (a mash, a fresh pad edge) would skip the whole staged card.
      // Gated here, after every device is normalized, so keyboard, mouse and pad wait alike — and
      // ONLY here: bots, replays and the debug override hand their frames to the sim directly
      // (src/main.ts), so recorded fixtures never see this gate.
      // Every death stages a card, run or not — a run-less one counts the felled instead of the
      // chambers (hud.ts) — so both wait. What never gates is the OTHER arm: a stock scenario idling
      // in 'resolved' with no run has nothing being revealed, and its R must still restart at once.
      const dead = world.player.state === 'dead'
      const revealStart = dead ? world.player.deathTick
        : world.session.run && world.session.run.result !== 'active' ? world.phaseTick : -1
      if (revealStart >= 0 && world.tick - revealStart < (dead ? tuning.reveal.deathMinTicks : tuning.reveal.victoryMinTicks)) {
        f.restart = false   // restart returns too (src/sim/step.ts:22), so it waits with confirm
      } else {
        f.confirm = confirmBase || heavy
      }
      // A victory leaves the player ALIVE in a resolved room, and stepWorld does not stop for the
      // summary — so mashing to dismiss it was starting swings and rolls behind the card. The
      // reward and rite modals already blank these; a reveal is a modal too.
      // Only when a card is actually up: a stock scenario idles in 'resolved' with no run and no
      // card, and blanking there would freeze the player in every wave/dummy scenario.
      if (revealStart >= 0) {
        f.moveX = 0; f.moveY = 0; f.attack = false; f.attackHeld = false; f.heavy = false; f.dodge = false
      }
    }
    this.pressed.clear(); this.mousePressed = false; this.mouseHeavyPressed = false
    return f
  }

  // Presentation may read the live hold-to-lock target, but cannot write it or leak it into the
  // deterministic world. A null target means Q is up or the retained target is no longer valid.
  get hardLockTargetId(): number | null { return this.lockedTargetId }

  /**
   * Drop latched combat intent when the player-facing pause opens or closes. WASD on the pause
   * card must not walk the first unpaused tick, and a held confirm (A / J) must not dodge or swing.
   * Pad edges stay armed against the buttons that are still down so a held A does not fire as a new press.
   */
  releaseHeldIntent(): void {
    this.down.clear()
    this.pressed.clear()
    this.mousePressed = false
    this.mouseHeld = false
    this.mouseHeavyPressed = false
    this.mouseOwnsAim = false
    this.lockedTargetId = null
    this.retainedExplicitAim.clear()
    this.controllerRearm.disarmAll()
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const pad = pads && pads[0]
    this.padPrev = pad ? Array.from({ length: 16 }, (_, i) => !!pad.buttons[i]?.pressed) : []
  }

}
