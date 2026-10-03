// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CodeForm from './CodeForm'

const verify = vi.fn()
const resend = vi.fn()
const onVerified = vi.fn()
const onChangeEmail = vi.fn()

const setup = (props: Partial<React.ComponentProps<typeof CodeForm>> = {}) =>
  render(
    <CodeForm
      email="a@example.com"
      verify={verify}
      resend={resend}
      onVerified={onVerified}
      {...props}
    />,
  )
const box = () => screen.getByPlaceholderText<HTMLInputElement>('000000')
const submitBtn = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: /Verify|Confirm/ })
const type = (v: string) => fireEvent.change(box(), { target: { value: v } })

beforeEach(() => {
  verify.mockReset().mockResolvedValue({ data: {}, error: null })
  resend.mockReset().mockResolvedValue({ data: {}, error: null })
  onVerified.mockReset()
  onChangeEmail.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CodeForm', () => {
  it('names the address and how long the code lasts', () => {
    setup()
    expect(document.body.textContent).toMatch(
      /6-digit code we sent to\s*a@example\.com/,
    )
    expect(document.body.textContent).toMatch(/valid for 1 hour/)
  })

  it('only submits a complete code, and cleans pasted text', async () => {
    setup()
    expect(submitBtn().disabled).toBe(true)
    type('123 45')
    expect(box().value).toBe('12345')
    expect(submitBtn().disabled).toBe(true)
    type('123-456')
    expect(box().value).toBe('123456')
    fireEvent.click(submitBtn())
    await waitFor(() => expect(verify).toHaveBeenCalledWith('123456'))
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
  })

  it('shows the first message, and lets the person go back', () => {
    setup({ initialNote: 'We’ve sent a code', onChangeEmail })
    expect(screen.getByRole('status').textContent).toBe('We’ve sent a code')
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }))
    expect(onChangeEmail).toHaveBeenCalled()
  })

  it('hides "Change email" when the address cannot change', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull()
  })

  it('explains a wrong code, clears it, and locks after five', async () => {
    verify.mockResolvedValue({
      data: null,
      error: { message: 'bad', code: 'otp_expired' },
    })
    setup()
    for (let i = 1; i <= 5; i++) {
      type('111111')
      fireEvent.click(submitBtn())
      await waitFor(() => expect(verify).toHaveBeenCalledTimes(i))
      await waitFor(() => expect(box().value).toBe(''))
    }
    expect(screen.getByRole('alert').textContent).toMatch(
      /Too many wrong codes/,
    )
    expect(box().disabled).toBe(true)
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('will not send a code that has already expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    setup()
    vi.setSystemTime(Date.now() + 3600 * 1000)
    type('123456')
    fireEvent.click(submitBtn())
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/)
    expect(verify).not.toHaveBeenCalled()
  })

  it('counts down before "resend" works, then sends a fresh code and resets the attempts', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    setup()
    const resendBtn = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: /resend/ })
    expect(resendBtn().textContent).toMatch(/resend in 60s/)
    expect(resendBtn().disabled).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(61_000)
    })
    expect(resendBtn().textContent).toBe('resend the code')
    fireEvent.click(resendBtn())
    await act(async () => {})
    expect(resend).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toMatch(
      /new code is on its way/,
    )
    expect(resendBtn().disabled).toBe(true) // the cooldown starts over
  })

  it('shows why a resend failed and still restarts the cooldown', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    resend.mockResolvedValue({
      data: null,
      error: { message: 'x', status: 429 },
    })
    setup()
    await act(async () => {
      vi.advanceTimersByTime(61_000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'resend the code' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toMatch(/Too many attempts/)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /resend in/ })
        .disabled,
    ).toBe(true)
  })
})
