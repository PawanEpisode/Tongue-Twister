import { Link, useRouter } from '@tanstack/react-router'
import { ErrorState } from '#/components/feedback'
import { ScoreRing, StatTile } from '#/components/ScoreCardParts'
import ScoreBar from '#/components/results/ScoreBar'
import StaticPassage from '#/components/results/StaticPassage'
import { WORD_LOOK } from '#/components/results/wordLook'
import type { TargetStatus } from '#/components/results/wordLook'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import type { ScoreCardPublic, WordStatus } from '#/lib/api'
import { scoreCardTitle } from '#/lib/scoreCard'
import type { ScoreCardState } from '#/lib/scoreCard'
import { tallyStatuses } from '#/lib/speak/display'

const isTargetStatus = (s: WordStatus): s is TargetStatus => s in WORD_LOOK

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <Card
      variant="glass"
      className="mx-auto mt-10 max-w-md rounded-2xl p-8 text-center"
    >
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild className="mt-5">
        <Link to="/twisters">Try a tongue twister</Link>
      </Button>
    </Card>
  )
}

function Passage({ words }: { words: ScoreCardPublic['words'] }) {
  const shown = words.flatMap((w) =>
    isTargetStatus(w.status) ? [{ text: w.target, status: w.status }] : [],
  )
  if (!shown.length) return null
  return (
    <div className="space-y-4 text-left">
      <ScoreBar tally={tallyStatuses(shown.map((w) => w.status))} />
      <StaticPassage words={shown} />
    </div>
  )
}

function ScoreCardBody({ card }: { card: ScoreCardPublic }) {
  return (
    <div className="mx-auto max-w-xl space-y-6 text-center">
      <Card variant="glass" className="space-y-5 rounded-3xl p-8">
        <h1 className="font-display text-2xl font-bold">
          {scoreCardTitle(card)}
        </h1>
        <ScoreRing score={card.score} />
        <blockquote className="font-display text-lg">
          “{card.twister.text}”
        </blockquote>
        <div className="mx-auto grid max-w-xs grid-cols-2 gap-3 text-sm">
          <StatTile k="Accuracy" v={`${Math.round(card.accuracy * 100)}%`} />
          <StatTile k="Speed" v={`${Math.round(card.wpm)} wpm`} />
        </div>
        <Passage words={card.words} />
      </Card>
      <div>
        <Button asChild className="px-6 py-3">
          <Link to="/twisters/$slug" params={{ slug: card.twister.slug }}>
            Try this twister
          </Link>
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          <Link to="/twisters" className="underline underline-offset-2">
            Make your own score card
          </Link>
        </p>
      </div>
    </div>
  )
}

/** The public score-card page body, for every state the loader can produce. */
export default function ScoreCardView({ state }: { state: ScoreCardState }) {
  const router = useRouter()
  switch (state.kind) {
    case 'ok':
      return <ScoreCardBody card={state.card} />
    case 'gone':
      return (
        <Unavailable
          title="This link has expired or was removed"
          body="The owner turned it off, or it ran out. Ask them for a new one."
        />
      )
    case 'missing':
      return (
        <Unavailable
          title="We can’t find this score card"
          body="The link may be mistyped, or the result was deleted."
        />
      )
    case 'unavailable':
      return (
        <Unavailable
          title="Score cards are paused"
          body="Sharing is switched off for now. Please try again later."
        />
      )
    case 'error':
      return (
        <ErrorState
          title="Couldn’t load this score card"
          onRetry={() => void router.invalidate()}
        />
      )
  }
}
