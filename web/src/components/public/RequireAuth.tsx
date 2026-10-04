import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { useAudience } from '#/lib/public/audience'
import { useGate } from '#/lib/gate/useGate'
import type { GateIntent } from '#/lib/gate/intent'

/** Wraps a members-only page: guests see a short explanation and the sign-in sheet, never a blank screen. */
export default function RequireAuth({
  intent = 'locked_nav',
  title,
  children,
}: {
  intent?: GateIntent
  title: string
  children: ReactNode
}) {
  const { session, loading } = useAuth()
  const audience = useAudience()
  const here = useRouterState({ select: (s) => s.location.href })
  const { request } = useGate()
  const guest = !session && !loading
  useEffect(() => {
    if (guest) request({ intent, returnTo: here })
    // Open once per visit to the page, not on every render.
  }, [guest])
  if (session) return <>{children}</>
  if (audience === 'pending' || loading)
    return <div className="h-64" aria-busy aria-label="Loading" />
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="font-display text-3xl font-extrabold">{title}</h1>
      <p className="mt-3 text-muted-foreground">
        This part of Twister is for signed-in members.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button asChild>
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">See what Twister is</Link>
        </Button>
      </div>
    </div>
  )
}
