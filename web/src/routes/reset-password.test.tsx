// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './reset-password'

let auth: { session: unknown; loading: boolean } = {
  session: null,
  loading: false,
}
const nav = vi.fn()
vi.mock('#/lib/auth', () => ({ useAuth: () => auth }))
vi.mock('#/components/auth/SetPasswordForm', () => ({
  default: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>save-mock</button>
  ),
}))
vi.mock('#/lib/returnTo', () => ({ returnTo: { take: () => '/account' } }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/login">{children}</a>
  ),
  useNavigate: () => nav,
  createFileRoute: () => (o: { component: unknown }) => o,
}))

const Page = (Route as unknown as { component: React.ComponentType }).component

beforeEach(() => {
  auth = { session: null, loading: false }
  nav.mockReset()
  window.history.replaceState(null, '', '/reset-password')
})
afterEach(cleanup)

describe('/reset-password', () => {
  it('waits while the emailed link is being exchanged for a session', () => {
    auth = { session: null, loading: true }
    render(<Page />)
    expect(document.body.textContent).toMatch(/Checking your link/)
  })

  it('explains a link that cannot be used and offers a new one', () => {
    render(<Page />)
    expect(document.body.textContent).toMatch(/can’t be used/)
    expect(
      screen.getByRole('link', { name: 'Ask for a new link' }),
    ).toBeTruthy()
  })

  it('shows the reason Supabase gave when the link failed', () => {
    window.history.replaceState(
      null,
      '',
      '/reset-password?error_description=Link+expired',
    )
    render(<Page />)
    expect(document.body.textContent).toMatch(/Link expired/)
  })

  it('lets a signed-in person choose a password, then continues where they were going', () => {
    auth = { session: { user: { email: 'a@x.com' } }, loading: false }
    render(<Page />)
    expect(document.body.textContent).toMatch(/Choose a new password/)
    fireEvent.click(screen.getByText('save-mock'))
    expect(screen.getByRole('status').textContent).toMatch(
      /signed in with your new password/,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(nav).toHaveBeenCalledWith({ href: '/account', replace: true })
  })
})
