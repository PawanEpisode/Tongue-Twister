import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechStatus = 'idle' | 'arming' | 'live'
export type SpeechResult = { transcript: string; durationMs: number }

function getCtor(): (new () => any) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Live speech-to-text (free browser Web Speech API) + a mic AnalyserNode for visualisers.
 *
 * Why there is an "arming" phase: the recogniser needs ~0.3–1s after start() before it actually
 * captures audio, so users who talk immediately lose their first words. We only flip to "live"
 * (and show GO!) when the browser reports that audio capture has really begun, and we hold the
 * mic open via getUserMedia so the hardware is already warm.
 */
export function useSpeech(opts: { onFinish?: (r: SpeechResult) => void } = {}) {
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const onFinishRef = useRef(opts.onFinish)
  onFinishRef.current = opts.onFinish

  const recRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const want = useRef(false)
  const finalized = useRef(true)
  const committed = useRef('')
  const session = useRef('')
  const liveAt = useRef(0)
  const speechStart = useRef(0)
  const lastResult = useRef(0)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setSupported(!!getCtor()), [])

  const teardownAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close().catch(() => undefined)
    ctxRef.current = null
    setAnalyser(null)
  }, [])

  const goLive = useCallback(() => {
    if (!want.current || liveAt.current) return
    liveAt.current = Date.now()
    if (armTimer.current) clearTimeout(armTimer.current)
    setStatus('live')
  }, [])

  const finalize = useCallback(() => {
    if (finalized.current) return
    finalized.current = true
    want.current = false
    if (armTimer.current) clearTimeout(armTimer.current)
    if (stopTimer.current) clearTimeout(stopTimer.current)
    teardownAudio()
    setStatus('idle')
    const text = committed.current.trim()
    const from = speechStart.current || liveAt.current
    const to = lastResult.current || Date.now()
    const ms = Math.max(0, to - from)
    setDurationMs(ms)
    if (text) onFinishRef.current?.({ transcript: text, durationMs: ms })
  }, [teardownAudio])

  const startRecognition = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.maxAlternatives = 1
    r.onaudiostart = goLive
    r.onspeechstart = () => {
      goLive()
      if (!speechStart.current) speechStart.current = Date.now()
    }
    r.onresult = (e: any) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++)
        text += e.results[i][0].transcript + ' '
      session.current = text.trim()
      lastResult.current = Date.now()
      if (!speechStart.current) speechStart.current = lastResult.current
      goLive()
      setTranscript(`${committed.current} ${session.current}`.trim())
    }
    r.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        want.current = false
        setError(
          'Microphone permission denied. Allow mic access in your browser and try again.',
        )
      } else if (e.error === 'network') {
        setError('Speech service unreachable — check your connection.')
      } else setError(String(e.error))
    }
    r.onend = () => {
      // Chrome ends sessions after a pause; keep listening until the user (or auto-stop) says stop.
      committed.current = `${committed.current} ${session.current}`.trim()
      session.current = ''
      if (want.current) {
        try {
          startRecognition()
          return
        } catch {
          /* fall through */
        }
      }
      finalize()
    }
    recRef.current = r
    r.start()
  }, [finalize, goLive])

  const start = useCallback(async () => {
    if (!getCtor() || want.current) return
    teardownAudio()
    committed.current = ''
    session.current = ''
    liveAt.current = 0
    speechStart.current = 0
    lastResult.current = 0
    finalized.current = false
    want.current = true
    setTranscript('')
    setError(null)
    setDurationMs(0)
    setStatus('arming')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (!want.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const AC: typeof AudioContext =
        (window as any).AudioContext ?? (window as any).webkitAudioContext
      const ctx = new AC()
      ctxRef.current = ctx
      await ctx.resume()
      const node = ctx.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.7
      ctx.createMediaStreamSource(stream).connect(node)
      setAnalyser(node)
    } catch (err: any) {
      if (
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError'
      ) {
        want.current = false
        finalized.current = true
        setError(
          'Microphone permission denied. Allow mic access in your browser and try again.',
        )
        setStatus('idle')
        return
      }
      // Any other failure (no analyser support etc.): carry on without the visualiser.
    }
    if (!want.current) return
    try {
      startRecognition()
    } catch {
      finalize()
      return
    }
    // Safety net if the browser never reports audiostart.
    armTimer.current = setTimeout(goLive, 1800)
  }, [finalize, goLive, startRecognition, teardownAudio])

  const stop = useCallback(() => {
    if (!want.current) return
    want.current = false
    if (recRef.current) {
      try {
        recRef.current.stop()
      } catch {
        finalize()
      }
      stopTimer.current = setTimeout(finalize, 1500) // if onend never arrives
    } else finalize()
  }, [finalize])

  const reset = useCallback(() => {
    setTranscript('')
    setDurationMs(0)
    setError(null)
  }, [])

  useEffect(
    () => () => {
      want.current = false
      finalized.current = true
      recRef.current?.abort?.()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      void ctxRef.current?.close().catch(() => undefined)
    },
    [],
  )

  return {
    supported,
    status,
    listening: status !== 'idle',
    transcript,
    error,
    durationMs,
    analyser,
    start,
    stop,
    reset,
  }
}
