// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectCapabilities } from './capabilities'
import { DEFAULT_SETTINGS } from './settings'
import type { Session } from './session'
import { useRecorder } from './useRecorder'

const track = vi.fn()
vi.mock('#/lib/observability/analytics', () => ({
  track: (...a: unknown[]) => track(...a),
}))

const dispose = vi.fn()
let releaseOpen: (() => void) | null = null
let holdOpen = false

const fakeSession = (): Session =>
  ({
    dispose,
    hasCamera: true,
    composited: true,
    canReconnect: true,
    elapsed: () => 0,
    acquired: {},
    begin: async () => undefined,
    layout: { id: 'camera' },
    size: { width: 1280, height: 720 },
    mime: 'video/webm',
  }) as unknown as Session

vi.mock('./session', () => ({
  browserDeps: () => ({}),
  SessionOpenError: class SessionOpenError extends Error {},
  openSession: vi.fn(async () => {
    if (holdOpen) await new Promise<void>((r) => (releaseOpen = r))
    return fakeSession()
  }),
}))

const options = () => ({
  twister: { slug: 'x', text: 'a b c' },
  settings: DEFAULT_SETTINGS,
  caps: detectCapabilities({}),
  owner: null,
  limitMs: 60_000,
  getRegionElement: () => null,
  getText: () => ({ words: [], current: -1, hits: [] }),
  getLayoutState: () => ({
    bubble: DEFAULT_SETTINGS.bubble,
    splitRatio: 0.5,
    textScale: 1,
    mirror: false,
  }),
  getPreviewMirror: () => true,
  onTake: () => undefined,
})

beforeEach(() => {
  dispose.mockClear()
  track.mockClear()
  holdOpen = false
  releaseOpen = null
})

describe('useRecorder teardown', () => {
  it('releases the media session when the component unmounts (mode switch)', async () => {
    const { result, unmount } = renderHook(() => useRecorder(options()))
    await act(async () => {
      await result.current.open()
    })
    expect(result.current.state.phase).toBe('preview')
    unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('releases the session when the user goes back to setup', async () => {
    const { result } = renderHook(() => useRecorder(options()))
    await act(async () => {
      await result.current.open()
    })
    act(() => result.current.backToSetup())
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(result.current.session).toBeNull()
    expect(result.current.state.phase).toBe('setup')
  })

  it('discards a session that finishes opening after the component was unmounted', async () => {
    holdOpen = true
    const { result, unmount } = renderHook(() => useRecorder(options()))
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open()
    })
    unmount()
    await act(async () => {
      releaseOpen?.()
      await opening
    })
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('useRecorder analytics', () => {
  it('reports practice_started (record) once the take has really begun', async () => {
    const { result } = renderHook(() =>
      useRecorder({
        ...options(),
        settings: { ...DEFAULT_SETTINGS, countdownS: 0 },
      }),
    )
    await act(async () => {
      await result.current.open()
    })
    expect(track).not.toHaveBeenCalledWith(
      'practice_started',
      expect.anything(),
    )
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.state.phase).toBe('recording')
    expect(track).toHaveBeenCalledWith('practice_started', { mode: 'record' })
    expect(
      track.mock.calls.filter(([n]) => n === 'practice_started'),
    ).toHaveLength(1)
  })
})
