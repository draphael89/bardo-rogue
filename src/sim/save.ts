// The canonical save document. Pure and I/O-free BY CONTRACT: this module never learns where the
// bytes come from or go -- taking a StorageLike parameter here would be the bug. `src/platform/`
// owns the adapters; this file owns the shape, the validation and the migrations.
//
// Nothing in the sim imports this file, so stepWorld can never reach it and no change here can move
// a pinned replay hash.
//
// Two rules that protect real players' progress:
//   - a save from a NEWER build is readable but never writable (see parseSave -> kind 'future');
//     overwriting it with the fields this build understands would silently destroy the rest.
//   - the two pre-envelope browser keys are read (see migrateLegacySave) and never deleted, so
//     a rollback to an older build still finds a player's attempts and victories where it left them.
import { parseCheckpoint, normalizeCheckpoint, type RunCheckpoint } from './checkpoint'
import { defaultMetaState, type MetaStateV2 } from './session'
import { ARM, type ArmId } from './weapons'
import { defaultSettings, normalizeSettings, type SettingsStateV2 } from './storage'

export type { RunCheckpoint }

// Bumped only when the ENVELOPE shape changes; every bump adds one UPGRADES entry and one fixture.
// 1 is the synthetic shape the two legacy keys deserialize into, so the legacy import and every
// future upgrade run through the same chain.
// 3 carries TWO changes that landed together: RunCheckpoint stopped being `never` and became a real
// node-resume payload, and settings grew volume sliders (V2). One version for both on purpose — two
// builds each stamping 3 for a different document is the one failure the version number exists to
// prevent, because neither would see the other as 'future' and both would happily overwrite it.
// 4 promotes the two one-shot Smith responses into durable meta (V2), so a reload cannot erase a
// choice the player has already earned or replay a response the Smith has already consumed.
export const SAVE_SCHEMA_VERSION = 4

// Diagnostic only: which build wrote this file. Hand-maintained against package.json's version --
// stamping it from the build would drag Vite into src/sim for a string that never gates a load.
export const CONTENT_REVISION = '0.1.0'

export const DEFAULT_PROFILE_ID = 'default'

const MAX_COUNTER = 1_000_000_000
// profileId becomes a filename in the desktop adapter, so it is constrained here, at the source.
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

// Node-boundary resume. A damaged checkpoint is dropped; it must never take the profile with it.

export interface BardoSave {
  schemaVersion: number
  contentRevision: string
  profileId: string
  revision: number
  settings: SettingsStateV2
  meta: MetaStateV2
  checkpoint: RunCheckpoint | null
}

export type SaveCorruption = 'not-json' | 'not-object' | 'bad-schema-version' | 'no-migration' | 'bad-meta' | 'bad-settings' | 'missing-meta' | 'missing-settings'

export interface ParseSaveOptions {
  profileId?: string                 // always wins over whatever the file claims
  preferredReducedEffects?: boolean  // the OS preference, used only when the file has no setting
}

// `writable` is on every variant so the store layer has one uniform check before it writes.
export type SaveParse =
  | { kind: 'ok'; save: BardoSave; writable: true; contentRevisionChanged: boolean }
  | { kind: 'migrated'; save: BardoSave; writable: true; contentRevisionChanged: boolean; from: number }
  | { kind: 'empty'; save: BardoSave; writable: true }
  | { kind: 'corrupt'; save: BardoSave; writable: true; reason: SaveCorruption; raw: string }
  | { kind: 'future'; save: BardoSave; writable: false; schemaVersion: number; raw: string }

export type MigrateResult =
  | { kind: 'ok'; save: BardoSave; from: number }
  | { kind: 'future'; schemaVersion: number }
  | { kind: 'corrupt'; reason: SaveCorruption }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// JSON yields Infinity for 1e999 and strings are never coerced, matching loadMeta's guard.
function count(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_COUNTER, Math.max(0, Math.floor(v))) : fallback
}
function revisionOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(v))) : 0
}
function contentRevisionOf(v: unknown): string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : CONTENT_REVISION
}
function profileIdOf(want: string | undefined): string {
  return typeof want === 'string' && PROFILE_ID_RE.test(want) ? want : DEFAULT_PROFILE_ID
}
const isArmId = (v: unknown): v is ArmId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ARM, v)

