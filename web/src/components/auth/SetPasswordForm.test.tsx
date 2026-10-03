// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SetPasswordForm from './SetPasswordForm'

const actions = vi.hoisted(() => ({
  updatePassword: vi.fn(),
  requestReauthCode: vi.fn(),
}))
vi.mock('#/lib/authActions', () => ({ authActions: actions }))
vi.mock('#/lib/auth', () => ({
  useAuth: () => ({ session: { user: { email: 'me@example.com' } } }),
}))

const onDone = vi.fn()
const fill = (pw: string) =>
  fireEvent.change(screen.getByPlaceholderText(/At least 8/), {
    target: { value: pw },
  })
const save = () => fireEvent.click(screen.getByRole('button', { name: /Save/ }))

beforeEach(() => {
  actions.updatePassword
    .mockReset()
    .mockResolvedValue({ data: {}, error: null })
  actions.requestReauthCode
    .mockReset()
    .mockResolvedValue({ data: null, error: null })
  onDone.mockReset()
})
afterEach(cleanup)

describe('SetPasswordForm', () => {
  it('saves a good password and reports done', async () => {
    render(<SetPasswordForm onDone={onDone} />)
    fill('a-long-password')
    save()
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(actions.updatePassword).toHaveBeenCalledWith('a-long-password')
    expect(actions.requestReauthCode).not.toHaveBeenCalled()
  })

  it('rejects a short password without calling Supabase', async () => {
    render(<SetPasswordForm onDone={onDone} />)
    fill('short')
    save()
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/)
    expect(actions.updatePassword).not.toHaveBeenCalled()
  })

  it('shows a Supabase refusal (e.g. the same password) and stays on the form', async () => {
    actions.updatePassword.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'same_password' },
    })
    render(<SetPasswordForm onDone={onDone} />)
    fill('a-long-password')
    save()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /haven’t used/,
    )
    expect(onDone).not.toHaveBeenCalled()
  })

  it('asks for an emailed code when Supabase wants reauthentication, then saves with it', async () => {
    actions.updatePassword
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'x', code: 'reauthentication_needed' },
      })
      .mockResolvedValue({ data: {}, error: null })
    render(<SetPasswordForm onDone={onDone} />)
    fill('a-long-password')
    save()
    const code = await screen.findByPlaceholderText('000000')
    expect(actions.requestReauthCode).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toMatch(/me@example\.com/)
    fireEvent.change(code, { target: { value: '654321' } })
    fireEvent.click(
      screen.getByRole('button', { name: /Confirm and save password/ }),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(actions.updatePassword).toHaveBeenLastCalledWith(
      'a-long-password',
      '654321',
    )
  })

  it('says so when the confirmation code could not be sent', async () => {
    actions.updatePassword.mockResolvedValue({
      data: null,
      error: { message: 'x', code: 'reauthentication_needed' },
    })
    actions.requestReauthCode.mockResolvedValue({
      data: null,
      error: { message: 'slow', status: 429 },
    })
    render(<SetPasswordForm onDone={onDone} />)
    fill('a-long-password')
    save()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Too many attempts/,
    )
    expect(screen.queryByPlaceholderText('000000')).toBeNull()
  })
})
