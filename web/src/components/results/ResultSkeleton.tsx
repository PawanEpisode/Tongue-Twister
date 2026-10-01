import { Loader2 } from 'lucide-react'
import { Card } from '#/components/ui/card'
import { cn } from '#/lib/utils'

const Bar = ({ className }: { className: string }) => (
  <div
    aria-hidden
    className={cn(
      'animate-pulse rounded-full bg-muted motion-reduce:animate-none',
      className,
    )}
  />
)

/**
 * Stands in for the result card while the attempt is being scored, with the same shape so the page
 * does not jump when the real card arrives. `slow` adds a second line when the wait drags on.
 */
export default function ResultSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <Card
      variant="glass"
      aria-busy
      className="mx-auto max-w-md rounded-3xl p-6 text-left sm:p-8"
    >
      <p
        role="status"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Loader2
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        Scoring your take…
        {slow && (
          <span className="sr-only">Still working — thanks for waiting.</span>
        )}
      </p>
      {slow && (
        <p aria-hidden className="mt-1 text-xs text-muted-foreground">
          Still working — thanks for waiting.
        </p>
      )}
      <Bar className="mt-6 h-16 w-28 rounded-2xl" />
      <Bar className="mt-5 h-6 w-3/4" />
      <Bar className="mt-2 h-4 w-full" />
      <Bar className="mt-5 h-2.5 w-full" />
      <div className="mt-4 flex gap-6">
        <Bar className="h-4 w-20" />
        <Bar className="h-4 w-24" />
        <Bar className="h-4 w-14" />
      </div>
      <Bar className="mt-8 h-4 w-24" />
      <div className="mt-3 space-y-2.5">
        <Bar className="h-5 w-full" />
        <Bar className="h-5 w-11/12" />
        <Bar className="h-5 w-4/5" />
      </div>
    </Card>
  )
}
