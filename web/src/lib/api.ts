import { getAccessToken } from './supabase'
import type { DeviceWordBody } from './speak/engine/runtime/attemptBody'

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
  /** Per-twister progress for the signed-in caller; null for guests. */
  mastery: MasteryState | null
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
/** Which avatar to show: the sign-in provider's photo, or the chosen emoji. */
export type AvatarSource = 'photo' | 'emoji'
export type Profile = {
  id: string
  email: string
  display_name: string
  avatar_emoji: string
  avatar_source?: AvatarSource
  xp: number
  level: number
  current_streak: number
  best_streak: number
  total_attempts?: number
  best_score?: number | null
  age_band?: AgeBand
  /** Opt-in name shown on recordings you share; blank = anonymous. Never falls back to `display_name`. */
  public_name?: string
  /** IANA zone used for streak days; `UTC` until the browser's zone has been synced. */
  timezone?: string
  /** Opt out of public leaderboards (D18). */
  hide_from_boards?: boolean
  streak_freezes?: number
  /** Streak days end at 03:00 local instead of midnight (D23). */
  night_owl?: boolean
  /** Set while the account waits out its grace period before purge (D21); null/absent otherwise. */
  deletion_scheduled_for?: string | null
}
/** The writable part of `PATCH /me/` that the settings page touches. */
export type ProfilePatch = Partial<
  Pick<
    Profile,
    | 'timezone'
    | 'hide_from_boards'
    | 'night_owl'
    | 'public_name'
    | 'display_name'
    | 'avatar_emoji'
    | 'avatar_source'
  >
