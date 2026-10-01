import { GenerateCta } from './GenerateCta'
import { levelLabel } from './options'
import type { GenerateBrief as Brief } from './options'

const ROWS = [
  { key: 'topic', label: 'Topic' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'words', label: 'Words' },
] as const

function rowValue(brief: Brief, key: (typeof ROWS)[number]['key']) {
  if (key === 'topic') return brief.topic
  if (key === 'difficulty') return levelLabel(brief.difficulty)
  return String(brief.words)
}

/** The request that produced the twister, once the fields are no longer being edited. */
export function GenerateBrief({
  brief,
  onEdit,
}: {
  brief: Brief
  onEdit: () => void
}) {
  return (
    <div className="glass space-y-4 rounded-2xl p-4 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand">
        You asked for
      </p>
      <dl className="divide-y divide-border">
        {ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
          >
            <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {row.label}
            </dt>
            <dd className="text-right font-medium">
              {rowValue(brief, row.key)}
            </dd>
          </div>
        ))}
      </dl>
      <GenerateCta phase="again" type="button" onClick={onEdit} />
    </div>
  )
}
