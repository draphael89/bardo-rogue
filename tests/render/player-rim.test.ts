import { Container, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import type { Atlas } from '@/render/atlas'
import type { Sheet } from '@/render/sheet'
import { createPlayerView, updatePlayerRim } from '@/render/views/player'

const heroSheet = (roll = false): Sheet => ({
  def: {
    id: roll ? 'roll' : 'hero', version: 1, kind: 'character', cell: 16, cols: 1, rows: 1,
    palette: 'test', maxColors: 2, frames: { idle: { i: 0, pivot: [8, 16] } },
    clips: roll
      ? { roll: { frames: ['idle', 'idle', 'idle', 'idle'], timing: 'ticks', ticks: [1, 1, 1, 1] } }
      : {
          run: { frames: ['idle'], timing: 'ticks', ticks: [1] },
          dodge: { frames: ['idle'], timing: 'sim', sim: { ref: 'player.dodge' } },
          light1: { frames: ['idle'], timing: 'sim', sim: { ref: 'player.attack' } },
          light2: { frames: ['idle'], timing: 'sim', sim: { ref: 'player.attack' } },
          heavy: { frames: ['idle'], timing: 'sim', sim: { ref: 'player.attack' } },
        },
  },
  has: () => true,
  names: () => [],
  frame: () => { throw new Error('unused') },
})

const atlas = {
  tile: () => Texture.EMPTY,
  white: () => Texture.EMPTY,
  particle: () => Texture.EMPTY,
  sheet: (id: string) => heroSheet(id.endsWith('_roll')),
} as unknown as Atlas

describe('player rim ownership', () => {
  it('updates and destroys only the four rim sprites owned by each player view', () => {
    const entities = new Container(), shadows = new Container()
    const first = createPlayerView(atlas, { entities, shadows })
    const second = createPlayerView(atlas, { entities, shadows })
    first.body.position.set(20, 30)
    second.body.position.set(80, 90)

    expect(() => updatePlayerRim(first, true, 0xffffff)).not.toThrow()
    expect(() => updatePlayerRim(second, true, 0xffffff)).not.toThrow()
    expect(entities.children).toHaveLength(12)

    first.destroy()
    expect(entities.children).toHaveLength(6)
    second.destroy()
    expect(entities.children).toHaveLength(0)
  })
})
