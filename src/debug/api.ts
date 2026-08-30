import type { World } from '@/sim/world'
import type { InputFrame } from '@/sim/input'
import { tuning } from '@/tuning'
import { hashWorld } from '@/sim/hash'
import { Metrics } from '@/sim/metrics'
import { makeBot, type BotName } from '@/sim/bots'
import type { Replay, EncodedReplay } from '@/sim/replay'
import type { Loop } from '@/loop'
import { seedFx } from '@/render/fxRng'
import { activeBoons } from '@/sim/boons'
import { ARM, armOf } from '@/sim/weapons'
import { enterRoomById } from '@/sim/rooms'
import { prepareWeapon, startRun } from '@/sim/session'

// window.__game: what an agent (or Playwright) uses to drive and inspect the live game.
export interface GameApi {
  world: World
  tuning: typeof tuning
  metrics: Metrics
  loop: Loop
  presenter: unknown
  reset(seed?: number, scenario?: string, opts?: { god?: boolean }): void
  step(n?: number): void
  setInput(frame: Partial<InputFrame> | null): void
  bot(name: BotName | null): void
  pause(p?: boolean): boolean
  /** Player-facing pause (the card). Distinct from `pause`, which is the debug hold. */
  shellPause(p?: boolean): boolean
  /** Give the attempt back and wake in the Bardo. No-op without an active run. */
  abandon(): boolean
  hash(): number
  state(): unknown
  frameStats(): unknown
  fxSeed(n: number): void
  title(show?: boolean): boolean
  mute(m?: boolean): boolean
  debug(v?: boolean): boolean
  record(on?: boolean): boolean
  stopRecord(): Replay | null
  download(name?: string): void
  replay(r: Replay | EncodedReplay): void
  inspectSave(): unknown
  gotoRoom(id: string, opts?: { skipRite?: boolean }): boolean
  giveRemembrances(n: number): number
}

