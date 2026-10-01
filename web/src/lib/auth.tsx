import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  getSupabase,
  mayHaveSession,
  onSupabaseReady,
  supabaseConfigured,
} from './supabase'

type AuthCtx = { session: Session | null; loading: boolean; enabled: boolean }
const Ctx = createContext<AuthCtx>({
  session: null,
  loading: false,
  enabled: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  // Same on the server and in the first client render; settled in the effect below.
  const [loading, setLoading] = useState(supabaseConfigured)
  useEffect(() => {
    if (!supabaseConfigured) return
    let live = true
    let unsubscribe: (() => void) | undefined
    // Follow the session as soon as the client exists, whoever loaded it (a restore below, or the sign-in form).
    const stopWaiting = onSupabaseReady((client) => {
      if (unsubscribe) return
      void client.auth.getSession().then(({ data }) => {
        if (!live) return
        setSession(data.session)
        setLoading(false)
      })
      const { data } = client.auth.onAuthStateChange((_e, s) => {
        if (live) setSession(s)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    })
    // Guests (nothing stored) never download supabase-js just to learn they are signed out.
    if (mayHaveSession())
      void getSupabase().catch(() => live && setLoading(false))
    else setLoading(false)
    return () => {
      live = false
      stopWaiting()
      unsubscribe?.()
    }
  }, [])
  return (
    <Ctx.Provider value={{ session, loading, enabled: supabaseConfigured }}>
      {children}
    </Ctx.Provider>
  )
}
export const useAuth = () => useContext(Ctx)
