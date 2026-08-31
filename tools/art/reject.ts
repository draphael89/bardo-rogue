import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'

export const REJECTED_DIR = 'art/rejected'

export interface RejectionReceipt {
  version: 1
  file: string
  sha256: string
  originalFile: string
  rejectedAt: string
  recordedBy: string
  reason: string
  manifest?: { file: string; sha256: string }
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
export const rejectionReceiptPath = (imagePath: string): string => imagePath.replace(/\.png$/i, '.rejection.json')

export function writeRejection(candidate: string, reason: string, recordedBy = 'codex', manifest?: string, pool = REJECTED_DIR): { image: string; receipt: string; data: RejectionReceipt } {
  if (!existsSync(candidate)) throw new Error(`reject: ${candidate} does not exist`)
  if (extname(candidate).toLowerCase() !== '.png') throw new Error(`reject: ${candidate} is not a .png candidate`)
  if (reason.trim().length < 8) throw new Error('reject: --reason must record a specific visual or technical failure')
  if (manifest && !existsSync(manifest)) throw new Error(`reject: manifest ${manifest} does not exist`)

  const hash = sha256(candidate)
  const stem = basename(candidate, extname(candidate)).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'candidate'
  const image = join(pool, `${stem}-${hash.slice(0, 12)}.png`)
  const receipt = rejectionReceiptPath(image)
  if (existsSync(receipt)) throw new Error(`reject: ${receipt} already records this candidate`)
  mkdirSync(pool, { recursive: true })
  copyFileSync(candidate, image)

  let keptManifest: RejectionReceipt['manifest']
  if (manifest) {
    const manifestFile = `${stem}-${hash.slice(0, 12)}.manifest.json`
    copyFileSync(manifest, join(pool, manifestFile))
    keptManifest = { file: manifestFile, sha256: sha256(manifest) }
  }
  const data: RejectionReceipt = {
    version: 1,
    file: basename(image),
    sha256: hash,
    originalFile: relative(process.cwd(), candidate),
    rejectedAt: new Date().toISOString(),
    recordedBy,
    reason: reason.trim(),
    ...(keptManifest ? { manifest: keptManifest } : {}),
  }
  writeFileSync(receipt, JSON.stringify(data, null, 2) + '\n')
  return { image, receipt, data }
}

export function verifyRejection(receiptPath: string): RejectionReceipt {
  if (!existsSync(receiptPath)) throw new Error(`rejection ${receiptPath}: receipt does not exist`)
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as RejectionReceipt
  const dir = receiptPath.slice(0, Math.max(receiptPath.lastIndexOf('/'), 0)) || '.'
  const image = join(dir, receipt.file)
  if (receipt.version !== 1) throw new Error(`rejection ${receiptPath}: unsupported version ${receipt.version}`)
  if (!receipt.reason?.trim() || receipt.reason.trim().length < 8) throw new Error(`rejection ${receiptPath}: missing reason`)
  if (!existsSync(image)) throw new Error(`rejection ${receiptPath}: image ${receipt.file} is missing`)
  if (sha256(image) !== receipt.sha256) throw new Error(`rejection ${receiptPath}: image no longer matches its receipt`)
  if (receipt.manifest) {
    const manifest = join(dir, receipt.manifest.file)
    if (!existsSync(manifest) || sha256(manifest) !== receipt.manifest.sha256) throw new Error(`rejection ${receiptPath}: manifest no longer matches its receipt`)
  }
  return receipt
}
