import { AuthNote } from '#/components/auth/AuthNote'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { AuthResult } from '#/lib/authActions'
import { MAX_CODE_ATTEMPTS, OTP_LENGTH } from '#/lib/authFlow'
import { OTP_EXPIRY_SECONDS, formatDuration } from '#/lib/otpConfig'
import { useCodeStep } from '#/lib/useCodeStep'

/**
 * "Enter the code we emailed you." One form for every code flow: confirming a sign-up, signing in with a code,
 * and re-confirming before a sensitive change. The caller says what a correct code does (`verify`) and how to
 * get another (`resend`); the cooldown, attempt cap and expiry rules live in `useCodeStep`.
 */
export default function CodeForm({
  email,
  heading = 'Check your email',
  submitLabel = 'Verify and continue',
  verify,
  resend,
  onVerified,
  onChangeEmail,
  initialNote,
  compact = false,
}: {
  /** Where the code went; shown so a mistyped address is obvious. */
  email: string
  heading?: string
  submitLabel?: string
  verify: (code: string) => Promise<AuthResult>
  resend: () => Promise<AuthResult>
  onVerified?: () => void
  /** Offers "Change email" (e.g. back to the sign-up form). Omit when the address cannot change. */
  onChangeEmail?: () => void
  initialNote?: string
  /** Inside a card on another page (e.g. Account): a smaller heading, no page-sized padding. */
  compact?: boolean
}) {
  const step = useCodeStep({ verify, resend, onVerified, initialNote })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void step.submit()
      }}
      className={compact ? 'space-y-4' : 'w-full max-w-sm space-y-5 py-6'}
    >
      <div>
        {compact ? (
          <h3 className="text-lg font-bold">{heading}</h3>
        ) : (
          <h1 className="font-display text-3xl font-extrabold">{heading}</h1>
        )}
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter the {OTP_LENGTH}-digit code we sent to{' '}
          <b className="break-all">{email}</b>. It’s valid for{' '}
          {formatDuration(OTP_EXPIRY_SECONDS)}.
        </p>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        Code
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`\\d{${OTP_LENGTH}}`}
          maxLength={OTP_LENGTH + 2}
          placeholder={'0'.repeat(OTP_LENGTH)}
          className="text-center font-mono text-2xl tracking-[0.4em]"
          value={step.code}
          onChange={(e) => step.setCode(e.target.value)}
          disabled={step.locked}
          autoFocus
        />
      </label>
      <AuthNote note={step.note} />
      <Button size="lg" className="w-full" disabled={!step.canSubmit}>
        {step.busy ? 'Verifying…' : submitLabel}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Didn’t get it? Check spam, then{' '}
        <button
          type="button"
          onClick={() => void step.requestNew()}
          disabled={step.busy || step.wait > 0}
          className="font-semibold text-brand underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
        >
          {step.wait > 0 ? `resend in ${step.wait}s` : 'resend the code'}
        </button>
        {onChangeEmail && (
          <>
            {' · '}
            <button
              type="button"
              onClick={onChangeEmail}
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              Change email
            </button>
          </>
        )}
      </p>
      {step.locked && (
        <p className="sr-only">
          {MAX_CODE_ATTEMPTS} wrong codes: request a new code to continue.
        </p>
      )}
    </form>
  )
}
