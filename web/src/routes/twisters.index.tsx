import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ComponentProps } from 'react'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import { CategoryIcon } from '#/lib/categoryIcons'
import { browseContext } from '#/lib/browseContext'
import { TwisterCard } from '#/components/ui'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  ChipsSkeleton,
  EmptyState,
  ErrorState,
  TwisterCardSkeleton,
} from '#/components/feedback'
import { cn } from '#/lib/utils'

type Search = {
  difficulty?: string
  category?: string
  origin?: string
  q?: string
}
export const Route = createFileRoute('/twisters/')({
  head: () =>
    seo({
      title: 'Browse tongue twisters — Easy to Insane | Twister',
      description:
        'Search 40+ classic and modern tongue twisters. Filter by difficulty, sound family (S, R, TH, P/B…) and origin, then practise out loud.',
      path: '/twisters',
    }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    difficulty: s.difficulty ? String(s.difficulty) : undefined,
    category: s.category ? String(s.category) : undefined,
    origin: s.origin ? String(s.origin) : undefined,
    q: s.q ? String(s.q) : undefined,
  }),
  component: Browse,
})

function Chip({
  on,
  className,
  ...props
}: { on: boolean } & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'px-4 py-1.5 font-normal',
        on
          ? 'border-primary bg-primary/20 text-foreground hover:border-primary'
          : 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function Browse() {
  const s = Route.useSearch()
  const nav = useNavigate({ from: '/twisters/' })
  const [q, setQ] = useState(s.q ?? '')
  const set = (patch: Partial<Search>) =>
    nav({ search: (p) => ({ ...p, ...patch }) })
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.categories })
  const list = useInfiniteQuery({
    queryKey: ['twisters', s],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.twisters({
        difficulty: s.difficulty,
        category: s.category,
        origin: s.origin,
        search: s.q,
        page: String(pageParam),
      }),
    getNextPageParam: (last, pages) =>
      pages.reduce((n, p) => n + p.results.length, 0) < last.count
        ? pages.length + 1
        : undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.results) ?? []
  const total = list.data?.pages[0]?.count ?? 0
  // Lets the twister page's next/previous follow this list (see lib/browseContext).
  useEffect(() => {
    if (items.length) browseContext.set(items.map((t) => t.slug))
  }, [items])
  const clearFilters = () => {
    setQ('')
    nav({ search: {} })
  }

  return (
    <div>
      <h1 className="text-4xl font-extrabold">Browse twisters</h1>
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault()
          set({ q: q || undefined })
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — try “peter” or “lorry”"
          className="glass rounded-2xl px-5 py-3"
        />
      </form>
      <div className="mt-5 flex flex-wrap gap-2">
        <Chip on={!s.difficulty} onClick={() => set({ difficulty: undefined })}>
          All levels
        </Chip>
        {['Easy', 'Medium', 'Hard', 'Insane'].map((n, i) => (
          <Chip
            key={n}
            on={s.difficulty === String(i + 1)}
            onClick={() => set({ difficulty: String(i + 1) })}
          >
            {n}
          </Chip>
        ))}
        <span className="mx-2 w-px bg-border" />
        <Chip on={!s.origin} onClick={() => set({ origin: undefined })}>
          Classic + Modern
        </Chip>
        <Chip
          on={s.origin === 'classic'}
          onClick={() => set({ origin: 'classic' })}
        >
          Classic
        </Chip>
        <Chip
          on={s.origin === 'modern'}
          onClick={() => set({ origin: 'modern' })}
        >
          Modern
        </Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip on={!s.category} onClick={() => set({ category: undefined })}>
          Every sound
        </Chip>
        {cats.isPending && <ChipsSkeleton />}
        {cats.isError && (
          <Chip on={false} onClick={() => void cats.refetch()}>
            Couldn’t load sounds — retry
          </Chip>
        )}
        {cats.data?.map((c) => (
          <Chip
            key={c.slug}
            on={s.category === c.slug}
            className="gap-1.5"
            onClick={() => set({ category: c.slug })}
          >
            <CategoryIcon slug={c.slug} className="size-3.5" />
            {c.name}
          </Chip>
        ))}
      </div>
      {list.isError && !items.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div
          className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy
          aria-label="Loading twisters"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <TwisterCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No twisters match"
          hint="Try a different search or loosen a filter."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">
            Showing {items.length} of {total}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t, i) => (
              <TwisterCard key={t.slug} t={t} i={i % 24} />
            ))}
            {list.isFetchingNextPage &&
              Array.from({ length: 3 }, (_, i) => (
                <TwisterCardSkeleton key={`sk${i}`} />
              ))}
          </div>
          {list.isError && (
            <ErrorState
              compact
              title="Couldn’t load more"
              error={list.error}
              onRetry={() => void list.fetchNextPage()}
            />
          )}
          {list.hasNextPage && !list.isError && (
            <div className="mt-8 text-center">
              <Button
                variant="outline"
                size="lg"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
