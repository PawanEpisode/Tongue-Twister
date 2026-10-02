/**
 * GET /speak/engine/manifest/ -> what to download and which thresholds apply. Parsed defensively: the model URL
 * must be https, the hash a real SHA-256, the size sane; anything else means "no usable model" and the app stays on
 * basic scoring.
 */
import { profileFromThresholds } from '../types'
import type { ScoringProfile } from '../types'
import type { ModelDescriptor } from './modelCache'

export type EngineManifest = {
  model: ModelDescriptor
  profile: ScoringProfile
  /** Server-side code of the profile (sent back as `scoring_profile`). */
  profileCode: string
  lexiconVersion: number
  scoreVersion: number
}

const SHA = /^[0-9a-f]{64}$/
/** Same ceiling as the `models` bucket (600 MB) so a corrupt manifest cannot make a phone download a gigabyte. */
export const MAX_MODEL_BYTES = 600 * 1024 * 1024

const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)

export function parseManifest(raw: unknown): EngineManifest | null {
  if (!isRecord(raw) || !isRecord(raw.model) || !isRecord(raw.scoring_profile))
    return null
  const m = raw.model
  const p = raw.scoring_profile
  const sha = typeof m.sha256 === 'string' ? m.sha256.toLowerCase() : ''
  const size = m.size_bytes
  if (
    typeof m.name !== 'string' ||
    !m.name ||
    !SHA.test(sha) ||
    typeof size !== 'number' ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > MAX_MODEL_BYTES ||
    typeof m.url !== 'string' ||
    !m.url.startsWith('https://') ||
    typeof m.label_map_version !== 'string' ||
    typeof p.code !== 'string' ||
    !p.code
  )
    return null
  return {
    model: {
      name: m.name,
      sha256: sha,
      url: m.url,
      sizeBytes: size,
      labelMapVersion: m.label_map_version,
    },
    profile: profileFromThresholds(
      isRecord(p.thresholds) ? p.thresholds : {},
      p.code,
    ),
    profileCode: p.code,
    lexiconVersion:
      typeof raw.lexicon_version === 'number' ? raw.lexicon_version : 0,
    scoreVersion: typeof raw.score_version === 'number' ? raw.score_version : 0,
  }
}
