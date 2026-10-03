/**
 * The email one-time-code settings this app expects. They mirror the Supabase project
 * (Authentication → Sign In / Providers → Email: "Email OTP length" and "Email OTP expiration"), which is the
 * authority: change them there first, then here. Defaults are this project's values: 6 digits, 1 hour.
 * Override at build time with VITE_OTP_LENGTH / VITE_OTP_EXPIRY_SECONDS; a missing or out-of-range value
 * falls back to the default rather than breaking sign-up.
 */

export const DEFAULT_OTP_LENGTH = 6
export const DEFAULT_OTP_EXPIRY_SECONDS = 3600
/** Supabase allows 6–10 digits and an expiry of 1 second to 24 hours; below a minute is useless to a person. */
const LENGTH_RANGE = [6, 10] as const
const EXPIRY_RANGE = [60, 86_400] as const

function intInRange(
  raw: string | undefined,
  [min, max]: readonly [number, number],
  fallback: number,
): number {
  const n = Number(String(raw ?? '').trim())
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

export function readOtpConfig(env: {
  VITE_OTP_LENGTH?: string
  VITE_OTP_EXPIRY_SECONDS?: string
}) {
  return {
    length: intInRange(env.VITE_OTP_LENGTH, LENGTH_RANGE, DEFAULT_OTP_LENGTH),
    expirySeconds: intInRange(
      env.VITE_OTP_EXPIRY_SECONDS,
      EXPIRY_RANGE,
      DEFAULT_OTP_EXPIRY_SECONDS,
    ),
  }
}

const cfg = readOtpConfig({
  VITE_OTP_LENGTH: import.meta.env.VITE_OTP_LENGTH as string | undefined,
  VITE_OTP_EXPIRY_SECONDS: import.meta.env.VITE_OTP_EXPIRY_SECONDS as
    string | undefined,
})
export const OTP_LENGTH = cfg.length
export const OTP_EXPIRY_SECONDS = cfg.expirySeconds

/** 3600 → "1 hour", 900 → "15 minutes", 90 → "2 minutes" (rounded up: never promise more time than there is). */
export function formatDuration(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60
    return `${h} ${h === 1 ? 'hour' : 'hours'}`
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/** Has a code sent at `sentAt` (ms epoch) outlived its lifetime at `now`? */
export function isCodeExpired(
  sentAt: number,
  now: number,
  expirySeconds: number = OTP_EXPIRY_SECONDS,
): boolean {
  return sentAt > 0 && now - sentAt >= expirySeconds * 1000
}
