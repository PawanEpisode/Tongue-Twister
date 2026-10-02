/**
 * One read, start to finish, on the device: signal gate -> trim -> model -> label map -> posterior gate ->
 * assess. Order matters (docs/features/13 section 3): cheap checks first, so a silent or clipped take never
 * pays for inference, and the exact trimmed samples that were scored are returned for hashing and spot-checks.
 */
import { assess } from '../assess'
import {
  GATE_MESSAGE,
  expectedSpeechMs,
  posteriorGate,
  signalGate,
  speechBounds,
} from '../quality'
import type { Gate, Quality } from '../quality'
import type {
  Assessment,
  Posteriors,
  ScoringProfile,
  Unscorable,
  Word,
} from '../types'
import { collapse } from './labelMap'
import type { LabelMap } from './labelMap'
import { SAMPLE_RATE } from './chunking'

export interface InferenceLike {
  run: (
    samples: Float32Array,
    signal?: AbortSignal,
  ) => Promise<{
    logits: Float32Array
    frames: number
    vocab: number
    ms: number
  }>
}

export type ReadInput = {
  /** 16 kHz mono, the whole take. */
  samples: Float32Array
  /** The microphone's own rate (the sample-rate gate asks about the hardware). */
  captureRate: number
  words: readonly Word[]
  focus: readonly string[]
  difficulty: number
  profile: ScoringProfile
  labelMap: LabelMap
  /** Calibration only: hand back the log-posteriors that were scored, to be stored as a gold clip. */
  keepPosteriors?: boolean
}

export type QualityReport = Record<string, number | boolean>

export type Analysis =
  | {
      kind: 'scored'
      assessment: Assessment
      /** Exactly the samples that were scored (leading/trailing silence removed). */
      clip: Float32Array
      quality: QualityReport
      inferenceMs: number
      posteriors?: Posteriors
    }
  | { kind: 'gate'; gate: Gate; message: string; quality: QualityReport }
  | {
      kind: 'unscorable'
      reason: Unscorable
      quality: QualityReport
      posteriors?: Posteriors
    }

export class AnalysisError extends Error {
  constructor(
    readonly code: 'assess_failed' | 'label_map_mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'AnalysisError'
  }
}

const round = (x: number | null, places = 3) =>
  x === null || !Number.isFinite(x)
    ? null
    : Math.round(x * 10 ** places) / 10 ** places

function report(parts: Record<string, number | boolean | null>): QualityReport {
  const out: QualityReport = {}
  for (const [k, v] of Object.entries(parts))
    if (v !== null) out[k] = typeof v === 'number' ? round(v)! : v
  return out
}

const signalReport = (q: Quality, captureRate: number) =>
  report({
    loud_dbfs: q.loudDbfs,
    snr_db: q.snrDb,
    clip_share: q.clipShare,
    capture_rate: captureRate,
  })

export async function analyseRead(
  engine: InferenceLike,
  input: ReadInput,
  signal?: AbortSignal,
): Promise<Analysis> {
  const { profile } = input
  const gate = signalGate(
    input.samples,
    SAMPLE_RATE,
    profile,
    input.captureRate,
  )
  const base = signalReport(gate, input.captureRate)
  if (!gate.ok)
    return {
      kind: 'gate',
      gate: gate.gate!,
      message: GATE_MESSAGE[gate.gate!],
      quality: base,
    }

  const [from, to] = speechBounds(input.samples, SAMPLE_RATE)
  const clip = input.samples.slice(from, to) // a copy: the worker transfers its own, and this is what gets hashed
  if (clip.length < 400)
    return {
      kind: 'gate',
      gate: 'too_short',
      message: GATE_MESSAGE.too_short,
      quality: base,
    }

  const out = await engine.run(clip, signal)
  if (out.vocab !== input.labelMap.vocabSize)
    throw new AnalysisError(
      'label_map_mismatch',
      'model output width does not match the label map',
    )
  const post: Posteriors = {
    vocab: input.labelMap.classes,
    logp: collapse(input.labelMap, out.logits, out.frames),
  }
  const durationMs = Math.round((clip.length * 1000) / SAMPLE_RATE)
  const expected = expectedSpeechMs(input.words.length, input.difficulty)
  const posterior = posteriorGate(post, expected, profile)
  const quality = report({
    ...base,
    speech_share: posterior.speechShare,
    entropy_share: posterior.entropyShare,
    trimmed_ms: durationMs,
    latency_ms: out.ms,
  })
  if (!posterior.ok)
    return {
      kind: 'gate',
      gate: posterior.gate!,
      message: GATE_MESSAGE[posterior.gate!],
      quality,
    }

  let assessment: Assessment
  try {
    assessment = assess(post, input.words, input.focus, {
      profile,
      durationMs,
      difficulty: input.difficulty,
    })
  } catch (err) {
    throw new AnalysisError(
      'assess_failed',
      String((err as Error)?.message ?? err),
    )
  }
  const kept = input.keepPosteriors ? { posteriors: post } : {}
  if (assessment.unscorable)
    return {
      kind: 'unscorable',
      reason: assessment.unscorable,
      quality,
      ...kept,
    }
  return {
    kind: 'scored',
    assessment,
    clip,
    quality,
    inferenceMs: out.ms,
    ...kept,
  }
}
