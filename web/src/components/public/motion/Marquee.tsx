import type { ReactNode } from 'react'

/** An endless slow row. Pauses on hover; a static wrapping row when motion is reduced (see styles). */
export function Marquee({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="marquee group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]"
    >
      <div className="marquee-track flex w-max gap-3 group-hover:[animation-play-state:paused]">
        {children}
        <div className="contents" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  )
}
