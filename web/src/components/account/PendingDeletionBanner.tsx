import { TriangleAlert } from 'lucide-react'
import { formatDeletionDate } from '#/lib/account/deletion'
import { useDeletionState } from '#/lib/account/useDeletion'
import CancelDeletionButton from './CancelDeletionButton'

/** Shown on every page while the account is waiting out its grace period. Renders nothing otherwise. */
export default function PendingDeletionBanner() {
  const state = useDeletionState()
  if (!state.pending) return null
  return (
    <div role="status" className="border-t border-pink/40 bg-pink/10 text-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2">
        <p className="flex items-center gap-2">
          <TriangleAlert className="size-4 shrink-0 text-pink" aria-hidden />
          Your account is scheduled for deletion on{' '}
          <b>{formatDeletionDate(state.scheduledFor)}</b>.
        </p>
        <CancelDeletionButton />
      </div>
    </div>
  )
}
