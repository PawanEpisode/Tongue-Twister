import { useCallback, useEffect, useRef, useState } from 'react'
import { wordIndexAtChar } from './text'

const WPM_PER_RATE_UNIT = 170 // Web Speech rate 1.0 ≈ 170 WPM (PRD 02 §8.9)

/** Utterance rate for a target speed; `multiplier` is the user's fine-tune (tts_rate). */
export const ttsRate = (wpm: number, multiplier = 1) =>
  Math.min(2, Math.max(0.5, wpm / WPM_PER_RATE_UNIT)) * multiplier

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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const opts = useRef(o)
  opts.current = o

  useEffect(() => {
    const s = synth()
    if (!s) return
    const load = () =>
      setVoices(
        s.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')),
      )
    load()
    s.addEventListener('voiceschanged', load)
    return () => s.removeEventListener('voiceschanged', load)
  }, [])

  const stop = useCallback(() => {
    synth()?.cancel()
    setSpeaking(false)
  }, [])

  const listen = useCallback(() => {
    const s = synth()
    if (!s) return
    s.cancel()
    const { text, wpm, lang, voiceURI, rateMultiplier } = opts.current
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = ttsRate(wpm, rateMultiplier)
    u.voice = s.getVoices().find((v) => v.voiceURI === voiceURI) ?? null
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
