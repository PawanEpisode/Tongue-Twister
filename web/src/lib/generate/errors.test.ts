import { describe, expect, it } from 'vitest'
import { ApiError } from '#/lib/api'
import { classifyGenerateError } from './errors'

describe('classifyGenerateError', () => {
  it.each([
    [429, 'generation_limit', 'limit'],
    [422, 'generation_rejected', 'rejected'],
    [503, 'generator_unavailable', 'unavailable'],
    [401, 'unauthorized', 'signin'],
    [403, 'feature_disabled', 'disabled'],
    [404, 'not_found', 'disabled'],
    [500, 'error', 'unavailable'],
    [400, 'error', 'unknown'],
  ])('maps %i %s to %s', (status, code, kind) => {
    expect(classifyGenerateError(new ApiError(status, code)).kind).toBe(kind)
  })
  it('detects network failures', () => {
    expect(classifyGenerateError(new TypeError('Failed to fetch')).kind).toBe(
      'network',
    )
  })
  it('falls back for unknown values', () => {
    expect(classifyGenerateError('x').kind).toBe('unknown')
    expect(classifyGenerateError(null).message).toMatch(/unexpected/)
  })
})
