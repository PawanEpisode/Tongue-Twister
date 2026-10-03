import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import SetPasswordForm from '#/components/auth/SetPasswordForm'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { authUrlError } from '#/lib/authUrl'
import { returnTo } from '#/lib/returnTo'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/reset-password')({
  head: () =>
    seo({
      title: 'Choose a new password | Twister',
      path: '/reset-password',
      noindex: true,
    }),
  component: ResetPassword,
})

/**
 * Where the "reset your password" email lands. The link carries a one-time code that supabase-js exchanges for
 * a session, so by the time `session` is set the person is signed in and may choose a new password.
 */
function ResetPassword() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [reason] = useState(authUrlError)
  const [done, setDone] = useState(false)

  if (loading)
    return (
      <p className="mt-16 text-center text-muted-foreground">
        Checking your link…
      </p>
    )

  if (!session)
    return (
      <div className="mx-auto mt-16 max-w-sm text-center">
        <p className="text-pink">This reset link can’t be used.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {reason ??
            'It may have expired, been used already, or been opened on a different device or browser than the one you asked from.'}
        </p>
        <Link to="/login" className="mt-3 inline-block underline">
          Ask for a new link
        </Link>
      </div>
    )

  if (done)
    return (
      <div className="mx-auto mt-16 max-w-sm space-y-4 text-center">
        <h1 className="font-display text-3xl font-extrabold">
          Password updated
        </h1>
        <p role="status" className="text-sm text-muted-foreground">
          You’re signed in with your new password.
        </p>
        <Button
          className="px-6 py-3"
          onClick={() => void nav({ href: returnTo.take(), replace: true })}
        >
          Continue
        </Button>
      </div>
    )

  return (
    <div className="mx-auto mt-10 w-full max-w-sm space-y-5">
      <div>
        <h1 className="font-display text-3xl font-extrabold">
          Choose a new password
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pick something you haven’t used before.
        </p>
      </div>
      <SetPasswordForm
        submitLabel="Save new password"
        onDone={() => setDone(true)}
      />
    </div>
  )
}
