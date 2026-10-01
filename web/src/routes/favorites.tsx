import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { PracticeSkeleton, EmptyState, ErrorState } from '#/components/feedback'
import {
  PagedTwisters,
  TwisterGrid,
  TwisterGridSkeleton,
} from '#/components/TwisterList'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useGuestFavorites } from '#/lib/progress/useFavorite'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/favorites')({
  head: () =>
    seo({
      title: 'Your favourites | Twister',
      description: 'The twisters you’ve starred.',
      path: '/favorites',
      noindex: true,
    }),
  component: FavoritesPage,
})

const Empty = () => (
  <EmptyState
    title="Star a twister to find it here"
    hint="Tap the star on any twister and it will be waiting for you."
    action={
      <Button asChild variant="outline">
        <Link to="/twisters">Browse twisters</Link>
      </Button>
    }
  />
)

function SignedInFavorites({ userId }: { userId: string }) {
  const list = useInfiniteQuery({
    queryKey: ['favorites', userId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.favorites(pageParam),
    getNextPageParam: (last, pages) =>
      pages.reduce((n, p) => n + p.results.length, 0) < last.count
        ? pages.length + 1
        : undefined,
  })
  return <PagedTwisters query={list} empty={<Empty />} />
}

/** Guests' stars live on this device, so the list is built from those slugs (shares the twister cache with the hub). */
function GuestFavorites() {
  const slugs = useGuestFavorites()
  const results = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ['twister', slug],
      queryFn: () => api.twister(slug),
    })),
  })
  const items = results.flatMap((r) => (r.data ? [r.data] : []))
  const pending = results.some((r) => r.isPending)
  const failed = results.filter((r) => r.isError)

  return (
    <>
      <p className="mt-2 text-sm text-muted-foreground">
        Saved on this device.{' '}
        <Link
          to="/login"
          search={{ redirect: '/favorites' }}
          className="underline underline-offset-2"
        >
          Sign in to keep them
        </Link>
        .
      </p>
      {slugs.length === 0 ? (
        <Empty />
      ) : pending ? (
        <TwisterGridSkeleton n={Math.min(slugs.length, 6)} />
      ) : items.length === 0 ? (
        <ErrorState
          title="Couldn’t load your favourites"
          error={failed[0]?.error}
          onRetry={() => failed.forEach((r) => void r.refetch())}
        />
      ) : (
        <TwisterGrid items={sortBySlugOrder(items, slugs)} />
      )}
    </>
  )
}

/** Newest favourite first, like the signed-in list (the stored order is oldest first). */
const sortBySlugOrder = (items: Twister[], slugs: string[]) =>
  [...items].sort((a, b) => slugs.indexOf(b.slug) - slugs.indexOf(a.slug))

function FavoritesPage() {
  const { session, loading } = useAuth()
  if (loading) return <PracticeSkeleton />
  return (
    <div>
      <h1 className="text-4xl font-extrabold">Favourites</h1>
      {session ? (
        <SignedInFavorites userId={session.user.id} />
      ) : (
        <GuestFavorites />
      )}
    </div>
  )
}
