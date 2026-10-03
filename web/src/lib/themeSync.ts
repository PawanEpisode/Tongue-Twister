import type { ThemeSetting } from './api'
import { THEME_OPTIONS } from './theme'
import type { ThemePreference } from './theme'

export type ThemeSyncDecision =
  | { kind: 'none' }
  /** Apply the account's theme on this device (local only — it is already saved on the server). */
  | { kind: 'adopt'; theme: ThemePreference }
  /** The account has never chosen a theme; this device's explicit choice seeds it. */
  | { kind: 'push'; theme: ThemePreference }

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option === value)
}

/**
 * First reconcile after sign-in. `server === ''` means "never chosen", so a device that has an explicit
 * choice seeds the account, and a device that never chose anything stays on the default. Otherwise the
 * account wins, which keeps every device on the same theme.
 */
export function decideThemeSync(input: {
  server: ThemeSetting
  local: ThemePreference
  localExplicit: boolean
}): ThemeSyncDecision {
  const { server, local, localExplicit } = input
  if (!isThemePreference(server))
    return localExplicit ? { kind: 'push', theme: local } : { kind: 'none' }
  return server === local ? { kind: 'none' } : { kind: 'adopt', theme: server }
}
