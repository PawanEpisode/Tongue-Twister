import { LazyMotion, domAnimation } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Animations use the slim `m` component with the `domAnimation` feature set (animate, exit, hover, tap,
 * in-view), not the full `motion` component: no drag or layout animation, which nothing here uses.
 * `strict` makes a stray `motion.*` import throw in development instead of quietly adding the full bundle.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  )
}
