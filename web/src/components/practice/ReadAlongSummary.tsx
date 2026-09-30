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

const secondary =
  'rounded-xl border border-line px-4 py-2 font-semibold hover:border-brand'

/** Completion card (PRD 02 §6): no score by design, just pacing stats and the next step. */
export default function ReadAlongSummary(p: Props) {
  return (
    <div className="glass mx-auto mt-6 max-w-md rounded-2xl p-6 text-center">
      <p className="font-display text-2xl font-bold">✅ Nicely paced.</p>
      <p className="mt-2 text-sm text-white/70">
        {formatDuration(p.activeMs)} · {p.wpm} WPM · {p.passes}{' '}
        {p.passes === 1 ? 'loop' : 'loops'}
        {p.xp ? ` · +${p.xp} XP` : ''}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          className="rounded-xl bg-brand px-4 py-2 font-semibold"
          onClick={p.onFaster}
        >
          Faster (+{p.fasterBy} WPM)
        </button>
        <button className={secondary} onClick={p.onAgain}>
          Again
        </button>
        <button className={secondary} onClick={p.onSpeak}>
          Try Speak &amp; score
        </button>
      </div>
    </div>
  )
}
