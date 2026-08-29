import { describe, expect, it } from 'vitest'
import {
  CONTENT_REVISION, DEFAULT_PROFILE_ID, SAVE_SCHEMA_VERSION,
  bumpRevision, defaultSave, migrateLegacySave, migrateSave, parseSave, serializeSave,
  type SaveCorruption,
} from '@/sim/save'
import { defaultMetaState } from '@/sim/session'

const LEGACY_META = JSON.stringify({ version: 1, attempts: 9, victories: 2, unlockedWeapons: ['blade'] })
const LEGACY_SETTINGS = JSON.stringify({ version: 1, reducedEffects: true })

// The canonical bytes, in the exact key order serializeSave emits. This string is the cross-host
// contract: the browser adapter and the desktop adapter must both read and write exactly this.
const CANONICAL = '{"schemaVersion":3,"contentRevision":"0.1.0","profileId":"default","revision":4,'
  + '"settings":{"version":1,"reducedEffects":true,"music":1,"sfx":1},'
  + '"meta":{"version":1,"attempts":9,"victories":2,"remembrances":0,"rerollUnlocked":false,"vesselUnlocked":false,"unlockedWeapons":["blade"]},"checkpoint":null}'

describe('save envelope', () => {
  it('starts a fresh profile at revision 0 with the current schema and content revision', () => {
    expect(defaultSave()).toEqual({
      schemaVersion: SAVE_SCHEMA_VERSION, contentRevision: CONTENT_REVISION, profileId: DEFAULT_PROFILE_ID,
      revision: 0, settings: { version: 1, reducedEffects: false, music: 1, sfx: 1 }, meta: defaultMetaState(), checkpoint: null,
    })
  })

  it('seeds reduced effects from the system preference', () => {
    expect(defaultSave({ preferredReducedEffects: true }).settings.reducedEffects).toBe(true)
  })

  it('advances the revision monotonically and stamps the current build', () => {
    const next = bumpRevision(parseSave(CANONICAL).save)
    expect(next.revision).toBe(5)
    expect(next.contentRevision).toBe(CONTENT_REVISION)
  })

  it('round-trips the canonical bytes without changing one', () => {
    const r = parseSave(CANONICAL)
    expect(r.kind).toBe('ok')
    expect(r.writable).toBe(true)
    expect(r.save.meta.attempts).toBe(9)
    expect(serializeSave(r.save)).toBe(CANONICAL)
  })
})

