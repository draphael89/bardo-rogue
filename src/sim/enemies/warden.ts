import { DT, tuning } from '@/tuning'
import type { World, Enemy } from '../world'
import { angleToPlayer, distToPlayer, moveToward, facePlayer, enemyRadialAttack, tickStagger } from './common'
import { overlapsSolid } from '../collision'

// MINOS, JUDGE OF THE FIRST GATE. The kind stays `warden` in code because it is an append-only
// hashed enum; every player-facing string says Minos.
//
// He has three attacks and picks between them by range and by turn, so a fight with him is a
// conversation rather than a metronome. See the tuning block for what each one asks of the player.
export const ATTACK = { gavel: 0, verdict: 1, scales: 2 } as const

export function wardenWindup(e: Enemy): number {
  const W = tuning.warden
  if (e.attackId === ATTACK.verdict) return e.phase ? W.sweep.windup2 : W.sweep.windup
  return e.phase ? W.windup2 : W.windup
}

export function wardenRecover(e: Enemy): number {
  return e.phase ? tuning.warden.recover2 : tuning.warden.recover
}

function maybePhase(world: World, e: Enemy): void {
  if (e.phase || e.hp * 2 > e.maxHp) return
  e.phase = 1
  world.emit({ type: 'enemyPhase', id: e.id, kind: 'warden', x: e.x, y: e.y, phase: 1 })
}

function looseRing(world: World, e: Enemy): void {
  const W = tuning.warden
  for (let i = 0; i < W.boltCount; i++) {
    const a = e.aimAngle + (Math.PI * 2 * i) / W.boltCount
    const ox = e.x + Math.cos(a) * (e.radius + 4)
    const oy = e.y + Math.sin(a) * (e.radius + 4)
    const bolt = world.fireProjectile(ox, oy, a, W.boltSpeed, W.boltRadius, W.boltLife, 0, W.boltDamage, 0, 'bolt', e.kind)
    if (bolt) world.emit({ type: 'boltFired', x: ox, y: oy, angle: a })
  }
}

// One mark of the scales. Placed on open floor only: a verdict inside masonry is a threat the player
// is never allowed to answer, which reads as unfair rather than hard.
function mark(world: World, e: Enemy, x: number, y: number): void {
  const S = tuning.warden.scales
  const a = world.arena
  const cx = Math.max(a.inner.x0 + S.radius * 0.5, Math.min(a.inner.x1 - S.radius * 0.5, x))
  const cy = Math.max(a.inner.y0 + S.radius * 0.5, Math.min(a.inner.y1 - S.radius * 0.5, y))
  if (overlapsSolid(a, cx, cy, 4)) return
  const v = world.fireProjectile(cx, cy, 0, 0, S.radius, S.delay, 0, S.damage, 0, 'verdict', e.kind)
  if (v) world.emit({ type: 'verdictMarked', x: cx, y: cy, radius: S.radius, ticks: S.delay })
}

// The scales fall where the player IS, and to either side of where they would naturally run. The
// answer is to move through the gap rather than away, which is the lesson the whole fight teaches.
function callScales(world: World, e: Enemy): void {
  const S = tuning.warden.scales
  const p = world.player
  const away = Math.atan2(p.y - e.y, p.x - e.x)
  mark(world, e, p.x, p.y)
  for (let i = 1; i < S.count; i++) {
    const side = i % 2 === 1 ? 1 : -1
    const step = Math.ceil(i / 2)
    const a = away + side * (Math.PI / 2)
    mark(world, e, p.x + Math.cos(a) * S.spread * step, p.y + Math.sin(a) * S.spread * step)
  }
}

// The verdict: a stream of bolts that rotates through an arc, so the lane it denies moves while it
// fires. The index is derived from the attack clock rather than counted into a field: `targetX`,
// the obvious place to put a counter, is owned by the caster as "the id of the bolt I loosed" and is
// scanned across EVERY enemy when a bolt is cut (player.ts punishBoltOwner). Borrowing it here would
// have let a cut bolt whose id happened to match the counter drag Minos across the room.
function verdictBolts(e: Enemy): number {
  return e.phase ? tuning.warden.sweep.bolts2 : tuning.warden.sweep.bolts
}

function speakVerdict(world: World, e: Enemy, i: number): void {
  const V = tuning.warden.sweep
  const total = verdictBolts(e)
  if (i >= total) return
  const span = (V.arcDeg * Math.PI) / 180
  // Sweeps from one edge to the other, and alternates its direction per cast so the same answer
  // never works twice in a row.
  const dir = e.orbitDir
  const t = total === 1 ? 0.5 : i / (total - 1)
  const a = e.aimAngle + dir * (-span / 2 + span * t)
  const ox = e.x + Math.cos(a) * (e.radius + 4)
  const oy = e.y + Math.sin(a) * (e.radius + 4)
  const bolt = world.fireProjectile(ox, oy, a, V.speed, tuning.warden.boltRadius, tuning.warden.boltLife, 0, tuning.warden.boltDamage, 0, 'bolt', e.kind)
  if (bolt) world.emit({ type: 'boltFired', x: ox, y: oy, angle: a })
}

