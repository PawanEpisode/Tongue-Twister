import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'
import { seo } from '#/lib/seo'

// The recorder and its engine are staff tooling: a separate chunk nobody else downloads.
const CalibratePanel = lazy(() => import('#/components/dev/CalibratePanel'))

export const Route = createFileRoute('/dev/calibrate')({
  head: () =>
    seo({
      title: 'Calibration | Twister',
      description: 'Gold-set recording for the speech engine.',
      path: '/dev/calibrate',
      noindex: true,
    }),
  component: CalibratePage,
})

function CalibratePage() {
  const { session, loading } = useAuth()
  const enabled = useFlag('calibrate')
  if (loading) return null
  if (!session || !enabled)
    return (
      <p className="py-16 text-center text-muted-foreground">
        This page isn’t available.
      </p>
    )
  return (
    <Suspense fallback={null}>
      <CalibratePanel />
    </Suspense>
  )
}
