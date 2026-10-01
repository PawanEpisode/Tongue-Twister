import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { DELETION_GRACE_DAYS, formatDeletionDate } from '#/lib/account/deletion'
import { useDeletionState } from '#/lib/account/useDeletion'
import CancelDeletionButton from './CancelDeletionButton'
import DeleteAccountDialog from './DeleteAccountDialog'

export default function DeleteSection() {
  const state = useDeletionState()
  const [open, setOpen] = useState(false)

  if (state.pending)
    return (
      <div className="space-y-3 text-sm">
        <p>
          Your account will be deleted on{' '}
          <b>{formatDeletionDate(state.scheduledFor)}</b>. Until then you can
          change your mind.
        </p>
        <CancelDeletionButton variant="default" />
      </div>
    )

  return (
    <div className="space-y-3 text-sm">
      <p>
        Deleting your account removes your progress, recordings and settings.
        You have {DELETION_GRACE_DAYS} days to change your mind.
      </p>
      <Button
        type="button"
        variant="outline"
        className="border-pink/60 text-pink hover:border-pink"
        onClick={() => setOpen(true)}
      >
        Delete my account…
      </Button>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
