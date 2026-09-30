import { useCallback, useEffect, useRef, useState } from 'react'
import { indexAt, remapElapsed } from './timeline'
import type { Timeline } from './timeline'

export type EngineStatus = 'idle' | 'countdown' | 'running' | 'paused' | 'done'
/** Why a run is paused; anything but 'user' resumes through a short 3-2-1 (PRD 02 §8.4). */
export type PauseReason = 'user' | 'hidden' | 'sleep'
export type RunStats = { activeMs: number; passes: number }
export type FrameListener = (elapsedMs: number, index: number) => void

const SLEEP_GAP_MS = 1000 // a frame gap this long means the device slept: treat as a pause
const RESUME_COUNTDOWN_S = 3
const SLOW_FRAME_MS = 32 // sustained slower than ~30 fps means the device can't keep up
const SLOW_FOR_MS = 1000

type Options = {
  timeline: Timeline
  /** Passes per run; 0 = loop until stopped. */
  loops: number
  countdownS: number
  onLoopEnd?: (loop: number) => void
  onComplete?: (stats: RunStats) => void
}

/**
 * Headless Read-along scheduler (also the teleprompter engine for Record mode, R12).
 *
 * One requestAnimationFrame loop accumulates real frame deltas, so timing cannot drift the way
 * chained timeouts do; React state changes only when the current *word* changes. Per-frame
 * consumers (continuous scroll) subscribe instead of re-rendering.
 */
export function useReadAlong(opts: Options) {
  const [status, setStatus] = useState<EngineStatus>('idle')
  const [index, setIndex] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [loop, setLoop] = useState(1)
  const [reason, setReason] = useState<PauseReason>('user')
  const [degraded, setDegraded] = useState(false)

  const o = useRef(opts)
  o.current = opts
  const timeline = useRef(opts.timeline)
  const elapsed = useRef(0)
  const stats = useRef<RunStats>({ activeMs: 0, passes: 0 })
  const statusRef = useRef<EngineStatus>('idle')
  const indexRef = useRef(0)
  const listeners = useRef(new Set<FrameListener>())
  const reasonRef = useRef(reason)
  reasonRef.current = reason
  const loopRef = useRef(loop)
  loopRef.current = loop

  const changeStatus = useCallback((next: EngineStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const moveTo = useCallback((ms: number) => {
    elapsed.current = ms
    const i = indexAt(timeline.current, ms)
    indexRef.current = i
    setIndex(i)
    listeners.current.forEach((fn) => fn(ms, i))
  }, [])

  const beginCountdown = useCallback(
    (seconds: number) => {
      if (seconds <= 0) return changeStatus('running')
      setCountdown(seconds)
      changeStatus('countdown')
    },
    [changeStatus],
  )

  const pause = useCallback(
    (why: PauseReason = 'user') => {
      const s = statusRef.current
      if (s !== 'running' && s !== 'countdown') return
      setReason(why)
      // Pausing a countdown that never started the run just cancels it.
      changeStatus(
        s === 'countdown' && elapsed.current === 0 && stats.current.passes === 0
          ? 'idle'
          : 'paused',
      )
    },
    [changeStatus],
  )

  const start = useCallback(
    ({ skipCountdown = false }: { skipCountdown?: boolean } = {}) => {
      const s = statusRef.current
      if (s === 'running' || s === 'countdown') return // idempotent: double taps are ignored
      if (s === 'paused')
        return beginCountdown(
          reasonRef.current === 'user' ? 0 : RESUME_COUNTDOWN_S,
        )
      if (s === 'done') {
        // Replaying a finished run begins a new session; otherwise keep the position (scrub, long-press, restart→0).
        stats.current = { activeMs: 0, passes: 0 }
        moveTo(0)
      }
      setLoop(1)
      beginCountdown(skipCountdown ? 0 : o.current.countdownS)
    },
    [beginCountdown, moveTo],
  )

  const restart = useCallback(() => {
    moveTo(0)
    setLoop(1)
    changeStatus('idle')
  }, [changeStatus, moveTo])

  const seek = useCallback(
    (i: number) => {
      const tl = timeline.current
      moveTo(tl.starts[Math.min(Math.max(0, i), tl.starts.length - 1)] ?? 0)
    },
    [moveTo],
  )
  const step = useCallback(
    (delta: number) => seek(indexRef.current + delta),
    [seek],
  )
  const toggle = useCallback(() => {
    const s = statusRef.current
    if (s === 'running' || s === 'countdown') pause()
    else start()
  }, [pause, start])

  const subscribe = useCallback((fn: FrameListener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])
  const getStats = useCallback(() => ({ ...stats.current }), [])

  // Speed change mid-run: the current word stays current.
  useEffect(() => {
    if (opts.timeline === timeline.current) return
    const ms = remapElapsed(timeline.current, opts.timeline, elapsed.current)
    timeline.current = opts.timeline
    moveTo(ms)
  }, [opts.timeline, moveTo])

  // Countdown ticks (cancelled by cleanup when paused or unmounted).
  useEffect(() => {
    if (status !== 'countdown') return
    if (countdown <= 0) return changeStatus('running')
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [status, countdown, changeStatus])

  // The scheduler.
  useEffect(() => {
    if (status !== 'running') return
    let raf = 0
    let last = performance.now()
    let slowMs = 0

    const passFinished = (): boolean => {
      stats.current.passes += 1
      const finished = loopRef.current
      o.current.onLoopEnd?.(finished)
      const { loops, countdownS } = o.current
      if (loops === 0 || finished < loops) {
        setLoop(finished + 1)
        moveTo(0)
        if (countdownS > 0) {
          beginCountdown(countdownS)
          return false
        }
        return true
      }
      moveTo(timeline.current.starts.at(-1) ?? 0)
      changeStatus('done')
      o.current.onComplete?.({ ...stats.current })
      return false
    }

    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (dt > SLEEP_GAP_MS) return pause('sleep')
      slowMs = dt > SLOW_FRAME_MS ? slowMs + dt : 0
      if (slowMs >= SLOW_FOR_MS) setDegraded(true)
      elapsed.current += dt
      stats.current.activeMs += dt
      if (elapsed.current >= timeline.current.totalMs && !passFinished()) return
      const i = indexAt(timeline.current, elapsed.current)
      if (i !== indexRef.current) {
        indexRef.current = i
        setIndex(i)
      }
      listeners.current.forEach((fn) => fn(elapsed.current, i))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status, pause, moveTo, beginCountdown, changeStatus])

  // Hidden tab: rAF is throttled, so pause honestly instead of drifting (PRD 02 §5).
  useEffect(() => {
    const onHide = () => document.hidden && pause('hidden')
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [pause])

  return {
    status,
    index,
    countdown,
    loop,
    reason,
    degraded,
    start,
    pause,
    toggle,
    restart,
    seek,
    step,
    subscribe,
    getStats,
  }
}
