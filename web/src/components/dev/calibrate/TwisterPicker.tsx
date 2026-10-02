import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import { filterTwisters } from '#/lib/calibrate/coverage'
import type { PickerTwister } from '#/lib/calibrate/coverage'
import { cn } from '#/lib/utils'

/** Every public twister, paged in until the API's own count is reached (the API pages at 24). */
export function useTwisterCatalogue() {
  return useQuery({
    queryKey: ['calibrate', 'twisters'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PickerTwister[]> => {
      const out: PickerTwister[] = []
      for (let page = 1; page <= 40; page++) {
        const r = await api.twisters({ page: String(page) })
        out.push(...r.results)
        if (!r.results.length || out.length >= r.count) break
      }
      return out
    },
  })
}

const DOTS = ['bg-lime', 'bg-cyan', 'bg-pink', 'bg-destructive']

/**
 * Pick a twister from the catalogue instead of typing a slug. Rows show how many takes this speaker already has
 * in the current scenario, so gaps in the gold set are visible while choosing.
 */
export default function TwisterPicker({
  twisters,
  loading,
  failed,
  selected,
  counts,
  scenarioLabel,
  onPick,
  onNext,
  open,
  onOpenChange,
}: {
  twisters: PickerTwister[]
  loading: boolean
  failed: boolean
  selected: string
  counts: Map<string, number>
  scenarioLabel: string
  onPick: (slug: string) => void
  /** Null when every twister already has a take. */
  onNext: (() => void) | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => filterTwisters(twisters, q), [twisters, q])
  const current = twisters.find((t) => t.slug === selected)
  const covered = twisters.filter((t) => counts.has(t.slug)).length
  const typed = q.trim().toLowerCase().replace(/\s+/g, '-')
  const unknownSlug = typed && !twisters.some((t) => t.slug === typed)

  const pick = (slug: string) => {
    onPick(slug)
    onOpenChange(false)
    setQ('')
  }

  return (
    <section
      aria-label="Twister"
      className="rounded-2xl border border-border/60 bg-card/40"
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Twister
            </span>
            <span className="block truncate font-display text-lg font-bold">
              {current ? current.text : selected || 'Choose a twister'}
            </span>
            {selected && (
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {selected}
              </span>
            )}
          </span>
          <ChevronsUpDown
            className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
            aria-hidden
          />
        </button>
        {onNext && (
          <Button size="sm" variant="outline" onClick={onNext}>
            <Sparkles className="mr-1.5 size-3.5" aria-hidden />
            Next unrecorded
          </Button>
        )}
      </div>

      {open && (
        <div className="border-t border-border/60 p-3">
          <label className="relative block">
            <span className="sr-only">Search twisters</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && rows[0]) pick(rows[0].slug)
                else if (e.key === 'Enter' && unknownSlug) pick(typed)
                if (e.key === 'Escape') onOpenChange(false)
              }}
              placeholder="Search by words, slug or sound (e.g. “sh”)"
              className="w-full rounded-xl border border-input bg-card py-2.5 pr-3 pl-9 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {loading
              ? 'Loading twisters…'
              : failed
                ? 'Could not load the list. Type a slug and press Enter.'
                : `${covered} of ${twisters.length} have a ${scenarioLabel} take from this speaker.`}
          </p>
          <ul
            role="listbox"
            aria-label="Twisters"
            className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1"
          >
            {unknownSlug && (
              <li role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => pick(typed)}
                  className="w-full rounded-xl border border-dashed border-border px-3 py-2 text-left text-sm hover:border-primary"
                >
                  Use slug <span className="font-mono">{typed}</span>
                </button>
              </li>
            )}
            {rows.map((t) => {
              const n = counts.get(t.slug) ?? 0
              const on = t.slug === selected
              return (
                <li key={t.slug} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => pick(t.slug)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
                      on && 'bg-primary/15',
                    )}
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        DOTS[t.difficulty - 1] ?? 'bg-muted-foreground',
                      )}
                      title={t.difficulty_label}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{t.text}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {t.slug}
                        {t.focus_sounds.length > 0 &&
                          ` · ${t.focus_sounds.join(' ')}`}
                      </span>
                    </span>
                    {n > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-semibold text-lime">
                        <Check className="size-3" aria-hidden />
                        {n}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        none yet
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
            {!loading && !rows.length && !unknownSlug && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No twister matches “{q}”.
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  )
}