describe('parseSave', () => {
  it.each([[null], [undefined], [''], ['   ']])('treats %s as a fresh profile, not corruption', raw => {
    const r = parseSave(raw)
    expect(r.kind).toBe('empty')
    expect(r.save).toEqual(defaultSave())
  })

  const CORRUPT: Array<[string, string, SaveCorruption]> = [
    ['corrupt JSON', '{broken', 'not-json'],
    ['truncated JSON', CANONICAL.slice(0, 40), 'not-json'],
    ['a JSON scalar', '5', 'not-object'],
    ['JSON null', 'null', 'not-object'],
    ['a JSON array', '[]', 'not-object'],
    ['an empty object', '{}', 'bad-schema-version'],
    ['a string schemaVersion', '{"schemaVersion":"2"}', 'bad-schema-version'],
    ['a fractional schemaVersion', '{"schemaVersion":1.5}', 'bad-schema-version'],
    ['a wrong-typed meta', '{"schemaVersion":3,"meta":42}', 'bad-meta'],
    ['an unknown meta version', '{"schemaVersion":3,"meta":{"version":99,"attempts":50}}', 'bad-meta'],
    ['a wrong-typed settings', '{"schemaVersion":3,"settings":true}', 'bad-settings'],
  ]
  it.each(CORRUPT)('reports %s as corrupt and keeps the bytes for the store to preserve', (_label, raw, reason) => {
    const r = parseSave(raw)
    expect(r.kind).toBe('corrupt')
    if (r.kind !== 'corrupt') return
    expect(r.reason).toBe(reason)
    expect(r.raw).toBe(raw)
    expect(r.writable).toBe(true)
    expect(r.save).toEqual(defaultSave())    // never a half-read save
  })

  it('refuses a sparse current-schema document rather than reading it as defaults', () => {
    // Every current envelope this build ever wrote carries all seven fields, so a bare
    // `{"schemaVersion":3}` was never written by us.
    const bare = parseSave('{"schemaVersion":3}')
    expect(bare.kind).toBe('corrupt')
    if (bare.kind === 'corrupt') expect(bare.reason).toBe('missing-meta')
    const metaOnly = parseSave('{"schemaVersion":3,"meta":{"version":1,"attempts":3}}')
    expect(metaOnly.kind).toBe('corrupt')
    if (metaOnly.kind === 'corrupt') expect(metaOnly.reason).toBe('missing-settings')
  })

  it('refuses a pre-current document that carries neither payload', () => {
    // {"schemaVersion":1} was never written by anything: migrateLegacySave always builds a v1 around
    // at least one payload. Migrating it into all-defaults would let importing such a file wipe real
    // progress -- the same hole the current-schema check closes for v2.
    const r = parseSave('{"schemaVersion":1}')
    expect(r.kind).toBe('corrupt')
    if (r.kind === 'corrupt') expect(r.reason).toBe('missing-meta')
  })

  it('still fills fields a MIGRATED document legitimately predates', () => {
    // A v1 doc with no settings key is a real settings-less legacy player, not damage.
    const r = migrateSave({ schemaVersion: 1, meta: { version: 1, attempts: 3, victories: 0, unlockedWeapons: ['blade'] } })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.save.settings).toEqual({ version: 1, reducedEffects: false, music: 1, sfx: 1 })
  })

  it('clamps garbage counters the way loadMeta does', () => {
    const r = parseSave('{"schemaVersion":2,"settings":{"version":1,"reducedEffects":false},"meta":{"version":1,"attempts":-5,"victories":1.9,"unlockedWeapons":"blade"}}')
    expect(r.save.meta).toEqual({ version: 1, attempts: 0, victories: 1, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] })
  })

  it('drops a counter that JSON parsed to Infinity, exactly as loadMeta does', () => {
    // 1e999 parses to Infinity, which is not a finite count: storage.ts has always fallen back to 0
    // for this rather than inventing a number, and the envelope keeps that behaviour.
    expect(parseSave('{"schemaVersion":2,"settings":{"version":1,"reducedEffects":false},"meta":{"version":1,"attempts":1e999}}').save.meta.attempts).toBe(0)
  })

  it('clamps a finite but absurd counter to the ceiling', () => {
    expect(parseSave('{"schemaVersion":2,"settings":{"version":1,"reducedEffects":false},"meta":{"version":1,"attempts":1e12}}').save.meta.attempts).toBe(1_000_000_000)
  })

  it('drops unknown weapon ids, keeps the blade first, and de-duplicates', () => {
    const r = parseSave('{"schemaVersion":2,"settings":{"version":1,"reducedEffects":false},"meta":{"version":1,"unlockedWeapons":["bow","ghost","bow","blade"]}}')
    expect(r.save.meta.unlockedWeapons).toEqual(['blade', 'bow'])
  })

  it('keeps a newer build’s save readable and refuses to overwrite it', () => {
    const future = '{"schemaVersion":99,"contentRevision":"9.9","profileId":"default","revision":12,'
      + '"settings":{"version":1,"reducedEffects":true},'
      + '"meta":{"version":1,"attempts":40,"victories":9,"unlockedWeapons":["blade"]},"checkpoint":{"hp":3}}'
    const r = parseSave(future)
    expect(r.kind).toBe('future')
    if (r.kind !== 'future') return
    expect(r.writable).toBe(false)
    expect(r.schemaVersion).toBe(99)
    expect(r.raw).toBe(future)
    expect(r.save.meta.attempts).toBe(40)    // best effort: the player still sees their counters
  })

  it('reports a content-revision change without blocking the load', () => {
    const r = parseSave(CANONICAL.replace('"0.1.0"', '"0.0.1"'))
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.contentRevisionChanged).toBe(true)
    expect(r.save.meta.attempts).toBe(9)
  })

  it('forces the requested profile id over whatever the file claims', () => {
    const r = parseSave(CANONICAL.replace('"default"', '"../../etc/passwd"'))
    expect(r.save.profileId).toBe(DEFAULT_PROFILE_ID)
  })

  it('never lets an injected __proto__ key ride along into the document', () => {
    const r = parseSave('{"schemaVersion":3,"__proto__":{"polluted":true},"settings":{"version":1,"reducedEffects":false},"meta":{"version":1,"attempts":3}}')
    expect(Object.keys(r.save)).toEqual(['schemaVersion', 'contentRevision', 'profileId', 'revision', 'settings', 'meta', 'checkpoint'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('migrateSave', () => {
  it('reports a version with no upgrade path as corrupt rather than guessing', () => {
    // schemaVersion 0 is below the floor; a gap in UPGRADES would surface the same way.
    expect(migrateSave({ schemaVersion: 0 })).toEqual({ kind: 'corrupt', reason: 'bad-schema-version' })
  })

  it('upgrades the synthetic v1 shape to the current schema', () => {
    const r = migrateSave({ schemaVersion: 1, meta: { version: 1, attempts: 3, victories: 1, unlockedWeapons: ['blade'] } })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.from).toBe(1)
    expect(r.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    expect(r.save.meta.attempts).toBe(3)
    expect(r.save.checkpoint).toBeNull()
  })

  it('upgrades a v2 envelope and keeps a null checkpoint', () => {
    const r = migrateSave({
      schemaVersion: 2, contentRevision: '0.1.0', profileId: 'default', revision: 4,
      settings: { version: 1, reducedEffects: true },
      meta: { version: 1, attempts: 9, victories: 2, unlockedWeapons: ['blade'] },
      checkpoint: null,
    })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.from).toBe(2)
    expect(r.save.schemaVersion).toBe(3)
    expect(r.save.meta.attempts).toBe(9)
    expect(r.save.checkpoint).toBeNull()
  })
})

describe('legacy key migration', () => {
  it('carries attempts, victories and settings out of the two old keys', () => {
    const s = migrateLegacySave(LEGACY_META, LEGACY_SETTINGS)
    expect(s).not.toBeNull()
    expect(s?.meta).toEqual({ version: 1, attempts: 9, victories: 2, remembrances: 0, rerollUnlocked: false, vesselUnlocked: false, unlockedWeapons: ['blade'] })
    expect(s?.settings.reducedEffects).toBe(true)
    expect(s?.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    expect(s?.revision).toBe(0)
  })

  it('returns null when there is nothing to import', () => {
    expect(migrateLegacySave(null, null)).toBeNull()
  })

  it('imports the key that is there when the other is missing', () => {
    expect(migrateLegacySave(LEGACY_META, null)?.meta.attempts).toBe(9)
    const settingsOnly = migrateLegacySave(null, LEGACY_SETTINGS)
    expect(settingsOnly?.settings.reducedEffects).toBe(true)
    expect(settingsOnly?.meta.attempts).toBe(0)
  })

  it('ignores a corrupt legacy key instead of losing the intact one', () => {
    const s = migrateLegacySave('{broken', LEGACY_SETTINGS)
    expect(s?.settings.reducedEffects).toBe(true)
    expect(s?.meta.attempts).toBe(0)
  })

  it('ignores a legacy key written by an unknown version', () => {
    expect(migrateLegacySave('{"version":2,"attempts":50}', null)?.meta.attempts).toBe(0)
  })

  it('is idempotent — importing twice does not double the counters', () => {
    const once = migrateLegacySave(LEGACY_META, LEGACY_SETTINGS)
    const twice = migrateLegacySave(LEGACY_META, LEGACY_SETTINGS)
    expect(twice).toEqual(once)
    expect(twice?.meta.attempts).toBe(9)
  })

  it('produces bytes the parser reads back identically', () => {
    const s = migrateLegacySave(LEGACY_META, LEGACY_SETTINGS)
    const raw = serializeSave(s!)
    expect(parseSave(raw).save).toEqual(s)
  })
})
