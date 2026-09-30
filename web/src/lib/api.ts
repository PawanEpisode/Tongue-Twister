import { supabase } from './supabase'

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:8000'

export type Twister = {
  slug: string
  text: string
  category: string | null
  difficulty: 1 | 2 | 3 | 4
  difficulty_label: string
  origin: 'classic' | 'modern'
  tip: string
  focus_sounds: string[]
  word_count: number
  is_favorite: boolean
  best_score: number | null
}
export type Category = {
  slug: string
  name: string
  emoji: string
  description: string
  count: number
}
export type Profile = {
  id: string
  email: string
  display_name: string
  avatar_emoji: string
  xp: number
  level: number
  current_streak: number
  best_streak: number
  total_attempts?: number
  best_score?: number | null
}
export type AttemptResult = {
  id: number
  accuracy: number
  wpm: number
  score: number
  xp_awarded: number
  personal_best: boolean
  level_up: boolean
  profile: Profile
}
export type PracticeMode = 'read_along' | 'speak_score' | 'record'
export type DisplayStyle = 'word' | 'line' | 'scroll'
export type Preferences = {
  default_mode: PracticeMode
  display_style: DisplayStyle
  accent_lang: 'en-US' | 'en-GB' | 'en-IN' | 'en-AU'
  /** null = automatic, by twister difficulty */
  wpm: number | null
  threshold_pct: number
  font_scale: number
  loop_count: number
  countdown_s: number
  mirror_text: boolean
  punctuation_pauses: boolean
  reduce_motion: boolean
  dyslexia_font: boolean
  high_contrast: boolean
  metronome: boolean
  /** 0–1 */
  metronome_volume: number
  listen_first: boolean
  tts_voice: string
  tts_rate: number
  speed_ladder: { enabled?: boolean; target?: number; step?: number }
}
export type SessionPayload = {
  client_session_id: string
  twister: string
  mode: PracticeMode
  settings_snapshot?: Record<string, unknown>
}
export type SessionUpdate = Partial<{
  status: 'completed' | 'abandoned'
  ended_reason: 'user' | 'finished' | 'tab_hidden' | 'timeout' | 'error'
  active_ms: number
  loops_completed: number
  passes_completed: number
  avg_wpm: number
}>
export type SessionResult = { id: string; xp_awarded: number; profile: Profile }
export type FeatureFlags = Record<string, boolean>
export type GuestAttempt = {
  client_attempt_id: string
  twister: string
  transcript: string
  duration_ms: number
  created_at: string
}
export type GuestSyncPayload = {
  client_batch_id: string
  attempts: GuestAttempt[]
  favorites: string[]
}
export type GuestSyncResult = {
  attempts_imported: number
  favorites_imported: number
  rejected: number
}
export type History = {
  count: number
  best_score: number | null
  results: {
    id: number
    score: number
    accuracy: number
    wpm: number
    created_at: string
  }[]
}
type Page<T> = { count: number; results: T[] }

/** Carries the API's error envelope; `message` stays "API <status>" for friendlyError(). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(`API ${status}`)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const { data } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  }
  if (data.session)
    headers.set('Authorization', `Bearer ${data.session.access_token}`)
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
  return res.json() as Promise<T>
}

export const api = {
  categories: () => request<Category[]>('/categories/'),
  twisters: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    )
    return request<Page<Twister>>(`/twisters/?${qs}`)
  },
  twister: (slug: string) => request<Twister>(`/twisters/${slug}/`),
  daily: () => request<Twister>('/twisters/daily/'),
  favorite: (slug: string) =>
    request<{ is_favorite: boolean }>(`/twisters/${slug}/favorite/`, {
      method: 'POST',
    }),
  leaderboard: (slug: string) =>
    request<{ user: string; emoji: string; score: number }[]>(
      `/twisters/${slug}/leaderboard/`,
    ),
  submitAttempt: (body: {
    twister: string
    transcript: string
    duration_ms: number
  }) =>
    request<AttemptResult>('/attempts/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: () => request<Profile>('/me/'),
  flags: () => request<{ flags: FeatureFlags }>('/flags/').then((r) => r.flags),
  syncGuest: (body: GuestSyncPayload) =>
    request<GuestSyncResult>('/sync/guest/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  history: (slug: string) =>
    request<History>(`/twisters/${slug}/history/?range=10`),
  preferences: () => request<Preferences>('/me/preferences/'),
  updatePreferences: (patch: Partial<Preferences>) =>
    request<Preferences>('/me/preferences/', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  startSession: (body: SessionPayload) =>
    request<SessionResult>('/sessions/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSession: (id: string, patch: SessionUpdate) =>
    request<SessionResult>(`/sessions/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      keepalive: true, // lets the "abandoned" update survive a tab close
    }),
}
