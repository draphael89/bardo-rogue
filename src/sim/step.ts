import type { World } from './world'
import type { InputFrame } from './input'
import { capturePlayerInput, updatePlayer } from './player'
import { updateEnemies } from './enemies'
import { updateProjectiles } from './projectiles'
import { updateSpawnQueue, updateWaves } from './waves'
import { tryEnterDoor } from './rooms'
import { tryCollectOffering } from './offering'
import { canReturn, returnToHub } from './return'
import { separate } from './collision'
import { tuning } from '@/tuning'

// One deterministic tick. Presentation must never call anything else on the sim.
export function stepWorld(world: World, input: InputFrame): void {
  world.tick++
  if (input.restart) {
    if (canReturn(world)) returnToHub(world)
    else world.wantsRestart = true
  }

  // snapshot previous positions for render interpolation
  const p = world.player
  p.px = p.x; p.py = p.y
  for (const e of world.enemies) if (e.active) { e.px = e.x; e.py = e.y }
  for (const b of world.projectiles) if (b.active) { b.px = b.x; b.py = b.y }

  // presses during hit-stop still buffer; that is what makes chaining feel responsive
  capturePlayerInput(world, input)

  if (world.freeze > 0) { world.freeze--; return }

  if (world.slowmoTicks > 0 && --world.slowmoTicks === 0) world.timeScale = 1

  updatePlayer(world, input)
  tryEnterDoor(world)
  tryCollectOffering(world)
  updateEnemies(world)
  updateProjectiles(world)
  updateSpawnQueue(world)
  updateWaves(world)
  resolveOverlaps(world)
}

function resolveOverlaps(world: World): void {
  const p = world.player
  const es = world.enemies
  // A roll ghosts for its whole travel phase, not just its i-frame window. Being hittable on the
  // brake tail is the price of the roll; being body-blocked mid-flight is a broken promise.
  const playerGhost = p.state === 'dodge' && p.stateTick < tuning.player.dodge.travel
  for (let i = 0; i < es.length; i++) {
    const a = es[i]
    if (!a.active || a.state === 'dead') continue
    if (!playerGhost && p.state !== 'dead' && a.state !== 'dash') separate(world.arena, p, p.radius, a, a.radius, 0.3, 0.7)
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j]
      if (!b.active || b.state === 'dead') continue
      if (a.state === 'dash' || b.state === 'dash') continue
      separate(world.arena, a, a.radius, b, b.radius, 0.5, 0.5)
    }
  }
}
