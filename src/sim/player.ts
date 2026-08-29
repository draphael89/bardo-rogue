import { tuning, DT } from '@/tuning'
import type { Player, World } from './world'
import type { InputFrame } from './input'
import { hasLineOfSight, moveWithWalls } from './collision'
import { arcHits, damageEnemy, addFreeze, addBulletTime, clearBulletTime, swingProgress, swingStep } from './combat'
import { hasBoon, resolveWeaponOnHit, swingReach } from './boons'
import { ARM, armOf } from './weapons'
import { bowMoveScale, bowSteer, looseArrow, startDraw } from './bow'
import { backlash } from './enemies/caster'
import { angleDiff, deg, len } from './math'

export function capturePlayerInput(world: World, input: InputFrame): void {
  const p = world.player
  // Unarmed presses are not future attacks. In particular, holding attack in the Bardo must not
  // manufacture a swing before the rack has physically armed the player.
  if (input.attack && p.armed) p.attackQueuedAt = p.controlTick
  if (input.heavy && p.armed) p.heavyQueuedAt = p.controlTick
  // A second dodge press during travel is not a future action: accepting it would make a roll
  // repeat after the player released the button. Landing presses are real requests, however, and
  // get the same short grace window as an attack cancel.
  if (input.dodge && !(p.dodgeTick >= 0 && p.dodgeTick < tuning.player.dodge.travel)) {
    p.dodgeQueuedAt = p.controlTick
    // The roll direction is latched on the frame the button went down, not on the frame the roll
    // finally gets to start. A dodge buffered out of a swing goes where the stick was pointing when
    // the player asked for it. A roll in flight owns the latch, so it can never be steered.
    latchDodgeDir(world, input)
  }
}

function latchDodgeDir(world: World, input: InputFrame): void {
  const p = world.player
  const m = len(input.moveX, input.moveY)
  if (m > 0.01) { p.dodgeDirX = input.moveX / m; p.dodgeDirY = input.moveY / m }
  else {
    const a = Math.atan2(input.aimY, input.aimX)  // a standing roll goes where you are looking
    p.dodgeDirX = Math.cos(a); p.dodgeDirY = Math.sin(a)
  }
}

