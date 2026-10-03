import { useEffect, useState } from 'react'
import type { AuthResult } from './authActions'
import {
  MAX_CODE_ATTEMPTS,
  RESEND_COOLDOWN_S,
  cleanCode,
  describeAuthError,
  isCompleteCode,
  secondsLeft,
} from './authFlow'
import type { Note } from './authFlow'
import { isCodeExpired } from './otpConfig'

/**
 * The state behind every "enter the code we emailed you" screen: the typed code, a resend cooldown, a cap on
 * wrong guesses, and a refusal to send a code that has already outlived its lifetime. What the code is *for*
 * (confirm a sign-up, sign in, authorise a password change) is the caller's `verify`; this hook only runs it.
 *
 * Mount it right after a code was sent: the cooldown and the code's age both start at mount.
 */
export function useCodeStep(o: {
  /** Check the code; an `error` counts as a wrong guess. */
  verify: (code: string) => Promise<AuthResult>
  /** Ask for a fresh code. */
  resend: () => Promise<AuthResult>
  onVerified?: () => void
  /** Shown above the box when it opens ("We've sent a code to…"). */
  initialNote?: string
}) {
  const [sentAt, setSentAt] = useState(() => Date.now())
  const [resendAt, setResendAt] = useState(
    () => sentAt + RESEND_COOLDOWN_S * 1000,
  )
  const [now, setNow] = useState(sentAt)
  const [code, setCodeRaw] = useState('')
  const [wrong, setWrong] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(
    o.initialNote ? { kind: 'info', text: o.initialNote } : null,
  )

  const wait = secondsLeft(resendAt, now)
  useEffect(() => {
    if (!wait) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [wait])

  const locked = wrong >= MAX_CODE_ATTEMPTS
  const canSubmit = !busy && !locked && isCompleteCode(code)

  const submit = async () => {
    if (!canSubmit) return
    setNote(null)
    if (isCodeExpired(sentAt, Date.now())) {
      setCodeRaw('')
      setNote({
        kind: 'error',
        text: 'This code has expired. Request a new one.',
      })
      return
    }
    setBusy(true)
    const { error } = await o.verify(code)
    setBusy(false)
    if (!error) return o.onVerified?.()
    const n = wrong + 1
    setWrong(n)
    setCodeRaw('')
    setNote({
      kind: 'error',
      text:
        n >= MAX_CODE_ATTEMPTS
          ? 'Too many wrong codes. Request a new code to try again.'
          : describeAuthError(error).text,
    })
  }

  const requestNew = async () => {
    if (busy || wait > 0) return
    setNote(null)
    setBusy(true)
    const { error } = await o.resend()
    setBusy(false)
    const t = Date.now()
    setNow(t)
    setResendAt(t + RESEND_COOLDOWN_S * 1000)
    if (error) {
      setNote({ kind: 'error', text: describeAuthError(error).text })
      return
    }
    setSentAt(t) // the new code's lifetime starts now; the old one is void
    setCodeRaw('')
    setWrong(0)
    setNote({ kind: 'info', text: 'A new code is on its way.' })
  }

  return {
    code,
    setCode: (raw: string) => setCodeRaw(cleanCode(raw)),
    note,
    busy,
    /** Seconds until "resend" works again; 0 when it does. */
    wait,
    /** Too many wrong guesses: only a new code unlocks the box. */
    locked,
    canSubmit,
    submit,
    requestNew,
  }
}
