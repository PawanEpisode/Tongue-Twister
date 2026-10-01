import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import type { ComponentProps } from 'react'
import { cn } from '#/lib/utils'

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn('grid gap-2', className)}
      {...props}
    />
  )
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-full border border-input bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 data-[state=checked]:border-primary pointer-coarse:size-5',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator>
        <span className="size-2 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}
