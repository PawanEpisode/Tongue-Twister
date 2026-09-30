import { useBlocker } from '@tanstack/react-router'
import { useRef } from 'react'
import { Button } from '#/components/ui/button'

/**
 * Ask before an in-progress run is abandoned: in-app navigation (including mode switches) and
 * closing/reloading the tab. `shouldBlock` is read at the moment of leaving, so it needs no state.
 */
export function useLeaveGuard(shouldBlock: () => boolean) {
  const check = useRef(shouldBlock)
  check.current = shouldBlock
  return useBlocker({
    shouldBlockFn: () => check.current(),
    enableBeforeUnload: () => check.current(),
    withResolver: true,
  })
}

export function LeaveConfirm({
  open,
  onStay,
  onLeave,
}: {
  open: boolean
  onStay: () => void
  onLeave: () => void
}) {
  if (!open) return null
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="leave-title"
      className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4"
    >
      <div className="glass w-full max-w-sm rounded-2xl p-6 text-center">
        <h2 id="leave-title" className="font-display text-xl font-bold">
          Leave this run?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You’re partway through. Leaving now ends the run early.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Button autoFocus onClick={onStay}>
            Keep practising
          </Button>
          <Button
            variant="outline"
            className="hover:border-pink"
            onClick={onLeave}
          >
            Leave
          </Button>
        </div>
      </div>
    </div>
  )
}
