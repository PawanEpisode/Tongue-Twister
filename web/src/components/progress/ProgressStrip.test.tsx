// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Summary } from '#/lib/api'
import { guestQueue } from '#/lib/syncQueue'
import { ProgressStrip } from './ProgressStrip'

let auth = { session: { user: { id: 'u1' } } as object | null, loading: false }
let summaryState: {
  data?: Summary
  isError?: boolean
  error?: unknown
  refetch?: () => void
} = {}
let achievementsFlag = true

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('#/lib/auth', () => ({ useAuth: () => auth }))
vi.mock('#/lib/flags', () => ({ useFlag: () => achievementsFlag }))
vi.mock('#/lib/progress/useSummary', () => ({
  useSummary: () => summaryState,
}))
vi.mock('#/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { facets: () => Promise.resolve({ total: 205 }) },
}))

const summary = (over: Partial<Summary> = {}): Summary => ({
  mastered: 12,
  total: 205,
  current_streak: 4,
  best_streak: 6,
  streak_at_risk: false,
  streak_freezes: 1,
  next_streak_milestone: 7,
  practised_today: false,
  achievements: { unlocked: 6, total: 25 },
  xp: 420,
  level: 3,
  xp_in_level: 20,
  xp_for_next_level: 200,
  timezone: 'UTC',
  today: '2026-10-01',
  unseen_achievements: [],
  ...over,
})

const renderStrip = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProgressStrip />
    </QueryClientProvider>,
  )

beforeEach(() => {
  auth = { session: { user: { id: 'u1' } }, loading: false }
  summaryState = {}
  achievementsFlag = true
  window.localStorage.clear()
})
afterEach(cleanup)

describe('ProgressStrip', () => {
  it('shows a busy skeleton while the summary loads', () => {
    const { container } = renderStrip()
    expect(container.querySelector('[aria-busy]')).not.toBeNull()
  })

  it('shows an error with a retry that refetches', () => {
    const refetch = vi.fn()
    summaryState = { isError: true, error: new Error('API 500'), refetch }
    const { getByRole, getByText } = renderStrip()
    expect(getByRole('alert').textContent).toMatch(
      /Couldn’t load your progress/,
    )
    fireEvent.click(getByText('Try again'))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows mastered, streak and achievements, each linking to /stats', () => {
    summaryState = { data: summary() }
    const { container } = renderStrip()
    const text = container.textContent ?? ''
    expect(text).toContain('12/205')
    expect(text).toContain('6/25')
    expect(text).toContain('4days')
    expect(text).toContain('3 more days to a 7-day streak')
    const links = [...container.querySelectorAll('a')]
    expect(links).toHaveLength(3)
    expect(links.every((a) => a.getAttribute('href') === '/stats')).toBe(true)
    // freeze pips have a text equivalent
    expect(
      container.querySelector('[aria-label*="1 of 2 streak freezes"]'),
    ).not.toBeNull()
  })

  it('encourages a brand-new account instead of showing bare zeros', () => {
    summaryState = {
      data: summary({
        mastered: 0,
        current_streak: 0,
        achievements: { unlocked: 0, total: 25 },
        streak_freezes: 0,
      }),
    }
    const { container } = renderStrip()
    expect(container.textContent).toContain('Say your first twister')
  })

  it('drops the achievements tile when the flag is off', () => {
    achievementsFlag = false
    summaryState = { data: summary() }
    const { container } = renderStrip()
    expect(container.querySelectorAll('a')).toHaveLength(2)
    expect(container.textContent).not.toContain('Achievements')
  })

  it('shows zeros for guests, and the sign-in line only after a local attempt', async () => {
    auth = { session: null, loading: false }
    const first = renderStrip()
    await waitFor(() => expect(first.container.textContent).toContain('0/205'))
    expect(first.container.textContent).not.toContain('Sign in to save')
    first.unmount()

    guestQueue.addAttempt({ twister: 'a', transcript: 'x', duration_ms: 1000 })
    const second = renderStrip()
    await waitFor(() =>
      expect(second.container.textContent).toContain(
        'Sign in to save your progress',
      ),
    )
  })
})
