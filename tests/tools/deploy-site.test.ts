import { describe, expect, it } from 'vitest'
import { assertProductionCheckout } from '../../tools/deploy-site'

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
})
