import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { wordIndexAtChar } from './text'
import { pickVoice, rankVoices } from './voices'

const WPM_PER_RATE_UNIT = 170 // Web Speech rate 1.0 ≈ 170 WPM (PRD 02 §8.9)
// A model reading should be calm and clear, not a race: very slow rates smear phonemes into
// mush and very fast ones clip them, so the voice stays in this window whatever the drill speed.
const CALM_RATE: readonly [number, number] = [0.8, 1]

/** Utterance rate for a target speed, kept in the calm window; `multiplier` is the user's fine-tune (tts_rate). */
export const ttsRate = (wpm: number, multiplier = 1) =>
  Math.min(
    2,
    Math.max(
      0.5,
      Math.min(CALM_RATE[1], Math.max(CALM_RATE[0], wpm / WPM_PER_RATE_UNIT)) *
        multiplier,
    ),
  )

const synth = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null

type Options = {
  text: string
  wpm: number
  lang: string
  voiceURI: string
  rateMultiplier: number
  /** Fired when the model voice reaches a word (browsers without boundary events never call it). */
  onWord: (index: number) => void
  onEnd: () => void
}

/** "Listen first": the browser reads the twister aloud at the chosen pace. Local, no network, no mic. */
export function useListenFirst(o: Options) {
  const [all, setAll] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const opts = useRef(o)
  opts.current = o

  useEffect(() => {
    const s = synth()
    if (!s) return
    const load = () => setAll(s.getVoices())
    load()
    s.addEventListener('voiceschanged', load)
    return () => s.removeEventListener('voiceschanged', load)
  }, [])

  const voices = useMemo(() => rankVoices(all, o.lang), [all, o.lang])
  const ranked = useRef(voices)
  ranked.current = voices

  const stop = useCallback(() => {
    synth()?.cancel()
    setSpeaking(false)
  }, [])

  const listen = useCallback(() => {
    const s = synth()
    if (!s) return
    s.cancel()
    if (s.paused) s.resume() // a paused queue swallows the next utterance in Chrome
    const { text, wpm, lang, voiceURI, rateMultiplier } = opts.current
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = ttsRate(wpm, rateMultiplier)
    const voice = pickVoice(ranked.current, voiceURI)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang // the voice's own language avoids a silent fallback to a different engine
    }
    u.pitch = 0.95 // a touch lower reads as warmer
    u.volume = 1
    u.onboundary = (e) => {
      if (e.name === 'word')
        opts.current.onWord(wordIndexAtChar(text, e.charIndex))
    }
    const done = () => {
      setSpeaking(false)
      opts.current.onEnd()
    }
    u.onend = done
    u.onerror = (e) =>
      e.error !== 'canceled' && e.error !== 'interrupted' && done()
    setSpeaking(true)
    s.speak(u)
  }, [])

  useEffect(() => stop, [stop])

  return { available: voices.length > 0, voices, speaking, listen, stop }
}
