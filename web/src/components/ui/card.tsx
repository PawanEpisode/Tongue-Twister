import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '#/lib/utils'

const cardVariants = cva('text-card-foreground', {
  variants: {
    variant: {
      default: 'rounded-2xl border border-border bg-card',
      glass: 'glass',
    },
  },
  defaultVariants: { variant: 'default' },
})

type CardProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants> & {
    asChild?: boolean
  }

export function Card({
  className,
  variant,
  asChild = false,
  ...props
}: CardProps) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp className={cn(cardVariants({ variant }), className)} {...props} />
  )
}