function jsonObject(raw: string | null | undefined): Obj | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try { const v: unknown = JSON.parse(raw); return isObj(v) ? v : null } catch { return null }
}

// Field-level clamping only; shape-level failure is the caller's call. Mirrors storage.ts loadMeta.
function validateMeta(input: unknown): MetaStateV2 {
  const v = isObj(input) ? input : {}
  const unlockedWeapons: ArmId[] = ['blade']            // makeSessionState() requires the blade present
  const seen = new Set<ArmId>(unlockedWeapons)
  if (Array.isArray(v.unlockedWeapons)) {
    for (const id of v.unlockedWeapons) if (isArmId(id) && !seen.has(id)) { seen.add(id); unlockedWeapons.push(id) }
  }
  return {
    version: 2,
    attempts: count(v.attempts),
    victories: count(v.victories),
    remembrances: count(v.remembrances),
    rerollUnlocked: v.rerollUnlocked === true,
    vesselUnlocked: v.vesselUnlocked === true,
    unlockedWeapons,
    pendingSmithUnburied: v.pendingSmithUnburied === true,
    pendingSmithContract: v.pendingSmithContract === 'cut' || v.pendingSmithContract === 'commit'
      ? v.pendingSmithContract
      : null,
  }
}
// storage.ts owns the shape and the clamping; this file owns only the envelope around it.
function validateSettings(input: unknown, preferred: boolean): SettingsStateV2 {
  return normalizeSettings(isObj(input) ? input : {}, preferred)
}

// The one place the envelope's key order is written. Fields are enumerated rather than spread so a
// hostile "__proto__" or an unknown key from JSON.parse can never ride along into the document.
// The checkpoint parameter is load-bearing: a 5-arg envelope that hardcodes null compiles fine and
// silently erases a live checkpoint on the next serialize or revision bump.
function envelope(
  profileId: string,
  revision: number,
  contentRevision: string,
  settings: SettingsStateV2,
  meta: MetaStateV2,
  checkpoint: RunCheckpoint | null = null,
): BardoSave {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION, contentRevision, profileId, revision, settings, meta,
    checkpoint: checkpoint ? normalizeCheckpoint(checkpoint) : null,
  }
}

export function defaultSave(opts: ParseSaveOptions = {}): BardoSave {
  return envelope(profileIdOf(opts.profileId), 0, CONTENT_REVISION,
    defaultSettings(!!opts.preferredReducedEffects), defaultMetaState())
}

// Canonical bytes. Re-normalises on the way out, so serializeSave(parseSave(s).save) is stable and
// byte-identical in Node, in the browser and in the desktop adapter. Does not bump the revision.
export function serializeSave(save: BardoSave): string {
  return JSON.stringify(envelope(
    profileIdOf(save.profileId), revisionOf(save.revision), contentRevisionOf(save.contentRevision),
    validateSettings(save.settings, false), validateMeta(save.meta), parseCheckpoint(save.checkpoint)))
}

// Monotonic write counter: the field that makes a backup or a cloud conflict diagnosable.
export function bumpRevision(save: BardoSave): BardoSave {
  return envelope(profileIdOf(save.profileId), Math.min(Number.MAX_SAFE_INTEGER, revisionOf(save.revision) + 1),
    CONTENT_REVISION, validateSettings(save.settings, false), validateMeta(save.meta), parseCheckpoint(save.checkpoint))
}

