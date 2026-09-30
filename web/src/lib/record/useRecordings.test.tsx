// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingDetail } from '../api'
import { useAnalyse, usePublicName, useStablePlayback } from './useRecordings'

const analyseRecording = vi.fn()
const setPublicName = vi.fn()
vi.mock('../api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    analyseRecording: (...a: unknown[]) => analyseRecording(...a),
    setPublicName: (...a: unknown[]) => setPublicName(...a),
  },
}))
vi.mock('../auth', () => ({ useAuth: () => ({ session: null }) }))

const detail = (over: Partial<RecordingDetail> = {}): RecordingDetail =>
  ({
    id: 'r1',
    status: 'ready',
    playback: {
      url: 'https://x/a',
      mime: 'video/webm',
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    },
    ...over,
  }) as RecordingDetail

let qc: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
})

describe('useStablePlayback', () => {
  it('keeps the first URL across refetches and switches when the stage changes', () => {
    const first = detail()
    const { result, rerender } = renderHook(
      ({ d }: { d: RecordingDetail }) => useStablePlayback(d),
      { initialProps: { d: first } },
    )
    expect(result.current?.url).toBe('https://x/a')
    rerender({
      d: detail({
        playback: { ...first.playback!, url: 'https://x/b' },
      }),
    })
    expect(result.current?.url).toBe('https://x/a')
    rerender({
      d: detail({
        status: 'processing',
        playback: { ...first.playback!, url: 'https://x/c' },
      }),
    })
    expect(result.current?.url).toBe('https://x/c')
  })
  it('is null without data', () => {
    const { result } = renderHook(() => useStablePlayback(undefined))
    expect(result.current).toBeNull()
  })
})

describe('useAnalyse', () => {
  it('writes the returned analysis into the cached detail', async () => {
    analyseRecording.mockResolvedValue({
      analysis: { status: 'queued', audio_ready: false },
    })
    qc.setQueryData(['recordings', 'detail', 'r1'], detail())
    const { result } = renderHook(() => useAnalyse('r1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(analyseRecording).toHaveBeenCalledWith('r1')
    await waitFor(() =>
      expect(
        qc.getQueryData<RecordingDetail>(['recordings', 'detail', 'r1'])
          ?.analysis,
      ).toEqual({ status: 'queued', audio_ready: false }),
    )
  })
})

describe('usePublicName', () => {
  it('stores the updated profile in the me cache', async () => {
    setPublicName.mockResolvedValue({ id: 'p', public_name: 'Ana' })
    const { result } = renderHook(() => usePublicName(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('Ana')
    })
    expect(setPublicName).toHaveBeenCalledWith('Ana')
    expect(qc.getQueryData(['me'])).toEqual({ id: 'p', public_name: 'Ana' })
  })
})
