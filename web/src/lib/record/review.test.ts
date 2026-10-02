import { describe, expect, it } from 'vitest'
import type { Playback } from '../api'
import {
  POLL_FIRST_MS,
  POLL_MAX_COUNT,
  POLL_MAX_MS,
  analysisStatus,
  chooseCaptions,
  isBusy,
  scoringMessage,
  scoringOf,
  pickPlayback,
  pollDelay,
} from './review'

describe('analysisStatus', () => {
  it('treats a missing block as none', () => {
    expect(analysisStatus({})).toBe('none')
    expect(
      analysisStatus({ analysis: { status: 'ready', audio_ready: true } }),
    ).toBe('ready')
  })
})

describe('pollDelay', () => {
  const processing = { status: 'processing' as const }
  it('polls while processing and backs off to the cap', () => {
    expect(pollDelay(processing, 0)).toBe(POLL_FIRST_MS)
    expect(pollDelay(processing, 1)).toBe(3200)
    expect(pollDelay(processing, 2)).toBeGreaterThan(
      pollDelay(processing, 1) as number,
    )
    expect(pollDelay(processing, 20)).toBe(POLL_MAX_MS)
  })
  it('polls while analysis is queued or running, not when settled', () => {
    for (const status of ['queued', 'running'] as const)
      expect(
        pollDelay(
          { status: 'ready', analysis: { status, audio_ready: false } },
          0,
        ),
      ).toBe(POLL_FIRST_MS)
    for (const status of ['none', 'ready', 'failed'] as const)
      expect(
        pollDelay(
          { status: 'ready', analysis: { status, audio_ready: true } },
          0,
        ),
      ).toBe(false)
    expect(pollDelay({ status: 'ready' }, 0)).toBe(false)
    expect(pollDelay({ status: 'failed' }, 0)).toBe(false)
  })
  it('stops with no data and after the maximum number of polls', () => {
    expect(pollDelay(undefined, 0)).toBe(false)
    expect(pollDelay(processing, POLL_MAX_COUNT)).toBe(false)
    expect(isBusy({ status: 'uploaded' })).toBe(true)
  })
})

describe('chooseCaptions', () => {
  const cues = [{ startMs: 0, endMs: 1, text: 'a' }]
  it('prefers the server alignment over local cues', () => {
    expect(
      chooseCaptions({
        captionsUrl: 'u',
        captionsSource: 'alignment',
        localCues: cues,
      }),
    ).toEqual({ kind: 'server', url: 'u' })
  })
  it('uses local cues when the server has no alignment captions', () => {
    expect(
      chooseCaptions({
        captionsUrl: null,
        captionsSource: null,
        localCues: cues,
      }),
    ).toEqual({ kind: 'local' })
    expect(
      chooseCaptions({
        captionsUrl: 'u',
        captionsSource: null,
        localCues: cues,
      }),
    ).toEqual({ kind: 'local' })
  })
  it('falls back to any server VTT, then to none', () => {
    expect(
      chooseCaptions({ captionsUrl: 'u', captionsSource: null, localCues: [] }),
    ).toEqual({ kind: 'server', url: 'u' })
    expect(
      chooseCaptions({
        captionsUrl: undefined,
        captionsSource: undefined,
        localCues: null,
      }),
    ).toEqual({ kind: 'none' })
  })
})

describe('pickPlayback', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  const pb = (url: string, mins: number, mime = 'video/webm'): Playback => ({
    url,
    mime,
    expires_at: new Date(now + mins * 60_000).toISOString(),
  })
  it('keeps a still-valid URL across polls so the video does not restart', () => {
    const prev = { status: 'ready' as const, playback: pb('a', 10) }
    expect(
      pickPlayback(prev, { status: 'ready', playback: pb('b', 15) }, now),
    ).toBe(prev.playback)
  })
  it('switches when expiring, when the stage changes, or the type changes', () => {
    const fresh = pb('b', 15)
    expect(
      pickPlayback(
        { status: 'ready', playback: pb('a', 0.5) },
        { status: 'ready', playback: fresh },
        now,
      ),
    ).toBe(fresh)
    expect(
      pickPlayback(
        { status: 'processing', playback: pb('a', 10) },
        { status: 'ready', playback: fresh },
        now,
      ),
    ).toBe(fresh)
    const mp4 = pb('c', 15, 'video/mp4')
    expect(
      pickPlayback(
        { status: 'ready', playback: pb('a', 10) },
        { status: 'ready', playback: mp4 },
        now,
      ),
    ).toBe(mp4)
    expect(
      pickPlayback(null, { status: 'ready', playback: null }, now),
    ).toBeNull()
  })
})

describe('scoring (A5)', () => {
  const ready = (scoring?: { status: string; reason: string }) =>
    ({
      status: 'ready' as const,
      analysis: { status: 'ready' as const, audio_ready: true, scoring },
    }) as Parameters<typeof isBusy>[0]

  it('an older API without a scoring block is simply not scoring', () => {
    expect(
      scoringOf({ analysis: { status: 'ready', audio_ready: true } }),
    ).toEqual({
      status: 'none',
      reason: '',
    })
    expect(isBusy(ready())).toBe(false)
  })

  it('keeps polling while the take is queued or being scored, then stops', () => {
    expect(isBusy(ready({ status: 'queued', reason: '' }))).toBe(true)
    expect(isBusy(ready({ status: 'running', reason: '' }))).toBe(true)
    for (const status of ['scored', 'unscorable', 'failed', 'none'])
      expect(isBusy(ready({ status, reason: '' }))).toBe(false)
  })

  it('explains every outcome in plain words', () => {
    expect(scoringMessage({ status: 'queued', reason: '' })).toMatch(/waiting/i)
    expect(scoringMessage({ status: 'scored', reason: '' })).toMatch(/scored/i)
    expect(
      scoringMessage({ status: 'unscorable', reason: 'low_quality' }),
    ).toMatch(/quiet or noisy/)
    expect(
      scoringMessage({ status: 'unscorable', reason: 'never_heard_of_it' }),
    ).toMatch(/couldn’t be scored/)
    expect(scoringMessage({ status: 'failed', reason: 'boom' })).toMatch(
      /didn’t finish/,
    )
    expect(scoringMessage({ status: 'none', reason: '' })).toBe('')
    expect(scoringMessage({ status: 'none', reason: 'too_long' })).toMatch(
      /too long/,
    )
  })

  it('says nothing when another attempt already covers the take', () => {
    expect(
      scoringMessage({ status: 'unscorable', reason: 'attempt_exists' }),
    ).toBe('')
  })
})
