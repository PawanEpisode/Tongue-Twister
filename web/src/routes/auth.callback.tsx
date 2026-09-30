import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { seo } from '#/lib/seo'
import { useAuth } from '#/lib/auth'
import { returnTo } from '#/lib/returnTo'

export const Route = createFileRoute('/auth/callback')({
  head: () =>
    seo({
      title: 'Signing in… | Twister',
      path: '/auth/callback',
      noindex: true,
    }),
  component: Callback,
})

/** OAuth lands here (?code=…). supabase-js exchanges the code and cleans the URL; we then move on. */
function Callback() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  useEffect(() => {
    if (!loading && session) void nav({ href: returnTo.take(), replace: true })
  }, [loading, session, nav])

  if (!loading && !session)
    return (
      <div className="mx-auto mt-16 max-w-sm text-center">
        <p className="text-pink">Sign-in didn’t complete.</p>
        <Link to="/login" className="mt-3 inline-block underline">
          Try again
        </Link>
      </div>
    )
  return (
    <p className="mt-16 text-center text-muted-foreground">Signing you in…</p>
  )
}
