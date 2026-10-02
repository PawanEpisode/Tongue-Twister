/** React glue for Accurate mode: the engine status, the accent choice and the microphone tap. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { AccentLang } from '../api'
import type { Captured, PcmTap } from './engine/runtime/capture'
import type { AccurateEngine, EngineStatus } from './engine/runtime/engine'

const OFF: EngineStatus = { state: 'unavailable', reason: 'no_model' }
const noop = () => () => undefined

/**
 * The engine and its status. Nothing is loaded (no WASM, no worker, no model fetch) until `enabled`, so the
 * feature costs nothing for guests, for anyone with the flag off, and for browsers that cannot run it.
 */
export function useAccurateEngine(enabled: boolean) {
  const [engine, setEngine] = useState<AccurateEngine | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void import('./engine/runtime/instance').then((m) => {
      if (!live) return
      const e = m.getAccurateEngine()
      setEngine(e)
      void e.refresh()
    })
    return () => {
      live = false
    }
  }, [enabled])
  const status = useSyncExternalStore(
    engine?.subscribe ?? noop,
    engine?.getSnapshot ?? (() => OFF),
    () => OFF,
  )
  return { engine: enabled ? engine : null, status: enabled ? status : OFF }
}

const ACCENT_KEY = 'twister.accent.v1'
export const ACCENTS: { value: AccentLang; label: string }[] = [
  { value: 'en-US', label: 'American' },
  { value: 'en-GB', label: 'British' },
  { value: 'en-IN', label: 'Indian' },
  { value: 'en-AU', label: 'Australian' },
]

/** Which accent's pronunciations count as right. Starts from the browser's language, then the person's choice. */
export function guessAccent(language: string | undefined): AccentLang {
  const l = (language ?? '').toLowerCase()
  if (l === 'en-in') return 'en-IN'
  if (l === 'en-gb') return 'en-GB'
  if (l === 'en-au') return 'en-AU'
  return 'en-US'
}

export function useAccent(): [AccentLang, (a: AccentLang) => void] {
  const [accent, setAccent] = useState<AccentLang>('en-US')
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ACCENT_KEY) as AccentLang | null
      setAccent(
        saved && ACCENTS.some((a) => a.value === saved)
          ? saved
          : guessAccent(navigator.language),
      )
    } catch {
      setAccent(guessAccent(navigator.language))
    }
  }, [])
  const choose = useCallback((a: AccentLang) => {
    setAccent(a)
    try {
      window.localStorage.setItem(ACCENT_KEY, a)
    } catch {
      /* not persisted */
    }
  }, [])
  return [accent, choose]
}

type AudioParts = {
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  track?: MediaStreamTrack
}

/**
 * Taps the microphone stream `useSpeech` already opened. `onAudio` starts the tap when a take begins,
 * `onTeardown` stops it (synchronously, while the audio context is closing) and keeps the audio, and `take()`
 * hands it over exactly once. A take with no tap (not enabled, no AudioWorklet) simply yields null.
 */
export function usePcmCapture(active: boolean) {
  const starting = useRef<Promise<PcmTap | null> | null>(null)
  const tap = useRef<PcmTap | null>(null)
  const captured = useRef<Captured | null>(null)

  const onAudio = useCallback(
    ({ ctx, source, track }: AudioParts) => {
      captured.current = null
      if (!active) return
      const p = import('./engine/runtime/tap').then((m) =>
        m.startTap(ctx, source, track),
      )
      starting.current = p
      void p
        .then((t) => {
          if (starting.current !== p)
            t?.cancel() // the take ended before the worklet was ready
          else tap.current = t
        })
        .catch(() => undefined)
    },
    [active],
  )

  const onTeardown = useCallback(() => {
    starting.current = null
    const t = tap.current
    tap.current = null
    if (t) captured.current = t.stop()
  }, [])

  const take = useCallback((): Captured | null => {
    const c = captured.current
    captured.current = null
    return c
  }, [])

  useEffect(() => () => tap.current?.cancel(), [])
  return { onAudio, onTeardown, take }
}
