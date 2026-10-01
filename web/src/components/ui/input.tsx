import type { ComponentProps } from 'react'
import { cn } from '#/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-input bg-card px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary',
        className,
      )}
      {...props}
    />
  )
}
