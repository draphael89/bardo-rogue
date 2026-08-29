import { tuning } from '@/tuning'
import { TILE, type Arena } from './arena'
import { overlapsSolid } from './collision'
import { offerShop } from './economy'
import { offerMystery } from './mystery'
import { offerReward } from './rewards'
import type { RoomReward } from './session'
import type { World } from './world'

/**
 * THE BEAT BETWEEN THE LAST BODY AND THE GOD.
 *
 * The offer used to open on the tick the last enemy died. Nothing separated "the fight ended" from
 * "a full-screen meeting is on your screen", which is why `tuning.run.modalArmTicks` had to exist at
 * all — a 400 ms refusal papering over a screen that arrived unannounced, mid-swing. Worse, the one
 * beat the clear DID have was cancelled by its own payout: `updateWaves` sets the clear slow-motion
 * and `parkForModal` reset it to 1 in the same tick, so a room WITH a reward got no kill-punch and a
 * room without one did.
 *
 * So the room's payout is now a thing standing in the room. The game already spoke this verb twice —
 * `tryPrepareWeapon` at the Bardo rack and `tryCollectOffering` on the Far Shore — and both say the
 * same sentence: walk into the object, the world changes. This is the third, and the only one that
 * gates a modal.
 *
 * The vessel is lit at the room's own `focal` (ART_DIRECTION §5.1: the point the room was composed
 * to send the eye to, and where its key light already pools), so the walk is short, authored, and
 * toward the brightest thing in the frame.
 */

// Fixed order, so the tile chosen is a function of the room and the body — never of iteration luck.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
let seen = new Uint8Array(0)
let queue = new Int16Array(0)

function clampTile(v: number, span: number): number {
  return v < 0 ? 0 : v >= span ? span - 1 : v
}

function standable(arena: Arena, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= arena.cols || r >= arena.rows) return false
  return !overlapsSolid(arena, (c + 0.5) * TILE, (r + 0.5) * TILE, tuning.player.radius)
}

/** All eight neighbours free — a tile the vessel stands ON rather than against. */
function inTheOpen(arena: Arena, c: number, r: number): boolean {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!standable(arena, c + dc, r + dr)) return false
  }
  return true
}

/**
 * The reachable tile nearest the anchor — a flood from the BODY, never a spiral from the anchor.
 *
 * A spiral finds the nearest walkable tile, which is a strictly weaker guarantee: the threshold's
 * focal IS the sunken bell and the crossing's is architecture, so the nearest free tile to either
 * can sit on the far side of masonry the player cannot get around. A shrine you cannot walk into is
 * a room you cannot leave, and `pnpm matrix`'s hard gate is exactly "no seed strands a player" — so
 * reachability is established by construction rather than hoped for.
 *
 * Open tiles win over merely standable ones at any distance. The focal is a place the room was
 * composed AROUND — in the threshold hall it is the sunken bell itself — so nearest-standable puts
 * the vessel against masonry that then draws over it, and the one object the room wants read is the
 * one half behind a prop. One tile further out and in the clear is the better read every time.
 *
 * Bounded and allocation-light: 26x15 = 390 tiles, once per room clear, never per tick.
 */
function reachableSpotNear(arena: Arena, fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number } {
  const cols = arena.cols, rows = arena.rows, n = cols * rows
  if (seen.length < n) { seen = new Uint8Array(n); queue = new Int16Array(n) }
  seen.fill(0, 0, n)
  const radius = tuning.player.radius
  const sc = clampTile(Math.floor(fromX / TILE), cols)
  const sr = clampTile(Math.floor(fromY / TILE), rows)
  const gc = clampTile(Math.floor(toX / TILE), cols)
  const gr = clampTile(Math.floor(toY / TILE), rows)
  const start = sr * cols + sc
  let head = 0, tail = 0
  queue[tail++] = start
  seen[start] = 1
  // The body's own tile is the last resort and nothing else: it is trivially reachable, and a room
  // with no standable tile at all is not a room this could rescue anyway.
  let best = start
  let bestD = Infinity
  let open = -1
  let openD = Infinity
  while (head < tail) {
    const at = queue[head++]!
    const c = at % cols, row = (at - c) / cols
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = row + dr
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const ni = nr * cols + nc
      if (seen[ni]) continue
      seen[ni] = 1
      if (overlapsSolid(arena, (nc + 0.5) * TILE, (nr + 0.5) * TILE, radius)) continue
      queue[tail++] = ni
      const d = (nc - gc) ** 2 + (nr - gr) ** 2
      if (d < bestD) { bestD = d; best = ni }
      if (d < openD && inTheOpen(arena, nc, nr)) { openD = d; open = ni }
    }
  }
  const pick = open >= 0 ? open : best
  const bc = pick % cols
  return { x: (bc + 0.5) * TILE, y: ((pick - bc) / cols + 0.5) * TILE }
}

/**
 * The room clears owing something. Light it where the eye already is and leave the door shut.
 *
 * Deliberately does NOT call `parkForModal`: the clear slow-motion set one line earlier in
 * `updateWaves` now runs to the end of its 12 ticks, which is the kill-punch every reward room used
 * to be denied.
 *
 * Returns whether the room actually owes a walk. It is the ONLY thing that can move the room into
 * `claiming`, and `claiming` is the one phase with no timer and no way out but the vessel — so a
 * refusal here has to be visible to the caller, or a run without an active state to pay would park
 * the room in `fighting` forever. That is a soft-lock, which is the exact thing `pnpm matrix`'s hard
 * gate exists to catch; caught here instead.
 */
export function placeShrine(world: World, kind: RoomReward): boolean {
  const run = world.session.run
  if (!run || run.result !== 'active') return false
  const p = world.player
  const focal = world.arena.focal
  const spot = reachableSpotNear(world.arena, p.x, p.y, focal.x, focal.y)
  world.arena.shrine = { x: spot.x, y: spot.y, kind }
  world.arena.shrineTaken = false
  world.roomPhase = 'claiming'
  world.phaseTick = world.tick
  world.emit({ type: 'shrineLit', kind, x: spot.x, y: spot.y })
  return true
}

/**
 * Walk into it and the meeting opens. The mirror of `tryCollectOffering`, and the ONLY path from a
 * cleared room into an offer, a stall, or the Unburied — every one of those `offer*` calls is
 * unchanged below this line, so focus, reroll, the rite's payout and `boonChosen` all behave exactly
 * as they did.
 *
 * The arm window is not politeness, it is the beat itself: the shrine can land within claim range of
 * a body that finished the fight standing on the focal, and without a hold that case reproduces the
 * exact bug this file exists to remove — a meeting opening on the kill tick. Held long enough for
 * the clear slow-motion (12 ticks, ~1 s of wall clock at 0.2x) to finish, so the ignite is always
 * seen before it can be taken.
 */
export function tryClaimShrine(world: World): void {
  if (world.roomPhase !== 'claiming') return
  const s = world.arena.shrine
  if (!s || world.arena.shrineTaken) return
  if (world.player.state === 'dead') return
  if (world.tick - world.phaseTick < tuning.run.shrineArmTicks) return
  const dx = world.player.x - s.x
  const dy = world.player.y - s.y
  const r = tuning.run.shrineRadius
  if (dx * dx + dy * dy > r * r) return
  world.arena.shrineTaken = true
  world.emit({ type: 'shrineTaken', kind: s.kind, x: s.x, y: s.y })
  if (s.kind === 'shop') offerShop(world)
  else if (s.kind === 'mystery') offerMystery(world)
  else offerReward(world, s.kind)
}
