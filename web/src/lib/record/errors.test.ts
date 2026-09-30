import { describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { classify, errorOf } from './errors'
import { namedError } from './testing/fakes'

describe('error taxonomy', () => {
  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['SecurityError', 'permission_denied'],
    ['NotFoundError', 'device_missing'],
    ['NotReadableError', 'device_busy'],
    ['AbortError', 'device_busy'],
    ['OverconstrainedError', 'overconstrained'],
    ['NotSupportedError', 'codec_unsupported'],
    ['QuotaExceededError', 'out_of_space'],
    ['InvalidStateError', 'recorder_error'],
    ['UnsupportedLayout', 'unsupported'],
    ['ScreenCancelled', 'screen_cancelled'],
    ['SomethingElse', 'unknown'],
  ])('%s → %s', (name, cls) => {
    expect(classify(namedError(name)).class).toBe(cls)
  })
  it('recognises an offline fetch', () => {
    expect(classify(new TypeError('Failed to fetch')).class).toBe('network')
    expect(classify(new TypeError('x is not a function')).class).toBe('unknown')
  })
  it('maps API codes and statuses', () => {
    expect(classify(new ApiError(402, 'quota_exceeded')).class).toBe(
      'quota_exceeded',
    )
    expect(classify(new ApiError(403, 'minor_not_allowed')).class).toBe(
      'minor_not_allowed',
    )
    expect(classify(new ApiError(403, 'age_required')).class).toBe(
      'age_required',
    )
    expect(classify(new ApiError(403, 'consent_required')).class).toBe(
      'consent_required',
    )
    expect(classify(new ApiError(413, 'error')).class).toBe('too_large')
    expect(classify(new ApiError(415, 'error')).class).toBe(
      'unsupported_media_type',
    )
    expect(classify(new ApiError(503, 'dependency_unavailable')).class).toBe(
      'upload_failed',
    )
    expect(classify(new ApiError(400, 'bad')).class).toBe('unknown')
  })
  it('copy is never empty and always tells the user what to do next', () => {
    for (const cls of [
      'permission_denied',
      'device_busy',
      'out_of_space',
      'quota_exceeded',
    ] as const) {
      const e = errorOf(cls)
      expect(e.title.length).toBeGreaterThan(3)
      expect(e.message.length).toBeGreaterThan(20)
    }
    expect(errorOf('out_of_space').retryable).toBe(false)
    expect(errorOf('device_busy').retryable).toBe(true)
  })
})
