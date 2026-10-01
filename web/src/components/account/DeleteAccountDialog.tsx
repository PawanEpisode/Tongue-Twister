import { useId, useRef, useState } from 'react'
import { friendlyError } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { Dialog } from '#/components/ui/dialog'
import {
  DELETE_CONFIRM_WORD,
  DELETION_GRACE_DAYS,
  isDeleteConfirmed,
} from '#/lib/account/deletion'
import { useRequestDeletion } from '#/lib/account/useDeletion'

const DELETED = [
  'your profile, XP, streaks and achievements',
  'every attempt, session and stat',
  'your favourites and settings',
  'recordings and their files, and any share links',
  'your sign-in',
]

export default function DeleteAccountDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState('')
  const request = useRequestDeletion()
  const confirmed = isDeleteConfirmed(typed)

  const close = () => {
    setTyped('')
    request.reset()
    onClose()
  }
  const submit = () => request.mutate(undefined, { onSuccess: close })

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Delete your account?"
      initialFocus={input}
    >
      <form
        className="mt-3 space-y-4 text-left text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (confirmed && !request.isPending) submit()
        }}
      >
        <p>
          Your account is scheduled for deletion and you have{' '}
          {DELETION_GRACE_DAYS} days to cancel. Share links stop working and you
          leave the leaderboards straight away. After that, we permanently
          delete:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {DELETED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <label htmlFor={inputId} className="block">
          <span className="mb-1 block font-semibold">
            Type {DELETE_CONFIRM_WORD} to confirm
          </span>
          <input
            ref={input}
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full rounded-xl border border-input bg-card px-3 py-2"
          />
        </label>
        {request.isError && (
          <p role="alert" className="text-pink">
            {friendlyError(request.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            Keep my account
          </Button>
          <Button
            type="submit"
            className="bg-pink text-white"
            disabled={!confirmed || request.isPending}
          >
            {request.isPending ? 'Deleting…' : 'Delete my account'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
