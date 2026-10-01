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
vi.mock('#/lib/useMe', () => ({ useMe: () => meState }))
vi.mock('#/lib/account/useDeletion', () => ({
  useDeletionState: () =>
    pending ? { pending: true, scheduledFor: 'x' } : { pending: false },
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
    { id: 'two', title: 'Two', tone: 'danger', Component: () => <p>second</p> },
  ],
}))
afterEach(() => {
  cleanup()
  pending = false
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
