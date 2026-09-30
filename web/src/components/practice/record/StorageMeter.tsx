import type { Quota } from '#/lib/api'
import { formatBytes } from '#/lib/record/quality'

/** Cloud storage used against the plan, and how many recordings of how many. */
export default function StorageMeter({ quota }: { quota: Quota }) {
  const pct =
    quota.limit_bytes > 0
      ? Math.min(100, Math.round((quota.used_bytes / quota.limit_bytes) * 100))
      : 0
  const full = pct >= 90
  return (
    <div className="text-left text-sm">
      <div className="mb-1 flex justify-between text-muted-foreground">
        <span>
          {formatBytes(quota.used_bytes)} of {formatBytes(quota.limit_bytes)}{' '}
          used
        </span>
        <span>
          {quota.count} of {quota.count_limit} recordings
        </span>
      </div>
      <div
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className={full ? 'h-full bg-pink' : 'h-full bg-primary'}
          style={{ width: `${pct}%` }}
        />
      </div>
      {full && (
        <p className="mt-1 text-xs text-pink">
          Almost full. Delete an old recording to make room.
        </p>
      )}
    </div>
  )
}
