import { Button } from '#/components/ui/button'
import { friendlyError } from '#/components/feedback'
import { useCancelDeletion } from '#/lib/account/useDeletion'

/** Ends the grace period. Used by the banner and the Delete section, so there is one place that does it. */
export default function CancelDeletionButton({
  variant = 'outline',
}: {
  variant?: 'default' | 'outline'
}) {
  const cancel = useCancelDeletion()
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
      >
        {cancel.isPending ? 'Cancelling…' : 'Cancel deletion'}
      </Button>
      {cancel.isError && (
        <span role="alert" className="text-xs text-pink">
          {friendlyError(cancel.error)}
        </span>
      )}
    </span>
  )
}
