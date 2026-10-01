import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import type { Stats } from '#/lib/api'
import { formatPercent, plural } from '#/lib/progress/format'
import { ChartCard } from './charts/ChartParts'

/** Words you trip on most, each linking to a twister that contains it. */
export function WeakWordsCard({ words }: { words: Stats['weak_words'] }) {
  return (
    <ChartCard
      title="Words to work on"
      description="The words you miss most often in this period."
      empty={
        words.length
          ? undefined
          : 'No trouble words yet. Say a few twisters and the ones you trip on will show up here.'
      }
    >
      <ul className="divide-y divide-border">
        {words.map((w) => (
          <li
            key={w.word}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
          >
            <span className="font-display text-lg font-bold">{w.word}</span>
            <span className="text-sm text-muted-foreground">
              missed {formatPercent(w.miss_rate)} · seen{' '}
              {plural(w.seen, 'time')}
            </span>
            {w.drill && (
              <Link
                to="/twisters/$slug"
                params={{ slug: w.drill.twister }}
                className="text-sm underline underline-offset-2 pointer-coarse:py-3"
              >
                Practise in a twister
              </Link>
            )}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-4 pointer-coarse:min-h-11">
        <Link to="/practice" search={{ drill: 1 }}>
          Drill your weakest words
        </Link>
      </Button>
    </ChartCard>
  )
}
