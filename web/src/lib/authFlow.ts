import disposable from './disposableDomains.json'
import { OTP_LENGTH } from './otpConfig'

/**
 * Pure rules for the sign-up flow: what an email may look like, what a one-time code may look like, how long
 * to wait before asking for another, and how Supabase's errors read to a person. No network, no React, so each
 * rule is unit-tested. The server enforces the disposable-email rule again (`api/twisters/emailpolicy.py`);
 * the list is generated from the API's
 * (`npm run sync:disposable`) and a test fails if it drifts.
 */

export { OTP_LENGTH }
/** Seconds before "Resend code" works again: stops mail floods and double-sends. */
export const RESEND_COOLDOWN_S = 60
/** Wrong codes allowed before the person must ask for a new one. */
export const MAX_CODE_ATTEMPTS = 5
export const MIN_SIGNUP_PASSWORD = 8

const DISPOSABLE = new Set<string>(disposable.domains)

/** Common slips for the big providers; offered as "Did you mean…?", never applied silently. */
const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'icloud.con': 'icloud.com',
}

const LOCAL = /^[^\s@]{1,64}$/
const DOMAIN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Trimmed, lower-cased, and width/compatibility-folded ("ＡＢＣ@x.com" → "abc@x.com"), with no zero-width junk. */
export function normaliseEmail(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
}

export function isDisposableDomain(domain: string): boolean {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.')
  for (let i = 0; i < parts.length - 1; i++)
    if (DISPOSABLE.has(parts.slice(i).join('.'))) return true
  return false
}

export type EmailCheck =
  | { ok: true; email: string; suggestion?: string }
  | { ok: false; email: string; reason: 'empty' | 'invalid' | 'disposable' }

export function checkEmail(raw: string): EmailCheck {
  const email = normaliseEmail(raw)
  if (!email) return { ok: false, email, reason: 'empty' }
  const at = email.lastIndexOf('@')
  const local = at > 0 ? email.slice(0, at) : ''
  const domain = at > 0 ? email.slice(at + 1) : ''
  if (
    email.length > 254 ||
    !LOCAL.test(local) ||
    !DOMAIN.test(domain) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  )
    return { ok: false, email, reason: 'invalid' }
  if (isDisposableDomain(domain))
    return { ok: false, email, reason: 'disposable' }
  const fix = TYPOS[domain]
  return fix
    ? { ok: true, email, suggestion: `${local}@${fix}` }
    : { ok: true, email }
}

export function emailProblemText(
  reason: 'empty' | 'invalid' | 'disposable',
): string {
  if (reason === 'disposable')
    return 'Please use a permanent email address, not a disposable one.'
  if (reason === 'empty') return 'Enter your email address.'
  return 'That doesn’t look like a valid email address.'
}

/** What a person typed into the code box, reduced to digits and capped (pasting "123 456" or "123-456" works). */
export function cleanCode(raw: string): string {
  return raw.normalize('NFKC').replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export const isCompleteCode = (code: string) =>
  new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)

/** Whole seconds left of a cooldown that ends at `until` (ms epoch); 0 once it is over. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000))
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_SIGNUP_PASSWORD)
    return `Use at least ${MIN_SIGNUP_PASSWORD} characters for your password.`
  if (password.length > 72)
    return 'That password is too long (72 characters at most).'
  return null
}

/** A message under a form: what went wrong (alert) or what happened (status). */
export type Note = { kind: 'error' | 'info'; text: string }

type AuthErr = { message?: string; code?: string; status?: number }

export type AuthFailure = {
  text: string
  /** Show the code step: the account exists but its email is not confirmed yet. */
  needsCode?: boolean
  /** Do not let the person hammer the button: start the resend cooldown. */
  cooldown?: boolean
  /** A sensitive change needs a fresh code first (Supabase "secure password change"): ask for one. */
  reauthNeeded?: boolean
}

/** Supabase's errors, in words a person can act on. Unknown errors keep their own message. */
export function describeAuthError(err: AuthErr): AuthFailure {
  const code = err.code ?? ''
  const msg = err.message ?? ''
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg))
    return {
      text: 'Confirm your email first: we’ve sent you a code.',
      needsCode: true,
    }
  if (code === 'reauthentication_needed' || /reauthentication/i.test(msg))
    return {
      text: 'For your security, confirm it’s you with a code first.',
      reauthNeeded: true,
    }
  if (code === 'otp_expired' || /expired|invalid.*(token|otp)/i.test(msg))
    return {
      text: 'That code is wrong or has expired. Check it, or request a new one.',
    }
  if (
    err.status === 429 ||
    /rate.?limit|too many|security purposes/i.test(code + ' ' + msg)
  )
    return {
      text: 'Too many attempts. Please wait a minute and try again.',
      cooldown: true,
    }
  if (code === 'email_address_invalid' || /email address.*invalid/i.test(msg))
    return { text: 'That email address can’t be used. Try another one.' }
  if (code === 'weak_password' || /password.*(weak|short|least)/i.test(msg))
    return { text: msg || 'Choose a stronger password.' }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg))
    return { text: 'Wrong email or password.' }
  if (code === 'same_password' || /different from the old password/i.test(msg))
    return { text: 'Choose a password you haven’t used on this account.' }
  if (
    code === 'email_exists' ||
    code === 'email_conflict_identity_not_deletable'
  )
    return { text: 'That email is already used by another account.' }
  if (
    code === 'session_not_found' ||
    code === 'session_expired' ||
    /not authenticated|session missing/i.test(msg)
  )
    return { text: 'Your session has expired. Please sign in again.' }
  if (code === 'user_already_exists' || /already registered/i.test(msg))
    return { text: 'That email already has an account. Try signing in.' }
  return { text: msg || 'Something went wrong. Please try again.' }
}

/**
 * Supabase hides whether an email is already registered: signing up again returns a user with no identities
 * and sends no code. Treated as "already registered" so the screen can say what to do without a dead end.
 */
export function signUpWasDuplicate(
  user: { identities?: unknown[] | null } | null | undefined,
): boolean {
  return (
    !!user && Array.isArray(user.identities) && user.identities.length === 0
  )
}

/**
 * Asking for a sign-in code for an address with no account is refused by Supabase ("signups not allowed for
 * otp"). The screen must not reveal that, so the caller treats it as a success: the same "we sent a code".
 */
export function isUnknownAccountForCode(err: AuthErr): boolean {
  return (
    err.code === 'otp_disabled' ||
    err.code === 'user_not_found' ||
    /signups? not allowed for otp/i.test(err.message ?? '')
  )
}
