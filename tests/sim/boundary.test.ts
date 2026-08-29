import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The sim's isolation is what makes the pinned replay hashes meaningful, so it is asserted rather
// than trusted. Two rules:
//   1. nothing stepWorld can reach imports the save layer -- src/sim/save.ts is a pure document
//      module that no sim code calls, which is why editing it can never move a hash;
//   2. src/sim/ never reaches for a host: no DOM, no storage, no clock, no randomness.
const SRC = fileURLToPath(new URL('../../src', import.meta.url))
const SIM = join(SRC, 'sim')
// tuning.ts is imported by most of the sim and is just as reachable from stepWorld, so the rule has
// to cover it too -- otherwise a host API could enter the sim's reach through the one file the test
// was not looking at.
const TUNING = join(SRC, 'tuning.ts')

function simFiles(dir = SIM): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? simFiles(p) : p.endsWith('.ts') ? [p] : []
  })
}

const files = [...simFiles(), TUNING].map(path => ({ path, rel: path.slice(SRC.length + 1), src: readFileSync(path, 'utf8') }))

describe('sim boundary', () => {
  it('finds the sim modules', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('no sim module imports the save document layer', () => {
    // save.ts is IN src/sim (it is pure TypeScript and belongs with the schemas it validates) but is
    // deliberately unreachable from stepWorld. If this ever fails, a hash change becomes possible
    // from a save edit, and CLAUDE.md's record-bots rule starts applying to this file.
    const offenders = files
      .filter(f => f.rel !== 'sim/save.ts')
      .filter(f => /from\s+['"](?:\.{1,2}\/save|@\/sim\/save)['"]/.test(f.src))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('no sim module touches a host API', () => {
    const BANNED = [
      [/\bdocument\./, 'document'],
      [/\bwindow\./, 'window'],
      [/\blocalStorage\b/, 'localStorage'],
      [/\bnavigator\./, 'navigator'],
      [/\bMath\.random\b/, 'Math.random'],
      [/\bnew Date\b|\bDate\.now\b/, 'Date'],
      [/\bperformance\.now\b/, 'performance.now'],
      [/from\s+['"]pixi\.js['"]/, 'pixi.js'],
    ] as const
    const offenders: string[] = []
    for (const f of files) {
      // Comments in this repo explain these very rules ("never Math.random"), so they are stripped
      // before matching -- block comments, whole-line comments, AND trailing ones. The negative
      // lookbehind keeps a `://` inside a URL or string from being mistaken for a comment.
      const code = f.src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(l => l.replace(/(?<!:)\/\/.*$/, ''))
        .filter(l => l.trim().length > 0)
        .join('\n')
      for (const [re, what] of BANNED) if (re.test(code)) offenders.push(`${f.rel}: ${what}`)
    }
    expect(offenders).toEqual([])
  })
})
