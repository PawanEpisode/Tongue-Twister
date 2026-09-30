import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [msg, setMsg] = useState<string | null>(null)

  if (!supabase)
    return (
      <p className="text-white/60">
        Auth isn’t configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
        (see web/.env.example).
      </p>
    )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const { error } =
      mode === 'in'
        ? await supabase!.auth.signInWithPassword({ email, password })
        : await supabase!.auth.signUp({ email, password })
    if (error) setMsg(error.message)
    else if (mode === 'up') setMsg('Check your email to confirm, then sign in.')
    // signed in: the session effect above takes over and navigates
  }
  const google = () =>
    supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  const input =
    'glass w-full rounded-xl px-4 py-3 outline-none focus:border-brand'
  return (
    <form
      onSubmit={submit}
      className="glass mx-auto mt-10 max-w-sm space-y-4 rounded-3xl p-8"
    >
      <h1 className="text-3xl font-extrabold">
        {mode === 'in' ? 'Welcome back' : 'Join Twister'}
      </h1>
      <input
        className={input}
        type="email"
        required
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className={input}
        type="password"
        required
        minLength={6}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="w-full rounded-xl bg-brand py-3 font-semibold">
        {mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        onClick={google}
        className="w-full rounded-xl border border-line py-3 hover:border-brand"
      >
        Continue with Google
      </button>
      {msg && <p className="text-sm text-pink">{msg}</p>}
      <button
        type="button"
        className="text-sm text-white/50 underline"
        onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
      >
        {mode === 'in'
          ? 'New here? Create an account'
          : 'Have an account? Sign in'}
      </button>
    </form>
  )
}
