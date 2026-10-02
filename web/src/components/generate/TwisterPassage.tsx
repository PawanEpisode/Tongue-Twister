import { useLayoutEffect, useRef } from 'react'
import { trapSpans } from '#/lib/twisterCard/trap'
import type { TrapRole } from '#/lib/twisterCard/trap'
import { cn } from '#/lib/utils'

const ROLE: Record<TrapRole, string> = {
  plain: '',
  sound: 'rounded bg-cyan/15 px-0.5 text-cyan',
  anchor: 'rounded-md bg-background px-1 text-cyan',
}

/** The twister line, with optional trap chips, a repeat count, and a four-line clamp. */
export function TwisterPassage({
  text,
  focusSounds,
  showTrap,
  clamped,
  times,
  onOverflow,
}: {
  text: string
  focusSounds: string[]
  showTrap: boolean
  clamped: boolean
  times: number | null
  onOverflow: (overflows: boolean) => void
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !clamped) return
    onOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [clamped, focusSounds, onOverflow, showTrap, text, times])

  const spans = showTrap ? trapSpans(text, focusSounds) : null
  return (
    <p
      ref={ref}
      className={cn(
        'text-lg leading-relaxed text-pretty',
        clamped && 'line-clamp-4',
      )}
    >
      {spans
        ? spans.map((span, index) =>
            span.role === 'plain' ? (
              <span key={index}>{span.text}</span>
            ) : (
              <span key={index} className={ROLE[span.role]}>
                {span.text}
              </span>
            ),
          )
        : text}
      {times != null && (
        <span className="ml-2 inline-flex align-middle rounded-full bg-pink/15 px-2 py-0.5 text-xs font-semibold text-pink">
          × {times}
          <span className="sr-only"> repeats</span>
        </span>
      )}
    </p>
  )
}
