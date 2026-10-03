// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authActions } from './authActions'

const auth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  reauthenticate: vi.fn(),
}
const getSupabase = vi.fn()
vi.mock('./supabase', () => ({ getSupabase: () => getSupabase() }))

const ok = { data: { x: 1 }, error: null }
beforeEach(() => {
  for (const f of Object.values(auth)) f.mockReset().mockResolvedValue(ok)
  getSupabase.mockReset().mockResolvedValue({ auth })
})

describe('authActions', () => {
  it('sends each request to Supabase with the right shape', async () => {
    await authActions.signUp('a@x.com', 'pw123456')
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'a@x.com',
      password: 'pw123456',
    })

    await authActions.verifyCode('a@x.com', '123456', 'email')
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@x.com',
      token: '123456',
      type: 'email',
    })

    await authActions.resendSignupCode('a@x.com')
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@x.com',
    })

    await authActions.requestSignInCode('a@x.com')
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@x.com',
      options: { shouldCreateUser: false },
    })
  })

  it('returns emailed links to the screen that needs the session', async () => {
    await authActions.requestPasswordReset('a@x.com')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@x.com', {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    await authActions.requestEmailChange('b@x.com')
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'b@x.com' },
      { emailRedirectTo: `${window.location.origin}/account` },
    )
    await authActions.signInWithGoogle()
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  })

  it('sends the emailed code as the nonce only when there is one', async () => {
    await authActions.updatePassword('newpassword1')
    expect(auth.updateUser).toHaveBeenLastCalledWith({
      password: 'newpassword1',
    })
    await authActions.updatePassword('newpassword1', '123456')
    expect(auth.updateUser).toHaveBeenLastCalledWith({
      password: 'newpassword1',
      nonce: '123456',
    })
    await authActions.requestReauthCode()
    expect(auth.reauthenticate).toHaveBeenCalled()
  })

  it('returns data on success and null data with the error on failure', async () => {
    expect(await authActions.signUp('a@x.com', 'p')).toEqual({
      data: { x: 1 },
      error: null,
    })
    auth.signUp.mockResolvedValue({ data: { x: 1 }, error: { message: 'no' } })
    expect(await authActions.signUp('a@x.com', 'p')).toEqual({
      data: null,
      error: { message: 'no' },
    })
  })

  it('turns an unreachable service (library or network) into an ordinary error', async () => {
    getSupabase.mockRejectedValue(new Error('chunk failed'))
    expect((await authActions.signUp('a@x.com', 'p')).error?.message).toMatch(
      /Couldn’t reach/,
    )
    getSupabase.mockResolvedValue(null)
    expect((await authActions.updatePassword('x')).error).not.toBeNull()
    getSupabase.mockResolvedValue({ auth })
    auth.verifyOtp.mockRejectedValue(new Error('offline'))
    expect(
      (await authActions.verifyCode('a', '1', 'signup')).error?.message,
    ).toMatch(/Couldn’t reach/)
  })

  it('does not reveal whether a sign-in code address has an account', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: null,
      error: { message: 'Signups not allowed for otp', code: 'otp_disabled' },
    })
    expect(await authActions.requestSignInCode('ghost@x.com')).toEqual({
      data: null,
      error: null,
    })
    // ...but a real failure still surfaces
    auth.signInWithOtp.mockResolvedValue({
      data: null,
      error: {
        message: 'slow down',
        code: 'over_email_send_rate_limit',
        status: 429,
      },
    })
    expect((await authActions.requestSignInCode('a@x.com')).error?.status).toBe(
      429,
    )
  })
})
