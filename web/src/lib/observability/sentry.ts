import type * as SentryModule from '@sentry/react'
/**
 * Error reporting via Sentry, loaded lazily and only when `VITE_SENTRY_DSN` is set. Without the DSN nothing
 * is imported and nothing is sent. Events are scrubbed before they leave the browser (see `scrubEvent`).
 */
type Sentry = typeof SentryModule
export type SentryLoader = () => Promise<Sentry>

let loader: SentryLoader = () => import('@sentry/react')
let started = false

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const TOKEN = /\b(?:eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|[A-Za-z0-9_-]{32,})\b/g

/** Removes emails and token-looking strings from free text. */
export const scrubText = (s: string): string =>
  s.replace(EMAIL, '[email]').replace(TOKEN, '[token]')

/** Strips the query string and fragment (share tokens, auth codes) from a URL. */
export const scrubUrl = (url: string): string => {
  const cut = url.search(/[?#]/)
  return scrubText(cut === -1 ? url : url.slice(0, cut))
}

type Loose = {
  user?: unknown
  request?: {
    url?: string
    headers?: unknown
    cookies?: unknown
    query_string?: unknown
    data?: unknown
  }
  message?: string
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  extra?: unknown
  contexts?: Record<string, unknown>
  [k: string]: unknown
}

/** `beforeSend`: no user, cookies, headers, bodies or query strings; emails and tokens redacted in text. */
export function scrubEvent<T extends Loose>(event: T): T {
  delete event.user
  delete event.extra
  if (event.request) {
    const { url } = event.request
    event.request = url ? { url: scrubUrl(url) } : {}
  }
  if (event.message) event.message = scrubText(event.message)
  for (const v of event.exception?.values ?? [])
    if (v.value) v.value = scrubText(v.value)
  event.breadcrumbs = (event.breadcrumbs ?? []).map((b) => {
    const data = b.data ? { ...b.data } : undefined
    if (data) {
      for (const k of ['url', 'from', 'to'])
        if (typeof data[k] === 'string') data[k] = scrubUrl(data[k])
      delete data.body
    }
    return {
      ...b,
      ...(b.message ? { message: scrubText(b.message) } : {}),
      ...(data ? { data } : {}),
    }
  })
  return event
}

export function initSentry(): void {
  const dsn = (import.meta.env as Record<string, string | undefined>)
    .VITE_SENTRY_DSN
  if (!dsn || started || typeof window === 'undefined') return
  started = true
  void loader()
    .then((S) =>
      S.init({
        dsn,
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        integrations: (defaults) =>
          defaults.filter(
            (i) => !['Replay', 'BrowserSession'].includes(i.name),
          ),
        beforeSend: (event) =>
          scrubEvent(event as unknown as Loose) as unknown as typeof event,
        beforeBreadcrumb: (b) => (b.category === 'console' ? null : b),
      }),
    )
    .catch(() => {
      started = false
    })
}

/** Test seams. */
export function __setSentryLoader(l: SentryLoader): void {
  loader = l
}
export function __resetSentry(): void {
  started = false
  loader = () => import('@sentry/react')
}
