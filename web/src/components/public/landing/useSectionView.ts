import { useEffect, useRef } from 'react'
import { track } from '#/lib/observability/analytics'
import type { LandingSection } from '#/lib/observability/events'

/** Fires `landing_section_viewed` once when at least 40% of the section is on screen. */
export function useSectionView<T extends HTMLElement>(section: LandingSection) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          track('landing_section_viewed', { section })
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [section])
  return ref
}
