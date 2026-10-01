import { Star } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { Twister } from '#/lib/api'
import { useFavorite } from '#/lib/progress/useFavorite'
import { cn } from '#/lib/utils'

const preview = (text: string) =>
  text.length > 40 ? `${text.slice(0, 40)}…` : text

/** The one star button: cards, the hub header and lists all use it. */
export function FavoriteButton({
  twister,
  className,
}: {
  twister: Pick<Twister, 'slug' | 'text' | 'is_favorite'>
  className?: string
}) {
  const { starred, toggle, failed, localOnly } = useFavorite(
    twister.slug,
    twister.is_favorite,
  )
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={toggle}
        aria-pressed={starred}
        aria-label={`${starred ? 'Remove from' : 'Add to'} favourites: ${preview(twister.text)}`}
        title={
          localOnly ? 'Saved on this device — sign in to keep it' : undefined
        }
        className={cn('size-11 rounded-full p-0', className)}
      >
        <Star
          className={cn(
            'size-5',
            starred ? 'fill-pink text-pink' : 'text-muted-foreground',
          )}
          aria-hidden
        />
      </Button>
      <span role="status" className="sr-only">
        {failed ? 'Couldn’t update your favourites. Try again.' : ''}
      </span>
    </>
  )
}
