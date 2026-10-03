import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OTP_EXPIRY_SECONDS,
  DEFAULT_OTP_LENGTH,
  formatDuration,
  isCodeExpired,
  readOtpConfig,
} from './otpConfig'

describe('readOtpConfig', () => {
  it('defaults to 6 digits and one hour, matching Supabase’s 3600 s', () => {
    expect(readOtpConfig({})).toEqual({ length: 6, expirySeconds: 3600 })
    expect(DEFAULT_OTP_LENGTH).toBe(6)
    expect(DEFAULT_OTP_EXPIRY_SECONDS).toBe(3600)
  })
  it('takes valid overrides', () => {
    expect(
      readOtpConfig({ VITE_OTP_LENGTH: '8', VITE_OTP_EXPIRY_SECONDS: '900' }),
    ).toEqual({ length: 8, expirySeconds: 900 })
  })
  it.each(['', 'abc', '5', '11', '6.5', '-6'])(
    'falls back for a bad length %j',
    (v) => expect(readOtpConfig({ VITE_OTP_LENGTH: v }).length).toBe(6),
  )
  it.each(['', 'x', '10', '86401', '30.5'])(
    'falls back for a bad expiry %j',
    (v) =>
      expect(readOtpConfig({ VITE_OTP_EXPIRY_SECONDS: v }).expirySeconds).toBe(
        3600,
      ),
  )
})

describe('formatDuration', () => {
  it('reads naturally and rounds up', () => {
    expect(formatDuration(3600)).toBe('1 hour')
    expect(formatDuration(7200)).toBe('2 hours')
    expect(formatDuration(900)).toBe('15 minutes')
    expect(formatDuration(60)).toBe('1 minute')
    expect(formatDuration(90)).toBe('2 minutes')
    expect(formatDuration(5400)).toBe('90 minutes')
  })
})

describe('isCodeExpired', () => {
  it('is true once the lifetime has passed, never before a code was sent', () => {
    expect(isCodeExpired(1000, 1000 + 3599_000, 3600)).toBe(false)
    expect(isCodeExpired(1000, 1000 + 3600_000, 3600)).toBe(true)
    expect(isCodeExpired(0, 9e12, 3600)).toBe(false)
  })
})
