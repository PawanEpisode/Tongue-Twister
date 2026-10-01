import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import type { BrowseSort, BrowseStatus } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { CategoryIcon } from '#/lib/categoryIcons'
import { browseContext } from '#/lib/browseContext'
import {
  parseSort,
  parseStatus,
  toApiParams,
} from '#/lib/progress/browseParams'
import { PagedTwisters } from '#/components/TwisterList'
import { RandomButton } from '#/components/progress/RandomButton'
import { SortMenu } from '#/components/progress/SortMenu'
import { StatusChips } from '#/components/progress/StatusChips'
import { Button } from '#/components/ui/button'
import { Chip } from '#/components/ui/chip'
import { Input } from '#/components/ui/input'
import { ChipsSkeleton, EmptyState } from '#/components/feedback'

type Search = {
  difficulty?: string
  category?: string
  origin?: string
  q?: string
  status?: BrowseStatus
  sort?: BrowseSort
}
/** A param as text; an absent or empty one is `undefined` (a bare `0` is still text). */
const text = (v: unknown): string | undefined =>
  v == null || v === '' ? undefined : String(v)

export const Route = createFileRoute('/twisters/')({
  head: () =>
    seo({
      title: 'Browse tongue twisters — Easy to Insane | Twister',
      description:
        'Search 40+ classic and modern tongue twisters. Filter by difficulty, sound family (S, R, TH, P/B…) and origin, then practise out loud.',
      path: '/twisters',
    }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    difficulty: text(s.difficulty),
    category: text(s.category),
    origin: text(s.origin),
    q: text(s.q),
    status: parseStatus(s.status),
    sort: parseSort(s.sort),
  }),
  component: Browse,
})

function Browse() {
  const s = Route.useSearch()
  const nav = useNavigate({ from: '/twisters/' })
  const { session, loading: authLoading } = useAuth()
  const signedIn = !!session
  const [q, setQ] = useState(s.q ?? '')
  const set = (patch: Partial<Search>) =>
    nav({ search: (p) => ({ ...p, ...patch }) })
  const filters = {
    difficulty: s.difficulty,
    category: s.category,
    origin: s.origin,
  }
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.categories })
  // Counts on the chips: each dimension ignores its own filter, so a chip shows what switching to it gives.
  const facets = useQuery({
    queryKey: ['facets', { ...filters, search: s.q }],
    queryFn: () => api.facets({ ...filters, search: s.q }),
    placeholderData: (prev) => prev,
  })
  const list = useInfiniteQuery({
    queryKey: ['twisters', s, signedIn],
    initialPageParam: 1,
    enabled: !authLoading, // progress filters need to know who is asking
    queryFn: ({ pageParam }) =>
      api.twisters({
        ...filters,
        search: s.q,
        ...toApiParams(s, signedIn),
        page: String(pageParam),
      }),
    getNextPageParam: (last, pages) =>
      pages.reduce((n, p) => n + p.results.length, 0) < last.count
        ? pages.length + 1
        : undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.results) ?? []
  // Lets the twister page's next/previous follow this list (see lib/browseContext).
  useEffect(() => {
    if (items.length) browseContext.set(items.map((t) => t.slug))
  }, [items])
  const clearFilters = () => {
    setQ('')
    nav({ search: {} })
  }
  const counts = facets.data

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
          aria-label="Search twisters"
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
            count={counts?.levels[String(i + 1)]}
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
          count={counts?.origins.classic}
          onClick={() => set({ origin: 'classic' })}
        >
          Classic
        </Chip>
        <Chip
          on={s.origin === 'modern'}
          count={counts?.origins.modern}
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
            count={counts?.categories[c.slug]}
            className="gap-1.5"
            onClick={() => set({ category: c.slug })}
          >
            <CategoryIcon slug={c.slug} className="size-3.5" />
            {c.name}
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {signedIn && (
          <StatusChips
            value={s.status}
            onChange={(status) => set({ status })}
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <RandomButton filters={filters} />
          <SortMenu
            value={s.sort}
            signedIn={signedIn}
            onChange={(sort) => set({ sort: parseSort(sort) })}
          />
        </div>
      </div>
      <PagedTwisters
        query={list}
        empty={
          <EmptyState
            title="No twisters match"
            hint="Try a different search or loosen a filter."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        }
      />
    </div>
  )
}
