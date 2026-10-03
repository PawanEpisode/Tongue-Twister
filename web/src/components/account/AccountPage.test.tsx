// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '#/lib/api'
import AccountPage from './AccountPage'

const refetch = vi.fn()
let meState: {
  isPending: boolean
  isError: boolean
  data?: Profile
  error?: unknown
  refetch: () => void
}
let pending = false
let flags: Record<string, boolean> = {}
vi.mock('#/lib/flags', () => ({ useFlags: () => flags }))
vi.mock('#/lib/useMe', () => ({ useMe: () => meState }))
vi.mock('#/lib/account/useDeletion', () => ({
  useDeletionState: () =>
    pending ? { pending: true, scheduledFor: 'x' } : { pending: false },
}))
vi.mock('#/components/settings/PreferenceSyncNote', () => ({
  default: () => null,
}))
vi.mock('./sections', () => ({
  ACCOUNT_SECTIONS: [
    {
      id: 'one',
      title: 'One',
      Component: ({ me, locked }: { me: Profile; locked: boolean }) => (
        <p>{`${me.display_name}:${locked}`}</p>
      ),
    },
    {
      id: 'gated',
      title: 'Gated',
      flag: 'beta',
      Component: () => <p>beta</p>,
    },
    { id: 'two', title: 'Two', tone: 'danger', Component: () => <p>second</p> },
  ],
}))
afterEach(() => {
  cleanup()
  pending = false
  flags = {}
})

const me = { display_name: 'Ana' } as Profile

describe('AccountPage', () => {
  it('shows a skeleton while the profile loads', () => {
    meState = { isPending: true, isError: false, refetch }
    render(<AccountPage />)
    expect(screen.getByLabelText('Loading your account')).toBeTruthy()
    expect(screen.queryByText('One')).toBeNull()
  })

  it('shows an error with a retry', () => {
    meState = {
      isPending: false,
      isError: true,
      error: new Error('API 500'),
      refetch,
    }
    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('renders every registered section, in order, with a heading each', () => {
    meState = { isPending: false, isError: false, data: me, refetch }
    render(<AccountPage />)
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['One', 'Two'])
    expect(screen.getByText('Ana:false')).toBeTruthy()
  })

  it('shows a flagged section only while its flag is on', () => {
    meState = { isPending: false, isError: false, data: me, refetch }
    const headings = () =>
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    render(<AccountPage />)
    expect(headings()).toEqual(['One', 'Two'])
    expect(screen.queryByText('beta')).toBeNull()
    cleanup()
    flags = { beta: true }
    render(<AccountPage />)
    expect(headings()).toEqual(['One', 'Gated', 'Two'])
  })

  it('sizes the loading skeleton to the visible sections', () => {
    meState = { isPending: true, isError: false, refetch }
    const { container } = render(<AccountPage />)
    expect(container.querySelector('[aria-busy]')?.children.length).toBe(2)
  })

  it('locks the sections while deletion is pending', () => {
    pending = true
    meState = { isPending: false, isError: false, data: me, refetch }
    render(<AccountPage />)
    expect(screen.getByText('Ana:true')).toBeTruthy()
    expect(
      screen.getByText(/paused while your account is scheduled/),
    ).toBeTruthy()
  })
})
