import { LazyMotion } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Animations use the slim `m` component with the `domAnimation` feature set (animate, exit, hover, tap,
 * in-view), not the full `motion` component: no drag or layout animation, which nothing here uses.
 * The feature set loads after first paint (it is not part of the first-load budget); `m` components render
 * statically until it arrives.
 * `strict` makes a stray `motion.*` import throw in development instead of quietly adding the full bundle.
 */
const loadFeatures = () => import('./motionFeatures').then((mod) => mod.default)

export default function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  )
}
