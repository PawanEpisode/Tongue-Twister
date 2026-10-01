import type { ComponentProps } from 'react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

/** A toggle pill for filters. `count` is shown as a quiet number; 0 dims the chip but keeps it usable. */
export function Chip({
  on,
  count,
  className,
  children,
  ...props
}: { on: boolean; count?: number } & Omit<
  ComponentProps<typeof Button>,
  'variant' | 'size'
>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={on}
      className={cn(
        'px-4 py-1.5 font-normal pointer-coarse:min-h-11',
        on
          ? 'border-primary bg-primary/20 text-foreground hover:border-primary'
          : 'text-muted-foreground',
        count === 0 && !on && 'opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      {count != null && (
        <span className="ml-1.5 text-xs tabular-nums opacity-80">
          <span className="sr-only">, </span>
          {count}
        </span>
      )}
    </Button>
  )
}