// key = the version being upgraded FROM.
const UPGRADES: Record<number, (prev: Obj) => Obj> = {
  1: prev => ({ ...prev, schemaVersion: 2, revision: 0, contentRevision: CONTENT_REVISION, checkpoint: null }),
  // Both halves of 3 are field-level: normalizeSettings defaults the new sliders and parseCheckpoint
  // defaults a missing checkpoint, so the step only advances the version and carries the payload.
  2: prev => ({ ...prev, schemaVersion: 3 }),
  3: prev => ({
    ...prev,
    schemaVersion: 4,
    meta: {
      ...(isObj(prev.meta) ? prev.meta : {}),
      version: 2,
      pendingSmithUnburied: isObj(prev.meta) && prev.meta.version === 2 && prev.meta.pendingSmithUnburied === true,
      pendingSmithContract: isObj(prev.meta) && prev.meta.version === 2
        && (prev.meta.pendingSmithContract === 'cut' || prev.meta.pendingSmithContract === 'commit')
        ? prev.meta.pendingSmithContract
        : null,
    },
  }),
}

// Takes an already-parsed value so migrations are testable with plain object fixtures.
export function migrateSave(input: unknown, opts: ParseSaveOptions = {}): MigrateResult {
  if (!isObj(input)) return { kind: 'corrupt', reason: 'not-object' }
  const sv = input.schemaVersion
  if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1) return { kind: 'corrupt', reason: 'bad-schema-version' }
  if (sv > SAVE_SCHEMA_VERSION) return { kind: 'future', schemaVersion: sv }
  // Validate the source generation before an upgrade adds defaults. Otherwise a v3 document with
  // `meta: 42` would be turned into a clean-looking V2 object and the evidence of damage erased.
  if (input.meta !== undefined && (!isObj(input.meta) || (input.meta.version !== undefined && input.meta.version !== 1 && input.meta.version !== 2))) return { kind: 'corrupt', reason: 'bad-meta' }
  if (input.settings !== undefined && (!isObj(input.settings) || (input.settings.version !== undefined && input.settings.version !== 1 && input.settings.version !== 2))) return { kind: 'corrupt', reason: 'bad-settings' }

  let obj: Obj = input
  let v = sv
  while (v < SAVE_SCHEMA_VERSION) {
    const up = UPGRADES[v]
    if (!up) return { kind: 'corrupt', reason: 'no-migration' }
    obj = up(obj)
    const next = obj.schemaVersion
    if (typeof next !== 'number' || next <= v) return { kind: 'corrupt', reason: 'no-migration' }  // an upgrade that does not advance would spin
    v = next
  }

  // Present-but-wrong-typed is damage and must not be silently zeroed into a fresh save; on a
  // MIGRATED document, absent is simply a field that version predates.
  if (obj.meta !== undefined && (!isObj(obj.meta) || (obj.meta.version !== undefined && obj.meta.version !== 1 && obj.meta.version !== 2))) return { kind: 'corrupt', reason: 'bad-meta' }
  if (obj.settings !== undefined && (!isObj(obj.settings) || (obj.settings.version !== undefined && obj.settings.version !== 1 && obj.settings.version !== 2))) return { kind: 'corrupt', reason: 'bad-settings' }
  // A document ALREADY at the current schema must carry the current payload shapes. Schema 3 exists
  // partly to require V2 settings, and schema 4 requires V2 meta, so a current envelope holding an
  // older payload is a mixed-generation or damaged
  // file, not a readable one: accepting it would parse 'ok', skip the good backup, and let the next
  // write normalize and rotate the damaged document instead of recovering from it. V1 settings are
  // legitimate only on a document still being migrated UP from schema 1 or 2.
  if (sv === SAVE_SCHEMA_VERSION && isObj(obj.settings) && obj.settings.version !== undefined
    && obj.settings.version !== 2) return { kind: 'corrupt', reason: 'bad-settings' }
  if (sv === SAVE_SCHEMA_VERSION && isObj(obj.meta) && (
    obj.meta.version !== 2
    || typeof obj.meta.pendingSmithUnburied !== 'boolean'
    || (obj.meta.pendingSmithContract !== null && obj.meta.pendingSmithContract !== 'cut' && obj.meta.pendingSmithContract !== 'commit')
  )) return { kind: 'corrupt', reason: 'bad-meta' }

  // Every ENVELOPE version (2 and up) has always carried both payloads, so a sparse one was never
  // written by us and is damage. Treating it as valid-with-defaults would be worse than corruption --
  // it would parse 'ok'/'migrated', skip the backup, and the next autosave would rotate the last good
  // generation away under a document full of zeroes. Only the synthetic v1 keeps the leniency below:
  // a v1 with no settings key is a real settings-less legacy player, not damage.
  if (sv >= 2) {
    if (input.meta === undefined) return { kind: 'corrupt', reason: 'missing-meta' }
    if (input.settings === undefined) return { kind: 'corrupt', reason: 'missing-settings' }
  } else if (input.meta === undefined && input.settings === undefined) {
    // A pre-current document may legitimately lack ONE of the two (a settings-less legacy player),
    // but never both: migrateLegacySave only ever constructs a v1 around at least one payload, so an
    // empty {"schemaVersion":1} was never written by us -- and migrating it into all-defaults would
    // let an import of such a file wipe real progress, the same hole the check above closes for v2.
    return { kind: 'corrupt', reason: 'missing-meta' }
  }

  const meta = isObj(obj.meta) ? validateMeta(obj.meta) : defaultMetaState()
  const settings = isObj(obj.settings)
    ? validateSettings(obj.settings, !!opts.preferredReducedEffects)
    : defaultSettings(!!opts.preferredReducedEffects)
  const checkpoint = parseCheckpoint(obj.checkpoint)
  return { kind: 'ok', from: sv, save: envelope(profileIdOf(opts.profileId), revisionOf(obj.revision), contentRevisionOf(obj.contentRevision), settings, meta, checkpoint) }
}

