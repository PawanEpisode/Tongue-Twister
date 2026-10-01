import { useNavigate } from '@tanstack/react-router'
import { Shuffle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { ApiError, api } from '#/lib/api'
import type { TwisterFilters } from '#/lib/api'
import { recentTwisters } from '#/lib/progress/recent'

/** "Surprise me": a random twister within the current filters, avoiding the last few shown. */
export function RandomButton({ filters }: { filters: TwisterFilters }) {
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const pick = async () => {
    setBusy(true)
    setNote('')
    try {
      // If the exclusions leave nothing (a tiny filter), repeat rather than fail.
      const t = await api
        .randomTwister(filters, recentTwisters.get())
        .catch((e: unknown) =>
          e instanceof ApiError && e.status === 404
            ? api.randomTwister(filters)
            : Promise.reject(e),
        )
      recentTwisters.add(t.slug)
      await nav({ to: '/twisters/$slug', params: { slug: t.slug } })
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === 404
          ? 'Nothing matches these filters yet — loosen one and try again.'
          : 'Couldn’t pick one just now. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 px-4 pointer-coarse:min-h-11"
        disabled={busy}
        onClick={() => void pick()}
      >
        <Shuffle className="size-4" aria-hidden />
        {busy ? 'Picking…' : 'Random'}
      </Button>
      <span role="status" className="basis-full text-sm text-pink empty:hidden">
        {note}
      </span>
    </>
  )
}
