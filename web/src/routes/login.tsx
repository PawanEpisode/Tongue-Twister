import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthShowcase } from '#/components/auth/AuthShowcase'
import { GoogleIcon } from '#/components/auth/GoogleIcon'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { useAuth } from '#/lib/auth'
import { returnTo, safePath } from '#/lib/returnTo'
import { seo } from '#/lib/seo'
import { supabase } from '#/lib/supabase'

export const Route = createFileRoute('/login')({
  head: () =>
    seo({ title: 'Sign in | Twister', path: '/login', noindex: true }),
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: safePath(s.redirect),
  }),
  component: Login,
})

type Note = { kind: 'error' | 'info'; text: string }

function Login() {
  const nav = useNavigate()
  const { session } = useAuth()
  const { redirect } = Route.useSearch()
  // Remembered up front: Google sign-in leaves the site and comes back through /auth/callback.
  useEffect(() => returnTo.remember(redirect), [redirect])
  useEffect(() => {
    if (session) void nav({ href: returnTo.take(), replace: true })
  }, [session, nav])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [busy, setBusy] = useState<'password' | 'google' | null>(null)
  const [note, setNote] = useState<Note | null>(null)

  const signUp = mode === 'up'

  if (!supabase)
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-border bg-card p-6 text-sm">
        <p className="font-semibold">Sign-in isn’t configured yet</p>
        <p className="mt-2 text-muted-foreground">
          Set real values for <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> in <code>web/.env.local</code>{' '}
          (Supabase → Project Settings → API), then restart the dev server.
        </p>
      </div>
    )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setNote(null)
    setBusy('password')
    const { error } = signUp
      ? await supabase!.auth.signUp({ email, password })
      : await supabase!.auth.signInWithPassword({ email, password })
    setBusy(null)
    if (error) setNote({ kind: 'error', text: error.message })
    else if (signUp)
      setNote({
        kind: 'info',
        text: 'Check your email to confirm your account, then sign in.',
      })
    // signed in: the session effect above takes over and navigates
  }
  const google = async () => {
    setNote(null)
    setBusy('google')
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setBusy(null)
      setNote({ kind: 'error', text: error.message })
    }
  }
  const switchMode = () => {
    setMode(signUp ? 'in' : 'up')
    setNote(null)
  }

  return (
    <div className="grid items-stretch gap-6 lg:min-h-[620px] lg:grid-cols-2">
      <AuthShowcase />
      <div className="flex items-center justify-center">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 py-6">
          <div>
            <h1 className="font-display text-3xl font-extrabold">
              {signUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {signUp
                ? 'Save your streak, scores and practice plan across devices.'
                : 'Sign in to pick up your streak where you left off.'}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full gap-3"
            onClick={google}
            disabled={busy !== null}
          >
            <GoogleIcon className="size-5" />
            {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </Button>

          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or with email
            <span className="h-px flex-1 bg-border" />
          </div>

          <label className="block space-y-1.5 text-sm font-medium">
            Email
            <Input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Password
            <span className="relative block">
              <Input
                type={show ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete={signUp ? 'new-password' : 'current-password'}
                placeholder={signUp ? 'At least 6 characters' : 'Your password'}
                className="pr-16"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-pressed={show}
                className="absolute inset-y-0 right-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          {note && (
            <p
              role={note.kind === 'error' ? 'alert' : 'status'}
              className={
                note.kind === 'error'
                  ? 'rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive'
                  : 'rounded-xl bg-lime/10 px-3 py-2 text-sm text-lime'
              }
            >
              {note.text}
            </p>
          )}

          <Button size="lg" className="w-full" disabled={busy !== null}>
            {busy === 'password'
              ? signUp
                ? 'Creating account…'
                : 'Signing in…'
              : signUp
                ? 'Create account'
                : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {signUp ? 'Already have an account?' : 'New to Twister?'}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              {signUp ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
