// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataExport } from './useDataExport'

const exportData = vi.fn()
const saveBlob = vi.fn()
vi.mock('#/lib/api', () => ({ api: { exportData: () => exportData() } }))
vi.mock('./download', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    }
  >
    {children}
  </QueryClientProvider>
)
beforeEach(() => vi.clearAllMocks())

describe('useDataExport', () => {
  it('saves the file under the name the server chose', async () => {
    const blob = new Blob(['{}'])
    exportData.mockResolvedValue({
      blob,
      contentDisposition: 'attachment; filename="twister-export-20261001.json"',
    })
    const { result } = renderHook(() => useDataExport(), { wrapper })
    await act(async () => result.current.mutate())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(saveBlob).toHaveBeenCalledWith(blob, 'twister-export-20261001.json')
    expect(result.current.data).toBe('twister-export-20261001.json')
  })

  it('falls back to a dated name when the header is missing', async () => {
    exportData.mockResolvedValue({ blob: new Blob(), contentDisposition: null })
    const { result } = renderHook(() => useDataExport(), { wrapper })
    await act(async () => result.current.mutate())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatch(/^twister-export-\d{8}\.json$/)
  })

  it('saves nothing and reports an error when the request fails', async () => {
    exportData.mockRejectedValue(new Error('API 429'))
    const { result } = renderHook(() => useDataExport(), { wrapper })
    await act(async () => result.current.mutate())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(saveBlob).not.toHaveBeenCalled()
  })
})
