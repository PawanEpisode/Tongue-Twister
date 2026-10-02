import { ApiError } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { getAccessToken } from '#/lib/supabase'

/**
 * The only file that knows the wire shape of the Generate Twister API (spec 16 section 2).
 * If the API's shapes change, adjust here and nothing else.
 */
const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:8000'

export type GenerateBody = {
  topic: string
  difficulty?: number
  language?: 'en'
  words?: number
}
/** A generated twister is a normal (private) twister. */
/** The API also returns the numeric `id` (the DELETE key) and try count on owned twisters. */
export type GeneratedTwister = Twister & {
  id: number
  topic?: string
  created_at?: string
  /** Absent only on a payload from before try counts shipped. Treat that as zero. */
  attempts_count?: number
}

/** Owned libraries are at most 50 twisters, 24 per page. One extra page stops a bad `next`. */
const LIBRARY_PAGE_CAP = 4

function libraryPath(next: string): string | null {
  const marker = '/api/v1'
  const at = next.indexOf(marker)
  const path = at === -1 ? next : next.slice(at + marker.length)
  if (!path.startsWith('/')) return null
  return path
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const token = await getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
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

export async function generateTwister(
  body: GenerateBody,
): Promise<GeneratedTwister> {
  const res = await call('/generate/', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return (await res.json()) as GeneratedTwister
}

/** Accepts the house pagination envelope or a bare array. */
export function normaliseList(raw: unknown): GeneratedTwister[] {
  if (Array.isArray(raw)) return raw as GeneratedTwister[]
  const results = (raw as { results?: unknown } | null)?.results
  return Array.isArray(results) ? (results as GeneratedTwister[]) : []
}

export async function listMyTwisters(): Promise<GeneratedTwister[]> {
  const items: GeneratedTwister[] = []
  const seen = new Set<string>()
  let path: string | null = '/me/twisters/'
  for (
    let page = 0;
    path && page < LIBRARY_PAGE_CAP && !seen.has(path);
    page++
  ) {
    seen.add(path)
    const res = await call(path)
    const body: unknown = await res.json()
    items.push(...normaliseList(body))
    const next = (body as { next?: unknown } | null)?.next
    path = typeof next === 'string' ? libraryPath(next) : null
  }
  return items
}

/** DELETE is keyed by the numeric id (spec 16 section 2) and answers 204. */
export async function deleteMyTwister(id: number): Promise<void> {
  await call(`/me/twisters/${id}/`, { method: 'DELETE' })
}
