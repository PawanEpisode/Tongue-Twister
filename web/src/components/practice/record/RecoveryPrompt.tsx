import { History } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { StoredMeta } from '#/lib/record/chunkStore'
import { formatClock } from '#/lib/record/quality'

/** Shown when a take was left on disk (crash, closed tab): recover it into the review step, or throw it away. */
export default function RecoveryPrompt({
  meta,
  busy,
  onRecover,
  onDiscard,
}: {
  meta: StoredMeta
  busy: boolean
  onRecover: () => void
  onDiscard: () => void
}) {
  return (
    <div
      role="region"
      aria-label="Unsaved recording"
      className="glass mx-auto mb-6 max-w-xl rounded-2xl p-4 text-left"
    >
      <p className="flex items-center gap-2 font-semibold">
        <History className="size-4 text-brand" aria-hidden />
        We found a recording that wasn’t finished
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        From {new Date(meta.startedAt).toLocaleString()}, about{' '}
        {formatClock(meta.durationMs)} long. It was kept on this device.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy} onClick={onRecover}>
          Recover it
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onDiscard}>
          Delete it
        </Button>
      </div>
    </div>
  )
}
