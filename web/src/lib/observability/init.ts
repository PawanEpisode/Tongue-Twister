import { initAnalytics } from './analytics'
import { initSentry } from './sentry'

/** Called once from the root layout, in the browser only. Both are no-ops without their env var. */
export function initObservability(): void {
  initSentry()
  initAnalytics()
}
