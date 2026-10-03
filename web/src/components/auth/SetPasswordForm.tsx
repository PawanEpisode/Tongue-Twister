import { useState } from 'react'
import { AuthNote } from '#/components/auth/AuthNote'
import CodeForm from '#/components/auth/CodeForm'
import { PasswordField } from '#/components/auth/PasswordField'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { authActions } from '#/lib/authActions'
import { describeAuthError, passwordProblem } from '#/lib/authFlow'
import type { Note } from '#/lib/authFlow'

/**
 * Choose a new password for the signed-in account. Used after a "forgot password" link (the link signs the
 * person in) and from Account → Sign-in & security.
 *
 * If Supabase wants a fresh check before a password change ("secure password change"), the form emails a
 * code, shows the shared code box, and sends the password again together with that code.
 */
export default function SetPasswordForm({
  submitLabel = 'Save password',
  onDone,
  compact = false,
}: {
  submitLabel?: string
  onDone: () => void
  /** Inside a card on another page: the code step uses a smaller heading. */
  compact?: boolean
}) {
  const { session } = useAuth()
  const email = session?.user.email ?? ''
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  const [confirming, setConfirming] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const bad = passwordProblem(password)
    if (bad) return setNote({ kind: 'error', text: bad })
    setNote(null)
    setBusy(true)
    const { error } = await authActions.updatePassword(password)
    if (!error) {
      setBusy(false)
      return onDone()
    }
    const failure = describeAuthError(error)
    if (failure.reauthNeeded) {
      const sent = await authActions.requestReauthCode()
      setBusy(false)
      if (sent.error)
        setNote({ kind: 'error', text: describeAuthError(sent.error).text })
      else setConfirming(true)
      return
    }
    setBusy(false)
    setNote({ kind: 'error', text: failure.text })
  }

  if (confirming)
    return (
      <CodeForm
        compact={compact}
        email={email}
        heading="Confirm it’s you"
        submitLabel="Confirm and save password"
        initialNote={`For your security we’ve emailed you a code. Enter it to save your new password.`}
        verify={(code) => authActions.updatePassword(password, code)}
        resend={authActions.requestReauthCode}
        onVerified={onDone}
      />
    )

  return (
    <form onSubmit={submit} className="space-y-4">
      <PasswordField
        label="New password"
        value={password}
        onChange={setPassword}
        creating
      />
      <AuthNote note={note} />
      <Button disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
    </form>
  )
}
