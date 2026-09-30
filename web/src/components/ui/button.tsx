import { Slot } from '@radix-ui/react-slot'
import { cva  } from 'class-variance-authority'
import type {VariantProps} from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '#/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent hover:border-primary',
        ghost: 'text-muted-foreground hover:text-foreground',
      },
      size: {
        sm: 'rounded-full px-3 py-1 text-sm',
        default: 'rounded-xl px-5 py-2.5 text-sm',
        lg: 'rounded-2xl px-6 py-3.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
