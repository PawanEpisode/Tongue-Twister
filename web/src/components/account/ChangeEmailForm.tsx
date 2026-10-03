import { useState } from 'react'
import { AuthNote } from '#/components/auth/AuthNote'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authActions } from '#/lib/authActions'
import {
  checkEmail,
  describeAuthError,
  emailProblemText,
  normaliseEmail,
} from '#/lib/authFlow'
import type { Note } from '#/lib/authFlow'
import { checkEmailDomain } from '#/lib/emailDns'

/**
 * Change the sign-in email. The same rules as creating an account (a real, permanent address whose domain
 * takes mail), then Supabase emails a confirmation link to the new address: nothing changes until it is opened.
 */
export default function ChangeEmailForm({ current }: { current: string }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setNote(null)
    const checked = checkEmail(email)
    if (!checked.ok)
      return setNote({ kind: 'error', text: emailProblemText(checked.reason) })
    if (checked.email === normaliseEmail(current))
      return setNote({ kind: 'error', text: 'That’s already your email.' })
    setBusy(true)
    const domain = await checkEmailDomain(checked.email)
    if (!domain.ok) {
      setBusy(false)
      return setNote({ kind: 'error', text: domain.message })
    }
    const { error } = await authActions.requestEmailChange(checked.email)
    setBusy(false)
    if (error)
      return setNote({ kind: 'error', text: describeAuthError(error).text })
    setEmail('')
    setNote({
      kind: 'info',
      text: `We’ve sent a confirmation link to ${checked.email}. Your email changes once you open it.`,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Email</span>
        <b className="block break-all text-base">{current || '—'}</b>
      </p>
      <label className="block space-y-1.5 text-sm font-medium">
        New email
        <Input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <AuthNote note={note} />
      <Button variant="outline" disabled={busy}>
        {busy ? 'Sending…' : 'Change email'}
      </Button>
    </form>
  )
}
