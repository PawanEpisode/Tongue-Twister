import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AuthShowcase } from '#/components/auth/AuthShowcase'
import CodeForm from '#/components/auth/CodeForm'
import EmailRequestForm from '#/components/auth/EmailRequestForm'
import PasswordAuthForm from '#/components/auth/PasswordAuthForm'
import { CODE_FLOWS } from '#/components/auth/codeFlows'
import type { CodePurpose } from '#/components/auth/codeFlows'
import { useAuth } from '#/lib/auth'
import { authActions } from '#/lib/authActions'
import { OTP_LENGTH } from '#/lib/authFlow'
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

/** Which screen of the login page is showing. */
type View =
  | { name: 'password' }
  | { name: 'forgot' }
  | { name: 'forgot-sent'; email: string }
  | { name: 'code-request' }
  | { name: 'code'; email: string; purpose: CodePurpose; info?: string }

const PASSWORD: View = { name: 'password' }

function Login() {
  const nav = useNavigate()
  const { session } = useAuth()
  const { redirect } = Route.useSearch()
  const [view, setView] = useState<View>(PASSWORD)
  // Remembered up front: Google sign-in leaves the site and comes back through /auth/callback.
  useEffect(() => returnTo.remember(redirect), [redirect])
  useEffect(() => {
    if (session) void nav({ href: returnTo.take(), replace: true })
  }, [session, nav])
  // Start downloading the sign-in library while the person types.
  useEffect(() => void getSupabase().catch(() => undefined), [])

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

  const back = () => setView(PASSWORD)

  return (
    <div className="grid items-stretch gap-6 lg:min-h-[620px] lg:grid-cols-2">
      <AuthShowcase />
      <div className="flex items-center justify-center">
        {view.name === 'password' && (
          <PasswordAuthForm
            onCodeSent={(email, purpose, info) =>
              setView({ name: 'code', email, purpose, info })
            }
            onForgot={() => setView({ name: 'forgot' })}
            onCodeSignIn={() => setView({ name: 'code-request' })}
          />
        )}

        {view.name === 'forgot' && (
          <EmailRequestForm
            heading="Reset your password"
            text="Enter your account email and we’ll send you a link to choose a new password."
            submitLabel="Send reset link"
            send={authActions.requestPasswordReset}
            onSent={(email) => setView({ name: 'forgot-sent', email })}
            onBack={back}
          />
        )}

        {view.name === 'forgot-sent' && (
          <div className="w-full max-w-sm space-y-4 py-6">
            <h1 className="font-display text-3xl font-extrabold">
              Check your email
            </h1>
            <p role="status" className="text-sm text-muted-foreground">
              If there’s an account for{' '}
              <b className="break-all">{view.email}</b>, we’ve sent a link to
              reset your password. Open it on this device.
            </p>
            <button
              type="button"
              onClick={back}
              className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
            >
              Back to sign in
            </button>
          </div>
        )}

        {view.name === 'code-request' && (
          <EmailRequestForm
            heading="Sign in with a code"
            text={`We’ll email you a ${OTP_LENGTH}-digit code. No password needed.`}
            submitLabel="Email me a code"
            send={authActions.requestSignInCode}
            onSent={(email) =>
              setView({
                name: 'code',
                email,
                purpose: 'signin',
                info: `If there’s an account for ${email}, we’ve sent a ${OTP_LENGTH}-digit code.`,
              })
            }
            onBack={back}
          />
        )}

        {view.name === 'code' && (
          <CodeForm
            email={view.email}
            initialNote={view.info}
            verify={(code) =>
              authActions.verifyCode(
                view.email,
                code,
                CODE_FLOWS[view.purpose].verifyType,
              )
            }
            resend={() => CODE_FLOWS[view.purpose].resend(view.email)}
            // Signed in: the session effect above navigates.
            onChangeEmail={back}
          />
        )}
      </div>
    </div>
  )
}
