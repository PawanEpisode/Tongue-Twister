import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'

export const THEME_STORAGE_KEY = 'twister-theme'

/** Local-time window for the System preference. Light from 7:00 until 19:00, dark otherwise. */
export const DAY_START_HOUR = 7
export const NIGHT_START_HOUR = 18

export const THEME_OPTIONS = ['system', 'light', 'dark', 'reading'] as const

export type ThemePreference = (typeof THEME_OPTIONS)[number]
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#0b0a16',
  light: '#f6f5fb',
  reading: '#f6f1e4',
}

const ACCENT_VARS = ['--brand', '--pink', '--cyan', '--lime'] as const

function isPreference(value: string | null): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option === value)
}

/** Light during the daytime hours of `date` (the viewer's local timezone). */
export function themeForLocalTime(date = new Date()): 'light' | 'dark' {
  const hour = date.getHours()
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'light' : 'dark'
}

/** Milliseconds until the next 7:00 or 19:00 in the viewer's local timezone. */
export function msUntilNextThemeBoundary(date = new Date()): number {
  const next = new Date(date)
  const hour = date.getHours()
  if (hour < DAY_START_HOUR) {
    next.setHours(DAY_START_HOUR, 0, 0, 0)
  } else if (hour < NIGHT_START_HOUR) {
    next.setHours(NIGHT_START_HOUR, 0, 0, 0)
  } else {
    next.setDate(next.getDate() + 1)
    next.setHours(DAY_START_HOUR, 0, 0, 0)
  }
  return Math.max(1_000, next.getTime() - date.getTime())
}

export function resolveTheme(
  preference: ThemePreference,
  now = new Date(),
): ResolvedTheme {
  if (preference !== 'system') return preference
  return themeForLocalTime(now)
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEME_COLORS[resolved])
  return resolved
}

/** Reads the active accent colors so canvas/confetti stay on the same palette. */
export function readAccentColors(): string[] {
  const style = getComputedStyle(document.documentElement)
  return ACCENT_VARS.map((name) => style.getPropertyValue(name).trim())
}

/** Runs in <head> before paint. Default is dark. System follows the local clock, same as themeForLocalTime. */
export const themeBootScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k)||'dark';if(p!=='light'&&p!=='dark'&&p!=='reading'&&p!=='system')p='dark';var t=p;if(p==='system'){var h=new Date().getHours();t=(h>=${DAY_START_HOUR}&&h<${NIGHT_START_HOUR})?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){}})();`

type ThemeContextValue = {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('dark')
  const [resolved, setResolved] = useState<ResolvedTheme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    const next = isPreference(stored) ? stored : 'dark'
    setPreferenceState(next)
    setResolved(applyTheme(next))
  }, [])

  useEffect(() => {
    if (preference !== 'system') return
    let timer = 0
    const apply = () => {
      window.clearTimeout(timer)
      setResolved(applyTheme('system'))
      timer = window.setTimeout(apply, msUntilNextThemeBoundary())
    }
    apply()
    const onVisible = () => {
      if (document.visibilityState === 'visible') apply()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    localStorage.setItem(THEME_STORAGE_KEY, next)
    setPreferenceState(next)
    setResolved(applyTheme(next))
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