export function updatePlayer(world: World, input: InputFrame): void {
  const p = world.player
  const P = tuning.player
  p.controlTick++
  p.stateTick++
  if (p.dodgeTick >= 0) {
    p.dodgeTick++
    if (p.dodgeTick === P.dodge.travel) world.emit({ type: 'dodgeEnd', x: p.x, y: p.y })
    if (p.dodgeTick >= P.dodge.total) p.dodgeTick = -1
  }
  if (p.iframes > 0) p.iframes--
  if (p.flash > 0) p.flash--
  expireIntent(p, 'attackQueuedAt', P.attack.buffer)
  expireIntent(p, 'heavyQueuedAt', P.attack.buffer)
  expireIntent(p, 'dodgeQueuedAt', P.dodge.buffer)

  // aim
  const mlen = len(input.moveX, input.moveY)
  p.moveX = input.moveX; p.moveY = input.moveY
  if (mlen > 0.01) p.moveAngle = Math.atan2(input.moveY, input.moveX)
  let aim = Math.atan2(input.aimY, input.aimX)
  // soft aim is intent, not precision: assist around whatever direction was actually asked for.
  // (Reconstructing it from moveAngle used to be equivalent, because the only soft source was a
  // stick that aimed where it walked. Arrow-key aim points somewhere movement does not.)
  if (input.aimSoft) aim = aimAssist(world, aim)
  else p.assistTargetId = 0
  p.aimAngle = aim // intent always tracks the stick, so a chained swing can be redirected
  // a roll is committed: its facing is latched at launch, so the sprite can never flip mid-tuck
  if (p.state === 'free') p.facing = Math.cos(p.aimAngle) >= 0 ? 1 : -1
  // steering: the swing/draw angle follows the aim for the first few startup ticks, then it is committed
  if (p.state === 'attack') {
    if (armOf(world) === ARM.bow) bowSteer(world, aim)
    else {
      const s = P.attack.swings[p.swingIndex]
      if (p.stateTick < s.steerTicks) {
        const max = deg(P.attack.steerRateDeg)
        const d = angleDiff(p.swingAngle, aim)
        p.swingAngle += d > max ? max : d < -max ? -max : d
        p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
      }
    }
  }

  if (p.state === 'dead') { applyKnockback(world); return }

  // --- state transitions from buffered input ---
  // Priority is a promise about intent, and it is the same everywhere: the roll wins, because its
  // i-frames are the one thing the player must be able to reach; then the heavy, because asking for
  // the committed swing is always deliberate; then the light, which a held button can also produce.
  if (p.state === 'free') {
    if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
    else if (wantsHeavy(world, p)) beginHeavyAttack(world)
    else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer) || (input.attackHeld && armOf(world) === ARM.blade)) beginAttack(world)
  } else if (p.state === 'hurt') {
    if (p.stateTick >= P.hurtReactionTicks) {
      p.state = 'free'; p.stateTick = 0
      // Input capture continues through hit-stop and the recoil. Dodge wins the tie, matching every
      // other return-to-control gate, and both stock buffers outlast this deliberately short state.
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (wantsHeavy(world, p)) beginHeavyAttack(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer) || (input.attackHeld && armOf(world) === ARM.blade)) beginAttack(world)
    }
  } else if (p.state === 'dodge') {
    if (p.stateTick >= P.dodge.total) {
      p.state = 'free'; p.stateTick = 0
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (wantsHeavy(world, p)) beginHeavyAttack(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer) || (input.attackHeld && armOf(world) === ARM.blade)) beginAttack(world)
    }
    // Attacking overlays the last five travel ticks; dodgeTick keeps owning displacement, collision,
    // and i-frames while the blade starts up. The cancel changes the pose, never the roll's promise.
    // Either weight can come out of the roll: the light is the dash attack, the heavy is the leap.
    else if (p.stateTick >= P.dodge.attackCancelFrom) {
      if (wantsHeavy(world, p)) beginHeavyAttack(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer)) beginAttack(world)
    }
  } else if (p.state === 'attack' && armOf(world) === ARM.bow) {
    const B = tuning.bow
    if (p.stateTick === B.draw) looseArrow(world)
    if (p.stateTick >= B.draw + B.recover) {
      p.state = 'free'; p.stateTick = 0
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer)) beginAttack(world)
    }
    else if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer) && p.stateTick >= B.dodgeCancelFrom) startDodge(world)
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    // hit-confirm: a swing that touched something recovers on its own clock; a whiff pays for the miss
    const wp = p.bladeActionConnected ? 0 : s.whiffPenalty
    const total = s.startup + s.active + s.recovery + wp
    const recoveryTick = p.stateTick - s.startup - s.active
    // The first four heavy startup ticks are a feint window. Once the feet plant, the attack is a
    // promise; only a request made close enough to the authored recovery gate is retained.
    const earlyHeavyCancel = s.heavy && p.stateTick < P.attack.heavyCommitTick
    if (earlyHeavyCancel && hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
    else if (p.stateTick >= total) {
      p.state = 'free'; p.stateTick = 0
      p.bladeActionConnected = false
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer)) startDodge(world)
      else if (wantsHeavy(world, p)) beginHeavyAttack(world)
      else if (hasIntent(p, p.attackQueuedAt, P.attack.buffer)) beginAttack(world)
    }
    else if (recoveryTick >= 0) {
      if (hasIntent(p, p.dodgeQueuedAt, P.dodge.buffer) && recoveryTick >= s.dodgeCancelFrom) startDodge(world)
      // A heavy called for during a light's recovery cuts the chain short and cashes it in now. This
      // is the combo's punctuation: light, light, slam is still there, but so is light-into-slam the
      // moment you read an opening, without spending a swing you no longer want.
      else if (!s.heavy && wantsHeavy(world, p) && recoveryTick >= s.chainFrom + wp) startSwing(world, HEAVY)
      else if ((hasIntent(p, p.attackQueuedAt, P.attack.buffer) || input.attackHeld) && recoveryTick >= s.chainFrom + wp && p.swingIndex < P.attack.swings.length - 1) startSwing(world, p.swingIndex + 1)
    }
  }

  // --- movement ---
  let dx = 0, dy = 0
  if (p.dodgeTick >= 0 && p.dodgeTick < P.dodge.travel) {
    const d = P.dodge
    // Three authored beats, not one easing curve: a shove off the back foot, a flat committed
    // slide, then a hard brake so the landing has weight. `norm` is the exact sum of the weights,
    // so the roll covers `distance` to the pixel however the beats are retuned.
    const norm = d.push + (d.travel - d.brake - 1) + d.brake / 2
    const peak = d.distance / norm
    const k = p.dodgeTick - (d.travel - d.brake)
    const w = p.dodgeTick === 0 ? d.push : k < 0 ? 1 : 1 - (k + 0.5) / d.brake
    dx = p.dodgeDirX * peak * w; dy = p.dodgeDirY * peak * w
    p.vx = dx / DT; p.vy = dy / DT
  } else if (p.state === 'free') {
    const target = mlen > 0.01 ? P.maxSpeed : 0
    const tx = mlen > 0.01 ? input.moveX / mlen * target : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * target : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
    if (mlen > 0.01) {
      p.footTick++
      if (p.footTick % 14 === 0) world.emit({ type: 'footstep', x: p.x, y: p.y })
    }
  } else if (p.state === 'hurt') {
    const scale = P.hurtMoveScale
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
  } else if (p.state === 'dodge') {
    const d = P.dodge
    // Landing. The roll's cooldown, not a stumble: a steer floor so the first step is a step,
    // then the curve gives the rest of the feet back. The lock is still the price.
    const rec = p.stateTick - d.travel
    const u = (rec + 1) / (d.total - d.travel)
    const scale = Math.max(d.landMoveMin, Math.pow(u, d.landMoveExp))
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
  } else if (p.state === 'attack' && armOf(world) === ARM.bow) {
    const scale = bowMoveScale(world)
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
  } else if (p.state === 'attack') {
    const s = P.attack.swings[p.swingIndex]
    // committed through startup + active, then control bleeds back in across recovery
    const rec = p.stateTick - s.startup - s.active
    const recLen = s.recovery + (p.bladeActionConnected ? 0 : s.whiffPenalty)
    const scale = rec < 0 ? s.moveCommit : s.moveRecover + (1 - s.moveRecover) * Math.min(1, rec / recLen)
    const tx = mlen > 0.01 ? input.moveX / mlen * P.maxSpeed * scale : 0
    const ty = mlen > 0.01 ? input.moveY / mlen * P.maxSpeed * scale : 0
    steer(p, tx, ty)
    dx = p.vx * DT; dy = p.vy * DT
    const travel = swingStep(s, p.stateTick)
    dx += Math.cos(p.swingAngle) * travel; dy += Math.sin(p.swingAngle) * travel
  }
  const rolling = p.dodgeTick >= 0 && p.dodgeTick < P.dodge.travel
  const moveX0 = p.x, moveY0 = p.y
  const wall = moveWithWalls(world.arena, p, dx, dy, p.radius)
  if (rolling && (wall.hitX || wall.hitY)) {
    // A wall removes only the blocked component, so a diagonal roll keeps its authored tangent
    // slide. The velocity handed to landing must be the motion that really happened, not momentum
    // pointing invisibly into stone.
    const actualX = p.x - moveX0, actualY = p.y - moveY0
    p.vx = actualX / DT; p.vy = actualY / DT
    const intendedForward = dx * p.dodgeDirX + dy * p.dodgeDirY
    const actualForward = actualX * p.dodgeDirX + actualY * p.dodgeDirY
    const forwardRatio = intendedForward > 0 ? Math.max(0, actualForward / intendedForward) : 1
    if (forwardRatio < P.dodge.wallSlideMinForwardRatio) endDodgeTravelAtWall(world)
  }
  applyKnockback(world)

  // --- active hit window: only the arc the blade has actually swept through is live ---
  if (p.state === 'attack' && armOf(world) === ARM.blade) {
    const s = P.attack.swings[p.swingIndex]
    const k = p.stateTick - s.startup
    if (k >= 0 && k < s.active) {
      // The answer, not merely the button press, closes the perfect-dodge breath. Startup remains
      // readable and unsafe; the hostile clock returns on the first live blade tick, hit or whiff.
      if (k === 0 && p.reversalActionId === p.swingId) {
        clearBulletTime(world)
        p.reversalActionId = -1
      }
      // the live sector runs from the swing's start edge to wherever the blade has reached this tick
      const reach = swingReach(world, s)
      const spanDeg = reach.arcDeg * swingProgress(s, k)
      const mid = p.swingAngle + s.sweep * (deg(spanDeg) - deg(reach.arcDeg)) / 2
      for (const e of world.enemies) {
        if (!e.active || e.state === 'dead' || e.lastHitSwingId === p.swingId) continue
        if (arcHits(p.x, p.y, mid, reach.radius, spanDeg, e.x, e.y, e.radius)
          && hasLineOfSight(world.arena, p.x, p.y, e.x, e.y)) {
          e.lastHitSwingId = p.swingId
          const toward = Math.atan2(e.y - p.y, e.x - p.x)
          const brandBefore = e.brand
          const result = damageEnemy(world, e, reach.damage, toward, s.knockback, s.heavy, s.hitstop, p.swingId, {
            source: 'blade',
            originX: p.x, originY: p.y,
            direction: toward,
            sweep: s.sweep,
            cleave: !s.heavy && hasBoon(world, 'cleave'),
            contactDepth: Math.hypot(e.x - p.x, e.y - p.y) / Math.max(1, reach.radius),
          })
          // A shield can stamp the per-swing dedupe without granting a hit-confirm or carrying riders.
          if (result.landed) {
            p.bladeActionConnected = true
            resolveWeaponOnHit(world, e, s.heavy, brandBefore, toward, p.swingId, result)
          }
        }
      }
      for (const b of world.projectiles) {
        if (!b.active || b.team !== 0) continue
        if (arcHits(p.x, p.y, mid, reach.radius, spanDeg, b.x, b.y, b.radius)
          && hasLineOfSight(world.arena, p.x, p.y, b.x, b.y)) {
          p.bladeActionConnected = true
          // Punish the caster that owns this bolt here and now. Deferring it until the caster next
          // runs needs the news to survive as world state, which cannot represent two bolts cut on
          // one tick and goes stale when a hub return recycles projectile ids.
          punishBoltOwner(world, b.id, b.x, b.y)
          if (hasBoon(world, 'mirrorSteel')) {
            b.team = 1
            b.kind = 'mirror'
            b.actionId = p.swingId
            b.angle += Math.PI
            b.vx = -b.vx
            b.vy = -b.vy
            b.damage = tuning.boons.mirrorDamage
            b.life = Math.max(b.life, tuning.boons.mirrorLife)
          } else b.active = false
          addFreeze(world, tuning.hitstop.boltCut)
          addBulletTime(world, tuning.bullet.cutTicks, tuning.bullet.cutRate)
          world.emit({ type: 'boltCut', x: b.x, y: b.y })
        }
      }
    }
  }
  // Age the opening after transitions so all twenty advertised player-clock ticks are actionable.
  // Hit-stop never reaches updatePlayer and therefore never consumes one.
  if (p.reversalTicks > 0) p.reversalTicks--
}

