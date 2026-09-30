import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'

/** Native share sheet where available (mobile), otherwise copies the canonical link. */
export default function ShareButton({
  title,
  path,
}: {
  title: string
  path: string
}) {
  const [note, setNote] = useState('')
  const say = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(''), 2000)
  }
  const share = async () => {
    const url = new URL(path, window.location.origin).toString() // canonical: no mode/wpm params
    try {
      if (navigator.share) await navigator.share({ title, url })
      else {
        await navigator.clipboard.writeText(url)
        say('Link copied')
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        say('Couldn’t share')
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => void share()}
      aria-label="Share this twister"
      className="gap-1.5"
    >
      <Share2 className="size-4" aria-hidden />
      Share
      <span role="status" className="ml-1 text-lime">
        {note}
      </span>
    </Button>
  )
}
