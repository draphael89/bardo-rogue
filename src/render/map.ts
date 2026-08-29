import { Container, Graphics, Text } from 'pixi.js'
import type { DoorMark } from '@/sim/arena'
import { mapPlan, type MapPlan } from '@/sim/route'
import type { World } from '@/sim/world'
import { tuning } from '@/tuning'
import { label, placeLeft, P } from './ui'
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
  private texts: Text[] = []
  private key = ''
  private paused = false
  private suppressed = false

  constructor(layer: Container) {
    this.root.visible = false
    this.root.addChild(this.g)
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
    this.root.alpha = age < R.holdTicks ? 1 : Math.max(0, 1 - (age - R.holdTicks) / R.fadeTicks)
    const path = run.roomHistory.map(v => v.id).join('>')
    const plan = mapPlan(world.rooms, room.id)
    const next = plan.doors.map(d => `${d.mark}:${d.dest}`).join('|')
    const nextKey = `${tuning.view.width}|${path}|${next}|${plan.then ?? ''}`
    if (nextKey === this.key) return
    this.key = nextKey
    this.paint(plan)
  }

  private paint(plan: MapPlan): void {
    this.clear()
    const W = tuning.view.width
    const rowH = 14
    const pad = 8
    const nameX = 52          // the second column, measured from the plate's left edge
    const rows = plan.doors.length + (plan.then ? 1 : 0)
    const boxH = pad * 2 + rows * rowH
    const boxY = 82

    // Build the type first and let it decide the plate's width. It used to be a flat 280 — which was
    // invisible and therefore harmless, and became a 280x44 slab across the upper play area the
    // moment the plate was made to read at all. A panel earns exactly the room its longest row needs.
    const marks = plan.doors.map(ex => label(ex.markLabel, 'meta', markColor(ex.mark)))
    const names = plan.doors.map(ex => label(ex.dest, 'meta', P.bone))
    const then = plan.then ? label(plan.then, 'meta', P.dim) : null
    const widest = Math.max(
      ...names.map(t => nameX + Math.round(t.width)),
      ...marks.map(t => 10 + Math.round(t.width)),
      then ? 10 + Math.round(then.width) : 0,
    )
    const boxW = Math.min(W - 16, widest + 12)
    const boxX = Math.round((W - boxW) / 2)

    // The overlay face, not `P.void`: sampled over the Cocytus floor the old plate came out at
    // (2,1,5) against a floor of (2,1,5) — pixel-identical, i.e. no plate at all, which is why this
    // read as bare text with a floating gold tick rather than as a panel.
    this.g.roundRect(boxX, boxY, boxW, boxH, 2).fill({ color: P.face, alpha: 0.9 })
    this.g.rect(boxX, boxY, 2, boxH).fill({ color: P.gold })

    plan.doors.forEach((_ex, i) => {
      const y = boxY + pad + rowH * i + rowH / 2
      // The doors already face the room. NORTH / EAST on this strip was a compass sitting on the plan.
      placeLeft(marks[i], boxX + 10, y)
      this.add(marks[i])
      placeLeft(names[i], boxX + nameX, y)
      this.add(names[i])
    })

    if (then) {
      const y = boxY + pad + rowH * plan.doors.length + rowH / 2
      placeLeft(then, boxX + 10, y)
      this.add(then)
    }
  }

  private clear(): void {
    for (const t of this.texts) t.destroy()
    this.texts = []
    this.root.removeChildren()
    this.g.destroy()
    this.g = new Graphics()
    this.root.addChild(this.g)
  }

  private add(t: Text): void { this.texts.push(t); this.root.addChild(t) }
}