>
/** `DELETE /me/` → 202: when the request was made and when the purge becomes due. */
export type DeletionRequest = {
  deletion_requested_at: string
  deletion_scheduled_for: string
}
/** The account export: the file plus the raw `Content-Disposition` header, which names it. */
export type DataExport = { blob: Blob; contentDisposition: string | null }
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
  /** Set when the server wants this attempt's audio re-scored (D34); null/absent otherwise. */
  spot_check?: { requested: boolean; expires_at: string | null }
  achievements_unlocked: UnlockedAchievement[]
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
  /** Accurate mode (docs/features/10 section 5): word verdicts from the on-device engine. */
  engine?: 'text_layer' | 'ondevice'
  engine_version?: string
  model_version?: string
  scoring_profile?: string
  nonce?: string
  audio_sha256?: string
  quality?: Record<string, number | boolean>
  words?: DeviceWordBody[]
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
/** A word passed in a drill and not slipped on since. */
export type NailedWord = {
  word: string
  respelling: string
  mastered_at: string
  seen: number
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
/** `''` = never chosen on any device, so the first device seeds it. */
export type ThemeSetting = '' | 'system' | 'light' | 'dark' | 'reading'
export type Preferences = {
  theme: ThemeSetting
  /** Celebrate good results with confetti. */
  confetti: boolean
  /** Attempts to aim for each day; 0 = no goal. */
  daily_goal_attempts: number
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
export type SessionResult = {
  id: string
  xp_awarded: number
  profile: Profile
  achievements_unlocked?: UnlockedAchievement[]
}
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
/** A page of a list; `count` is the whole list, not just this page. */
/** One row of `GET /attempts/` (the caller's history, newest first). */
export type AttemptRow = {
  id: number
  twister: string
  kind: AttemptKind
  score: number
  accuracy: number
  wpm: number
  xp_awarded: number
  is_personal_best: boolean
  created_at: string
}
export type Page<T> = { count: number; results: T[] }

// ─── Progress, mastery, achievements, stats and discovery (docs/features/14-06d-build-spec.md §4) ───

export type MasteryState = 'new' | 'practising' | 'almost' | 'mastered'
export type AchievementTier = 'bronze' | 'silver' | 'gold'
export type AchievementCategory =
  'start' | 'streak' | 'mastery' | 'skill' | 'explore'
/** An achievement as announced by an attempt/session response. `icon` is a lucide icon name. */
export type UnlockedAchievement = {
  code: string
  name: string
  description: string
  icon: string
  tier: AchievementTier
  xp_reward: number
}
export type AchievementView = UnlockedAchievement & {
  category: AchievementCategory
  unlocked_at: string | null
  /** Fraction 0–1 for counter-shaped rules, null for event-shaped and secret ones. */
  progress: number | null
  seen: boolean
}
export type Summary = {
  mastered: number
  total: number
  current_streak: number
  best_streak: number
  streak_at_risk: boolean
  streak_freezes: number
  next_streak_milestone: number | null
  practised_today: boolean
  achievements: { unlocked: number; total: number }
  xp: number
  level: number
  xp_in_level: number
  xp_for_next_level: number
  timezone: string
  /** The caller's local date, `YYYY-MM-DD`. */
  today: string
  unseen_achievements: (UnlockedAchievement & { unlocked_at: string })[]
  /** Absent from an API that predates the goal. */
  daily_goal?: DailyGoal
}
/** Today's progress towards the optional attempts goal; `target` 0 means no goal is set. */
export type DailyGoal = { target: number; done: number; met: boolean }
export type TimelineKind =
  | 'level_up'
  | 'achievement'
  | 'streak_milestone'
  | 'twister_mastered'
  | 'personal_best'
export type TimelineEvent = {
  id: number
  kind: TimelineKind
  data: Record<string, unknown>
  created_at: string
}
export type AchievementsPayload = {
  unlocked: number
  total: number
  results: AchievementView[]
}
export type StatsRange = '7d' | '30d' | '90d' | 'all'
export type StatsMode = 'speak_score' | 'read_along' | 'record'
export type Stats = {
  range: StatsRange
  mode: StatsMode | null
  from: string
  to: string
  kpis: {
    attempts: number
    practice_ms: number
    avg_score: number | null
    best_streak: number
    mastered: number
    xp: number
    level: number
  }
  score_series: { date: string; avg: number; rolling: number; count: number }[]
  speed_series: { date: string; avg_wpm: number }[]
  attempts_by_day: { date: string; attempts: number; active_ms: number }[]
  category_accuracy: {
    category: string
    name: string
    avg_accuracy: number
    attempts: number
  }[]
  weak_words: (Pick<WeakWord, 'word' | 'miss_rate' | 'seen'> & {
    drill: DrillTarget | null
  })[]
}
export type ActivityDay = {
  date: string
  attempts: number
  active_ms: number
  read_along_ms: number
  qualifies_streak: boolean
  freeze_used: boolean
}
export type Activity = { from: string; to: string; days: ActivityDay[] }
export type Facets = {
  total: number
  levels: Record<string, number>
  categories: Record<string, number>
  origins: Record<string, number>
}
export type BrowseStatus =
  'mastered' | 'in_progress' | 'not_started' | 'favorites'
export type BrowseSort =
  | 'recommended'
  | 'newest'
  | 'shortest'
  | 'longest'
  | 'hardest'
  | 'easiest'
  | 'best_desc'
  | 'best_asc'
export type DailyPayload = {
  day: string
  source: 'auto' | 'editorial'
  twister: Twister
}
export type WeeklyBoard = {
  week_start: string
  week_end: string
  twister: { slug: string; text: string }
  top: {
    rank: number
    name: string
    emoji: string
    score: number
    achieved_at: string
    is_me: boolean
  }[]
  me: { rank: number; score: number } | null
  /** The viewer opted out of boards. */
  hidden: boolean
  updated_at: string | null
}
/** Filters the list, facets and random endpoints share. */
export type TwisterFilters = Partial<
  Record<'difficulty' | 'category' | 'origin' | 'search', string>
>

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
/** Server-side scoring of the take's audio into an attempt (A5). Missing on an older API = `none`. */
export type ScoringStatus =
  'none' | 'queued' | 'running' | 'scored' | 'unscorable' | 'failed'
export type AnalysisScoring = { status: ScoringStatus; reason: string }
export type Analysis = {
  status: AnalysisStatus
  audio_ready: boolean
  scoring?: AnalysisScoring
}
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
/** `GET /public/s/{token}/`: one attempt's result. No media; the owner is only the opt-in public name. */
export type ScoreCardPublic = {
  score: number
  accuracy: number
  wpm: number
  kind: AttemptKind
  twister: { slug: string; text: string }
  words: { target: string; status: WordStatus }[]
  created_at: string
  /** Absolute URLs of the rendered card; omitted when the API has no public URL configured. */
  images?: { og: string; square: string }
  owner?: { display_name?: string | null }
}
/** `POST /attempts/{id}/score-card/` → 201. */
export type ScoreCardLink = { id: number; url: string; expires_at: string }
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

/** GET /engine/manifest/ (raw; parsed defensively by speak/engine/runtime/manifest.ts). */
export type EngineManifestResponse = {
  model: {
    name: string
    base_model: string
    licence: string
    quantization: string
    size_bytes: number
    sha256: string
    url: string
    label_map_version: string
  } | null
  scoring_profile: {
    code: string
    thresholds: Record<string, unknown>
    accent_packs: string[]
    confusion_map: unknown
  } | null
  lexicon_version: number
  score_version: number
}
export type AccentLang = 'en-US' | 'en-GB' | 'en-IN' | 'en-AU'
/** GET /twisters/{slug}/pronunciations/: what the on-device engine needs to score a read of this twister. */
export type Pronunciations = {
  slug: string
  lang: AccentLang
  scoring_profile: string | null
  focus: string[]
  difficulty: number
  words: { text: string; variants: string[][] }[]
}
export type VoiceClipGrant = {
  voice_asset_id: string
  status: string
  expires_at: string
  upload: UploadInfo
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

/** An authenticated call to the API; anything but 2xx becomes an `ApiError`. */
async function authedFetch(
  path: string,
  init: RequestInit = {},
  json = true,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (json) headers.set('Content-Type', 'application/json')
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, init)
  if (res.status === 204) return undefined as T // DELETE endpoints answer 204 with no body
  return res.json() as Promise<T>
}

/** A file download: the body as a Blob plus the name the server suggested. */
async function download(path: string): Promise<DataExport> {
  const res = await authedFetch(path, {}, false)
  return {
    blob: await res.blob(),
    contentDisposition: res.headers.get('Content-Disposition'),
  }
}

/** Query string from the defined, non-empty values. */
function query(params: Record<string, string | undefined>): string {
  return new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString()
}

/** One PATCH for every profile setting; callers pass only what changed. */
const updateProfile = (patch: ProfilePatch) =>
  request<Profile>('/me/', { method: 'PATCH', body: JSON.stringify(patch) })

export const api = {
  categories: () => request<Category[]>('/categories/'),
  twisters: (
    params: TwisterFilters & {
      status?: BrowseStatus
      sort?: BrowseSort
      page?: string
    } = {},
  ) => request<Page<Twister>>(`/twisters/?${query(params)}`),
  twister: (slug: string) => request<Twister>(`/twisters/${slug}/`),
  facets: (filters: TwisterFilters = {}) =>
    request<Facets>(`/twisters/facets/?${query(filters)}`),
  /** `exclude`: slugs to skip (the API caps them; callers trim). 404 when nothing is left. */
  randomTwister: (filters: TwisterFilters = {}, exclude: string[] = []) =>
    request<Twister>(
      `/twisters/random/?${query({ ...filters, exclude: exclude.join(',') })}`,
    ),
  /** Today's twister (UTC). Reads `/daily/` and unwraps it so existing callers keep a bare Twister. */
  daily: () => request<DailyPayload>('/daily/').then((r) => r.twister),
  summary: () => request<Summary>('/me/summary/'),
  achievements: () => request<AchievementsPayload>('/me/achievements/'),
  markAchievementsSeen: (codes?: string[]) =>
    request<{ marked: number }>('/me/achievements/seen/', {
      method: 'POST',
      body: JSON.stringify(codes ? { codes } : {}),
    }),
  stats: (range: StatsRange, mode?: StatsMode) =>
    request<Stats>(`/me/stats/?${query({ range, mode })}`),
  activity: (weeks = 12) => request<Activity>(`/me/activity/?weeks=${weeks}`),
  timeline: (page = 1) =>
    request<Page<TimelineEvent>>(`/me/timeline/?page=${page}`),
  recentAttempts: (page = 1) =>
    request<Page<AttemptRow>>(`/attempts/?page=${page}`),
  favorites: (page = 1) =>
    request<Page<Twister>>(`/me/favorites/?page=${page}`),
  /** Explicit target state, so a double tap or a retry can never flip it the wrong way. */
  setFavorite: (slug: string, on: boolean) =>
    request<{ is_favorite: boolean }>(`/me/favorites/${slug}/`, {
      method: on ? 'PUT' : 'DELETE',
    }),
  weeklyBoard: (twister?: string) =>
    request<WeeklyBoard>(`/leaderboard/weekly/?${query({ twister })}`),
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
  weakWords: (
    params: { due?: boolean; limit?: number; offset?: number } = {},
  ) => {
    const qs = new URLSearchParams()
    if (params.due) qs.set('due', '1')
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.offset) qs.set('offset', String(params.offset))
    return request<Page<WeakWord>>(`/me/words/weak/?${qs}`)
  },
  nailedWords: (params: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.offset) qs.set('offset', String(params.offset))
    return request<Page<NailedWord>>(`/me/words/nailed/?${qs}`)
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
  updateProfile,
  setTimezone: (timezone: string) => updateProfile({ timezone }),
  setHideFromBoards: (hide_from_boards: boolean) =>
    updateProfile({ hide_from_boards }),
  setNightOwl: (night_owl: boolean) => updateProfile({ night_owl }),
  setPublicName: (public_name: string) => updateProfile({ public_name }),
  /** Starts the grace period (D21). Idempotent while pending: the same dates come back. */
  requestDeletion: () =>
    request<DeletionRequest>('/me/', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'DELETE' }),
    }),
  cancelDeletion: () => request<void>('/me/deletion/', { method: 'DELETE' }),
  exportData: () => download('/me/export/'),
  exportAttemptsCsv: () => download('/me/export/attempts.csv'),
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
  createScoreCard: (attemptId: number) =>
    request<ScoreCardLink>(`/attempts/${attemptId}/score-card/`, {
      method: 'POST',
    }),
  publicScoreCard: (token: string, signal?: AbortSignal) =>
    request<ScoreCardPublic>(`/public/s/${encodeURIComponent(token)}/`, {
      signal,
    }),
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
  engineManifest: () => request<EngineManifestResponse>('/engine/manifest/'),
  pronunciations: (slug: string, lang: AccentLang) =>
    request<Pronunciations>(
      `/twisters/${slug}/pronunciations/?${query({ lang })}`,
    ),
  /** Step 1 of sending the audio the server asked to verify (D34): a signed upload for a short voice clip. */
  createSpotCheckClip: (body: {
    attempt: number
    size_bytes: number
    duration_ms: number
  }) =>
    request<VoiceClipGrant>('/voice/', {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        mime_type: 'audio/wav',
        purpose: 'spot_check',
      }),
    }),
  completeVoiceClip: (id: string, checksum_sha256: string) =>
    request<{ voice_asset_id: string; status: string }>(
      `/voice/${id}/complete/`,
      { method: 'POST', body: JSON.stringify({ checksum_sha256 }) },
    ),
  /** Step 3: attaching the finished clip is what queues the re-score. Idempotent. */
  attachSpotCheck: (attemptId: number, voice_asset_id: string) =>
    request<unknown>(`/attempts/${attemptId}/spot-check-audio/`, {
      method: 'POST',
      body: JSON.stringify({ voice_asset_id }),
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
