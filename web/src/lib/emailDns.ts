/**
 * "Can this email domain receive mail at all?" asked of Google's public DNS-over-HTTPS resolver
 * (https://dns.google/resolve?name=<domain>&type=MX), once, when someone submits the sign-up form.
 *
 * It catches typos and made-up domains ("gmial.con", "asdf.example123"), not abuse: a real domain with a
 * mailbox nobody reads still passes. Real ownership of the inbox is proved by the emailed code.
 *
 * Design rules:
 *  - Fail open. If we cannot ask (offline, blocked, timeout, resolver outage, odd reply) the person is let
 *    through: a flaky third party must never stop a real person from signing up.
 *  - Only a definite "this domain has no mail server" is a refusal (see `interpretMxAnswer`).
 *  - Pure interpretation is separate from the network call, so each is tested on its own.
 *  - Switch off with VITE_VALIDATE_EMAIL_DNS=false (corporate or custom mail that DNS cannot see).
 */

export const DNS_RESOLVER_URL = 'https://dns.google/resolve'
export const DNS_TIMEOUT_MS = 4000
/** DNS record type number for MX. */
const MX = 15
/** Shown for every definite refusal, so the message never reveals which check failed. */
export const BAD_DOMAIN_MESSAGE = 'Please enter a valid domain'
export const NO_AT_MESSAGE = 'Invalid email domain'

/** The subset of Google's JSON reply this check reads. */
export type DnsAnswer = {
  Status?: number
  Answer?: { type?: number; data?: string }[]
  Authority?: unknown[]
}

export type DomainVerdict =
  /** The domain publishes at least one mail server. */
  | { kind: 'valid' }
  /** The domain definitely cannot receive mail. */
  | { kind: 'invalid' }
  /** We could not tell: treated as valid by the caller (fail open). */
  | { kind: 'unknown' }

const NXDOMAIN = 3
const NOERROR = 0

/** RFC 7505 "null MX" (`0 .`): the domain states it accepts no mail. */
const isNullMx = (data: string) => /^\s*\d+\s+\.?\s*$/.test(data)

/**
 * Google's reply as a verdict:
 *  - Status 3 (NXDOMAIN)                       → invalid: the domain does not exist.
 *  - Status 0 with MX records in Answer        → valid.
 *  - Status 0, no Answer, but an Authority     → invalid: the domain exists and has no mail server.
 *  - Status 0 with only a null MX / no usable MX → invalid.
 *  - Status 2 (SERVFAIL, a resolver hiccup)    → unknown: not the person's fault, so not a refusal.
 *  - Anything else                             → invalid.
 */
export function interpretMxAnswer(
  answer: DnsAnswer | null | undefined,
): DomainVerdict {
  if (!answer || typeof answer.Status !== 'number') return { kind: 'unknown' }
  if (answer.Status === NXDOMAIN) return { kind: 'invalid' }
  if (answer.Status === 2) return { kind: 'unknown' }
  if (answer.Status !== NOERROR) return { kind: 'invalid' }
  const mx = (answer.Answer ?? []).filter(
    (r) => r.type === MX && typeof r.data === 'string' && r.data.trim(),
  )
  if (mx.some((r) => !isNullMx(r.data!))) return { kind: 'valid' }
  return { kind: 'invalid' } // exists, but no (usable) mail server
}

/** Everything after the first "@", or null when there is none. */
export function domainOf(email: string): string | null {
  const at = email.indexOf('@')
  const domain = at < 0 ? '' : email.slice(at + 1).trim()
  return domain || null
}

/** Whether the check runs at all. On unless explicitly set to "false" (case-insensitive). */
export function dnsValidationEnabled(
  flag: string | undefined = import.meta.env.VITE_VALIDATE_EMAIL_DNS as
    string | undefined,
): boolean {
  return (
    String(flag ?? '')
      .trim()
      .toLowerCase() !== 'false'
  )
}

type Fetcher = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
  ok: boolean
  json: () => Promise<unknown>
}>

/** Ask the resolver. Any failure to get a usable reply is `unknown`, never an error. */
export async function lookupMx(
  domain: string,
  {
    fetcher = fetch,
    timeoutMs = DNS_TIMEOUT_MS,
  }: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<DomainVerdict> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetcher(
      `${DNS_RESOLVER_URL}?name=${encodeURIComponent(domain)}&type=MX`,
      { signal: ctl.signal, headers: { accept: 'application/dns-json' } },
    )
    if (!res.ok) return { kind: 'unknown' }
    return interpretMxAnswer((await res.json()) as DnsAnswer)
  } catch {
    return { kind: 'unknown' } // offline, blocked by CSP/an extension, timeout, or a non-JSON reply
  } finally {
    clearTimeout(timer)
  }
}

export type EmailDomainCheck = { ok: true } | { ok: false; message: string }

/**
 * The one call the sign-up form makes. `ok: false` only for a definite refusal; every other outcome
 * (including the check being switched off) is `ok: true`.
 */
export async function checkEmailDomain(
  email: string,
  opts: { enabled?: boolean; fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<EmailDomainCheck> {
  if (!(opts.enabled ?? dnsValidationEnabled())) return { ok: true }
  const domain = domainOf(email)
  if (!domain) return { ok: false, message: NO_AT_MESSAGE }
  const verdict = await lookupMx(domain, opts)
  return verdict.kind === 'invalid'
    ? { ok: false, message: BAD_DOMAIN_MESSAGE }
    : { ok: true }
}