// A cut bolt costs its caster: it is dragged toward the cut and opened up. Only the owner pays, and
// only while it still believes the bolt is in flight.
function punishBoltOwner(world: World, boltId: number, cx: number, cy: number): void {
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead' || e.targetX !== boltId) continue
    e.targetX = 0
    backlash(world, e, cx, cy, world.player.swingId)
    return
  }
}

function startDodge(world: World): void {
  const p = world.player
  // Cancelling a Reversal draw is a choice too; it cannot preserve the slow world for a free escape.
  if (p.state === 'attack' && p.reversalActionId === p.swingId) {
    clearBulletTime(world)
    p.reversalActionId = -1
  }
  p.state = 'dodge'; p.stateTick = 0; p.dodgeTick = 0; p.dodgeQueuedAt = -1; p.dodgeRead = 0
  // Choosing another escape relinquishes the opening earned by the previous read.
  p.reversalTicks = 0
  p.bladeActionConnected = false
  if (Math.abs(p.dodgeDirX) > 0.2) p.facing = p.dodgeDirX >= 0 ? 1 : -1   // head-first along the roll
  // the direction was latched at the press (capturePlayerInput) and is never re-read here
  world.emit({ type: 'dodge', x: p.x, y: p.y, angle: Math.atan2(p.dodgeDirY, p.dodgeDirX) })
}

