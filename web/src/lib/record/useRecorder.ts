/**
 * Drives one Record-mode take: the state machine (`machine.ts`), the media session (`session.ts`) and the
 * timers around them (countdown, elapsed clock, hidden-tab auto-pause, announcements). The UI only calls the
 * returned actions and renders the returned state.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Capabilities } from './capabilities'
import { classify, errorOf } from './errors'
import type { RecordError } from './errors'
import type { TextLayer, LayoutState } from './layouts/types'
import { HIDDEN_PAUSE_MS, initialState, reduce } from './machine'
import type { PauseReason } from './machine'
import {
  estimateBytes,
  formatClock,
  storageHeadroom,
  videoBitrate,
} from './quality'
import { browserDeps, openSession, SessionOpenError } from './session'
import type { Session, SessionEvent } from './session'
import type { RecordSettings } from './settings'
import type { Take } from './take'
import { track as trackEvent } from '#/lib/observability/analytics'
import { track } from './telemetry'

/** Tell the user how long has been recorded every this often (a per-second timer would flood screen readers). */
export const ANNOUNCE_EVERY_MS = 30_000
const TICK_MS = 200

export type OpenChoices = { audioOnly?: boolean; noMic?: boolean }

export type RecorderOptions = {
  twister: { slug: string; text: string }
  settings: RecordSettings
  caps: Capabilities
  owner: string | null
  limitMs: number
  getRegionElement: () => Element | null
  getText: () => TextLayer
  getLayoutState: () => LayoutState
  getPreviewMirror: () => boolean
  /** The take is ready (blob assembled). */
  onTake: (take: Take) => void
  /** Text engines follow the recorder. */
  onGo?: () => void
  onPause?: () => void
  onResume?: () => void
  onFinalizing?: () => void
  onDiscard?: () => void
}

export type LostDevice = 'camera' | 'mic' | null

