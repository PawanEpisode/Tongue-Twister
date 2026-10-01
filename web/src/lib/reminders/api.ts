import { ApiError } from '#/lib/api'
import { getAccessToken } from '#/lib/supabase'

/**
 * The only file that knows the wire shape of the reminders API (spec 16 section 2, D27). If api-rem's
 * shapes differ, adjust here and nothing else.
 */
const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:8000'

export type ReminderPrefs = { enabled: boolean; hour_local: number }

async function call(
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (auth) {
    const token = await getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; request_id?: string }
    } | null
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'error',
      body?.error?.request_id,
    )
  }
  return res
}

export const clampHour = (h: unknown): number =>
  typeof h === 'number' && Number.isFinite(h)
    ? Math.min(23, Math.max(0, Math.trunc(h)))
    : 18

export async function getReminders(): Promise<ReminderPrefs> {
  const raw = (await (
    await call('/me/reminders/')
  ).json()) as Partial<ReminderPrefs>
  return {
    enabled: raw.enabled === true,
    hour_local: clampHour(raw.hour_local),
  }
}

export async function putReminders(
  prefs: ReminderPrefs,
): Promise<ReminderPrefs> {
  const res = await call('/me/reminders/', {
    method: 'PUT',
    body: JSON.stringify({
      enabled: prefs.enabled,
      hour_local: clampHour(prefs.hour_local),
    }),
  })
  const raw = (await res.json()) as Partial<ReminderPrefs>
  return {
    enabled: raw.enabled === true,
    hour_local: clampHour(raw.hour_local),
  }
}

/** Public and idempotent; no session needed (the signed token is the credential). Called on a button press. */
export async function unsubscribe(token: string): Promise<void> {
  await call(
    `/public/unsubscribe/${encodeURIComponent(token)}/`,
    { method: 'POST' },
    false,
  )
}

export type UnsubscribeFailure = 'invalid' | 'network' | 'error'
/** 400/404/410 mean the link is bad or expired; no response means offline. */
export function classifyUnsubscribeError(err: unknown): UnsubscribeFailure {
  if (err instanceof ApiError)
    return [400, 404, 410, 422].includes(err.status) ? 'invalid' : 'error'
  return 'network'
}
