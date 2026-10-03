/**
 * Every call the app makes to Supabase Auth, in one place. Screens and hooks call these instead of reaching
 * into supabase-js, so there is one spot that loads the library lazily, turns "could not load / reach it"
 * into an ordinary retryable error, and decides where emailed links return to.
 *
 * Nothing here decides what to show: results go through `describeAuthError` (./authFlow) in the UI.
 */
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { isUnknownAccountForCode } from './authFlow'
import { getSupabase } from './supabase'

export type AuthError = { message: string; code?: string; status?: number }
export type AuthResult<T = unknown> = {
  data: T | null
  error: AuthError | null
}

/** Which emailed one-time code is being checked. */
export type CodeType = 'signup' | 'email'

const UNREACHABLE: AuthError = {
  message:
    'Couldn’t reach the sign-in service. Check your connection and try again.',
}

/** Runs one supabase-js call. A failed download of the library or a network failure becomes `{ error }`. */
async function run<T = unknown>(
  fn: (
    sb: SupabaseClient,
  ) => PromiseLike<{ data: unknown; error: AuthError | null }>,
): Promise<AuthResult<T>> {
  try {
    const sb = await getSupabase()
    if (sb) {
      const { data, error } = await fn(sb)
      return { data: error ? null : (data as T), error }
    }
  } catch {
    /* falls through */
  }
  return { data: null, error: UNREACHABLE }
}

/**
 * Where an emailed link or OAuth round-trip returns. supabase-js exchanges the `?code=` it finds in the URL
 * on whichever page loads, so a link can land straight on the screen that needs the session. Each path used
 * here must be allowed in Supabase → Authentication → URL Configuration → Redirect URLs.
 */
const appUrl = (path: string) => `${window.location.origin}${path}`
const CALLBACK = '/auth/callback'

type SignUpData = { user: User | null; session: Session | null }

export const authActions = {
  signUp: (email: string, password: string) =>
    run<SignUpData>((sb) => sb.auth.signUp({ email, password })),

  signInWithPassword: (email: string, password: string) =>
    run((sb) => sb.auth.signInWithPassword({ email, password })),

  signInWithGoogle: () =>
    run((sb) =>
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: appUrl(CALLBACK) },
      }),
    ),

  /**
   * Passwordless: emails a code to an existing account. Never creates one (sign-up has its own checks).
   * An address with no account is reported as a success, exactly like a real one, so this call cannot be used
   * to find out who is registered.
   */
  requestSignInCode: async (email: string) => {
    const res = await run((sb) =>
      sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
    )
    return res.error && isUnknownAccountForCode(res.error)
      ? { data: null, error: null }
      : res
  },

  verifyCode: (email: string, token: string, type: CodeType) =>
    run((sb) => sb.auth.verifyOtp({ email, token, type })),

  resendSignupCode: (email: string) =>
    run((sb) => sb.auth.resend({ type: 'signup', email })),

  /** The emailed link opens `/reset-password` already signed in (a recovery session), to choose the new one. */
  requestPasswordReset: (email: string) =>
    run((sb) =>
      sb.auth.resetPasswordForEmail(email, {
        redirectTo: appUrl('/reset-password'),
      }),
    ),

  /** `nonce` is the emailed reauthentication code, needed when Supabase asks for a fresh check first. */
  updatePassword: (password: string, nonce?: string) =>
    run((sb) => sb.auth.updateUser(nonce ? { password, nonce } : { password })),

  /** Emails a code the person then passes as the `nonce` of `updatePassword`. */
  requestReauthCode: () => run((sb) => sb.auth.reauthenticate()),

  /** Supabase emails a confirmation link; the address changes only when it is followed. */
  requestEmailChange: (email: string) =>
    run((sb) =>
      sb.auth.updateUser({ email }, { emailRedirectTo: appUrl('/account') }),
    ),
}
