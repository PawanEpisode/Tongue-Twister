// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFavorite } from './useFavorite'

const setFavorite = vi.fn()
let session: { user: { id: string } } | null = { user: { id: 'u1' } }
vi.mock('../api', () => ({
  api: { setFavorite: (...a: unknown[]) => setFavorite(...a) },
}))
vi.mock('../auth', () => ({ useAuth: () => ({ session }) }))

let qc: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
  window.localStorage.clear()
  session = { user: { id: 'u1' } }
})

describe('useFavorite (signed in)', () => {
  it('flips at once and sends the explicit target state', async () => {
    let resolve!: (v: unknown) => void
    setFavorite.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => useFavorite('red-lorry', false), {
      wrapper,
    })
    expect(result.current.starred).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.starred).toBe(true) // optimistic, before the server answers
    await waitFor(() =>
      expect(setFavorite).toHaveBeenCalledWith('red-lorry', true),
    )
    await act(async () => resolve({ is_favorite: true }))
  })

  it('sends DELETE semantics (false) when un-starring', async () => {
    setFavorite.mockResolvedValue({ is_favorite: false })
    const { result } = renderHook(() => useFavorite('red-lorry', true), {
      wrapper,
    })
    act(() => result.current.toggle())
    expect(result.current.starred).toBe(false)
    await waitFor(() =>
      expect(setFavorite).toHaveBeenCalledWith('red-lorry', false),
    )
  })

  it('rolls back and reports a failure when the request fails', async () => {
    setFavorite.mockRejectedValue(new Error('API 500'))
    const { result } = renderHook(() => useFavorite('red-lorry', false), {
      wrapper,
    })
    act(() => result.current.toggle())
    expect(result.current.starred).toBe(true)
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.starred).toBe(false)
  })

  it('refreshes the lists that show the star', async () => {
    setFavorite.mockResolvedValue({ is_favorite: true })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useFavorite('a', false), { wrapper })
    act(() => result.current.toggle())
    await waitFor(() => expect(spy).toHaveBeenCalled())
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey?.[0])
    expect(keys).toEqual(
      expect.arrayContaining(['twisters', 'favorites', 'summary', 'twister']),
    )
  })
})

describe('useFavorite (guest)', () => {
  it('keeps the star on this device and never calls the API', () => {
    session = null
    const { result } = renderHook(() => useFavorite('a', false), { wrapper })
    expect(result.current.starred).toBe(false)
    expect(result.current.localOnly).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.starred).toBe(true)
    expect(setFavorite).not.toHaveBeenCalled()
    act(() => result.current.toggle())
    expect(result.current.starred).toBe(false)
  })
})
