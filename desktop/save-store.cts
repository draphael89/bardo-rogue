// The desktop filesystem save store. Main process only, and deliberately plain Node -- it imports
// nothing from electron and nothing from src/, so it can be reasoned about and driven without a
// window. Schema validation lives above this, in src/sim/save.ts; down here a save is bytes that
// either parse as a JSON object or do not.
//
// desktop/ may not import from src/, so PROFILE_ID_RE is a deliberate copy of the constant in
// src/sim/save.ts. If that regex ever changes, change it here in the same commit.
import { link, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { FileHandle } from 'node:fs/promises'

export const MAX_SAVE_BYTES = 1024 * 1024

const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const code = (e: unknown): string => (e as NodeJS.ErrnoException | null)?.code ?? ''

// A profileId becomes a FILENAME. The regex already rejects '', anything over 64 chars, '/', '\',
// NUL, ':' and a leading '.' or '-', so '..' and '-rf' can never appear. The rest covers what a
// character class cannot: traversal-shaped ids, names Windows silently trims, device names, and two
// ids that would be one file on a case- or Unicode-folding filesystem.
export function isValidProfileId(id: unknown): id is string {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) return false
  if (id.includes('..') || id.endsWith('.')) return false
  if (WIN_RESERVED.test(id.split('.')[0])) return false
  return id.normalize('NFC') === id
}

// '~' cannot appear in a legal profileId, so no profile can ever collide with another's derived
// files: a profile literally named 'x.bak' writes x.bak.json, which is not profile x's x~bak.json.
export function savePaths(dir: string, id: string) {
  const base = join(dir, id)
  return {
    current: `${base}.json`,
    backup: `${base}~bak.json`,
    corrupt: (n: number) => `${base}~corrupt${n ? `-${n}` : ''}.json`,
    temp: (seq: number) => `${base}~tmp-${process.pid}-${seq}.json`,
  }
}

// Defence in depth: every path is re-checked immediately before it reaches the filesystem.
function assertInside(dir: string, p: string): void {
  if (dirname(resolve(p)) !== resolve(dir)) throw new Error(`save path escapes the save directory: ${p}`)
}

type Probe = { state: 'ok'; data: string } | { state: 'missing' } | { state: 'invalid' } | { state: 'unreadable' }

async function probe(p: string): Promise<Probe> {
  let raw: string
  try { raw = await readFile(p, 'utf8') } catch (e) { return code(e) === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' } }
  if (raw.trim().length === 0) return { state: 'invalid' }
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { state: 'invalid' }
  } catch { return { state: 'invalid' } }
  return { state: 'ok', data: raw }
}

// Makes the rename itself durable. Not fatal if it fails -- the rename is still atomic; Windows
// simply cannot fsync a directory handle.
async function syncDir(d: string): Promise<void> {
  let dh: FileHandle | undefined
  try { dh = await open(d, 'r'); await dh.sync() } catch { /* best effort */ }
  finally { await dh?.close().catch(() => undefined) }
}

// Move a damaged save aside. rename(2) SILENTLY CLOBBERS an existing target, which would destroy the
// very evidence this step exists to keep, so the move is link() (fails EEXIST atomically) + unlink(),
// with a probe-then-rename fallback for filesystems without hard links. No clock is involved, so the
// resulting filename is stable enough for the smoke test to assert.
async function preserveCorrupt(current: string, corrupt: (n: number) => string): Promise<string | undefined> {
  for (let n = 0; n <= 9; n++) {
    const target = corrupt(n)
    try { await link(current, target); await unlink(current); return target } catch (e) {
      if (code(e) === 'EEXIST') continue                  // that slot already holds older evidence
      if (code(e) === 'ENOENT') return undefined          // nothing to preserve
      try { await stat(target); continue } catch { /* the slot is free; fall through to rename */ }
      try { await rename(current, target); return target } catch { return undefined }
    }
  }
  return undefined   // ten damaged copies already kept: stop, and leave this one exactly where it is
}