// A newer build's fields we do understand, so the player still sees their counters. Display only:
// the caller keeps writable false and never writes this back.
function bestEffortFuture(parsed: Obj, opts: ParseSaveOptions): BardoSave {
  const meta = isObj(parsed.meta) ? validateMeta(parsed.meta) : defaultMetaState()
  const settings = isObj(parsed.settings)
    ? validateSettings(parsed.settings, !!opts.preferredReducedEffects)
    : defaultSettings(!!opts.preferredReducedEffects)
  return envelope(profileIdOf(opts.profileId), revisionOf(parsed.revision), contentRevisionOf(parsed.contentRevision), settings, meta)
}

// Never throws. Absent storage is a fresh player ('empty'), not corruption.
export function parseSave(raw: string | null | undefined, opts: ParseSaveOptions = {}): SaveParse {
  const fallback = defaultSave(opts)
  if (typeof raw !== 'string' || raw.trim().length === 0) return { kind: 'empty', save: fallback, writable: true }

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { kind: 'corrupt', save: fallback, writable: true, reason: 'not-json', raw } }

  const r = migrateSave(parsed, opts)
  if (r.kind === 'corrupt') return { kind: 'corrupt', save: fallback, writable: true, reason: r.reason, raw }
  if (r.kind === 'future') {
    return { kind: 'future', save: isObj(parsed) ? bestEffortFuture(parsed, opts) : fallback, writable: false, schemaVersion: r.schemaVersion, raw }
  }
  const contentRevisionChanged = r.save.contentRevision !== CONTENT_REVISION
  return r.from === SAVE_SCHEMA_VERSION
    ? { kind: 'ok', save: r.save, writable: true, contentRevisionChanged }
    : { kind: 'migrated', save: r.save, writable: true, contentRevisionChanged, from: r.from }
}

// The pre-envelope import. The caller hands over the two raw legacy strings; null means there was
// nothing stored, which is how a returning player is told apart from a fresh one. Idempotent: this
// copies the old counters, it never accumulates them.
export function migrateLegacySave(metaRaw: string | null | undefined, settingsRaw: string | null | undefined, opts: ParseSaveOptions = {}): BardoSave | null {
  const meta = jsonObject(metaRaw)
  const settings = jsonObject(settingsRaw)
  if (!meta && !settings) return null
  const legacy: Obj = { schemaVersion: 1 }
  if (meta && meta.version === 1) legacy.meta = meta            // an unknown version is ignored, exactly as loadMeta does
  if (settings && settings.version === 1) legacy.settings = settings
  const r = migrateSave(legacy, opts)
  return r.kind === 'ok' ? r.save : defaultSave(opts)
}