function beginAttack(world: World): void {
  const p = world.player
  if (!p.armed) return
  const reversal = p.reversalTicks > 0
  if (armOf(world) === ARM.bow) startDraw(world)
  else startSwing(world, 0)
  if (reversal) spendReversal(world)
}

// The committed swing is the last entry in the chain and also its own opener, so it has one name.
const HEAVY = tuning.player.attack.swings.length - 1

function beginHeavyAttack(world: World): void {
  if (!world.player.armed || armOf(world) !== ARM.blade) return
  const reversal = world.player.reversalTicks > 0
  startSwing(world, HEAVY)
  if (reversal) spendReversal(world)
}

function spendReversal(world: World): void {
  const p = world.player
  p.reversalTicks = 0
  p.reversalActionId = p.swingId
  // The dodge created the breath; the follow-up belongs to the player. The live blade/loosed
  // arrow closes it, so startup remains a legible setup rather than a hidden fixed combo script.
  world.emit({
    type: 'reversal', x: p.x, y: p.y, angle: p.swingAngle, actionId: p.swingId,
    weapon: armOf(world) === ARM.bow ? 'bow' : 'blade',
  })
}

// The bow has no second weight, and a heavy request there would silently become a draw. Consume
// nothing and let the request expire rather than surprising the player with the wrong action.
function wantsHeavy(world: World, p: Player): boolean {
  return armOf(world) === ARM.blade && hasIntent(p, p.heavyQueuedAt, tuning.player.attack.buffer)
}

