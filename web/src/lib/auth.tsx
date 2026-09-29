import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'

type AuthCtx = { session: Session | null; loading: boolean; enabled: boolean }
const Ctx = createContext<AuthCtx>({
  session: null,
  loading: false,
  enabled: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!supabase)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return (
    <Ctx.Provider value={{ session, loading, enabled: !!supabase }}>
      {children}
    </Ctx.Provider>
  )
}
export const useAuth = () => useContext(Ctx)
