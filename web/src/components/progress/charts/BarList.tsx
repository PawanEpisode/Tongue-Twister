import { formatPercent, plural } from '#/lib/progress/format'
import type { Stats } from '#/lib/api'

/** Accuracy per sound family as labelled horizontal bars. The numbers are printed, so no table is needed. */
export function BarList({ rows }: { rows: Stats['category_accuracy'] }) {
  const sorted = [...rows].sort((a, b) => a.avg_accuracy - b.avg_accuracy)
  return (
    <ul className="space-y-3">
      {sorted.map((r) => (
        <li key={r.category}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold">{r.name}</span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">
                {formatPercent(r.avg_accuracy)}
              </span>{' '}
              · {plural(r.attempts, 'attempt')}
            </span>
          </div>
          <div
            role="meter"
            aria-label={`${r.name} accuracy`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(r.avg_accuracy * 100)}
            aria-valuetext={formatPercent(r.avg_accuracy)}
            className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.round(r.avg_accuracy * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
