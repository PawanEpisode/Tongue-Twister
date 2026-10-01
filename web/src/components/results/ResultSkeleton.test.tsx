// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResultSkeleton from './ResultSkeleton'
import { useAfter } from '#/lib/useAfter'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ResultSkeleton', () => {
  it('announces that scoring is under way', () => {
    render(<ResultSkeleton />)
    expect(screen.getByRole('status').textContent).toBe('Scoring your take…')
  })
  it('adds a reassurance when the wait runs long', () => {
    render(<ResultSkeleton slow />)
    expect(
      screen.getAllByText('Still working — thanks for waiting.'),
    ).toHaveLength(2)
  })
})

describe('useAfter', () => {
  it('turns true after the delay and resets when inactive', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ on }) => useAfter(on, 4000), {
      initialProps: { on: true },
    })
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(4000))
    expect(result.current).toBe(true)
    rerender({ on: false })
    expect(result.current).toBe(false)
  })
})
