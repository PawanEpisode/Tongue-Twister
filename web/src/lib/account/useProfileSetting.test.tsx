// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '#/lib/api'
import { useProfileSetting } from './useProfileSetting'

const updateProfile = vi.fn()
vi.mock('#/lib/api', () => ({
  api: { updateProfile: (...a: unknown[]) => updateProfile(...a) },
}))

const me = { id: 'u1', night_owl: false, hide_from_boards: false } as Profile
let qc: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)
const cached = () => qc.getQueryData<Profile>(['me'])

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['me'], me)
  vi.clearAllMocks()
})

describe('useProfileSetting', () => {
  it('flips the cached profile before the server answers and sends only that field', async () => {
    let resolve!: (p: Profile) => void
    updateProfile.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => useProfileSetting('night_owl'), {
      wrapper,
    })

    act(() => result.current.save(true))
    await waitFor(() => expect(cached()?.night_owl).toBe(true))
    expect(updateProfile).toHaveBeenCalledWith({ night_owl: true })
    expect(result.current.status).toBe('saving')

    await act(async () => resolve({ ...me, night_owl: true }))
    await waitFor(() => expect(result.current.status).toBe('saved'))
    expect(cached()?.night_owl).toBe(true)
  })

  it('puts the old value back and reports a failure', async () => {
    updateProfile.mockRejectedValue(new Error('API 500'))
    const { result } = renderHook(() => useProfileSetting('hide_from_boards'), {
      wrapper,
    })

    act(() => result.current.save(true))
    await waitFor(() => expect(result.current.status).toBe('failed'))
    expect(cached()?.hide_from_boards).toBe(false)
  })

  it('clears the failure on the next attempt', async () => {
    updateProfile.mockRejectedValueOnce(new Error('API 500'))
    updateProfile.mockResolvedValueOnce({ ...me, night_owl: true })
    const { result } = renderHook(() => useProfileSetting('night_owl'), {
      wrapper,
    })

    act(() => result.current.save(true))
    await waitFor(() => expect(result.current.status).toBe('failed'))
    act(() => result.current.save(true))
    await waitFor(() => expect(result.current.status).toBe('saved'))
  })
})
