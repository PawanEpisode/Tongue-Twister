import { cn } from '#/lib/utils'
import type { AvatarView } from '#/lib/profile/avatar'

/** One avatar for the header, profile and edit dialog. Fills its parent; size it from outside. */
export default function Avatar({
  view,
  className,
}: {
  view: AvatarView
  className?: string
}) {
  if (view.kind === 'photo')
    return (
      <img
        src={view.url}
        alt=""
        referrerPolicy="no-referrer"
        className={cn('size-full rounded-full object-cover', className)}
      />
    )
  if (view.kind === 'emoji')
    return (
      <span
        aria-hidden
        className={cn(
          'grid size-full place-items-center rounded-full bg-primary/15 text-[1.1em] leading-none',
          className,
        )}
      >
        {view.emoji}
      </span>
    )
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-full place-items-center rounded-full bg-primary text-[0.8em] font-bold text-primary-foreground',
        className,
      )}
    >
      {view.letter}
    </span>
  )
}
