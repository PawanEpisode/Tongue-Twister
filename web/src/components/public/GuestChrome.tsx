import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { captureArrival } from '#/lib/public/attribution'
import GateNudge from './GateNudge'
import GateSheet from './GateSheet'
import PublicFooter from './PublicFooter'

/**
 * Everything only a signed-out visitor needs besides the page: the footer, the sign-in sheet and nudge, and
 * the one-time note of how they arrived. One lazy chunk, so members never download any of it.
 */
export default function GuestChrome({
  guest,
  footer,
}: {
  guest: boolean
  footer: boolean
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.searchStr })
  useEffect(() => {
    if (guest) captureArrival(pathname, search)
    // First touch only: the helper ignores later calls.
  }, [guest, pathname, search])
  return (
    <>
      {footer && <PublicFooter />}
      {guest && (
        <>
          <GateSheet />
          <GateNudge />
        </>
      )}
    </>
  )
}
