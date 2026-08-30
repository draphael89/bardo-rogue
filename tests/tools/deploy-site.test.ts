import { describe, expect, it } from 'vitest'
import { assertProductionCheckout, deploySite } from '../../tools/deploy-site'

describe('production site deploy preflight', () => {
  it('accepts only a clean checkout at the fetched origin/main commit', () => {
    expect(() => assertProductionCheckout({ status: '', head: 'abc\n', originMain: 'abc\n' })).not.toThrow()
  })

  it('rejects tracked or untracked changes', () => {
    expect(() => assertProductionCheckout({
      status: '?? local-notes.txt\n',
      head: 'abc',
      originMain: 'abc',
    })).toThrow(/uncommitted or untracked/)
  })

  it('rejects a checkout that is not the fetched origin main', () => {
    expect(() => assertProductionCheckout({ status: '', head: 'old', originMain: 'new' })).toThrow(/not origin\/main/)
  })

  it('revalidates origin main after building and before uploading', () => {
    let fetches = 0
    let deployed = false
    const run = (command: string, args: string[]): string | void => {
      if (command === 'git' && args[0] === 'fetch') { fetches++; return }
      if (command === 'git' && args[0] === 'status') return ''
      if (command === 'git' && args[0] === 'rev-parse') return args[1] === 'HEAD' ? 'old' : fetches === 1 ? 'old' : 'new'
      if (command === 'pnpm' && args.includes('wrangler')) deployed = true
    }
    expect(() => deploySite(run)).toThrow(/not origin\/main/)
    expect(fetches).toBe(2)
    expect(deployed).toBe(false)
  })
})
