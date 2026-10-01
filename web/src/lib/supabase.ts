import type { SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** A value still wrapped in <…> was copied straight from .env.example. */
const real = (v?: string): v is string => !!v && !v.includes('<')

/** False when env is missing → app runs in guest-only mode. */
export const supabaseConfigured =
  real(url) && url.startsWith('http') && real(key)

/**
 * supabase-js (auth, realtime, storage, postgrest: ~50 KB gzip) is only imported when it is needed, so a
 * guest never downloads it. It is needed when there may be a session to restore (`mayHaveSession`), or
 * when someone signs in or out.
 */
let loaded: SupabaseClient | null = null
let loading: Promise<SupabaseClient | null> | undefined
const readyListeners = new Set<(client: SupabaseClient) => void>()

/** The one client, created on first use; null in guest-only mode. A failed download is retried next call. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured) return Promise.resolve(null)
  loading ??= import('@supabase/supabase-js')
    .then(({ createClient }) => {
      loaded = createClient(url!, key!, {
        auth: { flowType: 'pkce', detectSessionInUrl: true },
      })
      readyListeners.forEach((fn) => fn(loaded!))
      return loaded
    })
    .catch((err: unknown) => {
      loading = undefined
      throw err
    })
  return loading
}

/** Calls `fn` with the client now if it exists, otherwise as soon as something loads it. Returns an unsubscribe. */
export function onSupabaseReady(fn: (client: SupabaseClient) => void) {
  if (loaded) fn(loaded)
  readyListeners.add(fn)
  return () => void readyListeners.delete(fn)
}

/** supabase-js keeps its session (and a PKCE verifier mid sign-in) under `sb-<project>-auth-token…`. */
const STORAGE_KEY = /^sb-.+-auth-token/
/** Sign-in redirects land with `?code=` (PKCE), `#access_token=` or an error. */
const AUTH_URL_PARAM = /[?&#](code|access_token|error_description)=/

/** True when a session may exist to restore (or a sign-in is mid-flight), so the client is worth loading. */
export function mayHaveSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (AUTH_URL_PARAM.test(window.location.search + window.location.hash))
      return true
    return Object.keys(window.localStorage).some((k) => STORAGE_KEY.test(k))
  } catch {
    return false // storage blocked: no session can be stored either
  }
}

/** The signed-in user's API token, or null for guests (who never load supabase-js just to find that out). */
export async function getAccessToken(): Promise<string | null> {
  if (!loaded && !mayHaveSession()) return null
  const client = await getSupabase().catch(() => null)
  const { data } = (await client?.auth.getSession()) ?? {
    data: { session: null },
  }
  return data.session?.access_token ?? null
}

export async function signOut(): Promise<void> {
  await (await getSupabase())?.auth.signOut()
}
