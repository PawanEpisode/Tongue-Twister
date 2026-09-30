import { cva  } from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority';
import type { HTMLAttributes } from 'react'
import { cn } from '#/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      variant: {
        lime: 'border-lime/30 bg-lime/15 text-lime',
        cyan: 'border-cyan/30 bg-cyan/15 text-cyan',
        pink: 'border-pink/30 bg-pink/15 text-pink',
        destructive: 'border-destructive/30 bg-destructive/15 text-destructive',
        outline: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
)

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
