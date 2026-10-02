import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { FeatureFlags } from './api'
import { useAuth } from './auth'

/** Used until the server answers (or if it never does): shipped features on, everything else off. */
export const DEFAULT_FLAGS: FeatureFlags = {
  practice_hub: true,
  read_along: true,
  speak_v2: true, // scoring v2 ships on; the server flag is the kill switch
  // Record mode (06c): local recording ships on; cloud saving and share links wait for Supabase Pro (D7).
  record_local: true,
  record_screen: true,
  record_region: true,
  record_cloud: false,
  share_links: false,
  // Progress (06d): achievements ship on; the weekly board waits for enough players.
  achievements: true,
  weekly_boards: false,
  // Score cards (D20) store no media, so they ship on; the server flag is the kill switch.
  score_cards: true,
  // Generate Twister (spec 16): off until the server flag is on.
  generate_twister: false,
  // Email reminders (spec 16, D27): off until the server flag is on.
  reminders: false,
  // Accurate mode (docs/features/13): on-device speech engine; off until the server flag is on (A6).
  accurate_mode: false,
}
const STORAGE_KEY = 'twister.flags.v1'
const REFRESH_MS = 60_000

function cached(): FeatureFlags | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw
      ? { ...DEFAULT_FLAGS, ...(JSON.parse(raw) as FeatureFlags) }
      : undefined
  } catch {
    return undefined
  }
}

/** Server-evaluated flags (per user), cached so a slow network never flips the UI back and forth. */
export function useFlags(): FeatureFlags {
  const { session } = useAuth()
  const { data } = useQuery({
    queryKey: ['flags', session?.user.id ?? 'guest'],
    queryFn: async () => {
      const flags = await api.flags()
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flags))
      } catch {
        /* storage blocked — fine, we just refetch next visit */
      }
      return flags
    },
    staleTime: REFRESH_MS,
    retry: 1,
  })
  return (
    data ??
    (typeof window === 'undefined' ? undefined : cached()) ??
    DEFAULT_FLAGS
  )
}

export const useFlag = (code: string) => useFlags()[code] ?? false
