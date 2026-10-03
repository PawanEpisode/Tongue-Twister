// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '#/lib/api'
import SecuritySection from './SecuritySection'

const actions = vi.hoisted(() => ({ requestEmailChange: vi.fn() }))
const dns = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('#/lib/authActions', () => ({ authActions: actions }))
vi.mock('#/lib/emailDns', () => ({ checkEmailDomain: dns.check }))
vi.mock('#/lib/auth', () => ({
  useAuth: () => ({ session: { user: { email: 'Me@Example.com' } } }),
}))
vi.mock('#/components/auth/SetPasswordForm', () => ({
  default: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>set-password-mock</button>
  ),
}))

const me = {} as Profile
const newEmail = () => screen.getByPlaceholderText('you@example.com')
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Change email' }))

beforeEach(() => {
  actions.requestEmailChange
    .mockReset()
    .mockResolvedValue({ data: {}, error: null })
  dns.check.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('SecuritySection: change email', () => {
  it('shows the current email', () => {
    render(<SecuritySection me={me} locked={false} />)
    expect(document.body.textContent).toMatch(/Me@Example\.com/)
  })

  it.each([
    ['bot@mailinator.com', /permanent email/],
    ['a@b', /valid email/],
    ['  ME@example.com ', /already your email/],
  ])('refuses %j before contacting Supabase', async (value, message) => {
    render(<SecuritySection me={me} locked={false} />)
    fireEvent.change(newEmail(), { target: { value } })
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(message)
    expect(actions.requestEmailChange).not.toHaveBeenCalled()
  })

  it('refuses a domain with no mail server', async () => {
    dns.check.mockResolvedValue({
      ok: false,
      message: 'Please enter a valid domain',
    })
    render(<SecuritySection me={me} locked={false} />)
    fireEvent.change(newEmail(), { target: { value: 'a@nomail.example' } })
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /valid domain/,
    )
    expect(actions.requestEmailChange).not.toHaveBeenCalled()
  })

  it('requests the change with the normalised address and says a link was sent', async () => {
    render(<SecuritySection me={me} locked={false} />)
    fireEvent.change(newEmail(), { target: { value: '  New@Example.com ' } })
    submit()
    await waitFor(() =>
      expect(actions.requestEmailChange).toHaveBeenCalledWith(
        'new@example.com',
      ),
    )
    expect((await screen.findByRole('status')).textContent).toMatch(
      /confirmation link to new@example\.com/,
    )
    expect((newEmail() as HTMLInputElement).value).toBe('')
  })

  it('shows a Supabase refusal', async () => {
    actions.requestEmailChange.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'email_exists' },
    })
    render(<SecuritySection me={me} locked={false} />)
    fireEvent.change(newEmail(), { target: { value: 'taken@example.com' } })
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /already used/,
    )
  })

  it('is read-only while the account is pending deletion', () => {
    const { container } = render(<SecuritySection me={me} locked />)
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
  })
})

describe('SecuritySection: change password', () => {
  it('opens the shared form, confirms, and can be cancelled', () => {
    render(<SecuritySection me={me} locked={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    fireEvent.click(screen.getByText('set-password-mock'))
    expect(screen.getByRole('status').textContent).toBe('Password updated.')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy()
  })
})
