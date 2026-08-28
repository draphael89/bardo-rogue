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
  hash(): number
  state(): unknown
  frameStats(): unknown
  fxSeed(n: number): void
  mute(m?: boolean): boolean
  debug(v?: boolean): boolean
  record(on?: boolean): boolean
  stopRecord(): Replay
  download(name?: string): void
  replay(r: Replay | EncodedReplay): void
}

export function installApi(host: {
  getWorld(): World
  reset(seed?: number, scenario?: string, opts?: { god?: boolean }): void
  tick(): void
  setOverride(f: InputFrame | null): void
  setBot(b: ((w: World) => InputFrame) | null): void
  loop: Loop
  presenter: unknown
  metrics: Metrics
  mute(m?: boolean): boolean
  debug(v?: boolean): boolean
  record(on?: boolean): boolean
  stopRecord(): Replay
  download(name?: string): void
  replay(r: Replay | EncodedReplay): void
}): GameApi {
  const api: GameApi = {
    get world() { return host.getWorld() },
    tuning,
    // live getter: reset() swaps the Metrics instance, and a stale one silently mis-measures
    get metrics() { return host.metrics },
    loop: host.loop,
    presenter: host.presenter,
    reset: (seed, scenario, opts) => host.reset(seed, scenario, opts),
    step: (n = 1) => { for (let i = 0; i < n; i++) host.tick() },
    setInput: f => host.setOverride(f ? { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, attackHeld: false, dodge: false, restart: false, ...f } : null),
    bot: name => host.setBot(name ? makeBot(name) : null),
    pause: p => { host.loop.paused = p ?? !host.loop.paused; return host.loop.paused },
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
          hasNext: w.hasNextRoom(),
          exits: w.rooms[w.roomIndex]?.exits ?? [],
        },
        player: {
          x: +w.player.x.toFixed(1), y: +w.player.y.toFixed(1), hp: w.player.hp, maxHp: w.player.maxHp,
          state: w.player.state, stateTick: w.player.stateTick, dodgeTick: w.player.dodgeTick,
          iframes: w.player.iframes, assistTargetId: w.player.assistTargetId,
          arm: armOf(w) === ARM.bow ? 'bow' : 'blade',
        },
        returns: w.returns,
        offering: w.arena.offering
          ? { kind: w.arena.offering.kind, x: +w.arena.offering.x.toFixed(1), y: +w.arena.offering.y.toFixed(1), taken: !!w.arena.offeringTaken }
          : null,
        boons: activeBoons(w),
        enemies: w.enemies.filter(e => e.active).map(e => ({ id: e.id, kind: e.kind, x: +e.x.toFixed(1), y: +e.y.toFixed(1), hp: e.hp, state: e.state, stateTick: e.stateTick, phase: e.phase })),
        bolts: w.projectiles.filter(b => b.active).length,
        metrics: host.metrics.summary(),
      }
    },
    frameStats: () => host.loop.stats(),
    // force the presentation PRNG (particles, flicker, damage-number jitter) so a capture is reproducible
    fxSeed: n => seedFx(n),
    mute: m => host.mute(m),
    debug: v => host.debug(v),
    record: on => host.record(on),
    stopRecord: () => host.stopRecord(),
    download: name => host.download(name),
    replay: r => host.replay(r),
  }
  ;(window as unknown as { __game: GameApi }).__game = api
  return api
}