function startSwing(world: World, index: number): void {
  const p = world.player
  // Any swing consumes both requests: the one that launched it, and the one it declined. Leaving the
  // loser queued is how a game grows phantom inputs a second later.
  p.state = 'attack'; p.stateTick = 0; p.attackQueuedAt = -1; p.heavyQueuedAt = -1
  p.swingIndex = index
  p.bladeActionConnected = false
  p.swingAngle = p.aimAngle
  p.swingId = ++world.swingCounter
  p.facing = Math.cos(p.swingAngle) >= 0 ? 1 : -1
  const s = tuning.player.attack.swings[index]
  // A swing thrown out of a roll is the dash attack: same blade, different sentence. Latched HERE,
  // at the press, rather than re-derived per active tick from the roll clock — that clock dies at
  // dodge.total (20) and the heavy's startup is 12 from an earliest cancel of 8, so a heavy out of
  // a roll never has a live clock to read by the time its blade is out. Sampling it per tick also
  // made a late light flicker between arcs mid-swing, in the sim and in the drawn crescent alike.
  p.swingFromRoll = p.dodgeTick >= 0
  const dash = p.dodgeTick >= 0 && p.dodgeTick < tuning.player.dodge.travel
  world.emit({ type: 'swing', x: p.x, y: p.y, angle: p.swingAngle, swing: index, heavy: s.heavy, dash })
}

function endDodgeTravelAtWall(world: World): void {
  const p = world.player
  const d = tuning.player.dodge
  // Preserve an overlaid attack's independent clock. A plain roll jumps onto the same authored
  // landing timeline it would have reached after full travel; either way its safety ends now.
  p.dodgeTick = d.travel
  if (p.state === 'dodge') p.stateTick = Math.max(p.stateTick, d.travel)
  const angle = Math.atan2(p.dodgeDirY, p.dodgeDirX)
  world.emit({ type: 'dodgeWall', x: p.x, y: p.y, angle })
  world.emit({ type: 'dodgeEnd', x: p.x, y: p.y })
}

