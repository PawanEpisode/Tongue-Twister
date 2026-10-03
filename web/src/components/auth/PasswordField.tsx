import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { MIN_SIGNUP_PASSWORD } from '#/lib/authFlow'

/** A password box with a show/hide toggle. `action` sits on the label row (e.g. "Forgot password?"). */
export function PasswordField({
  value,
  onChange,
  creating,
  label = 'Password',
  action,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  /** A new password is being chosen (stricter length, password-manager "new password" hint). */
  creating: boolean
  label?: string
  action?: ReactNode
  autoFocus?: boolean
}) {
  const [show, setShow] = useState(false)
  const id = useId()
  return (
    // The action sits beside the label, not inside it: a button inside a <label> becomes the label's control.
    <div className="space-y-1.5 text-sm font-medium">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <span className="relative block">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          required
          minLength={creating ? MIN_SIGNUP_PASSWORD : undefined}
          maxLength={72}
          autoComplete={creating ? 'new-password' : 'current-password'}
          placeholder={
            creating
              ? `At least ${MIN_SIGNUP_PASSWORD} characters`
              : 'Your password'
          }
          className="pr-16"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-pressed={show}
          className="absolute inset-y-0 right-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </div>
  )
}
