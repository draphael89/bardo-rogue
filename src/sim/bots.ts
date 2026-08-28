// Scripted players for headless runs. Deliberately simple; they exist to produce metrics, not to be good.
import type { World, Enemy } from './world'
import { emptyInput, type InputFrame } from './input'
import { tuning } from '@/tuning'
import { hasLineOfSight, overlapsSolid } from './collision'
import { WARDEN_PATTERN, wardenWindup } from './enemies/warden'
import { wardenLaneThreatensPoint, wardenProjectileAngle, wardenProjectileContract } from './enemies/warden-contract'

export type Bot = (world: World) => InputFrame
export type BotName = 'idle' | 'naive-melee' | 'kite' | 'slice-naive' | 'slice-kite'

export function makeBot(name: BotName): Bot {
  switch (name) {
    case 'idle': return () => emptyInput()
    case 'naive-melee': return naiveMelee
    case 'kite': return kite
    case 'slice-naive': return makeSliceBot(naiveMelee)
    case 'slice-kite': return makeSliceBot(kite)
  }
}

function moveToward(inp: InputFrame, world: World, x: number, y: number): number {
  const dx = x - world.player.x, dy = y - world.player.y
  const d = Math.hypot(dx, dy) || 1
  inp.moveX = dx / d; inp.moveY = dy / d
  inp.aimX = inp.moveX; inp.aimY = inp.moveY
  return d
}

// Full-loop regression driver. It obeys the same physical rack, reward input, and door overlaps as a
// player; combat delegates to the requested policy. It is intentionally stateful so one invocation
// means one attempt, which makes pacing regressions easy to compare across seeds.
function makeSliceBot(combat: Bot): Bot {
  let finished = false
  let lastX = NaN, lastY = NaN, stuck = 0, orbit: 1 | -1 = 1
  return world => {
    const inp = emptyInput()
    if (finished) return inp
    if (world.player.state === 'dead') {
      if (world.tick - world.player.deathTick > 55) { inp.confirm = true; finished = true }
      return inp
    }
    if (world.session.run?.result === 'won') { inp.confirm = true; finished = true; return inp }
    if (world.roomPhase === 'transitioning') return inp
    if (world.roomPhase === 'reward') { inp.confirm = true; return inp }
    if (world.roomPhase === 'town') {
      if (!world.session.preparedWeapon && world.arena.rack) moveToward(inp, world, world.arena.rack.x, world.arena.rack.y)
      else {
        const door = world.arena.doors.find(d => d.dir === 'north')!
        moveToward(inp, world, (door.col + 0.5) * 16, 24)
      }
      return inp
    }
    if (world.roomPhase === 'exits') {
      const room = world.rooms[world.roomIndex]
      const dir = room.id === 'threshold' && (world.seed & 1) === 0 ? 'east' : 'north'
      const door = world.arena.doors.find(d => d.dir === dir) ?? world.arena.doors[0]
      const tx = dir === 'east' ? door.col * 16 + 4 : (door.col + 0.5) * 16
      const ty = dir === 'east' ? (door.row + 0.5) * 16 : 24
      moveToward(inp, world, tx, ty)
      return inp
    }
    const out = combat(world)
    const moving = Math.hypot(out.moveX, out.moveY) > 0.5
    const moved = Number.isFinite(lastX) ? Math.hypot(world.player.x - lastX, world.player.y - lastY) : 1
    if (moving && moved < 0.08) stuck++
    else stuck = Math.max(0, stuck - 2)
    lastX = world.player.x; lastY = world.player.y
    if (stuck > 24) {
      const e = nearest(world)
      if (e) {
        aimAt(out, world, e)
        out.moveX = -out.aimY * orbit
        out.moveY = out.aimX * orbit
        if (stuck > 80) { stuck = 0; orbit = orbit === 1 ? -1 : 1 }
      }
    }
    return out
  }
}

function nearest(world: World): Enemy | null {
  let best: Enemy | null = null, bd = Infinity
  const p = world.player
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead') continue
    const d = Math.hypot(e.x - p.x, e.y - p.y)
    if (d < bd) { bd = d; best = e }
  }
  return best
}

function aimAt(inp: InputFrame, world: World, e: Enemy): number {
  const p = world.player
  const dx = e.x - p.x, dy = e.y - p.y
  const d = Math.hypot(dx, dy) || 1
  inp.aimX = dx / d; inp.aimY = dy / d
  return d
}

function wardenProjectileThreatensPlayer(world: World, e: Enemy): boolean {
  const pattern = e.pattern === WARDEN_PATTERN.ring ? 'ring' : e.pattern === WARDEN_PATTERN.fan ? 'fan' : null
  if (!pattern) return false
  const contract = wardenProjectileContract(pattern, e.actionPhase)
  for (let volley = 0; volley < contract.volleys; volley++) {
    for (let i = 0; i < contract.count; i++) {
      const angle = wardenProjectileAngle(contract, e.aimAngle, e.patternCursor, i, volley)
      if (wardenLaneThreatensPoint(world.arena, e.x, e.y, angle, contract, world.player.x, world.player.y)) return true
    }
  }
  return false
}

