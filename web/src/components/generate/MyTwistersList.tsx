import { Link } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, Skeleton } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { Dialog } from '#/components/ui/dialog'
import type { GeneratedTwister } from '#/lib/generate/api'
import { classifyGenerateError } from '#/lib/generate/errors'
import { useDeleteMyTwister, useMyTwisters } from '#/lib/generate/hooks'

export default function MyTwistersList() {
  const list = useMyTwisters(true)
  const del = useDeleteMyTwister()
  const [target, setTarget] = useState<GeneratedTwister | null>(null)

  if (list.isPending)
    return (
      <div aria-busy aria-label="Loading your twisters" className="space-y-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    )
  if (list.isError)
    return (
      <ErrorState
        title="Couldn’t load your twisters"
        message={classifyGenerateError(list.error).message}
        onRetry={() => void list.refetch()}
      />
    )
  const items = list.data
  if (items.length === 0)
    return (
      <EmptyState
        title="You haven’t made any twisters yet"
        hint="Pick a topic and we’ll write one just for you."
        action={
          <Button asChild>
            <Link to="/generate">Make one</Link>
          </Button>
        }
      />
    )

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {del.isSuccess ? 'Twister deleted.' : ''}
      </p>
      {del.isError && (
        <p role="alert" className="mb-3 text-sm text-pink">
          {classifyGenerateError(del.error).message}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((t) => (
          <li
            key={t.slug}
            className="glass flex items-start justify-between gap-4 rounded-2xl p-5"
          >
            <p className="text-lg">{t.text}</p>
            <div className="flex shrink-0 gap-2">
              <Button asChild size="sm">
                <Link to="/twisters/$slug" params={{ slug: t.slug }}>
                  Practise
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Delete twister: ${t.text}`}
                onClick={() => {
                  del.reset()
                  setTarget(t)
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Delete this twister?"
        description="It will be removed from your account for good."
      >
        <p className="mb-4 text-sm text-muted-foreground">{target?.text}</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setTarget(null)}>
            Keep it
          </Button>
          <Button
            disabled={del.isPending}
            onClick={() => {
              if (target)
                del.mutate(target.id, { onSettled: () => setTarget(null) })
            }}
          >
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
