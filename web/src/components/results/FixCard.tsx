import { ArrowRight } from 'lucide-react'
import type { TopFix } from '#/lib/speak/coaching'

/** "The one thing to fix": what we heard, what to say, and how. */
export default function FixCard({ fix }: { fix: TopFix }) {
  return (
    <section aria-label="The one thing to fix">
      <h3 className="font-display text-base font-bold">The one thing to fix</h3>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="rounded-xl border border-border bg-card px-3 py-3 text-center">
          <div className="font-display text-xl font-bold text-pink">
            {fix.heard}
          </div>
          <div className="text-xs text-muted-foreground">we heard</div>
        </div>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <div className="rounded-xl border border-border bg-card px-3 py-3 text-center">
          <div className="font-display text-xl font-bold text-lime">
            {fix.target}
          </div>
          <div className="text-xs text-muted-foreground">say this</div>
        </div>
      </div>
      <p className="mt-3 text-sm italic text-muted-foreground">{fix.tip}</p>
    </section>
  )
}
