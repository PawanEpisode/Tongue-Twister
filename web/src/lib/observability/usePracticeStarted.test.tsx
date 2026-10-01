// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePracticeStarted } from './usePracticeStarted'

const track = vi.fn()
vi.mock('./analytics', () => ({ track: (...a: unknown[]) => track(...a) }))
beforeEach(() => track.mockClear())

describe('usePracticeStarted', () => {
  it('fires once when the take goes live, not while it stays live', () => {
    const { rerender } = renderHook(
      ({ live }) => usePracticeStarted('speak_score', live),
      { initialProps: { live: false } },
    )
    expect(track).not.toHaveBeenCalled()
    rerender({ live: true })
    rerender({ live: true })
    expect(track).toHaveBeenCalledExactlyOnceWith('practice_started', {
      mode: 'speak_score',
    })
  })

  it('fires again for the next take', () => {
    const { rerender } = renderHook(
      ({ live }) => usePracticeStarted('speak_score', live),
      { initialProps: { live: true } },
    )
    rerender({ live: false })
    rerender({ live: true })
    expect(track).toHaveBeenCalledTimes(2)
  })
})
