// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScoreCardShare from './ScoreCardShare'

const createScoreCard = vi.fn()
let session: object | null = { user: { id: 'u1' } }
let flag = true
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useRouterState: () => '/twisters/red-lorry',
}))
vi.mock('#/lib/auth', () => ({ useAuth: () => ({ session }) }))
vi.mock('#/lib/flags', () => ({ useFlag: () => flag }))
vi.mock('#/lib/api', () => ({
  api: { createScoreCard: (...a: unknown[]) => createScoreCard(...a) },
}))

const writeText = vi.fn()
beforeEach(() => {
  session = { user: { id: 'u1' } }
  flag = true
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText }, share: undefined })
  createScoreCard.mockResolvedValue({
    id: 1,
    url: 'https://twister.example/s/abc',
    expires_at: 'x',
  })
})
afterEach(cleanup)

const shareButton = () =>
  screen.getByRole('button', { name: 'Share your score card' })

describe('ScoreCardShare', () => {
  it('renders nothing when the flag is off', () => {
    flag = false
    const { container } = render(<ScoreCardShare attemptId={5} />)
    expect(container.textContent).toBe('')
  })

  it('tells guests to sign in', () => {
    session = null
    render(<ScoreCardShare attemptId={null} />)
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers nothing for a result that was not saved', () => {
    const { container } = render(<ScoreCardShare attemptId={null} />)
    expect(container.textContent).toBe('')
  })

  it('creates the link on tap and copies it with a visible confirmation', async () => {
    render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() => expect(screen.getByText('Link copied')).toBeTruthy())
    expect(createScoreCard).toHaveBeenCalledWith(5)
    expect(writeText).toHaveBeenCalledWith('https://twister.example/s/abc')
  })

  it('reuses the link for the same attempt', async () => {
    render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    fireEvent.click(shareButton())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(createScoreCard).toHaveBeenCalledTimes(1)
  })

  it('makes a new link for a different attempt', async () => {
    const { rerender } = render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() => expect(createScoreCard).toHaveBeenCalledTimes(1))
    rerender(<ScoreCardShare attemptId={6} />)
    fireEvent.click(shareButton())
    await waitFor(() => expect(createScoreCard).toHaveBeenCalledTimes(2))
    expect(createScoreCard).toHaveBeenLastCalledWith(6)
  })

  it('says so and lets the user retry when the link cannot be made', async () => {
    createScoreCard.mockRejectedValueOnce(new Error('API 500'))
    render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() =>
      expect(screen.getByText(/Couldn’t make the link/)).toBeTruthy(),
    )
    expect(writeText).not.toHaveBeenCalled()
    fireEvent.click(shareButton())
    await waitFor(() => expect(screen.getByText('Link copied')).toBeTruthy())
  })

  it('uses the native share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { share })
    render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: 'My Twister score',
        url: 'https://twister.example/s/abc',
      }),
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does not copy when the share sheet is dismissed', async () => {
    const abort = new DOMException('cancelled', 'AbortError')
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(abort) })
    render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() => expect(navigator.share).toHaveBeenCalled())
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies instead when the share sheet refuses', async () => {
    Object.assign(navigator, {
      share: vi
        .fn()
        .mockRejectedValue(new DOMException('no', 'NotAllowedError')),
    })
    render(<ScoreCardShare attemptId={5} />)
    fireEvent.click(shareButton())
    await waitFor(() => expect(screen.getByText('Link copied')).toBeTruthy())
  })
})
