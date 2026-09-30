import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { cn } from '#/lib/utils'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog: labelled, focus moves in and is trapped, Esc closes, focus returns to the opener.
 * Renders inline (fixed overlay), so it is safe to server-render.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  initialFocus,
  className,
  dismissible = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  initialFocus?: RefObject<HTMLElement | null>
  className?: string
  /** false = Esc and a backdrop click do nothing (a step the user must answer). */
  dismissible?: boolean
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const first =
      initialFocus?.current ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    return () => opener?.focus()
  }, [open, initialFocus])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length) return
    const firstEl = items[0]
    const lastEl = items[items.length - 1]
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault()
      lastEl.focus()
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault()
      firstEl.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/70 p-4"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cn('glass w-full max-w-md rounded-2xl p-6', className)}
      >
        <h2 id={`${id}-title`} className="font-display text-xl font-bold">
          {title}
        </h2>
        {description && (
          <p id={`${id}-desc`} className="mt-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}
