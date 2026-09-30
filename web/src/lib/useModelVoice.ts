import { useCallback, useEffect, useRef, useState } from 'react'
import { pickVoice, rankVoices } from './readAlong/voices'

/** Reads a word or phrase aloud in the learner's chosen accent, for "how should it sound?". Local; no mic. */
export function useModelVoice(lang: string, voiceURI: string) {
  const synth =
    typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis
      : null
  const [speaking, setSpeaking] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      synth?.cancel()
    }
  }, [synth])

  const say = useCallback(
    (text: string, rate = 1) => {
      if (!synth) return
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      u.rate = rate
      const voice = pickVoice(rankVoices(synth.getVoices(), lang), voiceURI)
      if (voice) u.voice = voice
      u.onstart = () => alive.current && setSpeaking(true)
      u.onend = u.onerror = () => alive.current && setSpeaking(false)
      synth.speak(u)
    },
    [synth, lang, voiceURI],
  )
  const stop = useCallback(() => {
    synth?.cancel()
    setSpeaking(false)
  }, [synth])

  return { supported: !!synth, speaking, say, stop }
}
