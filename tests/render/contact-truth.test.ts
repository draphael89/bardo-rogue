import { describe, expect, it } from 'vitest'
import { ActionFeedbackGate } from '@/render/feedback'
import { contactClassForHit, contactKillKey, enemyReactionTransform, grazeFeedbackGeometry, impactStampForHit, recognizedContactKills } from '@/render/contact'
import { createWorld } from '@/sim/scenarios'
import { emptyInput } from '@/sim/input'
import { stepWorld } from '@/sim/step'
import { grantBoon, resolveWeaponOnHit, triggerPerfectDodge } from '@/sim/boons'
import { updateProjectiles } from '@/sim/projectiles'
import { backlash } from '@/sim/enemies/caster'
import { tuning } from '@/tuning'

describe('immutable contact provenance', () => {
  it.each(['arrow', 'mirror', 'echo'] as const)('keeps a delayed %s impact local and source-appropriate', kind => {
    const world = createWorld(2, 'empty')
    const target = world.spawnEnemy('dummy', world.player.x + 40, world.player.y)!
    const originX = target.x - target.radius - 3
    const projectile = world.fireProjectile(originX, target.y, 0, 60, 3, 20, 1, 1, 73, kind)!

    updateProjectiles(world)
    const hit = world.events.find(event => event.type === 'hit')
    expect(hit?.type).toBe('hit')
    if (!hit || hit.type !== 'hit') return

    expect(hit).toMatchObject({
      source: kind,
      actionId: 73,
      originX,
      originY: target.y,
      direction: 0,
      sweep: 0,
      cleave: false,
    })
    expect(projectile.x).toBeGreaterThan(hit.originX)

    const before = impactStampForHit(hit)
    world.player.x += 100
    world.player.y -= 50
    world.player.swingIndex = tuning.player.attack.swings.length - 1
    expect(impactStampForHit(hit)).toEqual(before)
    expect(before.cx).toBe(originX)
    expect(before.source).toBe(kind)
    expect(before.contactClass).toBe('pierce')
  })

  it('snapshots a cleaving blade origin and sweep at the contact tick', () => {
    const world = createWorld(3, 'empty')
    const p = world.player
    world.spawnEnemy('dummy', p.x + 18, p.y)
    grantBoon(world, 'cleave')

    for (let tick = 0; tick < 12 && !world.events.some(event => event.type === 'hit'); tick++) {
      stepWorld(world, { ...emptyInput(), attack: tick === 0, aimX: 1, aimY: 0 })
    }
    const hit = world.events.find(event => event.type === 'hit')
    expect(hit?.type).toBe('hit')
    if (!hit || hit.type !== 'hit') return

    expect(hit.source).toBe('blade')
    expect(hit.sweep).toBe(tuning.player.attack.swings[0].sweep)
    expect(hit.cleave).toBe(true)
    expect(hit.originX).not.toBe(hit.x)
    const stamp = impactStampForHit(hit)
    expect(stamp.source).toBe('blade')
    expect(stamp.cx).toBe(hit.originX)
    expect(stamp.cy).toBe(hit.originY)
    expect(contactClassForHit(hit)).toBe(hit.contactDepth >= tuning.juice.hit.contact.edgeFrom ? 'edge' : 'body')
  })

  it('separates guard, blade body, blade edge, pierce, and burst without changing damage', () => {
    const base = {
      type: 'hit' as const, x: 20, y: 10, angle: 0, damage: 2, attemptedDamage: 2,
      mitigatedDamage: 0, guarded: false, heavy: false, targetId: 1, kind: 'brute' as const,
      killed: false, actionId: 1, source: 'blade' as const, originX: 0, originY: 10,
      direction: 0, sweep: 1, cleave: false, contactDepth: 0.4,
    }
    expect(contactClassForHit(base)).toBe('body')
    expect(contactClassForHit({ ...base, contactDepth: 0.9 })).toBe('edge')
    expect(contactClassForHit({ ...base, guarded: true })).toBe('guard')
    expect(contactClassForHit({ ...base, source: 'arrow' })).toBe('pierce')
    expect(contactClassForHit({ ...base, source: 'judgment' })).toBe('burst')
    expect(base.damage).toBe(2)
  })

  it('keeps the floor wake on the threat lane while moving only the air scratch off the actor', () => {
    const above = grazeFeedbackGeometry({ type: 'graze', x: 100, y: 100, nearX: 100, nearY: 89, angle: 0, source: 'projectile' })
    const below = grazeFeedbackGeometry({ type: 'graze', x: 100, y: 100, nearX: 100, nearY: 111, angle: 0, source: 'projectile' })
    expect(above).toMatchObject({ wakeX: 100, wakeY: 89 })
    expect(below).toMatchObject({ wakeX: 100, wakeY: 111 })
    expect(above.scratchY).toBe(100)
    expect(below.scratchY).toBe(100)
    expect(above.scratchX).not.toBe(below.scratchX)
    expect(above.drawWake).toBe(true)
    expect(grazeFeedbackGeometry({ ...above, type: 'graze', x: 100, y: 100, nearX: 100, nearY: 89, angle: 0, source: 'radial' }).drawWake).toBe(false)
  })

  it('recognizes only the target actually killed at the blade edge', () => {
    const hit = (targetId: number, killed: boolean, contactDepth: number) => ({
      type: 'hit' as const, x: targetId * 10, y: 10, angle: 0, damage: 2, attemptedDamage: 2,
      mitigatedDamage: 0, guarded: false, heavy: false, targetId, kind: 'brute' as const,
      killed, actionId: 44, source: 'blade' as const, originX: 0, originY: 10,
      direction: 0, sweep: 1, cleave: false, contactDepth,
    })
    const bodyKill = hit(1, true, 0.4)
    const edgeHit = hit(2, false, 0.9)
    const edgeKill = hit(3, true, 0.9)
    for (const events of [[bodyKill, edgeHit, edgeKill], [edgeKill, edgeHit, bodyKill]]) {
      const recognized = recognizedContactKills(events)
      expect(recognized.has(contactKillKey(44, 1))).toBe(false)
      expect(recognized.has(contactKillKey(44, 2))).toBe(false)
      expect(recognized.has(contactKillKey(44, 3))).toBe(true)
    }
  })

  it('keeps a later edge-kill accent independent from the ordinary per-action kill gate', () => {
    const bodyFirst = new ActionFeedbackGate()
    expect(bodyFirst.takeKill(44)).toBe(true)
    expect(bodyFirst.takeAccent(44)).toBe(true)
    expect(bodyFirst.takeAccent(44)).toBe(false)

    const edgeFirst = new ActionFeedbackGate()
    expect(edgeFirst.takeAccent(44)).toBe(true)
    expect(edgeFirst.takeKill(44)).toBe(true)
    expect(edgeFirst.takeAccent(44)).toBe(false)
  })

  it('keeps body and weapon translation coherent while restraining weapon lean', () => {
    const burst = enemyReactionTransform({ ratio: 1, hitClass: 'burst', hitKind: 'caster', hitHeavy: false, hitAngle: 0.4 })
    expect(burst.lift).toBe(2)
    expect(burst.weaponLean).toBeCloseTo(burst.bodyLean * 0.6)
    expect(burst.dx).toBe(Math.round(Math.cos(0.4) * tuning.juice.hit.bodyKick * 0.92 * 1.08))
    expect(burst.dy).toBe(Math.round(Math.sin(0.4) * tuning.juice.hit.bodyKick * 0.92 * 1.08 * 0.7))

    const guard = enemyReactionTransform({ ratio: 1, hitClass: 'guard', hitKind: 'warden', hitHeavy: true, hitAngle: 0 })
    const edge = enemyReactionTransform({ ratio: 1, hitClass: 'edge', hitKind: 'warden', hitHeavy: false, hitAngle: 0 })
    expect(Math.abs(guard.bodyLean)).toBeLessThan(Math.abs(edge.bodyLean))
  })

  it('attributes Judgment and bolt backlash to their local causes, not the current swing', () => {
    const judgmentWorld = createWorld(4, 'empty')
    const marked = judgmentWorld.spawnEnemy('dummy', 180, 100)!
    judgmentWorld.spawnEnemy('brute', 196, 100)
    grantBoon(judgmentWorld, 'finalJudgment')
    marked.brand = 2
    resolveWeaponOnHit(judgmentWorld, marked, true, 2, 0, 81)
    const judgments = judgmentWorld.events.filter(event => event.type === 'hit')
    expect(judgments.length).toBeGreaterThanOrEqual(2)
    expect(judgments.every(event => event.type === 'hit' && event.source === 'judgment' && event.actionId === 81 && event.originX === 180 && event.originY === 100 && !event.cleave)).toBe(true)

    const backlashWorld = createWorld(5, 'empty')
    const caster = backlashWorld.spawnEnemy('caster', 220, 100)!
    backlash(backlashWorld, caster, 180, 120, 91)
    const backlashHit = backlashWorld.events.find(event => event.type === 'hit')
    expect(backlashHit?.type === 'hit' && backlashHit).toMatchObject({
      source: 'backlash', actionId: 91, originX: 180, originY: 120, sweep: 0, cleave: false,
    })
  })
})

describe('delayed action feedback identity', () => {
  it('admits two distinct perfect-dodge echoes but groups every target from one action', () => {
    const world = createWorld(6, 'empty')
    grantBoon(world, 'afterimage')

    world.tick = 40
    triggerPerfectDodge(world)
    const first = world.projectiles.find(projectile => projectile.active && projectile.kind === 'echo')!.actionId
    world.tick = 86
    triggerPerfectDodge(world)
    const ids = world.projectiles.filter(projectile => projectile.active && projectile.kind === 'echo').map(projectile => projectile.actionId)
    const second = ids.find(id => id !== first)!

    expect(first).toBeLessThan(-1)
    expect(second).toBeLessThan(-1)
    expect(second).not.toBe(first)

    const gate = new ActionFeedbackGate()
    expect(gate.takeHit(first)).toBe(true)
    expect(gate.takeHit(first)).toBe(false) // a second target from the same action stays local-only
    expect(gate.takeHit(second)).toBe(true)
    expect(gate.takeHit(first)).toBe(false) // interleaving cannot make an old action loud again
  })
})
