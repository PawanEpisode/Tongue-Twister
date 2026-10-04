import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { seo } from '#/lib/seo'
import { api } from '#/lib/api'
import type { BrowseSort, BrowseStatus } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { browseContext } from '#/lib/browseContext'
import {
  parseSort,
  parseStatus,
  toApiParams,
} from '#/lib/progress/browseParams'
import { BrowseFilters } from '#/components/browse/BrowseFilters'
import { PagedTwisters } from '#/components/TwisterList'
import UnlockPanel from '#/components/public/UnlockPanel'
import { Button } from '#/components/ui/button'
import { usePublicSite } from '#/lib/public/audience'
import { Input } from '#/components/ui/input'
import { PageTitle } from '#/components/ui/page-title'
import { EmptyState } from '#/components/feedback'

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
  // Signed out with the public site on: the API returns the curated preview and says how big the library is.
  const first = list.data?.pages[0]
  const publicSite = usePublicSite()
  const preview = !signedIn && publicSite && first?.locked === true

  return (
    <div>
      <PageTitle>Browse twisters</PageTitle>
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
      <BrowseFilters
        difficulty={s.difficulty}
        origin={s.origin}
        category={s.category}
        status={s.status}
        sort={s.sort}
        signedIn={signedIn}
        counts={counts}
        categories={cats.data}
        categoriesPending={cats.isPending}
        categoriesError={cats.isError}
        onRetryCategories={() => void cats.refetch()}
        onChange={(patch) =>
          set(patch.sort ? { ...patch, sort: parseSort(patch.sort) } : patch)
        }
      />
      <PagedTwisters
        query={list}
        empty={
          preview ? (
            <UnlockPanel total={first?.library_total ?? 0} shown={0} noMatch />
          ) : (
            <EmptyState
              title="No twisters match"
              hint="Try a different search or loosen a filter."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )
        }
      />
      {preview && !!items.length && (
        <UnlockPanel total={first?.library_total ?? 0} shown={items.length} />
      )}
    </div>
  )
}
