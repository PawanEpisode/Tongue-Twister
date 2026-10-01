// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '#/lib/api'
import { useCancelDeletion, useRequestDeletion } from './useDeletion'

const requestDeletion = vi.fn()
const cancelDeletion = vi.fn()
vi.mock('#/lib/api', () => ({
  api: {
    requestDeletion: () => requestDeletion(),
    cancelDeletion: () => cancelDeletion(),
  },
}))
vi.mock('#/lib/useMe', () => ({ useMe: () => ({ data: undefined }) }))

const me = { id: 'u1', deletion_scheduled_for: null } as unknown as Profile
let qc: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['me'], me)
  vi.clearAllMocks()
})

describe('account deletion hooks', () => {
  it('marks the cached profile as pending with the server date', async () => {
    requestDeletion.mockResolvedValue({
      deletion_requested_at: '2026-10-01T00:00:00Z',
      deletion_scheduled_for: '2026-10-31T00:00:00Z',
    })
    const { result } = renderHook(() => useRequestDeletion(), { wrapper })
    await act(async () => result.current.mutate())
    await waitFor(() =>
      expect(qc.getQueryData<Profile>(['me'])?.deletion_scheduled_for).toBe(
        '2026-10-31T00:00:00Z',
      ),
    )
  })

  it('leaves the profile alone when the request fails', async () => {
    requestDeletion.mockRejectedValue(new Error('API 400'))
    const { result } = renderHook(() => useRequestDeletion(), { wrapper })
    await act(async () => result.current.mutate())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(qc.getQueryData<Profile>(['me'])?.deletion_scheduled_for).toBeNull()
  })

  it('clears the date when the deletion is cancelled', async () => {
    qc.setQueryData(['me'], {
      ...me,
      deletion_scheduled_for: '2026-10-31T00:00:00Z',
    })
    cancelDeletion.mockResolvedValue(undefined)
    const { result } = renderHook(() => useCancelDeletion(), { wrapper })
    await act(async () => result.current.mutate())
    await waitFor(() =>
      expect(
        qc.getQueryData<Profile>(['me'])?.deletion_scheduled_for,
      ).toBeNull(),
    )
  })
})
