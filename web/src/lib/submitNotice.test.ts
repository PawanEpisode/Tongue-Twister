import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { unsavedReason } from './submitNotice'

describe('unsavedReason', () => {
  it('only claims offline when the browser is offline', () => {
    expect(unsavedReason(new TypeError('x'), false)).toMatch(/offline/)
    expect(unsavedReason(new TypeError('x'), true)).not.toMatch(/offline/)
  })
  it('explains an expired sign-in', () => {
    expect(unsavedReason(new ApiError(401, 'x'), true)).toMatch(/sign in/i)
  })
  it('explains throttling and server trouble', () => {
    expect(unsavedReason(new ApiError(429, 'x'), true)).toMatch(/Too many/)
    expect(unsavedReason(new ApiError(503, 'x'), true)).toMatch(/reach/)
  })
})
