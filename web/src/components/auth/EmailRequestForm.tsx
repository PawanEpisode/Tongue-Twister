import { useState } from 'react'
import { AuthNote } from '#/components/auth/AuthNote'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { AuthResult } from '#/lib/authActions'
import {
  checkEmail,
  describeAuthError,
  emailProblemText,
  normaliseEmail,
} from '#/lib/authFlow'
import type { Note } from '#/lib/authFlow'

/**
 * Ask for an email address and send something to it (a reset link, a sign-in code). Used for people who
 * already have an account, so only a plausible address is required: a disposable-looking one is allowed here
 * (it may be their old account) and the account check happens on the server.
 */
export default function EmailRequestForm({
  heading,
  text,
  submitLabel,
  busyLabel = 'Sending…',
  send,
  onSent,
  onBack,
}: {
  heading: string
  text: string
  submitLabel: string
  busyLabel?: string
  send: (email: string) => Promise<AuthResult>
  onSent: (email: string) => void
  onBack: () => void
}) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setNote(null)
    const checked = checkEmail(email)
    if (!checked.ok && checked.reason !== 'disposable') {
      setNote({ kind: 'error', text: emailProblemText(checked.reason) })
      return
    }
    const address = checked.ok ? checked.email : normaliseEmail(email)
    setBusy(true)
    const { error } = await send(address)
    setBusy(false)
    if (error) setNote({ kind: 'error', text: describeAuthError(error).text })
    else onSent(address)
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 py-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">{heading}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        Email
        <Input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
      </label>
      <AuthNote note={note} />
      <Button size="lg" className="w-full" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          className="font-semibold text-brand underline-offset-4 hover:underline"
        >
          Back to sign in
        </button>
      </p>
    </form>
  )
}
