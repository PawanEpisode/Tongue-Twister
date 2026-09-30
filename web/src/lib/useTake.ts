import { useEffect, useMemo, useState } from 'react'
import { liveHits } from './scoring'
import { useSpeech } from './speech'
import type { SpeechResult } from './speech'
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
}) {
  const { text, focusSounds = [], typed = '', isLong = false, onFinish } = o
  const mic = useMediaPermissions('microphone')
  const lock = usePracticeLock()
  const speech = useSpeech({ onFinish })
  const [showGo, setShowGo] = useState(false)

  // Flash "GO!" the moment the mic is truly capturing, so users never start talking too early.
  useEffect(() => {
    if (speech.status !== 'live') return
    setShowGo(true)
    const id = setTimeout(() => setShowGo(false), 900)
    return () => clearTimeout(id)
  }, [speech.status])

  const spoken =
    speech.status !== 'idle' ? speech.transcript : typed || speech.transcript
  const hits = useMemo(
    () => liveHits(text, spoken, focusSounds),
    [text, focusSounds.join('|'), spoken],
  )
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
