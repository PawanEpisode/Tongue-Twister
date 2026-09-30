import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'

export const THEME_STORAGE_KEY = 'twister-theme'

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

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
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

/** Runs in <head> before paint. Default is dark, matching the original look. */
export const themeBootScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k)||'dark';if(p!=='light'&&p!=='dark'&&p!=='reading'&&p!=='system')p='dark';var t=p==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):p;document.documentElement.dataset.theme=t;}catch(e){}})();`

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
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setResolved(applyTheme('system'))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
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
