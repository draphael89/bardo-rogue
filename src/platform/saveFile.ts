// Loading and recovery, one layer above the adapters. Pure apart from the Date the caller hands in:
// no window, no navigator, no localStorage, so this file imports cleanly in vitest's node environment.
// The document itself -- shape, validation, migrations -- belongs to @/sim/save.
import { parseSave, serializeSave, type BardoSave } from '@/sim/save'
import type { SaveStore } from './index'

export interface LoadedSave {
  save: BardoSave
  raw?: string          // the bytes as read, kept only when this build must not rewrite them
  // False only for a save written by a NEWER build: it stays readable so the player still sees their
  // counters, and every write is refused so the fields this build cannot represent survive.
  writable: boolean
  source: 'save' | 'backup' | 'default' | 'unreadable'
}

// A read that threw is NOT a read that found nothing: an EACCES, an EIO or a half-mounted volume
// must never look like a fresh player, or the next autosave overwrites a healthy file.
async function safeRead(read: (id: string) => Promise<string | null>, profileId: string): Promise<{ raw: string | null; failed: boolean }> {
  try { return { raw: await read(profileId), failed: false } } catch { return { raw: null, failed: true } }
}

// Recovery order: the save, then the backup, then defaults. (A host whose storage predates the
// envelope upgrades itself in its own adapter before the first read ever gets here.)
export async function loadSave(
  store: SaveStore,
  profileId: string,
  opts: { preferredReducedEffects?: boolean } = {},
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
  if (backup.kind === 'ok' || backup.kind === 'migrated') {
    // Write the recovered document straight back. On the browser that rotates the CORRUPT blob into
    // the backup slot -- preserving it for inspection -- and either way it puts good bytes in the
    // live slot before any gameplay write can rotate the good backup away underneath us.
    try { await store.write(profileId, serializeSave(backup.save)) } catch { /* recovered in memory regardless */ }
    return { save: backup.save, writable: true, source: 'backup' }
  }
  if (backup.kind === 'future') return { save: backup.save, writable: false, source: 'backup', raw: backup.raw }

  // Nothing readable anywhere. If either read actually FAILED, this profile is not writable: we hand
  // back defaults so the player can still play, and refuse to write over data we could not see.
  const readsFailed = live.failed || spare.failed
  return { save: current.save, writable: !readsFailed, source: readsFailed ? 'unreadable' : 'default' }
}

// Sortable, collision-free in a downloads folder, .json so any text editor opens it. The Date comes
// from the caller because this module stays free of ambient clocks.
export function saveFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `bardo-rogue-save-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}
