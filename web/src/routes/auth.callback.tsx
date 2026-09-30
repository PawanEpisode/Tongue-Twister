import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
/** Supabase reports failures as ?error_description=… (or in the hash). */
function urlError(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return q.get('error_description') ?? h.get('error_description')
}

function Callback() {
  const [reason] = useState(urlError)
  const { session, loading } = useAuth()
  const nav = useNavigate()
  useEffect(() => {
    if (!loading && session) void nav({ href: returnTo.take(), replace: true })
  }, [loading, session, nav])

  if (!loading && !session)
    return (
      <div className="mx-auto mt-16 max-w-sm text-center">
        <p className="text-pink">Sign-in didn’t complete.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {reason ??
            'The sign-in code couldn’t be exchanged. Check that the Supabase URL and anon key are correct and this address is an allowed redirect URL.'}
        </p>
        <Link to="/login" className="mt-3 inline-block underline">
          Try again
        </Link>
      </div>
    )
  return (
    <p className="mt-16 text-center text-muted-foreground">Signing you in…</p>
  )
}
