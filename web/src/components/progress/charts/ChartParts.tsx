import type { ReactNode } from 'react'
import { Card } from '#/components/ui/card'

/** The card every chart sits in: a title, one line of context, and a place for the plot. */
export function ChartCard({
  title,
  description,
  empty,
  children,
}: {
  title: string
  description?: ReactNode
  /** Shown instead of the plot when there's nothing to draw yet. */
  empty?: string
  children?: ReactNode
}) {
  return (
    <Card variant="glass" className="rounded-2xl p-5">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {description && (
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      )}
      {empty ? (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </Card>
  )
}

export type LegendItem = { label: string; swatch: ReactNode }

/** Always shown for two or more series, so identity never depends on colour alone. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <svg width="18" height="10" aria-hidden>
            {i.swatch}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  )
}

/** Hover/focus readout, kept inside the plot horizontally. */
export function ChartTooltip({
  x,
  width,
  title,
  rows,
}: {
  x: number
  width: number
  title: string
  rows: string[]
}) {
  const right = x > width * 0.6
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 z-10 min-w-28 rounded-lg border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-lg"
      style={{
        left: right ? undefined : x + 12,
        right: right ? width - x + 12 : undefined,
      }}
    >
      <div className="font-semibold">{title}</div>
      {rows.map((r) => (
        <div key={r} className="text-muted-foreground">
          {r}
        </div>
      ))}
    </div>
  )
}

/** The same numbers as a real table, for screen readers and anyone who can't use the plot. */
export function DataTable({
  caption,
  headers,
  rows,
}: {
  caption: string
  headers: string[]
  rows: (string | number)[][]
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, n) => (
          <tr key={n}>
            {r.map((c, i) =>
              i === 0 ? (
                <th key={i} scope="row">
                  {c}
                </th>
              ) : (
                <td key={i}>{c}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Announces the inspected point to assistive tech as the arrow keys move. */
export function LiveReadout({ text }: { text: string }) {
  return (
    <p className="sr-only" aria-live="polite">
      {text}
    </p>
  )
}
