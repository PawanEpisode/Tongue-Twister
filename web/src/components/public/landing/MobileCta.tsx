import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'

/** Phones only: appears once the hero has scrolled away, hides while a sheet is open. */
export default function MobileCta() {
  const { request, open } = useGate()
  const [show, setShow] = useState(false)
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 0.9)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  if (!show || open) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-background/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden">
      <Button
        variant="outline"
        className="flex-1"
        onClick={() =>
          document.getElementById('demo')?.scrollIntoView({ block: 'center' })
        }
      >
        Try it now
      </Button>
      <Button
        className="flex-1"
        onClick={() => {
          track('landing_cta_clicked', { where: 'sticky' })
          request({ intent: 'hero_cta', returnTo: '/twisters' })
        }}
      >
        Start free
      </Button>
    </div>
  )
}
