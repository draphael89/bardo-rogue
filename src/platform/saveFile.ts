// Loading and recovery, one layer above the adapters. Pure apart from the Date the caller hands in:
// no window, no navigator, no localStorage, so this file imports cleanly in vitest's node environment.
// The document itself -- shape, validation, migrations -- belongs to @/sim/save.
import { parseSave, serializeSave, type BardoSave } from '@/sim/save'
import type { SaveRead, SaveStore } from './index'

export interface LoadedSave {
  save: BardoSave
  raw?: string          // the bytes as read, kept only when this build must not rewrite them
  // False when the source must remain untouched: a newer schema, unreadable storage, or corrupt
  // bytes that could not be preserved before recovery.
  writable: boolean
  source: 'save' | 'backup' | 'default' | 'unreadable' | 'damaged'
  preservationFailed?: true
}

// A read that threw is NOT a read that found nothing: an EACCES, an EIO or a half-mounted volume
// must never look like a fresh player, or the next autosave overwrites a healthy file.
async function safeRead(read: (id: string) => Promise<SaveRead>, profileId: string): Promise<{
  raw: string | null
  failed: boolean
  corrupt: boolean
  preserved: boolean
}> {
  try {
    const result = await read(profileId)
    return typeof result === 'object' && result !== null
      ? { raw: null, failed: false, corrupt: true, preserved: result.preserved }
      : { raw: result, failed: false, corrupt: false, preserved: true }
  } catch { return { raw: null, failed: true, corrupt: false, preserved: false } }
}

// Recovery order: the save, then the backup, then defaults. A host whose storage predates the
// envelope supplies a migrated document through its adapter's read fallback.
export async function loadSave(
  store: SaveStore,
  profileId: string,
  opts: { preferredReducedEffects?: boolean; repair?: boolean } = {},
): Promise<LoadedSave> {
  const parseOpts = { profileId, preferredReducedEffects: !!opts.preferredReducedEffects }

  const live = await safeRead(store.read.bind(store), profileId)
  const current = parseSave(live.raw, parseOpts)
  if (current.kind === 'ok' || current.kind === 'migrated') return { save: current.save, writable: true, source: 'save' }
  if (current.kind === 'future') return { save: current.save, writable: false, source: 'save', raw: current.raw }

  // The live copy gave us nothing usable. It may be damaged (the browser hands back the bad bytes;
  // the desktop store has already moved the file aside), or simply absent. Either way the backup is
  // the next place to look.
  const spare = await safeRead(store.readBackup.bind(store), profileId)
  const backup = parseSave(spare.raw, parseOpts)
  const preservationFailed = (live.corrupt && !live.preserved) || (spare.corrupt && !spare.preserved)
  if (backup.kind === 'ok' || backup.kind === 'migrated') {
    // Write the recovered document straight back. On the browser that rotates the CORRUPT blob into
    // the backup slot -- preserving it for inspection -- and either way it puts good bytes in the
    // live slot before any gameplay write can rotate the good backup away underneath us.
    if (opts.repair !== false && !preservationFailed) {
      try { await store.write(profileId, serializeSave(backup.save)) } catch { /* recovered in memory regardless */ }
    }
    return {
      save: backup.save,
      writable: !preservationFailed,
      source: 'backup',
      ...(preservationFailed ? { preservationFailed: true as const } : {}),
    }
  }
  if (backup.kind === 'future') return { save: backup.save, writable: false, source: 'backup', raw: backup.raw }

  // Nothing usable anywhere. Three cases, told apart because they deserve different treatment:
  // a read that FAILED means the profile may be fine on a disk we cannot see -- never write over it;
  // bytes that read fine but parse as damage mean progress EXISTED -- start fresh, but say so and
  // leave the damaged bytes preserved (the desktop store moved them aside; the web write commits the
  // live slot first and rotates them into the backup); and genuinely nothing at all is a new player.
  if (live.failed || spare.failed) return { save: current.save, writable: false, source: 'unreadable' }
  if (live.corrupt || spare.corrupt || current.kind === 'corrupt' || backup.kind === 'corrupt') {
    return {
      save: current.save,
      writable: !preservationFailed,
      source: 'damaged',
      ...(preservationFailed ? { preservationFailed: true as const } : {}),
    }
  }
  return { save: current.save, writable: true, source: 'default' }
}

// Sortable, collision-free in a downloads folder, .json so any text editor opens it. The Date comes
// from the caller because this module stays free of ambient clocks.
export function saveFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `bardo-rogue-save-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}
