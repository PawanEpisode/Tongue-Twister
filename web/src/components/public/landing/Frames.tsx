import { ScoreRing } from '#/components/public/ScoreRing'
import { cn } from '#/lib/utils'

const WORDS = ['She', 'sells', 'sea', 'shells', 'by', 'the', 'sea', 'shore']

export function FramePick() {
  const rows = [
    ['Easy', 'Fat frogs flying past fast'],
    ['Medium', 'She sells seashells by the seashore'],
    ['Hard', 'Truly rural, truly rural'],
  ]
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-2 text-xs">
        {['Easy', 'Medium', 'Hard', 'Insane'].map((l, i) => (
          <span
            key={l}
            className={cn(
              'rounded-full border px-3 py-1',
              i === 1
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            {l}
          </span>
        ))}
      </div>
      {rows.map(([l, t], i) => (
        <div
          key={t}
          className={cn(
            'glass rounded-2xl p-4',
            i === 1 && 'border-primary/60',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {l}
          </div>
          <div className="mt-1 font-display text-lg">{t}</div>
        </div>
      ))}
    </div>
  )
}

/** `lit` words are bright; scrolled by the sticky stage so even a non-speaker sees the AHA. */
export function FrameSay({ lit }: { lit: number }) {
  return (
    <div className="glass rounded-2xl p-6" aria-hidden>
      <p className="font-display text-3xl leading-snug">
        {WORDS.map((w, i) => (
          <span
            key={i}
            className={cn(
              'mr-[0.3em] inline-block rounded-md px-0.5 transition-colors duration-300',
              i < lit ? 'bg-lime/20 text-lime' : 'text-foreground/80',
            )}
          >
            {w}
          </span>
        ))}
      </p>
      <div className="mt-5 flex h-8 items-center gap-1">
        {[8, 18, 12, 26, 20, 30, 14, 24, 16, 10, 22, 12].map((h, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-gradient-to-t from-brand to-cyan"
            style={{ height: h }}
          />
        ))}
      </div>
    </div>
  )
}

export function FrameScore() {
  return (
    <div
      className="glass flex flex-wrap items-center gap-6 rounded-2xl p-6"
      aria-hidden
    >
      <ScoreRing score={86} label="sample" />
      <div className="space-y-2 text-sm">
        <p className="font-semibold">7 of 8 words clear</p>
        <p className="text-muted-foreground">
          Slow word:{' '}
          <span className="rounded bg-pink/20 px-1 text-pink">shells</span>
        </p>
        <p className="text-muted-foreground">Sound that slipped: “sh”</p>
        <span className="inline-block rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-brand">
          Drill “shells”
        </span>
      </div>
    </div>
  )
}
