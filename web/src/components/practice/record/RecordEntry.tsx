import { lazy, Suspense, useEffect, useState } from 'react'
import type { Preferences, Twister } from '#/lib/api'

// The whole recorder (compositor, mixer, chunk store, upload manager…) is a separate chunk: it downloads only
// when someone opens the Record tab, and never on the server.
const RecordMode = lazy(() => import('./RecordMode'))

/** Main-bundle wrapper: renders nothing on the server, then loads the recorder in the browser. */
export default function RecordEntry(props: {
  twister: Twister
  prefs: Preferences
  onSwitchMode: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <Loading />
  return (
    <Suspense fallback={<Loading />}>
      <RecordMode {...props} />
    </Suspense>
  )
}

const Loading = () => (
  <p role="status" className="py-16 text-center text-muted-foreground">
    Getting Record mode ready…
  </p>
)
