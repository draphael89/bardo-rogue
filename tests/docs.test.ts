import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FLAG } from '@/sim/replay'

// HARNESS.md is the contract every agent reads before touching this repo, so a stale line there
// costs more than a stale comment. These tests pin the parts that are mechanically checkable.
describe('harness documentation', () => {
  const harness = readFileSync('HARNESS.md', 'utf8')

  it('documents the replay flag bits exactly as the encoder defines them', () => {
    const label: Record<keyof typeof FLAG, string> = {
      aimSoft: 'aimSoft', attack: 'attack', dodge: 'dodge', restart: 'restart',
      attackHeld: 'attackHeld', confirm: 'confirm', choiceLeft: 'choice-left', choiceRight: 'choice-right', heavy: 'heavy',
    }
    for (const [key, bit] of Object.entries(FLAG)) {
      const expected = `${bit} ${label[key as keyof typeof FLAG]}`
      expect(harness, `HARNESS.md should list "${expected}"`).toContain(expected)
    }
  })

  it('lists every input field the debug API accepts', () => {
    const setInput = harness.split('\n').find(l => l.includes('`setInput(partial | null)`'))
    expect(setInput).toBeDefined()
    for (const field of ['moveX', 'moveY', 'aimX', 'aimY', 'aimSoft', 'attack', 'attackHeld', 'heavy', 'dodge', 'restart', 'choiceDelta', 'confirm']) {
      expect(setInput, `setInput docs should mention ${field}`).toContain(field)
    }
  })

  it('documents every published script', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    // dev/build/preview/test are conventional; the rest are this project's own harness verbs and
    // an undocumented one is an agent-hours tax.
    const conventional = new Set(['dev', 'build', 'preview', 'test', 'test:watch', 'typecheck'])
    for (const name of Object.keys(pkg.scripts)) {
      if (conventional.has(name)) continue
      expect(harness, `HARNESS.md should document \`pnpm ${name}\``).toContain(`pnpm ${name}`)
    }
  })
})
