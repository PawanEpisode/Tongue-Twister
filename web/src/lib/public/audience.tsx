import { createContext, useContext, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'
import { writeMemberHint } from './hint'

/**
 * Who is looking, as far as rendering is concerned.
 * - `member`   a session exists
 * - `pending`  a returning member whose session is still being restored (show a skeleton, never marketing)
 * - `guest`    everyone else (the landing page, teaser and gates)
 */
export type Audience = 'member' | 'pending' | 'guest'

const HintCtx = createContext(false)

export function AudienceProvider({
  memberHint,
  children,
}: {
  memberHint: boolean
  children: ReactNode
}) {
  return <HintCtx.Provider value={memberHint}>{children}</HintCtx.Provider>
}

export function useAudience(): Audience {
  const { session, loading } = useAuth()
  const hint = useContext(HintCtx)
  if (session) return 'member'
  return loading && hint ? 'pending' : 'guest'
}

/** True when the signed-out public experience is on (the `public_site` kill switch). */
export const usePublicSite = () => useFlag('public_site')

/** Keeps the `tw_m` hint cookie in step with the session. Renders nothing. */
export function MemberHintSync() {
  const { session, loading } = useAuth()
  useEffect(() => {
    if (session) writeMemberHint(true)
    else if (!loading) writeMemberHint(false)
  }, [session, loading])
  return null
}
