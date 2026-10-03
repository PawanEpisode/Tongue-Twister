import { useEffect, useRef } from 'react'
import { usePreferences } from '#/lib/preferences'
import { THEME_STORAGE_KEY, useTheme } from '#/lib/theme'
import { decideThemeSync } from '#/lib/themeSync'

function hasExplicitLocalTheme(): boolean {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/** Renders nothing. Keeps the theme in step across devices: reconcile once per sign-in, then mirror changes. */
export default function ThemeSync() {
  const { preference, setPreference } = useTheme()
  const { prefs, update, loaded } = usePreferences()
  const reconciled = useRef(false)

  useEffect(() => {
    if (!loaded) {
      reconciled.current = false
      return
    }
    if (!reconciled.current) {
      reconciled.current = true
      const decision = decideThemeSync({
        server: prefs.theme,
        local: preference,
        localExplicit: hasExplicitLocalTheme(),
      })
      if (decision.kind === 'adopt') setPreference(decision.theme)
      if (decision.kind === 'push') update({ theme: decision.theme })
      return
    }
    if (preference !== prefs.theme) update({ theme: preference })
  }, [loaded, preference, prefs.theme, setPreference, update])

  return null
}
