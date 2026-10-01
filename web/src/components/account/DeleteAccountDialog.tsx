import { useId, useRef, useState } from 'react'
import { friendlyError } from '#/components/feedback'
import { DeleteDialogWrapper } from '#/components/ui/delete-dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
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
    <DeleteDialogWrapper
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      className="sm:max-w-lg"
      title="Delete your account?"
      description={
        <>
          Your account is scheduled for deletion and you have{' '}
          {DELETION_GRACE_DAYS} days to cancel. Share links stop working and you
          leave the leaderboards straight away. After that, we permanently
          delete:
        </>
      }
      confirmLabel="Delete my account"
      cancelLabel="Keep my account"
      pending={request.isPending}
      pendingLabel="Deleting…"
      confirmDisabled={!confirmed}
      onConfirm={submit}
      onCancel={close}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        input.current?.focus()
      }}
    >
      <form
        className="space-y-4 text-left text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (confirmed && !request.isPending) submit()
        }}
      >
        <ul className="list-disc space-y-1 pl-5">
          {DELETED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div>
          <Label htmlFor={inputId} className="mb-1 block font-semibold">
            Type {DELETE_CONFIRM_WORD} to confirm
          </Label>
          <Input
            ref={input}
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>
        {request.isError && (
          <p role="alert" className="text-pink">
            {friendlyError(request.error)}
          </p>
        )}
      </form>
    </DeleteDialogWrapper>
  )
}
