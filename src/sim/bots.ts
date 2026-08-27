// Scripted players for headless runs. Deliberately simple; they exist to produce metrics, not to be good.
import type { World, Enemy } from './world'
import { emptyInput, type InputFrame } from './input'
import { tuning } from '@/tuning'

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
  return inp
}

// Keeps distance, punishes recoveries, dodges through telegraphs. A rough stand-in for a competent player.
function kite(world: World): InputFrame {
  const inp = emptyInput()
  const p = world.player
  const e = nearest(world)
  if (!e) return inp
  const d = aimAt(inp, world, e)
  const threat = world.enemies.some(x => x.active && x.state !== 'dead' && (x.state === 'windup' || x.state === 'freeze') && Math.hypot(x.x - p.x, x.y - p.y) < 48 && x.stateTick > (x.kind === 'brute' ? 12 : 10))
  const incomingBolt = world.projectiles.some(b => b.active && Math.hypot(b.x - p.x, b.y - p.y) < 22)
  if ((threat || incomingBolt) && p.state !== 'dodge') {
    inp.dodge = true
    inp.moveX = -inp.aimY; inp.moveY = inp.aimX // roll sideways
    return inp
  }
  const punishable = e.state === 'recover' || e.state === 'stagger' || e.state === 'aim' || e.state === 'idle' || e.kind === 'caster'
  if (punishable || e.kind === 'charger') {
    if (d > 20) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
    if (d <= 26) inp.attack = world.tick % 3 === 0
  } else {
    // hold spacing just outside brute range, poke when safe
    if (d < 34) { inp.moveX = -inp.aimX; inp.moveY = -inp.aimY }
    else if (d > 44) { inp.moveX = inp.aimX; inp.moveY = inp.aimY }
    if (d <= 26 && e.state === 'chase') inp.attack = world.tick % 3 === 0
  }
  return inp
}