export function useRecorder(o: RecorderOptions) {
  const [state, dispatch] = useReducer(reduce, o.limitMs, initialState)
  const [session, setSession] = useState<Session | null>(null)
  const [openError, setOpenError] = useState<SessionOpenError | null>(null)
  const [lost, setLost] = useState<LostDevice>(null)
  const [screenStopped, setScreenStopped] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)

  const opts = useRef(o)
  opts.current = o
  const sessionRef = useRef<Session | null>(null)
  const choicesRef = useRef<OpenChoices>({})
  const openSeq = useRef(0)
  const started = useRef(false)
  const prevPhase = useRef(state.phase)
  const mounted = useRef(true)
  const phaseRef = useRef(state.phase)
  phaseRef.current = state.phase
  const lostRef = useRef<LostDevice>(null)
  lostRef.current = lost
  const lastAnnounced = useRef(0)
  const prevAnnouncePhase = useRef(state.phase)

  const dispose = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    setSession(null)
  }, [])

  // Everything is released when the component goes away (mode switch, route change, unmount).
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      openSeq.current++
      sessionRef.current?.dispose()
      sessionRef.current = null
    }
  }, [])

  useEffect(() => {
    dispatch({ type: 'set_limit', limitMs: o.limitMs })
  }, [o.limitMs])

  const fail = useCallback((e: unknown) => {
    const error =
      e instanceof Object && 'class' in e ? (e as RecordError) : classify(e)
    track('record_error', { class: error.class })
    dispatch({ type: 'fail', error })
  }, [])

  const open = useCallback(
    async (choices?: OpenChoices) => {
      if (choices) choicesRef.current = choices
      const seq = ++openSeq.current
      sessionRef.current?.dispose()
      sessionRef.current = null
      setSession(null)
      setOpenError(null)
      setLost(null)
      setScreenStopped(false)
      dispatch({ type: 'open' })
      track('record_setup_open', {})
      const cur = opts.current
      try {
        const s = await openSession(
          {
            settings: cur.settings,
            twister: cur.twister,
            owner: cur.owner,
            caps: cur.caps,
            audioOnly: choicesRef.current.audioOnly,
            noMic: choicesRef.current.noMic,
            regionElement: cur.getRegionElement(),
            getText: () => opts.current.getText(),
            getLayoutState: () => opts.current.getLayoutState(),
            getPreviewMirror: () => opts.current.getPreviewMirror(),
            onEvent: (e) => eventRef.current(e),
          },
          browserDeps(),
        )
        if (seq !== openSeq.current || !mounted.current) {
          s.dispose() // superseded or unmounted while the browser prompt was open
          return
        }
        sessionRef.current = s
        setSession(s)
        for (const [kind, outcome] of [
          ['camera', s.acquired.camera],
          ['microphone', s.acquired.mic],
        ] as const)
          if (outcome?.ok)
            track('record_permission', { kind, result: 'granted' })
        dispatch({ type: 'ready' })
      } catch (err) {
        if (seq !== openSeq.current || !mounted.current) return
        if (err instanceof SessionOpenError) {
          setOpenError(err)
          for (const [kind, e] of [
            ['camera', err.camera],
            ['microphone', err.mic],
          ] as const)
            if (e)
              track('record_permission', {
                kind,
                result:
                  e.class === 'permission_denied'
                    ? 'denied'
                    : e.class === 'device_missing'
                      ? 'unavailable'
                      : e.class === 'device_busy'
                        ? 'busy'
                        : 'error',
              })
          fail(err.error)
        } else fail(err)
      }
    },
    [fail],
  )

  // Session events (device unplugged, screen sharing stopped, recorder error). A ref keeps the handler
  // current without re-creating the session callbacks.
  const eventRef = useRef<(e: SessionEvent) => void>(() => undefined)
  eventRef.current = (e) => {
    const s = sessionRef.current
    if (!mounted.current || !s) return
    const phase = phaseRef.current
    if (e.type === 'error') return fail(e.error)
    const live = phase === 'recording' || phase === 'paused'
    if (e.type === 'screen_stopped') {
      setScreenStopped(true)
      if (phase === 'recording') {
        if (s.hasCamera && s.composited) {
          dispatch({ type: 'pause', reason: 'screen_stopped' })
          track('record_pause', { reason: 'screen_stopped' })
        } else dispatch({ type: 'stop', reason: 'device' })
      } else if (!live) fail(errorOf('screen_share_stopped'))
      return
    }
    setLost(e.kind)
    if (phase === 'recording') {
      if (s.canReconnect) {
        dispatch({ type: 'pause', reason: 'device_lost' })
        track('record_pause', { reason: 'device_lost' })
      } else dispatch({ type: 'stop', reason: 'device' }) // a raw stream can't be patched: keep what we have
    } else if (!live) fail(errorOf('device_lost'))
  }

  const begin = useCallback(async () => {
    const s = sessionRef.current
    if (!s || phaseRef.current !== 'preview') return
    // Storage guard (PRD 04 §6): refuse to start when free space is under 3× the estimate.
    try {
      const estimate = await navigator.storage?.estimate?.()
      const bytes = estimateBytes(
        opts.current.limitMs,
        videoBitrate(s.size.width, s.size.height),
      )
      const headroom = storageHeadroom(estimate, bytes)
      if (!headroom.ok) return fail(errorOf('out_of_space'))
    } catch {
      /* unknown quota never blocks */
    }
    started.current = false
    dispatch({ type: 'begin', countdownS: opts.current.settings.countdownS })
  }, [fail])

  const pause = useCallback((reason: PauseReason = 'user') => {
    if (phaseRef.current !== 'recording') return
    dispatch({ type: 'pause', reason })
    track('record_pause', { reason })
  }, [])

  const resume = useCallback(async () => {
    if (phaseRef.current !== 'paused') return
    if (lostRef.current) {
      // A lost device must come back first.
      try {
        setBusy(true)
        await sessionRef.current?.reconnect()
        setLost(null)
      } catch (e) {
        setBusy(false)
        return fail(e)
      }
      setBusy(false)
    }
    dispatch({ type: 'resume' })
    track('record_resume', {})
  }, [fail])
  const stop = useCallback(
    (reason: 'user' | 'limit' | 'device' | 'error' | 'tab_hidden' = 'user') => {
      dispatch({ type: 'stop', reason })
    },
    [],
  )

  const continueWithoutScreen = useCallback(() => {
    sessionRef.current?.continueWithoutScreen()
    setScreenStopped(false)
    dispatch({ type: 'resume' })
  }, [])

  const restart = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    await s.discardTake()
    opts.current.onDiscard?.()
    started.current = false
    dispatch({ type: 'restart' })
    setLost(null)
    setScreenStopped(false)
    // straight back into a countdown
    queueMicrotask(() =>
      dispatch({ type: 'begin', countdownS: opts.current.settings.countdownS }),
    )
  }, [])

  const discard = useCallback(async () => {
    await sessionRef.current?.discardTake()
    opts.current.onDiscard?.()
    started.current = false
    dispatch({ type: 'restart' })
    setLost(null)
    setScreenStopped(false)
  }, [])

  const backToSetup = useCallback(() => {
    openSeq.current++
    dispose()
    started.current = false
    setOpenError(null)
    setLost(null)
    setScreenStopped(false)
    dispatch({ type: 'back_to_setup' })
  }, [dispose])

  const cancelCountdown = useCallback(
    () => dispatch({ type: 'cancel_countdown' }),
    [],
  )
  const showReview = useCallback(() => dispatch({ type: 'review' }), [])
  const dismissError = useCallback(
    () => dispatch({ type: 'dismiss_error' }),
    [],
  )

  // ── Phase side effects ────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevPhase.current
    prevPhase.current = state.phase
    const s = sessionRef.current
    if (state.phase === 'recording' && prev !== 'recording') {
      if (!s) return
      if (!started.current) {
        started.current = true
        void s.begin().then(
          () => {
            trackEvent('practice_started', { mode: 'record' })
            track('record_start', {
              layout: s.layout.id,
              res: `${s.size.width}x${s.size.height}`,
              fps: 30,
              mime: s.mime,
            })
            opts.current.onGo?.()
          },
          (e: unknown) => fail(e),
        )
      } else {
        s.resume()
        opts.current.onResume?.()
      }
    } else if (state.phase === 'paused' && prev === 'recording') {
      s?.pause()
      opts.current.onPause?.()
    } else if (state.phase === 'finalizing' && prev !== 'finalizing') {
      opts.current.onFinalizing?.()
      const reason = state.ended ?? 'user'
      const cur = sessionRef.current
      void (async () => {
        try {
          if (!cur) throw errorOf('recorder_error')
          const take = await cur.stop(reason)
          if (!mounted.current) return
          track('record_stop', {
            duration_ms: take.durationMs,
            size_bytes: take.sizeBytes,
            reason,
          })
          opts.current.onTake(take)
          // The take is safe in memory and on disk: release the camera and microphone now.
          dispose()
          dispatch({ type: 'finalized' })
        } catch (e) {
          if (!mounted.current) return
          fail(e)
          dispose()
          dispatch({ type: 'back_to_setup' })
        }
      })()
    }
  }, [state.phase, state.ended, dispose, fail])

  // Countdown: one tick per second; cancelled when the phase changes.
  useEffect(() => {
    if (state.phase !== 'countdown') return
    const id = setTimeout(() => dispatch({ type: 'countdown_tick' }), 1000)
    return () => clearTimeout(id)
  }, [state.phase, state.countdown])

  // Elapsed clock while recording.
  useEffect(() => {
    if (state.phase !== 'recording') return
    const id = setInterval(() => {
      const s = sessionRef.current
      if (s) dispatch({ type: 'time', elapsedMs: s.elapsed() })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [state.phase])

  // Hidden tab: composited layouts stop drawing properly, so pause after 3 s (raw layouts carry on).
  useEffect(() => {
    if (state.phase !== 'recording') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      clearTimeout(timer)
      if (document.hidden) {
        timer = setTimeout(() => {
          const composited = sessionRef.current?.composited ?? false
          if (composited) track('record_pause', { reason: 'tab_hidden' })
          dispatch({ type: 'hidden_timeout', composited })
        }, HIDDEN_PAUSE_MS)
      }
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [state.phase])

  // Recording indicator in the tab title so other tabs notice (PRD 04 §4.3).
  useEffect(() => {
    if (state.phase !== 'recording' && state.phase !== 'paused') return
    const before = document.title
    document.title =
      state.phase === 'recording'
        ? '● Recording — Twister'
        : '⏸ Paused — Twister'
    return () => {
      document.title = before
    }
  }, [state.phase])

  // Screen-reader announcements: state changes and every 30 s, never every second.
  useEffect(() => {
    const prev = prevAnnouncePhase.current
    prevAnnouncePhase.current = state.phase
    if (state.phase === 'recording' && prev !== 'recording') {
      setAnnouncement(
        prev === 'paused' ? 'Recording resumed.' : 'Recording started.',
      )
      lastAnnounced.current = Math.floor(state.elapsedMs / ANNOUNCE_EVERY_MS)
    } else if (state.phase === 'paused') setAnnouncement('Recording paused.')
    else if (state.phase === 'finalizing')
      setAnnouncement('Recording stopped. Preparing your review.')
    else if (state.phase === 'review') setAnnouncement('Review ready.')
    // Only phase changes announce; the elapsed time is read by the 30 s effect below.
  }, [state.phase])
  useEffect(() => {
    if (state.phase !== 'recording') return
    const bucket = Math.floor(state.elapsedMs / ANNOUNCE_EVERY_MS)
    if (bucket > lastAnnounced.current) {
      lastAnnounced.current = bucket
      setAnnouncement(`${formatClock(state.elapsedMs)} recorded.`)
    }
  }, [state.phase, state.elapsedMs])
  useEffect(() => {
    if (state.warning) {
      setAnnouncement(`${state.warning} seconds left.`)
      dispatch({ type: 'warning_seen' })
    }
  }, [state.warning])

  return {
    state,
    session,
    openError,
    lost,
    screenStopped,
    announcement,
    busy,
    open,
    begin,
    pause,
    resume,
    stop,
    restart,
    discard,
    backToSetup,
    continueWithoutScreen,
    showReview,
    cancelCountdown,
    dismissError,
    dispose,
  }
}
