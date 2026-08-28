import type { SimEvent } from './events'
import type { World } from './world'

export class Metrics {
  ticks = 0
  swings = 0; hitsLanded = 0; kills = 0; whiffSwings = 0
  dodges = 0; successfulDodges = 0; grazes = 0
  boltsFired = 0; boltsCut = 0
  enemyAttacks = 0; damageTaken = 0; deaths = 0
  wavesCleared = 0; clearTick = -1; deathTick = -1; returns = 0
  roomsEntered = 0; boonsChosen = 0; runEndTick = -1; runDurationTicks = -1; runResult: 'won' | 'lost' | null = null
  private swingHit = new Map<number, boolean>()
  private lastSwingId = 0

  consume(world: World, events: readonly SimEvent[]): void {
    this.ticks = world.tick
    for (const ev of events) {
      switch (ev.type) {
        case 'swing': this.swings++; this.lastSwingId = world.player.swingId; this.swingHit.set(this.lastSwingId, false); break
        case 'hit': this.hitsLanded++; this.swingHit.set(ev.actionId, true); break
        case 'kill': this.kills++; break
        case 'dodge': this.dodges++; break
        case 'dodged': this.successfulDodges++; break
        case 'graze': this.grazes++; break
        case 'boltFired': this.boltsFired++; break
        case 'arrowLoose': this.boltsFired++; break
        case 'boltCut': this.boltsCut++; break
        case 'enemyAttack': this.enemyAttacks++; break
        case 'playerHurt': this.damageTaken++; break
        case 'playerDeath': this.deaths++; this.deathTick = world.tick; break
        case 'waveClear': this.wavesCleared++; break
        case 'roomClear': this.clearTick = world.tick; break
        case 'roomEnter': this.roomsEntered++; break
        case 'boonChosen': this.boonsChosen++; break
        case 'runWon': this.runEndTick = world.tick; this.runDurationTicks = ev.ticks; this.runResult = 'won'; break
        case 'runLost': this.runEndTick = world.tick; this.runDurationTicks = ev.ticks; this.runResult = 'lost'; break
        case 'returned': this.returns++; break
      }
    }
  }

  summary() {
    let whiffs = 0
    for (const hit of this.swingHit.values()) if (!hit) whiffs++
    return {
      ticks: this.ticks, seconds: +(this.ticks / 60).toFixed(1),
      swings: this.swings, hitsLanded: this.hitsLanded, whiffSwings: whiffs, kills: this.kills,
      dodges: this.dodges, successfulDodges: this.successfulDodges, grazes: this.grazes,
      boltsFired: this.boltsFired, boltsCut: this.boltsCut,
      enemyAttacks: this.enemyAttacks, damageTaken: this.damageTaken, deaths: this.deaths,
      wavesCleared: this.wavesCleared, returns: this.returns,
      roomsEntered: this.roomsEntered, boonsChosen: this.boonsChosen, runResult: this.runResult,
      runSeconds: this.runDurationTicks >= 0 ? +(this.runDurationTicks / 60).toFixed(1) : null,
      clearSeconds: this.clearTick >= 0 ? +(this.clearTick / 60).toFixed(1) : null,
      deathSeconds: this.deathTick >= 0 ? +(this.deathTick / 60).toFixed(1) : null,
    }
  }
}
