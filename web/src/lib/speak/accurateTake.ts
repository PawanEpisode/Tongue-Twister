/**
 * From a finished take to the request body: run the on-device engine over the captured audio and decide what to
 * send. Pure orchestration over an injected engine, so every branch (gate, unscorable, engine failure, no audio)
 * is unit-tested without a browser. The caller always keeps the basic (text-layer) body as the fallback.
 */
import type { SubmitAttemptBody, Pronunciations, Segment } from '../api'
import type { Captured } from './engine/runtime/capture'
import type { AccurateEngine } from './engine/runtime/engine'
import { deviceFields } from './engine/runtime/attemptBody'
import type { Gate } from './engine/quality'
import { encodeClip } from './engine/runtime/wav'
import type { EncodedClip } from './engine/runtime/wav'

export type AccurateOutcome =
  | { kind: 'device'; body: SubmitAttemptBody; clip: EncodedClip }
  | { kind: 'gate'; gate: Gate; message: string }
  | {
      kind: 'fallback'
      reason: 'no_audio' | 'no_words' | 'unscorable' | 'engine_error'
      detail?: string
    }

type Analyser = Pick<AccurateEngine, 'analyse' | 'modelVersion' | 'profileCode'>

export async function runAccurate(args: {
  engine: Analyser
  captured: Captured | null
  pronunciations: Pronunciations | undefined
  /** The basic body for this take (transcript, ids, timing); the device fields are layered on top. */
  textBody: SubmitAttemptBody
  segment?: Segment
  signal?: AbortSignal
}): Promise<AccurateOutcome> {
  const { engine, captured, pronunciations: pron, textBody, segment } = args
  if (!captured || captured.samples.length < 4_000)
    return { kind: 'fallback', reason: 'no_audio' }
  if (!pron || pron.words.length === 0)
    return { kind: 'fallback', reason: 'no_words' }
  const start = segment?.start ?? 0
  const words = pron.words.slice(start, segment?.end ?? pron.words.length)
  if (words.length === 0) return { kind: 'fallback', reason: 'no_words' }

  let analysis
  try {
    analysis = await engine.analyse(
      {
        samples: captured.samples,
        captureRate: captured.captureRate,
        words,
        focus: pron.focus,
        difficulty: pron.difficulty,
      },
      args.signal,
    )
  } catch (err) {
    return {
      kind: 'fallback',
      reason: 'engine_error',
      detail: String((err as Error)?.message ?? err),
    }
  }
  if (analysis.kind === 'gate')
    return { kind: 'gate', gate: analysis.gate, message: analysis.message }
  if (analysis.kind === 'unscorable')
    return { kind: 'fallback', reason: 'unscorable', detail: analysis.reason }

  const clip = await encodeClip(analysis.clip)
  if (clip.durationMs < 300) return { kind: 'fallback', reason: 'no_audio' }
  const { stt: _stt, ...base } = textBody
  void _stt
  const body: SubmitAttemptBody = {
    ...base,
    // The duration is the length of the clip that was scored (and would be uploaded), not the recogniser's guess.
    duration_ms: clip.durationMs,
    long_pause_ms: Math.min(
      Math.round(analysis.assessment.longPauseMs),
      clip.durationMs,
    ),
    ...deviceFields({
      assessment: analysis.assessment,
      segmentStart: start,
      modelVersion: engine.modelVersion,
      profileCode: engine.profileCode,
      nonce: crypto.randomUUID(),
      audioSha256: clip.sha256,
      quality: analysis.quality,
    }),
  }
  return { kind: 'device', body, clip }
}
