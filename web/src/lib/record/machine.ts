/**
 * The recorder state machine (08 §2.4): setup → preview → countdown → recording ⇄ paused → finalizing →
 * review. A pure reducer; timers, the media session and React live in `useRecorder`.
 */
import type { RecordingEndedReason } from '../api'
import type { RecordError } from './errors'

export type Phase =
  | 'setup'
  | 'requesting'
  | 'preview'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'review'
export type PauseReason =
  'user' | 'tab_hidden' | 'device_lost' | 'screen_stopped'
/** Seconds left at which we warn (PRD 04 §4.3: −30 s and −10 s; a 60 s heads-up too). */
export const WARNING_THRESHOLDS = [60, 30, 10] as const
export type Warning = (typeof WARNING_THRESHOLDS)[number]
/** A composited layout auto-pauses once the tab has been hidden this long. */
export const HIDDEN_PAUSE_MS = 3000

export type MachineState = {
  phase: Phase
  countdown: number
  pause: PauseReason | null
  ended: RecordingEndedReason | null
  error: RecordError | null
  elapsedMs: number
  limitMs: number
  /** Smallest threshold already announced this take. */
  warned: Warning | null
  /** Set when a warning is due; the UI reads and clears it with `warning_seen`. */
  warning: Warning | null
}

export const initialState = (limitMs: number): MachineState => ({
  phase: 'setup',
  countdown: 0,
  pause: null,
  ended: null,
  error: null,
  elapsedMs: 0,
  limitMs,
  warned: null,
  warning: null,
})

export type Action =
  | { type: 'open' }
  | { type: 'ready' }
  | { type: 'fail'; error: RecordError }
  | { type: 'begin'; countdownS: number }
  | { type: 'countdown_tick' }
  | { type: 'cancel_countdown' }
  | { type: 'pause'; reason: PauseReason }
  | { type: 'resume' }
  | { type: 'time'; elapsedMs: number }
  | { type: 'hidden_timeout'; composited: boolean }
  | { type: 'stop'; reason: RecordingEndedReason }
  | { type: 'finalized' }
  /** A recovered take goes straight to review. */
  | { type: 'review' }
  | { type: 'restart' }
  | { type: 'back_to_setup' }
  | { type: 'set_limit'; limitMs: number }
  | { type: 'warning_seen' }
  | { type: 'dismiss_error' }

/** Which warning (if any) `elapsed` has newly crossed. */
export function nextWarning(
  elapsedMs: number,
  limitMs: number,
  warned: Warning | null,
): Warning | null {
  const left = (limitMs - elapsedMs) / 1000
  // Thresholds run largest to smallest, so the last one crossed is the most urgent.
  const crossed = WARNING_THRESHOLDS.filter((t) => left <= t).at(-1)
  if (crossed === undefined) return null
  return warned === null || crossed < warned ? crossed : null
}

const RECORDING_PHASES: Phase[] = ['recording', 'paused']

export function reduce(state: MachineState, action: Action): MachineState {
  switch (action.type) {
    case 'open':
      return state.phase === 'setup' || state.phase === 'preview'
        ? { ...state, phase: 'requesting', error: null }
        : state
    case 'ready':
      return state.phase === 'requesting' || state.phase === 'setup'
        ? { ...state, phase: 'preview', error: null }
        : state
    case 'fail':
      if (state.phase === 'requesting' || state.phase === 'preview')
        return { ...state, phase: 'setup', error: action.error }
      if (RECORDING_PHASES.includes(state.phase))
        return {
          ...state,
          phase: 'finalizing',
          ended: 'error',
          error: action.error,
        }
      return { ...state, error: action.error }
    case 'begin':
      if (state.phase !== 'preview') return state
      return {
        ...state,
        phase: action.countdownS > 0 ? 'countdown' : 'recording',
        countdown: action.countdownS,
        pause: null,
        ended: null,
        error: null,
        elapsedMs: 0,
        warned: null,
        warning: null,
      }
    case 'countdown_tick': {
      if (state.phase !== 'countdown') return state
      const left = state.countdown - 1
      return left <= 0
        ? { ...state, phase: 'recording', countdown: 0 }
        : { ...state, countdown: left }
    }
    case 'cancel_countdown':
      return state.phase === 'countdown'
        ? { ...state, phase: 'preview', countdown: 0 }
        : state
    case 'pause':
      if (state.phase !== 'recording') return state
      return { ...state, phase: 'paused', pause: action.reason }
    case 'resume':
      if (state.phase !== 'paused') return state
      return { ...state, phase: 'recording', pause: null }
    case 'time': {
      if (state.phase !== 'recording') return state
      if (action.elapsedMs >= state.limitMs)
        return {
          ...state,
          elapsedMs: state.limitMs,
          phase: 'finalizing',
          ended: 'limit',
        }
      const warning = nextWarning(action.elapsedMs, state.limitMs, state.warned)
      return warning
        ? { ...state, elapsedMs: action.elapsedMs, warned: warning, warning }
        : { ...state, elapsedMs: action.elapsedMs }
    }
    case 'hidden_timeout':
      // Raw layouts (camera only, region) keep recording while the tab is hidden.
      return state.phase === 'recording' && action.composited
        ? { ...state, phase: 'paused', pause: 'tab_hidden' }
        : state
    case 'stop':
      if (!RECORDING_PHASES.includes(state.phase)) return state
      return {
        ...state,
        phase: 'finalizing',
        ended: action.reason,
        pause: null,
      }
    case 'finalized':
      return state.phase === 'finalizing'
        ? { ...state, phase: 'review' }
        : state
    case 'review':
      return state.phase === 'setup' || state.phase === 'preview'
        ? { ...state, phase: 'review', error: null, pause: null }
        : state
    case 'restart':
      return RECORDING_PHASES.includes(state.phase) ||
        state.phase === 'countdown'
        ? {
            ...state,
            phase: 'preview',
            pause: null,
            elapsedMs: 0,
            countdown: 0,
            warned: null,
            warning: null,
            ended: null,
          }
        : state
    case 'back_to_setup':
      return { ...initialState(state.limitMs) }
    case 'set_limit':
      return { ...state, limitMs: action.limitMs }
    case 'warning_seen':
      return { ...state, warning: null }
    case 'dismiss_error':
      return { ...state, error: null }
  }
}
