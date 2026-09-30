import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
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
      <p className="text-muted-foreground">
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
  return (
    <Card
      asChild
      variant="glass"
      className="mx-auto mt-10 max-w-sm rounded-3xl p-8"
    >
      <form onSubmit={submit} className="space-y-4">
        <h1 className="text-3xl font-extrabold">
          {mode === 'in' ? 'Welcome back' : 'Join Twister'}
        </h1>
        <Input
          className="glass"
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          className="glass"
          type="password"
          required
          minLength={6}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button className="w-full py-3">
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full py-3"
          onClick={google}
        >
          Continue with Google
        </Button>
        {msg && <p className="text-sm text-pink">{msg}</p>}
        <Button
          type="button"
          variant="ghost"
          className="underline"
          onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
        >
          {mode === 'in'
            ? 'New here? Create an account'
            : 'Have an account? Sign in'}
        </Button>
      </form>
    </Card>
  )
}
