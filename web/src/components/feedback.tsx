import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'

export { Skeleton }

/** Turn any thrown value into copy a human can act on. */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'We can’t reach the server. Check your connection and try again.'
  if (/API 404/.test(msg)) return 'We couldn’t find that.'
  if (/API 40[13]/.test(msg))
    return 'Your session expired — please sign in again.'
  if (/API 429/.test(msg))
    return 'Too many requests — give it a few seconds and retry.'
  if (/API 5\d\d/.test(msg))
    return 'Our server hiccupped. Please try again in a moment.'
  return 'Something unexpected happened. Please try again.'
}

/** Mirrors TwisterCard's fixed layout so nothing jumps when data arrives. */
export function TwisterCardSkeleton() {
  return (
    <Card
      variant="glass"
      className="flex h-[12.5rem] flex-col rounded-2xl p-5"
      aria-hidden
    >
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="h-[4.5rem] space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="mt-auto flex items-center justify-between pt-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-14" />
      </div>
    </Card>
  )
}

export function CategoryCardSkeleton() {
  return (
    <Card
      variant="glass"
      className="flex h-[7.5rem] items-center gap-4 rounded-2xl p-5"
      aria-hidden
    >
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="w-full space-y-2">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </Card>
  )
}

export function ChipsSkeleton({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-9 w-28 rounded-full" />
      ))}
    </>
  )
}

export function PracticeSkeleton() {
  return (
    <div
      className="mx-auto max-w-3xl text-center"
      aria-busy
      aria-label="Loading twister"
    >
      <div className="mb-6 flex justify-center gap-3">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="mx-auto h-9 w-full" />
        <Skeleton className="mx-auto h-9 w-4/5" />
      </div>
      <Skeleton className="mx-auto mt-16 h-28 w-28 rounded-full" />
      <Skeleton className="mx-auto mt-6 h-4 w-64" />
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  message,
  onRetry,
  compact,
  children,
}: {
  title?: string
  error?: unknown
  message?: string
  onRetry?: () => void
  compact?: boolean
  children?: ReactNode
}) {
  return (
    <Card
      role="alert"
      variant="glass"
      className={`mx-auto flex max-w-lg flex-col items-center rounded-3xl text-center ${compact ? 'p-6' : 'my-10 p-10'}`}
    >
      <div className="text-4xl" aria-hidden>
        😵‍💫
      </div>
      <h2 className="mt-3 font-display text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {message ?? friendlyError(error)}
      </p>
      <div className="mt-5 flex gap-3">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        {children}
      </div>
    </Card>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mx-auto my-10 max-w-md text-center">
      <div className="text-4xl" aria-hidden>
        🔍
      </div>
      <h2 className="mt-3 font-display text-xl font-bold">{title}</h2>
      {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function NotFound() {
  return (
    <ErrorState
      title="Page not found"
      message="That page doesn’t exist — it may have moved or the link is wrong."
    >
      <Button asChild variant="outline">
        <Link to="/">Go home</Link>
      </Button>
    </ErrorState>
  )
}
