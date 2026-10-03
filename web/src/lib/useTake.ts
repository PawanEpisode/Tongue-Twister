import { useEffect, useMemo, useState } from 'react'
import { liveHits } from './scoring'
import { useSpeech } from './speech'
import type { AudioParts, SpeechResult } from './speech'
import { usePracticeLock } from './tabLock'
import { useMediaPermissions } from './useMediaPermissions'

/**
 * Everything one spoken take needs, shared by Speak & score, Train and Word drill: mic permission,
 * the recogniser, the practice-tab lock, live word matching, the "GO!" flash and auto-stop.
 * Pure UI stays in `MicStage`; what to do with the finished take is up to `onFinish`.
 */
export function useTake(o: {
  /** What the speaker is meant to say. */
  text: string
  focusSounds?: readonly string[]
  /** Typed answer used instead of speech (browsers without recognition). */
  typed?: string
  /** Long passages wait longer before auto-stopping. */
  isLong?: boolean
  onFinish: (take: SpeechResult) => void
  /** Keep listening through pauses (default). A single word sets this to false for a faster result. */
  continuous?: boolean
  /** Transcripts to consider per utterance (a single word: several, since recognisers guess it badly). */
  alternatives?: number
  /** Optional PCM tap on the same mic stream (Accurate mode). */
  audio?: { onAudio: (a: AudioParts) => void; onTeardown: () => void }
}) {
  const { text, focusSounds = [], typed = '', isLong = false, onFinish } = o
  const mic = useMediaPermissions('microphone')
  const lock = usePracticeLock()
  const speech = useSpeech({
    onFinish,
    continuous: o.continuous,
    alternatives: o.alternatives,
    ...o.audio,
  })
  const [showGo, setShowGo] = useState(false)

  // Flash "GO!" the moment the mic is truly capturing, so users never start talking too early.
  useEffect(() => {
    if (speech.status !== 'live') return
    setShowGo(true)
    const id = setTimeout(() => setShowGo(false), 900)
    return () => clearTimeout(id)
  }, [speech.status])

  const heard =
    speech.status !== 'idle' ? speech.transcript : typed || speech.transcript
  // The recogniser's first guess is not always its best for us: when it offered alternatives, use the
  // one that matches the target most ("seats" → "sees").
  const { spoken, hits } = useMemo(() => {
    let best = heard
    let bestHits = liveHits(text, heard, focusSounds)
    let bestN = bestHits.filter(Boolean).length
    if (speech.status !== 'idle')
      for (const alt of speech.alternatives.slice(1)) {
        const h = liveHits(text, alt.text, focusSounds)
        const n = h.filter(Boolean).length
        if (n > bestN) [best, bestHits, bestN] = [alt.text, h, n]
      }
    return { spoken: best, hits: bestHits }
  }, [text, focusSounds.join('|'), heard, speech.alternatives, speech.status])
  const matched = hits.filter(Boolean).length
  const currentIdx = hits.findIndex((h) => !h)

  // Auto-stop: everything matched, or the speaker went quiet after saying something.
  useEffect(() => {
    if (speech.status !== 'live' || !hits.length) return
    if (matched === hits.length) {
      const id = setTimeout(speech.stop, 600)
      return () => clearTimeout(id)
    }
    if (speech.transcript) {
      const id = setTimeout(speech.stop, isLong ? 4500 : 2800)
      return () => clearTimeout(id)
    }
  }, [
    speech.status,
    speech.transcript,
    speech.stop,
    matched,
    hits.length,
    isLong,
  ])

  // One practising tab at a time.
  useEffect(() => {
    if (speech.status === 'idle') lock.release()
    else lock.claim()
  }, [speech.status, lock])

  const startListening = async () => {
    // Ask only from this tap; skip the extra prompt when access is already known to be granted.
    if (mic.state === 'granted' || (await mic.requestAccess())) speech.start()
  }

  return {
    speech,
    mic,
    lock,
    spoken,
    hits,
    matched,
    currentIdx,
    showGo,
    startListening,
    arming: speech.status === 'arming',
    live: speech.status === 'live',
  }
}
export type Take = ReturnType<typeof useTake>
