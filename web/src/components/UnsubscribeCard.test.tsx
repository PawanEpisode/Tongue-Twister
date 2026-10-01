// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '#/lib/api'
import type * as RemindersApi from '#/lib/reminders/api'
import UnsubscribeCard from './UnsubscribeCard'

const unsub = vi.fn()
vi.mock('#/lib/reminders/api', async (orig) => ({
  ...(await orig<typeof RemindersApi>()),
  unsubscribe: (t: string) => unsub(t),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))
afterEach(() => {
  cleanup()
  unsub.mockReset()
})

describe('UnsubscribeCard', () => {
  it('does nothing on load, calls once on click, then confirms', async () => {
    unsub.mockResolvedValue(undefined)
    render(<UnsubscribeCard token="tok" />)
    expect(unsub).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => screen.getByText('You’re unsubscribed'))
    expect(unsub).toHaveBeenCalledExactlyOnceWith('tok')
  })
  it('shows a friendly state for a bad link', async () => {
    unsub.mockRejectedValue(new ApiError(404, 'not_found'))
    render(<UnsubscribeCard token="bad" />)
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => screen.getByText('This link doesn’t work'))
  })
  it('lets the user retry after a network failure', async () => {
    unsub
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(undefined)
    render(<UnsubscribeCard token="t" />)
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => screen.getByText(/couldn’t reach Twister/))
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => screen.getByText('You’re unsubscribed'))
  })
})