// Walks at the nearest enemy and mashes attack. Dodges only when a brute is mid-windup nearby.
function naiveMelee(world: World): InputFrame {
  const inp = emptyInput()
  const e = nearest(world)
  if (!e) return inp
  const d = aimAt(inp, world, e)
  if (d > 18) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
  if (d <= tuning.player.attack.swings[0].radius) inp.attack = world.tick % 4 === 0
  if (e.kind === 'brute' && e.state === 'windup' && e.stateTick > 12 && d < 40) { inp.dodge = true; inp.moveX = -inp.aimX; inp.moveY = -inp.aimY }
  const wardenDodgeTick = e.kind === 'warden' ? wardenWindup(e) - 10 : 0
  if (e.kind === 'warden' && e.pattern === WARDEN_PATTERN.slam && e.state === 'windup' && e.stateTick > wardenDodgeTick && d < tuning.warden.slamRadius + 6) {
    inp.dodge = true; inp.moveX = -inp.aimX; inp.moveY = -inp.aimY
  }
  return inp
}

// Keeps distance, punishes recoveries, dodges through telegraphs. A rough stand-in for a competent player.
function kite(world: World): InputFrame {
  const inp = emptyInput()
  const p = world.player
  const e = nearest(world)
  if (!e) return inp
  const d = aimAt(inp, world, e)
  const threat = world.enemies.some(x => {
    if (!x.active || x.state === 'dead') return false
    if (x.state !== 'windup' && x.state !== 'freeze') return false
    if (x.kind === 'warden') {
      const late = x.stateTick > wardenWindup(x) - 10
      if (!late) return false
      if (x.pattern === WARDEN_PATTERN.ring || x.pattern === WARDEN_PATTERN.fan) {
        return wardenProjectileThreatensPlayer(world, x)
      }
      return Math.hypot(x.x - p.x, x.y - p.y) < tuning.warden.slamRadius + tuning.player.radius
    }
    if (Math.hypot(x.x - p.x, x.y - p.y) >= 48) return false
    // Land the Warden roll inside the newly authored full-travel i-frame window. The old fixed
    // tick 20 launched too early for the 36-tick tell and was already in landing when the slam hit.
    const late = x.kind === 'brute' ? 12 : 10
    return x.stateTick > late
  })
  const incomingBolt = world.projectiles.find(b => b.active && b.team === 0
    && Math.hypot(b.x - p.x, b.y - p.y) < 22
    && (p.x - b.x) * b.vx + (p.y - b.y) * b.vy > 0)
  if ((threat || incomingBolt) && p.state !== 'dodge') {
    inp.dodge = true
    // Prefer the old left-hand sidestep, but do not ask the collision regression probe to roll into
    // a pillar when the equally valid opposite lane is open. This keeps the bot measuring combat
    // decisions instead of an obsolete corner-pop escape.
    const boltSpeed = incomingBolt ? Math.hypot(incomingBolt.vx, incomingBolt.vy) || 1 : 1
    const axisX = incomingBolt ? incomingBolt.vx / boltSpeed : inp.aimX
    const axisY = incomingBolt ? incomingBolt.vy / boltSpeed : inp.aimY
    const left = { x: -axisY, y: axisX }
    const right = { x: axisY, y: -axisX }
    const room = (d: { x: number; y: number }) => {
      let clear = 0
      for (let n = 8; n <= tuning.player.dodge.distance; n += 8) {
        if (overlapsSolid(world.arena, p.x + d.x * n, p.y + d.y * n, p.radius)) break
        clear = n
      }
      return clear
    }
    const dir = room(right) > room(left) ? right : left
    inp.moveX = dir.x; inp.moveY = dir.y
    return inp
  }
  if (!hasLineOfSight(world.arena, p.x, p.y, e.x, e.y)) {
    inp.moveX = -inp.aimY * e.orbitDir
    inp.moveY = inp.aimX * e.orbitDir
    return inp
  }
  const punishable = e.state === 'recover' || e.state === 'stagger' || e.state === 'aim' || e.state === 'idle' || e.kind === 'caster'
  if (punishable || e.kind === 'charger') {
    if (d > 20) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
    if (d <= 42) inp.attack = world.tick % 3 === 0
  } else {
    // Close to a real punish distance. The old 34–44 px dead band could stare at a brute across a
    // pillar forever; a human routes around it, so the control probe must keep expressing intent too.
    if (d < 23) { inp.moveX = -inp.aimX; inp.moveY = -inp.aimY }
    else if (d > 25) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
    if (d <= 27 && e.state === 'chase') inp.attack = world.tick % 3 === 0
  }
  return inp
}
