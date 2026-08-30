import { Container, Graphics, Text } from 'pixi.js'
import type { DoorMark } from '@/sim/arena'
import { FIRST_GATE, mapPlan, type MapPlan } from '@/sim/route'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'
import { fadeToBlack, label, placeLeft, typeBehindPlate, P } from './ui'
import { OATH } from './oathMetal'

function markColor(mark: DoorMark): number {
  switch (mark) {
    case 'blade': return P.ember
    case 'veil': return P.veil
    case 'combat': return P.bone
    case 'gift': return P.gold
    case 'hard': return P.ember
    case 'elite': return OATH.rim
    case 'boss': return P.red
    default: { const _e: never = mark; return _e }
  }
}

/**
 * Exits-phase route strip. Informational only — the player still walks into a door.
 * Hidden during town, fighting, reward, rite, title, and pause.
 */
export class RouteMap {
  root = new Container()
  private g = new Graphics()
  // The type is its own child so it can leave by TINT while the plate under it leaves by ALPHA.
  // See `fadeToBlack` in ui.ts: every label here carries `crispText`, and Pixi bakes container alpha
  // into the glyph vertices before that filter runs — so an alpha ramp holds the words at full
  // brightness, erodes their letterforms, and then deletes the lot in one frame at 0.5, over a plate
  // that is still politely fading. The reward overlay's own reveal makes exactly this distinction.
  private type = new Container()
  private texts: Text[] = []
  private key = ''
  private paused = false
  private suppressed = false

  constructor(layer: Container) {
    this.root.visible = false
    this.root.addChild(this.g, this.type)
    layer.addChild(this.root)
  }

  relayout(): void { this.key = '' }
  setPaused(paused: boolean): void { if (this.paused !== paused) { this.paused = paused; this.key = '' } }
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed !== suppressed) { this.suppressed = suppressed; this.key = '' }
  }

  update(world: World): void {
    const run = world.session.run
    const room = world.rooms[world.roomIndex]
    // The strip is a summary of a plan the ROOM already states: every exit wears its own mark in the
    // masonry (`paintMark`). So it says its piece and then gets out of the play area rather than
    // owning the upper third of it for as long as the player takes to pick a door.
    const age = world.tick - world.phaseTick
    const R = tuning.run.routeStrip
    const show = !this.suppressed && !this.paused
      && world.scenario === 'loop'
      && world.roomPhase === 'exits'
      && !!run && run.result === 'active'
      && !run.pendingReward && !run.pendingRite && !run.pendingShop && !run.pendingMystery
      && (room.exits?.length ?? 0) > 0
      && age < R.holdTicks + R.fadeTicks
    this.root.visible = show
    if (!show) return
    const path = run.roomHistory.map(v => v.id).join('>')
    const plan = mapPlan(world.rooms, room.id, run.map?.template === FIRST_GATE.id)
    const next = plan.doors.map(d => `${d.mark}:${d.dest}:${d.detail ?? ''}`).join('|')
    const nextKey = `${tuning.view.width}|${path}|${next}|${plan.then ?? ''}`
    if (nextKey !== this.key) {
      this.key = nextKey
      this.paint(plan)
    }
    // AFTER any repaint, never before it: `clear()` installs a fresh Graphics at alpha 1 and resets
    // the type's tint to white, so a relayout or a suppression toggle landing mid-fade would flash
    // the strip back to full for a frame.
    const t = age < R.holdTicks ? 1 : Math.max(0, 1 - (age - R.holdTicks) / R.fadeTicks)
    this.g.alpha = t
    // Words first, then the surface they were written on — the same order the reveal arrives in.
    this.type.tint = fadeToBlack(typeBehindPlate(t))
  }

  private paint(plan: MapPlan): void {
    this.clear()
    const W = tuning.view.width
    const rowH = 14
    const contractRowH = 25
    const pad = 8
    const nameX = 52          // the second column, measured from the plate's left edge
    const doorHeights = plan.doors.map(ex => ex.detail ? contractRowH : rowH)
    const boxH = pad * 2 + doorHeights.reduce((sum, h) => sum + h, 0) + (plan.then ? rowH : 0)
    const boxY = 82

    // Build the type first and let it decide the plate's width. It used to be a flat 280 — which was
    // invisible and therefore harmless, and became a 280x44 slab across the upper play area the
    // moment the plate was made to read at all. A panel earns exactly the room its longest row needs.
    const marks = plan.doors.map(ex => label(ex.markLabel, 'meta', markColor(ex.mark)))
    const names = plan.doors.map(ex => label(ex.dest, 'meta', P.bone))
    const details = plan.doors.map(ex => ex.detail ? label(ex.detail, 'meta', P.dim) : null)
    const then = plan.then ? label(plan.then, 'meta', P.dim) : null
    const widest = Math.max(
      ...names.map(t => nameX + Math.round(t.width)),
      ...marks.map(t => 10 + Math.round(t.width)),
      ...details.map(t => t ? 10 + Math.round(t.width) : 0),
      then ? 10 + Math.round(then.width) : 0,
    )
    const boxW = Math.min(W - 16, widest + 12)
    const boxX = Math.round((W - boxW) / 2)

    // The overlay face, not `P.void`: sampled over the Cocytus floor the old plate came out at
    // (2,1,5) against a floor of (2,1,5) — pixel-identical, i.e. no plate at all, which is why this
    // read as bare text with a floating gold tick rather than as a panel.
    this.g.roundRect(boxX, boxY, boxW, boxH, 2).fill({ color: P.face, alpha: 0.9 })
    this.g.rect(boxX, boxY, 2, boxH).fill({ color: P.gold })

    let rowY = boxY + pad
    plan.doors.forEach((ex, i) => {
      const y = rowY + rowH / 2
      // The doors already face the room. NORTH / EAST on this strip was a compass sitting on the plan.
      placeLeft(marks[i], boxX + 10, y)
      this.add(marks[i])
      placeLeft(names[i], boxX + nameX, y)
      this.add(names[i])
      const detail = details[i]
      if (detail && ex.detail) {
        placeLeft(detail, boxX + 10, y + 11)
        this.add(detail)
      }
      rowY += doorHeights[i] ?? rowH
    })

    if (then) {
      const y = rowY + rowH / 2
      placeLeft(then, boxX + 10, y)
      this.add(then)
    }
  }

  private clear(): void {
    for (const t of this.texts) t.destroy()
    this.texts = []
    this.type.removeChildren()
    this.type.tint = 0xffffff
    this.root.removeChildren()
    this.g.destroy()
    this.g = new Graphics()
    this.root.addChild(this.g, this.type)
  }

  private add(t: Text): void { this.texts.push(t); this.type.addChild(t) }
}
