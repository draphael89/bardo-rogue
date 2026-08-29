import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * A permanent debit and the checkpoint carrying what it bought are one transaction.
 *
 * The Unburied's memory option is the game's only mid-run change to permanent meta: it spends
 * Remembrances for max HP that lives in the run. The checkpoint beside it was captured at the
 * room's ENTRY and knows nothing about the purchase, so writing the debit on its own charged the
 * player for a vessel the next reload took back. `metaDebtPending` holds the meta write until one
 * that also stores a checkpoint.
 *
 * That latch has exactly two lowering edges and both are load-bearing. Losing the second one --
 * a reset, which discards the run without emitting any terminal event -- strands the latch with no
 * room arrival left to clear it, and the NEXT thing to change meta (the Smith's reroll, bought and
 * confirmed on screen back in the Bardo) is silently dropped from the envelope.
 *
 * These are source assertions rather than behavioural ones. The rule lives in a closure inside
 * boot(), which needs a live Pixi context, a platform adapter and a save file to construct, so
 * nothing in it is reachable from a unit test. The failure mode this guards is the real one: a
 * later edit deleting an edge, not the arithmetic being wrong.
 */
const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the mid-run debit and its checkpoint are one transaction', () => {
  it('raises the latch only on a mid-run permanent spend', () => {
    expect(main).toMatch(/if \(!terminal && world\.events\.some\(ev => ev\.type === 'mysteryChosen'\)\) metaDebtPending = true/)
  })

  it('lowers it when a write also stores a checkpoint', () => {
    expect(main).toMatch(/const writesCheckpoint = terminal \|\| \(arrived && !fromResume\)/)
    expect(main).toMatch(/if \(writesCheckpoint\) metaDebtPending = false/)
  })

  it('lowers it again when a reset discards the run, and rolls the spend back with it', () => {
    // Without this edge the latch outlives the run that raised it. reset() emits no terminal event,
    // so nothing else would ever lower it, and every later meta write would be dropped until the
    // next descent reached its first room.
    expect(main).toMatch(/const rolledBack = metaDebtPending && !suppliedMeta/)
    expect(main).toMatch(/rolledBack \? savedSave\.meta :/)
    const resetBody = main.slice(main.indexOf('const reset = ('), main.indexOf('const reset = (') + 1400)
    expect(resetBody).toMatch(/metaDebtPending = false/)
  })

  it('omits meta from the envelope only while the latch is raised', () => {
    expect(main).toMatch(/\.\.\.\(metaDebtPending \? \{\} : \{ meta: \{/)
  })

  it('keeps the latch to exactly the two lowering edges it is documented to have', () => {
    // A third one added without thought is how the transaction stops being a transaction.
    const lowers = main.match(/(?<!let )metaDebtPending = false/g) ?? []   // not the declaration
    expect(lowers).toHaveLength(2)
  })
})
