import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { GoogleIcon } from '#/components/auth/GoogleIcon'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { authActions } from '#/lib/authActions'
import { GATE_COPY } from '#/lib/gate/intent'
import { isInAppBrowser } from '#/lib/gate/inAppBrowser'
import { rememberGate } from '#/lib/gate/leave'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'

/**
 * The sign-in sheet. It opens only when a visitor tries to do something that needs an account, says why
 * in one line, and hands off to the real sign-in page with a return path so they land back where they were.
 */
export default function GateSheet() {
  const { open, dismiss, proceed } = useGate()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intent = open?.intent
  useEffect(() => {
    if (intent) track('gate_shown', { intent })
  }, [intent])
  const close = () => {
    if (open) track('gate_dismissed', { intent: open.intent })
    dismiss()
  }
  const copy = open ? GATE_COPY[open.intent] : null
  const inApp =
    typeof navigator !== 'undefined' && isInAppBrowser(navigator.userAgent)

  const toLogin = () => {
    if (!open) return
    track('gate_continue', { intent: open.intent, method: 'password' })
    rememberGate(open)
    const to = proceed()
    void nav({ to: '/login', search: { redirect: to } })
  }
  const google = async () => {
    if (!open) return
    track('gate_continue', { intent: open.intent, method: 'google' })
    setBusy(true)
    setError(null)
    rememberGate(open)
    proceed()
    const { error: err } = await authActions.signInWithGoogle()
    if (err) {
      setBusy(false)
      setError('Google sign-in did not start. Try email instead.')
    }
  }

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        {copy && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {copy.title}
              </DialogTitle>
              <DialogDescription>{copy.body}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Button size="lg" className="w-full" onClick={toLogin}>
                {copy.cta}
              </Button>
              {!inApp && (
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={busy}
                  onClick={() => void google()}
                >
                  <GoogleIcon className="size-5" />
                  {busy ? 'Redirecting…' : 'Continue with Google'}
                </Button>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <p className="text-center text-xs text-muted-foreground">
                Free, no card. Already have an account? Use the same button.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
