import { Star } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useGate } from '#/lib/gate/useGate'
import { usePublicSite } from '#/lib/public/audience'
import { useFavorite } from '#/lib/progress/useFavorite'
import { cn } from '#/lib/utils'

const preview = (text: string) =>
  text.length > 40 ? `${text.slice(0, 40)}…` : text

/** The one star button: cards, the hub header and lists all use it. */
export function FavoriteButton({
  twister,
  className,
  activeClassName = 'fill-pink text-pink',
}: {
  twister: Pick<Twister, 'slug' | 'text' | 'is_favorite'>
  className?: string
  /** Filled-star color. Browse stays pink; the library cards use gold. */
  activeClassName?: string
}) {
  const { starred, toggle, failed, localOnly } = useFavorite(
    twister.slug,
    twister.is_favorite,
  )
  // Public site: a signed-out star is a reason to sign up, not a note kept on the device.
  const { session } = useAuth()
  const { request } = useGate()
  const publicSite = usePublicSite()
  const gated = !session && publicSite
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={gated ? () => request({ intent: 'favourite' }) : toggle}
        aria-pressed={gated ? false : starred}
        aria-label={`${starred ? 'Remove from' : 'Add to'} favourites: ${preview(twister.text)}`}
        title={
          localOnly ? 'Saved on this device — sign in to keep it' : undefined
        }
        className={cn('size-11 rounded-full p-0', className)}
      >
        <Star
          className={cn(
            'size-5',
            starred ? activeClassName : 'text-muted-foreground',
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
