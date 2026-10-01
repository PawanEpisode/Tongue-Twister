import { useEffect } from 'react'
import { initObservability } from '#/lib/observability/init'

/** Starts error reporting and analytics after hydration. Renders nothing; both are no-ops without env keys. */
export default function ObservabilityInit() {
  useEffect(() => {
    initObservability()
  }, [])
  return null
}
