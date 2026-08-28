// Loading and recovery, one layer above the adapters. Pure apart from the Date the caller hands in:
// no window, no navigator, no localStorage, so this file imports cleanly in vitest's node environment.
// The document itself -- shape, validation, migrations -- belongs to @/sim/save.
import { parseSave, serializeSave, type BardoSave } from '@/sim/save'
import type { SaveStore } from './index'

export interface LoadedSave {
  save: BardoSave
  // False only for a save written by a NEWER build: it stays readable so the player still sees their
  // counters, and every write is refused so the fields this build cannot represent survive.
  writable: boolean
  source: 'save' | 'backup' | 'default'
}

// Recovery order: the save, then the backup, then defaults. (A host whose storage predates the
// envelope upgrades itself in its own adapter before the first read ever gets here.)
export async function loadSave(
  store: SaveStore,
  profileId: string,
  opts: { preferredReducedEffects?: boolean } = {},
): Promise<LoadedSave> {
  const parseOpts = { profileId, preferredReducedEffects: !!opts.preferredReducedEffects }

  const current = parseSave(await store.read(profileId), parseOpts)
  if (current.kind === 'ok' || current.kind === 'migrated') return { save: current.save, writable: true, source: 'save' }
  if (current.kind === 'future') return { save: current.save, writable: false, source: 'save' }

  if (current.kind === 'corrupt') {
    const backup = parseSave(await store.readBackup(profileId), parseOpts)
    if (backup.kind === 'ok' || backup.kind === 'migrated') {
      // Write the recovered document straight back. That rotates the CORRUPT blob into the backup
      // slot -- preserving it for inspection -- and puts good bytes in the live slot before any
      // gameplay write can rotate the good backup away underneath us.
      await store.write(profileId, serializeSave(backup.save))
      return { save: backup.save, writable: true, source: 'backup' }
    }
    if (backup.kind === 'future') return { save: backup.save, writable: false, source: 'backup' }
  }

  // Both copies unreadable and no legacy keys: hand back defaults and write NOTHING at boot, so a
  // transient read failure cannot destroy a save the player might still recover by other means.
  return { save: current.save, writable: true, source: 'default' }
}

// Sortable, collision-free in a downloads folder, .json so any text editor opens it. The Date comes
// from the caller because this module stays free of ambient clocks.
export function saveFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `bardo-rogue-save-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}
