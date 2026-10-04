import { useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { GATE_COPY } from '#/lib/gate/intent'
import { rememberGate } from '#/lib/gate/leave'
import { useGate } from '#/lib/gate/useGate'

/** After two dismissed sheets: a quiet, non-blocking bar instead of another modal. */
export default function GateNudge() {
  const { nudge, dismiss, proceed } = useGate()
  const nav = useNavigate()
  if (!nudge) return null
  const copy = GATE_COPY[nudge.intent]
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-xl"
    >
      <p className="min-w-0 flex-1 text-sm">{copy.title}</p>
      <Button
        size="sm"
        onClick={() => {
          rememberGate(nudge)
          void nav({ to: '/login', search: { redirect: proceed() } })
        }}
      >
        {copy.cta}
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Not now">
        Not now
      </Button>
    </div>
  )
}
