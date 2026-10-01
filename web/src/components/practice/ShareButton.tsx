import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'

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
  ...target
}: {
  title: string
  /** Visible text. */
  label?: string
  ariaLabel?: string
} & Target) {
  const [note, setNote] = useState('')
  const say = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(''), 2000)
  }
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    say('Link copied')
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
      if (navigator.share) await navigator.share({ title, url })
      else await copy(url)
    } catch (err) {
      if (isAbort(err)) return
      // The share sheet can refuse once a slow request has used up the tap; copying still works.
      await copy(url).catch(() => say('Couldn’t share'))
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => void share()}
      aria-label={ariaLabel}
      className="gap-1.5"
    >
      <Share2 className="size-4" aria-hidden />
      {label}
      <span role="status" className="ml-1 text-lime">
        {note}
      </span>
    </Button>
  )
}
