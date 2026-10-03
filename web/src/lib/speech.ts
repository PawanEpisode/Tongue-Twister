import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechStatus = 'idle' | 'arming' | 'live'
/**
 * What the speaker should be told while a take is live:
 * - `listening`  mic is open, nothing heard yet
 * - `hearing`    we can hear a voice but the recogniser has not produced words yet
 * - `processing` the voice stopped and the recogniser is still working out the words
 * - `heard`      words are on screen
 */
export type SpeechPhase =
  'idle' | 'arming' | 'listening' | 'hearing' | 'processing' | 'heard'
/** One way the recogniser thinks the speaker's words could be written, best guess first. */
export type Heard = { text: string; confidence: number | null }
export type SpeechResult = {
  transcript: string
  /**
   * Other transcripts the recogniser considered for a one-utterance take (best guess first, includes the
   * transcript itself). Isolated words are where recognisers guess worst — "sees" comes back as "seats" —
   * so a drill checks all of these, not just the first.
   */
  alternatives: Heard[]
  durationMs: number
  /** Total time with no new words for longer than LONG_PAUSE_MS (feeds the fluency score). */
  longPauseMs: number
  /** Recogniser confidence 0–1, when the browser reports one. */
  confidence: number | null
}
/** A silence longer than this counts towards `longPauseMs` (PRD 03 §6). */
export const LONG_PAUSE_MS = 700
/** Quietest mic level (RMS, 0–1) that can count as a voice, however silent the room is. */
export const VOICE_MIN_RMS = 0.015
/** The voice indicator stays on this long after the last loud sample, so it doesn't flicker between syllables. */
export const VOICE_HANGOVER_MS = 400
/**
 * A voice was heard, then this long of quiet, and still no words: the recogniser is stuck. A working one
 * answers within about a second of the end of speech.
 */
export const STUCK_SILENCE_MS = 1500
/** At most this many stuck-recogniser restarts per take; after that the take ends with an explanation. */
export const MAX_KICKS = 2
/** How long a stuck recogniser gets to answer a polite stop() before it is aborted. */
const KICK_ABORT_MS = 1000
/** A recogniser that ends this fast without a single result did not really start. */
const QUICK_END_MS = 500
const MAX_QUICK_ENDS = 4

/** Root-mean-square level of a block of time-domain samples (−1…1). */
export function rmsOf(samples: ArrayLike<number>): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** Is `level` clearly above the room's noise `floor`? */
export function isVoiceLevel(level: number, floor: number): boolean {
  return level > Math.max(VOICE_MIN_RMS, floor * 2.5)
}

/** The message for a take that ended without a single word. */
export function noWordsMessage(heardVoice: boolean): string {
  return heardVoice
    ? 'We heard you but couldn’t make out the words — try again, a little slower and closer to the mic.'
    : 'We didn’t hear anything — check your mic and try again.'
}

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
 *
 * Why there is a voice detector: the recogniser can sit silent for seconds (or forever, on its first
 * session) while the mic is clearly picking up speech. We watch the mic level ourselves so the UI can
 * say "hearing you" straight away, and restart a recogniser that has heard a voice but produced no words.
 */
export type AudioParts = {
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  track?: MediaStreamTrack
}

