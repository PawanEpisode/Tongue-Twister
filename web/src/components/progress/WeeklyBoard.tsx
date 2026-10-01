import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EyeOff, UserRound } from 'lucide-react'
import { useId } from 'react'
import { ErrorState, Skeleton } from '#/components/feedback'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import { ApiError, api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { formatDay } from '#/lib/progress/charts'

/** 403s mean "not for you" (flag off, under 13): the section simply isn't shown. */
const isUnavailable = (e: unknown) => e instanceof ApiError && e.status === 403

/** This week's best scores on today's twister. Names are the opt-in public name or "Player NNNN". */
export function WeeklyBoard({ twister }: { twister?: string }) {
  const { session } = useAuth()
  const hideId = useId()
  const qc = useQueryClient()
  const userId = session?.user.id
  const board = useQuery({
    queryKey: ['weekly-board', userId ?? 'guest', twister],
    queryFn: () => api.weeklyBoard(twister),
    retry: (count, e) => !isUnavailable(e) && count < 1,
  })
  const hide = useMutation({
    mutationFn: api.setHideFromBoards,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['weekly-board'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  if (board.isError && isUnavailable(board.error)) return null
  const b = board.data

  return (
    <section aria-labelledby="weekly-h">
      <h2 id="weekly-h" className="mb-1 text-2xl font-bold">
        This week’s board
      </h2>
      {b && (
        <p className="mb-4 text-sm text-muted-foreground">
          {formatDay(b.week_start)} – {formatDay(b.week_end)} ·{' '}
          <Link
            to="/twisters/$slug"
            params={{ slug: b.twister.slug }}
            className="underline underline-offset-2"
          >
            “{b.twister.text}”
          </Link>
        </p>
      )}
      <Card variant="glass" className="rounded-2xl p-5">
        {board.isPending ? (
          <div className="space-y-3" aria-busy aria-label="Loading the board">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : board.isError ? (
          <ErrorState
            compact
            title="Couldn’t load the board"
            error={board.error}
            onRetry={() => void board.refetch()}
          />
        ) : (
          <>
            {b!.top.length === 0 ? (
              <p className="text-muted-foreground">
                No scores yet this week. Be the first on the board.
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {b!.top.map((r) => (
                  <li
                    key={r.rank}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <span className="w-6 text-right font-semibold tabular-nums">
                      {r.rank}
                    </span>
                    <span aria-hidden>{r.emoji}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {r.is_me && (
                      <Badge variant="cyan" className="gap-1">
                        <UserRound className="size-3" aria-hidden />
                        You
                      </Badge>
                    )}
                    <span className="font-semibold tabular-nums">
                      {r.score}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {b!.me && !b!.top.some((r) => r.is_me) && (
              <p className="mt-3 border-t border-border pt-3 text-sm">
                You’re <b>#{b!.me.rank}</b> with <b>{b!.me.score}</b>.
              </p>
            )}
            {b!.hidden && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <EyeOff className="size-4" aria-hidden />
                You’re hidden from boards, so nobody sees your scores.
              </p>
            )}
            {session && (
              <div className="mt-4 flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  id={hideId}
                  checked={b!.hidden}
                  disabled={hide.isPending}
                  onCheckedChange={(value) => hide.mutate(value === true)}
                />
                <Label
                  htmlFor={hideId}
                  className="font-normal text-muted-foreground"
                >
                  Hide me from boards
                </Label>
              </div>
            )}
            {hide.isError && (
              <p role="alert" className="mt-2 text-sm text-pink">
                Couldn’t save that. Try again.
              </p>
            )}
          </>
        )}
      </Card>
    </section>
  )
}
