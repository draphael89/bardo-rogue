// One rule about who may be whitened on a hit, and a guard against the copy that drifted.
//
// The Brute and the Oath-Bound share one authored sheet (the Oath-Bound is the same drawing under a
// bronze cast), and that sheet carries its own recoil pose. Replacing it with a flat white
// silhouette for the contact ticks deletes the pose it was drawn for. views/enemies.ts had the rule
// right; render/presenter.ts ran a second setFlash a few lines later that listed only the brute, and
// because it ran last it won — so the elite lost its metal on every hit it took.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { EntityView } from '../../src/render/views/shared'

describe('the authored-hit-reaction rule', () => {
  it('covers every kind drawn from the authored brute sheet', () => {
    expect(EntityView.authoredHitReaction('brute')).toBe(true)
    expect(EntityView.authoredHitReaction('oathbound')).toBe(true)
  })
  it('leaves the puppet bodies their silhouette flash', () => {
    for (const kind of ['caster', 'charger', 'dummy', 'warden']) {
      expect(EntityView.authoredHitReaction(kind)).toBe(false)
    }
  })
  it('no caller re-spells the rule inline', () => {
    for (const file of ['src/render/presenter.ts', 'src/render/views/enemies.ts']) {
      const src = readFileSync(file, 'utf8')
      for (const line of src.split('\n')) {
        if (!line.includes('setFlash(')) continue
        if (!/kind\s*[!=]==?\s*'(brute|oathbound)'/.test(line)) continue
        expect.unreachable(`${file}: setFlash spells the authored-body rule inline — call EntityView.authoredHitReaction instead:\n${line.trim()}`)
      }
    }
  })
})
