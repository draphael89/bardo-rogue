import type { World } from '@/sim/world'
import type { InputFrame } from '@/sim/input'
import { tuning } from '@/tuning'
import { hashWorld } from '@/sim/hash'
import { Metrics } from '@/sim/metrics'
import { makeBot, type BotName } from '@/sim/bots'
import type { Loop } from '@/loop'

// window.__game: what an agent (or Playwright) uses to drive and inspect the live game.
export interface GameApi {
  world: World
  tuning: typeof tuning
  metrics: Metrics
  loop: Loop
  reset(seed?: number, scenario?: string, opts?: { god?: boolean }): void
  step(n?: number): void
  setInput(frame: Partial<InputFrame> | null): void
  bot(name: BotName | null): void
  pause(p?: boolean): boolean
  hash(): number
  state(): unknown
  frameStats(): unknown
  mute(m?: boolean): boolean
  debug(v?: boolean): boolean
}

export function installApi(host: {
  getWorld(): World
  reset(seed?: number, scenario?: string, opts?: { god?: boolean }): void
  tick(): void
  setOverride(f: InputFrame | null): void
  setBot(b: ((w: World) => InputFrame) | null): void
  loop: Loop
  metrics: Metrics
  mute(m?: boolean): boolean
  debug(v?: boolean): boolean
}): GameApi {
  const api: GameApi = {
    get world() { return host.getWorld() },
    tuning,
    metrics: host.metrics,
    loop: host.loop,
    reset: (seed, scenario, opts) => host.reset(seed, scenario, opts),
    step: (n = 1) => { for (let i = 0; i < n; i++) host.tick() },
    setInput: f => host.setOverride(f ? { moveX: 0, moveY: 0, aimX: 1, aimY: 0, aimSoft: false, attack: false, dodge: false, restart: false, ...f } : null),
    bot: name => host.setBot(name ? makeBot(name) : null),
    pause: p => { host.loop.paused = p ?? !host.loop.paused; return host.loop.paused },
    hash: () => hashWorld(host.getWorld()),
    state: () => {
      const w = host.getWorld()
      return {
        tick: w.tick, freeze: w.freeze, wave: { ...w.wave },
        player: { x: +w.player.x.toFixed(1), y: +w.player.y.toFixed(1), hp: w.player.hp, state: w.player.state, stateTick: w.player.stateTick, iframes: w.player.iframes },
        enemies: w.enemies.filter(e => e.active).map(e => ({ id: e.id, kind: e.kind, x: +e.x.toFixed(1), y: +e.y.toFixed(1), hp: e.hp, state: e.state, stateTick: e.stateTick })),
        bolts: w.projectiles.filter(b => b.active).length,
        metrics: host.metrics.summary(),
      }
    },
    frameStats: () => host.loop.stats(),
    mute: m => host.mute(m),
    debug: v => host.debug(v),
  }
  ;(window as unknown as { __game: GameApi }).__game = api
  return api
}