export function useSpeech(
  opts: {
    onFinish?: (r: SpeechResult) => void
    /** The live mic stream is up: an optional tap (Accurate mode) attaches here. */
    onAudio?: (a: AudioParts) => void
    /** The mic is about to be released: the tap collects what it has (synchronously). */
    onTeardown?: () => void
    /**
     * Keep listening through pauses (default). Turn off for a single word: the browser then ends the
     * take by itself a moment after the word, so the result arrives much sooner.
     */
    continuous?: boolean
    /** How many transcripts the recogniser may offer per utterance (default 1). */
    alternatives?: number
  } = {},
) {
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [voice, setVoice] = useState(false)
  const [heardVoice, setHeardVoice] = useState(false)
  const [alternatives, setAlternatives] = useState<Heard[]>([])

  const onFinishRef = useRef(opts.onFinish)
  onFinishRef.current = opts.onFinish
  const onAudioRef = useRef(opts.onAudio)
  onAudioRef.current = opts.onAudio
  const onTeardownRef = useRef(opts.onTeardown)
  onTeardownRef.current = opts.onTeardown
  const continuousRef = useRef(opts.continuous ?? true)
  continuousRef.current = opts.continuous ?? true
  const alternativesRef = useRef(opts.alternatives ?? 1)
  alternativesRef.current = opts.alternatives ?? 1

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
  const longPause = useRef(0)
  const confidence = useRef<number | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quickEnds = useRef(0)
  const kicks = useRef(0)
  const heardVoiceRef = useRef(false)
  const lastVoiceAt = useRef(0)
  const alts = useRef<Heard[]>([])
  const stopRef = useRef<() => void>(() => undefined)

  useEffect(() => setSupported(!!getCtor()), [])

  const noteVoice = useCallback(() => {
    const now = Date.now()
    lastVoiceAt.current = now
    if (!heardVoiceRef.current) {
      heardVoiceRef.current = true
      setHeardVoice(true)
    }
  }, [])

  const teardownAudio = useCallback(() => {
    onTeardownRef.current?.()
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
    if (restartTimer.current) clearTimeout(restartTimer.current)
    teardownAudio()
    setStatus('idle')
    setVoice(false)
    const text = committed.current.trim()
    const from = speechStart.current || liveAt.current
    const to = lastResult.current || Date.now()
    const ms = Math.max(0, to - from)
    setDurationMs(ms)
    if (text)
      onFinishRef.current?.({
        transcript: text,
        alternatives: alts.current.length
          ? alts.current
          : [{ text, confidence: confidence.current }],
        durationMs: ms,
        longPauseMs: Math.min(longPause.current, ms),
        confidence: confidence.current,
      })
    else {
      // Never leave the speaker staring at a screen that silently did nothing.
      const msg = noWordsMessage(heardVoiceRef.current)
      setError((e) => e ?? msg)
    }
  }, [teardownAudio])

  const startRecognition = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    const r = new Ctor()
    const startedAt = Date.now()
    let gotResult = false
    r.continuous = continuousRef.current
    r.interimResults = true
    r.lang = 'en-US'
    r.maxAlternatives = alternativesRef.current
    r.onaudiostart = goLive
    r.onsoundstart = () => {
      goLive()
      noteVoice()
    }
    r.onspeechstart = () => {
      goLive()
      noteVoice()
      if (!speechStart.current) speechStart.current = Date.now()
    }
    r.onresult = (e: any) => {
      gotResult = true
      quickEnds.current = 0
      let text = ''
      let confSum = 0,
        confN = 0
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript + ' '
        const c = e.results[i][0].confidence
        // Only a finished result has a real confidence. Interim ones carry a placeholder (Chrome: ~0.01), and
        // a take that auto-stops the moment the word turns green ends before any final result arrives.
        if (e.results[i].isFinal && typeof c === 'number' && c > 0) {
          confSum += c
          confN++
        }
      }
      session.current = text.trim()
      // Alternatives only make sense for one utterance; a take stitched from several keeps its best guess.
      const first = e.results[0]
      alts.current =
        e.results.length === 1 && !committed.current && first
          ? Array.from({ length: first.length }, (_, j) => ({
              text: String(first[j].transcript).trim(),
              confidence:
                first.isFinal &&
                typeof first[j].confidence === 'number' &&
                first[j].confidence > 0
                  ? (first[j].confidence as number)
                  : null,
            })).filter((a) => a.text)
          : []
      setAlternatives(alts.current)
      if (confN) confidence.current = confSum / confN
      const now = Date.now()
      if (lastResult.current && now - lastResult.current > LONG_PAUSE_MS)
        longPause.current += now - lastResult.current
      lastResult.current = now
      if (!speechStart.current) speechStart.current = lastResult.current
      goLive()
      noteVoice()
      const last = e.results[e.results.length - 1]
      setInterim(!last?.isFinal)
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
        want.current = false
        setError('Speech service unreachable — check your connection.')
      } else if (e.error === 'audio-capture') {
        want.current = false
        setError('We couldn’t use your microphone — check it is plugged in.')
      } else if (e.error === 'language-not-supported') {
        want.current = false
        setError('This browser can’t recognise English speech.')
      } else {
        // Anything else (e.g. "phrases-not-supported") ends this take: restarting would only fail again.
        want.current = false
        setError(`Speech recognition failed (${String(e.error)}) — try again.`)
      }
    }
    r.onend = () => {
      // A recogniser we already replaced (e.g. after a restart) must not touch the new one's state.
      if (recRef.current !== r) return
      committed.current = `${committed.current} ${session.current}`.trim()
      session.current = ''
      // A single-word take is over as soon as the browser has ended it with words in hand.
      const done = !continuousRef.current && !!committed.current
      if (want.current && !done) {
        // Chrome ends sessions after a pause; keep listening until the user (or auto-stop) says stop.
        // A recogniser that dies instantly, over and over, is broken — say so instead of looping.
        if (!gotResult && Date.now() - startedAt < QUICK_END_MS)
          quickEnds.current++
        if (quickEnds.current >= MAX_QUICK_ENDS) {
          setError(
            'Speech recognition keeps stopping — check your mic and try again.',
          )
          finalize()
          return
        }
        const restart = () => {
          restartTimer.current = null
          if (!want.current) return finalize()
          try {
            startRecognition()
          } catch {
            finalize()
          }
        }
        if (quickEnds.current > 0)
          restartTimer.current = setTimeout(restart, 120 * quickEnds.current)
        else restart()
        return
      }
      finalize()
    }
    recRef.current = r
    r.start()
  }, [finalize, goLive, noteVoice])

  const start = useCallback(async () => {
    if (!getCtor() || want.current) return
    teardownAudio()
    committed.current = ''
    session.current = ''
    liveAt.current = 0
    speechStart.current = 0
    lastResult.current = 0
    longPause.current = 0
    confidence.current = null
    quickEnds.current = 0
    kicks.current = 0
    heardVoiceRef.current = false
    lastVoiceAt.current = 0
    alts.current = []
    finalized.current = false
    want.current = true
    setTranscript('')
    setInterim(false)
    setError(null)
    setDurationMs(0)
    setVoice(false)
    setHeardVoice(false)
    setAlternatives([])
    setStatus('arming')

    let recognising = false
    const begin = () => {
      if (recognising || !want.current) return true
      try {
        startRecognition()
      } catch {
        finalize()
        return false
      }
      recognising = true
      // Safety net if the browser never reports audiostart.
      armTimer.current = setTimeout(goLive, 1800)
      return true
    }

    try {
      // The browser's recogniser opens the mic by itself. On some systems (macOS especially) a second
      // capture with echo cancellation / noise suppression switches the mic into a voice-call mode that
      // leaves the recogniser hearing nothing while our level meter works fine. So the meter's stream is
      // raw. Only the Accurate-mode tap, which wants evened-out levels, asks for the processing.
      const processing = !!onAudioRef.current
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: processing,
          noiseSuppression: processing,
          autoGainControl: processing,
        },
      })
      if (!want.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      // Start the recogniser the moment the mic is ours — before the audio graph below — so
      // nothing here delays the first words.
      if (!begin()) return
      const AC: typeof AudioContext =
        (window as any).AudioContext ?? (window as any).webkitAudioContext
      const ctx = new AC()
      ctxRef.current = ctx
      await ctx.resume()
      const node = ctx.createAnalyser()
      node.fftSize = 512
      node.smoothingTimeConstant = 0.7
      const source = ctx.createMediaStreamSource(stream)
      source.connect(node)
      onAudioRef.current?.({
        ctx,
        source,
        track: stream.getAudioTracks()[0],
      })
      if (want.current) setAnalyser(node)
    } catch (err: any) {
      if (
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError'
      ) {
        want.current = false
        finalized.current = true
        if (recRef.current) recRef.current.abort?.()
        setError(
          'Microphone permission denied. Allow mic access in your browser and try again.',
        )
        setStatus('idle')
        return
      }
      // Any other failure (no analyser support etc.): carry on without the visualiser.
    }
    begin()
  }, [finalize, goLive, startRecognition, teardownAudio])

  // Watch the mic level while live: drives the "hearing you" state, and unsticks a recogniser
  // that has heard a voice but produced nothing.
  useEffect(() => {
    if (!analyser || status !== 'live') return
    const buf = new Float32Array(analyser.fftSize)
    // Start from a quiet-room guess, not the first sample, which may already be the speaker.
    let floor = 0.005
    const id = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      const level = rmsOf(buf)
      if (level < floor) floor = level
      else if (!isVoiceLevel(level, floor)) floor += (level - floor) * 0.05
      const now = Date.now()
      if (isVoiceLevel(level, floor)) noteVoice()
      setVoice(
        lastVoiceAt.current > 0 &&
          now - lastVoiceAt.current < VOICE_HANGOVER_MS,
      )
      if (
        want.current &&
        !lastResult.current &&
        lastVoiceAt.current > 0 &&
        now - lastVoiceAt.current > STUCK_SILENCE_MS
      ) {
        lastVoiceAt.current = 0 // the next voice starts a new wait
        const r = recRef.current
        if (kicks.current >= MAX_KICKS) {
          // Restarting did not help: end the take with an explanation instead of an endless wait.
          stopRef.current()
          return
        }
        kicks.current++
        // stop() makes a recogniser that did capture audio hand over what it has; onend then starts a fresh
        // one because we still want audio. If it will not even stop, abort it.
        try {
          r?.stop()
        } catch {
          /* already gone */
        }
        setTimeout(() => {
          if (recRef.current === r && want.current)
            try {
              r?.abort()
            } catch {
              /* already gone */
            }
        }, KICK_ABORT_MS)
      }
    }, 60)
    return () => clearInterval(id)
  }, [analyser, status, noteVoice])

  const stop = useCallback(() => {
    if (!want.current) return
    want.current = false
    if (restartTimer.current) {
      // Between two recognisers: nothing is running to wait for.
      clearTimeout(restartTimer.current)
      restartTimer.current = null
      finalize()
      return
    }
    if (recRef.current) {
      try {
        recRef.current.stop()
      } catch {
        finalize()
      }
      stopTimer.current = setTimeout(finalize, 1500) // if onend never arrives
    } else finalize()
  }, [finalize])

  stopRef.current = stop

  const reset = useCallback(() => {
    setTranscript('')
    setInterim(false)
    setDurationMs(0)
    setError(null)
  }, [])

  useEffect(
    () => () => {
      want.current = false
      finalized.current = true
      if (armTimer.current) clearTimeout(armTimer.current)
      if (stopTimer.current) clearTimeout(stopTimer.current)
      if (restartTimer.current) clearTimeout(restartTimer.current)
      recRef.current?.abort?.()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      void ctxRef.current?.close().catch(() => undefined)
    },
    [],
  )

  const phase: SpeechPhase =
    status === 'idle'
      ? 'idle'
      : status === 'arming'
        ? 'arming'
        : transcript
          ? 'heard'
          : voice
            ? 'hearing'
            : heardVoice
              ? 'processing'
              : 'listening'

  return {
    supported,
    status,
    phase,
    listening: status !== 'idle',
    transcript,
    /** The words on screen are still being revised by the recogniser. */
    interim,
    /** Other transcripts of the current utterance, best first (needs `alternatives` > 1). */
    alternatives,
    /** A voice is being picked up by the mic right now. */
    voice,
    error,
    durationMs,
    analyser,
    start,
    stop,
    reset,
  }
}
