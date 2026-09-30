import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import { browseContext } from '#/lib/browseContext'
import { TwisterCard } from '#/components/ui'
import {
  ChipsSkeleton,
  EmptyState,
  ErrorState,
  TwisterCardSkeleton,
} from '#/components/feedback'

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

const chip = (on: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand/20 text-white' : 'border-line text-white/60 hover:border-brand/50'}`

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
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — try “peter” or “lorry”"
          className="glass w-full rounded-2xl px-5 py-3 outline-none focus:border-brand"
        />
      </form>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className={chip(!s.difficulty)}
          onClick={() => set({ difficulty: undefined })}
        >
          All levels
        </button>
        {['Easy', 'Medium', 'Hard', 'Insane'].map((n, i) => (
          <button
            key={n}
            className={chip(s.difficulty === String(i + 1))}
            onClick={() => set({ difficulty: String(i + 1) })}
          >
            {n}
          </button>
        ))}
        <span className="mx-2 w-px bg-line" />
        <button
          className={chip(!s.origin)}
          onClick={() => set({ origin: undefined })}
        >
          Classic + Modern
        </button>
        <button
          className={chip(s.origin === 'classic')}
          onClick={() => set({ origin: 'classic' })}
        >
          Classic
        </button>
        <button
          className={chip(s.origin === 'modern')}
          onClick={() => set({ origin: 'modern' })}
        >
          Modern
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={chip(!s.category)}
          onClick={() => set({ category: undefined })}
        >
          Every sound
        </button>
        {cats.isPending && <ChipsSkeleton />}
        {cats.isError && (
          <button className={chip(false)} onClick={() => void cats.refetch()}>
            Couldn’t load sounds — retry
          </button>
        )}
        {cats.data?.map((c) => (
          <button
            key={c.slug}
            className={chip(s.category === c.slug)}
            onClick={() => set({ category: c.slug })}
          >
            {c.emoji} {c.name}
          </button>
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
            <button
              onClick={clearFilters}
              className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold hover:border-brand"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <>
          <p className="mt-6 text-sm text-white/40" aria-live="polite">
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
              <button
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
                className="rounded-2xl border border-line px-6 py-3 font-semibold hover:border-brand disabled:opacity-50"
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
