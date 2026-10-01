import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { useId } from 'react'
import type { ComponentProps, Ref } from 'react'
import { cn } from '#/lib/utils'
import { Label } from '#/components/ui/label'

/** Radix Select rejects an empty item value. Blank options use this instead. */
const BLANK = '__twister_empty__'

const encode = (value: string) => (value === '' ? BLANK : value)
const decode = (value: string) => (value === BLANK ? '' : value)

/** Same border, radius, and height as `SelectTrigger`, for the native time-zone list. */
export const nativeSelectClass =
  'min-w-0 w-full flex-1 rounded-xl border border-input bg-card px-4 py-3 text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 pointer-coarse:min-h-11'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-4 py-3 text-left text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[placeholder]:text-muted-foreground pointer-coarse:min-h-11',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        collisionPadding={12}
        sideOffset={6}
        className={cn(
          'z-50 max-h-72 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg',
          position === 'popper' &&
            'w-[var(--radix-select-trigger-width)] min-w-40',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center rounded-lg py-2 pr-8 pl-2.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted pointer-coarse:min-h-11',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2">
        <Check className="size-4" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

type SelectOption = { value: string; label: string; disabled?: boolean }

/** Labelled select. A blank option value is allowed; the menu never uses an empty Radix value. */
export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  disabled,
  hint,
  triggerClassName,
  labelClassName,
  triggerRef,
}: {
  id?: string
  label: string
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  disabled?: boolean
  hint?: string
  triggerClassName?: string
  labelClassName?: string
  triggerRef?: Ref<HTMLButtonElement>
}) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div className="space-y-1 text-left text-sm">
      <Label
        htmlFor={fieldId}
        className={cn('block font-medium', labelClassName)}
      >
        {label}
      </Label>
      <Select
        value={encode(value)}
        onValueChange={(next) => onValueChange(decode(next))}
        disabled={disabled}
      >
        <SelectTrigger
          id={fieldId}
          ref={triggerRef}
          className={triggerClassName}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={encode(option.value)}
              value={encode(option.value)}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
