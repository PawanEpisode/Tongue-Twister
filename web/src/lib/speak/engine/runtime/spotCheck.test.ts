import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api'
import { sendSpotCheck } from './spotCheck'
import type { SpotCheckApi } from './spotCheck'
import type { EncodedClip } from './wav'

const clip: EncodedClip = {
  bytes: new Uint8Array(100),
  sha256: 'c'.repeat(64),
  durationMs: 3000,
}
const grant = {
  voice_asset_id: 'asset-1',
  status: 'pending',
  expires_at: '2030-01-01T00:00:00Z',
  upload: {
    provider: 's',
    bucket: 'voice',
    path: 'p',
    signed_url: 'https://u',
    token: 't',
    expires_in: 60,
    chunk_size: 6,
  },
}
const api = (
  over: Partial<SpotCheckApi> = {},
): SpotCheckApi & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    createSpotCheckClip: async (b) => {
      calls.push(`create:${b.attempt}:${b.size_bytes}:${b.duration_ms}`)
      return grant
    },
    completeVoiceClip: async (id, sum) =>
      void calls.push(`complete:${id}:${sum.slice(0, 2)}`),
    attachSpotCheck: async (a, id) => void calls.push(`attach:${a}:${id}`),
    ...over,
  }
}

describe('sendSpotCheck', () => {
  it('creates, uploads, completes with the checksum, then attaches', async () => {
    const a = api()
    const upload = vi.fn(async (_blob: Blob) => undefined)
    const out = await sendSpotCheck({ api: a, upload }, { attemptId: 7, clip })
    expect(out).toEqual({ sent: true })
    expect(a.calls).toEqual([
      'create:7:100:3000',
      'complete:asset-1:cc',
      'attach:7:asset-1',
    ])
    const blob = upload.mock.calls[0][0]
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(100)
  })
  it('does nothing once the server window has passed', async () => {
    const a = api()
    const out = await sendSpotCheck(
      { api: a, upload: async () => undefined },
      {
        attemptId: 1,
        clip,
        expiresAt: '2020-01-01T00:00:00Z',
        now: Date.now(),
      },
    )
    expect(out).toEqual({ sent: false, reason: 'expired' })
    expect(a.calls).toEqual([])
  })
  it('never attaches a clip that failed to upload', async () => {
    const a = api()
    const out = await sendSpotCheck(
      {
        api: a,
        upload: async () => {
          throw new Error('net')
        },
      },
      { attemptId: 1, clip },
    )
    expect(out).toEqual({ sent: false, reason: 'upload_failed' })
    expect(a.calls.some((c) => c.startsWith('attach'))).toBe(false)
  })
  it('treats refusals as "declined" and anything else as an error, never throwing', async () => {
    const refuse = (status: number) =>
      api({
        createSpotCheckClip: async () => {
          throw new ApiError(status, 'x')
        },
      })
    for (const status of [403, 409, 413, 429])
      expect(
        await sendSpotCheck(
          { api: refuse(status), upload: async () => undefined },
          { attemptId: 1, clip },
        ),
      ).toEqual({
        sent: false,
        reason: 'declined',
      })
    expect(
      await sendSpotCheck(
        { api: refuse(500), upload: async () => undefined },
        { attemptId: 1, clip },
      ),
    ).toEqual({
      sent: false,
      reason: 'error',
    })
    const boom = api({
      attachSpotCheck: async () => {
        throw new TypeError('offline')
      },
    })
    expect(
      await sendSpotCheck(
        { api: boom, upload: async () => undefined },
        { attemptId: 1, clip },
      ),
    ).toEqual({
      sent: false,
      reason: 'error',
    })
  })
  it('stops when cancelled before uploading', async () => {
    const ctl = new AbortController()
    const a = api({
      createSpotCheckClip: async () => {
        ctl.abort()
        return grant
      },
    })
    const upload = vi.fn(async () => undefined)
    expect(
      await sendSpotCheck(
        { api: a, upload },
        { attemptId: 1, clip },
        ctl.signal,
      ),
    ).toEqual({
      sent: false,
      reason: 'aborted',
    })
    expect(upload).not.toHaveBeenCalled()
  })
})
