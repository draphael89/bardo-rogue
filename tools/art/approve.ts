// The approval boundary, as code instead of prose.
//
// ART_DIRECTION's lifecycle says an image becomes a master only by human decision, and everything
// generated afterwards is conditioned on the approved pool. Before this file that boundary was a
// README: specs pointed wherever they liked, and promotion into public/assets asked no one. Now a
// production compile requires a RECEIPT — a checked-in JSON beside the master whose sha256 must match
// the file — so approving is an explicit recorded act, revising a master invalidates its receipt, and
// an agent cannot manufacture approval by editing a path string.
//
// An agent must never write a receipt on its own initiative: `pnpm art approve` exists so a HUMAN
// decision has a command to be recorded through. The receipt stores who and when.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'

export const APPROVED_DIR = 'art/approved'

export interface ApprovalReceipt {
  version: 1
  /** Identity this master anchors, e.g. "actor.hero.identity.v1". */
  id: string
  /** File name of the master, relative to art/approved/. */
  file: string
  sha256: string
  approvedAt: string
  /** Who decided. Never an agent. */
  approvedBy: string
  note?: string
}

const fileSha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

export const receiptPathFor = (masterPath: string): string => {
  // Guarded, not best-effort: a path with no .png suffix came back UNCHANGED, so approving a
  // non-PNG under art/approved/ (a mis-tabbed README.md, say) overwrote that file with its own
  // receipt JSON. A master is a PNG; anything else is a mistake worth naming.
  if (!/\.png$/i.test(masterPath)) throw new Error(`approve: ${masterPath} is not a .png — a master is an image, and a receipt path derived from it must not collide with the file itself`)
  return masterPath.replace(/\.png$/i, '.approval.json')
}

/** Record a human approval decision. The caller is responsible for having one. */
export function writeReceipt(masterPath: string, id: string, approvedBy: string, note?: string): ApprovalReceipt {
  if (!existsSync(masterPath)) throw new Error(`approve: ${masterPath} does not exist`)
  const inPool = resolve(masterPath).split(sep).join('/').includes(`/${APPROVED_DIR}/`)
  if (!inPool) throw new Error(`approve: ${masterPath} is not under ${APPROVED_DIR}/ — move it into the pool first; approval and location are one act`)
  const receipt: ApprovalReceipt = {
    version: 1,
    id,
    file: basename(masterPath),
    sha256: fileSha(masterPath),
    approvedAt: new Date().toISOString(),
    approvedBy,
    ...(note ? { note } : {}),
  }
  writeFileSync(receiptPathFor(masterPath), JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}

/**
 * Verify that a spec's custody anchor — approvedSource (the compile input itself, retained under
 * art/approved) or approvedReference (a style anchor) — is a real, receipted, unmodified master.
 * Throws with the reason when it is not; production compilation calls this and stops on throw.
 */
export function verifyApproval(anchor: string | undefined, where: string): ApprovalReceipt {
  const fail = (m: string): never => { throw new Error(`approval ${where}: ${m}`) }
  if (!anchor) return fail('production output requires provenance.approvedSource (the compile input, retained as a master) or provenance.approvedReference (a style anchor) naming a receipted master in art/approved/')
  const approvedReference = anchor
  const norm = approvedReference.split(sep).join('/')
  if (!norm.startsWith(`${APPROVED_DIR}/`)) return fail(`approvedReference "${approvedReference}" is not under ${APPROVED_DIR}/ — only the approved pool anchors production art`)
  if (!existsSync(approvedReference)) return fail(`approvedReference "${approvedReference}" does not exist`)
  const rp = receiptPathFor(approvedReference)
  if (!existsSync(rp)) return fail(`"${approvedReference}" has no approval receipt (${rp}) — a human approves via pnpm art approve`)
  const receipt = JSON.parse(readFileSync(rp, 'utf8')) as ApprovalReceipt
  if (receipt.version !== 1) return fail(`receipt ${rp} has unsupported version ${receipt.version}`)
  const actual = fileSha(approvedReference)
  if (receipt.sha256 !== actual) {
    return fail(`"${approvedReference}" does not match its receipt (receipt ${receipt.sha256.slice(0, 12)}…, file ${actual.slice(0, 12)}…) — the master changed after approval; re-approve or restore it`)
  }
  return receipt
}

/** True when a compile destination is production (shipped) rather than a candidate. */
export const isProductionPath = (p: string): boolean =>
  resolve(p).split(sep).join('/').includes('/public/assets/')

export { fileSha }
