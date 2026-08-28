// Scripted players for headless runs. Deliberately simple; they exist to produce metrics, not to be good.
import type { World, Enemy } from './world'
import { emptyInput, type InputFrame } from './input'
import { tuning } from '@/tuning'
import { hasLineOfSight } from './arena'

export type Bot = (world: World) => InputFrame
export type BotName = 'idle' | 'naive-melee' | 'kite'

export function makeBot(name: BotName): Bot {
  switch (name) {
    case 'idle': return () => emptyInput()
    case 'naive-melee': return naiveMelee
    case 'kite': return kite
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

// Walks at the nearest enemy and mashes attack. Dodges only when a brute is mid-windup nearby.
function naiveMelee(world: World): InputFrame {
  const inp = emptyInput()
  const e = nearest(world)
  if (!e) return inp
  const d = aimAt(inp, world, e)
  if (d > 18) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
  if (d <= tuning.player.attack.swings[0].radius) inp.attack = world.tick % 4 === 0
  if (e.kind === 'brute' && e.state === 'windup' && e.stateTick > 12 && d < 40) { inp.dodge = true; inp.moveX = -inp.aimX; inp.moveY = -inp.aimY }
  if (e.kind === 'warden' && e.state === 'windup' && e.stateTick > 20 && d < tuning.warden.slamRadius + 6) {
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
    const reach = x.kind === 'warden' ? tuning.warden.slamRadius + 8 : 48
    if (Math.hypot(x.x - p.x, x.y - p.y) >= reach) return false
    const late = x.kind === 'brute' ? 12 : x.kind === 'warden' ? 20 : 10
    return x.stateTick > late
  })
  const incomingBolt = world.projectiles.some(b => b.active && Math.hypot(b.x - p.x, b.y - p.y) < 22)
  if ((threat || incomingBolt) && p.state !== 'dodge') {
    inp.dodge = true
    inp.moveX = -inp.aimY; inp.moveY = inp.aimX // roll sideways
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
    if (d <= 26) inp.attack = world.tick % 3 === 0
  } else {
    // Close to a real punish distance. The old 34–44 px dead band could stare at a brute across a
    // pillar forever; a human routes around it, so the control probe must keep expressing intent too.
    if (d < 23) { inp.moveX = -inp.aimX; inp.moveY = -inp.aimY }
    else if (d > 25) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
    if (d <= 27 && e.state === 'chase') inp.attack = world.tick % 3 === 0
  }
  return inp
}
