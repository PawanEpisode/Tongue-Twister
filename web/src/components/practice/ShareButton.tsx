import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

type Target =
  /** A path on this site; shared as an absolute canonical link. */
  | { path: string; resolve?: never }
  /** Produces the link when tapped (e.g. creates a score card); may reject. */
  | { resolve: () => Promise<string>; path?: never }

const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError'

/** Native share sheet where available (mobile), otherwise copies the link. */
export default function ShareButton({
  title,
  label = 'Share',
  ariaLabel = 'Share this twister',
  icon = false,
  onShared,
  ...target
}: {
  title: string
  /** Visible text. Ignored when `icon` is set. */
  label?: string
  ariaLabel?: string
  /** Icon only, same circle as the other practice actions. */
  icon?: boolean
  /** Called once the link has actually gone out: the share sheet completed, or the copy succeeded. */
  onShared?: () => void
} & Target) {
  const [note, setNote] = useState('')
  const say = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(''), 2000)
  }
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    say('Link copied')
    onShared?.()
  }
  const share = async () => {
    let url: string
    try {
      // `new URL` keeps absolute links as they are and makes site paths canonical (no mode/wpm params).
      url = new URL(
        target.resolve ? await target.resolve() : target.path,
        window.location.origin,
      ).toString()
    } catch {
      say('Couldn’t make the link — try again')
      return
    }
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        onShared?.()
      } else await copy(url)
    } catch (err) {
      if (isAbort(err)) return
      // The share sheet can refuse once a slow request has used up the tap; copying still works.
      await copy(url).catch(() => say('Couldn’t share'))
    }
  }
  return (
    <span className={cn(icon && 'relative')}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => void share()}
        aria-label={ariaLabel}
        className={cn(
          icon ? 'size-11 rounded-full border border-border p-0' : 'gap-1.5',
        )}
      >
        <Share2 className={icon ? 'size-5' : 'size-4'} aria-hidden />
        {!icon && label}
        {!icon && (
          <span role="status" className="ml-1 text-lime">
            {note}
          </span>
        )}
      </Button>
      {icon && note && (
        <span
          role="status"
          className="absolute top-full left-1/2 z-10 -translate-x-1/2 pt-1 text-xs whitespace-nowrap text-lime"
        >
          {note}
        </span>
      )}
    </span>
  )
}
