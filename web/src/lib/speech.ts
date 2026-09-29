import { useCallback, useEffect, useRef, useState } from 'react'

type SR = {
  start: () => void
  stop: () => void
  abort: () => void
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: any) => void) | null
  onend: (() => void) | null
  onerror: ((e: any) => void) | null
}

function getCtor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Live speech-to-text via the free browser Web Speech API (Chrome/Edge/Safari). */
export function useSpeech() {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<SR | null>(null)
  const startedAt = useRef(0)
  const [durationMs, setDurationMs] = useState(0)

  useEffect(() => setSupported(!!getCtor()), [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    setTranscript('')
    setError(null)
    setDurationMs(0)
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++)
        text += e.results[i][0].transcript + ' '
      setTranscript(text.trim())
    }
    r.onerror = (e) =>
      setError(
        e.error === 'not-allowed'
          ? 'Microphone permission denied'
          : String(e.error),
      )
    r.onend = () => {
      setListening(false)
      setDurationMs(Date.now() - startedAt.current)
    }
    rec.current = r
    startedAt.current = Date.now()
    r.start()
    setListening(true)
  }, [])

  const stop = useCallback(() => rec.current?.stop(), [])
  useEffect(() => () => rec.current?.abort(), [])
  return {
    supported,
    listening,
    transcript,
    error,
    durationMs,
    start,
    stop,
    setTranscript,
  }
}
