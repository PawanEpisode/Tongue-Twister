import { Link, useRouterState } from '@tanstack/react-router'
import { useRef } from 'react'
import ShareButton from '#/components/practice/ShareButton'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'
import { track } from '#/lib/observability/analytics'

/**
 * "Share score card" on a result screen. The link is created on the first tap and reused for that
 * attempt, so tapping again (or after a cancelled share sheet) never mints a second public link.
 * `score_card_shared` fires when the share sheet completes or the copy succeeds, not when the link is made.
 * Guests are told how to get it; unsaved results (offline, local-only) offer nothing.
 */
export default function ScoreCardShare({
  attemptId,
}: {
  attemptId?: number | null
}) {
  const enabled = useFlag('score_cards')
  const { session } = useAuth()
  const here = useRouterState({ select: (s) => s.location.href })
  const created = useRef<{ attemptId: number; url: string } | null>(null)

  if (!enabled) return null
  if (!session)
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        <Link
          to="/login"
          search={{ redirect: here }}
          className="underline underline-offset-2"
        >
          Sign in
        </Link>{' '}
        to share your score.
      </p>
    )
  if (attemptId == null) return null

  const resolve = async () => {
    if (created.current?.attemptId === attemptId) return created.current.url
    const link = await api.createScoreCard(attemptId)
    created.current = { attemptId, url: link.url }
    return link.url
  }
  return (
    <div className="mt-4">
      <ShareButton
        title="My Twister score"
        label="Share score card"
        ariaLabel="Share your score card"
        resolve={resolve}
        onShared={() => track('score_card_shared')}
      />
    </div>
  )
}
