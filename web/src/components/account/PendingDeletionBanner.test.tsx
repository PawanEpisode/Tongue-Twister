// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingDeletionBanner from './PendingDeletionBanner'

const mutate = vi.fn()
let state: { pending: false } | { pending: true; scheduledFor: string } = {
  pending: false,
}
vi.mock('#/lib/account/useDeletion', () => ({
  useDeletionState: () => state,
  useCancelDeletion: () => ({ mutate, isPending: false, isError: false }),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PendingDeletionBanner', () => {
  it('renders nothing for a normal account', () => {
    state = { pending: false }
    const { container } = render(<PendingDeletionBanner />)
    expect(container.textContent).toBe('')
  })

  it('announces the date and lets the user cancel', () => {
    state = { pending: true, scheduledFor: '2026-10-31T12:00:00Z' }
    render(<PendingDeletionBanner />)
    expect(screen.getByRole('status').textContent).toMatch(
      /scheduled for deletion on\s*(\d{1,2} October 2026|October \d{1,2}, 2026)/,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(mutate).toHaveBeenCalledOnce()
  })
})
