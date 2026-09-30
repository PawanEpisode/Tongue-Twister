import { describe, expect, it } from 'vitest'
import { errorOf } from './errors'
import {
  HIDDEN_PAUSE_MS,
  WARNING_THRESHOLDS,
  initialState,
  nextWarning,
  reduce,
} from './machine'
import type { Action, MachineState } from './machine'

const LIMIT = 180_000
const run = (start: MachineState, ...actions: Action[]) =>
  actions.reduce(reduce, start)
const inPreview = () =>
  run(initialState(LIMIT), { type: 'open' }, { type: 'ready' })
const recording = () => run(inPreview(), { type: 'begin', countdownS: 0 })

describe('recorder state machine', () => {
  it('walks setup → requesting → preview → countdown → recording → finalizing → review', () => {
    let s = initialState(LIMIT)
    expect(s.phase).toBe('setup')
    s = run(s, { type: 'open' })
    expect(s.phase).toBe('requesting')
    s = run(s, { type: 'ready' })
    expect(s.phase).toBe('preview')
    s = run(s, { type: 'begin', countdownS: 3 })
    expect(s).toMatchObject({ phase: 'countdown', countdown: 3 })
    s = run(s, { type: 'countdown_tick' }, { type: 'countdown_tick' })
    expect(s).toMatchObject({ phase: 'countdown', countdown: 1 })
    s = run(s, { type: 'countdown_tick' })
    expect(s.phase).toBe('recording')
    s = run(s, { type: 'stop', reason: 'user' })
    expect(s).toMatchObject({ phase: 'finalizing', ended: 'user' })
    s = run(s, { type: 'finalized' })
    expect(s.phase).toBe('review')
  })

  it('a zero-second countdown starts recording immediately', () => {
    expect(run(inPreview(), { type: 'begin', countdownS: 0 }).phase).toBe(
      'recording',
    )
  })

  it('can cancel a countdown back to preview', () => {
    const s = run(
      inPreview(),
      { type: 'begin', countdownS: 5 },
      { type: 'cancel_countdown' },
    )
    expect(s.phase).toBe('preview')
  })

  it('pause and resume', () => {
    let s = run(recording(), { type: 'pause', reason: 'user' })
    expect(s).toMatchObject({ phase: 'paused', pause: 'user' })
    s = run(s, { type: 'resume' })
    expect(s).toMatchObject({ phase: 'recording', pause: null })
  })

  it('ignores actions that make no sense in the current phase', () => {
    const s = inPreview()
    expect(run(s, { type: 'pause', reason: 'user' })).toBe(s)
    expect(run(s, { type: 'resume' })).toBe(s)
    expect(run(s, { type: 'stop', reason: 'user' })).toBe(s)
    expect(run(s, { type: 'countdown_tick' })).toBe(s)
    expect(
      run(initialState(LIMIT), { type: 'begin', countdownS: 3 }).phase,
    ).toBe('setup')
    expect(run(recording(), { type: 'time', elapsedMs: 5000 }).elapsedMs).toBe(
      5000,
    )
    expect(run(s, { type: 'time', elapsedMs: 5000 })).toBe(s)
  })

  it('auto-pauses a composited layout when the tab has been hidden, but not a raw one', () => {
    expect(HIDDEN_PAUSE_MS).toBe(3000)
    const paused = run(recording(), {
      type: 'hidden_timeout',
      composited: true,
    })
    expect(paused).toMatchObject({ phase: 'paused', pause: 'tab_hidden' })
    const raw = recording()
    expect(run(raw, { type: 'hidden_timeout', composited: false })).toBe(raw)
  })

  it('does not overwrite a user pause with the hidden-tab pause', () => {
    const s = run(recording(), { type: 'pause', reason: 'user' })
    expect(run(s, { type: 'hidden_timeout', composited: true })).toBe(s)
  })

  it('stops automatically at the limit and never records past it', () => {
    const s = run(recording(), { type: 'time', elapsedMs: LIMIT + 400 })
    expect(s).toMatchObject({
      phase: 'finalizing',
      ended: 'limit',
      elapsedMs: LIMIT,
    })
  })

  it('announces 60 s, 30 s and 10 s warnings once each', () => {
    let s = recording()
    s = run(s, { type: 'time', elapsedMs: LIMIT - 61_000 })
    expect(s.warning).toBeNull()
    s = run(s, { type: 'time', elapsedMs: LIMIT - 60_000 })
    expect(s.warning).toBe(60)
    s = run(
      s,
      { type: 'warning_seen' },
      { type: 'time', elapsedMs: LIMIT - 59_000 },
    )
    expect(s.warning).toBeNull()
    s = run(s, { type: 'time', elapsedMs: LIMIT - 30_000 })
    expect(s.warning).toBe(30)
    s = run(
      s,
      { type: 'warning_seen' },
      { type: 'time', elapsedMs: LIMIT - 10_000 },
    )
    expect(s.warning).toBe(10)
  })

  it('a device failure during recording keeps the take (finalizing, not lost)', () => {
    const s = run(recording(), {
      type: 'fail',
      error: errorOf('recorder_error'),
    })
    expect(s).toMatchObject({ phase: 'finalizing', ended: 'error' })
    expect(s.error?.class).toBe('recorder_error')
  })

  it('a permission failure while asking returns to setup with the reason', () => {
    const s = run(
      initialState(LIMIT),
      { type: 'open' },
      { type: 'fail', error: errorOf('permission_denied') },
    )
    expect(s).toMatchObject({ phase: 'setup' })
    expect(s.error?.class).toBe('permission_denied')
    expect(run(s, { type: 'dismiss_error' }).error).toBeNull()
  })

  it('restart discards the take and goes back to preview with a clean clock', () => {
    let s = run(recording(), { type: 'time', elapsedMs: 40_000 })
    s = run(s, { type: 'restart' })
    expect(s).toMatchObject({ phase: 'preview', elapsedMs: 0, warned: null })
  })

  it('a recovered take goes straight to review; re-record returns to setup', () => {
    const s = run(initialState(LIMIT), { type: 'review' })
    expect(s.phase).toBe('review')
    expect(run(s, { type: 'back_to_setup' }).phase).toBe('setup')
  })

  it('keeps the plan limit through resets', () => {
    expect(
      run(
        initialState(60_000),
        { type: 'set_limit', limitMs: 300_000 },
        { type: 'back_to_setup' },
      ).limitMs,
    ).toBe(300_000)
  })
})

describe('nextWarning', () => {
  it('jumps to the smallest crossed threshold after a long pause', () => {
    expect(nextWarning(LIMIT - 5000, LIMIT, null)).toBe(10)
    expect(nextWarning(LIMIT - 5000, LIMIT, 30)).toBe(10)
    expect(nextWarning(LIMIT - 5000, LIMIT, 10)).toBeNull()
    expect(WARNING_THRESHOLDS).toEqual([60, 30, 10])
  })
})
