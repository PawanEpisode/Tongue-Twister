import { forwardRef } from 'react'
import type { TextLayer } from '#/lib/record/layouts/types'
import { cn } from '#/lib/utils'

/**
 * The element recorded by the "Part of this page" layout (Element / Region Capture). It is a plain, high-contrast
 * text stage: only what is inside this box ends up in the video, so it carries no controls.
 */
const RegionStage = forwardRef<
  HTMLDivElement,
  { text: TextLayer; scale: number; caption?: string }
>(function RegionStage({ text, scale, caption }, ref) {
  return (
    <div
      ref={ref}
      data-testid="region-stage"
      className="mx-auto mb-4 grid aspect-video w-full max-w-3xl place-items-center rounded-2xl bg-slate-950 p-6 text-center text-white"
    >
      <p
        className="font-display font-extrabold leading-tight"
        style={{ fontSize: `${Math.round(28 * scale)}px` }}
      >
        {text.words.map((w, i) => (
          <span
            key={i}
            className={cn(
              'mr-[0.35em] inline-block rounded px-1',
              i === text.current && 'bg-lime/90 text-slate-950',
              text.hits[i] && i !== text.current && 'text-lime',
            )}
          >
            {w}
          </span>
        ))}
      </p>
      {caption && <p className="mt-3 text-xs text-white/60">{caption}</p>}
    </div>
  )
})
export default RegionStage

/** The twister as a reading strip under the picture, for layouts that do not draw the text into the video. */
export function LiveText({ text }: { text: TextLayer }) {
  return (
    <p
      aria-label="Twister text"
      className="mx-auto mt-4 max-w-3xl font-display text-2xl font-bold leading-snug"
    >
      {text.words.map((w, i) => (
        <span
          key={i}
          className={cn(
            'mr-2 inline-block rounded px-1 transition-colors',
            i === text.current && 'bg-primary text-primary-foreground',
            text.hits[i] && i !== text.current && 'text-lime',
          )}
        >
          {w}
        </span>
      ))}
    </p>
  )
}
