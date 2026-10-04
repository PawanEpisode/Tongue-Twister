import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'

/** Native scroll-snap row with arrow buttons. No scroll-jacking; works with touch, wheel and keyboard. */
export function SnapCarousel({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const by = (dir: 1 | -1) =>
    ref.current?.scrollBy({
      left: dir * Math.max(280, ref.current.clientWidth * 0.8),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous twisters"
          onClick={() => by(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next twisters"
          onClick={() => by(1)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:thin] sm:-mx-5 sm:px-5"
      >
        {children}
      </div>
    </div>
  )
}