// Which case he hears next. Range decides first — the verdict is a lane and needs room to be one —
// and the rest alternates, so no attack ever comes three times running.
function chooseAttack(world: World, e: Enemy): number {
  const W = tuning.warden
  const far = distToPlayer(world, e) >= W.sweep.range
  if (far) return ATTACK.verdict
  if (e.phase && e.attackId !== ATTACK.scales && world.rng.next() < 0.45) return ATTACK.scales
  return e.attackId === ATTACK.gavel ? ATTACK.verdict : ATTACK.gavel
}

export function updateWarden(world: World, e: Enemy): void {
  const W = tuning.warden
  const p = world.player
  maybePhase(world, e)
  if (e.cooldown > 0) e.cooldown--

  switch (e.state) {
    case 'idle':
      if (e.stateTick >= W.idleTicks) { e.state = 'chase'; e.stateTick = 0 }
      break
    case 'chase': {
      if (p.state === 'dead') { e.vx = 0; e.vy = 0; break }
      e.orbitAngle += W.orbitSpeed * DT * e.orbitDir
      const r = (W.orbitMin + W.orbitMax) / 2
      moveToward(world, e, p.x + Math.cos(e.orbitAngle) * r, p.y + Math.sin(e.orbitAngle) * r, W.speed)
      facePlayer(world, e)
      // The gavel needs him close; the verdict needs him far. Either way he commits from where he is.
      if (e.cooldown <= 0) {
        e.attackId = chooseAttack(world, e)
        const inGavelRange = distToPlayer(world, e) <= W.orbitMax + 20
        if (e.attackId !== ATTACK.gavel || inGavelRange) {
          e.state = 'windup'; e.stateTick = 0
          e.aimAngle = angleToPlayer(world, e)
          e.hitDone = false
          e.dashTicks = 0
          world.emit({ type: 'enemyWindup', id: e.id, kind: 'warden', x: e.x, y: e.y })
        }
      }
      break
    }
    case 'windup':
      e.vx = 0; e.vy = 0
      if (e.stateTick <= wardenWindup(e) - W.commitLead) { e.aimAngle = angleToPlayer(world, e); facePlayer(world, e) }
      if (e.stateTick >= wardenWindup(e)) {
        e.state = 'attack'; e.stateTick = 0; e.hitDone = false; e.dashTicks = 0
        // The scales are written the instant he commits, so their whole delay is the player's to use.
        if (e.attackId === ATTACK.scales) callScales(world, e)
        world.emit({ type: 'enemyAttack', id: e.id, kind: 'warden', x: e.x, y: e.y, angle: e.aimAngle })
      }
      break
    case 'attack': {
      e.vx = 0; e.vy = 0
      if (e.attackId === ATTACK.verdict) {
        const V = W.sweep
        const total = verdictBolts(e)
        // Bolt n is spoken on tick n*interval, so the clock alone says how many have been spoken.
        if (e.stateTick > 0 && e.stateTick % V.interval === 0) speakVerdict(world, e, e.stateTick / V.interval - 1)
        const spoken = Math.floor(e.stateTick / V.interval)
        if (spoken >= total) {
          // Phase two answers its own verdict with a ring: the lane you escaped into is the one that
          // closes. This is the recombination, not a faster sweep.
          if (e.phase && !e.dashTicks) { looseRing(world, e); e.dashTicks = 1 }
          if (e.stateTick >= total * V.interval + (e.phase ? W.boltDelay : 0)) { e.state = 'recover'; e.stateTick = 0 }
        }
        break
      }
      if (e.attackId === ATTACK.scales) {
        // He has already spoken; the marks are counting down on their own. The recovery is the punish.
        if (e.stateTick >= W.slamTicks) { e.state = 'recover'; e.stateTick = 0 }
        break
      }
      if (!e.hitDone && e.stateTick > 0 && e.stateTick <= W.slamTicks) {
        if (enemyRadialAttack(world, e, W.slamRadius, W.slamDamage)) e.hitDone = true
      }
      if (e.phase && !e.dashTicks && e.stateTick > W.slamTicks) {
        // Phase-two gavel: the ring he always threw, and now the floor keeps the sentence too, so
        // the safe ground you rolled to is not safe by the time you land on it.
        looseRing(world, e)
        const S = W.scales
        for (let i = 0; i < S.gavelCount; i++) {
          const a = e.aimAngle + Math.PI + (i - (S.gavelCount - 1) / 2) * 0.9
          mark(world, e, e.x + Math.cos(a) * S.spread, e.y + Math.sin(a) * S.spread)
        }
        e.dashTicks = 1
      }
      if (e.stateTick >= W.slamTicks + (e.phase ? W.boltDelay : 0)) { e.state = 'recover'; e.stateTick = 0 }
      break
    }
    case 'recover':
      e.vx = 0; e.vy = 0
      if (e.stateTick >= wardenRecover(e)) {
        e.state = 'chase'; e.stateTick = 0
        e.cooldown = W.cooldown
        // Flip the sweep's handedness so the next verdict reads the other way.
        e.orbitDir = e.orbitDir === 1 ? -1 : 1
      }
      break
    case 'stagger':
      if (tickStagger(world, e, W.staggerTicks, 'chase')) e.cooldown = W.cooldown
      break
    default:
      e.state = 'chase'
  }
}
