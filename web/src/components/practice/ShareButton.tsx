import { useState } from 'react'

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
    <button
      onClick={() => void share()}
      aria-label="Share this twister"
      className="text-sm text-white/60 hover:text-white"
    >
      ⤴ Share
      <span role="status" className="ml-1 text-lime">
        {note}
      </span>
    </button>
  )
}
