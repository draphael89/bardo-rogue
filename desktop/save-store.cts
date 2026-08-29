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
  // Size first, bytes second: our own writes are capped at MAX_SAVE_BYTES, so anything larger was
  // planted externally and must not be materialised in the main process just to find that out.
  try {
    const st = await stat(p)
    if (st.size > MAX_SAVE_BYTES) return { state: 'invalid' }
  } catch (e) { return code(e) === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' } }
  let raw: string
  try { raw = await readFile(p, 'utf8') } catch (e) { return code(e) === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' } }
  if (raw.trim().length === 0) return { state: 'invalid' }
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { state: 'invalid' }
  } catch { return { state: 'invalid' } }
  return { state: 'ok', data: raw }
}

// Orders the rename with the same best-effort caveat as above. Not fatal if it fails -- the rename is
// still atomic; Windows simply cannot fsync a directory handle at all.
async function syncDir(d: string): Promise<void> {
  let dh: FileHandle | undefined
  try { dh = await open(d, 'r'); await dh.sync() } catch { /* best effort */ }
  finally { await dh?.close().catch(() => undefined) }
}

// Move a damaged save aside. rename(2) SILENTLY CLOBBERS an existing target, which would destroy the
// very evidence this step exists to keep, so the move is link() (fails EEXIST atomically) + unlink(),
// with a probe-then-rename fallback for filesystems without hard links. No clock is involved, so the
// resulting filename is stable enough for the smoke test to assert.
type Preservation = { kind: 'preserved'; path: string } | { kind: 'missing' } | { kind: 'failed' }

async function preserveCorrupt(current: string, corrupt: (n: number) => string): Promise<Preservation> {
  for (let n = 0; n <= 9; n++) {
    const target = corrupt(n)
    try {
      await link(current, target)
      // The hard link is already an independent directory entry preserving the bytes. If removing
      // the live name fails, keep both rather than report failure and let a later write destroy the
      // only copy the recovery layer knows about.
      await unlink(current).catch(() => undefined)
      return { kind: 'preserved', path: target }
    } catch (e) {
      if (code(e) === 'EEXIST') continue                  // that slot already holds older evidence
      if (code(e) === 'ENOENT') return { kind: 'missing' } // it disappeared after the probe: absent, not damaged
      try { await stat(target); continue } catch { /* the slot is free; fall through to rename */ }
      try { await rename(current, target); return { kind: 'preserved', path: target } }
      catch (renameError) { return code(renameError) === 'ENOENT' ? { kind: 'missing' } : { kind: 'failed' } }
    }
  }
  return { kind: 'failed' }   // ten damaged copies already kept: stop, and leave this one exactly where it is
}

export interface SaveStoreOptions {
  verify?: boolean            // read back and compare; on in debug and test builds
  testWriteDelayMs?: number   // test lever: makes the quit-race smoke actually race the write
}
export type ReadResult =
  | { data: string | null; corrupt?: undefined; preserved?: undefined }
  | { data: null; corrupt: true; preserved: string | false }

export function createSaveStore(dir: string, opts: SaveStoreOptions = {}) {
  let seq = 0
  // Writes to one profile are serialised: two autosaves interleaving their rotations could leave the
  // live file and the backup holding the same generation.
  const queues = new Map<string, Promise<unknown>>()
  const serial = <T,>(id: string, job: () => Promise<T>): Promise<T> => {
    const next = (queues.get(id) ?? Promise.resolve()).then(job, job)
    const tail = next.then(() => undefined, () => undefined)
    queues.set(id, tail)
    // Drop the entry once this is the last operation for that id, so the map cannot grow one entry
    // per profile name for the life of the process.
    void tail.then(() => { if (queues.get(id) === tail) queues.delete(id) })
    return next
  }

  async function writeNow(id: string, data: string): Promise<number> {
    if (opts.testWriteDelayMs) await new Promise(r => setTimeout(r, opts.testWriteDelayMs))
    const p = savePaths(dir, id); assertInside(dir, p.current)
    await mkdir(dir, { recursive: true })
    const tmp = p.temp(++seq)
    // Any failure before the commit rename must take its staging file with it: every autosave uses a
    // fresh sequence number, so under a persistent quota or I/O failure the orphans would otherwise
    // accumulate one per attempt -- eating the very space whose shortage is making the saves fail.
    let fh: FileHandle | undefined
    try {
      fh = await open(tmp, 'wx')          // never adopt a temp file another process owns
      await fh.writeFile(data, 'utf8')
      // Best effort, and worth being precise about: on macOS fsync(2) pushes the write to the drive
      // but does NOT flush the drive's own cache -- that needs F_FULLFSYNC, which Node cannot issue.
      // So this orders the write before the rename rather than guaranteeing it survives a power cut.
      // The rotation is what actually protects a player: the previous generation is still in ~bak.
      await fh.sync()
      await fh.close()
      fh = undefined
    } catch (e) {
      await fh?.close().catch(() => undefined)
      await unlink(tmp).catch(() => undefined)
      throw e
    }
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
    if (preserved.kind === 'missing') return { data: null }
    return { data: null, corrupt: true, preserved: preserved.kind === 'preserved' ? preserved.path : false }
  }

  async function readBackupNow(id: string): Promise<ReadResult> {
    const p = savePaths(dir, id); assertInside(dir, p.backup)
    const bak = await probe(p.backup)
    if (bak.state === 'unreadable') throw new Error(`backup save could not be read: ${p.backup}`)
    if (bak.state === 'ok') return { data: bak.data }
    if (bak.state === 'missing') return { data: null }
    const preserved = await preserveCorrupt(p.backup, p.corrupt)
    if (preserved.kind === 'missing') return { data: null }
    return { data: null, corrupt: true, preserved: preserved.kind === 'preserved' ? preserved.path : false }
  }

  async function deleteNow(id: string): Promise<void> {
    const p = savePaths(dir, id); assertInside(dir, p.current)
    for (const f of [p.current, p.backup]) await unlink(f).catch(e => { if (code(e) !== 'ENOENT') throw e })
    // ~corrupt files are deliberately left alone: they are the player's damaged data, not ours.
  }

  return {
    dir,
    // Everything currently queued or in flight, settled. The quit path drains this so a write that
    // reached the main process cannot be abandoned by the app exiting underneath it.
    flush: (): Promise<void> => Promise.all([...queues.values()]).then(() => undefined),
    read: (id: string) => serial(id, () => readNow(id)),
    readBackup: (id: string) => serial(id, () => readBackupNow(id)),
    write: (id: string, data: string) => serial(id, () => writeNow(id, data)),
    delete: (id: string) => serial(id, () => deleteNow(id)),
  }
}
export type FsSaveStore = ReturnType<typeof createSaveStore>
