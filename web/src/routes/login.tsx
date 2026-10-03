import type { SupabaseClient } from '@supabase/supabase-js'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthShowcase } from '#/components/auth/AuthShowcase'
import { GoogleIcon } from '#/components/auth/GoogleIcon'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { useAuth } from '#/lib/auth'
import { checkEmailDomain } from '#/lib/emailDns'
import {
  MAX_CODE_ATTEMPTS,
  MIN_SIGNUP_PASSWORD,
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
  checkEmail,
  cleanCode,
  describeAuthError,
  emailProblemText,
  isCompleteCode,
  normaliseEmail,
  passwordProblem,
  secondsLeft,
  signUpWasDuplicate,
} from '#/lib/authFlow'
import {
  OTP_EXPIRY_SECONDS,
  formatDuration,
  isCodeExpired,
} from '#/lib/otpConfig'
import { returnTo, safePath } from '#/lib/returnTo'
import { seo } from '#/lib/seo'
import { getSupabase, supabaseConfigured } from '#/lib/supabase'

export const Route = createFileRoute('/login')({
  head: () =>
    seo({ title: 'Sign in | Twister', path: '/login', noindex: true }),
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: safePath(s.redirect),
  }),
  component: Login,
})

type Note = { kind: 'error' | 'info'; text: string }

/** Runs a supabase-js call; a failed download of the library becomes a normal, retryable error. */
type AuthError = { message: string; code?: string; status?: number }
type AuthResult = { data?: any; error: AuthError | null }

async function withClient(
  fn: (sb: SupabaseClient) => PromiseLike<AuthResult>,
): Promise<AuthResult> {
  try {
    const sb = await getSupabase()
    if (sb) return await fn(sb)
  } catch {
    /* falls through */
  }
  return {
    error: {
      message:
        'Couldn’t reach the sign-in service. Check your connection and try again.',
    },
  }
}

