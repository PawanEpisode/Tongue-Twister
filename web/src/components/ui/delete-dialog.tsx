import { Trash2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { cn } from '#/lib/utils'

/** Confirmation shell for delete, discard, and other remove flows. */
export function DeleteDialogWrapper({
  open,
  onOpenChange,
  title,
  description,
  preview,
  confirmLabel = 'Delete',
  cancelLabel = 'Keep it',
  pending = false,
  pendingLabel,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  onOpenAutoFocus,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** The thing about to be removed, shown in a destructive preview. */
  preview?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  pending?: boolean
  pendingLabel?: string
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel?: () => void
  onOpenAutoFocus?: ComponentProps<typeof DialogContent>['onOpenAutoFocus']
  className?: string
  children?: ReactNode
}) {
  const dismiss = () => {
    if (onCancel) onCancel()
    else onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('sm:max-w-md', className)}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        <div className="flex items-start gap-3 pr-6">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"
            aria-hidden
          >
            <Trash2 className="size-5" />
          </span>
          <DialogHeader className="min-w-0 gap-1.5 text-left">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
        </div>
        {preview ? (
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-foreground">
            {preview}
          </p>
        ) : null}
        {children}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={dismiss}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
