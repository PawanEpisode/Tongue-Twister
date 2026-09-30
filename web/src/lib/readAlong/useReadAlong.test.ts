// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTimeline } from './timeline'
import { useReadAlong } from './useReadAlong'

const TEXT = 'one two three four five six seven eight nine ten'
const tl = (wpm = 120) => buildTimeline(TEXT, wpm, { punctuationPauses: false })

/** Deterministic frame clock: each advance() runs rAF callbacks at 16 ms steps. */
let now = 0
let queue: FrameRequestCallback[] = []
const advance = (ms: number, frame = 16) => {
  for (let t = 0; t < ms; t += frame) {
    now += frame
    const run = queue
    queue = []
    act(() => run.forEach((cb) => cb(now)))
  }
}

beforeEach(() => {
  now = 0
  queue = []
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    queue.push(cb),
  )
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = []
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const setup = (over = {}) =>
  renderHook(
    (p: { timeline: ReturnType<typeof tl> }) =>
      useReadAlong({ loops: 1, countdownS: 0, ...over, timeline: p.timeline }),
    { initialProps: { timeline: tl() } },
  )

describe('useReadAlong', () => {
  it('runs a pass in the timeline duration and completes once', () => {
    const onComplete = vi.fn()
    const { result } = setup({ onComplete })
    act(() => result.current.start())
    expect(result.current.status).toBe('running')
    advance(tl().totalMs + 100)
    expect(result.current.status).toBe('done')
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].passes).toBe(1)
    expect(result.current.index).toBe(9)
  })

  it('ignores a second start while running (idempotent)', () => {
    const { result } = setup()
    act(() => {
      result.current.start()
      result.current.start()
    })
    advance(500)
    expect(result.current.getStats().activeMs).toBeGreaterThan(400)
    expect(result.current.getStats().activeMs).toBeLessThan(600)
  })

  it('counts down before starting, and pausing the countdown cancels it', () => {
    const { result } = setup({ countdownS: 3 })
    act(() => result.current.start())
    expect(result.current).toMatchObject({ status: 'countdown', countdown: 3 })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.countdown).toBe(2)
    act(() => result.current.pause())
    expect(result.current.status).toBe('idle')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.status).toBe('idle')
    act(() => result.current.start())
    for (let s = 0; s < 3; s++)
      act(() => {
        vi.advanceTimersByTime(1000)
      }) // one tick per render
    expect(result.current.status).toBe('running')
  })

  it('pauses, and resumes from the same word', () => {
    const { result } = setup()
    act(() => result.current.start())
    advance(1000)
    act(() => result.current.pause())
    const at = result.current.index
    advance(2000)
    expect(result.current.index).toBe(at)
    act(() => result.current.start())
    expect(result.current.status).toBe('running')
  })

  it('keeps the current word current when speed changes mid-run', () => {
    const { result, rerender } = setup()
    act(() => result.current.start())
    advance(2000)
    const at = result.current.index
    expect(at).toBeGreaterThan(2)
    rerender({ timeline: tl(200) })
    expect(result.current.index).toBe(at)
  })

  it('loops the requested number of passes', () => {
    const onLoopEnd = vi.fn()
    const onComplete = vi.fn()
    const { result } = setup({ loops: 3, onLoopEnd, onComplete })
    act(() => result.current.start())
    advance(tl().totalMs * 3 + 500)
    expect(onLoopEnd).toHaveBeenCalledTimes(3)
    expect(onComplete.mock.calls[0][0].passes).toBe(3)
    expect(result.current.status).toBe('done')
  })

  it('treats a huge frame gap (device sleep) as a pause', () => {
    const { result } = setup()
    act(() => result.current.start())
    advance(200)
    advance(5000, 5000)
    expect(result.current).toMatchObject({ status: 'paused', reason: 'sleep' })
  })

  it('pauses when the tab is hidden and resumes via a 3-2-1', () => {
    const { result } = setup()
    act(() => result.current.start())
    advance(200)
    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toMatchObject({ status: 'paused', reason: 'hidden' })
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    })
    act(() => result.current.start())
    expect(result.current).toMatchObject({ status: 'countdown', countdown: 3 })
  })

  it('seeks by word and clamps', () => {
    const { result } = setup()
    act(() => result.current.seek(4))
    expect(result.current.index).toBe(4)
    act(() => result.current.step(100))
    expect(result.current.index).toBe(9)
    act(() => result.current.step(-100))
    expect(result.current.index).toBe(0)
  })

  it('can skip the countdown (used by Listen)', () => {
    const { result } = setup({ countdownS: 3 })
    act(() => result.current.start({ skipCountdown: true }))
    expect(result.current.status).toBe('running')
  })

  it('starts from the scrubbed position but replays a finished run from the top', () => {
    const { result } = setup()
    act(() => result.current.seek(6))
    act(() => result.current.start())
    expect(result.current.index).toBe(6)
    advance(tl().totalMs + 100)
    expect(result.current.status).toBe('done')
    act(() => result.current.start())
    expect(result.current.index).toBe(0)
    expect(result.current.getStats().passes).toBe(0)
  })

  it('flags a struggling device after a second of slow frames', () => {
    const { result } = setup()
    act(() => result.current.start())
    expect(result.current.degraded).toBe(false)
    advance(1200, 50) // 20 fps
    expect(result.current.degraded).toBe(true)
  })
})
