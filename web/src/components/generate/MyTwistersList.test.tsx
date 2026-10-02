// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyTwistersScreen from './MyTwistersScreen'

vi.mock('#/lib/supabase', () => ({ getAccessToken: async () => null }))
vi.mock('#/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const fetchMock = vi.fn()
const reply = (status: number, body?: unknown) =>
  Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  )

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MyTwistersScreen />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('MyTwistersList', () => {
  it('shows an empty state', async () => {
    fetchMock.mockReturnValue(reply(200, { count: 0, results: [] }))
    setup()
    expect(await screen.findByText(/haven’t made any/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /make one/i })).toBeTruthy()
  })

  it('shows an error with retry', async () => {
    fetchMock.mockReturnValue(reply(503, { error: { code: 'x' } }))
    setup()
    expect((await screen.findByRole('alert')).textContent).toMatch(/resting/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('lists twisters and deletes one after confirming', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return reply(204)
      return reply(200, {
        count: 2,
        results: [
          { id: 1, slug: 'a', text: 'Alpha twister' },
          { id: 2, slug: 'b', text: 'Beta twister' },
        ],
      })
    })
    setup()
    expect(await screen.findByText('Alpha twister')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: /delete twister: alpha twister/i }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            (c[1] as RequestInit | undefined)?.method === 'DELETE' &&
            String(c[0]).endsWith('/me/twisters/1/'),
        ),
      ).toBe(true),
    )
  })

  it('starts a new twister and offers practise once it has been tried', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        count: 2,
        results: [
          {
            id: 1,
            slug: 'fresh',
            text: 'Alpha twister',
            attempts_count: 0,
            best_score: null,
            word_count: 2,
            focus_sounds: [],
          },
          {
            id: 2,
            slug: 'tried',
            text: 'Beta twister',
            attempts_count: 1,
            best_score: 29,
            word_count: 2,
            focus_sounds: ['b'],
          },
        ],
      }),
    )
    setup()
    expect(await screen.findByRole('link', { name: 'Start' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise' })).toBeTruthy()
    expect(screen.getByText('Not tried yet')).toBeTruthy()
    expect(screen.getByText('29')).toBeTruthy()
    expect(screen.getByText(/1 try/)).toBeTruthy()
  })

  it('highlights the trap words and filters by length', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        count: 2,
        results: [
          {
            id: 1,
            slug: 'bears',
            text: 'Brisk brown bears bring blue bundles by the bay',
            word_count: 9,
            focus_sounds: ['b', 'br', 'bl'],
            attempts_count: 0,
          },
          {
            id: 2,
            slug: 'long',
            text: Array.from({ length: 50 }, () => 'word').join(' '),
            word_count: 50,
            focus_sounds: [],
            attempts_count: 0,
          },
        ],
      }),
    )
    setup()
    expect(
      await screen.findByRole('button', { name: /show the trap/i }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /show the trap/i }))
    expect(screen.getByText('Brisk').className).toMatch(/text-cyan/)
    expect(screen.getByText('by').className).not.toMatch(/text-cyan/)

    fireEvent.click(screen.getByRole('button', { name: /^long/i }))
    expect(screen.queryByText('Brisk')).toBeNull()
    expect(screen.getByText(/50 words/)).toBeTruthy()
  })
})
