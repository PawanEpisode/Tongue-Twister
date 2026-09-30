import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** A value still wrapped in <…> was copied straight from .env.example. */
const real = (v?: string): v is string => !!v && !v.includes('<')

/** null when env is missing → app runs in guest-only mode. */
export const supabase =
  real(url) && url.startsWith('http') && real(key)
    ? createClient(url, key, {
        auth: { flowType: 'pkce', detectSessionInUrl: true },
      })
    : null