function aimAssist(world: World, angle: number): number {
  const p = world.player
  const P = tuning.player
  const maxRange = armOf(world) === ARM.bow ? P.aimAssistRangeBow : P.aimAssistRangeBlade
  const cone = deg(P.aimAssistDeg)
  const hysteresis = deg(P.aimAssistHysteresisDeg)
  let best = angle, bestScore = Infinity, bestId = 0
  for (const e of world.enemies) {
    if (!e.active || e.state === 'dead') continue
    const distance = Math.hypot(e.x - p.x, e.y - p.y)
    if (distance > maxRange || !hasLineOfSight(world.arena, p.x, p.y, e.x, e.y)) continue
    const a = Math.atan2(e.y - p.y, e.x - p.x)
    const d = Math.abs(angleDiff(angle, a))
    if (d > cone) continue
    // Angle owns intent; distance only resolves near-ties. The retained target gets an eight-degree
    // advantage, enough to stop cluster chatter but never enough to pull against a deliberate turn.
    const score = d + distance / maxRange * deg(5) - (e.id === p.assistTargetId ? hysteresis : 0)
    if (score < bestScore) { bestScore = score; best = a; bestId = e.id }
  }
  p.assistTargetId = bestId
  return best
}

function applyKnockback(world: World): void {
  const p = world.player
  if (p.kbx === 0 && p.kby === 0) return
  moveWithWalls(world.arena, p, p.kbx * DT, p.kby * DT, p.radius)
  const decay = 1 - 1 / tuning.knockbackDecayTicks
  p.kbx *= decay; p.kby *= decay
  if (Math.abs(p.kbx) < 1 && Math.abs(p.kby) < 1) { p.kbx = 0; p.kby = 0 }
}

type IntentKey = 'attackQueuedAt' | 'heavyQueuedAt' | 'dodgeQueuedAt'

function hasIntent(p: Player, at: number, maxAge: number): boolean {
  return at >= 0 && p.controlTick - at <= maxAge
}

function expireIntent(p: Player, key: IntentKey, maxAge: number): void {
  if (p[key] >= 0 && p.controlTick - p[key] > maxAge) p[key] = -1
}

// Steering is vector-based, so a diagonal does not accelerate sqrt(2) times faster than a cardinal.
// Input direction owns one axis: velocity along it accelerates/reverses, while sideways momentum is
// shed on the braking clock. The result is crisp 90-degree cuts without making analog arcs feel fake.
function steer(p: Player, tx: number, ty: number): void {
  const P = tuning.player
  const targetMag = len(tx, ty)
  if (targetMag < 0.001) {
    const speed = len(p.vx, p.vy)
    if (speed < 0.001) { p.vx = 0; p.vy = 0; return }
    const next = Math.max(0, speed - P.maxSpeed / P.decelTicks)
    p.vx *= next / speed; p.vy *= next / speed
    return
  }

  const nx = tx / targetMag, ny = ty / targetMag
  const along = p.vx * nx + p.vy * ny
  const sideX = p.vx - nx * along, sideY = p.vy - ny * along
  const sideMag = len(sideX, sideY)
  const sideNext = Math.max(0, sideMag - P.maxSpeed / P.decelTicks)
  const sideScale = sideMag > 0.001 ? sideNext / sideMag : 0
  const alongRate = P.maxSpeed / (along < 0 ? P.turnTicks : P.accelTicks)
  const nextAlong = approach(along, targetMag, alongRate)
  p.vx = nx * nextAlong + sideX * sideScale
  p.vy = ny * nextAlong + sideY * sideScale
}

function approach(v: number, target: number, rate: number): number {
  if (v < target) return Math.min(target, v + rate)
  if (v > target) return Math.max(target, v - rate)
  return v
}
