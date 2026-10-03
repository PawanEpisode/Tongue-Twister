import { useState } from 'react'
import SetPasswordForm from '#/components/auth/SetPasswordForm'
import { Button } from '#/components/ui/button'

/** "Change password": a button that opens the shared set-password form, then confirms it worked. */
export default function ChangePasswordForm() {
  const [state, setState] = useState<'closed' | 'open' | 'saved'>('closed')

  if (state === 'open')
    return (
      <div className="space-y-3">
        <SetPasswordForm
          compact
          submitLabel="Save password"
          onDone={() => setState('saved')}
        />
        <button
          type="button"
          onClick={() => setState('closed')}
          className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
        >
          Cancel
        </button>
      </div>
    )

  return (
    <div className="space-y-3">
      {state === 'saved' && (
        <p role="status" className="text-sm text-lime">
          Password updated.
        </p>
      )}
      <Button variant="outline" onClick={() => setState('open')}>
        Change password
      </Button>
    </div>
  )
}
