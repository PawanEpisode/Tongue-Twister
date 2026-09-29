import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when env is missing → app runs in guest-only mode. */
export const supabase = url?.startsWith('http') && !url.includes('<') && key ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } }) : null
