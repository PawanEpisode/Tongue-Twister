import { rememberIntent } from '#/lib/public/attribution'
import { returnTo } from '#/lib/returnTo'
import type { GateIntent } from './intent'

/** Called just before a visitor leaves the sheet for sign-in: remember why, and where to come back to. */
export function rememberGate(req: { intent: GateIntent; returnTo?: string }) {
  rememberIntent(req.intent)
  returnTo.remember(req.returnTo)
}
