import type { ReactNode } from 'react'

/** The loading, error and empty states every word list shares; `children` render only with words. */
export default function QueueBoundary({
  pending,
  error,
  empty,
  emptyText,
  errorText,
  onRetry,
  children,
}: {
  pending: boolean
  error: boolean
  empty: boolean
  emptyText: string
  errorText: string
  onRetry: () => void
  children: ReactNode
}) {
  if (pending) return <p className="mt-4 text-muted-foreground">Loading…</p>
  if (error)
    return (
      <p role="alert" className="mt-4 text-pink">
        {errorText}{' '}
        <button className="underline" onClick={onRetry}>
          Try again
        </button>
      </p>
    )
  if (empty) return <p className="mt-4 text-muted-foreground">{emptyText}</p>
  return <>{children}</>
}
