import type {
  Category,
  DailyPayload,
  Facets,
  FeatureFlags,
  Preferences,
  ScoreCardPublic,
  Twister,
} from '../../src/lib/api'

/**
 * Realistic API payloads for guest sessions. Typed with `satisfies` against the app's own API types, so a
 * changed field fails `tsc` here instead of silently drifting from what the pages expect.
 */
const make = (t: Omit<Twister, 'is_favorite' | 'best_score' | 'mastery'>) =>
  ({
    ...t,
    is_favorite: false,
    best_score: null,
    mastery: null,
  }) satisfies Twister

export const CATEGORIES = [
  {
    slug: 'hissers',
    name: 'Hissers',
    emoji: '🐍',
    description: 'S, SH and Z sounds',
    count: 3,
  },
  {
    slug: 'poppers',
    name: 'Poppers',
    emoji: '🍿',
    description: 'P and B sounds',
    count: 2,
  },
  {
    slug: 'rollers',
    name: 'Rollers',
    emoji: '🌪️',
    description: 'R and L sounds',
    count: 2,
  },
] satisfies Category[]

export const TWISTERS: Twister[] = [
  make({
    slug: 'she-sells-seashells',
    text: 'She sells seashells by the seashore.',
    category: 'hissers',
    difficulty: 2,
    difficulty_label: 'Medium',
    origin: 'classic',
    tip: 'Keep the S and SH sounds crisp and separate.',
    focus_sounds: ['s', 'sh'],
    word_count: 6,
  }),
  make({
    slug: 'peter-piper',
    text: 'Peter Piper picked a peck of pickled peppers.',
    category: 'poppers',
    difficulty: 2,
    difficulty_label: 'Medium',
    origin: 'classic',
    tip: 'Let the P pop with a little puff of air.',
    focus_sounds: ['p'],
    word_count: 8,
  }),
  make({
    slug: 'red-lorry-yellow-lorry',
    text: 'Red lorry, yellow lorry.',
    category: 'rollers',
    difficulty: 3,
    difficulty_label: 'Hard',
    origin: 'classic',
    tip: 'Switch cleanly between R and L.',
    focus_sounds: ['r', 'l'],
    word_count: 4,
  }),
  make({
    slug: 'six-slippery-snails',
    text: 'Six slippery snails slid slowly seaward.',
    category: 'hissers',
    difficulty: 1,
    difficulty_label: 'Easy',
    origin: 'modern',
    tip: 'Glide through the S sounds.',
    focus_sounds: ['s'],
    word_count: 6,
  }),
  make({
    slug: 'betty-botter',
    text: 'Betty Botter bought some butter but the butter was bitter.',
    category: 'poppers',
    difficulty: 4,
    difficulty_label: 'Insane',
    origin: 'classic',
    tip: 'Lead with the lips on every B.',
    focus_sounds: ['b'],
    word_count: 10,
  }),
]

export const TWISTER: Twister = TWISTERS[0]

export const FACETS = {
  total: TWISTERS.length,
  levels: { '1': 1, '2': 2, '3': 1, '4': 1 },
  categories: { hissers: 2, poppers: 2, rollers: 1 },
  origins: { classic: 4, modern: 1 },
} satisfies Facets

export const DAILY = {
  day: '2026-10-01',
  source: 'auto',
  twister: TWISTER,
} satisfies DailyPayload

/** What `/flags/` returns for a guest: the shipped features on, cloud saving and sharing off (D7). */
export const FLAGS = {
  practice_hub: true,
  read_along: true,
  speak_v2: true,
  record_local: true,
  record_screen: true,
  record_region: true,
  record_cloud: false,
  share_links: false,
  achievements: true,
  weekly_boards: false,
} satisfies FeatureFlags

export const PREFERENCES = {
  default_mode: 'speak_score',
  display_style: 'word',
  accent_lang: 'en-US',
  wpm: null,
  threshold_pct: 35,
  font_scale: 1,
  loop_count: 1,
  countdown_s: 3,
  mirror_text: false,
  punctuation_pauses: true,
  reduce_motion: false,
  dyslexia_font: false,
  high_contrast: false,
  metronome: false,
  metronome_volume: 0.5,
  listen_first: false,
  tts_voice: '',
  tts_rate: 1,
  speed_ladder: {},
  theme: '',
  confetti: true,
} satisfies Preferences

/** What `GET /public/s/{token}/` returns for the token `SCORE_CARD_TOKEN`. */
export const SCORE_CARD_TOKEN = 'e2e-card'
/** A token the mock API answers 410 for (expired or revoked). */
export const GONE_TOKEN = 'e2e-gone'
export const SCORE_CARD = {
  score: 87,
  accuracy: 0.92,
  wpm: 118,
  kind: 'test',
  twister: { slug: TWISTERS[0].slug, text: TWISTERS[0].text },
  words: [{ target: 'red', status: 'correct' }],
  created_at: '2026-10-01T10:00:00Z',
  owner: { display_name: null },
} satisfies ScoreCardPublic
