import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { formatDuration } from '#/lib/readAlong/timeline'

type Props = {
  activeMs: number
  wpm: number
  passes: number
  xp?: number
  fasterBy: number
  onFaster: () => void
  onAgain: () => void
  onSpeak: () => void
}

/** Completion card (PRD 02 §6): no score by design, just pacing stats and the next step. */
export default function ReadAlongSummary(p: Props) {
  return (
    <Card
      variant="glass"
      className="mx-auto mt-6 max-w-md rounded-2xl p-6 text-center"
    >
      <p className="font-display text-2xl font-bold">✅ Nicely paced.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {formatDuration(p.activeMs)} · {p.wpm} WPM · {p.passes}{' '}
        {p.passes === 1 ? 'loop' : 'loops'}
        {p.xp ? ` · +${p.xp} XP` : ''}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button className="px-4 py-2" onClick={p.onFaster}>
          Faster (+{p.fasterBy} WPM)
        </Button>
        <Button variant="outline" className="px-4 py-2" onClick={p.onAgain}>
          Again
        </Button>
        <Button variant="outline" className="px-4 py-2" onClick={p.onSpeak}>
          Try Speak &amp; score
        </Button>
      </div>
    </Card>
  )
}