export interface SaveStoreOptions { verify?: boolean }   // read back and compare; on in debug and test builds
export interface ReadResult { data: string | null; preserved?: string }

export function createSaveStore(dir: string, opts: SaveStoreOptions = {}) {
  let seq = 0
  // Writes to one profile are serialised: two autosaves interleaving their rotations could leave the
  // live file and the backup holding the same generation.
  const queues = new Map<string, Promise<unknown>>()
  const serial = <T,>(id: string, job: () => Promise<T>): Promise<T> => {
    const next = (queues.get(id) ?? Promise.resolve()).then(job, job)
    queues.set(id, next.then(() => undefined, () => undefined))
    return next
  }

  async function writeNow(id: string, data: string): Promise<number> {
    const p = savePaths(dir, id); assertInside(dir, p.current)
    await mkdir(dir, { recursive: true })
    const tmp = p.temp(++seq)
    let fh: FileHandle | undefined
    try {
      fh = await open(tmp, 'wx')          // never adopt a temp file another process owns
      await fh.writeFile(data, 'utf8')
      await fh.sync()                     // the bytes are on disk BEFORE anything points at them
    } finally { await fh?.close() }
    try { await rename(p.current, p.backup) }                    // rotate; ENOENT = the first write ever
    catch (e) { if (code(e) !== 'ENOENT') { await unlink(tmp).catch(() => undefined); throw e } }
    try { await rename(tmp, p.current) }                         // atomic: same directory, same filesystem
    catch (e) { await unlink(tmp).catch(() => undefined); throw e }
    await syncDir(dir)
    if (opts.verify) {
      const back = await readFile(p.current, 'utf8')
      if (back !== data) throw new Error(`save verify failed for ${id}: wrote ${data.length} chars, read back ${back.length}`)
    }
    return Buffer.byteLength(data, 'utf8')
  }

  // Reads only the live file. A damaged one is moved aside first and reported as absent, so the
  // recovery decision stays in one place above the adapter (src/platform/saveFile.ts), identical to
  // the browser's. 'unreadable' (EACCES, EIO) is NOT corruption: a file we merely could not read is
  // never moved.
  async function readNow(id: string): Promise<ReadResult> {
    const p = savePaths(dir, id); assertInside(dir, p.current)
    const cur = await probe(p.current)
    if (cur.state === 'ok') return { data: cur.data }
    // An unreadable file is NOT an absent one. Resolving null here would look like a fresh player to
    // the layer above, which would then happily write defaults over data we simply could not read.
    if (cur.state === 'unreadable') throw new Error(`save file could not be read: ${p.current}`)
    if (cur.state === 'missing') return { data: null }
    const preserved = await preserveCorrupt(p.current, p.corrupt)
    return { data: null, ...(preserved ? { preserved } : {}) }
  }

  async function readBackupNow(id: string): Promise<string | null> {
    const p = savePaths(dir, id); assertInside(dir, p.backup)
    const bak = await probe(p.backup)
    if (bak.state === 'unreadable') throw new Error(`backup save could not be read: ${p.backup}`)
    return bak.state === 'ok' ? bak.data : null
  }

  async function deleteNow(id: string): Promise<void> {
    const p = savePaths(dir, id); assertInside(dir, p.current)
    for (const f of [p.current, p.backup]) await unlink(f).catch(e => { if (code(e) !== 'ENOENT') throw e })
    // ~corrupt files are deliberately left alone: they are the player's damaged data, not ours.
  }

  return {
    dir,
    read: (id: string) => serial(id, () => readNow(id)),
    readBackup: (id: string) => serial(id, () => readBackupNow(id)),
    write: (id: string, data: string) => serial(id, () => writeNow(id, data)),
    delete: (id: string) => serial(id, () => deleteNow(id)),
  }
}
export type FsSaveStore = ReturnType<typeof createSaveStore>
