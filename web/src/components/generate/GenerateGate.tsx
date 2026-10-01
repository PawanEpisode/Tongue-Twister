import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { useGenerateEnabled } from '#/lib/generate/hooks'

/** Shared gate for the generate routes: flag off, signed out, or render the page. */
export default function GenerateGate({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const { session, loading } = useAuth()
  const enabled = useGenerateEnabled()
  const here = useRouterState({ select: (s) => s.location.href })
  if (loading) return null
  if (!enabled)
    return (
      <p className="py-16 text-center text-muted-foreground">
        Making your own twisters isn’t available yet.
      </p>
    )
  if (!session)
    return (
      <div className="glass mx-auto mt-10 max-w-md rounded-2xl p-8 text-center">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to make and keep your own twisters.
        </p>
        <Button asChild className="mt-4">
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
      </div>
    )
  return <>{children}</>
}
