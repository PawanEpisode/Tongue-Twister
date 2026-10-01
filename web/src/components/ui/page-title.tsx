import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export function PageTitle({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <h1
      className={cn(
        'font-display text-3xl font-extrabold sm:text-4xl',
        className,
      )}
    >
      {children}
    </h1>
  )
}
