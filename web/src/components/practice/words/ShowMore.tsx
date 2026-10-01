import { Button } from '#/components/ui/button'

/** Loads the next page of a queue; says how many words are still waiting. */
export default function ShowMore({
  remaining,
  loading,
  onClick,
}: {
  remaining: number
  loading: boolean
  onClick: () => void
}) {
  if (remaining <= 0) return null
  return (
    <div className="mt-4 text-center">
      <Button
        variant="outline"
        className="px-5 py-2.5"
        disabled={loading}
        onClick={onClick}
      >
        {loading ? 'Loading…' : `Show more (${remaining} left)`}
      </Button>
    </div>
  )
}
