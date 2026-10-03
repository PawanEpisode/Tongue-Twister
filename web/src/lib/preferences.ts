import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { Preferences } from './api'
import { useAuth } from './auth'

/** Mirrors api/twisters/models.py::PREFERENCE_RANGES — keep in sync (the API is the authority). */
export const PREFERENCE_RANGES = {
  wpm: [40, 300],
  threshold_pct: [20, 60],
  font_scale: [0.8, 2],
  loop_count: [0, 10],
  countdown_s: [0, 5],
  tts_rate: [0.5, 1.5],
  metronome_volume: [0, 1],
  daily_goal_attempts: [0, 50],
} as const

export const DEFAULT_PREFERENCES: Preferences = {
  theme: '',
  confetti: true,
  daily_goal_attempts: 0,
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
}

const STORAGE_KEY = 'twister.prefs.v1'
const FLUSH_DELAY_MS = 400

type Stored = { values: Partial<Preferences>; pending: Partial<Preferences> }
export type SyncState = 'local' | 'synced' | 'error'

function readStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch {
    /* storage blocked or corrupt — start clean */
  }
  return { values: {}, pending: {} }
}

function writeStored(stored: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    /* private mode / quota — settings still work for this visit */
  }
}

/**
 * Settings that follow the user. Local-first: they apply instantly and persist in localStorage,
 * so the page never waits on (or breaks because of) the network. Signed in, changes are also
 * PATCHed to the API (debounced); changes made as a guest or offline stay in `pending` and are
 * merged into the account on the next successful sync — the server value wins for anything untouched.
 */
function usePreferencesState() {
  const { session } = useAuth()
  const signedIn = !!session
  const [values, setValues] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [sync, setSync] = useState<SyncState>('local')
  const [ready, setReady] = useState(false)
  /** True once the account's settings have been fetched (always false for guests). */
  const [loaded, setLoaded] = useState(false)
  const stored = useRef<Stored>({ values: {}, pending: {} })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const persist = useCallback((next: Stored) => {
    stored.current = next
    writeStored(next)
  }, [])

  const flush = useCallback(async () => {
    const sending = stored.current.pending
    if (!Object.keys(sending).length) return setSync('synced')
    try {
      const server = await api.updatePreferences(sending)
      // Drop only what we sent; edits made while the request was in flight stay pending.
      const pending = Object.fromEntries(
        Object.entries(stored.current.pending).filter(
          ([k, v]) =>
            JSON.stringify(sending[k as keyof Preferences]) !==
            JSON.stringify(v),
        ),
      )
      persist({ values: { ...stored.current.values, ...server }, pending })
      setSync('synced')
    } catch {
      setSync('error') // non-blocking chip; retried on the next change or sign-in
    }
  }, [persist])

  // Hydrate from localStorage after mount (keeps SSR markup identical to the first client render).
  useEffect(() => {
    stored.current = readStored()
    setValues({ ...DEFAULT_PREFERENCES, ...stored.current.values })
    setReady(true)
  }, [])

  // On sign-in: adopt the account's settings, then push anything still pending (guest → account merge).
  useEffect(() => {
    if (!signedIn) {
      setLoaded(false)
      return setSync('local')
    }
    let cancelled = false
    api
      .preferences()
      .then((server) => {
        if (cancelled) return
        const merged = { ...server, ...stored.current.pending }
        persist({ values: merged, pending: stored.current.pending })
        setValues({ ...DEFAULT_PREFERENCES, ...merged })
        setLoaded(true)
        void flush()
      })
      .catch(() => !cancelled && setSync('error'))
    return () => {
      cancelled = true
    }
  }, [signedIn, persist, flush])

  useEffect(() => () => clearTimeout(timer.current), [])

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setValues((v) => ({ ...v, ...patch }))
      persist({
        values: { ...stored.current.values, ...patch },
        pending: { ...stored.current.pending, ...patch },
      })
      if (!signedIn) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS)
    },
    [persist, flush, signedIn],
  )

  /** Try again after a failed sync: re-fetch the account's settings (first load) or re-send pending edits. */
  const retry = useCallback(() => {
    setSync('local')
    void flush()
  }, [flush])

  return { prefs: values, update, sync, ready, loaded, retry }
}

export type PreferencesValue = ReturnType<typeof usePreferencesState>

const PreferencesContext = createContext<PreferencesValue | null>(null)

/** One source of truth for settings, so every screen (practice, twister, settings hub) stays in step. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const value = usePreferencesState()
  return createElement(PreferencesContext.Provider, { value }, children)
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value)
    throw new Error('usePreferences must be used within PreferencesProvider')
  return value
}

/**
 * Whether to fire confetti: the "Celebrations" setting, and never when the person asked for reduced motion.
 * Safe outside the provider (isolated renders and tests) — celebrations are then simply on.
 */
export function useCelebrations(): boolean {
  const value = useContext(PreferencesContext)
  return value ? value.prefs.confetti && !value.prefs.reduce_motion : true
}
