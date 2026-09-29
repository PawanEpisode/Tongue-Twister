import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '#/lib/auth'
import { supabase } from '#/lib/supabase'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const nav = useNavigate()
  const { session } = useAuth()
  useEffect(() => { if (session) nav({ to: '/twisters', replace: true }) }, [session, nav])
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
    else nav({ to: '/twisters' })
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
