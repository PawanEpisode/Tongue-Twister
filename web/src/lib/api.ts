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
/** Set once by the user (13+ or under 13); cloud saving and sharing are only for '13plus' (PRD 04 §9). */
export type AgeBand = 'unknown' | 'under13' | '13plus'
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
  age_band?: AgeBand
  /** Opt-in name shown on recordings you share; blank = anonymous. Never falls back to `display_name`. */
  public_name?: string
}
export type WordStatus = 'correct' | 'near' | 'wrong' | 'missed' | 'extra'
export type WordReason = '' | 'homophone' | 'focus_swap'
export type AttemptKind = 'test' | 'train' | 'drill' | 'record'
export type VerificationStatus =
  'none' | 'device' | 'pending' | 'verified' | 'failed'
/** A scored word as the API returns it; `target_index` counts scoring tokens, not displayed words. */
export type AttemptWord = {
  target_index: number | null
  spoken_index: number | null
  target: string
  spoken: string
  status: WordStatus
  reason: WordReason
  credit: number
  confidence: number | null
}
export type AttemptResult = {
  id: number | null
  accuracy: number
  wpm: number
  score: number
  xp_awarded: number
  personal_best: boolean
  level_up: boolean
  mastered_now?: boolean
  verification_status?: VerificationStatus
  focus_gated?: boolean
  words?: AttemptWord[]
  low_confidence?: false
  warning?: string | null
  profile: Profile
}
/** 200 with no attempt saved: the recogniser was too unsure to score fairly (PRD 03 §4). */
export type LowConfidenceResult = {
  low_confidence: true
  reason: string
  id: null
  score: null
}
/** Practised part of a twister, as scoring-token indexes: [start, end). Train and Drill only. */
export type Segment = { start: number; end: number }
export type SubmitAttemptBody = {
  client_attempt_id: string
  twister: string
  kind?: AttemptKind
  segment?: Segment
  transcript: string
  duration_ms: number
  long_pause_ms?: number
  stt?: { engine: 'text_layer'; confidence?: number | null }
  client_score?: { version: number; score: number }
  /** Only set for attempts replayed from the offline queue. */
  occurred_at?: string
}
export type AttemptSyncItem = {
  client_attempt_id: string | null
  status: 'created' | 'duplicate' | 'rejected'
  reason?: string
}
export type AttemptSyncResult = {
  results: AttemptSyncItem[]
  counts: Record<'created' | 'duplicate' | 'rejected', number>
  profile: Pick<Profile, 'xp' | 'level' | 'current_streak' | 'best_streak'>
}
/** Where to drill a word: a twister, the word's position in it, and a few words around it. */
export type DrillTarget = Segment & {
  twister: string
  context: string[]
  context_index: number
}
export type WeakWord = {
  word: string
  seen: number
  miss_rate: number
  weakness: number
  next_review_at: string | null
  respelling: string
  /** null when no published twister contains the word */
  drill: DrillTarget | null
}
export type WeakSound = {
  pair: string
  target: string
  heard: string | null
  occurrences: number
  errors: number
  error_rate: number
}
/** `judged_correct`: the learner agrees the verdict was right. */
export type WordFeedback = { judged_correct: boolean; comment?: string }
export const FEEDBACK_COMMENT_MAX = 200
export type AttemptDetail = {
  id: number
  twister: string
  kind: AttemptKind
  transcript: string
  score: number
  accuracy: number
  wpm: number
  created_at: string
  verification_status: VerificationStatus
  words: AttemptWord[]
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

// ─── Record mode, media, sharing and consent (docs/features/13-06c-build-spec.md §1) ───
// Every request/response shape of the recordings API lives here so a contract fix is a one-file change.

/** Layout ids double as the API's `Recording.layout` values. */
export type RecordingLayout =
  | 'camera'
  | 'camera_text'
  | 'side_by_side'
  | 'screen_bubble'
  | 'pip'
  | 'portrait'
  | 'region'
export type CaptureSource =
  'getUserMedia' | 'getDisplayMedia' | 'region_capture' | 'element_capture'
export type RecordingStatus =
  | 'recording'
  | 'local_ready'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'deleted'
export type RecordingVisibility = 'private' | 'unlisted'
export type RecordingEndedReason =
  'user' | 'limit' | 'device' | 'error' | 'tab_hidden'
export type ConsentType =
  | 'recording_upload'
  | 'voice_storage'
  | 'voice_processing'
  | 'model_improvement'
  | 'terms'
  | 'marketing'
/** Current consent text version; the server rejects unknown versions (`CONSENT_VERSIONS`). */
export const CONSENT_VERSION = 'v1'
/** A twister reference as list/detail/public payloads give it: a slug, or `{slug, text}`. */
export type TwisterRef = string | { slug: string; text?: string }
export const twisterSlug = (t: TwisterRef): string =>
  typeof t === 'string' ? t : t.slug
export type CreateRecordingBody = {
  client_recording_id: string
  twister: string
  session_id?: string
  /** A `kind=record` attempt made from this take (client-side analysis). */
  attempt?: number
  layout: RecordingLayout
  layout_settings?: Record<string, unknown>
  has_camera: boolean
  has_screen: boolean
  has_mic: boolean
  has_system_audio: boolean
  capture_source: CaptureSource
  duration_ms: number
  width: number
  height: number
  fps: number
  mime_type: string
  size_bytes: number
  title: string
  recovered?: boolean
  ended_reason?: RecordingEndedReason
  consent: { recording_upload: string }
}
export type UploadInfo = {
  provider: string
  bucket: string
  path: string
  signed_url: string
  token: string
  expires_in: number
  chunk_size: number
}
export type Quota = {
  used_bytes: number
  limit_bytes: number
  count: number
  count_limit: number
}
export type RecordingSummary = {
  id: string
  title: string
  status: RecordingStatus
  layout: RecordingLayout
  visibility: RecordingVisibility
  twister: TwisterRef
  duration_ms: number | null
  size_bytes: number | null
  mime_type: string
  created_at: string
  expires_at: string | null
  thumbnail_url?: string | null
  failure_reason?: string | null
}
export type CreateRecordingResult = {
  recording: RecordingSummary
  /** `null` when nothing is left to upload (a replay after the object was stored). */
  upload: UploadInfo | null
  quota: Quota
}
export type RecordingWord = {
  target_index: number
  target: string
  status: WordStatus
  start_ms: number | null
  end_ms: number | null
}
/** Cloud analysis of a saved take (`POST /recordings/{id}/analyse/`); a missing block means `none`. */
export type AnalysisStatus = 'none' | 'queued' | 'running' | 'ready' | 'failed'
export type Analysis = { status: AnalysisStatus; audio_ready: boolean }
/** `alignment` = the worker built the VTT from the attempt's word timings. */
export type CaptionsSource = 'alignment'
export type Playback = { url: string; expires_at: string; mime: string }
export type RecordingDetail = RecordingSummary & {
  notes: string
  attempt: { id: number; score: number; accuracy: number; wpm: number } | null
  words: RecordingWord[]
  playback: Playback | null
  captions_url: string | null
  captions_source?: CaptionsSource | null
  analysis?: Analysis
}
export type RecordingPatch = Partial<{
  title: string
  visibility: RecordingVisibility
  notes: string
  expires_at: string
  attempt: number
}>
export type StorageInfo = Quota & {
  expiring_soon: { id: string; title: string; expires_at: string }[]
}
export type ConsentRecord = {
  type: ConsentType
  version: string
  granted_at: string
  revoked_at: string | null
}
export type ShareExpiry = '24h' | '7d' | '30d'
export type ShareCreated = { id: string; url: string; expires_at: string }
export type ShareItem = {
  id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  view_count: number
  last_viewed_at: string | null
}
export type PublicRecording = {
  title: string
  twister: { slug: string; text: string }
  duration_ms: number | null
  score?: number | null
  captions_url?: string | null
  playback: Playback
  owner: { display_name?: string | null }
}
export type ReportReason =
  'abuse' | 'sexual' | 'minor' | 'privacy' | 'spam' | 'other'
export type PlanInfo = {
  code?: string
  /** Plan limits (D1): only the keys the web reads. */
  limits?: Partial<{
    recordings_max: number
    recording_ms_max: number
    storage_bytes_max: number
    retention_days: number
    share_max_days: number
  }>
}

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
  if (res.status === 204) return undefined as T // DELETE endpoints answer 204 with no body
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
  /** Retrying with the same `client_attempt_id` is safe: the server replays the first result. */
  submitAttempt: (body: SubmitAttemptBody) =>
    request<AttemptResult | LowConfidenceResult>('/attempts/', {
      method: 'POST',
      headers: { 'Idempotency-Key': body.client_attempt_id },
      body: JSON.stringify(body),
    }),
  syncAttempts: (attempts: SubmitAttemptBody[]) =>
    request<AttemptSyncResult>('/attempts/sync/', {
      method: 'POST',
      body: JSON.stringify({ attempts }),
    }),
  weakWords: (params: { due?: boolean; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.due) qs.set('due', '1')
    if (params.limit) qs.set('limit', String(params.limit))
    return request<{ results: WeakWord[] }>(`/me/words/weak/?${qs}`).then(
      (r) => r.results,
    )
  },
  weakSounds: (limit?: number) =>
    request<{ results: WeakSound[] }>(
      `/me/sounds/${limit ? `?limit=${limit}` : ''}`,
    ).then((r) => r.results),
  attemptDetail: (id: number) => request<AttemptDetail>(`/attempts/${id}/`),
  wordFeedback: (attemptId: number, index: number, body: WordFeedback) =>
    request<WordFeedback>(`/attempts/${attemptId}/words/${index}/feedback/`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: () => request<Profile>('/me/'),
  setAgeBand: (age_band: Exclude<AgeBand, 'unknown'>) =>
    request<Profile>('/me/', {
      method: 'PATCH',
      body: JSON.stringify({ age_band }),
    }),
  setPublicName: (public_name: string) =>
    request<Profile>('/me/', {
      method: 'PATCH',
      body: JSON.stringify({ public_name }),
    }),
  entitlements: () => request<{ plan: PlanInfo }>('/me/entitlements/'),
  consents: () =>
    request<{ results: ConsentRecord[] }>('/me/consents/').then(
      (r) => r.results,
    ),
  grantConsent: (type: ConsentType, version: string) =>
    request<ConsentRecord>('/me/consents/', {
      method: 'POST',
      body: JSON.stringify({ type, version }),
    }),
  storage: () => request<StorageInfo>('/me/storage/'),
  /** Retrying with the same `client_recording_id` replays the first response (fresh upload token included). */
  createRecording: (body: CreateRecordingBody) =>
    request<CreateRecordingResult>('/recordings/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  completeRecording: (
    id: string,
    body: {
      size_bytes: number
      checksum_sha256?: string
      thumbnail?: string | null
    },
  ) =>
    request<RecordingSummary>(`/recordings/${id}/complete/`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  recordings: (params: { twister?: string; page?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.twister) qs.set('twister', params.twister)
    if (params.page) qs.set('page', String(params.page))
    return request<Page<RecordingSummary>>(`/recordings/?${qs}`)
  },
  recording: (id: string) => request<RecordingDetail>(`/recordings/${id}/`),
  analyseRecording: (id: string) =>
    request<{ analysis: Analysis }>(`/recordings/${id}/analyse/`, {
      method: 'POST',
    }),
  updateRecording: (id: string, patch: RecordingPatch) =>
    request<RecordingDetail>(`/recordings/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteRecording: (id: string) =>
    request<void>(`/recordings/${id}/`, { method: 'DELETE' }),
  restoreRecording: (id: string) =>
    request<RecordingSummary>(`/recordings/${id}/restore/`, { method: 'POST' }),
  shareRecording: (id: string, expires_in: ShareExpiry) =>
    request<ShareCreated>(`/recordings/${id}/share/`, {
      method: 'POST',
      body: JSON.stringify({ expires_in }),
    }),
  shares: (recording: string) =>
    request<Page<ShareItem> | ShareItem[]>(
      `/shares/?recording=${encodeURIComponent(recording)}`,
    ).then((r) => (Array.isArray(r) ? r : r.results)),
  revokeShare: (id: string) =>
    request<void>(`/shares/${id}/`, { method: 'DELETE' }),
  publicRecording: (token: string) =>
    request<PublicRecording>(`/public/r/${encodeURIComponent(token)}/`),
  reportRecording: (
    token: string,
    body: { reason: ReportReason; details: string },
  ) =>
    request<void>(`/public/r/${encodeURIComponent(token)}/report/`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
