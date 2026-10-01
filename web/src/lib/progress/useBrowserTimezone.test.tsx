// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserTimezone } from './useBrowserTimezone'

const setTimezone = vi.fn()
let profileZone: string | undefined = 'UTC'
vi.mock('../api', () => ({
  api: { setTimezone: (...a: unknown[]) => setTimezone(...a) },
}))
vi.mock('../useMe', () => ({
  useMe: () => ({ data: profileZone ? { timezone: profileZone } : undefined }),
}))
vi.mock('./timezone', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  browserTimeZone: () => 'Asia/Kolkata',
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
)
beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  profileZone = 'UTC'
})

describe('useBrowserTimezone', () => {
  it('patches the profile once, then never again on this device', async () => {
    setTimezone.mockResolvedValue({})
    const first = renderHook(() => useBrowserTimezone(), { wrapper })
    await waitFor(() =>
      expect(setTimezone).toHaveBeenCalledWith('Asia/Kolkata'),
    )
    await waitFor(() =>
      expect(window.localStorage.getItem('twister.tz.synced.v1')).toBe(
        'Asia/Kolkata',
      ),
    )
    first.unmount()
    renderHook(() => useBrowserTimezone(), { wrapper })
    expect(setTimezone).toHaveBeenCalledTimes(1)
  })

  it('stays quiet and retries next visit when the request fails', async () => {
    setTimezone.mockRejectedValue(new Error('offline'))
    renderHook(() => useBrowserTimezone(), { wrapper })
    await waitFor(() => expect(setTimezone).toHaveBeenCalled())
    expect(window.localStorage.getItem('twister.tz.synced.v1')).toBeNull()
  })

  it('leaves an account that already has a zone alone', () => {
    profileZone = 'Europe/Paris'
    renderHook(() => useBrowserTimezone(), { wrapper })
    expect(setTimezone).not.toHaveBeenCalled()
  })
})
