import { useState } from 'react'
import { AuthNote } from '#/components/auth/AuthNote'
import type { CodePurpose } from '#/components/auth/codeFlows'
import { GoogleIcon } from '#/components/auth/GoogleIcon'
import { PasswordField } from '#/components/auth/PasswordField'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authActions } from '#/lib/authActions'
import {
  OTP_LENGTH,
  checkEmail,
  describeAuthError,
  emailProblemText,
  normaliseEmail,
  passwordProblem,
  signUpWasDuplicate,
} from '#/lib/authFlow'
import type { Note } from '#/lib/authFlow'
import { checkEmailDomain } from '#/lib/emailDns'

/** Email + password, in two modes (sign in / create account), plus Google. Hands off to the code screen. */
export default function PasswordAuthForm({
  onCodeSent,
  onForgot,
  onCodeSignIn,
}: {
  /** A code was emailed: show the code box. `info` is the first message in it. */
  onCodeSent: (email: string, purpose: CodePurpose, info?: string) => void
  onForgot: () => void
  onCodeSignIn: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [busy, setBusy] = useState<'password' | 'google' | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  // A likely typo ("gmial.com"): asked about once, then the person's own spelling stands.
  const [typo, setTypo] = useState<{ email: string; fix: string } | null>(null)
  const signUp = mode === 'up'

  const fail = (text: string) => setNote({ kind: 'error', text })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setNote(null)
    const checked = checkEmail(email)
    // Signing in only needs a plausible address; signing up must also be a permanent one.
    if (!checked.ok && (signUp || checked.reason !== 'disposable'))
      return fail(emailProblemText(checked.reason))
    const address = checked.ok ? checked.email : normaliseEmail(email)
    if (signUp) {
      const bad = passwordProblem(password)
      if (bad) return fail(bad)
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
        return fail(domain.message)
      }
    }
    const { data, error } = signUp
      ? await authActions.signUp(address, password)
      : await authActions.signInWithPassword(address, password)
    setBusy(null)
    if (error) {
      const f = describeAuthError(error)
      if (f.needsCode) {
        // Signed up before but never confirmed: send a fresh code and take them to the code box.
        const sent = await authActions.resendSignupCode(address)
        if (sent.error) fail(f.text)
        else onCodeSent(address, 'signup', f.text)
      } else fail(f.text)
      return
    }
    if (signUp && !(data as { session?: unknown } | null)?.session) {
      const user = (data as { user?: { identities?: unknown[] | null } } | null)
        ?.user
      // The same words whether or not the address already has an account, so this screen cannot be used to
      // find out who is registered.
      onCodeSent(
        address,
        'signup',
        signUpWasDuplicate(user)
          ? `If ${address} is new here, we’ve sent a ${OTP_LENGTH}-digit code. If you already have an account, sign in instead.`
          : `We’ve sent a ${OTP_LENGTH}-digit code to ${address}.`,
      )
    }
    // signed in: the session effect on the login page navigates
  }

  const google = async () => {
    setNote(null)
    setBusy('google')
    const { error } = await authActions.signInWithGoogle()
    if (error) {
      setBusy(null)
      fail(error.message)
    }
  }

  return (
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
      <PasswordField
        value={password}
        onChange={setPassword}
        creating={signUp}
        action={
          !signUp && (
            <button
              type="button"
              onClick={onForgot}
              className="text-xs font-semibold text-brand underline-offset-4 hover:underline"
            >
              Forgot password?
            </button>
          )
        }
      />

      <AuthNote note={note} />

      <Button size="lg" className="w-full" disabled={busy !== null}>
        {busy === 'password'
          ? signUp
            ? 'Creating account…'
            : 'Signing in…'
          : signUp
            ? 'Create account'
            : 'Sign in'}
      </Button>

      {!signUp && (
        <p className="text-center text-sm">
          <button
            type="button"
            onClick={onCodeSignIn}
            className="font-semibold text-brand underline-offset-4 hover:underline"
          >
            Email me a sign-in code instead
          </button>
        </p>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {signUp ? 'Already have an account?' : 'New to Twister?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(signUp ? 'in' : 'up')
            setNote(null)
            setTypo(null)
          }}
          className="font-semibold text-brand underline-offset-4 hover:underline"
        >
          {signUp ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  )
}