function Login() {
  const nav = useNavigate()
  const { session } = useAuth()
  const { redirect } = Route.useSearch()
  // Remembered up front: Google sign-in leaves the site and comes back through /auth/callback.
  useEffect(() => returnTo.remember(redirect), [redirect])
  useEffect(() => {
    if (session) void nav({ href: returnTo.take(), replace: true })
  }, [session, nav])
  // Start downloading the sign-in library while the person types.
  useEffect(() => void getSupabase().catch(() => undefined), [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [busy, setBusy] = useState<'password' | 'google' | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  // Email confirmation by one-time code: the step after "Create account".
  const [step, setStep] = useState<'form' | 'code'>('form')
  const [code, setCode] = useState('')
  const [wrongCodes, setWrongCodes] = useState(0)
  const [resendAt, setResendAt] = useState(0)
  // When the code in play was sent: a code older than Supabase's expiry is not worth a round trip.
  const [codeSentAt, setCodeSentAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  // A likely typo ("gmial.com"): asked about once, then the person's own spelling stands.
  const [typo, setTypo] = useState<{ email: string; fix: string } | null>(null)

  const signUp = mode === 'up'
  const wait = secondsLeft(resendAt, now)
  useEffect(() => {
    if (!wait) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [wait])
  const startCooldown = () => {
    const t = Date.now()
    setNow(t)
    setCodeSentAt(t)
    setResendAt(t + RESEND_COOLDOWN_S * 1000)
  }
  const openCodeStep = (info?: string) => {
    setStep('code')
    setCode('')
    setWrongCodes(0)
    startCooldown()
    setNote(info ? { kind: 'info', text: info } : null)
  }

  if (!supabaseConfigured)
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
    if (busy) return
    setNote(null)
    const checked = checkEmail(email)
    // Signing in only needs a plausible address; signing up must also be a permanent one.
    if (!checked.ok && (signUp || checked.reason !== 'disposable')) {
      setNote({ kind: 'error', text: emailProblemText(checked.reason) })
      return
    }
    const address = checked.ok ? checked.email : normaliseEmail(email)
    if (signUp) {
      const bad = passwordProblem(password)
      if (bad) {
        setNote({ kind: 'error', text: bad })
        return
      }
      if (checked.ok && checked.suggestion && typo?.email !== address) {
        setTypo({ email: address, fix: checked.suggestion })
        return
      }
    }
    setEmail(address)
    setBusy('password')
    if (signUp) {
      // Only for a new account: someone with an existing login is never turned away by a DNS lookup.
      // Fails open (see lib/emailDns), so a resolver outage cannot block sign-up.
      const domain = await checkEmailDomain(address)
      if (!domain.ok) {
        setBusy(null)
        setNote({ kind: 'error', text: domain.message })
        return
      }
    }
    const { data, error } = await withClient((sb) =>
      signUp
        ? sb.auth.signUp({ email: address, password })
        : sb.auth.signInWithPassword({ email: address, password }),
    )
    setBusy(null)
    if (error) {
      const f = describeAuthError(error)
      if (f.needsCode) {
        // Signed up before but never confirmed: send a fresh code and take them to the code box.
        const sent = await withClient((sb) =>
          sb.auth.resend({ type: 'signup', email: address }),
        )
        if (sent.error) setNote({ kind: 'error', text: f.text })
        else openCodeStep(f.text)
        return
      }
      if (f.cooldown) startCooldown()
      setNote({ kind: 'error', text: f.text })
      return
    }
    if (signUp && !data?.session)
      // The same words whether or not the address already has an account, so this screen cannot be used to
      // find out who is registered.
      openCodeStep(
        signUpWasDuplicate(data?.user)
          ? `If ${address} is new here, we’ve sent a ${OTP_LENGTH}-digit code. If you already have an account, sign in instead.`
          : `We’ve sent a ${OTP_LENGTH}-digit code to ${address}.`,
      )
    // signed in: the session effect above takes over and navigates
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !isCompleteCode(code) || wrongCodes >= MAX_CODE_ATTEMPTS) return
    setNote(null)
    if (isCodeExpired(codeSentAt, Date.now())) {
      setCode('')
      setNote({
        kind: 'error',
        text: 'This code has expired. Request a new one.',
      })
      return
    }
    setBusy('password')
    const { error } = await withClient((sb) =>
      sb.auth.verifyOtp({ email, token: code, type: 'signup' }),
    )
    setBusy(null)
    if (!error) return // the session effect navigates
    const f = describeAuthError(error)
    const n = wrongCodes + 1
    setWrongCodes(n)
    setCode('')
    setNote({
      kind: 'error',
      text:
        n >= MAX_CODE_ATTEMPTS
          ? 'Too many wrong codes. Request a new code to try again.'
          : f.text,
    })
  }
  const resend = async () => {
    if (busy || wait > 0) return
    setNote(null)
    setBusy('password')
    const { error } = await withClient((sb) =>
      sb.auth.resend({ type: 'signup', email }),
    )
    setBusy(null)
    startCooldown()
    if (error) setNote({ kind: 'error', text: describeAuthError(error).text })
    else {
      setCode('')
      setWrongCodes(0)
      setNote({ kind: 'info', text: 'A new code is on its way.' })
    }
  }
  const changeEmail = () => {
    setStep('form')
    setCode('')
    setWrongCodes(0)
    setNote(null)
  }
  const google = async () => {
    setNote(null)
    setBusy('google')
    const { error } = await withClient((sb) =>
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      }),
    )
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
        {step === 'code' ? (
          <form onSubmit={verify} className="w-full max-w-sm space-y-5 py-6">
            <div>
              <h1 className="font-display text-3xl font-extrabold">
                Check your email
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Enter the {OTP_LENGTH}-digit code we sent to{' '}
                <b className="break-all">{email}</b>. It’s valid for{' '}
                {formatDuration(OTP_EXPIRY_SECONDS)}.
              </p>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Code
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern={`\\d{${OTP_LENGTH}}`}
                maxLength={OTP_LENGTH + 2}
                placeholder={'0'.repeat(OTP_LENGTH)}
                className="text-center font-mono text-2xl tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(cleanCode(e.target.value))}
                disabled={wrongCodes >= MAX_CODE_ATTEMPTS}
                autoFocus
              />
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
            <Button
              size="lg"
              className="w-full"
              disabled={
                busy !== null ||
                !isCompleteCode(code) ||
                wrongCodes >= MAX_CODE_ATTEMPTS
              }
            >
              {busy === 'password' ? 'Verifying…' : 'Verify and continue'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Didn’t get it? Check spam, then{' '}
              <button
                type="button"
                onClick={resend}
                disabled={busy !== null || wait > 0}
                className="font-semibold text-brand underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
              >
                {wait > 0 ? `resend in ${wait}s` : 'resend the code'}
              </button>
              {' · '}
              <button
                type="button"
                onClick={changeEmail}
                className="font-semibold text-brand underline-offset-4 hover:underline"
              >
                Change email
              </button>
            </p>
          </form>
        ) : (
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
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setTypo(null)
                }}
              />
            </label>
            {signUp && typo && (
              <p role="status" className="-mt-3 text-sm text-muted-foreground">
                Did you mean{' '}
                <button
                  type="button"
                  onClick={() => {
                    setEmail(typo.fix)
                    setTypo(null)
                  }}
                  className="font-semibold text-brand underline-offset-4 hover:underline"
                >
                  {typo.fix}
                </button>
                ? Press “Create account” again to keep what you typed.
              </p>
            )}
            <label className="block space-y-1.5 text-sm font-medium">
              Password
              <span className="relative block">
                <Input
                  type={show ? 'text' : 'password'}
                  required
                  minLength={signUp ? MIN_SIGNUP_PASSWORD : undefined}
                  maxLength={72}
                  autoComplete={signUp ? 'new-password' : 'current-password'}
                  placeholder={
                    signUp
                      ? `At least ${MIN_SIGNUP_PASSWORD} characters`
                      : 'Your password'
                  }
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
        )}
      </div>
    </div>
  )
}
