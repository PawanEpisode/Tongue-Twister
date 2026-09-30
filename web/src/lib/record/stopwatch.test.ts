import { describe, expect, it } from 'vitest'
import { createStopwatch } from './stopwatch'

describe('stopwatch', () => {
  it('counts only running time', () => {
    const w = createStopwatch()
    w.start(1000)
    expect(w.elapsed(1500)).toBe(500)
    w.pause(2000)
    expect(w.elapsed(9000)).toBe(1000) // paused time does not count
    w.resume(10_000)
    expect(w.elapsed(10_400)).toBe(1400)
    expect(w.running()).toBe(true)
  })
  it('ignores double pause/resume and clock going backwards', () => {
    const w = createStopwatch()
    w.start(0)
    w.pause(100)
    w.pause(200)
    w.resume(300)
    w.resume(400)
    expect(w.elapsed(500)).toBe(300)
    expect(w.elapsed(100)).toBeGreaterThanOrEqual(100)
  })
  it('restarts from zero', () => {
    const w = createStopwatch()
    w.start(0)
    w.pause(500)
    w.start(1000)
    expect(w.elapsed(1100)).toBe(100)
    w.reset()
    expect(w.elapsed(2000)).toBe(0)
    expect(w.running()).toBe(false)
  })
})
