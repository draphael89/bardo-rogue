import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ColourPlacementRule } from '../../src/render/sheet'

const PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'art', 'palette', 'placement.json')
let cached: Record<string, Record<string, ColourPlacementRule>> | null = null

export function placementProfile(id: string, ramp: readonly string[]): Record<string, ColourPlacementRule> {
  cached ??= JSON.parse(readFileSync(PATH, 'utf8')) as Record<string, Record<string, ColourPlacementRule>>
  const profile = cached[id]
  if (!profile) throw new Error(`colour placement profile "${id}" does not exist`)
  const extras = Object.keys(profile).filter(name => !ramp.includes(name))
  const missing = ramp.filter(name => !Object.prototype.hasOwnProperty.call(profile, name))
  if (missing.length || extras.length) {
    throw new Error(`colour placement profile "${id}" disagrees with the ramp (missing: ${missing.join(', ') || 'none'}; extra: ${extras.join(', ') || 'none'})`)
  }
  for (const [name, rule] of Object.entries(profile)) {
    for (const field of ['maxShare', 'maxWidth', 'maxHeight'] as const) {
      if (!Number.isFinite(rule[field]) || rule[field] < 0 || rule[field] > 1) throw new Error(`colour placement profile "${id}" ${name}.${field} must be in 0..1`)
    }
  }
  return profile
}
