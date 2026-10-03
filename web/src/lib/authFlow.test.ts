import { describe, expect, it } from 'vitest'
import {
  OTP_LENGTH,
  checkEmail,
  cleanCode,
  describeAuthError,
  isCompleteCode,
  isUnknownAccountForCode,
  normaliseEmail,
  passwordProblem,
  secondsLeft,
  signUpWasDuplicate,
} from './authFlow'

describe('normaliseEmail', () => {
  it('trims, lower-cases and strips invisible characters', () => {
    expect(normaliseEmail('  Foo@Bar.COM \n')).toBe('foo@bar.com')
    expect(normaliseEmail('a​b@x.com')).toBe('ab@x.com')
    expect(normaliseEmail('ＡＢ@x.com')).toBe('ab@x.com')
  })
})

describe('checkEmail', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.com', ' Me@Gmail.com '])(
    'accepts %s',
    (e) => expect(checkEmail(e).ok).toBe(true),
  )
  it.each([
    '',
    '   ',
    'nope',
    '@x.com',
    'a@',
    'a@b',
    'a@b..com',
    'a@-b.com',
    'a b@x.com',
    '.a@x.com',
    'a.@x.com',
    'a..b@x.com',
    'a@x.c',
    `${'a'.repeat(65)}@x.com`,
    `a@${'b'.repeat(250)}.com`,
  ])('rejects %j', (e) => expect(checkEmail(e).ok).toBe(false))
  it('says why: empty, invalid or disposable', () => {
    expect(checkEmail('')).toMatchObject({ reason: 'empty' })
    expect(checkEmail('x')).toMatchObject({ reason: 'invalid' })
    expect(checkEmail('x@mailinator.com')).toMatchObject({
      reason: 'disposable',
    })
    expect(checkEmail('x@Sub.YopMail.com')).toMatchObject({
      reason: 'disposable',
    })
  })
  it('does not flag a look-alike domain', () => {
    expect(checkEmail('x@notmailinator.com').ok).toBe(true)
  })
  it('returns the normalised address and suggests a fix for a typo, without applying it', () => {
    expect(checkEmail('Sam@Gmial.com')).toEqual({
      ok: true,
      email: 'sam@gmial.com',
      suggestion: 'sam@gmail.com',
    })
  })
})

describe('code entry', () => {
  it('keeps digits only, capped', () => {
    expect(cleanCode(' 123-456 ')).toBe('123456')
    expect(cleanCode('12ab34')).toBe('1234')
    expect(cleanCode('1234567890')).toHaveLength(OTP_LENGTH)
    expect(cleanCode('١٢٣٤٥٦')).toBe('') // non-latin digits are not codes
  })
  it('is complete only at full length', () => {
    expect(isCompleteCode('12345')).toBe(false)
    expect(isCompleteCode('123456')).toBe(true)
  })
})

describe('secondsLeft', () => {
  it('rounds up and never goes negative', () => {
    expect(secondsLeft(10_500, 10_000)).toBe(1)
    expect(secondsLeft(70_000, 10_000)).toBe(60)
    expect(secondsLeft(5_000, 10_000)).toBe(0)
  })
})

describe('passwordProblem', () => {
  it('needs 8 to 72 characters', () => {
    expect(passwordProblem('1234567')).toMatch(/at least 8/)
    expect(passwordProblem('12345678')).toBeNull()
    expect(passwordProblem('x'.repeat(73))).toMatch(/too long/)
  })
})

describe('describeAuthError', () => {
  it('sends an unconfirmed sign-in to the code step', () => {
    expect(
      describeAuthError({ code: 'email_not_confirmed', message: 'x' }),
    ).toMatchObject({ needsCode: true })
    expect(describeAuthError({ message: 'Email not confirmed' })).toMatchObject(
      { needsCode: true },
    )
  })
  it('explains a bad or expired code', () => {
    expect(describeAuthError({ code: 'otp_expired' }).text).toMatch(/expired/)
    expect(
      describeAuthError({ message: 'Token has expired or is invalid' }).text,
    ).toMatch(/expired/)
  })
  it('turns rate limits into a wait', () => {
    for (const e of [
      { status: 429 },
      { code: 'over_email_send_rate_limit' },
      {
        message:
          'For security purposes, you can only request this after 45 seconds.',
      },
    ])
      expect(describeAuthError(e)).toMatchObject({ cooldown: true })
  })
  it('keeps an unknown message and has a fallback', () => {
    expect(describeAuthError({ message: 'Boom' }).text).toBe('Boom')
    expect(describeAuthError({}).text).toMatch(/try again/)
  })
})

describe('signUpWasDuplicate', () => {
  it('is true only for a user with no identities', () => {
    expect(signUpWasDuplicate({ identities: [] })).toBe(true)
    expect(signUpWasDuplicate({ identities: [{}] })).toBe(false)
    expect(signUpWasDuplicate({})).toBe(false)
    expect(signUpWasDuplicate(null)).toBe(false)
  })
})

describe('describeAuthError: password and email changes', () => {
  it('asks for a fresh code when Supabase wants reauthentication', () => {
    expect(
      describeAuthError({ code: 'reauthentication_needed' }),
    ).toMatchObject({
      reauthNeeded: true,
    })
    expect(
      describeAuthError({
        message: 'Password update requires reauthentication',
      }),
    ).toMatchObject({ reauthNeeded: true })
  })
  it('explains a reused password, a taken email and an expired session', () => {
    expect(describeAuthError({ code: 'same_password' }).text).toMatch(
      /haven’t used/,
    )
    expect(describeAuthError({ code: 'email_exists' }).text).toMatch(
      /already used/,
    )
    expect(describeAuthError({ code: 'session_not_found' }).text).toMatch(
      /sign in again/,
    )
  })
})

describe('isUnknownAccountForCode', () => {
  it('recognises Supabase refusing a code for an address with no account', () => {
    expect(isUnknownAccountForCode({ code: 'otp_disabled' })).toBe(true)
    expect(
      isUnknownAccountForCode({ message: 'Signups not allowed for otp' }),
    ).toBe(true)
    expect(
      isUnknownAccountForCode({ code: 'over_email_send_rate_limit' }),
    ).toBe(false)
    expect(isUnknownAccountForCode({})).toBe(false)
  })
})
