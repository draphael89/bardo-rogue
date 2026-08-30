import { describe, expect, it } from 'vitest'
import { PROP, T, TILE, buildArena, type Arena } from '@/sim/arena'
import { dressArena } from '@/sim/dress'
import { arenaKind, type LayoutId } from '@/sim/layouts'
import { Rng } from '@/sim/rng'

function dressed(layout: LayoutId): Arena {
  const arena = buildArena(new Rng(1), arenaKind(layout))
  const solid = Uint8Array.from(arena.solid)
  dressArena(arena, layout)
  expect(arena.solid, `${layout} must not write collision`).toEqual(solid)
  return arena
}

function overlayKeys(a: Arena): string {
  const out: string[] = []
  for (let i = 0; i < a.overlay.length; i++) {
    if (a.overlay[i] >= 0) out.push(`${i}:${a.overlay[i]}`)
  }
  return out.join(',')
}

describe('first-gate dress', () => {
  it('keeps threshold solids across Acheron, Asphodel, Cocytus, Phlegethon, Styx, Antechamber, the oath court, and Minos', () => {
    const acheron = dressed('threshold')
    const asphodel = dressed('asphodel')
    const cocytus = dressed('cocytus')
    const phlegethon = dressed('phlegethon')
    const styx = dressed('styx')
    const antechamber = dressed('antechamber')
    const oathCourt = dressed('oath-court')
    const minos = dressed('minos')
    const minosEast = dressed('minos-east')
    expect(asphodel.solid).toEqual(acheron.solid)
    expect(cocytus.solid).toEqual(acheron.solid)
    expect(phlegethon.solid).toEqual(acheron.solid)
    expect(styx.solid).toEqual(acheron.solid)
    expect(antechamber.solid).toEqual(acheron.solid)
    expect(oathCourt.solid).toEqual(acheron.solid)
    expect(minos.solid).toEqual(acheron.solid)
    expect(minosEast.solid).toEqual(acheron.solid)
    expect(overlayKeys(asphodel)).not.toBe(overlayKeys(acheron))
    expect(overlayKeys(cocytus)).not.toBe(overlayKeys(acheron))
    expect(overlayKeys(cocytus)).not.toBe(overlayKeys(asphodel))
    expect(overlayKeys(phlegethon)).not.toBe(overlayKeys(acheron))
    expect(overlayKeys(phlegethon)).not.toBe(overlayKeys(cocytus))
    expect(overlayKeys(phlegethon)).not.toBe(overlayKeys(asphodel))
    expect(overlayKeys(styx)).not.toBe(overlayKeys(acheron))
    expect(overlayKeys(styx)).not.toBe(overlayKeys(cocytus))
    expect(overlayKeys(styx)).not.toBe(overlayKeys(phlegethon))
    expect(overlayKeys(antechamber)).not.toBe(overlayKeys(acheron))
    expect(overlayKeys(antechamber)).not.toBe(overlayKeys(minos))
    expect(overlayKeys(oathCourt)).not.toBe(overlayKeys(antechamber))
    expect(overlayKeys(oathCourt)).not.toBe(overlayKeys(minos))
    expect(overlayKeys(minos)).not.toBe(overlayKeys(acheron))
    expect(overlayKeys(minosEast)).not.toBe(overlayKeys(minos))
    expect(overlayKeys(minosEast)).not.toBe(overlayKeys(acheron))
    // Acheron meets the player as an actual shore: one silt lip, then a two-tile water body.
    // These are overlays only; the shared-solid assertions above prove the river does not become
    // invisible collision or steal the lower fight lane.
    expect(acheron.overlay[11 * acheron.cols + 13]).toBe(T.silt)
    expect(acheron.overlay[12 * acheron.cols + 13]).toBe(T.water)
    expect(acheron.overlay[13 * acheron.cols + 13]).toBe(T.water)
    const cocytusWeep = cocytus.windows.find(light => light.x === 2.5 * TILE && light.y === 8 * TILE)
    expect(cocytusWeep).toMatchObject({ radius: 72, strength: 0.82, tint: 0x8aa0b8 })
    expect(cocytus.overlay[6 * cocytus.cols + 3]).toBe(T.water)
    expect(cocytus.overlay[8 * cocytus.cols + 4]).toBe(T.grate)
    expect(cocytus.overlay[8 * cocytus.cols + 13]).toBeLessThan(0) // cold edge, dry fight circle
    expect(acheron.props.some(p => p.tile === PROP.reed)).toBe(true)
    expect(styx.props.some(p => p.tile === PROP.reed)).toBe(false)
    expect(styx.props.some(p => p.tile === PROP.shard)).toBe(true)
    expect(antechamber.props.some(p => p.tile === PROP.shard)).toBe(true)
    expect(oathCourt.props.some(p => p.tile === PROP.shard)).toBe(true)
    expect(antechamber.overlay.includes(T.poppy)).toBe(false)
    expect(oathCourt.overlay.includes(T.poppy)).toBe(false)
    expect(asphodel.overlay.includes(T.poppy)).toBe(true)
    expect(minos.overlay.includes(T.poppy)).toBe(true)
    expect(minosEast.overlay.includes(T.poppy)).toBe(true)
    expect(minos.overlay.filter(t => t === T.verdict)).toHaveLength(5)
    expect(minosEast.overlay.filter(t => t === T.verdict)).toHaveLength(5)
    expect(minos.props.some(p => p.tile === PROP.verdictStele)).toBe(true)
    expect(minosEast.props.some(p => p.tile === PROP.verdictStele)).toBe(true)
    expect(minos.props.filter(p => p.tile === PROP.pan)).toHaveLength(2)
    expect(minosEast.props.filter(p => p.tile === PROP.pan)).toHaveLength(2)
    expect(minos.overlay[8 * minos.cols + 13]).toBeLessThan(0)
    expect(minosEast.overlay[8 * minosEast.cols + 13]).toBeLessThan(0)
  })

  it('keeps crossing solids across Lethe and Landing', () => {
    const plain = dressed('crossing')
    const lethe = dressed('lethe')
    const landing = dressed('landing')
    expect(lethe.solid).toEqual(plain.solid)
    expect(landing.solid).toEqual(plain.solid)
    expect(overlayKeys(lethe)).not.toBe(overlayKeys(plain))
    expect(landing.props.some(p => p.tile === PROP.prow)).toBe(true)
    expect(landing.props.some(p => p.tile === PROP.pole)).toBe(true)
  })

  it('leaves the Bardo and the shore undressed', () => {
    const bardo = buildArena(new Rng(1), 'bardo')
    const before = overlayKeys(bardo)
    const n = bardo.props.length
    expect(bardo.props.some(p => p.sheet === 'prop' && p.tile === PROP.veteranRelic)).toBe(true)
    expect(bardo.props.some(p => p.sheet === 'prop' && p.tile === PROP.ossuary)).toBe(false)
    dressArena(bardo, 'bardo')
    expect(overlayKeys(bardo)).toBe(before)
    expect(bardo.props.length).toBe(n)
  })
})
