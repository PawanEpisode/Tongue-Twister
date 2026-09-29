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
type Page<T> = { count: number; results: T[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const { data } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  }
  if (data.session)
    headers.set('Authorization', `Bearer ${data.session.access_token}`)
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers })
  if (!res.ok) throw new Error(`API ${res.status}`)
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
}
