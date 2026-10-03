import { describe, expect, it, vi } from 'vitest'
import {
  BAD_DOMAIN_MESSAGE,
  NO_AT_MESSAGE,
  checkEmailDomain,
  dnsValidationEnabled,
  domainOf,
  interpretMxAnswer,
  lookupMx,
} from './emailDns'

const mx = (data: string) => ({ type: 15, data })

describe('interpretMxAnswer', () => {
  it('NXDOMAIN is invalid', () => {
    expect(interpretMxAnswer({ Status: 3 })).toEqual({ kind: 'invalid' })
  })
  it('NOERROR with MX records is valid', () => {
    expect(
      interpretMxAnswer({
        Status: 0,
        Answer: [mx('10 mx1.example.com.'), mx('20 mx2.example.com.')],
      }),
    ).toEqual({ kind: 'valid' })
  })
  it('NOERROR with no Answer but an Authority (domain exists, no mail server) is invalid', () => {
    expect(interpretMxAnswer({ Status: 0, Authority: [{}] })).toEqual({
      kind: 'invalid',
    })
  })
  it('an answer with no MX record in it (e.g. only a CNAME) is invalid', () => {
    expect(
      interpretMxAnswer({
        Status: 0,
        Answer: [{ type: 5, data: 'x.example.com.' }],
      }),
    ).toEqual({
      kind: 'invalid',
    })
  })
  it('a null MX ("0 .") means the domain takes no mail: invalid', () => {
    expect(interpretMxAnswer({ Status: 0, Answer: [mx('0 .')] })).toEqual({
      kind: 'invalid',
    })
    expect(
      interpretMxAnswer({
        Status: 0,
        Answer: [mx('0 .'), mx('10 mail.example.com.')],
      }),
    ).toEqual({
      kind: 'valid',
    })
  })
  it('a resolver SERVFAIL is not the person’s fault: unknown', () => {
    expect(interpretMxAnswer({ Status: 2 })).toEqual({ kind: 'unknown' })
  })
  it('any other status is invalid; no usable reply is unknown', () => {
    expect(interpretMxAnswer({ Status: 5 })).toEqual({ kind: 'invalid' })
    expect(interpretMxAnswer({})).toEqual({ kind: 'unknown' })
    expect(interpretMxAnswer(null)).toEqual({ kind: 'unknown' })
  })
})

describe('domainOf', () => {
  it('is everything after the first @', () => {
    expect(domainOf('a@b.com')).toBe('b.com')
    expect(domainOf('a@b@c.com')).toBe('b@c.com')
    expect(domainOf('nope')).toBeNull()
    expect(domainOf('a@')).toBeNull()
  })
})

describe('dnsValidationEnabled', () => {
  it('is on unless the flag is "false"', () => {
    expect(dnsValidationEnabled(undefined)).toBe(true)
    expect(dnsValidationEnabled('')).toBe(true)
    expect(dnsValidationEnabled('true')).toBe(true)
    expect(dnsValidationEnabled('false')).toBe(false)
    expect(dnsValidationEnabled(' FALSE ')).toBe(false)
  })
})

const reply = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) })

describe('lookupMx', () => {
  it('asks Google for the MX records of the encoded domain', async () => {
    const fetcher = reply({ Status: 0, Answer: [mx('10 m.example.com.')] })
    await lookupMx('exa mple.com', { fetcher })
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://dns.google/resolve?name=exa%20mple.com&type=MX',
    )
  })
  it('fails open when fetch throws, the HTTP status is bad, or the body is not JSON', async () => {
    expect(
      await lookupMx('x.com', {
        fetcher: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).toEqual({
      kind: 'unknown',
    })
    expect(await lookupMx('x.com', { fetcher: reply({}, false) })).toEqual({
      kind: 'unknown',
    })
    expect(
      await lookupMx('x.com', {
        fetcher: vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.reject(new Error('html')),
        }),
      }),
    ).toEqual({ kind: 'unknown' })
  })
  it('fails open on a timeout', async () => {
    const hang = vi.fn(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    )
    expect(
      await lookupMx('x.com', { fetcher: hang as never, timeoutMs: 10 }),
    ).toEqual({ kind: 'unknown' })
  })
})

describe('checkEmailDomain', () => {
  it('refuses a domain that does not exist or has no mail server, with one message', async () => {
    expect(
      await checkEmailDomain('a@nope.invalid', {
        enabled: true,
        fetcher: reply({ Status: 3 }),
      }),
    ).toEqual({
      ok: false,
      message: BAD_DOMAIN_MESSAGE,
    })
    expect(
      await checkEmailDomain('a@nomail.com', {
        enabled: true,
        fetcher: reply({ Status: 0, Authority: [{}] }),
      }),
    ).toEqual({ ok: false, message: BAD_DOMAIN_MESSAGE })
  })
  it('accepts a domain with mail servers', async () => {
    expect(
      await checkEmailDomain('a@gmail.com', {
        enabled: true,
        fetcher: reply({
          Status: 0,
          Answer: [mx('5 gmail-smtp-in.l.google.com.')],
        }),
      }),
    ).toEqual({ ok: true })
  })
  it('lets the person through when the lookup cannot be made', async () => {
    expect(
      await checkEmailDomain('a@x.com', {
        enabled: true,
        fetcher: vi.fn().mockRejectedValue(new Error('x')),
      }),
    ).toEqual({ ok: true })
  })
  it('does not call the network when switched off', async () => {
    const fetcher = vi.fn()
    expect(
      await checkEmailDomain('a@x.com', { enabled: false, fetcher }),
    ).toEqual({ ok: true })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses an address with no @ without calling the network', async () => {
    const fetcher = vi.fn()
    expect(await checkEmailDomain('nope', { enabled: true, fetcher })).toEqual({
      ok: false,
      message: NO_AT_MESSAGE,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