export function installApi(host: {
  getWorld(): World
  reset(seed?: number, scenario?: string, opts?: { god?: boolean }): void
  tick(): void
  setOverride(f: InputFrame | null): void
  setBot(b: ((w: World) => InputFrame) | null): void
  pause(p?: boolean): boolean
  shellPause(p?: boolean): boolean
  abandon(): boolean
  loop: Loop
  presenter: unknown
  metrics: Metrics
  mute(m?: boolean): boolean
  debug(v?: boolean): boolean
  title(show?: boolean): boolean
  record(on?: boolean): boolean
  stopRecord(): Replay | null
  download(name?: string): void
  replay(r: Replay | EncodedReplay): void
  inspectSave(): unknown
}): GameApi {
  const api: GameApi = {
    get world() { return host.getWorld() },
    tuning,
    // live getter: reset() swaps the Metrics instance, and a stale one silently mis-measures
    get metrics() { return host.metrics },
    loop: host.loop,
    presenter: host.presenter,
    reset: (seed, scenario, opts) => host.reset(seed, scenario, opts),
    step: (n = 1) => {
      if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('step count must be a non-negative safe integer')
      for (let i = 0; i < n; i++) host.tick()
    },
    setInput: f => host.setOverride(f ? { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, attackHeld: false, heavy: false, dodge: false, restart: false, ...f } : null),
    bot: name => host.setBot(name ? makeBot(name) : null),
    pause: p => host.pause(p),
    shellPause: p => host.shellPause(p),
    abandon: () => host.abandon(),
    hash: () => hashWorld(host.getWorld()),
    state: () => {
      const w = host.getWorld()
      return {
        tick: w.tick, freeze: w.freeze, wave: { ...w.wave },
        slow: { rate: w.slowRate, ticks: w.slowTicks },
        room: {
          index: w.roomIndex,
          id: w.rooms[w.roomIndex]?.id,
          name: w.roomName,
          doorOpen: w.doorOpen,
          kind: w.arena.kind,
          layout: w.rooms[w.roomIndex]?.layout,
          hasNext: w.hasNextRoom(),
          exits: w.rooms[w.roomIndex]?.exits ?? [],
          phase: w.roomPhase,
        },
        player: {
          x: +w.player.x.toFixed(1), y: +w.player.y.toFixed(1), hp: w.player.hp, maxHp: w.player.maxHp,
          state: w.player.state, stateTick: w.player.stateTick, dodgeTick: w.player.dodgeTick,
          iframes: w.player.iframes, assistTargetId: w.player.assistTargetId,
          arm: armOf(w) === ARM.bow ? 'bow' : 'blade', armed: w.player.armed,
        },
        returns: w.returns,
        session: {
          preparedWeapon: w.session.preparedWeapon,
          remembrances: w.session.meta.remembrances,
          lastBanked: w.session.lastBanked,
          meta: { ...w.session.meta },
          run: w.session.run ? {
            seed: w.session.run.seed,
            hp: w.session.run.hp,
            maxHp: w.session.run.maxHp,
            depth: w.session.run.depth,
            roomId: w.session.run.roomId,
            history: w.session.run.roomHistory.map(v => v.id),
            result: w.session.run.result,
            contract: w.session.run.contract,
            clearedRoomIds: [...w.session.run.clearedRoomIds],
            boons: w.session.run.boons.map(b => b.id),
            killedBy: w.session.run.killedBy,
            killedRanged: w.session.run.killedRanged,
            obols: w.session.run.obols,
            rerolls: w.session.run.rerolls,
            shop: w.session.run.pendingShop ? { ...w.session.run.pendingShop } : null,
            mystery: w.session.run.pendingMystery ? { ...w.session.run.pendingMystery } : null,
            hunt: w.session.run.mysteryHunt,
            reward: w.session.run.pendingReward ? { ...w.session.run.pendingReward } : null,
            rite: w.session.run.pendingRite ? { ...w.session.run.pendingRite } : null,
            riteAnswer: w.session.run.riteAnswer,
            riteBoonOwed: w.session.run.riteBoonOwed,
            riteDebt: w.session.run.riteDebt,
          } : null,
        },
        rack: w.arena.rack ? { ...w.arena.rack, taken: !!w.arena.rackTaken } : null,
        offering: w.arena.offering
          ? { kind: w.arena.offering.kind, x: +w.arena.offering.x.toFixed(1), y: +w.arena.offering.y.toFixed(1), taken: !!w.arena.offeringTaken }
          : null,
        boons: activeBoons(w),
        enemies: w.enemies.filter(e => e.active).map(e => ({ id: e.id, kind: e.kind, x: +e.x.toFixed(1), y: +e.y.toFixed(1), hp: e.hp, state: e.state, stateTick: e.stateTick, phase: e.phase, hunt: e.hunt, debt: e.debt })),
        bolts: w.projectiles.filter(b => b.active).length,
        metrics: host.metrics.summary(),
      }
    },
    frameStats: () => host.loop.stats(),
    // force the presentation PRNG (particles, flicker, damage-number jitter) so a capture is reproducible
    fxSeed: n => seedFx(n),
    title: show => host.title(show),
    mute: m => host.mute(m),
    debug: v => host.debug(v),
    record: on => host.record(on),
    stopRecord: () => host.stopRecord(),
    download: name => host.download(name),
    replay: r => host.replay(r),
    inspectSave: () => host.inspectSave(),
    giveRemembrances: n => {
      const meta = host.getWorld().session.meta
      if (!Number.isSafeInteger(n)) throw new RangeError('remembrance change must be a safe integer')
      const next = meta.remembrances + n
      if (!Number.isSafeInteger(next)) throw new RangeError('remembrance total must remain a safe integer')
      meta.remembrances = Math.max(0, next)
      return meta.remembrances
    },
    gotoRoom: (id, opts) => {
      const w = host.getWorld()
      if (w.scenario === 'loop' && !w.session.run) {
        prepareWeapon(w, 'blade')
        if (!startRun(w, id)) return false
      }
      if (opts?.skipRite && w.session.run && !w.session.run.riteAnswer) w.session.run.riteAnswer = 'paid'
      enterRoomById(w, id)
      return w.rooms[w.roomIndex]?.id === id
    },
  }
  ;(window as unknown as { __game: GameApi }).__game = api
  return api
}
