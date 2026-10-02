import { describe, expect, it } from 'vitest'
import type { Pronunciations, SubmitAttemptBody } from '../api'
import type { Analysis } from './engine/runtime/session'
import { runAccurate } from './accurateTake'

const textBody: SubmitAttemptBody = {
  client_attempt_id: 'id-1',
  twister: 'peter',
  kind: 'test',
  transcript: 'peter piper',
  duration_ms: 5000,
  long_pause_ms: 100,
  stt: { engine: 'text_layer', confidence: 0.9 },
  client_score: { version: 2, score: 80 },
}
const pron: Pronunciations = {
  slug: 'peter',
  lang: 'en-US',
  scoring_profile: 'p1',
  focus: ['P'],
  difficulty: 2,
  words: [
    { text: 'peter', variants: [['P', 'IY', 'T', 'ER']] },
    { text: 'piper', variants: [['P', 'AY', 'P', 'ER']] },
    { text: 'picked', variants: [['P', 'IH', 'K', 'T']] },
  ],
}
const captured = {
  samples: new Float32Array(16_000).fill(0.1),
  captureRate: 48_000,
  truncated: false,
}
const assessment = {
  unscorable: null,
  words: [
    {
      index: 0,
      text: 'piper',
      status: 'correct',
      reason: '',
      uncertain: false,
      variant: 0,
      start: 1,
      end: 20,
      phonemes: [
        {
          target: 'P',
          heard: 'P',
          verdict: 'ok',
          start: 1,
          end: 3,
          delta: 1.5,
          lpp: -0.2,
          lpr: -1.7,
          focus: true,
        },
      ],
    },
  ],
  extras: 0,
  accuracy: 100,
  speed: 80,
  fluency: 90,
  score: 91,
  focusGated: false,
  longPauseMs: 120,
  durationMs: 1000,
} as never
const engineReturning = (a: Analysis | Error) => {
  const seen: { words?: number } = {}
  return {
    seen,
    modelVersion: 'm1',
    profileCode: 'p1',
    analyse: async (input: { words: readonly unknown[] }) => {
      seen.words = input.words.length
      if (a instanceof Error) throw a
      return a
    },
  }
}
const scored: Analysis = {
  kind: 'scored',
  assessment,
  clip: new Float32Array(16_000).fill(0.2),
  quality: { loud_dbfs: -20 },
  inferenceMs: 900,
}

describe('runAccurate', () => {
  it('builds a device body from the scored clip and drops the text-layer stt', async () => {
    const out = await runAccurate({
      engine: engineReturning(scored),
      captured,
      pronunciations: pron,
      textBody,
    })
    if (out.kind !== 'device') throw new Error(out.kind)
    expect(out.body).toMatchObject({
      engine: 'ondevice',
      model_version: 'm1',
      scoring_profile: 'p1',
      client_attempt_id: 'id-1',
      twister: 'peter',
      duration_ms: 1000,
      long_pause_ms: 120,
      audio_sha256: out.clip.sha256,
    })
    expect(out.body.stt).toBeUndefined()
    expect(out.body.nonce).toMatch(/^[0-9a-f-]{36}$/)
    expect(out.clip.durationMs).toBe(1000)
  })
  it('scores only the practised segment and keeps whole-twister word indexes', async () => {
    const eng = engineReturning(scored)
    const out = await runAccurate({
      engine: eng,
      captured,
      pronunciations: pron,
      textBody: { ...textBody, segment: { start: 1, end: 3 } },
      segment: { start: 1, end: 3 },
    })
    expect(eng.seen.words).toBe(2)
    if (out.kind !== 'device') throw new Error(out.kind)
    expect(out.body.words![0].i).toBe(1)
  })
  it('surfaces quality gates instead of scoring', async () => {
    const out = await runAccurate({
      engine: engineReturning({
        kind: 'gate',
        gate: 'too_quiet',
        message: 'Too quiet',
        quality: {},
      }),
      captured,
      pronunciations: pron,
      textBody,
    })
    expect(out).toEqual({
      kind: 'gate',
      gate: 'too_quiet',
      message: 'Too quiet',
    })
  })
  it('falls back to basic scoring when nothing usable came out', async () => {
    const run = (over: Parameters<typeof runAccurate>[0]) => runAccurate(over)
    expect(
      await run({
        engine: engineReturning(scored),
        captured: null,
        pronunciations: pron,
        textBody,
      }),
    ).toMatchObject({
      kind: 'fallback',
      reason: 'no_audio',
    })
    expect(
      await run({
        engine: engineReturning(scored),
        captured: { ...captured, samples: new Float32Array(100) },
        pronunciations: pron,
        textBody,
      }),
    ).toMatchObject({ reason: 'no_audio' })
    expect(
      await run({
        engine: engineReturning(scored),
        captured,
        pronunciations: undefined,
        textBody,
      }),
    ).toMatchObject({
      reason: 'no_words',
    })
    expect(
      await run({
        engine: engineReturning({
          kind: 'unscorable',
          reason: 'could_not_follow',
          quality: {},
        }),
        captured,
        pronunciations: pron,
        textBody,
      }),
    ).toMatchObject({ reason: 'unscorable', detail: 'could_not_follow' })
    expect(
      await run({
        engine: engineReturning(new Error('worker crashed')),
        captured,
        pronunciations: pron,
        textBody,
      }),
    ).toMatchObject({ reason: 'engine_error', detail: 'worker crashed' })
    expect(
      await run({
        engine: engineReturning(scored),
        captured,
        pronunciations: pron,
        textBody: { ...textBody, segment: { start: 5, end: 9 } },
        segment: { start: 5, end: 9 },
      }),
    ).toMatchObject({ reason: 'no_words' })
  })
})
