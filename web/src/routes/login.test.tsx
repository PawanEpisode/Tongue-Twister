// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './login'

const auth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  signInWithOAuth: vi.fn(),
}
vi.mock('#/lib/supabase', () => ({
  supabaseConfigured: true,
  getSupabase: () => Promise.resolve({ auth }),
}))
const dns = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('#/lib/emailDns', () => ({ checkEmailDomain: dns.check }))
vi.mock('#/lib/auth', () => ({ useAuth: () => ({ session: null }) }))
vi.mock('#/components/auth/AuthShowcase', () => ({ AuthShowcase: () => null }))
vi.mock('@tanstack/react-router', () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
  createFileRoute: () => (o: { component: unknown }) => ({
    ...o,
    useSearch: () => ({}),
  }),
}))

const Login = (Route as unknown as { component: React.ComponentType }).component

async function openSignUp(email: string, password = 'longenough1') {
  render(<Login />)
  fireEvent.click(screen.getByRole('button', { name: 'Create an account' }))
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value: email },
  })
  fireEvent.change(screen.getByPlaceholderText(/At least 8/), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

beforeEach(() => {
  dns.check.mockReset()
  dns.check.mockResolvedValue({ ok: true })
  for (const f of Object.values(auth)) f.mockReset()
  auth.signUp.mockResolvedValue({
    data: { user: { identities: [{}] }, session: null },
    error: null,
  })
  auth.resend.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('sign-up with an email code', () => {
  it('refuses a domain with no mail server before creating anything', async () => {
    dns.check.mockResolvedValue({
      ok: false,
      message: 'Please enter a valid domain',
    })
    await openSignUp('a@nomail.example')
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /valid domain/,
    )
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('does not run the DNS check on sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null })
    render(<Login />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'a@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Your password'), {
      target: { value: 'whatever1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalled())
    expect(dns.check).not.toHaveBeenCalled()
  })

  it('refuses a disposable address without calling Supabase', async () => {
    await openSignUp('bot@mailinator.com')
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /permanent email/,
    )
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('refuses a short password', async () => {
    await openSignUp('a@example.com', 'short')
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/)
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('asks about a likely typo once, then lets the typed address through', async () => {
    await openSignUp('sam@gmial.com')
    expect(await screen.findByText('sam@gmail.com')).toBeTruthy()
    expect(auth.signUp).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith({
        email: 'sam@gmial.com',
        password: 'longenough1',
      }),
    )
  })

  it('moves to the code box, verifies a pasted code, and locks resend during the cooldown', async () => {
    auth.verifyOtp.mockResolvedValue({ error: null })
    await openSignUp('  New@Example.com ')
    const box = await screen.findByPlaceholderText('000000')
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'longenough1',
    })
    expect(
      screen.getByRole('button', { name: /resend in \d+s/ }),
    ).toHaveProperty('disabled', true)
    const verify = screen.getByRole('button', { name: /Verify/ })
    expect(verify).toHaveProperty('disabled', true)
    fireEvent.change(box, { target: { value: '123 456' } })
    expect(verify).toHaveProperty('disabled', false)
    fireEvent.click(verify)
    await waitFor(() =>
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: 'new@example.com',
        token: '123456',
        type: 'signup',
      }),
    )
  })

  it('says the same thing for an address that already has an account', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [] }, session: null },
      error: null,
    })
    await openSignUp('old@example.com')
    expect((await screen.findByRole('status')).textContent).toMatch(
      /If old@example.com is new here/,
    )
  })

  it('stops accepting codes after too many wrong ones', async () => {
    auth.verifyOtp.mockResolvedValue({
      error: {
        message: 'Token has expired or is invalid',
        code: 'otp_expired',
      },
    })
    await openSignUp('a@example.com')
    const box = await screen.findByPlaceholderText('000000')
    for (let i = 0; i < 5; i++) {
      fireEvent.change(box, { target: { value: '111111' } })
      fireEvent.click(screen.getByRole('button', { name: /Verify/ }))
      await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledTimes(i + 1))
      await waitFor(() => expect((box as HTMLInputElement).value).toBe(''))
    }
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Too many wrong codes/,
    )
    expect(box).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Verify/ })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('sends an unconfirmed sign-in to the code box with a fresh code', async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
    })
    render(<Login />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'a@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Your password'), {
      target: { value: 'whatever1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByPlaceholderText('000000')).toBeTruthy()
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@example.com',
    })
  })

  it('says how long the code lasts, and will not send a code that has already expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await openSignUp('a@example.com')
      const box = await screen.findByPlaceholderText('000000')
      expect(document.body.textContent).toMatch(/valid for 1 hour/)
      vi.setSystemTime(Date.now() + 3600 * 1000)
      fireEvent.change(box, { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: /Verify/ }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/expired/)
      expect(auth.verifyOtp).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
