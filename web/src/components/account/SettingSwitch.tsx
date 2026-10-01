import { useId } from 'react'
import { saveStatusText } from '#/lib/account/optimistic'
import type { SaveStatus } from '#/lib/account/optimistic'
import { cn } from '#/lib/utils'

/** A labelled on/off switch with a one-line explanation and an `aria-live` save note. */
export default function SettingSwitch({
  label,
  description,
  checked,
  disabled,
  status,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  status: SaveStatus
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-3 text-left">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-describedby={`${id}-desc`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 pointer-coarse:h-7 pointer-coarse:w-12',
          checked ? 'bg-primary' : 'bg-card',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute left-0.5 top-0.5 size-4.5 rounded-full bg-foreground transition-transform pointer-coarse:size-5.5',
            checked && 'translate-x-5',
          )}
        />
      </button>
      <div className="min-w-0 text-sm">
        <label htmlFor={id} className="block font-semibold">
          {label}
        </label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {description}
        </p>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'min-h-4 text-xs',
            status === 'failed' ? 'text-pink' : 'text-lime',
          )}
        >
          {saveStatusText(status)}
        </p>
      </div>
    </div>
  )
}
