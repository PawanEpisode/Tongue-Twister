import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState, ErrorState, Skeleton } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { Chip } from '#/components/ui/chip'
import { DeleteDialogWrapper } from '#/components/ui/delete-dialog'
import type { GeneratedTwister } from '#/lib/generate/api'
import { classifyGenerateError } from '#/lib/generate/errors'
import { useDeleteMyTwister, useMyTwisters } from '#/lib/generate/hooks'
import { LENGTH_LABEL, lengthBand, wordCountOf } from '#/lib/twisterCard/length'
import type { LengthBand } from '#/lib/twisterCard/length'
import { libraryHeadline, librarySummary } from '#/lib/twisterCard/summary'
import { MyTwisterCard } from './MyTwisterCard'

type BandFilter = 'all' | LengthBand

const BANDS: LengthBand[] = ['short', 'medium', 'long']

function bandCounts(items: GeneratedTwister[]) {
  const counts: Record<BandFilter, number> = {
    all: items.length,
    short: 0,
    medium: 0,
    long: 0,
  }
  for (const item of items) counts[lengthBand(wordCountOf(item))] += 1
  return counts
}

/** The library: counts, length filters, and one card per generated twister. */
export default function MyTwistersScreen() {
  const list = useMyTwisters(true)
  const del = useDeleteMyTwister()
  const [band, setBand] = useState<BandFilter>('all')
  const [target, setTarget] = useState<GeneratedTwister | null>(null)
  const items = list.data ?? []
  const counts = bandCounts(items)
  const visible =
    band === 'all'
      ? items
      : items.filter((item) => lengthBand(wordCountOf(item)) === band)

  return (
    <div className="mx-auto max-w-3xl space-y-6 text-left">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            My twisters
          </h1>
          {list.isSuccess && items.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {libraryHeadline(librarySummary(items))}
            </p>
          )}
        </div>
        <Button asChild className="rounded-full px-5">
          <Link to="/generate">Make another</Link>
        </Button>
      </div>

      {list.isPending && (
        <div aria-busy aria-label="Loading your twisters" className="space-y-3">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      )}

      {list.isError && (
        <ErrorState
          title="Couldn’t load your twisters"
          message={classifyGenerateError(list.error).message}
          onRetry={() => void list.refetch()}
        />
      )}

      {list.isSuccess && items.length === 0 && (
        <EmptyState
          title="You haven’t made any twisters yet"
          hint="Pick a topic and we’ll write one just for you."
          action={
            <Button asChild>
              <Link to="/generate">Make one</Link>
            </Button>
          }
        />
      )}

      {list.isSuccess && items.length > 0 && (
        <>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter by length"
          >
            <Chip
              on={band === 'all'}
              count={counts.all}
              onClick={() => setBand('all')}
            >
              All
            </Chip>
            {BANDS.map((key) => (
              <Chip
                key={key}
                on={band === key}
                count={counts[key]}
                onClick={() => setBand(key)}
              >
                {LENGTH_LABEL[key]}
              </Chip>
            ))}
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {del.isSuccess ? 'Twister deleted.' : ''}
          </p>
          {del.isError && (
            <p role="alert" className="text-sm text-pink">
              {classifyGenerateError(del.error).message}
            </p>
          )}

          {visible.length === 0 && band !== 'all' ? (
            <p className="text-sm text-muted-foreground">
              No {LENGTH_LABEL[band].toLowerCase()} twisters.
            </p>
          ) : (
            <ul className="space-y-4">
              {visible.map((twister) => (
                <li key={twister.slug}>
                  <MyTwisterCard
                    twister={twister}
                    onDelete={() => {
                      del.reset()
                      setTarget(twister)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <DeleteDialogWrapper
        open={!!target}
        onOpenChange={(next) => {
          if (!next) setTarget(null)
        }}
        title="Delete this twister?"
        description="It will be removed from your account for good."
        preview={target?.text}
        pending={del.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (target)
            del.mutate(target.id, { onSettled: () => setTarget(null) })
        }}
      />
    </div>
  )
}
